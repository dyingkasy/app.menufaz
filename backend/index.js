import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, withClient } from './db.js';
import { initErrorLogTable, logError } from './logger.js';

const app = express();
const port = process.env.PORT || 3001;
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const corsOrigin = process.env.CORS_ORIGIN || '*';
const imagekitPrivateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || '';

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '50mb' }));

const ensurePrintTables = async () => {
  await query(
    `
    CREATE TABLE IF NOT EXISTS print_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merchant_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      token TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (merchant_id, machine_id)
    )
    `
  );
  await query(
    `
    CREATE TABLE IF NOT EXISTS print_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merchant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      printed_at TIMESTAMP WITH TIME ZONE
    )
    `
  );
  await query('CREATE INDEX IF NOT EXISTS idx_print_devices_merchant_id ON print_devices(merchant_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_print_jobs_merchant_status ON print_jobs(merchant_id, status)');
};

initErrorLogTable().catch((error) => {
  console.error('Failed to initialize error log table', error);
});

ensurePrintTables().catch((error) => {
  console.error('Failed to initialize print tables', error);
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    const durationMs = Date.now() - startedAt;
    logError({
      source: 'server',
      level: res.statusCode >= 500 ? 'error' : 'warning',
      message: `${req.method} ${req.originalUrl} -> ${res.statusCode}`,
      context: {
        status: res.statusCode,
        durationMs,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || ''
      }
    }).catch(() => {});
  });
  next();
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : null;
  logError({ source: 'server', message, stack, context: { type: 'unhandledRejection' } }).catch(() => {});
});

process.on('uncaughtException', (error) => {
  logError({
    source: 'server',
    message: error?.message || 'Uncaught exception',
    stack: error?.stack,
    context: { type: 'uncaughtException' }
  }).catch(() => {});
});

const signToken = (payload) => jwt.sign(payload, jwtSecret, { expiresIn: '7d' });

const getAuthPayload = (req) => {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
};

const requireAdmin = (req, res, next) => {
  const payload = getAuthPayload(req);
  if (!payload || payload.role !== 'ADMIN') {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.user = payload;
  return next();
};

const requireAuth = (req, res, next) => {
  const payload = getAuthPayload(req);
  if (!payload) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.user = payload;
  return next();
};

const createUserResponse = (userId, role, profileData) => ({
  id: userId,
  role,
  ...profileData
});

const getProfile = async (userId) => {
  const { rows } = await query('SELECT data FROM profiles WHERE user_id = $1', [userId]);
  return rows[0]?.data || null;
};

const upsertProfile = async (userId, data) => {
  const { rows } = await query(
    `
    WITH existing AS (
      SELECT 1 FROM users WHERE id = $1
    )
    INSERT INTO profiles (user_id, data)
    SELECT $1, $2 FROM existing
    ON CONFLICT (user_id)
    DO UPDATE SET data = EXCLUDED.data
    RETURNING user_id
    `,
    [userId, data]
  );
  return rows.length > 0;
};

const normalizeId = (value) => (value || '').toString();

const mapRow = (row) => {
  if (!row) return null;
  const payload = row.data || {};
  return { id: row.id, ...payload };
};

const mapRows = (rows) => rows.map(mapRow);

const normalizeStoreRatings = (storeData = {}) => {
  const rating = Number(storeData.rating);
  const ratingCount = Number(storeData.ratingCount);
  return {
    ...storeData,
    rating: Number.isFinite(rating) && rating >= 0 ? rating : 0,
    ratingCount: Number.isFinite(ratingCount) && ratingCount >= 0 ? ratingCount : 0
  };
};

const stripSplitSurcharge = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  const { splitSurcharge, ...rest } = payload;
  return rest;
};

const PIZZA_SIZE_KEYS = ['brotinho', 'pequena', 'media', 'grande', 'familia'];
const PRINT_JOB_STATUS = {
  pending: 'pending',
  printed: 'printed'
};

const normalizeFlavorPricesBySize = (value) => {
  if (!value || typeof value !== 'object') return {};
  const output = {};
  PIZZA_SIZE_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return;
    const raw = value[key];
    if (raw === '' || raw === null || raw === undefined) return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      output[key] = parsed;
    }
  });
  return output;
};

const normalizeSizeKey = (value) =>
  (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const resolveSizeKey = (value) => {
  const normalized = normalizeSizeKey(value);
  if (PIZZA_SIZE_KEYS.includes(normalized)) return normalized;
  if (normalized.includes('brotinho')) return 'brotinho';
  if (normalized.includes('pequena')) return 'pequena';
  if (normalized.includes('media') || normalized.includes('medio')) return 'media';
  if (normalized.includes('grande')) return 'grande';
  if (normalized.includes('familia')) return 'familia';
  return '';
};

const findSizeGroup = (product) => {
  if (!Array.isArray(product?.optionGroups)) return null;
  return (
    product.optionGroups.find((group) => group.id === 'size-group' || /tamanho|gramatura/i.test(group.name || '')) ||
    null
  );
};

const getSizeOptionById = (product, optionId) => {
  const group = findSizeGroup(product);
  if (!group || !optionId) return null;
  return (group.options || []).find((opt) => opt.id === optionId) || null;
};

const getFlavorPriceForSize = (flavor, sizeKey, sizeOptionId) => {
  const prices = flavor?.pricesBySize || {};
  const resolvePriceKey = (key) => {
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(prices, key)) return key;
    const normalized = normalizeSizeKey(key);
    const match = Object.keys(prices).find((candidate) => normalizeSizeKey(candidate) === normalized);
    return match || null;
  };
  const pickPrice = (key) => {
    if (!key || !Object.prototype.hasOwnProperty.call(prices, key)) return null;
    const raw = prices[key];
    if (raw === '' || raw === null || raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const byKey = pickPrice(resolvePriceKey(sizeKey));
  if (byKey !== null) return byKey;
  const byOption = pickPrice(sizeOptionId);
  if (byOption !== null) return byOption;
  return 0;
};

const resolvePizzaPricingStrategy = (product, requested) => {
  const allowed = Array.isArray(product?.pricingStrategiesAllowed)
    ? product.pricingStrategiesAllowed
    : ['NORMAL', 'PROPORCIONAL', 'MAX'];
  const fallback = product?.defaultPricingStrategy || allowed[0] || 'NORMAL';
  if (product?.customerCanChoosePricingStrategy === false) {
    return fallback;
  }
  return allowed.includes(requested) ? requested : fallback;
};

const SCHEDULE_DAYS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
const scheduleDayAliases = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  'terca-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
  'sabado-feira': 6
};

const normalizeScheduleEntry = (entry = {}, fallbackDay) => {
  const legacyOpen = entry.openTime;
  const legacyClose = entry.closeTime;
  return {
    day: entry.day || fallbackDay,
    morningOpenTime: entry.morningOpenTime || legacyOpen || '00:00',
    morningCloseTime: entry.morningCloseTime || legacyClose || '12:00',
    afternoonOpenTime: entry.afternoonOpenTime || '12:01',
    afternoonCloseTime: entry.afternoonCloseTime || '23:59',
    isMorningOpen: entry.isMorningOpen ?? entry.isOpen ?? true,
    isAfternoonOpen: entry.isAfternoonOpen ?? entry.isOpen ?? true
  };
};

const normalizeSchedule = (schedule) => {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return SCHEDULE_DAYS.map((day) => normalizeScheduleEntry({}, day));
  }
  return schedule.map((entry, index) => normalizeScheduleEntry(entry, SCHEDULE_DAYS[index] || entry?.day));
};

const parseTimeToMinutes = (value) => {
  if (typeof value !== 'string') return null;
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const resolveScheduleDayIndex = (entry, fallbackIndex) => {
  const raw = (entry?.day || '').toString().trim().toLowerCase();
  if (raw && Object.prototype.hasOwnProperty.call(scheduleDayAliases, raw)) {
    return scheduleDayAliases[raw];
  }
  return fallbackIndex;
};

const getScheduleEntryForDate = (schedule, date) => {
  const normalized = normalizeSchedule(schedule);
  const dayIndex = date.getDay();
  if (normalized.length === 7) return normalized[dayIndex];
  const match = normalized.find((entry, idx) => resolveScheduleDayIndex(entry, idx) === dayIndex);
  return match || normalized[dayIndex] || normalized[0];
};

const isTimeWithinRange = (timeMinutes, startMinutes, endMinutes) => {
  if (startMinutes === null || endMinutes === null || timeMinutes === null) return false;
  if (startMinutes === endMinutes) return false;
  if (endMinutes > startMinutes) {
    return timeMinutes >= startMinutes && timeMinutes < endMinutes;
  }
  return timeMinutes >= startMinutes || timeMinutes < endMinutes;
};

const getScheduleSegments = (entry) => {
  const segments = [];
  if (entry?.isMorningOpen) {
    segments.push([entry.morningOpenTime, entry.morningCloseTime]);
  }
  if (entry?.isAfternoonOpen) {
    segments.push([entry.afternoonOpenTime, entry.afternoonCloseTime]);
  }
  return segments;
};

const buildNextChange = (schedule, now) => {
  const base = new Date(now);
  const nowMinutes = base.getHours() * 60 + base.getMinutes();
  let soonest = null;

  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dayDate = new Date(base);
    dayDate.setDate(base.getDate() + dayOffset);
    const entry = getScheduleEntryForDate(schedule, dayDate);
    const segments = getScheduleSegments(entry);
    for (const [start, end] of segments) {
      const startMinutes = parseTimeToMinutes(start);
      const endMinutes = parseTimeToMinutes(end);
      if (startMinutes === null || endMinutes === null) continue;

      const startDate = new Date(dayDate);
      startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

      const endDate = new Date(dayDate);
      if (endMinutes < startMinutes) {
        endDate.setDate(endDate.getDate() + 1);
      }
      endDate.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);

      const targets = [startDate, endDate];
      for (const target of targets) {
        if (target.getTime() <= now.getTime()) continue;
        if (!soonest || target.getTime() < soonest.getTime()) {
          soonest = target;
        }
      }
    }

    if (dayOffset === 0 && soonest) {
      if (soonest.getTime() > now.getTime() && nowMinutes >= 0) {
        break;
      }
    }
    if (soonest) break;
  }

  return soonest ? soonest.toISOString() : null;
};

