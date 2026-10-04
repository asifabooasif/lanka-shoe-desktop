'use strict';
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

/* ══════════════════════════════════════════════════════════════════════
   CONFIG — saved per-PC in  %APPDATA%\Lanka Shoe Enterprise\config.json
═════════════════════════════════════════════════════════════════════ */
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    configured: false,
    mode: null,                 // 'server' | 'client'
    serverIP: '',
    serverPort: 3000,
    serverPin: '',
    dataDir: 'C:\\LankaShoe'
  };
}
function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) { console.error('Config save failed:', e.message); }
}

let CONFIG = loadConfig();

/* ══════════════════════════════════════════════════════════════════════
   GLOBALS
═════════════════════════════════════════════════════════════════════ */
let mainWindow = null;
let setupWindow = null;
let httpServer = null;
let wss = null;
let expressApp = null;
let DB = null;
let DATA_FILE = null;
let BACKUP_DIR = null;
let currentPort = 3000;
let _lastWriteTime = 0;
let _writeQueue = Promise.resolve();

/* ══════════════════════════════════════════════════════════════════════
   SETUP WIZARD
═════════════════════════════════════════════════════════════════════ */
function showSetupWizard() {
  setupWindow = new BrowserWindow({
    width: 720, height: 640, resizable: false,
    title: 'Lanka Shoe — First Time Setup',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  setupWindow.loadFile(path.join(__dirname, 'setup', 'index.html'));

  ipcMain.removeAllListeners('setup-complete');
  ipcMain.once('setup-complete', (evt, config) => {
    CONFIG = Object.assign({}, CONFIG, config, { configured: true });
    saveConfig(CONFIG);
    if (setupWindow) { try { setupWindow.close(); } catch (e) {} setupWindow = null; }
    bootByConfig();
  });

  ipcMain.removeAllListeners('setup-scan-server');
  ipcMain.on('setup-scan-server', async (evt, ip, port) => {
    try {
      const res = await fetch('http://' + ip + ':' + (port || 3000) + '/api/health',
        { signal: AbortSignal.timeout(3000) });
      const j = await res.json();
      evt.sender.send('setup-scan-result', { ok: true, info: j });
    } catch (e) {
      evt.sender.send('setup-scan-result', { ok: false, error: e.message });
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════
   SERVER MODE
═════════════════════════════════════════════════════════════════════ */
function startServerMode() {
  DATA_FILE  = path.join(CONFIG.dataDir, 'data.json');
  BACKUP_DIR = path.join(CONFIG.dataDir, 'backups');

  [CONFIG.dataDir, BACKUP_DIR].forEach(d => {
    try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
    catch (e) { console.error('Folder create failed:', d, e.message); }
  });

  try {
    if (fs.existsSync(DATA_FILE)) {
      DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('✅ Loaded data.json (' + JSON.stringify(DB).length + ' bytes)');
    } else {
      DB = { _empty: true };
      console.log('ℹ No data.json yet — will create on first save');
    }
  } catch (e) {
    console.error('❌ Load failed:', e.message);
    try {
      if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(DATA_FILE, DATA_FILE + '.corrupt-' + Date.now());
      }
    } catch (e2) {}
    DB = { _empty: true };
  }

  /* Hourly auto-backup — keep 48 hours */
  setInterval(() => {
    try {
      if (!DB) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.writeFileSync(path.join(BACKUP_DIR, 'auto-' + stamp + '.json'),
        JSON.stringify(DB, null, 2), 'utf8');
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('auto-')).sort();
      while (files.length > 48) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); } catch (e) {}
      }
    } catch (e) { console.error('Auto-backup failed:', e.message); }
  }, 60 * 60 * 1000);

  /* Express app */
  expressApp = express();
  expressApp.use(express.json({ limit: '100mb' }));
  expressApp.use(express.static(path.join(__dirname, 'app')));

  expressApp.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app', 'index.html'));
  });

  expressApp.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      version: app.getVersion(),
      serverTime: new Date().toISOString(),
      lastWrite: _lastWriteTime,
      hasData: !!(DB && !DB._empty),
      hostname: os.hostname(),
      pinRequired: !!CONFIG.serverPin
    });
  });

  expressApp.post('/api/auth', (req, res) => {
    const { pin } = req.body || {};
    if (!CONFIG.serverPin) return res.json({ ok: true, noPinNeeded: true });
    if (pin === CONFIG.serverPin) return res.json({ ok: true });
    res.status(401).json({ ok: false, error: 'Invalid PIN' });
  });

  expressApp.get('/api/load', (req, res) => {
    if (!DB) return res.status(500).json({ error: 'Not initialized' });
    res.json({
      ok: true, data: DB,
      serverTime: new Date().toISOString(),
      lastWrite: _lastWriteTime
    });
  });

  expressApp.post('/api/save', async (req, res) => {
    try {
      const { data } = req.body || {};
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ ok: false, error: 'Invalid data' });
      }
      DB = data;
      _writeQueue = _writeQueue.then(() => new Promise((resolve, reject) => {
        try {
          const tmp = DATA_FILE + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
          fs.renameSync(tmp, DATA_FILE);
          _lastWriteTime = Date.now();
          resolve();
        } catch (e) { reject(e); }
      }));
      await _writeQueue;
      broadcast({ type: 'db-updated', at: Date.now(), from: req.ip });
      res.json({ ok: true, savedAt: new Date().toISOString() });
    } catch (e) {
      console.error('Save failed:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  expressApp.get('/api/backups', (req, res) => {
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const s = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, size: s.size, mtime: s.mtime };
        })
        .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      res.json({ ok: true, backups: files });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  expressApp.post('/api/backup', async (req, res) => {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const name = 'manual-' + stamp + '.json';
      fs.writeFileSync(path.join(BACKUP_DIR, name),
        JSON.stringify(DB, null, 2), 'utf8');
      res.json({ ok: true, name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* WebSocket server */
  httpServer = http.createServer(expressApp);
  wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws, req) => {
    console.log('🔌 Client connected:', req.socket.remoteAddress);
    try {
      ws.send(JSON.stringify({
        type: 'welcome',
        serverTime: new Date().toISOString(),
        lastWrite: _lastWriteTime
      }));
    } catch (e) {}
    ws.on('close', () => console.log('🔌 Client disconnected'));
  });

  /* Start server */
  const tryPort = (port, attempt) => new Promise(resolve => {
    attempt = attempt || 1;
    httpServer.once('error', err => {
      if (err.code === 'EADDRINUSE' && attempt <= 10) {
        setTimeout(() => resolve(tryPort(port + 1, attempt + 1)), 100);
      } else { resolve(null); }
    });
    httpServer.listen(port, '0.0.0.0', () => resolve(port));
  });

  return tryPort(CONFIG.serverPort || 3000).then(port => {
    if (!port) throw new Error('Could not bind to any port');
    currentPort = port;
    CONFIG.serverPort = port;
    saveConfig(CONFIG);
    console.log('✅ Server listening on 0.0.0.0:' + port);

    createMainWindow('http://localhost:' + port + '/');
    buildServerMenu();

    /* Show client URL after window loads */
    const ips = getLocalIPs();
    if (ips.length) {
      setTimeout(() => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '🟢 Server is running',
          message: 'Share this URL with client PCs:',
          detail: 'http://' + ips[0].ip + ':' + currentPort + '\n\n' +
                  'Client PCs must be on the same WiFi or LAN cable.',
          buttons: ['Copy URL', 'OK']
        }).then(r => {
          if (r.response === 0) clipboard.writeText('http://' + ips[0].ip + ':' + currentPort);
        });
      }, 1800);
    }
    return port;
  });
}

