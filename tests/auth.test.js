import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashPassword, checkPassword, _sha256ForTests } from '../src/js/auth.js';

test('SHA-256 de secours identique à celui de Node', () => {
  for (const s of ['', 'herbier:admin', 'é'.repeat(100), 'x'.repeat(1000)]) {
    const expected = createHash('sha256').update(s).digest('hex');
    const actual = Buffer.from(_sha256ForTests(new TextEncoder().encode(s))).toString('hex');
    assert.equal(actual, expected, `longueur ${s.length}`);
  }
});

test('mot de passe : défaut « admin », puis empreinte', async () => {
  assert.equal(await checkPassword('admin', null), true);
  assert.equal(await checkPassword('autre', null), false);
  const h = await hashPassword('jardin');
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await checkPassword('jardin', h), true);
  assert.equal(await checkPassword('admin', h), false);
});
