/**
 * HIS-08 : le fichier Excel d'un lancement. Ces tests lisent le vrai fichier produit, sans navigateur, et vérifient chaque chiffre à la main.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultsWorkbook, stateText } from '../src/js/prof/results-workbook.js';
import { computeResults } from '../server/answers.mjs';
import { normalizeProject } from '../src/js/model.js';
import { uniqueNames, zipFiles } from '../src/js/zip.js';
import { bold, sheetNames, workbookBlob } from '../src/js/xlsx-write.js';
import { readZip, sheetRows } from './helpers.js';

const entry = (x, y, measures = {}) => ({ x, y, temperature: '', humidity: '', light: '', ...measures });
const project = (widthMeters = 100) =>
  normalizeProject({
    format: 'inventaire-botanique',
    version: 3,
    title: 'Sortie',
    theme: {},
    maps: [
      {
        id: 'm1',
        name: 'Parc',
        image: '',
        widthMeters,
        fiches: [
          { id: 'f1', ref: '1', common: 'Noisetier', species: 'Corylus', visible: true, refX: 40, refY: 60, media: [] },
          { id: 'f2', ref: '2', common: 'Sureau', visible: true, refX: 10, refY: 60, media: [] },
          { id: 'cachee', common: 'Masquée', visible: false, refX: 5, refY: 5, media: [] }
        ]
      }
    ]
  });

const student = (course, names, answers, extra = {}) => ({
  id: names,
  names,
  submittedAt: '2026-11-04T10:00:00.000Z',
  late: false,
  autoClosed: false,
  note: '',
  answers: { m1: answers },
  results: computeResults(course, { m1: answers }),
  ...extra
});
const absent = (names) => ({ id: names, names, submittedAt: null, answers: null, results: null });

function classOf(course = project()) {
  return [
    student(
      course,
      'Léa Dupont',
      { f1: entry(40, 60, { temperature: '20', humidity: '50', light: '1000' }), f2: entry(30, 60, { temperature: '22', humidity: '60' }) },
      { note: '14/20' }
    ),
    student(course, 'Tom Martin', { f1: entry(50, 60, { temperature: '24,5' }) }, { autoClosed: true, late: false }),
    absent('Noé Petit')
  ];
}

const workbook = (participants = classOf(), course = project()) =>
  resultsWorkbook({ title: 'Sortie', endedAt: '2026-11-04T11:00:00.000Z', grace: 30000, project: course, participants });
const summaryRow = (sheet, first) => sheet.rows.find((row) => row[0] === first || row[0]?.value === first);

test('HIS-08 : une page de synthèse au début, puis une page par élève ayant rendu', () => {
  assert.deepEqual(
    workbook().map((sheet) => sheet.name),
    ['Synthèse', 'Léa Dupont', 'Tom Martin']
  );
});

test('HIS-08 : la synthèse donne, par élève, son score, sa précision moyenne et la moyenne de ses trois mesures', () => {
  const [summary] = workbook();
  const lea = summaryRow(summary, 'Léa Dupont');
  assert.deepEqual(lea, ['Léa Dupont', 'A fini', 1, 0, 1, 0, 10, 21, 55, 1000]);
  const tom = summaryRow(summary, 'Tom Martin');
  assert.deepEqual(tom, ['Tom Martin', 'Figé à la fin du cours', 0, 1, 0, 1, 10, 24.5, null, null], '24,5 écrit à la française reste un nombre');
  const noe = summaryRow(summary, 'Noé Petit');
  assert.deepEqual(noe, ['Noé Petit', "N'a pas rendu", null, null, null, null, null, null, null, null]);
});

test('HIS-08 : la ligne de la classe fait la moyenne de ceux qui ont rendu, sans compter les absents ni les cases vides', () => {
  const [summary] = workbook();
  const row = summaryRow(summary, 'Classe');
  assert.deepEqual(
    row.map((cell) => cell?.value ?? cell),
    ['Classe', '2 rendu(s) sur 3', 0.5, 0.5, 0.5, 0.5, 10, 22.75, 55, 1000]
  );
});

test('HIS-08 : la synthèse donne aussi, pour chaque fiche, ce qu’a relevé la classe ; la fiche masquée n’y est pas', () => {
  const [summary] = workbook();
  const first = summary.rows.find((row) => row[1] === 'Noisetier');
  assert.deepEqual(first, [1, 'Noisetier', 2, 1, 5, 22.25, 50, 1000], 'placée 2 fois, 1 bien placée, écart moyen (0 + 10) / 2, température (20 + 24,5) / 2');
  const second = summary.rows.find((row) => row[1] === 'Sureau');
  assert.deepEqual(second, [2, 'Sureau', 1, 0, 20, 22, 60, null]);
  assert.equal(JSON.stringify(summary.rows).includes('Masquée'), false);
});

test('HIS-08 : sans échelle, la précision est en % du plan, et le titre le dit', () => {
  const course = project(null);
  const [summary] = workbook(classOf(course), course);
  assert.ok(JSON.stringify(summary.rows).includes('Précision moyenne (% du plan)'));
  assert.ok(JSON.stringify(summary.rows).includes('Écart moyen (% du plan)'));
  assert.equal(summaryRow(summary, 'Léa Dupont')[6], 10);
});

test('HIS-08 : avec une échelle, le titre dit mètres', () => {
  const [summary] = workbook();
  assert.ok(JSON.stringify(summary.rows).includes('Précision moyenne (m)'));
});

test('HIS-08 : un élève qui n’a placé aucune fiche n’a pas de précision, mais garde sa ligne', () => {
  const course = project();
  const [summary] = workbook([student(course, 'Rien', {})], course);
  const row = summaryRow(summary, 'Rien');
  assert.equal(row[5], 2, 'deux fiches non placées');
  assert.equal(row[6], null);
});

test('HIS-08 : la page d’un élève donne toutes ses réponses, fiche par fiche', () => {
  const [, lea] = workbook();
  assert.deepEqual(
    lea.rows[0].map((cell) => cell.value),
    ['Léa Dupont']
  );
  assert.deepEqual(lea.rows[1], ['A fini']);
  assert.deepEqual([lea.rows[2][0].value, lea.rows[2][1], lea.rows[2][2]], ['Précision moyenne', 10, 'm']);
  const noisetier = lea.rows.find((row) => row[2] === 'Noisetier');
  assert.deepEqual(noisetier, [1, '1', 'Noisetier', 'Corylus', 'Bien placée', 0, 40, 60, 40, 60, 20, 50, 1000, null]);
  const sureau = lea.rows.find((row) => row[2] === 'Sureau');
  assert.deepEqual(sureau, [2, '2', 'Sureau', null, 'À revoir', 20, 30, 60, 10, 60, 22, 60, null, null]);
  assert.equal(JSON.stringify(lea.rows).includes('Masquée'), false);
});

test('HIS-08 : une fiche non placée y figure aussi, et une mesure qui n’est pas un nombre reste telle quelle', () => {
  const course = project();
  const [, page] = workbook([student(course, 'Léa', { f1: entry(null, null, { temperature: 'il fait froid' }) })], course);
  const row = page.rows.find((cells) => cells[2] === 'Noisetier');
  assert.equal(row[4], 'Non placée');
  assert.equal(row[6], null);
  assert.equal(row[10], 'il fait froid');
  assert.equal(page.rows.find((cells) => cells[2] === 'Sureau')[4], 'Non placée');
});

test('CRG-13 : la page d’un élève signale chaque réponse faite après la fin du cours, passé le délai', () => {
  const course = project();
  const ended = Date.parse('2026-11-04T11:00:00.000Z');
  const answers = { f1: entry(40, 60, { at: ended + 60000 }), f2: entry(10, 60, { at: ended + 1000 }) };
  const [, page] = workbook([student(course, 'Léa', answers)], course);
  assert.equal(page.rows.find((cells) => cells[2] === 'Noisetier').at(-1), 'oui');
  assert.equal(page.rows.find((cells) => cells[2] === 'Sureau').at(-1), null);
});

test('HIS-08 : plusieurs cartes : chaque ligne dit la sienne', () => {
  const course = normalizeProject({
    ...project(),
    maps: [
      ...project().maps,
      { id: 'm2', name: 'Bois', image: '', widthMeters: 100, fiches: [{ id: 'f3', common: 'Tilleul', visible: true, refX: 1, refY: 1, media: [] }] }
    ]
  });
  const [summary, page] = workbook([student(course, 'Léa', { f1: entry(40, 60) })], course);
  assert.equal(summary.rows.find((row) => row[2] === 'Tilleul')[0], 'Bois');
  assert.equal(page.rows.find((row) => row[3] === 'Tilleul')[0], 'Bois');
});

test('stateText : l’enseignant lit tout ce qui compte', () => {
  const base = { submittedAt: 'x', late: false, autoClosed: false, byFile: false, answersAfterEnd: 0, finishedAfterEnd: false };
  assert.equal(stateText({ submittedAt: null }), "N'a pas rendu");
  assert.equal(stateText(base), 'A fini');
  assert.equal(stateText({ ...base, autoClosed: true }), 'Figé à la fin du cours');
  assert.equal(stateText({ ...base, late: true }), 'A fini avant la fin, reçu après');
  assert.equal(stateText({ ...base, late: true, finishedAfterEnd: true }), 'A fini après la fin du cours');
  assert.equal(stateText({ ...base, late: true, byFile: true }), 'A fini avant la fin, reçu après · par fichier');
  assert.equal(stateText({ ...base, autoClosed: true, answersAfterEnd: 2 }), 'Figé à la fin du cours · 2 réponse(s) après la fin');
});

/* --- Le fichier lui-même --- */

