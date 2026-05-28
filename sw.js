var CACHE = 'fika-v15';
var FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/auth.js',
  '/auth_logic.js',
  '/data.js',
  '/offline-queue.js',
  '/cutting.js',
  '/writeoff.js',
  '/loader.js',
  '/config.js',
  '/manifest.json',
  '/icon192.png',
  '/icon512.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // Поштучно, а не addAll: один отсутствующий/сбойный файл (напр. иконки
      // в DEV) не должен ронять кэширование всех остальных файлов.
      return Promise.all(FILES.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('SW: не удалось закэшировать', url, err);
        });
      }));
    }).then(function() {
      return self.skipWaiting(); // сразу активируем, не ждём закрытия вкладок
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Images: cache-first
  if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(resp) {
          return caches.open(CACHE).then(function(c) { c.put(e.request, resp.clone()); return resp; });
        });
      })
    );
    return;
  }
  // App files (JS/CSS/HTML): network-first so updates always apply
  if (url.match(/\.(js|css|html)$/i) || url.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(function(resp) {
        return caches.open(CACHE).then(function(c) { c.put(e.request, resp.clone()); return resp; });
      }).catch(function() { return caches.match(e.request); })
    );
    return;
  }
  // Firebase API: always network, never cache
  if (url.indexOf('firebasedatabase.app') !== -1) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Everything else: cache-first
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request);
    })
  );
});
