import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

const mediaTypes = {
  md: 'text/plain; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  glb: 'model/gltf-binary', blend: 'application/octet-stream', mp4: 'video/mp4',
};

// Publish only curated copies under assets/, never an arbitrary workspace path.
export async function serveAsset(pathname, res, assetDir, range, transformHtml = html => html) {
  if (pathname !== '/assets' && !pathname.startsWith('/assets/')) return false;
  const slug = '[a-z0-9][a-z0-9-]{0,79}';
  let relative, type, filename;
  if (pathname === '/assets' || pathname === '/assets/') {
    relative = 'index.html'; type = 'text/html; charset=utf-8';
  } else {
    const collection = pathname.match(new RegExp(`^/assets/(${slug})/?$`));
    const file = pathname.match(new RegExp(`^/assets/(${slug})/(${slug})\\.(png|jpg|jpeg|webp|glb|blend|md|mp4)$`));
    if (collection) {
      relative = path.join(collection[1], 'index.html'); type = 'text/html; charset=utf-8';
    } else if (file) {
      filename = `${file[2]}.${file[3]}`;
      relative = path.join(file[1], filename); type = mediaTypes[file[3]];
    } else {
      throw Object.assign(new Error('Asset not found.'), { status: 404 });
    }
  }
  const root = await realpath(assetDir);
  const target = await realpath(path.join(root, relative));
  const resolved = path.relative(root, target);
  if (resolved.startsWith('..' + path.sep) || resolved === '..' || path.isAbsolute(resolved)) {
    throw Object.assign(new Error('Asset not found.'), { status: 404 });
  }
  let bytes = await readFile(target);
  if (type.startsWith('text/html')) bytes = Buffer.from(transformHtml(bytes.toString('utf8')));
  const headers = { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' };
  if (type === 'video/mp4') {
    headers['Accept-Ranges'] = 'bytes';
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0, end = bytes.length - 1;
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      } else start = bytes.length;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}`, 'Content-Length': 0 });
        res.end(); return true;
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers); res.end(bytes.subarray(start, end + 1));
      return true;
    }
  }
  if (filename && /\.(glb|blend)$/.test(filename)) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  res.writeHead(200, headers); res.end(bytes);
  return true;
}
