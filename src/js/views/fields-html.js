/**
 * Le moteur d'affichage des champs : une fiche ouverte par l'élève, ses cases de réponse dans la liste, le formulaire de
 * l'enseignant. Tout se déduit du modèle du cours : aucun nom de champ n'est écrit ici. Libellés, aides, choix et valeurs
 * viennent de l'enseignant ou de l'élève : ils passent tous par esc() (SEC-04).
 *
 * Mise en page, d'après la place d'un champ dans le modèle :
 *  - hors intertitre, un texte court se lit en tête de fiche (« Famille »), un texte long en paragraphe (« Description ») ;
 *  - sous un intertitre, les champs se lisent en tableau (« Besoins »), et les questions se regroupent dans un cadre
 *    (« Vos mesures »).
 */
import { esc } from '../util.js';
import { LIMITS, checkOf, fieldGroups, isEmpty, isHeading, listFields, maxLength, normalizeValue, questionFields, titleField, valueText } from '../fields.js';
import { MAX_ACCEPTED, VERDICT_LABELS, expectedText, normalizeExpectedOf } from '../verdicts.js';

const isQuestion = (field) => field.audience === 'question';
/** Une question obligatoire le dit, à côté de son libellé (QST-06). */
const required = (field) => (field.required ? ' <span class="required">obligatoire</span>' : '');
const icon = (field) => (field.icon ? `<span aria-hidden="true">${esc(field.icon)}</span>` : '');
const hint = (text) => (text ? `<span class="hint">${esc(text)}</span>` : '');
const attr = (name, value) => (value ? ` ${name}="${esc(value)}"` : '');
/** La longueur permise, dans la case même : un texte trop long ferait refuser tout le cours ou tout le rendu par le serveur. */
const max = (field, answer) => ` maxlength="${maxLength(field, { answer })}"`;
/** Les propositions d'une question fermée : [valeur, texte]. */
function options(field) {
  if (field.type === 'yesno')
    return [
      ['oui', 'Oui'],
      ['non', 'Non']
    ];
  if (field.type === 'scale')
    return Array.from({ length: field.max ?? 5 }, (_, i) => [String(i + 1), field.symbol ? field.symbol.repeat(i + 1) : String(i + 1)]);
  return (field.choices ?? []).map((choice) => [choice.id, choice.label]);
}
const isChoice = (field) => ['choice', 'yesno', 'scale'].includes(field.type);
const selected = (value, option) => (Array.isArray(value) ? value.includes(option) : String(value) === option);

/* ------------------------------------------------------------------ */
/* Fiche ouverte (élève)                                               */
/* ------------------------------------------------------------------ */

/**
 * Ce que voit l'élève d'un champ que remplit l'enseignant : les renseignements toujours, ce qui est révélé à la correction
 * une fois le travail corrigé, la note de l'enseignant seulement en gestion.
 */
const shown = (field, { revealed, teacher }) =>
  field.audience === 'info' || (field.audience === 'correction' && (revealed || teacher)) || (field.audience === 'teacher' && teacher);

/**
 * Le verdict d'une question, une fois la correction reçue (QST-03) : juste ou faux, avec la bonne réponse quand l'élève
 * s'est trompé ; une question ouverte annonce que l'enseignant la corrigera plus tard (Q-O).
 */
function verdictHTML(field, verdict, expected) {
  if (!verdict) return '';
  if (verdict === 'pending') return '<p class="verdict pending">Corrigée plus tard par l’enseignant</p>';
  const answer = expected !== undefined && verdict !== 'ok' ? ` · bonne réponse : ${esc(expectedText(field, expected))}` : '';
  return `<p class="verdict ${verdict}">${VERDICT_LABELS[verdict]}${answer}</p>`;
}

