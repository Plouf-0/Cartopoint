/**
 * Le modèle de fiche d'un cours : la liste ordonnée de ses champs, leur type, et ce qu'on peut y écrire.
 *
 * Sans DOM ni stockage : ce module sert au navigateur et au serveur, comme model.js. La valeur d'un champ se range dans la
 * fiche sous l'identifiant du champ, et une réponse d'élève dans son entrée de progression, de la même façon : un cours de
 * format 3, dont les champs sont ceux du modèle botanique, est déjà un cours de format 4 (docs/ARCHITECTURE.md).
 */
import { str, uid } from './util.js';

/** Types de champs. Un intertitre n'a pas de valeur : il regroupe les champs qui le suivent, jusqu'au suivant. */
export const TYPES = ['text', 'longtext', 'number', 'date', 'choice', 'yesno', 'scale', 'heading'];

/**
 * Qui remplit, qui voit :
 *  - info : l'enseignant remplit, l'élève lit ;
 *  - question : l'élève répond, l'enseignant lit sa réponse ;
 *  - correction : l'enseignant remplit, l'élève ne le lit qu'à la fin du cours ;
 *  - teacher : l'enseignant remplit, personne d'autre ne le lit.
 */
export const AUDIENCES = ['info', 'question', 'correction', 'teacher'];

/** Une question ne peut pas être une date : rien à y répondre qu'on ne demanderait mieux autrement. */
const QUESTION_TYPES = new Set(['text', 'longtext', 'number', 'choice', 'yesno', 'scale']);
const SEARCHABLE = new Set(['text', 'longtext']);

export const LIMITS = {
  name: 120,
  fields: 60,
  id: 40,
  label: 120,
  help: 300,
  icon: 16,
  unit: 20,
  placeholder: 120,
  choices: 30,
  aliases: 10,
  alias: 60,
  scale: 5,
  text: 300,
  longtext: 10000
};

/** Les propriétés d'une fiche et d'une réponse : un champ qui porterait l'un de ces noms écraserait autre chose. */
export const RESERVED = new Set([
  'id',
  'ref',
  'code',
  'name',
  'visible',
  'studentEnabled',
  'refX',
  'refY',
  'thumbnailId',
  'media',
  'expected',
  'locations',
  'x',
  'y',
  'at',
  'placed',
  'verified',
  'entries',
  'constructor',
  'prototype',
  '__proto__',
  'hasOwnProperty',
  'toString',
  'valueOf'
]);

const ID = /^[a-z][a-zA-Z0-9_-]*$/;

/** Identifiant d'un nouveau champ ou d'un nouveau choix : préfixé, il ne croise jamais une propriété de la fiche. */
export const newFieldId = (prefix = 'c') => `${prefix}-${uid().replace(/-/g, '').slice(0, 10)}`;

export const isHeading = (field) => field.type === 'heading';
/** Les champs que l'enseignant remplit, rangés dans la fiche. */
export const ficheFields = (template) => template.fields.filter((field) => !isHeading(field) && field.audience !== 'question');
/** Les questions, auxquelles l'élève répond. */
export const questionFields = (template) => template.fields.filter((field) => field.audience === 'question');
export const titleField = (template) => template.fields.find((field) => field.role === 'title');
export const subtitleField = (template) => template.fields.find((field) => field.role === 'subtitle');
export const searchFields = (template) => template.fields.filter((field) => field.search);

/* ------------------------------------------------------------------ */
/* Valeurs                                                              */
/* ------------------------------------------------------------------ */

const choiceIds = (field) => new Set((field.choices ?? []).map((choice) => choice.id));

/**
 * La valeur d'un champ, quelle que soit sa forme d'origine. Le texte reste du texte, comme en format 3 : une mesure
 * « nuageux » est acceptée (MES-04), et 12 devient « 12 ». Ce qui ne correspond à rien devient vide plutôt qu'une erreur.
 */
export function normalizeValue(field, raw) {
  switch (field.type) {
    case 'choice': {
      const ids = choiceIds(field);
      if (field.multiple) return [...new Set((Array.isArray(raw) ? raw : [raw]).filter((id) => ids.has(id)))];
      return ids.has(raw) ? raw : '';
    }
    case 'yesno':
      if (raw === true || raw === 'oui') return 'oui';
      if (raw === false || raw === 'non') return 'non';
      return '';
    case 'scale': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= (field.max ?? LIMITS.scale) ? n : '';
    }
    default:
      return str(raw);
  }
}

/* ------------------------------------------------------------------ */
/* Modèle                                                               */
/* ------------------------------------------------------------------ */

const isText = (value, max, { empty = true } = {}) => typeof value === 'string' && value.length <= max && (empty || value.trim() !== '');
const optionalText = (value, max) => value === undefined || isText(value, max);
const optionalBool = (value) => value === undefined || typeof value === 'boolean';

/** Les propriétés gardées pour chaque type : tout le reste disparaît à la lecture, et ne part donc jamais chez un élève. */
const COMMON = ['id', 'type', 'label', 'icon', 'help', 'audience', 'list', 'aliases'];
const KEPT = {
  text: [...COMMON, 'role', 'search', 'placeholder', 'required'],
  longtext: [...COMMON, 'search', 'placeholder', 'required'],
  number: [...COMMON, 'unit', 'keyboard', 'placeholder', 'required'],
  date: COMMON,
  choice: [...COMMON, 'choices', 'multiple', 'required'],
  yesno: [...COMMON, 'required'],
  scale: [...COMMON, 'max', 'symbol', 'required'],
  heading: ['id', 'type', 'label', 'help']
};

