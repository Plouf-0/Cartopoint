#!/usr/bin/env node
/**
 * En cas de perte du mot de passe de l'admin : affiche un lien à usage unique pour en choisir un autre.
 * Aucun mot de passe ne passe par le terminal ni par l'historique du shell.
 *
 *   node server/admin-reset.mjs [--data data]
 *   docker compose exec cartopoint-prod node server/admin-reset.mjs
 */
import path from 'node:path';
import { createAuth } from './auth.mjs';
import { openDatabase } from './db.mjs';

const at = process.argv.indexOf('--data');
const data = path.resolve(process.env.DATA_DIR || (at > 0 ? process.argv[at + 1] : 'data'));

const db = openDatabase(path.join(data, 'app.db'));
const admin = db.prepare("SELECT id FROM accounts WHERE role = 'admin'").get();
if (!admin) {
  console.error('Aucun compte admin : définissez ADMIN_EMAIL et ADMIN_PASSWORD, puis redémarrez le serveur.');
  db.close();
  process.exit(1);
}
const { link } = createAuth(db).createReset(admin.id);
db.close();
console.log(`À ouvrir après l'adresse du site, dans les 72 heures :\n${link}`);
