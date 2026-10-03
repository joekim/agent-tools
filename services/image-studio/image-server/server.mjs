import http from 'node:http';
import os from 'node:os';
import { readFile, writeFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { createCatalog } from './model_catalog.mjs';
import { serveAsset } from './assets.mjs';
import { studioSettings } from '../settings.mjs';
import { addSharing, listCollections, sharingScript } from './sharing.mjs';
import { mediaCapabilities } from './capabilities.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const machineHostname = os.hostname().toLowerCase();
const localHostnames = new Set([machineHostname, `${machineHostname.split('.')[0]}.local`]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validate(input, configuration = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Expected a JSON object.');
  const imported = configuration && configuration.id === input.model;
  const mode = input.mode ?? 'generate';
  if (!['generate', 'edit', 'img2img', 'inpaint'].includes(mode)) throw fail('Invalid mode.');
  const model = input.model ?? 'krea2';
  if (!imported && !['krea2', 'flux2-fast', 'flux2-base', 'qwen-image-2.1', 'wai-v17', 'qwen-edit-2509'].includes(model)) throw fail('Invalid model.');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000) throw fail('Prompt must contain 1â€“8000 characters.');
  if (imported && !['generate','img2img'].includes(mode)) throw fail('Imported models support Generate and Reimagine an image. Use Qwen Edit for instruction edits.');
  if (model === 'wai-v17' && mode !== 'generate') throw fail('WAI v17 supports Generate. Use Qwen Edit 2509 to edit its images.');
  if (model === 'qwen-edit-2509' && mode !== 'edit') throw fail('Qwen Edit 2509 requires Edit an image mode.');
  const settings = { mode, model, prompt: input.prompt.trim() };
  if (input.negativePrompt !== undefined) {
    if (typeof input.negativePrompt !== 'string' || input.negativePrompt.length > 4000) throw fail('Negative prompt must be at most 4000 characters.');
    if (!imported && model !== 'wai-v17') throw fail('Negative prompts are supported by WAI and imported SDXL models.');
    settings.negativePrompt = input.negativePrompt.trim();
  }
  const defaultSteps = imported ? configuration.steps : model === 'flux2-fast' ? 4 : model === 'flux2-base' ? 20 : ['qwen-image-2.1','wai-v17'].includes(model) ? 25 : model === 'qwen-edit-2509' ? 4 : 8;
  for (const [key, fallback, min, max, multiple] of [['width',768,256,1536,16],['height',768,256,1536,16],['steps',defaultSteps,1,40,1]]) {
    const value = input[key] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max || value % multiple) throw fail(`${key} must be ${min}â€“${max}, in multiples of ${multiple}.`);
    settings[key] = value;
  }
  if (model === 'qwen-edit-2509' && settings.steps !== 4) throw fail('Qwen Edit Lightning uses 4 steps.');
  if (input.seed !== undefined && input.seed !== '') {
    const seed = String(input.seed);
    if (!/^\d{1,20}$/.test(seed) || BigInt(seed) >= 2n ** 64n || (typeof input.seed === 'number' && !Number.isSafeInteger(input.seed))) throw fail('Seed must be an unsigned 64-bit integer string.');
    settings.seed = seed;
  }
  const number = (key, fallback, min, max) => {
    const value = input[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw fail(`${key} must be between ${min} and ${max}.`);
    settings[key] = value;
  };
  if (imported) { number('styleStrength', configuration.styleStrength, 0, 1.5); settings.configuration = configuration; }
  if (model === 'wai-v17') number('styleStrength', .75, 0, 1.5);
  if (model === 'krea2') {
    number('textfusion', 0, 0, 2);
    if (!['img2img','inpaint'].includes(mode)) {
      number('rebalance', 0, 0, 8);
      settings.filterBypass = input.filterBypass ?? 'off';
      if (!['off','2vector','3vector'].includes(settings.filterBypass)) throw fail('Invalid filter bypass.');
      number('bypassStrength', 1, 0, 5);
      if (settings.filterBypass === 'off' && settings.bypassStrength !== 1) throw fail('Bypass strength requires a filter bypass.');
    }
    if (mode === 'generate') {
      settings.enhancer = input.enhancer ?? true;
      if (typeof settings.enhancer !== 'boolean') throw fail('enhancer must be a boolean.');
      number('enhancerStrength', 1, 0, 2);
      number('textScale', 1, 0.25, 4);
      if (!settings.enhancer && settings.textScale !== 1) throw fail('Text scale requires the enhancer.');
      settings.thinkContent = input.thinkContent ?? '';
      if (typeof settings.thinkContent !== 'string' || settings.thinkContent.length > 8000) throw fail('thinkContent must be at most 8000 characters.');
    }
    if (mode === 'edit') number('refBoost', 4, 0, 1000);
  }
  if (mode === 'img2img' || mode === 'inpaint') {
    settings.strength = input.strength ?? (mode === 'inpaint' ? 0.85 : 0.5);
    if (typeof settings.strength !== 'number' || !Number.isFinite(settings.strength) || settings.strength < 0 || settings.strength > 1) throw fail('Strength must be between 0 and 1.');
  }
  let image;
  if (mode !== 'generate') {
    const match = typeof input.image === 'string' && input.image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw fail('Editing requires a PNG, JPEG or WebP image data URL.');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) : match[1] === 'jpeg' ? bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')) : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
    if (!valid || bytes.length > 10 * 1024 * 1024) throw fail('Invalid image or image exceeds 10 MB.');
    image = { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
  }
  let mask;
  if (mode === 'inpaint') {
    const match = typeof input.mask === 'string' && input.mask.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw fail('Inpainting requires a painted PNG mask.');
    mask = Buffer.from(match[1], 'base64');
    if (!mask.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) || mask.length > 10*1024*1024) throw fail('Invalid mask or mask exceeds 10 MB.');
  } else if (input.mask !== undefined) throw fail('Masks require inpaint mode.');
  let pose;
  if(input.poseImage!==undefined){
    if(!(imported||model==='wai-v17')||!['generate','img2img'].includes(mode))throw fail('Pose guidance requires WAI or an imported SDXL model in Generate or Reimagine mode.');
    // Reuse the same upload validation as ordinary source images.
    pose=validate({model:'flux2-fast',mode:'edit',prompt:'pose',image:input.poseImage}).image;
    number('poseStrength',.8,0,2);
    if (input.poseInputType !== undefined && !['reference','map'].includes(input.poseInputType)) throw fail('Invalid pose input type.');
    settings.poseInputType=input.poseInputType || 'reference';
    settings.poseEnabled=true;
  }
  return { settings, image, mask, pose };
}

