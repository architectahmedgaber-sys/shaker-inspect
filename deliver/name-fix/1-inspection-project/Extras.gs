/**
 * Extras.gs  -  Shaker Inspect · phase 3 (extras)
 * A NEW file in the same Apps Script project as Api.gs, Code.gs, RecordPdf.gs and Daily.gs.
 *
 *   - Villa board: every villa with its status (open, late, waiting C/D, done) and its history
 *   - Private villa notes, shared between engineers and admins (Viewers do not see them)
 *   - A single request by link (history of all its Revs)
 *   - Monthly leaderboard, per-contractor performance
 *   - Close rules set by the admin (photos / checklist / notes needed before a close)
 *   - Before photos of the previous Rev (for the before / after page in the PDF)
 *   - Admin undo of any close made in the app (30 days) + Trash with restore (30 days)
 *   - Push notifications on the Android app (Firebase): new requests, late requests, comments
 *
 * Run once from the editor:  setupExtras()   -> makes the tabs and 2 timed jobs (every 15 minutes, every night).
 * Push: see SETUP_STEPS_PHASE3.md (Firebase), then the script property FCM_SERVICE_ACCOUNT.
 */

const UNDO_TAB = '_Undo';
const TRASH_TAB = '_Trash';
const NOTES_TAB = '_VillaNotes';
const PUSH_TAB = '_Push';
const UNDO_COLS = ['Id', 'Time', 'Email', 'Engineer', 'CIR No.', 'Rev', 'Code', 'Villa', 'Token', 'State', 'Undo data', 'Close data'];
const TRASH_COLS = ['Id', 'Time', 'By', 'Type', 'Title', 'Data', 'State'];
const NOTES_COLS = ['Id', 'Time', 'Villa', 'Email', 'Engineer', 'Note'];
const PUSH_COLS = ['Email', 'Engineer', 'Token', 'Platform', 'Updated'];
const KEEP_DAYS = 30;              // admin undo window and trash restore window
const PUSH_LATE_HOUR = 9;          // the daily "late requests" push, after this hour
const RULES_DEFAULT = { allMarked: false, minPhotos: 0, minPhotosCD: 0, notesCD: false };

// ---------------- what the app may call ----------------

const EXTRAS_FUNCS_ = {
  extras_bootstrap: (me) => ({
    rules: closeRules_(),
    board: leaderboardOn_() || me.role === 'Admin',
    push: !!PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT'),
    version: 'extras-1'
  }),

  extras_villas: () => villaBoard_(),
  extras_villa: (me, a) => villaDetail_(String(a[0] || ''), me),
  extras_request: (me, a) => requestHistory_(String(a[0] || '')),

  extras_noteAdd: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    const villa = String(a[0] || '').trim(), text = String(a[1] || '').trim().slice(0, 1500);
    if (!villa || !text) throw new Error('Write the note first.');
    tab_(NOTES_TAB, NOTES_COLS).appendRow([Utilities.getUuid().slice(0, 8), new Date(), villa, me.email, me.engineer, text]);
    apiLog_(me, 'villa note', 'Villa ' + villa + ' · ' + text.slice(0, 80));
    return notesOf_(villa);
  },
  extras_noteDel: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    const id = String(a[0] || '');
    const sh = tab_(NOTES_TAB, NOTES_COLS), v = sh.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) {
      if (String(v[i][0]) !== id) continue;
      if (me.role !== 'Admin' && String(v[i][3]).toLowerCase() !== me.email) throw new Error('Only the writer or an admin can delete this note.');
      trashAdd_(me, 'note', 'Villa ' + v[i][2] + ' note by ' + v[i][4] + ': ' + String(v[i][5]).slice(0, 60), { row: v[i].map(x => x instanceof Date ? x.getTime() : x) });
      sh.deleteRow(i + 1);
      apiLog_(me, 'villa note deleted', 'Villa ' + v[i][2]);
      return notesOf_(String(v[i][2]));
    }
    throw new Error('Note not found.');
  },

  extras_leaderboard: (me, a) => {
    if (!leaderboardOn_() && me.role !== 'Admin') throw new Error('The leaderboard is turned off by the admin.');
    return leaderboard_(String(a[0] || '').slice(0, 7) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM'));
  },

  extras_prevPhotos: (me, a) => prevPhotos_(String(a[0] || ''), String(a[1] || '')),

  push_register: (me, a) => {
    const token = String(a[0] || '').trim(), platform = String(a[1] || '').slice(0, 20);
    if (token.length < 20 || token.length > 400) throw new Error('Bad push token.');
    const sh = tab_(PUSH_TAB, PUSH_COLS), v = sh.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) if (String(v[i][2]) === token) sh.deleteRow(i + 1);
    sh.appendRow([me.email, me.engineer, token, platform, new Date()]);
    return true;
  },
  push_unregister: (me, a) => {
    const token = String(a[0] || ''), sh = tab_(PUSH_TAB, PUSH_COLS), v = sh.getDataRange().getValues();
    for (let i = v.length - 1; i >= 1; i--) if (String(v[i][2]) === token && String(v[i][0]).toLowerCase() === me.email) sh.deleteRow(i + 1);
    return true;
  }
};

