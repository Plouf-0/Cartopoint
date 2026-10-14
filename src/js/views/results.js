/**
 * Vérification de l'exercice et fenêtre des résultats.
 */
import { $, esc } from '../util.js';
import { S, listed, posOf, progress, changedProgress } from '../store.js';
import { titleOf, THRESHOLDS } from '../model.js';
import { render } from '../render.js';
import { resultRows, scoreOf, downloadPlanImage, downloadReport, downloadTeacherCsv } from '../report.js';
import { studentNames } from './header.js';

export function verifyExercise() {
  const missing = listed().filter((f) => !posOf(f)).length;
  const msg =
    (missing ? `${missing} fiche(s) ne sont pas encore placée(s).\n\n` : '') +
    'Vérifier maintenant ? Les positions réelles seront affichées et vos placements ne pourront plus être modifiés.';
  if (!confirm(msg)) return;
  progress().verified = true;
  changedProgress();
  render();
  showResults();
}

export function showResults() {
  const rows = resultRows();
  const { ok, near, scored } = scoreOf(rows);
  const names = studentNames();
  $('#resultsBox').innerHTML = `
    <div class="dlg-head">
      <div style="flex:1"><h2>${S.admin ? 'Écarts entre placements et positions réelles' : 'Vos résultats'}</h2>${names && !S.admin ? `<p class="state" style="margin:4px 0 0">${esc(names)}</p>` : ''}</div>
      <button class="x" type="button" data-close aria-label="Fermer">×</button>
    </div>
    <div class="dlg-body">
      ${scored ? `<div class="score"><strong>${ok} / ${scored}</strong><span>bien placée(s)${near ? ` · ${near} proche(s)` : ''}</span></div>` : '<p class="state">Aucune position réelle n\'a encore été définie par l\'enseignant.</p>'}
      <div class="table-wrap"><table class="results">
        <thead><tr><th>N°</th><th>Fiche</th><th>Résultat</th><th>Écart</th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
              <td class="n"><span class="num ${posOf(r.fiche) ? 'on' : ''}">${r.n}</span></td>
              <td>${esc(titleOf(r.fiche))}${r.fiche.species && r.fiche.species !== titleOf(r.fiche) ? `<div class="sci" style="font-size:13px">${esc(r.fiche.species)}</div>` : ''}</td>
              <td><span class="grade ${r.ev.cls}">${esc(r.ev.label)}</span></td>
              <td>${esc(r.ev.dist || '—')}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>
      <p class="state" style="margin-top:12px">Bien placée : moins de ${THRESHOLDS.ok} % de la largeur du plan · Proche : moins de ${THRESHOLDS.near} %.${S.map.widthMeters ? '' : ' Indiquez la largeur réelle du terrain (Gestion › Cartes) pour obtenir les écarts en mètres.'}</p>
    </div>
    <div class="dlg-foot">
      <button class="btn ghost" type="button" id="resImg">Image du plan</button>
      <button class="btn ghost" type="button" id="resTeacher">Télécharger le rendu prof (CSV)</button>
      <button class="btn" type="button" id="resReport">Télécharger le compte rendu (JPG)</button>
    </div>`;
  $('#resultsBox [data-close]').onclick = () => $('#dlgResults').close();
  $('#resImg').onclick = downloadPlanImage;
  $('#resReport').onclick = downloadReport;
  $('#resTeacher').onclick = downloadTeacherCsv;
  $('#dlgResults').showModal();
}
