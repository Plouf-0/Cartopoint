import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRouter, HttpError, readBody, readJson, send, sendJson, staticFiles } from '../server/http.mjs';
import { request, serve, tempDir } from './helpers.js';

const LARGE = 'contenu répétitif '.repeat(500);
const BIG_JSON = { texte: LARGE };

/** Un petit site : www/ est servi, ses voisins ne doivent jamais sortir. */
async function site(t) {
  const parent = await tempDir(t);
  const root = path.join(parent, 'www');
  await mkdir(path.join(root, 'dossier'), { recursive: true });
  await mkdir(path.join(parent, 'www-voisin'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>accueil</title>');
  await writeFile(path.join(root, 'app.js'), LARGE);
  await writeFile(path.join(root, 'petit.css'), 'a{}');
  await writeFile(path.join(root, 'photo.png'), Buffer.alloc(5000, 1));
  await writeFile(path.join(root, 'donnees.inconnu'), 'x');
  await writeFile(path.join(parent, 'secret.txt'), 'ne doit pas sortir');
  await writeFile(path.join(parent, 'www-voisin', 'secret.txt'), 'ne doit pas sortir');
  return { root, base: await serve(t, createRouter(), staticFiles(root)) };
}

test("E-05 : un fichier texte part en gzip si le navigateur l'accepte", async (t) => {
  const { base } = await site(t);
  const r = await request(base, '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(r.headers.vary, 'Accept-Encoding');
  assert.equal(r.headers['content-length'], undefined);
  assert.ok(r.body.length < Buffer.byteLength(LARGE) / 10, 'le contenu doit être nettement plus léger');
  assert.equal(gunzipSync(r.body).toString(), LARGE);
});

test('E-05 : sans Accept-Encoding, le fichier part tel quel, avec sa longueur', async (t) => {
  const { base } = await site(t);
  const r = await request(base, '/app.js');
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.headers['content-length'], String(Buffer.byteLength(LARGE)));
  assert.equal(r.body.toString(), LARGE);
});

test('E-05 : Accept-Encoding est lu correctement', async (t) => {
  const { base } = await site(t);
  const cases = { 'GZIP;q=0.5': 'gzip', 'br, gzip': 'gzip', 'gzip;q=0': undefined, 'gzip; q=0': undefined, br: undefined, xgzip: undefined };
  for (const [accept, expected] of Object.entries(cases)) {
    const r = await request(base, '/app.js', { headers: { 'Accept-Encoding': accept } });
    assert.equal(r.headers['content-encoding'], expected, accept);
  }
});

test('E-05 : ni les petits fichiers ni les images ne sont compressés', async (t) => {
  const { base } = await site(t);
  for (const file of ['/petit.css', '/photo.png']) {
    const r = await request(base, file, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200, file);
    assert.equal(r.headers['content-encoding'], undefined, file);
    assert.equal(r.headers.vary, undefined, file);
  }
});

test('E-05 : un client qui a déjà le fichier reçoit un 304 sans contenu', async (t) => {
  const { base } = await site(t);
  const first = await request(base, '/app.js');
  const etag = first.headers.etag;
  assert.match(etag, /^W\/"/);
  const accepted = [etag, etag.replace(/^W\//, ''), `"autre", ${etag}`, '*'];
  for (const value of accepted) {
    const r = await request(base, '/app.js', { headers: { 'If-None-Match': value } });
    assert.equal(r.status, 304, value);
    assert.equal(r.body.length, 0, value);
    assert.equal(r.headers.etag, etag, value);
    assert.equal(r.headers['cache-control'], first.headers['cache-control'], value);
    assert.equal(r.headers.vary, 'Accept-Encoding', value);
  }
  const other = await request(base, '/app.js', { headers: { 'If-None-Match': '"autre"' } });
  assert.equal(other.status, 200);
});

test("E-05 : l'ETag est le même avec et sans compression, et change avec le fichier", async (t) => {
  const { base, root } = await site(t);
  const plain = await request(base, '/app.js');
  const zipped = await request(base, '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(plain.headers.etag, zipped.headers.etag);

  const later = new Date(Date.now() + 60000);
  await utimes(path.join(root, 'app.js'), later, later);
  const touched = await request(base, '/app.js', { headers: { 'If-None-Match': plain.headers.etag } });
  assert.equal(touched.status, 200);
  assert.notEqual(touched.headers.etag, plain.headers.etag);

  await writeFile(path.join(root, 'app.js'), LARGE + 'modifié');
  const changed = await request(base, '/app.js', { headers: { 'If-None-Match': touched.headers.etag } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.toString(), LARGE + 'modifié');
});

test('HEAD donne les en-têtes, sans le contenu', async (t) => {
  const { base } = await site(t);
  const plain = await request(base, '/app.js', { method: 'HEAD' });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.length, 0);
  assert.equal(plain.headers['content-length'], String(Buffer.byteLength(LARGE)));

  const zipped = await request(base, '/app.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(zipped.body.length, 0);
  assert.equal(zipped.headers['content-encoding'], 'gzip');

  const fresh = await request(base, '/app.js', { method: 'HEAD', headers: { 'If-None-Match': plain.headers.etag } });
  assert.equal(fresh.status, 304);
});

test('SRV-10 : les pages, scripts et styles sont revalidés, les autres fichiers gardés une heure', async (t) => {
  const { base } = await site(t);
  const page = await request(base, '/');
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(page.body.toString(), /accueil/);
  assert.equal((await request(base, '/index.html')).status, 200);
  assert.equal((await request(base, '/petit.css')).headers['cache-control'], 'no-cache');
  assert.equal((await request(base, '/app.js')).headers['cache-control'], 'no-cache');
  const photo = await request(base, '/photo.png');
  assert.equal(photo.headers['content-type'], 'image/png');
  assert.equal(photo.headers['cache-control'], 'public, max-age=3600');
});

test('un type de fichier inconnu est servi comme binaire, jamais interprété', async (t) => {
  const { base } = await site(t);
  const r = await request(base, '/donnees.inconnu');
  assert.equal(r.headers['content-type'], 'application/octet-stream');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('un chemin absent ou un dossier donne un 404', async (t) => {
  const { base } = await site(t);
  for (const p of ['/absent.js', '/dossier', '/dossier/']) assert.equal((await request(base, p)).status, 404, p);
});

test('SRV-09 : aucun chemin ne sort du dossier servi', async (t) => {
  const { base } = await site(t);
  const attempts = [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/dossier/../../secret.txt',
    '/....//secret.txt',
    '/../www-voisin/secret.txt',
    '/%2e%2e/www-voisin/secret.txt'
  ];
  for (const p of attempts) {
    const r = await request(base, p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body.toString(), /ne doit pas sortir/, p);
  }
});

test('une adresse mal encodée donne un 400, pas une erreur du serveur', async (t) => {
  const { base } = await site(t);
  const encoded = await request(base, '/%E0%A4%A');
  assert.equal(encoded.status, 400);
  assert.equal(encoded.body.toString(), 'Chemin invalide');
  const malformed = await request(base, '//');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.toString(), 'Adresse invalide');
});

test('un client qui part en cours de téléchargement ne fait pas tomber le serveur', async (t) => {
  const { base, root } = await site(t);
  await writeFile(path.join(root, 'lourd.png'), Buffer.alloc(16 * 1024 * 1024, 1));
  const { hostname, port } = new URL(base);
  await new Promise((resolve) => {
    const req = http.get({ hostname, port, path: '/lourd.png' }, (res) => {
      res.once('data', () => req.destroy());
    });
    req.on('error', () => {});
    req.on('close', resolve);
  });
  assert.equal((await request(base, '/petit.css')).status, 200);
});

/* --- JSON --- */

function jsonRoutes() {
  return createRouter()
    .add('GET', '/petit', (req, res) => sendJson(req, res, { ok: true }))
    .add('GET', '/grand', (req, res) => sendJson(req, res, BIG_JSON))
    .add('GET', '/prive', (req, res) => sendJson(req, res, { ok: true }, { cache: 'no-store' }))
    .add('PUT', '/modifie', (req, res) => sendJson(req, res, { ok: true }))
    .add('POST', '/cree', (req, res) => sendJson(req, res, { ok: true }, { status: 201 }));
}

test('E-05 : une réponse JSON porte un ETag et donne un 304', async (t) => {
  const base = await serve(t, jsonRoutes());
  const r = await request(base, '/petit');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.equal(r.headers['content-length'], String(r.body.length));
  const fresh = await request(base, '/petit', { headers: { 'If-None-Match': r.headers.etag } });
  assert.equal(fresh.status, 304);
  assert.equal(fresh.body.length, 0);
});

test('E-05 : une grosse réponse JSON est compressée, une petite non', async (t) => {
  const base = await serve(t, jsonRoutes());
  const big = await request(base, '/grand', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(big.headers['content-encoding'], 'gzip');
  assert.equal(big.headers.vary, 'Accept-Encoding');
  assert.equal(big.headers['content-length'], String(big.body.length));
  assert.deepEqual(JSON.parse(gunzipSync(big.body)), BIG_JSON);

  const raw = await request(base, '/grand');
  assert.equal(raw.headers['content-encoding'], undefined);
  assert.equal(raw.headers.etag, big.headers.etag);
  assert.deepEqual(JSON.parse(raw.body), BIG_JSON);

  const small = await request(base, '/petit', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(small.headers['content-encoding'], undefined);
  assert.equal(small.headers.vary, undefined);
});

test("seule une lecture réussie porte un ETag ; l'en-tête de cache se règle", async (t) => {
  const base = await serve(t, jsonRoutes());
  assert.equal((await request(base, '/modifie', { method: 'PUT' })).headers.etag, undefined);
  const created = await request(base, '/cree', { method: 'POST' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.etag, undefined);
  assert.equal((await request(base, '/prive')).headers['cache-control'], 'no-store');
  const head = await request(base, '/petit', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.ok(head.headers.etag);
  assert.equal(head.body.length, 0);
});

/* --- Routage --- */

test('le routeur lit les paramètres, y compris avec un suffixe', () => {
  const handler = () => {};
  const router = createRouter().add('GET', '/courses/:id', handler).add('GET', '/projets/:name.json', handler).add('GET', '/a/:x/b/:y', handler);
  assert.deepEqual(router.find('GET', '/courses/abc').params, { id: 'abc' });
  assert.deepEqual(router.find('GET', '/projets/rocaille.json').params, { name: 'rocaille' });
  assert.deepEqual(router.find('GET', '/a/1/b/2').params, { x: '1', y: '2' });
  assert.deepEqual(router.find('GET', '/courses/a%20b').params, { id: 'a b' });
  assert.equal(router.find('GET', '/courses/abc').handler, handler);
});

test('le routeur ne confond pas les chemins voisins', () => {
  const router = createRouter()
    .add('GET', '/courses/:id', () => {})
    .add('GET', '/projets/:name.json', () => {});
  for (const p of ['/courses', '/courses/', '/courses/a/b', '/projets/aXjson', '/projets/a.json/x', '/x/courses/a']) {
    assert.equal(router.find('GET', p).handler, undefined, p);
    assert.deepEqual(router.find('GET', p).allow, [], p);
  }
});

test('HEAD suit les routes GET, et une mauvaise méthode donne un 405 avec Allow', async (t) => {
  const router = createRouter()
    .add('GET', '/lire', (req, res) => send(res, 200, 'lu'))
    .add('PUT', '/ecrire', (req, res) => send(res, 200, 'écrit'))
    .add('DELETE', '/ecrire', (req, res) => send(res, 200, 'supprimé'));
  const base = await serve(t, router);
  assert.equal((await request(base, '/lire', { method: 'HEAD' })).status, 200);

  const onRead = await request(base, '/lire', { method: 'POST' });
  assert.equal(onRead.status, 405);
  assert.equal(onRead.headers.allow, 'GET, HEAD');

  const onWrite = await request(base, '/ecrire');
  assert.equal(onWrite.status, 405);
  assert.equal(onWrite.headers.allow, 'PUT, DELETE');
  assert.equal(onWrite.body.toString(), 'Méthode non autorisée');
});

test('sans route, on tombe sur les fichiers en lecture, et sur un 405 pour le reste', async (t) => {
  const { root } = await site(t);
  const base = await serve(t, createRouter(), staticFiles(root));
  assert.equal((await request(base, '/')).status, 200);
  const write = await request(base, '/', { method: 'POST' });
  assert.equal(write.status, 405);
  assert.equal(write.headers.allow, 'GET, HEAD');
});

test('sans route ni fichiers, la réponse est un 404', async (t) => {
  const base = await serve(t, createRouter());
  assert.equal((await request(base, '/rien')).status, 404);
  assert.equal((await request(base, '/rien', { method: 'POST' })).status, 404);
});

test('un paramètre mal encodé donne un 400', async (t) => {
  const base = await serve(
    t,
    createRouter().add('GET', '/courses/:id', (req, res) => send(res, 200, 'ok'))
  );
  assert.equal((await request(base, '/courses/%E0%A4%A')).status, 400);
});

/* --- Erreurs --- */

test('une HttpError est transmise au client, sans bruit dans les journaux', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const router = createRouter().add('GET', '/refus', () => {
    throw new HttpError(403, 'Accès refusé');
  });
  const base = await serve(t, router);
  const r = await request(base, '/refus');
  assert.equal(r.status, 403);
  assert.equal(r.body.toString(), 'Accès refusé');
  assert.equal(logged.mock.callCount(), 0);
});

test('une erreur imprévue donne un 500 sans détail pour le client, et reste dans les journaux', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const router = createRouter().add('GET', '/panne', async () => {
    throw new Error('détail interne');
  });
  const base = await serve(t, router);
  const r = await request(base, '/panne');
  assert.equal(r.status, 500);
  assert.equal(r.body.toString(), 'Erreur du serveur');
  assert.equal(logged.mock.callCount(), 1);
});

test('une erreur une fois la réponse commencée coupe la connexion au lieu de terminer une réponse fausse', async (t) => {
  const router = createRouter().add('GET', '/coupure', (req, res) => {
    res.writeHead(200);
    res.write('début');
    throw new Error('panne');
  });
  const base = await serve(t, router);
  await assert.rejects(request(base, '/coupure'));
});

/* --- Corps des requêtes --- */

function echoRoutes(limit) {
  return createRouter().add('PUT', '/echo', async (req, res) => send(res, 200, await readBody(req, limit)));
}

test('readBody rend le corps, jusqu’à la limite comprise', async (t) => {
  const base = await serve(t, echoRoutes(10));
  const r = await request(base, '/echo', { method: 'PUT', body: '0123456789' });
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), '0123456789');
  assert.equal((await request(base, '/echo', { method: 'PUT' })).body.length, 0);
});

test('SRV-07 : au-delà de la limite, le client reçoit bien un 413 au lieu d’une connexion coupée', async (t) => {
  const base = await serve(t, echoRoutes(10));
  const small = await request(base, '/echo', { method: 'PUT', body: '01234567890' });
  assert.equal(small.status, 413);
  assert.equal(small.body.toString(), 'trop volumineux');

  const large = await request(base, '/echo', { method: 'PUT', body: Buffer.alloc(8 * 1024 * 1024, 1) });
  assert.equal(large.status, 413);
  assert.equal((await request(base, '/echo', { method: 'PUT', body: 'ok' })).status, 200);
});

test('un envoi interrompu ne fait pas tomber le serveur', async (t) => {
  const base = await serve(t, echoRoutes(1024));
  const { hostname, port } = new URL(base);
  await new Promise((resolve) => {
    const req = http.request({ hostname, port, path: '/echo', method: 'PUT', headers: { 'Content-Length': 1000 } });
    req.on('error', () => {});
    req.on('close', resolve);
    req.write('début', () => req.destroy());
  });
  assert.equal((await request(base, '/echo', { method: 'PUT', body: 'ok' })).status, 200);
});

test('readJson rend un objet, et refuse tout le reste avec un 400', async (t) => {
  const base = await serve(
    t,
    createRouter().add('POST', '/json', async (req, res) => sendJson(req, res, await readJson(req, 100)))
  );
  const ok = await request(base, '/json', { method: 'POST', body: '{"a":1}' });
  assert.deepEqual(JSON.parse(ok.body), { a: 1 });
  for (const body of ['', 'pas du json', 'null', '[1]', '12', '"texte"']) {
    const r = await request(base, '/json', { method: 'POST', body });
    assert.equal(r.status, 400, body);
    assert.equal(r.body.toString(), 'Requête invalide', body);
  }
  assert.equal((await request(base, '/json', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(200) }) })).status, 413);
});
