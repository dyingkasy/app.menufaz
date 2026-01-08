import fs from 'fs/promises';
import path from 'path';
import { query } from './db.js';

const LOG_DIR = process.env.LOG_DIR || '/app/logs';
const LOG_FILE = path.join(LOG_DIR, 'errors.log');
const SETTINGS_CACHE_TTL_MS = 60000;

let settingsCache = { value: null, fetchedAt: 0 };
let lastNotificationAt = 0;

const ensureLogDir = async () => {
  await fs.mkdir(LOG_DIR, { recursive: true });
};

export const initErrorLogTable = async () => {
  await query(
    `
    CREATE TABLE IF NOT EXISTS error_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'error',
      message TEXT NOT NULL,
      stack TEXT,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
    `,
    []
  );
  await query('CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at)', []);
};

const getAppSettings = async () => {
  const now = Date.now();
  if (settingsCache.value && now - settingsCache.fetchedAt < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.value;
  }

  const { rows } = await query('SELECT data FROM app_settings WHERE id = 1', []);
  const data = rows[0]?.data || {};
  settingsCache = { value: data, fetchedAt: now };
  return data;
};

const shouldNotify = (cooldownSec) => {
  const now = Date.now();
  const cooldownMs = Math.max(0, Number(cooldownSec || 0)) * 1000;
  if (cooldownMs === 0) return true;
  if (now - lastNotificationAt >= cooldownMs) {
    lastNotificationAt = now;
    return true;
  }
  return false;
};

const sendEmailNotification = async (settings, entry) => {
  const serviceId = settings.emailJsServiceId;
  const publicKey = settings.emailJsPublicKey;
  const templateId = settings.errorNotifyEmailTemplateId || settings.emailJsTemplateId;
  const toEmail = settings.errorNotifyEmailTo;

  if (!serviceId || !publicKey || !templateId || !toEmail) return;

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: {
      to_email: toEmail,
      source: entry.source,
      level: entry.level,
      message: entry.message,
      stack: entry.stack || '',
      context: JSON.stringify(entry.context || {}),
      created_at: entry.createdAt
    }
  };

  await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
};

const notify = async (entry) => {
  try {
    const settings = await getAppSettings();
    if (!settings) return;
    if (!shouldNotify(settings.errorNotifyCooldownSec)) return;

    if (settings.errorNotifyEmailEnabled) {
      await sendEmailNotification(settings, entry);
    }
  } catch (error) {
    console.error('Failed to send error notifications', error);
  }
};

const appendToFile = async (entry) => {
  try {
    await ensureLogDir();
    await fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('Failed to write error log to file', error);
  }
};

const insertToDb = async (entry) => {
  try {
    await query(
      'INSERT INTO error_logs (source, level, message, stack, context, resolved) VALUES ($1, $2, $3, $4, $5, $6)',
      [entry.source, entry.level, entry.message, entry.stack || null, entry.context || {}, false]
    );
  } catch (error) {
    console.error('Failed to write error log to database', error);
  }
};

export const logError = async ({
  source = 'server',
  level = 'error',
  message,
  stack,
  context
}) => {
  const entry = {
    source,
    level,
    message: message || 'Unknown error',
    stack: stack || null,
    context: context || {},
    createdAt: new Date().toISOString()
  };

  await Promise.all([appendToFile(entry), insertToDb(entry), notify(entry)]);
};
