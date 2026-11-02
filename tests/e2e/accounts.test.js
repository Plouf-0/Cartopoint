/**
 * Les écrans de compte, de bout en bout, dans Chromium. Le comportement détaillé du serveur est
 * vérifié dans tests/accounts.test.js ; on vérifie ici ce que voit la personne devant son écran.
 */
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAuth } from '../../server/auth.mjs';
import { addAccount, cheapHash, tempDir } from '../helpers.js';
import { ADMIN, heading, launchBrowser, logIn, openPage, see, startSite } from './helpers.js';

const TEACHER = { email: 'prof@example.org', password: 'mot-de-passe-prof' };
const HASH = cheapHash(TEACHER.password);

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(() => browser.close());

const addTeacher = (site, email = TEACHER.email) => addAccount(site.db, { email, hash: HASH });

async function adminPage(t, site, options) {
  const page = await openPage(t, browser, { base: site.base, ...options });
  await logIn(page, ADMIN, '/admin');
  await heading(page, 'Inviter un enseignant');
  return page;
}

async function teacherPage(t, site) {
  const page = await openPage(t, browser, { base: site.base });
  await logIn(page, TEACHER, '/prof');
  await heading(page, 'Mes cours');
  return page;
}

const shownLink = (page) => page.getByLabel('Lien à transmettre').inputValue();

/** Sans tiret ni point : rien ne permet au navigateur de la couper de lui-même. */
const UNBREAKABLE_EMAIL = 'jeanpaulmartindelacroixavecunetreslongueadressesanscoupure@lyceeexemple';
const pageOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('ADM-01 : l’admin se connecte, et un mot de passe faux s’affiche dans la page', async (t) => {
  const site = await startSite(t);
  const page = await openPage(t, browser, { base: site.base });
  await logIn(page, { email: ADMIN.email, password: 'mauvais-mot-de-passe' }, '/admin');
  const alert = page.getByRole('alert');
  await alert.filter({ hasText: 'Adresse e-mail ou mot de passe incorrect.' }).waitFor();

  await page.getByLabel('Mot de passe', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await heading(page, 'Inviter un enseignant');
  await see(page, ADMIN.email);
  await see(page, 'Aucun enseignant pour le moment.');

  await page.reload();
  await heading(page, 'Inviter un enseignant');
});

test('ADM-02, ADM-03, ENS-01 : de l’invitation créée par l’admin à l’espace de l’enseignant', async (t) => {
  const site = await startSite(t);
  const admin = await adminPage(t, site, { permissions: ['clipboard-read', 'clipboard-write'] });
  await admin.getByRole('button', { name: 'Créer un lien de création de compte' }).click();
  const link = await shownLink(admin);
  assert.match(link, /\/invitation#[\w-]{43}$/);
  await see(admin, "L'application n'envoie pas d'e-mail");

  await admin.getByRole('button', { name: 'Copier le lien' }).click();
  await admin.getByRole('button', { name: 'Copié ✓' }).waitFor();
  assert.equal(await admin.evaluate(() => navigator.clipboard.readText()), link);

  const newcomer = await openPage(t, browser, { base: site.base });
  await newcomer.goto(link);
  await heading(newcomer, 'Créer mon compte enseignant');
  assert.equal(new URL(newcomer.url()).hash, '', 'le jeton ne reste pas dans la barre d’adresse');

  await newcomer.getByLabel('Adresse e-mail').fill(TEACHER.email);
  await newcomer.getByLabel('Nouveau mot de passe').fill(TEACHER.password);
  await newcomer.getByLabel('Le même, une seconde fois').fill('un-autre-mot-de-passe');
  await newcomer.getByRole('button', { name: 'Créer mon compte' }).click();
  await newcomer.getByRole('alert').filter({ hasText: 'Les deux mots de passe sont différents.' }).waitFor();

  await newcomer.getByLabel('Le même, une seconde fois').fill(TEACHER.password);
  await newcomer.getByRole('button', { name: 'Créer mon compte' }).click();
  await heading(newcomer, 'Mes cours');
  assert.equal(new URL(newcomer.url()).pathname, '/prof');
  await see(newcomer, TEACHER.email);

  await newcomer.reload();
  await heading(newcomer, 'Mes cours');

  const late = await openPage(t, browser, { base: site.base });
  await late.goto(link);
  await late.getByLabel('Adresse e-mail').fill('autre@example.org');
  await late.getByLabel('Nouveau mot de passe').fill(TEACHER.password);
  await late.getByLabel('Le même, une seconde fois').fill(TEACHER.password);
  await late.getByRole('button', { name: 'Créer mon compte' }).click();
  await late.getByRole('alert').filter({ hasText: "Ce lien n'est plus valable." }).waitFor();

  await admin.reload();
  await admin.getByRole('cell', { name: TEACHER.email }).waitFor();
  await admin.getByRole('cell', { name: 'Actif' }).waitFor();
});

test('un lien sans son jeton l’explique, au lieu d’afficher un formulaire inutile', async (t) => {
  const site = await startSite(t);
  const page = await openPage(t, browser, { base: site.base });
  for (const route of ['/invitation', '/reinitialisation']) {
    await page.goto(route);
    await heading(page, 'Lien incomplet');
  }
});

test('hors HTTPS, le navigateur refuse de copier : le lien est sélectionné, avec une explication', async (t) => {
  const site = await startSite(t);
  const admin = await adminPage(t, site);
  await admin.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
  await admin.reload();
  await admin.getByRole('button', { name: 'Créer un lien de création de compte' }).click();
  await admin.getByRole('button', { name: 'Copier le lien' }).click();
  await see(admin, 'Copie automatique impossible');
  const selected = await admin.getByLabel('Lien à transmettre').evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd));
  assert.equal(selected, await shownLink(admin));
});

