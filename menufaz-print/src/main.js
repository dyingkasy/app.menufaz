const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { execSync } = require('child_process');

let printer = null;
let printerLoadError = '';
try {
  printer = require('printer');
} catch (error) {
  printer = null;
  printerLoadError = String(error?.message || error || '');
}

let iconv = null;
try {
  iconv = require('iconv-lite');
} catch (error) {
  iconv = null;
}


const DEFAULT_API_URL_PROD = 'https://app.menufaz.com';
const DEFAULT_API_URL_DEV = 'http://localhost:3001';
const getDefaultApiUrl = () => (app && app.isPackaged ? DEFAULT_API_URL_PROD : DEFAULT_API_URL_DEV);
const CONFIG_FILENAME = 'config.json';
const POLL_INTERVAL_MS = 5000;
const PRINT_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 12000;
const API_RETRY_ATTEMPTS = 3;
const API_RETRY_BASE_MS = 600;
const WATCHDOG_INTERVAL_MS = 10000;
const WATCHDOG_STUCK_POLL_MS = 60000;
const WATCHDOG_STUCK_QUEUE_MS = 120000;
const PRINTER_CACHE_MS = 5000;
const LOG_ROTATE_MAX_BYTES = 2 * 1024 * 1024;
const PROCESSED_JOBS_FILE = 'processed-jobs.json';
const PROCESSED_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const ESC_POS_CHARSET_CP860 = Buffer.from([0x1b, 0x74, 0x03]);
const ESC_POS_CUT = Buffer.from([0x1d, 0x56, 0x00]);
const PRINT_WRAP_COLUMNS = 48;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let pollingTimer = null;
let pollingInFlight = false;
let lastPrinterMissing = false;
let logFilePath = '';
let processingQueue = false;
const jobQueue = [];
const inFlightJobIds = new Set();
let currentConfig = null;
let trayState = null;
let watchdogTimer = null;
let lastPollStartedAt = 0;
let lastPollFinishedAt = 0;
let lastQueueActivityAt = 0;
let cachedPrinters = [];
let printersCachedAt = 0;
let processedJobsPath = '';
const processedJobMap = new Map();
let registrationInFlight = null;

const TRAY_ICON_OK = 'tray-green.png';
const TRAY_ICON_ERROR = 'tray-red.png';
const DEFAULT_PRINT_STATIONS = [
  { id: 'caixa', name: 'Caixa' },
  { id: 'bar', name: 'Bar' },
  { id: 'cozinha', name: 'Cozinha' }
];

