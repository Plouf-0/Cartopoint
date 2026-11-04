/**
 * La version de cette page (EV-42, EV-44) : son numéro et son commit, gravés à la construction. C'est donc celle que ce navigateur a vraiment, y compris une page
 * gardée par le service worker, et non la dernière du serveur. « dev » : une page servie directement depuis src/, sans construction.
 */
export const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;

if (typeof document !== 'undefined') {
  const label = document.createElement('small');
  label.id = 'appVersion';
  label.className = 'app-version';
  label.textContent = `version ${APP_VERSION}`;
  document.body.append(label);
}
