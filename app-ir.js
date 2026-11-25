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
    if (k === 'dctoday') { if (window.closeModal) try { closeModal(); } catch (e) {} return Shk.openAdmin('dc'); }
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

  // copy a Drive link to the clipboard (with a fallback for old WebViews) and say so
  async function copyLink(url) {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {}
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = url; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e) {} }
    try { window.showToast(ok ? t('Link copied', 'اللينك اتنسخ') : t('Could not copy the link', 'اللينك ماتنسخش'), null, null, 3000); } catch (e) {}
    return ok;
  }

  // share a Drive folder link: phone share sheet when there is one (WhatsApp is in it), or straight to WhatsApp, or copy
  async function shareFolder(url, day, wa) {
    const text = t('IR files closed', 'ملفات الـ IR اللي اتقفلت') + (day ? ' · ' + day : '');
    if (wa) { window.open('https://wa.me/?text=' + encodeURIComponent(text + '\n' + url), '_blank', 'noopener'); return true; }
    if (navigator.share) { try { await navigator.share({ title: text, text: text, url: url }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; } }
    return copyLink(url);
  }
  // pick the newest closing-day folder of this user (Admin, DC and engineers alike) and offer: copy, share, WhatsApp, open
  async function shareLatest() {
    let sh = $('irShareSheet');
    if (!sh) { sh = document.createElement('div'); sh.id = 'irShareSheet'; sh.className = 'ir-sheet'; document.body.appendChild(sh);
      sh.addEventListener('click', e => { if (e.target === sh || e.target.closest('[data-irx]')) sh.classList.remove('open'); }); }
    sh.innerHTML = `<div class="ir-sheet-box"><div class="ir-sheet-h"><b>${t('Share closed files folder', 'شارك فولدر الملفات المقفولة')}</b><span><button type="button" data-irx="1" class="ir-lnk">✕</button></span></div><div class="ir-load">${t('Loading…', 'بيحمّل…')}</div></div>`;
    sh.classList.add('open');
    const box = sh.querySelector('.ir-sheet-box');
    try {
      const r = (await api('ir_links')) || {};
      const all = (r.mine || []).filter(m => m.latest).sort((a, b) => a.latest.day < b.latest.day ? 1 : -1);
      if (!all.length) { box.innerHTML += `<small class="ir-hint">${t('Nothing closed from the app yet. After you close a request, the folder of that day shows up here.', 'لسه ماقفلتش حاجة من الأبليكيشن. بعد ما تقفل طلب، فولدر اليوم هيظهر هنا.')}</small>`; box.querySelector('.ir-load').remove(); return; }
      box.querySelector('.ir-load').remove();
      box.insertAdjacentHTML('beforeend', all.map(m => `<div class="ir-co"><b>${esc(m.name)} · ${esc(m.latest.day)}</b>
        <div class="ir-share-row"><button type="button" class="ir-big" data-ircopy="${esc(m.latest.url)}">📋 ${t('Copy link', 'انسخ اللينك')}</button>
        <button type="button" class="ir-big" data-irshare="${esc(m.latest.url)}" data-irday="${esc(m.latest.day)}">📤 ${t('Share', 'شارك')}</button>
        <button type="button" class="ir-big" data-irwa="${esc(m.latest.url)}" data-irday="${esc(m.latest.day)}">💬 WhatsApp</button>
        <a class="ir-big" href="${esc(m.latest.url)}" target="_blank" rel="noopener">📁 ${t('Open', 'افتح')}</a></div></div>`).join('') +
        `<small class="ir-hint">${t('The link opens only for people who have access to your folder.', 'اللينك بيفتح بس لمن عنده صلاحية على فولدرك.')}</small>`);
    } catch (e) { box.querySelector('.ir-load').outerHTML = `<div class="ir-load bad">${esc(e.message || e)}</div>`; }
  }

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
      const sect = (title, url, list, kind) => {
        const cos = (list || []).slice().sort((a, b) => (b.key === prefer) - (a.key === prefer));
        const inner = c => kind === 'closed'
          ? (c.engs && c.engs.length ? c.engs.map(e => `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a>`).join('') : `<small class="ir-hint">${t('No engineers yet.', 'مفيش مهندسين لسه.')}</small>`)
          : (c.days.length ? c.days.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.day)}</a>`).join('') : `<small class="ir-hint">${t('No days yet.', 'مفيش أيام لسه.')}</small>`);
        return `<h4 class="ir-sec">${title}</h4>` + (url ? `<a class="ir-go" href="${esc(url)}" target="_blank" rel="noopener">📁 ${title} · ${t('all companies', 'كل الشركات')}</a>` : '') +
          (cos.length ? cos.map(c => `<div class="ir-co"><a class="ir-go" href="${esc(c.url)}" target="_blank" rel="noopener">📁 ${esc(c.name)}</a>
            ${kind === 'closed' ? '' : (c.groups || []).map(g => `<div class="ir-days"><a class="ir-go" href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.disc)} · ${esc(g.type)}</a>${g.days.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.day)}</a>`).join('')}</div>`).join('')}
            <div class="ir-days">${inner(c)}</div></div>`).join('') : `<small class="ir-hint">${t('Nothing here yet.', 'مفيش حاجة هنا لسه.')}</small>`);
      };
      const mine = r.mine || [];
      const mineHtml = `<h4 class="ir-sec">${t('My closed files', 'ملفاتي المقفولة')}</h4>` + (mine.length ? mine.map(m => `<div class="ir-co"><a class="ir-go" href="${esc(m.url)}" target="_blank" rel="noopener">📁 ${t('Open my folder', 'افتح فولدري')} · ${esc(m.name)}</a>` +
        (m.latest ? `<div class="ir-share-row"><button type="button" class="ir-big" data-ircopy="${esc(m.latest.url)}">📋 ${t('Copy link', 'انسخ اللينك')} · ${esc(m.latest.day)}</button><button type="button" class="ir-big" data-irshare="${esc(m.latest.url)}" data-irday="${esc(m.latest.day)}">📤 ${t('Share', 'شارك')}</button><button type="button" class="ir-big" data-irwa="${esc(m.latest.url)}" data-irday="${esc(m.latest.day)}">💬 WhatsApp</button></div>` : '') +
        (m.days.length ? `<div class="ir-days">${m.days.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.day)}</a>`).join('')}</div>` : '') + `</div>`).join('') :
        `<small class="ir-hint">${t('Nothing closed from the app yet. Your folder shows up here after you close your first request.', 'لسه ماقفلتش حاجة من الأبليكيشن. فولدرك هيظهر هنا بعد أول طلب تقفله.')}</small>`);
      box.innerHTML = `<div class="ir-sheet-h"><b>${t('IR files on Drive', 'ملفات الـ IR على الدرايف')}</b><span><button type="button" data-irrf="1" class="ir-lnk" aria-label="Refresh" title="Refresh">⟳</button><button type="button" data-irx="1" class="ir-lnk">✕</button></span></div>` +
        mineHtml + (r.full ? sect(t('Open', 'Open (لسه متقفلتش)'), r.openUrl, r.open, 'open') + sect(t('Closed', 'Closed (الفورم مملية)'), r.closedUrl, r.closed, 'closed') : '') +
        `<small class="ir-hint">${t('If Drive asks for access, sign in with the same Google account you use in the app.', 'لو الدرايف طلب إذن، ادخل بنفس حساب جوجل اللي بتستخدمه في الأبليكيشن.')}</small>`;
    } catch (e) { sh.querySelector('.ir-sheet-box').innerHTML += `<div class="ir-load bad">${esc(e.message || e)}</div>`; }
  }

  // ---------------------------------------------------------------- admin screen: IR files
  const DISCS = [['ARC', 'Architectural · معماري'], ['STR', 'Structural · إنشائي'], ['MEC', 'Mechanical · ميكانيكا'], ['ELE', 'Electrical · كهرباء'], ['PLU', 'Plumbing · سباكة'], ['HVAC', 'HVAC · تكييف'], ['FF', 'Fire Fighting · حريق'], ['CIV', 'Civil · مدني'], ['LAN', 'Landscape · لاندسكيب'], ['INT', 'Interior · ديكور']];
  const discOpts = sel => DISCS.map(d => `<option value="${d[0]}"${d[0] === sel ? ' selected' : ''}>${esc(d[1])}</option>`).join('');
  const COMPANIES = [['SH', 'SH · EL-Shorouk'], ['SQ', 'SQ · Square'], ['AT', 'AT · Alexandria'], ['OTHER', 'Other']];
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const pathOf = f => f.co === 'UNSORTED' ? 'Unsorted' + (f.day ? ' / ' + f.day : '') : f.co ? ((COMPANIES.find(c => c[0] === f.co) || [0, f.co])[1]) + (f.disc ? ' / ' + f.disc : '') + (f.type ? ' / ' + f.type : '') + (f.day ? ' / ' + f.day : '') : t('(no company)', '(من غير شركة)');
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const toB64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => bad(new Error('read')); r.readAsDataURL(f); });

  // fast upload: the phone sends the file straight to a one-time Drive link made by the server (the folders and names are still decided by the server)
  const UP_PARALLEL = 5, UP_MAX = 6, UP_MIN = 2, LINK_CHUNK = 15, DONE_CHUNK = 40;   // start at 5 files at once (as before), slow down only when errors show up
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
      <div class="card"><p class="small" style="margin:0 0 8px">${t('Download the IR files from ACC (PDF or pictures) and choose them here, all companies together, many at once. The app reads each file name (like CP2C-CN-SH-CIR-ARC-14688) and files it by itself under company / discipline / CIR or MIR / day. A name it cannot read goes to Unsorted and you are told right after the upload. The app matches each file to its request by the IR number inside the file name. Attachments that have the same number in the name show up beside it.', 'نزّل ملفات الـ IR من ACC (PDF أو صور) واختارها هنا مرة واحدة من كل الشركات. الأبليكيشن بيقرا اسم كل ملف (زي CP2C-CN-SH-CIR-ARC-14688) ويحطه لوحده في الشركة / التخصص / CIR أو MIR / اليوم. الاسم اللي ما يعرفوش بيروح فولدر Unsorted وبينبهك بعد الرفع مباشرة. الأبليكيشن بيربط كل ملف بالطلب من رقم الـ IR في اسم الملف. المرفقات اللي فيها نفس الرقم في الاسم بتظهر جنبه.')}</p>
        <div class="ir-sel"><label>${t('Company', 'الشركة')}<select id="irCo" class="sc-in"><option value="AUTO">${t('Auto: sort by file name', 'تلقائي: حسب اسم الملف')}</option>${COMPANIES.map(c => `<option value="${c[0]}"${lsGet('shkIrCo') === c[0] ? ' selected' : ''}>${esc(c[1])}</option>`).join('')}</select></label>
          <label>${t('Work of the day', 'شغل يوم')}<input type="date" id="irDay" class="sc-in" value="${today()}"></label>
          <label id="irDiscLab">${t('Discipline for files with none in the name', 'التخصص للملفات اللي مفيهاش تخصص في الاسم')}<select id="irDisc" class="sc-in">${discOpts(lsGet('shkIrDisc') || 'ARC')}</select></label></div>
        <div class="ir-drop" id="irDrop"><div class="ir-drop-t">⬇ ${t('Drag the files or a whole folder here', 'اسحب الملفات أو فولدر كامل وسيبه هنا')}</div>
          <div class="btnrow"><label class="ir-pick" id="irPickLab"><input type="file" id="irPick" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" multiple hidden>${t('Choose files', 'اختار الملفات')}</label>
          <label class="ir-pick alt" id="irPickDirLab"><input type="file" id="irPickDir" webkitdirectory multiple hidden>${t('Choose a folder', 'اختار فولدر')}</label></div></div>
        <div id="irUp" class="small" style="margin-top:8px"></div></div>
      ${(PtahApp.role() === 'Admin' || PtahApp.role() === 'DC') ? `<div class="card" id="irMig"><b>${t('Closed folders', 'فولدرات Closed')}</b>
        <p class="small" style="margin:6px 0 8px">${t('One-time move of the old closed files to Closed / Company / Engineer / Date. Press Review first: nothing moves until you approve the list.', 'نقل مرة واحدة للملفات المقفولة القديمة إلى Closed / الشركة / المهندس / التاريخ. اضغط Review الأول: مفيش حاجة بتتنقل غير لما توافق على القايمة.')}</p>
        <div class="btnrow"><button type="button" class="ir-lnk" data-irmig="plan">${t('Review', 'Review')}</button></div><div id="irMigOut" class="small" style="margin-top:8px"></div></div>` : ''}
      ${(PtahApp.role() === 'Admin' || PtahApp.role() === 'DC') ? `<div class="card" id="irDup"><b>${t('Duplicate files', 'الملفات المتكررة')}</b>
        <p class="small" style="margin:6px 0 8px">${t('Finds the same file uploaded twice (Open, Closed, Unsorted). Press Find first: nothing is removed until you tick files and confirm. Removed files go to the Drive bin (30 days), never deleted for good.', 'بيدور على نفس الملف اللي اترفع مرتين (Open و Closed و Unsorted). اضغط Find الأول: مفيش حاجة بتتشال غير لما تعلّم على الملفات وتأكد. الملفات بتروح سلة الدرايف (30 يوم) ومبتتمسحش نهائي.')}</p>
        <div class="btnrow"><button type="button" class="ir-lnk" data-irdup="plan">${t('Find duplicates', 'دوّر على المتكرر')}</button></div><div id="irDupOut" class="small" style="margin-top:8px"></div></div>` : ''}
      <div id="irRules"></div><div id="irMissing"></div><div id="irSortBar"></div><div id="irReorg"></div><div id="irList"><div class="sc-load"><i></i><i></i><i></i></div></div><p class="shk-sign">architected by Ptah</p>`;
    const gate = () => { const ok = !!$('irCo').value && !!$('irDay').value; $('irPickLab').classList.toggle('off', !ok); $('irPickDirLab').classList.toggle('off', !ok); $('irPick').disabled = !ok; $('irPickDir').disabled = !ok; $('irDrop').classList.toggle('off', !ok); try { lsSet('shkIrCo', $('irCo').value); lsSet('shkIrDisc', $('irDisc').value); } catch (e) {} $('irDiscLab').style.display = $('irCo').value === 'AUTO' ? '' : 'none'; };
    $('irCo').onchange = $('irDay').onchange = $('irDisc').onchange = gate; gate();
    // ---- bulk upload: few at a time, server calls one by one, automatic retry, skips what is already on Drive ----
    let sess = null;                                   // totals of this pick, kept across "Retry failed files"
    const pause = ms => new Promise(r => setTimeout(r, ms));
    // a server call that tries again (2s, 5s, 10s, 20s, 30s) when the connection drops; other errors come straight back
    const callRetry = async (fn, args) => {
      const waits = [2000, 5000, 10000, 20000, 30000];
      for (let k = 0; ; k++) {
        try { return await PtahApp.call(fn, args); }
        catch (er) {
          if (!(er && er.net) || k >= waits.length) throw er;
          if (navigator.onLine === false) await new Promise(r => { const h = () => { window.removeEventListener('online', h); r(); }; window.addEventListener('online', h); setTimeout(h, waits[k] * 3); });
          else await pause(waits[k]);
        }
      }
    };
    // the Apps Script server works on one thing at a time (it locks), so server calls wait in one line
    let srvTail = Promise.resolve();
    const srv = (fn, args) => { const p = srvTail.then(() => callRetry(fn, args)); srvTail = p.catch(() => {}); return p; };
    const putRetry = async (url, f, onProg) => {
      let last;
      for (let k = 0; k < 3; k++) {
        try { return await putToDrive(url, f, onProg); } catch (er) { last = er; await pause(1500 * (k + 1)); }
      }
      throw last;
    };
    const runBatch = async (files, isRetry) => {
      const co = $('irCo').value, day = $('irDay').value;
      if (!sess || !isRetry) sess = { ok: 0, already: 0, ruled: 0, unsorted: [], guessed: [], failed: [] };
      const out = $('irUp'), auto = co === 'AUTO', dflt = $('irDisc').value || 'ARC';
      let fast = 0, finished = 0;
      const failed = [];                               // [{ f, msg }] kept so one tap can try them again
      const st = files.map(f => ({ name: f.name, size: f.size || 1, sent: 0, phase: 'wait' }));
      const paint = () => paintBatch(out, st, finished);
      const slow = async (f, i) => {
        st[i].phase = 'read'; paint();
        const b64 = await toB64(f);
        st[i].phase = 'send'; paint();
        const rr = await callRetry('admin_irUpload', [f.name, b64, co, day, dflt]);
        if (auto && rr && rr.sorted === false) sess.unsorted.push(f.name);
        if (auto && rr && rr.guessed) sess.guessed.push(f.name);
        if (auto && rr && rr.ruled) sess.ruled++;
      };
      // links for a chunk of files in ONE server call; if the server is older, one call per file; if that fails too, the old way
      const chunkP = {}, batchOk = { v: true }, pend = [], flushing = [];
      const linkFor = async i => {
        if (!batchOk.v) return null;
        const c = Math.floor(i / LINK_CHUNK);
        if (!chunkP[c]) {
          const part = files.slice(c * LINK_CHUNK, (c + 1) * LINK_CHUNK);
          chunkP[c] = srv(auto ? 'admin_irUploadStartAuto' : 'admin_irUploadStartBatch', auto ? [part.map(f => [f.name, f.size]), day, location.origin, dflt] : [part.map(f => [f.name, f.size]), co, day, location.origin])
            .then(rs => { if (auto) (rs || []).forEach((x, k) => { if (x && x.sorted === false) sess.unsorted.push(part[k].name); else if (x && x.guessed) sess.guessed.push(part[k].name); if (x && x.ruled && !x.exists) sess.ruled++; }); return rs; })
            .catch(er => { if (er && er.net) { delete chunkP[c]; throw er; } batchOk.v = false; return null; });   // no connection: ask again for the next file of the chunk
        }
        if (((c + 1) * LINK_CHUNK) < files.length && !chunkP[c + 1]) linkFor((c + 1) * LINK_CHUNK).catch(() => {});   // links of the next chunk are made while this one uploads
        const r = await chunkP[c];
        return r && r[i - c * LINK_CHUNK] ? r[i - c * LINK_CHUNK] : null;
      };
      const flush = all => {
        while (pend.length >= (all ? 1 : DONE_CHUNK)) {
          const part = pend.splice(0, DONE_CHUNK);
          flushing.push(srv(auto ? 'admin_irUploadDoneAuto' : 'admin_irUploadDoneBatch', auto ? [part.map(x => [x.id, x.name]), day, dflt] : [part.map(x => [x.id, x.name]), co, day])
            .then(r => { (r.files || []).forEach((x, k) => { if (x.ok) sess.ok++; else failed.push({ f: part[k].f, msg: t('did not arrive on Drive', 'ماوصلش الدرايف') }); }); })
            .catch(er => { part.forEach(x => failed.push({ f: x.f, msg: t('could not confirm', 'مقدرتش أأكد') })); }));
        }
      };
      const one = async i => {
        const f = files[i];
        try {
          if (!fastOff) {
            const lk = await linkFor(i);
            if (lk && lk.exists) { sess.already++; return; }
            if (lk && lk.error) throw new Error(lk.error);
            let url = lk && lk.url, perFile = false;
            if (!url && !batchOk.v && !auto) {        // older server: one link per file
              try { const l = await srv('admin_irUploadStart', [f.name, f.size, co, day, location.origin]); if (l && l.exists) { sess.already++; return; } url = l && l.url; perFile = !!url; } catch (er) { if (er && er.net) throw er; fastOff = true; }
            }
            if (url) {
              st[i].phase = 'send'; paint();
              let drive = null, putErr = null;
              try { drive = await putRetry(url, f, fr => { st[i].sent = st[i].size * fr * 0.95; paint(); }); } catch (er) { putErr = er; if (perFile) fastOff = true; }
              if (drive && drive.id) {
                if (perFile) { st[i].phase = 'save'; st[i].sent = st[i].size * 0.95; paint(); await srv('admin_irUploadDone', [drive.id, f.name, co, day]); sess.ok++; }
                else { pend.push({ id: drive.id, name: f.name, f: f }); flush(false); }
                fast++; return;
              }
              // Drive link failed 3 times: the slow way only if nothing has worked fast yet; otherwise leave it for the retry button
              if (fast > 0 || files.length > 10) throw new Error(t('connection dropped while sending', 'النت قطع وقت الإرسال'));
            }
          }
          await slow(f, i); sess.ok++;
        } catch (er) { failed.push({ f: f, msg: (er && er.message) || String(er) }); }
        finally { st[i].sent = st[i].size; st[i].phase = 'done'; finished++; paint(); }
      };
      // adaptive: start at 5 at once; every error takes one slot away (down to 2), 25 good files in a row give one back (up to 6)
      let next = 0, limit = UP_PARALLEL, active = 0, good = 0, nFail = 0;
      const tune = () => { if (failed.length > nFail) { nFail = failed.length; good = 0; limit = Math.max(UP_MIN, limit - 1); } else if (++good >= 25) { good = 0; limit = Math.min(UP_MAX, limit + 1); } };
      await Promise.all(Array.from({ length: Math.min(UP_MAX, files.length) }, async () => {
        while (next < files.length) {
          if (active >= limit) { await pause(150); continue; }
          const i = next++; active++;
          try { await one(i); } finally { active--; tune(); }
        }
      }));
      flush(true); await Promise.all(flushing);
      sess.failed = failed;
      const names = failed.map(x => x.f.name + ': ' + x.msg);
      out.innerHTML = `<div class="ir-sum"><b>✓ ${sess.ok} ${t('uploaded', 'اترفع')}</b>${sess.already ? ` · ${sess.already} ${t('already there (skipped)', 'موجودين من قبل (اتخطّوا)')}` : ''}${failed.length ? ` · <b class="bad">✗ ${failed.length} ${t('failed', 'فشلوا')}</b>` : ''}</div>`
        + (failed.length ? `<div class="small bad" style="margin-top:6px">${names.slice(0, 8).map(esc).join('<br>')}${names.length > 8 ? '<br>…' : ''}</div><div class="btnrow" style="margin-top:8px"><button type="button" class="ir-lnk" data-irretry="1" style="font-weight:700">${t('Retry failed files', 'جرّب الملفات اللي فشلت تاني')} (${failed.length})</button></div><small class="ir-hint">${t('Files already on Drive are skipped, so nothing is duplicated.', 'الملفات اللي على الدرايف بتتخطى، فمفيش تكرار.')}</small>` : '');
      if (auto && sess.ok) out.innerHTML += `<div class="ir-sum"><b>✓ ${sess.ok - sess.unsorted.length} ${t('sorted', 'اتصنفوا')}</b>${sess.ruled ? ` <small>(${sess.ruled} ${t('sorted by your saved rules', 'اتصنفوا بالقواعد المحفوظة')})</small>` : ''}${sess.guessed.length ? ` <small>(${sess.guessed.length} ${t('with the discipline you chose', 'بالتخصص اللي اخترته')}: ${esc((DISCS.find(d => d[0] === dflt) || [0, dflt])[1].split(' · ')[0])})</small>` : ''}${sess.unsorted.length ? `<br><b class="bad">⚠ ${sess.unsorted.length} ${t('need your choice (no company or no CIR/MIR in the name)', 'محتاجين اختيارك (مفيش شركة أو CIR/MIR في الاسم)')}</b><br><button type="button" class="ir-lnk" data-irfixall="1">${t('Fix them all', 'صلّحهم كلهم')}</button>` : ''}</div>` + rememberOffers(sess.guessed, dflt);
      const rb = out.querySelector('[data-irretry]'); if (rb) rb.onclick = () => { const again = sess.failed.map(x => x.f); if (again.length) runBatch(again, true); };
      window.__irJustUnsorted = sess.unsorted.slice();
      index = null; await drawList(); if (sess.unsorted.length && !failed.length) fixAll();
    };
    let busy = false;
    const startPick = async list => {
      const co = $('irCo').value, day = $('irDay').value;
      if (!co || !day) { $('irUp').textContent = t('Choose the company and the day first.', 'اختار الشركة واليوم الأول.'); return; }
      if (busy) { $('irUp').textContent = t('An upload is running. Wait until it finishes.', 'فيه رفع شغال. استنى لما يخلص.'); return; }
      const seen = {}, files = [];
      let skipped = 0;
      list.forEach(f => {
        const k = f.name + '|' + f.size;
        if (!/\.(pdf|jpe?g|png)$/i.test(f.name) || /^\./.test(f.name)) { skipped++; return; }
        if (seen[k]) return; seen[k] = 1; files.push(f);
      });
      if (!files.length) { $('irUp').textContent = t('No PDF or picture files found.', 'مفيش ملفات PDF أو صور.'); return; }
      fastOff = false; busy = true;
      try { await runBatch(files, false); } finally { busy = false; }
      if (skipped) { const o = $('irUp'); if (o) o.insertAdjacentHTML('beforeend', `<small class="ir-hint">${skipped} ${t('other files were ignored (not PDF or picture).', 'ملفات تانية اتجاهلت (مش PDF ولا صور).')}</small>`); }
    };
    $('irPick').onchange = e => { const l = Array.from(e.target.files || []); e.target.value = ''; if (l.length) startPick(l); };
    $('irPickDir').onchange = e => { const l = Array.from(e.target.files || []); e.target.value = ''; if (l.length) startPick(l); };
    // drag and drop: files, or a whole folder (its sub folders too)
    const readDrop = async dt => {
      const ents = Array.from(dt.items || []).map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);   // taken at once: the browser empties the list after the first wait
      if (!ents.length) return Array.from(dt.files || []);
      const out = [];
      const walk = async en => {
        if (en.isFile) return new Promise(r => en.file(f => { out.push(f); r(); }, () => r()));
        if (en.isDirectory) {
          const rd = en.createReader(); let all = [];
          for (;;) { const b = await new Promise(r => rd.readEntries(r, () => r([]))); if (!b.length) break; all = all.concat(b); }
          for (const c of all) await walk(c);
        }
      };
      for (const e of ents) await walk(e);
      return out;
    };
    const dz = $('irDrop');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'dragend'].forEach(ev => dz.addEventListener(ev, e => { if (ev === 'dragend' || !dz.contains(e.relatedTarget)) dz.classList.remove('over'); }));
    dz.addEventListener('drop', async e => {
      e.preventDefault(); dz.classList.remove('over');
      const l = await readDrop(e.dataTransfer);
      if (l.length) startPick(l);
    });
    if (!window.__irDropGuard) { window.__irDropGuard = 1; ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => { if (!e.target.closest || !e.target.closest('#irDrop')) { if (document.getElementById('irDrop') && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); } })); }
    drawRules();
    drawList(); drawReorg();
  }
  // one-time move of the old Closed files: review the list, approve, then it moves them in rounds
  async function migPlan() {
    const out = $('irMigOut'); if (!out) return;
    out.innerHTML = t('Looking at Drive…', 'بيبص على الدرايف…');
    try {
      const p = await api('admin_irMigratePlan'), a = p.access || {};
      const tree = {};
      (p.groups || []).forEach(g => { ((tree[g.company] = tree[g.company] || {})[g.eng] = tree[g.company][g.eng] || []).push(g.day + ' (' + g.n + ')'); });
      const list = Object.keys(tree).map(co => `<div><b>${esc(co)}</b>` + Object.keys(tree[co]).map(e => `<div dir="auto" style="margin-inline-start:12px">${esc(e)} <small class="ir-hint">${tree[co][e].map(esc).join(' · ')}</small></div>`).join('') + '</div>').join('');
      const em = x => (x && x.length ? x.map(esc).join('<br>') : '—');
      out.innerHTML = `<b>${p.total}</b> ${t('files will move', 'ملف هيتنقل')} · ${p.already} ${t('already in the new layout', 'أصلا في الشكل الجديد')}
        <div style="max-height:220px;overflow:auto;margin:8px 0;padding:8px;border:1px solid rgba(128,128,128,.3);border-radius:10px">${list || t('Nothing to move.', 'مفيش حاجة تتنقل.')}</div>
        <div><b>${t('Access after the move', 'الصلاحيات بعد النقل')}</b></div>
        <div class="ir-hint">${t('Admins and DCs get view of the whole IR folder:', 'الأدمنز والـ DCs بيشوفوا فولدر الـ IR كله:')}<br>${em(a.grant)}</div>
        <div class="ir-hint">${t('View of the whole IR folder is removed from (they keep only their own folder):', 'بيتشال منهم مشاهدة فولدر الـ IR كله (هيشوفوا فولدرهم بس):')}<br>${em(a.revoke)}</div>
        <div class="ir-hint">${t('Engineer folders shared with the registered email:', 'فولدرات المهندسين اللي بتتشارك على الإيميل المسجل:')}<br>${em((a.share || []).map(x => x.eng + ' → ' + x.email))}</div>
        <div class="ir-hint">${t('No registered engineer with this name (folder is not shared):', 'مفيش مهندس مسجل بالاسم ده (الفولدر مش هيتشارك):')}<br>${em(a.unmatched)}</div>
        <div class="btnrow" style="margin-top:8px"><button type="button" class="ir-lnk" data-irmig="plan">${t('Review again', 'Review تاني')}</button> <button type="button" class="ir-lnk" data-irmig="run" data-sig="${esc(p.sig)}">${t('Approve and move', 'موافق وانقل')}</button></div>`;
    } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; }
  }
  async function migRun(sig, btn) {
    const out = $('irMigOut'); if (!out) return;
    btn.disabled = true; let moved = 0, failedN = 0, fails = [], cont = false, fin = null;
    try {
      for (let i = 0; i < 200; i++) {
        out.innerHTML = t('Moving… ', 'بينقل… ') + moved;
        const r = await api('admin_irMigrateRun', [sig, cont]); cont = true;
        moved += r.moved || 0; failedN += r.failedN || 0; fails = fails.concat(r.failed || []);
        if (!r.left) { fin = r.finish; break; }
      }
      out.innerHTML = `✓ ${moved} ${t('moved', 'اتنقل')}` + (failedN ? `<br><span class="bad">${failedN} ${t('failed', 'فشل')}:<br>${fails.slice(0, 15).map(esc).join('<br>')}</span>` : '') +
        (fin ? `<br><small class="ir-hint">${t('Access', 'الصلاحيات')}: +${fin.granted} · −${fin.revoked} · ${fin.shared} ${t('engineer folders shared', 'فولدر مهندس اتشارك')}</small>` : '');
      index = null;
    } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message || e)}</span><br><small class="ir-hint">${t('Press Review and approve again to continue.', 'اضغط Review ووافق تاني عشان تكمل.')}</small>`; }
  }
  // duplicate finder: review list (extras ticked), then send the ticked extras to the Drive bin
  async function dupPlan() {
    const out = $('irDupOut'); if (!out) return;
    out.innerHTML = t('Looking at Drive… (can take a minute)', 'بيبص على الدرايف… (ممكن ياخد دقيقة)');
    try {
      const p = await api('admin_irDupPlan');
      if (!p.groups.length) { out.innerHTML = '✓ ' + t('No duplicates found', 'مفيش ملفات متكررة') + ` · ${p.scanned} ${t('files checked', 'ملف اتفحص')}` + (p.truncated ? ' ⚠ ' + t('(stopped early)', '(وقف بدري)') : ''); return; }
      const row = (g, e) => `<label class="ir-ck" style="display:block;margin:2px 0"><input type="checkbox" data-irdupck="${esc(e.id)}" ${g.kind === 'same' ? 'checked' : ''}> <span dir="auto">${esc(e.name)}</span> <small class="ir-hint">${esc(e.path)} · ${fmtSize(e.size)}</small></label>`;
      const block = g => `<div style="margin:8px 0;padding-bottom:6px;border-bottom:1px solid rgba(128,128,128,.2)"><div dir="auto">✓ ${t('Keep', 'يفضل')}: <b>${esc(g.keep.name)}</b> <small class="ir-hint">${esc(g.keep.path)} · ${fmtSize(g.keep.size)}</small></div>${g.extras.map(e => row(g, e)).join('')}</div>`;
      const same = p.groups.filter(g => g.kind === 'same'), cl = p.groups.filter(g => g.kind === 'closed'), sz = p.groups.filter(g => g.kind === 'size'), nb = p.groups.filter(g => g.kind === 'number');
      out.innerHTML = `<b>${p.same}</b> ${t('exact copies (ticked)', 'نسخة مطابقة (معلّمة)')} · <b>${p.closed}</b> ${t('Open copies of already Closed files', 'نسخ Open لملفات اتقفلت')} · <b>${p.size}</b> ${t('same name, other size', 'نفس الاسم وحجم تاني')} · <b>${p.number}</b> ${t('same IR number, other name/type', 'نفس الرقم واسم/نوع تاني')} (${t('these three are not ticked: check them', 'التلاتة دول مش معلّمين: راجعهم')}) · ${p.scanned} ${t('files checked', 'ملف اتفحص')}${p.truncated ? ' ⚠ ' + t('(stopped early)', '(وقف بدري)') : ''}
        <div style="max-height:320px;overflow:auto;margin:8px 0;padding:8px;border:1px solid rgba(128,128,128,.3);border-radius:10px">${same.length ? `<div><b>${t('Same file twice', 'نفس الملف مرتين')}</b></div>` + same.map(block).join('') : ''}${cl.length ? `<div style="margin-top:10px"><b>${t('Already in Closed', 'موجود في Closed')}</b></div>` + cl.map(block).join('') : ''}${sz.length ? `<div style="margin-top:10px"><b>${t('Same name, different size (newest kept)', 'نفس الاسم وحجم مختلف (الأحدث بيفضل)')}</b></div>` + sz.map(block).join('') : ''}${nb.length ? `<div style="margin-top:10px"><b>${t('Same IR number, different file name or type', 'نفس رقم الـ IR واسم أو نوع مختلف')}</b></div>` + nb.map(block).join('') : ''}</div>
        <div class="btnrow"><button type="button" class="ir-lnk" data-irdup="plan">${t('Find again', 'دوّر تاني')}</button> <button type="button" class="ir-lnk" data-irdup="run">${t('Send ticked files to the bin', 'ابعت المعلّم لسلة الدرايف')}</button></div><div id="irDupMsg" class="small" style="margin-top:8px"></div>`;
    } catch (e) { out.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; }
  }
  async function dupRun(btn) {
    const out = $('irDupOut'); if (!out) return;
    const msg = $('irDupMsg') || out;
    const ids = Array.from(out.querySelectorAll('[data-irdupck]:checked')).map(x => x.dataset.irdupck);
    if (!ids.length) { msg.innerHTML = '<span class="bad">' + t('Nothing is ticked.', 'مفيش حاجة معلّمة.') + '</span>'; return; }
    if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = t('Tap again: send ', 'اضغط تاني: ابعت ') + ids.length + t(' files to the bin', ' ملف للسلة'); msg.innerHTML = t('Tap the same button once more to confirm.', 'اضغط نفس الزرار مرة كمان للتأكيد.'); return; }
    btn.disabled = true; let n = 0, ign = 0, fails = [];
    try {
      for (let i = 0; i < ids.length; i += 100) {
        msg.innerHTML = '⏳ ' + t('Sending to the Drive bin… this can take a minute, do not close. Done so far: ', 'بيبعت لسلة الدرايف… ممكن ياخد دقيقة، متقفلش. اتبعت لحد دلوقتي: ') + n;
        try { msg.scrollIntoView({ block: 'center' }); } catch (e) {}
        const r = await api('admin_irDupTrash', [ids.slice(i, i + 100)]); n += r.trashed || 0; ign += r.ignored || 0; fails = fails.concat(r.failed || []);
      }
      index = null;
      const txt = (n ? '✓ ' : '⚠ ') + n + ' ' + t('copies sent to the Drive bin', 'نسخة اتبعتت لسلة الدرايف')
        + (ign ? `<br>${ign} ${t('skipped (no longer an extra copy)', 'اتخطوا (مبقوش نسخة زيادة)')}` : '')
        + (fails.length ? `<br><span class="bad">${fails.length} ${t('failed', 'فشل')}:<br>${fails.slice(0, 15).map(esc).join('<br>')}</span><br><small class="ir-hint">${t('Files owned by someone else can only be removed from Drive by their owner.', 'الملفات اللي مالكها حد تاني بيشيلها مالكها من الدرايف.')}</small>` : '');
      await dupPlan();
      const m2 = $('irDupMsg'); if (m2) { m2.innerHTML = txt; try { m2.scrollIntoView({ block: 'center' }); } catch (e) {} }
    } catch (e) { btn.disabled = false; delete btn.dataset.sure; msg.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; }
  }

  // ---------------------------------------------------------------- open requests that still have NO IR file (so Ahmed knows exactly what to download from ACC)
  const miss = { sort: 'age', list: [], all: [], cos: [] };
  function missingRows(open) {
    const seen = new Set(), tot = {}, out = [];
    const nums = new Set();                                   // every number found in a file name, leading zeros removed (same rule as filesFor, one pass instead of one regex scan per request)
    (index || []).forEach(f => { (String(f.name).match(/\d+/g) || []).forEach(x => nums.add(x.replace(/^0+/, ''))); });
    open.forEach(i => {
      let key = '', co = '';
      try { key = getProject(i); co = projectInfo(key).label; } catch (e) {}
      const id = String(i.irNumber || '') + '|' + String(i.rev || '0'); if (seen.has(id)) return; seen.add(id);
      const c = tot[key] = tot[key] || { key, label: co || key, total: 0, withFile: 0 };
      c.total++;
      const k = keyOf(i).replace(/^0+/, '');
      if (k && nums.has(k)) { c.withFile++; return; }
      let ty = '', vil = '', act = '', age = '';
      try { ty = getDocType(i); vil = villaOf(i); act = activityOf(i); age = ageText(i); } catch (e) {}
      let day = ''; if (i.ageDays !== null && i.ageDays !== undefined) { const d = new Date(Date.now() - i.ageDays * 864e5); day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
      out.push({ ir: String(i.irNumber || ''), rev: String(i.rev || '0'), key, co, ty, vil, act, age, ageDays: (i.ageDays === null || i.ageDays === undefined) ? -1 : i.ageDays, day, by: i.createdBy || i.contractor || '', late: (() => { try { return isLate(i); } catch (e) { return false; } })() });
    });
    ['SH', 'SQ', 'AT'].forEach(k => { if (!tot[k]) tot[k] = { key: k, label: (COMPANIES.find(c => c[0] === k) || [0, k])[1], total: 0, withFile: 0 }; });
    miss.cos = Object.keys(tot).map(k => tot[k]).sort((x, y) => (['SH', 'SQ', 'AT', 'OTHER'].indexOf(x.key) + 1 || 9) - (['SH', 'SQ', 'AT', 'OTHER'].indexOf(y.key) + 1 || 9));
    return out;
  }
  const missNum = x => { const m = String(x).match(/(\d+)\D*$/); return m ? +m[1] : 0; };
  const missCmp = {
    age: (a, b) => b.ageDays - a.ageDays || missNum(a.ir) - missNum(b.ir),
    ir: (a, b) => missNum(a.ir) - missNum(b.ir),
    vil: (a, b) => (a.vil < b.vil ? -1 : a.vil > b.vil ? 1 : 0) || missNum(a.ir) - missNum(b.ir)
  };
  function drawMissing(open) {
    const el = $('irMissing'); if (!el) return;
    miss.all = missingRows(open);
    const totalMiss = miss.all.length;
    el.innerHTML = `<h4 class="ir-sec">${totalMiss ? '⚠ ' : '✓ '}${t('Open requests by company', 'الطلبات المفتوحة حسب الشركة')}</h4><div class="card ir-bulk">
      <div class="ir-sel"><label>${t('Sort by', 'رتّب حسب')}<select class="sc-in" id="irMissSort"><option value="age">${t('Oldest first', 'الأقدم الأول')}</option><option value="ir">${t('IR number', 'رقم الـ IR')}</option><option value="vil">${t('Villa', 'الفيلا')}</option></select></label></div>
      <div id="irMissBody"></div>
      <div class="btnrow"><button type="button" class="ir-lnk" id="irMissCopyAll"${totalMiss ? '' : ' disabled'}>${t('Copy all missing IR numbers', 'انسخ كل أرقام الناقص')} (${totalMiss})</button> <span class="small" id="irMissMsg"></span></div></div>`;
    $('irMissSort').value = miss.sort;
    $('irMissSort').onchange = ev => { miss.sort = ev.target.value; paintMissing(); };
    $('irMissBody').addEventListener('click', async ev => {
      const mm = ev.target.closest && ev.target.closest('[data-mmore]');
      if (mm) { const key = mm.dataset.mmore, rows = miss.all.filter(r => r.key === key).sort(missCmp[miss.sort] || missCmp.age); mm.closest('.row').outerHTML = rows.slice(40).map(miss.rowHtml).join(''); return; }
      const hd = ev.target.closest && ev.target.closest('[data-mtoggle]');
      const b = ev.target.closest && ev.target.closest('[data-misscopy]');
      if (!b) { if (hd) { const box = hd.parentNode, o = !box.classList.contains('open'); box.classList.toggle('open', o); (miss.openCo = miss.openCo || {})[box.dataset.mco] = o; } return; }
      ev.preventDefault(); ev.stopPropagation();
      const rows = miss.all.filter(r => r.key === b.dataset.misscopy).sort(missCmp[miss.sort] || missCmp.age);
      const ok = await copyText(rows.map(r => r.ir).join('\n')); const m = $('irMissMsg'); if (m) m.textContent = ok ? '✓ ' + rows.length + ' ' + t('copied', 'اتنسخ') : t('Could not copy', 'ماتنسخش');
    });
    $('irMissCopyAll').onclick = async () => { const ok = await copyText(miss.all.slice().sort(missCmp[miss.sort] || missCmp.age).map(r => r.ir).join('\n')); const m = $('irMissMsg'); if (m) m.textContent = ok ? '✓ ' + totalMiss + ' ' + t('copied', 'اتنسخ') : t('Could not copy', 'ماتنسخش'); };
    paintMissing();
  }
  function paintMissing() {
    const el = $('irMissBody'); if (!el) return;
    const sorter = missCmp[miss.sort] || missCmp.age, oc = miss.openCo || {}, LIM = 40;
    const rowHtml = r => `<div class="row"><span dir="auto"><b>${esc(r.ir)}</b>${r.rev && r.rev !== '0' ? ' · Rev ' + esc(r.rev) : ''}<small class="ir-path">${esc([r.ty, r.vil, r.act].filter(Boolean).join(' · '))}${r.by ? '<br>' + esc(r.by) : ''}</small></span><span class="mono${r.late ? ' bad' : ''}">${esc(r.age)}${r.day ? '<br><small>' + r.day + '</small>' : ''}</span></div>`;
    el.innerHTML = '<div class="card-list ir-miss">' + miss.cos.map(c => {
      const rows = miss.all.filter(r => r.key === c.key).sort(sorter), n = rows.length;
      if (!c.total) return `<div class="row"><span><b>${esc(c.label)}</b></span><span class="mono">${t('no open requests', 'مفيش طلبات مفتوحة')}</span></div>`;
      if (!n) return `<div class="row"><span><b>✓ ${esc(c.label)}</b><small class="ir-path">${t('All requests have their IR file', 'كل الطلبات ليها ملف IR')}</small></span><span class="mono">${c.withFile}/${c.total}</span></div>`;
      const isOpen = oc[c.key] !== undefined ? oc[c.key] : true;
      return `<div class="ir-mco${isOpen ? ' open' : ''}" data-mco="${esc(c.key)}"><div class="row ir-mhead" data-mtoggle="${esc(c.key)}" role="button" tabindex="0"><span><b>⚠ ${esc(c.label)}</b><small class="ir-path">${n} ${t('without a file', 'من غير ملف')} · ${c.withFile}/${c.total} ${t('have files', 'ليها ملفات')}</small></span><span class="mono"><button type="button" class="ir-lnk" data-misscopy="${esc(c.key)}">${t('Copy', 'انسخ')} ${n}</button> <i class="ir-chev">▾</i></span></div>` +
        `<div class="ir-mbody">${rows.slice(0, LIM).map(rowHtml).join('')}${n > LIM ? `<div class="row"><button type="button" class="ir-lnk" data-mmore="${esc(c.key)}">${t('Show the other', 'اعرض الباقي')} ${n - LIM}</button></div>` : ''}</div></div>`;
    }).join('') + '</div>';
    miss.rowHtml = rowHtml;
  }
  async function copyText(txt) {
    let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) {}
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e) {} }
    return ok;
  }
  let bulkAll = false;
  async function drawList() {
    const el = $('irList'); if (!el) return;
    try {
      const r = await api('admin_irList'); index = r.files; indexAt = Date.now();
      const open = (typeof allItems !== 'undefined' && allItems) || [];
      const withFile = open.filter(i => filesFor(i).length).length;
      try { drawMissing(open); } catch (e) { const mm = $('irMissing'); if (mm) mm.innerHTML = ''; }
      el.innerHTML = `<div class="kpis"><div class="kpi"><b>${r.files.length}</b><span>${t('Files', 'ملفات')}</span></div><div class="kpi ${open.length - withFile ? 'bad' : 'ok'}"><b>${withFile}/${open.length}</b><span>${t('Open requests with a file', 'طلبات مفتوحة لها ملف')}</span></div></div>` +
        (() => {
          const un = r.files.filter(f => f.co === 'UNSORTED'), rest = r.files.filter(f => f.co !== 'UNSORTED');
          const row = f => `<div class="row" data-irrow="${esc(f.id)}"><span dir="auto">${esc(f.name)}<small class="ir-path">${esc(pathOf(f))}</small></span><span class="mono">${fmtSize(f.size)} <button type="button" class="ir-lnk" data-irfix="${esc(f.id)}" title="${t('Change company / discipline / type', 'غيّر الشركة / التخصص / النوع')}">✎</button> <button type="button" class="ir-lnk" data-irdel="${esc(f.id)}">✕</button></span></div>`;
          const urow = f => `<div class="row" data-irrow="${esc(f.id)}"><label class="ir-ck"><input type="checkbox" data-irck="${esc(f.id)}"> <span dir="auto">${esc(f.name)}</span></label><span class="mono">${fmtSize(f.size)} <button type="button" class="ir-lnk" data-irfix="${esc(f.id)}" title="${t('Change company / discipline / type', 'غيّر الشركة / التخصص / النوع')}">✎</button> <button type="button" class="ir-lnk" data-irdel="${esc(f.id)}">✕</button></span></div>`;
          const needs = r.files.filter(f => f.co === 'UNSORTED' || (f.co && (!f.disc || !f.type)));
          const needSet = new Set(needs.map(f => f.id));
          const shown = bulkAll ? r.files : needs, others = r.files.filter(f => !shown.includes(f));
          window.__irNeed = needs.length;
          const bar = $('irSortBar');
          if (bar) bar.innerHTML = `<div class="card ir-sortbar"><button type="button" class="ir-big${needs.length ? ' warn' : ''}" data-irsort="1">🗂 ${t('Fix unsorted files', 'صلّح الملفات غير المصنّفة')}${needs.length ? ` <span class="ir-badge">${needs.length}</span>` : ''}</button><small class="ir-hint">${needs.length ? t('Tick many files and set company / discipline / CIR-MIR / day once.', 'حدد ملفات كتير وظبّط الشركة / التخصص / CIR-MIR / اليوم مرة واحدة.') : t('All files are sorted ✓. You can still mark any files by choosing "Show all files".', 'كل الملفات متصنفة ✓. تقدر برضه تحدد أي ملفات بزرار "اعرض كل الملفات".')}</small></div>`;
          if (!shown.length) return `<div class="card ir-bulk" id="irBulk"><div class="sc-empty">${t('Nothing needs sorting ✓', 'مفيش حاجة محتاجة تصنيف ✓')}</div><div class="btnrow"><button type="button" class="ir-lnk" data-irmode="1">${t('Show all files', 'اعرض كل الملفات')}</button></div></div>` + (r.files.length ? '' : `<div class="card-list"><div class="sc-empty">${t('No files yet.', 'مفيش ملفات لسه.')}</div></div>`);
          return `<h4 class="ir-sec" id="irBulkH">${needs.length ? '⚠ ' : ''}${t('Mark many files at once', 'تحديد ملفات كتير مرة واحدة')} · ${t('need sorting', 'محتاج تصنيف')} (${needs.length})</h4><div class="card ir-bulk" id="irBulk"><div class="ir-sel"><label>${t('Search in names', 'دوّر في الأسماء')}<input class="sc-in" id="irBF" placeholder="SQ"></label><label class="ir-all"><span>&nbsp;</span><button type="button" class="ir-lnk" data-irall="1">${t('Select all shown', 'حدد المعروض كله')}</button></label><label class="ir-all"><span>&nbsp;</span><button type="button" class="ir-lnk" data-irmode="1">${bulkAll ? t('Show only files that need sorting', 'اعرض المحتاجة تصنيف بس') : t('Show all files', 'اعرض كل الملفات')}</button></label></div>
            <div class="ir-fix ir-sel"><label>${t('Company', 'الشركة')}<select class="sc-in" id="irBCo"><option value="">–</option>${COMPANIES.filter(c => c[0] !== 'OTHER').map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join('')}</select></label>
            <label>${t('Discipline', 'التخصص')}<select class="sc-in" id="irBDisc">${discOpts(lsGet('shkIrDisc') || 'ARC')}</select></label>
            <label>CIR / MIR<select class="sc-in" id="irBType"><option value="CIR">CIR</option><option value="MIR">MIR</option></select></label>
            <label>${t('Day', 'اليوم')}<input type="date" class="sc-in" id="irBDay" value="${today()}"></label></div>
            <label class="ir-ck small"><input type="checkbox" id="irBRem"> ${t('Remember: files of this company with no discipline in the name get this discipline from now on', 'افتكر: ملفات الشركة دي اللي اسمها من غير تخصص تاخد التخصص ده من دلوقتي')}</label>
            <div class="btnrow"><button type="button" class="ir-lnk" data-irbulk="1" id="irBGo">${t('Apply to selected', 'طبّق على المحدد')} (0)</button> <span class="small" id="irBMsg"></span></div></div><div class="card-list" id="irBList">${shown.length ? shown.map(urow).join('') : ''}</div>` +
            (r.files.length ? '' : `<div class="card-list"><div class="sc-empty">${t('No files yet.', 'مفيش ملفات لسه.')}</div></div>`);
        })();
    } catch (e) { el.innerHTML = `<div class="sc-empty">${esc(e.message || e)}</div>`; }
  }
  // BULK marking of the Unsorted files: tick many (or select all shown, or search by name) and set company / discipline / CIR-MIR / day once
  const bulkRows = () => Array.from(document.querySelectorAll('#irBList [data-irrow]'));
  const bulkIds = () => bulkRows().filter(r => r.querySelector('[data-irck]').checked).map(r => r.dataset.irrow);
  function bulkSync() {
    const sel = bulkRows().filter(r => r.querySelector('[data-irck]').checked), go = $('irBGo'); if (!go) return;
    go.textContent = t('Apply to selected', 'طبّق على المحدد') + ' (' + sel.length + ')'; go.disabled = !sel.length;
    // suggest company and CIR/MIR when every selected name says the same
    const names = sel.map(r => r.querySelector('span[dir]').textContent.toUpperCase());
    ['SH', 'SQ', 'AT'].forEach(c => { if (names.length && names.every(n => new RegExp('(^|[^A-Z0-9])' + c + '([^A-Z0-9]|$)').test(n))) $('irBCo').value = c; });
    ['CIR', 'MIR'].forEach(c => { if (names.length && names.every(n => new RegExp('(^|[^A-Z0-9])' + c + '([^A-Z0-9]|$)').test(n))) $('irBType').value = c; });
  }
  document.addEventListener('input', ev => {
    if (ev.target && ev.target.id === 'irBF') { const q = ev.target.value.trim().toUpperCase(); bulkRows().forEach(r => { r.style.display = !q || r.querySelector('span[dir]').textContent.toUpperCase().includes(q) ? '' : 'none'; }); }
  });
  document.addEventListener('change', ev => { if (ev.target && ev.target.matches && ev.target.matches('[data-irck]')) bulkSync(); });
  // after an upload: tick the files that were not recognised and scroll to them
  function fixAll() {
    const names = window.__irJustUnsorted || [], box = $('irBulk'); if (!box) return;
    if (bulkAll) { bulkAll = false; return drawList().then(fixAll); }
    bulkRows().forEach(r => { r.querySelector('[data-irck]').checked = names.length ? names.includes(r.querySelector('span[dir]').textContent) : true; });
    bulkSync(); box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function bulkApply(btn) {
    const ids = bulkIds(), co = $('irBCo').value, disc = $('irBDisc').value, type = $('irBType').value, day = $('irBDay').value, msg = $('irBMsg');
    if (!ids.length) return;
    if (!co) { msg.textContent = t('Choose the company first.', 'اختار الشركة الأول.'); return; }
    if (!day) { msg.textContent = t('Choose the day.', 'اختار اليوم.'); return; }
    try { lsSet('shkIrDisc', disc); } catch (e) {}
    btn.disabled = true; let done = 0, fail = 0, next = 0;
    const tick = () => { msg.textContent = (done + fail) + ' / ' + ids.length + '…'; };
    await Promise.all([0, 1, 2].map(async () => { while (next < ids.length) { const id = ids[next++]; try { await api('admin_irMove', [id, co, disc, type, day]); done++; } catch (e) { fail++; } tick(); } }));
    if ($('irBRem') && $('irBRem').checked && done) { try { rulesCache = await api('admin_irRuleSet', ['disc', co, disc]); } catch (e) {} drawRules(); }
    index = null; await drawList();
    const m2 = $('irBMsg'); if (m2) m2.textContent = '✓ ' + done + (fail ? ' · ' + fail + ' ✕' : '');
  }
  // ---------------------------------------------------------------- smart sorting memory (saved rules)
  const COMPANY_RE = /(^|[^A-Z0-9])(SH|SQ|AT)([^A-Z0-9]|$)/;
  const discName = c => ((DISCS.find(d => d[0] === c) || [0, c])[1] || c).split(' · ')[0];
  let rulesCache = null;
  // after an upload: files that had no discipline in the name and got the default one -> offer to remember it per company
  function rememberOffers(names, dflt) {
    const by = {};
    (names || []).forEach(n => { const m = COMPANY_RE.exec(String(n).toUpperCase().replace(/\.[A-Z0-9]+$/, '')); if (m) by[m[2]] = (by[m[2]] || 0) + 1; });
    const cos = Object.keys(by); if (!cos.length) return '';
    return `<div class="ir-sum ir-rem"><b>💡 ${t('Remember for next time?', 'تحب أفتكرها المرة الجاية؟')}</b>` + cos.map(c => `<div class="ir-remrow"><span>${by[c]} ${esc((COMPANIES.find(x => x[0] === c) || [0, c])[1])} ${t('files had no discipline → used', 'ملف من غير تخصص → اتحطوا')} <b>${esc(discName(dflt))}</b></span>
      <button type="button" class="ir-lnk" data-irremember="${c}|${esc(dflt)}">${t('Always use', 'استخدمه دايمًا')} ${esc(discName(dflt))}</button></div>`).join('') + '</div>';
  }
  async function drawRules(fresh) {
    const el = $('irRules'); if (!el) return;
    try {
      if (!rulesCache || fresh) rulesCache = (await api('admin_irRules')) || { disc: {}, co: {} };
    } catch (e) { el.innerHTML = ''; return; }          // older server without rules: the card stays hidden
    const r = rulesCache, dk = Object.keys(r.disc || {}), ck = Object.keys(r.co || {});
    const coName = c => (COMPANIES.find(x => x[0] === c) || [0, c])[1];
    el.innerHTML = `<details class="card ir-rules"${dk.length || ck.length ? ' open' : ''}><summary><b>🧠 ${t('Sorting memory', 'ذاكرة الفرز')}</b> <small>(${dk.length + ck.length})</small></summary>
      <p class="small" style="margin:6px 0">${t('Rules the app applies by itself when a file name is not complete. Company first, then discipline.', 'قواعد الأبليكيشن بيطبّقها لوحده لما اسم الملف مش كامل. الشركة الأول وبعدين التخصص.')}</p>
      ${dk.map(c => `<div class="ir-remrow"><span>${esc(coName(c))} ${t('with no discipline →', 'من غير تخصص →')}</span>
        <select class="sc-in" data-irrdisc="${esc(c)}">${discOpts(r.disc[c])}</select><button type="button" class="ir-lnk" data-irrdel="disc|${esc(c)}" aria-label="Delete">✕</button></div>`).join('')}
      ${ck.map(w => `<div class="ir-remrow"><span dir="ltr">${t('name has', 'الاسم فيه')} <b>${esc(w)}</b> →</span>
        <b>${esc(coName(r.co[w]))}</b><button type="button" class="ir-lnk" data-irrdel="co|${esc(w)}" aria-label="Delete">✕</button></div>`).join('')}
      ${dk.length || ck.length ? '' : `<small class="ir-hint">${t('No rules yet. After an upload the app offers to remember your choice.', 'مفيش قواعد لسه. بعد الرفع الأبليكيشن هيعرض يفتكر اختيارك.')}</small>`}
      <div class="ir-sel" style="margin-top:8px"><label>${t('Add: company', 'إضافة: شركة')}<select class="sc-in" id="irRC">${COMPANIES.filter(c => c[0] !== 'OTHER').map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join('')}</select></label>
        <label>${t('files with no discipline →', 'من غير تخصص →')}<select class="sc-in" id="irRD">${discOpts('ARC')}</select></label>
        <label class="ir-all"><span>&nbsp;</span><button type="button" class="ir-lnk" data-irradd="disc">${t('Save rule', 'احفظ القاعدة')}</button></label></div>
      <div class="ir-sel"><label>${t('Or: a word in the file name', 'أو: كلمة في اسم الملف')}<input class="sc-in" id="irRW" maxlength="12" placeholder="PEG" dir="ltr"></label>
        <label>${t('belongs to company', 'تبقى شركة')}<select class="sc-in" id="irRW2">${COMPANIES.filter(c => c[0] !== 'OTHER').map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join('')}</select></label>
        <label class="ir-all"><span>&nbsp;</span><button type="button" class="ir-lnk" data-irradd="co">${t('Save rule', 'احفظ القاعدة')}</button></label></div>
      ${dk.length || ck.length ? `<div class="btnrow"><button type="button" class="ir-lnk" data-irrreset="1">${t('Reset all rules', 'امسح كل القواعد')}</button></div>` : ''}
      <span class="small" id="irRMsg"></span></details>`;
  }
  async function ruleSet(kind, key, val) {
    const m = $('irRMsg'); if (m) m.textContent = '…';
    try { rulesCache = await api('admin_irRuleSet', [kind, key, val]); await drawRules(); }
    catch (e) { const m2 = $('irRMsg'); if (m2) m2.textContent = (e && e.message) || String(e); }
  }
  document.addEventListener('change', ev => { const s = ev.target && ev.target.matches && ev.target.matches('[data-irrdisc]') ? ev.target : null; if (s) ruleSet('disc', s.dataset.irrdisc, s.value); });

  // fix / reassign one file (admin and DC only; the server checks again)
  function fixForm(id) {
    const row = document.querySelector('[data-irrow="' + id.replace(/"/g, '') + '"]'); if (!row) return;
    const old = row.querySelector('.ir-fix'); if (old) return old.remove();
    const f = (index || []).find(x => x.id === id) || {};
    const pr = f.name ? (/-(SH|SQ|AT)-/i.exec(f.name) || [])[1] : '';
    row.insertAdjacentHTML('beforeend', `<div class="ir-fix ir-sel" style="flex-basis:100%;margin-top:6px"><label>${t('Company', 'الشركة')}<select class="sc-in" data-fco>${COMPANIES.filter(c => c[0] !== 'OTHER').map(c => `<option value="${c[0]}"${(f.co === c[0] || (!f.co || f.co === 'UNSORTED') && pr && pr.toUpperCase() === c[0]) ? ' selected' : ''}>${esc(c[1])}</option>`).join('')}</select></label>
      <label>${t('Discipline', 'التخصص')}<input class="sc-in" data-fdisc maxlength="5" placeholder="ARC / STR / MEC" value="${esc(f.disc || '')}"></label>
      <label>CIR / MIR<select class="sc-in" data-ftype><option value="CIR"${f.type === 'CIR' ? ' selected' : ''}>CIR</option><option value="MIR"${f.type === 'MIR' ? ' selected' : ''}>MIR</option></select></label>
      <label>${t('Day', 'اليوم')}<input type="date" class="sc-in" data-fday value="${esc(f.day || today())}"></label>
      <button type="button" class="ir-lnk" data-irfixgo="${esc(id)}">${t('Save', 'احفظ')}</button> <span class="small" data-fmsg></span></div>`);
  }
  // one-time re-organisation of the old files: review first, nothing moves until approved
  async function drawReorg() {
    const el = $('irReorg'); if (!el) return;
    el.innerHTML = `<div class="card"><p class="small" style="margin:0 0 8px">${t('Old files (uploaded before auto sort) can be moved into the new folders. You see the list first; nothing moves until you approve.', 'الملفات القديمة (قبل الترتيب التلقائي) ممكن تتنقل للفولدرات الجديدة. هتشوف القايمة الأول ومفيش حاجة بتتنقل غير لما توافق.')}</p><div class="btnrow"><button type="button" class="ir-lnk" data-irplan="1">${t('Review the move (changes nothing)', 'راجع النقل (مش بيغيّر حاجة)')}</button></div><div id="irPlan" class="small" style="margin-top:8px"></div></div>`;
  }
  async function showPlan() {
    const box = $('irPlan'); if (!box) return;
    box.textContent = t('Reading the folders…', 'بيقرا الفولدرات…');
    try {
      const r = await api('admin_irReorgPlan');
      if (!r.total) { box.textContent = t('Nothing to move: all files are already in the new layout.', 'مفيش حاجة تتنقل: كل الملفات في الشكل الجديد.'); return; }
      const g = {}; r.moves.forEach(m => { const k = m.from + '  →  ' + m.to.replace(/ \/ \d{4}-\d{2}-\d{2}$/, ''); g[k] = (g[k] || 0) + 1; });
      box._ids = r.moves.map(m => m.id);
      box.innerHTML = `<b>${r.total}${r.total >= 400 ? '+' : ''} ${t('files will move:', 'ملف هيتنقل:')}</b>` + (r.unsorted ? `<div class="ir-warn">⚠ ${r.unsorted} ${t('have a name the app cannot read: they go to Unsorted, then you fix them.', 'اسمهم مش معروف: هيروحوا Unsorted وبعدين تصلحهم.')}</div>` : '') +
        `<div class="card-list">${Object.keys(g).map(k => `<div class="row"><span dir="ltr">${esc(k)}</span><span class="mono">${g[k]}</span></div>`).join('')}</div>` +
        `<small>${t('Nothing is deleted. The day of each file stays the same.', 'مفيش حاجة بتتمسح. يوم كل ملف بيفضل زي ما هو.')}</small><div class="btnrow"><button type="button" class="ir-lnk" data-irapply="1">✓ ${t('Approve and move', 'موافق، انقل')}</button></div>`;
    } catch (e) { box.textContent = e.message || e; }
  }
  async function applyPlan(btn) {
    const box = $('irPlan'); const ids = (box && box._ids) || []; if (!ids.length) return;
    btn.disabled = true; let moved = 0, un = 0; const bad = [];
    try {
      for (let i = 0; i < ids.length; i += 40) {
        box.querySelector('.btnrow').innerHTML = `${t('Moving', 'بينقل')} ${Math.min(i + 40, ids.length)} / ${ids.length}…`;
        const r = await api('admin_irReorgApply', [ids.slice(i, i + 40)]); moved += r.moved; un += r.unsorted; (r.bad || []).forEach(x => bad.push(x));
      }
      box.innerHTML = `✓ ${moved} ${t('moved', 'اتنقل')}` + (un ? ` · ${un} Unsorted` : '') + (bad.length ? `<br><span class="bad">${bad.length} ${t('skipped', 'اتخطى')}: ${bad.slice(0, 5).map(esc).join(', ')}</span>` : '');
      index = null; drawList();
    } catch (e) { box.innerHTML += `<br><span class="bad">${esc(e.message || e)}</span>`; }
  }
  document.addEventListener('click', async ev => {
    const rm = ev.target.closest && ev.target.closest('[data-irremember]'); if (rm) { const p = rm.dataset.irremember.split('|'); rm.disabled = true; await ruleSet('disc', p[0], p[1]); const row = rm.closest('.ir-remrow'); if (row) row.innerHTML = '✓ ' + t('Saved. Next time it is automatic.', 'اتحفظت. المرة الجاية تلقائي.'); return; }
    const rd = ev.target.closest && ev.target.closest('[data-irrdel]'); if (rd) { const p = rd.dataset.irrdel.split('|'); return ruleSet(p[0], p[1], ''); }
    const ra = ev.target.closest && ev.target.closest('[data-irradd]'); if (ra) return ra.dataset.irradd === 'disc' ? ruleSet('disc', $('irRC').value, $('irRD').value) : ruleSet('co', $('irRW').value, $('irRW2').value);
    const rr = ev.target.closest && ev.target.closest('[data-irrreset]'); if (rr) { if (!rr.dataset.sure) { rr.dataset.sure = '1'; rr.textContent = t('Tap again to delete all rules', 'اضغط تاني عشان تمسح كل القواعد'); return; } return ruleSet('all', '', ''); }
    const dp = ev.target.closest && ev.target.closest('[data-irdup]'); if (dp) return dp.dataset.irdup === 'plan' ? dupPlan() : dupRun(dp);
    const mg = ev.target.closest && ev.target.closest('[data-irmig]'); if (mg) return mg.dataset.irmig === 'plan' ? migPlan() : migRun(mg.dataset.sig, mg);
    const cp = ev.target.closest && ev.target.closest('[data-ircopy]'); if (cp) return copyLink(cp.dataset.ircopy);
    const pl = ev.target.closest && ev.target.closest('[data-irplan]'); if (pl) return showPlan();
    const ap = ev.target.closest && ev.target.closest('[data-irapply]'); if (ap) return applyPlan(ap);
    const fx = ev.target.closest && ev.target.closest('[data-irfix]'); if (fx) return fixForm(fx.dataset.irfix);
    const fa = ev.target.closest && ev.target.closest('[data-irfixall]'); if (fa) return fixAll();
    const sa = ev.target.closest && ev.target.closest('[data-irall]'); if (sa) { bulkRows().forEach(r => { if (r.style.display !== 'none') r.querySelector('[data-irck]').checked = true; }); return bulkSync(); }
    const bk = ev.target.closest && ev.target.closest('[data-irbulk]'); if (bk) return bulkApply(bk);
    const so = ev.target.closest && ev.target.closest('[data-irsort]'); if (so) { window.__irJustUnsorted = []; return fixAll(); }
    const md = ev.target.closest && ev.target.closest('[data-irmode]'); if (md) { bulkAll = !bulkAll; return drawList(); }
    const sh = ev.target.closest && ev.target.closest('[data-irshare]'); if (sh) return shareFolder(sh.dataset.irshare, sh.dataset.irday || '');
    const wa = ev.target.closest && ev.target.closest('[data-irwa]'); if (wa) return shareFolder(wa.dataset.irwa, wa.dataset.irday || '', true);
    const sl = ev.target.closest && ev.target.closest('[data-irsharelast]'); if (sl) return shareLatest();
    const fg = ev.target.closest && ev.target.closest('[data-irfixgo]'); if (fg) {
      const w = fg.closest('.ir-fix'), msg = w.querySelector('[data-fmsg]'); fg.disabled = true; msg.textContent = '…';
      try {
        await api('admin_irMove', [fg.dataset.irfixgo, w.querySelector('[data-fco]').value, w.querySelector('[data-fdisc]').value, w.querySelector('[data-ftype]').value, w.querySelector('[data-fday]').value]);
        index = null; drawList();
      } catch (e) { fg.disabled = false; msg.textContent = e.message || e; }
      return;
    }
    const fo = ev.target.closest && ev.target.closest('#dxQuick [data-ir="folders"]'); if (fo) return openFolders();
    const d = ev.target.closest && ev.target.closest('[data-irdel]'); if (d) {
      d.disabled = true;
      try { await api('admin_irDelete', [d.dataset.irdel]); index = null; drawList(); } catch (e) { d.disabled = false; }
      return;
    }
    const q = ev.target.closest && ev.target.closest('[data-ir="adminopen"]'); if (q) { if (window.closeModal && document.querySelector('.modal-overlay.open')) try { closeModal(); } catch (e) {} Shk.openAdmin('ir'); }
  });

  // ---------------------------------------------------------------- DC / Admin "Files today": uploaded, closed, still to sort - on one page
  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  let todayGroups = [];
  async function admDcToday() {
    const b = $('scBody'); if (!b) return;
    const day = today();
    b.innerHTML = '<div class="sc-load"><i></i><i></i><i></i></div>';
    const [ix, cl] = await Promise.all([
      loadIndex(true).catch(e => ({ err: e })),
      api('ir_today', [day]).catch(e => ({ err: e }))
    ]);
    if (!$('scBody') || $('scBody') !== b) return;
    const files = Array.isArray(ix) ? ix : null;
    const up = files ? files.filter(f => f.co && f.co !== 'UNSORTED' && f.t >= dayStart()) : [];
    const uns = files ? files.filter(f => f.co === 'UNSORTED') : [];
    const unsToday = uns.filter(f => f.t >= dayStart()).length;
    const groups = cl && !cl.err ? (cl.groups || []) : null;
    todayGroups = groups || [];
    const nClosed = groups ? groups.reduce((a, g) => a + g.n, 0) : null;
    const byCo = {}; up.forEach(f => { (byCo[f.co] = byCo[f.co] || []).push(f); });
    const coName = k => (COMPANIES.find(c => c[0] === k) || [0, k])[1];
    const kpi = (n, l, cls) => `<div class="kpi ${cls || ''}"><b>${n == null ? '–' : n}</b><span>${l}</span></div>`;
    const closedHtml = groups ? (groups.length ? groups.map((g, i) => `<div class="ir-co"><b>${esc(g.coName)} · ${esc(g.eng)} · ${g.n}</b>
        <div class="ir-share-row"><button type="button" class="ir-big" data-ircopy="${esc(g.url)}">📋 ${t('Copy link', 'انسخ اللينك')}</button>
        <button type="button" class="ir-big" data-irshare="${esc(g.url)}" data-irday="${esc(day)}">📤 ${t('Share', 'شارك')}</button>
        <button type="button" class="ir-big" data-irwa="${esc(g.url)}" data-irday="${esc(day)}">💬 WhatsApp</button>
        <a class="ir-big" href="${esc(g.url)}" target="_blank" rel="noopener">📁 ${t('Open', 'افتح')}</a></div>
        <small class="ir-hint">${g.names.slice(0, 6).map(esc).join(' · ')}${g.n > 6 ? ' …' : ''}</small></div>`).join('') +
        `<div class="ir-share-row"><button type="button" class="ir-big" data-irtoday="share">📤 ${t('Share all closed folders of today', 'شارك كل فولدرات المقفول النهارده')}</button><button type="button" class="ir-big" data-irtoday="wa">💬 WhatsApp</button></div>`
        : `<div class="sc-empty">${t('Nothing closed from the app yet today.', 'لسه مفيش حاجة اتقفلت من الأبليكيشن النهارده.')}</div>`)
      : `<div class="sc-empty">${/Unknown function/i.test(String(cl && cl.err && cl.err.message)) ? t('This list needs the new IrFiles.gs (paste it and make a New version).', 'القايمة دي محتاجة IrFiles.gs الجديد (الصقه واعمل New version).') : esc((cl && cl.err && cl.err.message) || '')}</div>`;
    const upHtml = files ? (Object.keys(byCo).length ? Object.keys(byCo).map(k => `<div class="row col"><b>${esc(coName(k))} · ${byCo[k].length}</b><small>${byCo[k].slice(0, 6).map(f => esc(f.name)).join(' · ')}${byCo[k].length > 6 ? ' …' : ''}</small></div>`).join('') : `<div class="sc-empty">${t('Nothing uploaded today.', 'مفيش حاجة اترفعت النهارده.')}</div>`) : `<div class="sc-empty">${esc((ix && ix.err && ix.err.message) || '')}</div>`;
    const unsHtml = uns.length ? `<div class="row col"><b class="mono">${uns.length} ${t('files need a company and discipline', 'ملف محتاج شركة وتخصص')}${unsToday ? ' · ' + unsToday + ' ' + t('from today', 'من النهارده') : ''}</b>
        <small>${uns.slice(0, 5).map(f => esc(f.name)).join(' · ')}${uns.length > 5 ? ' …' : ''}</small>
        <button type="button" class="ir-big" data-ir="admin">✎ ${t('Sort them now', 'رتّبهم دلوقتي')}</button></div>` : `<div class="sc-empty">✓ ${t('Everything is sorted.', 'كله مترتب.')}</div>`;
    b.innerHTML = `<div class="kpis">${kpi(files ? up.length : null, t('Uploaded today', 'اترفع النهارده'))}${kpi(nClosed, t('Closed today', 'اتقفل النهارده'), 'ok')}${kpi(files ? uns.length : null, t('To sort', 'محتاج ترتيب'), uns.length ? 'bad' : '')}</div>
      <h3 class="sc-h">${t('Closed today', 'اتقفل النهارده')}</h3>${closedHtml}
      <h3 class="sc-h">${t('Still to sort', 'لسه محتاج ترتيب')}</h3><div class="card-list">${unsHtml}</div>
      <h3 class="sc-h">${t('Uploaded today', 'اترفع النهارده')}</h3><div class="card-list">${upHtml}</div>
      <div class="btnrow"><button type="button" class="ir-lnk" data-irtoday="go">⬆ ${t('Upload IR files', 'ارفع ملفات IR')}</button><button type="button" class="ir-lnk" data-irtoday="re">⟳ ${t('Refresh', 'حدّث')}</button></div><p class="shk-sign">architected by Ptah</p>`;
  }
  // one message with the link of every folder closed today (phone share sheet, WhatsApp, or copy)
  async function shareAllToday(wa) {
    if (!todayGroups.length) return;
    const text = t('IR files closed', 'ملفات الـ IR اللي اتقفلت') + ' · ' + today() + '\n' + todayGroups.map(g => g.coName + ' · ' + g.eng + ' (' + g.n + '): ' + g.url).join('\n');
    if (wa) { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener'); return; }
    if (navigator.share) { try { await navigator.share({ title: t('IR files closed', 'ملفات الـ IR اللي اتقفلت'), text: text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    copyLink(text);
  }
  document.addEventListener('click', ev => {
    const x = ev.target.closest && ev.target.closest('[data-irtoday]'); if (!x) return;
    const k = x.dataset.irtoday;
    if (k === 'share' || k === 'wa') return shareAllToday(k === 'wa');
    if (k === 'go') return Shk.openAdmin('ir');
    if (k === 're') return admDcToday();
  });
  Object.assign(window.Shk = window.Shk || {}, { admIr: admIr, admDcToday: admDcToday });

  Object.assign(window.Shk, { ir: { loadIndex, peekIndex: () => index, filesFor, loadPdfJs, b64bytes, projectKey: getProjectKey, openFolders, paintUp, copyLink, shareFolder, shareLatest } });

  // home: quick buttons (everybody gets "IR folder", admins and DC also get "Upload IR").
  // The home screen rebuilds its button row now and then, so the buttons are put back whenever they are missing.
  function ensureQuick() {
    try {
      const q = $('dxQuick'); if (!q) return;
      if (!q.querySelector('[data-ir="folders"]')) q.insertAdjacentHTML('beforeend', `<button type="button" data-ir="folders"><i>📁</i>${t('IR folder', 'فولدر IR')}</button>`);
      if (!q.querySelector('[data-irsharelast]')) q.insertAdjacentHTML('beforeend', `<button type="button" data-irsharelast="1"><i>🔗</i>${t('Share closed folder', 'شارك فولدر المقفول')}</button>`);
      if (isAdmin() && !q.querySelector('[data-ir="dctoday"]')) q.insertAdjacentHTML('beforeend', `<button type="button" data-ir="dctoday"><i>📋</i>${t('Files today', 'ملفات النهارده')}</button>`);
      if (isAdmin() && !q.querySelector('[data-ir="adminopen"]')) q.insertAdjacentHTML('beforeend', `<button type="button" data-ir="adminopen"><i>⬆</i>${t('Upload IR', 'ارفع IR')}</button>`);
    } catch (e) { console.warn(e); }
  }
  const baseRender = window.render;
  if (typeof baseRender === 'function') {
    window.render = function () { const r = baseRender.apply(this, arguments); ensureQuick(); return r; };
  }
  let quickT = 0;
  new MutationObserver(() => { if (quickT) return; quickT = requestAnimationFrame(() => { quickT = 0; ensureQuick(); }); }).observe(document.body, { childList: true, subtree: true });
})();
