/**
 * Le journal des problèmes, dans le tableau de bord de l'admin (INC-01) : ce que les navigateurs ont signalé, et sur quelle machine.
 * Tout passe par el(), qui n'interprète rien : ces textes viennent de n'importe quel navigateur.
 */
import { api } from '../api.js';
import { card, dateAndTime, el, errorLine, showError } from '../compte/ui.js';
import { formatSize } from '../util.js';

const BROWSERS = [
  [/Edg\w*\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari/, 'Safari']
];
// Android avant Linux, et iOS avant macOS : leurs navigateurs citent aussi le second
const SYSTEMS = [
  [/Windows NT/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux']
];

function browserName(agent = '') {
  const browser = BROWSERS.map(([pattern, name]) => [agent.match(pattern), name]).find(([match]) => match);
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  const label = browser ? `${browser[1]} ${browser[0][1]}` : 'Navigateur inconnu';
  return system ? `${label} sur ${system}` : label;
}

const diskSize = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : formatSize(bytes));

/** Ce qu'il faut lire d'un coup d'œil. Le texte complet reste dans « Tout voir ». */
function machineSummary(machine) {
  const parts = [browserName(machine.browser)];
  if (machine.cores) parts.push(`${machine.cores} cœurs`);
  // Chrome ne dit jamais plus que 8
  if (machine.memoryGb) parts.push(machine.memoryGb >= 8 ? '8 Go de mémoire ou plus' : `${machine.memoryGb} Go de mémoire`);
  if (machine.storageQuota) parts.push(`place pour ce site : ${diskSize(machine.storageUsed ?? 0)} utilisés sur ${diskSize(machine.storageQuota)}`);
  if (machine.screen) parts.push(`écran ${machine.screen}`);
  if (machine.online !== undefined) parts.push(machine.online ? 'en ligne' : 'hors ligne');
  return parts.join(' · ');
}

function incidentRow(incident) {
  const who = incident.account ?? 'sans compte';
  const seen = incident.count > 1 ? ` · ${incident.count} fois, depuis le ${dateAndTime(incident.firstAt)}` : '';
  const full = [`Navigateur : ${incident.machine.browser ?? '?'}`, `Détail de la machine : ${JSON.stringify(incident.machine)}`, incident.details]
    .filter(Boolean)
    .join('\n\n');
  return el(
    'li',
    { className: 'incident' },
    el('p', { className: 'incident-when' }, `${dateAndTime(incident.lastAt)}${seen} · ${who} · ${incident.page}`),
    el('p', { className: 'incident-what' }, el('b', {}, `${incident.action} : `), incident.reason),
    el('p', { className: 'hint' }, machineSummary(incident.machine)),
    el('details', {}, el('summary', {}, 'Tout voir'), el('pre', { className: 'incident-full' }, full))
  );
}

export function incidentsCard() {
  const error = errorLine();
  const list = el('ul', { className: 'incidents' });
  const empty = el('div', { className: 'empty-box', hidden: true }, 'Aucun problème signalé.');
  const clear = el('button', { className: 'btn ghost sm', type: 'button', hidden: true }, 'Tout effacer');

  async function refresh() {
    error.hidden = true;
    try {
      const incidents = await api('GET', '/admin/incidents');
      list.replaceChildren(...incidents.map(incidentRow));
      empty.hidden = incidents.length > 0;
      clear.hidden = !incidents.length;
    } catch (e) {
      showError(error, e);
    }
  }
  clear.addEventListener('click', async () => {
    if (!confirm('Effacer tout le journal ?')) return;
    try {
      await api('POST', '/admin/incidents/clear', {});
      await refresh();
    } catch (e) {
      showError(error, e);
    }
  });
  refresh();
  return card(
    'Journal des problèmes',
    el('p', { className: 'hint' }, 'Ce que les navigateurs ont signalé. Gardé 90 jours. Jamais de nom d’élève, de réponse ni de contenu de cours.'),
    error,
    list,
    empty,
    clear
  );
}
