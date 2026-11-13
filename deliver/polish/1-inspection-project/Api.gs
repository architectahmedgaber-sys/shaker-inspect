/**
 * Api.gs  -  Shaker Inspect · backend for the installable app (GitHub Pages)
 * Paste it into the same Apps Script project as Code.gs and RecordPdf.gs.
 *
 * SIGN-IN
 *   1. The person types their email. A 6-digit code is emailed (10 minutes, 5 tries).
 *   2. After the code, the server looks the email up in tab _Users:
 *        - Approved     -> the app opens. Requests are closed ONLY under that person's name.
 *        - New          -> the app asks for full name + a short message about who they are.
 *        - Pending      -> "waiting for approval": no data at all.
 *        - Rejected     -> cannot ask again for 7 days.
 *   3. Admins approve or reject in the Admin screen. The engineer tab is created only on approval.
 *
 * ROLES (column Role in _Users)
 *   DC       document controller: view only, plus IR files and ACC upload (no engineer tab).
 *   Admin    everything, plus the Admin screen, checklist editing and Handover (tracker) editing.
 *   Engineer closes requests under their own name, sees everything else.
 *   Viewer   view only: requests, sheet tabs, Handover. Cannot close or undo.
 *
 * Tab _Users columns: Email | Engineer | Active | Role | Status | Message | Requested | Decided
 * Tab _Log records sign-ins, sign-ups, approvals, closes and undos.
 *
 * Phase 2 (photos, comments, re-inspection, daily report, morning email, backup): see Daily.gs, run setupDaily() once.
 * Phase 3 (villa board, notes, undo + trash, close rules, leaderboard, push): see Extras.gs, run setupExtras() once.
 *
 * Run once from the editor:  setupUsers()   -> makes/updates _Users and _Log, adds the first admin,
 *                                              and asks for the permission to send email.
 * Handover (tracker) link:   setTrackerLink()  (see Tracker_Bridge.gs)
 * Sign everyone out:         signOutEveryone()
 */

// The app's address on GitHub Pages. While it is set, the old portal link shows a "moved" page.
const APP_URL = '';

const APP_NAME = 'Shaker Inspect';
const FIRST_ADMIN = 'architectahmedgaber@gmail.com';
const FIRST_ADMIN_NAME = 'Ahmed Gaber';

const USERS_TAB = '_Users';
const LOG_TAB = '_Log';
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const REJECT_DAYS = 7;
const USER_COLS = ['Email', 'Engineer', 'Active', 'Role', 'Status', 'Message', 'Requested', 'Decided'];
const ROLES = ['Admin', 'Engineer', 'Viewer', 'DC'];   // DC = document controller: uploads IR files and the ACC report, cannot close requests

// ---------------- entry point ----------------

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e && e.postData && e.postData.contents || '{}'); }
  catch (err) { return apiOut_({ ok: false, error: 'Bad request.' }); }
  const fn = String(body.fn || '');
  const args = Array.isArray(body.args) ? body.args : [];
  try {
    if (fn === 'auth_sendCode') return apiOut_({ ok: true, result: authSendCode_(args[0]) });
    if (fn === 'auth_verify')   return apiOut_({ ok: true, result: authVerify_(args[0], args[1], args[2]) });
    if (fn === 'ping')          return apiOut_({ ok: true, result: 'ok', version: 'api-8' });

    const me = apiUser_(body.token);
    if (!me) return apiOut_({ ok: false, auth: true, error: 'Please sign in again.' });
    if (fn === 'auth_me')      return apiOut_({ ok: true, result: publicUser_(me) });
    if (fn === 'auth_signOut') { endSession_(body.token); return apiOut_({ ok: true, result: true }); }
    if (fn === 'signup_request') return apiOut_({ ok: true, result: signupRequest_(me, args) });

    if (me.status !== 'approved')
      return apiOut_({ ok: false, state: me.status, error: 'Your account is not approved yet.' });

    if (fn.indexOf('admin_') === 0) {
      // a DC (document controller) may only upload IR files and the ACC report
      const dcOk = me.role === 'DC' && ((typeof IR_ADMIN_FUNCS_ !== 'undefined' && IR_ADMIN_FUNCS_[fn]) || (typeof ACC_ADMIN_FUNCS_ !== 'undefined' && ACC_ADMIN_FUNCS_[fn]));
      if (me.role !== 'Admin' && !dcOk) return apiOut_({ ok: false, error: 'Admins only.' });
      const g = (typeof IR_ADMIN_FUNCS_ !== 'undefined' ? IR_ADMIN_FUNCS_[fn] : null) || ADMIN_FUNCS_[fn] || (typeof DAILY_ADMIN_FUNCS_ !== 'undefined' ? DAILY_ADMIN_FUNCS_[fn] : null) ||
                (typeof EXTRAS_ADMIN_FUNCS_ !== 'undefined' ? EXTRAS_ADMIN_FUNCS_[fn] : null) ||
                (typeof ACC_ADMIN_FUNCS_ !== 'undefined' ? ACC_ADMIN_FUNCS_[fn] : null);
      if (!g) return apiOut_({ ok: false, error: 'Unknown function: ' + fn });
      let ares; try { ares = g(me, args); } finally { dcDrop_(); }
      return apiOut_({ ok: true, result: ares });
    }
    const f = (typeof POLISH_FUNCS_ !== 'undefined' ? POLISH_FUNCS_[fn] : null) || (typeof IR_FUNCS_ !== 'undefined' ? IR_FUNCS_[fn] : null) || (typeof SOCIAL_FUNCS_ !== 'undefined' ? SOCIAL_FUNCS_[fn] : null) || API_FUNCS_[fn] || (typeof DAILY_FUNCS_ !== 'undefined' ? DAILY_FUNCS_[fn] : null) ||
              (typeof EXTRAS_FUNCS_ !== 'undefined' ? EXTRAS_FUNCS_[fn] : null);
    if (!f) return apiOut_({ ok: false, error: 'Unknown function: ' + fn });
    let result; try { result = f(me, args); } finally { if (!READ_ONLY_[fn]) dcDrop_(); }   // any write: forget the cached sheet reads
    if (typeof extrasAfterCall_ === 'function') { try { extrasAfterCall_(fn, me, args); } catch (e) { console.warn('after call: ' + e); } }
    return apiOut_({ ok: true, result: result });
  } catch (err) {
    return apiOut_({ ok: false, error: err && err.message || String(err) });
  }
}