test('ADM-05 : l’admin génère un lien, l’enseignant choisit un nouveau mot de passe', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const openSession = await teacherPage(t, site);
  const admin = await adminPage(t, site);
  await admin.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
  await see(admin, `Lien de réinitialisation pour ${TEACHER.email}`);
  const link = await shownLink(admin);
  assert.match(link, /\/reinitialisation#[\w-]{43}$/);

  const owner = await openPage(t, browser, { base: site.base });
  await owner.goto(link);
  await heading(owner, 'Choisir un nouveau mot de passe');
  assert.equal(new URL(owner.url()).hash, '');
  await owner.getByLabel('Nouveau mot de passe').fill('nouveau-mot-de-passe');
  await owner.getByLabel('Le même, une seconde fois').fill('nouveau-mot-de-passe');
  await owner.getByRole('button', { name: 'Enregistrer' }).click();
  await heading(owner, 'Mes cours');

  await openSession.reload();
  await heading(openSession, 'Espace enseignant');
});

test('ADM-05 : l’admin qui a perdu son mot de passe repart de son tableau de bord', async (t) => {
  const site = await startSite(t);
  const adminRow = site.db.prepare("SELECT id FROM accounts WHERE role = 'admin'").get();
  const { link } = createAuth(site.db).createReset(adminRow.id);
  const page = await openPage(t, browser, { base: site.base });
  await page.goto(link);
  await page.getByLabel('Nouveau mot de passe').fill('nouveau-mot-de-passe');
  await page.getByLabel('Le même, une seconde fois').fill('nouveau-mot-de-passe');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await heading(page, 'Inviter un enseignant');
  assert.equal(new URL(page.url()).pathname, '/admin');
});

