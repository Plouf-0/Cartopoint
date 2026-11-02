/**
 * EV-34 : le site est générique. Seuls restent les noms techniques qu'attendent les fichiers et les navigateurs
 * existants, et ce que l'application d'origine envoie au service d'identification, qui reste botanique.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'src');
const BOTANICAL = /botani|inventaire|la plante|espèce/i;
const KEPT = {
  'js/db.js': /./,
  'js/ai.js': /./,
  'js/model.js': /FORMAT = |fichiers « Inventaire/,
  'js/spreadsheet.js': /famille botanique/
};

const sources = readdirSync(SRC, { recursive: true })
  .map((file) => file.split(path.sep).join('/'))
  .filter((file) => /\.(html|js|css)$/.test(file) && !file.startsWith('js/vendor/'));

test('EV-34 : aucun texte du site ne parle encore de botanique', () => {
  assert.ok(sources.includes('prof-cours.html') && sources.includes('js/views/reader.js'), 'les sources sont bien lues');
  const found = sources.flatMap((file) =>
    readFileSync(path.join(SRC, file), 'utf8')
      .split('\n')
      .filter((line) => BOTANICAL.test(line) && !KEPT[file]?.test(line))
      .map((line) => `${file} : ${line.trim()}`)
  );
  assert.deepEqual(found, []);
});
