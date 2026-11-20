/**
 * Espace enseignant : connexion, puis ses cours. Un cours s'ouvre dans sa propre page (prof/course.js).
 */
import { api, currentAccount } from '../api.js';
import { accountBar, actionRunner, card, changePasswordForm, dateAndTime, el, errorLine, field, loginForm, show, showError } from '../compte/ui.js';
import { DEFAULT_TITLE, draftOf, newProject, starterTemplate } from '../model.js';
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

const run = actionRunner(showLogin);

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

  // Une copie complète, fiches masquées comprises (Q-P), sans versions ni lancements : les fichiers restent partagés (SRV-15)
  const duplicate = el('button', { className: 'btn ghost sm', type: 'button' }, 'Dupliquer');
  const COPY = ' - copie';
  duplicate.addEventListener('click', () =>
    run(error, async () => {
      const { draft } = await api('GET', `/courses/${course.id}`);
      // « Sortie au parc - copie » : le nom d'origine d'abord, pour que la copie se range à côté de lui (MOD-08)
      await api('POST', '/courses', { draft: { ...draft, title: `${course.title.slice(0, 200 - COPY.length)}${COPY}` } });
      await refresh();
    })
  );

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
    el(
      'div',
      { className: 'row-actions' },
      ...(course.runningLaunch
        ? [el('a', { className: 'btn sm', href: `/prof/lancements/${encodeURIComponent(course.runningLaunch)}` }, 'Suivre le cours')]
        : []),
      el('a', { className: 'btn soft sm', href: courseUrl(course) }, 'Ouvrir'),
      rename,
      duplicate,
      remove
    )
  );
}

function coursesCard() {
  const error = errorLine();
  const list = el('ul', { className: 'course-list' });
  const empty = el('div', { className: 'empty-box', hidden: true }, 'Aucun cours pour le moment. Créez-en un, ou importez un projet existant.');

  let courses = [];
  async function refresh() {
    courses = await api('GET', '/courses');
    list.replaceChildren(...courses.map((course) => courseRow(course, { error, refresh })));
    empty.hidden = courses.length > 0;
  }
  run(error, refresh);

  /**
   * Un nouveau cours (MOD-07) : un titre, et une fiche sans matière, un titre et une description. Il s'ouvre sur l'onglet
   * « Fiches » ; l'éditeur de fiches propose ensuite de compléter cette fiche, ou de reprendre celle d'un autre cours.
   */
  const create = el(
    'form',
    { className: 'course-create' },
    field('Nom du nouveau cours', { name: 'title', className: 'text-input', autocomplete: 'off' }),
    el('div', { className: 'inline' }, el('button', { className: 'btn', type: 'submit' }, 'Créer un nouveau cours'))
  );
  create.addEventListener('submit', (event) => {
    event.preventDefault();
    run(error, async () => {
      const title = new FormData(create).get('title').trim() || DEFAULT_TITLE;
      const course = await api('POST', '/courses', { draft: draftOf(newProject(title, '', starterTemplate())) });
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
