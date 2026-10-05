import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createImageServer, validate, imageWorkerCommand } from './server.mjs';

test('every model family uses the configured isolated backend',()=>{
  for(const model of ['krea2','flux2-fast','flux2-base','qwen-image-2.1','qwen-edit-2509','wai-v17','civitai-2618470']){
    const settings={model,mode:'generate',prompt:'test',...(model.startsWith('civitai-')?{configuration:{checkpoint:'example.safetensors'}}:{})};
    const {python,args}=imageWorkerCommand({settings},os.tmpdir(),{python:'isolated-python',url:'http://127.0.0.1:8195'});
    assert.equal(python,'isolated-python');
    assert.equal(args[args.indexOf('--server')+1],'http://127.0.0.1:8195',model);
    assert(!args.includes('http://127.0.0.1:8189'));
  }
});

test('base catalog reads the configured isolated models directory',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'isolated-catalog-'));
  const modelsDir=path.join(root,'models');
  await mkdir(path.join(modelsDir,'checkpoints'),{recursive:true});
  await writeFile(path.join(modelsDir,'checkpoints','Illustrious-XL-v1.0.safetensors'),'fixture');
  const server=await createImageServer({dataDir:path.join(root,'jobs'),assetDir:path.join(root,'assets'),backend:{modelsDir}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
  const catalog=await(await fetch(`http://127.0.0.1:${server.address().port}/api/configurations`)).json();
  assert.deepEqual(catalog.bases.map(b=>b.id),['Illustrious-XL-v1.0.safetensors']);
});

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
test('pose maps retain their input type and isolated generation rejects unapproved models',async t=>{
  const input={model:'wai-v17',prompt:'clothed astronaut',poseImage:png,poseInputType:'map'};
  assert.equal(validate(input).settings.poseInputType,'map');
  assert.throws(()=>validate({...input,poseInputType:'invalid'}),/Invalid pose/);
  const root=await mkdtemp(path.join(os.tmpdir(),'isolated-wai-'));
  const server=await createImageServer({dataDir:path.join(root,'jobs'),assetDir:path.join(root,'assets'),allowedModels:['wai-v17'],importsEnabled:false,worker:async()=>{throw Error('Should not run');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'krea2',prompt:'test'})});
  assert.equal(response.status,403);
  assert.equal((await fetch(base+'/api/imports',{method:'POST'})).status,503);
});
test('allows machine hostnames while rejecting unrelated hosts',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'image-host-'));
  const server=await createImageServer({dataDir});
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const request=host=>new Promise((resolve,reject)=>{
    http.get({hostname:'127.0.0.1',port:server.address().port,path:'/api/jobs',headers:{Host:`${host}:${server.address().port}`}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);
  });
  assert.equal(await request(os.hostname()),200);
  assert.equal(await request(`${os.hostname().split('.')[0]}.local`),200);
  assert.equal(await request('unrelated.example'),403);
});
test('inpainting requires a separate mask and persists it for the worker',async t=>{
  const input={mode:'inpaint',prompt:'A blue mug',image:png,mask:png};
  assert.equal(validate(input).settings.strength,0.85);
  for(const change of [{mask:undefined},{mask:'data:image/png;base64,YWJj'},{mode:'edit'},{strength:2}])assert.throws(()=>validate({...input,...change}));
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'image-mask-'));
  let observed;
  const server=await createImageServer({dataDir,worker:async(job,dir)=>{
    observed={mode:job.settings.mode,source:await readFile(path.join(dir,job.source)),mask:await readFile(path.join(dir,job.mask))};
    await writeFile(path.join(dir,'image.png'),observed.source);
  }});
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(response.status,202);const job=await response.json();
  for(let i=0;i<100;i++){const current=await(await fetch(base+'/api/jobs/'+job.id)).json();if(current.status==='completed')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(observed.mode,'inpaint');assert.deepEqual(observed.mask,Buffer.from(png.split(',')[1],'base64'));
  assert.deepEqual(observed.source,observed.mask);
  assert.equal((await(await fetch(base+'/api/jobs/'+job.id)).json()).status,'completed');
});

test('rejects unsafe settings and invalid uploads',()=>{
  for (const input of [{prompt:''},{prompt:'x',width:9999},{prompt:'x',mode:'shell'},{prompt:'x',model:'unknown'},{prompt:'x',seed:'18446744073709551616'},{prompt:'x',mode:'edit',image:'data:image/png;base64,YWJj'},{prompt:'x',enhancer:'yes'},{prompt:'x',textfusion:3},{prompt:'x',filterBypass:'unknown'},{prompt:'x',textScale:0},{prompt:'x',enhancer:false,textScale:1.5}]) assert.throws(()=>validate(input));
  assert.equal(validate({prompt:'hello',seed:'18446744073709551615'}).settings.seed,'18446744073709551615');
  assert.deepEqual([validate({prompt:'hello'}).settings.enhancer,validate({prompt:'hello'}).settings.enhancerStrength,validate({prompt:'hello'}).settings.textScale],[true,1,1]);
  assert.equal(validate({prompt:'hello',enhancer:false}).settings.enhancer,false);
  assert.equal(validate({prompt:'hello',model:'flux2-fast'}).settings.steps,4);
  assert.equal(validate({prompt:'hello',model:'flux2-base'}).settings.steps,20);
  assert.equal(validate({prompt:'hello',model:'qwen-image-2.1'}).settings.steps,25);
  assert.equal(validate({prompt:'hello',model:'flux2-fast'}).settings.enhancer,undefined);
});

