// ============================================================
// SERVICE WORKER — Inventaire Salon PWA
// ============================================================
// Stratégie :
//   - App shell (HTML, fonts, scanner lib) → Cache First
//   - API Google Apps Script → Network Only (pas de cache)
//   - Mise à jour automatique quand une nouvelle version est déployée
// ============================================================

const CACHE_NAME = 'inventaire-salon-v1';

// Fichiers à pré-cacher au moment de l'installation
const APP_SHELL = [
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap'
];

// ── INSTALL : pré-cache de l'app shell ──
self.addEventListener('install', event => {
  console.log('[SW] Install — cache app shell');
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
  if (url.hostname === 'drive.google.com') {
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

  // App shell + static assets → Cache First, network fallback
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          // Cache les réponses valides pour usage futur
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        // Fallback offline : retourner la page principale
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});