test('ADM-06 : désactiver demande confirmation, coupe l’accès, et se répare', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const teacher = await teacherPage(t, site);
  const admin = await adminPage(t, site);

  admin.once('dialog', (dialog) => {
    assert.match(dialog.message(), /prof@example\.org[\s\S]*Ses cours sont conservés/);
    dialog.dismiss();
  });
  await admin.getByRole('button', { name: 'Désactiver' }).click();
  await admin.getByRole('cell', { name: 'Actif' }).waitFor();

  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Désactiver' }).click();
  await admin.getByRole('cell', { name: 'Désactivé' }).waitFor();
  await admin.getByRole('button', { name: 'Réactiver' }).waitFor();
  assert.equal(await admin.getByRole('button', { name: 'Réinitialiser le mot de passe' }).count(), 0, 'pas de lien pour un compte désactivé');

  await logIn(teacher, TEACHER, '/prof');
  await teacher.getByRole('alert').filter({ hasText: 'Votre compte a été désactivé.' }).waitFor();
  assert.equal(await teacher.getByRole('alert').filter({ hasText: 'incorrect' }).count(), 0, 'pas de message trompeur');

  await teacher.getByLabel('Mot de passe', { exact: true }).fill('mauvais-mot-de-passe');
  await teacher.getByRole('button', { name: 'Se connecter' }).click();
  await teacher.getByRole('alert').filter({ hasText: 'Adresse e-mail ou mot de passe incorrect.' }).waitFor();

  await admin.getByRole('button', { name: 'Réactiver' }).click();
  await admin.getByRole('cell', { name: 'Actif' }).waitFor();
  await teacher.getByLabel('Mot de passe', { exact: true }).fill(TEACHER.password);
  await teacher.getByRole('button', { name: 'Se connecter' }).click();
  await heading(teacher, 'Mes cours');
});

const DISABLED_AT = '2026-01-01T00:00:00.000Z';
const addDisabledTeacher = (site, email = TEACHER.email) => addAccount(site.db, { email, hash: HASH, disabledAt: DISABLED_AT });
const accountExists = (site, id) => Boolean(site.db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id));

const deleteButton = (page) => page.getByRole('button', { name: 'Supprimer le compte et ses cours' });
const deleteDialog = (page) => page.getByRole('dialog', { name: 'Supprimer ce compte ?' });
const wordField = (page) => page.getByLabel('Pour confirmer, recopiez le mot SUPPRIMER');
const confirmDelete = (page) => page.getByRole('button', { name: 'Supprimer définitivement' });

async function openDeleteDialog(page) {
  await deleteButton(page).click();
  await deleteDialog(page).waitFor();
}

test('ADM-10 : le bouton de suppression n’apparaît que sur un compte désactivé', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const admin = await adminPage(t, site);
  await admin.getByRole('cell', { name: 'Actif' }).waitFor();
  assert.equal(await deleteButton(admin).count(), 0, 'pas sur un compte actif');

  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Désactiver' }).click();
  await deleteButton(admin).waitFor();

  await admin.getByRole('button', { name: 'Réactiver' }).click();
  await admin.getByRole('cell', { name: 'Actif' }).waitFor();
  assert.equal(await deleteButton(admin).count(), 0, 'plus une fois réactivé');
});

test('ADM-10 : il faut recopier le mot, et renoncer ne supprime rien', async (t) => {
  const site = await startSite(t);
  const id = addDisabledTeacher(site);
  const admin = await adminPage(t, site);
  await openDeleteDialog(admin);

  const dialog = deleteDialog(admin);
  await dialog.getByText(TEACHER.email).waitFor();
  await dialog.getByText('supprimés définitivement, avec leur historique et les résultats des élèves').waitFor();
  assert.equal(await wordField(admin).evaluate((input) => input === document.activeElement), true, 'le curseur est déjà dans la case');
  assert.equal(await confirmDelete(admin).isDisabled(), true, 'bouton bloqué à l’ouverture');

  await wordField(admin).fill('SUPPRIME');
  assert.equal(await confirmDelete(admin).isDisabled(), true, 'mot incomplet');
  await wordField(admin).press('Enter');
  await dialog.waitFor();
  assert.equal(accountExists(site, id), true, 'la touche Entrée ne contourne pas le blocage');

  await wordField(admin).fill('SUPPRIMER');
  assert.equal(await confirmDelete(admin).isEnabled(), true);
  await wordField(admin).fill('');
  assert.equal(await confirmDelete(admin).isDisabled(), true, 'le bouton se rebloque si le mot est effacé');

  await wordField(admin).fill('SUPPRIMER');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await admin.locator('dialog').count(), 0, 'la fenêtre ne reste pas dans la page');
  assert.equal(accountExists(site, id), true);

  await openDeleteDialog(admin);
  assert.equal(await wordField(admin).inputValue(), '', 'il faut recopier le mot à chaque fois');
  assert.equal(await confirmDelete(admin).isDisabled(), true);
  await admin.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(accountExists(site, id), true);
});

