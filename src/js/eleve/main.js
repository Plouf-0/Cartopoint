/**
 * Page d'un élève, à l'adresse /c/<code> : entrer avec ses noms, lire les fiches, les placer, puis terminer. Le jeton reste
 * dans ce navigateur : revenir sur le même QR code reprend le même élève. Le travail est rangé sous l'identifiant de l'élève,
 * donc propre à chaque lancement, y compris sur un appareil partagé (COU-09). Le cours y est gardé dès sa réception : une fois la page
 * récupérée, le réseau ne sert plus qu'à rendre et à recevoir la correction (HOR-01, HOR-03). Dès que la page apprend la fin du cours, le travail
 * est figé et envoyé, sans lui demander (CRG-11), puis la correction arrive d'elle-même (CRG-12).
 */
import { api } from '../api.js';
import { studentBackend } from '../backends/student.js';
import { card, el, field, onSubmit, show } from '../compte/ui.js';
import { Progress, openDb } from '../db.js';
import { reportIncident } from '../incident.js';
import { normalizeProgress, normalizeProject, placedPos } from '../model.js';
import { onRender, render } from '../render.js';
import { S, activate, flush, listed, posOf, switchMap, useBackend } from '../store.js';
import { applyTheme } from '../themes.js';
import { $, download, errorText, esc, fatal, prefs, safeFileName, toast } from '../util.js';
import { bindMap, renderMap } from '../views/map.js';
import { fillPanel } from '../views/panel-frame.js';
import { bindReader } from '../views/reader.js';
import { bindStudentList, studentListHTML } from '../views/student-list.js';
import { bindViewer } from '../views/viewer.js';
import { bindNetworkIcon, serverAnswered, showPreparation } from './network-icon.js';
import { applyCorrection, eraseClosedCourses, markForErasure, readSession, saveSession, scoreText, showCorrection } from './correction.js';
import { prepareOffline, startWorker } from './offline.js';

const code = decodeURIComponent(location.pathname.split('/').pop()).toUpperCase().replace(/[\s-]/g, '');
const codePath = encodeURIComponent(code);
const STORAGE_KEY = `cartopoint.eleve.${code}`;
const STATE_EVERY = 20000;

const COURSE_GONE = "Ce cours n'existe plus. Votre travail reste dans ce navigateur.";
const COURSE_ENDED = "L'enseignant a terminé ce cours : votre travail est figé et envoyé.";
const COURSE_CORRECTED = "L'enseignant a terminé ce cours. Votre correction est arrivée.";
const CLOSED_BEFORE_END = "Ce cours est terminé, et votre travail est envoyé. La correction n'est donnée qu'aux pages restées ouvertes jusqu'à la fin.";
const SEND_STATES = {
  sending: 'Envoi de vos réponses…',
  waiting: "Envoi impossible pour l'instant. Vos réponses restent sur cet appareil : gardez cette page ouverte, ou rouvrez-la quand vous aurez du réseau.",
  refused: 'Le serveur a refusé vos réponses. Montrez cet écran à votre enseignant.',
  received: '✓ Vos réponses sont bien arrivées.'
};

const remembered = () => JSON.parse(prefs.get(STORAGE_KEY, 'null'));
const submissionKey = (id) => `rendu/${id}`;
const courseKey = (id) => `cours/${id}`;

let token = null;
let courseEnded = false;
/**
 * Le rendu de cet élève. Il reste dans le navigateur une fois reçu : une coupure de courant peut faire perdre au serveur un
 * rendu déjà confirmé (section 4 de la feuille de route), et la page le renvoie alors.
 */
let submission = null;
/** Cet onglet : voir eleve/correction.js. */
let session = null;
let studentId = null;
let studentNames = '';
let sendState = 'sending';
let sending = false;
let receiving = false;

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

/** Sans stockage, l'élève travaille quand même : la page le prévient. */
async function openStorage() {
  try {
    await openDb();
  } catch {
    S.storageOk = false;
    fatal('Ce navigateur ne peut pas garder votre travail (navigation privée ?). Ne fermez pas cette page.');
  }
}

/** Le cours de cet élève, déjà sur cet appareil. Sa version est figée au lancement (COU-11) : il n'y a jamais à le redemander. */
async function keptCourse(id) {
  if (!S.storageOk) return null;
  try {
    return (await Progress.get(courseKey(id))) ?? null;
  } catch {
    return null;
  }
}

async function keepCourse(id, course) {
  if (!S.storageOk) return false;
  try {
    await Progress.put(courseKey(id), course);
    return true;
  } catch {
    return false;
  }
}

/** Le travail déjà fait sur cet appareil. */
async function loadWork(project) {
  if (!S.storageOk) return {};
  submission = (await Progress.get(submissionKey(project.id))) ?? null;
  S.finished = Boolean(submission);
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
  $('#legendRef').hidden = !S.correction;
  $('#plan').hidden = !S.map.image;
  $('#planEmpty').hidden = !!S.map.image;
}