/* ══════════════════════════════════════════════════════════════════════
   CLIENT MODE
═════════════════════════════════════════════════════════════════════ */
function startClientMode() {
  const serverURL = 'http://' + CONFIG.serverIP + ':' + (CONFIG.serverPort || 3000);

  return fetch(serverURL + '/api/health', { signal: AbortSignal.timeout(5000) })
    .then(r => r.json())
    .then(info => {
      console.log('✅ Connected to server:', info.hostname);
      createMainWindow(serverURL + '/');
      buildClientMenu(serverURL, info);
      return info;
    })
    .catch(err => {
      dialog.showMessageBox({
        type: 'error',
        title: 'Cannot Reach Server',
        message: 'Could not connect to ' + serverURL,
        detail: 'Error: ' + err.message + '\n\n' +
          'Check:\n' +
          '1. Server PC is turned on and app is running\n' +
          '2. Both PCs on the same WiFi/LAN\n' +
          '3. Windows Firewall allows Lanka Shoe on server PC\n' +
          '4. Server IP is correct: ' + CONFIG.serverIP,
        buttons: ['Retry', 'Reconfigure', 'Close App'],
        defaultId: 0
      }).then(r => {
        if (r.response === 0) startClientMode();
        else if (r.response === 1) {
          CONFIG.configured = false;
          saveConfig(CONFIG);
          showSetupWizard();
        } else app.quit();
      });
      throw err;
    });
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN WINDOW
═════════════════════════════════════════════════════════════════════ */
function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 700,
    show: false,
    title: CONFIG.mode === 'server'
      ? 'Lanka Shoe — SERVER'
      : 'Lanka Shoe — CLIENT (' + CONFIG.serverIP + ')',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#fafaff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      nativeWindowOpen: true
    }
  });

  mainWindow.loadURL(url);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http://') || u.startsWith('https://')) {
      if (u.includes(CONFIG.serverIP) || u.includes('localhost')) {
        return { action: 'allow' };
      }
      shell.openExternal(u);
    }
    return { action: 'deny' };
  });
}

