/**
 * Remplit le panneau de droite. À part de views/panel.js : la page d'un élève s'en sert sans charger le code de gestion.
 */
import { $ } from '../util.js';
import { hydrateThumbs } from './cards.js';

export function fillPanel(count, html, bind) {
  const panel = $('#panel');
  // Plus il y a de fiches, plus la présentation est compacte (voir css/app.css, « dense »).
  panel.classList.toggle('dense', count > 6);
  panel.classList.toggle('very-dense', count > 14);
  const scroll = panel.querySelector('.panel-scroll')?.scrollTop ?? 0;
  panel.innerHTML = html;
  bind(panel);
  const scrolling = panel.querySelector('.panel-scroll');
  if (scrolling) scrolling.scrollTop = scroll;
  hydrateThumbs(panel);
}
