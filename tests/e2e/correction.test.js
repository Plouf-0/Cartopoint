/**
 * Fin du cours, à l'écran : le travail se fige de lui-même (CRG-11), la correction arrive sans rien faire (CRG-06, CRG-12), reste le temps de la page
 * puis disparaît (CRG-08), et l'enseignant voit ce qui s'est passé avant et après la fin (CRG-13).
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, cheapHash } from '../helpers.js';
import { heading, launchBrowser, logIn, makePng, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const NAMES = 'Léa Dupont';
const PLAN = makePng(100, 100);
const PHOTO = makePng(30, 30);

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

async function setup(t) {
  const site = await startSite(t);
  addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const teacher = await openPage(t, browser, { base: site.base });
  await logIn(teacher, TEACHER, '/prof');
  await heading(teacher, 'Mes cours');
  return { site, teacher };
}

const upload = (teacher, buffer) =>
  teacher.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return (await (await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes })).json()).url;
  }, buffer.toString('base64'));

const fiche = (id, common, refX, refY, media = []) => ({ id, common, visible: true, refX, refY, media });

/** Le centre du plan est le bon endroit pour la première fiche : la placer au milieu donne « bien placée ». */
async function launchedCourse(teacher, { title = 'Sortie au parc', secondMap = false } = {}) {
  const plan = await upload(teacher, PLAN);
  const photo = await upload(teacher, PHOTO);
  const maps = [
    {
      id: 'm1',
      name: 'Parc',
      image: plan,
      fiches: [
        fiche('f1', 'Noisetier', 50, 50, [{ id: 'p1', type: 'image', name: 'p.png', data: photo }]),
        fiche('f2', 'Sureau', 5, 5),
        fiche('f3', 'Sans position', null, null)
      ]
    },
    ...(secondMap ? [{ id: 'm2', name: 'Bois', image: plan, fiches: [fiche('f4', 'Tilleul', 20, 20)] }] : [])
  ];
  const course = await teacher.evaluate(
    async ({ draft }) => {
      const send = async (url, body) => {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      };
      const created = await send('/api/courses', { draft });
      return send(`/api/courses/${created.id}/publish`, { revision: created.revision });
    },
    { draft: { format: 'inventaire-botanique', version: 3, title, theme: {}, maps } }
  );
  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.getByRole('button', { name: 'Lancer le cours' }).click();
  await teacher.getByRole('heading', { name: 'Pour rejoindre le cours' }).waitFor();
  return (await teacher.locator('.launch-code').first().textContent()).trim();
}

async function enter(page, code, names = NAMES) {
  await page.goto(`/c/${code}`);
  await page.getByLabel(/Votre prénom et votre nom/).fill(names);
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.locator('.label').first().waitFor();
}

async function newStudent(t, site, code, options = {}) {
  const page = await openPage(t, browser, { base: site.base, ...options });
  await enter(page, code);
  return page;
}

async function placeFirstFiche(page) {
  await page.locator('[data-place]').first().click();
  const box = await page.locator('#plan').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  await page.waitForTimeout(400);
}

async function endCourse(teacher) {
  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();
}

async function finish(page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  await page.locator('.panel-foot').getByText('Vos réponses sont bien arrivées').waitFor();
}

const wakeUp = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const correctionArrived = (page) => page.locator('#seeCorrection').waitFor({ timeout: 10000 });
const participant = (site, names = NAMES) => site.db.prepare('SELECT * FROM participants WHERE names = ?').get(names);
const teacherRow = (teacher, names = NAMES) => teacher.locator('.participants li', { hasText: names });

/** Ce que ce navigateur garde encore : IndexedDB et Cache Storage, sous forme de texte. */
const keptOnDevice = (page) =>
  page.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const open = indexedDB.open('inventaire-botanique');
      open.onsuccess = () => resolve(open.result);
    });
    const read = (method) =>
      new Promise((resolve) => {
        const request = database.transaction('progress').objectStore('progress')[method]();
        request.onsuccess = () => resolve(request.result);
      });
    const [keys, values] = [await read('getAllKeys'), await read('getAll')];
    database.close();
    const cached = {};
    for (const name of await caches.keys()) cached[name] = (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname);
    return { keys, values: JSON.stringify(values), media: cached['cartopoint-media'] ?? [], local: { ...localStorage }, session: { ...sessionStorage } };
  });

