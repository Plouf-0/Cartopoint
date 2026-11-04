#!/usr/bin/env node
/**
 * Vérifie que les tests attrapent les bugs : casse le code exprès, une modification à la fois, sur
 * une copie du projet, et contrôle qu'au moins un test échoue (QUA-08).
 *
 *   npm run test:mutants            toutes les modifications (plusieurs minutes)
 *   npm run test:mutants -- E-04    seulement celles dont le nom contient « E-04 »
 *   npm run test:mutants -- --jobs=4 E-04   quatre à la fois, chacune dans sa propre copie
 *   npm run test:mutants -- -v              annonce aussi ce qui démarre : utile quand les essais durent
 *
 * Plusieurs à la fois : une seule série occupe déjà environ 2 cœurs. Viser la moitié des cœurs de la machine : un test qui dépasse
 * son délai sous la charge ferait passer un mutant pour attrapé. Le contrôle sur le code intact tourne avec le même nombre d'essais
 * simultanés, et une charge trop forte s'y voit.
 *
 * Il vérifie d'abord que les tests passent sur le code intact. Une modification que les tests ne
 * remarquent pas « survit » : il manque alors un test. Le script échoue aussi si un texte à remplacer a disparu du code, pour que cette liste reste à jour, ou si
 * les tests se bloquent au lieu d'échouer. Ajouter ici chaque comportement sensible.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RUN_TIMEOUT = 420000;

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
  ['ENS-02 : égalité de dates au hasard', 'server/courses.mjs', 'ORDER BY updated_at DESC, rowid DESC', 'ORDER BY updated_at DESC, id'],
  ['SUI-01 : égalité d’arrivée au hasard', 'server/launches.mjs', 'ORDER BY joined_at, rowid', 'ORDER BY joined_at, id'],
  ['HIS : égalité de lancements au hasard', 'server/launches.mjs', 'ORDER BY opened_at DESC, rowid DESC', 'ORDER BY opened_at DESC, id'],
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
  ['page d’un cours introuvable', 'server/routes/pages.mjs', "'/prof/cours/:id': 'prof-cours.html'", "'/prof/cours/:id': 'prof.html'"],
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
  ['cours : contenu hors de son format', 'src/js/model.js', 'return { format, version, title, theme, maps };', 'return project;'],
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
  // Rendre : vérifier, corriger, ne rien laisser repartir
  ['rendu : position hors du plan', 'server/answers.mjs', 'value >= 0 && value <= 100', 'value >= 0'],
  ['rendu : position négative', 'server/answers.mjs', 'value >= 0 && value <= 100', 'value <= 100'],
  ['rendu : position en texte', 'server/answers.mjs', "typeof value === 'number' && ", ''],
  ['rendu : placement à moitié', 'server/answers.mjs', '(raw.x ?? raw.y ?? null) !== null', 'false'],
  ['rendu : mesure trop longue', 'server/answers.mjs', 'value.length > MAX_MEASURE', 'false'],
  ['rendu : mesure qui n’est pas du texte', 'server/answers.mjs', "typeof value !== 'string' || ", ''],
  ['rendu : champ en trop gardé', 'server/answers.mjs', 'const entry = { x: placed ?', 'const entry = { ...raw, x: placed ?'],
  [
    'rendu : fiche masquée acceptée',
    'server/answers.mjs',
    'new Set(visibleFiches(map).map((fiche) => fiche.id))',
    'new Set(map.fiches.map((fiche) => fiche.id))'
  ],
  ['rendu : fiche inconnue acceptée', 'server/answers.mjs', 'if (!fiches.has(ficheId)) refuse();', ''],
  ['rendu : proportions du plan ignorées', 'server/answers.mjs', 'ratio: map.ratio || 1', 'ratio: 1'],
  ['rendu : échelle ignorée', 'server/answers.mjs', 'widthMeters: map.widthMeters', 'widthMeters: null'],
  ['rendu : fiches masquées notées', 'server/answers.mjs', 'const fiches = visibleFiches(map).map((fiche) => {', 'const fiches = map.fiches.map((fiche) => {'],
  ['rendu : écart inventé', 'server/answers.mjs', 'd === undefined ? { state } : { state, d, dist }', '{ state, d, dist }'],
  ['rendu : score par carte seulement', 'server/answers.mjs', 'total[state]++;', ''],
  ['rendu : résultat renvoyé à l’élève', 'server/routes/student.mjs', '{ received: true, submittedAt }', '{ received: true, submittedAt, score: 1 }'],
  ['rendu : second envoi vérifié à son tour', 'server/routes/student.mjs', 'if (!submittedAt) {', 'if (true) {'],
  ['rendu : réception jamais confirmée', 'server/routes/student.mjs', 'received: Boolean(submittedAt)', 'received: false'],
  ['rendu : limite de 64 Ko', 'server/routes/student.mjs', 'readJson(req, MAX_ANSWERS_BYTES)', 'readJson(req)'],
  ['rendu : pas de limite utile', 'server/answers.mjs', 'MAX_ANSWERS_BYTES = 256 * 1024', 'MAX_ANSWERS_BYTES = 2560 * 1024'],
  ['rendu : le second envoi remplace le premier', 'server/launches.mjs', 'WHERE id = ? AND submitted_at IS NULL', 'WHERE id = ?'],
  ['rendu : retard non signalé', 'server/launches.mjs', 'participant.ended_at && !closedByEnd ? 1 : 0', '0'],
  ['rendu : terminer sans confirmation', 'src/js/eleve/main.js', 'if (!confirm(`${warning}Terminer ?', 'if (false && !confirm(`${warning}Terminer ?'],
  ['rendu : fiches non placées non annoncées', 'src/js/eleve/main.js', 'const warning = missing ?', 'const warning = false ?'],
  ['rendu : une seule carte comptée', 'src/js/eleve/main.js', 'S.project.maps.reduce(', '[S.map].reduce('],
  [
    'rendu : rien de figé',
    'src/js/eleve/main.js',
    'finishedAt: new Date().toISOString() };\n  S.finished = true;\n',
    'finishedAt: new Date().toISOString() };\n'
  ],
  ['rendu : figé oublié au rechargement', 'src/js/eleve/main.js', '  S.finished = Boolean(submission);\n', ''],
  ['rendu : réponses non gardées', 'src/js/eleve/main.js', '  await keepSubmission();\n  showCourseState();', '  showCourseState();'],
  ['CRG-11 : travail figé non gardé', 'src/js/eleve/main.js', '  await flush();\n  await keepSubmission();\n}', '  await flush();\n}'],
  ['rendu : réponses vides', 'src/js/eleve/main.js', 'S.progress[map.id]?.entries ?? {}', '{}'],
  ['rendu : jamais renvoyé', 'src/js/eleve/main.js', "if (sendState !== 'refused') await sendAnswers();", ''],
  ['rendu : refus réessayé sans fin', 'src/js/eleve/main.js', "if (sendState !== 'refused') await sendAnswers();", 'await sendAnswers();'],
  ['rendu : refus traité comme une coupure', 'src/js/eleve/main.js', "e.status === 400 || e.status === 413 ? 'refused' : 'waiting'", "'waiting'"],
  ['rendu : réception non découverte', 'src/js/eleve/main.js', "} else if (sendState !== 'received') {", '} else if (false) {'],
  ['rendu : pas de bouton Réessayer', 'src/js/eleve/main.js', "${sendState === 'waiting' ?", '${false ?'],
  ['rendu : hors ligne, prétend envoyer', 'src/js/eleve/main.js', "if (submission && !navigator.onLine) sendState = 'waiting';", ''],
  ['rendu : invitation restée après avoir rendu', 'src/js/eleve/main.js', '  showCourseState();\n  await sendAnswers();', '  await sendAnswers();'],
  ['rendu : pas d’invitation à la fin du cours', 'src/js/eleve/main.js', 'if (courseEnded)', 'if (false)'],
  ['figé : règle commune sans le rendu', 'src/js/store.js', '!S.admin && (verified() || S.finished)', '!S.admin && verified()'],
  [
    'figé : repère encore déplaçable',
    'src/js/views/map.js',
    'const studentCanMove = !S.admin && !locked();',
    'const studentCanMove = !S.admin && !verified();'
  ],
  ['figé : placement encore possible', 'src/js/views/student-list.js', 'else if (locked()) foot += `<span class="state">Non placée</span>`;', ''],
  ['figé : fiche encore à glisser', 'src/js/views/student-list.js', 'draggable="${!locked() && !placed}"', 'draggable="${!placed}"'],
  ['figé : mesures encore modifiables', 'src/js/views/cards.js', "${S.finished ? 'disabled' : ''}", ''],
  ['figé : mesures de la fiche encore modifiables', 'src/js/views/reader.js', "${S.finished ? 'disabled' : ''}", ''],
  ['figé : placer depuis la fiche', 'src/js/views/reader.js', 'const canPlace = !posOf(f) && !locked();', 'const canPlace = !posOf(f) && !verified();'],
  ['plan : proportions non mesurées', 'src/js/prof/course-tab.js', '      map.ratio = ratio;\n', ''],
  ['plan : mesure fausse', 'src/js/prof/course-tab.js', 'plan.naturalWidth / plan.naturalHeight', 'plan.naturalHeight / plan.naturalWidth'],
  ['plan : publié même illisible', 'src/js/prof/course-tab.js', 'throw new Error(`le plan de la carte « ${map.name} » ne se charge pas.`);', 'continue;'],
  ['fin : COU-10, élèves non finis non annoncés', 'src/js/prof/launch.js', 'const warning = unfinished\n', 'const warning = false\n'],
  ['fin : COU-10, avertissement même sans raison', 'src/js/prof/launch.js', 'const warning = unfinished\n', 'const warning = true\n'],
  [
    'fin : nombre d’élèves ayant fini faux',
    'src/js/prof/launch.js',
    'const finished = launch.participants.filter((participant) => participant.submittedAt).length;',
    'const finished = 0;'
  ],
  // CRG-01 : ce qu'un élève reçoit
  ['CRG-01 : positions réelles envoyées', 'server/student-view.mjs', "'thumbnailId',", "'thumbnailId', 'refX', 'refY',"],
  ['CRG-01 : fiches masquées envoyées', 'server/student-view.mjs', '.filter(isVisible)', ''],
  ['CRG-01 : ancienne fiche masquée envoyée', 'server/student-view.mjs', 'fiche.visible ?? fiche.studentEnabled !== false', 'fiche.visible !== false'],
  ['CRG-01 : carte copiée telle quelle', 'server/student-view.mjs', '...pick(map, MAP_FIELDS)', '...map'],
  ['CRG-01 : fiche copiée telle quelle', 'server/student-view.mjs', '...pick(fiche, FICHE_FIELDS)', '...fiche'],
  ['CRG-01 : média copié tel quel', 'server/student-view.mjs', 'pick(media, MEDIA_FIELDS)', 'media'],
  ['CRG-01 : thème copié tel quel', 'server/student-view.mjs', 'pick(content.theme ?? {}, THEME_FIELDS)', 'content.theme ?? {}'],
  [
    'CRG-01 : la route envoie le cours complet',
    'server/routes/student.mjs',
    'studentCourse(JSON.parse(participantOf(req).content))',
    'JSON.parse(participantOf(req).content)'
  ],
  // Lancer
  ['lancement : code avec des lettres ambiguës', 'server/launches.mjs', "'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'", "'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'"],
  ['lancement : code trop court', 'server/launches.mjs', 'const CODE_LENGTH = 6;', 'const CODE_LENGTH = 4;'],
  ['lancement : code pris sans nouvel essai', 'server/launches.mjs', 'attempt >= CODE_ATTEMPTS ||', 'true ||'],
  ['lancement : trop d’essais sur un code pris', 'server/launches.mjs', 'attempt >= CODE_ATTEMPTS ||', 'attempt >= 50 ||'],
  ['lancement : code en minuscules refusé', 'server/launches.mjs', '.toUpperCase()', ''],
  ['lancement : code avec espaces refusé', 'server/launches.mjs', ".replace(/[\\s-]/g, '')", ''],
  [
    'lancement : brouillon sans publication',
    'server/launches.mjs',
    "if (!version) throw new HttpError(409, \"Publiez d'abord ce cours : les élèves n'ont accès qu'à une version publiée.\");",
    ''
  ],
  ['lancement : COU-11, plus ancienne version', 'server/launches.mjs', 'ORDER BY number DESC', 'ORDER BY number ASC'],
  ['lancement : ANO-06, sans contrôle du propriétaire', 'server/launches.mjs', 'AND courses.account_id = ?', "AND ? != ''"],
  ['lancement : terminer change la date', 'server/launches.mjs', 'COALESCE(ended_at, ?)', '?'],
  ['lancement : un élève de trop', 'server/launches.mjs', 'participantCount(launch.id) >= MAX_PARTICIPANTS', 'participantCount(launch.id) > MAX_PARTICIPANTS'],
  ['lancement : noms trop longs', 'server/launches.mjs', 'names.length > MAX_NAMES', 'false'],
  ['lancement : noms vides', 'server/launches.mjs', "if (!names) throw new HttpError(400, 'Indiquez votre prénom et votre nom.');", ''],
  ['lancement : noms sur plusieurs lignes', 'server/launches.mjs', ".replace(/\\s+/g, ' ')", ''],
  ['lancement : caractères de contrôle gardés', 'server/launches.mjs', ".replace(/\\p{C}+/gu, ' ')", ''],
  [
    'lancement : jeton gardé en clair',
    'server/launches.mjs',
    'participants.token_hash = ?`\n        )\n        .get(hashToken(token))',
    'participants.token_hash = ?`\n        )\n        .get(token)'
  ],
  ['lancement : jeton du suivi envoyé', 'server/launches.mjs', 'late: Boolean(p.late)', 'late: Boolean(p.late), tokenHash: p.token_hash'],
  [
    'lancement : relance sans la route',
    'server/routes/launches.mjs',
    "'/api/courses/:id/launches',\n      sameOriginOnly((req, res, { params }) => sendJson(req, res, launches.open(",
    "'/api/courses/:id/launches',\n      ((req, res, { params }) => sendJson(req, res, launches.open("
  ],
  [
    'lancement : terminer sans contrôle d’origine',
    'server/routes/launches.mjs',
    "'/api/launches/:id/end',\n      sameOriginOnly(",
    "'/api/launches/:id/end',\n      ("
  ],
  ['lancement : en cours compté à tort', 'server/courses.mjs', 'courses.account_id = ? AND launches.ended_at IS NULL', 'courses.account_id = ?'],
  ['lancement : terminé encore à suivre', 'server/courses.mjs', 'course_id = ? AND ended_at IS NULL', 'course_id = ?'],
  // Rejoindre
  ['élève : COU-08, code encore valable', 'server/routes/student.mjs', 'if (launch.ended_at) throw new HttpError(410, COURSE_ENDED);', ''],
  ['élève : ADM-06, entrée sur un compte désactivé', 'server/routes/student.mjs', 'if (launch.disabled_at) throw new HttpError(410, COURSE_CLOSED);', ''],
  ['élève : échecs non comptés', 'server/routes/student.mjs', 'failures.fail(ip);', ''],
  [
    'QUA-09 : une classe bloquée par ses erreurs de code',
    'server/routes/student.mjs',
    'export const MAX_CODE_FAILURES = 200;',
    'export const MAX_CODE_FAILURES = 30;'
  ],
  ['élève : limite non appliquée', 'server/routes/student.mjs', 'if (failures.blocked(ip)) throw new HttpError(429, TOO_MANY);', ''],
  [
    'élève : un cours terminé compte comme un échec',
    'server/routes/student.mjs',
    'if (launch.ended_at) throw',
    'if (launch.ended_at) failures.fail(ip);\n    if (launch.ended_at) throw'
  ],
  ['élève : limite pour toute la classe', 'server/routes/student.mjs', 'const ip = clientIp(req, trustProxy);', "const ip = 'tous';"],
  [
    'élève : entrée sans contrôle d’origine',
    'server/routes/student.mjs',
    'sameOriginOnly(async (req, res, { params }) => {',
    '(async (req, res, { params }) => {'
  ],
  [
    'élève : cours terminé pendant l’entrée',
    'server/routes/student.mjs',
    'launches.join(openLaunch(req, params), names)',
    'launches.join(launches.byCode(params.code), names)'
  ],
  ['élève : le code remplace le jeton', 'server/routes/student.mjs', 'if (!participant) throw new HttpError(401, NO_COURSE);', ''],
  ['élève : cours mis en cache pour tous', 'server/routes/student.mjs', "'private, no-cache'", "'no-cache'"],
  ['élève : cours jamais terminé', 'server/routes/student.mjs', 'ended: Boolean(endedAt)', 'ended: false'],
  ['page : élève sans page', 'server/routes/pages.mjs', "'/c/:code': 'eleve.html'", "'/c/:code': 'prof.html'"],
  // Écran du lancement
  ['lancement : QR code sans marge', 'src/js/prof/qr.js', 'const QUIET_ZONE = 4;', 'const QUIET_ZONE = 0;'],
  ['lancement : QR code vers une mauvaise adresse', 'src/js/prof/launch.js', '`${location.origin}/c/${code}`', '`${location.origin}/${code}`'],
  ['lancement : liste jamais actualisée', 'src/js/prof/launch.js', 'const REFRESH_EVERY = 5000;', 'const REFRESH_EVERY = 500000;'],
  ['lancement : code encore affiché après la fin', 'src/js/prof/launch.js', 'joinCard.hidden = ended;', ''],
  ['lancement : bouton Terminer après la fin', 'src/js/prof/launch.js', 'endCard.hidden = ended;', ''],
  ['lancement : QR code resté ouvert après la fin', 'src/js/prof/launch.js', 'if (ended && qr.open) qr.close();', ''],
  ['lancement : terminer sans confirmation', 'src/js/prof/launch.js', 'if (!confirm(`Terminer le cours ?', 'if (false && !confirm(`Terminer le cours ?'],
  ['lancement : bouton Terminer bloqué après un échec', 'src/js/prof/launch.js', 'end.disabled = false;', ''],
  [
    'lancement : liste vidée quand une mise à jour échoue',
    'src/js/prof/launch.js',
    "apply(await api('GET', `/launches/${launchId}`));\n      listError.hidden = true;",
    "list.replaceChildren();\n      apply(await api('GET', `/launches/${launchId}`));"
  ],
  ['lancement : état « a fini » jamais affiché', 'src/js/prof/launch.js', "if (!participant.submittedAt) return 'A commencé';", "return 'A commencé';"],
  ['lancement : rendu tardif non signalé', 'src/js/prof/launch.js', '!participant.late\n', 'true\n'],
  ['lancement : bouton actif sans publication', 'src/js/prof/course-tab.js', 'launch.disabled = !course.published;', 'launch.disabled = false;'],
  [
    'lancement : modifications non signalées',
    'src/js/prof/course-tab.js',
    'return course.modified ? `${version} Vos dernières',
    'return false ? `${version} Vos dernières'
  ],
  ['lancement : erreur muette', 'src/js/prof/course-tab.js', 'error.textContent = `Lancement impossible : ${errorText(e)}`;\n    error.hidden = false;', ''],
  [
    'lancement : liste bloquante si elle échoue',
    'src/js/prof/course-tab.js',
    'list.innerHTML = \'<li class="hint">Liste des lancements indisponible pour le moment.</li>\';',
    ''
  ],
  ['lancement : cours en cours introuvable', 'src/js/prof/main.js', '...(course.runningLaunch\n', '...(false\n'],
  ['lancement : admin non prévenu', 'src/js/admin/main.js', '...(teacher.running\n', '...(false\n'],
  // Page de l'élève
  ['élève : accueil sans nettoyage du code', 'src/js/accueil.js', "encodeURIComponent(clean(data.get('code')))", "encodeURIComponent(data.get('code'))"],
  ['élève : accueil sans vérification du code', 'src/js/accueil.js', "await api('GET', `/join/${code}`);", ''],
  ['élève : adresse en minuscules, autre élève', 'src/js/eleve/main.js', '.toUpperCase()', ''],
  ['élève : COU-09, même jeton pour tous les lancements', 'src/js/eleve/main.js', '`cartopoint.eleve.${code}`', "'cartopoint.eleve'"],
  ['élève : COU-09, même travail pour tous', 'src/js/eleve/main.js', '{ ...course, id: me.id }', 'course'],
  ['élève : jeton oublié', 'src/js/eleve/main.js', 'prefs.set(STORAGE_KEY, JSON.stringify(me));', ''],
  ['élève : « pas vous » sans confirmation', 'src/js/eleve/main.js', "if (!confirm(`Ce n'est pas vous ?", "if (false && !confirm(`Ce n'est pas vous ?"],
  ['élève : « pas vous » sans effet', 'src/js/eleve/main.js', 'prefs.del(STORAGE_KEY);\n    location.reload();', 'location.reload();'],
  [
    'élève : choix de carte toujours caché',
    'src/js/eleve/main.js',
    "$('#mapChoiceBox').hidden = S.project.maps.length < 2;",
    "$('#mapChoiceBox').hidden = true;"
  ],
  [
    'élève : choix de carte même sans choix',
    'src/js/eleve/main.js',
    "$('#mapChoiceBox').hidden = S.project.maps.length < 2;",
    "$('#mapChoiceBox').hidden = false;"
  ],
  ['élève : changer de carte sans effet', 'src/js/eleve/main.js', 'await switchMap(event.target.value);', ''],
  ['élève : image cassée sans plan', 'src/js/eleve/main.js', "$('#plan').hidden = !S.map.image;", ''],
  ['élève : pas de message sans plan', 'src/js/eleve/main.js', "$('#planEmpty').hidden = !!S.map.image;", "$('#planEmpty').hidden = true;"],
  [
    'élève : cours disparu non annoncé',
    'src/js/eleve/main.js',
    'serverAnswered(e);\n    if (e.status === 401) courseGone();\n    // Le réseau',
    'serverAnswered(e);\n    // Le réseau'
  ],
  ['élève : jeton mort gardé', 'src/js/eleve/main.js', 'prefs.del(STORAGE_KEY);\n    show([', 'show(['],
  [
    'élève : stockage absent non signalé',
    'src/js/eleve/main.js',
    "fatal('Ce navigateur ne peut pas garder votre travail (navigation privée ?). Ne fermez pas cette page.');",
    ''
  ],
  ['élève : travail perdu si la page se ferme', 'src/js/eleve/main.js', "window.addEventListener('pagehide', () => flush());", ''],
  ['élève : travail non relu', 'src/js/eleve/main.js', 'if (saved) work[map.id] = normalizeProgress(saved);', ''],
  ['élève : travail non écrit', 'src/js/backends/student.js', 'for (const [key, value] of progress) await Progress.put(key, value);', ''],
  [
    'élève : éditeur chargé avec la page',
    'src/js/views/fiche.js',
    'let openInEditor = () => {};',
    "import { openEditor } from './editor.js';\nlet openInEditor = openEditor;"
  ],
  ['écran : QR code plus large que le téléphone', 'src/css/app.css', 'width: min(66dvh, 84vw, 640px);', 'width: 640px;'],
  ['écran : code plus large que le téléphone', 'src/css/app.css', 'clamp(32px, 9vw, 56px)', '120px'],
  ['écran : long nom hors du téléphone', 'src/css/app.css', 'margin-left: auto; overflow-wrap: anywhere; }', 'margin-left: auto; white-space: nowrap; }'],
  ['écran : éditeur non branché', 'src/js/views/editor.js', '  useEditor(openEditor);\n', ''],
  ['EV-32 : panneau de droite trop court', 'src/css/app.css', 'max-height: max(420px, calc(100dvh - 150px));', 'max-height: 420px;'],
  ['EV-32 : panneau plus haut que l’écran', 'src/css/app.css', 'max-height: max(420px, calc(100dvh - 150px));', 'max-height: 100dvh;'],
  ['EV-33 : IA dans les réglages d’un cours', 'src/js/views/admin/settings.js', "${S.teacherSpace ? '' : aiHTML()}", '${aiHTML()}'],
  ['EV-33 : bouton IA dans un cours', 'src/js/views/editor.js', 'S.teacherSpace || !S.project.aiEndpoint', '!S.project.aiEndpoint'],
  [
    'EV-33 : adresse du service gardée dans un cours',
    'src/js/model.js',
    'return { format, version, title, theme, maps };',
    'return { format, version, title, theme, maps, aiEndpoint: project.aiEndpoint };'
  ],
  ['EV-33 : IA retirée aussi de l’application d’origine', 'src/js/views/admin/settings.js', "${S.teacherSpace ? '' : aiHTML()}", ''],
  ['EV-34 : ancien titre par défaut', 'src/js/model.js', "DEFAULT_TITLE = 'Cartopoint'", "DEFAULT_TITLE = 'Inventaire botanique'"],
  ['EV-34 : ancienne icône par défaut', 'src/js/model.js', "raw?.icon || 'pin'", "raw?.icon || 'leaf'"],
  ['EV-34 : le vert n’est plus la couleur par défaut', 'src/js/model.js', "raw?.preset || 'vegetal'", "raw?.preset || 'ocean'"],
  ['EV-34 : ancien nom de carte', 'src/js/model.js', "str(raw.name) || 'Plan'", "str(raw.name) || 'Plan du parc'"],
  ['EV-34 : icône inconnue devenue une feuille', 'src/js/themes.js', 'ICONS[name] || ICONS.pin', 'ICONS[name] || ICONS.leaf'],
  ['EV-34 : couleur verte perdue', 'src/js/themes.js', "accent: '#2e6e45'", "accent: '#1f5f8b'"],
  ['EV-34 : botanique dans une fiche ouverte', 'src/js/views/reader.js', '<h3 class="mini-h">Besoins</h3>', '<h3 class="mini-h">Besoins de la plante</h3>'],
  ['EV-34 : botanique dans la page d’un cours', 'src/prof-cours.html', '<h3>Besoins</h3>', '<h3>Besoins de la plante</h3>'],
  ['EV-34 : ancien nom du modèle de tableur', 'src/js/views/admin/fiches.js', "'Modèle de fiches.csv'", "'Modèle fiches botaniques.csv'"],
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
  // Hors ligne : le service worker
  ['hors ligne : page non gardée', 'src/sw.js', '[PAGE, ...FONTS]', '[...FONTS]'],
  ['hors ligne : polices non gardées', 'src/sw.js', '[PAGE, ...FONTS]', '[PAGE]'],
  ['hors ligne : la page gardée n’est pas servie', 'src/sw.js', "request.mode === 'navigate' ? pageFor(request) : fileFor(request)", 'fileFor(request)'],
  [
    'hors ligne : fichiers gardés non servis',
    'src/sw.js',
    "request.mode === 'navigate' ? pageFor(request) : fileFor(request)",
    "request.mode === 'navigate' ? pageFor(request) : fetch(request)"
  ],
  ['hors ligne : /api/ passe par le service worker', 'src/sw.js', " || url.pathname.startsWith('/api/')", ''],
  ['hors ligne : les écritures passent par le service worker', 'src/sw.js', "request.method !== 'GET' || ", ''],
  ['hors ligne : une nouvelle version attend la fermeture des pages', 'src/sw.js', '.then(() => self.skipWaiting())', ''],
  ['hors ligne : la page ouverte ne passe pas par lui', 'src/sw.js', '.then(() => self.clients.claim())', ''],
  ['hors ligne : anciennes versions jamais effacées', 'src/sw.js', 'name.startsWith(PAGE_CACHE_PREFIX) && name !== PAGE_CACHE', 'false'],
  ['hors ligne : photos effacées à chaque mise à jour', 'src/sw.js', 'name.startsWith(PAGE_CACHE_PREFIX) && ', ''],
  // Icône du réseau
  ['réseau : se fie à ce qu’annonce le téléphone', 'src/js/eleve/network-icon.js', 'navigator.onLine && serverReached', 'navigator.onLine'],
  ['réseau : un refus pris pour une coupure', 'src/js/eleve/network-icon.js', '!error || (error.status !== 0 && error.status < 500)', '!error'],
  ['réseau : coupure non vue', 'src/js/eleve/network-icon.js', "window.addEventListener('offline', refresh);", ''],
  [
    'réseau : le serveur revenu ne rétablit pas l’icône',
    'src/js/eleve/main.js',
    "state = await api('GET', '/student/state', undefined, token);\n    serverAnswered();",
    "state = await api('GET', '/student/state', undefined, token);"
  ],
  [
    'réseau : le silence du serveur n’est pas vu',
    'src/js/eleve/main.js',
    'serverAnswered(e);\n    if (e.status === 401) courseGone();\n    // Le réseau',
    'if (e.status === 401) courseGone();\n    // Le réseau'
  ],
  ['réseau : l’alerte ne s’ouvre pas d’elle-même', 'src/js/eleve/network-icon.js', 'if (attention && !wasAttention) setOpen(true);', ''],
  ['réseau : l’alerte se rouvre sans cesse', 'src/js/eleve/network-icon.js', 'if (attention && !wasAttention) setOpen(true);', 'setOpen(attention);'],
  [
    'réseau : l’alerte reste affichée une fois prêt',
    'src/js/eleve/network-icon.js',
    '  setOpen(false);\n  toast(SENTENCES.ready());',
    '  toast(SENTENCES.ready());'
  ],
  ['réseau : « prêt » jamais annoncé', 'src/js/eleve/network-icon.js', '  toast(SENTENCES.ready());', ''],
  ['réseau : l’appui n’ouvre rien', 'src/js/eleve/network-icon.js', "$('#netButton').onclick = () => setOpen(!$('#netInfo').classList.contains('open'));", ''],
  ['réseau : un second appui ne ferme pas', 'src/js/eleve/network-icon.js', "setOpen(!$('#netInfo').classList.contains('open'))", 'setOpen(true)'],
  ['réseau : un appui ailleurs ne ferme pas', 'src/js/eleve/network-icon.js', "if (!event.target.closest('#net')) setOpen(false);", ''],
  ['réseau : Échap ne ferme pas', 'src/js/eleve/network-icon.js', "if (event.key === 'Escape') setOpen(false);", ''],
  ['réseau : aria-expanded figé', 'src/js/eleve/network-icon.js', "$('#netButton').setAttribute('aria-expanded', String(open));", ''],
  ['réseau : icône muette pour un lecteur d’écran', 'src/js/eleve/network-icon.js', "button.setAttribute('aria-label', `${title}. ${sentence}`);", ''],
  ['réseau : pas de coche une fois prêt', 'src/js/eleve/network-icon.js', "ready: '✓'", "ready: ''"],
  ['réseau : pas de marque d’alerte', 'src/js/eleve/network-icon.js', "attention ? '!' : (BADGES[state] ?? '')", "BADGES[state] ?? ''"],
  [
    'réseau : rien ne rassure hors ligne',
    'src/js/eleve/network-icon.js',
    "!online && state === 'ready' ? `${sentence} ${OFFLINE_NOTE}` : sentence",
    'sentence'
  ],
  [
    'réseau : rassure aussi en ligne',
    'src/js/eleve/network-icon.js',
    "!online && state === 'ready' ? `${sentence} ${OFFLINE_NOTE}` : sentence",
    '`${sentence} ${OFFLINE_NOTE}`'
  ],
  ['réseau : Réessayer toujours affiché', 'src/js/eleve/network-icon.js', "$('#netRetry').hidden = state !== 'incomplete';", "$('#netRetry').hidden = false;"],
  ['réseau : bandeau revenu', 'src/eleve.html', '<p id="offlineStatus" class="visually-hidden" role="status"></p>', '<p id="offlineStatus" role="status"></p>'],
  ['réseau : pas de survol', 'src/css/app.css', '@media (hover: hover) { .net:hover .net-info { display: block; } }', ''],
  ['réseau : en-tête cassé par un nom long', 'src/css/app.css', '.student-who { order: 3; width: 100%; margin-left: 0; }', ''],
  // Journal des problèmes : ce que le serveur accepte
  [
    'INC-02 : journal lisible par tous',
    'server/routes/incidents.mjs',
    "auth.requireRole(req, 'admin');\n      sendJson(req, res, incidents.list(), PRIVATE);",
    'sendJson(req, res, incidents.list(), PRIVATE);'
  ],
  ['INC-02 : journal effaçable par tous', 'server/routes/incidents.mjs', "auth.requireRole(req, 'admin');\n        incidents.clear();", 'incidents.clear();'],
  [
    'INC-02 : signalement accepté d’un autre site',
    'server/routes/incidents.mjs',
    "'/api/incidents',\n      sameOriginOnly(async (req, res) => {",
    "'/api/incidents',\n      (async (req, res) => {"
  ],
  [
    'INC-02 : effacement accepté d’un autre site',
    'server/routes/incidents.mjs',
    "'/api/admin/incidents/clear',\n      sameOriginOnly((req, res) => {",
    "'/api/admin/incidents/clear',\n      ((req, res) => {"
  ],
  ['INC-01 : compte non noté', 'server/routes/incidents.mjs', 'auth.currentAccount(req)?.id ?? null', 'null'],
  [
    'INC-03 : tout ce qu’envoie le navigateur est gardé',
    'server/incidents.mjs',
    'const machine = cleanMachine(report.machine);',
    'const machine = report.machine ?? {};'
  ],
  [
    'INC-03 : un nombre accepté sous n’importe quelle forme',
    'server/incidents.mjs',
    'if (Number.isFinite(machine[key])) clean[key]',
    'if (machine[key] !== undefined) clean[key]'
  ],
  [
    'INC-03 : un oui/non accepté sous n’importe quelle forme',
    'server/incidents.mjs',
    "if (typeof machine[key] === 'boolean') clean[key]",
    'if (machine[key] !== undefined) clean[key]'
  ],
  ['INC-04 : message sans raison accepté', 'server/incidents.mjs', "if (!action || !reason) throw new HttpError(400, 'Message illisible.');", ''],
  ['INC-04 : textes sans limite', 'server/incidents.mjs', '.trim().slice(0, limit)', '.trim()'],
  ['INC-04 : limite de la raison retirée', 'server/incidents.mjs', 'reason: 1000', 'reason: 1000000'],
  ['INC-04 : limite du détail retirée', 'server/incidents.mjs', 'details: 2000', 'details: 2000000'],
  ['INC-04 : limite de l’envoi retirée', 'server/routes/incidents.mjs', 'const MAX_BODY = 16 * 1024;', 'const MAX_BODY = 1024 * 1024;'],
  [
    'INC-05 : chaque répétition fait une ligne',
    'server/incidents.mjs',
    '.update(JSON.stringify([accountId, page, action, reason, machine.browser]))',
    '.update(JSON.stringify([accountId, page, action, reason, machine.browser, Math.random()]))'
  ],
  ['INC-05 : compteur figé', 'server/incidents.mjs', 'count = count + 1, ', ''],
  ['INC-05 : date de la répétition non notée', 'server/incidents.mjs', 'last_at = excluded.last_at, ', ''],
  ['INC-05 : détail de la répétition non noté', 'server/incidents.mjs', ', details = excluded.details', ''],
  ['INC-05 : navigateurs confondus', 'server/incidents.mjs', '[accountId, page, action, reason, machine.browser]', '[accountId, page, action, reason]'],
  ['INC-05 : comptes confondus', 'server/incidents.mjs', '[accountId, page, action, reason, machine.browser]', '[page, action, reason, machine.browser]'],
  ['INC-06 : date de l’envoi au lieu de celle du problème', 'server/incidents.mjs', 'new Date(now() - waited)', 'new Date(now())'],
  ['INC-06 : un âge négatif date du futur', 'server/incidents.mjs', 'Math.max(report.ageMs, 0)', 'report.ageMs'],
  ['INC-06 : un âge sans limite', 'server/incidents.mjs', 'Math.min(Math.max(report.ageMs, 0), KEEP_DAYS * DAY)', 'Math.max(report.ageMs, 0)'],
  ['INC-07 : gardé trop longtemps', 'server/incidents.mjs', 'export const KEEP_DAYS = 90;', 'export const KEEP_DAYS = 900;'],
  ['INC-07 : jamais purgé', 'server/incidents.mjs', "db.prepare('DELETE FROM incidents WHERE last_at < ?').run(cutoff());", ''],
  ['INC-07 : nettoyage horaire oublié', 'server/app.mjs', '      incidents.purge();\n', ''],
  ['INC-07 : lignes sans limite', 'server/incidents.mjs', 'const MAX_ROWS = 500;', 'const MAX_ROWS = 500000;'],
  [
    'INC-07 : les nouvelles lignes partent d’abord',
    'server/incidents.mjs',
    'SELECT id FROM incidents ORDER BY last_at DESC, id DESC LIMIT ?',
    'SELECT id FROM incidents ORDER BY last_at, id LIMIT ?'
  ],
  ['INC-07 : envois sans limite', 'server/incidents.mjs', "if (tooMany()) throw new HttpError(429, 'Trop de messages pour le moment.');", ''],
  ['INC-07 : limite jamais rouverte', 'server/incidents.mjs', 'if (now() - windowStart >= 60000) {', 'if (windowStart === 0) {'],
  ['INC-02 : liste sans limite', 'server/incidents.mjs', 'const SHOWN = 200;', 'const SHOWN = 2000;'],
  ['INC-02 : anciens d’abord', 'server/incidents.mjs', 'ORDER BY last_at DESC, incidents.id DESC LIMIT ?', 'ORDER BY last_at, incidents.id LIMIT ?'],
  // Journal des problèmes : ce que le navigateur signale
  ['INC-01 : erreur du programme non signalée', 'src/js/incident.js', "reportIncident('Erreur du programme', event.error ?? event.message);", ''],
  [
    'INC-01 : promesse perdue non signalée',
    'src/js/incident.js',
    "window.addEventListener('unhandledrejection', (event) => reportIncident('Erreur du programme', event.reason));",
    ''
  ],
  ['INC-01 : bruit du navigateur signalé', 'src/js/incident.js', 'if (NOISE.test(event.message)) return;', ''],
  ['INC-01 : erreurs d’extensions signalées', 'src/js/incident.js', 'if (event.filename && !event.filename.startsWith(location.origin)) return;', ''],
  ['INC-01 : le fichier autonome signale', 'src/js/incident.js', '/^https?:$/.test(location.protocol)', 'true'],
  ['INC-01 : message d’erreur non signalé', 'src/js/util.js', "if (message.startsWith('⚠')) problemListener?.(message);", ''],
  ['INC-01 : tout message signalé', 'src/js/util.js', "if (message.startsWith('⚠')) problemListener?.(message);", 'problemListener?.(message);'],
  [
    'INC-01 : bandeau d’erreur non signalé',
    'src/js/util.js',
    'export function fatal(message) {\n  problemListener?.(message);',
    'export function fatal(message) {'
  ],
  ['INC-01 : erreur du serveur non signalée', 'src/js/api.js', 'response.status >= 500 || response.status === 413', 'response.status === 413'],
  ['INC-01 : envoi trop gros non signalé', 'src/js/api.js', 'response.status >= 500 || response.status === 413', 'response.status >= 500'],
  ['INC-01 : refus ordinaire signalé', 'src/js/api.js', 'response.status >= 500 || response.status === 413', 'response.status >= 400'],
  [
    'INC-01 : écriture perdue non signalée',
    'src/js/api.js',
    "if (options.method !== 'GET' && navigator.onLine) reportIncident('Serveur injoignable', `${options.method} ${path}`);",
    ''
  ],
  ['INC-01 : lecture perdue signalée', 'src/js/api.js', "options.method !== 'GET' && navigator.onLine", 'navigator.onLine'],
  ['INC-01 : coupure signalée', 'src/js/api.js', "options.method !== 'GET' && navigator.onLine", "options.method !== 'GET'"],
  ['INC-01 : publication ratée non signalée', 'src/js/prof/course-tab.js', "if (e.status !== 409) reportIncident('Publication', e);", ''],
  ['INC-01 : conflit signalé', 'src/js/prof/course-tab.js', "if (e.status !== 409) reportIncident('Publication', e);", "reportIncident('Publication', e);"],
  [
    'INC-01 : plan illisible non signalé',
    'src/js/prof/course-tab.js',
    "await measurePlans();\n  } catch (e) {\n    reportIncident('Publication', e);",
    'await measurePlans();\n  } catch (e) {'
  ],
  ['INC-01 : lancement raté non signalé', 'src/js/prof/course-tab.js', "reportIncident('Lancement', e);", ''],
  ['INC-01 : enregistrement raté non signalé', 'src/js/prof/course.js', "if (!reload && !expired) reportIncident('Enregistrement du cours', error);", ''],
  [
    'INC-01 : conflit d’enregistrement signalé',
    'src/js/prof/course.js',
    "if (!reload && !expired) reportIncident('Enregistrement du cours', error);",
    "if (!expired) reportIncident('Enregistrement du cours', error);"
  ],
  [
    'INC-01 : session expirée signalée',
    'src/js/prof/course.js',
    "if (!reload && !expired) reportIncident('Enregistrement du cours', error);",
    "if (!reload) reportIncident('Enregistrement du cours', error);"
  ],
  ['INC-01 : image manquante non signalée', 'src/js/eleve/main.js', "if (status.state === 'incomplete') reportIncident(", 'if (false) reportIncident('],
  ['INC-01 : navigateur incapable non signalé', 'src/js/eleve/main.js', "if (status.state === 'unavailable') reportIncident(", 'if (false) reportIncident('],
  ['INC-01 : raison de l’image manquante perdue', 'src/js/eleve/offline.js', '        why = describeError(e);\n', ''],
  ['INC-01 : raison du refus d’installation perdue', 'src/js/eleve/offline.js', '    return describeError(e);\n  }\n}', "    return 'refusé';\n  }\n}"],
  [
    'INC-01 : refus des réponses non signalé',
    'src/js/eleve/main.js',
    "if (e.status === 400) reportIncident('Envoi des réponses', `refus du serveur : ${e.message}`, '');",
    ''
  ],
  ['INC-01 : événement d’IndexedDB sans raison', 'src/js/incident.js', 'error?.target?.error ?? error', 'error'],
  ['INC-01 : « undefined » possible', 'src/js/incident.js', "String(inner ?? 'aucun détail')", 'String(inner)'],
  ['INC-01 : place sur le disque oubliée', 'src/js/incident.js', 'storageQuota: estimate?.quota', 'storageQuota: undefined'],
  ['INC-01 : navigateur non noté', 'src/js/incident.js', 'browser: navigator.userAgent,', ''],
  ['INC-01 : page historique sans journal', 'src/js/main.js', "import './incident.js';\n", ''],
  ['INC-03 : le secret d’un lien part dans le journal', 'src/js/incident.js', 'page: location.pathname', 'page: location.href'],
  [
    'INC-06 : pas d’attente sans réseau',
    'src/js/incident.js',
    'if (!(await deliver(report))) keepForLater(report);\n  } catch {',
    'await deliver(report);\n  } catch {'
  ],
  ['INC-06 : rien ne part au retour du réseau', 'src/js/incident.js', "window.addEventListener('online', sendWaiting);", ''],
  ['INC-06 : une réponse du serveur ne vide pas la file', 'src/js/api.js', '  sendWaiting();\n', ''],
  ['INC-06 : rien ne part à l’ouverture', 'src/js/incident.js', '  sendWaiting();\n}', '}'],
  ['INC-06 : renvoyé sans fin après un refus', 'src/js/incident.js', 'return response.status < 500;', 'return response.ok;'],
  ['INC-06 : perdu si le serveur est en panne', 'src/js/incident.js', 'return response.status < 500;', 'return true;'],
  ['INC-06 : âge non transmis', 'src/js/incident.js', 'ageMs: Date.now() - at', 'ageMs: 0'],
  ['INC-07 : file sans limite sur l’appareil', 'src/js/incident.js', '.slice(-QUEUE_MAX)', ''],
  [
    'INC-07 : file illisible qui casse la page',
    'src/js/incident.js',
    'return Array.isArray(queue) ? queue : [];\n  } catch {\n    return [];\n  }',
    'return queue;\n  } catch (e) {\n    throw e;\n  }'
  ],
  ['INC-07 : une page s’emballe sans fin', 'src/js/incident.js', 'reported >= PER_PAGE_MAX', 'false'],
  // Journal des problèmes : ce que lit l'admin
  [
    'INC-02 : .log introuvable',
    'src/js/admin/incidents.js',
    "save.addEventListener('click', () => download(journalLog(shown), `cartopoint-journal-${today()}.log`, 'text/plain;charset=utf-8'));",
    ''
  ],
  ['INC-02 : .log proposé sans rien dedans', 'src/js/admin/incidents.js', 'save.hidden = !incidents.length;', 'save.hidden = false;'],
  ['INC-02 : .log vide', 'src/js/admin/incidents.js', 'shown = incidents;', ''],
  ['INC-02 : .log sans la pile', 'src/js/admin/incidents.js', "incident.details ? `Pile :\\n${incident.details}` : ''", "''"],
  ['INC-02 : .log sans la machine', 'src/js/admin/incidents.js', '`Machine : ${machineSummary(incident.machine)}`,', ''],
  ['INC-02 : carte absente du tableau de bord', 'src/js/admin/main.js', 'incidentsCard(), ', ''],
  ['INC-02 : effacer sans confirmation', 'src/js/admin/incidents.js', "if (!confirm('Effacer tout le journal ?')) return;", ''],
  ['INC-02 : Effacer proposé sans rien à effacer', 'src/js/admin/incidents.js', 'clear.hidden = !incidents.length;', 'clear.hidden = false;'],
  ['INC-02 : journal vide non annoncé', 'src/js/admin/incidents.js', 'empty.hidden = incidents.length > 0;', 'empty.hidden = true;'],
  ['INC-02 : Android pris pour Linux', 'src/js/admin/incidents.js', "  [/Android/, 'Android'],\n", ''],
  ['INC-02 : iPhone pris pour un Mac', 'src/js/admin/incidents.js', "  [/iPhone|iPad/, 'iOS'],\n", ''],
  ['INC-02 : Edge pris pour Chrome', 'src/js/admin/incidents.js', "  [/Edg\\w*\\/(\\d+)/, 'Edge'],\n", ''],
  ['INC-02 : Opera pris pour Chrome', 'src/js/admin/incidents.js', "  [/OPR\\/(\\d+)/, 'Opera'],\n", ''],
  ['INC-02 : Samsung pris pour Chrome', 'src/js/admin/incidents.js', "  [/SamsungBrowser\\/(\\d+)/, 'Samsung Internet'],\n", ''],
  ['INC-02 : place sur le disque non affichée', 'src/js/admin/incidents.js', 'if (machine.storageQuota) parts.push(', 'if (false) parts.push('],
  ['INC-02 : tailles en Mo même au-delà du Go', 'src/js/admin/incidents.js', 'bytes >= 1e9 ?', 'false ?'],
  ['INC-02 : mémoire plafonnée présentée comme exacte', 'src/js/admin/incidents.js', "machine.memoryGb >= 8 ? '8 Go de mémoire ou plus' : ", ''],
  ['INC-02 : répétitions non affichées', 'src/js/admin/incidents.js', 'incident.count > 1 ? ', 'false ? '],
  ['INC-02 : compteur à 1 affiché', 'src/js/admin/incidents.js', 'incident.count > 1 ? ', 'true ? '],
  ['INC-02 : qui n’est pas dit', 'src/js/admin/incidents.js', "incident.account ?? 'sans compte'", "'sans compte'"],
  ['INC-02 : pile cachée', 'src/js/admin/incidents.js', ', incident.details]', ']'],
  // Fin du cours : la correction, côté serveur
  ['CRG-02 : correction avant la fin', 'server/routes/student.mjs', 'if (!endedAt) throw new HttpError(403, NOT_ENDED);', ''],
  ['CRG-07 : correction sans réponses', 'server/routes/student.mjs', 'if (!submittedAt) throw new HttpError(409, NOT_RECEIVED);', ''],
  ['CRG-06 : correction gardée en cache', 'server/routes/student.mjs', 'JSON.parse(results)), PRIVATE)', 'JSON.parse(results)), REVALIDATED)'],
  ['CRG-06 : positions réelles absentes', 'server/answers.mjs', '...(hasRef(fiche) ? { refX: fiche.refX, refY: fiche.refY } : {})', ''],
  [
    'CRG-01 : fiches masquées dans la correction',
    'server/answers.mjs',
    'visibleFiches(map).map((fiche) => [\n              fiche.id,',
    'map.fiches.map((fiche) => [\n              fiche.id,'
  ],
  ['CRG-11 : figé compté comme tardif', 'server/launches.mjs', 'participant.ended_at && !closedByEnd ? 1 : 0', 'participant.ended_at ? 1 : 0'],
  ['CRG-11 : figé accepté avant la fin', 'server/launches.mjs', 'autoClosed && Boolean(participant.ended_at)', 'autoClosed'],
  ['CRG-11 : n’importe quoi vaut figé', 'server/routes/student.mjs', 'autoClosed: autoClosed === true', 'autoClosed: Boolean(autoClosed)'],
  ['CRG-13 : heure écartée', 'server/answers.mjs', 'if (Number.isFinite(raw.at)) entry.at = raw.at;', ''],
  ['CRG-13 : heure non vérifiée', 'server/answers.mjs', 'if (Number.isFinite(raw.at)) entry.at = raw.at;', 'if (raw.at !== undefined) entry.at = raw.at;'],
  ['CRG-13 : horloge fausse non corrigée', 'server/answers.mjs', 'Number.isFinite(sentAt) ? now - sentAt : 0', '0'],
  ['CRG-13 : envoi sans heure mal compris', 'server/answers.mjs', 'Number.isFinite(sentAt) ? now - sentAt : 0', 'now - sentAt'],
  ['CRG-13 : réponse dans le futur acceptée', 'server/answers.mjs', 'at: Math.min(entry.at + offset, now)', 'at: entry.at + offset'],
  ['CRG-13 : pas de délai après la fin', 'server/answers.mjs', 'const limit = endedAt + AFTER_END_GRACE;', 'const limit = endedAt;'],
  [
    'CRG-13 : réponses après la fin non comptées',
    'server/routes/student.mjs',
    'afterEnd: participant.ended_at ? countAfterEnd(timed.answers, Date.parse(participant.ended_at)) : 0',
    'afterEnd: 0'
  ],
  ['CRG-13 : heure de fin non corrigée', 'server/routes/student.mjs', 'Math.min(finishedAt + timed.offset, now)', 'finishedAt'],
  ['CRG-13 : fini après la fin mal jugé', 'server/launches.mjs', 'Date.parse(p.finished_at) > Date.parse(row.ended_at) + AFTER_END_GRACE', 'true'],
  // Fin du cours : la page de l'élève
  ['CRG-11 : rien ne se fige à la fin', 'src/js/eleve/main.js', 'if (courseEnded && !submission) await closeAtEnd();', ''],
  ['CRG-11 : fiche restée ouverte', 'src/js/eleve/main.js', "if ($('#dlgRead').open) $('#dlgRead').close();", ''],
  ['CRG-11 : placement resté en cours', 'src/js/eleve/main.js', "  S.ui.placing = null;\n  if ($('#dlgRead')", "  if ($('#dlgRead')"],
  ['CRG-11 : figé mais toujours modifiable', 'src/js/eleve/main.js', 'autoClosed: true };\n  S.finished = true;', 'autoClosed: true };'],
  ['CRG-11 : gel non signalé au serveur', 'src/js/eleve/main.js', 'autoClosed: Boolean(autoClosed), ', ''],
  ['CRG-12 : la correction n’arrive pas seule', 'src/js/eleve/main.js', "if (courseEnded && sendState === 'received') await receiveCorrection();", ''],
  ['CRG-08 : page fermée avant la fin corrigée quand même', 'src/js/eleve/main.js', 'if (!session.beforeEnd) return markForErasure(studentId);', ''],
  [
    'CRG-08 : page fermée avant la fin jamais effacée',
    'src/js/eleve/main.js',
    'if (!session.beforeEnd) return markForErasure(studentId);',
    'if (!session.beforeEnd) return;'
  ],
  [
    'CRG-08 : rechargement avant la fin sans correction',
    'src/js/eleve/main.js',
    'session = readSession(me.id) ?? { beforeEnd: false, correction: null };',
    'session = { beforeEnd: false, correction: null };'
  ],
  ['CRG-08 : page ouverte jamais notée', 'src/js/eleve/main.js', '    session.beforeEnd = true;\n', ''],
  ['CRG-08 : correction perdue au rechargement', 'src/js/eleve/main.js', '  session.correction = correction;\n', ''],
  [
    'CRG-08 : jamais marqué à effacer',
    'src/js/eleve/main.js',
    '  await markForErasure(studentId);\n  applyCorrection(correction);',
    '  applyCorrection(correction);'
  ],
  ['CRG-08 : pas de correction relue', 'src/js/eleve/main.js', '    applyCorrection(session.correction);\n', ''],
  ['CRG-08 : onglet encore ouvert effacé', 'src/js/eleve/correction.js', ' && !readSession(student.me.id)', ''],
  ['CRG-08 : nom gardé', 'src/js/eleve/correction.js', '      prefs.del(key);\n', ''],
  ['CRG-08 : réponses gardées', 'src/js/eleve/correction.js', 'Progress.del(`rendu/${me.id}`), ', ''],
  ['CRG-08 : cours gardé', 'src/js/eleve/correction.js', 'Progress.del(`cours/${me.id}`), ', ''],
  ['CRG-08 : marque d’effacement gardée', 'src/js/eleve/correction.js', ', Progress.del(eraseKey(me.id))', ''],
  ['CRG-08 : travail gardé', 'src/js/eleve/correction.js', 'for (const map of course?.maps ?? []) await Progress.del(`${me.id}/${map.id}`);', ''],
  ['CRG-08 : photos gardées', 'src/js/eleve/correction.js', 'await cache?.delete(url);', ''],
  ['CRG-08 : plan d’un autre cours effacé', 'src/js/eleve/correction.js', 'if (!stillUsed.has(url)) ', ''],
  ['CRG-06 : la page continue d’interroger', 'src/js/eleve/main.js', '!S.correction && document.visibilityState', 'document.visibilityState'],
  [
    'CRG-06 : positions réelles non fusionnées',
    'src/js/eleve/correction.js',
    'if (result?.refX !== undefined) Object.assign(fiche, { refX: result.refX, refY: result.refY });',
    ''
  ],
  ['CRG-06 : une seule carte corrigée', 'src/js/eleve/correction.js', 'for (const map of S.project.maps) {', 'for (const map of [S.map]) {'],
  [
    'CRG-06 : pas de bouton pour la correction',
    'src/js/eleve/main.js',
    "$('#seeCorrection')?.addEventListener('click', () => showCorrection(studentNames));",
    ''
  ],
  ['CRG-06 : positions réelles sans légende', 'src/js/eleve/main.js', "$('#legendRef').hidden = !S.correction;", ''],
  ['CRG-06 : titre resté « à placer »', 'src/js/views/student-list.js', "${S.finished ? 'Vos fiches' : 'Fiches à placer'}", 'Fiches à placer'],
  ['CRG-09 : résultat recalculé par l’appareil', 'src/js/store.js', 'if (result) return { ...gradeOf(result.state), ...result };', ''],
  ['CRG-10 : positions réelles dans le compte rendu', 'src/js/report.js', 'const plan = await drawPlan(S.admin);', 'const plan = await drawPlan(true);'],
  [
    'CRG-10 : légende des positions réelles',
    'src/js/report.js',
    "if (S.admin) {\n    legend((cx, cy) => drawTag(ctx, cx, cy, 12, '', TRUTH, 0.45), 'Position réelle');",
    "if (true) {\n    legend((cx, cy) => drawTag(ctx, cx, cy, 12, '', TRUTH, 0.45), 'Position réelle');"
  ],
  ['CRG-10 : pas de compte rendu', 'src/js/eleve/correction.js', "$('#correctionReport').onclick = () => downloadReport(names);", ''],
  ['CRG-13 : aucune heure notée', 'src/js/store.js', 'if (S.stampAnswers) entry.at = Date.now();', ''],
  ['CRG-13 : heure oubliée au rechargement', 'src/js/model.js', 'if (Number.isFinite(e.at)) entry.at = e.at;', ''],
  ['CRG-13 : placement sans heure', 'src/js/views/map.js', 'stamped(Object.assign(entryOf(f, true), { x, y }));', 'Object.assign(entryOf(f, true), { x, y });'],
  ['CRG-13 : mesure sans heure', 'src/js/views/cards.js', 'stamped(entryOf(f, true))[input.dataset.measure]', 'entryOf(f, true)[input.dataset.measure]'],
  ['CRG-13 : page sans heures', 'src/js/eleve/main.js', '  S.stampAnswers = true;\n', ''],
  ['CRG-13 : pas d’heure à l’envoi', 'src/js/eleve/main.js', ', sentAt: Date.now()', ''],
  ['CRG-13 : heure de fin non transmise', 'src/js/eleve/main.js', 'finishedAt: Date.parse(finishedAt), ', ''],
  ['origine : compte rendu sans noms accepté', 'src/js/views/report-actions.js', 'if (!names && !S.admin) {', 'if (false) {'],
  ['origine : noms exigés en gestion', 'src/js/views/report-actions.js', 'if (!names && !S.admin) {', 'if (!names) {'],
  ['origine : compte rendu sans effet', 'src/js/views/report-actions.js', 'if (names !== null) downloadReport(names);', ''],
  ['origine : fichier pour l’enseignant sans noms', 'src/js/views/report-actions.js', '  if (names === null) return;\n', ''],
  ['CRG-10 : positions réelles cachées à l’enseignant', 'src/js/report.js', 'const plan = await drawPlan(S.admin);', 'const plan = await drawPlan(false);'],
  // Fin du cours : ce que voit l'enseignant
  ['CRG-11 : figé non affiché', 'src/js/prof/launch.js', "participant.autoClosed\n    ? 'Figé", "false\n    ? 'Figé"],
  ['CRG-13 : réponses après la fin non affichées', 'src/js/prof/launch.js', 'participant.answersAfterEnd ? `', 'false ? `'],
  ['CRG-13 : avant ou après la fin confondus', 'src/js/prof/launch.js', 'participant.finishedAfterEnd\n', 'true\n'],
  // Hors ligne : la préparation
  ['hors ligne : plan non téléchargé', 'src/js/eleve/offline.js', 'files.add(map.image);', ''],
  ['hors ligne : photos non téléchargées', 'src/js/eleve/offline.js', 'files.add(media.data);', ''],
  ['hors ligne : vidéos préchargées', 'src/js/eleve/offline.js', "if (media.type === 'image') ", ''],
  [
    'hors ligne : une image écrite dans le cours est demandée au réseau',
    'src/js/eleve/offline.js',
    ".filter((url) => url?.startsWith('/media/'))",
    '.filter(Boolean)'
  ],
  ['hors ligne : tout est redemandé à chaque ouverture', 'src/js/eleve/offline.js', 'queue = await missingFiles(cache, files);', 'queue = [...files];'],
  [
    'hors ligne : « Prêt » malgré une image manquante',
    'src/js/eleve/offline.js',
    "failed ? { state: 'incomplete', failed, why } : { state: 'ready' }",
    "{ state: 'ready' }"
  ],
  [
    'hors ligne : « Prêt » avant la fin',
    'src/js/eleve/offline.js',
    'await Promise.all(Array.from({ length: AT_ONCE }, downloader));',
    'Promise.all(Array.from({ length: AT_ONCE }, downloader));'
  ],
  ['hors ligne : pas de décompte', 'src/js/eleve/offline.js', "report({ state: 'downloading', done: ++done, total: files.length });", 'done++;'],
  [
    'hors ligne : installation refusée passée sous silence',
    'src/js/eleve/offline.js',
    "if (refused) return report({ state: 'unavailable', why: refused });",
    ''
  ],
  ['hors ligne : attente sans fin d’une installation', 'src/js/eleve/offline.js', 'setTimeout(() => resolve(false), WORKER_WAIT)', 'void resolve'],
  // Hors ligne : la page élève
  ['hors ligne : cours redemandé au serveur à chaque ouverture', 'src/js/eleve/main.js', 'let course = await keptCourse(me.id);', 'let course = null;'],
  ['hors ligne : cours non gardé', 'src/js/eleve/main.js', 'await Progress.put(courseKey(id), course);', ''],
  [
    'hors ligne : « Prêt » sans copie du cours',
    'src/js/eleve/main.js',
    'kept = await keepCourse(me.id, course);',
    'await keepCourse(me.id, course);\n    kept = true;'
  ],
  ['hors ligne : pas de service worker avant d’entrer', 'src/js/eleve/main.js', 'startWorker();\neraseClosedCourses', 'eraseClosedCourses'],
  [
    'hors ligne : rien ne reprend au retour du réseau',
    'src/js/eleve/main.js',
    "window.addEventListener('online', () => offlineState !== 'ready' && prepare(project));",
    ''
  ],
  ['hors ligne : pas de bouton pour réessayer', 'src/js/eleve/main.js', "$('#netRetry').onclick = () => prepare(S.project);", ''],
  ['hors ligne : envoi affiché alors que rien ne répond', 'src/js/eleve/main.js', "if (submission && sendState === 'sending' && !sending) {", 'if (false) {'],
  ['hors ligne : lecteur vide à la place de la vidéo', 'src/js/views/reader.js', "fig.querySelector('video').onerror", "fig.querySelector('video').onabort"],
  [
    'hors ligne : le nom reste après l’effacement du cours',
    'src/js/eleve/main.js',
    'showBanner(COURSE_GONE);\n  prefs.del(STORAGE_KEY);',
    'showBanner(COURSE_GONE);'
  ],
  // Hors ligne : ce que fournit le serveur
  ['hors ligne : version jamais remplacée', 'server/routes/pages.mjs', "worker.replaceAll('__VERSION__', version)", 'worker'],
  [
    'hors ligne : version remplacée une seule fois',
    'server/routes/pages.mjs',
    "worker.replaceAll('__VERSION__', version)",
    "worker.replace('__VERSION__', version)"
  ],
  ['hors ligne : version sans la page', 'server/routes/pages.mjs', '.update(worker).update(page)', '.update(worker)'],
  ['hors ligne : version sans le service worker', 'server/routes/pages.mjs', '.update(worker).update(page)', '.update(page)'],
  ['hors ligne : service worker gardé en cache', 'server/routes/pages.mjs', "{ 'Cache-Control': 'no-cache' }", "{ 'Cache-Control': 'public, max-age=3600' }"],
  ['hors ligne : fichier absent qui fait une erreur serveur', 'server/routes/pages.mjs', "return send(res, 404, 'Introuvable');", 'throw new Error("absent");'],
  ['HOR-05 : police sans son type', 'server/http.mjs', "  '.woff2': 'font/woff2',\n", ''],
  ['HOR-05 : service worker absent de la construction', 'scripts/build.mjs', "await fs.copyFile(path.join(src, 'sw.js'), path.join(outDir, 'sw.js'));", ''],
  [
    'HOR-05 : polices absentes de la construction',
    'scripts/build.mjs',
    "await fs.cp(path.join(src, 'assets/fonts'), path.join(outDir, 'assets/fonts'), { recursive: true });",
    ''
  ],
  ['HOR-05 : fichier autonome sans ses polices', 'scripts/build.mjs', '<style>\\n${standaloneCss}</style>', '<style>\\n${css}</style>'],
  [
    'HOR-05 : retour des polices de Google',
    'src/index.html',
    '<link rel="stylesheet" href="css/app.css">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces">\n<link rel="stylesheet" href="css/app.css">'
  ],
  [
    'HOR-05 : police retirée de la feuille de style',
    'src/css/app.css',
    '@font-face { font-family: "Fraunces"; font-weight: 500; font-style: italic; font-display: swap; src: url(/assets/fonts/fraunces-italic.woff2) format("woff2"); }\n',
    ''
  ],
  ['COU-04 : pas de consigne pour l’enseignant', 'src/js/prof/launch.js', "el('p', { className: 'hint' }, READY_ADVICE)", "el('p', { className: 'hint' }, '')"],
  [
    'démarrage : une sauvegarde impossible fait tomber le serveur',
    'server/index.mjs',
    "console.error('Sauvegarde de la base impossible :', e.message);",
    'throw e;'
  ]
];

/** Lance les tests. Tout le groupe de processus est tué à la fin : un serveur de test ne doit pas survivre. */
const running = new Set();
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
    running.add(killGroup);
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
      running.delete(killGroup);
      killGroup();
      resolve({ code, out });
    });
  });
}

