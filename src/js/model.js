/**
 * Modèle de données : format d'un projet, normalisation, migrations, calculs.
 *
 * Toutes les fonctions de ce module sont « pures » (pas de DOM, pas de stockage),
 * ce qui permet de les tester avec `node --test`.
 *
 * Vue d'ensemble (détails dans docs/ARCHITECTURE.md) :
 *
 *   Projet ──┬─ métadonnées (titre, thème, mot de passe…)
 *            └─ cartes[] ── fiches[]          ← contenu préparé par l'enseignant
 *
 *   Progression (par projet et par carte)     ← travail des élèves, stocké à part
 *     { verified, entries: { [ficheId]: { x, y, temperature, humidity, light } } }
 */
import { uid, str, num, natural } from './util.js';

export const FORMAT = 'inventaire-botanique';
export const VERSION = 3;
export const DEFAULT_TITLE = 'Inventaire botanique';
/** Mot de passe de gestion tant que l'enseignant n'en a pas choisi un. */
export const DEFAULT_PASSWORD = 'admin';

/** Besoins de la plante : clé, icône, libellé. */
export const NEEDS = [
  ['exposure', '☀️', 'Exposition'],
  ['watering', '💧', 'Arrosage'],
  ['soil', '🌱', 'Sol'],
  ['heat', '🌡️', 'Chaleur'],
  ['care', '✂️', 'Entretien']
];

/** Mesures relevées par les élèves : clé, icône, unité, libellé, clavier mobile. */
export const MEASURES = [
  ['temperature', '🌡', '°C', 'Température', 'decimal'],
  ['humidity', '💧', '%', 'Hygrométrie', 'decimal'],
  ['light', '☀️', 'lux', 'Éclairement', 'numeric']
];

/** Seuils d'évaluation, en % de la largeur du plan. */
export const THRESHOLDS = { ok: 4, near: 10 };

/* ------------------------------------------------------------------ */
/* Normalisation : accepte les formats des anciennes versions          */
/* ------------------------------------------------------------------ */

/** Une photo ou vidéo d'une fiche. `key` = fichier dans IndexedDB, `data` = URL data: (export). */
export function normalizeMedia(m) {
  return {
    id: m.id || uid(),
    type: m.type === 'video' ? 'video' : 'image',
    name: str(m.name),
    ...(m.key ? { key: m.key } : {}),
    ...(m.data || m.dataUrl || m.src ? { data: m.data || m.dataUrl || m.src } : {})
  };
}

/** Une fiche (contenu enseignant uniquement : pas de placement élève ici). */
export function normalizeFiche(raw = {}) {
  return {
    id: raw.id || uid(),
    ref: str(raw.ref ?? raw.code).trim(), // réf. photo / étiquette terrain (ex. « 12b »)
    common: str(raw.common),
    species: str(raw.species),
    family: str(raw.family),
    date: str(raw.date),
    exposure: str(raw.exposure),
    watering: str(raw.watering),
    soil: str(raw.soil),
    heat: str(raw.heat),
    care: str(raw.care),
    description: str(raw.description),
    notes: str(raw.notes),
    visible: raw.visible ?? raw.studentEnabled !== false,
    refX: num(raw.refX), // position réelle, en % de l'image
    refY: num(raw.refY),
    thumbnailId: raw.thumbnailId || null,
    media: (Array.isArray(raw.media) ? raw.media : []).filter(Boolean).map(normalizeMedia),
    // ancien champ « name » (emplacement), gardé seulement comme titre de secours
    ...(raw.name ? { name: str(raw.name) } : {})
  };
}

export function normalizeMap(raw = {}, fallbackImage = '') {
  return {
    id: raw.id || 'map-' + uid(),
    name: str(raw.name) || 'Plan',
    image: raw.image || fallbackImage, // URL data: de l'image du plan
    widthMeters: num(raw.widthMeters), // largeur réelle du terrain (facultatif)
    fiches: (Array.isArray(raw.fiches) ? raw.fiches : Array.isArray(raw.locations) ? raw.locations : []).map(normalizeFiche)
  };
}

export function emptyProgress() {
  return { verified: false, entries: {} };
}

export function normalizeProgress(raw) {
  const p = emptyProgress();
  if (!raw) return p;
  p.verified = !!raw.verified;
  for (const [id, e] of Object.entries(raw.entries || {})) {
    const entry = { x: num(e.x), y: num(e.y) };
    if (entry.x === null || entry.y === null) entry.x = entry.y = null;
    for (const [k] of MEASURES) entry[k] = str(e[k]);
    p.entries[id] = entry;
  }
  return p;
}

/**
 * Extrait la progression stockée dans les fiches par les versions ≤ 2
 * (x, y, placed, temperature… directement sur la fiche).
 */
export function legacyProgressOf(rawMap) {
  const p = emptyProgress();
  p.verified = !!rawMap.exerciseVerified;
  for (const l of rawMap.locations || []) {
    const placed = !!l.placed && num(l.x) !== null && num(l.y) !== null;
    const entry = {
      x: placed ? num(l.x) : null,
      y: placed ? num(l.y) : null,
      temperature: str(l.temperature ?? l.temp ?? l.env?.temperature),
      humidity: str(l.humidity ?? l.hygrometry ?? l.env?.humidity),
      light: str(l.light ?? l.illuminance ?? l.eclairement ?? l.env?.light)
    };
    if (placed || entry.temperature || entry.humidity || entry.light) p.entries[l.id] = entry;
  }
  return p;
}

export function normalizeTheme(raw) {
  return { preset: raw?.preset || 'vegetal', accent: raw?.accent || '', icon: raw?.icon || 'leaf' };
}

