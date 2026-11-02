import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { hashPassword, normalizeEmail, validatePassword, verifyPassword } from '../server/auth.mjs';
import { HttpError } from '../server/http.mjs';

test('un mot de passe n’apparaît pas dans son empreinte, et se vérifie', async () => {
  const stored = await hashPassword('correct horse');
  assert.match(stored, /^scrypt\$32768\$8\$1\$/);
  assert.equal(stored.includes('correct horse'), false);
  assert.equal(await verifyPassword('correct horse', stored), true);
  assert.equal(await verifyPassword('correct hors', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('deux comptes au même mot de passe n’ont pas la même empreinte', async () => {
  assert.notEqual(await hashPassword('identique'), await hashPassword('identique'));
});

test('une empreinte garde ses réglages : on pourra les durcir sans invalider les anciennes', async () => {
  const salt = Buffer.from('sel-de-seize-oct');
  const key = await promisify(scrypt)('ancien', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
  const stored = ['scrypt', 2 ** 14, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
  assert.equal(await verifyPassword('ancien', stored), true);
  assert.equal(await verifyPassword('autre', stored), false);
});

test('une empreinte d’un autre format ne valide rien', async () => {
  for (const stored of ['', 'null', 'sha256:abcdef', 'plain:admin', null, undefined]) {
    assert.equal(await verifyPassword('admin', stored), false, String(stored));
  }
});

test('un mot de passe fait entre 8 et 200 caractères', () => {
  for (const good of ['12345678', 'x'.repeat(200), 'é'.repeat(8)]) validatePassword(good);
  for (const bad of ['', '1234567', 'x'.repeat(201), undefined, null, 12345678, ['12345678'], {}]) {
    assert.throws(() => validatePassword(bad), HttpError, String(bad));
  }
});

test('une adresse e-mail est nettoyée et contrôlée', () => {
  assert.equal(normalizeEmail('  prof@example.org '), 'prof@example.org');
  assert.equal(normalizeEmail('Prof.Nom+cours@sous.example.org'), 'Prof.Nom+cours@sous.example.org');
  for (const bad of ['', 'pas-une-adresse', '@example.org', 'prof@', 'a b@example.org', 'a@b@c', `${'x'.repeat(250)}@a.fr`, undefined, null, 12, {}]) {
    assert.throws(() => normalizeEmail(bad), HttpError, String(bad));
  }
});
