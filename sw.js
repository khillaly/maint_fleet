// sw.js — CHUB Equipment Fleet PM (merged + fixed)
// v6 — Adds Firebase + Firestore protection and keeps Google Sheets protection.

const CACHE_NAME = 'chub-ref-cache-v9-supabase'; // 🔼 Bumped to v9 to force clear all old Firebase/jQuery caches

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

// 1. Install — cache the app files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('✅ Service Worker v6: caching assets');
                return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                    // Some CDN assets might fail (offline first run) — do not block install
                    console.warn('⚠️ Some assets failed to cache:', err);
                });
            })
    );
    self.skipWaiting(); // take over immediately
});

// 2. Activate — delete old caches (this clears v5 and earlier)
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. Fetch — cache-first for assets, NEVER cache live API calls
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // ⛔ Do NOT cache live Google Sheets calls (old protection — kept)
    if (url.includes('script.google.com')) {
        return;
    }

    // ⛔ Do NOT cache Supabase API calls (NEW — CRITICAL for Supabase)
    if (
        url.includes('supabase.co') || 
        url.includes('supabase.in') ||
        url.includes('supabase.net')
    ) {
        return; // Let the network handle it directly so you always get fresh data
    }

    // ⛔ Do NOT cache jQuery CDN (fixes the jQuery 3.4.1 caching error)
    if (url.includes('code.jquery.com') || url.includes('jquery')) {
        return;
    }

    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // 🌟 FIX: Ignore chrome-extension:// and other weird protocols
    if (!url.startsWith('http')) {
        return; 
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) return response; // cache hit

                // Network fallback
                return fetch(event.request).then(networkResponse => {
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        return networkResponse;
                    }
                    // Dynamically cache new same-origin assets
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                    return networkResponse;
                }).catch(() => {
                    // Offline fallback: only for HTML navigation
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
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
