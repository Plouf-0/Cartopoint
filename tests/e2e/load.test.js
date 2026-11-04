/**
 * QUA-09, à l'écran : ce que voit l'enseignant quand toute la classe est entrée. La charge côté serveur est dans tests/load.test.js.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, cheapHash, client } from '../helpers.js';
import { heading, launchBrowser, logIn, openPage, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const STUDENTS = 50;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

for (const [kind, viewport] of Object.entries({ 'sur ordinateur': { width: 1280, height: 800 }, 'sur téléphone': { width: 375, height: 700 } })) {
  test(`QUA-09 : ${kind}, l’enseignant suit une classe de ${STUDENTS} élèves, et la liste se met à jour`, async (t) => {
    const site = await startSite(t);
    addAccount(site.db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
    const api = client(site.base);
    await api.post('/api/auth/login', TEACHER);
    const draft = {
      format: 'inventaire-botanique',
      version: 3,
      title: 'Grande classe',
      theme: {},
      maps: [{ id: 'm1', name: 'Plan', image: '', fiches: [{ id: 'f1', common: 'Noisetier', visible: true, refX: 5, refY: 5, media: [] }] }]
    };
    const course = (await api.post('/api/courses', { draft })).json();
    await api.post(`/api/courses/${course.id}/publish`, { revision: course.revision });
    const launch = (await api.post(`/api/courses/${course.id}/launches`)).json();
    const joined = [];
    for (let i = 0; i < STUDENTS; i++)
      joined.push((await client(site.base).post(`/api/join/${launch.code}`, { names: `Prénom Nom-de-famille-assez-long ${i}` })).json());

    const page = await openPage(t, browser, { base: site.base, viewport });
    await logIn(page, TEACHER, '/prof');
    await heading(page, 'Mes cours');
    await page.goto(`/prof/lancements/${launch.id}`);
    await page.getByText(`${STUDENTS} élève(s) ou groupe(s) entré(s), aucun n'a fini.`).waitFor();
    assert.equal(await page.locator('.participants li').count(), STUDENTS);
    assert.equal(
      await page
        .locator('.participants li')
        .first()
        .textContent()
        .then((text) => text.includes('Nom-de-famille-assez-long 0')),
      true,
      'dans l’ordre d’arrivée'
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

    const response = await fetch(`${site.base}/api/student/answers`, {
      method: 'PUT',
      headers: { Origin: site.base, 'Content-Type': 'application/json', Authorization: `Bearer ${joined[0].token}` },
      body: JSON.stringify({ answers: { m1: { f1: { x: 5, y: 5 } } } })
    });
    assert.equal(response.status, 200);
    await page.getByText(`${STUDENTS} élève(s) ou groupe(s) entré(s), 1 a fini.`).waitFor({ timeout: 8000 });
  });
}
