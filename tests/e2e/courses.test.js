/**
 * L'espace enseignant, de bout en bout, dans Chromium : créer un cours, le remplir, le publier, l'importer et
 * l'exporter, et ce que voit l'enseignant quand quelque chose échoue.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addAccount, cheapHash, tempDir } from '../helpers.js';
import { ADMIN, heading, launchBrowser, logIn, makePng, openPage, see, startSite } from './helpers.js';
import { makeXlsx } from './xlsx-file.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const HASH = cheapHash(TEACHER.password);
const PNG = makePng(40, 20);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');
const MP4 = Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1');

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

async function setup(t, options) {
  const site = await startSite(t);
  const accountId = addAccount(site.db, { email: TEACHER.email, hash: HASH });
  const page = await openPage(t, browser, { base: site.base, ...options });
  await logIn(page, TEACHER, '/prof');
  await heading(page, 'Mes cours');
  return { site, page, accountId };
}

const draftInDb = (site, id) => JSON.parse(site.db.prepare('SELECT draft FROM courses WHERE id = ?').get(id).draft);
const onlyCourse = (site) => site.db.prepare('SELECT * FROM courses').get();
const answerDialogs = (page, ...answers) => {
  const received = [];
  const handler = async (dialog) => {
    received.push(dialog.message());
    const answer = answers.shift();
    if (answer === false) await dialog.dismiss();
    else await dialog.accept(answer === true ? undefined : answer);
  };
  page.on('dialog', handler);
  return received;
};

async function createCourse(page, title = 'Sortie au parc') {
  await page.getByLabel('Nom du nouveau cours').fill(title);
  await page.getByRole('button', { name: 'Créer le cours' }).click();
  await page.locator('#planChoose').waitFor();
}

async function choosePlan(page) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#planChoose').click();
  await (await chooser).setFiles({ name: 'plan.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#plan[src^="/media/"]').waitFor();
}

async function addFiche(page, name, { photo = false } = {}) {
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill(name);
  if (photo) {
    await page.locator('#eFiles').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await page.locator('#eGallery img[src^="/media/"]').waitFor();
  }
  await page.locator('#eSave').click();
  await page.locator('#dlgEdit').waitFor({ state: 'hidden' });
}

/** Compte les vidéos lues en base64 : sur un téléphone, une longue vidéo suffirait à faire tomber l'onglet. */
async function watchVideoReads(page) {
  const watch = () => {
    window.videoReads = 0;
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      if (blob.type.startsWith('video/')) window.videoReads++;
      return read.call(this, blob);
    };
  };
  await page.addInitScript(watch);
  await page.evaluate(watch);
}
const videoReads = (page) => page.evaluate(() => window.videoReads);

const saved = (page) => page.locator('#saveState', { hasText: '✓ Enregistré' }).waitFor();
const tab = (page, name) => page.getByRole('tab', { name }).click();

async function placeOnPlan(page, name) {
  await page.locator('.row', { hasText: name }).locator('[data-place-ref]').click();
  // Loin du bandeau d'aide, affiché en haut du plan
  const frame = page.locator('#mapFrame');
  const box = await frame.boundingBox();
  await frame.click({ position: { x: box.width * 0.3, y: box.height * 0.8 } });
  await page.locator('.pin.ref').first().waitFor();
}

/* --- ENS-02 : créer et remplir un cours --- */

test('ENS-02 : créer un cours, y ajouter un plan, des fiches et des photos, et tout retrouver après un rechargement', async (t) => {
  const { site, page } = await setup(t);
  await see(page, 'Aucun cours pour le moment.');
  await createCourse(page);
  await page.locator('#pageTitle', { hasText: 'Sortie au parc' }).waitFor();
  assert.match(new URL(page.url()).pathname, /^\/prof\/cours\/[\w-]+$/);
  await see(page, "Cette carte n'a pas encore d'image du plan.");

  await choosePlan(page);
  assert.equal(await page.locator('#planEmpty').isVisible(), false);
  await addFiche(page, 'Olivier', { photo: true });
  await placeOnPlan(page, 'Olivier');
  await saved(page);

  const course = onlyCourse(site);
  const draft = draftInDb(site, course.id);
  assert.match(draft.maps[0].image, /^\/media\/[0-9a-f]{64}\.png$/);
  const fiche = draft.maps[0].fiches[0];
  assert.equal(fiche.common, 'Olivier');
  assert.match(fiche.media[0].data, /^\/media\/[0-9a-f]{64}\.png$/);
  assert.equal(typeof fiche.refX, 'number');
  assert.doesNotMatch(course.draft, /data:/, 'LEG-02 : aucune photo dans le contenu du cours');

  await page.reload();
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();
  await page.locator('#plan[src^="/media/"]').waitFor();
  await page.locator('.pin.ref').waitFor();
  await page.locator('.row img.photo[src^="/media/"]').waitFor();
});

test('ENS-02 : modifier une fiche, retirer sa photo et la supprimer s’enregistrent aussi', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await addFiche(page, 'Olivier', { photo: true });
  await saved(page);
  const id = onlyCourse(site).id;

  await page.locator('[data-edit]').click();
  await page.locator('#eCommon').fill('Olivier de Bohême');
  await page.locator('[data-media-del]').click();
  await page.locator('#eGallery .empty-box').waitFor();
  await page.locator('#eSave').click();
  await page.locator('.row', { hasText: 'Olivier de Bohême' }).waitFor();
  await saved(page);
  assert.equal(draftInDb(site, id).maps[0].fiches[0].common, 'Olivier de Bohême');
  assert.deepEqual(draftInDb(site, id).maps[0].fiches[0].media, []);

  answerDialogs(page, true);
  await page.locator('[data-del]').click();
  await see(page, 'Aucune fiche.');
  await saved(page);
  assert.deepEqual(draftInDb(site, id).maps[0].fiches, []);
});

