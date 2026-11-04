import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, createLimiter, isHttps, isSameOrigin } from '../server/security.mjs';

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
});

test('E-04 : avec TRUST_PROXY mais sans valeur utilisable, on revient à l’adresse du socket', () => {
  assert.equal(clientIp(fakeRequest(undefined), true), '10.0.0.1');
  assert.equal(clientIp(fakeRequest(''), true), '10.0.0.1');
  assert.equal(clientIp(fakeRequest('1.2.3.4, '), true), '10.0.0.1');
});

const throughProxy = (lastHop, visitor) => ({
  headers: { 'x-forwarded-for': lastHop, ...(visitor === undefined ? {} : { 'cf-connecting-ip': visitor }) },
  socket: { remoteAddress: '10.0.0.1' }
});

test('E-04 : derrière Cloudflare, le client est le visiteur qu’il nomme : deux inconnus ne partagent plus un compteur', () => {
  assert.equal(clientIp(throughProxy('162.158.1.1', '203.0.113.5'), true), '203.0.113.5');
  assert.equal(clientIp(throughProxy('162.158.1.1', '198.51.100.7'), true), '198.51.100.7');
  assert.equal(clientIp(throughProxy('172.71.255.254', '198.51.100.7'), true), '198.51.100.7', 'la fin d’une plage');
  assert.equal(clientIp(throughProxy('2400:cb00:2048::1', '203.0.113.5'), true), '203.0.113.5', 'un serveur en IPv6');
  assert.equal(clientIp(throughProxy('2a06:98c7:ffff::1', '203.0.113.5'), true), '203.0.113.5', 'une plage en /29');
});

test('E-04 : venu d’ailleurs que Cloudflare, cet en-tête ne vaut rien : n’importe qui peut l’écrire', () => {
  assert.equal(clientIp(throughProxy('6.6.6.6', '203.0.113.5'), true), '6.6.6.6');
  assert.equal(clientIp(throughProxy('162.160.0.1', '203.0.113.5'), true), '162.160.0.1', 'juste après une plage');
  assert.equal(clientIp(throughProxy('162.157.255.255', '203.0.113.5'), true), '162.157.255.255', 'juste avant');
  assert.equal(clientIp(throughProxy('2400:cb01::1', '203.0.113.5'), true), '2400:cb01:0:0');
  assert.equal(clientIp(throughProxy('pas une adresse', '203.0.113.5'), true), 'pas une adresse');
  assert.equal(clientIp(throughProxy('162.158.1.1', '203.0.113.5'), false), '10.0.0.1', 'sans TRUST_PROXY, rien n’est cru');
});

test('E-04 : un visiteur illisible laisse le serveur de Cloudflare : mieux vaut un compteur partagé qu’un nom inventé', () => {
  for (const visitor of [undefined, '', 'pas une adresse', '203.0.113.5, 198.51.100.7']) {
    assert.equal(clientIp(throughProxy('162.158.1.1', visitor), true), '162.158.1.1', String(visitor));
  }
});

test('E-04 : en IPv6, tout un bloc /64 compte pour un seul client : il pourrait sinon changer d’adresse à chaque essai', () => {
  const key = (visitor) => clientIp(throughProxy('162.158.1.1', visitor), true);
  assert.equal(key('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2');
  assert.equal(key('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2', 'le même abonné');
  assert.notEqual(key('2001:db8:1:3::1'), key('2001:db8:1:2::1'), 'un autre abonné');
  assert.equal(key('2001:db8::1'), '2001:db8:0:0', 'l’écriture courte');
  assert.equal(key('2001:DB8::1'), '2001:db8:0:0', 'la casse');
  assert.equal(key('2001:db8::'), '2001:db8:0:0');
  assert.equal(key('::1'), '0:0:0:0');
  assert.equal(key('::ffff:203.0.113.5'), '203.0.113.5', 'une adresse IPv4 écrite en IPv6 reste elle-même');
  assert.equal(clientIp(throughProxy('2001:db8:1:2:3:4:5:6'), true), '2001:db8:1:2', 'sans Cloudflare aussi');
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

test('oublier les échecs d’une clé la débloque, sans toucher aux autres', () => {
  const { limit } = limiter(1);
  limit.fail('a');
  limit.fail('b');
  limit.clear('a');
  assert.equal(limit.blocked('a'), false);
  assert.equal(limit.blocked('b'), true);
});

test('retirer un échec ne fait jamais descendre le compte sous zéro', () => {
  const { limit } = limiter(2);
  limit.fail('a');
  limit.fail('a');
  assert.equal(limit.blocked('a'), true);
  limit.forgive('a');
  assert.equal(limit.blocked('a'), false);
  limit.forgive('a');
  limit.forgive('a');
  limit.forgive('inconnue');
  limit.fail('a');
  assert.equal(limit.blocked('a'), false, 'un seul échec compté après être revenu à zéro');
  limit.fail('a');
  assert.equal(limit.blocked('a'), true);
});

test('seul le proxy peut dire que la requête est en HTTPS', () => {
  const request = (proto) => ({ headers: proto ? { 'x-forwarded-proto': proto } : {} });
  assert.equal(isHttps(request('https'), true), true);
  assert.equal(isHttps(request('http, https'), true), true);
  assert.equal(isHttps(request('https, http'), true), false);
  assert.equal(isHttps(request('http'), true), false);
  assert.equal(isHttps(request(undefined), true), false);
  assert.equal(isHttps(request('https'), false), false, 'sans TRUST_PROXY, cet en-tête peut venir de n’importe qui');
});

test('une requête vient de la même origine seulement si l’hôte correspond exactement', () => {
  const request = (origin, host = 'site.fr') => ({ headers: { host, ...(origin === undefined ? {} : { origin }) } });
  assert.equal(isSameOrigin(request('https://site.fr')), true);
  assert.equal(isSameOrigin(request('http://site.fr:8080', 'site.fr:8080')), true);
  for (const origin of [
    undefined,
    '',
    'null',
    'pas une adresse',
    'https://autre.fr',
    'https://site.fr.autre.fr',
    'https://site.fr:8443',
    'https://sous.site.fr'
  ]) {
    assert.equal(isSameOrigin(request(origin)), false, String(origin));
  }
});