// calls that only read: they keep the short server cache of the sheet
const READ_ONLY_ = { getDailyActions: 1, getInspectors: 1, getChecklist: 1, getChecklistByCode: 1, getSectionList: 1, daily_bootstrap: 1,
  app_init: 1, extras_bootstrap: 1, comments_list: 1, reinspect_list: 1, extras_villas: 1, extras_villa: 1, extras_request: 1, extras_leaderboard: 1 };

function apiOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function publicUser_(u) {
  return { email: u.email, engineer: u.engineer, role: u.role, status: u.status, message: u.message || '', until: u.until || '' };
}

function need_(me, roles) {
  if (roles.indexOf(me.role) < 0) throw new Error('Your role (' + me.role + ') is view-only. Ask an admin if you need to close requests.');
}

// What approved users may call. Every function gets the signed-in user (me) first.
const API_FUNCS_ = {
  getInspectors:      (me) => [me.engineer],
  getDailyActions:    () => getDailyActions(),
  getChecklist:       (me, a) => getChecklist(a[0], a[1]),
  getChecklistByCode: (me, a) => getChecklistByCode(a[0]),
  getSectionList:     () => getSectionList(),

  processAndSaveAction: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    if (!findEngineerSheet(SpreadsheetApp.getActiveSpreadsheet(), me.engineer))
      throw new Error('No tab named "' + me.engineer + '" in the sheet. Ask an admin.');
    const p = a[0] || {};
    // the same close sent twice (offline upload retried after a lost answer): give back the first answer
    const cache = CacheService.getScriptCache();
    const cid = p.clientId ? 'cid_' + String(p.clientId).slice(0, 60) : '';
    if (cid) { const hit = cache.get(cid); if (hit) return JSON.parse(hit); }
    const asked = String(p.inspector || '').trim();
    p.inspector = me.engineer;                       // the name always comes from the sign-in
    let res = processAndSaveAction(p);
    // already closed by this same engineer with the same code = an earlier upload of this close got through
    if (res && res.alreadyClosed && p.clientId &&
        String(res.error || '').toLowerCase().indexOf(('by ' + me.engineer + ' (Code ' + String(p.code || '').toUpperCase() + ')').toLowerCase()) >= 0) {
      res = { success: true, inspector: me.engineer, duplicate: true, recordUrl: '', recordError: '' };
    }
    let photos = 0;
    if (res && res.success && !res.duplicate) { try { photos = dailyAfterClose_(me, p, res); } catch (e) { console.warn('after close: ' + e); } }
    if (res && res.success && !res.duplicate && typeof extrasAfterClose_ === 'function') { try { extrasAfterClose_(me, p, res); } catch (e) { console.warn('undo keep: ' + e); } }
    apiLog_(me, 'close', [p.irNumber, 'Rev ' + (p.rev || '0'), 'Code ' + p.code,
      res && res.success ? (res.duplicate ? 'repeat upload, already saved' : 'saved') : 'refused: ' + (res && res.error),
      photos ? photos + ' photos' : '', p.madeAt ? '(made offline ' + new Date(p.madeAt).toISOString().slice(0, 16).replace('T', ' ') + ')' : '',
      asked && asked.toLowerCase() !== me.engineer.toLowerCase() ? '(app sent "' + asked + '", ignored)' : ''].filter(String).join(' · '));
    if (res) res.photos = photos;
    if (cid && res && (res.success || res.alreadyClosed)) { try { cache.put(cid, JSON.stringify(res), 21600); } catch (e) {} }
    return res;
  },

  undoAction: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    const token = a[0];
    const raw = token ? CacheService.getScriptCache().get('undo_' + token) : null;
    if (raw) {
      const u = JSON.parse(raw);
      if (String(u.inspector || '').toLowerCase() !== me.engineer.toLowerCase())
        return { success: false, error: 'Only ' + (u.inspector || 'the engineer who closed it') + ' can undo this.' };
    }
    const res = undoAction(token);
    apiLog_(me, 'undo', res && res.success ? 'undone' : 'refused: ' + (res && res.error));
    if (res && res.success && typeof extrasAfterUndo_ === 'function') { try { extrasAfterUndo_(me, token); } catch (e) { console.warn('trash: ' + e); } }
    return res;
  },

  // Read-only browsing of the sheet tabs (everyone approved, including Viewers)
  sheet_tabs: () => sheetTabs_(),
  sheet_read: (me, a) => sheetRead_(a[0], a[1]),

  // Handover tracker (bridge to the tracker's own script)
  tracker_getData:  (me, a) => trackerCall_('getData', [!!a[0]], me),
  tracker_makePdf:  (me, a) => trackerCall_('makePdf', [a[0]], me),
  tracker_saveVilla: (me, a) => {
    if (me.role !== 'Admin') throw new Error('Only admins can update the Handover tracker.');
    const r = trackerCall_('saveVilla', [a[0], a[1], a[2], ''], me);
    apiLog_(me, 'handover save', String(a[0]));
    return r;
  },

  // Checklist editor: admins only. The server uses the real PIN, nobody types it.
  clEditorOpen:          (me, a) => { adminOnly_(me); return clEditorOpen(adminPin_()); },
  clEditorLoad:          (me, a) => { adminOnly_(me); return clEditorLoad(adminPin_(), a[1]); },
  clEditorSave:          (me, a) => { adminOnly_(me); const r = clEditorSave(adminPin_(), a[1], a[2], a[3]); apiLog_(me, 'checklist edit', a[1]); return r; },
  clEditorAddSection:    (me, a) => { adminOnly_(me); const r = clEditorAddSection(adminPin_(), a[1]); apiLog_(me, 'checklist add section', a[1] && a[1].code); return r; },
  clEditorDeleteSection: (me, a) => { adminOnly_(me); const r = clEditorDeleteSection(adminPin_(), a[1]); apiLog_(me, 'checklist delete section', a[1]); return r; }
};

