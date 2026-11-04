#!/usr/bin/env node
/**
 * Construit l'application. index.html est la version autonome : un seul fichier HTML contenant
 * le CSS, le JavaScript, les polices et le plan d'exemple. Ce fichier fonctionne :
 *   - hébergé sur un serveur (avec project.json à côté) ;
 *   - ouvert directement depuis l'ordinateur (double-clic), sans connexion.
 * Les pages des espaces (enseignant, admin, liens) sont aussi d'un seul tenant, chacune avec son seul code. Elles trouvent leurs
 * polices dans assets/fonts/, à côté d'elles, et le service worker de la page élève dans sw.js. secours.html est la base du fichier de secours d'un cours.
 *
 *   npm run build                                   → dist/index.html et les pages des espaces
 *   node scripts/build.mjs --outdir autre/dossier   → la même chose ailleurs
 *   node scripts/build.mjs --embed data/project.json --out "dist/Mon projet.html"
 *                                                   → fichier autonome contenant un projet
 *
 * La version affichée sur chaque page est le numéro de package.json puis le commit, suivi de « + » s'il reste des modifications : 1.0.0 (f401778).
 * APP_VERSION donne le commit quand git n'est pas là, comme dans une image Docker : docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) .
 */
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
const outDir = path.resolve(root, args.outdir || 'dist');
const out = args.out ? path.resolve(root, args.out) : path.join(outDir, 'index.html');
const SPACE_PAGES = ['prof.html', 'prof-cours.html', 'prof-lancement.html', 'admin.html', 'compte.html', 'accueil.html', 'eleve.html'];

function commitLabel() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const git = (...command) => spawnSync('git', command, { cwd: root, encoding: 'utf8' });
  const commit = git('rev-parse', '--short', 'HEAD');
  if (commit.status !== 0) return 'inconnue';
  return commit.stdout.trim() + (git('status', '--porcelain').stdout.trim() ? '+' : '');
}
const { version: number } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = `${number} (${commitLabel()})`;

/** @param fallback le fichier de secours : sans aucun lien avec un serveur (voir project-io.js) */
async function bundle(entry, { fallback = false } = {}) {
  const { outputFiles } = await build({
    entryPoints: [path.join(src, entry)],
    bundle: true,
    format: 'iife',
    target: ['es2022', 'chrome100', 'firefox100', 'safari15.4'],
    write: false,
    legalComments: 'none',
    charset: 'utf8',
    define: { __APP_VERSION__: JSON.stringify(version), __FALLBACK__: String(fallback) }
  });
  // Dans un <script> en ligne, « </script » fermerait la balise : on l'échappe.
  return outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

const js = await bundle('js/main.js');
const css = await fs.readFile(path.join(src, 'css/app.css'), 'utf8');
let html = await fs.readFile(path.join(src, 'index.html'), 'utf8');

const replaceOnce = (from, to) => {
  if (!html.includes(from)) throw new Error('motif introuvable dans index.html : ' + from);
  html = html.replace(from, () => to);
};

/** Un fichier ouvert d'un double-clic n'a pas de serveur pour lui fournir ses polices : elles entrent dans la page (HOR-05). */
async function withEmbeddedFonts(text) {
  let embedded = text;
  for (const [reference, name] of text.matchAll(/\/assets\/fonts\/([\w-]+\.woff2)/g)) {
    const font = await fs.readFile(path.join(src, 'assets/fonts', name));
    embedded = embedded.replace(reference, `data:font/woff2;base64,${font.toString('base64')}`);
  }
  return embedded;
}
const standaloneCss = await withEmbeddedFonts(css);
replaceOnce('<link rel="stylesheet" href="css/app.css">', `<style>\n${standaloneCss}</style>`);
replaceOnce('<script type="module" src="js/main.js"></script>', `<script>\n${js}</script>`);

const mapPath = html.match(/<meta name="default-map" content="([^"]+)">/)[1];
const mapData = (await fs.readFile(path.join(src, mapPath))).toString('base64');
replaceOnce(`content="${mapPath}"`, `content="data:image/jpeg;base64,${mapData}"`);

if (args.embed) {
  const { projectFromText, normalizeProject } = await import('../src/js/model.js');
  const raw = projectFromText(await fs.readFile(path.resolve(root, args.embed), 'utf8'));
  const project = normalizeProject(raw); // vérifie le format et convertit les anciennes versions
  const json = JSON.stringify(project).replace(/</g, '\\u003c');
  replaceOnce('<script id="embedded-project" type="application/json">null</script>', `<script id="embedded-project" type="application/json">${json}</script>`);
}

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, html);
console.log(`✓ ${path.relative(root, out)} (${(html.length / 1e6).toFixed(2)} Mo)`);

if (!args.out) {
  // La base du fichier de secours d'un cours (prof/fallback-file.js) : la même page, mais qui ne cherche aucun serveur
  const fallbackJs = await bundle('js/main.js', { fallback: true });
  await fs.writeFile(
    path.join(outDir, 'secours.html'),
    html.replace(js, () => fallbackJs)
  );
  await fs.cp(path.join(src, 'assets/fonts'), path.join(outDir, 'assets/fonts'), { recursive: true });
  await fs.copyFile(path.join(src, 'sw.js'), path.join(outDir, 'sw.js'));
  for (const page of SPACE_PAGES) {
    let source = await fs.readFile(path.join(src, page), 'utf8');
    const entry = source.match(/<script type="module" src="\/([^"]+)"><\/script>/);
    const pageJs = await bundle(entry[1]);
    source = source.replace(entry[0], () => `<script>\n${pageJs}</script>`);
    source = source.replace('<link rel="stylesheet" href="/css/app.css">', () => `<style>\n${css}</style>`);
    await fs.writeFile(path.join(outDir, page), source);
    console.log(`✓ ${path.relative(root, path.join(outDir, page))} (${(source.length / 1e3).toFixed(0)} Ko)`);
  }
}
