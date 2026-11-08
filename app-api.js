/* Shaker Inspect app: sign-in, sign-up, roles and calls to the Apps Script API.
   The portal page still calls google.script.run.withSuccessHandler(..).fn(args);
   here that becomes a POST to Api.gs doPost with the session key. */
(function () {
  const KEY = 'shkSession';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} }
  };
  let session = store.get();          // { token, email, engineer, role, status }
  let waiting = [];                   // calls made before the account is approved, sent after it
  const STANDALONE = !!window.SHK_STANDALONE;     // other pages of the app (e.g. Handover) have no sign-in screen
  const PREFIX = window.SHK_PREFIX || '';

  function apiUrl() { return (window.SHK_CONFIG || {}).API_URL || ''; }

  async function post(fn, args, token) {
    const url = apiUrl();
    if (!/^https:\/\//.test(url)) throw new Error('The app is not connected yet: put the Web app URL in config.js.');
    let r;
    try {
      // text/plain keeps it a "simple" request, so Apps Script answers without a CORS preflight
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                             body: JSON.stringify({ fn: fn, args: args || [], token: token || '' }), redirect: 'follow' });
    } catch (e) {
      throw new Error(navigator.onLine === false ? 'No internet connection.' : 'Could not reach the server. Check the connection and try again.');
    }
    let o;
    try { o = await r.json(); } catch (e) { throw new Error('The server answered in a wrong format (' + r.status + '). Check the deployment access is "Anyone".'); }
    return o;
  }

  function call(fn, args) {
    return new Promise((resolve, reject) => {
      const job = { fn: PREFIX + fn, args, resolve, reject };
      if (!session) { waiting.push(job); if (STANDALONE) location.replace('./'); else showLogin(); return; }
      if (session.status !== 'approved') { waiting.push(job); showStatus(); return; }
      send(job);
    });
  }
  async function send(job) {
    try {
      const o = await post(job.fn, job.args, session && session.token);
      if (o.ok) return job.resolve(o.result);
      if (o.auth) { session = null; store.set(null); waiting.push(job); STANDALONE ? location.replace('./') : showLogin(o.error); return; }
      if (o.state) { session.status = o.state; store.set(session); waiting.push(job); showStatus(); return; }
      job.reject(new Error(o.error || 'Unknown error'));
    } catch (e) { job.reject(e); }
  }
  function flush() { const w = waiting; waiting = []; w.forEach(send); }

  // google.script.run replacement
  function runner() {
    let ok = () => {}, bad = e => console.warn(e);
    const o = new Proxy({}, { get: (t, k) => {
      if (k === 'withSuccessHandler') return f => { ok = f; return o; };
      if (k === 'withFailureHandler') return f => { bad = f; return o; };
      if (k === 'withUserObject') return () => o;
      return (...a) => { call(k, a).then(r => ok(r), e => bad(e)); };
    } });
    return o;
  }
  window.google = window.google || {};
  window.google.script = { get run() { return runner(); } };

  // ---------- role helpers ----------
  const role = () => (session && session.status === 'approved' && session.role) || '';
  function applyRole() {
    const r = role();
    document.body.classList.toggle('role-admin', r === 'Admin');
    document.body.classList.toggle('role-engineer', r === 'Engineer');
    document.body.classList.toggle('role-viewer', r === 'Viewer');
    window.SHK_ROLE = r;
    // the checklist editor asks for a PIN; the server uses its own for admins, so the app skips the question
    try { r === 'Admin' ? sessionStorage.setItem('ptahEdPin', 'admin') : sessionStorage.removeItem('ptahEdPin'); } catch (e) {}
  }

  // ---------- sign-in screen ----------
  const $ = id => document.getElementById(id);
  let loginEmail = '';
  const STEPS = ['loginEmailStep', 'loginCodeStep', 'loginSignupStep', 'loginPendingStep'];
  function showLogin(msg) {
    const go = () => {
      const ov = $('loginOverlay'); if (!ov) return;
      ov.classList.add('open'); document.body.classList.add('locked');
      setStep(loginEmail ? 'loginCodeStep' : 'loginEmailStep');
      if (msg) note(msg, true);
      if (window.Shk && Shk.hideSplash) Shk.hideSplash();
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : go();
  }
  // signed in but not approved yet: sign-up form or the waiting screen
  function showStatus() {
    const go = () => {
      const ov = $('loginOverlay'); if (!ov) return;
      ov.classList.add('open'); document.body.classList.add('locked');
      if (session.status === 'new') { $('signupEmail').textContent = session.email; setStep('loginSignupStep'); }
      else { $('pendingName').textContent = session.engineer || ''; setStep('loginPendingStep'); }
      if (window.Shk && Shk.hideSplash) Shk.hideSplash();
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : go();
  }
  function hideLogin() { $('loginOverlay').classList.remove('open'); document.body.classList.remove('locked'); }
  function setStep(s) {
    STEPS.forEach(id => { const el = $(id); if (el) el.hidden = id !== s; });
    $('loginHead').hidden = s === 'loginPendingStep';
    note('');
    const f = { loginEmailStep: 'loginEmail', loginCodeStep: 'loginCode', loginSignupStep: 'signupName' }[s];
    if (f) setTimeout(() => $(f) && $(f).focus(), 50);
  }
  function note(m, bad) { const n = $('loginNote'); n.textContent = m || ''; n.className = 'login-note' + (bad ? ' bad' : ''); }
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }

  async function sendCode(ev) {
    if (ev) ev.preventDefault();
    const email = $('loginEmail').value.trim().toLowerCase();
    if (!email) return note('Write your email.', true);
    const b = $('loginSendBtn'); busy(b, true, 'Sending...');
    try {
      const o = await post('auth_sendCode', [email]);
      if (!o.ok) throw new Error(o.error);
      loginEmail = email;
      $('loginSentTo').textContent = email;
      setStep('loginCodeStep');
      note('Code sent to your email (check Spam too). It works for 10 minutes.');
    } catch (e) { note(e.message, true); }
    finally { busy(b, false, 'Send code'); }
  }
  async function verify(ev) {
    if (ev) ev.preventDefault();
    const code = $('loginCode').value.replace(/\D/g, '');
    if (code.length !== 6) return note('The code is 6 numbers.', true);
    const b = $('loginVerifyBtn'); busy(b, true, 'Checking...');
    try {
      const device = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
      const o = await post('auth_verify', [loginEmail, code, device + ' · ' + (matchMedia('(display-mode: standalone)').matches ? 'app' : 'browser')]);
      if (!o.ok) throw new Error(o.error);
      const r = o.result;
      session = { token: r.token, email: r.email, engineer: r.engineer, role: r.role, status: r.status };
      store.set(session);
      $('loginCode').value = '';
      afterAuth();
    } catch (e) { note(e.message, true); }
    finally { busy(b, false, 'Sign in'); }
  }
  function afterAuth() {
    if (session.status === 'approved') {
      try { localStorage.setItem('ptahInspector', session.engineer); } catch (e) {}
      hideLogin(); applyRole(); paintAccount(); flush();
      if (window.Shk && Shk.afterSignIn) Shk.afterSignIn();
    } else showStatus();
  }
  async function signup(ev) {
    if (ev) ev.preventDefault();
    const name = $('signupName').value.trim(), msg = $('signupMsg').value.trim();
    const b = $('signupBtn'); busy(b, true, 'Sending...');
    try {
      const o = await post('signup_request', [name, msg], session.token);
      if (!o.ok) throw new Error(o.error);
      session.status = 'pending'; session.engineer = name; store.set(session);
      showStatus();
    } catch (e) { note(e.message, true); }
    finally { busy(b, false, 'Send request'); }
  }
  async function refreshStatus() {
    const b = $('pendingBtn'); busy(b, true, 'Checking...');
    try {
      const o = await post('auth_me', [], session.token);
      if (o.auth) { session = null; store.set(null); location.reload(); return; }
      if (!o.ok) throw new Error(o.error);
      session = Object.assign({}, session, { engineer: o.result.engineer, role: o.result.role, status: o.result.status }); store.set(session);
      if (session.status === 'approved') afterAuth();
      else { showStatus(); note('Still waiting. You will get an email when you are approved.'); }
    } catch (e) { note(e.message, true); }
    finally { busy(b, false, 'Check again'); }
  }

  // ---------- account sheet ----------
  function initials(n) { return String(n || '').split(/\s+/).filter(w => w && !/^(arch|eng)\.?$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·'; }
  function paintAccount() {
    const ic = $('acctIc'); if (ic) ic.textContent = session ? initials(session.engineer) : '·';
    const n = $('acctName'), e = $('acctEmail'), r = $('acctRole');
    if (n) n.textContent = session ? session.engineer : '';
    if (e) e.textContent = session ? session.email : '';
    if (r) { r.textContent = role(); r.className = 'role-badge r-' + role().toLowerCase(); }
  }
  function openAccount() { if (!session) return STANDALONE ? location.replace('./') : showLogin(); paintAccount(); $('acctOverlay').classList.add('open'); }
  function closeAccount() { $('acctOverlay').classList.remove('open'); }
  async function signOut() {
    const t = session && session.token;
    session = null; store.set(null); loginEmail = '';
    try { localStorage.removeItem('ptahInspector'); sessionStorage.removeItem('ptahEdPin'); } catch (e) {}
    closeAccount();
    if (t) { try { await post('auth_signOut', [], t); } catch (e) {} }
    location.href = './';
  }

  // ---------- install button (Android / desktop Chrome) ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; const b = $('acctInstall'); if (b) b.hidden = false; });
  async function install() { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('acctInstall').hidden = true; }

  document.addEventListener('DOMContentLoaded', () => {
    applyRole();
    if (STANDALONE) {
      if (!session || session.status !== 'approved') location.replace('./');
      return;
    }
    $('loginEmailStep').addEventListener('submit', sendCode);
    $('loginCodeStep').addEventListener('submit', verify);
    $('loginSignupStep').addEventListener('submit', signup);
    $('pendingBtn').addEventListener('click', refreshStatus);
    $('pendingOut').addEventListener('click', signOut);
    $('signupOut').addEventListener('click', signOut);
    $('loginBack').addEventListener('click', () => { loginEmail = ''; setStep('loginEmailStep'); });
    $('loginResend').addEventListener('click', () => { $('loginEmail').value = loginEmail; loginEmail = ''; setStep('loginEmailStep'); sendCode(); });
    $('acctOverlay').addEventListener('click', e => { if (e.target.id === 'acctOverlay') closeAccount(); });
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios && !standalone) $('acctIosHint').hidden = false;
    paintAccount();
    if (!session) showLogin();
    else if (session.status !== 'approved') {
      showStatus();
      // the admin may have decided meanwhile
      post('auth_me', [], session.token).then(o => {
        if (o.auth) { session = null; store.set(null); location.reload(); return; }
        if (o.ok) { session = Object.assign({}, session, o.result); store.set(session); if (session.status === 'approved') afterAuth(); else showStatus(); }
      }).catch(() => {});
    } else {
      // refresh the role in the background (an admin may have changed it)
      post('auth_me', [], session.token).then(o => {
        if (o.auth) { session = null; store.set(null); location.reload(); return; }
        if (o.ok && o.result.status === 'approved') {
          const changed = o.result.role !== session.role;
          session = Object.assign({}, session, { engineer: o.result.engineer, role: o.result.role }); store.set(session);
          if (changed) location.reload();
        } else if (o.ok) { session.status = o.result.status; store.set(session); location.reload(); }
      }).catch(() => {});
    }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !STANDALONE) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e)));
  }

  window.PtahApp = { engineer: () => session ? session.engineer : '', email: () => session ? session.email : '',
                     role, openAccount, closeAccount, signOut, install, call, refreshRole: applyRole };
  window.Shk = window.Shk || {};
})();
