// sw.js — CHUB Equipment Fleet PM
// v10 — Network-first for HTML (always latest deployed version),
//       cache-first only for pinned CDN libraries, Supabase never cached.

const CACHE_NAME = 'chub-ref-cache-v10-fresh'; // 🔼 bumped: clears every older cache

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './chub-logo.png',
    './icon-192.png',
    './icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/forge/1.3.1/forge.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

// 1. Install — pre-cache files (for offline use), activate immediately
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✅ Service Worker v10: caching assets');
                return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                    console.warn('⚠️ Some assets failed to cache:', err);
                });
            })
    );
    self.skipWaiting();
});

// 2. Activate — delete ALL old caches and take control of open pages
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names.map(name => {
                    if (name !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', name);
                        return caches.delete(name);
                    }
                })
            ))
            .then(() => self.clients.claim())
    );
});

// 3. Messages from the page (optional helpers)
self.addEventListener('message', event => {
    const type = event.data && event.data.type;
    if (type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (type === 'CLEAR_CACHES') {
        event.waitUntil(
            caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
        );
    }
});

// 4. Fetch
self.addEventListener('fetch', event => {
    const req = event.request;
    const url = req.url;

    // Only handle GET requests
    if (req.method !== 'GET') return;

    // Ignore chrome-extension:// and other non-http protocols
    if (!url.startsWith('http')) return;

    // ⛔ Never cache live API calls
    if (url.includes('script.google.com')) return;
    if (url.includes('supabase.co') || url.includes('supabase.in') || url.includes('supabase.net')) return;
    if (url.includes('code.jquery.com') || url.includes('jquery')) return;

    const sameOrigin = new URL(url).origin === self.location.origin;

    // 🌟 A) HTML pages / navigation → NETWORK-FIRST
    //    Guarantees users get the newest deployed version.
    //    Cache is used only when the device is offline.
    if (req.mode === 'navigate' || req.destination === 'document') {
        event.respondWith(
            fetch(req, { cache: 'no-store' })
                .then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
                    }
                    return networkResponse;
                })
                .catch(() =>
                    caches.match(req).then(r => r || caches.match('./index.html') || caches.match('./'))
                )
        );
        return;
    }

    // 🌟 B) Same-origin files (logo, icons, manifest, version.json, etc.)
    //    → STALE-WHILE-REVALIDATE: fast, but refreshed in the background.
    if (sameOrigin) {
        event.respondWith(
            caches.match(req).then(cached => {
                const networkFetch = fetch(req)
                    .then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                            const copy = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                        }
                        return networkResponse;
                    })
                    .catch(() => cached);
                return cached || networkFetch;
            })
        );
        return;
    }

    // 🌟 C) Third-party CDN libraries (version-pinned) → CACHE-FIRST
    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req)
                .then(networkResponse => {
                    // Cache successful CDN responses (including opaque/cors ones)
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                    }
                    return networkResponse;
                })
                .catch(() => cached);
        })
    );
});

// ===== PUSH NOTIFICATIONS (WhatsApp-style) =====
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'CHUB Maint Fleet', body: event.data ? event.data.text() : '' }; }

  event.waitUntil((async () => {
    // taskbar badge, even when the app is closed
    try {
      if (self.navigator && self.navigator.setAppBadge && data.unreadCount != null) {
        if (data.unreadCount > 0) await self.navigator.setAppBadge(data.unreadCount);
        else await self.navigator.clearAppBadge();
      }
    } catch (e) {}

    // if the app is open AND focused, the app itself already shows it
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = wins.some(w => w.focused && w.visibilityState === 'visible');
    if (focused) { wins.forEach(w => w.postMessage({ type: 'push-received' })); return; }

    await self.registration.showNotification(data.title || 'CHUB Maint Fleet', {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'chub-' + (data.notifId || Date.now()),
      renotify: true,
      requireInteraction: data.priority === 'urgent',   // urgent broadcasts stay until clicked
      data: { url: data.url || './', notifId: data.notifId || '' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      await wins[0].focus();
      wins[0].postMessage({ type: 'notification-click', notifId: d.notifId });
    } else {
      await self.clients.openWindow(d.url || './');
    }
  })());
});
