/* Shaker Inspect · the IR itself inside the request screen.
   - "From → to" line (who sent it, reviewers, who has the ball, due date) from the ACC report rows in the sheet.
   - The IR file (PDF / pictures) and its attachments, opened inside the app. The admin uploads the files
     from the ACC downloads (Admin > IR files); nobody needs an ACC account. Needs api-7 (IrFiles.gs + Code.gs).
   - Prerequisites before the activity (e.g. electrical and mechanical approvals before plaster accessories):
     the engineer marks each one Present / Missing / Not needed. A missing one suggests Code C with a ready note.
   Loaded after app-social.js. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (fn, args) => PtahApp.call(fn, args || []);
  const AR = () => { try { return JSON.parse(localStorage.getItem('shkLang') || '"en"') === 'ar'; } catch (e) { return false; } };
  const t = (en, ar) => AR() ? ar : en;
  const isAdmin = () => PtahApp.role() === 'Admin' || PtahApp.role() === 'DC';   // Admin or DC (document controller)
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ---------------------------------------------------------------- prerequisites (non-spec, shown as [NS])
  // Key = checklist code. Edit this list to change what is asked. Text is Arabic (the lists are Arabic).
  const PREREQ = {
    '09 24 00-2': ['اعتماد أعمال الكهرباء (مواسير وعلب) قبل إكسسوارات المحارة', 'اعتماد أعمال الميكانيكا (سباكة وتكييف) قبل إكسسوارات المحارة'],
    '09 24 00-3': ['اعتماد أعمال الكهرباء', 'اعتماد أعمال الميكانيكا', 'اعتماد إكسسوارات المحارة']
  };
  const NOTE_MARK = '[NS-prereq]';

  // ---------------------------------------------------------------- matching a request to its files
  let index = null, indexAt = 0, indexBusy = null;
  async function loadIndex(force) {
    if (!force && index && Date.now() - indexAt < 120000) return index;
    if (indexBusy) return indexBusy;
    indexBusy = api('ir_index').then(r => { index = (r && r.files) || []; indexAt = Date.now(); return index; })
      .catch(e => { if (!index) index = null; throw e; }).finally(() => { indexBusy = null; });
    return indexBusy;
  }
  const getProjectKey = item => { try { return getProject(item); } catch (e) { return ''; } };
  const keyOf = item => { const m = String(item.irNumber || '').match(/(\d{3,})\D*$/); return m ? m[1] : ''; };
  function filesFor(item) {
    const k = keyOf(item); if (!k || !index) return [];
    const re = new RegExp('(^|\\D)0*' + k.replace(/^0+/, '') + '(\\D|$)');
    const hits = index.filter(f => re.test(f.name));
    const rev = String(item.rev || '0');
    const revRe = new RegExp('(rev|r)[\\s._-]*0*' + rev + '(\\D|$)', 'i');
    hits.sort((a, b) => (revRe.test(b.name) - revRe.test(a.name)) || (a.name < b.name ? -1 : 1));
    return hits;
  }

  // ---------------------------------------------------------------- the panel inside the request screen
  let cur = null, curFile = null, loadSeq = 0;
  function inject() {
    if ($('irBox')) return;
    const d = $('modalDesc'); if (!d) return;
    d.insertAdjacentHTML('afterend', '<div id="irBox" class="ir-box"></div>');
    $('irBox').addEventListener('click', onClick);
    const cc = $('clCode');
    if (cc) new MutationObserver(() => { if (cur) paintPrereq(); }).observe(cc, { childList: true, characterData: true, subtree: true });
  }

  function fromTo(item) {
    const parts = [];
    const who = item.createdBy || item.contractor;
    if (who) parts.push(`<span class="ir-p"><small>${t('From', 'من')}</small><b>${esc(who)}</b>${item.createdBy && item.contractor ? `<em>${esc(item.contractor)}</em>` : ''}</span>`);
    const to = item.ballInCourt || item.pendingFrom || item.manager;
    if (to) parts.push(`<span class="ir-p"><small>${t('To', 'إلى')}</small><b>${esc(to)}</b>${item.manager && to !== item.manager ? `<em>${t('Manager', 'المدير')}: ${esc(item.manager)}</em>` : ''}</span>`);
    if (!parts.length) return '';
    const rv = item.reviewers ? `<div class="ir-sub">${t('Reviewers', 'المراجعون')}: ${esc(item.reviewers)}</div>` : '';
    const st = [item.accStatus, item.dueDate ? t('Due ', 'الموعد ') + item.dueDate : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="ir-ft">${parts.join('<span class="ir-arrow">→</span>')}</div>${rv}${st ? `<div class="ir-sub">${st}</div>` : ''}`;
  }

  function paint() {
    const box = $('irBox'); if (!box || !cur) return;
    box.innerHTML = fromTo(cur) +
      '<div class="ir-files" id="irFiles"></div><div class="ir-view" id="irView" hidden></div><div class="ir-pre" id="irPre"></div>';
    paintFiles(); paintPrereq();
  }

  function paintFiles() {
    const el = $('irFiles'); if (!el || !cur) return;
    if (index === null) { el.innerHTML = `<span class="ir-none">${t('IR file: loading…', 'ملف الـ IR: بيحمّل…')}</span>`; return; }
    const hits = filesFor(cur);
    const fb = `<button type="button" class="ir-lnk" data-ir="folders">📁 ${t('Folders', 'الفولدرات')}</button>`;
    if (!hits.length) {
      el.innerHTML = fb + `<span class="ir-none">⚠ ${t('The IR file is not uploaded yet.', 'ملف الـ IR لسه مترفعش.')}</span>${isAdmin() ? `<button type="button" class="ir-lnk" data-ir="admin">${t('Upload IR files', 'ارفع ملفات الـ IR')}</button>` : ''}`;
      return;
    }
    el.innerHTML = fb + `<div class="ir-chips">${hits.map(f => `<button type="button" class="ir-chip${curFile === f.id ? ' on' : ''}" data-ir="open" data-id="${esc(f.id)}">📄 ${esc(f.name.replace(/\.[^.]+$/, ''))}</button>`).join('')}</div>` +
      (curFile ? '' : `<small class="ir-hint">${t('Tap a file to look at it before you decide.', 'دوس على الملف تشوفه قبل ما تقرر.')}</small>`);
  }

  // ---------------------------------------------------------------- viewer (pdf.js drawn to canvas; works in the Android app too)
  const BIG_FILE = 12 * 1048576;      // bigger than this is opened on Drive (the server can only send up to 20 MB and phones struggle before that)
  let pdfLib = null;
  function loadPdfJs() {
    if (window.pdfjsLib) { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return Promise.resolve(window.pdfjsLib); }
    if (pdfLib) return pdfLib;
    pdfLib = new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = PDFJS; s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(window.pdfjsLib); };
      s.onerror = () => { pdfLib = null; bad(new Error('pdf.js')); }; document.head.appendChild(s);
    });
    return pdfLib;
  }
  const b64bytes = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  // zoom of the open file: the + / - buttons and pinching with two fingers. `after` is called (once the finger stops) so a PDF is redrawn sharp.
  const ZSTEPS = [1, 1.5, 2, 3, 4];
  let zoomSet = null;
  function bindZoom(after) {
    const host = $('irPages'), zw = $('irZw'), lab = $('irZ'); if (!host || !zw) return;
    let z = 1, timer = 0;
    const apply = (nz, redraw) => {
      nz = Math.max(1, Math.min(4, nz));
      const cx = (host.scrollLeft + host.clientWidth / 2) / Math.max(1, host.scrollWidth), cy = (host.scrollTop + host.clientHeight / 2) / Math.max(1, host.scrollHeight);
      z = nz; zw.style.width = Math.round(z * 100) + '%'; if (lab) lab.textContent = Math.round(z * 100) + '%';
      host.scrollLeft = cx * host.scrollWidth - host.clientWidth / 2; host.scrollTop = cy * host.scrollHeight - host.clientHeight / 2;
      clearTimeout(timer); if (after) timer = setTimeout(() => after(z), redraw ? 0 : 280);
    };
    zoomSet = dir => { const i = ZSTEPS.findIndex(x => x >= z - 0.01); const cur = i < 0 ? ZSTEPS.length - 1 : i; apply(ZSTEPS[Math.max(0, Math.min(ZSTEPS.length - 1, cur + dir))], true); };
    let d0 = 0, z0 = 1;
    const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    host.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = dist(e); z0 = z; } }, { passive: true });
    host.addEventListener('touchmove', e => { if (e.touches.length === 2 && d0) apply(z0 * dist(e) / d0, false); }, { passive: true });
    host.addEventListener('touchend', e => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  }

  async function openFile(id, name) {
    const v = $('irView'); if (!v) return;
    const seq = ++loadSeq; curFile = id; zoomSet = null; paintFiles();
    v.hidden = false; v.innerHTML = `<div class="ir-load">${t('Opening…', 'بيفتح…')}</div>`;
    const meta = (index || []).find(x => x.id === id);
    if (meta && meta.size > BIG_FILE) {       // too big to bring into the phone through the server: open it on Drive itself
      try { api('ir_links').catch(() => {}); } catch (e) {}      // makes sure this person has view access to the folder
      const mb = Math.round(meta.size / 1048576);
      v.innerHTML = `<div class="ir-bar"><b dir="auto">${esc(meta.name)}</b><button type="button" class="ir-lnk" data-ir="hide">${t('Hide', 'اخفي')}</button></div>
        <div class="ir-load">${t('This file is big (' + mb + ' MB), so it opens on Google Drive.', 'الملف كبير (' + mb + ' ميجا) فبيتفتح على جوجل درايف.')}<br><a class="ir-lnk ir-big" href="https://drive.google.com/file/d/${encodeURIComponent(id)}/view" target="_blank" rel="noopener">${t('Open on Drive', 'افتحه على الدرايف')}</a></div>`;
      return;
    }
    try {
      const f = await api('ir_get', [id]);
      if (seq !== loadSeq) return;
      const bytes = b64bytes(f.b64), blob = new Blob([bytes], { type: f.mime });
      const url = URL.createObjectURL(blob);
      const zc = `<span class="ir-zm"><button type="button" class="ir-lnk" data-ir="zout" aria-label="Zoom out">−</button><b id="irZ">100%</b><button type="button" class="ir-lnk" data-ir="zin" aria-label="Zoom in">+</button></span>`;
      const bar = `<div class="ir-bar"><b dir="auto">${esc(f.name)}</b>${zc}<a class="ir-lnk" href="${url}" target="_blank" rel="noopener" download="${esc(f.name)}">${t('Open / save', 'فتح / حفظ')}</a><button type="button" class="ir-lnk" data-ir="hide">${t('Hide', 'اخفي')}</button></div>`;
      if (/^image\//.test(f.mime)) {
        v.innerHTML = bar + `<div class="ir-pages" id="irPages"><div class="ir-zw" id="irZw"><img src="${url}" alt=""></div></div>`;
        bindZoom(null); return;
      }
      v.innerHTML = bar + `<div class="ir-pages" id="irPages"><div class="ir-load">${t('Drawing pages…', 'بيرسم الصفحات…')}</div></div>`;
      let lib; try { lib = await loadPdfJs(); } catch (e) { $('irPages').innerHTML = `<div class="ir-load">${t('Could not load the viewer. Use "Open / save".', 'العارض مفتحش. استخدم "فتح / حفظ".')}</div>`; return; }
      const doc = await lib.getDocument({ data: bytes }).promise;
      if (seq !== loadSeq) return;
      const host = $('irPages'); host.innerHTML = '<div class="ir-zw" id="irZw"></div>';
      const zw = $('irZw');
      const baseW = Math.min(host.clientWidth || 360, 900), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const n = Math.min(doc.numPages, 30);
      const pages = [];
      for (let p = 1; p <= n; p++) {
        const pg = await doc.getPage(p); if (seq !== loadSeq) return;
        const vp0 = pg.getViewport({ scale: 1 });
        const c = document.createElement('canvas'); c.style.aspectRatio = vp0.width + ' / ' + vp0.height;
        zw.appendChild(c); pages.push({ pg: pg, c: c, w: vp0.width, z: 0 });
      }
      // pages are drawn when they come near the screen, at the sharpness of the current zoom (a page is redrawn after a zoom)
      let zoomNow = 1, queue = Promise.resolve();
      const draw = pg => { queue = queue.then(async () => {
        if (seq !== loadSeq || pg.z === zoomNow) return;
        const z = zoomNow, sc = Math.min((baseW * z / pg.w) * dpr, 3000 / pg.w), vp = pg.pg.getViewport({ scale: sc });
        pg.c.width = vp.width; pg.c.height = vp.height;
        await pg.pg.render({ canvasContext: pg.c.getContext('2d'), viewport: vp }).promise; pg.z = z;
      }).catch(() => {}); };
      let io = null;
      const watch = () => {
        if (io) io.disconnect();
        io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const pg = pages.find(x => x.c === e.target); if (pg) draw(pg); } }), { root: host, rootMargin: '500px 0px' });
        pages.forEach(pg => io.observe(pg.c));
      };
      bindZoom(z => { zoomNow = z; pages.forEach(pg => { if (pg.z !== z && pg.z) { pg.c.width = 1; pg.c.height = 1; pg.z = 0; } }); watch(); });
      watch();
      if (doc.numPages > n) host.insertAdjacentHTML('beforeend', `<div class="ir-load">${t('Only the first 30 pages are shown. Use "Open / save" for the rest.', 'ظاهر أول 30 صفحة بس. استخدم "فتح / حفظ" للباقي.')}</div>`);
    } catch (e) {
      if (seq === loadSeq) v.innerHTML = `<div class="ir-load bad">${esc(e.message || e)}</div>`;
    }
  }

  // ---------------------------------------------------------------- prerequisites
  const skey = () => cur ? 'shkPre:' + cur.irNumber + ':' + (cur.rev || '0') : '';
  const getSt = () => { try { return JSON.parse(localStorage.getItem(skey()) || '{}'); } catch (e) { return {}; } };
  const setSt = o => { try { localStorage.setItem(skey(), JSON.stringify(o)); } catch (e) {} };
  const codeNow = () => { try { return (typeof clCurrent !== 'undefined' && clCurrent && clCurrent.code) || ''; } catch (e) { return ''; } };

  function paintPrereq() {
    const el = $('irPre'); if (!el || !cur) return;
    const rules = PREREQ[codeNow()];
    if (!rules) { el.innerHTML = ''; return; }
    const st = getSt();
    const miss = rules.filter((r, i) => st[i] === 'm');
    el.innerHTML = `<div class="ir-ph"><b>${t('Before this work', 'قبل الشغل ده')}</b><span class="ir-ns">[NS] ${t('not from SPECS', 'مش من SPECS')}</span></div>` +
      rules.map((r, i) => `<div class="ir-rule"><span dir="auto">${esc(r)}</span><span class="ir-3">
        <button type="button" data-ir="st" data-i="${i}" data-v="y" class="${st[i] === 'y' ? 'on y' : ''}">${t('Present', 'موجود')}</button>
        <button type="button" data-ir="st" data-i="${i}" data-v="m" class="${st[i] === 'm' ? 'on m' : ''}">${t('Missing', 'ناقص')}</button>
        <button type="button" data-ir="st" data-i="${i}" data-v="n" class="${st[i] === 'n' ? 'on' : ''}">${t('Not needed', 'مش لازم')}</button></span></div>`).join('') +
      (miss.length ? `<div class="ir-warn">⚠ ${t('Something is missing: Code C is suggested.', 'في حاجة ناقصة: الأنسب Code C.')}<button type="button" class="ir-lnk" data-ir="codec">${t('Set Code C + note', 'حط Code C والملاحظة')}</button></div>` : '');
  }

  function applyCodeC() {
    const rules = PREREQ[codeNow()] || [], st = getSt();
    const miss = rules.filter((r, i) => st[i] === 'm');
    if (!miss.length) return;
    try { selectCode('C'); } catch (e) {}
    const ta = $('modalNotes'); if (!ta) return;
    const line = 'ناقص قبل الاستلام ' + NOTE_MARK + ': ' + miss.join('، ');
    const cleaned = ta.value.split('\n').filter(l => l.indexOf(NOTE_MARK) < 0).join('\n').trim();
    ta.value = (cleaned ? cleaned + '\n' : '') + line;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onClick(ev) {
    const b = ev.target.closest('[data-ir]'); if (!b) return;
    const k = b.dataset.ir;
    if (k === 'open') return openFile(b.dataset.id);
    if (k === 'zin' || k === 'zout') { if (zoomSet) zoomSet(k === 'zin' ? 1 : -1); return; }
    if (k === 'hide') { loadSeq++; curFile = null; $('irView').hidden = true; $('irView').innerHTML = ''; return paintFiles(); }
    if (k === 'st') { const st = getSt(); const i = b.dataset.i; if (st[i] === b.dataset.v) delete st[i]; else st[i] = b.dataset.v; setSt(st); return paintPrereq(); }
    if (k === 'codec') return applyCodeC();
    if (k === 'folders') return openFolders(cur && getProjectKey(cur));
    if (k === 'admin') { if (window.closeModal) try { closeModal(); } catch (e) {} return Shk.openAdmin('ir'); }
  }

  // ---------------------------------------------------------------- open a request
  const baseOpen = window.openModal;
  window.openModal = function (item) {
    const r = baseOpen.apply(this, arguments);
    try {
      inject(); cur = item; curFile = null; loadSeq++;
      paint();
      loadIndex().then(() => { if (cur === item) paintFiles(); }).catch(() => { if (cur === item && $('irFiles')) $('irFiles').innerHTML = `<span class="ir-none">${t('IR files: could not load the list.', 'ملفات الـ IR: القايمة مفتحتش.')}</span>`; });
    } catch (e) { console.warn(e); }
    return r;
  };
  const baseHide = window.hidePanel;
  if (typeof baseHide === 'function') window.hidePanel = function () { cur = null; loadSeq++; return baseHide.apply(this, arguments); };

  // ---------------------------------------------------------------- Drive folders sheet (everybody)
  async function openFolders(prefer) {
    let sh = $('irSheet');
    if (!sh) { sh = document.createElement('div'); sh.id = 'irSheet'; sh.className = 'ir-sheet'; document.body.appendChild(sh);
      sh.addEventListener('click', e => { if (e.target.closest('[data-irrf]')) return openFolders(sh._prefer); if (e.target === sh || e.target.closest('[data-irx]')) sh.classList.remove('open'); }); }
    sh._prefer = prefer;
    sh.innerHTML = `<div class="ir-sheet-box"><div class="ir-sheet-h"><b>${t('IR files on Drive', 'ملفات الـ IR على الدرايف')}</b><span><button type="button" data-irrf="1" class="ir-lnk" aria-label="Refresh" title="Refresh">⟳</button><button type="button" data-irx="1" class="ir-lnk">✕</button></span></div><div class="ir-load">${t('Loading…', 'بيحمّل…')}</div></div>`;
    sh.classList.add('open');
    try {
      const r = (await api('ir_links')) || {};
      const box = sh.querySelector('.ir-sheet-box');
      const sect = (title, url, list) => {
        const cos = (list || []).slice().sort((a, b) => (b.key === prefer) - (a.key === prefer));
        return `<h4 class="ir-sec">${title}</h4>` + (url ? `<a class="ir-go" href="${esc(url)}" target="_blank" rel="noopener">📁 ${title} · ${t('all companies', 'كل الشركات')}</a>` : '') +
          (cos.length ? cos.map(c => `<div class="ir-co"><a class="ir-go" href="${esc(c.url)}" target="_blank" rel="noopener">📁 ${esc(c.name)}</a>
            <div class="ir-days">${c.days.length ? c.days.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.day)}</a>`).join('') : `<small class="ir-hint">${t('No days yet.', 'مفيش أيام لسه.')}</small>`}</div></div>`).join('') : `<small class="ir-hint">${t('Nothing here yet.', 'مفيش حاجة هنا لسه.')}</small>`);
      };
      box.innerHTML = `<div class="ir-sheet-h"><b>${t('IR files on Drive', 'ملفات الـ IR على الدرايف')}</b><span><button type="button" data-irrf="1" class="ir-lnk" aria-label="Refresh" title="Refresh">⟳</button><button type="button" data-irx="1" class="ir-lnk">✕</button></span></div>` +
        sect(t('Open', 'Open (لسه متقفلتش)'), r.openUrl, r.open) + sect(t('Closed', 'Closed (الفورم مملية)'), r.closedUrl, r.closed) +
        `<small class="ir-hint">${t('If Drive asks for access, sign in with the same Google account you use in the app.', 'لو الدرايف طلب إذن، ادخل بنفس حساب جوجل اللي بتستخدمه في الأبليكيشن.')}</small>`;
    } catch (e) { sh.querySelector('.ir-sheet-box').innerHTML += `<div class="ir-load bad">${esc(e.message || e)}</div>`; }
  }

  // ---------------------------------------------------------------- admin screen: IR files
  const COMPANIES = [['SH', 'SH · EL-Shorouk'], ['SQ', 'SQ · Square'], ['AT', 'AT · Alexandria'], ['OTHER', 'Other']];
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const pathOf = f => f.co ? ((COMPANIES.find(c => c[0] === f.co) || [0, f.co])[1]) + (f.day ? ' / ' + f.day : '') : t('(no company)', '(من غير شركة)');
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const toB64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => bad(new Error('read')); r.readAsDataURL(f); });

  // fast upload: the phone sends the file straight to a one-time Drive link made by the server (the folders and names are still decided by the server)
  const UP_PARALLEL = 5, LINK_CHUNK = 15, DONE_CHUNK = 40;
  let fastOff = false;                    // set when the fast way fails once: the rest of the files use the old way
  function putToDrive(url, file, onProg) {
    return new Promise((ok, bad) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url, true);
      x.setRequestHeader('Content-Type', file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream'));
      x.upload.onprogress = e => { try { if (e.lengthComputable) onProg(e.loaded / e.total); } catch (z) {} };
      x.onerror = x.ontimeout = x.onabort = () => bad(new Error('direct upload failed'));
      x.onload = () => { let o = null; try { o = JSON.parse(x.responseText); } catch (e) {} (x.status >= 200 && x.status < 300 && o && o.id) ? ok(o) : bad(new Error('direct upload refused (' + x.status + ')')); };
      x.send(file);
    });
  }
  // one bar for the whole batch, moved by the bytes of all files being sent
  function paintBatch(out, st, finished) {
    const total = st.reduce((a, f) => a + f.size, 0) || 1, sent = st.reduce((a, f) => a + Math.min(f.sent, f.size), 0);
    const pct = Math.max(0, Math.min(100, Math.round(sent / total * 100)));
    const live = st.filter(f => f.phase === 'send' || f.phase === 'save' || f.phase === 'read');
    const saving = live.length && live.every(f => f.phase === 'save');
    out.innerHTML = `<div class="ir-prog${saving ? ' busy' : ''}"><span class="ir-progfill" style="width:${pct}%"></span></div>
      <div class="ir-barx"><b>${finished} / ${st.length}</b> · ${saving ? t('Saving on Drive…', 'بيتحفظ على الدرايف…') : t('Sending ', 'بيتبعت ') + pct + '%'}</div>` +
      live.slice(0, 3).map(f => `<div class="ir-barx"><span class="ir-barn">${esc(f.name)}</span></div>`).join('');
  }
  // upload progress: one bar for the whole batch; while a file is being sent it moves with the bytes, then "saving on Drive" (the server is working, no percentage)
  function paintUp(out, i, n, name, f, phase) {
    const pct = Math.max(0, Math.min(100, Math.round(((i + (phase === 'save' ? 1 : phase === 'send' ? f * 0.95 : 0)) / n) * 100)));
    const msg = phase === 'save' ? t('Saving on Drive…', 'بيتحفظ على الدرايف…') : phase === 'send' ? t('Sending ', 'بيتبعت ') + Math.round(f * 100) + '%' : t('Reading the file…', 'بيقرأ الملف…');
    out.innerHTML = `<div class="ir-prog${phase === 'save' ? ' busy' : ''}"><span class="ir-progfill" style="width:${pct}%"></span></div>
      <div class="ir-barx"><b>${i + 1} / ${n}</b> · <span class="ir-barn">${esc(name)}</span></div><div class="ir-barx">${msg}</div>`;
  }
  async function admIr() {
    const b = $('scBody'); if (!b) return;
    b.innerHTML = `<h3 class="sc-h">${t('IR files', 'ملفات الـ IR')}</h3>
      <div class="card"><p class="small" style="margin:0 0 8px">${t('Download the IR files from ACC (PDF or pictures) and choose them here, many at once. The app matches each file to its request by the IR number inside the file name. Attachments that have the same number in the name show up beside it.', 'نزّل ملفات الـ IR من ACC (PDF أو صور) واختارها هنا مرة واحدة. الأبليكيشن بيربط كل ملف بالطلب من رقم الـ IR في اسم الملف. المرفقات اللي فيها نفس الرقم في الاسم بتظهر جنبه.')}</p>
        <div class="ir-sel"><label>${t('Company', 'الشركة')}<select id="irCo" class="sc-in"><option value="">${t('Choose the company…', 'اختار الشركة…')}</option>${COMPANIES.map(c => `<option value="${c[0]}"${lsGet('shkIrCo') === c[0] ? ' selected' : ''}>${esc(c[1])}</option>`).join('')}</select></label>
          <label>${t('Work of the day', 'شغل يوم')}<input type="date" id="irDay" class="sc-in" value="${today()}"></label></div>
        <div class="btnrow"><label class="ir-pick" id="irPickLab"><input type="file" id="irPick" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" multiple hidden>${t('Choose files', 'اختار الملفات')}</label></div>
        <div id="irUp" class="small" style="margin-top:8px"></div></div>
      <div id="irList"><div class="sc-load"><i></i><i></i><i></i></div></div><p class="shk-sign">architected by Ptah</p>`;
    const gate = () => { const ok = !!$('irCo').value && !!$('irDay').value; $('irPickLab').classList.toggle('off', !ok); $('irPick').disabled = !ok; try { lsSet('shkIrCo', $('irCo').value); } catch (e) {} };
    $('irCo').onchange = $('irDay').onchange = gate; gate();
    $('irPick').onchange = async e => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      const co = $('irCo').value, day = $('irDay').value;
      if (!co || !day) { $('irUp').textContent = t('Choose the company and the day first.', 'اختار الشركة واليوم الأول.'); return; }
      const out = $('irUp'); let ok = 0, fast = 0, finished = 0; const bad = [];
      // up to 3 files at once; each one goes straight to Drive (fast) and falls back to the old way through the server
      const st = files.map(f => ({ name: f.name, size: f.size || 1, sent: 0, phase: 'wait' }));
      const paint = () => paintBatch(out, st, finished);
      const slow = async (f, i) => {
        st[i].phase = 'read'; paint();
        const b64 = await toB64(f);
        st[i].phase = 'send'; paint();
        await PtahApp.call('admin_irUpload', [f.name, b64, co, day], (fr, done) => { st[i].sent = st[i].size * (done ? 0.95 : fr * 0.95); st[i].phase = done ? 'save' : 'send'; paint(); });
      };
      // links for a whole chunk of files in ONE server call (fast); if the server is older, one call per file; if that fails too, the old way
      const chunkP = {}, batchOk = { v: true }, pend = [], flushing = [];
      const linkFor = async i => {
        if (!batchOk.v) return null;
        const c = Math.floor(i / LINK_CHUNK);
        if (!chunkP[c]) {
          const part = files.slice(c * LINK_CHUNK, (c + 1) * LINK_CHUNK);
          chunkP[c] = PtahApp.call('admin_irUploadStartBatch', [part.map(f => [f.name, f.size]), co, day, location.origin]).catch(er => { if (er && er.net) throw er; batchOk.v = false; return null; });
        }
        const r = await chunkP[c];
        return r && r[i - c * LINK_CHUNK] && r[i - c * LINK_CHUNK].url ? r[i - c * LINK_CHUNK].url : null;
      };
      const flush = (all) => {
        while (pend.length >= (all ? 1 : DONE_CHUNK)) {
          const part = pend.splice(0, DONE_CHUNK);
          flushing.push(PtahApp.call('admin_irUploadDoneBatch', [part.map(x => [x.id, x.name]), co, day]).then(r => { (r.files || []).forEach((x, k) => { if (!x.ok) bad.push(part[k].name + ': ' + t('did not arrive on Drive', 'ماوصلش الدرايف')); }); }).catch(er => { bad.push(t('Could not confirm ', 'مقدرتش أأكد ') + part.length + t(' files: ', ' ملف: ') + (er.message || er)); }));
        }
      };
      const one = async i => {
        const f = files[i];
        try {
          if (!fastOff) {
            let url = await linkFor(i), perFile = false;
            if (!url && !batchOk.v) {                 // older server: one link per file
              try { const l = await PtahApp.call('admin_irUploadStart', [f.name, f.size, co, day, location.origin]); url = l && l.url; perFile = !!url; } catch (er) { if (er && er.net) throw er; fastOff = true; }
            }
            if (url) {
              st[i].phase = 'send'; paint();
              let drive = null;
              try { drive = await putToDrive(url, f, fr => { st[i].sent = st[i].size * fr * 0.95; paint(); }); } catch (er) { if (perFile) fastOff = true; }
              if (drive && drive.id) {
                if (perFile) { st[i].phase = 'save'; st[i].sent = st[i].size * 0.95; paint(); await PtahApp.call('admin_irUploadDone', [drive.id, f.name, co, day]); }
                else { pend.push({ id: drive.id, name: f.name }); flush(false); }
                fast++; ok++; return;
              }
            }
          }
          await slow(f, i); ok++;
        } catch (er) { bad.push(f.name + ': ' + (er.message || er)); }
        finally { st[i].sent = st[i].size; st[i].phase = 'done'; finished++; paint(); }
      };
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(UP_PARALLEL, files.length) }, async () => { while (next < files.length) await one(next++); }));
      flush(true); await Promise.all(flushing);
      out.innerHTML = `✓ ${ok} ${t('uploaded', 'اترفع')}` + (bad.length ? `<br><span class="bad">${bad.map(esc).join('<br>')}</span>` : '') + (ok && !fast && fastOff ? `<br><small class="ir-hint">${t('Uploaded the slower way (fast upload not available yet).', 'اترفع بالطريقة البطيئة (الرفع السريع لسه مش شغال).')}</small>` : '');
      index = null; drawList();
    };
    drawList();
  }
  async function drawList() {
    const el = $('irList'); if (!el) return;
    try {
      const r = await api('admin_irList'); index = r.files; indexAt = Date.now();
      const open = (typeof allItems !== 'undefined' && allItems) || [];
      const withFile = open.filter(i => filesFor(i).length).length;
      el.innerHTML = `<div class="kpis"><div class="kpi"><b>${r.files.length}</b><span>${t('Files', 'ملفات')}</span></div><div class="kpi ${open.length - withFile ? 'bad' : 'ok'}"><b>${withFile}/${open.length}</b><span>${t('Open requests with a file', 'طلبات مفتوحة لها ملف')}</span></div></div>` +
        `<div class="card-list">${r.files.length ? r.files.map(f => `<div class="row"><span dir="auto">${esc(f.name)}<small class="ir-path">${esc(pathOf(f))}</small></span><span class="mono">${fmtSize(f.size)} <button type="button" class="ir-lnk" data-irdel="${esc(f.id)}">✕</button></span></div>`).join('') : `<div class="sc-empty">${t('No files yet.', 'مفيش ملفات لسه.')}</div>`}</div>`;
    } catch (e) { el.innerHTML = `<div class="sc-empty">${esc(e.message || e)}</div>`; }
  }
  document.addEventListener('click', async ev => {
    const fo = ev.target.closest && ev.target.closest('#dxQuick [data-ir="folders"]'); if (fo) return openFolders();
    const d = ev.target.closest && ev.target.closest('[data-irdel]'); if (d) {
      d.disabled = true;
      try { await api('admin_irDelete', [d.dataset.irdel]); index = null; drawList(); } catch (e) { d.disabled = false; }
      return;
    }
    const q = ev.target.closest && ev.target.closest('[data-ir="adminopen"]'); if (q) { if (window.closeModal && document.querySelector('.modal-overlay.open')) try { closeModal(); } catch (e) {} Shk.openAdmin('ir'); }
  });
  Object.assign(window.Shk = window.Shk || {}, { admIr: admIr });

  Object.assign(window.Shk, { ir: { loadIndex, filesFor, loadPdfJs, b64bytes, projectKey: getProjectKey, openFolders, paintUp } });

  // home: quick buttons (everybody gets "IR folder", admins and DC also get "Upload IR").
  // The home screen rebuilds its button row now and then, so the buttons are put back whenever they are missing.
  function ensureQuick() {
    try {
      const q = $('dxQuick'); if (!q) return;
      if (!q.querySelector('[data-ir="folders"]')) q.insertAdjacentHTML('beforeend', `<button type="button" data-ir="folders"><i>📁</i>${t('IR folder', 'فولدر IR')}</button>`);
      if (isAdmin() && !q.querySelector('[data-ir="adminopen"]')) q.insertAdjacentHTML('beforeend', `<button type="button" data-ir="adminopen"><i>⬆</i>${t('Upload IR', 'ارفع IR')}</button>`);
    } catch (e) { console.warn(e); }
  }
  const baseRender = window.render;
  if (typeof baseRender === 'function') {
    window.render = function () { const r = baseRender.apply(this, arguments); ensureQuick(); return r; };
  }
  new MutationObserver(ensureQuick).observe(document.body, { childList: true, subtree: true });
})();
