/**
 * Un cours qui n'a rien de botanique : son modèle de fiche décide de tout l'affichage (CHP-02 à CHP-05). Le fichier de secours
 * le montre de bout en bout, sans serveur : la fiche que lit l'élève, ses réponses, ce qui ne paraît qu'à la correction, le
 * formulaire de l'enseignant et le tableur. Le serveur, lui, ne fera suivre le modèle aux élèves qu'à l'étape suivante.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser, makePng, openPage, startSite } from './helpers.js';

const PNG = makePng(40, 20);
const choices = (...labels) => labels.map((label) => ({ id: label.toLowerCase().replace(/[^a-z]/g, ''), label }));

const PATRIMOINE = {
  name: 'Patrimoine',
  fields: [
    { id: 'c-nom', type: 'text', label: 'Monument', audience: 'info', role: 'title', search: true, placeholder: 'Église Saint-Paul' },
    { id: 'c-ville', type: 'text', label: 'Ville', audience: 'info', role: 'subtitle', search: true },
    { id: 'c-siecle', type: 'number', label: 'Siècle', audience: 'info', unit: 'e', list: true },
    { id: 'c-visite', type: 'date', label: 'Visité le', audience: 'info' },
    { id: 'c-style', type: 'choice', label: 'Style', audience: 'info', choices: choices('Roman', 'Gothique') },
    { id: 'h-regarder', type: 'heading', label: 'À regarder', help: 'Faites le tour du bâtiment.' },
    { id: 'c-facade', type: 'longtext', label: 'Façade', icon: '🏛️', audience: 'info' },
    { id: 'c-classe', type: 'yesno', label: 'Monument historique', audience: 'info' },
    { id: 'h-questions', type: 'heading', label: 'Vos réponses', help: 'Répondez sur place.' },
    { id: 'c-age', type: 'text', label: 'Âge estimé', audience: 'question', list: true },
    { id: 'c-hauteur', type: 'number', label: 'Hauteur', unit: 'm', keyboard: 'numeric', audience: 'question', list: true },
    { id: 'c-ouvert', type: 'yesno', label: 'Est-il ouvert ?', icon: '🚪', audience: 'question', list: true },
    { id: 'c-materiaux', type: 'choice', label: 'Matériaux', audience: 'question', multiple: true, choices: choices('Pierre', 'Brique', 'Bois') },
    { id: 'c-etat', type: 'scale', label: 'État', audience: 'question', max: 4, symbol: '⭐' },
    { id: 'c-impression', type: 'longtext', label: 'Votre impression', audience: 'question' },
    { id: 'h-fin', type: 'heading', label: '' },
    { id: 'c-histoire', type: 'longtext', label: 'Histoire', audience: 'info' },
    { id: 'c-architecte', type: 'text', label: 'Architecte', audience: 'correction' },
    { id: 'c-prof', type: 'longtext', label: 'Pour moi', audience: 'teacher' }
  ]
};

const PROJECT = {
  format: 'inventaire-botanique',
  version: 4,
  title: 'Sortie en ville',
  theme: {},
  template: PATRIMOINE,
  maps: [
    {
      id: 'm1',
      name: 'Centre',
      image: 'data:image/png;base64,' + PNG.toString('base64'),
      fiches: [
        {
          id: 'f1',
          ref: '1',
          'c-nom': 'Cathédrale',
          'c-ville': 'Rouen',
          'c-siecle': '13',
          'c-visite': '2026-10-02',
          'c-style': 'gothique',
          'c-facade': 'Deux tours inégales',
          'c-classe': 'oui',
          'c-histoire': 'Peinte par Monet.',
          'c-architecte': 'Jean d’Andeli',
          'c-prof': 'Demander la clé',
          visible: true,
          refX: 50,
          refY: 50,
          media: []
        },
        { id: 'f2', ref: '2', 'c-nom': 'Halle', 'c-ville': 'Dives', visible: true, refX: 10, refY: 10, media: [] }
      ]
    }
  ]
};

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

const toast = (page, text) => page.locator('#toast', { hasText: text }).waitFor();

/** Le fichier de secours, le projet « Patrimoine » ouvert, en gestion. */
async function openPatrimoine(t, project = PROJECT) {
  const site = await startSite(t);
  const page = await openPage(t, browser, { base: site.base });
  await page.goto('/secours.html');
  await page.locator('#modeBtn').click();
  await page.locator('#loginPw').fill('admin');
  await page.locator('#loginForm button[type=submit]').click();
  await page.getByRole('tab', { name: 'Projet' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#openProject').setInputFiles({ name: 'patrimoine.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await toast(page, '✓ Projet ouvert');
  return page;
}

async function asStudent(t) {
  const page = await openPatrimoine(t);
  await page.locator('#modeBtn').click();
  await page.locator('.label').first().waitFor();
  return page;
}

const reader = (page) => page.locator('#dlgRead');
async function openFiche(page, title) {
  await page.locator('.label', { hasText: title }).locator('h3').click();
  await reader(page).locator('h2', { hasText: title }).waitFor();
  return reader(page);
}
const textOf = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.textContent.trim().replace(/\s+/g, ' ')));

