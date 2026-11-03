/**
 * Un lancement de bout en bout, dans Chromium : l'enseignant et les élèves dans des navigateurs séparés.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, cheapHash } from '../helpers.js';
import { ADMIN, heading, launchBrowser, logIn, makePng, openPage, startSite } from './helpers.js';
import { readQr } from './qr-reader.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const PNG = makePng(40, 20);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');
const REF_X = 12.3456;
const REF_Y = 65.4321;
const NAMES = 'Léa Dupont';

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

async function setup(t, { viewport } = {}) {
  const site = await startSite(t);
  const accountId = addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const teacher = await openPage(t, browser, { base: site.base, viewport });
  await logIn(teacher, TEACHER, '/prof');
  await heading(teacher, 'Mes cours');
  return { site, teacher, accountId };
}

const fiche = (id, common, extra = {}) => ({ id, common, visible: true, refX: REF_X, refY: REF_Y, media: [], ...extra });
const twoMaps = {
  format: 'inventaire-botanique',
  version: 3,
  title: 'Sortie au parc',
  theme: { preset: 'ocean', icon: 'wave' },
  maps: [
    { id: 'm1', name: 'Parc', image: PNG_URL, fiches: [fiche('f1', 'Olivier'), fiche('f2', 'Laurier'), fiche('secret', 'Fiche masquée', { visible: false })] },
    { id: 'm2', name: 'Bord de mer', image: PNG_URL, fiches: [fiche('f3', 'Tamaris')] }
  ]
};

/** Un cours publié, par l'API de la page : plus rapide que de le remplir à la main, qui a ses propres tests. */
async function publishedCourse(teacher, draft = twoMaps) {
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

const student = (t, site, options = {}) => openPage(t, browser, { base: site.base, ...options });

async function enter(page, code, names = NAMES) {
  await page.goto(`/c/${code}`);
  await page.getByLabel(/Votre prénom et votre nom/).fill(names);
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.locator('.label').first().waitFor();
}

/** Attend que l'écriture regroupée soit partie, puis relit le travail enregistré dans ce navigateur. */
async function placeFirstFiche(page) {
  await page.locator('[data-place]').first().click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  await page.waitForTimeout(400);
}

/* --- COU-03 à COU-05 : lancer et rejoindre --- */

test('COU-04 : le QR code affiché mène bien au cours, et le code est écrit dessous', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);

  await teacher.getByRole('button', { name: 'Afficher le QR code' }).click();
  const qr = teacher.locator('.qr-box svg');
  await qr.waitFor();
  const text = await readQr(teacher, qr);
  assert.equal(text, `${site.base}/c/${code}`);
  assert.equal(await teacher.locator('dialog[open] .launch-code').textContent(), code);
  const { host } = new URL(site.base);
  await teacher.locator('dialog[open]').getByText(`${host}/accueil`).waitFor();

  // En grand : le code occupe l'essentiel de l'écran, sans en sortir
  const box = await qr.boundingBox();
  assert.ok(box.width >= 400, `${box.width} px de large`);
  assert.ok(box.x >= 0 && box.x + box.width <= 1280);
  await teacher.locator('dialog[open] button.x').click();
  assert.equal(await teacher.locator('dialog[open]').count(), 0);
});

test('COU-05 : scanner le QR code suffit pour entrer, sans compte, et l’élève voit le cours et ses fiches', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await page.goto(`/c/${code}`);
  await page.getByRole('heading', { name: 'Rejoindre « Sortie au parc »' }).waitFor();
  await page.getByLabel(/Votre prénom et votre nom/).fill(NAMES);
  await page.getByRole('button', { name: 'Commencer' }).click();

  await page.locator('.label', { hasText: 'Olivier' }).waitFor();
  assert.equal(await page.locator('#pageTitle').textContent(), 'Sortie au parc');
  assert.equal(await page.locator('#studentName').textContent(), NAMES);
  assert.equal(await page.locator('.label').count(), 2, 'la fiche masquée n’y est pas');
  assert.equal(await page.locator('#verifyBtn').count(), 0, 'la correction attendra la fin du cours');
  assert.equal(await page.locator('.pin').count(), 0, 'aucune position réelle à l’écran');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent') !== ''), true, 'le thème du cours');
});

