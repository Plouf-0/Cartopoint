/**
 * Le hors ligne, sur les pages construites comme en production : une page servie depuis src/ charge ses modules un par un, et seul le
 * mode de développement fait ainsi. Couper le réseau, ici, c'est couper le navigateur et arrêter le serveur pour de bon :
 * le mode hors ligne de Playwright ne couvre pas tout ce que fait un service worker.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addAccount, cheapHash, tempDir } from '../helpers.js';
import { ENGINE, heading, launchBrowser, logIn, makePng, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const NAMES = 'Léa Dupont';
const READY = '✓ Prêt pour le terrain';
const PLAN = makePng(40, 20);
const PHOTO_1 = makePng(30, 30);
const PHOTO_2 = makePng(20, 30);
const PHOTO_3 = makePng(10, 30);
const MP4 = Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1');
const REF_X = 12.3456;
const VERSION = 'essai-1';
const { version: NUMBER } = JSON.parse(await readFile('package.json', 'utf8'));
const label = (commit) => `version ${NUMBER} (${commit})`;

let browser;
let dist;
before(async () => {
  browser = await launchBrowser();
  dist = await mkdtemp(path.join(tmpdir(), 'ib-dist-'));
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', dist], { encoding: 'utf8', env: { ...process.env, APP_VERSION: VERSION } });
  assert.equal(build.status, 0, build.stderr);
});
after(async () => {
  await browser.close();
  await rm(dist, { recursive: true, force: true });
});

/** Une copie du site, pour un essai qui change ses fichiers. */
async function ownCopy(t) {
  const root = await tempDir(t);
  await cp(dist, root, { recursive: true });
  return root;
}

async function setup(t, { root = dist } = {}) {
  const site = await startSite(t, { root });
  addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const teacher = await openPage(t, browser, { base: site.base });
  await logIn(teacher, TEACHER, '/prof');
  await heading(teacher, 'Mes cours');
  // Le serveur voit aussi ce que demande un service worker, contrairement à Playwright
  site.requests = [];
  site.app.server.prependListener('request', (req) => site.requests.push(req.url));
  return { site, teacher };
}

const upload = (teacher, buffer, type = 'image/png') =>
  teacher.evaluate(
    async ({ base64, type }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const response = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': type }, body: bytes });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).url;
    },
    { base64: buffer.toString('base64'), type }
  );

const photo = (id, url) => ({ id, type: 'image', name: `${id}.png`, data: url });
const fiche = (id, common, media) => ({ id, common, visible: true, refX: REF_X, refY: 65.4321, media });

async function publish(teacher, draft) {
  return teacher.evaluate(async (draft) => {
    const send = async (url, body) => {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const course = await send('/api/courses', { draft });
    return send(`/api/courses/${course.id}/publish`, { revision: course.revision });
  }, draft);
}

async function launch(teacher, course) {
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.getByRole('button', { name: 'Lancer le cours' }).click();
  await teacher.getByRole('heading', { name: 'Pour rejoindre le cours' }).waitFor();
  return (await teacher.locator('.launch-code').first().textContent()).trim();
}

/** Un plan et trois photos, dont une que l'on ne voit qu'en ouvrant la fiche. Plus une fiche masquée, qui ne doit pas partir. */
async function fieldCourse(teacher, title = 'Sortie au parc') {
  const [plan, first, second, third] = await Promise.all([PLAN, PHOTO_1, PHOTO_2, PHOTO_3].map((file) => upload(teacher, file)));
  return publish(teacher, {
    format: 'inventaire-botanique',
    version: 3,
    title,
    theme: {},
    maps: [
      {
        id: 'm1',
        name: 'Parc',
        image: plan,
        fiches: [
          fiche('f1', 'Noisetier', [photo('p1', first), photo('p3', third)]),
          fiche('f2', 'Laurier', [photo('p2', second)]),
          { ...fiche('secret', 'Fiche masquée', []), visible: false }
        ]
      }
    ]
  });
}

const offlineStatus = (page, text) => page.locator('#offlineStatus', { hasText: text }).waitFor({ timeout: 15000 });

/** Note tout ce que la ligne d'état affiche, dès le prochain chargement de la page. On le lit dans window.statuses. */
const watchStatuses = (page) =>
  page.addInitScript(() => {
    window.statuses = [];
    document.addEventListener('DOMContentLoaded', () => {
      const line = document.querySelector('#offlineStatus');
      new MutationObserver(() => window.statuses.push(line.textContent)).observe(line, { childList: true, characterData: true, subtree: true });
    });
  });

/** Attend le service worker sans s'y bloquer : s'il ne vient jamais, le test doit échouer, et dire pourquoi. */
const workerInstalled = (page) =>
  page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 10000))]));

async function enter(page, code, names = NAMES) {
  await page.goto(`/c/${code}`);
  await page.getByLabel(/Votre prénom et votre nom/).fill(names);
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.locator('.label').first().waitFor();
}

/** Un élève entré, dont la page a fini de se préparer. */
async function fieldStudent(t, site, code) {
  const page = await openPage(t, browser, { base: site.base });
  await enter(page, code);
  await offlineStatus(page, READY);
  return page;
}

