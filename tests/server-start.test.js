/**
 * Le serveur lancé pour de vrai, dans son propre processus : options, variables d'environnement,
 * sauvegarde au démarrage et arrêt propre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { freePort, request, tempDir } from './helpers.js';

const START_TIMEOUT = 15000;
const today = () => new Date().toISOString().slice(0, 10);

/** Lance le serveur et attend la fin de ses messages de démarrage (`ready`). */
async function launch(t, { args = [], env = {}, ready = /base sauvegardée|impossible/ } = {}) {
  const child = spawn(process.execPath, ['server/index.mjs', ...args], { env: { ...process.env, ...env }, stdio: 'pipe' });
  const output = { stdout: '', stderr: '' };
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => {
    // Un serveur qui n'annonce jamais son démarrage doit faire échouer le test, pas le bloquer
    const timer = setTimeout(() => reject(new Error(`démarrage non constaté :\n${output.stdout}${output.stderr}`)), START_TIMEOUT);
    const done = () => (clearTimeout(timer), resolve());
    const check = () => ready.test(output.stdout + output.stderr) && done();
    child.stdout.on('data', (chunk) => ((output.stdout += chunk), check()));
    child.stderr.on('data', (chunk) => ((output.stderr += chunk), check()));
    exited.then(done);
  });
  return { child, output, exited };
}

async function dirs(t) {
  const root = await tempDir(t);
  await writeFile(path.join(root, 'index.html'), '<title>ok</title>');
  return { root, data: path.join(await tempDir(t), 'donnees') };
}

test('au démarrage : dossier de données, base et copie du jour sont créés', async (t) => {
  const { root, data } = await dirs(t);
  const port = await freePort();
  const { output } = await launch(t, { args: ['--root', root, '--data', data, '--port', String(port)] });
  assert.ok(existsSync(path.join(data, 'app.db')));
  assert.ok(existsSync(path.join(data, 'backups', `app-${today()}.db`)));
  assert.match(output.stdout, new RegExp(`http://localhost:${port}`));
  assert.match(output.stdout, /publication : désactivée/);
  assert.equal((await request(`http://127.0.0.1:${port}`, '/')).status, 200);
});

test('node:sqlite ne provoque aucun avertissement au démarrage', async (t) => {
  const { root, data } = await dirs(t);
  const { output } = await launch(t, { args: ['--root', root, '--data', data, '--port', String(await freePort())] });
  assert.equal(output.stderr, '');
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} ferme la base proprement et termine sans erreur`, async (t) => {
    const { root, data } = await dirs(t);
    const { child, exited } = await launch(t, { args: ['--root', root, '--data', data, '--port', String(await freePort())] });
    child.kill(signal);
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.equal(existsSync(path.join(data, 'app.db-wal')), false, 'le journal a été intégré à la base');
  });
}

test('un redémarrage le même jour réutilise la base, sans refaire de copie', async (t) => {
  const { root, data } = await dirs(t);
  const args = ['--root', root, '--data', data];
  const first = await launch(t, { args: [...args, '--port', String(await freePort())] });
  first.child.kill('SIGTERM');
  await first.exited;

  const { output } = await launch(t, { args: [...args, '--port', String(await freePort())], ready: /publication : / });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.doesNotMatch(output.stdout, /base sauvegardée/);
  assert.deepEqual(await readdir(path.join(data, 'backups')), [`app-${today()}.db`]);
});

test('les variables d’environnement priment sur les options', async (t) => {
  const { root, data } = await dirs(t);
  const other = await dirs(t);
  const port = await freePort();
  await launch(t, {
    args: ['--root', other.root, '--data', other.data, '--port', '1'],
    env: { ROOT: root, DATA_DIR: data, PORT: String(port) }
  });
  assert.equal((await request(`http://127.0.0.1:${port}`, '/')).status, 200);
  assert.ok(existsSync(path.join(data, 'app.db')));
  assert.equal(existsSync(other.data), false);
});

test('MAX_BODY_MB et PUBLISH_PASSWORD sont pris en compte', async (t) => {
  const { root, data } = await dirs(t);
  const port = await freePort();
  const { output } = await launch(t, {
    args: ['--root', root, '--data', data, '--port', String(port)],
    env: { PUBLISH_PASSWORD: 'pw', MAX_BODY_MB: '0.001' }
  });
  assert.match(output.stdout, /publication : activée/);
  const r = await request(`http://127.0.0.1:${port}`, '/api/project', {
    method: 'PUT',
    headers: { Authorization: 'Bearer pw' },
    body: JSON.stringify({ format: 'inventaire-botanique', maps: [], title: 'x'.repeat(2000) })
  });
  assert.equal(r.status, 413);
});

test('E-04 : TRUST_PROXY=1 sépare les clients, sans lui ils ne font qu’un', async (t) => {
  const attempt = (base, ip, password) =>
    request(base, '/api/project', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + password, 'X-Forwarded-For': ip },
      body: JSON.stringify({ format: 'inventaire-botanique', maps: [] })
    });

  for (const [value, expected] of [
    ['1', 200],
    ['0', 429],
    ['', 429]
  ]) {
    const { root, data } = await dirs(t);
    const port = await freePort();
    await launch(t, { args: ['--root', root, '--data', data, '--port', String(port)], env: { PUBLISH_PASSWORD: 'pw', TRUST_PROXY: value } });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 10; i++) assert.equal((await attempt(base, '1.1.1.1', 'faux')).status, 401);
    assert.equal((await attempt(base, '2.2.2.2', 'pw')).status, expected, `TRUST_PROXY=${value}`);
  }
});

test('une sauvegarde impossible est signalée, et le serveur continue de répondre', async (t) => {
  const { root, data } = await dirs(t);
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'backups'), 'un fichier à la place du dossier');
  const port = await freePort();
  const { output } = await launch(t, { args: ['--root', root, '--data', data, '--port', String(port)] });
  assert.match(output.stderr, /Sauvegarde de la base impossible/);
  assert.equal((await request(`http://127.0.0.1:${port}`, '/')).status, 200);
});

test('un dossier de données inutilisable empêche de démarrer, au lieu de tourner sans base', async (t) => {
  const { root } = await dirs(t);
  const file = path.join(await tempDir(t), 'fichier');
  await writeFile(file, 'pas un dossier');
  const { exited } = await launch(t, { args: ['--root', root, '--data', file, '--port', String(await freePort())] });
  assert.equal((await exited).code, 1);
});
