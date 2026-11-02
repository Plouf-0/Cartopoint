import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { request, startApp } from './helpers.js';

const PASSWORD = 'pw-test';
const project = (title = 'v1') => JSON.stringify({ format: 'inventaire-botanique', maps: [], title });

const publish = (base, body, { target = '/api/project', password = PASSWORD, headers = {} } = {}) =>
  request(base, target, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: 'Bearer ' + password } : {}), ...headers }
  });

const failTenTimes = async (base, headers) => {
  for (let i = 0; i < 10; i++) assert.equal((await publish(base, project(), { password: 'faux', headers })).status, 401);
};

/* --- Lecture --- */

test('SRV-02 : la configuration annonce la publication seulement si elle est possible', async (t) => {
  const on = await startApp(t, { password: PASSWORD });
  assert.deepEqual(JSON.parse((await request(on.base, '/config.json')).body), { projectUrl: 'project.json', publishUrl: 'api/project' });
  const off = await startApp(t);
  assert.deepEqual(JSON.parse((await request(off.base, '/config.json')).body), { projectUrl: 'project.json', publishUrl: null });
  assert.equal((await request(off.base, '/config.json')).headers['cache-control'], 'no-cache');
});

test('DEP-05 : sur un volume vide, il n’y a aucun projet à servir', async (t) => {
  const { base } = await startApp(t);
  assert.equal((await request(base, '/project.json')).status, 404);
  assert.equal((await request(base, '/projets/absent.json')).status, 404);
  assert.equal((await request(base, '/')).status, 200);
});

test('E-05 : project.json porte un ETag, part en gzip et donne un 304', async (t) => {
  const { base, data } = await startApp(t);
  const large = JSON.stringify({ format: 'inventaire-botanique', maps: [], title: 'x'.repeat(5000) });
  await writeFile(path.join(data, 'project.json'), large);

  const zipped = await request(base, '/project.json', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers['cache-control'], 'no-cache');
  assert.equal(gunzipSync(zipped.body).toString(), large);

  const again = await request(base, '/project.json', { headers: { 'If-None-Match': zipped.headers.etag } });
  assert.equal(again.status, 304);
});

test('E-05 : après une publication, le 304 ne sert plus : tout le monde reçoit la nouvelle version', async (t) => {
  const { base, data } = await startApp(t, { password: PASSWORD });
  await writeFile(path.join(data, 'project.json'), project('v1'));
  const before = await request(base, '/project.json');
  assert.equal((await publish(base, project('version 2'))).status, 200);
  const after = await request(base, '/project.json', { headers: { 'If-None-Match': before.headers.etag } });
  assert.equal(after.status, 200);
  assert.equal(JSON.parse(after.body).title, 'version 2');
});

test('SRV-09 : ni la base, ni les sauvegardes, ni un nom de projet invalide ne sortent', async (t) => {
  const { app, base, data } = await startApp(t, { password: PASSWORD });
  app.backup();
  await writeFile(path.join(data, 'secret.txt'), 'ne doit pas sortir');
  await writeFile(path.join(data, 'secret.json'), 'ne doit pas sortir');
  const today = new Date().toISOString().slice(0, 10);
  for (const p of ['/app.db', `/backups/app-${today}.db`, '/secret.txt', '/../secret.txt', '/projets/..%2fsecret.json', '/projets/%2e%2e%2fsecret.json']) {
    const r = await request(base, p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body.toString(), /ne doit pas sortir|SQLite/, p);
  }
});

/* --- Publication --- */

test('SRV-04 : sans mot de passe configuré, la publication est refusée, même sans essai de mot de passe', async (t) => {
  const { base, data } = await startApp(t);
  for (const password of [null, '', 'quelconque']) assert.equal((await publish(base, project(), { password })).status, 403);
  assert.equal((await readdir(data)).includes('project.json'), false);
});

