/**
 * Acc.gs  -  Shaker Inspect: upload an ACC "Submittal item summary" export from the app (admins only).
 *
 * One button, two reports. The app reads the .xlsx on the phone and sends its rows here.
 *   - Open requests only  (the daily export)  -> added at the end of the DailyAction tab
 *   - Has "Closed" rows   (the full export)   -> sent to the Villa Handover tracker (CIR_Inbox, through Tracker_Bridge.gs)
 *
 * DailyAction rules (same as the update-daily-action skill):
 *   - every row of the report is added at the end, duplicates and carry-overs included, values exactly as in the Excel
 *   - columns are matched by header name (any order; case, spaces and punctuation do not matter)
 *   - columns the export has but the tab does not are ignored, or added as a new column if the admin ticks it
 *   - columns the tab has but the export does not are left empty; the few the logic needs must exist, else the app
 *     shows a screen to pick them by hand (nothing is ever rejected as "not the usual export")
 *   - Number and ID stay links to ACC
 *   - a new row whose Number + Revision already has an action code in an earlier row gets that row's date, engineer,
 *     code and notes (the latest earlier row that has a code); a new Revision stays empty (pending)
 *   - nothing else in the tab is touched; no formulas, no formatting rules
 *   - a report that is already in the tab (same Numbers, same order, same "Updated at") is refused
 *
 * Paste this file as a new script file named Acc in the inspection project, together with the updated Api.gs.
 */

const ACC_HEADS = ['Number', 'ID', 'Spec #', 'Spec', 'Spec sub section', 'Priority', 'Ball in court', 'Pending action from',
  'Ball in court due date', 'Status', 'Revision', 'Title', 'Type', 'Package #', 'Package', 'Review response(s)', 'Final response',
  'Responsible contractor', 'Manager', 'Reviewers', 'Watchers', 'Sent to submitter', 'Submitter due date', 'Received from submitter',
  'Submit days off', 'Manager due date', 'Sent for review', 'Received from review', 'Published', 'Required Date',
  'Required approval date', 'Required on job site date', 'Lead time (days)', 'Created at', 'Created by', 'Updated at', 'Updated by', 'Description'];
const ACC_DATE_HEADS = ['Ball in court due date', 'Sent to submitter', 'Submitter due date', 'Received from submitter', 'Manager due date',
  'Sent for review', 'Received from review', 'Published', 'Required Date', 'Required approval date', 'Required on job site date',
  'Created at', 'Updated at'];
// the columns the DailyAction logic cannot work without; the tracker also needs its 17 fields and Type (see accReport_)
const ACC_REQUIRED_DAILY = ['Number', 'Revision', 'Status', 'Updated at'];
// the 17 fields the tracker keeps (same order as SYNC.FIELDS in the tracker's Code.gs)
const ACC_TRACKER_FIELDS = ['Number', 'Status', 'Revision', 'Title', 'Final response', 'Ball in court', 'Ball in court due date', 'Sent for review',
  'Received from review', 'Created at', 'Updated at', 'Description', 'Spec', 'Package', 'Created by', 'Responsible contractor', 'Required approval date'];
const ACC_TRACKER_TYPE = 'Work Inspection Request (WIR) (ARC)';
const ACC_LINK_BLUE = '#1155cc';

const ACC_ADMIN_FUNCS_ = {
  admin_accCheck:        (me, a) => accCheck_(me, a[0], a[1] || {}),
  admin_accSaveDaily:    (me, a) => accSaveDaily_(me, a[0], a[1], a[2] || {}),
  admin_accLast:         () => accLast_(),
  admin_accUndoDaily:    (me) => accUndoDaily_(me),
  admin_accTrackerPush:  (me, a) => {
    const rows = Array.isArray(a[0]) ? a[0] : [];
    if (!rows.length || rows.length > 200) throw new Error('Send between 1 and 200 rows at a time.');
    const r = trackerCall_('accPush', [rows], me);
    apiLog_(me, 'ACC tracker update', rows.length + ' requests sent' + (a[1] ? ' · ' + String(a[1]).slice(0, 80) : ''));
    return r;
  },
  admin_accTrackerState: (me, a) => trackerCall_('accState', [Number(a[0]) || 0, false], me)
};

// ---------------------------------------------------------------- reading the report sent by the app

/** Header text compared loosely: case, spaces and punctuation do not matter ("Spec #" = "spec no", "Review response(s)" = "review responses"). */
const accNorm_ = s => String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').replace(/#/g, ' number ').replace(/[^a-z0-9\u0600-\u06ff]+/g, '');

