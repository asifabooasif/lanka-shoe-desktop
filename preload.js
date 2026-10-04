const { contextBridge } = require('electron');
const urlParams = new URLSearchParams(window.location.search);
contextBridge.exposeInMainWorld('LK_MODE', {
  role: urlParams.get('role') || 'main',
  serverIp: urlParams.get('serverIp') || '',
  serverPort: urlParams.get('serverPort') || '9876'
});
