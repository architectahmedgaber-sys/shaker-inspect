/**
 * Shaker Inspect · IrFiles.gs  (api-7)
 * The IR files (PDF / pictures downloaded from ACC) live in ONE Drive folder, "Shaker Inspect - IR Files":
 *
 *     Shaker Inspect - IR Files / Open   / SH - EL-Shorouk / ARC - Architectural / CIR / 2026-11-12 / <IR files as downloaded from ACC>
 *                                        / SQ - Square     / STR - Structural / MIR / ...
 *                                        / AT - Alexandria / ...
 *                                        / Unsorted / 2026-11-12 / <files whose name was not recognised>
 *                               / Closed / SH - EL-Shorouk / <engineer who closed it> / 2026-11-12 / <CIR number>.pdf  (Section C filled by the app)
 *                                        / ...
 *
 * AUTO SORT: the DC (or an admin) picks the day and many files at once (Admin screen > IR files). The app reads each file name,
 * e.g. CP2C-CN-SH-CIR-ARC-14688  =  project - CN - company SH - CIR - discipline ARC - number, and files it under
 * Open / company / discipline / CIR or MIR / day. A name it cannot read goes to Open / Unsorted / day and the uploader is told.
 * Only Admin and DC can upload, move a file (admin_irMove) or approve the one-time re-organisation of the old files (admin_irReorgPlan / admin_irReorgApply).
 * The older way (company picked by hand) still works.
 *
 * Who sees what:
 *   Admin and DC   : the whole IR folder (Open and Closed).
 *   Engineer       : only his own folder Closed / <company> / <his name>. The app shares it with the email he signed in with
 *                    (view only, see IR_ENGINEER_ACCESS) the first time he closes a request or opens "My closed files".
 * Nobody gets "anyone with the link" access. Nobody needs an ACC account.
 *
 * ONE-TIME MOVE of the old Closed files (Closed / company / day / engineer) into the new layout:
 * Admin screen > IR files > "Closed folders" card > Review > (read the list) > Approve and move. Nothing moves before the approval.
 *
 * Paste this file in the INSPECTION project as a script file named IrFiles. Api.gs (api-7) and Code.gs must be pasted too.
 * No setup function to run. Deploy > Manage deployments > pencil > New version.
 * (The first upload makes the folder in the Drive of the person who owns the script.)
 * Files already uploaded straight into the main folder (no company) keep working.
 */

const IR_FOLDER_NAME = 'Shaker Inspect - IR Files';
const IR_COMPANIES = { SH: 'SH - EL-Shorouk', SQ: 'SQ - Square', AT: 'AT - Alexandria', OTHER: 'Other' };
const IR_MAX_UPLOAD = 14 * 1024 * 1024;      // bytes of one file sent from the phone
const IR_MAX_DIRECT = 150 * 1024 * 1024;     // bytes of one file sent straight from the phone to Drive (fast upload)
const IR_MAX_OPEN = 20 * 1024 * 1024;        // bytes of one file sent back to the phone
const IR_MAX_BIG = 120 * 1024 * 1024;       // bytes of a file the app may read in pieces (fill and close)
const IR_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const IR_OPEN = 'Open', IR_CLOSED = 'Closed', IR_UNSORTED = 'Unsorted';
const IR_ENGINEER_ACCESS = 'view';        // 'view' or 'edit': what an engineer can do inside his own Closed folder (change here, then New version)
// discipline code (as written in the file name) -> folder name. A code that is not here is still accepted and its own letters become the folder name.
const IR_DISCS = { ARC: 'ARC - Architectural', STR: 'STR - Structural', ELE: 'ELE - Electrical', EL: 'EL - Electrical', MEC: 'MEC - Mechanical', MEP: 'MEP - MEP', PLU: 'PLU - Plumbing', HVAC: 'HVAC - HVAC', FF: 'FF - Fire Fighting', CIV: 'CIV - Civil', LAN: 'LAN - Landscape', INT: 'INT - Interior' };
const IR_TYPES = { CIR: 'CIR', MIR: 'MIR' };
const IR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function irRoot_(create) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('IR_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const it = DriveApp.getFoldersByName(IR_FOLDER_NAME);
  let f = null;
  while (it.hasNext()) { const c = it.next(); if (!c.isTrashed()) { f = c; break; } }
  if (!f && create) f = DriveApp.createFolder(IR_FOLDER_NAME);
  if (f) props.setProperty('IR_FOLDER_ID', f.getId());
  return f;
}

function irSub_(parent, name, create) {
  const it = parent.getFoldersByName(name);
  while (it.hasNext()) { const c = it.next(); if (!c.isTrashed()) return c; }
  return create ? parent.createFolder(name) : null;
}