test('COU-05 : taper le code sur l’accueil mène au cours, en minuscules comme avec des espaces', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await page.goto('/accueil');
  await page.getByRole('link', { name: 'Espace enseignant' }).waitFor();

  await page.getByLabel('Code du cours').fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Rejoindre le cours' }).click();
  await page.getByRole('alert').getByText("Ce code n'existe pas").waitFor();
  assert.match(page.url(), /\/accueil$/, 'on reste ici pour corriger');

  await page.getByLabel('Code du cours').fill(`${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`);
  await page.getByRole('button', { name: 'Rejoindre le cours' }).click();
  await page.getByRole('heading', { name: 'Rejoindre « Sortie au parc »' }).waitFor();
  assert.match(page.url(), new RegExp(`/c/${code}$`));
});

test('une adresse tapée en minuscules reste valable', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code.toLowerCase());
  await page.goto(`/c/${code}`);
  await page.locator('.label').first().waitFor();
  assert.equal(await page.locator('#studentName').textContent(), NAMES, 'le même élève, même écrit autrement');
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 1);
});

test('un code inconnu s’explique, et propose d’en taper un autre', async (t) => {
  const { site } = await setup(t);
  const page = await student(t, site);
  await page.goto('/c/ZZZZZZ');
  await page.getByText("Ce code n'existe pas").waitFor();
  await page.getByRole('link', { name: 'Taper un autre code' }).click();
  await page.getByLabel('Code du cours').waitFor();
});

test('sans réseau au moment d’entrer, la page le dit et propose de réessayer', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await page.route('**/api/join/**', (route) => route.abort());
  await page.goto(`/c/${code}`);
  await page.getByText('Le serveur ne répond pas').waitFor();
  await page.unroute('**/api/join/**');
  await page.getByRole('link', { name: 'Réessayer' }).click();
  await page.getByRole('heading', { name: 'Rejoindre « Sortie au parc »' }).waitFor();
});

test('ANO-04 : les noms sont obligatoires, et un refus du serveur s’affiche sur place', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await page.goto(`/c/${code}`);
  await page.getByRole('button', { name: 'Commencer' }).click();
  assert.equal(await page.getByLabel(/Votre prénom et votre nom/).evaluate((input) => input.validity.valueMissing), true);
  assert.equal(await page.getByLabel(/Votre prénom et votre nom/).getAttribute('maxlength'), '120');

  await page.getByLabel(/Votre prénom et votre nom/).fill('    ');
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.getByRole('alert').getByText('Indiquez votre prénom et votre nom').waitFor();
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
});

/* --- CRG-01 : ce qui arrive dans le navigateur --- */

test('CRG-01 : aucune position réelle n’arrive dans le navigateur de l’élève, sur aucune requête', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  const answers = [];
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/')) answers.push(response.text().catch(() => ''));
  });
  await enter(page, code);
  await page.waitForTimeout(200);
  assert.ok(answers.length >= 3, 'les réponses sont bien écoutées');
  for (const text of await Promise.all(answers)) {
    assert.doesNotMatch(text, /refX|refY|Fiche masquée|secret/);
    assert.ok(!text.includes(String(REF_X)) && !text.includes(String(REF_Y)));
  }
  const stored = await page.evaluate(() => document.documentElement.outerHTML);
  assert.ok(!stored.includes(String(REF_X)));
});

/* --- E-01 : plusieurs cartes --- */

test('E-01 : l’élève choisit sa carte, et ses placements restent sur chacune', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  assert.equal(await page.locator('#mapName').textContent(), 'Parc');
  assert.deepEqual(await page.locator('#mapChoice option').allTextContents(), ['Parc', 'Bord de mer']);
  await placeFirstFiche(page);

  await page.locator('#mapChoice').selectOption({ label: 'Bord de mer' });
  await page.locator('.label', { hasText: 'Tamaris' }).waitFor();
  assert.equal(await page.locator('#mapName').textContent(), 'Bord de mer');
  assert.equal(await page.locator('.pin').count(), 0);

  await page.locator('#mapChoice').selectOption({ label: 'Parc' });
  await page.locator('.label', { hasText: 'Olivier' }).waitFor();
  assert.equal(await page.locator('.pin').count(), 1);
  assert.equal(await page.locator('#mapChoice').inputValue(), 'm1');
});

test('avec une seule carte, pas de choix à faire', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher, { ...twoMaps, maps: [twoMaps.maps[0]] }));
  const page = await student(t, site);
  await enter(page, code);
  assert.equal(await page.locator('#mapChoiceBox').isVisible(), false);
});

