/**
 * Onglet « Éditeur de fiches » de la page d'un cours (MOD-03, MOD-06, MOD-09) : la fiche se compose sur elle-même.
 *
 * Au centre, à la place du plan, la fiche telle que la lira un élève, dans la largeur d'un téléphone ou d'un ordinateur,
 * pendant le cours ou à la correction : elle sert d'aperçu. Sur le côté, les éléments vierges, à glisser dans la fiche à
 * l'endroit voulu, ou à ajouter d'un clic. Un élément choisi s'écrit à sa place, comme l'élève le lira (libellé, aide,
 * exemple, propositions, unité), et déplie ses réglages ; chaque modification s'applique aussitôt.
 *
 * Chaque modification passe par templateProblems() avant d'être enregistrée : un modèle mal formé ne part jamais, et le
 * serveur le refuserait de toute façon (CHP-07). Tant qu'un élément est impossible (un libellé vide), il le dit et rien
 * n'est enregistré. Quand des fiches ont déjà des valeurs, l'éditeur dit ce qu'elles perdraient avant de rien changer (MOD-05).
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
  templateProblems,
  titleField
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
const savedField = (id) => courseTemplate().fields.find((field) => field.id === id);

/* ------------------------------------------------------------------ */
/* L'élément choisi                                                     */
/* ------------------------------------------------------------------ */

/**
 * Ce que montre la fiche du centre : sa largeur, le moment du cours, l'élément choisi et son brouillon. Le brouillon garde ce
 * qui est écrit tant que ce n'est pas enregistré : la page peut se redessiner entre-temps sans rien perdre.
 */
const view = { width: 'desktop', revealed: false, real: false, selected: null, draft: null, error: '', focus: null };

/**
 * Choisit un élément, ou aucun. Un brouillon impossible ne s'enregistre pas : en partant ailleurs, l'enseignant le laisse,
 * et l'élément reprend ce qui était enregistré.
 */
function select(id) {
  if (view.error && view.selected !== id) toast(`Modification annulée : ${view.error}`);
  view.selected = id;
  view.draft = id ? structuredClone(savedField(id)) : null;
  view.error = '';
}

/** Après le changement en cours : un clic ailleurs fait d'abord enregistrer la case que l'on quitte. */
const later = (fn) => setTimeout(fn, 0);

/** Un élément neuf, prêt à écrire : un libellé de départ et, pour un choix, deux propositions. */
export function blankField(type, audience = 'question') {
  if (type === 'heading') return { id: newFieldId('h'), type, label: 'Intertitre' };
  const question = audience === 'question' && type !== 'date';
  const label = question ? 'Nouvelle question' : type === 'date' ? 'Date' : 'Nouveau champ';
  const field = { id: newFieldId('c'), type, label, audience: question ? 'question' : 'info' };
  if (type === 'choice')
    field.choices = [
      { id: newFieldId('r'), label: 'Proposition 1' },
      { id: newFieldId('r'), label: 'Proposition 2' }
    ];
  if (type === 'scale') field.max = 5;
  return field;
}

/** Ajoute un élément vierge à cette place (sous l'élément choisi, sinon à la fin), le choisit, et sélectionne son libellé. */
function addField(type, audience, at) {
  const fields = courseTemplate().fields;
  const after = fields.findIndex((field) => field.id === view.selected);
  const index = at ?? (after >= 0 ? after + 1 : fields.length);
  const field = blankField(type, audience);
  select(null);
  // Ajouter un élément, c'est modifier la fiche : l'aperçu réel laisse la place à l'éditeur
  Object.assign(view, { real: false, selected: field.id, draft: structuredClone(field), focus: { key: 'label', all: true } });
  const problem = applyTemplate(withFields([...fields.slice(0, index), field, ...fields.slice(index)]));
  if (problem) {
    select(null);
    toast(`⚠ ${problem}`);
  }
}

/** Déplace un élément devant celui qui est à cette place (ou à la fin). */
function moveField(id, index) {
  const fields = courseTemplate().fields;
  const from = fields.findIndex((field) => field.id === id);
  const to = from < index ? index - 1 : index;
  if (from < 0 || to === from) return;
  applyTemplate(withFields(moved(fields, from, to)));
}

