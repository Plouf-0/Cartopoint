/**
 * Service worker de la page élève (HOR-01). Sa portée est /c/ : il ne voit ni les pages des enseignants, ni l'accueil.
 *
 * Il garde la page et les polices, dans un cache propre à chaque version : le serveur remplace __VERSION__ à partir du contenu de la
 * page, ce qui déclenche la mise à jour dès que ce contenu change. Plans et photos sont téléchargés par la page (eleve/offline.js) :
 * elle peut ainsi montrer où elle en est. Il ne fait que les resservir.
 *
 * /api/ n'y passe jamais : rien de ce que le serveur répond à un élève ne doit rester ici, surtout pas la correction.
 */
const PAGE_CACHE_PREFIX = 'cartopoint-page-';
const PAGE_CACHE = `${PAGE_CACHE_PREFIX}__VERSION__`;
// Tous les codes partagent une seule page. Cette adresse la sert, et ne sera jamais un code : ils ont 6 caractères
const PAGE = '/c/page';
const FONTS = [
  '/assets/fonts/atkinson-hyperlegible-400.woff2',
  '/assets/fonts/atkinson-hyperlegible-400-italic.woff2',
  '/assets/fonts/atkinson-hyperlegible-700.woff2',
  '/assets/fonts/fraunces.woff2',
  '/assets/fonts/fraunces-italic.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll([PAGE, ...FONTS].map((url) => new Request(url, { cache: 'reload' }))))
      // Une nouvelle version n'attend pas : la page ouverte a déjà tout son code, et ne change qu'à son prochain chargement
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(PAGE_CACHE_PREFIX) && name !== PAGE_CACHE).map((name) => caches.delete(name))))
      // La page qui vient de l'installer passe par lui sans avoir à se recharger
      .then(() => self.clients.claim())
  );
});

/** La page gardée d'abord : sur le terrain, attendre un réseau faible serait pire que de ne pas en avoir. */
const pageFor = async (request) => (await caches.match(PAGE, { cacheName: PAGE_CACHE, ignoreVary: true })) ?? fetch(request);
const fileFor = async (request) => (await caches.match(request, { ignoreVary: true })) ?? fetch(request);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Les vidéos, jamais gardées, demandent des morceaux de fichier : Safari ne les lit pas s'ils passent par un service worker
  if (request.destination === 'video' || request.headers.has('range')) return;
  event.respondWith(request.mode === 'navigate' ? pageFor(request) : fileFor(request));
});
