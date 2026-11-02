/**
 * Faire entrer un projet dans l'espace enseignant, et en sortir un cours sous forme de fichier.
 */
import { api } from '../api.js';
import { draftOf, normalizeProject, projectFromText } from '../model.js';
import { blobToDataURL, dataURLToBlob, uid } from '../util.js';
import { uploadPhoto, uploadPlan, uploadVideo } from './course-backend.js';

/**
 * Crée un cours depuis un fichier de projet, toutes versions (.json ou .html). Les photos passent une par une par
 * l'envoi normal, puis le contenu est créé : les placements et mesures des élèves ne sont pas repris.
 * @returns le cours créé, et le nombre de fichiers qui n'ont pas pu être envoyés
 */
export async function importProject(file, onProgress = () => {}) {
  const project = normalizeProject(projectFromText(await file.text()));
  const photos = project.maps.flatMap((map) => map.fiches.flatMap((fiche) => fiche.media.filter((media) => media.data?.startsWith('data:'))));
  const plans = project.maps.filter((map) => map.image.startsWith('data:'));
  const total = photos.length + plans.length;
  let done = 0;
  let failed = 0;

  async function send(data, upload, store) {
    onProgress(++done, total);
    try {
      store(await upload(dataURLToBlob(data)));
    } catch {
      failed++;
      store('');
    }
  }
  for (const map of plans) await send(map.image, uploadPlan, (url) => (map.image = url));
  for (const media of photos) await send(media.data, media.type === 'video' ? uploadVideo : uploadPhoto, (url) => (media.data = url));

  for (const map of project.maps) for (const fiche of map.fiches) fiche.media = fiche.media.filter((media) => media.data);
  return { course: await api('POST', '/courses', { draft: draftOf(project) }), failed };
}

async function embedded(url) {
  if (!url.startsWith('/media/')) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fichier introuvable sur le serveur (${response.status})`);
  return blobToDataURL(await response.blob());
}

/** Le cours en un seul fichier, photos comprises : il se réimporte, sur ce site ou ailleurs. */
export async function exportCourse(project) {
  const copy = structuredClone(draftOf(project));
  for (const map of copy.maps) {
    map.image = await embedded(map.image);
    for (const fiche of map.fiches) for (const media of fiche.media) media.data = await embedded(media.data);
  }
  return { ...copy, id: project.id, revision: uid(), savedAt: new Date().toISOString(), progress: {} };
}
