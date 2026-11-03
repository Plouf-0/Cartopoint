/**
 * Comptes, sessions, liens et rôles, au niveau de l'API. Les titres citent les exigences du cahier
 * des charges (section 12.1). Les écrans sont vérifiés dans tests/e2e/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureAdmin } from '../server/auth.mjs';
import { addAccount, cheapHash, client, request, startApp } from './helpers.js';

const PASSWORD = 'mot-de-passe-1';
const OTHER_PASSWORD = 'mot-de-passe-2';
const HASH = cheapHash(PASSWORD);
const ADMIN = 'admin@example.org';
const TEACHER = 'prof@example.org';
const BAD_LOGIN = 'Adresse e-mail ou mot de passe incorrect.';
const DEAD_LINK = "Ce lien n'est plus valable. Demandez-en un nouveau.";
const DISABLED = "Votre compte a été désactivé. Contactez l'administrateur du site.";
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const tokenOf = (link) => link.split('#')[1];

/** Le site, avec un admin et un enseignant prêts à se connecter. */
async function site(t, options) {
  const started = await startApp(t, options);
  const adminId = addAccount(started.app.db, { email: ADMIN, role: 'admin', hash: HASH });
  const teacherId = addAccount(started.app.db, { email: TEACHER, hash: HASH });
  return { ...started, db: started.app.db, adminId, teacherId };
}

async function loggedIn(base, email, password = PASSWORD) {
  const browser = client(base);
  const r = await browser.post('/api/auth/login', { email, password });
  assert.equal(r.status, 200, `connexion de ${email}`);
  return browser;
}

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const accountOf = (db, email) => db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);

/* --- ADM-01 : création de l'admin --- */

test('ADM-01 : sans ADMIN_EMAIL ni ADMIN_PASSWORD, il n’y a pas d’admin', async (t) => {
  const { app } = await startApp(t);
  assert.equal(await ensureAdmin(app.db, {}), 'missing');
  assert.equal(await ensureAdmin(app.db, { email: ADMIN }), 'missing');
  assert.equal(await ensureAdmin(app.db, { password: PASSWORD }), 'missing');
  assert.equal(count(app.db, 'accounts'), 0);
});

test('ADM-01 : le premier visiteur ne devient pas admin', async (t) => {
  const { app, base } = await startApp(t);
  const visitor = client(base);
  assert.equal((await visitor.post('/api/auth/login', { email: 'moi@example.org', password: PASSWORD })).status, 401);
  assert.equal((await visitor.post('/api/auth/invite', { token: 'x', email: 'moi@example.org', password: PASSWORD })).status, 410);
  assert.equal((await visitor.get('/api/admin/teachers')).status, 401);
  assert.equal(count(app.db, 'accounts'), 0);
});

test('ADM-01 : l’admin créé à l’installation peut se connecter', async (t) => {
  const { app, base } = await startApp(t);
  assert.equal(await ensureAdmin(app.db, { email: ADMIN, password: PASSWORD }), 'created');
  const r = await client(base).post('/api/auth/login', { email: ADMIN, password: PASSWORD });
  assert.deepEqual(r.json(), { email: ADMIN, role: 'admin' });
});

test('ADM-01 : un admin existant n’est jamais remplacé par les variables', async (t) => {
  const { app, base } = await startApp(t);
  await ensureAdmin(app.db, { email: ADMIN, password: PASSWORD });
  assert.equal(await ensureAdmin(app.db, { email: 'autre@example.org', password: OTHER_PASSWORD }), 'exists');
  assert.equal(count(app.db, 'accounts'), 1);
  assert.equal((await client(base).post('/api/auth/login', { email: ADMIN, password: PASSWORD })).status, 200);
});

test('ADM-01 : des variables invalides ne créent rien, sans empêcher le démarrage', async (t) => {
  const { app } = await startApp(t);
  assert.equal(await ensureAdmin(app.db, { email: 'pas-une-adresse', password: PASSWORD }), 'invalid');
  assert.equal(await ensureAdmin(app.db, { email: ADMIN, password: 'court' }), 'invalid');
  addAccount(app.db, { email: TEACHER, hash: HASH });
  assert.equal(await ensureAdmin(app.db, { email: TEACHER, password: PASSWORD }), 'invalid');
  assert.equal(accountOf(app.db, TEACHER).role, 'teacher', 'un enseignant ne devient pas admin');
});

/* --- ENS-01 : connexion --- */

test('ENS-01 : on se connecte avec son adresse, sans tenir compte de la casse ni des espaces', async (t) => {
  const { base, db } = await site(t);
  const browser = client(base);
  const r = await browser.post('/api/auth/login', { email: '  PROF@Example.org ', password: PASSWORD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { email: TEACHER, role: 'teacher' });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual((await browser.get('/api/auth/me')).json(), { email: TEACHER, role: 'teacher' });
  assert.ok(accountOf(db, TEACHER).last_login_at, 'la dernière connexion est notée (ADM-04)');
});

test('ENS-01 : sans le bon mot de passe, le message ne dit pas si le compte existe ni s’il est désactivé', async (t) => {
  const { base, db } = await site(t);
  addAccount(db, { email: 'desactive@example.org', hash: HASH, disabledAt: '2026-01-01' });
  addAccount(db, { email: 'sans-mot-de-passe@example.org' });
  const attempts = [
    { email: TEACHER, password: 'mauvais-mot-de-passe' },
    { email: 'inconnu@example.org', password: PASSWORD },
    { email: 'desactive@example.org', password: 'mauvais-mot-de-passe' },
    { email: 'sans-mot-de-passe@example.org', password: PASSWORD }
  ];
  for (const attempt of attempts) {
    const browser = client(base);
    const r = await browser.post('/api/auth/login', attempt);
    assert.equal(r.status, 401, attempt.email);
    assert.equal(r.text, BAD_LOGIN, attempt.email);
    assert.equal(r.setCookie, undefined, attempt.email);
  }
  assert.equal(count(db, 'sessions'), 0);
});

test('une connexion mal formée est refusée sans erreur du serveur', async (t) => {
  const { base } = await site(t);
  const browser = client(base);
  const refused = [
    {},
    { email: TEACHER },
    { password: PASSWORD },
    { email: 12, password: PASSWORD },
    { email: TEACHER, password: {} },
    { email: 'x'.repeat(255), password: PASSWORD },
    { email: TEACHER, password: 'x'.repeat(201) }
  ];
  for (const body of refused) assert.equal((await browser.post('/api/auth/login', body)).status, 401, JSON.stringify(body).slice(0, 60));
  const invalid = await browser.raw('POST', '/api/auth/login');
  assert.equal(invalid.status, 400);
});

test('le cookie de session est protégé', async (t) => {
  const { base } = await site(t);
  const { setCookie } = await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD });
  const attributes = setCookie.split('; ').slice(1);
  assert.deepEqual(attributes.sort(), ['HttpOnly', 'Max-Age=2592000', 'Path=/api', 'SameSite=Lax']);
});

