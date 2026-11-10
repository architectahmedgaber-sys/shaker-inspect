// Shaker Inspect service worker: the app opens fast and installs; data always comes live from the sheet.
const VERSION = 'shk-v16';
const SHELL = ['./', 'index.html', 'tracker.html', 'app.css', 'app-api.js', 'app-ui.js', 'app-nav.js', 'app-screens.js', 'app-daily.js', 'app-extras.js', 'app-acc.js', 'vendor/xlsx.full.min.js', 'app-social.js', 'ios.css', 'skins.css', 'concept-c.css', 'config.js', 'version.js', 'app-update.js', 'manifest.webmanifest', 'theme.css', 'icons/icon-192.png', 'icons/icon-512.png'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                              // API calls (POST) are never cached
  const url = new URL(req.url);
  if (url.origin === location.origin) {                           // app files: network first, cache when offline
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  } else if (CDN.test(req.url)) {                                 // fixed-version libraries and fonts: cache first
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const c = res.clone(); caches.open(VERSION).then(x => x.put(req, c)); return res; })));
  }
});