const normalizeStationId = (value) =>
  (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizePrinterStations = (value) => {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .map((station) => {
      const name = (station?.name || '').toString().trim();
      const id = normalizeStationId(station?.id || name);
      if (!id || !name) return null;
      return { id, name };
    })
    .filter(Boolean);
  if (normalized.length > 0) return normalized;
  return DEFAULT_PRINT_STATIONS.map((station) => ({ ...station }));
};

const normalizeAssignedStationIds = (value, stations) => {
  const stationSet = new Set((stations || []).map((station) => station.id));
  const ids = Array.isArray(value)
    ? value
        .map((id) => normalizeStationId(id))
        .filter((id) => stationSet.has(id))
    : [];
  if (ids.length > 0) return Array.from(new Set(ids));
  return Array.from(stationSet);
};

const normalizeStationPrinterMap = (value, stations) => {
  const stationSet = new Set((stations || []).map((station) => station.id));
  const raw = value && typeof value === 'object' ? value : {};
  const output = {};
  Object.entries(raw).forEach(([stationId, printerName]) => {
    const key = normalizeStationId(stationId);
    if (!stationSet.has(key)) return;
    const name = (printerName || '').toString().trim();
    if (!name) return;
    output[key] = name;
  });
  return output;
};

const state = {
  storeName: '',
  connected: false,
  currentStatus: 'Idle',
  healthStatus: 'HEALTHY',
  lastPrintedAt: '',
  lastPrintedId: '',
  lastError: '',
  logFilePath: '',
  printerSupport: true,
};

const ensureLogFile = () => {
  if (logFilePath) return logFilePath;
  const baseDir = app?.isPackaged ? app.getPath('userData') : process.cwd();
  const logDir = path.join(baseDir, 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {}
  logFilePath = path.join(logDir, 'app.log');
  updateStatus({ logFilePath });
  return logFilePath;
};

const ensureProcessedJobsPath = () => {
  if (processedJobsPath) return processedJobsPath;
  const baseDir = app?.isPackaged ? app.getPath('userData') : process.cwd();
  processedJobsPath = path.join(baseDir, PROCESSED_JOBS_FILE);
  return processedJobsPath;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const trimProcessedJobs = () => {
  const now = Date.now();
  for (const [jobId, timestamp] of processedJobMap.entries()) {
    if (!timestamp || now - timestamp > PROCESSED_JOB_TTL_MS) {
      processedJobMap.delete(jobId);
    }
  }
};

const loadProcessedJobs = () => {
  try {
    const filePath = ensureProcessedJobsPath();
    if (!fs.existsSync(filePath)) return;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object') return;
    Object.entries(raw).forEach(([jobId, ts]) => {
      const timestamp = Number(ts || 0);
      if (!jobId || !Number.isFinite(timestamp)) return;
      processedJobMap.set(jobId, timestamp);
    });
    trimProcessedJobs();
  } catch {}
};

const persistProcessedJobs = () => {
  try {
    trimProcessedJobs();
    const payload = {};
    for (const [jobId, ts] of processedJobMap.entries()) {
      payload[jobId] = ts;
    }
    fs.writeFileSync(ensureProcessedJobsPath(), JSON.stringify(payload));
  } catch {}
};

const markJobProcessed = (jobId) => {
  if (!jobId) return;
  processedJobMap.set(jobId, Date.now());
  persistProcessedJobs();
};

const wasJobProcessedRecently = (jobId) => {
  if (!jobId) return false;
  trimProcessedJobs();
  const ts = processedJobMap.get(jobId);
  if (!ts) return false;
  return Date.now() - ts <= PROCESSED_JOB_TTL_MS;
};

const setHealthStatus = (healthStatus) => {
  const normalized = String(healthStatus || 'HEALTHY').toUpperCase();
  if (state.healthStatus === normalized) return;
  updateStatus({ healthStatus: normalized });
};

const withRetry = async (fn, options = {}) => {
  const attempts = Math.max(1, Number(options.attempts || API_RETRY_ATTEMPTS));
  const baseDelay = Math.max(100, Number(options.baseDelayMs || API_RETRY_BASE_MS));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const jitter = Math.floor(Math.random() * 250);
      const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
      await sleep(delay);
    }
  }
  throw lastError || new Error('retry failed');
};

const writeLog = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${timestamp}] [${level}] ${message}${payload}\n`;
  try {
    const filePath = ensureLogFile();
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size >= LOG_ROTATE_MAX_BYTES) {
        const rotated = `${filePath}.1`;
        try {
          if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        } catch {}
        try {
          fs.renameSync(filePath, rotated);
        } catch {}
      }
    }
    fs.appendFileSync(filePath, line);
  } catch {}
};

const logInfo = (message, meta) => writeLog('INFO', message, meta);
const logError = (message, meta) => writeLog('ERROR', message, meta);

const normalizeArgs = () => {
  const args = process.argv.slice(1);
  const output = {};
  args.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
    if (!rawKey) return;
    output[rawKey] = rawValue || true;
  });
  return output;
};

const isLocalhostUrl = (value) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = (parsed.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch (error) {
    const normalized = String(value).toLowerCase();
    return normalized.includes('localhost') || normalized.includes('127.0.0.1');
  }
};

const getConfigPaths = () => {
  const cwdPath = path.join(process.cwd(), CONFIG_FILENAME);
  const userDataPath = path.join(app.getPath('userData'), CONFIG_FILENAME);
  return { cwdPath, userDataPath };
};

const readConfigFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    logError('config read error', { filePath, error: String(error?.message || error) });
    return null;
  }
};

const loadConfig = () => {
  const { cwdPath, userDataPath } = getConfigPaths();
  const cwdConfig = readConfigFile(cwdPath);
  const userDataConfig = readConfigFile(userDataPath);

  if (app.isPackaged) {
    if (userDataConfig && typeof userDataConfig === 'object') return userDataConfig;
    if (cwdConfig && typeof cwdConfig === 'object') {
      try {
        fs.mkdirSync(path.dirname(userDataPath), { recursive: true });
        fs.writeFileSync(userDataPath, JSON.stringify(cwdConfig, null, 2));
        logInfo('migrated packaged config to userData', { from: cwdPath, to: userDataPath });
      } catch (error) {
        logError('config migrate error', { from: cwdPath, to: userDataPath, error: String(error?.message || error) });
      }
      return cwdConfig;
    }
    return {};
  }

  return cwdConfig || userDataConfig || {};
};

const saveConfig = (config) => {
  const { userDataPath } = getConfigPaths();
  const tempPath = `${userDataPath}.tmp`;
  fs.mkdirSync(path.dirname(userDataPath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2));
  fs.renameSync(tempPath, userDataPath);
};

const resolveConfig = (rawConfig = {}) => {
  const args = normalizeArgs();
  const envApiUrl = process.env.MENUFAZ_API_URL || process.env.MEN_UFAZ_API_URL || '';
  const cliApiUrl = args.apiUrl || args['api-url'] || '';
  const merchantId = args.merchantId || args['merchant-id'] || rawConfig.merchantId || '';
  const apiUrlCandidate = cliApiUrl || envApiUrl || rawConfig.apiUrl || getDefaultApiUrl();
  let apiUrlSource = cliApiUrl ? 'cli' : envApiUrl ? 'env' : rawConfig.apiUrl ? 'config' : 'default';
  let apiUrl = apiUrlCandidate;
  if (app.isPackaged && apiUrlSource === 'config' && isLocalhostUrl(apiUrl)) {
    apiUrl = getDefaultApiUrl();
    apiUrlSource = 'default';
  }
  const stations = normalizePrinterStations(rawConfig.printerStations);
  const assignedStationIds = normalizeAssignedStationIds(rawConfig.assignedStationIds, stations);
  return {
    config: {
      ...rawConfig,
      merchantId,
      apiUrl,
      printerStations: stations,
      assignedStationIds,
      stationPrinters: normalizeStationPrinterMap(rawConfig.stationPrinters, stations)
    },
    apiUrlSource
  };
};

const parsePrinterLines = (raw) => {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.toLowerCase() !== 'name')
    .map((name) => ({ name }));
};

const getSystemPrinters = () => {
  if (process.platform !== 'win32') return [];
  const commands = [
    'powershell.exe -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
    'wmic printer get name'
  ];
  for (const cmd of commands) {
    try {
      const output = execSync(cmd, { encoding: 'utf8' });
      const printers = parsePrinterLines(output);
      if (printers.length) {
        logInfo('fallback printer list', { count: printers.length, source: cmd.split(' ')[0] });
        return printers;
      }
    } catch (error) {
      logError('fallback printer list error', { source: cmd.split(' ')[0], error: String(error.message || error) });
    }
  }
  return [];
};

const getElectronPrinters = async () => {
  if (!mainWindow || !mainWindow.webContents || typeof mainWindow.webContents.getPrintersAsync !== 'function') {
    return [];
  }
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return Array.isArray(printers) ? printers : [];
  } catch (error) {
    logError('electron printer list error', { error: String(error?.message || error) });
    return [];
  }
};

const getPrinters = (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && cachedPrinters.length > 0 && now - printersCachedAt < PRINTER_CACHE_MS) {
    return cachedPrinters;
  }
  let printers = [];
  if (!printer || typeof printer.getPrinters !== 'function') {
    printers = getSystemPrinters();
    cachedPrinters = printers;
    printersCachedAt = now;
    return printers;
  }
  try {
    const list = printer.getPrinters() || [];
    if (!list.length) {
      const fallback = getSystemPrinters();
      if (fallback.length) {
        cachedPrinters = fallback;
        printersCachedAt = now;
        return fallback;
      }
    }
    printers = list;
  } catch (error) {
    logError('printer list error', { error: String(error.message || error) });
    printers = getSystemPrinters();
  }
  cachedPrinters = printers;
  printersCachedAt = now;
  return printers;
};

const getPrintersAsync = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && cachedPrinters.length > 0 && now - printersCachedAt < PRINTER_CACHE_MS) {
    return cachedPrinters;
  }
  let printers = [];
  if (printer && typeof printer.getPrinters === 'function') {
    try {
      printers = printer.getPrinters() || [];
    } catch (error) {
      logError('printer list error', { error: String(error?.message || error) });
    }
  }
  if (!printers.length) {
    printers = await getElectronPrinters();
  }
  if (!printers.length) {
    printers = getSystemPrinters();
  }
  cachedPrinters = printers;
  printersCachedAt = now;
  return printers;
};

const updateStatus = (updates) => {
  Object.assign(state, updates);
  if (!state.healthStatus) state.healthStatus = 'HEALTHY';
  if (state.lastError) state.healthStatus = 'ERROR';
  else if (!state.connected && state.healthStatus === 'HEALTHY') state.healthStatus = 'DEGRADED';
  if (mainWindow) {
    mainWindow.webContents.send('status-update', state);
  }
  updateTrayIcon(state);
};

const apiRequest = async (config, endpoint, options = {}) => {
  const url = `${config.apiUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      logError('api request failed', { endpoint, status: response.status, body: text });
      throw new Error(`API error ${response.status}: ${text}`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`API timeout after ${timeoutMs}ms`);
      logError('api request timeout', { endpoint, timeoutMs });
      throw timeoutError;
    }
    logError('api request error', { endpoint, error: String(error.message || error) });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const registerMachine = async (config) => {
  const payload = {
    merchantId: config.merchantId,
    machineId: config.machineId,
    stationIds: config.assignedStationIds || []
  };
  logInfo('registering machine', {
    merchantId: config.merchantId,
    machineId: config.machineId,
    url: `${config.apiUrl}/api/print/register`
  });
  const data = await withRetry(
    () =>
      apiRequest(config, '/api/print/register', {
        method: 'POST',
        body: payload
      }),
    { attempts: API_RETRY_ATTEMPTS }
  );
  return {
    storeName: data.storeName || '',
    printToken: data.printToken || '',
    printerStations: normalizePrinterStations(data.printerStations)
  };
};

