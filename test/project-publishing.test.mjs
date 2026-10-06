import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publish } from '../src/publishing.mjs';
import { externalTarget } from '../src/project-publishing.mjs';
import { dropboxClient } from '../src/dropbox.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { projectsRoot: path.join(root, 'projects'), artifactsDir: path.join(root, 'artifacts') };
  const source = path.join(config.projectsRoot, 'rpg', 'output', 'build.html');
  await fs.mkdir(path.dirname(source), { recursive: true }); await fs.writeFile(source, 'version one');
  const entries = new Map(), links = new Map(), calls = [];
  let revision = 0;
  const api = async (op, args, bytes) => {
    calls.push({ op, args });
    if (op === 'files/get_metadata') {
      if (!entries.has(args.path)) throw Object.assign(new Error('missing'), { dropboxCode: 'not_found' });
      return entries.get(args.path);
    }
    if (op === 'files/create_folder_v2') { entries.set(args.path, { '.tag': 'folder' }); return {}; }
    if (op === 'files/upload') {
      const old = entries.get(args.path);
      assert.equal(args.autorename, false); assert.equal(args.strict_conflict, true);
      if (old) assert.deepEqual(args.mode, { '.tag': 'update', update: old.rev }); else assert.equal(args.mode, 'add');
      const result = { '.tag': 'file', rev: String(++revision), bytes: bytes.toString() }; entries.set(args.path, result); return result;
    }
    if (op === 'sharing/list_shared_links') { assert.equal(args.direct_only, true); return { links: links.has(args.path) ? [links.get(args.path)] : [] }; }
    if (op === 'sharing/create_shared_link_with_settings') {
      const link = { url: 'https://www.dropbox.com/scl/fi/example/build.html?rlkey=keep&dl=0', link_permissions: { resolved_visibility: { '.tag': 'public' } } };
      links.set(args.path, link); return link;
    }
    throw new Error(`Unexpected operation ${op}`);
  };
  return { config, source, entries, links, calls, api, deps: { dropboxClient: async () => api } };
}

test('project file updates reuse destination and share URL, returning a direct download', async t => {
  const f = await fixture(t);
  const input = { path: f.source, audience: 'external' };
  const first = await publish(input, f.config, f.deps);
  assert.equal(first.status, 'ready'); assert.equal(first.remotePath, '/ai-workspace/rpg/output/build.html');
  await fs.writeFile(f.source, 'version two');
  const second = await publish(input, f.config, f.deps);
  assert.equal(second.status, 'ready'); assert.equal(first.url, second.url); assert.equal(first.remotePath, second.remotePath);
  assert.equal(second.revisions[0].action, 'updated'); assert.equal(f.entries.get(second.remotePath).bytes, 'version two');
  assert.equal(new URL(second.downloadUrl).searchParams.get('dl'), '1'); assert.equal(new URL(second.downloadUrl).searchParams.get('rlkey'), 'keep');
  assert.equal(f.calls.filter(c => c.op === 'sharing/create_shared_link_with_settings').length, 1);
  assert.equal([...f.entries.values()].filter(e => e['.tag'] === 'file').length, 1);
});

test('explicit project destination and additive folders preserve other remote files', async t => {
  const f = await fixture(t);
  const first = await publish({ path: f.source, audience: 'external', project: 'rpg', relativePath: 'build.html' }, f.config, f.deps);
  assert.equal(first.remotePath, '/ai-workspace/rpg/build.html');
  const folderInput = { path: path.dirname(f.source), audience: 'external' };
  const initial = await publish(folderInput, f.config, f.deps); assert.equal(initial.status, 'ready');
  f.entries.set('/ai-workspace/rpg/output/older.txt', { '.tag': 'file', rev: 'older', bytes: 'keep' });
  const updated = await publish(folderInput, f.config, f.deps); assert.equal(updated.status, 'ready');
  assert.equal(f.entries.get('/ai-workspace/rpg/output/older.txt').bytes, 'keep');
  assert.equal(f.entries.get('/ai-workspace/rpg/build.html').bytes, 'version one');
  assert(!f.calls.some(c => c.op.includes('delete')));
});

test('remote destinations reject traversal and mismatched project names before uploads', async t => {
  const f = await fixture(t);
  for (const relativePath of ['../other.html', '/other.html', 'a//b', 'a/./b', 'a\\b', 'a/..', 'a./b', 'C:/b']) {
    assert.throws(() => externalTarget({ path: f.source, relativePath }, f.config, false), /relativePath/);
  }
  assert.throws(() => externalTarget({ path: f.source, project: 'other' }, f.config, false), /does not match/);
  assert.throws(() => externalTarget({ path: path.join(f.config.artifactsDir, 'image.png') }, f.config, false), /requires a project/);
  const outside = externalTarget({ path: path.join(f.config.artifactsDir, 'image.png'), project: 'rpg' }, f.config, false);
  assert.equal(outside.remotePath, '/ai-workspace/rpg/image.png');
});

test('revision conflicts and auth failures return the stable destination without a successful link', async t => {
  const f = await fixture(t);
  await publish({ path: f.source, audience: 'external' }, f.config, f.deps);
  const conflict = await publish({ path: f.source, audience: 'external' }, f.config, { dropboxClient: async () => async (op, args, bytes) => {
    if (op === 'files/upload') throw new Error('revision conflict');
    return f.api(op, args, bytes);
  } });
  assert.equal(conflict.status, 'failed'); assert.equal(conflict.url, undefined); assert.equal(conflict.remotePath, '/ai-workspace/rpg/output/build.html');
  const auth = await publish({ path: f.source, audience: 'external' }, f.config, { dropboxClient: async () => { throw new Error('not authorized'); } });
  assert.equal(auth.status, 'failed'); assert.equal(auth.remotePath, conflict.remotePath);
});

test('Dropbox error classification exposes only safe tags and never provider bodies', async () => {
  for (const [body, expected] of [[{ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, 'not_found'], [{ error: { '.tag': 'shared_link_already_exists' } }, 'shared_link_already_exists'], [{ error: { '.tag': 'private-secret' } }, undefined]]) {
    const api = await dropboxClient({ dropbox: { credential: 'test' } }, { secret: () => 'private-token', fetcher: async () => new Response(JSON.stringify({ ...body, detail: 'private-secret' }), { status: 409 }) });
    await assert.rejects(api('files/get_metadata', { path: '/example' }), error => error.dropboxCode === expected && !JSON.stringify(error).includes('private') && !error.message.includes('private'));
  }
});
