/**
 * Rendre son travail : vérifier les réponses, les corriger sur le serveur et ne rien laisser repartir (cahier des charges,
 * sections 12.4 à 12.6). Les écrans sont vérifiés dans tests/e2e/launches.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ANSWERS_BYTES, MAX_MEASURE, cleanAnswers, computeResults } from '../server/answers.mjs';
import { createLaunches } from '../server/launches.mjs';
import { evaluate, normalizeProject } from '../src/js/model.js';
import { addAccount, cheapHash, client, request, startApp } from './helpers.js';

const PASSWORD = 'mot-de-passe-1';
const HASH = cheapHash(PASSWORD);
const TEACHER = 'prof@example.org';
const REF_X = 12.3456;
const REF_Y = 65.4321;
const MEASURE_MARK = 'MESURE-MARQUEUR';

const content = (overrides = {}) => ({
  format: 'inventaire-botanique',
  version: 3,
  title: 'Sortie au parc',
  theme: {},
  maps: [
    {
      id: 'm1',
      name: 'Parc',
      image: '',
      ratio: 2,
      widthMeters: 200,
      fiches: [
        { id: 'f1', common: 'Olivier', visible: true, refX: REF_X, refY: REF_Y, media: [] },
        { id: 'f2', common: 'Laurier', visible: true, refX: 50, refY: 50, media: [] },
        { id: 'f3', common: 'Sans position', visible: true, media: [] },
        { id: 'masquee', common: 'Masquée', visible: false, refX: 1, refY: 1, media: [] }
      ]
    },
    { id: 'm2', name: 'Mer', image: '', fiches: [{ id: 'f4', common: 'Tamaris', visible: true, refX: 10, refY: 10, media: [] }] }
  ],
  ...overrides
});
const project = () => normalizeProject(content());
const entry = (x, y, measures = {}) => ({ x, y, temperature: '', humidity: '', light: '', ...measures });

/* --- Vérifier --- */

test('des réponses valables passent, nettoyées : ni champ en trop, ni mesure absente', () => {
  const clean = cleanAnswers(
    { m1: { f1: { x: 10, y: 20.5, temperature: '21', extra: 'rien', refX: 1 }, f2: { x: null, y: null, light: '900' } }, m2: {} },
    project()
  );
  assert.deepEqual(clean, {
    m1: {
      f1: { x: 10, y: 20.5, temperature: '21', humidity: '', light: '' },
      f2: { x: null, y: null, temperature: '', humidity: '', light: '900' }
    },
    m2: {}
  });
  assert.deepEqual(cleanAnswers({}, project()), {}, 'rendre sans rien avoir fait est permis');
  assert.deepEqual(cleanAnswers({ m1: { f1: { x: 0, y: 100 } } }, project()).m1.f1.x, 0, 'les bords du plan sont valables');
});

for (const [name, answers] of Object.entries({
  'pas un objet': 'réponses',
  'un tableau': [],
  'rien du tout': null,
  'une carte inconnue': { inconnue: {} },
  'une carte qui n’est pas un objet': { m1: 'texte' },
  'une fiche inconnue': { m1: { inconnue: entry(1, 1) } },
  'une fiche masquée': { m1: { masquee: entry(1, 1) } },
  'une fiche d’une autre carte': { m2: { f1: entry(1, 1) } },
  'une entrée qui n’est pas un objet': { m1: { f1: 12 } },
  'une entrée qui est un tableau': { m1: { f1: [1, 2] } },
  'x sans y': { m1: { f1: { x: 10, y: null } } },
  'y sans x': { m1: { f1: { x: null, y: 10 } } },
  'x seul, y absent': { m1: { f1: { x: 10 } } },
  'x trop petit': { m1: { f1: entry(-0.1, 10) } },
  'x trop grand': { m1: { f1: entry(100.1, 10) } },
  'y trop grand': { m1: { f1: entry(10, 101) } },
  'une position en texte': { m1: { f1: entry('10', 10) } },
  'un booléen comme position': { m1: { f1: entry(true, 10) } },
  'une mesure trop longue': { m1: { f1: entry(1, 1, { temperature: 'x'.repeat(MAX_MEASURE + 1) }) } },
  'une mesure qui n’est pas du texte': { m1: { f1: entry(1, 1, { humidity: 12 }) } },
  'un nom de carte piégé': JSON.parse('{"__proto__": {}}')
})) {
  test(`réponses refusées : ${name}`, () => {
    assert.throws(() => cleanAnswers(answers, project()), { status: 400 });
  });
}

