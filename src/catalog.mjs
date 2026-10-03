import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { profileFor } from './profile.mjs';
import { projectNamePattern } from './projects.mjs';

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string', minLength: 1 };
const job = object({ id: { type: 'string', pattern: '^[a-zA-Z0-9-]+$' } }, ['id']);
export function detectServices(config) {
  const root = config.projectsRoot;
  const services = [];
  const models = profileFor(config) !== 'files-only';
  if (config.imageStudio?.enabled || fs.existsSync(path.join(root, 'yue2-music', 'image-server', 'server.mjs'))) services.push({
    id: config.imageStudio?.enabled ? 'media-hub' : 'image-studio', description: 'Media Hub: shared media, files and galleries, with callable tasks for AI agents. YouTube transcripts are available through media-hub.transcript. Use site/library for stable hostname-based links.',
    baseUrl: `http://127.0.0.1:${config.imageStudio?.sharedPort ? config.port : config.imageStudio?.port || (config.imageStudio?.enabled ? 3002 : 3001)}`, healthPath: config.imageStudio?.enabled ? '/api/site' : '/api/configurations',
    operations: {
      ...(config.imageStudio?.enabled ? {
        site: { method: 'GET', path: '/api/site', description: 'Get stable local-network links to Media Hub, galleries and agent instructions. Share hostname URLs, never a numeric IP.', inputSchema: object({}) },
        capabilities: { method: 'GET', path: '/api/capabilities', description: 'Read Media Hub capabilities and integration status; planned features are not callable yet.', inputSchema: object({}) },
        library: { method: 'GET', path: '/api/library', description: 'List shared galleries with stable hostname-based links.', inputSchema: object({}) }
      } : {}),
      ...(models ? { configurations: { method: 'GET', path: '/api/configurations', description: 'List installed image model configurations.', inputSchema: object({}) } } : {}),
      jobs: { method: 'GET', path: '/api/jobs', description: 'List saved image jobs.', inputSchema: object({}) },
      job: { method: 'GET', path: '/api/jobs/{id}', description: 'Poll image job status.', inputSchema: job },
      download: { method: 'GET', path: '/images/{id}/image.png', description: 'Download completed image as base64.', inputSchema: job },
      ...(models && (!config.imageStudio?.enabled || config.imageStudio.generationEnabled === true) ? {
        generate: { method: 'POST', path: '/api/jobs', description: 'Submit an image job; returns an ID to poll. Read configurations first. Payload follows Image Studio API.', inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: text, mode: { enum: ['generate', 'edit', 'img2img', 'inpaint'] } }, additionalProperties: true } }
      } : {})
    }
  });
  const voiceToken = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'Chorequest', 'voice-service', 'token');
  if (models && fs.existsSync(path.join(root, 'chorequest', 'tools', 'voice-update-service.mjs'))) services.push({
    id: 'voice', description: 'Qwen3 Aiden voice generation. Submit lines, poll job, then download audio.',
    baseUrl: 'http://127.0.0.1:8791', tokenFile: voiceToken, healthPath: '/health',
    operations: {
      generate: { method: 'POST', path: '/audio-jobs', description: 'Generate Ogg audio from up to 1000 spoken lines; returns job ID.', inputSchema: object({ lines: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string', minLength: 1, maxLength: 300 } } }, ['lines']) },
      job: { method: 'GET', path: '/jobs/{id}', description: 'Poll voice job status and retrieve download information.', inputSchema: job },
      download: { method: 'GET', path: '/jobs/{id}/audio.zip', description: 'Download completed audio archive as base64.', inputSchema: job }
    }
  });
  return services;
}

export function builtinTools(config) {
  const tools = [{
    name: 'media-hub.create-project', modelUse: false, description: 'Create a new project on THIS node under its configured projectsRoot (default ~/projects), initialize Git on main, and install shared AGENTS.md and CLAUDE.md instructions. Takes a simple folder name; refuses existing paths. Does not commit, publish, or create a remote repository. Inspect preserved directory if status is failed.',
    inputSchema: object({ name: { type: 'string', pattern: projectNamePattern } }, ['name'])
  }, {
    name: 'media-hub.publish', modelUse: false, description: 'Publish an absolute file/folder path belonging to THIS node. Defaults to a mobile-friendly same-network hostname link. Explicit audience external uploads to Dropbox /ai-workspace and creates a public share link. Copies outputs; does not change source. Limit 100 MiB/500 files; no hidden files or symlinks. Return a link only when status is ready; inspect failed remotePath before retrying.',
    inputSchema: object({ path: text, audience: { enum: ['lan', 'external'], default: 'lan' }, title: { type: 'string', maxLength: 200 } }, ['path'])
  }, {
    name: 'media-hub.diagnostics', modelUse: false, description: 'Check LAN hostname, sharing endpoint, writable storage, optional source path, and Dropbox read access. Optional probeExternal uploads a synthetic diagnostic file, tests a public link, then revokes/deletes it. Local checks cannot verify phone reachability.',
    inputSchema: object({ path: text, probeExternal: { type: 'boolean', default: false } })
  }, {
    name: 'media-hub.transcript', description: 'Media Hub task: download available YouTube transcripts using yt-dlp; saves VTT and text and returns transcript text. Does not transcribe audio when captions are absent.',
    inputSchema: object({ url: text, language: { type: 'string', pattern: '^[a-zA-Z0-9-]{2,20}$', default: 'en' } }, ['url'])
  }];
  if (config.controlExtraction && profileFor(config) !== 'files-only') tools.push({
    name: 'media-hub.extract-control', modelUse: true,
    description: 'Extract depth, canny edges, or human pose from an absolute image/video path on THIS Windows node. Returns a job ID; poll media-hub.control-job. Does not generate LTX video. Publish the ready output directory with media-hub.publish for mobile access. Do not resubmit after an ambiguous timeout.',
    inputSchema: object({ path: text, mode: { enum: ['depth', 'canny', 'pose'], default: 'depth' }, maxFrames: { type: 'integer', minimum: 1, maximum: 145, default: 145 }, resolution: { type: 'integer', enum: [256, 512, 768], default: 512 } }, ['path'])
  }, {
    name: 'media-hub.control-job', modelUse: true,
    description: 'Poll control extraction by returned ID. Ready results include PNG image or video frame directory. Unknown status after interruption requires inspection, not automatic resubmission.',
    inputSchema: job
  });
  if (os.platform() === 'win32' && fs.existsSync(path.join(config.legacyToolsRoot, 'hotkeys', 'hotkeys.json'))) tools.push({
    name: 'desktop.hotkeys', description: 'List the Windows hotkey bindings and their configured commands. This does not prove the listener is running.', inputSchema: object({})
  });
  if (['win32', 'darwin'].includes(os.platform())) tools.push({
    name: 'desktop.screenshot', description: 'Capture the desktop of THIS tool’s owning machine; saves a PNG. macOS requires Screen Recording permission.', inputSchema: object({})
  });
  return tools;
}
