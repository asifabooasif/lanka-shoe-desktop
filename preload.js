'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/* Parse --lk-* arguments that main.js passed into this window */
const argv = process.argv;
function arg(name) {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : '';
}

const role       = arg('lk-role');
const serverIp   = arg('lk-server-ip');
const serverPort = arg('lk-server-port');
const token      = arg('lk-token');

/* Expose LAN config to index.html — read-only.
   Frozen so page scripts can't accidentally overwrite the role. */
const LK_MODE = Object.freeze({
  role: role,                                   // 'main' | 'client' | 'setup'
  serverIp: serverIp,
  serverPort: parseInt(serverPort, 10) || 3001,
  isElectron: true,
  version: '1.0.0'
});

/* Optional LAN auth token — null when no .token file exists. */
const LK_TOKEN = Object.freeze({
  value: token || null,
  enabled: !!token
});

contextBridge.exposeInMainWorld('LK_MODE', LK_MODE);
contextBridge.exposeInMainWorld('LK_TOKEN', LK_TOKEN);

/* Bridge for setup.html only — sends role choice back to main. */
contextBridge.exposeInMainWorld('LK_SETUP', {
  complete: (payload) => ipcRenderer.send('setup-complete', payload)
});