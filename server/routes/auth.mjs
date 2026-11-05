/**
 * Connexion et compte de la personne connectée, sous /api/auth.
 *
 *   POST /login, /logout, GET /me   session
 *   POST /password                  changer son mot de passe
 *   POST /invite, /reset            utiliser un lien à usage unique, jeton dans le corps
 */
import { HttpError, PRIVATE, readJson, sendJson } from '../http.mjs';
import { clientIp, createLimiter, sameOriginOnly } from '../security.mjs';

const TEN_MINUTES = 10 * 60 * 1000;
const BAD_LOGIN = 'Adresse e-mail ou mot de passe incorrect.';
const DISABLED = "Votre compte a été désactivé. Contactez l'administrateur du site.";
const TOO_MANY = 'Trop de tentatives, réessayez dans 10 minutes.';

const profile = (account) => ({ email: account.email, role: account.role });

export function authRoutes(router, auth, { trustProxy }) {
  // Par couple : pour un compte visé depuis une adresse. Par adresse : pour une adresse qui essaie
  // beaucoup de comptes. Le seuil reste haut, car tout un établissement peut partager la même IP.
  const perPair = createLimiter({ max: 10, windowMs: TEN_MINUTES });
  const perIp = createLimiter({ max: 50, windowMs: TEN_MINUTES });

  /**
   * L'échec est compté avant le calcul du mot de passe, qui prend du temps : envoyer des essais par
   * centaines en même temps ne permet donc pas de passer entre les mailles du blocage.
   */
  async function guarded(req, email, check) {
    const ip = clientIp(req, trustProxy);
    const pair = `${ip}|${email.toLowerCase()}`;
    if (perPair.blocked(pair) || perIp.blocked(ip)) throw new HttpError(429, TOO_MANY);
    perPair.fail(pair);
    perIp.fail(ip);
    const result = await check();
    if (result) {
      perPair.clear(pair);
      perIp.forgive(ip);
    }
    return result;
  }

  router
    .add(
      'POST',
      '/api/auth/login',
      sameOriginOnly(async (req, res) => {
        const { email, password } = await readJson(req);
        if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 200) throw new HttpError(401, BAD_LOGIN);
        const address = email.trim();
        const account = await guarded(req, address, () => auth.checkCredentials(address, password));
        if (!account) throw new HttpError(401, BAD_LOGIN);
        // Vérifié après le mot de passe : un inconnu ne peut pas savoir si un compte existe ou s'il est désactivé
        if (account.disabled_at) throw new HttpError(403, DISABLED);
        auth.startSession(req, res, account.id);
        return sendJson(req, res, profile(account), PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/auth/logout',
      sameOriginOnly((req, res) => {
        auth.endSession(req, res);
        return sendJson(req, res, { ok: true }, PRIVATE);
      })
    )
    .add('GET', '/api/auth/me', (req, res) => sendJson(req, res, profile(auth.requireAccount(req)), PRIVATE))
    .add(
      'POST',
      '/api/auth/password',
      sameOriginOnly(async (req, res) => {
        const account = auth.requireAccount(req);
        const { current, password } = await readJson(req);
        if (typeof current !== 'string' || current.length > 200) throw new HttpError(403, 'Mot de passe actuel incorrect.');
        const valid = await guarded(req, account.email, () => auth.checkCredentials(account.email, current));
        if (!valid) throw new HttpError(403, 'Mot de passe actuel incorrect.');
        await auth.changePassword(req, account, password);
        return sendJson(req, res, { ok: true }, PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/auth/invite',
      sameOriginOnly(async (req, res) => {
        const { token, email, password } = await readJson(req);
        const account = await auth.acceptInvite(token, email, password);
        auth.startSession(req, res, account.id);
        return sendJson(req, res, profile(account), PRIVATE);
      })
    )
    .add(
      'POST',
      '/api/auth/reset',
      sameOriginOnly(async (req, res) => {
        const { token, password } = await readJson(req);
        const account = await auth.acceptReset(token, password);
        auth.startSession(req, res, account.id);
        return sendJson(req, res, profile(account), PRIVATE);
      })
    );
}
