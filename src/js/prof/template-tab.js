/**
 * Onglet « Modèle de fiche » de la page d'un cours (MOD-03, étape 4 de la version 2.0.0) : les champs de ses fiches, leur
 * ordre et leurs réglages, et un aperçu de la fiche telle que la verront les élèves, sur un téléphone ou un ordinateur.
 *
 * Chaque modification passe par templateProblems() avant d'être enregistrée : un modèle mal formé ne part jamais, et le
 * serveur le refuserait de toute façon (CHP-07). Quand des fiches ont déjà des valeurs, l'éditeur dit ce qu'elles
 * perdraient avant de rien changer (6.3).
 */
import { S, changedMap, changedMeta, courseTemplate } from '../store.js';
import { render } from '../render.js';
import { $, errorText, esc, toast } from '../util.js';
import { newFiche, normalizeFiche, normalizeProject, projectFromText, subtitleOf, templateFrom, titleOf } from '../model.js';
import { api } from '../api.js';
import { reportIncident } from '../incident.js';
import { openCourseId } from './course-tab.js';
import {
  AUDIENCE_LABELS,
  CHECKS,
  CHECK_LABELS,
  COMPATIBLE,
  LIMITS,
  TYPES,
  TYPE_LABELS,
  checkOf,
  cleanField,
  isEmpty,
  isHeading,
  newFieldId,
  questionFields,
  templateProblems
} from '../fields.js';
import { button, el } from '../compte/ui.js';
import { GRADING_LABELS, GRADING_MODES, gradedQuestions, normalizeGrading } from '../verdicts.js';
import { cardAnswersHTML, ficheBodyHTML, listLinesHTML } from '../views/fields-html.js';

const allFiches = () => S.project.maps.flatMap((map) => map.fiches);
/** Les fiches qui ont écrit quelque chose dans ce champ. */
const filled = (id) => allFiches().filter((fiche) => !isEmpty(fiche[id]));

/** « 3 questions : 2 corrigées automatiquement, 1 à corriger par vous. » (4.4 de la feuille de route) */
export function summaryText(template) {
  const questions = questionFields(template);
  if (!questions.length) return 'Aucune question : les élèves lisent les fiches, et les placent sur le plan s’il y en a un.';
  const counts = { auto: 0, teacher: 0, none: 0 };
  for (const field of questions) counts[checkOf(field)]++;
  const parts = [
    counts.auto && `${counts.auto} corrigée${counts.auto > 1 ? 's' : ''} automatiquement`,
    counts.teacher && `${counts.teacher} à corriger par vous`,
    counts.none && `${counts.none} non corrigée${counts.none > 1 ? 's' : ''}`
  ].filter(Boolean);
  return `${questions.length} question${questions.length > 1 ? 's' : ''} : ${parts.join(', ')}.`;
}

/* ------------------------------------------------------------------ */
/* Enregistrer                                                          */
/* ------------------------------------------------------------------ */

/**
 * Remplace le modèle du cours, et relit chaque fiche avec lui : une valeur suit son champ, et ce que le modèle ne connaît
 * plus disparaît. Renvoie le problème qui l'empêche, ou rien.
 */
function applyTemplate(next) {
  const [problem] = templateProblems(next);
  if (problem) return problem;
  S.project.template = next;
  // Le barème d'une question supprimée, ou qui ne se corrige plus, part avec elle : le serveur refuserait sinon le cours
  S.project.grading = normalizeGrading(S.project.grading, next);
  for (const map of S.project.maps) {
    map.fiches = map.fiches.map((fiche) => normalizeFiche(fiche, next));
    changedMap(map);
  }
  changedMeta();
  render();
  return '';
}

/** Combien de fiches perdraient ou verraient changer la valeur de ce champ avec ce modèle. */
function changedBy(next, id) {
  return allFiches().filter((fiche) => !isEmpty(fiche[id]) && JSON.stringify(normalizeFiche(fiche, next)[id]) !== JSON.stringify(fiche[id])).length;
}

