const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron
});

/* Only used by the setup wizard window */
if (window.location.pathname.indexOf('/setup/') !== -1) {
  contextBridge.exposeInMainWorld('setupAPI', {
    complete: (config) => ipcRenderer.send('setup-complete', config),
    scanServer: (ip, port) => ipcRenderer.send('setup-scan-server', ip, port),
    onScanResult: (cb) => ipcRenderer.on('setup-scan-result', (e, res) => cb(res))
  });
}