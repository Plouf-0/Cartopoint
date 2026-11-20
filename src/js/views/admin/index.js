/**
 * Panneau de gestion : un onglet par module. L'espace enseignant ajoute « Modèle de fiche » et remplace « Projet » par « Cours ».
 */
import { S } from '../../store.js';
import { render } from '../../render.js';
import * as fichesTab from './fiches.js';
import * as mapsTab from './maps.js';
import * as settingsTab from './settings.js';

const TABS = {
  fiches: ['Fiches', fichesTab],
  modele: null,
  cartes: ['Cartes', mapsTab],
  projet: ['Projet', { html: () => '', bind() {} }],
  reglages: ['Réglages', settingsTab]
};

/** Le troisième onglet dépend de la page : « Projet » hors ligne, « Cours » dans l'espace enseignant. */
export function setProjectTab(label, tab) {
  TABS.projet = [label, tab];
}

/** L'onglet du modèle de fiche n'existe que dans l'espace enseignant : le fichier de secours garde son modèle tel quel. */
export function setTemplateTab(label, tab) {
  TABS.modele = [label, tab];
}

export function adminPanelHTML() {
  const current = TABS[S.ui.tab] ? S.ui.tab : 'fiches';
  const tabs = Object.entries(TABS)
    .filter(([, tab]) => tab)
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
