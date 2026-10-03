import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { partyWeb, rewritePartyLinks } from '../src/party-web.mjs';
test('party links remain inside mounted pages and keep refresh and anchors', () => {
  assert.equal(rewritePartyLinks('<nav><a href="/party?refresh=1#gear">Party</a><a href="https://example.com">Web</a>'), '<nav><a href="/">Media Hub</a><a href="/party/party?refresh=1#gear">Party</a><a href="https://example.com">Web</a>');
});
test('party mount constrains paths, methods, host, query and handles offline backend', async t => {
  let calls = 0;
  const backend = http.createServer((_req, res) => { calls++; res.setHeader('content-type', 'text/html'); res.end('<nav><a href="/levels">Levels</a></nav>'); });
  await new Promise(r => backend.listen(0, '127.0.0.1', r));
  const hub = { config: {}, services: new Map([['party-notes', { expiresAt: Infinity, manifest: { baseUrl: `http://127.0.0.1:${backend.address().port}` } }]]) };
  const proxy = http.createServer((req, res) => partyWeb(req, res, hub));
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  t.after(() => { backend.closeAllConnections(); backend.close(); proxy.closeAllConnections(); proxy.close(); });
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const response = await fetch(base + '/party/levels');
  assert.equal(response.status, 200); assert.match(await response.text(), /href="\/party\/levels"/);
  assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.equal((await fetch(base + '/party/levels', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/party/unknown')).status, 404);
  assert.equal((await fetch(base + '/party/?url=http://example.com')).status, 400);
  const badHost = await new Promise((resolve, reject) => http.get(base + '/party/', { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  assert.equal(badHost, 403);
  assert.equal(calls, 1);
  hub.services.clear(); assert.equal((await fetch(base + '/party/')).status, 503);
});
