/**
 * Consultation d'une fiche (élèves) : photo, ce que l'enseignant a écrit, questions auxquelles répondre, champ par champ
 * d'après le modèle du cours (views/fields-html.js). La fenêtre s'adapte à la forme de la photo (classes .portrait / .landscape).
 *
 * Téléphone et ordinateur (MOB) : sur un téléphone, la fiche monte du bas et prend tout l'écran ; sur un grand écran, elle
 * s'ouvre à côté du plan sans le cacher (.side), et l'élève peut encore le regarder ou y placer. On passe d'une fiche à la
 * suivante sans repasser par la liste, aussi aux flèches du clavier.
 */
import { $, esc } from '../util.js';
import { S, byId, listed, verified, locked, entryOf, stamped, posOf, evaluationOf, mediaURL, changedProgress, courseTemplate } from '../store.js';
import { hasPlan, numberOf, titleOf, subtitleOf, thumbOf } from '../model.js';
import { render } from '../render.js';
import { answerOf, ficheBodyHTML } from './fields-html.js';
import { openPhoto } from './viewer.js';
import { startPlacing } from './map.js';

/** La dernière fiche ouverte : une photo qui arrive après qu'on est passé à la suivante ne s'y affiche pas. */
let opening = 0;

export async function openReader(id) {
  const f = byId(id);
  if (!f) return;
  const ticket = ++opening;
  const dlg = $('#dlgRead');
  const box = $('#readBox');
  const template = courseTemplate();
  const e = entryOf(f) || {};
  const sub = subtitleOf(f, template);
  const ev = verified() ? evaluationOf(f) : null;
  const canPlace = !posOf(f) && !locked() && hasPlan(S.map);
  // Les fiches de la liste, dans son ordre : la précédente et la suivante (MOB-02)
  const order = listed();
  const at = order.findIndex((x) => x.id === f.id);

  box.innerHTML = `
    <div class="dlg-head">
      <div style="flex:1;min-width:0">
        <h2><span class="num ${posOf(f) ? 'on' : ''}">${numberOf(S.map, f)}</span>${esc(titleOf(f, template))}</h2>
        ${sub ? `<p class="sci">${esc(sub)}</p>` : ''}
      </div>
      <div class="read-nav">
        <button type="button" class="btn ghost sm" data-step="-1" aria-label="Fiche précédente" ${at > 0 ? '' : 'disabled'}>‹</button>
        <span class="state">${at + 1} / ${order.length}</span>
        <button type="button" class="btn ghost sm" data-step="1" aria-label="Fiche suivante" ${at < order.length - 1 ? '' : 'disabled'}>›</button>
      </div>
      <button class="x" type="button" data-close aria-label="Fermer">×</button>
    </div>
    <div class="dlg-body">
      <button type="button" class="hero-btn" id="readHeroBtn" hidden aria-label="Agrandir la photo"><img class="hero" id="readHero" alt=""></button>
      <div class="read-text">
        ${ev && hasPlan(S.map) ? `<p><span class="grade ${ev.cls}">${esc(ev.label)}</span>${ev.dist ? ` <span class="state">écart : ${esc(ev.dist)}</span>` : ''}</p>` : ''}
        ${ficheBodyHTML(template, f, e, { disabled: S.finished, revealed: verified() || Boolean(S.correction), teacher: S.admin, correction: S.correction ? ev : null })}
        <div id="readGallery"></div>
      </div>
    </div>
    <div class="dlg-foot">
      ${canPlace ? '<button type="button" class="btn" id="readPlace">Placer sur le plan</button>' : ''}
      <button class="btn ghost" type="button" data-close>Fermer</button>
    </div>`;

  box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  box.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => openReader(order[at + Number(b.dataset.step)]?.id)));
  $('#readPlace')?.addEventListener('click', () => {
    dlg.close();
    startPlacing(f.id, 'student');
  });
  let t;
  box.querySelectorAll('.measure-grid [data-k]').forEach((control) =>
    control.addEventListener(control.matches('fieldset') ? 'change' : 'input', () => {
      const field = template.fields.find((x) => x.id === control.dataset.k);
      stamped(entryOf(f, true))[field.id] = answerOf(field, control);
      changedProgress();
      clearTimeout(t);
      const note = control.closest('.measures').querySelector('.saved-note');
      t = setTimeout(() => (note.textContent = '✓ Enregistré'), 300);
    })
  );

  dlg.classList.remove('portrait', 'landscape');
  // À côté du plan quand la place le permet : la fenêtre ne bloque pas la page, et le plan reste visible (MOB-03)
  const side = hasPlan(S.map) && matchMedia(SIDE).matches;
  dlg.classList.toggle('side', side);
  box.querySelector('.dlg-body').scrollTop = 0;
  if (!dlg.open) {
    if (side) dlg.show();
    else dlg.showModal();
  }

  // Photo principale : la fenêtre prend la forme de l'image.
  const thumb = thumbOf(f);
  const photos = f.media.filter((m) => m.type === 'image');
  if (thumb) {
    const url = await mediaURL(thumb);
    if (ticket !== opening) return;
    if (url) {
      const img = $('#readHero');
      img.onload = () => dlg.classList.add(img.naturalHeight > img.naturalWidth * 1.05 ? 'portrait' : 'landscape');
      img.src = url;
      const btn = $('#readHeroBtn');
      btn.hidden = false;
      btn.onclick = () => openPhoto(photos, photos.indexOf(thumb));
    }
  }
  const others = f.media.filter((m) => m !== thumb);
  if (others.length) {
    const g = $('#readGallery');
    g.innerHTML = '<div class="prose"><h3>Autres photos et vidéos</h3></div><div class="gallery"></div>';
    for (const m of others) {
      const url = await mediaURL(m);
      if (ticket !== opening) return;
      if (!url) continue;
      const fig = document.createElement('figure');
      if (m.type === 'video') {
        fig.innerHTML = `<video controls preload="metadata" src="${esc(url)}"></video>`;
        // Les vidéos ne sont pas gardées pour le terrain : sans réseau, autant le dire plutôt que de montrer un lecteur vide
        fig.querySelector('video').onerror = () =>
          (fig.innerHTML =
            "<p class=\"hint\">Cette vidéo ne peut pas être lue pour l'instant. Sans réseau, c'est normal : les vidéos ne sont pas gardées sur l'appareil.</p>");
      } else {
        fig.innerHTML = `<button type="button" class="zoom" aria-label="Agrandir"><img src="${esc(url)}" alt="${esc(m.name)}"></button>`;
        fig.querySelector('button').onclick = () => openPhoto(photos, photos.indexOf(m));
      }
      g.querySelector('.gallery').appendChild(fig);
    }
  }
}

