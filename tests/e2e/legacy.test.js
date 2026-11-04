/**
 * L'application actuelle, enregistrée dans le navigateur : elle doit continuer à fonctionner avec son backend `local`
 * jusqu'à la bascule, et elle servira de base au fichier de secours. Contient aussi la reproduction de EV-04 :
 * ce que voit l'enseignant quand son navigateur refuse une écriture.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, makePng, openPage, startSite } from './helpers.js';

const PNG = makePng(40, 20);
const PUBLISH_PASSWORD = 'mot-de-publication';
const PUBLISHED = {
  format: 'inventaire-botanique',
  version: 3,
  id: 'en-ligne',
  revision: 'r1',
  title: 'Projet en ligne',
  maps: [{ id: 'm1', name: 'Plan', image: '', fiches: [] }]
};

/** Une écriture qui échoue, comme quand le navigateur n'a plus de place : `window.__fail` l'active à la demande. */
const REFUSED_WRITES = {
  'une requête refusée': `
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (!window.__fail) return put.call(this, value, key);
      put.call(this, value, key);
      return key === undefined ? this.add(value) : this.add(value, key);
    };`,
  'une transaction annulée': `
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if (window.__fail) this.transaction.abort();
      return request;
    };`
};

/** Ce que l'enseignant doit lire : c'est la seule chose qui puisse aider à comprendre le refus. */
const REFUSAL_REASONS = {
  'une requête refusée': /Key already exists/,
  'une transaction annulée': /transaction annulée/
};

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

async function openApp(t, { password = '', init } = {}) {
  const site = await startSite(t, { password });
  // Un projet déjà en ligne : c'est lui qui rend la publication accessible
  if (password) await writeFile(path.join(site.data, 'project.json'), JSON.stringify(PUBLISHED));
  const page = await openPage(t, browser, { base: site.base });
  if (init) await page.addInitScript(init);
  await page.goto('/');
  await page.locator('#modeBtn').waitFor();
  return { site, page };
}

async function enterManagement(page) {
  await page.locator('#modeBtn').click();
  await page.locator('#loginPw').fill('admin');
  await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#newFiche').waitFor();
}

async function addFiche(page, name) {
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill(name);
  await page.locator('#eSave').click();
  await page.locator('#dlgEdit').waitFor({ state: 'hidden' });
}

const toast = (page, text) => page.locator('#toast', { hasText: text }).waitFor();
/** Laisse passer l'écriture regroupée, qui part un quart de seconde après la modification. */
const written = (page) => page.waitForTimeout(400);

async function downloadJson(page) {
  await page.locator('[data-tab=projet]').click();
  page.once('dialog', (dialog) => dialog.accept('essai'));
  const download = page.waitForEvent('download');
  await page.locator('#saveJson').click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}

test('une fiche et sa photo restent dans ce navigateur après un rechargement', async (t) => {
  const { page } = await openApp(t);
  await enterManagement(page);
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  await page.locator('#eFiles').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#eGallery img[src^="blob:"]').waitFor();
  await page.locator('#eSave').click();
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();
  await written(page);

  await page.reload();
  await enterManagement(page);
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();
  await page.locator('.row img.photo[src^="blob:"]').waitFor();
});

test('le fichier enregistré contient la fiche et sa photo, et se rouvre', async (t) => {
  const { page } = await openApp(t);
  await enterManagement(page);
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  await page.locator('#eFiles').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#eGallery img').waitFor();
  await page.locator('#eSave').click();
  await page.locator('.row', { hasText: 'Olivier' }).waitFor();

  const saved = await downloadJson(page);
  await toast(page, '✓ Projet enregistré');
  const fiche = saved.maps[0].fiches[0];
  assert.equal(fiche.common, 'Olivier');
  assert.match(fiche.media[0].data, /^data:image\/png;base64,/);
});

test('supprimer une carte l’oublie aussi dans ce navigateur', async (t) => {
  const { page } = await openApp(t);
  await enterManagement(page);
  await page.locator('[data-tab=cartes]').click();
  page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Seconde carte' : undefined));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#addMap').click();
  await (await chooser).setFiles({ name: 'plan.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#mapName', { hasText: 'Seconde carte' }).waitFor();
  await written(page);
  const stored = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('inventaire-botanique');
          open.onsuccess = () => {
            const all = open.result.transaction('maps').objectStore('maps').getAll();
            all.onsuccess = () => {
              open.result.close();
              resolve(all.result.length);
            };
          };
        })
    );
  assert.equal(await stored(), 2);

  await page.locator('[data-map-del]').last().click();
  await page.waitForFunction(() => document.querySelectorAll('.map-row').length === 1);
  await written(page);
  assert.equal(await stored(), 1);
});