const args = process.argv.slice(2);
const filter = args.find((arg) => !arg.startsWith('-')) ?? '';
const jobs = Number(args.find((arg) => arg.startsWith('--jobs='))?.slice('--jobs='.length)) || 1;
const verbose = args.includes('-v') || args.includes('--verbose');
// Plusieurs filtres séparés par « | » : pour ne rejouer que les mutants d'une étape
const selected = MUTANTS.filter(([name]) => filter.split('|').some((part) => name.includes(part)));
if (!selected.length) {
  // Sinon, une faute de frappe dans le filtre donnerait « 0/0 attrapés », un succès sans rien de vérifié
  console.error(`Aucun mutant ne correspond à « ${filter} ».`);
  process.exit(1);
}
const source = process.cwd();

function makeCopy() {
  const copy = mkdtempSync(path.join(tmpdir(), 'ib-mutants-'));
  cpSync(source, copy, { recursive: true, filter: (p) => !/(^|\/)(node_modules|\.git|dist|\.dev-data|data)(\/|$)/.test(path.relative(source, p)) });
  mkdirSync(path.join(copy, 'tmp'));
  symlinkSync(path.join(source, 'node_modules'), path.join(copy, 'node_modules'));
  return copy;
}
const copies = Array.from({ length: jobs }, makeCopy);
const removeCopies = () => copies.forEach((copy) => rmSync(copy, { recursive: true, force: true }));

