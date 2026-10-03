"""Image Studio adapters for the tested WAI and Qwen Edit workflows."""
import argparse
import copy
import json
from pathlib import Path
import secrets
import sys
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from krea2.krea import ComfyClient

def build_graph(model, prompt, width, height, steps, seed, style_strength=.75, image_name=None, configuration=None, strength=.5, pose_name=None, pose_strength=.8, negative_prompt=None, pose_map=False):
    template = Path(__file__).parent/'workflows'/('wai-v17.json' if configuration else f'{model}.json')
    graph = copy.deepcopy(json.loads(template.read_text(encoding='utf8')))
    if model == 'wai-v17' or configuration:
        if not 0 <= style_strength <= 1.5:
            raise ValueError('Style strength must be between 0 and 1.5')
        graph['2']['inputs'].update(strength_model=style_strength, strength_clip=style_strength)
        graph['4']['inputs']['text'] = ('ar art, ' if style_strength and not prompt.lower().startswith('ar art,') else '')+prompt
        graph['6']['inputs'].update(width=width, height=height)
        graph['7']['inputs'].update(steps=steps, seed=seed)
        if configuration:
            graph['1']['inputs']['ckpt_name']=configuration['checkpoint']
            triggers=', '.join(configuration.get('triggers',[])) if style_strength else ''
            graph['4']['inputs']['text']=', '.join(x for x in [triggers,configuration.get('promptPrefix','').strip(),prompt] if x)
            graph['5']['inputs']['text']=configuration.get('negativePrompt','')
            graph['7']['inputs']['cfg']=configuration.get('cfg',7)
            if configuration.get('lora'):
                graph['2']['inputs']['lora_name']=configuration['lora']
            else:
                del graph['2']
                graph['3']['inputs']['clip']=['1',1]
                graph['7']['inputs']['model']=['1',0]
        if negative_prompt:
            graph['5']['inputs']['text']=', '.join(x for x in [graph['5']['inputs'].get('text','').strip(), negative_prompt.strip()] if x)
        if image_name:
            if not configuration:raise ValueError('Image-to-image requires an imported configuration')
            if not 0 <= strength <= 1:raise ValueError('Strength must be between 0 and 1')
            graph['10']={'class_type':'LoadImage','inputs':{'image':image_name}}
            graph['11']={'class_type':'ImageScale','inputs':{'image':['10',0],'upscale_method':'nearest-exact','width':width,'height':height,'crop':'disabled'}}
            graph['6']={'class_type':'VAEEncode','inputs':{'pixels':['11',0],'vae':['1',2]}}
            graph['7']['inputs']['denoise']=strength
        if pose_name:
            if not 0 <= pose_strength <= 2:raise ValueError('Pose strength must be between 0 and 2')
            graph['20']={'class_type':'LoadImage','inputs':{'image':pose_name}}
            graph['23']={'class_type':'DWPreprocessor','inputs':{'image':['20',0],'detect_hand':'enable','detect_body':'enable','detect_face':'enable','resolution':512,'bbox_detector':'yolox_l.onnx','pose_estimator':'dw-ll_ucoco_384_bs5.torchscript.pt','scale_stick_for_xinsr_cn':'disable'}}
            graph['24']={'class_type':'ImageScale','inputs':{'image':['23',0],'upscale_method':'nearest-exact','width':width,'height':height,'crop':'disabled'}}
            if pose_map:
                del graph['23']
                graph['24']['inputs']['image']=['20',0]
            graph['25']={'class_type':'ControlNetLoader','inputs':{'control_net_name':'xinsir-openpose-sdxl.safetensors'}}
            graph['26']={'class_type':'ControlNetApplyAdvanced','inputs':{'positive':['4',0],'negative':['5',0],'control_net':['25',0],'image':['24',0],'strength':pose_strength,'start_percent':0.0,'end_percent':1.0,'vae':['1',2]}}
            graph['7']['inputs'].update(positive=['26',0],negative=['26',1])
            graph['27']={'class_type':'SaveImage','inputs':{'images':['24',0],'filename_prefix':'ImageStudio/pose-map'}}
        save = '9'
    elif model == 'qwen-edit-2509':
        if not image_name:
            raise ValueError('Qwen Edit requires a source image')
        if steps != 4:
            raise ValueError('This Qwen Edit Lightning preset requires 4 steps')
        graph['4']['inputs']['image'] = image_name
        graph['5']['inputs']['prompt'] = prompt
        graph['7']['inputs'].update(width=width, height=height)
        graph['10']['inputs'].update(seed=seed, steps=steps)
        save = '12'
    else:
        raise ValueError('Unknown model')
    graph[save]['inputs']['filename_prefix'] = 'ImageStudio/'+model
    return graph, save

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=['generate','edit','img2img'])
    p.add_argument('--model',required=True,choices=['wai-v17','qwen-edit-2509','imported-sdxl'])
    p.add_argument('--prompt',required=True)
    p.add_argument('--negative-prompt',default='')
    p.add_argument('--output',required=True,type=Path)
    p.add_argument('--server',default='http://127.0.0.1:8189')
    p.add_argument('--width',type=int,default=1024)
    p.add_argument('--height',type=int,default=1024)
    p.add_argument('--steps',type=int)
    p.add_argument('--seed',type=int)
    p.add_argument('--style-strength',type=float,default=.75)
    p.add_argument('--image',type=Path)
    p.add_argument('--strength',type=float,default=.5)
    p.add_argument('--configuration',type=Path)
    p.add_argument('--pose-image',type=Path)
    p.add_argument('--pose-map',action='store_true')
    p.add_argument('--pose-strength',type=float,default=.8)
    a=p.parse_args()
    configuration=json.loads(a.configuration.read_text(encoding='utf8')) if a.configuration else None
    if a.model=='imported-sdxl' and not configuration:p.error('Configuration required')
    allowed=['generate','img2img'] if a.model=='imported-sdxl' else ['generate'] if a.model=='wai-v17' else ['edit']
    if a.mode not in allowed:p.error('Unsupported mode for this model')
    if not 0 <= a.strength <= 1:p.error('Strength must be between 0 and 1')
    if not a.prompt.strip() or not all(256<=v<=1536 and v%16==0 for v in [a.width,a.height]):
        p.error('Provide a prompt and dimensions from 256 to 1536 in multiples of 16')
    a.steps=a.steps if a.steps is not None else (25 if a.model in ('wai-v17','imported-sdxl') else 4)
    a.seed=a.seed if a.seed is not None else secrets.randbelow(2**63)
    if not 1<=a.steps<=40 or not 0<=a.seed<2**64:p.error('Invalid steps or seed')
    if a.output.exists() or a.output.with_suffix('.json').exists():p.error('Output already exists')
    if a.mode in ('edit','img2img') and (not a.image or not a.image.is_file()):p.error('Source image required')
    if a.pose_image and (a.model=='qwen-edit-2509' or not a.pose_image.is_file()):p.error('Pose requires a source file and an SDXL model')
    c=ComfyClient(a.server)
    graph,save=build_graph(a.model,a.prompt,a.width,a.height,a.steps,a.seed,a.style_strength,
                           c.upload(a.image) if a.mode!='generate' and a.image else None, configuration, a.strength, c.upload(a.pose_image) if a.pose_image else None, a.pose_strength, a.negative_prompt, a.pose_map)
    info=c.request('/object_info')
    for n in graph.values():
        field={'CheckpointLoaderSimple':'ckpt_name','UNETLoader':'unet_name','CLIPLoader':'clip_name','VAELoader':'vae_name','LoraLoader':'lora_name','LoraLoaderModelOnly':'lora_name','ControlNetLoader':'control_net_name'}.get(n['class_type'])
        if field and n['inputs'][field] not in info.get(n['class_type'],{}).get('input',{}).get('required',{}).get(field,[[]])[0]:
            raise RuntimeError('Missing model: '+n['inputs'][field])
    a.output.parent.mkdir(parents=True,exist_ok=True)
    record={'settings':{k:str(v) if isinstance(v,Path) else v for k,v in vars(a).items()},'prompt':graph}
    meta=a.output.with_suffix('.json')
    with meta.open('x',encoding='utf8') as f:json.dump(record,f,indent=2)
    q=c.request('/prompt',{'prompt':graph})
    if 'prompt_id' not in q:raise RuntimeError(str(q))
    record['prompt_id']=q['prompt_id'];meta.write_text(json.dumps(record,indent=2),encoding='utf8')
    record['result']=c.wait(q['prompt_id'],1800)
    im=record['result']['outputs'][save]['images'][0]
    with a.output.open('xb') as f:f.write(c.request('/view?'+urlencode(im),binary=True))
    meta.write_text(json.dumps(record,indent=2),encoding='utf8')
    if a.pose_image:
        pose=record['result']['outputs']['27']['images'][0]
        a.output.with_name('pose.png').write_bytes(c.request('/view?'+urlencode(pose),binary=True))
    print('Saved '+str(a.output),flush=True)

if __name__=='__main__':main()
