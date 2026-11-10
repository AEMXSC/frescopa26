/* eslint-env serviceworker */
/* eslint-disable no-restricted-globals -- self is the worker global */
/* Fréscopa Roast Bar service worker: keeps the kiosk working offline.
 *  - App shell (HTML/JS/CSS/fonts/logos): stale-while-revalidate
 *  - Content API (sc-api, da-sc): network-first, falls back to the last menu
 *  - Product images (EDS media): cache-first
 * Bump VERSION to force a fresh shell on every kiosk.
 */
const VERSION = 'roast-bar-v1';
const SHELL = [
  '/kiosk/index.html',
  '/kiosk/kiosk.css',
  '/kiosk/kiosk.js',
  '/kiosk/data.js',
  '/kiosk/views.js',
  '/kiosk/manifest.webmanifest',
  '/styles/brand.css',
  '/styles/fonts.css',
  '/icons/frescopa-logo-light.svg',
  '/media/frescopa-logo.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
];
const API_HOSTS = ['sc-api.adobeaem.workers.dev', 'da-sc.adobeaem.workers.dev'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp.ok) cache.put(request, resp.clone());
  return resp;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((resp) => {
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(request));
  } else if (url.origin === self.location.origin && /\/media_[0-9a-f]+\./.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === self.location.origin || url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
