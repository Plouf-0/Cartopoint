/**
 * Cours d'un enseignant : un brouillon, enregistré à chaque modification, et des versions figées à chaque
 * publication (COU-11). Le contenu est le JSON du projet, sans les photos, qui sont des fichiers à part.
 */
import { randomUUID } from 'node:crypto';
import { ficheFields, isValidValue, templateProblems } from '../src/js/fields.js';
import { BOTANIQUE } from '../src/js/templates/botanique.js';
import { expectedProblem, gradingProblem } from '../src/js/verdicts.js';
import { FORMAT } from '../src/js/model.js';
import { HttpError, isObject } from './http.mjs';
import { MEDIA_NAME } from './media.mjs';
import { iso } from './time.mjs';

const CHANGED_ELSEWHERE = 'Ce cours a été modifié ailleurs, par exemple dans un autre onglet.';
const MEDIA_PATH = '/media/';

const isListOf = (value, isValid) => value === undefined || (Array.isArray(value) && value.every(isValid));

/** Un plan ou une photo est un fichier de ce serveur, ou rien : toute autre valeur partirait telle quelle chez les élèves (COU-14). */
const isFileOrNothing = (value) =>
  (value ?? '') === '' || (typeof value === 'string' && value.startsWith(MEDIA_PATH) && MEDIA_NAME.test(value.slice(MEDIA_PATH.length)));

// Le navigateur lit aussi les anciens noms de ces champs (normalizeMedia, normalizeMap) : ils ne doivent pas servir de porte de côté
const isMedia = (media) => isObject(media) && [media.data, media.dataUrl, media.src].every(isFileOrNothing);
const isFiche = (fiche) => isObject(fiche) && isListOf(fiche.media, isMedia);
const isMap = (map) => isObject(map) && isFileOrNothing(map.image) && isListOf(map.fiches, isFiche) && isListOf(map.locations, isFiche);

/**
 * Le modèle de fiche et ce que chaque fiche y range (CHP-07) : un modèle mal formé, ou une valeur qui ne correspond pas à son
 * champ, est refusé avec la raison. Un contenu sans modèle se lit avec le modèle botanique (MOD-02), et se vérifie avec lui.
 */
function checkFiches(draft) {
  if (draft.template !== undefined) {
    const [problem] = templateProblems(draft.template);
    if (problem) throw new HttpError(400, `Le modèle de fiche n'est pas valable : ${problem}.`);
  }
  const template = draft.template ?? BOTANIQUE;
  if (gradingProblem(draft.grading, template)) throw new HttpError(400, "La notation de ce cours n'est pas valable.");
  const fields = ficheFields(template);
  for (const map of draft.maps) {
    for (const fiche of [...(map.fiches ?? []), ...(map.locations ?? [])]) {
      const wrong = fields.find((field) => fiche[field.id] !== undefined && !isValidValue(field, fiche[field.id]));
      if (wrong) throw new HttpError(400, `Une fiche a une valeur qui ne convient pas au champ « ${wrong.label} ».`);
      const problem = expectedProblem(fiche.expected, template);
      if (problem) throw new HttpError(400, `Une fiche a une ${problem}.`);
    }
  }
}

function checkDraft(draft) {
  if (!draft || typeof draft !== 'object' || draft.format !== FORMAT || !Array.isArray(draft.maps) || !draft.maps.length || !draft.maps.every(isMap)) {
    throw new HttpError(400, "Ce contenu n'est pas un cours valable.");
  }
  checkFiches(draft);
  return JSON.stringify(draft);
}

const titleOf = (draft) =>
  String(draft.title ?? '')
    .trim()
    .slice(0, 200) || 'Cours sans nom';
const countFiches = (text) => (JSON.parse(text).maps ?? []).reduce((total, map) => total + (map.fiches?.length ?? 0), 0);

