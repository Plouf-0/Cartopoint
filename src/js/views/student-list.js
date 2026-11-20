/**
 * Liste des fiches d'un élève : à placer, avec ses mesures. Sans bas de panneau : la vérification et le compte rendu de
 * l'application d'origine sont dans views/student-panel.js.
 */
import { $, esc } from '../util.js';
import { S, listed, verified, locked, posOf, evaluationOf, courseTemplate } from '../store.js';
import { numberOf, titleOf, subtitleOf, matches } from '../model.js';
import { render } from '../render.js';
import { photoHTML, measuresHTML, bindMeasures, bindCards, bindSearch } from './cards.js';
import { cardQuestions, listLinesHTML } from './fields-html.js';
import { answersWord } from '../fields.js';

/** Ce qu'on attend de l'élève, en tête de liste : écrire dans les cases s'il y en a, lire, placer. */
const measuresHint = (template) =>
  cardQuestions(template).length
    ? `Notez vos ${answersWord(template)} directement dans les cases de chaque fiche, ouvrez-la pour la lire, puis placez-la sur le plan.`
    : 'Ouvrez chaque fiche pour la lire et y répondre, puis placez-la sur le plan.';

export function studentListHTML() {
  const template = courseTemplate();
  const all = listed();
  const v = verified();
  const list = all.filter((f) => matches(f, S.ui.query, template) && (S.ui.filter === 'all' || (S.ui.filter === 'placed') === !!posOf(f)));
  const chip = (k, t) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${S.ui.filter === k}">${t}</button>`;

  let cards = list
    .map((f) => {
      const placed = !!posOf(f);
      let foot = `<span class="num ${placed ? 'on' : ''}">${numberOf(S.map, f)}</span>`;
      if (v) {
        const ev = evaluationOf(f);
        foot += `<span class="grade ${ev.cls}">${esc(ev.label)}</span>`;
      } else if (placed) foot += `<span class="state">Placée</span>`;
      else if (locked()) foot += `<span class="state">Non placée</span>`;
      else foot += `<button type="button" class="btn sm" data-place="${esc(f.id)}">Placer sur le plan</button>`;
      const sub = subtitleOf(f, template);
      return `<article class="label ${S.ui.placing?.id === f.id ? 'is-placing' : ''}" data-open="${esc(f.id)}" draggable="${!locked() && !placed}" data-drag="${esc(f.id)}">
        ${photoHTML(f)}
        <div class="label-body">
          <h3>${esc(titleOf(f, template))}</h3>
          ${sub ? `<p class="sci">${esc(sub)}</p>` : ''}
          ${listLinesHTML(template, f)}
          <div class="label-foot">${foot}</div>
        </div>
        ${measuresHTML(f)}
      </article>`;
    })
    .join('');
  if (!all.length) cards = `<div class="empty-box">Aucune fiche pour le moment.<br>L'enseignant les prépare depuis le mode Gestion.</div>`;
  else if (!list.length) cards = `<div class="empty-box">Aucune fiche ne correspond à ce filtre.</div>`;

  return `<div class="panel-scroll">
      <h2>${S.finished ? 'Vos fiches' : 'Fiches à placer'}</h2>
      <p class="sub">${S.finished ? (S.correction ? 'Votre travail est figé. En bleu sur le plan, les positions réelles.' : 'Votre travail est figé.') : measuresHint(template)}</p>
      <input class="search" id="search" type="search" placeholder="Rechercher une fiche…" value="${esc(S.ui.query)}">
      <div class="chips">${chip('all', 'Toutes')}${chip('unplaced', 'À placer')}${chip('placed', 'Placées')}</div>
      <div class="labels">${cards}</div>
    </div>`;
}

export function bindStudentList(panel) {
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
}
