import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeJobs, activitySnapshot } from '../src/activity.mjs';
import { Hub } from '../src/hub.mjs';

test('activity normalizes jobs without exposing prompts, logs or credentials', () => {
  const state = summarizeJobs('voice', [
    { id: 'a', status: 'running', phase: 'generating', startedAt: '2026-01-01T00:00:00Z', log: 'secret', prompt: 'private', generated: 100 },
    { id: 'b', status: 'running', phase: 'queued' },
    { id: 'c', status: 'completed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:10Z' },
    { id: '../bad', status: 'running' }
  ], true, Date.parse('2026-01-01T00:01:00Z'));
  assert.equal(state.state, 'generating'); assert.equal(state.queued, 1);
  assert.equal(state.active[0].elapsedSeconds, 60); assert.equal(state.recent[0].elapsedSeconds, 10);
  assert.equal(state.recent[0].status, 'finished');
  assert.doesNotMatch(JSON.stringify(state), /secret|private|progress|\.\.\/bad/);
  assert.equal(summarizeJobs('image', [{ id: 'a', status: 'running' }], false).recent[0].status, 'unknown');
});
test('activity distinguishes unavailable services and respects files-only profile', async () => {
  const hub = { config: { nodeId: 'test', profile: 'full' }, services: new Map(), call: async () => { throw new Error('secret'); } };
  const status = await activitySnapshot(hub);
  assert.ok(status.services.every(s => s.state === 'offline'));
  hub.config.profile = 'files-only';
  assert.deepEqual((await activitySnapshot(hub)).services, []);
});
test('activity endpoint requires authentication and rejects browser origins', async t => {
  const hub = new Hub({ nodeId: 'test', token: 'a'.repeat(64), host: '127.0.0.1', port: 0, autoDetect: false, profile: 'files-only', projectsRoot: '.', legacyToolsRoot: '.', artifactsDir: '.' });
  await hub.start(); t.after(() => hub.close());
  const url = `http://127.0.0.1:${hub.server.address().port}/v1/activity`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { authorization: `Bearer ${'a'.repeat(64)}` };
  assert.equal((await fetch(url, { headers: { ...headers, origin: 'https://example.com' } })).status, 403);
  const result = await (await fetch(url, { headers })).json();
  assert.deepEqual(result.services, []);
});