for (const [kind, init] of Object.entries(REFUSED_WRITES)) {
  test(`EV-04 : ${kind} s’affiche en clair, et n’écrit jamais « undefined » ni « null »`, async (t) => {
    const { page } = await openApp(t, { init });
    await enterManagement(page);
    await page.evaluate(() => (window.__fail = true));
    await addFiche(page, 'Olivier');
    const message = page.locator('#toast', { hasText: '⚠ Enregistrement impossible : ' });
    await message.waitFor();
    assert.doesNotMatch(await message.textContent(), /undefined|null|Cannot read|inconnue/);
    assert.match(await message.textContent(), REFUSAL_REASONS[kind]);
  });

  test(`EV-04 : après ${kind}, les fiches peuvent encore être enregistrées dans un fichier`, async (t) => {
    const { page } = await openApp(t, { init });
    await enterManagement(page);
    await page.evaluate(() => (window.__fail = true));
    await addFiche(page, 'Olivier');
    await toast(page, '⚠ Enregistrement impossible');
    const saved = await downloadJson(page);
    assert.equal(saved.maps[0].fiches[0].common, 'Olivier', 'le fichier contient ce qui est à l’écran');
  });

  test(`EV-04 : après ${kind}, ce qui n’a pas été écrit l’est dès que le navigateur l’accepte de nouveau`, async (t) => {
    const { page } = await openApp(t, { init });
    await enterManagement(page);
    await page.evaluate(() => (window.__fail = true));
    await addFiche(page, 'Olivier');
    await toast(page, '⚠ Enregistrement impossible');

    await page.evaluate(() => (window.__fail = false));
    await addFiche(page, 'Laurier');
    await written(page);
    await page.reload();
    await enterManagement(page);
    await page.locator('.row', { hasText: 'Olivier' }).waitFor();
    await page.locator('.row', { hasText: 'Laurier' }).waitFor();
  });

  test(`EV-04 : après ${kind}, une fiche non écrite repart même si la modification suivante ne touche pas sa carte`, async (t) => {
    const { page } = await openApp(t, { init });
    await enterManagement(page);
    await page.evaluate(() => (window.__fail = true));
    await addFiche(page, 'Noisetier');
    await toast(page, '⚠ Enregistrement impossible');

    await page.evaluate(() => (window.__fail = false));
    // Seul le nom du projet change : rien d'autre ne fait repasser la carte par l'écriture
    await page.getByRole('tab', { name: 'Projet' }).click();
    await page.locator('#projName').fill('Autre nom');
    await page.locator('#saveName').click();
    await written(page);
    await page.reload();
    await enterManagement(page);
    await page.locator('.row', { hasText: 'Noisetier' }).waitFor();
  });
}

test('EV-04 : une publication reste possible quand le navigateur refuse d’écrire', async (t) => {
  const { site, page } = await openApp(t, { password: PUBLISH_PASSWORD, init: REFUSED_WRITES['une requête refusée'] });
  await enterManagement(page);
  await page.evaluate(() => (window.__fail = true));
  await addFiche(page, 'Olivier');
  await toast(page, '⚠ Enregistrement impossible');

  await page.locator('[data-tab=projet]').click();
  await page.locator('#publishBtn').click();
  await page.locator('#pubPw').fill(PUBLISH_PASSWORD);
  await page.locator('dialog[open] button[type=submit]').click();
  // Le « ⚠ » du refus reste affiché : seul ce message dit que le serveur a répondu
  await toast(page, '✓ Publié');
  const published = JSON.parse(await readFile(path.join(site.data, 'project.json'), 'utf8'));
  assert.equal(published.maps[0].fiches[0].common, 'Olivier');
});

