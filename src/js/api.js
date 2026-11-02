/**
 * Petit client de l'API : JSON à l'aller et au retour. Les erreurs portent le message du serveur,
 * écrit pour être montré tel quel.
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body) {
  let response;
  try {
    response = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'Le serveur ne répond pas. Vérifiez la connexion.');
  }
  const text = await response.text();
  if (!response.ok) throw new ApiError(response.status, text);
  return JSON.parse(text);
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
