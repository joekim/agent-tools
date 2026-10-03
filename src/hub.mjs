import http from 'node:http';
import os from 'node:os';
import { createHash, timingSafeEqual } from 'node:crypto';
import Ajv from 'ajv';
import { readJson, request } from './http.mjs';
import { builtinTools, detectServices } from './catalog.mjs';
import { runBuiltin, builtinStatus } from './builtins.mjs';
import { resolveToken } from './credentials.mjs';
import { permitsTool, profileFor } from './profile.mjs';
import { servePublication } from './publishing.mjs';
import { controlWeb } from './control-web.mjs';
import { activitySnapshot } from './activity.mjs';
import { partyWeb } from './party-web.mjs';

const ajv = new Ajv({ strict: false, allErrors: true });
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = s => createHash('sha256').update(s).digest();
const tokenFor = resolveToken;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

export function validateService(s, config, dynamic = false) {
  if (!s || typeof s.id !== 'string' || !namePattern.test(s.id) || ['desktop', 'youtube'].includes(s.id) || typeof s.description !== 'string') throw failure('Invalid service identity');
  const u = new URL(s.baseUrl);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw failure('Service URL must be an HTTP(S) origin');
  if (dynamic && !(config.allowedServiceOrigins || []).includes(u.origin)) throw failure('Service origin is not approved in allowedServiceOrigins', 403);
  if (dynamic && (s.tokenFile || s.token || s.credential)) throw failure('Configure service credentials locally, never in registration payloads');
  if (typeof s.healthPath !== 'string' || !s.healthPath.startsWith('/') || s.healthPath.startsWith('//')) throw failure('A healthPath is required');
  if (!s.operations || !Object.keys(s.operations).length || Object.keys(s.operations).length > 50) throw failure('Service needs 1–50 named operations');
  for (const [name, op] of Object.entries(s.operations)) {
    if (!namePattern.test(name) || !['GET', 'POST'].includes(op.method) || !/^\/(?!\/)/.test(op.path) || typeof op.description !== 'string') throw failure('Invalid service operation');
    if (!op.inputSchema || op.inputSchema.type !== 'object') throw failure('Operation inputSchema must describe an object');
    ajv.compile(op.inputSchema);
    if (new URL(op.path, u).origin !== u.origin) throw failure('Operation must stay on service origin');
  }
  if (new URL(s.healthPath, u).origin !== u.origin) throw failure('Health check must stay on service origin');
  return structuredClone(s);
}