const isAuthApiError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('api error 401') ||
    message.includes('api error 403') ||
    message.includes('unauthorized') ||
    message.includes('invalid token')
  );
};

const reRegisterMachine = async (reason = 'unknown') => {
  if (registrationInFlight) return registrationInFlight;
  const config = ensureConfig();
  if (!config.merchantId) {
    throw new Error('merchantId missing');
  }
  registrationInFlight = (async () => {
    logInfo('re-registering machine', { reason, merchantId: config.merchantId, machineId: config.machineId });
    const registration = await registerMachine(config);
    const stations = normalizePrinterStations(registration.printerStations || config.printerStations);
    const nextConfig = {
      ...config,
      storeName: registration.storeName || config.storeName || '',
      printToken: registration.printToken || config.printToken || '',
      printerStations: stations,
      assignedStationIds: normalizeAssignedStationIds(config.assignedStationIds, stations),
      stationPrinters: normalizeStationPrinterMap(config.stationPrinters, stations)
    };
    saveConfig(nextConfig);
    currentConfig = nextConfig;
    updateStatus({
      storeName: nextConfig.storeName,
      connected: true,
      lastError: '',
      currentStatus: processingQueue ? 'Printing' : 'Idle'
    });
    setHealthStatus('HEALTHY');
    logInfo('re-registering machine success', {
      reason,
      merchantId: nextConfig.merchantId,
      machineId: nextConfig.machineId
    });
    return nextConfig;
  })();

  try {
    return await registrationInFlight;
  } finally {
    registrationInFlight = null;
  }
};

