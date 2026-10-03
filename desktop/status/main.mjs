import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from '../../src/config.mjs';
import { request } from '../../src/http.mjs';

app.setName('Media Hub Activity');
const root = path.dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(path.join(root, 'index.html')).href;
let window, tray, quitting = false, timer, pinned = true;
let state = { online: false, services: [] };
if (!app.requestSingleInstanceLock()) app.quit();
else {
  void (async () => {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('before-quit', () => { quitting = true; clearTimeout(timer); });
  await app.whenReady();
  const settingsFile = path.join(app.getPath('userData'), 'activity.json');
  try { pinned = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).pinned !== false; } catch {}
  window = new BrowserWindow({ width: 370, height: 550, minWidth: 330, minHeight: 300, title: 'Media Hub Activity', alwaysOnTop: pinned,
    backgroundColor: '#111821', autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  function icon(active) {
    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 48) {
      const offset = (y * 16 + x) * 4; const color = active ? [168, 220, 103] : [148, 125, 101];
      pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
    }
    return nativeImage.createFromBitmap(pixels, { width: 16, height: 16 });
  }
  tray = new Tray(icon(false));
  tray.setToolTip('Media Hub · Connecting');
  tray.on('click', () => window.isVisible() ? window.hide() : window.show());
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show activity', click: () => window.show() }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
  function trusted(event) { if (event.sender !== window.webContents || event.senderFrame?.url !== page) throw new Error('Untrusted caller'); }
  ipcMain.handle('status:state', event => { trusted(event); return { ...state, pinned }; });
  ipcMain.handle('status:pin', (event, value) => {
    trusted(event); pinned = value === true; window.setAlwaysOnTop(pinned);
    fs.writeFileSync(settingsFile, JSON.stringify({ pinned }));
  });
  ipcMain.handle('status:hide', event => { trusted(event); window.hide(); });
  ipcMain.handle('status:open', async (event, kind, id) => {
    trusted(event);
    if (!['image', 'voice'].includes(kind) || typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id)) return;
    if (!state.services.find(s => s.kind === kind)?.recent.some(j => j.id === id && j.status === 'finished')) return;
    const config = readConfig();
    if (kind === 'voice' && config.voiceRuntime?.dataDir) return shell.openPath(path.join(config.voiceRuntime.dataDir, 'jobs', id));
    if (kind === 'image') {
      const url = new URL(`/images/${id}/image.png`, config.publicUrl || `http://127.0.0.1:${config.port}`);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) await shell.openExternal(url.href);
    }
  });
  async function poll() {
    try {
      const config = readConfig();
      state = { ...await request(`http://127.0.0.1:${config.port}/v1/activity`, { token: config.token, timeout: 6000 }), online: true };
    } catch { state = { online: false, services: [] }; }
    const busy = state.services.some(s => ['generating', 'queued'].includes(s.state));
    tray.setImage(icon(busy)); tray.setToolTip(!state.online ? 'Media Hub · Offline' : `Media Hub · ${state.services.map(s => `${s.kind}: ${s.state}`).join(' · ')}`);
    if (!quitting) timer = setTimeout(poll, 3000);
  }
  await window.loadFile(path.join(root, 'index.html'));
  await poll();
  if (process.argv.includes('--smoke-test')) {
    // Local renderer/IPC verification without submitting any generation jobs.
    const snapshot = await window.webContents.executeJavaScript('window.mediaStatus.state()');
    const output = path.resolve(root, '../../.local/status-smoke');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'state.json'), JSON.stringify(snapshot, null, 2));
    await new Promise(resolve => setTimeout(resolve, 3500));
    fs.writeFileSync(path.join(output, 'window.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.mediaStatus.pin(false)');
    if (window.isAlwaysOnTop()) throw new Error('Unpin failed');
    await window.webContents.executeJavaScript('window.mediaStatus.pin(true)');
    if (!window.isAlwaysOnTop()) throw new Error('Pin failed');
    window.close();
    if (window.isVisible() || window.isDestroyed()) throw new Error('Close-to-tray failed');
    window.show();
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ connected: snapshot.online, pin: true, closeToTray: true, reopen: window.isVisible() }));
    app.quit();
  }
  })().catch(error => { console.error(error); app.exit(1); });
}
