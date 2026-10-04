'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   LAN MODE PATCH — Loaded last. Replaces Firebase with LAN server.
   This file runs AFTER all 18 parts of the app. It overrides:
   - pushToFirestore → POST to /api/save
   - loadFromFirestore → GET from /api/load
   - Auth → fake admin user
   - Login screen → LAN entry button
   - Realtime sync → WebSocket
═══════════════════════════════════════════════════════════════════════ */
(function lanModePatchV1() {
  if (window._lanModePatchV1) return;
  window._lanModePatchV1 = true;

  const SERVER = location.origin;
  const IS_ELECTRON = !!(window.electronAPI && window.electronAPI.isElectron);

  /* ── Ensure Firebase stubs are in place (in case HTML stub didn't load) ── */
  if (!window.firebase) {
    window.firebase = {
      apps: [],
      app: () => ({}),
      initializeApp: () => ({}),
      auth: () => ({ onAuthStateChanged: () => {}, signOut: async () => {}, currentUser: null }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }),
        enablePersistence: () => Promise.reject(new Error('offline'))
      }),
      storage: () => ({ ref: () => ({ put: async () => ({}), getDownloadURL: async () => '' }) })
    };
  }

  /* ── Set globals ── */
  window.firebaseReady = true;
  window.offlineMode = false;
  window.auth = window.firebase.auth ? window.firebase.auth() : { onAuthStateChanged: () => {} };
  window.firestore = window.firebase.firestore ? window.firebase.firestore() : {};

  /* ── Auto-signed-in user ── */
  window.currentUser = {
    uid: 'lan-' + (IS_ELECTRON ? 'server' : 'client'),
    email: IS_ELECTRON ? 'server@lankashoe.local' : 'client@lankashoe.local',
    name: IS_ELECTRON ? 'Server PC' : 'Client PC',
    photo: null
  };
  window.currentUserRole = 'admin';
  window.currentUserPerms = { role: 'admin' };

  /* ── Replace pushToFirestore → LAN server ── */
  window.pushToFirestore = async function () {
    try {
      const r = await fetch(SERVER + '/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: window.db })
      });
      const j = await r.json();
      if (j.ok) {
        try { localStorage.setItem('lankashoe_cache', JSON.stringify(window.db)); } catch (e) {}
        if (typeof updateSyncStatus === 'function') {
          updateSyncStatus('Saved ' + new Date().toLocaleTimeString('en-GB',
            { hour: '2-digit', minute: '2-digit' }));
        }
      }
      return j.ok;
    } catch (e) {
      console.error('LAN save failed:', e);
      if (typeof updateSyncStatus === 'function') updateSyncStatus('⚠ Server offline');
      if (typeof toast === 'function') toast('Server offline — saved locally', 'warn');
      return false;
    }
  };

  /* ── Replace loadFromFirestore → LAN server ── */
  window.loadFromFirestore = async function () {
    try {
      const r = await fetch(SERVER + '/api/load');
      const j = await r.json();
      if (j.ok && j.data && !j.data._empty) {
        window.db = j.data;
        if (typeof takeSnapshot === 'function') takeSnapshot();
        return true;
      }
    } catch (e) {
      console.error('LAN load failed:', e);
    }
    return false;
  };

  /* ── Stub out unused cloud functions ── */
  window.registerUserLogin = async () => {};
  window.checkAccess = async () => 'admin';
  window.loadAccessList = async () => ['lan@local'];
  window.logLogin = () => {};
  window.checkNewDeviceLogin = () => null;
  window.sendMagicLink = async () => {};

  /* ── Replace login screen ── */
  function replaceLoginScreen() {
    const overlay = document.getElementById('loginOverlay');
    if (!overlay) return;
    const card = overlay.querySelector('.login-card');
    if (!card) return;

    card.innerHTML =
      '<div class="login-logo" style="background:linear-gradient(135deg,#10b981,#059669)">LS</div>' +
      '<h1>Lanka Shoe Enterprise</h1>' +
      '<div class="tagline">LAN Multi-User Mode</div>' +
      '<div style="text-align:center;padding:20px;background:#f0fdf4;border-radius:12px;margin-bottom:18px">' +
        '<div style="font-size:44px;margin-bottom:8px">✅</div>' +
        '<div style="font-weight:700;font-size:15px;color:#065f46;margin-bottom:8px">' +
          (IS_ELECTRON ? 'This is the SERVER PC' : 'Connected to Server') +
        '</div>' +
        '<div style="font-size:11.5px;color:#065f46;line-height:1.6">' +
          (IS_ELECTRON
            ? 'Data is stored locally.<br>Client PCs connect via your LAN.'
            : 'Server: <strong>' + SERVER + '</strong>') +
        '</div>' +
      '</div>' +
      '<button id="lanEnterBtn" class="google-btn" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:0">' +
        '<span>🚀 Enter Application</span>' +
      '</button>' +
      '<div class="login-note" style="margin-top:20px">' +
        (IS_ELECTRON
          ? 'Server PC — Data file: <code>C:\\LankaShoe\\data.json</code>'
          : 'You are connected to the server over the network.') +
      '</div>';

    setTimeout(() => {
      const btn = document.getElementById('lanEnterBtn');
      if (btn) {
        btn.onclick = async () => {
          try {
            const health = await fetch(SERVER + '/api/health').then(r => r.json());
            if (health.pinRequired) {
              const pin = prompt('Enter server PIN:');
              if (pin === null) return;
              const authRes = await fetch(SERVER + '/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
              });
              const authJson = await authRes.json();
              if (!authJson.ok) { alert('Invalid PIN'); return; }
            }
          } catch (e) {}

          if (typeof showApp === 'function') showApp();
          if (typeof loadLocalCache === 'function') await loadLocalCache();
          await window.loadFromFirestore();
          if (typeof normalizeDb === 'function') normalizeDb();
          if (typeof applySettings === 'function') applySettings();
          if (typeof render === 'function') render();
        };
      }
    }, 50);
  }

  /* ── Live sync via WebSocket ── */
  function connectLiveSync() {
    const wsURL = SERVER.replace(/^http/, 'ws');
    let ws = null;
    let reconnectTimer = null;

    function connect() {
      try { ws = new WebSocket(wsURL); }
      catch (e) { return; }

      ws.onopen = () => {
        if (window.__dbgOk) window.__dbgOk('Live sync connected', 'LAN');
        if (typeof updateSyncStatus === 'function') updateSyncStatus('🟢 Live');
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'db-updated') {
            const mySave = window._lastLocalSave || 0;
            if (Date.now() - mySave < 1500) return;
            if (window._pendingLocalEdits && window._pendingLocalEdits.size > 0) return;
            await window.loadFromFirestore();
            if (typeof normalizeDb === 'function') normalizeDb();
            if (typeof render === 'function') render();
            if (window.__dbgOk) window.__dbgOk('Synced from server', 'LAN');
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        if (typeof updateSyncStatus === 'function') updateSyncStatus('🔴 Reconnecting…');
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {};
    }
    connect();
  }

  /* ── Mark local saves to avoid echo ── */
  const origSave = window.save;
  if (typeof origSave === 'function') {
    window.save = function () {
      window._lastLocalSave = Date.now();
      return origSave.apply(this, arguments);
    };
  }

  /* ── Init ── */
  function init() {
    setTimeout(replaceLoginScreen, 400);
    setTimeout(connectLiveSync, 600);
    setTimeout(() => {
      const el = document.getElementById('syncStatus');
      if (el) el.textContent = '🟢 LAN Mode';
    }, 800);

    console.log('%c✅ LAN MODE ACTIVE',
      'color:#10b981;font-weight:bold;font-size:13px');
    console.log('%c   Server: ' + SERVER, 'color:#3b82f6;font-size:12px');
    console.log('%c   Role: ' + (IS_ELECTRON ? 'SERVER' : 'CLIENT'),
      'color:#3b82f6;font-size:12px');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ═══════════════════════════════════════════════════════════════════════
   FIX PATCH v1 — Data persistence bug fix
   Root cause: setting window.db alone doesn't update the app's `db`
   variable, so saving sent stale data to the server.
   Fix: also reassign `db` at script scope + load from server FIRST.
═══════════════════════════════════════════════════════════════════════ */
(function lanModeFixV1() {
  if (window._lanModeFixV1) return;
  window._lanModeFixV1 = true;

  const SERVER = location.origin;

  /* ── Override loadFromFirestore — properly reassign `db` ── */
  window.loadFromFirestore = async function () {
    try {
      const r = await fetch(SERVER + '/api/load');
      const j = await r.json();
      if (j.ok && j.data && !j.data._empty) {
        /* CRITICAL FIX: reassign `db` at script scope (not just window.db) */
        try {
          // eslint-disable-next-line no-global-assign
          db = j.data;
        } catch (e) {
          /* fallback — mutate in place */
          const target = window.db;
          if (target && typeof target === 'object') {
            Object.keys(target).forEach(k => { delete target[k]; });
            Object.keys(j.data).forEach(k => { target[k] = j.data[k]; });
          }
        }
        window.db = j.data;
        if (typeof takeSnapshot === 'function') takeSnapshot();
        console.log('[LAN FIX] Loaded from server:',
          Object.keys(j.data).length, 'collections',
          '| customers:', (j.data.customers || []).length);
        return true;
      }
      console.log('[LAN FIX] Server has no data yet');
    } catch (e) {
      console.error('[LAN FIX] Load failed:', e);
    }
    return false;
  };

  /* ── Override pushToFirestore — log failures visibly ── */
  window.pushToFirestore = async function () {
    try {
      const r = await fetch(SERVER + '/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: window.db })
      });
      const j = await r.json();
      if (j.ok) {
        try {
          localStorage.setItem('lankashoe_cache', JSON.stringify(window.db));
        } catch (e) {}
        if (typeof updateSyncStatus === 'function') {
          updateSyncStatus('Saved ' + new Date().toLocaleTimeString('en-GB',
            { hour: '2-digit', minute: '2-digit' }));
        }
        console.log('[LAN FIX] ✓ Saved to server (' +
          JSON.stringify(window.db).length + ' bytes)');
      } else {
        console.error('[LAN FIX] Save rejected:', j.error);
        if (typeof toast === 'function') toast('Save failed: ' + j.error, 'error');
        if (typeof updateSyncStatus === 'function') updateSyncStatus('⚠ Save failed');
      }
      return j.ok;
    } catch (e) {
      console.error('[LAN FIX] Save network error:', e);
      if (typeof updateSyncStatus === 'function') updateSyncStatus('⚠ Server offline');
      if (typeof toast === 'function') toast('Server offline — saved locally', 'warn');
      return false;
    }
  };

  /* ── Rebind login button — load from SERVER FIRST ── */
  function rebindLoginButton() {
    const btn = document.getElementById('lanEnterBtn');
    if (!btn) {
      setTimeout(rebindLoginButton, 500);
      return;
    }

    btn.onclick = async () => {
      /* PIN check */
      try {
        const health = await fetch(SERVER + '/api/health').then(r => r.json());
        if (health.pinRequired) {
          const pin = prompt('Enter server PIN:');
          if (pin === null) return;
          const authRes = await fetch(SERVER + '/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
          });
          const authJson = await authRes.json();
          if (!authJson.ok) { alert('Invalid PIN'); return; }
        }
      } catch (e) {}

      if (typeof showApp === 'function') showApp();

      /* 1. Try to load from server FIRST (source of truth) */
      const ok = await window.loadFromFirestore();

      /* 2. If server has no data, fall back to local cache */
      if (!ok) {
        console.log('[LAN FIX] Server empty — using local cache');
        if (typeof loadLocalCache === 'function') await loadLocalCache();
      }

      if (typeof normalizeDb === 'function') normalizeDb();
      if (typeof applySettings === 'function') applySettings();
      if (typeof render === 'function') render();
    };

    console.log('[LAN FIX v1] Login button rebound');
  }

  /* Try to rebind immediately, then retry */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(rebindLoginButton, 800));
  } else {
    setTimeout(rebindLoginButton, 800);
  }

  console.log('%c✅ LAN FIX v1 loaded — data persistence patched',
    'color:#10b981;font-weight:bold;font-size:13px');
})();
