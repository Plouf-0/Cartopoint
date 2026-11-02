/**
 * Enregistre dans ce navigateur (IndexedDB) : l'ancienne application et le futur fichier de secours.
 */
import { Files, Maps, Meta, Progress } from '../db.js';
import { prepareImage, uid } from '../util.js';

export const localBackend = {
  /** `reportsErrors` : ce backend ne montre pas lui-même ses échecs, store.js s'en charge. */
  reportsErrors: false,

  async save({ maps, progress, meta }) {
    for (const map of maps) await Maps.put(map);
    for (const [key, value] of progress) await Progress.put(key, value);
    if (meta) await Meta.put('project', meta);
  },

  async storeFile(file) {
    const key = 'file-' + uid();
    await Files.put(key, file);
    return { key };
  },

  storeMapImage: (file) => prepareImage(file),

  deleteMap: (id) => Maps.del(id)
};
