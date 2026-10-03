// Example: node scripts/with-secrets.mjs secrets-map.json node app.mjs
// The JSON maps environment variable names to native credential names.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { loadSecret } from '../src/credentials.mjs';
const [mapping, command, ...args] = process.argv.slice(2);
if (!mapping || !command) throw new Error('Usage: with-secrets.mjs MAPPING.json COMMAND [ARGS]');
const env = { ...process.env };
for (const [name, credential] of Object.entries(JSON.parse(fs.readFileSync(mapping, 'utf8')))) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error('Invalid environment variable name');
  env[name] = loadSecret(credential);
}
const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true, shell: false });
child.on('error', () => { console.error('Could not launch target process'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
