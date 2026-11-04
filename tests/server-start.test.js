/**
 * Le serveur lancé pour de vrai, dans son propre processus : options, variables d'environnement,
 * sauvegarde au démarrage et arrêt propre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { client, freePort, request, tempDir } from './helpers.js';

const START_TIMEOUT = 15000;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Les serveurs de chaque test. Ils sont arrêtés avant l'effacement de leurs dossiers : un serveur encore en vie y
 * écrirait pendant l'effacement, qui échouerait, et le serveur resterait orphelin en bloquant toute la suite.
 */
const servers = new Map();

function trackServers(t) {
  if (servers.has(t)) return servers.get(t);
  const list = [];
  servers.set(t, list);
  t.after(async () => {
    for (const { child, exited } of list) {
      child.kill('SIGKILL');
      await exited;
    }
  });
  return list;
}

/** Lance le serveur et attend la fin de ses messages de démarrage (`ready`). */
async function launch(t, { args = [], env = {}, ready = /base sauvegardée|impossible/ } = {}) {
  const child = spawn(process.execPath, ['server/index.mjs', ...args], { env: { ...process.env, ...env }, stdio: 'pipe' });
  const output = { stdout: '', stderr: '' };
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  trackServers(t).push({ child, exited });
  await new Promise((resolve, reject) => {
    // Un serveur qui n'annonce jamais son démarrage doit faire échouer le test, pas le bloquer
    const timer = setTimeout(() => reject(new Error(`démarrage non constaté :\n${output.stdout}${output.stderr}`)), START_TIMEOUT);
    const done = () => (clearTimeout(timer), resolve());
    const check = () => ready.test(output.stdout + output.stderr) && done();
    child.stdout.on('data', (chunk) => ((output.stdout += chunk), check()));
    child.stderr.on('data', (chunk) => ((output.stderr += chunk), check()));
    exited.then(done);
  });
  // Le port 0 laisse le système choisir. Choisir d'abord un port libre laisserait à un autre test le temps de le prendre : on parlerait alors à son serveur
  return { child, output, exited, port: Number(output.stdout.match(/localhost:(\d+)/)?.[1]) };
}

async function dirs(t) {
  trackServers(t);
  const root = await tempDir(t);
  await writeFile(path.join(root, 'accueil.html'), '<title>ok</title>');
  return { root, data: path.join(await tempDir(t), 'donnees') };
}

test('au démarrage : dossier de données, base et copie du jour sont créés', async (t) => {
  const { root, data } = await dirs(t);
  const { output, port } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'] });
  assert.ok(port > 0, output.stdout);
  assert.ok(existsSync(path.join(data, 'app.db')));
  assert.ok(existsSync(path.join(data, 'backups', `app-${today()}.db`)));
  assert.doesNotMatch(output.stdout, /publication/);
  assert.equal((await request(`http://127.0.0.1:${port}`, '/')).status, 200);
});

test('node:sqlite ne provoque aucun avertissement au démarrage', async (t) => {
  const { root, data } = await dirs(t);
  const { output } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'] });
  assert.equal(output.stderr, '');
});

test('le port demandé est celui qui sert et qui est annoncé, y compris s’il faut réessayer quand un autre test vient de le prendre', async (t) => {
  for (let attempt = 1; ; attempt++) {
    const { root, data } = await dirs(t);
    const wanted = await freePort();
    const { port, child } = await launch(t, { args: ['--root', root, '--data', data, '--port', String(wanted)] });
    if (child.exitCode !== null && attempt < 5) continue;
    assert.equal(port, wanted);
    assert.equal((await request(`http://127.0.0.1:${wanted}`, '/')).status, 200);
    return;
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal} ferme la base proprement et termine sans erreur`, async (t) => {
    const { root, data } = await dirs(t);
    const { child, exited } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'] });
    child.kill(signal);
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.equal(existsSync(path.join(data, 'app.db-wal')), false, 'le journal a été intégré à la base');
  });
}

test('un redémarrage le même jour réutilise la base, sans refaire de copie', async (t) => {
  const { root, data } = await dirs(t);
  const args = ['--root', root, '--data', data];
  const first = await launch(t, { args: [...args, '--port', '0'] });
  first.child.kill('SIGTERM');
  await first.exited;

  const { output } = await launch(t, { args: [...args, '--port', '0'], ready: /admin +: / });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.doesNotMatch(output.stdout, /base sauvegardée/);
  assert.deepEqual(await readdir(path.join(data, 'backups')), [`app-${today()}.db`]);
});

test('les variables d’environnement priment sur les options', async (t) => {
  const { root, data } = await dirs(t);
  const other = await dirs(t);
  const { port } = await launch(t, {
    args: ['--root', other.root, '--data', other.data, '--port', '1'],
    env: { ROOT: root, DATA_DIR: data, PORT: '0' }
  });
  assert.equal((await request(`http://127.0.0.1:${port}`, '/')).status, 200);
  assert.ok(existsSync(path.join(data, 'app.db')));
  assert.equal(existsSync(other.data), false);
});

