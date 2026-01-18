const state = {
  config: {},
  printers: [],
  status: {},
  isPackaged: false
};

const elements = {
  storeName: document.getElementById('storeName'),
  merchantIdLabel: document.getElementById('merchantIdLabel'),
  apiUrlLabel: document.getElementById('apiUrlLabel'),
  merchantIdInput: document.getElementById('merchantIdInput'),
  apiUrlInput: document.getElementById('apiUrlInput'),
  apiUrlRow: document.getElementById('apiUrlRow'),
  apiUrlReadOnly: document.getElementById('apiUrlReadOnly'),
  saveMerchant: document.getElementById('saveMerchant'),
  printerSelect: document.getElementById('printerSelect'),
  refreshPrinters: document.getElementById('refreshPrinters'),
  testPrint: document.getElementById('testPrint'),
  printerHint: document.getElementById('printerHint'),
  connectedStatus: document.getElementById('connectedStatus'),
  lastPrinted: document.getElementById('lastPrinted'),
  lastError: document.getElementById('lastError')
};

const formatDate = (value) => {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
};

const renderConfig = () => {
  elements.merchantIdLabel.textContent = state.config.merchantId || '-';
  elements.apiUrlLabel.textContent = state.config.apiUrl || '-';
  elements.merchantIdInput.value = state.config.merchantId || '';
  if (state.isPackaged) {
    elements.apiUrlRow.style.display = 'none';
    elements.apiUrlReadOnly.textContent = `API: ${state.config.apiUrl || 'https://app.menufaz.com'}`;
  } else {
    elements.apiUrlRow.style.display = 'flex';
    elements.apiUrlReadOnly.textContent = '';
    elements.apiUrlInput.value = state.config.apiUrl || '';
  }
};

const renderStatus = () => {
  elements.storeName.textContent = state.status.storeName || 'Not connected';
  elements.connectedStatus.textContent = state.status.connected ? 'Yes' : 'No';
  elements.lastPrinted.textContent = state.status.lastPrintedAt
    ? `${formatDate(state.status.lastPrintedAt)} (${state.status.lastPrintedId || ''})`
    : '-';
  elements.lastError.textContent = state.status.lastError || '-';
};

const renderPrinters = () => {
  elements.printerSelect.innerHTML = '';
  if (!state.printers.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No printers found';
    elements.printerSelect.appendChild(option);
    elements.printerHint.textContent = 'Install a printer to enable printing.';
    return;
  }
  elements.printerHint.textContent = '';
  state.printers.forEach((printer) => {
    const option = document.createElement('option');
    option.value = printer.name;
    option.textContent = printer.name;
    if (printer.name === state.config.printerName) {
      option.selected = true;
    }
    elements.printerSelect.appendChild(option);
  });
  if (state.config.printerName && !state.printers.some((printer) => printer.name === state.config.printerName)) {
    elements.printerHint.textContent = `Impressora configurada não encontrada: ${state.config.printerName}`;
  }
};

const loadState = async () => {
  const data = await window.menufazPrint.getState();
  state.config = data.config || {};
  state.printers = data.printers || [];
  state.status = data.status || {};
  state.isPackaged = Boolean(data.isPackaged);
  renderConfig();
  renderPrinters();
  renderStatus();
};

elements.saveMerchant.addEventListener('click', async () => {
  const merchantId = elements.merchantIdInput.value.trim();
  const apiUrl = state.isPackaged
    ? state.config.apiUrl || 'https://app.menufaz.com'
    : elements.apiUrlInput.value.trim();
  await window.menufazPrint.setMerchant({ merchantId, apiUrl });
  await loadState();
});

elements.refreshPrinters.addEventListener('click', async () => {
  state.printers = await window.menufazPrint.refreshPrinters();
  renderPrinters();
});

elements.printerSelect.addEventListener('change', async (event) => {
  const printerName = event.target.value;
  const result = await window.menufazPrint.setPrinter(printerName);
  state.config = result.config || state.config;
  renderConfig();
});

elements.testPrint.addEventListener('click', async () => {
  try {
    await window.menufazPrint.testPrint();
  } catch (error) {
    state.status.lastError = String(error.message || error);
  }
  renderStatus();
});

window.menufazPrint.onStatusUpdate((status) => {
  state.status = status || state.status;
  renderStatus();
});

loadState();