/**
 * Les fichiers du cours sont servis pour un an : le cache HTTP du navigateur les resservirait sans que le service worker y soit pour
 * rien. Un téléphone peut le vider à tout moment : seul ce que garde le service worker doit compter.
 */
async function forgetHttpCache(page) {
  if (ENGINE !== 'chromium') return;
  const session = await page.context().newCDPSession(page);
  await session.send('Network.clearBrowserCache');
  await session.detach();
}

async function cutNetwork(site, page) {
  await page.context().setOffline(true);
  await new Promise((resolve) => {
    site.app.server.close(resolve);
    site.app.server.closeAllConnections();
  });
  await forgetHttpCache(page);
}

async function restoreNetwork(site, page) {
  await new Promise((resolve) => site.app.server.listen(new URL(site.base).port, '127.0.0.1', resolve));
  await page.context().setOffline(false);
}

const naturalWidth = (page, selector) =>
  page
    .locator(selector)
    .first()
    .evaluate(async (image) => {
      await image.decode();
      return image.naturalWidth;
    });

async function placeFirstFiche(page) {
  await page.locator('[data-place]').first().click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  await page.waitForTimeout(400);
}

async function finish(page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
}

const footer = (page, text) => page.locator('.panel-foot').getByText(text).waitFor();
const participant = (site, names = NAMES) => site.db.prepare('SELECT * FROM participants WHERE names = ?').get(names);

/** Toutes les adresses gardées dans le navigateur, par cache. */
const cachedUrls = (page) =>
  page.evaluate(async () => {
    const result = {};
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys();
      result[name] = keys.map((request) => new URL(request.url).pathname);
    }
    return result;
  });
const pageCaches = (urls) => Object.keys(urls).filter((name) => name.startsWith('cartopoint-page-'));
const mediaFile = (site, url) => path.join(site.data, url);
const loadedFonts = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family.replaceAll('"', ''));
  });

/* --- HOR-01 : recharger sans réseau --- */

test('HOR-01 : une fois « Prêt pour le terrain » affiché, la page recharge sans aucun réseau, avec le plan, les photos et les polices', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await cutNetwork(site, page);

  await page.reload();
  await page.locator('.label').first().waitFor();
  assert.equal(await page.locator('#pageTitle').textContent(), 'Sortie au parc');
  assert.equal(await page.locator('.label').count(), 2);
  assert.equal(await naturalWidth(page, '#plan'), 40);
  assert.equal(await naturalWidth(page, '.label img'), 30);
  assert.ok((await loadedFonts(page)).includes('Atkinson Hyperlegible'), 'la police du site, sans réseau');
  await offlineStatus(page, READY);
  assert.equal(await page.locator('#studentName').textContent(), NAMES);
});

test('HOR-01 : sans réseau et sans recharger, une photo encore jamais affichée s’ouvre quand même', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await cutNetwork(site, page);

  await page.locator('.label', { hasText: 'Noisetier' }).locator('h3').click();
  await page.locator('#readGallery img').waitFor();
  assert.equal(await naturalWidth(page, '#readGallery img'), 10);
});

test('HOR-02, HOR-03 : sans réseau, l’élève place une fiche, ferme la page et la retrouve', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await cutNetwork(site, page);
  await page.reload();
  await page.locator('.label').first().waitFor();

  await placeFirstFiche(page);
  await page.locator('[data-measure="temperature"]').first().fill('21');
  await page.waitForTimeout(400);
  await page.goto('about:blank');
  await page.goto(`${site.base}/c/${code}`);

  await page.locator('.pin').first().waitFor();
  assert.equal(await page.locator('[data-measure="temperature"]').first().inputValue(), '21');
});

test('HOR-04 : terminer sans réseau, fermer la page, rouvrir sans réseau : tout est figé, et les réponses partent au retour du réseau', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await placeFirstFiche(page);
  await cutNetwork(site, page);

  await finish(page);
  await footer(page, 'Vos réponses restent sur cet appareil');
  await page.goto('about:blank');
  await page.goto(`${site.base}/c/${code}`);
  await footer(page, 'Vos réponses restent sur cet appareil');
  assert.equal(await page.locator('[data-place]').count(), 0, 'toujours figé');
  assert.equal(participant(site).submitted_at, null);

  await restoreNetwork(site, page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await footer(page, 'Vos réponses sont bien arrivées');
  assert.ok(participant(site).submitted_at);
  assert.equal(typeof JSON.parse(participant(site).answers).m1.f1.x, 'number');
});

test('HOR-04 : le téléphone se croit en ligne alors que rien ne répond : la page ne prétend pas envoyer', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await finish(page);
  await footer(page, 'Vos réponses sont bien arrivées');

  // Le navigateur reste « en ligne » : seul le serveur est coupé
  await new Promise((resolve) => {
    site.app.server.close(resolve);
    site.app.server.closeAllConnections();
  });
  await page.reload();
  await footer(page, 'Vos réponses restent sur cet appareil');
  assert.equal(await page.evaluate(() => navigator.onLine), true);
});