test('une mesure de 50 caractères passe', () => {
  const clean = cleanAnswers({ m1: { f1: entry(1, 1, { temperature: 'x'.repeat(MAX_MEASURE) }) } }, project());
  assert.equal(clean.m1.f1.temperature.length, 50);
  assert.equal(MAX_MEASURE, 50);
  assert.equal(MAX_ANSWERS_BYTES, 256 * 1024);
});

/* --- Corriger --- */

test('CRG-09 : le résultat est celui de evaluate(), avec le rapport et l’échelle de la carte', () => {
  const answers = { m1: { f1: entry(REF_X + 1, REF_Y) }, m2: { f4: entry(90, 90) } };
  const results = computeResults(project(), answers);
  const fiche = project().maps[0].fiches[0];
  const expected = evaluate(fiche, answers.m1.f1, { ratio: 2, widthMeters: 200 });
  assert.equal(expected.state, 'ok');
  assert.deepEqual(results.maps.m1.fiches.f1, { state: 'ok', d: expected.d, dist: expected.dist });
  assert.equal(results.maps.m1.fiches.f1.dist, '2.0 m', '1 % d’un plan de 200 m');
  assert.deepEqual(results.maps.m2.fiches.f4.state, 'far');
  assert.match(results.maps.m2.fiches.f4.dist, /% du plan/, 'sans échelle, l’écart reste en pourcentage');
});

test('CRG-09 : la hauteur compte selon les proportions du plan, comme à l’écran', () => {
  // 10 % de la hauteur d'un plan deux fois plus large que haut : 5 % de sa largeur
  const answers = { m1: { f2: entry(50, 60) } };
  assert.equal(computeResults(project(), answers).maps.m1.fiches.f2.d, 5);
  const square = normalizeProject(content());
  square.maps[0].ratio = null;
  assert.equal(computeResults(square, answers).maps.m1.fiches.f2.d, 10, 'proportions inconnues : un plan carré');
});

test('le score compte chaque état, par carte et au total, sans les fiches masquées', () => {
  const results = computeResults(project(), {
    m1: { f1: entry(REF_X, REF_Y), f2: entry(50, 60 + 6) },
    m2: { f4: entry(10 + 50, 10) }
  });
  assert.deepEqual(results.maps.m1.score, { ok: 1, near: 1, far: 0, unplaced: 0, noref: 1 });
  assert.deepEqual(results.maps.m2.score, { ok: 0, near: 0, far: 1, unplaced: 0, noref: 0 });
  assert.deepEqual(results.score, { ok: 1, near: 1, far: 1, unplaced: 0, noref: 1 });
  assert.equal(results.maps.m1.fiches.f3.state, 'noref');
  assert.ok(!('masquee' in results.maps.m1.fiches));
});

test('sans réponse, tout est « non placé », sans écart inventé', () => {
  const results = computeResults(project(), {});
  assert.deepEqual(results.maps.m1.fiches.f1, { state: 'unplaced' });
  assert.deepEqual(results.score, { ok: 0, near: 0, far: 0, unplaced: 3, noref: 1 });
});

test('une mesure sans placement ne compte pas comme un placement', () => {
  const results = computeResults(project(), cleanAnswers({ m1: { f1: { x: null, y: null, temperature: '20' } } }, project()));
  assert.equal(results.maps.m1.fiches.f1.state, 'unplaced');
});

/* --- L'API --- */

async function site(t) {
  const started = await startApp(t);
  addAccount(started.app.db, { email: TEACHER, hash: HASH });
  const browser = client(started.base);
  assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 200);
  return { ...started, db: started.app.db, browser };
}

async function launched(browser, draft = content()) {
  const course = (await browser.post('/api/courses', { draft })).json();
  const published = (await browser.post(`/api/courses/${course.id}/publish`, { revision: course.revision })).json();
  return { course: published, launch: (await browser.post(`/api/courses/${course.id}/launches`)).json() };
}