test('ADM-10 : le mot recopié supprime le compte et ses cours, et le tableau de bord le confirme', async (t) => {
  const site = await startSite(t);
  const id = addDisabledTeacher(site);
  addTeacher(site, 'autre@example.org');
  site.db.prepare("INSERT INTO courses (id, account_id, title, draft, updated_at) VALUES ('c1', ?, 'Cours', '{}', 'd')").run(id);
  const admin = await adminPage(t, site);
  await openDeleteDialog(admin);

  await wordField(admin).fill(' supprimer ');
  await confirmDelete(admin).click();
  await deleteDialog(admin).waitFor({ state: 'detached' });
  await admin
    .getByRole('status')
    .filter({ hasText: `Le compte ${TEACHER.email} et ses cours ont été supprimés.` })
    .waitFor();
  await admin.getByRole('cell', { name: 'autre@example.org' }).waitFor();
  assert.equal(await admin.getByRole('cell', { name: TEACHER.email }).count(), 0, 'la ligne a disparu');
  assert.equal(accountExists(site, id), false);
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM courses').get().n, 0);

  await admin.reload();
  await admin.getByRole('cell', { name: 'autre@example.org' }).waitFor();
  assert.equal(await admin.getByRole('cell', { name: TEACHER.email }).count(), 0, 'et ne revient pas après un rechargement');

  const former = await openPage(t, browser, { base: site.base });
  await logIn(former, TEACHER, '/prof');
  await former.getByRole('alert').filter({ hasText: 'Adresse e-mail ou mot de passe incorrect.' }).waitFor();
});

test('ADM-10 : la touche Entrée confirme une fois le mot recopié, et la liste vide le dit', async (t) => {
  const site = await startSite(t);
  addDisabledTeacher(site);
  const admin = await adminPage(t, site);
  await openDeleteDialog(admin);
  await wordField(admin).fill('SUPPRIMER');
  await wordField(admin).press('Enter');
  await see(admin, 'Aucun enseignant pour le moment.');
});

test('ADM-10 : un lien de réinitialisation affiché disparaît avec le compte', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const admin = await adminPage(t, site);
  await admin.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
  await see(admin, `Lien de réinitialisation pour ${TEACHER.email}`);
  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Désactiver' }).click();
  await openDeleteDialog(admin);
  await wordField(admin).fill('SUPPRIMER');
  await confirmDelete(admin).click();
  await see(admin, 'Aucun enseignant pour le moment.');
  assert.equal(await admin.getByLabel('Lien à transmettre').count(), 0);
});

test('ADM-10 : un échec s’affiche dans la fenêtre, sans rien supprimer, et on peut réessayer', async (t) => {
  const site = await startSite(t);
  const id = addDisabledTeacher(site);
  const admin = await adminPage(t, site);
  await openDeleteDialog(admin);
  await wordField(admin).fill('SUPPRIMER');
  const dialog = deleteDialog(admin);

  await admin.route('**/delete', (route) => route.abort());
  await confirmDelete(admin).click();
  await dialog.getByRole('alert').filter({ hasText: 'Le serveur ne répond pas.' }).waitFor();
  await admin.unroute('**/delete');
  assert.equal(await confirmDelete(admin).isEnabled(), true, 'le bouton n’est pas resté bloqué');

  site.db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ?').run(id);
  await confirmDelete(admin).click();
  await dialog.getByRole('alert').filter({ hasText: 'Désactivez ce compte avant de le supprimer.' }).waitFor();
  assert.equal(accountExists(site, id), true);

  site.db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(DISABLED_AT, id);
  await confirmDelete(admin).click();
  await see(admin, 'Aucun enseignant pour le moment.');
  assert.equal(accountExists(site, id), false);
});

