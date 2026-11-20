/**
 * Zéro plan ou plusieurs (CAR-07, CAR-08, Q-B, Q-N) : une carte sans image est une simple liste de fiches, qu'on lit et
 * à laquelle on répond sans rien placer, de la préparation à la correction ; des fiches sur un plan et d'autres sans, dans
 * le même cours.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, cheapHash } from '../helpers.js';
import { heading, launchBrowser, logIn, makePng, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const PLAN = makePng(100, 100);

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

const QUIZ = {
  fields: [
    { id: 'common', type: 'text', label: 'Roche', audience: 'info', role: 'title' },
    { id: 'c-dure', type: 'yesno', label: 'Est-elle dure ?', audience: 'question', list: true }
  ]
};
const fiche = (id, name, more = {}) => ({ id, common: name, visible: true, media: [], ...more });

async function setup(t) {
  const site = await startSite(t);
  addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const teacher = await openPage(t, browser, { base: site.base });
  await logIn(teacher, TEACHER, '/prof');
  await heading(teacher, 'Mes cours');
  return { site, teacher };
}

/** Crée le cours depuis la page de l'enseignant, avec un plan envoyé au serveur si `withPlan`. */
async function createCourse(teacher, maps, { publish = false } = {}) {
  const plan = await teacher.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return (await (await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes })).json()).url;
  }, PLAN.toString('base64'));
  return teacher.evaluate(
    async ({ draft, publish }) => {
      const send = async (url, body) => {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      };
      const created = await send('/api/courses', { draft });
      return publish ? send(`/api/courses/${created.id}/publish`, { revision: created.revision }) : created;
    },
    { draft: { format: 'inventaire-botanique', version: 4, title: 'Géologie', theme: {}, template: QUIZ, maps: maps(plan) }, publish }
  );
}

const draftOf = (site) => JSON.parse(site.db.prepare('SELECT draft FROM courses').get().draft);
const saved = (page) => page.locator('#saveState', { hasText: '✓ Enregistré' }).waitFor();
const nextConfirm = (page, accept = true) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('aucune confirmation demandée')), 5000);
    page.once('dialog', async (dialog) => {
      clearTimeout(timer);
      resolve(dialog.message());
      await (accept ? dialog.accept() : dialog.dismiss());
    });
  });

test('CAR-07, CAR-08 : l’enseignant fait d’une carte une liste, ajoute une liste, et y déplace une fiche, qui perd sa position réelle', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await createCourse(teacher, (plan) => [
    {
      id: 'm1',
      name: 'Carrière',
      image: plan,
      widthMeters: 50,
      fiches: [fiche('f1', 'Granite', { refX: 10, refY: 20 }), fiche('f2', 'Basalte', { refX: 30, refY: 40 })]
    }
  ]);
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cartes' }).click();
  teacher.once('dialog', (dialog) => dialog.accept('Salle de classe'));
  await teacher.getByRole('button', { name: '＋ Ajouter une liste sans plan' }).click();
  await teacher.locator('.map-row', { hasText: 'Salle de classe' }).getByText('Liste', { exact: true }).waitFor();
  assert.equal(await teacher.locator('#widthM').count(), 0, 'une liste n’a pas d’échelle');
  await teacher.locator('#planEmpty').getByText('les élèves y verront une simple liste').waitFor();
  await teacher.getByRole('tab', { name: 'Fiches' }).click();
  await teacher.locator('#newFiche').click();
  await teacher.locator('#e-common').fill('Calcaire');
  await teacher.locator('#eSave').click();
  assert.equal(await teacher.locator('#toast').textContent(), '✓ Fiche créée', 'rien à placer sur une liste');
  await teacher.getByRole('tab', { name: 'Cartes' }).click();

  await teacher.locator('.map-row', { hasText: 'Carrière' }).getByRole('button', { name: 'Afficher' }).click();
  await teacher.getByRole('tab', { name: 'Fiches' }).click();
  const asked = nextConfirm(teacher);
  await teacher.locator('.row', { hasText: 'Granite' }).locator('[data-move-to]').selectOption({ label: 'Salle de classe (liste)' });
  assert.match(await asked, /Sa position réelle sera effacée/);
  await teacher.locator('.row', { hasText: 'Granite' }).waitFor({ state: 'detached' });
  await saved(teacher);
  let content = draftOf(site);
  assert.deepEqual(
    content.maps.map((map) => [map.name, map.fiches.map((f) => [f.common, f.refX])]),
    [
      ['Carrière', [['Basalte', 30]]],
      [
        'Salle de classe',
        [
          ['Calcaire', null],
          ['Granite', null]
        ]
      ]
    ]
  );

  await teacher.getByRole('tab', { name: 'Cartes' }).click();
  const removal = nextConfirm(teacher);
  await teacher.locator('.map-row', { hasText: 'Carrière' }).getByRole('button', { name: "Retirer l'image" }).click();
  assert.match(await removal, /Les élèves y verront une simple liste de fiches\.\n\nLes 1 position\(s\) réelle\(s\) de ses fiches seront effacées\./);
  await saved(teacher);
  content = draftOf(site);
  assert.deepEqual([content.maps[0].image, content.maps[0].fiches[0].refX], ['', null]);

  await teacher.getByRole('tab', { name: 'Fiches' }).click();
  assert.equal(await teacher.locator('[data-place-ref]').count(), 0, 'rien à placer sur une liste');
  assert.equal(await teacher.locator('.ref-state:not(.missing-expected)').count(), 0);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.locator('#publishBtn').click();
  await teacher.locator('#publishState', { hasText: 'Version 1' }).waitFor();
});