test('CRG-12 : sans réseau à la fin du cours, la page continue et recharge ; au retour du réseau, tout part et la correction arrive', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await page.context().setOffline(true);
  await forgetHttpCache(page);
  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();

  await page.reload();
  await page.locator('.label').first().waitFor();
  await placeFirstFiche(page);
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 0, 'la page ne sait encore rien');

  await page.context().setOffline(false);
  await page.locator('#seeCorrection').waitFor({ timeout: 25000 });
  assert.equal(participant(site).auto_closed, 1);
  assert.equal(typeof JSON.parse(participant(site).answers).m1.f1.x, 'number');
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 2);
  await page.reload();
  await page.locator('#seeCorrection').waitFor();
});

test('CRG-11 : figé à la fin du cours, puis plus de réseau : le rechargement garde le gel, et les réponses partent au retour', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await placeFirstFiche(page);
  await page.route('**/api/student/answers', (route) => route.abort());
  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await footer(page, 'Vos réponses restent sur cet appareil');

  await page.context().setOffline(true);
  await forgetHttpCache(page);
  await page.reload();
  await footer(page, 'Vos réponses restent sur cet appareil');
  assert.equal(await page.locator('[data-place]').count(), 0, 'toujours figé');

  await page.unroute('**/api/student/answers');
  await page.context().setOffline(false);
  await page.locator('#seeCorrection').waitFor({ timeout: 25000 });
  assert.equal(participant(site).auto_closed, 1);
  assert.equal(typeof JSON.parse(participant(site).answers).m1.f1.x, 'number');
});

test('une page qui n’a pas encore de cours, sans réseau, dit pourquoi au lieu de rester blanche', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base });
  await page.goto(`/c/${code}`);
  await page.getByLabel(/Votre prénom et votre nom/).waitFor();
  assert.ok(await workerInstalled(page), 'le service worker s’installe dès la page d’entrée, avant le nom');
  await cutNetwork(site, page);

  await page.reload();
  await page.getByRole('heading', { name: 'Impossible de rejoindre ce cours' }).waitFor();
  await page.getByText('Le serveur ne répond pas').waitFor();
  await page.getByRole('link', { name: 'Réessayer' }).waitFor();
});

test('entré, mais le cours n’a pas pu arriver : la page le dit, et Réessayer le récupère', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base });
  await page.route('**/api/student/course', (route) => route.abort());
  await page.goto(`/c/${code}`);
  await page.getByLabel(/Votre prénom et votre nom/).fill(NAMES);
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.getByText('Le serveur ne répond pas').waitFor();

  await page.unroute('**/api/student/course');
  await page.getByRole('link', { name: 'Réessayer' }).click();
  await offlineStatus(page, READY);
  assert.equal(await page.locator('.label').count(), 2);
});

/* --- Ce que la page garde, et comment elle le montre --- */

test('« Prêt pour le terrain » n’arrive qu’une fois tout téléchargé, après un décompte visible', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base });
  await watchStatuses(page);
  await enter(page, code);
  await offlineStatus(page, READY);
  await page.waitForTimeout(300);

  const statuses = await page.evaluate(() => window.statuses);
  assert.match(statuses[0], /^Téléchargement pour le terrain…/);
  assert.ok(statuses.includes('Téléchargement pour le terrain… 4 / 4'), statuses.join(' | '));
  assert.match(statuses.at(-1), /^✓ Prêt pour le terrain/);
  assert.equal(statuses.filter((status) => status.startsWith('✓')).length, 1, 'rien ne s’affiche après');
  assert.equal((await cachedUrls(page))['cartopoint-media'].length, 4, 'le plan et les trois photos');
});

test('rouvrir la page ne redemande ni le cours, ni les fichiers déjà gardés', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await forgetHttpCache(page);
  site.requests.length = 0;

  await page.reload();
  await offlineStatus(page, READY);
  await naturalWidth(page, '#plan');
  await page.waitForTimeout(300);
  assert.deepEqual(
    site.requests.filter((url) => url.startsWith('/media/') || url === '/api/student/course'),
    []
  );
  assert.ok(!site.requests.some((url) => url.startsWith(`/c/${code}`)), 'la page aussi vient de l’appareil');
});

test('il manque un seul fichier à la réouverture : seul celui-là est repris, et le décompte repart de ce qui est gardé', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  const [removed] = (await cachedUrls(page))['cartopoint-media'];
  await page.evaluate(async (url) => (await caches.open('cartopoint-media')).delete(url), removed);
  await watchStatuses(page);

  await page.reload();
  await offlineStatus(page, READY);
  await page.waitForTimeout(300);
  const statuses = await page.evaluate(() => window.statuses);
  assert.ok(statuses.includes('Téléchargement pour le terrain… 3 / 4'), statuses.join(' | '));
  assert.ok(!statuses.includes('Téléchargement pour le terrain… 1 / 4'), statuses.join(' | '));
  const kept = (await cachedUrls(page))['cartopoint-media'];
  assert.equal(kept.length, 4);
  assert.ok(kept.includes(removed));
});

