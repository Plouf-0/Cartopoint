/**
 * Cours, publication et fichiers, au niveau de l'API (cahier des charges, sections 12.1 et 12.2). Les écrans sont
 * vérifiés dans tests/e2e/courses.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sniffType } from '../server/media.mjs';
import { addAccount, cheapHash, client, request, startApp } from './helpers.js';

const PASSWORD = 'mot-de-passe-1';
const HASH = cheapHash(PASSWORD);
const ADMIN = 'admin@example.org';
const TEACHER = 'prof@example.org';
const OTHER = 'autre@example.org';
const DAY = 24 * 60 * 60 * 1000;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
const MP4 = Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1');
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);

function draftWith(title = 'Mon cours', fiches = [], image = '') {
  return { format: 'inventaire-botanique', version: 3, title, theme: {}, aiEndpoint: '', maps: [{ id: 'm1', name: 'Plan', image, widthMeters: null, fiches }] };
}

async function site(t, options) {
  const started = await startApp(t, options);
  const { db } = started.app;
  const ids = {
    admin: addAccount(db, { email: ADMIN, role: 'admin', hash: HASH }),
    teacher: addAccount(db, { email: TEACHER, hash: HASH }),
    other: addAccount(db, { email: OTHER, hash: HASH })
  };
  return { ...started, db, ids, mediaDir: path.join(started.data, 'media') };
}

async function loggedIn(base, email = TEACHER) {
  const browser = client(base);
  assert.equal((await browser.post('/api/auth/login', { email, password: PASSWORD })).status, 200);
  return browser;
}

async function createCourse(browser, draft = draftWith()) {
  const r = await browser.post('/api/courses', { draft });
  assert.equal(r.status, 200, r.text);
  return r.json();
}

const put = (browser, id, revision, draft) => browser.raw('PUT', `/api/courses/${id}`, { revision, draft });

function upload(base, browser, body, headers = {}) {
  return request(base, '/api/media', { method: 'POST', body, headers: { Origin: base, Cookie: browser.cookie, ...headers } });
}

async function uploaded(base, browser, body) {
  const r = await upload(base, browser, body);
  assert.equal(r.status, 200, r.body.toString());
  return JSON.parse(r.body);
}

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const ageMedia = (db, days) => db.prepare('UPDATE media SET created_at = ?').run(new Date(Date.now() - days * DAY).toISOString());

/* --- ENS-02 : préparer ses cours --- */

