/**
 * Socle HTTP, sans dépendance : routage, lecture du corps, réponses et fichiers statiques.
 *
 * Les fichiers et le JSON portent un ETag (réponse 304 si le client a déjà cette version) et
 * partent compressés en gzip quand le navigateur l'accepte.
 */
import { createHash } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGzip, gzip } from 'node:zlib';

const gzipBuffer = promisify(gzip);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/** En dessous, la compression ne fait rien gagner. Les photos, déjà compressées, restent telles quelles. */
const MIN_GZIP = 1024;
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg\+xml)/;

/** Erreur à transmettre telle quelle au client. Les autres donnent un 500 sans détail. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

/** Le client a-t-il déjà cette version ? Comparaison faible, comme le veut If-None-Match. */
function isFresh(req, etag) {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  if (header.trim() === '*') return true;
  const opaque = (tag) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => opaque(tag) === opaque(etag));
}

function acceptsGzip(req) {
  return (req.headers['accept-encoding'] || '').split(',').some((item) => {
    const [name, ...params] = item.split(';').map((part) => part.trim());
    if (name.toLowerCase() !== 'gzip') return false;
    const q = params.find((param) => param.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

function notModified(res, headers) {
  res.writeHead(304, headers);
  res.end();
}

/** Réponse JSON. Seule une lecture réussie porte un ETag. */
export async function sendJson(req, res, value, { status = 200, cache = 'no-cache' } = {}) {
  const body = Buffer.from(JSON.stringify(value));
  const compressible = body.length >= MIN_GZIP;
  const headers = { 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', ...(compressible ? { Vary: 'Accept-Encoding' } : {}) };
  if (status === 200 && (req.method === 'GET' || req.method === 'HEAD')) {
    headers.ETag = `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
    if (isFresh(req, headers.ETag)) return notModified(res, headers);
  }
  const compress = compressible && acceptsGzip(req);
  const payload = compress ? await gzipBuffer(body) : body;
  res.writeHead(status, {
    ...headers,
    'Content-Type': TYPES['.json'],
    'Content-Length': payload.length,
    ...(compress ? { 'Content-Encoding': 'gzip' } : {})
  });
  res.end(payload);
}

export async function sendFile(req, res, file, cache) {
  let stat;
  try {
    stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error();
  } catch {
    return send(res, 404, 'Introuvable');
  }
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const compressible = COMPRESSIBLE.test(type) && stat.size >= MIN_GZIP;
  const headers = {
    'Cache-Control': cache,
    ETag: `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`,
    'X-Content-Type-Options': 'nosniff',
    ...(compressible ? { Vary: 'Accept-Encoding' } : {})
  };
  if (isFresh(req, headers.ETag)) return notModified(res, headers);

  const compress = compressible && acceptsGzip(req);
  res.writeHead(200, {
    ...headers,
    'Content-Type': type,
    ...(compress ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': stat.size })
  });
  if (req.method === 'HEAD') return res.end();
  try {
    await (compress ? pipeline(createReadStream(file), createGzip(), res) : pipeline(createReadStream(file), res));
  } catch {
    /* client parti en cours de route : pipeline a déjà fermé la connexion */
  }
}

/** Chemin sûr à l'intérieur de `base` (refuse les « ../ »), ou null. */
function inside(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const p = path.resolve(base, '.' + path.posix.normalize('/' + decoded));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

/** Sert les fichiers de `root`. Les pages sont revalidées à chaque fois, le reste gardé une heure. */
/** Le code de la page : ses noms ne changent pas d'une version à l'autre, et un 304 ne coûte presque rien. */
const ALWAYS_REVALIDATED = new Set(['.html', '.js', '.css']);

export function staticFiles(root) {
  return (req, res, { url }) => {
    const p = url.pathname;
    const file = inside(root, p.endsWith('/') ? p + 'index.html' : p);
    if (!file) return send(res, 400, 'Chemin invalide');
    return sendFile(req, res, file, ALWAYS_REVALIDATED.has(path.extname(file)) ? 'no-cache' : 'public, max-age=3600');
  };
}

/** Lit le corps de la requête. Au-delà de la limite, le reste est lu sans être gardé : le client reçoit bien le 413. */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) return chunks.push(chunk);
      chunks.length = 0;
      reject(new HttpError(413, 'trop volumineux'));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Lit un objet JSON dans le corps de la requête. */
export async function readJson(req, maxBytes = 64 * 1024) {
  const body = await readBody(req, maxBytes);
  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Requête invalide');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Requête invalide');
  return value;
}

/** Routes de la forme « /courses/:id » ou « /projets/:name.json ». HEAD suit les routes GET. */
export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      const keys = [];
      const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, key) => (keys.push(key), '([^/]+)'));
      routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler });
      return this;
    },
    find(method, pathname) {
      const allow = new Set();
      for (const route of routes) {
        const match = pathname.match(route.regex);
        if (!match) continue;
        if (route.method === method || (route.method === 'GET' && method === 'HEAD')) {
          const params = {};
          route.keys.forEach((key, i) => (params[key] = decodeParam(match[i + 1])));
          return { handler: route.handler, params };
        }
        allow.add(route.method);
        if (route.method === 'GET') allow.add('HEAD');
      }
      return { allow: [...allow] };
    }
  };
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Chemin invalide');
  }
}

function parseUrl(req) {
  try {
    return new URL(req.url, 'http://localhost');
  } catch {
    throw new HttpError(400, 'Adresse invalide');
  }
}

/** Fonction à donner à http.createServer. `fallback` reçoit les GET et HEAD qu'aucune route n'a pris. */
export function createHandler(router, fallback) {
  return async (req, res) => {
    try {
      const url = parseUrl(req);
      const { handler, params, allow } = router.find(req.method, url.pathname);
      if (handler) return await handler(req, res, { url, params });
      const readable = req.method === 'GET' || req.method === 'HEAD';
      if (allow.length || (fallback && !readable)) {
        return send(res, 405, 'Méthode non autorisée', undefined, { Allow: allow.length ? allow.join(', ') : 'GET, HEAD' });
      }
      if (fallback) return await fallback(req, res, { url });
      return send(res, 404, 'Introuvable');
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return send(res, e.status, e.message);
      console.error(e);
      return send(res, 500, 'Erreur du serveur');
    }
  };
}