function footHTML() {
  if (S.correction) {
    return `<div class="panel-foot">
      <div class="locked-note" role="status">🔒 Travail terminé.<br><b>${esc(scoreText(S.correction))}</b></div>
      <button type="button" class="btn" id="seeCorrection">Voir ma correction</button>
    </div>`;
  }
  if (!submission) {
    return `<div class="panel-foot">
      <button type="button" class="btn" id="finishBtn">Terminer</button>
      <p class="hint">Quand vous avez fini : vos placements et vos mesures seront figés, puis envoyés à l'enseignant. D'ici là, votre travail reste dans ce navigateur.</p>
    </div>`;
  }
  return `<div class="panel-foot">
      <div class="locked-note" role="status">🔒 Travail terminé : il ne peut plus être modifié.<br>${SEND_STATES[sendState]}</div>
      ${sendState === 'waiting' ? '<button type="button" class="btn soft" id="retrySend">Réessayer</button>' : ''}
      ${sendState === 'waiting' || sendState === 'refused' ? '<button type="button" class="btn ghost" id="saveAnswers">Télécharger mes réponses, à donner à l’enseignant</button>' : ''}
    </div>`;
}

function bindPanel(panel) {
  bindStudentList(panel);
  $('#finishBtn')?.addEventListener('click', finish);
  $('#retrySend')?.addEventListener('click', sendAnswers);
  $('#saveAnswers')?.addEventListener('click', saveAnswersFile);
  $('#seeCorrection')?.addEventListener('click', () => showCorrection(studentNames));
}

function renderPanel() {
  fillPanel(listed().length, studentListHTML() + footHTML(), bindPanel);
}

/** Les fiches non placées, sur toutes les cartes : l'élève n'a peut-être pas vu l'autre carte. */
const unplacedCount = () =>
  S.project.maps.reduce((count, map) => count + map.fiches.filter((fiche) => !placedPos(S.progress[map.id]?.entries[fiche.id])).length, 0);

async function keepSubmission() {
  if (!S.storageOk) return;
  try {
    await Progress.put(submissionKey(S.project.id), submission);
  } catch (e) {
    toast('⚠ Enregistrement impossible : ' + errorText(e));
  }
}

async function sendAnswers() {
  if (sending) return;
  sending = true;
  sendState = 'sending';
  render();
  try {
    const { answers, finishedAt, autoClosed } = submission;
    // Son heure à l'envoi permet au serveur de corriger une horloge fausse (CRG-13)
    await api('PUT', '/student/answers', { answers, autoClosed: Boolean(autoClosed), finishedAt: Date.parse(finishedAt), sentAt: Date.now() }, token);
    sendState = 'received';
    serverAnswered();
  } catch (e) {
    serverAnswered(e);
    // Une réponse du serveur qui refuse ne changera pas d'elle-même. Tout le reste se réessaie
    sendState = e.status === 400 || e.status === 413 ? 'refused' : 'waiting';
    if (e.status === 400) reportIncident('Envoi des réponses', `refus du serveur : ${e.message}`, '');
    if (e.status === 401) courseGone();
  }
  sending = false;
  render();
  // Le contrôle qui a appris la fin du cours a pu passer pendant cet envoi : la correction n'attend pas le suivant
  if (courseEnded && sendState === 'received') await receiveCorrection();
}

/** Sans réseau, le travail peut quand même arriver : ce fichier contient ses réponses, jamais la correction (HOR-09). */
function saveAnswersFile() {
  const { answers, finishedAt } = submission;
  const file = { format: 'cartopoint-reponses', version: 1, participantId: studentId, names: studentNames, answers, finishedAt: Date.parse(finishedAt) };
  download(JSON.stringify(file), `${safeFileName(`Réponses - ${studentNames}`)}.json`, 'application/json');
}

const currentAnswers = () => Object.fromEntries(S.project.maps.map((map) => [map.id, S.progress[map.id]?.entries ?? {}]));

/** La fin du cours fige le travail, sans lui demander : c'est écrit tout de suite, pour qu'un second contrôle n'en fasse pas un second envoi. */
async function closeAtEnd() {
  submission = { answers: currentAnswers(), finishedAt: new Date().toISOString(), autoClosed: true };
  S.finished = true;
  S.ui.placing = null;
  if ($('#dlgRead').open) $('#dlgRead').close();
  await flush();
  await keepSubmission();
}

