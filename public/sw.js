// axis1 — Service Worker (v70 SECURITY / axis-v9)
// ---------------------------------------------------------------
// القواعد الأمنية الثابتة:
//   1) لا تخزين مؤقت لطلبات /api/ نهائياً — كلها جلسات مصادقة وبيانات حية.
//   2) لا تخزين مؤقت لصفحات التنقل (navigate) نهائياً — الصفحات تحمل جلسات
//      مصادقة، وتخزينها يعني إمكانية ظهورها بعد الخروج أو لمستخدم آخر
//      على نفس الجهاز. الصفحات تُجلب من الشبكة حصراً.
//   3) الكاش يقتصر على الأصول الثابتة نفس المصدر (response.type === 'basic')
//      وبحالة 200 فقط — لا تخزين ردود الأخطاء ولا الردود من مصادر خارجية.
//   4) طلبات غير GET (POST/PUT/PATCH/DELETE) تمر مباشرة — لا تدخل منطق
//      الكاش إطلاقاً.
//   5) سقف لعدد مدخلات الكاش (trim) لمنع نمو التخزين بلا حدود على الأجهزة.
// رفع CACHE_NAME يجبر كل الأجهزة على استبدال عامل الخدمة القديم ومسح أي
// كاش متبقٍ من النسخ السابقة تلقائياً عند أول زيارة بعد النشر.

var CACHE_NAME = 'axis-v9';
var MAX_CACHE_ENTRIES = 80;
var STATIC_ASSETS = [
  '/manifest.json',
  '/logo.png'
];

// تقليم الكاش: حذف أقدم المدخلات عند تجاوز السقف
// (Cache API يعيد المفاتيح بترتيب الإضافة — الأقدم أولاً)
function trimCache(cacheName, maxEntries) {
  caches.open(cacheName).then(function(cache) {
    cache.keys().then(function(keys) {
      var excess = keys.length - maxEntries;
      if (excess <= 0) return;
      Promise.all(keys.slice(0, excess).map(function(request) {
        return cache.delete(request);
      })).catch(function() {});
    }).catch(function() {});
  }).catch(function() {});
}

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // إضافة كل أصل على حدة: فشل أصل واحد لا يُسقط تثبيت عامل الخدمة كله
      return Promise.all(STATIC_ASSETS.map(function(url) {
        return cache.add(url).catch(function() {});
      }));
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
  var request = event.request;

  // (4) غير GET يمر مباشرة للشبكة بلا أي تدخل
  if (request.method !== 'GET') return;

  // (1) لا تدخل أبداً في تداخل طلبات الـ API — جلسات مصادقة وبيانات حية
  if (request.url.indexOf('/api/') !== -1) return;

  // (2) صفحات التنقل تُجلب من الشبكة حصراً — بلا تخزين ولا fallback من كاش قديم
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }

  // (3) الأصول الثابتة فقط: كاش أولاً ثم شبكة (خطوط/أيقونات/شعارات/chunks)
  event.respondWith(
    caches.match(request, { ignoreSearch: false }).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, responseClone).catch(function() {});
            trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
          });
        }
        return response;
      });
    })
  );
});