/* --- CRG-11, EV-39 : la fin du cours fige le travail --- */

test('CRG-11 : l’enseignant termine : le travail en cours se fige et part tout seul, sans rien demander à l’élève', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  const asked = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    return dialog.accept();
  });
  await placeFirstFiche(page);
  assert.ok((await page.locator('[data-place]').count()) > 0);
  await teacherRow(teacher).waitFor({ timeout: 8000 });
  await endCourse(teacher);

  await wakeUp(page);
  await correctionArrived(page);
  assert.deepEqual(asked, []);
  assert.equal(await page.locator('[data-place]').count(), 0, 'plus rien à placer');
  assert.equal(await page.getByRole('button', { name: 'Terminer', exact: true }).count(), 0);
  assert.equal(participant(site).auto_closed, 1);
  assert.equal(participant(site).late, 0);
  assert.equal(typeof JSON.parse(participant(site).answers).m1.f1.x, 'number', 'son travail est bien parti');
  await teacherRow(teacher).getByText('Figé à la fin du cours').waitFor({ timeout: 8000 });
});

test('CRG-11 : une fiche ouverte se referme, et un placement commencé s’annule', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const reading = await newStudent(t, site, code);
  await reading.locator('.label', { hasText: 'Noisetier' }).locator('h3').click();
  await reading.locator('#dlgRead[open]').waitFor();
  const placing = await newStudent(t, site, code);
  await placing.locator('[data-place]').first().click();
  await placing.locator('#placeHint').waitFor();
  await endCourse(teacher);

  await Promise.all([wakeUp(reading), wakeUp(placing)]);
  await Promise.all([correctionArrived(reading), correctionArrived(placing)]);
  assert.equal(await reading.locator('#dlgRead[open]').count(), 0);
  assert.equal(await placing.locator('#placeHint').isVisible(), false);
});

test('CRG-11 : deux contrôles en même temps n’envoient qu’une fois', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  const sends = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/student/answers')) sends.push(request.method());
  });
  await endCourse(teacher);
  await Promise.all([wakeUp(page), wakeUp(page), wakeUp(page)]);
  await correctionArrived(page);
  await page.waitForTimeout(200);
  assert.equal(sends.length, 1, sends.join(' | '));
  assert.ok(participant(site).submitted_at);
});

test('CRG-11 : l’élève qui avait déjà fini n’est pas signalé comme figé', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  await finish(page);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  assert.equal(participant(site).auto_closed, 0);
  await teacherRow(teacher).getByText('A fini', { exact: true }).waitFor({ timeout: 8000 });
});

/* --- CRG-06, CRG-12 : la correction arrive d'elle-même --- */

test('CRG-12, CRG-06 : la correction arrive sans rien faire : positions réelles, résultats et score', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 0, 'aucune position réelle avant la fin');
  assert.equal(await page.locator('#legendRef').isVisible(), false);
  await page.getByRole('heading', { name: 'Fiches à placer' }).waitFor();
  await finish(page);
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 0);
  await page.getByRole('heading', { name: 'Vos fiches' }).waitFor();
  await page.getByText('Votre travail est figé.', { exact: true }).waitFor();
  await endCourse(teacher);

  await wakeUp(page);
  await correctionArrived(page);
  await page.locator('#toast', { hasText: 'Votre correction est arrivée' }).waitFor();
  await page.locator('#courseBanner', { hasText: 'Votre correction est arrivée' }).waitFor();
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 2, 'les deux fiches qui ont une position réelle');
  await page.locator('#legendRef', { hasText: 'Position réelle' }).waitFor();
  await page.getByRole('heading', { name: 'Vos fiches' }).waitFor();
  await page.getByText('En bleu sur le plan, les positions réelles.').waitFor();
  await page.locator('.label', { hasText: 'Noisetier' }).getByText('Bien placée').waitFor();
  await page.locator('.label', { hasText: 'Sureau' }).getByText('Non placée').waitFor();
  await page.locator('.panel-foot').getByText('1 / 2 bien placée(s) · 1 non placée(s)').waitFor();

  await page.locator('#seeCorrection').click();
  const dialog = page.locator('#dlgCorrection[open]');
  await dialog.getByText('Votre correction').waitFor();
  await dialog.getByText(NAMES).waitFor();
  await dialog.locator('tr', { hasText: 'Noisetier' }).getByText('Bien placée').waitFor();
  await dialog
    .locator('tr', { hasText: 'Noisetier' })
    .getByText(/^\d+\.\d % du plan$/)
    .waitFor();
  await dialog.locator('tr', { hasText: 'Sans position' }).getByText('Pas de position réelle').waitFor();
  await dialog.getByText('Cette correction disparaît quand vous fermez la page').waitFor();
  assert.equal(await dialog.getByText(/rendu prof/i).count(), 0, 'CRG-10 : pas de fichier pour l’enseignant côté élève');
  await dialog.locator('[data-close]').click();
  await page.locator('#dlgCorrection[open]').waitFor({ state: 'detached' });
});

