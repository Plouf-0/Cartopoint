/**
 * Panneau de gestion : quatre onglets, chacun dans son module.
 */
import { S } from '../../store.js';
import { render } from '../../render.js';
import * as fichesTab from './fiches.js';
import * as mapsTab from './maps.js';
import * as projectTab from './project.js';
import * as settingsTab from './settings.js';

const TABS = {
  fiches: ['Fiches', fichesTab],
  cartes: ['Cartes', mapsTab],
  projet: ['Projet', projectTab],
  reglages: ['Réglages', settingsTab]
};

export function adminPanelHTML() {
  const current = TABS[S.ui.tab] ? S.ui.tab : 'fiches';
  const tabs = Object.entries(TABS)
    .map(([k, [label]]) => `<button type="button" class="tab" role="tab" data-tab="${k}" aria-selected="${k === current}">${label}</button>`)
    .join('');
  return `<div class="tabs" role="tablist">${tabs}</div><div class="panel-scroll">${TABS[current][1].html()}</div>`;
}

export function bindAdminPanel(panel) {
  panel.querySelectorAll('[data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        S.ui.tab = b.dataset.tab;
        render();
        panel.querySelector('.panel-scroll').scrollTop = 0;
      })
  );
  (TABS[S.ui.tab] || TABS.fiches)[1].bind(panel);
}