// Closed / <company> / <engineer who closes the request> / <day>  (the engineer comes from the sign-in, never from the phone)
function irEngDir_(me) {
  const n = String((me && me.engineer) || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n || 'Unknown engineer';
}
function irEngFolder_(root, co, me, create) {
  let f = irSub_(root, IR_CLOSED, create);
  f = f && irSub_(f, IR_COMPANIES[co], create);
  return f && irSub_(f, irEngDir_(me), create);
}
function irClosedDir_(root, co, day, me, create) {
  const e = irEngFolder_(root, co, me, create);
  return e && irSub_(e, day, create);
}

// Reads a file name like CP2C-CN-SH-CIR-ARC-14688 (rev / extra words after it are fine).
// Returns { co: 'SH', type: 'CIR', disc: 'ARC', no: '14688' } or null when the name does not say company + CIR/MIR + discipline.
function irParse_(name) {
  const m = String(name || '').toUpperCase().match(/(?:^|[^A-Z0-9])([A-Z]{2})[-_ ]+(CIR|MIR)[-_ ]+([A-Z]{2,5})(?:[-_ ]+(\d{2,}))?/);
  if (!m || !IR_COMPANIES[m[1]] || m[1] === 'OTHER') return null;
  return { co: m[1], type: m[2], disc: m[3], no: m[4] || '' };
}
function irDiscName_(code) { return IR_DISCS[code] || code; }
function irDiscKey_(folderName) { const k = Object.keys(IR_DISCS).filter(c => IR_DISCS[c] === folderName)[0]; return k || String(folderName).split(' - ')[0]; }
// where an Open file goes: Open / company / discipline / CIR|MIR / day, or Open / Unsorted / day.  info = irParse_ result, company picked by hand = coHand
function irOpenDir_(root, info, day, create) {
  let f = irSub_(root, IR_OPEN, create); if (!f) return null;
  if (!info) { f = irSub_(f, IR_UNSORTED, create); return f && irSub_(f, day, create); }
  f = irSub_(f, IR_COMPANIES[info.co], create);
  f = f && irSub_(f, irDiscName_(info.disc), create);
  f = f && irSub_(f, info.type, create);
  return f && irSub_(f, day, create);
}
// the folders that hold the IR files of a day, whatever the layout
function irPathLabel_(info, day) { return info ? IR_COMPANIES[info.co] + ' / ' + irDiscName_(info.disc) + ' / ' + info.type + ' / ' + day : IR_UNSORTED + ' / ' + day; }

// every file under the root (root files, company/files, company/day/files)
function irList_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ir_index3');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const root = irRoot_(false);
  const out = [];
  function files(folder, co, day, disc, type) {
    const it = folder.getFiles();
    while (it.hasNext() && out.length < 4000) {
      const x = it.next();
      out.push({ id: x.getId(), name: x.getName(), size: x.getSize(), t: x.getLastUpdated().getTime(), co: co, day: day, disc: disc || '', type: type || '' });
    }
  }
  if (root) {
    files(root, '', '');
    const scan = (parent) => {           // parent / <company> / <day> / files
      const cs = parent.getFolders();
      while (cs.hasNext()) {
        const c = cs.next(); if (c.isTrashed()) continue;
        const key = Object.keys(IR_COMPANIES).filter(k => IR_COMPANIES[k] === c.getName())[0];
        if (!key) continue;
        files(c, key, '');
        const ds = c.getFolders();
        while (ds.hasNext()) {
          const d = ds.next(); if (d.isTrashed()) continue;
          if (IR_DAY_RE.test(d.getName())) { files(d, key, d.getName()); continue; }      // old layout: company / day
          const disc = irDiscKey_(d.getName());                                          // new layout: company / discipline / CIR|MIR / day
          const ts = d.getFolders();
          while (ts.hasNext()) {
            const ty = ts.next(); if (ty.isTrashed() || !IR_TYPES[ty.getName()]) continue;
            const dd = ty.getFolders();
            while (dd.hasNext()) { const x = dd.next(); if (!x.isTrashed() && IR_DAY_RE.test(x.getName())) files(x, key, x.getName(), disc, ty.getName()); }
          }
        }
      }
    };
    const open = irSub_(root, IR_OPEN, false);
    if (open) {
      scan(open);
      const un = irSub_(open, IR_UNSORTED, false);
      if (un) { files(un, 'UNSORTED', ''); const ds = un.getFolders(); while (ds.hasNext()) { const d = ds.next(); if (!d.isTrashed() && IR_DAY_RE.test(d.getName())) files(d, 'UNSORTED', d.getName()); } }
    }
    scan(root);                          // files uploaded before the Open / Closed folders existed
  }
  out.sort((a, b) => a.name < b.name ? -1 : 1);
  try { cache.put('ir_index3', JSON.stringify(out), 120); } catch (e) {}   // too big for the cache = just read again next time
  return out;
}

function irSafeName_(n) {
  const s = String(n || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  const m = s.match(/\.([A-Za-z0-9]+)$/);
  if (!m || !IR_EXT[m[1].toLowerCase()]) throw new Error('Only PDF, JPG or PNG files: ' + s);
  return s;
}

// is this file somewhere inside the IR folder (up to 8 levels)?
function irInside_(file, root) {
  let level = file.getParents();
  for (let i = 0; i < 8; i++) {
    const next = [];
    while (level.hasNext()) { const p = level.next(); if (p.getId() === root.getId()) return true; const up = p.getParents(); while (up.hasNext()) next.push(up.next()); }
    if (!next.length) return false;
    level = { hasNext: () => next.length > 0, next: () => next.shift() };
  }
  return false;
}

const irIsFull_ = me => me && (me.role === 'Admin' || me.role === 'DC');

// Admin and DC: view access to the whole IR folder (their Google email), once every 6 hours
function irShare_(me) {
  if (!irIsFull_(me)) return;
  const key = 'irshare_' + String(me.email || '').toLowerCase();
  const cache = CacheService.getScriptCache();
  if (!me.email || cache.get(key)) return;
  const root = irRoot_(false);
  if (root) { try { root.addViewer(me.email); } catch (e) { console.warn('share: ' + e); } }
  try { cache.put(key, '1', 21600); } catch (e) {}
}

// an engineer: access to his own folder Closed / <company> / <engineer> only (his registered email), once every 6 hours
function irShareEngineer_(email, role, folder) {
  email = String(email || '').toLowerCase();
  if (!email || !folder || role === 'Admin' || role === 'DC') return;
  const key = 'irsh2_' + folder.getId() + '_' + email + '_' + IR_ENGINEER_ACCESS;
  const cache = CacheService.getScriptCache();
  if (cache.get(key)) return;
  try {
    if (IR_ENGINEER_ACCESS === 'edit') folder.addEditor(email); else folder.addViewer(email);
    try { cache.put(key, '1', 21600); } catch (e) {}
  } catch (e) { console.warn('share engineer: ' + e); }
}

// the engineer's own folders (one per company he closed in), newest closing day first; also makes sure he has access to them
function irMine_(closed, me) {
  const out = [];
  if (!closed) return out;
  Object.keys(IR_COMPANIES).forEach(k => {
    const c = irSub_(closed, IR_COMPANIES[k], false), e = c && irSub_(c, irEngDir_(me), false);
    if (!e) return;
    irShareEngineer_(me.email, me.role, e);
    const days = [], ds = e.getFolders();
    while (ds.hasNext()) { const d = ds.next(); if (!d.isTrashed() && IR_DAY_RE.test(d.getName())) days.push({ day: d.getName(), url: d.getUrl() }); }
    days.sort((a, b) => a.day < b.day ? 1 : -1);
    out.push({ key: k, name: IR_COMPANIES[k], url: e.getUrl(), latest: days[0] || null, days: days.slice(0, 31) });
  });
  out.sort((a, b) => ((b.latest && b.latest.day) || '') < ((a.latest && a.latest.day) || '') ? -1 : 1);
  return out;
}


// ---------------------------------------------------------------- one-time move of the old Closed files
// old: Closed / <company> / <day> / <engineer> / file   (or Closed / <company> / <day> / file with no engineer)
// new: Closed / <company> / <engineer> / <day> / file
function irAdminEmails_() {
  const out = {};
  readUsers_().forEach(u => { if ((u.role === 'Admin' || u.role === 'DC') && u.email && String(u.status).toLowerCase() === 'approved') out[u.email] = true; });
  return out;
}
function irEngKey_(n) { return String(n || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase(); }

function irMigScan_() {
  const root = irRoot_(false), closed = root && irSub_(root, IR_CLOSED, false);
  const moves = [], oldDays = [];
  let already = 0;
  if (!closed) return { moves: moves, already: already, oldDays: oldDays, closed: null };
  const files = (folder, co, eng, day) => {
    const it = folder.getFiles();
    while (it.hasNext()) { const f = it.next(); moves.push({ id: f.getId(), name: f.getName(), co: co, eng: eng, day: day }); }
  };
  Object.keys(IR_COMPANIES).forEach(k => {
    const c = irSub_(closed, IR_COMPANIES[k], false); if (!c) return;
    const subs = c.getFolders();
    while (subs.hasNext()) {
      const s = subs.next(); if (s.isTrashed()) continue;
      if (IR_DAY_RE.test(s.getName())) {                       // old layout: <day> / <engineer> / files
        oldDays.push({ id: s.getId(), co: k });
        files(s, k, 'Unknown engineer', s.getName());
        const es = s.getFolders();
        while (es.hasNext()) { const e = es.next(); if (!e.isTrashed()) files(e, k, e.getName(), s.getName()); }
      } else {                                                  // new layout already: <engineer> / <day> / files
        const ds = s.getFolders();
        while (ds.hasNext()) { const d = ds.next(); if (!d.isTrashed()) { const it = d.getFiles(); while (it.hasNext()) { it.next(); already++; } } }
      }
    }
  });
  moves.sort((a, b) => (a.co + a.eng + a.day + a.name) < (b.co + b.eng + b.day + b.name) ? -1 : 1);
  return { moves: moves, already: already, oldDays: oldDays, closed: closed };
}
function irMigSig_(moves) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, moves.map(m => m.id).join(','));
  return moves.length + '-' + d.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0, 12);
}