function removeField(id) {
  const field = savedField(id);
  const lost = field.audience === 'question' ? [] : filled(id);
  const name = field.label || 'cette fin de groupe';
  const message =
    `Supprimer « ${name} » du modèle ?` +
    (lost.length ? `\n\n${lost.length} fiche(s) perdront ce qu’elles y ont écrit.` : '') +
    (field.audience === 'question' ? '\n\nLes réponses déjà rendues restent dans l’historique de leur lancement.' : '');
  if (!confirm(message)) return;
  if (view.selected === id) Object.assign(view, { selected: null, draft: null, error: '' });
  const problem = applyTemplate(withFields(courseTemplate().fields.filter((x) => x.id !== id)));
  toast(problem ? `⚠ ${problem}` : `Élément « ${name} » supprimé`);
}

/**
 * Enregistre le brouillon d'un élément, s'il est possible ; sinon, le dit dans l'élément. Un changement qui fait perdre ou
 * changer la valeur de fiches déjà remplies demande d'abord une confirmation (MOD-05).
 */
function commit(draft) {
  const saved = savedField(draft.id);
  if (!saved) return;
  const current = view.selected === draft.id;
  const field = cleanField(draft);
  const next = withFields(courseTemplate().fields.map((x) => (x.id === field.id ? field : x)));
  const [problem] = templateProblems(next);
  if (problem) {
    if (current) view.error = problem.replace(/^champ \d+ : /, '');
    return redraw();
  }
  if (current) view.error = '';
  if (JSON.stringify(field) === JSON.stringify(saved)) return redraw();
  const lost = changedBy(next, field.id);
  if (lost && !confirm(`${lost} fiche(s) perdront ou verront changer ce qu’elles ont écrit dans « ${saved.label} ». Continuer ?`)) {
    if (current) view.draft = structuredClone(saved);
    return redraw();
  }
  if (current) view.draft = structuredClone(field);
  applyTemplate(next);
}

/** Un changement de type garde ce qui a encore un sens, et donne au reste un réglage de départ. */
function setType(draft, type) {
  draft.type = type;
  if (type === 'choice' && !draft.choices?.length) draft.choices = blankField('choice').choices;
  if (type === 'scale') draft.max ??= 5;
  if (type === 'date' && draft.audience === 'question') draft.audience = 'info';
  delete draft.check;
}

/** Ce qu'une case de l'élément choisi change dans son brouillon. */
function readControl(control) {
  const draft = view.draft;
  const key = control.dataset.edit;
  const value = control.type === 'checkbox' ? control.checked : control.value;
  if (key.startsWith('choice-')) draft.choices[Number(key.slice(7))].label = value;
  else if (key === 'type') setType(draft, value);
  else if (key === 'max') draft.max = Number(value);
  else if (key === 'role') draft.role = value || undefined;
  else draft[key] = value;
}

/* ------------------------------------------------------------------ */
/* Le panneau : les éléments vierges                                    */
/* ------------------------------------------------------------------ */

const TILES = {
  text: ['Aa', 'Une ligne'],
  longtext: ['¶', 'Un paragraphe'],
  number: ['12', 'Avec son unité'],
  date: ['31', 'Un jour'],
  choice: ['◉', 'Des propositions'],
  yesno: ['✓', 'Oui ou non'],
  scale: ['★', 'De 1 à 5'],
  heading: ['H', 'Le titre d’un groupe']
};
/** Qui remplit un élément, dit sur chaque élément de la fiche et sur chaque groupe d'éléments vierges. */
const AUDIENCE_BADGES = {
  info: 'À remplir dans chaque fiche',
  question: 'Question pour l’élève',
  correction: 'Révélé à la correction',
  teacher: 'Vu par vous seul'
};
const PALETTE = [
  [
    'info',
    AUDIENCE_BADGES.info,
    'Vous l’écrivez dans chaque fiche, onglet « Fiches » ; l’élève le lit.',
    ['text', 'longtext', 'number', 'date', 'choice', 'yesno', 'scale']
  ],
  ['question', AUDIENCE_BADGES.question, 'L’élève y répond pendant le cours.', ['text', 'longtext', 'number', 'choice', 'yesno', 'scale']],
  ['', 'Mise en page', 'Un titre pour regrouper les éléments qui suivent.', ['heading']]
];
const tileHTML = (type, audience) =>
  `<button type="button" class="tpl-tile${audience ? ` ${audience}` : ''}" draggable="true" data-add="${type}"${audience ? ` data-audience="${audience}"` : ''}><span class="tpl-tile-mark" aria-hidden="true">${TILES[type][0]}</span><strong>${esc(TYPE_LABELS[type])}</strong><span class="state">${TILES[type][1]}</span></button>`;

