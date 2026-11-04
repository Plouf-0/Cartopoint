/**
 * Le fichier Excel d'un lancement (HIS-08). La première page résume : une ligne par élève et une ligne pour la classe, puis une ligne par fiche. Suit une page par
 * élève ayant rendu, avec toutes ses réponses. Ce fichier ne contient que des calculs, sans rien à l'écran : il se teste sans navigateur.
 */
import { MEASURES, meanGap, numberOf, placedPos, titleOf, usesMeters, visibleFiches } from '../model.js';
import { dateAndTime, num } from '../util.js';
import { bold } from '../xlsx-write.js';

const GRADE_LABELS = { ok: 'Bien placée', near: 'Proche', far: 'À revoir', unplaced: 'Non placée', noref: 'Pas de position réelle' };
const MEASURE_HEADERS = MEASURES.map(([, , unit, label]) => `${label} (${unit})`);
const MEASURE_KEYS = MEASURES.map(([key]) => key);

const round = (value, digits = 2) => (value === null || value === undefined ? null : +value.toFixed(digits));
const average = (values) => {
  const known = values.filter((value) => value !== null && value !== undefined);
  return known.length ? known.reduce((total, value) => total + value, 0) / known.length : null;
};
/** Un élève peut écrire ce qu'il veut dans une mesure : un nombre reste un nombre pour Excel, le reste reste du texte. */
const measureCell = (raw) => num(raw) ?? (raw || null);

const entriesOf = (participant, map) => Object.values(participant.answers?.[map.id] ?? {});

/** La moyenne d'une mesure pour un élève, sur toutes les fiches où il l'a relevée. */
function studentMeasure(project, participant, key) {
  return average(project.maps.flatMap((map) => entriesOf(participant, map).map((entry) => num(entry[key]))));
}

const gapInUnit = (project, map, d) => (d === undefined ? null : usesMeters(project) ? (d / 100) * map.widthMeters : d);

/** Ce que dit la liste de l'enseignant, en un mot. */
export function stateText(participant) {
  if (!participant.submittedAt) return "N'a pas rendu";
  const parts = [
    participant.autoClosed
      ? 'Figé à la fin du cours'
      : !participant.late
        ? 'A fini'
        : participant.finishedAfterEnd
          ? 'A fini après la fin du cours'
          : 'A fini avant la fin, reçu après'
  ];
  if (participant.byFile) parts.push('par fichier');
  if (participant.answersAfterEnd) parts.push(`${participant.answersAfterEnd} réponse(s) après la fin`);
  return parts.join(' · ');
}

