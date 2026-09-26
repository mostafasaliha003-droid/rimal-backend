const CACHE_NAME = 'rimal-pwa-cache-v7';
const OFFLINE_URL = '/offline.html';
const MAX_ASSET_ENTRIES = 40;
const DYNAMIC_PATHS = ['/checkout', '/account', '/loyalty', '/payment'];

function isDynamicPath(pathname) {
    return DYNAMIC_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
}

function isCacheableAsset(request, response) {
    const url = new URL(request.url);
    return response.ok
        && response.type === 'basic'
        && url.pathname.startsWith('/assets/')
        && /\.(?:js|css|woff2?)$/i.test(url.pathname);
}

async function trimAssetCache(cache) {
    const entries = (await cache.keys()).filter(request => /\/assets\/.*\.(?:js|css|woff2?)$/i.test(new URL(request.url).pathname));
    const staleEntries = entries.slice(0, Math.max(0, entries.length - MAX_ASSET_ENTRIES));
    await Promise.all(staleEntries.map(request => cache.delete(request)));
}

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([
        OFFLINE_URL,
        '/icon-192.png',
        '/icon-512.png'
    ])));
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(name => name.startsWith('rimal-pwa-cache-') && name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/') || isDynamicPath(url.pathname)) return;

    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
        return;
    }

    if (!url.pathname.startsWith('/assets/') || !/\.(?:js|css|woff2?)$/i.test(url.pathname)) return;

    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        const response = await fetch(event.request);
        if (isCacheableAsset(event.request, response)) {
            await cache.put(event.request, response.clone());
            await trimAssetCache(cache);
        }
        return response;
    }));
});