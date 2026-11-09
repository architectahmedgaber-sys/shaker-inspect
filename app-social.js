/* Shaker Inspect · people and conversations
   Username + profile photo, @mentions with autocomplete, Inbox, photo gallery with comments on each photo,
   Requests / search page, "Start here" card, quick action button. Needs api-6 on the server (Social.gs).
   Loaded after app-extras.js. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (fn, args) => PtahApp.call(fn, args || []);
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
               set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const note = (m, ms) => { try { window.showToast(m, null, null, ms || 3200); } catch (e) {} };
  const canClose = () => ['Admin', 'Engineer'].indexOf(PtahApp.role()) >= 0;
  const initials = n => String(n || '').split(/\s+/).filter(w => w && !/^(arch|eng)\.?$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
  const shortIr = ir => { const m = String(ir).match(/(\d+)\D*$/); return m ? 'CIR ' + m[1] : String(ir); };
  const hue = s => { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const tap = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} };
  const items = () => (typeof allItems !== 'undefined' && allItems) || [];

  // =====================================================================
  // people (username + photo), cached on the phone
  // =====================================================================
  let people = ls.get('shkPeople', []);
  let meP = ls.get('shkMeP', { username: '', avatar: '' });
  let unread = 0;
  const byEmail = e => people.find(p => p.email === String(e || '').toLowerCase());
  const byUser = u => people.find(p => p.username.toLowerCase() === String(u).toLowerCase());
  const myEmail = () => (PtahApp.email() || '').toLowerCase();

  function av(email, name, size) {
    const p = byEmail(email), nm = (p && p.name) || name || '';
    return `<span class="sx-av" style="--s:${size || 36}px;--h:${hue(email || nm)}">${p && p.avatar ? `<img src="${p.avatar}" alt="">` : esc(initials(nm))}</span>`;
  }
  // @name inside a text: gold chip when it is a real person
  function fmt(t) {
    return esc(t).replace(/@([a-zA-Z0-9_.]{3,20})/g, (m, u) => {
      const c = u.replace(/\.+$/, ''), p = byUser(c);
      return p ? `<span class="sx-m${p.email === myEmail() ? ' me' : ''}">@${esc(c)}</span>${esc(u.slice(c.length))}` : m;
    });
  }
  function ago(t) {
    const d = new Date(t), s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    if (s < 604800) return Math.floor(s / 86400) + ' d';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }
  function cmHtml(c, me) {
    const p = byEmail(c.email);
    return `<div class="sx-cm${c.email === (me || myEmail()) ? ' mine' : ''}">${av(c.email, c.engineer, 30)}<div class="sx-bub"><b>${esc(c.engineer)}${p ? ` <em>@${esc(p.username)}</em>` : ''}${c.role === 'Admin' ? ' <i>Admin</i>' : ''}</b><p dir="auto">${fmt(c.text)}</p><small>${esc(ago(c.t))}${c.rev ? ' · Rev ' + esc(c.rev) : ''}</small></div></div>`;
  }

  async function bootstrap() {
    if (!PtahApp.email()) return;
    try {
      const r = await api('social_bootstrap');
      people = r.people || []; meP = r.me || meP;
      ls.set('shkPeople', people); ls.set('shkMeP', meP);
      setUnread(r.unread || 0);
      paintMe(); render2();
    } catch (e) { console.warn('social', e); }
  }
  function setUnread(n) {
    n = +n || 0;
    if (n > unread && unread >= 0 && ready) note(`${n - unread} new in your Inbox`, 3500);
    unread = n;
    document.querySelectorAll('.sx-badge').forEach(b => { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
    try { navigator.setAppBadge && (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()); } catch (e) {}
    const ib = $('sxInboxRows'); if (ib && !n) ib.querySelectorAll('.unread').forEach(x => x.classList.remove('unread'));
  }
  let ready = false;
  async function pollUnread() {
    if (!PtahApp.email() || document.hidden) return;
    try { setUnread(await api('inbox_count')); } catch (e) {}
  }

  // =====================================================================
  // pages (iOS style: slide in from the right, big title)
  // =====================================================================
  let zTop = 1200;
  const pages = () => Array.from(document.querySelectorAll('.sx-page'));
  function page(title, o) {
    o = o || {};
    const el = document.createElement('div');
    el.className = 'sx-page' + (o.tab ? ' tab' : '');
    el.style.zIndex = o.tab ? 820 : ++zTop;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
    el.innerHTML = `<header class="sx-nav"><button type="button" class="sx-back${o.tab ? ' sx-desk' : ''}" data-sx="x" aria-label="Back">‹</button><b class="sx-t">${esc(o.small || title)}</b><span class="sx-right"></span></header>
      <main class="sx-body">${o.big === false ? '' : `<h1 class="sx-h1">${esc(title)}</h1>`}<div class="sx-in"></div></main>`;
    document.body.appendChild(el);
    if (o.tab) el.dataset.tab = o.tab;
    el.querySelector('.sx-body').addEventListener('scroll', e => el.classList.toggle('scrolled', e.target.scrollTop > 28), { passive: true });
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
    const close = () => { el.dataset.closing = '1'; el.classList.remove('open'); setTimeout(() => el.remove(), 260); setTimeout(paintTabs, 280); };
    el.querySelectorAll('[data-sx="x"]').forEach(b => b.addEventListener('click', close));
    return { el, body: el.querySelector('.sx-in'), main: el.querySelector('.sx-body'), right: el.querySelector('.sx-right'), close, nav: el.querySelector('.sx-nav') };
  }
  function closePages(keepTab) {
    pages().forEach(p => { if (keepTab && p === keepTab) return; p.classList.remove('open'); setTimeout(() => p.remove(), 240); });
  }

  // =====================================================================
  // tab bar (phone) and the tabs
  // =====================================================================
  function tab(name) {
    tap();
    closePages();
    if (window.Shk && Shk.closeAll) Shk.closeAll();
    document.body.dataset.sxTab = name === 'home' ? '' : name;
    if (name === 'home') { try { goHome(); } catch (e) {} window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (name === 'requests') openRequests();
    else if (name === 'villas') { Shk.openVillas(); }
    else if (name === 'inbox') openInbox();
    paintTabs();
  }
  function current() {
    const t = document.body.dataset.sxTab;
    if (t === 'requests' || t === 'inbox') return document.querySelector('.sx-page.tab:not([data-closing])') ? t : '';
    if (t === 'villas') return document.body.classList.contains('scr-open') ? 'villas' : '';
    return '';
  }
  function paintTabs() {
    const bar = $('tabBar'); if (!bar) return;
    let on = current();
    if (!on) { document.body.dataset.sxTab = ''; on = 'home'; }
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === on));
    document.body.classList.toggle('sx-has-page', !!document.querySelector('.sx-page.open'));
    const fab = $('sxFab'); if (fab) fab.hidden = !(on === 'home' && canClose() && document.body.classList.contains('at-home'));
  }

  // =====================================================================
  // @mention autocomplete
  // =====================================================================
  let menu = null;
  function hideMenu() { if (menu) { menu.remove(); menu = null; } }
  function mentionCheck(el) {
    const pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    const m = el.value.slice(0, pos).match(/(^|\s)@([a-zA-Z0-9_.]{0,20})$/);
    if (!m) return hideMenu();
    const q = m[2].toLowerCase();
    const list = people.filter(p => p.email !== myEmail() && (p.username.toLowerCase().indexOf(q) === 0 || (p.name || '').toLowerCase().split(/\s+/).some(w => w.indexOf(q) === 0))).slice(0, 5);
    if (!list.length) return hideMenu();
    hideMenu();
    menu = document.createElement('div'); menu.className = 'sx-menu'; menu.id = 'sxMenu';
    menu.innerHTML = list.map(p => `<button type="button" data-u="${esc(p.username)}">${av(p.email, p.name, 30)}<span><b>${esc(p.name)}</b><small>@${esc(p.username)}</small></span></button>`).join('');
    document.body.appendChild(menu);
    const r = el.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - 268)) + 'px';
    menu.style.bottom = (innerHeight - r.top + 8) + 'px';
    menu.addEventListener('mousedown', e => e.preventDefault());
    menu.addEventListener('click', e => {
      const b = e.target.closest('button[data-u]'); if (!b) return;
      const start = pos - m[2].length - 1;
      el.value = el.value.slice(0, start) + '@' + b.dataset.u + ' ' + el.value.slice(pos);
      const c = start + b.dataset.u.length + 2; el.focus(); try { el.setSelectionRange(c, c); } catch (x) {}
      hideMenu(); tap();
    });
  }
  document.addEventListener('input', e => { const el = e.target; if (el && el.matches && el.matches('[data-mention]')) mentionCheck(el); });
  document.addEventListener('focusout', e => { if (e.target && e.target.matches && e.target.matches('[data-mention]')) setTimeout(hideMenu, 150); });

  // =====================================================================
  // conversation page (a request or one photo)
  // =====================================================================
  function openThread(o) {
    const pg = page(o.title || shortIr(o.ir), { small: o.photo ? 'Photo' : shortIr(o.ir), big: false });
    pg.el.classList.add('thread');
    pg.body.innerHTML = `${o.photo ? '<div class="sx-photo" id="sxPhoto"><i class="sx-spin"></i></div>' : ''}
      <p class="sx-sub">${esc(o.sub || o.ir)}${o.rev ? ' · Rev ' + esc(o.rev) : ''}</p><div class="sx-cmlist" id="sxCmList"><div class="sx-empty">Loading...</div></div>`;
    const bar = document.createElement('div'); bar.className = 'sx-composer';
    bar.innerHTML = canClose()
      ? `<textarea rows="1" data-mention dir="auto" maxlength="1000" placeholder="Write a comment, @ to mention"></textarea><button type="button" class="sx-send" aria-label="Send">↑</button>`
      : '<span class="sx-empty">View only: you can read the comments.</span>';
    pg.el.appendChild(bar);
    const list = pg.body.querySelector('#sxCmList');
    const paint = rows => { list.innerHTML = rows.length ? rows.map(c => cmHtml(c)).join('') : '<div class="sx-empty">No comments yet. Be the first.</div>'; pg.main.scrollTop = pg.main.scrollHeight; };
    api('comments_list2', [o.ir, o.photo || '']).then(paint).catch(e => { list.innerHTML = `<div class="sx-empty">${esc(e.message)}</div>`; });
    if (o.photo) api('photo_get', [o.photo]).then(src => { const h = pg.body.querySelector('#sxPhoto'); if (h) h.innerHTML = `<img src="${src}" alt="">`; }).catch(e => { const h = pg.body.querySelector('#sxPhoto'); if (h) h.innerHTML = `<div class="sx-empty">${esc(e.message)}</div>`; });
    const ta = bar.querySelector('textarea'), send = bar.querySelector('.sx-send');
    if (ta) {
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(110, ta.scrollHeight) + 'px'; });
      send.onclick = async () => {
        const t = ta.value.trim(); if (!t) return;
        send.disabled = true;
        try { paint(await api('comments_add2', [o.ir, o.rev || '0', t, o.photo || ''])); ta.value = ''; ta.style.height = 'auto'; tap(); if (/@\w/.test(t)) ls.set('shkDoneMention', 1); startCard(); }
        catch (e) { note(e.message, 5000); } finally { send.disabled = false; }
      };
    }
    return pg;
  }

  // photos saved with a request
  function openPhotos(item) {
    const pg = page('Photos', { small: shortIr(item.irNumber), big: true });
    pg.body.innerHTML = '<div class="sx-grid"><i class="sx-sk"></i><i class="sx-sk"></i><i class="sx-sk"></i></div>';
    api('photos_list', [item.irNumber]).then(list => {
      if (!list.length) { pg.body.innerHTML = '<div class="sx-empty big">No photos were saved with this request yet.</div>'; return; }
      pg.body.innerHTML = `<p class="sx-sub">Tap a photo to see it full size and comment on it. Use @ to mention a colleague.</p><div class="sx-grid">${list.map(p => `<button type="button" class="sx-ph" data-id="${esc(p.id)}" data-rev="${esc(p.rev)}">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<i class="sx-sk"></i>'}<span>Rev ${esc(p.rev)} · ${p.n}</span>${p.comments ? `<b>💬 ${p.comments}</b>` : ''}</button>`).join('')}</div>`;
      pg.body.querySelectorAll('.sx-ph').forEach(b => b.onclick = () => openThread({ ir: item.irNumber, rev: b.dataset.rev, photo: b.dataset.id, title: 'Photo', sub: item.irNumber }));
    }).catch(e => { pg.body.innerHTML = `<div class="sx-empty big">${esc(e.message)}</div>`; });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#sxPhBtn'); if (!b) return;
    if (typeof currentItem !== 'undefined' && currentItem) openPhotos(currentItem);
  }, true);

  // =====================================================================
  // Inbox
  // =====================================================================
  function openInbox() {
    const pg = page('Inbox', { tab: 'inbox' });
    pg.right.innerHTML = '<button type="button" class="sx-link" id="sxReadAll">Read all</button>';
    pg.body.innerHTML = '<div class="sx-list" id="sxInboxRows"><div class="sx-row sk"><i></i></div><div class="sx-row sk"><i></i></div></div>';
    const draw = rows => {
      const box = pg.body.querySelector('#sxInboxRows');
      if (!rows.length) { box.outerHTML = '<div class="sx-empty big" id="sxInboxRows"><div class="sx-bell">🔔</div><b>Nothing here yet</b><br>When a colleague mentions you or answers a comment, you will see it here.</div>'; return; }
      box.innerHTML = rows.map(n => `<button type="button" class="sx-row${n.read ? '' : ' unread'}" data-id="${esc(n.id)}">${av(n.fromEmail, n.from, 42)}<span class="sx-rt"><b>${esc(n.from)} ${n.type === 'mention' ? 'mentioned you' : 'commented'}</b><small>${esc(shortIr(n.ir))}${n.photo ? ' · photo' : ''}</small><em dir="auto">${fmt(n.text)}</em></span><time>${esc(ago(n.t))}</time><i class="sx-dot"></i></button>`).join('');
      box.querySelectorAll('.sx-row').forEach((b, i) => b.onclick = () => openFromInbox(rows[i], b));
    };
    api('inbox_list').then(draw).catch(e => { pg.body.innerHTML = `<div class="sx-empty big">${esc(e.message)}</div>`; });
    pg.el.querySelector('#sxReadAll').onclick = () => api('inbox_read', ['all']).then(n => { setUnread(n); pg.body.querySelectorAll('.unread').forEach(x => x.classList.remove('unread')); }).catch(e => note(e.message));
  }
  function openFromInbox(n, row) {
    if (!n.read) { n.read = true; if (row) row.classList.remove('unread'); api('inbox_read', [[n.id]]).then(setUnread).catch(() => {}); }
    if (n.photo) return openThread({ ir: n.ir, rev: n.rev, photo: n.photo, title: 'Photo', sub: n.ir });
    const it = items().find(i => i.irNumber === n.ir);
    if (it && typeof openModal === 'function') { closePages(); document.body.dataset.sxTab = ''; paintTabs(); openModal(it); return; }
    openThread({ ir: n.ir, rev: n.rev, title: shortIr(n.ir), sub: n.ir });
  }

  // =====================================================================
  // Requests + search
  // =====================================================================
  function villaNum(it) { const m = String(villaOf(it)).match(/(\d+)/); return m ? m[1] : ''; }
  function openRequests(focus) {
    const pg = page('Requests', { tab: 'requests' });
    let f = 'all', q = '', con = '';
    pg.body.innerHTML = `<div class="sx-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><input type="search" id="sxQ" placeholder="Search requests, villas, people" autocomplete="off" enterkeyhint="search"></div>
      <div class="sx-chips" id="sxChips"></div><div id="sxRes"></div>`;
    const chipsEl = pg.body.querySelector('#sxChips'), res = pg.body.querySelector('#sxRes'), input = pg.body.querySelector('#sxQ');
    function draw() {
      const all = items(), late = all.filter(isLate).length, fresh = all.filter(i => i.ageDays === 0).length;
      const cons = {}; all.forEach(i => { const k = getProject(i); cons[k] = (cons[k] || 0) + 1; });
      chipsEl.innerHTML = [['all', 'All', all.length], ['late', 'Late', late], ['new', 'New today', fresh]].map(([k, l, n]) => `<button type="button" data-f="${k}" class="${f === k ? 'on' : ''}">${l}<i>${n}</i></button>`).join('')
        + Object.keys(cons).map(k => `<button type="button" data-c="${esc(k)}" class="${con === k ? 'on' : ''}">${esc(projectInfo(k).label)}<i>${cons[k]}</i></button>`).join('');
      let list = all.filter(i => (f === 'late' ? isLate(i) : f === 'new' ? i.ageDays === 0 : true) && (!con || getProject(i) === con));
      const ql = q.toLowerCase().trim();
      if (ql) list = list.filter(i => [i.irNumber, i.description, i.contractor, villaOf(i), activityOf(i), 'villa ' + villaNum(i)].join(' ').toLowerCase().indexOf(ql) >= 0);
      list.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
      let html = '';
      if (ql.length >= 2) {
        const ppl = people.filter(p => (p.name + ' ' + p.username).toLowerCase().indexOf(ql.replace(/^@/, '')) >= 0).slice(0, 4);
        if (ppl.length) html += `<h3 class="sx-sec">People</h3><div class="sx-list">${ppl.map(p => `<button type="button" class="sx-row" data-p="${esc(p.email)}">${av(p.email, p.name, 40)}<span class="sx-rt"><b>${esc(p.name)}</b><small>@${esc(p.username)} · ${esc(p.role)}</small></span><i class="sx-chev">›</i></button>`).join('')}</div>`;
        const vm = ql.match(/^(?:villa\s*)?(\d{1,4})$/);
        if (vm) html += `<h3 class="sx-sec">Villa</h3><div class="sx-list"><button type="button" class="sx-row" data-v="${esc(vm[1])}"><span class="sx-ic">🏘</span><span class="sx-rt"><b>Villa ${esc(vm[1])}</b><small>All requests and notes</small></span><i class="sx-chev">›</i></button></div>`;
      }
      const row = i => `<button type="button" class="c-row ${isLate(i) ? 'late' : ''}" data-r="${i.rowIndex}"><u></u><div><small><span>${esc(projectInfo(getProject(i)).label)} · ${esc(shortIr(i.irNumber))}</span><i class="c-tag ${isLate(i) ? 'bad' : ''}">${esc(ageText(i))}</i></small><b>${esc(villaOf(i))}</b><em>${esc(activityOf(i))} · Rev ${esc(i.rev || '0')}</em></div></button>`;
      const groups = [['Late', list.filter(isLate)], ['Today', list.filter(i => !isLate(i) && i.ageDays === 0)], ['Earlier', list.filter(i => !isLate(i) && i.ageDays !== 0)]];
      html += list.length ? groups.filter(g => g[1].length).map(g => `<div class="c-tl"><h3>${g[0]} · ${g[1].length}</h3>${g[1].slice(0, 150).map(row).join('')}</div>`).join('')
        : '<div class="sx-empty big"><div class="sx-bell">✅</div><b>Nothing here</b><br>No request matches.</div>';
      res.innerHTML = html;
    }
    pg.body.addEventListener('click', e => {
      const c = e.target.closest('[data-c]'), fl = e.target.closest('[data-f]');
      if (c) { con = con === c.dataset.c ? '' : c.dataset.c; tap(); return draw(); }
      if (fl) { f = fl.dataset.f; tap(); return draw(); }
      const r = e.target.closest('[data-r]'); if (r) { const it = items().find(i => String(i.rowIndex) === r.dataset.r); if (it) openModal(it); return; }
      const v = e.target.closest('[data-v]'); if (v && window.Shk && Shk.openVilla) { Shk.openVilla(v.dataset.v); return; }
      const p = e.target.closest('[data-p]'); if (p) openPerson(p.dataset.p);
    });
    input.addEventListener('input', () => { q = input.value; draw(); });
    draw();
    if (focus) setTimeout(() => input.focus(), 350);
    pg.redraw = draw; pg.el._pg = pg;
    return pg;
  }
  function render2() { const p = document.querySelector('.sx-page[data-tab="requests"]'); if (p && p._pg) p._pg.redraw(); }

  function openPerson(email) {
    const p = byEmail(email); if (!p) return;
    const pg = page(p.name, { small: 'Profile', big: false });
    pg.body.innerHTML = `<div class="sx-pcard">${av(p.email, p.name, 96)}<h2>${esc(p.name)}</h2><p>@${esc(p.username)} · ${esc(p.role)}</p>
      <button type="button" class="sx-btn" id="sxCopy">Copy @${esc(p.username)}</button></div>`;
    pg.body.querySelector('#sxCopy').onclick = () => { try { navigator.clipboard.writeText('@' + p.username); note('Copied. Paste it in a comment to mention ' + p.name.split(' ')[0] + '.'); } catch (e) { note('@' + p.username); } };
  }

  // =====================================================================
  // my profile: photo + username
  // =====================================================================
  function resizeAvatar(file) {
    return new Promise((ok, bad) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
        const k = Math.min(img.width, img.height), sx = (img.width - k) / 2, sy = (img.height - k) / 2;
        c.getContext('2d').drawImage(img, sx, sy, k, k, 0, 0, S, S);
        URL.revokeObjectURL(url);
        let q = 0.82, d = c.toDataURL('image/jpeg', q);
        while (d.length > 28000 && q > 0.3) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
        ok(d);
      };
      img.onerror = () => bad(new Error('This picture cannot be opened.'));
      img.src = url;
    });
  }
  function openProfile() {
    const pg = page('Profile', { small: 'Edit profile', big: false });
    let avatar = null;                      // null = unchanged, '' = removed, data URL = new
    const name = PtahApp.engineer();
    pg.body.innerHTML = `<div class="sx-pcard"><button type="button" class="sx-avbtn" id="sxAvBtn" aria-label="Change photo"><span id="sxAvBox"></span><i>📷</i></button>
      <h2>${esc(name)}</h2><p>${esc(PtahApp.email())}</p>
      <label class="sx-field"><span>Username</span><div class="sx-at"><b>@</b><input id="sxUser" maxlength="20" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(meP.username)}"></div><small id="sxUserHint">Your colleagues type @ and your username to mention you.</small></label>
      <button type="button" class="sx-btn primary" id="sxSave">Save</button>
      <button type="button" class="sx-btn ghost" id="sxRemove"${meP.avatar ? '' : ' hidden'}>Remove photo</button>
      <input type="file" id="sxFile" accept="image/*" hidden></div>`;
    const box = pg.body.querySelector('#sxAvBox');
    const paintAv = () => { const src = avatar === null ? meP.avatar : avatar; box.innerHTML = `<span class="sx-av" style="--s:104px;--h:${hue(myEmail())}">${src ? `<img src="${src}" alt="">` : esc(initials(name))}</span>`; pg.body.querySelector('#sxRemove').hidden = !src; };
    paintAv();
    pg.body.querySelector('#sxAvBtn').onclick = () => pg.body.querySelector('#sxFile').click();
    pg.body.querySelector('#sxFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { avatar = await resizeAvatar(f); paintAv(); } catch (x) { note(x.message); } };
    pg.body.querySelector('#sxRemove').onclick = () => { avatar = ''; paintAv(); };
    const hint = pg.body.querySelector('#sxUserHint'), inp = pg.body.querySelector('#sxUser');
    inp.addEventListener('input', () => { inp.value = inp.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''); hint.classList.toggle('bad', inp.value.length > 0 && inp.value.length < 3); });
    pg.body.querySelector('#sxSave').onclick = async function () {
      const u = inp.value.trim();
      if (!/^[a-z0-9_.]{3,20}$/.test(u)) { hint.textContent = '3 to 20 letters, numbers, dot or underscore.'; hint.classList.add('bad'); return; }
      this.disabled = true; this.textContent = 'Saving...';
      try {
        const r = await api('profile_set', [u === meP.username ? null : u, avatar]);
        meP = { username: r.username, avatar: r.avatar }; ls.set('shkMeP', meP);
        const p = byEmail(myEmail()); if (p) { p.username = r.username; p.avatar = r.avatar; ls.set('shkPeople', people); }
        paintMe(); startCard(); note('Saved.'); pg.close();
      } catch (e) { hint.textContent = e.message; hint.classList.add('bad'); this.disabled = false; this.textContent = 'Save'; }
    };
  }

  // looks: Me > Appearance
  const SKINS = [
    ['', 'Classic', 'Blue and gold, as it was', '#0b2a5b', '#1b4a9e', '#f5b800'],
    ['midnight', 'Midnight Glass', 'Dark, frosted cards, floating bar', '#050d20', '#1b4a9e', '#ffc61a'],
    ['ivory', 'Ivory Luxe', 'Warm white, serif titles, gold lines', '#f8f4ea', '#13203d', '#c99700'],
    ['onyx', 'Onyx Gold', 'True black with gold details', '#000000', '#2a2a2e', '#e6b422'],
    ['ocean', 'Ocean', 'Bold blue header, white cards', '#0b2a5b', '#ffffff', '#f5b800']
  ];
  function setSkin(k) {
    if (k) document.documentElement.setAttribute('data-skin', k); else document.documentElement.removeAttribute('data-skin');
    try { k ? localStorage.setItem('shkSkin', k) : localStorage.removeItem('shkSkin'); } catch (e) {}
  }
  function openAppearance() {
    const pg = page('Appearance', { small: 'Appearance' });
    const cur = document.documentElement.getAttribute('data-skin') || '';
    pg.body.innerHTML = `<p class="sx-sub">Pick the look you like. It changes only the colours and style, not how the app works. It is saved on this phone.</p>
      <div class="sx-skins">${SKINS.map(s => `<button type="button" class="sx-skin${s[0] === cur ? ' on' : ''}" data-k="${s[0]}"><i style="background:${s[3]};--c2:${s[4]};--c3:${s[5]}"></i><b>${esc(s[1])}</b><small>${esc(s[2])}</small></button>`).join('')}</div>`;
    pg.body.addEventListener('click', e => {
      const b = e.target.closest('.sx-skin'); if (!b) return;
      setSkin(b.dataset.k); tap();
      pg.body.querySelectorAll('.sx-skin').forEach(x => x.classList.toggle('on', x === b));
    });
  }

  // my photo in the account sheet and the home header
  function paintMe() {
    const box = $('acctAv');
    if (box) { box.innerHTML = meP.avatar ? `<img src="${meP.avatar}" alt="">` : esc(initials(PtahApp.engineer())); box.classList.toggle('has', !!meP.avatar); }
    const u = $('acctUser'); if (u) u.textContent = meP.username ? '@' + meP.username : '';
    document.querySelectorAll('.hero-av').forEach(b => { b.innerHTML = meP.avatar ? `<img src="${meP.avatar}" alt="">` : esc(initials(PtahApp.engineer())); b.classList.toggle('has', !!meP.avatar); });
    const ab = $('acctBtn'); if (ab && ab.querySelector('.ic') && meP.avatar) ab.querySelector('.ic').innerHTML = `<img class="sx-tiny" src="${meP.avatar}" alt="">`;
  }

  // =====================================================================
  // "Start here" card on Home + quick action
  // =====================================================================
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone || !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  function steps() {
    const s = [{ k: 'photo', t: 'Add your photo and @username', d: !!meP.avatar, go: openProfile }];
    if (canClose()) {
      s.push({ k: 'req', t: 'Open your first request', d: !!ls.get('shkDoneReq', 0), go: () => tab('requests') });
      s.push({ k: 'men', t: 'Mention a colleague with @', d: !!ls.get('shkDoneMention', 0), go: () => tab('requests') });
    }
    if (!standalone()) s.push({ k: 'inst', t: 'Add the app to your home screen', d: !!ls.get('shkDoneInstall', 0), go: () => { ls.set('shkDoneInstall', 1); PtahApp.openAccount(); } });
    return s;
  }
  function startCard() {
    let c = $('sxStart');
    const st = steps(), left = st.filter(x => !x.d).length;
    const home = document.body.classList.contains('at-home');
    if (ls.get('shkStartHide', 0) || !left || !PtahApp.email() || !home) { if (c) c.remove(); return; }
    const hero = $('heroBand'); if (!hero) return;
    if (!c) { c = document.createElement('section'); c.id = 'sxStart'; c.className = 'sx-start'; hero.parentNode.insertBefore(c, hero.nextSibling); }
    c.innerHTML = `<div class="sx-start-h"><b>Start here</b><span>${st.length - left} of ${st.length}</span><button type="button" data-x aria-label="Hide">×</button></div>
      <div class="sx-bar"><i style="width:${Math.round((st.length - left) / st.length * 100)}%"></i></div>
      ${st.map((x, i) => `<button type="button" class="sx-step${x.d ? ' done' : ''}" data-i="${i}"><span class="sx-tick">${x.d ? '✓' : ''}</span><span>${esc(x.t)}</span><i>›</i></button>`).join('')}`;
    c.onclick = e => {
      if (e.target.closest('[data-x]')) { ls.set('shkStartHide', 1); c.remove(); return; }
      const b = e.target.closest('[data-i]'); if (b) { const x = st[+b.dataset.i]; if (x && !x.d) x.go(); }
    };
  }

  // =====================================================================
  // hooks into the portal
  // =====================================================================
  function build() {
    if (!$('sxFab')) {
      const f = document.createElement('button'); f.type = 'button'; f.id = 'sxFab'; f.className = 'sx-fab'; f.hidden = true;
      f.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>Close a request</span>';
      f.onclick = () => { tap(); closePages(); document.body.dataset.sxTab = 'requests'; openRequests(true); paintTabs(); };
      document.body.appendChild(f);
    }
  }
  const baseRender = window.render;
  window.render = function () {
    const r = baseRender.apply(this, arguments);
    try {
      const hh = document.querySelector('.hero-hi');
      if (hh && !hh.querySelector('.hero-bell')) {
        const bell = document.createElement('button'); bell.type = 'button'; bell.className = 'hero-bell'; bell.setAttribute('aria-label', 'Inbox');
        bell.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg><b class="sx-badge" hidden></b>';
        bell.onclick = () => tab('inbox');
        hh.insertBefore(bell, hh.lastElementChild);
        setUnread(unread);
      }
      paintMe(); startCard(); paintTabs();
    } catch (e) { console.warn('social render', e); }
    return r;
  };
  const baseOpen = window.openModal;
  window.openModal = function (item) { try { ls.set('shkDoneReq', 1); } catch (e) {} return baseOpen.apply(this, arguments); };
  const baseAcct = PtahApp.openAccount;
  PtahApp.openAccount = function () { try { paintMe(); } catch (e) {} return baseAcct.apply(this, arguments); };

  new MutationObserver(() => paintTabs()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollUnread(); });
  setInterval(pollUnread, 60000);

  window.Shk = window.Shk || {};
  Shk.sx = { cmHtml, fmt, av, tab, openInbox, openRequests, openProfile, openAppearance, setSkin, openThread, openPhotos, paintTabs, people: () => people,
             setUnread, bootstrap, page, closePages };
  document.addEventListener('DOMContentLoaded', () => { build(); setTimeout(() => { bootstrap().then(() => { ready = true; }); startCard(); paintMe(); }, 900); });
  if (document.readyState !== 'loading') { build(); setTimeout(() => { bootstrap().then(() => { ready = true; }); startCard(); paintMe(); }, 900); }
  // after sign-in
  const baseAfter = window.Shk && Shk.afterSignIn;
  Shk.afterSignIn = function () { if (baseAfter) baseAfter.apply(this, arguments); setTimeout(() => { bootstrap().then(() => { ready = true; }); }, 700); };
  window.addEventListener('hashchange', () => { if (location.hash === '#inbox') { tab('inbox'); } });
  if (location.hash === '#inbox') setTimeout(() => tab('inbox'), 1200);
})();
