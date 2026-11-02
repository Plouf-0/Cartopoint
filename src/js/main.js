/**
 * Point d'entrée de l'application d'origine.
 *
 * Ordre de démarrage :
 *   1. mémoriser la page d'origine (pour pouvoir générer des fichiers autonomes) ;
 *   2. brancher les écouteurs des vues ;
 *   3. ouvrir le stockage du navigateur et choisir le projet à afficher ;
 *   4. appliquer le thème et dessiner.
 */
import { $, fatal, errorText } from './util.js';
import { S, flush } from './store.js';
import { openDb } from './db.js';
import { applyTheme } from './themes.js';
import { onRender, render } from './render.js';
import { captureTemplate, resolveStartupProject } from './project-io.js';
import { renderHeader, bindHeader } from './views/header.js';
import { renderMap, bindMap } from './views/map.js';
import { renderPanel } from './views/panel.js';
import { bindLogin } from './views/login.js';
import { bindEditor } from './views/editor.js';
import { bindReader } from './views/reader.js';
import { bindViewer } from './views/viewer.js';
import { setProjectTab } from './views/admin/index.js';
import * as projectTab from './views/admin/project.js';

captureTemplate();
setProjectTab('Projet', projectTab);

onRender(() => applyTheme(S.project.theme));
onRender(renderHeader);
onRender(renderMap);
onRender(renderPanel);

async function start() {
  bindHeader();
  bindMap();
  bindLogin();
  bindEditor();
  bindReader();
  bindViewer();

  try {
    await openDb();
  } catch (e) {
    S.storageOk = false;
    fatal('Le stockage du navigateur est indisponible (navigation privée ?) : les modifications ne seront pas conservées. Détail : ' + errorText(e));
  }
  try {
    await resolveStartupProject();
  } catch (e) {
    console.error(e);
    fatal('Impossible de charger le projet : ' + errorText(e));
    return;
  }
  render();
  // Dernière écriture si l'on ferme l'onglet juste après une modification.
  window.addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

start();
