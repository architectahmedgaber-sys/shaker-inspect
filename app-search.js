/* Shaker Inspect: quick search from any screen.
   A round search button (bottom right) or the "/" key opens a search box. Type an IR number (14689 or the last digits),
   a villa number (105), a company (Shorouk, SH) or any word of the activity. Tap a result to open that request.
   Also lists matching IR files from Drive (loaded only when you search, cached 2 min by app-ir.js).
   Arabic digits work too. Everything runs on the phone against the list already loaded: no extra server call
   for requests. Loaded last. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const norm = s => String(s == null ? '' : s).replace(/[٠-٩]/g, d => AR.indexOf(d)).toLowerCase();
  const MAX_REQ = 40, MAX_FILES = 12;
  const HIST_KEY = 'shkSearchHist';
  const ls = { get() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } },
               set(v) { try { localStorage.setItem(HIST_KEY, JSON.stringify(v.slice(0, 6))); } catch (e) {} } };

  const css = document.createElement('style');
  css.textContent = `
  .sq-fab{position:fixed;left:14px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:850;width:50px;height:50px;border-radius:50%;border:0;cursor:pointer;
    background:var(--accent,#f5b800);color:var(--accent-ink,#0b2a5b);box-shadow:0 8px 22px -6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:0}
  .sq-fab svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
  @media (min-width:720px){.sq-fab{left:104px;bottom:24px}}
  body:has(.modal-overlay.active) .sq-fab,body.locked .sq-fab,body:has(.login-overlay.open) .sq-fab,body:has(.sq-overlay.open) .sq-fab{display:none}
  .sq-overlay{position:fixed;inset:0;z-index:9700;background:rgba(5,15,35,.55);display:none;align-items:flex-start;justify-content:center;padding:calc(12px + env(safe-area-inset-top)) 10px 10px}
  .sq-overlay.open{display:flex}
  .sq-box{width:100%;max-width:640px;max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:var(--surface-solid,#fff);color:var(--ink,#111);border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.4);overflow:hidden}
  .sq-top{display:flex;gap:8px;align-items:center;padding:10px;border-bottom:1px solid var(--line,#ddd)}
  .sq-top input{flex:1;min-width:0;font:600 17px system-ui,sans-serif;color:inherit;background:var(--surface-2,#f3f3f3);border:1px solid var(--line-strong,#ccc);border-radius:12px;padding:11px 12px;outline:none}
  .sq-top input:focus{border-color:var(--accent,#f5b800)}
  .sq-x{border:0;background:none;color:var(--muted,#777);font:700 14px system-ui,sans-serif;padding:8px;cursor:pointer}
  .sq-body{overflow:auto;-webkit-overflow-scrolling:touch;padding:6px 8px 12px}
  .sq-h{font:700 11px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#777);padding:10px 6px 4px}
  .sq-r{display:flex;gap:10px;align-items:center;width:100%;text-align:left;border:0;background:none;color:inherit;border-radius:12px;padding:10px 8px;cursor:pointer;font:inherit}
  .sq-r:hover,.sq-r:focus,.sq-r.on{background:var(--accent-soft,rgba(245,184,0,.18));outline:none}
  .sq-r .sq-m{flex:1;min-width:0}
  .sq-r b{display:block;font:700 15px/1.25 system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sq-r small{display:block;font:500 12.5px/1.3 system-ui,sans-serif;color:var(--muted,#777);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sq-r .sq-t{font:700 11px system-ui,sans-serif;padding:3px 8px;border-radius:99px;background:var(--surface-2,#eee);color:var(--muted,#666);white-space:nowrap}
  .sq-r .sq-t.late{background:var(--late-soft,#fde);color:var(--late,#d22)}
  .sq-empty{padding:26px 10px;text-align:center;color:var(--muted,#777);font:500 14px system-ui,sans-serif}
  .sq-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 6px}
  .sq-chips button{border:1px solid var(--line-strong,#ccc);background:var(--surface-2,#f3f3f3);color:inherit;border-radius:99px;padding:6px 12px;font:600 13px system-ui,sans-serif;cursor:pointer}
  .sq-more{display:block;margin:6px auto 0;border:0;background:none;color:var(--muted,#777);font:600 13px system-ui,sans-serif;cursor:pointer;padding:8px}`;
  document.head.appendChild(css);

  // ---------- the data to search (built once per loaded list, per request) ----------
  const hay = new WeakMap();
  const g = n => (typeof window[n] === 'function' ? window[n] : null);
  function prep(item) {
    let h = hay.get(item); if (h) return h;
    let proj = '', co = '', type = '', villa = '', vnums = [], act = '';
    try { const k = getProject(item); co = k + ' ' + projectInfo(k).label; type = getDocType(item); villa = villaOf(item); act = activityOf(item); } catch (e) {}
    try { const m = String(item.description || '').match(VILLA_RE); if (m) vnums = m[1].match(/\d+/g) || []; } catch (e) {}
    const num = String(item.irNumber || '');
    let sn = ''; try { sn = shortNum(item); } catch (e) {}
    h = { text: norm([num, item.description, co, type, villa, act, item.contractor, item.createdBy, item.inspector].filter(Boolean).join(' ')),
          num: norm(num), sn: norm(sn).replace(/^0+/, ''), vnums, co: norm(co), type };
    hay.set(item, h); return h;
  }
  function score(item, toks) {
    const h = prep(item); let s = 0;
    for (const t of toks) {
      if (!h.text.includes(t)) return -1;
      if (/^\d+$/.test(t)) {
        const tt = t.replace(/^0+/, '');
        if (h.vnums.indexOf(tt) >= 0 || h.vnums.indexOf(t) >= 0) s += 60;
        if (h.sn === tt) s += 100; else if (h.sn.endsWith(tt) && tt.length >= 3) s += 40;
      } else if (h.co.includes(t)) s += 20;
      else s += 5;
    }
    return s;
  }
  function search(q) {
    const toks = norm(q).split(/[\s,;/]+/).filter(Boolean);
    if (!toks.length) return [];
    const out = [];
    (typeof allItems !== 'undefined' ? allItems : []).forEach(it => { const s = score(it, toks); if (s >= 0) out.push([s, it]); });
    out.sort((a, b) => b[0] - a[0] || (+b[1].ageDays || 0) - (+a[1].ageDays || 0));
    return out.map(x => x[1]);
  }
  function fileHits(q) {
    const idx = window.Shk && Shk.ir && Shk.ir.peekIndex ? Shk.ir.peekIndex() : null; if (!idx) return [];
    const toks = norm(q).split(/[\s,;/]+/).filter(Boolean); if (!toks.length) return [];
    return idx.filter(f => { const n = norm(f.name); return toks.every(t => n.includes(t)); });
  }

  // ---------- the screen ----------
  let ov, inp, body, cur = [], more = false, seq = 0, timer = null, sel = -1;
  function build() {
    if (ov) return;
    ov = document.createElement('div'); ov.id = 'sqOverlay'; ov.className = 'sq-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Search');
    ov.innerHTML = '<div class="sq-box"><div class="sq-top"><input id="sqIn" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="IR number, villa, company…" aria-label="Search"><button type="button" class="sq-x" data-sq="x">Close</button></div><div class="sq-body" id="sqBody"></div></div>';
    document.body.appendChild(ov);
    inp = $('sqIn'); body = $('sqBody');
    ov.addEventListener('click', e => {
      if (e.target === ov || (e.target.closest && e.target.closest('[data-sq="x"]'))) return close();
      const r = e.target.closest && e.target.closest('[data-sq-i],[data-sq-f],[data-sq-q],[data-sq-more]'); if (!r) return;
      if (r.hasAttribute('data-sq-more')) { more = true; paint(); return; }
      if (r.dataset.sqQ != null) { inp.value = r.dataset.sqQ; run(); inp.focus(); return; }
      if (r.dataset.sqI != null) pickReq(+r.dataset.sqI);
      else if (r.dataset.sqF != null) pickFile(r.dataset.sqF);
    });
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
    inp.addEventListener('keydown', e => {
      const rows = Array.from(body.querySelectorAll('.sq-r'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!rows.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; rows.forEach((r, i) => r.classList.toggle('on', i === sel)); rows[sel].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = rows[sel >= 0 ? sel : 0]; if (r) r.click(); else run(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  }
  function open(q) {
    build();
    if (!ov.classList.contains('open')) { ov.classList.add('open'); more = false; }
    if (q != null) inp.value = q;
    run(); setTimeout(() => { inp.focus(); inp.select(); }, 60);
    // IR files list is only needed once someone searches; it loads in the background and refreshes the results
    try { if (window.Shk && Shk.ir && Shk.ir.loadIndex) Shk.ir.loadIndex().then(() => { if (ov.classList.contains('open') && inp.value.trim()) paint(); }).catch(() => {}); } catch (e) {}
  }
  function close() { if (ov) ov.classList.remove('open'); }

  function run() { more = false; sel = -1; cur = inp.value.trim() ? search(inp.value) : []; paint(); }
  function paint() {
    const q = inp.value.trim(); let h = '';
    if (!q) {
      const hist = ls.get();
      h = '<div class="sq-empty">Type an IR number (14689), a villa (105) or a company (Shorouk).</div>';
      if (hist.length) h += '<div class="sq-h">Recent</div><div class="sq-chips">' + hist.map(x => `<button type="button" data-sq-q="${esc(x)}">${esc(x)}</button>`).join('') + '</div>';
      body.innerHTML = h; return;
    }
    const files = fileHits(q);
    if (!cur.length && !files.length) { body.innerHTML = '<div class="sq-empty">Nothing found for “' + esc(q) + '”.<br>Closed requests are in <b>Files</b>.</div>'; return; }
    if (cur.length) {
      const shown = more ? cur : cur.slice(0, MAX_REQ);
      h += '<div class="sq-h">Requests · ' + cur.length + '</div>' + shown.map((it, i) => {
        let late = false, age = '', co = '', ty = '';
        try { late = isLate(it); age = ageText(it); co = projectInfo(getProject(it)).label; ty = getDocType(it); } catch (e) {}
        return `<button type="button" class="sq-r" data-sq-i="${i}"><span class="sq-m"><b>${esc(villaOf(it))} · ${esc(it.irNumber || 'N/A')}</b><small>${esc(co)} · ${esc(ty)} · ${esc(activityOf(it))}</small></span><span class="sq-t${late ? ' late' : ''}">${esc(age)}</span></button>`;
      }).join('');
      if (!more && cur.length > MAX_REQ) h += `<button type="button" class="sq-more" data-sq-more>Show all ${cur.length}</button>`;
    }
    if (files.length) {
      h += '<div class="sq-h">IR files · ' + files.length + '</div>' + files.slice(0, MAX_FILES).map(f =>
        `<button type="button" class="sq-r" data-sq-f="${esc(f.id)}"><span class="sq-m"><b dir="auto">${esc(f.name)}</b><small>${esc([f.co, f.day, f.type].filter(Boolean).join(' · '))}</small></span><span class="sq-t">PDF</span></button>`).join('');
    }
    body.innerHTML = h;
  }
  function remember(q) { q = q.trim(); if (!q) return; ls.set([q].concat(ls.get().filter(x => x !== q))); }
  function pickReq(i) {
    const it = cur[i]; if (!it) return;
    remember(inp.value); close();
    try { if (window.Shk && Shk.closeScreen && document.querySelector('#shkScreen.open')) Shk.closeScreen(); } catch (e) {}
    setTimeout(() => { try { openModal(it); } catch (e) { console.warn(e); } }, 80);
  }
  function pickFile(id) {
    remember(inp.value);
    // a pending request with the same number: open it (its IR files are shown inside); otherwise the file on Drive
    const f = (Shk.ir.peekIndex() || []).find(x => x.id === id);
    const key = f && (f.name.match(/(\d{4,})/) || [])[1];
    const it = key && (typeof allItems !== 'undefined' ? allItems : []).find(x => { try { return shortNum(x).replace(/^0+/, '') === key.replace(/^0+/, ''); } catch (e) { return false; } });
    if (it) { const k = cur.indexOf(it); if (k >= 0) return pickReq(k); close(); setTimeout(() => openModal(it), 80); return; }
    window.open('https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view', '_blank', 'noopener');
  }

  // ---------- the round button + keyboard ----------
  function fab() {
    if ($('sqFab')) return;
    const b = document.createElement('button'); b.id = 'sqFab'; b.type = 'button'; b.className = 'sq-fab'; b.setAttribute('aria-label', 'Search');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>';
    b.onclick = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} open(''); };
    document.body.appendChild(b);
  }
  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if ((e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      if (!window.PtahApp || !PtahApp.role || !PtahApp.role()) return;      // not signed in yet
      e.preventDefault(); open('');
    }
  });
  // show the button once the person is signed in
  (function wait(n) {
    try { if (window.PtahApp && PtahApp.role && PtahApp.role()) { fab(); return; } } catch (e) {}
    if (n < 600) setTimeout(() => wait(n + 1), 1000);
  })(0);

  (window.Shk = window.Shk || {}).search = { open, close };
})();
