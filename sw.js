const CACHE_NAME = 'rimal-pwa-cache-v3'; // 🚀 تم رفع الإصدار لتحديث الكاش فوراً ومنع التعليق
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

// استراتيجية جلب ذكية: محاولة جلب أحدث نسخة من الإنترنت أولاً، وفي حال عدم وجود إنترنت يتم استخدام الكاش
self.addEventListener('fetch', event => {
    // استثناء طلبات الـ API الخاصة بالباك إند لضمان عدم تخزين بيانات الحجوزات مؤقتاً
    if (event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // إذا نجح الاتصال بالإنترنت، نقوم بتحديث الكاش بالنسخة الجديدة تلقائياً
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => {
                // إذا لم يتوفر إنترنت، يتم جلب الملف من الكاش كخيار بديل
                return caches.match(event.request);
            })
    );
});