test('SRV-05 : la publication exige le bon mot de passe, et le préfixe Bearer ne change rien à sa casse', async (t) => {
  const { base, data } = await startApp(t, { password: PASSWORD });
  assert.equal((await publish(base, project(), { password: null })).status, 401);
  assert.equal((await publish(base, project(), { password: 'faux' })).status, 401);
  assert.equal((await publish(base, project(), { password: null, headers: { Authorization: 'bearer ' + PASSWORD } })).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(data, 'project.json'), 'utf8')).title, 'v1');
});

test('SRV-07 : un contenu qui n’est pas un projet est refusé, sans rien écrire', async (t) => {
  const { base, data } = await startApp(t, { password: PASSWORD });
  const refused = [
    'pas du json',
    '{"hello":1}',
    '{"format":"autre","maps":[]}',
    '{"format":"inventaire-botanique"}',
    '{"format":"inventaire-botanique","maps":{}}'
  ];
  for (const body of refused) {
    const r = await publish(base, body);
    assert.equal(r.status, 400, body);
    assert.match(r.body.toString(), /^Projet refusé : /, body);
  }
  assert.equal((await readdir(data)).includes('project.json'), false);
});

test('SRV-07 : un projet trop volumineux reçoit un 413, sans rien écrire', async (t) => {
  const { base, data } = await startApp(t, { password: PASSWORD, maxBody: 100 });
  const r = await publish(base, JSON.stringify({ format: 'inventaire-botanique', maps: [], title: 'x'.repeat(200) }));
  assert.equal(r.status, 413);
  assert.equal(r.body.toString(), 'Projet refusé : trop volumineux');
  assert.equal((await readdir(data)).includes('project.json'), false);
});

test('SRV-02 : seules PUT et les lectures sont permises sur ces routes', async (t) => {
  const { base } = await startApp(t, { password: PASSWORD });
  const read = await request(base, '/api/project');
  assert.equal(read.status, 405);
  assert.equal(read.headers.allow, 'PUT');
  assert.equal((await request(base, '/config.json', { method: 'POST' })).status, 405);
  assert.equal((await request(base, '/', { method: 'DELETE' })).status, 405);
});

test('MUL-01 : un projet nommé se publie et se relit, un nom invalide est refusé', async (t) => {
  const { base } = await startApp(t, { password: PASSWORD });
  assert.equal((await publish(base, project('rocaille'), { target: '/api/project?projet=rocaille' })).status, 200);
  assert.equal(JSON.parse((await request(base, '/projets/rocaille.json')).body).title, 'rocaille');
  for (const name of ['../x', '-x', 'a b', 'a'.repeat(62)]) {
    assert.equal((await publish(base, project(), { target: `/api/project?projet=${encodeURIComponent(name)}` })).status, 400, name);
  }
  assert.equal((await request(base, '/projets/-x.json')).status, 404);
});

test('SRV-08 : la première publication ne sauvegarde rien, les suivantes gardent la version précédente', async (t) => {
  const { base, data } = await startApp(t, { password: PASSWORD });
  assert.equal((await publish(base, project('v1'))).status, 200);
  const projectBackups = async () => (await readdir(path.join(data, 'backups'))).filter((f) => f.startsWith('project-'));
  assert.deepEqual(await projectBackups(), []);

  assert.equal((await publish(base, project('v2'))).status, 200);
  const [saved, ...others] = await projectBackups();
  assert.deepEqual(others, []);
  assert.equal(JSON.parse(await readFile(path.join(data, 'backups', saved), 'utf8')).title, 'v1');
  assert.equal(
    (await readdir(data)).some((f) => f.endsWith('.tmp')),
    false,
    'aucun fichier temporaire ne reste'
  );
});

test('une écriture impossible donne un 500 et ne touche pas au projet en place', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { base, data } = await startApp(t, { password: PASSWORD });
  await writeFile(path.join(data, 'project.json'), project('en place'));
  await mkdir(path.join(data, 'project.json.tmp'));
  const r = await publish(base, project('nouveau'));
  assert.equal(r.status, 500);
  assert.equal(r.body.toString(), 'Erreur du serveur');
  assert.equal(JSON.parse(await readFile(path.join(data, 'project.json'), 'utf8')).title, 'en place');
});

