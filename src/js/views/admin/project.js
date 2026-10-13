/**
 * Onglet « Projet » : nom, enregistrement, version élèves, publication, changement de projet.
 */
import { $, esc, toast } from '../../util.js';
import { S, changedMeta } from '../../store.js';
import { DEFAULT_TITLE } from '../../model.js';
import { render } from '../../render.js';
import { saveProject, exportStudentVersion, openProjectFile, startNewProject, publish, canBuildStandalone } from '../../project-io.js';

function statusLine() {
  if (S.local.dirty)
    return '<div class="locked-note" style="margin-bottom:10px">● Des modifications ne sont pas encore enregistrées dans un fichier ni publiées.</div>';
  const last = S.local.lastExport ? `✓ Enregistré le ${esc(new Date(S.local.lastExport).toLocaleString('fr-FR'))}.` : 'Aucune modification en attente.';
  return `<p class="hint" style="margin:0 0 10px">${last}</p>`;
}

export function html() {
  const nm = S.project.maps.length;
  const nf = S.project.maps.reduce((s, m) => s + m.fiches.length, 0);
  const standalone = canBuildStandalone();
  const online = S.source.kind === 'remote';
  return `
    <h2>Projet</h2>
    <p class="sub">Un projet regroupe tout : cartes, fiches, photos, positions réelles, thème. ${nm} carte${nm > 1 ? 's' : ''}, ${nf} fiche${nf > 1 ? 's' : ''}.</p>
    <div class="field"><label for="projName">Nom du projet (titre affiché en haut de la page)</label>
      <div class="inline"><input id="projName" class="text-input" value="${esc(S.project.title)}"><button type="button" class="btn soft sm" id="saveName">Renommer</button></div></div>
    ${statusLine()}

    ${
      online
        ? `<div class="section first">
      <h3>En ligne</h3>
      <p>Ce projet est chargé depuis le serveur (${esc(S.source.url)}). Les élèves voient la dernière version publiée en ouvrant le lien.</p>
      ${S.source.publishUrl ? '<button type="button" class="btn block" id="publishBtn">Publier les modifications</button>' : '<p>Pour mettre à jour la version en ligne, téléchargez <b>project.json</b> ci-dessous et donnez-le à la personne qui gère le site.</p>'}
    </div>`
        : ''
    }

    <div class="section ${online ? '' : 'first'}">
      <h3>Enregistrer</h3>
      <p>${standalone ? "Le fichier .html contient l'application et le projet : on l'ouvre d'un double-clic, sur n'importe quel ordinateur. " : ''}Le fichier .json contient seulement les données : c'est celui à mettre sur un serveur (nommé <b>project.json</b>).</p>
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
  $('#publishBtn')?.addEventListener('click', publish);
  $('#saveHtml')?.addEventListener('click', () => saveProject('html'));
  $('#saveJson').onclick = () => saveProject('json', S.source.kind === 'remote' ? 'project' : null);
  $('#exportStudents').onclick = () => exportStudentVersion({ clearPositions: $('#optClearPos').checked, clearMeasures: $('#optClearMeasures').checked });
  $('#openProject').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await openProjectFile(file);
  };
  $('#newProject').onclick = startNewProject;
}
