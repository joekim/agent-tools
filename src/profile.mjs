import os from 'node:os';

export function profileFor(config = {}, platform = os.platform()) {
  // A Mac never advertises or proxies model operations, even with a copied PC config.
  if (platform === 'darwin') return 'files-only';
  const profile = config.profile || 'full';
  if (!['full', 'files-only'].includes(profile)) throw new Error('Unknown Media Hub profile');
  return profile;
}
const nonModelTools = new Set(['media-hub.site','media-hub.library','media-hub.capabilities','media-hub.jobs','media-hub.job','media-hub.download','media-hub.transcript','youtube.transcript','desktop.hotkeys','desktop.screenshot']);
export function permitsTool(config, tool) {
  return profileFor(config) !== 'files-only' || nonModelTools.has(tool.name) || tool.modelUse === false;
}
