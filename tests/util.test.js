import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorText, formatSize, today } from '../src/js/util.js';

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

test('EDI-05 : la date du jour est celle de l’appareil : juste après minuit à Paris, c’est déjà le lendemain', (t) => {
  const zone = process.env.TZ;
  process.env.TZ = 'Europe/Paris';
  t.after(() => (zone === undefined ? delete process.env.TZ : (process.env.TZ = zone)));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-19T23:30:00Z') });
  assert.equal(today(), '2026-11-20', '0 h 30 à Paris, 23 h 30 en temps universel');
  t.mock.timers.setTime(Date.parse('2026-03-05T12:00:00Z'));
  assert.equal(today(), '2026-03-05', 'mois et jour sur deux chiffres');
});
