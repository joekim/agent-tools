import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from './http.mjs';

export async function controlStatus(config) {
  try {
    const c = config.controlExtraction;
    await fs.access(c.python); await fs.access(c.script);
    const nodes = await request(new URL('/object_info', c.baseUrl), { timeout: 2500 });
    for (const name of ['LoadImage', 'LoadVideo', 'DWPreprocessor', 'CannyEdgePreprocessor', 'VideoDepthAnythingProcess']) {
      if (!nodes[name]) throw new Error('Missing node');
    }
    return { online: true };
  } catch { return { online: false, error: 'Isolated control backend unavailable. Start its ComfyUI server and check installed control nodes.' }; }
}

function jobDirectory(config, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid control job ID');
  return path.join(config.artifactsDir, 'control-jobs', id);
}

export async function extractControl(input, config) {
  if (!path.isAbsolute(input.path)) throw new Error('Use an absolute file path on this node');
  const source = await fs.realpath(input.path);
  if (!(await fs.stat(source)).isFile()) throw new Error('Input must be a file');
  if (!/\.(png|jpe?g|webp|bmp|tiff?|mp4|mov|mkv|avi|webm)$/i.test(source)) throw new Error('Unsupported image/video extension');
  const id = randomUUID(), directory = jobDirectory(config, id);
  await fs.mkdir(directory, { recursive: true });
  const c = config.controlExtraction;
  const args = [c.script, source, '--mode', input.mode || 'depth', '--max-frames', String(input.maxFrames || 145), '--resolution', String(input.resolution || 512), '--base-url', c.baseUrl];
  // Use the GUI-subsystem Python on Windows: detached console executables
  // can allocate a visible window despite windowsHide. Keep redirected logs.
  const python = process.platform === 'win32' && /python\.exe$/i.test(c.python)
    ? c.python.replace(/python\.exe$/i, 'pythonw.exe') : c.python;
  await fs.access(python);
  const out = await fs.open(path.join(directory, 'stdout.jsonl'), 'a');
  const err = await fs.open(path.join(directory, 'stderr.log'), 'a');
  let child;
  try {
    child = spawn(python, args, { detached: true, windowsHide: true, stdio: ['ignore', out.fd, err.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await fs.writeFile(path.join(directory, 'job.json'), JSON.stringify({ id, pid: child.pid, createdAt: new Date().toISOString() }));
    child.unref();
  } finally { await out.close(); await err.close(); }
  return { status: 'submitted', id, pollTool: 'media-hub.control-job' };
}

export async function controlJob({ id }, config) {
  const directory = jobDirectory(config, id);
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'job.json'), 'utf8'));
  const lines = (await fs.readFile(path.join(directory, 'stdout.jsonl'), 'utf8')).split(/\r?\n/);
  let latest;
  for (const line of lines) { try { const event = JSON.parse(line); if (event.status) latest = { ...latest, ...event }; } catch { /* partial line */ } }
  if (['ready', 'failed', 'unknown'].includes(latest?.status)) return { ...latest, id };
  let alive = true;
  try { process.kill(metadata.pid, 0); } catch { alive = false; }
  return { ...latest, id, status: alive ? 'running' : 'unknown', ...(!alive ? { error: 'Worker exited without a terminal result. Inspect job logs and ComfyUI history before retrying.', logDirectory: directory } : {}) };
}
