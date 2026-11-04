/**
 * Pages des espaces et réglages pour les robots. Le jeton d'un lien reste dans le fragment de
 * l'adresse : le serveur ne le voit jamais, et une seule page sert pour tous les liens.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { send, sendFile } from '../http.mjs';

const PAGES = {
  '/prof': 'prof.html',
  '/admin': 'admin.html',
  // Devient la page d'accueil, à l'adresse /, à l'étape 10
  '/accueil': 'accueil.html',
  '/invitation': 'compte.html',
  '/reinitialisation': 'compte.html'
};

const PAGES_WITH_ID = {
  '/prof/cours/:id': 'prof-cours.html',
  '/prof/lancements/:id': 'prof-lancement.html',
  '/c/:code': 'eleve.html'
};

/** Le service worker de la page élève, avec sa version : quand la page change, il change, et les téléphones se mettent à jour. */
async function sendWorker(res, root) {
  let worker, page;
  try {
    [worker, page] = await Promise.all([readFile(path.join(root, 'sw.js'), 'utf8'), readFile(path.join(root, 'eleve.html'))]);
  } catch {
    return send(res, 404, 'Introuvable');
  }
  const version = createHash('sha256').update(worker).update(page).digest('hex').slice(0, 16);
  send(res, 200, worker.replaceAll('__VERSION__', version), 'text/javascript; charset=utf-8', { 'Cache-Control': 'no-cache' });
}

export function pageRoutes(router, root) {
  // Avant /c/:code, qui prendrait « sw.js » pour un code
  router.add('GET', '/c/sw.js', (req, res) => sendWorker(res, root));
  for (const [route, file] of Object.entries(PAGES)) {
    router.add('GET', route, (req, res) => sendFile(req, res, path.join(root, file), 'no-cache'));
  }
  // Une seule page pour tous les cours, les lancements et les codes : elle lit l'identifiant dans l'adresse
  for (const [route, file] of Object.entries(PAGES_WITH_ID)) {
    router.add('GET', route, (req, res) => sendFile(req, res, path.join(root, file), 'no-cache'));
  }
  router.add('GET', '/robots.txt', (req, res) => send(res, 200, 'User-agent: *\nDisallow: /\n'));
}
