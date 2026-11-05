/**
 * État de l'application et persistance.
 *
 * `S` contient tout ce qui est affiché. Les vues lisent `S`, modifient les objets,
 * puis appellent les fonctions `changed…()` ci-dessous pour enregistrer, et
 * `render()` (voir render.js) pour rafraîchir l'écran.
 */
import { Meta, Maps, Files, Progress } from './db.js';
import { localBackend } from './backends/local.js';
import { debounce, uid, blobToDataURL, dataURLToBlob, toast, errorText } from './util.js';
import { normalizeProject, normalizeProgress, emptyProgress, placedPos, evaluate, gradeOf, VERSION, FORMAT } from './model.js';

export const S = {
  /** Projet affiché (métadonnées + cartes + fiches). */
  project: null,
  /** Carte affichée. */
  map: null,
  /** Progression des élèves pour chaque carte du projet : mapId → { verified, entries }. */
  progress: {},
  /** Suivi local : modifications non enregistrées, révision d'origine, dernier export. */
  local: { dirty: false, baseRevision: null, lastExport: null },
  /** Mode gestion (enseignant) actif. */
  admin: false,
  /** Espace enseignant en ligne : ni séance, ni mesures, ni mot de passe de gestion. */
  teacherSpace: false,
  /** Page d'un élève : il a cliqué sur Terminer, son travail est figé (HOR-06). */
  finished: false,
  /** Page d'un élève : chaque réponse garde son heure (CRG-13). */
  stampAnswers: false,
  /** Page d'un élève : la correction reçue du serveur, le temps de la page (CRG-08). */
  correction: null,
  /** État d'interface qui n'est pas enregistré. */
  ui: { filter: 'all', query: '', adminQuery: '', tab: 'fiches', placing: null },
  /** Rapport largeur / hauteur de l'image du plan affiché. */
  ratio: 1.16,
  /** Le stockage du navigateur fonctionne-t-il ? */
  storageOk: true
};

/* ------------------------------------------------------------------ */
/* Accès pratiques                                                      */
/* ------------------------------------------------------------------ */

export const fiches = () => S.map?.fiches ?? [];
/** Fiches montrées dans la liste : toutes en gestion, seulement les visibles côté élèves. */
export const listed = () => (S.admin ? fiches() : fiches().filter((f) => f.visible));
export const byId = (id) => fiches().find((f) => f.id === id);
export const progress = () => (S.progress[S.map.id] ??= emptyProgress());
export const verified = () => !!S.map && progress().verified;
/** L'élève ne peut plus rien placer : exercice vérifié (application d'origine) ou travail rendu. */
export const locked = () => !S.admin && (verified() || S.finished);
/** Entrée de progression d'une fiche (créée à la demande si `create`). */
export function entryOf(fiche, create = false) {
  const p = progress();
  if (!p.entries[fiche.id] && create) p.entries[fiche.id] = { x: null, y: null, temperature: '', humidity: '', light: '' };
  return p.entries[fiche.id] || null;
}
export const posOf = (fiche) => placedPos(entryOf(fiche));
/** Note l'heure d'une réponse qui vient de changer, sur la page d'un élève. */
export function stamped(entry) {
  if (S.stampAnswers) entry.at = Date.now();
  return entry;
}
/** Le résultat d'une fiche : celui du serveur une fois la correction reçue (CRG-09), sinon calculé ici (application d'origine). */
export function evaluationOf(fiche) {
  const result = S.correction?.maps[S.map.id]?.fiches[fiche.id];
  if (result) return { ...gradeOf(result.state), ...result };
  return evaluate(fiche, progress().entries[fiche.id], { ratio: S.ratio, widthMeters: S.map.widthMeters });
}

/* ------------------------------------------------------------------ */
/* Enregistrement (regroupé pour ne pas écrire à chaque frappe)         */
/* ------------------------------------------------------------------ */

const pendingMaps = new Set();
const pendingProgress = new Set();
let pendingMeta = false;
let writesInProgress = 0;

/** Où vont les données : ce navigateur par défaut, le serveur dans l'espace enseignant. */
let backend = localBackend;
export function useBackend(next) {
  backend = next;
}

const progressKey = (mapId) => `${S.project.id}/${mapId}`;
const metaRecord = () => {
  const { maps, progress, ...meta } = S.project;
  return { ...meta, mapOrder: maps.map((m) => m.id), local: S.local };
};

/**
 * Écrit ce qui a changé. La liste est vidée avant l'écriture : une modification faite pendant celle-ci n'est pas
 * perdue. Si l'écriture échoue, tout redevient à écrire. Ne rejette jamais : les données restent en mémoire,
 * un export ou une publication peut donc encore aboutir.
 */