const resolveStoreAvailability = (storeData, now = new Date()) => {
  const pause = storeData.pause || null;
  const pauseEndsAt = pause?.endsAt ? new Date(pause.endsAt) : null;
  const pauseActive = Boolean(pause?.active && pauseEndsAt && pauseEndsAt.getTime() > now.getTime());
  const pauseExpired = Boolean(pause?.active && pauseEndsAt && pauseEndsAt.getTime() <= now.getTime());

  const autoOpenClose = Boolean(storeData.autoOpenClose);
  const schedule = normalizeSchedule(storeData.schedule);
  const entry = getScheduleEntryForDate(schedule, now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const scheduleSegments = getScheduleSegments(entry);
  const scheduleOpen = scheduleSegments.some(([start, end]) => {
    return isTimeWithinRange(nowMinutes, parseTimeToMinutes(start), parseTimeToMinutes(end));
  });

  let isOpen = autoOpenClose ? scheduleOpen : storeData.isActive !== false;
  let reason = isOpen ? (autoOpenClose ? 'OPEN_SCHEDULE' : 'OPEN_MANUAL') : (autoOpenClose ? 'CLOSED_SCHEDULE' : 'CLOSED_MANUAL');

  if (pauseActive) {
    isOpen = false;
    reason = 'PAUSED';
  }

  return {
    isOpen,
    reason,
    autoOpenClose,
    scheduleOpen,
    pause: pauseActive ? pause : null,
    pauseExpired,
    nextChangeAt: buildNextChange(schedule, now)
  };
};

const getMerchantIdFromRequest = (req) => {
  const headerValue = req.headers['x-merchant-id'];
  const queryValue = req.query?.merchantId;
  const bodyValue = req.body?.merchantId;
  const raw = headerValue || queryValue || bodyValue;
  return raw ? String(raw) : '';
};

const getPrintTokenFromRequest = (req) => {
  const auth = req.headers.authorization || '';
  return auth.replace('Bearer ', '').trim();
};

const getStoreByMerchantId = async (merchantId) => {
  const { rows } = await query('SELECT id, data FROM stores WHERE data->>\'merchantId\' = $1', [merchantId]);
  if (rows.length === 0) return null;
  return { id: rows[0].id, data: rows[0].data || {} };
};

const generateUniqueMerchantId = async () => {
  let candidate = crypto.randomUUID();
  let attempts = 0;
  while (attempts < 5) {
    const { rows } = await query('SELECT 1 FROM stores WHERE data->>\'merchantId\' = $1', [candidate]);
    if (rows.length === 0) return candidate;
    candidate = crypto.randomUUID();
    attempts += 1;
  }
  return candidate;
};

const logQualifazError = async (code, message, context = {}, level = 'warning') => {
  await logError({
    source: 'qualifaz',
    level,
    message,
    context: { code, ...context }
  });
};

const respondQualifazError = async (res, status, code, message, context = {}, level = 'warning') => {
  await logQualifazError(code, message, context, level);
  return res.status(status).json({ error: message, code });
};

const QUALIFAZ_CANCEL_REASONS = [
  { code: 'CUSTOMER_REQUEST', label: 'Cliente pediu cancelamento' },
  { code: 'ITEM_UNAVAILABLE', label: 'Item indisponivel' },
  { code: 'STORE_CLOSED', label: 'Loja fechada' },
  { code: 'DELIVERY_UNAVAILABLE', label: 'Entrega indisponivel' },
  { code: 'PAYMENT_ISSUE', label: 'Problema no pagamento' },
  { code: 'ADDRESS_INVALID', label: 'Endereco invalido' },
  { code: 'OUT_OF_STOCK', label: 'Sem estoque' },
  { code: 'OTHER', label: 'Outro motivo' }
];

const resolvePickupStatus = async (orderId, storeId, status) => {
  if (status !== 'WAITING_COURIER') return status;
  const params = [orderId];
  let sql = 'SELECT data FROM orders WHERE id = $1';
  if (storeId) {
    sql += ' AND store_id = $2';
    params.push(storeId);
  }
  const { rows } = await query(sql, params);
  const data = normalizeOrderPayload(rows[0]?.data || {});
  if (data.type === 'PICKUP') return 'DELIVERING';
  return status;
};

const refreshStoreRating = async (client, storeId) => {
  const { rows: reviewRows } = await client.query('SELECT data FROM reviews WHERE store_id = $1', [storeId]);
  const ratings = reviewRows
    .map((row) => Number(row.data?.rating))
    .filter((value) => Number.isFinite(value) && value > 0);
  const ratingCount = ratings.length;
  const rating =
    ratingCount > 0
      ? Number((ratings.reduce((acc, value) => acc + value, 0) / ratingCount).toFixed(1))
      : 0;

  const { rows: storeRows } = await client.query('SELECT data, city FROM stores WHERE id = $1', [storeId]);
  if (storeRows.length === 0) return;
  const storeData = normalizeStoreRatings(storeRows[0].data || {});
  storeData.rating = rating;
  storeData.ratingCount = ratingCount;
  await client.query('UPDATE stores SET data = $1, city = $2 WHERE id = $3', [
    storeData,
    storeData.city || null,
    storeId
  ]);
};

const normalizeOrderPayload = (payload = {}) => {
  const data = payload || {};
  const notesText = (data.notes || '').toString().toUpperCase();
  const inferredType =
    data.type ||
    data.orderType ||
    (data.pickup === true || data.isPickup === true ? 'PICKUP' : undefined) ||
    (data.tableNumber || data.tableSessionId ? 'TABLE' : data.deliveryAddress ? 'DELIVERY' : undefined) ||
    (data.pickupTime || data.pickup ? 'PICKUP' : undefined) ||
    (notesText.includes('RETIRADA') ? 'PICKUP' : undefined);

  if (!inferredType) return data;
  const type = data.type || inferredType;
  const next = { ...data, type };
  if (type === 'PICKUP') {
    if (next.pickup === undefined) next.pickup = true;
    if (next.isPickup === undefined) next.isPickup = true;
  }
  return next;
};

const parseOrderRow = (row) => {
  if (!row) return null;
  const data = normalizeOrderPayload(row.data || {});
  const storeId = data.storeId || row.store_id;
  return {
    id: row.id,
    status: row.status,
    storeCity: row.store_city,
    createdAt: row.created_at,
    ...(storeId ? { storeId } : {}),
    ...data
  };
};

const parseOrderRows = (rows) => rows.map(parseOrderRow);

const ensureUserExists = async (userId) => {
  const { rows } = await query('SELECT id FROM users WHERE id = $1', [userId]);
  return rows.length > 0;
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// --- Print ---
app.post('/api/print/register', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    const machineId = (req.body?.machineId || '').toString().trim();
    if (!merchantId || !machineId) {
      return res.status(400).json({ error: 'merchantId and machineId required' });
    }

    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return res.status(404).json({ error: 'store not found' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    await query(
      `
      INSERT INTO print_devices (merchant_id, machine_id, token)
      VALUES ($1, $2, $3)
      ON CONFLICT (merchant_id, machine_id)
      DO UPDATE SET token = EXCLUDED.token, updated_at = NOW()
      `,
      [merchantId, machineId, token]
    );

    const storeName =
      store.data?.name ||
      store.data?.storeName ||
      store.data?.tradeName ||
      store.data?.companyName ||
      '';

    return res.json({ storeName, printToken: token });
  } catch (error) {
    await logError({
      source: 'server',
      message: 'failed to register print device',
      stack: error?.stack,
      context: { route: 'POST /api/print/register' }
    });
    return res.status(500).json({ error: 'failed to register print device' });
  }
});

app.get('/api/print/jobs', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId required' });
    }
    const token = getPrintTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { rows: deviceRows } = await query(
      'SELECT 1 FROM print_devices WHERE merchant_id = $1 AND token = $2',
      [merchantId, token]
    );
    if (deviceRows.length === 0) {
      return res.status(403).json({ error: 'invalid token' });
    }

    const { rows } = await query(
      `
      SELECT id, payload, created_at
      FROM print_jobs
      WHERE merchant_id = $1 AND status = $2
      ORDER BY created_at ASC
      `,
      [merchantId, PRINT_JOB_STATUS.pending]
    );
    const jobs = rows.map((row) => ({ id: row.id, ...(row.payload || {}) }));
    return res.json(jobs);
  } catch (error) {
    await logError({
      source: 'server',
      message: 'failed to fetch print jobs',
      stack: error?.stack,
      context: { route: 'GET /api/print/jobs' }
    });
    return res.status(500).json({ error: 'failed to fetch print jobs' });
  }
});

app.post('/api/print/jobs/:id/printed', async (req, res) => {
  try {
    const token = getPrintTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    let merchantId = getMerchantIdFromRequest(req);
    if (merchantId) {
      const { rows: deviceRows } = await query(
        'SELECT 1 FROM print_devices WHERE merchant_id = $1 AND token = $2',
        [merchantId, token]
      );
      if (deviceRows.length === 0) {
        return res.status(403).json({ error: 'invalid token' });
      }
    } else {
      const { rows } = await query('SELECT merchant_id FROM print_devices WHERE token = $1', [token]);
      if (rows.length === 0) {
        return res.status(403).json({ error: 'invalid token' });
      }
      merchantId = rows[0].merchant_id;
    }

    const { rowCount } = await query(
      `
      UPDATE print_jobs
      SET status = $1, printed_at = NOW()
      WHERE id = $2 AND merchant_id = $3 AND status = $4
      `,
      [PRINT_JOB_STATUS.printed, req.params.id, merchantId, PRINT_JOB_STATUS.pending]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'job not found' });
    }

    return res.json({ ok: true });
  } catch (error) {
    await logError({
      source: 'server',
      message: 'failed to mark print job',
      stack: error?.stack,
      context: { route: 'POST /api/print/jobs/:id/printed', jobId: req.params.id }
    });
    return res.status(500).json({ error: 'failed to mark print job' });
  }
});

