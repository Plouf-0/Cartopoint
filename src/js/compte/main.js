/**
 * Page des liens à usage unique : /invitation (créer son compte) et /reinitialisation (nouveau mot de
 * passe). Le jeton est dans le fragment de l'adresse, que le serveur et le proxy ne voient jamais.
 */
import { api } from '../api.js';
import { card, el, field, newPasswordForm, show } from './ui.js';

const token = location.hash.slice(1);
const isInvite = location.pathname === '/invitation';
// Le jeton ne reste ni dans la barre d'adresse ni dans l'historique du navigateur
history.replaceState(null, '', location.pathname);

const goToSpace = (account) => location.assign(account.role === 'admin' ? '/admin' : '/prof');

function start() {
  if (!token) {
    show([card('Lien incomplet', el('p', {}, 'Ouvrez de nouveau le lien reçu, en entier.'))]);
  } else if (isInvite) {
    const email = field('Adresse e-mail', { name: 'email', type: 'email', autocomplete: 'username', required: true });
    const send = async (data, password) => goToSpace(await api('POST', '/auth/invite', { token, email: data.get('email'), password }));
    show([card('Créer mon compte enseignant', newPasswordForm([email], 'Créer mon compte', send))]);
  } else {
    const send = async (data, password) => goToSpace(await api('POST', '/auth/reset', { token, password }));
    show([card('Choisir un nouveau mot de passe', newPasswordForm([], 'Enregistrer', send))]);
  }
}

start();