const EXTRAS_ADMIN_FUNCS_ = {
  admin_perf2: (me, a) => contractorPerf_(Math.min(Math.max(+a[0] || 30, 1), 365)),
  admin_rules: () => ({ rules: closeRules_(), board: leaderboardOn_() }),
  admin_setRules: (me, a) => {
    const r = a[0] || {}, out = {
      allMarked: !!r.allMarked, notesCD: !!r.notesCD,
      minPhotos: Math.min(Math.max(+r.minPhotos || 0, 0), 8), minPhotosCD: Math.min(Math.max(+r.minPhotosCD || 0, 0), 8)
    };
    const p = PropertiesService.getScriptProperties();
    p.setProperty('CLOSE_RULES', JSON.stringify(out));
    if (a[1] != null) p.setProperty('LEADERBOARD', a[1] ? 'on' : 'off');
    apiLog_(me, 'close rules', JSON.stringify(out) + (a[1] != null ? ' · leaderboard ' + (a[1] ? 'on' : 'off') : ''));
    return { rules: out, board: leaderboardOn_() };
  },
  admin_closes: (me, a) => recentCloses_(String(a[0] || '')),
  admin_undoClose: (me, a) => adminUndo_(me, String(a[0] || '')),
  admin_trash: () => trashList_(),
  admin_restore: (me, a) => trashRestore_(me, String(a[0] || '')),
  admin_pushTest: (me) => {
    if (!PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT')) return 'Push is not connected yet: add the Firebase key (setup steps, part D).';
    const n = pushTo_([me.email], 'Shaker Inspect', 'Test notification. Push works on this phone.', { url: '#' });
    return n ? 'Sent to ' + n + ' device' + (n > 1 ? 's' : '') + '.' : 'No phone of yours is registered. Open the Android app, then Me > Notifications.';
  }
};

// ---------------- hooks called from Api.gs ----------------

/** After a close made in the app: keep what is needed to undo it later (30 days). */
function extrasAfterClose_(me, p, res) {
  if (!res || !res.success || res.duplicate || !res.undoToken) return;
  const raw = CacheService.getScriptCache().get('undo_' + res.undoToken);
  if (!raw) return;
  const villa = (p.record && p.record.villa) || '';
  tab_(UNDO_TAB, UNDO_COLS).appendRow([Utilities.getUuid().slice(0, 8), new Date(), me.email, me.engineer, p.irNumber || '', String(p.rev || '0'),
    String(p.code || '').toUpperCase(), villa, res.undoToken, 'live', raw,
    JSON.stringify({ date: p.date || '', notes: String(p.rawNotes || ''), recordUrl: res.recordUrl || '', description: String(p.description || '').slice(0, 300) })]);
}

/** After the engineer's own Undo (10 minutes): the close goes to the Trash, so it can come back. */
function extrasAfterUndo_(me, token) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(UNDO_TAB);
  if (!sh || !token) return;
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) {
    if (String(v[i][8]) !== token || String(v[i][9]) !== 'live') continue;
    sh.getRange(i + 1, 10).setValue('undone');
    trashAdd_(me, 'close', v[i][4] + ' · Rev ' + v[i][5] + ' · Code ' + v[i][6] + ' (' + v[i][3] + ')', { undoId: String(v[i][0]) });
    return;
  }
}

