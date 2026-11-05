import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { createHandler } from '../server/http.mjs';

/** Dossier temporaire supprimé à la fin du test. */
export async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ib-test-'));
  // Les nouvelles tentatives couvrent un fichier créé pendant l'effacement
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

/** Démarre un routeur seul, sans base de données. Renvoie l'adresse de base. */
export async function serve(t, router, fallback) {
  const server = http.createServer(createHandler(router, fallback));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

/**
 * Démarre l'application complète dans ce processus, avec ses dossiers temporaires. Les corrections y partent dès la fin du cours ;
 * `correctionDelay: undefined` remet le délai de la production (CRG-14).
 */
export async function startApp(t, options = {}) {
  t.mock.method(console, 'log', () => {});
  const data = await tempDir(t);
  const root = await tempDir(t);
  await writeFile(path.join(root, 'accueil.html'), '<!doctype html><title>ok</title>');
  const app = createApp({ root, data, correctionDelay: 0, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return { app, data, root, base: `http://127.0.0.1:${app.server.address().port}` };
}

/**
 * Requête brute. fetch() décompresse les réponses et normalise les adresses : il cacherait
 * justement ce que ces tests veulent voir.
 */
export function request(base, target, { method = 'GET', headers = {}, body } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: target, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Un port libre, pour les tests qui lancent le serveur dans un autre processus. */
export function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Un client HTTP qui garde son cookie de session, comme un navigateur, et envoie Origin sur tout. */
export function client(base) {
  let cookie = null;
  const call = async (method, target, body, headers = {}) => {
    const all = { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers };
    const r = await request(base, target, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined))
    });
    const setCookie = r.headers['set-cookie']?.[0];
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = r.body.toString();
    return { status: r.status, headers: r.headers, text, setCookie, json: () => JSON.parse(text) };
  };
  return {
    get: (target, headers) => call('GET', target, undefined, headers),
    post: (target, body = {}, headers) => call('POST', target, body, headers),
    put: (target, body = {}, headers) => call('PUT', target, body, headers),
    delete: (target, headers) => call('DELETE', target, undefined, headers),
    raw: call,
    get cookie() {
      return cookie;
    },
    set cookie(value) {
      cookie = value;
    }
  };
}

/** Ajoute un compte directement en base : plus rapide que le parcours complet, et sans y dépendre. */
export function addAccount(db, { id = randomUUID(), email, role = 'teacher', hash = null, disabledAt = null }) {
  db.prepare('INSERT INTO accounts (id, email, password_hash, role, disabled_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    email,
    hash,
    role,
    disabledAt,
    new Date().toISOString()
  );
  return id;
}

/**
 * Empreinte bon marché : les réglages sont lus dans l'empreinte, donc le serveur s'y adapte. Sans cela,
 * chaque connexion d'un test coûterait 136 ms, et une suite lente finit par ne plus être lancée.
 */
export function cheapHash(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 1024, r: 8, p: 1 });
  return ['scrypt', 1024, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Relit une archive ZIP sans compression, comme celles du site : { nom du fichier : octets }. Passe par la table centrale, comme un vrai lecteur. */
export function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    files[name] = buffer.subarray(start, start + size);
    at += 46 + nameLength;
  }
  return files;
}

/** Les lignes d'une page d'un classeur : texte ou nombre, chaque cellule à sa place. */
export function sheetRows(xml) {
  const columnIndex = (reference) => [...reference.match(/^[A-Z]+/)[0]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  const unescape = (text) =>
    text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  return [...xml.matchAll(/<row [^>]*?(?:\/>|>(.*?)<\/row>)/g)].map(([, body = '']) => {
    const row = [];
    for (const [, reference, attributes, content] of body.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/g)) {
      row[columnIndex(reference)] = attributes.includes('inlineStr')
        ? unescape(content.match(/<t[^>]*>(.*?)<\/t>/)[1])
        : Number(content.match(/<v>(.*?)<\/v>/)[1]);
    }
    return Array.from(row, (cell) => cell ?? null);
  });
}
