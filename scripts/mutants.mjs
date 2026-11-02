#!/usr/bin/env node
/**
 * Vérifie que les tests attrapent les bugs : casse le code exprès, une modification à la fois, sur
 * une copie du projet, et contrôle qu'au moins un test échoue (QUA-08).
 *
 *   npm run test:mutants            toutes les modifications (plusieurs minutes)
 *   npm run test:mutants -- E-04    seulement celles dont le nom contient « E-04 »
 *
 * Une modification que les tests ne remarquent pas « survit » : il manque alors un test. Le script
 * échoue aussi si un texte à remplacer a disparu du code, pour que cette liste reste à jour, ou si
 * les tests se bloquent au lieu d'échouer. Ajouter ici chaque comportement sensible.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RUN_TIMEOUT = 180000;

// [nom, fichier, texte à remplacer, remplacement]
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
  ['démarrage : pas de sauvegarde quotidienne', 'server/index.mjs', '  dailyBackup();\n', ''],
  [
    'démarrage : une sauvegarde impossible fait tomber le serveur',
    'server/index.mjs',
    "console.error('Sauvegarde de la base impossible :', e.message);",
    'throw e;'
  ]
];

/** Lance les tests. Tout le groupe de processus est tué à la fin : un serveur de test ne doit pas survivre. */
function runTests(cwd, tests) {
  return new Promise((resolve) => {
    let out = '';
    // Dossiers temporaires dans la copie : un test tué n'a pas le temps de ranger les siens
    const env = { ...process.env, TMPDIR: path.join(cwd, 'tmp') };
    const child = spawn(process.execPath, ['--test', ...tests], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* déjà terminé */
      }
    };
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
const tests = readdirSync(path.join(copy, 'tests'))
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => 'tests/' + name);

const problems = [];
for (const [name, file, from, to] of selected) {
  const target = path.join(copy, file);
  const original = readFileSync(target, 'utf8');
  if (!original.includes(from)) {
    console.log(`INTROUVABLE  ${name}`);
    problems.push(`${name} : texte introuvable dans ${file}`);
    continue;
  }
  writeFileSync(
    target,
    original.replace(from, () => to)
  );
  const { code, blocked, out } = await runTests(copy, tests);
  writeFileSync(target, original);
  const failing = new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((match) => match[1])).size;
  if (blocked || !failing) problems.push(`${name} : ${blocked ? 'les tests se bloquent' : code === 0 ? 'aucun test n’échoue' : 'échec sans test identifié'}`);
  console.log(`${failing && !blocked ? 'attrapé     ' : 'PROBLÈME    '} ${name} (${failing} test(s) en échec)`);
}
rmSync(copy, { recursive: true, force: true });

console.log(`\n${selected.length - problems.length}/${selected.length} attrapés`);
for (const problem of problems) console.log(`✖ ${problem}`);
process.exit(problems.length ? 1 : 0);
