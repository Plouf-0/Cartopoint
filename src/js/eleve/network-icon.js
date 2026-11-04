/**
 * L'icône du réseau, en haut de la page élève : en ligne ou non, et le cours est-il prêt pour le terrain ? Le détail s'affiche au survol, ou
 * d'un appui dessus. Seul ce qui demande à l'élève d'agir s'ouvre de lui-même : une fois le réseau quitté, il serait trop tard. Le passage à
 * « prêt » s'annonce par un message qui disparaît.
 */
import { $, toast } from '../util.js';

const SENTENCES = {
  downloading: ({ done, total }) => `Téléchargement pour le terrain… ${total ? `${done} / ${total}` : ''}`,
  ready: () => '✓ Prêt pour le terrain : le cours reste disponible sans réseau.',
  incomplete: ({ failed }) => `⚠ Téléchargement incomplet : ${failed} image(s) manqueront sans réseau. Restez connecté.`,
  unavailable: () => '⚠ Ce navigateur ne gardera pas le cours sans réseau : restez connecté et ne fermez pas cette page.'
};
const BADGES = { downloading: '…', ready: '✓' };
const OFFLINE_NOTE = 'Vos réponses partiront au retour du réseau.';

let state = null;
// navigator.onLine peut annoncer un réseau qui ne répond pas : seule la réponse du serveur le prouve
let serverReached = true;
let attention = false;

const isOnline = () => navigator.onLine && serverReached;
const needsAttention = () => state === 'incomplete' || state === 'unavailable' || (state === 'downloading' && !isOnline());

function setOpen(open) {
  $('#netInfo').classList.toggle('open', open);
  $('#netButton').setAttribute('aria-expanded', String(open));
}

function refresh() {
  const online = isOnline();
  const title = online ? 'En ligne' : 'Hors ligne';
  const sentence = $('#offlineStatus').textContent;
  const button = $('#netButton');
  const wasAttention = attention;
  attention = needsAttention();
  button.classList.toggle('offline', !online);
  button.classList.toggle('ready', state === 'ready');
  button.classList.toggle('warning', attention);
  button.setAttribute('aria-label', `${title}. ${sentence}`);
  $('#netBadge').textContent = attention ? '!' : (BADGES[state] ?? '');
  $('#netTitle').textContent = title;
  $('#netText').textContent = !online && state === 'ready' ? `${sentence} ${OFFLINE_NOTE}` : sentence;
  if (attention && !wasAttention) setOpen(true);
}

/** @param status ce que répond prepareOffline() : son état, et ce qu'il faut pour le dire */
export function showPreparation(status) {
  const becameReady = status.state === 'ready' && state !== 'ready';
  state = status.state;
  $('#offlineStatus').textContent = SENTENCES[state](status);
  $('#netRetry').hidden = state !== 'incomplete';
  refresh();
  if (!becameReady) return;
  setOpen(false);
  toast(SENTENCES.ready());
}

/** Le serveur a-t-il répondu ? Un refus est une réponse : c'est son silence qui veut dire « hors ligne ». */
export function serverAnswered(error) {
  serverReached = !error || (error.status !== 0 && error.status < 500);
  refresh();
}

export function bindNetworkIcon() {
  $('#netButton').onclick = () => setOpen(!$('#netInfo').classList.contains('open'));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#net')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
  window.addEventListener('online', () => {
    serverReached = true;
    refresh();
  });
  window.addEventListener('offline', refresh);
  refresh();
}
