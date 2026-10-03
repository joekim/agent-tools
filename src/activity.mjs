import fs from 'node:fs/promises';
import path from 'node:path';
import { profileFor } from './profile.mjs';
import { readNotifications } from './notifications.mjs';

export function summarizeJobs(kind, jobs, online, now = Date.now()) {
  const normalized = jobs.filter(j => /^[a-zA-Z0-9-]+$/.test(j.id || '')).map(j => {
    let status = ({ completed: 'finished', succeeded: 'finished', done: 'finished', ready: 'finished', running: 'generating' })[j.status] || j.status;
    if (j.phase === 'queued' && status === 'generating') status = 'queued';
    if (!['queued', 'generating', 'finished', 'failed'].includes(status)) status = 'unknown';
    if (!online && ['queued', 'generating'].includes(status)) status = 'unknown';
    const start = Date.parse(j.startedAt || j.createdAt);
    const end = Date.parse(j.finishedAt);
    return { id: j.id, kind, status, startedAt: Number.isFinite(start) ? start : null,
      elapsedSeconds: Number.isFinite(start) ? Math.max(0, Math.floor(((Number.isFinite(end) ? end : now) - start) / 1000)) : null,
      phase: ['queued', 'generating', 'validating', 'done'].includes(j.phase) ? j.phase : null };
  }).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const active = normalized.filter(j => ['queued', 'generating'].includes(j.status));
  return { kind, online, state: !online ? 'offline' : active.some(j => j.status === 'generating') ? 'generating' : active.length ? 'queued' : 'idle',
    queued: active.filter(j => j.status === 'queued').length, active,
    recent: normalized.filter(j => !active.includes(j)).slice(0, 5) };
}

export async function activitySnapshot(hub) {
  const notifications = hub.config.artifactsDir ? readNotifications(hub.config) : [];
  if (profileFor(hub.config) === 'files-only') return { nodeId: hub.config.nodeId, checkedAt: Date.now(), services: [], notifications };
  const services = await Promise.all(['image', 'voice'].map(async kind => {
    try {
      let jobs;
      if (kind === 'image') jobs = await hub.call({ name: 'media-hub.jobs' });
      else {
        const entry = hub.services.get('voice');
        if (!entry || entry.expiresAt <= Date.now() || !hub.config.voiceRuntime?.dataDir) throw new Error('Unavailable');
        await hub.probe('voice', entry);
        if (!hub.health.get('voice')?.online) throw new Error('Unavailable');
        const file = path.join(hub.config.voiceRuntime.dataDir, 'jobs.json');
        try {
          if ((await fs.stat(file)).size > 32 * 1024 * 1024) throw new Error('Job history too large');
          jobs = JSON.parse(await fs.readFile(file, 'utf8'));
        } catch (e) { if (e.code === 'ENOENT') jobs = []; else throw e; }
      }
      if (!Array.isArray(jobs)) throw new Error('Invalid job list');
      return summarizeJobs(kind, jobs, true);
    } catch { return summarizeJobs(kind, [], false); }
  }));
  return { nodeId: hub.config.nodeId, checkedAt: Date.now(), services, notifications };
}
