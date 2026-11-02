/**
 * Fabrique un vrai fichier .xlsx pour les tests : une archive ZIP compressée, avec des chaînes partagées, comme
 * ceux d'Excel. Sans dépendance : Node sait compresser, et le format ZIP tient en quelques lignes.
 */
import { crc32, deflateRawSync } from 'node:zlib';

const escapeXml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const column = (i) => String.fromCharCode(65 + i);

function zip(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0);
    shared.writeUInt16LE(0x0800, 2);
    shared.writeUInt16LE(8, 4);
    shared.writeUInt32LE(crc32(data), 10);
    shared.writeUInt32LE(packed.length, 14);
    shared.writeUInt32LE(data.length, 18);
    shared.writeUInt16LE(nameBytes.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), shared, nameBytes, packed]);
    const tail = Buffer.alloc(14);
    tail.writeUInt32LE(offset, 10);
    directory.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2, 20, 0]), shared, tail, nameBytes]));
    parts.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.write('PK\x05\x06', 0, 'latin1');
  end.writeUInt16LE(directory.length, 8);
  end.writeUInt16LE(directory.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

/** @param rows tableau de lignes, chaque ligne un tableau de textes. */
export function makeXlsx(rows) {
  const strings = [...new Set(rows.flat().filter((cell) => cell !== ''))];
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((cell, c) => (cell === '' ? '' : `<c r="${column(c)}${r + 1}" t="s"><v>${strings.indexOf(cell)}</v></c>`));
    return `<row r="${r + 1}">${cells.join('')}</row>`;
  });
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Fiches" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((text) => `<si><t>${escapeXml(text)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`
  });
}