function adminOnly_(me) { if (me.role !== 'Admin') throw new Error('Only admins can edit checklists.'); }
function adminPin_() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty('CL_EDIT_PIN');
  if (!p) { p = Utilities.getUuid().slice(0, 8); props.setProperty('CL_EDIT_PIN', p); }
  return p;
}

// ---------------- users (tab _Users) ----------------

function usersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(USERS_TAB);
  if (!sh) {
    sh = ss.insertSheet(USERS_TAB);
    sh.getRange(1, 1, 1, USER_COLS.length).setValues([USER_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, USER_COLS.length).setFontWeight('bold');
  }
  // add any missing column on the right (old _Users had only Email | Engineer | Active)
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(h => String(h).trim());
  USER_COLS.forEach(c => {
    if (head.map(h => h.toLowerCase()).indexOf(c.toLowerCase()) < 0) {
      head.push(c); sh.getRange(1, head.length).setValue(c).setFontWeight('bold');
    }
  });
  return sh;
}

function readUsers_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('shk_users');
  if (hit) return JSON.parse(hit);
  const sh = usersSheet_();
  const v = sh.getDataRange().getValues();
  const head = v.shift().map(h => String(h).trim().toLowerCase());
  const ix = {}; USER_COLS.forEach(c => ix[c] = head.indexOf(c.toLowerCase()));
  const tz = Session.getScriptTimeZone();
  const s = (r, c) => { const x = r[ix[c]]; return x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd HH:mm') : String(x == null ? '' : x).trim(); };
  const rows = v.map((r, i) => ({
    row: i + 2, email: s(r, 'Email').toLowerCase(), engineer: s(r, 'Engineer'), active: s(r, 'Active'),
    role: s(r, 'Role'), status: s(r, 'Status'), message: s(r, 'Message'), requested: s(r, 'Requested'), decided: s(r, 'Decided')
  })).filter(u => u.email || u.engineer);
  cache.put('shk_users', JSON.stringify(rows), 300);
  return rows;
}
function dropUsersCache_() { CacheService.getScriptCache().remove('shk_users'); }

function appendUser_(vals) {
  const sh = usersSheet_();
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
  sh.appendRow(head.map(h => { const k = USER_COLS.filter(c => c.toLowerCase() === h)[0]; return k ? (vals[k] || '') : ''; }));
  dropUsersCache_();
}

function setUserFields_(row, fields) {
  const sh = usersSheet_();
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
  Object.keys(fields).forEach(k => {
    const c = head.indexOf(k.toLowerCase());
    if (c >= 0) sh.getRange(row, c + 1).setValue(fields[k]);
  });
  dropUsersCache_();
}

