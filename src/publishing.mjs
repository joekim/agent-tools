import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { dropboxClient } from './dropbox.mjs';
import { externalTarget, publishProject } from './project-publishing.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const encode = value => value.split('/').map(encodeURIComponent).join('/');
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.vtt': 'text/plain; charset=utf-8' };
export const publicationRoot = config => path.join(config.artifactsDir, 'publications');
export function lanOrigin(config) {
  const u = new URL(config.publicUrl);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash || isIP(u.hostname.replace(/^\[|\]$/g, '')) || /^(localhost|.*\.localhost)$/i.test(u.hostname)) throw new Error('Configure publicUrl with this machine’s LAN hostname, not localhost or a numeric IP.');
  return u.origin;
}
export async function inspectPath(source) {
  if (!path.isAbsolute(source)) throw new Error('Pass an absolute path on the selected hub’s machine.');
  const files = []; let total = 0;
  async function walk(file, relative, depth = 0) {
    const name = path.basename(file);
    if (depth > 20 || name.startsWith('.') || /^(node_modules|credentials?(\..*)?|secrets?(\..*)?|id_rsa|id_ed25519)$/i.test(name) || /\.(pem|key|pfx|p12)$/i.test(name)) throw new Error('Path includes hidden, credential, dependency, or excessively nested content. Select a dedicated output file/folder.');
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Symlinks are not published. Select the actual output file/folder.');
    if (stat.isDirectory()) {
      for (const child of await fs.readdir(file)) await walk(path.join(file, child), relative ? `${relative}/${child}` : child, depth + 1);
    } else if (stat.isFile()) {
      total += stat.size;
      if (total > 100 * 1024 * 1024 || files.length >= 500) throw new Error('Publish limit is 100 MiB total and 500 files. Select a smaller output.');
      files.push({ source: file, name: relative || name, size: stat.size });
    } else throw new Error('Only regular files and folders can be published.');
  }
  await walk(source, '');
  if (!files.length) throw new Error('The selected folder has no files.');
  return { files, bytes: total, directory: (await fs.stat(source)).isDirectory() };
}

export async function publish(input, config, dependencies = {}) {
  const audience = input.audience || 'lan';
  if (!['lan', 'external'].includes(audience)) throw new Error('Unknown sharing audience.');
  const origin = audience === 'lan' ? lanOrigin(config) : null;
  const inventory = await inspectPath(input.path);
  if (audience === 'lan' && (input.project !== undefined || input.relativePath !== undefined)) throw new Error('project and relativePath apply only to external publishing.');
  const target = audience === 'external' ? externalTarget(input, config, inventory.directory) : null;
  const id = randomUUID();
  const root = publicationRoot(config);
  const staging = path.join(root, `.pending-${id}`);
  const destination = path.join(root, id);
  await fs.mkdir(path.join(staging, 'files'), { recursive: true });
  try {
    for (const file of inventory.files) {
      const target = path.join(staging, 'files', file.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Read a snapshot; never serve the caller's live filesystem directly.
      const current = await fs.lstat(file.source);
      if (!current.isFile() || current.isSymbolicLink() || current.size !== file.size) throw new Error('Source changed during publication; try again when the output is stable.');
      await fs.copyFile(file.source, target);
    }
    const record = { id, audience, title: input.title || path.basename(input.path), createdAt: new Date().toISOString(), files: inventory.files.map(({ name, size }) => ({ name, size })), bytes: inventory.bytes };
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(record));
    await fs.rename(staging, destination);
    if (audience === 'external') {
      const remote = target.remotePath;
      try {
        const api = await (dependencies.dropboxClient || dropboxClient)(config);
        Object.assign(record, await publishProject(api, target, record.files, inventory.directory, file => fs.readFile(path.join(destination, 'files', file.name))));
        record.remotePath = remote; record.project = target.project;
      } catch (error) {
        record.status = 'failed'; record.remotePath = remote;
        await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(record));
        return { status: 'failed', audience, id, remotePath: remote, error: error.message, remedy: 'Inspect this Dropbox destination before retrying; uploaded files may remain. No share link has been confirmed.' };
      }
    } else record.url = `${origin}/shared/${id}/`;
    record.status = 'ready';
    await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(record));
    return { status: 'ready', audience, id, url: record.url, files: record.files.length, bytes: record.bytes, ...(record.remotePath ? { project: record.project, remotePath: record.remotePath, downloadUrl: record.downloadUrl, revisions: record.revisions } : { mobileAccess: 'Same network; the host must be awake. Phone reachability has not been tested.' }) };
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}

