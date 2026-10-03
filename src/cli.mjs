import fs from 'node:fs';
import { initConfig, readConfig, configPath } from './config.mjs';
import { Hub } from './hub.mjs';
import { request } from './http.mjs';
import { registerService } from './registration.mjs';
import { storeSecret, loadSecret } from './credentials.mjs';

const command = process.argv[2] || 'serve';
if (command === 'setup') console.log(JSON.stringify(initConfig(), null, 2));
else if (command === 'secret-import') {
  storeSecret(process.argv[3], fs.readFileSync(process.argv[4], 'utf8').trim());
  console.log('Stored and verified in the native credential store. Source file preserved.');
} else if (command === 'secret-set') {
  if (process.stdin.isTTY) throw new Error('Pass the secret through stdin from a secure prompt or process; never as a command-line argument.');
  let value = ''; for await (const chunk of process.stdin) { value += chunk; if (value.length > 16384) throw new Error('Credential too large'); }
  storeSecret(process.argv[3], value.trim()); console.log('Stored and verified in the native credential store.');
} else if (command === 'secret-check') { loadSecret(process.argv[3]); console.log('Credential is available; value is not displayed.'); }
else {
  const config = readConfig();
  const url = process.env.AGENT_TOOLS_URL || `http://127.0.0.1:${config.port}`;
  if (command === 'serve') {
    const hub = new Hub(config);
    await hub.start();
    console.log(`Agent-tools ${config.nodeId}: ${config.host}:${config.port}; config: ${configPath}`);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => hub.close().then(() => process.exit()));
  } else if (command === 'list') console.log(JSON.stringify(await request(new URL('/v1/catalog', url), { token: config.token }), null, 2));
  else if (command === 'call') console.log(JSON.stringify(await request(new URL('/v1/call', url), { token: config.token, method: 'POST', body: { nodeId: process.argv[3], name: process.argv[4], input: JSON.parse(process.argv[5] || '{}') }, timeout: 140000 }), null, 2));
  else if (command === 'register') {
    const stop = await registerService({ hubUrl: url, token: config.token, manifest: JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) });
    const keepAlive = setInterval(() => {}, 60000);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); clearInterval(keepAlive); });
  } else throw new Error('Usage: node src/cli.mjs setup|serve|list|call NODE TOOL JSON|register MANIFEST');
}