test('ENS-02 : un enseignant crée un cours, le retrouve et le modifie', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  assert.deepEqual((await browser.get('/api/courses')).json(), []);

  const created = await createCourse(browser, draftWith('Sortie au parc', [{ id: 'f1' }, { id: 'f2' }]));
  assert.equal(created.title, 'Sortie au parc');
  assert.equal(created.revision, 1);
  assert.equal(created.fiches, 2);
  assert.equal(created.published, null);
  assert.equal(created.modified, true);

  const read = await browser.get(`/api/courses/${created.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.headers['cache-control'], 'no-store');
  assert.deepEqual(read.json().draft, draftWith('Sortie au parc', [{ id: 'f1' }, { id: 'f2' }]));

  const saved = await put(browser, created.id, 1, draftWith('Nouveau nom', [{ id: 'f1' }]));
  assert.equal(saved.status, 200);
  assert.equal(saved.json().revision, 2);
  assert.equal(saved.json().title, 'Nouveau nom');
  assert.equal(saved.json().fiches, 1);

  const list = (await browser.get('/api/courses')).json();
  assert.deepEqual(
    list.map((course) => course.title),
    ['Nouveau nom']
  );
  assert.equal(list[0].draft, undefined, 'la liste ne transporte pas tout le contenu');
});

test('ENS-02 : la liste commence par le dernier cours modifié', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const first = await createCourse(browser, draftWith('Premier'));
  await createCourse(browser, draftWith('Second'));
  db.prepare("UPDATE courses SET updated_at = '2020-01-01' WHERE title = 'Second'").run();
  assert.equal((await browser.get('/api/courses')).json()[0].id, first.id);
});

test('un cours sans nom en reçoit un, et un nom trop long est coupé', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  assert.equal((await createCourse(browser, draftWith('   '))).title, 'Cours sans nom');
  assert.equal((await createCourse(browser, { ...draftWith(), title: undefined })).title, 'Cours sans nom');
  assert.equal((await createCourse(browser, draftWith('x'.repeat(500)))).title.length, 200);
});

test('un contenu qui n’est pas un cours est refusé, et ne remplace rien', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser);
  const refused = [
    undefined,
    null,
    12,
    'texte',
    {},
    { format: 'autre', maps: [{}] },
    { format: 'inventaire-botanique' },
    { format: 'inventaire-botanique', maps: 'x' },
    { format: 'inventaire-botanique', maps: [] }
  ];
  for (const draft of refused) {
    assert.equal((await browser.post('/api/courses', { draft })).status, 400, JSON.stringify(draft));
    assert.equal((await put(browser, course.id, 1, draft)).status, 400, JSON.stringify(draft));
  }
  assert.equal(count(db, 'courses'), 1);
  assert.equal((await browser.get(`/api/courses/${course.id}`)).json().revision, 1);
});

test('un contenu trop lourd est refusé avec un 413, sans erreur du serveur', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser);
  const heavy = draftWith('Lourd', [{ id: 'f', description: 'x'.repeat(9 * 1024 * 1024) }]);
  assert.equal((await browser.post('/api/courses', { draft: heavy })).status, 413);
  assert.equal((await put(browser, course.id, 1, heavy)).status, 413);
});

/* --- E-10 : le serveur attribue les révisions --- */

test('E-10 : une révision périmée est refusée, au lieu d’écraser le travail d’un autre onglet', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser);
  assert.equal((await put(browser, course.id, 1, draftWith('Onglet A'))).status, 200);

  const late = await put(browser, course.id, 1, draftWith('Onglet B'));
  assert.equal(late.status, 409);
  assert.match(late.text, /modifié ailleurs/);
  assert.equal((await browser.get(`/api/courses/${course.id}`)).json().title, 'Onglet A');

  for (const revision of [undefined, '2', 3, null]) assert.equal((await put(browser, course.id, revision, draftWith('C'))).status, 409, String(revision));
  assert.equal((await put(browser, course.id, 2, draftWith('Onglet A, suite'))).status, 200);
});

/* --- COU-02, COU-11 : publication --- */

test('COU-02 : publier fige une version, et le brouillon peut ensuite changer sans la toucher', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser, draftWith('Version 1'));

  const first = await browser.post(`/api/courses/${course.id}/publish`, { revision: 1 });
  assert.equal(first.status, 200);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.equal(first.json().published.number, 1);
  assert.ok(Date.parse(first.json().published.publishedAt));
  assert.equal(first.json().modified, false);
  assert.equal(first.json().draft.title, 'Version 1');

  const saved = await put(browser, course.id, 1, draftWith('Brouillon suivant'));
  assert.equal(saved.json().modified, true);
  assert.equal(saved.json().published.number, 1);
  const frozen = () => db.prepare('SELECT number, content FROM course_versions ORDER BY number').all();
  assert.equal(JSON.parse(frozen()[0].content).title, 'Version 1');

  const second = await browser.post(`/api/courses/${course.id}/publish`, { revision: 2 });
  assert.equal(second.json().published.number, 2);
  assert.equal(second.json().modified, false);
  assert.deepEqual(
    frozen().map((version) => [version.number, JSON.parse(version.content).title]),
    [
      [1, 'Version 1'],
      [2, 'Brouillon suivant']
    ]
  );
});

test('COU-02 : publier deux fois le même contenu ne crée pas de nouvelle version', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser);
  await browser.post(`/api/courses/${course.id}/publish`, { revision: 1 });
  const again = await browser.post(`/api/courses/${course.id}/publish`, { revision: 1 });
  assert.equal(again.status, 200);
  assert.equal(again.json().published.number, 1);
  assert.equal(count(db, 'course_versions'), 1);
});

test('COU-02 : revenir au contenu publié ne laisse pas de modification en attente', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser, draftWith('A'));
  await browser.post(`/api/courses/${course.id}/publish`, { revision: 1 });
  assert.equal((await put(browser, course.id, 1, draftWith('B'))).json().modified, true);
  assert.equal((await put(browser, course.id, 2, draftWith('A'))).json().modified, false);
});

test('COU-02 : une publication qui repart d’une révision périmée est refusée', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser);
  await put(browser, course.id, 1, draftWith('Plus récent'));
  const late = await browser.post(`/api/courses/${course.id}/publish`, { revision: 1 });
  assert.equal(late.status, 409);
  assert.equal(count(db, 'course_versions'), 0);
});

test('supprimer un cours emporte ses versions, et lui seul', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const gone = await createCourse(browser, draftWith('À supprimer'));
  const kept = await createCourse(browser, draftWith('À garder'));
  await browser.post(`/api/courses/${gone.id}/publish`, { revision: 1 });
  const r = await browser.raw('DELETE', `/api/courses/${gone.id}`);
  assert.equal(r.status, 200);
  assert.equal((await browser.get(`/api/courses/${gone.id}`)).status, 404);
  assert.equal((await browser.raw('DELETE', `/api/courses/${gone.id}`)).status, 404);
  assert.equal(count(db, 'course_versions'), 0);
  assert.deepEqual(
    (await browser.get('/api/courses')).json().map((course) => course.id),
    [kept.id]
  );
});

/* --- ENS-03, ENS-04, ADM-07 : séparation des espaces --- */

test('ENS-03 : un cours n’existe pas pour un autre enseignant, ni pour l’admin', async (t) => {
  const { base, db } = await site(t);
  const owner = await loggedIn(base);
  const course = await createCourse(owner, draftWith('Secret'));
  for (const email of [OTHER, ADMIN]) {
    const intruder = await loggedIn(base, email);
    assert.equal((await intruder.get(`/api/courses/${course.id}`)).status, 404, email);
    assert.equal((await put(intruder, course.id, 1, draftWith('Volé'))).status, 404, email);
    assert.equal((await intruder.post(`/api/courses/${course.id}/publish`, { revision: 1 })).status, 404, email);
    assert.equal((await intruder.raw('DELETE', `/api/courses/${course.id}`)).status, 404, email);
  }
  assert.deepEqual((await (await loggedIn(base, OTHER)).get('/api/courses')).json(), []);
  assert.equal(db.prepare('SELECT title FROM courses').get().title, 'Secret');
  assert.equal(count(db, 'course_versions'), 0);
});

test('ENS-04 : sans session, tout est refusé ; l’admin n’a pas de cours', async (t) => {
  const { base } = await site(t);
  const owner = await loggedIn(base);
  const course = await createCourse(owner);
  const visitor = client(base);
  assert.equal((await visitor.get('/api/courses')).status, 401);
  assert.equal((await visitor.post('/api/courses', { draft: draftWith() })).status, 401);
  assert.equal((await visitor.get(`/api/courses/${course.id}`)).status, 401);
  assert.equal((await put(visitor, course.id, 1, draftWith())).status, 401);
  assert.equal((await visitor.post(`/api/courses/${course.id}/publish`, { revision: 1 })).status, 401);
  assert.equal((await visitor.raw('DELETE', `/api/courses/${course.id}`)).status, 401);
  assert.equal((await visitor.post('/api/media')).status, 401);

  const admin = await loggedIn(base, ADMIN);
  assert.equal((await admin.get('/api/courses')).status, 403, 'ADM-08');
  assert.equal((await admin.post('/api/courses', { draft: draftWith() })).status, 403, 'ADM-08');
  assert.equal((await upload(base, admin, JPEG)).status, 403, 'ADM-08');
});

test('une écriture venue d’un autre site est refusée', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser);
  const elsewhere = { Origin: 'https://ailleurs.example.org' };
  assert.equal((await browser.post('/api/courses', { draft: draftWith() }, elsewhere)).status, 403);
  assert.equal((await browser.raw('PUT', `/api/courses/${course.id}`, { revision: 1, draft: draftWith('Volé') }, elsewhere)).status, 403);
  assert.equal((await browser.post(`/api/courses/${course.id}/publish`, { revision: 1 }, elsewhere)).status, 403);
  assert.equal((await browser.raw('DELETE', `/api/courses/${course.id}`, undefined, elsewhere)).status, 403);
  assert.equal((await upload(base, browser, JPEG, elsewhere)).status, 403);
  assert.equal(count(db, 'courses'), 1);
  assert.equal(count(db, 'media'), 0);
});

test('un compte désactivé perd l’accès à ses cours', async (t) => {
  const { base, db, ids } = await site(t);
  const browser = await loggedIn(base);
  const course = await createCourse(browser);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${ids.teacher}/disable`);
  assert.equal((await browser.get(`/api/courses/${course.id}`)).status, 401);
  assert.equal(count(db, 'courses'), 1);
});

