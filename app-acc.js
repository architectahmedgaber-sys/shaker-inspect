/* Shaker Inspect · ACC upload (admins only).
   The admin picks the ACC "Submittal item summary" export (.xlsx). The app reads it on the phone and sends the rows
   to Acc.gs, which tells which report it is:
     - open requests only  -> added at the end of DailyAction (same rules as the update-daily-action skill)
     - has Closed requests -> the changed requests go to the Handover tracker, then the totals are checked
                              company by company (same rules as the update-villa-tracker-acc skill)
   Nothing is written before the admin presses Save on the preview. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (fn, args) => PtahApp.call(fn, args || []);
  const isAdmin = () => PtahApp.role() === 'Admin' || PtahApp.role() === 'DC';   // Admin or DC (document controller)
  const SIGN = '<p class="shk-sign">architected by Ptah</p>';
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const BATCH = 60;                         // requests per call to the tracker
  const WAIT_MS = 20000, WAIT_TRIES = 9;    // up to 3 minutes for the tracker's 1-minute check
  const fmtT = t => { const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const host = () => $('accBox');

  let lib = null;
  // the Excel reader is kept inside the app (vendor/); the CDN is only a fallback. Each try gives up after 20 s.
  function loadScript(src) {
    return new Promise((ok, bad) => {
      const s = document.createElement('script'); let done = false;
      const end = f => { if (done) return; done = true; clearTimeout(t); f(); };
      const t = setTimeout(() => end(() => { s.remove(); bad(new Error('timeout')); }), 20000);
      s.onload = () => end(ok); s.onerror = () => end(() => { s.remove(); bad(new Error('failed')); });
      s.src = src; document.head.appendChild(s);
    });
  }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return lib || (lib = loadScript('vendor/xlsx.full.min.js').catch(() => loadScript(XLSX_URL)).then(() => {
      if (!window.XLSX) throw new Error('x');
    }).catch(() => { lib = null; throw new Error('Could not load the Excel reader. Check the connection and try again.'); }));
  }

  // ---------------------------------------------------------------- reading the .xlsx on the phone
  const p2 = n => (n < 10 ? '0' : '') + n;
  /** Excel serial -> 'YYYY-MM-DD HH:MM:SS' (whole seconds, no time zone involved). */
  function serialText(v) {
    let days = Math.floor(v), secs = Math.round((v - days) * 86400);
    if (secs >= 86400) { days++; secs -= 86400; }
    const d = new Date(Date.UTC(1899, 11, 30) + days * 864e5);
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + ' ' +
      p2(Math.floor(secs / 3600)) + ':' + p2(Math.floor(secs / 60) % 60) + ':' + p2(secs % 60);
  }
  function cellOf(c) {
    if (!c || c.t === 'z') return null;
    if (c.t === 'n') return (c.z && XLSX.SSF.is_date(c.z)) ? { d: c.v, s: serialText(c.v) } : c.v;
    if (c.t === 'd') { const v = (c.v - Date.UTC(1899, 11, 30)) / 864e5; return { d: v, s: serialText(v) }; }
    if (c.t === 'b') return !!c.v;
    if (c.t === 'e') return c.w || '';
    return c.v == null ? null : String(c.v);
  }
  // the Excel reader leaves XML escapes in link addresses (&amp; for &)
  const unxml = s => String(s).replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (m, n, d, h) =>
    d ? String.fromCharCode(+d) : h ? String.fromCharCode(parseInt(h, 16)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n.toLowerCase()]);
  async function readFile(file) {
    await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellNF: true, cellDates: false, cellHTML: false, cellStyles: false });
    const ws = wb.Sheets['Data'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws['!ref']) throw new Error('The file has no data.');
    const R = XLSX.utils.decode_range(ws['!ref']);
    const head = [];
    for (let c = R.s.c; c <= R.e.c; c++) { const x = cellOf(ws[XLSX.utils.encode_cell({ r: R.s.r, c: c })]); head.push(x == null ? '' : String(x)); }
    while (head.length && !String(head[head.length - 1]).trim()) head.pop();
    const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
    const cNum = head.map(norm).indexOf('number'), cId = head.map(norm).indexOf('id');
    const rows = [], links = [];
    let noLink = 0;
    for (let r = R.s.r + 1; r <= R.e.r; r++) {
      const row = [];
      for (let c = 0; c < head.length; c++) row.push(cellOf(ws[XLSX.utils.encode_cell({ r: r, c: R.s.c + c })]));
      if (!row.some(v => v !== null && String(v.s || v).trim() !== '')) continue;
      const lk = i => { const x = i < 0 ? null : ws[XLSX.utils.encode_cell({ r: r, c: R.s.c + i })]; return x && x.l && x.l.Target ? unxml(x.l.Target) : ''; };
      const l = [lk(cNum), lk(cId)];
      if (!l[0]) noLink++;
      rows.push(row); links.push(l);
    }
    return { name: file.name, head: head, rows: rows, links: links, noLink: noLink };
  }

  // ---------------------------------------------------------------- the admin tab
  let rep = null, plan = null, busy = false;
  function admAcc() {
    const b = $('scBody'); if (!b) return;
    rep = null; plan = null; busy = false;     // opening the page always starts clean
    b.innerHTML = `<div id="accBox"></div>${SIGN}`;
    drawStart();
  }
  function drawStart(msg) {
    host().innerHTML = `
      <h3 class="sc-h">Upload an ACC report</h3>
      <div class="card">
        <p class="small" style="margin:0 0 8px">Choose the ACC export <b>Submittal item summary</b> (.xlsx). The app tells which report it is:</p>
        <p class="small" style="margin:0">• <b>Open requests only</b> → added at the end of <b>DailyAction</b>.<br>• <b>With Closed requests</b> (the full export) → updates the <b>Handover tracker</b>.</p>
        <p class="small" style="margin:8px 0 0">Nothing is written until you press Save on the preview.</p>
        <label class="btnrow acc-pick" style="display:block"><span class="b-ok" style="display:block;text-align:center;padding:14px;border-radius:12px;cursor:pointer;font-weight:700">Choose the file</span>
          <input type="file" id="accFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="position:absolute;width:1px;height:1px;opacity:0"></label>
        <div id="accDrop" class="small" style="margin-top:10px;padding:14px;border:2px dashed var(--line-strong,#999);border-radius:12px;text-align:center">or drop the .xlsx file here</div>
        <p class="small" style="margin:8px 0 0;opacity:.6">app build ${esc((window.SHK_VERSION || {}).build || '?')}</p>
        ${msg ? `<div class="acc-msg bad">${msg}</div>` : ''}
      </div>
      <div id="accLast"></div>`;
    const dz = $('accDrop');
    dz.ondragover = e => { e.preventDefault(); dz.style.background = 'rgba(255,198,26,.18)'; };
    dz.ondragleave = () => { dz.style.background = ''; };
    dz.ondrop = e => { e.preventDefault(); dz.style.background = ''; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) picked(f); };
    api('admin_accLast').then(drawLast).catch(() => {});
  }
  // one place for a chosen file; the change listener is on the document so a redraw of the page cannot lose it
  function picked(f) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return drawStart('This is not an Excel .xlsx file: ' + esc(f.name) + '. Export the Submittal item summary from ACC as Excel (.xlsx).');
    check(f);
  }
  document.addEventListener('change', e => {
    if (!e.target || e.target.id !== 'accFile') return;
    const f = e.target.files && e.target.files[0];
    try { e.target.value = ''; } catch (x) {}
    picked(f);
  });
  function drawLast(L) {
    const box = $('accLast'); if (!box || !L) return;
    box.innerHTML = `<h3 class="sc-h">Last upload to DailyAction</h3>
      <div class="card"><p class="small" style="margin:0"><b>${esc(L.file || 'report')}</b><br>${L.count} rows (rows ${L.first}-${L.first + L.count - 1}) · ${esc(L.by)} · ${fmtT(L.at)}</p>
      ${L.canUndo ? `<div class="btnrow"><button type="button" class="b-no" data-acc="undo">Take back this upload</button></div>`
                  : `<small class="hint">Cannot be taken back: ${esc(L.why)}</small>`}</div>`;
  }
  // a visible progress card: what is happening now, and how many seconds it has been running
  let stepText = '', stepT0 = 0, tick = null;
  function paintStep() {
    const s = $('accStep'); if (!s) { clearInterval(tick); tick = null; return; }
    const sec = Math.round((Date.now() - stepT0) / 1000);
    s.innerHTML = esc(stepText) + (sec >= 3 ? ' <small class="hint">(' + sec + ' s' + (sec >= 25 ? ' · still working, large files and slow signal take a while' : '') + ')</small>' : '');
  }
  const working = t => {
    host().innerHTML = `<div class="card acc-work"><div class="sc-load"><i></i><i></i><i></i></div><p class="small" id="accStep"></p></div>`;
    stepText = t; stepT0 = Date.now(); paintStep();
    if (!tick) tick = setInterval(paintStep, 1000);
    try { host().scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  };
  const step = t => { stepText = t; stepT0 = Date.now(); paintStep(); };

  async function check(file, opt) {
    if (busy) return; busy = true;
    try {
      const kb = Math.max(1, Math.round((file.size || 0) / 1024));
      working('Got ' + file.name + ' (' + kb + ' KB). Reading it...');
      if (!opt) rep = await readFile(file);
      step('Read ' + rep.rows.length + ' rows. Sending them to the server to check against the sheet...');
      plan = await api('admin_accCheck', [rep, opt || {}]);
      plan.kind === 'daily' ? drawDaily() : drawTracker();
    } catch (e) { drawStart(esc(e.message || e)); }
    busy = false;
  }

  // ---------------------------------------------------------------- DailyAction preview + save
  function drawDaily() {
    const p = plan, ok = !p.already;
    host().innerHTML = `
      <h3 class="sc-h">Preview · DailyAction</h3>
      <div class="card">
        <p class="small" style="margin:0"><b>${esc(p.file)}</b></p>
        <div class="kpis acc-k">
          <div class="kpi"><b>${p.rows}</b><span>rows</span></div>
          <div class="kpi ok"><b>${p.carried.length}</b><span>earlier action</span></div>
          <div class="kpi"><b>${p.pending}</b><span>pending</span></div>
        </div>
        ${ok ? `<p class="small">Goes to rows <b>${p.startRow}-${p.endRow}</b>, right after row ${p.lastOldRow}.</p>` : ''}
        <p class="small" style="margin:4px 0 0">Pending: ${p.newRequests} new · ${p.resubmissions} new revision${p.stillOpen ? ` · ${p.stillOpen} already listed, still without a code` : ''}.</p>
        ${p.sameOrder ? '' : '<div class="acc-msg">The columns in this export are in a different order. They were matched by name.</div>'}
        ${p.noLink ? `<div class="acc-msg">${p.noLink} rows have no ACC link on Number in the file. They are written as plain text.</div>` : ''}
        ${p.already ? `<div class="acc-msg bad">This report is already in DailyAction (rows ${p.already.from}-${p.already.to}). Did you mean today's export? Nothing will be written.</div>` : ''}
        <div class="btnrow">
          <button type="button" data-acc="again">Choose another file</button>
          ${ok ? `<button type="button" class="b-ok" data-acc="savedaily">Add ${p.rows} rows</button>` : ''}
        </div>
      </div>
      ${p.carried.length ? `<h3 class="sc-h">Earlier action carried over <span class="count">${p.carried.length}</span></h3>
        <div class="card-list">${p.carried.map(c => `<div class="row"><span class="mono small">${esc(c.num)} · Rev ${esc(c.rev)}</span><span class="small"><b class="vx-code c-${esc(c.code.charAt(0))}">${esc(c.code.charAt(0) || c.code)}</b> ${esc(c.by)} <em class="acc-from">row ${c.from}</em></span></div>`).join('')}</div>` : ''}`;
  }
  async function saveDaily(btn) {
    if (busy) return; busy = true; btn.disabled = true;
    working('Adding ' + plan.rows + ' rows to DailyAction...');
    try {
      const r = await api('admin_accSaveDaily', [rep, plan.startRow]);
      host().innerHTML = `
        <h3 class="sc-h">Done · DailyAction</h3>
        <div class="card acc-done">
          <p style="margin:0"><b>${r.rows} rows added</b> (rows ${r.startRow}-${r.endRow}).</p>
          <p class="small">${r.carried.length} got the earlier action${r.carried.length ? ': ' + r.carried.map(c => esc(c.num.replace(/^.*-(\d+)$/, '$1')) + ' Rev ' + esc(c.rev)).join(', ') : ''}.</p>
          <p class="small">${r.pending} pending (${r.newRequests} new, ${r.resubmissions} new revision${r.stillOpen ? ', ' + r.stillOpen + ' still without a code' : ''}).</p>
          <p class="small">Number and ID are links to ACC.${r.sameOrder ? '' : ' The column order was different and was matched by name.'}</p>
          <div class="btnrow"><button type="button" data-acc="again">Upload another</button><button type="button" class="b-ok" data-acc="reloadlist">Refresh requests</button></div>
        </div><div id="accLast"></div>`;
      api('admin_accLast').then(drawLast).catch(() => {});
    } catch (e) { drawStart(esc(e.message || e)); }
    busy = false;
  }
  async function undoDaily(btn) {
    if (!confirm('Remove the rows of the last upload from DailyAction?')) return;
    btn.disabled = true;
    try { window.showToast ? window.showToast(String(await api('admin_accUndoDaily')), null, null, 5000) : alert('Done'); drawStart(); }
    catch (e) { btn.disabled = false; alert(e.message || e); }
  }

  // ---------------------------------------------------------------- Handover tracker preview + send + check
  const totalsTable = (rows, cmp) => `<div class="acc-tbl"><table><tr><th>Company</th><th>Total</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Open</th></tr>${
    rows.map(r => { const o = cmp ? cmp.filter(x => x[0] === r[0])[0] : null;
      return `<tr><td>${esc(r[0])}</td>${r.slice(1).map((v, i) => `<td class="${o && Number(o[i + 1]) !== Number(v) ? 'diff' : ''}">${esc(v)}${o && Number(o[i + 1]) !== Number(v) ? `<small>${esc(o[i + 1])}</small>` : ''}</td>`).join('')}</tr>`; }).join('')}</table></div>`;
  function drawTracker() {
    const p = plan, ok = !p.stops.length;
    host().innerHTML = `
      <h3 class="sc-h">Preview · Handover tracker</h3>
      <div class="card">
        <p class="small" style="margin:0"><b>${esc(p.file)}</b><br>Full export (it has Closed requests): ${p.exportRows} requests, latest ACC update ${esc(p.latest)}. The tracker has data up to ${esc(p.asof || '—')}.</p>
        <div class="kpis acc-k">
          <div class="kpi"><b>${p.send.length}</b><span>changed</span></div>
          <div class="kpi ok"><b>${p.added}</b><span>new</span></div>
          <div class="kpi"><b>${p.updated}</b><span>updated</span></div>
        </div>
        <p class="small">Only the requests updated in ACC since ${esc(p.since || 'the start')} are sent. Then the totals in the tracker must equal the export, company by company.</p>
        ${p.sameOrder ? '' : '<div class="acc-msg">The columns in this export are in a different order. They were matched by name.</div>'}
        ${p.stops.map(s => `<div class="acc-msg bad">${esc(s)} Nothing will be sent.</div>`).join('')}
        <div class="btnrow">
          <button type="button" data-acc="again">Choose another file</button>
          ${ok ? `<button type="button" class="b-ok" data-acc="sendtracker">${p.send.length ? 'Send ' + p.send.length + ' requests' : 'Check the totals'}</button>` : ''}
        </div>
      </div>
      <h3 class="sc-h">Totals expected after the update</h3>${totalsTable(p.expected)}
      <small class="hint">Now in the tracker:</small>${totalsTable(p.current)}`;
  }
  async function push(rows, label) {
    let applied = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      step(`${label}: ${Math.min(i + BATCH, rows.length)} of ${rows.length}...`);
      await api('admin_accTrackerPush', [rows.slice(i, i + BATCH), plan.file]);
      applied += Math.min(BATCH, rows.length - i);
    }
    return applied;
  }
  const same = (a, b) => a.length === b.length && a.every(r => { const o = b.filter(x => x[0] === r[0])[0]; return o && r.every((v, i) => Number(v) === Number(o[i]) || (i === 0 && v === o[0])); });
  async function settle(from) {
    for (let t = 0; t <= WAIT_TRIES; t++) {
      const st = await api('admin_accTrackerState', [from]);
      if (!st.inboxRows) return st;
      if (t === WAIT_TRIES) return st;
      step(`The tracker is applying the rows (${st.inboxRows} waiting)...`);
      await sleep(WAIT_MS);
    }
  }
  async function sendTracker(btn) {
    if (busy) return; busy = true; btn.disabled = true;
    const from = plan.logRows, sent = { n: 0 }, rows = plan.send;
    working('Sending to the Handover tracker...');
    try {
      sent.n += await push(rows, 'Sending');
      step('Checking the totals...');
      let st = await settle(from);
      // rejected rows: send them once more
      const rejected = [].concat.apply([], (st.history || []).map(h => h.rejectedNumbers));
      const again = rejected.length ? rows.filter(r => rejected.indexOf(r[0]) >= 0) : [];
      let lastRej = [];
      if (again.length) {
        const before = (st.history || []).length;
        sent.n += await push(again, 'Sending the refused rows again'); st = await settle(from);
        lastRej = (st.history || []).slice(before).reduce((x, h) => x.concat(h.rejectedNumbers), []);
      }
      // totals differ with nothing refused: requests changed in ACC without a newer date -> send 60 more days once
      let second = false;
      if (!same(st.totals, plan.expected) && !lastRej.length && plan.since) {
        second = true;
        const d = new Date(plan.since + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 60);
        step('The totals differ. Sending 60 more days of changes...');
        const p2 = await api('admin_accCheck', [rep, { since: d.toISOString().slice(0, 10) }]);
        if (p2.send.length) { sent.n += await push(p2.send, 'Sending'); st = await settle(from); }
      }
      drawTrackerDone(st, sent.n, lastRej, second);
    } catch (e) { drawStart(esc(e.message || e)); }
    busy = false;
  }
  function drawTrackerDone(st, sentN, rejected, second) {
    const p = plan, okTotals = same(st.totals, p.expected), okDate = st.asof === p.latest, waiting = st.inboxRows;
    const h = st.history || [], got = h.reduce((a, x) => a + x.received, 0), add = h.reduce((a, x) => a + x.added, 0), upd = h.reduce((a, x) => a + x.updated, 0);
    const good = okTotals && okDate && !waiting && !rejected.length;
    host().innerHTML = `
      <h3 class="sc-h">${good ? 'Done' : 'Check needed'} · Handover tracker</h3>
      <div class="card ${good ? 'acc-done' : ''}">
        <p style="margin:0"><b>${good ? 'The tracker matches the export.' : 'The tracker does not match the export yet.'}</b></p>
        <p class="small">${sentN} requests sent · ${got} received by the tracker · ${add} new · ${upd} updated${second ? ' · 60 more days were sent once to find missing changes' : ''}.</p>
        <p class="small">Latest ACC update in the tracker: <b>${esc(st.asof || '—')}</b>${okDate ? '' : ` <em class="late">(the export says ${esc(p.latest)})</em>`}.</p>
        ${waiting ? `<div class="acc-msg bad">${waiting} rows are still waiting in CIR_Inbox: the tracker's automatic check is not running. In the tracker sheet use the menu Tracker &gt; Apply ACC update and check the data, then press Check again.</div>` : ''}
        ${rejected.length ? `<div class="acc-msg bad">Refused twice by the tracker, left out: ${rejected.map(esc).join(', ')}.</div>` : ''}
        ${!okTotals && !waiting ? `<div class="acc-msg bad">The totals differ (the export's figure is shown small under the tracker's). Do a full replace:<br>
          1. In ACC export the same report with no filter, all companies.<br>
          2. In the tracker sheet open the tab CIR_Data, then File &gt; Import &gt; Upload &gt; Replace current sheet, and untick "Convert text to numbers, dates, and formulas".<br>
          3. Menu Tracker &gt; Apply ACC update and check the data. Then upload the file here again to check.</div>` : ''}
        <div class="btnrow"><button type="button" data-acc="again">Upload another</button>${!good ? '<button type="button" data-acc="recheck">Check again</button>' : ''}</div>
      </div>
      <h3 class="sc-h">Totals in the tracker now</h3>${totalsTable(st.totals, p.expected)}
      ${good ? '<small class="hint">Press Reload in the Handover screen to see the new figures.</small>' : ''}`;
  }
  async function recheck(btn) {
    btn.disabled = true; working('Checking the totals...');
    try { drawTrackerDone(await api('admin_accTrackerState', [plan.logRows]), 0, [], false); } catch (e) { drawStart(esc(e.message || e)); }
  }

  // ---------------------------------------------------------------- events + entry points
  document.addEventListener('click', ev => {
    const a = ev.target.closest && ev.target.closest('[data-acc]'); if (!a) return;
    const k = a.dataset.acc;
    if (k === 'open') { if (window.closeModal && document.querySelector('.modal-overlay.open')) closeModal(); return Shk.openAdmin('acc'); }
    if (k === 'again') return admAcc();
    if (k === 'savedaily') return saveDaily(a);
    if (k === 'undo') return undoDaily(a);
    if (k === 'sendtracker') return sendTracker(a);
    if (k === 'recheck') return recheck(a);
    if (k === 'reloadlist') { Shk.closeScreen(); if (typeof window.fetchItems === 'function') try { fetchItems(); } catch (e) {} return; }
  });
  // home: a quick button for admins
  const baseRender = window.render;
  if (typeof baseRender === 'function') {
    window.render = function () {
      const r = baseRender.apply(this, arguments);
      try {
        const q = $('dxQuick');
        if (q && isAdmin() && !q.querySelector('[data-acc]')) q.insertAdjacentHTML('beforeend', '<button type="button" data-acc="open"><i>⬆</i>ACC upload</button>');
      } catch (e) { console.warn(e); }
      return r;
    };
  }
  Object.assign(window.Shk = window.Shk || {}, { admAcc: admAcc, accRead: readFile, accSerialText: serialText });
})();
