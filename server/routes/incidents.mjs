/**
 * Journal des problèmes (INC-01).
 *
 *   POST /api/incidents         un navigateur signale un problème. Ouvert à tous : un problème peut arriver avant toute connexion
 *   GET  /api/admin/incidents   la liste, pour l'admin seulement
 *   POST /api/admin/incidents/clear
 */
import { readJson, sendJson } from '../http.mjs';
import { sameOriginOnly } from '../security.mjs';

const PRIVATE = { cache: 'no-store' };
const MAX_BODY = 16 * 1024;

export function incidentRoutes(router, { auth, incidents }) {
  router
    .add(
      'POST',
      '/api/incidents',
      sameOriginOnly(async (req, res) => {
        const report = await readJson(req, MAX_BODY);
        incidents.record(report, auth.currentAccount(req)?.id ?? null);
        sendJson(req, res, { ok: true }, PRIVATE);
      })
    )
    .add('GET', '/api/admin/incidents', (req, res) => {
      auth.requireRole(req, 'admin');
      sendJson(req, res, incidents.list(), PRIVATE);
    })
    .add(
      'POST',
      '/api/admin/incidents/clear',
      sameOriginOnly((req, res) => {
        auth.requireRole(req, 'admin');
        incidents.clear();
        sendJson(req, res, { ok: true }, PRIVATE);
      })
    );
}