const sanitizePrintText = (value) => {
  if (!value) return '';
  return String(value).replace(/\r\n/g, '\n');
};

const wrapLine = (line, columns) => {
  if (!line) return [''];
  if (line.length <= columns) return [line];
  const words = line.split(' ');
  const wrapped = [];
  let current = '';
  words.forEach((word) => {
    if (!word) return;
    if (!current.length) {
      current = word;
      return;
    }
    if (current.length + 1 + word.length <= columns) {
      current = `${current} ${word}`;
      return;
    }
    wrapped.push(current);
    if (word.length <= columns) {
      current = word;
      return;
    }
    let remaining = word;
    while (remaining.length > columns) {
      wrapped.push(remaining.slice(0, columns));
      remaining = remaining.slice(columns);
    }
    current = remaining;
  });
  if (current.length) wrapped.push(current);
  return wrapped.length ? wrapped : [''];
};

const countWrappedLines = (text, columns) => {
  const normalized = sanitizePrintText(text);
  const baseLines = normalized.split('\n');
  return baseLines.reduce((total, line) => total + wrapLine(line, columns).length, 0);
};

const computeFeedLines = (totalLines) => {
  const base = 4;
  const computed = Math.ceil(totalLines / 12);
  return Math.min(10, Math.max(base, computed));
};

const encodePrintText = (value) => {
  const text = sanitizePrintText(value);
  if (iconv && typeof iconv.encodingExists === 'function' && iconv.encodingExists('cp860')) {
    return iconv.encode(text, 'cp860');
  }
  return Buffer.from(text, 'latin1');
};

const formatPrintPayload = (job) => {
  const text = job.printText || job.text || job.content || job.body || JSON.stringify(job, null, 2);
  const totalLines = countWrappedLines(text, PRINT_WRAP_COLUMNS);
  const feedLines = computeFeedLines(totalLines);
  const textWithFeed = `${text}${'\n'.repeat(feedLines)}`;
  const encoded = encodePrintText(textWithFeed);
  return { data: Buffer.concat([ESC_POS_CHARSET_CP860, encoded, ESC_POS_CUT]), totalLines, feedLines };
};

const validatePrinterName = async (printerName) => {
  if (!printerName) return false;
  const printers = await getPrintersAsync();
  const exists = printers.some((item) => item.name === printerName);
  if (!exists) {
    if (!lastPrinterMissing) {
      logError('printer not found', { printerName });
      updateStatus({ lastError: `Impressora nao encontrada: ${printerName}` });
    }
    lastPrinterMissing = true;
    return false;
  }
  if (lastPrinterMissing) {
    logInfo('printer available again', { printerName });
    updateStatus({ lastError: '' });
  }
  lastPrinterMissing = false;
  return true;
};

