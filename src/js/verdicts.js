/**
 * La correction des questions (étape 6 de la version 2.0.0, QST) : la réponse attendue de chaque fiche, et le verdict de
 * chaque réponse d'élève. Sans DOM ni stockage : le serveur corrige avec ce module, et le navigateur s'en sert pour
 * présenter, comme fields.js et model.js.
 *
 * Une question « corrigée automatiquement » a, sur chaque fiche, sa réponse attendue (`fiche.expected[question]`) :
 *  - choix unique : l'identifiant de la bonne proposition ; choix multiple : les identifiants de toutes les bonnes ;
 *  - oui / non : « oui » ou « non » ; échelle : le cran attendu ;
 *  - nombre : { value, tolerance } ;
 *  - texte court : la liste des réponses acceptées, lues sans accents, majuscules ni espaces en trop.
 * Comme les positions réelles, une réponse attendue ne part jamais chez l'élève avant la fin du cours (CRG-01).
 */
import { num } from './util.js';
import { checkOf, isEmpty, normalizeValue, questionFields, LIMITS } from './fields.js';

/** Juste, à moitié juste, faux ; « pending » : l'enseignant corrigera (QST-04). */
export const VERDICTS = ['ok', 'half', 'wrong'];
export const VERDICT_LABELS = { ok: 'Juste', half: 'À moitié juste', wrong: 'Faux', pending: 'À corriger' };
export const MAX_ACCEPTED = 20;

/** Un texte tel qu'on le compare : sans accents, sans majuscules, sans espaces en trop. */
export const comparable = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Les questions dont chaque fiche porte la bonne réponse. */
export const autoQuestions = (template) => questionFields(template).filter((field) => checkOf(field) === 'auto');

/**
 * La réponse attendue sous sa forme normale, ou `undefined` s'il n'y en a pas : une question sans réponse attendue sur une
 * fiche n'y est pas corrigée automatiquement, l'enseignant la corrige.
 */
export function normalizeExpected(field, raw) {
  if (raw === undefined || raw === null) return undefined;
  switch (field.type) {
    case 'number': {
      const value = num(raw?.value);
      if (value === null) return undefined;
      return { value, tolerance: Math.max(0, num(raw.tolerance) ?? 0) };
    }
    case 'text': {
      const seen = new Set();
      const accepted = (Array.isArray(raw) ? raw : [raw])
        .map((text) =>
          String(text ?? '')
            .trim()
            .slice(0, LIMITS.text)
        )
        .filter((text) => text && !seen.has(comparable(text)) && seen.add(comparable(text)))
        .slice(0, MAX_ACCEPTED);
      return accepted.length ? accepted : undefined;
    }
    default: {
      const value = normalizeValue(field, raw);
      return isEmpty(value) ? undefined : value;
    }
  }
}

/** Les réponses attendues d'une fiche : seulement celles des questions corrigées automatiquement, chacune sous sa forme normale. */
export function normalizeExpectedOf(raw, template) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const field of autoQuestions(template)) {
    const value = normalizeExpected(field, raw[field.id]);
    if (value !== undefined) out[field.id] = value;
  }
  return out;
}

/** Les réponses attendues telles qu'elles doivent arriver au serveur : déjà normales, et rien d'autre (CHP-07). */
export function expectedProblem(raw, template) {
  if (raw === undefined) return '';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'réponses attendues illisibles';
  const fields = new Map(autoQuestions(template).map((field) => [field.id, field]));
  for (const [id, value] of Object.entries(raw)) {
    const field = fields.get(id);
    if (!field) return 'réponse attendue à une question qui ne se corrige pas automatiquement';
    if (JSON.stringify(normalizeExpected(field, value)) !== JSON.stringify(value)) return `réponse attendue invalide pour « ${field.label} »`;
  }
  return '';
}

/** Le verdict d'une réponse à une question corrigée automatiquement : juste ou faux. Sans réponse, c'est faux. */
export function autoVerdict(field, expected, answer) {
  if (isEmpty(answer)) return 'wrong';
  switch (field.type) {
    case 'number': {
      const value = num(answer);
      return value !== null && Math.abs(value - expected.value) <= expected.tolerance + 1e-9 ? 'ok' : 'wrong';
    }
    case 'text':
      return expected.some((accepted) => comparable(accepted) === comparable(answer)) ? 'ok' : 'wrong';
    case 'choice':
      if (field.multiple) {
        const given = new Set(answer);
        return given.size === expected.length && expected.every((id) => given.has(id)) ? 'ok' : 'wrong';
      }
      return answer === expected ? 'ok' : 'wrong';
    default:
      return String(answer) === String(expected) ? 'ok' : 'wrong';
  }
}

