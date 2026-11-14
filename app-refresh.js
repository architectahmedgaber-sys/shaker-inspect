/* Shaker Inspect: a refresh button inside every screen.
   It re-reads that screen's data from the server (the phone copy is only the offline fallback) without reloading the app.
   Loaded last. Screens ask for a button with Shk.rf.attach(), or carry a data-act="rf" button (full-screen pages). */
(function () {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // reload the list of requests from the sheet and wait until it has arrived
  async function items() {
    try {
      if (typeof fetchItems !== 'function') return;
      if (typeof loading !== 'undefined' && !loading) fetchItems();
      const t0 = Date.now(); await wait(120);
      while (typeof loading !== 'undefined' && loading && Date.now() - t0 < 20000) await wait(150);
    } catch (e) { console.warn(e); }
  }
  function button(fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rf-btn'; b.setAttribute('aria-label', 'Refresh'); b.title = 'Refresh'; b.textContent = '⟳';
    b.onclick = async () => {
      if (b.disabled) return;
      b.disabled = true; b.classList.add('rf-spin');
      try { await fn(); } catch (e) { console.warn(e); }
      b.disabled = false; b.classList.remove('rf-spin');
    };
    return b;
  }
  const attach = (el, fn) => { if (el) el.prepend(button(fn)); };

  // full-screen pages (calendar, villas, report ...): refresh the list when the page uses it, then open the same page again
  const NEEDS_ITEMS = { cal: 1, rep: 1, pending: 1, re: 1, board: 1, villa: 1, req: 1 };
  document.addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('#shkScreen [data-act="rf"]');
    if (!b || b.disabled) return;
    e.preventDefault();
    b.disabled = true; b.classList.add('rf-spin');
    try {
      if (NEEDS_ITEMS[Shk.dxScreen]) await items();
      if (typeof Shk.dxRe === 'function') Shk.dxRe();
    } catch (x) { console.warn(x); }
    b.disabled = false; b.classList.remove('rf-spin');
  });

  // Handover tracker: use its own "Reload from sheet" when it is on screen, else load the tracker again
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-rf-ho]'); if (!b) return;
    const f = document.getElementById('hoFrame'); if (!f) return;
    b.classList.add('rf-spin'); setTimeout(() => b.classList.remove('rf-spin'), 1200);
    try {
      const inner = f.contentDocument && f.contentDocument.getElementById('reloadBtn');
      if (inner && !inner.disabled) return inner.click();
      f.contentWindow.location.reload();
    } catch (x) { f.src = f.src; }
  });

  (window.Shk = window.Shk || {}).rf = { items, button, attach };
})();