const resolveJobPrinterName = (config, job) => {
  const stationId = normalizeStationId(job?.stationId || '');
  if (stationId) {
    const mapped = (config.stationPrinters || {})[stationId];
    if (mapped) return mapped;
  }
  return config.printerName || '';
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderPrintHtml = (job) => {
  const text = sanitizePrintText(job.printText || job.text || job.content || job.body || JSON.stringify(job, null, 2));
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { margin: 4mm; }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
        font-family: Consolas, "Courier New", monospace;
        font-size: 12px;
        line-height: 1.25;
        white-space: pre-wrap;
        word-break: break-word;
      }
      body { padding: 4mm; }
    </style>
  </head>
  <body>${escapeHtml(text)}</body>
</html>`;
};

const printViaElectron = async (printerName, job) => {
  const printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderPrintHtml(job))}`);
    await new Promise((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: false,
          deviceName: printerName,
          margins: { marginType: 'none' }
        },
        (success, failureReason) => {
          if (success) {
            resolve();
            return;
          }
          reject(new Error(failureReason || 'electron print failed'));
        }
      );
    });
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
};

const printJob = async (config, job) => {
  const printerName = resolveJobPrinterName(config, job);
  if (!printerName) {
    throw new Error('printer not configured');
  }
  if (!(await validatePrinterName(printerName))) {
    throw new Error('printer not found');
  }
  const payload = formatPrintPayload(job);
  const backend = printer && typeof printer.printDirect === 'function' ? 'native' : 'electron';
  logInfo('printing job', {
    jobId: job.id,
    stationId: job.stationId || '',
    printerName,
    backend,
    totalLines: payload.totalLines,
    feedLines: payload.feedLines
  });
  if (backend === 'native') {
    await new Promise((resolve, reject) => {
      printer.printDirect({
        data: payload.data,
        printer: printerName,
        type: 'RAW',
        success: (jobId) => resolve(jobId),
        error: (error) => reject(error)
      });
    });
    return;
  }
  if (printerLoadError) {
    logError('native printer module unavailable, using electron fallback', { error: printerLoadError });
    printerLoadError = '';
  }
  await printViaElectron(printerName, job);
};

const printJobWithTimeout = async (config, job, timeoutMs) => new Promise((resolve, reject) => {
  let done = false;
  const timeout = setTimeout(() => {
    if (done) return;
    done = true;
    reject(new Error('print timeout'));
  }, timeoutMs);

  printJob(config, job)
    .then((result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(result);
    })
    .catch((error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      reject(error);
    });
});

const markPrinted = async (config, jobId) => {
  logInfo('ack start', { jobId, url: `${config.apiUrl}/api/print/jobs/${jobId}/printed` });
  try {
    await withRetry(
      () =>
        apiRequest(config, `/api/print/jobs/${jobId}/printed`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.printToken}`
          }
        }),
      { attempts: API_RETRY_ATTEMPTS }
    );
  } catch (error) {
    if (!isAuthApiError(error)) throw error;
    const nextConfig = await reRegisterMachine('ack-auth-failed');
    await apiRequest(nextConfig, `/api/print/jobs/${jobId}/printed`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${nextConfig.printToken}`
      }
    });
  }
  logInfo('ack success', { jobId });
};

const markFailed = async (config, jobId, reason, retry = true) => {
  logInfo('mark failed start', { jobId, retry });
  try {
    await withRetry(
      () =>
        apiRequest(config, `/api/print/jobs/${jobId}/failed`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.printToken}`
          },
          body: { reason, retry }
        }),
      { attempts: API_RETRY_ATTEMPTS }
    );
  } catch (error) {
    if (!isAuthApiError(error)) throw error;
    const nextConfig = await reRegisterMachine('mark-failed-auth-failed');
    await apiRequest(nextConfig, `/api/print/jobs/${jobId}/failed`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${nextConfig.printToken}`
      },
      body: { reason, retry }
    });
  }
  logInfo('mark failed success', { jobId });
};

const shouldRetryPrintFailure = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  if (
    message.includes('printer module not available') ||
    message.includes('printer not configured') ||
    message.includes('printer not found') ||
    message.includes('electron print failed') ||
    message.includes('invalid printer settings')
  ) {
    return false;
  }
  return true;
};

const enqueueJobs = (jobs) => {
  let added = 0;
  jobs.forEach((job) => {
    if (!job || !job.id) return;
    if (wasJobProcessedRecently(job.id)) {
      logInfo('job skipped (already processed)', { jobId: job.id });
      return;
    }
    if (inFlightJobIds.has(job.id)) return;
    inFlightJobIds.add(job.id);
    jobQueue.push(job);
    added += 1;
    logInfo('job picked', { jobId: job.id });
  });
  return added;
};

