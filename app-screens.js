/* Shaker Inspect: full-screen pages (Admin, Sheets), first-run guide, contact the developer. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (fn, args) => PtahApp.call(fn, args || []);
  const SIGN = '<p class="shk-sign">architected by Ptah</p>';
  const fmtT = t => { const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const toast = m => { const t = $('toast'), x = $('toastMsg'); if (!t) return alert(m); x.textContent = m; $('toastBtn').style.display = 'none'; t.classList.add('show'); setTimeout(() => { t.classList.remove('show'); $('toastBtn').style.display = ''; }, 2600); };

  function frame(title, tabsHtml, bodyHtml) {
    const s = $('shkScreen');
    s.innerHTML = `<header class="sc-head"><button type="button" class="sc-back" data-act="close" aria-label="Back">‹</button><h2>${esc(title)}</h2><button type="button" class="sc-back" data-act="reload" aria-label="Refresh">⟳</button></header>` +
      (tabsHtml ? `<nav class="sc-tabs" id="scTabs">${tabsHtml}</nav>` : '') + `<main class="sc-body" id="scBody">${bodyHtml || ''}</main>`;
    s.classList.add('open'); document.body.classList.add('scr-open'); document.body.classList.toggle('scr-sheet', mode === 'sheets');
  }
  function closeScreen() { $('shkScreen').classList.remove('open'); $('shkScreen').innerHTML = ''; document.body.classList.remove('scr-open', 'scr-sheet'); }
  const body = () => $('scBody');
  const loading = () => { body().innerHTML = '<div class="sc-load"><i></i><i></i><i></i></div>'; };
  const fail = e => { body().innerHTML = `<div class="sc-empty">${esc(e.message || e)}</div>`; };

  // ================= ADMIN =================
  let adminTab = 'today', logQ = '', mode = 'admin';
  const ADMIN_TABS = [['today', 'Today'], ['users', 'Users'], ['perf', 'Performance'], ['closes', 'Undo'], ['trash', 'Trash'], ['log', 'Log'], ['settings', 'Settings']];

  function openAdmin() {
    if (PtahApp.role() !== 'Admin') return;
    mode = 'admin'; closeHandover();
    frame('Admin', ADMIN_TABS.map(([k, l]) => `<button type="button" data-tab="${k}">${l}</button>`).join(''));
    gotoTab(adminTab);
  }
  function gotoTab(k) {
    adminTab = k;
    document.querySelectorAll('#scTabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === k); if (b.dataset.tab === k) b.scrollIntoView({ inline: 'center', block: 'nearest' }); });
    loading();
    ({ today: tToday, users: tUsers, perf: tPerf, log: tLog, settings: tSettings, closes: () => Shk.admCloses(), trash: () => Shk.admTrash() })[k]();
  }

  function tToday() {
    api('admin_overview').then(o => {
      body().innerHTML = `
        <div class="kpis"><div class="kpi"><b>${o.open}</b><span>Open</span></div><div class="kpi ${o.late ? 'bad' : ''}"><b>${o.late}</b><span>Late</span></div><div class="kpi ok"><b>${o.closedToday}</b><span>Closed today</span></div></div>
        <h3 class="sc-h">By contractor</h3>
        <div class="card-list">${o.contractors.length ? o.contractors.map(c => `<div class="row"><span>${esc(c.name)}</span><span class="mono">${c.late ? `<em class="late">${c.late} late</em> · ` : ''}${c.open} open</span></div>`).join('') : '<div class="sc-empty">No open requests.</div>'}</div>
        <h3 class="sc-h">Closed today, per engineer</h3>
        <div class="card-list">${o.perEngineer.length ? o.perEngineer.map(c => `<div class="row"><span>${esc(c.engineer)}</span><b class="mono">${c.n}</b></div>`).join('') : '<div class="sc-empty">Nothing closed yet today.</div>'}</div>
        <h3 class="sc-h">Oldest late requests</h3>
        <div class="card-list">${o.lateItems.length ? o.lateItems.map(i => `<div class="row col"><b class="mono">${esc(i.ir)} · Rev ${esc(i.rev)}</b><span>${esc(i.text)}</span><small>${esc(i.contractor)}${i.age != null ? ' · waiting ' + i.age + ' days' : ''}</small></div>`).join('') : '<div class="sc-empty">No late requests.</div>'}</div>
        <h3 class="sc-h">Latest closes</h3>
        <div class="card-list">${o.latest.length ? o.latest.map(l => `<div class="row col"><b>${esc(l.engineer)}</b><span class="mono small">${esc(l.detail)}</span><small>${fmtT(l.t)}</small></div>`).join('') : '<div class="sc-empty">No closes recorded yet.</div>'}</div>${SIGN}`;
    }).catch(fail);
  }

  function tUsers() {
    api('admin_users').then(rows => {
      const pend = rows.filter(u => u.status === 'pending');
      const others = rows.filter(u => u.status !== 'pending');
      const roleSel = (id, cur) => `<select id="${id}" class="sc-in">${['Engineer', 'Viewer', 'Admin'].map(r => `<option${r === cur ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
      body().innerHTML = `
        <h3 class="sc-h">Waiting for approval ${pend.length ? `<span class="count">${pend.length}</span>` : ''}</h3>
        ${pend.length ? pend.map((u, i) => `<div class="card pend" data-email="${esc(u.email)}">
          <b>${esc(u.engineer)}</b><small>${esc(u.email)} · ${esc(u.requested)}</small>
          <p class="msg">${esc(u.message)}</p>
          <div class="grid2"><label>Name in the sheet<input class="sc-in" id="pn${i}" value="${esc(u.engineer)}"></label><label>Role${roleSel('pr' + i, 'Engineer')}</label></div>
          <div class="btnrow"><button type="button" class="b-ok" data-act="approve" data-i="${i}">Approve</button><button type="button" class="b-no" data-act="reject">Reject</button></div></div>`).join('')
          : '<div class="sc-empty">No requests waiting.</div>'}
        <h3 class="sc-h">People</h3>
        <div class="card-list">${others.map(u => `<div class="urow" data-email="${esc(u.email)}">
          <div class="ut"><b>${esc(u.engineer || '(no name)')}</b><small>${u.email ? esc(u.email) : 'no email yet: waiting to be linked'}</small>
            <small>${u.last ? 'Last sign-in ' + fmtT(u.last) : ''}</small></div>
          <div class="ua">${u.email ? `<span class="role-badge r-${esc(u.role).toLowerCase()}">${esc(u.role)}</span><span class="st st-${esc(u.status)}">${esc(u.status)}</span>
          <button type="button" class="mini" data-act="manage">⋯</button>` : ''}</div></div>`).join('')}</div>
        <h3 class="sc-h">Add a person</h3>
        <div class="card"><div class="grid2"><label>Email<input class="sc-in" id="auEmail" type="email" placeholder="name@gmail.com"></label><label>Full name (same as the sheet tab)<input class="sc-in" id="auName"></label></div>
          <label>Role${roleSel('auRole', 'Engineer')}</label><div class="btnrow"><button type="button" class="b-ok" data-act="adduser">Add</button></div>
          <small class="hint">Use this for the current engineers so their old tabs are linked before sign-up opens.</small></div>${SIGN}`;
      body().dataset.users = JSON.stringify(rows);
      if (Shk.admUsersExtra) Shk.admUsersExtra(rows);
    }).catch(fail);
  }

  function manageUser(email) {
    const rows = JSON.parse(body().dataset.users || '[]'), u = rows.filter(r => r.email === email)[0]; if (!u) return;
    const m = document.createElement('div'); m.className = 'acct-overlay open'; m.id = 'manageSheet';
    m.innerHTML = `<div class="acct-box"><b style="font-size:18px">${esc(u.engineer)}</b><small style="display:block;color:var(--muted);word-break:break-all">${esc(u.email)}</small>
      <label class="lab">Role<select id="mgRole" class="sc-in">${['Engineer', 'Viewer', 'Admin'].map(r => `<option${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
      <div class="acct-list" style="margin-top:12px">
        <button type="button" data-mg="role"><span>Save role</span><i>›</i></button>
        <button type="button" data-mg="${u.status === 'blocked' ? 'on' : 'off'}"><span>${u.status === 'blocked' ? 'Turn the account back on' : 'Turn the account off'}</span><i>›</i></button>
        <button type="button" data-mg="signout"><span>Sign out of all devices</span><i>›</i></button>
      </div><div class="acct-actions"><button type="button" class="acct-close" data-mg="x">Close</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', ev => {
      const b = ev.target.closest('[data-mg]');
      if (ev.target === m || (b && b.dataset.mg === 'x')) return m.remove();
      if (!b) return;
      const k = b.dataset.mg;
      const run = k === 'role' ? api('admin_setUser', [email, { role: $('mgRole').value }])
        : k === 'off' ? api('admin_setUser', [email, { active: 'No' }])
        : k === 'on' ? api('admin_setUser', [email, { active: 'Yes' }])
        : api('admin_signOutUser', [email]);
      run.then(() => { m.remove(); toast('Done'); tUsers(); }).catch(e => toast(e.message));
    });
  }

  function tPerf(days) {
    days = days || 30;
    api('admin_perf', [days]).then(o => {
      const max = Math.max(1, ...o.series.map(s => s.n));
      const bars = o.series.map(s => `<i title="${s.d}: ${s.n}" style="height:${Math.round(s.n / max * 100)}%"></i>`).join('');
      body().innerHTML = `
        <div class="seg2"><button type="button" class="${days === 7 ? 'on' : ''}" data-days="7">7 days</button><button type="button" class="${days === 30 ? 'on' : ''}" data-days="30">30 days</button><button type="button" class="${days === 90 ? 'on' : ''}" data-days="90">90 days</button></div>
        <div class="kpis"><div class="kpi"><b>${o.total}</b><span>Closed</span></div><div class="kpi"><b>${o.engineers.length}</b><span>Engineers</span></div><div class="kpi"><b>${(o.total / o.days).toFixed(1)}</b><span>Per day</span></div></div>
        <h3 class="sc-h">Closed per day</h3><div class="bars">${bars}</div>
        <h3 class="sc-h">Per engineer</h3>
        <div class="card-list">${o.engineers.length ? o.engineers.map(e => {
          const t = e.n || 1;
          return `<div class="row col"><div class="rowtop"><b>${esc(e.engineer)}</b><b class="mono">${e.n}</b></div>
            <div class="split"><i class="a" style="width:${e.A / t * 100}%"></i><i class="b" style="width:${e.B / t * 100}%"></i><i class="c" style="width:${e.C / t * 100}%"></i><i class="d" style="width:${e.D / t * 100}%"></i></div>
            <small>A ${e.A} · B ${e.B} · C ${e.C} · D ${e.D}</small></div>`;
        }).join('') : '<div class="sc-empty">No closes recorded in this period yet.</div>'}</div>
        <small class="hint">Engineer counts come from the closes made through the app.</small>${SIGN}`;
      if (Shk.admPerfExtra) Shk.admPerfExtra(days, o);
    }).catch(fail);
  }

  function tLog() {
    api('admin_log', [logQ, 200]).then(o => {
      body().innerHTML = `
        ${o.alerts.length ? `<h3 class="sc-h">Watch list</h3><div class="card-list">${o.alerts.slice(0, 6).map(l => `<div class="row col warn"><b>${esc(l.action)} · ${esc(l.engineer || l.email)}</b><span class="small">${esc(l.detail)}</span><small>${fmtT(l.t)}</small></div>`).join('')}</div>` : ''}
        <input id="logQ" class="sc-in" type="search" placeholder="Search the log (name, action, request number...)" value="${esc(logQ)}">
        <div class="card-list">${o.rows.map(l => `<div class="row col"><div class="rowtop"><b>${esc(l.action)}</b><small>${fmtT(l.t)}</small></div><span>${esc(l.engineer || l.email)}</span><span class="small mono">${esc(l.detail)}</span></div>`).join('') || '<div class="sc-empty">Nothing found.</div>'}</div>
        <div class="btnrow"><button type="button" class="b-line" data-act="csv">Download as CSV</button></div>${SIGN}`;
      body().dataset.log = JSON.stringify(o.rows);
      if (Shk.admLogExtra) Shk.admLogExtra(o.rows);
      const q = $('logQ'); let tm; q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { logQ = q.value.trim(); loading(); tLog(); }, 450); });
    }).catch(fail);
  }
  function downloadCsv() {
    const rows = JSON.parse(body().dataset.log || '[]');
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = '﻿Time,Email,Engineer,Action,Detail\n' + rows.map(r => [r.t, r.email, r.engineer, r.action, r.detail].map(q).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'shaker-inspect-log.csv'; a.click();
  }

  function tSettings() {
    api('admin_settings').then(o => {
      body().innerHTML = `
        <div class="card-list links">
          <a class="lk" href="${esc(o.sheetUrl)}" target="_blank" rel="noopener"><span>Open the inspection sheet</span><i>↗</i></a>
          ${o.pdfFolderUrl ? `<a class="lk" href="${esc(o.pdfFolderUrl)}" target="_blank" rel="noopener"><span>Open the inspection records folder</span><i>↗</i></a>` : ''}
          <button type="button" class="lk" data-act="checklists"><span>Edit checklists</span><i>›</i></button>
          <a class="lk" href="tracker.html"><span>Handover tracker ${o.trackerLinked ? '<em class="okk">connected</em>' : '<em class="late">not connected yet</em>'}</span><i>›</i></a>
        </div>
        <small class="hint">Roles: <b>Admin</b> does everything. <b>Engineer</b> closes requests under their own name. <b>Viewer</b> only looks. Handover edits are for admins only.</small>${SIGN}`;
      if (Shk.admSettingsExtra) Shk.admSettingsExtra();
    }).catch(fail);
  }

  // ================= SHEETS (view only) =================
  let sheetName = '', sheetCache = {};
  function openSheets() {
    closeHandover();
    mode = 'sheets';
    frame('Sheet (view only)', '', '<div class="sc-load"><i></i><i></i><i></i></div>');
    api('sheet_tabs').then(tabs => {
      if (!tabs.length) return fail('No tabs.');
      sheetName = tabs.some(t => t.name === sheetName) ? sheetName : (tabs.filter(t => t.name === 'DailyAction')[0] || tabs[0]).name;
      $('shkScreen').querySelector('.sc-head').insertAdjacentHTML('afterend', `<nav class="sc-tabs" id="scTabs">${tabs.map(t => `<button type="button" data-sheet="${esc(t.name)}" class="${t.name === sheetName ? 'on' : ''}">${esc(t.name)}<small>${t.rows}</small></button>`).join('')}</nav>`);
      loadSheet(sheetName);
    }).catch(fail);
  }
  function loadSheet(name, force) {
    sheetName = name;
    document.querySelectorAll('#scTabs button').forEach(b => b.classList.toggle('on', b.dataset.sheet === name));
    if (!force && sheetCache[name]) return drawSheet(sheetCache[name]);
    loading();
    api('sheet_read', [name, 200]).then(d => { sheetCache[name] = d; drawSheet(d); }).catch(fail);
  }
  function drawSheet(d) {
    body().innerHTML = `<input id="shQ" class="sc-in" type="search" placeholder="Filter rows...">
      <small class="hint">Newest rows first · showing ${d.rows.length} of ${d.total} · view only · server ${d.v || "OLD Api.gs - redeploy"}</small>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>${d.header.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody id="shBody">${d.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${SIGN}`;
    if (Shk.sheetExtra) Shk.sheetExtra(sheetName, d);
    $('shQ').addEventListener('input', e => { const q = e.target.value.toLowerCase(); document.querySelectorAll('#shBody tr').forEach(tr => { tr.hidden = q && tr.textContent.toLowerCase().indexOf(q) < 0; }); });
  }

  // ================= HANDOVER (inside the app, tab bar stays) =================
  function openHandover() {
    closeScreen();
    let w = $('hoWrap');
    if (!w) {
      w = document.createElement('div'); w.id = 'hoWrap'; w.className = 'ho-wrap';
      w.innerHTML = '<iframe id="hoFrame" title="Handover tracker" src="tracker.html?embed=1"></iframe>';
      document.body.appendChild(w);
    }
    w.classList.add('open'); document.body.classList.add('scr-ho');
    if (window.Shk && Shk.tabsRefresh) Shk.tabsRefresh();
  }
  function closeHandover() { const w = $('hoWrap'); if (w) w.classList.remove('open'); document.body.classList.remove('scr-ho'); }
  function closeAll() { closeScreen(); closeHandover(); }

  // ================= CONTACT =================
  function openContact() {
    const who = PtahApp.engineer() || '';
    const text = 'Hello Ahmed, this is ' + who + ' from Shaker Inspect. ';
    $('contactWa').href = 'https://wa.me/201018484400?text=' + encodeURIComponent(text);
    $('contactMail').href = 'mailto:architectahmedgaber@gmail.com?subject=' + encodeURIComponent('Shaker Inspect') + '&body=' + encodeURIComponent(text + '\n\n');
    $('contactOverlay').classList.add('open');
  }

  // ================= FIRST-RUN GUIDE =================
  function slides() {
    const view = PtahApp.role() === 'Viewer';
    return [
      { ic: '✉️', t: 'Sign in with your email', p: 'Type your email and the 6-digit code we send you. You stay signed in for 30 days on this phone.' },
      view ? { ic: '👁️', t: 'Look around, view only', p: 'See the requests, the sheet tabs and the Handover tracker. Closing requests is for engineers.' }
           : { ic: '✅', t: 'Close a request in 3 taps', p: 'Open the request, pick the code (A, B, C or D), tick the checklist and press Close. It is saved under your own name.' },
      { ic: '💬', t: 'Need help?', p: 'Open Me, then "Contact the developer". You can reach Ahmed on WhatsApp or email.' }
    ];
  }
  let step = 0;
  function openTour() { step = 0; $('tourOverlay').classList.add('open'); drawTour(); }
  function drawTour() {
    const s = slides(), x = s[step], last = step === s.length - 1;
    $('tourBox').innerHTML = `<div class="tour-ic">${x.ic}</div><h3>${esc(x.t)}</h3><p>${esc(x.p)}</p>
      <div class="dots">${s.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" class="login-btn" id="tourNext">${last ? 'Start' : 'Next'}</button>
      ${last ? '' : '<button type="button" class="tour-skip" id="tourSkip">Skip</button>'}${SIGN}`;
    $('tourNext').onclick = () => { if (last) endTour(); else { step++; drawTour(); } };
    const sk = $('tourSkip'); if (sk) sk.onclick = endTour;
  }
  function endTour() { $('tourOverlay').classList.remove('open'); try { localStorage.setItem('shkTourDone', '1'); } catch (e) {} }
  function afterSignIn() { let done = ''; try { done = localStorage.getItem('shkTourDone'); } catch (e) {} if (!done) setTimeout(openTour, 600); }

  // ================= events =================
  document.addEventListener('click', ev => {
    const sc = $('shkScreen');
    if (sc && sc.contains(ev.target)) {
      const tab = ev.target.closest('[data-tab]'); if (tab) return gotoTab(tab.dataset.tab);
      const sh = ev.target.closest('[data-sheet]'); if (sh) return loadSheet(sh.dataset.sheet);
      const dd = ev.target.closest('[data-days]'); if (dd) { loading(); return tPerf(+dd.dataset.days); }
      const a = ev.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act, card = a.closest('[data-email]');
      if (act === 'close') return closeScreen();
      if (act === 'reload') { if (mode === 'sheets') { delete sheetCache[sheetName]; return loadSheet(sheetName, true); } return gotoTab(adminTab); }
      if (act === 'csv') return downloadCsv();
      if (act === 'checklists') { closeScreen(); return edOpen(); }
      if (act === 'manage') return manageUser(a.closest('[data-email]').dataset.email);
      if (act === 'approve') {
        const i = a.dataset.i; a.disabled = true;
        return api('admin_decide', [card.dataset.email, 'approve', $('pr' + i).value, $('pn' + i).value.trim()])
          .then(() => { toast('Approved. An email was sent.'); tUsers(); }).catch(e => { a.disabled = false; toast(e.message); });
      }
      if (act === 'reject') {
        if (!confirm('Reject this request? They cannot ask again for 7 days.')) return;
        return api('admin_decide', [card.dataset.email, 'reject']).then(() => { toast('Rejected'); tUsers(); }).catch(e => toast(e.message));
      }
      if (act === 'adduser') {
        return api('admin_addUser', [$('auEmail').value, $('auName').value, $('auRole').value])
          .then(() => { toast('Added'); tUsers(); }).catch(e => toast(e.message));
      }
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const sc = $('shkScreen'); if (sc && sc.classList.contains('open')) closeScreen(); } });

  Object.assign(window.Shk = window.Shk || {}, { openAdmin, openSheets, openContact, openTour, afterSignIn, closeScreen, openHandover, closeHandover, closeAll });
})();