test('CHP-02, LIS-01, LIS-02 : la liste des fiches suit le modèle : titre, sous-titre, champs marqués « dans la liste », recherche', async (t) => {
  const page = await asStudent(t);
  const card = page.locator('.label').first();
  assert.equal(await card.locator('h3').textContent(), 'Cathédrale');
  assert.equal(await card.locator('.sci').textContent(), 'Rouen');
  assert.deepEqual(await textOf(card.locator('.fam')), ['13 e']);
  assert.match(await page.locator('.panel .sub').textContent(), /Notez vos réponses directement dans les cases/);

  await page.locator('#search').fill('dives');
  assert.deepEqual(await textOf(page.locator('.label h3')), ['Halle'], 'le sous-titre sert à la recherche');
  await page.locator('#search').fill('gothique');
  await page.getByText('Aucune fiche ne correspond à ce filtre.').waitFor();
  await page.locator('#search').fill('');
  await page.locator('.label').nth(1).waitFor();
});

test('CHP-02, CON-01, CON-02 : la fiche ouverte range chaque champ selon sa place dans le modèle, et tait ce qui est vide', async (t) => {
  const page = await asStudent(t);
  const dialog = await openFiche(page, 'Cathédrale');
  assert.equal(await dialog.locator('.sci').textContent(), 'Rouen');
  assert.deepEqual(await textOf(dialog.locator('.facts > div')), ['Siècle13 e', 'Visité le02/10/2026', 'StyleGothique'], 'en tête, hors intertitre');
  assert.equal(await dialog.locator('h3.mini-h').textContent(), 'À regarder');
  assert.equal(await dialog.getByText('Faites le tour du bâtiment.').count(), 1);
  assert.deepEqual(await textOf(dialog.locator('.needs .need')), ['🏛️FaçadeDeux tours inégales', 'Monument historiqueOui'], 'en tableau, sous l’intertitre');
  assert.equal(await dialog.locator('.measures h3').textContent(), 'Vos réponses');
  assert.equal(await dialog.locator('.measures p').textContent(), 'Répondez sur place.');
  assert.deepEqual(await textOf(dialog.locator('.prose h3')), ['Histoire'], 'en paragraphe, après un intertitre sans libellé');
  assert.equal(await dialog.getByText('Monet').count(), 1);
  await dialog.locator('[data-close]').first().click();

  const empty = await openFiche(page, 'Halle');
  assert.equal(await empty.locator('.facts, .needs, h3.mini-h').count(), 0, 'une fiche vide ne montre que ses questions');
  assert.equal(await empty.locator('.prose h3').count(), 0);
  assert.equal(await empty.locator('.measure-grid [data-k]').count(), 6);
});

