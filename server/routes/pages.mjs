/**
 * Pages des espaces et réglages pour les robots. Le jeton d'un lien reste dans le fragment de
 * l'adresse : le serveur ne le voit jamais, et une seule page sert pour tous les liens.
 */
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

export function pageRoutes(router, root) {
  for (const [route, file] of Object.entries(PAGES)) {
    router.add('GET', route, (req, res) => sendFile(req, res, path.join(root, file), 'no-cache'));
  }
  // Une seule page pour tous les cours, les lancements et les codes : elle lit l'identifiant dans l'adresse
  for (const [route, file] of Object.entries(PAGES_WITH_ID)) {
    router.add('GET', route, (req, res) => sendFile(req, res, path.join(root, file), 'no-cache'));
  }
  router.add('GET', '/robots.txt', (req, res) => send(res, 200, 'User-agent: *\nDisallow: /\n'));
}
