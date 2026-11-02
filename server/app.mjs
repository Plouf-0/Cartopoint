/**
 * Assemble l'application : base de données, routes et fichiers statiques. Rien n'écoute ni ne se
 * planifie ici, pour que les tests puissent la démarrer et l'arrêter dans leur propre processus.
 */
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { backupDatabase, openDatabase } from './db.mjs';
import { createHandler, createRouter, staticFiles } from './http.mjs';
import { legacyRoutes } from './routes/legacy.mjs';

export function createApp({ root, data, password = '', maxBody = 100 * 1024 * 1024, trustProxy = false }) {
  mkdirSync(data, { recursive: true });
  const db = openDatabase(path.join(data, 'app.db'));
  const router = createRouter();
  legacyRoutes(router, { data, password, maxBody, trustProxy });
  const server = http.createServer(createHandler(router, staticFiles(root)));
  return {
    server,
    db,
    backup: () => backupDatabase(db, path.join(data, 'backups')),
    close() {
      return new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      });
    }
  };
}
