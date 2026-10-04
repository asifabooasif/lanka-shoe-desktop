const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

/* ─── Config (per-PC role: 'main' or 'client') ─────────────────────── */
const CONFIG_DIR = path.join(app.getPath('userData'));
const CONFIG_FILE = path.join(CONFIG_DIR, 'lankashoe-config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return { role: null, serverIp: null }; }
}
function writeConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/* ─── Server data file (only used when role = main) ────────────────── */
const DATA_FILE = path.join(CONFIG_DIR, 'lankashoe-data.json');
const BACKUP_DIR = path.join(CONFIG_DIR, 'backups');
const SERVER_PORT = 9876;

function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

/* ─── HTTP server (runs only on the "main" PC) ─────────────────────── */
function startServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, host: os.hostname() }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/load') {
      try {
        const data = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : '{}';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/save') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          JSON.parse(body); // validate
          fs.mkdirSync(BACKUP_DIR, { recursive: true });
          if (fs.existsSync(DATA_FILE)) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `data_${stamp}.json`));
            // Keep only last 30 backups
            const files = fs.readdirSync(BACKUP_DIR).sort();
            while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
          }
          fs.writeFileSync(DATA_FILE, body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400); res.end(String(e));
        }
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  server.listen(SERVER_PORT, '0.0.0.0', () => {
    console.log(`[MAIN] Server running on ${lanIP()}:${SERVER_PORT}`);
  });
  server.on('error', err => console.error('[MAIN] Server error:', err));
}

/* ─── First-run role picker ─────────────────────────────────────────── */
async function askRole() {
  return new Promise(resolve => {
    const win = new BrowserWindow({
      width: 520, height: 380, resizable: false, minimizable: false,
      title: 'Lanka Shoe — Setup',
      autoHideMenuBar: true, backgroundColor: '#fafaff',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    Menu.setApplicationMenu(null);

    const html = `
      <html><body style="font-family:Inter,system-ui,sans-serif;padding:28px;
        background:linear-gradient(135deg,#150b30,#3b1d7a);color:#fff;margin:0">
        <h2 style="margin:0 0 6px;font-size:20px">Lanka Shoe — This PC's Role</h2>
        <p style="font-size:13px;opacity:.85;margin:0 0 22px">
          Choose how this PC will work on your shop network.</p>

        <button id="mainBtn" style="display:block;width:100%;text-align:left;
          padding:16px 18px;margin-bottom:12px;border:1px solid rgba(255,255,255,.2);
          background:rgba(124,58,237,.25);color:#fff;border-radius:12px;
          cursor:pointer;font-family:inherit;font-size:14px">
          <strong>🖥️ MAIN PC (Server)</strong><br>
          <span style="font-size:12px;opacity:.8">This PC holds the data.
          Other PCs will connect to it.</span></button>

        <button id="clientBtn" style="display:block;width:100%;text-align:left;
          padding:16px 18px;margin-bottom:12px;border:1px solid rgba(255,255,255,.2);
          background:rgba(255,255,255,.08);color:#fff;border-radius:12px;
          cursor:pointer;font-family:inherit;font-size:14px">
          <strong>💻 WORKSTATION (Client)</strong><br>
          <span style="font-size:12px;opacity:.8">This PC connects to the MAIN
          PC over the network.</span></button>

        <div id="ipBox" style="display:none;margin-top:16px">
          <label style="font-size:12px;opacity:.85">Main PC's IP address:</label>
          <input id="ipInput" placeholder="192.168.1.10" style="width:100%;
            padding:11px 14px;margin-top:6px;border-radius:10px;border:none;
            font-family:inherit;font-size:14px">
          <button id="saveIpBtn" style="margin-top:12px;width:100%;padding:11px;
            background:#10b981;color:#fff;border:none;border-radius:10px;
            cursor:pointer;font-family:inherit;font-weight:600">
            Save & Continue</button>
        </div>
      </body></html>`;

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    win.webContents.once('did-finish-load', () => {
      win.webContents.executeJavaScript(`
        document.getElementById('mainBtn').onclick = () => {
          require('electron').ipcRenderer.send('set-role', { role: 'main' });
        };
        document.getElementById('clientBtn').onclick = () => {
          document.getElementById('ipBox').style.display = 'block';
        };
        document.getElementById('saveIpBtn').onclick = () => {
          const ip = document.getElementById('ipInput').value.trim();
          if (!ip) return alert('Please enter the Main PC IP address');
          require('electron').ipcRenderer.send('set-role',
            { role: 'client', serverIp: ip });
        };
      `);
    });

    ipcMain.once('set-role', (e, cfg) => { win.close(); resolve(cfg); });
  });
}

/* ─── Quick "is the server alive?" probe ───────────────────────────── */
function probeServer(ip, timeoutMs = 1500) {
  return new Promise(resolve => {
    const req = http.get(`http://${ip}:${SERVER_PORT}/api/health`,
      { timeout: timeoutMs }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/* ─── Load the actual app ───────────────────────────────────────────── */
let mainWindow = null;

function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'Lanka Shoe Enterprise',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#fafaff', show: false, autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      spellcheck: false, devTools: false, webSecurity: true,
      preload: path.join(__dirname, 'preload.js')   // we add this below
    }
  });

  mainWindow.loadFile('index.html', {
    query: {
      role: config.role,
      serverIp: config.serverIp || '',
      serverPort: String(SERVER_PORT)
    }
  });

  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.maximize(); });
  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ─── Boot ───────────────────────────────────────────────────────────── */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    let config = readConfig();

    // First run — ask role
    if (!config.role) {
      config = await askRole();
      writeConfig(config);
    }

    // If role is main → start the server
    if (config.role === 'main') {
      startServer();
    }

    // If role is client → verify server is reachable
    if (config.role === 'client') {
      const ok = await probeServer(config.serverIp);
      if (!ok) {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Cannot reach Main PC',
          message: `Cannot connect to Main PC at ${config.serverIp}:${SERVER_PORT}.\n\n` +
                   `Make sure the Main PC is turned on and running Lanka Shoe, ` +
                   `and both PCs are on the same WiFi network.`,
          buttons: ['Retry', 'Change IP', 'Quit'],
          defaultId: 0
        });
        if (choice === 1) {
          const newCfg = await askRole();
          writeConfig(newCfg);
          config = newCfg;
          if (config.role === 'main') startServer();
        } else if (choice === 2) {
          app.quit(); return;
        }
      }
    }

    createWindow(config);
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(readConfig()); });