test('l’écran n’affiche jamais « Enregistré » tant qu’une modification n’est pas partie', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await addFiche(page, 'Olivier');
  await saved(page);

  await page.locator('[data-vis]').uncheck();
  assert.equal(await page.locator('#saveState').textContent(), 'Enregistrement…', 'dès le clic, avant l’envoi');
  await saved(page);
  await page.locator('[data-vis]').check();
  await page.locator('[data-vis]').uncheck();
  assert.equal(await page.locator('#saveState').textContent(), 'Enregistrement…');
  await saved(page);
});

test('une modification faite pendant un envoi part ensuite, sans conflit, et l’écran ne dit « Enregistré » qu’à la fin', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  const sent = [];
  const releases = [];
  await page.route('**/api/courses/*', async (route) => {
    if (route.request().method() === 'PUT') {
      sent.push(JSON.parse(route.request().postData()).revision);
      await new Promise((resolve) => releases.push(resolve));
    }
    await route.continue();
  });

  await addFiche(page, 'Olivier');
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Enregistrement…');
  while (!sent.length) await page.waitForTimeout(20);
  await addFiche(page, 'Laurier');
  await page.waitForTimeout(350);
  assert.equal(sent.length, 1, 'une écriture à la fois : la seconde attend la révision de la première');

  releases[0]();
  while (sent.length < 2) await page.waitForTimeout(20);
  assert.equal(await page.locator('#saveState').textContent(), 'Enregistrement…', 'la première a abouti, mais Laurier est encore en route');

  releases[1]();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === '✓ Enregistré');
  assert.deepEqual(sent, [1, 2], 'la seconde repart de la révision donnée par la première');
  assert.deepEqual(
    draftInDb(site, onlyCourse(site).id).maps[0].fiches.map((fiche) => fiche.common),
    ['Olivier', 'Laurier']
  );
  assert.equal(await page.locator('#saveBanner').isVisible(), false);
});

test('une écriture sans changement n’envoie rien', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await tab(page, 'Cours');
  const sent = [];
  page.on('request', (request) => request.method() === 'PUT' && sent.push(request.url()));
  await page.locator('#saveName').click();
  await page.locator('#saveState', { hasText: '✓ Enregistré' }).waitFor();
  assert.deepEqual(sent, []);
});

test('annuler une fiche ne laisse rien dans le cours', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Abandonnée');
  await page.locator('#eFiles').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#eGallery img[src^="/media/"]').waitFor();
  await page.locator('#dlgEdit [data-close]').first().click();
  await page.waitForTimeout(400);
  assert.deepEqual(draftInDb(site, onlyCourse(site).id).maps[0].fiches, []);
});

test('plusieurs cartes : en ajouter, changer de carte et en supprimer', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await choosePlan(page);
  await tab(page, 'Cartes');

  answerDialogs(page, 'Bord de mer', true);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#addMap').click();
  await (await chooser).setFiles({ name: 'mer.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#mapName', { hasText: 'Bord de mer' }).waitFor();
  await saved(page);
  const id = onlyCourse(site).id;
  assert.deepEqual(
    draftInDb(site, id).maps.map((map) => map.name),
    ['Plan', 'Bord de mer']
  );

  await page.locator('[data-map-del]').last().click();
  await page.locator('.map-row').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.map-row').length === 1);
  await saved(page);
  assert.equal(draftInDb(site, id).maps.length, 1);
});

test('changer d’image de carte l’envoie sur le serveur, et un fichier refusé s’explique', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await tab(page, 'Cartes');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-map-image]').click();
  await (await chooser).setFiles({ name: 'plan.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#plan[src^="/media/"]').waitFor();
  await saved(page);
  assert.match(draftInDb(site, onlyCourse(site).id).maps[0].image, /^\/media\//);

  const refused = page.waitForEvent('filechooser');
  await page.locator('[data-map-image]').click();
  await (await refused).setFiles({ name: 'texte.png', mimeType: 'image/png', buffer: Buffer.from('ce n’est pas une image') });
  await page.locator('#toast', { hasText: '⚠ Image impossible à enregistrer : Ce type de fichier est refusé.' }).waitFor();
});

/* --- LEG-01, LEG-03 : photos réduites, vidéos intactes --- */

test('LEG-01 : une grande photo est réduite à 1280 px, le plan à 2600 px', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  const large = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3200;
    canvas.height = 2000;
    const context = canvas.getContext('2d');
    for (let i = 0; i < 4000; i++) {
      context.fillStyle = `hsl(${i % 360} 70% ${20 + (i % 60)}%)`;
      context.fillRect((i * 37) % 3200, (i * 53) % 2000, 60, 60);
    }
    return canvas.toDataURL('image/jpeg', 0.95);
  });
  const buffer = Buffer.from(large.split(',')[1], 'base64');
  const naturalSize = (selector) => page.locator(selector).evaluate(async (img) => (await img.decode(), [img.naturalWidth, img.naturalHeight]));

  const chooser = page.waitForEvent('filechooser');
  await page.locator('#planChoose').click();
  await (await chooser).setFiles({ name: 'plan.jpg', mimeType: 'image/jpeg', buffer });
  await page.locator('#plan[src^="/media/"]').waitFor();
  assert.deepEqual(await naturalSize('#plan'), [2600, 1625]);

  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  await page.locator('#eFiles').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer });
  await page.locator('#eGallery img[src^="/media/"]').waitFor();
  assert.deepEqual(await naturalSize('#eGallery img'), [1280, 800]);

  const sizes = site.db.prepare('SELECT size FROM media ORDER BY size').all();
  assert.ok(sizes[0].size < buffer.length / 2, `photo : ${sizes[0].size} octets au lieu de ${buffer.length}`);
});

