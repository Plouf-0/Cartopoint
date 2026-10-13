import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
let server, data, root;

before(async () => {
  data = await mkdtemp(path.join(tmpdir(), 'ib-data-'));
  root = await mkdtemp(path.join(tmpdir(), 'ib-root-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>ok</title>');
  await writeFile(path.join(data, 'project.json'), JSON.stringify({ format: 'inventaire-botanique', maps: [], title: 'v1' }));
  await mkdir(path.join(data, 'projets'));
  await writeFile(path.join(data, 'secret.txt'), 'ne doit pas sortir');
  server = spawn(process.execPath, ['server/server.mjs', '--root', root, '--data', data, '--port', String(PORT)], {
    env: { ...process.env, PUBLISH_PASSWORD: 'pw-test' },
    stdio: 'pipe'
  });
  await new Promise((resolve) => server.stdout.once('data', resolve));
});

after(() => server.kill());

const put = (url, body, password) =>
  fetch(base + url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: 'Bearer ' + password } : {}) },
    body: JSON.stringify(body)
  });

test('sert la page, la config et le projet', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.deepEqual(await (await fetch(base + '/config.json')).json(), { projectUrl: 'project.json', publishUrl: 'api/project' });
  assert.equal((await (await fetch(base + '/project.json')).json()).title, 'v1');
});

test('refuse de sortir des dossiers autorisés', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/projets/..%2fsecret.json']) {
    const r = await fetch(base + p);
    assert.notEqual(r.status, 200, p);
  }
});

test('publication : mot de passe obligatoire, format vérifié, sauvegarde de la version précédente', async () => {
  const project = { format: 'inventaire-botanique', maps: [], title: 'v2' };
  assert.equal((await put('/api/project', project)).status, 401);
  assert.equal((await put('/api/project', project, 'faux')).status, 401);
  assert.equal((await put('/api/project', { hello: 1 }, 'pw-test')).status, 400);
  assert.equal((await put('/api/project', project, 'pw-test')).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(data, 'project.json'), 'utf8')).title, 'v2');
  assert.equal((await readdir(path.join(data, 'backups'))).length, 1);
});

test('projets nommés : /?projet=nom', async () => {
  const project = { format: 'inventaire-botanique', maps: [], title: 'rocaille' };
  assert.equal((await put('/api/project?projet=rocaille', project, 'pw-test')).status, 200);
  assert.equal((await (await fetch(base + '/projets/rocaille.json')).json()).title, 'rocaille');
  assert.equal((await put('/api/project?projet=../x', project, 'pw-test')).status, 400);
});
