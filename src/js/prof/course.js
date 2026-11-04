/**
 * Page d'un cours dans l'espace enseignant : les vues de gestion de l'application, enregistrées sur le serveur.
 * `S.admin` y vaut toujours true : il n'y a ni bouton Gestion ni vue élèves ici.
 */
import { api } from '../api.js';
import { reportIncident } from '../incident.js';
import { draftOf, hasRef, normalizeProject } from '../model.js';
import { onRender, render } from '../render.js';
import { S, activate, changedMap, fiches, flush, hasPendingChanges, hasUnsentChanges, storeMapImage, useBackend } from '../store.js';
import { applyTheme } from '../themes.js';
import { $, errorText, fatal, pickFile, toast } from '../util.js';
import { setProjectTab } from '../views/admin/index.js';
import { bindEditor } from '../views/editor.js';
import { bindMap, renderMap } from '../views/map.js';
import { renderPanel } from '../views/panel.js';
import { bindViewer } from '../views/viewer.js';
import { createCourseBackend } from './course-backend.js';
import * as courseTab from './course-tab.js';

const courseId = decodeURIComponent(location.pathname.split('/').pop());

function renderHeader() {
  document.title = S.project.title;
  $('#pageTitle').textContent = S.project.title;
  $('#mapName').textContent = S.map.name;
  const positions = fiches().filter(hasRef).length;
  $('#progress').innerHTML = `<b>${fiches().length}</b> fiche(s) · <b>${positions}</b> position(s) réelle(s) définie(s)`;
  // Sans plan, il n'y a rien sur quoi placer les fiches : on le dit, et on propose de l'ajouter
  $('#plan').hidden = !S.map.image;
  $('#planEmpty').hidden = !!S.map.image;
  courseTab.renderPublishState();
}

/** L'état de l'enregistrement reste visible : une erreur ne disparaît pas tant qu'elle n'est pas réglée. */
function showSaveState(reported, error) {
  // Une écriture vient d'aboutir, mais une modification faite entre-temps attend encore de partir
  const state = reported === 'saved' && hasUnsentChanges() ? 'saving' : reported;
  $('#saveState').textContent = state === 'saving' ? 'Enregistrement…' : state === 'saved' ? '✓ Enregistré' : '';
  const banner = $('#saveBanner');
  banner.hidden = state !== 'error';
  if (state === 'saved') courseTab.renderPublishState();
  if (state !== 'error') return;

  const reload = error.status === 409;
  const expired = error.status === 401;
  if (!reload && !expired) reportIncident('Enregistrement du cours', error);
  $('#saveBannerText').textContent = reload
    ? `${errorText(error)} Rechargez la page pour retrouver la dernière version enregistrée.`
    : expired
      ? 'Votre session a expiré. Reconnectez-vous dans un autre onglet, puis réessayez : vos modifications sont encore sur cette page.'
      : `Enregistrement impossible : ${errorText(error)} Vos modifications sont encore sur cette page.`;
  $('#saveLogin').hidden = !expired;
  $('#saveRetry').textContent = reload ? 'Recharger la page' : 'Réessayer';
  $('#saveRetry').onclick = () => (reload ? location.reload() : flush());
}

function bindPlanChoice() {
  $('#planChoose').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      S.map.image = await storeMapImage(file);
    } catch (e) {
      return toast('⚠ Image impossible à enregistrer : ' + errorText(e));
    }
    changedMap();
    render();
  };
}

function showFailure(message) {
  const link = document.createElement('a');
  link.href = '/prof';
  link.textContent = ' Revenir à mes cours';
  fatal(message);
  $('#fatal').append(link);
}

async function start() {
  S.admin = true;
  S.teacherSpace = true;
  S.source.kind = 'course';
  setProjectTab('Cours', courseTab);
  $('#publishTop').onclick = courseTab.publishCourse;

  let course;
  try {
    course = await api('GET', `/courses/${encodeURIComponent(courseId)}`);
  } catch (e) {
    if (e.status === 401) return location.replace('/prof');
    return showFailure(e.status === 404 ? 'Ce cours est introuvable.' : `Impossible d'ouvrir ce cours : ${errorText(e)}`);
  }
  const { draft, ...details } = course;
  const project = normalizeProject(draft);
  activate(project, {}, { dirty: false, baseRevision: null, lastExport: null });
  courseTab.setCourse(details);
  useBackend(createCourseBackend({ course: details, getDraft: () => draftOf(S.project), onState: showSaveState }));

  onRender(() => applyTheme(S.project.theme));
  onRender(renderHeader);
  onRender(renderMap);
  onRender(renderPanel);
  bindMap();
  bindEditor();
  bindViewer();
  bindPlanChoice();
  render();

  // Une dernière écriture si l'on change d'onglet, et un avertissement si l'on quitte la page avant qu'elle ait abouti
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  window.addEventListener('beforeunload', (event) => {
    if (hasPendingChanges()) event.preventDefault();
  });
}

start();