test('LEG-01 : une petite photo reste telle quelle, et une recompression qui l’alourdirait est écartée', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  await page.locator('#eFiles').setInputFiles({ name: 'petite.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#eGallery img[src^="/media/"]').waitFor();
  assert.equal(site.db.prepare('SELECT size FROM media').get().size, PNG.length, 'sous le seuil : elle n’est pas retouchée');

  const heavy = makePng(60, 40, { pad: 200e3 });
  await page.locator('#eFiles').setInputFiles({ name: 'lourde.png', mimeType: 'image/png', buffer: heavy });
  await page.waitForFunction(() => document.querySelectorAll('#eGallery img[src^="/media/"]').length === 2);
  const smallest = site.db.prepare('SELECT MAX(size) AS n FROM media').get().n;
  assert.ok(smallest < heavy.length / 10, `lourde au départ (${heavy.length}), réduite à ${smallest}`);

  const lighter = await page.evaluate(async () => {
    const { prepareImage } = await import('/js/util.js');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const src = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    return { same: (await prepareImage(blob, { keepBelow: 0, quality: 1 })) === src };
  });
  assert.equal(lighter.same, true, 'le JPEG serait plus lourd : l’originale est gardée');
});

test('LEG-03 : une vidéo part sur le serveur telle quelle, et un fichier refusé s’explique sans bloquer la fiche', async (t) => {
  const { site, page } = await setup(t);
  await watchVideoReads(page);
  await createCourse(page);
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  await page.locator('#eFiles').setInputFiles([
    { name: 'video.mp4', mimeType: 'video/mp4', buffer: MP4 },
    { name: 'piege.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"/>') }
  ]);
  await page.locator('#toast', { hasText: "⚠ Impossible d'enregistrer piege.png : Ce type de fichier est refusé." }).waitFor();
  await page.locator('#eGallery video[src^="/media/"]').waitFor();
  assert.equal(await page.locator('#eSave').isEnabled(), true);
  assert.equal(site.db.prepare('SELECT size FROM media').get().size, MP4.length, 'la vidéo n’est pas retouchée');
  assert.equal(await videoReads(page), 0, 'ni chargée en mémoire');
});

test('tant qu’un fichier est en route, la fiche ne peut pas être enregistrée sans lui', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/api/media', async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('#eFiles').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#aiStatus', { hasText: 'Envoi de photo.png (1 / 1)…' }).waitFor();
  assert.equal(await page.locator('#eSave').isDisabled(), true);
  release();
  await page.locator('#eGallery img[src^="/media/"]').waitFor();
  assert.equal(await page.locator('#eSave').isEnabled(), true);
  assert.equal(await page.locator('#aiStatus').textContent(), '');
});

/* --- COU-02 : publication --- */

test('COU-02 : publier une version, puis voir et publier les modifications suivantes', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await choosePlan(page);
  await addFiche(page, 'Olivier');
  await placeOnPlan(page, 'Olivier');
  await saved(page);
  await tab(page, 'Cours');
  const state = page.locator('#publishState');
  await state.filter({ hasText: "Ce cours n'a pas encore été publié" }).waitFor();

  await page.locator('#publishBtn').click();
  await state.filter({ hasText: 'Version 1, publiée le' }).waitFor();
  await state.filter({ hasText: 'Elle est à jour.' }).waitFor();
  assert.equal(await page.locator('#publishBtn').isDisabled(), true);
  assert.equal(await page.locator('#publishTop').isDisabled(), true);
  await page.locator('#toast', { hasText: '✓ Version 1 publiée' }).waitFor();

  await page.locator('#projName').fill('Sortie au parc, deuxième');
  await page.locator('#saveName').click();
  await page.locator('#pageTitle', { hasText: 'deuxième' }).waitFor();
  await saved(page);
  await page.locator('#publishState', { hasText: 'Des modifications ne sont pas encore publiées.' }).waitFor();
  assert.equal(await page.locator('#publishTop').isEnabled(), true);

  await page.locator('#publishTop').click();
  await page.locator('#publishState', { hasText: 'Version 2, publiée le' }).waitFor();
  const versions = site.db.prepare('SELECT number, content FROM course_versions ORDER BY number').all();
  assert.deepEqual(
    versions.map((version) => JSON.parse(version.content).title),
    ['Sortie au parc', 'Sortie au parc, deuxième']
  );
});

test('COU-02 : changer de carte à l’écran ne compte pas comme une modification à publier', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await choosePlan(page);
  await tab(page, 'Cartes');
  answerDialogs(page, 'Bord de mer', true);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#addMap').click();
  await (await chooser).setFiles({ name: 'mer.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#mapName', { hasText: 'Bord de mer' }).waitFor();
  await saved(page);
  await page.locator('#publishTop').click();
  await page.locator('#toast', { hasText: 'publiée' }).waitFor();

  await page.locator('[data-map-open]').click();
  await page.locator('#mapName', { hasText: 'Plan' }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#publishTop').isDisabled(), true);
});

test('COU-02 : publier prévient s’il manque des positions ou un plan, sans l’empêcher', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await addFiche(page, 'Olivier');
  await addFiche(page, 'Laurier');
  await saved(page);

  const messages = answerDialogs(page, false, true);
  await page.locator('#publishTop').click();
  await page.waitForTimeout(150);
  assert.match(messages[0], /1 carte\(s\) sans image du plan/);
  assert.match(messages[0], /2 fiche\(s\) visible\(s\) sur 2 sans position réelle/);
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM course_versions').get().n, 0, 'renoncer ne publie rien');

  await page.locator('#publishTop').click();
  await page.locator('#toast', { hasText: '✓ Version 1 publiée' }).waitFor();
});

