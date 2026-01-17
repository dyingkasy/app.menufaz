import 'dotenv/config';
import { query, withClient } from '../db.js';

const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const uploadToImageKit = async (dataUrl, fileName) => {
  if (!IMAGEKIT_PRIVATE_KEY) {
    throw new Error('IMAGEKIT_PRIVATE_KEY is not configured');
  }
  const auth = Buffer.from(`${IMAGEKIT_PRIVATE_KEY}:`).toString('base64');
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const form = new FormData();
      form.append('file', dataUrl);
      form.append('fileName', fileName);

      const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}` },
        body: form
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`ImageKit upload failed: ${response.status} ${text}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
};

const isDataUrl = (value) => typeof value === 'string' && value.startsWith('data:image/');

const getExtension = (dataUrl) => {
  if (dataUrl.startsWith('data:image/png')) return 'png';
  if (dataUrl.startsWith('data:image/webp')) return 'webp';
  return 'jpg';
};

const migrateStores = async () => {
  const { rows } = await query('SELECT id, data FROM stores', []);
  let updated = 0;

  for (const row of rows) {
    const payload = row.data || {};
    let changed = false;

    if (isDataUrl(payload.imageUrl)) {
      const upload = await uploadToImageKit(payload.imageUrl, `store-${row.id}-cover.${getExtension(payload.imageUrl)}`);
      payload.imageUrl = upload.url;
      payload.imageFileId = upload.fileId;
      changed = true;
    }

    if (isDataUrl(payload.logoUrl)) {
      const upload = await uploadToImageKit(payload.logoUrl, `store-${row.id}-logo.${getExtension(payload.logoUrl)}`);
      payload.logoUrl = upload.url;
      payload.logoFileId = upload.fileId;
      changed = true;
    }

    if (changed) {
      await query('UPDATE stores SET data = $1 WHERE id = $2', [payload, row.id]);
      updated += 1;
    }
  }

  return updated;
};

const migrateProducts = async () => {
  const { rows } = await query('SELECT id, data FROM products', []);
  let updated = 0;

  for (const row of rows) {
    const payload = row.data || {};
    let changed = false;

    if (isDataUrl(payload.imageUrl)) {
      const upload = await uploadToImageKit(payload.imageUrl, `product-${row.id}.${getExtension(payload.imageUrl)}`);
      payload.imageUrl = upload.url;
      payload.imageFileId = upload.fileId;
      changed = true;
    }

    if (changed) {
      await query('UPDATE products SET data = $1 WHERE id = $2', [payload, row.id]);
      updated += 1;
    }
  }

  return updated;
};

const migrateStoreRequests = async () => {
  const { rows } = await query('SELECT id, data FROM store_requests', []);
  let updated = 0;

  for (const row of rows) {
    const payload = row.data || {};
    let changed = false;

    if (isDataUrl(payload.imageUrl)) {
      const upload = await uploadToImageKit(payload.imageUrl, `store-request-${row.id}-cover.${getExtension(payload.imageUrl)}`);
      payload.imageUrl = upload.url;
      payload.imageFileId = upload.fileId;
      changed = true;
    }

    if (isDataUrl(payload.logoUrl)) {
      const upload = await uploadToImageKit(payload.logoUrl, `store-request-${row.id}-logo.${getExtension(payload.logoUrl)}`);
      payload.logoUrl = upload.url;
      payload.logoFileId = upload.fileId;
      changed = true;
    }

    if (changed) {
      await query('UPDATE store_requests SET data = $1 WHERE id = $2', [payload, row.id]);
      updated += 1;
    }
  }

  return updated;
};

const run = async () => {
  console.log('Migrating base64 images to ImageKit...');
  const storesUpdated = await migrateStores();
  const productsUpdated = await migrateProducts();
  const requestsUpdated = await migrateStoreRequests();
  console.log(`Done. stores=${storesUpdated} products=${productsUpdated} store_requests=${requestsUpdated}`);
};

run().catch((error) => {
  console.error('Migration failed', error);
  process.exitCode = 1;
});
