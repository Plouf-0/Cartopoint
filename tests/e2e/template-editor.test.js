/**
 * L'onglet « Modèle de fiche » de la page d'un cours (MOD-03 à MOD-06, MOD-09) : la fiche se compose sur elle-même, au
 * centre de la page, à la place du plan ; les éléments vierges se glissent dedans, et chacun s'écrit à sa place.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, cheapHash } from '../helpers.js';
import { heading, launchBrowser, logIn, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

/** Crée un cours par l'API, depuis la page : son contenu tel quel, botanique s'il n'a pas de modèle (MOD-02). */
const postCourse = (page, draft) =>
  page.evaluate(async (draft) => {
    const response = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, draft);
const content = (title, more = {}) => ({
  format: 'inventaire-botanique',
  version: 3,
  title,
  theme: {},
  maps: [{ id: 'm1', name: 'Plan', image: '', fiches: [] }],
  ...more
});

/** Connecté, sur la liste de ses cours. */
async function teacherPage(t, options) {
  const site = await startSite(t);
  addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const page = await openPage(t, browser, { base: site.base, ...options });
  await logIn(page, TEACHER, '/prof');
  await heading(page, 'Mes cours');
  return { site, page };
}

/** Un cours aux fiches botaniques, ouvert sur l'onglet « Modèle de fiche ». */
async function setup(t, options) {
  const { site, page } = await teacherPage(t, options);
  const course = await postCourse(page, content('Sortie en ville'));
  await page.goto(`/prof/cours/${course.id}#modele`);
  await page.locator('#tplSummary').waitFor();
  return { site, page, course };
}

const draft = (site, title) =>
  JSON.parse((title ? site.db.prepare('SELECT draft FROM courses WHERE title = ?').get(title) : site.db.prepare('SELECT draft FROM courses').get()).draft);
const saved = (page) => page.locator('#saveState', { hasText: '✓ Enregistré' }).waitFor();
const blocks = (page) => page.locator('#tplBlocks .tpl-block');
/** Un élément de la fiche, par son identifiant. */
const block = (page, id) => page.locator(`#tplBlocks [data-block="${id}"]`);
/** L'élément choisi, qui s'écrit à sa place. */
const editing = (page) => page.locator('#tplBlocks .tpl-block.selected');
/** Les éléments de la fiche, dans l'ordre, par leur nom. */
const names = (page) =>
  page.locator('#tplBlocks [data-up]').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label').replace(/^Monter « (.*) »$/, '$1')));
const texts = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.textContent.trim().replace(/\s+/g, ' ')));
/** Écrit dans une case de l'élément choisi, puis la quitte : c'est en la quittant qu'elle s'enregistre. */
async function write(locator, value) {
  await locator.fill(value);
  await locator.blur();
}
/** Répond à la prochaine confirmation, et rend son texte ; échoue si elle ne vient pas. */
const nextConfirm = (page, accept = true) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('aucune confirmation demandée')), 5000);
    page.once('dialog', async (dialog) => {
      clearTimeout(timer);
      resolve(dialog.message());
      await (accept ? dialog.accept() : dialog.dismiss());
    });
  });

/** Ajoute un élément d'un clic, écrit son libellé, règle le reste, puis le referme. */
async function addQuestion(page, type, label, fill = async () => {}) {
  const before = await blocks(page).count();
  await page.locator(`[data-add="${type}"]`).click();
  await blocks(page).nth(before).waitFor();
  await write(editing(page).locator('#fLabel'), label);
  await fill(editing(page));
  await editing(page).locator('[data-done]').click();
  await editing(page).waitFor({ state: 'detached' });
  await saved(page);
}

