/** Durées et dates du serveur. */
export const DAY = 24 * 60 * 60 * 1000;

export const iso = (ms = Date.now()) => new Date(ms).toISOString();
