/**
 * Tableau de bord de l'admin : inviter des enseignants, les voir, réinitialiser un mot de passe,
 * désactiver puis supprimer un compte. Il ne montre jamais le contenu des cours (ADM-07).
 */
import { api, currentAccount } from '../api.js';
import { accountBar, card, changePasswordForm, dateAndTime, el, errorLine, linkBox, loginForm, show, showError } from '../compte/ui.js';

function showLogin() {
  show([
    card(
      'Administration',
      loginForm(() => start())
    )
  ]);
}

function showRefused(account) {
  show([
    accountBar(account, showLogin),
    card(
      'Administration',
      el('p', {}, "Cette page est réservée à l'administrateur. "),
      el('a', { className: 'btn', href: '/prof' }, 'Ouvrir mon espace enseignant')
    )
  ]);
}

/** Exécute une action du tableau de bord. Une session expirée ramène à la connexion. */
async function run(error, action) {
  error.hidden = true;
  try {
    await action();
  } catch (e) {
    if (e.status === 401) showLogin();
    else showError(error, e);
  }
}

/** Sur un téléphone, le tableau devient une liste : chaque valeur y porte son libellé. */
const cell = (label, value) => el('td', { 'data-label': label }, value);

const DELETE_WORD = 'SUPPRIMER';

/**
 * Fenêtre de suppression : le bouton reste bloqué tant que le mot n'est pas recopié. La casse est ignorée,
 * car un téléphone met souvent une minuscule. La fenêtre vit dans la page : revenir à la connexion la ferme.
 */
function askToDelete(teacher, onDeleted) {
  const error = errorLine();
  const input = el('input', { id: 'mot-de-suppression', className: 'text-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false });
  const confirmButton = el('button', { className: 'btn danger', type: 'submit', disabled: true }, 'Supprimer définitivement');
  const cancel = el('button', { className: 'btn ghost', type: 'button' }, 'Annuler');
  const typedWord = () => input.value.trim().toUpperCase();
  const form = el(
    'form',
    { className: 'dlg' },
    el('div', { className: 'dlg-head' }, el('h2', { id: 'titre-suppression' }, 'Supprimer ce compte ?')),
    el(
      'div',
      { className: 'dlg-body' },
      el('p', {}, 'Compte : ', el('strong', {}, teacher.email)),
      el('p', {}, 'Le compte et tous ses cours seront supprimés définitivement, avec leur historique et les résultats des élèves.'),
      el('div', { className: 'field' }, el('label', { htmlFor: input.id }, `Pour confirmer, recopiez le mot ${DELETE_WORD}`), input),
      error
    ),
    el('div', { className: 'dlg-foot' }, cancel, confirmButton)
  );
  const dialog = el('dialog', { className: 'confirm-dialog', 'aria-labelledby': 'titre-suppression' }, form);

  input.addEventListener('input', () => {
    confirmButton.disabled = typedWord() !== DELETE_WORD;
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    confirmButton.disabled = true;
    run(error, async () => {
      try {
        await api('POST', `/admin/teachers/${teacher.id}/delete`, { word: typedWord() });
      } finally {
        confirmButton.disabled = false;
      }
      dialog.close();
      await onDeleted();
    });
  });

  document.querySelector('#app').append(dialog);
  dialog.showModal();
}

function teacherRow(teacher, { error, links, notice, refresh }) {
  const reset = el('button', { className: 'btn ghost sm', type: 'button', hidden: teacher.disabled }, 'Réinitialiser le mot de passe');
  reset.addEventListener('click', () =>
    run(error, async () => {
      const created = await api('POST', `/admin/teachers/${teacher.id}/reset`, {});
      links.replaceChildren(linkBox(`Lien de réinitialisation pour ${teacher.email}`, created));
    })
  );

  const toggle = el('button', { className: teacher.disabled ? 'btn soft sm' : 'btn danger sm', type: 'button' }, teacher.disabled ? 'Réactiver' : 'Désactiver');
  toggle.addEventListener('click', () => {
    if (!teacher.disabled && !confirm(`Désactiver le compte ${teacher.email} ?\n\nCette personne ne pourra plus se connecter. Ses cours sont conservés.`))
      return;
    run(error, async () => {
      await api('POST', `/admin/teachers/${teacher.id}/${teacher.disabled ? 'enable' : 'disable'}`, {});
      await refresh();
    });
  });

  const remove = el('button', { className: 'btn danger sm', type: 'button', hidden: !teacher.disabled }, 'Supprimer le compte et ses cours');
  remove.addEventListener('click', () =>
    askToDelete(teacher, async () => {
      links.replaceChildren();
      notice.textContent = `Le compte ${teacher.email} et ses cours ont été supprimés.`;
      notice.hidden = false;
      await refresh();
    })
  );

  return el(
    'tr',
    {},
    cell('Adresse e-mail', teacher.email),
    cell('État', teacher.disabled ? 'Désactivé' : 'Actif'),
    cell('Compte créé', dateAndTime(teacher.createdAt)),
    cell('Dernière connexion', teacher.lastLoginAt ? dateAndTime(teacher.lastLoginAt) : 'Jamais'),
    el('td', {}, el('div', { className: 'row-actions' }, reset, toggle, remove))
  );
}

function teachersCard() {
  const error = errorLine();
  const notice = el('p', { className: 'form-ok', role: 'status', hidden: true });
  const links = el('div', {});
  const body = el('tbody', {});
  const empty = el('div', { className: 'empty-box', hidden: true }, 'Aucun enseignant pour le moment.');
  const table = el(
    'table',
    { className: 'results teachers' },
    el('thead', {}, el('tr', {}, ...['Adresse e-mail', 'État', 'Compte créé', 'Dernière connexion', ''].map((title) => el('th', {}, title)))),
    body
  );

  async function refresh() {
    const teachers = await api('GET', '/admin/teachers');
    body.replaceChildren(...teachers.map((teacher) => teacherRow(teacher, { error, links, notice, refresh })));
    table.hidden = !teachers.length;
    empty.hidden = teachers.length > 0;
  }
  run(error, refresh);
  return card('Enseignants', error, notice, el('div', { className: 'table-wrap' }, table), empty, links);
}

function inviteCard() {
  const error = errorLine();
  const links = el('div', {});
  const invite = el('button', { className: 'btn', type: 'button' }, 'Créer un lien de création de compte');
  invite.addEventListener('click', () =>
    run(error, async () => {
      links.replaceChildren(linkBox('Lien de création de compte', await api('POST', '/admin/invites', {})));
    })
  );
  return card('Inviter un enseignant', error, invite, links);
}

function showDashboard(account) {
  show([accountBar(account, showLogin), inviteCard(), teachersCard(), card('Mon mot de passe', changePasswordForm())], { wide: true });
}

async function start() {
  try {
    const account = await currentAccount();
    if (!account) showLogin();
    else if (account.role === 'admin') showDashboard(account);
    else showRefused(account);
  } catch (e) {
    const error = errorLine();
    showError(error, e);
    show([card('Administration', error)]);
  }
}

start();
