/**
 * Morceaux d'interface partagés par le panneau élèves et le panneau gestion :
 * vignette, cases de mesures, clics sur une fiche.
 */
import { esc, $$ } from '../util.js';
import { S, byId, entryOf, mediaURL, changedProgress } from '../store.js';
import { MEASURES, thumbOf, titleOf } from '../model.js';
import { iconSVG } from '../themes.js';
import { openFiche } from './fiche.js';
import { openPhoto } from './viewer.js';
import { startPlacing } from './map.js';

const placeholder = () => `<div class="photo">${iconSVG(S.project.theme.icon, 26)}</div>`;

/** Vignette d'une fiche (l'image est chargée ensuite par hydrateThumbs). */
export function photoHTML(f) {
  return thumbOf(f) ? `<img class="photo" data-thumb="${esc(f.id)}" alt="">` : placeholder();
}

export async function hydrateThumbs(root) {
  for (const img of $$('img[data-thumb]', root)) {
    const f = byId(img.dataset.thumb);
    const url = f ? await mediaURL(thumbOf(f)) : '';
    if (url) img.src = url;
    else img.outerHTML = placeholder();
  }
}

/** Les trois cases de mesures (température, hygrométrie, éclairement) d'une fiche. */
export function measuresHTML(f) {
  const e = entryOf(f) || {};
  return `<div class="card-measures">${MEASURES.map(
    ([k, icon, unit, label, mode]) =>
      `<label title="${label} (${unit})"><span aria-hidden="true">${icon}</span><input data-measure="${k}" data-id="${esc(f.id)}" inputmode="${mode}" value="${esc(e[k])}" placeholder="—" aria-label="${label} en ${unit}, ${esc(titleOf(f))}"><em>${unit}</em></label>`
  ).join('')}</div>`;
}

export function bindMeasures(root) {
  for (const input of $$('[data-measure]', root)) {
    // Sans cela, sélectionner le texte d'une case déclencherait le glisser-déposer de la fiche.
    const card = input.closest('[draggable]');
    input.addEventListener('pointerdown', () => {
      if (!card) return;
      card.dataset.wasDraggable = card.getAttribute('draggable');
      card.setAttribute('draggable', 'false');
    });
    input.addEventListener('blur', () => card?.dataset.wasDraggable && card.setAttribute('draggable', card.dataset.wasDraggable));
    input.addEventListener('input', () => {
      const f = byId(input.dataset.id);
      if (!f) return;
      entryOf(f, true)[input.dataset.measure] = input.value.trim();
      changedProgress();
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  }
}

/** Clic sur une fiche (ouvrir), sur sa vignette (agrandir), boutons « Placer », glisser vers le plan. */
export function bindCards(root) {
  for (const card of $$('[data-open]', root)) {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, input, label')) return;
      if (e.target.matches('img.photo[data-thumb]')) {
        const f = byId(e.target.dataset.thumb);
        const photos = f.media.filter((m) => m.type === 'image');
        return openPhoto(photos, photos.indexOf(thumbOf(f)));
      }
      openFiche(card.dataset.open);
    });
  }
  for (const b of $$('[data-place]', root)) b.onclick = (e) => (e.stopPropagation(), startPlacing(b.dataset.place, 'student'));
  for (const b of $$('[data-place-ref]', root)) b.onclick = (e) => (e.stopPropagation(), startPlacing(b.dataset.placeRef, 'ref'));
  for (const card of $$('[data-drag][draggable="true"]', root)) {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.drag);
      e.dataTransfer.effectAllowed = 'move';
    });
  }
}

/** Champ de recherche qui garde le focus et le curseur quand le panneau est redessiné. */
export function bindSearch(input, onChange) {
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    onChange(input.value);
    const again = document.getElementById(input.id);
    again?.focus();
    again?.setSelectionRange(pos, pos);
  });
}