function summarySheet(project, participants, { title, openedAt, endedAt }) {
  const unit = usesMeters(project) ? 'm' : '% du plan';
  const handedIn = participants.filter((participant) => participant.results);
  const rows = [[bold(title)], [`Lancé le ${dateAndTime(openedAt)}`], [endedAt ? `Terminé le ${dateAndTime(endedAt)}` : 'Cours encore en marche'], []];

  rows.push([
    bold('Élève'),
    bold('État'),
    bold('Bien placées'),
    bold('Proches'),
    bold('À revoir'),
    bold('Non placées'),
    bold(`Précision moyenne (${unit})`),
    ...MEASURE_HEADERS.map((header) => bold(`${header}, moyenne`))
  ]);
  for (const participant of participants) {
    const score = participant.results?.score;
    rows.push([
      participant.names,
      stateText(participant),
      score?.ok ?? null,
      score?.near ?? null,
      score?.far ?? null,
      score?.unplaced ?? null,
      participant.results ? round(meanGap(project, participant.results)) : null,
      ...MEASURE_KEYS.map((key) => round(studentMeasure(project, participant, key)))
    ]);
  }
  const classAverage = (read) => round(average(handedIn.map(read)));
  rows.push([
    bold('Classe'),
    bold(`${handedIn.length} rendu(s) sur ${participants.length}`),
    ...['ok', 'near', 'far', 'unplaced'].map((state) => bold(classAverage((participant) => participant.results.score[state]))),
    bold(classAverage((participant) => meanGap(project, participant.results))),
    ...MEASURE_KEYS.map((key) => bold(classAverage((participant) => studentMeasure(project, participant, key))))
  ]);

  rows.push([], [bold('Par fiche')]);
  const several = project.maps.length > 1;
  rows.push([
    ...(several ? [bold('Carte')] : []),
    bold('N°'),
    bold('Fiche'),
    bold('Placées'),
    bold('Bien placées'),
    bold(`Écart moyen (${unit})`),
    ...MEASURE_HEADERS.map((header) => bold(`${header}, moyenne`))
  ]);
  for (const map of project.maps) {
    for (const fiche of visibleFiches(map)) {
      const answers = handedIn.map((participant) => ({
        entry: participant.answers?.[map.id]?.[fiche.id],
        result: participant.results.maps[map.id]?.fiches[fiche.id]
      }));
      rows.push([
        ...(several ? [map.name] : []),
        Number(numberOf(map, fiche)),
        titleOf(fiche),
        answers.filter(({ entry }) => placedPos(entry)).length,
        answers.filter(({ result }) => result?.state === 'ok').length,
        round(average(answers.map(({ result }) => gapInUnit(project, map, result?.d)))),
        ...MEASURE_KEYS.map((key) => round(average(answers.map(({ entry }) => num(entry?.[key])))))
      ]);
    }
  }
  return { name: 'Synthèse', rows, widths: [28, 34, 12, 10, 10, 12, 22, 22, 22, 22] };
}

function studentSheet(project, participant) {
  const unit = usesMeters(project) ? 'm' : '% du plan';
  const several = project.maps.length > 1;
  const rows = [
    [bold(participant.names)],
    [`Cours lancé le ${dateAndTime(participant.openedAt)}`],
    [stateText(participant)],
    [bold('Précision moyenne'), round(meanGap(project, participant.results)), unit],
    [],
    [
      ...(several ? [bold('Carte')] : []),
      bold('N°'),
      bold('Réf. photo'),
      bold('Nom commun'),
      bold('Nom scientifique'),
      bold('Résultat'),
      bold(`Écart (${unit})`),
      bold('Placement X (%)'),
      bold('Placement Y (%)'),
      bold('Position réelle X (%)'),
      bold('Position réelle Y (%)'),
      ...MEASURE_HEADERS.map(bold),
      bold('Réponse après la fin ?')
    ]
  ];
  for (const map of project.maps) {
    for (const fiche of visibleFiches(map)) {
      const entry = participant.answers?.[map.id]?.[fiche.id] ?? {};
      const result = participant.results.maps[map.id]?.fiches[fiche.id] ?? { state: 'unplaced' };
      const late = participant.endedAt && entry.at > Date.parse(participant.endedAt) + participant.grace;
      rows.push([
        ...(several ? [map.name] : []),
        Number(numberOf(map, fiche)),
        fiche.ref || null,
        fiche.common || null,
        fiche.species || null,
        GRADE_LABELS[result.state],
        round(gapInUnit(project, map, result.d)),
        round(entry.x ?? null, 3),
        round(entry.y ?? null, 3),
        fiche.refX,
        fiche.refY,
        ...MEASURE_KEYS.map((key) => measureCell(entry[key])),
        late ? 'oui' : null
      ]);
    }
  }
  return { name: participant.names, rows, widths: [8, 10, 24, 24, 20, 14, 14, 14, 18, 18, 16, 16, 16, 18] };
}

/** @param sheets ce que répond GET /launches/:id/sheets, le cours étant déjà normalisé */
export function resultsWorkbook({ title, openedAt, endedAt, grace, project, participants }) {
  const handedIn = participants.filter((participant) => participant.results).map((participant) => ({ ...participant, openedAt, endedAt, grace }));
  return [summarySheet(project, participants, { title, openedAt, endedAt }), ...handedIn.map((participant) => studentSheet(project, participant))];
}
