import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { publish, diagnostics } from './publishing.mjs';
import { createProject } from './projects.mjs';
import { controlStatus, extractControl, controlJob } from './controls.mjs';
const exec = promisify(execFile);
export async function builtinStatus(tool, config) {
  try {
    if (tool.name === 'media-hub.extract-control') return await controlStatus(config);
    if (tool.name === 'media-hub.create-project') await exec('git', ['--version'], { windowsHide: true, timeout: 5000 });
    if (['youtube.transcript', 'media-hub.transcript'].includes(tool.name)) await exec(config.ytdlpCommand || 'yt-dlp', [...(config.ytdlpArgs || []), '--version'], { windowsHide: true, timeout: 5000 });
    if (tool.name === 'desktop.screenshot' && os.platform() === 'win32') await fs.access(path.join(config.legacyToolsRoot, 'screenshot', 'screenshot.ps1'));
    return { online: true };
  } catch { return { online: false, error: tool.name === 'media-hub.create-project' ? 'Git is unavailable in the hub service PATH; install Git and restart the hub.' : tool.name.endsWith('.transcript') ? 'Install yt-dlp and configure ytdlpCommand if needed' : 'Required desktop script is missing' }; }
}
export function youtubeId(value) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error('Use a YouTube video URL');
  const host = u.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)$/.exec(u.pathname)?.[1];
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) throw new Error('Use a valid YouTube video URL');
  return id;
}
export function captionText(vtt) {
  const lines = vtt.replace(/^\uFEFF/, '').split(/\r?\n/); const out = [];
  for (const line of lines) {
    if (!line.trim() || /^(WEBVTT|Kind:|Language:|NOTE|STYLE|REGION)/.test(line) || line.includes('-->') || /^\d+$/.test(line)) continue;
    const clean = line.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
    if (clean && clean !== out.at(-1)) out.push(clean);
  }
  return out.join('\n');
}
export async function runBuiltin(name, input, config) {
  if (name === 'media-hub.extract-control') return extractControl(input, config);
  if (name === 'media-hub.control-job') return controlJob(input, config);
  if (name === 'media-hub.create-project') return createProject(input, config);
  if (name === 'media-hub.publish') return publish(input, config);
  if (name === 'media-hub.diagnostics') return diagnostics(input, config);
  if (name === 'desktop.hotkeys') return JSON.parse((await fs.readFile(path.join(config.legacyToolsRoot, 'hotkeys', 'hotkeys.json'), 'utf8')).replace(/^\uFEFF/, ''));
  await fs.mkdir(config.artifactsDir, { recursive: true });
  if (name === 'desktop.screenshot') {
    if (os.platform() === 'win32') {
      const result = await exec('powershell.exe', ['-NoProfile', '-STA', '-File', path.join(config.legacyToolsRoot, 'screenshot', 'screenshot.ps1')], { windowsHide: true, timeout: 30000 });
      return { message: result.stdout.trim(), directory: path.join(os.homedir(), 'Pictures', 'Screenshots') };
    }
    const file = path.join(config.artifactsDir, `screenshot-${randomUUID()}.png`);
    await exec('/usr/sbin/screencapture', ['-x', file], { timeout: 30000 });
    return { file };
  }
  if (['youtube.transcript', 'media-hub.transcript'].includes(name)) {
    const id = youtubeId(input.url);
    const directory = path.join(config.artifactsDir, `youtube-${id}-${randomUUID()}`);
    await fs.mkdir(directory);
    const command = config.ytdlpCommand || 'yt-dlp';
    await exec(command, [...(config.ytdlpArgs || []), '--ignore-config', '--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', input.language || 'en', '--sub-format', 'vtt', '--socket-timeout', '20', '--retries', '1', '-o', path.join(directory, '%(id)s.%(ext)s'), '--', `https://www.youtube.com/watch?v=${id}`], { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const files = (await fs.readdir(directory)).filter(f => f.endsWith('.vtt'));
    if (!files.length) throw new Error('No captions available for the requested language');
    const transcripts = [];
    for (const file of files) {
      const text = captionText(await fs.readFile(path.join(directory, file), 'utf8'));
      const output = path.join(directory, file.replace(/\.vtt$/, '.txt'));
      await fs.writeFile(output, text);
      transcripts.push({ file: output, text });
    }
    return { directory, transcripts };
  }
  throw new Error('Unknown builtin');
}
