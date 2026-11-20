/**
 * Le modèle de fiche d'un cours : la liste ordonnée de ses champs, leur type, et ce qu'on peut y écrire.
 *
 * Sans DOM ni stockage : ce module sert au navigateur et au serveur, comme model.js. La valeur d'un champ se range dans la
 * fiche sous l'identifiant du champ, et une réponse d'élève dans son entrée de progression, de la même façon : un cours de
 * format 3, dont les champs sont ceux du modèle botanique, est déjà un cours de format 4 (docs/ARCHITECTURE.md).
 */
import { frDate, str, uid } from './util.js';

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

/** En clair, pour l'enseignant. */
export const TYPE_LABELS = {
  text: 'Texte court',
  longtext: 'Texte long',
  number: 'Nombre',
  date: 'Date',
  choice: 'Choix',
  yesno: 'Oui / non',
  scale: 'Échelle',
  heading: 'Intertitre'
};

/**
 * Comment une question est corrigée (4.4 de la feuille de route, QST) : par le serveur d'après la réponse attendue de chaque
 * fiche, par l'enseignant plus tard, ou pas du tout (une mesure est seulement recueillie). Sans réglage, chaque type a le
 * sien : le modèle botanique, figé, garde ainsi ses mesures « non corrigées ».
 */
export const CHECKS = {
  text: ['auto', 'teacher', 'none'],
  longtext: ['teacher', 'none'],
  number: ['auto', 'teacher', 'none'],
  choice: ['auto', 'none'],
  yesno: ['auto', 'none'],
  scale: ['auto', 'none']
};
const DEFAULT_CHECK = { text: 'teacher', longtext: 'teacher', number: 'none', choice: 'auto', yesno: 'auto', scale: 'auto' };
/** La correction d'une question ; rien pour un champ qui n'en est pas une. */
export const checkOf = (field) => (field.audience === 'question' ? (field.check ?? DEFAULT_CHECK[field.type]) : undefined);

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
/** Les champs qui paraissent dans la liste des fiches, sous le titre et le sous-titre. */
export const listFields = (template) => template.fields.filter((field) => field.list && !field.role && !isHeading(field));

/**
 * Les champs rangés sous leurs intertitres, dans l'ordre du modèle. Le premier groupe n'a pas d'intertitre ; un intertitre
 * sans libellé ferme le groupe précédent et en ouvre un sans titre. Un groupe vide disparaît.
 */
export function fieldGroups(template) {
  const groups = [{ heading: null, fields: [] }];
  for (const field of template.fields) {
    if (isHeading(field)) groups.push({ heading: field.label ? field : null, fields: [] });
    else groups.at(-1).fields.push(field);
  }
  return groups.filter((group) => group.fields.length);
}

/** Le titre de colonne d'un champ, dans un tableur ou un tableau : « Température (°C) ». */
export const columnTitle = (field) => (field.unit ? `${field.label} (${field.unit})` : field.label);
/* ------------------------------------------------------------------ */
/* Valeurs                                                              */
/* ------------------------------------------------------------------ */

const choiceIds = (field) => new Set((field.choices ?? []).map((choice) => choice.id));

/** Ce qu'un élève peut écrire en réponse : une mesure reste courte (50 caractères, comme avant la version 2.0.0). */
export const ANSWER_LIMITS = { text: LIMITS.text, longtext: 2000, number: 50 };

/** La longueur permise d'un texte : celui de l'enseignant, ou la réponse d'un élève (`answer`). */
export const maxLength = (field, { answer = false } = {}) =>
  answer ? (ANSWER_LIMITS[field.type] ?? LIMITS.text) : field.type === 'longtext' ? LIMITS.longtext : LIMITS.text;

/**
 * La valeur d'un champ, quelle que soit sa forme d'origine. Le texte reste du texte, comme en format 3 : une mesure
 * « nuageux » est acceptée (MES-04), et 12 devient « 12 ». Ce qui ne correspond à rien devient vide plutôt qu'une erreur,
 * et un texte trop long est coupé à sa limite : le serveur refuserait sinon tout le cours ou toutes les réponses.
 * @param o.answer la réponse d'un élève, plus courte (ANSWER_LIMITS)
 */
export function normalizeValue(field, raw, { answer = false } = {}) {
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
      return str(raw).slice(0, maxLength(field, { answer }));
  }
}

/**
 * Une valeur telle qu'elle doit arriver au serveur : déjà dans sa forme normale, sans rien à corriger. Le serveur refuse ce
 * qui ne l'est pas, plutôt que de le réparer (COU-14, CHP-07).
 */
