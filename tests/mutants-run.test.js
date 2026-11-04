/**
 * Le script de mutants lui-même, dans un faux projet : un seul fichier et un seul test, sans navigateur. Ce qu'il annonce doit être
 * juste, puisqu'une longue série se relit uniquement à travers son journal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { tempDir } from './helpers.js';

const ROOT = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/mutants.mjs');
const MUTANT = 'rendu : position hors du plan';
const OTHER_MUTANT = 'rendu : position négative';
const INTACT_TEXT = 'value >= 0 && value <= 100';

/** Le test du faux projet attrape une casse du fichier, tant qu'on ne lui demande pas autre chose. */
const CATCHES = `
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  test('le fichier est intact', () => assert.ok(readFileSync('server/answers.mjs', 'utf8').includes(${JSON.stringify(INTACT_TEXT)}), 'il a changé'));
`;
const NEVER_FAILS = `import { test } from 'node:test'; test('ne regarde rien', () => {});`;
const ALWAYS_FAILS = `
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  test('échoue toujours', () => assert.equal(1, 2, 'une raison lisible'));
`;
const HANGS = `
  import { test } from 'node:test';
  import { writeFileSync } from 'node:fs';
  test('reste bloqué', async () => {
    writeFileSync(process.env.PID_FILE, String(process.pid));
    await new Promise((resolve) => setTimeout(resolve, 60000));
  });
`;

async function fakeProject(t, testSource = CATCHES) {
  const project = await tempDir(t);
  await mkdir(path.join(project, 'tests'));
  await mkdir(path.join(project, 'server'));
  await writeFile(path.join(project, 'tests/answers.test.js'), testSource);
  await cp(path.join(ROOT, 'server/answers.mjs'), path.join(project, 'server/answers.mjs'));
  return { project, scratch: await tempDir(t) };
}