test('CHP-03, MES-01, MES-02, MES-03, MES-04 : chaque question a sa saisie, enregistrée aussitôt, et la carte de la liste montre la même réponse', async (t) => {
  const page = await asStudent(t);
  const dialog = await openFiche(page, 'Cathédrale');
  assert.equal(await dialog.locator('#m-c-hauteur').getAttribute('inputmode'), 'numeric', 'le clavier du téléphone suit la question');
  assert.equal(await dialog.locator('#m-c-age').getAttribute('inputmode'), null);
  assert.deepEqual(
    await dialog.locator('#m-c-age, #m-c-hauteur, #m-c-impression').evaluateAll((inputs) => inputs.map((input) => input.maxLength)),
    [300, 50, 2000],
    'CHP-07 : une réponse trop longue ferait refuser tout le rendu'
  );
  assert.deepEqual(await textOf(dialog.locator('[data-k="c-etat"] .choice')), ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐']);

  await dialog.locator('#m-c-age').fill('environ 800 ans');
  await dialog.locator('#m-c-hauteur').fill('très haute');
  await dialog.locator('[data-k="c-ouvert"] .choice', { hasText: 'Non' }).click();
  await dialog.locator('[data-k="c-materiaux"] .choice', { hasText: 'Pierre' }).click();
  await dialog.locator('[data-k="c-materiaux"] .choice', { hasText: 'Bois' }).click();
  await dialog.locator('[data-k="c-etat"] .choice').nth(2).click();
  await dialog.locator('#m-c-impression').fill('Immense.\nEt sombre.');
  await dialog.locator('.saved-note', { hasText: '✓ Enregistré' }).waitFor();
  await dialog.locator('[data-close]').first().click();

  const card = page.locator('.label', { hasText: 'Cathédrale' });
  assert.equal(await card.locator('[data-answer="c-age"]').inputValue(), 'environ 800 ans');
  assert.equal(await card.locator('[data-answer="c-hauteur"]').inputValue(), 'très haute', 'MES-04 : la saisie reste libre');
  assert.equal(await card.locator('[data-answer="c-ouvert"]').inputValue(), 'non', 'un oui / non, en liste déroulante');
  assert.equal(
    await card.locator('[data-answer="c-materiaux"], [data-answer="c-etat"], [data-answer="c-impression"]').count(),
    0,
    'ni choix multiple, ni texte long, ni question hors liste'
  );
  assert.equal(await card.locator('label', { has: page.locator('[data-answer="c-hauteur"]') }).getAttribute('title'), 'Hauteur (m)');
  await card.locator('[data-answer="c-ouvert"]').selectOption('oui');
  await card.locator('[data-answer="c-age"]').fill('800 ans');

  await page.waitForTimeout(400);
  await page.reload();
  await page.locator('.label').first().waitFor();
  const again = await openFiche(page, 'Cathédrale');
  assert.equal(await again.locator('#m-c-age').inputValue(), '800 ans');
  assert.equal(await again.locator('[data-k="c-ouvert"] input[value="oui"]').isChecked(), true, 'changé depuis la liste');
  assert.deepEqual(await again.locator('[data-k="c-materiaux"] input:checked').evaluateAll((inputs) => inputs.map((input) => input.value)), ['pierre', 'bois']);
  assert.equal(await again.locator('[data-k="c-etat"] input[value="3"]').isChecked(), true);
  assert.equal(await again.locator('#m-c-impression').inputValue(), 'Immense.\nEt sombre.');
});

test('CHP-04 : ce qui est révélé à la correction ne paraît qu’une fois le travail vérifié, et la note de l’enseignant jamais', async (t) => {
  const page = await asStudent(t);
  let dialog = await openFiche(page, 'Cathédrale');
  assert.equal(await dialog.getByText('Architecte').count(), 0);
  assert.equal(await dialog.getByText('Pour moi').count(), 0);
  await dialog.locator('#readPlace').click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  page.once('dialog', (confirm) => confirm.accept());
  await page.locator('#verifyBtn').click();
  await page.locator('#dlgResults[open]').waitFor();
  await page.locator('#dlgResults [data-close]').click();

  dialog = await openFiche(page, 'Cathédrale');
  assert.deepEqual(await textOf(dialog.locator('.facts > div', { hasText: 'Architecte' })), ['ArchitecteJean d’Andeli'], 'révélé avec les positions réelles');
  assert.equal(await dialog.getByText('Demander la clé').count(), 0);
});

test('CHP-05, EDI-01, EDI-03, EDI-05, EDI-06 : le formulaire d’une fiche suit le modèle, questions comprises dans le fichier de secours', async (t) => {
  const page = await openPatrimoine(t);
  await page.getByRole('tab', { name: 'Fiches', exact: true }).click();
  await page.locator('#newFiche').click();
  const form = page.locator('#eFields');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'e-c-nom', 'on écrit d’abord le titre');
  assert.equal(await form.locator('#e-c-nom').getAttribute('placeholder'), 'Église Saint-Paul');
  const day = await page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
  assert.equal(await form.locator('#e-c-visite').inputValue(), day, 'EDI-05 : la date du jour, celle de l’appareil');
  assert.deepEqual(await textOf(form.locator('.needs-edit h3')), ['À regarder', 'Vos réponses']);
  assert.equal(
    await form.locator('.needs-edit', { hasText: 'À regarder' }).locator('#emojiBar').count(),
    1,
    'la barre d’émojis va au premier groupe qui a du texte'
  );
  assert.deepEqual(await textOf(form.locator('.aud')), ['Révélé à la correction', 'Pour vous seul']);
  assert.equal(await form.locator('label[for="e-c-architecte"] .aud').textContent(), 'Révélé à la correction');
  assert.equal(await form.locator('#e-c-materiaux input[type=checkbox]').count(), 3);
  assert.deepEqual(
    await form.locator('#e-c-nom, #e-c-facade, #e-c-hauteur').evaluateAll((inputs) => inputs.map((input) => input.maxLength)),
    [300, 10000, 50],
    'CHP-07 : le serveur refuserait tout le cours, et l’élève tout son rendu'
  );

  await page.locator('#eSave').click();
  await toast(page, 'Indiquez au moins « Monument » ou « Ville »');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'e-c-nom');

  await form.locator('#e-c-nom').fill('Halle aux grains');
  await form.locator('#e-c-facade').click();
  await form.locator('[data-emoji="🌳"]').click();
  await form.locator('#e-c-style').selectOption('roman');
  await form.locator('#e-c-classe').selectOption('non');
  await form.locator('#e-c-materiaux input[value="brique"]').check();
  await form.locator('#e-c-etat').selectOption('2');
  await form.locator('#e-c-hauteur').fill('12');
  await form.locator('#e-c-prof').fill('Fermée le lundi');
  await page.locator('#eSave').click();
  await toast(page, '✓ Fiche créée');

  await page.locator('.row', { hasText: 'Halle aux grains' }).locator('[data-edit]').click();
  assert.equal(await form.locator('#e-c-facade').inputValue(), '🌳');
  assert.equal(await form.locator('#e-c-style').inputValue(), 'roman');
  assert.equal(await form.locator('#e-c-classe').inputValue(), 'non');
  assert.equal(await form.locator('#e-c-materiaux input[value="brique"]').isChecked(), true);
  assert.equal(await form.locator('#e-c-etat').inputValue(), '2');
  assert.equal(await form.locator('#e-c-hauteur').inputValue(), '12', 'EDI-10 : la réponse notée par l’enseignant');
  assert.equal(await form.locator('#e-c-prof').inputValue(), 'Fermée le lundi');
  await page.locator('#dlgEdit [data-close]').first().click();

  await page.locator('[data-tab=projet]').click();
  page.once('dialog', (dialog) => dialog.accept('essai'));
  const download = page.waitForEvent('download');
  await page.locator('#saveJson').click();
  const saved = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.deepEqual(saved.template, PATRIMOINE, 'MOD-01 : le fichier enregistré garde son modèle');
  const halle = saved.maps[0].fiches.find((fiche) => fiche['c-nom'] === 'Halle aux grains');
  assert.equal(halle['c-style'], 'roman');
  assert.equal(halle['c-prof'], 'Fermée le lundi');
  assert.deepEqual(saved.progress.m1.entries[halle.id]['c-materiaux'], ['brique']);
  assert.equal(saved.progress.m1.entries[halle.id]['c-etat'], 2);
});

