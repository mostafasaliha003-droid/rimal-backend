const CACHE_NAME = 'rimal-pwa-cache-v2'; // 🚀 تم رفع الإصدار لتحديث الكاش فوراً
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
    self.skipWaiting(); // 🚀 تفعيل التحديث الجديد فوراً دون انتظار إغلاق المتصفح
});

// تنظيف الكاش القديم عند التحديث
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('🗑️ تم حذف الكاش القديم:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
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
