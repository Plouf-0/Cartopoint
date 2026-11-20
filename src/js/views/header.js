/**
 * En-tête (titre, noms des élèves, bouton Gestion) et ligne de progression au-dessus du plan.
 */
import { $, prefs, toast } from '../util.js';
import { S, fiches, listed, verified, posOf } from '../store.js';
import { hasPlan, hasRef } from '../model.js';
import { render } from '../render.js';
import { openLogin } from './login.js';

export function renderHeader() {
  const title = S.project.title;
  $('#pageTitle').textContent = title;
  document.title = title;
  $('#mapName').textContent = S.map.name;
  $('#adminPill').hidden = !S.admin;
  $('#studentsBox').hidden = S.admin;
  $('#modeBtn').textContent = S.admin ? 'Revenir à la vue élèves' : '⚙ Gestion';
  $('#legendRef').hidden = !(S.admin || verified());
  // Côté élèves, une carte sans plan est une liste, qui prend toute la place (CAR-07) ; en gestion, le plan reste à choisir
  document.querySelector('.layout').classList.toggle('no-plan', !S.admin && !hasPlan(S.map));

  const list = listed();
  if (S.admin) {
    const refs = fiches().filter(hasRef).length;
    $('#progress').innerHTML = `<b>${fiches().length}</b> fiche(s) · <b>${refs}</b> position(s) réelle(s) définie(s)`;
  } else {
    const placed = list.filter(posOf).length;
    $('#progress').innerHTML =
      list.length && hasPlan(S.map) ? `<b>${placed}</b> / ${list.length} fiche(s) placée(s)${verified() ? ' · exercice vérifié' : ''}` : '';
  }
}

export function studentNames() {
  return $('#studentNames').value.trim();
}

export function bindHeader() {
  const names = $('#studentNames');
  names.value = prefs.get('ib.studentNames') ?? prefs.get('botMapStudentNames') ?? '';
  names.addEventListener('input', () => prefs.set('ib.studentNames', names.value));
  $('#modeBtn').onclick = () => {
    if (!S.admin) return openLogin();
    S.admin = false;
    S.ui.placing = null;
    render();
    toast('Vue élèves');
  };
}
