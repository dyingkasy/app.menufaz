const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menufazPrint', {
  getState: () => ipcRenderer.invoke('get-state'),
  setMerchant: (payload) => ipcRenderer.invoke('set-merchant', payload),
  refreshPrinters: () => ipcRenderer.invoke('refresh-printers'),
  setPrinter: (printerName) => ipcRenderer.invoke('set-printer', { printerName }),
  testPrint: () => ipcRenderer.invoke('test-print'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_event, data) => callback(data))
});
