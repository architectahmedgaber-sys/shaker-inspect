/* Shaker Inspect: the app keeps itself up to date.
   - While the app is on screen it asks the server "did anything change?" (app_ping, a tiny answer) every ~25 seconds.
     Only when the sheet or the Drive files changed does it load the list again, so a quiet minute costs almost nothing.
   - It also checks the moment the app comes back (switch to the app, screen on, signal back) and after your own close.
   - A Refresh button (Home, top right) reads the latest from the sheet and Drive on demand.
   - An open request, sign-in or editor is never redrawn under your hands: the update waits until it is closed.
   Loaded last. Needs Live.gs + the new Api.gs on the server; with an older server only the Refresh button and "on return" refresh work. */
(function () {
  const STEP = 25000, SLOW = 90000, IDLE_MS = 5 * 60000;
  const $ = id => document.getElementById(id);
  let last = null;                  // the answer we last applied: { s, d }
  let timer = null, pinging = false, refreshing = false, noPing = false, appliedAt = 0, lastTouch = Date.now(), hiddenAt = 0;

  const ready = () => { try { return !!(window.PtahApp && PtahApp.role && PtahApp.role()); } catch (e) { return false; } };
  const visible = () => document.visibilityState !== 'hidden';
  const busyUI = () => !!document.querySelector('.modal-overlay.active, .login-overlay.open, .acct-overlay.open, #edOverlay.open');
  const toast = m => { try { if (typeof showToast === 'function') showToast(m, null, null, 2600); } catch (e) {} };
  const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // ---------- the "Updated 10:32" line next to the Refresh button ----------
  function stamp() {
    const txt = appliedAt ? 'Updated ' + hhmm(appliedAt) : '';
    document.querySelectorAll('[data-live-ts]').forEach(el => { el.textContent = txt; });
  }

  // ---------- load everything again (list, comments/re-inspection numbers, IR file names) ----------
  async function reload() {
    if (refreshing) return;
    refreshing = true;
    const before = (typeof allItems !== 'undefined' && allItems) ? allItems.length : 0;
    try {
      if (window.Shk && Shk.rf && Shk.rf.items) await Shk.rf.items();
      try { if (window.Shk && Shk.dxBoot) Shk.dxBoot(); } catch (e) {}
      try { if (window.Shk && Shk.ir && Shk.ir.loadIndex) Shk.ir.loadIndex(true).catch(() => {}); } catch (e) {}
      try { if (window.Shk && Shk.dxRe && Shk.dxScreen && ['cal', 'rep', 'pending', 're', 'board', 'villa', 'req'].indexOf(Shk.dxScreen) >= 0) Shk.dxRe(); } catch (e) {}
    } finally { refreshing = false; }
    appliedAt = Date.now(); stamp(); setTimeout(stamp, 300);
    const after = (typeof allItems !== 'undefined' && allItems) ? allItems.length : 0;
    return after - before;
  }

  // ---------- ask the server whether anything changed ----------
  async function ping(force) {
    if (pinging || !ready() || navigator.onLine === false) return null;
    pinging = true;
    try { return await PtahApp.callRaw('app_ping', [!!force]); }
    catch (e) { if (/Unknown function/i.test(e.message || '')) noPing = true; return null; }
    finally { pinging = false; }
  }
  async function check() {
    if (noPing || !visible() || !ready()) return;
    const o = await ping(false); if (!o) return;
    if (!last) { last = { s: o.s, d: o.d }; return; }            // first answer = the state the app already shows
    if (o.s === last.s && o.d === last.d) return;
    if (busyUI() || refreshing) return;                            // something is open: try again at the next check (token not saved yet)
    last = { s: o.s, d: o.d };
    const n = await reload();
    if (n > 0) toast(n === 1 ? '1 new request' : n + ' new requests');
  }

  // ---------- the Refresh button: always reads the latest from the sheet and Drive ----------
  async function manual(btn) {
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('rf-spin');
    let msg = '';
    try {
      const o = await ping(true);                                  // skips the short server cache
      if (o) last = { s: o.s, d: o.d };
      const n = await reload();
      msg = n > 0 ? (n === 1 ? '1 new request' : n + ' new requests') : 'Up to date · ' + hhmm(Date.now());
    } catch (e) { msg = 'Could not refresh. Check the connection.'; }
    btn.disabled = false; btn.classList.remove('rf-spin');
    toast(msg);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-live-rf]'); if (!b) return;
    e.preventDefault(); manual(b);
  });

  // ---------- when to check ----------
  function schedule() {
    clearTimeout(timer);
    const idle = Date.now() - lastTouch > IDLE_MS;
    timer = setTimeout(async () => { await check(); schedule(); }, (idle ? SLOW : STEP) + Math.random() * 3000);
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));
  function resumed() {
    if (!visible()) { hiddenAt = Date.now(); clearTimeout(timer); return; }
    lastTouch = Date.now();
    if (noPing) { if (Date.now() - hiddenAt > 60000 && ready() && !busyUI()) reload(); }   // old server: refresh on return after a minute away
    else check();
    schedule();
  }
  document.addEventListener('visibilitychange', resumed);
  addEventListener('focus', () => { if (visible()) check(); });
  addEventListener('online', () => { if (visible()) check(); });
  addEventListener('pageshow', e => { if (e.persisted) resumed(); });

  // after you close a request: the server data changed because of you; take the new state without refreshing twice
  document.addEventListener('shk-closed', () => { setTimeout(async () => { const o = await ping(false); if (o) last = { s: o.s, d: o.d }; }, 4000); });

  // the list was painted (any reason): remember when
  const baseGrid = window.renderGrid;
  window.renderGrid = function () {
    const r = baseGrid.apply(this, arguments);
    if (!window.SHK_OFFLINE_SINCE) { appliedAt = Date.now(); setTimeout(stamp, 60); }
    return r;
  };
  setInterval(stamp, 30000);

  // start once the person is signed in (the app waits for the sign-in first)
  (function wait(n) {
    if (ready()) { check(); schedule(); return; }
    if (n < 600) setTimeout(() => wait(n + 1), 1000);
  })(0);

  (window.Shk = window.Shk || {}).live = { check, reload, ping };
})();
