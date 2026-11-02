/**
 * Adresse du client, origine des requêtes et limites d'essais.
 *
 * Derrière un proxy, le serveur ne voit que l'adresse du proxy : sans TRUST_PROXY, dix erreurs
 * de n'importe qui bloqueraient tout le monde (E-04).
 */
import { HttpError } from './http.mjs';

/** Au-delà de ce nombre de clés suivies, les essais expirés sont oubliés. */
const PURGE_ABOVE = 10000;

const lastValue = (header) => (header || '').split(',').pop().trim();

/**
 * Adresse IP du client. Seule la dernière valeur de X-Forwarded-For est sûre : c'est celle que le
 * proxy a ajoutée, les précédentes viennent du client, qui peut y écrire ce qu'il veut.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const last = lastValue(req.headers['x-forwarded-for']);
    if (last) return last;
  }
  return req.socket.remoteAddress;
}

/** La requête est-elle arrivée en HTTPS ? Le serveur parle HTTP : seul le proxy peut le dire. */
export function isHttps(req, trustProxy) {
  return trustProxy && lastValue(req.headers['x-forwarded-proto']) === 'https';
}

/** Les navigateurs envoient Origin sur toute écriture : son absence ou une autre adresse est refusée. */
export function isSameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Protège une route qui écrit avec le cookie de session contre les requêtes venues d'un autre site. */
export function sameOriginOnly(handler) {
  return (req, res, context) => {
    if (!isSameOrigin(req)) throw new HttpError(403, 'Origine de la requête refusée.');
    return handler(req, res, context);
  };
}

/** Bloque une clé après `max` échecs, jusqu'à `windowMs` après le dernier d'entre eux. */
export function createLimiter({ max, windowMs, now = Date.now }) {
  const entries = new Map(); // clé → { count, until }
  return {
    get size() {
      return entries.size;
    },
    blocked(key) {
      const entry = entries.get(key);
      return Boolean(entry && entry.count >= max && entry.until > now());
    },
    fail(key) {
      const entry = entries.get(key);
      const fresh = !entry || entry.until < now();
      entries.set(key, { count: fresh ? 1 : entry.count + 1, until: now() + windowMs });
      if (entries.size > PURGE_ABOVE) {
        for (const [k, e] of entries) if (e.until < now()) entries.delete(k);
      }
    },
    /** Oublie les échecs d'une clé. */
    clear(key) {
      entries.delete(key);
    },
    /** Retire un échec, compté d'avance alors que l'essai a finalement réussi. */
    forgive(key) {
      const entry = entries.get(key);
      if (entry) entry.count = Math.max(0, entry.count - 1);
    }
  };
}