test('une image qui manque : le message le dit, « Prêt » n’apparaît pas, et Réessayer finit le travail', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await fieldCourse(teacher);
  const code = await launch(teacher, course);
  const missing = await publishedPlan(teacher, course);
  await rename(mediaFile(site, missing), mediaFile(site, missing) + '.absent');

  const page = await openPage(t, browser, { base: site.base });
  await enter(page, code);
  await offlineStatus(page, '⚠ Téléchargement incomplet : 1 image(s)');
  assert.equal(await page.locator('#offlineStatus', { hasText: READY }).count(), 0);

  await rename(mediaFile(site, missing) + '.absent', mediaFile(site, missing));
  await page.locator('#netRetry').click();
  await offlineStatus(page, READY);
  assert.equal(await page.locator('#netRetry').isVisible(), false, 'plus rien à réessayer');
});

async function publishedPlan(teacher, course) {
  const draft = await teacher.evaluate(async (id) => (await (await fetch(`/api/courses/${id}`)).json()).draft, course.id);
  return draft.maps[0].image;
}

test('le retour du réseau reprend un téléchargement incomplet, de lui-même', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await fieldCourse(teacher);
  const code = await launch(teacher, course);
  const missing = await publishedPlan(teacher, course);
  await rename(mediaFile(site, missing), mediaFile(site, missing) + '.absent');
  const page = await openPage(t, browser, { base: site.base });
  await enter(page, code);
  await offlineStatus(page, '⚠ Téléchargement incomplet');

  await rename(mediaFile(site, missing) + '.absent', mediaFile(site, missing));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await offlineStatus(page, READY);
});

test('HOR-11 : une vidéo ne se précharge pas, et sans réseau la fiche l’explique', async (t) => {
  const { site, teacher } = await setup(t);
  const [plan, picture, video] = [await upload(teacher, PLAN), await upload(teacher, PHOTO_1), await upload(teacher, MP4, 'video/mp4')];
  const course = await publish(teacher, {
    format: 'inventaire-botanique',
    version: 3,
    title: 'Avec une vidéo',
    theme: {},
    maps: [
      {
        id: 'm1',
        name: 'Parc',
        image: plan,
        fiches: [fiche('f1', 'Noisetier', [photo('p1', picture), { id: 'v1', type: 'video', name: 'v.mp4', data: video }])]
      }
    ]
  });
  const code = await launch(teacher, course);
  const page = await fieldStudent(t, site, code);
  assert.deepEqual((await cachedUrls(page))['cartopoint-media'].sort(), [plan, picture].sort());
  assert.ok(!site.requests.includes(video), 'pas demandée tant que la fiche n’est pas ouverte');

  await cutNetwork(site, page);
  await page.locator('.label', { hasText: 'Noisetier' }).locator('h3').click();
  await page.locator('#readGallery').getByText('les vidéos ne sont pas gardées').waitFor();
  assert.equal(await page.locator('#readGallery video').count(), 0);
});

test('une image déjà écrite dans une ancienne version du cours n’a rien à télécharger', async (t) => {
  const { site, teacher } = await setup(t);
  const inline = 'data:image/png;base64,' + PLAN.toString('base64');
  const draft = { format: 'inventaire-botanique', version: 3, title: 'Sans fichier', theme: {} };
  const course = await publish(teacher, { ...draft, maps: [{ id: 'm1', name: 'Parc', image: '', fiches: [fiche('f1', 'Noisetier', [])] }] });
  // Le serveur refuse désormais ce contenu (COU-14) : il ne peut venir que d'une version publiée avant cette règle
  const old = { ...draft, maps: [{ id: 'm1', name: 'Parc', image: inline, fiches: [fiche('f1', 'Noisetier', [photo('p1', inline)])] }] };
  site.db.prepare('UPDATE course_versions SET content = ?').run(JSON.stringify(old));
  const page = await fieldStudent(t, site, await launch(teacher, course));
  assert.deepEqual((await cachedUrls(page))['cartopoint-media'], []);
});

test('COU-09 : deux cours sur le même appareil gardent chacun leur contenu et leur travail, sans réseau', async (t) => {
  const { site, teacher } = await setup(t);
  const first = await launch(teacher, await fieldCourse(teacher, 'Premier cours'));
  const second = await launch(teacher, await fieldCourse(teacher, 'Second cours'));
  const page = await fieldStudent(t, site, first);
  await placeFirstFiche(page);
  await enter(page, second, 'Tom Martin');
  await offlineStatus(page, READY);
  await cutNetwork(site, page);

  await page.reload();
  await page.locator('#pageTitle', { hasText: 'Second cours' }).waitFor();
  assert.equal(await page.locator('.pin').count(), 0);
  await page.goto(`${site.base}/c/${first}`);
  await page.locator('#pageTitle', { hasText: 'Premier cours' }).waitFor();
  assert.equal(await page.locator('#studentName').textContent(), NAMES);
  await page.locator('.pin').first().waitFor();
});

test('« Ce n’est pas vous ? » : le suivant a sa propre copie, et travaille aussi sans réseau', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await placeFirstFiche(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: "Ce n'est pas vous ?" }).click();
  await page.getByLabel(/Votre prénom et votre nom/).fill('Tom Martin');
  await page.getByRole('button', { name: 'Commencer' }).click();
  await offlineStatus(page, READY);
  await cutNetwork(site, page);

  await page.reload();
  await page.locator('#studentName', { hasText: 'Tom Martin' }).waitFor();
  assert.equal(await page.locator('.pin').count(), 0, 'pas le travail de l’élève précédent');
});