async function writeChanges() {
  if (!S.storageOk) return;
  writesInProgress++;
  const mapIds = [...pendingMaps];
  const progressIds = [...pendingProgress];
  const meta = pendingMeta;
  pendingMaps.clear();
  pendingProgress.clear();
  pendingMeta = false;
  try {
    await backend.save({
      maps: mapIds.map((id) => S.project.maps.find((m) => m.id === id)).filter(Boolean),
      progress: progressIds.map((id) => [progressKey(id), S.progress[id] || emptyProgress()]),
      meta: meta ? metaRecord() : null
    });
  } catch (e) {
    mapIds.forEach((id) => pendingMaps.add(id));
    progressIds.forEach((id) => pendingProgress.add(id));
    pendingMeta ||= meta;
    console.error(e);
    if (!backend.reportsErrors) toast('⚠ Enregistrement impossible : ' + errorText(e));
  } finally {
    writesInProgress--;
  }
}

/** Une écriture à la fois : le serveur attend la révision donnée par l'écriture précédente. */
let writing = Promise.resolve();
const writePending = () => (writing = writing.then(writeChanges));
const scheduleWrite = debounce(writePending, 250);

/** Une modification attend-elle encore de partir ? */
export const hasUnsentChanges = () => pendingMaps.size > 0 || pendingMeta;
/** Quitter la page maintenant ferait-il perdre quelque chose ? */
export const hasPendingChanges = () => hasUnsentChanges() || writesInProgress > 0;

/** À appeler après une modification du contenu d'une carte ou de ses fiches (enseignant). */
export function changedMap(map = S.map) {
  pendingMaps.add(map.id);
  setDirty();
  scheduleWrite();
}
/** À appeler après une modification des métadonnées du projet (titre, thème…). */
export function changedMeta() {
  setDirty();
  scheduleWrite();
}
/** À appeler après une modification du travail des élèves (placements, mesures, vérification). */
export function changedProgress(mapId = S.map.id) {
  pendingProgress.add(mapId);
  scheduleWrite();
}
function setDirty() {
  S.local.dirty = true;
  pendingMeta = true;
  backend.onChange?.();
}
/** Force l'écriture immédiate (avant un export, un changement de projet…). */
export const flush = () => scheduleWrite.flush();

/* ------------------------------------------------------------------ */
/* Photos et vidéos                                                     */
/* ------------------------------------------------------------------ */

const urlCache = new Map();

/** URL affichable d'un média (fichier IndexedDB ou URL data:). */
export async function mediaURL(m) {
  if (!m) return '';
  if (m.data) return m.data;
  if (!m.key) return '';
  if (urlCache.has(m.key)) return urlCache.get(m.key);
  try {
    const blob = await Files.get(m.key);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urlCache.set(m.key, url);
    return url;
  } catch {
    return '';
  }
}

/** Enregistre un fichier. Renvoie ce qu'il faut ajouter au média : `{ key }` ou `{ data }`. */
export const storeFile = (file) => backend.storeFile(file);

/** Enregistre l'image d'un plan et renvoie l'adresse à mettre dans la carte. */
export const storeMapImage = (file) => backend.storeMapImage(file);

/** Oublie une carte déjà retirée du projet. */
export const forgetMap = (id) => backend.deleteMap(id);

export async function forgetFile(key) {
  if (!key) return;
  if (urlCache.has(key)) {
    URL.revokeObjectURL(urlCache.get(key));
    urlCache.delete(key);
  }
  await Files.del(key).catch(() => {});
}

/** Supprime des fiches de la carte affichée, avec leurs photos et le travail des élèves associé. */
export async function deleteFiches(list) {
  const gone = new Set(list);
  for (const f of list) for (const m of f.media) await forgetFile(m.key);
  S.map.fiches = S.map.fiches.filter((f) => !gone.has(f));
  const entries = S.progress[S.map.id]?.entries;
  if (entries) for (const f of list) delete entries[f.id];
  changedMap();
  changedProgress();
}

function clearUrlCache() {
  urlCache.forEach((u) => URL.revokeObjectURL(u));
  urlCache.clear();
}

/* ------------------------------------------------------------------ */
/* Chargement / remplacement du projet                                  */
/* ------------------------------------------------------------------ */

/** Lit le projet enregistré dans ce navigateur, ou null. */
export async function loadLocal() {
  const meta = await Meta.get('project');
  if (!meta) return null;
  const maps = await Maps.all();
  const order = meta.mapOrder || [];
  maps.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const { local, mapOrder, ...rest } = meta;
  const project = normalizeProject({ ...rest, maps, progress: {} });
  const prog = {};
  for (const m of project.maps) {
    const p = await Progress.get(`${project.id}/${m.id}`);
    if (p) prog[m.id] = normalizeProgress(p);
  }
  return { project, progress: prog, local: { dirty: false, baseRevision: null, lastExport: null, ...local } };
}

/** Rend un projet actif (sans rien écrire). */
export function activate(project, progressByMap, local) {
  S.project = project;
  S.progress = progressByMap;
  S.local = local;
  S.map = project.maps.find((m) => m.id === project.currentMapId) || project.maps[0];
  S.ui.placing = null;
}

