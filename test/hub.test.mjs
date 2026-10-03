import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../src/hub.mjs';
import { youtubeId, captionText, runBuiltin } from '../src/builtins.mjs';
import { request } from '../src/http.mjs';

const token = 'a'.repeat(64);
function config(nodeId, extra = {}) {
  return { nodeId, token, host: '127.0.0.1', port: 0, autoDetect: false, projectsRoot: '.', legacyToolsRoot: '.', artifactsDir: os.tmpdir(), leaseMs: 1000, peerIntervalMs: 60000, ...extra };
}
async function start(t, c) {
  const h = new Hub(c); await h.start(); t.after(() => h.close());
  h.url = `http://127.0.0.1:${h.server.address().port}`; return h;
}
async function service(t) {
  const s = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, path: req.url })); });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { s.closeAllConnections(); s.close(r); }));
  const baseUrl = `http://127.0.0.1:${s.address().port}`;
  return { s, manifest: { id: 'demo', description: 'Demo service', baseUrl, healthPath: '/health', operations: { job: { method: 'GET', path: '/jobs/{id}', description: 'Get job', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } } } } };
}
test('all HTTP routes require authentication and reject browser origins', async t => {
  const h = await start(t, config('one'));
  assert.equal((await fetch(`${h.url}/health`)).status, 401);
  assert.equal((await fetch(`${h.url}/health`, { headers: { authorization: `Bearer ${token}`, origin: 'https://example.com' } })).status, 403);
  assert.equal((await request(`${h.url}/health`, { token })).nodeId, 'one');
});
test('registration requires approved origin, expires without renewal, and validates calls', async t => {
  const { manifest } = await service(t);
  const h = await start(t, config('one', { allowedServiceOrigins: [manifest.baseUrl] }));
  assert.throws(() => h.register({ ...manifest, baseUrl: 'http://unapproved.test' }), /not approved/);
  h.register(manifest); await h.tick();
  assert.equal(h.localTools().find(x => x.name === 'demo.job').online, true);
  assert.deepEqual(await h.call({ name: 'demo.job', input: { id: 'abc' } }), { ok: true, path: '/jobs/abc' });
  await assert.rejects(h.call({ name: 'demo.job', input: { id: '../secrets' } }), /Invalid path/);
  await assert.rejects(h.call({ name: 'demo.job', input: {} }), /Invalid input/);
  h.services.get('demo').expiresAt = Date.now() - 1;
  await assert.rejects(h.call({ name: 'demo.job', input: { id: 'abc' } }), /expired/);
  assert.equal(h.localTools().some(x => x.name === 'demo.job'), false);
});
test('configured credentials never appear in catalogs and cannot be replaced by registration', async t => {
  const { manifest } = await service(t);
  const h = await start(t, config('one', { services: [{ ...manifest, tokenFile: 'private-token-file' }], allowedServiceOrigins: [manifest.baseUrl] }));
  assert.equal(JSON.stringify(h.snapshot()).includes('private-token-file'), false);
  assert.equal(h.localTools().find(x => x.name === 'demo.job').online, false);
  assert.throws(() => h.register(manifest), /local configuration/);
  assert.throws(() => h.register({ ...manifest, tokenFile: 'arbitrary-file' }), /credentials/);
});
test('two peers mutually discover and route a call; stale nodes become offline', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tokenFile = path.join(dir, 'token'); fs.writeFileSync(tokenFile, token);
  const { manifest } = await service(t);
  const a = await start(t, config('windows'));
  const b = await start(t, config('mac', { services: [manifest] }));
  a.peers.set('mac', { config: { id: 'mac', url: b.url, tokenFile }, lastSeen: 0, tools: [] });
  b.peers.set('windows', { config: { id: 'windows', url: a.url, tokenFile }, lastSeen: 0, tools: [] });
  await Promise.all([a.tick(), b.tick()]);
  assert.equal(a.catalog().nodes.find(n => n.nodeId === 'mac').online, true);
  assert.equal(b.catalog().nodes.find(n => n.nodeId === 'windows').online, true);
  const remote = await request(`${a.url}/v1/call`, { token, method: 'POST', body: { nodeId: 'mac', name: 'demo.job', input: { id: 'test' } } });
  assert.deepEqual(remote, { result: { ok: true, path: '/jobs/test' } });
  await assert.rejects(b.call({ nodeId: 'windows', name: 'demo.job' }, true), /forwarded/);
  a.peers.get('mac').lastSeen = Date.now() - 2000;
  assert.equal(a.catalog().tools.find(x => x.nodeId === 'mac' && x.name === 'demo.job').online, false);
  await assert.rejects(a.call({ nodeId: 'mac', name: 'demo.job' }), /offline/);
});
test('peer identity mismatch cannot refresh a lease', async t => {
  const h = await start(t, config('one'));
  const p = { config: { id: 'wrong', url: h.url }, lastSeen: 0, tools: [] };
  await h.syncPeer(p); assert.equal(p.lastSeen, 0); assert.ok(p.error);
});
test('YouTube URL validation and caption extraction', () => {
  assert.equal(youtubeId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=abcdefghijk&list=abc'), 'abcdefghijk');
  assert.throws(() => youtubeId('https://youtube.com.evil.test/watch?v=abcdefghijk'));
  assert.throws(() => youtubeId('file:///abcdefghijk'));
  assert.equal(captionText('WEBVTT\nKind: captions\n\n00:00.000 --> 00:01.000\nHello <c>world</c>\nHello world\n'), 'Hello world');
});
test('existing PowerShell hotkey JSON can include a UTF-8 BOM', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotkeys-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'hotkeys'));
  fs.writeFileSync(path.join(dir, 'hotkeys', 'hotkeys.json'), '\uFEFF[{"name":"Screenshot","hotkey":"Ctrl+Alt+S"}]');
  const result = await runBuiltin('desktop.hotkeys', {}, { legacyToolsRoot: dir });
  assert.equal(result[0].hotkey, 'Ctrl+Alt+S');
});