test('la page d’un cours est la même pour tous les cours, sans mise en cache durable', async (t) => {
  const { base, root } = await site(t);
  await writeFile(path.join(root, 'prof-cours.html'), '<title>cours</title>');
  const r = await request(base, '/prof/cours/un-identifiant');
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), '<title>cours</title>');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.equal((await request(base, '/prof/cours/a/b')).status, 404);
});

/* --- ADM-04 : chiffres de l'admin --- */

test('ADM-04 : l’admin voit des chiffres sur chaque enseignant, et ADM-07 : rien du contenu', async (t) => {
  const { base, db, ids } = await site(t);
  const browser = await loggedIn(base);
  const fiches = [{ id: 'f1' }, { id: 'f2' }];
  const first = await createCourse(browser, draftWith('Titre confidentiel', fiches));
  await createCourse(browser, draftWith('Autre titre confidentiel', [{ id: 'f3' }]));
  await browser.post(`/api/courses/${first.id}/publish`, { revision: 1 });
  await uploaded(base, browser, JPEG);
  const version = db.prepare('SELECT id FROM course_versions').get().id;
  db.prepare("INSERT INTO launches (id, course_id, version_id, code, opened_at) VALUES ('l1', ?, ?, 'ABC234', 'd')").run(first.id, version);

  const admin = await loggedIn(base, ADMIN);
  const r = await admin.get('/api/admin/teachers');
  const row = r.json().find((teacher) => teacher.id === ids.teacher);
  const size = (sql) => db.prepare(sql).get().n;
  assert.equal(row.courses, 2);
  assert.equal(row.fiches, 3);
  assert.equal(row.launches, 1);
  assert.equal(
    row.bytes,
    JPEG.length + size('SELECT SUM(LENGTH(draft)) AS n FROM courses') + size('SELECT SUM(LENGTH(content)) AS n FROM course_versions'),
    'fichiers, brouillons et versions'
  );
  assert.doesNotMatch(r.text, /confidentiel/);

  const empty = r.json().find((teacher) => teacher.id === ids.other);
  assert.deepEqual([empty.courses, empty.fiches, empty.launches, empty.bytes], [0, 0, 0, 0]);
});

