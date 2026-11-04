/**
 * Lancer un cours et le rejoindre, au niveau de l'API (cahier des charges, sections 12.2 à 12.4). Les écrans sont vérifiés
 * dans tests/e2e/launches.test.js.
 */
import { MAX_CODE_FAILURES } from '../server/routes/student.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLaunches, MAX_NAMES, MAX_PARTICIPANTS, newCode, normalizeCode, normalizeNames } from '../server/launches.mjs';
import { addAccount, cheapHash, client, request, startApp } from './helpers.js';

const PASSWORD = 'mot-de-passe-1';
const HASH = cheapHash(PASSWORD);
const ADMIN = 'admin@example.org';
const TEACHER = 'prof@example.org';
const OTHER = 'autre@example.org';
const NAMES = 'Prénom-Marqueur NOM-MARQUEUR';
const REF_X = 12.3456;
const REF_Y = 65.4321;

const draftWith = (common = 'Olivier') => ({
  format: 'inventaire-botanique',
  version: 3,
  title: 'Sortie au parc',
  theme: {},
  passwordHash: 'sha256:SECRET',
  aiEndpoint: 'https://SECRET.example.org',
  maps: [
    {
      id: 'm1',
      name: 'Plan',
      image: '',
      fiches: [
        { id: 'f1', common, visible: true, refX: REF_X, refY: REF_Y, media: [] },
        { id: 'SECRET', common: 'SECRET masquée', visible: false, media: [] }
      ]
    }
  ]
});

async function site(t, options) {
  const started = await startApp(t, options);
  const { db } = started.app;
  const ids = {
    admin: addAccount(db, { email: ADMIN, role: 'admin', hash: HASH }),
    teacher: addAccount(db, { email: TEACHER, hash: HASH }),
    other: addAccount(db, { email: OTHER, hash: HASH })
  };
  return { ...started, db, ids };
}

async function loggedIn(base, email = TEACHER) {
  const browser = client(base);
  assert.equal((await browser.post('/api/auth/login', { email, password: PASSWORD })).status, 200);
  return browser;
}

async function publishedCourse(browser, draft = draftWith()) {
  const course = (await browser.post('/api/courses', { draft })).json();
  const published = await browser.post(`/api/courses/${course.id}/publish`, { revision: course.revision });
  assert.equal(published.status, 200, published.text);
  return published.json();
}

async function launched(browser, draft) {
  const course = await publishedCourse(browser, draft);
  const launch = await browser.post(`/api/courses/${course.id}/launches`);
  assert.equal(launch.status, 200, launch.text);
  return { course, launch: launch.json() };
}

const student = (base) => client(base);
async function join(base, code, names = NAMES) {
  const r = await student(base).post(`/api/join/${code}`, { names });
  assert.equal(r.status, 200, r.text);
  return r.json();
}
const asStudent = (token) => ({ Authorization: `Bearer ${token}` });
const studentGet = (base, target, token) => request(base, target, { headers: token ? asStudent(token) : {} });

/* --- COU-03, COU-06, COU-07, COU-11 : lancer --- */

test('COU-01 : un cours jamais publié ne se lance pas', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const course = (await browser.post('/api/courses', { draft: draftWith() })).json();
  const r = await browser.post(`/api/courses/${course.id}/launches`);
  assert.equal(r.status, 409);
  assert.match(r.text, /Publiez/);
  assert.deepEqual((await browser.get(`/api/courses/${course.id}/launches`)).json(), []);
});

test('COU-03, COU-06 : chaque lancement a son propre code, et le cours peut être relancé', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const { course, launch } = await launched(browser);
  assert.match(launch.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(launch.versionNumber, 1);
  assert.equal(launch.endedAt, null);
  assert.equal(launch.participantCount, 0);
  const again = (await browser.post(`/api/courses/${course.id}/launches`)).json();
  assert.notEqual(again.code, launch.code);
  assert.notEqual(again.id, launch.id);
  const list = (await browser.get(`/api/courses/${course.id}/launches`)).json();
  assert.deepEqual(list.map((item) => item.id).sort(), [launch.id, again.id].sort());
});