/* ══════════════════════════════════════════════════════════════════════
   MENUS
═════════════════════════════════════════════════════════════════════ */
function buildServerMenu() {
  const ips = getLocalIPs();
  const primaryIP = ips.length ? ips[0].ip : '127.0.0.1';
  const clientURL = 'http://' + primaryIP + ':' + currentPort;

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Server',
      submenu: [
        {
          label: '📋 Copy Client URL',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            clipboard.writeText(clientURL);
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'URL Copied',
              message: 'Share this with client PCs:',
              detail: clientURL
            });
          }
        },
        {
          label: '📊 Server Status',
          click: () => {
            const msg = 'Port: ' + currentPort + '\n' +
              'Data file: ' + DATA_FILE + '\n' +
              'Backups: ' + BACKUP_DIR + '\n\n' +
              'LAN IPs:\n' + ips.map(i => '  • ' + i.iface + ': ' + i.ip).join('\n') +
              '\n\nActive clients: ' + (wss ? wss.clients.size : 0);
            dialog.showMessageBox(mainWindow, { type: 'info', title: 'Server Status', message: msg });
          }
        },
        { type: 'separator' },
        {
          label: '📁 Open Data Folder',
          click: () => shell.openPath(CONFIG.dataDir)
        },
        {
          label: '💾 Backup Now',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            try {
              const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
              const name = 'manual-' + stamp + '.json';
              fs.writeFileSync(path.join(BACKUP_DIR, name),
                JSON.stringify(DB, null, 2), 'utf8');
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                message: 'Backup saved',
                detail: path.join(BACKUP_DIR, name)
              });
            } catch (e) { dialog.showErrorBox('Backup failed', e.message); }
          }
        },
        {
          label: '📂 Open Backups Folder',
          click: () => shell.openPath(BACKUP_DIR)
        },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools() }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'About',
            message: 'Lanka Shoe — SERVER',
            detail:
              'Version: ' + app.getVersion() + '\n' +
              'Mode: SERVER\n' +
              'Port: ' + currentPort + '\n' +
              'Data: ' + DATA_FILE
          })
        }
      ]
    }
  ]));
}

function buildClientMenu(serverURL, serverInfo) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Connection',
      submenu: [
        {
          label: '🔄 Reconnect',
          accelerator: 'CmdOrCtrl+R',
          click: () => { if (mainWindow) mainWindow.reload(); }
        },
        {
          label: '📊 Server Info',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Connected To',
            message: 'Server: ' + serverURL,
            detail:
              'Host: ' + (serverInfo.hostname || '—') + '\n' +
              'Version: ' + (serverInfo.version || '—') + '\n' +
              'Has data: ' + (serverInfo.hasData ? 'Yes' : 'No')
          })
        },
        { type: 'separator' },
        {
          label: '⚙ Change Server',
          click: () => {
            if (!confirm('Disconnect and configure a different server?')) return;
            CONFIG.configured = false;
            saveConfig(CONFIG);
            if (mainWindow) mainWindow.close();
            showSetupWizard();
          }
        },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools() }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'About',
            message: 'Lanka Shoe — CLIENT',
            detail:
              'Version: ' + app.getVersion() + '\n' +
              'Mode: CLIENT\n' +
              'Connected to: ' + serverURL
          })
        }
      ]
    }
  ]));
}

/* ══════════════════════════════════════════════════════════════════════
   HELPERS
═════════════════════════════════════════════════════════════════════ */
function broadcast(msg) {
  if (!wss) return;
  const p = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c.readyState === 1) {
      try { c.send(p); } catch (e) {}
    }
  });
}

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  Object.keys(nets).forEach(name => {
    (nets[name] || []).forEach(net => {
      if (net.family === 'IPv4' && !net.internal) {
        out.push({ iface: name, ip: net.address });
      }
    });
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════
   BOOT
═════════════════════════════════════════════════════════════════════ */
function bootByConfig() {
  if (!CONFIG.configured || !CONFIG.mode) {
    showSetupWizard();
    return;
  }
  if (CONFIG.mode === 'server') {
    startServerMode().catch(err => {
      dialog.showErrorBox('Server failed', String(err.message || err));
      app.quit();
    });
  } else if (CONFIG.mode === 'client') {
    startClientMode().catch(() => {});
  } else {
    showSetupWizard();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  bootByConfig();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootByConfig();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('SIGINT', () => {
  if (DB && DATA_FILE) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2)); } catch (e) {}
  }
  process.exit(0);
});