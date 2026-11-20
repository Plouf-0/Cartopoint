/**
 * Morceaux d'interface partagés par le panneau élèves et le panneau gestion :
 * vignette, cases de réponse, clics sur une fiche.
 */
import { esc, $$ } from '../util.js';
import { S, byId, entryOf, stamped, mediaURL, changedProgress, courseTemplate } from '../store.js';
import { thumbOf, titleOf } from '../model.js';
import { answerOf, cardAnswersHTML } from './fields-html.js';
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

/** Les cases de réponse d'une fiche dans la liste : les questions courtes du modèle marquées « dans la liste » (des mesures, par exemple). */
export const measuresHTML = (f) => cardAnswersHTML(courseTemplate(), f, entryOf(f), { disabled: S.finished, title: titleOf(f, courseTemplate()) });

export function bindMeasures(root) {
  for (const input of $$('[data-answer]', root)) {
    // Sans cela, sélectionner le texte d'une case déclencherait le glisser-déposer de la fiche.
    const card = input.closest('[draggable]');
    input.addEventListener('pointerdown', () => {
      if (!card) return;
      card.dataset.wasDraggable = card.getAttribute('draggable');
      card.setAttribute('draggable', 'false');
    });
    input.addEventListener('blur', () => card?.dataset.wasDraggable && card.setAttribute('draggable', card.dataset.wasDraggable));
    input.addEventListener(input.matches('select') ? 'change' : 'input', () => {
      const f = byId(input.dataset.id);
      if (!f) return;
      const field = courseTemplate().fields.find((x) => x.id === input.dataset.answer);
      stamped(entryOf(f, true))[field.id] = answerOf(field, input);
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
