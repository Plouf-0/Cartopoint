/**
 * Fin du cours, côté serveur : la correction (CRG-02, CRG-03, CRG-06, CRG-09), le gel (CRG-11) et l'heure des réponses (CRG-13). Les écrans sont
 * vérifiés dans tests/e2e/correction.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_END_GRACE, onServerClock, countAfterEnd } from '../server/answers.mjs';
import { addAccount, cheapHash, client, request, startApp } from './helpers.js';

const PASSWORD = 'mot-de-passe-1';
const TEACHER = 'prof@example.org';
const REF = { x: 40, y: 60 };
const HOUR = 60 * 60 * 1000;

const fiche = (id, common, extra = {}) => ({ id, common, visible: true, refX: REF.x, refY: REF.y, media: [], ...extra });
const content = {
  format: 'inventaire-botanique',
  version: 3,
  title: 'Sortie',
  theme: {},
  maps: [
    {
      id: 'm1',
      name: 'Parc',
      image: '',
      widthMeters: 100,
      fiches: [
        fiche('f1', 'Noisetier'),
        fiche('f2', 'Sureau'),
        fiche('sans', 'Sans position', { refX: null, refY: null }),
        fiche('cachee', 'Masquée', { visible: false, refX: 3, refY: 3 })
      ]
    },
    { id: 'm2', name: 'Bois', image: '', fiches: [fiche('f3', 'Tilleul')] }
  ]
};
const entry = (x, y, extra = {}) => ({ x, y, temperature: '', humidity: '', light: '', ...extra });
const GOOD = { answers: { m1: { f1: entry(REF.x, REF.y) } } };

async function site(t) {
  const started = await startApp(t);
  const { db } = started.app;
  addAccount(db, { email: TEACHER, hash: cheapHash(PASSWORD) });
  const browser = client(started.base);
  assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 200);
  return { ...started, db, browser };
}

async function launched(browser, draft = content) {
  const course = (await browser.post('/api/courses', { draft })).json();
  await browser.post(`/api/courses/${course.id}/publish`, { revision: course.revision });
  return (await browser.post(`/api/courses/${course.id}/launches`)).json();
}

const join = async (base, code, names = 'Léa') => (await client(base).post(`/api/join/${code}`, { names })).json();
const asStudent = (token) => ({ Authorization: `Bearer ${token}` });
const send = (base, token, body) =>
  request(base, '/api/student/answers', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...asStudent(token) }, body: JSON.stringify(body) });
const correction = (base, token) => request(base, '/api/student/correction', { headers: token ? asStudent(token) : {} });
const body = (response) => JSON.parse(response.body.toString());
const row = (db, id) => db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
const seenBy = async (browser, launch, names = 'Léa') => (await browser.get(`/api/launches/${launch.id}`)).json().participants.find((p) => p.names === names);

/* --- CRG-02, CRG-03, CRG-06, CRG-09 : la correction --- */

test('CRG-02 : pas de correction avant la fin du cours, même une fois rendu ; le serveur le vérifie', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await send(base, me.token, GOOD);
  const refused = await correction(base, me.token);
  assert.equal(refused.status, 403);
  assert.doesNotMatch(refused.body.toString(), /40|refX/);
});

test('CRG-03 : sans jeton ou avec un jeton inconnu, rien', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser);
  await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal((await correction(base)).status, 401);
  assert.equal((await correction(base, 'inconnu')).status, 401);
});

test('CRG-03 : le jeton d’un autre lancement ne donne pas accès : celui-là n’est pas fini', async (t) => {
  const { base, browser } = await site(t);
  const finished = await launched(browser);
  const running = await launched(browser);
  const other = await join(base, running.code);
  await send(base, other.token, GOOD);
  await browser.post(`/api/launches/${finished.id}/end`);
  assert.equal((await correction(base, other.token)).status, 403);
});

test('CRG-07 : sans réponses reçues, pas de correction : il doit d’abord rendre', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal((await correction(base, me.token)).status, 409);
});

