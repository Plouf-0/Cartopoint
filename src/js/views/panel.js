/**
 * Panneau de droite : liste des fiches (élèves) ou onglets de gestion (enseignant).
 */
import { $ } from '../util.js';
import { S, fiches, listed } from '../store.js';
import { hydrateThumbs } from './cards.js';
import { studentPanelHTML, bindStudentPanel } from './student-panel.js';
import { adminPanelHTML, bindAdminPanel } from './admin/index.js';

export function renderPanel() {
  const panel = $('#panel');
  const count = S.admin ? fiches().length : listed().length;
  // Plus il y a de fiches, plus la présentation est compacte (voir css/app.css, « dense »).
  panel.classList.toggle('dense', count > 6);
  panel.classList.toggle('very-dense', count > 14);
  const scroll = panel.querySelector('.panel-scroll')?.scrollTop ?? 0;
  panel.innerHTML = S.admin ? adminPanelHTML() : studentPanelHTML();
  if (S.admin) bindAdminPanel(panel);
  else bindStudentPanel(panel);
  const sc = panel.querySelector('.panel-scroll');
  if (sc) sc.scrollTop = scroll;
  hydrateThumbs(panel);
  fitPanel();
}

/** Sur grand écran, le panneau prend la hauteur du plan et défile à l'intérieur. */
export function fitPanel() {
  const panel = $('#panel');
  if (window.innerWidth <= 900) {
    panel.style.maxHeight = '';
    return;
  }
  const h = $('#stageInner').getBoundingClientRect().height;
  panel.style.maxHeight = Math.max(420, Math.min(h, window.innerHeight - 24)) + 'px';
}
