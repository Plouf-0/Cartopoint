/**
 * SEC-06 : la règle envoyée au navigateur. Son effet réel est vérifié dans tests/e2e/content-policy.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHandler, createRouter, staticFiles } from '../server/http.mjs';
import { tempDir } from './helpers.js';

const hash = (script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
const policyOf = (response) => response.headers.get('content-security-policy');
const directive = (policy, name) => policy.split('; ').find((part) => part.startsWith(name + ' '));

async function site(t) {
  const root = await tempDir(t);
  const server = http.createServer(createHandler(createRouter(), staticFiles(root)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { root, base: `http://127.0.0.1:${server.address().port}` };
}

test('SEC-06 : une page n’autorise que l’empreinte de ses scripts en ligne', async (t) => {
  const { root, base } = await site(t);
  const code = 'console.log("é</b>");\n';
  await writeFile(path.join(root, 'page.html'), `<script>${code}</script><script type="application/json">{"a":1}</script>`);
  const scripts = directive(policyOf(await fetch(base + '/page.html')), 'script-src');
  assert.equal(scripts, `script-src 'self' ${hash(code)}`);
  assert.doesNotMatch(scripts, /unsafe/);
});

test('SEC-06 : la règle suit le fichier, et reste sur un 304', async (t) => {
  const { root, base } = await site(t);
  const file = path.join(root, 'page.html');
  await writeFile(file, '<script>un()</script>');
  const first = await fetch(base + '/page.html');
  assert.match(policyOf(first), new RegExp(hash('un()').replace(/[+/]/g, '\\$&')));

  const again = await fetch(base + '/page.html', { headers: { 'If-None-Match': first.headers.get('etag') } });
  assert.equal(again.status, 304);
  assert.equal(policyOf(again), policyOf(first));

  await writeFile(file, '<script>deux()</script>');
  await utimes(file, new Date(), new Date(Date.now() + 5000));
  const changed = policyOf(await fetch(base + '/page.html'));
  assert.ok(changed.includes(hash('deux()')));
  assert.ok(!changed.includes(hash('un()')));
});

test('SEC-06 : tout le reste porte une règle sans script en ligne', async (t) => {
  const { root, base } = await site(t);
  await writeFile(path.join(root, 'fichier.js'), 'un()');
  for (const url of ['/fichier.js', '/absent']) {
    const policy = policyOf(await fetch(base + url));
    assert.equal(directive(policy, 'script-src'), "script-src 'self'", url);
    for (const rule of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "default-src 'self'"]) assert.ok(policy.includes(rule), rule);
  }
});
