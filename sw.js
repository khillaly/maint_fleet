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
// ============================================================
// ===== WEB PUSH EVENT LISTENERS (ADDED FOR BACKGROUND NOTIFICATIONS) =====
// ============================================================

// 1. Handle incoming push messages
self.addEventListener('push', function(event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'New Notification', body: event.data.text() };
    }
  }

  const title = data.title || 'CHUB Maint Fleet';
  const options = {
    body: data.body || 'You have a new update.',
    icon: data.icon || './icon-192.png',
    badge: './icon-192.png', // Monochrome icon for the notification
    data: {
      url: data.url || '/', // URL to open when notification is clicked
      ...data.data
    },
    // Optional: add actions
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  // 2. Show the notification
  event.waitUntil(
    self.registration.showNotification(title, options)
  );

  // 3. Update the app badge (WhatsApp-style numeric count)
  // The badge API is available in the service worker.
  if ('setAppBadge' in navigator) {
    // You can pass a number if the push payload includes an unread count.
    // If not, just set a dot (1) as a simple alert.
    const unreadCount = data.unreadCount || 1; // Default to 1 if not provided
    navigator.setAppBadge(unreadCount).catch(err => {
      console.warn('Could not set app badge:', err);
    });
  }
});

// 4. Handle notification click
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Check if a window with the target URL is already open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// 5. Handle notification close (optional: clear badge if no other notifications)
self.addEventListener('notificationclose', function(event) {
  // You might want to decrement the badge count here.
  // For simplicity, we'll leave the badge until the app is opened.
});

