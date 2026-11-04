/**
 * Écriture d'une archive ZIP, sans bibliothèque externe et sans compression : assez pour un fichier Excel, et pour des JPG qui ne se compressent plus.
 */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const UTF8_NAMES = 0x0800;
const encoder = new TextEncoder();

function header(size) {
  const buffer = new Uint8Array(size);
  return { bytes: buffer, view: new DataView(buffer.buffer) };
}

/** @param files [{ name, data }], où data est du texte ou des octets */
export function zipFiles(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);

    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, UTF8_NAMES, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    parts.push(local.bytes, name, data);

    const entry = header(46);
    entry.view.setUint32(0, 0x02014b50, true);
    entry.view.setUint16(4, 20, true);
    entry.view.setUint16(6, 20, true);
    entry.view.setUint16(8, UTF8_NAMES, true);
    entry.view.setUint32(16, crc, true);
    entry.view.setUint32(20, data.length, true);
    entry.view.setUint32(24, data.length, true);
    entry.view.setUint16(28, name.length, true);
    entry.view.setUint32(42, offset, true);
    central.push(entry.bytes, name);

    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
}

/** Deux élèves peuvent porter le même nom : « Tom », « Tom (2) ». */
export function uniqueNames(names, { limit = Infinity } = {}) {
  const seen = new Set();
  return names.map((name) => {
    let candidate = name.slice(0, limit);
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = name.slice(0, limit - suffix.length) + suffix;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}