test('COU-02 : une publication attend que les dernières modifications soient enregistrées', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await choosePlan(page);
  await tab(page, 'Fiches');
  await addFiche(page, 'Olivier');
  await placeOnPlan(page, 'Olivier');
  await page.locator('#publishTop').click();
  await page.locator('#toast', { hasText: 'publiée' }).waitFor();
  const version = JSON.parse(site.db.prepare('SELECT content FROM course_versions').get().content);
  assert.equal(version.maps[0].fiches[0].common, 'Olivier');
  assert.equal(typeof version.maps[0].fiches[0].refX, 'number');
});

/* --- EV-04 : une erreur reste à l'écran, en clair --- */

test('EV-04 : sans réseau, l’erreur reste affichée en clair, rien n’est perdu, et Réessayer enregistre', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await page.route('**/api/courses/*', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
  await addFiche(page, 'Olivier');
  const banner = page.locator('#saveBanner');
  await banner.filter({ hasText: 'Enregistrement impossible : Le serveur ne répond pas.' }).waitFor();
  await banner.filter({ hasText: 'Vos modifications sont encore sur cette page.' }).waitFor();
  assert.doesNotMatch(await banner.textContent(), /undefined/);
  await page.waitForTimeout(3200);
  assert.equal(await banner.isVisible(), true, 'elle ne disparaît pas toute seule');
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();

  await page.locator('#saveRetry').click();
  await banner.filter({ hasText: 'Enregistrement impossible' }).waitFor();

  await page.unroute('**/api/courses/*');
  await page.locator('#saveRetry').click();
  await saved(page);
  assert.equal(await banner.isVisible(), false);
  assert.equal(draftInDb(site, onlyCourse(site).id).maps[0].fiches[0].common, 'Olivier');
});

test('EV-04 : une publication tant que l’enregistrement échoue ne part pas, et le dit', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await page.route('**/api/courses/*', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
  await tab(page, 'Cours');
  await page.locator('#projName').fill('Autre nom');
  await page.locator('#saveName').click();
  answerDialogs(page, true);
  await page.locator('#publishBtn').click();
  await page.locator('#publishError', { hasText: 'les dernières modifications ne sont pas enregistrées' }).waitFor();
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM course_versions').get().n, 0);
});

test('EV-04 : un refus du serveur à la publication reste affiché, en clair', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await tab(page, 'Cours');
  answerDialogs(page, true, true);
  await page.route('**/publish', (route) => route.fulfill({ status: 502, body: '' }));
  await page.locator('#publishBtn').click();
  const error = page.locator('#publishError', { hasText: 'Publication impossible : Le serveur a répondu 502.' });
  await error.waitFor();
  await page.waitForTimeout(3200);
  assert.equal(await error.isVisible(), true);

  await page.unroute('**/publish');
  await page.locator('#publishBtn').click();
  await page.locator('#publishState', { hasText: 'Version 1' }).waitFor();
  assert.equal(await page.locator('#publishError').isVisible(), false);
});

test('E-10 : si un autre onglet a enregistré, on le dit et on propose de recharger, sans écraser son travail', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  const id = onlyCourse(site).id;
  site.db.prepare("UPDATE courses SET revision = revision + 1, title = 'Autre onglet' WHERE id = ?").run(id);
  await addFiche(page, 'Olivier');
  const banner = page.locator('#saveBanner');
  await banner.filter({ hasText: 'Ce cours a été modifié ailleurs' }).waitFor();
  await banner.filter({ hasText: 'Rechargez la page' }).waitFor();
  assert.equal(onlyCourse(site).title, 'Autre onglet');
  assert.deepEqual(draftInDb(site, id).maps[0].fiches, []);
  assert.equal(await page.locator('#saveRetry').textContent(), 'Recharger la page');

  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#saveRetry').click();
  await page.waitForLoadState();
  await page.locator('#pageTitle').waitFor();
  assert.equal(await page.locator('.row', { hasText: 'Olivier' }).count(), 0);
});

test('une session expirée pendant le travail ne perd rien : se reconnecter, puis réessayer', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  site.db.exec('DELETE FROM sessions');
  await addFiche(page, 'Olivier');
  const banner = page.locator('#saveBanner');
  await banner.filter({ hasText: 'Votre session a expiré.' }).waitFor();
  assert.equal(await page.locator('#saveLogin').getAttribute('href'), '/prof');
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();

  const context = page.context();
  const second = await context.newPage();
  await logIn(second, TEACHER, '/prof');
  await heading(second, 'Mes cours');
  await second.close();

  await page.locator('#saveRetry').click();
  await saved(page);
  assert.equal(draftInDb(site, onlyCourse(site).id).maps[0].fiches[0].common, 'Olivier');
});

test('quitter la page avant la fin de l’enregistrement demande confirmation', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await page.route('**/api/courses/*', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
  await addFiche(page, 'Olivier');
  await page.locator('#saveBanner').waitFor();

  let asked = false;
  page.once('dialog', async (dialog) => {
    asked = dialog.type() === 'beforeunload';
    await dialog.dismiss();
  });
  await page.reload({ timeout: 800 }).catch(() => {});
  assert.equal(asked, true);
  assert.equal(await page.locator('.row', { hasText: 'Olivier' }).count(), 1);
});

/* --- ENS-03 : un cours n'existe que pour son enseignant --- */

test('quitter la page pendant un envoi demande confirmation', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  let release;
  const held = new Promise((resolve) => (release = resolve));
  t.after(() => release());
  let sending = false;
  await page.route('**/api/courses/*', async (route) => {
    if (route.request().method() === 'PUT') {
      sending = true;
      await held;
    }
    await route.continue();
  });
  await addFiche(page, 'Olivier');
  while (!sending) await page.waitForTimeout(20);

  let asked = false;
  page.once('dialog', async (dialog) => {
    asked = dialog.type() === 'beforeunload';
    await dialog.dismiss();
  });
  await page.reload({ timeout: 800 }).catch(() => {});
  assert.equal(asked, true);
});

