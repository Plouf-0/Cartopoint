/**
 * Les téléchargements du compte rendu dans l'application d'origine, où l'élève écrit ses noms en haut de la page. La page d'un élève connaît déjà les
 * siens, et n'a pas à charger tout cela (eleve/correction.js).
 */
import { S } from '../store.js';
import { $, download, safeFileName, toast } from '../util.js';
import { downloadPlanImage, downloadReport, resultRows } from '../report.js';
import { buildTeacherCsv } from '../spreadsheet.js';
import { studentNames } from './header.js';

/** Noms des élèves, ou null (avec un message) s'ils manquent hors gestion. */
function requireNames() {
  const names = studentNames();
  if (!names && !S.admin) {
    $('#dlgResults').open && $('#dlgResults').close();
    toast('Indiquez vos noms en haut de la page avant de télécharger');
    $('#studentNames').focus();
    return null;
  }
  return names;
}

export const savePlanImage = () => downloadPlanImage(studentNames());

export function saveReport() {
  const names = requireNames();
  if (names !== null) downloadReport(names);
}

export function saveTeacherCsv() {
  const names = requireNames();
  if (names === null) return;
  const csv = buildTeacherCsv(resultRows(), { names, widthMeters: S.map.widthMeters });
  download(csv, safeFileName(`Rendu prof - ${names || S.map.name}`) + '.csv', 'text/csv;charset=utf-8');
  toast('✓ Rendu prof téléchargé');
}
