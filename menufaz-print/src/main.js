const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

let printer = null;
try {
  printer = require('printer');
} catch (error) {
  printer = null;
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
const ESC_POS_CHARSET_CP860 = Buffer.from([0x1b, 0x74, 0x03]);
const ESC_POS_CUT = Buffer.from([0x1d, 0x56, 0x00]);
const PRINT_WRAP_COLUMNS = 48;

let mainWindow = null;
let tray = null;
let pollingTimer = null;
let pollingInFlight = false;
let lastPrinterMissing = false;
let logFilePath = '';

const state = {
  storeName: '',
  connected: false,
  lastPrintedAt: '',
  lastPrintedId: '',
  lastError: '',
  printerSupport: Boolean(printer)
};

const ensureLogFile = () => {
  if (logFilePath) return logFilePath;
  const baseDir = app?.isPackaged ? app.getPath('userData') : process.cwd();
  const logDir = path.join(baseDir, 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {}
  logFilePath = path.join(logDir, 'app.log');
  return logFilePath;
};

const writeLog = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${timestamp}] [${level}] ${message}${payload}\n`;
  try {
    fs.appendFileSync(ensureLogFile(), line);
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

const loadConfig = () => {
  const { cwdPath, userDataPath } = getConfigPaths();
  const readConfig = (filePath) => {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      return null;
    }
  };
  return readConfig(cwdPath) || readConfig(userDataPath) || {};
};

const saveConfig = (config) => {
  const { userDataPath } = getConfigPaths();
  fs.writeFileSync(userDataPath, JSON.stringify(config, null, 2));
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
  return {
    config: {
      ...rawConfig,
      merchantId,
      apiUrl
    },
    apiUrlSource
  };
};

const getPrinters = () => {
  if (!printer || typeof printer.getPrinters !== 'function') return [];
  try {
    return printer.getPrinters() || [];
  } catch (error) {
    logError('printer list error', { error: String(error.message || error) });
    return [];
  }
};

const updateStatus = (updates) => {
  Object.assign(state, updates);
  if (mainWindow) {
    mainWindow.webContents.send('status-update', state);
  }
};

const apiRequest = async (config, endpoint, options = {}) => {
  const url = `${config.apiUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) {
      const text = await response.text();
      logError('api request failed', { endpoint, status: response.status, body: text });
      throw new Error(`API error ${response.status}: ${text}`);
    }
    return response.json();
  } catch (error) {
    logError('api request error', { endpoint, error: String(error.message || error) });
    throw error;
  }
};