const join = async (base, code, names = 'Léa') => (await client(base).post(`/api/join/${code}`, { names })).json();
const send = (base, token, body, headers = {}) =>
  request(base, '/api/student/answers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
const stateOf = async (base, token) => JSON.parse((await request(base, '/api/student/state', { headers: { Authorization: `Bearer ${token}` } })).body);
const row = (db, id) => db.prepare('SELECT * FROM participants WHERE id = ?').get(id);

const GOOD = { answers: { m1: { f1: entry(REF_X, REF_Y, { temperature: MEASURE_MARK }) } } };

test('HIS-01 : rendre enregistre les réponses et le résultat, et la réponse ne contient ni l’un ni l’autre', async (t) => {
  const { base, db, browser } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  assert.equal((await stateOf(base, me.token)).received, false);

  const r = await send(base, me.token, GOOD);
  assert.equal(r.status, 200, r.body.toString());
  const body = JSON.parse(r.body);
  assert.deepEqual(Object.keys(body).sort(), ['received', 'submittedAt']);
  assert.equal(body.received, true);
  assert.doesNotMatch(r.body.toString(), /refX|refY|state|score|12\.3456|65\.4321|MARQUEUR/);
  assert.match(r.headers['cache-control'], /no-store/);

  const saved = row(db, me.id);
  assert.equal(saved.submitted_at, body.submittedAt);
  assert.equal(saved.late, 0);
  assert.equal(JSON.parse(saved.answers).m1.f1.temperature, MEASURE_MARK);
  const results = JSON.parse(saved.results);
  assert.equal(results.maps.m1.fiches.f1.state, 'ok');
  assert.equal(results.score.ok, 1);
  assert.equal((await stateOf(base, me.token)).received, true);
});

test('CRG-07 : le premier envoi fait foi, le second est ignoré sans erreur', async (t) => {
  const { base, db, browser } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  const first = JSON.parse((await send(base, me.token, GOOD)).body);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const second = await send(base, me.token, { answers: { m1: { f1: entry(90, 90) } } });
  assert.equal(second.status, 200);
  assert.equal(JSON.parse(second.body).submittedAt, first.submittedAt);
  const invalid = await send(base, me.token, { answers: 'peu importe' });
  assert.equal(invalid.status, 200, 'déjà reçu : la page qui renvoie ne doit pas croire à un refus');
  const saved = row(db, me.id);
  assert.equal(JSON.parse(saved.answers).m1.f1.x, REF_X);
  assert.equal(JSON.parse(saved.results).score.ok, 1);
});

test('CRG-07 : deux envois simultanés n’en font qu’un', async (t) => {
  const { base, db, browser } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  const answers = await Promise.all([send(base, me.token, GOOD), send(base, me.token, { answers: { m1: { f1: entry(90, 90) } } })]);
  assert.deepEqual(
    answers.map((r) => r.status),
    [200, 200]
  );
  const dates = new Set(answers.map((r) => JSON.parse(r.body).submittedAt));
  assert.equal(dates.size, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants WHERE submitted_at IS NOT NULL').get().n, 1);
});

test('CRG-07 : la base garde le premier rendu, même si la route laissait passer un second', async (t) => {
  const { base, db, browser, app } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  const launches = createLaunches(app.db);
  const participant = launches.participant(me.token);
  const first = launches.submit(participant, { premier: true }, {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(launches.submit(participant, { second: true }, {}), first);
  assert.deepEqual(JSON.parse(row(db, me.id).answers), { premier: true });
});

test('des réponses refusées ne laissent rien, et l’élève peut encore rendre', async (t) => {
  const { base, db, browser } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  for (const body of [{ answers: { m1: { masquee: entry(1, 1) } } }, {}, { answers: 'x' }, 'pas du json']) {
    const r = await send(base, me.token, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.doesNotMatch(r.body.toString(), /masquee|Masquée/);
  }
  assert.equal(row(db, me.id).submitted_at, null);
  assert.equal((await send(base, me.token, GOOD)).status, 200);
});

test('au-delà de 256 Ko, l’envoi est refusé ; juste en dessous, un cours bien rempli passe', async (t) => {
  const { base, browser } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  const tooBig = await send(base, me.token, JSON.stringify({ answers: {}, remplissage: 'x'.repeat(MAX_ANSWERS_BYTES) }));
  assert.equal(tooBig.status, 413);
  const large = await send(base, me.token, JSON.stringify({ answers: {}, remplissage: 'x'.repeat(MAX_ANSWERS_BYTES - 100) }));
  assert.equal(large.status, 200);
});

test('rendre demande un jeton valable : ni un compte ni le code n’en tiennent lieu', async (t) => {
  const { base, browser } = await site(t);
  const { launch } = await launched(browser);
  assert.equal((await send(base, null, GOOD)).status, 401);
  assert.equal((await send(base, 'jeton-invente', GOOD)).status, 401);
  assert.equal((await send(base, launch.code, GOOD)).status, 401);
  const asTeacher = await request(base, '/api/student/answers', {
    method: 'PUT',
    headers: { Cookie: browser.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(GOOD)
  });
  assert.equal(asTeacher.status, 401);
});

test('deux élèves ne se marchent pas dessus', async (t) => {
  const { base, db, browser } = await site(t);
  const { launch } = await launched(browser);
  const lea = await join(base, launch.code, 'Léa');
  const tom = await join(base, launch.code, 'Tom');
  await send(base, lea.token, GOOD);
  assert.equal(row(db, tom.id).submitted_at, null);
  assert.equal((await stateOf(base, tom.token)).received, false);
  await send(base, tom.token, { answers: {} });
  assert.equal(JSON.parse(row(db, tom.id).results).score.ok, 0);
  assert.equal(JSON.parse(row(db, lea.id).results).score.ok, 1);
});

test('COU-11, CRG-09 : le résultat utilise la version du lancement, pas le cours modifié depuis', async (t) => {
  const { base, db, browser } = await site(t);
  const { course, launch } = await launched(browser);
  const moved = content();
  moved.maps[0].fiches[0].refX = 90;
  const edited = (await browser.raw('PUT', `/api/courses/${course.id}`, { revision: course.revision, draft: moved })).json();
  await browser.post(`/api/courses/${course.id}/publish`, { revision: edited.revision });

  const me = await join(base, launch.code);
  await send(base, me.token, GOOD);
  assert.equal(JSON.parse(row(db, me.id).results).maps.m1.fiches.f1.state, 'ok');
});

test('HOR-07 : un rendu après la fin du cours est accepté et signalé à l’enseignant', async (t) => {
  const { base, db, browser } = await site(t);
  const { launch } = await launched(browser);
  const onTime = await join(base, launch.code, 'À temps');
  const late = await join(base, launch.code, 'En retard');
  await send(base, onTime.token, GOOD);
  await browser.post(`/api/launches/${launch.id}/end`);
  const r = await send(base, late.token, GOOD);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body.toString(), /late|tardif/, 'l’élève n’a pas besoin de ce détail');
  assert.equal(row(db, late.id).late, 1);

  const { participants } = (await browser.get(`/api/launches/${launch.id}`)).json();
  const seen = Object.fromEntries(participants.map((p) => [p.names, p]));
  assert.ok(seen['À temps'].submittedAt);
  assert.equal(seen['À temps'].late, false);
  assert.ok(seen['En retard'].submittedAt);
  assert.equal(seen['En retard'].late, true);
});

test('SUI-05 : l’enseignant voit qui a fini, mais pas encore les réponses ni le résultat', async (t) => {
  const { base, browser } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  await send(base, me.token, GOOD);
  const seen = await browser.get(`/api/launches/${launch.id}`);
  assert.ok(seen.json().participants[0].submittedAt);
  assert.doesNotMatch(seen.text, /MARQUEUR|"results"|"answers"/);
});

test('un élève qui a rendu ne reçoit toujours aucune position, sur aucune route', async (t) => {
  const { base, browser } = await site(t);
  const { launch } = await launched(browser);
  const me = await join(base, launch.code);
  await send(base, me.token, GOOD);
  for (const target of ['/api/student/course', '/api/student/state']) {
    const r = await request(base, target, { headers: { Authorization: `Bearer ${me.token}` } });
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body.toString(), /refX|refY|12\.3456|65\.4321|"results"|"score"/);
  }
});

test('ANO-08 : les réponses d’un élève n’apparaissent jamais dans les journaux, même si le serveur plante', async (t) => {
  const written = [];
  const note = (...args) => written.push(args.map(String).join(' '));
  const { base, db, browser } = await site(t);
  for (const method of ['log', 'error', 'warn', 'info']) t.mock.method(console, method, note);
  const { launch } = await launched(browser);
  const lea = await join(base, launch.code);
  const tom = await join(base, launch.code, 'Tom');
  await send(base, lea.token, GOOD);
  await send(base, tom.token, { answers: { m1: { masquee: entry(1, 1, { temperature: MEASURE_MARK }) } } });

  db.exec('CREATE TRIGGER panne BEFORE UPDATE ON participants BEGIN SELECT RAISE(ABORT, "panne"); END');
  assert.equal((await send(base, tom.token, GOOD)).status, 500);
  assert.ok(written.length > 0, 'la panne est bien journalisée');
  assert.doesNotMatch(written.join('\n'), /MARQUEUR/);
});