/**
 * Projet complet, quel que soit le format d'origine :
 *  - version 3 (actuelle) ;
 *  - version 2 (fichiers « Inventaire botanique N.html » de 2026) : la progression des
 *    élèves était dans les fiches et le projet n'avait pas d'identifiant stable.
 */
export function normalizeProject(raw, fallbackImage = '') {
  if (!raw || raw.format !== FORMAT || !Array.isArray(raw.maps)) throw new Error('fichier de projet non reconnu');
  const legacy = (raw.version || 1) < 3;
  const maps = raw.maps.map((m) => normalizeMap(m, fallbackImage));
  if (!maps.length) maps.push(normalizeMap({ name: 'Plan du parc' }, fallbackImage));

  let progress = {};
  if (legacy) for (const m of raw.maps) progress[m.id] = legacyProgressOf(m);
  else for (const [mapId, p] of Object.entries(raw.progress || {})) progress[mapId] = normalizeProgress(p);

  return {
    format: FORMAT,
    version: VERSION,
    // v2 : identifiant déduit de la première carte, pour qu'il reste stable d'un fichier à l'autre
    id: raw.id || (legacy && raw.maps[0]?.id ? 'proj-' + raw.maps[0].id : 'proj-' + uid()),
    revision: raw.revision || raw.bundleId || uid(),
    savedAt: raw.savedAt || raw.createdAt || new Date().toISOString(),
    title: str(raw.title) || DEFAULT_TITLE,
    theme: normalizeTheme(raw.theme),
    passwordHash: raw.passwordHash || null,
    aiEndpoint: str(raw.aiEndpoint),
    currentMapId: maps.some((m) => m.id === raw.currentMapId) ? raw.currentMapId : maps[0].id,
    maps,
    progress
  };
}

/**
 * Extrait les données brutes d'un projet depuis le contenu d'un fichier :
 * .json, ou page .html contenant un projet intégré (version actuelle ou versions 2026).
 */
export function projectFromText(text) {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const m =
    text.match(/<script id="embedded-project" type="application\/json">([\s\S]*?)<\/script>/) ||
    text.match(/<script id="embeddedBundle" type="application\/json">([\s\S]*?)<\/script>/);
  const p = m ? JSON.parse(m[1]) : null;
  if (!p) throw new Error("ce fichier ne contient pas de projet (c'est peut-être une page vide)");
  return p;
}

/** Nouveau projet vide avec une carte. */
export function newProject(title = DEFAULT_TITLE, image = '') {
  return normalizeProject({ format: FORMAT, version: VERSION, title, maps: [{ name: 'Plan du parc', image, fiches: [] }] }, image);
}

/* ------------------------------------------------------------------ */
/* Calculs                                                              */
/* ------------------------------------------------------------------ */

export const titleOf = (f) => f.common || f.species || f.name || 'Fiche sans nom';
export const hasRef = (f) => f.refX !== null && f.refY !== null;
export const thumbOf = (f) => f.media.find((m) => m.id === f.thumbnailId && m.type === 'image') || f.media.find((m) => m.type === 'image');
export const visibleFiches = (map) => map.fiches.filter((f) => f.visible);

/**
 * Numéro affiché d'une fiche : 1, 2, 3… dans l'ordre de la liste, en ne comptant
 * que les fiches visibles par les élèves. Une fiche masquée n'a pas de numéro (« – »).
 */
export function numberOf(map, fiche) {
  if (!fiche.visible) return '–';
  let n = 0;
  for (const f of map.fiches) {
    if (f.visible) n++;
    if (f === fiche) return String(n);
  }
  return '–';
}

/** Position placée par l'élève (ou null). */
export function placedPos(entry) {
  return entry && entry.x !== null && entry.y !== null && entry.x !== undefined ? { x: entry.x, y: entry.y } : null;
}

/**
 * Écart entre le placement de l'élève et la position réelle.
 * La distance est mesurée en % de la largeur du plan (`ratio` = largeur / hauteur de l'image),
 * puis convertie en mètres si la largeur réelle du terrain est connue.
 */
export function evaluate(fiche, entry, { ratio = 1, widthMeters = null } = {}) {
  if (!hasRef(fiche)) return { state: 'noref', label: 'Pas de position réelle', cls: 'none' };
  const p = placedPos(entry);
  if (!p) return { state: 'unplaced', label: 'Non placée', cls: 'none' };
  const d = Math.hypot(p.x - fiche.refX, (p.y - fiche.refY) / ratio);
  const meters = widthMeters ? (d / 100) * widthMeters : null;
  const dist = meters !== null ? `${meters < 10 ? meters.toFixed(1) : Math.round(meters)} m` : `${d.toFixed(1)} % du plan`;
  if (d <= THRESHOLDS.ok) return { state: 'ok', label: 'Bien placée', cls: 'ok', d, dist };
  if (d <= THRESHOLDS.near) return { state: 'near', label: 'Proche', cls: 'near', d, dist };
  return { state: 'far', label: 'À revoir', cls: 'far', d, dist };
}

/** Range les fiches par réf. photo (1, 2, 5a, 5b, 10…), celles sans réf. à la fin. */
export function sortByRef(fiches) {
  return fiches
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      if (a.f.ref && b.f.ref) return natural(a.f.ref, b.f.ref) || a.i - b.i;
      if (a.f.ref) return -1;
      if (b.f.ref) return 1;
      return a.i - b.i;
    })
    .map((x) => x.f);
}

/** Recherche plein texte simple dans une fiche. */
export function matches(fiche, query) {
  const q = query.trim().toLowerCase();
  return !q || [fiche.ref, fiche.common, fiche.species, fiche.family].join(' ').toLowerCase().includes(q);
}