test('CRG-09 : le résultat affiché est celui du serveur, pas un calcul de l’appareil', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  await finish(page);
  await endCourse(teacher);
  const results = JSON.parse(participant(site).results);
  results.maps.m1.fiches.f1 = { state: 'far', d: 99, dist: 'écart du serveur' };
  site.db.prepare('UPDATE participants SET results = ? WHERE names = ?').run(JSON.stringify(results), NAMES);

  await wakeUp(page);
  await correctionArrived(page);
  await page.locator('.label', { hasText: 'Noisetier' }).getByText('À revoir').waitFor();
  await page.locator('#seeCorrection').click();
  await page.locator('#dlgCorrection tr', { hasText: 'Noisetier' }).getByText('écart du serveur').waitFor();
});

test('CRG-12 : une correction qui n’arrive pas du premier coup se rattrape au contrôle suivant', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await finish(page);
  await endCourse(teacher);
  await page.route('**/api/student/correction', (route) => route.abort());
  await wakeUp(page);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#seeCorrection').count(), 0);
  await page.unroute('**/api/student/correction');
  await wakeUp(page);
  await correctionArrived(page);
});

test('CRG-12 : un envoi qui échoue à la fin du cours repart, puis la correction arrive', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await endCourse(teacher);
  await page.route('**/api/student/answers', (route) => route.abort());
  await wakeUp(page);
  await page.locator('.panel-foot').getByText('Vos réponses restent sur cet appareil').waitFor();
  assert.equal(await page.locator('#seeCorrection').count(), 0);
  await page.unroute('**/api/student/answers');
  await wakeUp(page);
  await correctionArrived(page);
  assert.equal(participant(site).auto_closed, 1);
});

test('CRG-12 : un envoi qui se finit juste après le contrôle : la correction n’attend pas le suivant, et n’est demandée qu’une fois', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await endCourse(teacher);
  const asked = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/student/correction')) asked.push(request.url());
  });
  // L'envoi reste en route pendant que le contrôle apprend la fin du cours
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/api/student/answers', async (route) => {
    await held;
    await route.continue();
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  await page.locator('.panel-foot').getByText('Envoi de vos réponses').waitFor();
  const checked = page.waitForResponse('**/api/student/state');
  await wakeUp(page);
  await checked;
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#seeCorrection').count(), 0);

  release();
  await correctionArrived(page);
  await page.waitForTimeout(200);
  assert.equal(asked.length, 1, asked.join(' | '));
});

test('CRG-06 : une fois la correction arrivée, la page cesse d’interroger le serveur', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  const later = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/student/')) later.push(request.url());
  });
  await wakeUp(page);
  await page.waitForTimeout(300);
  assert.deepEqual(later, []);
});

test('CRG-06 : sur plusieurs cartes, la correction couvre tout, et le score aussi', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher, { secondMap: true });
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  await page.locator('.panel-foot').getByText('1 / 3 bien placée(s) · 2 non placée(s)').waitFor();
  await page.locator('#mapChoice').selectOption('m2');
  await page.locator('.pin[data-kind="ref"]').first().waitFor();
  await page.locator('.label', { hasText: 'Tilleul' }).getByText('Non placée').waitFor();
});