// who must have access, who loses it (computed again at the end, so the list shown is what happens)
function irMigAccess_(scan, engNames) {
  const root = irRoot_(false), admins = irAdminEmails_(), owner = '';
  try { owner = String(root && root.getOwner() && root.getOwner().getEmail() || '').toLowerCase(); } catch (e) {}   // the folder owner (no extra permission needed)
  const have = {}, revoke = [], grant = [];
  if (root) {
    root.getViewers().concat(root.getEditors()).forEach(u => { const e = String(u.getEmail() || '').toLowerCase(); if (e) have[e] = true; });
    root.getViewers().forEach(u => { const e = String(u.getEmail() || '').toLowerCase(); if (e && e !== owner && !admins[e]) revoke.push(e); });
  }
  Object.keys(admins).forEach(e => { if (e !== owner && !have[e]) grant.push(e); });
  const byEng = {};
  readUsers_().forEach(u => { if (u.email && u.role !== 'Admin' && u.role !== 'DC' && String(u.status).toLowerCase() === 'approved') byEng[irEngKey_(u.engineer)] = u; });
  const share = [], unmatched = [];
  Object.keys(engNames).forEach(co => Object.keys(engNames[co]).forEach(eng => {
    const u = eng === 'Unknown engineer' ? null : byEng[irEngKey_(eng)];
    if (u) share.push({ co: co, eng: eng, email: u.email }); else unmatched.push(IR_COMPANIES[co] + ' / ' + eng);
  }));
  return { revoke: revoke, grant: grant, share: share, unmatched: unmatched };
}
function irMigEngNames_(scan) {
  const names = {};
  scan.moves.forEach(m => { (names[m.co] = names[m.co] || {})[m.eng] = 1; });
  if (scan.closed) Object.keys(IR_COMPANIES).forEach(k => {
    const c = irSub_(scan.closed, IR_COMPANIES[k], false); if (!c) return;
    const es = c.getFolders();
    while (es.hasNext()) { const e = es.next(); if (!e.isTrashed() && !IR_DAY_RE.test(e.getName())) (names[k] = names[k] || {})[e.getName()] = 1; }
  });
  return names;
}

