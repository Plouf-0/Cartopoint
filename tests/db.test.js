import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { backupDatabase, migrate, openDatabase } from '../server/db.mjs';
import { tempDir } from './helpers.js';

const TABLES = ['accounts', 'course_versions', 'courses', 'launches', 'links', 'media', 'participants', 'sessions'];

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const tables = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

/** Base en mémoire : le schéma s'y comporte pareil, et une écriture sur disque coûte cher à chaque test. */
function open(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

/** Une ligne dans chaque table : un enseignant, son cours, un lancement et un élève. */
function seed(db) {
  db.exec(`
    INSERT INTO accounts (id, email, role, created_at) VALUES ('a1', 'Prof@example.org', 'teacher', '2026-11-01');
    INSERT INTO sessions VALUES ('s1', 'a1', '2026-12-01');
    INSERT INTO links (token_hash, kind, account_id, expires_at, created_at) VALUES ('t1', 'reset', 'a1', '2026-12-01', '2026-11-01');
    INSERT INTO media VALUES ('h1', 'a1', 'jpg', 10);
    INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES ('c1', 'a1', 'Cours', '{}', '2026-11-01');
    INSERT INTO course_versions VALUES ('v1', 'c1', 1, '{}', '2026-11-01');
    INSERT INTO launches (id, course_id, version_id, code, opened_at) VALUES ('l1', 'c1', 'v1', 'ABC234', '2026-11-01');
    INSERT INTO participants (id, launch_id, token_hash, names, joined_at) VALUES ('p1', 'l1', 'j1', 'Alice', '2026-11-01');
  `);
}

/* --- Migrations --- */

test('une base neuve reçoit le schéma complet', async (t) => {
  const db = await open(t);
  assert.deepEqual(tables(db), TABLES);
  assert.equal(version(db), 1);
});

test('rejouer les migrations ne change rien : ni le schéma, ni les données', async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'app.db');
  const first = openDatabase(file);
  seed(first);
  migrate(first);
  assert.equal(version(first), 1);
  first.close();

  const second = openDatabase(file);
  t.after(() => second.close());
  assert.equal(version(second), 1);
  assert.equal(count(second, 'participants'), 1);
});

test('les réglages de la base sont en place, y compris à la réouverture', async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'app.db');
  openDatabase(file).close();
  const db = openDatabase(file);
  t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 1, 'NORMAL : une écriture ne doit pas bloquer le serveur');
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
});

async function migrationsDir(t, files) {
  const dir = await tempDir(t);
  for (const [name, sql] of Object.entries(files)) await writeFile(path.join(dir, name), sql);
  return dir;
}

const values = (db) =>
  db
    .prepare('SELECT x FROM a ORDER BY rowid')
    .all()
    .map((row) => row.x);