test('CRG-06 : sur un petit téléphone, la correction tient dans la largeur', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code, { viewport: { width: 320, height: 568 } });
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  await page.locator('#seeCorrection').click();
  await page.locator('#dlgCorrection[open]').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  const box = await page.locator('#correctionReport').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 320);
});

/* --- CRG-10 : le compte rendu --- */

test('CRG-10 : le compte rendu se télécharge, avec les placements et les résultats, sans les positions réelles', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await openPage(t, browser, { base: site.base });
  await page.addInitScript(() => {
    window.drawn = { texts: [], dashes: 0 };
    const { fillText, setLineDash } = CanvasRenderingContext2D.prototype;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      window.drawn.texts.push(String(text));
      return fillText.call(this, text, ...rest);
    };
    CanvasRenderingContext2D.prototype.setLineDash = function (dash) {
      // [5, 4] dessine le rond d'une fiche non placée, dans le tableau : sans rapport avec le plan
      if (dash.length && dash[0] !== 5) window.drawn.dashes++;
      return setLineDash.call(this, dash);
    };
  });
  await enter(page, code);
  await placeFirstFiche(page);
  await finish(page);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  await page.locator('#seeCorrection').click();
  const saved = page.waitForEvent('download');
  await page.locator('#correctionReport').click();
  const file = await saved;
  assert.equal(file.suggestedFilename(), 'Compte rendu - Léa Dupont.jpg');
  await page.locator('#toast', { hasText: '✓ Compte rendu téléchargé' }).waitFor();

  const drawn = await page.evaluate(() => window.drawn);
  assert.ok(drawn.texts.includes('Léa Dupont') || drawn.texts.some((text) => text.includes('Léa Dupont')), 'ses noms');
  assert.ok(
    drawn.texts.some((text) => text.includes('Bien placée')),
    'ses résultats'
  );
  assert.ok(!drawn.texts.includes('Position réelle'), 'pas de légende des positions réelles');
  assert.equal(drawn.dashes, 0, 'pas de pointillés vers les positions réelles');
});

/* --- CRG-08 : le temps de la page --- */

test('CRG-08 : la correction résiste à un rechargement, même sans réseau, sans redemander au serveur', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  const asked = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/student/correction')) asked.push(request.url());
  });

  await page.reload();
  await correctionArrived(page);
  assert.deepEqual(asked, []);
  assert.equal(await page.locator('.pin[data-kind="ref"]').count(), 2);
  await page.locator('#courseBanner', { hasText: 'Votre correction est arrivée' }).waitFor();
  assert.equal(await page.locator('[data-place]').count(), 0);
});

test('CRG-08 : les positions réelles ne vont ni dans IndexedDB ni dans un cache, seulement dans cet onglet', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  await page.waitForTimeout(500);
  const kept = await keptOnDevice(page);
  assert.doesNotMatch(kept.values, /refX|refY/);
  assert.match(kept.values, /Sortie au parc/, 'la recherche porte bien sur la copie');
  assert.ok(Object.values(kept.session).join('').includes('refX'), 'dans cet onglet, le temps de la page');
  assert.ok(!Object.values(kept.local).join('').includes('refX'));
  assert.ok(
    kept.keys.some((key) => key.startsWith('efface/')),
    'marqué à effacer dès la réception'
  );
});

test('CRG-08 : fermée, la page ne laisse rien : ni correction, ni travail, ni nom, ni photos, et le code ne marche plus', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await page.locator('#offlineStatus', { hasText: 'Prêt pour le terrain' }).waitFor({ timeout: 15000 });
  await placeFirstFiche(page);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  assert.ok((await keptOnDevice(page)).media.length > 0, 'les photos étaient bien gardées');

  // Un autre onglet n'a pas sa sessionStorage : c'est ce qui reste d'une page fermée
  const reopened = await page.context().newPage();
  await page.goto('about:blank');
  await reopened.goto(`${site.base}/c/${code}`);
  await reopened.getByRole('heading', { name: 'Impossible de rejoindre ce cours' }).waitFor();
  await reopened.getByText('Ce cours est terminé').waitFor();

  const kept = await keptOnDevice(reopened);
  assert.deepEqual(kept.keys, []);
  assert.deepEqual(kept.media, []);
  assert.ok(!JSON.stringify(kept.local).includes('Léa'), 'son nom non plus');
  assert.equal(await reopened.locator('.pin').count(), 0);
});

