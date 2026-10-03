import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mergeInstructions } from '../src/agent-instructions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcp = path.join(root, 'src', 'mcp.mjs');
const backup = file => { if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.agent-tools-backup-${Date.now()}`); };
const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
const current = fs.existsSync(codexConfig) ? fs.readFileSync(codexConfig, 'utf8') : '';
if (!/^\[mcp_servers\.agent-tools\]/m.test(current)) {
  backup(codexConfig);
  fs.writeFileSync(codexConfig, current + `\n[mcp_servers.agent-tools]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(mcp)}]\ntool_timeout_sec = 150\n`);
  console.log('Registered agent-tools in Codex.');
} else console.log('Codex agent-tools registration already exists; preserved.');

const claude = process.platform === 'win32' ? path.join(os.homedir(), '.local', 'bin', 'claude.exe') : 'claude';
try {
  const claudeConfig = path.join(os.homedir(), '.claude.json');
  const c = fs.existsSync(claudeConfig) ? JSON.parse(fs.readFileSync(claudeConfig, 'utf8')) : {};
  if (!c.mcpServers?.['agent-tools']) {
    backup(claudeConfig);
    execFileSync(claude, ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'agent-tools', '--', process.execPath, mcp], { windowsHide: true, stdio: 'pipe' });
    console.log('Registered agent-tools in Claude Code.');
  } else console.log('Claude agent-tools registration already exists; preserved.');
} catch { console.error('Claude CLI registration unavailable. Run: claude mcp add --scope user agent-tools -- node <absolute-path>/src/mcp.mjs'); }

for (const file of [path.join(os.homedir(), '.codex', 'AGENTS.md'), path.join(os.homedir(), '.claude', 'CLAUDE.md')]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const block = fs.readFileSync(path.join(root, 'docs', 'project-agent-instructions.md'), 'utf8').replace("the agent-tools repository's README", path.join(root, 'README.md'));
  const next = mergeInstructions(text, block);
  if (next === text) continue;
  backup(file);
  fs.writeFileSync(file, next);
}
console.log('Agent instructions installed. New agent sessions may be needed to load the MCP server.');
