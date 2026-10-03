import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig, home } from '../src/config.mjs';
import { loadSecret } from '../src/credentials.mjs';
import { request } from '../src/http.mjs';
const c = readConfig().voiceRuntime;
if (!c || process.platform !== 'win32') throw new Error('Windows voice runtime is not configured');
// An OS-owned pipe lock disappears even after a watchdog crash.
const lock = net.createServer(socket => socket.end());
lock.on('error', error => { if (error.code === 'EADDRINUSE') process.exit(0); else throw error; });
await new Promise(resolve => lock.listen('\\\\.\\pipe\\media-hub-voice-watchdog', resolve));
const logDir = path.join(home, 'voice'); fs.mkdirSync(logDir, { recursive: true });
const out = fs.openSync(path.join(logDir, 'stdout.log'), 'a');
const err = fs.openSync(path.join(logDir, 'stderr.log'), 'a');
let child, failures = 0;
const health = () => request(`http://127.0.0.1:${c.port}/health`, { token: loadSecret(c.credential), timeout: 3000 });
for (;;) {
  let healthy = false;
  try { healthy = (await health()).ok === true; } catch { /* retry or start */ }
  if (healthy) failures = 0;
  else if (!child || child.exitCode !== null) {
    child = spawn(process.execPath, [fileURLToPath(new URL('./voice-service.mjs', import.meta.url))], { windowsHide: true, stdio: ['ignore', out, err] });
    child.on('error', () => { child = undefined; });
    failures = 0;
  } else if (++failures >= 3) {
    // Restart only the process we own. Never kill an unrelated listener.
    child.kill(); failures = 0;
  }
  await delay(10000);
}
