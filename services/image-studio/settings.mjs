import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { profileFor } from '../../src/profile.mjs';

export function studioSettings(overrides = {}) {
  const home = process.env.AGENT_TOOLS_HOME || path.join(os.homedir(), '.agent-tools');
  const configFile = process.env.AGENT_TOOLS_CONFIG || path.join(home, 'config.json');
  const hubConfig = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  const saved = hubConfig.imageStudio || {};
  const config = { ...saved, ...overrides };
  const dataRoot = process.env.IMAGE_DATA_ROOT || config.dataRoot || path.join(home, 'image-studio');
  const port = Number(process.env.IMAGE_PORT || config.port || 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Image Studio port');
  const publicUrl = process.env.IMAGE_PUBLIC_URL || config.publicUrl || `http://${os.hostname().split('.')[0].toLowerCase()}.local:${port}`;
  const publicOrigin = new URL(publicUrl);
  if (!['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash) throw new Error('IMAGE_PUBLIC_URL must be an HTTP(S) origin');
  const modelUse = profileFor({profile:config.profile || hubConfig.profile}) !== 'files-only';
  return { generationEnabled: false, ...config, ...(!modelUse ? {generationEnabled:false} : {}), modelUse, dataRoot, dataDir: path.join(dataRoot, 'jobs'), assetDir: path.join(dataRoot, 'assets'), screenshotDir: path.join(dataRoot, 'screenshots'), publicUrl: publicOrigin.origin, port, host: process.env.IMAGE_HOST || config.host || '::' };
}
