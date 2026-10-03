import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from '../src/config.mjs';
import { request } from '../src/http.mjs';

const c = readConfig();
const local = `http://127.0.0.1:${c.port}`;
try { if ((await request(`${local}/health`, { token: c.token, timeout: 1500 })).nodeId === c.nodeId) process.exit(0); } catch { /* start it */ }
let child, stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; child?.kill(sig); });
while (!stopping) {
  child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'serve'], { windowsHide: true, stdio: 'inherit' });
  const code = await new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', resolve); });
  if (stopping || code === 0) break;
  await delay(5000);
  try { const current = readConfig(); if ((await request(`http://127.0.0.1:${current.port}/health`, { token: current.token, timeout: 1500 })).ok) break; } catch { /* restart crashed hub */ }
}