const withFields = (fields) => ({ ...courseTemplate(), fields });
const moved = (fields, from, to) => {
  const copy = [...fields];
  copy.splice(to, 0, ...copy.splice(from, 1));
  return copy;
};

/* ------------------------------------------------------------------ */
/* La liste des champs                                                  */
/* ------------------------------------------------------------------ */

function rowHTML(field, i, count) {
  const heading = isHeading(field);
  const name = esc(field.label || 'fin du groupe');
  const details = heading
    ? [TYPE_LABELS.heading]
    : [
        TYPE_LABELS[field.type] + (field.type === 'choice' && field.multiple ? ' multiple' : ''),
        AUDIENCE_LABELS[field.audience],
        field.role === 'title' && 'titre',
        field.role === 'subtitle' && 'sous-titre',
        field.list && 'dans la liste'
      ].filter(Boolean);
  const check = checkOf(field);
  const label =
    heading && !field.label ? '<em>Fin du groupe</em>' : `${field.icon ? `<span aria-hidden="true">${esc(field.icon)}</span> ` : ''}${esc(field.label)}`;
  return `<div class="tpl-row${heading ? ' is-heading' : ''}" draggable="true" data-row="${esc(field.id)}">
      <div class="tpl-main">
        <strong>${label}</strong>
        <span class="state">${esc(details.join(' · '))}</span>
        ${check ? `<span class="check-badge ${check}">${CHECK_LABELS[check]}</span>` : ''}
      </div>
      <div class="actions">
        <button type="button" class="btn ghost sm" data-up="${i}" aria-label="Monter « ${name} »" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn ghost sm" data-down="${i}" aria-label="Descendre « ${name} »" ${i === count - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="btn soft sm" data-field="${esc(field.id)}" aria-label="Modifier « ${name} »">Modifier</button>
        <button type="button" class="btn danger sm" data-remove="${esc(field.id)}" aria-label="Supprimer « ${name} »" title="Supprimer le champ">🗑</button>
      </div>
    </div>`;
}

export function html() {
  const template = courseTemplate();
  const rows = template.fields.map((field, i) => rowHTML(field, i, template.fields.length)).join('');
  return `
    <div class="inline spread"><h2 style="margin:0">Modèle de fiche</h2><span class="inline"><button type="button" class="btn ghost sm" id="tplReuse">Reprendre la fiche d’un autre cours</button><button type="button" class="btn soft sm" id="tplPreview">Aperçu</button></span></div>
    <p class="sub">Les champs de toutes les fiches de ce cours, dans l’ordre où les élèves les lisent. Les élèves voient vos changements à la prochaine publication ; un lancement en cours garde la version avec laquelle il a été lancé.</p>
    <div class="field"><label for="tplName">Nom du modèle</label>
      <div class="inline"><input id="tplName" class="text-input" maxlength="${LIMITS.name}" value="${esc(template.name ?? '')}"><button type="button" class="btn soft sm" id="tplRename">Renommer</button></div></div>
    <p class="tpl-summary" id="tplSummary">${esc(summaryText(template))}</p>
    <div class="rows tpl-rows">${rows || '<div class="empty-box">Aucun champ : les fiches n’ont que leur réf. photo, leurs photos et leur place sur le plan.</div>'}</div>
    ${gradingHTML(template)}
    <div class="section">
      <h3>Ajouter un champ</h3>
      <p>Il s’ajoute à la fin : déplacez-le ensuite avec ▲ ▼, ou en le glissant.</p>
      <div class="inline">${TYPES.map((type) => `<button type="button" class="btn ghost sm" data-add="${type}">＋ ${TYPE_LABELS[type]}</button>`).join('')}</div>
    </div>`;
}