test('CAR-07 : un cours sans plan, de bout en bout : l’élève lit, répond, termine sans rien placer, et reçoit sa correction et son compte rendu', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await createCourse(
    teacher,
    () => [
      {
        id: 'l1',
        name: 'Salle',
        image: '',
        fiches: [fiche('f1', 'Granite', { expected: { 'c-dure': 'oui' } }), fiche('f2', 'Craie', { expected: { 'c-dure': 'non' } })]
      }
    ],
    {
      publish: true
    }
  );
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.getByRole('button', { name: 'Lancer le cours' }).click();
  const code = (await teacher.locator('.launch-code').first().textContent()).trim();

  const student = await openPage(t, browser, { base: site.base, viewport: { width: 390, height: 844 }, touch: true });
  await student.goto(`/c/${code}`);
  await student.getByLabel(/Votre prénom et votre nom/).fill('Léa');
  await student.getByRole('button', { name: 'Commencer' }).click();
  await student.locator('.label').first().waitFor();
  assert.equal(await student.locator('main.stage').isVisible(), false, 'pas de plan : la liste prend toute la place');
  assert.equal(await student.locator('.panel h2').textContent(), 'Fiches');
  assert.equal(await student.locator('[data-place], [data-filter]').count(), 0, 'ni « Placer », ni filtres de placement');
  assert.equal(await student.locator('#mapChoiceBox').isHidden(), true, 'une seule carte');
  assert.match(await student.locator('.panel-foot .hint').textContent(), /^Quand vous avez fini : vos réponses seront figées, puis envoyées à l'enseignant\./);

  await student.locator('.label', { hasText: 'Granite' }).locator('[data-answer="c-dure"]').selectOption('oui');
  await student.locator('.label', { hasText: 'Craie' }).locator('h3').click();
  const dialog = student.locator('#dlgRead');
  assert.equal(await dialog.locator('#readPlace').count(), 0, 'rien à placer depuis la fiche');
  await dialog.locator('[data-k="c-dure"] .choice', { hasText: 'Oui' }).click();
  await dialog.locator('[data-close]').first().click();
  await student.waitForTimeout(400);
  const asked = new Promise((resolve) => student.once('dialog', (confirm) => (resolve(confirm.message()), confirm.accept())));
  await student.getByRole('button', { name: 'Terminer', exact: true }).click();
  assert.doesNotMatch(await asked, /pas placée/, 'aucune fiche à placer');
  await student.locator('.panel-foot').getByText('Vos réponses sont bien arrivées').waitFor();

  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();
  await student.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await student.locator('#seeCorrection').waitFor({ timeout: 10000 });
  await student.locator('#seeCorrection').click();
  const correction = student.locator('#dlgCorrection[open]');
  assert.deepEqual(await correction.locator('thead th').allTextContents(), ['N°', 'Fiche', 'Questions justes']);
  assert.deepEqual(await correction.locator('tbody td:last-child').allTextContents(), ['1 / 1', '0 / 1']);
  assert.equal(await correction.locator('.score').count(), 0, 'pas de score de placement');
  assert.equal(await correction.locator('.answers-score').textContent(), 'Questions : 1 juste, 1 fausse.');
  const download = student.waitForEvent('download');
  await correction.getByRole('button', { name: 'Télécharger le compte rendu (JPG)' }).click();
  assert.equal((await download).suggestedFilename(), 'Compte rendu - Léa.jpg', 'un compte rendu sans plan se dessine');
});

