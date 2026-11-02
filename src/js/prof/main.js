/**
 * Espace enseignant : connexion, puis ses cours.
 */
import { currentAccount } from '../api.js';
import { accountBar, card, changePasswordForm, el, errorLine, loginForm, show, showError } from '../compte/ui.js';

function showLogin() {
  show([
    card(
      'Espace enseignant',
      loginForm(() => start()),
      el('p', { className: 'hint' }, "Pas encore de compte ? Demandez un lien de création à l'administrateur.")
    )
  ]);
}

function showSpace(account) {
  show([
    accountBar(account, showLogin),
    card('Mes cours', el('div', { className: 'empty-box' }, 'Vos cours apparaîtront ici.')),
    card('Mon mot de passe', changePasswordForm())
  ]);
}

function showAdminNotice(account) {
  show([
    accountBar(account, showLogin),
    card(
      "Compte d'administration",
      el('p', {}, "Ce compte sert à gérer les enseignants et n'a pas de cours. "),
      el('a', { className: 'btn', href: '/admin' }, 'Ouvrir le tableau de bord')
    )
  ]);
}

async function start() {
  try {
    const account = await currentAccount();
    if (!account) showLogin();
    else if (account.role === 'admin') showAdminNotice(account);
    else showSpace(account);
  } catch (e) {
    const error = errorLine();
    showError(error, e);
    show([card('Espace enseignant', error)]);
  }
}

start();
