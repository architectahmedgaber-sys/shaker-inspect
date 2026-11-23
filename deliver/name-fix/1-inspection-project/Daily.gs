/**
 * Daily.gs  -  Shaker Inspect · phase 2 (daily work)
 * A NEW file in the same Apps Script project as Api.gs, Code.gs and RecordPdf.gs.
 *
 *   - Photos of each close saved in Drive (villa folder > Photos)
 *   - _Closes tab: one row per close made in the app (weather, photos, PDF link, offline flag)
 *   - Comments inside each request (_Comments tab)
 *   - Re-inspection tracking (Code C / D waiting for the next Rev), read from DailyAction
 *   - Daily report in one tap (internal copy + one copy per contractor), PDF in Drive
 *   - Engineer signature (drawn with a finger) kept per person (_Signatures tab)
 *   - Morning email, overdue reminder (admins), daily backup of the sheet (keeps the last 30)
 *
 * Run once from the editor:  setupDaily()   -> makes the tabs and the 3 timed jobs, asks for the permissions.
 */

const CLOSES_TAB = '_Closes';
const COMMENTS_TAB = '_Comments';
const SIGN_TAB = '_Signatures';
const CLOSES_COLS = ['Time', 'Email', 'Engineer', 'CIR No.', 'Rev', 'ACC ID', 'Code', 'Contractor', 'Villa', 'Description', 'Inspection date', 'PDF', 'Photos', 'Weather', 'Made offline at'];
const BACKUP_FOLDER = 'Shaker Inspect - Backups';
const REPORT_FOLDER = 'Shaker Inspect - Daily Reports';
const BACKUP_KEEP = 30;
const MORNING_HOUR = 7;      // morning email (script time zone)
const REMINDER_HOUR = 13;    // overdue reminder to admins
const BACKUP_HOUR = 2;       // daily backup
const LATE_REMIND_DAYS = 3;  // the reminder lists requests waiting this many days or more

// ---------------- what the app may call ----------------

const DAILY_FUNCS_ = {
  // one call after the list loads: comment counts, re-inspection info, my signature
  daily_bootstrap: (me) => ({
    comments: commentCounts_(),
    reinspect: reinspectData_(),
    signature: signatureOf_(me.email),
    mail: mailOn_(me.email)
  }),

  checklists_bulk: (me, a) => checklistsBulk_(a[0] || []),

  comments_list: (me, a) => commentsOf_(String(a[0] || '')),
  comments_add: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    const ir = String(a[0] || '').trim(), rev = String(a[1] || '0'), text = String(a[2] || '').trim().slice(0, 1000);
    if (!ir || !text) throw new Error('Write the comment first.');
    tab_(COMMENTS_TAB, ['Time', 'CIR No.', 'Rev', 'Email', 'Engineer', 'Role', 'Comment']).appendRow([new Date(), ir, rev, me.email, me.engineer, me.role, text]);
    apiLog_(me, 'comment', ir + ' · ' + text.slice(0, 80));
    notifyComment_(me, ir, rev, text);
    return commentsOf_(ir);
  },

  reinspect_list: () => reinspectData_(),

  signature_set: (me, a) => {
    const png = String(a[0] || '');
    if (png && !/^data:image\/png;base64,/.test(png)) throw new Error('Bad signature image.');
    if (png.length > 45000) throw new Error('The signature is too big. Clear it and draw it again.');
    const sh = tab_(SIGN_TAB, ['Email', 'Engineer', 'Signature (PNG)', 'Updated']);
    const v = sh.getDataRange().getValues();
    for (let i = 1; i < v.length; i++) {
      if (String(v[i][0]).toLowerCase() === me.email) { sh.getRange(i + 1, 2, 1, 3).setValues([[me.engineer, png, new Date()]]); return true; }
    }
    sh.appendRow([me.email, me.engineer, png, new Date()]);
    return true;
  },

  mail_set: (me, a) => {
    const p = PropertiesService.getScriptProperties();
    if (a[0]) p.deleteProperty('nomail_' + me.email); else p.setProperty('nomail_' + me.email, '1');
    return mailOn_(me.email);
  },

  // a link anyone can open, for sending a PDF on WhatsApp
  share_link: (me, a) => {
    const m = String(a[0] || '').match(/[-\w]{25,}/);
    if (!m) throw new Error('No file.');
    const f = DriveApp.getFileById(m[0]);
    const okFolder = [RECORD_ROOT_FOLDER, REPORT_FOLDER];
    let p = f.getParents(), inside = false;
    // only inspection records and daily reports can be shared
    while (p.hasNext() && !inside) {
      let folder = p.next();
      for (let k = 0; k < 4 && folder; k++) {
        if (okFolder.indexOf(folder.getName()) >= 0) { inside = true; break; }
        const up = folder.getParents(); folder = up.hasNext() ? up.next() : null;
      }
    }
    if (!inside) throw new Error('This file cannot be shared from the app.');
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    apiLog_(me, 'share link', f.getName());
    return f.getUrl();
  },

  report_contractors: (me, a) => closesOn_(String(a[0] || today_())).contractors,
  report_daily: (me, a) => dailyReport_(me, String(a[0] || today_()), String(a[1] || ''))
};

