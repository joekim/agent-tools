import fs from 'node:fs';
import { Entry } from '@napi-rs/keyring';

export const credentialService = 'agent-tools';
function entry(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\/-]{0,150}$/.test(name || '')) throw new Error('Invalid credential name');
  return new Entry(credentialService, name);
}
export function storeSecret(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Empty credential');
  const target = entry(name);
  target.setPassword(value);
  if (target.getPassword() !== value) throw new Error('Credential-store verification failed');
}
export function loadSecret(name) {
  let value;
  try { value = entry(name).getPassword(); }
  catch { throw new Error(`Native credential store unavailable for ${name}`); }
  if (!value) throw new Error(`Missing native credential: ${name}`);
  return value;
}
export function resolveToken(item) {
  if (item.credential) return loadSecret(item.credential);
  // Explicit compatibility with existing services; new setup uses native storage.
  if (item.tokenFile) return fs.readFileSync(item.tokenFile, 'utf8').trim();
  return undefined;
}
