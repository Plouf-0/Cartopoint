/**
 * Les réponses d'un élève : vérifiées une à une d'après les questions du modèle de la version de son lancement, puis
 * corrigées ici, sur le serveur (CRG-09). Le résultat reste en base : rien de ce qui est calculé ici ne repart chez l'élève
 * avant la fin du cours. Une version publiée sans modèle a les trois mesures du modèle botanique : une page ouverte avant la
 * version 2.0.0 envoie exactement ce qu'on attend d'elle.
 */
import { ANSWER_LIMITS, isEmpty, isValidValue, normalizeValue, questionFields } from '../src/js/fields.js';
import { evaluate, hasRef, visibleFiches } from '../src/js/model.js';
import { countVerdicts, questionVerdicts } from '../src/js/verdicts.js';
import { HttpError, isObject } from './http.mjs';

/** Assez pour des réponses écrites à chaque fiche : un texte long fait 2 000 caractères (ANSWER_LIMITS). */
export const MAX_ANSWERS_BYTES = 512 * 1024;
export const MAX_MEASURE = ANSWER_LIMITS.number;
// Un peu plus que l'intervalle de contrôle de la page élève (eleve/main.js)
export const AFTER_END_GRACE = 30000;
const INVALID = 'Ces réponses ne correspondent pas à ce cours.';

const refuse = () => {
  throw new HttpError(400, INVALID);
};
const isPosition = (value) => typeof value === 'number' && value >= 0 && value <= 100;

function cleanEntry(raw, questions) {
  if (!isObject(raw)) refuse();
  const placed = isPosition(raw.x) && isPosition(raw.y);
  // Ni un seul des deux, ni autre chose qu'une position : un placement est complet, ou il n'y en a pas
  if (!placed && (raw.x ?? raw.y ?? null) !== null) refuse();
  const entry = { x: placed ? raw.x : null, y: placed ? raw.y : null };
  if (Number.isFinite(raw.at)) entry.at = raw.at;
  // Une question sans réponse arrive vide, ou n'arrive pas : la page d'avant la version 2.0.0 envoyait toujours les trois
  for (const field of questions) {
    const value = raw[field.id] ?? normalizeValue(field, undefined);
    if (!isValidValue(field, value, { answer: true })) refuse();
    entry[field.id] = value;
  }
  return entry;
}

/**
 * Ne garde que ce qui est attendu. Une fiche masquée compte comme une fiche inconnue : l'élève ne l'a jamais reçue.
 * @param project le contenu de la version du lancement, normalisé
 */
export function cleanAnswers(raw, project) {
  if (!isObject(raw)) refuse();
  const maps = new Map(project.maps.map((map) => [map.id, new Set(visibleFiches(map).map((fiche) => fiche.id))]));
  const questions = questionFields(project.template);
  return Object.fromEntries(
    Object.entries(raw).map(([mapId, entries]) => {
      const fiches = maps.get(mapId);
      if (!fiches || !isObject(entries)) refuse();
      return [
        mapId,
        Object.fromEntries(
          Object.entries(entries).map(([ficheId, entry]) => {
            if (!fiches.has(ficheId)) refuse();
            return [ficheId, cleanEntry(entry, questions)];
          })
        )
      ];
    })
  );
}

const emptyScore = () => ({ ok: 0, near: 0, far: 0, unplaced: 0, noref: 0 });

/**
 * @returns pour chaque carte, le résultat de chaque fiche visible et le score ; puis le score total. Le résultat d'une
 * fiche donne aussi le verdict de chacune de ses questions corrigées (QST-02), et `answers` les compte pour tout le cours.
 */
export function computeResults(project, answers) {
  const total = emptyScore();
  const verdicts = [];
  const maps = project.maps.map((map) => {
    const score = emptyScore();
    const fiches = visibleFiches(map).map((fiche) => {
      const entry = answers[map.id]?.[fiche.id];
      // Sans proportions connues (cours publié avant qu'elles soient mesurées), l'écart est compté sur un plan carré
      const { state, d, dist } = evaluate(fiche, entry, { ratio: map.ratio || 1, widthMeters: map.widthMeters });
      score[state]++;
      total[state]++;
      const questions = questionVerdicts(project.template, fiche, entry);
      verdicts.push(questions);
      return [fiche.id, { state, ...(d === undefined ? {} : { d, dist }), ...(Object.keys(questions).length ? { questions } : {}) }];
    });
    return [map.id, { fiches: Object.fromEntries(fiches), score }];
  });
  const counts = countVerdicts(verdicts);
  const graded = counts.ok + counts.half + counts.wrong + counts.pending;
  return { maps: Object.fromEntries(maps), score: total, ...(graded ? { answers: counts } : {}) };
}

/**
 * Remet l'heure de chaque réponse sur l'horloge du serveur (CRG-13) : celle d'un téléphone peut être fausse, et l'appareil donne son heure à
 * l'envoi, qui permet de mesurer l'écart. Une indication et non une preuve : une horloge changée en cours de route la trompe.
 */
export function onServerClock(answers, sentAt, now) {
  const offset = Number.isFinite(sentAt) ? now - sentAt : 0;
  return {
    offset,
    answers: Object.fromEntries(
      Object.entries(answers).map(([mapId, entries]) => [
        mapId,
        Object.fromEntries(
          Object.entries(entries).map(([ficheId, entry]) => [ficheId, entry.at === undefined ? entry : { ...entry, at: Math.min(entry.at + offset, now) }])
        )
      ])
    )
  };
}

/** Les réponses faites après la fin. La page ne l'apprend qu'à son contrôle suivant : ce qui tombe dans ce délai ne compte pas (CRG-13). */
export function countAfterEnd(answers, endedAt) {
  const limit = endedAt + AFTER_END_GRACE;
  return Object.values(answers)
    .flatMap((entries) => Object.values(entries))
    .filter((entry) => entry.at > limit).length;
}

/**
 * Ce que la correction révèle d'une fiche (CHP-04) : la valeur de chacun de ses champs « révélé à la correction ». Rangé à
 * part, pour qu'un identifiant de champ ne croise jamais le résultat.
 */
function revealedOf(project, fiche) {
  const revealed = project.template.fields.filter((field) => field.audience === 'correction' && !isEmpty(fiche[field.id]));
  return revealed.length ? { revealed: Object.fromEntries(revealed.map((field) => [field.id, fiche[field.id]])) } : {};
}

/**
 * La correction d'un élève : pour chaque fiche, la position réelle s'il y en a une, le résultat et l'écart, calculés par le serveur (CRG-06, CRG-09), et ce
 * que révèle la correction.
 */
export function correctionOf(project, results) {
  return {
    score: results.score,
    // Combien de réponses justes, fausses et à corriger par l'enseignant (QST-03) ; un cours sans question corrigée n'en a pas
    ...(results.answers ? { answers: results.answers } : {}),
    maps: Object.fromEntries(
      project.maps.map((map) => [
        map.id,
        {
          score: results.maps[map.id].score,
          fiches: Object.fromEntries(
            visibleFiches(map).map((fiche) => [
              fiche.id,
              {
                ...results.maps[map.id].fiches[fiche.id],
                ...(hasRef(fiche) ? { refX: fiche.refX, refY: fiche.refY } : {}),
                ...revealedOf(project, fiche),
                // Les bonnes réponses des questions fermées, avec le verdict de chacune (QST-03)
                ...(fiche.expected ? { expected: fiche.expected } : {})
              }
            ])
          )
        }
      ])
    )
  };
}