test('MOD-03, MOD-04, MOD-09 : le modèle d’un cours se montre au centre, à la place du plan, comme la fiche que liront les élèves', async (t) => {
  const { page } = await setup(t, { viewport: { width: 1366, height: 768 } });
  const tabs = await page.locator('.tabs').evaluate((node) => node.scrollWidth - node.clientWidth);
  assert.ok(tabs <= 0, `les cinq onglets tiennent sans défiler (${tabs} px de trop)`);
  assert.equal(await page.locator('#stageInner').isHidden(), true, 'plus de plan au centre');
  assert.equal(await page.locator('#tplName').inputValue(), 'Inventaire botanique');
  assert.equal(await page.locator('#tplSummary').textContent(), '3 questions : 3 non corrigées.');
  assert.equal(await blocks(page).count(), 17);
  assert.deepEqual(await texts(page.locator('#tplBlocks .is-heading .tpl-view h3')), ['Besoins', 'Vos mesures']);
  assert.equal(await page.locator('#tplBlocks .is-heading .tpl-view', { hasText: 'Fin du groupe' }).count(), 1);
  assert.deepEqual(await texts(block(page, 'temperature').locator('.tpl-marks > *')), ['Nombre · Question · dans la liste', 'Non corrigée']);
  assert.deepEqual(await texts(block(page, 'common').locator('.tpl-marks > *')), ['Texte court · Renseignement · titre']);
  assert.equal(await block(page, 'temperature').locator('[data-answer], input').count(), 1, 'la case de réponse, comme l’élève la voit');
  await page.getByText('D’après les exemples du modèle.').waitFor();
  assert.equal(await page.locator('.tpl-canvas .preview-card h3').textContent(), 'Olivier', 'sans fiche, les exemples du modèle la remplissent');

  await page.getByRole('tab', { name: 'Fiches' }).click();
  assert.equal(await page.locator('#stageInner').isVisible(), true, 'le plan revient avec les autres onglets');
  assert.equal(await page.locator('#tabStage').isHidden(), true);
});