export class Hub {
  constructor(config) {
    if (typeof config.nodeId !== 'string' || !namePattern.test(config.nodeId)) throw failure('Invalid nodeId');
    if (!config.token || config.token.length < 32) throw failure('Hub needs a strong token');
    this.config = config;
    this.leaseMs = config.leaseMs || 45000;
    this.services = new Map(); this.peers = new Map(); this.health = new Map();
    this.builtins = builtinTools(config);
    this.builtinHealth = new Map();
    for (const s of [...(config.autoDetect === false ? [] : detectServices(config)), ...(config.services || [])]) this.services.set(s.id, { manifest: validateService(s, config), expiresAt: Infinity });
    for (const p of config.peers || []) {
      if (!namePattern.test(p.id) || p.id === config.nodeId || this.peers.has(p.id)) throw failure('Peers need distinct node IDs');
      const u = new URL(p.url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw failure('Peer URL must be an HTTP(S) origin');
      this.peers.set(p.id, { config: p, lastSeen: 0, tools: [], error: 'Not yet contacted' });
    }
    this.server = http.createServer((req, res) => this.dispatch(req, res));
    this.server.requestTimeout = 15000;
  }
  register(manifest) {
    const s = validateService(manifest, this.config, true);
    const previous = this.services.get(s.id);
    if (previous?.expiresAt === Infinity) throw failure('Service ID belongs to local configuration', 409);
    if (!previous && this.services.size >= 200) throw failure('Registration limit reached', 429);
    this.services.set(s.id, { manifest: s, expiresAt: Date.now() + this.leaseMs });
    return { id: s.id, leaseMs: this.leaseMs, renewWithinMs: Math.floor(this.leaseMs / 3) };
  }
  async probe(id, entry) {
    if (entry.expiresAt <= Date.now()) { this.services.delete(id); this.health.delete(id); return; }
    try {
      await request(new URL(entry.manifest.healthPath, entry.manifest.baseUrl), { token: tokenFor(entry.manifest), timeout: 2500 });
      this.health.set(id, { online: true, checkedAt: Date.now() });
    } catch { this.health.set(id, { online: false, checkedAt: Date.now(), error: 'Service health check failed; check its process, address and local credential' }); }
  }
  localTools() {
    const tools = this.builtins.map(t => ({ ...t, nodeId: this.config.nodeId, platform: os.platform(), online: false, ...this.builtinHealth.get(t.name) }));
    for (const [id, { manifest: s, expiresAt }] of this.services) {
      if (expiresAt <= Date.now()) continue;
      const h = this.health.get(id);
      for (const [operation, op] of Object.entries(s.operations)) tools.push({ name: `${id}.${operation}`, modelUse: op.modelUse, service: id, operation, nodeId: this.config.nodeId, platform: os.platform(), description: `${s.description} ${op.description}`, inputSchema: op.inputSchema, online: !!h?.online && Date.now() - h.checkedAt < this.leaseMs, checkedAt: h?.checkedAt, error: h?.error });
    }
    return tools.filter(t => permitsTool(this.config, t));
  }
  snapshot() { return { protocolVersion: 1, nodeId: this.config.nodeId, platform: os.platform(), profile: profileFor(this.config), tools: this.localTools() }; }
  catalog() {
    const nodes = [{ nodeId: this.config.nodeId, platform: os.platform(), profile: profileFor(this.config), online: true }];
    const tools = this.localTools();
    for (const [id, peer] of this.peers) {
      const online = Date.now() - peer.lastSeen < this.leaseMs;
      nodes.push({ nodeId: id, online, lastSeen: peer.lastSeen || null, error: peer.error });
      tools.push(...peer.tools.filter(t => permitsTool(this.config, t)).map(t => ({ ...t, online: online && t.online })));
    }
    return { nodes, tools };
  }
  async syncPeer(peer) {
    try {
      const auth = { token: tokenFor(peer.config), timeout: 3000 };
      // Both sides must explicitly trust the other's ID and hold its token.
      await request(new URL('/v1/peers/heartbeat', peer.config.url), { ...auth, method: 'POST', body: { nodeId: this.config.nodeId } });
      const snapshot = await request(new URL('/v1/snapshot', peer.config.url), auth);
      if (snapshot.protocolVersion !== 1 || snapshot.nodeId !== peer.config.id || !Array.isArray(snapshot.tools) || snapshot.tools.length > 10000 || snapshot.tools.some(t => t.nodeId !== peer.config.id || !namePattern.test(t.name))) throw new Error('Peer identity or catalog mismatch');
      peer.tools = snapshot.tools; peer.lastSeen = Date.now(); peer.error = undefined;
    } catch { peer.error = 'Peer unavailable or authentication failed'; }
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try { await Promise.all([...this.services].map(([id, s]) => this.probe(id, s)).concat([...this.peers.values()].map(p => this.syncPeer(p)), this.builtins.map(async t => this.builtinHealth.set(t.name, await builtinStatus(t, this.config))))); }
    finally { this.ticking = false; }
  }
  async call({ nodeId = this.config.nodeId, name, input = {} }, localOnly = false) {
    if (name === 'youtube.transcript') name = 'media-hub.transcript';
    if (this.config.imageStudio?.enabled && name?.startsWith('image-studio.')) name = name.replace('image-studio.', 'media-hub.');
    const candidate = nodeId === this.config.nodeId ? this.localTools().find(t=>t.name===name) : this.peers.get(nodeId)?.tools.find(t=>t.name===name);
    if (!permitsTool(this.config, candidate || { name })) throw failure('Model or unclassified operations are unavailable in the files-only profile', 403);
    if (nodeId !== this.config.nodeId) {
      if (localOnly) throw failure('Peer calls cannot be forwarded again', 400);
      const peer = this.peers.get(nodeId);
      if (!peer || Date.now() - peer.lastSeen >= this.leaseMs) throw failure('Owning node is offline or unknown', 503);
      const response = await request(new URL('/v1/call-local', peer.config.url), { token: tokenFor(peer.config), method: 'POST', body: { nodeId, name, input }, timeout: 130000 });
      return response.result;
    }
    const tool = this.localTools().find(t => t.name === name);
    if (!tool) throw failure('Unknown or expired tool', 404);
    const validate = ajv.compile(tool.inputSchema);
    if (!validate(input)) throw failure(`Invalid input: ${ajv.errorsText(validate.errors)}`);
    if (!tool.service) {
      if (!tool.online) throw failure(tool.error || 'Tool unavailable', 503);
      return runBuiltin(name, input, this.config);
    }
    const entry = this.services.get(tool.service);
    await this.probe(tool.service, entry);
    if (!this.health.get(tool.service)?.online) throw failure('Service is offline', 503);
    const s = entry.manifest, op = s.operations[tool.operation];
    const body = { ...input };
    const pathname = op.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input[key])) throw failure(`Invalid path parameter: ${key}`);
      delete body[key]; return encodeURIComponent(input[key]);
    });
    return request(new URL(pathname, s.baseUrl), { token: tokenFor(s), method: op.method, ...(op.method === 'POST' ? { body } : {}), timeout: 120000 });
  }
  async handle(req, res) {
    try {
      if (req.headers.origin) throw failure('Browser-origin requests are not supported', 403);
      if (!timingSafeEqual(digest(req.headers.authorization || ''), digest(`Bearer ${this.config.token}`))) throw failure('Unauthorized', 401);
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, nodeId: this.config.nodeId });
      if (req.method === 'GET' && url.pathname === '/v1/snapshot') return json(res, 200, this.snapshot());
      if (req.method === 'GET' && url.pathname === '/v1/catalog') return json(res, 200, this.catalog());
      if (req.method === 'GET' && url.pathname === '/v1/activity') {
        // Share one short-lived snapshot across viewers; never resubmit generation.
        if (!this.activityCache || Date.now() - this.activityCache.time > 2000) {
          this.activityCache = { time: Date.now(), value: activitySnapshot(this) };
        }
        return json(res, 200, await this.activityCache.value);
      }
      if (req.method === 'POST' && url.pathname === '/v1/peers/heartbeat') {
        const { nodeId } = await readJson(req, 4096);
        if (!this.peers.has(nodeId)) throw failure('Peer is not trusted; configure it locally first', 403);
        return json(res, 200, { nodeId: this.config.nodeId, leaseMs: this.leaseMs });
      }
      if (req.method === 'POST' && url.pathname === '/v1/services/register') return json(res, 200, this.register(await readJson(req, 65536)));
      if (req.method === 'POST' && ['/v1/call', '/v1/call-local'].includes(url.pathname)) return json(res, 200, { result: await this.call(await readJson(req), url.pathname === '/v1/call-local') });
      throw failure('Not found', 404);
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.code === 'ENOENT' ? 'Required local executable or file is missing' : error.message }); }
  }
  dispatch(req, res) {
    if (req.url.split('?')[0].startsWith('/shared/')) return void servePublication(req, res, this.config);
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { return json(res, 400, { error: 'Invalid request URL' }); }
    if (pathname === '/controls' || pathname === '/api/controls' || pathname.startsWith('/api/controls/')) return void controlWeb(req, res, this);
    if (pathname === '/party' || pathname.startsWith('/party/')) return void partyWeb(req, res, this);
    // Task routes always enter the authenticated handler, regardless of method.
    if (!this.sharedStudio || pathname === '/health' || pathname === '/v1' || pathname.startsWith('/v1/')) return this.handle(req, res);
    this.sharedStudio.emit('request', req, res);
  }
  async start() {
    if (this.config.imageStudio?.enabled && this.config.imageStudio.sharedPort) {
      const { createImageServer } = await import('../services/image-studio/image-server/server.mjs');
      const { studioSettings } = await import('../services/image-studio/settings.mjs');
      this.sharedStudio = await createImageServer(studioSettings({ ...this.config.imageStudio, profile: profileFor(this.config) }));
    }
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.config.port, this.config.host, resolve); });
    if (this.sharedStudio) {
      const media = this.services.get('media-hub');
      if (media) { media.manifest.baseUrl = `http://127.0.0.1:${this.server.address().port}`; media.manifest.healthPath = '/api/site'; }
    } else if (this.config.imageStudio?.enabled) {
      try {
        const port = this.config.imageStudio.port || 3002;
        let existing;
        try { existing = await request(`http://127.0.0.1:${port}/health`, { timeout: 1500 }); } catch { /* start below */ }
        if (!['image-studio', 'media-hub'].includes(existing?.service)) {
          const { startImageStudio } = await import('../services/image-studio/image-server/server.mjs');
          this.studioServer = await startImageStudio();
        }
      } catch (error) { console.error(`Media Hub startup failed: ${error.message}`); }
    }
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.peerIntervalMs || 15000);
    this.timer.unref();
    return this.server.address();
  }
  async close() {
    clearInterval(this.timer);
    if (this.studioServer) {
      this.studioServer.closeAllConnections();
      await new Promise(resolve => this.studioServer.close(resolve));
    }
    this.server.closeAllConnections();
    await new Promise(resolve => this.server.close(resolve));
  }
}