const DAILY_ADMIN_FUNCS_ = {
  admin_jobs: () => {
    const t = ScriptApp.getProjectTriggers().map(x => x.getHandlerFunction());
    const p = PropertiesService.getScriptProperties();
    return {
      morning: t.indexOf('dailyMorningEmail') >= 0, reminder: t.indexOf('dailyOverdueReminder') >= 0, backup: t.indexOf('dailyBackup') >= 0,
      lastBackup: p.getProperty('LAST_BACKUP') || '', lastMorning: p.getProperty('LAST_MORNING') || '',
      quota: MailApp.getRemainingDailyQuota()
    };
  },
  admin_morningTest: (me) => { sendMorningTo_(me, morningData_()); return 'Sent to ' + me.email; },
  admin_backupNow: () => dailyBackup()
};

// ---------------- after a close (called from Api.gs) ----------------

/** Photos to Drive + one row in _Closes. Never stops the close: errors are only logged. */
function dailyAfterClose_(me, p, res) {
  const tz = Session.getScriptTimeZone();
  let saved = 0;
  const photos = Array.isArray(p.photos) ? p.photos.slice(0, 12) : [];
  const villa = (p.record && p.record.villa) || p.villa || '';
  if (photos.length) {
    try {
      const folder = getOrMakeFolder_(recordFolder_(villa), 'Photos');
      photos.forEach((ph, i) => {
        const bytes = Utilities.base64Decode(String(ph.base64 || '').replace(/^data:[^,]*,/, ''));
        if (bytes.length < 200) return;
        const name = [p.irNumber || 'CIR', 'Rev' + (p.rev || '0'), 'photo ' + (i + 1)].join(' - ') + '.jpg';
        folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name.replace(/[\\/:*?"<>|]/g, '-')));
        saved++;
      });
    } catch (e) { apiLog_(me, 'photos failed', String(e && e.message || e)); }
  }
  try {
    tab_(CLOSES_TAB, CLOSES_COLS).appendRow([
      new Date(), me.email, me.engineer, p.irNumber || '', String(p.rev || '0'), p.itemId || '', p.code || '',
      p.contractor || '', villa, String(p.description || '').slice(0, 300), p.date || '',
      res.recordUrl || '', saved, String(p.weather || '').slice(0, 120),
      p.madeAt ? Utilities.formatDate(new Date(p.madeAt), tz, 'yyyy-MM-dd HH:mm') : ''
    ]);
  } catch (e) { console.warn('closes row failed: ' + e); }
  return saved;
}

// ---------------- helpers ----------------

function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function tab_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); }
  return sh;
}

