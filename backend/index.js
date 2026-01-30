import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import Busboy from 'busboy';
import ImageKit from '@imagekit/nodejs';
import { readFile } from 'fs/promises';
import { query, withClient } from './db.js';
import { initErrorLogTable, logError } from './logger.js';
import {
  createSolicitacaoPixRepasse,
  consultarStatusPixRepasse,
  cancelSolicitacaoPixRepasse
} from './pixRepasse.js';

const app = express();
const port = process.env.PORT || 3001;
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const corsOrigin = process.env.CORS_ORIGIN || '*';
const imagekitPrivateKey = process.env.IMAGEKIT_PRIVATE_KEY || '';
const imagekitPublicKey = process.env.IMAGEKIT_PUBLIC_KEY || '';
const imagekitUrlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT || '';

const imageKitClient = () => new ImageKit({
  publicKey: imagekitPublicKey,
  privateKey: imagekitPrivateKey,
  urlEndpoint: imagekitUrlEndpoint
});
const geminiApiKey = process.env.GEMINI_API_KEY || '';
const pixRepasseBaseUrl = process.env.PIXREPASSE_BASE_URL || 'https://meinobolso.com';
const pixRepasseToken = process.env.PIXREPASSE_TOKEN_API_EXTERNA || '';
const pixRepasseTtlMinutes = Math.max(1, Number(process.env.PIXREPASSE_TTL_MINUTES || 60));
const CORE_SCHEMA_URL = new URL('./db/init.sql', import.meta.url);

const isValidUuid = (value) => {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
};

const allowedOrigins = new Set([
  'https://app.menufaz.com',
  'https://appassets.androidplatform.net'
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (origin && corsOrigin !== '*') {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});
app.use(express.json({ limit: '50mb' }));

const registerUuidParam = (paramName) => {
  app.param(paramName, (req, res, next, value) => {
    if (!isValidUuid(String(value || ''))) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    return next();
  });
};

[
  'id',
  'orderId',
  'storeId',
  'userId',
  'courierId',
  'requestId',
  'templateId',
  'flavorId',
  'couponId',
  'expenseId',
  'cardId',
  'logId'
].forEach(registerUuidParam);

const ensureCoreTables = async () => {
  const schemaSql = await readFile(CORE_SCHEMA_URL, 'utf8');
  try {
    await query(schemaSql);
  } catch (error) {
    console.error('Failed to apply core schema file', error);
  }
  const safeQuery = async (sql) => {
    try {
      await query(sql);
    } catch (error) {
      console.error('Failed to ensure schema', error);
    }
  };

  await safeQuery(
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
    )
    `
  );
  await safeQuery('CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_address ON customers (phone, street, number)');
  await safeQuery('ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT');
  await safeQuery('ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await safeQuery('ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await safeQuery('ALTER TABLE store_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await safeQuery('ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await safeQuery('ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await safeQuery('ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await safeQuery('ALTER TABLE option_group_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await safeQuery('ALTER TABLE option_group_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
};

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
      order_id UUID,
      kind TEXT NOT NULL DEFAULT 'NEW_ORDER',
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      printed_at TIMESTAMP WITH TIME ZONE,
      processing_at TIMESTAMP WITH TIME ZONE,
      processing_by_machine_id TEXT,
      failed_at TIMESTAMP WITH TIME ZONE,
      failed_reason TEXT,
      retry_count INTEGER DEFAULT 0
    )
    `
  );
  await query('ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS order_id UUID');
  await query('ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT \'NEW_ORDER\'');
  await query('ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS processing_at TIMESTAMP WITH TIME ZONE');
  await query('ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS processing_by_machine_id TEXT');
  await query('ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP WITH TIME ZONE');
  await query('ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS failed_reason TEXT');
  await query('ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0');
  await query('CREATE INDEX IF NOT EXISTS idx_print_devices_merchant_id ON print_devices(merchant_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_print_jobs_merchant_status ON print_jobs(merchant_id, status)');
  await query('CREATE INDEX IF NOT EXISTS idx_print_jobs_order_kind ON print_jobs(order_id, kind)');
};

const ensurePaymentTables = async () => {
  await query(
    `
    CREATE TABLE IF NOT EXISTS order_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      id_solicitacao UUID,
      timestamp_limite TIMESTAMP WITH TIME ZONE,
      valor NUMERIC(18,2),
      qr_code TEXT,
      codigo_tipo_pagamento INT,
      codigo_estado_pagamento INT,
      codigo_estado_solicitacao INT,
      descricao_status TEXT,
      numero_solicitacao TEXT,
      numero_convenio TEXT,
      url_solicitacao TEXT,
      system_status TEXT,
      status_local TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
    `
  );
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS id_solicitacao UUID');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS timestamp_limite TIMESTAMP WITH TIME ZONE');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS valor NUMERIC(18,2)');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS qr_code TEXT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS codigo_tipo_pagamento INT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS codigo_estado_pagamento INT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS codigo_estado_solicitacao INT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS descricao_status TEXT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS numero_solicitacao TEXT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS numero_convenio TEXT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS url_solicitacao TEXT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS system_status TEXT');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS status_local TEXT NOT NULL DEFAULT \'PENDING\'');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
  await query('CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_order_payments_provider ON order_payments(provider)');
  await query('CREATE INDEX IF NOT EXISTS idx_order_payments_status ON order_payments(status_local)');
};

const ensureTablePaymentTables = async () => {
  await query(
    `
    CREATE TABLE IF NOT EXISTS table_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id UUID NOT NULL,
      table_number TEXT NOT NULL,
      table_session_id TEXT NOT NULL,
      order_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      valor NUMERIC(18,2),
      id_solicitacao UUID,
      timestamp_limite TIMESTAMP WITH TIME ZONE,
      qr_code TEXT,
      status_local TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
    `
  );
  await query('CREATE INDEX IF NOT EXISTS idx_table_payments_store ON table_payments(store_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_table_payments_table ON table_payments(store_id, table_number)');
  await query('CREATE INDEX IF NOT EXISTS idx_table_payments_session ON table_payments(table_session_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_table_payments_status ON table_payments(status_local)');
};

const ensureTabletTables = async () => {
  await query(
    `
    CREATE TABLE IF NOT EXISTS tablet_devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
      table_number TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      device_id TEXT,
      device_label TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE,
      last_seen TIMESTAMP WITH TIME ZONE,
      revoked_at TIMESTAMP WITH TIME ZONE
    )
    `
  );
  await query(
    `
    CREATE TABLE IF NOT EXISTS tablet_device_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
      table_number TEXT NOT NULL,
      token TEXT NOT NULL,
      device_id TEXT,
      device_label TEXT,
      event_type TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
    `
  );
  await query('CREATE INDEX IF NOT EXISTS idx_tablet_devices_store_id ON tablet_devices(store_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_tablet_devices_table ON tablet_devices(store_id, table_number)');
  await query('CREATE INDEX IF NOT EXISTS idx_tablet_devices_token ON tablet_devices(token)');
  await query('CREATE INDEX IF NOT EXISTS idx_tablet_devices_device_id ON tablet_devices(device_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_tablet_device_events_store ON tablet_device_events(store_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_tablet_device_events_table ON tablet_device_events(store_id, table_number)');
  await query('CREATE INDEX IF NOT EXISTS idx_tablet_device_events_token ON tablet_device_events(token)');
};

initErrorLogTable().catch((error) => {
  console.error('Failed to initialize error log table', error);
});

ensureCoreTables().catch((error) => {
  console.error('Failed to initialize core tables', error);
});

ensurePrintTables().catch((error) => {
  console.error('Failed to initialize print tables', error);
});

ensurePaymentTables().catch((error) => {
  console.error('Failed to initialize payment tables', error);
});

ensureTablePaymentTables().catch((error) => {
  console.error('Failed to initialize table payment tables', error);
});

