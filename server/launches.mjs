/**
 * Lancements d'un cours et élèves qui les rejoignent. Un lancement fige la dernière version publiée (COU-11) et a son
 * propre code (COU-06). Un élève n'a pas de compte : un jeton, gardé par son navigateur, le reconnaît.
 */
import { AFTER_END_GRACE } from './answers.mjs';
import { meanGap, normalizeProject, usesMeters } from '../src/js/model.js';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { hashToken } from './auth.mjs';
import { HttpError } from './http.mjs';

/** Sans O, 0, I ni 1 : un code se lit au tableau et se tape sur un téléphone. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 5;
export const MAX_PARTICIPANTS = 200;
export const MAX_NAMES = 120;
export const MAX_NOTE = 40;
export const KEEP_LAUNCH_MS = 365 * 24 * 60 * 60 * 1000;

const iso = () => new Date().toISOString();

export function newCode() {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** Tapé à la main, un code peut être en minuscules ou contenir des espaces. */
export const normalizeCode = (value) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');

/** Prénoms et noms sur une seule ligne, sans caractère de contrôle. */
export function normalizeNames(value) {
  const names =
    typeof value === 'string'
      ? value
          .replace(/\p{C}+/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  if (!names) throw new HttpError(400, 'Indiquez votre prénom et votre nom.');
  if (names.length > MAX_NAMES) throw new HttpError(400, `Pas plus de ${MAX_NAMES} caractères.`);
  return names;
}

export function createLaunches(db, { makeCode = newCode, now = Date.now } = {}) {
  /** Le cours du lancement tel qu'il a été publié, positions réelles comprises. */
  const contentOf = (row) => normalizeProject(JSON.parse(db.prepare('SELECT content FROM course_versions WHERE id = ?').get(row.version_id).content));
  const participantsOf = (launchId) => db.prepare('SELECT * FROM participants WHERE launch_id = ? ORDER BY joined_at, rowid').all(launchId);
  const participantCount = (launchId) => db.prepare('SELECT COUNT(*) AS n FROM participants WHERE launch_id = ?').get(launchId).n;
  const versionNumber = (versionId) => db.prepare('SELECT number FROM course_versions WHERE id = ?').get(versionId).number;

  const summary = (row) => ({
    id: row.id,
    courseId: row.course_id,
    code: row.code,
    versionNumber: versionNumber(row.version_id),
    openedAt: row.opened_at,
    endedAt: row.ended_at,
    participantCount: participantCount(row.id)
  });

  function insert(courseId, versionId) {
    const id = randomUUID();
    for (let attempt = 1; ; attempt++) {
      try {
        db.prepare('INSERT INTO launches (id, course_id, version_id, code, opened_at) VALUES (?, ?, ?, ?, ?)').run(id, courseId, versionId, makeCode(), iso());
        return id;
      } catch (e) {
        // Un code déjà pris : la chance d'en tirer plusieurs de suite est infime
        if (attempt >= CODE_ATTEMPTS || !/UNIQUE/.test(e.message)) throw e;
      }
    }
  }

  const byId = (id) => db.prepare('SELECT * FROM launches WHERE id = ?').get(id);

  return {
    /** Ouvre un lancement sur la dernière version publiée. */
    open(course) {
      const version = db.prepare('SELECT id FROM course_versions WHERE course_id = ? ORDER BY number DESC LIMIT 1').get(course.id);
      if (!version) throw new HttpError(409, "Publiez d'abord ce cours : les élèves n'ont accès qu'à une version publiée.");
      return summary(byId(insert(course.id, version.id)));
    },

    forCourse(courseId) {
      return db.prepare('SELECT * FROM launches WHERE course_id = ? ORDER BY opened_at DESC, rowid DESC').all(courseId).map(summary);
    },

    /** Ne répond qu'au propriétaire : ni un autre enseignant ni l'admin ne peuvent savoir qu'un lancement existe (ANO-06). */
    require(accountId, id) {
      const row = db
        .prepare('SELECT launches.* FROM launches JOIN courses ON courses.id = launches.course_id WHERE launches.id = ? AND courses.account_id = ?')
        .get(id, accountId);
      if (!row) throw new HttpError(404, 'Introuvable');
      return row;
    },

    /** Ce que voit l'enseignant, et lui seul : les noms de ses élèves et leur état (SUI-01). */
    details(row) {
      const course = db.prepare('SELECT title FROM courses WHERE id = ?').get(row.course_id);
      const project = contentOf(row);
      return {
        ...summary(row),
        title: course.title,
        gapUnit: usesMeters(project) ? 'm' : '% du plan',
        participants: participantsOf(row.id).map((p) => ({
          id: p.id,
          names: p.names,
          joinedAt: p.joined_at,
          submittedAt: p.submitted_at,
          late: Boolean(p.late),
          autoClosed: Boolean(p.auto_closed),
          answersAfterEnd: p.answers_after_end,
          finishedAfterEnd: Boolean(row.ended_at && p.finished_at && Date.parse(p.finished_at) > Date.parse(row.ended_at) + AFTER_END_GRACE),
          byFile: Boolean(p.by_file),
          note: p.note,
          score: p.results ? JSON.parse(p.results).score : null,
          meanGap: p.results ? meanGap(project, JSON.parse(p.results)) : null
        }))
      };
    },

    /**
     * Tout ce qu'il faut pour les comptes rendus et le fichier Excel, en une fois : le cours du lancement, positions réelles comprises, et les réponses de chacun.
     * Ne part que vers l'enseignant du cours (HIS-04, ANO-06).
     */
    sheets(row) {
      const stored = new Map(participantsOf(row.id).map((p) => [p.id, p]));
      const details = this.details(row);
      return {
        ...details,
        grace: AFTER_END_GRACE,
        course: contentOf(row),
        participants: details.participants.map((p) => {
          const { answers, results } = stored.get(p.id);
          return { ...p, answers: answers ? JSON.parse(answers) : null, results: results ? JSON.parse(results) : null };
        })
      };
    },

    /** La note que l'enseignant donne à un élève, s'il en donne une. Effacer, c'est enregistrer une note vide. */
    setNote(row, participantId, rawNote) {
      if (typeof rawNote !== 'string') throw new HttpError(400, 'Note illisible.');
      const note = rawNote.trim().slice(0, MAX_NOTE);
      const { changes } = db.prepare('UPDATE participants SET note = ? WHERE id = ? AND launch_id = ?').run(note, participantId, row.id);
      if (!changes) throw new HttpError(404, 'Introuvable');
      return { note };
    },

    /** L'élève d'un fichier de réponses : seulement s'il appartient à ce lancement (HIS-06). Comme par le réseau, le premier rendu reçu fait foi (HIS-07). */
    forFile(row, participantId) {
      const participant = db.prepare('SELECT id, names, submitted_at FROM participants WHERE id = ? AND launch_id = ?').get(participantId, row.id);
      if (!participant) throw new HttpError(400, 'Ce fichier vient d’un autre lancement de ce cours, ou d’un autre cours.');
      return { ...participant, ended_at: row.ended_at, content: db.prepare('SELECT content FROM course_versions WHERE id = ?').get(row.version_id).content };
    },

    /** Supprimer un lancement terminé, avec ses élèves et leurs réponses (HIS-05). Celui qui est en marche se termine d'abord. */
    remove(row) {
      if (!row.ended_at) throw new HttpError(409, "Terminez d'abord ce cours : des élèves y travaillent peut-être encore.");
      db.prepare('DELETE FROM launches WHERE id = ?').run(row.id);
    },

    /** Un an après la fin du cours ou, pour un cours jamais terminé, après sa dernière activité (HIS-05). */
    purge() {
      const lastActivity = 'SELECT MAX(COALESCE(p.submitted_at, p.joined_at)) FROM participants p WHERE p.launch_id = launches.id';
      db.prepare(`DELETE FROM launches WHERE COALESCE(ended_at, (${lastActivity}), opened_at) < ?`).run(new Date(now() - KEEP_LAUNCH_MS).toISOString());
    },

    /** Terminer deux fois garde la première date. */
    end(row) {
      db.prepare('UPDATE launches SET ended_at = COALESCE(ended_at, ?) WHERE id = ?').run(iso(), row.id);
      return byId(row.id);
    },

    /** Le lancement d'un code, avec ce qu'il faut pour décider si un nouvel élève peut entrer. */
    byCode(code) {
      return db
        .prepare(
          `SELECT launches.*, courses.title, accounts.disabled_at FROM launches
           JOIN courses ON courses.id = launches.course_id JOIN accounts ON accounts.id = courses.account_id WHERE launches.code = ?`
        )
        .get(normalizeCode(code));
    },

    join(launch, rawNames) {
      const names = normalizeNames(rawNames);
      if (participantCount(launch.id) >= MAX_PARTICIPANTS) throw new HttpError(409, 'Ce cours est complet.');
      const id = randomUUID();
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO participants (id, launch_id, token_hash, names, joined_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        launch.id,
        hashToken(token),
        names,
        iso()
      );
      return { id, token, names };
    },

    /**
     * Le premier envoi fait foi (CRG-07) : la condition est dans la requête, deux envois simultanés n'en font donc qu'un.
     * Un rendu reçu après la fin du cours est signalé à l'enseignant (HOR-07), sauf s'il a été figé par cette fin : la page l'envoie dès qu'elle
     * l'apprend (CRG-11). Figer n'a pas de sens avant la fin : le dire alors ne compte pas.
     * @returns la date du rendu gardé
     */
    submit(participant, answers, results, { autoClosed = false, finishedAt = null, afterEnd = 0, byFile = false } = {}) {
      const closedByEnd = autoClosed && Boolean(participant.ended_at);
      db.prepare(
        'UPDATE participants SET answers = ?, results = ?, submitted_at = ?, late = ?, auto_closed = ?, answers_after_end = ?, finished_at = ?, by_file = ? WHERE id = ? AND submitted_at IS NULL'
      ).run(
        JSON.stringify(answers),
        JSON.stringify(results),
        iso(),
        participant.ended_at && !closedByEnd ? 1 : 0,
        closedByEnd ? 1 : 0,
        afterEnd,
        finishedAt,
        byFile ? 1 : 0,
        participant.id
      );
      return db.prepare('SELECT submitted_at FROM participants WHERE id = ?').get(participant.id).submitted_at;
    },

    /** L'élève d'un jeton, avec son lancement et la version qu'il doit voir. */
    participant(token) {
      return db
        .prepare(
          `SELECT participants.id, participants.names, participants.submitted_at, participants.results, launches.ended_at, course_versions.content FROM participants
           JOIN launches ON launches.id = participants.launch_id JOIN course_versions ON course_versions.id = launches.version_id
           WHERE participants.token_hash = ?`
        )
        .get(hashToken(token));
    }
  };
}
