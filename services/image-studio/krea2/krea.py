"""Generate or edit images through a local ComfyUI server. Python 3.10+, no pip dependencies."""
import argparse
import json
import mimetypes
from pathlib import Path
import secrets
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import uuid

TEXTFUSION_LORA = 'Krea2_TextFusion_Refusal_Reduction.safetensors'
FILTERBYPASS_FILES = {'2vector': 'krea2filterbypass_v2_fp32.safetensors',
                      '3vector': 'krea2filterbypass3_fp32.safetensors'}
REBALANCE_WEIGHTS = '1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0'
KREA2_SYSTEM = ('Describe the image by detailing the color, shape, size, texture, quantity, text, '
                'spatial relationships of the objects and background:')


def conditioning_text(prompt, think_content=''):
    """Use native Qwen skip-template support for an assistant-side steering block.

    Matches the default system/strip mode of fblissjr/krea-explorations'
    Krea2TextEncode node; this is supplied conditioning text, not generated reasoning.
    """
    if not think_content.strip():
        return prompt
    return (f'<|im_start|>system\n{KREA2_SYSTEM}<|im_end|>\n'
            f'<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n'
            f'<think>\n{think_content.strip()}\n</think>\n\n')


class ComfyClient:
    def __init__(self, server):
        self.server = server.rstrip('/')

    def request(self, route, data=None, content_type='application/json', binary=False):
        if data is not None and content_type == 'application/json':
            data = json.dumps(data).encode('utf-8')
        req = Request(self.server + route, data=data, headers={'Content-Type': content_type})
        try:
            with urlopen(req, timeout=120) as response:
                body = response.read()
        except HTTPError as exc:
            raise RuntimeError(f'ComfyUI HTTP {exc.code}: {exc.read().decode("utf-8", errors="replace")}') from exc
        except URLError as exc:
            raise RuntimeError(f'Cannot reach {self.server}: {exc.reason}. Start ComfyUI first.') from exc
        return body if binary else json.loads(body)

    def upload(self, path):
        boundary = uuid.uuid4().hex
        name = uuid.uuid4().hex + path.suffix.lower()
        mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
                f'Content-Type: {mime}\r\n\r\n').encode() + path.read_bytes()
        body += f'\r\n--{boundary}--\r\n'.encode()
        result = self.request('/upload/image', body, f'multipart/form-data; boundary={boundary}')
        return '/'.join(p for p in (result.get('subfolder'), result['name']) if p)

    def wait(self, prompt_id, timeout):
        deadline = time.monotonic() + timeout
        update_at = time.monotonic() + 20
        while time.monotonic() < deadline:
            entry = self.request('/history/' + prompt_id).get(prompt_id)
            if entry:
                status = entry.get('status', {})
                if status.get('status_str') == 'error':
                    raise RuntimeError('Generation failed: ' + json.dumps(status.get('messages', [])))
                if status.get('completed'):
                    return entry
            if time.monotonic() >= update_at:
                print(f'Waiting for job {prompt_id}...', flush=True)
                update_at = time.monotonic() + 20
            time.sleep(1)
        raise TimeoutError(f'Timed out waiting for {prompt_id}. The server job has NOT been cancelled; check ComfyUI history.')


def node(kind, **inputs):
    return {'class_type': kind, 'inputs': inputs}


def prepare_inpainting(graph, args, client):
    """Restrict img2img sampling to a separate white-on-black PNG mask."""
    if not getattr(args, 'mask', None):
        return
    if args.command != 'img2img':
        raise ValueError('--mask requires img2img mode')
    from PIL import Image, ImageOps
    with Image.open(args.image) as source, Image.open(args.mask) as mask:
        if mask.format != 'PNG' or mask.size != ImageOps.exif_transpose(source).size:
            raise ValueError('PNG mask dimensions must match the oriented source image')
        if not mask.convert('RGB').getchannel('R').getbbox():
            raise ValueError('The mask is empty. Paint an area to inpaint first.')
    mask_name = client.upload(args.mask)
    graph['mask_load'] = node('LoadImage', image=mask_name)
    graph['mask_scale'] = node('ImageScale', image=['mask_load', 0], upscale_method='bilinear',
                               width=args.width, height=args.height, crop='disabled')
    graph['mask_channel'] = node('ImageToMask', image=['mask_scale', 0], channel='red')
    for value in graph.values():
        if value['class_type'] == 'ImageScale':
            value['inputs']['crop'] = 'disabled'
    sampler = next(value for value in graph.values()
                   if value['class_type'] in ('KSampler', 'SamplerCustomAdvanced'))
    graph['mask_latent'] = node('SetLatentNoiseMask', samples=sampler['inputs']['latent_image'],
                                mask=['mask_channel', 0])
    sampler['inputs']['latent_image'] = ['mask_latent', 0]