test('les migrations suivent l’ordre des numéros, pas celui des noms de fichiers', async (t) => {
  const files = { '1-a.sql': 'CREATE TABLE a (x);' };
  for (let i = 2; i <= 11; i++) files[`${i}-b.sql`] = `INSERT INTO a VALUES (${i});`;
  const db = openDatabase(':memory:', await migrationsDir(t, files));
  t.after(() => db.close());
  assert.equal(version(db), 11);
  assert.deepEqual(values(db), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('seules les migrations nouvelles sont jouées', async (t) => {
  const dir = await migrationsDir(t, { '1-a.sql': 'CREATE TABLE a (x);', '2-b.sql': 'INSERT INTO a VALUES (2);' });
  const db = openDatabase(':memory:', dir);
  t.after(() => db.close());
  await writeFile(path.join(dir, '3-c.sql'), 'INSERT INTO a VALUES (3);');
  migrate(db, dir);
  assert.equal(version(db), 3);
  assert.deepEqual(values(db), [2, 3]);
});

test('seuls les fichiers .sql numérotés sont des migrations', async (t) => {
  const dir = await migrationsDir(t, {
    '1-a.sql': 'CREATE TABLE a (x);',
    'README.txt': 'ceci casserait une migration',
    'brouillon.sql': 'ceci aussi',
    '2-notes.txt': 'et ceci'
  });
  const db = openDatabase(':memory:', dir);
  t.after(() => db.close());
  assert.equal(version(db), 1);
});

test('un trou dans la numérotation est refusé', async (t) => {
  const dir = await migrationsDir(t, { '1-a.sql': 'CREATE TABLE a (x);', '3-c.sql': 'CREATE TABLE c (x);' });
  assert.throws(() => openDatabase(':memory:', dir), /migration 3-c\.sql : le numéro 2 était attendu/);
});

test('une migration qui échoue est annulée en entier, et la version ne bouge pas', async (t) => {
  const dir = await migrationsDir(t, {
    '1-a.sql': 'CREATE TABLE a (x);',
    '2-casse.sql': 'CREATE TABLE b (x); INSERT INTO table_absente VALUES (1);'
  });
  const dbDir = await tempDir(t);
  const file = path.join(dbDir, 'app.db');
  assert.throws(() => openDatabase(file, dir), /migration 2-casse\.sql : .*table_absente/);

  await writeFile(path.join(dir, '2-casse.sql'), 'CREATE TABLE b (x);');
  const db = openDatabase(file, dir);
  t.after(() => db.close());
  assert.equal(version(db), 2);
  assert.deepEqual(tables(db), ['a', 'b']);
});

test('une base plus récente que le code est refusée, au lieu d’être abîmée', async (t) => {
  const dir = await migrationsDir(t, { '1-a.sql': 'CREATE TABLE a (x);' });
  const dbDir = await tempDir(t);
  const file = path.join(dbDir, 'app.db');
  const db = openDatabase(file, dir);
  db.exec('PRAGMA user_version = 5');
  db.close();
  assert.throws(() => openDatabase(file, dir), /version 5, plus récente que le code \(1\)/);
});

/* --- Contraintes du schéma --- */

test('ENS-01 : une adresse e-mail ne sert qu’à un compte, quelle que soit la casse', async (t) => {
  const db = await open(t);
  seed(db);
  assert.throws(() => db.exec("INSERT INTO accounts (id, email, role, created_at) VALUES ('a2', 'prof@EXAMPLE.org', 'teacher', '2026-11-01')"), /UNIQUE/);
});

test('un rôle ou un type de lien inconnu est refusé', async (t) => {
  const db = await open(t);
  assert.throws(() => db.exec("INSERT INTO accounts (id, email, role, created_at) VALUES ('a', 'x', 'eleve', 'd')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO links (token_hash, kind, expires_at, created_at) VALUES ('t', 'autre', 'd', 'd')"), /CHECK/);
});

test('ADM-02 : une invitation existe avant le compte qu’elle servira à créer', async (t) => {
  const db = await open(t);
  db.exec("INSERT INTO links (token_hash, kind, expires_at, created_at) VALUES ('t', 'invite', 'd', 'd')");
  assert.equal(count(db, 'links'), 1);
});

test('COU-06 : un code court ne sert qu’à un lancement', async (t) => {
  const db = await open(t);
  seed(db);
  assert.throws(() => db.exec("INSERT INTO launches (id, course_id, version_id, code, opened_at) VALUES ('l2', 'c1', 'v1', 'ABC234', 'd')"), /UNIQUE/);
});

test('COU-11 : un numéro de version ne sert qu’une fois par cours', async (t) => {
  const db = await open(t);
  seed(db);
  assert.throws(() => db.exec("INSERT INTO course_versions VALUES ('v2', 'c1', 1, '{}', 'd')"), /UNIQUE/);
});

test('COU-11 : une version utilisée par un lancement ne peut pas être supprimée seule', async (t) => {
  const db = await open(t);
  seed(db);
  assert.throws(() => db.exec("DELETE FROM course_versions WHERE id = 'v1'"), /FOREIGN KEY/);
});

test('une ligne qui désigne un enregistrement absent est refusée', async (t) => {
  const db = await open(t);
  assert.throws(() => db.exec("INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES ('c', 'absent', 't', '{}', 'd')"), /FOREIGN KEY/);
  assert.throws(() => db.exec("INSERT INTO sessions VALUES ('s', 'absent', 'd')"), /FOREIGN KEY/);
});

test('supprimer un cours emporte ses versions, ses lancements et leurs élèves, pas le compte', async (t) => {
  const db = await open(t);
  seed(db);
  db.exec("DELETE FROM courses WHERE id = 'c1'");
  for (const table of ['courses', 'course_versions', 'launches', 'participants']) assert.equal(count(db, table), 0, table);
  assert.equal(count(db, 'accounts'), 1);
  assert.equal(count(db, 'media'), 1);
});

test('HIS-05 : supprimer un lancement emporte ses élèves, pas le cours ni sa version', async (t) => {
  const db = await open(t);
  seed(db);
  db.exec("DELETE FROM launches WHERE id = 'l1'");
  assert.equal(count(db, 'participants'), 0);
  assert.equal(count(db, 'courses'), 1);
  assert.equal(count(db, 'course_versions'), 1);
});

test('supprimer un compte ne laisse rien derrière lui', async (t) => {
  const db = await open(t);
  seed(db);
  db.exec("DELETE FROM accounts WHERE id = 'a1'");
  for (const table of TABLES) assert.equal(count(db, table), 0, table);
});

/* --- Sauvegarde quotidienne --- */

const DAY = new Date('2026-02-01T12:00:00Z');

test('E-11 : la copie du jour contient les données, et se lit comme une base normale', async (t) => {
  const db = await open(t);
  seed(db);
  const dir = await tempDir(t);
  const file = backupDatabase(db, dir, { now: DAY });
  assert.equal(path.basename(file), 'app-2026-02-01.db');
  const copy = openDatabase(file);
  t.after(() => copy.close());
  assert.equal(count(copy, 'participants'), 1);
});

test('la sauvegarde crée son dossier, et ne se refait pas le même jour', async (t) => {
  const db = await open(t);
  const dir = path.join(await tempDir(t), 'a', 'backups');
  assert.ok(backupDatabase(db, dir, { now: DAY }));
  assert.equal(backupDatabase(db, dir, { now: DAY }), null);
  assert.ok(backupDatabase(db, dir, { now: new Date('2026-02-02T00:00:00Z') }));
  assert.equal((await readdir(dir)).length, 2);
});

test('une copie interrompue la veille ne bloque pas celle du jour', async (t) => {
  const db = await open(t);
  const dir = await tempDir(t);
  await writeFile(path.join(dir, 'app-2026-02-01.db.tmp'), 'copie tronquée');
  const file = backupDatabase(db, dir, { now: DAY });
  assert.deepEqual(await readdir(dir), ['app-2026-02-01.db']);
  const copy = openDatabase(file);
  copy.close();
});

test('E-11 : 14 copies sont gardées, les plus récentes, et rien d’autre n’est touché', async (t) => {
  const db = await open(t);
  const dir = await tempDir(t);
  for (let day = 1; day <= 20; day++) await writeFile(path.join(dir, `app-2026-01-${String(day).padStart(2, '0')}.db`), 'x');
  const neighbours = ['app-2-2026-01-01.db', 'app-copie.db', 'app-2026-01-01T10-00-00-000Z.json', 'project-2026-01-01T10-00-00-000Z.json', 'autre.txt'];
  for (const name of neighbours) await writeFile(path.join(dir, name), 'x');

  backupDatabase(db, dir, { now: DAY });

  const left = await readdir(dir);
  const copies = left.filter((name) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort();
  assert.equal(copies.length, 14);
  assert.equal(copies[0], 'app-2026-01-08.db');
  assert.equal(copies.at(-1), 'app-2026-02-01.db');
  for (const name of neighbours) assert.ok(left.includes(name), name);
});

test('le réglage du nombre de copies est respecté', async (t) => {
  const db = await open(t);
  const dir = await tempDir(t);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'app-2026-01-01.db'), 'x');
  backupDatabase(db, dir, { now: DAY, keep: 1 });
  assert.equal(existsSync(path.join(dir, 'app-2026-01-01.db')), false);
  assert.equal(existsSync(path.join(dir, 'app-2026-02-01.db')), true);
});