test('une carte sans plan le dit au lieu d’afficher une image cassée', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher, { ...twoMaps, maps: [{ ...twoMaps.maps[0], image: '' }] }));
  const page = await student(t, site);
  await enter(page, code);
  await page.locator('#planEmpty').getByText("Cette carte n'a pas d'image du plan").waitFor();
  assert.equal(await page.locator('#plan').isVisible(), false);
});

/* --- Reprendre, et repartir à zéro (COU-09) --- */

test('revenir sur le même QR code reprend le même élève et son travail, sans créer personne', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  await placeFirstFiche(page);

  await page.goto(`/c/${code}`);
  await page.locator('.pin').first().waitFor();
  assert.equal(await page.locator('#studentName').textContent(), NAMES);
  assert.equal(await page.locator('#progress').textContent(), '1 / 2 fiche(s) placée(s)');
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 1);
});

test('fermer l’onglet juste après un placement ne le perd pas', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  await page.locator('[data-place]').first().click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  // Sans attendre l'écriture regroupée : c'est le changement d'état de la page qui la déclenche
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(100);
  await page.reload();
  await page.locator('.pin').first().waitFor();
});

test('COU-09 : un nouveau lancement repart à zéro sur le même appareil, même pour un même cours', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await publishedCourse(teacher);
  const first = await launch(teacher, course);
  const page = await student(t, site);
  await enter(page, first);
  await placeFirstFiche(page);

  const second = await launch(teacher, course);
  assert.notEqual(second, first);
  await enter(page, second, 'Tom Martin');
  assert.equal(await page.locator('#studentName').textContent(), 'Tom Martin');
  assert.equal(await page.locator('.pin').count(), 0, 'rien du lancement précédent');
  assert.equal(await page.locator('#progress').textContent(), '0 / 2 fiche(s) placée(s)');

  // Et le premier retrouve son travail
  await page.goto(`/c/${first}`);
  await page.locator('.pin').first().waitFor();
  assert.equal(await page.locator('#studentName').textContent(), NAMES);
});

test('sur un appareil partagé, « Ce n’est pas vous ? » laisse entrer quelqu’un d’autre, sans le travail du précédent', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  await placeFirstFiche(page);

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: "Ce n'est pas vous ?" }).click();
  assert.equal(await page.locator('#studentName').textContent(), NAMES, 'annuler ne change rien');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: "Ce n'est pas vous ?" }).click();
  await page.getByLabel(/Votre prénom et votre nom/).fill('Tom Martin');
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.locator('.label').first().waitFor();
  assert.equal(await page.locator('#studentName').textContent(), 'Tom Martin');
  assert.equal(await page.locator('.pin').count(), 0);
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 2);
});

test('sans stockage dans le navigateur, l’élève est prévenu et peut quand même travailler', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new Error('stockage indisponible');
    };
  });
  await enter(page, code);
  await page.locator('#fatal').getByText('Ne fermez pas cette page').waitFor();
  await placeFirstFiche(page);
  assert.equal(await page.locator('.pin').count(), 1);
});

test('une écriture refusée par le navigateur s’affiche en clair', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      this.transaction.abort();
      return request;
    };
  });
  await enter(page, code);
  await page.locator('[data-place]').first().click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('#toast', { hasText: '⚠ Enregistrement impossible : transaction annulée' }).waitFor();
});

/* --- SUI-01, SUI-02 : suivre --- */

test('SUI-01, SUI-02 : un élève qui entre apparaît chez l’enseignant sans recharger la page', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  await teacher.getByText('Aucun élève pour le moment.').waitFor();
  const page = await student(t, site);
  await enter(page, code);

  const row = teacher.locator('.participants li', { hasText: NAMES });
  await row.waitFor({ timeout: 8000 });
  assert.match(await row.textContent(), /A commencé/);
  assert.equal(await teacher.getByText('Aucun élève pour le moment.').isVisible(), false);
  await teacher.getByText('1 élève(s) ou groupe(s) entré(s).').waitFor();
});

