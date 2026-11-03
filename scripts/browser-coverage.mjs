/**
 * Convertit la couverture que Chromium donne à Playwright (au format de V8, par caractère) en lignes
 * couvertes, par fichier de src/. Les tests de parcours écrivent ce résultat dans BROWSER_COVERAGE_DIR,
 * et scripts/coverage.mjs l'ajoute à celle de Node.
 *
 * Seules les pages servies depuis src/ sont vues ainsi : une page construite n'a plus de fichiers séparés.
 */

/** Les lignes d'un fichier. Celle qui suit le dernier retour à la ligne n'en est pas une : Node ne la compte pas non plus. */
export function sourceLines(source) {
  const lines = source.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

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
  const lines = sourceLines(source);
  lines.forEach((line, index) => {
    const end = start + line.length;
    const blank = !line.trim();
    if (blank ? executed[Math.min(start, source.length - 1)] : executed.subarray(start, end).some(Boolean)) covered.push(index + 1);
    start = end + 1;
  });
  return { total: lines.length, covered };
}

/**
 * Les fonctions du fichier, repérées par leur position : `true` si elle a été appelée. La plage qui couvre tout le
 * fichier n'en est pas une. V8 ne voit pas les fonctions imbriquées dans une fonction jamais appelée : le total est
 * donc un minimum.
 */
export function calledFunctions(source, functions) {
  const called = {};
  for (const { ranges } of functions) {
    const [{ startOffset, endOffset, count }] = ranges;
    if (startOffset === 0 && endOffset >= source.length) continue;
    called[startOffset] = count > 0;
  }
  return called;
}

/** { 'src/js/api.js': { total, covered, functions } } d'après les entrées de page.coverage, sans les autres scripts. */
export function summarize(entries) {
  const files = {};
  for (const { url, source, functions } of entries) {
    const { pathname } = new URL(url);
    if (!pathname.startsWith('/js/') || pathname.startsWith('/js/vendor/') || !source) continue;
    const { total, covered } = coveredLines(source, functions);
    const file = (files['src' + pathname] ??= { total, covered: [], functions: {} });
    file.covered = [...new Set([...file.covered, ...covered])];
    mergeCalled(file.functions, calledFunctions(source, functions));
  }
  return files;
}

/** Une fonction est appelée si elle l'a été une seule fois, dans n'importe quel test. */
export function mergeCalled(target, called) {
  for (const [offset, value] of Object.entries(called)) target[offset] ||= value;
  return target;
}
