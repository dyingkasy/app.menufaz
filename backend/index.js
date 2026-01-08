import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withClient } from './db.js';
import { initErrorLogTable, logError } from './logger.js';

const app = express();
const port = process.env.PORT || 3001;
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const corsOrigin = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

initErrorLogTable().catch((error) => {
  console.error('Failed to initialize error log table', error);
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

const parseOrderRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    storeCity: row.store_city,
    createdAt: row.created_at,
    ...row.data
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
app.get('/api/stores', async (_req, res) => {
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
  const { rows } = await query(
    'INSERT INTO stores (owner_id, city, data) VALUES ($1, $2, $3) RETURNING id',
    [payload.ownerId || null, payload.city || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
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

    const fullStoreData = {
      ...storeData,
      ownerId: userId,
      city: storeData.city,
      phone: storeData.whatsapp || storeData.phone || phone,
      email
    };

    await client.query(
      'INSERT INTO stores (owner_id, city, data) VALUES ($1, $2, $3)',
      [userId, fullStoreData.city || null, fullStoreData]
    );
  });

  res.json({ ok: true });
});

app.put('/api/stores/:id', async (req, res) => {
  const payload = req.body || {};
  await query('UPDATE stores SET data = $1, city = $2 WHERE id = $3', [
    payload,
    payload.city || null,
    req.params.id
  ]);
  res.json({ id: req.params.id, ...payload });
});

app.delete('/api/stores/:id', async (req, res) => {
  await query('DELETE FROM stores WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
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
      rating: 5,
      deliveryTime: '30-40 min',
      pickupTime: '20-30 min',
      deliveryFee: 5,
      imageUrl: '',
      isPopular: false,
      isActive: true,
      coordinates: { lat: -23.561684, lng: -46.655981 },
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

app.put('/api/logs/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const resolved = req.body?.resolved !== false;
    const { rows } = await query(
      'UPDATE error_logs SET resolved = $1 WHERE id = $2 RETURNING id',
      [resolved, req.params.id]
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
  res.json(mapRows(rows));
});

app.post('/api/products', async (req, res) => {
  const payload = req.body || {};
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
        await client.query('INSERT INTO products (store_id, data) VALUES ($1, $2)', [
          item.storeId || null,
          item
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
  const payload = req.body || {};
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
  const { rows } = await query(
    'INSERT INTO pizza_flavors (store_id, data) VALUES ($1, $2) RETURNING id',
    [payload.storeId || null, payload]
  );
  res.json({ id: rows[0].id, ...payload });
});

app.put('/api/pizza-flavors/:id', async (req, res) => {
  const payload = req.body || {};
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
  const { storeId, userId, courierId, status, city, tableNumber, tableSessionId } = req.query;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT id, status, store_city, created_at, data FROM orders ${where} ORDER BY created_at DESC`,
    params
  );
  res.json(parseOrderRows(rows));
});

app.post('/api/orders', async (req, res) => {
  const payload = req.body || {};
  const status = payload.status || 'PENDING';
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
  await query('UPDATE orders SET courier_id = $1, status = $2 WHERE id = $3', [
    courierId,
    'DELIVERING',
    req.params.id
  ]);
  res.json({ ok: true });
});

app.put('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status required' });
  await query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
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

    const payload = { ...(req.body || {}), uid: normalizeId(userId) };
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
