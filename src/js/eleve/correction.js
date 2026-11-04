/**
 * La correction d'un élève (CRG-06, CRG-08, CRG-10). Elle reste le temps de la page : gardée dans sessionStorage, qui survit à un rechargement
 * et disparaît avec l'onglet, et jamais dans IndexedDB ni dans un cache. Les positions réelles ne sont fusionnées qu'en mémoire.
 *
 * Rien ne s'exécute de façon fiable à la fermeture d'une page : le cours est marqué « à effacer » dès que c'est fini, et effacé au prochain
 * chargement qui n'a plus son onglet.
 */
import { Progress, openDb } from '../db.js';
import { THRESHOLDS, emptyProgress, titleOf } from '../model.js';
import { downloadReport, resultRows } from '../report.js';
import { S, posOf } from '../store.js';
import { $, dateAndTime, esc, prefs } from '../util.js';
import { MEDIA_CACHE, filesToKeep } from './offline.js';

const STUDENT_PREFIX = 'cartopoint.eleve.';
const sessionKey = (id) => `cartopoint.seance.${id}`;
const eraseKey = (id) => `efface/${id}`;

/**
 * Cet onglet, pour cet élève : `beforeEnd` s'il a vu le cours en marche, `correction` une fois reçue. Sans cela, un élève qui a fermé sa page avant
 * la fin ne doit pas recevoir la correction en la rouvrant (CRG-08).
 */
export function readSession(id) {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey(id)));
  } catch {
    return null;
  }
}

export function saveSession(id, session) {
  try {
    sessionStorage.setItem(sessionKey(id), JSON.stringify(session));
  } catch {
    // Trop plein ou refusé : la correction reste à l'écran, le serveur la redonnera au rechargement
  }
}

export const markForErasure = (id) => Progress.put(eraseKey(id), true).catch(() => {});

/** Les positions réelles passent dans le cours en mémoire, et les vues montrent alors pins, écarts et résultats comme d'habitude. */
export function applyCorrection(correction) {
  for (const map of S.project.maps) {
    for (const fiche of map.fiches) {
      const result = correction.maps[map.id]?.fiches[fiche.id];
      if (result?.refX !== undefined) Object.assign(fiche, { refX: result.refX, refY: result.refY });
    }
    (S.progress[map.id] ??= emptyProgress()).verified = true;
  }
  S.correction = correction;
}

const scoredCount = ({ ok, near, far, unplaced }) => ok + near + far + unplaced;

const scoreFigure = ({ score }) => `${score.ok} / ${scoredCount(score)}`;

function scoreDetail({ score }) {
  const parts = ['bien placée(s)'];
  if (score.near) parts.push(`${score.near} proche(s)`);
  if (score.far) parts.push(`${score.far} à revoir`);
  if (score.unplaced) parts.push(`${score.unplaced} non placée(s)`);
  return parts.join(' · ');
}

/** Le score de tout le cours, en une phrase. */
export const scoreText = (correction) => `${scoreFigure(correction)} ${scoreDetail(correction)}`;

export function showCorrection(names) {
  const rows = resultRows();
  $('#correctionBox').innerHTML = `
    <div class="dlg-head">
      <div style="flex:1"><h2>Votre correction</h2><p class="state">${esc(names)} · ${esc(S.map.name)} · cours du ${esc(dateAndTime(S.correction.openedAt))}</p></div>
      <button class="x" type="button" data-close aria-label="Fermer">×</button>
    </div>
    <div class="dlg-body">
      <div class="score"><strong>${esc(scoreFigure(S.correction))}</strong><span>${esc(scoreDetail(S.correction))}</span></div>
      <div class="table-wrap"><table class="results">
        <thead><tr><th>N°</th><th>Fiche</th><th>Résultat</th><th>Écart</th></tr></thead>
        <tbody>${rows
          .map(
            (row) => `<tr>
              <td class="n"><span class="num ${posOf(row.fiche) ? 'on' : ''}">${row.n}</span></td>
              <td>${esc(titleOf(row.fiche))}</td>
              <td><span class="grade ${row.ev.cls}">${esc(row.ev.label)}</span></td>
              <td>${esc(row.ev.dist || '—')}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>
      <p class="state" style="margin-top:12px">Bien placée : moins de ${THRESHOLDS.ok} % de la largeur du plan · Proche : moins de ${THRESHOLDS.near} %. Cette correction disparaît quand vous fermez la page : téléchargez le compte rendu pour la garder.</p>
    </div>
    <div class="dlg-foot">
      <button class="btn" type="button" id="correctionReport">Télécharger le compte rendu (JPG)</button>
    </div>`;
  $('#correctionBox [data-close]').onclick = () => $('#dlgCorrection').close();
  $('#correctionReport').onclick = () => downloadReport(names, { date: S.correction.openedAt });
  $('#dlgCorrection').showModal();
}

function studentsOnThisDevice() {
  try {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(STUDENT_PREFIX))
      .map((key) => ({ key, me: JSON.parse(localStorage.getItem(key)) }))
      .filter(({ me }) => me?.id);
  } catch {
    return [];
  }
}

/** Efface les cours finis dont l'onglet a été fermé : travail, nom et photos. Un même plan peut servir à un autre cours : il reste alors. */
export async function eraseClosedCourses() {
  try {
    await openDb();
    const students = studentsOnThisDevice();
    if (!students.length) return;
    const courses = await Promise.all(
      students.map(async (student) => ({
        ...student,
        course: await Progress.get(`cours/${student.me.id}`),
        closed: (await Progress.get(eraseKey(student.me.id))) && !readSession(student.me.id)
      }))
    );
    const filesOf = (course) => (course ? filesToKeep(course) : []);
    const stillUsed = new Set(courses.filter(({ closed }) => !closed).flatMap(({ course }) => filesOf(course)));
    for (const { key, me, course, closed } of courses) {
      if (!closed) continue;
      const cache = window.caches && (await caches.open(MEDIA_CACHE));
      for (const url of filesOf(course)) if (!stillUsed.has(url)) await cache?.delete(url);
      for (const map of course?.maps ?? []) await Progress.del(`${me.id}/${map.id}`);
      await Promise.all([Progress.del(`rendu/${me.id}`), Progress.del(`cours/${me.id}`), Progress.del(eraseKey(me.id))]);
      prefs.del(key);
    }
  } catch {
    // Sans stockage, il n'y a rien à effacer. Une panne ici ne doit pas empêcher d'ouvrir un cours
  }
}