test('CAR-07, Q-N : des fiches sur un plan et d’autres sans, dans le même cours : l’élève passe de l’un à l’autre', async (t) => {
  const { site, teacher } = await setup(t);
  const course = await createCourse(
    teacher,
    (plan) => [
      { id: 'm1', name: 'Carrière', image: plan, fiches: [fiche('f1', 'Granite', { refX: 50, refY: 50 })] },
      { id: 'l1', name: 'Salle', image: '', fiches: [fiche('f2', 'Craie')] }
    ],
    { publish: true }
  );
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.getByRole('button', { name: 'Lancer le cours' }).click();
  const code = (await teacher.locator('.launch-code').first().textContent()).trim();
  const student = await openPage(t, browser, { base: site.base });
  await student.goto(`/c/${code}`);
  await student.getByLabel(/Votre prénom et votre nom/).fill('Léa');
  await student.getByRole('button', { name: 'Commencer' }).click();
  await student.locator('.label').first().waitFor();
  assert.deepEqual(await student.locator('#mapChoice option').allTextContents(), ['Carrière', 'Salle (liste)']);
  assert.equal(await student.locator('[data-place]').count(), 1);
  await student.locator('#mapChoice').selectOption({ label: 'Salle (liste)' });
  await student.locator('.label', { hasText: 'Craie' }).waitFor();
  assert.equal(await student.locator('main.stage').isVisible(), false);
  assert.equal(await student.locator('[data-place]').count(), 0);
  await student.locator('#mapChoice').selectOption({ label: 'Carrière' });
  await student.locator('.label', { hasText: 'Granite' }).waitFor();
  assert.equal(await student.locator('main.stage').isVisible(), true, 'le plan revient');
  const asked = new Promise((resolve) => student.once('dialog', (confirm) => (resolve(confirm.message()), confirm.dismiss())));
  await student.getByRole('button', { name: 'Terminer', exact: true }).click();
  assert.match(await asked, /^1 fiche\(s\) ne sont pas placée\(s\)/, 'seule la fiche du plan est à placer');
  assert.match(await student.locator('.panel-foot .hint').textContent(), /vos placements et vos réponses seront figés, puis envoyés/);

  // MOB-01 : sur un téléphone, le choix de la carte passe sous le titre au lieu de l'écraser, et la case d'un choix est
  // alignée sur son texte
  const phone = await openPage(t, browser, { base: site.base, viewport: { width: 390, height: 844 }, touch: true });
  await phone.goto(`/c/${code}`);
  await phone.getByLabel(/Votre prénom et votre nom/).fill('Tom');
  await phone.getByRole('button', { name: 'Commencer' }).click();
  await phone.locator('.label').first().waitFor();
  await phone.evaluate(() => (document.querySelector('#pageTitle').textContent = 'Sortie géologie de fin d’année'));
  const title = await phone.locator('#pageTitle').boundingBox();
  const choice = await phone.locator('#mapChoiceBox').boundingBox();
  assert.ok(title.width > 200, `titre large de ${title.width} px`);
  assert.ok(choice.y >= title.y + title.height, 'le choix de la carte sous le titre');
  await phone.locator('.label', { hasText: 'Granite' }).locator('h3').click();
  const pill = phone.locator('#dlgRead [data-k="c-dure"] .choice').first();
  // Les deux boîtes au même instant : la fiche monte encore du bas de l'écran
  const gap = await pill.evaluate((label) => {
    const middle = (node) => node.getBoundingClientRect().y + node.getBoundingClientRect().height / 2;
    return middle(label.querySelector('input')) - middle(label.querySelector('span'));
  });
  assert.ok(Math.abs(gap) < 1.5, `case décalée de ${gap} px par rapport à son texte`);
});
