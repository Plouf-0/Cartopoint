/**
 * Édition d'une fiche (gestion).
 *
 * On travaille sur une copie (« brouillon ») : rien n'est modifié tant qu'on n'a pas
 * cliqué sur Enregistrer. Les photos ajoutées sont stockées tout de suite (pour pouvoir
 * les afficher) et supprimées si l'on annule.
 *
 * Le formulaire suit le modèle du cours (views/fields-html.js). Dans l'application d'origine, il porte aussi les questions :
 * l'enseignant peut y noter des mesures, rangées dans la progression et non dans la fiche.
 */
import { $, $$, esc, toast, normKey, errorText } from '../util.js';
import { S, fiches, byId, entryOf, mediaURL, storeFile, forgetFile, deleteFiches, changedMap, changedProgress, courseTemplate } from '../store.js';
import { hasPlan, newFiche, normalizeFiche, normalizeMedia, numberOf, titleOf, thumbOf } from '../model.js';
import { isEmpty, questionFields, subtitleField, titleField } from '../fields.js';
import { render } from '../render.js';
import { openPhoto } from './viewer.js';
import { useEditor } from './fiche.js';
import { ficheFormHTML, firstControl, readForm } from './fields-html.js';

/** Brouillon en cours : { id, isNew, draft, added: [clés], removed: [clés], saved } */
let edit = null;

export function openEditor(id) {
  if (!S.admin) return;
  const template = courseTemplate();
  const source = id ? byId(id) : newFiche({}, template);
  if (!source) return;
  edit = { id, isNew: !id, draft: structuredClone(source), added: [], removed: [], saved: false };
  const d = edit.draft;
  $('#editTitle').textContent = id ? `${numberOf(S.map, source)} · ${titleOf(source, template)}` : 'Nouvelle fiche';
  $('#eFields').innerHTML = ficheFormHTML(template, d, S.teacherSpace ? null : (id && entryOf(source)) || {});
  $('#eVisible').checked = d.visible;
  $('#eDelete').hidden = edit.isNew;
  // Un envoi encore en route appartient à la fiche précédente : il ne bloque pas celle-ci
  $('#uploadStatus').textContent = '';
  $('#eSave').disabled = false;
  renderGallery();
  $('#dlgEdit').showModal();
  $$('#dlgEdit textarea').forEach(autosize);
  firstControl(template, $('#eFields'))?.focus();
}

/** Les zones de texte s'agrandissent avec leur contenu. */
function autosize(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}

async function renderGallery() {
  const g = $('#eGallery');
  const d = edit.draft;
  if (!d.media.length) {
    g.innerHTML = '<div class="empty-box" style="grid-column:1/-1">Aucune photo. La première photo ajoutée sert de vignette.</div>';
    return;
  }
  const thumb = thumbOf(d);
  const photos = d.media.filter((m) => m.type === 'image');
  g.innerHTML = '';
  for (const m of d.media) {
    const url = await mediaURL(m);
    const fig = document.createElement('figure');
    if (m === thumb) fig.className = 'is-thumb';
    const visual =
      m.type === 'video' ? `<video controls preload="metadata" ${url ? `src="${esc(url)}"` : ''}></video>` : `<img ${url ? `src="${esc(url)}"` : ''} alt="">`;
    const thumbBtn =
      m.type !== 'image'
        ? ''
        : m === thumb
          ? '<span class="state" style="text-align:center">✓ Vignette</span>'
          : `<button type="button" class="btn ghost sm" data-thumb-set="${esc(m.id)}">Utiliser comme vignette</button>`;
    fig.innerHTML = `${visual}<figcaption>${esc(m.name || (m.type === 'video' ? 'Vidéo' : 'Photo'))}</figcaption>
      <div class="btns">${thumbBtn}<button type="button" class="btn danger sm" data-media-del="${esc(m.id)}">Retirer</button></div>`;
    fig.querySelector('img')?.addEventListener('click', () => openPhoto(photos, photos.indexOf(m)));
    g.appendChild(fig);
  }
  g.querySelectorAll('[data-thumb-set]').forEach(
    (b) =>
      (b.onclick = () => {
        d.thumbnailId = b.dataset.thumbSet;
        renderGallery();
      })
  );
  g.querySelectorAll('[data-media-del]').forEach(
    (b) =>
      (b.onclick = () => {
        const m = d.media.find((x) => x.id === b.dataset.mediaDel);
        d.media = d.media.filter((x) => x !== m);
        if (d.thumbnailId === m.id) d.thumbnailId = null;
        if (m.key) {
          if (edit.added.includes(m.key)) {
            forgetFile(m.key);
            edit.added = edit.added.filter((k) => k !== m.key);
          } else edit.removed.push(m.key); // supprimé pour de bon seulement à l'enregistrement
        }
        renderGallery();
      })
  );
}