/** After any app call (used for push on comments). */
function extrasAfterCall_(fn, me, args) {
  if (fn !== 'comments_add' || !PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT')) return;
  const ir = String(args[0] || ''), text = String(args[2] || '').slice(0, 120);
  // everyone who wrote in this request, plus the admins, except the writer
  const who = {};
  rowsOf_(COMMENTS_TAB).forEach(r => { if (String(r[1]) === ir) who[String(r[3]).toLowerCase()] = 1; });
  approvedUsers_().forEach(u => { if (u.role === 'Admin') who[u.email] = 1; });
  delete who[me.email];
  const to = Object.keys(who);
  if (to.length) pushTo_(to, '💬 ' + me.engineer + ' · ' + shortIr_(ir), text, { url: '#req=' + encodeURIComponent(ir) });
}

// ---------------- helpers ----------------

function closeRules_() {
  try { return Object.assign({}, RULES_DEFAULT, JSON.parse(PropertiesService.getScriptProperties().getProperty('CLOSE_RULES') || '{}')); }
  catch (e) { return Object.assign({}, RULES_DEFAULT); }
}
function leaderboardOn_() { return PropertiesService.getScriptProperties().getProperty('LEADERBOARD') !== 'off'; }
function shortIr_(ir) { const m = String(ir).match(/(\d+)\D*$/); return m ? m[1] : String(ir); }
function conOf_(ir, name) { const m = String(ir).match(/-(SH|SQ|AT)-/i); return m ? m[1].toUpperCase() : (name || 'Other'); }

const VILLA_RE_ = /\bvillas?\s*(?:villa\s*)?\(?\s*(\d+(?:\s*(?:[,\/&-]|and)\s*\d+)*)\)?(?:\s+type\s+([A-Z0-9()]+))?/i;
/** "Villa 105, 106 Type S02B" -> { nums: ['105','106'], type: 'S02B' }. Ranges up to 10 villas are expanded. */
function villasOf_(text) {
  const m = String(text || '').match(VILLA_RE_);
  if (!m) return { nums: [], type: '' };
  const nums = [];
  m[1].split(/\s*(?:[,\/&]|and)\s*/i).forEach(part => {
    const r = part.split(/\s*-\s*/).map(Number);
    if (r.length === 2 && r[1] > r[0] && r[1] - r[0] <= 10) { for (let k = r[0]; k <= r[1]; k++) nums.push(String(k)); }
    else r.forEach(n => { if (n) nums.push(String(n)); });
  });
  return { nums: nums.filter((x, i) => nums.indexOf(x) === i), type: m[2] ? m[2].toUpperCase() : '' };
}

/** Every row of DailyAction as a request (one per Number + ID + Rev). */
function allRequests_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DailyAction');
  if (!sheet) throw new Error('The DailyAction tab was not found.');
  const COL = getColumns(sheet), data = readDaily(sheet, COL), by = {};
  const tz = Session.getScriptTimeZone();
  for (let i = 1; i < data.length; i++) {
    const r = data[i], ir = cellStr(r[COL.NUMBER]);
    if (!ir && !cellStr(r[COL.ID])) continue;
    const k = rowKey(r, COL), code = cellStr(r[COL.CODE]).toUpperCase();
    const x = by[k] || (by[k] = { ir: ir, id: cellStr(r[COL.ID]), rev: revStr(r[COL.REV]), title: cellStr(r[COL.TITLE]) || cellStr(r[COL.DESC]),
                                  contractor: cellStr(r[COL.CONTRACTOR]), code: '', by: '', date: '', notes: '', sent: '' });
    if (code && !x.code) { x.code = code; x.by = canonEngineer_(cellStr(r[COL.INSPECTOR])); x.date = dayOf_(r[COL.DATE]); x.notes = cellStr(r[COL.NOTES]); }
    if (!x.sent) { const s = parseSheetDate(r[COL.SENT_REVIEW]) || parseSheetDate(r[COL.CREATED]); if (s) x.sent = Utilities.formatDate(s, tz, 'yyyy-MM-dd'); }
  }
  return Object.keys(by).map(k => by[k]);
}

function pdfLinks_() {
  const pdf = {};
  rowsOf_(CLOSES_TAB).forEach(c => { if (c[11]) pdf[String(c[3]) + '__' + String(c[4])] = String(c[11]); });
  return pdf;
}