/* --- Fichiers : LEG-02, SEC --- */

test('le type d’un fichier se lit dans son contenu : ni son nom ni l’en-tête annoncé n’y changent rien', async () => {
  assert.equal(sniffType(JPEG), 'jpg');
  assert.equal(sniffType(PNG), 'png');
  assert.equal(sniffType(WEBP), 'webp');
  assert.equal(sniffType(MP4), 'mp4');
  assert.equal(sniffType(WEBM), 'webm');
  for (const refused of [
    Buffer.alloc(0),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    Buffer.from('<!doctype html><script>alert(1)</script>'),
    Buffer.from('GIF89a'),
    Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'),
    Buffer.from('\0\0\0\x18ftypheic\0\0\0\0', 'latin1'),
    Buffer.from('\0\0\0\x18ftypavif\0\0\0\0', 'latin1'),
    Buffer.from('\0\0\0\x18ftypmif1\0\0\0\0', 'latin1')
  ]) {
    assert.equal(sniffType(refused), null, refused.toString('latin1').slice(0, 20));
  }
});

test('un fichier envoyé est servi sans compte, avec son type, en cache pour longtemps', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  for (const [body, type, ext] of [
    [JPEG, 'image/jpeg', 'jpg'],
    [PNG, 'image/png', 'png'],
    [WEBP, 'image/webp', 'webp'],
    [MP4, 'video/mp4', 'mp4'],
    [WEBM, 'video/webm', 'webm']
  ]) {
    const { url, size } = await uploaded(base, browser, body);
    assert.match(url, new RegExp(`^/media/[0-9a-f]{64}\\.${ext}$`));
    assert.equal(size, body.length);
    const r = await request(base, url);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, body);
    assert.equal(r.headers['content-type'], type);
    assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
});