const IR_FUNCS_ = {
  // names of all the IR files (the app matches them to requests by the number in the name)
  ir_index: () => ({ files: irList_(), companies: IR_COMPANIES }),

  // the Drive links. Everybody: "mine" = his own closed folders (with the latest closing day).
  // Admin and DC also get the whole Open and Closed trees (Closed: company > engineer).
  ir_links: (me) => {
    const root = irRoot_(false), full = irIsFull_(me);
    if (!root) return { full: full, root: '', open: [], closed: [], mine: [] };
    irShare_(me);
    const open = irSub_(root, IR_OPEN, false), closed = irSub_(root, IR_CLOSED, false);
    const mine = irMine_(closed, me);
    if (!full) return { full: false, mine: mine };
    const listOpen = () => {
      const out = [];
      if (!open) return out;
      Object.keys(IR_COMPANIES).forEach(k => {
        const c = irSub_(open, IR_COMPANIES[k], false); if (!c) return;
        const days = [], groups = [];
        const ds = c.getFolders();
        while (ds.hasNext()) {
          const d = ds.next(); if (d.isTrashed()) continue;
          if (IR_DAY_RE.test(d.getName())) { days.push({ day: d.getName(), url: d.getUrl() }); continue; }
          const ts = d.getFolders();                                                       // discipline / CIR|MIR
          while (ts.hasNext()) {
            const ty = ts.next(); if (ty.isTrashed() || !IR_TYPES[ty.getName()]) continue;
            const gd = [], dd = ty.getFolders();
            while (dd.hasNext()) { const x = dd.next(); if (!x.isTrashed() && IR_DAY_RE.test(x.getName())) gd.push({ day: x.getName(), url: x.getUrl() }); }
            gd.sort((a, b) => a.day < b.day ? 1 : -1);
            groups.push({ disc: irDiscKey_(d.getName()), type: ty.getName(), url: ty.getUrl(), days: gd.slice(0, 31) });
          }
        }
        days.sort((a, b) => a.day < b.day ? 1 : -1);
        out.push({ key: k, name: IR_COMPANIES[k], url: c.getUrl(), days: days.slice(0, 31), groups: groups });
      });
      return out;
    };
    const unsorted = open && irSub_(open, IR_UNSORTED, false);
    const listClosed = () => {
      const out = [];
      if (!closed) return out;
      Object.keys(IR_COMPANIES).forEach(k => {
        const c = irSub_(closed, IR_COMPANIES[k], false); if (!c) return;
        const engs = [], es = c.getFolders();
        while (es.hasNext()) { const e = es.next(); if (!e.isTrashed() && !IR_DAY_RE.test(e.getName())) engs.push({ name: e.getName(), url: e.getUrl() }); }
        engs.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
        out.push({ key: k, name: IR_COMPANIES[k], url: c.getUrl(), engs: engs });
      });
      return out;
    };
    return { full: true, root: root.getUrl(), openUrl: open ? open.getUrl() : '', closedUrl: closed ? closed.getUrl() : '', unsortedUrl: unsorted ? unsorted.getUrl() : '', open: listOpen(), closed: listClosed(), mine: mine };
  },

  // the app fills Section C of the IR form when a request is closed and saves the filled PDF here:
  // Closed / <company> / <engineer> / <day of the close> / <same file name>   a=[company key, day, file name, base64]
  ir_saveClosed: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    const co = String(a[0] || ''), day = String(a[1] || '');
    if (!IR_COMPANIES[co]) throw new Error('Unknown company.');
    if (!IR_DAY_RE.test(day)) throw new Error('Bad day.');
    const name = irSafeName_(a[2]);
    if (!/\.pdf$/i.test(name)) throw new Error('PDF only.');
    const bytes = Utilities.base64Decode(String(a[3] || ''));
    if (!bytes.length || bytes.length > IR_MAX_UPLOAD) throw new Error('Bad file size.');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const root = irRoot_(true);
      const eng = irEngFolder_(root, co, me, true);
      irShareEngineer_(me.email, me.role, eng);
      const folder = irSub_(eng, day, true);
      const old = folder.getFilesByName(name);
      while (old.hasNext()) old.next().setTrashed(true);
      const file = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', name));
      // the original in Open goes away (to the Drive bin, so it can still be restored); only when it really is inside Open
      let moved = false;
      const origId = String(a[4] || '');
      if (origId) {
        try {
          const orig = DriveApp.getFileById(origId), openF = irSub_(root, IR_OPEN, false);
          if (openF && !orig.isTrashed() && orig.getId() !== file.getId() && irInside_(orig, openF)) { orig.setTrashed(true); moved = true; }
        } catch (e) { console.warn('move original: ' + e); }
      }
      try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
      apiLog_(me, 'IR form filled', 'Closed / ' + IR_COMPANIES[co] + ' / ' + irEngDir_(me) + ' / ' + day + ' / ' + name + (moved ? ' (original removed from Open)' : ''));
      return { id: file.getId(), url: folder.getUrl(), engUrl: eng.getUrl(), moved: moved };
    } finally { lock.releaseLock(); }
  },

  // the file itself, as base64, only if it is inside the IR folder
  // BIG FILES: one piece of a file (a=[file id, start byte, length]); the app asks for up to 4 pieces at once. Pieces come from the Drive API with a Range header.
  ir_getChunk: (me, a) => {
    const root = irRoot_(false);
    if (!root) throw new Error('No IR files folder yet.');
    const id = String(a[0] || ''), start = Math.max(0, Number(a[1]) || 0), len = Math.min(Number(a[2]) || 0, 8 * 1024 * 1024);
    if (!(len > 0)) throw new Error('Bad piece.');
    const file = DriveApp.getFileById(id);
    if (file.isTrashed() || !irInside_(file, root)) throw new Error('File not found.');
    if (file.getSize() > IR_MAX_BIG) throw new Error('The file is too big to open here (' + Math.round(file.getSize() / 1048576) + ' MB).');
    const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + start + '-' + (start + len - 1) }, muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code !== 206 && code !== 200) throw new Error('Drive did not give the file (' + code + ').');
    return { b64: Utilities.base64Encode(res.getContent()), part: code === 206 };
  },

  // FILL AND SAVE, step 1 (a=[company key, day, file name, size, origin of the app]): makes Closed/<company>/<day> and gives the phone a one-time Drive upload link
  ir_putStart: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    const co = String(a[0] || ''), day = String(a[1] || ''), origin = String(a[4] || ''), size = Number(a[3]);
    if (!IR_COMPANIES[co]) throw new Error('Unknown company.');
    if (!IR_DAY_RE.test(day)) throw new Error('Bad day.');
    const name = irSafeName_(a[2]);
    if (!/\.pdf$/i.test(name)) throw new Error('PDF only.');
    if (!(size > 0) || size > IR_MAX_DIRECT) throw new Error('Bad file size.');
    let folderId;
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const eng = irEngFolder_(irRoot_(true), co, me, true);
      irShareEngineer_(me.email, me.role, eng);
      folderId = irSub_(eng, day, true).getId();
    }
    finally { lock.releaseLock(); }
    const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': 'application/pdf', 'X-Upload-Content-Length': String(size) };
    if (/^[a-z][a-z0-9+.\-]*:\/\/[A-Za-z0-9.\-]+(:\d+)?$/i.test(origin)) headers.Origin = origin;
    const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'post', contentType: 'application/json; charset=UTF-8', headers: headers, muteHttpExceptions: true,
      payload: JSON.stringify({ name: name, parents: [folderId], mimeType: 'application/pdf' })
    });
    if (res.getResponseCode() !== 200) throw new Error('Drive did not start the upload (' + res.getResponseCode() + ').');
    const h = res.getAllHeaders(), url = h.Location || h.location;
    if (!url) throw new Error('Drive did not give an upload link.');
    return { url: String(url) };
  },

  // FILL AND SAVE, step 2 (a=[new file id, company key, day, file name, original file id]): checks the file is in Closed, replaces an older same-name file, removes the original from Open
  ir_putDone: (me, a) => {
    need_(me, ['Admin', 'Engineer']);
    const co = String(a[1] || ''), day = String(a[2] || '');
    if (!IR_COMPANIES[co]) throw new Error('Unknown company.');
    if (!IR_DAY_RE.test(day)) throw new Error('Bad day.');
    const name = irSafeName_(a[3]);
    const root = irRoot_(false);
    const folder = root && irClosedDir_(root, co, day, me, false);
    if (!folder) throw new Error('Folder not found.');
    const file = DriveApp.getFileById(String(a[0] || ''));
    if (file.isTrashed() || file.getSize() <= 0) throw new Error('The file did not arrive: ' + name);
    let inside = false; const ps = file.getParents();
    while (ps.hasNext()) if (ps.next().getId() === folder.getId()) inside = true;
    if (!inside) throw new Error('The file is not in the expected folder.');
    const old = folder.getFilesByName(name);
    while (old.hasNext()) { const o = old.next(); if (o.getId() !== file.getId()) o.setTrashed(true); }
    let moved = false;
    const origId = String(a[4] || '');
    if (origId) {
      try {
        const orig = DriveApp.getFileById(origId), openF = irSub_(root, IR_OPEN, false);
        if (openF && !orig.isTrashed() && orig.getId() !== file.getId() && irInside_(orig, openF)) { orig.setTrashed(true); moved = true; }
      } catch (e) { console.warn('move original: ' + e); }
    }
    try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
    apiLog_(me, 'IR form filled', 'Closed / ' + IR_COMPANIES[co] + ' / ' + irEngDir_(me) + ' / ' + day + ' / ' + name + (moved ? ' (original removed from Open)' : '') + ' (direct)');
    const engF = irEngFolder_(root, co, me, false);
    return { id: file.getId(), url: folder.getUrl(), engUrl: engF ? engF.getUrl() : folder.getUrl(), moved: moved };
  },

  ir_get: (me, a) => {
    const root = irRoot_(false);
    if (!root) throw new Error('No IR files folder yet.');
    const file = DriveApp.getFileById(String(a[0] || ''));
    if (file.isTrashed() || !irInside_(file, root)) throw new Error('File not found.');
    if (file.getSize() > IR_MAX_OPEN) throw new Error('The file is too big to open here (' + Math.round(file.getSize() / 1048576) + ' MB).');
    const ext = (file.getName().match(/\.([A-Za-z0-9]+)$/) || [])[1];
    return { name: file.getName(), mime: IR_EXT[String(ext || '').toLowerCase()] || file.getMimeType(), b64: Utilities.base64Encode(file.getBlob().getBytes()) };
  }
};