/** La fiche n'a pas de titre : ses fiches n'auront pas de nom, ni dans la liste, ni sur le plan. */
const NO_TITLE =
  'Aucun champ ne sert de titre : vos fiches n’auront pas de nom. Ajoutez un « Texte court » à remplir dans chaque fiche, et donnez-lui le rôle « Titre de la fiche ».';

export function html() {
  const template = courseTemplate();
  const groups = PALETTE.map(
    ([audience, title, hint, types]) =>
      `<div class="tpl-group"><h4>${esc(title)}</h4><p class="hint">${esc(hint)}</p><div class="tpl-palette">${types.map((type) => tileHTML(type, audience)).join('')}</div></div>`
  ).join('');
  return `
    <h2>Éditeur de fiches</h2>
    <p class="sub">La fiche se compose au centre, telle que la liront les élèves : glissez-y un élément, puis cliquez dessus pour l’écrire à sa place. Les élèves voient vos changements à la prochaine publication ; un lancement en cours garde la version avec laquelle il a été lancé.</p>
    <div class="tpl-reuse">
      <div><strong>Partir de la fiche d’un autre cours</strong><p class="hint">La fiche d’un de vos cours, ou d’un fichier de cours venu d’un collègue : elle remplace celle-ci, sans ses fiches.</p></div>
      <button type="button" class="btn" id="tplReuse">Reprendre la fiche d’un autre cours</button>
    </div>
    <div class="field"><label for="tplName">Nom du modèle</label>
      <div class="inline"><input id="tplName" class="text-input" maxlength="${LIMITS.name}" value="${esc(template.name ?? '')}"><button type="button" class="btn soft sm" id="tplRename">Renommer</button></div></div>
    <p class="tpl-summary" id="tplSummary">${esc(summaryText(template))}</p>
    ${titleField(template) ? '' : `<p class="tpl-warn" role="status">${esc(NO_TITLE)}</p>`}
    <div class="section">
      <h3>Éléments</h3>
      <p>Glissez un élément dans la fiche, à l’endroit voulu. Un clic l’ajoute sous l’élément choisi, sinon à la fin.</p>
      ${groups}
    </div>
    ${gradingHTML(template)}`;
}

/** Ce qu'on glisse : le navigateur ne laisse pas lire son contenu pendant le survol, seulement au dépôt. */
const DRAG = 'application/x-cartopoint-element';
let dragged = null;
function startDrag(e, what) {
  dragged = what;
  e.dataTransfer.setData(DRAG, JSON.stringify(what));
  e.dataTransfer.setData('text/plain', what.add ?? what.move);
  e.dataTransfer.effectAllowed = what.add ? 'copy' : 'move';
}
const draggedBy = (e) => {
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG));
  } catch {
    return dragged;
  }
};
globalThis.document?.addEventListener('dragend', () => {
  dragged = null;
  document.querySelector('.tpl-drop-line')?.remove();
});

