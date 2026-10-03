import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from '../src/hub.mjs';
import os from 'node:os';
import http from 'node:http';

test('browser controls enforce host, origin, profile, upload type and web job scope', async t => {
  const c = { nodeId: 'web-test', token: 'x'.repeat(64), port: 0, host: '127.0.0.1', autoDetect: false, artifactsDir: os.tmpdir(), legacyToolsRoot: os.tmpdir(), controlExtraction: {} };
  const hub = new Hub(c); await hub.start(); t.after(() => hub.close());
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  assert.equal((await fetch(base+'/controls')).status, 200);
  const badHost = await new Promise((resolve, reject) => { http.get(base+'/controls', { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
  assert.equal(badHost, 403);
  assert.equal((await fetch(base+'/api/controls', { method: 'POST', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(base+'/api/controls', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{"path":"C:/private.png"}' })).status, 403);
  assert.equal((await fetch(base+'/api/controls/12345678-1234-1234-1234-123456789abc')).status, 404);
  assert.equal((await fetch(base+'/api/controls?mode=invalid&ext=png', { method: 'POST', headers: { origin: base, 'content-type': 'application/octet-stream' } })).status, 400);
  c.profile = 'files-only';
  assert.equal((await fetch(base+'/controls')).status, 403);
  assert.equal((await fetch(base+'/api/controls/status')).status, 403);
});
