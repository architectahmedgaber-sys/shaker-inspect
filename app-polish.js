/* Shaker Inspect · "Polish" button in the close screen.
   The engineer writes a short comment (Arabic / mixed / English); the button sends it to the server (Claude API, key only in Apps Script),
   shows the polished English remark under the box, and the engineer presses "Use it" or "Keep mine".
   Nothing is blocked: if the call fails or is slow the box is left as it is. Owner account only. Needs Polish.gs + the new Api.gs. Loaded after app-ir.js. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const AR = () => { try { return JSON.parse(localStorage.getItem('shkLang') || '"en"') === 'ar'; } catch (e) { return false; } };
  const t = (en, ar) => AR() ? ar : en;
  const OWNER = 'architectahmedgaber@gmail.com';   // owner only; the server checks it too
  const TIMEOUT_MS = 25000;
  let cur = null, busy = false, backup = null;

  function inject() {
    const ta = $('modalNotes'); if (!ta || $('plRow')) return;
    const host = ta.closest('.form-row') || ta.parentNode;
    host.insertAdjacentHTML('afterend', `<div class="pl-row" id="plRow">
      <button type="button" class="pill-btn pl-btn" id="plBtn">✨ ${t('Professional wording', 'صياغة احترافية')}</button>
      <small class="pl-hint" id="plHint"></small>
      <div class="pl-box" id="plBox" hidden></div></div>`);
    $('plBtn').onclick = run;
    $('modalNotes').addEventListener('input', () => { if ($('plBox') && !busy) { $('plBox').hidden = true; } });
  }

  function reset() { backup = null; if ($('plBox')) { $('plBox').hidden = true; $('plBox').innerHTML = ''; } if ($('plHint')) $('plHint').textContent = ''; }

  function hint(msg, bad) { const h = $('plHint'); if (!h) return; h.textContent = msg || ''; h.classList.toggle('bad', !!bad); }

  async function run() {
    if (busy) return;
    const ta = $('modalNotes'), raw = (ta.value || '').trim();
    let code = ''; try { code = typeof selectedCode !== 'undefined' ? String(selectedCode || '') : ''; } catch (e) {}
    if (!raw) return hint(t('Write the comment first.', 'اكتب الكومنت الأول.'), true);
    if (!/^[ABCD]$/i.test(code)) return hint(t('Pick the code first (A / B / C / D).', 'اختار الكود الأول (A / B / C / D).'), true);
    busy = true; $('plBtn').disabled = true; hint(t('Polishing…', 'بيتروّق…')); $('plBox').hidden = true;
    const item = cur;
    try {
      const r = await Promise.race([
        PtahApp.call('polish_note', [raw, code.toUpperCase(), item && item.description ? item.description : '']),
        new Promise((_, no) => setTimeout(() => no(new Error(t('Took too long. Your text stays as it is.', 'اتأخر. كلامك زي ما هو.'))), TIMEOUT_MS))
      ]);
      if (cur !== item) return;                       // the screen moved on
      const box = $('plBox');
      box.innerHTML = `<div class="pl-lbl">${t('Polished (check it, then use it)', 'بعد التلميع (راجعه وبعدين استخدمه)')}</div>
        <div class="pl-txt" dir="ltr">${esc(r.text)}</div>
        <div class="pl-act"><button type="button" class="pill-btn pl-use" id="plUse">${t('Use it', 'استخدمه')}</button><button type="button" class="pill-btn" id="plKeep">${t('Keep mine', 'سيب كلامي')}</button></div>`;
      box.hidden = false; hint('');
      $('plUse').onclick = () => {
        backup = ta.value; ta.value = r.text; ta.dispatchEvent(new Event('input', { bubbles: true })); box.hidden = false;
        box.innerHTML = `<div class="pl-lbl">✓ ${t('Polished text is in the box. You can still edit it.', 'النص المُرَوَّق في البوكس. تقدر تعدّله.')}</div><div class="pl-act"><button type="button" class="pill-btn" id="plUndo">${t('Back to my text', 'ارجع لكلامي')}</button></div>`;
        $('plUndo').onclick = () => { ta.value = backup || ''; ta.dispatchEvent(new Event('input', { bubbles: true })); reset(); };
      };
      $('plKeep').onclick = () => { reset(); };
    } catch (e) {
      hint((e && e.message) || t('Could not polish. Your text stays as it is.', 'التلميع مشتغلش. كلامك زي ما هو.'), true);
    } finally { busy = false; if ($('plBtn')) $('plBtn').disabled = false; }
  }

  const baseOpen = window.openModal;
  window.openModal = function (item) {
    const r = baseOpen.apply(this, arguments);
    try { cur = item; busy = false; inject(); reset(); const b = $('plBtn'); if (b) b.hidden = !(window.PtahApp && String(PtahApp.email() || '').toLowerCase() === OWNER); } catch (e) { console.warn('polish', e); }
    return r;
  };
})();
