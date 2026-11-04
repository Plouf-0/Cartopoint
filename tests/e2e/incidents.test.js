/**
 * INC : le journal des problèmes, dans le navigateur. Ce qui échoue chez quelqu'un arrive tout seul à l'admin, avec la machine et la raison,
 * et jamais rien sur les élèves.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { addAccount, cheapHash } from '../helpers.js';
import { ADMIN, heading, launchBrowser, logIn, makePng, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const NAMES = 'Prénom-Marqueur NOM-MARQUEUR';
const TITLE = 'Titre-Marqueur';
const PLAN = makePng(40, 20);

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

const rows = (site) => site.db.prepare('SELECT * FROM incidents ORDER BY id').all();

async function waitForRow(site, pattern) {
  for (let tries = 0; tries < 100; tries++) {
    const found = rows(site).find((row) => pattern.test(row.reason));
    if (found) return { ...found, machine: JSON.parse(found.machine) };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(
    `« ${pattern} » n’est pas arrivé. Dans le journal : ${rows(site)
      .map((row) => row.reason)
      .join(' | ')}`
  );
}

/** Pour vérifier qu'une chose n'arrive pas : un témoin envoyé après elle prouve que le chemin fonctionne. */
async function nothingBut(site, page, expected = []) {
  await page.waitForTimeout(200);
  await report(page, 'Témoin', 'témoin');
  await waitForRow(site, /^témoin$/);
  assert.deepEqual(
    rows(site)
      .map((row) => row.reason)
      .filter((reason) => reason !== 'témoin'),
    expected
  );
}

const report = (page, action, reason) =>
  page.evaluate(({ action, reason }) => import('/js/incident.js').then((m) => m.reportIncident(action, reason)), { action, reason });

/** Comme une vraie erreur : un script de la page, et non une évaluation de Playwright, que le journal prendrait pour une extension. */
const runScript = (page, text) =>
  page.evaluate((text) => {
    const script = document.createElement('script');
    script.textContent = text;
    document.head.append(script);
  }, text);

const callApi = (page, method, target) =>
  page.evaluate(
    ({ method, target }) =>
      import('/js/api.js').then((m) =>
        m.api(method, target, method === 'GET' ? undefined : {}).then(
          () => 'réussi',
          (e) => e.status
        )
      ),
    { method, target }
  );

async function teacherSite(t) {
  const site = await startSite(t);
  addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  const teacher = await openPage(t, browser, { base: site.base });
  await logIn(teacher, TEACHER, '/prof');
  await heading(teacher, 'Mes cours');
  return { site, teacher };
}

async function draftCourse(teacher) {
  return teacher.evaluate(
    async ({ title, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const plan = (await (await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes })).json()).url;
      const response = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft: {
            format: 'inventaire-botanique',
            version: 3,
            title,
            theme: {},
            maps: [{ id: 'm1', name: 'Parc', image: plan, fiches: [{ id: 'f1', common: 'Noisetier', visible: true, refX: 50, refY: 50, media: [] }] }]
          }
        })
      });
      return { ...(await response.json()), plan };
    },
    { title: TITLE, base64: PLAN.toString('base64') }
  );
}

/** Un cours publié et lancé. */
async function course(teacher) {
  const draft = await draftCourse(teacher);
  return teacher.evaluate(async ({ id, revision, plan }) => {
    const send = async (url, body) =>
      (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const published = await send(`/api/courses/${id}/publish`, { revision });
    const launch = await send(`/api/courses/${id}/launches`, {});
    return { ...published, plan, code: launch.code, launchId: launch.id };
  }, draft);
}

async function student(t, site, code, options = {}) {
  const page = await openPage(t, browser, { base: site.base, ...options });
  if (options.init) await page.addInitScript(options.init);
  await page.goto(`/c/${code}`);
  await page.getByLabel(/Votre prénom et votre nom/).fill(NAMES);
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.locator('.label').first().waitFor();
  return page;
}

async function finish(page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
}

/* --- Ce qui arrive tout seul --- */

test('INC-01 : une erreur du programme arrive de chaque page, avec son adresse, sa pile et la machine', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { id, code, launchId } = await course(teacher);
  const page = await openPage(t, browser, { base: site.base, expectErrors: true });
  await logIn(page, TEACHER, '/prof');
  await heading(page, 'Mes cours');
  const addresses = ['/', '/accueil', '/admin', '/invitation', '/prof', `/prof/cours/${id}`, `/prof/lancements/${launchId}`, `/c/${code}`];
  for (const address of addresses) {
    await page.goto(address);
    await page.waitForLoadState('networkidle');
    await runScript(page, `throw new Error('panne sur ${address}')`);
    const row = await waitForRow(site, new RegExp(`panne sur ${address}$`));
    assert.equal(row.action, 'Erreur du programme');
    assert.equal(row.page, address);
    assert.match(row.reason, /^Error : panne sur/);
    assert.match(row.details, /panne sur/, 'la pile d’appels');
  }
});