const processQueue = async () => {
  if (processingQueue) return;
  processingQueue = true;
  lastQueueActivityAt = Date.now();
  setHealthStatus('HEALTHY');
  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    if (!job) continue;
    const config = currentConfig || ensureConfig();
    lastQueueActivityAt = Date.now();
    updateStatus({ currentStatus: 'Printing' });
    logInfo('print start', { jobId: job.id, printerName: config.printerName });
      try {
        await printJobWithTimeout(config, job, PRINT_TIMEOUT_MS);
      logInfo('print success', { jobId: job.id });
      try {
        await markPrinted(config, job.id);
        markJobProcessed(job.id);
        updateStatus({
          lastPrintedAt: new Date().toISOString(),
          lastPrintedId: job.id,
          lastError: ''
        });
        setHealthStatus('HEALTHY');
      } catch (ackError) {
        const ackMessage = String(ackError?.message || ackError);
        logError('ack error', { jobId: job.id, error: ackMessage });
        updateStatus({ lastError: ackMessage, currentStatus: 'Error' });
        setHealthStatus('DEGRADED');
        try {
          await markFailed(config, job.id, `ack failed: ${ackMessage}`, false);
        } catch (markError) {
          logError('mark failed error', {
            jobId: job.id,
            error: String(markError?.message || markError)
          });
        }
      }
    } catch (error) {
      const message = String(error?.message || error);
      logError('print error', { jobId: job.id, error: message, stack: error?.stack });
      updateStatus({ lastError: message, currentStatus: 'Error' });
      setHealthStatus('ERROR');
      try {
        await markFailed(config, job.id, message, shouldRetryPrintFailure(error));
      } catch (markError) {
        logError('mark failed error', {
          jobId: job.id,
          error: String(markError?.message || markError)
        });
      }
    } finally {
      inFlightJobIds.delete(job.id);
      lastQueueActivityAt = Date.now();
    }
  }
  processingQueue = false;
  updateStatus({ currentStatus: state.lastError ? 'Error' : 'Idle' });
};

const pollJobs = async () => {
  if (pollingInFlight) return;
  if (!mainWindow) return;
  const config = ensureConfig();
  currentConfig = config;
  if (!config.merchantId) return;
  pollingInFlight = true;
  lastPollStartedAt = Date.now();
  try {
    let activeConfig = config;
    if (!activeConfig.printToken) {
      activeConfig = await reRegisterMachine('missing-token');
      currentConfig = activeConfig;
    }
    if (config.printerName) {
      await validatePrinterName(config.printerName);
    }
    const stationIds = Array.isArray(activeConfig.assignedStationIds) ? activeConfig.assignedStationIds : [];
    const stationQuery = stationIds.length > 0 ? `&stationIds=${encodeURIComponent(stationIds.join(','))}` : '';
    logInfo('polling start', {
      url: `${activeConfig.apiUrl}/api/print/jobs?merchantId=${encodeURIComponent(activeConfig.merchantId)}${stationQuery}`
    });
    const jobs = await withRetry(
      () =>
        apiRequest(
          activeConfig,
          `/api/print/jobs?merchantId=${encodeURIComponent(activeConfig.merchantId)}${stationQuery}`,
          {
            headers: {
              Authorization: `Bearer ${activeConfig.printToken}`
            }
          }
        ),
      { attempts: API_RETRY_ATTEMPTS }
    );
    const count = Array.isArray(jobs) ? jobs.length : 0;
    logInfo('polling success', { count });
    setHealthStatus('HEALTHY');
    updateStatus({ connected: true, lastError: '' });
    if (Array.isArray(jobs)) {
      const added = enqueueJobs(jobs);
      if (added > 0) {
        processQueue();
      }
    }
  } catch (error) {
    const message = String(error?.message || error);
    logError('polling error', { error: message });
    if (isAuthApiError(error)) {
      try {
        await reRegisterMachine('poll-auth-failed');
        updateStatus({ lastError: '', currentStatus: processingQueue ? 'Printing' : 'Idle' });
        setHealthStatus('HEALTHY');
      } catch (registrationError) {
        const registrationMessage = String(registrationError?.message || registrationError);
        logError('polling re-register error', { error: registrationMessage });
        updateStatus({ connected: false, lastError: registrationMessage, currentStatus: 'Error' });
        setHealthStatus('ERROR');
      }
    } else {
      updateStatus({ lastError: message, currentStatus: 'Error' });
      setHealthStatus('DEGRADED');
    }
  } finally {
    pollingInFlight = false;
    lastPollFinishedAt = Date.now();
  }
};