/**
 * Matches the export's header row to the known ACC names, by name, any order.
 * `map` (from the "pick the column" screen) overrides: { 'Final response': 7 } = file column 7, -1 = leave empty.
 * Never throws. Returns { idx: name -> file position (known names AND the file's own extra names),
 *   extra: [names the app does not know], missing: [known names not in the file], dups: [...], sameOrder }.
 */
function accHeads_(head, map) {
  map = map || {};
  const got = (head || []).map(h => String(h == null ? '' : h).replace(/\s+/g, ' ').trim());
  const have = got.map(accNorm_);
  const idx = {}, used = {}, missing = [], dups = [];
  ACC_HEADS.forEach(h => {
    let p = -1;
    if (map[h] !== undefined && map[h] !== null) p = Number(map[h]);
    else { p = have.indexOf(accNorm_(h)); if (p >= 0 && have.indexOf(accNorm_(h), p + 1) >= 0) dups.push(h); }
    if (p >= 0 && p < got.length) { idx[h] = p; used[p] = 1; } else if (!(map[h] !== undefined && Number(map[h]) < 0)) missing.push(h);
  });
  const extra = [];
  got.forEach((h, i) => {
    if (!h || used[i] || !have[i]) return;
    // an extra column that repeats an earlier extra name keeps only the first one
    if (idx[h] === undefined) { idx[h] = i; extra.push(h); }
  });
  return { idx: idx, extra: extra, missing: missing, dups: dups,
           sameOrder: !extra.length && ACC_HEADS.every((h, i) => idx[h] === i) };
}

/** A cell as the app sends it: text, number, true/false, null, or a date { d: Excel serial, s: 'YYYY-MM-DD HH:MM:SS' }. */
const accIsDate_ = v => v !== null && typeof v === 'object' && typeof v.d === 'number';
/** Text of a cell, the way the tracker skill writes it (dates as YYYY-MM-DD HH:MM:SS, whole numbers without .0, spaces evened out). */
function accText_(v) {
  if (v === null || v === undefined) return '';
  if (accIsDate_(v)) return String(v.s || '');
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v).replace(/\s+/g, ' ').trim();
}

function accReport_(p, map) {
  if (!p || !Array.isArray(p.head) || !Array.isArray(p.rows)) throw new Error('No report received. Choose the file again.');
  const h = accHeads_(p.head, map);
  const rows = [], links = [];
  p.rows.forEach((r, i) => {
    if (!Array.isArray(r) || !r.some(v => accText_(v) !== '')) return;          // empty line at the end of the sheet
    rows.push(r); links.push((p.links || [])[i] || []);
  });
  if (!rows.length) throw new Error('The report has no rows.');
  const rep = { name: String(p.name || ''), idx: h.idx, extra: h.extra, dups: h.dups, sameOrder: h.sameOrder, rows: rows, links: links, closed: 0,
                head: (p.head || []).map(x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim()), needMap: [] };
  // known columns the file does not have and the logic cannot do without -> the app asks the admin to pick them
  let need = ACC_REQUIRED_DAILY.filter(n => h.idx[n] === undefined);
  if (!need.length) {
    rep.closed = rows.filter(r => /^closed/i.test(accText_(r[h.idx['Status']]))).length;
    if (rep.closed) need = ACC_TRACKER_FIELDS.concat(['Type']).filter(n => h.idx[n] === undefined);
  }
  rep.needMap = need;
  rep.blank = ACC_HEADS.filter(n => h.idx[n] === undefined && need.indexOf(n) < 0);   // simply left empty
  return rep;
}

/** The "pick the column" answer: what is missing and, for each, the file's columns with a likely one first. */
function accMapPlan_(rep) {
  const used = {}; Object.keys(rep.idx).forEach(k => { if (ACC_HEADS.indexOf(k) >= 0) used[rep.idx[k]] = 1; });
  const cols = rep.head.map((n, i) => ({ pos: i, name: n })).filter(c => c.name);
  return {
    kind: 'map', file: rep.name, missing: rep.needMap.map(n => {
      const nn = accNorm_(n), guess = cols.filter(c => !used[c.pos] && accNorm_(c.name) && (accNorm_(c.name).indexOf(nn) >= 0 || nn.indexOf(accNorm_(c.name)) >= 0))[0];
      return { name: n, guess: guess ? guess.pos : -1 };
    }), columns: cols
  };
}