test('INC-01 : la signature de la machine : navigateur, écran, mémoire, et surtout la place sur le disque', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await report(teacher, 'Essai', 'une raison');
  const { machine } = await waitForRow(site, /^une raison$/);
  assert.match(machine.browser, /Chrome/);
  assert.equal(machine.language, 'fr-FR');
  assert.match(machine.screen, /^\d+×\d+$/);
  assert.equal(machine.window, '1280×800');
  assert.equal(machine.pixelRatio, 1);
  assert.ok(machine.cores >= 1);
  assert.ok(machine.storageQuota > 0, 'la place que le navigateur pense pouvoir utiliser');
  assert.ok(machine.storageUsed >= 0);
  assert.equal(machine.online, true);
  assert.equal(machine.worker, false);
});

test('INC-01 : le compte de l’enseignant est noté, et la place manquante se voit (le cas d’EV-04)', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await report(teacher, 'Essai', 'plus de place');
  const row = await waitForRow(site, /^plus de place$/);
  assert.equal(site.db.prepare('SELECT email FROM accounts WHERE id = ?').get(row.account_id).email, TEACHER.email);
});

test('INC-01 : une promesse rejetée sans personne pour l’attraper arrive aussi', async (t) => {
  const { site } = await teacherSite(t);
  const page = await openPage(t, browser, { base: site.base, expectErrors: true });
  await page.goto('/accueil');
  await runScript(page, "Promise.reject(new TypeError('promesse perdue'))");
  const row = await waitForRow(site, /promesse perdue/);
  assert.equal(row.action, 'Erreur du programme');
  assert.match(row.reason, /^TypeError : promesse perdue/);
});

test('INC-01 : ce qui ne vient pas du site reste dehors : le bruit du navigateur, les extensions', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const page = await openPage(t, browser, { base: site.base, expectErrors: true });
  await page.goto('/accueil');
  await runScript(page, "throw new Error('x')");
  await waitForRow(site, /Error : x/);
  site.db.exec('DELETE FROM incidents');
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'panne d’une extension', filename: 'chrome-extension://abc/page.js' }));
  });
  await nothingBut(site, teacher);
});

test('INC-01 : un message d’erreur affiché arrive, un message ordinaire non', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.evaluate(() =>
    import('/js/util.js').then(({ toast }) => {
      toast('✓ Tout va bien');
      toast('Indiquez au moins un nom');
    })
  );
  await nothingBut(site, teacher);
  await teacher.evaluate(() => import('/js/util.js').then(({ toast }) => toast('⚠ Enregistrement impossible : plein')));
  const row = await waitForRow(site, /Enregistrement impossible/);
  assert.equal(row.action, 'Message affiché');
  assert.equal(row.reason, '⚠ Enregistrement impossible : plein');
});

test('INC-01 : un bandeau d’erreur permanent arrive aussi', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.goto(`/prof/cours/${(await course(teacher)).id}`);
  await teacher.locator('#fatal').waitFor({ state: 'attached' });
  await teacher.evaluate(() => import('/js/util.js').then(({ fatal }) => fatal('Le stockage est indisponible')));
  assert.equal((await waitForRow(site, /Le stockage est indisponible/)).action, 'Message affiché');
});

/* --- Les appels au serveur --- */

