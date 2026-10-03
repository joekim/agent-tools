import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createProject } from '../src/projects.mjs';
import { Hub } from '../src/hub.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-project-test-'));
  t.after(async () => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { nodeId: 'test', token: 'x'.repeat(64), host: '127.0.0.1', port: 0, autoDetect: false, profile: 'files-only', projectsRoot: path.join(root, 'projects'), artifactsDir: path.join(root, 'artifacts'), legacyToolsRoot: root, peerIntervalMs: 60000 };
}

test('authenticated files-only hub creates a real Git repository and both instruction files', async t => {
  const config = await fixture(t);
  const hub = new Hub(config); await hub.start(); t.after(() => hub.close());
  const tool = hub.localTools().find(tool => tool.name === 'media-hub.create-project');
  assert.equal(tool.online, true);
  const url = `http://127.0.0.1:${hub.server.address().port}/v1/call`;
  const payload = JSON.stringify({ nodeId: 'test', name: tool.name, input: { name: 'sample-project' } });
  assert.equal((await fetch(url, { method: 'POST', body: payload })).status, 401);
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' }, body: payload });
  assert.equal(response.status, 200);
  const { result } = await response.json(); assert.equal(result.status, 'ready');
  assert.equal(result.directory, path.join(await fs.realpath(config.projectsRoot), 'sample-project'));
  const git = args => execFileSync('git', args, { cwd: result.directory, encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(git(['symbolic-ref', '--short', 'HEAD']), 'main');
  assert.equal(git(['status', '--porcelain']), '?? AGENTS.md\n?? CLAUDE.md');
  const expected = await fs.readFile(new URL('../docs/project-agent-instructions.md', import.meta.url), 'utf8');
  for (const file of result.instructions) assert.equal(await fs.readFile(file, 'utf8'), expected);
  await assert.rejects(createProject({ name: 'sample-project' }, config), /already exists/);
  assert.equal(await fs.readFile(result.instructions[0], 'utf8'), expected);
});

test('project creation rejects paths and reserved names before creating anything', async t => {
  const config = await fixture(t);
  for (const name of ['../escape', 'a/b', 'a\\b', 'C:\\outside', '.git', '-flag', 'CON', 'nul', 'COM1', 'a'.repeat(81)]) await assert.rejects(createProject({ name }, config), /project name/);
  await assert.rejects(fs.access(config.projectsRoot), { code: 'ENOENT' });
});

test('existing empty project directories are preserved', async t => {
  const config = await fixture(t);
  const directory = path.join(config.projectsRoot, 'existing'); await fs.mkdir(directory, { recursive: true });
  await assert.rejects(createProject({ name: 'existing' }, config), /already exists/);
  assert.deepEqual(await fs.readdir(directory), []);
});