/* --- Rien de ce que le serveur répond à un élève ne reste dans un cache --- */

test('le service worker laisse /api/ tranquille, en lecture comme en écriture, et n’en garde rien', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'la page passe bien par lui');

  // Playwright ne voit pas ce qu'un service worker prend en charge
  const seen = [];
  await page.route('**/api/student/**', (route) => {
    seen.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fallback();
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await finish(page);
  await footer(page, 'Vos réponses sont bien arrivées');
  assert.ok(seen.includes('GET /api/student/state'), seen.join(' | '));
  assert.ok(seen.includes('PUT /api/student/answers'), seen.join(' | '));

  const urls = Object.values(await cachedUrls(page)).flat();
  assert.ok(urls.length > 5);
  assert.deepEqual(
    urls.filter((url) => !/^(\/media\/|\/assets\/fonts\/|\/c\/page$)/.test(url)),
    []
  );

  await cutNetwork(site, page);
  const answer = await page.evaluate(() =>
    fetch('/api/student/state').then(
      (response) => response.status,
      () => 'aucune réponse'
    )
  );
  assert.equal(answer, 'aucune réponse');
});

test('CRG-01 : la copie du cours gardée sur l’appareil ne contient ni position réelle, ni fiche masquée', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  const kept = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('inventaire-botanique');
        open.onsuccess = () => {
          const all = open.result.transaction('progress').objectStore('progress').getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve(JSON.stringify(all.result));
          };
        };
      })
  );
  assert.match(kept, /Sortie au parc/, 'la recherche porte bien sur la copie');
  assert.doesNotMatch(kept, new RegExp(`refX|refY|${REF_X}|Fiche masquée|passwordHash`));
});

