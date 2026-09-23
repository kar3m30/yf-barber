const CACHE_NAME = 'yf-barber-v3';

const STATIC_FILES = [
  '/',
  '/index.html',
  '/admin.html'
];

/* =========================
   تثبيت Service Worker
========================= */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

/* =========================
   تفعيل النسخة الجديدة
========================= */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* =========================
   الطلبات
========================= */

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  /*
    ملفات الموقع:
    نحاول الشبكة أولاً حتى تظهر آخر نسخة،
    ثم نستخدم الكاش إذا لم يوجد اتصال.
  */

  event.respondWith(
    fetch(request)
      .then(response => {
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(request, copy);
            });
        }

        return response;
      })
      .catch(() => {
        return caches.match(request)
          .then(cached => {
            return cached || caches.match('/');
          });
      })
  );
});

/* =========================
   Push Notifications
========================= */

self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data
      ? event.data.json()
      : {};
  } catch {
    data = {
      title: 'يوسف فاروق',
      body: event.data
        ? event.data.text()
        : 'لديك إشعار جديد.'
    };
  }

  const title =
    data.title ||
    'يوسف فاروق';

  const options = {
    body:
      data.body ||
      'لديك إشعار جديد.',
    icon:
      data.icon ||
      '/favicon.ico',
    badge:
      data.badge ||
      '/favicon.ico',
    dir: 'rtl',
    lang: 'ar',
    data: {
      url:
        data.url ||
        '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(
      title,
      options
    )
  );
});

/* =========================
   الضغط على الإشعار
========================= */

self.addEventListener(
  'notificationclick',
  event => {
    event.notification.close();

    const targetUrl =
      event.notification?.data?.url ||
      '/';

    event.waitUntil(
      clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      })
      .then(clientList => {

        for (const client of clientList) {
          if (
            'focus' in client &&
            client.url.includes(
              self.location.origin
            )
          ) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(
            targetUrl
          );
        }

        return null;
      })
    );
  }
);
