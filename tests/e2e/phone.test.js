/**
 * Téléphone et ordinateur (MOB, Q-K) : la fiche que lit l'élève, sur un écran de téléphone tenu au doigt, et sur un grand
 * écran où elle s'ouvre à côté du plan. Vérifié sur le fichier de secours, qui a la même fenêtre de lecture que la page
 * d'un élève (views/reader.js) ; WebKit n'étant pas installé ici, un vrai iPhone reste à essayer en préproduction.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, makePng, openPage, startSite } from './helpers.js';

const PNG = makePng(40, 20);
const fiche = (id, common, more = {}) => ({ id, common, visible: true, refX: 50, refY: 50, media: [], ...more });
const PROJECT = {
  format: 'inventaire-botanique',
  version: 3,
  title: 'Parc',
  theme: {},
  maps: [
    {
      id: 'm1',
      name: 'Plan',
      image: 'data:image/png;base64,' + PNG.toString('base64'),
      fiches: [
        fiche('f1', 'Noisetier', { exposure: 'Mi-ombre', watering: 'Régulier' }),
        fiche('f2', 'Sureau'),
        fiche('f3', 'Tilleul'),
        fiche('cachee', 'Masquée', { visible: false })
      ]
    }
  ]
};

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

/** Le fichier de secours, le projet ouvert, côté élève. */
async function student(t, options) {
  const site = await startSite(t);
  const page = await openPage(t, browser, { base: site.base, ...options });
  await page.goto('/secours.html');
  await page.locator('#modeBtn').click();
  await page.locator('#loginPw').fill('admin');
  await page.locator('#loginForm button[type=submit]').click();
  await page.getByRole('tab', { name: 'Projet' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#openProject').setInputFiles({ name: 'parc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PROJECT)) });
  await page.locator('#toast', { hasText: '✓ Projet ouvert' }).waitFor();
  await page.locator('#modeBtn').click();
  await page.locator('.label').first().waitFor();
  return page;
}

const reader = (page) => page.locator('#dlgRead');
const open = async (page, name) => {
  await page.locator('.label', { hasText: name }).locator('h3').click();
  await reader(page).locator('h2', { hasText: name }).waitFor();
};

test('MOB-01 : sur un téléphone, la fiche prend tout l’écran, « Placer » reste sous le pouce, et chaque cible fait 44 px', async (t) => {
  const page = await student(t, { viewport: { width: 390, height: 844 }, touch: true });
  const card = page.locator('.label', { hasText: 'Noisetier' });
  const box = await card.locator('[data-answer="temperature"]').evaluate((input) => input.closest('label').getBoundingClientRect().height);
  assert.ok(box >= 44, `case de mesure de ${box} px`);
  assert.equal(
    await card.locator('[data-answer="temperature"]').evaluate((input) => getComputedStyle(input).fontSize),
    '16px',
    'l’iPhone ne grossit pas la page à la saisie'
  );
  assert.ok((await card.locator('[data-place]').boundingBox()).height >= 44);

  await open(page, 'Noisetier');
  const sheet = await reader(page).boundingBox();
  assert.deepEqual([sheet.x, sheet.width, Math.round(sheet.height)], [0, 390, 844], 'plein écran');
  const place = await page.locator('#readPlace').boundingBox();
  assert.ok(place.y + place.height > 844 - 90, `« Placer » à ${place.y} px, en bas de l’écran`);
  for (const step of await reader(page).locator('[data-step]').all()) assert.ok((await step.boundingBox()).width >= 44);

  const needs = reader(page).locator('details.read-group');
  assert.equal(await needs.locator('.need').first().isVisible(), true);
  await needs.locator('summary').click();
  assert.equal(await needs.locator('.need').first().isVisible(), false, 'le groupe se replie pour aller plus vite aux questions');
  assert.equal(await reader(page).locator('#m-temperature').isVisible(), true, 'les questions, jamais repliées');
});

test('MOB-02 : on passe d’une fiche à la suivante sans repasser par la liste, aux boutons comme au clavier', async (t) => {
  const page = await student(t);
  await open(page, 'Noisetier');
  const position = reader(page).locator('.read-nav .state');
  assert.equal(await position.textContent(), '1 / 3', 'les fiches visibles seulement');
  assert.equal(await reader(page).getByRole('button', { name: 'Fiche précédente' }).isDisabled(), true);
  await reader(page).getByRole('button', { name: 'Fiche suivante' }).click();
  await reader(page).locator('h2', { hasText: 'Sureau' }).waitFor();
  assert.equal(await position.textContent(), '2 / 3');
  await page.keyboard.press('ArrowRight');
  await reader(page).locator('h2', { hasText: 'Tilleul' }).waitFor();
  assert.equal(await reader(page).getByRole('button', { name: 'Fiche suivante' }).isDisabled(), true);
  await page.keyboard.press('ArrowLeft');
  await reader(page).locator('h2', { hasText: 'Sureau' }).waitFor();

  await reader(page).locator('#m-temperature').fill('21');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  assert.equal(await reader(page).locator('h2').textContent(), '2Sureau', 'dans une case, les flèches déplacent le curseur, pas la fiche');
  assert.equal(await reader(page).locator('#m-temperature').inputValue(), '21');
});

test('MOB-03 : sur un grand écran, la fiche s’ouvre à côté du plan, qui reste visible et cliquable ; Échap la ferme', async (t) => {
  const page = await student(t);
  await open(page, 'Noisetier');
  assert.equal(await reader(page).evaluate((dialog) => dialog.matches(':modal')), false, 'la page reste utilisable');
  const sheet = await reader(page).boundingBox();
  const plan = await page.locator('#plan').boundingBox();
  assert.ok(plan.x + plan.width <= sheet.x + 1, 'le plan n’est pas sous la fiche');
  await reader(page).locator('#readPlace').click();
  await page.mouse.click(plan.x + plan.width / 2, plan.y + plan.height / 2);
  await page.locator('.pin').first().waitFor();

  await open(page, 'Sureau');
  await page.keyboard.press('Escape');
  await reader(page).waitFor({ state: 'hidden' });

  await page.setViewportSize({ width: 1000, height: 800 });
  await open(page, 'Sureau');
  assert.equal(await reader(page).evaluate((dialog) => dialog.matches(':modal')), true, 'sur un écran moyen, la fiche passe devant le plan, comme avant');
});