/** The state of an email: status is approved | pending | rejected | blocked | new. */
function userState_(email) {
  const e = String(email || '').trim().toLowerCase();
  const u = readUsers_().filter(r => r.email === e)[0];
  if (e === FIRST_ADMIN) {
    return { email: e, engineer: (u && u.engineer) || FIRST_ADMIN_NAME, role: 'Admin', status: 'approved' };
  }
  if (!u) return { email: e, engineer: '', role: '', status: 'new' };
  if (/^(no|n|false|0)$/i.test(u.active)) return { email: e, engineer: u.engineer, role: u.role || 'Engineer', status: 'blocked' };
  const st = u.status.toLowerCase();
  if (st === 'pending') return { email: e, engineer: u.engineer, role: '', status: 'pending', message: u.message };
  if (st === 'rejected') {
    const d = new Date(String(u.decided).slice(0, 10) + 'T00:00:00');
    const until = new Date(d.getTime() + REJECT_DAYS * 864e5);
    if (!isNaN(d) && until > new Date()) return { email: e, engineer: u.engineer, role: '', status: 'rejected', until: Utilities.formatDate(until, Session.getScriptTimeZone(), 'yyyy-MM-dd') };
    return { email: e, engineer: '', role: '', status: 'new' };
  }
  const role = ROLES.indexOf(u.role) >= 0 ? u.role : 'Engineer';
  if (!u.engineer) return { email: e, engineer: '', role: role, status: 'new' };
  return { email: e, engineer: u.engineer, role: role, status: 'approved' };
}

// ---------------- sign-in code ----------------

function authSendCode_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Write a valid email.');
  const st = userState_(e);
  if (st.status === 'blocked') throw new Error('This account is turned off. Contact the admin.');
  if (st.status === 'rejected') throw new Error('Your request was not approved. You can ask again after ' + st.until + '.');

  const cache = CacheService.getScriptCache();
  if (cache.get('otp_wait_' + e)) throw new Error('A code was just sent. Wait one minute, then try again.');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('otp_' + e, JSON.stringify({ h: sha256_(code), tries: 0 }), CODE_MINUTES * 60);
  cache.put('otp_wait_' + e, '1', 60);

  MailApp.sendEmail({
    to: e,
    subject: APP_NAME + ' sign-in code: ' + code,
    name: APP_NAME,
    htmlBody: mailShell_('Your sign-in code',
      '<p>Your ' + APP_NAME + ' code is:</p>' +
      '<p style="font-size:30px;letter-spacing:7px;font-weight:bold;color:#0b2a5b;margin:8px 0">' + code + '</p>' +
      '<p>It works for ' + CODE_MINUTES + ' minutes. If you did not ask for it, ignore this email.</p>')
  });
  return { sent: true, known: st.status !== 'new' };
}

