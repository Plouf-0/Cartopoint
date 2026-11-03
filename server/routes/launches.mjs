/**
 * Lancements, du côté de l'enseignant, sous /api. Un autre enseignant ou l'admin reçoit 404 (ANO-06, ADM-07).
 *
 *   GET, POST /courses/:id/launches   ses lancements, en lancer un
 *   GET  /launches/:id                le lancement et ses élèves, interrogé toutes les 5 secondes
 *   POST /launches/:id/end            terminer le cours
 */
import { sendJson } from '../http.mjs';
import { sameOriginOnly } from '../security.mjs';

const PRIVATE = { cache: 'no-store' };

export function launchRoutes(router, { auth, courses, launches }) {
  const courseOf = (req, params) => courses.require(auth.requireAccount(req).id, params.id);
  const launchOf = (req, params) => launches.require(auth.requireAccount(req).id, params.id);

  router
    .add('GET', '/api/courses/:id/launches', (req, res, { params }) => sendJson(req, res, launches.forCourse(courseOf(req, params).id), PRIVATE))
    .add(
      'POST',
      '/api/courses/:id/launches',
      sameOriginOnly((req, res, { params }) => sendJson(req, res, launches.open(courseOf(req, params)), PRIVATE))
    )
    .add('GET', '/api/launches/:id', (req, res, { params }) => sendJson(req, res, launches.details(launchOf(req, params)), PRIVATE))
    .add(
      'POST',
      '/api/launches/:id/end',
      sameOriginOnly((req, res, { params }) => sendJson(req, res, launches.details(launches.end(launchOf(req, params))), PRIVATE))
    );
}