def composite_inpainting(png, args):
    """Keep original resolution and exact source pixels wherever the mask is black."""
    if not getattr(args, 'mask', None):
        return png
    from io import BytesIO
    from PIL import Image, ImageOps
    with Image.open(args.image) as source_file, Image.open(args.mask) as mask_file, Image.open(BytesIO(png)) as generated:
        source = ImageOps.exif_transpose(source_file).convert('RGBA')
        mask = mask_file.convert('RGB').getchannel('R')
        replacement = generated.convert('RGBA').resize(source.size, Image.Resampling.LANCZOS)
        output = Image.composite(replacement, source, mask)
        stream = BytesIO()
        output.save(stream, format='PNG')
        return stream.getvalue()


def build_graph(args, image_name=None):
    graph = {
        '1': node('UNETLoader', unet_name=args.model, weight_dtype='default'),
        '2': node('CLIPLoader', clip_name=args.encoder, type='krea2', device='default'),
        '3': node('VAELoader', vae_name=args.vae),
        '4': node('CLIPTextEncode', text=conditioning_text(args.prompt, getattr(args, 'think_content', '')), clip=['2', 0]),
        '5': node('ConditioningZeroOut', conditioning=['4', 0]),
        '6': node('EmptyLatentImage', width=args.width, height=args.height, batch_size=1),
        '7': node('KSampler', model=['1', 0], positive=['4', 0], negative=['5', 0],
                  latent_image=['6', 0], seed=args.seed, steps=args.steps, cfg=1.0,
                  sampler_name='euler', scheduler='simple', denoise=1.0),
        '8': node('VAEDecode', samples=['7', 0], vae=['3', 0]),
        '9': node('SaveImage', images=['8', 0], filename_prefix='Krea2/script'),
    }
    model = ['1', 0]
    if getattr(args, 'rebalance', None) is not None:
        graph['17'] = node('ConditioningKrea2Rebalance', conditioning=['4', 0],
                           multiplier=args.rebalance, per_layer_weights=REBALANCE_WEIGHTS)
        graph['7']['inputs']['positive'] = ['17', 0]
    if args.textfusion:
        graph['15'] = node('LoraLoaderModelOnly', model=model,
                           lora_name=TEXTFUSION_LORA, strength_model=args.textfusion)
        model = ['15', 0]
        graph['7']['inputs']['model'] = model
    if getattr(args, 'filter_bypass', None) and args.bypass_strength:
        graph['16'] = node('LoraLoaderModelOnly', model=model,
                           lora_name=FILTERBYPASS_FILES[args.filter_bypass], strength_model=args.bypass_strength)
        model = ['16', 0]
        graph['7']['inputs']['model'] = model
    if getattr(args, 'enhancer', None) is not None:
        graph['18'] = node('Krea2T-Enhancer-Advanced', model=model, enabled=True,
                           strength=args.enhancer, text_scale=args.text_scale, debug=True)
        model = ['18', 0]
        graph['7']['inputs']['model'] = model
    if args.command in ('edit', 'img2img'):
        graph['10'] = node('LoadImage', image=image_name)
        graph['11'] = node('ImageScale', image=['10', 0], upscale_method='lanczos',
                           width=args.width, height=args.height, crop='center')
        graph['12'] = node('VAEEncode', pixels=['11', 0], vae=['3', 0])
    if args.command == 'img2img':
        graph['7']['inputs'].update(latent_image=['12', 0], denoise=args.strength)
        del graph['6']
    elif args.command == 'edit':
        graph['6']['class_type'] = 'EmptySD3LatentImage'
        graph['13'] = node('LoraLoaderModelOnly', model=model, lora_name=args.edit_lora, strength_model=1.0)
        graph['14'] = node('Krea2EditModelPatch', model=['13', 0], source_latent=['12', 0],
                           vae=['3', 0], source_image=['10', 0], target_latent=['6', 0],
                           fit_mode='fit', ref_boost=args.ref_boost)
        graph['4'] = node('Krea2EditGroundedEncode', clip=['2', 0], prompt=args.prompt,
                          image=['10', 0], grounding_px=768)
        graph['7']['inputs']['model'] = ['14', 0]
    return graph