export function runImage(job, dir, backend = {}) {
  const bundled = path.join(process.env.USERPROFILE ?? '', 'Documents/Codex/apps/ComfyUI-YuE2/.venv/Scripts/python.exe');
  const python = backend.python || process.env.IMAGE_PYTHON || (existsSync(bundled) ? bundled : 'python');
  const s = job.settings;
  const command = s.mode === 'inpaint' ? 'img2img' : s.mode;
  const flux = s.model?.startsWith('flux2-');
  const preset = !!s.configuration || ['wai-v17','qwen-edit-2509'].includes(s.model);
  const args = preset
    ? [path.join(here,'studio_models.py'), s.mode, '--model', s.configuration ? 'imported-sdxl' : s.model, '--prompt', s.prompt, '--output', path.join(dir,'image.png'), '--server', backend.url || process.env.COMFY_URL || 'http://127.0.0.1:8189']
    : flux
    ? [path.join(root,'flux2/flux2.py'), s.mode, '--model', s.model, '--prompt', s.prompt, '--output', path.join(dir,'image.png'), '--server', process.env.FLUX2_COMFY_URL || 'http://127.0.0.1:8189']
    : s.model === 'qwen-image-2.1'
    ? [path.join(root,'qwen2/qwen.py'), s.mode, '--prompt', s.prompt, '--output', path.join(dir,'image.png'), '--server', backend.url || process.env.COMFY_URL || 'http://127.0.0.1:8189']
    : [path.join(root,'krea2/krea.py'), s.mode, '--prompt', s.prompt, '--output', path.join(dir,'image.png'), '--server', backend.url || process.env.COMFY_URL || 'http://127.0.0.1:8189'];
  for (const key of ['width','height','steps','seed','strength']) if (s[key] !== undefined) args.push(`--${key}`, String(s[key]));
  if (s.negativePrompt) args.push('--negative-prompt', s.negativePrompt);
  if (s.configuration) args.push('--configuration', path.join(dir,'configuration.json'));
  if (s.styleStrength !== undefined) args.push('--style-strength', String(s.styleStrength));
  if (s.textfusion) args.push('--textfusion', String(s.textfusion));
  if (s.rebalance) args.push('--rebalance', String(s.rebalance));
  if (s.filterBypass !== 'off' && s.filterBypass) args.push('--filter-bypass', s.filterBypass, '--bypass-strength', String(s.bypassStrength));
  if (s.enhancer) args.push('--enhancer', String(s.enhancerStrength), '--text-scale', String(s.textScale));
  if (s.thinkContent) args.push('--think-content', s.thinkContent);
  if (s.refBoost !== undefined) args.push('--ref-boost', String(s.refBoost));
  if (s.poseInputType === 'map') args.push('--pose-map');
  if (job.pose) args.push('--pose-image',path.join(dir,job.pose),'--pose-strength',String(s.poseStrength));
  if (job.source) args.push('--image', path.join(dir,job.source));
  args[1] = command;
  if (job.mask) args.push('--mask', path.join(dir,job.mask));
  return new Promise((resolve,reject) => {
    const child = spawn(python,args,{cwd:root,windowsHide:true,shell:false});
    let log = '';
    const collect = chunk => { log = (log + chunk.toString()).slice(-16000); };
    child.stdout.on('data',collect); child.stderr.on('data',collect);
    child.on('error',reject);
    child.on('close',code => code === 0 ? resolve() : reject(new Error(log || `Worker exited with code ${code}`)));
  });
}

