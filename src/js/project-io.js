/**
 * Entrées / sorties du projet :
 *  - choix du projet au démarrage (navigateur, fichier autonome, serveur) ;
 *  - enregistrement en fichier autonome (.html) ou en données (.json) ;
 *  - version élèves ; ouverture d'un fichier ; nouveau projet ;
 *  - publication sur le serveur (si configurée, voir server/server.mjs).
 *
 * Format d'un fichier de projet : voir docs/ARCHITECTURE.md.
 */
import { $, esc, toast, download, safeFileName, blobToDataURL, prefs } from './util.js';
import { S, installProject, activate, exportProject, markExported, loadLocal } from './store.js';
import { normalizeProject, newProject, projectFromText, DEFAULT_TITLE } from './model.js';
import { readLegacyProject } from './db.js';
import { render } from './render.js';

/* ------------------------------------------------------------------ */
/* Modèle de page autonome                                              */
/* ------------------------------------------------------------------ */

let template = null;

/**
 * Mémorise la page telle qu'elle a été chargée. Si elle est « autonome » (CSS et JS
 * intégrés, ce que produit `npm run build`), on peut s'en servir pour générer des
 * fichiers .html contenant l'application et un projet.
 * À appeler avant toute modification du DOM.
 */
export function captureTemplate() {
  const standalone = !document.querySelector('script[type="module"][src], link[rel="stylesheet"][href^="css/"]');
  if (standalone) template = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}
export const canBuildStandalone = () => !!template;

function pageWithProject(bundle) {
  const json = JSON.stringify(bundle).replace(/</g, '\\u003c');
  return template.replace(/(<script id="embedded-project" type="application\/json">)[\s\S]*?(<\/script>)/, (_, a, b) => a + json + b);
}