function rowsOf_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function dayOf_(v) {
  const d = parseSheetDate(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function mailOn_(email) { return !PropertiesService.getScriptProperties().getProperty('nomail_' + email); }

function signatureOf_(email) {
  const v = rowsOf_(SIGN_TAB);
  for (let i = 0; i < v.length; i++) if (String(v[i][0]).toLowerCase() === email) return String(v[i][2] || '');
  return '';
}

// ---------------- checklists for offline use ----------------

/** items: [{ specNo, description }] -> { keys: [code per item], sections: { code: checklist } } */
function checklistsBulk_(items) {
  const keys = [], sections = {};
  items.slice(0, 400).forEach(it => {
    const r = resolveSection_(it.specNo || '', it.description || '');
    keys.push(r.code || '');
    if (r.code && !sections[r.code]) {
      const cl = getChecklistByCode(r.code);
      if (cl) sections[r.code] = cl;
    }
    if (r.code && sections[r.code]) keys[keys.length - 1] = r.code + '|' + r.by;
  });
  return { keys: keys, sections: sections };
}

// ---------------- comments ----------------

function commentsOf_(ir) {
  const tz = Session.getScriptTimeZone();
  return rowsOf_(COMMENTS_TAB).filter(r => String(r[1]) === ir).map(r => ({
    t: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, "yyyy-MM-dd'T'HH:mm:ss") : String(r[0]),
    rev: String(r[2]), email: String(r[3]), engineer: String(r[4]), role: String(r[5]), text: String(r[6])
  }));
}

function commentCounts_() {
  const out = {};
  rowsOf_(COMMENTS_TAB).forEach(r => { const k = String(r[1]); out[k] = (out[k] || 0) + 1; });
  return out;
}

// an admin writes -> the engineers who already wrote on it get an email; an engineer writes -> the admins
function notifyComment_(me, ir, rev, text) {
  try {
    const others = {};
    commentsOf_(ir).forEach(c => { if (c.email && c.email !== me.email) others[c.email] = 1; });
    let to = Object.keys(others);
    if (me.role !== 'Admin') {
      readUsers_().forEach(u => { const s = userState_(u.email); if (u.email && u.email !== me.email && s.role === 'Admin' && s.status === 'approved') to.push(u.email); });
    }
    to = to.filter((x, i) => to.indexOf(x) === i && mailOn_(x));
    if (!to.length) return;
    mailTo_(to.join(','), 'Comment on ' + ir + ' · Rev ' + rev,
      '<p><b>' + esc_(me.engineer) + '</b> wrote on <b>' + esc_(ir) + ' · Rev ' + esc_(rev) + '</b>:</p>' +
      '<blockquote style="border-left:3px solid #f5b800;margin:8px 0;padding:6px 12px;color:#0b1f44" dir="auto">' + esc_(text) + '</blockquote>' +
      '<p style="color:#6c7b8b;font-size:13px">Open the app to answer.</p>');
  } catch (e) { console.warn('comment mail failed: ' + e); }
}

// ---------------- re-inspection (Code C / D waiting for the next Rev) ----------------

/**
 * From DailyAction: for each request number, the highest Rev decides.
 *   waiting  = the highest Rev is closed with C or D (contractor has not resubmitted yet)
 *   prev     = open requests that are a resubmission: { "<number>": { rev, code, by, date } } of the Rev before
 */
function reinspectData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DailyAction');
  if (!sheet) return { waiting: [], prev: {} };
  const COL = getColumns(sheet);
  const data = readDaily(sheet, COL);
  const tz = Session.getScriptTimeZone(), todayNum = dayNumber(new Date(), tz);
  const byNum = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i], num = cellStr(r[COL.NUMBER]);
    if (!num) continue;
    const rev = Number(revStr(r[COL.REV])) || 0, code = cellStr(r[COL.CODE]).toUpperCase();
    const g = (byNum[num] = byNum[num] || {});
    const cur = g[rev] || (g[rev] = { rev: rev, code: '', by: '', date: '', title: '', contractor: '' });
    if (code && !cur.code) {
      cur.code = code; cur.by = canonEngineer_(cellStr(r[COL.INSPECTOR])); cur.date = dayOf_(r[COL.DATE]);
    }
    if (!cur.title) cur.title = cellStr(r[COL.TITLE]) || cellStr(r[COL.DESC]);
    if (!cur.contractor) cur.contractor = cellStr(r[COL.CONTRACTOR]);
  }
  const waiting = [], prev = {};
  Object.keys(byNum).forEach(num => {
    const g = byNum[num], revs = Object.keys(g).map(Number).sort((a, b) => a - b);
    const top = g[revs[revs.length - 1]];
    if (/^[CD]$/.test(top.code)) {
      const d = parseSheetDate(top.date);
      waiting.push({ ir: num, rev: String(top.rev), code: top.code, by: top.by, date: top.date, title: top.title, contractor: top.contractor,
                     days: d ? Math.max(0, todayNum - dayNumber(d, tz)) : null });
    }
    if (!top.code && revs.length > 1) {
      const b = g[revs[revs.length - 2]];
      if (b.code) prev[num] = { rev: String(b.rev), code: b.code, by: b.by, date: b.date };
    }
  });
  waiting.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { waiting: waiting.slice(0, 300), prev: prev };
}