/** Which report this is: the full export (has Closed rows) goes to the tracker; the open-only export goes to DailyAction. */
function accCheck_(me, p, opt) {
  const rep = accReport_(p, opt.map);
  if (rep.needMap.length) return accMapPlan_(rep);
  if (rep.closed) return accTrackerPlan_(me, rep, opt);
  const plan = accDailyPlan_(rep, null, opt);
  delete plan._carried;
  return plan;
}

// ---------------------------------------------------------------- DailyAction

function accDailySheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DailyAction');
  if (!sheet) throw new Error('The DailyAction tab was not found.');
  return sheet;
}

/** Everything about where and how the report goes into DailyAction. Writes nothing. */
function accDailyState_(rep, opt) {
  opt = opt || {};
  const sheet = accDailySheet_(), ss = sheet.getParent ? sheet.getParent() : SpreadsheetApp.getActiveSpreadsheet();
  const COL = getColumns(sheet);
  const lastCol = Math.max(sheet.getLastColumn(), COL.WIDTH);
  const head = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(accNorm_);
  // every column of the file goes to the tab column with the same (loosely compared) name
  const dest = {}, ignored = [], added = [];
  Object.keys(rep.idx).forEach(name => { const c = head.indexOf(accNorm_(name)); dest[name] = accNorm_(name) ? c : -1; });
  let next = Math.max(lastCol, COL.WIDTH, COL.NOTES + 1);
  Object.keys(rep.idx).forEach(name => {
    if (dest[name] >= 0) return;
    if ((opt.addCols || []).indexOf(name) >= 0) { dest[name] = next++; added.push(name); } else ignored.push(name);
  });
  const noCol = ['Number', 'Revision', 'Updated at'].filter(n => dest[n] === undefined || dest[n] < 0);
  if (noCol.length) throw new Error('The DailyAction tab has no column named: ' + noCol.join(', ') + '. Check row 1 of the tab.');
  const width = Math.max(COL.WIDTH, Math.max.apply(null, Object.keys(dest).map(n => dest[n])) + 1, COL.NOTES + 1);
  const lastRow = sheet.getLastRow();
  const data = lastRow > 1 ? sheet.getRange(1, 1, lastRow, Math.min(width, Math.max(lastCol, 1))).getValues() : [sheet.getRange(1, 1, 1, Math.min(width, Math.max(lastCol, 1))).getValues()[0]];
  data.forEach(r => { while (r.length < width) r.push(''); });
  let end = data.length;                                   // last row with a Number or an ID (1-based)
  while (end > 1 && !cellStr(data[end - 1][COL.NUMBER]) && !cellStr(data[end - 1][COL.ID])) end--;
  let tz = 'Africa/Cairo';
  try { tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone(); } catch (e) { try { tz = Session.getScriptTimeZone(); } catch (e2) {} }
  return { sheet: sheet, COL: COL, dest: dest, width: width, data: data, end: end, tz: tz, ignored: ignored, added: added, lastCol: lastCol };
}

/** "Updated at" as YYYY-MM-DD HH:MM, for comparing the report with the rows already in the tab. */
function accMinute_(v, tz) {
  if (accIsDate_(v)) return String(v.s || '').slice(0, 16);
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
  if (typeof v === 'number') return Utilities.formatDate(new Date(Math.round((v - 25569) * 864e5)), 'UTC', 'yyyy-MM-dd HH:mm');
  return String(v == null ? '' : v).trim();
}

