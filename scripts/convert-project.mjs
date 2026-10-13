#!/usr/bin/env node
/**
 * Convertit un projet existant au format actuel (version 3), par exemple pour le
 * déposer sur le serveur :
 *
 *   node scripts/convert-project.mjs "Inventaire botanique 5.html" data/project.json
 *
 * Accepte : un fichier .html enregistré par l'application (toutes versions 2026)
 * ou un fichier .json de projet.
 */
import { promises as fs } from 'node:fs';
import { projectFromText, normalizeProject } from '../src/js/model.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage : node scripts/convert-project.mjs <fichier .html ou .json> <sortie .json>');
  process.exit(1);
}
const project = normalizeProject(projectFromText(await fs.readFile(input, 'utf8')));
await fs.writeFile(output, JSON.stringify(project));
const fiches = project.maps.reduce((n, m) => n + m.fiches.length, 0);
console.log(`✓ « ${project.title} » : ${project.maps.length} carte(s), ${fiches} fiche(s) → ${output}`);
