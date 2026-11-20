/**
 * Le fichier Excel d'un lancement (HIS-08). La première page résume : une ligne par élève et une ligne pour la classe, puis une ligne par fiche. Suit une page par
 * élève ayant rendu, avec toutes ses réponses. Ce fichier ne contient que des calculs, sans rien à l'écran : il se teste sans navigateur.
 */
import { gradeOf, meanGap, numberOf, placedPos, titleOf, usesMeters, visibleFiches } from '../model.js';
import { checkOf, columnTitle, questionFields, subtitleField, titleField, valueText } from '../fields.js';
import { VERDICT_LABELS, finalVerdicts, gradedQuestions } from '../verdicts.js';
import { dateAndTime, num } from '../util.js';
import { bold } from '../xlsx-write.js';

/** Les questions dont on fait la moyenne : celles qui attendent un nombre, comme les mesures. */
const numericQuestions = (project) => questionFields(project.template).filter((field) => field.type === 'number');
/** Ce qui nomme une fiche dans un tableau : son titre et son sous-titre, ou à défaut son titre tout court. */
const namedFields = (project) => [titleField(project.template), subtitleField(project.template)].filter(Boolean);

const round = (value, digits = 2) => (value === null || value === undefined ? null : +value.toFixed(digits));
const average = (values) => {
  const known = values.filter((value) => value !== null && value !== undefined);
  return known.length ? known.reduce((total, value) => total + value, 0) / known.length : null;
};
/** Un élève peut écrire ce qu'il veut dans une mesure : un nombre reste un nombre pour Excel, le reste reste du texte. */
const measureCell = (raw) => num(raw) ?? (raw || null);
/** La réponse d'un élève dans une cellule : un nombre pour une question chiffrée, sinon son texte (le libellé d'un choix). */
const answerCell = (field, raw) => (field.type === 'number' ? measureCell(raw) : valueText(field, raw) || null);

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
          : participant.afterCorrection
            ? 'A fini avant la fin'
            : 'A fini avant la fin, reçu après'
  ];
  if (participant.byFile) parts.push('par fichier');
  if (participant.afterCorrection) parts.push("reçu après l'envoi des corrections");
  if (participant.answersAfterEnd) parts.push(`${participant.answersAfterEnd} réponse(s) après la fin`);
  return parts.join(' · ');
}

/** Les colonnes des questions corrigées (QST-04) et de la note (QST-05), seulement quand le cours en a. */
const COUNT_KEYS = ['ok', 'half', 'wrong', 'pending'];
const countHeaders = (project) => (gradedQuestions(project.template).length ? ['Réponses justes', 'À moitié justes', 'Fausses', 'À corriger'] : []);
const markHeaders = (grading) => (grading && grading.mode !== 'none' ? ['Note', 'Sur', 'Provisoire ?'] : []);
const countCells = (project, participant) => (gradedQuestions(project.template).length ? COUNT_KEYS.map((key) => participant.answerCounts?.[key] ?? null) : []);
const markCells = (grading, participant) =>
  grading && grading.mode !== 'none'
    ? [round(participant.mark?.mark ?? null), round(participant.mark?.outOf ?? null), participant.mark?.provisional ? 'oui' : null]
    : [];

