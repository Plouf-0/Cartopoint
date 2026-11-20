/**
 * L'onglet « Éditeur de fiches » (MOD-03), pour ce qui se vérifie sans navigateur. Les écrans sont vérifiés dans
 * tests/e2e/template-editor.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDGETS, blankField, summaryText } from '../src/js/prof/template-tab.js';
import { templateProblems } from '../src/js/fields.js';
import { BOTANIQUE } from '../src/js/templates/botanique.js';

const question = (id, type, check) => ({ id, type, label: id, audience: 'question', ...(check ? { check } : {}) });

test('MOD-04 : le résumé dit combien de questions seront corrigées automatiquement, par l’enseignant, ou pas du tout', () => {
  assert.equal(summaryText(BOTANIQUE), '3 questions : 3 non corrigées.');
  assert.equal(
    summaryText({ fields: [question('a', 'yesno'), question('b', 'scale'), question('c', 'text'), question('d', 'number'), question('e', 'text', 'auto')] }),
    '5 questions : 3 corrigées automatiquement, 1 à corriger par vous, 1 non corrigée.'
  );
  assert.equal(summaryText({ fields: [question('a', 'longtext')] }), '1 question : 1 à corriger par vous.');
  assert.match(summaryText({ fields: [{ id: 'c-a', type: 'text', label: 'Nom', audience: 'info' }] }), /^Aucune question/);
});

test('MOD-09 : chaque élément vierge glissé dans la fiche est déjà valide, avec un libellé de départ à remplacer', () => {
  for (const key of Object.keys(WIDGETS)) {
    const field = blankField(key);
    assert.deepEqual(templateProblems({ fields: [field] }), [], key);
    assert.equal(field.type, WIDGETS[key].field.type);
  }
  assert.equal(blankField('choice').choices.length, 2, 'deux propositions, le minimum');
  assert.equal(blankField('scale').max, 5);
  assert.notEqual(blankField('text').id, blankField('text').id, 'un identifiant neuf à chaque fois');
  assert.match(blankField('heading').id, /^h-/);
});

test('MOD-09 : chaque élément vierge dit d’avance qui le remplit, et comment une question se corrige', () => {
  const made = (key) => {
    const { id, choices, max, ...rest } = blankField(key);
    return rest;
  };
  assert.deepEqual(made('title'), { type: 'text', label: 'Titre', audience: 'info', role: 'title', search: true });
  assert.deepEqual(made('subtitle'), { type: 'text', label: 'Sous-titre', audience: 'info', role: 'subtitle', search: true });
  assert.deepEqual(made('text'), { type: 'text', label: 'Nouveau champ', audience: 'info', search: true }, 'à remplir dans chaque fiche, et cherché');
  assert.deepEqual(made('date'), { type: 'date', label: 'Date', audience: 'info' });
  assert.deepEqual(made('q-choice'), { type: 'choice', label: 'Nouvelle question', audience: 'question', check: 'auto' });
  assert.deepEqual(made('q-text'), { type: 'text', label: 'Nouvelle question', audience: 'question', check: 'auto' });
  assert.deepEqual(made('q-number'), { type: 'number', label: 'Nouvelle question', audience: 'question', check: 'auto' });
  assert.deepEqual(made('q-written'), { type: 'longtext', label: 'Nouvelle question', audience: 'question', check: 'teacher' });
  assert.deepEqual(made('q-measure'), { type: 'number', label: 'Nouvelle mesure', audience: 'question', check: 'none' });
  assert.deepEqual(made('q-note'), { type: 'longtext', label: 'Nouvelle question', audience: 'question', check: 'none' });
  assert.deepEqual(made('reveal'), { type: 'longtext', label: 'Explication', audience: 'correction' });
  assert.deepEqual(made('private'), { type: 'longtext', label: 'Note', audience: 'teacher' });
  assert.deepEqual(made('heading'), { type: 'heading', label: 'Intertitre' });
});
