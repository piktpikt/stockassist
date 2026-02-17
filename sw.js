// ============================================================
// SERVICE WORKER — Inventaire Salon PWA v3
// ============================================================
// Stratégie :
//   - index.html → Network First (toujours la dernière version)
//   - Libs & fonts → Cache First (stables)
//   - API Google Apps Script → Network Only (pas de cache)
//   - Mise à jour automatique quand une nouvelle version est déployée
// ============================================================

const CACHE_NAME = 'inventaire-salon-v3';

// Fichiers à pré-cacher au moment de l'installation
const APP_SHELL = [
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap'
];

// ── INSTALL : pré-cache de l'app shell ──
self.addEventListener('install', event => {
  console.log('[SW] Install — cache v3');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // Activer immédiatement
  );
});

// ── ACTIVATE : nettoyage des anciens caches ──
self.addEventListener('activate', event => {
  console.log('[SW] Activate — cleanup old caches');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // Prendre le contrôle immédiatement
  );
});

// ── FETCH : stratégie par type de requête ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls → Network Only (jamais cacher les données métier)
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Drive thumbnails (photos produits) → Network First, cache fallback
  if (url.hostname === 'drive.google.com' || url.hostname.includes('googleusercontent.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // index.html & navigations → Network First (toujours la dernière version)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Update cache with latest version
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline: serve cached version
          return caches.match(event.request).then(cached => cached || caches.match('/index.html'));
        })
    );
    return;
  }

  // Libs, fonts, static assets → Cache First (they don't change)
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});
