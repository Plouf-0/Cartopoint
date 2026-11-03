/**
 * Onglet « Cours » : nom, publication, export. Remplace l'onglet Projet de l'application hors ligne.
 */
import { api } from '../api.js';
import { DEFAULT_TITLE, hasRef } from '../model.js';
import { render } from '../render.js';
import { S, changedMap, changedMeta, flush, hasUnsentChanges } from '../store.js';
import { $, download, errorText, esc, loadImage, safeFileName, toast } from '../util.js';
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
  const launch = $('#launchBtn');
  if (launch) {
    launch.disabled = !course.published;
    $('#launchHint').textContent = launchHintText();
  }
}

function launchHintText() {
  if (!course.published) return "Publiez d'abord le cours : les élèves n'ont accès qu'à une version publiée.";
  const version = `Les élèves verront la version ${course.published.number}.`;
  return course.modified ? `${version} Vos dernières modifications n'y seront pas : publiez-les avant de lancer.` : version;
}

async function launchCourse() {
  const error = $('#launchError');
  error.hidden = true;
  try {
    const launch = await api('POST', `/courses/${course.id}/launches`);
    location.href = `/prof/lancements/${launch.id}`;
  } catch (e) {
    error.textContent = `Lancement impossible : ${errorText(e)}`;
    error.hidden = false;
  }
}

function launchRow(launch) {
  const date = new Date(launch.endedAt ?? launch.openedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  const state = launch.endedAt ? `Terminé le ${date}` : `En cours depuis le ${date}, code ${launch.code}`;
  return `<li><a href="/prof/lancements/${esc(launch.id)}">${esc(state)}</a> <span class="hint">· ${launch.participantCount} élève(s) ou groupe(s)</span></li>`;
}

async function showLaunches() {
  const list = $('#launchList');
  try {
    list.innerHTML = (await api('GET', `/courses/${course.id}/launches`)).map(launchRow).join('');
  } catch {
    list.innerHTML = '<li class="hint">Liste des lancements indisponible pour le moment.</li>';
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

/**
 * CRG-09 : le serveur calcule les écarts sans jamais ouvrir le plan. Il lui faut ses proportions, telles que les élèves les
 * verront : une photo tournée par ses métadonnées n'a pas les dimensions écrites dans son fichier.
 */
async function measurePlans() {
  for (const map of S.project.maps) {
    if (!map.image) continue;
    let plan;
    try {
      plan = await loadImage(map.image);
    } catch {
      throw new Error(`le plan de la carte « ${map.name} » ne se charge pas.`);
    }
    const ratio = +(plan.naturalWidth / plan.naturalHeight).toFixed(4);
    if (map.ratio !== ratio) {
      map.ratio = ratio;
      changedMap(map);
    }
  }
}

export async function publishCourse() {
  const warned = warnings();
  if (warned.length && !confirm(`${warned.join('\n')}\n\nPublier quand même ?`)) return;
  publishError = '';
  renderPublishState();
  try {
    await measurePlans();
  } catch (e) {
    publishError = `Publication impossible : ${errorText(e)}`;
    return renderPublishState();
  }
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
      <h3>Lancer le cours</h3>
      <p>Chaque lancement a son QR code et sa propre liste d'élèves. Un cours peut être relancé, pour une autre classe par exemple.</p>
      <p id="launchHint"></p>
      <p class="form-error" id="launchError" role="alert" hidden></p>
      <button type="button" class="btn block" id="launchBtn">Lancer le cours</button>
      <ul class="launch-list" id="launchList"></ul>
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
  $('#launchBtn').onclick = launchCourse;
  showLaunches();
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
