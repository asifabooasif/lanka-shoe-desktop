'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

function startServer(opts) {
  const port      = opts.port || 3001;
  const dataDir   = opts.dataDir;
  const htmlPath  = opts.htmlPath;
  const dataFile  = path.join(dataDir, 'lankashoe_db.json');
  let   authToken = opts.authToken || '';

  /* Fallback: read .token file directly if caller didn't pass it */
  if (!authToken) {
    try {
      const tokenFile = path.join(dataDir, '.token');
      if (fs.existsSync(tokenFile)) {
        authToken = fs.readFileSync(tokenFile, 'utf8').trim();
      }
    } catch (e) {}
  }

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const app = express();

  app.use(express.json({ limit: '100mb' }));
  app.use(express.text({ limit: '100mb', type: ['text/plain'] }));

  /* CORS — allow the LAN token header */
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers',
      'Content-Type, X-LankaShoe-Token');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  /* Optional LAN auth gate.
     Only enforced when authToken is non-empty.
     If no .token file, LAN is open (backward-compatible). */
  app.use('/api', (req, res, next) => {
    if (req.path === '/ping') return next();       // health check is public
    if (!authToken) return next();                 // no token = open LAN
    const provided = req.header('X-LankaShoe-Token') || '';
    if (provided === authToken) return next();
    return res.status(401).json({
      error: 'Unauthorized — invalid or missing token'
    });
  });

  /* ───────────────────────────────────────────────────────────────
     PAGE ROUTES
     NOTE: the previous version used express.static() over the whole
     app folder — that allowed anyone on the LAN to download
     main.js / server.js / package.json / preload.js by URL.
     Now we serve ONLY the two pages the app actually needs, and
     the "dotfiles: deny" is not relevant anymore because nothing
     else is exposed at all.
  ─────────────────────────────────────────────────────────────── */
  const indexPath  = htmlPath;
  const setupPath  = path.join(path.dirname(htmlPath), 'setup.html');

  app.get('/', (req, res) => {
    if (!fs.existsSync(indexPath)) {
      return res.status(500).send('index.html not found');
    }
    res.sendFile(indexPath);
  });

  app.get('/setup.html', (req, res) => {
    if (!fs.existsSync(setupPath)) return res.status(404).send('Not found');
    res.sendFile(setupPath);
  });

  /* Health check — reports whether auth is required */
  app.get('/api/ping', (req, res) => {
    res.json({
      ok: true,
      host: os.hostname(),
      time: new Date().toISOString(),
      authRequired: !!authToken
    });
  });

  /* Load shared DB */
  app.get('/api/load', (req, res) => {
    try {
      if (!fs.existsSync(dataFile)) return res.type('json').send('{}');
      res.type('json').send(fs.readFileSync(dataFile, 'utf8'));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* Save shared DB (atomic write) */
  app.post('/api/save', (req, res) => {
    try {
      const body = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
      if (!body || body.length < 2) {
        return res.status(400).json({ error: 'Empty payload' });
      }
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, dataFile);
      res.json({ ok: true, size: body.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* Manual backup */
  app.get('/api/backup', (req, res) => {
    try {
      if (!fs.existsSync(dataFile)) return res.json({ ok: false });
      const stamp = new Date().toISOString()
        .replace(/[:.]/g, '-').slice(0, 19);
      const backupFile = path.join(dataDir,
        `lankashoe_backup_${stamp}.json`);
      fs.copyFileSync(dataFile, backupFile);
      res.json({ ok: true, file: backupFile });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const server = app.listen(port, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    const ips = [];
    Object.keys(nets).forEach(n => {
      (nets[n] || []).forEach(net => {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      });
    });
    console.log(`[LAN] Server running on port ${port}`);
    console.log(`[LAN] Main PC IP addresses: ${ips.join(', ') || 'none'}`);
    console.log(`[LAN] Data file: ${dataFile}`);
    console.log(`[LAN] Auth: ${authToken
      ? 'ENABLED (.token file found)'
      : 'DISABLED — LAN is open to anyone on this network'}`);
  });

  server.on('error', (err) => {
    console.error('[LAN] Server error:', err.message);
  });

  return server;
}

module.exports = { startServer };