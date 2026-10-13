/**
 * Stockage dans le navigateur (IndexedDB).
 *
 * Base « inventaire-botanique » :
 *   meta      clé → valeur   ('project' : métadonnées du projet, sans les cartes)
 *   maps      une carte par enregistrement (avec ses fiches), clé = id
 *   files     photos et vidéos des fiches (Blob), clé = media.key
 *   progress  travail des élèves, clé = `${projectId}/${mapId}`
 *
 * Les données restent sur l'ordinateur de l'utilisateur : rien n'est envoyé à un serveur.
 */
import { blobToDataURL } from './util.js';

const DB_NAME = 'inventaire-botanique';
const DB_VERSION = 1;
let db = null;

function open(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    if (upgrade) r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('base de données bloquée par un autre onglet'));
  });
}

/** Ouvre (et crée si besoin) la base de l'application. */
export async function openDb() {
  db = await open(DB_NAME, DB_VERSION, (d) => {
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    if (!d.objectStoreNames.contains('maps')) d.createObjectStore('maps', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    if (!d.objectStoreNames.contains('progress')) d.createObjectStore('progress');
  });
  return db;
}

/** Exécute une opération dans une transaction et attend sa fin. */
function run(store, mode, fn, database = db) {
  return new Promise((resolve, reject) => {
    const t = database.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction annulée (espace disque plein ?)'));
  });
}

const kv = (store) => ({
  get: (k) => run(store, 'readonly', (s) => s.get(k)),
  put: (k, v) => run(store, 'readwrite', (s) => s.put(v, k)),
  del: (k) => run(store, 'readwrite', (s) => s.delete(k)),
  clear: () => run(store, 'readwrite', (s) => s.clear())
});

export const Meta = kv('meta');
export const Files = kv('files');
export const Progress = kv('progress');
export const Maps = {
  all: () => run('maps', 'readonly', (s) => s.getAll()),
  put: (m) => run('maps', 'readwrite', (s) => s.put(m)),
  del: (id) => run('maps', 'readwrite', (s) => s.delete(id)),
  clear: () => run('maps', 'readwrite', (s) => s.clear())
};

/* ------------------------------------------------------------------ */
/* Lecture des données des anciennes versions (fichiers v2 de 2026)     */
/* ------------------------------------------------------------------ */

async function databaseExists(name) {
  if (!indexedDB.databases) return true; // on ne peut pas savoir : on tente l'ouverture
  return (await indexedDB.databases()).some((d) => d.name === name);
}

/**
 * Renvoie le projet enregistré par l'ancienne version de l'application dans ce
 * navigateur (au format v2, photos converties en URL data:), ou null.
 * Les anciennes bases ne sont pas supprimées.
 */
export async function readLegacyProject(prefs) {
  if (!(await databaseExists('botMapMapsV37'))) return null;
  const mapsDb = await open('botMapMapsV37', 1, (d) => {
    if (!d.objectStoreNames.contains('maps')) d.createObjectStore('maps', { keyPath: 'id' });
  });
  const maps = await run('maps', 'readonly', (s) => s.getAll(), mapsDb);
  mapsDb.close();
  if (!maps?.length || !maps.some((m) => (m.locations || []).length)) return null;

  let filesDb = null;
  if (await databaseExists('BotanicalMapDB')) {
    filesDb = await open('BotanicalMapDB', 1, (d) => {
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    });
  }
  for (const m of maps) {
    for (const l of m.locations || []) {
      for (const md of l.media || []) {
        if (!md.key || !filesDb) continue;
        const blob = await run('files', 'readonly', (s) => s.get(md.key), filesDb).catch(() => null);
        if (blob) md.data = await blobToDataURL(blob);
        delete md.key;
      }
    }
  }
  filesDb?.close();
  const current = prefs.get('botMapCurrentV37');
  return {
    format: 'inventaire-botanique',
    version: 2,
    title: prefs.get('botMapPageTitle') || undefined,
    passwordHash: prefs.get('botMapPwHash') || null,
    aiEndpoint: prefs.get('v37AiEndpoint') || '',
    currentMapId: current,
    maps
  };
}