test('SUI-01 : l’état « a fini » s’affiche, avec le rendu tardif signalé', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  await enter(await student(t, site), code, 'Tom Martin');
  // Le rendu arrive à l'étape 5 : l'état se lit déjà dans la base
  site.db.prepare("UPDATE participants SET submitted_at = '2026-01-01T00:00:00.000Z' WHERE names = ?").run(NAMES);
  site.db.prepare("UPDATE participants SET submitted_at = '2026-01-01T00:00:00.000Z', late = 1 WHERE names = 'Tom Martin'").run();
  await teacher.reload();
  await teacher.locator('.participants li', { hasText: NAMES }).getByText('A fini', { exact: true }).waitFor();
  await teacher.locator('.participants li', { hasText: 'Tom Martin' }).getByText('A fini, après la fin du cours').waitFor();
});

test('un nom d’élève piégé reste du texte', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const trap = '<img src=x onerror="window.piege=1">';
  const page = await student(t, site);
  await enter(page, code, trap);
  assert.equal(await page.locator('#studentName').textContent(), trap);
  await teacher.locator('.participants li', { hasText: trap }).waitFor({ timeout: 8000 });
  assert.equal(await teacher.evaluate(() => window.piege), undefined);
  assert.equal(await page.evaluate(() => window.piege), undefined);
});

test('si la liste ne peut plus se mettre à jour, elle reste affichée avec un message, puis repart', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  await teacher.locator('.participants li', { hasText: NAMES }).waitFor({ timeout: 8000 });

  await teacher.route('**/api/launches/*', (route) => route.abort());
  const refresh = () => teacher.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await refresh();
  await teacher.getByRole('alert').getByText('Liste non mise à jour').waitFor();
  assert.equal(await teacher.locator('.participants li').count(), 1);

  await teacher.unroute('**/api/launches/*');
  await refresh();
  await teacher.getByRole('alert').getByText('Liste non mise à jour').waitFor({ state: 'hidden' });

  site.db.exec('DELETE FROM sessions');
  await refresh();
  await teacher.getByRole('alert').getByText('Votre session a expiré').waitFor();
});

/* --- COU-08 : terminer --- */

test('COU-08 : terminer coupe le QR code et le code ; la liste reste, et l’élève en est informé', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  await placeFirstFiche(page);
  await teacher.locator('.participants li', { hasText: NAMES }).waitFor({ timeout: 8000 });

  teacher.once('dialog', (dialog) => dialog.dismiss());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByRole('button', { name: 'Afficher le QR code' }).waitFor();
  assert.equal(site.db.prepare('SELECT ended_at FROM launches').get().ended_at, null, 'annuler ne termine pas');

  await teacher.getByRole('button', { name: 'Afficher le QR code' }).click();
  await teacher.locator('dialog[open] button.x').click();
  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();
  assert.equal(await teacher.getByRole('button', { name: 'Afficher le QR code' }).isVisible(), false);
  assert.equal(await teacher.getByRole('button', { name: 'Terminer le cours' }).isVisible(), false);
  assert.equal(await teacher.locator('.participants li').count(), 1, 'ANO-05 : les noms restent');

  // L'élève déjà entré garde son travail, et l'apprend
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#courseBanner').getByText("L'enseignant a terminé ce cours").waitFor();
  assert.equal(await page.locator('.pin').count(), 1);
  await page.reload();
  await page.locator('.pin').first().waitFor();

  // Personne d'autre n'entre
  const late = await student(t, site);
  await late.goto(`/c/${code}`);
  await late.getByText('Ce cours est terminé').waitFor();
  await late.goto('/accueil');
  await late.getByLabel('Code du cours').fill(code);
  await late.getByRole('button', { name: 'Rejoindre le cours' }).click();
  await late.getByRole('alert').getByText('Ce cours est terminé').waitFor();
});

