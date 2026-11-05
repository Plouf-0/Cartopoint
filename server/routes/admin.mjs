/**
 * Tableau de bord de l'admin, sous /api/admin. Ces routes ne donnent accès qu'aux comptes et à des chiffres :
 * jamais au contenu des cours ni aux résultats des élèves (ADM-04, ADM-07).
 *
 *   GET  /teachers                        liste des enseignants
 *   POST /invites                         lien de création de compte
 *   POST /teachers/:id/reset              lien de réinitialisation du mot de passe
 *   POST /teachers/:id/disable, /enable   désactiver ou réactiver un compte
 *   POST /teachers/:id/delete, /restore   supprimer un compte désactivé (avec le mot à recopier) ou le restaurer
 */
import { eraseDate } from '../auth.mjs';
import { HttpError, PRIVATE, readJson, sendJson } from '../http.mjs';
import { sameOriginOnly } from '../security.mjs';

const DELETE_WORD = 'SUPPRIMER';

export function adminRoutes(router, auth, courses) {
  const summary = (account) => ({
    id: account.id,
    email: account.email,
    createdAt: account.created_at,
    lastLoginAt: account.last_login_at,
    disabled: Boolean(account.disabled_at),
    deletedAt: account.deleted_at,
    eraseAt: account.deleted_at && eraseDate(account.deleted_at),
    ...courses.stats(account.id)
  });

  /** Route réservée à l'admin. Le rôle est vérifié ici, côté serveur, quelle que soit l'interface. */
  const adminOnly = (handler) => (req, res, context) => {
    auth.requireRole(req, 'admin');
    return handler(req, res, context);
  };
  const adminWrite = (handler) => sameOriginOnly(adminOnly(handler));

  function teacher(id) {
    const account = auth.teacherById(id);
    if (!account) throw new HttpError(404, 'Introuvable');
    return account;
  }

  router
    .add(
      'GET',
      '/api/admin/teachers',
      adminOnly((req, res) => sendJson(req, res, auth.listTeachers().map(summary), PRIVATE))
    )
    .add(
      'POST',
      '/api/admin/invites',
      adminWrite((req, res) => sendJson(req, res, auth.createInvite(), PRIVATE))
    )
    .add(
      'POST',
      '/api/admin/teachers/:id/reset',
      adminWrite((req, res, { params }) => {
        const account = teacher(params.id);
        if (account.disabled_at) throw new HttpError(409, "Ce compte est désactivé : réactivez-le d'abord.");
        return sendJson(req, res, auth.createReset(account.id), PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/admin/teachers/:id/disable',
      adminWrite((req, res, { params }) => {
        auth.disable(teacher(params.id).id);
        return sendJson(req, res, summary(teacher(params.id)), PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/admin/teachers/:id/enable',
      adminWrite((req, res, { params }) => {
        if (teacher(params.id).deleted_at) throw new HttpError(409, "Ce compte est supprimé : restaurez-le d'abord.");
        auth.enable(teacher(params.id).id);
        return sendJson(req, res, summary(teacher(params.id)), PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/admin/teachers/:id/delete',
      adminWrite(async (req, res, { params }) => {
        const { word } = await readJson(req);
        const account = teacher(params.id);
        if (!account.disabled_at) throw new HttpError(409, 'Désactivez ce compte avant de le supprimer.');
        // L'écran vérifie déjà le mot : on ne se repose pas sur lui pour une action aussi lourde
        if (word !== DELETE_WORD) throw new HttpError(400, `Recopiez le mot ${DELETE_WORD} pour confirmer.`);
        auth.markDeleted(account.id);
        return sendJson(req, res, summary(teacher(params.id)), PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/admin/teachers/:id/restore',
      adminWrite((req, res, { params }) => {
        auth.restore(teacher(params.id).id);
        return sendJson(req, res, summary(teacher(params.id)), PRIVATE);
      })
    );
}
