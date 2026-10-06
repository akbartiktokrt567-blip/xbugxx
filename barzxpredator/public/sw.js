const CACHE_NAME = 'executor-cache-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/login',
  '/dashboard',
  '/admin',
  '/css/style.css',
  '/js/login.js',
  '/js/dashboard.js',
  '/js/admin.js',
  '/manifest.json',
  '/img/icon-192.png',
  '/img/icon-512.png'
];

// Install Service Worker and cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate event (clean up old caches)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event (Network first fallback to cache for API/pages, cache first for static files)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // If requesting API endpoints or logs, bypass cache entirely or do network-only
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first strategy for HTML pages to ensure they are up to date
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .catch(() => {
          return caches.match(e.request);
        })
    );
    return;
  }

  // Cache-first strategy for static resources (JS, CSS, Images, Fonts)
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        // Cache newly fetched assets dynamically if they are from our origin
        if (networkResponse.status === 200 && url.origin === self.location.origin) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, cacheCopy);
          });
        }
        return networkResponse;
      });
    })
  );
});
