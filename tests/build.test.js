/**
 * La construction du site : chaque page tient en un seul fichier, et l'élève ne télécharge pas le code de gestion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';

const ROOT = path.join(import.meta.dirname, '..');
const PAGES = ['index.html', 'prof.html', 'prof-cours.html', 'prof-lancement.html', 'admin.html', 'compte.html', 'accueil.html', 'eleve.html'];

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