test('le cookie porte Secure en HTTPS, seulement si le proxy est de confiance', async (t) => {
  const https = { 'X-Forwarded-Proto': 'https' };
  const trusted = await site(t, { trustProxy: true });
  const behindProxy = await client(trusted.base).post('/api/auth/login', { email: TEACHER, password: PASSWORD }, https);
  assert.match(behindProxy.setCookie, /; Secure/);
  const plain = await client(trusted.base).post('/api/auth/login', { email: TEACHER, password: PASSWORD }, { 'X-Forwarded-Proto': 'http' });
  assert.doesNotMatch(plain.setCookie, /Secure/);

  const untrusted = await site(t);
  const spoofed = await client(untrusted.base).post('/api/auth/login', { email: TEACHER, password: PASSWORD }, https);
  assert.doesNotMatch(spoofed.setCookie, /Secure/);
});

test('la base ne garde que l’empreinte du jeton de session', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base, TEACHER);
  const token = browser.cookie.split('=')[1];
  assert.ok(token.length >= 40, 'un jeton long');
  const { token_hash: stored, expires_at: expires } = db.prepare('SELECT * FROM sessions').get();
  assert.equal(stored, sha256(token));
  assert.notEqual(stored, token);
  const days = (new Date(expires) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `30 jours, et non ${days}`);
});

test('une session expirée ou inconnue ne donne plus accès', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base, TEACHER);
  db.exec("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'");
  assert.equal((await browser.get('/api/auth/me')).status, 401);
  const stranger = client(base);
  assert.equal((await stranger.get('/api/auth/me')).status, 401);
  stranger.cookie = 'session=' + 'a'.repeat(43);
  assert.equal((await stranger.get('/api/auth/me')).status, 401);
  stranger.cookie = 'autre=1; session=' + db.prepare('SELECT token_hash FROM sessions').get().token_hash;
  assert.equal((await stranger.get('/api/auth/me')).status, 401, 'l’empreinte volée dans une sauvegarde ne sert à rien');
});

test('ADM-06 : une session restée en base pour un compte désactivé ne donne aucun accès', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base, TEACHER);
  db.exec("UPDATE accounts SET disabled_at = '2026-01-01' WHERE role = 'teacher'");
  assert.equal((await browser.get('/api/auth/me')).status, 401);
});

test('le cookie est retrouvé parmi d’autres', async (t) => {
  const { base } = await site(t);
  const browser = await loggedIn(base, TEACHER);
  browser.cookie = `autre=1; ${browser.cookie}; encore=2=3`;
  assert.equal((await browser.get('/api/auth/me')).status, 200);
});

test('se déconnecter ferme vraiment la session', async (t) => {
  const { base, db } = await site(t);
  const browser = await loggedIn(base, TEACHER);
  const stolen = browser.cookie;
  const r = await browser.post('/api/auth/logout');
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /^session=; .*Max-Age=0/);
  assert.equal(count(db, 'sessions'), 0);
  browser.cookie = stolen;
  assert.equal((await browser.get('/api/auth/me')).status, 401);
  assert.equal((await client(base).post('/api/auth/logout')).status, 200, 'sans session, rien à faire');
});

/* --- Limites d'essais --- */

test('E-04 : dix échecs bloquent ce compte depuis cette adresse, même avec le bon mot de passe', async (t) => {
  const { base } = await site(t);
  const browser = client(base);
  for (let i = 0; i < 10; i++) assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: 'mauvais-mot-de-passe' })).status, 401);
  const blocked = await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD });
  assert.equal(blocked.status, 429);
  assert.match(blocked.text, /réessayez dans 10 minutes/);
  const otherCase = await browser.post('/api/auth/login', { email: 'PROF@example.org', password: PASSWORD });
  assert.equal(otherCase.status, 429, 'changer la casse de l’adresse ne contourne pas le blocage');
  assert.equal((await browser.post('/api/auth/login', { email: ADMIN, password: PASSWORD })).status, 200, 'les autres comptes restent accessibles');
});

test('E-04 : envoyer des essais par centaines en même temps ne contourne pas le blocage', async (t) => {
  const { base } = await site(t);
  const browser = client(base);
  const attempts = Array.from({ length: 30 }, () => browser.post('/api/auth/login', { email: TEACHER, password: 'mauvais-mot-de-passe' }));
  const statuses = (await Promise.all(attempts)).map((r) => r.status);
  assert.equal(statuses.filter((status) => status === 401).length, 10, 'dix essais vérifiés');
  assert.equal(statuses.filter((status) => status === 429).length, 20);
});

test('une connexion réussie remet le compteur à zéro', async (t) => {
  const { base } = await site(t);
  const browser = client(base);
  const fail = async (times) => {
    for (let i = 0; i < times; i++) assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: 'mauvais-mot-de-passe' })).status, 401);
  };
  await fail(9);
  assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 200);
  await fail(9);
  assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 200);
});

