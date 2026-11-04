/**
 * Prépare la page élève pour le terrain (HOR-01) : installe le service worker, et télécharge les plans et les photos du cours. Les
 * vidéos restent en ligne : trop lourdes pour tout un groupe sur un même réseau. Tout ce qui est déjà gardé n'est pas redemandé.
 */
export const MEDIA_CACHE = 'cartopoint-media';
// Toute une classe partage souvent le même réseau : mieux vaut peu de fichiers à la fois
const AT_ONCE = 4;
// Une installation qui échoue ne prévient pas : passé ce délai, l'élève doit le savoir
const WORKER_WAIT = 20000;

/** Installe le service worker. Sans danger à répéter. Répond false si ce navigateur ne peut pas (navigation privée, connexion non sûre). */
export async function startWorker() {
  if (!navigator.serviceWorker || !window.caches) return false;
  try {
    await navigator.serviceWorker.register('/c/sw.js', { scope: '/c/', updateViaCache: 'none' });
    return true;
  } catch {
    return false;
  }
}

function workerReady() {
  return Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), WORKER_WAIT))]);
}

/** Ce qu'il faut garder pour le terrain : un fichier du serveur, jamais un fichier déjà dans le cours sous forme de texte. */
export function filesToKeep(project) {
  const files = new Set();
  for (const map of project.maps) {
    files.add(map.image);
    for (const fiche of map.fiches) for (const media of fiche.media) if (media.type === 'image') files.add(media.data);
  }
  return [...files].filter((url) => url?.startsWith('/media/'));
}

async function missingFiles(cache, files) {
  const kept = await Promise.all(files.map((url) => cache.match(url)));
  return files.filter((_, index) => !kept[index]);
}

/**
 * @param report reçoit l'état à chaque étape : downloading (done, total), puis ready, incomplete (failed) ou unavailable.
 * « ready » n'arrive que lorsque tout y est : l'élève se fie à ce message pour couper le réseau.
 */
export async function prepareOffline(project, report) {
  const files = filesToKeep(project);
  report({ state: 'downloading', done: 0, total: files.length });
  if (!(await startWorker()) || !(await workerReady())) return report({ state: 'unavailable' });

  let cache, queue;
  try {
    cache = await caches.open(MEDIA_CACHE);
    queue = await missingFiles(cache, files);
  } catch {
    return report({ state: 'unavailable' });
  }
  let done = files.length - queue.length;
  let failed = 0;
  report({ state: 'downloading', done, total: files.length });
  const downloader = async () => {
    while (queue.length) {
      try {
        await cache.add(queue.shift());
      } catch {
        // Réseau coupé, fichier absent, ou plus de place : le message le dit, et on réessaiera
        failed++;
      }
      report({ state: 'downloading', done: ++done, total: files.length });
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, downloader));
  report(failed ? { state: 'incomplete', failed } : { state: 'ready' });
}