export function bind(panel) {
  const fields = () => courseTemplate().fields;
  $('#tplRename').onclick = () => {
    const name = $('#tplName').value.trim();
    const next = { ...courseTemplate(), name };
    if (!name) delete next.name;
    const problem = applyTemplate(next);
    toast(problem ? `⚠ ${problem}` : 'Modèle renommé');
  };
  $('#tplPreview').onclick = () => openPreview();
  $('#tplReuse').onclick = () => openReuse();
  for (const b of panel.querySelectorAll('[data-add]')) b.onclick = () => openField(null, b.dataset.add);
  for (const b of panel.querySelectorAll('[data-field]')) b.onclick = () => openField(fields().find((field) => field.id === b.dataset.field));
  for (const b of panel.querySelectorAll('[data-up], [data-down]')) {
    b.onclick = () => {
      const i = Number(b.dataset.up ?? b.dataset.down);
      applyTemplate(withFields(moved(fields(), i, b.dataset.up !== undefined ? i - 1 : i + 1)));
    };
  }
  for (const b of panel.querySelectorAll('[data-remove]')) b.onclick = () => removeField(b.dataset.remove);
  bindDrag(panel);
  bindGrading(panel);
}

/* ------------------------------------------------------------------ */
/* Notation (QST-05)                                                    */
/* ------------------------------------------------------------------ */

const hasPlan = () => S.project.maps.some((map) => map.image);

/** Le choix de la notation, et selon lui le barème ou la note maximale. Un lancement en garde une copie, qu'il peut changer. */
function gradingHTML(template) {
  const grading = S.project.grading;
  const questions = gradedQuestions(template);
  const modes = GRADING_MODES.map(
    (mode) =>
      `<label class="check"><input type="radio" name="gradingMode" value="${mode}" ${grading.mode === mode ? 'checked' : ''}> ${esc(GRADING_LABELS[mode])}</label>`
  ).join('');
  const number = (id, value, label, more = '') =>
    `<div class="field grading-points"><label for="${id}">${esc(label)}</label><input id="${id}" class="text-input" inputmode="decimal" value="${esc(String(value).replace('.', ','))}" ${more}></div>`;
  let settings = '';
  if (grading.mode === 'points')
    settings =
      questions
        .map((field) => number(`points-${field.id}`, grading.points[field.id] ?? 1, `${field.label} : points par fiche`, `data-points="${esc(field.id)}"`))
        .join('') + (hasPlan() ? number('pointsPlacement', grading.placement, 'Placement : points par fiche') : '');
  if (grading.mode === 'auto')
    settings =
      number('gradingMax', grading.max, 'Note maximale') +
      (hasPlan()
        ? `<label class="check"><input type="checkbox" id="gradingPlacement" ${grading.placement ? 'checked' : ''}> Compter le placement dans la note</label>`
        : '');
  return `<div class="section">
      <h3>Notation</h3>
      <p>Une réponse à moitié juste rapporte la moitié ; une réponse sans réponse, rien. Tant qu’il reste des réponses à corriger, la note est provisoire. Un lancement reprend la notation de sa version ; vous pouvez ensuite la changer dans la page du lancement.</p>
      ${questions.length || hasPlan() ? modes + settings : '<p class="hint">Ce cours n’a ni question corrigée ni plan : rien à noter.</p>'}
    </div>`;
}

function bindGrading(panel) {
  const save = (raw) => {
    S.project.grading = normalizeGrading(raw, courseTemplate());
    changedMeta();
  };
  for (const radio of panel.querySelectorAll('[name="gradingMode"]'))
    radio.onchange = () => {
      save({ mode: radio.value, placement: radio.value === 'auto' ? hasPlan() : 1 });
      render();
    };
  const read = () => {
    const grading = S.project.grading;
    if (grading.mode === 'points') {
      const points = Object.fromEntries([...panel.querySelectorAll('[data-points]')].map((input) => [input.dataset.points, input.value]));
      save({ mode: 'points', points, placement: $('#pointsPlacement')?.value ?? grading.placement });
    }
    if (grading.mode === 'auto') save({ mode: 'auto', max: $('#gradingMax').value, placement: $('#gradingPlacement')?.checked ?? false });
  };
  for (const input of panel.querySelectorAll('[data-points], #pointsPlacement, #gradingMax, #gradingPlacement')) input.onchange = read;
}

