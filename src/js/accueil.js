/**
 * Page d'accueil : taper le code d'un cours, ou aller vers l'espace enseignant. Le QR code, lui, mène directement à /c/<code>.
 */
import { api } from './api.js';
import { card, el, field, onSubmit, show } from './compte/ui.js';

const clean = (typed) => typed.toUpperCase().replace(/[\s-]/g, '');

const form = onSubmit(
  el(
    'form',
    {},
    field('Code du cours', {
      name: 'code',
      className: 'text-input code-input',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: false,
      required: true
    }),
    el('button', { className: 'btn block', type: 'submit' }, 'Rejoindre le cours')
  ),
  async (data) => {
    const code = encodeURIComponent(clean(data.get('code')));
    // Une erreur s'affiche ici, sur place, plutôt qu'après avoir changé de page et saisi son nom
    await api('GET', `/join/${code}`);
    location.href = `/c/${code}`;
  }
);

show([
  el('h1', { className: 'home-title' }, 'Cartopoint'),
  card('Rejoindre un cours', form),
  el('p', { className: 'hint home-link' }, 'Vous enseignez ? ', el('a', { href: '/prof' }, 'Espace enseignant'))
]);
