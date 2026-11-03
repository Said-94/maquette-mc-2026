/*
 * Service worker de Moto's Cool : visites suivantes plus rapides et consultation hors ligne.
 * - Pages HTML : réseau d'abord, puis cache, puis page « hors ligne ».
 * - Fichiers du site (polices, icônes, styles, scripts, images, modèles 3D .glb) : cache d'abord.
 *   Les .glb ne sont pas préchargés : ils sont mis en cache à la première visite qui les demande.
 * - Bibliothèques cdnjs et jsdelivr (GSAP, Leaflet, Three.js, Lenis) : mises en cache seulement si la réponse est
 *   lisible (CORS, jamais « opaque ») et dans un cache limité en nombre d'entrées.
 * - API Adresse, fonds de carte OpenStreetMap, proxy de l'assistant IA : jamais mis en cache.
 * Changer VERSION à chaque mise en ligne pour renouveler le cache.
 */
const VERSION = 'v2-4-2026-11-03';
// Préfixe « mc2- » : cette version partage l'adresse said-94.github.io avec la première maquette,
// ses caches ne doivent pas effacer ceux de l'autre (et inversement).
const PREFIX = 'mc2-';
const STATIC = `${PREFIX}static-${VERSION}`;
const PAGES = `${PREFIX}pages-${VERSION}`;
const CDN = `${PREFIX}cdn-${VERSION}`;
const CDN_MAX = 24;

const ZONES = ['vitry-sur-seine', 'ivry-sur-seine', 'villejuif', 'creteil', 'choisy-le-roi', 'maisons-alfort', 'alfortville', 'paris', 'massy'];
const SERVICES = ['entretien', 'reparation', 'depannage', 'freinage-pneus', 'scooters'];
const PRECACHE_PAGES = ['./', 'index.html', 'mentions-legales.html', 'confidentialite.html',
  ...ZONES.map(z => `zones/${z}.html`), ...SERVICES.map(s => `services/${s}.html`)];
const PRECACHE_STATIC = [
  'manifest.webmanifest', 'assets/pages.css', 'assets/fonts/fonts.css', 'assets/assistant.js', 'assets/site-bike.js', 'assets/rdv-mail.js',
  'assets/icons/favicon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/apple-touch-icon.png',
  ...['orbitron-latin-600', 'orbitron-latin-800', 'orbitron-latin-900', 'nunito-latin-400', 'nunito-latin-600', 'nunito-latin-800',
    'nunito-latin-ext-400', 'nunito-latin-ext-600', 'nunito-latin-ext-800'].map(f => `assets/fonts/${f}-normal.woff2`)
];

const OFFLINE_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hors ligne – Moto's Cool</title><meta name="robots" content="noindex"><meta name="theme-color" content="#0a0a0c">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0e10;color:#f2f2f2;font-family:system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
b{color:#ef4136}a{display:inline-block;margin-top:18px;background:#d42a21;color:#fff;text-decoration:none;font-weight:800;padding:14px 26px;border-radius:999px}p{color:#a3a3ad;max-width:420px}</style></head>
<body><main><h1><b>MOTO'S</b> COOL</h1><p>Vous êtes hors ligne et cette page n'a pas encore été enregistrée. Pour un dépannage ou un rendez-vous, appelez-nous :</p>
<a href="tel:+33143762638">01 43 76 26 38</a><p>15 ter avenue du Président Salvador Allende, 94400 Vitry-sur-Seine<br>Lun–ven 9h30–13h · 14h–18h30 · sam 10h–13h · 14h–18h30</p></main></body></html>`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const [s, p] = await Promise.all([caches.open(STATIC), caches.open(PAGES)]);
    await Promise.all([
      s.addAll(PRECACHE_STATIC),
      // Une page manquante ne doit pas faire échouer l'installation
      ...PRECACHE_PAGES.map(u => p.add(u).catch(() => {}))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [STATIC, PAGES, CDN];
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function networkFirstPage(req) {
  const c = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') c.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await c.match(req, { ignoreSearch: true }) || await c.match(new URL(req.url).pathname.endsWith('/') ? 'index.html' : req, { ignoreSearch: true });
    return hit || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req, cacheName, max, event) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Jamais de réponse opaque (taille inconnue, quota gonflé) : uniquement des réponses lisibles.
  // La réponse part tout de suite ; la copie est mise en cache en arrière-plan (gros modèles .glb).
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
    const job = c.put(req, res.clone()).then(() => (max ? trim(cacheName, max) : null)).catch(() => {});
    if (event) event.waitUntil(job);
  }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      event.respondWith(networkFirstPage(req));
    } else if (/\.(woff2|png|jpg|jpeg|webp|svg|css|js|webmanifest|geojson|glb)$/.test(url.pathname) && !url.pathname.endsWith('/sw.js')) {
      event.respondWith(cacheFirst(req, STATIC, 0, event));
    }
    return;
  }
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req, CDN, CDN_MAX, event).catch(() => Response.error()));
  }
  // Autres origines (api-adresse.data.gouv.fr, tile.openstreetmap.org, proxy IA…) : pas d'interception
});
