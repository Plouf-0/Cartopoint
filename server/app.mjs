/**
 * Assemble l'application : base de données, routes et fichiers statiques. Rien n'écoute ni ne se
 * planifie ici, pour que les tests puissent la démarrer et l'arrêter dans leur propre processus.
 */
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createAuth } from './auth.mjs';
import { createCourses } from './courses.mjs';
import { backupDatabase, openDatabase } from './db.mjs';
import { createHandler, createRouter, staticFiles } from './http.mjs';
import { createMedia } from './media.mjs';
import { adminRoutes } from './routes/admin.mjs';
import { authRoutes } from './routes/auth.mjs';
import { courseRoutes } from './routes/courses.mjs';
import { legacyRoutes } from './routes/legacy.mjs';
import { pageRoutes } from './routes/pages.mjs';

export function createApp({ root, data, password = '', maxBody = 100 * 1024 * 1024, trustProxy = false }) {
  mkdirSync(data, { recursive: true });
  const db = openDatabase(path.join(data, 'app.db'));
  const auth = createAuth(db, { trustProxy });
  const courses = createCourses(db);
  const media = createMedia(db, path.join(data, 'media'));
  const router = createRouter();
  authRoutes(router, auth, { trustProxy });
  adminRoutes(router, auth, courses);
  courseRoutes(router, { auth, courses, media, maxBody });
  pageRoutes(router, root);
  legacyRoutes(router, { data, password, maxBody, trustProxy });
  const server = http.createServer(createHandler(router, staticFiles(root)));
  return {
    server,
    db,
    backup: () => backupDatabase(db, path.join(data, 'backups')),
    purge() {
      // Dans cet ordre : un compte effacé libère ses fichiers
      auth.purge();
      media.purge();
    },
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
