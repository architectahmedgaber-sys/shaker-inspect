/* Shaker Inspect: "New update available" notice.
   Checks version.json (served next to the app) on launch, when the app comes back to the front, and every 30 min.
   Phone app (APK): the Update button opens the latest APK download. Web app / installed web app: it clears the
   cached files and reloads. version.js / version.json are written by the build workflow, never by hand. */
(function () {
  const CUR = window.SHK_VERSION || { version: '0', build: 0 };
  const NATIVE = !!(window.Capacitor && Capacitor.getPlatform && Capacitor.getPlatform() !== 'web');
  const APK = 'https://github.com/architectahmedgaber-sys/shaker-inspect/releases/latest/download/shaker-inspect.apk';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let latest = null, lastCheck = 0, dismissed = 0;
  try { dismissed = +sessionStorage.getItem('shkUpdDismissed') || 0; } catch (e) {}

  const css = document.createElement('style');
  css.textContent = `
  .upd-bar{position:fixed;left:10px;right:10px;top:calc(10px + env(safe-area-inset-top));z-index:9800;max-width:560px;margin:0 auto;background:#0b2a5b;color:#fff;border:2px solid #ffc61a;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.35);font:600 14px/1.35 system-ui,sans-serif;padding:12px 14px;animation:updIn .25s ease}
  @keyframes updIn{from{transform:translateY(-14px);opacity:0}}
  .upd-bar b{color:#ffc61a}.upd-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.upd-row>span{flex:1;min-width:150px}
  .upd-bar button{border:0;border-radius:10px;padding:9px 14px;font:700 13px system-ui,sans-serif;cursor:pointer}
  .upd-go{background:#ffc61a;color:#0b2a5b}.upd-ghost{background:rgba(255,255,255,.14);color:#fff}
  .upd-notes{margin:10px 0 0;padding:0 0 0 18px;font-weight:500;font-size:13px}.upd-hint{margin-top:8px;font-weight:500;font-size:12px;opacity:.85}
  .upd-ver{margin:10px 0 0;font:600 12px system-ui,sans-serif;opacity:.7;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap}
  .upd-ver button{background:none;border:1px solid currentColor;border-radius:8px;padding:3px 9px;font:inherit;color:inherit;cursor:pointer}`;
  document.head.appendChild(css);

  const isNewer = l => l && +l.build > +CUR.build;

  async function check(force) {
    const now = Date.now();
    if (!force && now - lastCheck < 10 * 60 * 1000) return null;
    lastCheck = now;
    try {
      const r = await fetch('version.json?t=' + now, { cache: 'no-store' });
      if (!r.ok) throw new Error('v' + r.status);
      latest = await r.json();
    } catch (e) { return null; }                      // offline or not published yet: stay quiet
    if (isNewer(latest) && (force || +latest.build !== dismissed)) show();
    else if (!isNewer(latest)) hide();
    return latest;
  }

  function hide() { const b = document.getElementById('updBar'); if (b) b.remove(); }

  function show() {
    hide();
    const notes = Array.isArray(latest.notes) ? latest.notes.filter(Boolean) : [];
    const b = document.createElement('div'); b.id = 'updBar'; b.className = 'upd-bar'; b.setAttribute('role', 'alert');
    b.innerHTML = `<div class="upd-row"><span><b>New update available</b><br>Version ${esc(latest.version)} is ready.</span>
        ${notes.length ? '<button type="button" class="upd-ghost" data-a="notes">What\'s new</button>' : ''}
        <button type="button" class="upd-ghost" data-a="later">Later</button>
        <button type="button" class="upd-go" data-a="go">Update</button></div>
      <ul class="upd-notes" hidden>${notes.map(n => '<li>' + esc(n) + '</li>').join('')}</ul>
      ${NATIVE ? '<div class="upd-hint">The new app downloads from the browser. When it finishes, tap it to install over this one. Your data stays.</div>' : ''}`;
    b.addEventListener('click', e => {
      const a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'notes') { const u = b.querySelector('.upd-notes'); u.hidden = !u.hidden; }
      else if (a === 'later') { dismissed = +latest.build; try { sessionStorage.setItem('shkUpdDismissed', String(dismissed)); } catch (x) {} hide(); }
      else if (a === 'go') update();
    });
    document.body.appendChild(b);
  }

  async function update() {
    if (NATIVE) { const u = (latest && latest.apk) || APK; const w = window.open(u, '_blank'); if (!w) location.href = u; return; }
    try {
      if ('serviceWorker' in navigator) { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); }
      if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
    } catch (e) {}
    location.replace(location.pathname + '?u=' + Date.now());
  }

  // version line + manual check inside the account sheet
  function accountLine() {
    const host = document.getElementById('acctInstall'); if (!host || document.getElementById('updVer')) return;
    const d = document.createElement('div'); d.id = 'updVer'; d.className = 'upd-ver';
    d.innerHTML = `<span>Version ${esc(CUR.version)}${CUR.build ? ' (build ' + esc(CUR.build) + ')' : ''}</span><button type="button">Check for updates</button><span id="updMsg"></span>`;
    d.querySelector('button').onclick = async () => {
      const m = d.querySelector('#updMsg'); m.textContent = 'Checking…';
      const l = await check(true);
      m.textContent = !l ? 'No connection' : isNewer(l) ? 'Update available' : 'You are up to date';
      if (isNewer(l)) { const o = document.getElementById('acctOverlay'); o && o.classList.remove('open'); }
    };
    host.parentNode.insertBefore(d, host);
  }

  window.ShkUpdate = { check: check, update: update, current: CUR };
  setTimeout(() => { check(true); accountLine(); }, 3000);                 // on launch
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(false); });   // on resume
  setInterval(() => check(false), 30 * 60 * 1000);
})();