export async function createImageServer({ dataDir = studioSettings().dataDir, worker, backend = {}, allowedModels, importsEnabled = true, screenshotDir = studioSettings().screenshotDir, assetDir = studioSettings().assetDir, publicUrl = studioSettings().publicUrl, generationEnabled = true, modelUse = process.platform !== 'darwin' } = {}) {
  if (!modelUse || process.platform === 'darwin') { modelUse = false; generationEnabled = false; }
  worker ||= (job, dir) => runImage(job, dir, backend);
  const publicOrigin = new URL(publicUrl).origin;
  const allowedHostnames = new Set([...localHostnames, new URL(publicOrigin).hostname]);
  await mkdir(dataDir,{recursive:true});
  await mkdir(assetDir,{recursive:true});
  try { await writeFile(path.join(assetDir,'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Media Hub library</title><a href="/">Media Hub</a><h1>Library</h1><p>No galleries have been published on this machine yet.</p></html>', {flag:'wx'}); } catch(e) { if(e.code !== 'EEXIST') throw e; }
  const bundled = path.join(process.env.USERPROFILE ?? '', 'Documents/Codex/apps/ComfyUI-YuE2/.venv/Scripts/python.exe');
  const catalog = await createCatalog({dataDir, python:process.env.IMAGE_PYTHON || (existsSync(bundled)?bundled:'python')});
  const jobs = new Map();
  const save = async job => {
    const dest = path.join(dataDir,job.id,'job.json');
    await writeFile(dest+'.tmp',JSON.stringify(job,null,2)); await rename(dest+'.tmp',dest);
  };
  for (const entry of await readdir(dataDir,{withFileTypes:true})) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    try {
      const job = JSON.parse(await readFile(path.join(dataDir,entry.name,'job.json'),'utf8'));
      job.id = entry.name;
      if (['queued','running'].includes(job.status)) {
        job.status = existsSync(path.join(dataDir,job.id,'image.png')) ? 'completed' : 'interrupted';
        job.error = job.status === 'interrupted' ? 'Server restarted. A submitted ComfyUI job may still be running; it was not resubmitted.' : undefined;
        await save(job);
      }
      jobs.set(job.id,job);
    } catch (err) { console.error('Could not load job:',entry.name,err.message); }
  }
  let chain = Promise.resolve();
  const json = (res,status,value) => { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const url = new URL(req.url,'http://localhost');
      const hostname = new URL(`http://${req.headers.host}`).hostname;
      const local = req.socket.localAddress?.replace(/^::ffff:/,'');
      if (!['localhost','127.0.0.1','[::1]',local].includes(hostname) && !allowedHostnames.has(hostname)) throw fail('Use the server hostname, IP address or localhost.',403);
      if (!modelUse && (url.pathname.startsWith('/api/configurations') || url.pathname.startsWith('/api/imports') || (req.method === 'POST' && url.pathname === '/api/jobs'))) throw fail('Model operations are unavailable on this machine.',403);
      if (req.method === 'GET' && url.pathname === '/health') { json(res,200,{ok:true,service:'media-hub',publicUrl:publicOrigin}); return; }
      if (req.method === 'GET' && url.pathname === '/api/site') { json(res,200,{name:'Media Hub',publicUrl:publicOrigin,studioUrl:publicOrigin+'/',galleryUrl:publicOrigin+'/assets/',screenshotsUrl:publicOrigin+'/screenshots',agentsUrl:publicOrigin+'/agents',generationEnabled,modelUse,allowedModels}); return; }
      if (req.method === 'GET' && url.pathname === '/api/capabilities') { json(res,200,mediaCapabilities(generationEnabled,modelUse)); return; }
      if (req.method === 'GET' && url.pathname === '/agents') {
        let html = await readFile(path.join(here,'agents.html'),'utf8');
        if (!modelUse) html = html.replace('Local galleries and transcript tasks are supported. Image generation is disabled in this separate preview. Voice uses an existing external adapter; music and Dropbox sharing are planned.', 'This machine provides files, galleries and transcript tasks. Model operations are not exposed or forwarded to other machines. Dropbox sharing is planned.');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}); res.end(addSharing(html)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/library') { json(res,200,{publicUrl:publicOrigin,collections:await listCollections(assetDir,publicOrigin)}); return; }
      if (req.method === 'GET' && url.pathname === '/sharing.js') { res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'}); res.end(sharingScript()); return; }
      if (req.method === 'GET' && url.pathname === '/api/configurations') { json(res,200,{configurations:(await catalog.listConfigs()).filter(c => !allowedModels || allowedModels.includes(c.id)),bases:await catalog.baseOptions()}); return; }
      if (req.method === 'GET' && url.pathname === '/api/imports') { json(res,200,await catalog.listImports()); return; }
      if (req.method === 'POST' && (url.pathname === '/api/imports' || url.pathname.startsWith('/api/configurations/'))) {
        if ((!generationEnabled || !importsEnabled) && url.pathname === '/api/imports') throw fail('Model downloads are disabled in this independent preview copy.',503);
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail('Cross-origin requests are not allowed.',403);
        if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Use application/json.',415);
        let size=0;const chunks=[];
        for await (const chunk of req) { size+=chunk.length;if(size>16384)throw fail('Request exceeds 16 KB.',413);chunks.push(chunk); }
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail('Invalid JSON.');}
        if(url.pathname==='/api/imports')json(res,202,await catalog.start(input));
        else json(res,200,await catalog.update(url.pathname.slice('/api/configurations/'.length),input));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        if (!generationEnabled) throw fail('Image generation is disabled in this independent preview copy. Use the original studio for generation.',503);
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail('Cross-origin requests are not allowed.',403);
        if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Use application/json.',415);
        if ([...jobs.values()].filter(j=>['queued','running'].includes(j.status)).length >= 5) throw fail('Queue is full. Try again after a job finishes.',429);
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 28 * 1024 * 1024) throw fail('Request exceeds 28 MB.',413); chunks.push(chunk); }
        let input; try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail('Invalid JSON.'); }
        if (allowedModels && !allowedModels.includes(input.model)) throw fail('This model is not enabled in this isolated Media Hub.',403);
        const {settings,image,mask,pose} = validate(input, await catalog.find(input?.model));
        if ([...jobs.values()].filter(j=>['queued','running'].includes(j.status)).length >= 5) throw fail('Queue is full.',429);
        const job = {id:randomUUID(),createdAt:new Date().toISOString(),status:'queued',settings};
        jobs.set(job.id,job);
        const dir = path.join(dataDir,job.id); await mkdir(dir);
        if (settings.configuration) await writeFile(path.join(dir,'configuration.json'),JSON.stringify(settings.configuration,null,2));
        if (image) { job.source = `source.${image.extension}`; await writeFile(path.join(dir,job.source),image.bytes); }
        if (pose) { job.pose=`pose-source.${pose.extension}`; await writeFile(path.join(dir,job.pose),pose.bytes); }
        if (mask) { job.mask = 'mask.png'; await writeFile(path.join(dir,job.mask),mask); }
        try { await save(job); } catch (err) { jobs.delete(job.id); throw err; }
        chain = chain.then(async () => {
          try {
            job.status = 'running'; await save(job);
            await worker(job,dir);
            if (!existsSync(path.join(dir,'image.png'))) throw new Error('Worker did not produce an image.');
            job.status = 'completed'; job.imageUrl = `/images/${job.id}/image.png`;
          } catch (err) { job.status = 'failed'; job.error = err.message; }
          job.finishedAt = new Date().toISOString(); await save(job);
        }).catch(err=>console.error('Could not persist job:',err));
        json(res,202,job); return;
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/jobs/')) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail('Cross-origin requests are not allowed.',403);
        const id = url.pathname.slice('/api/jobs/'.length);
        if (!/^[a-f0-9-]{36}$/.test(id)) throw fail('Job not found.',404);
        const job = jobs.get(id);
        if (!job) throw fail('Job not found.',404);
        if (['queued','running'].includes(job.status)) throw fail('Wait for this job to finish before deleting it.',409);
        await rm(path.join(dataDir,id),{recursive:true});
        jobs.delete(id);
        json(res,200,{deleted:id}); return;
      }
      if (req.method !== 'GET') throw fail('Method not allowed.',405);
      if (await serveAsset(url.pathname, res, assetDir, req.headers.range, addSharing)) return;
      if (url.pathname === '/api/jobs') { json(res,200,[...jobs.values()].reverse()); return; }
      if (url.pathname.startsWith('/api/jobs/')) {
        const job = jobs.get(url.pathname.slice(10)); if (!job) throw fail('Job not found.',404);
        json(res,200,job); return;
      }
      const match = url.pathname.match(/^\/images\/([a-f0-9-]{36})\/(image\.png|image\.json|pose\.png)$/);
      if (match && jobs.has(match[1])) {
        const bytes = await readFile(path.join(dataDir,match[1],match[2]));
        res.writeHead(200,{'Content-Type':match[2].endsWith('.png')?'image/png':'application/json'}); res.end(bytes); return;
      }
      const screenshot = url.pathname.match(/^\/screenshots\/([a-z0-9][a-z0-9-]{0,79}\.png)$/);
      if(screenshot){
        const bytes=await readFile(path.join(screenshotDir,screenshot[1]));
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache'});res.end(bytes);return;
      }
      if(url.pathname === '/screenshots' || url.pathname === '/screenshots/'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
        res.end(addSharing(await readFile(path.join(here,'screenshots.html'),'utf8')));return;
      }
      if (url.pathname === '/catalog.js') { res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(path.join(here,'catalog.js')));return; }
      if (url.pathname === '/') {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(addSharing(await readFile(path.join(here,modelUse?'index.html':'files.html'),'utf8'))); return;
      }
      throw fail('Not found.',404);
    } catch (err) { if (!res.headersSent) json(res,err.status || (err.code === 'ENOENT' ? 404 : 500),{error:err.message}); else res.end(); }
  });
  return server;
}

export async function startImageStudio() {
  const settings = studioSettings();
  // Windows can otherwise allow a new IPv6 listener beside an old IPv4 one.
  // Refuse a split deployment before loading or updating persistent jobs.
  if (settings.host === '::') {
    const reservation = net.createServer();
    await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen({port:settings.port,host:'0.0.0.0',exclusive:true},resolve);});
    await new Promise(resolve=>reservation.close(resolve));
  }
  const server = await createImageServer(settings);
  const {host,port,publicUrl} = settings;
  server.on('error',err=>{console.error(err.message);process.exitCode=1;});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port,host,ipv6Only:false},resolve);});
  console.log(`Media Hub: ${publicUrl}/\nGallery: ${publicUrl}/assets/\nAI access: ${publicUrl}/agents`);
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startImageStudio();
