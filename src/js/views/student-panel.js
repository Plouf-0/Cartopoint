/**
 * Panneau des élèves de l'application d'origine : la liste des fiches, puis la vérification et le compte rendu.
 */
import { $ } from '../util.js';
import { listed, verified, posOf } from '../store.js';
import { studentListHTML, bindStudentList } from './student-list.js';
import { verifyExercise, showResults } from './results.js';
import { downloadPlanImage, downloadReport } from '../report.js';

export function studentPanelHTML() {
  const foot = verified()
    ? `<div class="locked-note">🔒 Exercice vérifié : les placements sont figés.</div>
       <button type="button" class="btn" id="showResults">Voir mes résultats</button>
       <button type="button" class="btn soft" id="dlReport">Télécharger le compte rendu (JPG)</button>`
    : `<button type="button" class="btn" id="verifyBtn" ${listed().some(posOf) ? '' : 'disabled'}>✓ Vérifier mes placements</button>
       <button type="button" class="btn ghost" id="dlImage">Télécharger l'image du plan</button>`;

  return `${studentListHTML()}
    <div class="panel-foot">${foot}</div>`;
}

export function bindStudentPanel(panel) {
  bindStudentList(panel);
  $('#verifyBtn')?.addEventListener('click', verifyExercise);
  $('#dlImage')?.addEventListener('click', downloadPlanImage);
  $('#showResults')?.addEventListener('click', showResults);
  $('#dlReport')?.addEventListener('click', downloadReport);
}
