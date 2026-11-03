/**
 * Les réponses d'un élève : vérifiées une à une, puis corrigées ici, sur le serveur, avec la version de son lancement
 * (CRG-09). Le résultat reste en base : rien de ce qui est calculé ici ne repart chez l'élève avant la fin du cours.
 */
import { MEASURES, evaluate, visibleFiches } from '../src/js/model.js';
import { HttpError } from './http.mjs';

export const MAX_ANSWERS_BYTES = 256 * 1024;
export const MAX_MEASURE = 50;
const INVALID = 'Ces réponses ne correspondent pas à ce cours.';

const refuse = () => {
  throw new HttpError(400, INVALID);
};
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPosition = (value) => typeof value === 'number' && value >= 0 && value <= 100;

function cleanEntry(raw) {
  if (!isObject(raw)) refuse();
  const placed = isPosition(raw.x) && isPosition(raw.y);
  // Ni un seul des deux, ni autre chose qu'une position : un placement est complet, ou il n'y en a pas
  if (!placed && (raw.x ?? raw.y ?? null) !== null) refuse();
  const entry = { x: placed ? raw.x : null, y: placed ? raw.y : null };
  for (const [key] of MEASURES) {
    const value = raw[key] ?? '';
    if (typeof value !== 'string' || value.length > MAX_MEASURE) refuse();
    entry[key] = value;
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
  return Object.fromEntries(
    Object.entries(raw).map(([mapId, entries]) => {
      const fiches = maps.get(mapId);
      if (!fiches || !isObject(entries)) refuse();
      return [
        mapId,
        Object.fromEntries(
          Object.entries(entries).map(([ficheId, entry]) => {
            if (!fiches.has(ficheId)) refuse();
            return [ficheId, cleanEntry(entry)];
          })
        )
      ];
    })
  );
}

const emptyScore = () => ({ ok: 0, near: 0, far: 0, unplaced: 0, noref: 0 });

/** @returns pour chaque carte, le résultat de chaque fiche visible et le score ; puis le score total */
export function computeResults(project, answers) {
  const total = emptyScore();
  const maps = project.maps.map((map) => {
    const score = emptyScore();
    const fiches = visibleFiches(map).map((fiche) => {
      // Sans proportions connues (cours publié avant qu'elles soient mesurées), l'écart est compté sur un plan carré
      const { state, d, dist } = evaluate(fiche, answers[map.id]?.[fiche.id], { ratio: map.ratio || 1, widthMeters: map.widthMeters });
      score[state]++;
      total[state]++;
      return [fiche.id, d === undefined ? { state } : { state, d, dist }];
    });
    return [map.id, { fiches: Object.fromEntries(fiches), score }];
  });
  return { maps: Object.fromEntries(maps), score: total };
}