test('une adresse qui essaie beaucoup de comptes finit bloquée, sans gêner les autres', async (t) => {
  const { base, db } = await site(t, { trustProxy: true });
  const attacker = { 'X-Forwarded-For': '6.6.6.6' };
  const targets = Array.from({ length: 50 }, (_, i) => `cible${i}@example.org`);
  for (const email of targets) addAccount(db, { email, hash: HASH });
  const browser = client(base);
  for (const email of targets) assert.equal((await browser.post('/api/auth/login', { email, password: 'mauvais-mot-de-passe' }, attacker)).status, 401);
  assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD }, attacker)).status, 429);
  assert.equal((await browser.post('/api/auth/login', { email: TEACHER, password: PASSWORD }, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
});

test('E-04 : les connexions réussies d’un établissement ne comptent pas comme des échecs', async (t) => {
  const { base, db } = await site(t, { trustProxy: true });
  const school = { 'X-Forwarded-For': '1.1.1.1' };
  const teachers = Array.from({ length: 60 }, (_, i) => `prof${i}@example.org`);
  for (const email of teachers) addAccount(db, { email, hash: HASH });
  const browser = client(base);
  for (let start = 0; start < teachers.length; start += 10) {
    const logins = teachers.slice(start, start + 10).map((email) => browser.post('/api/auth/login', { email, password: PASSWORD }, school));
    for (const r of await Promise.all(logins)) assert.equal(r.status, 200);
  }
});

/* --- Origine des requêtes --- */

test('une écriture venue d’un autre site, ou sans origine, est refusée sans effet', async (t) => {
  const { base, db, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  const writes = [
    ['/api/auth/login', { email: TEACHER, password: PASSWORD }],
    ['/api/auth/logout', {}],
    ['/api/auth/password', { current: PASSWORD, password: OTHER_PASSWORD }],
    ['/api/auth/invite', { token: 'x', email: 'a@b.fr', password: PASSWORD }],
    ['/api/auth/reset', { token: 'x', password: PASSWORD }],
    ['/api/admin/invites', {}],
    [`/api/admin/teachers/${teacherId}/reset`, {}],
    [`/api/admin/teachers/${teacherId}/disable`, {}],
    [`/api/admin/teachers/${teacherId}/enable`, {}]
  ];
  const before = { sessions: count(db, 'sessions'), links: count(db, 'links') };
  for (const [target, body] of writes) {
    for (const origin of ['https://attaquant.example', undefined, 'null']) {
      const r = await admin.post(target, body, { Origin: origin });
      assert.equal(r.status, 403, `${target} depuis ${origin}`);
      assert.equal(r.text, 'Origine de la requête refusée.', target);
    }
  }
  assert.deepEqual({ sessions: count(db, 'sessions'), links: count(db, 'links') }, before);
  assert.equal(accountOf(db, TEACHER).disabled_at, null);
  assert.equal((await admin.get('/api/auth/me')).status, 200, 'la session de l’admin est toujours là');
});

/* --- ENS-04, ADM-07 : rôles --- */

const adminRoutesFor = (id) => [
  ['GET', '/api/admin/teachers'],
  ['POST', '/api/admin/invites'],
  ['POST', `/api/admin/teachers/${id}/reset`],
  ['POST', `/api/admin/teachers/${id}/disable`],
  ['POST', `/api/admin/teachers/${id}/enable`]
];

test('ENS-04 : le serveur réserve toutes les routes d’admin à l’admin, sans effet pour les autres', async (t) => {
  const { base, db, teacherId } = await site(t);
  const teacher = await loggedIn(base, TEACHER);
  const anonymous = client(base);
  for (const [method, target] of adminRoutesFor(teacherId)) {
    const body = method === 'POST' ? {} : undefined;
    assert.equal((await teacher.raw(method, target, body)).status, 403, `enseignant : ${target}`);
    assert.equal((await anonymous.raw(method, target, body)).status, 401, `anonyme : ${target}`);
  }
  assert.equal(count(db, 'links'), 0);
  assert.equal(accountOf(db, TEACHER).disabled_at, null);
});

test('ADM-07 : la liste des enseignants ne montre que leur compte, jamais leur mot de passe ni leurs cours', async (t) => {
  const { base, db, teacherId } = await site(t);
  db.exec(`INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES ('c1', '${teacherId}', 'Titre secret', '{"secret":1}', 'd')`);
  const admin = await loggedIn(base, ADMIN);
  const r = await admin.get('/api/admin/teachers');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const list = r.json();
  assert.equal(list.length, 1, 'l’admin lui-même n’y figure pas');
  assert.deepEqual(Object.keys(list[0]).sort(), [
    'bytes',
    'courses',
    'createdAt',
    'deletedAt',
    'disabled',
    'email',
    'eraseAt',
    'fiches',
    'id',
    'lastLoginAt',
    'launches',
    'running'
  ]);
  assert.equal(list[0].email, TEACHER);
  assert.equal(list[0].disabled, false);
  assert.equal(list[0].lastLoginAt, null);
  assert.doesNotMatch(r.text, /scrypt|secret/i);
});

test('la liste est triée par adresse, sans tenir compte de la casse', async (t) => {
  const { base, db } = await site(t);
  addAccount(db, { email: 'Zoe@example.org', hash: HASH });
  addAccount(db, { email: 'alice@example.org', hash: HASH });
  const admin = await loggedIn(base, ADMIN);
  const emails = (await admin.get('/api/admin/teachers')).json().map((teacher) => teacher.email);
  assert.deepEqual(emails, ['alice@example.org', TEACHER, 'Zoe@example.org']);
});

test('l’admin ne peut agir ni sur lui-même ni sur un compte inconnu', async (t) => {
  const { base, adminId, db } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  for (const id of [adminId, 'inconnu']) {
    for (const action of ['reset', 'disable', 'enable']) {
      assert.equal((await admin.post(`/api/admin/teachers/${id}/${action}`)).status, 404, `${action} sur ${id}`);
    }
  }
  assert.equal(accountOf(db, ADMIN).disabled_at, null);
});

/* --- ADM-02, ADM-03 : invitations --- */

async function invite(base) {
  const admin = await loggedIn(base, ADMIN);
  const r = await admin.post('/api/admin/invites');
  assert.equal(r.status, 200);
  return r.json();
}

test('ADM-02 : un lien d’invitation vaut 7 jours, et la base n’en garde que l’empreinte', async (t) => {
  const { base, db } = await site(t);
  const { link, expiresAt } = await invite(base);
  assert.match(link, /^\/invitation#[\w-]{43}$/);
  const days = (new Date(expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days <= 7, `7 jours, et non ${days}`);
  const stored = db.prepare('SELECT * FROM links').get();
  assert.equal(stored.token_hash, sha256(tokenOf(link)));
  assert.equal(stored.kind, 'invite');
  assert.equal(stored.account_id, null);
});

test('ADM-03 : un lien crée un compte enseignant, déjà connecté', async (t) => {
  const { base, db } = await site(t);
  const { link } = await invite(base);
  const newcomer = client(base);
  const r = await newcomer.post('/api/auth/invite', { token: tokenOf(link), email: ' Nouveau@example.org ', password: PASSWORD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { email: 'Nouveau@example.org', role: 'teacher' });
  assert.deepEqual((await newcomer.get('/api/auth/me')).json(), { email: 'Nouveau@example.org', role: 'teacher' });
  assert.ok(accountOf(db, 'nouveau@example.org').last_login_at);
  assert.equal((await client(base).post('/api/auth/login', { email: 'nouveau@example.org', password: PASSWORD })).status, 200);
});

test('ADM-03 : un lien d’invitation ne peut pas créer d’admin', async (t) => {
  const { base, db } = await site(t);
  const { link } = await invite(base);
  await client(base).post('/api/auth/invite', { token: tokenOf(link), email: 'n@example.org', password: PASSWORD, role: 'admin' });
  assert.equal(accountOf(db, 'n@example.org').role, 'teacher');
});

test('ADM-03 : un lien ne sert qu’une fois', async (t) => {
  const { base, db } = await site(t);
  const { link } = await invite(base);
  assert.equal((await client(base).post('/api/auth/invite', { token: tokenOf(link), email: 'a@example.org', password: PASSWORD })).status, 200);
  const again = await client(base).post('/api/auth/invite', { token: tokenOf(link), email: 'b@example.org', password: PASSWORD });
  assert.equal(again.status, 410);
  assert.equal(again.text, DEAD_LINK);
  assert.equal(accountOf(db, 'b@example.org'), undefined);
});

test('ADM-03 : deux personnes qui utilisent le même lien en même temps ne créent qu’un compte', async (t) => {
  const { base, db } = await site(t);
  const { link } = await invite(base);
  const attempts = ['a', 'b', 'c', 'd'].map((name) =>
    client(base).post('/api/auth/invite', { token: tokenOf(link), email: `${name}@example.org`, password: PASSWORD })
  );
  const statuses = (await Promise.all(attempts)).map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 410, 410, 410]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email LIKE '_@example.org'").get().n, 1);
});

test('ADM-03 : un lien expiré ou inventé est refusé, avec le même message', async (t) => {
  const { base, db } = await site(t);
  const { link } = await invite(base);
  db.exec("UPDATE links SET expires_at = '2020-01-01T00:00:00.000Z'");
  for (const token of [tokenOf(link), 'jeton-invente', '', undefined, 12, {}]) {
    const r = await client(base).post('/api/auth/invite', { token, email: 'a@example.org', password: PASSWORD });
    assert.equal(r.status, 410, String(token));
    assert.equal(r.text, DEAD_LINK);
  }
  assert.equal(accountOf(db, 'a@example.org'), undefined);
});

test('un lien mort est signalé avant de regarder la saisie, et sans calcul de mot de passe', async (t) => {
  const { base } = await site(t);
  const invited = await client(base).post('/api/auth/invite', { token: 'jeton-invente', email: 'pas-une-adresse', password: 'court' });
  assert.equal(invited.status, 410);
  const reset = await client(base).post('/api/auth/reset', { token: 'jeton-invente', password: 'court' });
  assert.equal(reset.status, 410);
});

test('ADM-03 : une saisie refusée laisse le lien utilisable', async (t) => {
  const { base, db } = await site(t);
  const { link } = await invite(base);
  const token = tokenOf(link);
  const newcomer = client(base);
  assert.equal((await newcomer.post('/api/auth/invite', { token, email: 'pas-une-adresse', password: PASSWORD })).status, 400);
  assert.equal((await newcomer.post('/api/auth/invite', { token, email: 'a@example.org', password: 'court' })).status, 400);
  const taken = await newcomer.post('/api/auth/invite', { token, email: 'PROF@example.org', password: PASSWORD });
  assert.equal(taken.status, 409, 'adresse déjà prise, quelle que soit la casse');
  assert.equal(taken.setCookie, undefined);
  assert.equal(db.prepare('SELECT used_at FROM links').get().used_at, null);
  assert.equal((await newcomer.post('/api/auth/invite', { token, email: 'a@example.org', password: PASSWORD })).status, 200);
});

/* --- ADM-05 : réinitialisation --- */

async function resetLink(base, teacherId) {
  const admin = await loggedIn(base, ADMIN);
  const r = await admin.post(`/api/admin/teachers/${teacherId}/reset`);
  assert.equal(r.status, 200);
  return r.json();
}

test('ADM-05 : un lien de réinitialisation vaut 72 heures et change le mot de passe', async (t) => {
  const { base, db, teacherId } = await site(t);
  const session = await loggedIn(base, TEACHER);
  const { link, expiresAt } = await resetLink(base, teacherId);
  assert.match(link, /^\/reinitialisation#[\w-]{43}$/);
  const hours = (new Date(expiresAt) - Date.now()) / 3600000;
  assert.ok(hours > 71.9 && hours <= 72, `72 heures, et non ${hours}`);
  assert.equal(accountOf(db, TEACHER).password_hash, HASH, 'rien ne change tant que le lien n’a pas servi');

  const owner = client(base);
  const r = await owner.post('/api/auth/reset', { token: tokenOf(link), password: OTHER_PASSWORD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { email: TEACHER, role: 'teacher' });
  assert.equal((await owner.get('/api/auth/me')).status, 200, 'la personne est connectée');
  assert.equal((await session.get('/api/auth/me')).status, 401, 'les anciennes sessions sont fermées');
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 401);
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: OTHER_PASSWORD })).status, 200);
});

test('ADM-05 : un lien de réinitialisation ne sert qu’une fois et finit par expirer', async (t) => {
  const { base, db, teacherId } = await site(t);
  const first = await resetLink(base, teacherId);
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(first.link), password: OTHER_PASSWORD })).status, 200);
  const again = await client(base).post('/api/auth/reset', { token: tokenOf(first.link), password: PASSWORD });
  assert.equal(again.status, 410);
  assert.equal(again.text, DEAD_LINK);

  const second = await resetLink(base, teacherId);
  db.exec("UPDATE links SET expires_at = '2020-01-01T00:00:00.000Z'");
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(second.link), password: PASSWORD })).status, 410);
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: OTHER_PASSWORD })).status, 200);
});

