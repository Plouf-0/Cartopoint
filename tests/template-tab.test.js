/**
 * L'onglet « Modèle de fiche » (MOD-03), pour ce qui se vérifie sans navigateur. Les écrans sont vérifiés dans
 * tests/e2e/template-editor.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankField, summaryText } from '../src/js/prof/template-tab.js';
import { TYPES, templateProblems } from '../src/js/fields.js';
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
  for (const type of TYPES) {
    const field = blankField(type);
    assert.deepEqual(templateProblems({ fields: [field] }), [], type);
    assert.equal(field.type, type);
  }
  assert.equal(blankField('choice').choices.length, 2, 'deux propositions, le minimum');
  assert.equal(blankField('date').audience, 'info', 'une date n’est pas une question');
  assert.notEqual(blankField('text').id, blankField('text').id, 'un identifiant neuf à chaque fois');
});
