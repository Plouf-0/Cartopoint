/**
 * La liste de scripts/mutants.mjs : un texte que le formatage ou une modification a changé ne se voit sinon qu'au bout d'une
 * longue série, qui l'annonce alors comme introuvable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const script = readFileSync(path.join(ROOT, 'scripts/mutants.mjs'), 'utf8');
const between = (start, end) => {
  const from = script.indexOf(start);
  return script.slice(from + start.length, script.indexOf(end, from));
};
// Ces listes ne contiennent que du texte : les lire ainsi évite de lancer le script, qui démarrerait toute la série
const evaluate = (source) => new Function(`return ${source}`)();
const MUTANTS = evaluate(`[${between('const MUTANTS = [', '\n];')}]`);
const TESTS_FOR = evaluate(`{${between('const TESTS_FOR = {', '\n};')}}`);

test('chaque mutant retrouve son texte dans son fichier, et le change vraiment', () => {
  assert.ok(MUTANTS.length > 300, `${MUTANTS.length} mutants lus`);
  const missing = MUTANTS.filter(([, file, from]) => !readFileSync(path.join(ROOT, file), 'utf8').includes(from)).map(([name]) => name);
  assert.deepEqual(missing, []);
  assert.deepEqual(
    MUTANTS.filter(([, , from, to]) => from === to).map(([name]) => name),
    []
  );
});

test('deux mutants ne portent pas le même nom', () => {
  const names = MUTANTS.map(([name]) => name);
  assert.deepEqual(
    names.filter((name, index) => names.indexOf(name) !== index),
    []
  );
});

test('chaque fichier cassé a des tests désignés, et ces tests existent', () => {
  const orphans = [...new Set(MUTANTS.map(([, file]) => file))].filter((file) => !TESTS_FOR[file]?.length);
  assert.deepEqual(orphans, []);
  for (const [file, tests] of Object.entries(TESTS_FOR)) {
    for (const name of tests) assert.ok(existsSync(path.join(ROOT, 'tests', `${name}.test.js`)), `${file} : ${name}`);
  }
});
