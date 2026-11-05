/**
 * Journal des problèmes vus dans les navigateurs (INC-01), pour l'admin. Quand quelque chose échoue chez quelqu'un, on sait ce qui s'est passé
 * et sur quelle machine, sans avoir à le lui demander. La route est ouverte à tous, élèves compris, puisqu'un problème peut arriver avant
 * toute connexion : seuls les champs prévus sont gardés, leur taille est limitée, et le nombre de lignes et d'envois aussi.
 */
import { createHash } from 'node:crypto';
import { HttpError } from './http.mjs';
import { DAY } from './time.mjs';

export const KEEP_DAYS = 90;
const MAX_ROWS = 500;
const SHOWN = 200;
const MAX_PER_MINUTE = 60;
const TEXT_LIMITS = { page: 200, action: 120, reason: 1000, details: 2000 };
const MACHINE_TEXTS = { version: 40, browser: 400, language: 20, screen: 20, window: 20, network: 20 };
const MACHINE_NUMBERS = ['pixelRatio', 'cores', 'memoryGb', 'storageUsed', 'storageQuota'];
const MACHINE_FLAGS = ['online', 'worker'];

const clip = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

/** Ne garde que ce qui est prévu : rien d'autre ne peut entrer dans le journal, quoi que le navigateur envoie. */
function cleanMachine(machine) {
  const clean = {};
  if (!machine || typeof machine !== 'object') return clean;
  for (const [key, limit] of Object.entries(MACHINE_TEXTS)) if (typeof machine[key] === 'string') clean[key] = clip(machine[key], limit);
  for (const key of MACHINE_NUMBERS) if (Number.isFinite(machine[key])) clean[key] = machine[key];
  for (const key of MACHINE_FLAGS) if (typeof machine[key] === 'boolean') clean[key] = machine[key];
  return clean;
}

export function createIncidents(db, { now = Date.now } = {}) {
  let windowStart = 0;
  let sentInWindow = 0;

  /** Une limite pour tout le site : derrière un proxy, plusieurs personnes peuvent partager la même adresse. */
  function tooMany() {
    if (now() - windowStart >= 60000) {
      windowStart = now();
      sentInWindow = 0;
    }
    return ++sentInWindow > MAX_PER_MINUTE;
  }

  const cutoff = () => new Date(now() - KEEP_DAYS * DAY).toISOString();

  return {
    record(report, accountId = null) {
      if (tooMany()) throw new HttpError(429, 'Trop de messages pour le moment.');
      const [page, action, reason, details] = Object.keys(TEXT_LIMITS).map((key) => clip(report?.[key], TEXT_LIMITS[key]));
      if (!action || !reason) throw new HttpError(400, 'Message illisible.');
      const machine = cleanMachine(report.machine);
      // Un message envoyé au retour du réseau date du moment où il s'est produit. On compte en durée : l'horloge d'un téléphone peut être fausse
      const waited = Number.isFinite(report.ageMs) ? Math.min(Math.max(report.ageMs, 0), KEEP_DAYS * DAY) : 0;
      const at = new Date(now() - waited).toISOString();
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([accountId, page, action, reason, machine.browser]))
        .digest('hex');
      db.prepare(
        `INSERT INTO incidents (fingerprint, account_id, page, action, reason, details, machine, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (fingerprint) DO UPDATE SET count = count + 1, last_at = excluded.last_at, machine = excluded.machine, details = excluded.details`
      ).run(fingerprint, accountId, page, action, reason, details, JSON.stringify(machine), at, at);
      db.prepare('DELETE FROM incidents WHERE id NOT IN (SELECT id FROM incidents ORDER BY last_at DESC, id DESC LIMIT ?)').run(MAX_ROWS);
    },

    list() {
      return db
        .prepare(
          `SELECT incidents.*, accounts.email FROM incidents LEFT JOIN accounts ON accounts.id = incidents.account_id
           ORDER BY last_at DESC, incidents.id DESC LIMIT ?`
        )
        .all(SHOWN)
        .map((row) => ({
          id: row.id,
          account: row.email ?? null,
          page: row.page,
          action: row.action,
          reason: row.reason,
          details: row.details,
          machine: JSON.parse(row.machine),
          firstAt: row.first_at,
          lastAt: row.last_at,
          count: row.count
        }));
    },

    clear() {
      db.prepare('DELETE FROM incidents').run();
    },

    purge() {
      db.prepare('DELETE FROM incidents WHERE last_at < ?').run(cutoff());
    }
  };
}
