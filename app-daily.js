/* Shaker Inspect · phase 2 (daily work)
   Offline queue, photos, voice notes, finger signature, weather, WhatsApp send, comments,
   re-inspection, calendar, daily report, reminders, fingerprint lock.
   Loaded after the portal script, app-ui.js and app-screens.js. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (fn, args) => PtahApp.call(fn, args || []);
  const CFG = window.SHK_CONFIG || {};
  const SITE = { lat: CFG.SITE_LAT || 30.95, lon: CFG.SITE_LON || 28.6 };   // SouthMED, North Coast (weather)
  const NATIVE = !!(window.Capacitor && Capacitor.nativePromise && Capacitor.getPlatform && Capacitor.getPlatform() !== 'web');
  const nativeP = (plugin, method, opt) => Capacitor.nativePromise(plugin, method, opt || {});
  const canClose = () => ['Admin', 'Engineer'].indexOf(PtahApp.role()) >= 0;
  const keyOf = it => `${it.irNumber}__${it.itemId}__${it.rev || '0'}`;
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
               set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };
  const note = (m, ms) => window.showToast(m, null, null, ms || 3500);
  const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dmy = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || ''); };
  const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = () => isoOf(new Date());
  function b64bytes(s) { const t = atob(String(s).replace(/^data:[^,]*,/, '')), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
  function openExternal(url) { const w = window.open(url, '_blank'); if (!w) location.href = url; }

  // =====================================================================
  // 1. OFFLINE QUEUE (IndexedDB on the phone)
  // =====================================================================
  const DB = (() => {
    let p = null;
    const open = () => p || (p = new Promise((ok, bad) => {
      const r = indexedDB.open('shk', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id' });
      r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
    }));
    const tx = (mode, fn) => open().then(db => new Promise((ok, bad) => {
      const t = db.transaction('queue', mode), r = fn(t.objectStore('queue'));
      t.oncomplete = () => ok(r && r.result); t.onerror = () => bad(t.error); t.onabort = () => bad(t.error);
    }));
    return { all: () => tx('readonly', s => s.getAll()), put: v => tx('readwrite', s => s.put(v)), del: id => tx('readwrite', s => s.delete(id)) };
  })();
  let queue = [];                     // closes waiting to upload
  let running = false;
  const queuedKeys = () => new Set(queue.map(j => j.key));
  const savable = j => { const c = Object.assign({}, j); delete c.pdfB64; return c; };

  async function queueLoad() { try { queue = (await DB.all()) || []; } catch (e) { queue = ls.get('shkQueue', []); } paintPending(); }
  async function queueSave(job) { try { await DB.put(savable(job)); } catch (e) { const all = ls.get('shkQueue', []).filter(x => x.id !== job.id); all.push(savable(job)); if (!ls.set('shkQueue', all)) throw new Error('The phone storage is full. Delete some photos and try again.'); } }
  async function queueDel(id) { queue = queue.filter(j => j.id !== id); try { await DB.del(id); } catch (e) {} ls.set('shkQueue', ls.get('shkQueue', []).filter(x => x.id !== id)); paintPending(); }

  async function queueAdd(job, live) {
    job.queued = true; job.error = '';
    try { await queueSave(job); } catch (e) { return failLive(e.message); }
    queue.push(job);
    paintPending();
    if (live) {
      const st = $('modalStatus');
      st.style.color = 'var(--warn)'; st.innerText = '⏳ No signal: saved on this phone. It uploads by itself.';
      try { navigator.vibrate && navigator.vibrate([18, 40, 18]); } catch (e) {}
      const rowIndex = job.payload.rowIndex;
      setTimeout(() => { if (currentItem && currentItem.rowIndex === rowIndex) closeModal(); render(); }, 900);
      note(`${job.item.irNumber} saved on the phone. It uploads when the signal returns.`, 5000);
    }
  }
  function failLive(msg) { const b = $('modalSaveBtn'), st = $('modalStatus'); handleFailedSubmission(msg, b, st); }

  async function queueRun(force) {
    if (running || !queue.length) return;
    if (navigator.onLine === false && !force) return;
    running = true; paintPending();
    try {
      for (const job of queue.slice().sort((a, b) => a.madeAt - b.madeAt)) {
        if (job.error && !force) continue;            // refused before: waits for the engineer (Pending screen)
        try {
          const res = await sendJob(job);
          await afterSent(job, res, false);
        } catch (e) {
          if (e.net) break;                           // still no signal: try again later
          if (e.auth) { job.error = 'Sign in again to upload.'; break; }
          job.error = e.pdf ? 'The PDF could not be made: ' + e.message : e.message;
          await queueSave(job);
        }
      }
    } finally { running = false; paintPending(); if (onScreen('pending')) drawPending(); }
  }
  addEventListener('online', () => { offlinePill(false); setTimeout(() => queueRun(), 1500); setTimeout(() => { if (typeof fetchItems === 'function') fetchItems(); }, 2500); });
  addEventListener('offline', () => offlinePill(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueRun(); });
  setInterval(() => queueRun(), 60000);

  // =====================================================================
  // 2. WEATHER (Open-Meteo, free, no key) for the time of the inspection
  // =====================================================================
  const WCODE = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Drizzle',
                  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Rain', 67: 'Rain', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let wxMem = null;
  async function wxData() {
    const c = wxMem || ls.get('shkWx', null);
    if (c && Date.now() - c.t < 30 * 60000) return c.d;
    const ctl = window.AbortController ? new AbortController() : null;
    const tm = setTimeout(() => ctl && ctl.abort(), 6000);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${SITE.lat}&longitude=${SITE.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m&past_days=3&forecast_days=1&timezone=auto`;
      const r = await fetch(url, ctl ? { signal: ctl.signal } : {});
      if (!r.ok) throw new Error('weather ' + r.status);
      const d = await r.json();
      wxMem = { t: Date.now(), d }; ls.set('shkWx', wxMem);
      return d;
    } catch (e) { if (c) return c.d; throw e; } finally { clearTimeout(tm); }
  }
  // weather text for an inspection date (today: the close time; another day: 11:00 that day)
  async function weatherFor(dateIso, t) {
    const d = await wxData(), h = d.hourly;
    const at = dateIso === isoOf(new Date(t)) ? new Date(t) : new Date(dateIso + 'T11:00:00');
    const want = `${isoOf(at)}T${String(at.getHours()).padStart(2, '0')}:00`;
    const i = h.time.indexOf(want);
    if (i < 0) return '';
    const rain = h.precipitation[i];
    return `${Math.round(h.temperature_2m[i])}°C · ${WCODE[h.weather_code[i]] || '—'} · wind ${Math.round(h.wind_speed_10m[i])} km/h ${DIRS[Math.round(h.wind_direction_10m[i] / 45) % 8]} · humidity ${Math.round(h.relative_humidity_2m[i])}% · ${rain > 0 ? 'rain ' + rain + ' mm' : 'no rain'}`;
  }

  // =====================================================================
  // 3. SIGNATURE (drawn once with a finger, printed in the Inspector box)
  // =====================================================================
  const sigKey = () => 'shkSig:' + (PtahApp.email() || '');
  const mySig = () => ls.get(sigKey(), '') || '';
  function openSigPad() {
    let o = $('dxSig');
    if (!o) {
      o = document.createElement('div'); o.id = 'dxSig'; o.className = 'acct-overlay dx-sig';
      o.innerHTML = `<div class="acct-box"><h3 style="margin:0 0 4px">Your signature</h3>
        <p class="acct-txt" style="margin:0 0 10px">Sign with your finger. It is printed in the Inspector box of every record you close.</p>
        <canvas id="dxSigPad" width="600" height="220"></canvas>
        <div class="acct-actions"><button type="button" class="acct-out" id="dxSigClear">Clear</button><button type="button" class="acct-close" id="dxSigX">Cancel</button><button type="button" class="dx-save" id="dxSigOk">Save</button></div>
        <p class="shk-sign">architected by Ptah</p></div>`;
      document.body.appendChild(o);
      const cv = $('dxSigPad'), cx = cv.getContext('2d');
      let drawing = false, last = null, dirty = false;
      const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
      cv.addEventListener('pointerdown', e => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
      cv.addEventListener('pointermove', e => {
        if (!drawing) return; const p = pos(e);
        cx.strokeStyle = '#0b2a5b'; cx.lineWidth = 5; cx.lineCap = 'round'; cx.lineJoin = 'round';
        cx.beginPath(); cx.moveTo(last.x, last.y); cx.lineTo(p.x, p.y); cx.stroke(); last = p; dirty = true; e.preventDefault();
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => cv.addEventListener(n, () => { drawing = false; }));
      $('dxSigClear').onclick = () => { cx.clearRect(0, 0, cv.width, cv.height); dirty = false; o.dataset.cleared = '1'; };
      $('dxSigX').onclick = () => o.classList.remove('open');
      $('dxSigOk').onclick = async () => {
        let png = '';
        if (dirty) png = trimCanvas(cv);
        else if (!o.dataset.cleared) return o.classList.remove('open');
        ls.set(sigKey(), png || null);
        o.classList.remove('open'); paintSigRow();
        try { await api('signature_set', [png]); note(png ? 'Signature saved' : 'Signature removed'); }
        catch (e) { note('Saved on this phone. ' + e.message, 5000); }
      };
      o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
      o._reset = () => {
        cx.clearRect(0, 0, cv.width, cv.height); dirty = false; delete o.dataset.cleared;
        const s = mySig(); if (s) { const im = new Image(); im.onload = () => cx.drawImage(im, (cv.width - im.width) / 2, (cv.height - im.height) / 2); im.src = s; }
      };
    }
    o._reset(); o.classList.add('open');
  }
  // the drawn part only, on a transparent background, max 300 px wide
  function trimCanvas(cv) {
    const cx = cv.getContext('2d'), d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return '';
    const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cv.width, x1 + pad); y1 = Math.min(cv.height, y1 + pad);
    const w = x1 - x0, h = y1 - y0, k = Math.min(1, 300 / w);
    const out = document.createElement('canvas'); out.width = Math.round(w * k); out.height = Math.round(h * k);
    out.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  // =====================================================================
  // 4. CLOSE SCREEN EXTRAS: re-inspection note, weather, voice, photos, signature, comments
  // =====================================================================
  let photos = [];                    // [{ data: jpeg dataURL, cap, t }]
  const MAX_PHOTOS = 8;
  let boot = { comments: {}, reinspect: { waiting: [], prev: {} }, signature: '', mail: true };

  function injectModal() {
    if ($('dxExtras')) return;
    const notesRow = $('modalNotes').closest('.form-row');
    notesRow.querySelector('label').insertAdjacentHTML('afterend', '<button type="button" class="dx-mic" id="dxMic" title="Speak (Arabic)"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>Speak</span></button>');
    notesRow.classList.add('dx-notes');
    $('modalDesc').insertAdjacentHTML('afterend', '<div class="dx-re" id="dxRe" hidden></div><div class="dx-pend" id="dxPendBox" hidden></div>');
    $('modalDate').closest('.form-row').insertAdjacentHTML('beforeend', '<div class="dx-wx" id="dxWx"></div>');
    notesRow.insertAdjacentHTML('afterend', `
      <div id="dxExtras">
        <div class="pills-group dx-photos">
          <span class="pills-label">Photos <small id="dxPhN"></small></span>
          <div class="dx-ph-btns"><button type="button" class="pill-btn" id="dxCamBtn">📷 Camera</button><button type="button" class="pill-btn" id="dxGalBtn">🖼 Gallery</button></div>
          <div class="dx-thumbs" id="dxThumbs"></div>
          <input type="file" id="dxCam" accept="image/*" capture="environment" hidden>
          <input type="file" id="dxGal" accept="image/*" multiple hidden>
        </div>
        <div class="pills-group dx-sigrow" id="dxSigRow"></div>
        <div class="pills-group dx-cm">
          <span class="pills-label">Comments <small id="dxCmN"></small><button type="button" class="sx-ph-btn" id="sxPhBtn">📷 Photos</button></span>
          <div class="dx-cm-list" id="dxCmList"></div>
          <div class="dx-cm-new" id="dxCmNew"><input type="text" id="dxCmIn" data-mention dir="auto" maxlength="1000" placeholder="Write a comment. Type @ to mention someone"><button type="button" class="pill-btn" id="dxCmSend">Send</button></div>
        </div>
      </div>`);
    $('dxCamBtn').onclick = takePhoto;
    $('dxGalBtn').onclick = () => $('dxGal').click();
    $('dxCam').onchange = e => addPhotos(e.target.files);
    $('dxGal').onchange = e => addPhotos(e.target.files);
    $('dxThumbs').addEventListener('click', e => { const x = e.target.closest('[data-rm]'); if (x) { photos.splice(+x.dataset.rm, 1); paintPhotos(); } });
    $('dxMic').onclick = voice;
    $('dxCmSend').onclick = sendComment;
    $('dxCmIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendComment(); } });
  }

  // In the Android app the web file chooser can fall back to the gallery, so the native Camera plugin opens the camera directly.
  async function takePhoto() {
    if (NATIVE && Capacitor.isPluginAvailable && Capacitor.isPluginAvailable('Camera')) {
      try {
        const r = await nativeP('Camera', 'getPhoto', { source: 'CAMERA', resultType: 'base64', quality: 80, width: 1600, correctOrientation: true, saveToGallery: false });
        if (r && r.base64String) {
          const bin = atob(r.base64String), u = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          return addPhotos([new File([u], 'photo.jpg', { type: 'image/' + (r.format || 'jpeg'), lastModified: Date.now() })]);
        }
        return;
      } catch (e) {
        if (/cancel/i.test(String(e && (e.message || e)))) return;
      }
    }
    $('dxCam').click();
  }

  // ---- photos: compressed on the phone (max 1280 px, JPEG) so the PDF stays small ----
  function shrink(file) {
    return new Promise((ok, bad) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1280 / Math.max(im.width, im.height));
        const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.62));
      };
      im.onerror = () => { URL.revokeObjectURL(url); bad(new Error('Could not read the photo')); };
      im.src = url;
    });
  }
  async function addPhotos(files) {
    const list = Array.from(files || []);
    for (const f of list) {
      if (photos.length >= MAX_PHOTOS) { note(`Up to ${MAX_PHOTOS} photos per request.`); break; }
      try {
        const t = f.lastModified && Date.now() - f.lastModified < 864e5 * 30 ? f.lastModified : Date.now();
        photos.push({ data: await shrink(f), t, cap: new Date(t).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) });
      } catch (e) { note(e.message); }
    }
    $('dxCam').value = ''; $('dxGal').value = '';
    paintPhotos();
  }
  function paintPhotos() {
    $('dxThumbs').innerHTML = photos.map((p, i) => `<span class="dx-th${p.tag ? ' tg-' + p.tag : ''}"><img src="${p.data}" alt="" data-ph="${i}">${p.tag ? `<em>${p.tag === 'before' ? 'Before' : 'After'}</em>` : ''}<button type="button" data-rm="${i}" aria-label="Remove">✕</button></span>`).join('');
    $('dxPhN').textContent = photos.length ? `${photos.length} · go in the PDF` : '';
  }

  // ---- signature row in the close screen ----
  function paintSigRow() {
    const r = $('dxSigRow'); if (!r) return;
    const s = mySig();
    r.innerHTML = `<span class="pills-label">Signature</span>` + (s
      ? `<div class="dx-sig-prev"><img src="${s}" alt="Your signature"><button type="button" class="cl-chg" id="dxSigEdit">Change</button></div>`
      : `<button type="button" class="pill-btn" id="dxSigEdit">✍ Draw your signature</button><small class="dx-hint">Drawn once, printed on every record.</small>`);
    $('dxSigEdit').onclick = openSigPad;
  }

  // ---- voice notes (Arabic dictation) ----
  let rec = null;
  async function voice() {
    const ta = $('modalNotes'), b = $('dxMic');
    const add = t => { t = String(t || '').trim(); if (!t) return; ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + t; ta.dispatchEvent(new Event('input')); };
    if (NATIVE) {
      try {
        b.classList.add('on');
        try { await nativeP('SpeechRecognition', 'requestPermissions'); } catch (e) {}
        const r = await nativeP('SpeechRecognition', 'start', { language: 'ar-EG', maxResults: 1, prompt: 'اتكلم...', popup: true, partialResults: false });
        add(r && r.matches && r.matches[0]);
      } catch (e) { note('Voice typing is not available: ' + (e.message || e) + '. Use the microphone key on the keyboard.', 6000); }
      finally { b.classList.remove('on'); }
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return note('Voice typing is not available in this browser. Use the microphone key on the keyboard.', 6000);
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ar-EG'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add(e.results[i][0].transcript); };
    rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') note('Voice: ' + e.error); };
    rec.onend = () => { rec = null; b.classList.remove('on'); b.querySelector('span').textContent = 'Speak'; };
    try { rec.start(); b.classList.add('on'); b.querySelector('span').textContent = 'Stop'; } catch (e) { rec = null; note('Voice: ' + e.message); }
  }

  // ---- comments ----
  let cmReq = 0;
  function loadComments(item) {
    const list = $('dxCmList'), req = ++cmReq;
    $('dxCmNew').hidden = !canClose();
    const n = boot.comments[item.irNumber] || 0;
    $('dxCmN').textContent = n ? String(n) : '';
    list.innerHTML = n ? '<div class="dx-cm-empty">Loading...</div>' : '<div class="dx-cm-empty">No comments yet.</div>';
    if (!n) return;
    api('comments_list2', [item.irNumber, '']).then(r => { if (req === cmReq) paintComments(r); }).catch(e => { if (req === cmReq) list.innerHTML = `<div class="dx-cm-empty">${esc(e.message)}</div>`; });
  }
  function paintComments(rows) {
    const me = PtahApp.email();
    $('dxCmN').textContent = rows.length ? String(rows.length) : '';
    if (currentItem) boot.comments[currentItem.irNumber] = rows.length;
    $('dxCmList').innerHTML = rows.length ? rows.map(c => (window.Shk && Shk.sx ? Shk.sx.cmHtml(c, me) : `<div class="dx-cm-it${c.email === me ? ' mine' : ''}"><b>${esc(c.engineer)}</b><p dir="auto">${esc(c.text)}</p></div>`)).join('')
      : '<div class="dx-cm-empty">No comments yet.</div>';
    const l = $('dxCmList'); l.scrollTop = l.scrollHeight;
  }
  async function sendComment() {
    const inp = $('dxCmIn'), t = inp.value.trim(), it = currentItem;
    if (!t || !it) return;
    const b = $('dxCmSend'); b.disabled = true;
    try { paintComments(await api('comments_add2', [it.irNumber, it.rev, t, ''])); inp.value = ''; render(); }
    catch (e) { note(e.message, 5000); }
    finally { b.disabled = false; }
  }

  // ---- re-inspection text ("Rev 0 · Code C · 05/11/2026 · Walid") ----
  function prevOf(item) { return (boot.reinspect.prev || {})[item.irNumber] || null; }
  function prevText(item) { const p = prevOf(item); return p ? `Rev ${p.rev} · Code ${p.code}${p.date ? ' · ' + dmy(p.date) : ''}` : ''; }

  // ---- open a request: fill the extras ----
  const baseOpen = window.openModal;
  window.openModal = function (item) {
    const r = baseOpen.apply(this, arguments);
    try {
      injectModal();
      photos = []; paintPhotos(); paintSigRow();
      const p = prevOf(item), re = $('dxRe');
      re.hidden = !p;
      if (p) re.innerHTML = `↻ <b>Re-inspection.</b> Rev ${esc(p.rev)} was <b class="c-${esc(p.code)}">Code ${esc(p.code)}</b>${p.by ? ' by ' + esc(p.by) : ''}${p.date ? ' on ' + esc(dmy(p.date)) : ''}.`;
      const job = queue.find(j => j.key === keyOf(item)), pb = $('dxPendBox');
      pb.hidden = !job;
      $('modalSaveBtn').hidden = !!job || !canClose();
      if (job) pb.innerHTML = `⏳ <b>Waiting to upload.</b> You closed it as Code ${esc(job.payload.code)} at ${hhmm(job.madeAt)}.${job.error ? '<br><span class="bad">' + esc(job.error) + '</span>' : ' It uploads by itself when the signal returns.'}
        <div class="dx-pend-act"><button type="button" class="pill-btn" data-dxq="run">Upload now</button><button type="button" class="pill-btn" data-dxq="drop" data-id="${esc(job.id)}">Cancel this close</button></div>`;
      if (!canClose()) { $('modalStatus').innerText = 'View only.'; }
      loadComments(item);
      const w = $('dxWx'); w.textContent = '';
      weatherFor($('modalDate').value, Date.now()).then(t => { if (currentItem === item && t) w.textContent = '🌤 ' + t; }).catch(() => {});
    } catch (e) { console.warn('dx open', e); }
    return r;
  };

  // =====================================================================
  // 5. CLOSING: online now, or saved on the phone and uploaded later
  // =====================================================================
  window.submitModalData = async function () {
    if (!currentItem) return;
    const saveBtn = $('modalSaveBtn'), st = $('modalStatus');
    if (saveBtn.disabled || saveBtn.hidden) return;
    if (!canClose()) { st.style.color = 'var(--rej)'; st.innerText = 'View only: you cannot close requests.'; return; }
    if (!selectedInspector) { st.style.color = 'var(--rej)'; st.innerText = '⚠ Pick the inspector before closing the request.'; return; }
    if (clCurrent && !Object.keys(clMarks).length && !clWarned) {
      clWarned = true; st.style.color = 'var(--warn)';
      st.innerText = '⚠ The checklist is not marked. Tick it (or press All ✓), or press Close again to save without ticks.';
      return;
    }
    saveBtn.disabled = true; st.style.color = ''; st.innerText = 'Preparing...';
    const item = currentItem;
    const job = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), madeAt: Date.now(), key: keyOf(item),
      item: Object.assign({}, item),
      payload: { rowIndex: item.rowIndex, rowIndices: item.rowIndices || [item.rowIndex], irNumber: item.irNumber, itemId: item.itemId, rev: item.rev,
                 description: item.description, contractor: item.contractor || '', date: $('modalDate').value, inspector: selectedInspector,
                 code: selectedCode, rawNotes: $('modalNotes').value.trim() },
      cl: clCurrent, marks: Object.assign({}, clMarks), photos: photos.slice(), signature: mySig(), noPdf: !!clPdfFailed || !clCurrent,
      prevRev: prevText(item), weather: ''
    };
    try { job.weather = await weatherFor(job.payload.date, job.madeAt); } catch (e) {}
    if (navigator.onLine === false) return queueAdd(job, true);
    try {
      const res = await sendJob(job, s => { st.innerText = s; });
      await afterSent(job, res, true);
    } catch (e) {
      if (e.net) return queueAdd(job, true);
      if (e.pdf) {
        clPdfFailed = true; saveBtn.disabled = false; st.style.color = 'var(--rej)';
        st.innerText = '✕ PDF could not be made (' + e.message + '). Press Close again to save without the PDF.';
        return;
      }
      handleFailedSubmission(e.message, saveBtn, st);
    }
  };

  async function makeRecordFor(job) {
    const it = job.item, p = job.payload;
    const d = PtahRecord.prepare({ irNumber: it.irNumber, rev: it.rev, itemId: it.itemId, description: it.description, date: p.date,
      inspector: p.inspector, code: p.code, notes: p.rawNotes, contractor: it.contractor }, job.cl, job.marks);
    d.weather = job.weather; d.prevRev = job.prevRev; d.signature = job.signature; d.ptahSign = !!CFG.PDF_PTAH_SIGN;
    d.photos = job.photos.map(ph => ({ data: ph.data, cap: ph.cap, tag: ph.tag || '' }));
    const bytes = await PtahRecord.build(d);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), name: PtahRecord.fileName(d), villa: d.villa };
  }
  window.makeRecord = (item, p) => makeRecordFor({ item, payload: p, cl: clCurrent, marks: clMarks, photos, signature: mySig(), weather: '', prevRev: prevText(item) });

  async function sendJob(job, progress) {
    const p = Object.assign({}, job.payload, { clientId: job.id, weather: job.weather,
      photos: job.photos.filter(ph => !ph.fromRev).map((ph, i) => ({ base64: ph.data, name: 'photo ' + (i + 1), tag: ph.tag || '' })) });
    if (job.queued) p.madeAt = job.madeAt;
    if (!job.noPdf && job.cl && window.PtahRecord) {
      progress && progress('Making the PDF...');
      try {
        p.record = await makeRecordFor(job);
        job.pdfB64 = p.record.base64; job.pdfName = p.record.name;
      } catch (e) {
        if (navigator.onLine === false || /load|download|fetch|network/i.test(e.message || '')) { const x = new Error('No signal'); x.net = true; throw x; }
        e.pdf = true; throw e;
      }
    }
    progress && progress(p.record ? 'Saving record + PDF...' : 'Saving...');
    return PtahApp.callRaw('processAndSaveAction', [p]);
  }

  async function afterSent(job, res, live) {
    const st = $('modalStatus'), btn = $('modalSaveBtn');
    if (res && res.success) {
      if (job.queued) await queueDel(job.id);
      if (live) {
        handleSuccessSubmission(job.payload.rowIndex, st, job.payload.code);
        if (res.undoToken) offerUndo(res.undoToken, job.item, !!res.recordUrl, res.recordError);
        else note(`Saved ${job.item.irNumber}.`);
      } else {
        const it = allItems.find(x => keyOf(x) === job.key);
        if (it) { bumpClosed(1); removeItem(it.rowIndex); }
        note(`Uploaded ${job.item.irNumber} (closed offline at ${hhmm(job.madeAt)}).`, 5000);
      }
      if (job.pdfB64 || res.recordUrl) shareButton(job, res);
      return;
    }
    if (res && res.alreadyClosed) {
      if (job.queued) {
        await queueDel(job.id);
        const lost = ls.get('shkLost', []); lost.unshift({ ir: job.item.irNumber, rev: job.item.rev, code: job.payload.code, t: job.madeAt, why: res.error }); ls.set('shkLost', lost.slice(0, 20));
        const it = allItems.find(x => keyOf(x) === job.key); if (it) removeItem(it.rowIndex);
        note(`⚠ ${job.item.irNumber}: ${res.error} Your offline close was not saved.`, 9000);
      }
      if (live) handleAlreadyClosed(res.error, job.payload.rowIndex, st);
      return;
    }
    const msg = (res && res.error) || 'Unknown error';
    if (live) return handleFailedSubmission(msg, btn, st);
    job.error = msg; await queueSave(job);
  }

  // ---- "Send on WhatsApp" next to Undo, after a close ----
  window.showToast = (function (base) {
    return function () { const b2 = $('toastBtn2'); if (b2) b2.style.display = 'none'; $('toast').classList.remove('dx-two'); return base.apply(this, arguments); };
  })(window.showToast);
  function shareButton(job, res) {
    let b2 = $('toastBtn2');
    if (!b2) { b2 = document.createElement('button'); b2.type = 'button'; b2.id = 'toastBtn2'; b2.className = 'dx-wa'; $('toastBtn').insertAdjacentElement('afterend', b2); }
    b2.textContent = 'WhatsApp'; b2.style.display = ''; $('toast').classList.add('dx-two');
    b2.onclick = () => sharePdf({ b64: job.pdfB64, name: job.pdfName, url: res.recordUrl,
      text: `Inspection record ${job.item.irNumber} · Rev ${job.item.rev} · Code ${job.payload.code}\n${activityOf(job.item)} · ${villaOf(job.item)}` });
  }
  async function sharePdf(o) {
    if (o.b64 && navigator.canShare && window.File) {
      try {
        const f = new File([b64bytes(o.b64)], o.name || 'record.pdf', { type: 'application/pdf' });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], text: o.text, title: o.name }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (!o.url) return note('The PDF is not in Drive, so there is no link to send.');
    try {
      note('Making a link...', 2500);
      const link = await api('share_link', [o.url]);
      openExternal('https://wa.me/?text=' + encodeURIComponent(o.text + '\n' + link));
    } catch (e) { note(e.message, 5000); }
  }

  // =====================================================================
  // 6. BADGES ON THE REQUEST CARDS
  // =====================================================================
  function badges(item) {
    const out = [];
    if (queuedKeys().has(keyOf(item))) out.push('<span class="dx-b q">⏳ Waiting to upload</span>');
    const p = prevOf(item); if (p) out.push(`<span class="dx-b re">↻ Rev ${esc(p.rev)} was ${esc(p.code)}</span>`);
    const n = boot.comments[item.irNumber]; if (n) out.push(`<span class="dx-b cm">💬 ${n}</span>`);
    return out.join('');
  }
  const baseCard = window.buildCard, baseRow = window.buildRow;
  window.buildCard = function (item) {
    const c = baseCard.apply(this, arguments), b = badges(item);
    if (b) { const t = c.querySelector('.card-middle'); if (t) t.insertAdjacentHTML('beforeend', `<div class="dx-badges">${b}</div>`); }
    if (queuedKeys().has(keyOf(item))) c.classList.add('dx-queued');
    return c;
  };
  window.buildRow = function (item) {
    const r = baseRow.apply(this, arguments), b = badges(item);
    if (b) { const t = r.querySelector('.r-villa'); if (t) t.insertAdjacentHTML('beforeend', `<span class="dx-badges">${b}</span>`); }
    if (queuedKeys().has(keyOf(item))) r.classList.add('dx-queued');
    return r;
  };

  // =====================================================================
  // 7. HOME: quick buttons, pending / offline pills
  // =====================================================================
  const baseRender = window.render;
  window.render = function () {
    const r = baseRender.apply(this, arguments);
    try { quick(); } catch (e) { console.warn(e); }
    return r;
  };
  function quick() {
    const h = $('heroBand'); if (!h || h.hidden) return;
    let q = $('dxQuick');
    if (!q) { q = document.createElement('div'); q.id = 'dxQuick'; q.className = 'dx-quick'; }
    if (q.parentNode !== h) h.appendChild(q);
    const me = (PtahApp.engineer() || '').toLowerCase();
    const mine = (boot.reinspect.waiting || []).filter(w => String(w.by).toLowerCase() === me).length;
    const all = (boot.reinspect.waiting || []).length;
    q.innerHTML = `<button type="button" data-dx="cal"><i>📅</i>Calendar</button>
      <button type="button" data-dx="re"><i>↻</i>Re-inspect${all ? `<b>${PtahApp.role() === 'Engineer' && mine ? mine : all}</b>` : ''}</button>
      <button type="button" data-dx="rep"><i>📄</i>Daily report</button>
      ${queue.length ? `<button type="button" data-dx="pend" class="warn"><i>⏳</i>To upload<b>${queue.length}</b></button>` : ''}`;
  }
  function paintPending() {
    let p = $('dxPendPill');
    if (!p) { p = document.createElement('button'); p.type = 'button'; p.id = 'dxPendPill'; p.className = 'dx-pill pend'; p.dataset.dx = 'pend'; document.body.appendChild(p); }
    p.hidden = !queue.length;
    p.innerHTML = running ? `⟳ Uploading ${queue.length}...` : `⏳ ${queue.length} waiting to upload`;
    try { quick(); } catch (e) {}
  }
  function offlinePill(on, t) {
    let p = $('dxOffPill');
    if (!p) { p = document.createElement('div'); p.id = 'dxOffPill'; p.className = 'dx-pill off'; document.body.appendChild(p); }
    p.hidden = !on;
    p.textContent = t ? `Offline · list from ${hhmm(t)}` : 'Offline · closes are saved on the phone';
    document.body.classList.toggle('dx-offline', !!on);
  }
  document.addEventListener('shk-offline', e => { if (e.detail.fn === 'getDailyActions') offlinePill(true, e.detail.t); });

  // after the list loads: bootstrap (comments, re-inspection, signature), checklists for offline, reminders
  let lastBoot = 0, lastBulk = ls.get('shkBulkT', 0);
  const baseGrid = window.renderGrid;
  window.renderGrid = function (items) {
    const r = baseGrid.apply(this, arguments);
    if (!window.SHK_OFFLINE_SINCE) offlinePill(false);
    if (Date.now() - lastBoot > 90000) { lastBoot = Date.now(); loadBoot(); }
    if (Date.now() - lastBulk > 3 * 3600e3 && navigator.onLine !== false) prefetchChecklists(items || []);
    queueRun();
    setTimeout(remind, 5000);
    return r;
  };
  function loadBoot() {
    api('daily_bootstrap').then(b => {
      boot = Object.assign(boot, b || {});
      if (b && b.signature && !mySig()) ls.set(sigKey(), b.signature);
      render();
    }).catch(e => console.warn('bootstrap', e));
  }
  // the checklists of all open requests, kept on the phone so the close screen works without signal
  function prefetchChecklists(items) {
    const list = items.map(i => ({ specNo: i.specNo || '', description: i.description || '' }));
    if (!list.length) return;
    PtahApp.callRaw('checklists_bulk', [list]).then(r => {
      list.forEach((it, i) => {
        const k = r.keys[i]; if (!k) return;
        const [code, by] = k.split('|'), cl = r.sections[code];
        if (cl) PtahApp.cacheSet('getChecklist', [it.specNo, it.description], Object.assign({}, cl, { matchedBy: by }));
      });
      lastBulk = Date.now(); ls.set('shkBulkT', lastBulk);
    }).catch(e => console.warn('checklists', e));
  }

  // =====================================================================
  // 8. REMINDERS: late requests, once a day on this phone (+ a notification when allowed)
  // =====================================================================
  function remind() {
    if (!ls.get('shkRemind', true) || !allItems.length) return;
    const late = lateCount(allItems), k = 'shkReminded:' + todayIso();
    if (!late || ls.get(k, 0)) return;
    ls.set(k, 1);
    note(`⚠ ${late} late request${late > 1 ? 's' : ''} waiting. Oldest first in the lists.`, 6000);
    if (window.Notification && Notification.permission === 'granted') {
      const body = `${late} late · ${allItems.length} open`;
      navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.showNotification) reg.showNotification('Shaker Inspect', { body, icon: 'icons/icon-192.png', tag: 'late' }); else new Notification('Shaker Inspect', { body });
      }).catch(() => {}) : new Notification('Shaker Inspect', { body });
    }
  }

  // =====================================================================
  // 9. FULL-SCREEN PAGES: calendar, re-inspection, daily report, uploads, daily jobs
  // =====================================================================
  function screen(title, html, name) {
    Shk.closeAll && Shk.closeAll();
    const s = $('shkScreen');
    s.innerHTML = `<header class="sc-head"><button type="button" class="sc-back" data-act="close" aria-label="Back">‹</button><h2>${esc(title)}</h2><button type="button" class="sc-back" data-act="rf" aria-label="Refresh" title="Refresh">⟳</button></header><main class="sc-body" id="scBody">${html}</main>`;
    s.classList.add('open'); document.body.classList.add('scr-open');
    Shk.dxScreen = name; Shk.dxRe = null;
  }
  const body = () => $('scBody');
  const onScreen = n => Shk.dxScreen === n && !!$('scBody') && $('shkScreen').classList.contains('open');
  const SIGN = '<p class="shk-sign">architected by Ptah</p>';
  const itemRow = it => `<button type="button" class="dx-it${isLate(it) ? ' late' : ''}" data-open="${esc(keyOf(it))}"><b>${esc(villaOf(it))}</b><span>${esc(activityOf(it))}</span><small>${esc(it.irNumber)} · Rev ${esc(it.rev)}${it.contractor ? ' · ' + esc(it.contractor) : ''}${badges(it) ? ' ' + badges(it) : ''}</small></button>`;

  // ---- calendar of open requests by due date ----
  let calM = null, calSel = '', calWeek = false;
  function openCalendar() { const n = new Date(); calM = calM || new Date(n.getFullYear(), n.getMonth(), 1); calSel = calSel || todayIso(); screen('Calendar', '', 'cal'); Shk.dxRe = openCalendar; drawCal(); }
  function drawCal() {
    const by = {}, none = [];
    allItems.forEach(it => { if (it.dueDate) (by[it.dueDate] = by[it.dueDate] || []).push(it); else none.push(it); });
    const t = todayIso(), y = calM.getFullYear(), m = calM.getMonth();
    const first = new Date(y, m, 1), lead = (first.getDay() + 1) % 7;          // weeks start on Saturday
    const days = new Date(y, m + 1, 0).getDate();
    let cells = '';
    if (!calWeek) {
      for (let i = 0; i < lead; i++) cells += '<i class="dx-day off"></i>';
      for (let d = 1; d <= days; d++) {
        const iso = isoOf(new Date(y, m, d)), n = (by[iso] || []).length;
        cells += `<button type="button" class="dx-day${iso === t ? ' today' : ''}${iso === calSel ? ' sel' : ''}${n && iso < t ? ' late' : ''}" data-day="${iso}"><span>${d}</span>${n ? `<b>${n}</b>` : ''}</button>`;
      }
    } else {
      const s = new Date(calSel + 'T00:00:00'); s.setDate(s.getDate() - (s.getDay() + 1) % 7);
      for (let i = 0; i < 7; i++) {
        const dd = new Date(s); dd.setDate(s.getDate() + i);
        const iso = isoOf(dd), list = by[iso] || [];
        cells += `<div class="dx-wk${iso === t ? ' today' : ''}"><h4>${dd.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} <small>${list.length || ''}</small></h4>${list.map(itemRow).join('') || '<small class="dx-none">Nothing due</small>'}</div>`;
      }
    }
    const sel = by[calSel] || [];
    const overdue = Object.keys(by).filter(k => k < t).reduce((a, k) => a + by[k].length, 0);
    body().innerHTML = `
      <div class="dx-calbar"><button type="button" data-cal="-1">‹</button><b>${calWeek ? 'Week of ' + dmy(calSel) : calM.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><button type="button" data-cal="1">›</button></div>
      <div class="seg2"><button type="button" class="${calWeek ? '' : 'on'}" data-calv="m">Month</button><button type="button" class="${calWeek ? 'on' : ''}" data-calv="w">Week</button><button type="button" data-cal="today">Today</button></div>
      <small class="hint">Open requests by their ACC due date. ${overdue ? `<b class="late">${overdue} past due.</b>` : ''}</small>
      ${calWeek ? `<div class="dx-weeklist">${cells}</div>` : `<div class="dx-cal"><span>Sat</span><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span>${cells}</div>
      <h3 class="sc-h">${dmy(calSel)} · ${sel.length} due</h3><div class="dx-list">${sel.map(itemRow).join('') || '<div class="sc-empty">Nothing due on this day.</div>'}</div>`}
      ${none.length ? `<h3 class="sc-h">No due date · ${none.length}</h3><div class="dx-list">${none.slice(0, 40).map(itemRow).join('')}</div>` : ''}${SIGN}`;
  }

  // ---- re-inspection: Code C / D waiting for the contractor ----
  let reMine = null;
  function openRe() {
    if (reMine == null) reMine = PtahApp.role() === 'Engineer';
    screen('Re-inspection', '<div class="sc-load"><i></i><i></i><i></i></div>', 're'); Shk.dxRe = openRe;
    drawRe();
    api('reinspect_list').then(r => { boot.reinspect = r; if (onScreen('re')) drawRe(); render(); }).catch(e => { if (!boot.reinspect.waiting.length) body().innerHTML = `<div class="sc-empty">${esc(e.message)}</div>`; });
  }
  function drawRe() {
    const me = (PtahApp.engineer() || '').toLowerCase();
    let w = boot.reinspect.waiting || [];
    if (reMine) w = w.filter(x => String(x.by).toLowerCase() === me);
    const back = allItems.filter(it => prevOf(it));
    body().innerHTML = `
      <div class="seg2"><button type="button" class="${reMine ? 'on' : ''}" data-re="1">Mine</button><button type="button" class="${reMine ? '' : 'on'}" data-re="0">Everyone</button></div>
      <h3 class="sc-h">Resubmitted, open now · ${back.length}</h3>
      <div class="dx-list">${back.map(itemRow).join('') || '<div class="sc-empty">No resubmissions waiting.</div>'}</div>
      <h3 class="sc-h">Waiting for the contractor to resubmit · ${w.length}</h3>
      <div class="card-list">${w.map(x => `<div class="row col"><div class="rowtop"><b class="mono">${esc(x.ir)} · Rev ${esc(x.rev)}</b><b class="c-${esc(x.code)}">Code ${esc(x.code)}</b></div><span>${esc(x.title)}</span><small>${esc(x.contractor || '')}${x.by ? ' · ' + esc(x.by) : ''}${x.date ? ' · ' + esc(dmy(x.date)) : ''}${x.days != null ? ' · <b class="' + (x.days > 7 ? 'late' : '') + '">' + x.days + ' days</b>' : ''}</small></div>`).join('') || '<div class="sc-empty">Nothing waiting.</div>'}</div>
      <small class="hint">A Code C or D stays here until the contractor sends the next Rev (it shows up in DailyAction).</small>${SIGN}`;
  }

  // ---- daily report in one tap ----
  let repDay = '';
  function openReport() {
    repDay = repDay || todayIso();
    screen('Daily report', '', 'rep'); Shk.dxRe = openReport; drawReport();
  }
  function drawReport() {
    const internal = PtahApp.role() !== 'Viewer';
    body().innerHTML = `<label class="lab">Day<input type="date" class="sc-in" id="dxRepDay" value="${repDay}" max="${todayIso()}"></label>
      ${internal ? `<button type="button" class="dx-rep main" data-rep="">📄 Internal copy<small>All contractors, per engineer, PDF links</small></button>` : ''}
      <h3 class="sc-h">Contractor copies</h3><div id="dxRepCons"><div class="sc-load"><i></i><i></i><i></i></div></div>
      <div id="dxRepOut"></div>
      <small class="hint">Made from the requests closed on that day (in the app and in the sheet). Saved in Drive > Shaker Inspect - Daily Reports.</small>${SIGN}`;
    $('dxRepDay').onchange = e => { repDay = e.target.value || todayIso(); drawReport(); };
    api('report_contractors', [repDay]).then(cs => {
      $('dxRepCons').innerHTML = cs.length ? cs.map(c => `<button type="button" class="dx-rep" data-rep="${esc(c.name)}">${esc(c.name)}<small>${c.n} closed</small></button>`).join('') : '<div class="sc-empty">Nothing closed on this day yet.</div>';
    }).catch(e => { $('dxRepCons').innerHTML = `<div class="sc-empty">${esc(e.message)}</div>`; });
  }
  async function makeReport(btn, contractor) {
    btn.disabled = true; const out = $('dxRepOut');
    out.innerHTML = '<div class="card">Making the report...</div>';
    try {
      const r = await api('report_daily', [repDay, contractor]);
      out.innerHTML = `<div class="card dx-repdone"><b>${esc(r.name)}</b><small>${r.count} requests</small>
        <div class="btnrow"><a class="b-line" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a><button type="button" class="b-ok" id="dxRepShare">Send / WhatsApp</button></div></div>`;
      $('dxRepShare').onclick = () => sharePdf({ b64: r.base64, name: r.name, url: r.url, text: `Daily inspection report ${dmy(repDay)}${contractor ? ' · ' + contractor : ''}` });
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { out.innerHTML = `<div class="card bad">${esc(e.message)}</div>`; }
    finally { btn.disabled = false; }
  }

  // ---- closes waiting to upload ----
  function openPending() { screen('Waiting to upload', '', 'pending'); Shk.dxRe = openPending; drawPending(); }
  function drawPending() {
    const lost = ls.get('shkLost', []);
    body().innerHTML = `
      <div class="btnrow"><button type="button" class="b-ok" data-dxq="run" ${!queue.length || running ? 'disabled' : ''}>${running ? 'Uploading...' : 'Upload now'}</button></div>
      <div class="card-list">${queue.map(j => `<div class="row col${j.error ? ' warn' : ''}"><div class="rowtop"><b class="mono">${esc(j.item.irNumber)} · Rev ${esc(j.item.rev)}</b><b class="c-${esc(j.payload.code)}">Code ${esc(j.payload.code)}</b></div>
        <span>${esc(villaOf(j.item))} · ${esc(activityOf(j.item))}</span><small>Closed ${esc(new Date(j.madeAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}${j.photos.length ? ' · ' + j.photos.length + ' photos' : ''}</small>
        ${j.error ? `<small class="bad">${esc(j.error)}</small>` : ''}
        <div class="btnrow">${/PDF/.test(j.error || '') ? `<button type="button" class="b-line" data-dxq="nopdf" data-id="${esc(j.id)}">Send without PDF</button>` : ''}<button type="button" class="b-no" data-dxq="drop" data-id="${esc(j.id)}">Cancel this close</button></div></div>`).join('') || '<div class="sc-empty">Nothing waiting. Everything is uploaded.</div>'}</div>
      ${lost.length ? `<h3 class="sc-h">Not saved (someone else closed them first)</h3><div class="card-list">${lost.map(l => `<div class="row col"><b class="mono">${esc(l.ir)} · Rev ${esc(l.rev)} · Code ${esc(l.code)}</b><small>${esc(l.why)}</small></div>`).join('')}</div><div class="btnrow"><button type="button" class="b-line" data-dxq="clearlost">Clear this list</button></div>` : ''}
      <small class="hint">Closes made without signal stay on this phone and upload by themselves when the signal returns. The server still checks each one.</small>${SIGN}`;
  }

  // ---- admin: timed jobs ----
  function openJobs() {
    screen('Daily jobs', '<div class="sc-load"><i></i><i></i><i></i></div>', 'jobs'); Shk.dxRe = openJobs;
    api('admin_jobs').then(j => {
      const ok = v => v ? '<em class="okk">on</em>' : '<em class="late">not set up</em>';
      const when = s => s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
      body().innerHTML = `<div class="card-list">
          <div class="row"><span>Morning email (7:00)</span>${ok(j.morning)}</div>
          <div class="row"><span>Late reminder to admins (13:00)</span>${ok(j.reminder)}</div>
          <div class="row"><span>Sheet backup (2:00, keeps 30)</span>${ok(j.backup)}</div>
          <div class="row"><span>Last backup</span><small>${when(j.lastBackup)}</small></div>
          <div class="row"><span>Last morning email</span><small>${when(j.lastMorning)}</small></div>
          <div class="row"><span>Emails left today</span><b class="mono">${j.quota}</b></div></div>
        <div class="btnrow"><button type="button" class="b-line" data-job="mail">Send me the morning email now</button><button type="button" class="b-line" data-job="backup">Back up the sheet now</button></div>
        ${!(j.morning && j.backup) ? '<small class="hint">Not set up yet: in Apps Script run <b>setupDaily</b> once.</small>' : ''}${SIGN}`;
    }).catch(e => { body().innerHTML = `<div class="sc-empty">${esc(e.message)}</div>`; });
  }

  // =====================================================================
  // 10. FINGERPRINT / FACE LOCK
  // =====================================================================
  const lockKey = () => 'shkLock:' + (PtahApp.email() || '');
  const lockCfg = () => ls.get(lockKey(), null);
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const toB64u = b => btoa(String.fromCharCode.apply(null, new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64u = s => b64bytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  async function lockOn() {
    if (NATIVE) {
      const a = await nativeP('NativeBiometric', 'isAvailable', { useFallback: true });
      if (!a || !a.isAvailable) throw new Error('This phone has no fingerprint or face unlock set up.');
      await nativeP('NativeBiometric', 'verifyIdentity', { reason: 'Turn on the lock', title: 'Shaker Inspect', useFallback: true });
      ls.set(lockKey(), { kind: 'native' }); return;
    }
    if (!window.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)))
      throw new Error('This phone or browser has no fingerprint / face unlock for apps. Install the app (APK) or use Chrome.');
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rnd(32), rp: { name: 'Shaker Inspect' },
      user: { id: rnd(16), name: PtahApp.email(), displayName: PtahApp.engineer() },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000 } });
    ls.set(lockKey(), { kind: 'web', id: toB64u(cred.rawId) });
  }
  async function unlockOnce() {
    const c = lockCfg(); if (!c) return true;
    if (c.kind === 'native') { await nativeP('NativeBiometric', 'verifyIdentity', { reason: 'Open Shaker Inspect', title: 'Shaker Inspect', useFallback: true }); return true; }
    await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: fromB64u(c.id) }], userVerification: 'required', timeout: 60000 } });
    return true;
  }
  function showLock() {
    if (!lockCfg() || !PtahApp.engineer()) return;
    let o = $('dxLock');
    if (!o) {
      o = document.createElement('div'); o.id = 'dxLock'; o.className = 'dx-lock';
      o.innerHTML = `<div class="dx-lock-box"><img src="icons/icon-192.png" alt="" width="72" height="72"><h2>Shaker Inspect</h2><p>Locked · ${esc(PtahApp.engineer())}</p>
        <button type="button" class="login-btn" id="dxUnlock">🔓 Unlock</button><p class="dx-lock-msg" id="dxLockMsg"></p>
        <button type="button" class="dx-lock-out" id="dxLockOut">Sign out</button><p class="shk-sign">architected by Ptah</p></div>`;
      document.body.appendChild(o);
      $('dxUnlock').onclick = tryUnlock;
      $('dxLockOut').onclick = () => { ls.set(lockKey(), null); PtahApp.signOut(); };
    }
    o.classList.add('open'); document.body.classList.add('dx-locked');
    const wait = () => document.getElementById('splash') ? setTimeout(wait, 300) : setTimeout(tryUnlock, 250);
    wait();
  }
  let unlocking = false;
  async function tryUnlock() {
    if (unlocking) return; unlocking = true;
    try { await unlockOnce(); $('dxLock').classList.remove('open'); document.body.classList.remove('dx-locked'); $('dxLockMsg').textContent = ''; }
    catch (e) { $('dxLockMsg').textContent = 'Not unlocked. Press Unlock to try again.'; }
    finally { unlocking = false; }
  }
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 3 * 60000) showLock();
  });

  // =====================================================================
  // 11. "ME" SHEET: new entries
  // =====================================================================
  function meEntries() {
    const list = document.querySelector('#acctOverlay .acct-list'); if (!list || $('dxMe')) return;
    // daily tools right after "Admin screen"; personal settings before "Light / dark"
    const work = `<div id="dxMe" class="dx-me">
      <button type="button" data-dx="cal"><span>📅 Calendar</span><i>›</i></button>
      <button type="button" data-dx="re"><span>↻ Re-inspection</span><i>›</i></button>
      <button type="button" data-dx="rep"><span>📄 Daily report</span><i>›</i></button>
      <button type="button" data-dx="pend"><span>⏳ Waiting to upload <b id="dxMeQ"></b></span><i>›</i></button></div>`;
    const prefs = `<div id="dxMe2" class="dx-me">
      <button type="button" data-dx="sig" class="eng-only"><span>✍ My signature</span><i id="dxMeSig"></i></button>
      <button type="button" data-dx="lock"><span>🔒 Fingerprint lock</span><i id="dxMeLock"></i></button>
      <button type="button" data-dx="mail" class="eng-only"><span>✉ Morning email</span><i id="dxMeMail"></i></button>
      <button type="button" data-dx="remind"><span>🔔 Late reminders on this phone</span><i id="dxMeRem"></i></button>
      <button type="button" data-dx="jobs" class="admin-only"><span>⚙ Daily jobs (backup, emails)</span><i>›</i></button></div>`;
    const adminBtn = list.querySelector('button.gold');
    adminBtn ? adminBtn.insertAdjacentHTML('afterend', work) : list.insertAdjacentHTML('afterbegin', work);
    const theme = Array.from(list.querySelectorAll('button')).find(b => /Light \/ dark/.test(b.textContent));
    theme ? theme.insertAdjacentHTML('beforebegin', prefs) : list.insertAdjacentHTML('beforeend', prefs);
  }
  function paintMe() {
    meEntries();
    const on = v => v ? '<em class="okk">On</em>' : '<em>Off</em>';
    $('dxMeQ').textContent = queue.length ? String(queue.length) : '';
    $('dxMeSig').innerHTML = mySig() ? '<em class="okk">Saved</em>' : '<em>Draw</em>';
    $('dxMeLock').innerHTML = on(!!lockCfg());
    $('dxMeMail').innerHTML = on(boot.mail !== false);
    $('dxMeRem').innerHTML = on(ls.get('shkRemind', true));
    document.querySelectorAll('#dxMe2 .eng-only').forEach(b => { b.hidden = !canClose(); });
  }
  const baseAcct = PtahApp.openAccount;
  PtahApp.openAccount = function () { try { paintMe(); } catch (e) { console.warn(e); } return baseAcct.apply(this, arguments); };

  // =====================================================================
  // events
  // =====================================================================
  document.addEventListener('click', async ev => {
    const t = ev.target;
    const dx = t.closest && t.closest('[data-dx]');
    if (dx) {
      const k = dx.dataset.dx;
      if (k !== 'lock' && k !== 'mail' && k !== 'remind') PtahApp.closeAccount();
      if (k === 'cal') return openCalendar();
      if (k === 're') return openRe();
      if (k === 'rep') return openReport();
      if (k === 'pend') return openPending();
      if (k === 'jobs') return openJobs();
      if (k === 'sig') return openSigPad();
      if (k === 'remind') {
        const v = !ls.get('shkRemind', true); ls.set('shkRemind', v);
        if (v && window.Notification && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) {} }
        return paintMe();
      }
      if (k === 'mail') {
        try { boot.mail = await api('mail_set', [boot.mail === false]); paintMe(); note(boot.mail ? 'Morning email on' : 'Morning email off'); } catch (e) { note(e.message); }
        return;
      }
      if (k === 'lock') {
        if (lockCfg()) { ls.set(lockKey(), null); paintMe(); return note('Lock off'); }
        try { await lockOn(); paintMe(); note('Lock on: the app asks for your fingerprint / face when it opens.', 5000); }
        catch (e) { note(e.message || 'Could not turn the lock on.', 6000); }
        return;
      }
    }
    const op = t.closest && t.closest('[data-open]');
    if (op) { const it = allItems.find(x => keyOf(x) === op.dataset.open); if (it) { Shk.closeScreen(); setTimeout(() => openModal(it), 60); } return; }
    const q = t.closest && t.closest('[data-dxq]');
    if (q) {
      const a = q.dataset.dxq, job = queue.find(j => j.id === q.dataset.id);
      if (a === 'run') { if (navigator.onLine === false) return note('Still no signal.'); queue.forEach(j => { j.error = ''; }); await queueRun(true); if (currentItem) openModal(currentItem); return; }
      if (a === 'nopdf' && job) { job.noPdf = true; job.error = ''; await queueSave(job); await queueRun(true); return drawPending(); }
      if (a === 'drop' && job) {
        if (!confirm(`Cancel your close of ${job.item.irNumber}? It stays open in the list.`)) return;
        await queueDel(job.id); render(); if (currentItem && keyOf(currentItem) === job.key) openModal(currentItem);
        if (onScreen('pending')) drawPending(); return;
      }
      if (a === 'clearlost') { ls.set('shkLost', []); return drawPending(); }
    }
    const sc = $('shkScreen');
    if (!sc || !sc.contains(t)) return;
    const day = t.closest('[data-day]'); if (day) { calSel = day.dataset.day; return drawCal(); }
    const cv = t.closest('[data-calv]'); if (cv) { calWeek = cv.dataset.calv === 'w'; return drawCal(); }
    const cm = t.closest('[data-cal]');
    if (cm) {
      const v = cm.dataset.cal;
      if (v === 'today') { const n = new Date(); calM = new Date(n.getFullYear(), n.getMonth(), 1); calSel = todayIso(); }
      else if (calWeek) { const d = new Date(calSel + 'T00:00:00'); d.setDate(d.getDate() + 7 * +v); calSel = isoOf(d); calM = new Date(d.getFullYear(), d.getMonth(), 1); }
      else calM = new Date(calM.getFullYear(), calM.getMonth() + +v, 1);
      return drawCal();
    }
    const re = t.closest('[data-re]'); if (re) { reMine = re.dataset.re === '1'; return drawRe(); }
    const rp = t.closest('[data-rep]'); if (rp) return makeReport(rp, rp.dataset.rep);
    const jb = t.closest('[data-job]');
    if (jb) {
      jb.disabled = true;
      try { note(String(await api(jb.dataset.job === 'mail' ? 'admin_morningTest' : 'admin_backupNow')), 5000); openJobs(); }
      catch (e) { note(e.message, 6000); jb.disabled = false; }
    }
  });
  // closing the full screen forgets which page was open
  const baseCloseScreen = Shk.closeScreen;
  Shk.closeScreen = function () { Shk.dxScreen = ''; return baseCloseScreen.apply(this, arguments); };

  // ---- start ----
  queueLoad().then(() => { if (PtahApp.engineer()) queueRun(); });
  if (navigator.onLine === false) offlinePill(true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { meEntries(); showLock(); }); else { meEntries(); showLock(); }
  const baseAfter = Shk.afterSignIn;
  Shk.afterSignIn = function () { queueRun(); return baseAfter && baseAfter.apply(this, arguments); };
  Object.assign(Shk, { openCalendar, openRe, openReport, openPending, openSigPad, queueRun, _dx: { queue: () => queue, boot: () => boot, weatherFor, photos: () => photos, paintPhotos: () => paintPhotos(), prevOf: it => prevOf(it), MAX_PHOTOS } });
})();
