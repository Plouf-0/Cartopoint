/**
 * Rafraîchissement de l'écran.
 *
 * Chaque zone (en-tête, carte, panneau) s'inscrit avec `onRender()` au démarrage.
 * Après une modification, appelez `render()` : tout est redessiné à partir de `S`.
 * Ce schéma simple évite les dépendances circulaires entre les vues.
 */
const parts = [];

export function onRender(fn) {
  parts.push(fn);
}

export function render() {
  for (const fn of parts) fn();
}