ensureTabletTables().catch((error) => {
  console.error('Failed to initialize tablet tables', error);
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    if (res.statusCode < 500) return;
    const durationMs = Date.now() - startedAt;
    const safePath = req.originalUrl.split('?')[0];
    logError({
      source: 'server',
      level: 'error',
      message: `${req.method} ${safePath} -> ${res.statusCode}`,
      context: {
        status: res.statusCode,
        durationMs,
        path: safePath
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

const getStoreIdFromAuth = async (authPayload, requestedStoreId = '') => {
  if (!authPayload?.sub) return null;
  if (authPayload.role === 'ADMIN' && requestedStoreId) return requestedStoreId;
  const profileData = await getProfile(authPayload.sub);
  return profileData?.storeId || null;
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

const requireBusinessOrAdmin = (req, res, next) => {
  const role = req.user?.role || '';
  if (role !== 'ADMIN' && role !== 'BUSINESS') {
    return res.status(403).json({ error: 'forbidden' });
  }
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

const sanitizeStoreForPublic = (payload = {}) => {
  const {
    pix_hash_recebedor_01,
    pix_hash_recebedor_02,
    pix_identificacao_pdv,
    ...rest
  } = payload || {};
  const pixOnlineReady =
    payload.pix_enabled === true &&
    !!pix_hash_recebedor_01 &&
    !!pix_hash_recebedor_02;
  return {
    ...rest,
    pix_enabled: payload.pix_enabled === true,
    pixOnlineReady,
    pix_hashes_configured: pixOnlineReady
  };
};

const stripStockQty = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return payload;
  const { stock_qty, ...rest } = payload;
  return rest;
};

const mapStoreRowWithStatus = (row, now = getZonedNow()) => {
  if (!row) return null;
  const payload = sanitizeStoreForPublic(row.data || {});
  const availability = resolveStoreOpenStatus(payload, now);
  return {
    id: row.id,
    ...payload,
    isOpenNow: availability.isOpenNow,
    nextOpenAt: availability.nextOpenAt,
    nextCloseAt: availability.nextCloseAt
  };
};

const normalizeStoreRatings = (storeData = {}) => {
  const rating = Number(storeData.rating);
  const ratingCount = Number(storeData.ratingCount);
  return {
    ...storeData,
    rating: Number.isFinite(rating) && rating >= 0 ? rating : 0,
    ratingCount: Number.isFinite(ratingCount) && ratingCount >= 0 ? ratingCount : 0
  };
};

const maskSecret = (value) => {
  const raw = (value || '').toString();
  if (!raw) return '';
  if (raw.length <= 8) return '*'.repeat(raw.length);
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
};

const redactSensitive = (input) => {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((item) => redactSensitive(item));
  const result = {};
  Object.entries(input).forEach(([key, value]) => {
    if (/tokenApiExterna|pix_hash|pix_identificacao_pdv/i.test(key)) {
      result[key] = '***';
    } else if (value && typeof value === 'object') {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  });
  return result;
};

const extractPixRepasseFields = (data = {}) => ({
  pix_enabled: data.pix_enabled === true,
  pix_hash_recebedor_01: data.pix_hash_recebedor_01 || '',
  pix_hash_recebedor_02: data.pix_hash_recebedor_02 || '',
  pix_identificacao_pdv: data.pix_identificacao_pdv || ''
});

const buildPixConfigResponse = (data = {}) => {
  const pix = extractPixRepasseFields(data);
  return {
    pix_enabled: pix.pix_enabled,
    pix_hash_recebedor_01: pix.pix_hash_recebedor_01 ? maskSecret(pix.pix_hash_recebedor_01) : '',
    pix_hash_recebedor_02: pix.pix_hash_recebedor_02 ? maskSecret(pix.pix_hash_recebedor_02) : '',
    pix_identificacao_pdv: pix.pix_identificacao_pdv || ''
  };
};

const normalizePixRepasseInput = (input = {}) => ({
  pix_enabled: input.pix_enabled === true,
  pix_hash_recebedor_01: (input.pix_hash_recebedor_01 || '').toString().trim(),
  pix_hash_recebedor_02: (input.pix_hash_recebedor_02 || '').toString().trim()
});

const stripSplitSurcharge = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  const { splitSurcharge, ...rest } = payload;
  return rest;
};

const TABLET_QR_TTL_MINUTES = 5;
const buildTabletQrUrl = ({ slug, tableNumber, token }) => {
  const safeSlug = (slug || '').toString().trim();
  const safeMesa = (tableNumber || '').toString().trim();
  const safeToken = (token || '').toString().trim();
  return `https://app.menufaz.com/${safeSlug}?mesa=${encodeURIComponent(safeMesa)}&tablet=1&tablet_token=${encodeURIComponent(safeToken)}`;
};

const extractPixResponseValue = (payload, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
      return payload[key];
    }
  }
  return null;
};

const mapPixRepasseResponse = (payload = {}) => {
  return {
    idSolicitacao: extractPixResponseValue(payload, ['idSolicitacao', 'id_solicitacao', 'idSolicitacaoPix']),
    qrCode: extractPixResponseValue(payload, ['qrCode', 'qr_code', 'pixCopiaECola', 'copiaECola', 'copia_cola']),
    codigoTipoPagamento: extractPixResponseValue(payload, ['codigoTipoPagamento', 'codigo_tipo_pagamento']),
    codigoEstadoPagamento: extractPixResponseValue(payload, ['codigoEstadoPagamento', 'codigo_estado_pagamento']),
    codigoEstadoSolicitacao: extractPixResponseValue(payload, ['codigoEstadoSolicitacao', 'codigo_estado_solicitacao']),
    descricaoStatus: extractPixResponseValue(payload, ['descricaoStatus', 'descricao_status']),
    numeroSolicitacao: extractPixResponseValue(payload, ['numeroSolicitacao', 'numero_solicitacao']),
    numeroConvenio: extractPixResponseValue(payload, ['numeroConvenio', 'numero_convenio']),
    urlSolicitacao: extractPixResponseValue(payload, ['urlSolicitacao', 'url_solicitacao']),
    systemStatus: extractPixResponseValue(payload, ['systemStatus', 'system_status'])
  };
};

const isPixStatusExpiredByCode = (codigoEstadoSolicitacao) => {
  const code = Number(codigoEstadoSolicitacao);
  return [800, 850, 900].includes(code);
};

const resolvePixExpirationReason = ({ codigoEstadoSolicitacao, timestampLimite }) => {
  const code = Number(codigoEstadoSolicitacao);
  if (Number.isFinite(code) && [800, 850, 900].includes(code)) {
    const labelMap = {
      800: 'Expirada',
      850: 'Abandonada',
      900: 'Excluida'
    };
    return labelMap[code] || `Solicitacao expirada (${code})`;
  }
  if (timestampLimite && new Date(timestampLimite).getTime() <= Date.now()) {
    return 'Tempo limite excedido';
  }
  return 'PIX expirado';
};

const isPixPaymentPendingAndValid = (row) => {
  if (!row) return false;
  if (row.status_local !== ORDER_PAYMENT_STATUS.pending) return false;
  if (isPixStatusExpiredByCode(row.codigo_estado_solicitacao)) return false;
  if (row.timestamp_limite && new Date(row.timestamp_limite).getTime() <= Date.now()) {
    return false;
  }
  return true;
};

const PIZZA_SIZE_KEYS = ['brotinho', 'pequena', 'media', 'grande', 'familia'];
const PRINT_JOB_STATUS = {
  pending: 'pending',
  processing: 'processing',
  printed: 'printed',
  failed: 'failed'
};

const ORDER_PAYMENT_PROVIDER = {
  pixRepasse: 'PIX_REPASSE'
};

const ORDER_PAYMENT_STATUS = {
  pending: 'PENDING',
  paid: 'PAID',
  expired: 'EXPIRED',
  failed: 'FAILED',
  cancelled: 'CANCELLED'
};

const PRINT_JOB_KIND = {
  newOrder: 'NEW_ORDER',
  reprint: 'REPRINT'
};

const ORDER_STATUS_FLOW_BY_TYPE = {
  DELIVERY: ['PENDING', 'PREPARING', 'WAITING_COURIER', 'DELIVERING', 'COMPLETED', 'CANCELLED'],
  PICKUP: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'],
  TABLE: ['PENDING', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED']
};

const CLIENT_CANCEL_WINDOW_MS = 10 * 60 * 1000;

const getOrderStatusFlow = (orderType = 'DELIVERY') =>
  ORDER_STATUS_FLOW_BY_TYPE[orderType] || ORDER_STATUS_FLOW_BY_TYPE.DELIVERY;

const normalizeStoredStatusForType = (status, orderType) => {
  if (!status) return status;
  if (orderType === 'PICKUP') {
    if (status === 'WAITING_COURIER' || status === 'DELIVERING') return 'READY_FOR_PICKUP';
  }
  if (orderType === 'TABLE') {
    if (status === 'WAITING_COURIER') return 'READY';
    if (status === 'DELIVERING') return 'SERVED';
  }
  return status;
};

const canAdvanceOrderStatus = (currentStatus, nextStatus, orderType = 'DELIVERY') => {
  if (!currentStatus || !nextStatus || currentStatus === nextStatus) return true;
  if (currentStatus === 'COMPLETED' || currentStatus === 'CANCELLED') return false;
  if (nextStatus === 'CANCELLED') return true;
  const flow = getOrderStatusFlow(orderType);
  const currentIndex = flow.indexOf(currentStatus);
  const nextIndex = flow.indexOf(nextStatus);
  if (currentIndex === -1 || nextIndex === -1) return false;
  return nextIndex >= currentIndex;
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

const normalizeNeighborhoodName = (value) =>
  (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const buildNeighborhoodCandidates = (district, city) => {
  const candidates = [];
  const raw = (district || '').toString().trim();
  if (!raw) return candidates;
  candidates.push(raw);
  const dashSplit = raw.split(' - ');
  if (dashSplit[0] && dashSplit[0] !== raw) candidates.push(dashSplit[0].trim());
  const commaSplit = raw.split(',');
  if (commaSplit[0] && commaSplit[0] !== raw) candidates.push(commaSplit[0].trim());
  if (city) {
    const cityNormalized = normalizeNeighborhoodName(city);
    const normalized = normalizeNeighborhoodName(raw);
    if (cityNormalized && normalized.includes(cityNormalized)) {
      const cleaned = normalized.replace(cityNormalized, '').trim();
      if (cleaned) candidates.push(cleaned);
    }
  }
  return Array.from(new Set(candidates.filter(Boolean)));
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
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const normalized = normalizeSchedule(schedule);
  const dayIndex = date.getDay();
  if (normalized.length === 7) return normalized[dayIndex];
  const match = normalized.find((entry, idx) => resolveScheduleDayIndex(entry, idx) === dayIndex);
  return match || normalized[dayIndex] || normalized[0] || null;
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
    if (!entry) continue;
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

const getZonedNow = (timezone = 'America/Sao_Paulo') =>
  new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));

const buildScheduleIntervals = (schedule, now) => {
  const intervals = [];
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return intervals;
  }
  const base = new Date(now);
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dayDate = new Date(base);
    dayDate.setDate(base.getDate() + dayOffset);
    const entry = getScheduleEntryForDate(schedule, dayDate);
    if (!entry) continue;
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
      intervals.push({ start: startDate, end: endDate });
    }
  }
  return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
};

const resolveStoreOpenStatus = (storeData, now = null, timezone = 'America/Sao_Paulo') => {
  const resolvedNow = now || getZonedNow(timezone);
  const pause = storeData.pause || null;
  const pauseEndsAt = pause?.endsAt ? new Date(pause.endsAt) : null;
  const pauseActive = Boolean(pause?.active && pauseEndsAt && pauseEndsAt.getTime() > resolvedNow.getTime());
  const pauseExpired = Boolean(pause?.active && pauseEndsAt && pauseEndsAt.getTime() <= resolvedNow.getTime());

  const hasSchedule = Array.isArray(storeData.schedule) && storeData.schedule.length > 0;
  const schedule = hasSchedule ? normalizeSchedule(storeData.schedule) : [];
  const entry = hasSchedule ? getScheduleEntryForDate(schedule, resolvedNow) : null;
  const nowMinutes = resolvedNow.getHours() * 60 + resolvedNow.getMinutes();
  const scheduleSegments = entry ? getScheduleSegments(entry) : [];
  const scheduleOpen = scheduleSegments.some(([start, end]) => {
    return isTimeWithinRange(nowMinutes, parseTimeToMinutes(start), parseTimeToMinutes(end));
  });

  let isOpenNow = hasSchedule ? scheduleOpen : false;
  let reason = hasSchedule ? (scheduleOpen ? 'OPEN_SCHEDULE' : 'CLOSED_SCHEDULE') : 'NO_SCHEDULE';

  if (pauseActive) {
    isOpenNow = false;
    reason = 'PAUSED';
  }

  const intervals = buildScheduleIntervals(schedule, resolvedNow);
  let nextOpenAt = null;
  let nextCloseAt = null;

  const activeInterval = intervals.find((interval) => resolvedNow >= interval.start && resolvedNow < interval.end);
  if (activeInterval) {
    nextCloseAt = activeInterval.end.toISOString();
    const nextInterval = intervals.find((interval) => interval.start > resolvedNow);
    nextOpenAt = nextInterval ? nextInterval.start.toISOString() : null;
  } else {
    const nextInterval = intervals.find((interval) => interval.start > resolvedNow);
    if (nextInterval) {
      nextOpenAt = nextInterval.start.toISOString();
      nextCloseAt = nextInterval.end.toISOString();
    }
  }

  return {
    isOpenNow,
    reason,
    scheduleOpen,
    pause: pauseActive ? pause : null,
    pauseExpired,
    nextOpenAt,
    nextCloseAt,
    hasSchedule
  };
};

const resolveStoreAvailability = (storeData, now = getZonedNow()) => {
  const availability = resolveStoreOpenStatus(storeData, now);
  return {
    isOpen: availability.isOpenNow,
    reason: availability.reason,
    autoOpenClose: Boolean(storeData.autoOpenClose),
    scheduleOpen: availability.scheduleOpen,
    pause: availability.pause,
    pauseExpired: availability.pauseExpired,
    nextChangeAt: availability.nextOpenAt || availability.nextCloseAt || null,
    nextOpenAt: availability.nextOpenAt,
    nextCloseAt: availability.nextCloseAt,
    hasSchedule: availability.hasSchedule
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

const getStoreByOwnerId = async (ownerId) => {
  if (!ownerId) return null;
  const { rows } = await query('SELECT id, data FROM stores WHERE owner_id = $1 ORDER BY id ASC LIMIT 1', [
    ownerId
  ]);
  if (rows.length === 0) return null;
  return { id: rows[0].id, data: rows[0].data || {} };
};

const ensureProfileStoreId = async (userId, profileData) => {
  if (!userId) return profileData;
  if (profileData?.storeId) return profileData;
  const store = await getStoreByOwnerId(userId);
  if (!store) return profileData;
  const nextProfile = { ...(profileData || {}), storeId: store.id };
  await upsertProfile(userId, nextProfile);
  return nextProfile;
};

const formatCurrencyBRL = (value) => {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(safeAmount);
};

const formatPhone = (value) => {
  const digits = (value || '').toString().replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }
  return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
};

const formatAddressLine = (address) => {
  if (!address) return '';
  const parts = [
    address.street,
    address.number,
    address.complement,
    address.district,
    address.city,
    address.state
  ]
    .map((part) => (part || '').toString().trim())
    .filter(Boolean);
  return parts.join(', ');
};

const buildOrderPrintText = ({ order, store, flavorMap }) => {
  const lineWidth = 48;
  const divider = '-'.repeat(lineWidth);
  const storeName = store?.name || order.storeName || 'Loja';
  const storePhone = store?.phone || store?.whatsapp || '';
  const storeAddress = formatAddressLine(store);
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const orderIdShort = order.id ? order.id.slice(0, 6) : '';
  const orderType = order.type === 'TABLE' ? 'Mesa' : order.type === 'PICKUP' ? 'Retirada' : 'Delivery';

  const lines = [];
  lines.push(String(storeName).toUpperCase());
  if (storePhone) lines.push(formatPhone(storePhone));
  if (storeAddress) lines.push(storeAddress);
  lines.push(divider);
  lines.push('PEDIDO');
  if (orderIdShort) lines.push(`Pedido: #${orderIdShort}`);
  lines.push(`Data: ${createdAt.toLocaleString('pt-BR')}`);
  lines.push(`Tipo: ${orderType}`);
  if (order.type === 'TABLE' && order.tableNumber) {
    lines.push(`Mesa: ${order.tableNumber}`);
  }
  lines.push(divider);
  lines.push('CLIENTE');
  lines.push(`Nome: ${order.customerName || 'Cliente'}`);
  if (order.customerPhone) lines.push(`Telefone: ${formatPhone(order.customerPhone)}`);
  if (order.type === 'DELIVERY') {
    const address = formatAddressLine(order.deliveryAddress);
    if (address) lines.push(`Endereco: ${address}`);
  }
  lines.push(divider);
  lines.push('ITENS');

  const lineItems = Array.isArray(order.lineItems) && order.lineItems.length > 0
    ? order.lineItems
    : [];

  if (lineItems.length === 0 && Array.isArray(order.items)) {
    order.items.forEach((item) => {
      lines.push(item);
    });
  } else {
    lineItems.forEach((item) => {
      const quantity = Number(item.quantity || 1);
      const sizeKey = item.pizza?.sizeKey;
      const sizeLabel = sizeKey
        ? sizeKey.charAt(0).toUpperCase() + sizeKey.slice(1)
        : '';
      const splitCount = Number(item.pizza?.splitCount || 1);
      const pizzaSuffix = item.pizza ? ` (${splitCount} sabores)` : '';
      const sizeSuffix =
        sizeLabel && !String(item.name || '').toLowerCase().includes(sizeLabel.toLowerCase())
          ? ` (${sizeLabel})`
          : '';
      lines.push(`${quantity}x ${item.name || 'Item'}${sizeSuffix}${pizzaSuffix}`);

      if (item.pizza && Array.isArray(item.pizza.flavors)) {
        item.pizza.flavors.forEach((flavor) => {
          const flavorName = flavorMap.get(flavor.flavorId) || flavor.flavorId || 'Sabor';
          lines.push(`  - ${flavorName}`);
        });
      }

      if (Array.isArray(item.options) && item.options.length > 0) {
        lines.push('  Adicionais:');
        item.options.forEach((option) => {
          const optionLabel = option?.optionName || option?.groupName || 'Opcao';
          const priceLabel =
            typeof option?.price === 'number' && option.price > 0
              ? ` (+${formatCurrencyBRL(option.price)})`
              : '';
          lines.push(`   * ${optionLabel}${priceLabel}`);
        });
      }
      if (item.notes) {
        lines.push(`  Obs: ${item.notes}`);
      }
    });
  }

  lines.push(divider);
  const notes = (order.notes || '').toString().trim();
  if (notes) {
    lines.push('OBSERVACOES:');
    lines.push(notes);
    lines.push(divider);
  }
  lines.push('PAGAMENTO');
  const deliveryFee = Number(order.deliveryFee || 0);
  const subtotalFromItems = Array.isArray(order.lineItems)
    ? order.lineItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0)
    : 0;
  const subtotal = subtotalFromItems > 0 ? subtotalFromItems : Math.max(0, Number(order.total || 0) - deliveryFee);
  lines.push(`Subtotal: ${formatCurrencyBRL(subtotal)}`);
  if (deliveryFee > 0) {
    lines.push(`Entrega: ${formatCurrencyBRL(deliveryFee)}`);
  }
  lines.push(`Total: ${formatCurrencyBRL(order.total)}`);
  if (order.paymentMethod) {
    lines.push(`Pagamento: ${order.paymentMethod}`);
    const changeMatch = order.paymentMethod.match(/Troco p\/\s*([0-9.,]+)/i);
    if (changeMatch && changeMatch[1]) {
      lines.push(`Troco para: ${changeMatch[1]}`);
    }
  }
  lines.push(divider);
  lines.push('Obrigado pela preferencia!');

  return `${lines.join('\n')}\n`;
};

const createPrintJob = async ({ merchantId, orderId, kind, printText, payload }) => {
  if (!merchantId) return null;
  const fullPayload = {
    printText,
    ...(payload || {})
  };
  const { rows } = await query(
    `
    INSERT INTO print_jobs (merchant_id, order_id, kind, status, payload)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
    `,
    [merchantId, orderId || null, kind, PRINT_JOB_STATUS.pending, fullPayload]
  );
  return rows[0]?.id || null;
};

const insertOrderPayment = async ({
  orderId,
  provider,
  response,
  timestampLimite,
  valor,
  statusLocal = ORDER_PAYMENT_STATUS.pending,
  client
}) => {
  const mapped = mapPixRepasseResponse(response || {});
  const executor = client ? client.query.bind(client) : query;
  const { rows } = await executor(
    `
    INSERT INTO order_payments (
      order_id,
      provider,
      id_solicitacao,
      timestamp_limite,
      valor,
      qr_code,
      codigo_tipo_pagamento,
      codigo_estado_pagamento,
      codigo_estado_solicitacao,
      descricao_status,
      numero_solicitacao,
      numero_convenio,
      url_solicitacao,
      system_status,
      status_local,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
    RETURNING *
    `,
    [
      orderId,
      provider,
      mapped.idSolicitacao || null,
      timestampLimite ? new Date(timestampLimite) : null,
      Number.isFinite(Number(valor)) ? Number(valor) : null,
      mapped.qrCode || null,
      mapped.codigoTipoPagamento !== null ? Number(mapped.codigoTipoPagamento) : null,
      mapped.codigoEstadoPagamento !== null ? Number(mapped.codigoEstadoPagamento) : null,
      mapped.codigoEstadoSolicitacao !== null ? Number(mapped.codigoEstadoSolicitacao) : null,
      mapped.descricaoStatus || null,
      mapped.numeroSolicitacao || null,
      mapped.numeroConvenio || null,
      mapped.urlSolicitacao || null,
      mapped.systemStatus || null,
      statusLocal
    ]
  );
  return rows[0] || null;
};

const updateOrderPaymentFromStatus = async ({ paymentId, response, statusLocal, timestampLimite }) => {
  const mapped = mapPixRepasseResponse(response || {});
  await query(
    `
    UPDATE order_payments
    SET
      qr_code = COALESCE($2, qr_code),
      codigo_tipo_pagamento = COALESCE($3, codigo_tipo_pagamento),
      codigo_estado_pagamento = COALESCE($4, codigo_estado_pagamento),
      codigo_estado_solicitacao = COALESCE($5, codigo_estado_solicitacao),
      descricao_status = COALESCE($6, descricao_status),
      numero_solicitacao = COALESCE($7, numero_solicitacao),
      numero_convenio = COALESCE($8, numero_convenio),
      url_solicitacao = COALESCE($9, url_solicitacao),
      system_status = COALESCE($10, system_status),
      timestamp_limite = COALESCE($11, timestamp_limite),
      status_local = $12,
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      paymentId,
      mapped.qrCode || null,
      mapped.codigoTipoPagamento !== null ? Number(mapped.codigoTipoPagamento) : null,
      mapped.codigoEstadoPagamento !== null ? Number(mapped.codigoEstadoPagamento) : null,
      mapped.codigoEstadoSolicitacao !== null ? Number(mapped.codigoEstadoSolicitacao) : null,
      mapped.descricaoStatus || null,
      mapped.numeroSolicitacao || null,
      mapped.numeroConvenio || null,
      mapped.urlSolicitacao || null,
      mapped.systemStatus || null,
      timestampLimite ? new Date(timestampLimite) : null,
      statusLocal
    ]
  );
};

const getLatestPixPaymentForUpdate = async (client, orderId) => {
  const { rows } = await client.query(
    `
    SELECT *
    FROM order_payments
    WHERE order_id = $1 AND provider = $2
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
    `,
    [orderId, ORDER_PAYMENT_PROVIDER.pixRepasse]
  );
  return rows[0] || null;
};

const expirePixPaymentRow = async (client, paymentRow) => {
  if (!paymentRow?.id) return;
  await client.query(
    'UPDATE order_payments SET status_local = $2, updated_at = NOW() WHERE id = $1',
    [paymentRow.id, ORDER_PAYMENT_STATUS.expired]
  );
};

const maskIdentifier = (value) => {
  const raw = (value || '').toString();
  if (!raw) return '';
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
};

const attemptPixCancelExternal = async ({ orderId, paymentRow }) => {
  if (!paymentRow) return null;
  if (paymentRow.status_local !== ORDER_PAYMENT_STATUS.pending) return null;
  if (Number(paymentRow.codigo_estado_pagamento) === 200) return null;
  if (!paymentRow.numero_convenio || !paymentRow.numero_solicitacao) return null;

  const result = await cancelSolicitacaoPixRepasse({
    numeroConvenio: paymentRow.numero_convenio,
    numeroSolicitacao: paymentRow.numero_solicitacao,
    baseUrl: pixRepasseBaseUrl,
    tokenApiExterna: pixRepasseToken
  });

  if (!result.ok && result.status !== 404) {
    await logError({
      source: 'server',
      level: 'warning',
      message: 'pix repasse cancel failed',
      context: {
        orderId,
        numeroConvenio: maskIdentifier(paymentRow.numero_convenio),
        numeroSolicitacao: maskIdentifier(paymentRow.numero_solicitacao),
        status: result.status
      }
    });
  }

  return result;
};

const ensurePixPaymentForOrder = async ({ orderId, storeData, valor, forceNew = false }) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      let paymentRow = await getLatestPixPaymentForUpdate(client, orderId);

      if (!forceNew && isPixPaymentPendingAndValid(paymentRow)) {
        await client.query('COMMIT');
        return { reused: true, paymentRow };
      }

      if (
        paymentRow &&
        paymentRow.status_local === ORDER_PAYMENT_STATUS.pending &&
        paymentRow.timestamp_limite &&
        new Date(paymentRow.timestamp_limite).getTime() <= Date.now()
      ) {
        await expirePixPaymentRow(client, paymentRow);
      }

      const timestampLimiteSolicitacao = new Date(
        Date.now() + pixRepasseTtlMinutes * 60 * 1000
      ).toISOString();
      const pixResponse = await createSolicitacaoPixRepasse({
        identificacaoPDV: storeData.pix_identificacao_pdv,
        timestampLimiteSolicitacao,
        valorSolicitacao: Number(valor || 0),
        hashIdentificadorRecebedor01: storeData.pix_hash_recebedor_01,
        hashIdentificadorRecebedor02: storeData.pix_hash_recebedor_02,
        baseUrl: pixRepasseBaseUrl,
        tokenApiExterna: pixRepasseToken
      });

      if (!pixResponse.ok) {
        await client.query('ROLLBACK');
        return { error: pixResponse.message || 'pix repasse failed' };
      }

      paymentRow = await insertOrderPayment({
        orderId,
        provider: ORDER_PAYMENT_PROVIDER.pixRepasse,
        response: pixResponse.data,
        timestampLimite: timestampLimiteSolicitacao,
        valor,
        statusLocal: ORDER_PAYMENT_STATUS.pending,
        client
      });

      await client.query('COMMIT');
      return {
        reused: false,
        paymentRow,
        pixResponse,
        timestampLimiteSolicitacao
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
};

const normalizePhoneDigits = (value) => (value || '').toString().replace(/\D/g, '');

const canAccessOrder = (authPayload, orderRow, orderData, query) => {
  if (!orderRow) return false;
  if (authPayload?.sub && orderRow.user_id && authPayload.sub === orderRow.user_id) {
    return true;
  }
  const customerPhone = normalizePhoneDigits(query?.customerPhone || '');
  if (customerPhone && normalizePhoneDigits(orderData?.customerPhone) === customerPhone) {
    return true;
  }
  const customerId = (query?.customerId || '').toString();
  if (customerId && orderData?.customerId && orderData.customerId === customerId) {
    return true;
  }
  return false;
};

const resolvePixStatusLocal = ({ codigoEstadoPagamento, codigoEstadoSolicitacao, timestampLimite }) => {
  if (Number(codigoEstadoPagamento) === 200) return ORDER_PAYMENT_STATUS.paid;
  if (isPixStatusExpiredByCode(codigoEstadoSolicitacao)) return ORDER_PAYMENT_STATUS.expired;
  if (timestampLimite && new Date(timestampLimite).getTime() <= Date.now()) {
    return ORDER_PAYMENT_STATUS.expired;
  }
  return ORDER_PAYMENT_STATUS.pending;
};

const buildStockDeltaMap = (orderData = {}) => {
  const deltas = new Map();
  const lineItems = Array.isArray(orderData.lineItems) ? orderData.lineItems : [];
  lineItems.forEach((item) => {
    if (!item?.productId) return;
    const qty = Number(item.quantity || 0);
    if (!Number.isFinite(qty) || qty === 0) return;
    const current = deltas.get(item.productId) || 0;
    deltas.set(item.productId, current + qty);
  });
  return deltas;
};

const applyStockDelta = async ({ storeId, deltas, client }) => {
  if (!storeId || !deltas || deltas.size === 0) return;
  for (const [productId, qtyDelta] of deltas.entries()) {
    const { rows } = await client.query(
      'SELECT id, data FROM products WHERE id = $1 AND store_id = $2 FOR UPDATE',
      [productId, storeId]
    );
    if (rows.length === 0) continue;
    const data = rows[0].data || {};
    const currentQty = Number(data.stock_qty || 0);
    const nextQty = currentQty + qtyDelta;
    const nextData = { ...data, stock_qty: nextQty };
    await client.query('UPDATE products SET data = $1 WHERE id = $2', [nextData, productId]);
  }
};

const deductStockForOrder = async ({ orderRow, orderData }) => {
  if (!orderRow?.id || !orderRow?.store_id) return;
  if (orderData?.stockDeductedAt) return;
  const deltas = buildStockDeltaMap(orderData);
  if (deltas.size === 0) return;
  await withClient(async (client) => {
    await client.query('BEGIN');
    await applyStockDelta({ storeId: orderRow.store_id, deltas: new Map([...deltas].map(([id, qty]) => [id, -qty])), client });
    const nextData = {
      ...(orderData || {}),
      stockDeductedAt: new Date().toISOString()
    };
    await client.query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, orderRow.id]);
    await client.query('COMMIT');
  });
};

const restockForCancelledOrder = async ({ orderRow, orderData }) => {
  if (!orderRow?.id || !orderRow?.store_id) return;
  if (!orderData?.stockDeductedAt || orderData?.stockRestockedAt) return;
  const deltas = buildStockDeltaMap(orderData);
  if (deltas.size === 0) return;
  await withClient(async (client) => {
    await client.query('BEGIN');
    await applyStockDelta({ storeId: orderRow.store_id, deltas, client });
    const nextData = {
      ...(orderData || {}),
      stockRestockedAt: new Date().toISOString()
    };
    await client.query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, orderRow.id]);
    await client.query('COMMIT');
  });
};

const updateOrderPaymentAndStatus = async ({ orderRow, orderData, paymentRow, response, statusLocal }) => {
  if (
    (statusLocal === ORDER_PAYMENT_STATUS.expired || statusLocal === ORDER_PAYMENT_STATUS.cancelled) &&
    paymentRow?.status_local === ORDER_PAYMENT_STATUS.pending
  ) {
    try {
      await attemptPixCancelExternal({ orderId: orderRow.id, paymentRow });
    } catch (error) {
      await logError({
        source: 'server',
        level: 'warning',
        message: 'pix repasse cancel attempt failed',
        context: { orderId: orderRow.id }
      });
    }
  }
  await updateOrderPaymentFromStatus({
    paymentId: paymentRow.id,
    response,
    statusLocal,
    timestampLimite: paymentRow.timestamp_limite
  });
  const nextData = {
    ...(orderData || {}),
    paymentStatus: statusLocal,
    paymentProvider: ORDER_PAYMENT_PROVIDER.pixRepasse
  };
  let nextStatus = orderRow.status;
  if (statusLocal === ORDER_PAYMENT_STATUS.paid) {
    if (orderRow.status === 'PENDING' && orderData?.autoAcceptEligible) {
      nextStatus = 'PREPARING';
      nextData.autoAccepted = true;
      nextData.autoAcceptedAt = new Date().toISOString();
    }
    await query('UPDATE orders SET data = $1, status = $2 WHERE id = $3', [nextData, nextStatus, orderRow.id]);
  } else {
    await query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, orderRow.id]);
  }
};

const updateTablePaymentRow = async ({ paymentId, statusLocal, qrCode, timestampLimite }) => {
  if (!paymentId) return;
  const updates = [];
  const values = [];
  let idx = 1;
  if (statusLocal) {
    updates.push(`status_local = $${idx++}`);
    values.push(statusLocal);
  }
  if (qrCode !== undefined) {
    updates.push(`qr_code = $${idx++}`);
    values.push(qrCode);
  }
  if (timestampLimite !== undefined) {
    updates.push(`timestamp_limite = $${idx++}`);
    values.push(timestampLimite);
  }
  updates.push(`updated_at = NOW()`);
  if (!updates.length) return;
  values.push(paymentId);
  await query(`UPDATE table_payments SET ${updates.join(', ')} WHERE id = $${idx}`, values);
};

const updateOrdersForTablePayment = async ({ orderIds = [], statusLocal }) => {
  let ids = orderIds;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = [];
    }
  }
  if (!Array.isArray(ids) || ids.length === 0) return;
  if (statusLocal !== ORDER_PAYMENT_STATUS.paid) return;
  const { rows } = await query(
    'SELECT id, status, store_id, data FROM orders WHERE id = ANY($1::uuid[])',
    [ids]
  );
  for (const row of rows) {
    const orderData = row.data || {};
    const nextData = {
      ...(orderData || {}),
      paymentStatus: ORDER_PAYMENT_STATUS.paid,
      paymentProvider: ORDER_PAYMENT_PROVIDER.pixRepasse,
      paymentMethod: orderData.paymentMethod || 'PIX (Online)'
    };
    await query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, row.id]);
  }
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

const resolveOrderTypeFromData = (data = {}) => {
  const normalized = normalizeOrderPayload(data || {});
  return normalized.type || 'DELIVERY';
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

const resolveDeliveryNeighborhood = (storeData = {}, deliveryAddress = null) => {
  const neighborhoods = Array.isArray(storeData.neighborhoodFees)
    ? storeData.neighborhoodFees
    : Array.isArray(storeData.deliveryNeighborhoods)
    ? storeData.deliveryNeighborhoods
    : [];
  const activeNeighborhoods = neighborhoods.filter(
    (item) => item && item.name && item.active !== false
  );
  if (activeNeighborhoods.length === 0) {
    return { error: 'Nenhum bairro de entrega configurado.' };
  }

  const candidates = buildNeighborhoodCandidates(
    deliveryAddress?.district,
    deliveryAddress?.city || storeData.city
  );
  if (candidates.length === 0) {
    return { error: 'Informe o endereço completo com bairro.' };
  }

  const normalizedCandidates = candidates.map((value) => normalizeNeighborhoodName(value));
  const match = activeNeighborhoods.find((item) =>
    normalizedCandidates.includes(normalizeNeighborhoodName(item.name))
  );

  if (!match) {
    return { error: 'store does not deliver to this neighborhood' };
  }
  const fee = Number(match.fee || 0);
  return { fee: Number.isFinite(fee) ? fee : 0, neighborhood: match.name };
};

const resolveDeliveryZone = (storeData = {}, deliveryCoordinates = null) => {
  const zones = Array.isArray(storeData.deliveryZones) ? storeData.deliveryZones : [];
  const activeZones = zones.filter((zone) => {
    if (!zone || zone.enabled === false) return false;
    const type = zone.type || 'RADIUS';
    if (type === 'POLYGON') {
      return Array.isArray(zone.polygonPath) && zone.polygonPath.length >= 3;
    }
    return (
      Number(zone.radiusMeters || 0) > 0 &&
      Number.isFinite(Number(zone.centerLat)) &&
      Number.isFinite(Number(zone.centerLng))
    );
  });

  if (activeZones.length === 0) {
    return { error: 'Nenhuma área de entrega configurada.' };
  }

  if (!isValidCoords(deliveryCoordinates)) {
    return { error: 'Endereço sem coordenadas válidas para calcular o frete.' };
  }

  const matches = activeZones
    .map((zone) => {
      const type = zone.type || 'RADIUS';
      if (type === 'POLYGON') {
        if (!isPointInPolygon(deliveryCoordinates, zone.polygonPath)) return null;
        return { zone, distance: 0, typeRank: 0 };
      }
      const distance = haversineDistanceMeters(
        { lat: Number(zone.centerLat), lng: Number(zone.centerLng) },
        deliveryCoordinates
      );
      if (distance > Number(zone.radiusMeters || 0)) return null;
      return { zone, distance, typeRank: 1 };
    })
    .filter(Boolean);

  if (matches.length === 0) {
    return { error: 'Esta loja não entrega no seu endereço.' };
  }

  matches.sort((a, b) => {
    if (a.typeRank === 1 && b.typeRank === 1) {
      const radiusA = Number(a.zone.radiusMeters || 0);
      const radiusB = Number(b.zone.radiusMeters || 0);
      if (radiusA !== radiusB) return radiusA - radiusB;
      const distance = a.distance - b.distance;
      if (distance !== 0) return distance;
      const priorityA = Number(a.zone.priority || 0);
      const priorityB = Number(b.zone.priority || 0);
      return priorityB - priorityA;
    }
    const priorityA = Number(a.zone.priority || 0);
    const priorityB = Number(b.zone.priority || 0);
    if (priorityA !== priorityB) return priorityB - priorityA;
    if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
    const radiusA = Number(a.zone.radiusMeters || 0);
    const radiusB = Number(b.zone.radiusMeters || 0);
    if (radiusA !== radiusB) return radiusA - radiusB;
    return a.distance - b.distance;
  });

  const best = matches[0].zone;
  const fee = Number(best.fee || 0);
  return {
    fee: Number.isFinite(fee) ? fee : 0,
    zone: best,
    etaMinutes: Number.isFinite(Number(best.etaMinutes)) ? Number(best.etaMinutes) : undefined
  };
};

const ensureOrderItems = (data = {}) => {
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 0) return data;
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
  if (lineItems.length === 0) return data;
  const derivedItems = lineItems.map((item) => {
    const quantity = Number(item?.quantity) || 1;
    const name = (item?.name || 'Item').toString();
    return `${quantity}x ${name}`;
  });
  return { ...data, items: derivedItems };
};

const parseOrderRow = (row) => {
  if (!row) return null;
  const data = ensureOrderItems(normalizeOrderPayload(row.data || {}));
  const orderType = resolveOrderTypeFromData(data);
  const normalizedStatus = normalizeStoredStatusForType(row.status, orderType);
  const storeId = data.storeId || row.store_id;
  return {
    id: row.id,
    status: normalizedStatus,
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

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    console.warn('Healthcheck failed', error?.message || error);
    res.status(503).json({ ok: false, error: 'db_unavailable' });
  }
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
      'SELECT merchant_id, machine_id FROM print_devices WHERE merchant_id = $1 AND token = $2',
      [merchantId, token]
    );
    if (deviceRows.length === 0) {
      return res.status(403).json({ error: 'invalid token' });
    }

    const machineId = deviceRows[0].machine_id;
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 10));

    await query(
      `
      UPDATE print_jobs
      SET status = $1, processing_at = NULL, processing_by_machine_id = NULL
      WHERE merchant_id = $2
        AND status = $3
        AND processing_at IS NOT NULL
        AND processing_at < NOW() - INTERVAL '60 seconds'
      `,
      [PRINT_JOB_STATUS.pending, merchantId, PRINT_JOB_STATUS.processing]
    );

    const { rows } = await query(
      `
      WITH candidate AS (
        SELECT id
        FROM print_jobs
        WHERE merchant_id = $1
          AND status = $2
          AND (failed_at IS NULL OR failed_at < NOW() - INTERVAL '10 seconds')
        ORDER BY created_at ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED
      ),
      claimed AS (
        UPDATE print_jobs
        SET status = $4,
            processing_at = NOW(),
            processing_by_machine_id = $5
        WHERE id IN (SELECT id FROM candidate)
        RETURNING id, payload, created_at
      )
      SELECT * FROM claimed
      ORDER BY created_at ASC
      `,
      [merchantId, PRINT_JOB_STATUS.pending, limit, PRINT_JOB_STATUS.processing, machineId]
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
    let machineId = null;
    if (merchantId) {
      const { rows: deviceRows } = await query(
        'SELECT machine_id FROM print_devices WHERE merchant_id = $1 AND token = $2',
        [merchantId, token]
      );
      if (deviceRows.length === 0) {
        return res.status(403).json({ error: 'invalid token' });
      }
      machineId = deviceRows[0].machine_id;
    } else {
      const { rows } = await query('SELECT merchant_id, machine_id FROM print_devices WHERE token = $1', [token]);
      if (rows.length === 0) {
        return res.status(403).json({ error: 'invalid token' });
      }
      merchantId = rows[0].merchant_id;
      machineId = rows[0].machine_id;
    }

    const { rowCount } = await query(
      `
      UPDATE print_jobs
      SET status = $1,
          printed_at = NOW(),
          processing_at = NULL,
          processing_by_machine_id = NULL
      WHERE id = $2
        AND merchant_id = $3
        AND status IN ($4, $5)
        AND (processing_by_machine_id IS NULL OR processing_by_machine_id = $6)
      `,
      [
        PRINT_JOB_STATUS.printed,
        req.params.id,
        merchantId,
        PRINT_JOB_STATUS.pending,
        PRINT_JOB_STATUS.processing,
        machineId
      ]
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

app.post('/api/print/jobs/:id/failed', async (req, res) => {
  try {
    const token = getPrintTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    let merchantId = getMerchantIdFromRequest(req);
    let machineId = null;
    if (merchantId) {
      const { rows: deviceRows } = await query(
        'SELECT machine_id FROM print_devices WHERE merchant_id = $1 AND token = $2',
        [merchantId, token]
      );
      if (deviceRows.length === 0) {
        return res.status(403).json({ error: 'invalid token' });
      }
      machineId = deviceRows[0].machine_id;
    } else {
      const { rows } = await query('SELECT merchant_id, machine_id FROM print_devices WHERE token = $1', [token]);
      if (rows.length === 0) {
        return res.status(403).json({ error: 'invalid token' });
      }
      merchantId = rows[0].merchant_id;
      machineId = rows[0].machine_id;
    }

    const reason = (req.body?.reason || '').toString().slice(0, 500);
    const retry = req.body?.retry === true;
    const nextStatus = retry ? PRINT_JOB_STATUS.pending : PRINT_JOB_STATUS.failed;
    const { rowCount } = await query(
      `
      UPDATE print_jobs
      SET status = $1,
          failed_at = NOW(),
          failed_reason = $2,
          retry_count = COALESCE(retry_count, 0) + 1,
          processing_at = NULL,
          processing_by_machine_id = NULL
      WHERE id = $3
        AND merchant_id = $4
        AND status IN ($5, $6)
        AND (processing_by_machine_id IS NULL OR processing_by_machine_id = $7)
      `,
      [
        nextStatus,
        reason || null,
        req.params.id,
        merchantId,
        PRINT_JOB_STATUS.pending,
        PRINT_JOB_STATUS.processing,
        machineId
      ]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'job not found' });
    }

    return res.json({ ok: true, status: nextStatus });
  } catch (error) {
    await logError({
      source: 'server',
      message: 'failed to mark print job failed',
      stack: error?.stack,
      context: { route: 'POST /api/print/jobs/:id/failed', jobId: req.params.id }
    });
    return res.status(500).json({ error: 'failed to mark print job failed' });
  }
});

// --- Auth ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role = 'CLIENT', profile = {} } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const { rows: existing } = await query('SELECT id FROM users WHERE lower(email) = $1', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, role',
      [normalizedEmail, passwordHash, role]
    );

    const userId = rows[0].id;
    const profileSaved = await upsertProfile(userId, { email: normalizedEmail, role, ...profile, uid: userId });
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
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const { rows } = await query('SELECT id, password_hash, role FROM users WHERE lower(email) = $1', [
      normalizedEmail
    ]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    let profileData = await getProfile(user.id);
    profileData = await ensureProfileStoreId(user.id, profileData);
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
    let profileData = await getProfile(payload.sub);
    profileData = await ensureProfileStoreId(payload.sub, profileData);
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
  const now = getZonedNow();
  if (merchantId) {
    const store = await getStoreByMerchantId(merchantId);
    if (!store) return res.json([]);
    return res.json([mapStoreRowWithStatus(store, now)]);
  }

  const { rows } = await query('SELECT id, data FROM stores', []);
  res.json(rows.map((row) => mapStoreRowWithStatus(row, now)));
});

app.get('/api/stores/:id', async (req, res) => {
  const { rows } = await query('SELECT id, data FROM stores WHERE id = $1', [req.params.id]);
  const store = mapStoreRowWithStatus(rows[0], getZonedNow());
  if (!store) return res.status(404).json({ error: 'not found' });
  res.json(store);
});

app.post('/api/tablets/qr', async (req, res) => {
  const authPayload = getAuthPayload(req);
  if (!authPayload) return res.status(401).json({ error: 'unauthorized' });
  const storeId = await getStoreIdFromAuth(authPayload, String(req.body?.storeId || req.query?.storeId || ''));
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  const tableNumber = (req.body?.tableNumber || '').toString().trim();
  if (!tableNumber) return res.status(400).json({ error: 'tableNumber required' });

  const { rows } = await query('SELECT id, data FROM stores WHERE id = $1', [storeId]);
  if (rows.length === 0) return res.status(404).json({ error: 'store not found' });
  const storeData = rows[0].data || {};
  const custom = (storeData.customUrl || '').toString().trim();
  const name = (storeData.name || '').toString().trim();
  const slug = custom || name || storeId;

  const token = crypto.randomBytes(18).toString('hex');
  const expiresAt = new Date(Date.now() + TABLET_QR_TTL_MINUTES * 60 * 1000).toISOString();
  await query(
    `
    UPDATE tablet_devices
    SET revoked_at = NOW()
    WHERE store_id = $1
      AND table_number = $2
      AND device_id IS NULL
      AND revoked_at IS NULL
    `,
    [storeId, tableNumber]
  );
  await query(
    `
    INSERT INTO tablet_devices (store_id, table_number, token, expires_at)
    VALUES ($1, $2, $3, $4)
    `,
    [storeId, tableNumber, token, expiresAt]
  );
  await query(
    `
    INSERT INTO tablet_device_events (store_id, table_number, token, event_type, user_agent, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      storeId,
      tableNumber,
      token,
      'qr_created',
      (req.headers['user-agent'] || '').toString().slice(0, 300),
      (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 120)
    ]
  );

  return res.json({
    token,
    tableNumber,
    expiresAt,
    qrUrl: buildTabletQrUrl({ slug, tableNumber, token })
  });
});

const processTabletClaim = async ({ token, deviceId, deviceLabel, req }) => {
  if (!token) return { status: 400, body: { error: 'token required' } };
  if (!deviceId) return { status: 400, body: { error: 'deviceId required' } };

  const { rows } = await query('SELECT * FROM tablet_devices WHERE token = $1', [token]);
  if (rows.length === 0) return { status: 404, body: { error: 'not found' } };
  const row = rows[0];
  if (row.revoked_at) {
    return { status: 403, body: { error: 'revoked', action: 'reset' }, row };
  }

  const now = new Date();
  const expired = row.expires_at && new Date(row.expires_at).getTime() <= now.getTime();
  if (expired && row.device_id && deviceId && row.device_id !== deviceId) {
    await query(
      `
      INSERT INTO tablet_device_events (store_id, table_number, token, device_id, device_label, event_type, user_agent, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        row.store_id,
        row.table_number,
        token,
        deviceId || null,
        deviceLabel || null,
        'claim_failed_expired',
        (req.headers['user-agent'] || '').toString().slice(0, 300),
        (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 120)
      ]
    );
    return { status: 403, body: { error: 'expired' }, row };
  }
  if (expired && !row.device_id) {
    await query(
      `
      INSERT INTO tablet_device_events (store_id, table_number, token, device_id, device_label, event_type, user_agent, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        row.store_id,
        row.table_number,
        token,
        deviceId || null,
        deviceLabel || null,
        'claim_failed_expired',
        (req.headers['user-agent'] || '').toString().slice(0, 300),
        (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 120)
      ]
    );
    return { status: 403, body: { error: 'expired' }, row };
  }

  const nextDeviceId = row.device_id || deviceId || null;
  const nextDeviceLabel = deviceLabel || row.device_label || null;

  await query(
    `
    UPDATE tablet_devices
    SET device_id = $1,
        device_label = $2,
        last_seen = NOW(),
        expires_at = NULL
    WHERE token = $3
    `,
    [nextDeviceId, nextDeviceLabel, token]
  );
  await query(
    `
    INSERT INTO tablet_device_events (store_id, table_number, token, device_id, device_label, event_type, user_agent, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      row.store_id,
      row.table_number,
      token,
      nextDeviceId,
      nextDeviceLabel,
      'claimed',
      (req.headers['user-agent'] || '').toString().slice(0, 300),
      (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 120)
    ]
  );

  return {
    status: 200,
    body: {
      ok: true,
      storeId: row.store_id,
      tableNumber: row.table_number,
      expiresAt: row.expires_at
    },
    row,
    deviceId: nextDeviceId,
    deviceLabel: nextDeviceLabel
  };
};

const handleTabletClaim = async (req, res) => {
  const token = (req.body?.token || req.query?.token || '').toString().trim();
  const deviceId = (req.body?.deviceId || req.query?.deviceId || '').toString().trim();
  const deviceLabel = (req.body?.deviceLabel || req.query?.deviceLabel || '').toString().trim();
  const result = await processTabletClaim({ token, deviceId, deviceLabel, req });
  return res.status(result.status).json(result.body);
};

app.post('/api/tablets/claim', handleTabletClaim);
app.get('/api/tablets/claim', handleTabletClaim);

app.get('/tablet-claim', async (req, res) => {
  const token = (req.query?.token || '').toString().trim();
  const deviceId = (req.query?.deviceId || '').toString().trim();
  const deviceLabel = (req.query?.deviceLabel || '').toString().trim();
  const mesaParam = (req.query?.mesa || '').toString().trim();
  const slugParam = (req.query?.slug || '').toString().trim();
  const result = await processTabletClaim({ token, deviceId, deviceLabel, req });
  if (result.status !== 200 || !result.row) {
    return res.status(result.status).send('<h1>Falha ao vincular tablet.</h1>');
  }
  const storeId = result.row.store_id;
  const tableNumber = mesaParam || result.row.table_number;
  const { rows } = await query('SELECT id, data FROM stores WHERE id = $1', [storeId]);
  const storeData = rows[0]?.data || {};
  const custom = (storeData.customUrl || '').toString().trim();
  const name = (storeData.name || '').toString().trim();
  const slug = slugParam || custom || name || storeId;
  const safeSlug = normalizeSlug(slug);
  const redirectUrl = `https://app.menufaz.com/${safeSlug}?mesa=${encodeURIComponent(tableNumber)}&tablet=1&tablet_token=${encodeURIComponent(token)}&tablet_device_id=${encodeURIComponent(deviceId)}`;
  return res.redirect(302, redirectUrl);
});

app.get('/api/tablets', async (req, res) => {
  const authPayload = getAuthPayload(req);
  if (!authPayload) return res.status(401).json({ error: 'unauthorized' });
  const storeId = await getStoreIdFromAuth(authPayload, String(req.query?.storeId || ''));
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  const { rows } = await query(
    `
    SELECT id, table_number, token, device_id, device_label, created_at, expires_at, last_seen, revoked_at
    FROM tablet_devices
    WHERE store_id = $1
    ORDER BY created_at DESC
    `,
    [storeId]
  );
  res.json(rows);
});

app.get('/api/tablets/events', async (req, res) => {
  const authPayload = getAuthPayload(req);
  if (!authPayload) return res.status(401).json({ error: 'unauthorized' });
  const storeId = await getStoreIdFromAuth(authPayload, String(req.query?.storeId || ''));
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  const { rows } = await query(
    `
    SELECT id, table_number, token, device_id, device_label, event_type, user_agent, ip_address, created_at
    FROM tablet_device_events
    WHERE store_id = $1
    ORDER BY created_at DESC
    LIMIT 50
    `,
    [storeId]
  );
  res.json(rows);
});

app.post('/api/tablet/bill/pay/pix', async (req, res) => {
  const storeId = (req.body?.storeId || req.query?.storeId || '').toString().trim();
  const tableNumber = (req.body?.tableNumber || req.query?.tableNumber || '').toString().trim();
  const tableSessionId = (req.body?.tableSessionId || req.query?.tableSessionId || '').toString().trim();
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  if (!tableNumber) return res.status(400).json({ error: 'tableNumber required' });
  if (!tableSessionId) return res.status(400).json({ error: 'tableSessionId required' });

  const { rows: storeRows } = await query('SELECT data FROM stores WHERE id = $1', [storeId]);
  const storeData = storeRows[0]?.data || {};
  if (!storeData?.pix_enabled) {
    return res.status(400).json({ error: 'PIX Repasse não habilitado para esta loja.' });
  }
  if (!storeData.pix_hash_recebedor_01 || !storeData.pix_hash_recebedor_02) {
    return res.status(400).json({ error: 'PIX Repasse sem hashes configurados.' });
  }
  if (!storeData.pix_identificacao_pdv) {
    return res.status(422).json({ error: 'PIX Repasse sem identificacao PDV configurada.' });
  }

  const { rows: orderRows } = await query(
    `
    SELECT id, data, status
    FROM orders
    WHERE store_id = $1
      AND data->>'tableNumber' = $2
      AND data->>'tableSessionId' = $3
      AND status NOT IN ('COMPLETED', 'CANCELLED')
    `,
    [storeId, tableNumber, tableSessionId]
  );

  if (orderRows.length === 0) {
    return res.status(404).json({ error: 'Nenhum pedido ativo para esta mesa.' });
  }

  const orderIds = orderRows.map((row) => row.id);
  const total = orderRows.reduce((sum, row) => sum + Number(row.data?.total || 0), 0);
  if (!Number.isFinite(total) || total <= 0) {
    return res.status(400).json({ error: 'Valor inválido para cobrança.' });
  }

  const { rows: existingRows } = await query(
    `
    SELECT id, valor, qr_code, id_solicitacao, timestamp_limite, status_local
    FROM table_payments
    WHERE store_id = $1
      AND table_number = $2
      AND table_session_id = $3
      AND status_local = 'PENDING'
      AND timestamp_limite > NOW()
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [storeId, tableNumber, tableSessionId]
  );
  if (existingRows.length > 0) {
    const existing = existingRows[0];
    return res.json({
      paymentId: existing.id,
      total,
      qrCode: existing.qr_code,
      expiresAt: existing.timestamp_limite,
      idSolicitacao: existing.id_solicitacao,
      status: existing.status_local
    });
  }

  const timestampLimiteSolicitacao = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const paymentResult = await createSolicitacaoPixRepasse({
    identificacaoPDV: storeData.pix_identificacao_pdv,
    timestampLimiteSolicitacao,
    valorSolicitacao: Number(total.toFixed(2)),
    hashIdentificadorRecebedor01: storeData.pix_hash_recebedor_01,
    hashIdentificadorRecebedor02: storeData.pix_hash_recebedor_02,
    baseUrl: pixRepasseBaseUrl,
    tokenApiExterna: pixRepasseToken
  });

  if (!paymentResult?.ok) {
    return res.status(502).json({ error: paymentResult?.message || 'Falha ao criar cobrança PIX.' });
  }

  const mapped = mapPixRepasseResponse(paymentResult.data || {});
  const idSolicitacao = mapped.idSolicitacao || null;
  const qrCode = mapped.qrCode || null;
  const { rows: paymentRows } = await query(
    `
    INSERT INTO table_payments (store_id, table_number, table_session_id, order_ids, valor, id_solicitacao, timestamp_limite, qr_code)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [storeId, tableNumber, tableSessionId, JSON.stringify(orderIds), total, idSolicitacao, timestampLimiteSolicitacao, qrCode]
  );

  res.json({
    paymentId: paymentRows?.[0]?.id,
    total,
    qrCode,
    expiresAt: timestampLimiteSolicitacao,
    idSolicitacao,
    status: 'PENDING'
  });
});

app.post('/api/tablets/revoke', async (req, res) => {
  const authPayload = getAuthPayload(req);
  if (!authPayload) return res.status(401).json({ error: 'unauthorized' });
  const storeId = await getStoreIdFromAuth(authPayload, String(req.body?.storeId || req.query?.storeId || ''));
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  const tabletId = (req.body?.tabletId || '').toString().trim();
  if (!tabletId) return res.status(400).json({ error: 'tabletId required' });

  const { rows } = await query(
    `
    SELECT id, table_number, token, device_id, device_label, revoked_at
    FROM tablet_devices
    WHERE id = $1
      AND store_id = $2
    `,
    [tabletId, storeId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const row = rows[0];
  if (!row.revoked_at) {
    await query(
      `
      UPDATE tablet_devices
      SET revoked_at = NOW()
      WHERE id = $1
        AND store_id = $2
        AND revoked_at IS NULL
      `,
      [tabletId, storeId]
    );
    await query(
      `
      INSERT INTO tablet_device_events (store_id, table_number, token, device_id, device_label, event_type, user_agent, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        storeId,
        row.table_number,
        row.token,
        row.device_id || null,
        row.device_label || null,
        'revoked',
        (req.headers['user-agent'] || '').toString().slice(0, 300),
        (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 120)
      ]
    );
  }
  res.json({ ok: true });
});

app.get('/api/sse/table-payments/:tableSessionId', async (req, res) => {
  const storeId = (req.query?.storeId || '').toString().trim();
  const tableNumber = (req.query?.tableNumber || '').toString().trim();
  const tableSessionId = (req.params.tableSessionId || '').toString().trim();
  if (!storeId || !tableNumber || !tableSessionId) {
    return res.status(400).json({ error: 'storeId, tableNumber, tableSessionId required' });
  }

  const { rows: paymentRows } = await query(
    `
    SELECT *
    FROM table_payments
    WHERE store_id = $1
      AND table_number = $2
      AND table_session_id = $3
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [storeId, tableNumber, tableSessionId]
  );
  if (paymentRows.length === 0) return res.status(404).json({ error: 'payment not found' });
  let paymentRow = paymentRows[0];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sendStatus = () => {
    sendEvent('status', {
      paymentId: paymentRow.id,
      status: paymentRow.status_local,
      qrCode: paymentRow.qr_code,
      expiresAt: paymentRow.timestamp_limite
    });
  };

  sendEvent('connected', { paymentId: paymentRow.id });
  sendStatus();

  let closed = false;
  let pollInterval = null;
  let pingInterval = null;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (pollInterval) clearInterval(pollInterval);
    if (pingInterval) clearInterval(pingInterval);
  };

  const poll = async () => {
    try {
      if (!paymentRow.id_solicitacao) return;
      if (paymentRow.timestamp_limite && new Date(paymentRow.timestamp_limite).getTime() <= Date.now()) {
        await updateTablePaymentRow({
          paymentId: paymentRow.id,
          statusLocal: ORDER_PAYMENT_STATUS.expired
        });
        paymentRow.status_local = ORDER_PAYMENT_STATUS.expired;
        sendStatus();
        return;
      }
      const statusResponse = await consultarStatusPixRepasse({
        idSolicitacao: paymentRow.id_solicitacao,
        baseUrl: pixRepasseBaseUrl,
        tokenApiExterna: pixRepasseToken
      });
      if (!statusResponse.ok) return;
      const mapped = mapPixRepasseResponse(statusResponse.data || {});
      const statusLocal = resolvePixStatusLocal({
        codigoEstadoPagamento: mapped.codigoEstadoPagamento,
        codigoEstadoSolicitacao: mapped.codigoEstadoSolicitacao,
        timestampLimite: paymentRow.timestamp_limite
      });
      await updateTablePaymentRow({
        paymentId: paymentRow.id,
        statusLocal
      });
      paymentRow = { ...paymentRow, status_local: statusLocal };
      if (statusLocal === ORDER_PAYMENT_STATUS.paid) {
        await updateOrdersForTablePayment({
          orderIds: paymentRow.order_ids || [],
          statusLocal
        });
      }
      sendStatus();
    } catch {
    }
  };

  pollInterval = setInterval(poll, 8000);
  pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  req.on('close', cleanup);
});

app.get('/api/empresa/pagamentos/pix-repasse', async (req, res) => {
  const authPayload = getAuthPayload(req);
  if (!authPayload) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const storeId = await getStoreIdFromAuth(authPayload, String(req.query?.storeId || ''));
  if (!storeId) {
    return res.status(400).json({ error: 'storeId required' });
  }
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [storeId]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(buildPixConfigResponse(rows[0].data || {}));
});

app.put('/api/empresa/pagamentos/pix-repasse', async (req, res) => {
  const authPayload = getAuthPayload(req);
  if (!authPayload) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const storeId = await getStoreIdFromAuth(authPayload, String(req.body?.storeId || req.query?.storeId || ''));
  if (!storeId) {
    return res.status(400).json({ error: 'storeId required' });
  }
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [storeId]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const storeData = rows[0].data || {};
  const incoming = normalizePixRepasseInput(req.body || {});
  const existingPix = extractPixRepasseFields(storeData);
  const hash1 =
    incoming.pix_hash_recebedor_01 && !incoming.pix_hash_recebedor_01.includes('*')
      ? incoming.pix_hash_recebedor_01
      : existingPix.pix_hash_recebedor_01;
  const hash2 =
    incoming.pix_hash_recebedor_02 && !incoming.pix_hash_recebedor_02.includes('*')
      ? incoming.pix_hash_recebedor_02
      : existingPix.pix_hash_recebedor_02;
  const pixEnabled = incoming.pix_enabled;

  if (pixEnabled && (!hash1 || !hash2)) {
    return res.status(400).json({ error: 'pix hashes required' });
  }

  let identificacao = existingPix.pix_identificacao_pdv;
  if (pixEnabled && !identificacao) {
    identificacao = crypto.randomUUID();
  }

  const nextData = {
    ...storeData,
    pix_enabled: pixEnabled,
    pix_hash_recebedor_01: hash1 || '',
    pix_hash_recebedor_02: hash2 || '',
    pix_identificacao_pdv: identificacao || ''
  };

  await query('UPDATE stores SET data = $1 WHERE id = $2', [nextData, storeId]);
  res.json(buildPixConfigResponse(nextData));
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
  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password;
  const phone = payload.phone;
  const storeData = payload.store || {};

  if (!email || !password || !ownerName) {
    return res.status(400).json({ error: 'ownerName, email, and password are required' });
  }

  const existing = await query('SELECT id FROM users WHERE lower(email) = $1', [email]);
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

    const storeResult = await client.query(
      'INSERT INTO stores (owner_id, city, data) VALUES ($1, $2, $3) RETURNING id',
      [userId, fullStoreData.city || null, fullStoreData]
    );
    const storeId = storeResult.rows[0]?.id;
    if (storeId) {
      await client.query(
        'UPDATE profiles SET data = data || $1 WHERE user_id = $2',
        [{ storeId }, userId]
      );
    }
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

const getStoreNeighborhoodList = (storeData = {}) => {
  if (Array.isArray(storeData.neighborhoodFees)) return storeData.neighborhoodFees;
  if (Array.isArray(storeData.deliveryNeighborhoods)) return storeData.deliveryNeighborhoods;
  return [];
};

app.post('/api/stores/:id/neighborhoods/import', async (req, res) => {
  const storeId = req.params.id;
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [storeId]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  const storeData = rows[0].data || {};
  const city = String(req.body?.city || storeData.city || '').trim();
  const state = String(req.body?.state || storeData.state || '').trim();
  if (!city) return res.status(400).json({ error: 'city required' });

  const existingList = getStoreNeighborhoodList(storeData);
  const existingKeys = new Set(
    existingList
      .map((item) => normalizeNeighborhoodName(item?.name))
      .filter(Boolean)
  );
  const prevState = storeData.neighborhoodImportState || {};
  const normalizedCity = normalizeNeighborhoodName(city);
  const normalizedState = normalizeNeighborhoodName(state);
  const prevCity = normalizeNeighborhoodName(prevState.city || '');
  const prevStateCode = normalizeNeighborhoodName(prevState.state || '');
  const shouldReset = (prevCity && prevCity !== normalizedCity) || (prevStateCode && normalizedState && prevStateCode !== normalizedState);

  const runsCount = shouldReset ? 0 : Number(prevState.runsCount || 0);
  const nextGridIndex = shouldReset ? 0 : Number(prevState.nextGridIndex || 0);
  const nextKeywordIndex = shouldReset ? 0 : Number(prevState.nextKeywordIndex || 0);
  const ignoredKeys = new Set([
    ...(Array.isArray(prevState.ignoredKeys) && !shouldReset ? prevState.ignoredKeys : []),
    ...existingKeys
  ]);

  const { neighborhoods, error, meta } = await fetchGoogleNeighborhoodsIncremental(city, state, {
    ignoreSet: ignoredKeys,
    gridIndex: nextGridIndex,
    keywordIndex: nextKeywordIndex,
    runIndex: runsCount,
    batchSize: 20
  });

  if (error && error.status && error.status !== 'ZERO_RESULTS') {
    return res.json({
      neighborhoods: [],
      addedCount: 0,
      totalCount: existingList.length,
      meta: {
        partial: true,
        error: 'google_api_error',
        googleStatus: error.status,
        message: error.message || 'Google API error'
      },
      neighborhoodImportState: storeData.neighborhoodImportState || {},
      neighborhoodFeesImportedAt: storeData.neighborhoodFeesImportedAt || null,
      neighborhoodFeesSource: storeData.neighborhoodFeesSource || null
    });
  }

  const added = Array.isArray(neighborhoods) ? neighborhoods : [];
  const addedItems = added.map((name) => ({
    name,
    active: true,
    fee: 0
  }));
  const mergedList = existingList.concat(addedItems);
  const importedAt = new Date().toISOString();
  const updatedIgnored = new Set([...ignoredKeys, ...added.map((name) => normalizeNeighborhoodName(name))].filter(Boolean));
  const nextState = {
    city,
    state,
    ignoredKeys: Array.from(updatedIgnored),
    lastRunAt: importedAt,
    runsCount: runsCount + 1,
    lastRequestsCount: meta?.requestCount || 0,
    lastNearbyRequests: meta?.nearbyRequestCount || 0,
    lastDetailRequests: meta?.detailRequestCount || 0,
    lastTextRequests: meta?.textRequestCount || 0,
    lastRawResultsCount: meta?.rawResultsCount || 0,
    lastExtractedCount: meta?.extractedCount || 0,
    lastIgnoredCount: meta?.ignoredCount || 0,
    lastDuplicateCount: meta?.duplicateCount || 0,
    lastPointsProcessed: meta?.pointsProcessed || 0,
    lastKeyword: meta?.keyword || null,
    lastRadius: meta?.radius || null,
    lastGridIndexStart: meta?.gridIndexStart ?? null,
    lastGridIndexEnd: meta?.gridIndexEnd ?? null,
    lastResultCount: added.length,
    nextGridIndex: meta?.nextGridIndex ?? nextGridIndex,
    nextKeywordIndex: meta?.nextKeywordIndex ?? nextKeywordIndex
  };

  const nextData = {
    ...storeData,
    deliveryFeeMode: 'BY_NEIGHBORHOOD',
    deliveryNeighborhoods: mergedList,
    neighborhoodFees: mergedList,
    neighborhoodFeesImportedAt: importedAt,
    neighborhoodFeesSource: 'google',
    neighborhoodImportState: nextState
  };

  await updateStoreData(storeId, nextData);

  console.log('[neighborhood-import]', {
    storeId,
    city,
    state,
    addedCount: added.length,
    totalCount: mergedList.length,
    meta
  });

  res.json({
    neighborhoods: mergedList,
    addedCount: added.length,
    totalCount: mergedList.length,
    sampleAdded: added.slice(0, 10),
    meta: meta || { partial: false, requestCount: 0 },
    neighborhoodImportState: nextState,
    neighborhoodFeesImportedAt: importedAt,
    neighborhoodFeesSource: 'google'
  });
});

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
    nextChangeAt: availability.nextChangeAt,
    nextOpenAt: availability.nextOpenAt,
    nextCloseAt: availability.nextCloseAt,
    hasSchedule: availability.hasSchedule
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
      deliveryFeeMode: 'FIXED',
      deliveryNeighborhoods: [],
      neighborhoodFees: [],
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

    const storeResult = await client.query(
      'INSERT INTO stores (owner_id, city, data) VALUES ($1, $2, $3) RETURNING id',
      [userId, payload.city || null, storeData]
    );
    const storeId = storeResult.rows[0]?.id;
    if (storeId) {
      await client.query(
        'UPDATE profiles SET data = data || $1 WHERE user_id = $2',
        [{ storeId }, userId]
      );
    }
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

const isImageKitReady = () =>
  Boolean(imagekitPrivateKey && imagekitPublicKey && imagekitUrlEndpoint);

app.post('/api/imagekit/upload', requireAuth, async (req, res) => {
  const role = req.user?.role || '';
  if (role !== 'ADMIN' && role !== 'BUSINESS') {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!isImageKitReady()) {
    return res.status(500).json({ error: 'imagekit_not_configured' });
  }

  const MAX_BYTES = 10 * 1024 * 1024;
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

  const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES, files: 1 } });
  let fileBuffer = [];
  let fileMime = '';
  let fileName = '';
  let hasFile = false;
  let invalidType = false;
  let tooLarge = false;
  let fileHandled = false;

  busboy.on('file', (field, file, info) => {
    if (field !== 'file' || fileHandled) {
      file.resume();
      return;
    }
    fileHandled = true;
    hasFile = true;
    fileMime = info?.mimeType || '';
    fileName = path.basename(info?.filename || 'upload');

    if (!allowedTypes.has(fileMime)) {
      invalidType = true;
      file.resume();
      return;
    }

    file.on('data', (data) => {
      fileBuffer.push(data);
    });
    file.on('limit', () => {
      tooLarge = true;
      file.resume();
    });
  });

  busboy.on('error', () => {
    return res.status(400).json({ error: 'invalid_multipart' });
  });

  busboy.on('finish', async () => {
    if (!hasFile) {
      return res.status(400).json({ error: 'file_required' });
    }
    if (invalidType) {
      return res.status(400).json({ error: 'invalid_file_type' });
    }
    if (tooLarge) {
      return res.status(413).json({ error: 'file_too_large' });
    }

    const buffer = Buffer.concat(fileBuffer);
    try {
      const data = await imageKitClient().files.upload({
        file: buffer.toString('base64'),
        fileName
      });
      const normalizedEndpoint = imagekitUrlEndpoint.replace(/\/+$/, '');
      const normalizedPath = String(data.filePath || '').startsWith('/')
        ? data.filePath
        : `/${data.filePath}`;
      return res.json({
        ok: true,
        url: data.url || `${normalizedEndpoint}${normalizedPath}`,
        fileId: data.fileId,
        name: data.name,
        filePath: data.filePath
      });
    } catch (error) {
      console.error('Failed to upload ImageKit file', error);
      return res.status(500).json({ error: 'imagekit_upload_failed' });
    }
  });

  req.pipe(busboy);
});

app.delete('/api/imagekit/files/:fileId', requireAuth, async (req, res) => {
  if (!imagekitPrivateKey) {
    return res.status(500).json({ error: 'imagekit not configured' });
  }
  const fileId = String(req.params.fileId || '');
  if (!fileId || fileId === 'undefined' || fileId === 'null') {
    return res.json({ ok: true, alreadyMissing: true });
  }

  try {
    const auth = Buffer.from(`${imagekitPrivateKey}:`).toString('base64');
    const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}` }
    });
    if (response.status === 404) {
      return res.json({ ok: true, alreadyMissing: true });
    }
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
      console.warn('Gemini recommendation failed', response.status);
      return res.json({
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
  res.json(mapRows(rows).map(stripSplitSurcharge).map(stripStockQty));
});

app.post('/api/products', async (req, res) => {
  const payload = stripSplitSurcharge(req.body || {});
  if (typeof payload.stock_qty !== 'number') {
    payload.stock_qty = 0;
  }
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
  const { rows } = await query('SELECT data FROM products WHERE id = $1', [req.params.id]);
  const existing = rows[0]?.data || {};
  const stockQty =
    typeof payload.stock_qty === 'number'
      ? payload.stock_qty
      : typeof existing.stock_qty === 'number'
      ? existing.stock_qty
      : 0;
  const nextPayload = { ...payload, stock_qty: stockQty };
  await query('UPDATE products SET data = $1, store_id = $2 WHERE id = $3', [
    nextPayload,
    payload.storeId || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...nextPayload });
});

app.delete('/api/products/:id', async (req, res) => {
  await query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/merchant/products', requireAuth, async (req, res) => {
  const authPayload = getAuthPayload(req);
  const storeId = await getStoreIdFromAuth(authPayload, String(req.query?.storeId || ''));
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  const { rows } = await query('SELECT id, data FROM products WHERE store_id = $1', [storeId]);
  res.json(mapRows(rows).map(stripSplitSurcharge));
});

app.patch('/api/merchant/products/:id/stock', requireAuth, async (req, res) => {
  const authPayload = getAuthPayload(req);
  const storeId = await getStoreIdFromAuth(authPayload, String(req.body?.storeId || req.query?.storeId || ''));
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  const rawQty = req.body?.stock_qty;
  const parsedQty = Number(rawQty);
  if (!Number.isFinite(parsedQty)) {
    return res.status(400).json({ error: 'stock_qty must be a number' });
  }
  const stock_qty = Math.trunc(parsedQty);
  const { rows } = await query('SELECT data, store_id FROM products WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const productStoreId = rows[0].store_id;
  if (productStoreId !== storeId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const existing = rows[0].data || {};
  const nextData = { ...existing, stock_qty };
  await query('UPDATE products SET data = $1 WHERE id = $2', [nextData, req.params.id]);
  res.json({ id: req.params.id, ...nextData });
});

const normalizeLinkedCategoryIds = (linkedCategoryIds, allowedCategories) => {
  if (!Array.isArray(linkedCategoryIds)) return undefined;
  const seen = new Set();
  const normalized = [];
  linkedCategoryIds.forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    if (allowedCategories && !allowedCategories.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });
  return normalized.length > 0 ? normalized : undefined;
};

const getStoreCategorySet = async (storeId) => {
  if (!storeId) return null;
  const { rows } = await query('SELECT data FROM stores WHERE id = $1', [storeId]);
  if (!rows[0]) return null;
  const menuCategories = rows[0].data?.menuCategories;
  if (!Array.isArray(menuCategories)) return null;
  const allowed = new Set();
  menuCategories.forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    allowed.add(trimmed.toLowerCase());
  });
  return allowed;
};

// --- Option Group Templates ---
app.get('/api/option-group-templates', async (req, res) => {
  const storeId = req.query.storeId;
  const { rows } = await query(
    storeId
      ? 'SELECT id, data FROM option_group_templates WHERE store_id = $1'
      : 'SELECT id, data FROM option_group_templates',
    storeId ? [storeId] : []
  );
  res.json(mapRows(rows));
});

app.post('/api/option-group-templates', async (req, res) => {
  const payload = req.body || {};
  if (!payload.storeId) return res.status(400).json({ error: 'storeId required' });
  const allowedCategories = await getStoreCategorySet(payload.storeId);
  payload.linkedCategoryIds = normalizeLinkedCategoryIds(payload.linkedCategoryIds, allowedCategories);
  if (!payload.linkedCategoryIds) delete payload.linkedCategoryIds;
  const { rows } = await query(
    'INSERT INTO option_group_templates (store_id, data) VALUES ($1, $2) RETURNING id',
    [payload.storeId || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
});

app.put('/api/option-group-templates/:id', async (req, res) => {
  const payload = req.body || {};
  if (!payload.storeId) return res.status(400).json({ error: 'storeId required' });
  const allowedCategories = await getStoreCategorySet(payload.storeId);
  payload.linkedCategoryIds = normalizeLinkedCategoryIds(payload.linkedCategoryIds, allowedCategories);
  if (!payload.linkedCategoryIds) delete payload.linkedCategoryIds;
  await query('UPDATE option_group_templates SET data = $1, store_id = $2 WHERE id = $3', [
    payload,
    payload.storeId || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...payload });
});

app.delete('/api/option-group-templates/:id', async (req, res) => {
  await query('DELETE FROM option_group_templates WHERE id = $1', [req.params.id]);
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

const haversineDistanceMeters = (coord1, coord2) => {
  if (!isValidCoords(coord1) || !isValidCoords(coord2)) return Infinity;
  const R = 6371000;
  const dLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const dLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;
  const lat1 = (coord1.lat * Math.PI) / 180;
  const lat2 = (coord2.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const isPointInPolygon = (point, polygon = []) => {
  if (!isValidCoords(point) || !Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.lng);
  const y = Number(point.lat);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].lng);
    const yi = Number(polygon[i].lat);
    const xj = Number(polygon[j].lng);
    const yj = Number(polygon[j].lat);
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

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

const sanitizeGoogleUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('key')) parsed.searchParams.set('key', 'REDACTED');
    return parsed.toString();
  } catch {
    return url;
  }
};

const logGoogleApiResult = (context, url, httpStatus, data) => {
  const googleStatus = data?.status || null;
  const message = data?.error_message || null;
  console.info('[google-api]', {
    context,
    url: sanitizeGoogleUrl(url),
    httpStatus,
    googleStatus,
    message
  });
};

const fetchGoogleGeocode = async ({ address, lat, lng, returnDetails = false } = {}) => {
  if (!GOOGLE_MAPS_API_KEY) {
    if (returnDetails) {
      return { results: null, status: 'NO_API_KEY', errorMessage: 'Google API key not configured', httpStatus: 0 };
    }
    return null;
  }
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
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    logGoogleApiResult('geocode', url, response.status, data);
    if (!response.ok) {
      if (returnDetails) {
        return {
          results: null,
          status: data?.status || 'HTTP_ERROR',
          errorMessage: data?.error_message || `HTTP ${response.status}`,
          httpStatus: response.status
        };
      }
      return null;
    }
    if (!data || !Array.isArray(data.results)) {
      if (returnDetails) {
        return {
          results: null,
          status: data?.status || 'INVALID_RESPONSE',
          errorMessage: data?.error_message || 'Invalid geocode response',
          httpStatus: response.status
        };
      }
      return null;
    }
    if (returnDetails) {
      return {
        results: data.results,
        status: data.status,
        errorMessage: data.error_message || null,
        httpStatus: response.status
      };
    }
    if (data.status !== 'OK') {
      return null;
    }
    return data.results;
  } catch (error) {
    console.warn('Google geocode failed', error);
    if (returnDetails) {
      return { results: null, status: 'FETCH_FAILED', errorMessage: String(error), httpStatus: 0 };
    }
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchGooglePlacesNearby = async (params) => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
  try {
    const response = await fetchWithTimeout(url);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    logGoogleApiResult('places-nearby', url, response.status, data);
    if (!response.ok) {
      return {
        status: data?.status || 'HTTP_ERROR',
        errorMessage: data?.error_message || `HTTP ${response.status}`,
        results: []
      };
    }
    return data;
  } catch (error) {
    console.warn('Google places nearby failed', error);
    return { status: 'FETCH_FAILED', errorMessage: String(error), results: [] };
  }
};

const fetchGooglePlacesTextSearch = async (params) => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
  try {
    const response = await fetchWithTimeout(url);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    logGoogleApiResult('places-text', url, response.status, data);
    if (!response.ok) {
      return {
        status: data?.status || 'HTTP_ERROR',
        errorMessage: data?.error_message || `HTTP ${response.status}`,
        results: []
      };
    }
    return data;
  } catch (error) {
    console.warn('Google places text search failed', error);
    return { status: 'FETCH_FAILED', errorMessage: String(error), results: [] };
  }
};

const neighborhoodCache = new Map();
const NEIGHBORHOOD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NEIGHBORHOOD_REQUESTS = 200;
const RESERVED_DETAIL_REQUESTS = 80;
const NEARBY_PAGES_ESTIMATE = 2;

const extractNeighborhoodFromDetails = (data) => {
  const components = data?.result?.address_components || [];
  const pick = (type) => components.find((comp) => Array.isArray(comp.types) && comp.types.includes(type));
  const candidate =
    pick('sublocality_level_1') ||
    pick('sublocality') ||
    pick('neighborhood') ||
    pick('political');
  const name = (candidate?.long_name || '').toString().trim();
  if (name) return name;
  const resultName = (data?.result?.name || '').toString().trim();
  const resultTypes = Array.isArray(data?.result?.types) ? data.result.types : [];
  const normalized = normalizeNeighborhoodName(resultName);
  const keywordMatch = ['bairro', 'vila', 'jardim', 'centro'].some((keyword) => normalized.includes(keyword));
  const typeMatch = resultTypes.some((type) =>
    ['sublocality_level_1', 'sublocality', 'neighborhood'].includes(type)
  );
  if (resultName && (keywordMatch || typeMatch)) return resultName;
  return '';
};

const fetchGooglePlaceDetails = async (placeId) => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const params = new URLSearchParams({
    key: GOOGLE_MAPS_API_KEY,
    language: 'pt-BR',
    region: 'br',
    place_id: placeId,
    fields: 'address_component'
  });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
  try {
    const response = await fetchWithTimeout(url);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    logGoogleApiResult('place-details', url, response.status, data);
    if (!response.ok) {
      return {
        status: data?.status || 'HTTP_ERROR',
        errorMessage: data?.error_message || `HTTP ${response.status}`,
        result: null
      };
    }
    return data;
  } catch (error) {
    console.warn('Google place details failed', error);
    return { status: 'FETCH_FAILED', errorMessage: String(error), result: null };
  }
};

const buildGridPoints = (bounds, maxPoints) => {
  if (!bounds) return [];
  const sw = bounds.southwest;
  const ne = bounds.northeast;
  const latSpan = Math.abs(ne.lat - sw.lat);
  const lngSpan = Math.abs(ne.lng - sw.lng);
  const maxSpan = Math.max(latSpan, lngSpan);
  let gridSize = 5;
  if (maxSpan > 0.6) gridSize = 7;
  if (maxSpan < 0.15) gridSize = 3;
  if (maxPoints && Number.isFinite(maxPoints)) {
    const maxGrid = Math.max(2, Math.floor(Math.sqrt(maxPoints)));
    gridSize = Math.min(gridSize, maxGrid);
  }
  const latStep = latSpan / Math.max(1, gridSize - 1);
  const lngStep = lngSpan / Math.max(1, gridSize - 1);
  const points = [];
  for (let i = 0; i < gridSize; i += 1) {
    for (let j = 0; j < gridSize; j += 1) {
      points.push({
        lat: sw.lat + latStep * i,
        lng: sw.lng + lngStep * j
      });
    }
  }
  if (maxPoints && points.length > maxPoints) {
    return points.slice(0, maxPoints);
  }
  return points;
};

const buildGridPointsFixed = (bounds, gridSize) => {
  if (!bounds) return [];
  const sw = bounds.southwest;
  const ne = bounds.northeast;
  const size = Math.max(2, Number(gridSize) || 5);
  const latSpan = Math.abs(ne.lat - sw.lat);
  const lngSpan = Math.abs(ne.lng - sw.lng);
  const latStep = latSpan / Math.max(1, size - 1);
  const lngStep = lngSpan / Math.max(1, size - 1);
  const points = [];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      points.push({
        lat: sw.lat + latStep * i,
        lng: sw.lng + lngStep * j
      });
    }
  }
  return points;
};

const collectGridBatch = (points, startIndex, batchSize) => {
  if (!Array.isArray(points) || points.length === 0) {
    return { batch: [], nextIndex: 0 };
  }
  const size = points.length;
  const start = Number.isFinite(startIndex) ? startIndex : 0;
  const total = Math.min(size, Math.max(1, Number(batchSize) || 1));
  const batch = [];
  for (let i = 0; i < total && start + i < size; i += 1) {
    batch.push(points[start + i]);
  }
  const nextIndex = start + batch.length >= size ? 0 : start + batch.length;
  return { batch, nextIndex };
};

const fetchGoogleNeighborhoodsIncremental = async (
  city,
  state,
  {
    ignoreSet = new Set(),
    gridIndex = 0,
    keywordIndex = 0,
    runIndex = 0,
    batchSize = 10
  } = {}
) => {
  if (!city) return { neighborhoods: [], error: { status: 'INVALID_REQUEST', message: 'city required' } };
  if (!GOOGLE_MAPS_API_KEY) {
    return { neighborhoods: [], error: { status: 'NO_API_KEY', message: 'Google API key not configured' } };
  }

  let requestCount = 0;
  let nearbyRequestCount = 0;
  let detailRequestCount = 0;
  let textRequestCount = 0;
  let rawResultsCount = 0;
  let extractedCount = 0;
  let ignoredCount = 0;
  let duplicateCount = 0;
  let pointsProcessed = 0;
  let partial = false;
  const statusCounts = {};
  const locationQuery = [city, state, 'Brasil'].filter(Boolean).join(', ');
  const geocodeDetails = await fetchGoogleGeocode({ address: locationQuery, returnDetails: true });
  requestCount += 1;
  const geocodeStatus = geocodeDetails?.status || null;
  if (geocodeStatus && geocodeStatus !== 'OK' && geocodeStatus !== 'ZERO_RESULTS') {
    return {
      neighborhoods: [],
      error: { status: geocodeStatus, message: geocodeDetails?.errorMessage || 'Google geocode error' }
    };
  }
  const geometry = geocodeDetails?.results?.[0]?.geometry || {};
  const bounds = geometry?.bounds || geometry?.viewport;
  const location = geometry?.location || null;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { neighborhoods: [], error: { status: geocodeStatus || 'ZERO_RESULTS', message: 'City not found' } };
  }

  const keywordsCycle = ['bairro', '', 'vila', 'jardim', 'centro'];
  const keyword = keywordsCycle[keywordIndex % keywordsCycle.length] ?? 'bairro';
  const radiusOptions = [3000, 6000, 9000, 15000, 20000];
  const radius = radiusOptions[runIndex % radiusOptions.length];
  const baseTypes = ['sublocality_level_1', 'sublocality', 'neighborhood', 'political'];
  const includeOpenType = runIndex % 2 === 1;
  const types = includeOpenType ? [...baseTypes, null] : baseTypes;
  const gridSpan = bounds
    ? Math.max(Math.abs(bounds.northeast.lat - bounds.southwest.lat), Math.abs(bounds.northeast.lng - bounds.southwest.lng))
    : 0;
  const gridSize = bounds ? (gridSpan > 1.5 ? 9 : gridSpan > 0.7 ? 7 : 5) : 5;
  const points = bounds ? buildGridPointsFixed(bounds, gridSize) : [{ lat, lng }];
  const gridIndexStart = Number.isFinite(gridIndex) ? gridIndex : 0;
  const { batch: batchPoints, nextIndex: nextGridIndex } = collectGridBatch(points, gridIndexStart, batchSize);

  const placeIds = new Set();
  const maxRequests = MAX_NEIGHBORHOOD_REQUESTS;
  const trackStatus = (status) => {
    if (!status) return;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  };

  for (const point of batchPoints) {
    pointsProcessed += 1;
    for (const type of types) {
      if (requestCount >= maxRequests) {
        partial = true;
        break;
      }
      let pageToken = null;
      for (let page = 0; page < 3; page += 1) {
        if (requestCount >= maxRequests) {
          partial = true;
          break;
        }
        if (!type && !keyword) {
          break;
        }
        const params = new URLSearchParams({
          key: GOOGLE_MAPS_API_KEY,
          language: 'pt-BR',
          region: 'br',
          location: `${point.lat},${point.lng}`,
          radius: String(radius)
        });
        if (keyword) params.set('keyword', keyword);
        if (type) params.set('type', type);
        if (pageToken) params.set('pagetoken', pageToken);
        const data = await fetchGooglePlacesNearby(params);
        requestCount += 1;
        nearbyRequestCount += 1;
        if (!data) break;
        trackStatus(data.status);
        if (data.status === 'INVALID_REQUEST' && pageToken) {
          await sleep(1500);
          page -= 1;
          continue;
        }
        if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          return {
            neighborhoods: [],
            error: { status: data.status, message: data.error_message || 'Google places error' }
          };
        }
        const results = data.results || [];
        rawResultsCount += results.length;
        for (const item of results) {
          if (item?.place_id) placeIds.add(item.place_id);
        }
        pageToken = data.next_page_token;
        if (!pageToken) break;
        await sleep(1500);
      }
    }
    if (partial) break;
  }

  const textKeywords = ['bairro', 'vila', 'jardim', 'centro'];
  const textKeyword = textKeywords[runIndex % textKeywords.length] || 'bairro';
  const textQueries = [];
  const primaryQuery = [textKeyword, city, state].filter(Boolean).join(' ');
  if (primaryQuery) textQueries.push(primaryQuery);
  if (textKeyword !== 'bairro') {
    textQueries.push(['bairro', city, state].filter(Boolean).join(' '));
  }
  if (textKeyword !== 'centro') {
    textQueries.push(['centro', city, state].filter(Boolean).join(' '));
  }
  const textRadius = Math.min(radius * 2, 20000);
  if (requestCount < maxRequests && placeIds.size < 80) {
    for (const textQuery of textQueries) {
      if (!textQuery || requestCount >= maxRequests) break;
      let pageToken = null;
      for (let page = 0; page < 3; page += 1) {
        if (requestCount >= maxRequests) {
          partial = true;
          break;
        }
        const params = new URLSearchParams({
          key: GOOGLE_MAPS_API_KEY,
          language: 'pt-BR',
          region: 'br',
          query: textQuery,
          location: `${lat},${lng}`,
          radius: String(textRadius)
        });
        if (pageToken) params.set('pagetoken', pageToken);
        const data = await fetchGooglePlacesTextSearch(params);
        requestCount += 1;
        textRequestCount += 1;
        if (!data) break;
        trackStatus(data.status);
        if (data.status === 'INVALID_REQUEST' && pageToken) {
          await sleep(1500);
          page -= 1;
          continue;
        }
        if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          return {
            neighborhoods: [],
            error: { status: data.status, message: data.error_message || 'Google places error' }
          };
        }
        const results = data.results || [];
        rawResultsCount += results.length;
        for (const item of results) {
          if (item?.place_id) placeIds.add(item.place_id);
        }
        pageToken = data.next_page_token;
        if (!pageToken) break;
        await sleep(1500);
      }
    }
  }

  const names = new Map();
  for (const placeId of placeIds) {
    if (requestCount >= maxRequests) {
      partial = true;
      break;
    }
    const details = await fetchGooglePlaceDetails(placeId);
    requestCount += 1;
    detailRequestCount += 1;
    if (!details) continue;
    trackStatus(details.status);
    if (details.status && details.status !== 'OK') {
      if (details.status !== 'ZERO_RESULTS') {
        return {
          neighborhoods: [],
          error: { status: details.status, message: details.error_message || 'Google place details error' }
        };
      }
      continue;
    }
    const name = extractNeighborhoodFromDetails(details);
    if (!name) continue;
    extractedCount += 1;
    const key = normalizeNeighborhoodName(name);
    if (!key) continue;
    if (ignoreSet.has(key)) {
      ignoredCount += 1;
      continue;
    }
    if (names.has(key)) {
      duplicateCount += 1;
      continue;
    }
    names.set(key, name);
  }

  const neighborhoods = Array.from(names.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    neighborhoods,
    meta: {
      partial,
      requestCount,
      keyword: keyword || null,
      radius,
      batchSize: batchPoints.length,
      gridSize,
      nextGridIndex,
      nextKeywordIndex: (keywordIndex + 1) % keywordsCycle.length,
      gridIndexStart,
      gridIndexEnd: nextGridIndex,
      pointsProcessed,
      nearbyRequestCount,
      detailRequestCount,
      textRequestCount,
      rawResultsCount,
      extractedCount,
      ignoredCount,
      duplicateCount,
      placeIdsCount: placeIds.size,
      types: types.map((item) => item || 'any'),
      textQueries,
      statusCounts
    },
    error: null
  };
};

const fetchGoogleNeighborhoods = async (city, state) => {
  if (!city) return { neighborhoods: [], error: { status: 'INVALID_REQUEST', message: 'city required' } };
  if (!GOOGLE_MAPS_API_KEY) {
    return { neighborhoods: [], error: { status: 'NO_API_KEY', message: 'Google API key not configured' } };
  }

  const cacheKey = normalizeNeighborhoodName(`${city}-${state || ''}`);
  const cached = neighborhoodCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < NEIGHBORHOOD_CACHE_TTL_MS) {
    return cached.payload;
  }

  let requestCount = 0;
  let partial = false;
  const locationQuery = [city, state, 'Brasil'].filter(Boolean).join(', ');
  const geocodeDetails = await fetchGoogleGeocode({ address: locationQuery, returnDetails: true });
  requestCount += 1;
  const geocodeStatus = geocodeDetails?.status || null;
  if (geocodeStatus && geocodeStatus !== 'OK' && geocodeStatus !== 'ZERO_RESULTS') {
    return {
      neighborhoods: [],
      error: { status: geocodeStatus, message: geocodeDetails?.errorMessage || 'Google geocode error' }
    };
  }
  const geometry = geocodeDetails?.results?.[0]?.geometry || {};
  const bounds = geometry?.bounds || geometry?.viewport;
  const location = geometry?.location || null;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { neighborhoods: [], error: { status: geocodeStatus || 'ZERO_RESULTS', message: 'City not found' } };
  }

  const types = ['sublocality_level_1', 'sublocality', 'political'];
  const keywords = ['bairro', ''];
  const maxSearchRequests = Math.max(0, MAX_NEIGHBORHOOD_REQUESTS - RESERVED_DETAIL_REQUESTS);
  const requestsPerPoint = types.length * keywords.length * NEARBY_PAGES_ESTIMATE;
  const maxPoints = Math.max(1, Math.floor(maxSearchRequests / Math.max(1, requestsPerPoint)));
  const points = buildGridPoints(bounds, maxPoints);
  if (points.length === 0) {
    points.push({ lat, lng });
  }
  const placeIds = new Set();

  for (const point of points) {
    for (const type of types) {
      for (const keyword of keywords) {
        if (requestCount >= maxSearchRequests) {
          partial = true;
          break;
        }
        let pageToken = null;
        for (let page = 0; page < 3; page += 1) {
          if (requestCount >= maxSearchRequests) {
            partial = true;
            break;
          }
          const params = new URLSearchParams({
            key: GOOGLE_MAPS_API_KEY,
            language: 'pt-BR',
            region: 'br',
            location: `${point.lat},${point.lng}`,
            radius: '7000',
            type
          });
          if (keyword) params.set('keyword', keyword);
          if (pageToken) params.set('pagetoken', pageToken);
          const data = await fetchGooglePlacesNearby(params);
          requestCount += 1;
          if (!data) break;
          if (data.status === 'INVALID_REQUEST' && pageToken) {
            await sleep(1500);
            page -= 1;
            continue;
          }
          if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
            return {
              neighborhoods: [],
              error: { status: data.status, message: data.error_message || 'Google places error' }
            };
          }
          for (const item of data.results || []) {
            if (item?.place_id) placeIds.add(item.place_id);
          }
          pageToken = data.next_page_token;
          if (!pageToken) break;
          await sleep(1500);
        }
      }
      if (partial) break;
    }
    if (partial) break;
  }

  const names = new Map();
  for (const placeId of placeIds) {
    if (requestCount >= MAX_NEIGHBORHOOD_REQUESTS) {
      partial = true;
      break;
    }
    const details = await fetchGooglePlaceDetails(placeId);
    requestCount += 1;
    if (!details) continue;
    if (details.status && details.status !== 'OK') {
      if (details.status !== 'ZERO_RESULTS') {
        return {
          neighborhoods: [],
          error: { status: details.status, message: details.error_message || 'Google place details error' }
        };
      }
      continue;
    }
    const name = extractNeighborhoodFromDetails(details);
    if (!name) continue;
    const key = normalizeNeighborhoodName(name);
    if (!key || names.has(key)) continue;
    names.set(key, name);
  }

  const neighborhoods = Array.from(names.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const payload = {
    neighborhoods,
    meta: {
      partial,
      requestCount
    },
    error: null
  };
  if (neighborhoods.length > 0 || !partial) {
    neighborhoodCache.set(cacheKey, { timestamp: Date.now(), payload });
  }
  return payload;
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
  if (!hasAddressFields(address)) {
    return isValidCoords(coords) ? coords : null;
  }
  const resolved = await geocodeAddressCoordinates(address);
  if (resolved) return resolved;
  return isValidCoords(coords) ? coords : null;
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
    console.warn('Geocode search failed', error);
    res.json([]);
  }
});

app.get('/api/geocode/neighborhoods', async (req, res) => {
  const city = String(req.query.city || '').trim();
  const state = String(req.query.state || '').trim();
  if (!city) return res.status(400).json({ error: 'city required' });
  try {
    const { neighborhoods, error, meta } = await fetchGoogleNeighborhoods(city, state);
    if (error && error.status && error.status !== 'ZERO_RESULTS') {
      return res.json({
        neighborhoods: [],
        meta: {
          partial: true,
          error: 'google_api_error',
          googleStatus: error.status,
          message: error.message || 'Google API error'
        }
      });
    }
    res.json({
      neighborhoods,
      meta: meta || { partial: false, requestCount: 0 }
    });
  } catch (error) {
    console.warn('Failed to fetch neighborhoods', error);
    res.json({ neighborhoods: [], meta: { partial: true, requestCount: 0 } });
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
  let storeData = null;
  const authPayload = getAuthPayload(req);
  const paymentProvider =
    payload.paymentProvider ||
    (payload.paymentMethod === ORDER_PAYMENT_PROVIDER.pixRepasse ? ORDER_PAYMENT_PROVIDER.pixRepasse : null);
  const isPixRepasse = paymentProvider === ORDER_PAYMENT_PROVIDER.pixRepasse;
  const orderType =
    payload.type || (payload.pickup ? 'PICKUP' : payload.tableNumber ? 'TABLE' : 'DELIVERY');

  if (orderType === 'TABLE' && status === 'PENDING' && !isPixRepasse) {
    status = 'PREPARING';
    payload.autoAccepted = true;
    payload.autoAcceptedAt = new Date().toISOString();
  }

  if (payload.storeId && !isValidUuid(String(payload.storeId))) {
    return res.status(400).json({ error: 'invalid_store_id' });
  }

  if (payload.storeId) {
    const { rows: storeRows } = await query('SELECT data FROM stores WHERE id = $1', [payload.storeId]);
    storeData = storeRows[0]?.data || {};
  }

  if (isPixRepasse) {
    if (!storeData?.pix_enabled) {
      return res.status(400).json({ error: 'PIX Repasse não habilitado para esta loja.' });
    }
    if (!storeData.pix_hash_recebedor_01 || !storeData.pix_hash_recebedor_02) {
      return res.status(400).json({ error: 'PIX Repasse sem hashes configurados.' });
    }
    if (!storeData.pix_identificacao_pdv) {
      return res.status(422).json({ error: 'PIX Repasse sem identificacao PDV configurada.' });
    }
    payload.paymentProvider = ORDER_PAYMENT_PROVIDER.pixRepasse;
    payload.paymentStatus = ORDER_PAYMENT_STATUS.pending;
    if (storeData.autoAcceptOrders) {
      payload.autoAcceptEligible = true;
    }
  }

  if (authPayload) {
    const profileData = await getProfile(authPayload.sub);
    payload.userId = authPayload.sub;
    if (!payload.customerName) {
      payload.customerName = (profileData?.name || profileData?.email || '').trim();
    }
    if (!payload.customerPhone && profileData?.phone) {
      payload.customerPhone = profileData.phone;
    }
    if (!payload.cpf && profileData?.cpf) {
      payload.cpf = profileData.cpf;
    }
    if (orderType === 'DELIVERY' && !payload.deliveryAddress) {
      const addresses = Array.isArray(profileData?.addresses) ? profileData.addresses : [];
      if (addresses.length > 0) {
        const defaultAddress = addresses[0];
        payload.deliveryAddress = defaultAddress;
        if (!payload.deliveryCoordinates && defaultAddress?.coordinates) {
          payload.deliveryCoordinates = defaultAddress.coordinates;
        }
      }
    }
  }

  const deliveryAddress = payload.deliveryAddress || null;
  const customerPhone = payload.customerPhone ? String(payload.customerPhone) : '';
  const customerName = payload.customerName ? String(payload.customerName) : '';

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    return res.status(400).json({
      error: 'delivery address required'
    });
  }

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
        new Set(lineItems.map((item) => item?.productId).filter((id) => isValidUuid(String(id || ''))))
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
            .filter((id) => isValidUuid(String(id || '')))
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
    } catch (error) {
      return res.status(400).json({
        error: 'invalid pizza order',
        detail: error?.message || String(error)
      });
    }
  }

  const normalizedLineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  const lineItemsSubtotal = normalizedLineItems.reduce((sum, item) => sum + Number(item?.totalPrice || 0), 0);
  let resolvedDeliveryFee = 0;
  if (orderType === 'DELIVERY') {
    if (storeData?.acceptsDelivery === false) {
      return res.status(400).json({
        error: 'Esta loja não aceita pedidos para entrega.'
      });
    }
    if (storeData?.deliveryFeeMode === 'BY_NEIGHBORHOOD') {
      const neighborhoodResult = resolveDeliveryNeighborhood(
        storeData,
        payload.deliveryAddress || null
      );
      if (neighborhoodResult.error) {
        return res.status(400).json({ error: neighborhoodResult.error });
      }
      resolvedDeliveryFee = Number(neighborhoodResult.fee || 0);
      if (neighborhoodResult.neighborhood) {
        payload.deliveryNeighborhood = neighborhoodResult.neighborhood;
      }
    } else if (storeData?.deliveryFeeMode === 'BY_RADIUS') {
      const coords = payload.deliveryCoordinates || payload.deliveryAddress?.coordinates;
      const zoneResult = resolveDeliveryZone(storeData, coords);
      if (zoneResult.error) {
        return res.status(400).json({ error: zoneResult.error });
      }
      resolvedDeliveryFee = Number(zoneResult.fee || 0);
      if (zoneResult.zone) {
        payload.deliveryZoneId = zoneResult.zone.id;
        payload.deliveryZoneName = zoneResult.zone.name;
        if (zoneResult.etaMinutes !== undefined) {
          payload.deliveryEtaMinutes = zoneResult.etaMinutes;
        }
      }
    } else {
      resolvedDeliveryFee = Number(storeData?.deliveryFee || 0);
    }
  }
  payload.deliveryFee = resolvedDeliveryFee;
  payload.total = lineItemsSubtotal + resolvedDeliveryFee;
  const couponCodeRaw = (payload.couponCode || payload.coupon?.code || '').toString().trim();
  const couponIdRaw = (payload.couponId || payload.coupon?.id || '').toString().trim();
  if ((couponCodeRaw || couponIdRaw) && payload.storeId) {
    const couponQuery = couponIdRaw
      ? 'SELECT id, data FROM coupons WHERE id = $1 AND store_id = $2'
      : 'SELECT id, data FROM coupons WHERE upper(data->>\'code\') = $1 AND store_id = $2';
    const couponParams = couponIdRaw ? [couponIdRaw, payload.storeId] : [couponCodeRaw.toUpperCase(), payload.storeId];
    const { rows: couponRows } = await query(couponQuery, couponParams);
    const couponRow = couponRows[0];
    if (!couponRow) {
      return res.status(400).json({ error: 'Cupom inválido.' });
    }
    const couponData = couponRow.data || {};
    if (!couponData.isActive) {
      return res.status(400).json({ error: 'Cupom inativo.' });
    }
    if (couponData.expiresAt && new Date(couponData.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Cupom expirado.' });
    }
    if (couponData.usageLimit && couponData.usageCount >= couponData.usageLimit) {
      return res.status(400).json({ error: 'Cupom esgotado.' });
    }
    if (couponData.minOrderValue && lineItemsSubtotal < Number(couponData.minOrderValue || 0)) {
      return res.status(400).json({ error: `Pedido mínimo para este cupom é R$ ${couponData.minOrderValue}.` });
    }

    const baseDiscount =
      couponData.discountType === 'PERCENTAGE'
        ? (lineItemsSubtotal * Number(couponData.discountValue || 0)) / 100
        : Number(couponData.discountValue || 0);
    const appliedDiscount = Math.min(baseDiscount, lineItemsSubtotal);
    const deliveryFee = Number(payload.deliveryFee || 0);
    const baseTotal = Number(payload.total || lineItemsSubtotal + deliveryFee);
    payload.couponId = couponRow.id;
    payload.couponCode = couponData.code || couponCodeRaw.toUpperCase();
    payload.couponDiscount = appliedDiscount;
    payload.total = Math.max(0, baseTotal - appliedDiscount);
  }

  if (payload.storeId) {
    storeData = storeData || {};
    const allowOrdersWhenClosed = storeData.allowOrdersWhenClosed === true;
    const openStatus = resolveStoreOpenStatus(storeData);
    if (!openStatus.isOpenNow && !allowOrdersWhenClosed) {
      return res.status(400).json({
        error: 'Loja fechada no momento. Verifique os horários de funcionamento.'
      });
    }
    if (orderType === 'DELIVERY') {
      const deliveryMin = Number(storeData.delivery_min_order_value || 0);
      const effectiveSubtotal = Math.max(0, lineItemsSubtotal - Number(payload.couponDiscount || 0));
      if (Number.isFinite(deliveryMin) && deliveryMin > 0 && effectiveSubtotal < deliveryMin) {
        return res.status(400).json({ error: `Pedido mínimo para entrega: R$ ${deliveryMin}.` });
      }
    }
    if (storeData.autoAcceptOrders && status === 'PENDING' && !isPixRepasse) {
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
  const orderId = rows[0].id;
  const createdAt = rows[0].created_at;
  const responsePayload = { id: orderId, status, createdAt, ...payload };

  if (status === 'PREPARING') {
    try {
      await deductStockForOrder({ orderRow: { id: orderId, store_id: payload.storeId }, orderData: payload });
    } catch (error) {
      await logError({
        source: 'server',
        message: 'failed to deduct stock on create',
        stack: error?.stack,
        context: { route: 'POST /api/orders', orderId }
      });
    }
  }

  if (isPixRepasse) {
    try {
      const paymentResult = await ensurePixPaymentForOrder({
        orderId,
        storeData,
        valor: Number(payload.total || 0),
        forceNew: false
      });

      if (paymentResult?.error) {
        const nextData = { ...(payload || {}), paymentStatus: ORDER_PAYMENT_STATUS.failed };
        await query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, orderId]);
        return res.status(502).json({
          error: 'Falha ao criar cobrança PIX.',
          detail: paymentResult.error
        });
      }

      const paymentRow = paymentResult.paymentRow;
      const mapped = mapPixRepasseResponse(paymentResult.pixResponse?.data || {});
      const idSolicitacao = paymentRow?.id_solicitacao || mapped.idSolicitacao || null;
      const qrCode = paymentRow?.qr_code || mapped.qrCode || null;
      const expiresAt = paymentRow?.timestamp_limite || paymentResult.timestampLimiteSolicitacao;

      const updatedOrderData = {
        ...(payload || {}),
        paymentProvider: ORDER_PAYMENT_PROVIDER.pixRepasse,
        paymentStatus: ORDER_PAYMENT_STATUS.pending,
        paymentIdSolicitacao: idSolicitacao,
        paymentQrCode: qrCode,
        paymentExpiresAt: expiresAt
      };
      await query('UPDATE orders SET data = $1 WHERE id = $2', [updatedOrderData, orderId]);
      responsePayload.payment = {
        provider: ORDER_PAYMENT_PROVIDER.pixRepasse,
        idSolicitacao
      };
      responsePayload.redirectUrl = `/pedido/${orderId}/pagamento/pix`;
    } catch (error) {
      const nextData = { ...(payload || {}), paymentStatus: ORDER_PAYMENT_STATUS.failed };
      await query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, orderId]);
      return res.status(502).json({ error: 'Falha ao criar cobrança PIX.' });
    }
  }

  if (storeData?.merchantId && orderId) {
    try {
      const { rows: existingPrint } = await query(
        'SELECT 1 FROM print_jobs WHERE order_id = $1 AND kind = $2 LIMIT 1',
        [orderId, PRINT_JOB_KIND.newOrder]
      );
      if (existingPrint.length === 0) {
        const flavorIds = Array.from(
          new Set(
            (payload.lineItems || [])
              .flatMap((item) => item?.pizza?.flavors || [])
              .map((entry) => entry?.flavorId)
              .filter((id) => isValidUuid(String(id || '')))
          )
        );
        const flavorMap = new Map();
        if (flavorIds.length > 0) {
          const { rows: flavorRows } = await query(
            'SELECT id, data FROM pizza_flavors WHERE id = ANY($1::uuid[])',
            [flavorIds]
          );
          flavorRows.forEach((row) => flavorMap.set(row.id, row.data?.name || row.data?.title || row.id));
        }

        const printText = buildOrderPrintText({
          order: responsePayload,
          store: storeData,
          flavorMap
        });
        await createPrintJob({
          merchantId: storeData.merchantId,
          orderId,
          kind: PRINT_JOB_KIND.newOrder,
          printText
        });
      }
    } catch (error) {
      await logError({
        source: 'server',
        message: 'failed to create print job',
        stack: error?.stack,
        context: { route: 'POST /api/orders', orderId }
      });
    }
  }

  res.json(responsePayload);
});

const getLatestPixPayment = async (orderId) => {
  const { rows } = await query(
    `
    SELECT *
    FROM order_payments
    WHERE order_id = $1 AND provider = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [orderId, ORDER_PAYMENT_PROVIDER.pixRepasse]
  );
  return rows[0] || null;
};

app.get('/api/pedidos/:orderId/pagamento/pix', async (req, res) => {
  const orderId = req.params.orderId;
  const authPayload = getAuthPayload(req);
  const { rows } = await query(
    'SELECT id, status, store_id, user_id, created_at, data FROM orders WHERE id = $1',
    [orderId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'order not found' });
  const orderRow = rows[0];
  const orderData = orderRow.data || {};
  if (!canAccessOrder(authPayload, orderRow, orderData, req.query)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const paymentRow = await getLatestPixPayment(orderId);
  if (!paymentRow) return res.status(404).json({ error: 'payment not found' });
  res.json({
    orderId,
    valor: Number(paymentRow.valor || orderData.total || 0),
    expiresAt: paymentRow.timestamp_limite,
    qrCode: paymentRow.qr_code,
    idSolicitacao: paymentRow.id_solicitacao,
    codigoEstadoPagamento: paymentRow.codigo_estado_pagamento,
    codigoEstadoSolicitacao: paymentRow.codigo_estado_solicitacao,
    descricaoStatus: paymentRow.descricao_status,
    statusLocal: paymentRow.status_local
  });
});

app.post('/api/pedidos/:orderId/pagamento/pix/recriar', async (req, res) => {
  const orderId = req.params.orderId;
  const authPayload = getAuthPayload(req);
  const { rows } = await query(
    'SELECT id, status, store_id, user_id, created_at, data FROM orders WHERE id = $1',
    [orderId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'order not found' });
  const orderRow = rows[0];
  const orderData = orderRow.data || {};
  if (!canAccessOrder(authPayload, orderRow, orderData, req.query)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { rows: storeRows } = await query('SELECT data FROM stores WHERE id = $1', [orderRow.store_id]);
  const storeData = storeRows[0]?.data || {};
  if (!storeData?.pix_enabled) {
    return res.status(400).json({ error: 'PIX Repasse não habilitado para esta loja.' });
  }
  if (!storeData.pix_hash_recebedor_01 || !storeData.pix_hash_recebedor_02) {
    return res.status(400).json({ error: 'PIX Repasse sem hashes configurados.' });
  }
  if (!storeData.pix_identificacao_pdv) {
    return res.status(422).json({ error: 'PIX Repasse sem identificacao PDV configurada.' });
  }
  const paymentResult = await ensurePixPaymentForOrder({
    orderId,
    storeData,
    valor: Number(orderData.total || 0),
    forceNew: false
  });
  if (paymentResult?.error) {
    return res.status(502).json({ error: 'Falha ao criar cobrança PIX.' });
  }
  const paymentRow = paymentResult.paymentRow;
  const mapped = mapPixRepasseResponse(paymentResult.pixResponse?.data || {});
  const idSolicitacao = paymentRow?.id_solicitacao || mapped.idSolicitacao || null;
  const qrCode = paymentRow?.qr_code || mapped.qrCode || null;
  const expiresAt = paymentRow?.timestamp_limite || paymentResult.timestampLimiteSolicitacao;
  const nextData = {
    ...(orderData || {}),
    paymentProvider: ORDER_PAYMENT_PROVIDER.pixRepasse,
    paymentStatus: ORDER_PAYMENT_STATUS.pending,
    paymentIdSolicitacao: idSolicitacao,
    paymentQrCode: qrCode,
    paymentExpiresAt: expiresAt
  };
  await query('UPDATE orders SET data = $1 WHERE id = $2', [nextData, orderId]);
  res.json({
    orderId,
    payment: { provider: ORDER_PAYMENT_PROVIDER.pixRepasse, idSolicitacao },
    redirectUrl: `/pedido/${orderId}/pagamento/pix`
  });
});

app.get('/api/sse/pedidos/:orderId/pix', async (req, res) => {
  const orderId = req.params.orderId;
  const authPayload = getAuthPayload(req);
  const { rows } = await query(
    'SELECT id, status, store_id, user_id, created_at, data FROM orders WHERE id = $1',
    [orderId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'order not found' });
  const orderRow = rows[0];
  const orderData = orderRow.data || {};
  if (!canAccessOrder(authPayload, orderRow, orderData, req.query)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const paymentRow = await getLatestPixPayment(orderId);
  if (!paymentRow) return res.status(404).json({ error: 'payment not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('connected', { orderId });

  let lastStatus = {
    codigoEstadoPagamento: paymentRow.codigo_estado_pagamento,
    codigoEstadoSolicitacao: paymentRow.codigo_estado_solicitacao,
    descricaoStatus: paymentRow.descricao_status,
    qrCode: paymentRow.qr_code,
    statusLocal: paymentRow.status_local
  };

  let pollInterval = null;
  let pingInterval = null;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (pollInterval) clearInterval(pollInterval);
    if (pingInterval) clearInterval(pingInterval);
  };

  if (paymentRow.qr_code) {
    sendEvent('qr_ready', { qrCode: paymentRow.qr_code });
  }

  const initialStatusLocal = resolvePixStatusLocal({
    codigoEstadoPagamento: paymentRow.codigo_estado_pagamento,
    codigoEstadoSolicitacao: paymentRow.codigo_estado_solicitacao,
    timestampLimite: paymentRow.timestamp_limite
  });

  if (initialStatusLocal === ORDER_PAYMENT_STATUS.expired) {
    await updateOrderPaymentAndStatus({
      orderRow,
      orderData,
      paymentRow,
      response: {},
      statusLocal: ORDER_PAYMENT_STATUS.expired
    });
    sendEvent('expired', {
      orderId,
      expiresAt: paymentRow.timestamp_limite,
      reason: resolvePixExpirationReason({
        codigoEstadoSolicitacao: paymentRow.codigo_estado_solicitacao,
        timestampLimite: paymentRow.timestamp_limite
      })
    });
    cleanup();
    res.end();
    return;
  }

  const poll = async () => {
    const statusResponse = await consultarStatusPixRepasse({
      idSolicitacao: paymentRow.id_solicitacao,
      baseUrl: pixRepasseBaseUrl,
      tokenApiExterna: pixRepasseToken
    });
    if (!statusResponse.ok) {
      sendEvent('payment_failed', { reason: statusResponse.message || 'status error' });
      return;
    }
    const mapped = mapPixRepasseResponse(statusResponse.data || {});
    const statusLocal = resolvePixStatusLocal({
      codigoEstadoPagamento: mapped.codigoEstadoPagamento,
      codigoEstadoSolicitacao: mapped.codigoEstadoSolicitacao,
      timestampLimite: paymentRow.timestamp_limite
    });
    await updateOrderPaymentAndStatus({
      orderRow,
      orderData,
      paymentRow,
      response: statusResponse.data,
      statusLocal
    });

    const nextStatus = {
      codigoEstadoPagamento: mapped.codigoEstadoPagamento,
      codigoEstadoSolicitacao: mapped.codigoEstadoSolicitacao,
      descricaoStatus: mapped.descricaoStatus,
      qrCode: mapped.qrCode || paymentRow.qr_code,
      statusLocal
    };

    if (mapped.qrCode && !lastStatus.qrCode) {
      sendEvent('qr_ready', { qrCode: mapped.qrCode });
    }

    if (
      nextStatus.codigoEstadoPagamento !== lastStatus.codigoEstadoPagamento ||
      nextStatus.codigoEstadoSolicitacao !== lastStatus.codigoEstadoSolicitacao ||
      nextStatus.descricaoStatus !== lastStatus.descricaoStatus ||
      nextStatus.statusLocal !== lastStatus.statusLocal
    ) {
      sendEvent('status_updated', nextStatus);
      lastStatus = nextStatus;
    }

    if (statusLocal === ORDER_PAYMENT_STATUS.paid) {
      sendEvent('payment_received', { orderId });
      cleanup();
      res.end();
      return true;
    }
    if (statusLocal === ORDER_PAYMENT_STATUS.expired) {
      sendEvent('expired', {
        orderId,
        expiresAt: paymentRow.timestamp_limite,
        reason: resolvePixExpirationReason({
          codigoEstadoSolicitacao: mapped.codigoEstadoSolicitacao,
          timestampLimite: paymentRow.timestamp_limite
        })
      });
      cleanup();
      res.end();
      return true;
    }
    return false;
  };

  pollInterval = setInterval(() => {
    poll().catch(() => {});
  }, 5000);

  pingInterval = setInterval(() => {
    sendEvent('ping', { ts: new Date().toISOString() });
  }, 20000);

  req.on('close', () => {
    cleanup();
  });
});

app.post('/api/orders/:id/print', async (req, res) => {
  const authPayload = getAuthPayload(req);
  if (!authPayload) return res.status(401).json({ error: 'unauthorized' });

  const { rows } = await query(
    'SELECT id, status, store_id, created_at, data FROM orders WHERE id = $1',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  const orderRow = rows[0];

  if (authPayload.role !== 'ADMIN') {
    const store = await getStoreByOwnerId(authPayload.sub);
    if (!store || store.id !== orderRow.store_id) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }

  const { rows: storeRows } = await query('SELECT data FROM stores WHERE id = $1', [orderRow.store_id]);
  const storeData = storeRows[0]?.data || null;
  if (!storeData?.merchantId) {
    return res.status(400).json({ error: 'merchantId not configured for store' });
  }

  const orderPayload = {
    id: orderRow.id,
    status: orderRow.status,
    createdAt: orderRow.created_at,
    ...(orderRow.data || {})
  };

  const flavorIds = Array.from(
    new Set(
      (orderPayload.lineItems || [])
        .flatMap((item) => item?.pizza?.flavors || [])
        .map((entry) => entry?.flavorId)
        .filter((id) => isValidUuid(String(id || '')))
    )
  );
  const flavorMap = new Map();
  if (flavorIds.length > 0) {
    const { rows: flavorRows } = await query(
      'SELECT id, data FROM pizza_flavors WHERE id = ANY($1::uuid[])',
      [flavorIds]
    );
    flavorRows.forEach((row) => flavorMap.set(row.id, row.data?.name || row.data?.title || row.id));
  }

  const printText = buildOrderPrintText({
    order: orderPayload,
    store: storeData,
    flavorMap
  });
  const { rows: reprintRows } = await query(
    'SELECT COUNT(*)::int AS count FROM print_jobs WHERE order_id = $1 AND kind = $2',
    [orderRow.id, PRINT_JOB_KIND.reprint]
  );
  const reprintNumber = Number(reprintRows[0]?.count || 0) + 1;
  await createPrintJob({
    merchantId: storeData.merchantId,
    orderId: orderRow.id,
    kind: PRINT_JOB_KIND.reprint,
    printText,
    payload: {
      reprint: true,
      reprintNumber,
      orderId: orderRow.id,
      storeId: orderRow.store_id,
      merchantId: storeData.merchantId
    }
  });

  res.json({ ok: true });
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
  const { rows: currentRows } = await query(
    'SELECT status, data, store_id, created_at FROM orders WHERE id = $1',
    [req.params.id]
  );
  if (currentRows.length === 0) return res.status(404).json({ error: 'not found' });
  const orderRow = currentRows[0];
  const authPayload = getAuthPayload(req);
  const isStoreOrAdmin = authPayload?.role === 'ADMIN' || authPayload?.role === 'BUSINESS';
  const isClientRequest = !isStoreOrAdmin;
  const orderData = orderRow.data || {};
  const orderType = resolveOrderTypeFromData(orderData);
  const currentStatus = normalizeStoredStatusForType(orderRow.status, orderType);
  const resolvedStatus = status;
  const allowedFlow = getOrderStatusFlow(orderType);
  if (!allowedFlow.includes(resolvedStatus)) {
    return res.status(400).json({ error: 'Status inválido para este tipo de pedido.' });
  }
  if (!canAdvanceOrderStatus(currentStatus, resolvedStatus, orderType)) {
    return res.status(400).json({
      error:
        'Não é possível voltar o status do pedido. Para manter histórico e consistência, o status só pode avançar.'
    });
  }
  if (resolvedStatus === 'CANCELLED') {
    if (isClientRequest) {
      const createdAtMs = orderRow.created_at ? new Date(orderRow.created_at).getTime() : NaN;
      if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > CLIENT_CANCEL_WINDOW_MS) {
        return res.status(403).json({ error: 'cancel_window_expired' });
      }
    }
    const data = {
      ...(orderRow.data || {}),
      cancelReason: reason ? String(reason) : (orderRow.data || {}).cancelReason
    };
    await query('UPDATE orders SET status = $1, data = $2 WHERE id = $3', [resolvedStatus, data, req.params.id]);
    try {
      await restockForCancelledOrder({ orderRow: { id: req.params.id, store_id: orderRow.store_id }, orderData: data });
    } catch (error) {
      await logError({
        source: 'server',
        message: 'failed to restock on cancel',
        stack: error?.stack,
        context: { route: 'PUT /api/orders/:id/status', orderId: req.params.id }
      });
    }
    const paymentRow = await getLatestPixPayment(req.params.id);
    if (paymentRow && paymentRow.status_local === ORDER_PAYMENT_STATUS.pending) {
      await updateOrderPaymentAndStatus({
        orderRow: { id: req.params.id, status: resolvedStatus },
        orderData: data,
        paymentRow,
        response: {},
        statusLocal: ORDER_PAYMENT_STATUS.cancelled
      });
    }
    return res.json({ ok: true });
  }
  await query('UPDATE orders SET status = $1 WHERE id = $2', [resolvedStatus, req.params.id]);
  if (resolvedStatus === 'PREPARING') {
    try {
      await deductStockForOrder({ orderRow: { id: req.params.id, store_id: orderRow.store_id }, orderData });
    } catch (error) {
      await logError({
        source: 'server',
        message: 'failed to deduct stock',
        stack: error?.stack,
        context: { route: 'PUT /api/orders/:id/status', orderId: req.params.id }
      });
    }
    try {
      if (orderRow.store_id) {
        const { rows: storeRows } = await query('SELECT data FROM stores WHERE id = $1', [orderRow.store_id]);
        const storeData = storeRows[0]?.data || null;
        if (storeData?.merchantId) {
          const { rows: existingPrint } = await query(
            'SELECT 1 FROM print_jobs WHERE order_id = $1 AND kind = $2 LIMIT 1',
            [req.params.id, PRINT_JOB_KIND.newOrder]
          );
          if (existingPrint.length === 0) {
            const orderPayload = {
              id: req.params.id,
              status: resolvedStatus,
              createdAt: orderRow.created_at,
              ...(orderData || {})
            };
            const flavorIds = Array.from(
              new Set(
                (orderPayload.lineItems || [])
                  .flatMap((item) => item?.pizza?.flavors || [])
                  .map((entry) => entry?.flavorId)
                  .filter((id) => isValidUuid(String(id || '')))
              )
            );
            const flavorMap = new Map();
            if (flavorIds.length > 0) {
              const { rows: flavorRows } = await query(
                'SELECT id, data FROM pizza_flavors WHERE id = ANY($1::uuid[])',
                [flavorIds]
              );
              flavorRows.forEach((row) => flavorMap.set(row.id, row.data?.name || row.data?.title || row.id));
            }
            const printText = buildOrderPrintText({
              order: orderPayload,
              store: storeData,
              flavorMap
            });
            await createPrintJob({
              merchantId: storeData.merchantId,
              orderId: req.params.id,
              kind: PRINT_JOB_KIND.newOrder,
              printText
            });
          }
        }
      }
    } catch (error) {
      await logError({
        source: 'server',
        message: 'failed to create print job on preparing',
        stack: error?.stack,
        context: { route: 'PUT /api/orders/:id/status', orderId: req.params.id }
      });
    }
  }
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
    const { rows: currentRows } = await query(
      'SELECT status, data FROM orders WHERE id = $1 AND store_id = $2',
      [req.params.id, store.id]
    );
    if (currentRows.length === 0) {
      return respondQualifazError(res, 404, 'QUALIFAZ_ORDER_NOT_FOUND', 'order not found', {
        route: 'PUT /qualifaz/orders/:id/status',
        merchantId,
        orderId: req.params.id
      });
    }
    const orderData = currentRows[0].data || {};
    const orderType = resolveOrderTypeFromData(orderData);
    const currentStatus = normalizeStoredStatusForType(currentRows[0].status, orderType);
    const resolvedStatus = status;
    const allowedFlow = getOrderStatusFlow(orderType);
    if (!allowedFlow.includes(resolvedStatus)) {
      return respondQualifazError(
        res,
        400,
        'QUALIFAZ_INVALID_STATUS',
        'Status inválido para este tipo de pedido.',
        {
          route: 'PUT /qualifaz/orders/:id/status',
          merchantId,
          orderId: req.params.id,
          currentStatus,
          nextStatus: resolvedStatus
        }
      );
    }
    if (!canAdvanceOrderStatus(currentStatus, resolvedStatus, orderType)) {
      return respondQualifazError(
        res,
        400,
        'QUALIFAZ_STATUS_BACKWARD',
        'Não é possível voltar o status do pedido. Para manter histórico e consistência, o status só pode avançar.',
        {
          route: 'PUT /qualifaz/orders/:id/status',
          merchantId,
          orderId: req.params.id,
          currentStatus,
          nextStatus: resolvedStatus
        }
      );
    }
    if (resolvedStatus === 'CANCELLED') {
      const data = {
        ...(currentRows[0].data || {}),
        cancelReason: reason ? String(reason) : (currentRows[0].data || {}).cancelReason
      };
      await query('UPDATE orders SET status = $1, data = $2 WHERE id = $3 AND store_id = $4', [
        resolvedStatus,
        data,
        req.params.id,
        store.id
      ]);
      const paymentRow = await getLatestPixPayment(req.params.id);
      if (paymentRow && paymentRow.status_local === ORDER_PAYMENT_STATUS.pending) {
        await updateOrderPaymentAndStatus({
          orderRow: { id: req.params.id, status: resolvedStatus },
          orderData: data,
          paymentRow,
          response: {},
          statusLocal: ORDER_PAYMENT_STATUS.cancelled
        });
      }
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
        body: redactSensitive(req.body)
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

let pixReconcileRunning = false;
const startPixRepasseReconciler = () => {
  setInterval(async () => {
    if (pixReconcileRunning) return;
    pixReconcileRunning = true;
    try {
      const { rows } = await query(
        `
        SELECT p.*, o.status, o.data
        FROM order_payments p
        JOIN orders o ON o.id = p.order_id
        WHERE p.provider = $1
          AND p.status_local = $2
        ORDER BY p.created_at ASC
        LIMIT 25
        `,
        [ORDER_PAYMENT_PROVIDER.pixRepasse, ORDER_PAYMENT_STATUS.pending]
      );
      for (const row of rows) {
        const orderRow = { id: row.order_id, status: row.status };
        const orderData = row.data || {};
        if (row.timestamp_limite && new Date(row.timestamp_limite).getTime() <= Date.now()) {
          await updateOrderPaymentAndStatus({
            orderRow,
            orderData,
            paymentRow: row,
            response: {},
            statusLocal: ORDER_PAYMENT_STATUS.expired
          });
          continue;
        }
        if (isPixStatusExpiredByCode(row.codigo_estado_solicitacao)) {
          await updateOrderPaymentAndStatus({
            orderRow,
            orderData,
            paymentRow: row,
            response: {},
            statusLocal: ORDER_PAYMENT_STATUS.expired
          });
          continue;
        }
        const statusResponse = await consultarStatusPixRepasse({
          idSolicitacao: row.id_solicitacao,
          baseUrl: pixRepasseBaseUrl,
          tokenApiExterna: pixRepasseToken
        });
        if (!statusResponse.ok) {
          continue;
        }
        const mapped = mapPixRepasseResponse(statusResponse.data || {});
        const statusLocal = resolvePixStatusLocal({
          codigoEstadoPagamento: mapped.codigoEstadoPagamento,
          codigoEstadoSolicitacao: mapped.codigoEstadoSolicitacao,
          timestampLimite: row.timestamp_limite
        });
        await updateOrderPaymentAndStatus({
          orderRow,
          orderData,
          paymentRow: row,
          response: statusResponse.data,
          statusLocal
        });
      }
    } catch (error) {
      console.error('pix repasse reconcile failed', error);
    } finally {
      pixReconcileRunning = false;
    }
  }, 90 * 1000);
};

let tablePixReconcileRunning = false;
const startTablePixReconciler = () => {
  setInterval(async () => {
    if (tablePixReconcileRunning) return;
    tablePixReconcileRunning = true;
    try {
      const { rows } = await query(
        `
        SELECT *
        FROM table_payments
        WHERE status_local = $1
        ORDER BY created_at ASC
        LIMIT 25
        `,
        [ORDER_PAYMENT_STATUS.pending]
      );
      for (const row of rows) {
        if (row.timestamp_limite && new Date(row.timestamp_limite).getTime() <= Date.now()) {
          await updateTablePaymentRow({
            paymentId: row.id,
            statusLocal: ORDER_PAYMENT_STATUS.expired
          });
          continue;
        }
        if (!row.id_solicitacao) continue;
        const statusResponse = await consultarStatusPixRepasse({
          idSolicitacao: row.id_solicitacao,
          baseUrl: pixRepasseBaseUrl,
          tokenApiExterna: pixRepasseToken
        });
        if (!statusResponse.ok) {
          continue;
        }
        const mapped = mapPixRepasseResponse(statusResponse.data || {});
        const statusLocal = resolvePixStatusLocal({
          codigoEstadoPagamento: mapped.codigoEstadoPagamento,
          codigoEstadoSolicitacao: mapped.codigoEstadoSolicitacao,
          timestampLimite: row.timestamp_limite
        });
        await updateTablePaymentRow({
          paymentId: row.id,
          statusLocal
        });
        if (statusLocal === ORDER_PAYMENT_STATUS.paid) {
          await updateOrdersForTablePayment({
            orderIds: row.order_ids || [],
            statusLocal
          });
        }
      }
    } catch (error) {
      console.error('table pix repasse reconcile failed', error);
    } finally {
      tablePixReconcileRunning = false;
    }
  }, 90 * 1000);
};

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
  startPixRepasseReconciler();
  startTablePixReconciler();
});