// Les tests tournent dans leur propre groupe de processus : Ctrl+C ne les atteindrait pas, et ils survivraient à la série
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    running.forEach((kill) => kill());
    removeCopies();
    process.exit(130);
  });

const duration = (ms) => {
  const minutes = Math.round(ms / 60000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  return minutes ? `${minutes} min` : `${Math.round(ms / 1000)} s`;
};
const announce = (copy, what) => verbose && console.log(`  ▶ copie ${copies.indexOf(copy) + 1} : ${what}`);

/** Traite la liste avec une copie du projet par essai simultané. */
async function forEachInCopies(items, work) {
  let next = 0;
  await Promise.all(
    copies.map(async (copy) => {
      while (next < items.length) await work(items[next++], copy);
    })
  );
}
/** Les tests utiles à chaque fichier : assez pour attraper un bug, sans relancer toute la suite à chaque fois. */
const TESTS_FOR = {
  'server/auth.mjs': ['accounts', 'password', 'server-start'],
  'server/routes/auth.mjs': ['accounts'],
  'server/routes/admin.mjs': ['accounts', 'courses'],
  'server/routes/courses.mjs': ['courses'],
  'server/routes/pages.mjs': ['offline-site', 'accounts', 'courses', 'launches'],
  'server/courses.mjs': ['courses', 'launches'],
  'server/student-view.mjs': ['student-view', 'launches'],
  'server/launches.mjs': ['launches', 'answers', 'correction'],
  'server/answers.mjs': ['answers', 'correction'],
  'server/routes/launches.mjs': ['launches'],
  'server/routes/student.mjs': ['load', 'launches', 'answers', 'correction'],
  'src/js/prof/qr.js': ['e2e/launches'],
  'src/js/prof/launch.js': ['e2e/offline', 'e2e/launches', 'e2e/correction'],
  'src/js/accueil.js': ['e2e/launches'],
  'src/js/eleve/main.js': ['e2e/offline', 'e2e/launches', 'e2e/incidents', 'e2e/correction'],
  'src/js/eleve/network-icon.js': ['e2e/offline'],
  'src/eleve.html': ['e2e/offline'],
  'src/js/incident.js': ['incidents', 'e2e/incidents', 'e2e/offline'],
  'src/js/main.js': ['e2e/incidents'],
  'src/js/admin/incidents.js': ['e2e/incidents'],
  'server/incidents.mjs': ['incidents'],
  'server/routes/incidents.mjs': ['incidents'],
  'src/js/eleve/correction.js': ['e2e/correction'],
  'src/js/report.js': ['e2e/correction', 'e2e/legacy'],
  'src/js/views/report-actions.js': ['e2e/legacy'],
  'src/js/eleve/offline.js': ['e2e/offline', 'e2e/incidents'],
  'src/sw.js': ['e2e/offline'],
  'src/index.html': ['offline-site', 'e2e/offline'],
  'scripts/build.mjs': ['offline-site', 'build'],
  'src/js/views/cards.js': ['e2e/launches', 'e2e/correction'],
  'src/js/views/student-list.js': ['e2e/launches', 'e2e/correction'],
  'src/js/views/map.js': ['e2e/launches', 'e2e/correction'],
  'src/js/backends/student.js': ['e2e/launches'],
  'src/js/views/fiche.js': ['build', 'e2e/launches'],
  'server/media.mjs': ['courses'],
  'server/security.mjs': ['security', 'accounts', 'routes-legacy'],
  'server/http.mjs': ['http', 'offline-site', 'routes-legacy', 'courses'],
  'server/db.mjs': ['db', 'server-start'],
  'server/migrations/001-initial.sql': ['db'],
  'server/routes/legacy.mjs': ['routes-legacy', 'server'],
  'server/index.mjs': ['server-start'],
  'server/app.mjs': ['server-start', 'courses', 'incidents'],
  'src/js/model.js': ['model', 'e2e/courses', 'e2e/legacy', 'e2e/correction'],
  'src/js/themes.js': ['model', 'e2e/courses'],
  'src/js/views/reader.js': ['wording', 'e2e/offline', 'e2e/launches'],
  'src/prof-cours.html': ['wording', 'e2e/courses'],
  'src/js/spreadsheet.js': ['spreadsheet', 'e2e/courses'],
  'src/js/util.js': ['util', 'e2e/legacy', 'e2e/courses', 'e2e/incidents'],
  'src/js/db.js': ['e2e/legacy'],
  'src/js/store.js': ['e2e/legacy', 'e2e/courses', 'e2e/launches', 'e2e/correction'],
  'src/js/project-io.js': ['e2e/legacy'],
  'src/js/views/editor.js': ['e2e/courses'],
  'src/js/views/admin/fiches.js': ['e2e/courses'],
  'src/js/views/admin/settings.js': ['e2e/courses', 'e2e/legacy'],
  'src/js/views/admin/maps.js': ['e2e/courses', 'e2e/legacy'],
  'src/js/prof/course.js': ['e2e/courses', 'e2e/incidents'],
  'src/js/prof/course-backend.js': ['e2e/courses'],
  'src/js/prof/course-io.js': ['e2e/courses'],
  'src/js/prof/course-tab.js': ['e2e/courses', 'e2e/launches', 'e2e/incidents'],
  'src/js/prof/main.js': ['e2e/courses', 'e2e/launches'],
  'src/js/api.js': ['e2e/courses', 'e2e/incidents'],
  'src/js/ai.js': ['e2e/legacy'],
  'src/js/admin/main.js': ['e2e/accounts', 'e2e/courses', 'e2e/launches', 'e2e/incidents'],
  'src/js/compte/main.js': ['e2e/accounts'],
  'src/js/compte/ui.js': ['e2e/accounts'],
  'src/css/app.css': ['offline-site', 'e2e/accounts', 'e2e/courses', 'e2e/launches', 'e2e/offline']
};
const testsFor = (file) => (TESTS_FOR[file] ?? []).map((name) => `tests/${name}.test.js`);

// Sur du code intact, tout doit passer : sinon chaque modification paraîtrait attrapée, à tort.
const intactFailures = [];
const groups = [...new Set(selected.map(([, file]) => testsFor(file).join(' ')))];
let checked = 0;
console.log(`Contrôle du code intact : ${groups.length} groupe(s) de tests, ${jobs} à la fois`);
await forEachInCopies(groups, async (tests, copy) => {
  announce(copy, tests);
  const start = Date.now();
  const { code, blocked, out } = await runTests(copy, tests.split(' '));
  const passed = code === 0 && !blocked;
  console.log(`  contrôle ${++checked}/${groups.length} ${passed ? 'ok' : 'ÉCHEC'} (${duration(Date.now() - start)}) ${tests}`);
  if (passed) return;
  // Le bilan du lanceur de tests donne la raison de chaque échec, pas seulement son nom
  const details = out.indexOf('✖ failing tests:');
  const cause = blocked ? `délai de ${RUN_TIMEOUT / 60000} min dépassé` : details >= 0 ? out.slice(details, details + 4000) : out.slice(-2000);
  intactFailures.push(`${tests}\n${cause}`);
});
if (intactFailures.length) {
  console.error(`\nLes tests échouent déjà sur le code intact :\n\n${intactFailures.join('\n\n')}\n\nRien n'a été vérifié.`);
  removeCopies();
  process.exit(1);
}

const problems = [];
const seriesStart = Date.now();
let done = 0;
/** Le rang du mutant et, une fois le premier fini, le temps qu'il reste à ce rythme. */
function progress() {
  done++;
  const left = done < selected.length ? ` encore ≈ ${duration(((Date.now() - seriesStart) / done) * (selected.length - done))}` : '';
  return `[${done}/${selected.length}${left}]`;
}
await forEachInCopies(selected, async ([name, file, from, to, everywhere], copy) => {
  const target = path.join(copy, file);
  const original = readFileSync(target, 'utf8');
  if (!original.includes(from)) {
    console.log(`${progress()} INTROUVABLE  ${name}`);
    problems.push(`${name} : texte introuvable dans ${file}`);
    return;
  }
  announce(copy, name);
  writeFileSync(target, everywhere ? original.replaceAll(from, to) : original.replace(from, () => to));
  const { code, blocked, out } = await runTests(copy, testsFor(file), { stopAtFirstFailure: true });
  writeFileSync(target, original);
  const failing = [...new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((match) => match[1]))];
  if (blocked || !failing.length)
    problems.push(`${name} : ${blocked ? 'les tests se bloquent' : code === 0 ? 'aucun test n’échoue' : 'échec sans test identifié'}`);
  // Le nom du test permet de relire un résultat douteux : un mutant doit être attrapé par un test qui le concerne
  console.log(`${progress()} ${failing.length && !blocked ? 'attrapé ' : 'PROBLÈME'} ${name}${failing.length ? ` ← ${failing[0]}` : ''}`);
});
removeCopies();

console.log(`\n${selected.length - problems.length}/${selected.length} attrapés`);
for (const problem of problems) console.log(`✖ ${problem}`);
process.exit(problems.length ? 1 : 0);
