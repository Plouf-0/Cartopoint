/**
 * Pages des espaces et réglages pour les robots. Le jeton d'un lien reste dans le fragment de
 * l'adresse : le serveur ne le voit jamais, et une seule page sert pour tous les liens.
 */
import path from 'node:path';
import { send, sendFile } from '../http.mjs';

const PAGES = {
  '/prof': 'prof.html',
  '/admin': 'admin.html',
  '/invitation': 'compte.html',
  '/reinitialisation': 'compte.html'
};

export function pageRoutes(router, root) {
  for (const [route, file] of Object.entries(PAGES)) {
    router.add('GET', route, (req, res) => sendFile(req, res, path.join(root, file), 'no-cache'));
  }
  router.add('GET', '/robots.txt', (req, res) => send(res, 200, 'User-agent: *\nDisallow: /\n'));
}
