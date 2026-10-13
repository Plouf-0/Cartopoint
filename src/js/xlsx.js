/**
 * Lecture minimale d'un classeur Excel (.xlsx), sans bibliothèque externe.
 *
 * Un .xlsx est une archive ZIP de fichiers XML. On lit la table des matières de
 * l'archive, on décompresse (DecompressionStream du navigateur) la première feuille
 * et le dictionnaire des textes, et on renvoie un tableau de lignes de texte.
 * Formules, mises en forme et autres feuilles sont ignorées.
 */

async function inflateRaw(bytes) {
  if (!globalThis.DecompressionStream) throw new Error('navigateur trop ancien pour lire les .xlsx : enregistrez le fichier en CSV');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lit le répertoire central d'une archive ZIP. */
async function unzip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const files = {};
  let eocd = -1; // « fin du répertoire central »
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ce n'est pas un fichier Excel valide");
  let p = dv.getUint32(eocd + 16, true);
  const count = dv.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = offset + 30 + dv.getUint16(offset + 26, true) + dv.getUint16(offset + 28, true);
    files[name] = { method, data: u8.subarray(start, start + size) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    async text(name) {
      const f = files[name];
      if (!f) return null;
      return dec.decode(f.method === 8 ? await inflateRaw(f.data) : f.data);
    }
  };
}

/** Lignes de la première feuille d'un .xlsx (tableau de tableaux de chaînes). */
export async function parseXlsx(buffer) {
  const zip = await unzip(buffer);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const all = (doc, tag) => [...doc.getElementsByTagNameNS('*', tag)];

  const shared = [];
  const sharedXml = await zip.text('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const si of all(xml(sharedXml), 'si'))
      shared.push(
        all(si, 't')
          .filter((t) => t.parentNode.localName !== 'rPh')
          .map((t) => t.textContent)
          .join('')
      );
  }

  let path = 'xl/worksheets/sheet1.xml';
  try {
    const wb = xml(await zip.text('xl/workbook.xml'));
    const rels = xml(await zip.text('xl/_rels/workbook.xml.rels'));
    const first = all(wb, 'sheet')[0];
    const rid = first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || first.getAttribute('r:id');
    const rel = all(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
    if (rel) {
      const target = rel.getAttribute('Target');
      path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    }
  } catch {
    /* classeur atypique : on tente sheet1.xml */
  }
  const sheet = await zip.text(path);
  if (!sheet) throw new Error('feuille introuvable dans le classeur');

  const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  for (const row of all(xml(sheet), 'row')) {
    const out = [];
    all(row, 'c').forEach((c, i) => {
      const ref = c.getAttribute('r');
      const type = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent ?? '';
      let value = v;
      if (type === 's') value = shared[+v] ?? '';
      else if (type === 'inlineStr')
        value = all(c, 't')
          .map((x) => x.textContent)
          .join('');
      else if (type === 'b') value = v === '1' ? 'oui' : 'non';
      out[ref ? colIndex(ref) : i] = value;
    });
    rows.push(Array.from(out, (x) => x ?? ''));
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
