/**
 * Page d'un lancement : ce qu'il faut montrer à la classe, la liste des élèves, et la fin du cours. La liste se met à jour
 * toute seule (SUI-02). Tout texte passe par des nœuds de texte : un nom d'élève ne peut pas injecter de code.
 */
import { api } from '../api.js';
import { card, dateAndTime, el, errorLine, show, showError } from '../compte/ui.js';
import { qrSvg } from './qr.js';

const launchId = decodeURIComponent(location.pathname.split('/').pop());
/** L'adresse à taper avec le code. Elle deviendra la racine du site à l'étape 10. */
const HOME_PATH = '/accueil';
const READY_ADVICE = 'Avant de quitter le réseau, attendez de voir « ✓ Prêt pour le terrain » sur votre écran.';
const REFRESH_EVERY = 5000;

function button(label, className, onClick) {
  const node = el('button', { className, type: 'button' }, label);
  node.addEventListener('click', onClick);
  return node;
}

/** Le QR code en grand, à projeter, avec le code et l'adresse pour ceux qui préfèrent les taper. */
function qrDialog(code) {
  const close = button('×', 'x', () => dialog.close());
  close.setAttribute('aria-label', 'Fermer');
  const dialog = el(
    'dialog',
    { className: 'qr-dialog', 'aria-label': 'QR code du cours' },
    el(
      'div',
      { className: 'dlg' },
      el('div', { className: 'dlg-head' }, el('h2', {}, 'Rejoindre le cours'), close),
      el(
        'div',
        { className: 'dlg-body' },
        el('div', { className: 'qr-box' }, qrSvg(`${location.origin}/c/${code}`)),
        el('p', { className: 'launch-code' }, code),
        el('p', { className: 'hint' }, `Ou tapez ce code sur ${location.host}${HOME_PATH}`),
        el('p', { className: 'hint' }, READY_ADVICE)
      )
    )
  );
  document.body.append(dialog);
  return dialog;
}

function participantRow(participant) {
  const state = participant.submittedAt ? (participant.late ? 'A fini, après la fin du cours' : 'A fini') : 'A commencé';
  return el('li', {}, el('span', {}, participant.names), el('span', { className: `participant-state ${participant.submittedAt ? 'done' : ''}` }, state));
}

function showLaunch(first) {
  document.title = `${first.title} — Cartopoint`;
  const qr = qrDialog(first.code);

  const showQr = button('Afficher le QR code', 'btn', () => qr.showModal());
  const code = el('p', { className: 'launch-code' }, first.code);
  const address = el('p', { className: 'hint' }, `Les élèves scannent le QR code, ou tapent ce code sur ${location.host}${HOME_PATH}`);
  const joinCard = card('Pour rejoindre le cours', code, address, showQr);

  const listError = errorLine();
  const count = el('p', { className: 'hint' });
  const list = el('ul', { className: 'participants' });
  const empty = el('div', { className: 'empty-box' }, 'Aucun élève pour le moment.');

  const endError = errorLine();
  const endNote = el('p', { className: 'hint' }, 'Le QR code et le code cesseront de fonctionner. Les élèves déjà entrés gardent leur travail.');
  const end = button('Terminer le cours', 'btn danger', async () => {
    const unfinished = latest.participants.filter((participant) => !participant.submittedAt).length;
    const warning = unfinished
      ? `\n\n${unfinished} élève(s) ou groupe(s) n'ont pas encore fini : leur rendu restera possible, et sera signalé comme tardif.`
      : '';
    if (!confirm(`Terminer le cours ?\n\nLe QR code et le code cesseront de fonctionner.${warning}`)) return;
    end.disabled = true;
    endError.hidden = true;
    try {
      apply(await api('POST', `/launches/${launchId}/end`));
    } catch (e) {
      showError(endError, e);
    } finally {
      end.disabled = false;
    }
  });
  const endCard = card('Fin du cours', endNote, endError, end);

  const state = el('p', { className: 'hint' });
  const header = el(
    'section',
    { className: 'account-card launch-head' },
    el('a', { className: 'btn ghost sm', href: `/prof/cours/${encodeURIComponent(first.courseId)}` }, '← Retour au cours'),
    el('h1', {}, first.title),
    state
  );

  let latest = first;
  function apply(launch) {
    latest = launch;
    const ended = Boolean(launch.endedAt);
    state.textContent = ended
      ? `Terminé le ${dateAndTime(launch.endedAt)}. Version ${launch.versionNumber} du cours.`
      : `En cours depuis le ${dateAndTime(launch.openedAt)}. Version ${launch.versionNumber} du cours.`;
    joinCard.hidden = ended;
    endCard.hidden = ended;
    if (ended && qr.open) qr.close();
    const finished = launch.participants.filter((participant) => participant.submittedAt).length;
    const done = finished === 0 ? "aucun n'a fini" : finished === 1 ? '1 a fini' : `${finished} ont fini`;
    count.textContent = `${launch.participants.length} élève(s) ou groupe(s) entré(s), ${done}.`;
    list.replaceChildren(...launch.participants.map(participantRow));
    empty.hidden = launch.participants.length > 0;
  }

  async function refresh() {
    try {
      apply(await api('GET', `/launches/${launchId}`));
      listError.hidden = true;
    } catch (e) {
      // La liste affichée reste : mieux vaut une liste un peu ancienne que plus de liste du tout
      showError(listError, {
        message: e.status === 401 ? 'Votre session a expiré : reconnectez-vous pour voir la liste à jour.' : `Liste non mise à jour : ${e.message}`
      });
    }
  }

  show([header, joinCard, card('Élèves', count, listError, list, empty), endCard], { wide: true });
  apply(first);
  setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_EVERY);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
}

async function start() {
  try {
    showLaunch(await api('GET', `/launches/${launchId}`));
  } catch (e) {
    if (e.status === 401) return location.replace('/prof');
    const text = e.status === 404 ? 'Ce lancement est introuvable.' : e.message;
    show([card('Lancement', el('p', {}, text), el('a', { className: 'btn ghost sm', href: '/prof' }, 'Revenir à mes cours'))]);
  }
}

start();
