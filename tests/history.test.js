/**
 * L'historique côté serveur (HIS-02 à HIS-09) : résultats, fichier de réponses, suppression et purge. Un autre enseignant n'y voit rien (ANO-06). Les écrans
 * sont vérifiés dans tests/e2e/history.test.js, et le fichier Excel dans tests/results-workbook.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_LAUNCH_MS, createLaunches } from '../server/launches.mjs';
import { addAccount, cheapHash, client, request, startApp } from './helpers.js';

const PASSWORD = 'mot-de-passe-1';
const TEACHER = 'prof@example.org';
const OTHER = 'autre@example.org';
const content = (widthMeters = 100) => ({
  format: 'inventaire-botanique',
  version: 3,
  title: 'Sortie',
  theme: {},
  maps: [
    {
      id: 'm1',
      name: 'Parc',
      image: '',
      widthMeters,
      fiches: [
        { id: 'f1', common: 'Noisetier', visible: true, refX: 40, refY: 60, media: [] },
        { id: 'f2', common: 'Sureau', visible: true, refX: 10, refY: 60, media: [] }
      ]
    }
  ]
});
const entry = (x, y, extra = {}) => ({ x, y, temperature: '', humidity: '', light: '', ...extra });

async function site(t) {
  const started = await startApp(t);
  const { db } = started.app;
  addAccount(db, { email: TEACHER, hash: cheapHash(PASSWORD) });
  addAccount(db, { email: OTHER, hash: cheapHash(PASSWORD) });
  const browser = client(started.base);
  await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD });
  const other = client(started.base);
  await other.post('/api/auth/login', { email: OTHER, password: PASSWORD });
  return { ...started, db, browser, other };
}

async function launched(browser, draft = content()) {
  const course = (await browser.post('/api/courses', { draft })).json();
  await browser.post(`/api/courses/${course.id}/publish`, { revision: course.revision });
  return (await browser.post(`/api/courses/${course.id}/launches`)).json();
}

const join = async (base, code, names = 'Léa') => (await client(base).post(`/api/join/${code}`, { names })).json();
const send = (base, token, answers) =>
  request(base, '/api/student/answers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ answers })
  });
const row = (db, id) => db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
const answersFile = (me, answers = { m1: { f1: entry(40, 60) } }) => ({
  format: 'cartopoint-reponses',
  version: 1,
  participantId: me.id,
  names: me.names,
  answers,
  finishedAt: Date.now() - 1000
});

/* --- HIS-03 : une ligne par élève --- */

test('HIS-03 : chaque élève a son score et sa précision, en mètres si le cours connaît son échelle', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  const waiting = await join(base, launch.code, 'Tom');
  await send(base, me.token, { m1: { f1: entry(40, 60), f2: entry(30, 60) } });

  const details = (await browser.get(`/api/launches/${launch.id}`)).json();
  assert.equal(details.gapUnit, 'm');
  const seen = Object.fromEntries(details.participants.map((p) => [p.names, p]));
  assert.deepEqual(seen['Léa'].score, { ok: 1, near: 0, far: 1, unplaced: 0, noref: 0 });
  assert.equal(seen['Léa'].meanGap, 10, 'écarts de 0 et de 20 mètres');
  assert.equal(seen['Tom'].score, null, 'SUI-03 : rien sur celui qui n’a pas rendu');
  assert.equal(seen['Tom'].meanGap, null);
  assert.equal(waiting.names, 'Tom');
});

test('HIS-03 : sans échelle, la précision reste en % du plan, et une fiche non placée n’y entre pas', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser, content(null));
  const me = await join(base, launch.code);
  await send(base, me.token, { m1: { f1: entry(50, 60) } });
  const details = (await browser.get(`/api/launches/${launch.id}`)).json();
  assert.equal(details.gapUnit, '% du plan');
  assert.equal(details.participants[0].meanGap, 10);
  assert.equal(details.participants[0].score.unplaced, 1);
});

/* --- HIS-04, ANO-06 : les réponses, pour l'enseignant du cours seulement --- */

