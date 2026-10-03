import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export function shareUrl(origin, pathname = '/') {
  // Paths come from the catalog or browser. Never permit an external origin.
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || /[\\\r\n]/.test(pathname)) throw new Error('Use a local page path');
  const url = new URL(pathname, origin);
  if (url.origin !== new URL(origin).origin) throw new Error('Use a local page path');
  return url.href;
}

export async function listCollections(assetDir, publicUrl) {
  let entries;
  try { entries = await readdir(assetDir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.name)) continue;
    try { if (!(await stat(path.join(assetDir, entry.name, 'index.html'))).isFile()) continue; }
    catch { continue; }
    const pathname = `/assets/${entry.name}/`;
    result.push({ id: entry.name, name: entry.name.replaceAll('-', ' '), path: pathname, url: shareUrl(publicUrl, pathname) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function sharingScript() {
  return `(() => {
    const mount = async () => {
      const response = await fetch('/api/site');
      if (!response.ok) return;
      const site = await response.json();
      const bar = document.createElement('nav');
      bar.setAttribute('aria-label', 'Sharing');
      bar.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 0;margin-bottom:16px;font:14px system-ui';
      const url = new URL(location.pathname + location.search + location.hash, site.publicUrl).href;
      const link = document.createElement('a'); link.href = url; link.textContent = url;
      link.style.cssText = 'color:inherit;overflow-wrap:anywhere';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Copy share link';
      button.style.cssText = 'font:inherit;padding:7px 12px;cursor:pointer;border-radius:6px';
      button.addEventListener('click', async () => {
        let copied = false;
        try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); copied = true; } } catch {}
        if (!copied) {
          const input = document.createElement('textarea'); input.value = url; input.style.cssText = 'position:fixed;left:-9999px';
          document.body.append(input); input.select(); copied = document.execCommand('copy'); input.remove();
        }
        button.textContent = copied ? 'Link copied' : 'Select the link to copy';
      });
      const brand = document.createElement('a'); brand.href = '/'; brand.textContent = 'Media Hub'; brand.style.color = 'inherit';
      const agents = document.createElement('a'); agents.href = '/agents'; agents.textContent = 'AI access'; agents.style.color = 'inherit';
      bar.append(brand);
      if (site.modelUse !== false) { const controls = document.createElement('a'); controls.href = '/controls'; controls.textContent = 'Extract controls'; controls.style.color = 'inherit'; bar.append(controls); }
      bar.append(agents, button, link); document.body.prepend(bar);
      if (site.generationEnabled === false) {
        const note = document.createElement('p'); note.textContent = site.modelUse === false ? 'Files and utility tasks · no model services on this machine.' : 'Preview copy · image generation remains in the original studio.';
        note.style.cssText = 'font:14px system-ui;color:inherit'; bar.append(note);
      }
      const canonical = document.createElement('link'); canonical.rel = 'canonical'; canonical.href = url; document.head.append(canonical);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount().catch(console.error)); else mount().catch(console.error);
  })();`;
}

export function addSharing(html) {
  const script = '<script src="/sharing.js" defer></script>';
  if (html.includes('src="/sharing.js"')) return html;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, script + '</head>') : html + script;
}
