import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { builtinTools } from '../src/catalog.mjs';
import { controlJob, extractControl, controlStatus } from '../src/controls.mjs';

test('control extraction requires configuration and is absent from files-only discovery', () => {
  const base = { legacyToolsRoot: os.tmpdir(), controlExtraction: {} };
  assert(!builtinTools({ ...base, profile: 'files-only' }).some(t => t.name.includes('control')));
  assert(!builtinTools({ legacyToolsRoot: os.tmpdir() }).some(t => t.name.includes('control')));
});

test('control worker errors, result persistence, partial output, and path validation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'control-test-'));
  t.after(async () => { assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const config = { artifactsDir: root, controlExtraction: {} };
  assert.equal((await controlStatus(config)).online, false);
  await assert.rejects(extractControl({ path: 'relative.png' }, config), /absolute/);
  await assert.rejects(controlJob({ id: '../secret' }, config), /Invalid/);
  const id = '12345678-1234-1234-1234-123456789abc';
  const directory = path.join(root, 'control-jobs', id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'job.json'), JSON.stringify({ pid: process.pid }));
  const log = path.join(directory, 'stdout.jsonl');
  await fs.writeFile(log, '{"status":"submitted","jobId":"comfy-id"}\n{"sta');
  assert.equal((await controlJob({ id }, config)).status, 'running');
  await fs.writeFile(log, '{"status":"ready","image":"output.png"}\n');
  assert.equal((await controlJob({ id }, config)).image, 'output.png');
  await fs.writeFile(log, '{"status":"failed","error":"Invalid media"}\n');
  assert.equal((await controlJob({ id }, config)).status, 'failed');
});
