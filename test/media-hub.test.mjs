import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Hub } from '../src/hub.mjs';
import { request } from '../src/http.mjs';
import { detectServices } from '../src/catalog.mjs';
import { mediaCapabilities } from '../services/image-studio/image-server/capabilities.mjs';

test('Media Hub transcript is callable over authenticated HTTP and retains its old alias', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-task-'));
  const fixture=path.join(dir,'captions.mjs');
  await fs.writeFile(fixture, `import fs from 'node:fs';import path from 'node:path';
if(process.argv.includes('--version'))process.exit(0);
if(!process.argv.includes('--skip-download')||!process.argv.includes('--write-subs'))process.exit(2);
const output=process.argv[process.argv.indexOf('-o')+1];
fs.writeFileSync(path.join(path.dirname(output),'abcdefghijk.en.vtt'),'WEBVTT\\n\\n00:00.000 --> 00:01.000\\nHello from captions.\\n');`);
  const token='t'.repeat(64);
  const hub=new Hub({nodeId:'media-test',token,host:'127.0.0.1',port:0,autoDetect:false,legacyToolsRoot:dir,artifactsDir:dir,ytdlpCommand:process.execPath,ytdlpArgs:[fixture]});
  await hub.start();
  t.after(async()=>{await hub.close();await fs.rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${hub.server.address().port}`;
  const catalog=await request(base+'/v1/catalog',{token});
  assert.equal(catalog.tools.find(t=>t.name==='media-hub.transcript').online,true);
  for(const name of ['media-hub.transcript','youtube.transcript']) {
    const result=await request(base+'/v1/call',{token,method:'POST',body:{nodeId:'media-test',name,input:{url:'https://youtu.be/abcdefghijk',language:'en'}}});
    assert.equal(result.result.transcripts[0].text,'Hello from captions.');
    assert.equal(await fs.readFile(result.result.transcripts[0].file,'utf8'),'Hello from captions.');
  }
});
test('Media Hub catalog advertises implemented tools and marks future integrations',()=>{
  const media=detectServices({projectsRoot:os.tmpdir(),imageStudio:{enabled:true,port:3002,generationEnabled:false}}).find(s=>s.id==='media-hub');
  assert.equal(media.baseUrl,'http://127.0.0.1:3002');
  assert.ok(media.operations.capabilities);
  assert.equal(media.operations.generate,undefined);
  const caps=mediaCapabilities(false);
  assert.equal(caps.capabilities.find(c=>c.id==='dropbox').status,'authorization-required');
  assert.equal(caps.capabilities.find(c=>c.id==='images').status,'disabled-in-preview');
});
test('one listener serves the website and authenticated tasks without exposing task routes', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-one-port-'));
  const token='s'.repeat(64);
  const hub=new Hub({nodeId:'shared-port',token,host:'127.0.0.1',port:0,projectsRoot:dir,legacyToolsRoot:dir,artifactsDir:dir,imageStudio:{enabled:true,sharedPort:true,dataRoot:dir,port:3002,publicUrl:'http://media-test.local:3002',generationEnabled:false}});
  await hub.start();
  t.after(async()=>{await hub.close();await fs.rm(dir,{recursive:true,force:true});});
  assert.equal(hub.sharedStudio.listening,false,'Media app must not open a second listener');
  assert.equal(hub.studioServer,undefined);
  const base=`http://127.0.0.1:${hub.server.address().port}`;
  for(const route of ['/','/agents','/api/site']) assert.equal((await fetch(base+route)).status,200);
  for(const route of ['/v1/catalog','/v1/snapshot','/health']) assert.equal((await fetch(base+route)).status,401);
  assert.equal((await fetch(base+'/v1/call',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+'/v1/call',{method:'POST',headers:{authorization:`Bearer ${token}`,origin:base,'content-type':'application/json'},body:'{}'})).status,403);
  const result=await request(base+'/v1/call',{token,method:'POST',body:{nodeId:'shared-port',name:'media-hub.site',input:{}}});
  assert.equal(result.result.name,'Media Hub');
  assert.equal((await request(base+'/health',{token})).nodeId,'shared-port');
  const catalog=await request(base+'/v1/catalog',{token});
  assert.equal(catalog.tools.find(t=>t.name==='media-hub.site').online,true);
});