function accDailyPlan_(rep, S, opt) {
  S = S || accDailyState_(rep, opt);
  const C = S.COL, I = rep.idx, data = S.data, k = rep.rows.length;
  const rNum = r => accText_(r[I['Number']]), rRev = r => revStr(accText_(r[I['Revision']])), rUpd = r => accMinute_(r[I['Updated at']], S.tz);

  // the same report added before? (same Numbers in the same order, same Revision and Updated at)
  let already = null;
  const first = rNum(rep.rows[0]);
  for (let s = 1; s + k <= S.end && !already; s++) {
    if (cellStr(data[s][C.NUMBER]) !== first) continue;
    let same = true;
    for (let j = 0; j < k && same; j++) {
      const t = data[s + j], r = rep.rows[j];
      same = cellStr(t[C.NUMBER]) === rNum(r) && revStr(t[C.REV]) === rRev(r) &&
             accMinute_(t[S.dest['Updated at']], S.tz) === rUpd(r);
    }
    if (same) already = { from: s + 1, to: s + k };
  }

  // carry-over: latest earlier row with the same Number + Revision AND an action code
  const src = {}, revs = {};
  for (let i = 1; i < S.end; i++) {
    const n = cellStr(data[i][C.NUMBER]);
    if (!n) continue;
    const key = n + '|' + revStr(data[i][C.REV]);
    (revs[n] = revs[n] || {})[key] = 1;
    if (cellStr(data[i][C.CODE])) src[key] = i;
  }
  const carried = [], pending = [];
  rep.rows.forEach((r, j) => {
    const i = src[rNum(r) + '|' + rRev(r)];
    if (i !== undefined) {
      const t = data[i];
      carried.push({ j: j, src: i + 1, num: rNum(r), rev: rRev(r), code: cellStr(t[C.CODE]), by: cellStr(t[C.INSPECTOR]),
                     date: t[C.DATE], notes: t[C.NOTES], inspector: t[C.INSPECTOR], codeRaw: t[C.CODE] });
    } else {
      const had = revs[rNum(r)] || {};
      pending.push({ num: rNum(r), rev: rRev(r), kind: had[rNum(r) + '|' + rRev(r)] ? 'still' : Object.keys(had).length ? 'rev' : 'new' });
    }
  });
  const noLink = rep.links.filter(l => !(l && l[0])).length;
  return {
    kind: 'daily', file: rep.name, rows: k, startRow: S.end + 1, endRow: S.end + k, lastOldRow: S.end,
    sameOrder: rep.sameOrder, already: already, noLink: noLink,
    ignored: S.ignored, added: S.added, blank: rep.blank || [], dups: rep.dups || [],
    carried: carried.map(c => ({ num: c.num, rev: c.rev, code: c.code, by: c.by, from: c.src })),
    pending: pending.length, newRequests: pending.filter(x => x.kind === 'new').length,
    resubmissions: pending.filter(x => x.kind === 'rev').length, stillOpen: pending.filter(x => x.kind === 'still').length,
    _carried: carried
  };
}