test('HIS-04 : l’enseignant reçoit le cours et toutes les réponses, positions réelles comprises', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await join(base, launch.code, 'Tom');
  await send(base, me.token, { m1: { f1: entry(40, 60, { temperature: '21' }) } });
  const response = await browser.get(`/api/launches/${launch.id}/sheets`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const sheets = response.json();
  assert.equal(sheets.course.maps[0].fiches[0].refX, 40);
  const seen = Object.fromEntries(sheets.participants.map((p) => [p.names, p]));
  assert.equal(seen['Léa'].answers.m1.f1.temperature, '21');
  assert.equal(seen['Léa'].results.maps.m1.fiches.f1.state, 'ok');
  assert.equal(seen['Tom'].answers, null);
  assert.equal(seen['Tom'].results, null);
  assert.ok(!('token_hash' in seen['Léa']) && !('tokenHash' in seen['Léa']), 'pas de jeton');
});

test('ANO-06 : un autre enseignant, ou personne, ne voit aucune réponse, ne supprime rien, n’importe rien', async (t) => {
  const { base, browser, other } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  for (const [who, expected] of [
    [other, 404],
    [client(base), 401]
  ]) {
    assert.equal((await who.get(`/api/launches/${launch.id}/sheets`)).status, expected);
    assert.equal((await who.delete(`/api/launches/${launch.id}`)).status, expected);
    assert.equal((await who.post(`/api/launches/${launch.id}/answers-file`, answersFile(me))).status, expected);
  }
  const { participants } = (await browser.get(`/api/launches/${launch.id}`)).json();
  assert.equal(participants[0].submittedAt, null);
});

/* --- HOR-09, HIS-06, HIS-07 : le fichier de réponses --- */

test('HIS-06 : le fichier d’un élève se lit, y compris après la fin, et il est signalé comme tel', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  const imported = await browser.post(`/api/launches/${launch.id}/answers-file`, answersFile(me));
  assert.equal(imported.status, 200);
  assert.deepEqual(imported.json(), { names: 'Léa', alreadyReceived: false });
  assert.equal(row(db, me.id).by_file, 1);
  assert.equal(JSON.parse(row(db, me.id).results).maps.m1.fiches.f1.state, 'ok', 'calculé par le serveur');
  const seen = (await browser.get(`/api/launches/${launch.id}`)).json().participants[0];
  assert.equal(seen.byFile, true);
  assert.equal(seen.late, true);
  assert.equal(seen.finishedAfterEnd, false, 'il avait fini avant de le remettre');
});

test('HIS-06 : un fichier garde l’heure où l’élève a fini, pas celle où il est remis, et jamais une heure à venir', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  const other = await join(base, launch.code, 'Tom');
  await browser.post(`/api/launches/${launch.id}/end`);
  db.prepare('UPDATE launches SET ended_at = ?').run(new Date(Date.now() - 10 * 60000).toISOString());
  const target = `/api/launches/${launch.id}/answers-file`;

  const finishedAt = Date.now() - 20 * 60000;
  await browser.post(target, { ...answersFile(me), finishedAt });
  assert.equal(Date.parse(row(db, me.id).finished_at), finishedAt);
  const seen = (await browser.get(`/api/launches/${launch.id}`)).json().participants.find(({ names }) => names === 'Léa');
  assert.equal(seen.finishedAfterEnd, false, 'il avait fini avant la fin, et l’a remis bien après');

  await browser.post(target, { ...answersFile(other), finishedAt: Date.now() + 60 * 60000 });
  assert.ok(Date.parse(row(db, other.id).finished_at) <= Date.now());
});

test('HIS-06 : un fichier fini après la fin du cours se voit, et ses réponses après la fin sont comptées', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  db.prepare('UPDATE launches SET ended_at = ?').run(new Date(Date.now() - 10 * 60000).toISOString());
  await browser.post(`/api/launches/${launch.id}/answers-file`, answersFile(me, { m1: { f1: entry(40, 60, { at: Date.now() - 1000 }) } }));
  const seen = (await browser.get(`/api/launches/${launch.id}`)).json().participants[0];
  assert.equal(seen.finishedAfterEnd, true);
  assert.equal(seen.answersAfterEnd, 1);
});