test('MOD-03, MOD-04, MOD-09 : un élément ajouté d’un clic s’écrit à sa place : libellé, propositions, aide, réglages', async (t) => {
  const { site, page } = await setup(t);
  await page.locator('[data-add="choice"]').click();
  const edited = editing(page);
  await edited.waitFor();
  assert.deepEqual(
    await page.evaluate(() => [document.activeElement.id, document.activeElement.selectionStart, document.activeElement.selectionEnd]),
    ['fLabel', 0, 'Nouvelle question'.length],
    'le libellé de départ, prêt à remplacer'
  );
  assert.equal(await edited.locator('#fAudience').inputValue(), 'question', 'un nouvel élément est d’abord une question');
  assert.equal(await edited.locator('#fCheck').inputValue(), 'auto');
  assert.deepEqual(await names(page).then((all) => all.at(-1)), 'Nouvelle question', 'sans élément choisi, à la fin');
  await page.keyboard.type('Quel est ce style ?');
  await page.keyboard.press('Tab');
  await saved(page);
  assert.equal(draft(site).template.fields.at(-1).label, 'Quel est ce style ?', 'enregistré en quittant la case');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Proposition 1', 'la case suivante garde le curseur');
  await write(edited.getByLabel('Proposition 1', { exact: true }), 'Roman');
  await write(edited.getByLabel('Proposition 2', { exact: true }), 'Gothique');
  await edited.getByRole('button', { name: '＋ Proposition' }).click();
  await edited.getByLabel('Proposition 3', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Proposition 3');
  await page.keyboard.type('Baroque');
  await edited.locator('#fMultiple').check();
  await edited.locator('#fList').check();
  await write(edited.locator('#fIcon'), '🏛️');
  await write(edited.locator('#fHelp'), 'Regardez les fenêtres.');
  await saved(page);
  const field = draft(site).template.fields.at(-1);
  assert.match(field.id, /^c-/);
  assert.deepEqual(
    { ...field, id: undefined, choices: field.choices.map((choice) => choice.label) },
    {
      id: undefined,
      type: 'choice',
      label: 'Quel est ce style ?',
      icon: '🏛️',
      help: 'Regardez les fenêtres.',
      audience: 'question',
      list: true,
      choices: ['Roman', 'Gothique', 'Baroque'],
      multiple: true
    }
  );

  // Un élément impossible le dit, et rien n'est enregistré ; en le quittant, il reprend ce qui l'était
  await write(edited.locator('#fLabel'), '');
  await edited.locator('.form-error', { hasText: 'il faut un libellé' }).waitFor();
  assert.equal(draft(site).template.fields.at(-1).label, 'Quel est ce style ?');
  await edited.locator('[data-done]').click();
  await page.locator('#toast', { hasText: 'Modification annulée : il faut un libellé' }).waitFor();
  assert.equal(await editing(page).count(), 0);

  const added = block(page, field.id);
  assert.deepEqual(await texts(added.locator('.tpl-marks > *')), ['Choix multiple · Question · dans la liste', 'Corrigée automatiquement']);
  assert.deepEqual(await texts(added.locator('.choice')), ['Roman', 'Gothique', 'Baroque'], 'comme l’élève le lira');
  assert.equal(await page.locator('#tplSummary').textContent(), '4 questions : 1 corrigée automatiquement, 3 non corrigées.');
  await added.click();
  await editing(page).locator('#fCheck').selectOption('none');
  await editing(page).locator('.check-badge', { hasText: 'Non corrigée' }).waitFor();
  assert.equal(await page.locator('#tplSummary').textContent(), '4 questions : 4 non corrigées.');
});

test('MOD-03 : chaque réglage qui n’a pas de sens pour le type ou le public disparaît, et un modèle impossible est refusé', async (t) => {
  const { site, page } = await setup(t);
  await page.locator('[data-add="date"]').click();
  const edited = editing(page);
  assert.equal(await edited.locator('#fAudience option[value="question"]').isDisabled(), true, 'une date n’est pas une question');
  await edited.locator('#fType').selectOption('text');
  await edited.locator('#fAudience').selectOption('info');
  assert.equal(await edited.locator('#fRole').count(), 1);
  await write(edited.locator('#fLabel'), 'Monument');
  await edited.locator('#fRole').selectOption('title');
  await edited.locator('.form-error', { hasText: 'un seul champ peut servir de titre' }).waitFor();
  await edited.locator('#fRole').selectOption('');
  await edited.locator('#fAudience').selectOption('teacher');
  assert.equal(await edited.locator('#fRole, #fSearch, #fCheck').count(), 0, 'ni rôle, ni recherche, ni correction pour une note de l’enseignant');
  await edited.locator('.aud', { hasText: 'Vu par vous seul' }).waitFor();
  await saved(page);
  assert.deepEqual({ ...draft(site).template.fields.at(-1), id: undefined }, { id: undefined, type: 'text', label: 'Monument', audience: 'teacher' });
});

test('MOD-03, MOD-09 : ranger les éléments avec ▲ ▼ ou en les glissant, et glisser un élément vierge à l’endroit voulu', async (t) => {
  const { site, page } = await setup(t);
  await block(page, 'family').getByRole('button', { name: 'Monter « Famille »' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#tplBlocks [data-block]')[1]?.dataset.block === 'family');
  await block(page, 'species')
    .locator('[data-handle]')
    .dragTo(block(page, 'common'), { targetPosition: { x: 40, y: 2 } });
  await page.waitForFunction(() => document.querySelector('#tplBlocks [data-block]')?.dataset.block === 'species');
  // Un élément vierge, glissé sur le haut de « Famille » : il tombe juste avant
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('[data-add="yesno"]').dragTo(block(page, 'family'), { targetPosition: { x: 40, y: 2 } });
  await editing(page).waitFor();
  await write(editing(page).locator('#fLabel'), 'Est-il en fleur ?');
  await editing(page).locator('[data-done]').click();
  // Un clic sur un élément vierge l'ajoute sous l'élément choisi
  await block(page, 'family').click();
  await page.locator('[data-add="heading"]').click();
  await write(editing(page).locator('#fLabel'), 'En plus');
  await saved(page);
  assert.deepEqual((await names(page)).slice(0, 5), ['Nom scientifique', 'Nom commun', 'Est-il en fleur ?', 'Famille', 'En plus']);
  assert.deepEqual(
    draft(site)
      .template.fields.slice(0, 5)
      .map((field) => [field.type, field.id.replace(/^([ch])-.*/, '$1-…')]),
    [
      ['text', 'species'],
      ['text', 'common'],
      ['yesno', 'c-…'],
      ['text', 'family'],
      ['heading', 'h-…']
    ]
  );
});

test('MOD-05 : un champ rempli ne change que vers un type qui garde ses valeurs, et supprimer ou changer dit ce qui sera perdu', async (t) => {
  const { site, page } = await setup(t);
  await page.getByRole('tab', { name: 'Fiches' }).click();
  for (const [name, family] of [
    ['Olivier', 'Oleaceae'],
    ['Chêne', ''],
    ['Frêne', 'Oleaceae']
  ]) {
    await page.locator('#newFiche').click();
    await page.locator('#e-common').fill(name);
    await page.locator('#e-family').fill(family);
    await page.locator('#eSave').click();
    await page.locator('#dlgEdit').waitFor({ state: 'hidden' });
  }
  await page.getByRole('tab', { name: 'Modèle de fiche' }).click();

  await block(page, 'family')
    .getByRole('button', { name: /^Modifier/ })
    .click();
  const edited = editing(page);
  assert.deepEqual(
    await edited.locator('#fType option:not([disabled])').evaluateAll((options) => options.map((option) => option.value)),
    ['text', 'longtext'],
    'texte court ou texte long seulement'
  );
  await edited.getByText('Des fiches ont déjà une valeur ici').waitFor();
  await edited.locator('#fType').selectOption('longtext');
  await edited.locator('.tpl-marks', { hasText: /^Texte long/ }).waitFor();
  const question = nextConfirm(page, false);
  await edited.locator('#fAudience').selectOption('question');
  assert.match(await question, /^2 fiche\(s\) perdront ou verront changer ce qu’elles ont écrit dans « Famille »/);
  await page.waitForFunction(() => document.querySelector('#fAudience')?.value === 'info');
  await saved(page);
  assert.deepEqual(draft(site).template.fields.find((field) => field.id === 'family').audience, 'info', 'refusé, rien n’a changé');

  const removal = nextConfirm(page);
  await block(page, 'family').getByRole('button', { name: 'Supprimer « Famille »' }).click();
  assert.match(await removal, /Supprimer « Famille » du modèle \?\n\n2 fiche\(s\) perdront ce qu’elles y ont écrit\./);
  await page.locator('#toast', { hasText: 'Élément « Famille » supprimé' }).waitFor();
  await saved(page);
  const content = draft(site);
  assert.equal(
    content.template.fields.some((field) => field.id === 'family'),
    false
  );
  assert.equal(JSON.stringify(content.maps).includes('Oleaceae'), false, 'les valeurs partent avec le champ');

  const kept = nextConfirm(page);
  await block(page, 'temperature').getByRole('button', { name: 'Supprimer « Température »' }).click();
  assert.match(await kept, /Les réponses déjà rendues restent dans l’historique de leur lancement\./);
});

test('MOD-03, QST-01 : dans le formulaire d’une fiche, une question ne paraît que pour sa bonne réponse, si elle se corrige seule', async (t) => {
  const { page } = await setup(t);
  await addQuestion(page, 'yesno', 'Est-il ouvert ?');
  await addQuestion(page, 'longtext', 'Votre avis');
  await addQuestion(page, 'text', 'Architecte', async (edited) => edited.locator('#fAudience').selectOption('correction'));
  await page.getByRole('tab', { name: 'Fiches' }).click();
  await page.locator('#newFiche').click();
  const form = page.locator('#eFields');
  await form.locator('#e-common').waitFor();
  assert.equal(await form.locator('label', { hasText: 'Est-il ouvert ?' }).locator('.aud').textContent(), 'Bonne réponse');
  assert.equal(await form.getByText('Votre avis').count(), 0, 'une question que l’enseignant corrigera n’a pas de bonne réponse à donner');
  assert.equal(await form.getByText('Température').count(), 0, 'ni une mesure, seulement recueillie');
  assert.equal(await form.locator('label', { hasText: 'Architecte' }).locator('.aud').textContent(), 'Révélé à la correction');
});

test('MOD-06 : la fiche du centre se voit comme un élève, sur un téléphone ou un ordinateur, pendant le cours ou à la correction', async (t) => {
  const { page } = await setup(t, { viewport: { width: 390, height: 844 }, touch: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'les cinq onglets défilent dans le panneau, sans élargir la page');
  const canvas = page.locator('.tpl-canvas');
  assert.equal(await canvas.locator('.preview-card [data-answer]').count(), 3, 'les cases des trois mesures, dans la liste');
  await addQuestion(page, 'text', 'Architecte', async (edited) => edited.locator('#fAudience').selectOption('correction'));
  await page.getByRole('tab', { name: 'Fiches' }).click();
  await page.locator('#newFiche').click();
  await page.locator('#e-common').fill('Tilleul');
  await page
    .locator('#eFields')
    .getByLabel(/^Architecte/)
    .fill('Jean');
  await page.locator('#eSave').click();
  await page.locator('#dlgEdit').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'Modèle de fiche' }).click();
  await page.getByText('D’après la fiche « Tilleul ».').waitFor();
  const architect = page.locator('#tplBlocks .tpl-block', { hasText: 'Architecte' });
  assert.equal(await architect.getAttribute('class'), 'tpl-block later', 'pendant le cours, grisé : l’élève ne le lit qu’à la correction');
  assert.deepEqual(await texts(architect.locator('.aud')), ['Révélé à la correction']);
  assert.equal(await canvas.getAttribute('class'), 'tpl-canvas desktop');
  await page.getByRole('button', { name: 'Téléphone' }).click();
  assert.equal(await canvas.getAttribute('class'), 'tpl-canvas phone');
  assert.equal(await page.getByRole('button', { name: 'Téléphone' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Ordinateur' }).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'À la correction' }).click();
  assert.equal(await architect.getAttribute('class'), 'tpl-block');
  assert.deepEqual(await texts(architect.locator('.facts > div')), ['ArchitecteJean']);
});

/* --- Étape 5 : créer, reprendre, dupliquer --- */

const VILLE = {
  name: 'Patrimoine',
  fields: [
    { id: 'common', type: 'text', label: 'Monument', audience: 'info', role: 'title' },
    { id: 'c-siecle', type: 'number', label: 'Siècle', audience: 'info' },
    { id: 'c-style', type: 'yesno', label: 'Est-il gothique ?', audience: 'question' }
  ]
};

test('MOD-07 : « Créer le modèle de fiche » : un nouveau cours part d’un titre et d’une description, et s’ouvre sur son modèle', async (t) => {
  const { site, page } = await teacherPage(t);
  await page.getByLabel('Nom du nouveau cours').fill('Sortie géologie');
  await page.getByRole('button', { name: 'Créer le modèle de fiche' }).click();
  await page.locator('#tplSummary').waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Modèle de fiche' }).getAttribute('aria-selected'), 'true');
  assert.deepEqual(await names(page), ['Titre', 'Description']);
  assert.match(await page.locator('#tplSummary').textContent(), /^Aucune question/);
  assert.deepEqual(
    draft(site).template.fields.map((field) => [field.id, field.role ?? null]),
    [
      ['titre', 'title'],
      ['description', null]
    ]
  );
});

test('MOD-07 : reprendre la fiche d’un de ses cours, ou d’un fichier de cours : une copie du modèle, sans les fiches', async (t) => {
  const { site, page } = await teacherPage(t);
  await postCourse(
    page,
    content('Ville', { version: 4, template: VILLE, maps: [{ id: 'm1', name: 'Plan', image: '', fiches: [{ id: 'f1', common: 'Beffroi' }] }] })
  );
  site.db
    .prepare('INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('autre', addAccount(site.db, { email: 'autre@example.org' }), 'Cours d’un collègue', JSON.stringify(content('Cours d’un collègue')), '2026-01-01');
  await page.reload();
  await page.getByLabel('Nom du nouveau cours').fill('Ville bis');
  await page.getByRole('button', { name: 'Reprendre la fiche d’un autre cours' }).click();
  assert.equal(await page.getByRole('button', { name: /Cours d’un collègue/ }).count(), 0, 'ENS-03 : ses cours seulement');
  await page.getByRole('button', { name: 'Fiche de « Ville »' }).click();
  await page.locator('#tplSummary').waitFor();
  assert.deepEqual(await names(page), ['Monument', 'Siècle', 'Est-il gothique ?']);
  const copy = draft(site, 'Ville bis');
  const source = site.db.prepare("SELECT id FROM courses WHERE title = 'Ville'").get().id;
  assert.deepEqual(copy.template, { ...VILLE, source: { courseId: source, title: 'Ville' } });
  assert.deepEqual(copy.maps[0].fiches, [], 'sans les fiches');

  await page.goto('/prof');
  await page.getByLabel('Nom du nouveau cours').fill('Depuis un fichier');
  await page.getByRole('button', { name: 'Reprendre la fiche d’un autre cours' }).click();
  const file = { ...content('Cours de Léa', { version: 4, template: VILLE }), id: 'proj-lea' };
  await page
    .locator('.reuse-chooser input[type=file]')
    .setInputFiles({ name: 'lea.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.locator('#tplSummary').waitFor();
  assert.deepEqual(draft(site, 'Depuis un fichier').template, { ...VILLE, source: { title: 'Cours de Léa' } }, 'Q-C : le fichier d’un collègue');
});

test('MOD-08 : dupliquer un cours : une copie complète, fiches masquées comprises, sans versions ni lancements', async (t) => {
  const { site, page } = await teacherPage(t);
  const fiches = [
    { id: 'f1', common: 'Beffroi', visible: true, refX: 10, refY: 20 },
    { id: 'f2', common: 'Halle', visible: false }
  ];
  const course = await postCourse(page, content('Ville', { version: 4, template: VILLE, maps: [{ id: 'm1', name: 'Plan', image: '', fiches }] }));
  await page.evaluate(
    (course) =>
      fetch(`/api/courses/${course.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: course.revision })
      }),
    course
  );
  await page.reload();
  await page.locator('.course-row', { hasText: 'Ville' }).getByRole('button', { name: 'Dupliquer' }).click();
  await page.locator('.course-row', { hasText: 'Ville - copie' }).getByText('Pas encore publié').waitFor();
  const original = draft(site, 'Ville');
  assert.deepEqual(draft(site, 'Ville - copie'), { ...original, title: 'Ville - copie' });
  const copy = site.db.prepare("SELECT id FROM courses WHERE title = 'Ville - copie'").get().id;
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM course_versions WHERE course_id = ?').get(copy).n, 0);
});

test('MOD-07 : dans un cours, reprendre la fiche d’un autre garde les valeurs communes, et dit ce qui sera perdu', async (t) => {
  const { site, page } = await setup(t);
  await postCourse(page, content('Ville', { version: 4, template: VILLE }));
  await page.getByRole('tab', { name: 'Fiches' }).click();
  for (const [name, family] of [
    ['Olivier', 'Oleaceae'],
    ['Chêne', '']
  ]) {
    await page.locator('#newFiche').click();
    await page.locator('#e-common').fill(name);
    await page.locator('#e-family').fill(family);
    await page.locator('#eSave').click();
    await page.locator('#dlgEdit').waitFor({ state: 'hidden' });
  }
  await page.getByRole('tab', { name: 'Modèle de fiche' }).click();
  await page.locator('#tplReuse').click();
  const chooser = page.locator('dialog.field-dialog');
  assert.equal(await chooser.getByRole('button', { name: 'Fiche de « Sortie en ville »' }).count(), 0, 'pas lui-même');
  const asked = nextConfirm(page);
  await chooser.getByRole('button', { name: 'Fiche de « Ville »' }).click();
  assert.match(
    await asked,
    /Les valeurs des champs qu’ils ont en commun sont gardées\.\n\n2 fiche\(s\) perdront une partie de ce qu’elles ont écrit\./,
    'leur date d’observation, et une famille'
  );
  await page.locator('#toast', { hasText: '✓ Fiche de « Ville » reprise' }).waitFor();
  await saved(page);
  const content2 = draft(site, 'Sortie en ville');
  assert.equal(content2.template.name, 'Patrimoine');
  assert.deepEqual(
    content2.maps[0].fiches.map((fiche) => [fiche.common, fiche.family]),
    [
      ['Olivier', undefined],
      ['Chêne', undefined]
    ],
    'le nom, champ commun, reste ; la famille part'
  );
});

/* --- Étape 6 : les bonnes réponses de chaque fiche --- */

const QUIZ = {
  fields: [
    { id: 'common', type: 'text', label: 'Arbre', audience: 'info', role: 'title' },
    { id: 'c-nom', type: 'text', label: 'Quel arbre ?', audience: 'question', check: 'auto' },
    { id: 'c-haut', type: 'number', label: 'Hauteur', unit: 'm', audience: 'question', check: 'auto' },
    {
      id: 'c-mat',
      type: 'choice',
      label: 'Feuilles',
      audience: 'question',
      multiple: true,
      choices: [
        { id: 'lobees', label: 'Lobées' },
        { id: 'dentees', label: 'Dentées' }
      ]
    },
    { id: 'c-ok', type: 'yesno', label: 'Persistant ?', audience: 'question' },
    { id: 'c-avis', type: 'longtext', label: 'Votre avis', audience: 'question' }
  ]
};

test('QST-01 : la bonne réponse de chaque question se donne dans le formulaire de la fiche, et la liste dit ce qui manque', async (t) => {
  const { site, page } = await teacherPage(t);
  const course = await postCourse(
    page,
    content('Arbres', { version: 4, template: QUIZ, maps: [{ id: 'm1', name: 'Plan', image: '', fiches: [{ id: 'f1', common: 'Chêne' }] }] })
  );
  await page.goto(`/prof/cours/${course.id}`);
  const row = page.locator('.row', { hasText: 'Chêne' });
  assert.equal(await row.locator('.missing-expected').textContent(), '⚠ 4 bonne(s) réponse(s) à donner, sinon vous corrigerez vous-même');
  await row.locator('[data-edit]').click();
  const form = page.locator('#eFields');
  assert.equal(await form.locator('#x-c-avis').count(), 0, 'une question ouverte n’a pas de bonne réponse');
  await form.locator('#x-c-nom').fill('Chêne\nchene\n\nChêne pédonculé');
  await form.locator('#x-c-haut').fill('20');
  await form.locator('#x-c-haut-tol').fill('2,5');
  await form.locator('#x-c-mat').getByLabel('Lobées').check();
  await form.locator('#x-c-ok').selectOption('non');
  await page.locator('#eSave').click();
  await page.locator('#dlgEdit').waitFor({ state: 'hidden' });
  await row.locator('.missing-expected').waitFor({ state: 'detached' });
  await saved(page);
  assert.deepEqual(draft(site).maps[0].fiches[0].expected, {
    'c-nom': ['Chêne', 'Chêne pédonculé'],
    'c-haut': { value: 20, tolerance: 2.5 },
    'c-mat': ['lobees'],
    'c-ok': 'non'
  });

  await row.locator('[data-edit]').click();
  assert.equal(await form.locator('#x-c-nom').inputValue(), 'Chêne\nChêne pédonculé', 'un doublon à un accent près disparaît');
  assert.equal(await form.locator('#x-c-haut-tol').inputValue(), '2.5');
  await form.locator('#x-c-ok').selectOption('');
  await page.locator('#eSave').click();
  await row.locator('.missing-expected', { hasText: '⚠ 1 bonne(s) réponse(s)' }).waitFor();
});

test('QST-05 : la notation du cours se règle dans l’onglet du modèle : sans note, un barème, ou une note sur un maximum', async (t) => {
  const { site, page } = await teacherPage(t);
  const course = await postCourse(page, content('Arbres', { version: 4, template: QUIZ }));
  await page.goto(`/prof/cours/${course.id}#modele`);
  await page.getByLabel(/Sans note/).waitFor();
  assert.equal(await page.getByLabel(/Sans note/).isChecked(), true, 'sans note, tant que l’enseignant n’a rien choisi');
  await page.getByLabel(/Une note sur un maximum/).check();
  assert.equal(await page.locator('#gradingPlacement').count(), 0, 'sans plan, pas de placement à compter');
  await page.locator('#gradingMax').fill('10');
  await page.locator('#gradingMax').press('Tab');
  await saved(page);
  assert.deepEqual(draft(site).grading, { mode: 'auto', max: 10, placement: false });

  await page.getByLabel(/Un barème/).check();
  assert.deepEqual(await page.locator('[data-points]').evaluateAll((inputs) => inputs.map((input) => input.dataset.points)), [
    'c-nom',
    'c-haut',
    'c-mat',
    'c-ok',
    'c-avis'
  ]);
  await page.getByLabel('Quel arbre ? : points par fiche').fill('2,5');
  await page.getByLabel('Quel arbre ? : points par fiche').press('Tab');
  await saved(page);
  assert.deepEqual(draft(site).grading, { mode: 'points', points: { 'c-nom': 2.5 }, placement: 1 });

  // Une question qui ne se corrige plus emporte son barème : le serveur refuserait sinon le cours
  await block(page, 'c-nom')
    .getByRole('button', { name: /^Modifier/ })
    .click();
  await editing(page).locator('#fCheck').selectOption('none');
  await editing(page).locator('.check-badge', { hasText: 'Non corrigée' }).waitFor();
  await saved(page);
  assert.deepEqual(draft(site).grading, { mode: 'points', points: {}, placement: 1 });
});