function notesOf_(villa) {
  const tz = Session.getScriptTimeZone();
  return rowsOf_(NOTES_TAB).filter(r => String(r[2]) === String(villa)).map(r => ({
    id: String(r[0]), t: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, "yyyy-MM-dd'T'HH:mm:ss") : String(r[1]),
    email: String(r[3]), engineer: String(r[4]), text: String(r[5])
  })).reverse();
}

// ---------------- villa board ----------------

function villaBoard_() {
  const open = getDailyActions(), openKey = {}, lateIr = {};
  open.forEach(i => {
    openKey[i.irNumber + '__' + i.rev] = 1;
    if (i.overdue || (i.ageDays != null && i.ageDays >= 3)) lateIr[i.irNumber + '__' + i.rev] = 1;
  });
  const waiting = {};
  (reinspectData_().waiting || []).forEach(w => { waiting[w.ir + '__' + w.rev] = 1; });
  const notes = {};
  rowsOf_(NOTES_TAB).forEach(r => { notes[String(r[2])] = (notes[String(r[2])] || 0) + 1; });
  const V = {};
  allRequests_().forEach(x => {
    const vs = villasOf_(x.title);
    vs.nums.forEach(n => {
      const v = V[n] || (V[n] = { v: n, type: '', con: '', open: 0, late: 0, cd: 0, closed: 0, A: 0, B: 0, C: 0, D: 0, last: '', notes: notes[n] || 0 });
      if (vs.type && !v.type) v.type = vs.type;
      if (!v.con) v.con = conOf_(x.ir, x.contractor);
      const k = x.ir + '__' + x.rev;
      if (x.code) { v.closed++; if (v[x.code] != null) v[x.code]++; if (x.date > v.last) v.last = x.date; }
      else if (openKey[k]) { v.open++; if (lateIr[k]) v.late++; }
      if (x.code && waiting[k]) v.cd++;
    });
  });
  return Object.keys(V).map(k => V[k]).sort((a, b) => (+a.v) - (+b.v));
}

function villaDetail_(villa, me) {
  const pdf = pdfLinks_(), open = {}, late = {};
  getDailyActions().forEach(i => { open[i.irNumber + '__' + i.rev] = 1; if (i.overdue || (i.ageDays != null && i.ageDays >= 3)) late[i.irNumber + '__' + i.rev] = 1; });
  const rows = allRequests_().filter(x => villasOf_(x.title).nums.indexOf(villa) >= 0).map(x => ({
    ir: x.ir, rev: x.rev, title: x.title, contractor: x.contractor, con: conOf_(x.ir, x.contractor), code: x.code, by: x.by, date: x.date,
    sent: x.sent, open: !x.code && !!open[x.ir + '__' + x.rev], late: !!late[x.ir + '__' + x.rev], pdf: pdf[x.ir + '__' + x.rev] || ''
  }));
  rows.sort((a, b) => (b.date || b.sent || '').localeCompare(a.date || a.sent || '') || String(b.ir).localeCompare(String(a.ir)));
  return { villa: villa, rows: rows, notes: me.role === 'Viewer' ? null : notesOf_(villa) };
}

function requestHistory_(ir) {
  if (!ir) throw new Error('No request number.');
  const pdf = pdfLinks_(), open = {};
  getDailyActions().forEach(i => { open[i.irNumber + '__' + i.rev] = 1; });
  const revs = allRequests_().filter(x => x.ir === ir).map(x => ({
    ir: x.ir, rev: x.rev, title: x.title, contractor: x.contractor, code: x.code, by: x.by, date: x.date, notes: x.notes, sent: x.sent,
    open: !x.code && !!open[x.ir + '__' + x.rev], pdf: pdf[x.ir + '__' + x.rev] || ''
  })).sort((a, b) => (+b.rev) - (+a.rev));
  if (!revs.length) throw new Error('Request ' + ir + ' was not found in the sheet.');
  return { ir: ir, villas: villasOf_(revs[0].title).nums, revs: revs };
}

// One spelling per engineer: "Mohamed AbdelAziz" and "Mohamed Abdelaziz" are the same person.
// The spelling in tab _Users wins; a name that is not in _Users is kept as typed.
function canonEngineer_(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) return '';
  if (!canonEngineer_.map) {
    canonEngineer_.map = {};
    try { readUsers_().forEach(u => { if (u.engineer) canonEngineer_.map[String(u.engineer).trim().replace(/\s+/g, ' ').toLowerCase()] = u.engineer; }); } catch (err) {}
  }
  return canonEngineer_.map[n.toLowerCase()] || n;
}