test('ENS-03 : un cours introuvable ou d’un autre enseignant le dit, sans rien montrer', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  const url = page.url();

  await page.goto('/prof/cours/absent');
  await page.locator('#fatal', { hasText: 'Ce cours est introuvable.' }).waitFor();
  await page.locator('#fatal a[href="/prof"]').waitFor();

  addAccount(site.db, { email: 'autre@example.org', hash: HASH });
  const other = await openPage(t, browser, { base: site.base });
  await logIn(other, { email: 'autre@example.org', password: TEACHER.password }, '/prof');
  await heading(other, 'Mes cours');
  await other.goto(url);
  await other.locator('#fatal', { hasText: 'Ce cours est introuvable.' }).waitFor();
  assert.equal(await other.locator('#panel').textContent(), '');
});

test('ENS-04 : sans session, la page d’un cours renvoie à la connexion ; une panne le dit', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  const url = page.url();

  const visitor = await openPage(t, browser, { base: site.base });
  await visitor.goto(url);
  await heading(visitor, 'Espace enseignant');
  assert.equal(new URL(visitor.url()).pathname, '/prof');

  await page.route('**/api/courses/*', (route) => route.abort());
  await page.reload();
  await page.locator('#fatal', { hasText: "Impossible d'ouvrir ce cours : Le serveur ne répond pas." }).waitFor();
});

/* --- Liste des cours --- */

test('ENS-02 : la liste montre chaque cours et son état ; renommer et supprimer demandent confirmation', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page, 'Premier cours');
  await page.goto('/prof');
  const row = page.locator('.course-row');
  await row.filter({ hasText: 'Pas encore publié' }).waitFor();
  await row.filter({ hasText: '0 fiche(s)' }).waitFor();
  const id = onlyCourse(site).id;
  assert.equal(await row.getByRole('link', { name: 'Ouvrir' }).getAttribute('href'), `/prof/cours/${id}`);

  const messages = answerDialogs(page, 'Cours renommé', false, true);
  await row.getByRole('button', { name: 'Renommer' }).click();
  await row.getByRole('link', { name: 'Cours renommé' }).waitFor();
  assert.equal(onlyCourse(site).title, 'Cours renommé');
  assert.equal(JSON.parse(onlyCourse(site).draft).title, 'Cours renommé');

  await row.getByRole('button', { name: 'Supprimer' }).click();
  await page.waitForTimeout(150);
  assert.match(messages[1], /l'historique de ses lancements seront effacés définitivement/);
  assert.equal(await row.count(), 1, 'renoncer ne supprime rien');

  await row.getByRole('button', { name: 'Supprimer' }).click();
  await see(page, 'Aucun cours pour le moment.');
  assert.equal(onlyCourse(site), undefined);
});

test('ENS-02 : la liste distingue un cours à jour d’un cours avec des modifications en attente', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  answerDialogs(page, true, true);
  await page.locator('#publishTop').click();
  await page.locator('#toast', { hasText: 'publiée' }).waitFor();
  await page.goto('/prof');
  await page.locator('.course-row', { hasText: 'Version 1 publiée' }).waitFor();
  assert.equal(await page.locator('.course-row', { hasText: 'modifications en attente' }).count(), 0);

  await page.locator('.course-row').getByRole('link', { name: 'Ouvrir' }).click();
  await addFiche(page, 'Olivier');
  await saved(page);
  await page.goto('/prof');
  await page.locator('.course-row', { hasText: 'Version 1 publiée, modifications en attente' }).waitFor();
});

test('renommer un cours n’accepte pas un nom vide, et une erreur de la liste s’affiche', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page, 'Premier cours');
  await page.goto('/prof');
  answerDialogs(page, '   ', true);
  await page.getByRole('button', { name: 'Renommer' }).click();
  await page.waitForTimeout(150);
  assert.equal(onlyCourse(site).title, 'Premier cours');

  await page.route('**/api/courses/*', (route) => route.abort());
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('alert').filter({ hasText: 'Le serveur ne répond pas.' }).waitFor();
});

test('une session expirée sur la liste ramène à la connexion', async (t) => {
  const { site, page } = await setup(t);
  await page.getByLabel('Nom du nouveau cours').fill('Trop tard');
  site.db.exec('DELETE FROM sessions');
  await page.getByRole('button', { name: 'Créer le cours' }).click();
  await heading(page, 'Espace enseignant');
});

/* --- PRI-07, COM-01 : importer et exporter --- */

function projectFile(overrides = {}) {
  return {
    format: 'inventaire-botanique',
    version: 3,
    id: 'proj-ancien',
    revision: 'r1',
    savedAt: '2026-01-01T00:00:00.000Z',
    title: 'Projet importé',
    passwordHash: 'empreinte-ancienne',
    theme: { preset: 'ocean', icon: 'leaf' },
    currentMapId: 'm2',
    maps: [
      {
        id: 'm1',
        name: 'Parc',
        image: PNG_URL,
        fiches: [{ id: 'f1', common: 'Olivier', refX: 10, refY: 20, media: [{ id: 'p1', type: 'image', name: 'olivier.png', data: PNG_URL }] }]
      },
      {
        id: 'm2',
        name: 'Mer',
        image: PNG_URL,
        fiches: [{ id: 'f2', common: 'Tamaris', visible: false, media: [{ id: 'v1', type: 'video', data: 'data:video/mp4;base64,' + MP4.toString('base64') }] }]
      }
    ],
    progress: { m1: { verified: true, entries: { f1: { x: 1, y: 2, temperature: '20' } } } },
    ...overrides
  };
}

const importFile = (page, name, content, mimeType = 'application/json') =>
  page.locator('.course-import input[type=file]').setInputFiles({ name, mimeType, buffer: Buffer.from(content) });

