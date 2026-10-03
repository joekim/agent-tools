import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const projectNamePattern = '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$';
export async function createProject({ name }, config) {
  if (typeof name !== 'string' || !new RegExp(projectNamePattern).test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) throw new Error('Use a project name of 1–80 letters, numbers, hyphens or underscores; Windows reserved names are not allowed.');
  const configuredRoot = config.projectsRoot || path.join(os.homedir(), 'projects');
  if (!path.isAbsolute(configuredRoot)) throw new Error('projectsRoot must be an absolute local directory.');
  // Do not inherit Git variables that could redirect initialization elsewhere.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const options = { env, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 };
  await exec('git', ['--version'], options);
  const instructions = await fs.readFile(new URL('../docs/project-agent-instructions.md', import.meta.url), 'utf8');
  await fs.mkdir(configuredRoot, { recursive: true });
  const root = await fs.realpath(configuredRoot);
  const directory = path.join(root, name);
  try { await fs.mkdir(directory); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Project already exists; choose a different name. No existing files were changed.');
    throw error;
  }
  try {
    await exec('git', ['init', '--initial-branch=main', '--template=', '.'], { ...options, cwd: directory });
    for (const file of ['AGENTS.md', 'CLAUDE.md']) await fs.writeFile(path.join(directory, file), instructions, { flag: 'wx' });
    const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { ...options, cwd: directory });
    if ((await fs.realpath(stdout.trim())) !== directory) throw new Error('Git repository location did not match the new project.');
    return { status: 'ready', nodeId: config.nodeId, name, directory, branch: 'main', instructions: ['AGENTS.md', 'CLAUDE.md'].map(file => path.join(directory, file)), committed: false };
  } catch {
    // Preserve a partial project for inspection rather than recursively deleting it.
    return { status: 'failed', directory, error: 'Project setup was incomplete. Inspect this directory before retrying; it has been preserved.' };
  }
}
