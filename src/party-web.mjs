import os from 'node:os';
import { request } from './http.mjs';

const routes = new Set(['/', '/party', '/status', '/levels', '/skills', '/talents', '/guide', '/notes']);
export function rewritePartyLinks(html) {
  return html.replace(/href="(\/(?!\/)[^"]*)"/g, (match, value) => {
    const url = new URL(value, 'http://party.invalid');
    return routes.has(url.pathname) ? `href="/party${value}"` : match;
  }).replace('<nav>', '<nav><a href="/">Media Hub</a>');
}
export async function partyWeb(req, res, hub) {
  const reply = (status, message) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(message); };
  try {
    const url = new URL(req.url, 'http://localhost');
    const hostname = new URL(`http://${req.headers.host}`).hostname;
    const allowed = ['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(), `${os.hostname().split('.')[0].toLowerCase()}.local`];
    if (hub.config.publicUrl) allowed.push(new URL(hub.config.publicUrl).hostname);
    if (!allowed.includes(hostname)) return reply(403, 'Use the Media Hub hostname.');
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reply(403, 'Cross-origin requests are not supported.');
    if (req.method !== 'GET') return reply(405, 'Only GET is supported.');
    if (url.pathname === '/party') { res.writeHead(302, { location: '/party/' }); res.end(); return; }
    const route = url.pathname.slice('/party'.length);
    if (!routes.has(route)) return reply(404, 'Unknown party page.');
    if ([...url.searchParams].some(([key, value]) => key !== 'refresh' || value !== '1')) return reply(400, 'Only refresh=1 is supported.');
    const entry = hub.services.get('party-notes');
    if (!entry || entry.expiresAt <= Date.now()) return reply(503, 'Party notes are not configured on this hub.');
    const base = new URL(entry.manifest.baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) return reply(503, 'Party web access requires a local backend.');
    const data = await request(new URL(route + url.search, base), { timeout: 30000 });
    if (!data.contentType?.startsWith('text/html') || data.encoding !== 'base64') throw new Error('Unexpected response');
    const body = rewritePartyLinks(Buffer.from(data.data, 'base64').toString('utf8'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-popups", 'referrer-policy': 'no-referrer' });
    res.end(body);
  } catch { reply(503, 'Party notes are unavailable. Start the configured party server and retry.'); }
}