/**
 * Le verdict de chaque question corrigée d'une fiche (QST-02) : celui du serveur pour une question fermée qui a sa réponse
 * attendue, « pending » pour une question que l'enseignant corrigera, faux pour une question sans réponse. Une question
 * seulement recueillie, comme une mesure, n'a pas de verdict.
 */
export function questionVerdicts(template, fiche, entry) {
  const verdicts = {};
  for (const field of questionFields(template)) {
    const check = checkOf(field);
    if (check === 'none') continue;
    const answer = entry?.[field.id];
    const expected = fiche.expected?.[field.id];
    if (check === 'auto' && expected !== undefined) verdicts[field.id] = autoVerdict(field, expected, answer);
    else verdicts[field.id] = isEmpty(answer) ? 'wrong' : 'pending';
  }
  return verdicts;
}

/** Combien de réponses justes, à moitié, fausses, et à corriger. */
export function countVerdicts(verdictsByFiche) {
  const counts = { ok: 0, half: 0, wrong: 0, pending: 0 };
  for (const verdicts of verdictsByFiche) for (const verdict of Object.values(verdicts)) counts[verdict]++;
  return counts;
}

/** La réponse attendue en clair, pour la correction : « Hêtre », « Oui », « 12 m (à 1 près) », « chêne ou chêne vert ». */
export function expectedText(field, expected) {
  if (expected === undefined) return '';
  switch (field.type) {
    case 'number':
      return `${String(expected.value).replace('.', ',')}${field.unit ? ` ${field.unit}` : ''}${expected.tolerance ? ` (à ${String(expected.tolerance).replace('.', ',')} près)` : ''}`;
    case 'text':
      return expected.join(' ou ');
    case 'choice': {
      const labels = (Array.isArray(expected) ? expected : [expected]).map((id) => field.choices.find((choice) => choice.id === id)?.label ?? id);
      return labels.join(', ');
    }
    case 'yesno':
      return expected === 'oui' ? 'Oui' : 'Non';
    default:
      return field.symbol ? field.symbol.repeat(expected) : String(expected);
  }
}

/* ------------------------------------------------------------------ */
/* Corrections de l'enseignant (QST-04)                                 */
/* ------------------------------------------------------------------ */

export const MAX_COMMENT = 500;

/**
 * Le verdict de chaque question de chaque fiche, celui de l'enseignant l'emportant sur celui du serveur : il corrige les
 * questions ouvertes, et peut changer un verdict automatique (accepter une faute d'orthographe).
 * @param results les résultats calculés à la réception (computeResults)
 * @param reviews { [carte]: { [fiche]: { [question]: { verdict, comment } } } }
 * @returns { [carte]: { [fiche]: { [question]: verdict } } }
 */
export function finalVerdicts(results, reviews) {
  const out = {};
  for (const [mapId, map] of Object.entries(results?.maps ?? {})) {
    for (const [ficheId, result] of Object.entries(map.fiches)) {
      if (!result.questions) continue;
      const reviewed = reviews?.[mapId]?.[ficheId] ?? {};
      (out[mapId] ??= {})[ficheId] = Object.fromEntries(Object.entries(result.questions).map(([id, verdict]) => [id, reviewed[id]?.verdict ?? verdict]));
    }
  }
  return out;
}

/** Combien de réponses justes, à moitié, fausses et encore à corriger, corrections de l'enseignant comprises ; null sans question corrigée. */
export function answerCounts(results, reviews) {
  if (!results?.answers) return null;
  return countVerdicts(Object.values(finalVerdicts(results, reviews)).flatMap((fiches) => Object.values(fiches)));
}

/* ------------------------------------------------------------------ */
/* Notation (QST-05)                                                    */
/* ------------------------------------------------------------------ */

export const GRADING_MODES = ['none', 'points', 'auto'];
export const GRADING_LABELS = {
  none: 'Sans note : le nombre de réponses justes, à moitié justes et fausses',
  points: 'Un barème : des points pour chaque question et pour chaque placement',
  auto: 'Une note sur un maximum, chaque réponse ayant le même poids'
};
export const MAX_POINTS = 100;
export const MAX_MARK = 1000;

/** Les questions qui comptent dans une note : celles qui se corrigent. */
export const gradedQuestions = (template) => questionFields(template).filter((field) => checkOf(field) !== 'none');

/**
 * La notation d'un cours, sous sa forme normale (4.5 de la feuille de route) :
 *  - { mode: 'none' } : sans note ;
 *  - { mode: 'points', points: { [question]: n }, placement: n } : un barème ; une question sans barème vaut 1 point ;
 *  - { mode: 'auto', max: n, placement: true | false } : une note sur `max`, chaque réponse ayant le même poids.
 * Ce qui ne se lit pas redevient « sans note ».
 */
