#!/usr/bin/env node
/**
 * Petit serveur web pour héberger l'application (Node 24, aucune dépendance).
 *
 *   node server/index.mjs [--root dist] [--data data] [--port 8080]
 *
 * Variables d'environnement (prioritaires sur les options) :
 *   PORT               port d'écoute (8080) ; 0 en choisit un libre, annoncé au démarrage
 *   ROOT               dossier de l'application (dist)
 *   DATA_DIR           dossier des données (data) : app.db, project.json, projets/<nom>.json, backups/
 *   PUBLISH_PASSWORD   mot de passe de publication. Sans lui, la publication depuis
 *                      l'application est désactivée (on dépose project.json à la main).
 *   MAX_BODY_MB        taille maximale d'un projet publié (100)
 *   TRUST_PROXY        1 si un proxy est placé devant : l'IP du client est lue dans X-Forwarded-For.
 *                      À ne pas définir sans proxy, car n'importe qui pourrait alors choisir son IP.
 *   ADMIN_EMAIL, ADMIN_PASSWORD   créent le compte admin au premier démarrage, s'il n'existe pas.
 *
 * En production, placez ce serveur derrière un proxy HTTPS (nginx, Caddy, Traefik…).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { ensureAdmin } from './auth.mjs';

/** Options de la ligne de commande : --root dist --data data --port 8080 */
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || args.port || 8080);
const ROOT = path.resolve(process.env.ROOT || args.root || path.join(here, '..', 'dist'));
const DATA = path.resolve(process.env.DATA_DIR || args.data || path.join(here, '..', 'data'));
const PASSWORD = process.env.PUBLISH_PASSWORD || '';
const ONE_HOUR = 60 * 60 * 1000;

const app = createApp({
  root: ROOT,
  data: DATA,
  password: PASSWORD,
  maxBody: Number(process.env.MAX_BODY_MB || 100) * 1024 * 1024,
  trustProxy: process.env.TRUST_PROXY === '1'
});

const ADMIN_STATES = {
  created: 'compte créé',
  exists: 'compte existant',
  missing: 'AUCUN COMPTE : définir ADMIN_EMAIL et ADMIN_PASSWORD',
  invalid: 'AUCUN COMPTE : ADMIN_EMAIL ou ADMIN_PASSWORD invalide (8 caractères au moins, adresse libre)'
};
const adminState = await ensureAdmin(app.db, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

/** Toutes les heures : la copie du jour est faite au premier passage, puis plus rien jusqu'au lendemain. */
function periodicTasks() {
  try {
    app.purge();
    const file = app.backup();
    if (file) console.log(`[${new Date().toISOString()}] base sauvegardée : ${path.relative(DATA, file)}`);
  } catch (e) {
    console.error('Sauvegarde de la base impossible :', e.message);
  }
}

app.server.listen(PORT, () => {
  // Avec le port 0, le système en choisit un libre : c'est celui-là qu'il faut annoncer
  console.log(`Cartopoint : http://localhost:${app.server.address().port}`);
  console.log(`  application : ${ROOT}`);
  console.log(`  données     : ${DATA}`);
  console.log(`  publication : ${PASSWORD ? 'activée' : 'désactivée (définir PUBLISH_PASSWORD)'}`);
  console.log(`  admin       : ${ADMIN_STATES[adminState]}`);
  periodicTasks();
  setInterval(periodicTasks, ONE_HOUR).unref();
});

/** docker stop envoie SIGTERM : on ferme la base proprement au lieu d'attendre d'être tué. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
