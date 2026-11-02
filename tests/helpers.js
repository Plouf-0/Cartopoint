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
  t.after(() => rm(dir, { recursive: true, force: true }));
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

/** Démarre l'application complète dans ce processus, avec ses dossiers temporaires. */
export async function startApp(t, options = {}) {
  t.mock.method(console, 'log', () => {});
  const data = await tempDir(t);
  const root = await tempDir(t);
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>ok</title>');
  const app = createApp({ root, data, ...options });
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