async function save() {
  const template = courseTemplate();
  const d = edit.draft;
  const { values, answers } = readForm(template, $('#eFields'));
  Object.assign(d, values);
  d.visible = $('#eVisible').checked;
  // Une fiche se reconnaît à son titre ou à son sous-titre, quand le modèle en a : il en faut au moins un
  const names = [titleField(template), subtitleField(template)].filter(Boolean);
  if (names.length && names.every((field) => isEmpty(d[field.id]))) {
    toast(`Indiquez au moins ${names.map((field) => `« ${field.label} »`).join(' ou ')}`);
    $(`#e-${names[0].id}`).focus();
    return;
  }
  if (
    d.ref &&
    fiches().some((f) => f.id !== d.id && normKey(f.ref) === normKey(d.ref)) &&
    !confirm(`La réf. photo « ${d.ref} » est déjà utilisée par une autre fiche. Enregistrer quand même ?`)
  )
    return;

  const fiche = normalizeFiche(d, template);
  if (edit.isNew) fiches().push(fiche);
  else fiches()[fiches().findIndex((f) => f.id === edit.id)] = fiche;
  for (const key of edit.removed) await forgetFile(key);

  if (questionFields(template).some((field) => !isEmpty(answers[field.id])) || (entryOf(fiche) && Object.keys(answers).length)) {
    Object.assign(entryOf(fiche, true), answers);
    changedProgress();
  }
  edit.saved = true;
  changedMap();
  $('#dlgEdit').close();
  render();
  // Sur une liste sans plan, il n'y a rien à placer (CAR-07)
  toast(edit.isNew ? (hasPlan(S.map) ? '✓ Fiche créée — placez sa position réelle sur le plan' : '✓ Fiche créée') : '✓ Fiche enregistrée');
}

async function remove() {
  const f = byId(edit.id);
  if (!confirm(`Supprimer définitivement « ${titleOf(f, courseTemplate())} » et ses photos ?`)) return;
  for (const key of edit.added) await forgetFile(key);
  await deleteFiches([f]);
  edit.saved = true;
  $('#dlgEdit').close();
  render();
  toast('Fiche supprimée');
}

/**
 * Barre d'émojis : insère l'émoji dans le dernier champ texte utilisé, sinon dans le premier du groupe de la barre. Le
 * formulaire est refait à chaque fiche : tout passe par la fenêtre, qui, elle, reste.
 */
function bindEmojiBar() {
  const dlg = $('#dlgEdit');
  let target = null;
  dlg.addEventListener('focusin', (e) => {
    if (e.target.matches('[data-f]:is(textarea, input:not([type]), input[type="text"])')) target = e.target;
  });
  dlg.addEventListener('mousedown', (e) => e.target.closest('[data-emoji]') && e.preventDefault()); // garde le curseur dans le champ
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    const group = b.closest('.needs-edit') ?? $('#eFields');
    const t = target?.isConnected ? target : group.querySelector('[data-f]:is(textarea, input:not([type]))');
    if (!t) return;
    const start = t.selectionStart ?? t.value.length;
    const end = t.selectionEnd ?? t.value.length;
    t.value = t.value.slice(0, start) + b.dataset.emoji + t.value.slice(end);
    t.focus();
    const pos = start + b.dataset.emoji.length;
    t.setSelectionRange(pos, pos);
    if (t.matches('textarea')) autosize(t);
  });
}

export function bindEditor() {
  useEditor(openEditor);
  const dlg = $('#dlgEdit');
  bindEmojiBar();
  dlg.addEventListener('input', (e) => e.target.matches('textarea') && autosize(e.target));
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  $('#eFiles').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    // La fiche peut être fermée, et une autre ouverte, pendant l'envoi : ces fichiers ne vont qu'à la fiche qui les a demandés
    const target = edit;
    // L'envoi peut prendre du temps : enregistrer la fiche entre-temps ferait perdre les photos encore en route.
    $('#eSave').disabled = true;
    for (const [i, file] of files.entries()) {
      if (edit !== target) return;
      $('#uploadStatus').textContent = `Envoi de ${file.name} (${i + 1} / ${files.length})…`;
      try {
        const stored = await storeFile(file);
        if (edit !== target) return forgetFile(stored.key);
        if (stored.key) edit.added.push(stored.key);
        edit.draft.media.push(normalizeMedia({ type: file.type.startsWith('video/') ? 'video' : 'image', name: file.name, ...stored }));
      } catch (error) {
        toast(`⚠ Impossible d'enregistrer ${file.name} : ${errorText(error)}`);
      }
    }
    if (edit !== target) return;
    $('#uploadStatus').textContent = '';
    $('#eSave').disabled = false;
    renderGallery();
  };
  $('#eSave').onclick = save;
  $('#eDelete').onclick = remove;
  dlg.addEventListener('close', () => {
    if (edit && !edit.saved) edit.added.forEach(forgetFile); // annulation : on retire les photos ajoutées
    edit = null;
  });
}
