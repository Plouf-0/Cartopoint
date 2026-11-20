/**
 * Panneau des élèves de l'application d'origine : la liste des fiches, puis la vérification et le compte rendu.
 */
import { $ } from '../util.js';
import { S, listed, verified, posOf, entryOf, courseTemplate } from '../store.js';
import { hasPlan } from '../model.js';
import { hasAnswers } from '../fields.js';
import { studentListHTML, bindStudentList } from './student-list.js';
import { verifyExercise, showResults } from './results.js';
import { savePlanImage, saveReport } from './report-actions.js';

/** Il y a quelque chose à vérifier : une fiche placée, ou une réponse à une question (EXP-05, CAR-07). */
const started = () => listed().some((fiche) => posOf(fiche) || hasAnswers(entryOf(fiche), courseTemplate()));

export function studentPanelHTML() {
  const foot = verified()
    ? `<div class="locked-note">🔒 Exercice vérifié : les placements sont figés.</div>
       <button type="button" class="btn" id="showResults">Voir mes résultats</button>
       <button type="button" class="btn soft" id="dlReport">Télécharger le compte rendu (JPG)</button>`
    : `<button type="button" class="btn" id="verifyBtn" ${started() ? '' : 'disabled'}>${hasPlan(S.map) ? '✓ Vérifier mes placements' : '✓ Vérifier mes réponses'}</button>
       ${hasPlan(S.map) ? '<button type="button" class="btn ghost" id="dlImage">Télécharger l\'image du plan</button>' : ''}`;

  return `${studentListHTML()}
    <div class="panel-foot">${foot}</div>`;
}

export function bindStudentPanel(panel) {
  bindStudentList(panel);
  // La liste ne se redessine pas à chaque frappe : le bouton suit la première réponse sans attendre
  const follow = () => {
    const verify = $('#verifyBtn');
    if (verify) verify.disabled = !started();
  };
  panel.addEventListener('input', follow);
  panel.addEventListener('change', follow);
  $('#verifyBtn')?.addEventListener('click', verifyExercise);
  $('#dlImage')?.addEventListener('click', savePlanImage);
  $('#showResults')?.addEventListener('click', showResults);
  $('#dlReport')?.addEventListener('click', saveReport);
}