function authVerify_(email, code, device) {
  const e = String(email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const raw = cache.get('otp_' + e);
  if (!raw) throw new Error('The code expired. Send a new one.');
  const o = JSON.parse(raw);
  if (o.h !== sha256_(String(code || '').replace(/\D/g, ''))) {
    o.tries++;
    if (o.tries >= 5) { cache.remove('otp_' + e); apiLog_({ email: e, engineer: '' }, 'code locked', '5 wrong codes'); throw new Error('Wrong code 5 times. Send a new one.'); }
    cache.put('otp_' + e, JSON.stringify(o), CODE_MINUTES * 60);
    throw new Error('Wrong code. ' + (5 - o.tries) + ' tries left.');
  }
  cache.remove('otp_' + e);
  const u = userState_(e);
  if (u.status === 'blocked' || u.status === 'rejected') throw new Error('This account cannot sign in.');

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const props = PropertiesService.getScriptProperties();
  cleanSessions_(props);
  props.setProperty('sess_' + sha256_(token), JSON.stringify({ e: e, x: Date.now() + SESSION_DAYS * 864e5 }));
  apiLog_(u, 'sign in', String(device || '').slice(0, 120) + ' [' + u.status + ']');
  const out = publicUser_(u); out.token = token; out.days = SESSION_DAYS;
  return out;
}

// ---------------- sign-up request ----------------

function signupRequest_(me, a) {
  if (me.status !== 'new') throw new Error(me.status === 'pending' ? 'Your request is already waiting for approval.' : 'This account already exists.');
  const name = String(a[0] || '').replace(/\s+/g, ' ').trim();
  const msg = String(a[1] || '').trim().slice(0, 300);
  if (!/^[A-Za-z؀-ۿ][A-Za-z؀-ۿ .'\-]{2,59}$/.test(name) || name.split(' ').length < 2) throw new Error('Write your full name (first and last), letters only.');
  if (msg.length < 8) throw new Error('Write a short message saying who you are and where you work.');

  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    dropUsersCache_();
    const users = readUsers_();
    const clash = users.filter(u => u.engineer.toLowerCase() === name.toLowerCase() && u.email && u.email !== me.email)[0];
    if (clash) throw new Error('This name already belongs to another account. If it is you on a different email, ask an admin.');
    const old = users.filter(u => u.email === me.email)[0];
    const tz = Session.getScriptTimeZone();
    const rowVals = { Email: me.email, Engineer: name, Active: 'Yes', Role: '', Status: 'Pending', Message: msg, Requested: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), Decided: '' };
    if (old) setUserFields_(old.row, rowVals); else appendUser_(rowVals);
  } finally { lock.releaseLock(); }
  apiLog_({ email: me.email, engineer: name }, 'sign-up request', msg);
  notifyAdmins_('New sign-up request: ' + name,
    '<p><b>' + esc_(name) + '</b> (' + esc_(me.email) + ') asked to join ' + APP_NAME + '.</p>' +
    '<p style="background:#f4f1e6;padding:10px;border-radius:6px">' + esc_(msg) + '</p>' +
    '<p>Open the app, go to Admin, then Users, and approve or reject.</p>');
  return { status: 'pending' };
}

function notifyAdmins_(subject, html) {
  const to = readUsers_().filter(u => u.role === 'Admin' && u.email && userState_(u.email).status === 'approved').map(u => u.email);
  if (to.indexOf(FIRST_ADMIN) < 0) to.push(FIRST_ADMIN);
  mailTo_(to.join(','), subject, html);
}

function mailTo_(to, subject, html) {
  try { MailApp.sendEmail({ to: to, subject: APP_NAME + ': ' + subject, name: APP_NAME, htmlBody: mailShell_(subject, html) }); }
  catch (e) { console.warn('mail failed: ' + e); }
}

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function mailShell_(title, inner) {
  return '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0b1f44;max-width:480px">' +
    '<div style="background:#0b2a5b;color:#ffc61a;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:bold;letter-spacing:1px">' + APP_NAME.toUpperCase() + '</div>' +
    '<div style="border:1px solid #e5e3d6;border-top:0;padding:16px 18px;border-radius:0 0 8px 8px"><h3 style="margin:0 0 8px">' + esc_(title) + '</h3>' + inner +
    '<p style="color:#8a94a8;font-size:12px;margin-top:18px;font-style:italic">architected by Ptah</p></div></div>';
}

// ---------------- sessions ----------------

function apiUser_(token) {
  if (!token || typeof token !== 'string' || token.length < 40) return null;
  const props = PropertiesService.getScriptProperties();
  const key = 'sess_' + sha256_(token);
  const raw = props.getProperty(key);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (s.x < Date.now()) { props.deleteProperty(key); return null; }
  const u = userState_(s.e);
  if (u.status === 'blocked') { props.deleteProperty(key); return null; }
  if (s.x - Date.now() < 20 * 864e5) props.setProperty(key, JSON.stringify({ e: s.e, x: Date.now() + SESSION_DAYS * 864e5 }));
  return u;
}

function endSession_(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('sess_' + sha256_(token));
}

function endSessionsOf_(email) {
  const props = PropertiesService.getScriptProperties(), all = props.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).e === email) props.deleteProperty(k); } catch (e) {}
  });
}

function cleanSessions_(props) {
  const all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(k => {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).x < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

// ---------------- log ----------------

function apiLog_(me, what, detail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(LOG_TAB);
    if (!sh) { sh = ss.insertSheet(LOG_TAB); sh.appendRow(['Time', 'Email', 'Engineer', 'Action', 'Detail']); }
    sh.appendRow([new Date(), me.email, me.engineer, what, detail || '']);
  } catch (e) { console.warn('log failed: ' + e); }
}

function readLog_(max) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(max || 1500, sh.getLastRow() - 1);
  const tz = Session.getScriptTimeZone();
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getValues().map(r => ({
    t: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, "yyyy-MM-dd'T'HH:mm:ss") : String(r[0]),
    email: String(r[1]), engineer: String(r[2]), action: String(r[3]), detail: String(r[4])
  }));
}

// ---------------- read-only sheet browsing ----------------

function sheetTabs_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .filter(s => !s.isSheetHidden() && s.getName().charAt(0) !== '_')
    .map(s => ({ name: s.getName(), rows: Math.max(0, s.getLastRow() - 1) }));
}

function sheetRead_(name, limit) {
  const n = String(name || '');
  if (n.charAt(0) === '_') throw new Error('Not available.');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n);
  if (!sh) throw new Error('Tab not found.');
  const lastC = Math.min(sh.getLastColumn(), 45), maxR = sh.getLastRow();
  if (maxR < 1 || lastC < 1) return { name: n, header: [], rows: [], total: 0 };
  // sheets often have thousands of empty formatted rows at the bottom: find the last row that really has data
  const probe = sh.getRange(1, 1, maxR, Math.min(lastC, 6)).getValues();
  let last = 1;
  for (let i = probe.length - 1; i >= 1; i--) { if (probe[i].some(v => v !== '' && v !== null)) { last = i + 1; break; } }
  const header = sh.getRange(1, 1, 1, lastC).getDisplayValues()[0];
  const want = Math.min(Math.max(+limit || 150, 10), 400);
  const cnt = Math.min(want, last - 1);
  let rows = cnt > 0 ? sh.getRange(last - cnt + 1, 1, cnt, lastC).getDisplayValues().reverse() : [];
  rows = rows.filter(r => r.some(v => String(v).trim() !== ''));
  return { name: n, header: header, rows: rows, total: last - 1, v: 'api-8' };
}

