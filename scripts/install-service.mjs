import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { home, readConfig } from '../src/config.mjs';
import { request } from '../src/http.mjs';

const runner = fileURLToPath(new URL('./run-service.mjs', import.meta.url));
const c = readConfig();
fs.mkdirSync(home, { recursive: true });
if (process.platform === 'win32') {
  const startup = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AgentToolsHub.vbs');
  const command = `"${process.execPath}" "${runner}"`;
  fs.writeFileSync(startup, `CreateObject("WScript.Shell").Run "${command.replaceAll('"', '""')}", 0, False\r\n`);
  let running = false;
  try { running = (await request(`http://127.0.0.1:${c.port}/health`, { token: c.token, timeout: 1500 })).nodeId === c.nodeId; } catch { /* start */ }
  if (!running) {
    const out = fs.openSync(path.join(home, 'stdout.log'), 'a');
    const err = fs.openSync(path.join(home, 'stderr.log'), 'a');
    const child = spawn(process.execPath, [runner], { detached: true, windowsHide: true, stdio: ['ignore', out, err] });
    child.unref(); fs.closeSync(out); fs.closeSync(err);
  }
  console.log(`Installed Windows login startup: ${startup}`);
} else if (process.platform === 'darwin') {
  const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'local.agent-tools.hub.plist');
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>local.agent-tools.hub</string><key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(fileURLToPath(new URL('../src/cli.mjs', import.meta.url)))}</string><string>serve</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${escape(path.join(home, 'stdout.log'))}</string><key>StandardErrorPath</key><string>${escape(path.join(home, 'stderr.log'))}</string></dict></plist>`);
  const domain = `gui/${process.getuid()}`;
  try { execFileSync('launchctl', ['bootout', domain, file], { stdio: 'pipe' }); } catch { /* first installation */ }
  execFileSync('launchctl', ['bootstrap', domain, file], { stdio: 'pipe' });
  console.log(`Installed macOS login service: ${file}`);
} else throw new Error('Service installation supports Windows and macOS');