test('un fichier piégé est refusé, quel que soit le type annoncé', async (t) => {
  const { base, db, mediaDir } = await site(t);
  const browser = await loggedIn(base);
  const r = await upload(base, browser, Buffer.from('<svg onload="alert(1)"/>'), { 'Content-Type': 'image/jpeg' });
  assert.equal(r.status, 415);
  assert.match(r.body.toString(), /JPEG, PNG ou WebP/);
  assert.equal(count(db, 'media'), 0);
  assert.deepEqual(readdirSync(mediaDir), []);
});

test('un fichier trop lourd est refusé avec un 413', async (t) => {
  const { base, db, mediaDir } = await site(t, { maxBody: 1024 });
  const browser = await loggedIn(base);
  const r = await upload(base, browser, Buffer.concat([JPEG, Buffer.alloc(4096)]));
  assert.equal(r.status, 413);
  assert.equal(count(db, 'media'), 0);
  assert.deepEqual(readdirSync(mediaDir), []);
});

test('un même contenu n’occupe qu’un fichier, compté pour chaque compte qui l’utilise', async (t) => {
  const { base, db, ids, mediaDir } = await site(t);
  const first = await uploaded(base, await loggedIn(base), JPEG);
  const again = await uploaded(base, await loggedIn(base), JPEG);
  const other = await uploaded(base, await loggedIn(base, OTHER), JPEG);
  assert.equal(first.url, again.url);
  assert.equal(first.url, other.url);
  assert.equal(readdirSync(mediaDir).length, 1);
  assert.deepEqual(
    db
      .prepare('SELECT account_id FROM media ORDER BY account_id')
      .all()
      .map((row) => row.account_id),
    [ids.teacher, ids.other].sort()
  );
});

test('une adresse de fichier invalide répond 404, sans sortir du dossier', async (t) => {
  const { base, data } = await site(t);
  await writeFile(path.join(data, 'secret.jpg'), 'secret');
  const hash = 'a'.repeat(64);
  for (const target of [
    `/media/${hash}.jpg`,
    `/media/${hash}.svg`,
    `/media/${hash.toUpperCase()}.jpg`,
    '/media/secret.jpg',
    '/media/..%2Fsecret.jpg',
    '/media/..%2Fapp.db',
    `/media/${hash}.jpg.tmp`
  ]) {
    assert.equal((await request(base, target)).status, 404, target);
  }
});

test('POST /api/media et les routes de lecture refusent les mauvaises méthodes', async (t) => {
  const { base } = await site(t);
  const r = await request(base, `/media/${'a'.repeat(64)}.jpg`, { method: 'POST', headers: { Origin: base } });
  assert.equal(r.status, 405);
  assert.equal((await request(base, '/api/media')).status, 405);
});

/* --- Vidéos : plages d'octets, sans lesquelles Safari ne lit rien --- */

