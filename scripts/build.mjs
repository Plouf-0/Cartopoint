#!/usr/bin/env node
/**
 * Construit la version autonome de l'application : un seul fichier HTML contenant
 * le CSS, le JavaScript et le plan d'exemple. Ce fichier fonctionne :
 *   - hébergé sur un serveur (avec project.json à côté) ;
 *   - ouvert directement depuis l'ordinateur (double-clic), sans connexion.
 *
 *   npm run build                                   → dist/index.html
 *   node scripts/build.mjs --embed data/project.json --out "dist/Mon projet.html"
 *                                                   → fichier autonome contenant un projet
 */
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
const out = path.resolve(root, args.out || 'dist/index.html');

const { outputFiles } = await build({
  entryPoints: [path.join(src, 'js/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2022', 'chrome100', 'firefox100', 'safari15.4'],
  write: false,
  legalComments: 'none',
  charset: 'utf8'
});
// Dans un <script> en ligne, « </script » fermerait la balise : on l'échappe.
const js = outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await fs.readFile(path.join(src, 'css/app.css'), 'utf8');
let html = await fs.readFile(path.join(src, 'index.html'), 'utf8');

const replaceOnce = (from, to) => {
  if (!html.includes(from)) throw new Error('motif introuvable dans index.html : ' + from);
  html = html.replace(from, () => to);
};

replaceOnce('<link rel="stylesheet" href="css/app.css">', `<style>\n${css}</style>`);
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