export function normalizeGrading(raw, template) {
  if (!raw || typeof raw !== 'object') return { mode: 'none' };
  if (raw.mode === 'points') {
    const points = {};
    for (const field of gradedQuestions(template)) {
      const value = num(raw.points?.[field.id]);
      if (value !== null && value !== 1) points[field.id] = Math.min(MAX_POINTS, Math.max(0, Math.round(value * 100) / 100));
    }
    const placement = num(raw.placement);
    return { mode: 'points', points, placement: placement === null ? 1 : Math.min(MAX_POINTS, Math.max(0, Math.round(placement * 100) / 100)) };
  }
  if (raw.mode === 'auto') {
    const max = num(raw.max);
    return { mode: 'auto', max: max === null || max <= 0 ? 20 : Math.min(MAX_MARK, Math.round(max * 100) / 100), placement: raw.placement !== false };
  }
  return { mode: 'none' };
}

/** Une notation telle qu'elle doit arriver au serveur : déjà normale, sans question inconnue ni nombre hors bornes (CHP-07). */
export function gradingProblem(raw, template) {
  if (raw === undefined) return '';
  return JSON.stringify(normalizeGrading(raw, template)) === JSON.stringify(raw) ? '' : 'notation invalide';
}

/** Le placement d'une fiche, comme une réponse : bien placée vaut juste, proche à moitié, le reste faux ; sans position réelle, rien. */
const PLACEMENT_VERDICTS = { ok: 'ok', near: 'half', far: 'wrong', unplaced: 'wrong' };
const EARNED = { ok: 1, half: 0.5, wrong: 0, pending: 0 };

/**
 * La note d'un élève (QST-05), calculée à la lecture : changer de barème après coup ne réécrit rien. Les réponses encore
 * à corriger comptent comme fausses : la note est alors provisoire, et ne peut que monter.
 * @returns null sans note ; sinon { mark, outOf, provisional, pending }
 */
export function markOf(project, grading, results, reviews) {
  if (!results || grading.mode === 'none') return null;
  const verdicts = finalVerdicts(results, reviews);
  const withPlacement = grading.mode === 'points' ? grading.placement > 0 : grading.placement;
  let earned = 0;
  let possible = 0;
  let pending = 0;
  const add = (verdict, weight) => {
    earned += EARNED[verdict] * weight;
    possible += weight;
    if (verdict === 'pending') pending++;
  };
  for (const [mapId, map] of Object.entries(results.maps)) {
    for (const [ficheId, result] of Object.entries(map.fiches)) {
      if (withPlacement && PLACEMENT_VERDICTS[result.state]) add(PLACEMENT_VERDICTS[result.state], grading.mode === 'points' ? grading.placement : 1);
      for (const [questionId, verdict] of Object.entries(verdicts[mapId]?.[ficheId] ?? {}))
        add(verdict, grading.mode === 'points' ? (grading.points[questionId] ?? 1) : 1);
    }
  }
  if (!possible) return null;
  return grading.mode === 'points'
    ? { mark: earned, outOf: possible, provisional: pending > 0, pending }
    : { mark: (earned / possible) * grading.max, outOf: grading.max, provisional: pending > 0, pending };
}

/** « 14,5 / 20 », au dixième, « provisoire » tant qu'il reste des réponses à corriger. */
export function markText(mark) {
  if (!mark) return '';
  const tenth = (n) => (Math.round(n * 10) / 10).toLocaleString('fr-FR');
  return `${tenth(mark.mark)} / ${tenth(mark.outOf)}${mark.provisional ? ` (provisoire, ${mark.pending} à corriger)` : ''}`;
}

/**
 * Les questions corrigées, en une phrase (QST-03) : combien de justes et de fausses. Celles que l'enseignant corrigera plus
 * tard sont annoncées à part (Q-O) : sa correction ne viendra pas sur ce téléphone, qui n'en garde rien (CRG-08).
 */
export function answersText({ answers }) {
  if (!answers) return { line: '', pending: '' };
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const parts = [
    plural(answers.ok, 'juste', 'justes'),
    ...(answers.half ? [plural(answers.half, 'à moitié juste', 'à moitié justes')] : []),
    plural(answers.wrong, 'fausse', 'fausses')
  ];
  const done = answers.ok + answers.half + answers.wrong;
  return {
    line: done ? `Questions : ${parts.join(', ')}.` : '',
    pending: answers.pending ? `${plural(answers.pending, 'réponse sera corrigée', 'réponses seront corrigées')} plus tard par votre enseignant.` : ''
  };
}