// ---------------- daily report (one tap) ----------------

/** All closes of one day, from DailyAction (closes made in the app AND in the sheet). */
function closesOn_(day) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DailyAction');
  if (!sheet) throw new Error('The DailyAction tab was not found.');
  const COL = getColumns(sheet), data = readDaily(sheet, COL), seen = {}, rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i], code = cellStr(r[COL.CODE]).toUpperCase();
    if (!code || dayOf_(r[COL.DATE]) !== day) continue;
    const key = rowKey(r, COL);
    if (seen[key]) continue;
    seen[key] = 1;
    rows.push({ ir: cellStr(r[COL.NUMBER]), rev: revStr(r[COL.REV]), title: cellStr(r[COL.TITLE]) || cellStr(r[COL.DESC]),
                contractor: cellStr(r[COL.CONTRACTOR]) || 'Other', code: code, by: canonEngineer_(cellStr(r[COL.INSPECTOR])), notes: cellStr(r[COL.NOTES]) });
  }
  // PDF links of the app closes
  const pdf = {};
  rowsOf_(CLOSES_TAB).forEach(c => { if (c[11]) pdf[String(c[3]) + '__' + String(c[4])] = String(c[11]); });
  rows.forEach(x => { x.pdf = pdf[x.ir + '__' + x.rev] || ''; });
  const cons = {};
  rows.forEach(x => { cons[x.contractor] = (cons[x.contractor] || 0) + 1; });
  return { rows: rows, contractors: Object.keys(cons).sort().map(k => ({ name: k, n: cons[k] })) };
}