export function bind(panel) {
  $('#tplRename').onclick = () => {
    const name = $('#tplName').value.trim();
    const next = { ...courseTemplate(), name };
    if (!name) delete next.name;
    const problem = applyTemplate(next);
    toast(problem ? `⚠ ${problem}` : 'Modèle renommé');
  };
  $('#tplReuse').onclick = () => openReuse();
  for (const tile of panel.querySelectorAll('[data-add]')) {
    tile.onclick = () => later(() => addField(tile.dataset.add, tile.dataset.audience));
    tile.addEventListener('dragstart', (e) => startDrag(e, { add: tile.dataset.add, audience: tile.dataset.audience }));
  }
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
    reportIncident('Éditeur de fiches', e);
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
/* La fiche au centre                                                   */
/* ------------------------------------------------------------------ */

/** Une fiche pour la fiche du centre : la première qui a quelque chose, sinon une fiche faite des exemples du modèle. */
function sampleFiche(template) {
  const fiche = allFiches().find((f) => template.fields.some((field) => !isEmpty(f[field.id])));
  if (fiche) return { fiche, source: `D’après la fiche « ${titleOf(fiche, template)} ».` };
  const values = Object.fromEntries(template.fields.filter((field) => field.placeholder).map((field) => [field.id, field.placeholder]));
  return { fiche: newFiche(values, template), source: 'D’après les exemples du modèle.' };
}

/** Ce qu'un élève lirait de cet élément, et à la correction un verdict d'exemple. */
const SAMPLE_VERDICT = { auto: 'ok', teacher: 'pending' };
const QUESTION_TYPES = ['text', 'longtext', 'number', 'choice', 'yesno', 'scale'];
const ROLE_LABELS = { '': 'Aucun', title: 'Titre de la fiche', subtitle: 'Sous-titre, en italique' };
const KEYBOARD_LABELS = { decimal: 'Nombre à virgule', numeric: 'Nombre entier' };
const AUDIENCE_HINTS = {
  info: 'Vous le remplissez dans chaque fiche, l’élève le lit.',
  question: 'L’élève y répond ; vous lisez sa réponse.',
  correction: 'Vous le remplissez ; l’élève ne le lit qu’à la correction, à la fin du cours.',
  teacher: 'Vous le remplissez ; personne d’autre ne le lit.'
};

function detailsOf(field) {
  if (isHeading(field)) return TYPE_LABELS.heading;
  return [
    TYPE_LABELS[field.type] + (field.type === 'choice' && field.multiple ? ' multiple' : ''),
    field.role === 'title' && 'titre',
    field.role === 'subtitle' && 'sous-titre',
    field.list && 'dans la liste'
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Un élément tel que le lira l'élève, avec le rendu de sa fiche (views/fields-html.js). */
function viewHTML(template, fiche, field) {
  if (isHeading(field))
    return field.label
      ? `<h3 class="mini-h">${esc(field.label)}</h3>${field.help ? `<p class="hint">${esc(field.help)}</p>` : ''}`
      : '<p class="hint"><em>Fin du groupe</em> : les éléments suivants ne sont plus sous un intertitre.</p>';
  if (field.role)
    return `<p class="tpl-role"><strong>${esc(field.label)}</strong> · ${field.role === 'title' ? 'le titre de la fiche, en haut, et partout où elle est nommée' : 'sous le titre, en italique'}</p>`;
  const verdict = view.revealed && SAMPLE_VERDICT[checkOf(field)];
  const body = ficheBodyHTML(
    { ...template, fields: [field] },
    fiche,
    {},
    {
      disabled: true,
      revealed: true,
      teacher: true,
      correction: verdict ? { questions: { [field.id]: verdict } } : null
    }
  );
  if (body.trim()) return body;
  return `<dl class="facts"><div><dt>${esc(field.label)}</dt><dd><em class="hint">À remplir dans chaque fiche, onglet « Fiches »</em></dd></div></dl>`;
}

const attr = (value) => esc(String(value ?? ''));
const editInput = (key, value, { id = '', label, placeholder = '', max, className = 'tpl-inline' }) =>
  `<input${id ? ` id="${id}"` : ''} data-edit="${key}" class="${className}" value="${attr(value)}" maxlength="${max}" placeholder="${attr(placeholder)}" aria-label="${attr(label)}">`;

/** La case de réponse, ou ce qui en tient lieu, écrite à sa place : l'exemple dans la case, l'unité à côté, les propositions. */
function controlHTML(field) {
  const question = field.audience === 'question';
  const example = editInput('placeholder', field.placeholder, {
    id: 'fPlaceholder',
    label: 'Exemple',
    placeholder: question ? 'Exemple, en gris dans la case vide (facultatif)' : 'Exemple, repris par le modèle de tableur (facultatif)',
    max: LIMITS.placeholder,
    className: 'tpl-sample'
  });
  switch (field.type) {
    case 'text':
    case 'longtext':
      return `<div class="tpl-answer${field.type === 'longtext' ? ' long' : ''}">${example}</div>`;
    case 'number':
      return `<div class="unit-input tpl-answer">${example}${editInput('unit', field.unit, { id: 'fUnit', label: 'Unité', placeholder: 'unité', max: LIMITS.unit, className: 'tpl-unit' })}</div>`;
    case 'date':
      return '<div class="tpl-answer"><span class="hint">jj/mm/aaaa : une date choisie dans un calendrier</span></div>';
    case 'yesno':
      return '<div class="choices"><span class="choice"><input type="radio" disabled><span>Oui</span></span><span class="choice"><input type="radio" disabled><span>Non</span></span></div>';
    case 'scale': {
      const max = field.max ?? 5;
      const steps = Array.from(
        { length: max },
        (_, i) => `<span class="choice"><span>${esc(field.symbol ? field.symbol.repeat(i + 1) : String(i + 1))}</span></span>`
      ).join('');
      const options = [2, 3, 4, 5].map((n) => `<option value="${n}"${n === max ? ' selected' : ''}>${n}</option>`).join('');
      return `<div class="choices">${steps}</div>
        <div class="tpl-inline-settings"><label>De 1 à <select id="fMax" data-edit="max">${options}</select></label>
        <label>Symbole ${editInput('symbol', field.symbol, { id: 'fSymbol', label: 'Symbole', placeholder: '⭐', max: LIMITS.icon, className: 'tpl-symbol' })}</label>
        <span class="hint">Répété pour chaque cran : ⭐⭐⭐. Sans symbole, un chiffre.</span></div>`;
    }
    case 'choice': {
      const type = field.multiple ? 'checkbox' : 'radio';
      const pills = field.choices
        .map(
          (choice, i) =>
            `<span class="choice tpl-choice"><input type="${type}" disabled>${editInput(`choice-${i}`, choice.label, { label: `Proposition ${i + 1}`, max: LIMITS.label })}<button type="button" class="tpl-x" data-choice-remove="${i}" aria-label="Retirer la proposition ${i + 1}"${field.choices.length <= 2 ? ' disabled' : ''}>×</button></span>`
        )
        .join('');
      return `<div class="choices">${pills}<button type="button" class="choice tpl-add-choice" data-choice-add${field.choices.length >= LIMITS.choices ? ' disabled' : ''}>＋ Proposition</button></div>`;
    }
  }
  return '';
}

/** L'élément choisi, écrit à sa place : son libellé, sa case, son aide. */
function editHTML(field) {
  const heading = isHeading(field);
  const label = editInput('label', field.label, {
    id: 'fLabel',
    label: heading ? 'Intertitre' : 'Libellé',
    placeholder: heading ? 'Intertitre ; vide, il ferme le groupe précédent' : 'Libellé',
    max: LIMITS.label,
    className: `tpl-inline tpl-label${heading ? ' mini-h' : ''}`
  });
  const help = `<textarea id="fHelp" data-edit="help" class="tpl-inline tpl-help" rows="1" maxlength="${LIMITS.help}" placeholder="${heading ? 'Une phrase sous l’intertitre, pour les élèves (facultatif)' : 'Une aide sous l’élément, pour les élèves (facultatif)'}" aria-label="Aide">${esc(field.help ?? '')}</textarea>`;
  if (heading) return `<div class="tpl-edit">${label}${help}</div>`;
  const icon = field.icon ? `<span aria-hidden="true">${esc(field.icon)}</span>` : '';
  const required = field.required ? '<span class="required">obligatoire</span>' : '';
  return `<div class="tpl-edit${field.audience === 'question' ? ' measures' : ''}"><div class="tpl-label-row">${icon}${label}${required}</div>${controlHTML(field)}${help}</div>`;
}

const selectHTML = (id, key, value, options, disabled = () => false) =>
  `<select id="${id}" data-edit="${key}">${Object.entries(options)
    .map(([option, label]) => `<option value="${option}"${option === value ? ' selected' : ''}${disabled(option) ? ' disabled' : ''}>${esc(label)}</option>`)
    .join('')}</select>`;
const checkHTML = (id, key, label, checked) =>
  `<label class="check"><input type="checkbox" id="${id}" data-edit="${key}"${checked ? ' checked' : ''}> ${label}</label>`;
const settingHTML = (id, label, control, hint = '') =>
  `<div class="field"><label for="${id}">${label}</label>${control}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;

/** Les réglages de l'élément choisi, seulement ceux qui ont un sens pour son type et son public (MOD-03). */
function settingsHTML(field, saved) {
  if (isHeading(field)) return '';
  // Un champ déjà rempli ne change de type que vers un type qui garde ses valeurs (MOD-05)
  const locked = saved.audience !== 'question' && filled(saved.id).length > 0;
  const types = Object.fromEntries(TYPES.filter((type) => type !== 'heading').map((type) => [type, TYPE_LABELS[type]]));
  const parts = [
    settingHTML(
      'fType',
      'Type',
      selectHTML('fType', 'type', field.type, types, (type) => locked && !COMPATIBLE[saved.type].includes(type)),
      locked ? 'Des fiches ont déjà une valeur ici : seuls les types qui la gardent sont proposés.' : ''
    ),
    settingHTML(
      'fAudience',
      'Qui le remplit, qui le voit',
      selectHTML('fAudience', 'audience', field.audience, AUDIENCE_LABELS, (audience) => audience === 'question' && !QUESTION_TYPES.includes(field.type)),
      AUDIENCE_HINTS[field.audience]
    )
  ];
  if (field.audience === 'question')
    parts.push(
      settingHTML(
        'fCheck',
        'Correction',
        selectHTML('fCheck', 'check', checkOf(field), Object.fromEntries(CHECKS[field.type].map((check) => [check, CHECK_LABELS[check]]))),
        {
          auto: 'Vous donnerez la bonne réponse de chaque fiche, dans l’onglet « Fiches ».',
          teacher: 'Vous la corrigerez après le cours, dans la page du lancement.',
          none: 'La réponse est seulement recueillie, comme une mesure.'
        }[checkOf(field)]
      )
    );
  if (field.type === 'text' && field.audience === 'info')
    parts.push(
      settingHTML(
        'fRole',
        'Rôle',
        selectHTML('fRole', 'role', field.role ?? '', ROLE_LABELS),
        'Le titre nomme la fiche partout ; le sous-titre s’affiche dessous.'
      )
    );
  if (field.type === 'number')
    parts.push(settingHTML('fKeyboard', 'Clavier du téléphone', selectHTML('fKeyboard', 'keyboard', field.keyboard ?? 'decimal', KEYBOARD_LABELS)));
  parts.push(
    settingHTML(
      'fIcon',
      'Icône',
      editInput('icon', field.icon, { id: 'fIcon', label: 'Icône', placeholder: '☀️', max: LIMITS.icon, className: 'text-input tpl-icon' }),
      'Un émoji, devant le libellé.'
    )
  );
  const options = [checkHTML('fList', 'list', 'Dans la liste des fiches', field.list)];
  if (['text', 'longtext'].includes(field.type) && field.audience === 'info') options.push(checkHTML('fSearch', 'search', 'Sert à la recherche', field.search));
  if (field.audience === 'question') options.push(checkHTML('fRequired', 'required', 'Obligatoire', field.required));
  if (field.type === 'choice') options.push(checkHTML('fMultiple', 'multiple', 'Plusieurs réponses possibles', field.multiple));
  parts.push(`<div class="field tpl-checks">${options.join('')}</div>`);
  return `<div class="tpl-settings">${parts.join('')}</div>`;
}

function blockHTML(template, fiche, saved, i) {
  const selected = view.selected === saved.id;
  const field = selected ? view.draft : saved;
  const heading = isHeading(field);
  const name = esc(saved.label || 'fin du groupe');
  const check = checkOf(field);
  const notYet = field.audience === 'correction' && !view.revealed;
  const marks = [
    `<span class="state">${esc(detailsOf(field))}</span>`,
    heading ? '' : `<span class="aud-badge ${field.audience}">${AUDIENCE_BADGES[field.audience]}</span>`,
    check ? `<span class="check-badge ${check}">${CHECK_LABELS[check]}</span>` : ''
  ].join('');
  const classes = ['tpl-block', selected && 'selected', heading && 'is-heading', notYet && 'later', field.audience === 'teacher' && 'teacher-only'];
  const count = template.fields.length;
  return `<section class="${classes.filter(Boolean).join(' ')}" data-block="${esc(saved.id)}">
      <div class="tpl-block-bar">
        <button type="button" class="tpl-handle" draggable="true" data-handle="${esc(saved.id)}" aria-label="Glisser « ${name} »" title="Glisser pour déplacer">⠿</button>
        <div class="tpl-marks">${marks}</div>
        <div class="tpl-tools">
          <button type="button" class="btn ghost sm" data-up="${i}" aria-label="Monter « ${name} »"${i === 0 ? ' disabled' : ''}>▲</button>
          <button type="button" class="btn ghost sm" data-down="${i}" aria-label="Descendre « ${name} »"${i === count - 1 ? ' disabled' : ''}>▼</button>
          ${selected ? `<button type="button" class="btn sm" data-done aria-label="Terminer « ${name} »">OK</button>` : `<button type="button" class="btn soft sm" data-field="${esc(saved.id)}" aria-label="Modifier « ${name} »">Modifier</button>`}
          <button type="button" class="btn danger sm" data-remove="${esc(saved.id)}" aria-label="Supprimer « ${name} »" title="Supprimer l’élément">🗑</button>
        </div>
      </div>
      <div class="tpl-view">${selected ? editHTML(field) : viewHTML(template, fiche, field)}</div>
      ${selected ? settingsHTML(field, saved) : ''}
      ${selected && view.error ? `<p class="form-error" role="alert">${esc(view.error)}</p>` : ''}
    </section>`;
}

function canvasHTML(template) {
  const { fiche, source } = sampleFiche(template);
  const toggles = [
    ['width', 'phone', 'Téléphone'],
    ['width', 'desktop', 'Ordinateur'],
    ['revealed', false, 'Pendant le cours'],
    ['revealed', true, 'À la correction']
  ]
    .map(([key, value, label]) => `<button type="button" class="chip" data-view="${key}:${value}" aria-pressed="${view[key] === value}">${label}</button>`)
    .join('');
  const real = `<button type="button" class="chip real" data-real aria-pressed="${view.real}">${view.real ? 'Revenir à l’éditeur' : 'Aperçu réel'}</button>`;
  const title = esc(titleOf(fiche, template));
  const sub = subtitleOf(fiche, template);
  const blocks = template.fields.map((field, i) => blockHTML(template, fiche, field, i)).join('');
  // À la correction, chaque question montre un verdict d'exemple : juste, ou corrigée plus tard par l'enseignant
  const verdicts = Object.fromEntries(
    questionFields(template)
      .map((field) => [field.id, SAMPLE_VERDICT[checkOf(field)]])
      .filter(([, verdict]) => verdict)
  );
  const body = view.real
    ? `<div class="tpl-real">${ficheBodyHTML(template, fiche, {}, { revealed: view.revealed, correction: view.revealed ? { questions: verdicts } : null })}</div>`
    : `<div class="tpl-blocks" id="tplBlocks">${blocks}<div class="tpl-end" data-end>${template.fields.length ? 'Glissez un élément ici pour l’ajouter à la fin.' : 'Glissez ici un premier élément.'}</div></div>`;
  return `
    <div class="tpl-bar"><div class="chips">${toggles}${real}</div><span class="state">${esc(source)}</span></div>
    <div class="tpl-canvas ${view.width}">
      <p class="field-title">Dans la liste</p>
      <article class="label preview-card">
        <div class="photo"></div>
        <div class="label-body"><h3>${title}</h3>${sub ? `<p class="sci">${esc(sub)}</p>` : ''}${listLinesHTML(template, fiche)}</div>
        ${cardAnswersHTML(template, fiche, {}, { title: titleOf(fiche, template) })}
      </article>
      <p class="field-title">Fiche ouverte</p>
      <div class="dlg preview-fiche">
        <div class="dlg-head"><div style="flex:1;min-width:0"><h2><span class="num">1</span>${title}</h2>${sub ? `<p class="sci">${esc(sub)}</p>` : ''}</div></div>
        <div class="dlg-body"><div class="read-text">${body}</div></div>
      </div>
    </div>`;
}

/** La case où l'on écrit, pour la retrouver après que la page s'est redessinée. */
function focused(container) {
  const active = document.activeElement;
  if (!active?.dataset?.edit || !container.contains(active)) return null;
  return { key: active.dataset.edit, start: active.selectionStart, end: active.selectionEnd };
}
function restore(container, focus) {
  const node = focus && container.querySelector(`[data-edit="${focus.key}"]`);
  if (!node) return;
  node.focus({ preventScroll: !focus.all });
  if (focus.all) {
    node.scrollIntoView({ block: 'nearest' });
    node.select?.();
  } else if (focus.start !== null && focus.start !== undefined) {
    try {
      node.setSelectionRange(focus.start, focus.end);
    } catch {
      // une liste ou une case à cocher n'a pas de curseur
    }
  }
}

/** La fiche du centre, à la place du plan, tant que l'onglet est ouvert (views/admin/index.js). */
export function stage(container) {
  if (view.selected && !savedField(view.selected)) Object.assign(view, { selected: null, draft: null, error: '' });
  const keep = focused(container);
  container.innerHTML = canvasHTML(courseTemplate());
  bindCanvas(container);
  restore(container, view.focus ?? keep);
  view.focus = null;
}
function redraw() {
  const container = $('#tabStage');
  if (container && !container.hidden) stage(container);
}

function bindCanvas(container) {
  container.querySelector('[data-real]').onclick = () =>
    later(() => {
      select(null);
      view.real = !view.real;
      redraw();
    });
  const blocks = container.querySelector('#tplBlocks');
  container.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => {
      const [key, value] = b.dataset.view.split(':');
      view[key] = key === 'revealed' ? value === 'true' : value;
      redraw();
    };
  });
  // L'aperçu réel n'a rien à modifier
  if (!blocks) return;
  container.querySelectorAll('[data-field]').forEach((b) => {
    b.onclick = () =>
      later(() => {
        select(b.dataset.field);
        view.focus = { key: 'label' };
        redraw();
      });
  });
  container.querySelector('[data-done]')?.addEventListener('click', () =>
    later(() => {
      select(null);
      redraw();
    })
  );
  container.querySelectorAll('[data-up], [data-down]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.up ?? b.dataset.down);
      const fields = courseTemplate().fields;
      later(() => moveField(fields[i].id, b.dataset.up !== undefined ? i - 1 : i + 2));
    };
  });
  container.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => later(() => removeField(b.dataset.remove))));
  // Un clic dans un élément le choisit : il s'écrit alors à sa place
  blocks.addEventListener('click', (e) => {
    const block = e.target.closest('[data-block]');
    if (!block || block.classList.contains('selected') || e.target.closest('button, input, textarea, select, a, summary')) return;
    later(() => {
      select(block.dataset.block);
      view.focus = { key: 'label' };
      redraw();
    });
  });

  // L'élément choisi : chaque case écrit dans le brouillon, et s'enregistre en la quittant
  const editing = container.querySelector('.tpl-block.selected');
  if (editing) {
    editing.addEventListener('input', (e) => {
      if (e.target.dataset.edit && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') readControl(e.target);
    });
    editing.addEventListener('change', (e) => {
      if (!e.target.dataset.edit) return;
      readControl(e.target);
      const draft = view.draft;
      later(() => commit(draft));
    });
    editing.querySelector('[data-choice-add]')?.addEventListener('click', () => {
      const draft = view.draft;
      draft.choices.push({ id: newFieldId('r'), label: `Proposition ${draft.choices.length + 1}` });
      view.focus = { key: `choice-${draft.choices.length - 1}`, all: true };
      later(() => commit(draft));
    });
    editing.querySelectorAll('[data-choice-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        const draft = view.draft;
        draft.choices.splice(Number(b.dataset.choiceRemove), 1);
        later(() => commit(draft));
      })
    );
  }

  // Glisser : un élément vierge depuis le panneau, ou un élément de la fiche par sa poignée. Un trait montre où il tombera.
  container.querySelectorAll('[data-handle]').forEach((handle) =>
    handle.addEventListener('dragstart', (e) => {
      startDrag(e, { move: handle.dataset.handle });
      e.dataTransfer.setDragImage(handle.closest('[data-block]'), 16, 16);
    })
  );
  const line = el('div', { className: 'tpl-drop-line' });
  const indexAt = (y) => {
    const all = [...blocks.querySelectorAll(':scope > [data-block]')];
    const i = all.findIndex((block) => {
      const box = block.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return i < 0 ? all.length : i;
  };
  blocks.addEventListener('dragover', (e) => {
    if (!dragged && !e.dataTransfer.types.includes(DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragged?.move ? 'move' : 'copy';
    const at = blocks.querySelectorAll(':scope > [data-block]')[indexAt(e.clientY)] ?? blocks.querySelector('[data-end]');
    if (line.nextSibling !== at) blocks.insertBefore(line, at);
  });
  blocks.addEventListener('dragleave', (e) => {
    if (!blocks.contains(e.relatedTarget)) line.remove();
  });
  blocks.addEventListener('drop', (e) => {
    e.preventDefault();
    line.remove();
    const what = draggedBy(e);
    const at = indexAt(e.clientY);
    dragged = null;
    if (what?.add && TYPES.includes(what.add)) later(() => addField(what.add, what.audience, at));
    else if (what?.move) later(() => moveField(what.move, at));
  });
}
