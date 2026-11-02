/**
 * Onglet « Cours » : nom, publication, export. Remplace l'onglet Projet de l'application hors ligne.
 */
import { api } from '../api.js';
import { DEFAULT_TITLE, hasRef } from '../model.js';
import { render } from '../render.js';
import { S, changedMeta, flush, hasUnsentChanges } from '../store.js';
import { $, download, errorText, esc, safeFileName, toast } from '../util.js';
import { exportCourse } from './course-io.js';

/** Le cours lu sur le serveur, tenu à jour par course-backend.js. */
let course = null;
let publishError = '';

export function setCourse(value) {
  course = value;
}

export function publishStateText() {
  if (!course.published) return "Ce cours n'a pas encore été publié : les élèves n'y ont pas accès.";
  const date = new Date(course.published.publishedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  const version = `Version ${course.published.number}, publiée le ${date}.`;
  return course.modified ? `${version} Des modifications ne sont pas encore publiées.` : `${version} Elle est à jour.`;
}

/** Met à jour l'état de publication sans redessiner le panneau, pour ne pas gêner une saisie en cours. */
export function renderPublishState() {
  const state = $('#publishState');
  if (state) state.textContent = publishStateText();
  for (const button of [$('#publishBtn'), $('#publishTop')]) if (button) button.disabled = !course.modified;
  const error = $('#publishError');
  if (error) {
    error.textContent = publishError;
    error.hidden = !publishError;
  }
}

/** Ce qui mérite d'être signalé avant de publier, sans l'empêcher. */
function warnings() {
  const list = [];
  const noPlan = S.project.maps.filter((map) => !map.image).length;
  if (noPlan) list.push(`${noPlan} carte(s) sans image du plan.`);
  const visible = S.project.maps.flatMap((map) => map.fiches.filter((fiche) => fiche.visible));
  const noPosition = visible.filter((fiche) => !hasRef(fiche)).length;
  if (noPosition) list.push(`${noPosition} fiche(s) visible(s) sur ${visible.length} sans position réelle : les élèves pourront les placer, sans correction.`);
  return list;
}

export async function publishCourse() {
  const warned = warnings();
  if (warned.length && !confirm(`${warned.join('\n')}\n\nPublier quand même ?`)) return;
  publishError = '';
  renderPublishState();
  await flush();
  if (hasUnsentChanges()) {
    publishError = 'Publication impossible : les dernières modifications ne sont pas enregistrées. Voir le message en haut de la page.';
    return renderPublishState();
  }
  try {
    Object.assign(course, await api('POST', `/courses/${course.id}/publish`, { revision: course.revision }));
    toast(`✓ Version ${course.published.number} publiée`);
  } catch (e) {
    publishError = `Publication impossible : ${errorText(e)}`;
  }
  renderPublishState();
}

export function html() {
  const maps = S.project.maps.length;
  const fiches = S.project.maps.reduce((total, map) => total + map.fiches.length, 0);
  return `
    <h2>Cours</h2>
    <p class="sub">${maps} carte${maps > 1 ? 's' : ''}, ${fiches} fiche${fiches > 1 ? 's' : ''}. Vos modifications sont enregistrées au fur et à mesure.</p>
    <div class="field"><label for="projName">Nom du cours</label>
      <div class="inline"><input id="projName" class="text-input" value="${esc(S.project.title)}"><button type="button" class="btn soft sm" id="saveName">Renommer</button></div></div>

    <div class="section first">
      <h3>Publication</h3>
      <p>Les élèves voient la dernière version publiée. Publier fige une version : modifier le cours ensuite ne la change pas.</p>
      <p id="publishState"></p>
      <p class="form-error" id="publishError" role="alert" hidden></p>
      <button type="button" class="btn block" id="publishBtn">Publier les modifications</button>
    </div>

    <div class="section">
      <h3>Télécharger</h3>
      <p>Un fichier .json avec les fiches, les photos et les positions, pour garder une copie ou importer ce cours ailleurs.</p>
      <button type="button" class="btn ghost" id="exportJson">Télécharger le cours (.json)</button>
    </div>`;
}

export function bind() {
  renderPublishState();
  $('#saveName').onclick = () => {
    S.project.title = $('#projName').value.trim() || DEFAULT_TITLE;
    changedMeta();
    render();
    toast('Cours renommé');
  };
  $('#publishBtn').onclick = publishCourse;
  $('#exportJson').onclick = async () => {
    toast('Préparation du fichier…');
    try {
      download(JSON.stringify(await exportCourse(S.project)), safeFileName(S.project.title) + '.json', 'application/json');
      toast('✓ Fichier téléchargé');
    } catch (e) {
      toast('⚠ Téléchargement impossible : ' + errorText(e));
    }
  };
}
