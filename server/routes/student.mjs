/**
 * Élèves, sous /api, sans compte (ANO-04). Rien de ce qui part d'ici ne contient de réponse : le cours passe toujours par
 * studentCourse() (CRG-01). Un élève déjà entré garde son jeton une fois le cours terminé : seules les entrées s'arrêtent.
 *
 *   GET  /join/:code       ce code est-il valable ? Le titre du cours, sans rien créer
 *   POST /join/:code       entrer, avec les noms. Renvoie le jeton, une seule fois
 *   GET  /student/course   le cours, sans les réponses ni les fiches masquées
 *   PUT  /student/answers  rendre : le premier envoi fait foi, et la réponse ne contient ni résultat ni position
 *   GET  /student/state    le cours est-il terminé ? Les réponses de cet élève sont-elles arrivées ?
 *   GET  /student/correction  une fois le cours terminé et les réponses reçues : positions réelles, résultats et score (CRG-02, CRG-06)
 */
import { MAX_ANSWERS_BYTES, cleanAnswers, computeResults, correctionOf, countAfterEnd, onServerClock } from '../answers.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { normalizeProject } from '../../src/js/model.js';
import { clientIp, createLimiter, sameOriginOnly } from '../security.mjs';
import { studentCourse } from '../student-view.mjs';

const PRIVATE = { cache: 'no-store' };
/** Le cours ne change pas pour un lancement donné : l'ETag évite de le renvoyer. `private` : il ne regarde qu'un élève. */
const REVALIDATED = { cache: 'private, no-cache' };
const UNKNOWN_CODE = "Ce code n'existe pas. Vérifiez-le.";
const COURSE_ENDED = 'Ce cours est terminé : le code ne fonctionne plus.';
const COURSE_CLOSED = "Ce cours n'accepte plus de nouveaux élèves.";
const TOO_MANY = "Trop d'essais avec un code inconnu. Réessayez dans quelques minutes.";
const NO_COURSE = "Ce cours n'existe plus.";
const NOT_ENDED = "La correction arrive quand l'enseignant termine le cours.";
const NOT_RECEIVED = 'Vos réponses ne sont pas encore arrivées.';
const WINDOW = 15 * 60 * 1000;
export const MAX_CODE_FAILURES = 200;

export function studentRoutes(router, { launches, trustProxy }) {
  // Seuls les échecs comptent, et une classe de 50 partage souvent la même adresse : quelques erreurs de chacun ne doivent pas la bloquer
  // (E-04, QUA-09). Deviner un code reste hors de portée : à ce rythme, 19 200 essais par jour sur un milliard de codes
  const failures = createLimiter({ max: MAX_CODE_FAILURES, windowMs: WINDOW });

  function openLaunch(req, params) {
    const ip = clientIp(req, trustProxy);
    if (failures.blocked(ip)) throw new HttpError(429, TOO_MANY);
    const launch = launches.byCode(params.code);
    if (!launch) {
      failures.fail(ip);
      throw new HttpError(404, UNKNOWN_CODE);
    }
    if (launch.ended_at) throw new HttpError(410, COURSE_ENDED);
    // ADM-06 : les élèves déjà entrés continuent, personne d'autre n'entre
    if (launch.disabled_at) throw new HttpError(410, COURSE_CLOSED);
    return launch;
  }

  function participantOf(req) {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const participant = token && launches.participant(token);
    if (!participant) throw new HttpError(401, NO_COURSE);
    return participant;
  }

  router
    .add('GET', '/api/join/:code', (req, res, { params }) => sendJson(req, res, { title: openLaunch(req, params).title }, PRIVATE))
    .add(
      'POST',
      '/api/join/:code',
      sameOriginOnly(async (req, res, { params }) => {
        openLaunch(req, params);
        const { names } = await readJson(req);
        // Relu après l'envoi : le cours a pu être terminé entre-temps
        return sendJson(req, res, launches.join(openLaunch(req, params), names), PRIVATE);
      })
    )
    .add('GET', '/api/student/course', (req, res) => sendJson(req, res, studentCourse(JSON.parse(participantOf(req).content)), REVALIDATED))
    .add('PUT', '/api/student/answers', async (req, res) => {
      participantOf(req);
      const { answers, sentAt, autoClosed, finishedAt } = await readJson(req, MAX_ANSWERS_BYTES);
      // Relu après l'envoi, qui peut être long : un autre envoi a pu arriver entre-temps
      const participant = participantOf(req);
      let submittedAt = participant.submitted_at;
      if (!submittedAt) {
        const project = normalizeProject(JSON.parse(participant.content));
        const now = Date.now();
        const timed = onServerClock(cleanAnswers(answers, project), sentAt, now);
        submittedAt = launches.submit(participant, timed.answers, computeResults(project, timed.answers), {
          autoClosed: autoClosed === true,
          afterEnd: participant.ended_at ? countAfterEnd(timed.answers, Date.parse(participant.ended_at)) : 0,
          finishedAt: new Date(Number.isFinite(finishedAt) ? Math.min(finishedAt + timed.offset, now) : now).toISOString()
        });
      }
      return sendJson(req, res, { received: true, submittedAt }, PRIVATE);
    })
    .add('GET', '/api/student/state', (req, res) => {
      const { id, names, ended_at: endedAt, submitted_at: submittedAt } = participantOf(req);
      return sendJson(req, res, { id, names, ended: Boolean(endedAt), received: Boolean(submittedAt) }, PRIVATE);
    })
    .add('GET', '/api/student/correction', (req, res) => {
      const { ended_at: endedAt, submitted_at: submittedAt, content, results } = participantOf(req);
      if (!endedAt) throw new HttpError(403, NOT_ENDED);
      if (!submittedAt) throw new HttpError(409, NOT_RECEIVED);
      return sendJson(req, res, correctionOf(normalizeProject(JSON.parse(content)), JSON.parse(results)), PRIVATE);
    });
}
