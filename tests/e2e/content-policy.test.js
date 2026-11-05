/**
 * SEC-06, dans un vrai navigateur et sur les pages construites : leur code tourne, ce qu'on y injecte non.
 * Tous les tests de bout en bout échouent aussi au moindre blocage (openPage).
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tempDir } from '../helpers.js';
import { ADMIN, heading, launchBrowser, logIn, openPage, startSite } from './helpers.js';

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

test('SEC-06 : le code de la page tourne, un script injecté est refusé', async (t) => {
  const out = await tempDir(t);
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', out], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const site = await startSite(t, { root: out });

  const page = await openPage(t, browser, { base: site.base, expectErrors: true });
  await logIn(page, ADMIN, '/admin');
  await heading(page, 'Inviter un enseignant');

  const refused = [];
  page.on('console', (message) => {
    if (/Content.Security.Policy/i.test(message.text())) refused.push(message.text());
  });
  const ran = await page.evaluate(async () => {
    const box = document.createElement('div');
    box.innerHTML = '<img src="/absent.png" onerror="window.__injecte = 1">';
    document.body.append(box);
    const script = document.createElement('script');
    script.textContent = 'window.__injecte = 2';
    document.body.append(script);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return window.__injecte ?? null;
  });
  assert.equal(ran, null, 'aucun des deux scripts n’a tourné');
  assert.ok(refused.length >= 2, 'le navigateur a bien refusé les deux');
});
