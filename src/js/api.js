/**
 * Petit client de l'API : JSON à l'aller et au retour. Les erreurs portent le message du serveur,
 * écrit pour être montré tel quel.
 */
import { reportIncident, sendWaiting } from './incident.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(path, options) {
  let response;
  try {
    response = await fetch('/api' + path, options);
  } catch {
    // Une lecture ratée n'a rien d'anormal sur le terrain. Une écriture perdue alors que le réseau semble là, si
    if (options.method !== 'GET' && navigator.onLine) reportIncident('Serveur injoignable', `${options.method} ${path}`);
    throw new ApiError(0, 'Le serveur ne répond pas. Vérifiez la connexion.');
  }
  // Le serveur répond : un téléphone qui se croyait déjà en ligne n'annoncera jamais le retour du réseau
  sendWaiting();
  const text = await response.text();
  if (response.status >= 500 || response.status === 413)
    reportIncident('Réponse du serveur', `${options.method} ${path} : ${response.status} ${text.slice(0, 200)}`);
  // Un proxy peut répondre sans aucun texte : le message reste lisible
  if (!response.ok) throw new ApiError(response.status, text || `Le serveur a répondu ${response.status}.`);
  return JSON.parse(text);
}

/** `token` : le jeton d'un élève, dans un en-tête pour qu'il n'apparaisse dans aucun journal. */
export function api(method, path, body, token) {
  return call(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

/** Envoie un fichier. Renvoie `{ url, size }`. */
export function uploadFile(blob) {
  return call('/media', { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
}

/** Le compte connecté, ou null. */
export async function currentAccount() {
  try {
    return await api('GET', '/auth/me');
  } catch (e) {
    if (e.status === 401) return null;
    throw e;
  }
}
