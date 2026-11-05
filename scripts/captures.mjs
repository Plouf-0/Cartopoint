#!/usr/bin/env node
/**
 * Refait les captures du guide (docs/images/), sur un site temporaire et avec des données entièrement inventées : le dépôt est public, et
 * aucune capture ne doit venir du vrai site. Toute image ajoutée passe aussi par la liste de tests/repo.test.js.
 *
 *   npm run build && npm run captures
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';
import { ensureAdmin } from '../server/auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/images');
const ADMIN = { email: 'admin@example.org', password: 'mot-de-passe-admin' };
const TEACHER = { email: 'enseignant@example.org', password: 'mot-de-passe-enseignant' };
const PHONE = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1200, height: 760 } };
const OTHER_STUDENTS = ['Tom Martin', 'Inès Bernard', 'Noé Petit'];

/** Des fiches inventées, avec une photo dessinée à la volée. */
const FICHES = [
  { id: 'f1', common: 'Noisetier', species: 'Corylus avellana', refX: 24, refY: 34, color: '#7d9b5c' },
  { id: 'f2', common: 'Sureau', species: 'Sambucus nigra', refX: 58, refY: 26, color: '#4f7f6b' },
  { id: 'f3', common: 'Tilleul', species: 'Tilia cordata', refX: 72, refY: 62, color: '#a3a84f' },
  { id: 'f4', common: 'Érable', species: 'Acer campestre', refX: 36, refY: 70, color: '#b2743f' }
];

const data = mkdtempSync(path.join(tmpdir(), 'cartopoint-captures-'));
const app = createApp({ root: path.join(ROOT, 'dist'), data, correctionDelay: 0 });
await ensureAdmin(app.db, ADMIN);
await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://localhost:${app.server.address().port}`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function open(options) {
  const context = await browser.newContext({ baseURL: base, locale: 'fr-FR', timezoneId: 'Europe/Paris', ...options });
  context.setDefaultTimeout(15000);
  return context.newPage();
}
// Sans le numéro de version, qui vieillirait, ni le message passager, qui cacherait une partie de l'écran
const shot = (page, name, options = {}) =>
  page.screenshot({ path: path.join(OUT, `${name}.png`), style: '.app-version, #toast { display: none !important; }', ...options });

async function prepareTeacher(link) {
  const page = await open(DESKTOP);
  await page.goto(link);
  await page.getByLabel('Adresse e-mail').fill(TEACHER.email);
  await page.getByLabel('Nouveau mot de passe').fill(TEACHER.password);
  await page.getByLabel('Le même, une seconde fois').fill(TEACHER.password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('heading', { name: 'Mes cours' }).waitFor();
  return page;
}

/** Le cours, déposé directement : c'est son allure à l'écran qui compte ici, pas sa saisie. */
async function createCourse(page) {
  const plan = readFileSync(path.join(ROOT, 'src/assets/plan-exemple.jpg')).toString('base64');
  return page.evaluate(
    async ({ plan, fiches }) => {
      const upload = async (blob) => {
        const response = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        return (await response.json()).url;
      };
      const drawPhoto = (color) =>
        new Promise((resolve) => {
          const canvas = Object.assign(document.createElement('canvas'), { width: 480, height: 320 });
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 480, 320);
          ctx.fillStyle = 'rgba(255,255,255,.28)';
          for (const [x, y, r] of [
            [240, 150, 95],
            [150, 190, 70],
            [330, 190, 70]
          ]) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 7);
            ctx.fill();
          }
          canvas.toBlob(resolve, 'image/jpeg', 0.8);
        });
      const planBytes = Uint8Array.from(atob(plan), (char) => char.charCodeAt(0));
      const image = await upload(new Blob([planBytes], { type: 'image/jpeg' }));
      const withPhotos = [];
      for (const { color, ...fiche } of fiches) {
        const data = await upload(await drawPhoto(color));
        withPhotos.push({ ...fiche, visible: true, media: [{ id: `p-${fiche.id}`, type: 'image', name: `${fiche.common}.jpg`, data }] });
      }
      const draft = {
        format: 'inventaire-botanique',
        version: 3,
        title: 'Sortie au parc',
        theme: {},
        maps: [{ id: 'm1', name: 'Le parc', image, widthMeters: 120, fiches: withPhotos }]
      };
      const response = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }) });
      return response.json();
    },
    { plan, fiches: FICHES }
  );
}

/** Touche le plan à une position en %, en le ramenant d'abord à l'écran : sur téléphone, il peut être remonté hors de la vue. */
async function tapPlan(page, x, y) {
  const plan = page.locator('#plan');
  await plan.scrollIntoViewIfNeeded();
  const box = await plan.boundingBox();
  await page.mouse.click(box.x + (box.width * x) / 100, box.y + (box.height * y) / 100);
}

/** Une place proche de la vraie position, pour que le résultat ressemble à une vraie classe. */
async function place(page, index, fiche, shift) {
  await page.locator('[data-place]').first().click();
  await page.locator('#placeHint').waitFor();
  await tapPlan(page, fiche.refX + shift, fiche.refY + shift);
  await page.locator('.pin').nth(index).waitFor();
}

