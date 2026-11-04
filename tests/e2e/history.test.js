/**
 * L'historique, à l'écran de l'enseignant (HIS-02 à HIS-09) : une ligne par élève, son détail, son compte rendu, l'archive et le fichier Excel, et le fichier
 * de réponses de l'élève (HOR-09). Le contenu du fichier Excel est vérifié dans tests/results-workbook.test.js.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addAccount, cheapHash, client, readZip, request, sheetRows } from '../helpers.js';
import { heading, launchBrowser, logIn, makePng, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const PLAN = makePng(100, 100);
const entry = (x, y, measures = {}) => ({ x, y, temperature: '', humidity: '', light: '', ...measures });
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** Note ce que dessine un compte rendu, et les pointillés vers les positions réelles. */
const WATCH_DRAWING = () => {
  window.drawn = { texts: [], dashes: 0 };
  const { fillText, setLineDash } = CanvasRenderingContext2D.prototype;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    window.drawn.texts.push(String(text));
    return fillText.call(this, text, ...rest);
  };
  CanvasRenderingContext2D.prototype.setLineDash = function (dash) {
    if (dash.length && dash[0] !== 5) window.drawn.dashes++;
    return setLineDash.call(this, dash);
  };
};

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

async function setup(t, { maps, viewport } = {}) {
  const site = await startSite(t);
  addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const api = client(site.base);
  await api.post('/api/auth/login', TEACHER);
  const teacher = await openPage(t, browser, { base: site.base, viewport });
  await teacher.addInitScript(WATCH_DRAWING);
  await logIn(teacher, TEACHER, '/prof');
  await heading(teacher, 'Mes cours');
  const plan = await teacher.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return (await (await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes })).json()).url;
  }, PLAN.toString('base64'));
  const fiche = (id, common, refX, refY) => ({ id, common, visible: true, refX, refY, media: [] });
  const draft = {
    format: 'inventaire-botanique',
    version: 3,
    title: 'Sortie au parc',
    theme: {},
    maps: maps?.(plan, fiche) ?? [
      { id: 'm1', name: 'Parc', image: plan, widthMeters: 100, fiches: [fiche('f1', 'Noisetier', 40, 60), fiche('f2', 'Sureau', 10, 60)] }
    ]
  };
  const course = (await api.post('/api/courses', { draft })).json();
  await api.post(`/api/courses/${course.id}/publish`, { revision: course.revision });
  const launch = (await api.post(`/api/courses/${course.id}/launches`)).json();
  const openLaunch = () => teacher.goto(`/prof/lancements/${launch.id}`);
  await openLaunch();
  return { site, api, teacher, course, launch, openLaunch };
}

const join = async (site, launch, names) => (await client(site.base).post(`/api/join/${launch.code}`, { names })).json();
const handIn = (site, me, answers) =>
  request(site.base, '/api/student/answers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${me.token}` },
    body: JSON.stringify({ answers: { m1: answers } })
  });
const row = (page, names) => page.locator('.participants li', { hasText: names });
const refresh = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const participant = (site, names) => site.db.prepare('SELECT * FROM participants WHERE names = ?').get(names);

async function saved(page, action) {
  const file = page.waitForEvent('download');
  await action();
  const download = await file;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

/* --- HIS-03, SUI-03 : une ligne par élève --- */

test('HIS-03, SUI-03 : une ligne par élève : son état, son score et sa précision ; rien pour celui qui n’a pas rendu', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  const lea = await join(site, launch, 'Léa Dupont');
  await join(site, launch, 'Tom Martin');
  await handIn(site, lea, { f1: entry(40, 60), f2: entry(30, 60) });
  await openLaunch();

  const done = row(teacher, 'Léa Dupont');
  await done.getByText('A fini', { exact: true }).waitFor();
  await done.getByText('1 / 2 bien placée(s) · écart moyen 10 m').waitFor();
  await done.getByRole('button', { name: 'JPG' }).waitFor();
  await done.getByRole('button', { name: 'Détail' }).waitFor();

  const waiting = row(teacher, 'Tom Martin');
  await waiting.getByText('A commencé').waitFor();
  assert.equal(await waiting.getByRole('button').count(), 0, 'SUI-03 : rien à voir tant qu’il n’a pas rendu');
});

