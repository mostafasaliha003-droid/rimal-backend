const CACHE_NAME = 'rimal-pwa-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/logo.jpg'
];

// تثبيت ملفات الكاش (التخزين المؤقت)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✅ تم حفظ ملفات تطبيق شركة الرمال في الكاش');
                return cache.addAll(urlsToCache);
            })
    );
});

// جلب البيانات بسرعة من الكاش أو من الإنترنت
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // إرجاع الملف من الكاش إذا وجد، أو جلبه من السيرفر
                return response || fetch(event.request);
            })
    );
});
