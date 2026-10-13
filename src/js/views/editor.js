/**
 * Édition d'une fiche (gestion).
 *
 * On travaille sur une copie (« brouillon ») : rien n'est modifié tant qu'on n'a pas
 * cliqué sur Enregistrer. Les photos ajoutées sont stockées tout de suite (pour pouvoir
 * les afficher) et supprimées si l'on annule.
 */
import { $, $$, esc, toast, normKey, today } from '../util.js';
import { S, fiches, byId, entryOf, mediaURL, storeFile, forgetFile, deleteFiches, changedMap, changedProgress } from '../store.js';
import { normalizeFiche, normalizeMedia, numberOf, titleOf, thumbOf } from '../model.js';
import { render } from '../render.js';
import { openPhoto } from './viewer.js';
import { identifyWithAI } from '../ai.js';

/** Champ du formulaire → propriété de la fiche. */
const FIELDS = {
  eRef: 'ref',
  eCommon: 'common',
  eSpecies: 'species',
  eFamily: 'family',
  eDate: 'date',
  eExposure: 'exposure',
  eWatering: 'watering',
  eSoil: 'soil',
  eHeat: 'heat',
  eCare: 'care',
  eDesc: 'description',
  eNotes: 'notes'
};
/** Champ du formulaire → mesure (stockée dans la progression, pas dans la fiche). */
const MEASURE_FIELDS = { eTemp: 'temperature', eHumidity: 'humidity', eLight: 'light' };

const EMOJIS = ['☀️', '🌤️', '⛅', '☁️', '💧', '💦', '🚿', '🌱', '🪨', '🍂', '🌡️', '🔥', '❄️', '🌬️', '✂️', '🌸', '🌿', '🌳', '🐝', '⭐', '✅', '⚠️', '🚫', '❗'];

/** Brouillon en cours : { id, isNew, draft, added: [clés], removed: [clés], saved } */
let edit = null;

export function openEditor(id) {
  if (!S.admin) return;
  const source = id ? byId(id) : normalizeFiche({ date: today() });
  if (!source) return;
  edit = { id, isNew: !id, draft: structuredClone(source), added: [], removed: [], saved: false };
  const d = edit.draft;
  $('#editTitle').textContent = id ? `${numberOf(S.map, source)} · ${titleOf(source)}` : 'Nouvelle fiche';
  for (const [field, key] of Object.entries(FIELDS)) $('#' + field).value = d[key] || '';
  const e = (id && entryOf(source)) || {};
  for (const [field, key] of Object.entries(MEASURE_FIELDS)) $('#' + field).value = e[key] || '';
  $('#eVisible').checked = d.visible;
  $('#eDelete').hidden = edit.isNew;
  $('#aiBtn').hidden = !S.project.aiEndpoint;
  $('#aiStatus').textContent = '';
  renderGallery();
  $('#dlgEdit').showModal();
  $$('#dlgEdit textarea').forEach(autosize);
  $('#eCommon').focus();
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
      m.type === 'video' ? `<video controls preload="metadata" ${url ? `src="${url}"` : ''}></video>` : `<img ${url ? `src="${url}"` : ''} alt="">`;
    const thumbBtn =
      m.type !== 'image'
        ? ''
        : m === thumb
          ? '<span class="state" style="text-align:center">✓ Vignette</span>'
          : `<button type="button" class="btn ghost sm" data-thumb-set="${m.id}">Utiliser comme vignette</button>`;
    fig.innerHTML = `${visual}<figcaption>${esc(m.name || (m.type === 'video' ? 'Vidéo' : 'Photo'))}</figcaption>
      <div class="btns">${thumbBtn}<button type="button" class="btn danger sm" data-media-del="${m.id}">Retirer</button></div>`;
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
  const d = edit.draft;
  for (const [field, key] of Object.entries(FIELDS)) d[key] = $('#' + field).value.trim();
  d.visible = $('#eVisible').checked;
  if (!d.common && !d.species) {
    toast('Indiquez au moins un nom');
    $('#eCommon').focus();
    return;
  }
  if (
    d.ref &&
    fiches().some((f) => f.id !== d.id && normKey(f.ref) === normKey(d.ref)) &&
    !confirm(`La réf. photo « ${d.ref} » est déjà utilisée par une autre fiche. Enregistrer quand même ?`)
  )
    return;

  const fiche = normalizeFiche(d);
  if (edit.isNew) fiches().push(fiche);
  else fiches()[fiches().findIndex((f) => f.id === edit.id)] = fiche;
  for (const key of edit.removed) await forgetFile(key);

  const measures = Object.entries(MEASURE_FIELDS).map(([field, key]) => [key, $('#' + field).value.trim()]);
  if (measures.some(([, v]) => v) || entryOf(fiche)) {
    Object.assign(entryOf(fiche, true), Object.fromEntries(measures));
    changedProgress();
  }
  edit.saved = true;
  changedMap();
  $('#dlgEdit').close();
  render();
  toast(edit.isNew ? '✓ Fiche créée — placez sa position réelle sur le plan' : '✓ Fiche enregistrée');
}

async function remove() {
  const f = byId(edit.id);
  if (!confirm(`Supprimer définitivement « ${titleOf(f)} » et ses photos ?`)) return;
  for (const key of edit.added) await forgetFile(key);
  await deleteFiches([f]);
  edit.saved = true;
  $('#dlgEdit').close();
  render();
  toast('Fiche supprimée');
}

/** Barre d'émojis : insère l'émoji dans le dernier champ texte utilisé. */
function bindEmojiBar() {
  const bar = $('#emojiBar');
  let target = null;
  bar.innerHTML = EMOJIS.map((e) => `<button type="button" data-emoji="${e}" title="Ajouter ${e}">${e}</button>`).join('');
  $('#dlgEdit').addEventListener('focusin', (e) => {
    if (e.target.matches('textarea, input:not([type]), input[type="text"]')) target = e.target;
  });
  bar.addEventListener('mousedown', (e) => e.preventDefault()); // garde le curseur dans le champ
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    const t = target?.isConnected ? target : $('#eExposure');
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
  const dlg = $('#dlgEdit');
  bindEmojiBar();
  dlg.addEventListener('input', (e) => e.target.matches('textarea') && autosize(e.target));
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  $('#eFiles').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) {
      try {
        const key = await storeFile(file);
        edit.added.push(key);
        edit.draft.media.push(normalizeMedia({ type: file.type.startsWith('video/') ? 'video' : 'image', name: file.name, key }));
      } catch {
        toast("⚠ Impossible d'enregistrer " + file.name);
      }
    }
    renderGallery();
  };
  $('#eSave').onclick = save;
  $('#eDelete').onclick = remove;
  $('#aiBtn').onclick = () => identifyWithAI(edit.draft, $('#aiStatus'));
  dlg.addEventListener('close', () => {
    if (edit && !edit.saved) edit.added.forEach(forgetFile); // annulation : on retire les photos ajoutées
    edit = null;
  });
}
