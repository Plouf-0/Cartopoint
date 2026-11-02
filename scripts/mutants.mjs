#!/usr/bin/env node
/**
 * Vérifie que les tests attrapent les bugs : casse le code exprès, une modification à la fois, sur
 * une copie du projet, et contrôle qu'au moins un test échoue (QUA-08).
 *
 *   npm run test:mutants            toutes les modifications (plusieurs minutes)
 *   npm run test:mutants -- E-04    seulement celles dont le nom contient « E-04 »
 *
 * Il vérifie d'abord que les tests passent sur le code intact. Une modification que les tests ne
 * remarquent pas « survit » : il manque alors un test. Le script échoue aussi si un texte à remplacer a disparu du code, pour que cette liste reste à jour, ou si
 * les tests se bloquent au lieu d'échouer. Ajouter ici chaque comportement sensible.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RUN_TIMEOUT = 180000;

// [nom, fichier, texte à remplacer, remplacement, 'partout' pour toutes les occurrences]
const MUTANTS = [
  ['E-04 : première valeur de X-Forwarded-For au lieu de la dernière', 'server/security.mjs', ".split(',').pop().trim()", ".split(',').shift().trim()"],
  ['E-04 : X-Forwarded-For lu même sans TRUST_PROXY', 'server/security.mjs', 'if (trustProxy) {', 'if (true) {'],
  ['E-04 : TRUST_PROXY ignoré par la publication', 'server/routes/legacy.mjs', 'clientIp(req, trustProxy)', 'clientIp(req, false)'],
  ['E-04 : variable TRUST_PROXY toujours active', 'server/index.mjs', "process.env.TRUST_PROXY === '1'", 'true'],
  ['limite : bloque un essai trop tôt', 'server/security.mjs', 'entry.count >= max', 'entry.count >= max - 1'],
  ['limite : le délai n’expire jamais', 'server/security.mjs', 'entry.until > now()', 'true'],
  ['E-05 : jamais de 304', 'server/http.mjs', 'if (!header) return false;', 'return false;'],
  ['E-05 : If-None-Match compare en strict', 'server/http.mjs', ".replace(/^W\\//, '')", ''],
  ['E-05 : gzip;q=0 accepté', 'server/http.mjs', 'return !q || Number(q.slice(2)) > 0;', 'return true;'],
  ['E-05 : ETag indépendant de la date', 'server/http.mjs', '-${Math.trunc(stat.mtimeMs).toString(16)}', ''],
  ['E-05 : images compressées', 'server/http.mjs', 'COMPRESSIBLE.test(type) && stat.size >= MIN_GZIP', 'stat.size >= MIN_GZIP'],
  ['E-05 : petits fichiers compressés', 'server/http.mjs', 'COMPRESSIBLE.test(type) && stat.size >= MIN_GZIP', 'COMPRESSIBLE.test(type)'],
  ['JSON : ETag aussi sur les écritures', 'server/http.mjs', "if (status === 200 && (req.method === 'GET' || req.method === 'HEAD')) {", 'if (true) {'],
  [
    'E-11 : sauvegardes de projet triées sur le début du nom',
    'server/routes/legacy.mjs',
    'filter((f) => own.test(f))',
    "filter((f) => f.startsWith(base + '-'))"
  ],
  [
    'E-11 : copies de la base triées sur le début du nom',
    'server/db.mjs',
    'filter((name) => BACKUP_NAME.test(name))',
    "filter((name) => name.startsWith('app-'))"
  ],
  ['base : écritures lentes (synchronous par défaut)', 'server/db.mjs', 'PRAGMA synchronous = NORMAL;', ''],
  ['copies de la base : garde les plus anciennes', 'server/db.mjs', 'backups.slice(0, -keep)', 'backups.slice(keep)'],
  ['copies de la base : refaites plusieurs fois par jour', 'server/db.mjs', 'if (existsSync(target)) return null;', ''],
  ['copies de la base : copie tronquée non retirée', 'server/db.mjs', 'rmSync(tmp, { force: true });', ''],
  ['base : clés étrangères désactivées', 'server/db.mjs', 'PRAGMA foreign_keys = ON', 'PRAGMA foreign_keys = OFF'],
  ['base : pas de mode WAL', 'server/db.mjs', 'PRAGMA journal_mode = WAL;', ''],
  ['migrations : pas d’annulation en cas d’échec', 'server/db.mjs', "db.exec('ROLLBACK');", "db.exec('COMMIT');"],
  ['migrations : tri alphabétique', 'server/db.mjs', '.sort((a, b) => parseInt(a) - parseInt(b))', '.sort()'],
  ['migrations : base plus récente acceptée', 'server/db.mjs', 'if (current > files.length) throw', 'if (false) throw'],
  ['migrations : tout est rejoué', 'server/db.mjs', 'files.slice(current).forEach', 'files.forEach'],
  ['schéma : e-mail sensible à la casse', 'server/migrations/001-initial.sql', 'UNIQUE COLLATE NOCASE', 'UNIQUE'],
  ['schéma : code court sans unicité', 'server/migrations/001-initial.sql', 'code TEXT NOT NULL UNIQUE', 'code TEXT NOT NULL'],
  [
    'schéma : élèves conservés après suppression du lancement',
    'server/migrations/001-initial.sql',
    'launch_id TEXT NOT NULL REFERENCES launches ON DELETE CASCADE',
    'launch_id TEXT NOT NULL REFERENCES launches ON DELETE SET NULL'
  ],
  ['publication : sans vérification du mot de passe', 'server/routes/legacy.mjs', 'if (!authorized(req)) {', 'if (false) {'],
  ['publication : échecs non comptés', 'server/routes/legacy.mjs', 'failures.fail(ip);', ''],
  ['publication : écriture non atomique', 'server/routes/legacy.mjs', "const tmp = file + '.tmp';", 'const tmp = file;'],
  ['publication : pas de sauvegarde', 'server/routes/legacy.mjs', 'await backup(file);', ''],
  [
    'publication : format non vérifié',
    'server/routes/legacy.mjs',
    "if (p.format !== 'inventaire-botanique' || !Array.isArray(p.maps)) throw new Error('format de projet non reconnu');",
    ''
  ],
  [
    'chemins : contrôle de sortie du dossier retiré',
    'server/http.mjs',
    "const p = path.resolve(base, '.' + path.posix.normalize('/' + decoded));\n  return p === base || p.startsWith(base + path.sep) ? p : null;",
    "return path.resolve(base, '.' + decoded);"
  ],
  [
    'corps : coupe la connexion au lieu de finir de lire',
    'server/http.mjs',
    "reject(new HttpError(413, 'trop volumineux'));",
    "reject(new HttpError(413, 'trop volumineux')); req.destroy();"
  ],
  ['erreurs : détail interne envoyé au client', 'server/http.mjs', "return send(res, 500, 'Erreur du serveur');", 'return send(res, 500, e.message);'],
  ['erreurs : 500 si l’adresse est mal encodée', 'server/http.mjs', "if (!file) return send(res, 400, 'Chemin invalide');", "if (!file) throw new Error('x');"],
  ['arrêt : base non fermée', 'server/app.mjs', 'db.close();', ''],
  ['arrêt : SIGTERM ignoré', 'server/index.mjs', "['SIGTERM', 'SIGINT']", "['SIGINT']"],
  ['démarrage : pas de sauvegarde quotidienne', 'server/index.mjs', '  periodicTasks();\n', ''],
  ['ENS-01 : mot de passe jamais comparé', 'server/auth.mjs', 'return timingSafeEqual(actual, expected);', 'return true;'],
  ['ENS-01 : sel constant', 'server/auth.mjs', 'const salt = randomBytes(16);', 'const salt = Buffer.alloc(16);'],
  ['ENS-01 : mot de passe minimal raccourci', 'server/auth.mjs', 'password.length < 8', 'password.length < 4'],
  ['ENS-01 : jeton stocké en clair', 'server/auth.mjs', "createHash('sha256').update(String(token)).digest('hex')", 'String(token)'],
  ['SRV-10 : scripts et styles gardés une heure', 'server/http.mjs', "new Set(['.html', '.js', '.css'])", "new Set(['.html'])"],
  ['SRV-10 : photos jamais gardées', 'server/http.mjs', "'public, max-age=3600'", "'no-cache'"],
  ['ADM-06 : compte désactivé accepté à la connexion', 'server/routes/auth.mjs', 'if (account.disabled_at) throw new HttpError(403, DISABLED);', ''],
  [
    'ADM-06 : un inconnu apprend qu’un compte est désactivé',
    'server/auth.mjs',
    'return valid && account ? account : null;',
    'return (valid || account?.disabled_at) && account ? account : null;'
  ],
  [
    'ADM-06 : message trompeur pour un compte désactivé',
    'server/routes/auth.mjs',
    'if (account.disabled_at) throw new HttpError(403, DISABLED);',
    'if (account.disabled_at) throw new HttpError(401, BAD_LOGIN);'
  ],
  [
    'ADM-10 : suppression sans effet',
    'server/auth.mjs',
    "db.prepare('UPDATE accounts SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(iso(), id);",
    ''
  ],
  [
    'ADM-10 : effacement immédiat, sans délai',
    'server/auth.mjs',
    "db.prepare('UPDATE accounts SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(iso(), id);",
    "db.prepare('DELETE FROM accounts WHERE id = ?').run(id);"
  ],
  ['ADM-10 : une nouvelle suppression repousse l’effacement', 'server/auth.mjs', 'deleted_at = COALESCE(deleted_at, ?)', 'deleted_at = ?'],
  ['ADM-10 : restauration sans effet', 'server/auth.mjs', "db.prepare('UPDATE accounts SET deleted_at = NULL WHERE id = ?').run(id);", ''],
  [
    'ADM-10 : restauration qui réactive le compte',
    'server/auth.mjs',
    'SET deleted_at = NULL WHERE id = ?',
    'SET deleted_at = NULL, disabled_at = NULL WHERE id = ?'
  ],
  ['ADM-10 : jamais effacé', 'server/auth.mjs', "db.prepare('DELETE FROM accounts WHERE deleted_at <= ?').run(iso(Date.now() - DELETED_LIFETIME));", ''],
  ['ADM-10 : effacé dès le nettoyage suivant', 'server/auth.mjs', 'iso(Date.now() - DELETED_LIFETIME)', 'iso()'],
  [
    'ADM-10 : le nettoyage efface tous les comptes',
    'server/auth.mjs',
    'DELETE FROM accounts WHERE deleted_at <= ?',
    'DELETE FROM accounts WHERE ? IS NOT NULL'
  ],
  ['ADM-10 : délai de 14 jours changé', 'server/auth.mjs', 'const DELETED_LIFETIME = 14 * DAY;', 'const DELETED_LIFETIME = 13 * DAY;'],
  [
    'ADM-10 : compte supprimé réactivable sans restauration',
    'server/routes/admin.mjs',
    'if (teacher(params.id).deleted_at) throw new HttpError(409, "Ce compte est supprimé : restaurez-le d\'abord.");',
    ''
  ],
  [
    'ADM-10 : restauration ouverte aux enseignants',
    'server/routes/admin.mjs',
    "'/api/admin/teachers/:id/restore',\n      adminWrite(",
    "'/api/admin/teachers/:id/restore',\n      sameOriginOnly("
  ],
  [
    'ADM-10 : restauration sans contrôle d’origine',
    'server/routes/admin.mjs',
    "'/api/admin/teachers/:id/restore',\n      adminWrite(",
    "'/api/admin/teachers/:id/restore',\n      adminOnly("
  ],
  [
    'ADM-10 : compte actif supprimable',
    'server/routes/admin.mjs',
    "if (!account.disabled_at) throw new HttpError(409, 'Désactivez ce compte avant de le supprimer.');",
    ''
  ],
  ['ADM-10 : mot non vérifié par le serveur', 'server/routes/admin.mjs', 'if (word !== DELETE_WORD) throw', 'if (false) throw'],
  [
    'ADM-10 : route ouverte aux enseignants',
    'server/routes/admin.mjs',
    'adminWrite(async (req, res, { params }) => {',
    'sameOriginOnly(async (req, res, { params }) => {'
  ],
  ['ADM-10 : origine non vérifiée', 'server/routes/admin.mjs', 'adminWrite(async (req, res, { params }) => {', 'adminOnly(async (req, res, { params }) => {'],
  [
    'ADM-10 : l’admin peut se supprimer',
    'server/routes/admin.mjs',
    'const account = teacher(params.id);\n        if (!account.disabled_at)',
    'const account = { ...params, disabled_at: 1 };\n        if (!account.disabled_at)'
  ],
  [
    'ADM-10 : cours conservés après la suppression',
    'server/migrations/001-initial.sql',
    'CREATE TABLE courses (\n  id TEXT PRIMARY KEY,\n  account_id TEXT NOT NULL REFERENCES accounts ON DELETE CASCADE',
    'CREATE TABLE courses (\n  id TEXT PRIMARY KEY,\n  account_id TEXT NOT NULL REFERENCES accounts ON DELETE SET NULL'
  ],
  [
    'ENS-01 : adresse inconnue distinguée',
    'server/routes/auth.mjs',
    'if (!account) throw new HttpError(401, BAD_LOGIN);',
    "if (!account) throw new HttpError(401, 'Mot de passe incorrect.');"
  ],
  ['ENS-04 : rôle non vérifié', 'server/auth.mjs', "if (account.role !== role) throw new HttpError(403, 'Accès refusé.');", ''],
  ['ENS-04 : routes d’admin ouvertes', 'server/routes/admin.mjs', "auth.requireRole(req, 'admin');", ''],
  ['session : expiration ignorée', 'server/auth.mjs', 'sessions.expires_at > ?', '? IS NOT NULL'],
  ['session : déconnexion sans effet en base', 'server/auth.mjs', "db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash(req));", ''],
  ['cookie : lisible par le JavaScript', 'server/auth.mjs', ' HttpOnly;', ''],
  ['cookie : envoyé depuis les autres sites', 'server/auth.mjs', 'SameSite=Lax', 'SameSite=None'],
  ['cookie : pas de Secure en HTTPS', 'server/auth.mjs', "isHttps(req, trustProxy) ? '; Secure' : ''", "''"],
  ['cookie : Secure sur la foi d’un en-tête non fiable', 'server/security.mjs', 'return trustProxy && lastValue', 'return lastValue'],
  ['origine : jamais vérifiée', 'server/security.mjs', "if (!isSameOrigin(req)) throw new HttpError(403, 'Origine de la requête refusée.');", ''],
  ['origine : sous-domaines acceptés', 'server/security.mjs', '.host === req.headers.host', '.host.endsWith(req.headers.host)'],
  [
    'ADM-01 : admin remplacé à chaque démarrage',
    'server/auth.mjs',
    "if (db.prepare(\"SELECT 1 FROM accounts WHERE role = 'admin'\").get()) return 'exists';",
    ''
  ],
  [
    'ADM-01 : adresse d’un enseignant reprise par l’admin',
    'server/auth.mjs',
    "if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(address)) return 'invalid';",
    ''
  ],
  [
    'ADM-01 : identifiants écrits au démarrage',
    'server/index.mjs',
    'console.log(`  admin       : ${ADMIN_STATES[adminState]}`);',
    'console.log(`  admin       : ${ADMIN_STATES[adminState]} ${process.env.ADMIN_EMAIL}`);'
  ],
  ['ADM-03 : lien réutilisable', 'server/auth.mjs', 'used_at IS NULL AND ', '', 'partout'],
  [
    'ADM-03 : réutilisation possible en même temps',
    'server/auth.mjs',
    'WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING',
    'WHERE token_hash = ? AND kind = ? AND expires_at > ? RETURNING'
  ],
  ['ADM-03 : lien expiré accepté', 'server/auth.mjs', 'expires_at > ?', '? IS NOT NULL', 'partout'],
  ['ADM-03 : type de lien ignoré', 'server/auth.mjs', 'kind = ?', '? IS NOT NULL', 'partout'],
  [
    'ADM-03 : adresse déjà prise non refusée',
    'server/auth.mjs',
    "if (accountByEmail(address)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse.');",
    'if (accountByEmail(address)) return accountByEmail(address);'
  ],
  ['ADM-03 : invitation qui crée un admin', 'server/auth.mjs', "insertAccount(db, address, hash, 'teacher')", "insertAccount(db, address, hash, 'admin')"],
  ['ADM-03 : lien mort découvert après la saisie', 'server/auth.mjs', "requireLiveLink(token, 'invite');", ''],
  ['ADM-05 : anciennes sessions conservées', 'server/auth.mjs', "db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id);", ''],
  [
    'ADM-05 : ancien lien encore valable',
    'server/auth.mjs',
    'db.prepare("DELETE FROM links WHERE account_id = ? AND kind = \'reset\' AND used_at IS NULL").run(accountId);',
    ''
  ],
  ['ADM-05 : compte désactivé rouvert par un lien', 'server/auth.mjs', 'if (account.disabled_at) throw new HttpError(410, DEAD_LINK);', ''],
  [
    'ADM-05 : lien créé pour un compte désactivé',
    'server/routes/admin.mjs',
    'if (account.disabled_at) throw new HttpError(409, "Ce compte est désactivé : réactivez-le d\'abord.");',
    ''
  ],
  [
    'ADM-05 : l’admin peut se viser lui-même',
    'server/auth.mjs',
    "SELECT * FROM accounts WHERE id = ? AND role = 'teacher'",
    'SELECT * FROM accounts WHERE id = ?'
  ],
  ['ADM-06 : sessions conservées à la désactivation', 'server/auth.mjs', "db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);", ''],
  ['ADM-06 : session d’un compte désactivé acceptée', 'server/auth.mjs', ' AND accounts.disabled_at IS NULL', ''],
  ['ADM-06 : date de désactivation écrasée', 'server/auth.mjs', 'disabled_at = COALESCE(disabled_at, ?)', 'disabled_at = ?'],
  ['ADM-07 : empreinte du mot de passe dans la liste', 'server/routes/admin.mjs', 'id: account.id,', '...account,'],
  [
    'mot de passe : autres sessions conservées',
    'server/auth.mjs',
    "db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?').run(account.id, sessionHash(req));",
    ''
  ],
  [
    'mot de passe : changement sans le mot de passe actuel',
    'server/routes/auth.mjs',
    "if (!valid) throw new HttpError(403, 'Mot de passe actuel incorrect.');",
    ''
  ],
  ['limite : couple non vérifié', 'server/routes/auth.mjs', 'perPair.blocked(pair) || ', ''],
  ['limite : adresse non vérifiée', 'server/routes/auth.mjs', ' || perIp.blocked(ip)', ''],
  ['limite : échecs du couple non comptés', 'server/routes/auth.mjs', 'perPair.fail(pair);', ''],
  ['limite : échecs de l’adresse non comptés', 'server/routes/auth.mjs', 'perIp.fail(ip);', ''],
  ['limite : la réussite ne remet pas à zéro', 'server/routes/auth.mjs', 'perPair.clear(pair);', ''],
  ['limite : réussites comptées comme des échecs', 'server/routes/auth.mjs', 'perIp.forgive(ip);', ''],
  ['limite : la casse de l’adresse contourne le blocage', 'server/routes/auth.mjs', '${email.toLowerCase()}', '${email}'],
  ['nettoyage : sessions expirées conservées', 'server/auth.mjs', "db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso());", ''],
  ['nettoyage : liens périmés conservés', 'server/auth.mjs', "db.prepare('DELETE FROM links WHERE expires_at <= ? OR used_at IS NOT NULL').run(iso());", ''],
  ['écran : jeton laissé dans la barre d’adresse', 'src/js/compte/main.js', "history.replaceState(null, '', location.pathname);", ''],
  ['écran : adresse injectée comme du HTML', 'src/js/admin/main.js', "cell('Adresse e-mail', teacher.email)", "el('td', { innerHTML: teacher.email })"],
  [
    'écran : mots de passe différents acceptés',
    'src/js/compte/ui.js',
    "if (data.get('password') !== data.get('confirm')) throw new Error('Les deux mots de passe sont différents.');",
    ''
  ],
  ['écran : désactivation sans confirmation', 'src/js/admin/main.js', '!teacher.disabled && !confirm(', 'false && !confirm('],
  ['écran : réinitialisation proposée pour un compte désactivé', 'src/js/admin/main.js', 'hidden: teacher.disabled', 'hidden: false'],
  [
    'écran : tableau trop large sur un téléphone',
    'src/css/app.css',
    '@media (max-width: 1000px) {\n  table.teachers',
    '@media (max-width: 1px) {\n  table.teachers'
  ],
  [
    'écran : cellule d’actions qui casse le tableau',
    'src/js/admin/main.js',
    "el('td', {}, el('div', { className: 'row-actions' }, reset, toggle, remove))",
    "el('td', { className: 'row-actions' }, reset, toggle, remove)"
  ],
  [
    'écran : compte supprimé laissé dans le tableau principal',
    'src/js/admin/main.js',
    'const current = teachers.filter((teacher) => !teacher.deletedAt);',
    'const current = teachers;'
  ],
  ['écran : tableau des comptes supprimés jamais montré', 'src/js/admin/main.js', 'deletedAccounts.hidden = !deleted.length;', ''],
  [
    'écran : tableau des comptes supprimés toujours montré',
    'src/js/admin/main.js',
    'deletedAccounts.hidden = !deleted.length;',
    'deletedAccounts.hidden = false;'
  ],
  ['écran : Restaurer n’appelle pas le serveur', 'src/js/admin/main.js', "await api('POST', `/admin/teachers/${teacher.id}/restore`, {});", ''],
  [
    'écran : liste non mise à jour après la restauration',
    'src/js/admin/main.js',
    '      notice.hidden = true;\n      await refresh();',
    '      notice.hidden = true;'
  ],
  ['écran : message de suppression resté après la restauration', 'src/js/admin/main.js', '      notice.hidden = true;\n', ''],
  [
    'écran : adresse injectée dans le tableau des comptes supprimés',
    'src/js/admin/main.js',
    "cell('Adresse e-mail', teacher.email),\n    cell('Supprimé le',",
    "el('td', { innerHTML: teacher.email }),\n    cell('Supprimé le',"
  ],
  ['écran : compte supprimé pas en rouge', 'src/css/app.css', '.deleted-accounts td { color: var(--far); }', ''],
  ['écran : suppression proposée pour un compte actif', 'src/js/admin/main.js', 'hidden: !teacher.disabled', 'hidden: false'],
  ['écran : bouton de suppression actif à l’ouverture', 'src/js/admin/main.js', "type: 'submit', disabled: true", "type: 'submit', disabled: false"],
  [
    'écran : suppression sans recopier le mot',
    'src/js/admin/main.js',
    'confirmButton.disabled = typedWord() !== DELETE_WORD;',
    'confirmButton.disabled = false;'
  ],
  ['écran : minuscules refusées', 'src/js/admin/main.js', 'input.value.trim().toUpperCase()', 'input.value.trim()'],
  ['écran : espaces refusés', 'src/js/admin/main.js', 'input.value.trim().toUpperCase()', 'input.value.toUpperCase()'],
  ['écran : mot non transmis au serveur', 'src/js/admin/main.js', '{ word: typedWord() }', '{}'],
  ['écran : Annuler sans effet', 'src/js/admin/main.js', "cancel.addEventListener('click', () => dialog.close());", ''],
  ['écran : fenêtre laissée dans la page', 'src/js/admin/main.js', "dialog.addEventListener('close', () => dialog.remove());", ''],
  [
    'écran : fenêtre ouverte après la suppression',
    'src/js/admin/main.js',
    '      dialog.close();\n      await onDeleted(deleted);',
    '      await onDeleted(deleted);'
  ],
  ['écran : bouton resté bloqué après une erreur', 'src/js/admin/main.js', '        confirmButton.disabled = false;\n', ''],
  [
    'écran : erreur fermant la fenêtre',
    'src/js/admin/main.js',
    '      } finally {\n        confirmButton.disabled = false;\n      }\n      dialog.close();',
    '      } finally {\n        confirmButton.disabled = false;\n        dialog.close();\n      }'
  ],
  [
    'écran : tableau non mis à jour après la suppression',
    'src/js/admin/main.js',
    '      notice.hidden = false;\n      await refresh();',
    '      notice.hidden = false;'
  ],
  ['écran : suppression sans message de confirmation', 'src/js/admin/main.js', '      notice.hidden = false;\n', ''],
  ['écran : lien périmé laissé affiché', 'src/js/admin/main.js', 'links.replaceChildren();', ''],
  ['écran : adresse injectée dans la fenêtre', 'src/js/admin/main.js', "el('strong', {}, teacher.email)", "el('strong', { innerHTML: teacher.email })"],
  ['écran : fenêtre hors de la page de compte', 'src/js/admin/main.js', "document.querySelector('#app').append(dialog);", 'document.body.append(dialog);'],
  [
    'écran : adresse longue hors de la fenêtre',
    'src/css/app.css',
    '.account-card p, .confirm-dialog p, .account-bar span {',
    '.account-card p, .account-bar span {'
  ],
  [
    'écran : adresse longue hors des messages',
    'src/css/app.css',
    '.account-card p, .confirm-dialog p, .account-bar span {',
    '.confirm-dialog p, .account-bar span {'
  ],
  [
    'écran : adresse longue hors de la barre du compte',
    'src/css/app.css',
    '.account-card p, .confirm-dialog p, .account-bar span {',
    '.account-card p, .confirm-dialog p {'
  ],
  ['écran : session expirée non détectée', 'src/js/admin/main.js', 'if (e.status === 401) showLogin();', 'if (false) showLogin();'],
  ['SRV-10 : vidéo sans plages d’octets', 'server/http.mjs', 'if (range) {', 'if (false) {'],
  ['SRV-10 : plage impossible servie', 'server/http.mjs', 'return start <= end ? { start, end } : false;', 'return { start, end };'],
  ['SRV-10 : fin de plage non bornée', 'server/http.mjs', 'Math.min(Number(match[2]), size - 1)', 'Number(match[2])'],
  ['SRV-10 : suffixe plus long que le fichier', 'server/http.mjs', 'Math.max(0, size - Number(match[2]))', 'size - Number(match[2])'],
  ['SRV-10 : plages sur un texte compressé', 'server/http.mjs', 'if (!compressible) {\n    headers', 'if (true) {\n    headers'],
  [
    'ENS-03 : cours d’un autre compte accessible',
    'server/courses.mjs',
    "'SELECT * FROM courses WHERE id = ? AND account_id = ?').get(id, accountId)",
    "'SELECT * FROM courses WHERE id = ?').get(id)"
  ],
  ['ENS-03 : liste de tous les cours', 'server/courses.mjs', 'WHERE account_id = ? ORDER BY updated_at DESC', 'WHERE ? IS NOT NULL ORDER BY updated_at DESC'],
  ['E-10 : révision non vérifiée à l’enregistrement', 'server/courses.mjs', 'WHERE id = ? AND revision = ?', 'WHERE id = ? AND ? IS NOT NULL'],
  ['E-10 : révision non entière acceptée', 'server/courses.mjs', 'if (!Number.isInteger(revision)) throw new HttpError(409, CHANGED_ELSEWHERE);', ''],
  ['E-10 : révision qui n’avance pas', 'server/courses.mjs', 'revision = revision + 1, ', ''],
  ['COU-02 : publication sans contrôle de révision', 'server/courses.mjs', 'if (row.revision !== revision) throw new HttpError(409, CHANGED_ELSEWHERE);', ''],
  ['COU-02 : nouvelle version à chaque publication', 'server/courses.mjs', 'if (last?.content !== row.draft) {', 'if (true) {'],
  ['COU-11 : numéro de version toujours le même', 'server/courses.mjs', '(last?.number ?? 0) + 1', '1'],
  ['COU-11 : dernière version mal choisie', 'server/courses.mjs', 'ORDER BY number DESC LIMIT 1', 'ORDER BY number ASC LIMIT 1'],
  ['COU-02 : état « à jour » toujours annoncé', 'server/courses.mjs', 'modified: version?.content !== row.draft', 'modified: false'],
  ['cours : contenu d’un autre format accepté', 'server/courses.mjs', 'draft.format !== FORMAT || ', ''],
  ['cours : contenu sans carte accepté', 'server/courses.mjs', ' || !draft.maps.length', ''],
  ['cours : nom sans limite', 'server/courses.mjs', '.slice(0, 200)', ''],
  ['cours : nom vide accepté', 'server/courses.mjs', " || 'Cours sans nom'", ''],
  ['ADM-04 : place occupée sans les fichiers', 'server/courses.mjs', "scalar('SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE account_id = ?') +", '0 +'],
  [
    'ADM-04 : place occupée sans les versions',
    'server/courses.mjs',
    "'SELECT COALESCE(SUM(LENGTH(content)), 0) AS n FROM course_versions JOIN courses ON courses.id = course_versions.course_id WHERE courses.account_id = ?'",
    "'SELECT ? * 0 AS n'"
  ],
  [
    'ADM-04 : lancements de tout le site',
    'server/courses.mjs',
    'FROM launches JOIN courses ON courses.id = launches.course_id WHERE courses.account_id = ?',
    'FROM launches WHERE ? IS NOT NULL'
  ],
  ['ADM-04 : chiffres absents', 'server/routes/admin.mjs', '...courses.stats(account.id)', ''],
  ['ADM-08 : l’admin voit une liste de cours', 'server/routes/courses.mjs', 'courses.list(teacher(req).id)', 'courses.list(auth.requireAccount(req).id)'],
  [
    'ADM-08 : l’admin crée un cours',
    'server/routes/courses.mjs',
    'const account = teacher(req);\n        const { draft }',
    'const account = auth.requireAccount(req);\n        const { draft }'
  ],
  [
    'ADM-08 : l’admin envoie un fichier',
    'server/routes/courses.mjs',
    'const account = teacher(req);\n        const body',
    'const account = auth.requireAccount(req);\n        const body'
  ],
  ['cours : origine non vérifiée à la création', 'server/routes/courses.mjs', "'/api/courses',\n      sameOriginOnly(", "'/api/courses',\n      ("],
  [
    'cours : origine non vérifiée à l’enregistrement',
    'server/routes/courses.mjs',
    "'PUT',\n      '/api/courses/:id',\n      sameOriginOnly(",
    "'PUT',\n      '/api/courses/:id',\n      ("
  ],
  [
    'cours : origine non vérifiée à la suppression',
    'server/routes/courses.mjs',
    "'DELETE',\n      '/api/courses/:id',\n      sameOriginOnly(",
    "'DELETE',\n      '/api/courses/:id',\n      ("
  ],
  [
    'cours : origine non vérifiée à la publication',
    'server/routes/courses.mjs',
    "'/api/courses/:id/publish',\n      sameOriginOnly(",
    "'/api/courses/:id/publish',\n      ("
  ],
  ['fichiers : origine non vérifiée', 'server/routes/courses.mjs', "'/api/media',\n      sameOriginOnly(", "'/api/media',\n      ("],
  ['cours : contenu sans limite de taille', 'server/routes/courses.mjs', 'const MAX_DRAFT = 8 * 1024 * 1024;', 'const MAX_DRAFT = 800 * 1024 * 1024;'],
  ['fichiers : envoi sans limite de taille', 'server/routes/courses.mjs', 'readBody(req, maxBody)', 'readBody(req, 1e9)'],
  ['fichiers : nom non vérifié à la lecture', 'server/routes/courses.mjs', "if (!MEDIA_NAME.test(params.file)) return send(res, 404, 'Introuvable');", ''],
  ['fichiers : pas de cache durable', 'server/routes/courses.mjs', "const FOREVER = 'public, max-age=31536000, immutable';", "const FOREVER = 'no-cache';"],
  ['fichiers : type non vérifié', 'server/media.mjs', 'if (!ext) throw new HttpError(415, REFUSED);', ''],
  ['fichiers : HEIC accepté comme une vidéo', 'server/media.mjs', "IMAGE_BRANDS.test(ascii(buffer, 8, 12)) ? null : 'mp4'", "'mp4'"],
  ['fichiers : WebP non contrôlé en entier', 'server/media.mjs', " && ascii(buffer, 8, 12) === 'WEBP'", ''],
  ['fichiers : renvoyer ne protège pas du nettoyage', 'server/media.mjs', 'DO UPDATE SET created_at = excluded.created_at', 'DO NOTHING'],
  ['nettoyage : fichier cité effacé', 'server/media.mjs', 'if (!used.has(hash)) db.prepare', 'db.prepare'],
  [
    'nettoyage : versions publiées ignorées',
    'server/media.mjs',
    'SELECT content FROM course_versions JOIN courses ON courses.id = course_versions.course_id WHERE courses.account_id = ?',
    'SELECT draft FROM courses WHERE account_id = ? AND 0'
  ],
  [
    'nettoyage : fichier retiré sans délai',
    'server/media.mjs',
    'const limit = new Date(now - DAY).toISOString();',
    'const limit = new Date(now + DAY).toISOString();'
  ],
  ['nettoyage : ligne jamais retirée', 'server/media.mjs', "db.prepare('DELETE FROM media WHERE hash = ? AND account_id = ?').run(hash, accountId);", ';'],
  [
    'nettoyage : retire la ligne de tout le monde',
    'server/media.mjs',
    "db.prepare('DELETE FROM media WHERE hash = ? AND account_id = ?').run(hash, accountId);",
    "db.prepare('DELETE FROM media WHERE hash = ? AND ? IS NOT NULL').run(hash, accountId);"
  ],
  [
    'nettoyage : les cours d’un autre compte protègent',
    'server/media.mjs',
    'SELECT draft AS text FROM courses WHERE account_id = ?',
    'SELECT draft AS text FROM courses WHERE ? IS NOT NULL'
  ],
  ['nettoyage : fichier partagé effacé', 'server/media.mjs', 'match ? !known.has(match[1]) :', 'match ? true :'],
  ['nettoyage : fichier sans ligne conservé', 'server/media.mjs', 'match ? !known.has(match[1]) :', 'match ? false :'],
  ['nettoyage : envoi interrompu jamais effacé', 'server/media.mjs', ': statSync(file).mtimeMs <= now - DAY', ': false'],
  ['nettoyage : envoi en cours effacé', 'server/media.mjs', ': statSync(file).mtimeMs <= now - DAY', ': true'],
  ['nettoyage : fichiers oubliés au démarrage', 'server/app.mjs', 'media.purge();', ''],
  [
    'page d’un cours introuvable',
    'server/routes/pages.mjs',
    "router.add('GET', '/prof/cours/:id', (req, res) => sendFile(req, res, path.join(root, 'prof-cours.html'), 'no-cache'));",
    ''
  ],
  ['EV-04 : l’écran masque la vraie erreur', 'src/js/db.js', 't.onabort = () => reject(', 't.onerror = () => reject(t.error);\n    t.onabort = () => reject('],
  [
    'EV-04 : erreur sans texte',
    'src/js/util.js',
    "export const errorText = (e) => e?.message || e?.name || (typeof e === 'string' && e) || 'erreur inconnue';",
    'export const errorText = (e) => e.message;'
  ],
  ['EV-04 : erreur vite effacée', 'src/js/util.js', "message.startsWith('⚠') ? 10000 : 2800", '2800'],
  ['EV-04 : échec d’écriture silencieux', 'src/js/store.js', "if (!backend.reportsErrors) toast('⚠ Enregistrement impossible : ' + errorText(e));", ''],
  [
    'EV-04 : échec d’écriture qui bloque l’export',
    'src/js/store.js',
    "if (!backend.reportsErrors) toast('⚠ Enregistrement impossible : ' + errorText(e));",
    'throw e;'
  ],
  ['EV-04 : carte oubliée après un échec', 'src/js/store.js', 'mapIds.forEach((id) => pendingMaps.add(id));', ''],
  ['EV-04 : projet oublié après un échec', 'src/js/store.js', 'pendingMeta ||= meta;', ''],
  [
    'store : écritures simultanées',
    'src/js/store.js',
    'const writePending = () => (writing = writing.then(writeChanges));',
    'const writePending = () => writeChanges();'
  ],
  ['store : « Enregistré » affiché trop tôt', 'src/js/store.js', 'backend.onChange?.();', ''],
  ['store : fermeture pendant un envoi sans avertissement', 'src/js/store.js', 'hasUnsentChanges() || writesInProgress > 0', 'hasUnsentChanges()'],
  ['photos : recompression qui alourdit gardée', 'src/js/util.js', 'return accepted && smaller.length >= src.length ? src : smaller;', 'return smaller;'],
  ['photos : pas de réduction', 'src/js/prof/course-backend.js', 'max: 1280', 'max: 9000'],
  ['photos : plan réduit comme une photo', 'src/js/prof/course-backend.js', 'const PLAN = { convert: true };', 'const PLAN = PHOTO;'],
  [
    'photos : vidéo traitée comme une photo',
    'src/js/prof/course-backend.js',
    "file.type.startsWith('video/') ? uploadVideo(file) : uploadPhoto(file)",
    'uploadPhoto(file)'
  ],
  ['cours : envoi d’un brouillon identique', 'src/js/prof/course-backend.js', "if (text === lastSaved) return onState('saved');", ''],
  ['cours : révision du serveur ignorée', 'src/js/prof/course-backend.js', 'Object.assign(course, await api(', 'await (async (_c, p) => p)(course, api('],
  ['cours : erreur d’enregistrement muette', 'src/js/prof/course-backend.js', "onState('error', e);", ''],
  [
    'cours : « Enregistré » malgré une modification en attente',
    'src/js/prof/course.js',
    "reported === 'saved' && hasUnsentChanges() ? 'saving' : reported",
    'reported'
  ],
  ['cours : bandeau d’erreur jamais montré', 'src/js/prof/course.js', "banner.hidden = state !== 'error';", 'banner.hidden = true;'],
  ['cours : bandeau d’erreur jamais retiré', 'src/js/prof/course.js', "banner.hidden = state !== 'error';", "if (state === 'error') banner.hidden = false;"],
  ['cours : conflit présenté comme une panne', 'src/js/prof/course.js', 'const reload = error.status === 409;', 'const reload = false;'],
  ['cours : session expirée sans explication', 'src/js/prof/course.js', 'const expired = error.status === 401;', 'const expired = false;'],
  ['cours : pas d’avertissement en quittant', 'src/js/prof/course.js', 'if (hasPendingChanges()) event.preventDefault();', ''],
  ['cours : plan absent non signalé', 'src/js/prof/course.js', "$('#planEmpty').hidden = !!S.map.image;", "$('#planEmpty').hidden = true;"],
  ['cours : pas de renvoi vers la connexion', 'src/js/prof/course.js', "if (e.status === 401) return location.replace('/prof');", ''],
  ['cours : contenu hors de son format', 'src/js/model.js', 'return { format, version, title, theme, aiEndpoint, maps };', 'return project;'],
  [
    'publication : pas d’avertissement',
    'src/js/prof/course-tab.js',
    "if (warned.length && !confirm(`${warned.join('\\n')}\\n\\nPublier quand même ?`)) return;",
    ''
  ],
  ['publication : positions manquantes non comptées', 'src/js/prof/course-tab.js', 'visible.filter((fiche) => !hasRef(fiche)).length', '0'],
  ['publication : plan manquant non signalé', 'src/js/prof/course-tab.js', 'S.project.maps.filter((map) => !map.image).length', '0'],
  ['publication : part avant l’enregistrement', 'src/js/prof/course-tab.js', '  await flush();\n', ''],
  ['publication : part malgré un échec d’enregistrement', 'src/js/prof/course-tab.js', 'if (hasUnsentChanges()) {', 'if (false) {'],
  ['publication : erreur muette', 'src/js/prof/course-tab.js', 'publishError = `Publication impossible : ${errorText(e)}`;', ''],
  ['publication : erreur ancienne restée affichée', 'src/js/prof/course-tab.js', "publishError = '';\n", ''],
  ['publication : bouton actif sans modification', 'src/js/prof/course-tab.js', 'button.disabled = !course.modified;', 'button.disabled = false;'],
  ['import : travail des élèves repris', 'src/js/prof/course-io.js', '{ draft: draftOf(project) }', '{ draft: project }'],
  ['import : photos laissées dans le contenu', 'src/js/prof/course-io.js', 'for (const media of photos) await send(', 'for (const media of []) await send('],
  ['import : plan laissé dans le contenu', 'src/js/prof/course-io.js', 'for (const map of plans) await send(', 'for (const map of []) await send('],
  ['import : vidéo réduite comme une photo', 'src/js/prof/course-io.js', "media.type === 'video' ? uploadVideo : uploadPhoto", 'uploadPhoto'],
  [
    'import : un fichier refusé fait tout échouer',
    'src/js/prof/course-io.js',
    "    } catch {\n      failed++;\n      store('');\n    }",
    '    } catch (e) {\n      throw e;\n    }'
  ],
  ['import : média refusé gardé', 'src/js/prof/course-io.js', 'fiche.media = fiche.media.filter((media) => media.data);', ''],
  ['export : photos non incluses', 'src/js/prof/course-io.js', 'media.data = await embedded(media.data);', ''],
  ['export : plan non inclus', 'src/js/prof/course-io.js', 'map.image = await embedded(map.image);', ''],
  [
    'export : fichier manquant ignoré',
    'src/js/prof/course-io.js',
    'if (!response.ok) throw new Error(`fichier introuvable sur le serveur (${response.status})`);',
    ''
  ],
  ['API : erreur sans texte', 'src/js/api.js', 'text || `Le serveur a répondu ${response.status}.`', 'text'],
  [
    'IA : photo du serveur envoyée comme une adresse',
    'src/js/ai.js',
    "if (m.data?.startsWith('/media/')) images.push(await blobToDataURL(await (await fetch(m.data)).blob()));\n      else if (m.data)",
    'if (m.data)'
  ],
  ['EDI-10 : mesures dans la liste', 'src/js/views/admin/fiches.js', "${S.teacherSpace ? '' : measuresHTML(f)}", '${measuresHTML(f)}'],
  ['EDI-10 : séance dans l’espace enseignant', 'src/js/views/admin/fiches.js', "${S.teacherSpace ? '' : sessionHTML()}", '${sessionHTML()}'],
  [
    'EDI-10 : mot de passe de gestion dans l’espace enseignant',
    'src/js/views/admin/settings.js',
    "${S.teacherSpace ? '' : passwordHTML()}",
    '${passwordHTML()}'
  ],
  [
    'EDI-10 : colonnes de mesures au tableur',
    'src/js/spreadsheet.js',
    '(S.teacherSpace ? COLUMNS.filter(([k]) => !MEASURE_KEYS.includes(k)) : COLUMNS)',
    'COLUMNS'
  ],
  ['fiche : enregistrable pendant un envoi', 'src/js/views/editor.js', "$('#eSave').disabled = true;", ''],
  ['fiche : enregistrement resté bloqué', 'src/js/views/editor.js', "$('#eSave').disabled = false;", ''],
  [
    'fiche : cause d’un refus non affichée',
    'src/js/views/editor.js',
    "toast(`⚠ Impossible d'enregistrer ${file.name} : ${errorText(error)}`);",
    "toast(`⚠ Impossible d'enregistrer ${file.name}`);"
  ],
  [
    'liste : suppression sans confirmation',
    'src/js/prof/main.js',
    "l'historique de ses lancements seront effacés définitivement.`)",
    "l'historique de ses lancements seront effacés définitivement.`) && false"
  ],
  ['liste : nom vide accepté', 'src/js/prof/main.js', 'if (!title) return;', ''],
  [
    'liste : état de publication faux',
    'src/js/prof/main.js',
    'course.modified ? `Version ${course.published.number} publiée, modifications en attente` : `Version ${course.published.number} publiée`',
    '`Version ${course.published.number} publiée`'
  ],
  ['liste : session expirée non détectée', 'src/js/prof/main.js', 'if (e.status === 401) showLogin();\n    else showError(error, e);', 'showError(error, e);'],
  [
    'écran : long titre hors du téléphone',
    'src/css/app.css',
    'margin: 0; letter-spacing: -.01em; overflow-wrap: anywhere; }',
    'margin: 0; letter-spacing: -.01em; }'
  ],
  [
    'écran : tableau coupé sur un petit ordinateur',
    'src/css/app.css',
    '@media (max-width: 1000px) {\n  table.teachers',
    '@media (max-width: 500px) {\n  table.teachers'
  ],
  ['écran : longue adresse qui élargit le tableau', 'src/css/app.css', 'table.teachers td:first-child { overflow-wrap: anywhere; min-width: 120px; }', ''],
  [
    'démarrage : une sauvegarde impossible fait tomber le serveur',
    'server/index.mjs',
    "console.error('Sauvegarde de la base impossible :', e.message);",
    'throw e;'
  ]
];

/** Lance les tests. Tout le groupe de processus est tué à la fin : un serveur de test ne doit pas survivre. */
function runTests(cwd, tests, { stopAtFirstFailure = false } = {}) {
  return new Promise((resolve) => {
    let out = '';
    // Dossiers temporaires dans la copie : un test tué n'a pas le temps de ranger les siens
    const env = { ...process.env, TMPDIR: path.join(cwd, 'tmp') };
    const child = spawn(process.execPath, ['--test', ...tests], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* déjà terminé */
      }
    };
    child.stdout.on('data', (chunk) => {
      out += chunk;
      // Un mutant est attrapé dès le premier échec : inutile d'attendre la fin de la suite
      if (stopAtFirstFailure && /^✖ .+ \(\d/m.test(out)) killGroup();
    });
    child.stderr.on('data', (chunk) => (out += chunk));
    const timer = setTimeout(() => {
      killGroup();
      resolve({ blocked: true, out });
    }, RUN_TIMEOUT);
    child.on('exit', (code) => {
      clearTimeout(timer);
      killGroup();
      resolve({ code, out });
    });
  });
}