test('CHP-04 : la version élèves du fichier de secours n’emporte pas la note de l’enseignant, mais garde ce qui sera révélé', async (t) => {
  const page = await openPatrimoine(t);
  page.once('dialog', (dialog) => dialog.accept('Pour les élèves'));
  const download = page.waitForEvent('download');
  await page.locator('#exportStudents').click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'Pour les élèves.json');
  const [cathedrale] = JSON.parse(await readFile(await file.path(), 'utf8')).maps[0].fiches;
  assert.equal(cathedrale['c-prof'], undefined);
  assert.equal(cathedrale['c-architecte'], 'Jean d’Andeli', 'comme les positions réelles, montré après la vérification');
  assert.equal(cathedrale['c-histoire'], 'Peinte par Monet.');
});

test('TAB-09 : le modèle de tableur d’un cours prend ses colonnes dans son modèle de fiche', async (t) => {
  const page = await openPatrimoine(t);
  await page.getByRole('tab', { name: 'Fiches', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.locator('#sheetTemplate').click();
  const [header, example] = (await readFile(await (await download).path(), 'utf8')).replace(/^﻿/, '').split('\r\n');
  assert.equal(
    header,
    'Réf. photo;Monument;Ville;Siècle (e);Visité le;Style;Façade;Monument historique;Âge estimé;Hauteur (m);Est-il ouvert ?;Matériaux;État;Votre impression;Histoire;Architecte;Pour moi;Visible élèves (oui/non);Position réelle X (%);Position réelle Y (%)'
  );
  assert.match(example, /^1;Église Saint-Paul;;;\d{4}-\d{2}-\d{2};Roman;/);
});