test('HIS-06 : un fichier d’un autre lancement, ou qui n’en est pas un, est refusé', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const other = await launched(browser);
  const stranger = await join(base, other.code);
  const me = await join(base, launch.code);
  const target = `/api/launches/${launch.id}/answers-file`;
  const foreign = await browser.post(target, answersFile(stranger));
  assert.equal(foreign.status, 400);
  assert.match(foreign.text, /autre lancement/);
  assert.equal((await browser.post(target, { format: 'autre chose', participantId: me.id, answers: {} })).status, 400);
  assert.equal((await browser.post(target, { ...answersFile(me), answers: { m1: { inconnue: entry(1, 1) } } })).status, 400);
  assert.equal(row(db, me.id).submitted_at, null);
  assert.equal(row(db, stranger.id).submitted_at, null);
});

test('HIS-07 : par le réseau puis par fichier, ou l’inverse : la première version reçue reste', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const byNetwork = await join(base, launch.code, 'Réseau');
  await send(base, byNetwork.token, { m1: { f1: entry(40, 60) } });
  const again = await browser.post(`/api/launches/${launch.id}/answers-file`, answersFile(byNetwork, { m1: { f1: entry(90, 90) } }));
  assert.equal(again.json().alreadyReceived, true);
  assert.equal(JSON.parse(row(db, byNetwork.id).answers).m1.f1.x, 40);
  assert.equal(row(db, byNetwork.id).by_file, 0);

  const byFile = await join(base, launch.code, 'Fichier');
  await browser.post(`/api/launches/${launch.id}/answers-file`, answersFile(byFile));
  await send(base, byFile.token, { m1: { f1: entry(90, 90) } });
  assert.equal(JSON.parse(row(db, byFile.id).answers).m1.f1.x, 40);
  assert.equal(row(db, byFile.id).by_file, 1);
});

/* --- HIS-05 : supprimer --- */

test('HIS-05 : un lancement terminé se supprime, avec ses élèves ; un cours en marche, non', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  await join(base, launch.code);
  const running = await browser.delete(`/api/launches/${launch.id}`);
  assert.equal(running.status, 409);
  assert.match(running.text, /Terminez/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 1);

  await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal((await browser.delete(`/api/launches/${launch.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM launches').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
  assert.equal((await browser.get(`/api/launches/${launch.id}`)).status, 404);
});

test('HIS-05 : gardé un an après la fin, puis effacé', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  const clock = { now: Date.now() };
  const launches = createLaunches(db, { now: () => clock.now });

  clock.now += KEEP_LAUNCH_MS - 60000;
  launches.purge();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM launches').get().n, 1);
  clock.now += 2 * 60000;
  launches.purge();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM launches').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
  assert.equal(KEEP_LAUNCH_MS, 365 * 24 * 60 * 60 * 1000);
});

test('HIS-05 : un cours jamais terminé compte depuis sa dernière activité, et un élève récent le garde', async (t) => {
  const { base, db, browser } = await site(t);
  const idle = await launched(browser);
  const active = await launched(browser);
  const old = new Date(Date.now() - KEEP_LAUNCH_MS - 60000).toISOString();
  db.prepare('UPDATE launches SET opened_at = ?').run(old);
  await join(base, active.code);
  createLaunches(db).purge();
  const left = db
    .prepare('SELECT id FROM launches')
    .all()
    .map(({ id }) => id);
  assert.deepEqual(left, [active.id], `${idle.id} n’a vu personne depuis un an`);
});

test('HIS-05 : le nettoyage de chaque heure passe aussi par les lancements', async (t) => {
  const { app, base, db, browser } = await site(t);
  const launch = await launched(browser);
  await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  db.prepare('UPDATE launches SET ended_at = ?').run(new Date(Date.now() - KEEP_LAUNCH_MS - 60000).toISOString());
  app.purge();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM launches').get().n, 0);
});
