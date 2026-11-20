/**
 * Le dépôt est public : aucune donnée d'utilisateur ne doit y entrer. Les fichiers qui ne sont pas encore commités comptent
 * aussi, pour que le test échoue avant le commit, pas après le push.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
const files = git.status === 0 ? git.stdout.split('\n').filter(Boolean) : null;
// Hors d'un dépôt Git (copie des mutants), il n'y a rien à contrôler
const options = { skip: files ? false : 'pas de dépôt Git ici' };

/** Une capture ou un plan réel se glisse vite dans la documentation : toute nouvelle image passe par cette liste. */
const NEUTRAL_MEDIA = [
  'src/assets/plan-exemple.jpg',
  // Refaites par scripts/captures.mjs, avec des données inventées
  ...[
    'accueil',
    'admin',
    'cours-fiches',
    'cours-publier',
    'eleve-correction',
    'eleve-nom',
    'eleve-placer',
    'eleve-termine',
    'lancement-qr',
    'lancement-suivi',
    'mes-cours',
    'resultats'
  ].map((name) => `docs/images/${name}.png`),
  'docs/images/compte-rendu.jpg'
];

test('SEC-03, DEP-05 : aucun dossier de données, aucune base ni aucun secret dans le dépôt', options, () => {
  assert.deepEqual(
    files.filter((file) => /^(data|\.dev-data)\/|\.(db|sqlite)(-|$)|(^|\/)\.env$/.test(file)),
    []
  );
});

test('les seules images du dépôt sont inventées', options, () => {
  assert.deepEqual(
    files.filter((file) => /\.(jpe?g|png|webp|gif|heic|avif|mp4|webm|mov)$/i.test(file) && !NEUTRAL_MEDIA.includes(file)),
    []
  );
});

test('le guide ne cite que des images qui existent, et chacune de celles qui existent', () => {
  const guide = readFileSync(path.join(ROOT, 'docs/GUIDE.md'), 'utf8');
  const cited = [...new Set([...guide.matchAll(/images\/([\w-]+\.(?:png|jpg))/g)].map(([, name]) => `docs/images/${name}`))].sort();
  assert.deepEqual(cited, NEUTRAL_MEDIA.filter((file) => file.startsWith('docs/images/')).sort());
  for (const file of cited) assert.ok(existsSync(path.join(ROOT, file)), file);
});

/**
 * Exigences héritées de l'application d'origine, sans test qui les nomme. Elles décrivent surtout des écrans que la version 2.0.0
 * réécrit : chaque étape leur donne leur test et les retire d'ici. La liste ne fait que raccourcir (QUA-05).
 */
const INHERITED = [
  ...['LIS-03', 'LIS-04', 'LIS-05'],
  ...['CON-03', 'CON-05', 'CON-06'],
  ...['MES-05'],
  ...['PLA-02', 'PLA-03', 'PLA-04', 'PLA-05', 'PLA-06', 'PLA-07'],
  ...['FIC-01', 'FIC-02', 'FIC-03', 'FIC-06', 'FIC-07', 'FIC-08'],
  ...['EDI-04', 'EDI-07', 'EDI-08', 'EDI-09', 'EDI-11'],
  ...['POS-01', 'POS-02', 'POS-04'],
  ...['TAB-02', 'TAB-04', 'TAB-07', 'TAB-08'],
  ...['CAR-03', 'CAR-06'],
  ...['APP-01', 'APP-02', 'APP-04'],
  ...['DEP-02', 'DEP-03'],
  ...['STO-02'],
  ...['COM-04', 'COM-05'],
  ...['INT-01', 'INT-02', 'INT-03', 'INT-04', 'INT-05', 'INT-06']
];
// Des règles de travail : elles se vérifient à la revue, et par npm run test:coverage lui-même, pas par un test
const METHOD = ['QUA-01', 'QUA-02', 'QUA-04', 'QUA-06', 'QUA-07'];