/** A value the sheet must keep as text gets a leading apostrophe (e.g. 042200, 1/2, =x). */
function accTextCell_(s) {
  s = String(s);
  if (!s) return '';
  return /^[=+\-@']/.test(s) || /^[\d\s.,:\/%()$-]+$/.test(s) || /^\d+(\.\d+)?e[+-]?\d+$/i.test(s) || /^(true|false)$/i.test(s) ? "'" + s : s;
}
function accCell_(v) {
  if (v === null || v === undefined) return '';
  if (accIsDate_(v)) return v.d;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return accTextCell_(v);
}

function accSaveDaily_(me, p, expectStart, opt) {
  opt = opt || {};
  const rep = accReport_(p, opt.map);
  if (rep.needMap.length) throw new Error('These columns are not in the file: ' + rep.needMap.join(', ') + '. Nothing was written. Choose the file again and pick the columns.');
  if (rep.closed) throw new Error('This report has Closed requests: it is the full export for the Handover tracker, not for DailyAction. Nothing was written.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const S = accDailyState_(rep, opt), plan = accDailyPlan_(rep, S, opt), C = S.COL, I = rep.idx, k = rep.rows.length;
    if (plan.already) throw new Error('This report is already in DailyAction (rows ' + plan.already.from + '-' + plan.already.to + '). Nothing was written.');
    if (expectStart && Number(expectStart) !== plan.startRow)
      throw new Error('DailyAction changed since the preview (it now ends at row ' + plan.lastOldRow + '). Check the file again, then save.');
    const sheet = S.sheet, at = plan.startRow;
    const need = at + k - 1 - sheet.getMaxRows();
    if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need);

    // values, in the tab's own column order
    const out = rep.rows.map(r => {
      const row = []; for (let c = 0; c < S.width; c++) row.push('');
      Object.keys(I).forEach(hd => { if (S.dest[hd] >= 0) row[S.dest[hd]] = accCell_(r[I[hd]]); });
      return row;
    });
    const fmtA = sheet.getRange(1, C.DATE + 1, Math.max(S.end, 1), 1).getNumberFormats();
    const aFormats = out.map(() => [null]);
    plan._carried.forEach(c => {
      const row = out[c.j];
      row[C.DATE] = c.date === undefined ? '' : c.date;
      row[C.INSPECTOR] = c.inspector; row[C.CODE] = c.codeRaw; row[C.NOTES] = c.notes;
      aFormats[c.j] = [(fmtA[c.src - 1] || [null])[0]];
    });
    if (S.added.length) {                                  // new columns the admin asked for: header first (copies the look of the last header cell)
      const need2 = S.width - sheet.getMaxColumns();
      if (need2 > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), need2);
      S.added.forEach(n => {
        const hc = sheet.getRange(1, S.dest[n] + 1);
        try { sheet.getRange(1, S.lastCol).copyTo(hc, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) {}
        hc.setValue(n);
      });
    }
    sheet.getRange(at, 1, k, S.width).setValues(out);

    // dates as m/d/yyyy (only the columns that came as dates)
    ACC_DATE_HEADS.forEach(hd => {
      if (I[hd] !== undefined && S.dest[hd] >= 0 && rep.rows.some(r => accIsDate_(r[I[hd]]))) sheet.getRange(at, S.dest[hd] + 1, k, 1).setNumberFormat('m/d/yyyy');
    });
    // the carried date keeps the format of the row it came from
    plan._carried.forEach(c => { const f = aFormats[c.j][0]; if (f) sheet.getRange(at + c.j, C.DATE + 1).setNumberFormat(f); });

    // Number and ID as links to ACC, blue and underlined
    ['Number', 'ID'].forEach((hd, x) => {
      if (I[hd] === undefined || S.dest[hd] < 0) return;
      const rich = rep.rows.map((r, j) => {
        const t = accText_(r[I[hd]]), url = String((rep.links[j] || [])[x] || (rep.links[j] || [])[0] || '');
        const b = SpreadsheetApp.newRichTextValue().setText(t);
        if (t && /^https?:\/\//i.test(url)) b.setLinkUrl(url);
        return [b.build()];
      });
      const rg = sheet.getRange(at, S.dest[hd] + 1, k, 1);
      rg.setRichTextValues(rich);
      rg.setFontColor(ACC_LINK_BLUE).setFontLine('underline');
    });
    SpreadsheetApp.flush();

    // check what landed
    const back = sheet.getRange(at, C.NUMBER + 1, k, 1).getValues().map(r => cellStr(r[0]));
    const bad = back.filter((n, j) => n !== accText_(rep.rows[j][I['Number']])).length;
    const after = cellStr(sheet.getRange(at + k, C.NUMBER + 1).getValue());
    if (bad) throw new Error('Written, but ' + bad + ' Number cells read back differently. Check rows ' + at + '-' + (at + k - 1) + ' in the sheet.');

    const actions = sheet.getRange(at, 1, k, S.width).getValues().map(r => [r[C.DATE], r[C.INSPECTOR], r[C.CODE], r[C.NOTES]].map(String).join('\u001f'));
    PropertiesService.getScriptProperties().setProperty('ACC_LAST', JSON.stringify({
      first: at, count: k, file: rep.name, at: new Date().toISOString(), by: me.engineer,
      nums: accHash_(back.join('|')), acts: accHash_(actions.join('\n'))
    }));
    apiLog_(me, 'ACC upload', (rep.name || 'report') + ' · ' + k + ' rows added to DailyAction (rows ' + at + '-' + (at + k - 1) + ') · ' +
      plan.carried.length + ' with the earlier action · ' + plan.pending + ' pending');
    delete plan._carried;
    plan.saved = true; plan.rowAfterEmpty = !after;
    return plan;
  } finally { lock.releaseLock(); }
}

function accHash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

/** The last upload, and whether it can still be taken back. */
function accLast_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ACC_LAST');
  if (!raw) return null;
  const L = JSON.parse(raw);
  L.why = accUndoProblem_(L);
  L.canUndo = L.why === '';
  return L;
}

function accUndoProblem_(L) {
  const sheet = accDailySheet_(), C = getColumns(sheet);
  const width = Math.max(C.WIDTH, C.NOTES + 1);
  if (sheet.getLastRow() < L.first + L.count - 1) return 'The rows of that upload are no longer in the tab.';
  const rows = sheet.getRange(L.first, 1, L.count, width).getValues();
  if (accHash_(rows.map(r => cellStr(r[C.NUMBER])).join('|')) !== L.nums) return 'The rows of that upload were moved or edited in the sheet.';
  const below = sheet.getLastRow() > L.first + L.count - 1 ?
    sheet.getRange(L.first + L.count, C.NUMBER + 1, sheet.getLastRow() - L.first - L.count + 1, 1).getValues().some(r => cellStr(r[0])) : false;
  if (below) return 'Newer rows were added under that upload.';
  if (accHash_(rows.map(r => [r[C.DATE], r[C.INSPECTOR], r[C.CODE], r[C.NOTES]].map(String).join('\u001f')).join('\n')) !== L.acts)
    return 'Someone already closed or edited a request from that upload.';
  return '';
}