test('ADM-05 : un nouveau lien annule le précédent', async (t) => {
  const { base, teacherId } = await site(t);
  const first = await resetLink(base, teacherId);
  const second = await resetLink(base, teacherId);
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(first.link), password: OTHER_PASSWORD })).status, 410);
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(second.link), password: OTHER_PASSWORD })).status, 200);
});

test('ADM-05 : un mot de passe trop court laisse le lien utilisable', async (t) => {
  const { base, teacherId } = await site(t);
  const { link } = await resetLink(base, teacherId);
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(link), password: 'court' })).status, 400);
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(link), password: OTHER_PASSWORD })).status, 200);
});

test('un lien d’invitation ne sert pas de réinitialisation, ni l’inverse', async (t) => {
  const { base, db, teacherId } = await site(t);
  const invitation = await invite(base);
  const reset = await resetLink(base, teacherId);
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(invitation.link), password: OTHER_PASSWORD })).status, 410);
  assert.equal((await client(base).post('/api/auth/invite', { token: tokenOf(reset.link), email: 'a@example.org', password: OTHER_PASSWORD })).status, 410);
  assert.equal(accountOf(db, TEACHER).password_hash, HASH);
  assert.equal(accountOf(db, 'a@example.org'), undefined);
});

/* --- ADM-06 : désactivation --- */