const testTitles = () =>
  readdirSync(import.meta.dirname, { recursive: true })
    .filter((file) => file.endsWith('.test.js'))
    .flatMap((file) => [...readFileSync(path.join(import.meta.dirname, file), 'utf8').matchAll(/\btest\(\s*[`'"](.*)/g)].map(([, title]) => title))
    .join('\n');

/** Les exigences en place sur le site : sections 4 à 8. Un identifiant retiré garde son ancien texte entre guillemets (12.9). */
function siteRequirements() {
  const cahier = readFileSync(path.join(ROOT, 'docs/CAHIER_DES_CHARGES.md'), 'utf8');
  const section = cahier.slice(cahier.indexOf('## 4. Espace élèves'), cahier.indexOf('## 9. Règles de calcul'));
  return [...section.matchAll(/^- \*\*([A-Z]{2,4}-\d{2})\*\* (?!«)/gm)].map(([, id]) => id);
}

test('QUA-05 : chaque exigence des sections 4 à 8 du cahier a au moins un test qui la cite dans son titre', () => {
  const required = siteRequirements();
  assert.ok(required.length > 150, 'la recherche trouve bien les exigences');
  const titles = testTitles();
  assert.deepEqual(
    required.filter((id) => !METHOD.includes(id) && !INHERITED.includes(id) && !titles.includes(id)),
    []
  );
});

test('QUA-05 : la liste des exigences héritées sans test ne garde que des exigences en place, et aucune qui a trouvé son test', () => {
  const required = siteRequirements();
  const titles = testTitles();
  assert.deepEqual(
    INHERITED.filter((id) => !required.includes(id)),
    [],
    'retirée du cahier : à enlever de la liste'
  );
  assert.deepEqual(
    INHERITED.filter((id) => titles.includes(id)),
    [],
    'un test la cite désormais : à enlever de la liste'
  );
});

test('SRV-01 : le site ne dépend d’aucun paquet à l’exécution, et demande Node 24', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.engines.node, '>=24');
  assert.match(readFileSync(path.join(ROOT, '.nvmrc'), 'utf8'), /^24\b/);
});

test('DEP-04 : l’image se construit en deux temps, et la seconde ne sert que le résultat, sans outils de développement', () => {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const stages = dockerfile.split(/^FROM /m).slice(1);
  assert.equal(stages.length, 2);
  assert.match(stages[0], /npm ci/);
  assert.match(stages[0], /npm run build/);
  assert.match(stages[1], /^node:24-alpine/);
  assert.doesNotMatch(stages[1], /\bnpm\b|node_modules/);
  assert.match(stages[1], /COPY --from=build \/app\/dist/);
  assert.match(stages[1], /VOLUME \["\/data"\]/);
});

test('DEP-06 : le conteneur tourne sans être root, sans port publié, sur le réseau du proxy, et ses secrets viennent du .env', () => {
  const compose = readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /^\s+user: "1001:1001"/m);
  assert.doesNotMatch(compose, /^\s+ports:/m, 'aucun port publié');
  assert.match(compose, /^\s+- traefik_network$/m);
  assert.match(compose, /traefik_network:\s+external: true/);
  for (const name of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'TRUST_PROXY']) assert.match(compose, new RegExp(`${name}: \\$\\{${name}:-\\}`), name);
  assert.ok(existsSync(path.join(ROOT, '.env.example')));
});

test('QUA-03 : npm run dev sert src/ sans construction, et garde ses données dans .dev-data/', () => {
  const { dev } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  assert.match(dev, /--root src\b/);
  assert.match(dev, /--data \.dev-data\b/);
});

test('Q-07 : package.json annonce la licence du fichier LICENSE', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3,/);
  assert.equal(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).license, 'GPL-3.0-only');
  assert.equal(JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages[''].license, 'GPL-3.0-only');
});

test('Git ignore les données, les bases, les secrets et les notes de travail', () => {
  const ignored = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n');
  for (const entry of ['data/', '.dev-data/', '.env', '*.db', '*.sqlite', 'docs/FEUILLE_DE_ROUTE.md']) assert.ok(ignored.includes(entry), entry);
});

test('le dépôt public ne décrit ni les personnes ni le serveur', options, () => {
  assert.deepEqual(
    files.filter((file) => /FEUILLE_DE_ROUTE/.test(file)),
    []
  );
  // Écrit en deux morceaux, pour que ce fichier-ci reste propre lui aussi
  const domain = ['giau', 'fer'].join('');
  const forbidden = new RegExp(`/home/\\w+|${domain}|\\b[Pp]ère\\b|gmail\\.com`);
  for (const file of files.filter(
    (name) => /\.(md|js|mjs|html|css|yml|sql|json)$/.test(name) && !name.includes('vendor/') && existsSync(path.join(ROOT, name))
  )) {
    assert.doesNotMatch(readFileSync(path.join(ROOT, file), 'utf8'), forbidden, file);
  }
});