function summarySheet(project, participants, { title, openedAt, endedAt, grading }) {
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
    ...numericQuestions(project).map((field) => bold(`${columnTitle(field)}, moyenne`)),
    ...countHeaders(project).map(bold),
    ...markHeaders(grading).map(bold)
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
      ...numericQuestions(project).map((field) => round(studentMeasure(project, participant, field.id))),
      ...countCells(project, participant),
      ...markCells(grading, participant)
    ]);
  }
  const classAverage = (read) => round(average(handedIn.map(read)));
  rows.push([
    bold('Classe'),
    bold(`${handedIn.length} rendu(s) sur ${participants.length}`),
    ...['ok', 'near', 'far', 'unplaced'].map((state) => bold(classAverage((participant) => participant.results.score[state]))),
    bold(classAverage((participant) => meanGap(project, participant.results))),
    ...numericQuestions(project).map((field) => bold(classAverage((participant) => studentMeasure(project, participant, field.id)))),
    ...(countHeaders(project).length ? COUNT_KEYS.map((key) => bold(classAverage((participant) => participant.answerCounts?.[key] ?? null))) : []),
    ...(markHeaders(grading).length ? [bold(classAverage((participant) => participant.mark?.mark ?? null)), null, null] : [])
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
    ...numericQuestions(project).map((field) => bold(`${columnTitle(field)}, moyenne`))
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
        titleOf(fiche, project.template),
        answers.filter(({ entry }) => placedPos(entry)).length,
        answers.filter(({ result }) => result?.state === 'ok').length,
        round(average(answers.map(({ result }) => gapInUnit(project, map, result?.d)))),
        ...numericQuestions(project).map((field) => round(average(answers.map(({ entry }) => num(entry?.[field.id])))))
      ]);
    }
  }
  return {
    name: 'Synthèse',
    rows,
    widths: [
      28,
      34,
      12,
      10,
      10,
      12,
      22,
      ...numericQuestions(project).map(() => 22),
      ...countHeaders(project).map(() => 14),
      ...markHeaders(grading).map(() => 12)
    ]
  };
}

/** Le verdict d'une réponse, et le commentaire de l'enseignant s'il en a écrit un. */
function verdictCell(participant, verdicts, mapId, ficheId, questionId) {
  const verdict = verdicts[mapId]?.[ficheId]?.[questionId];
  if (!verdict) return null;
  const comment = participant.reviews?.[mapId]?.[ficheId]?.[questionId]?.comment;
  return comment ? `${VERDICT_LABELS[verdict]} · ${comment}` : VERDICT_LABELS[verdict];
}

function studentSheet(project, participant) {
  const unit = usesMeters(project) ? 'm' : '% du plan';
  const several = project.maps.length > 1;
  const named = namedFields(project);
  const questions = questionFields(project.template);
  const graded = (field) => checkOf(field) !== 'none';
  const verdicts = finalVerdicts(participant.results, participant.reviews);
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
      ...(named.length ? named.map((field) => bold(field.label)) : [bold('Fiche')]),
      bold('Résultat'),
      bold(`Écart (${unit})`),
      bold('Placement X (%)'),
      bold('Placement Y (%)'),
      bold('Position réelle X (%)'),
      bold('Position réelle Y (%)'),
      ...questions.flatMap((field) => [bold(columnTitle(field)), ...(graded(field) ? [bold('Verdict')] : [])]),
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
        ...(named.length ? named.map((field) => fiche[field.id] || null) : [titleOf(fiche, project.template)]),
        gradeOf(result.state).label,
        round(gapInUnit(project, map, result.d)),
        round(entry.x ?? null, 3),
        round(entry.y ?? null, 3),
        fiche.refX,
        fiche.refY,
        ...questions.flatMap((field) => [
          answerCell(field, entry[field.id]),
          ...(graded(field) ? [verdictCell(participant, verdicts, map.id, fiche.id, field.id)] : [])
        ]),
        late ? 'oui' : null
      ]);
    }
  }
  const widths = [
    8,
    10,
    ...(named.length ? named.map(() => 24) : [24]),
    20,
    14,
    14,
    14,
    18,
    18,
    ...questions.flatMap((field) => (graded(field) ? [16, 24] : [16])),
    18
  ];
  return { name: participant.names, rows, widths: several ? [16, ...widths] : widths };
}

/** @param sheets ce que répond GET /launches/:id/sheets, le cours étant déjà normalisé */
export function resultsWorkbook({ title, openedAt, endedAt, grace, project, participants, grading }) {
  const handedIn = participants.filter((participant) => participant.results).map((participant) => ({ ...participant, openedAt, endedAt, grace }));
  return [summarySheet(project, participants, { title, openedAt, endedAt, grading }), ...handedIn.map((participant) => studentSheet(project, participant))];
}
