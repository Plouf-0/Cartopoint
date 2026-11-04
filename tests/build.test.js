/**
 * La construction du site : chaque page tient en un seul fichier, et l'élève ne télécharge pas le code de gestion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';

const ROOT = path.join(import.meta.dirname, '..');
const PAGES = ['secours.html', 'prof.html', 'prof-cours.html', 'prof-lancement.html', 'admin.html', 'compte.html', 'accueil.html', 'eleve.html'];

test('toutes les pages se construisent en un seul fichier ; celle de l’élève, sans le code de gestion', async (t) => {
  const out = await tempDir(t);
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const read = (page) => readFileSync(path.join(out, page), 'utf8');
  for (const page of PAGES) {
    assert.doesNotMatch(read(page), /<script type="module"|<link rel="stylesheet" href="\/?css/, page);
  }
  const student = read('eleve.html');
  assert.match(student, /Fiches à placer/);
  for (const marker of ['identifyWithAI', 'publishCourse', 'renderFicheRow', 'saveProject', 'verifyExercise', 'adminPanelHTML', 'openEditor']) {
    assert.ok(!student.includes(marker), marker);
  }
  assert.match(read('prof-cours.html'), /publishCourse/, 'la recherche trouve bien ces noms dans le code');
  assert.ok(student.length < 170e3, `${student.length} octets`);
});

test('l’image Docker embarque le code que le serveur partage avec le navigateur', () => {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const server = readdirSync(path.join(ROOT, 'server'), { recursive: true }).filter((file) => file.endsWith('.mjs'));
  const shared = new Set();
  for (const file of server) {
    const text = readFileSync(path.join(ROOT, 'server', file), 'utf8');
    for (const [, name] of text.matchAll(/from '(?:\.\.\/)+src\/js\/([^']+)'/g)) shared.add(name);
  }
  assert.ok(shared.has('model.js'), 'la recherche trouve bien ces imports');
  // model.js utilise lui-même util.js
  for (const name of [...shared, 'util.js']) assert.ok(dockerfile.includes(`src/js/${name}`), name);
});

test('EXP-01 : le fichier de secours se construit en un seul fichier, avec sa place pour le cours', async (t) => {
  const out = await tempDir(t);
  assert.equal(spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', out], { cwd: ROOT, encoding: 'utf8' }).status, 0);
  const page = readFileSync(path.join(out, 'secours.html'), 'utf8');
  assert.doesNotMatch(page, /<script type="module"|<link rel="stylesheet" href="\/?css/);
  assert.match(page, /<script id="embedded-project" type="application\/json">null<\/script>/);
  assert.equal(existsSync(path.join(out, 'index.html')), false, 'la racine du site est l’accueil, plus rien ne s’appelle index.html');
});

test('EV-42, EV-44 : le numéro de version et le commit entrent dans chaque page ; sans commit donné, c’est celui du dépôt', async (t) => {
  const { version: number } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const run = (out, version) =>
    spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', out], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, APP_VERSION: version } });
  const given = await tempDir(t);
  assert.equal(run(given, 'essai-42').status, 0);
  for (const page of PAGES) {
    const text = readFileSync(path.join(given, page), 'utf8');
    assert.ok(text.includes(`${number} (essai-42)`), `${page} : le numéro de version, puis le commit`);
    assert.doesNotMatch(text, /__APP_VERSION__/, page);
  }

  const fromGit = await tempDir(t);
  assert.equal(run(fromGit, '').status, 0);
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  // Dans une copie sans dépôt, comme une image Docker, elle le dit au lieu d'inventer
  const expected = commit.status === 0 ? commit.stdout.trim() : 'inconnue';
  assert.ok(readFileSync(path.join(fromGit, 'eleve.html'), 'utf8').includes(`${number} (${expected}`), expected);
});

test('EV-44 : le numéro de version suit la notation x.y.z, à partir de 1 : les versions 0.y.z sont celles d’avant la refonte', () => {
  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(version, /^[1-9]\d*\.\d+\.\d+$/);
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, version, 'package-lock.json suit');
  assert.equal(lock.packages[''].version, version);
});
