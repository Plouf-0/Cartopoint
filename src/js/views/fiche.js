/**
 * Ouverture d'une fiche : consultation côté élèves, édition côté gestion.
 */
import { S } from '../store.js';
import { openReader } from './reader.js';
import { openEditor } from './editor.js';

export function openFiche(id) {
  if (S.ui.placing) return;
  if (S.admin) openEditor(id);
  else openReader(id);
}
