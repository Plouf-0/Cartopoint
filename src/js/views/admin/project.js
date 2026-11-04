/**
 * Onglet « Projet » du fichier de secours : nom, enregistrement, version élèves, changement de projet.
 */
import { $, esc, toast } from '../../util.js';
import { S, changedMeta } from '../../store.js';
import { DEFAULT_TITLE } from '../../model.js';
import { render } from '../../render.js';
import { saveProject, exportStudentVersion, openProjectFile, startNewProject, canBuildStandalone } from '../../project-io.js';

function statusLine() {
  if (S.local.dirty) return '<div class="locked-note" style="margin-bottom:10px">● Des modifications ne sont pas encore enregistrées dans un fichier.</div>';
  const last = S.local.lastExport ? `✓ Enregistré le ${esc(new Date(S.local.lastExport).toLocaleString('fr-FR'))}.` : 'Aucune modification en attente.';
  return `<p class="hint" style="margin:0 0 10px">${last}</p>`;
}

export function html() {
  const nm = S.project.maps.length;
  const nf = S.project.maps.reduce((s, m) => s + m.fiches.length, 0);
  const standalone = canBuildStandalone();
  return `
    <h2>Projet</h2>
    <p class="sub">Un projet regroupe tout : cartes, fiches, photos, positions réelles, thème. ${nm} carte${nm > 1 ? 's' : ''}, ${nf} fiche${nf > 1 ? 's' : ''}.</p>
    <div class="field"><label for="projName">Nom du projet (titre affiché en haut de la page)</label>
      <div class="inline"><input id="projName" class="text-input" value="${esc(S.project.title)}"><button type="button" class="btn soft sm" id="saveName">Renommer</button></div></div>
    ${statusLine()}

    <div class="section first">
      <h3>Enregistrer</h3>
      <p>${standalone ? "Le fichier .html contient l'application et le projet : on l'ouvre d'un double-clic, sur n'importe quel ordinateur. " : ''}Le fichier .json contient seulement les données : c'est celui à importer dans un espace enseignant.</p>
      <div class="inline">
        ${standalone ? '<button type="button" class="btn" id="saveHtml">Enregistrer le projet (.html)</button>' : ''}
        <button type="button" class="btn ${standalone ? 'ghost' : ''}" id="saveJson">Données du projet (.json)</button>
      </div>
    </div>

    <div class="section">
      <h3>Version pour les élèves</h3>
      <p>Sans les fiches masquées. ${standalone ? "Envoyez le fichier par l'ENT ou sur clé USB." : ''}</p>
      <label class="check light"><input type="checkbox" id="optClearPos" checked> Effacer les placements déjà faits</label>
      <label class="check light"><input type="checkbox" id="optClearMeasures"> Effacer les mesures (température, hygrométrie, éclairement)</label>
      <button type="button" class="btn soft block" id="exportStudents">Télécharger la version élèves</button>
    </div>

    <div class="section">
      <h3>Changer de projet</h3>
      <p>Ouvrir un autre projet ou en commencer un nouveau remplace ce qui est affiché dans ce navigateur. Enregistrez d'abord le projet en cours si vous voulez le garder.</p>
      <div class="inline">
        <label class="btn ghost sm file-btn">Ouvrir un projet<input type="file" id="openProject" accept=".html,.htm,.json"></label>
        <button type="button" class="btn ghost sm" id="newProject">Nouveau projet vide</button>
      </div>
    </div>`;
}

export function bind() {
  $('#saveName').onclick = () => {
    S.project.title = $('#projName').value.trim() || DEFAULT_TITLE;
    changedMeta();
    render();
    toast('Projet renommé');
  };
  $('#saveHtml')?.addEventListener('click', () => saveProject('html'));
  $('#saveJson').onclick = () => saveProject('json');
  $('#exportStudents').onclick = () => exportStudentVersion({ clearPositions: $('#optClearPos').checked, clearMeasures: $('#optClearMeasures').checked });
  $('#openProject').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await openProjectFile(file);
  };
  $('#newProject').onclick = startNewProject;
}
