/* Shaker Inspect · the request card.
   The request opens as ONE card over a dimmed, blurred screen (a sheet from the bottom on phones, centred on a laptop;
   never a column on the side). Inside it: who → whom and the IR file, the decision (A / B / C / D), the notes,
   and three folded rows (Checklist, Photos, More) that open only when tapped. The normal buttons and rules are the
   same as before; this file only moves the existing parts into that order. Loaded after app-irfill.js. */
(function () {
  const $ = id => document.getElementById(id);
  const AR = () => { try { return JSON.parse(localStorage.getItem('shkLang') || '"en"') === 'ar'; } catch (e) { return false; } };
  const t = (en, ar) => AR() ? ar : en;

  // never the side column: the card is always on top of a dimmed screen
  window.isPanel = () => false;

  function row(id, title) {
    const d = document.createElement('details'); d.className = 'cd-row'; d.id = id;
    d.innerHTML = `<summary><span>${title}</span><small class="cd-sum"></small><i aria-hidden="true">›</i></summary><div class="cd-body"></div>`;
    return d;
  }
  const sum = (d, s) => { const el = d && d.querySelector('.cd-sum'); if (el) el.textContent = s || ''; };

  let built = false;
  function build() {
    const box = document.querySelector('.modal-box'); if (!box || built) return;
    const foot = box.querySelector('.modal-footer'), a = $('code-A'), insp = $('inspectorPills'), date = $('modalDate'), notes = $('modalNotes'), cl = $('clGroup');
    if (!foot || !a || !insp || !date || !notes || !cl || !$('dxExtras')) return;      // other parts not ready yet: try again on the next open
    built = true;
    const codes = a.closest('.pills-group'), inspG = insp.closest('.pills-group'), dateR = date.closest('.form-row'), notesR = notes.closest('.form-row');
    const dxe = $('dxExtras'), photos = dxe.querySelector('.dx-photos'), sigRow = $('dxSigRow'), cm = dxe.querySelector('.dx-cm'), req = $('vxReqBar');

    const rCl = row('cdCl', t('Checklist', 'الـ Checklist')), rPh = row('cdPh', t('Photos', 'الصور')), rMore = row('cdMore', t('More', 'المزيد'));
    rCl.querySelector('.cd-body').appendChild(cl);
    if (photos) rPh.querySelector('.cd-body').appendChild(photos);
    const mb = rMore.querySelector('.cd-body');
    [dateR, inspG, sigRow, cm, req].forEach(n => { if (n) mb.appendChild(n); });
    sum(rMore, t('Comments · signature · date · share', 'تعليقات · توقيع · تاريخ · مشاركة'));

    const wrap = document.createElement('div'); wrap.id = 'cdRows'; wrap.className = 'cd-rows';
    wrap.append(rCl, rPh, rMore);
    box.insertBefore(codes, foot); box.insertBefore(notesR, foot); box.insertBefore(wrap, foot);
    codes.classList.add('cd-codes'); notesR.classList.add('cd-notes');
    const lab = codes.querySelector('.pills-label'); if (lab) lab.textContent = t('Decision', 'القرار');

    // the checklist row shows its progress and hides when this request has no checklist
    const prog = $('clProg');
    const syncCl = () => { rCl.hidden = cl.hidden; sum(rCl, prog ? prog.textContent.trim() : ''); };
    new MutationObserver(syncCl).observe(cl, { attributes: true, attributeFilter: ['hidden'], subtree: true, childList: true, characterData: true }); syncCl();
    const th = $('dxThumbs');
    if (th) { const syncPh = () => sum(rPh, th.children.length ? String(th.children.length) : ''); new MutationObserver(syncPh).observe(th, { childList: true }); syncPh(); }
    // a close that is refused because of a missing checklist item or photo opens that row
    const st = $('modalStatus');
    if (st) new MutationObserver(() => { const m = st.textContent || ''; if (/checklist|الـ Checklist/i.test(m)) rCl.open = true; if (/photo|صور/i.test(m)) rPh.open = true; }).observe(st, { childList: true, characterData: true, subtree: true });
  }


  // ---------- "About": the project information card that used to sit at the bottom of the home page ----------
  function openAbout() {
    const src = document.querySelector('footer .title-block'); if (!src) return;
    const old = $('cdAboutSheet'); if (old) old.remove();
    const sh = document.createElement('div'); sh.id = 'cdAboutSheet'; sh.className = 'ir-sheet';
    sh.innerHTML = `<div class="ir-sheet-box"><div class="ir-sheet-h"><b>${t('About', 'عن التطبيق')}</b><button type="button" data-irx="1" class="ir-lnk">✕</button></div><div class="cd-about"></div></div>`;
    sh.querySelector('.cd-about').appendChild(src.cloneNode(true));
    sh.addEventListener('click', e => { if (e.target === sh || (e.target.closest && e.target.closest('[data-irx]'))) sh.remove(); });
    document.body.appendChild(sh); requestAnimationFrame(() => sh.classList.add('open'));
  }
  function ensureAbout() {
    const list = document.querySelector('#acctOverlay .acct-list'); if (!list || $('cdAbout')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'cdAbout'; b.className = 'dx-me-row';
    b.innerHTML = `<span>ⓘ ${t('About', 'عن التطبيق')}</span><i>›</i>`;
    b.onclick = openAbout;
    const wrap = document.createElement('div'); wrap.className = 'dx-me';
    const row = (id, label, fn) => { const x = document.createElement('button'); x.type = 'button'; x.id = id; x.innerHTML = `<span>${label}</span><i>›</i>`; x.onclick = fn; wrap.appendChild(x); };
    // the tools that used to sit in a row on the home screen: every one of them is reached from here, and only from here
    row('cdIrFolder', '📁 ' + t('IR folder', 'فولدر IR'), () => { try { PtahApp.closeAccount && PtahApp.closeAccount(); } catch (e) {} const o = $('acctOverlay'); if (o) o.classList.remove('open'); if (window.Shk && Shk.ir) Shk.ir.openFolders(); });
    row('cdIrUpload', '⬆ ' + t('Upload IR', 'ارفع IR'), () => { const o = $('acctOverlay'); if (o) o.classList.remove('open'); if (window.Shk && Shk.openAdmin) Shk.openAdmin('ir'); });
    wrap.appendChild(b);
    list.appendChild(wrap);
  }
  // 'Upload IR' is for Admin and DC only; the role is known a moment after sign-in, so it is shown or hidden every time
  function roleRows() { const u = $('cdIrUpload'); if (!u) return; const rl = window.PtahApp && PtahApp.role && PtahApp.role(); u.hidden = !(rl === 'Admin' || rl === 'DC'); }
  new MutationObserver(() => { ensureAbout(); roleRows(); }).observe(document.body, { childList: true, subtree: true });

  const baseOpen = window.openModal;
  window.openModal = function (item) {
    const r = baseOpen.apply(this, arguments);
    try { build(); document.querySelectorAll('#cdRows details').forEach(d => { d.open = false; }); const b = document.querySelector('.modal-box'); if (b) b.scrollTop = 0; } catch (e) { console.warn(e); }
    return r;
  };
})();
