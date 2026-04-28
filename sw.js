var CACHE = 'fika-v5';
var FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/data.js',
  '/offline-queue.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=DM+Sans:wght@300;400;500&display=swap'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(FILES.filter(function(f){ return !f.startsWith('http'); }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
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
