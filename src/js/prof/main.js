/**
 * Espace enseignant : connexion, puis ses cours. Un cours s'ouvre dans sa propre page (prof/course.js).
 */
import { api, currentAccount } from '../api.js';
import { accountBar, card, changePasswordForm, dateAndTime, el, errorLine, field, loginForm, show, showError } from '../compte/ui.js';
import { DEFAULT_TITLE, draftOf, newProject } from '../model.js';
import { importProject } from './course-io.js';

const courseUrl = (course) => `/prof/cours/${encodeURIComponent(course.id)}`;

function showLogin() {
  show([
    card(
      'Espace enseignant',
      loginForm(() => start()),
      el('p', { className: 'hint' }, "Pas encore de compte ? Demandez un lien de création à l'administrateur.")
    )
  ]);
}

/** Exécute une action. Une session expirée ramène à la connexion. */
async function run(error, action) {
  error.hidden = true;
  try {
    await action();
  } catch (e) {
    if (e.status === 401) showLogin();
    else showError(error, e);
  }
}

function publicationText(course) {
  if (!course.published) return 'Pas encore publié';
  return course.modified ? `Version ${course.published.number} publiée, modifications en attente` : `Version ${course.published.number} publiée`;
}

function courseRow(course, { error, refresh }) {
  const rename = el('button', { className: 'btn ghost sm', type: 'button' }, 'Renommer');
  rename.addEventListener('click', () => {
    const title = prompt('Nom du cours :', course.title)?.trim();
    if (!title) return;
    run(error, async () => {
      const { draft, revision } = await api('GET', `/courses/${course.id}`);
      await api('PUT', `/courses/${course.id}`, { revision, draft: { ...draft, title } });
      await refresh();
    });
  });

  const remove = el('button', { className: 'btn danger sm', type: 'button' }, 'Supprimer');
  remove.addEventListener('click', () => {
    if (
      !confirm(`Supprimer le cours « ${course.title} » ?\n\nSes fiches, ses versions publiées et l'historique de ses lancements seront effacés définitivement.`)
    )
      return;
    run(error, async () => {
      await api('DELETE', `/courses/${course.id}`);
      await refresh();
    });
  });

  return el(
    'li',
    { className: 'course-row' },
    el(
      'div',
      { className: 'course-info' },
      el('a', { className: 'course-title', href: courseUrl(course) }, course.title),
      el('p', { className: 'hint' }, `${course.fiches} fiche(s) · ${publicationText(course)} · modifié le ${dateAndTime(course.updatedAt)}`)
    ),
    el('div', { className: 'row-actions' }, el('a', { className: 'btn soft sm', href: courseUrl(course) }, 'Ouvrir'), rename, remove)
  );
}

function coursesCard() {
  const error = errorLine();
  const list = el('ul', { className: 'course-list' });
  const empty = el('div', { className: 'empty-box', hidden: true }, 'Aucun cours pour le moment. Créez-en un, ou importez un projet existant.');

  async function refresh() {
    const courses = await api('GET', '/courses');
    list.replaceChildren(...courses.map((course) => courseRow(course, { error, refresh })));
    empty.hidden = courses.length > 0;
  }
  run(error, refresh);

  const create = el(
    'form',
    { className: 'course-create' },
    field('Nom du nouveau cours', { name: 'title', className: 'text-input', autocomplete: 'off' }),
    el('button', { className: 'btn', type: 'submit' }, 'Créer le cours')
  );
  create.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = new FormData(create).get('title').trim() || DEFAULT_TITLE;
    run(error, async () => {
      const course = await api('POST', '/courses', { draft: draftOf(newProject(title)) });
      location.assign(courseUrl(course));
    });
  });

  const status = el('p', { className: 'hint', role: 'status' });
  const input = el('input', { type: 'file', accept: '.json,.html,.htm' });
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    run(error, async () => {
      status.textContent = `Lecture de ${file.name}…`;
      try {
        const { failed } = await importProject(file, (done, total) => (status.textContent = `Envoi des fichiers : ${done} / ${total}`));
        status.textContent = failed
          ? `Projet importé. ${failed} fichier(s) n'ont pas pu être envoyés : vérifiez les photos et les plans.`
          : `Projet « ${file.name} » importé.`;
        await refresh();
      } catch (e) {
        status.textContent = '';
        throw e;
      }
    });
  });
  const importButton = el('label', { className: 'btn ghost file-btn' }, 'Importer un projet (.json ou .html)', input);

  return card('Mes cours', error, list, empty, create, el('div', { className: 'course-import' }, importButton, status));
}

function showSpace(account) {
  show([accountBar(account, showLogin), coursesCard(), card('Mon mot de passe', changePasswordForm())], { wide: true });
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
