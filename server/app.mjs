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
import { createIncidents } from './incidents.mjs';
import { createLaunches } from './launches.mjs';
import { createMedia } from './media.mjs';
import { adminRoutes } from './routes/admin.mjs';
import { authRoutes } from './routes/auth.mjs';
import { courseRoutes } from './routes/courses.mjs';
import { incidentRoutes } from './routes/incidents.mjs';
import { launchRoutes } from './routes/launches.mjs';
import { legacyRoutes } from './routes/legacy.mjs';
import { pageRoutes } from './routes/pages.mjs';
import { studentRoutes } from './routes/student.mjs';

export function createApp({ root, data, password = '', maxBody = 100 * 1024 * 1024, trustProxy = false }) {
  mkdirSync(data, { recursive: true });
  const db = openDatabase(path.join(data, 'app.db'));
  const auth = createAuth(db, { trustProxy });
  const courses = createCourses(db);
  const launches = createLaunches(db);
  const media = createMedia(db, path.join(data, 'media'));
  const incidents = createIncidents(db);
  const router = createRouter();
  authRoutes(router, auth, { trustProxy });
  adminRoutes(router, auth, courses);
  incidentRoutes(router, { auth, incidents });
  courseRoutes(router, { auth, courses, media, maxBody });
  launchRoutes(router, { auth, courses, launches });
  studentRoutes(router, { launches, trustProxy });
  pageRoutes(router, root);
  legacyRoutes(router, { data, password, maxBody, trustProxy });
  const server = http.createServer(createHandler(router, staticFiles(root)));
  return {
    server,
    db,
    backup: () => backupDatabase(db, path.join(data, 'backups')),
    purge() {
      // Dans cet ordre : un compte effacé ou un lancement trop ancien libèrent leurs fichiers
      auth.purge();
      launches.purge();
      media.purge();
      incidents.purge();
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
