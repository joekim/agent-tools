"""Download supported Civitai weights and register a local Image Studio preset."""
import argparse, hashlib, json, os, re, struct, time
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs

MAX_BYTES=12*1024**3
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def parse_url(value):
    u=urlsplit(value.strip())
    m=re.fullmatch(r'/models/(\d+)(?:/[^/]*)?/?',u.path)
    if u.scheme!='https' or u.hostname not in ('civitai.com','www.civitai.com','civitai.red','www.civitai.red') or u.port not in (None,443) or u.username or u.password or not m:
        raise ValueError('Paste an https://civitai.com/models/... or https://civitai.red/models/... page URL.')
    versions=parse_qs(u.query).get('modelVersionId',[])
    if versions and (len(versions)!=1 or not versions[0].isdigit()):raise ValueError('Invalid modelVersionId.')
    return int(m[1]),int(versions[0]) if versions else None

def family(base):
    if base=='Illustrious':return 'illustrious'
    if base=='Pony':return 'pony'
    if base in ('SDXL 1.0','SDXL 0.9'):return 'sdxl'
    raise ValueError(f'{base} needs a different workflow. This importer currently supports SDXL, Illustrious and Pony checkpoints and standard LoRAs.')

def remote(url,token=''):
    opener=build_opener(NoRedirect())
    for _ in range(6):
        u=urlsplit(url)
        host=u.hostname or ''
        if u.scheme!='https' or u.port not in (None,443) or u.username or u.password or not (host=='civitai.com' or host.endswith('.civitai.com') or host.endswith('.cloudflarestorage.com')):
            raise ValueError('Civitai returned an unsupported download host. No file was installed.')
        headers={'User-Agent':'ImageStudio/1.0'}
        if token and host=='civitai.com':headers['Authorization']='Bearer '+token
        try:return opener.open(Request(url,headers=headers),timeout=90)
        except HTTPError as e:
            if e.code in (301,302,303,307,308):
                from urllib.parse import urljoin
                url=urljoin(url,e.headers.get('Location',''));continue
            if e.code in (401,403):raise ValueError('Civitai requires access to this download. Retry with your Civitai API key; paid or restricted models still require account access.') from None
            raise ValueError(f'Civitai returned HTTP {e.code}. Retry later or check the page.') from None
    raise ValueError('Too many download redirects.')

def metadata(url,token):
    with remote(url,token) as r:
        raw=r.read(4*1024*1024+1)
    if len(raw)>4*1024*1024:raise ValueError('Model metadata is too large.')
    try:return json.loads(raw)
    except Exception:raise ValueError('Civitai did not return model metadata. Check account access and retry.') from None

def choose(card,version_id):
    versions=card.get('modelVersions',[])
    version=next((v for v in versions if v['id']==version_id),None) if version_id else (versions[0] if versions else None)
    if not version:raise ValueError('The requested version was not found on this model page.')
    kind=card.get('type')
    if kind not in ('Checkpoint','LORA'):raise ValueError(f'{kind} is not supported; choose a checkpoint or standard LoRA.')
    fam=family(version.get('baseModel','Unknown'))
    files=[f for f in version.get('files',[]) if f.get('type')=='Model' and f.get('name','').lower().endswith('.safetensors') and f.get('metadata',{}).get('format')=='SafeTensor']
    files.sort(key=lambda f:not f.get('primary',False))
    if not files:raise ValueError('This version has no supported SafeTensors model file.')
    f=files[0]
    if not re.fullmatch('[a-fA-F0-9]{64}',f.get('hashes',{}).get('SHA256','')):raise ValueError('The model is missing a SHA256 checksum; import stopped.')
    if f.get('sizeKB',0)*1024>MAX_BYTES:raise ValueError('This file exceeds the 12 GB import limit.')
    return version,f,kind,fam

