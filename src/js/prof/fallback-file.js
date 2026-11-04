/**
 * Le fichier de secours d'un cours (EXP-01) : un seul fichier .html, qui marche sans serveur ni réseau, si le site est en panne un jour de sortie. Il part de
 * /secours.html, construit avec le site, et y écrit le cours : photos comprises, sans les fiches masquées. Il contient les positions réelles : sans serveur, c'est la
 * page qui corrige (EXP-02). Son mot de passe de gestion est choisi ici, pour ne plus laisser celui par défaut (E-03).
 */
import { hashPassword } from '../auth.js';
import { el, errorLine } from '../compte/ui.js';
import { exportCourse } from './course-io.js';

const MIN_PASSWORD = 4;

/** Le cours, tel qu'il partirait chez les élèves, dans la page de secours. */
export async function fallbackPage(project, password) {
  const response = await fetch('/secours.html', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`fichier de secours indisponible sur ce serveur (${response.status})`);
  const template = await response.text();
  const course = await exportCourse({ ...project, maps: project.maps.map((map) => ({ ...map, fiches: map.fiches.filter((fiche) => fiche.visible) })) });
  // « < » est échappé : un titre contenant </script> ne doit pas fermer la balise
  const json = JSON.stringify({ ...course, passwordHash: await hashPassword(password) }).replace(/</g, '\\u003c');
  return template.replace(/(<script id="embedded-project" type="application\/json">)[\s\S]*?(<\/script>)/, (_, open, close) => open + json + close);
}

/** Demande le mot de passe : répond null si l'enseignant renonce. Pas de prompt() : il afficherait le mot de passe en clair. */
export function askFallbackPassword() {
  return new Promise((resolve) => {
    const input = el('input', { id: 'fallbackPassword', className: 'text-input', type: 'password', autocomplete: 'new-password' });
    const error = errorLine();
    const cancel = el('button', { className: 'btn ghost', type: 'button' }, 'Annuler');
    const form = el(
      'form',
      { className: 'dlg' },
      el('div', { className: 'dlg-head' }, el('h2', {}, 'Fichier de secours')),
      el(
        'div',
        { className: 'dlg-body' },
        el('p', {}, 'Ce mot de passe protège le mode gestion du fichier. Le site ne le garde pas : notez-le.'),
        el('div', { className: 'field' }, el('label', { htmlFor: 'fallbackPassword' }, `Mot de passe de gestion (${MIN_PASSWORD} caractères au moins)`), input),
        error
      ),
      el('div', { className: 'dlg-foot' }, cancel, el('button', { className: 'btn', type: 'submit' }, 'Télécharger'))
    );
    const dialog = el('dialog', { 'aria-label': 'Fichier de secours' }, form);
    const done = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => done(null));
    dialog.addEventListener('cancel', () => done(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (input.value.length >= MIN_PASSWORD) return done(input.value);
      error.textContent = `${MIN_PASSWORD} caractères au moins.`;
      error.hidden = false;
      input.focus();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
