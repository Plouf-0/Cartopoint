/**
 * Cours et fichiers de l'enseignant, sous /api. Tout passe par `courses.require()`, qui répond 404 à un autre
 * enseignant comme à l'admin : ni l'un ni l'autre ne peut savoir qu'un cours existe (ENS-03, ADM-07).
 *
 *   GET  /courses               ses cours           POST /courses       créer, avec le contenu
 *   GET  /courses/:id           un cours            PUT  /courses/:id   enregistrer, avec la révision de départ
 *   DELETE /courses/:id         supprimer           POST /courses/:id/publish   figer une version
 *   POST /media                 envoyer un fichier, le type est lu dans son contenu
 *   GET  /media/<hash>.<ext>    lire un fichier, sans compte : les élèves en ont besoin
 */
import path from 'node:path';
import { PRIVATE, readBody, readJson, send, sendFile, sendJson } from '../http.mjs';
import { MEDIA_NAME } from '../media.mjs';
import { sameOriginOnly } from '../security.mjs';

/** Le contenu d'un cours ne contient que du texte : 8 Mo laissent la place à des milliers de fiches. */
const MAX_DRAFT = 8 * 1024 * 1024;
/** Le nom d'un fichier dépend de son contenu : il peut rester en cache pour toujours. */
const FOREVER = 'public, max-age=31536000, immutable';

/** Le cours demandé, s'il appartient au compte connecté. Sinon, 404 (ENS-03). */
export const courseOfRequest =
  ({ auth, courses }) =>
  (req, params) =>
    courses.require(auth.requireAccount(req).id, params.id);

export function courseRoutes(router, { auth, courses, media, maxBody }) {
  const teacher = (req) => auth.requireRole(req, 'teacher');
  const courseOf = courseOfRequest({ auth, courses });

  router
    .add('GET', '/api/courses', (req, res) => sendJson(req, res, courses.list(teacher(req).id), PRIVATE))
    .add(
      'POST',
      '/api/courses',
      sameOriginOnly(async (req, res) => {
        const account = teacher(req);
        const { draft } = await readJson(req, MAX_DRAFT);
        return sendJson(req, res, courses.create(account.id, draft), PRIVATE);
      })
    )
    .add('GET', '/api/courses/:id', (req, res, { params }) => sendJson(req, res, courses.read(courseOf(req, params)), PRIVATE))
    .add(
      'PUT',
      '/api/courses/:id',
      sameOriginOnly(async (req, res, { params }) => {
        courseOf(req, params);
        const { revision, draft } = await readJson(req, MAX_DRAFT);
        // Relu après l'envoi, qui peut être long : le cours a pu être supprimé entre-temps
        return sendJson(req, res, courses.update(courseOf(req, params), revision, draft), PRIVATE);
      })
    )
    .add(
      'DELETE',
      '/api/courses/:id',
      sameOriginOnly((req, res, { params }) => {
        courses.remove(courseOf(req, params));
        return sendJson(req, res, { ok: true }, PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/courses/:id/publish',
      sameOriginOnly(async (req, res, { params }) => {
        courseOf(req, params);
        const { revision } = await readJson(req);
        const row = courseOf(req, params);
        courses.publish(row, revision);
        return sendJson(req, res, courses.read(row), PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/media',
      sameOriginOnly(async (req, res) => {
        const account = teacher(req);
        const body = await readBody(req, maxBody);
        return sendJson(req, res, await media.save(account.id, body), PRIVATE);
      })
    )
    .add('GET', '/media/:file', (req, res, { params }) => {
      if (!MEDIA_NAME.test(params.file)) return send(res, 404, 'Introuvable');
      return sendFile(req, res, path.join(media.dir, params.file), FOREVER);
    });
}
