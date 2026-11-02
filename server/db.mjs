/**
 * Base SQLite (node:sqlite, sans dépendance). C'est le seul fichier qui importe node:sqlite : son
 * interface évolue encore, et un changement ne doit toucher qu'ici.
 *
 * Migrations : fichiers migrations/NNN-nom.sql, numérotés sans trou à partir de 1. La version de
 * la base est gardée dans PRAGMA user_version. Chaque migration s'applique en entier ou pas du tout.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const KEEP_BACKUPS = 14;
/** Nom exact : ne jamais confondre avec les sauvegardes d'un projet rangées dans le même dossier (E-11). */
const BACKUP_NAME = /^app-\d{4}-\d{2}-\d{2}\.db$/;

export function openDatabase(file, migrations = MIGRATIONS) {
  const db = new DatabaseSync(file);
  // node:sqlite est synchrone : une écriture lente bloque tout le serveur. Mesuré sur le serveur :
  // 50 ms par écriture avec FULL, 0,1 ms avec NORMAL. En mode WAL, NORMAL ne peut pas corrompre la
  // base ; seule une coupure de courant peut perdre les toutes dernières écritures.
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  try {
    migrate(db, migrations);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

function migrationFiles(dir) {
  const files = readdirSync(dir)
    .filter((name) => /^\d+-.+\.sql$/.test(name))
    .sort((a, b) => parseInt(a) - parseInt(b));
  files.forEach((name, i) => {
    if (parseInt(name) !== i + 1) throw new Error(`migration ${name} : le numéro ${i + 1} était attendu`);
  });
  return files;
}

export function migrate(db, dir = MIGRATIONS) {
  const files = migrationFiles(dir);
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > files.length) throw new Error(`la base est en version ${current}, plus récente que le code (${files.length})`);
  files.slice(current).forEach((name, i) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(path.join(dir, name), 'utf8'));
      db.exec(`PRAGMA user_version = ${current + i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${name} : ${e.message}`);
    }
  });
}

/**
 * Copie de la base pour aujourd'hui, si elle n'existe pas encore : backups/app-AAAA-MM-JJ.db.
 * Renvoie le chemin créé, ou null s'il n'y avait rien à faire.
 */
export function backupDatabase(db, dir, { keep = KEEP_BACKUPS, now = new Date() } = {}) {
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `app-${now.toISOString().slice(0, 10)}.db`);
  if (existsSync(target)) return null;
  // VACUUM INTO refuse un fichier existant, et une copie interrompue ne doit pas passer pour bonne
  const tmp = target + '.tmp';
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  renameSync(tmp, target);
  const backups = readdirSync(dir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort();
  for (const name of backups.slice(0, -keep)) rmSync(path.join(dir, name));
  return target;
}
