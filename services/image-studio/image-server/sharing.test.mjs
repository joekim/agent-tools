import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createImageServer } from './server.mjs';
import { shareUrl } from './sharing.mjs';

test('public links use configured hostname even when accessed through a numeric address', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'studio-sharing-'));
  const assetDir = path.join(dir, 'assets');
  await mkdir(path.join(assetDir, 'test-gallery'), { recursive: true });
  await writeFile(path.join(assetDir, 'index.html'), '<h1>Library</h1>');
  await writeFile(path.join(assetDir, 'test-gallery', 'index.html'), '<h1>Gallery</h1>');
  const publicUrl = 'http://studio-machine.local:3001';
  const server = await createImageServer({ dataDir: path.join(dir, 'jobs'), assetDir, publicUrl });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(dir, { recursive:true, force:true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const site = await (await fetch(base + '/api/site')).json();
  assert.equal(site.galleryUrl, publicUrl + '/assets/');
  assert.equal((await (await fetch(base + '/health')).json()).service, 'media-hub');
  const library = await (await fetch(base + '/api/library')).json();
  assert.equal(library.collections[0].url, publicUrl + '/assets/test-gallery/');
  for (const route of ['/', '/assets/', '/assets/test-gallery/', '/screenshots']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /src="\/sharing.js"/);
    if (response.headers.has('content-length')) assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(html));
  }
  const script = await (await fetch(base + '/sharing.js')).text();
  assert.match(script, /site.publicUrl/);
  assert.match(script, /execCommand\('copy'\)/);
  const request = host => new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port:server.address().port,path:'/api/site',headers:{host}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(await request('studio-machine.local:3001'), 200);
  assert.equal(await request('evil.example:3001'), 403);
});
test('share links preserve deep paths and reject external addresses', () => {
  const base = 'http://meesa.local:3001';
  assert.equal(shareUrl(base, '/assets/example/?view=grid#download'), base + '/assets/example/?view=grid#download');
  for (const input of ['//evil.example/', '/\\evil.example/', 'https://evil.example/', '/x\n']) assert.throws(() => shareUrl(base, input));
});
test('isolated preview blocks GPU submissions and model downloads', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'studio-isolation-'));
  let ran=false;
  const server=await createImageServer({dataDir:dir,generationEnabled:false,worker:async()=>{ran=true;}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const route of ['/api/jobs','/api/imports']) {
    const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'test'})});
    assert.equal(r.status,503);
    assert.match((await r.json()).error,/preview copy/);
  }
  assert.equal(ran,false);
  assert.equal((await(await fetch(base+'/api/jobs')).json()).length,0);
});