test('un envoi vers /c/ n’est jamais remplacé par la page gardée : il arrive au serveur', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  const writes = [];
  site.app.server.prependListener('request', (req) => req.method !== 'GET' && writes.push(`${req.method} ${req.url}`));

  const navigated = page.waitForEvent('framenavigated');
  await page.evaluate((code) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/c/${code}`;
    document.body.append(form);
    form.submit();
  }, code);
  await navigated;
  assert.deepEqual(writes, [`POST /c/${code}`]);
});

/* --- Quand le navigateur ne peut pas --- */

const UNSUPPORTED = {
  'sans service worker': () => delete Navigator.prototype.serviceWorker,
  'avec une installation refusée': () => (ServiceWorkerContainer.prototype.register = () => Promise.reject(new Error('refusé'))),
  'sans stockage du tout': () => {
    IDBFactory.prototype.open = () => {
      throw new Error('refusé');
    };
  },
  'quand le cours ne peut pas être écrit': () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (String(key).startsWith('cours/')) throw new Error('refusé');
      return put.call(this, value, key);
    };
  }
};

for (const [kind, init] of Object.entries(UNSUPPORTED))
  test(`${kind}, l’élève travaille quand même, et sait qu’il ne doit pas quitter le réseau`, async (t) => {
    const { site, teacher } = await setup(t);
    const code = await launch(teacher, await fieldCourse(teacher));
    const page = await openPage(t, browser, { base: site.base });
    await page.addInitScript(init);
    await enter(page, code);
    await offlineStatus(page, '⚠ Ce navigateur ne gardera pas le cours sans réseau');
    assert.equal(await page.locator('#offlineStatus', { hasText: READY }).count(), 0);
    assert.equal(await naturalWidth(page, '#plan'), 40);
  });

test('une installation qui n’aboutit jamais ne laisse pas l’élève croire que tout va bien', async (t) => {
  const root = await ownCopy(t);
  await rm(path.join(root, 'assets/fonts/fraunces.woff2'));
  const { site, teacher } = await setup(t, { root });
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base });
  await page.clock.install();
  await enter(page, code);
  await offlineStatus(page, 'Téléchargement pour le terrain');
  // Le délai ne commence qu'une fois l'installation demandée : on avance jusqu'à ce qu'il soit passé
  const warning = page.locator('#offlineStatus', { hasText: '⚠ Ce navigateur ne gardera pas le cours sans réseau' });
  for (let tries = 0; tries < 20 && !(await warning.count()); tries++) {
    await page.clock.fastForward(21000);
    await page.waitForTimeout(200);
  }
  await warning.waitFor();
});

/* --- Mises à jour --- */

/** Répond où en est la mise à jour : « installed » veut dire qu'elle attend, et qu'elle attendra tant que la page reste ouverte. */
async function updateWorker(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    const installing = registration.installing;
    if (!installing) return 'aucune mise à jour';
    await Promise.race([
      new Promise((resolve) => installing.addEventListener('statechange', () => ['activated', 'redundant'].includes(installing.state) && resolve())),
      new Promise((resolve) => setTimeout(resolve, 10000))
    ]);
    return installing.state;
  });
}

test('une nouvelle version remplace l’ancienne chez l’élève, sans perdre ses photos, et marche ensuite sans réseau', async (t) => {
  const root = await ownCopy(t);
  const { site, teacher } = await setup(t, { root });
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  const before = await cachedUrls(page);
  assert.equal(pageCaches(before).length, 1);
  assert.equal(await updateWorker(page), 'aucune mise à jour', 'rien ne change tant que la page ne change pas');

  assert.equal(await appVersion(page), label(VERSION));
  const pageFile = path.join(root, 'eleve.html');
  await writeFile(
    pageFile,
    (await readFile(pageFile, 'utf8')).replace('<title>', '<meta name="version-essai" content="2"><title>').replaceAll(VERSION, 'essai-2')
  );
  assert.equal(await updateWorker(page), 'activated');
  assert.equal(await appVersion(page), label(VERSION), 'la page ouverte reste ce qu’elle est, et le dit');

  const after = await cachedUrls(page);
  assert.equal(pageCaches(after).length, 1, 'l’ancienne page n’encombre plus le téléphone');
  assert.notEqual(pageCaches(after)[0], pageCaches(before)[0]);
  assert.deepEqual(after['cartopoint-media'], before['cartopoint-media']);

  await cutNetwork(site, page);
  await page.reload();
  await page.locator('.label').first().waitFor();
  assert.equal(await page.locator('meta[name="version-essai"]').count(), 1);
  assert.equal(await naturalWidth(page, '#plan'), 40);
  assert.equal(await appVersion(page), label('essai-2'), 'la version gardée sur l’appareil, sans réseau');
});

test('une mise à jour qui échoue laisse la version précédente en place, utilisable sans réseau', async (t) => {
  const root = await ownCopy(t);
  const { site, teacher } = await setup(t, { root });
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  const before = await cachedUrls(page);

  const pageFile = path.join(root, 'eleve.html');
  await writeFile(pageFile, (await readFile(pageFile, 'utf8')).replace('<title>', '<meta name="version-essai" content="2"><title>'));
  await rm(path.join(root, 'assets/fonts/fraunces.woff2'));
  assert.equal(await updateWorker(page), 'redundant');

  await cutNetwork(site, page);
  await page.reload();
  await page.locator('.label').first().waitFor();
  assert.equal(await page.locator('meta[name="version-essai"]').count(), 0, 'toujours l’ancienne page');
  assert.ok(pageCaches(await cachedUrls(page)).includes(pageCaches(before)[0]));
});

/* --- Le reste du site n'est pas concerné --- */

test('le service worker ne s’occupe que de /c/ : ni l’accueil, ni les pages des enseignants', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await page.goto('/');
  await page.locator('input').first().waitFor();
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null);
  await page.goto('/prof');
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null);
  assert.equal(await teacher.evaluate(() => navigator.serviceWorker.getRegistrations().then((list) => list.length)), 0);

  await cutNetwork(site, page);
  // Chromium seul : Firefox peut encore la resservir de son cache HTTP, qu'on ne sait vider que dans Chromium
  if (ENGINE === 'chromium') await assert.rejects(page.goto('/'), /ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED/);
});

test('la page de l’enseignant demande d’attendre le message que l’élève voit vraiment', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  await teacher.getByRole('button', { name: 'Afficher le QR code' }).click();
  await teacher.locator('dialog[open]').getByText(`« ${READY} »`).waitFor();
  const page = await fieldStudent(t, site, code);
  await page.locator('#toast', { hasText: READY }).waitFor();
});

/* --- HOR-10 : l'icône du réseau --- */

const netIcon = (page) => page.locator('#netButton');
const netInfo = (page) => page.locator('#netInfo');
const iconLooks = (page, className) => page.locator(`#netButton.${className}`).waitFor();

test('HOR-10 : plus de bandeau : une icône, et le détail d’un appui dessus', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await page.mouse.move(0, 0);

  await iconLooks(page, 'ready');
  assert.equal(await page.locator('#netBadge').textContent(), '✓');
  assert.equal(await netInfo(page).isVisible(), false, 'rien d’ouvert tant que tout va bien');
  const status = await page.locator('#offlineStatus').boundingBox();
  assert.ok(status.height <= 1, 'le texte reste pour les lecteurs d’écran, sans occuper de place');
  assert.match(await netIcon(page).getAttribute('aria-label'), /^En ligne\. ✓ Prêt pour le terrain/);
  const box = await netIcon(page).boundingBox();
  assert.ok(box.width >= 40 && box.height >= 40, 'assez grande pour un doigt');

  await netIcon(page).focus();
  await page.keyboard.press('Enter');
  await netInfo(page).getByText('Prêt pour le terrain').waitFor();
  assert.equal(await netIcon(page).getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await netInfo(page).waitFor({ state: 'hidden' });
  assert.equal(await netIcon(page).getAttribute('aria-expanded'), 'false');
});

test('HOR-10 : au doigt, un appui ouvre le détail, un autre le ferme, et un appui ailleurs aussi', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base, touch: true, viewport: { width: 390, height: 780 } });
  await enter(page, code);
  await offlineStatus(page, READY);
  assert.equal(await netInfo(page).isVisible(), false);

  await netIcon(page).tap();
  await netInfo(page).getByText('En ligne').waitFor();
  await netInfo(page).getByText('Prêt pour le terrain').waitFor();
  await netIcon(page).tap();
  await netInfo(page).waitFor({ state: 'hidden' });

  await netIcon(page).tap();
  await netInfo(page).waitFor();
  await page.locator('#pageTitle').tap();
  await netInfo(page).waitFor({ state: 'hidden' });
});

