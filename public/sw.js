// v14 SECURITY (axis-v8): لا تخزين مؤقت لصفحات التنقل (navigate) نهائياً —
// الصفحات تحمل جلسات مصادقة، وتخزينها يعني إمكانية ظهورها بعد الخروج
// أو لمستخدم آخر على نفس الجهاز. الكاش يقتصر على الأصول الثابتة فقط.
// v15: رفع رقم الإصدار يجبر كل الأجهزة على استبدال عامل الخدمة القديم
// ومسح أي كاش متبقٍ من النسخ السابقة تلقائياً عند أول زيارة.
var CACHE_NAME = 'axis-v8';
var STATIC_ASSETS = [
  '/manifest.json',
  '/logo.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; }).map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  // لا تدخل أبداً في تداخل طلبات الـ API — جلسات مصادقة
  if (event.request.url.indexOf('/api/') !== -1) return;

  // v14: صفحات التنقل تُجلب من الشبكة حصراً — بلا تخزين ولا fallback من كاش قديم
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
    return;
  }

  // الأصول الثابتة فقط: كاش أولاً ثم شبكة (خطوط/أيقونات/شعارات)
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone).catch(function() {});
          });
        }
        return response;
      });
    })
  );
});