test('un code sans O, 0, I ni 1, tiré au hasard', () => {
  const codes = new Set(Array.from({ length: 300 }, newCode));
  assert.ok(codes.size > 295);
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  const letters = new Set([...codes].join(''));
  assert.equal(letters.size, 32, 'tout l’alphabet sert');
});

test('un code déjà pris est retiré, et l’échec est signalé s’il revient sans cesse', async (t) => {
  const { app, base } = await site(t);
  const browser = await loggedIn(base);
  const { course, launch } = await launched(browser);
  const row = app.db.prepare('SELECT * FROM courses WHERE id = ?').get(course.id);

  const taken = [launch.code, launch.code, 'NOUVEA'];
  const retried = createLaunches(app.db, { makeCode: () => taken.shift() }).open(row);
  assert.equal(retried.code, 'NOUVEA');
  assert.equal(taken.length, 0);

  let tries = 0;
  const always = createLaunches(app.db, {
    makeCode: () => {
      tries++;
      return launch.code;
    }
  });
  assert.throws(() => always.open(row), /UNIQUE/);
  assert.equal(tries, 5, 'le nombre d’essais reste limité');
});

test('COU-11 : un lancement garde la version publiée à son ouverture', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const { course, launch } = await launched(browser, draftWith('Version un'));
  const { token } = await join(base, launch.code);

  // Le brouillon, puis une nouvelle publication, ne changent rien à ce lancement
  const edited = await browser.raw('PUT', `/api/courses/${course.id}`, { revision: course.revision, draft: draftWith('Version deux') });
  await browser.post(`/api/courses/${course.id}/publish`, { revision: edited.json().revision });
  const seen = JSON.parse((await studentGet(base, '/api/student/course', token)).body);
  assert.equal(seen.maps[0].fiches[0].common, 'Version un');

  const next = (await browser.post(`/api/courses/${course.id}/launches`)).json();
  assert.equal(next.versionNumber, 2);
  const { token: nextToken } = await join(base, next.code);
  assert.equal(JSON.parse((await studentGet(base, '/api/student/course', nextToken)).body).maps[0].fiches[0].common, 'Version deux');
});

test('COU-11 : le lancement part de la version publiée, pas du brouillon en cours', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const course = await publishedCourse(browser, draftWith('Publiée'));
  await browser.raw('PUT', `/api/courses/${course.id}`, { revision: course.revision, draft: draftWith('Brouillon') });
  const launch = (await browser.post(`/api/courses/${course.id}/launches`)).json();
  const { token } = await join(base, launch.code);
  assert.equal(JSON.parse((await studentGet(base, '/api/student/course', token)).body).maps[0].fiches[0].common, 'Publiée');
});

test('la liste des cours signale un lancement en cours', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const { course, launch } = await launched(browser);
  const row = () => browser.get('/api/courses').then((r) => r.json().find((item) => item.id === course.id));
  assert.equal((await row()).runningLaunch, launch.id);
  await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal((await row()).runningLaunch, null);
});

/* --- ENS-03, ANO-06, ADM-07 : chacun chez soi --- */

test('ANO-06 : un autre enseignant et l’admin ne voient ni le lancement ni les noms des élèves', async (t) => {
  const { base } = await site(t);
  const owner = await loggedIn(base);
  const { course, launch } = await launched(owner);
  await join(base, launch.code);

  for (const email of [OTHER, ADMIN]) {
    const intruder = await loggedIn(base, email);
    for (const [method, target] of [
      ['GET', `/api/launches/${launch.id}`],
      ['POST', `/api/launches/${launch.id}/end`],
      ['GET', `/api/courses/${course.id}/launches`],
      ['POST', `/api/courses/${course.id}/launches`]
    ]) {
      const r = await intruder.raw(method, target, method === 'POST' ? {} : undefined);
      assert.equal(r.status, 404, `${email} ${method} ${target}`);
      assert.doesNotMatch(r.text, /MARQUEUR/);
    }
  }
  assert.equal((await owner.get(`/api/launches/${launch.id}`)).json().endedAt, null, 'personne d’autre ne l’a terminé');
});