/**
 * Installe un projet dans ce navigateur, en remplaçant le précédent.
 * @param project  projet normalisé (media avec `data` ou `key`)
 * @param options.progress  'replace' : prend la progression du projet ;
 *                          'seed'    : seulement pour les cartes sans progression locale ;
 *                          'keep'    : ignore la progression du projet.
 * @param options.dirty  le projet installé a-t-il des modifications non exportées ?
 */
export async function installProject(project, { progress = 'seed', dirty = false } = {}) {
  await flush();
  const local = { dirty, baseRevision: project.revision, lastExport: null };
  if (!S.storageOk) {
    activate(project, structuredClone(project.progress || {}), local);
    return;
  }
  // Le travail des élèves des autres projets est conservé (clés différentes).
  const existing = {};
  for (const m of project.maps) {
    const p = await Progress.get(`${project.id}/${m.id}`);
    if (p) existing[m.id] = normalizeProgress(p);
  }
  await Maps.clear();
  await Files.clear();
  clearUrlCache();
  for (const m of project.maps) {
    for (const f of m.fiches) {
      for (const md of f.media) {
        if (md.data?.startsWith('data:')) {
          ({ key: md.key } = await localBackend.storeFile(dataURLToBlob(md.data)));
          delete md.data;
        }
      }
    }
    await Maps.put(m);
  }
  const prog = {};
  for (const m of project.maps) {
    const incoming = project.progress?.[m.id];
    if (progress === 'replace') prog[m.id] = incoming || emptyProgress();
    else if (progress === 'seed') prog[m.id] = existing[m.id] || incoming || emptyProgress();
    else prog[m.id] = existing[m.id] || emptyProgress();
    await Progress.put(`${project.id}/${m.id}`, prog[m.id]);
  }
  delete project.progress;
  activate(project, prog, local);
  await Meta.put('project', metaRecord());
}

/**
 * Projet exportable (JSON) : photos converties en URL data:.
 * @param o.studentsOnly   ne garder que les fiches visibles et retirer les réglages enseignant
 * @param o.withProgress   inclure le travail des élèves
 * @param o.keepPositions / o.keepMeasures   filtre de la progression incluse
 */
/** @param onMissing reçoit le nombre de photos retirées faute d'avoir encore leur fichier dans ce navigateur : l'appelant doit le dire */
export async function exportProject({ studentsOnly = false, withProgress = true, keepPositions = true, keepMeasures = true, onMissing = () => {} } = {}) {
  await flush();
  const revision = uid();
  const maps = [];
  let missing = 0;
  for (const m of S.project.maps) {
    const copy = structuredClone(m);
    if (studentsOnly) copy.fiches = copy.fiches.filter((f) => f.visible);
    for (const f of copy.fiches) {
      for (const md of f.media) {
        if (md.key) {
          const blob = await Files.get(md.key).catch(() => null);
          if (blob) md.data = await blobToDataURL(blob);
          delete md.key;
        }
      }
      const kept = f.media.filter((md) => md.data);
      missing += f.media.length - kept.length;
      f.media = kept;
    }
    maps.push(copy);
  }
  if (missing) onMissing(missing);
  const progressOut = {};
  if (withProgress) {
    for (const m of maps) {
      const src = S.progress[m.id];
      if (!src) continue;
      const p = { verified: studentsOnly ? false : src.verified, entries: {} };
      for (const f of m.fiches) {
        const e = src.entries[f.id];
        if (!e) continue;
        const out = {
          x: keepPositions ? e.x : null,
          y: keepPositions ? e.y : null,
          temperature: keepMeasures ? e.temperature : '',
          humidity: keepMeasures ? e.humidity : '',
          light: keepMeasures ? e.light : ''
        };
        if (out.x !== null || out.temperature || out.humidity || out.light) p.entries[f.id] = out;
      }
      progressOut[m.id] = p;
    }
  }
  return {
    format: FORMAT,
    version: VERSION,
    id: S.project.id,
    revision,
    savedAt: new Date().toISOString(),
    title: S.project.title,
    theme: S.project.theme,
    passwordHash: S.project.passwordHash,
    currentMapId: S.map.id,
    maps,
    progress: progressOut
  };
}

/** Note qu'un export complet vient d'être fait (le projet n'a plus de modifications en attente). */
export async function markExported(revision) {
  S.project.revision = revision;
  S.local = { dirty: false, baseRevision: revision, lastExport: new Date().toISOString() };
  pendingMeta = true;
  await flush();
}

export async function switchMap(id) {
  await flush();
  const m = S.project.maps.find((x) => x.id === id);
  if (!m) return;
  S.map = m;
  S.project.currentMapId = m.id;
  S.ui.placing = null;
  pendingMeta = true;
  scheduleWrite();
}
