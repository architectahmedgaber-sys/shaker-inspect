/* Shaker Inspect app: extra screens on top of the portal (hero band, phone tab bar, splash,
   skeleton loading, pull to refresh, haptics). Loaded after the portal's own script. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const firstName = n => (String(n || '').split(/\s+/).find(w => w && !/^(arch|eng)\.?$/i.test(w)) || '');
  const initials = n => String(n || '').split(/\s+/).filter(w => w && !/^(arch|eng)\.?$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  let ready = false;

  // ---------- hero band: greeting + 3 stat tiles (home screen) ----------
  function hero() {
    let el = $('heroBand');
    if (!el) {
      el = document.createElement('section'); el.id = 'heroBand'; el.className = 'hero';
      const top = document.querySelector('.topbar'); top.parentNode.insertBefore(el, top);
    }
    const home = typeof view !== 'undefined' && view.level === 'home' && !currentQuery;
    el.hidden = !home || !ready;
    document.body.classList.toggle('at-home', home && ready);
    if (el.hidden) return;
    const items = allItems || [], late = lateCount(items), done = closedToday();
    const name = firstName(window.PtahApp && PtahApp.engineer());
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    el.innerHTML = `
      <div class="hero-hi"><div><small>${esc(date)}</small><h2>${esc(greet())}${name ? ', <br>' + esc(name) : ''}</h2></div>
        <button type="button" class="hero-av" onclick="PtahApp.openAccount()" title="Account">${esc(initials(window.PtahApp && PtahApp.engineer()))}</button></div>
      ${PtahApp.role() === 'Admin' ? '<button type="button" class="hero-admin" onclick="Shk.openAdmin()">Admin screen<i>›</i></button>' : ''}
      ${PtahApp.role() === 'Viewer' ? '<div class="hero-view">View only · you can look at everything but not close requests</div>' : ''}
      <div class="hero-stats">
        <div class="hs"><b data-n="${items.length}">${items.length}</b><span>Pending</span></div>
        <div class="hs late${late ? ' on' : ''}"><b data-n="${late}">${late}</b><span>Late</span></div>
        <div class="hs ok"><b data-n="${done}">${done}</b><span>Closed today</span></div>
      </div>`;
    signature();
    if (!el.dataset.counted) { el.dataset.counted = 1; el.querySelectorAll('b[data-n]').forEach(countUp); }
  }
  // "architected by Ptah" at the end of the lists
  function signature() {
    let g = $('endSign');
    if (!g) { g = document.createElement('p'); g.id = 'endSign'; g.className = 'shk-sign end'; g.textContent = 'architected by Ptah'; const c = $('gridContainer'); c.parentNode.insertBefore(g, c.nextSibling); }
  }
  function countUp(b) {
    const to = +b.dataset.n; if (!to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now(), dur = 700;
    const step = t => { const k = Math.min(1, (t - t0) / dur); b.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    b.textContent = '0'; requestAnimationFrame(step);
  }

  // ---------- wrap the portal's render / renderGrid ----------
  const baseRender = window.render;
  window.render = function () { const r = baseRender.apply(this, arguments); try { hero(); tabs(); signature(); } catch (e) { console.warn(e); } return r; };
  const baseGrid = window.renderGrid;
  window.renderGrid = function (items) { ready = true; hideSplash(); return baseGrid.apply(this, arguments); };
  const baseOk = window.handleSuccessSubmission;
  window.handleSuccessSubmission = function () { try { navigator.vibrate && navigator.vibrate([18, 40, 18]); } catch (e) {} return baseOk.apply(this, arguments); };

  // ---------- phone tab bar ----------
  function tabs() {
    const bar = $('tabBar'); if (!bar) return;
    const lvl = typeof view !== 'undefined' ? view.level : 'home';
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === (lvl === 'home' ? 'home' : 'list')));
  }
  function buildTabs() {
    const bar = document.createElement('nav'); bar.id = 'tabBar'; bar.className = 'tabbar'; bar.setAttribute('aria-label', 'Main');
    const ic = {
      home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
      list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
      search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
      sync: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
      me: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'
    };
    ic.sheet = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>';
    ic.villa = '<path d="M3 20h18M5 20V9l7-5 7 5v11"/><path d="M10 20v-6h4v6"/>';
    const items = [['home', 'Home', () => goHome()], ['list', 'Requests', openAll], ['sheet', 'Sheets', () => Shk.openSheets()], ['villa', 'Handover', () => { location.href = 'tracker.html'; }], ['me', 'Me', () => PtahApp.openAccount()]];
    bar.innerHTML = items.map(([k, l]) => `<button type="button" data-t="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic[k]}</svg><span>${l}</span></button>`).join('');
    bar.querySelectorAll('button').forEach((b, i) => b.onclick = items[i][2]);
    document.body.appendChild(bar);
  }
  // "Requests": the busiest contractor's CIR list (one tap from the field)
  function openAll() {
    const b = bucketize(allItems);
    const best = visibleProjects(b).map(p => ({ p, n: countOf(b, p.key, 'CIR') })).sort((x, y) => y.n - x.n)[0];
    if (best && best.n) goList(best.p.key, 'CIR'); else goHome();
  }
  function focusSearch() { const s = $('searchInput'); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => s && s.focus(), 150); }

  // ---------- splash + skeleton ----------
  function splash() {
    const s = document.createElement('div'); s.id = 'splash'; s.className = 'splash';
    s.innerHTML = '<em class="shk-hand"><i>architected by Ptah</i></em>';
    document.body.appendChild(s);
    // 1) the signature writes itself in (about 1.8 s)  2) it stays long enough to be read
    // 3) the whole screen wipes away from left to right, and the sign-in / home page shows underneath
    const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => s.classList.add('wipe'), quick ? 1200 : 3700);
    setTimeout(() => s.remove(), quick ? 1500 : 4700);
  }
  // the intro always plays in full; other code may call this, it does nothing now
  function hideSplash() {}
  (window.Shk = window.Shk || {}).hideSplash = hideSplash;
  function skeleton() {
    const l = $('loadingState'); if (!l) return;
    l.innerHTML = '<div class="sk-hero"><i></i><i></i></div><div class="sk-row"><i></i><i></i><i></i></div>' + '<div class="sk-card"><i></i><i></i></div>'.repeat(3);
  }

  // ---------- pull to refresh (phone) ----------
  function pull() {
    let y0 = null, dy = 0; const ind = document.createElement('div'); ind.id = 'pullInd'; ind.className = 'pull-ind'; ind.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>';
    document.body.appendChild(ind);
    addEventListener('touchstart', e => { y0 = (scrollY <= 0 && !document.querySelector('.modal-overlay.active, .login-overlay.open, .acct-overlay.open, #edOverlay.open')) ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); const k = Math.min(1, dy / 90);
      ind.style.transform = `translate(-50%, ${dy * .5 - 50}px) rotate(${k * 270}deg)`; ind.style.opacity = k; ind.classList.toggle('arm', k >= 1); }, { passive: true });
    addEventListener('touchend', () => { if (y0 == null) return; if (dy >= 90 && !loading) { ind.classList.add('go'); fetchItems(); setTimeout(() => ind.classList.remove('go'), 900); }
      ind.style.transform = ''; ind.style.opacity = 0; ind.classList.remove('arm'); y0 = null; });
  }

  splash(); skeleton(); buildTabs(); pull();
})();
