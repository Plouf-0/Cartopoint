/**
 * Parcours dans un vrai navigateur (Chromium, avec Playwright). L'application tourne dans le processus
 * du test, avec ses propres données, et sert src/ : les fichiers restent séparés et la couverture du
 * navigateur peut les désigner. Tout écran ouvert par openPage() y contribue.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import * as playwright from 'playwright';
import { summarize } from '../../scripts/browser-coverage.mjs';
import { createApp } from '../../server/app.mjs';
import { ensureAdmin } from '../../server/auth.mjs';
import { tempDir } from '../helpers.js';

export const ADMIN = { email: 'admin@example.org', password: 'mot-de-passe-admin' };

/**
 * Chromium par défaut. E2E_BROWSER=webkit ou firefox essaie un autre moteur, faute de pouvoir essayer sur chaque appareil. La couverture et le
 * vidage du cache HTTP n'existent que dans Chromium.
 */
export const ENGINE = process.env.E2E_BROWSER ?? 'chromium';
const IS_CHROMIUM = ENGINE === 'chromium';
export const launchBrowser = () => playwright[ENGINE].launch();

/** Une vraie image PNG, que le navigateur sait décoder. */
export function makePng(width, height, { pad = 0 } = {}) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    ...(pad ? [chunk('tEXt', Buffer.alloc(pad, 0x61))] : []),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Démarre un site neuf, avec son admin. `root` pour servir autre chose que src/. */
export async function startSite(t, { root = path.resolve('src') } = {}) {
  const log = t.mock.method(console, 'log', () => {});
  const data = await tempDir(t);
  const app = createApp({ root, data });
  await ensureAdmin(app.db, ADMIN);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return { app, db: app.db, data, log, base: `http://127.0.0.1:${app.server.address().port}` };
}

/** Une page dans un navigateur vierge : sans cookie, comme une autre personne sur un autre appareil. */
export async function openPage(t, browser, { base, permissions = [], viewport = { width: 1280, height: 800 }, touch = false, expectErrors = false } = {}) {
  const context = await browser.newContext({
    baseURL: base,
    permissions,
    viewport,
    locale: 'fr-FR',
    // Une heure affichée se compare telle quelle, sur le serveur comme sur le laptop
    timezoneId: 'Europe/Paris',
    hasTouch: touch,
    ...(ENGINE === 'firefox' ? {} : { isMobile: touch })
  });
  context.setDefaultTimeout(5000);
  const page = await context.newPage();
  // Une erreur JavaScript fait toujours échouer le test, même si l'écran a l'air correct
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (IS_CHROMIUM) await page.coverage.startJSCoverage({ resetOnNavigation: false });
  t.after(async () => {
    const entries = IS_CHROMIUM ? await page.coverage.stopJSCoverage() : [];
    if (IS_CHROMIUM && process.env.BROWSER_COVERAGE_DIR) {
      await mkdir(process.env.BROWSER_COVERAGE_DIR, { recursive: true });
      await writeFile(path.join(process.env.BROWSER_COVERAGE_DIR, randomUUID() + '.json'), JSON.stringify(summarize(entries)));
    }
    await context.close();
    if (errors.length && !expectErrors) throw new Error('Erreurs JavaScript dans la page : ' + errors.join(' | '));
  });
  return page;
}

export async function logIn(page, { email, password }, target) {
  await page.goto(target);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

export const see = (page, text) => page.getByText(text, { exact: false }).first().waitFor();
export const heading = (page, name) => page.getByRole('heading', { name }).waitFor();