test('une erreur reste le temps d’être lue, un message ordinaire disparaît vite', async (t) => {
  const { page } = await openApp(t, { init: REFUSED_WRITES['une transaction annulée'] });
  await enterManagement(page);
  await toast(page, 'Mode gestion');
  await page.waitForTimeout(3100);
  assert.equal(await page.locator('#toast.show').count(), 0, 'le message ordinaire est parti');

  await page.evaluate(() => (window.__fail = true));
  await addFiche(page, 'Olivier');
  await toast(page, '⚠ Enregistrement impossible');
  await page.waitForTimeout(3100);
  assert.equal(await page.locator('#toast.show', { hasText: '⚠' }).count(), 1, 'l’erreur est toujours là');
});

test('l’identification par IA envoie les photos enregistrées dans le navigateur, et remplit les champs vides', async (t) => {
  const { page } = await openApp(t);
  await enterManagement(page);
  await page.locator('[data-tab=reglages]').click();
  await page.locator('#aiUrl').fill('https://ia.example.org/identifier');
  await page.locator('#saveAi').click();
  await page.locator('[data-tab=fiches]').click();

  let sent;
  await page.route('https://ia.example.org/**', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    sent = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ family: 'Oleaceae' }) });
  });
  await page.locator('#newFiche').click();
  await page.locator('#eCommon').fill('Olivier');
  await page.locator('#eFiles').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#eGallery img').waitFor();
  await page.locator('#aiBtn').click();
  await page.waitForFunction(() => document.querySelector('#eFamily').value === 'Oleaceae');
  assert.match(sent.images[0], /^data:image\/png;base64,/);
});

test('EV-34 : sans projet, la page s’appelle Cartopoint, avec une carte « Plan », et la recherche parle de fiches', async (t) => {
  const { page } = await openApp(t);
  await page.waitForFunction(() => document.querySelector('#mapName').textContent === 'Plan');
  assert.equal(await page.locator('#pageTitle').textContent(), 'Cartopoint');
  assert.match(await page.title(), /Cartopoint/);
  assert.match(await page.locator('#search').getAttribute('placeholder'), /fiche/);
});

test('publier envoie le projet au serveur, et un mauvais mot de passe s’explique', async (t) => {
  const { site, page } = await openApp(t, { password: PUBLISH_PASSWORD });
  await enterManagement(page);
  await addFiche(page, 'Olivier');
  await page.locator('[data-tab=projet]').click();

  await page.locator('#publishBtn').click();
  await page.locator('#pubPw').fill('mauvais');
  await page.locator('dialog[open] button[type=submit]').click();
  await toast(page, '⚠ Mot de passe de publication refusé');

  await page.locator('#publishBtn').click();
  await page.locator('#pubPw').fill(PUBLISH_PASSWORD);
  await page.locator('dialog[open] button[type=submit]').click();
  await toast(page, '✓ Publié');
  const published = JSON.parse(await readFile(path.join(site.data, 'project.json'), 'utf8'));
  assert.equal(published.maps[0].fiches[0].common, 'Olivier');
});

test('EV-04 : une erreur du serveur à la publication s’affiche avec son code', async (t) => {
  const { page } = await openApp(t, { password: PUBLISH_PASSWORD });
  await enterManagement(page);
  await page.locator('[data-tab=projet]').click();
  await page.route('**/api/project*', (route) => route.fulfill({ status: 500, body: 'Erreur du serveur' }));
  await page.locator('#publishBtn').click();
  await page.locator('#pubPw').fill(PUBLISH_PASSWORD);
  await page.locator('dialog[open] button[type=submit]').click();
  await toast(page, '⚠ Publication impossible : le serveur a répondu 500');
});

test('ouvrir un projet remplace celui du navigateur, et un mauvais fichier s’explique', async (t) => {
  const { page } = await openApp(t);
  await enterManagement(page);
  await page.locator('[data-tab=projet]').click();
  await page.locator('#openProject').setInputFiles({ name: 'autre.json', mimeType: 'application/json', buffer: Buffer.from('{"bonjour":true}') });
  await toast(page, '⚠ Ouverture impossible : fichier de projet non reconnu');

  page.once('dialog', (dialog) => dialog.accept());
  const project = {
    format: 'inventaire-botanique',
    version: 3,
    title: 'Projet ouvert',
    maps: [{ id: 'm1', name: 'Plan', image: '', fiches: [{ id: 'f1', common: 'Chêne' }] }]
  };
  await page.locator('#openProject').setInputFiles({ name: 'projet.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.locator('#pageTitle', { hasText: 'Projet ouvert' }).waitFor();
  await toast(page, '✓ Projet ouvert');
});
