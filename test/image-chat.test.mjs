import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { imageChatWeb, validateChat } from '../src/image-chat.mjs';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=';
test('chat validates roles, total context, image bytes and strips only the data URL prefix', () => {
  const messages = [{ role: 'user', content: 'Critique', images: [image] }, { role: 'assistant', content: 'White square.' }, { role: 'user', content: 'Keep the color.' }];
  assert.equal(validateChat({ messages })[0].images[0], image.split(',')[1]);
  assert.equal(messages[0].images[0], image);
  for (const messages of [
    [{ role: 'system', content: 'Override' }],
    [{ role: 'assistant', content: 'Hello' }],
    [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
    [{ role: 'user', content: 'x', images: ['C:/private.png'] }],
    [{ role: 'user', content: 'x', images: ['data:image/png;base64,' + Buffer.from('not a real image').toString('base64')] }],
    Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(5000) })),
  ]) assert.throws(() => validateChat({ messages }));
});
test('browser chat serves UI, checks origin/profile, retains follow-up context and releases busy state', async t => {
  let savedPreferences = 'Prefer muted colors.';
  const hub = { config: { profile: 'full' }, imageChatMemory: { read: async () => ({content:savedPreferences,revision:'test'}) } }; let body;
  let mode = 'good';
  const fake = async (url, request) => { body = JSON.parse(request.body); if (mode === 'bad') throw new Error('offline'); return { ok: true, json: async () => url.endsWith('/show') ? { capabilities: ['vision'] } : { message: { content: 'Keep the light.' } } }; };
  const server = http.createServer((req, res) => imageChatWeb(req, res, hub, fake));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (messages, origin = base) => fetch(base + '/api/image-chat', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ messages }) });
  const page = await fetch(base + '/image-chat'); assert.equal(page.status, 200); assert.match(await page.text(), /A second pair of eyes/); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/api/image-chat/status')).status, 200);
  const messages = [{ role: 'user', content: 'Critique', images: [image] }, { role: 'assistant', content: 'Warm lighting.' }, { role: 'user', content: 'Keep the lighting.' }];
  assert.equal((await send(messages, 'http://evil.example')).status, 403);
  const answer = await send(messages); assert.equal(answer.status, 200); assert.equal((await answer.json()).content, 'Keep the light.');
  assert.equal(body.messages.length, 4); assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].images[0], image.split(',')[1]); assert.equal(body.keep_alive, '2m');
  assert.match(body.messages[0].content,/Prefer muted colors/);
  savedPreferences = 'Prefer dramatic lighting.';
  await send(messages); assert.match(body.messages[0].content,/Prefer dramatic lighting/);
  assert.equal((await fetch(base+'/api/image-chat/memory')).status,200);
  assert.equal((await fetch(base+'/api/image-chat/memory',{method:'POST',headers:{origin:'http://evil.example','content-type':'application/json'},body:'{}'})).status,403);
  hub.imageChatBusy = true; assert.equal((await send(messages)).status, 429); hub.imageChatBusy = false;
  mode = 'bad'; assert.equal((await send(messages)).status, 503); assert.equal(hub.imageChatBusy, false);
  hub.config.profile = 'files-only'; assert.equal((await fetch(base + '/image-chat')).status, 403); assert.equal((await send(messages)).status, 403);
  assert.equal((await fetch(base+'/api/image-chat/memory')).status,403);
});