const registerMachine = async (config) => {
  const payload = {
    merchantId: config.merchantId,
    machineId: config.machineId
  };
  logInfo('registering machine', {
    merchantId: config.merchantId,
    machineId: config.machineId,
    url: `${config.apiUrl}/api/print/register`
  });
  const data = await apiRequest(config, '/api/print/register', {
    method: 'POST',
    body: payload
  });
  return {
    storeName: data.storeName || '',
    printToken: data.printToken || ''
  };
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

const validatePrinter = (config) => {
  if (!config.printerName) return true;
  const printers = getPrinters();
  const exists = printers.some((item) => item.name === config.printerName);
  if (!exists) {
    if (!lastPrinterMissing) {
      logError('printer not found', { printerName: config.printerName });
      updateStatus({ lastError: `Impressora nao encontrada: ${config.printerName}` });
    }
    lastPrinterMissing = true;
    return false;
  }
  if (lastPrinterMissing) {
    logInfo('printer available again', { printerName: config.printerName });
    updateStatus({ lastError: '' });
  }
  lastPrinterMissing = false;
  return true;
};

const printJob = (config, job) => new Promise((resolve, reject) => {
  if (!printer) {
    reject(new Error('printer module not available'));
    return;
  }
  if (!config.printerName) {
    reject(new Error('printer not configured'));
    return;
  }
  if (!validatePrinter(config)) {
    reject(new Error('printer not found'));
    return;
  }
  const payload = formatPrintPayload(job);
  logInfo('printing job', {
    jobId: job.id,
    printerName: config.printerName,
    totalLines: payload.totalLines,
    feedLines: payload.feedLines
  });
  printer.printDirect({
    data: payload.data,
    printer: config.printerName,
    type: 'RAW',
    success: (jobId) => resolve(jobId),
    error: (error) => reject(error)
  });
});

const markPrinted = async (config, jobId) => {
  logInfo('marking printed', { jobId, url: `${config.apiUrl}/api/print/jobs/${jobId}/printed` });
  await apiRequest(config, `/api/print/jobs/${jobId}/printed`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.printToken}`
    }
  });
};

const pollJobs = async () => {
  if (pollingInFlight) return;
  if (!mainWindow) return;
  const config = ensureConfig();
  if (!config.printToken || !config.merchantId) return;
  pollingInFlight = true;
  try {
    validatePrinter(config);
    logInfo('polling jobs', {
      url: `${config.apiUrl}/api/print/jobs?merchantId=${encodeURIComponent(config.merchantId)}`
    });
    const jobs = await apiRequest(
      config,
      `/api/print/jobs?merchantId=${encodeURIComponent(config.merchantId)}`,
      {
        headers: {
          Authorization: `Bearer ${config.printToken}`
        }
      }
    );
    const count = Array.isArray(jobs) ? jobs.length : 0;
    logInfo('polling success', { count });
    if (Array.isArray(jobs)) {
      for (const job of jobs) {
        logInfo('job received', { jobId: job.id });
        try {
          await printJob(config, job);
          await markPrinted(config, job.id);
          logInfo('job printed', { jobId: job.id });
          updateStatus({
            lastPrintedAt: new Date().toISOString(),
            lastPrintedId: job.id,
            lastError: ''
          });
        } catch (error) {
          logError('print error', { jobId: job.id, error: String(error.message || error) });
          updateStatus({ lastError: String(error.message || error) });
          throw error;
        }
      }
    }
  } catch (error) {
    logError('polling error', { error: String(error.message || error) });
    updateStatus({ lastError: String(error.message || error) });
  } finally {
    pollingInFlight = false;
  }
};

const startPolling = () => {
  if (pollingTimer) return;
  pollingTimer = setInterval(pollJobs, POLL_INTERVAL_MS);
};

const stopPolling = () => {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
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
  if (app.isPackaged && apiUrlSource === 'default' && isLocalhostUrl(rawConfig?.apiUrl || '')) {
    logInfo('overrode localhost apiUrl with production default', {
      previousApiUrl: rawConfig.apiUrl,
      apiUrl: nextConfig.apiUrl
    });
  }
  saveConfig(nextConfig);
  return nextConfig;
};

const setupTray = () => {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAJXbL/8AAAAASUVORK5CYII='
  );
  tray = new Tray(icon);
  tray.setToolTip('Menufaz Print');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Mostrar', click: () => mainWindow && mainWindow.show() },
    { label: 'Sair', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow && mainWindow.show());
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 720,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin') return;
    if (tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
};

const initialize = async () => {
  logInfo('initializing app');
  const config = ensureConfig();
  logInfo('merchant loaded', { merchantId: config.merchantId || '' });
  updateStatus({ connected: false, lastError: '' });

  if (config.merchantId) {
    try {
      const registration = await registerMachine(config);
      const nextConfig = {
        ...config,
        storeName: registration.storeName,
        printToken: registration.printToken
      };
      saveConfig(nextConfig);
      logInfo('registered', { storeName: registration.storeName });
      updateStatus({ storeName: registration.storeName, connected: true });
      startPolling();
    } catch (error) {
      logError('registration error', { error: String(error.message || error) });
      updateStatus({ connected: false, lastError: String(error.message || error) });
    }
  } else {
    updateStatus({ connected: false });
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
    apiUrl: getDefaultApiUrl()
  };
  saveConfig(nextConfig);
  logInfo('config reset', { merchantId: nextConfig.merchantId, apiUrl: nextConfig.apiUrl });
  await initialize();
  return { success: true, config: nextConfig };
});

ipcMain.handle('refresh-printers', () => {
  return getPrinters();
});

ipcMain.handle('set-printer', (_event, payload) => {
  const config = ensureConfig();
  const nextConfig = { ...config, printerName: payload.printerName || '' };
  saveConfig(nextConfig);
  logInfo('printer selected', { printerName: nextConfig.printerName });
  return { success: true, config: nextConfig };
});

ipcMain.handle('test-print', async () => {
  const config = ensureConfig();
  if (!validatePrinter(config)) {
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

app.whenReady().then(() => {
  ensureLogFile();
  logInfo('app started');
  createWindow();
  setupTray();
  initialize();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopPolling();
    app.quit();
  }
});
