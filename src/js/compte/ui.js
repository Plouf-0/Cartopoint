/**
 * Écrans de compte, communs aux espaces enseignant et admin. Tout texte passe par des nœuds de texte,
 * jamais par innerHTML : une adresse e-mail ne peut donc pas injecter de code (SEC-04).
 */
import { api } from '../api.js';

/** Crée un élément. Une propriété inconnue du navigateur devient un attribut. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export function field(label, props) {
  const id = 'champ-' + props.name;
  return el('div', { className: 'field' }, el('label', { htmlFor: id }, label), el('input', { id, ...props }));
}

/** Affiche `children` dans la page. `wide` pour un tableau de bord. */
export function show(children, { wide = false } = {}) {
  const root = document.querySelector('#app');
  root.className = wide ? 'account-page wide' : 'account-page';
  root.replaceChildren(...children);
}

export const card = (title, ...children) => el('section', { className: 'account-card' }, el('h2', {}, title), ...children);

export function errorLine() {
  return el('p', { className: 'form-error', role: 'alert', hidden: true });
}

export function showError(line, error) {
  line.textContent = error.message;
  line.hidden = false;
}

/** Branche un formulaire : le bouton est bloqué pendant l'envoi et une erreur s'affiche au-dessus de lui. */
export function onSubmit(form, action) {
  const error = errorLine();
  const button = form.querySelector('[type=submit]');
  button.before(error);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    button.disabled = true;
    try {
      await action(new FormData(form));
    } catch (e) {
      showError(error, e);
    } finally {
      button.disabled = false;
    }
  });
  return form;
}

export function loginForm(onLogin) {
  const form = el(
    'form',
    {},
    field('Adresse e-mail', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
    field('Mot de passe', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
    el('button', { className: 'btn block', type: 'submit' }, 'Se connecter')
  );
  return onSubmit(form, async (data) => onLogin(await api('POST', '/auth/login', { email: data.get('email'), password: data.get('password') })));
}

/** Les deux cases d'un nouveau mot de passe, et leur vérification. */
const newPasswordFields = () => [
  field('Nouveau mot de passe (8 caractères au moins)', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minLength: 8 }),
  field('Le même, une seconde fois', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true })
];

function checkedPassword(data) {
  if (data.get('password') !== data.get('confirm')) throw new Error('Les deux mots de passe sont différents.');
  return data.get('password');
}

/** Formulaire d'un lien à usage unique : `extra` pour les champs en plus, `send` pour l'envoi. */
export function newPasswordForm(extra, buttonLabel, send) {
  const form = el('form', {}, ...extra, ...newPasswordFields(), el('button', { className: 'btn block', type: 'submit' }, buttonLabel));
  return onSubmit(form, (data) => send(data, checkedPassword(data)));
}

export function changePasswordForm() {
  const done = el('p', { className: 'form-ok', role: 'status', hidden: true }, 'Mot de passe modifié.');
  const form = el(
    'form',
    {},
    field('Mot de passe actuel', { name: 'current', type: 'password', autocomplete: 'current-password', required: true }),
    ...newPasswordFields(),
    done,
    el('button', { className: 'btn', type: 'submit' }, 'Changer le mot de passe')
  );
  return onSubmit(form, async (data) => {
    done.hidden = true;
    await api('POST', '/auth/password', { current: data.get('current'), password: checkedPassword(data) });
    form.reset();
    done.hidden = false;
  });
}

export function accountBar(account, onLogout) {
  const logout = el('button', { className: 'btn ghost sm', type: 'button' }, 'Se déconnecter');
  logout.addEventListener('click', async () => {
    await api('POST', '/auth/logout', {});
    onLogout();
  });
  return el('div', { className: 'account-bar' }, el('span', {}, account.email), logout);
}

const dateAndTime = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
/** Pour un tableau : 2 nov. 2026. */
const shortDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'medium' });

/** Un lien à transmettre, avec son bouton de copie. Hors HTTPS, le navigateur refuse de copier : le lien est alors sélectionné. */
export function linkBox(title, { link, expiresAt }) {
  const url = location.origin + link;
  const input = el('input', { className: 'text-input', readOnly: true, value: url, 'aria-label': 'Lien à transmettre' });
  const note = el(
    'p',
    { className: 'hint' },
    `Valable jusqu'au ${dateAndTime(expiresAt)}, une seule fois. L'application n'envoie pas d'e-mail : transmettez-le vous-même.`
  );
  const copy = el('button', { className: 'btn sm', type: 'button' }, 'Copier le lien');
  copy.addEventListener('click', async () => {
    input.select();
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = 'Copié ✓';
    } catch {
      note.textContent = 'Copie automatique impossible : le lien est sélectionné, copiez-le avec Ctrl+C.';
    }
  });
  return el('div', { className: 'link-box' }, el('p', { className: 'mini-h' }, title), el('div', { className: 'inline' }, input, copy), note);
}

export { dateAndTime, shortDate };