test('MAX_BODY_MB est pris en compte', async (t) => {
  const { root, data } = await dirs(t);
  const env = { ADMIN_EMAIL: 'admin@example.org', ADMIN_PASSWORD: 'mot-de-passe-admin', MAX_BODY_MB: '0.001' };
  const { port } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'], env });
  const base = `http://127.0.0.1:${port}`;
  const admin = client(base);
  await admin.post('/api/auth/login', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
  const { link } = (await admin.post('/api/admin/invites')).json();
  const token = new URL(link, base).hash.slice(1);
  const teacher = client(base);
  assert.equal((await teacher.post('/api/auth/invite', { token, email: 'prof@example.org', password: 'mot-de-passe-prof' })).status, 200);
  const file = await request(base, '/api/media', {
    method: 'POST',
    headers: { Origin: base, Cookie: teacher.cookie, 'Content-Type': 'image/png' },
    body: Buffer.alloc(2000)
  });
  assert.equal(file.status, 413);
});

test('E-04 : TRUST_PROXY=1 sépare les clients, sans lui ils ne font qu’un', async (t) => {
  for (const [value, expected] of [
    ['1', 401],
    ['0', 429],
    ['', 429]
  ]) {
    const { root, data } = await dirs(t);
    const { port } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'], env: { TRUST_PROXY: value } });
    const browser = client(`http://127.0.0.1:${port}`);
    const attempt = (ip) => browser.post('/api/auth/login', { email: 'prof@example.org', password: 'mauvais-mot-de-passe' }, { 'X-Forwarded-For': ip });
    for (let i = 0; i < 10; i++) assert.equal((await attempt('1.1.1.1')).status, 401);
    assert.equal((await attempt('2.2.2.2')).status, expected, `TRUST_PROXY=${value}`);
  }
});

test('une sauvegarde impossible est signalée, et le serveur continue de répondre', async (t) => {
  const { root, data } = await dirs(t);
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'backups'), 'un fichier à la place du dossier');
  const { output, port } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'] });
  assert.match(output.stderr, /Sauvegarde de la base impossible/);
  assert.equal((await request(`http://127.0.0.1:${port}`, '/')).status, 200);
});

test('un dossier de données inutilisable empêche de démarrer, au lieu de tourner sans base', async (t) => {
  const { root } = await dirs(t);
  const file = path.join(await tempDir(t), 'fichier');
  await writeFile(file, 'pas un dossier');
  const { exited } = await launch(t, { args: ['--root', root, '--data', file, '--port', '0'] });
  assert.equal((await exited).code, 1);
});

test('ADM-01 : ADMIN_EMAIL et ADMIN_PASSWORD créent le compte, sans jamais apparaître dans les journaux', async (t) => {
  const { root, data } = await dirs(t);
  const env = { ADMIN_EMAIL: 'secret-admin@example.org', ADMIN_PASSWORD: 'mot-de-passe-secret' };
  const { output, child, exited, port } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'], env });
  assert.match(output.stdout, /admin {7}: compte créé/);
  assert.doesNotMatch(output.stdout + output.stderr, /secret-admin|mot-de-passe-secret/);
  const login = await request(`http://127.0.0.1:${port}`, '/api/auth/login', {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
  });
  assert.equal(login.status, 200);
  child.kill('SIGTERM');
  await exited;

  const again = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'], env, ready: /admin {7}: / });
  assert.match(again.output.stdout, /admin {7}: compte existant/);
});

test('ADM-01 : sans variables ou avec des variables invalides, le journal le signale et le site démarre', async (t) => {
  const missing = await dirs(t);
  const { output } = await launch(t, { args: ['--root', missing.root, '--data', missing.data, '--port', '0'], ready: /admin {7}: / });
  assert.match(output.stdout, /admin {7}: AUCUN COMPTE : définir ADMIN_EMAIL et ADMIN_PASSWORD/);

  const invalid = await dirs(t);
  const env = { ADMIN_EMAIL: 'admin@example.org', ADMIN_PASSWORD: 'court' };
  const second = await launch(t, { args: ['--root', invalid.root, '--data', invalid.data, '--port', '0'], env, ready: /admin {7}: / });
  assert.match(second.output.stdout, /admin {7}: AUCUN COMPTE : ADMIN_EMAIL ou ADMIN_PASSWORD invalide/);
  assert.doesNotMatch(second.output.stdout, /court/);
});

test('ADM-01 : un admin qui a perdu son mot de passe obtient un lien, sans mot de passe dans le terminal', async (t) => {
  const { root, data } = await dirs(t);
  const run = () => spawnSync(process.execPath, ['server/admin-reset.mjs', '--data', data], { encoding: 'utf8' });
  await mkdir(data, { recursive: true });

  const before = run();
  assert.equal(before.status, 1, 'sans admin, il n’y a rien à réinitialiser');
  assert.match(before.stderr, /Aucun compte admin/);

  const env = { ADMIN_EMAIL: 'admin@example.org', ADMIN_PASSWORD: 'mot-de-passe-perdu' };
  const { port } = await launch(t, { args: ['--root', root, '--data', data, '--port', '0'], env });

  const after = run();
  assert.equal(after.status, 0, after.stderr);
  const token = after.stdout.match(/\/reinitialisation#([\w-]{43})/)[1];
  const base = `http://127.0.0.1:${port}`;
  const post = (target, body) => request(base, target, { method: 'POST', headers: { Origin: base }, body: JSON.stringify(body) });
  assert.equal((await post('/api/auth/reset', { token, password: 'nouveau-mot-de-passe' })).status, 200);
  assert.equal((await post('/api/auth/login', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })).status, 401);
  assert.equal((await post('/api/auth/login', { email: env.ADMIN_EMAIL, password: 'nouveau-mot-de-passe' })).status, 200);
});