test('ces routes demandent une session, et leurs écritures la même origine', async (t) => {
  const { base } = await site(t);
  const owner = await loggedIn(base);
  const { course, launch } = await launched(owner);
  const anonymous = client(base);
  assert.equal((await anonymous.get(`/api/launches/${launch.id}`)).status, 401);
  assert.equal((await anonymous.get(`/api/courses/${course.id}/launches`)).status, 401);
  for (const target of [`/api/launches/${launch.id}/end`, `/api/courses/${course.id}/launches`]) {
    assert.equal((await owner.post(target, {}, { Origin: 'https://ailleurs.example.org' })).status, 403, target);
  }
  assert.equal((await owner.get(`/api/launches/${launch.id}`)).json().endedAt, null);
});

/* --- ANO-04, COU-05 : rejoindre --- */

test('COU-05 : un élève entre avec le code et ses noms, sans compte', async (t) => {
  const { base, db } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const peek = await student(base).get(`/api/join/${launch.code}`);
  assert.equal(peek.status, 200);
  assert.deepEqual(peek.json(), { title: 'Sortie au parc' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0, 'regarder un code ne crée personne');

  const joined = await join(base, launch.code);
  assert.equal(joined.names, NAMES);
  assert.ok(joined.token.length >= 40);
  const row = db.prepare('SELECT * FROM participants').get();
  assert.equal(row.names, NAMES);
  assert.notEqual(row.token_hash, joined.token, 'seule l’empreinte du jeton est gardée');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 3, 'aucun compte créé');
});

test('COU-05 : un code tapé en minuscules ou avec des espaces est reconnu', async (t) => {
  const { base } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const typed = `${launch.code.slice(0, 3).toLowerCase()} ${launch.code.slice(3)}`;
  assert.equal((await student(base).get(`/api/join/${encodeURIComponent(typed)}`)).status, 200);
  assert.equal(normalizeCode(' ab-c d2 '), 'ABCD2');
  assert.equal(normalizeCode(undefined), '');
});

