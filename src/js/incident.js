/**
 * Signale au serveur ce qui échoue chez quelqu'un (INC-01), avec la machine qui l'a vu : l'admin n'a plus à le demander. Une erreur du
 * programme, un message d'erreur affiché, ou un appel au serveur raté arrivent ici tout seuls ; le reste passe par reportIncident().
 *
 * Jamais de nom d'élève, de réponse ou de contenu de cours (INC-03) : seulement ce qui décrit la panne. Sans réseau, le message attend sur
 * l'appareil. Rien ici ne doit pouvoir gêner la page : un signalement qui échoue reste silencieux, et ne se signale pas lui-même.
 */
import { onProblem, prefs } from './util.js';
import { APP_VERSION } from './version.js';

const QUEUE_KEY = 'cartopoint.incidents';
const QUEUE_MAX = 20;
const PER_PAGE_MAX = 30;
// Des messages du navigateur, sans rapport avec le site
const NOISE = /ResizeObserver loop|^Script error\.?$/;

let reported = 0;

/** Une erreur peut être n'importe quoi : l'événement d'échec d'IndexedDB, par exemple, n'a ni nom ni message. */
export function describeError(error) {
  if (typeof error === 'string') return error;
  const inner = error?.target?.error ?? error;
  return [inner?.name, inner?.message].filter(Boolean).join(' : ') || String(inner ?? 'aucun détail');
}

/** La « signature » de la machine. La place sur le disque est ce que le navigateur estime pouvoir utiliser pour ce site. */
async function describeMachine() {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  return {
    version: APP_VERSION,
    browser: navigator.userAgent,
    language: navigator.language,
    screen: `${screen.width}×${screen.height}`,
    window: `${innerWidth}×${innerHeight}`,
    pixelRatio: devicePixelRatio,
    cores: navigator.hardwareConcurrency,
    memoryGb: navigator.deviceMemory,
    network: navigator.connection?.effectiveType,
    online: navigator.onLine,
    worker: Boolean(navigator.serviceWorker?.controller),
    storageUsed: estimate?.usage,
    storageQuota: estimate?.quota
  };
}

/** Répond true si c'est réglé. Un refus du serveur est réglé aussi : insister n'y changerait rien. */
async function deliver({ at, ...report }) {
  try {
    const response = await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, ageMs: Date.now() - at }),
      keepalive: true
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

function waiting() {
  try {
    const queue = JSON.parse(prefs.get(QUEUE_KEY, '[]'));
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

const keepForLater = (report) => prefs.set(QUEUE_KEY, JSON.stringify([...waiting(), report].slice(-QUEUE_MAX)));

/** Envoie ce qui attendait. Sans danger à répéter : sans message en attente, il ne se passe rien. */
export async function sendWaiting() {
  const queue = waiting();
  if (!queue.length) return;
  prefs.del(QUEUE_KEY);
  for (const report of queue) if (!(await deliver(report))) keepForLater(report);
}

/**
 * @param action ce que la personne faisait, en clair
 * @param error une erreur, ou le texte qui la décrit. Ne jamais y mettre de nom, de réponse ou de contenu de cours
 */
export async function reportIncident(action, error, details = error?.stack ?? '') {
  try {
    if (reported >= PER_PAGE_MAX) return;
    reported++;
    const report = { at: Date.now(), page: location.pathname, action, reason: describeError(error), details, machine: await describeMachine() };
    if (!(await deliver(report))) keepForLater(report);
  } catch {
    // Le journal ne doit jamais ajouter de panne à la panne
  }
}

// Hors d'un navigateur, dans un test, il n'y a rien à écouter
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (NOISE.test(event.message)) return;
    if (event.filename && !event.filename.startsWith(location.origin)) return; // une extension du navigateur, pas le site
    reportIncident('Erreur du programme', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => reportIncident('Erreur du programme', event.reason));
  onProblem((message) => reportIncident('Message affiché', message, ''));
  window.addEventListener('online', sendWaiting);
  sendWaiting();
}
