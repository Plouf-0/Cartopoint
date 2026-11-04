/**
 * EXP : le fichier de secours d'un cours. Un seul fichier, ouvert d'un double-clic, sans serveur ni réseau : c'est ce qu'il reste si le site est en panne un jour de sortie.
 * Ces tests tournent sur les pages construites : c'est là que le fichier existe.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addAccount, cheapHash, tempDir } from '../helpers.js';
import { heading, launchBrowser, logIn, makePng, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const PASSWORD = 'secret-du-prof';
const SECRET = 'Fiche-masquée-MARQUEUR';
const REF = { x: 50, y: 50 };

let browser;
let dist;
before(async () => {
  browser = await launchBrowser();
  dist = await mkdtemp(path.join(tmpdir(), 'ib-dist-'));
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', dist], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
});
after(async () => {
  await browser.close();
  await rm(dist, { recursive: true, force: true });
});

async function setup(t, { root = dist, title = 'Sortie au parc' } = {}) {
  const site = await startSite(t, { root });
  addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const teacher = await openPage(t, browser, { base: site.base });
  await logIn(teacher, TEACHER, '/prof');
  await heading(teacher, 'Mes cours');
  const course = await teacher.evaluate(
    async ({ plan, photo, title, ref, secret }) => {
      const upload = async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        return (await (await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes })).json()).url;
      };
      const [planUrl, photoUrl] = await Promise.all([upload(plan), upload(photo)]);
      const fiche = (id, common, extra) => ({ id, common, visible: true, refX: ref.x, refY: ref.y, media: [], ...extra });
      const draft = {
        format: 'inventaire-botanique',
        version: 3,
        title,
        theme: {},
        maps: [
          {
            id: 'm1',
            name: 'Parc',
            image: planUrl,
            fiches: [
              fiche('f1', 'Noisetier', { media: [{ id: 'p1', type: 'image', name: 'p.png', data: photoUrl }] }),
              fiche('f2', 'Sureau', { refX: 5, refY: 5 }),
              fiche('cachee', secret, { visible: false })
            ]
          }
        ]
      };
      const response = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }) });
      return response.json();
    },
    { plan: makePng(100, 100).toString('base64'), photo: makePng(30, 30).toString('base64'), title, ref: REF, secret: SECRET }
  );
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  return { site, teacher, course };
}

const field = (page) => page.locator('#fallbackPassword');

async function downloadFile(t, teacher, password = PASSWORD) {
  await teacher.locator('#exportFallback').click();
  await field(teacher).fill(password);
  const file = teacher.waitForEvent('download');
  await teacher.locator('dialog[open]').getByRole('button', { name: 'Télécharger' }).click();
  const download = await file;
  const target = path.join(await tempDir(t), download.suggestedFilename());
  await download.saveAs(target);
  return { name: download.suggestedFilename(), target, text: await readFile(target, 'utf8') };
}

/** Comme chez quelqu'un qui a reçu le fichier : pas de réseau, et rien n'a le droit de sortir. */
async function openOffline(t, target) {
  const page = await openPage(t, browser, {});
  const outside = [];
  page.on('request', (request) => {
    if (!/^(file|data|blob):/.test(request.url())) outside.push(request.url());
  });
  await page.context().setOffline(true);
  await page.goto('file://' + target);
  await page.locator('.label').first().waitFor();
  return { page, outside };
}

test('EXP-01, EXP-03 : l’enseignant télécharge un seul fichier, qui emporte le plan et les photos ; les fiches masquées restent ici', async (t) => {
  const { teacher } = await setup(t);
  const { name, text } = await downloadFile(t, teacher);
  assert.equal(name, 'Sortie au parc - secours.html');
  await teacher.locator('#toast', { hasText: '✓ Fichier de secours téléchargé' }).waitFor();
  assert.doesNotMatch(text, /\/media\//, 'rien qui dépende du serveur');
  assert.match(text, /data:image\/png;base64,/);
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /secret-du-prof/, 'le mot de passe n’y est pas en clair');
});

