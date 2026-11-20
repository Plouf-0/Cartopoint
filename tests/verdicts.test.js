/**
 * La correction des questions (QST) : la réponse attendue de chaque fiche, et le verdict de chaque réponse d'élève.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ACCEPTED,
  answerCounts,
  finalVerdicts,
  gradingProblem,
  markOf,
  markText,
  normalizeGrading,
  autoQuestions,
  autoVerdict,
  comparable,
  countVerdicts,
  expectedProblem,
  expectedText,
  normalizeExpected,
  normalizeExpectedOf,
  questionVerdicts
} from '../src/js/verdicts.js';
import { BOTANIQUE } from '../src/js/templates/botanique.js';

const choices = (...ids) => ids.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
const Q = {
  nom: { id: 'c-nom', type: 'text', label: 'Nom', audience: 'question', check: 'auto' },
  avis: { id: 'c-avis', type: 'longtext', label: 'Avis', audience: 'question' },
  hauteur: { id: 'c-hauteur', type: 'number', label: 'Hauteur', unit: 'm', audience: 'question', check: 'auto' },
  mesure: { id: 'c-mesure', type: 'number', label: 'Température', audience: 'question' },
  style: { id: 'c-style', type: 'choice', label: 'Style', audience: 'question', choices: choices('roman', 'gothique') },
  mat: { id: 'c-mat', type: 'choice', label: 'Matériaux', audience: 'question', multiple: true, choices: choices('pierre', 'bois', 'brique') },
  ouvert: { id: 'c-ouvert', type: 'yesno', label: 'Ouvert ?', audience: 'question' },
  etat: { id: 'c-etat', type: 'scale', label: 'État', audience: 'question', max: 4, symbol: '⭐' }
};
const QUIZ = { fields: [{ id: 'c-info', type: 'text', label: 'Info', audience: 'info' }, ...Object.values(Q)] };

test('QST-01 : une réponse attendue a une forme par type ; ce qui n’en est pas une n’en devient pas une', () => {
  assert.deepEqual(normalizeExpected(Q.hauteur, { value: '12,5', tolerance: '0,5' }), { value: 12.5, tolerance: 0.5 });
  assert.deepEqual(normalizeExpected(Q.hauteur, { value: 3 }), { value: 3, tolerance: 0 });
  assert.deepEqual(normalizeExpected(Q.hauteur, { value: 3, tolerance: -2 }), { value: 3, tolerance: 0 }, 'pas de tolérance négative');
  assert.equal(normalizeExpected(Q.hauteur, { value: 'haut' }), undefined);
  assert.deepEqual(
    normalizeExpected(Q.nom, [' Chêne ', 'chene', 'Chêne vert', '', 12]),
    ['Chêne', 'Chêne vert', '12'],
    'les doublons à un accent près disparaissent'
  );
  assert.deepEqual(normalizeExpected(Q.nom, 'Hêtre'), ['Hêtre']);
  assert.equal(normalizeExpected(Q.nom, ['', '  ']), undefined);
  assert.equal(
    normalizeExpected(
      Q.nom,
      Array.from({ length: 30 }, (_, i) => `r${i}`)
    ).length,
    MAX_ACCEPTED
  );
  assert.equal(normalizeExpected(Q.style, 'gothique'), 'gothique');
  assert.equal(normalizeExpected(Q.style, 'baroque'), undefined);
  assert.deepEqual(normalizeExpected(Q.mat, ['bois', 'marbre']), ['bois']);
  assert.equal(normalizeExpected(Q.mat, []), undefined);
  assert.equal(normalizeExpected(Q.ouvert, 'non'), 'non');
  assert.equal(normalizeExpected(Q.etat, '3'), 3);
  assert.equal(normalizeExpected(Q.etat, 9), undefined);
  for (const field of Object.values(Q)) assert.equal(normalizeExpected(field, null), undefined, field.id);
});

test('QST-01 : seules les questions corrigées automatiquement gardent leur réponse attendue', () => {
  assert.deepEqual(
    autoQuestions(QUIZ).map((field) => field.id),
    ['c-nom', 'c-hauteur', 'c-style', 'c-mat', 'c-ouvert', 'c-etat']
  );
  assert.deepEqual(autoQuestions(BOTANIQUE), [], 'les mesures ne se corrigent pas');
  assert.deepEqual(
    normalizeExpectedOf({ 'c-nom': 'Chêne', 'c-avis': 'Beau', 'c-mesure': { value: 20 }, 'c-info': 'x', 'c-style': 'roman', inconnu: 1 }, QUIZ),
    { 'c-nom': ['Chêne'], 'c-style': 'roman' }
  );
  for (const bad of [undefined, null, 'texte', ['c-nom']]) assert.deepEqual(normalizeExpectedOf(bad, QUIZ), {});
});

test('CHP-07, QST-01 : le serveur n’accepte que des réponses attendues déjà normales, à des questions corrigées automatiquement', () => {
  assert.equal(expectedProblem(undefined, QUIZ), '');
  assert.equal(expectedProblem({ 'c-nom': ['Chêne'], 'c-hauteur': { value: 12, tolerance: 1 }, 'c-mat': ['bois'] }, QUIZ), '');
  for (const [bad, reason] of [
    ['texte', /illisibles/],
    [['c-nom'], /illisibles/],
    [{ 'c-avis': 'Beau' }, /ne se corrige pas automatiquement/],
    [{ 'c-mesure': { value: 20, tolerance: 0 } }, /ne se corrige pas automatiquement/],
    [{ inconnu: 1 }, /ne se corrige pas automatiquement/],
    [{ 'c-nom': 'Chêne' }, /invalide pour « Nom »/],
    [{ 'c-nom': ['Chêne', 'chene'] }, /invalide/],
    [{ 'c-hauteur': { value: '12', tolerance: 1 } }, /invalide pour « Hauteur »/],
    [{ 'c-hauteur': { value: 12 } }, /invalide/],
    [{ 'c-style': 'baroque' }, /invalide pour « Style »/],
    [{ 'c-mat': [] }, /invalide/],
    [{ 'c-etat': '3' }, /invalide/]
  ]) {
    assert.match(expectedProblem(bad, QUIZ), reason, JSON.stringify(bad));
  }
});

test('QST-02 : chaque type a sa règle : texte sans accents ni majuscules, nombre dans sa tolérance, choix multiple complet', () => {
  assert.equal(comparable('  Chêne   VERT '), 'chene vert');
  const cases = [
    [Q.nom, ['Chêne', 'Chêne vert'], 'chene vert', 'ok'],
    [Q.nom, ['Chêne'], ' CHÊNE ', 'ok'],
    [Q.nom, ['Chêne'], 'Chênes', 'wrong'],
    [Q.hauteur, { value: 12, tolerance: 0.5 }, '12,4', 'ok'],
    [Q.hauteur, { value: 12, tolerance: 0.5 }, '12.5', 'ok'],
    [Q.hauteur, { value: 12, tolerance: 0.5 }, '12,6', 'wrong'],
    [Q.hauteur, { value: 0.3, tolerance: 0.1 }, '0,2', 'ok'],
    [Q.hauteur, { value: 12, tolerance: 0 }, 'douze', 'wrong'],
    [Q.style, 'gothique', 'gothique', 'ok'],
    [Q.style, 'gothique', 'roman', 'wrong'],
    [Q.mat, ['pierre', 'bois'], ['bois', 'pierre'], 'ok'],
    [Q.mat, ['pierre', 'bois'], ['pierre'], 'wrong'],
    [Q.mat, ['pierre'], ['pierre', 'bois'], 'wrong'],
    [Q.ouvert, 'non', 'non', 'ok'],
    [Q.ouvert, 'non', 'oui', 'wrong'],
    [Q.etat, 3, 3, 'ok'],
    [Q.etat, 3, 2, 'wrong']
  ];
  for (const [field, expected, answer, verdict] of cases) assert.equal(autoVerdict(field, expected, answer), verdict, `${field.id} ${JSON.stringify(answer)}`);
  for (const empty of ['', [], undefined]) assert.equal(autoVerdict(Q.style, 'roman', empty), 'wrong', 'sans réponse, c’est faux');
});

test('QST-02 : une fiche a un verdict par question corrigée ; ouverte ou sans réponse attendue, elle attend l’enseignant', () => {
  const fiche = { expected: { 'c-nom': ['Chêne'], 'c-style': 'roman', 'c-mat': ['bois'] } };
  const entry = { 'c-nom': 'chene', 'c-avis': 'Très beau', 'c-mesure': '21', 'c-style': 'gothique', 'c-ouvert': 'oui', 'c-hauteur': '' };
  assert.deepEqual(questionVerdicts(QUIZ, fiche, entry), {
    'c-nom': 'ok',
    'c-avis': 'pending',
    'c-hauteur': 'wrong',
    'c-style': 'wrong',
    'c-mat': 'wrong',
    'c-ouvert': 'pending',
    'c-etat': 'wrong'
  });
  assert.deepEqual(questionVerdicts(BOTANIQUE, {}, { temperature: '21' }), {}, 'une mesure n’a pas de verdict');
  assert.deepEqual(countVerdicts([{ a: 'ok', b: 'pending' }, { a: 'wrong', b: 'half' }, {}]), { ok: 1, half: 1, wrong: 1, pending: 1 });
});

test('QST-03 : la bonne réponse se lit en clair dans la correction', () => {
  assert.equal(expectedText(Q.hauteur, { value: 12.5, tolerance: 0.5 }), '12,5 m (à 0,5 près)');
  assert.equal(expectedText(Q.hauteur, { value: 12, tolerance: 0 }), '12 m');
  assert.equal(expectedText(Q.nom, ['Chêne', 'Chêne vert']), 'Chêne ou Chêne vert');
  assert.equal(expectedText(Q.mat, ['pierre', 'bois']), 'Pierre, Bois');
  assert.equal(expectedText(Q.style, 'roman'), 'Roman');
  assert.equal(expectedText(Q.ouvert, 'oui'), 'Oui');
  assert.equal(expectedText(Q.etat, 3), '⭐⭐⭐');
  assert.equal(expectedText({ ...Q.etat, symbol: undefined }, 3), '3');
  assert.equal(expectedText(Q.nom, undefined), '');
});

test('QST-04 : le verdict de l’enseignant l’emporte sur celui du serveur, question par question', () => {
  const results = {
    maps: { m1: { fiches: { f1: { state: 'ok', questions: { a: 'pending', b: 'wrong' } }, f2: { state: 'far' } } } },
    answers: { ok: 0, half: 0, wrong: 1, pending: 1 }
  };
  const reviews = { m1: { f1: { a: { verdict: 'half', comment: 'Presque.' }, b: { verdict: 'ok' } } } };
  assert.deepEqual(finalVerdicts(results, reviews), { m1: { f1: { a: 'half', b: 'ok' } } });
  assert.deepEqual(finalVerdicts(results, {}), { m1: { f1: { a: 'pending', b: 'wrong' } } });
  assert.deepEqual(answerCounts(results, reviews), { ok: 1, half: 1, wrong: 0, pending: 0 });
  assert.equal(answerCounts({ maps: {} }, reviews), null, 'sans question corrigée, pas de décompte');
});

const NOTE = {
  fields: [
    { id: 'q1', type: 'yesno', label: 'Q1', audience: 'question' },
    { id: 'q2', type: 'longtext', label: 'Q2', audience: 'question' },
    { id: 'mesure', type: 'number', label: 'Mesure', audience: 'question' }
  ]
};

test('QST-05 : une notation se lit sous sa forme normale ; ce qui ne se lit pas redevient « sans note »', () => {
  for (const raw of [undefined, null, 'auto', { mode: 'inconnu' }]) assert.deepEqual(normalizeGrading(raw, NOTE), { mode: 'none' });
  assert.deepEqual(normalizeGrading({ mode: 'auto' }, NOTE), { mode: 'auto', max: 20, placement: true });
  assert.deepEqual(normalizeGrading({ mode: 'auto', max: '10', placement: false }, NOTE), { mode: 'auto', max: 10, placement: false });
  assert.deepEqual(normalizeGrading({ mode: 'auto', max: -3 }, NOTE), { mode: 'auto', max: 20, placement: true });
  assert.deepEqual(
    normalizeGrading({ mode: 'points', points: { q1: 2, q2: 1, mesure: 5, inconnue: 3 }, placement: '0,5' }, NOTE),
    { mode: 'points', points: { q1: 2 }, placement: 0.5 },
    'une question vaut 1 point sans barème ; une mesure ne compte pas'
  );
  assert.deepEqual(normalizeGrading({ mode: 'points', points: { q1: 1000 } }, NOTE), { mode: 'points', points: { q1: 100 }, placement: 1 });
  assert.equal(gradingProblem(undefined, NOTE), '');
  assert.equal(gradingProblem({ mode: 'points', points: { q1: 2 }, placement: 0.5 }, NOTE), '');
  for (const bad of [
    { mode: 'points', points: { mesure: 2 }, placement: 1 },
    { mode: 'points', points: { q1: -1 }, placement: 1 },
    { mode: 'auto', max: 20 },
    { mode: 'none', extra: 1 },
    'auto'
  ]) {
    assert.equal(gradingProblem(bad, NOTE), 'notation invalide', JSON.stringify(bad));
  }
});

/** Deux fiches : l'une bien placée, l'autre proche ; une question juste, une à moitié, une fausse, une à corriger. */
const RESULTS = {
  maps: {
    m1: {
      fiches: {
        f1: { state: 'ok', questions: { q1: 'ok', q2: 'pending' } },
        f2: { state: 'near', questions: { q1: 'wrong', q2: 'half' } },
        f3: { state: 'noref', questions: { q1: 'ok', q2: 'ok' } }
      }
    }
  }
};