test('CRG-08 : un plan aussi utilisé par un autre cours de cet appareil reste gardé', async (t) => {
  const { site, teacher } = await setup(t);
  const first = await launchedCourse(teacher, { title: 'Premier' });
  const second = await launchedCourse(teacher, { title: 'Second' });
  const page = await newStudent(t, site, first);
  await page.locator('#offlineStatus', { hasText: 'Prêt pour le terrain' }).waitFor({ timeout: 15000 });
  await enter(page, second, 'Tom Martin');
  await page.locator('#offlineStatus', { hasText: 'Prêt pour le terrain' }).waitFor({ timeout: 15000 });
  const before = (await keptOnDevice(page)).media;
  assert.ok(before.length >= 2);

  // Le premier cours se termine, chez un élève dont l'onglet est fermé et le travail marqué à effacer
  const id = participant(site).id;
  await page.evaluate(async (id) => {
    const database = await new Promise((resolve) => {
      const open = indexedDB.open('inventaire-botanique');
      open.onsuccess = () => resolve(open.result);
    });
    await new Promise((resolve) => {
      const transaction = database.transaction('progress', 'readwrite');
      transaction.objectStore('progress').put(true, `efface/${id}`);
      transaction.oncomplete = resolve;
    });
    database.close();
    sessionStorage.removeItem(`cartopoint.seance.${id}`);
  }, id);
  await page.reload();
  await page.locator('#pageTitle', { hasText: 'Second' }).waitFor();
  const kept = await keptOnDevice(page);
  assert.deepEqual(kept.media.sort(), before.sort(), 'ce sont les mêmes fichiers : le second cours en a besoin');
  assert.ok(!kept.keys.includes(`cours/${id}`), 'le premier est bien effacé');
  assert.ok(
    kept.keys.some((key) => key.startsWith('cours/')),
    'pas le second'
  );
});

test('CRG-08 : une page fermée avant la fin ne reçoit pas la correction, mais son travail part quand même', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  const context = page.context();
  const later = await context.newPage();
  await page.goto('about:blank');
  await endCourse(teacher);
  const asked = [];
  later.on('request', (request) => {
    if (request.url().endsWith('/api/student/correction')) asked.push(request.url());
  });

  await later.goto(`${site.base}/c/${code}`);
  await later
    .locator('#courseBanner', { hasText: 'La correction n’est donnée' })
    .or(later.locator('#courseBanner', { hasText: "La correction n'est donnée" }))
    .waitFor({ timeout: 10000 });
  await later.waitForTimeout(300);
  assert.deepEqual(asked, []);
  assert.equal(await later.locator('#seeCorrection').count(), 0);
  assert.equal(await later.locator('.pin[data-kind="ref"]').count(), 0);
  assert.equal(participant(site).auto_closed, 1);
  assert.equal(typeof JSON.parse(participant(site).answers).m1.f1.x, 'number');

  const third = await context.newPage();
  await later.goto('about:blank');
  await third.goto(`${site.base}/c/${code}`);
  await third.getByRole('heading', { name: 'Impossible de rejoindre ce cours' }).waitFor();
  assert.deepEqual((await keptOnDevice(third)).keys, []);
});

test('CRG-08 : un rechargement avant la fin garde le droit à la correction', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await page.waitForFunction(() => Object.values(sessionStorage).some((value) => value.includes('"beforeEnd":true')));
  await page.reload();
  await page.locator('.label').first().waitFor();
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
});

/* --- CRG-13 : ce que voit l'enseignant --- */