// ---------------- leaderboard and performance ----------------

function leaderboard_(month) {
  const per = {};
  allRequests_().forEach(x => {
    if (!x.code || !x.by || String(x.date).slice(0, 7) !== month) return;
    const e = per[x.by] || (per[x.by] = { engineer: x.by, n: 0, A: 0, B: 0, C: 0, D: 0, days: {} });
    e.n++; if (e[x.code] != null) e[x.code]++; e.days[x.date] = 1;
  });
  const rows = Object.keys(per).map(k => { const e = per[k]; e.activeDays = Object.keys(e.days).length; delete e.days; return e; })
    .sort((a, b) => b.n - a.n || b.A - a.A || a.engineer.localeCompare(b.engineer));
  return { month: month, rows: rows, total: rows.reduce((s, e) => s + e.n, 0) };
}

function contractorPerf_(days) {
  const tz = Session.getScriptTimeZone(), from = Utilities.formatDate(new Date(Date.now() - days * 864e5), tz, 'yyyy-MM-dd');
  const C = {};
  const get = name => C[name] || (C[name] = { name: name, n: 0, A: 0, B: 0, C: 0, D: 0, waitSum: 0, waitN: 0, open: 0, late: 0 });
  allRequests_().forEach(x => {
    if (!x.code || !x.date || x.date < from) return;
    const c = get(x.contractor || conOf_(x.ir, ''));
    c.n++; if (c[x.code] != null) c[x.code]++;
    if (x.sent) { const w = (parseIsoDate(x.date) - parseIsoDate(x.sent)) / 864e5; if (w >= 0 && w < 120) { c.waitSum += w; c.waitN++; } }
  });
  getDailyActions().forEach(i => { const c = get(i.contractor || conOf_(i.irNumber, '')); c.open++; if (i.overdue || (i.ageDays != null && i.ageDays >= 3)) c.late++; });
  return { days: days, rows: Object.keys(C).map(k => {
    const c = C[k];
    return { name: c.name, n: c.n, A: c.A, B: c.B, C: c.C, D: c.D, cdRate: c.n ? Math.round((c.C + c.D) / c.n * 100) : 0,
             wait: c.waitN ? Math.round(c.waitSum / c.waitN * 10) / 10 : null, open: c.open, late: c.late };
  }).sort((a, b) => b.n - a.n || b.open - a.open) };
}

// ---------------- before photos of the previous Rev ----------------