test('ADM-06 : un compte désactivé perd l’accès tout de suite, et garde ses cours', async (t) => {
  const { base, db, teacherId } = await site(t);
  db.exec(`INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES ('c1', '${teacherId}', 'Cours', '{}', 'd')`);
  const session = await loggedIn(base, TEACHER);
  const admin = await loggedIn(base, ADMIN);
  const r = await admin.post(`/api/admin/teachers/${teacherId}/disable`);
  assert.equal(r.status, 200);
  assert.equal(r.json().disabled, true);
  assert.equal((await session.get('/api/auth/me')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?').get(teacherId).n, 0, 'ses sessions sont supprimées');
  const login = await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD });
  assert.equal(login.status, 403);
  assert.equal(count(db, 'courses'), 1);
  assert.equal((await admin.get('/api/admin/teachers')).json()[0].disabled, true);
});

test('ADM-06 : avec le bon mot de passe, l’enseignant apprend que son compte est désactivé, sans ouvrir de session', async (t) => {
  const { base, db } = await site(t);
  addAccount(db, { email: 'desactive@example.org', hash: HASH, disabledAt: '2026-01-01' });
  const r = await client(base).post('/api/auth/login', { email: 'DESACTIVE@example.org', password: PASSWORD });
  assert.equal(r.status, 403);
  assert.equal(r.text, DISABLED);
  assert.equal(r.setCookie, undefined);
  assert.equal(count(db, 'sessions'), 0);
  assert.equal(accountOf(db, 'desactive@example.org').last_login_at, null, 'ce n’est pas une connexion');
});

test('ADM-06 : un compte désactivé reste protégé par la limite d’essais, sans bloquer son titulaire', async (t) => {
  const { base, db } = await site(t);
  addAccount(db, { email: 'desactive@example.org', hash: HASH, disabledAt: '2026-01-01' });
  const browser = client(base);
  const login = async (password) => (await browser.post('/api/auth/login', { email: 'desactive@example.org', password })).status;
  for (let i = 0; i < 12; i++) assert.equal(await login(PASSWORD), 403, `le titulaire réessaie, essai ${i + 1}`);
  for (let i = 0; i < 10; i++) assert.equal(await login('mauvais-mot-de-passe'), 401, `essai ${i + 1}`);
  assert.equal(await login(PASSWORD), 429);
});

test('ADM-06 : un compte réactivé peut de nouveau se connecter', async (t) => {
  const { base, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${teacherId}/disable`);
  const r = await admin.post(`/api/admin/teachers/${teacherId}/enable`);
  assert.equal(r.json().disabled, false);
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 200);
});

test('ADM-06 : désactiver deux fois garde la date de la première', async (t) => {
  const { base, db, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${teacherId}/disable`);
  db.exec("UPDATE accounts SET disabled_at = '2020-01-01' WHERE role = 'teacher'");
  await admin.post(`/api/admin/teachers/${teacherId}/disable`);
  assert.equal(accountOf(db, TEACHER).disabled_at, '2020-01-01');
});