test('une vidéo se lit par plages d’octets', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const body = Buffer.concat([MP4, Buffer.from('0123456789')]);
  const { url } = await uploaded(base, browser, body);
  const size = body.length;
  const range = (value, method = 'GET') => request(base, url, { method, headers: { Range: value } });

  const full = await request(base, url);
  assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.equal(full.headers['content-length'], String(size));

  const middle = await range('bytes=2-5');
  assert.equal(middle.status, 206);
  assert.deepEqual(middle.body, body.subarray(2, 6));
  assert.equal(middle.headers['content-range'], `bytes 2-5/${size}`);
  assert.equal(middle.headers['content-length'], '4');
  assert.equal(middle.headers['content-type'], 'video/mp4');
  assert.equal(middle.headers['cache-control'], 'public, max-age=31536000, immutable');

  const open = await range(`bytes=${size - 3}-`);
  assert.deepEqual(open.body, body.subarray(size - 3));
  assert.equal(open.headers['content-range'], `bytes ${size - 3}-${size - 1}/${size}`);

  const suffix = await range('bytes=-4');
  assert.deepEqual(suffix.body, body.subarray(size - 4));
  assert.equal((await range(`bytes=-${size + 10}`)).headers['content-range'], `bytes 0-${size - 1}/${size}`);

  const beyond = await range(`bytes=2-${size + 50}`);
  assert.equal(beyond.status, 206);
  assert.equal(beyond.headers['content-range'], `bytes 2-${size - 1}/${size}`);

  const head = await range('bytes=0-1', 'HEAD');
  assert.equal(head.status, 206);
  assert.equal(head.body.length, 0);

  const impossible = await range(`bytes=${size}-`);
  assert.equal(impossible.status, 416);
  assert.equal(impossible.headers['content-range'], `bytes */${size}`);
  assert.equal((await range('bytes=5-2')).status, 416);

  for (const ignored of ['octets=0-1', 'bytes=-', 'bytes=0-1,3-4', 'n’importe quoi']) {
    const r = await range(encodeURI(ignored));
    assert.equal(r.status, 200, ignored);
    assert.deepEqual(r.body, body);
  }
});