const startPolling = () => {
  if (pollingTimer) return;
  if (!watchdogTimer) {
    watchdogTimer = setInterval(() => {
      const now = Date.now();
      if (pollingInFlight && lastPollStartedAt > 0 && now - lastPollStartedAt > WATCHDOG_STUCK_POLL_MS) {
        logError('watchdog recovered stuck polling', { elapsedMs: now - lastPollStartedAt });
        pollingInFlight = false;
        setHealthStatus('DEGRADED');
      }
      if (processingQueue && lastQueueActivityAt > 0 && now - lastQueueActivityAt > WATCHDOG_STUCK_QUEUE_MS) {
        logError('watchdog recovered stuck queue', { elapsedMs: now - lastQueueActivityAt, queued: jobQueue.length });
        processingQueue = false;
        setHealthStatus('DEGRADED');
      }
    }, WATCHDOG_INTERVAL_MS);
  }
  pollingTimer = setInterval(pollJobs, POLL_INTERVAL_MS);
};

const stopPolling = () => {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
};

const ensureConfig = () => {
  const rawConfig = loadConfig();
  const { config: merged, apiUrlSource } = resolveConfig(rawConfig);
  const nextConfig = { ...merged };
  if (!nextConfig.machineId) {
    nextConfig.machineId = randomUUID();
  }
  if (!nextConfig.apiUrl) nextConfig.apiUrl = getDefaultApiUrl();
  nextConfig.printerStations = normalizePrinterStations(nextConfig.printerStations);
  nextConfig.assignedStationIds = normalizeAssignedStationIds(nextConfig.assignedStationIds, nextConfig.printerStations);
  nextConfig.stationPrinters = normalizeStationPrinterMap(nextConfig.stationPrinters, nextConfig.printerStations);
  if (typeof nextConfig.autoLaunchEnabled !== 'boolean') {
    nextConfig.autoLaunchEnabled = false;
  }
  if (app.isPackaged && apiUrlSource === 'default' && isLocalhostUrl(rawConfig?.apiUrl || '')) {
    logInfo('overrode localhost apiUrl with production default', {
      previousApiUrl: rawConfig.apiUrl,
      apiUrl: nextConfig.apiUrl
    });
  }
  saveConfig(nextConfig);
  return nextConfig;
};

const applyAutoLaunchSetting = (enabled) => {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: app.getPath('exe')
  });
};

const resolveTrayIconPath = (fileName) => {
  return path.join(app.getAppPath(), 'src', 'assets', fileName);
};

const loadTrayIcon = (hasError) => {
  const preferred = resolveTrayIconPath(hasError ? TRAY_ICON_ERROR : TRAY_ICON_OK);
  let icon = nativeImage.createFromPath(preferred);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(resolveTrayIconPath('tray.ico'));
  }
  return icon;
};

const updateTrayIcon = (nextState = state) => {
  if (!tray) return;
  const hasError = Boolean(nextState.lastError || nextState.currentStatus === 'Error');
  const nextTrayState = hasError ? 'error' : 'ok';
  if (trayState === nextTrayState) return;
  tray.setImage(loadTrayIcon(hasError));
  trayState = nextTrayState;
};

const showMainWindow = () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const setupTray = () => {
  tray = new Tray(loadTrayIcon(false));
  trayState = 'ok';
  tray.setToolTip('Menufaz Print');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir', click: () => showMainWindow() },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => showMainWindow());
  updateTrayIcon(state);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    title: 'Menufaz Print',
    width: 520,
    height: 720,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin') return;
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
};

const initialize = async () => {
  logInfo('initializing app');
  const config = ensureConfig();
  logInfo('merchant loaded', { merchantId: config.merchantId || '' });
  updateStatus({ connected: false, lastError: '', currentStatus: 'Idle', healthStatus: 'DEGRADED' });

  if (config.merchantId) {
    try {
      const nextConfig = await reRegisterMachine('initialize');
      logInfo('registered', { storeName: nextConfig.storeName });
    } catch (error) {
      logError('registration error', { error: String(error.message || error) });
      updateStatus({ connected: false, lastError: String(error.message || error) });
      setHealthStatus('ERROR');
    } finally {
      startPolling();
    }
  } else {
    updateStatus({ connected: false, healthStatus: 'DEGRADED' });
  }
};

ipcMain.handle('get-state', () => {
  const config = ensureConfig();
  return {
    config,
    printers: getPrinters(),
    status: state,
    isPackaged: app.isPackaged
  };
});

ipcMain.handle('set-merchant', async (_event, payload) => {
  const config = ensureConfig();
  const incomingApiUrl = payload.apiUrl || config.apiUrl;
  const nextApiUrl =
    app.isPackaged && isLocalhostUrl(incomingApiUrl) ? getDefaultApiUrl() : incomingApiUrl;
  const nextConfig = {
    ...config,
    merchantId: payload.merchantId || config.merchantId,
    apiUrl: nextApiUrl
  };
  saveConfig(nextConfig);
  logInfo('merchant updated', { merchantId: nextConfig.merchantId, apiUrl: nextConfig.apiUrl });
  await initialize();
  return { success: true, config: nextConfig };
});

