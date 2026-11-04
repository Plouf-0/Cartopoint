/**
 * INC : le journal des problèmes, côté serveur. Ouvert à tous, il ne doit garder que ce qui est prévu, sans se laisser remplir, et n'être
 * lu que par l'admin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIncidents, KEEP_DAYS } from '../server/incidents.mjs';
import { describeError } from '../src/js/incident.js';
import { addAccount, cheapHash, client, startApp } from './helpers.js';

const ADMIN = 'admin@example.org';
const TEACHER = 'prof@example.org';
const PASSWORD = 'mot-de-passe-correct';
const HASH = cheapHash(PASSWORD);
const DAY = 24 * 60 * 60 * 1000;

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const report = (extra = {}) => ({
  page: '/prof/cours/abc',
  action: 'Message affiché',
  reason: '⚠ Enregistrement impossible : QuotaExceededError',
  details: 'pile',
  ageMs: 0,
  machine: {
    browser: CHROME,
    language: 'fr-FR',
    screen: '1920×1080',
    window: '1280×800',
    pixelRatio: 1,
    cores: 8,
    memoryGb: 8,
    online: true,
    worker: false,
    storageUsed: 1000,
    storageQuota: 5000
  },
  ...extra
});

async function site(t) {
  const started = await startApp(t);
  const { db } = started.app;
  addAccount(db, { email: ADMIN, role: 'admin', hash: HASH });
  addAccount(db, { email: TEACHER, hash: HASH });
  return { ...started, db };
}

async function loggedIn(base, email) {
  const browser = client(base);
  assert.equal((await browser.post('/api/auth/login', { email, password: PASSWORD })).status, 200);
  return browser;
}

const send = (base, body) => client(base).post('/api/incidents', body);
const listed = async (base) => (await (await loggedIn(base, ADMIN)).get('/api/admin/incidents')).json();

/** Le journal sans la route, avec sa propre horloge. */
function journal(t, db) {
  const clock = { now: Date.parse('2026-11-04T10:00:00.000Z') };
  return { clock, incidents: createIncidents(db, { now: () => clock.now }) };
}

test('INC-01 : une erreur se décrit quelle que soit sa forme, jamais par « undefined »', () => {
  assert.equal(describeError(new TypeError('Failed to fetch')), 'TypeError : Failed to fetch');
  assert.equal(describeError('un texte'), 'un texte');
  // L'événement d'échec d'IndexedDB n'a ni nom ni message : la raison est dans sa requête
  assert.equal(describeError({ target: { error: { name: 'QuotaExceededError', message: 'plus de place' } } }), 'QuotaExceededError : plus de place');
  assert.equal(describeError({ name: 'AbortError' }), 'AbortError');
  assert.equal(describeError({ message: 'seul' }), 'seul');
  assert.equal(describeError(null), 'aucun détail');
  assert.equal(describeError(undefined), 'aucun détail');
  assert.equal(describeError(42), '42');
});

test('INC-01 : un navigateur signale un problème, sans compte, et l’admin le lit avec la machine et la raison', async (t) => {
  const { base } = await site(t);
  assert.equal((await send(base, report())).status, 200);
  const [incident] = await listed(base);
  assert.equal(incident.page, '/prof/cours/abc');
  assert.equal(incident.action, 'Message affiché');
  assert.equal(incident.reason, '⚠ Enregistrement impossible : QuotaExceededError');
  assert.equal(incident.details, 'pile');
  assert.equal(incident.count, 1);
  assert.equal(incident.account, null);
  assert.deepEqual(incident.machine, report().machine);
  assert.ok(Date.parse(incident.firstAt) && incident.firstAt === incident.lastAt);
});

test('INC-01 : le compte connecté est noté, pour savoir qui a eu le problème', async (t) => {
  const { base } = await site(t);
  const teacher = await loggedIn(base, TEACHER);
  assert.equal((await teacher.post('/api/incidents', report())).status, 200);
  assert.equal((await listed(base))[0].account, TEACHER);
});

test('INC-01 : un compte effacé ne fait pas disparaître le problème, seulement son nom', async (t) => {
  const { base, db } = await site(t);
  const teacher = await loggedIn(base, TEACHER);
  await teacher.post('/api/incidents', report());
  db.prepare('DELETE FROM accounts WHERE email = ?').run(TEACHER);
  const [incident] = await listed(base);
  assert.equal(incident.account, null);
  assert.equal(incident.reason, report().reason);
});