test('CRG-13 : chaque réponse garde son heure, placement comme mesure, et elle survit à un rechargement', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  const before = Date.now();
  await placeFirstFiche(page);
  await page.locator('[data-measure="temperature"]').nth(1).fill('21');
  await page.waitForTimeout(400);
  await page.reload();
  await page.locator('.pin').first().waitFor();
  await finish(page);
  const { m1 } = JSON.parse(participant(site).answers);
  assert.ok(m1.f1.at >= before - 2000, 'le placement');
  assert.ok(m1.f2.at >= before - 2000, 'la mesure');
  assert.equal(m1.f2.temperature, '21');
});

test('CRG-13 : au doigt, sans réseau : la fiche se place et garde son heure', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code, { touch: true, viewport: { width: 390, height: 780 } });
  await page.context().setOffline(true);
  const before = Date.now();
  await page.locator('[data-place]').first().tap();
  await page.locator('#plan').scrollIntoViewIfNeeded();
  const box = await page.locator('#plan').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.pin').first().waitFor();
  await page.waitForTimeout(400);
  await page.context().setOffline(false);
  await endCourse(teacher);
  await wakeUp(page);
  await correctionArrived(page);
  assert.ok(JSON.parse(participant(site).answers).m1.f1.at >= before - 2000);
});

test('CRG-13 : un téléphone à la mauvaise heure : le serveur remet ses réponses à l’heure', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await openPage(t, browser, { base: site.base });
  await page.clock.install({ time: new Date(Date.now() - 3 * 60 * 60 * 1000) });
  await enter(page, code);
  await placeFirstFiche(page);
  await finish(page);
  const at = JSON.parse(participant(site).answers).m1.f1.at;
  assert.ok(Math.abs(at - Date.now()) < 60000, `${Math.round((Date.now() - at) / 60000)} minutes d’écart`);
  assert.ok(Math.abs(Date.parse(participant(site).finished_at) - Date.now()) < 60000);
});

test('CRG-13, Q-19 : sans réseau à la fin, la page ne sait rien : le travail fait ensuite est compté, signalé et noté', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await page.context().setOffline(true);
  await endCourse(teacher);
  // Le cours est fini depuis 10 minutes, et l'élève, sans réseau, continue : il ne peut pas le savoir
  site.db.prepare('UPDATE launches SET ended_at = ?').run(new Date(Date.now() - 10 * 60000).toISOString());
  await page.waitForTimeout(100);
  assert.equal((await page.locator('[data-place]').count()) > 0, true, 'rien ne peut le bloquer');
  await placeFirstFiche(page);

  await page.context().setOffline(false);
  await correctionArrived(page);
  assert.equal(participant(site).answers_after_end, 1);
  assert.equal(participant(site).auto_closed, 1);
  await page.locator('.label', { hasText: 'Noisetier' }).getByText('Bien placée').waitFor();
  await teacher.reload();
  await teacherRow(teacher).getByText('Figé à la fin du cours · 1 réponse(s) après la fin').waitFor();
});

test('CRG-13 : terminer sans réseau avant la fin : l’enseignant voit que c’était avant, et reçu après', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await placeFirstFiche(page);
  await page.context().setOffline(true);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  await page.locator('.panel-foot').getByText('Vos réponses restent sur cet appareil').waitFor();
  await endCourse(teacher);

  await page.context().setOffline(false);
  await correctionArrived(page);
  assert.equal(participant(site).late, 1);
  assert.equal(participant(site).auto_closed, 0);
  await teacher.reload();
  await teacherRow(teacher).getByText('A fini avant la fin, reçu après').waitFor();
});

test('CRG-13 : terminer sans réseau après la fin : l’enseignant le voit aussi', async (t) => {
  const { site, teacher } = await setup(t);
  const code = await launchedCourse(teacher);
  const page = await newStudent(t, site, code);
  await page.context().setOffline(true);
  await endCourse(teacher);
  site.db.prepare('UPDATE launches SET ended_at = ?').run(new Date(Date.now() - 10 * 60000).toISOString());
  await placeFirstFiche(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();

  await page.context().setOffline(false);
  await correctionArrived(page);
  await teacher.reload();
  await teacherRow(teacher).getByText('A fini après la fin du cours · 1 réponse(s) après la fin').waitFor();
});
