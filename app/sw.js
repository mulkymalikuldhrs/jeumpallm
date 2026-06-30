const CACHE_NAME = 'jeumpallm-v1';
const STATIC_ASSETS = [
  '/app/',
  '/app/index.html',
  '/app/style.css',
  '/app/app.js',
  '/app/api.js',
  '/app/manifest.json',
  '/app/icons/icon-192.svg',
  '/app/icons/icon-512.svg',
];

const API_PREFIXES = [
  '/v1/', '/auth/', '/mcp', '/billing/', '/donate/', '/santri/', '/circuit-breakers', '/health'
];

const OFFLINE_JSON = JSON.stringify({ error: 'Offline', status: 'unavailable' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  if (isApiRequest(path)) {
    event.respondWith(networkFirstWithJsonFallback(request));
    return;
  }

  if (isStaticAsset(path)) {
    event.respondWith(cacheFirstWithNetworkUpdate(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationFallback(request));
    return;
  }

  event.respondWith(cacheFirstWithNetworkUpdate(request));
});

function isApiRequest(path) {
  return API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isStaticAsset(path) {
  return STATIC_ASSETS.some((asset) => path === asset);
}

async function networkFirstWithJsonFallback(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(OFFLINE_JSON, {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirstWithNetworkUpdate(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response(OFFLINE_JSON, {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function navigationFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match('/app/index.html');
    return cached || new Response(OFFLINE_JSON, {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
