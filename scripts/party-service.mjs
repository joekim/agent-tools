import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig, home } from '../src/config.mjs';
import { request } from '../src/http.mjs';

const config = readConfig(), runtime = config.partyRuntime;
const service = config.services?.find(s => s.id === 'party-notes');
if (!runtime?.python || !runtime?.script || !service) throw new Error('Configure partyRuntime.python/script and party-notes service first.');
const url = new URL(service.baseUrl);
if (url.hostname !== '127.0.0.1') throw new Error('Party runtime must bind to loopback.');
try { await request(new URL('/levels', url), { timeout: 3000 }); console.log('Party server already running.'); process.exit(0); } catch {}
fs.mkdirSync(home, { recursive: true });
const out = fs.openSync(path.join(home, 'party-stdout.log'), 'a');
const err = fs.openSync(path.join(home, 'party-stderr.log'), 'a');
const child = spawn(runtime.python, [runtime.script, '--host', '127.0.0.1', '--port', url.port], {
  cwd: path.dirname(runtime.script), detached: true, windowsHide: true, stdio: ['ignore', out, err]
});
child.once('error', () => { console.error('Could not launch party server; check partyRuntime configuration.'); process.exitCode = 1; });
child.unref(); fs.closeSync(out); fs.closeSync(err);
