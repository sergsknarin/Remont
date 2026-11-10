// Офлайн-кэш (0.16.1). Код программы — сначала из сети (обновления приходят сразу), без сети — из кэша.
// Базы, библиотеки и PDF (data/, lib/, docs/) — из кэша (большие, меняются редко). Чужие адреса (Яндекс) не трогаем.
const CACHE = 'repair-ref-0.30.0';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'photos.js', 'video.js', 'tabs.js', 'errors.js', 'obdcodes.js', 'data/obd.js', 'data/errors.js', 'import.js', 'docs.js', 'docadd.js', 'to.js', 'reg.js', 'backup.js', 'case.js', 'vk.js', 'sync.js', 'data/to.js', 'data/docs.js', 'data/docs-pages.js', 'lib/pdf.js', 'lib/pdf.worker.js', 'data/base.js', 'manifest.json', 'autoservice/', 'autoservice/index.html', 'garage/', 'garage/index.html', 'my/', 'my/index.html', 'app.html', 'icon.svg', 'icon-180.png'];
const BIG = /\/(data|lib|docs)\/|icon/;
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => fetch(new Request(f, { cache: 'reload' })).then(r => r.ok && c.put(f, r)).catch(() => {}))))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const put = r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; };
  if (BIG.test(u.pathname)) return e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(put)));
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(put).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match(u.pathname.includes('/autoservice/') ? 'autoservice/index.html' : u.pathname.includes('/garage/') ? 'garage/index.html' : u.pathname.includes('/my/') ? 'my/index.html' : 'index.html'))));
});
