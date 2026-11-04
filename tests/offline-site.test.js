/**
 * Ce que le serveur et la construction fournissent au hors ligne : le service worker et sa version, les polices et leurs licences.
 * Le comportement dans le navigateur est dans tests/e2e/offline.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startApp, tempDir } from './helpers.js';

const ROOT = path.join(import.meta.dirname, '..');
const FONTS_DIR = path.join(ROOT, 'src/assets/fonts');
const fontFiles = readdirSync(FONTS_DIR).filter((file) => file.endsWith('.woff2'));
// Le mot figure aussi dans un commentaire avant le code, comme dans le vrai fichier
const WORKER = '// le serveur remplace __VERSION__\nconst PAGE_CACHE = `cartopoint-page-__VERSION__`;';

async function siteWithWorker(t, page = '<h1>page</h1>') {
  const root = await tempDir(t);
  await writeFile(path.join(root, 'sw.js'), WORKER);
  await writeFile(path.join(root, 'eleve.html'), page);
  const { base } = await startApp(t, { root });
  return { root, base };
}

const versionIn = (text) => text.match(/cartopoint-page-([0-9a-f]{16})/)?.[1];

test('le service worker est servi à l’adresse qui lui donne la portée /c/, en JavaScript, et toujours revalidé', async (t) => {
  const { base } = await siteWithWorker(t);
  const response = await fetch(`${base}/c/sw.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/javascript/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const text = await response.text();
  assert.ok(text.includes(`const PAGE_CACHE = \`cartopoint-page-${versionIn(text)}\``), text);
  assert.doesNotMatch(text, /__VERSION__/);
});

test('sa version ne change que si la page ou lui-même changent : c’est ce qui déclenche la mise à jour chez les élèves', async (t) => {
  const { root, base } = await siteWithWorker(t);
  const read = async () => versionIn(await (await fetch(`${base}/c/sw.js`)).text());
  const first = await read();
  assert.equal(await read(), first);

  await writeFile(path.join(root, 'eleve.html'), '<h1>autre page</h1>');
  const second = await read();
  assert.notEqual(second, first);

  await writeFile(path.join(root, 'sw.js'), WORKER + '\n// autre');
  assert.notEqual(await read(), second);
});

test('sans service worker ou sans page, l’adresse répond 404, sans faire tomber le serveur', async (t) => {
  const { root, base } = await siteWithWorker(t);
  await rm(path.join(root, 'sw.js'));
  assert.equal((await fetch(`${base}/c/sw.js`)).status, 404);
  await writeFile(path.join(root, 'sw.js'), WORKER);
  await rm(path.join(root, 'eleve.html'));
  assert.equal((await fetch(`${base}/c/sw.js`)).status, 404);
});

test('sw.js n’est pas pris pour un code, et la page gardée par le service worker existe bien', async (t) => {
  const { base } = await siteWithWorker(t);
  assert.match(await (await fetch(`${base}/c/sw.js`)).text(), /cartopoint-page-/);
  const page = await fetch(`${base}/c/page`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<h1>page<\/h1>/);
  assert.match(await (await fetch(`${base}/c/ABCDEF`)).text(), /<h1>page<\/h1>/);
});

test('HOR-05 : une police est servie avec son type', async (t) => {
  const root = await tempDir(t);
  await mkdir(path.join(root, 'assets/fonts'), { recursive: true });
  await writeFile(path.join(root, 'assets/fonts/essai.woff2'), Buffer.from('wOF2'));
  const { base } = await startApp(t, { root });
  const response = await fetch(`${base}/assets/fonts/essai.woff2`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
});

test('HOR-05 : chaque police du dossier est un vrai WOFF2, citée par la feuille de style et gardée par le service worker', () => {
  const css = readFileSync(path.join(ROOT, 'src/css/app.css'), 'utf8');
  const worker = readFileSync(path.join(ROOT, 'src/sw.js'), 'utf8');
  assert.equal(fontFiles.length, 5);
  for (const file of fontFiles) {
    assert.equal(readFileSync(path.join(FONTS_DIR, file)).subarray(0, 4).toString('latin1'), 'wOF2', file);
    assert.ok(css.includes(`url(/assets/fonts/${file})`), `feuille de style : ${file}`);
    assert.ok(worker.includes(`'/assets/fonts/${file}'`), `service worker : ${file}`);
  }
  const cited = (text) => [...text.matchAll(/\/assets\/fonts\/([\w-]+\.woff2)/g)].map((match) => match[1]).sort();
  assert.deepEqual(cited(css), [...fontFiles].sort(), 'aucune police citée sans exister');
  assert.deepEqual(cited(worker), [...fontFiles].sort());
});

test('la licence de chaque famille de polices accompagne ses fichiers', () => {
  for (const [file, author] of [
    ['OFL-atkinson-hyperlegible.txt', 'Braille Institute'],
    ['OFL-fraunces.txt', 'The Fraunces Project Authors']
  ]) {
    const license = readFileSync(path.join(FONTS_DIR, file), 'utf8');
    assert.match(license, /SIL OPEN FONT LICENSE/i, file);
    assert.ok(license.includes(author), file);
  }
});

test('la construction fournit le service worker et les polices ; aucune page ne cite Google, et le fichier autonome contient ses polices', async (t) => {
  const out = await tempDir(t);
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  assert.equal(readFileSync(path.join(out, 'sw.js'), 'utf8'), readFileSync(path.join(ROOT, 'src/sw.js'), 'utf8'));
  assert.deepEqual(
    readdirSync(path.join(out, 'assets/fonts'))
      .filter((file) => file.endsWith('.woff2'))
      .sort(),
    [...fontFiles].sort()
  );
  assert.ok(
    readdirSync(path.join(out, 'assets/fonts')).some((file) => file.startsWith('OFL-')),
    'les licences aussi'
  );

  const pages = readdirSync(out).filter((file) => file.endsWith('.html'));
  assert.ok(pages.length >= 8);
  for (const page of pages) assert.doesNotMatch(readFileSync(path.join(out, page), 'utf8'), /fonts\.(googleapis|gstatic)\.com/, page);

  const standalone = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(standalone, /\/assets\/fonts\//, 'un fichier ouvert d’un double-clic n’a pas de serveur');
  assert.equal(standalone.match(/data:font\/woff2;base64,/g)?.length, 5);
  const student = readFileSync(path.join(out, 'eleve.html'), 'utf8');
  assert.match(student, /\/assets\/fonts\//);
  assert.doesNotMatch(student, /data:font\//, 'chaque élève ne télécharge pas les polices dans chaque page');
});

test('aucune source ne cite plus les polices de Google', () => {
  const sources = readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter((file) => /\.(html|css|js)$/.test(file));
  assert.ok(sources.length > 20);
  for (const file of sources) assert.doesNotMatch(readFileSync(path.join(ROOT, 'src', file), 'utf8'), /fonts\.(googleapis|gstatic)\.com/, file);
});
