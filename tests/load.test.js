/**
 * QUA-09 : une classe entière sur un même cours. Le script scripts/charge.mjs donne les chiffres ; ici, on vérifie que personne n'est refusé
 * et que rien ne se perd ni ne se mélange quand tout arrive en même temps, à une taille de cours qui garde ce test rapide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { simulateClass } from '../scripts/charge.mjs';
import { addAccount, cheapHash, client, startApp } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
// Pas de chiffre serré : le but est de voir une vraie panne, pas de juger la machine qui lance le test
const SLOWEST_ACCEPTED_MS = 15000;

async function site(t) {
  const started = await startApp(t, { root: path.resolve('src') });
  const { db } = started.app;
  addAccount(db, { email: TEACHER.email, hash: cheapHash(TEACHER.password) });
  return { ...started, db };
}

for (const students of [30, 50]) {
  test(`QUA-09 : ${students} élèves au même instant : personne n’est refusé, et chacun garde ses réponses`, async (t) => {
    const { base, db } = await site(t);
    const outcome = await simulateClass({ base, teacher: TEACHER, students, photos: 6, photoBytes: 20e3, planBytes: 100e3, pollRounds: 1, pollEveryMs: 0 });

    assert.deepEqual(outcome.failures, []);
    assert.equal(outcome.lost, 0);
    assert.equal(outcome.participants.length, students);
    assert.equal(outcome.participants.filter((participant) => participant.submittedAt).length, students);
    assert.equal(outcome.participants.filter((participant) => participant.late).length, 0, 'tous ont rendu avant la fin');
    for (const route of outcome.routes) assert.ok(route.max < SLOWEST_ACCEPTED_MS, `${route.route} : ${Math.round(route.max)} ms`);

    const stored = db.prepare('SELECT names, answers, results, token_hash FROM participants').all();
    assert.equal(stored.length, students);
    assert.equal(new Set(stored.map((row) => row.token_hash)).size, students, 'un jeton par élève');
    for (const row of stored) {
      const index = Number(row.names.replace('Élève ', ''));
      const entries = JSON.parse(row.answers).m1;
      assert.equal(Object.keys(entries).length, 6);
      assert.equal(entries.f0.x, 1 + (index % 98), `${row.names} : ce sont bien ses placements`);
      assert.equal(entries.f5.temperature, String(index), `${row.names} : ce sont bien ses mesures`);
      assert.equal(
        JSON.parse(row.results).score.far + JSON.parse(row.results).score.near + JSON.parse(row.results).score.ok,
        6,
        `${row.names} : corrigé par le serveur`
      );
    }
  });
}

test('QUA-09 : une classe de 50, derrière une seule adresse, où chacun se trompe de code plusieurs fois, entre quand même', async (t) => {
  const { base } = await site(t);
  const teacher = client(base);
  await teacher.post('/api/auth/login', TEACHER);
  const course = (
    await teacher.post('/api/courses', {
      draft: { format: 'inventaire-botanique', version: 3, title: 'Cours', theme: {}, maps: [{ id: 'm1', name: 'Plan', image: '', fiches: [] }] }
    })
  ).json();
  await teacher.post(`/api/courses/${course.id}/publish`, { revision: course.revision });
  const launch = (await teacher.post(`/api/courses/${course.id}/launches`)).json();

  const anyone = client(base);
  for (let i = 0; i < 50 * 3; i++) assert.equal((await anyone.get('/api/join/ZZZZZZ')).status, 404);
  assert.equal((await anyone.get(`/api/join/${launch.code}`)).status, 200);
  assert.equal((await anyone.post(`/api/join/${launch.code}`, { names: 'Léa' })).status, 200);
});