export async function diagnostics(input, config, dependencies = {}) {
  const checks = {};
  try {
    const origin = lanOrigin(config);
    const addresses = await lookup(new URL(origin).hostname, { all: true });
    if (!addresses.length || addresses.every(a => a.address === '::1' || a.address.startsWith('127.'))) throw new Error('LAN hostname resolves only to loopback.');
    const response = await fetch(`${origin}/shared/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const body = await response.json();
    if (!response.ok || body.nodeId !== config.nodeId || body.service !== 'media-hub-sharing') throw new Error('Hostname does not reach this Media Hub sharing service.');
    await fs.mkdir(publicationRoot(config), { recursive: true });
    const probe = path.join(publicationRoot(config), `.probe-${randomUUID()}`);
    await fs.writeFile(probe, ''); await fs.unlink(probe);
    checks.lan = { status: 'passed-local-check', url: origin, mobileVerified: false, note: 'Check the link once on your phone on the same network; local checks cannot verify phone DNS, firewall or Wi-Fi isolation.' };
  } catch (error) { checks.lan = { status: 'failed', error: error.message }; }
  if (input.path) {
    try { const result = await inspectPath(input.path); checks.path = { status: 'passed', files: result.files.length, bytes: result.bytes }; }
    catch (error) { checks.path = { status: 'failed', error: error.message }; }
  }
  try {
    const api = await (dependencies.dropboxClient || dropboxClient)(config);
    const metadata = await api('files/get_metadata', { path: '/ai-workspace' });
    if (metadata['.tag'] !== 'folder') throw new Error('Dropbox /ai-workspace must be a folder.');
    await api('sharing/list_shared_links', { path: '/ai-workspace', direct_only: true });
    checks.dropbox = { status: 'read-access-verified', destination: '/ai-workspace', writeAndPublicLinkVerified: false, note: 'Read-only diagnostic. Set probeExternal=true to test upload and public-link creation with a temporary synthetic file.' };
    if (input.probeExternal) {
      const remote = `/ai-workspace/media-hub-diagnostic-${randomUUID()}.txt`;
      let link;
      try {
        await api('files/upload', { path: remote, mode: 'add', autorename: false, mute: true }, Buffer.from('Media Hub sharing diagnostic. No user data.'));
        link = await api('sharing/create_shared_link_with_settings', { path: remote, settings: { requested_visibility: 'public' } });
        if (link.link_permissions?.resolved_visibility?.['.tag'] !== 'public') throw new Error('Dropbox account policy prevents public share links.');
        checks.dropbox = { status: 'verified', destination: '/ai-workspace', writeAndPublicLinkVerified: true };
      } finally {
        const cleanup = [];
        if (link?.url) { try { await api('sharing/revoke_shared_link', { url: link.url }); } catch { cleanup.push('Could not revoke diagnostic link'); } }
        try { await api('files/delete_v2', { path: remote }); } catch { cleanup.push('Could not delete diagnostic file'); }
        if (cleanup.length) checks.cleanup = { status: 'attention-needed', remotePath: remote, errors: cleanup };
      }
    }
  } catch (error) { checks.dropbox = { status: 'unavailable', error: error.message }; }
  return { nodeId: config.nodeId, defaultAudience: 'lan', checks };
}

export async function servePublication(req, res, config) {
  const send = (status, body, type = 'text/plain; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : body); };
  if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed');
  const pathname = new URL(req.url, 'http://hub').pathname;
  const viewerAssets = {
    '/shared/viewer/model-viewer.js': new URL('../node_modules/@google/model-viewer/dist/model-viewer.min.js', import.meta.url),
    '/shared/viewer/animation-preview.js': new URL('./web/animation-preview.js', import.meta.url),
  };
  if (Object.hasOwn(viewerAssets, pathname)) {
    try { return send(200, await fs.readFile(viewerAssets[pathname]), 'text/javascript; charset=utf-8'); }
    catch { return send(404, 'Viewer unavailable'); }
  }
  if (pathname === '/shared/health') return send(200, JSON.stringify({ service: 'media-hub-sharing', nodeId: config.nodeId }), 'application/json');
  try {
    const match = /^\/shared\/([a-f0-9-]{36})\/(.*)$/.exec(pathname);
    if (!match) return send(404, 'Not found');
    const dir = path.join(publicationRoot(config), match[1]);
    const record = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    if (record.audience !== 'lan' || record.status !== 'ready') return send(404, 'Not found');
    if (!match[2]) {
      const items = record.files.map(file => {
        const href = `files/${encode(file.name)}`; const type = types[path.extname(file.name).toLowerCase()] || '';
        const media = path.extname(file.name).toLowerCase() === '.glb' ? `<section class="model-preview" data-src="${href}" data-name="${escape(file.name)}"><div class="model-host"></div><p class="model-status" role="status">Loading 3D preview…</p><div class="model-controls"><label>Animation <select class="model-clips" disabled><option>Loading…</option></select></label><button class="model-play" disabled>Play</button><button class="model-rest" disabled>Rest pose</button><label>Speed <select class="model-speed" disabled><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div><label class="model-timeline">Timeline <input class="model-seek" type="range" min="0" max="1" step="0.01" value="0" disabled><output class="model-time">0.00 / 0.00 s</output></label><noscript>Enable JavaScript for the interactive model preview.</noscript></section>` : type.startsWith('image/') ? `<img loading="lazy" src="${href}" alt="${escape(file.name)}">` : type.startsWith('video/') ? `<video controls preload="metadata" src="${href}"></video>` : type.startsWith('audio/') ? `<audio controls preload="metadata" src="${href}"></audio>` : '';
        return `<article>${media}<a href="${href}">${escape(file.name)}</a></article>`;
      }).join('');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; worker-src blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      return send(200, `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(record.title)} · Media Hub</title><style>body{font:17px system-ui;max-width:960px;margin:auto;padding:24px;background:#111827;color:#eee}a{color:#93c5fd;overflow-wrap:anywhere}article{padding:20px;margin:16px 0;background:#1f2937;border-radius:12px}img,video,audio{display:block;max-width:100%;max-height:65vh;margin-bottom:12px}model-viewer{display:block;width:100%;height:60vh;min-height:300px;max-height:640px;background:#303744;border-radius:8px}.model-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end}.model-controls label{display:grid;gap:5px}button,select{font:inherit;padding:10px;border-radius:6px;max-width:100%}.model-clips{max-width:min(70vw,360px)}.model-timeline{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}.model-seek{flex:1;min-width:120px}.model-time{font-variant-numeric:tabular-nums}button:disabled,select:disabled{opacity:.55}</style><script type="module" src="/shared/viewer/animation-preview.js"></script><h1>${escape(record.title)}</h1><p>Media Hub · ${record.files.length} files</p>${items}</html>`, 'text/html; charset=utf-8');
    }
    if (!match[2].startsWith('files/')) return send(404, 'Not found');
    const name = decodeURIComponent(match[2].slice(6));
    if (!record.files.some(f => f.name === name) || name.split(/[\\/]/).some(p => p === '..' || p === '.') || name.includes('\\')) return send(404, 'Not found');
    const file = path.join(dir, 'files', name); const stat = await fs.stat(file);
    const type = types[path.extname(name).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'accept-ranges': 'bytes', 'content-length': stat.size };
    if (type === 'application/octet-stream') headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`;
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) return send(416, 'Invalid range');
      start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end || start >= stat.size) return send(416, 'Invalid range');
      status = 206; headers['content-range'] = `bytes ${start}-${end}/${stat.size}`; headers['content-length'] = end - start + 1;
    }
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !stat.size) return res.end();
    const stream = createReadStream(file, { start, end }); stream.on('error', () => res.destroy()); stream.pipe(res);
  } catch { if (!res.headersSent) send(404, 'Not found'); else res.destroy(); }
}