test('INC-01 : une erreur du serveur et un envoi trop gros arrivent, avec le code et l’adresse', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.route('**/api/essai-500', (route) => route.fulfill({ status: 500, body: 'panne interne' }));
  await teacher.route('**/api/essai-413', (route) => route.fulfill({ status: 413, body: 'trop gros' }));
  assert.equal(await callApi(teacher, 'POST', '/essai-500'), 500);
  assert.equal(await callApi(teacher, 'GET', '/essai-500'), 500);
  assert.equal(await callApi(teacher, 'POST', '/essai-413'), 413);
  const row = await waitForRow(site, /POST \/essai-500 : 500 panne interne/);
  assert.equal(row.action, 'Réponse du serveur');
  await waitForRow(site, /GET \/essai-500 : 500/);
  await waitForRow(site, /POST \/essai-413 : 413 trop gros/);
});

test('INC-01 : un refus ordinaire n’est pas une panne : mauvais mot de passe, page absente, conflit', async (t) => {
  const { site, teacher } = await teacherSite(t);
  for (const status of [400, 401, 403, 404, 409, 429]) {
    await teacher.route(`**/api/essai-${status}`, (route) => route.fulfill({ status, body: 'refus' }));
    assert.equal(await callApi(teacher, 'POST', `/essai-${status}`), status);
  }
  await nothingBut(site, teacher);
});

test('INC-01 : une écriture perdue alors que le réseau semble là arrive, une lecture perdue non', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.route('**/api/essai-coupe', (route) => route.abort());
  assert.equal(await callApi(teacher, 'GET', '/essai-coupe'), 0);
  await nothingBut(site, teacher);
  assert.equal(await callApi(teacher, 'POST', '/essai-coupe'), 0);
  assert.equal((await waitForRow(site, /POST \/essai-coupe/)).action, 'Serveur injoignable');
});

test('INC-01 : sans réseau, une écriture qui échoue n’a rien d’anormal', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.context().setOffline(true);
  assert.equal(await callApi(teacher, 'POST', '/essai-hors-ligne'), 0);
  await teacher.context().setOffline(false);
  await nothingBut(site, teacher);
});

test('INC-01 : le journal lui-même en panne ne gêne rien, et ne se signale pas lui-même', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const calls = [];
  await teacher.route('**/api/incidents', (route) => {
    calls.push(route.request().url());
    return route.abort();
  });
  await report(teacher, 'Essai', 'sans journal');
  assert.equal(calls.length, 1);
  await teacher.waitForTimeout(100);
  assert.equal(calls.length, 1);
  assert.deepEqual(rows(site), []);
});

/* --- Publication et enregistrement : le parcours de l'enseignant --- */

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

async function openCourseTab(teacher, id) {
  await teacher.goto(`/prof/cours/${id}`);
  await teacher.getByRole('tab', { name: 'Cours' }).click();
}

test('INC-01 : une publication qui échoue arrive, avec sa raison ; un cours modifié ailleurs n’est pas une panne', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { id } = await draftCourse(teacher);
  await openCourseTab(teacher, id);
  await teacher.route(`**/api/courses/${id}/publish`, (route) => route.fulfill({ status: 409, body: 'Modifié ailleurs.' }));
  await teacher.locator('#publishBtn').click();
  await teacher.getByText('Publication impossible : Modifié ailleurs.').waitFor();
  await nothingBut(site, teacher);
  site.db.exec('DELETE FROM incidents');

  await teacher.unroute(`**/api/courses/${id}/publish`);
  await teacher.route(`**/api/courses/${id}/publish`, (route) => route.fulfill({ status: 400, body: 'Plan illisible.' }));
  await teacher.locator('#publishBtn').click();
  const row = await waitForRow(site, /Plan illisible/);
  assert.equal(row.action, 'Publication');
});

test('INC-01 : un plan que le navigateur ne peut pas mesurer arrive aussi', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { id, plan } = await draftCourse(teacher);
  await rename(path.join(site.data, plan), path.join(site.data, plan) + '.absent');
  await openCourseTab(teacher, id);
  await teacher.locator('#publishBtn').click();
  await teacher.locator('#publishError').waitFor();
  assert.equal((await waitForRow(site, /./)).action, 'Publication');
});

