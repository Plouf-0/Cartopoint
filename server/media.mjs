/**
 * Photos, plans et vidéos des cours : un fichier `data/media/<sha256>.<ext>`, partagé si le contenu est identique,
 * et une ligne `media` par compte qui l'utilise. Le type est lu dans le contenu, jamais dans le nom envoyé :
 * pas de SVG, qui peut contenir un script.
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.mjs';

const DAY = 24 * 60 * 60 * 1000;
const REFUSED = 'Ce type de fichier est refusé. Envoyez une photo JPEG, PNG ou WebP, ou une vidéo MP4 ou WebM.';
/** Formats d'image dans la même enveloppe que MP4, qu'un navigateur ne saurait pas afficher comme une vidéo. */
const IMAGE_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)/;
const REFERENCE = /\/media\/([0-9a-f]{64})\./g;

export const MEDIA_NAME = /^([0-9a-f]{64})\.(jpg|png|webp|mp4|webm)$/;

const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, i) => buffer[offset + i] === byte);
const ascii = (buffer, start, end) => buffer.toString('latin1', start, end);

/** L'extension qui correspond au contenu, ou null si le fichier est refusé. */
export function sniffType(buffer) {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buffer, 4, 8) === 'ftyp') return IMAGE_BRANDS.test(ascii(buffer, 8, 12)) ? null : 'mp4';
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  return null;
}

export function createMedia(db, dir) {
  mkdirSync(dir, { recursive: true });

  /** Les fichiers cités par les brouillons et les versions publiées d'un compte. */
  function usedBy(accountId) {
    const used = new Set();
    const texts = db
      .prepare(
        `SELECT draft AS text FROM courses WHERE account_id = ?
         UNION ALL
         SELECT content FROM course_versions JOIN courses ON courses.id = course_versions.course_id WHERE courses.account_id = ?`
      )
      .all(accountId, accountId);
    for (const { text } of texts) for (const match of text.matchAll(REFERENCE)) used.add(match[1]);
    return used;
  }

  return {
    dir,

    async save(accountId, buffer) {
      const ext = sniffType(buffer);
      if (!ext) throw new HttpError(415, REFUSED);
      const hash = createHash('sha256').update(buffer).digest('hex');
      // La ligne d'abord : le nettoyage ne retire jamais un fichier qu'une ligne désigne.
      db.prepare(
        `INSERT INTO media (hash, account_id, ext, size, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (hash, account_id) DO UPDATE SET created_at = excluded.created_at`
      ).run(hash, accountId, ext, buffer.length, new Date().toISOString());
      const name = `${hash}.${ext}`;
      const target = path.join(dir, name);
      if (!existsSync(target)) {
        const tmp = path.join(dir, `${randomUUID()}.tmp`);
        await fs.writeFile(tmp, buffer);
        await fs.rename(tmp, target);
      }
      return { url: `/media/${name}`, size: buffer.length };
    },

    /**
     * Oublie les fichiers qui ne servent plus : ceux d'un cours supprimé ou d'une photo retirée. Un jour de délai,
     * car un fichier est envoyé avant que le brouillon qui le cite soit enregistré.
     */
    purge(now = Date.now()) {
      const limit = new Date(now - DAY).toISOString();
      for (const { account_id: accountId } of db.prepare('SELECT DISTINCT account_id FROM media').all()) {
        const used = usedBy(accountId);
        const old = db.prepare('SELECT hash FROM media WHERE account_id = ? AND created_at <= ?').all(accountId, limit);
        for (const { hash } of old) {
          if (!used.has(hash)) db.prepare('DELETE FROM media WHERE hash = ? AND account_id = ?').run(hash, accountId);
        }
      }
      const known = new Set(
        db
          .prepare('SELECT DISTINCT hash FROM media')
          .all()
          .map((row) => row.hash)
      );
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        const match = name.match(MEDIA_NAME);
        // Un fichier sans nom valable est un envoi interrompu : il n'a plus rien à faire ici au bout d'un jour.
        if (match ? !known.has(match[1]) : statSync(file).mtimeMs <= now - DAY) rmSync(file, { force: true });
      }
    }
  };
}
