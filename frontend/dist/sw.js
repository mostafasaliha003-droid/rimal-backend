const CACHE_NAME = 'rimal-pwa-cache-v6';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([OFFLINE_URL, '/icon-192.png', '/icon-512.png'])));
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('rimal-pwa-cache-') && name !== CACHE_NAME).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
        return;
    }
    if (!url.pathname.startsWith('/assets/') || !/\.(js|css|woff2?)$/.test(url.pathname)) return;
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok && response.type === 'basic') {
            await cache.put(event.request, response.clone());
            const keys = await cache.keys();
            const assets = keys.filter(request => new URL(request.url).pathname.startsWith('/assets/'));
            await Promise.all(assets.slice(0, Math.max(0, assets.length - 40)).map(request => cache.delete(request)));
        }
        return response;
    }));
});