test('INC-01 : un enregistrement du cours qui échoue arrive ; un conflit ou une session expirée n’est pas une panne', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { id } = await draftCourse(teacher);
  await teacher.goto(`/prof/cours/${id}`);
  const failWith = async (status, body) => {
    await teacher.unroute('**/api/courses/*');
    await teacher.route('**/api/courses/*', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status, body }) : route.continue()));
  };
  await failWith(409, 'Modifié ailleurs.');
  await addFiche(teacher, 'Premier essai');
  await teacher.locator('#saveBanner', { hasText: 'Modifié ailleurs.' }).waitFor();
  await nothingBut(site, teacher);
  site.db.exec('DELETE FROM incidents');

  await teacher.reload();
  await failWith(401, 'Session expirée.');
  await addFiche(teacher, 'Deuxième essai');
  await teacher.locator('#saveBanner', { hasText: 'Votre session a expiré' }).waitFor();
  await nothingBut(site, teacher);
  site.db.exec('DELETE FROM incidents');

  await teacher.reload();
  await failWith(400, 'Enregistrement refusé par le serveur.');
  await addFiche(teacher, 'Troisième essai');
  assert.equal((await waitForRow(site, /Enregistrement refusé par le serveur/)).action, 'Enregistrement du cours');
});

test('INC-01 : un lancement qui échoue arrive', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { id, launchId } = await course(teacher);
  await teacher.evaluate(
    (launchId) => fetch(`/api/launches/${launchId}/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    launchId
  );
  await openCourseTab(teacher, id);
  await teacher.route(`**/api/courses/${id}/launches`, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 403, body: 'Compte désactivé.' }) : route.fallback()
  );
  await teacher.getByRole('button', { name: 'Lancer le cours' }).click();
  const row = await waitForRow(site, /Compte désactivé/);
  assert.equal(row.action, 'Lancement');
});

/* --- Sans réseau, le message attend --- */

const waitingReports = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cartopoint.incidents') ?? '[]'));

test('INC-06 : sans réseau, le message attend sur l’appareil, et part au retour du réseau avec son âge', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.context().setOffline(true);
  await report(teacher, 'Essai', 'vu hors ligne');
  const [waiting] = await waitingReports(teacher);
  assert.equal(waiting.reason, 'vu hors ligne');
  assert.equal(waiting.machine.online, false, 'la machine telle qu’elle était');
  assert.deepEqual(rows(site), []);
  await teacher.waitForTimeout(1200);

  await teacher.context().setOffline(false);
  const row = await waitForRow(site, /^vu hors ligne$/);
  assert.equal(row.machine.online, false);
  assert.ok(Date.now() - Date.parse(row.last_at) >= 1000, 'daté du problème, pas de l’envoi');
  assert.deepEqual(await waitingReports(teacher), []);
});

test('INC-06 : un téléphone qui se croyait en ligne n’annonce jamais le retour du réseau : le message part dès que le serveur répond', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await new Promise((resolve) => {
    site.app.server.close(resolve);
    site.app.server.closeAllConnections();
  });
  await report(teacher, 'Essai', 'vu quand rien ne répondait');
  assert.equal((await waitingReports(teacher)).length, 1);
  assert.equal(await teacher.evaluate(() => navigator.onLine), true);

  await new Promise((resolve) => site.app.server.listen(new URL(site.base).port, '127.0.0.1', resolve));
  await callApi(teacher, 'GET', '/auth/me');
  await waitForRow(site, /^vu quand rien ne répondait$/);
  assert.deepEqual(await waitingReports(teacher), []);
});

test('INC-06 : le message qui attendait part aussi à la prochaine ouverture d’une page', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.context().setOffline(true);
  await report(teacher, 'Essai', 'vu avant de fermer');
  await teacher.context().setOffline(false);
  // Le retour du réseau l'aurait déjà envoyé : on remet le message comme s'il n'avait pas pu l'être
  await waitForRow(site, /vu avant de fermer/);
  site.db.exec('DELETE FROM incidents');
  await teacher.evaluate(() =>
    localStorage.setItem(
      'cartopoint.incidents',
      JSON.stringify([{ at: Date.now() - 5000, page: '/prof', action: 'Essai', reason: 'retrouvé à l’ouverture', details: '', machine: {} }])
    )
  );
  await teacher.goto('/accueil');
  await waitForRow(site, /retrouvé à l’ouverture/);
});

test('INC-06 : un serveur en panne garde le message pour plus tard, un refus du serveur l’oublie', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.route('**/api/incidents', (route) => route.fulfill({ status: 503, body: 'panne' }));
  await report(teacher, 'Essai', 'à garder');
  assert.equal((await waitingReports(teacher)).length, 1);
  await teacher.unroute('**/api/incidents');
  await teacher.evaluate(() => localStorage.removeItem('cartopoint.incidents'));

  await teacher.route('**/api/incidents', (route) => route.fulfill({ status: 429, body: 'trop' }));
  await report(teacher, 'Essai', 'à oublier');
  assert.deepEqual(await waitingReports(teacher), []);
  assert.deepEqual(rows(site), []);
});

test('INC-07 : un appareil ne garde que les 20 derniers messages, et une page n’en envoie pas plus de 30', async (t) => {
  const { site, teacher } = await teacherSite(t);
  await teacher.context().setOffline(true);
  for (let i = 0; i < 25; i++) await report(teacher, 'Essai', `problème ${i}`);
  const waiting = await waitingReports(teacher);
  assert.equal(waiting.length, 20);
  assert.equal(waiting[0].reason, 'problème 5');
  assert.equal(waiting.at(-1).reason, 'problème 24');
  for (let i = 25; i < 40; i++) await report(teacher, 'Essai', `problème ${i}`);
  assert.equal((await waitingReports(teacher)).at(-1).reason, 'problème 29', 'une page qui s’emballe finit par se taire');
  await teacher.evaluate(() => localStorage.setItem('cartopoint.incidents', 'pas du JSON'));
  await teacher.context().setOffline(false);
  await teacher.goto('/accueil');
  assert.equal(await teacher.locator('input').first().isVisible(), true, 'une file illisible ne gêne rien');
  assert.deepEqual(rows(site), []);
});

/* --- Ni nom, ni réponse, ni jeton --- */

test('INC-03 : l’adresse est notée sans ce qui suit le chemin : un lien d’invitation porte son secret après le #', async (t) => {
  const { site } = await teacherSite(t);
  const page = await openPage(t, browser, { base: site.base });
  await page.goto('/invitation?essai=SECRET-QUESTION#SECRET-DIESE');
  await report(page, 'Essai', 'depuis une invitation');
  const row = await waitForRow(site, /depuis une invitation/);
  assert.equal(row.page, '/invitation');
  assert.doesNotMatch(JSON.stringify(rows(site)), /SECRET/);
});

test('INC-03 : le parcours d’un élève qui a tous les ennuis : ni son nom, ni ses réponses, ni le cours dans le journal', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { code } = await course(teacher);
  const page = await student(t, site, code, {
    init: () => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (String(key).startsWith('rendu/')) throw new DOMException('plus de place', 'QuotaExceededError');
        return put.call(this, value, key);
      };
    }
  });
  await page.locator('[data-measure="temperature"]').first().fill('21');
  await page.route('**/api/student/answers', (route) => route.fulfill({ status: 400, body: 'Réponses illisibles.' }));
  await finish(page);
  const saved = await waitForRow(site, /Enregistrement impossible/);
  assert.match(saved.reason, /plus de place/);
  assert.ok(saved.machine.storageQuota > 0, 'de quoi juger de la place restante');
  assert.equal(saved.account_id, null);
  const refused = await waitForRow(site, /refus du serveur/);
  assert.equal(refused.action, 'Envoi des réponses');
  assert.match(refused.reason, /Réponses illisibles/);

  const stored = JSON.stringify(rows(site));
  assert.doesNotMatch(stored, /MARQUEUR|Marqueur/, 'ni nom, ni titre');
});

test('INC-01 : une image qui ne se télécharge pas pour le terrain arrive, avec le nombre et la raison', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { code, plan } = await course(teacher);
  await rename(path.join(site.data, plan), path.join(site.data, plan) + '.absent');
  const page = await student(t, site, code);
  await page.locator('#netRetry').waitFor({ timeout: 15000 });
  const row = await waitForRow(site, /1 image\(s\) non téléchargée\(s\) : ./);
  assert.equal(row.action, 'Préparation pour le terrain');
  assert.doesNotMatch(row.reason, /undefined/);
});

test('INC-01 : un navigateur qui ne peut pas garder le cours arrive, avec la raison', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { code } = await course(teacher);
  await student(t, site, code, {
    init: () => (ServiceWorkerContainer.prototype.register = () => Promise.reject(new DOMException('interdit ici', 'SecurityError')))
  });
  const row = await waitForRow(site, /SecurityError : interdit ici/);
  assert.equal(row.action, 'Préparation pour le terrain');
});

test('INC-01 : un cours impossible à écrire sur l’appareil arrive', async (t) => {
  const { site, teacher } = await teacherSite(t);
  const { code } = await course(teacher);
  await student(t, site, code, {
    init: () => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (String(key).startsWith('cours/')) throw new Error('refusé');
        return put.call(this, value, key);
      };
    }
  });
  assert.equal((await waitForRow(site, /le cours ne peut pas être écrit/)).action, 'Préparation pour le terrain');
});

/* --- INC-02 : ce que voit l'admin --- */

async function adminPage(t, site, options) {
  const page = await openPage(t, browser, { base: site.base, ...options });
  await logIn(page, ADMIN, '/admin');
  await heading(page, 'Journal des problèmes');
  return page;
}

const seed = (site, rowsToAdd) => {
  for (const [index, row] of rowsToAdd.entries())
    site.db
      .prepare(
        'INSERT INTO incidents (fingerprint, account_id, page, action, reason, details, machine, first_at, last_at, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        String(index),
        row.account ?? null,
        row.page ?? '/prof',
        row.action ?? 'Message affiché',
        row.reason ?? 'une raison',
        row.details ?? '',
        JSON.stringify(row.machine ?? {}),
        row.firstAt ?? '2026-11-04T10:00:00.000Z',
        row.lastAt ?? '2026-11-04T10:00:00.000Z',
        row.count ?? 1
      );
};

test('INC-02 : l’admin lit ce qui s’est passé, chez qui, et sur quelle machine, sans ouvrir de détail', async (t) => {
  const { site } = await teacherSite(t);
  const account = site.db.prepare('SELECT id FROM accounts WHERE email = ?').get(TEACHER.email).id;
  seed(site, [
    {
      account,
      page: '/prof/cours/abc',
      action: 'Publication',
      reason: 'QuotaExceededError : plus de place',
      details: 'la pile complète',
      count: 3,
      firstAt: '2026-11-01T10:00:00.000Z',
      lastAt: '2026-11-04T10:00:00.000Z',
      machine: {
        browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        cores: 12,
        memoryGb: 8,
        screen: '1920×1080',
        online: true,
        storageUsed: 1200000,
        storageQuota: 85000000000
      }
    }
  ]);
  const admin = await adminPage(t, site);
  const item = admin.locator('.incident');
  await item.getByText('Publication :').waitFor();
  await item.getByText('QuotaExceededError : plus de place').waitFor();
  const when = await item.locator('.incident-when').textContent();
  assert.match(when, /3 fois, depuis le 1(er)? nov/);
  assert.match(when, /prof@example\.org/);
  assert.match(when, /\/prof\/cours\/abc/);
  const summary = await item.locator('.hint').textContent();
  assert.match(summary, /^Chrome 120 sur Windows/);
  assert.match(summary, /12 cœurs/);
  assert.match(summary, /8 Go de mémoire ou plus/);
  assert.match(summary, /place pour ce site : 1,2 Mo utilisés sur 85 Go/);
  assert.match(summary, /écran 1920×1080/);
  assert.match(summary, /en ligne/);

  assert.equal(await item.locator('pre').isVisible(), false);
  await item.getByText('Tout voir').click();
  await item.locator('pre').getByText('la pile complète').waitFor();
  assert.match(await item.locator('pre').textContent(), /Windows NT 10\.0/);
});

test('INC-02 : chaque machine se nomme correctement', async (t) => {
  const { site } = await teacherSite(t);
  const agents = {
    'Safari 17 sur iOS':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Safari 16 sur macOS': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    'Chrome 119 sur Android': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    'Samsung Internet 23 sur Android':
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
    'Firefox 120 sur Linux': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Edge 120 sur Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Opera 105 sur Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0',
    'Navigateur inconnu': 'un robot'
  };
  seed(
    site,
    Object.values(agents).map((browserAgent) => ({ machine: { browser: browserAgent, memoryGb: 4, online: false } }))
  );
  const admin = await adminPage(t, site);
  await admin.locator('.incident').first().waitFor();
  const summaries = await admin.locator('.incident .hint').allTextContents();
  for (const name of Object.keys(agents))
    assert.ok(
      summaries.some((summary) => summary.startsWith(name)),
      `${name} : ${summaries.join(' | ')}`
    );
  assert.ok(summaries.every((summary) => summary.includes('4 Go de mémoire') && !summary.includes('ou plus')));
  assert.ok(summaries.every((summary) => summary.endsWith('hors ligne')));
});

test('INC-02 : un problème sans compte ni machine s’affiche quand même, et un seul essai ne dit pas « fois »', async (t) => {
  const { site } = await teacherSite(t);
  seed(site, [{ machine: {} }]);
  const admin = await adminPage(t, site);
  const when = await admin.locator('.incident-when').textContent();
  assert.match(when, /sans compte/);
  assert.doesNotMatch(when, /fois/);
  assert.equal(await admin.locator('.incident .hint').textContent(), 'Navigateur inconnu');
});

test('INC-02 : ce que le navigateur a envoyé s’affiche comme du texte, jamais comme du code', async (t) => {
  const { site } = await teacherSite(t);
  const attack = '<img src=x onerror="window.attaque=1">';
  seed(site, [{ page: attack, action: attack, reason: attack, details: attack, machine: { browser: attack, screen: attack } }]);
  const admin = await adminPage(t, site);
  await admin.locator('.incident').getByText('Tout voir').click();
  await admin.locator('.incident pre').waitFor();
  await admin.waitForTimeout(100);
  assert.equal(await admin.evaluate(() => window.attaque), undefined);
  assert.equal(await admin.locator('.incident img').count(), 0);
  assert.match(await admin.locator('.incident-what').textContent(), /<img src=x/);
});

test('INC-02 : le journal vide le dit, et l’effacer demande une confirmation', async (t) => {
  const { site } = await teacherSite(t);
  const admin = await adminPage(t, site);
  await admin.getByText('Aucun problème signalé.').waitFor();
  assert.equal(await admin.getByRole('button', { name: 'Tout effacer' }).isVisible(), false);
  await admin.getByText(/Jamais de nom d’élève/).waitFor();

  seed(site, [{ reason: 'à effacer' }]);
  await admin.reload();
  await admin.getByText('à effacer').waitFor();
  admin.once('dialog', (dialog) => dialog.dismiss());
  await admin.getByRole('button', { name: 'Tout effacer' }).click();
  await admin.waitForTimeout(150);
  assert.equal(rows(site).length, 1);

  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Tout effacer' }).click();
  await admin.getByText('Aucun problème signalé.').waitFor();
  assert.deepEqual(rows(site), []);
  assert.equal(await admin.getByRole('button', { name: 'Tout effacer' }).isVisible(), false);
});

test('INC-02 : un journal illisible ou impossible à effacer le dit, sans casser le tableau de bord', async (t) => {
  const { site } = await teacherSite(t);
  seed(site, [{ reason: 'à effacer' }]);
  const admin = await adminPage(t, site);
  await admin.getByText('à effacer').waitFor();
  await admin.route('**/api/admin/incidents/clear', (route) => route.fulfill({ status: 403, body: 'Interdit pour le moment.' }));
  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Tout effacer' }).click();
  await admin.getByText('Interdit pour le moment.').waitFor();

  await admin.route('**/api/admin/incidents', (route) => route.fulfill({ status: 403, body: 'Lecture interdite.' }));
  await admin.reload();
  await admin.getByText('Lecture interdite.').waitFor();
  await heading(admin, 'Inviter un enseignant');
});

test('INC-02 : sur un téléphone, une longue raison ne déborde pas de l’écran', async (t) => {
  const { site } = await teacherSite(t);
  seed(site, [{ reason: 'x'.repeat(900), page: '/' + 'y'.repeat(190), details: 'z'.repeat(900), machine: { browser: 'w'.repeat(390) } }]);
  const admin = await adminPage(t, site, { viewport: { width: 360, height: 640 } });
  await admin.locator('.incident').getByText('Tout voir').click();
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
});
