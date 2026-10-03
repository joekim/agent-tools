window.studioConfigs=new Map();
let catalogSnapshot='',importSnapshot='';
async function refreshCatalog(){
  const r=await fetch('/api/configurations');if(!r.ok)throw Error('Could not load configurations.');const data=await r.json();
  const snapshot=JSON.stringify(data);if(snapshot===catalogSnapshot)return;catalogSnapshot=snapshot;
  window.studioConfigs=new Map(data.configurations.map(c=>[c.id,c]));
  const selected=$('model').value;
  for(const o of [...$('model').options])if(o.value.startsWith('civitai-'))o.remove();
  for(const c of data.configurations){const o=document.createElement('option');o.value=c.id;o.textContent=c.name;$('model').append(o);}
  $('model').value=selected;
  const base=$('importBase').value;$('importBase').replaceChildren(new Option('Automatic compatible base',''));
  for(const b of data.bases)$('importBase').append(new Option(b.name+' ('+b.family+')',b.id));
  if([...$('importBase').options].some(o=>o.value===base))$('importBase').value=base;
  $('mode').onchange();
  window.dispatchEvent(new Event('studio-catalog-ready'));
}
async function refreshImports(){
  const r=await fetch('/api/imports');if(!r.ok)throw Error('Could not load import status.');const jobs=await r.json();
  const snapshot=JSON.stringify(jobs);if(snapshot===importSnapshot)return;importSnapshot=snapshot;
  $('importJobs').replaceChildren();
  const active=jobs.some(j=>!['completed','failed','interrupted'].includes(j.status));$('importSubmit').disabled=active;
  for(const j of jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,8)){
    const box=document.createElement('div'),p=document.createElement('p');
    p.textContent=(j.modelName||'Model import')+' — '+j.message;box.append(p);
    if(j.status==='downloading'){
      const progress=document.createElement('progress');if(j.totalBytes){progress.max=j.totalBytes;progress.value=j.bytes||0;}
      const label=document.createElement('span');label.textContent=' '+((j.bytes||0)/1024**2).toFixed(0)+' MB'+(j.totalBytes?' / '+(j.totalBytes/1024**2).toFixed(0)+' MB':'');box.append(progress,label);
    }
    if(j.status==='completed'&&j.configuration){
      const button=document.createElement('button');button.type='button';button.textContent='Use configuration';button.onclick=async()=>{await refreshCatalog();$('model').value=j.configuration.id;$('model').onchange();$('form').scrollIntoView({behavior:'smooth'});};box.append(button);
    }
    if(['failed','interrupted'].includes(j.status)){
      const retry=document.createElement('button');retry.type='button';retry.textContent='Prepare retry';retry.onclick=()=>{$('importUrl').value=j.url;$('importUrl').focus();};box.append(retry);
    }
    $('importJobs').append(box);
  }
  await refreshCatalog();
}
$('importForm').onsubmit=async e=>{
  e.preventDefault();$('importSubmit').disabled=true;$('importMessage').textContent='Starting import...';
  try{
    const body={url:$('importUrl').value,name:$('importName').value,base:$('importBase').value,token:$('importToken').value};
    const r=await fetch('/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();
    $('importToken').value='';if(!r.ok)throw Error(result.error);
    $('importMessage').textContent='Import started. You can keep using Media Hub while it downloads.';await refreshImports();
  }catch(e){$('importToken').value='';$('importMessage').textContent=e.message;$('importSubmit').disabled=false;}
};
$('saveConfig').onclick=async()=>{
  const id=$('model').value;if(!window.studioConfigs.has(id))return;
  try{const r=await fetch('/api/configurations/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('configName').value,steps:+$('steps').value,styleStrength:+$('styleStrength').value,triggers:$('configTriggers').value.split(/\r?\n/).map(t=>t.trim()).filter(Boolean),promptPrefix:$('configPrefix').value,negativePrompt:$('configNegative').value,cfg:+$('configCfg').value})});const result=await r.json();if(!r.ok)throw Error(result.error);window.configEditorId=null;await refreshCatalog();$('mode').onchange();$('message').textContent='Configuration defaults saved.';}catch(e){$('message').textContent=e.message;}
};
refreshCatalog().then(refreshImports).catch(e=>$('importMessage').textContent=e.message);
setInterval(()=>refreshImports().catch(e=>$('importMessage').textContent=e.message),2500);
