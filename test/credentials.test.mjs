import test from 'node:test';
import assert from 'node:assert/strict';
import { Entry } from '@napi-rs/keyring';
import { randomUUID } from 'node:crypto';
import { storeSecret, loadSecret, credentialService } from '../src/credentials.mjs';

test('native credential round trip (opt-in; no values printed)', { skip: process.env.TEST_NATIVE_CREDENTIALS !== '1' }, () => {
  const name = `tests/${randomUUID()}`;
  const value = randomUUID();
  try {
    storeSecret(name, value);
    // Boolean assertion prevents the test runner from printing a secret on failure.
    assert.ok(loadSecret(name) === value, 'Native credential did not match');
  } finally { new Entry(credentialService, name).deletePassword(); }
  assert.throws(() => loadSecret(name), /Missing native credential/);
});
