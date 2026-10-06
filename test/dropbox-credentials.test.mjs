import test from 'node:test';
import assert from 'node:assert/strict';
import { dropboxClient } from '../src/dropbox.mjs';

test('long access tokens are reassembled from native credential entries in order', async () => {
  const token = 'sl.' + 'x'.repeat(1400);
  const entries = { first: token.slice(0, 1000), second: token.slice(1000) };
  const client = await dropboxClient({ dropbox: { accessCredentialParts: ['first', 'second'] } }, {
    secret: name => entries[name],
    fetcher: async (_url, options) => {
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      return { ok: true, json: async () => ({ success: true }) };
    },
  });
  assert.deepEqual(await client('files/get_metadata', { path: '/ai-workspace' }), { success: true });
});

test('missing credential parts fail without exposing secret details', async () => {
  await assert.rejects(dropboxClient({ dropbox: { accessCredentialParts: ['missing'] } }, {
    secret: () => { throw new Error('private detail'); },
  }), error => /authorization unavailable/.test(error.message) && !error.message.includes('private detail'));
});
