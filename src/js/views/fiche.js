/**
 * Ouverture d'une fiche : consultation côté élèves, édition côté gestion.
 */
import { S } from '../store.js';
import { openReader } from './reader.js';

/** Branché par views/editor.js : la page d'un élève ne charge pas le code de gestion. */
let openInEditor = () => {};
export const useEditor = (open) => (openInEditor = open);

export function openFiche(id) {
  if (S.ui.placing) return;
  if (S.admin) openInEditor(id);
  else openReader(id);
}