/** La case de réponse d'une question, dans la fiche ouverte. */
function answerHTML(field, value, disabled, verdict = '') {
  const id = `m-${field.id}`;
  const off = disabled ? ' disabled' : '';
  if (isChoice(field)) {
    const type = field.type === 'choice' && field.multiple ? 'checkbox' : 'radio';
    const choices = options(field)
      .map(
        ([option, text]) =>
          `<label class="choice"><input type="${type}" name="${esc(id)}" value="${esc(option)}"${selected(value, option) ? ' checked' : ''}${off}><span>${esc(text)}</span></label>`
      )
      .join('');
    return `<fieldset class="measure wide" data-k="${esc(field.id)}"><legend>${esc(field.label)}${required(field)}</legend><div class="choices">${choices}</div>${hint(field.help)}${verdict}</fieldset>`;
  }
  const label = `<label for="${esc(id)}">${esc(field.label)}${required(field)}</label>`;
  if (field.type === 'longtext')
    return `<div class="measure wide">${label}<textarea id="${esc(id)}" data-k="${esc(field.id)}" rows="3"${max(field, true)}${attr('placeholder', field.placeholder)}${off}>${esc(value)}</textarea>${hint(field.help)}${verdict}</div>`;
  const mode = field.type === 'number' ? ` inputmode="${field.keyboard ?? 'decimal'}"` : '';
  return `<div class="measure">${label}<div class="unit-input"><input id="${esc(id)}" data-k="${esc(field.id)}"${mode}${max(field, true)} value="${esc(value)}"${attr('placeholder', field.placeholder)}${off}>${field.unit ? `<span>${esc(field.unit)}</span>` : ''}</div>${hint(field.help)}${verdict}</div>`;
}

/**
 * Le corps d'une fiche ouverte, après son titre : ce que l'enseignant a écrit et les questions, dans l'ordre du modèle.
 * @param entry les réponses de l'élève à cette fiche
 * @param o.disabled le travail est figé : les réponses se relisent sans se modifier
 * @param o.revealed le travail est corrigé : ce qui est révélé à la correction paraît
 * @param o.teacher en gestion : tout paraît
 * @param o.correction le résultat de cette fiche reçu du serveur : le verdict de chaque question et ses bonnes réponses
 */
export function ficheBodyHTML(template, fiche, entry, { disabled = false, revealed = false, teacher = false, correction = null } = {}) {
  const parts = [];
  for (const { heading, fields } of fieldGroups(template)) {
    const infos = fields.filter((field) => !isQuestion(field) && !field.role && shown(field, { revealed, teacher }) && !isEmpty(fiche[field.id]));
    const questions = fields.filter(isQuestion);
    const value = (field) => esc(valueText(field, fiche[field.id], { unit: true }));
    const table = infos.length
      ? `<dl class="needs">${infos.map((field) => `<div class="need"><dt>${icon(field)}${esc(field.label)}</dt><dd>${value(field)}</dd></div>`).join('')}</dl>`
      : '';
    if (heading && !questions.length) {
      // Un groupe de renseignements se replie, pour aller plus vite aux questions sur un téléphone (MOB-01)
      if (table)
        parts.push(
          `<details class="read-group" open><summary><h3 class="mini-h">${esc(heading.label)}</h3></summary>${heading.help ? `<p class="hint">${esc(heading.help)}</p>` : ''}${table}</details>`
        );
      continue;
    }
    if (!heading) {
      const facts = infos.filter((field) => field.type !== 'longtext');
      const prose = infos.filter((field) => field.type === 'longtext');
      if (facts.length)
        parts.push(`<dl class="facts">${facts.map((field) => `<div><dt>${esc(field.label)}</dt><dd>${value(field)}</dd></div>`).join('')}</dl>`);
      if (prose.length)
        parts.push(`<div class="prose">${prose.map((field) => `<h3>${icon(field)}${esc(field.label)}</h3><p>${value(field)}</p>`).join('')}</div>`);
      if (!questions.length) continue;
    }
    parts.push(`<div class="measures">
          ${heading ? `<h3>${esc(heading.label)}</h3>` : ''}
          ${heading?.help && !disabled ? `<p>${esc(heading.help)}</p>` : ''}
          ${heading ? table : ''}
          <div class="measure-grid">
            ${questions
              .map((field) =>
                answerHTML(field, entry?.[field.id] ?? '', disabled, verdictHTML(field, correction?.questions?.[field.id], correction?.expected?.[field.id]))
              )
              .join('')}
          </div>
          <div class="saved-note"></div>
        </div>`);
  }
  return parts.join('\n');
}