const fileOf = async (sheets) => readZip(Buffer.from(await workbookBlob(sheets).arrayBuffer()));
const textOf = (files, name) => files[name].toString('utf8');

test('xlsx : le fichier contient tout ce qu’un tableur attend, sous les bons noms', async () => {
  const files = await fileOf(workbook());
  for (const name of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet3.xml'
  ])
    assert.ok(files[name], name);
  assert.match(textOf(files, 'xl/workbook.xml'), /<sheet name="Synthèse" sheetId="1" r:id="rId1"\/><sheet name="Léa Dupont" sheetId="2" r:id="rId2"\/>/);
  assert.match(textOf(files, 'xl/_rels/workbook.xml.rels'), /Id="rId3"[^>]*Target="worksheets\/sheet3\.xml"/);
  assert.match(textOf(files, '[Content_Types].xml'), /sheet3\.xml/);
});

test('xlsx : un nombre est un nombre pour Excel, et un texte reste un texte, même s’il ressemble à une formule', async () => {
  const files = await fileOf([{ name: 'Essai', rows: [[bold('Titre'), 12.5, '=1+1', '+33 6 00', '@SOMME(A1)', '-2+3', 0, null, '']] }]);
  const xml = textOf(files, 'xl/worksheets/sheet1.xml');
  assert.deepEqual(sheetRows(xml)[0], ['Titre', 12.5, '=1+1', '+33 6 00', '@SOMME(A1)', '-2+3', 0]);
  assert.doesNotMatch(xml, /<f>/, 'aucune formule');
  assert.match(xml, /<c r="A1" s="1" t="inlineStr">/, 'le titre en gras');
  assert.match(xml, /<c r="C1" t="inlineStr">/);
  assert.match(xml, /<c r="B1"><v>12\.5<\/v><\/c>/);
});

