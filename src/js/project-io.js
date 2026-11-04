/**
 * Entrées / sorties du projet, dans le fichier de secours, qui ne connaît aucun serveur :
 *  - choix du projet au démarrage (fichier, navigateur) ;
 *  - enregistrement en fichier autonome (.html) ou en données (.json) ;
 *  - version élèves ; ouverture d'un fichier ; nouveau projet.
 *
 * Format d'un fichier de projet : voir docs/ARCHITECTURE.md.
 */
import { $, toast, download, safeFileName, blobToDataURL, prefs, errorText } from './util.js';
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
 * Choisit et active le projet au démarrage.
 * Ordre de priorité : projet intégré au fichier › projet du navigateur › données d'une ancienne version › nouveau projet vide.
 * Le travail des élèves (progression) n'est jamais écrasé par une nouvelle version du projet.
 */
export async function resolveStartupProject() {
  const image = await defaultMapImage();
  const local = S.storageOk ? await loadLocal().catch(() => null) : null;
  const embedded = embeddedProject();

  if (embedded) {
    const incoming = normalizeProject(embedded, image);
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
export async function saveProject(kind = 'html') {
  const name = prompt('Nom du fichier :', S.project.title);
  if (name === null) return;
  toast('Préparation du fichier…');
  try {
    let missing = 0;
    const bundle = await exportProject({ onMissing: (count) => (missing = count) });
    const base = safeFileName(name) || DEFAULT_TITLE;
    if (kind === 'html') download(pageWithProject(bundle), base + '.html', 'text/html;charset=utf-8');
    else download(JSON.stringify(bundle), base + '.json', 'application/json');
    S.project.savedAt = bundle.savedAt;
    await markExported(bundle.revision);
    render();
    toast(missing ? `⚠ Projet enregistré, mais sans ${missing} photo(s) dont le fichier manque dans ce navigateur.` : '✓ Projet enregistré');
  } catch (e) {
    toast('⚠ Enregistrement impossible : ' + errorText(e));
  }
}

/** Version élèves : sans les fiches masquées ni les réglages enseignant. */
export async function exportStudentVersion({ clearPositions = true, clearMeasures = false } = {}) {
  const kind = canBuildStandalone() ? 'html' : 'json';
  const name = prompt('Nom du fichier pour les élèves :', S.project.title + ' - élèves');
  if (name === null) return;
  toast('Préparation de la version élèves…');
  try {
    let missing = 0;
    const bundle = await exportProject({
      studentsOnly: true,
      keepPositions: !clearPositions,
      keepMeasures: !clearMeasures,
      onMissing: (count) => (missing = count)
    });
    const base = safeFileName(name) || `${DEFAULT_TITLE} - élèves`;
    if (kind === 'html') download(pageWithProject(bundle), base + '.html', 'text/html;charset=utf-8');
    else download(JSON.stringify(bundle), base + '.json', 'application/json');
    toast(missing ? `⚠ Version élèves téléchargée, mais sans ${missing} photo(s) dont le fichier manque dans ce navigateur.` : '✓ Version élèves téléchargée');
  } catch (e) {
    toast('⚠ Export impossible : ' + errorText(e));
  }
}

const unsavedWarning = () =>
  S.local.dirty ? '\n\n⚠ Le projet en cours a des modifications qui ne sont pas enregistrées dans un fichier : elles seront perdues.' : '';

export async function openProjectFile(file) {
  let project;
  try {
    project = normalizeProject(projectFromText(await file.text()), await defaultMapImage());
  } catch (e) {
    return toast('⚠ Ouverture impossible : ' + errorText(e));
  }
  const nf = project.maps.reduce((s, m) => s + m.fiches.length, 0);
  if (!confirm(`Ouvrir le projet « ${project.title} » (${project.maps.length} carte(s), ${nf} fiche(s)) ?${unsavedWarning()}`)) return;
  try {
    await installProject(project, { progress: 'replace' });
    render();
    toast('✓ Projet ouvert');
  } catch (e) {
    toast('⚠ Ouverture impossible : ' + errorText(e));
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
  prefs.del('ib.studentNames');
  $('#studentNames').value = '';
  S.ui.tab = 'cartes';
  render();
  toast("Nouveau projet : remplacez l'image du plan avec « Changer l'image »");
}