/** Les réponses écrites dans la fiche apparaissent aussi sur la carte de la liste. */
/** La largeur à partir de laquelle la fiche s'ouvre à côté du plan. */
const SIDE = '(min-width: 1100px)';
const typing = (target) => target.matches?.('input, textarea, select, [contenteditable]');

export function bindReader() {
  const dlg = $('#dlgRead');
  dlg.addEventListener('close', () => render());
  // Flèches : fiche précédente ou suivante ; Échap ferme aussi la fenêtre posée à côté du plan, qui n'est pas modale (MOB-02, MOB-03)
  document.addEventListener('keydown', (e) => {
    if (!dlg.open || typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape' && dlg.classList.contains('side')) dlg.close();
    const step = { ArrowLeft: '-1', ArrowRight: '1' }[e.key];
    const button = step && dlg.querySelector(`[data-step="${step}"]:not([disabled])`);
    if (button) {
      e.preventDefault();
      button.click();
    }
  });
  // Sur un téléphone, le clavier qui s'ouvre ne cache pas la case où l'on écrit (MOB-01)
  dlg.addEventListener('focusin', (e) => {
    if (typing(e.target) && matchMedia('(pointer: coarse)').matches) setTimeout(() => e.target.scrollIntoView({ block: 'center' }), 300);
  });
}
