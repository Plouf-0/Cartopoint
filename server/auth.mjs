/**
 * Comptes : mots de passe, sessions, liens à usage unique et contrôle des rôles.
 *
 * Sessions et liens reposent sur un jeton aléatoire dont seule l'empreinte est en base : une copie
 * de la base ne donne accès à rien. Le jeton d'un lien voyage dans le fragment de l'adresse, puis
 * dans le corps de la requête : il n'apparaît donc jamais dans le journal du proxy.
 */
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { transaction } from './db.mjs';
import { HttpError } from './http.mjs';
import { isHttps } from './security.mjs';

const scryptAsync = promisify(scrypt);
const COST = { N: 2 ** 15, r: 8, p: 1 };
const MAX_MEMORY = 64 * 1024 * 1024;
const KEY_LENGTH = 32;

const DAY = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME = 30 * DAY;
const INVITE_LIFETIME = 7 * DAY;
const RESET_LIFETIME = 3 * DAY;

const COOKIE = 'session';
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const DEAD_LINK = "Ce lien n'est plus valable. Demandez-en un nouveau.";

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { ...COST, maxmem: MAX_MEMORY });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Les réglages sont lus dans l'empreinte : on pourra les durcir sans invalider les anciens mots de passe. */
export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, key] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: MAX_MEMORY });
  return timingSafeEqual(actual, expected);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new HttpError(400, 'Le mot de passe doit contenir entre 8 et 200 caractères.');
  }
}

export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (email.length > 254 || !EMAIL.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  return email;
}

