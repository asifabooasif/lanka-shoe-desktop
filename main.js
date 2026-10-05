'use strict';
const { app, BrowserWindow, dialog, Menu, ipcMain, clipboard, shell } =
  require('electron');
const path = require('path');
const fs   = require('fs');
const { startServer } = require('./server');

const DEFAULT_PORT = 3001;

/* ───── Single instance lock — prevents port conflict ───── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

/* ───── Config helpers ───── */
function configPath() {
  return path.join(app.getPath('userData'), 'lankashoe-config.json');
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch (e) { return null; }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

/* ───── LAN auth token — optional, read from userData/.token ─────
   If the file exists, its trimmed contents are used as the shared
   secret. If it does NOT exist, the LAN stays open (backward-compat). */
function readToken() {
  try {
    const f = path.join(app.getPath('userData'), '.token');
    if (fs.existsSync(f)) {
      const t = fs.readFileSync(f, 'utf8').trim();
      return t || '';
    }
  } catch (e) {}
  return '';
}

/* ───── Globals ───── */
let mainWindow  = null;
let setupWindow = null;
let httpServer  = null;
global.LK_ROLE      = null;
global.LK_SERVER_IP = '';
global.LK_PORT      = DEFAULT_PORT;
global.LK_TOKEN     = '';

/* ───── Command-line override ───── */
function readCliMode() {
  const argv = process.argv;
  const mode  = argv.find(a => a.startsWith('--mode='));
  const srv   = argv.find(a => a.startsWith('--server='));
  const port  = argv.find(a => a.startsWith('--port='));
  const token = argv.find(a => a.startsWith('--token='));
  if (mode)  global.LK_ROLE      = mode.split('=')[1];
  if (srv)   global.LK_SERVER_IP = srv.split('=')[1];
  if (port)  global.LK_PORT      = parseInt(port.split('=')[1], 10) || DEFAULT_PORT;
  if (token) global.LK_TOKEN     = token.split('=').slice(1).join('=');
}

/* ───── Setup window (first run) ───── */
function openSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 640,
    height: 560,
    resizable: false,
    title: 'Lanka Shoe — First-time Setup',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--lk-role=setup']
    }
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile('setup.html');

  /* If user closes setup without choosing, quit cleanly */
  setupWindow.on('closed', () => {
    setupWindow = null;
    if (!global.LK_ROLE) app.quit();
  });

  ipcMain.once('setup-complete', (_e, payload) => {
    saveConfig({
      role: payload.role,
      serverIp: payload.serverIp || '',
      port: DEFAULT_PORT
    });
    global.LK_ROLE      = payload.role;
    global.LK_SERVER_IP = payload.serverIp || '';
    if (setupWindow) { setupWindow.close(); setupWindow = null; }
    launchMain();
  });
}