test('jobs finish asynchronously, errors persist, and files stay scoped',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'image-api-'));
  let server;
  t.after(async()=>{if(server)await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});});
  const worker=async(job,dir)=>{if(job.settings.prompt==='fail')throw Error('Test failure');await writeFile(path.join(dir,'image.png'),'test-image');};
  server=await createImageServer({dataDir,worker});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let base=`http://127.0.0.1:${server.address().port}`;
  const post=body=>fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({prompt:'bad',width:17})).status,400);
  assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'})).status,403);
  const submitted=await post({prompt:'A mug'});assert.equal(submitted.status,202);const job=await submitted.json();
  const wait=async id=>{for(let i=0;i<100;i++){const j=await(await fetch(base+'/api/jobs/'+id)).json();if(['failed','completed'].includes(j.status))return j;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
  assert.equal((await wait(job.id)).status,'completed');
  assert.equal(await(await fetch(base+`/images/${job.id}/image.png`)).text(),'test-image');
  assert.equal((await fetch(base+`/images/${job.id}/job.json`)).status,404);
  assert.equal((await fetch(base+'/images/%2e%2e/package.json')).status,404);
  const bad=await(await post({prompt:'fail'})).json();assert.equal((await wait(bad.id)).error,'Test failure');
  await new Promise(r=>server.close(r));server=await createImageServer({dataDir,worker});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  const restored=await(await fetch(base+'/api/jobs')).json();assert.equal(restored.length,2);assert.equal(restored.find(j=>j.id===job.id).status,'completed');
  assert.equal((await fetch(base+'/api/jobs/'+job.id,{method:'DELETE',headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(base+'/api/jobs/'+job.id,{method:'DELETE'})).status,200);
  assert.equal((await fetch(base+'/api/jobs/'+job.id)).status,404);
  assert.equal((await fetch(base+`/images/${job.id}/image.png`)).status,404);
  await assert.rejects(access(path.join(dataDir,job.id)));
  assert.equal((await fetch(base+'/api/jobs/'+bad.id,{method:'DELETE'})).status,200);
  assert.equal((await(await fetch(base+'/api/jobs')).json()).length,0);
});

test('running generations cannot be deleted',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'image-api-running-'));
  let finish;
  const worker=()=>new Promise(resolve=>{finish=resolve;});
  const server=await createImageServer({dataDir,worker});
  t.after(async()=>{if(finish)finish();await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const job=await(await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'running'})})).json();
  for(let i=0;i<100 && !finish;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(typeof finish,'function');
  assert.equal((await fetch(base+'/api/jobs/'+job.id,{method:'DELETE'})).status,409);
  finish();
});


test('comic presets validate modes, style strength and source requirements',()=>{
  const wai={model:'wai-v17',prompt:'A physician'};
  assert.equal(validate(wai).settings.steps,25);
  assert.equal(validate(wai).settings.styleStrength,.75);
  for(const value of [0,1.5]) assert.equal(validate({...wai,styleStrength:value}).settings.styleStrength,value);
  for(const value of [-.1,1.6,'0.75',NaN]) assert.throws(()=>validate({...wai,styleStrength:value}));
  for(const mode of ['edit','img2img','inpaint']) assert.throws(()=>validate({...wai,mode,image:png}));
  const qwen={model:'qwen-edit-2509',mode:'edit',prompt:'Smile',image:png};
  assert.equal(validate(qwen).settings.steps,4);
  assert.throws(()=>validate({...qwen,image:undefined}));
  for(const mode of ['generate','img2img','inpaint']) assert.throws(()=>validate({...qwen,mode}));
  for(const steps of [1,5,25]) assert.throws(()=>validate({...qwen,steps}));
});

test('pose uploads are validated independently and restricted to supported models',()=>{
 const request={model:'wai-v17',prompt:'Standing',poseImage:png,poseStrength:.7};
 const v=validate(request);assert.equal(v.settings.poseStrength,.7);assert.equal(v.pose.extension,'png');assert.equal(v.image,undefined);
 assert.equal(v.settings.poseEnabled,true);assert.equal(v.settings.poseImage,undefined);
 for(const extra of [{model:'krea2'},{poseImage:'bad'},{poseStrength:-1},{poseStrength:3}])assert.throws(()=>validate({...request,...extra}));
});

test('screenshots serve only PNG files from their dedicated directory',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'studio-shots-'));
 await writeFile(path.join(dir,'demo.png'),Buffer.from('89504e470d0a1a0a','hex'));
 await writeFile(path.join(dir,'private.json'),'secret');
 const server=await createImageServer({dataDir:dir,screenshotDir:dir});
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const image=await fetch(base+'/screenshots/demo.png');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
 assert.equal((await fetch(base+'/screenshots')).status,200);
 for(const url of ['/screenshots/private.json','/screenshots/missing.png','/screenshots/%2e%2e%2fprivate.json','/screenshots/nested/demo.png'])assert.equal((await fetch(base+url)).status,404);
});