test('HIS-09 : les boutons pour tous n’apparaissent qu’une fois un rendu arrivé, sans recharger', async (t) => {
  const { site, teacher, launch } = await setup(t);
  const lea = await join(site, launch, 'Léa');
  await row(teacher, 'Léa').waitFor({ timeout: 8000 });
  assert.equal(await teacher.getByRole('button', { name: 'Tout télécharger (JPG)' }).isVisible(), false);
  assert.equal(await teacher.getByRole('button', { name: 'Télécharger l’Excel' }).isVisible(), false);
  await handIn(site, lea, { f1: entry(40, 60) });
  await refresh(teacher);
  await teacher.getByRole('button', { name: 'Tout télécharger (JPG)' }).waitFor();
  await teacher.getByRole('button', { name: 'Télécharger l’Excel' }).waitFor();
});

test('HIS-03 : un nom piégé reste du texte, dans la liste comme dans le détail', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  const trap = '<img src=x onerror="window.piege=1">';
  const me = await join(site, launch, trap);
  await handIn(site, me, { f1: entry(40, 60) });
  await openLaunch();
  await row(teacher, trap).getByRole('button', { name: 'Détail' }).click();
  await teacher.locator('dialog[open]').getByRole('heading', { name: trap }).waitFor();
  await teacher.waitForTimeout(100);
  assert.equal(await teacher.evaluate(() => window.piege), undefined);
  assert.equal(await teacher.locator('.participants img, dialog[open] h2 img').count(), 0);
});

/* --- La liste --- */

test('HIS-03 : la liste ne se redessine que si quelque chose a changé : un bouton ne disparaît pas sous le doigt', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  const me = await join(site, launch, 'Léa');
  await handIn(site, me, { f1: entry(40, 60) });
  await openLaunch();
  const jpg = row(teacher, 'Léa').getByRole('button', { name: 'JPG' });
  await jpg.focus();
  const refreshed = teacher.waitForResponse(`**/api/launches/${launch.id}`);
  await refresh(teacher);
  await refreshed;
  await teacher.waitForTimeout(100);
  assert.equal(await jpg.evaluate((button) => button === document.activeElement), true);

  await join(site, launch, 'Tom');
  await refresh(teacher);
  await row(teacher, 'Tom').waitFor();
});

/* --- HIS-09 : les comptes rendus --- */

test('HIS-09 : le compte rendu d’un élève se télécharge, avec les positions réelles, les écarts, le jour et l’heure du lancement, pour le lui rendre', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  const me = await join(site, launch, 'Léa Dupont');
  await handIn(site, me, { f1: entry(40, 60), f2: entry(30, 60) });
  site.db.prepare('UPDATE launches SET opened_at = ?').run('2026-03-12T10:00:00.000Z');
  await openLaunch();
  const file = await saved(teacher, () => row(teacher, 'Léa Dupont').getByRole('button', { name: 'JPG' }).click());
  assert.equal(file.name, 'Compte rendu - Léa Dupont.jpg');
  assert.ok(file.bytes.subarray(0, 3).equals(JPEG));
  const drawn = await teacher.evaluate(() => window.drawn);
  assert.ok(drawn.texts.some((text) => text.includes('Léa Dupont')));
  assert.ok(
    drawn.texts.some((text) => text.endsWith('12 mars 2026 à 11:00')),
    drawn.texts.join(' | ')
  );
  assert.ok(!drawn.texts.some((text) => /^Note/.test(text)), 'pas de note');
  assert.ok(drawn.texts.includes('Position réelle'));
  assert.ok(drawn.dashes > 0, 'les pointillés vers les positions réelles');
  await teacher.getByText('✓ Compte rendu de Léa Dupont téléchargé').waitFor();
});

test('E-15 : un navigateur sans roundRect sort quand même le compte rendu', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  await teacher.addInitScript(() => {
    delete CanvasRenderingContext2D.prototype.roundRect;
  });
  await handIn(site, await join(site, launch, 'Léa'), { f1: entry(40, 60) });
  await openLaunch();
  const file = await saved(teacher, () => row(teacher, 'Léa').getByRole('button', { name: 'JPG' }).click());
  assert.ok(file.bytes.subarray(0, 3).equals(JPEG));
});

test('HIS-09 : tous les comptes rendus portent aussi le jour et l’heure du lancement', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  await handIn(site, await join(site, launch, 'Léa'), { f1: entry(40, 60) });
  site.db.prepare('UPDATE launches SET opened_at = ?').run('2026-03-12T10:00:00.000Z');
  await openLaunch();
  await saved(teacher, () => teacher.getByRole('button', { name: 'Tout télécharger (JPG)' }).click());
  const { texts } = await teacher.evaluate(() => window.drawn);
  assert.ok(
    texts.some((text) => text.endsWith('12 mars 2026 à 11:00')),
    texts.join(' | ')
  );
});

