/**
 * Routes du projet unique partagé par un mot de passe. Elles disparaissent à la mise en service des
 * espaces enseignants (étape 10 de la feuille de route).
 *
 *   GET  /config.json               réglages lus par l'application au démarrage
 *   GET  /project.json              projet principal       (DATA_DIR/project.json)
 *   GET  /projets/<nom>.json        projets supplémentaires (adresse : /?projet=<nom>)
 *   PUT  /api/project[?projet=nom]  publication (en-tête « Authorization: Bearer <mot de passe> »)
 *
 * À chaque publication, l'ancienne version est copiée dans DATA_DIR/backups/ (20 dernières).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBody, send, sendFile, sendJson } from '../http.mjs';
import { clientIp, createLimiter } from '../security.mjs';

const KEEP_BACKUPS = 20;
const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/i;
/** Horodatage du nom d'une sauvegarde : il évite de confondre « rocaille » et « rocaille-2 » (E-11). */
const BACKUP_STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`;

const digest = (s) => createHash('sha256').update(String(s)).digest();

export function legacyRoutes(router, { data, password, maxBody, trustProxy }) {
  const failures = createLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

  /** Fichier de données d'un projet (« principal » si name est vide). */
  function projectFile(name) {
    if (!name) return path.join(data, 'project.json');
    if (!PROJECT_NAME.test(name)) return null;
    return path.join(data, 'projets', name + '.json');
  }

  function authorized(req) {
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return timingSafeEqual(digest(given), digest(password));
  }

  /** Sauvegarde de la version précédente, s'il y en a une. */
  async function backup(file) {
    try {
      const backups = path.join(data, 'backups');
      await fs.mkdir(backups, { recursive: true });
      const base = path.basename(file, '.json');
      await fs.copyFile(file, path.join(backups, `${base}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const own = new RegExp(`^${base}-${BACKUP_STAMP}\\.json$`);
      const old = (await fs.readdir(backups)).filter((f) => own.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) await fs.unlink(path.join(backups, f));
    } catch {
      /* pas de version précédente */
    }
  }

  async function publish(req, res, { url }) {
    const ip = clientIp(req, trustProxy);
    if (!password) return send(res, 403, 'Publication désactivée (PUBLISH_PASSWORD non défini)');
    if (failures.blocked(ip)) return send(res, 429, 'Trop de tentatives, réessayez dans 10 minutes');
    if (!authorized(req)) {
      failures.fail(ip);
      return send(res, 401, 'Mot de passe de publication incorrect');
    }
    const file = projectFile(url.searchParams.get('projet'));
    if (!file) return send(res, 400, 'Nom de projet invalide');
    let text;
    try {
      text = (await readBody(req, maxBody)).toString('utf8');
      const p = JSON.parse(text);
      if (p.format !== 'inventaire-botanique' || !Array.isArray(p.maps)) throw new Error('format de projet non reconnu');
    } catch (e) {
      return send(res, e.status || 400, 'Projet refusé : ' + e.message);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await backup(file);
    // Écriture atomique : on écrit à côté puis on renomme
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
    console.log(`[${new Date().toISOString()}] projet publié : ${path.relative(data, file)} (${(text.length / 1e6).toFixed(1)} Mo)`);
    return sendJson(req, res, { ok: true });
  }

  router
    .add('PUT', '/api/project', publish)
    .add('GET', '/config.json', (req, res) => sendJson(req, res, { projectUrl: 'project.json', publishUrl: password ? 'api/project' : null }))
    .add('GET', '/project.json', (req, res) => sendFile(req, res, projectFile(''), 'no-cache'))
    .add('GET', '/projets/:name.json', (req, res, { params }) => {
      const file = projectFile(params.name);
      return file ? sendFile(req, res, file, 'no-cache') : send(res, 404, 'Introuvable');
    });
}