test('ANO-04 : les noms sont obligatoires, sur une seule ligne, 120 caractères au plus', async (t) => {
  const { base, db } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  for (const names of [undefined, '', '   ', 12, null, ['Léa'], 'x'.repeat(MAX_NAMES + 1)]) {
    const r = await student(base).post(`/api/join/${launch.code}`, { names });
    assert.equal(r.status, 400, JSON.stringify(names));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
  assert.equal((await join(base, launch.code, 'x'.repeat(MAX_NAMES))).names.length, MAX_NAMES);
  assert.equal(normalizeNames('  Léa\n\tDupont\u0000 et  Tom '), 'Léa Dupont et Tom');
});

test('rejoindre demande la même origine', async (t) => {
  const { base } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const r = await student(base).post(`/api/join/${launch.code}`, { names: NAMES }, { Origin: 'https://ailleurs.example.org' });
  assert.equal(r.status, 403);
});

test('COU-08 : un cours terminé pendant que les noms sont en route refuse l’élève', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const { launch } = await launched(browser);
  const { hostname, port } = new URL(base);
  const answer = new Promise((resolve, reject) => {
    const req = http.request(
      { hostname, port, path: `/api/join/${launch.code}`, method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    // Le début de la requête arrive, le serveur attend la suite, et le cours se termine entre-temps
    req.write('{"names":', async () => {
      await new Promise((done) => setTimeout(done, 50));
      await browser.post(`/api/launches/${launch.id}/end`);
      req.end(`"${NAMES}"}`);
    });
  });
  assert.equal(await answer, 410);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
});

test('un code inconnu est refusé, et les échecs répétés sont limités sans gêner la classe', async (t) => {
  const { base } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const anyone = student(base);
  assert.equal((await anyone.get('/api/join/ZZZZZZ')).status, 404);
  assert.equal((await anyone.post('/api/join/ZZZZZZ', { names: NAMES })).status, 404);

  // Une classe entière derrière la même adresse : les entrées réussies ne comptent pas
  for (let i = 0; i < 40; i++) assert.equal((await anyone.post(`/api/join/${launch.code}`, { names: `Élève ${i}` })).status, 200);

  let status;
  for (let i = 0; i < MAX_CODE_FAILURES; i++) status = (await anyone.get('/api/join/ZZZZZZ')).status;
  assert.equal(status, 429);
  const blocked = await anyone.get(`/api/join/${launch.code}`);
  assert.equal(blocked.status, 429, 'bloqué : même un bon code doit attendre');
  assert.match(blocked.text, /Réessayez/);
});

test('derrière le proxy, chaque adresse a sa propre limite', async (t) => {
  const { base } = await site(t, { trustProxy: true });
  const from = (ip) => ({ 'X-Forwarded-For': ip });
  const anyone = student(base);
  for (let i = 0; i < MAX_CODE_FAILURES; i++) await anyone.get('/api/join/ZZZZZZ', from('203.0.113.1'));
  assert.equal((await anyone.get('/api/join/ZZZZZZ', from('203.0.113.1'))).status, 429);
  assert.equal((await anyone.get('/api/join/ZZZZZZ', from('203.0.113.2'))).status, 404);
});

test('un lancement accepte 200 élèves, pas un de plus', async (t) => {
  const { base, app } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const insert = app.db.prepare('INSERT INTO participants (id, launch_id, token_hash, names, joined_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < MAX_PARTICIPANTS - 1; i++) insert.run(`p${i}`, launch.id, `h${i}`, 'Élève', new Date().toISOString());
  assert.equal(MAX_PARTICIPANTS, 200);
  await join(base, launch.code);
  const full = await student(base).post(`/api/join/${launch.code}`, { names: NAMES });
  assert.equal(full.status, 409);
  assert.match(full.text, /complet/);
});

/* --- CRG-01 : aucune réponse ne sort, sur aucune route --- */

test('CRG-01 : aucune réponse dans aucune réponse HTTP faite à un élève', async (t) => {
  const { base, app } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const anyone = student(base);
  const peek = await anyone.get(`/api/join/${launch.code}`);
  const entered = await anyone.post(`/api/join/${launch.code}`, { names: NAMES });
  const { token } = entered.json();
  const answers = [peek.text, entered.text];
  for (const target of ['/api/student/course', '/api/student/state']) {
    const r = await studentGet(base, target, token);
    assert.equal(r.status, 200, target);
    answers.push(r.body.toString());
  }
  for (const text of answers) {
    assert.doesNotMatch(text, /SECRET|refX|refY|passwordHash|aiEndpoint/);
    assert.ok(!text.includes(String(REF_X)) && !text.includes(String(REF_Y)));
  }

  // Copie de contrôle : ce que stocke le serveur contient bien tout cela
  const stored = app.db.prepare('SELECT content FROM course_versions').get().content;
  assert.match(stored, /SECRET/);
  assert.ok(stored.includes(String(REF_X)));
});

test('le cours d’un élève demande un jeton valable, jamais un compte', async (t) => {
  const { base } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  for (const target of ['/api/student/course', '/api/student/state']) {
    assert.equal((await studentGet(base, target)).status, 401);
    assert.equal((await studentGet(base, target, 'jeton-invente')).status, 401);
    assert.equal((await request(base, target, { headers: { Authorization: 'Basic abc' } })).status, 401);
    // Le code ne remplace pas le jeton
    assert.equal((await studentGet(base, target, launch.code)).status, 401);
  }
});

test('le cours se met en cache par élève : l’ETag évite de le renvoyer', async (t) => {
  const { base } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const { token } = await join(base, launch.code);
  const first = await studentGet(base, '/api/student/course', token);
  assert.match(first.headers['cache-control'], /private/);
  assert.ok(first.headers.etag);
  const again = await request(base, '/api/student/course', { headers: { ...asStudent(token), 'If-None-Match': first.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

/* --- COU-08 : terminer --- */

test('COU-08 : terminer coupe le code, mais un élève déjà entré garde son accès', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const { launch } = await launched(browser);
  const { token } = await join(base, launch.code);
  assert.equal(JSON.parse((await studentGet(base, '/api/student/state', token)).body).ended, false);

  const ended = await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal(ended.status, 200);
  const endedAt = ended.json().endedAt;
  assert.ok(endedAt);

  for (const [method, body] of [
    ['GET', undefined],
    ['POST', { names: NAMES }]
  ]) {
    const r = await student(base).raw(method, `/api/join/${launch.code}`, body);
    assert.equal(r.status, 410, method);
    assert.match(r.text, /terminé/);
  }
  assert.equal(JSON.parse((await studentGet(base, '/api/student/state', token)).body).ended, true);
  assert.equal((await studentGet(base, '/api/student/course', token)).status, 200);

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await browser.post(`/api/launches/${launch.id}/end`)).json().endedAt, endedAt, 'terminer deux fois garde la première date');
});

test('un code terminé ne compte pas comme un essai raté', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const { launch } = await launched(browser);
  await browser.post(`/api/launches/${launch.id}/end`);
  let status;
  for (let i = 0; i < MAX_CODE_FAILURES + 5; i++) status = (await student(base).get(`/api/join/${launch.code}`)).status;
  assert.equal(status, 410);
});

test('COU-08 : un lancement n’expire pas tout seul, même après des mois sans activité', async (t) => {
  const { base, app, db } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  db.prepare('UPDATE launches SET opened_at = ?').run(new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString());
  app.purge();
  assert.equal((await student(base).get(`/api/join/${launch.code}`)).status, 200);
});

/* --- SUI-01, ANO-05, ANO-08 : suivre, et ne rien écrire dans les journaux --- */

test('SUI-01 : des élèves entrés dans la même milliseconde restent dans leur ordre d’arrivée', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const { launch } = await launched(browser);
  const arrivals = ['Élève 1', 'Élève 2', 'Élève 3', 'Élève 4', 'Élève 5', 'Élève 6', 'Élève 7', 'Élève 8'];
  for (const names of arrivals) await join(base, launch.code, names);
  db.prepare('UPDATE participants SET joined_at = ?').run('2026-11-04T10:00:00.000Z');
  const { participants } = (await browser.get(`/api/launches/${launch.id}`)).json();
  assert.deepEqual(
    participants.map((p) => p.names),
    arrivals
  );
});

test('HIS : deux lancements de la même milliseconde : le dernier d’abord', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const course = await publishedCourse(browser);
  const opened = [];
  for (let i = 0; i < 8; i++) {
    const launch = (await browser.post(`/api/courses/${course.id}/launches`)).json();
    opened.unshift(launch.id);
    assert.equal((await browser.post(`/api/launches/${launch.id}/end`)).status, 200);
  }
  db.prepare('UPDATE launches SET opened_at = ?').run('2026-11-04T10:00:00.000Z');
  const list = (await browser.get(`/api/courses/${course.id}/launches`)).json();
  assert.deepEqual(
    list.map((launch) => launch.id),
    opened
  );
});

test('SUI-01, ANO-05 : l’enseignant voit les noms et l’état de ses élèves, avant et après la fin', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base);
  const { launch, course } = await launched(browser);
  assert.deepEqual((await browser.get(`/api/launches/${launch.id}`)).json().participants, []);

  const { id } = await join(base, launch.code);
  await join(base, launch.code, 'Tom');
  const details = (await browser.get(`/api/launches/${launch.id}`)).json();
  assert.equal(details.title, 'Sortie au parc');
  assert.equal(details.courseId, course.id);
  assert.equal(details.code, launch.code);
  assert.equal(details.participantCount, 2);
  assert.deepEqual(
    details.participants.map((p) => p.names),
    [NAMES, 'Tom']
  );
  const first = details.participants.find((p) => p.id === id);
  assert.ok(first.joinedAt);
  assert.equal(first.submittedAt, null);
  assert.equal(first.late, false);
  assert.ok(!('token_hash' in first) && !('tokenHash' in first) && !('answers' in first), 'pas de jeton dans la liste');

  await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal((await browser.get(`/api/launches/${launch.id}`)).json().participants.length, 2);
  assert.equal((await browser.get(`/api/courses/${course.id}/launches`)).json()[0].participantCount, 2);
});