function accUndoDaily_(me) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('ACC_LAST');
    if (!raw) throw new Error('There is no upload to take back.');
    const L = JSON.parse(raw), why = accUndoProblem_(L);
    if (why) throw new Error('Cannot take it back: ' + why);
    accDailySheet_().deleteRows(L.first, L.count);
    PropertiesService.getScriptProperties().deleteProperty('ACC_LAST');
    apiLog_(me, 'ACC upload undone', (L.file || 'report') + ' · ' + L.count + ' rows removed from DailyAction (rows ' + L.first + '-' + (L.first + L.count - 1) + ')');
    return L.count + ' rows removed (rows ' + L.first + '-' + (L.first + L.count - 1) + ').';
  } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- Villa Handover tracker

/** What the full export would change in the tracker. Checks the same things as the update-villa-tracker-acc skill. */
function accTrackerPlan_(me, rep, opt) {
  const st = trackerCall_('accState', [0, true], me);
  if (!st || !st.ready)
    throw new Error('The tracker is not ready for ACC updates: ' + ((st && st.why) || 'open the tracker\'s Apps Script, run setupSync once, and deploy a new version.'));
  return accTrackerDelta_(rep, st, opt || {});
}

/** Pure part (tested without Apps Script): rows to send, expected totals and the checks. */
function accTrackerDelta_(rep, st, opt) {
  const I = rep.idx, seen = {}, counts = {}, types = {}, send = [], twice = [];
  let latest = '';
  const since = String(opt.since || st.asof || '');
  const known = {}; (st.numbers || []).forEach(n => { known[n] = 1; });
  let added = 0;
  rep.rows.forEach(r => {
    const num = accText_(r[I['Number']]);
    if (!/^[A-Z]+-CIR-/.test(num)) return;
    if (seen[num]) { twice.push(num); return; }
    seen[num] = 1;
    const fin = accText_(r[I['Final response']]), code = /^[ABCD][ -]/.test(fin) ? fin.charAt(0) : 'O';
    const co = num.split('-')[0], c = counts[co] || (counts[co] = { total: 0, A: 0, B: 0, C: 0, D: 0, O: 0 });
    c.total++; c[code]++;
    const ty = accText_(r[I['Type']]); types[ty] = (types[ty] || 0) + 1;
    const upd = accText_(r[I['Updated at']]).slice(0, 10);
    if (upd > latest) latest = upd;
    if (opt.only ? opt.only.indexOf(num) >= 0 : upd >= since) {
      send.push(ACC_TRACKER_FIELDS.map(f => accText_(r[I[f]])));
      if (!known[num]) added++;
    }
  });
  if (twice.length) throw new Error('Request ' + twice[0] + ' appears twice in the export. Nothing was sent.');
  const expected = Object.keys(counts).sort().map(k => { const c = counts[k]; return [k, c.total, c.A, c.B, c.C, c.D, c.O]; });
  const stops = [];
  const other = Object.keys(types).filter(t => t !== ACC_TRACKER_TYPE);
  if (other.length) stops.push('The export has other request types (' + other.join(', ') + '). The tracker takes only ' + ACC_TRACKER_TYPE + '.');
  (st.totals || []).forEach(t => {
    const e = expected.filter(x => x[0] === t[0])[0];
    if (!e) stops.push('Company ' + t[0] + ' is in the tracker but not in this export: the export looks filtered.');
    else if (e[1] < Number(t[1])) stops.push('Company ' + t[0] + ' has ' + e[1] + ' requests in this export but ' + t[1] + ' in the tracker: the export looks filtered (one company, period or status).');
  });
  if (st.asof && latest && latest < st.asof) stops.push('This export is older than the data already in the tracker (' + latest + ' vs ' + st.asof + ').');
  return {
    kind: 'tracker', file: rep.name, sameOrder: rep.sameOrder, ignored: rep.extra || [], blank: rep.blank || [], exportRows: Object.keys(seen).length, latest: latest, since: since,
    asof: st.asof || '', current: st.totals || [], expected: expected, types: types, logRows: st.logRows || 0, inboxRows: st.inboxRows || 0,
    send: send, added: added, updated: send.length - added, stops: stops
  };
}
