/**
 * Panneau des élèves : fiches à placer, mesures, vérification, compte rendu.
 */
import { $, esc } from '../util.js';
import { S, listed, verified, posOf, progress } from '../store.js';
import { numberOf, titleOf, evaluate, matches } from '../model.js';
import { render } from '../render.js';
import { photoHTML, measuresHTML, bindMeasures, bindCards, bindSearch } from './cards.js';
import { verifyExercise, showResults } from './results.js';
import { downloadPlanImage, downloadReport } from '../report.js';

export function studentPanelHTML() {
  const all = listed();
  const v = verified();
  const list = all.filter((f) => matches(f, S.ui.query) && (S.ui.filter === 'all' || (S.ui.filter === 'placed') === !!posOf(f)));
  const chip = (k, t) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${S.ui.filter === k}">${t}</button>`;

  let cards = list
    .map((f) => {
      const placed = !!posOf(f);
      let foot = `<span class="num ${placed ? 'on' : ''}">${numberOf(S.map, f)}</span>`;
      if (v) {
        const ev = evaluate(f, progress().entries[f.id], { ratio: S.ratio, widthMeters: S.map.widthMeters });
        foot += `<span class="grade ${ev.cls}">${esc(ev.label)}</span>`;
      } else if (placed) foot += `<span class="state">Placée</span>`;
      else foot += `<button type="button" class="btn sm" data-place="${esc(f.id)}">Placer sur le plan</button>`;
      return `<article class="label ${S.ui.placing?.id === f.id ? 'is-placing' : ''}" data-open="${esc(f.id)}" draggable="${!v && !placed}" data-drag="${esc(f.id)}">
        ${photoHTML(f)}
        <div class="label-body">
          <h3>${esc(titleOf(f))}</h3>
          ${f.species && f.species !== titleOf(f) ? `<p class="sci">${esc(f.species)}</p>` : ''}
          ${f.family ? `<p class="fam">${esc(f.family)}</p>` : ''}
          <div class="label-foot">${foot}</div>
        </div>
        ${measuresHTML(f)}
      </article>`;
    })
    .join('');
  if (!all.length) cards = `<div class="empty-box">Aucune fiche pour le moment.<br>L'enseignant les prépare depuis le mode Gestion.</div>`;
  else if (!list.length) cards = `<div class="empty-box">Aucune fiche ne correspond à ce filtre.</div>`;

  const foot = v
    ? `<div class="locked-note">🔒 Exercice vérifié : les placements sont figés.</div>
       <button type="button" class="btn" id="showResults">Voir mes résultats</button>
       <button type="button" class="btn soft" id="dlReport">Télécharger le compte rendu (JPG)</button>`
    : `<button type="button" class="btn" id="verifyBtn" ${all.some(posOf) ? '' : 'disabled'}>✓ Vérifier mes placements</button>
       <button type="button" class="btn ghost" id="dlImage">Télécharger l'image du plan</button>`;

  return `<div class="panel-scroll">
      <h2>Fiches à placer</h2>
      <p class="sub">Notez vos mesures directement dans les cases de chaque fiche, ouvrez-la pour la lire, puis placez-la sur le plan.</p>
      <input class="search" id="search" type="search" placeholder="Rechercher une espèce, une famille…" value="${esc(S.ui.query)}">
      <div class="chips">${chip('all', 'Toutes')}${chip('unplaced', 'À placer')}${chip('placed', 'Placées')}</div>
      <div class="labels">${cards}</div>
    </div>
    <div class="panel-foot">${foot}</div>`;
}

export function bindStudentPanel(panel) {
  bindSearch($('#search'), (q) => {
    S.ui.query = q;
    render();
  });
  panel.querySelectorAll('[data-filter]').forEach(
    (b) =>
      (b.onclick = () => {
        S.ui.filter = b.dataset.filter;
        render();
      })
  );
  bindCards(panel);
  bindMeasures(panel);
  $('#verifyBtn')?.addEventListener('click', verifyExercise);
  $('#dlImage')?.addEventListener('click', downloadPlanImage);
  $('#showResults')?.addEventListener('click', showResults);
  $('#dlReport')?.addEventListener('click', downloadReport);
}
