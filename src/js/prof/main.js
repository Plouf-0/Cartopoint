/**
 * Espace enseignant : connexion, puis ses cours. Un cours s'ouvre dans sa propre page (prof/course.js).
 */
import { api, currentAccount } from '../api.js';
import { accountBar, actionRunner, card, changePasswordForm, dateAndTime, el, errorLine, field, loginForm, show, showError } from '../compte/ui.js';
import { DEFAULT_TITLE, draftOf, newProject, normalizeProject, projectFromText, starterTemplate, templateFrom } from '../model.js';
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
  duplicate.addEventListener('click', () =>
    run(error, async () => {
      const { draft } = await api('GET', `/courses/${course.id}`);
      await api('POST', '/courses', { draft: { ...draft, title: `Copie de ${course.title}`.slice(0, 200) } });
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

  const reuse = reuseControls();
  /**
   * Un nouveau cours (4.2) : son modèle de fiche part de zéro, ou reprend celui d'un de ses cours ou d'un fichier de cours.
   * Il s'ouvre ensuite sur l'onglet « Modèle de fiche », pour compléter ou adapter la fiche.
   */
  const create = el(
    'form',
    { className: 'course-create' },
    field('Nom du nouveau cours', { name: 'title', className: 'text-input', autocomplete: 'off' }),
    el('div', { className: 'inline' }, el('button', { className: 'btn', type: 'submit' }, 'Créer le modèle de fiche'), reuse.toggle),
    reuse.chooser
  );
  const titleOfNew = () => new FormData(create).get('title').trim() || DEFAULT_TITLE;
  async function createWith(template) {
    const course = await api('POST', '/courses', { draft: draftOf(newProject(titleOfNew(), '', template)) });
    location.assign(courseUrl(course) + '#modele');
  }
  create.addEventListener('submit', (event) => {
    event.preventDefault();
    run(error, () => createWith(starterTemplate()));
  });

  /** « Reprendre la fiche d'un autre cours » : la liste de ses cours, ou un fichier de cours d'un collègue (Q-C). */
  function reuseControls() {
    const chooser = el('div', { className: 'reuse-chooser', hidden: true });
    const toggle = el('button', { className: 'btn soft', type: 'button', 'aria-expanded': 'false' }, 'Reprendre la fiche d’un autre cours');
    toggle.addEventListener('click', () => {
      chooser.hidden = !chooser.hidden;
      toggle.setAttribute('aria-expanded', String(!chooser.hidden));
      const file = el('input', { type: 'file', accept: '.json,.html,.htm' });
      file.addEventListener('change', () => {
        const chosen = file.files[0];
        file.value = '';
        if (!chosen) return;
        run(error, async () => createWith(templateFrom(normalizeProject(projectFromText(await chosen.text())))));
      });
      chooser.replaceChildren(
        el('p', { className: 'hint' }, 'Sa fiche est copiée dans le nouveau cours, sans ses fiches : vous pourrez l’adapter sans toucher à l’autre cours.'),
        ...courses.map((other) => {
          const take = el('button', { className: 'btn ghost sm', type: 'button' }, `Fiche de « ${other.title} »`);
          take.addEventListener('click', () =>
            run(error, async () => {
              const { draft } = await api('GET', `/courses/${other.id}`);
              await createWith(templateFrom(normalizeProject(draft), other.id));
            })
          );
          return take;
        }),
        el('label', { className: 'btn ghost sm file-btn' }, 'D’un fichier de cours (.json)…', file)
      );
    });
    return { toggle, chooser };
  }

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