async function handInForOthers(code) {
  for (const [rank, names] of OTHER_STUDENTS.entries()) {
    const join = await fetch(`${base}/api/join/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ names })
    });
    const { token } = await join.json();
    // Le dernier de la liste n'a jamais rendu : c'est aussi ce que l'enseignant doit pouvoir voir
    if (rank === OTHER_STUDENTS.length - 1) continue;
    const answers = Object.fromEntries(
      FICHES.map((fiche, index) => [
        fiche.id,
        {
          x: fiche.refX + (rank + 1) * (index + 1),
          y: fiche.refY + rank + 1,
          temperature: String(18 + index),
          humidity: String(50 + rank * 5),
          light: String(900 + index * 40)
        }
      ])
    );
    await fetch(`${base}/api/student/answers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ answers: { m1: answers } })
    });
  }
}

try {
  const admin = await open(DESKTOP);
  await admin.goto('/admin');
  await admin.getByLabel('Adresse e-mail').fill(ADMIN.email);
  await admin.getByLabel('Mot de passe', { exact: true }).fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Se connecter' }).click();
  await admin.getByRole('heading', { name: 'Inviter un enseignant' }).waitFor();
  await admin.getByRole('button', { name: 'Créer un lien de création de compte' }).click();
  const link = await admin.getByLabel('Lien à transmettre').inputValue();

  const teacher = await prepareTeacher(link);
  const course = await createCourse(teacher);

  await teacher.goto('/prof');
  await teacher.locator('.course-row').waitFor();
  await shot(teacher, 'mes-cours');

  await teacher.goto(`/prof/cours/${course.id}`);
  await teacher.locator('.row').first().waitFor();
  await teacher.waitForFunction(() => document.querySelector('#plan')?.naturalWidth > 0);
  await shot(teacher, 'cours-fiches');

  await teacher.getByRole('tab', { name: 'Cours' }).click();
  await teacher.locator('#publishBtn').click();
  await teacher.locator('#publishState').filter({ hasText: 'Version 1, publiée le' }).waitFor();
  await shot(teacher, 'cours-publier');

  await teacher.getByRole('button', { name: 'Lancer le cours' }).click();
  await teacher.getByRole('heading', { name: 'Pour rejoindre le cours' }).waitFor();
  const code = (await teacher.locator('.launch-code').first().textContent()).trim();

  const home = await open(PHONE);
  await home.goto('/');
  await home.getByLabel('Code du cours').fill(code);
  await shot(home, 'accueil');

  const student = await open(PHONE);
  await student.goto(`/c/${code}`);
  await student.getByLabel(/Votre prénom et votre nom/).fill('Léa Dupont');
  await shot(student, 'eleve-nom');
  await student.getByRole('button', { name: 'Commencer' }).click();
  await student.locator('#offlineStatus', { hasText: '✓ Prêt pour le terrain' }).waitFor();
  await student.locator('.label').first().waitFor();
  await place(student, 0, FICHES[0], 1);
  await place(student, 1, FICHES[1], -3);
  await student.locator('[data-place]').first().click();
  await student.locator('#placeHint').waitFor();
  await student.locator('#plan').scrollIntoViewIfNeeded();
  await shot(student, 'eleve-placer', { fullPage: true });

  await tapPlan(student, FICHES[2].refX, FICHES[2].refY);
  await student.locator('.pin').nth(2).waitFor();
  await place(student, 3, FICHES[3], 5);
  for (const [measure, value] of [
    ['temperature', '21'],
    ['humidity', '55'],
    ['light', '950']
  ]) {
    await student.locator(`[data-measure="${measure}"]`).first().fill(value);
  }
  await student.waitForTimeout(400);
  student.once('dialog', (dialog) => dialog.accept());
  await student.getByRole('button', { name: 'Terminer', exact: true }).click();
  await student.locator('.panel-foot').getByText('Vos réponses sont bien arrivées').waitFor();
  await shot(student, 'eleve-termine', { fullPage: true });

  await handInForOthers(code);
  await teacher.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await teacher.getByText('A fini', { exact: true }).first().waitFor();
  await shot(teacher, 'lancement-suivi', { fullPage: true });

  await teacher.getByRole('button', { name: 'Afficher le QR code' }).click();
  await teacher.locator('.qr-box svg').waitFor();
  await shot(teacher, 'lancement-qr');
  await teacher.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).click();

  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: 'Terminer le cours' }).click();
  await teacher.getByText(/^Terminé le /).waitFor();
  await teacher.getByRole('button', { name: 'Tout télécharger (JPG)' }).waitFor();
  await shot(teacher, 'resultats', { fullPage: true });

  await student.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await student.locator('#seeCorrection').waitFor({ timeout: 30000 });
  await student.locator('#seeCorrection').click();
  await student.locator('#correctionBox').getByText('cours du').waitFor();
  await shot(student, 'eleve-correction');

  const saved = teacher.waitForEvent('download');
  await teacher.locator('.participants li', { hasText: 'Léa Dupont' }).getByRole('button', { name: 'JPG' }).click();
  await (await saved).saveAs(path.join(OUT, 'compte-rendu.jpg'));

  await admin.reload();
  await admin.getByRole('heading', { name: 'Inviter un enseignant' }).waitFor();
  await shot(admin, 'admin', { fullPage: true });
  console.log(`✓ captures dans ${path.relative(ROOT, OUT)}`);
} finally {
  await browser.close();
  await app.close();
  rmSync(data, { recursive: true, force: true });
}