// --- Auth ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role = 'CLIENT', profile = {} } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, role',
      [email, passwordHash, role]
    );

    const userId = rows[0].id;
    const profileSaved = await upsertProfile(userId, { email, role, ...profile, uid: userId });
    if (!profileSaved) {
      throw new Error('failed to create profile');
    }

    const token = signToken({ sub: userId, role: rows[0].role });
    const profileData = await getProfile(userId);

    res.json({ token, user: createUserResponse(userId, rows[0].role, profileData) });
  } catch (error) {
    console.error(error);
    await logError({
      source: 'server',
      message: 'failed to register',
      stack: error?.stack,
      context: { route: '/api/auth/register', email: req.body?.email }
    });
    res.status(500).json({ error: 'failed to register' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const { rows } = await query('SELECT id, password_hash, role FROM users WHERE email = $1', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const profileData = await getProfile(user.id);
    const token = signToken({ sub: user.id, role: user.role });
    res.json({ token, user: createUserResponse(user.id, user.role, profileData) });
  } catch (error) {
    console.error(error);
    await logError({
      source: 'server',
      message: 'failed to login',
      stack: error?.stack,
      context: { route: '/api/auth/login', email: req.body?.email }
    });
    res.status(500).json({ error: 'failed to login' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'missing token' });
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    const profileData = await getProfile(payload.sub);
    res.json({ user: createUserResponse(payload.sub, payload.role, profileData) });
  } catch (error) {
    await logError({
      source: 'server',
      message: 'invalid token',
      stack: error?.stack,
      context: { route: '/api/auth/me' }
    });
    res.status(401).json({ error: 'invalid token' });
  }
});

// --- Stores ---
app.get('/api/stores', async (req, res) => {
  const merchantId = getMerchantIdFromRequest(req);
  if (merchantId) {
    const store = await getStoreByMerchantId(merchantId);
    if (!store) return res.json([]);
    return res.json([mapRow(store)]);
  }

  const { rows } = await query('SELECT id, data FROM stores', []);
  res.json(mapRows(rows));
});

app.get('/api/stores/:id', async (req, res) => {
  const { rows } = await query('SELECT id, data FROM stores WHERE id = $1', [req.params.id]);
  const store = mapRow(rows[0]);
  if (!store) return res.status(404).json({ error: 'not found' });
  res.json(store);
});

app.post('/api/stores', async (req, res) => {
  const payload = req.body || {};
  const normalizedPayload = normalizeStoreRatings(payload);
  const address = {
    street: normalizedPayload.street,
    number: normalizedPayload.number,
    district: normalizedPayload.district,
    city: normalizedPayload.city,
    state: normalizedPayload.state
  };
  const resolvedCoords = await resolveCoordinatesForAddress(address, normalizedPayload.coordinates);
  if (!resolvedCoords) {
    return res.status(400).json({ error: 'invalid address or coordinates' });
  }
  normalizedPayload.coordinates = resolvedCoords;
  const { rows } = await query(
    'INSERT INTO stores (owner_id, city, data) VALUES ($1, $2, $3) RETURNING id',
    [normalizedPayload.ownerId || null, normalizedPayload.city || null, normalizedPayload]
  );
  res.json({ id: rows[0].id, ...normalizedPayload });
});

app.post('/api/stores/with-user', async (req, res) => {
  const payload = req.body || {};
  const ownerName = payload.ownerName || payload.storeName;
  const email = payload.email;
  const password = payload.password;
  const phone = payload.phone;
  const storeData = payload.store || {};

  if (!email || !password || !ownerName) {
    return res.status(400).json({ error: 'ownerName, email, and password are required' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'email already exists' });
  }

  const address = {
    street: storeData.street,
    number: storeData.number,
    district: storeData.district,
    city: storeData.city,
    state: storeData.state
  };
  const resolvedCoords = await resolveCoordinatesForAddress(address, storeData.coordinates);
  if (!resolvedCoords) {
    return res.status(400).json({ error: 'invalid address or coordinates' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await withClient(async (client) => {
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [email, passwordHash, 'BUSINESS']
    );
    const userId = userResult.rows[0].id;

    await client.query(
      'INSERT INTO profiles (user_id, data) VALUES ($1, $2)',
      [
        userId,
        {
          uid: userId,
          name: ownerName,
          email,
          role: 'BUSINESS',
          phone,
          city: storeData.city
        }
      ]
    );

    const fullStoreData = normalizeStoreRatings({
      ...storeData,
      coordinates: resolvedCoords,
      ownerId: userId,
      city: storeData.city,
      phone: storeData.whatsapp || storeData.phone || phone,
      email
    });

    await client.query(
      'INSERT INTO stores (owner_id, city, data) VALUES ($1, $2, $3)',
      [userId, fullStoreData.city || null, fullStoreData]
    );
  });

  res.json({ ok: true });
});

app.put('/api/stores/:id', async (req, res) => {
  const payload = req.body || {};
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const existing = rows[0].data || {};
  const merged = { ...existing, ...payload };
  const hasAddressUpdate = ['street', 'number', 'district', 'city', 'state'].some((key) => key in payload);
  const hasCoordsUpdate = 'coordinates' in payload;
  if (hasAddressUpdate || hasCoordsUpdate) {
    const address = {
      street: merged.street,
      number: merged.number,
      district: merged.district,
      city: merged.city,
      state: merged.state
    };
    const resolvedCoords = await resolveCoordinatesForAddress(address, merged.coordinates);
    if (!resolvedCoords) {
      return res.status(400).json({ error: 'invalid address or coordinates' });
    }
    merged.coordinates = resolvedCoords;
  }
  await query('UPDATE stores SET data = $1, city = $2 WHERE id = $3', [
    merged,
    merged.city || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...merged });
});

const updateStoreData = async (storeId, nextData) => {
  await query('UPDATE stores SET data = $1, city = $2 WHERE id = $3', [
    nextData,
    nextData.city || null,
    storeId
  ]);
};

app.get('/api/stores/:id/availability', async (req, res) => {
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const data = rows[0].data || {};
  const availability = resolveStoreAvailability(data);
  let nextData = data;

  if (availability.pauseExpired) {
    nextData = { ...nextData, pause: { ...(nextData.pause || {}), active: false } };
  }
  if (availability.autoOpenClose) {
    nextData = { ...nextData, isActive: availability.isOpen };
  }
  if (nextData !== data) {
    await updateStoreData(req.params.id, nextData);
  }

  res.json({
    storeId: req.params.id,
    isOpen: availability.isOpen,
    reason: availability.reason,
    scheduleOpen: availability.scheduleOpen,
    autoOpenClose: availability.autoOpenClose,
    pause: availability.pause,
    nextChangeAt: availability.nextChangeAt
  });
});

app.put('/api/stores/:id/schedule', async (req, res) => {
  const { schedule, autoOpenClose } = req.body || {};
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return res.status(400).json({ error: 'schedule must be a non-empty array' });
  }
  const normalized = normalizeSchedule(schedule);
  for (const entry of normalized) {
    const segments = getScheduleSegments(entry);
    for (const [start, end] of segments) {
      if (parseTimeToMinutes(start) === null || parseTimeToMinutes(end) === null) {
        return res.status(400).json({ error: 'invalid schedule time format' });
      }
    }
  }
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const existing = rows[0].data || {};
  const nextData = {
    ...existing,
    schedule: normalized,
    ...(typeof autoOpenClose === 'boolean' ? { autoOpenClose } : {})
  };
  await updateStoreData(req.params.id, nextData);
  res.json({ storeId: req.params.id, schedule: normalized, autoOpenClose: nextData.autoOpenClose || false });
});

app.put('/api/stores/:id/auto-accept', async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const existing = rows[0].data || {};
  const nextData = { ...existing, autoAcceptOrders: enabled };
  await updateStoreData(req.params.id, nextData);
  res.json({ storeId: req.params.id, autoAcceptOrders: enabled });
});

app.put('/api/stores/:id/auto-open', async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const existing = rows[0].data || {};
  const nextData = { ...existing, autoOpenClose: enabled };
  await updateStoreData(req.params.id, nextData);
  res.json({ storeId: req.params.id, autoOpenClose: enabled });
});

app.post('/api/stores/:id/pause', async (req, res) => {
  const { minutes, reason } = req.body || {};
  const pauseMinutes = Number(minutes);
  if (!Number.isFinite(pauseMinutes) || pauseMinutes <= 0) {
    return res.status(400).json({ error: 'minutes must be a number greater than 0' });
  }
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: 'reason required' });
  }
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const existing = rows[0].data || {};
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + pauseMinutes * 60 * 1000);
  const pause = {
    active: true,
    reason: reason.trim(),
    minutes: pauseMinutes,
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString()
  };
  const nextData = { ...existing, pause, isActive: false };
  await updateStoreData(req.params.id, nextData);
  res.json({ storeId: req.params.id, pause });
});

app.delete('/api/stores/:id/pause', async (req, res) => {
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const existing = rows[0].data || {};
  const availability = resolveStoreAvailability(existing);
  const nextData = {
    ...existing,
    pause: { ...(existing.pause || {}), active: false }
  };
  if (availability.autoOpenClose) {
    nextData.isActive = availability.scheduleOpen;
  } else {
    nextData.isActive = true;
  }
  await updateStoreData(req.params.id, nextData);
  res.json({ storeId: req.params.id, pause: nextData.pause });
});

app.get('/api/stores/:id/company-profile', async (req, res) => {
  const { rows } = await query('SELECT owner_id, data FROM stores WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const storeData = rows[0].data || {};
  const ownerId = rows[0].owner_id;
  const ownerProfile = ownerId ? await getProfile(ownerId) : null;
  res.json({
    storeId: req.params.id,
    store: storeData,
    owner: ownerProfile ? { id: ownerId, ...ownerProfile } : null
  });
});

app.post('/api/stores/:id/merchant-id', async (req, res) => {
  const storeId = req.params.id;
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [storeId]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const data = rows[0].data || {};
  if (data.merchantId) {
    return res.json({
      merchantId: data.merchantId,
      createdAt: data.merchantIdCreatedAt || null,
      status: 'existing'
    });
  }
  const merchantId = await generateUniqueMerchantId();
  const createdAt = new Date().toISOString();
  const nextData = {
    ...data,
    merchantId,
    merchantIdCreatedAt: createdAt,
    merchantIdRevokedAt: null
  };
  await query('UPDATE stores SET data = $1 WHERE id = $2', [nextData, storeId]);
  res.json({ merchantId, createdAt, status: 'created' });
});

app.delete('/api/stores/:id/merchant-id', async (req, res) => {
  const storeId = req.params.id;
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [storeId]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const data = rows[0].data || {};
  const revokedAt = new Date().toISOString();
  const nextData = {
    ...data,
    merchantId: null,
    merchantIdRevokedAt: revokedAt
  };
  await query('UPDATE stores SET data = $1 WHERE id = $2', [nextData, storeId]);
  res.json({ revokedAt });
});

app.delete('/api/stores/:id', async (req, res) => {
  const storeId = req.params.id;
  try {
    await withClient(async (client) => {
      const { rows } = await client.query('SELECT owner_id FROM stores WHERE id = $1', [storeId]);
      await client.query('DELETE FROM stores WHERE id = $1', [storeId]);

      const ownerId = rows[0]?.owner_id;
      if (!ownerId) return;

      const { rows: otherStores } = await client.query(
        'SELECT 1 FROM stores WHERE owner_id = $1 LIMIT 1',
        [ownerId]
      );
      if (otherStores.length > 0) return;

      const { rows: userRows } = await client.query('SELECT role FROM users WHERE id = $1', [ownerId]);
      if (userRows[0]?.role !== 'BUSINESS') return;

      await client.query('DELETE FROM profiles WHERE user_id = $1', [ownerId]);
      await client.query('DELETE FROM users WHERE id = $1', [ownerId]);
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to delete store' });
  }
});

// --- Store Requests ---
app.get('/api/store-requests', async (_req, res) => {
  const { rows } = await query('SELECT id, status, data, created_at FROM store_requests ORDER BY created_at DESC', []);
  const response = rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    ...row.data
  }));
  res.json(response);
});

