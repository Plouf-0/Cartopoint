/**
 * Page d'un élève, à l'adresse /c/<code> : entrer avec ses noms, puis lire les fiches et les placer. Le jeton reste dans ce
 * navigateur : revenir sur le même QR code reprend le même élève. Le travail est rangé sous l'identifiant de l'élève, donc
 * propre à chaque lancement, y compris sur un appareil partagé (COU-09).
 */
import { api } from '../api.js';
import { studentBackend } from '../backends/student.js';
import { card, el, field, onSubmit, show } from '../compte/ui.js';
import { Progress, openDb } from '../db.js';
import { normalizeProgress, normalizeProject } from '../model.js';
import { onRender, render } from '../render.js';
import { S, activate, flush, listed, posOf, switchMap, useBackend } from '../store.js';
import { applyTheme } from '../themes.js';
import { $, fatal, prefs } from '../util.js';
import { bindMap, renderMap } from '../views/map.js';
import { fillPanel } from '../views/panel-frame.js';
import { bindReader } from '../views/reader.js';
import { bindStudentList, studentListHTML } from '../views/student-list.js';
import { bindViewer } from '../views/viewer.js';

const code = decodeURIComponent(location.pathname.split('/').pop()).toUpperCase().replace(/[\s-]/g, '');
const codePath = encodeURIComponent(code);
const STORAGE_KEY = `cartopoint.eleve.${code}`;
const STATE_EVERY = 20000;

const remembered = () => JSON.parse(prefs.get(STORAGE_KEY, 'null'));

function refusal(error) {
  const again = error.status === 0;
  return card(
    'Impossible de rejoindre ce cours',
    el('p', {}, error.message),
    el('a', { className: 'btn ghost', href: again ? location.pathname : '/accueil' }, again ? 'Réessayer' : 'Taper un autre code')
  );
}

async function showJoin() {
  let title;
  try {
    ({ title } = await api('GET', `/join/${codePath}`));
  } catch (e) {
    return show([refusal(e)]);
  }
  const form = onSubmit(
    el(
      'form',
      {},
      field('Votre prénom et votre nom, ou ceux de votre groupe', { name: 'names', autocomplete: 'off', maxLength: 120, required: true }),
      el('button', { className: 'btn block', type: 'submit' }, 'Commencer')
    ),
    async (data) => {
      const me = await api('POST', `/join/${codePath}`, { names: data.get('names') });
      prefs.set(STORAGE_KEY, JSON.stringify(me));
      await openCourse(me);
    }
  );
  show([card(`Rejoindre « ${title} »`, form)]);
}

/** Le travail déjà fait sur cet appareil. Sans stockage, l'élève travaille quand même : la page le prévient. */
async function loadWork(project) {
  try {
    await openDb();
  } catch {
    S.storageOk = false;
    fatal('Ce navigateur ne peut pas garder votre travail (navigation privée ?). Ne fermez pas cette page.');
    return {};
  }
  const work = {};
  for (const map of project.maps) {
    const saved = await Progress.get(`${project.id}/${map.id}`);
    if (saved) work[map.id] = normalizeProgress(saved);
  }
  return work;
}

function renderHeader() {
  document.title = S.project.title;
  $('#pageTitle').textContent = S.project.title;
  $('#mapName').textContent = S.map.name;
  const list = listed();
  $('#progress').innerHTML = list.length ? `<b>${list.filter(posOf).length}</b> / ${list.length} fiche(s) placée(s)` : '';
  $('#plan').hidden = !S.map.image;
  $('#planEmpty').hidden = !!S.map.image;
}

const footHTML = () =>
  `<div class="panel-foot"><div class="locked-note">Votre travail reste dans ce navigateur. Pour le retrouver, rouvrez cette page ou le même QR code.</div></div>`;

function renderPanel() {
  fillPanel(listed().length, studentListHTML() + footHTML(), bindStudentList);
}

function bindHeader(me) {
  $('#studentName').textContent = me.names;
  $('#notMe').onclick = () => {
    if (!confirm(`Ce n'est pas vous ?\n\nVous pourrez entrer sous votre nom. Le travail de ${me.names} ne sera plus accessible depuis ce navigateur.`)) return;
    prefs.del(STORAGE_KEY);
    location.reload();
  };
  // E-01 : une sortie peut couvrir plusieurs sites, l'élève choisit sa carte
  $('#mapChoiceBox').hidden = S.project.maps.length < 2;
  $('#mapChoice').replaceChildren(...S.project.maps.map((map) => new Option(map.name, map.id)));
  $('#mapChoice').onchange = async (event) => {
    await switchMap(event.target.value);
    render();
  };
}

function showBanner(text) {
  const banner = $('#courseBanner');
  banner.textContent = text;
  banner.hidden = false;
}

/** Le cours est-il terminé ? Rien de grave si le réseau manque : on réessaiera. */
async function checkState(me) {
  try {
    const { ended } = await api('GET', '/student/state', undefined, me.token);
    if (ended) showBanner("L'enseignant a terminé ce cours. Votre travail reste dans ce navigateur.");
  } catch (e) {
    if (e.status === 401) showBanner("Ce cours n'existe plus. Votre travail reste dans ce navigateur.");
  }
}

function watchState(me) {
  const check = () => document.visibilityState === 'visible' && navigator.onLine && checkState(me);
  setInterval(check, STATE_EVERY);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  check();
}

async function openCourse(me) {
  let course;
  try {
    course = await api('GET', '/student/course', undefined, me.token);
  } catch (e) {
    if (e.status !== 401) return show([refusal(e)]);
    prefs.del(STORAGE_KEY);
    return show([
      card(
        "Ce cours n'existe plus",
        el('p', {}, 'Votre travail reste dans ce navigateur.'),
        el('a', { className: 'btn ghost', href: '/accueil' }, 'Taper un autre code')
      )
    ]);
  }
  const project = normalizeProject({ ...course, id: me.id });
  const work = await loadWork(project);

  $('#app').hidden = true;
  $('#course').hidden = false;
  activate(project, work, { dirty: false, baseRevision: null, lastExport: null });
  useBackend(studentBackend);
  onRender(() => applyTheme(S.project.theme));
  onRender(renderHeader);
  onRender(renderMap);
  onRender(renderPanel);
  bindHeader(me);
  bindMap();
  bindReader();
  bindViewer();
  render();
  // Une dernière écriture si l'élève ferme l'onglet juste après avoir placé une fiche
  window.addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  watchState(me);
}

const me = remembered();
if (me) openCourse(me);
else showJoin();
