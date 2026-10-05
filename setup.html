<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lanka Shoe — Setup</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👟</text></svg>">
<style>
  :root{--accent:#7c3aed;--bg:#fafaff;--surface:#fff;--text:#1a1533;--text-3:#78718f;--border:#eee9f8;--red:#ef4444}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#150b30,#3b1d7a);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:var(--text)}
  .card{background:var(--surface);border-radius:18px;padding:36px 32px;max-width:560px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,.4)}
  .logo{font-size:44px;text-align:center;margin-bottom:8px}
  h1{font-size:20px;text-align:center;margin-bottom:6px}
  .sub{text-align:center;font-size:13px;color:var(--text-3);margin-bottom:26px}
  .choice{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}
  .choice button{padding:22px 18px;border:2px solid var(--border);background:#fff;border-radius:14px;cursor:pointer;text-align:left;font-family:inherit;transition:all .15s}
  .choice button:hover{border-color:var(--accent);transform:translateY(-2px)}
  .choice button.active{border-color:var(--accent);background:#f5f0ff}
  .choice .ttl{font-weight:700;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:8px}
  .choice .dsc{font-size:12px;color:var(--text-3);line-height:1.55}
  .ipwrap{display:none;margin-bottom:16px}
  .ipwrap.show{display:block}
  label{display:block;font-size:11.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px}
  input{width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;outline:none}
  input:focus{border-color:var(--accent);box-shadow:0 0 0 4px #f5f0ff}
  .err{color:var(--red);font-size:12px;margin-top:6px;display:none}
  .err.show{display:block}
  .go{width:100%;padding:14px;background:linear-gradient(135deg,#7c3aed,#9333ea);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px;opacity:.5;pointer-events:none}
  .go.ready{opacity:1;pointer-events:auto}
  .hint{font-size:11.5px;color:var(--text-3);text-align:center;margin-top:14px;line-height:1.5}
</style>
</head>
<body>
<div class="card">
  <div class="logo">👟</div>
  <h1>Welcome to Lanka Shoe</h1>
  <div class="sub">How will this PC be used?</div>

  <div class="choice">
    <button data-role="main" onclick="pick('main')">
      <div class="ttl">🖥️ MAIN PC</div>
      <div class="dsc">Stores all data. Other PCs connect to this one.<br><br><strong>Choose this for the shop counter PC.</strong></div>
    </button>
    <button data-role="client" onclick="pick('client')">
      <div class="ttl">💻 WORKSTATION</div>
      <div class="dsc">Connects to the MAIN PC over your shop network (Wi-Fi or LAN cable).<br><br><strong>Choose for additional PCs.</strong></div>
    </button>
  </div>

  <div class="ipwrap" id="ipwrap">
    <label>MAIN PC IP Address</label>
    <input id="ip" placeholder="e.g. 192.168.1.10" autocomplete="off">
    <div class="err" id="err">Enter a valid IPv4 address (e.g. 192.168.1.10)</div>
    <div class="hint">On the MAIN PC, open the Help menu → About to see its IP.</div>
  </div>

  <button class="go" id="go" onclick="finish()">Continue →</button>
  <div class="hint">You can change this later from the <strong>File → Reconfigure</strong> menu.</div>
</div>

<script>
  let role = null;
  function pick(r) {
    role = r;
    document.querySelectorAll('.choice button').forEach(b =>
      b.classList.toggle('active', b.dataset.role === r));
    document.getElementById('ipwrap').classList.toggle('show', r === 'client');
    document.getElementById('go').classList.toggle('ready', r === 'main');
    if (r === 'client') setTimeout(() => document.getElementById('ip').focus(), 80);
  }
  function validIp(s) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) &&
      s.split('.').every(n => +n >= 0 && +n <= 255);
  }
  document.getElementById('ip').addEventListener('input', e => {
    const ok = validIp(e.target.value.trim());
    document.getElementById('err').classList.toggle('show', e.target.value && !ok);
    document.getElementById('go').classList.toggle('ready', ok);
  });
  function finish() {
    if (role === 'main') return window.LK_SETUP.complete({ role: 'main' });
    if (role === 'client') {
      const ip = document.getElementById('ip').value.trim();
      if (!validIp(ip)) return;
      return window.LK_SETUP.complete({ role: 'client', serverIp: ip });
    }
  }
</script>
</body>
</html>