/** contractor = '' -> internal copy (everything, per engineer, PDF links); else that contractor's copy. */
function dailyReport_(me, day, contractor) {
  const all = closesOn_(day);
  const rows = contractor ? all.rows.filter(r => r.contractor === contractor) : all.rows;
  const nice = Utilities.formatDate(parseIsoDate(day) || new Date(), Session.getScriptTimeZone(), 'EEEE d MMMM yyyy');
  const count = c => rows.filter(r => r.code === c).length;
  const css = 'body{font-family:Arial,sans-serif;color:#0b1f44;font-size:10.5px;margin:0}' +
    'h1{font-size:19px;margin:0 0 2px}h2{font-size:12px;margin:16px 0 6px;color:#1b4a9e;text-transform:uppercase;letter-spacing:1px}' +
    '.sub{color:#556677;margin:0 0 10px}.band{border-bottom:3px solid #f5b800;padding-bottom:8px;margin-bottom:10px}' +
    'table{border-collapse:collapse;width:100%}th{background:#0b2a5b;color:#fff;text-align:left;padding:5px;font-size:9.5px}' +
    'td{border-bottom:1px solid #d9dee6;padding:5px;vertical-align:top}.c{text-align:center;font-weight:bold}' +
    '.A{color:#2e7d4f}.B{color:#1b4a9e}.C{color:#b8561c}.D{color:#c0392b}.k{display:inline-block;border:1px solid #cfd6de;padding:6px 12px;margin:0 6px 6px 0;text-align:center}' +
    '.k b{display:block;font-size:16px}.sig{font-family:"Caveat",cursive;color:#8a94a8;font-size:15px;text-align:right;margin-top:18px}.foot{color:#8a94a8;font-size:9px;margin-top:14px}';
  let h = '<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>';
  h += '<div class="band"><h1>Daily Inspection Report' + (contractor ? ' · ' + esc_(contractor) : '') + '</h1>' +
       '<p class="sub">SouthMED North Coast · Shaker Consultancy Group · ' + esc_(nice) + (contractor ? '' : ' · INTERNAL COPY') + '</p></div>';
  h += '<div><span class="k"><b>' + rows.length + '</b>closed</span><span class="k A"><b>' + count('A') + '</b>Code A</span><span class="k B"><b>' + count('B') +
       '</b>Code B</span><span class="k C"><b>' + count('C') + '</b>Code C</span><span class="k D"><b>' + count('D') + '</b>Code D</span></div>';
  if (!contractor) {
    const per = {};
    rows.forEach(r => { per[r.by || '—'] = (per[r.by || '—'] || 0) + 1; });
    h += '<h2>Per engineer</h2><table><tr><th>Engineer</th><th>Closed</th></tr>' +
         Object.keys(per).sort((a, b) => per[b] - per[a]).map(k => '<tr><td>' + esc_(k) + '</td><td>' + per[k] + '</td></tr>').join('') + '</table>';
    h += '<h2>Per contractor</h2><table><tr><th>Contractor</th><th>Closed</th></tr>' +
         all.contractors.map(c => '<tr><td>' + esc_(c.name) + '</td><td>' + c.n + '</td></tr>').join('') + '</table>';
  }
  h += '<h2>Requests</h2><table><tr><th>#</th><th>CIR No.</th><th>Rev</th><th>Activity</th>' + (contractor ? '' : '<th>Contractor</th>') +
       '<th>Code</th><th>Inspector</th><th>Notes</th>' + (contractor ? '' : '<th>PDF</th>') + '</tr>';
  rows.forEach((r, i) => {
    h += '<tr><td>' + (i + 1) + '</td><td>' + esc_(r.ir) + '</td><td>' + esc_(r.rev) + '</td><td>' + esc_(r.title) + '</td>' +
         (contractor ? '' : '<td>' + esc_(r.contractor) + '</td>') + '<td class="c ' + r.code + '">' + r.code + '</td><td>' + esc_(r.by) +
         '</td><td dir="auto">' + esc_(r.notes) + '</td>' + (contractor ? '' : '<td>' + (r.pdf ? '<a href="' + esc_(r.pdf) + '">PDF</a>' : '') + '</td>') + '</tr>';
  });
  if (!rows.length) h += '<tr><td colspan="9">No requests closed on this day.</td></tr>';
  h += '</table><p class="foot">Made by Shaker Inspect on ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') +
       ' by ' + esc_(me.engineer) + '.</p><p class="sig">architected by Ptah</p></body></html>';
  const name = 'Daily report ' + day + (contractor ? ' - ' + contractor.replace(/[\\/:*?"<>|]/g, '-') : ' - INTERNAL') + '.pdf';
  const blob = HtmlService.createHtmlOutput(h).getBlob().getAs('application/pdf').setName(name);
  const root = getOrMakeFolder_(DriveApp.getRootFolder(), REPORT_FOLDER);
  const folder = getOrMakeFolder_(root, day.slice(0, 7));
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  const f = folder.createFile(blob);
  apiLog_(me, 'daily report', name);
  return { url: f.getUrl(), name: name, base64: Utilities.base64Encode(blob.getBytes()), count: rows.length };
}

// ---------------- morning email + overdue reminder ----------------

function morningData_() {
  const items = getDailyActions();
  const re = reinspectData_();
  const tz = Session.getScriptTimeZone();
  const yday = Utilities.formatDate(new Date(Date.now() - 864e5), tz, 'yyyy-MM-dd');
  let yClosed = [];
  try { yClosed = closesOn_(yday).rows; } catch (e) {}
  const late = items.filter(i => i.overdue || (i.ageDays != null && i.ageDays >= LATE_REMIND_DAYS))
    .sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
  return { items: items, late: late, waiting: re.waiting, yClosed: yClosed, yday: yday };
}

function listHtml_(rows, max) {
  if (!rows.length) return '<p style="color:#2e7d4f">Nothing here.</p>';
  return '<table style="border-collapse:collapse;width:100%;font-size:13px">' + rows.slice(0, max).map(r =>
    '<tr><td style="padding:4px 6px;border-bottom:1px solid #e3e7ec;white-space:nowrap"><b>' + esc_(r.a) + '</b></td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #e3e7ec">' + esc_(r.b) + '</td>' +
    '<td style="padding:4px 6px;border-bottom:1px solid #e3e7ec;color:#c0392b;white-space:nowrap">' + esc_(r.c || '') + '</td></tr>').join('') +
    '</table>' + (rows.length > max ? '<p style="color:#6c7b8b">and ' + (rows.length - max) + ' more.</p>' : '');
}

function sendMorningTo_(u, D) {
  const mine = D.waiting.filter(w => w.by.toLowerCase() === String(u.engineer).toLowerCase());
  const myY = D.yClosed.filter(r => r.by.toLowerCase() === String(u.engineer).toLowerCase());
  const lateRows = D.late.map(i => ({ a: i.irNumber + ' · Rev ' + i.rev, b: i.description, c: i.ageDays != null ? i.ageDays + ' days' : 'overdue' }));
  let inner = '<p>Good morning ' + esc_(String(u.engineer).split(' ')[0]) + '. Today: <b>' + D.items.length + '</b> open requests, <b style="color:#c0392b">' +
              D.late.length + '</b> late.</p>';
  inner += '<p>Yesterday you closed <b>' + myY.length + '</b>.</p>';
  inner += '<h3 style="color:#1b4a9e;margin:16px 0 4px">Late requests</h3>' + listHtml_(lateRows, 15);
  inner += '<h3 style="color:#1b4a9e;margin:16px 0 4px">Your Code C / D waiting for the contractor</h3>' +
           listHtml_(mine.map(w => ({ a: w.ir + ' · Rev ' + w.rev, b: 'Code ' + w.code + ' · ' + w.title, c: w.days != null ? w.days + ' days' : '' })), 10);
  if (u.role === 'Admin') {
    const per = {}, con = {};
    D.yClosed.forEach(r => { per[r.by || '—'] = (per[r.by || '—'] || 0) + 1; });
    D.items.forEach(i => { const k = i.contractor || 'Other'; con[k] = con[k] || { o: 0, l: 0 }; con[k].o++; if (i.overdue) con[k].l++; });
    inner += '<h3 style="color:#1b4a9e;margin:16px 0 4px">Team, yesterday (' + D.yClosed.length + ' closed)</h3>' +
             listHtml_(Object.keys(per).sort((a, b) => per[b] - per[a]).map(k => ({ a: k, b: per[k] + ' closed' })), 20);
    inner += '<h3 style="color:#1b4a9e;margin:16px 0 4px">Open per contractor</h3>' +
             listHtml_(Object.keys(con).map(k => ({ a: k, b: con[k].o + ' open', c: con[k].l ? con[k].l + ' late' : '' })), 20);
    inner += '<p>All Code C / D waiting for resubmission: <b>' + D.waiting.length + '</b>.</p>';
  }
  mailTo_(u.email, 'Good morning · ' + D.late.length + ' late, ' + D.items.length + ' open', inner);
}

function approvedUsers_() {
  dropUsersCache_();
  return readUsers_().filter(u => u.email).map(u => Object.assign({}, u, userState_(u.email)))
    .filter(u => u.status === 'approved' && (u.role === 'Admin' || u.role === 'Engineer'));
}

/** Timed job (every morning). */
function dailyMorningEmail() {
  const D = morningData_();
  approvedUsers_().forEach(u => { if (mailOn_(u.email)) { try { sendMorningTo_(u, D); } catch (e) { console.warn(u.email + ': ' + e); } } });
  PropertiesService.getScriptProperties().setProperty('LAST_MORNING', new Date().toISOString());
}

/** Timed job (early afternoon): admins get the late list, only when something is late. */
function dailyOverdueReminder() {
  const D = morningData_();
  if (!D.late.length) return;
  const rows = D.late.map(i => ({ a: i.irNumber + ' · Rev ' + i.rev, b: (i.contractor ? i.contractor + ' · ' : '') + i.description, c: i.ageDays != null ? i.ageDays + ' days' : 'overdue' }));
  approvedUsers_().filter(u => u.role === 'Admin' && mailOn_(u.email)).forEach(u => {
    try { mailTo_(u.email, 'Reminder · ' + D.late.length + ' late requests', '<p>These requests are still open and late:</p>' + listHtml_(rows, 40)); } catch (e) {}
  });
}

// ---------------- daily backup ----------------

/** Timed job (night): a copy of the whole sheet in Drive > "Shaker Inspect - Backups". Keeps the last 30. */
function dailyBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const folder = getOrMakeFolder_(DriveApp.getRootFolder(), BACKUP_FOLDER);
  const name = ss.getName() + ' - backup ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH-mm');
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); files.push({ f: f, t: f.getDateCreated().getTime() }); }
  files.sort((a, b) => b.t - a.t).slice(BACKUP_KEEP).forEach(x => { try { x.f.setTrashed(true); } catch (e) {} });
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP', new Date().toISOString());
  return name;
}

