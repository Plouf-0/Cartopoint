import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorText, formatSize } from '../src/js/util.js';

test('EV-04 : le texte d’une erreur n’est jamais « undefined », quoi qu’on ait reçu', () => {
  assert.equal(errorText(new Error('place insuffisante')), 'place insuffisante');
  assert.equal(errorText({ name: 'QuotaExceededError', message: '' }), 'QuotaExceededError');
  assert.equal(errorText({ name: 'AbortError' }), 'AbortError');
  assert.equal(errorText('texte'), 'texte');
  for (const nothing of [null, undefined, {}, 12, '', new Error('')]) {
    assert.match(errorText(nothing), /inconnue|^Error$/, String(nothing));
    assert.doesNotMatch(errorText(nothing), /undefined|null/);
  }
});

test('ADM-04 : une taille se lit en Ko ou en Mo', () => {
  assert.equal(formatSize(0), '1 Ko');
  assert.equal(formatSize(1200), '1 Ko');
  assert.equal(formatSize(850e3), '850 Ko');
  assert.equal(formatSize(1.25e6).replace(/\s/g, ' '), '1,3 Mo');
  assert.equal(formatSize(4e6), '4 Mo');
});
