import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const relativePath = 'memory/image-chat.md';
export function createMemoryStore(root = fileURLToPath(new URL('../', import.meta.url))) {
  const filename = path.join(root, relativePath);
  let busy = false;
  const git = args => exec('git', args, { cwd: root, windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024 });
  async function read() {
    const content = await fs.readFile(filename, 'utf8');
    if (content.length > 6000) throw fail('Memory is over 6,000 characters. Shorten the Markdown file before using it.', 409);
    return { content, revision: createHash('sha256').update(content).digest('hex'), path: relativePath };
  }
  async function save({ content, revision } = {}) {
    if (typeof content !== 'string' || !content.trim() || content.length > 6000 || typeof revision !== 'string') throw fail('Provide Markdown memory up to 6,000 characters and its current revision.');
    if (busy) throw fail('Memory is being saved. Try again shortly.', 409);
    busy = true;
    try {
      const before = await read();
      if (before.revision !== revision) throw fail('Memory changed in another window. Reload memory before saving your edits.', 409);
      const normalized = content.replace(/\r\n/g, '\n').trimEnd() + '\n';
      if (normalized.length > 6000) throw fail('Memory is over 6,000 characters.');
      // Check Git before writing. The browser cannot choose paths or Git arguments.
      await git(['ls-files', '--error-unmatch', '--', relativePath]);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, normalized, { flag: 'wx' }); await fs.rename(temporary, filename); }
      finally { await fs.rm(temporary, { force: true }); }
      const current = await read();
      try {
        const { stdout } = await git(['status', '--porcelain', '--', relativePath]);
        if (stdout.trim()) await git(['commit', '--only', '-m', 'Update Image Chat memory', '--', relativePath]);
        const commit = (await git(['log', '-1', '--format=%h', '--', relativePath])).stdout.trim();
        return { ...current, committed: true, commit };
      } catch {
        // Preserve the user's edits when Git fails, and be explicit about their state.
        return { ...current, committed: false, error: 'Memory was saved locally, but Git could not commit it. Check Git identity, hooks or repository locks, then save again.' };
      }
    } finally { busy = false; }
  }
  return { read, save };
}
export const imageChatMemory = createMemoryStore();
