#!/usr/bin/env node
/**
 * Petit serveur web pour héberger l'application (Node 24, aucune dépendance).
 *
 *   node server/index.mjs [--root dist] [--data data] [--port 8080]
 *
 * Variables d'environnement (prioritaires sur les options) :
 *   PORT               port d'écoute (8080)
 *   ROOT               dossier de l'application (dist)
 *   DATA_DIR           dossier des données (data) : app.db, project.json, projets/<nom>.json, backups/
 *   PUBLISH_PASSWORD   mot de passe de publication. Sans lui, la publication depuis
 *                      l'application est désactivée (on dépose project.json à la main).
 *   MAX_BODY_MB        taille maximale d'un projet publié (100)
 *   TRUST_PROXY        1 si un proxy est placé devant : l'IP du client est lue dans X-Forwarded-For.
 *                      À ne pas définir sans proxy, car n'importe qui pourrait alors choisir son IP.
 *
 * En production, placez ce serveur derrière un proxy HTTPS (nginx, Caddy, Traefik…).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

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

/** Vérifié toutes les heures : la copie du jour est faite au premier passage, puis plus rien jusqu'au lendemain. */
function dailyBackup() {
  try {
    const file = app.backup();
    if (file) console.log(`[${new Date().toISOString()}] base sauvegardée : ${path.relative(DATA, file)}`);
  } catch (e) {
    console.error('Sauvegarde de la base impossible :', e.message);
  }
}

app.server.listen(PORT, () => {
  console.log(`Inventaire botanique : http://localhost:${PORT}`);
  console.log(`  application : ${ROOT}`);
  console.log(`  données     : ${DATA}`);
  console.log(`  publication : ${PASSWORD ? 'activée' : 'désactivée (définir PUBLISH_PASSWORD)'}`);
  dailyBackup();
  setInterval(dailyBackup, ONE_HOUR).unref();
});

/** docker stop envoie SIGTERM : on ferme la base proprement au lieu d'attendre d'être tué. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