test('ADM-10 : une session expirée pendant la confirmation ramène à la connexion, sans fenêtre restée ouverte', async (t) => {
  const site = await startSite(t);
  const id = addDisabledTeacher(site);
  const admin = await adminPage(t, site);
  await openDeleteDialog(admin);
  await wordField(admin).fill('SUPPRIMER');
  site.db.exec('DELETE FROM sessions');
  await confirmDelete(admin).click();
  await heading(admin, 'Administration');
  await admin.getByRole('button', { name: 'Se connecter' }).waitFor();
  assert.equal(await admin.locator('dialog').count(), 0);
  assert.equal(accountExists(site, id), true);
});

test('ADM-10 : la fenêtre tient dans un téléphone, même avec une très longue adresse', async (t) => {
  const site = await startSite(t);
  addDisabledTeacher(site, UNBREAKABLE_EMAIL);
  const width = 390;
  const admin = await adminPage(t, site, { viewport: { width, height: 780 } });
  await deleteButton(admin).waitFor();
  const inScreen = async (locator, name) => {
    const box = await locator.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `${name} : de ${box.x} à ${box.x + box.width}`);
  };
  await inScreen(deleteButton(admin), 'bouton de la ligne');

  await openDeleteDialog(admin);
  await inScreen(deleteDialog(admin), 'fenêtre');
  await inScreen(wordField(admin), 'case');
  await inScreen(confirmDelete(admin), 'confirmation');
  await inScreen(admin.getByRole('button', { name: 'Annuler' }), 'annulation');
  const overflow = await admin.locator('.dlg-body').evaluate((body) => body.scrollWidth - body.clientWidth);
  assert.equal(overflow, 0, 'pas de défilement sur le côté');

  await wordField(admin).fill('SUPPRIMER');
  await confirmDelete(admin).click();
  await admin.getByRole('status').waitFor();
  assert.equal(await pageOverflow(admin), 0, 'le message de confirmation tient aussi');
});

test('SEC-04 : une adresse piégée s’affiche aussi comme du texte dans la fenêtre de suppression', async (t) => {
  const site = await startSite(t);
  const trap = '<img/src=x/onerror=window.piege=1>@example.org';
  addDisabledTeacher(site, trap);
  const admin = await adminPage(t, site);
  await openDeleteDialog(admin);
  await deleteDialog(admin).getByText(trap).waitFor();
  await wordField(admin).fill('SUPPRIMER');
  await confirmDelete(admin).click();
  await admin.getByRole('status').filter({ hasText: trap }).waitFor();
  assert.equal(await admin.locator('dialog img, [role=status] img').count(), 0);
  assert.equal(await admin.evaluate(() => window.piege), undefined);
});

test('ENS-01 : l’enseignant change son mot de passe, se déconnecte et se reconnecte', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const page = await teacherPage(t, site);

  await page.getByLabel('Mot de passe actuel').fill('mauvais-mot-de-passe');
  await page.getByLabel('Nouveau mot de passe').fill('nouveau-mot-de-passe');
  await page.getByLabel('Le même, une seconde fois').fill('nouveau-mot-de-passe');
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await page.getByRole('alert').filter({ hasText: 'Mot de passe actuel incorrect.' }).waitFor();

  await page.getByLabel('Mot de passe actuel').fill(TEACHER.password);
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await see(page, 'Mot de passe modifié.');
  assert.equal(await page.getByLabel('Mot de passe actuel').inputValue(), '', 'le formulaire est vidé');

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await heading(page, 'Espace enseignant');
  await page.reload();
  await heading(page, 'Espace enseignant');

  await logIn(page, TEACHER, '/prof');
  await page.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await logIn(page, { email: TEACHER.email, password: 'nouveau-mot-de-passe' }, '/prof');
  await heading(page, 'Mes cours');
});