test('HOR-10 : à la souris, passer sur l’icône suffit', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await page.mouse.move(0, 0);
  await netInfo(page).waitFor({ state: 'hidden' });
  await netIcon(page).hover();
  await netInfo(page).waitFor();
  await page.mouse.move(0, 0);
  await netInfo(page).waitFor({ state: 'hidden' });
});

test('HOR-10 : « prêt » s’annonce par un message qui repart', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await page.locator('#toast.show', { hasText: READY }).waitFor();
  await page.locator('#toast.show').waitFor({ state: 'detached', timeout: 6000 });
});

test('HOR-10 : l’icône suit le réseau, dans les deux sens, et rassure une fois hors ligne', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await iconLooks(page, 'ready');
  assert.equal(await page.locator('#netButton.offline').count(), 0);

  await page.context().setOffline(true);
  await iconLooks(page, 'offline');
  assert.equal(await page.locator('#netBadge').textContent(), '✓', 'hors ligne, mais le cours est là');
  assert.match(await netIcon(page).getAttribute('aria-label'), /^Hors ligne\./);
  assert.equal(await netInfo(page).isVisible(), false, 'rien d’alarmant : l’icône suffit');
  await netIcon(page).click();
  await netInfo(page).getByText('Hors ligne').waitFor();
  await netInfo(page).getByText('Vos réponses partiront au retour du réseau').waitFor();

  await page.context().setOffline(false);
  await page.locator('#netButton:not(.offline)').waitFor();
  await netInfo(page).getByText('En ligne').waitFor();
  assert.equal(await netInfo(page).getByText('Vos réponses partiront').count(), 0);
});

test('HOR-10 : le téléphone se croit en ligne alors que rien ne répond : l’icône dit la vérité, puis se rétablit', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await new Promise((resolve) => {
    site.app.server.close(resolve);
    site.app.server.closeAllConnections();
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await iconLooks(page, 'offline');
  assert.equal(await page.evaluate(() => navigator.onLine), true);

  await new Promise((resolve) => site.app.server.listen(new URL(site.base).port, '127.0.0.1', resolve));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#netButton:not(.offline)').waitFor();
});

test('HOR-10 : un refus du serveur n’est pas une coupure : l’icône reste en ligne', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  site.db.exec('DELETE FROM participants');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page
    .locator('#courseBanner', { hasText: 'n’existe plus' })
    .or(page.locator('#courseBanner', { hasText: "n'existe plus" }))
    .waitFor();
  assert.equal(await page.locator('#netButton.offline').count(), 0);
});

test('HOR-10 : ce qui demande d’agir s’ouvre de soi-même, avant de quitter le réseau', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await fieldCourse(teacher);
  const code = await launch(teacher, course);
  const missing = await publishedPlan(teacher, course);
  await rename(mediaFile(site, missing), mediaFile(site, missing) + '.absent');
  const page = await openPage(t, browser, { base: site.base });
  await enter(page, code);
  await netInfo(page).getByText('Téléchargement incomplet').waitFor();
  await iconLooks(page, 'warning');
  assert.equal(await page.locator('#netBadge').textContent(), '!');

  await rename(mediaFile(site, missing) + '.absent', mediaFile(site, missing));
  await page.locator('#netRetry').click();
  await offlineStatus(page, READY);
  await iconLooks(page, 'ready');
  await page.mouse.move(0, 0);
  await netInfo(page).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#netButton.warning').count(), 0);
});

/** Fait passer un contrôle de l'état, comme la page toutes les 20 secondes, et attend qu'il soit traité. */
async function nextCheck(page) {
  const checked = page.waitForResponse('**/api/student/state');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await checked;
  await page.waitForTimeout(150);
}

test('HOR-10 : une alerte fermée par l’élève ne se rouvre pas à chaque contrôle', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await fieldCourse(teacher);
  const code = await launch(teacher, course);
  const missing = await publishedPlan(teacher, course);
  await rename(mediaFile(site, missing), mediaFile(site, missing) + '.absent');
  const page = await openPage(t, browser, { base: site.base });
  await enter(page, code);
  await netInfo(page).getByText('Téléchargement incomplet').waitFor();
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await netInfo(page).waitFor({ state: 'hidden' });

  await nextCheck(page);
  assert.equal(await netInfo(page).isVisible(), false, 'l’icône reste là pour y revenir');
  await iconLooks(page, 'warning');
});

test('HOR-10 : le détail ouvert par l’élève ne se referme pas tout seul à chaque contrôle', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await fieldStudent(t, site, code);
  await netIcon(page).click();
  await page.mouse.move(0, 0);
  await netInfo(page).waitFor();

  await nextCheck(page);
  assert.equal(await netInfo(page).isVisible(), true);
});