function start({ project, scratch }, args, env = {}) {
  // Cette variable, posée par le lanceur de tests autour de ce fichier, ferait de « node --test » dans le script un lancement sans aucun test
  const { NODE_TEST_CONTEXT, ...inherited } = process.env;
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    cwd: project,
    env: { ...inherited, TMPDIR: scratch, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = { child, out: '' };
  child.stdout.on('data', (chunk) => (result.out += chunk));
  child.stderr.on('data', (chunk) => (result.out += chunk));
  result.finished = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return result;
}

async function run(where, args) {
  const result = start(where, args);
  return { code: await result.finished, out: result.out };
}

test('un mutant attrapé : le bilan, le test responsable, et les copies rangées', async (t) => {
  const where = await fakeProject(t);
  const { code, out } = await run(where, [MUTANT]);
  assert.equal(code, 0, out);
  assert.match(out, /Contrôle du code intact : 1 groupe\(s\) de tests, 1 à la fois/);
  assert.match(out, /contrôle 1\/1 ok \(\d+ s\) tests\/answers\.test\.js/);
  assert.match(out, new RegExp(`\\[1/1\\] attrapé +${MUTANT} ← le fichier est intact`));
  assert.match(out, /1\/1 attrapés/);
  assert.deepEqual(await readdir(where.scratch), []);
});

test('le fichier du projet n’est jamais touché : seule sa copie est cassée', async (t) => {
  const where = await fakeProject(t);
  const before = await readFile(path.join(where.project, 'server/answers.mjs'), 'utf8');
  await run(where, [MUTANT]);
  assert.equal(await readFile(path.join(where.project, 'server/answers.mjs'), 'utf8'), before);
});

test('sans -v, ce qui démarre n’est pas annoncé', async (t) => {
  const { out } = await run(await fakeProject(t), [MUTANT]);
  assert.doesNotMatch(out, /▶/);
});

for (const flag of ['-v', '--verbose'])
  test(`${flag} annonce chaque essai qui démarre, avec sa copie, et n’est pas pris pour un filtre`, async (t) => {
    const { code, out } = await run(await fakeProject(t), [flag, MUTANT]);
    assert.equal(code, 0, out);
    assert.match(out, /▶ copie 1 : tests\/answers\.test\.js/);
    assert.match(out, new RegExp(`▶ copie 1 : ${MUTANT}`));
    assert.match(out, /1\/1 attrapés/, 'seul le mutant demandé a tourné');
  });

test('plusieurs à la fois : chaque essai a sa copie, et le temps restant s’affiche jusqu’à l’avant-dernier', async (t) => {
  const where = await fakeProject(t);
  const { code, out } = await run(where, ['--jobs=2', '-v', `${MUTANT}|${OTHER_MUTANT}`]);
  assert.equal(code, 0, out);
  assert.match(out, /Contrôle du code intact : 1 groupe\(s\) de tests, 2 à la fois/);
  assert.match(out, /▶ copie 1 : rendu/);
  assert.match(out, /▶ copie 2 : rendu/);
  assert.match(out, /\[1\/2 encore ≈ \d+ (s|min)\] attrapé/);
  assert.match(out, /\[2\/2\] attrapé/);
  assert.match(out, /2\/2 attrapés/);
  assert.deepEqual(await readdir(where.scratch), []);
});

test('QUA-08 : un mutant qu’aucun test ne remarque est un problème, et le script échoue', async (t) => {
  const { code, out } = await run(await fakeProject(t, NEVER_FAILS), [MUTANT]);
  assert.equal(code, 1, out);
  assert.match(out, new RegExp(`\\[1/1\\] PROBLÈME ${MUTANT}`));
  assert.match(out, /0\/1 attrapés/);
  assert.match(out, /aucun test n’échoue/);
});

test('des tests déjà en échec : la raison s’affiche, sans lancer un seul mutant', async (t) => {
  const where = await fakeProject(t, ALWAYS_FAILS);
  const { code, out } = await run(where, [MUTANT]);
  assert.equal(code, 1, out);
  assert.match(out, /contrôle 1\/1 ÉCHEC/);
  assert.match(out, /Les tests échouent déjà sur le code intact/);
  assert.match(out, /échoue toujours/);
  assert.match(out, /une raison lisible/, 'la raison, pas seulement le nom du test');
  assert.match(out, /Rien n'a été vérifié/);
  assert.doesNotMatch(out, /attrapé/);
  assert.deepEqual(await readdir(where.scratch), []);
});

test('tous les groupes en échec sont annoncés d’un coup, pas seulement le premier', async (t) => {
  const where = await fakeProject(t, ALWAYS_FAILS);
  await writeFile(path.join(where.project, 'tests/launches.test.js'), ALWAYS_FAILS.replace('échoue toujours', 'échoue aussi'));
  await cp(path.join(ROOT, 'server/launches.mjs'), path.join(where.project, 'server/launches.mjs'));
  const { code, out } = await run(where, [`${MUTANT}|lancement : code trop court`]);
  assert.equal(code, 1, out);
  assert.match(out, /échoue toujours/);
  assert.match(out, /échoue aussi/);
});

test('un filtre qui ne désigne rien est une erreur, pas un succès à 0/0', async (t) => {
  const where = await fakeProject(t);
  const { code, out } = await run(where, ['cette faute de frappe']);
  assert.equal(code, 1, out);
  assert.match(out, /Aucun mutant ne correspond à « cette faute de frappe »/);
  assert.deepEqual(await readdir(where.scratch), [], 'aucune copie créée');
});

for (const signal of ['SIGINT', 'SIGTERM'])
  test(`${signal} arrête les tests en cours et range les copies`, async (t) => {
    const where = await fakeProject(t, HANGS);
    const pidFile = path.join(await tempDir(t), 'pid');
    const series = start(where, ['-v', MUTANT], { PID_FILE: pidFile });
    while (!existsSync(pidFile)) {
      assert.equal(series.child.exitCode, null, `le script s’est arrêté avant le test : ${series.out}`);
      await wait(50);
    }
    const pid = Number(await readFile(pidFile, 'utf8'));
    assert.ok(pid > 0);

    series.child.kill(signal);
    assert.equal(await series.finished, 130, series.out);
    assert.deepEqual(await readdir(where.scratch), [], 'plus aucune copie');
    await wait(100);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'le test en cours est mort');
  });