// ---------------- run once from the editor ----------------

/** Makes the tabs and the 3 timed jobs (morning email 7:00, reminder 13:00, backup 2:00). Safe to run again. */
function setupDaily() {
  tab_(CLOSES_TAB, CLOSES_COLS);
  tab_(COMMENTS_TAB, ['Time', 'CIR No.', 'Rev', 'Email', 'Engineer', 'Role', 'Comment']);
  tab_(SIGN_TAB, ['Email', 'Engineer', 'Signature (PNG)', 'Updated']);
  const want = { dailyMorningEmail: MORNING_HOUR, dailyOverdueReminder: REMINDER_HOUR, dailyBackup: BACKUP_HOUR };
  ScriptApp.getProjectTriggers().forEach(t => { if (want[t.getHandlerFunction()] != null) ScriptApp.deleteTrigger(t); });
  Object.keys(want).forEach(fn => ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(want[fn]).create());
  getOrMakeFolder_(DriveApp.getRootFolder(), BACKUP_FOLDER);
  getOrMakeFolder_(DriveApp.getRootFolder(), REPORT_FOLDER);
  MailApp.getRemainingDailyQuota();
  Logger.log('Done: tabs ' + [CLOSES_TAB, COMMENTS_TAB, SIGN_TAB].join(', ') + ' and 3 daily jobs. Time zone: ' + Session.getScriptTimeZone());
}