def checksum(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def validate_weights(p,kind):
    size=p.stat().st_size
    with p.open('rb') as f:
        prefix=f.read(8)
        if len(prefix)!=8:raise ValueError('Invalid SafeTensors file.')
        n=struct.unpack('<Q',prefix)[0]
        if n<2 or n>min(32*1024*1024,size-8):raise ValueError('Download is not a SafeTensors model (possibly a login page).')
        h=json.loads(f.read(n))
    keys=[k for k in h if k!='__metadata__']
    if not keys:raise ValueError('SafeTensors file has no weights.')
    for k in keys:
        offsets=h[k].get('data_offsets',[])
        if len(offsets)!=2 or not all(isinstance(v,int) for v in offsets) or not 0<=offsets[0]<=offsets[1]<=size-8-n:raise ValueError('Invalid tensor offsets.')
    if kind=='Checkpoint' and not (any(k.startswith('model.diffusion_model.') for k in keys) and any(k.startswith('first_stage_model.') for k in keys) and any(k.startswith('conditioner.') for k in keys)):
        raise ValueError('This is not a full SDXL checkpoint with its VAE and text encoders. It needs a different loader.')
    if kind=='LORA' and not any('lora_down.weight' in k or 'lora_A.weight' in k for k in keys):
        raise ValueError('This adapter is not a supported standard LoRA.')
    return h.get('__metadata__',{})

def atomic_json(p,data):
    tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(data,indent=2),encoding='utf8');tmp.replace(p)

def bases(config_dir,models_dir):
    result=[]
    for name,label in [('waiIllustriousSDXL_v170.safetensors','WAI v17'),('Illustrious-XL-v1.0.safetensors','Illustrious XL v1')]:
        if (models_dir/'checkpoints'/name).is_file():result.append({'id':name,'name':label,'family':'illustrious','checkpoint':name})
    for p in config_dir.glob('civitai-*.json'):
        c=json.loads(p.read_text(encoding='utf8'))
        if c.get('type')=='Checkpoint' and (models_dir/'checkpoints'/c['checkpoint']).is_file():result.append({'id':c['id'],'name':c['name'],'family':c['family'],'checkpoint':c['checkpoint']})
    return result

def downloads_folder():
    if os.name=='nt':
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders') as key:
                value,_=winreg.QueryValueEx(key,'{374DE290-123F-4565-9164-39C4925E467B}')
                return Path(os.path.expandvars(value))
        except OSError:pass
    return Path.home()/'Downloads'


def recover_download(folder,expected_name,digest,kind,part,report):
    report(status='checking',message='Download failed; checking Downloads for a manually downloaded model',bytes=0,totalBytes=0)
    try:
        candidates=[p for p in folder.iterdir() if p.is_file() and not p.is_symlink() and p.suffix.lower()=='.safetensors']
    except OSError:return False
    candidates.sort(key=lambda p:(p.name.lower()!=expected_name.lower(),p.name.lower()))
    for candidate in candidates:
        try:
            if candidate.stat().st_size>MAX_BYTES or checksum(candidate)!=digest:continue
            validate_weights(candidate,kind)
        except (OSError,ValueError):continue
        report(status='installing',message='Installing verified model from Downloads; original file is kept')
        # Verify the copied bytes too, in case a browser is still writing the source.
        h=hashlib.sha256();done=0
        with candidate.open('rb') as source,part.open('wb') as target:
            while chunk:=source.read(4*1024*1024):
                done+=len(chunk)
                if done>MAX_BYTES:raise ValueError('Local file exceeds the import limit.')
                target.write(chunk);h.update(chunk)
        if h.hexdigest()!=digest:raise ValueError('The file in Downloads changed while copying. Wait for it to finish and retry.')
        validate_weights(part,kind)
        return True
    return False


