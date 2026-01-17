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

const DEFAULT_API_URL = 'http://localhost:3001';
const CONFIG_FILENAME = 'config.json';
const POLL_INTERVAL_MS = 5000;

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

const mergeConfigWithArgs = (config) => {
  const args = normalizeArgs();
  const merchantId = args.merchantId || args['merchant-id'] || config.merchantId || '';
  const apiUrl = args.apiUrl || args['api-url'] || config.apiUrl || DEFAULT_API_URL;
  return {
    ...config,
    merchantId,
    apiUrl
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
  logInfo('registering machine', { merchantId: config.merchantId, machineId: config.machineId });
  const data = await apiRequest(config, '/api/print/register', {
    method: 'POST',
    body: payload
  });
  return {
    storeName: data.storeName || '',
    printToken: data.printToken || ''
  };
};

const formatPrintText = (job) => {
  const text = job.printText || job.text || job.content || job.body || JSON.stringify(job, null, 2);
  const cut = '\n\n\n\x1D\x56\x00';
  return `${text}${cut}`;
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
  printer.printDirect({
    data: formatPrintText(job),
    printer: config.printerName,
    type: 'RAW',
    success: (jobId) => resolve(jobId),
    error: (error) => reject(error)
  });
});

const markPrinted = async (config, jobId) => {
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
  const config = mainWindow.webContents.getURL() ? loadConfig() : loadConfig();
  if (!config.printToken || !config.merchantId) return;
  pollingInFlight = true;
  try {
    validatePrinter(config);
    logInfo('polling jobs');
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
  const merged = mergeConfigWithArgs(rawConfig);
  if (!merged.machineId) {
    merged.machineId = randomUUID();
  }
  if (!merged.apiUrl) merged.apiUrl = DEFAULT_API_URL;
  saveConfig(merged);
  return merged;
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
    status: state
  };
});

ipcMain.handle('set-merchant', async (_event, payload) => {
  const config = ensureConfig();
  const nextConfig = {
    ...config,
    merchantId: payload.merchantId || config.merchantId,
    apiUrl: payload.apiUrl || config.apiUrl
  };
  saveConfig(nextConfig);
  logInfo('merchant updated', { merchantId: nextConfig.merchantId });
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
  const testJob = {
    id: `test-${Date.now()}`,
    printText: `*** TESTE DE IMPRESSAO MENUFAZ ***\n${storeName}\n${config.merchantId || ''}\n${new Date().toLocaleString()}\n\n`
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