test('une page ou un texte compressé n’annonce pas de plages', async (t) => {
  const { base, root } = await site(t);
  await writeFile(path.join(root, 'long.css'), 'a{}'.repeat(1000));
  const r = await request(base, '/long.css', { headers: { Range: 'bytes=0-1', 'Accept-Encoding': 'gzip' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['accept-ranges'], undefined);
  assert.equal(r.headers['content-encoding'], 'gzip');
});

/* --- Nettoyage des fichiers --- */

test('un fichier qui ne sert plus est effacé après un jour, pas avant', async (t) => {
  const { app, base, db, mediaDir } = await site(t);
  const browser = await loggedIn(base);
  const { url } = await uploaded(base, browser, JPEG);
  const name = path.basename(url);

  app.purge();
  assert.ok(existsSync(path.join(mediaDir, name)), 'il vient d’être envoyé : le brouillon qui le cite n’est peut-être pas encore enregistré');

  ageMedia(db, 0.9);
  app.purge();
  assert.ok(existsSync(path.join(mediaDir, name)));

  ageMedia(db, 1.1);
  app.purge();
  assert.equal(existsSync(path.join(mediaDir, name)), false);
  assert.equal(count(db, 'media'), 0);
  assert.equal((await request(base, url)).status, 404);
});

test('renvoyer un fichier le protège de nouveau du nettoyage', async (t) => {
  const { app, base, db, mediaDir } = await site(t);
  const browser = await loggedIn(base);
  await uploaded(base, browser, JPEG);
  ageMedia(db, 2);
  await uploaded(base, browser, JPEG);
  app.purge();
  assert.equal(readdirSync(mediaDir).length, 1);
  assert.equal(count(db, 'media'), 1);
});

test('COU-11 : un fichier cité par le brouillon ou par une version publiée reste', async (t) => {
  const { app, base, db, mediaDir } = await site(t);
  const browser = await loggedIn(base);
  const plan = await uploaded(base, browser, PNG);
  const photo = await uploaded(base, browser, JPEG);
  const fiche = { id: 'f1', media: [{ id: 'm1', type: 'image', data: photo.url }] };
  const course = await createCourse(browser, draftWith('Cours', [fiche], plan.url));
  await browser.post(`/api/courses/${course.id}/publish`, { revision: 1 });
  ageMedia(db, 10);

  app.purge();
  assert.equal(readdirSync(mediaDir).length, 2, 'cités par le brouillon et par la version');

  await put(browser, course.id, 1, draftWith('Cours', [], plan.url));
  ageMedia(db, 10);
  app.purge();
  assert.equal(readdirSync(mediaDir).length, 2, 'la photo retirée du brouillon reste citée par la version publiée');
  assert.equal((await request(base, photo.url)).status, 200);

  await browser.raw('DELETE', `/api/courses/${course.id}`);
  app.purge();
  assert.deepEqual(readdirSync(mediaDir), [], 'le cours supprimé ne cite plus rien');
  assert.equal(count(db, 'media'), 0);
});

test('un fichier partagé reste tant qu’un autre compte l’utilise', async (t) => {
  const { app, base, db, ids, mediaDir } = await site(t);
  const owner = await loggedIn(base);
  const other = await loggedIn(base, OTHER);
  const { url } = await uploaded(base, owner, JPEG);
  await uploaded(base, other, JPEG);
  await createCourse(other, draftWith('Cours', [], url));
  ageMedia(db, 5);
  app.purge();
  assert.equal(readdirSync(mediaDir).length, 1);
  assert.deepEqual(
    db
      .prepare('SELECT account_id FROM media')
      .all()
      .map((row) => row.account_id),
    [ids.other],
    'seul l’autre compte l’utilise encore'
  );
  assert.equal((await request(base, url)).status, 200);
});

test('un cours d’un autre compte ne protège pas un fichier qu’on n’utilise plus', async (t) => {
  const { app, base, db, ids } = await site(t);
  const owner = await loggedIn(base);
  const other = await loggedIn(base, OTHER);
  const { url } = await uploaded(base, owner, JPEG);
  await createCourse(other, draftWith('Cours', [], url));
  ageMedia(db, 5);
  app.purge();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media WHERE account_id = ?').get(ids.teacher).n, 0);
});

test('ADM-10 : effacer un compte libère ses fichiers, sauf ceux qu’un autre compte utilise', async (t) => {
  const { app, base, db, ids, mediaDir } = await site(t);
  const owner = await loggedIn(base);
  const other = await loggedIn(base, OTHER);
  const own = await uploaded(base, owner, PNG);
  const shared = await uploaded(base, owner, JPEG);
  await uploaded(base, other, JPEG);
  await createCourse(owner, draftWith('Cours', [{ id: 'f', media: [{ id: 'm', data: shared.url }] }], own.url));
  await createCourse(other, draftWith('Cours', [], shared.url));

  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${ids.teacher}/disable`);
  await admin.post(`/api/admin/teachers/${ids.teacher}/delete`, { word: 'SUPPRIMER' });
  ageMedia(db, 5);
  app.purge();
  assert.equal(readdirSync(mediaDir).length, 2, 'pendant les 14 jours, les fichiers restent : le compte peut être restauré');

  db.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 15 * DAY).toISOString(), ids.teacher);
  app.purge();
  assert.deepEqual(readdirSync(mediaDir), [path.basename(shared.url)]);
  assert.equal((await request(base, own.url)).status, 404);
  assert.equal((await request(base, shared.url)).status, 200);
});

test('un envoi interrompu ne reste pas plus d’un jour', async (t) => {
  const { app, mediaDir } = await site(t);
  const recent = path.join(mediaDir, 'recent.tmp');
  const old = path.join(mediaDir, 'ancien.tmp');
  writeFileSync(recent, 'x');
  writeFileSync(old, 'x');
  const past = new Date(Date.now() - 2 * DAY);
  utimesSync(old, past, past);
  app.purge();
  assert.equal(existsSync(old), false);
  assert.ok(existsSync(recent));
});
