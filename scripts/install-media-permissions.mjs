import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeInstructions } from '../src/agent-instructions.mjs';

// Called by explicit voice/image installers; never grant the generic dispatcher.
export function installMediaPermissions(kind, server = 'agent-tools') {
  if (!['voice', 'image'].includes(kind)) throw new Error('Expected voice or image.');
  if (!/^[a-zA-Z0-9_-]+$/.test(server)) throw new Error('Expected the configured MCP server name.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const directory = path.join(os.homedir(), '.claude');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'settings.json');
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  settings.permissions ??= {};
  settings.permissions.allow ??= [];
  if (!Array.isArray(settings.permissions.allow)) throw new Error('permissions.allow must be an array.');
  const operations = kind === 'voice' ? ['generate', 'job', 'download'] : ['configurations', 'generate', 'jobs', 'job', 'download'];
  const rules = ['discover_tools', ...operations.map(operation => `${kind}_${operation}`)].map(tool => `mcp__${server}__${tool}`);
  const missing = rules.filter(rule => !settings.permissions.allow.includes(rule));
  if (missing.length) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.agent-tools-backup-${Date.now()}`);
    settings.permissions.allow.push(...missing);
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  }
  const instructions = path.join(directory, 'CLAUDE.md');
  const current = fs.existsSync(instructions) ? fs.readFileSync(instructions, 'utf8') : '';
  const block = fs.readFileSync(path.join(root, 'docs/project-agent-instructions.md'), 'utf8')
    .replace("the agent-tools repository's README", path.join(root, 'README.md'));
  const next = mergeInstructions(current, block);
  if (next !== current) {
    if (fs.existsSync(instructions)) fs.copyFileSync(instructions, `${instructions}.agent-tools-backup-${Date.now()}`);
    fs.writeFileSync(instructions, next);
  }
  console.log(`Installed Claude ${kind} permissions for ${server}; existing settings preserved. Restart Claude to load the new tools and instructions.`);
  console.log('Existing ask/deny or managed policies may still require approval.');
}