test('ADM-06 : la réinitialisation ne rouvre pas un compte désactivé', async (t) => {
  const { base, db, teacherId } = await site(t);
  const { link } = await resetLink(base, teacherId);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${teacherId}/disable`);

  const refused = await admin.post(`/api/admin/teachers/${teacherId}/reset`);
  assert.equal(refused.status, 409, 'pas de nouveau lien pour un compte désactivé');

  const owner = client(base);
  const used = await owner.post('/api/auth/reset', { token: tokenOf(link), password: OTHER_PASSWORD });
  assert.equal(used.status, 410);
  assert.equal(used.setCookie, undefined);
  assert.equal(accountOf(db, TEACHER).password_hash, HASH);

  await admin.post(`/api/admin/teachers/${teacherId}/enable`);
  assert.equal(
    (await owner.post('/api/auth/reset', { token: tokenOf(link), password: OTHER_PASSWORD })).status,
    200,
    'le lien sert de nouveau une fois le compte réactivé'
  );
});

/* --- ADM-10 : suppression, restauration, effacement --- */

const WORD = { word: 'SUPPRIMER' };
const DAY = 24 * 60 * 60 * 1000;

/** Tout ce qu'un compte peut posséder, du cours à l'élève. */
function addEverything(db, accountId, key) {
  db.exec(`
    INSERT INTO media (hash, account_id, ext, size, created_at) VALUES ('hash-${key}', '${accountId}', 'jpg', 10, '2099-01-01');
    INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES ('c-${key}', '${accountId}', 'Cours', '{}', 'd');
    INSERT INTO course_versions VALUES ('v-${key}', 'c-${key}', 1, '{}', 'd');
    INSERT INTO launches (id, course_id, version_id, code, opened_at) VALUES ('l-${key}', 'c-${key}', 'v-${key}', 'CODE-${key}', 'd');
    INSERT INTO participants (id, launch_id, token_hash, names, joined_at) VALUES ('p-${key}', 'l-${key}', 't-${key}', 'Élève', 'd');
    INSERT INTO sessions VALUES ('s-${key}', '${accountId}', '2099-01-01T00:00:00.000Z');
    INSERT INTO links (token_hash, kind, account_id, expires_at, created_at) VALUES ('r-${key}', 'reset', '${accountId}', '2099-01-01T00:00:00.000Z', 'd');
  `);
}

const TABLES_OF_ACCOUNT = ['media', 'courses', 'course_versions', 'launches', 'participants', 'links'];

const deletedDaysAgo = (db, id, days) => db.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - days * DAY).toISOString(), id);

async function deleteAccount(admin, id) {
  assert.equal((await admin.post(`/api/admin/teachers/${id}/disable`)).status, 200);
  const r = await admin.post(`/api/admin/teachers/${id}/delete`, WORD);
  assert.equal(r.status, 200);
  return r;
}

test('ADM-10 : un compte supprimé garde tout pendant 14 jours, sans rouvrir aucun accès', async (t) => {
  const { base, db, teacherId } = await site(t);
  addEverything(db, teacherId, 'A');
  const admin = await loggedIn(base, ADMIN);
  const before = Date.now();
  const r = await deleteAccount(admin, teacherId);
  assert.equal(r.headers['cache-control'], 'no-store');

  const { deletedAt, eraseAt, disabled } = r.json();
  assert.equal(disabled, true);
  assert.ok(Date.parse(deletedAt) >= before);
  assert.equal(Date.parse(eraseAt) - Date.parse(deletedAt), 14 * DAY);
  assert.equal((await admin.get('/api/admin/teachers')).json()[0].deletedAt, deletedAt);

  for (const table of TABLES_OF_ACCOUNT) assert.equal(count(db, table), 1, table);
  const login = await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD });
  assert.equal(login.status, 403);
  assert.equal(login.text, DISABLED);
});

test('ADM-10 : restaurer rend le compte désactivé avec tout son contenu, et il peut ensuite être réactivé', async (t) => {
  const { base, db, teacherId } = await site(t);
  addEverything(db, teacherId, 'A');
  const admin = await loggedIn(base, ADMIN);
  await deleteAccount(admin, teacherId);

  const restored = await admin.post(`/api/admin/teachers/${teacherId}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.headers['cache-control'], 'no-store');
  assert.deepEqual(
    { deletedAt: restored.json().deletedAt, eraseAt: restored.json().eraseAt, disabled: restored.json().disabled },
    { deletedAt: null, eraseAt: null, disabled: true }
  );
  for (const table of TABLES_OF_ACCOUNT) assert.equal(count(db, table), 1, table);
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 403, 'toujours désactivé');

  assert.equal((await admin.post(`/api/admin/teachers/${teacherId}/enable`)).status, 200);
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 200);
});

test('ADM-10 : après 14 jours, le nettoyage efface le compte, ses cours et leur historique, et rien d’autre', async (t) => {
  const { app, base, db, teacherId } = await site(t);
  const otherId = addAccount(db, { email: 'autre@example.org', hash: HASH });
  addEverything(db, teacherId, 'A');
  addEverything(db, otherId, 'B');
  db.exec("INSERT INTO links (token_hash, kind, expires_at, created_at) VALUES ('invitation', 'invite', '2099-01-01T00:00:00.000Z', 'd')");
  const admin = await loggedIn(base, ADMIN);
  await deleteAccount(admin, teacherId);

  deletedDaysAgo(db, teacherId, 13.9);
  app.purge();
  assert.ok(accountOf(db, TEACHER), 'pas avant 14 jours');
  assert.equal(count(db, 'courses'), 2);

  deletedDaysAgo(db, teacherId, 14.1);
  app.purge();
  assert.equal(accountOf(db, TEACHER), undefined);
  for (const table of TABLES_OF_ACCOUNT.filter((name) => name !== 'links')) assert.equal(count(db, table), 1, `${table} : il ne reste que l’autre enseignant`);
  assert.equal(db.prepare('SELECT account_id FROM courses').get().account_id, otherId);
  assert.deepEqual(
    db
      .prepare('SELECT token_hash FROM links ORDER BY token_hash')
      .all()
      .map((link) => link.token_hash),
    ['invitation', 'r-B']
  );
  assert.equal(db.prepare('SELECT account_id FROM sessions WHERE token_hash = ?').get('s-B').account_id, otherId);
  assert.deepEqual(
    (await admin.get('/api/admin/teachers')).json().map((teacher) => teacher.email),
    ['autre@example.org']
  );
  assert.ok(accountOf(db, ADMIN));
  assert.equal((await admin.get('/api/auth/me')).status, 200, 'l’admin reste connecté');
});

