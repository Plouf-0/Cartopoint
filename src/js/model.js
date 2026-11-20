/**
 * Modèle de données : format d'un projet, normalisation, migrations, calculs.
 *
 * Toutes les fonctions de ce module sont « pures » (pas de DOM, pas de stockage),
 * ce qui permet de les tester avec `node --test`.
 *
 * Vue d'ensemble (détails dans docs/ARCHITECTURE.md) :
 *
 *   Projet ──┬─ métadonnées (titre, thème, mot de passe…)
 *            ├─ modèle de fiche : ses champs  ← fields.js
 *            └─ cartes[] ── fiches[]          ← contenu préparé par l'enseignant
 *
 *   Progression (par projet et par carte)     ← travail des élèves, stocké à part
 *     { verified, entries: { [ficheId]: { x, y, at, [question]: réponse } } }
 *
 * Une fiche range la valeur de chaque champ sous l'identifiant du champ. Un contenu sans modèle (format 3 et avant) se lit avec le
 * modèle botanique, dont les identifiants sont les clés de toujours : rien n'est à convertir (MOD-02).
 */
import { uid, str, num, natural, today } from './util.js';
import { ficheFields, isEmpty, normalizeTemplate, normalizeValue, questionFields, searchFields, subtitleField, titleField } from './fields.js';
import { BOTANIQUE } from './templates/botanique.js';
import { normalizeExpectedOf, normalizeGrading } from './verdicts.js';

/** Identifiant technique : tous les fichiers déjà enregistrés le portent, il ne change pas avec le nom du site. */
export const FORMAT = 'inventaire-botanique';
export const VERSION = 4;
export const DEFAULT_TITLE = 'Cartopoint';
/** Mot de passe de gestion tant que l'enseignant n'en a pas choisi un. */
export const DEFAULT_PASSWORD = 'admin';

/** Le modèle d'un contenu qui n'en a pas : une copie, que l'éditeur pourra modifier sans toucher à l'original figé. */
export const defaultTemplate = () => structuredClone(BOTANIQUE);
/** Le modèle d'un contenu brut (brouillon, version publiée, fichier) : le sien, vérifié, sinon le modèle botanique (MOD-02). */
export const templateOf = (raw) => (raw.template === undefined ? defaultTemplate() : normalizeTemplate(raw.template));

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

/**
 * Une fiche (contenu enseignant uniquement : pas de placement élève ici). Elle garde la valeur de chaque champ que
 * l'enseignant remplit, sous l'identifiant du champ ; ce que le modèle ne connaît pas disparaît.
 */
export function normalizeFiche(raw, template) {
  const expected = normalizeExpectedOf(raw.expected, template);
  return {
    id: raw.id || uid(),
    ref: str(raw.ref ?? raw.code).trim(), // réf. photo / étiquette terrain (ex. « 12b »)
    ...Object.fromEntries(ficheFields(template).map((field) => [field.id, normalizeValue(field, raw[field.id])])),
    visible: raw.visible ?? raw.studentEnabled !== false,
    refX: num(raw.refX), // position réelle, en % de l'image
    refY: num(raw.refY),
    thumbnailId: raw.thumbnailId || null,
    media: (Array.isArray(raw.media) ? raw.media : []).filter(Boolean).map(normalizeMedia),
    // ancien champ « name » (emplacement), gardé seulement comme titre de secours
    ...(raw.name ? { name: str(raw.name) } : {}),
    // les bonnes réponses de ses questions corrigées automatiquement : jamais envoyées à l'élève avant la fin (QST-01)
    ...(Object.keys(expected).length ? { expected } : {})
  };
}

/** Une nouvelle fiche : ses dates sont celles du jour, comme une date d'observation. */
export const newFiche = (raw, template) =>
  normalizeFiche(
    {
      ...Object.fromEntries(
        ficheFields(template)
          .filter((field) => field.type === 'date')
          .map((field) => [field.id, today()])
      ),
      ...raw
    },
    template
  );

export function normalizeMap(raw, fallbackImage, template) {
  return {
    id: raw.id || 'map-' + uid(),
    name: str(raw.name) || 'Plan',
    image: raw.image || fallbackImage || '', // URL data: de l'image du plan
    widthMeters: num(raw.widthMeters), // largeur réelle du terrain (facultatif)
    ratio: num(raw.ratio), // largeur / hauteur du plan, mesurée à la publication : le serveur calcule les écarts sans voir l'image
    fiches: (Array.isArray(raw.fiches) ? raw.fiches : Array.isArray(raw.locations) ? raw.locations : []).map((fiche) => normalizeFiche(fiche, template))
  };
}

export function emptyProgress() {
  return { verified: false, entries: {} };
}

