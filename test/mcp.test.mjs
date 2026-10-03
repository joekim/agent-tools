import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Hub } from '../src/hub.mjs';

test('real MCP stdio client initializes, discovers tools, and gets structured call errors', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mcp-'));
  const tokenFile = path.join(dir, 'token'); fs.writeFileSync(tokenFile, 'b'.repeat(64));
  const config = { nodeId: 'test-machine', host: '127.0.0.1', port: 0, tokenFile, token: 'b'.repeat(64), autoDetect: false, legacyToolsRoot: dir, artifactsDir: dir };
  const hub = new Hub(config); await hub.start();
  const configFile = path.join(dir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ ...config, token: undefined, port: hub.server.address().port }));
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await hub.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.mjs')], env: { ...process.env, AGENT_TOOLS_CONFIG: configFile } }));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(x => x.name).sort(), ['call_tool', 'discover_tools', 'image_configurations', 'image_download', 'image_generate', 'image_job', 'image_jobs', 'voice_download', 'voice_generate', 'voice_job']);
  const found = await client.callTool({ name: 'discover_tools', arguments: { query: 'youtube' } });
  assert.equal(JSON.parse(found.content[0].text).tools[0].nodeId, 'test-machine');
  const failed = await client.callTool({ name: 'call_tool', arguments: { nodeId: 'test-machine', name: 'nonexistent', input: {} } });
  assert.equal(failed.isError, true);
  const calls = [];
  hub.call = async args => { calls.push(args); return { id: 'voice-test', status: 'ready' }; };
  for (const operation of ['generate', 'job', 'download']) {
    const input = operation === 'generate' ? { lines: ['Hello.'] } : { id: 'voice-test' };
    const result = await client.callTool({ name: `voice_${operation}`, arguments: {
      nodeId: 'test-machine', ...input,
      // A permissive client must not repurpose an approved voice tool.
      name: 'media-hub.generate', input: { model: 'other' }
    } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls.at(-1), { nodeId: 'test-machine', name: `voice.${operation}`, input });
  }
  const invalid = await client.callTool({ name: 'voice_generate', arguments: { nodeId: 'test-machine', lines: [] } });
  assert.equal(invalid.isError, true);
  assert.equal(calls.length, 3);
  for (const operation of ['configurations', 'generate', 'jobs', 'job', 'download']) {
    const input = operation === 'generate' ? { prompt: 'A mountain', model: 'wai-v17', poseStrength: 0.5 }
      : ['job', 'download'].includes(operation) ? { id: 'image-test' } : {};
    const args = operation === 'generate' ? { input } : input;
    const result = await client.callTool({ name: `image_${operation}`, arguments: {
      nodeId: 'test-machine', ...args, name: 'voice.generate'
    } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls.at(-1), { nodeId: 'test-machine', name: `media-hub.${operation}`, input });
  }
  const badImage = await client.callTool({ name: 'image_generate', arguments: { nodeId: 'test-machine', input: { prompt: '' } } });
  assert.equal(badImage.isError, true);
  assert.equal(calls.length, 8);
});