test('INC-02 : seul l’admin lit et efface le journal', async (t) => {
  const { base } = await site(t);
  await send(base, report());
  assert.equal((await client(base).get('/api/admin/incidents')).status, 401);
  assert.equal((await client(base).post('/api/admin/incidents/clear', {})).status, 401);
  const teacher = await loggedIn(base, TEACHER);
  assert.equal((await teacher.get('/api/admin/incidents')).status, 403);
  assert.equal((await teacher.post('/api/admin/incidents/clear', {})).status, 403);
  assert.equal((await listed(base)).length, 1);

  const admin = await loggedIn(base, ADMIN);
  assert.equal((await admin.post('/api/admin/incidents/clear', {})).status, 200);
  assert.deepEqual(await listed(base), []);
});

test('INC-02 : ni signalement ni effacement ne viennent d’un autre site', async (t) => {
  const { base } = await site(t);
  const foreign = { Origin: 'https://ailleurs.example' };
  assert.equal((await client(base).post('/api/incidents', report(), foreign)).status, 403);
  const admin = await loggedIn(base, ADMIN);
  await send(base, report());
  assert.equal((await admin.post('/api/admin/incidents/clear', {}, foreign)).status, 403);
  assert.equal((await listed(base)).length, 1);
});

test('INC-03 : rien d’autre que les champs prévus n’entre dans le journal, quoi que le navigateur envoie', async (t) => {
  const { base, db } = await site(t);
  const sent = report({
    names: 'Léa MARQUEUR',
    answers: { m1: 'MARQUEUR' },
    machine: { ...report().machine, names: 'Léa MARQUEUR', extra: { a: 'MARQUEUR' }, cores: 'MARQUEUR', online: 'MARQUEUR', storageQuota: 'MARQUEUR' }
  });
  assert.equal((await send(base, sent)).status, 200);
  const [incident] = await listed(base);
  assert.equal(incident.machine.names, undefined);
  assert.equal(incident.machine.extra, undefined);
  assert.equal(incident.machine.cores, undefined);
  assert.equal(incident.machine.online, undefined);
  assert.equal(incident.machine.storageQuota, undefined);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM incidents').all()), /MARQUEUR/);
});

test('INC-03 : l’adresse IP n’est gardée nulle part', async (t) => {
  const { base, db } = await site(t);
  await client(base).post('/api/incidents', report(), { 'X-Forwarded-For': '203.0.113.77' });
  const stored = JSON.stringify(db.prepare('SELECT * FROM incidents').all());
  assert.doesNotMatch(stored, /203\.0\.113\.77|127\.0\.0\.1/);
});

test('INC-04 : un message sans raison ou illisible est refusé, sans casser le serveur', async (t) => {
  const { base } = await site(t);
  for (const body of [{}, report({ action: '' }), report({ reason: '   ' }), report({ reason: 12 }), report({ action: { a: 1 } }), [], 'texte'])
    assert.equal((await send(base, body)).status, 400, JSON.stringify(body));
  assert.deepEqual(await listed(base), []);
});

test('INC-04 : une machine illisible n’empêche pas de garder le problème', async (t) => {
  const { base } = await site(t);
  assert.equal((await send(base, report({ machine: 'rien' }))).status, 200);
  assert.deepEqual((await listed(base))[0].machine, {});
});

test('INC-04 : les textes trop longs sont coupés, et un envoi trop gros est refusé', async (t) => {
  const { base } = await site(t);
  const long = 'x'.repeat(1100);
  const sent = report({
    page: long,
    action: long,
    reason: long,
    details: 'x'.repeat(2500),
    machine: { browser: long, language: long, screen: long, window: long, network: long }
  });
  assert.equal((await send(base, sent)).status, 200);
  const [incident] = await listed(base);
  assert.equal(incident.page.length, 200);
  assert.equal(incident.action.length, 120);
  assert.equal(incident.reason.length, 1000);
  assert.equal(incident.details.length, 2000);
  assert.equal(incident.machine.browser.length, 400);
  assert.equal(incident.machine.language.length, 20);
  assert.equal(incident.machine.screen.length, 20);
  assert.equal(incident.machine.window.length, 20);
  assert.equal(incident.machine.network.length, 20);

  assert.equal((await send(base, report({ details: 'y'.repeat(20 * 1024) }))).status, 413);
});

test('INC-05 : le même problème, sur le même navigateur, ne fait qu’augmenter un compteur', async (t) => {
  const { base } = await site(t);
  await send(base, report({ details: 'première pile' }));
  await send(base, report({ details: 'dernière pile' }));
  await send(base, report());
  const list = await listed(base);
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 3);
});

