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

  // Section C geometry of the form PEG-1202-09-07-FM Rev.0 (points, measured from the top of the page)
  const G = {
    cm: { x0: 130.3, x1: 379.0, top: 533.4, bot: 591.5 },
    sig: { l: 381.8, r: 442.5, t: 532.4, b: 593.0 },
    date: { x: 465.6, top: 540.2 },
    box: { 'approved': 34.0, 'approved as noted': 112.1, 'revise & resubmit': 211.8, 'rejected': 331.1 },
    tick: [[115.10, 698.46], [117.55, 702.66], [123.50, 694.25]], tickBase: 112.1,
    pageH: 841.92, red: [0.859, 0.204, 0.145]
  };
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

  // the IR form of this request: a PDF whose first page has "Section C"
  async function findForm(payload) {
    const ir = window.Shk && Shk.ir; if (!ir) throw new Error('IR files are not ready');
    await ir.loadIndex(true);
    const hits = ir.filesFor({ irNumber: payload.irNumber, rev: payload.rev }).filter(f => /\.pdf$/i.test(f.name));
    if (!hits.length) return null;
    const lib = await ir.loadPdfJs();
    for (const f of hits) {
      const r = await api('ir_get', [f.id]);
      const bytes = ir.b64bytes(r.b64);
      try {
        const doc = await lib.getDocument({ data: bytes.slice() }).promise;
        const pg = await doc.getPage(1);
        const txt = (await pg.getTextContent()).items.map(i => i.str).join(' ');
        if (/Section\s*C/i.test(txt)) return { name: f.name, bytes: bytes, id: f.id };
      } catch (e) { console.warn('form check', f.name, e); }
    }
    return { notForm: true };
  }

  async function fill(form, p) {
    const hasAr = AR_RE.test(String(p.rawNotes || ''));
    const L = await loadLibs(hasAr);
    const { PDFDocument, rgb, LineCapStyle } = window.PDFLib;
    const doc = await PDFDocument.load(form.bytes);
    doc.registerFontkit(window.fontkit);
    const page = doc.getPage(0), { width: pw, height: H } = page.getSize();
    if (Math.abs(H - G.pageH) > 1.5 || Math.abs(pw - 595.32) > 1.5) throw new Error('unexpected page size');
    const red = rgb(G.red[0], G.red[1], G.red[2]);
    const F = await doc.embedFont(L.reg, { subset: true });
    const FA = hasAr ? await doc.embedFont(L.ar, { subset: true }) : null;
    const yTop = (top, size) => H - top - size * 0.80;      // baseline of a line whose top edge is at "top"

    // comment, verbatim, shrunk from 10 pt until it fits the cell
    const text = String(p.rawNotes || '').split(/\s+/).filter(Boolean).join(' ');
    const cmF = hasAr ? FA : F, cmW = G.cm.x1 - G.cm.x0 - 4, cmH = G.cm.bot - G.cm.top;
    let size = 10, lines = wrap(text, cmF, size, cmW);
    while (lines.length * size > cmH && size > 5) { size -= 0.25; lines = wrap(text, cmF, size, cmW); }
    lines.forEach((ln, i) => {
      const rtl = hasAr && AR_RE.test(ln);
      const w = cmF.widthOfTextAtSize(ln, size);
      page.drawText(ln, { x: rtl ? G.cm.x1 - 2 - w : G.cm.x0 + 2, y: yTop(G.cm.top + i * size, size), size, font: cmF, color: red });
    });

    // engineer name, two lines, centred in the signature cell (the same for everybody for now)
    const sig = sigLines(p.inspector);
    let ssz = 11;
    const maxW = (G.sig.r - G.sig.l) - 4;
    while (sig.length && Math.max(...sig.map(l => F.widthOfTextAtSize(l, ssz))) > maxW && ssz > 7) ssz -= 0.25;
    const lead = ssz * 1.15, cx = (G.sig.l + G.sig.r) / 2;
    let sy = (G.sig.t + G.sig.b) / 2 - sig.length * lead / 2;
    sig.forEach(l => { page.drawText(l, { x: cx - F.widthOfTextAtSize(l, ssz) / 2, y: H - sy - ssz * 0.80 - (lead - ssz) / 2, size: ssz, font: F, color: red }); sy += lead; });

    // date
    const d = longDate(p.date);
    if (d) page.drawText(d, { x: G.date.x, y: yTop(G.date.top, 10), size: 10, font: F, color: red });

    // status tick
    const key = STATUS[String(p.code || '').toUpperCase()];
    if (!key) throw new Error('unknown code ' + p.code);
    const bx = G.box[key] - G.tickBase, pts = G.tick.map(q => [q[0] + bx, H - q[1]]);
    for (let i = 0; i < 2; i++) page.drawLine({ start: { x: pts[i][0], y: pts[i][1] }, end: { x: pts[i + 1][0], y: pts[i + 1][1] }, thickness: 1.05, color: red, lineCap: LineCapStyle.Round });
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
    } catch (e) { /* no index: the tick stays hidden and a close behaves as before */ }
  }
  const baseOpen = window.openModal;
  if (typeof baseOpen === 'function') window.openModal = function () { const r = baseOpen.apply(this, arguments); setTimeout(paintTick, 0); return r; };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#modalSaveBtn'); if (!b) return;
    const it = curItem(), l = tickEl(); if (!it || !l || l.hidden) return;
    choice[String(it.irNumber || '')] = l.querySelector('input').checked;
  }, true);

  async function run(p) {
    if (!p.irNumber || !p.code) return;
    if (choice[String(p.irNumber)] === false) { delete choice[String(p.irNumber)]; return note(t('Closed in the sheet only. The IR file stays in Open on Drive.', 'اتقفل في الشيت بس. ملف الـ IR فضل في Open على الدرايف.')); }
    delete choice[String(p.irNumber)];
    try {
      const form = await findForm(p);
      if (!form) return note(t('No IR file was uploaded for this request, so the form was not filled.', 'مفيش ملف IR مرفوع للطلب ده، فالفورم ماتملاش.'));
      if (form.notForm) return note(t('The IR file is not a CIR form (no Section C), so it was not filled.', 'ملف الـ IR مش فورم CIR (مفيش Section C)، فماتملاش.'));
      const out = await fill(form, p);
      const m = (String(p.irNumber || '') + ' ' + String(p.description || '')).toUpperCase().match(/(?:^|[^A-Z])(SH|SQ|AT)-(?:CIR|MIR)/);
      const pk = window.Shk.ir.projectKey({ irNumber: p.irNumber, description: p.description });
      const co = (m && m[1]) || (pk && pk !== 'OTHER' ? pk : 'OTHER');
      await api('ir_saveClosed', [co, String(p.date || '').slice(0, 10), form.name, toB64(out), form.id || '']);
      note(t('✓ IR form filled and saved in Closed on Drive.', '✓ فورم الـ IR اتملا واتحفظ في Closed على الدرايف.'));
    } catch (e) {
      note(t('The IR form could not be filled: ', 'فورم الـ IR ماتملاش: ') + (e && e.message || e));
    }
  }
  Object.assign(window.Shk = window.Shk || {}, { irFill: { fill, findForm, run } });
})();