test('si terminer échoue, le message s’affiche et le bouton reste utilisable', async (t) => {
  const { teacher } = await setup(t);
  await launch(teacher, await publishedCourse(teacher));
  await teacher.route('**/api/launches/*/end', (route) => route.abort());
  teacher.on('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByRole('alert').getByText('Le serveur ne répond pas').waitFor();
  assert.equal(await teacher.getByRole('button', { name: 'Terminer le cours' }).isEnabled(), true);
  await teacher.unroute('**/api/launches/*/end');
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();
});

test('un QR code resté ouvert se ferme quand le cours se termine', async (t) => {
  const { site, teacher } = await setup(t);
  await launch(teacher, await publishedCourse(teacher));
  await teacher.getByRole('button', { name: 'Afficher le QR code' }).click();
  await teacher.locator('.qr-box svg').waitFor();
  site.db.prepare('UPDATE launches SET ended_at = ?').run(new Date().toISOString());
  await teacher.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await teacher.locator('.qr-box svg').waitFor({ state: 'hidden' });
});

/* --- Les écrans de l'enseignant autour du lancement --- */

test('COU-01 : sans publication, le bouton de lancement est bloqué et dit pourquoi', async (t) => {
  const { teacher } = await setup(t);
  await teacher.getByLabel('Nom du nouveau cours').fill('Brouillon');
  await teacher.getByRole('button', { name: 'Créer le cours' }).click();
  await teacher.locator('#planChoose').waitFor();
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  assert.equal(await teacher.getByRole('button', { name: 'Lancer le cours' }).isDisabled(), true);
  await teacher.locator('#launchHint').getByText("Publiez d'abord le cours").waitFor();
});

test('COU-11 : l’enseignant sait quelle version il lance, et que ses modifications n’y sont pas', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await publishedCourse(teacher);
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.locator('#launchHint', { hasText: 'Les élèves verront la version 1.' }).waitFor();
  assert.doesNotMatch(await teacher.locator('#launchHint').textContent(), /modifications/);

  await teacher.locator('#projName').fill('Autre nom');
  await teacher.locator('#saveName').click();
  await teacher.locator('#launchHint', { hasText: "Vos dernières modifications n'y seront pas" }).waitFor();
  assert.equal(await teacher.getByRole('button', { name: 'Lancer le cours' }).isEnabled(), true);
  assert.ok(site);
});

test('COU-07 : les lancements d’un cours se retrouvent, et un cours en cours se suit depuis la liste', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await publishedCourse(teacher);
  const code = await launch(teacher, course);
  await enter(await student(t, site), code);
  const launchUrl = teacher.url();

  await teacher.goto('/prof');
  await teacher.getByRole('link', { name: 'Suivre le cours' }).click();
  await teacher.getByRole('heading', { name: 'Pour rejoindre le cours' }).waitFor();
  assert.equal(teacher.url(), launchUrl);

  await teacher.getByRole('link', { name: '← Retour au cours' }).click();
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  const row = teacher.locator('#launchList li');
  await row.first().waitFor();
  assert.match(await row.first().textContent(), new RegExp(`En cours depuis .*code ${code}.*1 élève`));

  await row.first().getByRole('link').click();
  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.locator('#launchList li', { hasText: 'Terminé le' }).waitFor();

  await teacher.goto('/prof');
  await teacher.locator('.course-row').waitFor();
  assert.equal(await teacher.getByRole('link', { name: 'Suivre le cours' }).count(), 0, 'plus rien à suivre');
});

test('si le lancement échoue, le message s’affiche sur place', async (t) => {
  const { teacher } = await setup(t);
  const course = await publishedCourse(teacher);
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.route('**/api/courses/*/launches', (route) => (route.request().method() === 'POST' ? route.abort() : route.fallback()));
  await teacher.getByRole('button', { name: 'Lancer le cours' }).click();
  await teacher.locator('#launchError').getByText('Lancement impossible').waitFor();
});

test('si la liste des lancements ne se charge pas, le reste de l’onglet fonctionne', async (t) => {
  const { teacher } = await setup(t);
  const course = await publishedCourse(teacher);
  await teacher.route('**/api/courses/*/launches', (route) => route.abort());
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.locator('#launchList').getByText('Liste des lancements indisponible').waitFor();
});

test('ENS-03 : la page d’un lancement inconnu ou d’un autre enseignant ne montre rien', async (t) => {
  const { site, teacher } = await setup(t);
  await launch(teacher, await publishedCourse(teacher));
  const id = site.db.prepare('SELECT id FROM launches').get().id;
  addAccount(site.db, { email: 'autre@example.org', hash: cheapHash(TEACHER.password) });
  const other = await openPage(t, browser, { base: site.base });
  await logIn(other, { email: 'autre@example.org', password: TEACHER.password }, '/prof');
  await heading(other, 'Mes cours');
  await other.goto(`/prof/lancements/${id}`);
  await other.getByText('Ce lancement est introuvable.').waitFor();
  await other.getByRole('link', { name: 'Revenir à mes cours' }).click();
  await heading(other, 'Mes cours');
});

test('sans session, la page d’un lancement ramène à la connexion', async (t) => {
  const { site, teacher } = await setup(t);
  await launch(teacher, await publishedCourse(teacher));
  const id = site.db.prepare('SELECT id FROM launches').get().id;
  const anonymous = await openPage(t, browser, { base: site.base });
  await anonymous.goto(`/prof/lancements/${id}`);
  await anonymous.getByRole('button', { name: 'Se connecter' }).waitFor();
});