function prevPhotos_(ir, rev) {
  if (!ir) return [];
  const want = (ir + ' - Rev' + rev + ' - ').replace(/'/g, "\\'");
  const it = DriveApp.searchFiles("title contains '" + want + "' and mimeType = 'image/jpeg' and trashed = false");
  const out = [];
  while (it.hasNext() && out.length < 6) {
    const f = it.next();
    if (f.getName().indexOf(ir + ' - Rev' + rev + ' - ') !== 0 || f.getSize() > 900000) continue;
    out.push({ name: f.getName(), t: f.getDateCreated().getTime(), data: 'data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes()) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------- admin undo + trash ----------------

function recentCloses_(q) {
  const tz = Session.getScriptTimeZone(), from = Date.now() - KEEP_DAYS * 864e5;
  const v = rowsOf_(UNDO_TAB), out = [];
  q = q.toLowerCase();
  for (let i = v.length - 1; i >= 0 && out.length < 150; i--) {
    const r = v[i], t = r[1] instanceof Date ? r[1].getTime() : new Date(r[1]).getTime();
    if (!(t >= from)) break;
    if (String(r[9]) !== 'live') continue;
    if (q && (r[3] + ' ' + r[4] + ' ' + r[7]).toLowerCase().indexOf(q) < 0) continue;
    out.push({ id: String(r[0]), t: Utilities.formatDate(new Date(t), tz, "yyyy-MM-dd'T'HH:mm:ss"), engineer: String(r[3]), ir: String(r[4]),
               rev: String(r[5]), code: String(r[6]), villa: String(r[7]) });
  }
  return out;
}

function undoRow_(id) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(UNDO_TAB);
  if (!sh) return null;
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === id) return { sh: sh, row: i + 1, v: v[i] };
  return null;
}

function adminUndo_(me, id) {
  const u = undoRow_(id);
  if (!u) throw new Error('This close is not in the undo list.');
  if (String(u.v[9]) !== 'live') throw new Error('Already undone.');
  const t = u.v[1] instanceof Date ? u.v[1].getTime() : new Date(u.v[1]).getTime();
  if (Date.now() - t > KEEP_DAYS * 864e5) throw new Error('Older than ' + KEEP_DAYS + ' days.');
  // the same steps as the engineer's own Undo, with the data kept in _Undo
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('undo_' + token, String(u.v[10]), 600);
  const res = undoAction(token);
  if (!res || !res.success) throw new Error((res && res.error) || 'Could not undo.');
  u.sh.getRange(u.row, 10).setValue('undone');
  trashAdd_(me, 'close', u.v[4] + ' · Rev ' + u.v[5] + ' · Code ' + u.v[6] + ' (' + u.v[3] + ')', { undoId: id });
  apiLog_(me, 'admin undo', u.v[4] + ' · Rev ' + u.v[5] + ' · Code ' + u.v[6] + ' closed by ' + u.v[3]);
  return res.message || 'Undone.';
}

function trashAdd_(me, type, title, data) {
  tab_(TRASH_TAB, TRASH_COLS).appendRow([Utilities.getUuid().slice(0, 8), new Date(), me.engineer || me.email, type, String(title).slice(0, 200), JSON.stringify(data), 'in trash']);
}

function trashList_() {
  const tz = Session.getScriptTimeZone(), from = Date.now() - KEEP_DAYS * 864e5;
  return rowsOf_(TRASH_TAB).map(r => {
    const t = r[1] instanceof Date ? r[1].getTime() : new Date(r[1]).getTime();
    return { id: String(r[0]), t: Utilities.formatDate(new Date(t), tz, "yyyy-MM-dd'T'HH:mm:ss"), by: String(r[2]), type: String(r[3]), title: String(r[4]),
             state: String(r[6]), left: Math.max(0, Math.ceil((t + KEEP_DAYS * 864e5 - Date.now()) / 864e5)), ok: t >= from };
  }).filter(x => x.ok && x.state === 'in trash').reverse();
}

function trashRestore_(me, id) {
  const sh = tab_(TRASH_TAB, TRASH_COLS), v = sh.getDataRange().getValues();
  let row = 0, r = null;
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === id) { row = i + 1; r = v[i]; break; }
  if (!r) throw new Error('Not in the trash.');
  if (String(r[6]) !== 'in trash') throw new Error('Already restored.');
  const data = JSON.parse(String(r[5]) || '{}');
  let msg = 'Restored.';
  if (r[3] === 'close') msg = restoreClose_(me, data.undoId);
  else if (r[3] === 'note') {
    const x = data.row;
    tab_(NOTES_TAB, NOTES_COLS).appendRow([x[0], new Date(x[1]), x[2], x[3], x[4], x[5]]);
  } else throw new Error('Cannot restore this kind of item.');
  sh.getRange(row, 7).setValue('restored ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') + ' · ' + me.engineer);
  apiLog_(me, 'restore', String(r[4]));
  return msg;
}

/** Puts an undone close back: the code in DailyAction, the row in the engineer tab, the PDF out of the Drive trash. */
function restoreClose_(me, undoId) {
  const u = undoRow_(undoId);
  if (!u) throw new Error('The close data was not found.');
  const undo = JSON.parse(String(u.v[10])), close = JSON.parse(String(u.v[11]) || '{}');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(), daily = ss.getSheetByName('DailyAction');
    const COL = getColumns(daily), data = readDaily(daily, COL), rows = [];
    for (let i = 1; i < data.length; i++) {
      if (rowKey(data[i], COL) !== undo.key) continue;
      if (cellStr(data[i][COL.CODE]) !== '') throw new Error('This request was closed again meanwhile (Code ' + cellStr(data[i][COL.CODE]) + ' by ' + cellStr(data[i][COL.INSPECTOR]) + ').');
      rows.push(i + 1);
    }
    if (!rows.length) throw new Error('This request is no longer in DailyAction.');
    const newUndo = { key: undo.key, code: undo.code, inspector: undo.inspector, rows: [], eng: null, recordId: undo.recordId || '' };
    rows.forEach(r => {
      const old = data[r - 1];
      newUndo.rows.push({ r: r, date: old[COL.DATE] instanceof Date ? { d: old[COL.DATE].getTime() } : old[COL.DATE], insp: old[COL.INSPECTOR], code: old[COL.CODE], notes: old[COL.NOTES] });
      daily.getRange(r, COL.DATE + 1).setValue(close.date || '');
      writeActionCells(daily, r, COL, undo.inspector, undo.code, close.notes || '');
    });
    let recordUrl = '';
    if (undo.recordId) { try { const f = DriveApp.getFileById(undo.recordId); f.setTrashed(false); recordUrl = f.getUrl(); } catch (e) {} }
    const eng = undo.inspector ? findEngineerSheet(ss, undo.inspector) : null;
    if (eng) {
      const d = parseIsoDate(close.date), activity = undo.eng ? undo.eng.activity : extractEntities(close.description || '').activity;
      const label = CODE_LABELS[undo.code] || undo.code, num = undo.key.split('__')[0], rev = undo.key.split('__')[2] || '0';
      const target = eng.getLastRow() + 1;
      eng.getRange(target, 1, 1, 6).setValues([[d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE, dd/MM/yyyy') : close.date, activity, '', rev, label, close.notes || '']]);
      const src = daily.getRange(rows[0], COL.NUMBER + 1), f = src.getFormula(), rt = src.getRichTextValue();
      if (f) eng.getRange(target, 3).setFormula(f); else if (rt && rt.getLinkUrl()) eng.getRange(target, 3).setRichTextValue(rt); else eng.getRange(target, 3).setValue(num);
      if (recordUrl) eng.getRange(target, RECORD_LINK_COL).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('PDF').setLinkUrl(recordUrl).build());
      newUndo.eng = { sheet: eng.getName(), row: target, activity: activity, label: label };
    }
    SpreadsheetApp.flush();
    u.sh.getRange(u.row, 10, 1, 2).setValues([['live', JSON.stringify(newUndo)]]);
    return 'Restored: ' + num_(undo.key) + ' is closed again as Code ' + undo.code + ' by ' + undo.inspector + '.';
  } finally { lock.releaseLock(); }
}
function num_(key) { return String(key).split('__')[0]; }

// ---------------- push notifications (Firebase Cloud Messaging) ----------------

/** Access token for FCM from the service account kept in the script property FCM_SERVICE_ACCOUNT. */
function fcmAuth_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const cache = CacheService.getScriptCache(), hit = cache.get('fcm_token');
  if (hit) return { token: hit, project: sa.project_id };
  const now = Math.floor(Date.now() / 1000);
  const enc = o => Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, '');
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }
  });
  const o = JSON.parse(res.getContentText());
  if (!o.access_token) throw new Error('Firebase sign-in failed: ' + res.getContentText().slice(0, 200));
  cache.put('fcm_token', o.access_token, 3000);
  return { token: o.access_token, project: sa.project_id };
}

