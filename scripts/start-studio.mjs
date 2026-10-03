import { studioSettings } from '../services/image-studio/settings.mjs';
import { readConfig } from '../src/config.mjs';
import { Hub } from '../src/hub.mjs';
const settings = studioSettings();
let running = false;
try {
  const response = await fetch(`http://127.0.0.1:${settings.port}/api/site`, { signal: AbortSignal.timeout(1500) });
  running = response.ok && (await response.json()).name === 'Media Hub';
} catch { /* start if absent */ }
if (running) console.log(`Media Hub is running: ${settings.publicUrl}/\nGallery: ${settings.publicUrl}/assets/`);
else {
  if (settings.sharedPort) { const hub = new Hub(readConfig()); await hub.start(); }
  else { const { startImageStudio } = await import('../services/image-studio/image-server/server.mjs'); await startImageStudio(); }
}
