import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseImport,createCatalog} from './model_catalog.mjs';
import {validate,createImageServer} from './server.mjs';
test('import URLs are constrained and query secrets are not persisted',()=>{
  assert.equal(parseImport({url:'https://civitai.com/models/12/name?modelVersionId=34&token=secret'}).url,'https://civitai.com/models/12?modelVersionId=34');
  for(const url of ['http://civitai.com/models/1','https://127.0.0.1/models/1','https://civitai.com.evil.test/models/1','https://u:p@civitai.com/models/1','https://civitai.com/models/1?modelVersionId=no'])assert.throws(()=>parseImport({url}));
});
test('red links normalize to the same configuration source',()=>{
  for(const host of ['civitai.red','www.civitai.red']) {
    assert.equal(parseImport({url:`https://${host}/models/12/name?modelVersionId=34&token=secret`}).url,'https://civitai.com/models/12?modelVersionId=34');
    assert.equal(parseImport({url:`https://${host}/models/12`}).url,'https://civitai.com/models/12');
  }
  for(const url of ['https://civitai.red.evil.test/models/12','https://civitai.red@evil.test/models/12','http://civitai.red/models/12'])assert.throws(()=>parseImport({url}));
});

test('saved configurations persist and only registered IDs generate',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'studio-catalog-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const c=await createCatalog({dataDir:dir,modelsDir:dir,python:'python'});
  const config={id:'civitai-44',name:'Adapter',steps:25,styleStrength:.75,type:'LORA',family:'illustrious',checkpoint:'base.safetensors',lora:'test.safetensors',triggers:[]};
  await writeFile(path.join(dir,'configurations/civitai-44.json'),JSON.stringify(config));
  assert.equal((await c.find('civitai-44')).name,'Adapter');
  const v=validate({model:'civitai-44',prompt:'Portrait'},config);assert.equal(v.settings.configuration.checkpoint,'base.safetensors');
  assert.throws(()=>validate({model:'civitai-44',prompt:'Portrait'}));
  assert.throws(()=>validate({model:'civitai-44',mode:'edit',prompt:'Smile'},config));
  const image='data:image/png;base64,iVBORw0KGgo=';
  assert.equal(validate({model:config.id,mode:'img2img',prompt:'Pixel portrait',image,strength:.35},config).settings.strength,.35);
  assert.throws(()=>validate({model:config.id,mode:'img2img',prompt:'Portrait'},config));
  for(const strength of [-1,1.1,'0.5'])assert.throws(()=>validate({model:config.id,mode:'img2img',prompt:'Portrait',image,strength},config));
  assert.throws(()=>validate({model:config.id,mode:'inpaint',prompt:'Portrait',image},config));

  await c.update('civitai-44',{name:'Renamed',steps:30,styleStrength:.5});
  assert.equal((await c.find('civitai-44')).styleStrength,.5);
  await c.update('civitai-44',{name:'Character',steps:25,styleStrength:.7,triggers:['hero','green coat'],promptPrefix:'gray hair',negativePrompt:'blurry',cfg:5.5});
  const character=await c.find('civitai-44');assert.deepEqual(character.triggers,['hero','green coat']);assert.equal(character.promptPrefix,'gray hair');assert.equal(character.negativePrompt,'blurry');assert.equal(character.cfg,5.5);
  for(const extra of [{triggers:'bad'},{triggers:['x'.repeat(301)]},{promptPrefix:'x'.repeat(4001)},{negativePrompt:42},{cfg:0},{cfg:Infinity}])await assert.rejects(c.update('civitai-44',{name:'Invalid',steps:25,styleStrength:.7,...extra}));
  assert.deepEqual(await c.find('civitai-44'),character);

  await assert.rejects(c.update('civitai-44',{name:'X',steps:30,styleStrength:9}));
});
test('catalog API guards origins and snapshots config into generation jobs',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'studio-config-api-'));let observed;
  const server=await createImageServer({dataDir:dir,worker:async(job,folder)=>{observed=JSON.parse(await readFile(path.join(folder,'configuration.json'),'utf8'));await writeFile(path.join(folder,'image.png'),'test');}});
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const c={id:'civitai-45',name:'A',steps:25,styleStrength:.75,type:'LORA',family:'illustrious',checkpoint:'base.safetensors',lora:'test.safetensors',triggers:['tag']};
  await writeFile(path.join(dir,'configurations/civitai-45.json'),JSON.stringify(c));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,data,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await post('/api/imports',{url:'https://civitai.com/models/1'},{Origin:'https://evil.test'})).status,403);
  assert.equal((await post('/api/imports',{url:'https://evil.test/models/1'})).status,400);
  const job=await(await post('/api/jobs',{model:c.id,prompt:'Portrait'})).json();
  for(let i=0;i<50&&!observed;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(observed,c);assert.equal(job.settings.configuration.triggers[0],'tag');
});