def preflight(client, args):
    info = client.request('/object_info')
    if getattr(args, 'enhancer', None) is not None and 'Krea2T-Enhancer-Advanced' not in info:
        raise RuntimeError('Krea2T Enhancer Advanced is unavailable. Install the vendored node and restart ComfyUI.')
    if getattr(args, 'rebalance', None) is not None and 'ConditioningKrea2Rebalance' not in info:
        raise RuntimeError('ConditioningKrea2Rebalance is unavailable. Install the vendored node and restart ComfyUI.')
    checks = [('UNETLoader', 'unet_name', args.model), ('CLIPLoader', 'clip_name', args.encoder),
              ('VAELoader', 'vae_name', args.vae)]
    if args.textfusion:
        checks.append(('LoraLoaderModelOnly', 'lora_name', TEXTFUSION_LORA))
    if getattr(args, 'filter_bypass', None) and args.bypass_strength:
        checks.append(('LoraLoaderModelOnly', 'lora_name', FILTERBYPASS_FILES[args.filter_bypass]))
    if args.command == 'edit':
        missing = [name for name in ('Krea2EditModelPatch', 'Krea2EditGroundedEncode') if name not in info]
        if missing:
            raise RuntimeError('Editing nodes unavailable. Run install_edit.py with ComfyUI Python, then restart ComfyUI. Missing: ' + ', '.join(missing))
        checks.append(('LoraLoaderModelOnly', 'lora_name', args.edit_lora))
    for kind, field, value in checks:
        choices = info.get(kind, {}).get('input', {}).get('required', {}).get(field, [[]])[0]
        if value not in choices:
            raise RuntimeError(f'Missing {kind} model: {value}. Check ComfyUI model folders.')


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command, description in (
        ('generate', 'Generate a new image from text.'),
        ('edit', 'Apply an instruction with the community Krea 2 Identity Edit LoRA.'),
        ('img2img', 'Restyle a source image; describe the desired result, not an edit instruction.'),
    ):
        sub = commands.add_parser(command, help=description, description=description)
        sub.add_argument('--prompt', required=True)
        sub.add_argument('--output', type=Path, required=True, help='Output PNG path; existing files are not overwritten.')
        sub.add_argument('--server', default='http://127.0.0.1:8189')
        sub.add_argument('--width', type=int, default=768)
        sub.add_argument('--height', type=int, default=1024)
        sub.add_argument('--steps', type=int, default=8)
        sub.add_argument('--seed', type=int, default=None)
        sub.add_argument('--timeout', type=float, default=900, help='Maximum wait in seconds, including queue time.')
        sub.add_argument('--model', default='krea2_turbo_fp8_scaled.safetensors')
        sub.add_argument('--encoder', default='qwen3vl_4b_fp8_scaled.safetensors')
        sub.add_argument('--vae', default='qwen_image_vae.safetensors')
        sub.add_argument('--textfusion', nargs='?', const=1.0, default=0.0, type=float,
                         metavar='STRENGTH', help='Enable TextFusion LoRA (default strength 1.0); omitted = off.')
        if command in ('generate', 'edit'):
            sub.add_argument('--enhancer', nargs='?', const=1.0, default=None, type=float,
                             metavar='STRENGTH', help='Enable Krea2T Enhancer Advanced, strength 0 to 2 (default 1).')
            sub.add_argument('--text-scale', type=float, default=1.0,
                             help='Enhancer fused-text scale, 0.25 to 4 (default 1).')
            sub.add_argument('--rebalance', nargs='?', const=4.0, default=None, type=float,
                             metavar='MULTIPLIER', help='Enable upstream conditioning rebalance; default multiplier 4, omitted = off.')
            sub.add_argument('--filter-bypass', choices=FILTERBYPASS_FILES,
                             help='Optional Krea2 projector patch; omitted = off.')
            sub.add_argument('--bypass-strength', type=float, default=1.0,
                             help='Projector patch strength, 0 to 5 (default 1).')
        if command == 'generate':
            sub.add_argument('--think-content', default='',
                             help='Optional assistant-side conditioning text; native Krea2 chat template, no extra node.')
        if command != 'generate':
            sub.add_argument('--image', required=True, type=Path)
        if command == 'img2img':
            sub.add_argument('--mask', type=Path, help='White edits, black preserves; PNG matching source dimensions.')
            sub.add_argument('--strength', type=float, default=0.5, help='0 preserves pixels, 1 redraws completely.')
        if command == 'edit':
            sub.add_argument('--edit-lora', default='krea2_identity_edit_v1_2_r128.safetensors')
            sub.add_argument('--ref-boost', type=float, default=4.0)
    args = parser.parse_args(argv)
    if not args.prompt.strip():
        parser.error('--prompt cannot be empty')
    if args.width < 16 or args.height < 16 or args.width % 16 or args.height % 16:
        parser.error('--width and --height must be positive multiples of 16')
    if args.steps < 1 or args.timeout <= 0:
        parser.error('--steps and --timeout must be positive')
    if not 0 <= args.textfusion <= 2:
        parser.error('--textfusion strength must be between 0 and 2')
    if args.command in ('generate', 'edit'):
        if args.command == 'edit' and args.enhancer is not None:
            parser.error('--enhancer is not supported with this Identity Edit implementation: its sampling wrapper bypasses the enhancer')
        if args.enhancer is not None and not 0 <= args.enhancer <= 2:
            parser.error('--enhancer strength must be between 0 and 2')
        if not 0.25 <= args.text_scale <= 4:
            parser.error('--text-scale must be between 0.25 and 4')
        if args.enhancer is None and args.text_scale != 1.0:
            parser.error('--text-scale requires --enhancer')
        if args.rebalance is not None and not 0 < args.rebalance <= 8:
            parser.error('--rebalance multiplier must be greater than 0 and at most 8; omit it to disable')
        if not 0 <= args.bypass_strength <= 5:
            parser.error('--bypass-strength must be between 0 and 5')
        if not args.filter_bypass and args.bypass_strength != 1.0:
            parser.error('--bypass-strength requires --filter-bypass')
    if args.seed is None:
        args.seed = secrets.randbelow(2**63)
    if not 0 <= args.seed < 2**64:
        parser.error('--seed must be between 0 and 2^64 - 1')
    if args.command == 'img2img' and not 0 <= args.strength <= 1:
        parser.error('--strength must be between 0 and 1')
    if args.command == 'edit' and not 0 <= args.ref_boost <= 1000:
        parser.error('--ref-boost must be between 0 and 1000')
    if args.output.suffix.lower() != '.png':
        parser.error('--output must end in .png')
    if args.output.exists() or args.output.with_suffix('.json').exists():
        parser.error('Output PNG or metadata JSON already exists; choose a new output name')
    if args.command != 'generate' and not args.image.is_file():
        parser.error(f'Input image not found: {args.image}')
    return args


