/**
 * L'onglet « Modèle de fiche » de la page d'un cours (MOD-03 à MOD-05) : composer les champs, les régler, les ranger, les
 * supprimer, et voir la fiche comme un élève, sur un téléphone et sur un ordinateur.
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
const rows = (page) => page.locator('.tpl-row');
const row = (page, label) => page.locator('.tpl-row', { has: page.locator('strong', { hasText: label }) });
const fieldDialog = (page) => page.locator('dialog.field-dialog');
const texts = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.textContent.trim().replace(/\s+/g, ' ')));
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

async function addQuestion(page, type, label, fill = async () => {}) {
  await page.locator(`[data-add="${type}"]`).click();
  await fieldDialog(page).locator('#fLabel').fill(label);
  await fill(fieldDialog(page));
  await fieldDialog(page).getByRole('button', { name: 'Enregistrer' }).click();
  await fieldDialog(page).waitFor({ state: 'detached' });
}

test('MOD-03, MOD-04 : un nouveau cours montre son modèle, avec ses intertitres et la correction de chaque question', async (t) => {
  const { page } = await setup(t);
  assert.equal(await page.locator('#tplName').inputValue(), 'Inventaire botanique');
  assert.equal(await page.locator('#tplSummary').textContent(), '3 questions : 3 non corrigées.');
  assert.equal(await rows(page).count(), 17);
  assert.deepEqual(await texts(page.locator('.tpl-row.is-heading strong')), ['Besoins', 'Vos mesures', 'Fin du groupe']);
  assert.deepEqual(await texts(row(page, 'Température').locator('.state, .check-badge')), ['Nombre · Question · dans la liste', 'Non corrigée']);
  assert.deepEqual(await texts(row(page, 'Nom commun').locator('.state')), ['Texte court · Renseignement · titre']);
  assert.equal(await row(page, 'Nom commun').locator('.check-badge').count(), 0, 'un renseignement ne se corrige pas');
});

test('MOD-03, MOD-04 : ajouter une question à choix, voir son badge, et la retrouver dans le modèle enregistré', async (t) => {
  const { site, page } = await setup(t);
  await page.locator('[data-add="choice"]').click();
  const dialog = fieldDialog(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'fLabel');
  assert.equal(await dialog.locator('#fAudience').inputValue(), 'question', 'un nouveau champ est d’abord une question');
  assert.equal(await dialog.locator('#fCheck').inputValue(), 'auto');
  await dialog.locator('#fLabel').fill('Quel est ce style ?');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.locator('.form-error', { hasText: 'proposition invalide' }).waitFor();
  await dialog.getByLabel('Proposition 1', { exact: true }).fill('Roman');
  await dialog.getByLabel('Proposition 2', { exact: true }).fill('Gothique');
  await dialog.getByRole('button', { name: '＋ Proposition' }).click();
  await dialog.getByLabel('Proposition 3', { exact: true }).fill('Baroque');
  await dialog.locator('#fMultiple').check();
  await dialog.locator('#fList').check();
  await dialog.locator('#fIcon').fill('🏛️');
  await dialog.locator('#fHelp').fill('Regardez les fenêtres.');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await page.locator('#toast', { hasText: '✓ Champ « Quel est ce style ? » ajouté' }).waitFor();

  const added = row(page, 'Quel est ce style ?');
  assert.deepEqual(await texts(added.locator('.state, .check-badge')), ['Choix multiple · Question · dans la liste', 'Corrigée automatiquement']);
  assert.equal(await page.locator('#tplSummary').textContent(), '4 questions : 1 corrigée automatiquement, 3 non corrigées.');
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

  await added.getByRole('button', { name: /^Modifier/ }).click();
  await fieldDialog(page).locator('#fCheck').selectOption('none');
  await fieldDialog(page).getByRole('button', { name: 'Enregistrer' }).click();
  await row(page, 'Quel est ce style ?').locator('.check-badge', { hasText: 'Non corrigée' }).waitFor();
  assert.equal(await page.locator('#tplSummary').textContent(), '4 questions : 4 non corrigées.');
});

test('MOD-03 : chaque réglage qui n’a pas de sens pour le type ou le public disparaît, et un modèle impossible est refusé', async (t) => {
  const { site, page } = await setup(t);
  await page.locator('[data-add="date"]').click();
  const dialog = fieldDialog(page);
  assert.equal(await dialog.locator('#fAudience option[value="question"]').isDisabled(), true, 'une date n’est pas une question');
  await dialog.locator('#fType').selectOption('text');
  await dialog.locator('#fAudience').selectOption('info');
  assert.equal(await dialog.locator('#fRole').count(), 1);
  await dialog.locator('#fRole').selectOption('title');
  await dialog.locator('#fLabel').fill('Monument');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.locator('.form-error', { hasText: 'un seul champ peut servir de titre' }).waitFor();
  await dialog.locator('#fRole').selectOption('');
  await dialog.locator('#fAudience').selectOption('teacher');
  assert.equal(await dialog.locator('#fRole, #fSearch, #fCheck').count(), 0, 'ni rôle, ni recherche, ni correction pour une note de l’enseignant');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'detached' });
  await saved(page);
  assert.deepEqual({ ...draft(site).template.fields.at(-1), id: undefined }, { id: undefined, type: 'text', label: 'Monument', audience: 'teacher' });
});

test('MOD-03 : ranger les champs avec ▲ ▼ ou en les glissant, et ajouter un intertitre', async (t) => {
  const { site, page } = await setup(t);
  await row(page, 'Famille').getByRole('button', { name: 'Monter « Famille »' }).click();
  await page.locator('.tpl-row strong').nth(1).filter({ hasText: 'Famille' }).waitFor();
  await row(page, 'Nom scientifique').dragTo(row(page, 'Nom commun'));
  await page.locator('.tpl-row strong').first().filter({ hasText: 'Nom scientifique' }).waitFor();
  await addQuestion(page, 'heading', 'En plus');
  assert.deepEqual((await texts(page.locator('.tpl-row strong'))).slice(0, 3), ['Nom scientifique', 'Nom commun', 'Famille']);
  assert.equal((await texts(page.locator('.tpl-row strong'))).at(-1), 'En plus');
  await saved(page);
  assert.deepEqual(
    draft(site)
      .template.fields.slice(0, 3)
      .map((field) => field.id),
    ['species', 'common', 'family']
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

  await row(page, 'Famille')
    .getByRole('button', { name: /^Modifier/ })
    .click();
  const dialog = fieldDialog(page);
  assert.deepEqual(
    await dialog.locator('#fType option:not([disabled])').evaluateAll((options) => options.map((option) => option.value)),
    ['text', 'longtext'],
    'texte court ou texte long seulement'
  );
  await dialog.getByText('Des fiches ont déjà une valeur ici').waitFor();
  await dialog.locator('#fType').selectOption('longtext');
  await dialog.locator('#fAudience').selectOption('question');
  const question = nextConfirm(page, false);
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  assert.match(await question, /^2 fiche\(s\) perdront ou verront changer ce qu’elles ont écrit dans « Famille »/);
  await dialog.locator('#fAudience').selectOption('info');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.match(await row(page, 'Famille').locator('.state').textContent(), /^Texte long/);

  const removal = nextConfirm(page);
  await row(page, 'Famille').getByRole('button', { name: 'Supprimer « Famille »' }).click();
  assert.match(await removal, /Supprimer « Famille » du modèle \?\n\n2 fiche\(s\) perdront ce qu’elles y ont écrit\./);
  await page.locator('#toast', { hasText: 'Champ « Famille » supprimé' }).waitFor();
  await saved(page);
  const content = draft(site);
  assert.equal(
    content.template.fields.some((field) => field.id === 'family'),
    false
  );
  assert.equal(JSON.stringify(content.maps).includes('Oleaceae'), false, 'les valeurs partent avec le champ');

  const kept = nextConfirm(page);
  await row(page, 'Température').getByRole('button', { name: 'Supprimer « Température »' }).click();
  assert.match(await kept, /Les réponses déjà rendues restent dans l’historique de leur lancement\./);
});

test('MOD-03, QST-01 : dans le formulaire d’une fiche, une question ne paraît que pour sa bonne réponse, si elle se corrige seule', async (t) => {
  const { page } = await setup(t);
  await addQuestion(page, 'yesno', 'Est-il ouvert ?');
  await addQuestion(page, 'longtext', 'Votre avis');
  await addQuestion(page, 'text', 'Architecte', async (dialog) => dialog.locator('#fAudience').selectOption('correction'));
  await page.getByRole('tab', { name: 'Fiches' }).click();
  await page.locator('#newFiche').click();
  const form = page.locator('#eFields');
  await form.locator('#e-common').waitFor();
  assert.equal(await form.locator('label', { hasText: 'Est-il ouvert ?' }).locator('.aud').textContent(), 'Bonne réponse');
  assert.equal(await form.getByText('Votre avis').count(), 0, 'une question que l’enseignant corrigera n’a pas de bonne réponse à donner');
  assert.equal(await form.getByText('Température').count(), 0, 'ni une mesure, seulement recueillie');
  assert.equal(await form.locator('label', { hasText: 'Architecte' }).locator('.aud').textContent(), 'Révélé à la correction');
});

test('MOD-06 : l’aperçu montre la fiche comme un élève, sur un téléphone ou un ordinateur, pendant le cours ou à la correction', async (t) => {
  const { page } = await setup(t, { viewport: { width: 390, height: 844 }, touch: true });
  await page.locator('#tplPreview').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'les cinq onglets défilent dans le panneau, sans élargir la page');
  const preview = page.locator('dialog.preview-dialog');
  await preview.getByText('D’après les exemples du modèle.').waitFor();
  const frame = preview.locator('.preview-frame');
  assert.equal(await frame.getAttribute('class'), 'preview-frame phone');
  assert.equal(await frame.locator('.preview-card h3').textContent(), 'Olivier', 'sans fiche, les exemples du modèle la remplissent');
  assert.equal(await frame.locator('[data-answer]').count(), 3, 'les cases des trois mesures');
  assert.equal(await frame.locator('.measures h3').textContent(), 'Vos mesures');
  await preview.getByRole('button', { name: 'Fermer' }).click();
  await preview.waitFor({ state: 'detached' });

  await addQuestion(page, 'text', 'Architecte', async (dialog) => dialog.locator('#fAudience').selectOption('correction'));
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
  await page.locator('#tplPreview').click();
  await preview.getByText('D’après la fiche « Tilleul ».').waitFor();
  assert.equal(await frame.getByText('Architecte').count(), 0, 'pendant le cours, rien de ce qui est révélé à la correction');
  await preview.getByRole('button', { name: 'Ordinateur' }).click();
  assert.equal(await frame.getAttribute('class'), 'preview-frame desktop');
  assert.equal(await preview.getByRole('button', { name: 'Ordinateur' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await preview.getByRole('button', { name: 'Téléphone' }).getAttribute('aria-pressed'), 'false');
  await preview.getByRole('button', { name: 'À la correction' }).click();
  assert.deepEqual(await texts(frame.locator('.facts > div', { hasText: 'Architecte' })), ['ArchitecteJean']);
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
  assert.deepEqual(await texts(page.locator('.tpl-row strong')), ['Titre', 'Description']);
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
  assert.deepEqual(await texts(page.locator('.tpl-row strong')), ['Monument', 'Siècle', 'Est-il gothique ?']);
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
  await page.locator('.course-row', { hasText: 'Copie de Ville' }).getByText('Pas encore publié').waitFor();
  const original = draft(site, 'Ville');
  assert.deepEqual(draft(site, 'Copie de Ville'), { ...original, title: 'Copie de Ville' });
  const copy = site.db.prepare("SELECT id FROM courses WHERE title = 'Copie de Ville'").get().id;
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
  await row(page, 'Quel arbre ?')
    .getByRole('button', { name: /^Modifier/ })
    .click();
  await fieldDialog(page).locator('#fCheck').selectOption('none');
  await fieldDialog(page).getByRole('button', { name: 'Enregistrer' }).click();
  await saved(page);
  assert.deepEqual(draft(site).grading, { mode: 'points', points: {}, placement: 1 });
});