// ---------------- Handover tracker bridge ----------------

function trackerCall_(fn, args, me) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('TRACKER_URL'), secret = props.getProperty('TRACKER_SECRET');
  if (!url || !secret) throw new Error('The Handover tracker is not connected yet. Ask the admin.');
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true, followRedirects: true,
    payload: JSON.stringify({ secret: secret, fn: fn, args: args, by: me.engineer })
  });
  let o;
  try { o = JSON.parse(res.getContentText()); } catch (e) { throw new Error('The tracker answered in a wrong format. Check its deployment (access: Anyone).'); }
  if (!o.ok) throw new Error(o.error || 'The tracker refused the call.');
  return o.result;
}

/** Run once from the editor after filling TRACKER_WEB_APP_URL below. It prints the secret to paste into the tracker script. */
function setTrackerLink() {
  const TRACKER_WEB_APP_URL = '';   // <- the tracker's web app URL (ends with /exec)
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(TRACKER_WEB_APP_URL)) throw new Error('Paste the tracker web app URL (ends with /exec) between the quotes first.');
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('TRACKER_SECRET');
  if (!secret) { secret = Utilities.getUuid().replace(/-/g, ''); props.setProperty('TRACKER_SECRET', secret); }
  props.setProperty('TRACKER_URL', TRACKER_WEB_APP_URL);
  Logger.log('Saved. Paste this secret in Tracker_Bridge.gs (BRIDGE_SECRET): ' + secret);
}

// ---------------- admin functions ----------------