test('QST-05 : la note se calcule à la lecture ; une réponse à corriger compte zéro, et la note est alors provisoire', () => {
  const project = { template: NOTE };
  assert.equal(markOf(project, { mode: 'none' }, RESULTS, {}), null);
  // Note automatique : 6 réponses et 2 placements notés ; justes 3 + placement 1, à moitié 1 + placement 1 : (4 + 1) / 8 × 20
  assert.deepEqual(markOf(project, normalizeGrading({ mode: 'auto' }, NOTE), RESULTS, {}), { mark: 12.5, outOf: 20, provisional: true, pending: 1 });
  assert.deepEqual(markOf(project, normalizeGrading({ mode: 'auto', placement: false }, NOTE), RESULTS, {}), {
    mark: (3.5 / 6) * 20,
    outOf: 20,
    provisional: true,
    pending: 1
  });
  const reviewed = { m1: { f1: { q2: { verdict: 'ok' } } } };
  assert.deepEqual(
    markOf(project, normalizeGrading({ mode: 'auto', max: 10 }, NOTE), RESULTS, reviewed),
    { mark: 7.5, outOf: 10, provisional: false, pending: 0 },
    'corrigée, la note monte'
  );
  // Barème : q1 vaut 2, q2 1, le placement 0,5 : justes 2 + 2 + 1, à moitié 0,5, placements 0,5 + 0,25
  const points = normalizeGrading({ mode: 'points', points: { q1: 2 }, placement: 0.5 }, NOTE);
  assert.deepEqual(markOf(project, points, RESULTS, reviewed), {
    mark: 2 + 1 + 0.5 + 2 + 1 + 0.5 + 0.25,
    outOf: 3 * 3 + 2 * 0.5,
    provisional: false,
    pending: 0
  });
  assert.equal(
    markOf(project, normalizeGrading({ mode: 'points', placement: 0 }, NOTE), { maps: { m1: { fiches: { f1: { state: 'ok' } } } } }, {}),
    null,
    'rien à noter'
  );
  assert.equal(markOf(project, normalizeGrading({ mode: 'auto' }, NOTE), null, {}), null, 'pas rendu');
});

test('QST-05 : une note se lit au dixième, et dit qu’elle est provisoire', () => {
  assert.equal(markText({ mark: 12.4999, outOf: 20, provisional: false, pending: 0 }), '12,5 / 20');
  assert.equal(markText({ mark: 8.25, outOf: 9.5, provisional: true, pending: 3 }), '8,3 / 9,5 (provisoire, 3 à corriger)');
  assert.equal(markText(null), '');
});
