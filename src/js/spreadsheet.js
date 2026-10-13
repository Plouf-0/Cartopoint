/**
 * Import et export des fiches par tableur (CSV ou .xlsx).
 *
 * Les titres de colonnes sont reconnus avec souplesse (accents, majuscules, variantes :
 * voir COLUMNS). Une fiche déjà présente — même réf. photo, ou à défaut même nom —
 * est complétée au lieu d'être créée en double.
 */
import { num, normKey, today, toast } from './util.js';
import { S, fiches, entryOf, changedMap, changedProgress } from './store.js';
import { normalizeFiche, sortByRef, MEASURES } from './model.js';
import { parseXlsx } from './xlsx.js';
import { render } from './render.js';

/** [clé, titre exporté, variantes acceptées à l'import (déjà normalisées par normKey)] */
export const COLUMNS = [
  [
    'ref',
    'Réf. photo',
    [
      'ref photo',
      'ref',
      'reference photo',
      'reference',
      'n',
      'no',
      'num',
      'numero',
      'n photo',
      'no photo',
      'numero photo',
      'n de photo',
      'repere',
      'n repere',
      'code',
      'id'
    ]
  ],
  ['common', 'Nom commun', ['nom commun', 'nom', 'nom francais', 'nom vernaculaire', 'common']],
  ['species', 'Nom scientifique', ['nom scientifique', 'espece', 'nom latin', 'species', 'scientific']],
  ['family', 'Famille', ['famille', 'famille botanique', 'family']],
  ['exposure', 'Exposition', ['exposition', 'soleil', 'ensoleillement', 'exposure']],
  ['watering', 'Arrosage', ['arrosage', 'eau', 'besoin en eau', 'watering']],
  ['soil', 'Sol', ['sol', 'terre', 'soil']],
  ['heat', 'Chaleur', ['chaleur', 'climat', 'rusticite', 'heat']],
  ['care', 'Entretien', ['entretien', 'taille', 'care']],
  ['date', "Date d'observation", ['date', 'date d observation', 'date observation']],
  ['temperature', 'Température (°C)', ['temperature', 'temp']],
  ['humidity', 'Hygrométrie (%)', ['hygrometrie', 'humidite', 'humidity']],
  ['light', 'Éclairement (lux)', ['eclairement', 'luminosite', 'lumiere', 'lux', 'light']],
  ['description', 'Description', ['description', 'description de l espece']],
  ['notes', 'Observations', ['observations', 'observations de terrain', 'notes', 'commentaires', 'remarques']],
  ['visible', 'Visible élèves (oui/non)', ['visible eleves', 'visible', 'visible pour les eleves']],
  ['refX', 'Position réelle X (%)', ['position reelle x', 'x reel', 'refx', 'x']],
  ['refY', 'Position réelle Y (%)', ['position reelle y', 'y reel', 'refy', 'y']]
];
const MEASURE_KEYS = MEASURES.map(([k]) => k);

/* ------------------------------------------------------------------ */
/* Lecture                                                              */
/* ------------------------------------------------------------------ */

/** Analyse un texte CSV (séparateur ; , ou tabulation détecté sur la première ligne). */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Les fichiers Excel « CSV » français sont souvent en Windows-1252 et non en UTF-8. */
export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Convertit une valeur de cellule selon la colonne. */
export function cellValue(key, raw) {
  const v = String(raw ?? '').trim();
  if (key === 'date') {
    if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Math.round((+v - 25569) * 864e5)).toISOString().slice(0, 10); // n° de série Excel
    let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return v;
  }
  if (key === 'visible') return !/^(non|no|n|0|false|faux)$/i.test(v);
  if (key === 'refX' || key === 'refY') {
    const n = num(v.replace('%', ''));
    return n === null ? null : Math.max(0, Math.min(100, n));
  }
  return v;
}

/** Associe chaque colonne du fichier à une clé connue (ou null). */
export function mapHeaders(headerRow) {
  return headerRow.map((h) => COLUMNS.find(([, , aliases]) => aliases.includes(normKey(h)))?.[0] ?? null);
}

/**
 * Prépare l'import sans rien modifier : renvoie les opérations à appliquer.
 * Exportée pour les tests.
 */