test('CRG-06, CRG-09 : la correction donne les positions réelles, le résultat et l’écart du serveur, et rien sur les fiches masquées', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await send(base, me.token, { answers: { m1: { f1: entry(REF.x, REF.y), f2: entry(REF.x + 50, REF.y) } } });
  await browser.post(`/api/launches/${launch.id}/end`);

  const response = await correction(base, me.token);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const { maps, score, openedAt } = body(response);
  assert.ok(Date.parse(openedAt), 'le jour du cours, pour le compte rendu');
  assert.deepEqual(score, { ok: 1, near: 0, far: 1, unplaced: 1, noref: 1 });
  assert.deepEqual(maps.m1.fiches.f1, { state: 'ok', d: 0, dist: '0,0 m', refX: REF.x, refY: REF.y });
  assert.equal(maps.m1.fiches.f2.state, 'far');
  assert.equal(maps.m1.fiches.f2.dist, '50 m');
  assert.equal(maps.m2.fiches.f3.state, 'unplaced');
  assert.equal(maps.m2.fiches.f3.refX, REF.x, 'la position réelle d’une fiche non placée aussi');
  assert.deepEqual(maps.m1.fiches.sans, { state: 'noref' });
  assert.equal(maps.m1.fiches.cachee, undefined);
  assert.doesNotMatch(response.body.toString(), /Masquée|cachee/);
});

test('CRG-06 : chaque élève reçoit sa propre correction', async (t) => {
  const { base, browser } = await site(t);
  const launch = await launched(browser);
  const lea = await join(base, launch.code, 'Léa');
  const tom = await join(base, launch.code, 'Tom');
  await send(base, lea.token, { answers: { m1: { f1: entry(REF.x, REF.y) } } });
  await send(base, tom.token, { answers: { m1: { f1: entry(REF.x + 50, REF.y) } } });
  await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal(body(await correction(base, lea.token)).maps.m1.fiches.f1.state, 'ok');
  assert.equal(body(await correction(base, tom.token)).maps.m1.fiches.f1.state, 'far');
});

/* --- CRG-11 : figé par la fin du cours --- */

test('CRG-11 : un travail figé par la fin du cours est signalé comme tel, et non comme tardif', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  await send(base, me.token, { ...GOOD, autoClosed: true });
  assert.equal(row(db, me.id).auto_closed, 1);
  assert.equal(row(db, me.id).late, 0);
  const seen = await seenBy(browser, launch);
  assert.equal(seen.autoClosed, true);
  assert.equal(seen.late, false);
});

test('CRG-11 : se dire figé avant la fin du cours ne compte pas', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await send(base, me.token, { ...GOOD, autoClosed: true });
  assert.equal(row(db, me.id).auto_closed, 0);
  assert.equal(row(db, me.id).late, 0);
});

test('CRG-11 : seul le vrai oui compte', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  await send(base, me.token, { ...GOOD, autoClosed: 'oui' });
  assert.equal(row(db, me.id).auto_closed, 0);
  assert.equal(row(db, me.id).late, 1);
});

/* --- CRG-13 : l'heure des réponses --- */

test('CRG-13 : une horloge fausse est corrigée : l’heure gardée est celle du serveur', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  // Un téléphone en retard d'une heure, une réponse 10 minutes avant l'envoi
  const phone = Date.now() - HOUR;
  await send(base, me.token, { answers: { m1: { f1: entry(REF.x, REF.y, { at: phone - 10 * 60000 }) } } });
  const without = JSON.parse(row(db, me.id).answers).m1.f1.at;
  assert.equal(without, phone - 10 * 60000, 'sans son heure à l’envoi, l’écart est inconnu');

  const other = await join(base, launch.code, 'Tom');
  const sentAt = Date.now() - HOUR;
  await send(base, other.token, { answers: { m1: { f1: entry(REF.x, REF.y, { at: sentAt - 10 * 60000 }) } }, sentAt, finishedAt: sentAt - 60000 });
  const stored = JSON.parse(row(db, other.id).answers).m1.f1.at;
  assert.ok(Math.abs(stored - (Date.now() - 10 * 60000)) < 5000, `${(Date.now() - stored) / 60000} minutes avant`);
  assert.ok(Math.abs(Date.parse(row(db, other.id).finished_at) - (Date.now() - 60000)) < 5000);
});