/* --- ADM-06, ADM-10 : compte désactivé ou supprimé --- */

test('le cours d’un compte effacé : l’élève lit qu’il n’existe plus, en ligne comme en revenant', async (t) => {
  const { site, teacher, accountId } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site);
  await enter(page, code);
  await placeFirstFiche(page);

  site.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#courseBanner').getByText("Ce cours n'existe plus").waitFor();
  assert.equal(await page.locator('.pin').count(), 1, 'il garde son travail à l’écran');

  await page.reload();
  await page.getByText("Ce cours n'existe plus").waitFor();
  await page.getByRole('link', { name: 'Taper un autre code' }).waitFor();
  assert.equal(await page.evaluate((code) => localStorage.getItem(`cartopoint.eleve.${code}`), code), null, 'le nom de l’élève ne reste pas sur l’appareil');
});

test('section 9, point 15 : avant de supprimer un compte, l’admin voit ses cours et ses lancements en cours', async (t) => {
  const { site, teacher, accountId } = await setup(t);
  await launch(teacher, await publishedCourse(teacher));
  site.db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(new Date().toISOString(), accountId);

  const admin = await openPage(t, browser, { base: site.base });
  await logIn(admin, ADMIN, '/admin');
  await admin.getByRole('button', { name: 'Supprimer le compte et ses cours' }).click();
  const dialog = admin.locator('dialog[open]');
  await dialog.getByText('1 cours').waitFor();
  await dialog.getByText('1 lancement(s) en cours').waitFor();

  await dialog.getByRole('button', { name: 'Annuler' }).click();
  site.db.prepare('UPDATE launches SET ended_at = ?').run(new Date().toISOString());
  await admin.reload();
  await admin.getByRole('button', { name: 'Supprimer le compte et ses cours' }).click();
  await admin.locator('dialog[open]').getByText('1 cours').waitFor();
  assert.equal(await admin.locator('dialog[open]').getByText('en cours').count(), 0, 'rien à signaler');
});

/* --- Sur un téléphone --- */

test('sur un téléphone, l’élève entre et travaille sans défilement sur le côté, même avec un très long nom', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher));
  const page = await student(t, site, { viewport: { width: 390, height: 780 } });
  await enter(page, code, 'Un-très-long-nom-sans-aucun-espace-pour-voir-ce-que-devient-la-barre-du-haut-sur-un-petit-écran');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(await overflow(), 0);
  const box = await page.locator('#studentName').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, `de ${box.x} à ${box.x + box.width}`);
  await page.locator('#mapChoice').waitFor();
  const select = await page.locator('#mapChoice').boundingBox();
  assert.ok(select.x + select.width <= 390);
});

test('sur un téléphone, le QR code et le code tiennent à l’écran', async (t) => {
  const { teacher } = await setup(t, { viewport: { width: 390, height: 780 } });
  await launch(teacher, await publishedCourse(teacher));
  await teacher.getByRole('button', { name: 'Afficher le QR code' }).click();
  const qr = await teacher.locator('.qr-box svg').boundingBox();
  assert.ok(qr.width >= 280, `${qr.width} px`);
  assert.ok(qr.x >= 0 && qr.x + qr.width <= 390);
  const code = await teacher.locator('dialog[open] .launch-code').boundingBox();
  assert.ok(code.x + code.width <= 390);
  assert.equal(await teacher.locator('dialog[open] .launch-code').evaluate((node) => node.scrollWidth <= node.clientWidth), true);
});

/* --- EV-34 --- */

test('EV-34 : ni l’accueil, ni la page élève ne parlent de botanique', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launch(teacher, await publishedCourse(teacher, { ...twoMaps, title: 'Sortie' }));
  const page = await student(t, site);
  const botany = /botani|inventaire|la plante|espèce/i;
  await page.goto('/accueil');
  await page.getByLabel('Code du cours').waitFor();
  assert.doesNotMatch(await page.evaluate(() => document.title + document.documentElement.textContent), botany);
  await enter(page, code);
  assert.doesNotMatch(await page.evaluate(() => document.title + document.documentElement.textContent), botany);
  assert.equal(await teacher.title(), 'Sortie — Cartopoint');
});
