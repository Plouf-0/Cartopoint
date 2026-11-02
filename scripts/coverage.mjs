#!/usr/bin/env node
/**
 * Lance les tests, mesure leur couverture et échoue sous les seuils.
 *
 *   npm run test:coverage
 *
 * Le résumé de `node --test` ne compte que les fichiers chargés par les tests, ce qui embellit le
 * chiffre : ici, un fichier qu'aucun test ne charge compte pour 0 % de ses lignes. Pour un tel
 * fichier, les branches et les fonctions restent inconnues : seul le chiffre des lignes le voit.
 *
 * Les lignes additionnent ce que voient Node et Chromium (tests de parcours, voir browser-coverage.mjs).
 * Les branches et les fonctions ne viennent que de Node.
 *
 * Les seuils ne font que monter (voir docs/FEUILLE_DE_ROUTE.md, section 11).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const GROUPS = [
  { name: 'Serveur', dir: 'server', files: /\.mjs$/, min: { lines: 95, branches: 90, functions: 95 } },
  { name: 'Navigateur', dir: 'src/js', files: /\.js$/, min: { lines: 30, branches: 81, functions: 49 } }
];

const listFiles = (dir, pattern) =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => pattern.test(name))
    .map((name) => path.join(dir, name).replaceAll(path.sep, '/'));

/** { chemin : { lines: [couvertes, total], branches: […], functions: […], hit: lignes couvertes } } d'après un fichier LCOV. */
function parseLcov(text) {
  const report = {};
  let current;
  for (const line of text.split('\n')) {
    const [key, value] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)];
    if (key === 'SF') current = report[value] = { lines: [0, 0], branches: [0, 0], functions: [0, 0], hit: new Set() };
    if (key === 'DA' && !value.endsWith(',0')) current.hit.add(Number(value.split(',')[0]));
    if (key === 'LF') current.lines[1] = Number(value);
    if (key === 'BRH') current.branches[0] = Number(value);
    if (key === 'BRF') current.branches[1] = Number(value);
    if (key === 'FNH') current.functions[0] = Number(value);
    if (key === 'FNF') current.functions[1] = Number(value);
  }
  return report;
}

/** Ajoute les lignes vues dans le navigateur à celles vues par Node. */
function addBrowserCoverage(report, dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    for (const [file, { total, covered }] of Object.entries(JSON.parse(readFileSync(path.join(dir, name), 'utf8')))) {
      const entry = (report[file] ??= { lines: [0, total], branches: [0, 0], functions: [0, 0], hit: new Set() });
      for (const line of covered) entry.hit.add(line);
    }
  }
}

const percent = ([hit, total]) => (total ? (100 * hit) / total : 100);
const show = (pair) => (pair[1] ? percent(pair).toFixed(1) : '—').padStart(6);

const work = mkdtempSync(path.join(tmpdir(), 'ib-coverage-'));
const lcovFile = path.join(work, 'lcov.info');
const browserDir = path.join(work, 'navigateur');
const run = spawnSync(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-exclude=tests/**',
    '--test-reporter=lcov',
    `--test-reporter-destination=${lcovFile}`,
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    ...listFiles('tests', /\.test\.js$/)
  ],
  { stdio: 'inherit', env: { ...process.env, BROWSER_COVERAGE_DIR: browserDir } }
);
const report = parseLcov(readFileSync(lcovFile, 'utf8'));
addBrowserCoverage(report, browserDir);
for (const entry of Object.values(report)) entry.lines[0] = entry.hit.size;
rmSync(work, { recursive: true, force: true });

let failed = run.status !== 0;
for (const group of GROUPS) {
  const totals = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
  const rows = [];
  for (const file of listFiles(group.dir, group.files)) {
    const entry = report[file] ?? { lines: [0, readFileSync(file, 'utf8').split('\n').length], branches: [0, 0], functions: [0, 0], never: true };
    for (const kind of Object.keys(totals)) {
      totals[kind][0] += entry[kind][0];
      totals[kind][1] += entry[kind][1];
    }
    rows.push({ file, ...entry });
  }
  console.log(`\n${group.name}\n  lignes  branches  fonctions  fichier`);
  for (const row of rows.sort((a, b) => percent(a.lines) - percent(b.lines))) {
    console.log(`  ${show(row.lines)}  ${show(row.branches)}    ${show(row.functions)}  ${row.file}${row.never ? '  (jamais chargé)' : ''}`);
  }
  console.log(`  ${show(totals.lines)}  ${show(totals.branches)}    ${show(totals.functions)}  TOTAL (${rows.length} fichiers)`);
  for (const [kind, minimum] of Object.entries(group.min)) {
    if (percent(totals[kind]) < minimum) {
      console.error(`  ✖ ${group.name} : ${kind} à ${percent(totals[kind]).toFixed(1)} %, seuil de ${minimum} %`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