test('PRI-07 : importer un projet .json crée un cours, envoie ses fichiers et ne reprend pas le travail des élèves', async (t) => {
  const { site, page } = await setup(t);
  await watchVideoReads(page);
  await importFile(page, 'projet.json', JSON.stringify(projectFile()));
  await page.locator('.course-row', { hasText: 'Projet importé' }).waitFor();
  await page.locator('.course-import [role=status]', { hasText: 'Projet « projet.json » importé.' }).waitFor();
  assert.equal(await videoReads(page), 0, 'LEG-03 : la vidéo n’est pas lue comme une photo');

  const course = onlyCourse(site);
  assert.doesNotMatch(course.draft, /data:/, 'LEG-02');
  assert.doesNotMatch(course.draft, /empreinte-ancienne|"progress"|proj-ancien/);
  const draft = JSON.parse(course.draft);
  assert.deepEqual(
    draft.maps.map((map) => map.name),
    ['Parc', 'Mer']
  );
  assert.equal(draft.theme.preset, 'ocean');
  assert.equal(draft.maps[0].fiches[0].refX, 10);
  assert.match(draft.maps[0].image, /^\/media\//);
  assert.match(draft.maps[0].fiches[0].media[0].data, /^\/media\/[0-9a-f]{64}\.png$/);
  assert.match(draft.maps[1].fiches[0].media[0].data, /^\/media\/[0-9a-f]{64}\.mp4$/);

  await page.locator('.course-row').getByRole('link', { name: 'Ouvrir' }).click();
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();
  await page.locator('.pin.ref').waitFor();
  await page.locator('.row img.photo[src^="/media/"]').waitFor();
  assert.equal(await page.locator('.pin:not(.ref)').count(), 0, 'pas de placement d’élève');
  assert.equal(await page.locator('#publishTop').isEnabled(), true);
});

test('COM-01 : importer un fichier .html, et un ancien projet en version 2', async (t) => {
  const { site, page } = await setup(t);
  const html = `<!doctype html><script id="embedded-project" type="application/json">${JSON.stringify(projectFile({ title: 'Depuis un fichier html' }))}</script>`;
  await importFile(page, 'projet.html', html, 'text/html');
  await page.locator('.course-row', { hasText: 'Depuis un fichier html' }).waitFor();

  const old = {
    format: 'inventaire-botanique',
    version: 2,
    title: 'Ancien projet',
    maps: [{ id: 'm1', name: 'Plan', image: PNG_URL, locations: [{ id: 'l1', common: 'Chêne', placed: true, x: 5, y: 5, media: [] }] }]
  };
  await importFile(page, 'ancien.json', JSON.stringify(old));
  await page.locator('.course-row', { hasText: 'Ancien projet' }).waitFor();
  const draft = JSON.parse(site.db.prepare("SELECT draft FROM courses WHERE title = 'Ancien projet'").get().draft);
  assert.equal(draft.maps[0].fiches[0].common, 'Chêne');
  assert.equal(draft.maps[0].fiches[0].x, undefined);
});

test('PRI-07 : un fichier qui n’est pas un projet s’explique, et un fichier refusé ne fait pas tout échouer', async (t) => {
  const { site, page } = await setup(t);
  await importFile(page, 'autre.json', '{"bonjour": true}');
  await page.getByRole('alert').filter({ hasText: 'fichier de projet non reconnu' }).waitFor();
  assert.equal(onlyCourse(site), undefined);

  const project = projectFile();
  project.maps[0].fiches[0].media[0].data = 'data:text/plain;base64,' + Buffer.from('pas une photo').toString('base64');
  await importFile(page, 'projet.json', JSON.stringify(project));
  await page.locator('.course-import [role=status]', { hasText: "1 fichier(s) n'ont pas pu être envoyés" }).waitFor();
  const draft = JSON.parse(onlyCourse(site).draft);
  assert.deepEqual(draft.maps[0].fiches[0].media, [], 'le fichier refusé est retiré');
  assert.equal(draft.maps[0].fiches[0].common, 'Olivier', 'le reste est importé');
});

test('un cours se télécharge avec ses photos, et se réimporte à l’identique', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page, 'À télécharger');
  await choosePlan(page);
  await addFiche(page, 'Olivier', { photo: true });
  await placeOnPlan(page, 'Olivier');
  await saved(page);
  await tab(page, 'Cours');

  const download = page.waitForEvent('download');
  await page.locator('#exportJson').click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'À télécharger.json');
  const text = await readFile(await file.path(), 'utf8');
  const exported = JSON.parse(text);
  assert.equal(exported.format, 'inventaire-botanique');
  assert.deepEqual(exported.progress, {});
  assert.match(exported.maps[0].image, /^data:image\/png;base64,/);
  assert.match(exported.maps[0].fiches[0].media[0].data, /^data:image\/png;base64,/);
  await page.locator('#toast', { hasText: '✓ Fichier téléchargé' }).waitFor();

  site.db.exec('DELETE FROM courses');
  await page.goto('/prof');
  await importFile(page, 'À télécharger.json', text);
  await page.locator('.course-row', { hasText: 'À télécharger' }).waitFor();
  const draft = JSON.parse(onlyCourse(site).draft);
  assert.equal(draft.maps[0].fiches[0].common, 'Olivier');
  assert.match(draft.maps[0].fiches[0].media[0].data, /^\/media\//);
  assert.equal(typeof draft.maps[0].fiches[0].refX, 'number');
});

test('un fichier disparu du serveur s’explique au téléchargement', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await choosePlan(page);
  await saved(page);
  await tab(page, 'Cours');
  await page.route('**/media/*', (route) => route.fulfill({ status: 404, body: 'Introuvable' }));
  await page.locator('#exportJson').click();
  await page.locator('#toast', { hasText: '⚠ Téléchargement impossible : fichier introuvable sur le serveur (404)' }).waitFor();
});

/* --- EDI-10 et section 9 : ce qui n'existe plus côté enseignant --- */