/** Glisser une ligne sur une autre la place avant elle. */
function bindDrag(panel) {
  for (const row of panel.querySelectorAll('[data-row]')) {
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', row.dataset.row);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drop');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop');
      const fields = courseTemplate().fields;
      const from = fields.findIndex((field) => field.id === e.dataTransfer.getData('text/plain'));
      const to = fields.findIndex((field) => field.id === row.dataset.row);
      if (from < 0 || to < 0 || from === to) return;
      applyTemplate(withFields(moved(fields, from, from < to ? to - 1 : to)));
    });
  }
}

function removeField(id) {
  const field = courseTemplate().fields.find((x) => x.id === id);
  const lost = field.audience === 'question' ? [] : filled(id);
  const name = field.label || 'cette fin de groupe';
  const message =
    `Supprimer « ${name} » du modèle ?` +
    (lost.length ? `\n\n${lost.length} fiche(s) perdront ce qu’elles y ont écrit.` : '') +
    (field.audience === 'question' ? '\n\nLes réponses déjà rendues restent dans l’historique de leur lancement.' : '');
  if (!confirm(message)) return;
  const problem = applyTemplate(withFields(courseTemplate().fields.filter((x) => x.id !== id)));
  toast(problem ? `⚠ ${problem}` : `Champ « ${name} » supprimé`);
}

/* ------------------------------------------------------------------ */
/* La fenêtre d'un champ                                                */
/* ------------------------------------------------------------------ */

const QUESTION_TYPES = ['text', 'longtext', 'number', 'choice', 'yesno', 'scale'];
const ROLE_LABELS = { '': 'Aucun', title: 'Titre de la fiche', subtitle: 'Sous-titre, en italique' };
const KEYBOARD_LABELS = { decimal: 'Nombre à virgule', numeric: 'Nombre entier' };

/** Un champ neuf, avec un réglage de départ pour son type. */
function blankField(type) {
  if (type === 'heading') return { id: newFieldId('h'), type, label: '' };
  const field = { id: newFieldId('c'), type, label: '', audience: type === 'date' ? 'info' : 'question' };
  if (type === 'choice')
    field.choices = [
      { id: newFieldId('r'), label: '' },
      { id: newFieldId('r'), label: '' }
    ];
  if (type === 'scale') field.max = 5;
  return field;
}

const select = (id, value, options, { disabled = () => false } = {}) =>
  el('select', { id }, ...Object.entries(options).map(([key, label]) => el('option', { value: key, selected: key === value, disabled: disabled(key) }, label)));
const labelled = (text, control, help = '') =>
  el('div', { className: 'field' }, el('label', { htmlFor: control.id }, text), control, ...(help ? [el('span', { className: 'hint' }, help)] : []));
const checkbox = (id, text, checked) => el('label', { className: 'check' }, el('input', { type: 'checkbox', id, checked: Boolean(checked) }), ` ${text}`);

/**
 * Ouvre la fenêtre d'un champ, ou d'un nouveau champ de ce type. Rien ne change avant « Enregistrer » ; la fenêtre se refait
 * quand le type ou le public change, pour ne montrer que les réglages qui ont un sens.
 */
