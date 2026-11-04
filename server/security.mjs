/**
 * Adresse du client, origine des requêtes et limites d'essais.
 *
 * Derrière un proxy, le serveur ne voit que l'adresse du proxy : sans TRUST_PROXY, dix erreurs
 * de n'importe qui bloqueraient tout le monde (E-04).
 */
import { BlockList, isIP } from 'node:net';
import { HttpError } from './http.mjs';

/** Au-delà de ce nombre de clés suivies, les essais expirés sont oubliés. */
const PURGE_ABOVE = 10000;

const lastValue = (header) => (header || '').split(',').pop().trim();

/**
 * Les serveurs de Cloudflare, relevés le 4 novembre 2026 sur https://www.cloudflare.com/ips/. Si la liste vieillit, rien ne s'ouvre : un
 * nouveau serveur est traité comme un client ordinaire, et ceux qui passent par lui partagent seulement un même compteur d'échecs.
 */
const CLOUDFLARE = new BlockList();
const CLOUDFLARE_RANGES = {
  ipv4: [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22'
  ],
  ipv6: ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']
};
for (const [family, ranges] of Object.entries(CLOUDFLARE_RANGES)) {
  for (const range of ranges) {
    const [network, prefix] = range.split('/');
    CLOUDFLARE.addSubnet(network, Number(prefix), family);
  }
}
const fromCloudflare = (ip) => {
  const family = isIP(ip);
  return family !== 0 && CLOUDFLARE.check(ip, family === 6 ? 'ipv6' : 'ipv4');
};

/** Un abonné IPv6 dispose de tout un bloc /64 : compter adresse par adresse lui donnerait des milliards d'essais. */
function sameSubscriber(ip) {
  if (isIP(ip) !== 6) return ip;
  if (/^::ffff:/i.test(ip)) return ip.slice(7);
  const [head, tail] = ip.toLowerCase().split('::');
  const start = head.split(':').filter(Boolean);
  const end = (tail ?? '').split(':').filter(Boolean);
  return [...start, ...Array(8 - start.length - end.length).fill('0'), ...end].slice(0, 4).join(':');
}

/**
 * De quel client vient la requête, pour les limites d'essais. Seule la dernière valeur de X-Forwarded-For est sûre : c'est celle que le
 * proxy a ajoutée, les précédentes viennent du client, qui peut y écrire ce qu'il veut.
 *
 * Derrière Cloudflare, cette valeur est l'un de ses serveurs, partagé par des inconnus : le visiteur est dans CF-Connecting-IP. N'importe
 * qui peut écrire cet en-tête en s'adressant directement au serveur, donc il ne compte que si la requête vient bien de Cloudflare.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const last = lastValue(req.headers['x-forwarded-for']);
    if (last) {
      const visitor = req.headers['cf-connecting-ip'];
      return sameSubscriber(fromCloudflare(last) && isIP(visitor) ? visitor : last);
    }
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