test('EDI-10 : ni séance, ni mesures, ni mot de passe de gestion dans l’espace enseignant', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await addFiche(page, 'Olivier');
  assert.equal(await page.locator('#modeBtn, #studentsBox, #dlgLogin').count(), 0);
  assert.equal(await page.getByText('Séance en cours').count(), 0);
  assert.equal(await page.locator('[data-measure]').count(), 0);
  assert.equal(await page.locator('#compare, #newSession').count(), 0);

  await page.locator('[data-edit]').click();
  assert.equal(await page.getByText('Mesures de terrain').count(), 0);
  assert.equal(await page.locator('#eTemp, #eHumidity, #eLight').count(), 0);
  await page.locator('#dlgEdit [data-close]').first().click();

  await tab(page, 'Réglages');
  await page.getByRole('heading', { name: 'Apparence' }).waitFor();
  assert.equal(await page.getByText('Mot de passe de gestion').count(), 0);
  assert.equal(await page.locator('#savePw').count(), 0);
});

test('EDI-10 : le tableur de l’espace enseignant n’a plus de colonnes de mesures', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await addFiche(page, 'Olivier');
  await saved(page);

  const download = page.waitForEvent('download');
  await page.locator('#sheetExport').click();
  const csv = await readFile(await (await download).path(), 'utf8');
  const header = csv.replace(/^﻿/, '').split('\r\n')[0];
  assert.match(header, /Nom commun/);
  assert.doesNotMatch(header, /Température|Hygrométrie|Éclairement/);

  const messages = answerDialogs(page, true);
  await page.locator('#sheetImport').setInputFiles({
    name: 'fiches.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Nom commun;Température (°C)\nLaurier;21\n')
  });
  await page.locator('.row', { hasText: 'Laurier' }).waitFor();
  assert.match(messages[0], /Colonnes non reconnues \(ignorées\) : Température/);
  await saved(page);
  assert.doesNotMatch(onlyCourse(site).draft, /temperature/);
});

test('TAB : un vrai fichier .xlsx s’importe dans un cours', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  const messages = answerDialogs(page, true);
  await page.locator('#sheetImport').setInputFiles({
    name: 'fiches.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: makeXlsx([
      ['Réf. photo', 'Nom commun', 'Nom scientifique', 'Exposition', 'Visible élèves (oui/non)'],
      ['2', 'Olivier', 'Olea europaea', '☀️☀️☀️ Plein soleil', 'oui'],
      ['1', 'Laurier', 'Laurus nobilis', '', 'non']
    ])
  });
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();
  assert.match(messages[0], /2 nouvelle\(s\) fiche\(s\)/);
  await saved(page);
  const { fiches } = JSON.parse(onlyCourse(site).draft).maps[0];
  assert.deepEqual(
    fiches.map((fiche) => [fiche.ref, fiche.common, fiche.visible]),
    [
      ['1', 'Laurier', false],
      ['2', 'Olivier', true]
    ],
    'rangées par réf. photo'
  );
  assert.equal(fiches[1].exposure, '☀️☀️☀️ Plein soleil', 'les émojis sont gardés');
});

test('l’onglet Réglages enregistre le thème dans le cours', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page);
  await tab(page, 'Réglages');
  await page.locator('[data-preset]').nth(1).click();
  await saved(page);
  const { theme } = JSON.parse(onlyCourse(site).draft);
  assert.notEqual(theme.preset, 'vegetal');
  await page.reload();
  await page.locator('#pageTitle').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent') !== ''), true);
});

test('EV-33 : un cours n’a pas d’identification par IA, même importé d’un projet qui en avait une', async (t) => {
  const { site, page } = await setup(t);
  await importFile(page, 'projet.json', JSON.stringify(projectFile({ aiEndpoint: 'https://ia.example.org/identifier' })));
  await page.locator('.course-row', { hasText: 'Projet importé' }).waitFor();
  assert.doesNotMatch(onlyCourse(site).draft, /ia\.example\.org|aiEndpoint/);

  // Un cours créé avant ce retrait peut encore contenir l'adresse : elle ne sert plus à rien
  const course = onlyCourse(site);
  site.db.prepare('UPDATE courses SET draft = ?').run(JSON.stringify({ ...JSON.parse(course.draft), aiEndpoint: 'https://ia.example.org/identifier' }));
  await page.goto(`/prof/cours/${course.id}`);
  await tab(page, 'Réglages');
  await page.getByRole('heading', { name: 'Apparence' }).waitFor();
  assert.equal(await page.locator('#aiUrl').count(), 0);
  assert.doesNotMatch(await page.locator('#panel').textContent(), /IA\b/);

  await tab(page, 'Fiches');
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').waitFor();
  assert.equal(await page.locator('#aiBtn').isVisible(), false);
});

for (const [what, plan, screen] of [
  ['sans plan', null, 900],
  ['avec un plan très large', makePng(400, 100), 900],
  ['sur un écran bas', null, 600]
]) {
  test(`EV-32 : ${what}, le panneau de droite descend presque jusqu’en bas de l’écran, sans en sortir`, async (t) => {
    const { page } = await setup(t, { viewport: { width: 1900, height: screen } });
    await createCourse(page);
    if (plan) {
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#planChoose').click();
      await (await chooser).setFiles({ name: 'plan.png', mimeType: 'image/png', buffer: plan });
      await page.locator('#plan[src^="/media/"]').waitFor();
    }
    const { height, bottom, hidden } = await page.locator('#panel').evaluate((panel) => {
      const box = panel.getBoundingClientRect();
      const scroll = panel.querySelector('.panel-scroll');
      return { height: box.height, bottom: box.bottom, hidden: scroll.scrollHeight - scroll.clientHeight };
    });
    assert.ok(bottom <= screen, `le panneau finit à ${bottom}`);
    assert.ok(height >= screen - 150 || hidden === 0, `${height} px de haut alors que ${hidden} px restent à faire défiler`);
  });
}