const filter = process.argv[2] ?? '';
const selected = MUTANTS.filter(([name]) => name.includes(filter));
const copy = mkdtempSync(path.join(tmpdir(), 'ib-mutants-'));
const source = process.cwd();
cpSync(source, copy, { recursive: true, filter: (p) => !/(^|\/)(node_modules|\.git|dist|\.dev-data|data)(\/|$)/.test(path.relative(source, p)) });
mkdirSync(path.join(copy, 'tmp'));
symlinkSync(path.join(source, 'node_modules'), path.join(copy, 'node_modules'));
/** Les tests utiles à chaque fichier : assez pour attraper un bug, sans relancer toute la suite à chaque fois. */
const TESTS_FOR = {
  'server/auth.mjs': ['accounts', 'password', 'server-start'],
  'server/routes/auth.mjs': ['accounts'],
  'server/routes/admin.mjs': ['accounts', 'courses'],
  'server/routes/courses.mjs': ['courses'],
  'server/routes/pages.mjs': ['accounts', 'courses'],
  'server/courses.mjs': ['courses'],
  'server/media.mjs': ['courses'],
  'server/security.mjs': ['security', 'accounts', 'routes-legacy'],
  'server/http.mjs': ['http', 'routes-legacy', 'courses'],
  'server/db.mjs': ['db', 'server-start'],
  'server/migrations/001-initial.sql': ['db'],
  'server/routes/legacy.mjs': ['routes-legacy', 'server'],
  'server/index.mjs': ['server-start'],
  'server/app.mjs': ['server-start', 'courses'],
  'src/js/model.js': ['model', 'e2e/courses'],
  'src/js/spreadsheet.js': ['spreadsheet', 'e2e/courses'],
  'src/js/util.js': ['util', 'e2e/legacy', 'e2e/courses'],
  'src/js/db.js': ['e2e/legacy'],
  'src/js/store.js': ['e2e/legacy', 'e2e/courses'],
  'src/js/project-io.js': ['e2e/legacy'],
  'src/js/views/editor.js': ['e2e/courses'],
  'src/js/views/admin/fiches.js': ['e2e/courses'],
  'src/js/views/admin/settings.js': ['e2e/courses'],
  'src/js/views/admin/maps.js': ['e2e/courses', 'e2e/legacy'],
  'src/js/prof/course.js': ['e2e/courses'],
  'src/js/prof/course-backend.js': ['e2e/courses'],
  'src/js/prof/course-io.js': ['e2e/courses'],
  'src/js/prof/course-tab.js': ['e2e/courses'],
  'src/js/prof/main.js': ['e2e/courses'],
  'src/js/api.js': ['e2e/courses'],
  'src/js/ai.js': ['e2e/courses'],
  'src/js/admin/main.js': ['e2e/accounts', 'e2e/courses'],
  'src/js/compte/main.js': ['e2e/accounts'],
  'src/js/compte/ui.js': ['e2e/accounts'],
  'src/css/app.css': ['e2e/accounts', 'e2e/courses']
};
const testsFor = (file) => (TESTS_FOR[file] ?? []).map((name) => `tests/${name}.test.js`);

