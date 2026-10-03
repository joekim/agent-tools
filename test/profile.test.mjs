import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { profileFor, permitsTool } from '../src/profile.mjs';
import { Hub } from '../src/hub.mjs';

test('macOS forces files-only; Windows supports models and optional files-only',()=>{
  assert.equal(profileFor({profile:'full'},'darwin'),'files-only');
  assert.equal(profileFor({},'win32'),'full');
  assert.equal(profileFor({profile:'files-only'},'win32'),'files-only');
  assert.equal(permitsTool({profile:'files-only'},{name:'voice.generate'}),false);
  assert.equal(permitsTool({profile:'files-only'},{name:'media-hub.transcript'}),true);
});
test('files-only hub hides and blocks local and peer models, and serves a model-free homepage',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-profile-'));
  const token='q'.repeat(64);
  const hub=new Hub({nodeId:'files-node',token,profile:'files-only',port:0,host:'127.0.0.1',projectsRoot:dir,legacyToolsRoot:dir,artifactsDir:dir,imageStudio:{enabled:true,sharedPort:true,port:3002,dataRoot:dir,generationEnabled:true}});
  await hub.start();
  t.after(async()=>{await hub.close();await fs.rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${hub.server.address().port}`;
  hub.peers.set('windows',{lastSeen:Date.now(),tools:[{nodeId:'windows',name:'voice.generate',online:true},{nodeId:'windows',name:'media-hub.library',online:true}]});
  const names=hub.catalog().tools.map(t=>t.name);
  assert.ok(names.includes('media-hub.transcript'));
  assert.ok(!names.includes('voice.generate'));
  assert.ok(!names.includes('media-hub.generate'));
  assert.ok(!names.includes('media-hub.configurations'));
  await assert.rejects(hub.call({nodeId:'windows',name:'voice.generate',input:{lines:['test']}}),/files-only/);
  await assert.rejects(hub.call({name:'image-studio.generate',input:{prompt:'test'}}),/files-only/);
  for(const [route,method] of [['/api/jobs','POST'],['/api/imports','POST'],['/api/configurations','GET']]) assert.equal((await fetch(base+route,{method})).status,403);
  const home=await(await fetch(base+'/')).text();
  assert.match(home,/Model generation is not available here/);
  assert.ok(!home.includes('id="importForm"'));
  assert.equal((await fetch(base+'/assets/')).status,200);
  const caps=await(await fetch(base+'/api/capabilities')).json();
  assert.equal(caps.modelUse,false);
  assert.ok(!caps.capabilities.some(c=>['images','voice','music'].includes(c.id)));
});