test('HIS-09 : tout d’un coup : une archive avec un compte rendu par élève ayant rendu, même deux de même nom', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  for (const names of ['Léa', 'Tom', 'Tom']) await handIn(site, await join(site, launch, names), { f1: entry(40, 60) });
  await join(site, launch, 'Noé');
  site.db.prepare('UPDATE launches SET opened_at = ?').run('2026-03-12T10:00:00.000Z');
  await openLaunch();
  const file = await saved(teacher, () => teacher.getByRole('button', { name: 'Tout télécharger (JPG)' }).click());
  assert.equal(file.name, 'Comptes rendus - Sortie au parc - 2026-03-12 11h00.zip');
  const files = readZip(file.bytes);
  assert.deepEqual(Object.keys(files).sort(), ['Compte rendu - Léa.jpg', 'Compte rendu - Tom (2).jpg', 'Compte rendu - Tom.jpg']);
  for (const bytes of Object.values(files)) assert.ok(bytes.subarray(0, 3).equals(JPEG));
  await teacher.getByText('✓ Comptes rendus téléchargés').waitFor();
});

test('HIS-09 : sur plusieurs cartes : un compte rendu par carte, regroupés dans une archive', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t, {
    maps: (plan, fiche) => [
      { id: 'm1', name: 'Parc', image: plan, fiches: [fiche('f1', 'Noisetier', 40, 60)] },
      { id: 'm2', name: 'Bois', image: plan, fiches: [fiche('f2', 'Tilleul', 20, 20)] }
    ]
  });
  await handIn(site, await join(site, launch, 'Léa'), { f1: entry(40, 60) });
  await openLaunch();
  const file = await saved(teacher, () => row(teacher, 'Léa').getByRole('button', { name: 'JPG' }).click());
  assert.equal(file.name, 'Compte rendu - Léa.zip');
  assert.deepEqual(Object.keys(readZip(file.bytes)).sort(), ['Compte rendu - Léa - Bois.jpg', 'Compte rendu - Léa - Parc.jpg']);
});

/* --- HIS-08 : l'Excel --- */

test('HIS-08 : l’Excel se télécharge : la synthèse, puis une page par élève, sans formule même pour un nom piégé', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  await handIn(site, await join(site, launch, 'Léa Dupont'), { f1: entry(40, 60, { temperature: '20' }) });
  await handIn(site, await join(site, launch, '=1+1'), { f1: entry(50, 60, { temperature: '24' }) });
  await join(site, launch, 'Noé');
  site.db.prepare('UPDATE launches SET opened_at = ?').run('2026-03-12T10:00:00.000Z');
  await openLaunch();
  const file = await saved(teacher, () => teacher.getByRole('button', { name: 'Télécharger l’Excel' }).click());
  assert.equal(file.name, 'Résultats - Sortie au parc - 2026-03-12 11h00.xlsx');
  const files = readZip(file.bytes);
  const names = [...files['xl/workbook.xml'].toString().matchAll(/<sheet name="([^"]*)"/g)].map(([, name]) => name);
  assert.deepEqual(names, ['Synthèse', 'Léa Dupont', '=1+1']);
  assert.doesNotMatch(files['xl/worksheets/sheet3.xml'].toString() + files['xl/worksheets/sheet1.xml'].toString(), /<f>/);
  const summary = sheetRows(files['xl/worksheets/sheet1.xml'].toString());
  assert.equal(summary[1][0], 'Lancé le 12 mars 2026 à 11:00');
  assert.deepEqual(summary.find((cells) => cells[0] === 'Léa Dupont').slice(0, 2), ['Léa Dupont', 'A fini']);
  assert.equal(summary.find((cells) => cells[0] === 'Classe')[7], 22, 'température moyenne de la classe');
  assert.equal(summary.find((cells) => cells[0] === 'Noé')[1], "N'a pas rendu");
  await teacher.getByText('✓ Excel téléchargé').waitFor();
});

/* --- HIS-04 : le détail --- */

