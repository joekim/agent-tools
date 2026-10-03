import path from 'node:path';
import { readConfig } from '../src/config.mjs';
import { loadSecret } from '../src/credentials.mjs';
import { createVoiceService, generateAudio } from '../services/voice/tools/voice-update-service.mjs';
const c = readConfig().voiceRuntime;
if (!c || process.platform !== 'win32') throw new Error('Windows voice runtime is not configured');
const env = { ...process.env, PYTHONPATH: c.pythonPath, ISLAND_VOICE_MODEL: c.model, ISLAND_VOICE_DEVICE: 'cuda:0', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const server = createVoiceService({ token: loadSecret(c.credential), dataDir: c.dataDir,
  update: (request, jobId, report) => generateAudio({ request, jobId, report, dataDir: c.dataDir, python: c.python, env }) });
server.listen(c.port, '127.0.0.1', () => console.log(`Media Hub voice ready on local port ${c.port}`));