const ADMIN_FUNCS_ = {

  admin_overview: () => {
    const items = getDailyActions();
    const by = {};
    items.forEach(i => { const k = i.contractor || 'Other'; (by[k] = by[k] || { name: k, open: 0, late: 0 }); by[k].open++; if (i.overdue) by[k].late++; });
    const log = readLog_(1500), today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const closes = log.filter(l => l.action === 'close' && /· saved/.test(l.detail));
    const todays = closes.filter(l => l.t.slice(0, 10) === today);
    const per = {};
    todays.forEach(l => { per[l.engineer] = (per[l.engineer] || 0) + 1; });
    return {
      open: items.length, late: items.filter(i => i.overdue).length, closedToday: todays.length,
      contractors: Object.keys(by).map(k => by[k]).sort((a, b) => b.late - a.late || b.open - a.open),
      perEngineer: Object.keys(per).map(k => ({ engineer: k, n: per[k] })).sort((a, b) => b.n - a.n),
      lateItems: items.filter(i => i.overdue).sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0)).slice(0, 8)
        .map(i => ({ ir: i.irNumber, rev: i.rev, text: i.description, contractor: i.contractor, age: i.ageDays })),
      latest: closes.slice(-8).reverse().map(l => ({ t: l.t, engineer: l.engineer, detail: l.detail }))
    };
  },

  admin_users: () => {
    dropUsersCache_();
    const rows = readUsers_();
    const log = readLog_(1500), last = {};
    log.filter(l => l.action === 'sign in').forEach(l => { last[l.email] = l.t; });
    return rows.map(u => ({
      row: u.row, email: u.email, engineer: u.engineer, role: u.role || (u.email === FIRST_ADMIN ? 'Admin' : 'Engineer'),
      status: u.email ? userState_(u.email).status : 'unlinked', message: u.message, requested: u.requested, last: last[u.email] || ''
    }));
  },

  admin_decide: (me, a) => {
    const email = String(a[0] || '').toLowerCase(), decision = String(a[1] || ''), role = String(a[2] || 'Engineer');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      dropUsersCache_();
      const users = readUsers_();
      const u = users.filter(r => r.email === email && /pending/i.test(r.status))[0];
      if (!u) throw new Error('No pending request for ' + email + '.');
      const tz = Session.getScriptTimeZone(), day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      if (decision === 'reject') {
        setUserFields_(u.row, { Status: 'Rejected', Decided: day + ' · ' + me.engineer });
        apiLog_(me, 'reject', email);
        mailTo_(email, 'Your request was not approved', '<p>Your request to join ' + APP_NAME + ' was not approved. You can ask again in ' + REJECT_DAYS + ' days, or contact the admin.</p>');
        return true;
      }
      if (ROLES.indexOf(role) < 0) throw new Error('Pick a role.');
      const name = String(a[3] || u.engineer).replace(/\s+/g, ' ').trim();
      if (!/^[A-Za-z؀-ۿ][A-Za-z؀-ۿ .'\-]{2,59}$/.test(name)) throw new Error('The name has odd characters.');
      const clash = users.filter(r => r.engineer.toLowerCase() === name.toLowerCase() && r.email && r.email !== email)[0];
      if (clash) throw new Error('"' + name + '" belongs to ' + clash.email + '.');
      // a row for that name without an email (made by setupUsers): link the email to it
      const free = users.filter(r => r.engineer.toLowerCase() === name.toLowerCase() && !r.email)[0];
      let target = u.row;
      if (free) {
        SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_TAB).deleteRow(u.row);
        target = free.row > u.row ? free.row - 1 : free.row;
        dropUsersCache_();
      }
      setUserFields_(target, { Email: email, Engineer: name, Active: 'Yes', Role: role, Status: 'Approved', Message: u.message, Requested: u.requested, Decided: day + ' · ' + me.engineer });
      if (role !== 'Viewer' && role !== 'DC' && !findEngineerSheet(SpreadsheetApp.getActiveSpreadsheet(), name)) createEngineerTab_(name);
      apiLog_(me, 'approve', email + ' as ' + role + ' (' + name + ')');
      mailTo_(email, 'You are approved', '<p>Hi ' + esc_(name) + ', your ' + APP_NAME + ' account was approved as <b>' + role + '</b>. Open the app and sign in with this email.</p>');
      return true;
    } finally { lock.releaseLock(); }
  },

  // fields: role, active ('Yes'/'No'), engineer (rename)
  admin_setUser: (me, a) => {
    const email = String(a[0] || '').toLowerCase(), f = a[1] || {};
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      dropUsersCache_();
      const users = readUsers_();
      const u = users.filter(r => r.email === email)[0];
      if (!u) throw new Error('User not found.');
      const admins = users.filter(r => r.email && userState_(r.email).role === 'Admin' && userState_(r.email).status === 'approved');
      const isAdmin = userState_(email).role === 'Admin';
      if (email === FIRST_ADMIN && ((f.role && f.role !== 'Admin') || f.active === 'No')) throw new Error('The first admin cannot be changed.');
      if (isAdmin && admins.length <= 1 && ((f.role && f.role !== 'Admin') || f.active === 'No')) throw new Error('There must be at least one admin.');
      const set = {};
      if (f.role) { if (ROLES.indexOf(f.role) < 0) throw new Error('Bad role.'); set.Role = f.role; }
      if (f.active) set.Active = f.active === 'No' ? 'No' : 'Yes';
      if (f.engineer) {
        const nm = String(f.engineer).replace(/\s+/g, ' ').trim();
        if (users.some(r => r.engineer.toLowerCase() === nm.toLowerCase() && r.email !== email)) throw new Error('That name is taken.');
        set.Engineer = nm;
      }
      setUserFields_(u.row, set);
      if (set.Role && set.Role !== 'Viewer' && set.Role !== 'DC') {
        const nm = set.Engineer || u.engineer;
        if (nm && !findEngineerSheet(SpreadsheetApp.getActiveSpreadsheet(), nm)) createEngineerTab_(nm);
      }
      if (set.Active === 'No') endSessionsOf_(email);
      apiLog_(me, 'user change', email + ' ' + JSON.stringify(f));
      return true;
    } finally { lock.releaseLock(); }
  },

  admin_signOutUser: (me, a) => { endSessionsOf_(String(a[0] || '').toLowerCase()); apiLog_(me, 'sign out user', a[0]); return true; },

  // Add somebody directly (already approved). Used to pre-link the current engineers.
  admin_addUser: (me, a) => {
    const email = String(a[0] || '').trim().toLowerCase(), name = String(a[1] || '').replace(/\s+/g, ' ').trim(), role = String(a[2] || 'Engineer');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Write a valid email.');
    if (ROLES.indexOf(role) < 0) throw new Error('Pick a role.');
    if (!name) throw new Error('Write the name.');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      dropUsersCache_();
      const users = readUsers_();
      if (users.some(r => r.email === email)) throw new Error('This email is already in the list.');
      if (users.some(r => r.engineer.toLowerCase() === name.toLowerCase() && r.email)) throw new Error('That name is taken.');
      const free = users.filter(r => r.engineer.toLowerCase() === name.toLowerCase() && !r.email)[0];
      const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + ' · ' + me.engineer;
      const vals = { Email: email, Engineer: name, Active: 'Yes', Role: role, Status: 'Approved', Decided: stamp };
      if (free) setUserFields_(free.row, vals); else appendUser_(vals);
      if (role !== 'Viewer' && role !== 'DC' && !findEngineerSheet(SpreadsheetApp.getActiveSpreadsheet(), name)) createEngineerTab_(name);
      apiLog_(me, 'add user', email + ' as ' + role);
      return true;
    } finally { lock.releaseLock(); }
  },

  admin_perf: (me, a) => {
    const days = Math.min(Math.max(+a[0] || 30, 1), 90);
    const tz = Session.getScriptTimeZone(), from = Date.now() - days * 864e5;
    const log = readLog_(1500).filter(l => l.action === 'close' && /· saved/.test(l.detail) && new Date(l.t).getTime() >= from);
    const eng = {}, daily = {};
    log.forEach(l => {
      const m = /Code ([A-D])/.exec(l.detail), c = m ? m[1] : '?';
      const e = (eng[l.engineer] = eng[l.engineer] || { engineer: l.engineer, n: 0, A: 0, B: 0, C: 0, D: 0 });
      e.n++; if (e[c] != null) e[c]++;
      const d = l.t.slice(0, 10); daily[d] = (daily[d] || 0) + 1;
    });
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const d = Utilities.formatDate(new Date(Date.now() - i * 864e5), tz, 'yyyy-MM-dd'); series.push({ d: d, n: daily[d] || 0 }); }
    return { days: days, total: log.length, engineers: Object.keys(eng).map(k => eng[k]).sort((x, y) => y.n - x.n), series: series };
  },

  admin_log: (me, a) => {
    const q = String(a[0] || '').toLowerCase(), n = Math.min(+a[1] || 200, 600);
    let rows = readLog_(1500);
    const alerts = rows.filter(l => /\(app sent/.test(l.detail) || l.action === 'code locked' || l.action === 'sign-up request').slice(-20).reverse();
    if (q) rows = rows.filter(l => (l.email + ' ' + l.engineer + ' ' + l.action + ' ' + l.detail).toLowerCase().indexOf(q) >= 0);
    return { rows: rows.slice(-n).reverse(), alerts: alerts };
  },

  admin_settings: () => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let pdf = '';
    try { const it = DriveApp.getFoldersByName('Ptah Pro - Inspection Records'); if (it.hasNext()) pdf = it.next().getUrl(); } catch (e) {}
    const p = PropertiesService.getScriptProperties();
    return { sheetUrl: ss.getUrl(), pdfFolderUrl: pdf, trackerLinked: !!(p.getProperty('TRACKER_URL') && p.getProperty('TRACKER_SECRET')) };
  }
};

