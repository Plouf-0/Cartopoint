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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/** En dessous, la compression ne fait rien gagner. Les photos, déjà compressées, restent telles quelles. */
const MIN_GZIP = 1024;
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg\+xml)/;

/** Un objet au sens de JSON : ni null, ni une liste. */
export const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Une réponse qui ne regarde qu'une personne : personne ne la garde en cache. */
export const PRIVATE = { cache: 'no-store' };

/** Erreur à transmettre telle quelle au client. Les autres donnent un 500 sans détail. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Ce que le navigateur a le droit de charger (SEC-06). Les pages construites portent leur code en ligne : chacune
 * n'autorise que l'empreinte de ses propres scripts, donc rien de ce qu'on y injecterait, ni un `onerror=`.
 * Les styles en ligne restent permis : les écrans s'en servent, et ils n'exécutent rien.
 */
const contentPolicy = (scripts = []) =>
  [
    "default-src 'self'",
    ["script-src 'self'", ...scripts.map((script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');

const pagePolicies = new Map();

/** La règle d'une page, recalculée seulement quand le fichier change. */
async function pagePolicy(file, stat) {
  const version = `${stat.size}-${stat.mtimeMs}`;
  const known = pagePolicies.get(file);
  if (known?.version === version) return known.policy;
  const html = await fs.readFile(file, 'utf8');
  const policy = contentPolicy([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]));
  pagePolicies.set(file, { version, policy });
  return policy;
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

/**
 * Lit l'en-tête Range : `{ start, end }`, null s'il faut envoyer tout le fichier, ou false si la plage est impossible.
 * Une seule plage : c'est ce que demandent les navigateurs pour une vidéo, et Safari ne la lit pas autrement.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end ? { start, end } : false;
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
  if (type.startsWith('text/html')) headers['Content-Security-Policy'] = await pagePolicy(file, stat);
  if (isFresh(req, headers.ETag)) return notModified(res, headers);

  if (!compressible) {
    headers['Accept-Ranges'] = 'bytes';
    const range = parseRange(req.headers.range, stat.size);
    if (range === false) return send(res, 416, 'Plage impossible', undefined, { 'Content-Range': `bytes */${stat.size}` });
    if (range) {
      res.writeHead(206, {
        ...headers,
        'Content-Type': type,
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Content-Length': range.end - range.start + 1
      });
      if (req.method === 'HEAD') return res.end();
      return pipeFile(createReadStream(file, range), res);
    }
  }

  const compress = compressible && acceptsGzip(req);
  res.writeHead(200, {
    ...headers,
    'Content-Type': type,
    ...(compress ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': stat.size })
  });
  if (req.method === 'HEAD') return res.end();
  return compress ? pipeFile(createReadStream(file), createGzip(), res) : pipeFile(createReadStream(file), res);
}

async function pipeFile(...streams) {
  try {
    await pipeline(...streams);
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
    const file = inside(root, url.pathname);
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
  if (!isObject(value)) throw new HttpError(400, 'Requête invalide');
  return value;
}

/** Routes de la forme « /courses/:id » ou « /media/:file.png ». HEAD suit les routes GET. */
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
    // Le service worker et un fichier ouvert seul sont aussi concernés. Une page remplace cette règle par la sienne
    res.setHeader('Content-Security-Policy', contentPolicy());
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
