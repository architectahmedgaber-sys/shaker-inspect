/**
 * Shaker Inspect · IrFiles.gs  (api-7)
 * The IR files (PDF / pictures downloaded from ACC) live in ONE Drive folder, "Shaker Inspect - IR Files",
 * organised like this (two main folders, then company, then day):
 *
 *     Shaker Inspect - IR Files / Open   / SH - EL-Shorouk / 2026-11-12 / <IR files as downloaded from ACC>
 *                                        / SQ - Square     / ...
 *                                        / AT - Alexandria / ...
 *                               / Closed / SH - EL-Shorouk / 2026-11-12 / <engineer who closed it> / <the IR form with Section C filled by the app>
 *                                        / ...
 *
 * The DC (or an admin) picks the company and the day when uploading from the app (Admin screen > IR files).
 * Every signed-in person can open the files inside the request screen, and open the Drive folder from the app.
 * Nobody needs an ACC account. Each approved person is given VIEW access to the folder (their Google email)
 * the first time they open the folder link.
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
const IR_OPEN = 'Open', IR_CLOSED = 'Closed';
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

// Closed / <company> / <day> / <engineer who closes the request>  (the engineer comes from the sign-in, never from the phone)
function irEngDir_(me) {
  const n = String((me && me.engineer) || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n || 'Unknown engineer';
}
function irClosedDir_(root, co, day, me, create) {
  let f = irSub_(root, IR_CLOSED, create);
  f = f && irSub_(f, IR_COMPANIES[co], create);
  f = f && irSub_(f, day, create);
  return f && irSub_(f, irEngDir_(me), create);
}

// every file under the root (root files, company/files, company/day/files)
function irList_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ir_index2');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const root = irRoot_(false);
  const out = [];
  function files(folder, co, day) {
    const it = folder.getFiles();
    while (it.hasNext() && out.length < 4000) {
      const x = it.next();
      out.push({ id: x.getId(), name: x.getName(), size: x.getSize(), t: x.getLastUpdated().getTime(), co: co, day: day });
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
        while (ds.hasNext()) { const d = ds.next(); if (!d.isTrashed() && IR_DAY_RE.test(d.getName())) files(d, key, d.getName()); }
      }
    };
    const open = irSub_(root, IR_OPEN, false);
    if (open) scan(open);
    scan(root);                          // files uploaded before the Open / Closed folders existed
  }
  out.sort((a, b) => a.name < b.name ? -1 : 1);
  try { cache.put('ir_index2', JSON.stringify(out), 120); } catch (e) {}   // too big for the cache = just read again next time
  return out;
}

function irSafeName_(n) {
  const s = String(n || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  const m = s.match(/\.([A-Za-z0-9]+)$/);
  if (!m || !IR_EXT[m[1].toLowerCase()]) throw new Error('Only PDF, JPG or PNG files: ' + s);
  return s;
}

// is this file somewhere inside the IR folder (up to 5 levels)?
function irInside_(file, root) {
  let level = file.getParents();
  for (let i = 0; i < 5; i++) {
    const next = [];
    while (level.hasNext()) { const p = level.next(); if (p.getId() === root.getId()) return true; const up = p.getParents(); while (up.hasNext()) next.push(up.next()); }
    if (!next.length) return false;
    level = { hasNext: () => next.length > 0, next: () => next.shift() };
  }
  return false;
}

// give this person view access to the whole IR folder (their Google email), once every 6 hours
function irShare_(me) {
  const key = 'irshare_' + String(me.email || '').toLowerCase();
  const cache = CacheService.getScriptCache();
  if (!me.email || cache.get(key)) return;
  const root = irRoot_(false);
  if (root) { try { root.addViewer(me.email); } catch (e) { console.warn('share: ' + e); } }
  try { cache.put(key, '1', 21600); } catch (e) {}
}

const IR_FUNCS_ = {
  // names of all the IR files (the app matches them to requests by the number in the name)
  ir_index: () => ({ files: irList_(), companies: IR_COMPANIES }),

  // the Drive links: main folder, each company, and each day inside it (newest first)
  ir_links: (me) => {
    const root = irRoot_(false);
    if (!root) return { root: '', open: [], closed: [] };
    irShare_(me);
    const list = (parent) => {
      const out = [];
      if (!parent) return out;
      Object.keys(IR_COMPANIES).forEach(k => {
        const c = irSub_(parent, IR_COMPANIES[k], false); if (!c) return;
        const days = [];
        const ds = c.getFolders();
        while (ds.hasNext()) { const d = ds.next(); if (!d.isTrashed() && IR_DAY_RE.test(d.getName())) days.push({ day: d.getName(), url: d.getUrl() }); }
        days.sort((a, b) => a.day < b.day ? 1 : -1);
        out.push({ key: k, name: IR_COMPANIES[k], url: c.getUrl(), days: days.slice(0, 31) });
      });
      return out;
    };
    const open = irSub_(root, IR_OPEN, false), closed = irSub_(root, IR_CLOSED, false);
    return { root: root.getUrl(), openUrl: open ? open.getUrl() : '', closedUrl: closed ? closed.getUrl() : '', open: list(open), closed: list(closed) };
  },

  // the app fills Section C of the IR form when a request is closed and saves the filled PDF here:
  // Closed / <company> / <day of the close> / <engineer> / <same file name>   a=[company key, day, file name, base64]
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
      const folder = irClosedDir_(root, co, day, me, true);
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
      try { CacheService.getScriptCache().remove('ir_index2'); } catch (e) {}
      apiLog_(me, 'IR form filled', 'Closed / ' + IR_COMPANIES[co] + ' / ' + day + ' / ' + irEngDir_(me) + ' / ' + name + (moved ? ' (original removed from Open)' : ''));
      return { id: file.getId(), url: folder.getUrl(), moved: moved };
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
    try { folderId = irClosedDir_(irRoot_(true), co, day, me, true).getId(); }
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
    try { CacheService.getScriptCache().remove('ir_index2'); } catch (e) {}
    apiLog_(me, 'IR form filled', 'Closed / ' + IR_COMPANIES[co] + ' / ' + day + ' / ' + irEngDir_(me) + ' / ' + name + (moved ? ' (original removed from Open)' : '') + ' (direct)');
    return { id: file.getId(), url: folder.getUrl(), moved: moved };
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
    if (!IR_COMPANIES[co]) throw new Error('Pick the company first.');
    if (!IR_DAY_RE.test(day)) throw new Error('Pick the day (date).');
    const bytes = Utilities.base64Decode(String(a[1] || ''));
    if (!bytes.length) throw new Error('Empty file: ' + name);
    if (bytes.length > IR_MAX_UPLOAD) throw new Error(name + ' is bigger than ' + Math.round(IR_MAX_UPLOAD / 1048576) + ' MB.');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const root = irRoot_(true);
      const folder = irSub_(irSub_(irSub_(root, IR_OPEN, true), IR_COMPANIES[co], true), day, true);
      const old = folder.getFilesByName(name);
      let replaced = false;
      while (old.hasNext()) { old.next().setTrashed(true); replaced = true; }
      const file = folder.createFile(Utilities.newBlob(bytes, IR_EXT[ext], name));
      CacheService.getScriptCache().remove('ir_index2');
      apiLog_(me, 'IR file', 'Open / ' + IR_COMPANIES[co] + ' / ' + day + ' / ' + name + (replaced ? ' (replaced)' : ''));
      return { id: file.getId(), name: name, replaced: replaced };
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
    try { CacheService.getScriptCache().remove('ir_index2'); } catch (e) {}
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
    try { CacheService.getScriptCache().remove('ir_index2'); } catch (e) {}
    const out = list.map(x => ({ id: String(x[0]), ok: !!seen[String(x[0])] }));
    apiLog_(me, 'IR files', 'Open / ' + IR_COMPANIES[co] + ' / ' + day + ' / ' + out.filter(o => o.ok).length + ' files (fast batch)' + (replaced ? ', ' + replaced + ' replaced' : ''));
    return { files: out, replaced: replaced };
  },

  admin_irList: () => ({ files: irList_(), companies: IR_COMPANIES, folderUrl: (irRoot_(false) || { getUrl: () => '' }).getUrl() }),

  admin_irDelete: (me, a) => {
    const root = irRoot_(false);
    if (!root) throw new Error('No IR files folder yet.');
    const file = DriveApp.getFileById(String(a[0] || ''));
    if (!irInside_(file, root)) throw new Error('File not found.');
    file.setTrashed(true);
    CacheService.getScriptCache().remove('ir_index2');
    apiLog_(me, 'IR file removed', file.getName());
    return true;
  }
};