export function isValidValue(field, value, { answer = false } = {}) {
  switch (field.type) {
    case 'choice': {
      const ids = choiceIds(field);
      if (field.multiple) return Array.isArray(value) && value.every((id) => ids.has(id)) && new Set(value).size === value.length;
      return value === '' || ids.has(value);
    }
    case 'yesno':
      return value === '' || value === 'oui' || value === 'non';
    case 'scale':
      return value === '' || (Number.isInteger(value) && value >= 1 && value <= (field.max ?? LIMITS.scale));
    default:
      return typeof value === 'string' && value.length <= maxLength(field, { answer });
  }
}

/** Rien d'écrit ni de choisi. */
export const isEmpty = (value) => value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);

/** Les réponses d'une fiche avant que l'élève n'écrive : chaque question, vide. */
export const emptyAnswers = (template) => Object.fromEntries(questionFields(template).map((field) => [field.id, normalizeValue(field, undefined)]));

/** Ce que notent les élèves : des « mesures » quand toutes les questions sont des nombres, sinon des « réponses ». */
export function answersWord(template) {
  const questions = questionFields(template);
  return questions.length && questions.every((field) => field.type === 'number') ? 'mesures' : 'réponses';
}

/** Les questions en clair, pour une phrase : « température, hygrométrie, éclairement ». Un sigle garde ses majuscules. */
export const questionNames = (template) =>
  questionFields(template)
    .map(({ label }) => (/^\p{Lu}\p{Ll}/u.test(label) ? label[0].toLowerCase() + label.slice(1) : label))
    .join(', ');

/** L'élève a-t-il répondu à au moins une question de cette fiche ? */
export const hasAnswers = (entry, template) => questionFields(template).some((field) => !isEmpty(entry?.[field.id]));

/**
 * Une valeur telle qu'on la lit : le libellé d'un choix, « Oui », une date à la française, des ☀️ pour une échelle. Une
 * mesure garde le texte de l'élève ; `unit` lui ajoute son unité.
 */
export function valueText(field, value, { unit = false } = {}) {
  if (isEmpty(value)) return '';
  switch (field.type) {
    case 'choice':
      return (Array.isArray(value) ? value : [value])
        .map((id) => field.choices?.find((choice) => choice.id === id)?.label)
        .filter(Boolean)
        .join(', ');
    case 'yesno':
      return { oui: 'Oui', non: 'Non' }[value] ?? '';
    case 'scale':
      return field.symbol ? field.symbol.repeat(Number(value) || 0) : `${value} / ${field.max ?? LIMITS.scale}`;
    case 'date':
      return frDate(value);
    case 'number':
      return unit && field.unit ? `${value} ${field.unit}` : str(value);
    default:
      return str(value);
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
  text: [...COMMON, 'role', 'search', 'placeholder', 'required', 'check'],
  longtext: [...COMMON, 'search', 'placeholder', 'required', 'check'],
  number: [...COMMON, 'unit', 'keyboard', 'placeholder', 'required', 'check'],
  date: COMMON,
  choice: [...COMMON, 'choices', 'multiple', 'required', 'check'],
  yesno: [...COMMON, 'required', 'check'],
  scale: [...COMMON, 'max', 'symbol', 'required', 'check'],
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
  if (field.check !== undefined && (field.audience !== 'question' || !CHECKS[field.type]?.includes(field.check))) fail('correction impossible pour ce champ');
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
 * Un champ réduit à ce qui a un sens pour son type et son public, tel que l'éditeur l'enregistre : ni réglage vide, ni case
 * décochée, ni rôle pour une question. Le modèle reste ainsi court, et templateProblems() n'y trouve rien d'inconnu.
 */
export function cleanField(raw) {
  const field = {};
  for (const key of KEPT[raw.type] ?? []) {
    const value = raw[key];
    if (value === undefined || value === false || (value === '' && key !== 'label')) continue;
    if (Array.isArray(value) && !value.length) continue;
    field[key] = typeof value === 'string' && key !== 'label' ? value.trim() : value;
  }
  field.label = String(raw.label ?? '').trim();
  const question = field.audience === 'question';
  if (!question) for (const key of ['required', 'check']) delete field[key];
  // Une correction qui ne va pas au type laisse place à celle du type
  if (field.check && !CHECKS[field.type].includes(field.check)) delete field.check;
  if (field.audience !== 'info') for (const key of ['role', 'search']) delete field[key];
  if (field.type === 'choice') field.choices = (field.choices ?? []).map(({ id, label }) => ({ id, label: label.trim() }));
  return field;
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
