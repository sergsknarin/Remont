// Офлайн-кэш. При каждом патче менять номер версии.
// Нет какого-то файла (базы грузятся в телефон отдельно) — пропускаем, установка не ломается.
const CACHE = 'repair-ref-0.15.0';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'photos.js', 'errors.js', 'obdcodes.js', 'data/obd.js', 'data/errors.js', 'import.js', 'docs.js', 'docadd.js', 'to.js', 'backup.js', 'case.js', 'data/to.js', 'data/docs.js', 'data/docs-pages.js', 'lib/pdf.js', 'lib/pdf.worker.js', 'data/base.js', 'manifest.json', 'icon.svg', 'icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {}))))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Файлы из docs/ (маленькие PDF внутри программы) кладём в кэш при первом открытии — дальше открываются без сети
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
  if (resp.ok && new URL(e.request.url).pathname.includes('/docs/')) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
  return resp;
}))));