test('EV-34 : l’espace enseignant s’appelle Cartopoint, garde le vert par défaut et ne parle plus de botanique', async (t) => {
  const { page } = await setup(t);
  const BOTANICAL = /botani|inventaire|la plante|espèce/i;
  const noBotany = async (where) =>
    assert.doesNotMatch(await page.evaluate(() => document.title + ' ' + document.documentElement.textContent), BOTANICAL, where);
  await noBotany('liste des cours');
  assert.match(await page.title(), /Cartopoint/);

  // Un cours créé sans nom reçoit les valeurs par défaut
  await page.getByRole('button', { name: 'Créer le cours' }).click();
  await page.locator('#planChoose').waitFor();
  assert.equal(await page.locator('#pageTitle').textContent(), 'Cartopoint');
  assert.equal(await page.locator('#mapName').textContent(), 'Plan');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '#2e6e45');
  assert.equal(await page.locator('.brand-mark circle').count(), 1, 'l’icône est un repère, plus une feuille');

  for (const name of ['Fiches', 'Cartes', 'Cours', 'Réglages']) {
    await tab(page, name);
    await noBotany(`onglet ${name}`);
  }
  await page.locator('.swatch[data-preset=vegetal]', { hasText: 'Vert' }).waitFor();

  await tab(page, 'Fiches');
  const download = page.waitForEvent('download');
  await page.locator('#sheetTemplate').click();
  assert.equal((await download).suggestedFilename(), 'Modèle de fiches.csv');
});

test('cliquer sur un repère du plan ouvre sa fiche pour la modifier', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await choosePlan(page);
  await addFiche(page, 'Olivier');
  await placeOnPlan(page, 'Olivier');
  await page.locator('.pin.ref').click();
  await page.locator('#dlgEdit').waitFor();
  assert.equal(await page.locator('#eCommon').inputValue(), 'Olivier');
});

test('la visionneuse montre les photos du serveur, et passe de l’une à l’autre', async (t) => {
  const { page } = await setup(t);
  await createCourse(page);
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  await page.locator('#eFiles').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: makePng(40, 20) },
    { name: 'b.png', mimeType: 'image/png', buffer: makePng(30, 20) }
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#eGallery img[src^="/media/"]').length === 2);
  await page.locator('#eSave').click();
  await page.locator('.row img.photo[src^="/media/"]').click();
  await page.locator('#dlgPhoto').waitFor();
  await page.locator('#photoCount', { hasText: '1 / 2' }).waitFor();
  const first = await page.locator('#photoImg').getAttribute('src');
  assert.match(first, /^\/media\//);
  await page.locator('#photoNext').click();
  await page.locator('#photoCount', { hasText: '2 / 2' }).waitFor();
  assert.notEqual(await page.locator('#photoImg').getAttribute('src'), first);
  await page.locator('#photoClose').click();
  await page.locator('#dlgPhoto').waitFor({ state: 'hidden' });
});

/* --- ADM-04 : chiffres sur le tableau de bord --- */

test('ADM-04 : le tableau de bord montre les chiffres de chaque enseignant, jamais ses cours', async (t) => {
  const { site, page } = await setup(t);
  await createCourse(page, 'Cours confidentiel');
  await choosePlan(page);
  await addFiche(page, 'Olivier');
  await saved(page);

  const admin = await openPage(t, browser, { base: site.base });
  await logIn(admin, ADMIN, '/admin');
  await admin.getByRole('cell', { name: TEACHER.email }).waitFor();
  const value = (label) => admin.locator(`td[data-label="${label}"]`).textContent();
  assert.equal(await value('Cours'), '1');
  assert.equal(await value('Fiches'), '1');
  assert.equal(await value('Lancements'), '0');
  assert.match(await value('Place occupée'), /^\d+ Ko$/);
  assert.equal(await admin.getByText('Cours confidentiel').count(), 0, 'ADM-07');
});

/* --- Écrans sur téléphone, pages construites --- */

test('sur un téléphone, la liste et la page d’un cours tiennent dans l’écran', async (t) => {
  const { page } = await setup(t, { viewport: { width: 390, height: 780 } });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const longTitle = 'Unnomdecourstreslongsansaucunecoupurepourverifierquilnedepassepasdelecran';
  await createCourse(page, longTitle);
  await choosePlan(page);
  await addFiche(page, 'Olivier');
  await saved(page);
  assert.equal(await overflow(), 0, 'page du cours');
  const box = await page.locator('#publishTop').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, `Publier : de ${box.x} à ${box.x + box.width}`);

  await page.goto('/prof');
  await page.locator('.course-row').waitFor();
  assert.equal(await overflow(), 0, 'liste des cours');
  for (const name of ['Renommer', 'Supprimer']) {
    const button = await page.getByRole('button', { name }).boundingBox();
    assert.ok(button.x >= 0 && button.x + button.width <= 390, `${name} : de ${button.x} à ${button.x + button.width}`);
  }
});

test('DEP-01 : la page d’un cours construite fonctionne aussi, d’un seul tenant', async (t) => {
  const out = await tempDir(t);
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', out], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);

  const site = await startSite(t, { root: out });
  addAccount(site.db, { email: TEACHER.email, hash: HASH });
  const page = await openPage(t, browser, { base: site.base });
  const files = [];
  page.on('request', (request) => files.push(new URL(request.url()).pathname));
  await logIn(page, TEACHER, '/prof');
  await heading(page, 'Mes cours');
  await createCourse(page);
  await choosePlan(page);
  await addFiche(page, 'Olivier');
  await saved(page);
  assert.deepEqual(
    [...new Set(files.filter((file) => !file.startsWith('/api/') && !file.startsWith('/media/') && !file.startsWith('/prof/cours/')))],
    ['/prof'],
    'aucun fichier séparé à charger'
  );
  assert.ok(path.basename(files.find((file) => file.startsWith('/prof/cours/'))));
});