export function planImport(rows, existingFiches) {
  const width = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '')));
  const keys = mapHeaders(rows[0]);
  if (!keys.some((k) => k === 'common' || k === 'species')) throw new Error('colonne « Nom commun » ou « Nom scientifique » introuvable. Partez du modèle.');
  const ignored = rows[0].filter((h, i) => !keys[i] && h.trim());
  const same = (a, b) => normKey(a) && normKey(a) === normKey(b);
  const used = new Set();
  const ops = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const data = {};
    keys.forEach((k, i) => {
      if (k && r[i].trim() !== '') data[k] = cellValue(k, r[i]);
    });
    if (!data.common && !data.species) {
      skipped++;
      continue;
    }
    if (data.refX == null || data.refY == null) {
      delete data.refX;
      delete data.refY;
    }
    const sameName = (f) => (data.species ? same(data.species, f.species) : same(data.common, f.common));
    const free = existingFiches.filter((f) => !used.has(f));
    let existing;
    if (data.ref) {
      const byRef = free.filter((f) => same(data.ref, f.ref));
      existing = byRef.find(sameName) || byRef[0];
    } else existing = free.find((f) => !f.ref && sameName(f));
    if (existing) used.add(existing);
    ops.push({ existing, data });
  }
  return { ops, ignored, skipped, added: ops.filter((o) => !o.existing).length, updated: ops.filter((o) => o.existing).length };
}

/** Importe un fichier .xlsx ou .csv dans la carte affichée (avec confirmation). */
export async function importSpreadsheet(file) {
  let plan;
  try {
    const buffer = await file.arrayBuffer();
    const rows = /\.xlsx$/i.test(file.name) ? await parseXlsx(buffer) : parseCSV(decodeText(buffer));
    if (rows.length < 2) throw new Error('aucune ligne de fiche sous les titres de colonnes');
    plan = planImport(rows, fiches());
  } catch (e) {
    return toast('⚠ Import impossible : ' + e.message);
  }
  if (!plan.ops.length) return toast('⚠ Aucune fiche avec un nom dans ce fichier');
  const msg =
    `${plan.ops.length + plan.skipped} ligne(s) lue(s) dans « ${file.name} » :\n• ${plan.added} nouvelle(s) fiche(s)\n• ${plan.updated} fiche(s) existante(s) complétée(s)` +
    (plan.skipped ? `\n• ${plan.skipped} ligne(s) sans nom ignorée(s)` : '') +
    (plan.ignored.length ? `\n\nColonnes non reconnues (ignorées) : ${plan.ignored.join(', ')}` : '') +
    `\n\nImporter dans la carte « ${S.map.name} » ?`;
  if (!confirm(msg)) return;

  for (const { existing, data } of plan.ops) {
    const measures = Object.fromEntries(MEASURE_KEYS.filter((k) => k in data).map((k) => [k, data[k]]));
    MEASURE_KEYS.forEach((k) => delete data[k]);
    let fiche = existing;
    if (fiche) Object.assign(fiche, data);
    else {
      fiche = normalizeFiche({ date: today(), ...data });
      fiches().push(fiche);
    }
    if (Object.keys(measures).length) Object.assign(entryOf(fiche, true), measures);
  }
  if (fiches().some((f) => f.ref)) S.map.fiches = sortByRef(fiches());
  changedMap();
  changedProgress();
  render();
  toast(`✓ ${plan.added} fiche(s) ajoutée(s), ${plan.updated} complétée(s)`);
}

/* ------------------------------------------------------------------ */
/* Écriture                                                             */
/* ------------------------------------------------------------------ */

const csvCell = (v) => {
  v = String(v ?? '');
  return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

/** CSV « à la française » (séparateur ;) lisible directement par Excel. */
export function buildCsv(list, progress = { entries: {} }) {
  const lines = [COLUMNS.map((c) => c[1]).join(';')];
  for (const f of list) {
    const e = progress.entries[f.id] || {};
    lines.push(
      COLUMNS.map(([k]) => {
        if (k === 'visible') return f.visible ? 'oui' : 'non';
        if (k === 'refX' || k === 'refY') return f[k] === null ? '' : String(+f[k].toFixed(2)).replace('.', ',');
        if (MEASURE_KEYS.includes(k)) return csvCell(e[k]);
        return csvCell(f[k]);
      }).join(';')
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function templateCsv() {
  const example = normalizeFiche({
    ref: '1',
    common: 'Olivier',
    species: 'Olea europaea',
    family: 'Oleaceae',
    exposure: '☀️☀️☀️ Plein soleil',
    watering: '💧 Faible une fois installé',
    soil: '🌱 Bien drainé, accepte le calcaire',
    heat: '🌡️ Très bonne tolérance à la chaleur',
    care: "✂️ Taille légère en fin d'hiver",
    date: today(),
    description: 'Arbre persistant méditerranéen.'
  });
  return buildCsv([example]);
}
