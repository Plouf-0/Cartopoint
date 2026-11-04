/**
 * Le dépôt est public : aucune donnée d'utilisateur ne doit y entrer. Les fichiers qui ne sont pas encore commités comptent
 * aussi, pour que le test échoue avant le commit, pas après le push.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

test('aucun dossier de données, aucune base ni aucun secret dans le dépôt', options, () => {
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

test('Git ignore les données, les bases et les secrets', () => {
  const ignored = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n');
  for (const entry of ['data/', '.dev-data/', '.env', '*.db', '*.sqlite']) assert.ok(ignored.includes(entry), entry);
});
