/**
 * Écriture d'un classeur Excel (.xlsx), sans bibliothèque externe : une archive ZIP de fichiers XML. La lecture est dans xlsx.js.
 *
 * Tout texte est écrit comme du texte : un élève qui s'appelle « =1+1 » ne déclenche aucune formule (HIS-08). Un nombre est écrit comme un nombre : Excel
 * peut calculer avec.
 */
import { uniqueNames, zipFiles } from './zip.js';

const CONTENT_TYPES = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const MAX_SHEET_NAME = 31;

/** Une cellule en gras, pour les titres. */
export const bold = (value) => ({ value, bold: true });

// XML n'accepte pas ces caractères, même échappés : un seul rendrait tout le fichier illisible
const clean = (text) =>
  String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cellXml(cell, reference) {
  // Pas de cell?.bold tout court : tout texte a une méthode bold(), héritée des débuts de JavaScript
  const isBold = cell?.bold === true;
  const value = isBold ? cell.value : cell;
  const style = isBold ? ' s="1"' : '';
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${reference}"${style}><v>${value}</v></c>` : '';
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${clean(value)}</t></is></c>`;
}

function sheetXml({ rows, widths = [] }) {
  const columns = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const body = rows.map((row, y) => `<row r="${y + 1}">${row.map((cell, x) => cellXml(cell, `${columnName(x)}${y + 1}`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${columns}<sheetData>${body}</sheetData><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

/** Excel refuse ces caractères dans le nom d'une page, plus de 31 caractères, et deux pages de même nom, sans tenir compte de la casse. */
export function sheetNames(names) {
  const usable = names.map(
    (name, index) =>
      String(name)
        .replace(/[[\]:*?/\\]/g, ' ')
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/^'+|'+$/g, '')
        .trim() || `Page ${index + 1}`
  );
  return uniqueNames(usable, { limit: MAX_SHEET_NAME });
}

/** @param sheets [{ name, rows, widths }] : une ligne est une liste de cellules (texte, nombre, null, ou bold(…)) */
export function workbookBlob(sheets) {
  const names = sheetNames(sheets.map((sheet) => sheet.name));
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPES}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CONTENT_TYPES}.styles+xml"/>${sheets
        .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="${CONTENT_TYPES}.worksheet+xml"/>`)
        .join('')}</Types>`
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((name, index) => `<sheet name="${clean(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join('')}</sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
        )
        .join(
          ''
        )}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    {
      name: 'xl/styles.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'
    },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet) }))
  ];
  const zip = zipFiles(files);
  return new Blob([zip], { type: `${CONTENT_TYPES}.sheet` });
}
