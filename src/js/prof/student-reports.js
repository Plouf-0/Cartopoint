/**
 * Les comptes rendus JPG des élèves, côté enseignant (HIS-09) : un par carte, avec les positions réelles et les écarts, puisque c'est lui qui les rend. report.js
 * dessine à partir de l'état commun : cette page, qui n'en a pas d'autre usage, y met tour à tour chaque élève.
 */
import { normalizeProject } from '../model.js';
import { planImageBlob, reportBlob } from '../report.js';
import { S } from '../store.js';
import { safeFileName } from '../util.js';
import { uniqueNames, zipFiles } from '../zip.js';

export function readSheets(sheets) {
  return { ...sheets, project: normalizeProject(sheets.course) };
}

function useStudent(project, participant, map) {
  S.admin = true;
  S.project = project;
  S.map = map;
  S.progress = Object.fromEntries(project.maps.map((each) => [each.id, { verified: true, entries: participant.answers?.[each.id] ?? {} }]));
  S.correction = participant.results;
}

/** @returns [{ name, blob }], un fichier par carte */
export async function studentReports(project, participant) {
  const several = project.maps.length > 1;
  const reports = [];
  for (const map of project.maps) {
    useStudent(project, participant, map);
    const label = several ? `${participant.names} - ${map.name}` : participant.names;
    reports.push({ name: `Compte rendu - ${safeFileName(label)}.jpg`, blob: await reportBlob(participant.names, { note: participant.note }) });
  }
  return reports;
}

/** Le plan d'un élève, pour l'écran de détail : ses placements, les positions réelles et les écarts. */
export async function studentPlan(project, participant, map) {
  useStudent(project, participant, map);
  return planImageBlob();
}

/** Tous les comptes rendus dans une seule archive : un navigateur refuse de télécharger des dizaines de fichiers d'un coup. */
export async function allReportsZip(project, participants, onProgress = () => {}) {
  const reports = [];
  for (const [index, participant] of participants.entries()) {
    onProgress(index + 1, participants.length);
    reports.push(...(await studentReports(project, participant)));
  }
  const names = uniqueNames(reports.map((report) => report.name.replace(/\.jpg$/, ''))).map((name) => `${name}.jpg`);
  const files = await Promise.all(reports.map(async (report, index) => ({ name: names[index], data: new Uint8Array(await report.blob.arrayBuffer()) })));
  return zipFiles(files);
}
