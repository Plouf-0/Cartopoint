/**
 * Lancements, du côté de l'enseignant, sous /api. Un autre enseignant ou l'admin reçoit 404 (ANO-06, ADM-07).
 *
 *   GET, POST /courses/:id/launches   ses lancements, en lancer un
 *   GET  /launches/:id                le lancement et ses élèves, interrogé toutes les 5 secondes
 *   POST /launches/:id/end            terminer le cours
 *   DELETE /launches/:id              supprimer un lancement terminé
 *   GET  /launches/:id/sheets         le cours et toutes les réponses, pour les comptes rendus et le fichier Excel
 *   POST /launches/:id/answers-file   le fichier de réponses d'un élève
 */
import { MAX_ANSWERS_BYTES, cleanAnswers, computeResults, countAfterEnd, onServerClock } from '../answers.mjs';
import { HttpError, PRIVATE, readJson, sendJson } from '../http.mjs';
import { courseOfRequest } from './courses.mjs';
import { normalizeProject } from '../../src/js/model.js';
import { sameOriginOnly } from '../security.mjs';

const ANSWERS_FORMAT = 'cartopoint-reponses';

export function launchRoutes(router, { auth, courses, launches }) {
  const courseOf = courseOfRequest({ auth, courses });
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
    )
    .add(
      'DELETE',
      '/api/launches/:id',
      sameOriginOnly((req, res, { params }) => {
        launches.remove(launchOf(req, params));
        return sendJson(req, res, { ok: true }, PRIVATE);
      })
    )
    .add('GET', '/api/launches/:id/sheets', (req, res, { params }) => sendJson(req, res, launches.sheets(launchOf(req, params)), PRIVATE))
    .add(
      'POST',
      '/api/launches/:id/answers-file',
      sameOriginOnly(async (req, res, { params }) => {
        const row = launchOf(req, params);
        const file = await readJson(req, MAX_ANSWERS_BYTES);
        if (file?.format !== ANSWERS_FORMAT) throw new HttpError(400, "Ce n'est pas un fichier de réponses.");
        const participant = launches.forFile(row, file.participantId);
        if (participant.submitted_at) return sendJson(req, res, { names: participant.names, alreadyReceived: true }, PRIVATE);
        const project = normalizeProject(JSON.parse(participant.content));
        const now = Date.now();
        // Pas d'heure d'envoi : le fichier a pu attendre longtemps, et l'écart avec l'horloge du téléphone reste inconnu
        const timed = onServerClock(cleanAnswers(file.answers, project), undefined, now);
        launches.submit(participant, timed.answers, computeResults(project, timed.answers), {
          byFile: true,
          afterEnd: row.ended_at ? countAfterEnd(timed.answers, Date.parse(row.ended_at)) : 0,
          finishedAt: new Date(Number.isFinite(file.finishedAt) ? Math.min(file.finishedAt, now) : now).toISOString()
        });
        return sendJson(req, res, { names: participant.names, alreadyReceived: false }, PRIVATE);
      })
    );
}
