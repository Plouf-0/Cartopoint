import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calledFunctions, coveredLines, mergeCalled, sourceLines, summarize } from '../scripts/browser-coverage.mjs';

const range = (startOffset, endOffset, count) => ({ startOffset, endOffset, count });

test('un fichier entièrement exécuté a toutes ses lignes couvertes', () => {
  const source = 'const a = 1;\nconst b = 2;\n';
  assert.deepEqual(coveredLines(source, [{ ranges: [range(0, source.length, 1)] }]), { total: 2, covered: [1, 2] });
});

test('une fonction jamais appelée rend ses lignes non couvertes, même imbriquée dans du code exécuté', () => {
  const source = 'const a = 1;\nfunction f() {\n  return 2;\n}\nconst b = 3;';
  const start = source.indexOf('function');
  const end = source.indexOf('}') + 1;
  const functions = [{ ranges: [range(0, source.length, 1)] }, { ranges: [range(start, end, 0)] }];
  assert.deepEqual(coveredLines(source, functions).covered, [1, 5]);
});

test('le détail d’une branche non exécutée dans une fonction appelée est vu, et l’ordre des plages ne change rien', () => {
  const source = 'function f(x) {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}';
  const branch = source.indexOf('{\n    return 1');
  const functions = [{ ranges: [range(0, source.length, 1), range(branch, source.indexOf('}') + 1, 0)] }];
  const reversed = [{ ranges: [...functions[0].ranges].reverse() }];
  assert.deepEqual(coveredLines(source, functions).covered, [1, 2, 5, 6]);
  assert.deepEqual(coveredLines(source, reversed).covered, [1, 2, 5, 6]);
});

test('une ligne en partie exécutée compte comme couverte', () => {
  const source = 'const x = a ? 1 : 2;';
  const functions = [{ ranges: [range(0, source.length, 1), range(source.indexOf('1'), source.indexOf('1') + 1, 0)] }];
  assert.deepEqual(coveredLines(source, functions).covered, [1]);
});

test('les lignes vides suivent le code qui les entoure', () => {
  const source = 'const a = 1;\n\nfunction f() {\n\n}\n';
  const start = source.indexOf('function');
  const functions = [{ ranges: [range(0, source.length, 1), range(start, source.length, 0)] }];
  assert.deepEqual(coveredLines(source, functions).covered, [1, 2]);
});

test('seuls les fichiers de /js/ sont gardés, et plusieurs chargements s’additionnent', () => {
  const source = 'a;\nb;';
  const line1 = [{ ranges: [range(0, 2, 1), range(3, 5, 0)] }];
  const line2 = [{ ranges: [range(0, 2, 0), range(3, 5, 1)] }];
  const files = summarize([
    { url: 'http://site/js/api.js', source, functions: line1 },
    { url: 'http://site/js/api.js', source, functions: line2 },
    { url: 'http://site/js/ui.js?v=1', source, functions: line1 },
    { url: 'http://site/prof', source, functions: line1 },
    { url: 'http://site/autre.js', source, functions: line1 },
    { url: 'http://site/js/sans-source.js', functions: line1 }
  ]);
  assert.deepEqual(Object.keys(files).sort(), ['src/js/api.js', 'src/js/ui.js']);
  assert.deepEqual(files['src/js/api.js'].covered.sort(), [1, 2]);
  assert.equal(files['src/js/api.js'].total, 2);
  assert.deepEqual(files['src/js/ui.js'].covered, [1]);
});

test('la ligne vide après le dernier retour à la ligne ne compte pas : un fichier ne dépasse jamais 100 %', () => {
  assert.deepEqual(sourceLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(sourceLines('a\nb'), ['a', 'b']);
  assert.deepEqual(sourceLines('a\n\nb\n\n'), ['a', '', 'b', '']);
  const source = 'a;\nb;\n';
  const { total, covered } = coveredLines(source, [{ ranges: [range(0, source.length, 1)] }]);
  assert.ok(covered.length <= total);
});

test('une fonction compte comme appelée, ou non, à sa position ; la plage du fichier entier n’en est pas une', () => {
  const source = 'function f() {}\nfunction g() {}\n';
  const functions = [{ ranges: [range(0, source.length, 1)] }, { ranges: [range(0, 15, 1)] }, { ranges: [range(16, 31, 0), range(20, 25, 1)] }];
  assert.deepEqual(calledFunctions(source, functions), { 0: true, 16: false });
});

test('une fonction appelée dans un seul test compte comme appelée, quel que soit l’ordre', () => {
  assert.deepEqual(mergeCalled({ 1: false, 2: true }, { 1: true, 2: false, 3: false }), { 1: true, 2: true, 3: false });
  const source = 'a;\nb;';
  const files = summarize([
    { url: 'http://site/js/api.js', source, functions: [{ ranges: [range(0, 2, 0)] }] },
    { url: 'http://site/js/api.js', source, functions: [{ ranges: [range(0, 2, 1)] }] }
  ]);
  assert.deepEqual(files['src/js/api.js'].functions, { 0: true });
});
