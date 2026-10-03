import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeInstructions } from '../src/agent-instructions.mjs';

const target = process.argv[2];
if (!target || !path.isAbsolute(target) || !fs.statSync(target).isDirectory()) throw new Error('Usage: node scripts/install-project-instructions.mjs ABSOLUTE_PROJECT_DIRECTORY');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const block = fs.readFileSync(path.join(root, 'docs', 'project-agent-instructions.md'), 'utf8');
for (const name of ['AGENTS.md', 'CLAUDE.md']) {
  const file = path.join(target, name);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = mergeInstructions(current, block);
  if (next === current) continue;
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.agent-tools-backup-${Date.now()}`);
  fs.writeFileSync(file, next);
  console.log(`Updated ${file}`);
}