test('xlsx : un nom piégé ne casse pas le fichier, et les caractères que XML refuse disparaissent', async () => {
  const trap = 'Tom <b>&"gras"\u0007';
  const files = await fileOf([{ name: trap, rows: [[trap]] }]);
  const xml = textOf(files, 'xl/worksheets/sheet1.xml');
  assert.equal(sheetRows(xml)[0][0], 'Tom <b>&"gras"');
  assert.doesNotMatch(xml, /\u0007/);
  assert.match(textOf(files, 'xl/workbook.xml'), /name="Tom &lt;b&gt;&amp;&quot;gras&quot;"/);
});

test('xlsx : les colonnes au-delà de Z ont le bon nom, et les largeurs sont écrites', async () => {
  const cells = Array.from({ length: 30 }, (_, index) => index);
  const files = await fileOf([{ name: 'Large', rows: [cells], widths: [10, 20] }]);
  const xml = textOf(files, 'xl/worksheets/sheet1.xml');
  assert.match(xml, /<c r="AD1"><v>29<\/v>/);
  assert.match(xml, /<col min="2" max="2" width="20" customWidth="1"\/>/);
  assert.deepEqual(sheetRows(xml)[0], cells);
});

test('xlsx : à l’impression, une page tient en largeur, en paysage', async () => {
  const xml = textOf(await fileOf([{ name: 'Essai', rows: [['a']] }]), 'xl/worksheets/sheet1.xml');
  assert.match(xml, /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.match(xml, /<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/);
  assert.ok(xml.indexOf('<sheetPr>') < xml.indexOf('<sheetData>') && xml.indexOf('<pageSetup') > xml.indexOf('</sheetData>'), 'Excel exige cet ordre');
});

test('xlsx : un nom de page reste accepté par Excel : 31 caractères, sans caractère interdit, et unique', () => {
  const [long, forbidden, first, second, third, empty, quoted] = sheetNames(['x'.repeat(50), 'a[b]c:d*e?f/g\\h', 'Tom', 'tom', 'TOM', '///', "'Léa'"]);
  assert.equal(long.length, 31);
  assert.equal(forbidden, 'a b c d e f g h');
  assert.equal(first, 'Tom');
  assert.equal(second, 'tom (2)');
  assert.equal(third, 'TOM (3)');
  assert.equal(empty, 'Page 6');
  assert.equal(quoted, 'Léa');
  const [a, b] = sheetNames(['y'.repeat(40), 'y'.repeat(40)]);
  assert.equal(b, 'y'.repeat(27) + ' (2)');
  assert.ok(a !== b && b.length <= 31);
});

test('zip : une archive garde les noms accentués et le contenu au bit près', async () => {
  const data = Uint8Array.from({ length: 256 }, (_, index) => index);
  const zip = zipFiles([
    { name: 'Compte rendu - Léa.jpg', data },
    { name: 'texte.txt', data: 'bonjour é' }
  ]);
  const files = readZip(Buffer.from(await zip.arrayBuffer()));
  assert.deepEqual([...files['Compte rendu - Léa.jpg']], [...data]);
  assert.equal(files['texte.txt'].toString(), 'bonjour é');
  assert.equal(zip.type, 'application/zip');
});

test('zip : le contrôle de chaque fichier est le bon : une archive fausse serait refusée à l’ouverture', async () => {
  const zip = zipFiles([{ name: 'a.txt', data: 'The quick brown fox jumps over the lazy dog' }]);
  const buffer = Buffer.from(await zip.arrayBuffer());
  assert.equal(buffer.readUInt32LE(14), 0x414fa339, 'valeur de référence du CRC-32 pour cette phrase');
});

test('uniqueNames : deux élèves de même nom ne s’écrasent pas', () => {
  assert.deepEqual(uniqueNames(['Tom', 'Léa', 'Tom', 'tom']), ['Tom', 'Léa', 'Tom (2)', 'tom (3)']);
});