ipcMain.handle('reset-config', async () => {
  const { userDataPath } = getConfigPaths();
  const current = loadConfig();
  try {
    if (fs.existsSync(userDataPath)) fs.unlinkSync(userDataPath);
  } catch {}
  const nextConfig = {
    merchantId: current.merchantId || '',
    machineId: current.machineId || randomUUID(),
    apiUrl: getDefaultApiUrl(),
    autoLaunchEnabled: Boolean(current.autoLaunchEnabled)
  };
  saveConfig(nextConfig);
  logInfo('config reset', { merchantId: nextConfig.merchantId, apiUrl: nextConfig.apiUrl });
  await initialize();
  return { success: true, config: nextConfig };
});

ipcMain.handle('refresh-printers', () => {
  return getPrintersAsync(true);
});

ipcMain.handle('set-printer', (_event, payload) => {
  const config = ensureConfig();
  const nextConfig = { ...config, printerName: payload.printerName || '' };
  saveConfig(nextConfig);
  logInfo('printer selected', { printerName: nextConfig.printerName });
  return { success: true, config: nextConfig };
});

ipcMain.handle('set-station-printer', (_event, payload) => {
  const config = ensureConfig();
  const stationId = normalizeStationId(payload?.stationId || '');
  if (!stationId) return { success: false, config };
  const stations = normalizePrinterStations(config.printerStations);
  const stationSet = new Set(stations.map((station) => station.id));
  if (!stationSet.has(stationId)) return { success: false, config };
  const stationPrinters = { ...(config.stationPrinters || {}) };
  const printerName = (payload?.printerName || '').toString().trim();
  if (!printerName) delete stationPrinters[stationId];
  else stationPrinters[stationId] = printerName;
  const nextConfig = {
    ...config,
    printerStations: stations,
    stationPrinters: normalizeStationPrinterMap(stationPrinters, stations)
  };
  saveConfig(nextConfig);
  logInfo('station printer selected', { stationId, printerName: stationPrinters[stationId] || '' });
  return { success: true, config: nextConfig };
});

ipcMain.handle('set-assigned-stations', (_event, payload) => {
  const config = ensureConfig();
  const stations = normalizePrinterStations(config.printerStations);
  const nextAssigned = normalizeAssignedStationIds(payload?.stationIds, stations);
  const nextConfig = {
    ...config,
    printerStations: stations,
    assignedStationIds: nextAssigned,
    stationPrinters: normalizeStationPrinterMap(config.stationPrinters, stations)
  };
  saveConfig(nextConfig);
  logInfo('assigned stations updated', { stationIds: nextAssigned });
  return { success: true, config: nextConfig };
});

ipcMain.handle('get-auto-launch', () => {
  const config = ensureConfig();
  return { enabled: Boolean(config.autoLaunchEnabled) };
});

ipcMain.handle('set-auto-launch', (_event, payload) => {
  const config = ensureConfig();
  const enabled = Boolean(payload?.enabled);
  const nextConfig = { ...config, autoLaunchEnabled: enabled };
  saveConfig(nextConfig);
  applyAutoLaunchSetting(enabled);
  return { success: true, config: nextConfig };
});

ipcMain.handle('test-print', async () => {
  const config = ensureConfig();
  const printerName = config.printerName || '';
  if (!(await validatePrinterName(printerName))) {
    logError('test print failed', { error: 'printer not found' });
    updateStatus({ lastError: 'Impressora nao encontrada.' });
    throw new Error('printer not found');
  }
  const storeName = config.storeName || state.storeName || 'Menufaz';
  const longLines = Array.from({ length: 60 }, (_, index) =>
    `Item ${index + 1} - Observacao longa com acentuacao: Acucar, Feijao, Pao de queijo.`
  );
  const testJob = {
    id: `test-${Date.now()}`,
    printText: [
      '*** TESTE DE IMPRESSAO MENUFAZ ***',
      storeName,
      config.merchantId || '',
      new Date().toLocaleString(),
      '',
      'Feijão',
      'Açúcar',
      'Informação',
      'Pão de queijo',
      'Coração',
      ...longLines,
      ''
    ].join('\n')
  };
  try {
    await printJob(config, testJob);
    logInfo('test print success', { printerName: config.printerName });
  } catch (error) {
    logError('test print error', { error: String(error.message || error) });
    throw error;
  }
  updateStatus({
    lastPrintedAt: new Date().toISOString(),
    lastPrintedId: testJob.id,
    lastError: ''
  });
  return { success: true };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  ensureLogFile();
  ensureProcessedJobsPath();
  loadProcessedJobs();
  logInfo('app started');
  createWindow();
  setupTray();
  const config = ensureConfig();
  applyAutoLaunchSetting(config.autoLaunchEnabled);
  initialize();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    app.quit();
  }
});