export function openField(existing, type) {
  const isNew = !existing;
  const draft = structuredClone(existing ?? blankField(type));
  // Un champ déjà rempli ne change de type que vers un type qui garde ses valeurs (6.3)
  const locked = !isNew && draft.audience !== 'question' && filled(draft.id).length > 0;
  const body = el('div', { className: 'dlg-body' });
  const error = el('p', { className: 'form-error', role: 'alert', hidden: true });
  const close = button('×', 'x', () => dialog.close());
  close.setAttribute('aria-label', 'Fermer');
  const save = button('Enregistrer', 'btn', () => submit());
  const dialog = el(
    'dialog',
    { className: 'field-dialog', 'aria-label': isNew ? 'Nouveau champ' : `Champ « ${draft.label} »` },
    el(
      'div',
      { className: 'dlg' },
      el('div', { className: 'dlg-head' }, el('h2', {}, isNew ? `Nouveau champ : ${TYPE_LABELS[draft.type].toLowerCase()}` : 'Modifier le champ'), close),
      body,
      el(
        'div',
        { className: 'dlg-foot' },
        error,
        button('Annuler', 'btn ghost', () => dialog.close()),
        save
      )
    )
  );
  dialog.addEventListener('close', () => dialog.remove());

  function build() {
    const heading = isHeading(draft);
    const parts = [];
    const label = el('input', { id: 'fLabel', value: draft.label ?? '', maxLength: LIMITS.label });
    label.oninput = () => (draft.label = label.value);
    parts.push(
      labelled(
        heading ? 'Intertitre' : 'Libellé',
        label,
        heading ? 'Laissé vide, il ferme le groupe précédent : les champs suivants ne sont plus sous un intertitre.' : ''
      )
    );
    if (!heading) {
      const types = Object.fromEntries(TYPES.filter((t) => t !== 'heading').map((t) => [t, TYPE_LABELS[t]]));
      const typeSelect = select('fType', draft.type, types, { disabled: (t) => locked && !COMPATIBLE[existing.type].includes(t) });
      typeSelect.onchange = () => {
        draft.type = typeSelect.value;
        if (draft.type === 'choice' && !draft.choices?.length) draft.choices = blankField('choice').choices;
        if (draft.type === 'scale') draft.max ??= 5;
        if (draft.type === 'date' && draft.audience === 'question') draft.audience = 'info';
        delete draft.check;
        build();
      };
      parts.push(
        labelled(
          'Type',
          typeSelect,
          locked ? 'Des fiches ont déjà une valeur ici : seuls les types qui la gardent sont proposés. Pour un autre, créez un nouveau champ.' : ''
        )
      );
      const audience = select('fAudience', draft.audience, AUDIENCE_LABELS, { disabled: (a) => a === 'question' && !QUESTION_TYPES.includes(draft.type) });
      audience.onchange = () => {
        draft.audience = audience.value;
        build();
      };
      parts.push(
        labelled(
          'Qui le remplit, qui le voit',
          audience,
          {
            info: 'Vous le remplissez, l’élève le lit.',
            question: 'L’élève y répond ; vous lisez sa réponse.',
            correction: 'Vous le remplissez ; l’élève ne le lit qu’à la correction, à la fin du cours.',
            teacher: 'Vous le remplissez ; personne d’autre ne le lit.'
          }[draft.audience]
        )
      );
      if (draft.audience === 'question') {
        const check = select('fCheck', checkOf(draft), Object.fromEntries(CHECKS[draft.type].map((c) => [c, CHECK_LABELS[c]])));
        check.onchange = () => (draft.check = check.value);
        parts.push(
          labelled(
            'Correction',
            check,
            'Corrigée automatiquement : vous donnerez la bonne réponse de chaque fiche. À corriger par vous : vous la corrigerez après le cours. Non corrigée : la réponse est seulement recueillie, comme une mesure.'
          )
        );
      }
      if (draft.type === 'choice') parts.push(choicesEditor());
      if (draft.type === 'scale') {
        const max = select('fMax', String(draft.max ?? 5), { 2: '2', 3: '3', 4: '4', 5: '5' });
        max.onchange = () => (draft.max = Number(max.value));
        const symbol = el('input', { id: 'fSymbol', value: draft.symbol ?? '', maxLength: LIMITS.icon, placeholder: '⭐' });
        symbol.oninput = () => (draft.symbol = symbol.value);
        parts.push(
          el(
            'div',
            { className: 'form-grid' },
            labelled('De 1 à', max),
            labelled('Symbole', symbol, 'Répété pour chaque cran : ⭐⭐⭐. Sans symbole, un chiffre.')
          )
        );
      }
      if (draft.type === 'number') {
        const unit = el('input', { id: 'fUnit', value: draft.unit ?? '', maxLength: LIMITS.unit, placeholder: '°C' });
        unit.oninput = () => (draft.unit = unit.value);
        const keyboard = select('fKeyboard', draft.keyboard ?? 'decimal', KEYBOARD_LABELS);
        keyboard.onchange = () => (draft.keyboard = keyboard.value);
        parts.push(el('div', { className: 'form-grid' }, labelled('Unité', unit), labelled('Clavier du téléphone', keyboard)));
      }
      if (draft.type === 'text' && draft.audience === 'info') {
        const role = select('fRole', draft.role ?? '', ROLE_LABELS);
        role.onchange = () => (draft.role = role.value || undefined);
        parts.push(labelled('Rôle', role, 'Le titre nomme la fiche partout ; le sous-titre s’affiche dessous.'));
      }
      const icon = el('input', { id: 'fIcon', value: draft.icon ?? '', maxLength: LIMITS.icon, placeholder: '☀️' });
      icon.oninput = () => (draft.icon = icon.value);
      parts.push(labelled('Icône', icon, 'Un émoji, montré devant le libellé.'));
      if (['text', 'longtext', 'number'].includes(draft.type)) {
        const placeholder = el('input', { id: 'fPlaceholder', value: draft.placeholder ?? '', maxLength: LIMITS.placeholder });
        placeholder.oninput = () => (draft.placeholder = placeholder.value);
        parts.push(labelled('Exemple', placeholder, 'Montré en gris dans la case vide, et repris par le modèle de tableur.'));
      }
      const options = [];
      const list = checkbox('fList', 'Dans la liste des fiches', draft.list);
      list.querySelector('input').onchange = (e) => (draft.list = e.target.checked);
      options.push(list);
      if (['text', 'longtext'].includes(draft.type) && draft.audience === 'info') {
        const search = checkbox('fSearch', 'Sert à la recherche', draft.search);
        search.querySelector('input').onchange = (e) => (draft.search = e.target.checked);
        options.push(search);
      }
      if (draft.audience === 'question') {
        const required = checkbox('fRequired', 'Obligatoire', draft.required);
        required.querySelector('input').onchange = (e) => (draft.required = e.target.checked);
        options.push(required);
      }
      parts.push(el('div', { className: 'field' }, ...options));
    }
    const help = el('textarea', { id: 'fHelp', value: draft.help ?? '', maxLength: LIMITS.help, rows: 2 });
    help.oninput = () => (draft.help = help.value);
    parts.push(labelled('Aide', help, heading ? 'Sous l’intertitre, pour les élèves.' : 'Une phrase sous le champ, pour les élèves.'));
    body.replaceChildren(...parts);
  }

  /** Les propositions d'un choix, dans l'ordre : chacune garde son identifiant, et donc les réponses déjà données. */
  function choicesEditor() {
    const rows = draft.choices.map((choice, i) => {
      const input = el('input', { value: choice.label, maxLength: LIMITS.label, 'aria-label': `Proposition ${i + 1}` });
      input.oninput = () => (choice.label = input.value);
      const remove = button('🗑', 'btn danger sm', () => {
        draft.choices.splice(i, 1);
        build();
      });
      remove.setAttribute('aria-label', `Retirer la proposition ${i + 1}`);
      remove.disabled = draft.choices.length <= 2;
      return el('div', { className: 'choice-row' }, input, remove);
    });
    const add = button('＋ Proposition', 'btn ghost sm', () => {
      draft.choices.push({ id: newFieldId('r'), label: '' });
      build();
      body.querySelector('.choice-row:last-of-type input')?.focus();
    });
    add.disabled = draft.choices.length >= LIMITS.choices;
    const multiple = checkbox('fMultiple', 'Plusieurs réponses possibles', draft.multiple);
    multiple.querySelector('input').onchange = (e) => (draft.multiple = e.target.checked);
    return el('div', { className: 'field' }, el('span', { className: 'field-title' }, 'Propositions'), ...rows, add, multiple);
  }

  function submit() {
    const field = cleanField(draft);
    const fields = courseTemplate().fields;
    const next = withFields(isNew ? [...fields, field] : fields.map((x) => (x.id === field.id ? field : x)));
    const [problem] = templateProblems(next);
    if (problem) {
      error.textContent = problem.replace(/^champ \d+ : /, '');
      error.hidden = false;
      return;
    }
    const lost = isNew ? 0 : changedBy(next, field.id);
    if (lost && !confirm(`${lost} fiche(s) perdront ou verront changer ce qu’elles ont écrit dans « ${existing.label} ». Continuer ?`)) return;
    applyTemplate(next);
    dialog.close();
    toast(isNew ? `✓ Champ « ${field.label || 'fin de groupe'} » ajouté` : '✓ Champ enregistré');
  }

  build();
  document.body.append(dialog);
  dialog.showModal();
  $('#fLabel').focus();
}

