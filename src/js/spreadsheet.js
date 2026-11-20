/**
 * Import et export des fiches par tableur (CSV ou .xlsx).
 *
 * Les colonnes sont celles du modèle de fiche du cours : la réf. photo, chaque champ dans son ordre, puis la visibilité et
 * la position réelle. Leurs titres sont reconnus avec souplesse (accents, majuscules, variantes du modèle : voir
 * columnsOf). Une fiche déjà présente — même réf. photo, ou à défaut même nom — est complétée au lieu d'être créée en double.
 */
import { num, normKey, str, toast, errorText } from './util.js';
import { S, fiches, entryOf, changedMap, changedProgress, courseTemplate } from './store.js';
import { newFiche, sortByRef, titleOf } from './model.js';
import { columnTitle, ficheFields, isEmpty, isHeading, normalizeValue, questionFields, subtitleField, titleField, valueText } from './fields.js';
import { parseXlsx } from './xlsx.js';
import { render } from './render.js';

/** Les colonnes de toute fiche, quel que soit son modèle. Variantes déjà normalisées par normKey. */
const REF = {
  key: 'ref',
  title: 'Réf. photo',
  aliases: [
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
};
const PLACE = [
  { key: 'visible', title: 'Visible élèves (oui/non)', aliases: ['visible eleves', 'visible', 'visible pour les eleves'] },
  { key: 'refX', title: 'Position réelle X (%)', aliases: ['position reelle x', 'x reel', 'refx', 'x'] },
  { key: 'refY', title: 'Position réelle Y (%)', aliases: ['position reelle y', 'y reel', 'refy', 'y'] }
];

/** Dans l'espace enseignant, les questions n'ont pas de colonne : seuls les élèves y répondent. */
const withAnswers = () => !S.teacherSpace;

/**
 * Les colonnes du tableur d'un cours : { key, title, aliases, field }. Un champ se reconnaît à son titre de colonne, à son
 * libellé, ou à l'une des variantes que lui donne le modèle (« nom latin » pour un nom scientifique).
 */
export function columnsOf(template, { answers = withAnswers() } = {}) {
  const fields = template.fields.filter((field) => !isHeading(field) && (answers || field.audience !== 'question'));
  return [
    REF,
    ...fields.map((field) => ({
      key: field.id,
      title: columnTitle(field),
      aliases: [...new Set([normKey(columnTitle(field)), normKey(field.label), ...(field.aliases ?? []).map(normKey)])],
      field
    })),
    ...PLACE
  ];
}

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

/** Le choix dont le libellé ou l'identifiant est ce texte. */
const choiceOf = (field, text) => field.choices.find((choice) => choice.id === text || normKey(choice.label) === normKey(text))?.id;

/** Convertit une valeur de cellule selon sa colonne : une date, un oui / non, un choix… */
export function cellValue({ key, field }, raw) {
  // L'apostrophe ajoutée à l'export (TAB-11) ne fait pas partie de la valeur
  const v = String(raw ?? '')
    .trim()
    .replace(/^'(?=\s*[=+\-@])/, '');
  if (key === 'visible') return !/^(non|no|n|0|false|faux)$/i.test(v);
  if (key === 'refX' || key === 'refY') {
    const n = num(v.replace('%', ''));
    return n === null ? null : Math.max(0, Math.min(100, n));
  }
  switch (field?.type) {
    case 'date': {
      if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Math.round((+v - 25569) * 864e5)).toISOString().slice(0, 10); // n° de série Excel
      let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
      if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      return v;
    }
    case 'choice':
      if (!field.multiple) return choiceOf(field, v) ?? '';
      return choiceOf(field, v)
        ? [choiceOf(field, v)]
        : normalizeValue(
            field,
            v.split(/[,;\n]/).map((part) => choiceOf(field, part.trim()))
          );
    case 'yesno':
      return /^(oui|o|yes|y|vrai|true|x|1)$/i.test(v) ? 'oui' : /^(non|n|no|faux|false|0)$/i.test(v) ? 'non' : '';
    case 'scale':
      // « 3 », ou le symbole répété : « ☀️☀️☀️ »
      return normalizeValue(field, num(v) ?? (field.symbol ? v.split(field.symbol).length - 1 : ''));
    default:
      return v;
  }
}

/** La clé de chaque colonne du fichier (ou null) : la première colonne du cours dont une variante correspond. */
export function mapHeaders(headerRow, columns) {
  return headerRow.map((h) => columns.find(({ aliases }) => aliases.includes(normKey(h)))?.key ?? null);
}

/** Ce qui nomme une fiche : son titre et son sous-titre, ou à défaut n'importe quel champ que remplit l'enseignant. */
const namesOf = (template) => {
  const names = [titleField(template), subtitleField(template)].filter(Boolean);
  return names.length ? names : ficheFields(template);
};

/**
 * Prépare l'import sans rien modifier : renvoie les opérations à appliquer.
 * Exportée pour les tests.
 */
export function planImport(rows, existingFiches, template, { answers = withAnswers() } = {}) {
  const columns = columnsOf(template, { answers });
  const width = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '')));
  const keys = mapHeaders(rows[0], columns);
  const names = namesOf(template);
  if (!keys.some((k) => names.some((field) => field.id === k)))
    throw new Error(
      `colonne ${names
        .slice(0, 2)
        .map((field) => `« ${field.label} »`)
        .join(' ou ')} introuvable. Partez du modèle.`
    );
  const ignored = rows[0].filter((h, i) => !keys[i] && h.trim());
  const same = (a, b) => normKey(a) && normKey(a) === normKey(b);
  const used = new Set();
  const ops = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const data = {};
    keys.forEach((k, i) => {
      if (k && r[i].trim() !== '')
        data[k] = cellValue(
          columns.find((column) => column.key === k),
          r[i]
        );
    });
    const name = names.find((field) => !isEmpty(data[field.id]));
    if (!name) {
      skipped++;
      continue;
    }
    if (data.refX == null || data.refY == null) {
      delete data.refX;
      delete data.refY;
    }
    // Le sous-titre (le nom scientifique) départage mieux que le titre : on le préfère quand la ligne en a un
    const key = names.find((field) => field.role === 'subtitle' && !isEmpty(data[field.id]))?.id ?? name.id;
    const sameName = (f) => same(str(data[key]), str(f[key]));
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
  const template = courseTemplate();
  let plan;
  try {
    const buffer = await file.arrayBuffer();
    const rows = /\.xlsx$/i.test(file.name) ? await parseXlsx(buffer) : parseCSV(decodeText(buffer));
    if (rows.length < 2) throw new Error('aucune ligne de fiche sous les titres de colonnes');
    plan = planImport(rows, fiches(), template);
  } catch (e) {
    return toast('⚠ Import impossible : ' + errorText(e));
  }
  if (!plan.ops.length) return toast('⚠ Aucune fiche avec un nom dans ce fichier');
  const msg =
    `${plan.ops.length + plan.skipped} ligne(s) lue(s) dans « ${file.name} » :\n• ${plan.added} nouvelle(s) fiche(s)\n• ${plan.updated} fiche(s) existante(s) complétée(s)` +
    (plan.skipped ? `\n• ${plan.skipped} ligne(s) sans nom ignorée(s)` : '') +
    (plan.ignored.length ? `\n\nColonnes non reconnues (ignorées) : ${plan.ignored.join(', ')}` : '') +
    `\n\nImporter dans la carte « ${S.map.name} » ?`;
  if (!confirm(msg)) return;

  for (const { existing, data } of plan.ops) {
    const questions = questionFields(template).filter((field) => field.id in data);
    const measures = Object.fromEntries(questions.map((field) => [field.id, data[field.id]]));
    questions.forEach((field) => delete data[field.id]);
    let fiche = existing;
    if (fiche) Object.assign(fiche, data);
    else {
      fiche = newFiche(data, template);
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

/** Texte qu'un tableur prendrait pour une formule. Un nombre négatif reste un nombre. */
const FORMULA = /^\s*[=+\-@]/;
const NUMBER = /^[+-]?\d+([.,]\d+)?$/;

const csvCell = (v) => {
  v = String(v ?? '');
  // Un élève ou un fichier importé peut écrire « =HYPERLINK(…) » : l'apostrophe en fait du texte (TAB-11)
  if (FORMULA.test(v) && !NUMBER.test(v)) v = "'" + v;
  return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

/**
 * Ce qu'une cellule montre d'une valeur, pour qu'elle revienne intacte à l'import : le libellé d'un choix plutôt que son
 * identifiant, une date en AAAA-MM-JJ.
 */
const cellText = (field, value) => (field.type === 'choice' ? valueText(field, value) : str(value));

/** CSV « à la française » (séparateur ;) lisible directement par Excel. */
export function buildCsv(list, progress, template, { answers = withAnswers() } = {}) {
  const columns = columnsOf(template, { answers });
  const lines = [columns.map((column) => column.title).join(';')];
  for (const f of list) {
    const e = progress.entries[f.id] || {};
    lines.push(
      columns
        .map(({ key, field }) => {
          if (key === 'visible') return f.visible ? 'oui' : 'non';
          if (key === 'refX' || key === 'refY') return f[key] === null ? '' : String(+f[key].toFixed(2)).replace('.', ',');
          if (!field) return csvCell(f[key]);
          return csvCell(cellText(field, field.audience === 'question' ? e[key] : f[key]));
        })
        .join(';')
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** Nombre au format français (virgule décimale), '' si absent. */
const frNum = (n, digits = 2) => (n === null || n === undefined ? '' : String(+n.toFixed(digits)).replace('.', ','));
const average = (values) => {
  const v = values.filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Rendu pour l'enseignant : une ligne par fiche (réponses, résultat, écart),
 * puis une ligne « Moyenne » sur les réponses chiffrées et l'écart, avec le score.
 * Le nom des élèves est répété sur chaque ligne pour pouvoir assembler les rendus.
 * @param rows  lignes de `resultRows()` (report.js)
 */
export function buildTeacherCsv(rows, { names = '', widthMeters = null, template }) {
  const unit = widthMeters ? 'm' : '% du plan';
  const named = [titleField(template), subtitleField(template)].filter(Boolean);
  const questions = questionFields(template);
  const header = [
    'Élèves',
    'N°',
    'Réf. photo',
    ...(named.length ? named.map((field) => field.label) : ['Fiche']),
    ...questions.map(columnTitle),
    'Résultat',
    `Écart (${unit})`
  ];
  const gap = (ev) => (ev.d === undefined ? null : widthMeters ? (ev.d / 100) * widthMeters : ev.d);
  const answer = (field, value) => (field.type === 'number' && num(value) !== null ? frNum(num(value)) : csvCell(valueText(field, value)));
  const lines = [header.map(csvCell).join(';')];
  for (const { n, fiche, entry, ev } of rows) {
    lines.push(
      [
        csvCell(names),
        csvCell(n),
        csvCell(fiche.ref),
        ...(named.length ? named.map((field) => csvCell(fiche[field.id])) : [csvCell(titleOf(fiche, template))]),
        ...questions.map((field) => answer(field, entry[field.id])),
        csvCell(ev.label),
        frNum(gap(ev))
      ].join(';')
    );
  }
  const scored = rows.filter((r) => r.ev.state !== 'noref');
  const ok = scored.filter((r) => r.ev.state === 'ok').length;
  lines.push(
    [
      csvCell(names),
      '',
      '',
      'Moyenne',
      ...Array(Math.max(named.length, 1) - 1).fill(''),
      ...questions.map((field) => (field.type === 'number' ? frNum(average(rows.map((r) => num(r.entry[field.id])))) : '')),
      scored.length ? `${ok} / ${scored.length} bien placée(s)` : '',
      frNum(average(rows.map((r) => gap(r.ev))))
    ].join(';')
  );
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** Le modèle de tableur d'un cours : ses colonnes, et une fiche d'exemple faite des exemples du modèle de fiche. */
export function templateCsv(template, { answers = withAnswers() } = {}) {
  const example = { ref: '1' };
  for (const field of ficheFields(template)) {
    if (field.placeholder) example[field.id] = field.placeholder;
    else if (field.type === 'choice') example[field.id] = field.choices[0].id;
  }
  return buildCsv([newFiche(example, template)], { entries: {} }, template, { answers });
}