/** Sends one notification to every registered phone of these emails. Returns how many phones got it. */
function pushTo_(emails, title, body, data) {
  const auth = fcmAuth_();
  if (!auth) return 0;
  const want = {}; emails.forEach(e => { want[String(e).toLowerCase()] = 1; });
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PUSH_TAB);
  if (!sh || sh.getLastRow() < 2) return 0;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  const targets = v.map((r, i) => ({ email: String(r[0]).toLowerCase(), token: String(r[2]), row: i + 2 })).filter(r => want[r.email] && r.token);
  if (!targets.length) return 0;
  const url = 'https://fcm.googleapis.com/v1/projects/' + auth.project + '/messages:send';
  const reqs = targets.map(t => ({
    url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + auth.token },
    payload: JSON.stringify({ message: { token: t.token, notification: { title: String(title).slice(0, 120), body: String(body).slice(0, 400) },
      data: Object.keys(data || {}).reduce((o, k) => { o[k] = String(data[k]); return o; }, {}),
      android: { priority: 'high', notification: { icon: 'ic_launcher', color: '#0b2a5b', tag: (data && data.tag) || undefined } } } })
  }));
  let sent = 0;
  const dead = [];
  UrlFetchApp.fetchAll(reqs).forEach((res, i) => {
    const c = res.getResponseCode();
    if (c === 200) sent++;
    else if (c === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(res.getContentText())) dead.push(targets[i].row);
  });
  dead.sort((a, b) => b - a).forEach(r => { try { sh.deleteRow(r); } catch (e) {} });
  return sent;
}