test('ANO-08 : le nom d’un élève n’apparaît jamais dans les journaux, même si le serveur plante', async (t) => {
  const written = [];
  const note = (...args) => written.push(args.map(String).join(' '));
  const { base, app } = await site(t);
  for (const method of ['log', 'error', 'warn', 'info']) t.mock.method(console, method, note);

  const browser = await loggedIn(base);
  const { launch } = await launched(browser);
  const { token } = await join(base, launch.code);
  await studentGet(base, '/api/student/state', token);
  await browser.get(`/api/launches/${launch.id}`);

  // Une panne au pire moment : le journal reçoit l'erreur, jamais la requête
  app.db.exec('DROP TABLE participants');
  assert.equal((await student(base).post(`/api/join/${launch.code}`, { names: NAMES })).status, 500);
  assert.ok(written.length > 0, 'la panne est bien journalisée');
  assert.doesNotMatch(written.join('\n'), /MARQUEUR/);
});

/* --- ADM-06, ADM-10 : un compte désactivé ou supprimé --- */

test('ADM-06 : un compte désactivé ferme les entrées, les élèves déjà entrés continuent', async (t) => {
  const { base, ids } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const { token } = await join(base, launch.code);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${ids.teacher}/disable`);

  const r = await student(base).post(`/api/join/${launch.code}`, { names: NAMES });
  assert.equal(r.status, 410);
  assert.match(r.text, /nouveaux élèves/);
  assert.equal((await studentGet(base, '/api/student/course', token)).status, 200);
  assert.equal(JSON.parse((await studentGet(base, '/api/student/state', token)).body).ended, false);

  await admin.post(`/api/admin/teachers/${ids.teacher}/enable`);
  assert.equal((await student(base).get(`/api/join/${launch.code}`)).status, 200, 'réactivé, le cours reprend');
});

test('ADM-04 : l’admin voit combien de lancements sont en cours, pas leur contenu', async (t) => {
  const { base, ids } = await site(t);
  const browser = await loggedIn(base);
  const { launch, course } = await launched(browser);
  await browser.post(`/api/courses/${course.id}/launches`);
  await join(base, launch.code);
  const admin = await loggedIn(base, ADMIN);
  const row = async () => (await admin.get('/api/admin/teachers')).json().find((teacher) => teacher.id === ids.teacher);
  assert.equal((await row()).running, 2);
  assert.equal((await row()).launches, 2);
  assert.doesNotMatch((await admin.get('/api/admin/teachers')).text, /MARQUEUR/);
  await browser.post(`/api/launches/${launch.id}/end`);
  assert.equal((await row()).running, 1);
  assert.equal((await row()).launches, 2);
});

test('ADM-10 : pendant les 14 jours, le compte supprimé se comporte comme un compte désactivé ; effacé, le cours n’existe plus', async (t) => {
  const { base, app, db, ids } = await site(t);
  const { launch } = await launched(await loggedIn(base));
  const { token } = await join(base, launch.code);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${ids.teacher}/disable`);
  await admin.post(`/api/admin/teachers/${ids.teacher}/delete`, { word: 'SUPPRIMER' });

  assert.equal((await student(base).get(`/api/join/${launch.code}`)).status, 410);
  assert.equal((await studentGet(base, '/api/student/course', token)).status, 200);

  db.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', ids.teacher);
  app.purge();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0, 'les noms des élèves disparaissent avec le compte');
  const gone = await studentGet(base, '/api/student/course', token);
  assert.equal(gone.status, 401);
  assert.match(gone.body.toString(), /n'existe plus/);
  assert.equal((await student(base).get(`/api/join/${launch.code}`)).status, 404);
});

test('supprimer un cours efface ses lancements et les noms de ses élèves', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base);
  const { course, launch } = await launched(browser);
  const { token } = await join(base, launch.code);
  await browser.raw('DELETE', `/api/courses/${course.id}`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participants').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM launches').get().n, 0);
  assert.equal((await studentGet(base, '/api/student/state', token)).status, 401);
});

/* --- Pages --- */

test('les pages des élèves et du lancement sont servies, quel que soit le code', async (t) => {
  const { base, root } = await site(t);
  const { writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  for (const [file, text] of [
    ['eleve.html', 'page élève'],
    ['accueil.html', 'page accueil'],
    ['prof-lancement.html', 'page lancement']
  ]) {
    await writeFile(path.join(root, file), text);
  }
  assert.equal((await request(base, '/c/ABC234')).body.toString(), 'page élève');
  assert.equal((await request(base, '/c/code-inconnu')).body.toString(), 'page élève');
  assert.equal((await request(base, '/')).body.toString(), 'page accueil');
  assert.equal((await request(base, '/prof/lancements/un-identifiant')).body.toString(), 'page lancement');
});
