import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readConfig } from './config.mjs';
import { request } from './http.mjs';

const connection = () => {
  const config = readConfig();
  return { config, url: process.env.AGENT_TOOLS_URL || `http://127.0.0.1:${config.port}` };
};
const server = new McpServer({ name: 'agent-tools', version: '0.1.0' });
const output = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
server.registerTool('discover_tools', {
  description: 'Discover tools on this Windows/Mac and trusted peers. Returns machine identity, online status, descriptions and exact input schemas. Discover before calling. Desktop actions affect the named machine.',
  inputSchema: { query: z.string().optional(), onlineOnly: z.boolean().optional() },
  annotations: { readOnlyHint: true }
}, async ({ query, onlineOnly }) => {
  try {
    const { config, url } = connection();
    const result = await request(new URL('/v1/catalog', url), { token: config.token });
    result.tools = result.tools.filter(t => (!onlineOnly || t.online) && (!query || `${t.name} ${t.description} ${t.nodeId}`.toLowerCase().includes(query.toLowerCase())));
    return output(result);
  } catch (e) { return { ...output({ error: e.message, recovery: 'Start the hub with npm start in agent-tools.' }), isError: true }; }
});
server.registerTool('call_tool', {
  description: 'Call a discovered tool on its owning node. Follow its input schema. Image/voice generation returns a job ID; poll using the discovered job operation. Do not retry a generation submission after an ambiguous timeout without checking job state.',
  inputSchema: { nodeId: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()).default({}) }
}, async args => {
  try { const { config, url } = connection(); return output(await request(new URL('/v1/call', url), { token: config.token, method: 'POST', body: args, timeout: 140000 })); }
  catch (e) { return { ...output({ error: e.message }), isError: true }; }
});
// Separate entry points let clients approve voice without approving every hub task.
for (const operation of ['generate', 'job', 'download']) {
  server.registerTool(`voice_${operation}`, {
    description: `Media Hub voice.${operation} on a discovered Windows node. Use these dedicated tools for automatic voice workflows. Generate returns a job ID; poll voice_job and inspect completion before voice_download. Never blindly retry a timed-out generation.`,
    inputSchema: operation === 'generate'
      ? { nodeId: z.string().min(1), lines: z.array(z.string().min(1).max(300)).min(1).max(1000) }
      : { nodeId: z.string().min(1), id: z.string().regex(/^[a-zA-Z0-9-]+$/) }
  }, async ({ nodeId, lines, id }) => {
    try {
      const { config, url } = connection();
      return output(await request(new URL('/v1/call', url), {
        token: config.token, method: 'POST', timeout: 140000,
        body: { nodeId, name: `voice.${operation}`, input: operation === 'generate' ? { lines } : { id } }
      }));
    } catch (e) { return { ...output({ error: e.message }), isError: true }; }
  });
}
for (const operation of ['configurations', 'generate', 'jobs', 'job', 'download']) {
  const byId = ['job', 'download'].includes(operation);
  server.registerTool(`image_${operation}`, {
    description: `Media Hub media-hub.${operation} on the owning node. Discover first and read image_configurations before generating. image_generate accepts the discovered generation payload as input. Only enabled models are available. Poll image_job, inspect completion, then image_download. Inspect image_jobs after an ambiguous submission; do not blindly retry.`,
    inputSchema: operation === 'generate'
      ? { nodeId: z.string().min(1), input: z.object({ prompt: z.string().min(1) }).passthrough() }
      : byId ? { nodeId: z.string().min(1), id: z.string().regex(/^[a-zA-Z0-9-]+$/) }
      : { nodeId: z.string().min(1) }
  }, async ({ nodeId, input, id }) => {
    try {
      const { config, url } = connection();
      return output(await request(new URL('/v1/call', url), {
        token: config.token, method: 'POST', timeout: 140000,
        body: { nodeId, name: `media-hub.${operation}`, input: operation === 'generate' ? input : byId ? { id } : {} }
      }));
    } catch (e) { return { ...output({ error: e.message }), isError: true }; }
  });
}
server.registerTool('notify_task', {
  description: 'Notify the user in the owning Media Hub activity window when this task completes, fails or needs attention. No secrets. Use a stable eventId for safe retries; only report actual outcomes.',
  inputSchema: { nodeId: z.string().min(1), agent: z.enum(['claude', 'codex', 'other']), title: z.string().min(1).max(120), message: z.string().min(1).max(2000), status: z.enum(['completed', 'blocked', 'failed']).default('completed'), threadId: z.string().min(1).max(200).optional(), eventId: z.string().min(1).max(200).optional() }
}, async ({ nodeId, ...input }) => {
  try {
    const { config, url } = connection();
    return output(await request(new URL('/v1/call', url), { token: config.token, method: 'POST', body: { nodeId, name: 'media-hub.notify-task', input } }));
  } catch (e) { return { ...output({ error: e.message }), isError: true }; }
});
await server.connect(new StdioServerTransport());