function insertAccount(db, email, passwordHash, role) {
  const id = randomUUID();
  db.prepare('INSERT INTO accounts (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, email, passwordHash, role, iso());
  return id;
}

/**
 * Crée l'admin au premier démarrage, depuis ADMIN_EMAIL et ADMIN_PASSWORD (ADM-01). Sans elles, il n'y a
 * pas d'admin : le premier visiteur venu ne doit jamais pouvoir prendre ce rôle.
 * Renvoie 'exists', 'missing', 'invalid' ou 'created'.
 */
export async function ensureAdmin(db, { email, password } = {}) {
  if (db.prepare("SELECT 1 FROM accounts WHERE role = 'admin'").get()) return 'exists';
  if (!email || !password) return 'missing';
  let address;
  try {
    address = normalizeEmail(email);
    validatePassword(password);
  } catch {
    return 'invalid';
  }
  if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(address)) return 'invalid';
  insertAccount(db, address, await hashPassword(password), 'admin');
  return 'created';
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export function createAuth(db, { trustProxy = false } = {}) {
  /** Empreinte comparée quand le compte n'existe pas : la durée de la réponse ne le trahit pas. */
  let decoy;

  const accountById = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  const accountByEmail = (email) => db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);

  const cookie = (req, value, maxAge) =>
    `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req, trustProxy) ? '; Secure' : ''}`;

  const sessionHash = (req) => hashToken(readCookie(req, COOKIE));

  function createLink(kind, accountId, lifetime, page) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = iso(Date.now() + lifetime);
    db.prepare('INSERT INTO links (token_hash, kind, account_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
      hashToken(token),
      kind,
      accountId,
      expiresAt,
      iso()
    );
    return { link: `/${page}#${token}`, expiresAt };
  }

  /** Vérification sans effet, pour ne pas lancer un calcul de mot de passe sur un jeton fantaisiste. */
  function requireLiveLink(token, kind) {
    const live = db.prepare('SELECT 1 FROM links WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?').get(hashToken(token), kind, iso());
    if (!live) throw new HttpError(410, DEAD_LINK);
  }

  /** Utilise le lien, dans une transaction : même deux requêtes simultanées ne l'utilisent qu'une fois. */
  function consumeLink(token, kind) {
    const row = db
      .prepare('UPDATE links SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING account_id')
      .get(iso(), hashToken(token), kind, iso());
    if (!row) throw new HttpError(410, DEAD_LINK);
    return row.account_id;
  }

  return {
    /** Le compte si les identifiants sont bons, même désactivé : c'est à l'appelant de le refuser. */
    async checkCredentials(email, password) {
      const account = accountByEmail(email);
      decoy ??= hashPassword(randomBytes(16).toString('hex'));
      const valid = await verifyPassword(password, account?.password_hash ?? (await decoy));
      return valid && account ? account : null;
    },

    startSession(req, res, accountId) {
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)').run(
        hashToken(token),
        accountId,
        iso(Date.now() + SESSION_LIFETIME)
      );
      db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(iso(), accountId);
      res.setHeader('Set-Cookie', cookie(req, token, SESSION_LIFETIME / 1000));
    },

    endSession(req, res) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash(req));
      res.setHeader('Set-Cookie', cookie(req, '', 0));
    },

    currentAccount(req) {
      return db
        .prepare(
          `SELECT accounts.* FROM sessions JOIN accounts ON accounts.id = sessions.account_id
           WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND accounts.disabled_at IS NULL`
        )
        .get(sessionHash(req), iso());
    },

    requireAccount(req) {
      const account = this.currentAccount(req);
      if (!account) throw new HttpError(401, 'Connexion requise.');
      return account;
    },

    requireRole(req, role) {
      const account = this.requireAccount(req);
      if (account.role !== role) throw new HttpError(403, 'Accès refusé.');
      return account;
    },

    /** Nouveau mot de passe choisi par son titulaire : ses autres sessions sont fermées. */
    async changePassword(req, account, password) {
      validatePassword(password);
      const hash = await hashPassword(password);
      transaction(db, () => {
        db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, account.id);
        db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?').run(account.id, sessionHash(req));
      });
    },

    createInvite() {
      return createLink('invite', null, INVITE_LIFETIME, 'invitation');
    },

    /** Un nouveau lien annule ceux qui n'ont pas encore servi. */
    createReset(accountId) {
      return transaction(db, () => {
        db.prepare("DELETE FROM links WHERE account_id = ? AND kind = 'reset' AND used_at IS NULL").run(accountId);
        return createLink('reset', accountId, RESET_LIFETIME, 'reinitialisation');
      });
    },

    async acceptInvite(token, email, password) {
      requireLiveLink(token, 'invite');
      const address = normalizeEmail(email);
      validatePassword(password);
      const hash = await hashPassword(password);
      return transaction(db, () => {
        consumeLink(token, 'invite');
        if (accountByEmail(address)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse.');
        return accountById(insertAccount(db, address, hash, 'teacher'));
      });
    },

    async acceptReset(token, password) {
      requireLiveLink(token, 'reset');
      validatePassword(password);
      const hash = await hashPassword(password);
      return transaction(db, () => {
        const account = accountById(consumeLink(token, 'reset'));
        if (account.disabled_at) throw new HttpError(410, DEAD_LINK);
        db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, account.id);
        db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id);
        return account;
      });
    },

    teacherById(id) {
      return db.prepare("SELECT * FROM accounts WHERE id = ? AND role = 'teacher'").get(id);
    },

    listTeachers() {
      return db.prepare("SELECT * FROM accounts WHERE role = 'teacher' ORDER BY email COLLATE NOCASE").all();
    },

    /** Un compte désactivé perd ses sessions tout de suite, et garde ses cours (ADM-06). */
    disable(id) {
      transaction(db, () => {
        db.prepare('UPDATE accounts SET disabled_at = COALESCE(disabled_at, ?) WHERE id = ?').run(iso(), id);
        db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
      });
    },

    enable(id) {
      db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ?').run(id);
    },

    /** Définitif : les clés étrangères emportent ses sessions, ses liens, ses cours et leur historique (ADM-10). */
    remove(id) {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    },

    /** Oublie les sessions expirées et les liens qui ne peuvent plus servir. */
    purge() {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso());
      db.prepare('DELETE FROM links WHERE expires_at <= ? OR used_at IS NOT NULL').run(iso());
    }
  };
}