function fieldProblems(field, index) {
  const where = `champ ${index + 1}`;
  if (!field || typeof field !== 'object' || Array.isArray(field)) return [`${where} : ce n'est pas un champ`];
  const problems = [];
  const fail = (message) => problems.push(`${where} : ${message}`);
  if (!TYPES.includes(field.type)) return [`${where} : type inconnu`];
  if (typeof field.id !== 'string' || !ID.test(field.id) || field.id.length > LIMITS.id || RESERVED.has(field.id)) fail('identifiant invalide');
  for (const key of Object.keys(field)) if (!KEPT[field.type].includes(key)) fail(`propriété inconnue « ${key.slice(0, 40)} »`);
  if (isHeading(field)) {
    if (!isText(field.label, LIMITS.label)) fail('intertitre invalide');
    if (!optionalText(field.help, LIMITS.help)) fail('aide trop longue');
    return problems;
  }
  if (!isText(field.label, LIMITS.label, { empty: false })) fail('il faut un libellé de 120 caractères au plus');
  if (!AUDIENCES.includes(field.audience)) fail('public inconnu');
  if (field.audience === 'question' && !QUESTION_TYPES.has(field.type)) fail('ce type ne peut pas être une question');
  if (!optionalText(field.icon, LIMITS.icon)) fail('icône trop longue');
  if (!optionalText(field.help, LIMITS.help)) fail('aide trop longue');
  if (!optionalText(field.placeholder, LIMITS.placeholder)) fail('exemple trop long');
  if (!optionalBool(field.list) || !optionalBool(field.search) || !optionalBool(field.required) || !optionalBool(field.multiple)) fail('réglage invalide');
  if (field.search && (!SEARCHABLE.has(field.type) || field.audience !== 'info')) fail('seul un texte lu par les élèves sert à la recherche');
  if (field.required && field.audience !== 'question') fail('seule une question peut être obligatoire');
  if (
    field.aliases !== undefined &&
    (!Array.isArray(field.aliases) || field.aliases.length > LIMITS.aliases || !field.aliases.every((alias) => isText(alias, LIMITS.alias)))
  )
    fail('titres de colonne invalides');
  if (field.role !== undefined && (!['title', 'subtitle'].includes(field.role) || field.audience !== 'info')) fail('rôle invalide');
  if (field.type === 'number') {
    if (!optionalText(field.unit, LIMITS.unit)) fail('unité trop longue');
    if (field.keyboard !== undefined && !['decimal', 'numeric'].includes(field.keyboard)) fail('clavier inconnu');
  }
  if (field.type === 'scale') {
    if (field.max !== undefined && !(Number.isInteger(field.max) && field.max >= 2 && field.max <= LIMITS.scale)) fail('échelle de 2 à 5');
    if (!optionalText(field.symbol, LIMITS.icon)) fail('symbole trop long');
  }
  if (field.type === 'choice') {
    const choices = field.choices;
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > LIMITS.choices) fail('de 2 à 30 propositions');
    else {
      const ids = new Set();
      for (const choice of choices) {
        const valid =
          choice &&
          typeof choice === 'object' &&
          Object.keys(choice).every((key) => key === 'id' || key === 'label') &&
          typeof choice.id === 'string' &&
          ID.test(choice.id) &&
          choice.id.length <= LIMITS.id &&
          isText(choice.label, LIMITS.label, { empty: false });
        if (!valid) fail('proposition invalide');
        else if (ids.has(choice.id)) fail('deux propositions ont le même identifiant');
        ids.add(choice?.id);
      }
    }
  }
  return problems;
}

/**
 * Ce qui ne va pas dans un modèle, en clair : vide s'il est bon. Le serveur s'en sert pour refuser un brouillon (étape 3 de
 * la version 2.0.0), le navigateur pour refuser un fichier.
 */
export function templateProblems(template) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) return ["ce n'est pas un modèle de fiche"];
  const problems = [];
  for (const key of Object.keys(template)) if (!['name', 'source', 'fields'].includes(key)) problems.push(`propriété inconnue « ${key.slice(0, 40)} »`);
  if (!optionalText(template.name, LIMITS.name)) problems.push('nom trop long');
  const source = template.source;
  if (
    source !== undefined &&
    !(
      source &&
      typeof source === 'object' &&
      Object.keys(source).every((key) => key === 'courseId' || key === 'title') &&
      optionalText(source.courseId, LIMITS.label) &&
      optionalText(source.title, LIMITS.label)
    )
  )
    problems.push('origine invalide');
  const fields = template.fields;
  if (!Array.isArray(fields) || fields.length > LIMITS.fields) return [...problems, `il faut une liste de ${LIMITS.fields} champs au plus`];
  fields.forEach((field, i) => problems.push(...fieldProblems(field, i)));
  const ids = fields.map((field) => field?.id);
  if (new Set(ids).size !== ids.length) problems.push('deux champs ont le même identifiant');
  for (const role of ['title', 'subtitle'])
    if (fields.filter((field) => field?.role === role).length > 1) problems.push(`un seul champ peut servir de ${role === 'title' ? 'titre' : 'sous-titre'}`);
  return problems;
}

/** Une copie propre d'un modèle valable, ou une erreur qui dit pourquoi il ne l'est pas. */
export function normalizeTemplate(raw) {
  const problems = templateProblems(raw);
  if (problems.length) throw new Error(`modèle de fiche invalide : ${problems[0]}`);
  return structuredClone(raw);
}