app.get('/api/store-requests/:id', async (req, res) => {
  const { rows } = await query('SELECT id, status, data, created_at FROM store_requests WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const row = rows[0];
  res.json({ id: row.id, status: row.status, createdAt: row.created_at, ...row.data });
});

app.post('/api/store-requests', async (req, res) => {
  const payload = req.body || {};
  const { rows } = await query(
    'INSERT INTO store_requests (status, email, data) VALUES ($1, $2, $3) RETURNING id, created_at',
    ['PENDING', payload.email || null, payload]
  );
  res.json({ id: rows[0].id, status: 'PENDING', createdAt: rows[0].created_at, ...payload });
});

app.put('/api/store-requests/:id/approve', async (req, res) => {
  await query('UPDATE store_requests SET status = $1 WHERE id = $2', ['APPROVED', req.params.id]);
  res.json({ ok: true });
});

app.put('/api/store-requests/:id/reject', async (req, res) => {
  await query('UPDATE store_requests SET status = $1 WHERE id = $2', ['REJECTED', req.params.id]);
  res.json({ ok: true });
});

app.post('/api/store-requests/:id/finalize', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password required' });

  const { rows } = await query('SELECT id, status, data FROM store_requests WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const request = rows[0];
  if (request.status !== 'APPROVED') return res.status(400).json({ error: 'not approved' });

  const payload = request.data || {};
  const storeAddress = {
    street: payload.street,
    number: payload.number,
    district: payload.district,
    city: payload.city,
    state: payload.state
  };
  const resolvedCoords = await resolveCoordinatesForAddress(storeAddress, payload.coordinates);
  if (!resolvedCoords) {
    return res.status(400).json({ error: 'invalid address or coordinates' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await withClient(async (client) => {
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [payload.email, passwordHash, 'BUSINESS']
    );
    const userId = userResult.rows[0].id;

    await client.query(
      'INSERT INTO profiles (user_id, data) VALUES ($1, $2)',
      [
        userId,
        {
          uid: userId,
          name: payload.ownerName,
          email: payload.email,
          role: 'BUSINESS',
          phone: payload.phone,
          city: payload.city
        }
      ]
    );

    const storeData = {
      name: payload.storeName,
      category: 'Lanches',
      rating: 0,
      ratingCount: 0,
      deliveryTime: '30-40 min',
      pickupTime: '20-30 min',
      deliveryFee: 5,
      imageUrl: '',
      isPopular: false,
      isActive: true,
      coordinates: resolvedCoords,
      acceptsDelivery: true,
      acceptsPickup: true,
      acceptsTableOrders: false,
      tableCount: 0,
      logoUrl: payload.logoUrl || '',
      cep: payload.cep,
      street: payload.street,
      number: payload.number,
      district: payload.district,
      state: payload.state,
      complement: payload.complement,
      phone: payload.whatsapp || payload.phone,
      email: payload.email,
      city: payload.city,
      ownerId: userId
    };

    await client.query(
      'INSERT INTO stores (owner_id, city, data) VALUES ($1, $2, $3)',
      [userId, payload.city || null, storeData]
    );
  });

  res.json({ ok: true });
});

// --- Client Error Logs ---
app.post('/api/logs/client', async (req, res) => {
  try {
    const payload = req.body || {};
    await logError({
      source: 'client',
      level: payload.level || 'error',
      message: payload.message || 'Client error',
      stack: payload.stack,
      context: payload.context || {}
    });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to log client error' });
  }
});

// --- ImageKit ---
app.get('/api/imagekit/auth', requireAuth, (req, res) => {
  if (!imagekitPrivateKey) {
    return res.status(500).json({ error: 'imagekit not configured' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  const expire = Math.floor(Date.now() / 1000) + 60 * 30;
  const signature = crypto.createHmac('sha1', imagekitPrivateKey).update(token + expire).digest('hex');
  return res.json({ token, expire, signature });
});

app.delete('/api/imagekit/files/:fileId', requireAuth, async (req, res) => {
  if (!imagekitPrivateKey) {
    return res.status(500).json({ error: 'imagekit not configured' });
  }
  const fileId = String(req.params.fileId || '');
  if (!fileId) {
    return res.status(400).json({ error: 'file id required' });
  }

  try {
    const auth = Buffer.from(`${imagekitPrivateKey}:`).toString('base64');
    const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}` }
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: 'imagekit delete failed', details: text });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete ImageKit file', error);
    return res.status(500).json({ error: 'imagekit delete failed' });
  }
});

app.get('/api/logs', requireAdmin, async (req, res) => {
  try {
    const { source, level, search, from, to } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const conditions = [];
    const params = [];

    if (source) {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }
    if (level) {
      params.push(level);
      conditions.push(`level = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`message ILIKE $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`created_at <= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    params.push(offset);

    const { rows } = await query(
      `
      SELECT id, source, level, message, stack, context, resolved, created_at,
             COUNT(*) OVER() AS total_count
      FROM error_logs
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );

    const total = rows[0] ? Number(rows[0].total_count) : 0;
    const items = rows.map((row) => ({
      id: row.id,
      source: row.source,
      level: row.level,
      message: row.message,
      stack: row.stack,
      context: row.context || {},
      createdAt: row.created_at,
      resolved: row.resolved
    }));

    res.json({ items, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to load logs' });
  }
});

// --- MenuFaz AI ---
app.post('/api/ai/recommendation', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.json({
        suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
        recommendedProducts: []
      });
    }
    if (!geminiApiKey) {
      return res.status(503).json({
        suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
        recommendedProducts: []
      });
    }

    const { rows } = await query(
      `
      SELECT p.id, p.store_id, p.data, s.data AS store_data
      FROM products p
      JOIN stores s ON s.id = p.store_id
      ORDER BY p.created_at DESC
      LIMIT 200
      `,
      []
    );
    const products = rows
      .map((row) => {
        const product = row.data || {};
        const storeData = row.store_data || {};
        if (storeData.isActive === false) return null;
        if (product.isAvailable === false) return null;
        return {
          productId: row.id,
          storeId: row.store_id,
          productName: product.name || '',
          description: product.description || '',
          category: product.category || '',
          price: product.promoPrice || product.price || 0,
          storeName: storeData.name || '',
          storeCategory: storeData.category || ''
        };
      })
      .filter(Boolean)
      .filter((item) => item.productName);

    if (products.length === 0) {
      return res.json({
        suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
        recommendedProducts: []
      });
    }

    const promptText = `
Voce e o MenuFazAI. Use SOMENTE os produtos informados.
Sugira ate 3 itens que combinem com o pedido do cliente.
Se nenhum produto servir, responda com:
suggestion: "As lojas ainda estao trabalhando para atender a esse pedido."
e recommendedProducts: []

Responda em JSON com este formato:
{
  "suggestion": "texto curto e direto",
  "recommendedCategory": "categoria opcional",
  "recommendedProducts": [
    { "productId": "id", "productName": "nome", "storeId": "id", "storeName": "nome" }
  ]
}

Pedido do cliente: "${prompt}"
Produtos:
${JSON.stringify(products)}
    `.trim();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
        recommendedProducts: []
      });
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ||
      '';

    let parsed;
    try {
      parsed = typeof text === 'string' ? JSON.parse(text) : text;
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return res.json({
        suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
        recommendedProducts: []
      });
    }

    const normalizedProducts = Array.isArray(parsed.recommendedProducts)
      ? parsed.recommendedProducts
          .map((item) => {
            const productId = String(item.productId || '');
            const storeId = String(item.storeId || '');
            const match = products.find(
              (p) => p.productId === productId && p.storeId === storeId
            );
            if (!match) return null;
            return {
              productId: match.productId,
              productName: match.productName,
              storeId: match.storeId,
              storeName: match.storeName
            };
          })
          .filter(Boolean)
      : [];

    if (normalizedProducts.length === 0) {
      return res.json({
        suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
        recommendedProducts: []
      });
    }

    return res.json({
      suggestion: parsed.suggestion || 'Sugestao do MenuFazAI',
      recommendedCategory: parsed.recommendedCategory || '',
      recommendedProducts: normalizedProducts
    });
  } catch (error) {
    console.error('AI recommendation failed', error);
    res.status(500).json({
      suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
      recommendedProducts: []
    });
  }
});

app.put('/api/logs/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const logId = String(req.params.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(logId)) {
      return res.status(400).json({ error: 'invalid log id' });
    }
    const resolved = req.body?.resolved !== false;
    const { rows } = await query(
      'UPDATE error_logs SET resolved = $1 WHERE id = $2 RETURNING id',
      [resolved, logId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, resolved });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to update log' });
  }
});

app.delete('/api/logs', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM error_logs', []);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to clear logs' });
  }
});

// --- Products ---
app.get('/api/products', async (req, res) => {
  const storeId = req.query.storeId;
  const { rows } = await query(
    storeId ? 'SELECT id, data FROM products WHERE store_id = $1' : 'SELECT id, data FROM products',
    storeId ? [storeId] : []
  );
  res.json(mapRows(rows).map(stripSplitSurcharge));
});

app.post('/api/products', async (req, res) => {
  const payload = stripSplitSurcharge(req.body || {});
  const { rows } = await query(
    'INSERT INTO products (store_id, data) VALUES ($1, $2) RETURNING id',
    [payload.storeId || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
});

app.post('/api/products/bulk', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'items required' });

  try {
    await withClient(async (client) => {
      for (const item of items) {
        const payload = stripSplitSurcharge(item);
        await client.query('INSERT INTO products (store_id, data) VALUES ($1, $2)', [
          payload.storeId || null,
          payload
        ]);
      }
    });
    res.json({ inserted: items.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to import products' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const payload = stripSplitSurcharge(req.body || {});
  await query('UPDATE products SET data = $1, store_id = $2 WHERE id = $3', [
    payload,
    payload.storeId || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...payload });
});

app.delete('/api/products/:id', async (req, res) => {
  await query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Pizza Flavors ---
app.get('/api/pizza-flavors', async (req, res) => {
  const storeId = req.query.storeId;
  const { rows } = await query(
    storeId ? 'SELECT id, data FROM pizza_flavors WHERE store_id = $1' : 'SELECT id, data FROM pizza_flavors',
    storeId ? [storeId] : []
  );
  res.json(mapRows(rows));
});

app.post('/api/pizza-flavors', async (req, res) => {
  const payload = req.body || {};
  payload.pricesBySize = normalizeFlavorPricesBySize(payload.pricesBySize);
  const { rows } = await query(
    'INSERT INTO pizza_flavors (store_id, data) VALUES ($1, $2) RETURNING id',
    [payload.storeId || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
});

app.put('/api/pizza-flavors/:id', async (req, res) => {
  const payload = req.body || {};
  payload.pricesBySize = normalizeFlavorPricesBySize(payload.pricesBySize);
  await query('UPDATE pizza_flavors SET data = $1, store_id = $2 WHERE id = $3', [
    payload,
    payload.storeId || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...payload });
});

app.delete('/api/pizza-flavors/:id', async (req, res) => {
  await query('DELETE FROM pizza_flavors WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Coupons ---
app.get('/api/coupons', async (req, res) => {
  const storeId = req.query.storeId;
  const { rows } = await query(
    storeId ? 'SELECT id, data FROM coupons WHERE store_id = $1' : 'SELECT id, data FROM coupons',
    storeId ? [storeId] : []
  );
  res.json(mapRows(rows));
});

app.post('/api/coupons', async (req, res) => {
  const payload = req.body || {};
  const { rows } = await query(
    'INSERT INTO coupons (store_id, data) VALUES ($1, $2) RETURNING id',
    [payload.storeId || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
});

app.put('/api/coupons/:id', async (req, res) => {
  const payload = req.body || {};
  await query('UPDATE coupons SET data = $1, store_id = $2 WHERE id = $3', [
    payload,
    payload.storeId || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...payload });
});

app.delete('/api/coupons/:id', async (req, res) => {
  await query('DELETE FROM coupons WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Geocoding (Nominatim fallback) ---
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const NOMINATIM_TIMEOUT_MS = 6000;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

const mapNominatimAddress = (address = {}, displayName = '') => {
  const street = address.road || address.pedestrian || address.path || displayName.split(',')[0] || '';
  const number = address.house_number || '';
  const district = address.suburb || address.neighbourhood || address.quarter || '';
  const city =
    address.city || address.town || address.village || address.municipality || address.county || '';
  const state = address.state || '';
  let fullText = street;
  if (number) fullText += `, ${number}`;
  if (district) fullText += ` - ${district}`;
  if (city) fullText += ` - ${city}`;
  if (!fullText.trim()) fullText = displayName || '';
  return { street, number, district, city, state, fullText };
};

const mapGoogleAddress = (result = {}) => {
  const components = Array.isArray(result.address_components) ? result.address_components : [];
  let street = '';
  let number = '';
  let district = '';
  let city = '';
  let state = '';
  components.forEach((comp) => {
    const types = comp.types || [];
    if (types.includes('route')) street = comp.long_name || street;
    if (types.includes('street_number')) number = comp.long_name || number;
    if (types.includes('sublocality') || types.includes('sublocality_level_1')) {
      district = comp.long_name || district;
    }
    if (types.includes('administrative_area_level_2')) city = comp.long_name || city;
    if (types.includes('administrative_area_level_1')) state = comp.short_name || state;
  });
  if (!street && result.formatted_address) {
    street = result.formatted_address.split(',')[0];
  }
  let fullText = street;
  if (number) fullText += `, ${number}`;
  if (district) fullText += ` - ${district}`;
  if (city) fullText += ` - ${city}`;
  if (!fullText.trim()) fullText = result.formatted_address || '';
  return { street, number, district, city, state, fullText };
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeQuery = (value = '') =>
  value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const DEFAULT_COORDS = { lat: -23.561684, lng: -46.655981 };
const COORDS_EPSILON = 0.00001;

const isValidCoords = (coords) =>
  coords &&
  typeof coords.lat === 'number' &&
  typeof coords.lng === 'number' &&
  Number.isFinite(coords.lat) &&
  Number.isFinite(coords.lng);

const isFallbackCoords = (coords) =>
  isValidCoords(coords) &&
  Math.abs(coords.lat - DEFAULT_COORDS.lat) < COORDS_EPSILON &&
  Math.abs(coords.lng - DEFAULT_COORDS.lng) < COORDS_EPSILON;

const hasAddressFields = (address = {}) =>
  [address.street, address.number, address.district, address.city, address.state]
    .map((value) => String(value || '').trim())
    .some(Boolean);

const buildAddressQuery = (address = {}) => {
  const parts = [address.street, address.number, address.district, address.city, address.state]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.join(', ');
};

const fetchGoogleGeocode = async ({ address, lat, lng } = {}) => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const params = new URLSearchParams({
    key: GOOGLE_MAPS_API_KEY,
    language: 'pt-BR',
    region: 'br'
  });
  if (address) params.set('address', address);
  if (typeof lat === 'number' && typeof lng === 'number') {
    params.set('latlng', `${lat},${lng}`);
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.status !== 'OK' || !Array.isArray(data.results)) {
      if (data?.status && data.status !== 'ZERO_RESULTS') {
        console.warn('Google geocode status', data.status, data.error_message || '');
      }
      return null;
    }
    return data.results;
  } catch (error) {
    console.warn('Google geocode failed', error);
    return null;
  }
};

const geocodeAddressCoordinates = async (address = {}) => {
  const queryText = buildAddressQuery(address);
  if (!queryText) return null;
  const googleResults = await fetchGoogleGeocode({ address: queryText });
  if (googleResults && googleResults.length) {
    const location = googleResults[0]?.geometry?.location;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  const normalized = normalizeQuery(queryText);
  const candidates = [queryText];
  if (normalized && normalized !== queryText) candidates.push(normalized);
  candidates.push(`${queryText} Brasil`);
  if (normalized && normalized !== queryText) candidates.push(`${normalized} Brasil`);

  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const data = await fetchNominatimSearch({ queryText: candidate });
    if (!data.length) continue;
    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  return null;
};

const resolveCoordinatesForAddress = async (address = {}, coords) => {
  if (isValidCoords(coords) && !isFallbackCoords(coords)) return coords;
  if (!hasAddressFields(address)) return null;
  return geocodeAddressCoordinates(address);
};

const fetchNominatimSearch = async ({ queryText, postalcode } = {}) => {
  if (!queryText && !postalcode) return [];
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '8',
    countrycodes: 'br'
  });
  if (queryText) params.set('q', queryText);
  if (postalcode) params.set('postalcode', postalcode);
  const url = `${NOMINATIM_BASE_URL}/search?${params.toString()}`;
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept-Language': 'pt-BR',
        'User-Agent': 'MenuFaz/1.0 (contato@app.menufaz.com)'
      }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('Nominatim search failed', error);
    return [];
  }
};

const fetchCepData = async (cep) => {
  const cleanCep = String(cep || '').replace(/\D/g, '');
  if (cleanCep.length !== 8) return null;
  try {
    const response = await fetchWithTimeout(`https://viacep.com.br/ws/${cleanCep}/json/`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.erro) return null;
    return {
      street: data.logradouro,
      district: data.bairro,
      city: data.localidade,
      state: data.uf,
      fullText: `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`,
      cep: cleanCep
    };
  } catch (error) {
    console.warn('ViaCEP lookup failed', error);
    return null;
  }
};

app.get('/api/geocode/search', async (req, res) => {
  const queryText = String(req.query.q || '').trim();
  if (!queryText) return res.json([]);
  try {
    const normalized = normalizeQuery(queryText);
    const queries = [];
    const seenQueries = new Set();
    const addQuery = (value) => {
      const cleanValue = String(value || '').trim();
      if (!cleanValue) return;
      const key = `q:${cleanValue.toLowerCase()}`;
      if (seenQueries.has(key)) return;
      seenQueries.add(key);
      queries.push({ queryText: cleanValue });
    };
    const addPostal = (postal) => {
      const cleanPostal = String(postal || '').replace(/\D/g, '');
      if (cleanPostal.length !== 8) return;
      const key = `p:${cleanPostal}`;
      if (seenQueries.has(key)) return;
      seenQueries.add(key);
      queries.push({ postalcode: cleanPostal });
    };

    const cepData = await fetchCepData(queryText);
    if (cepData?.fullText) addQuery(cepData.fullText);
    if (cepData?.cep) addPostal(cepData.cep);
    if (queryText.replace(/\D/g, '').length === 8) addPostal(queryText);

    addQuery(queryText);
    if (normalized && normalized !== queryText) addQuery(normalized);
    addQuery(`${queryText} Brasil`);
    if (normalized && normalized !== queryText) addQuery(`${normalized} Brasil`);

    const seen = new Set();
    const results = [];

    if (GOOGLE_MAPS_API_KEY) {
      const googleResults = await fetchGoogleGeocode({ address: queryText });
      if (googleResults) {
        for (const item of googleResults) {
          const mapped = mapGoogleAddress(item);
          const location = item?.geometry?.location;
          const lat = Number(location?.lat);
          const lng = Number(location?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const key = `${lat},${lng},${mapped.fullText}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            street: mapped.street,
            district: mapped.district
              ? `${mapped.district}${mapped.city ? ` - ${mapped.city}` : ''}`
              : mapped.city,
            fullAddress: mapped.fullText,
            coordinates: { lat, lng },
            city: mapped.city,
            state: mapped.state
          });
          if (results.length >= 6) break;
        }
      }
    }

    if (results.length < 6) {
      for (const query of queries) {
        const data = await fetchNominatimSearch(query);
        for (const item of data) {
          const mapped = mapNominatimAddress(item.address || {}, item.display_name || '');
          const key = `${item.lat},${item.lon},${mapped.fullText}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            street: mapped.street,
            district: mapped.district
              ? `${mapped.district}${mapped.city ? ` - ${mapped.city}` : ''}`
              : mapped.city,
            fullAddress: mapped.fullText,
            coordinates: {
              lat: Number(item.lat),
              lng: Number(item.lon)
            },
            city: mapped.city,
            state: mapped.state
          });
          if (results.length >= 6) break;
        }
        if (results.length >= 6) break;
      }
    }

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to geocode search' });
  }
});

app.get('/api/geocode/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat/lng required' });
  }
  try {
    if (GOOGLE_MAPS_API_KEY) {
      const googleResults = await fetchGoogleGeocode({ lat, lng });
      if (googleResults && googleResults.length) {
        const mapped = mapGoogleAddress(googleResults[0]);
        return res.json(mapped);
      }
    }
    const url = `${NOMINATIM_BASE_URL}/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lng)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept-Language': 'pt-BR',
        'User-Agent': 'MenuFaz/1.0 (contato@app.menufaz.com)'
      }
    });
    if (!response.ok) return res.json(null);
    const data = await response.json();
    if (!data || !data.address) return res.json(null);
    const mapped = mapNominatimAddress(data.address || {}, data.display_name || '');
    res.json(mapped);
  } catch (error) {
    console.warn('Nominatim reverse failed', error);
    res.json(null);
  }
});

// --- Favorites ---
app.get('/api/favorites', async (req, res) => {
  const payload = getAuthPayload(req);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  const { rows } = await query('SELECT store_id FROM favorites WHERE user_id = $1', [payload.sub]);
  res.json(rows.map((row) => row.store_id));
});

app.post('/api/favorites', async (req, res) => {
  const payload = getAuthPayload(req);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  const storeId = req.body?.storeId;
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  await query(
    'INSERT INTO favorites (user_id, store_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [payload.sub, storeId]
  );
  res.json({ ok: true });
});

app.delete('/api/favorites/:storeId', async (req, res) => {
  const payload = getAuthPayload(req);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  await query('DELETE FROM favorites WHERE user_id = $1 AND store_id = $2', [
    payload.sub,
    req.params.storeId
  ]);
  res.json({ ok: true });
});

// --- Search ---
app.get('/api/search', async (req, res) => {
  const rawQuery = String(req.query.q || '').trim();
  if (!rawQuery || rawQuery.length < 2) {
    return res.json({ stores: [], products: [] });
  }
  const safeQuery = rawQuery.toLowerCase().replace(/[%_]/g, '\\$&');
  const term = `%${safeQuery}%`;

  try {
    const storeQuery = `
      SELECT id, data
      FROM stores
      WHERE lower(data->>'name') LIKE $1 ESCAPE '\\'
         OR lower(data->>'category') LIKE $1 ESCAPE '\\'
      ORDER BY data->>'name' ASC
      LIMIT 8
    `;
    const productQuery = `
      SELECT p.id, p.store_id, p.data, s.data AS store_data
      FROM products p
      JOIN stores s ON s.id = p.store_id
      WHERE lower(p.data->>'name') LIKE $1 ESCAPE '\\'
         OR lower(p.data->>'description') LIKE $1 ESCAPE '\\'
      ORDER BY p.created_at DESC
      LIMIT 10
    `;

    const [storesResult, productsResult] = await Promise.all([
      query(storeQuery, [term]),
      query(productQuery, [term])
    ]);

    const stores = storesResult.rows.map((row) => {
      const payload = row.data || {};
      return {
        id: row.id,
        name: payload.name,
        category: payload.category,
        imageUrl: payload.imageUrl,
        logoUrl: payload.logoUrl
      };
    });

    const products = productsResult.rows.map((row) => {
      const payload = row.data || {};
      const storeData = row.store_data || {};
      return {
        id: row.id,
        name: payload.name,
        description: payload.description,
        storeId: row.store_id,
        storeName: storeData.name,
        storeCategory: storeData.category,
        storeImageUrl: storeData.imageUrl,
        storeLogoUrl: storeData.logoUrl
      };
    });

    res.json({ stores, products });
  } catch (error) {
    console.error('Search failed', error);
    res.json({ stores: [], products: [] });
  }
});

// --- Reviews ---
app.get('/api/reviews', async (req, res) => {
  const storeId = req.query.storeId;
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  const { rows } = await query(
    'SELECT id, data, created_at FROM reviews WHERE store_id = $1 ORDER BY created_at DESC',
    [storeId]
  );
  const response = rows.map((row) => ({ id: row.id, createdAt: row.created_at, ...row.data }));
  res.json(response);
});

app.post('/api/reviews', async (req, res) => {
  const payload = req.body || {};
  const storeId = payload.storeId;
  const rating = Number(payload.rating);
  const comment = (payload.comment || '').trim();
  if (!storeId || !Number.isFinite(rating) || rating < 1 || rating > 5 || !comment) {
    return res.status(400).json({ error: 'storeId, rating (1-5), and comment required' });
  }

  const authPayload = getAuthPayload(req);
  const profileData = authPayload ? await getProfile(authPayload.sub) : null;
  const userName =
    (payload.userName || '').trim() ||
    (profileData?.name || '').trim() ||
    (profileData?.email || '').trim() ||
    'Cliente';

  const reviewData = {
    storeId,
    userName,
    rating,
    comment,
    date: new Date().toISOString()
  };

  try {
    let reviewRow = null;
    await withClient(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO reviews (store_id, data) VALUES ($1, $2) RETURNING id, created_at',
        [storeId, reviewData]
      );
      reviewRow = rows[0];
      await refreshStoreRating(client, storeId);
    });
    res.json({ id: reviewRow.id, createdAt: reviewRow.created_at, ...reviewData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'failed to add review' });
  }
});

// --- Couriers ---
app.get('/api/couriers', async (req, res) => {
  const storeId = req.query.storeId;
  const { rows } = await query(
    storeId ? 'SELECT id, data FROM couriers WHERE store_id = $1' : 'SELECT id, data FROM couriers',
    storeId ? [storeId] : []
  );
  res.json(mapRows(rows));
});

app.post('/api/couriers', async (req, res) => {
  const payload = req.body || {};
  const { rows } = await query(
    'INSERT INTO couriers (store_id, data) VALUES ($1, $2) RETURNING id',
    [payload.storeId || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
});

app.put('/api/couriers/:id', async (req, res) => {
  const payload = req.body || {};
  await query('UPDATE couriers SET data = $1, store_id = $2 WHERE id = $3', [
    payload,
    payload.storeId || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...payload });
});

app.delete('/api/couriers/:id', async (req, res) => {
  await query('DELETE FROM couriers WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.put('/api/couriers/:id/location', async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  await query(
    `
    INSERT INTO courier_locations (courier_id, lat, lng)
    VALUES ($1, $2, $3)
    ON CONFLICT (courier_id)
    DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = NOW()
    `,
    [req.params.id, lat, lng]
  );
  res.json({ ok: true });
});

app.get('/api/couriers/:id/location', async (req, res) => {
  const { rows } = await query(
    'SELECT lat, lng, updated_at FROM courier_locations WHERE courier_id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.json(null);
  res.json({ lat: rows[0].lat, lng: rows[0].lng, updatedAt: rows[0].updated_at });
});

// --- Expenses ---
app.get('/api/expenses', async (req, res) => {
  const storeId = req.query.storeId;
  const { rows } = await query(
    storeId ? 'SELECT id, data FROM expenses WHERE store_id = $1' : 'SELECT id, data FROM expenses',
    storeId ? [storeId] : []
  );
  res.json(mapRows(rows));
});

app.post('/api/expenses', async (req, res) => {
  const payload = req.body || {};
  const { rows } = await query(
    'INSERT INTO expenses (store_id, data) VALUES ($1, $2) RETURNING id',
    [payload.storeId || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
});

app.put('/api/expenses/:id', async (req, res) => {
  const payload = req.body || {};
  await query('UPDATE expenses SET data = $1, store_id = $2 WHERE id = $3', [
    payload,
    payload.storeId || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...payload });
});

app.delete('/api/expenses/:id', async (req, res) => {
  await query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Orders ---
app.get('/api/orders', async (req, res) => {
  const { storeId, userId, courierId, status, city, tableNumber, tableSessionId, customerId, customerPhone } = req.query;
  const conditions = [];
  const params = [];

  if (storeId) {
    params.push(storeId);
    conditions.push(`store_id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }
  if (courierId) {
    params.push(courierId);
    conditions.push(`courier_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (city) {
    params.push(city);
    conditions.push(`store_city = $${params.length}`);
  }
  if (tableNumber) {
    params.push(String(tableNumber));
    conditions.push(`data->>'tableNumber' = $${params.length}`);
  }
  if (tableSessionId) {
    params.push(String(tableSessionId));
    conditions.push(`data->>'tableSessionId' = $${params.length}`);
  }
  if (customerId) {
    params.push(String(customerId));
    conditions.push(`data->>'customerId' = $${params.length}`);
  }
  if (customerPhone) {
    params.push(String(customerPhone));
    conditions.push(`data->>'customerPhone' = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT id, status, store_id, store_city, created_at, data FROM orders ${where} ORDER BY created_at DESC`,
    params
  );
  res.json(parseOrderRows(rows));
});

app.post('/api/orders', async (req, res) => {
  const payload = req.body || {};
  let status = payload.status || 'PENDING';
  let customerId = payload.customerId || null;
  const deliveryAddress = payload.deliveryAddress || null;
  const customerPhone = payload.customerPhone ? String(payload.customerPhone) : '';
  const customerName = payload.customerName ? String(payload.customerName) : '';

  if (deliveryAddress) {
    const currentCoords = payload.deliveryCoordinates || deliveryAddress.coordinates;
    const hasValidCoords = isValidCoords(currentCoords) && !isFallbackCoords(currentCoords);
    if (!hasValidCoords) {
      const resolvedCoords = await geocodeAddressCoordinates(deliveryAddress);
      if (resolvedCoords) {
        payload.deliveryCoordinates = resolvedCoords;
        payload.deliveryAddress = { ...deliveryAddress, coordinates: resolvedCoords };
      } else {
        return res.status(400).json({
          error: 'delivery coordinates required',
          detail: 'Provide valid deliveryCoordinates or an address that can be geocoded.'
        });
      }
    }
  }

  if (customerPhone && deliveryAddress?.street && deliveryAddress?.number) {
    await query(
      `
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT,
        phone TEXT NOT NULL,
        street TEXT NOT NULL,
        number TEXT NOT NULL,
        district TEXT,
        city TEXT,
        state TEXT,
        complement TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      `
    );
    await query(
      'CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_address ON customers (phone, street, number);'
    );
    const { rows: customerRows } = await query(
      `
      INSERT INTO customers (name, phone, street, number, district, city, state, complement)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (phone, street, number)
      DO UPDATE SET
        name = EXCLUDED.name,
        district = EXCLUDED.district,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        complement = EXCLUDED.complement,
        updated_at = NOW()
      RETURNING id
      `,
      [
        customerName || 'Cliente',
        customerPhone,
        deliveryAddress.street,
        deliveryAddress.number,
        deliveryAddress.district || null,
        deliveryAddress.city || null,
        deliveryAddress.state || null,
        deliveryAddress.complement || null
      ]
    );
    if (customerRows[0]?.id) {
      customerId = customerRows[0].id;
    }
  }

  if (customerId) {
    payload.customerId = customerId;
  }

  const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  if (lineItems.length > 0) {
    try {
      const productIds = Array.from(
        new Set(lineItems.map((item) => item?.productId).filter(Boolean))
      );
      const productMap = new Map();
      if (productIds.length > 0) {
        const { rows: productRows } = await query(
          'SELECT id, data FROM products WHERE id = ANY($1::uuid[])',
          [productIds]
        );
        productRows.forEach((row) => productMap.set(row.id, row.data || {}));
      }

      const flavorIds = Array.from(
        new Set(
          lineItems
            .flatMap((item) => item?.pizza?.flavors || [])
            .map((entry) => entry?.flavorId)
            .filter(Boolean)
        )
      );
      const flavorMap = new Map();
      if (flavorIds.length > 0) {
        const { rows: flavorRows } = await query(
          'SELECT id, data FROM pizza_flavors WHERE id = ANY($1::uuid[])',
          [flavorIds]
        );
        flavorRows.forEach((row) => flavorMap.set(row.id, row.data || {}));
      }

      const updatedLineItems = lineItems.map((item) => {
        if (!item?.productId) return item;
        const product = productMap.get(item.productId);
        if (!product || !product.isPizza || !item.pizza) return item;

        const pizzaData = item.pizza || {};
        const splitCount = Math.max(1, Math.min(5, Number(pizzaData.splitCount || 1)));
        const flavors = Array.isArray(pizzaData.flavors) ? pizzaData.flavors : [];
        if (flavors.length !== splitCount) {
          throw new Error('invalid pizza flavors');
        }

        const flavorIds = flavors.map((entry) => entry?.flavorId).filter(Boolean);
        if (flavorIds.length !== splitCount) {
          throw new Error('invalid pizza flavors');
        }
        const uniqueFlavorIds = new Set(flavorIds);
        if (uniqueFlavorIds.size !== flavorIds.length) {
          throw new Error('duplicate pizza flavors');
        }
        const hasMissingFlavor = flavorIds.some((id) => !flavorMap.has(id));
        if (hasMissingFlavor) {
          throw new Error('invalid pizza flavor');
        }

        if (Array.isArray(product.availableFlavorIds) && product.availableFlavorIds.length > 0) {
          const allowed = new Set(product.availableFlavorIds);
          const hasInvalid = flavorIds.some((id) => !allowed.has(id));
          if (hasInvalid) {
            throw new Error('invalid pizza flavor');
          }
        }

        const sizeOptionId =
          pizzaData.sizeOptionId ||
          (typeof pizzaData.sizeKeyOrSizeOptionId === 'string' ? pizzaData.sizeKeyOrSizeOptionId : '');
        const sizeOption = getSizeOptionById(product, sizeOptionId);
        const sizeKeyCandidate =
          resolveSizeKey(pizzaData.sizeKey || '') ||
          resolveSizeKey(pizzaData.sizeKeyOrSizeOptionId || '');
        const sizeKey =
          sizeKeyCandidate ||
          resolveSizeKey(sizeOption?.name || '') ||
          '';

        if (sizeOption && sizeOption.isAvailable === false) {
          throw new Error('pizza size unavailable');
        }

        if (product.priceMode === 'BY_SIZE' && !sizeOption) {
          throw new Error('pizza size required');
        }

        const maxBySize = product.maxFlavorsBySize || {};
        const maxAllowed = Math.max(
          1,
          Math.min(5, Number(sizeKey && maxBySize[sizeKey] ? maxBySize[sizeKey] : product.maxFlavors || 1))
        );
        if (splitCount > maxAllowed) {
          throw new Error('pizza flavor limit exceeded');
        }

        const pricingStrategy = resolvePizzaPricingStrategy(product, pizzaData.pricingStrategySelected);
        let baseNormal = Number(product.promoPrice ?? product.price ?? 0);
        if (product.priceMode === 'BY_SIZE') {
          baseNormal = Number(sizeOption?.price ?? 0);
        }

        const flavorPrices = flavorIds.map((id) => getFlavorPriceForSize(flavorMap.get(id), sizeKey, sizeOptionId));
        const hasMissingFlavorPrice = flavorPrices.some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0);
        if (hasMissingFlavorPrice) {
          throw new Error('pizza flavor missing price for size');
        }
        const hasFlavorPrices = flavorPrices.length > 0;
        const avgFlavorPrice = hasFlavorPrices
          ? flavorPrices.reduce((sum, value) => sum + value, 0) / flavorPrices.length
          : 0;
        const maxFlavorPrice = hasFlavorPrices ? Math.max(...flavorPrices) : 0;

        let basePrice = baseNormal;
        if (pricingStrategy === 'PROPORCIONAL') {
          if (avgFlavorPrice <= 0) {
            throw new Error('pizza flavor missing price for size');
          }
          basePrice = avgFlavorPrice;
        } else if (pricingStrategy === 'MAX') {
          if (maxFlavorPrice <= 0) {
            throw new Error('pizza flavor missing price for size');
          }
          basePrice = maxFlavorPrice;
        }

        const optionsTotal = Array.isArray(item.options)
          ? item.options.reduce((sum, option) => sum + Number(option?.price || 0), 0)
          : 0;

        const quantity = Math.max(1, Number(item.quantity || 1));
        const unitPrice = basePrice + optionsTotal;
        const totalPrice = unitPrice * quantity;

        return {
          ...item,
          unitPrice,
          totalPrice,
          pizza: {
            splitCount,
            flavors: flavorIds.map((id) => ({ flavorId: id, fraction: 1 / splitCount })),
            sizeKeyOrSizeOptionId: sizeOptionId || sizeKey || undefined,
            sizeKey: sizeKey || undefined,
            sizeOptionId: sizeOptionId || undefined,
            pricingStrategySelected: pricingStrategy
          }
        };
      });

      payload.lineItems = updatedLineItems;
      const subtotal = updatedLineItems.reduce((sum, line) => sum + Number(line?.totalPrice || 0), 0);
      const deliveryFee = Number(payload.deliveryFee || 0);
      payload.total = subtotal + deliveryFee;
    } catch (error) {
      return res.status(400).json({
        error: 'invalid pizza order',
        detail: error?.message || String(error)
      });
    }
  }

  if (payload.storeId) {
    const { rows: storeRows } = await query('SELECT data FROM stores WHERE id = $1', [payload.storeId]);
    const storeData = storeRows[0]?.data || {};
    if (storeData.autoAcceptOrders && status === 'PENDING') {
      status = 'PREPARING';
      payload.autoAccepted = true;
      payload.autoAcceptedAt = new Date().toISOString();
    }
  }
  const { rows } = await query(
    `
    INSERT INTO orders (store_id, user_id, courier_id, status, store_city, data)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, created_at
    `,
    [
      payload.storeId || null,
      payload.userId || null,
      payload.courierId || null,
      status,
      payload.storeCity || null,
      payload
    ]
  );
  res.json({ id: rows[0].id, status, createdAt: rows[0].created_at, ...payload });
});

app.put('/api/orders/:id/assign', async (req, res) => {
  const { courierId } = req.body || {};
  if (!courierId) return res.status(400).json({ error: 'courierId required' });
  const { rows } = await query('SELECT data FROM orders WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const nextData = { ...(rows[0].data || {}), courierStage: 'ASSIGNED' };
  await query('UPDATE orders SET courier_id = $1, status = $2, data = $3 WHERE id = $4', [
    courierId,
    'DELIVERING',
    nextData,
    req.params.id
  ]);
  res.json({ ok: true });
});

app.put('/api/orders/:id/status', async (req, res) => {
  const { status, reason } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status required' });
  const resolvedStatus = await resolvePickupStatus(req.params.id, null, status);
  if (reason && status === 'CANCELLED') {
    const { rows } = await query('SELECT data FROM orders WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    const data = { ...(rows[0].data || {}), cancelReason: String(reason) };
    await query('UPDATE orders SET status = $1, data = $2 WHERE id = $3', [resolvedStatus, data, req.params.id]);
    return res.json({ ok: true });
  }
  await query('UPDATE orders SET status = $1 WHERE id = $2', [resolvedStatus, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/orders/:id/courier-stage', async (req, res) => {
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: 'stage required' });
  const { rows } = await query('SELECT data FROM orders WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const nextData = { ...(rows[0].data || {}), courierStage: stage };
  await query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/orders/:id/refund', async (req, res) => {
  const { refundStatus, refundReason } = req.body || {};
  const { rows } = await query('SELECT data FROM orders WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const data = { ...(rows[0].data || {}), refundStatus, refundReason };
  await query('UPDATE orders SET data = $1 WHERE id = $2', [data, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/orders/:id/chat', async (req, res) => {
  const { chat } = req.body || {};
  const { rows } = await query('SELECT data FROM orders WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const data = { ...(rows[0].data || {}), chat };
  await query('UPDATE orders SET data = $1 WHERE id = $2', [data, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/orders/:id/payment', async (req, res) => {
  const { paymentMethod } = req.body || {};
  if (!paymentMethod) return res.status(400).json({ error: 'paymentMethod required' });
  const { rows } = await query('SELECT data FROM orders WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const data = { ...(rows[0].data || {}), paymentMethod };
  await query('UPDATE orders SET data = $1 WHERE id = $2', [data, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/orders/:id', async (req, res) => {
  await query('DELETE FROM orders WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// --- Qualifaz Integration ---
app.get('/api/qualifaz/cancel-reasons', (_req, res) => {
  res.json({ reasons: QUALIFAZ_CANCEL_REASONS });
});

app.get('/api/qualifaz/orders', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'GET /qualifaz/orders'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'GET /qualifaz/orders',
        merchantId
      });
    }

    const { status, since } = req.query || {};
    const conditions = ['store_id = $1'];
    const params = [store.id];

    if (status) {
      params.push(String(status));
      conditions.push(`status = $${params.length}`);
    }
    if (since) {
      params.push(String(since));
      conditions.push(`created_at >= $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await query(
      `SELECT id, status, store_id, store_city, created_at, data FROM orders ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(parseOrderRows(rows));
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'GET /qualifaz/orders',
      error: error?.message || String(error)
    }, 'error');
  }
});

app.get('/api/qualifaz/orders/:id', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'GET /qualifaz/orders/:id'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'GET /qualifaz/orders/:id',
        merchantId
      });
    }

    const { rows } = await query(
      'SELECT id, status, store_id, store_city, created_at, data FROM orders WHERE id = $1 AND store_id = $2',
      [req.params.id, store.id]
    );
    const order = parseOrderRow(rows[0]);
    if (!order) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'GET /qualifaz/orders/:id',
        merchantId,
        orderId: req.params.id
      });
    }
    res.json(order);
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'GET /qualifaz/orders/:id',
      error: error?.message || String(error)
    }, 'error');
  }
});

app.put('/api/qualifaz/orders/:id/assign', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'PUT /qualifaz/orders/:id/assign'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'PUT /qualifaz/orders/:id/assign',
        merchantId
      });
    }

    const { courierId } = req.body || {};
    if (!courierId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_COURIER_ID_REQUIRED', 'courierId required', {
        route: 'PUT /qualifaz/orders/:id/assign',
        merchantId,
        orderId: req.params.id
      });
    }
    const { rows } = await query('SELECT data FROM orders WHERE id = $1 AND store_id = $2', [
      req.params.id,
      store.id
    ]);
    if (rows.length === 0) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'PUT /qualifaz/orders/:id/assign',
        merchantId,
        orderId: req.params.id
      });
    }
    const nextData = { ...(rows[0].data || {}), courierStage: 'ASSIGNED' };
    await query('UPDATE orders SET courier_id = $1, status = $2, data = $3 WHERE id = $4 AND store_id = $5', [
      courierId,
      'DELIVERING',
      nextData,
      req.params.id,
      store.id
    ]);
    res.json({ ok: true });
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'PUT /qualifaz/orders/:id/assign',
      error: error?.message || String(error)
    }, 'error');
  }
});

app.put('/api/qualifaz/orders/:id/status', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'PUT /qualifaz/orders/:id/status'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'PUT /qualifaz/orders/:id/status',
        merchantId
      });
    }

    const { status, reason } = req.body || {};
    if (!status) {
      return respondQualifazError(res, 400, 'QUALIFAZ_STATUS_REQUIRED', 'status required', {
        route: 'PUT /qualifaz/orders/:id/status',
        merchantId,
        orderId: req.params.id
      });
    }
    const resolvedStatus = await resolvePickupStatus(req.params.id, store.id, status);
    if (reason && status === 'CANCELLED') {
      const { rows } = await query('SELECT data FROM orders WHERE id = $1 AND store_id = $2', [
        req.params.id,
        store.id
      ]);
      if (rows.length === 0) {
        return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
          route: 'PUT /qualifaz/orders/:id/status',
          merchantId,
          orderId: req.params.id
        });
      }
      const data = { ...(rows[0].data || {}), cancelReason: String(reason) };
      await query('UPDATE orders SET status = $1, data = $2 WHERE id = $3 AND store_id = $4', [
        resolvedStatus,
        data,
        req.params.id,
        store.id
      ]);
      return res.json({ ok: true });
    }
    const { rowCount } = await query('UPDATE orders SET status = $1 WHERE id = $2 AND store_id = $3', [
      resolvedStatus,
      req.params.id,
      store.id
    ]);
    if (!rowCount) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'PUT /qualifaz/orders/:id/status',
        merchantId,
        orderId: req.params.id
      });
    }
    res.json({ ok: true });
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'PUT /qualifaz/orders/:id/status',
      error: error?.message || String(error)
    }, 'error');
  }
});

app.put('/api/qualifaz/orders/:id/courier-stage', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'PUT /qualifaz/orders/:id/courier-stage'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'PUT /qualifaz/orders/:id/courier-stage',
        merchantId
      });
    }

    const { stage } = req.body || {};
    if (!stage) {
      return respondQualifazError(res, 400, 'QUALIFAZ_STAGE_REQUIRED', 'stage required', {
        route: 'PUT /qualifaz/orders/:id/courier-stage',
        merchantId,
        orderId: req.params.id
      });
    }
    const { rows } = await query('SELECT data FROM orders WHERE id = $1 AND store_id = $2', [
      req.params.id,
      store.id
    ]);
    if (rows.length === 0) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'PUT /qualifaz/orders/:id/courier-stage',
        merchantId,
        orderId: req.params.id
      });
    }
    const nextData = { ...(rows[0].data || {}), courierStage: stage };
    await query('UPDATE orders SET data = $1 WHERE id = $2 AND store_id = $3', [
      nextData,
      req.params.id,
      store.id
    ]);
    res.json({ ok: true });
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'PUT /qualifaz/orders/:id/courier-stage',
      error: error?.message || String(error)
    }, 'error');
  }
});

app.put('/api/qualifaz/orders/:id/refund', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'PUT /qualifaz/orders/:id/refund'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'PUT /qualifaz/orders/:id/refund',
        merchantId
      });
    }

    const { refundStatus, refundReason } = req.body || {};
    const { rows } = await query('SELECT data FROM orders WHERE id = $1 AND store_id = $2', [
      req.params.id,
      store.id
    ]);
    if (rows.length === 0) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'PUT /qualifaz/orders/:id/refund',
        merchantId,
        orderId: req.params.id
      });
    }
    const data = { ...(rows[0].data || {}), refundStatus, refundReason };
    await query('UPDATE orders SET data = $1 WHERE id = $2 AND store_id = $3', [
      data,
      req.params.id,
      store.id
    ]);
    res.json({ ok: true });
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'PUT /qualifaz/orders/:id/refund',
      error: error?.message || String(error)
    }, 'error');
  }
});

app.put('/api/qualifaz/orders/:id/chat', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'PUT /qualifaz/orders/:id/chat'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'PUT /qualifaz/orders/:id/chat',
        merchantId
      });
    }

    const { chat } = req.body || {};
    const { rows } = await query('SELECT data FROM orders WHERE id = $1 AND store_id = $2', [
      req.params.id,
      store.id
    ]);
    if (rows.length === 0) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'PUT /qualifaz/orders/:id/chat',
        merchantId,
        orderId: req.params.id
      });
    }
    const data = { ...(rows[0].data || {}), chat };
    await query('UPDATE orders SET data = $1 WHERE id = $2 AND store_id = $3', [
      data,
      req.params.id,
      store.id
    ]);
    res.json({ ok: true });
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'PUT /qualifaz/orders/:id/chat',
      error: error?.message || String(error)
    }, 'error');
  }
});

app.put('/api/qualifaz/orders/:id/payment', async (req, res) => {
  try {
    const merchantId = getMerchantIdFromRequest(req);
    if (!merchantId) {
      return respondQualifazError(res, 400, 'QUALIFAZ_MERCHANT_ID_REQUIRED', 'merchantId required', {
        route: 'PUT /qualifaz/orders/:id/payment'
      });
    }
    const store = await getStoreByMerchantId(merchantId);
    if (!store) {
      return respondQualifazError(res, 404, 'QUALIFAZ_MERCHANT_NOT_FOUND', 'merchant not found', {
        route: 'PUT /qualifaz/orders/:id/payment',
        merchantId
      });
    }

    const { paymentMethod } = req.body || {};
    if (!paymentMethod) {
      return respondQualifazError(res, 400, 'QUALIFAZ_PAYMENT_METHOD_REQUIRED', 'paymentMethod required', {
        route: 'PUT /qualifaz/orders/:id/payment',
        merchantId,
        orderId: req.params.id
      });
    }
    const { rows } = await query('SELECT data FROM orders WHERE id = $1 AND store_id = $2', [
      req.params.id,
      store.id
    ]);
    if (rows.length === 0) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'PUT /qualifaz/orders/:id/payment',
        merchantId,
        orderId: req.params.id
      });
    }
    const data = { ...(rows[0].data || {}), paymentMethod };
    await query('UPDATE orders SET data = $1 WHERE id = $2 AND store_id = $3', [
      data,
      req.params.id,
      store.id
    ]);
    res.json({ ok: true });
  } catch (error) {
    await respondQualifazError(res, 500, 'QUALIFAZ_INTERNAL_ERROR', 'internal error', {
      route: 'PUT /qualifaz/orders/:id/payment',
      error: error?.message || String(error)
    }, 'error');
  }
});

// --- Users / Profiles ---
app.get('/api/users/:id/profile', async (req, res) => {
  const data = await getProfile(req.params.id);
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

app.put('/api/users/:id/profile', async (req, res) => {
  try {
    const userId = req.params.id;
    const exists = await ensureUserExists(userId);
    if (!exists) return res.status(404).json({ error: 'user not found' });

    const incoming = req.body || {};
    if (Object.prototype.hasOwnProperty.call(incoming, 'addresses')) {
      if (incoming.addresses && !Array.isArray(incoming.addresses)) {
        return res.status(400).json({ error: 'addresses must be an array' });
      }
      const nextAddresses = Array.isArray(incoming.addresses) ? incoming.addresses : [];
      const resolvedAddresses = [];
      for (const address of nextAddresses) {
        const addressInfo = {
          street: address?.street,
          number: address?.number,
          district: address?.district,
          city: address?.city,
          state: address?.state
        };
        const coords = await resolveCoordinatesForAddress(addressInfo, address?.coordinates);
        if (!coords) {
          return res.status(400).json({ error: 'invalid address or coordinates' });
        }
        resolvedAddresses.push({ ...address, coordinates: coords });
      }
      incoming.addresses = resolvedAddresses;
    }
    const existing = (await getProfile(userId)) || {};
    const payload = { ...existing, ...incoming, uid: normalizeId(userId) };
    const profileSaved = await upsertProfile(userId, payload);
    if (!profileSaved) return res.status(404).json({ error: 'user not found' });
    res.json(payload);
  } catch (error) {
    console.error(error);
    await logError({
      source: 'server',
      message: 'failed to update profile',
      stack: error?.stack,
      context: { route: '/api/users/:id/profile', userId: req.params.id }
    });
    res.status(500).json({ error: 'failed to update profile' });
  }
});

app.get('/api/users/exists', async (req, res) => {
  const email = (req.query.email || '').toString();
  if (!email) return res.json({ exists: false });
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
  res.json({ exists: rows.length > 0 });
});

app.post('/api/users/:id/addresses', async (req, res) => {
  try {
    const userId = req.params.id;
    const exists = await ensureUserExists(userId);
    if (!exists) return res.status(404).json({ error: 'user not found' });

    const payload = req.body || {};
    const addressInfo = {
      street: payload?.street,
      number: payload?.number,
      district: payload?.district,
      city: payload?.city,
      state: payload?.state
    };
    const coords = await resolveCoordinatesForAddress(addressInfo, payload?.coordinates);
    if (!coords) {
      return res.status(400).json({ error: 'invalid address or coordinates' });
    }
    payload.coordinates = coords;
    const profile = (await getProfile(userId)) || { uid: userId };
    const addresses = Array.isArray(profile.addresses) ? [...profile.addresses] : [];
    const existingIndex = addresses.findIndex((addr) => addr.id === payload.id);
    if (existingIndex >= 0) {
      addresses[existingIndex] = payload;
    } else {
      addresses.push(payload);
    }
    profile.addresses = addresses;
    const profileSaved = await upsertProfile(userId, profile);
    if (!profileSaved) return res.status(404).json({ error: 'user not found' });
    res.json(profile);
  } catch (error) {
    console.error(error);
    await logError({
      source: 'server',
      message: 'failed to save address',
      stack: error?.stack,
      context: { route: '/api/users/:id/addresses', userId: req.params.id }
    });
    res.status(500).json({ error: 'failed to save address' });
  }
});

// --- User Cards ---
app.get('/api/users/:id/cards', async (req, res) => {
  const { rows } = await query('SELECT id, data FROM user_cards WHERE user_id = $1', [req.params.id]);
  res.json(mapRows(rows));
});

app.post('/api/users/:id/cards', async (req, res) => {
  try {
    const userId = req.params.id;
    const exists = await ensureUserExists(userId);
    if (!exists) return res.status(404).json({ error: 'user not found' });

    const payload = req.body || {};
    const { rows } = await query(
      'INSERT INTO user_cards (user_id, data) VALUES ($1, $2) RETURNING id',
      [userId, payload]
    );
    res.json({ id: rows[0].id, ...payload });
  } catch (error) {
    console.error(error);
    await logError({
      source: 'server',
      message: 'failed to save card',
      stack: error?.stack,
      context: { route: '/api/users/:id/cards', userId: req.params.id }
    });
    res.status(500).json({ error: 'failed to save card' });
  }
});

// --- Error Handler ---
app.use(async (err, req, res, _next) => {
  try {
    await logError({
      source: 'server',
      message: err?.message || 'Unhandled error',
      stack: err?.stack,
      context: {
        route: req.originalUrl,
        method: req.method,
        params: req.params,
        query: req.query,
        body: req.body
      }
    });
  } catch (error) {
    console.error('Failed to log server error', error);
  }

  res.status(500).json({ error: 'internal server error' });
});

app.delete('/api/users/:id/cards/:cardId', async (req, res) => {
  await query('DELETE FROM user_cards WHERE id = $1 AND user_id = $2', [req.params.cardId, req.params.id]);
  res.json({ ok: true });
});

// --- App Settings ---
app.get('/api/settings', async (_req, res) => {
  const { rows } = await query('SELECT data FROM app_settings WHERE id = 1', []);
  res.json(rows[0]?.data || {});
});

app.put('/api/settings', async (req, res) => {
  const payload = req.body || {};
  await query('UPDATE app_settings SET data = $1 WHERE id = 1', [payload]);
  res.json(payload);
});

// --- AI Recommendation (local heuristic) ---
app.post('/api/ai/recommendation', (req, res) => {
  const prompt = (req.body?.prompt || '').toString().toLowerCase();
  let response = { suggestion: 'Que tal um lanche bem feito hoje?', recommendedCategory: 'Lanches' };

  if (prompt.includes('doce') || prompt.includes('sobremesa')) {
    response = { suggestion: 'Vai de um doce hoje?', recommendedCategory: 'Doces' };
  } else if (prompt.includes('leve') || prompt.includes('saudavel') || prompt.includes('salada')) {
    response = { suggestion: 'Que tal algo leve e equilibrado?', recommendedCategory: 'Saudavel' };
  } else if (prompt.includes('pizza')) {
    response = { suggestion: 'Uma pizza caprichada sempre cai bem.', recommendedCategory: 'Pizza' };
  }

  res.json(response);
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