// Sur du code intact, tout doit passer : sinon chaque modification paraîtrait attrapée, à tort.
for (const tests of new Set(selected.map(([, file]) => testsFor(file).join(' ')))) {
  const { code, blocked } = await runTests(copy, tests.split(' '));
  if (code !== 0 || blocked) {
    console.error(`Les tests échouent déjà sur le code intact : ${tests}\nRien n'a été vérifié.`);
    rmSync(copy, { recursive: true, force: true });
    process.exit(1);
  }
}

const problems = [];
for (const [name, file, from, to, everywhere] of selected) {
  const target = path.join(copy, file);
  const original = readFileSync(target, 'utf8');
  if (!original.includes(from)) {
    console.log(`INTROUVABLE  ${name}`);
    problems.push(`${name} : texte introuvable dans ${file}`);
    continue;
  }
  writeFileSync(target, everywhere ? original.replaceAll(from, to) : original.replace(from, () => to));
  const { code, blocked, out } = await runTests(copy, testsFor(file), { stopAtFirstFailure: true });
  writeFileSync(target, original);
  const failing = new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((match) => match[1])).size;
  if (blocked || !failing) problems.push(`${name} : ${blocked ? 'les tests se bloquent' : code === 0 ? 'aucun test n’échoue' : 'échec sans test identifié'}`);
  console.log(`${failing && !blocked ? 'attrapé     ' : 'PROBLÈME    '} ${name}`);
}
rmSync(copy, { recursive: true, force: true });

console.log(`\n${selected.length - problems.length}/${selected.length} attrapés`);
for (const problem of problems) console.log(`✖ ${problem}`);
process.exit(problems.length ? 1 : 0);