/** La réponse portée par une case : celle de la fiche ouverte (data-k) ou celle de la liste (data-answer). */
export function answerOf(field, control) {
  if (control.matches('fieldset')) {
    const checked = [...control.querySelectorAll('input:checked')].map((input) => input.value);
    return normalizeValue(field, field.multiple ? checked : (checked[0] ?? ''));
  }
  if (control.matches('select')) return normalizeValue(field, control.value);
  return control.value.trim();
}

/* ------------------------------------------------------------------ */
/* Liste des fiches                                                     */
/* ------------------------------------------------------------------ */

/** Les lignes sous le titre d'une fiche dans la liste : les champs marqués « dans la liste », hors questions. */
export const listLinesHTML = (template, fiche) =>
  listFields(template)
    .filter((field) => !isQuestion(field) && field.audience === 'info' && !isEmpty(fiche[field.id]))
    .map((field) => `<p class="fam">${esc(valueText(field, fiche[field.id], { unit: true }))}</p>`)
    .join('');

/** Les questions qui ont leur case sur la carte d'une fiche : les réponses courtes marquées « dans la liste ». */
export const cardQuestions = (template) =>
  questionFields(template).filter((field) => field.list && (['text', 'number'].includes(field.type) || (isChoice(field) && !field.multiple)));

/**
 * Les cases de réponse sur la carte d'une fiche, dans la liste : une saisie pour un texte ou une mesure, une liste
 * déroulante pour un choix.
 */