test('sur un téléphone, un nom long ne casse pas l’en-tête : le titre garde sa largeur, et le détail du réseau reste à l’écran', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base, touch: true, viewport: { width: 375, height: 700 } });
  await enter(page, code, 'Léa Dupont-Martin de la Fontaine');
  await offlineStatus(page, READY);
  const title = await page.locator('#pageTitle').boundingBox();
  assert.ok(title.height < 40, `le titre tient sur une ligne, pas sur ${title.height} px de haut`);
  await netIcon(page).tap();
  await netInfo(page).waitFor();
  const button = await netIcon(page).boundingBox();
  assert.ok(button.x + button.width > 320, 'l’icône reste à droite');
  const info = await netInfo(page).boundingBox();
  assert.ok(info.x >= 0 && info.x + info.width <= 375, `détail de ${info.x} à ${info.x + info.width} px`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
});

test('sur un petit téléphone, le détail du réseau et son bouton tiennent dans la largeur', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await fieldCourse(teacher);
  const code = await launch(teacher, course);
  const missing = await publishedPlan(teacher, course);
  await rename(mediaFile(site, missing), mediaFile(site, missing) + '.absent');
  const page = await openPage(t, browser, { base: site.base, viewport: { width: 320, height: 640 } });
  await enter(page, code);
  await offlineStatus(page, '⚠ Téléchargement incomplet');
  await page.locator('#netRetry').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  for (const selector of ['#netInfo', '#netRetry', '#netButton']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 320, `${selector} : de ${box.x} à ${box.x + box.width} px`);
  }
});

/* --- EV-42 : la version --- */

const appVersion = (page) => page.locator('#appVersion').textContent();

test('EV-42 : chaque page dit sa version, en bas de l’écran', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await fieldCourse(teacher);
  const code = await launch(teacher, course);
  const page = await openPage(t, browser, { base: site.base });
  for (const address of ['/', '/admin', '/invitation', `/c/${code}`]) {
    await page.goto(address);
    await page.locator('#appVersion').waitFor();
    assert.equal(await appVersion(page), label(VERSION), address);
  }
  for (const address of ['/prof', `/prof/cours/${course.id}`]) {
    await teacher.goto(address);
    assert.equal(await appVersion(teacher), label(VERSION), address);
  }
});

test('EV-42 : le fichier autonome dit aussi sa version', async (t) => {
  const page = await openPage(t, browser, {});
  await page.goto('file://' + path.join(dist, 'secours.html'));
  await page.locator('#modeBtn').waitFor();
  assert.equal(await appVersion(page), label(VERSION));
});

test('EV-42 : sur un téléphone, la version reste à l’écran, sans déborder ni empêcher d’appuyer sur ce qu’elle recouvre', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base, touch: true, viewport: { width: 320, height: 568 } });
  await enter(page, code);
  const box = await page.locator('#appVersion').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 320 && box.y + box.height <= 568, JSON.stringify(box));
  assert.ok(box.width < 160 && box.height < 24, 'discrète');
  const underneath = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  assert.notEqual(underneath, 'appVersion');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
});

/* --- HOR-05 : aucun service tiers --- */

test('HOR-05 : aucune page ne demande quoi que ce soit à un autre site, et toutes ont leur police', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await fieldCourse(teacher));
  const page = await openPage(t, browser, { base: site.base });
  const elsewhere = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(site.base) && !/^(data|blob):/.test(request.url())) elsewhere.push(request.url());
  });
  for (const address of ['/', '/prof', '/admin', '/invitation', `/c/${code}`]) {
    await page.goto(address);
    assert.ok((await loadedFonts(page)).includes('Atkinson Hyperlegible'), address);
  }
  assert.deepEqual(elsewhere, []);
});

test('INC-01 : le fichier autonome, sans serveur, ne signale rien à personne', async (t) => {
  const page = await openPage(t, browser, { expectErrors: true });
  const reports = [];
  page.on('request', (request) => {
    if (request.url().includes('incidents')) reports.push(request.url());
  });
  await page.goto('file://' + path.join(dist, 'secours.html'));
  await page.locator('#modeBtn').waitFor();
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = "throw new Error('panne sans serveur')";
    document.head.append(script);
  });
  await page.waitForTimeout(300);
  assert.deepEqual(reports, []);
  // Le navigateur refuse tout envoi vers file:// avant même de le tenter : seule la file d'attente le montrerait
  assert.equal(await page.evaluate(() => localStorage.getItem('cartopoint.incidents')), null);
});

test('HOR-05 : le fichier autonome, ouvert d’un double-clic, a ses polices sans aucun serveur', async (t) => {
  const page = await openPage(t, browser, {});
  const elsewhere = [];
  page.on('request', (request) => {
    if (!/^(file|data|blob):/.test(request.url())) elsewhere.push(request.url());
  });
  await page.goto('file://' + path.join(dist, 'secours.html'));
  await page.locator('#modeBtn').waitFor();
  assert.ok((await loadedFonts(page)).includes('Atkinson Hyperlegible'));
  assert.deepEqual(elsewhere, []);
});