test('ENS-04 : chacun est renvoyé vers son espace, sans voir celui de l’autre', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const teacher = await teacherPage(t, site);
  await teacher.goto('/admin');
  await see(teacher, "Cette page est réservée à l'administrateur.");
  assert.equal(await teacher.getByRole('heading', { name: 'Inviter un enseignant' }).count(), 0);
  await teacher.getByRole('link', { name: 'Ouvrir mon espace enseignant' }).click();
  await heading(teacher, 'Mes cours');

  await teacher.goto('/admin');
  await teacher.getByRole('button', { name: 'Se déconnecter' }).click();
  await heading(teacher, 'Administration');

  const admin = await adminPage(t, site);
  await admin.goto('/prof');
  await heading(admin, "Compte d'administration");
  assert.equal(await admin.getByRole('heading', { name: 'Mes cours' }).count(), 0);
  await admin.getByRole('link', { name: 'Ouvrir le tableau de bord' }).click();
  await heading(admin, 'Inviter un enseignant');
  await admin.goto('/prof');
  await admin.getByRole('button', { name: 'Se déconnecter' }).click();
  await heading(admin, 'Espace enseignant');
});

test('SEC-04 : une adresse piégée s’affiche comme du texte, sans s’exécuter', async (t) => {
  const site = await startSite(t);
  const trap = '<img/src=x/onerror=window.piege=1>@example.org';
  addTeacher(site, trap);
  const admin = await adminPage(t, site);
  await admin.getByRole('cell', { name: trap }).waitFor();
  await admin.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
  await see(admin, `Lien de réinitialisation pour ${trap}`);
  assert.equal(await admin.locator('td img, .link-box img').count(), 0);
  assert.equal(await admin.evaluate(() => window.piege), undefined);
});

test('le tableau de bord tient dans un téléphone : les boutons sont visibles, sans défilement sur le côté', async (t) => {
  const site = await startSite(t);
  addTeacher(site, UNBREAKABLE_EMAIL);
  const width = 390;
  const admin = await adminPage(t, site, { viewport: { width, height: 780 } });
  await see(admin, UNBREAKABLE_EMAIL);

  const label = await admin.evaluate(() => getComputedStyle(document.querySelector('td[data-label="Compte créé"]'), '::before').content);
  assert.equal(label, '"Compte créé : "', 'chaque valeur garde son libellé');

  for (const name of ['Réinitialiser le mot de passe', 'Désactiver']) {
    const box = await admin.getByRole('button', { name }).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `${name} : de ${box.x} à ${box.x + box.width}`);
  }
  const overflow = await admin.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, table: wrap.scrollWidth - wrap.clientWidth };
  });
  assert.deepEqual(overflow, { page: 0, table: 0 });

  await admin.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
  await see(admin, `Lien de réinitialisation pour ${UNBREAKABLE_EMAIL}`);
  assert.equal(await pageOverflow(admin), 0, 'le titre du lien tient aussi');
});

test('la barre du compte tient dans un téléphone, même avec une très longue adresse', async (t) => {
  const site = await startSite(t);
  addTeacher(site, UNBREAKABLE_EMAIL);
  const page = await openPage(t, browser, { base: site.base, viewport: { width: 390, height: 780 } });
  await logIn(page, { email: UNBREAKABLE_EMAIL, password: TEACHER.password }, '/prof');
  await heading(page, 'Mes cours');
  // Mesure directe : aligné à droite, un texte trop long déborde à gauche, sans créer de défilement
  const box = await page.locator('.account-bar span').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, `de ${box.x} à ${box.x + box.width}`);
});

