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
await server.connect(new StdioServerTransport());