/** New engineer tab: a copy of an existing engineer tab, emptied (same header and format). */
function createEngineerTab_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = getInspectors().map(n => findEngineerSheet(ss, n)).filter(Boolean)[0];
  let sh;
  if (src) {
    sh = src.copyTo(ss).setName(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
  } else {
    sh = ss.insertSheet(name);
    sh.appendRow(['Date', 'Activity', 'CIR N#', 'REV', 'Action', 'Notes']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------------- run from the editor ----------------

/** Makes/updates tab _Users and _Log, adds the first admin, grants the email permission. Safe to run again. */
function setupUsers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = usersSheet_();
  dropUsersCache_();
  const rows = readUsers_();
  if (!rows.some(r => r.email === FIRST_ADMIN)) {
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + ' · setup';
    const vals = { Email: FIRST_ADMIN, Engineer: FIRST_ADMIN_NAME, Active: 'Yes', Role: 'Admin', Status: 'Approved', Decided: stamp };
    const free = rows.filter(r => r.engineer.toLowerCase() === FIRST_ADMIN_NAME.toLowerCase() && !r.email)[0];
    if (free) setUserFields_(free.row, vals); else appendUser_(vals);
  }
  // one row per engineer tab that has no row yet (email empty = waiting to be linked)
  dropUsersCache_();
  const have = readUsers_().map(r => r.engineer.toLowerCase());
  getInspectors().forEach(n => { if (have.indexOf(n.toLowerCase()) < 0) appendUser_({ Engineer: n, Active: 'Yes', Role: 'Engineer', Status: 'Approved' }); });
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 200);
  if (!ss.getSheetByName(LOG_TAB)) {
    const lg = ss.insertSheet(LOG_TAB);
    lg.appendRow(['Time', 'Email', 'Engineer', 'Action', 'Detail']);
    lg.setFrozenRows(1);
  }
  dropUsersCache_();
  MailApp.getRemainingDailyQuota();   // makes Google ask for the email permission
  adminPin_();                        // makes the internal checklist PIN if none exists
  Logger.log('Done. ' + FIRST_ADMIN + ' is the first admin. Link the other engineers: write their emails in column A of ' + USERS_TAB + ' (or add them from the Admin screen).');
}

/** Signs every device out (everyone must enter a new code). */
function signOutEveryone() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(k => { if (k.indexOf('sess_') === 0) props.deleteProperty(k); });
  Logger.log('All sessions removed.');
}

/** The old portal link: shows where the app moved. Called from doGet() in Code.gs. */
function movedPage_() {
  const url = String(APP_URL).replace(/"/g, '');
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;max-width:420px;margin:60px auto;text-align:center;color:#0b1f44">' +
    '<h2>' + APP_NAME + ' moved</h2><p>The portal is now an app. Each engineer signs in with their own email.</p>' +
    '<p><a href="' + url + '" target="_top" style="display:inline-block;padding:12px 26px;background:#0b2a5b;color:#ffc61a;border-radius:6px;text-decoration:none;font-weight:bold">Open ' + APP_NAME + '</a></p>' +
    '<p style="color:#6c7b8b;font-size:13px">On your phone: open it, then "Add to Home screen" / "Install".</p>' +
    '<p style="color:#8a94a8;font-size:12px;font-style:italic">architected by Ptah</p></div>')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
