import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, createLimiter } from '../server/security.mjs';

const fakeRequest = (forwarded) => ({
  headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  socket: { remoteAddress: '10.0.0.1' }
});

test("E-04 : sans TRUST_PROXY, X-Forwarded-For est ignoré, car n'importe qui peut l'écrire", () => {
  assert.equal(clientIp(fakeRequest('1.2.3.4'), false), '10.0.0.1');
  assert.equal(clientIp(fakeRequest(undefined), false), '10.0.0.1');
});

test('E-04 : avec TRUST_PROXY, seule la dernière valeur compte : celle ajoutée par le proxy', () => {
  assert.equal(clientIp(fakeRequest('1.2.3.4'), true), '1.2.3.4');
  assert.equal(clientIp(fakeRequest('6.6.6.6, 1.2.3.4'), true), '1.2.3.4');
  assert.equal(clientIp(fakeRequest('6.6.6.6,7.7.7.7,  1.2.3.4  '), true), '1.2.3.4');
  assert.equal(clientIp(fakeRequest('2001:db8::1'), true), '2001:db8::1');
});

test('E-04 : avec TRUST_PROXY mais sans valeur utilisable, on revient à l’adresse du socket', () => {
  assert.equal(clientIp(fakeRequest(undefined), true), '10.0.0.1');
  assert.equal(clientIp(fakeRequest(''), true), '10.0.0.1');
  assert.equal(clientIp(fakeRequest('1.2.3.4, '), true), '10.0.0.1');
});

function limiter(max = 3, windowMs = 1000) {
  const clock = { time: 0 };
  return { clock, limit: createLimiter({ max, windowMs, now: () => clock.time }) };
}

test('la limite bloque au nombre maximal d’échecs, pas avant', () => {
  const { limit } = limiter();
  assert.equal(limit.blocked('a'), false);
  limit.fail('a');
  limit.fail('a');
  assert.equal(limit.blocked('a'), false);
  limit.fail('a');
  assert.equal(limit.blocked('a'), true);
});

test('E-04 : les échecs d’une clé ne bloquent pas les autres', () => {
  const { limit } = limiter(1);
  limit.fail('a');
  assert.equal(limit.blocked('a'), true);
  assert.equal(limit.blocked('b'), false);
});

test('le blocage cesse à la fin du délai, et le décompte repart de zéro', () => {
  const { limit, clock } = limiter();
  for (let i = 0; i < 3; i++) limit.fail('a');
  clock.time = 999;
  assert.equal(limit.blocked('a'), true);
  clock.time = 1000;
  assert.equal(limit.blocked('a'), false);
  clock.time = 1001;
  limit.fail('a');
  assert.equal(limit.blocked('a'), false, 'un seul échec depuis la fin du délai');
});

test('chaque échec prolonge le délai', () => {
  const { limit, clock } = limiter();
  limit.fail('a');
  clock.time = 900;
  limit.fail('a');
  clock.time = 1800;
  limit.fail('a');
  assert.equal(limit.blocked('a'), true);
});

test('les essais expirés sont oubliés quand les clés deviennent trop nombreuses', () => {
  const { limit, clock } = limiter();
  for (let i = 0; i <= 10000; i++) limit.fail('ancien-' + i);
  assert.equal(limit.size, 10001);
  clock.time = 5000;
  limit.fail('recent');
  assert.equal(limit.size, 1);
  assert.equal(limit.blocked('recent'), false);
});