/* ------------------------------------------------------------------ */
/* Reprendre la fiche d'un autre cours                                  */
/* ------------------------------------------------------------------ */

/** Combien de fiches perdraient une partie de ce qu'elles ont écrit avec ce modèle. */
function fichesLosing(next) {
  const current = courseTemplate().fields;
  return allFiches().filter((fiche) => {
    const read = normalizeFiche(fiche, next);
    return current.some((field) => !isEmpty(fiche[field.id]) && JSON.stringify(read[field.id]) !== JSON.stringify(fiche[field.id]));
  }).length;
}

/**
 * Remplace le modèle de ce cours par celui d'un autre (4.2, 6.3) : les valeurs des champs de même identifiant restent, et
 * l'enseignant sait d'avance combien de fiches perdent quelque chose.
 */
function reuseTemplate(next, from) {
  const lost = fichesLosing(next);
  const message =
    `Remplacer le modèle de fiche de ce cours par celui de « ${from} » ?\n\nLes valeurs des champs qu’ils ont en commun sont gardées.` +
    (lost ? `\n\n${lost} fiche(s) perdront une partie de ce qu’elles ont écrit.` : '');
  if (!confirm(message)) return false;
  const problem = applyTemplate(next);
  toast(problem ? `⚠ ${problem}` : `✓ Fiche de « ${from} » reprise`);
  return !problem;
}