/** Timed job (every 15 minutes): new requests -> push to engineers and admins; once a day: late requests to each engineer. */
function extrasEvery15() {
  if (!PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT')) return;
  const items = getDailyActions();
  const keys = items.map(i => i.irNumber + '__' + i.itemId + '__' + i.rev);
  const st = tab_('_PushState', ['Open request keys (used by the push job)']);
  const before = String(st.getRange(2, 1).getValue() || '');
  st.getRange(2, 1).setValue(keys.join('\n').slice(0, 49000));
  const users = approvedUsers_().map(u => u.email);
  if (before) {
    const seen = {}; before.split('\n').forEach(k => { seen[k] = 1; });
    const fresh = items.filter((i, n) => !seen[keys[n]]);
    if (fresh.length) {
      const first = fresh[0], v = villasOf_(first.description).nums;
      const body = fresh.length === 1
        ? (v.length ? 'Villa ' + v.join(', ') + ' · ' : '') + String(first.description).replace(/^\S*(?:CIR|MIR)\S*\s*(?:\/|-|–|—|:)\s*/i, '').replace(/^(?:material\s+)?inspection\s+request\s+(?:for\s+)?/i, '').slice(0, 140)
        : fresh.slice(0, 4).map(i => shortIr_(i.irNumber)).join(', ') + (fresh.length > 4 ? ' and ' + (fresh.length - 4) + ' more' : '');
      pushTo_(users, fresh.length === 1 ? '🆕 New request' : '🆕 ' + fresh.length + ' new requests', body,
              fresh.length === 1 ? { url: '#req=' + encodeURIComponent(first.irNumber), tag: 'new' } : { url: '#', tag: 'new' });
    }
  }
  // late requests: once a day after PUSH_LATE_HOUR
  const tz = Session.getScriptTimeZone(), p = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), hour = +Utilities.formatDate(new Date(), tz, 'H');
  if (hour >= PUSH_LATE_HOUR && p.getProperty('PUSH_LATE_DAY') !== day) {
    p.setProperty('PUSH_LATE_DAY', day);
    const late = items.filter(i => i.overdue || (i.ageDays != null && i.ageDays >= 3));
    if (late.length) pushTo_(users, '⚠ ' + late.length + ' late request' + (late.length > 1 ? 's' : ''), items.length + ' open in total. Oldest first in the lists.', { url: '#late', tag: 'late' });
  }
}

/** Timed job (every night): empties the trash and the undo list after 30 days. */
function extrasNightly() {
  const from = Date.now() - KEEP_DAYS * 864e5;
  [UNDO_TAB, TRASH_TAB].forEach(name => {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const v = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
    let n = 0;
    while (n < v.length && (v[n][0] instanceof Date ? v[n][0].getTime() : new Date(v[n][0]).getTime()) < from) n++;
    if (n) sh.deleteRows(2, n);
  });
}

// ---------------- run once from the editor ----------------

/** Makes the tabs and the 2 timed jobs. Safe to run again. */
function setupExtras() {
  tab_(UNDO_TAB, UNDO_COLS); tab_(TRASH_TAB, TRASH_COLS); tab_(NOTES_TAB, NOTES_COLS); tab_(PUSH_TAB, PUSH_COLS);
  ScriptApp.getProjectTriggers().forEach(t => { if (['extrasEvery15', 'extrasNightly'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('extrasEvery15').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('extrasNightly').timeBased().everyDays(1).atHour(3).create();
  UrlFetchApp.getRequest('https://fcm.googleapis.com/');   // asks for the permission to call Firebase
  Logger.log('Done: tabs ' + [UNDO_TAB, TRASH_TAB, NOTES_TAB, PUSH_TAB].join(', ') + ' and 2 timed jobs. Push: ' +
             (PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT') ? 'connected' : 'not connected yet (optional, see the setup steps)'));
}

/** Run from the editor after adding FCM_SERVICE_ACCOUNT: sends a test push to the first admin's phones. */
function testPush() {
  Logger.log('Sent to ' + pushTo_([FIRST_ADMIN], 'Shaker Inspect', 'Test notification from Apps Script.', { url: '#' }) + ' phone(s).');
}