/* --- E-11 : les sauvegardes de projets aux noms proches restent séparées --- */

const stamp = (i) => `2026-01-01T10-00-${String(i).padStart(2, '0')}-000Z`;

test('E-11 : les sauvegardes de « rocaille-2 » ne comptent pas parmi celles de « rocaille »', async (t) => {
  const { base, data } = await startApp(t, { password: PASSWORD });
  const backups = path.join(data, 'backups');
  await mkdir(backups);
  await mkdir(path.join(data, 'projets'));
  await writeFile(path.join(data, 'projets', 'rocaille.json'), project('rocaille'));
  for (let i = 0; i < 25; i++) {
    await writeFile(path.join(backups, `rocaille-${stamp(i)}.json`), 'x');
    await writeFile(path.join(backups, `rocaille-2-${stamp(i)}.json`), 'x');
  }

  assert.equal((await publish(base, project('rocaille'), { target: '/api/project?projet=rocaille' })).status, 200);

  const names = await readdir(backups);
  const own = names.filter((f) => /^rocaille-\d{4}-/.test(f)).sort();
  assert.equal(own.length, 20, 'la limite vaut pour « rocaille » seul');
  assert.equal(own[0], `rocaille-${stamp(6)}.json`, 'les plus anciennes partent en premier');
  assert.equal(names.filter((f) => f.startsWith('rocaille-2-')).length, 25, '« rocaille-2 » est intact');
});

test('E-11 : un projet nommé « app » ne touche pas aux copies de la base', async (t) => {
  const { base, data } = await startApp(t, { password: PASSWORD });
  const backups = path.join(data, 'backups');
  await mkdir(backups);
  await mkdir(path.join(data, 'projets'));
  await writeFile(path.join(data, 'projets', 'app.json'), project('app'));
  await writeFile(path.join(backups, 'app-2020-01-01.db'), 'copie de la base');
  for (let i = 0; i < 25; i++) await writeFile(path.join(backups, `app-${stamp(i)}.json`), 'x');

  assert.equal((await publish(base, project('app'), { target: '/api/project?projet=app' })).status, 200);
  assert.ok((await readdir(backups)).includes('app-2020-01-01.db'));
});

/* --- E-04 : le blocage des essais vise le bon client --- */

test('SRV-06 : dix échecs bloquent, même avec le bon mot de passe ensuite', async (t) => {
  const { base } = await startApp(t, { password: PASSWORD });
  await failTenTimes(base);
  const blocked = await publish(base, project());
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.toString(), /réessayez dans 10 minutes/);
});

test('E-04 : derrière le proxy, les erreurs d’un client ne bloquent plus les autres', async (t) => {
  const { base } = await startApp(t, { password: PASSWORD, trustProxy: true });
  await failTenTimes(base, { 'X-Forwarded-For': '1.1.1.1' });
  assert.equal((await publish(base, project(), { headers: { 'X-Forwarded-For': '1.1.1.1' } })).status, 429);
  assert.equal((await publish(base, project(), { headers: { 'X-Forwarded-For': '2.2.2.2' } })).status, 200);
});

test('E-04 : un client bloqué ne s’en sort pas en inventant une adresse devant la sienne', async (t) => {
  const { base } = await startApp(t, { password: PASSWORD, trustProxy: true });
  await failTenTimes(base, { 'X-Forwarded-For': '1.1.1.1' });
  const spoofed = await publish(base, project(), { headers: { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' } });
  assert.equal(spoofed.status, 429);
});

test('E-04 : sans TRUST_PROXY, une adresse inventée ne contourne pas le blocage', async (t) => {
  const { base } = await startApp(t, { password: PASSWORD });
  await failTenTimes(base, { 'X-Forwarded-For': '1.1.1.1' });
  assert.equal((await publish(base, project(), { headers: { 'X-Forwarded-For': '2.2.2.2' } })).status, 429);
});