/** La liste de ses autres cours, et un fichier de cours d'un collègue (Q-C). */
export async function openReuse() {
  const error = el('p', { className: 'form-error', role: 'alert', hidden: true });
  const list = el('div', { className: 'reuse-list' }, el('p', { className: 'hint' }, 'Chargement de vos cours…'));
  const close = button('×', 'x', () => dialog.close());
  close.setAttribute('aria-label', 'Fermer');
  const file = el('input', { type: 'file', accept: '.json,.html,.htm' });
  const dialog = el(
    'dialog',
    { className: 'field-dialog', 'aria-label': 'Reprendre la fiche d’un autre cours' },
    el(
      'div',
      { className: 'dlg' },
      el('div', { className: 'dlg-head' }, el('h2', {}, 'Reprendre la fiche d’un autre cours'), close),
      el(
        'div',
        { className: 'dlg-body' },
        el('p', {}, 'Son modèle de fiche remplace celui de ce cours. Ses fiches ne viennent pas, et l’autre cours ne change pas.'),
        list,
        el('label', { className: 'btn ghost sm file-btn' }, 'D’un fichier de cours (.json)…', file),
        error
      )
    )
  );
  dialog.addEventListener('close', () => dialog.remove());
  const fail = (e) => {
    reportIncident('Modèle de fiche', e);
    error.textContent = `Impossible de reprendre cette fiche : ${errorText(e)}`;
    error.hidden = false;
  };
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    try {
      const project = normalizeProject(projectFromText(await chosen.text()));
      if (reuseTemplate(templateFrom(project), project.title)) dialog.close();
    } catch (e) {
      fail(e);
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  try {
    const others = (await api('GET', '/courses')).filter((course) => course.id !== openCourseId());
    list.replaceChildren(
      ...(others.length
        ? others.map((other) =>
            button(`Fiche de « ${other.title} »`, 'btn ghost sm', async () => {
              try {
                const { draft } = await api('GET', `/courses/${other.id}`);
                if (reuseTemplate(templateFrom(normalizeProject(draft), other.id), other.title)) dialog.close();
              } catch (e) {
                fail(e);
              }
            })
          )
        : [el('p', { className: 'hint' }, 'Vous n’avez pas d’autre cours.')])
    );
  } catch (e) {
    fail(e);
  }
}

/* ------------------------------------------------------------------ */
/* Aperçu                                                               */
/* ------------------------------------------------------------------ */

/** Une fiche pour l'aperçu : la première qui a quelque chose, sinon une fiche faite des exemples du modèle. */
function sampleFiche(template) {
  const fiche = allFiches().find((f) => template.fields.some((field) => !isEmpty(f[field.id])));
  if (fiche) return { fiche, source: `D’après la fiche « ${titleOf(fiche, template)} ».` };
  const values = Object.fromEntries(template.fields.filter((field) => field.placeholder).map((field) => [field.id, field.placeholder]));
  return { fiche: newFiche(values, template), source: 'D’après les exemples du modèle.' };
}

/** La fiche telle que la voit un élève, dans la largeur d'un téléphone ou d'un ordinateur, pendant le cours ou à la correction. */
export function openPreview() {
  const template = courseTemplate();
  const { fiche, source } = sampleFiche(template);
  const state = { width: 'phone', revealed: false };
  const frame = el('div', { className: 'preview-frame' });
  const toggle = (key, value, label) => {
    const node = button(label, 'chip', () => {
      state[key] = value;
      draw();
    });
    node.dataset.preview = `${key}:${value}`;
    return node;
  };
  const toggles = [
    toggle('width', 'phone', 'Téléphone'),
    toggle('width', 'desktop', 'Ordinateur'),
    toggle('revealed', false, 'Pendant le cours'),
    toggle('revealed', true, 'À la correction')
  ];
  const close = button('×', 'x', () => dialog.close());
  close.setAttribute('aria-label', 'Fermer');
  const dialog = el(
    'dialog',
    { className: 'preview-dialog', 'aria-label': 'Aperçu de la fiche' },
    el(
      'div',
      { className: 'dlg' },
      el('div', { className: 'dlg-head' }, el('div', { style: 'flex:1' }, el('h2', {}, 'Aperçu de la fiche'), el('p', { className: 'state' }, source)), close),
      el('div', { className: 'dlg-body' }, el('div', { className: 'chips' }, ...toggles), frame)
    )
  );
  dialog.addEventListener('close', () => dialog.remove());

  function draw() {
    for (const node of toggles)
      node.setAttribute('aria-pressed', String(node.dataset.preview === `width:${state.width}` || node.dataset.preview === `revealed:${state.revealed}`));
    frame.className = `preview-frame ${state.width}`;
    const sub = subtitleOf(fiche, template);
    frame.innerHTML = `
      <p class="field-title">Dans la liste</p>
      <article class="label preview-card">
        <div class="photo"></div>
        <div class="label-body"><h3>${esc(titleOf(fiche, template))}</h3>${sub ? `<p class="sci">${esc(sub)}</p>` : ''}${listLinesHTML(template, fiche)}</div>
        ${cardAnswersHTML(template, fiche, {}, { title: titleOf(fiche, template) })}
      </article>
      <p class="field-title">Fiche ouverte</p>
      <div class="dlg preview-fiche">
        <div class="dlg-head"><div style="flex:1;min-width:0"><h2><span class="num">1</span>${esc(titleOf(fiche, template))}</h2>${sub ? `<p class="sci">${esc(sub)}</p>` : ''}</div></div>
        <div class="dlg-body"><div class="read-text">${ficheBodyHTML(template, fiche, {}, { revealed: state.revealed })}</div></div>
      </div>`;
  }

  draw();
  document.body.append(dialog);
  dialog.showModal();
}
