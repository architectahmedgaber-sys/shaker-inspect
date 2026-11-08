/* Shaker Inspect: system Back button (Android / browser) closes the top layer instead of leaving the app.
   Layers = full-screen pages, popups, scanner, Handover tracker (and its inner levels). Company / list / request
   levels already use history in index.html; this file adds the rest. Back exits only from the home screen. */
(function () {
  const SEL = '#hoWrap.open, #shkScreen.open, .acct-overlay.open, .tour-overlay.open, .ed-overlay.open, #vxScan, #vxDraw';
  const CLOSERS = '[data-vx="qrclose"],[data-vx="scanclose"],[data-dr="cancel"],[data-mg="x"],#dxSigX,.acct-close';
  let order = [];          // open layers, bottom to top
  let trDepth = 0;         // inner levels of the Handover tracker (reported by the iframe)
  let pushed = 0;          // history entries we added
  let ignore = 0;          // popstates caused by our own history.go()
  const isHo = el => el && el.id === 'hoWrap';
  const total = () => order.length + (order.some(isHo) ? trDepth : 0);

  function closeLayer(el) {
    try {
      if (el.id === 'hoWrap') return window.Shk && Shk.closeHandover();
      if (el.id === 'shkScreen') return window.Shk && Shk.closeScreen();
      if (el.classList.contains('ed-overlay') && window.edClose) return window.edClose();
      const b = el.querySelector(CLOSERS);
      if (b) return b.click();
      if (el.classList.contains('open')) el.classList.remove('open'); else el.remove();
    } catch (e) {}
  }
  function push() {
    pushed++;
    const st = Object.assign({}, history.state || {}, { m: false, shkL: pushed });
    try { history.pushState(st, ''); } catch (e) {}
  }
  function sync() {
    const now = Array.from(document.querySelectorAll(SEL));
    order = order.filter(el => now.indexOf(el) >= 0);
    now.forEach(el => { if (order.indexOf(el) < 0) order.push(el); });
    const t = total();
    while (pushed < t) push();
    if (pushed > t) {                  // closed from the screen (X button): drop our entries
      const n = pushed - t; pushed = t; ignore++;
      try { history.go(-n); } catch (e) { ignore--; }
    }
  }
  function onPop(e) {
    if (ignore > 0) { ignore--; return; }
    const lvl = (e.state && e.state.shkL) || 0;
    if (lvl >= pushed) { if (lvl > pushed) pushed = lvl; return; }
    pushed = lvl;
    let guard = 20;
    while (total() > lvl && guard--) {
      const top = order[order.length - 1];
      if (!top) break;
      if (isHo(top) && trDepth > 0) {   // step back inside the Handover tracker
        trDepth--;
        const f = document.getElementById('hoFrame');
        try { f.contentWindow.postMessage({ shk: 'back' }, '*'); } catch (x) {}
        continue;
      }
      order.pop(); closeLayer(top);
    }
    // a layer that refused to close (unsaved editor): put its entry back
    setTimeout(() => { sync(); }, 0);
  }
  window.addEventListener('popstate', onPop);
  window.addEventListener('message', e => {
    const f = document.getElementById('hoFrame');
    if (!f || e.source !== f.contentWindow || !e.data) return;
    if (e.data.shk === 'depth') { trDepth = Math.max(0, e.data.n | 0); sync(); }
    if (e.data.shk === 'exit') history.back();
  });
  new MutationObserver(() => sync()).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  window.Shk = window.Shk || {}; Shk.navBack = () => history.back();
})();
