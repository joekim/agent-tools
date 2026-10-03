import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const notificationSchema = { type: 'object', additionalProperties: false, required: ['agent', 'title', 'message'], properties: {
  agent: { enum: ['claude', 'codex', 'other'] }, title: { type: 'string', minLength: 1, maxLength: 120 },
  message: { type: 'string', minLength: 1, maxLength: 2000 }, status: { enum: ['completed', 'blocked', 'failed'], default: 'completed' },
  threadId: { type: 'string', minLength: 1, maxLength: 200 }, eventId: { type: 'string', minLength: 1, maxLength: 200 }
} };
const location = config => path.join(config.artifactsDir, 'task-notifications.json');
export function readNotifications(config) {
  try { return JSON.parse(fs.readFileSync(location(config), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
export function notifyTask(input, config) {
  // Synchronous read/atomic replace serializes concurrent calls in this hub process.
  const items = readNotifications(config);
  const previous = input.eventId && items.find(n => n.eventId === input.eventId && n.agent === input.agent);
  if (previous) return { status: 'ready', id: previous.id, duplicate: true };
  const notification = { ...input, status: input.status || 'completed', id: randomUUID(), createdAt: Date.now() };
  fs.mkdirSync(config.artifactsDir, { recursive: true });
  const file = location(config), temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify([notification, ...items].slice(0, 100)), { mode: 0o600 });
  fs.renameSync(temporary, file);
  return { status: 'ready', id: notification.id, duplicate: false };
}
