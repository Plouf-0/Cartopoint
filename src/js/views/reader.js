/**
 * Consultation d'une fiche (élèves) : photo, besoins, mesures à saisir, description.
 * La fenêtre s'adapte à la forme de la photo (classes .portrait / .landscape).
 */
import { $, esc, frDate } from '../util.js';
import { S, byId, verified, entryOf, posOf, progress, mediaURL, changedProgress } from '../store.js';
import { NEEDS, MEASURES, numberOf, titleOf, thumbOf, evaluate } from '../model.js';
import { render } from '../render.js';
import { openPhoto } from './viewer.js';
import { startPlacing } from './map.js';

export async function openReader(id) {
  const f = byId(id);
  if (!f) return;
  const dlg = $('#dlgRead');
  const box = $('#readBox');
  const e = entryOf(f) || {};
  const fact = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  const facts = fact('Famille', f.family) + fact("Date d'observation", frDate(f.date));
  const needs = NEEDS.filter(([k]) => f[k])
    .map(([k, icon, label]) => `<div class="need"><dt><span aria-hidden="true">${icon}</span>${label}</dt><dd>${esc(f[k])}</dd></div>`)
    .join('');
  const ev = verified() ? evaluate(f, progress().entries[f.id], { ratio: S.ratio, widthMeters: S.map.widthMeters }) : null;
  const canPlace = !posOf(f) && !verified();

  box.innerHTML = `
    <div class="dlg-head">
      <div style="flex:1;min-width:0">
        <h2><span class="num ${posOf(f) ? 'on' : ''}">${numberOf(S.map, f)}</span>${esc(titleOf(f))}</h2>
        ${f.species && f.species !== titleOf(f) ? `<p class="sci">${esc(f.species)}</p>` : ''}
      </div>
      <button class="x" type="button" data-close aria-label="Fermer">×</button>
    </div>
    <div class="dlg-body">
      <button type="button" class="hero-btn" id="readHeroBtn" hidden aria-label="Agrandir la photo"><img class="hero" id="readHero" alt=""></button>
      <div class="read-text">
        ${ev ? `<p><span class="grade ${ev.cls}">${esc(ev.label)}</span>${ev.dist ? ` <span class="state">écart : ${esc(ev.dist)}</span>` : ''}</p>` : ''}
        ${facts ? `<dl class="facts">${facts}</dl>` : ''}
        ${needs ? `<h3 class="mini-h">Besoins de la plante</h3><dl class="needs">${needs}</dl>` : ''}
        <div class="measures">
          <h3>Vos mesures</h3>
          <p>Notez ce que vous mesurez sur place. C'est enregistré automatiquement.</p>
          <div class="measure-grid">
            ${MEASURES.map(
              ([k, , unit, label, mode]) =>
                `<div class="measure"><label for="m-${k}">${label}</label><div class="unit-input"><input id="m-${k}" data-k="${k}" inputmode="${mode}" value="${esc(e[k])}"><span>${unit}</span></div></div>`
            ).join('')}
          </div>
          <div class="saved-note" id="mSaved"></div>
        </div>
        <div class="prose">
          ${f.description ? `<h3>Description</h3><p>${esc(f.description)}</p>` : ''}
          ${f.notes ? `<h3>Observations</h3><p>${esc(f.notes)}</p>` : ''}
        </div>
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
  box.querySelectorAll('.measure-grid input').forEach((input) =>
    input.addEventListener('input', () => {
      entryOf(f, true)[input.dataset.k] = input.value.trim();
      changedProgress();
      clearTimeout(t);
      t = setTimeout(() => ($('#mSaved').textContent = '✓ Enregistré'), 300);
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
      if (m.type === 'video') fig.innerHTML = `<video controls preload="metadata" src="${url}"></video>`;
      else {
        fig.innerHTML = `<button type="button" class="zoom" aria-label="Agrandir"><img src="${url}" alt="${esc(m.name)}"></button>`;
        fig.querySelector('button').onclick = () => openPhoto(photos, photos.indexOf(m));
      }
      g.querySelector('.gallery').appendChild(fig);
    }
  }
}

/** Les mesures saisies dans la fiche apparaissent aussi sur la carte de la liste. */
export function bindReader() {
  $('#dlgRead').addEventListener('close', () => render());
}
