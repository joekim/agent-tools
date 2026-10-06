import path from 'node:path';
import os from 'node:os';

const projectPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export function externalTarget(input, config, directory) {
  const source = path.resolve(input.path);
  const root = config.projectsRoot || path.join(os.homedir(), 'projects');
  const localRelative = path.relative(root, source);
  const inside = localRelative && !path.isAbsolute(localRelative) && localRelative !== '..' && !localRelative.startsWith(`..${path.sep}`);
  const parts = inside ? localRelative.split(path.sep) : [];
  const inferred = parts.length > 1 || (parts.length === 1 && directory) ? parts[0] : null;
  const project = input.project || inferred;
  if (!projectPattern.test(project || '')) throw new Error('External publishing requires a project name, or a source inside projectsRoot/<project>.');
  if (inferred && inferred.toLowerCase() !== project.toLowerCase()) throw new Error('Project does not match the source project directory.');
  const relative = input.relativePath ?? (inferred ? parts.slice(1).join('/') : path.basename(source));
  if (typeof relative !== 'string' || (!relative && !directory) || relative.length > 1000 || relative.split('/').some(part => part === '.' || part === '..' || (!part && relative) || /[\\\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part))) throw new Error('relativePath must stay inside the project and use forward slashes without empty, dot, or parent segments.');
  const projectPath = `/ai-workspace/${project.toLowerCase()}`;
  return { project: project.toLowerCase(), remotePath: projectPath + (relative ? `/${relative}` : '') };
}

async function metadata(api, remote) {
  try { return await api('files/get_metadata', { path: remote }); }
  catch (error) { if (error.dropboxCode === 'not_found') return null; throw error; }
}

async function ensureFolder(api, remote) {
  const existing = await metadata(api, remote);
  if (existing) {
    if (existing['.tag'] !== 'folder') throw new Error('A file occupies a required Dropbox project directory.');
    return;
  }
  try { await api('files/create_folder_v2', { path: remote, autorename: false }); }
  catch (error) {
    if (error.dropboxCode !== 'conflict' || (await metadata(api, remote))?.['.tag'] !== 'folder') throw error;
  }
}

async function publicLink(api, remote) {
  let cursor;
  const seen = new Set();
  do {
    const response = await api('sharing/list_shared_links', cursor ? { cursor } : { path: remote, direct_only: true });
    const link = response.links?.find(link => link.link_permissions?.resolved_visibility?.['.tag'] === 'public');
    if (link) return link;
    if (!response.has_more) return null;
    cursor = response.cursor;
    if (!cursor || seen.has(cursor)) throw new Error('Dropbox returned an invalid shared-link cursor.');
    seen.add(cursor);
  } while (true);
}

// Updates are revision-checked: concurrent changes fail rather than silently overwriting.
// Folder publication is additive; omitted remote files are never deleted.
export async function publishProject(api, target, files, directory, readFile) {
  const remote = target.remotePath;
  const folders = new Set();
  const uploads = [];
  for (const file of files) {
    const destination = directory ? `${remote}/${file.name}` : remote;
    const segments = destination.split('/').slice(1, -1);
    for (let i = 1; i <= segments.length; i++) folders.add('/' + segments.slice(0, i).join('/'));
    uploads.push({ file, destination });
  }
  for (const folder of folders) await ensureFolder(api, folder);
  const revisions = [];
  for (const { file, destination } of uploads) {
    const existing = await metadata(api, destination);
    if (existing && (existing['.tag'] !== 'file' || !existing.rev)) throw new Error('Dropbox destination is not an updateable file.');
    const uploaded = await api('files/upload', {
      path: destination, mode: existing ? { '.tag': 'update', update: existing.rev } : 'add',
      autorename: false, strict_conflict: true, mute: true,
    }, await readFile(file));
    revisions.push({ path: destination, rev: uploaded.rev, action: existing ? 'updated' : 'created' });
  }
  let link = await publicLink(api, remote);
  if (!link) {
    try { link = await api('sharing/create_shared_link_with_settings', { path: remote, settings: { requested_visibility: 'public' } }); }
    catch (error) {
      if (error.dropboxCode !== 'shared_link_already_exists') throw error;
      link = await publicLink(api, remote);
    }
  }
  if (link?.link_permissions?.resolved_visibility?.['.tag'] !== 'public') throw new Error('Dropbox did not grant public link access; check account sharing policy.');
  const url = new URL(link.url);
  if (url.protocol !== 'https:' || !/(^|\.)dropbox\.com$/i.test(url.hostname) || url.username || url.password) throw new Error('Dropbox returned an unexpected share URL.');
  const download = new URL(url); download.searchParams.delete('raw'); download.searchParams.set('dl', '1');
  return { url: url.href, downloadUrl: download.href, revisions };
}
