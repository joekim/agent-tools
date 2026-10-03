import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../src/hub.mjs';
import { publish, inspectPath, lanOrigin, diagnostics } from '../src/publishing.mjs';
import { dropboxClient } from '../src/dropbox.mjs';
import { mergeInstructions } from '../src/agent-instructions.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'hello.txt'); await fs.writeFile(source, 'hello phone');
  const config = { nodeId: 'test', token: 'a'.repeat(64), profile: 'files-only', host: '127.0.0.1', port: 0, publicUrl: 'http://media.local:3002', projectsRoot: root, legacyToolsRoot: root, artifactsDir: path.join(root, 'artifacts'), autoDetect: false, peerIntervalMs: 60000 };
  return { root, source, config };
}

test('publish on files-only profile snapshots a file; public gallery, range and task auth stay separate', async t => {
  const { source, config } = await fixture(t);
  const hub = new Hub(config); await hub.start(); t.after(() => hub.close());
  assert(hub.localTools().some(x => x.name === 'media-hub.publish'));
  const result = await hub.call({ name: 'media-hub.publish', input: { path: source, title: '<script>bad</script>' } });
  assert.equal(result.status, 'ready'); assert(result.url.startsWith('http://media.local:3002/shared/'));
  await fs.writeFile(source, 'changed');
  const url = `http://127.0.0.1:${hub.server.address().port}/shared/${result.id}/`;
  const gallery = await fetch(url); const html = await gallery.text();
  assert(html.includes('width=device-width')); assert(!html.includes('<script>bad')); assert(gallery.headers.get('content-security-policy'));
  assert.equal(await (await fetch(`${url}files/hello.txt`)).text(), 'hello phone');
  const range = await fetch(`${url}files/hello.txt`, { headers: { range: 'bytes=6-10' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'phone');
  assert.equal((await fetch(`${url}files/hello.txt`, { headers: { range: 'bytes=99-' } })).status, 416);
  assert.equal((await fetch(`${url}files/%2e%2e%2fmanifest.json`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${hub.server.address().port}/v1/catalog`)).status, 401);
});

test('path validation rejects hidden content, credentials, relative paths and unsuitable mobile URLs', async t => {
  const { root } = await fixture(t);
  await assert.rejects(inspectPath('relative.txt'), /absolute/);
  const out = path.join(root, 'out'); await fs.mkdir(out); await fs.writeFile(path.join(out, '.env'), 'fixture');
  await assert.rejects(inspectPath(out), /hidden/);
  for (const publicUrl of ['http://127.0.0.1:3002', 'http://localhost:3002', 'http://[::1]:3002']) assert.throws(() => lanOrigin({ publicUrl }), /LAN hostname/);
});

test('external publish uses ai-workspace and verifies public access, without exposing a local URL', async t => {
  const { source, config } = await fixture(t); const calls = [];
  const client = async () => async (op, args, bytes) => {
    calls.push({ op, args, bytes });
    if (op.startsWith('sharing/')) return { url: 'https://www.dropbox.com/scl/fi/example/hello.txt?dl=0', link_permissions: { resolved_visibility: { '.tag': 'public' } } };
    return {};
  };
  const result = await publish({ path: source, audience: 'external' }, config, { dropboxClient: client });
  assert.equal(result.status, 'ready'); assert(result.remotePath.startsWith('/ai-workspace/'));
  assert.equal(calls[1].bytes.toString(), 'hello phone'); assert.equal(calls[2].args.settings.requested_visibility, 'public');
  const hub = new Hub(config); await hub.start(); t.after(() => hub.close());
  assert.equal((await fetch(`http://127.0.0.1:${hub.server.address().port}/shared/${result.id}/`)).status, 404);
  const blocked = await publish({ path: source, audience: 'external' }, config, { dropboxClient: async () => async op => op.startsWith('sharing/') ? { url: 'https://www.dropbox.com/example', link_permissions: { resolved_visibility: { '.tag': 'team_only' } } } : {} });
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.url, undefined); assert(blocked.remotePath);
});

test('Dropbox errors redact provider bodies and native secrets; refresh auth stays internal', async () => {
  const requests = [];
  const client = await dropboxClient({ dropbox: { refreshCredential: 'test', appKey: 'public-app-id' } }, { secret: () => 'sensitive-refresh', fetcher: async (url, options) => {
    requests.push({ url, options });
    return url.endsWith('/token') ? new Response(JSON.stringify({ access_token: 'sensitive-access' })) : new Response('sensitive-provider-body', { status: 403 });
  } });
  await assert.rejects(client('files/get_metadata', { path: '/ai-workspace' }), error => !error.message.includes('sensitive') && error.message.includes('403'));
  assert.equal(requests[1].options.headers.authorization, 'Bearer sensitive-access');
  assert.equal(requests[0].options.body.get('grant_type'), 'refresh_token');
});

test('diagnostics does not claim Dropbox write capability from read access', async t => {
  const { source, config } = await fixture(t); config.publicUrl = 'http://localhost:3002'; const calls = [];
  const result = await diagnostics({ path: source }, config, { dropboxClient: async () => async op => { calls.push(op); return { '.tag': 'folder' }; } });
  assert.equal(result.checks.lan.status, 'failed'); assert.equal(result.checks.path.status, 'passed');
  assert.equal(result.checks.dropbox.writeAndPublicLinkVerified, false);
  assert.deepEqual(calls, ['files/get_metadata', 'sharing/list_shared_links']);
});

test('instruction refresh replaces only its own block and is idempotent', () => {
  const block = '<!-- agent-tools-hub -->\nnew\n<!-- /agent-tools-hub -->';
  const current = 'before\n<!-- agent-tools-hub -->old<!-- /agent-tools-hub -->\nafter';
  const next = mergeInstructions(current, block);
  assert.equal(next, `before\n${block}\nafter`); assert.equal(mergeInstructions(next, block), next);
});

test('external diagnostic tests actual write/link rights and cleans up only its synthetic file', async t => {
  const { config } = await fixture(t); config.publicUrl = 'http://localhost:3002'; const calls = [];
  const result = await diagnostics({ probeExternal: true }, config, { dropboxClient: async () => async (op, args) => {
    calls.push({ op, args });
    return op === 'sharing/create_shared_link_with_settings' ? { url: 'https://www.dropbox.com/example', link_permissions: { resolved_visibility: { '.tag': 'public' } } } : { '.tag': 'folder' };
  } });
  assert.equal(result.checks.dropbox.writeAndPublicLinkVerified, true);
  assert.equal(calls.at(-2).op, 'sharing/revoke_shared_link'); assert.equal(calls.at(-1).op, 'files/delete_v2');
  assert(calls.at(-1).args.path.startsWith('/ai-workspace/media-hub-diagnostic-'));
  assert.equal(calls.at(-1).args.path, calls.find(c => c.op === 'files/upload').args.path);
});

test('GLB galleries offer locally hosted animation controls without executing published scripts', async t => {
  const { root, config } = await fixture(t);
  const model = path.join(root, 'actor.glb'); await fs.writeFile(model, 'test-glb');
  const result = await publish({ path: model }, config);
  const hub = new Hub(config); await hub.start(); t.after(() => hub.close());
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  const response = await fetch(`${base}/shared/${result.id}/`); const html = await response.text();
  assert(html.includes('class="model-clips"'));
  assert(html.includes('class="model-seek"'));
  assert(html.includes('data-src="files/actor.glb"'));
  assert(response.headers.get('content-security-policy').includes("script-src 'self'"));
  const bundle = await fetch(`${base}/shared/viewer/model-viewer.js`);
  assert.equal(bundle.status, 200); assert(bundle.headers.get('content-type').startsWith('text/javascript'));
  assert.equal((await fetch(`${base}/shared/viewer/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/shared/viewer/model-viewer.js`, {method:'POST'})).status, 405);
  const file = await fetch(`${base}/shared/${result.id}/files/actor.glb`);
  assert(file.headers.get('content-disposition').startsWith('attachment'));
  assert(file.headers.get('content-security-policy').includes('sandbox'));
});