test('INC-05 : à la date et au détail près, une répétition garde sa première date et met le reste à jour', (t, done) => {
  site(t).then(({ db }) => {
    const { clock, incidents } = journal(t, db);
    incidents.record(report({ details: 'première', machine: { browser: CHROME, online: true } }));
    clock.now += DAY;
    incidents.record(report({ details: 'dernière', machine: { browser: CHROME, online: false } }));
    const [incident] = incidents.list();
    assert.equal(incident.firstAt, '2026-11-04T10:00:00.000Z');
    assert.equal(incident.lastAt, '2026-11-05T10:00:00.000Z');
    assert.equal(incident.details, 'dernière');
    assert.equal(incident.machine.online, false);
    done();
  }, done);
});

test('INC-05 : une autre raison, un autre navigateur, une autre page ou un autre compte font une autre ligne', async (t) => {
  const { base } = await site(t);
  await send(base, report());
  await send(base, report({ reason: 'autre' }));
  await send(base, report({ action: 'autre' }));
  await send(base, report({ page: '/autre' }));
  await send(base, report({ machine: { browser: 'Firefox' } }));
  await (await loggedIn(base, TEACHER)).post('/api/incidents', report());
  assert.equal((await listed(base)).length, 6);
});

test('INC-06 : un message qui a attendu le réseau garde la date du problème, sans se fier à l’horloge de l’appareil', async (t) => {
  const { db } = await site(t);
  const { clock, incidents } = journal(t, db);
  incidents.record(report({ ageMs: 2 * 60 * 60 * 1000 }));
  assert.equal(incidents.list()[0].lastAt, new Date(clock.now - 2 * 60 * 60 * 1000).toISOString());
});

test('INC-06 : un âge absurde ne fausse rien : ni avenir, ni passé plus lointain que la durée de conservation', async (t) => {
  const { db } = await site(t);
  const { clock, incidents } = journal(t, db);
  incidents.record(report({ reason: 'futur', ageMs: -DAY }));
  incidents.record(report({ reason: 'ancien', ageMs: 5000 * DAY }));
  incidents.record(report({ reason: 'texte', ageMs: 'hier' }));
  const at = Object.fromEntries(incidents.list().map((incident) => [incident.reason, incident.lastAt]));
  assert.equal(at.futur, new Date(clock.now).toISOString());
  assert.equal(at.ancien, new Date(clock.now - KEEP_DAYS * DAY).toISOString());
  assert.equal(at.texte, new Date(clock.now).toISOString());
});

test('INC-07 : gardé 90 jours, pas plus', async (t) => {
  const { db } = await site(t);
  const { clock, incidents } = journal(t, db);
  assert.equal(KEEP_DAYS, 90);
  incidents.record(report({ reason: 'ancien' }));
  clock.now += DAY;
  incidents.record(report({ reason: 'récent' }));
  clock.now += (KEEP_DAYS - 1) * DAY;
  clock.now += 60 * 1000;
  incidents.purge();
  assert.deepEqual(
    incidents.list().map((incident) => incident.reason),
    ['récent']
  );
});

test('INC-07 : le nettoyage de chaque heure passe aussi par le journal', async (t) => {
  const { app, db } = await site(t);
  db.prepare(
    "INSERT INTO incidents (fingerprint, page, action, reason, machine, first_at, last_at) VALUES ('x', '/', 'a', 'r', '{}', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')"
  ).run();
  app.purge();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n, 0);
});

test('INC-07 : le journal ne dépasse jamais 500 lignes : les plus anciennes partent', async (t) => {
  const { db } = await site(t);
  const { clock, incidents } = journal(t, db);
  for (let i = 0; i < 510; i++) {
    clock.now += 2000;
    if (i % 50 === 0) clock.now += 60000;
    incidents.record(report({ reason: `problème ${i}` }));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n, 500);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE reason = 'problème 0'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE reason = 'problème 509'").get().n, 1);
  assert.equal(incidents.list().length, 200, 'la page n’en montre que les derniers');
  assert.equal(incidents.list()[0].reason, 'problème 509');
});

test('INC-07 : pas plus de 60 messages par minute pour tout le site, puis ça repart', async (t) => {
  const { db } = await site(t);
  const { clock, incidents } = journal(t, db);
  for (let i = 0; i < 60; i++) incidents.record(report({ reason: `problème ${i}` }));
  assert.throws(() => incidents.record(report({ reason: 'de trop' })), { status: 429 });
  assert.equal(incidents.list().length, 60);
  clock.now += 60000;
  incidents.record(report({ reason: 'une minute après' }));
  assert.equal(incidents.list()[0].reason, 'une minute après');
});

test('INC-07 : au-delà de la limite, la route répond 429 et n’écrit rien', async (t) => {
  const { base, db } = await site(t);
  let status;
  for (let i = 0; i < 61; i++) status = (await send(base, report({ reason: `problème ${i}` }))).status;
  assert.equal(status, 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n, 60);
});
