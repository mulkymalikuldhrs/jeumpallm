/* ═══════════════════════════════════════════════════════════
   Jeumpa LLM Service Worker v1
   Cache-first for static assets, Network-first for API calls
═══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'jeumpallm-v1';
const STATIC_ASSETS = [
  '/dashboard/',
  '/dashboard/index.html',
  '/dashboard/manifest.json'
];

const API_PREFIXES = ['/health', '/status', '/models', '/providers', '/v1/', '/chat', '/mcp'];

function isApiRequest(url) {
  return API_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
}

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    // Network-first for API calls
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cloned);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || new Response(JSON.stringify({ error: 'Offline', status: 'unavailable' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
  } else {
    // Cache-first for static assets
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cloned);
            });
          }
          return response;
        }).catch(() => {
          // Fallback for navigation
          if (event.request.mode === 'navigate') {
            return caches.match('/dashboard/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
  }
});