/** Projet intégré dans la page (fichier autonome enregistré depuis l'application), ou null. */
function embeddedProject() {
  try {
    return JSON.parse($('#embedded-project')?.textContent || 'null');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Démarrage : quel projet afficher ?                                   */
/* ------------------------------------------------------------------ */

/** Image du plan d'exemple, en URL data: (pour un nouveau projet). */
export async function defaultMapImage() {
  const url = document.querySelector('meta[name="default-map"]')?.content;
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  try {
    return await blobToDataURL(await (await fetch(url)).blob());
  } catch {
    return '';
  }
}

/**
 * Configuration d'hébergement (facultative), lue dans `config.json` à côté de la page :
 *   { "projectUrl": "project.json", "publishUrl": "api/project" }
 * L'adresse `…/?projet=nom` charge `projets/nom.json` (et publie vers `publishUrl?projet=nom`).
 */
async function readConfig() {
  const cfg = { projectUrl: null, publishUrl: null, projectName: null };
  if (!location.protocol.startsWith('http')) return cfg;
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (r.ok) Object.assign(cfg, await r.json());
  } catch {
    /* pas de config : valeurs par défaut */
  }
  cfg.projectUrl ??= 'project.json';
  const name = new URLSearchParams(location.search).get('projet');
  if (name && /^[a-z0-9][a-z0-9-]{0,60}$/i.test(name)) {
    cfg.projectName = name;
    cfg.projectUrl = `projets/${name}.json`;
  }
  return cfg;
}

async function fetchRemote(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Choisit et active le projet au démarrage.
 * Ordre de priorité : serveur (si hébergé) › projet intégré au fichier › projet du navigateur
 * › données d'une ancienne version › nouveau projet vide.
 * Le travail des élèves (progression) n'est jamais écrasé par une nouvelle version du projet.
 */
export async function resolveStartupProject() {
  const image = await defaultMapImage();
  const cfg = await readConfig();
  S.source.publishUrl = cfg.publishUrl ? cfg.publishUrl + (cfg.projectName ? `?projet=${cfg.projectName}` : '') : null;

  const local = S.storageOk ? await loadLocal().catch(() => null) : null;
  let incoming = null;
  const remote = cfg.projectUrl ? await fetchRemote(cfg.projectUrl) : null;
  if (remote) {
    incoming = normalizeProject(remote, image);
    Object.assign(S.source, { kind: 'remote', url: cfg.projectUrl, remoteRevision: incoming.revision });
  } else if (embeddedProject()) {
    incoming = normalizeProject(embeddedProject(), image);
    S.source.kind = 'embedded';
  }

  if (incoming) {
    if (!local) return installProject(incoming, { progress: 'replace' });
    if (local.project.id === incoming.id) {
      const newer = incoming.savedAt > local.project.savedAt && incoming.revision !== local.project.revision;
      if (newer && !local.local.dirty) return installProject(incoming, { progress: 'seed' });
      return activate(local.project, local.progress, local.local);
    }
    // Projet différent de celui du navigateur.
    const askKey = 'ib.declined.' + incoming.revision;
    if (local.local.dirty && prefs.get(askKey)) return activate(local.project, local.progress, local.local);
    if (
      !local.local.dirty ||
      confirm(
        `Ouvrir le projet « ${incoming.title} » ?\n\nLe projet « ${local.project.title} » de ce navigateur a des modifications qui ne sont pas enregistrées dans un fichier : elles seront remplacées.`
      )
    ) {
      return installProject(incoming, { progress: 'seed' });
    }
    prefs.set(askKey, '1');
    S.source.kind = 'local';
    return activate(local.project, local.progress, local.local);
  }

  if (local) return activate(local.project, local.progress, local.local);
  if (S.storageOk) {
    const legacy = await readLegacyProject(prefs).catch(() => null);
    if (legacy) {
      await installProject(normalizeProject(legacy, image), { progress: 'replace', dirty: true });
      toast('Fiches de la version précédente récupérées');
      return;
    }
  }
  return installProject(newProject(DEFAULT_TITLE, image), { progress: 'replace' });
}

/* ------------------------------------------------------------------ */
/* Enregistrer / ouvrir                                                 */
/* ------------------------------------------------------------------ */

/** Fichier autonome (.html, application + projet) ou données seules (.json). */
export async function saveProject(kind = 'html', fixedName = null) {
  const name = fixedName ?? prompt('Nom du fichier :', S.project.title);
  if (name === null) return;
  toast('Préparation du fichier…');
  try {
    const bundle = await exportProject();
    const base = safeFileName(name) || 'Inventaire botanique';
    if (kind === 'html') download(pageWithProject(bundle), base + '.html', 'text/html;charset=utf-8');
    else download(JSON.stringify(bundle), base + '.json', 'application/json');
    S.project.savedAt = bundle.savedAt;
    await markExported(bundle.revision);
    render();
    toast('✓ Projet enregistré');
  } catch (e) {
    toast('⚠ Enregistrement impossible : ' + e.message);
  }
}

/** Version élèves : sans les fiches masquées ni les réglages enseignant. */
export async function exportStudentVersion({ clearPositions = true, clearMeasures = false } = {}) {
  const kind = canBuildStandalone() ? 'html' : 'json';
  const name = prompt('Nom du fichier pour les élèves :', S.project.title + ' - élèves');
  if (name === null) return;
  toast('Préparation de la version élèves…');
  try {
    const bundle = await exportProject({ studentsOnly: true, keepPositions: !clearPositions, keepMeasures: !clearMeasures });
    const base = safeFileName(name) || 'Inventaire élèves';
    if (kind === 'html') download(pageWithProject(bundle), base + '.html', 'text/html;charset=utf-8');
    else download(JSON.stringify(bundle), base + '.json', 'application/json');
    toast('✓ Version élèves téléchargée');
  } catch (e) {
    toast('⚠ Export impossible : ' + e.message);
  }
}

const unsavedWarning = () =>
  S.local.dirty ? '\n\n⚠ Le projet en cours a des modifications qui ne sont pas enregistrées dans un fichier : elles seront perdues.' : '';

export async function openProjectFile(file) {
  let project;
  try {
    project = normalizeProject(projectFromText(await file.text()), await defaultMapImage());
  } catch (e) {
    return toast('⚠ Ouverture impossible : ' + e.message);
  }
  const nf = project.maps.reduce((s, m) => s + m.fiches.length, 0);
  if (!confirm(`Ouvrir le projet « ${project.title} » (${project.maps.length} carte(s), ${nf} fiche(s)) ?${unsavedWarning()}`)) return;
  try {
    await installProject(project, { progress: 'replace' });
    S.source.kind = 'local';
    render();
    toast('✓ Projet ouvert');
  } catch (e) {
    toast('⚠ Ouverture impossible : ' + e.message);
  }
}

export async function startNewProject() {
  if (!confirm('Commencer un nouveau projet vide ? Les cartes et fiches affichées seront retirées de ce navigateur.' + unsavedWarning())) return;
  const name = prompt('Nom du nouveau projet :', DEFAULT_TITLE);
  if (name === null) return;
  const project = newProject(name.trim() || DEFAULT_TITLE, await defaultMapImage());
  project.theme = { ...S.project.theme };
  project.passwordHash = S.project.passwordHash;
  await installProject(project, { progress: 'replace', dirty: true });
  S.source.kind = 'local';
  prefs.del('ib.studentNames');
  $('#studentNames').value = '';
  S.ui.tab = 'cartes';
  render();
  toast("Nouveau projet : remplacez l'image du plan avec « Changer l'image »");
}

/* ------------------------------------------------------------------ */
/* Publication sur le serveur                                           */
/* ------------------------------------------------------------------ */

/** Petite fenêtre de mot de passe (le prompt() du navigateur afficherait le texte en clair). */
function askPassword(message) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<form class="dlg"><div class="dlg-head"><h2>Publier en ligne</h2></div>
      <div class="dlg-body"><div class="field"><label for="pubPw">${esc(message)}</label><input id="pubPw" type="password" autocomplete="current-password"></div></div>
      <div class="dlg-foot"><button class="btn ghost" type="button" value="">Annuler</button><button class="btn" type="submit">Publier</button></div></form>`;
    document.body.appendChild(dlg);
    const done = (v) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.querySelector('button[type=button]').onclick = () => done(null);
    dlg.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      done(dlg.querySelector('input').value);
    };
    dlg.addEventListener('cancel', () => done(null));
    dlg.showModal();
  });
}

export async function publish() {
  if (!S.source.publishUrl) return;
  let password = sessionStorage.getItem('ib.publishPw');
  if (!password) {
    password = await askPassword('Mot de passe de publication (fourni par la personne qui héberge le site)');
    if (!password) return;
  }
  toast('Publication…');
  try {
    const bundle = await exportProject({ withProgress: false });
    const r = await fetch(S.source.publishUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + password },
      body: JSON.stringify(bundle)
    });
    if (r.status === 401 || r.status === 403) {
      sessionStorage.removeItem('ib.publishPw');
      return toast('⚠ Mot de passe de publication refusé');
    }
    if (!r.ok) throw new Error('le serveur a répondu ' + r.status);
    sessionStorage.setItem('ib.publishPw', password);
    S.project.savedAt = bundle.savedAt;
    S.source.remoteRevision = bundle.revision;
    await markExported(bundle.revision);
    render();
    toast('✓ Publié : les élèves verront cette version en rechargeant la page');
  } catch (e) {
    toast('⚠ Publication impossible : ' + e.message);
  }
}

/** Recharge la version publiée sur le serveur (abandonne les modifications locales). */
async function reloadRemote() {
  if (!confirm('Remplacer les modifications de ce navigateur par la version publiée sur le serveur ?')) return;
  const remote = await fetchRemote(S.source.url);
  if (!remote) return toast('⚠ Version en ligne introuvable');
  await installProject(normalizeProject(remote, await defaultMapImage()), { progress: 'keep' });
  S.source.remoteRevision = S.project.revision;
  render();
  toast('✓ Version en ligne rechargée');
}

/** Bandeau affiché en gestion quand des modifications locales ne sont pas en ligne. */
export function draftBannerHTML() {
  if (S.source.kind !== 'remote' || !S.local.dirty) return '';
  const stale = S.source.remoteRevision && S.local.baseRevision && S.source.remoteRevision !== S.local.baseRevision;
  return `<span>✎ Vos modifications sont enregistrées dans ce navigateur seulement : les élèves voient la version publiée.${stale ? ' ⚠ Une autre version a été publiée depuis.' : ''}</span>
    ${S.source.publishUrl ? '<button type="button" class="btn sm" data-publish>Publier</button>' : '<button type="button" class="btn sm" data-dl-json>Télécharger project.json</button>'}
    <button type="button" class="btn ghost sm" data-reload-remote>Reprendre la version en ligne</button>`;
}

export function bindDraftBanner(root) {
  root.querySelector('[data-publish]')?.addEventListener('click', publish);
  root.querySelector('[data-dl-json]')?.addEventListener('click', () => saveProject('json', 'project'));
  root.querySelector('[data-reload-remote]')?.addEventListener('click', reloadRemote);
}
