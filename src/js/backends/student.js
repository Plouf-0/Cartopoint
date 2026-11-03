/**
 * Page d'un élève : le cours est en lecture seule, seul son travail s'enregistre, dans ce navigateur.
 */
import { Progress } from '../db.js';

export const studentBackend = {
  /** `reportsErrors` : ce backend ne montre pas lui-même ses échecs, store.js s'en charge. */
  reportsErrors: false,

  async save({ progress }) {
    for (const [key, value] of progress) await Progress.put(key, value);
  }
};
