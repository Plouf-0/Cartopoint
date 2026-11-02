/**
 * Adresse du client et limites d'essais.
 *
 * Derrière un proxy, le serveur ne voit que l'adresse du proxy : sans TRUST_PROXY, dix erreurs
 * de n'importe qui bloqueraient tout le monde (E-04).
 */

/** Au-delà de ce nombre de clés suivies, les essais expirés sont oubliés. */
const PURGE_ABOVE = 10000;

/**
 * Adresse IP du client. Seule la dernière valeur de X-Forwarded-For est sûre : c'est celle que le
 * proxy a ajoutée, les précédentes viennent du client, qui peut y écrire ce qu'il veut.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const last = (req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return last;
  }
  return req.socket.remoteAddress;
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
    }
  };
}