export function createCourses(db) {
  const lastVersion = (courseId) => db.prepare('SELECT * FROM course_versions WHERE course_id = ? ORDER BY number DESC LIMIT 1').get(courseId);

  function describe(row) {
    const version = lastVersion(row.id);
    return {
      id: row.id,
      title: row.title,
      revision: row.revision,
      updatedAt: row.updated_at,
      fiches: countFiches(row.draft),
      published: version ? { number: version.number, publishedAt: version.published_at } : null,
      modified: version?.content !== row.draft,
      runningLaunch: db.prepare('SELECT id FROM launches WHERE course_id = ? AND ended_at IS NULL ORDER BY opened_at DESC').get(row.id)?.id ?? null
    };
  }

  const owned = (accountId, id) => db.prepare('SELECT * FROM courses WHERE id = ? AND account_id = ?').get(id, accountId);

  return {
    list(accountId) {
      return db.prepare('SELECT * FROM courses WHERE account_id = ? ORDER BY updated_at DESC, rowid DESC').all(accountId).map(describe);
    },

    create(accountId, draft) {
      const text = checkDraft(draft);
      const id = randomUUID();
      db.prepare('INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, accountId, titleOf(draft), text, iso());
      return describe(owned(accountId, id));
    },

    /** Le cours de ce compte, ou une erreur 404 : un autre compte ne doit pas pouvoir deviner qu'il existe (ENS-03). */
    require(accountId, id) {
      const row = owned(accountId, id);
      if (!row) throw new HttpError(404, 'Introuvable');
      return row;
    },

    read(row) {
      return { ...describe(row), draft: JSON.parse(row.draft) };
    },

    /** Enregistre le brouillon, seulement s'il repart de la dernière révision : sinon, on écraserait un autre onglet. */
    update(row, revision, draft) {
      const text = checkDraft(draft);
      if (!Number.isInteger(revision)) throw new HttpError(409, CHANGED_ELSEWHERE);
      const { changes } = db
        .prepare('UPDATE courses SET draft = ?, title = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
        .run(text, titleOf(draft), iso(), row.id, revision);
      if (!changes) throw new HttpError(409, CHANGED_ELSEWHERE);
      return describe(db.prepare('SELECT * FROM courses WHERE id = ?').get(row.id));
    },

    remove(row) {
      db.prepare('DELETE FROM courses WHERE id = ?').run(row.id);
    },

    /** Fige le brouillon dans une nouvelle version. Publier deux fois le même contenu n'en crée pas une de plus. */
    publish(row, revision) {
      if (row.revision !== revision) throw new HttpError(409, CHANGED_ELSEWHERE);
      const last = lastVersion(row.id);
      if (last?.content !== row.draft) {
        db.prepare('INSERT INTO course_versions (id, course_id, number, content, published_at) VALUES (?, ?, ?, ?, ?)').run(
          randomUUID(),
          row.id,
          (last?.number ?? 0) + 1,
          row.draft,
          iso()
        );
      }
      return describe(row);
    },

    /** Chiffres d'un compte pour l'admin (ADM-04) : des nombres, jamais le contenu (ADM-07). */
    stats(accountId) {
      const drafts = db.prepare('SELECT draft FROM courses WHERE account_id = ?').all(accountId);
      const scalar = (sql) => db.prepare(sql).get(accountId).n;
      return {
        courses: drafts.length,
        fiches: drafts.reduce((total, { draft }) => total + countFiches(draft), 0),
        launches: scalar('SELECT COUNT(*) AS n FROM launches JOIN courses ON courses.id = launches.course_id WHERE courses.account_id = ?'),
        running: scalar(
          'SELECT COUNT(*) AS n FROM launches JOIN courses ON courses.id = launches.course_id WHERE courses.account_id = ? AND launches.ended_at IS NULL'
        ),
        bytes:
          scalar('SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE account_id = ?') +
          scalar('SELECT COALESCE(SUM(LENGTH(draft)), 0) AS n FROM courses WHERE account_id = ?') +
          scalar(
            'SELECT COALESCE(SUM(LENGTH(content)), 0) AS n FROM course_versions JOIN courses ON courses.id = course_versions.course_id WHERE courses.account_id = ?'
          )
      };
    }
  };
}
