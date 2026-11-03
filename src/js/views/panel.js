/**
 * Panneau de droite : liste des fiches (élèves) ou onglets de gestion (enseignant).
 */
import { S, fiches, listed } from '../store.js';
import { fillPanel } from './panel-frame.js';
import { studentPanelHTML, bindStudentPanel } from './student-panel.js';
import { adminPanelHTML, bindAdminPanel } from './admin/index.js';

export function renderPanel() {
  if (S.admin) fillPanel(fiches().length, adminPanelHTML(), bindAdminPanel);
  else fillPanel(listed().length, studentPanelHTML(), bindStudentPanel);
}