def main(argv=None):
    args = parse_args(argv)
    client = ComfyClient(args.server)
    preflight(client, args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image_name = client.upload(args.image) if args.command != 'generate' else None
    graph = build_graph(args, image_name)
    prepare_inpainting(graph, args, client)
    metadata = {'settings': {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
                'prompt': graph}
    metadata_path = args.output.with_suffix('.json')
    # Reserve the metadata filename before submitting work; never replace an earlier run.
    with metadata_path.open('x', encoding='utf-8') as handle:
        json.dump(metadata, handle, indent=2)
    queued = client.request('/prompt', {'prompt': graph, 'client_id': str(uuid.uuid4())})
    if queued.get('node_errors') or 'prompt_id' not in queued:
        raise RuntimeError('ComfyUI rejected the graph: ' + json.dumps(queued))
    metadata['prompt_id'] = queued['prompt_id']
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(f'Queued {args.command}: {queued["prompt_id"]}; seed={args.seed}', flush=True)
    result = client.wait(queued['prompt_id'], args.timeout)
    images = result.get('outputs', {}).get('9', {}).get('images', [])
    if not images:
        raise RuntimeError('Job completed without a saved image. Check ComfyUI history.')
    png = client.request('/view?' + urlencode(images[0]), binary=True)
    if not png.startswith(b'\x89PNG\r\n\x1a\n'):
        raise RuntimeError('Server returned something other than a PNG image')
    with args.output.open('xb') as handle:
        handle.write(composite_inpainting(png, args))
    metadata['result'] = result
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(f'Saved {args.output.resolve()}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, TimeoutError, ValueError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('Stopped waiting. Any queued ComfyUI job continues; check its history.', file=sys.stderr)
        sys.exit(130)