test('HIS-04 : le détail d’un élève montre ses réponses fiche par fiche, et le plan avec les écarts', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  await handIn(site, await join(site, launch, 'Léa'), { f1: entry(40, 60, { temperature: '21', humidity: '55', light: '900' }) });
  await openLaunch();
  await row(teacher, 'Léa').getByRole('button', { name: 'Détail' }).click();
  const dialog = teacher.locator('dialog[open]');
  await dialog.getByRole('heading', { name: 'Léa' }).waitFor();
  const first = dialog.locator('tr', { hasText: 'Noisetier' });
  await first.getByText('Bien placée').waitFor();
  await first.getByText('21', { exact: true }).waitFor();
  await first.getByText('55', { exact: true }).waitFor();
  await first.getByText('900', { exact: true }).waitFor();
  await dialog.locator('tr', { hasText: 'Sureau' }).getByText('Non placée').waitFor();
  const plan = dialog.locator('.detail-plan');
  await plan.waitFor();
  await teacher.waitForFunction(() => document.querySelector('.detail-plan')?.naturalWidth > 0);

  await refresh(teacher);
  await teacher.waitForTimeout(300);
  assert.equal(await teacher.locator('dialog[open]').count(), 1, 'la mise à jour de la liste ne ferme pas la fenêtre');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await teacher.locator('.detail-dialog').waitFor({ state: 'detached' });
});

test('HIS-09 : une panne à la préparation le dit, et le bouton reste utilisable', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  await handIn(site, await join(site, launch, 'Léa'), { f1: entry(40, 60) });
  await openLaunch();
  await teacher.route('**/sheets', (route) => route.fulfill({ status: 403, body: 'Lecture impossible pour le moment.' }));
  await teacher.getByRole('button', { name: 'Télécharger l’Excel' }).click();
  await teacher.getByText('Lecture impossible pour le moment.').waitFor();
  assert.equal(await teacher.getByRole('button', { name: 'Télécharger l’Excel' }).isEnabled(), true);
  await teacher.unroute('**/sheets');
  await saved(teacher, () => teacher.getByRole('button', { name: 'Télécharger l’Excel' }).click());
  assert.equal(await teacher.getByText('Lecture impossible pour le moment.').isVisible(), false);
});

/* --- HIS-05 : supprimer --- */

test('HIS-05 : supprimer un lancement demande confirmation, ramène au cours, et n’est proposé qu’une fois le cours fini', async (t) => {
  const { site, teacher, launch, course } = await setup(t);
  await teacher.getByText('Aucun élève pour le moment.').waitFor();
  assert.equal(await teacher.getByRole('button', { name: 'Supprimer ce lancement' }).isVisible(), false);

  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  const remove = teacher.getByRole('button', { name: 'Supprimer ce lancement' });
  await remove.waitFor();

  teacher.once('dialog', (dialog) => dialog.dismiss());
  await remove.click();
  await teacher.waitForTimeout(200);
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM launches').get().n, 1);

  const asked = [];
  teacher.once('dialog', (dialog) => {
    asked.push(dialog.message());
    return dialog.accept();
  });
  await remove.click();
  await teacher.waitForURL(`**/prof/cours/${course.id}`);
  assert.match(asked[0], /effacées pour de bon/);
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM launches').get().n, 0);
  assert.equal(launch.id.length > 0, true);
});

test('HIS-02, SUI-04 : depuis le cours, l’enseignant retrouve ses lancements et ses élèves une fois le cours fini, avec l’heure de chacun', async (t) => {
  const { site, teacher, launch, course } = await setup(t);
  await handIn(site, await join(site, launch, 'Léa'), { f1: entry(40, 60) });
  site.db.prepare('UPDATE launches SET opened_at = ?').run('2026-03-12T10:00:00.000Z');
  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le .*\. Lancé le 12 mars 2026 à 11:00\. Version 1 du cours\.$/).waitFor();
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher
    .locator('#launchList')
    .getByRole('link', { name: /^Lancé le 12 mars 2026 à 11:00, terminé le / })
    .click();
  await row(teacher, 'Léa').getByText('1 / 2 bien placée(s)').waitFor();
});

test('sur un téléphone, la liste et ses boutons tiennent dans la largeur', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t, { viewport: { width: 360, height: 700 } });
  await handIn(site, await join(site, launch, 'Léa Dupont-Martin de la Fontaine'), { f1: entry(40, 60) });
  await openLaunch();
  await row(teacher, 'Léa').getByRole('button', { name: 'JPG' }).waitFor();
  assert.equal(await teacher.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  for (const button of await teacher.locator('.account-card button:visible').all()) {
    const box = await button.boundingBox();
    assert.ok(box.x + box.width <= 360, `${await button.textContent()} : jusqu’à ${box.x + box.width}`);
  }
});

/* --- HOR-09, HIS-06 : le fichier de réponses --- */

