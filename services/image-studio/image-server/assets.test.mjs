import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createImageServer } from './server.mjs';

test('curated galleries serve exact assets and reject unrelated paths and methods', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'studio-assets-'));
  const assetDir = path.join(dir, 'assets');
  await mkdir(path.join(assetDir, 'test-model'), { recursive: true });
  await mkdir(path.join(dir, 'private'));
  await writeFile(path.join(assetDir, 'index.html'), '<h1>Assets</h1>');
  await writeFile(path.join(assetDir, 'test-model', 'index.html'), '<h1>Test model</h1>');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const glb = Buffer.from('glTF model bytes');
  await writeFile(path.join(assetDir, 'test-model', 'front.png'), png);
  await writeFile(path.join(assetDir, 'test-model', 'model.glb'), glb);
  const video = Buffer.from('0123456789');
  await writeFile(path.join(assetDir, 'test-model', 'preview.mp4'), video);
  await writeFile(path.join(assetDir, 'test-model', 'source.blend'), 'BLENDER');
  await writeFile(path.join(assetDir, 'test-model', 'private.json'), '{"private":true}');
  await writeFile(path.join(dir, 'private', 'secret.png'), png);
  await symlink(path.join(dir, 'private'), path.join(assetDir, 'escape'), 'junction');
  const server = await createImageServer({ dataDir: path.join(dir, 'jobs'), assetDir });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('studio-assets-'));
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/assets', '/assets/', '/assets/test-model', '/assets/test-model/']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /^text\/html/);
  }
  const image = await fetch(base + '/assets/test-model/front.png');
  const videoUrl = base + '/assets/test-model/preview.mp4';
  const fullVideo = await fetch(videoUrl);
  assert.equal(fullVideo.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await fullVideo.arrayBuffer()), video);
  for (const [range, expected, contentRange] of [
    ['bytes=0-1', '01', 'bytes 0-1/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
  ]) {
    const partial = await fetch(videoUrl, { headers: { Range: range } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), contentRange);
    assert.equal(await partial.text(), expected);
  }
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5']) {
    assert.equal((await fetch(videoUrl, { headers: { Range: range } })).status, 416);
  }
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const model = await fetch(base + '/assets/test-model/model.glb');
  assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(model.headers.get('content-disposition'), 'attachment; filename="model.glb"');
  assert.equal(Number(model.headers.get('content-length')), glb.length);
  assert.deepEqual(Buffer.from(await model.arrayBuffer()), glb);
  assert.equal((await fetch(base + '/assets/test-model/source.blend')).headers.get('content-type'), 'application/octet-stream');
  const request = route => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path: route }, res => {
      res.resume(); resolve(res.statusCode);
    }).on('error', reject);
  });
  for (const route of ['/assets/test-model/private.json', '/assets/test-model/missing.png',
    '/assets/test-model/.env', '/assets/test-model/nested/front.png',
    '/assets/test-model/%2e%2e%2fprivate/secret.png', '/assets/test-model/..%5cprivate%5csecret.png',
    '/assets/test-model/front.png:stream', '/assets/test-model/front.png%00', '/assets/escape/secret.png']) {
    assert.equal(await request(route), 404, route);
  }
  for (const method of ['POST', 'DELETE']) {
    assert.equal((await fetch(base + '/assets/test-model/model.glb', { method })).status, 405);
  }
  assert.equal((await fetch(base + '/api/jobs')).status, 200);
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /id="assetLibraryLink" href="\/assets\/"/);
  const unrelatedHostStatus = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/assets/', headers: { Host: 'unrelated.example:3002' } }, res => {
      res.resume(); resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(unrelatedHostStatus, 403);
  const missing = await fetch(base + '/assets/test-model/missing.png');
  assert.equal(missing.status, 404);
  assert.ok((await missing.json()).error);
});
