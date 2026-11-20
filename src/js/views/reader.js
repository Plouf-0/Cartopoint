/**
 * Consultation d'une fiche (élèves) : photo, ce que l'enseignant a écrit, questions auxquelles répondre, champ par champ
 * d'après le modèle du cours (views/fields-html.js). La fenêtre s'adapte à la forme de la photo (classes .portrait / .landscape).
 */
import { $, esc } from '../util.js';
import { S, byId, verified, locked, entryOf, stamped, posOf, evaluationOf, mediaURL, changedProgress, courseTemplate } from '../store.js';
import { numberOf, titleOf, subtitleOf, thumbOf } from '../model.js';
import { render } from '../render.js';
import { answerOf, ficheBodyHTML } from './fields-html.js';
import { openPhoto } from './viewer.js';
import { startPlacing } from './map.js';

export async function openReader(id) {
  const f = byId(id);
  if (!f) return;
  const dlg = $('#dlgRead');
  const box = $('#readBox');
  const template = courseTemplate();
  const e = entryOf(f) || {};
  const sub = subtitleOf(f, template);
  const ev = verified() ? evaluationOf(f) : null;
  const canPlace = !posOf(f) && !locked();

  box.innerHTML = `
    <div class="dlg-head">
      <div style="flex:1;min-width:0">
        <h2><span class="num ${posOf(f) ? 'on' : ''}">${numberOf(S.map, f)}</span>${esc(titleOf(f, template))}</h2>
        ${sub ? `<p class="sci">${esc(sub)}</p>` : ''}
      </div>
      <button class="x" type="button" data-close aria-label="Fermer">×</button>
    </div>
    <div class="dlg-body">
      <button type="button" class="hero-btn" id="readHeroBtn" hidden aria-label="Agrandir la photo"><img class="hero" id="readHero" alt=""></button>
      <div class="read-text">
        ${ev ? `<p><span class="grade ${ev.cls}">${esc(ev.label)}</span>${ev.dist ? ` <span class="state">écart : ${esc(ev.dist)}</span>` : ''}</p>` : ''}
        ${ficheBodyHTML(template, f, e, { disabled: S.finished, revealed: verified() || Boolean(S.correction), teacher: S.admin, correction: S.correction ? ev : null })}
        <div id="readGallery"></div>
      </div>
    </div>
    <div class="dlg-foot">
      ${canPlace ? '<button type="button" class="btn" id="readPlace">Placer sur le plan</button>' : ''}
      <button class="btn ghost" type="button" data-close>Fermer</button>
    </div>`;

  box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
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
  dlg.showModal();

  // Photo principale : la fenêtre prend la forme de l'image.
  const thumb = thumbOf(f);
  const photos = f.media.filter((m) => m.type === 'image');
  if (thumb) {
    const url = await mediaURL(thumb);
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
export function bindReader() {
  $('#dlgRead').addEventListener('close', () => render());
}