def import_model(url,name,base_id,config_dir,models_dir,report,token='',get_meta=metadata,get_remote=remote,downloads_dir=None):
    model_id,version_id=parse_url(url)
    report(status='resolving',message='Reading model information')
    card=get_meta(f'https://civitai.com/api/v1/models/{model_id}',token)
    version,f,kind,fam=choose(card,version_id)
    base=None
    if kind=='LORA':
        compatible=[b for b in bases(config_dir,models_dir) if b['family']==fam]
        base=next((b for b in compatible if b['id']==base_id),None) if base_id else next(iter(compatible),None)
        if not base:raise ValueError(f'No compatible {fam} base checkpoint is installed or selected. Import a {fam} checkpoint first, then retry this LoRA.')
    digest=f['hashes']['SHA256'].lower()
    dest_dir=models_dir/('loras' if kind=='LORA' else 'checkpoints');dest_dir.mkdir(parents=True,exist_ok=True)
    filename=f'civitai-{version["id"]}-{f["id"]}.safetensors'
    dest=dest_dir/filename
    existing=dest_dir/f['name'] if Path(f['name']).name==f['name'] and not any(c in f['name'] for c in '\\/:') else None
    report(status='checking',message=f'Checking {card["name"]} / {version["name"]}',modelName=card['name'],versionName=version['name'],baseModel=version['baseModel'])
    if not dest.exists() and existing and existing.is_file() and checksum(existing)==digest:dest=existing;filename=dest.name
    if dest.exists():
        if checksum(dest)!=digest:raise ValueError('An installed file has a different checksum. It was left unchanged.')
    else:
        part=dest.with_suffix('.part')
        try:
            with get_remote(f['downloadUrl'],token) as r,part.open('wb') as out:
                if 'text/html' in r.headers.get('Content-Type',''):raise ValueError('Civitai returned a login page. Retry with your Civitai API key.')
                total=int(r.headers.get('Content-Length','0'));done=0;last=0;h=hashlib.sha256()
                if total>MAX_BYTES:raise ValueError('File exceeds the 12 GB import limit.')
                while chunk:=r.read(4*1024*1024):
                    done+=len(chunk)
                    if done>MAX_BYTES:raise ValueError('File exceeds the 12 GB import limit.')
                    out.write(chunk);h.update(chunk)
                    if time.monotonic()-last>1:
                        report(status='downloading',message='Downloading model',bytes=done,totalBytes=total);last=time.monotonic()
            report(status='verifying',message='Verifying file integrity')
            if h.hexdigest()!=digest:raise ValueError('SHA256 verification failed. The download was not installed.')
            validate_weights(part,kind);part.replace(dest)
        except (OSError,ValueError) as error:
            if part.exists():part.unlink()
            folder=Path(downloads_dir) if downloads_dir is not None else downloads_folder()
            if not recover_download(folder,f['name'],digest,kind,part,report):
                reason=str(error) if isinstance(error,ValueError) else 'The model download failed.'
                raise ValueError(reason+' No verified matching SafeTensors file was found in Downloads. Download this version manually, then retry the import.') from None
            part.replace(dest)
        finally:
            if part.exists():part.unlink()
    train=validate_weights(dest,kind)
    triggers=[t[:300] for t in version.get('trainedWords',[]) if isinstance(t,str)][:20]
    config_id=f'civitai-{version["id"]}'+(('-'+hashlib.sha256(base['checkpoint'].encode()).hexdigest()[:8]) if base else '')
    saved=config_dir/(config_id+'.json')
    if saved.exists():
        config=json.loads(saved.read_text(encoding='utf8'));report(status='completed',message='Already installed; saved defaults preserved',configuration=config);return config
    config={'id':config_id,'name':name.strip() or f'{card["name"]} / {version["name"]}','type':kind,'family':fam,'checkpoint':base['checkpoint'] if base else filename,'lora':filename if base else None,'triggers':triggers,'styleStrength':.75 if base else 0,'steps':25,'cfg':7,'source':f'https://civitai.com/models/{model_id}?modelVersionId={version["id"]}','sha256':digest,'versionId':version['id'],'baseName':base['name'] if base else card['name'],'trainingBase':str(train.get('ss_sd_model_name',''))[:500],'note':'Matched by model family; the creator may recommend a different checkpoint or sampling recipe.','createdAt':time.time()}
    config_dir.mkdir(parents=True,exist_ok=True);atomic_json(config_dir/(config_id+'.json'),config)
    report(status='completed',message='Ready in the model selector',configuration=config)
    return config

def main():
    p=argparse.ArgumentParser();p.add_argument('--request',type=Path,required=True);p.add_argument('--status',type=Path,required=True);p.add_argument('--configs',type=Path,required=True);p.add_argument('--models',type=Path,required=True);a=p.parse_args()
    request=json.loads(a.request.read_text(encoding='utf8'));state=json.loads(a.status.read_text(encoding='utf8'))
    def report(**kw):state.update(kw);atomic_json(a.status,state)
    try:import_model(request['url'],request.get('name',''),request.get('base',''),a.configs,a.models,report,os.environ.get('CIVITAI_API_TOKEN',''))
    except Exception as e:
        # Network exception strings can include signed download URLs; never persist those.
        message=str(e) if isinstance(e,ValueError) else 'Import failed. Check connectivity, free disk space and model-directory access, then retry.'
        report(status='failed',message=message)

if __name__=='__main__':main()
