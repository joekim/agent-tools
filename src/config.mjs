import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveToken, storeSecret } from './credentials.mjs';
import { profileFor } from './profile.mjs';

export const home = process.env.AGENT_TOOLS_HOME || path.join(os.homedir(), '.agent-tools');
export const configPath = process.env.AGENT_TOOLS_CONFIG || path.join(home, 'config.json');
export function readConfig(file = configPath) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  c.token = resolveToken(c);
  if (c.token.length < 32) throw new Error('Hub token must be at least 32 characters');
  return c;
}
export function initConfig() {
  fs.mkdirSync(home, { recursive: true });
  if (fs.existsSync(configPath)) {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!existing.credential && existing.tokenFile) {
      const oldFile = existing.tokenFile;
      existing.credential = `hub/${existing.nodeId}`;
      storeSecret(existing.credential, resolveToken({ tokenFile: oldFile }));
      delete existing.tokenFile;
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 });
      // Only remove the hub-owned legacy token, never another service's file.
      if (path.resolve(oldFile) === path.resolve(home, 'token')) fs.unlinkSync(oldFile);
    }
    return { configPath, created: false, credentialStore: 'native' };
  }
  const nodeId = os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const credential = `hub/${nodeId}`;
  storeSecret(credential, randomBytes(32).toString('hex'));
  const c = {
    nodeId,
    host: '::', port: 3002, credential,
    profile: profileFor(),
    publicUrl: `http://${os.hostname().split('.')[0].toLowerCase()}.local:3002`,
    imageStudio: { enabled:true, sharedPort:true, port:3002, host:'::', generationEnabled:false, dataRoot:path.join(home,'image-studio') },
    peerIntervalMs: 15000, leaseMs: 45000,
    peers: [], allowedServiceOrigins: [], services: [],
    projectsRoot: path.join(os.homedir(), 'projects'),
    legacyToolsRoot: path.join(os.homedir(), 'projects', 'agent-tools'),
    artifactsDir: path.join(home, 'artifacts')
  };
  fs.writeFileSync(configPath, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  return { configPath, created: true };
}
