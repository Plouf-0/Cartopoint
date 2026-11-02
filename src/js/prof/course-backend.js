/**
 * Enregistre un cours sur le serveur, à la place de IndexedDB : le brouillon entier à chaque modification, et chaque
 * fichier dès qu'il est choisi. Le serveur attribue les révisions : si un autre onglet a enregistré entre-temps,
 * il refuse au lieu de laisser écraser son travail.
 */
import { api, uploadFile } from '../api.js';
import { dataURLToBlob, prepareImage } from '../util.js';

/** Essai sur le projet en service : 57 % de son poids en photos, sans différence visible. Le plan doit rester lisible. */
const PHOTO = { max: 1280, quality: 0.78, keepBelow: 150e3, convert: true };
const PLAN = { convert: true };

const reduced = async (file, options) => dataURLToBlob(await prepareImage(file, options));

export const uploadPhoto = async (file) => (await uploadFile(await reduced(file, PHOTO))).url;
export const uploadPlan = async (file) => (await uploadFile(await reduced(file, PLAN))).url;
/** Une vidéo part telle quelle : le navigateur ne sait pas la réduire. */
export const uploadVideo = async (file) => (await uploadFile(file)).url;

/**
 * @param course    le cours lu sur le serveur, tenu à jour ici : révision, état de publication
 * @param getDraft  renvoie le contenu à enregistrer
 * @param onState   appelée avec 'saving', 'saved', ou 'error' et l'erreur
 */
export function createCourseBackend({ course, getDraft, onState }) {
  let lastSaved = JSON.stringify(getDraft());
  return {
    reportsErrors: true,

    /** Dès la modification, et non à l'envoi : l'écran n'affiche jamais « Enregistré » alors que rien n'est encore parti. */
    onChange: () => onState('saving'),

    async save() {
      const draft = getDraft();
      const text = JSON.stringify(draft);
      if (text === lastSaved) return onState('saved');
      try {
        Object.assign(course, await api('PUT', `/courses/${course.id}`, { revision: course.revision, draft }));
      } catch (e) {
        onState('error', e);
        throw e;
      }
      lastSaved = text;
      onState('saved');
    },

    /** Le fichier est sur le serveur : le média n'a pas de clé locale, seulement son adresse. */
    storeFile: async (file) => ({ data: await (file.type.startsWith('video/') ? uploadVideo(file) : uploadPhoto(file)) }),

    storeMapImage: uploadPlan,

    /** Le brouillon suivant ne contient plus la carte : il n'y a rien d'autre à faire. */
    deleteMap: async () => {}
  };
}