test('CRG-13 : une heure dans le futur, ou qui n’en est pas une, ne fausse rien', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  const now = Date.now();
  await send(base, me.token, {
    answers: { m1: { f1: entry(REF.x, REF.y, { at: now + 10 * HOUR }), f2: entry(REF.x, REF.y, { at: 'hier' }) } },
    sentAt: now,
    finishedAt: now + 10 * HOUR
  });
  const { m1 } = JSON.parse(row(db, me.id).answers);
  assert.ok(m1.f1.at <= Date.now());
  assert.equal(m1.f2.at, undefined);
  assert.ok(Date.parse(row(db, me.id).finished_at) <= Date.now());
});

test('CRG-13 : l’enseignant voit combien de réponses ont été faites après la fin, et elles comptent dans le score (Q-19)', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const me = await join(base, launch.code);
  await browser.post(`/api/launches/${launch.id}/end`);
  const ended = Date.parse(db.prepare('SELECT ended_at FROM launches WHERE id = ?').get(launch.id).ended_at);
  db.prepare('UPDATE launches SET ended_at = ? WHERE id = ?').run(new Date(ended - 10 * 60000).toISOString(), launch.id);
  const sentAt = Date.now();
  await send(base, me.token, {
    answers: {
      m1: { f1: entry(REF.x, REF.y, { at: sentAt - 1000 }), f2: entry(REF.x, REF.y, { at: sentAt - 2000 }), sans: entry(1, 1, { at: ended - 60 * 60000 }) }
    },
    sentAt,
    finishedAt: sentAt,
    autoClosed: true
  });
  const seen = await seenBy(browser, launch);
  assert.equal(seen.answersAfterEnd, 2);
  assert.equal(seen.autoClosed, true);
  assert.equal(body(await correction(base, me.token)).score.ok, 2, 'Q-19 : elles comptent');
});

test('CRG-13 : un rendu fini avant la fin et reçu après n’est pas compté comme fini après', async (t) => {
  const { base, db, browser } = await site(t);
  const launch = await launched(browser);
  const before = await join(base, launch.code, 'Avant');
  const after = await join(base, launch.code, 'Après');
  await browser.post(`/api/launches/${launch.id}/end`);
  const sentAt = Date.now();
  const ended = sentAt - 10 * 60000;
  db.prepare('UPDATE launches SET ended_at = ? WHERE id = ?').run(new Date(ended).toISOString(), launch.id);
  await send(base, before.token, { ...GOOD, sentAt, finishedAt: ended - 60000 });
  await send(base, after.token, { ...GOOD, sentAt, finishedAt: sentAt - 1000 });
  const list = (await browser.get(`/api/launches/${launch.id}`)).json().participants;
  const seen = Object.fromEntries(list.map((p) => [p.names, p]));
  assert.equal(seen['Avant'].late, true);
  assert.equal(seen['Avant'].finishedAfterEnd, false);
  assert.equal(seen['Après'].late, true);
  assert.equal(seen['Après'].finishedAfterEnd, true);
});

test('CRG-13 : la page n’apprend la fin qu’au contrôle suivant : ce qui tombe dans ce délai ne compte pas', () => {
  const ended = 1000000;
  const answers = (at) => ({ m1: { f1: { x: 1, y: 1, at } } });
  assert.equal(countAfterEnd(answers(ended - 1), ended), 0);
  assert.equal(countAfterEnd(answers(ended + AFTER_END_GRACE), ended), 0);
  assert.equal(countAfterEnd(answers(ended + AFTER_END_GRACE + 1), ended), 1);
  assert.equal(countAfterEnd({ m1: { f1: { x: 1, y: 1 } } }, ended), 0, 'une réponse sans heure n’est pas comptée');
  assert.ok(AFTER_END_GRACE > 20000, 'plus que l’intervalle de contrôle de la page');
});

test('CRG-13 : corriger l’heure ne change rien d’autre, et laisse une réponse sans heure telle quelle', () => {
  const input = { m1: { f1: { x: 1, y: 2, temperature: '21', at: 1000 }, f2: { x: 3, y: 4 } } };
  const { answers, offset } = onServerClock(input, 500, 900);
  assert.equal(offset, 400);
  assert.deepEqual(answers.m1.f1, { x: 1, y: 2, temperature: '21', at: 900 }, 'jamais après maintenant');
  assert.deepEqual(answers.m1.f2, { x: 3, y: 4 });
  assert.equal(onServerClock(input, 'hier', 900).offset, 0);
});
