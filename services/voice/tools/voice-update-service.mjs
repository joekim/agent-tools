/** Authenticated LAN audio generation and downloads; no Git or game-asset writes. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isIPv4 } from 'node:net';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VOICE = 'Qwen3-CustomVoice-Aiden-v1';
export const voiceFile = (text) => createHash('sha1').update(`${VOICE}\n${text}`).digest('hex').slice(0, 24) + '.ogg';

export function normalizeRequest(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => !['lines', 'voice', 'format'].includes(key))) throw new Error('Send {"lines":["Text to speak", ...]} with an optional voice identity; no paths or commands are accepted.');
  if (body.voice !== undefined && body.voice !== VOICE) throw new Error(`Only ${VOICE} is supported.`);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 1000) throw new Error('Send 1 to 1000 lines.');
  const unique = new Map();
  for (const line of body.lines) {
    const text = typeof line === 'string' ? line : line?.text;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 300) throw new Error('Each line must contain 1 to 300 characters.');
    const cleaned = text.trim();
    const file = voiceFile(cleaned);
    if (typeof line === 'object' && line.file !== undefined && line.file !== file) throw new Error('Filename does not match the voice and text.');
    unique.set(file, { text: cleaned, file });
  }
  return { voice: VOICE, format: 'Ogg Vorbis, mono', lines: [...unique.values()] };
}

export function runCommand(command, args, { cwd, env = process.env, log = () => {}, timeout = 3_600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(command)} timed out`)); }, timeout);
    child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-2_000_000); log(chunk.toString()); });
    child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-8000); log(chunk.toString()); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${path.basename(command)} ${args[0]} exited ${code}: ${errors.slice(-2000)}`));
    });
  });
}

export async function generateAudio({ request, jobId, dataDir, python, env = process.env, report = () => {}, run = runCommand, root = ROOT }) {
  const audioDir = path.resolve(dataDir, 'audio');
  const jobDir = path.resolve(dataDir, 'jobs', jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const manifest = normalizeRequest(request);
  const missing = manifest.lines.filter(({ file }) => !fs.existsSync(path.join(audioDir, file)));
  const input = path.join(jobDir, 'input.json');
  fs.writeFileSync(input, JSON.stringify({ ...manifest, folder: audioDir }));
  report({ phase: 'generating', generated: missing.length, cached: manifest.lines.length - missing.length, total: manifest.lines.length });
  const invoke = (args) => run(python, args, { cwd: root, env, log: (line) => report({ log: line }) });
  if (missing.length) {
    const pending = path.join(jobDir, 'missing.json');
    fs.writeFileSync(pending, JSON.stringify({ ...manifest, folder: audioDir, lines: missing }));
    await invoke([path.join(root, 'tools/island-voice.py'), '--batch-size', '8', '--manifest', pending]);
  }
  report({ phase: 'validating' });
  await invoke([path.join(root, 'tools/validate-island-voice.py'), '--manifest', input, '--audio-dir', audioDir, '--archive', path.join(jobDir, 'audio.zip')]);
  const files = manifest.lines.map((line) => {
    const bytes = fs.readFileSync(path.join(audioDir, line.file));
    return { ...line, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: `/jobs/${jobId}/files/${line.file}` };
  });
  fs.writeFileSync(path.join(jobDir, 'manifest.json'), JSON.stringify({ ...manifest, lines: files }, null, 2) + '\n');
  return { voice: VOICE, generated: missing.length, cached: manifest.lines.length - missing.length, total: files.length, files, archiveUrl: `/jobs/${jobId}/audio.zip`, manifestUrl: `/jobs/${jobId}/manifest.json` };
}

/** Match the actual TCP peer, never proxy headers supplied by a caller. */
export function peerAllowed(address, cidr) {
  const peer = address?.replace(/^::ffff:/, '');
  if (peer === '127.0.0.1' || peer === '::1') return true;
  if (!cidr || !isIPv4(peer || '')) return false;
  const [network, prefix] = cidr.split('/');
  if (!isIPv4(network) || !/^\d+$/.test(prefix || '') || Number(prefix) < 16 || Number(prefix) > 32) return false;
  const number = (ip) => ip.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
  const mask = (0xffffffff << (32 - Number(prefix))) >>> 0;
  return (number(peer) & mask) === (number(network) & mask);
}

