import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { profileFor } from './profile.mjs';
import { controlJob, controlStatus } from './controls.mjs';

const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export async function controlWeb(req, res, hub) {
  const c = hub.config;
  try {
    const url = new URL(req.url, 'http://localhost');
    const hostname = new URL(`http://${req.headers.host}`).hostname;
    const hosts = ['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(), `${os.hostname().split('.')[0].toLowerCase()}.local`];
    if (c.publicUrl) hosts.push(new URL(c.publicUrl).hostname);
    if (!hosts.includes(hostname)) throw fail('Use the Media Hub hostname.', 403);
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail('Cross-origin request refused.', 403);
    if (profileFor(c) === 'files-only' || !c.controlExtraction) throw fail('Control extraction is unavailable on this machine.', 403);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && url.pathname === '/controls') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(await fs.readFile(new URL('../services/image-studio/image-server/controls.html', import.meta.url)));
    }
    if (req.method === 'GET' && url.pathname === '/api/controls/status') return json(res, 200, await controlStatus(c));
    const root = path.join(c.artifactsDir, 'control-web');
    if (req.method === 'POST' && url.pathname === '/api/controls') {
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/octet-stream') throw fail('Use the upload form.', 403);
      const mode = url.searchParams.get('mode'), extension = url.searchParams.get('ext');
      if (!['depth','canny','pose'].includes(mode) || !['png','jpg','jpeg','webp','mp4','mov','webm'].includes(extension)) throw fail('Unsupported file or control type.');
      const health = await controlStatus(c); if (!health.online) throw fail(health.error, 503);
      // Hold a slot before awaiting upload bytes, including concurrent uploads.
      hub.controlUploads ||= new Set();
      for (const id of hub.controlUploads) { if (id.startsWith('upload:')) continue; const job = await controlJob({ id }, c); if (['ready','failed','unknown'].includes(job.status)) hub.controlUploads.delete(id); }
      if (hub.controlUploads.size >= 3) throw fail('Three extractions are already uploading or processing. Try again when one finishes.', 429);
      const slot = `upload:${randomUUID()}`; hub.controlUploads.add(slot);
      try {
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 20 * 1024 * 1024) throw fail('File exceeds 20 MB.', 413); chunks.push(chunk); }
        if (!size) throw fail('Choose a nonempty file.');
        const upload = path.join(root, randomUUID()); await fs.mkdir(upload, { recursive: true });
        const file = path.join(upload, `input.${extension}`); await fs.writeFile(file, Buffer.concat(chunks));
        const job = await hub.call({ name: 'media-hub.extract-control', input: { path: file, mode, resolution: 512, maxFrames: 145 } });
        await fs.writeFile(path.join(root, `${job.id}.json`), JSON.stringify({ id: job.id }));
        hub.controlUploads.add(job.id);
        return json(res, 202, job);
      } finally { hub.controlUploads.delete(slot); }
    }
    const match = /^\/api\/controls\/([a-f0-9-]{36})(?:\/([a-zA-Z0-9_.-]+))?$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const [, id, filename] = match;
      // Browser access is restricted to jobs created by this upload form.
      await fs.access(path.join(root, `${id}.json`));
      const job = await controlJob({ id }, c);
      if (job.status !== 'ready') return json(res, 200, { id, status: job.status, error: job.code === 'NO_POSE_DETECTED' ? 'No pose detected. Try a clear image with a visible person, or choose Edges or Depth instead.' : job.status === 'failed' ? 'Extraction failed. Check that the file is a supported image or video.' : job.status === 'unknown' ? 'Job status is uncertain. Ask an agent to inspect this job before retrying.' : undefined });
      const files = (await fs.readdir(job.directory)).filter(name => /\.(png|mp4)$/.test(name));
      if (filename) {
        if (!files.includes(filename)) throw fail('Output not found.', 404);
        res.writeHead(200, { 'content-type': filename.endsWith('.png') ? 'image/png' : 'video/mp4', 'cache-control': 'private, max-age=3600' });
        return res.end(await fs.readFile(path.join(job.directory, filename)));
      }
      return json(res, 200, { id, status: 'ready', mode: job.mode, frames: job.frames, warning: job.warning, files: files.map(name => ({ name, url: `/api/controls/${id}/${name}` })) });
    }
    throw fail('Not found.', 404);
  } catch (error) { if (!res.headersSent) json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.code === 'ENOENT' ? 'Job not found.' : error.message }); }
}