test('sur ordinateur, le tableau reste un vrai tableau : toutes les cellules ont la hauteur de leur ligne', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const admin = await adminPage(t, site);
  await admin.getByRole('cell', { name: TEACHER.email }).waitFor();
  const { row, cells } = await admin.evaluate(() => {
    const line = document.querySelector('table.teachers tbody tr');
    return { row: line.getBoundingClientRect().height, cells: [...line.children].map((cell) => cell.getBoundingClientRect().height) };
  });
  assert.deepEqual(
    cells,
    cells.map(() => row)
  );
});

test('une session expirée sur le tableau de bord ramène à la connexion', async (t) => {
  const site = await startSite(t);
  addTeacher(site);
  const admin = await adminPage(t, site);
  await admin.getByRole('cell', { name: TEACHER.email }).waitFor();
  site.db.exec('DELETE FROM sessions');
  await admin.getByRole('button', { name: 'Créer un lien de création de compte' }).click();
  await heading(admin, 'Administration');
  await admin.getByRole('button', { name: 'Se connecter' }).waitFor();
});

test('un refus du serveur s’affiche sur le tableau de bord', async (t) => {
  const site = await startSite(t);
  const id = addTeacher(site);
  const admin = await adminPage(t, site);
  await admin.getByRole('cell', { name: TEACHER.email }).waitFor();
  site.db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run('2026-01-01', id);
  await admin.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
  await admin.getByRole('alert').filter({ hasText: 'Ce compte est désactivé' }).waitFor();
});

test('sans réseau, chaque écran le dit, au lieu de rester vide', async (t) => {
  const site = await startSite(t);
  const page = await openPage(t, browser, { base: site.base });
  await page.route('**/api/**', (route) => route.abort());
  for (const route of ['/prof', '/admin']) {
    await page.goto(route);
    await page.getByRole('alert').filter({ hasText: 'Le serveur ne répond pas.' }).waitFor();
  }
  await page.unroute('**/api/**');
  await logIn(page, { email: ADMIN.email, password: 'mauvais-mot-de-passe' }, '/admin');
  await page.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await page.route('**/api/**', (route) => route.abort());
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('alert').filter({ hasText: 'Le serveur ne répond pas.' }).waitFor();
});

test('SRV-10 : une mise à jour des scripts et des styles arrive à la visite suivante, sans vider le cache', async (t) => {
  const root = await tempDir(t);
  const write = (name, content) => writeFile(path.join(root, name), content);
  const publish = async (version) => {
    await write('essai.js', `document.title = 'version ${version}';`);
    await write('essai.css', `h1 { order: ${version}; }`);
  };
  await write(
    'essai.html',
    '<!doctype html><title>Essai</title><link rel="stylesheet" href="/essai.css"><h1>Essai</h1><script type="module" src="/essai.js"></script>'
  );
  await publish(1);
  const site = await startSite(t, { root });
  const page = await openPage(t, browser, { base: site.base });
  const visit = async () => {
    await page.goto('/essai.html');
    return page.evaluate(() => [document.title, getComputedStyle(document.querySelector('h1')).order]);
  };
  assert.deepEqual(await visit(), ['version 1', '1']);
  await publish(22);
  assert.deepEqual(await visit(), ['version 22', '22']);
});

test('DEP-01 : les pages construites fonctionnent aussi, d’un seul tenant', async (t) => {
  const out = await tempDir(t);
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--outdir', out], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);

  const site = await startSite(t, { root: out });
  addTeacher(site);
  const page = await openPage(t, browser, { base: site.base });
  const files = [];
  page.on('request', (request) => files.push(new URL(request.url()).pathname));
  await logIn(page, ADMIN, '/admin');
  await heading(page, 'Inviter un enseignant');
  await page.getByRole('cell', { name: TEACHER.email }).waitFor();
  assert.deepEqual(
    files.filter((file) => !file.startsWith('/api/')),
    ['/admin'],
    'aucun fichier séparé à charger'
  );
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await logIn(page, TEACHER, '/prof');
  await heading(page, 'Mes cours');
});