async function studentOffline(t, site, launch, names = 'Léa Dupont') {
  const page = await openPage(t, browser, { base: site.base });
  await page.goto(`/c/${launch.code}`);
  await page.getByLabel(/Votre prénom et votre nom/).fill(names);
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.locator('.label').first().waitFor();
  await page.locator('[data-measure="temperature"]').first().fill('21');
  await page.waitForTimeout(300);
  await page.route('**/api/student/answers', (route) => route.abort());
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  await page.locator('.panel-foot').getByText('Vos réponses restent sur cet appareil').waitFor();
  return page;
}

const SAVE_ANSWERS = 'Télécharger mes réponses, à donner à l’enseignant';

test('HOR-09 : l’envoi n’aboutit pas : l’élève récupère un fichier, sans correction, et l’enseignant l’importe', async (t) => {
  const { site, teacher, launch, openLaunch } = await setup(t);
  const page = await studentOffline(t, site, launch);
  const file = await saved(page, () => page.getByRole('button', { name: SAVE_ANSWERS }).click());
  assert.equal(file.name, 'Réponses - Léa Dupont.json');
  const content = JSON.parse(file.bytes.toString());
  assert.equal(content.format, 'cartopoint-reponses');
  assert.equal(content.names, 'Léa Dupont');
  assert.equal(content.answers.m1.f1.temperature, '21');
  assert.doesNotMatch(file.bytes.toString(), /refX|refY|results|score|token/i);

  await openLaunch();
  await row(teacher, 'Léa Dupont').getByText('A commencé').waitFor();
  await teacher.locator('#answersFile').setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes });
  await teacher.getByText('✓ Réponses de Léa Dupont importées.').waitFor();
  await row(teacher, 'Léa Dupont')
    .getByText(/par fichier/)
    .waitFor();
  assert.equal(participant(site, 'Léa Dupont').by_file, 1);

  await teacher.locator('#answersFile').setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes });
  await teacher.getByText('Les réponses de Léa Dupont étaient déjà arrivées : la première version reste.').waitFor();
});

test('HOR-09 : le bouton n’est là que si l’envoi n’a pas abouti', async (t) => {
  const { site, launch } = await setup(t);
  const page = await studentOffline(t, site, launch);
  await page.getByRole('button', { name: SAVE_ANSWERS }).waitFor();
  await page.unroute('**/api/student/answers');
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await page.locator('.panel-foot').getByText('Vos réponses sont bien arrivées').waitFor();
  assert.equal(await page.getByRole('button', { name: SAVE_ANSWERS }).count(), 0);
});

test('HOR-09 : des réponses refusées par le serveur peuvent aussi partir par fichier', async (t) => {
  const { site, launch } = await setup(t);
  const page = await openPage(t, browser, { base: site.base });
  await page.goto(`/c/${launch.code}`);
  await page.getByLabel(/Votre prénom et votre nom/).fill('Léa');
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.locator('.label').first().waitFor();
  await page.route('**/api/student/answers', (route) => route.fulfill({ status: 400, body: 'Réponses illisibles.' }));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  await page.getByRole('button', { name: SAVE_ANSWERS }).waitFor();
});

test('HIS-06 : un fichier d’un autre lancement, ou illisible, le dit, sans rien changer', async (t) => {
  const { site, teacher, launch, openLaunch, api, course } = await setup(t);
  await join(site, launch, 'Léa');
  await api.post(`/api/launches/${launch.id}/end`);
  const other = (await api.post(`/api/courses/${course.id}/launches`)).json();
  const stranger = await join(site, other, 'Inconnu');
  await openLaunch();
  const foreign = Buffer.from(JSON.stringify({ format: 'cartopoint-reponses', version: 1, participantId: stranger.id, names: 'Inconnu', answers: {} }));
  await teacher.locator('#answersFile').setInputFiles({ name: 'a.json', mimeType: 'application/json', buffer: foreign });
  await teacher.getByText(/autre lancement/).waitFor();
  await teacher.locator('#answersFile').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from('pas du JSON') });
  await teacher.getByText("Ce n'est pas un fichier de réponses.").waitFor();
  assert.equal(participant(site, 'Inconnu').submitted_at, null);
  assert.equal(participant(site, 'Léa').submitted_at, null);
});

test('HIS-06 : le bouton d’import ouvre bien le choix de fichier', async (t) => {
  const { teacher } = await setup(t);
  const chooser = teacher.waitForEvent('filechooser');
  await teacher.getByRole('button', { name: 'Importer un fichier de réponses' }).click();
  await chooser;
});
