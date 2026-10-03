// Create an independent staging copy. Never changes source data or launchers.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configPath, home } from '../src/config.mjs';

const sourceRoot = path.resolve(process.argv[2] || path.join(os.homedir(), 'projects', 'yue2-music'));
const targetRoot = path.resolve(home, 'image-studio');
async function copyVerified(source, dest) {
  let files = 0, bytes = 0;
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${from}`);
    if (entry.isDirectory()) { const r = await copyVerified(from, to); files += r.files; bytes += r.bytes; }
    else if (entry.isFile()) {
      try { await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      const hash = async p => createHash('sha256').update(await fs.readFile(p)).digest('hex');
      if (await hash(from) !== await hash(to)) throw new Error(`Copy differs; neither version overwritten: ${from}`);
      files++; bytes += (await fs.stat(from)).size;
    }
  }
  return { files, bytes };
}
const results = [];
for (const [from, to] of [['image-runs','jobs'], ['image-server/assets','assets'], ['image-server/screenshots','screenshots']]) {
  const source = path.join(sourceRoot, from), dest = path.join(targetRoot, to);
  if ((await fs.lstat(source)).isSymbolicLink()) throw new Error('Source must be an independent directory');
  results.push({ source, dest, ...await copyVerified(source, dest) });
}
const config = JSON.parse((await fs.readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
await fs.copyFile(configPath,`${configPath}.before-studio-copy-${stamp}`);
config.imageStudio = { ...config.imageStudio, enabled: true, sharedPort: true, dataRoot: targetRoot, port: 3002, host: '::', publicUrl: `http://${os.hostname().split('.')[0].toLowerCase()}.local:3002`, generationEnabled: false };
config.port = 3002; config.host = '::'; config.publicUrl = config.imageStudio.publicUrl;
await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
await fs.writeFile(path.join(targetRoot,'copy.json'),JSON.stringify({copiedAt:new Date().toISOString(),sourceRoot,results},null,2));
console.log(JSON.stringify({publicUrl:config.imageStudio.publicUrl,targetRoot,files:results.reduce((n,r)=>n+r.files,0),sourceUnchanged:true},null,2));