async function finish() {
  const missing = unplacedCount();
  const warning = missing ? `${missing} fiche(s) ne sont pas placée(s).\n\n` : '';
  if (!confirm(`${warning}Terminer ? Vos placements et vos mesures seront figés, puis envoyés à l'enseignant.`)) return;
  await flush();
  submission = { answers: currentAnswers(), finishedAt: new Date().toISOString() };
  S.finished = true;
  S.ui.placing = null;
  await keepSubmission();
  showCourseState();
  await sendAnswers();
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

/** Son jeton ne vaut plus rien : le travail reste à l'écran le temps de la page, mais son nom ne reste pas sur l'appareil. */
function courseGone() {
  showBanner(COURSE_GONE);
  prefs.del(STORAGE_KEY);
}

function showCourseState() {
  if (courseEnded) showBanner(S.correction ? COURSE_CORRECTED : session.beforeEnd ? COURSE_ENDED : CLOSED_BEFORE_END);
}

/** La correction, pour une page restée ouverte jusqu'à la fin. Les réponses sont arrivées : le serveur peut la donner. Une coupure se rattrape au contrôle suivant. */
async function receiveCorrection() {
  if (!session.beforeEnd) return markForErasure(studentId);
  if (S.correction || receiving) return;
  receiving = true;
  let correction;
  try {
    correction = await api('GET', '/student/correction', undefined, token);
  } catch (e) {
    return serverAnswered(e);
  } finally {
    receiving = false;
  }
  session.correction = correction;
  saveSession(studentId, session);
  await markForErasure(studentId);
  applyCorrection(correction);
  showCourseState();
  render();
  toast('✓ Votre correction est arrivée');
}

/** Le cours est-il terminé ? Le rendu est-il bien arrivé ? Rien de grave si le réseau manque : on réessaiera. */
async function checkState() {
  let state;
  try {
    state = await api('GET', '/student/state', undefined, token);
    serverAnswered();
  } catch (e) {
    serverAnswered(e);
    if (e.status === 401) courseGone();
    // Le réseau peut être annoncé alors qu'il ne répond pas : ne pas laisser croire qu'un envoi est en cours
    if (submission && sendState === 'sending' && !sending) {
      sendState = 'waiting';
      render();
    }
    return;
  }
  if (!state.ended && !session.beforeEnd) {
    session.beforeEnd = true;
    saveSession(studentId, session);
  }
  courseEnded = state.ended;
  if (courseEnded && !submission) await closeAtEnd();
  showCourseState();
  if (!submission) return;
  if (!state.received) {
    if (sendState !== 'refused') await sendAnswers();
  } else if (sendState !== 'received') {
    sendState = 'received';
    render();
  }
  if (courseEnded && sendState === 'received') await receiveCorrection();
}

function watchState() {
  const check = () => !S.correction && document.visibilityState === 'visible' && navigator.onLine && checkState();
  setInterval(check, STATE_EVERY);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  check();
}

let offlineState = null;
let preparing = false;

function showOfflineState(status) {
  offlineState = status.state;
  showPreparation(status);
  // Ce que le navigateur a répondu, et rien sur l'élève
  if (status.state === 'incomplete') reportIncident('Préparation pour le terrain', `${status.failed} image(s) non téléchargée(s) : ${status.why}`, '');
  if (status.state === 'unavailable') reportIncident('Préparation pour le terrain', status.why, '');
}

async function prepare(project) {
  if (preparing) return;
  preparing = true;
  await prepareOffline(project, showOfflineState);
  preparing = false;
}

/** Le cours gardé sur cet appareil ou, à défaut, celui du serveur. Sans cours, la page explique pourquoi et répond null. */
async function fetchCourse(me) {
  try {
    return await api('GET', '/student/course', undefined, me.token);
  } catch (e) {
    if (e.status !== 401) {
      show([refusal(e)]);
      return null;
    }
    prefs.del(STORAGE_KEY);
    show([
      card(
        "Ce cours n'existe plus",
        el('p', {}, 'Votre travail reste dans ce navigateur.'),
        el('a', { className: 'btn ghost', href: '/accueil' }, 'Taper un autre code')
      )
    ]);
    return null;
  }
}

async function openCourse(me) {
  await openStorage();
  let course = await keptCourse(me.id);
  let kept = Boolean(course);
  if (!course) {
    course = await fetchCourse(me);
    if (!course) return;
    kept = await keepCourse(me.id, course);
  }
  token = me.token;
  studentId = me.id;
  studentNames = me.names;
  session = readSession(me.id) ?? { beforeEnd: false, correction: null };
  saveSession(me.id, session);
  const project = normalizeProject({ ...course, id: me.id });
  const work = await loadWork(project);
  if (submission && !navigator.onLine) sendState = 'waiting';

  $('#app').hidden = true;
  $('#course').hidden = false;
  activate(project, work, { dirty: false, baseRevision: null, lastExport: null });
  useBackend(studentBackend);
  S.stampAnswers = true;
  if (session.correction) {
    applyCorrection(session.correction);
    courseEnded = true;
    sendState = 'received';
    showCourseState();
  }
  onRender(() => applyTheme(S.project.theme));
  onRender(renderHeader);
  onRender(renderMap);
  onRender(renderPanel);
  bindHeader(me);
  bindNetworkIcon();
  $('#netRetry').onclick = () => prepare(S.project);
  bindMap();
  bindReader();
  bindViewer();
  render();
  // Une dernière écriture si l'élève ferme l'onglet juste après avoir placé une fiche
  window.addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  watchState();
  if (!kept) return showOfflineState({ state: 'unavailable', why: 'le cours ne peut pas être écrit sur cet appareil' });
  window.addEventListener('online', () => offlineState !== 'ready' && prepare(project));
  prepare(project);
}

startWorker();
eraseClosedCourses().then(() => {
  const me = remembered();
  if (me) openCourse(me);
  else showJoin();
});
