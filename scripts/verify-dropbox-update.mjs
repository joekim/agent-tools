// Explicit live diagnostic: only synthetic text is uploaded; all remote probe data is cleaned up.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../src/config.mjs';
import { dropboxClient } from '../src/dropbox.mjs';
import { request } from '../src/http.mjs';

const config = readConfig(), api = await dropboxClient(config);
const project = `hub-update-probe-${randomUUID()}`;
const remote = `/ai-workspace/${project}`;
const local = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-update-probe-'));
const file = path.join(local, 'probe.txt'), links = new Set();
let created = false;
try {
  await api('files/create_folder_v2', { path: remote, autorename: false }); created = true;
  const publish = async () => {
    const { result } = await request(`http://127.0.0.1:${config.port}/v1/call`, {
      token: config.token, method: 'POST', timeout: 140000,
      body: { nodeId: config.nodeId, name: 'media-hub.publish', input: { path: file, project, audience: 'external' } },
    });
    if (result?.url) links.add(result.url);
    assert.equal(result?.status, 'ready', result?.error || 'Live publication failed');
    return result;
  };
  await fs.writeFile(file, 'Media Hub synthetic update probe version one.');
  const first = await publish();
  const expected = 'Media Hub synthetic update probe version two.';
  await fs.writeFile(file, expected);
  const second = await publish();
  assert.equal(first.url, second.url); assert.equal(first.remotePath, second.remotePath);
  assert.notEqual(first.revisions[0].rev, second.revisions[0].rev);
  assert.equal(second.revisions[0].action, 'updated');
  const downloaded = await fetch(second.downloadUrl, { signal: AbortSignal.timeout(30000) });
  assert(downloaded.ok); assert.equal(await downloaded.text(), expected);
  console.log('Verified: stable project path, reused share link, new revision, and updated direct-download contents.');
} finally {
  const failures = [];
  for (const url of links) {
    try { await api('sharing/revoke_shared_link', { url }); } catch { failures.push('probe link revocation'); }
  }
  if (created) { try { await api('files/delete_v2', { path: remote }); } catch { failures.push(`probe folder cleanup: ${remote}`); } }
  assert(path.dirname(local) === await fs.realpath(os.tmpdir()));
  await fs.rm(local, { recursive: true, force: true });
  if (failures.length) throw new Error(`Cleanup requires attention: ${failures.join(', ')}`);
  console.log('Cleanup complete: synthetic Dropbox folder and links removed.');
}
