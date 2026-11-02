/**
 * Convertit la couverture que Chromium donne à Playwright (au format de V8, par caractère) en lignes
 * couvertes, par fichier de src/. Les tests de parcours écrivent ce résultat dans BROWSER_COVERAGE_DIR,
 * et scripts/coverage.mjs l'ajoute à celle de Node.
 *
 * Seules les pages servies depuis src/ sont vues ainsi : une page construite n'a plus de fichiers séparés.
 */

/**
 * Numéros des lignes couvertes. Une ligne ne l'est pas si tout son contenu est dans une plage jamais
 * exécutée. Comme V8 imbrique ses plages, la plus précise, appliquée en dernier, l'emporte.
 */
export function coveredLines(source, functions) {
  const ranges = functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const executed = new Uint8Array(source.length);
  for (const { startOffset, endOffset, count } of ranges) executed.fill(count > 0 ? 1 : 0, startOffset, endOffset);

  const covered = [];
  let start = 0;
  source.split('\n').forEach((line, index) => {
    const end = start + line.length;
    const blank = !line.trim();
    if (blank ? executed[Math.min(start, source.length - 1)] : executed.subarray(start, end).some(Boolean)) covered.push(index + 1);
    start = end + 1;
  });
  return { total: source.split('\n').length, covered };
}

/** { 'src/js/api.js': { total, covered } } d'après les entrées de page.coverage, sans les autres scripts. */
export function summarize(entries) {
  const files = {};
  for (const { url, source, functions } of entries) {
    const { pathname } = new URL(url);
    if (!pathname.startsWith('/js/') || !source) continue;
    const { total, covered } = coveredLines(source, functions);
    const file = (files['src' + pathname] ??= { total, covered: [] });
    file.covered = [...new Set([...file.covered, ...covered])];
  }
  return files;
}
