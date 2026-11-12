/* Shaker Inspect · fills Section C of the IR form when a request is closed.
   When the server accepts a close, the app takes the IR form (PDF) that the DC uploaded for that request,
   writes into Section C what the engineer decided (status tick, comment, name, date) with the same
   layout rules as the old "fill-cir-forms" skill, and saves the filled PDF on Drive in
   <company> / Closed / <day> / <same file name>. Nothing to press. If anything is missing (no IR file,
   not a CIR form, offline) the close itself is never affected: a small message says why the form was not filled.
   Needs api-7 (ir_saveClosed in IrFiles.gs). Loaded after app-ir.js. */
(function () {
  const api = (fn, args) => PtahApp.call(fn, args || []);
  const note = m => { try { window.showToast(m, null, null, 5200); } catch (e) {} };
  const AR = () => { try { return JSON.parse(localStorage.getItem('shkLang') || '"en"') === 'ar'; } catch (e) { return false; } };
  const t = (en, ar) => AR() ? ar : en;
  const LIB = {
    pdfLib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    fontkit: 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    reg: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSansCondensed.ttf',
    arReg: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/cairo@0.4.2/400Regular/Cairo_400Regular.ttf'
  };
  const AR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

  // Section C geometry of each kind of IR form (points, measured from the top-left of the page).
  // "anchor" is where the words SUPERVISION CONSULTANT INSPECTION COMMENTS sit; if a form has them somewhere else
  // the layout is different from what was measured, so nothing is drawn (a wrong place on a form is worse than not filling it).
  const RED = [0.859, 0.204, 0.145];
  const PROFILES = {
    SH: { name: 'SH', w: 595.32, h: 841.92, anchor: { x: 34.0, top: 513.2 },
      cm: { x0: 130.3, x1: 379.0, top: 533.4, bot: 591.5 }, cover: false,
      sig: { l: 381.8, r: 442.5, t: 532.4, b: 593.0 }, date: { x: 465.6, top: 540.2 },
      tick: { cx: { 'approved': 41.2, 'approved as noted': 119.3, 'revise & resubmit': 219.0, 'rejected': 338.3 }, cy: 698.455, s: 8.4, th: 1.05 } },
    SQ: { name: 'SQ', w: 612, h: 792, anchor: { x: 54.8, top: 449.4 },
      cm: { x0: 143.4, x1: 335.2, top: 479.6, bot: 518.8 }, cover: true,
      sig: { l: 335.9, r: 428.7, t: 479.0, b: 519.2 }, date: { l: 429.4, r: 560.4, top: 486.0 },
      tick: { cx: { 'approved': 63.66, 'approved as noted': 161.12, 'revise & resubmit': 257.75, 'rejected': 346.09 }, cy: 586.72, s: 4.6, th: 0.8 } },
    AT: { name: 'AT', w: 612, h: 792, anchor: { x: 35.9, top: 480.0 },
      cm: { x0: 99.6, x1: 279.6, top: 503.0, bot: 541.9 }, cover: true,
      sig: { l: 282.6, r: 381.0, t: 502.3, b: 542.8 }, date: { l: 384.2, r: 565.8, top: 509.0 },
      tick: { cx: { 'approved': 44.45, 'approved as noted': 102.05, 'revise & resubmit': 205.6, 'rejected': 300.3 }, cy: 611.95, s: 6.0, th: 0.9 } }
  };
  // which profile a form is: by page size, then by the company code in the file name / request number, then by its own words
  function pickProfile(pw, ph, name, txt) {
    const near = (a, b) => Math.abs(a - b) < 1.6;
    if (near(pw, PROFILES.SH.w) && near(ph, PROFILES.SH.h)) return PROFILES.SH;
    if (near(pw, 612) && near(ph, 792)) {
      const m = String(name || '').toUpperCase().match(/(?:^|[^A-Z])(SQ|AT)-(?:CIR|MIR)/);
      if (m) return PROFILES[m[1]];
      if (/Details of inspection/.test(txt || '')) return PROFILES.SQ;
    }
    return null;
  }
  const STATUS = { A: 'approved', B: 'approved as noted', C: 'revise & resubmit', D: 'rejected' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const loadScript = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src.split('/')[5])); document.head.appendChild(s); });
  let libs = null;
  async function loadLibs(needAr) {
    if (!libs) {
      if (!window.PDFLib) await loadScript(LIB.pdfLib);
      if (!window.fontkit) await loadScript(LIB.fontkit);
      const get = u => fetch(u).then(r => { if (!r.ok) throw new Error('Font download failed'); return r.arrayBuffer(); });
      libs = { reg: await get(LIB.reg) };
    }
    if (needAr && !libs.ar) libs.ar = await fetch(LIB.arReg).then(r => { if (!r.ok) throw new Error('Arabic font download failed'); return r.arrayBuffer(); });
    return libs;
  }

  // "Mohamed AbdelAziz" -> ["Mohamed", "AbdelAziz"]; a longer name keeps the first word on the first line
  function sigLines(name) {
    const w = String(name || '').trim().replace(/^(arch|eng)\.?\s+/i, '').split(/\s+/).filter(Boolean);
    if (w.length <= 1) return w;
    return [w[0], w.slice(1).join(' ')];
  }
  function longDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return '';
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  // words of a comment wrapped to a width; every line is measured with the font that will draw it
  function wrap(text, font, size, width) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) {
      const tryL = cur ? cur + ' ' + w : w;
      if (!cur || font.widthOfTextAtSize(tryL, size) <= width) cur = tryL; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ---- download of the IR file: big files come in pieces (up to 4 at once) so a 50 MB scan is not one giant call ----
  const CHUNK = 6 * 1024 * 1024, PAR = 4;
  async function download(f, onProg) {
    const ir = window.Shk.ir, size = Number(f.size) || 0;
    if (!size || size <= 1.5 * 1024 * 1024) {                      // small: one call, same as before
      const r = await api('ir_get', [f.id]); return ir.b64bytes(r.b64);
    }
    const n = Math.ceil(size / CHUNK), out = new Uint8Array(size); let got = 0, next = 0, broke = null;
    const worker = async () => {
      while (next < n && !broke) {
        const i = next++, start = i * CHUNK, len = Math.min(CHUNK, size - start);
        try { const r = await api('ir_getChunk', [f.id, start, len]); const b = ir.b64bytes(r.b64); out.set(b, start); got += b.length; if (onProg) onProg(got / size); }
        catch (e) { broke = e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAR, n) }, worker));
    if (broke) {                                                   // older server without pieces: the old way (up to 20 MB)
      if (size > 20 * 1024 * 1024) throw new Error(t('the file is big and the server needs the new script (IrFiles.gs)', 'الملف كبير والسيرفر محتاج السكريبت الجديد (IrFiles.gs)'));
      const r = await api('ir_get', [f.id]); return ir.b64bytes(r.b64);
    }
    return out;
  }

  // the IR form of this request: a PDF whose first page has "Section C"
  async function findForm(payload, fresh) {
    const ir = window.Shk && Shk.ir; if (!ir) throw new Error('IR files are not ready');
    await ir.loadIndex(!!fresh);
    let hits = ir.filesFor({ irNumber: payload.irNumber, rev: payload.rev }).filter(f => /\.pdf$/i.test(f.name));
    if (!hits.length && !fresh) { await ir.loadIndex(true); hits = ir.filesFor({ irNumber: payload.irNumber, rev: payload.rev }).filter(f => /\.pdf$/i.test(f.name)); }
    if (!hits.length) return null;
    const lib = await ir.loadPdfJs();
    for (const f of hits) {
      const bytes = await download(f, payload.onProg);
      try {
        const doc = await lib.getDocument({ data: bytes.slice() }).promise;
        const pg = await doc.getPage(1);
        const items = (await pg.getTextContent()).items, vh = pg.getViewport({ scale: 1 }).height;
        const txt = items.map(i => i.str).join(' ');
        const an = items.find(i => /^SUPERVISION/.test(String(i.str).trim()));
        try { doc.destroy(); } catch (e) {}
        if (/Section\s*C/i.test(txt)) return { name: f.name, bytes: bytes, id: f.id, txt: txt, anchor: an ? { x: an.transform[4], base: vh - an.transform[5] } : null };
      } catch (e) { console.warn('form check', f.name, e); }
    }
    return { notForm: true };
  }

  // ---- warm-up: while the engineer writes the comment, the form is downloaded, checked and the libraries and fonts are loaded,
  // so the Close button only has to draw and upload ----
  let warm = null;                                  // { key, p: Promise<form> }
  function prewarm(item) {
    const key = String(item && item.irNumber || ''); if (!key) return;
    if (warm && warm.key === key) return;
    const entry = { key, p: null };
    entry.p = (async () => {
      const [form] = await Promise.all([findForm({ irNumber: item.irNumber, rev: item.rev }, false), loadLibs(true).catch(() => null)]);
      if (form && !form.notForm && window.PDFLib) { try { form.doc = await window.PDFLib.PDFDocument.load(form.bytes, { ignoreEncryption: true }); } catch (e) { form.doc = null; } }
      return form;
    })();
    entry.p.catch(() => { if (warm === entry) warm = null; });
    warm = entry;
  }
  function takeWarm(payload) {
    const w = warm; if (!w || w.key !== String(payload.irNumber || '')) return null;
    warm = null; return w.p;
  }

  // small status line at the bottom while the form is being filled and saved (no waiting in the dark)
  let pill = null, pillT = 0;
  function status(msg, ms) {
    try {
      if (!pill) { pill = document.createElement('div'); pill.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;max-width:88vw;padding:9px 16px;border-radius:22px;background:#12233f;color:#fff;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);border:1px solid #c9a227;direction:auto'; document.body.appendChild(pill); }
      clearTimeout(pillT);
      if (!msg) { pill.style.display = 'none'; return; }
      pill.textContent = msg; pill.style.display = ''; if (ms) pillT = setTimeout(() => { pill.style.display = 'none'; }, ms);
    } catch (e) {}
  }

  async function fill(form, p) {
    const hasAr = AR_RE.test(String(p.rawNotes || ''));
    const L = await loadLibs(hasAr);
    const { PDFDocument, rgb, LineCapStyle } = window.PDFLib;
    const doc = form.doc || await PDFDocument.load(form.bytes, { ignoreEncryption: true });
    form.doc = null;
    doc.registerFontkit(window.fontkit);
    const page = doc.getPage(0), { width: pw, height: H } = page.getSize();
    const G = pickProfile(pw, H, form.name, form.txt);
    if (!G) throw new Error(t('this form layout is not set up yet (page ' + Math.round(pw) + '×' + Math.round(H) + ')', 'شكل الفورم ده لسه مش متظبط (مقاس الصفحة ' + Math.round(pw) + '×' + Math.round(H) + ')'));
    if (form.anchor && (Math.abs(form.anchor.x - G.anchor.x) > 5 || Math.abs(form.anchor.base - (G.anchor.top + 6.3)) > 4)) throw new Error(t('Section C is not where this form type has it', 'الـ Section C مش في مكانه المعروف للنوع ده من الفورم'));
    const red = rgb(RED[0], RED[1], RED[2]);
    const F = await doc.embedFont(L.reg, { subset: true });
    const FA = hasAr ? await doc.embedFont(L.ar, { subset: true }) : null;
    const yTop = (top, size) => H - top - size * 0.80;      // baseline of a line whose top edge is at "top"

    // some forms print dotted lines for writing in the comment cell: cover them so the typed text reads cleanly
    if (G.cover) page.drawRectangle({ x: G.cm.x0 - 0.4, y: H - G.cm.bot - 0.4, width: G.cm.x1 - G.cm.x0 + 0.8, height: G.cm.bot - G.cm.top + 0.8, color: rgb(1, 1, 1), borderWidth: 0 });

    // comment, verbatim, shrunk from 10 pt (down to 5.5 pt) until it fits the cell; if it still does not fit the last line ends with "..."
    const text = String(p.rawNotes || '').split(/\s+/).filter(Boolean).join(' ');
    const cmF = hasAr ? FA : F, cmW = G.cm.x1 - G.cm.x0 - 4, cmH = G.cm.bot - G.cm.top;
    let size = 10, lines = wrap(text, cmF, size, cmW);
    while (lines.length * size > cmH && size > 5.5) { size -= 0.25; lines = wrap(text, cmF, size, cmW); }
    let cut = false;
    const maxLines = Math.max(1, Math.floor(cmH / size));
    if (lines.length > maxLines) {
      cut = true; lines = lines.slice(0, maxLines);
      let last = lines[maxLines - 1];
      while (last && cmF.widthOfTextAtSize(last + '...', size) > cmW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/\s+$/, '') + '...';
    }
    lines.forEach((ln, i) => {
      const rtl = hasAr && AR_RE.test(ln);
      const w = cmF.widthOfTextAtSize(ln, size);
      page.drawText(ln, { x: rtl ? G.cm.x1 - 2 - w : G.cm.x0 + 2, y: yTop(G.cm.top + i * size, size), size, font: cmF, color: red });
    });
    if (cut) note(t('The comment was too long for the box on the form and was shortened there. The full text is in the sheet.', 'الكومنت أطول من البوكس في الفورم فاتقصّ هناك. النص الكامل موجود في الشيت.'));

    // engineer name, two lines, centred in the signature cell (the same for everybody for now)
    const sig = sigLines(p.inspector);
    let ssz = 11;
    const maxW = (G.sig.r - G.sig.l) - 4;
    while (sig.length && Math.max(...sig.map(l => F.widthOfTextAtSize(l, ssz))) > maxW && ssz > 7) ssz -= 0.25;
    const lead = ssz * 1.15, cx = (G.sig.l + G.sig.r) / 2;
    let sy = (G.sig.t + G.sig.b) / 2 - sig.length * lead / 2;
    sig.forEach(l => { page.drawText(l, { x: cx - F.widthOfTextAtSize(l, ssz) / 2, y: H - sy - ssz * 0.80 - (lead - ssz) / 2, size: ssz, font: F, color: red }); sy += lead; });

    // date (SH: fixed spot; the other forms: centred in the date cell)
    const d = longDate(p.date);
    if (d) {
      const dx = G.date.x != null ? G.date.x : (G.date.l + G.date.r) / 2 - F.widthOfTextAtSize(d, 10) / 2;
      page.drawText(d, { x: dx, y: yTop(G.date.top, 10), size: 10, font: F, color: red });
    }

    // status tick: two short strokes drawn round the middle of the box
    const key = STATUS[String(p.code || '').toUpperCase()];
    if (!key) throw new Error('unknown code ' + p.code);
    const T = G.tick, tcx = T.cx[key], s = T.s;
    const pts = [[tcx - 0.5 * s, T.cy], [tcx - 0.2083 * s, T.cy + 0.5 * s], [tcx + 0.5 * s, T.cy - 0.5 * s]].map(q => [q[0], H - q[1]]);
    for (let i = 0; i < 2; i++) page.drawLine({ start: { x: pts[i][0], y: pts[i][1] }, end: { x: pts[i + 1][0], y: pts[i + 1][1] }, thickness: T.th, color: red, lineCap: LineCapStyle.Round });
    return doc.save();
  }

  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

  let busy = Promise.resolve();
  document.addEventListener('shk-closed', ev => {
    const p = (ev.detail && ev.detail.payload) || {};
    busy = busy.then(() => run(p)).catch(e => console.warn('fill form', e));
  });

  // ---- the small tick on the close card: ticked = the IR file on Drive is filled and moved to Closed; not ticked = closed in the sheet only ----
  const TICK_KEY = 'shkIrDrive';
  const tickDefault = () => { try { return localStorage.getItem(TICK_KEY) !== '0'; } catch (e) { return true; } };
  const choice = {};                               // irNumber -> true/false, taken when the Close button is pressed
  const curItem = () => { try { return typeof currentItem !== 'undefined' ? currentItem : null; } catch (e) { return null; } };
  const tickEl = () => document.getElementById('irDriveTick');
  function ensureTick() {
    if (tickEl()) return tickEl();
    const foot = document.querySelector('.modal-footer'), btn = document.getElementById('modalSaveBtn'); if (!foot || !btn) return null;
    const l = document.createElement('label'); l.id = 'irDriveTick'; l.className = 'ir-tick'; l.hidden = true;
    l.innerHTML = `<input type="checkbox"><span>${t('Also close the IR file on Drive (fill it and move it to Closed)', 'اقفل ملف الـ IR على الدرايف كمان (يتملا ويروح Closed)')}</span>`;
    foot.insertBefore(l, btn);
    l.querySelector('input').addEventListener('change', e => { try { localStorage.setItem(TICK_KEY, e.target.checked ? '1' : '0'); } catch (x) {} });
    return l;
  }
  async function paintTick() {
    const l = ensureTick(); if (!l) return;
    l.hidden = true;
    const it = curItem(); if (!it || !window.Shk || !Shk.ir) return;
    try {
      await Shk.ir.loadIndex(false);
      if (curItem() !== it) return;
      const has = Shk.ir.filesFor(it).some(f => /\.pdf$/i.test(f.name));
      l.querySelector('input').checked = tickDefault();
      l.hidden = !has;
      if (has && l.querySelector('input').checked) prewarm(it);
    } catch (e) { /* no index: the tick stays hidden and a close behaves as before */ }
  }
  const baseOpen = window.openModal;
  if (typeof baseOpen === 'function') window.openModal = function () { const r = baseOpen.apply(this, arguments); setTimeout(paintTick, 0); return r; };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#modalSaveBtn'); if (!b) return;
    const it = curItem(), l = tickEl(); if (!it || !l || l.hidden) return;
    choice[String(it.irNumber || '')] = l.querySelector('input').checked;
  }, true);

  // save the filled form in Closed. Direct to Drive (new script); if that is not possible and the file is up to 14 MB, through the server as before
  async function save(co, day, name, out, origId, onProg) {
    let url = null;
    try { const r = await api('ir_putStart', [co, day, name, out.length, location.origin]); url = r && r.url; } catch (e) { if (e && e.net) throw e; }
    if (url) {
      try {
        const d = await new Promise((ok, bad) => {
          const x = new XMLHttpRequest(); x.open('PUT', url, true); x.setRequestHeader('Content-Type', 'application/pdf');
          x.upload.onprogress = e => { try { if (e.lengthComputable) onProg(e.loaded / e.total); } catch (z) {} };
          x.onerror = x.ontimeout = x.onabort = () => bad(new Error('direct upload failed'));
          x.onload = () => { let o = null; try { o = JSON.parse(x.responseText); } catch (e) {} (x.status >= 200 && x.status < 300 && o && o.id) ? ok(o) : bad(new Error('direct upload refused (' + x.status + ')')); };
          x.send(new Blob([out], { type: 'application/pdf' }));
        });
        status(t('Finishing on Drive…', 'بيخلّص على الدرايف…'));
        await api('ir_putDone', [d.id, co, day, name, origId || '']);
        return;
      } catch (e) { console.warn('direct save', e); if (e && e.net) throw e; }
    }
    if (out.length > 14 * 1024 * 1024) throw new Error(t('the filled file is over 14 MB and needs the new script (IrFiles.gs) to be saved', 'الملف بعد التعبئة أكبر من 14 ميجا ومحتاج السكريبت الجديد (IrFiles.gs) عشان يتحفظ'));
    status(t('Saving on Drive…', 'بيحفظ على الدرايف…'));
    await api('ir_saveClosed', [co, day, name, toB64(out), origId || '']);
  }

  async function run(p) {
    if (!p.irNumber || !p.code) return;
    if (choice[String(p.irNumber)] === false) { delete choice[String(p.irNumber)]; return note(t('Closed in the sheet only. The IR file stays in Open on Drive.', 'اتقفل في الشيت بس. ملف الـ IR فضل في Open على الدرايف.')); }
    delete choice[String(p.irNumber)];
    try {
      const w = takeWarm(p);
      status(t('Preparing the IR form…', 'بيجهّز فورم الـ IR…'));
      let form = null;
      if (w) { try { form = await w; } catch (e) { form = null; } }
      if (!form) form = await findForm(Object.assign({}, p, { onProg: f => status(t('Downloading the IR form… ', 'بينزّل فورم الـ IR… ') + Math.round(f * 100) + '%') }), false);
      if (!form) { status(''); return note(t('No IR file was uploaded for this request, so the form was not filled.', 'مفيش ملف IR مرفوع للطلب ده، فالفورم ماتملاش.')); }
      if (form.notForm) { status(''); return note(t('The IR file is not a CIR form (no Section C), so it was not filled.', 'ملف الـ IR مش فورم CIR (مفيش Section C)، فماتملاش.')); }
      status(t('Filling the form…', 'بيملا الفورم…'));
      const out = await fill(form, p);
      const m = (String(p.irNumber || '') + ' ' + String(p.description || '')).toUpperCase().match(/(?:^|[^A-Z])(SH|SQ|AT)-(?:CIR|MIR)/);
      const pk = window.Shk.ir.projectKey({ irNumber: p.irNumber, description: p.description });
      const co = (m && m[1]) || (pk && pk !== 'OTHER' ? pk : 'OTHER');
      status(t('Sending to Drive… 0%', 'بيرفع على الدرايف… 0%'));
      await save(co, String(p.date || '').slice(0, 10), form.name, out, form.id, f => status(t('Sending to Drive… ', 'بيرفع على الدرايف… ') + Math.round(f * 100) + '%'));
      status('');
      note(t('✓ IR form filled and saved in Closed on Drive.', '✓ فورم الـ IR اتملا واتحفظ في Closed على الدرايف.'));
    } catch (e) {
      status('');
      note(t('The IR form could not be filled: ', 'فورم الـ IR ماتملاش: ') + (e && e.message || e));
    }
  }
  Object.assign(window.Shk = window.Shk || {}, { irFill: { fill, findForm, run, prewarm } });
})();