export function cardAnswersHTML(template, fiche, entry, { disabled = false, title = '' } = {}) {
  const questions = cardQuestions(template);
  if (!questions.length) return '';
  const off = disabled ? ' disabled' : '';
  const cells = questions.map((field) => {
    const value = entry?.[field.id] ?? '';
    const name = field.unit ? `${field.label} en ${field.unit}` : field.label;
    const data = `data-answer="${esc(field.id)}" data-id="${esc(fiche.id)}" aria-label="${esc(`${name}, ${title}`)}"`;
    const input = isChoice(field)
      ? `<select ${data}${off}><option value="">—</option>${options(field)
          .map(([option, text]) => `<option value="${esc(option)}"${selected(value, option) ? ' selected' : ''}>${esc(text)}</option>`)
          .join('')}</select>`
      : `<input ${data}${field.type === 'number' ? ` inputmode="${field.keyboard ?? 'decimal'}"` : ''}${max(field, true)} value="${esc(value)}"${off} placeholder="—">`;
    return `<label title="${esc(field.unit ? `${field.label} (${field.unit})` : field.label)}">${icon(field)}${input}${field.unit ? `<em>${esc(field.unit)}</em>` : ''}</label>`;
  });
  return `<div class="card-measures${questions.length < 3 ? ` n${questions.length}` : ''}">${cells.join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/* Formulaire de l'enseignant                                           */
/* ------------------------------------------------------------------ */

const AUDIENCE_BADGES = { correction: 'Révélé à la correction', teacher: 'Pour vous seul' };
const WIDE = (field) => field.type === 'longtext' || (field.type === 'choice' && field.multiple);

function controlHTML(field, value, { compact }) {
  const id = `e-${field.id}`;
  // Une question n'est dans ce formulaire qu'au fichier de secours, où l'enseignant écrit à la place d'un élève
  const data = `id="${esc(id)}" data-f="${esc(field.id)}"${isChoice(field) ? '' : max(field, isQuestion(field))}`;
  const placeholder = attr('placeholder', field.placeholder);
  switch (field.type) {
    case 'longtext':
      return `<textarea ${data}${compact ? ' rows="2"' : ''}${placeholder}>${esc(value)}</textarea>`;
    case 'date':
      return `<input ${data} type="date" value="${esc(value)}">`;
    case 'number': {
      const input = `<input ${data} inputmode="${field.keyboard ?? 'decimal'}" value="${esc(value)}"${placeholder}>`;
      return field.unit ? `<div class="unit-input">${input}<span>${esc(field.unit)}</span></div>` : input;
    }
    case 'choice':
      if (field.multiple)
        return `<div class="checks" ${data}>${options(field)
          .map(
            ([option, text]) =>
              `<label class="check"><input type="checkbox" value="${esc(option)}"${selected(value, option) ? ' checked' : ''}> ${esc(text)}</label>`
          )
          .join('')}</div>`;
    // fallthrough : un choix unique se règle comme un oui / non ou une échelle
    case 'yesno':
    case 'scale':
      return `<select ${data}><option value="">—</option>${options(field)
        .map(([option, text]) => `<option value="${esc(option)}"${selected(value, option) ? ' selected' : ''}>${esc(text)}</option>`)
        .join('')}</select>`;
    default:
      return `<input ${data} value="${esc(value)}"${placeholder}>`;
  }
}

/**
 * La bonne réponse d'une question corrigée automatiquement, sur cette fiche (QST-01) : les réponses acceptées d'un texte,
 * une par ligne ; la valeur et la tolérance d'un nombre ; la bonne proposition d'un choix.
 */
function expectedHTML(field, value) {
  const id = `x-${field.id}`;
  const data = `id="${esc(id)}" data-x="${esc(field.id)}"`;
  const unit = field.unit ? `<span>${esc(field.unit)}</span>` : '';
  switch (field.type) {
    case 'text':
      return `<textarea ${data} rows="2" maxlength="${(LIMITS.text + 1) * MAX_ACCEPTED}" placeholder="Une réponse acceptée par ligne">${esc((value ?? []).join('\n'))}</textarea>`;
    case 'number':
      return `<div class="expected-number"><div class="unit-input"><input ${data} inputmode="decimal" value="${esc(value?.value ?? '')}" aria-label="Valeur attendue">${unit}</div><label for="${esc(id)}-tol">à</label><div class="unit-input"><input id="${esc(id)}-tol" data-tolerance="${esc(field.id)}" inputmode="decimal" value="${esc(value?.tolerance || '')}" placeholder="0">${unit}</div><span>près</span></div>`;
    case 'choice':
      if (field.multiple)
        return `<div class="checks" ${data}>${options(field)
          .map(
            ([option, text]) =>
              `<label class="check"><input type="checkbox" value="${esc(option)}"${selected(value ?? [], option) ? ' checked' : ''}> ${esc(text)}</label>`
          )
          .join('')}</div>`;
    // fallthrough : un choix unique se règle comme un oui / non ou une échelle
    default:
      return `<select ${data}><option value="">—</option>${options(field)
        .map(([option, text]) => `<option value="${esc(option)}"${value !== undefined && selected(value, option) ? ' selected' : ''}>${esc(text)}</option>`)
        .join('')}</select>`;
  }
}

function fieldHTML(field, value, { compact, wide, expected = false }) {
  const label = `${field.icon ? `${esc(field.icon)} ` : ''}${esc(field.label)}`;
  if (expected) {
    const answer = ' <span class="aud">Bonne réponse</span>';
    const title =
      field.type === 'choice' && field.multiple
        ? `<span class="field-title">${label}${answer}</span>`
        : `<label for="x-${esc(field.id)}">${label}${answer}</label>`;
    return `<div class="field${wide ? ' wide' : ''}">${title}${expectedHTML(field, value)}<span class="hint">Sans bonne réponse sur cette fiche, vous corrigerez cette question vous-même.</span></div>`;
  }
  const badge = AUDIENCE_BADGES[field.audience] ? ` <span class="aud">${AUDIENCE_BADGES[field.audience]}</span>` : '';
  const title =
    field.type === 'choice' && field.multiple
      ? `<span class="field-title">${label}${badge}</span>`
      : `<label for="e-${esc(field.id)}">${label}${badge}</label>`;
  return `<div class="field${wide ? ' wide' : ''}">${title}${controlHTML(field, value, { compact })}${hint(field.help)}</div>`;
}

/**
 * Une suite de champs sur deux colonnes : un champ large prend toute la ligne. Une ligne restée à moitié vide se complète
 * d'un vide, ou, sous un intertitre, son champ s'élargit (« Entretien » sous « Besoins »).
 */
function columnsHTML(items, { compact = false } = {}) {
  const cells = [];
  let half = false;
  for (const { field, value, expected } of items) {
    const wide = compact ? field.type === 'choice' && field.multiple : WIDE(field);
    if (wide && half && compact) cells.at(-1).wide = true;
    else if (wide && half) cells.push('<div class="field"></div>');
    cells.push({ field, value, wide, expected });
    half = wide ? false : !half;
  }
  if (half && compact) cells.at(-1).wide = true;
  else if (half) cells.push('<div class="field"></div>');
  return cells
    .map((cell) => (typeof cell === 'string' ? cell : fieldHTML(cell.field, cell.value, { compact, wide: cell.wide, expected: cell.expected })))
    .join('');
}

/**
 * Le formulaire d'une fiche : sa réf. photo, puis chaque champ du modèle, groupe par groupe. Les questions n'y sont que
 * dans l'application d'origine, où l'enseignant peut noter des mesures à la place des élèves.
 * Dans l'espace enseignant (`answers` vaut null), seules les questions corrigées automatiquement y sont, pour leur bonne
 * réponse sur cette fiche (QST-01).
 * @param answers les réponses de la fiche, ou null : l'espace enseignant
 */
export function ficheFormHTML(template, fiche, answers) {
  const item = (field) => {
    if (!isQuestion(field)) return { field, value: fiche[field.id] };
    if (answers) return { field, value: answers[field.id] ?? '' };
    return checkOf(field) === 'auto' ? { field, value: fiche.expected?.[field.id], expected: true } : null;
  };
  const groups = fieldGroups(template)
    .map(({ heading, fields }) => ({ heading, items: fields.map(item).filter(Boolean) }))
    .filter((group) => group.items.length);
  const ref = {
    field: {
      id: 'ref',
      type: 'text',
      label: 'Réf. photo (étiquette sur le terrain)',
      placeholder: '12b',
      help: 'Le numéro vu par les élèves est automatique.'
    },
    value: fiche.ref
  };
  let html = '';
  groups.forEach((group, i) => {
    const items = i === 0 && !group.heading ? [ref, ...group.items] : group.items;
    if (!group.heading) {
      html += columnsHTML(items);
      return;
    }
    html += `<div class="field wide needs-edit">
          <div class="needs-head"><h3>${esc(group.heading.label)}</h3></div>
          <div class="needs-grid">${columnsHTML(items, { compact: true })}</div>
        </div>`;
  });
  if (!groups.length || groups[0].heading) html = columnsHTML([ref]) + html;
  return html;
}

/** Ce que contient le formulaire : les valeurs de la fiche et, s'il y en a, les réponses. Chacune lue selon son champ. */
export function readForm(template, root) {
  const values = { ref: root.querySelector('[data-f="ref"]')?.value.trim() ?? '' };
  const answers = {};
  for (const field of template.fields) {
    if (isHeading(field)) continue;
    const node = root.querySelector(`[data-f="${field.id}"]`);
    if (!node) continue;
    const raw = node.matches('.checks') ? [...node.querySelectorAll('input:checked')].map((input) => input.value) : node.value.trim();
    (isQuestion(field) ? answers : values)[field.id] = normalizeValue(field, raw);
  }
  const expected = root.querySelectorAll('[data-x]');
  if (expected.length) {
    const raw = {};
    for (const node of expected) {
      const id = node.dataset.x;
      const tolerance = root.querySelector(`[data-tolerance="${id}"]`);
      if (node.matches('.checks')) raw[id] = [...node.querySelectorAll('input:checked')].map((input) => input.value);
      else if (node.matches('textarea')) raw[id] = node.value.split('\n');
      else if (tolerance) raw[id] = { value: node.value, tolerance: tolerance.value };
      else raw[id] = node.value;
    }
    values.expected = normalizeExpectedOf(raw, template);
  }
  return { values, answers };
}

/** Le premier endroit où écrire dans une nouvelle fiche : son titre, sinon le premier champ. */
export const firstControl = (template, root) =>
  root.querySelector(`[data-f="${titleField(template)?.id}"]`) ?? root.querySelector('[data-f]:not([data-f="ref"])') ?? root.querySelector('[data-f]');