/* ───── Main app window ───── */
function launchMain() {
  /* Guard: if already open, just focus it */
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  /* Start LAN server on MAIN role only (once) */
  if (global.LK_ROLE === 'main' && !httpServer) {
    try {
      httpServer = startServer({
        port: global.LK_PORT,
        htmlPath: path.join(__dirname, 'index.html'),
        dataDir: app.getPath('userData'),
        authToken: global.LK_TOKEN
      });
    } catch (e) {
      dialog.showErrorBox('Server failed', String(e));
      app.quit();
      return;
    }
    httpServer.on('error', (err) => {
      const msg = (err.code === 'EADDRINUSE')
        ? 'Port ' + global.LK_PORT + ' is already in use.\n\n' +
          'Another Lanka Shoe instance or app is using this port.\n' +
          'Close it and restart.'
        : err.message;
      dialog.showErrorBox('LAN Server error', msg);
      app.quit();
    });
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Lanka Shoe — Management System',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        '--lk-role=' + (global.LK_ROLE || 'main'),
        '--lk-server-ip=' + (global.LK_SERVER_IP || ''),
        '--lk-server-port=' + global.LK_PORT,
        '--lk-token=' + (global.LK_TOKEN || '')
      ]
    }
  });

  const url = global.LK_ROLE === 'client'
    ? `http://${global.LK_SERVER_IP}:${global.LK_PORT}/`
    : `http://127.0.0.1:${global.LK_PORT}/`;

  mainWindow.loadURL(url).catch(err => {
    dialog.showErrorBox(
      'Cannot reach Main PC',
      'Could not connect to ' + url + '\n\n' +
      'Make sure the Main PC is running Lanka Shoe and both PCs ' +
      'are on the same network.\n\n' + err.message
    );
    if (global.LK_ROLE === 'client') app.quit();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  buildMenu();
}

/* ───── Application menu ───── */
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Backup now',
          click: () => mainWindow && !mainWindow.isDestroyed()
            && mainWindow.webContents.send('menu-backup')
        },
        {
          label: 'Reconfigure (Main / Workstation)',
          click: () => {
            const cfg = configPath();
            if (fs.existsSync(cfg)) fs.unlinkSync(cfg);
            app.relaunch(); app.exit(0);
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About / Show my role',
          click: () => {
            const role = global.LK_ROLE === 'main'
              ? 'MAIN PC (server)'
              : 'WORKSTATION (client) → ' + global.LK_SERVER_IP;
            const tokenStatus = global.LK_TOKEN
              ? '✅ ENABLED (' + global.LK_TOKEN.slice(0, 8) + '…)'
              : '⚠ DISABLED (open LAN — anyone can access)';
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Lanka Shoe',
              message: 'Lanka Shoe v1.0.0',
              detail:
                'Role: ' + role +
                '\nPort: ' + global.LK_PORT +
                '\nLAN auth: ' + tokenStatus +
                '\nData folder: ' + app.getPath('userData')
            });
          }
        },
        {
          label: 'Copy LAN security setup guide',
          click: () => {
            clipboard.writeText(
              'Lanka Shoe — LAN Auth Token Setup\n' +
              '=================================\n\n' +
              'Why: without a .token file, anyone on your WiFi can\n' +
              'read/write your data. Enabling it locks the LAN to\n' +
              'PCs that know the shared secret.\n\n' +
              'How:\n' +
              '  1. On the MAIN PC open this folder:\n' +
              '     ' + app.getPath('userData') + '\n' +
              '  2. Create a plain text file named exactly:  .token\n' +
              '     (nothing before the dot, no .txt extension)\n' +
              '  3. Paste any long random string inside\n' +
              '     (e.g. 32+ characters). Example:\n' +
              '     a3f9c2e1b847d05f6821c4e7a9d3b6f08e5c1a9d\n' +
              '  4. On EACH CLIENT PC, do the same:\n' +
              '     - Open the same folder path on the client\n' +
              '     - Create .token with the SAME string\n' +
              '  5. Restart Lanka Shoe on all PCs.\n\n' +
              'Verify: Help → About should show "LAN auth: ✅ ENABLED".'
            );
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Guide copied to clipboard',
              message: 'Paste it into a note or send it to your other PCs.'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Show data folder',
          click: () => { shell.openPath(app.getPath('userData')); }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ───── App lifecycle ───── */
app.whenReady().then(() => {
  readCliMode();
  const cfg = loadConfig();

  /* Read token: CLI wins, else read .token file from userData */
  if (!global.LK_TOKEN) {
    global.LK_TOKEN = readToken();
  }

  if (global.LK_ROLE) {
    launchMain();
  } else if (cfg && cfg.role) {
    global.LK_ROLE      = cfg.role;
    global.LK_SERVER_IP = cfg.serverIp || '';
    global.LK_PORT      = cfg.port || DEFAULT_PORT;
    launchMain();
  } else {
    openSetupWindow();
  }
});

/* Second instance → focus existing window */
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (httpServer) try { httpServer.close(); httpServer = null; } catch (e) {}
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) launchMain();
});