test('ADM-10 : le nettoyage ne touche pas un compte désactivé ou restauré', async (t) => {
  const { app, base, db, teacherId } = await site(t);
  addAccount(db, { email: 'desactive@example.org', hash: HASH, disabledAt: '2020-01-01' });
  const admin = await loggedIn(base, ADMIN);
  await deleteAccount(admin, teacherId);
  deletedDaysAgo(db, teacherId, 100);
  await admin.post(`/api/admin/teachers/${teacherId}/restore`);
  app.purge();
  assert.ok(accountOf(db, TEACHER));
  assert.ok(accountOf(db, 'desactive@example.org'));
});

test('ADM-10 : supprimer deux fois ne repousse pas l’effacement', async (t) => {
  const { base, db, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  await deleteAccount(admin, teacherId);
  db.exec("UPDATE accounts SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE role = 'teacher'");
  const again = await admin.post(`/api/admin/teachers/${teacherId}/delete`, WORD);
  assert.equal(again.json().deletedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(again.json().eraseAt, '2020-01-15T00:00:00.000Z');
});

test('ADM-10 : un compte supprimé ne se réactive pas et ne reçoit aucun lien sans être restauré', async (t) => {
  const { base, db, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  await deleteAccount(admin, teacherId);
  const enable = await admin.post(`/api/admin/teachers/${teacherId}/enable`);
  assert.equal(enable.status, 409);
  assert.equal(enable.text, "Ce compte est supprimé : restaurez-le d'abord.");
  assert.equal((await admin.post(`/api/admin/teachers/${teacherId}/reset`)).status, 409);
  assert.ok(accountOf(db, TEACHER).disabled_at, 'il reste désactivé');
});

test('ADM-10 : un compte actif ne peut pas être supprimé, même avec le mot', async (t) => {
  const { base, db, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  const r = await admin.post(`/api/admin/teachers/${teacherId}/delete`, WORD);
  assert.equal(r.status, 409);
  assert.equal(r.text, 'Désactivez ce compte avant de le supprimer.');
  assert.equal(accountOf(db, TEACHER).deleted_at, null);
});

test('ADM-10 : un compte réactivé redevient impossible à supprimer', async (t) => {
  const { base, db, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${teacherId}/disable`);
  await admin.post(`/api/admin/teachers/${teacherId}/enable`);
  assert.equal((await admin.post(`/api/admin/teachers/${teacherId}/delete`, WORD)).status, 409);
  assert.equal(accountOf(db, TEACHER).deleted_at, null);
});

test('ADM-10 : sans le mot exact, le serveur ne supprime rien', async (t) => {
  const { base, db, teacherId } = await site(t);
  const admin = await loggedIn(base, ADMIN);
  await admin.post(`/api/admin/teachers/${teacherId}/disable`);
  const target = `/api/admin/teachers/${teacherId}/delete`;
  for (const body of [{}, { word: '' }, { word: 'supprimer' }, { word: ' SUPPRIMER' }, { word: 'SUPPRIME' }, { word: 12 }, { word: ['SUPPRIMER'] }]) {
    const r = await admin.post(target, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.text, 'Recopiez le mot SUPPRIMER pour confirmer.');
  }
  assert.equal((await admin.raw('POST', target)).status, 400, 'corps absent');
  assert.equal((await admin.post(target, ['SUPPRIMER'])).status, 400, 'corps qui n’est pas un objet');
  assert.equal(accountOf(db, TEACHER).deleted_at, null);
});

test('ADM-10 : seul l’admin peut supprimer ou restaurer, et seulement un enseignant', async (t) => {
  const { base, db, adminId } = await site(t);
  const disabledId = addAccount(db, { email: 'desactive@example.org', hash: HASH, disabledAt: '2026-01-01' });
  const deletedId = addAccount(db, { email: 'supprime@example.org', hash: HASH, disabledAt: '2026-01-01' });
  deletedDaysAgo(db, deletedId, 1);
  const remove = `/api/admin/teachers/${disabledId}/delete`;
  const restore = `/api/admin/teachers/${deletedId}/restore`;

  assert.equal((await client(base).post(remove, WORD)).status, 401, 'sans session');
  assert.equal((await client(base).post(restore)).status, 401, 'sans session');
  const teacher = await loggedIn(base, TEACHER);
  assert.equal((await teacher.post(remove, WORD)).status, 403, 'un enseignant');
  assert.equal((await teacher.post(restore)).status, 403, 'un enseignant');
  const admin = await loggedIn(base, ADMIN);
  const elsewhere = { Origin: 'https://ailleurs.example.org' };
  assert.equal((await admin.post(remove, WORD, elsewhere)).status, 403, 'depuis un autre site');
  assert.equal((await admin.post(restore, {}, elsewhere)).status, 403, 'depuis un autre site');
  assert.equal((await admin.post(`/api/admin/teachers/${adminId}/delete`, WORD)).status, 404, 'pas son propre compte');
  assert.equal((await admin.post('/api/admin/teachers/absent/delete', WORD)).status, 404);
  assert.equal((await admin.post('/api/admin/teachers/absent/restore')).status, 404);
  assert.notEqual((await admin.get(remove)).status, 200, 'une simple visite ne supprime rien');

  assert.equal(accountOf(db, 'desactive@example.org').deleted_at, null, 'rien n’est supprimé par ces essais');
  assert.ok(accountOf(db, 'supprime@example.org').deleted_at, 'rien n’est restauré par ces essais');
  assert.equal(accountOf(db, ADMIN).deleted_at, null);
});

test('ADM-10 : l’adresse reste prise jusqu’à l’effacement, puis plus rien ne subsiste de l’ancien compte', async (t) => {
  const { app, base, db, teacherId } = await site(t);
  addEverything(db, teacherId, 'A');
  const { link } = await resetLink(base, teacherId);
  const session = await loggedIn(base, TEACHER);
  const admin = await loggedIn(base, ADMIN);
  await deleteAccount(admin, teacherId);
  assert.equal((await session.get('/api/auth/me')).status, 401);

  const first = (await admin.post('/api/admin/invites')).json();
  const taken = await client(base).post('/api/auth/invite', { token: tokenOf(first.link), email: TEACHER, password: OTHER_PASSWORD });
  assert.equal(taken.status, 409, 'pendant les 14 jours');

  deletedDaysAgo(db, teacherId, 15);
  app.purge();
  const login = await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD });
  assert.equal(login.status, 401, 'comme une adresse inconnue');
  assert.equal(login.text, BAD_LOGIN);
  assert.equal((await client(base).post('/api/auth/reset', { token: tokenOf(link), password: OTHER_PASSWORD })).status, 410);
  assert.equal((await admin.post(`/api/admin/teachers/${teacherId}/restore`)).status, 404, 'trop tard pour restaurer');

  const second = (await admin.post('/api/admin/invites')).json();
  assert.equal((await client(base).post('/api/auth/invite', { token: tokenOf(second.link), email: TEACHER, password: OTHER_PASSWORD })).status, 200);
  assert.notEqual(accountOf(db, TEACHER).id, teacherId, 'c’est un nouveau compte');
  assert.equal(count(db, 'courses'), 0, 'qui ne retrouve rien de l’ancien');
});

/* --- Changer son mot de passe --- */

test('changer son mot de passe exige une session et le mot de passe actuel', async (t) => {
  const { base, db } = await site(t);
  assert.equal((await client(base).post('/api/auth/password', { current: PASSWORD, password: OTHER_PASSWORD })).status, 401);
  const browser = await loggedIn(base, TEACHER);
  for (const current of ['mauvais-mot-de-passe', undefined, 12, 'x'.repeat(201)]) {
    const r = await browser.post('/api/auth/password', { current, password: OTHER_PASSWORD });
    assert.equal(r.status, 403, String(current));
    assert.equal(r.text, 'Mot de passe actuel incorrect.');
  }
  assert.equal((await browser.post('/api/auth/password', { current: PASSWORD, password: 'court' })).status, 400);
  assert.equal(accountOf(db, TEACHER).password_hash, HASH);
});

test('changer son mot de passe ferme ses autres sessions, pas la sienne', async (t) => {
  const { base } = await site(t);
  const here = await loggedIn(base, TEACHER);
  const elsewhere = await loggedIn(base, TEACHER);
  assert.equal((await here.post('/api/auth/password', { current: PASSWORD, password: OTHER_PASSWORD })).status, 200);
  assert.equal((await here.get('/api/auth/me')).status, 200);
  assert.equal((await elsewhere.get('/api/auth/me')).status, 401);
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: PASSWORD })).status, 401);
  assert.equal((await client(base).post('/api/auth/login', { email: TEACHER, password: OTHER_PASSWORD })).status, 200);
});

test('une session volée ne permet pas d’essayer le mot de passe actuel sans limite', async (t) => {
  const { base } = await site(t);
  const stolen = await loggedIn(base, TEACHER);
  for (let i = 0; i < 10; i++)
    assert.equal((await stolen.post('/api/auth/password', { current: 'mauvais-mot-de-passe', password: OTHER_PASSWORD })).status, 403);
  assert.equal((await stolen.post('/api/auth/password', { current: PASSWORD, password: OTHER_PASSWORD })).status, 429);
});

/* --- Nettoyage et pages --- */

test('le nettoyage oublie les sessions expirées et les liens périmés, pas le reste', async (t) => {
  const { app, base, db, teacherId } = await site(t);
  const live = await loggedIn(base, TEACHER);
  db.exec(`INSERT INTO sessions VALUES ('expiree', '${teacherId}', '2020-01-01T00:00:00.000Z')`);
  await invite(base);
  db.exec("INSERT INTO links (token_hash, kind, expires_at, created_at) VALUES ('perime', 'invite', '2020-01-01T00:00:00.000Z', 'd')");
  db.exec("INSERT INTO links (token_hash, kind, expires_at, used_at, created_at) VALUES ('utilise', 'invite', '2099-01-01T00:00:00.000Z', 'd', 'd')");
  app.purge();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'expiree'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM links WHERE token_hash IN ('perime', 'utilise')").get().n, 0);
  assert.equal(count(db, 'links'), 1, 'le lien valable reste');
  assert.equal((await live.get('/api/auth/me')).status, 200);
});

test('chaque espace a sa page, sans mise en cache durable', async (t) => {
  const { base, root } = await startApp(t);
  for (const name of ['prof', 'admin', 'compte']) await writeFile(path.join(root, name + '.html'), `<title>${name}</title>`);
  const pages = { '/prof': 'prof', '/admin': 'admin', '/invitation': 'compte', '/reinitialisation': 'compte' };
  for (const [route, name] of Object.entries(pages)) {
    const r = await request(base, route);
    assert.equal(r.status, 200, route);
    assert.equal(r.body.toString(), `<title>${name}</title>`, route);
    assert.equal(r.headers['cache-control'], 'no-cache', route);
  }
});

test('les robots sont priés de ne pas indexer le site', async (t) => {
  const { base } = await startApp(t);
  const r = await request(base, '/robots.txt');
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), 'User-agent: *\nDisallow: /\n');
});