test('EXP-01, EXP-02 : sans serveur ni réseau, on lit, on place, on se corrige et on télécharge son compte rendu', async (t) => {
  const { teacher } = await setup(t);
  const { target } = await downloadFile(t, teacher);
  const { page, outside } = await openOffline(t, target);

  assert.equal(await page.locator('#pageTitle').textContent(), 'Sortie au parc');
  assert.equal(await page.locator('.label').count(), 2, 'sans la fiche masquée');
  await page.waitForFunction(() => document.querySelector('.label img')?.naturalWidth === 30);
  await page.waitForFunction(() => document.querySelector('#plan')?.naturalWidth === 100);
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 0, 'les positions réelles restent cachées jusqu’à la vérification');

  await page.locator('#studentNames').fill('Léa Dupont');
  await page.locator('[data-place]').first().click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#verifyBtn').click();
  const results = page.locator('#dlgResults[open]');
  await results.locator('tr', { hasText: 'Noisetier' }).getByText('Bien placée').waitFor();
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 2, 'EXP-02 : c’est la page qui corrige');

  const file = page.waitForEvent('download');
  await page.locator('#resReport').click();
  assert.equal((await file).suggestedFilename(), 'Compte rendu - Léa Dupont.jpg');
  assert.deepEqual(outside, [], 'rien n’est sorti de l’appareil');
});

test('EXP-01 : sans réseau, le travail reste après un rechargement', async (t) => {
  const { teacher } = await setup(t);
  const { target } = await downloadFile(t, teacher);
  const { page } = await openOffline(t, target);
  await page.locator('[data-place]').first().click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  await page.waitForTimeout(500);
  await page.reload();
  await page.locator('.pin').first().waitFor();
});

test('E-03, EXP-04 : le mode gestion demande le mot de passe choisi ; ni « admin » ni un autre n’ouvrent', async (t) => {
  const { teacher } = await setup(t);
  const { target } = await downloadFile(t, teacher);
  const { page } = await openOffline(t, target);
  const tryPassword = async (password) => {
    await page.locator('#loginPw').fill(password);
    await page.locator('#loginForm button[type=submit]').click();
  };
  await page.locator('#modeBtn').click();
  await tryPassword('admin');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#newFiche').isVisible(), false, 'pas le mot de passe par défaut');
  await tryPassword('autre-chose');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#newFiche').isVisible(), false);
  await tryPassword(PASSWORD);
  await page.locator('#newFiche').waitFor();
});

test('E-03, EXP-04 : un mot de passe trop court est refusé, et renoncer ne télécharge rien', async (t) => {
  const { teacher } = await setup(t);
  let downloads = 0;
  teacher.on('download', () => downloads++);
  await teacher.locator('#exportFallback').click();
  const dialog = teacher.locator('dialog[open]');
  await field(teacher).fill('abc');
  await dialog.getByRole('button', { name: 'Télécharger' }).click();
  await dialog.getByText('4 caractères au moins.').waitFor();
  assert.equal(await field(teacher).getAttribute('type'), 'password', 'il ne s’affiche pas en clair');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await teacher.locator('#fallbackPassword').waitFor({ state: 'detached' });

  await teacher.locator('#exportFallback').click();
  await teacher.keyboard.press('Escape');
  await teacher.locator('#fallbackPassword').waitFor({ state: 'detached' });
  await teacher.waitForTimeout(200);
  assert.equal(downloads, 0);
});

test('EXP-01 : un titre piégé ne casse pas le fichier', async (t) => {
  const title = 'Cours </script><script>window.piege=1</script>';
  const { teacher } = await setup(t, { title });
  const { target } = await downloadFile(t, teacher);
  const { page } = await openOffline(t, target);
  assert.equal(await page.locator('#pageTitle').textContent(), title);
  assert.equal(await page.evaluate(() => window.piege), undefined);
});

test('EXP-01 : un fichier disparu du serveur, ou une base manquante, le disent au lieu de donner un fichier incomplet', async (t) => {
  const root = await tempDir(t);
  await cp(dist, root, { recursive: true });
  const { teacher } = await setup(t, { root });
  let downloads = 0;
  teacher.on('download', () => downloads++);
  await rm(path.join(root, 'secours.html'));
  await teacher.locator('#exportFallback').click();
  await field(teacher).fill(PASSWORD);
  await teacher.locator('dialog[open]').getByRole('button', { name: 'Télécharger' }).click();
  await teacher.locator('#toast', { hasText: '⚠ Fichier de secours impossible : fichier de secours indisponible sur ce serveur (404)' }).waitFor();
  assert.equal(downloads, 0);
});

test('EXP-03 : déposé sur un site, le fichier de secours ne lit aucune configuration ni aucun projet en ligne', async (t) => {
  const { site } = await setup(t);
  const page = await openPage(t, browser, { base: site.base });
  const asked = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await page.goto('/secours.html?projet=essai');
  await page.locator('#modeBtn').waitFor();
  await page.waitForTimeout(300);
  assert.deepEqual(
    asked.filter((address) => /config\.json|project\.json|projets\//.test(address)),
    []
  );
});