const IR_ADMIN_FUNCS_ = {
  // a=[name, base64, company key (SH/SQ/AT/OTHER), day yyyy-MM-dd]; a file with the same name in the same day folder is replaced
  admin_irUpload: (me, a) => {
    const name = irSafeName_(a[0]);
    const ext = name.match(/\.([A-Za-z0-9]+)$/)[1].toLowerCase();
    const co = String(a[2] || '');
    const day = String(a[3] || '');
    const auto = co === 'AUTO';                           // AUTO = sort by the file name
    if (!auto && !IR_COMPANIES[co]) throw new Error('Pick the company first.');
    if (!IR_DAY_RE.test(day)) throw new Error('Pick the day (date).');
    const bytes = Utilities.base64Decode(String(a[1] || ''));
    if (!bytes.length) throw new Error('Empty file: ' + name);
    if (bytes.length > IR_MAX_UPLOAD) throw new Error(name + ' is bigger than ' + Math.round(IR_MAX_UPLOAD / 1048576) + ' MB.');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const root = irRoot_(true);
      const info = auto ? irParse_(name) : null;
      const folder = auto ? irOpenDir_(root, info, day, true) : irSub_(irSub_(irSub_(root, IR_OPEN, true), IR_COMPANIES[co], true), day, true);
      const old = folder.getFilesByName(name);
      let replaced = false;
      while (old.hasNext()) { old.next().setTrashed(true); replaced = true; }
      const file = folder.createFile(Utilities.newBlob(bytes, IR_EXT[ext], name));
      CacheService.getScriptCache().remove('ir_index3');
      const label = auto ? irPathLabel_(info, day) : IR_COMPANIES[co] + ' / ' + day;
      apiLog_(me, 'IR file', 'Open / ' + label + ' / ' + name + (replaced ? ' (replaced)' : ''));
      return { id: file.getId(), name: name, replaced: replaced, sorted: auto ? !!info : true, path: label };
    } finally { lock.releaseLock(); }
  },

  // FAST UPLOAD, step 1 (a=[name, size in bytes, company key, day, origin of the app]).
  // The script makes the folders (same names as always), starts a Drive upload session owned by the script's account
  // and gives the phone a one-time link. The phone then sends the file straight to Drive.
  admin_irUploadStart: (me, a) => {
    const name = irSafeName_(a[0]);
    const ext = name.match(/\.([A-Za-z0-9]+)$/)[1].toLowerCase();
    const size = Number(a[1]);
    const co = String(a[2] || ''), day = String(a[3] || ''), origin = String(a[4] || '');
    if (!IR_COMPANIES[co]) throw new Error('Pick the company first.');
    if (!IR_DAY_RE.test(day)) throw new Error('Pick the day (date).');
    if (!(size > 0)) throw new Error('Empty file: ' + name);
    if (size > IR_MAX_DIRECT) throw new Error(name + ' is bigger than ' + Math.round(IR_MAX_DIRECT / 1048576) + ' MB.');
    let folderId;
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { folderId = irSub_(irSub_(irSub_(irRoot_(true), IR_OPEN, true), IR_COMPANIES[co], true), day, true).getId(); }
    finally { lock.releaseLock(); }
    const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': IR_EXT[ext], 'X-Upload-Content-Length': String(size) };
    if (/^[a-z][a-z0-9+.\-]*:\/\/[A-Za-z0-9.\-]+(:\d+)?$/i.test(origin)) headers.Origin = origin;   // lets the browser read the answer of Drive
    const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'post', contentType: 'application/json; charset=UTF-8', headers: headers, muteHttpExceptions: true,
      payload: JSON.stringify({ name: name, parents: [folderId], mimeType: IR_EXT[ext] })
    });
    if (res.getResponseCode() !== 200) throw new Error('Drive did not start the upload (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
    const h = res.getAllHeaders(), url = h.Location || h.location;
    if (!url) throw new Error('Drive did not give an upload link.');
    return { url: String(url), name: name };
  },

  // FAST UPLOAD, step 2 (a=[file id, name, company key, day]): checks the file landed in the right folder, replaces an older file with the same name
  admin_irUploadDone: (me, a) => {
    const name = irSafeName_(a[1]);
    const co = String(a[2] || ''), day = String(a[3] || '');
    if (!IR_COMPANIES[co]) throw new Error('Unknown company.');
    if (!IR_DAY_RE.test(day)) throw new Error('Bad day.');
    const root = irRoot_(false);
    const folder = root && irSub_(irSub_(irSub_(root, IR_OPEN, false) || root, IR_COMPANIES[co], false) || root, day, false);
    if (!folder) throw new Error('Folder not found.');
    const file = DriveApp.getFileById(String(a[0] || ''));
    if (file.isTrashed() || file.getSize() <= 0) throw new Error('The file did not arrive: ' + name);
    let inside = false; const ps = file.getParents();
    while (ps.hasNext()) if (ps.next().getId() === folder.getId()) inside = true;
    if (!inside) throw new Error('The file is not in the expected folder.');
    let replaced = false;
    const old = folder.getFilesByName(name);
    while (old.hasNext()) { const o = old.next(); if (o.getId() !== file.getId()) { o.setTrashed(true); replaced = true; } }
    try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
    apiLog_(me, 'IR file', 'Open / ' + IR_COMPANIES[co] + ' / ' + day + ' / ' + name + (replaced ? ' (replaced)' : '') + ' (fast)');
    return { id: file.getId(), name: name, replaced: replaced };
  },

  // FAST UPLOAD for a whole batch, step 1 (a=[[[name, size], ...], company key, day, origin]): one call makes the folders once and one Drive upload link per file
  admin_irUploadStartBatch: (me, a) => {
    const list = a[0] || [];
    const co = String(a[1] || ''), day = String(a[2] || ''), origin = String(a[3] || '');
    if (!IR_COMPANIES[co]) throw new Error('Pick the company first.');
    if (!IR_DAY_RE.test(day)) throw new Error('Pick the day (date).');
    if (!list.length || list.length > 60) throw new Error('Bad batch.');
    let folderId;
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { folderId = irSub_(irSub_(irSub_(irRoot_(true), IR_OPEN, true), IR_COMPANIES[co], true), day, true).getId(); }
    finally { lock.releaseLock(); }
    const token = ScriptApp.getOAuthToken(), okOrigin = /^[a-z][a-z0-9+.\-]*:\/\/[A-Za-z0-9.\-]+(:\d+)?$/i.test(origin);
    const meta = [], reqs = [];
    list.forEach((x, i) => {
      try {
        const name = irSafeName_(x[0]), size = Number(x[1]);
        const mime = IR_EXT[name.match(/\.([A-Za-z0-9]+)$/)[1].toLowerCase()];
        if (!(size > 0)) throw new Error('Empty file: ' + name);
        if (size > IR_MAX_DIRECT) throw new Error(name + ' is too big.');
        const headers = { Authorization: 'Bearer ' + token, 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) };
        if (okOrigin) headers.Origin = origin;
        reqs.push({ url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', method: 'post', contentType: 'application/json; charset=UTF-8',
          headers: headers, muteHttpExceptions: true, payload: JSON.stringify({ name: name, parents: [folderId], mimeType: mime }) });
        meta.push({ i: i, name: name });
      } catch (e) { meta.push({ i: i, error: String(e.message || e) }); }
    });
    const res = reqs.length ? UrlFetchApp.fetchAll(reqs) : [];
    let k = 0;
    return meta.map(m => {
      if (m.error) return { error: m.error };
      const r = res[k++];
      const h = r.getAllHeaders(), url = h.Location || h.location;
      return r.getResponseCode() === 200 && url ? { url: String(url), name: m.name } : { error: 'Drive did not start the upload (' + r.getResponseCode() + ').' };
    });
  },

  // FAST UPLOAD for a whole batch, step 2 (a=[[[file id, name], ...], company key, day]): one call checks all files landed in the folder and replaces older same-name files
  admin_irUploadDoneBatch: (me, a) => {
    const list = a[0] || [];
    const co = String(a[1] || ''), day = String(a[2] || '');
    if (!IR_COMPANIES[co]) throw new Error('Unknown company.');
    if (!IR_DAY_RE.test(day)) throw new Error('Bad day.');
    const root = irRoot_(false);
    const open = root && irSub_(root, IR_OPEN, false), comp = open && irSub_(open, IR_COMPANIES[co], false), folder = comp && irSub_(comp, day, false);
    if (!folder) throw new Error('Folder not found.');
    const mine = {}; list.forEach(x => { mine[String(x[0])] = irSafeName_(x[1]); });
    const seen = {}, olds = [];
    const it = folder.getFiles();
    while (it.hasNext()) { const f = it.next(); const id = f.getId(); if (mine[id]) seen[id] = true; else olds.push(f); }
    let replaced = 0;
    const names = {}; Object.keys(mine).forEach(id => { if (seen[id]) names[mine[id]] = true; });
    olds.forEach(f => { if (names[f.getName()]) { f.setTrashed(true); replaced++; } });
    try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
    const out = list.map(x => ({ id: String(x[0]), ok: !!seen[String(x[0])] }));
    apiLog_(me, 'IR files', 'Open / ' + IR_COMPANIES[co] + ' / ' + day + ' / ' + out.filter(o => o.ok).length + ' files (fast batch)' + (replaced ? ', ' + replaced + ' replaced' : ''));
    return { files: out, replaced: replaced };
  },

  // MOVE OLD CLOSED FILES, step 1: only LOOKS and gives the list to review. Nothing is changed. Admin only.
  admin_irMigratePlan: (me) => {
    if (me.role !== 'Admin') throw new Error('Admins only.');
    const scan = irMigScan_(), acc = irMigAccess_(scan, irMigEngNames_(scan));
    const groups = {};
    scan.moves.forEach(m => { const k = m.co + '|' + m.eng + '|' + m.day; groups[k] = (groups[k] || 0) + 1; });
    return {
      sig: irMigSig_(scan.moves), total: scan.moves.length, already: scan.already,
      groups: Object.keys(groups).map(k => { const x = k.split('|'); return { co: x[0], company: IR_COMPANIES[x[0]], eng: x[1], day: x[2], n: groups[k] }; }),
      access: acc
    };
  },

  // MOVE OLD CLOSED FILES, step 2 (a=[sig from the review, continuing?]): moves the files in small rounds (the app calls again until left is 0).
  // The first call refuses if the list changed since the review. When nothing is left it sets the access shown in the review and removes the empty old folders.
  admin_irMigrateRun: (me, a) => {
    if (me.role !== 'Admin') throw new Error('Admins only.');
    const sig = String(a[0] || ''), cont = !!a[1];
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      const scan = irMigScan_();
      if (!cont && irMigSig_(scan.moves) !== sig) throw new Error('The list changed since the review. Press Review again.');
      const root = irRoot_(false), t0 = Date.now(), folders = {};
      const target = (m) => {
        const k = m.co + '|' + m.eng + '|' + m.day;
        if (!folders[k]) folders[k] = irSub_(irSub_(irSub_(scan.closed, IR_COMPANIES[m.co], true), m.eng, true), m.day, true);
        return folders[k];
      };
      let moved = 0, left = 0; const failed = [];
      for (let i = 0; i < scan.moves.length; i++) {
        const m = scan.moves[i];
        if (Date.now() - t0 > 150000) { left = scan.moves.length - i; break; }
        try {
          const dest = target(m), dup = dest.getFilesByName(m.name);
          if (dup.hasNext()) { failed.push(m.name + ': a file with this name is already in the new folder'); continue; }
          DriveApp.getFileById(m.id).moveTo(dest); moved++;
        } catch (e) { failed.push(m.name + ': ' + (e && e.message || e)); }
      }
      let finish = null;
      if (!left) {
        // empty old folders (company / day / engineer) go to the bin
        scan.oldDays.forEach(d => {
          try {
            const day = DriveApp.getFolderById(d.id), es = day.getFolders();
            while (es.hasNext()) { const e = es.next(); if (!e.getFiles().hasNext() && !e.getFolders().hasNext()) e.setTrashed(true); }
            if (!day.getFiles().hasNext() && !day.getFolders().hasNext()) day.setTrashed(true);
          } catch (e) { console.warn('old folder: ' + e); }
        });
        const acc = irMigAccess_(scan, irMigEngNames_(irMigScan_()));
        const done = { granted: 0, revoked: 0, shared: 0 };
        acc.grant.forEach(e => { try { root.addViewer(e); done.granted++; } catch (x) { console.warn(x); } });
        acc.revoke.forEach(e => { try { root.removeViewer(e); done.revoked++; } catch (x) { console.warn(x); } });
        acc.share.forEach(x => {
          try {
            const f = irSub_(irSub_(scan.closed, IR_COMPANIES[x.co], false) || scan.closed, x.eng, false);
            if (f && IR_ENGINEER_ACCESS === 'edit') { f.addEditor(x.email); done.shared++; } else if (f) { f.addViewer(x.email); done.shared++; }
          } catch (e) { console.warn(e); }
        });
        finish = { granted: done.granted, revoked: done.revoked, shared: done.shared, unmatched: acc.unmatched };
      }
      try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
      apiLog_(me, 'IR closed move', moved + ' moved, ' + failed.length + ' failed, ' + left + ' left' + (finish ? '; access: +' + finish.granted + ' admin/DC, -' + finish.revoked + ' removed, ' + finish.shared + ' engineer folders shared' : ''));
      return { moved: moved, left: left, failed: failed.slice(0, 30), failedN: failed.length, finish: finish };
    } finally { lock.releaseLock(); }
  },

  // AUTO SORT upload, step 1 (a=[[[name, size], ...], day, origin]): one call makes the folders each file needs
  // (company / discipline / CIR|MIR / day, or Unsorted / day) and one Drive upload link per file. Answer per file: { url, name, sorted, path } or { error }.
  admin_irUploadStartAuto: (me, a) => {
    const list = a[0] || [];
    const day = String(a[1] || ''), origin = String(a[2] || '');
    if (!IR_DAY_RE.test(day)) throw new Error('Pick the day (date).');
    if (!list.length || list.length > 60) throw new Error('Bad batch.');
    const lock = LockService.getScriptLock(); lock.waitLock(25000);
    const meta = [], reqs = [], folders = {};
    try {
      const root = irRoot_(true);
      const token = ScriptApp.getOAuthToken(), okOrigin = /^[a-z][a-z0-9+.\-]*:\/\/[A-Za-z0-9.\-]+(:\d+)?$/i.test(origin);
      list.forEach((x, i) => {
        try {
          const name = irSafeName_(x[0]), size = Number(x[1]);
          const mime = IR_EXT[name.match(/\.([A-Za-z0-9]+)$/)[1].toLowerCase()];
          if (!(size > 0)) throw new Error('Empty file: ' + name);
          if (size > IR_MAX_DIRECT) throw new Error(name + ' is too big.');
          const info = irParse_(name), label = irPathLabel_(info, day);
          if (!folders[label]) folders[label] = irOpenDir_(root, info, day, true).getId();
          const headers = { Authorization: 'Bearer ' + token, 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) };
          if (okOrigin) headers.Origin = origin;
          reqs.push({ url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', method: 'post', contentType: 'application/json; charset=UTF-8',
            headers: headers, muteHttpExceptions: true, payload: JSON.stringify({ name: name, parents: [folders[label]], mimeType: mime }) });
          meta.push({ name: name, sorted: !!info, path: label });
        } catch (e) { meta.push({ error: String(e.message || e) }); }
      });
    } finally { lock.releaseLock(); }
    const res = reqs.length ? UrlFetchApp.fetchAll(reqs) : [];
    let k = 0;
    return meta.map(m => {
      if (m.error) return { error: m.error };
      const r = res[k++];
      const h = r.getAllHeaders(), url = h.Location || h.location;
      return r.getResponseCode() === 200 && url ? { url: String(url), name: m.name, sorted: m.sorted, path: m.path } : { error: 'Drive did not start the upload (' + r.getResponseCode() + ').' };
    });
  },

  // AUTO SORT upload, step 2 (a=[[[file id, name], ...], day]): checks each file landed in the folder its name points to and replaces older same-name files there
  admin_irUploadDoneAuto: (me, a) => {
    const list = a[0] || [], day = String(a[1] || '');
    if (!IR_DAY_RE.test(day)) throw new Error('Bad day.');
    const root = irRoot_(false);
    if (!root) throw new Error('Folder not found.');
    const out = []; let replaced = 0, un = 0;
    list.forEach(x => {
      try {
        const name = irSafeName_(x[1]), info = irParse_(name);
        const folder = irOpenDir_(root, info, day, false);
        const file = DriveApp.getFileById(String(x[0] || ''));
        let inside = false; const ps = file.getParents();
        while (ps.hasNext()) if (folder && ps.next().getId() === folder.getId()) inside = true;
        if (!folder || !inside || file.isTrashed() || file.getSize() <= 0) { out.push({ id: String(x[0]), ok: false }); return; }
        const old = folder.getFilesByName(name);
        while (old.hasNext()) { const o = old.next(); if (o.getId() !== file.getId()) { o.setTrashed(true); replaced++; } }
        if (!info) un++;
        out.push({ id: String(x[0]), ok: true, sorted: !!info, path: irPathLabel_(info, day) });
      } catch (e) { out.push({ id: String(x[0]), ok: false }); }
    });
    try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
    apiLog_(me, 'IR files', 'Open / auto sort / ' + day + ' / ' + out.filter(o => o.ok).length + ' files' + (un ? ', ' + un + ' unsorted' : '') + (replaced ? ', ' + replaced + ' replaced' : ''));
    return { files: out, replaced: replaced };
  },

  // FIX / REASSIGN one file (a=[file id, company key, discipline code, CIR|MIR, day]); company '' (empty) sends it to Unsorted
  admin_irMove: (me, a) => {
    const root = irRoot_(false);
    if (!root) throw new Error('No IR files folder yet.');
    const file = DriveApp.getFileById(String(a[0] || ''));
    const open = irSub_(root, IR_OPEN, false);
    if (!open || file.isTrashed() || !irInside_(file, open)) throw new Error('Only a file inside Open can be moved.');
    const co = String(a[1] || ''), disc = String(a[2] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), type = String(a[3] || ''), day = String(a[4] || '');
    if (!IR_DAY_RE.test(day)) throw new Error('Bad day.');
    let info = null;
    if (co) {
      if (!IR_COMPANIES[co] || co === 'OTHER') throw new Error('Pick the company.');
      if (disc.length < 2) throw new Error('Write the discipline (like ARC or STR).');
      if (!IR_TYPES[type]) throw new Error('Pick CIR or MIR.');
      info = { co: co, disc: disc, type: type };
    }
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const dest = irOpenDir_(root, info, day, true);
      const old = dest.getFilesByName(file.getName());
      while (old.hasNext()) { const o = old.next(); if (o.getId() !== file.getId()) o.setTrashed(true); }
      file.moveTo(dest);
      try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
      apiLog_(me, 'IR file moved', file.getName() + ' > Open / ' + irPathLabel_(info, day));
      return { path: irPathLabel_(info, day) };
    } finally { lock.releaseLock(); }
  },

  // ONE-TIME RE-ORGANISATION of the old files, step 1 = REVIEW ONLY (changes nothing).
  // Lists every file in Open that sits in the old layout (Open / company / day / file, or loose in Open / company) and where it would go.
  // Answer: { moves: [{ id, name, from, to, unsorted }], total }  (at most 400 shown)
  admin_irReorgPlan: () => {
    const root = irRoot_(false), open = root && irSub_(root, IR_OPEN, false);
    const moves = [];
    if (open) {
      const cs = open.getFolders();
      while (cs.hasNext()) {
        const c = cs.next(); if (c.isTrashed()) continue;
        const co = Object.keys(IR_COMPANIES).filter(k => IR_COMPANIES[k] === c.getName())[0];
        if (!co) continue;
        const take = (folder, day, label) => {
          const it = folder.getFiles();
          while (it.hasNext() && moves.length < 400) {
            const f = it.next(), info = irParse_(f.getName());
            const d = day || Utilities.formatDate(f.getDateCreated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
            // a file whose name says another company goes to that company
            const dest = info;
            moves.push({ id: f.getId(), name: f.getName(), from: label, to: 'Open / ' + irPathLabel_(dest, d), unsorted: !dest, day: d });
          }
        };
        take(c, '', 'Open / ' + c.getName());
        const ds = c.getFolders();
        while (ds.hasNext()) { const d = ds.next(); if (!d.isTrashed() && IR_DAY_RE.test(d.getName())) take(d, d.getName(), 'Open / ' + c.getName() + ' / ' + d.getName()); }
      }
    }
    return { moves: moves, total: moves.length, unsorted: moves.filter(m => m.unsorted).length };
  },

  // step 2 = after the admin / DC approved the review (a=[[file id, ...]], at most 40 per call; the app calls again for the rest)
  // Each file is moved to the place its name points to (the day stays the day it was in). Nothing is deleted.
  admin_irReorgApply: (me, a) => {
    const ids = (a[0] || []).slice(0, 40);
    const root = irRoot_(false), open = root && irSub_(root, IR_OPEN, false);
    if (!open) throw new Error('No Open folder.');
    let moved = 0, un = 0; const bad = [];
    const lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      ids.forEach(id => {
        try {
          const f = DriveApp.getFileById(String(id));
          if (f.isTrashed() || !irInside_(f, open)) { bad.push(String(id)); return; }
          const parents = f.getParents(); const p = parents.hasNext() ? parents.next() : null;
          const day = p && IR_DAY_RE.test(p.getName()) ? p.getName() : Utilities.formatDate(f.getDateCreated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
          const info = irParse_(f.getName());
          const dest = irOpenDir_(root, info, day, true);
          if (p && p.getId() === dest.getId()) return;
          const same = dest.getFilesByName(f.getName());
          if (same.hasNext()) { bad.push(f.getName() + ' (same name already there)'); return; }
          f.moveTo(dest); moved++; if (!info) un++;
        } catch (e) { bad.push(String(id)); }
      });
    } finally { lock.releaseLock(); }
    try { CacheService.getScriptCache().remove('ir_index3'); } catch (e) {}
    apiLog_(me, 'IR files re-organised', moved + ' moved' + (un ? ', ' + un + ' to Unsorted' : '') + (bad.length ? ', ' + bad.length + ' skipped' : ''));
    return { moved: moved, unsorted: un, bad: bad };
  },

  admin_irList: () => ({ files: irList_(), companies: IR_COMPANIES, folderUrl: (irRoot_(false) || { getUrl: () => '' }).getUrl() }),

  admin_irDelete: (me, a) => {
    const root = irRoot_(false);
    if (!root) throw new Error('No IR files folder yet.');
    const file = DriveApp.getFileById(String(a[0] || ''));
    if (!irInside_(file, root)) throw new Error('File not found.');
    file.setTrashed(true);
    CacheService.getScriptCache().remove('ir_index3');
    apiLog_(me, 'IR file removed', file.getName());
    return true;
  }
};
