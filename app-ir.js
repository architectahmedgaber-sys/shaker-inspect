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

  async function openFile(id, name) {
    const v = $('irView'); if (!v) return;
    const seq = ++loadSeq; curFile = id; paintFiles();
    v.hidden = false; v.innerHTML = `<div class="ir-load">${t('Opening…', 'بيفتح…')}</div>`;
    try {
      const f = await api('ir_get', [id]);
      if (seq !== loadSeq) return;
      const bytes = b64bytes(f.b64), blob = new Blob([bytes], { type: f.mime });
      const url = URL.createObjectURL(blob);
      const bar = `<div class="ir-bar"><b dir="auto">${esc(f.name)}</b><a class="ir-lnk" href="${url}" target="_blank" rel="noopener" download="${esc(f.name)}">${t('Open / save', 'فتح / حفظ')}</a><button type="button" class="ir-lnk" data-ir="hide">${t('Hide', 'اخفي')}</button></div>`;
      if (/^image\//.test(f.mime)) { v.innerHTML = bar + `<div class="ir-pages"><img src="${url}" alt=""></div>`; return; }
      v.innerHTML = bar + `<div class="ir-pages" id="irPages"><div class="ir-load">${t('Drawing pages…', 'بيرسم الصفحات…')}</div></div>`;
      let lib; try { lib = await loadPdfJs(); } catch (e) { $('irPages').innerHTML = `<div class="ir-load">${t('Could not load the viewer. Use "Open / save".', 'العارض مفتحش. استخدم "فتح / حفظ".')}</div>`; return; }
      const doc = await lib.getDocument({ data: bytes }).promise;
      if (seq !== loadSeq) return;
      const host = $('irPages'); host.innerHTML = '';
      const w = Math.min(host.clientWidth || 360, 900), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const n = Math.min(doc.numPages, 30);
      for (let p = 1; p <= n; p++) {
        const pg = await doc.getPage(p); if (seq !== loadSeq) return;
        const vp0 = pg.getViewport({ scale: 1 }), sc = w / vp0.width, vp = pg.getViewport({ scale: sc * dpr });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = '100%';
        host.appendChild(c);
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
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
      sh.addEventListener('click', e => { if (e.target === sh || e.target.closest('[data-irx]')) sh.classList.remove('open'); }); }
    sh.innerHTML = `<div class="ir-sheet-box"><div class="ir-sheet-h"><b>${t('IR files on Drive', 'ملفات الـ IR على الدرايف')}</b><button type="button" data-irx="1" class="ir-lnk">✕</button></div><div class="ir-load">${t('Loading…', 'بيحمّل…')}</div></div>`;
    sh.classList.add('open');
    try {
      const r = await api('ir_links');
      const box = sh.querySelector('.ir-sheet-box');
      const cos = (r.companies || []).slice().sort((a, b) => (b.key === prefer) - (a.key === prefer));
      box.innerHTML = `<div class="ir-sheet-h"><b>${t('IR files on Drive', 'ملفات الـ IR على الدرايف')}</b><button type="button" data-irx="1" class="ir-lnk">✕</button></div>` +
        (r.root ? `<a class="ir-go" href="${esc(r.root)}" target="_blank" rel="noopener">📁 ${t('All companies', 'كل الشركات')}</a>` : '') +
        (cos.length ? cos.map(c => `<div class="ir-co"><a class="ir-go" href="${esc(c.url)}" target="_blank" rel="noopener">📁 ${esc(c.name)}</a>
          ${c.closedUrl ? `<a class="ir-go ir-closed" href="${esc(c.closedUrl)}" target="_blank" rel="noopener">✅ ${t('Closed (filled forms)', 'اللي اتقفل (الفورم مملية)')}</a><div class="ir-days">${(c.closed || []).map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.day)}</a>`).join('')}</div>` : ''}
          <div class="ir-days">${c.days.length ? c.days.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.day)}</a>`).join('') : `<small class="ir-hint">${t('No days yet.', 'مفيش أيام لسه.')}</small>`}</div></div>`).join('') : `<div class="ir-load">${t('No files uploaded yet.', 'لسه مفيش ملفات مرفوعة.')}</div>`) +
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
      const out = $('irUp'); let ok = 0; const bad = [];
      for (let i = 0; i < files.length; i++) {
        out.textContent = t('Uploading ', 'بيرفع ') + (i + 1) + ' / ' + files.length + ' · ' + files[i].name;
        try { await api('admin_irUpload', [files[i].name, await toB64(files[i]), co, day]); ok++; } catch (er) { bad.push(files[i].name + ': ' + (er.message || er)); }
      }
      out.innerHTML = `✓ ${ok} ${t('uploaded', 'اترفع')}` + (bad.length ? `<br><span class="bad">${bad.map(esc).join('<br>')}</span>` : '');
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

  Object.assign(window.Shk, { ir: { loadIndex, filesFor, loadPdfJs, b64bytes, projectKey: getProjectKey, openFolders } });

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
