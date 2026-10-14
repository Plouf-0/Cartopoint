import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, cellValue, mapHeaders, planImport, buildCsv, buildTeacherCsv } from '../src/js/spreadsheet.js';
import { normalizeFiche } from '../src/js/model.js';

test('CSV français : séparateur ;, guillemets, retours à la ligne', () => {
  const rows = parseCSV('﻿Nom commun;Description\r\nOlivier;"Arbre ; persistant"\r\n"Chêne ""vert""";"ligne 1\nligne 2"\r\n');
  assert.deepEqual(rows, [
    ['Nom commun', 'Description'],
    ['Olivier', 'Arbre ; persistant'],
    ['Chêne "vert"', 'ligne 1\nligne 2']
  ]);
});

test('titres de colonnes reconnus avec souplesse', () => {
  assert.deepEqual(mapHeaders(['N° photo', 'NOM COMMUN', 'Température (°C)', 'Luminosité', 'Couleur']), ['ref', 'common', 'temperature', 'light', null]);
});

test('valeurs : dates, oui/non, positions', () => {
  assert.equal(cellValue('date', '12/09/2026'), '2026-09-12');
  assert.equal(cellValue('date', '46277'), '2026-09-12'); // n° de série Excel
  assert.equal(cellValue('visible', 'non'), false);
  assert.equal(cellValue('visible', 'oui'), true);
  assert.equal(cellValue('refX', '30,5 %'), 30.5);
  assert.equal(cellValue('refX', '150'), 100);
});

test('import : complète par réf. photo, même quand une réf. est en double', () => {
  const existing = [
    normalizeFiche({ ref: '2', common: "Romarin d'Australie" }),
    normalizeFiche({ ref: '2', common: 'Sauge de Graham', species: 'Salvia microphylla' })
  ];
  const rows = [
    ['Réf. photo', 'Nom commun', 'Nom scientifique'],
    ['2', 'Sauge de Graham', 'Salvia microphylla'],
    ['2', "Romarin d'Australie", ''],
    ['', 'Olivier', 'Olea europaea'],
    ['', '', '']
  ];
  const plan = planImport(rows, existing);
  assert.equal(plan.updated, 2);
  assert.equal(plan.added, 1);
  assert.equal(plan.ops[0].existing, existing[1], 'la sauge va sur la fiche de la sauge');
  assert.equal(plan.ops[1].existing, existing[0], 'le romarin sur celle du romarin');
});

test('export CSV puis relecture : mêmes valeurs', () => {
  const f = normalizeFiche({ id: 'x', ref: '5a', common: 'Olivier ; arbre', exposure: '☀️☀️ Soleil', visible: false, refX: 12.345, refY: 50 });
  const csv = buildCsv([f], { entries: { x: { temperature: '21,5' } } });
  const [head, row] = parseCSV(csv);
  const keys = mapHeaders(head);
  const get = (k) => row[keys.indexOf(k)];
  assert.equal(get('common'), 'Olivier ; arbre');
  assert.equal(get('exposure'), '☀️☀️ Soleil');
  assert.equal(get('visible'), 'non');
  assert.equal(get('refX'), '12,35');
  assert.equal(get('temperature'), '21,5');
});

test('rendu prof : mesures, écart et ligne de moyenne', () => {
  const row = (n, common, entry, ev) => ({ n, fiche: normalizeFiche({ ref: String(n), common }), entry, ev });
  const csv = buildTeacherCsv(
    [
      row(1, 'Olivier', { temperature: '20', humidity: '50,5', light: '1000' }, { state: 'ok', label: 'Bien placée', d: 2 }),
      row(2, 'Chêne; vert', { temperature: '22.5', humidity: '', light: 'nuageux' }, { state: 'far', label: 'À revoir', d: 12 }),
      row(3, 'Romarin', {}, { state: 'noref', label: 'Pas de position réelle' })
    ],
    { names: 'Léa et Tom', widthMeters: 50 }
  );
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Élèves;N°;Réf. photo;Nom commun;Nom scientifique;Température (°C);Hygrométrie (%);Éclairement (lux);Résultat;Écart (m)');
  assert.equal(lines[1], 'Léa et Tom;1;1;Olivier;;20;50,5;1000;Bien placée;1');
  assert.equal(lines[2], 'Léa et Tom;2;2;"Chêne; vert";;22,5;;nuageux;À revoir;6');
  assert.equal(lines[3], 'Léa et Tom;3;3;Romarin;;;;;Pas de position réelle;');
  assert.equal(lines[4], 'Léa et Tom;;;Moyenne;;21,25;50,5;1000;1 / 2 bien placée(s);3,5');
});