export function createVoiceService({ token, dataDir, update, allowedCidr }) {
  if (!token || token.length < 32) throw new Error('A token of at least 32 characters is required.');
  fs.mkdirSync(dataDir, { recursive: true });
  const stateFile = path.join(dataDir, 'jobs.json');
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  let jobs = [];
  if (stateFile && fs.existsSync(stateFile)) jobs = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  for (const job of jobs) if (job.status === 'running') Object.assign(job, { status: 'failed', error: 'Service restarted during generation; retry with a new idempotency key.' });
  let active;
  const persist = () => {
    if (!stateFile) return;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(jobs, null, 2));
    fs.renameSync(`${stateFile}.tmp`, stateFile);
  };
  persist();
  const reply = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    if (!peerAllowed(req.socket.remoteAddress, allowedCidr)) return reply(res, 403, { error: 'Caller is outside the allowed local network' });
    const presented = createHash('sha256').update(req.headers.authorization || '').digest();
    if (!timingSafeEqual(expected, presented)) return reply(res, 401, { error: 'Unauthorized' });
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true, apiVersion: 2, mode: 'audio-downloads', activeJob: active?.id ?? null });
    if (req.method === 'GET' && req.url === '/instructions') {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(path.join(ROOT, 'docs/VOICE-UPDATE-SERVICE.md'), 'utf8'));
      return;
    }
    const download = /^\/jobs\/([a-f0-9-]+)\/(audio\.zip|manifest\.json|files\/[a-f0-9]{24}\.ogg)$/.exec(req.url);
    if (req.method === 'GET' && download) {
      const job = jobs.find((item) => item.id === download[1]);
      if (!job) return reply(res, 404, { error: 'Job not found' });
      if (job.status !== 'completed') return reply(res, 409, { error: 'Downloads are available after successful validation.' });
      const name = download[2];
      if (name.startsWith('files/') && !job.files?.some((file) => file.file === name.slice(6))) return reply(res, 404, { error: 'File is not part of this job' });
      const file = name.startsWith('files/') ? path.join(dataDir, 'audio', name.slice(6)) : path.join(dataDir, 'jobs', job.id, name);
      try {
        const size = fs.statSync(file).size;
        res.writeHead(200, { 'content-type': name.endsWith('.zip') ? 'application/zip' : name.endsWith('.ogg') ? 'audio/ogg' : 'application/json', 'content-length': size, 'content-disposition': `attachment; filename="${path.basename(name)}"`, 'cache-control': 'private, no-store' });
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
      } catch { reply(res, 404, { error: 'Download file is unavailable' }); }
      return;
    }
    if (req.method === 'GET' && /^\/jobs\/[a-f0-9-]+$/.test(req.url)) {
      const job = jobs.find((item) => item.id === req.url.slice(6));
      return reply(res, job ? 200 : 404, job || { error: 'Job not found' });
    }
    if (req.method !== 'POST' || !['/voice-updates', '/audio-jobs'].includes(req.url)) return reply(res, 404, { error: 'Not found' });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) return reply(res, 413, { error: 'Request too large' });
        chunks.push(chunk);
      }
      const normalized = normalizeRequest(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      const key = req.headers['idempotency-key'];
      if (key && (typeof key !== 'string' || !/^[\w.-]{1,128}$/.test(key))) return reply(res, 400, { error: 'Invalid Idempotency-Key' });
      const previous = key && jobs.find((job) => job.key === key);
      if (previous) return reply(res, previous.requestHash === requestHash ? 200 : 409, previous.requestHash === requestHash ? previous : { error: 'Idempotency-Key already used for different lines' });
      if (active) return reply(res, 409, { error: 'An update is already running; poll it, then retry.', jobId: active.id });
      const job = { id: randomUUID(), key, requestHash, total: normalized.lines.length, status: 'running', phase: 'queued', startedAt: new Date().toISOString(), log: '' };
      active = job;
      jobs = [...jobs.slice(-99), job];
      persist();
      reply(res, 202, job);
      void Promise.resolve().then(() => update(normalized, job.id, (progress) => {
        if (progress.log) job.log = (job.log + progress.log).slice(-16000);
        else Object.assign(job, progress);
        persist();
      })).then((result) => Object.assign(job, result, { status: 'completed', phase: 'done' }))
        .catch((error) => Object.assign(job, { status: 'failed', error: error.message }))
        .finally(() => { job.finishedAt = new Date().toISOString(); active = undefined; persist(); });
    } catch (error) { if (!res.headersSent) reply(res, 400, { error: error.message }); }
  });
  server.requestTimeout = 15_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(path.join(ROOT, 'apps/server/.env')); } catch { /* environment can be supplied by the launcher */ }
  const stateDir = path.resolve(process.env.VOICE_SERVICE_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'Chorequest', 'voice-service'));
  fs.mkdirSync(stateDir, { recursive: true });
  const tokenFile = path.join(stateDir, 'token');
  if (!fs.existsSync(tokenFile)) {
    const legacyToken = path.join(ROOT, '.cache/voice-service/token');
    fs.writeFileSync(tokenFile, fs.existsSync(legacyToken) ? fs.readFileSync(legacyToken) : randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const python = process.env.ISLAND_VOICE_PYTHON || 'python3';
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const host = process.env.VOICE_SERVICE_HOST || '127.0.0.1';
  const allowedCidr = process.env.VOICE_SERVICE_ALLOW_CIDR;
  if (host !== '127.0.0.1' && (!isIPv4(host) || host === '0.0.0.0' || !peerAllowed(host, allowedCidr))) {
    throw new Error('LAN mode requires a specific IPv4 host and VOICE_SERVICE_ALLOW_CIDR containing that address (/16 to /32).');
  }
  const server = createVoiceService({ token, allowedCidr, dataDir: stateDir, update: (request, jobId, report) => generateAudio({ request, jobId, dataDir: stateDir, python, env, report }) });
  const port = Number(process.env.VOICE_SERVICE_PORT || 8791);
  server.listen(port, host, () => console.log(`Audio download service listening on ${host}:${port}; data: ${stateDir}`));
}