/** La progression d'une carte : un placement, son heure, et la réponse à chaque question du modèle, sous son identifiant. */
export function normalizeProgress(raw, template) {
  const p = emptyProgress();
  if (!raw) return p;
  p.verified = !!raw.verified;
  const questions = questionFields(template);
  for (const [id, e] of Object.entries(raw.entries || {})) {
    const entry = { x: num(e.x), y: num(e.y) };
    if (entry.x === null || entry.y === null) entry.x = entry.y = null;
    if (Number.isFinite(e.at)) entry.at = e.at;
    for (const field of questions) entry[field.id] = normalizeValue(field, e[field.id], { answer: true });
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
  return { preset: raw?.preset || 'vegetal', accent: raw?.accent || '', icon: raw?.icon || 'pin' };
}

/**
 * Projet complet, quel que soit le format d'origine :
 *  - version 4 (actuelle) : le cours porte son modèle de fiche ;
 *  - version 3 : sans modèle, il se lit avec le modèle botanique (MOD-02) ;
 *  - version 2 (fichiers « Inventaire botanique N.html » de 2026) : la progression des
 *    élèves était dans les fiches et le projet n'avait pas d'identifiant stable.
 */
export function normalizeProject(raw, fallbackImage = '') {
  if (!raw || raw.format !== FORMAT || !Array.isArray(raw.maps)) throw new Error('fichier de projet non reconnu');
  const legacy = (raw.version || 1) < 3;
  const template = templateOf(raw);
  const maps = raw.maps.map((m) => normalizeMap(m, fallbackImage, template));
  if (!maps.length) maps.push(normalizeMap({}, fallbackImage, template));

  let progress = {};
  if (legacy) for (const m of raw.maps) progress[m.id] = legacyProgressOf(m);
  else for (const [mapId, p] of Object.entries(raw.progress || {})) progress[mapId] = normalizeProgress(p, template);

  return {
    format: FORMAT,
    version: VERSION,
    // v2 : identifiant déduit de la première carte, pour qu'il reste stable d'un fichier à l'autre
    id: raw.id || (legacy && raw.maps[0]?.id ? 'proj-' + raw.maps[0].id : 'proj-' + uid()),
    revision: raw.revision || raw.bundleId || uid(),
    savedAt: raw.savedAt || raw.createdAt || new Date().toISOString(),
    title: str(raw.title) || DEFAULT_TITLE,
    theme: normalizeTheme(raw.theme),
    template,
    // Comment les élèves sont notés (QST-05) : sans note, tant que l'enseignant n'a rien choisi
    grading: normalizeGrading(raw.grading, template),
    passwordHash: raw.passwordHash || null,
    currentMapId: maps.some((m) => m.id === raw.currentMapId) ? raw.currentMapId : maps[0].id,
    maps,
    progress
  };
}

/**
 * Contenu d'un cours sur le serveur : ni progression, ni carte affichée, ni mot de passe de gestion. Changer de carte à l'écran ne compte donc pas comme une modification du cours.
 */
export function draftOf(project) {
  const { format, version, title, theme, template, grading, maps } = project;
  return { format, version, title, theme, template, grading, maps };
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

/**
 * Le modèle d'un cours qu'on crée de zéro (Q-E) : un titre et une description, à compléter dans l'éditeur. Aucune matière
 * n'est proposée d'avance ; le modèle botanique ne sert qu'aux cours qui l'avaient déjà.
 */
export const starterTemplate = () => ({
  name: 'Fiche',
  fields: [
    { id: 'titre', type: 'text', label: 'Titre', audience: 'info', role: 'title', search: true },
    { id: 'description', type: 'longtext', label: 'Description', audience: 'info', search: true }
  ]
});

/** Nouveau projet vide avec une carte : le modèle botanique par défaut, comme le fichier de secours l'a toujours fait. */
export function newProject(title = DEFAULT_TITLE, image = '', template = undefined) {
  return normalizeProject({ format: FORMAT, version: VERSION, title, ...(template ? { template } : {}), maps: [{ image, fiches: [] }] }, image);
}

/**
 * Le modèle d'un autre cours, repris dans celui-ci (4.2) : une copie, qui garde d'où elle vient pour information. Modifier
 * ensuite le cours d'origine ne change rien ici (Q-D).
 */
export function templateFrom(project, courseId) {
  const { name, fields } = structuredClone(project.template);
  const source = { ...(courseId ? { courseId: String(courseId).slice(0, 120) } : {}), title: str(project.title).slice(0, 120) };
  return { ...(name ? { name } : {}), source, fields };
}

/* ------------------------------------------------------------------ */
/* Calculs                                                              */
/* ------------------------------------------------------------------ */

/** Le champ titre, sinon le sous-titre, sinon l'ancien nom d'emplacement (format 2). */
export const titleOf = (f, template) => f[titleField(template)?.id] || f[subtitleField(template)?.id] || f.name || 'Fiche sans nom';
/** Le sous-titre, en italique sous le titre (un nom scientifique, par exemple) ; rien s'il le répète. */
export function subtitleOf(f, template) {
  const value = f[subtitleField(template)?.id];
  return value && value !== titleOf(f, template) ? value : '';
}
/**
 * Une fiche telle qu'elle part chez les élèves sans serveur (version élèves, fichier de secours) : sans la note de
 * l'enseignant (CHP-04). Ce qui est révélé à la correction y reste, comme les positions réelles : la page le montre après la
 * vérification.
 */
export function withoutTeacherNotes(fiche, template) {
  const copy = { ...fiche };
  for (const field of template.fields) if (field.audience === 'teacher') delete copy[field.id];
  return copy;
}
export const hasRef = (f) => f.refX !== null && f.refY !== null;
/** Une carte sans image du plan est une simple liste de fiches : ni placement ni position réelle (CAR-07, Q-B). */
export const hasPlan = (map) => Boolean(map.image);
export const thumbOf = (f) => f.media.find((m) => m.id === f.thumbnailId && m.type === 'image') || f.media.find((m) => m.type === 'image');
export const visibleFiches = (map) => map.fiches.filter((f) => f.visible);

/** Combien de réponses obligatoires manquent encore, sur les fiches visibles (QST-06) : « Terminer » le dit, sans bloquer. */
export function missingRequired(project, progressByMap) {
  const required = questionFields(project.template).filter((field) => field.required);
  let missing = 0;
  for (const map of project.maps)
    for (const fiche of visibleFiches(map)) for (const field of required) if (isEmpty(progressByMap[map.id]?.entries[fiche.id]?.[field.id])) missing++;
  return missing;
}

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

const GRADES = {
  noref: { label: 'Pas de position réelle', cls: 'none' },
  unplaced: { label: 'Non placée', cls: 'none' },
  ok: { label: 'Bien placée', cls: 'ok' },
  near: { label: 'Proche', cls: 'near' },
  far: { label: 'À revoir', cls: 'far' }
};
/** Combien de fiches comptent dans un score : celles qui ont une position réelle. */
export const scoredCount = ({ ok, near, far, unplaced }) => ok + near + far + unplaced;

/** Comment présenter un résultat : calculé ici ou reçu du serveur, il se lit pareil. */
export const gradeOf = (state) => GRADES[state];

/**
 * Écart entre le placement de l'élève et la position réelle.
 * La distance est mesurée en % de la largeur du plan (`ratio` = largeur / hauteur de l'image),
 * puis convertie en mètres si la largeur réelle du terrain est connue.
 */
export function evaluate(fiche, entry, { ratio = 1, widthMeters = null } = {}) {
  if (!hasRef(fiche)) return { state: 'noref', ...gradeOf('noref') };
  const p = placedPos(entry);
  if (!p) return { state: 'unplaced', ...gradeOf('unplaced') };
  const d = Math.hypot(p.x - fiche.refX, (p.y - fiche.refY) / ratio);
  const meters = widthMeters ? (d / 100) * widthMeters : null;
  const decimal = (value) => value.toFixed(1).replace('.', ',');
  const dist = meters !== null ? `${meters < 10 ? decimal(meters) : Math.round(meters)} m` : `${decimal(d)} % du plan`;
  const state = d <= THRESHOLDS.ok ? 'ok' : d <= THRESHOLDS.near ? 'near' : 'far';
  return { state, ...gradeOf(state), d, dist };
}

/**
 * Les écarts d'un cours s'expriment en mètres si toutes ses cartes où l'on mesure des écarts, celles qui ont des positions
 * réelles, connaissent leur largeur réelle ; sinon en % de la largeur du plan. Une liste sans plan n'en a pas : elle ne
 * compte pas.
 */
export function usesMeters(project) {
  const measured = project.maps.filter((map) => map.fiches.some(hasRef));
  return measured.length > 0 && measured.every((map) => map.widthMeters);
}

/** La précision moyenne d'un élève, à partir des résultats du serveur : les fiches non placées n'y entrent pas. */
export function meanGap(project, results) {
  const meters = usesMeters(project);
  const gaps = project.maps.flatMap((map) =>
    Object.values(results.maps[map.id]?.fiches ?? {})
      .filter(({ d }) => d !== undefined)
      .map(({ d }) => (meters ? (d / 100) * map.widthMeters : d))
  );
  return gaps.length ? gaps.reduce((total, gap) => total + gap, 0) / gaps.length : null;
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

/** Recherche plein texte simple dans une fiche : sa réf. photo et les champs du modèle qui servent à la recherche. */
export function matches(fiche, query, template) {
  const q = query.trim().toLowerCase();
  return !q || [fiche.ref, ...searchFields(template).map((field) => fiche[field.id])].join(' ').toLowerCase().includes(q);
}
