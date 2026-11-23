// Shaker Inspect service worker: the app opens fast and installs; data always comes live from the sheet.
const VERSION = 'shk-v39';
const SHELL = ['./', 'index.html', 'tracker.html', 'app.css', 'app-api.js', 'app-ui.js', 'app-nav.js', 'app-screens.js', 'app-daily.js', 'app-extras.js', 'app-acc.js', 'vendor/xlsx.full.min.js', 'app-social.js', 'app-ir.js', 'app-irfill.js', 'app-polish.js', 'app-card.js', 'card.css', 'app-shaker-form.js', 'ios.css', 'skins.css', 'concept-c.css', 'config.js', 'version.js', 'app-update.js', 'app-refresh.js', 'app-live.js', 'app-search.js', 'manifest.webmanifest', 'theme.css', 'icons/icon-192.png', 'icons/icon-512.png'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                              // API calls (POST) are never cached
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // version.json must always come from the network (it is how the app learns a new version exists)
    if (/version\.json$/.test(url.pathname)) return;
    // app files: shown from the phone copy at once (fast start), refreshed from the network in the background.
    // The app notices the new version by itself (app-update.js) and reloads when it is safe.
    const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r && r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; });
    e.respondWith(caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => {
      if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
      return net.catch(() => caches.match('index.html'));
    }));
  } else if (CDN.test(req.url)) {                                 // fixed-version libraries and fonts: cache first
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const c = res.clone(); caches.open(VERSION).then(x => x.put(req, c)); return res; })));
  }
});
