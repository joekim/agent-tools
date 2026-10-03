import {mkdir,readFile,writeFile,readdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export function parseImport(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw bad('Expected a JSON object.');
  let u;try{u=new URL(input.url);}catch{throw bad('Paste a Civitai model page URL.');}
  if(u.protocol!=='https:'||!['civitai.com','www.civitai.com','civitai.red','www.civitai.red'].includes(u.hostname)||u.port||u.username||u.password||!/^\/models\/\d+(\/[^/]*)?\/?$/.test(u.pathname))throw bad('Use an https://civitai.com/models/... or https://civitai.red/models/... page URL.');
  const versions=u.searchParams.getAll('modelVersionId');
  if(versions.length>1||(versions.length&&!/^\d+$/.test(versions[0])))throw bad('Invalid model version.');
  const url=`https://civitai.com/models/${u.pathname.split('/')[2]}`+(versions.length?`?modelVersionId=${versions[0]}`:'');
  for(const [key,max] of [['name',160],['base',200],['token',512]])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>max||/[\r\n\0]/.test(input[key])))throw bad(`Invalid ${key}.`);
  return {url,name:input.name?.trim()||'',base:input.base||'',token:input.token||''};
}
export async function createCatalog({dataDir,modelsDir=process.env.IMAGE_MODELS_DIR||path.join(os.homedir(),'Documents/ComfyUI/models'),python}={}){
  const configs=path.join(dataDir,'configurations'),imports=path.join(dataDir,'imports');
  await mkdir(configs,{recursive:true});await mkdir(imports,{recursive:true});
  let active=false;
  const load=async file=>JSON.parse(await readFile(file,'utf8'));
  const atomic=async(file,value)=>{await writeFile(file+'.tmp',JSON.stringify(value,null,2));await rename(file+'.tmp',file);};
  const listConfigs=async()=>Promise.all((await readdir(configs)).filter(n=>/^civitai-[\d]+(?:-[a-f0-9]{8})?\.json$/.test(n)).map(n=>load(path.join(configs,n))));
  const listImports=async()=>Promise.all((await readdir(imports)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>load(path.join(imports,n))));
  for(const job of await listImports())if(!['completed','failed','interrupted'].includes(job.status)){
    job.status='interrupted';job.message='Server restarted during import. Paste the link again to retry.';await atomic(path.join(imports,job.id+'.json'),job);
  }
  async function baseOptions(){
    const built=[{id:'waiIllustriousSDXL_v170.safetensors',name:'WAI v17',family:'illustrious'},{id:'Illustrious-XL-v1.0.safetensors',name:'Illustrious XL v1',family:'illustrious'}].filter(b=>existsSync(path.join(modelsDir,'checkpoints',b.id)));
    return [...built,...(await listConfigs()).filter(c=>c.type==='Checkpoint'&&existsSync(path.join(modelsDir,'checkpoints',c.checkpoint))).map(c=>({id:c.id,name:c.name,family:c.family}))];
  }
  async function start(input){
    if(active)throw bad('An import is already running. Wait for it to finish.',409);
    const request=parseImport(input);active=true;
    const id=randomUUID(),file=path.join(imports,id+'.json'),requestFile=path.join(imports,id+'.request.json');
    const job={id,status:'queued',message:'Starting import',url:request.url,createdAt:new Date().toISOString()};
    try{
      await atomic(file,job);await writeFile(requestFile,JSON.stringify({url:request.url,name:request.name,base:request.base}));
      const child=spawn(python,[path.join(here,'civitai_import.py'),'--request',requestFile,'--status',file,'--configs',configs,'--models',modelsDir],{windowsHide:true,shell:false,stdio:'ignore',env:{...process.env,CIVITAI_API_TOKEN:request.token||process.env.CIVITAI_API_TOKEN||''}});
      let finalized=false;
      const finish=async()=>{if(finalized)return;finalized=true;try{const state=await load(file);if(!['completed','failed'].includes(state.status)){state.status='failed';state.message='Import worker stopped. Retry the import.';await atomic(file,state);}}finally{active=false;}};
      child.on('error',()=>finish().catch(console.error));child.on('close',()=>finish().catch(console.error));
      return job;
    }catch(e){active=false;throw e;}
  }
  async function find(id){return (await listConfigs()).find(c=>c.id===id);}
  async function update(id,input){
    if(active)throw bad('Wait for the current import before saving defaults.',409);
    const c=await find(id);if(!c)throw bad('Configuration not found.',404);
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160)throw bad('Name must contain 1-160 characters.');
    if(!Number.isInteger(input.steps)||input.steps<1||input.steps>40)throw bad('Steps must be 1-40.');
    if(typeof input.styleStrength!=='number'||!Number.isFinite(input.styleStrength)||input.styleStrength<0||input.styleStrength>1.5)throw bad('LoRA strength must be 0-1.5.');
    const extra={};
    if(input.triggers!==undefined){
      if(!Array.isArray(input.triggers)||input.triggers.length>20||input.triggers.some(t=>typeof t!=='string'||t.length>300||/[\r\n\0]/.test(t)))throw bad('Use up to 20 trigger lines, each at most 300 characters.');
      extra.triggers=input.triggers.map(t=>t.trim()).filter(Boolean);
    }
    for(const key of ['promptPrefix','negativePrompt'])if(input[key]!==undefined){
      if(typeof input[key]!=='string'||input[key].length>4000||input[key].includes('\0'))throw bad('Character and negative prompts must be at most 4000 characters.');
      extra[key]=input[key].trim();
    }
    if(input.cfg!==undefined){if(typeof input.cfg!=='number'||!Number.isFinite(input.cfg)||input.cfg<1||input.cfg>20)throw bad('Guidance must be between 1 and 20.');extra.cfg=input.cfg;}
    c.name=input.name.trim();c.steps=input.steps;c.styleStrength=input.styleStrength;
    Object.assign(c,extra);
    await atomic(path.join(configs,c.id+'.json'),c);return c;
  }
  return {listConfigs,listImports,baseOptions,start,find,update};
}
