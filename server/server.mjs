#!/usr/bin/env node
/**
 * Petit serveur web pour héberger l'application (Node 18+, aucune dépendance).
 *
 *   node server/server.mjs [--root dist] [--data data] [--port 8080]
 *
 * Variables d'environnement (prioritaires sur les options) :
 *   PORT               port d'écoute (8080)
 *   ROOT               dossier de l'application (dist)
 *   DATA_DIR           dossier des projets (data) : project.json et projets/<nom>.json
 *   PUBLISH_PASSWORD   mot de passe de publication. Sans lui, la publication depuis
 *                      l'application est désactivée (on dépose project.json à la main).
 *   MAX_BODY_MB        taille maximale d'un projet publié (100)
 *
 * Routes :
 *   GET  /config.json               réglages lus par l'application au démarrage
 *   GET  /project.json              projet principal       (DATA_DIR/project.json)
 *   GET  /projets/<nom>.json        projets supplémentaires (adresse : /?projet=<nom>)
 *   PUT  /api/project[?projet=nom]  publication (en-tête « Authorization: Bearer <mot de passe> »)
 *   GET  /*                         fichiers de l'application
 *
 * À chaque publication, l'ancienne version est copiée dans DATA_DIR/backups/ (20 dernières).
 * En production, placez ce serveur derrière un proxy HTTPS (nginx, Caddy, Traefik…).
 */
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const MAX_BODY = Number(process.env.MAX_BODY_MB || 100) * 1024 * 1024;
const KEEP_BACKUPS = 20;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/i;

/** Fichier de données d'un projet (« principal » si name est vide). */
function projectFile(name) {
  if (!name) return path.join(DATA, 'project.json');
  if (!PROJECT_NAME.test(name)) return null;
  return path.join(DATA, 'projets', name + '.json');
}

/** Chemin sûr à l'intérieur de `base` (refuse les « ../ »). */
function inside(base, urlPath) {
  const p = path.resolve(base, '.' + path.posix.normalize('/' + decodeURIComponent(urlPath)));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

async function sendFile(res, file, cache) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error();
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff'
    });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Introuvable');
  }
}

/* --- Authentification de la publication --- */

const digest = (s) => createHash('sha256').update(String(s)).digest();
const failures = new Map(); // ip → { count, until }

function authorized(req) {
  if (!PASSWORD) return false;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return timingSafeEqual(digest(given), digest(PASSWORD));
}

function tooManyFailures(ip) {
  const f = failures.get(ip);
  return f && f.count >= 10 && f.until > Date.now();
}

function noteFailure(ip) {
  const f = failures.get(ip);
  const fresh = !f || f.until < Date.now();
  failures.set(ip, { count: fresh ? 1 : f.count + 1, until: Date.now() + 10 * 60 * 1000 });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('projet trop volumineux'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function publish(req, res, name) {
  const ip = req.socket.remoteAddress;
  if (!PASSWORD) return send(res, 403, 'Publication désactivée (PUBLISH_PASSWORD non défini)');
  if (tooManyFailures(ip)) return send(res, 429, 'Trop de tentatives, réessayez dans 10 minutes');
  if (!authorized(req)) {
    noteFailure(ip);
    return send(res, 401, 'Mot de passe de publication incorrect');
  }
  const file = projectFile(name);
  if (!file) return send(res, 400, 'Nom de projet invalide');
  let text;
  try {
    text = await readBody(req);
    const p = JSON.parse(text);
    if (p.format !== 'inventaire-botanique' || !Array.isArray(p.maps)) throw new Error('format de projet non reconnu');
  } catch (e) {
    return send(res, e.status || 400, 'Projet refusé : ' + e.message);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Sauvegarde de la version précédente
  try {
    const backups = path.join(DATA, 'backups');
    await fs.mkdir(backups, { recursive: true });
    const base = path.basename(file, '.json');
    await fs.copyFile(file, path.join(backups, `${base}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    const old = (await fs.readdir(backups)).filter((f) => f.startsWith(base + '-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) await fs.unlink(path.join(backups, f));
  } catch {
    /* pas de version précédente */
  }
  // Écriture atomique : on écrit à côté puis on renomme
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
  console.log(`[${new Date().toISOString()}] projet publié : ${path.relative(DATA, file)} (${(text.length / 1e6).toFixed(1)} Mo)`);
  send(res, 200, JSON.stringify({ ok: true }), TYPES['.json']);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/project') {
      if (req.method !== 'PUT') return send(res, 405, 'Méthode non autorisée', undefined, { Allow: 'PUT' });
      return await publish(req, res, url.searchParams.get('projet'));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');

    if (p === '/config.json') {
      return send(res, 200, JSON.stringify({ projectUrl: 'project.json', publishUrl: PASSWORD ? 'api/project' : null }), TYPES['.json'], {
        'Cache-Control': 'no-cache'
      });
    }
    if (p === '/project.json') return sendFile(res, projectFile(''), 'no-cache');
    const m = p.match(/^\/projets\/([^/]+)\.json$/);
    if (m) {
      const file = projectFile(m[1]);
      return file ? sendFile(res, file, 'no-cache') : send(res, 404, 'Introuvable');
    }

    const file = inside(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    if (!file) return send(res, 400, 'Chemin invalide');
    return sendFile(res, file, path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Erreur du serveur');
  }
});

server.listen(PORT, () => {
  console.log(`Inventaire botanique : http://localhost:${PORT}`);
  console.log(`  application : ${ROOT}`);
  console.log(`  projets     : ${DATA}`);
  console.log(`  publication : ${PASSWORD ? 'activée' : 'désactivée (définir PUBLISH_PASSWORD)'}`);
});
