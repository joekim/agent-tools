"""Generate and edit with local Qwen-Image-2.1 through ComfyUI."""
import argparse
import json
from pathlib import Path
import secrets
import sys
from urllib.parse import urlencode
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from krea2.krea import ComfyClient, node, prepare_inpainting, composite_inpainting


MODEL = 'qwen_image_2.1_int8_convrot.safetensors'
ENCODER = 'qwen3vl_8b_w4a8.safetensors'
VAE = 'qwen_image_2.1_vae_bf16.safetensors'


def build_graph(args, image_name=None):
    graph = {
        '1': node('UNETLoader', unet_name=MODEL, weight_dtype='default'),
        '2': node('CLIPLoader', clip_name=ENCODER, type='qwen_image', device='default'),
        '3': node('VAELoader', vae_name=VAE),
        '4': node('TextEncodeQwenImage21', clip=['2', 0], prompt=args.prompt,
                  negative_prompt='', resolution=1024),
        '5': node('EmptyLatentImage', width=args.width, height=args.height, batch_size=1),
        '6': node('KSampler', model=['1', 0], positive=['4', 0], negative=['4', 1],
                  latent_image=['5', 0], seed=args.seed, steps=args.steps, cfg=1,
                  sampler_name='euler', scheduler='simple', denoise=1),
        '7': node('VAEDecode', samples=['6', 0], vae=['3', 0]),
        '8': node('SaveImage', images=['7', 0], filename_prefix='Qwen-Image-2.1/Image-Studio'),
    }
    if image_name:
        graph['9'] = node('LoadImage', image=image_name)
        graph['10'] = node('ImageScale', image=['9', 0], upscale_method='lanczos',
                           width=args.width, height=args.height, crop='center')
        if args.command == 'edit':
            graph['4']['inputs'].update(vae=['3', 0], resolution=0,
                                         images={'image_1': ['10', 0]})
            graph['6']['inputs']['latent_image'] = ['4', 2]
            del graph['5']
        else:
            graph['11'] = node('VAEEncode', pixels=['10', 0], vae=['3', 0])
            graph['6']['inputs'].update(latent_image=['11', 0], denoise=args.strength)
            del graph['5']
    return graph


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('generate', 'edit', 'img2img'))
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--server', default='http://127.0.0.1:8189')
    parser.add_argument('--width', type=int, default=768)
    parser.add_argument('--height', type=int, default=768)
    parser.add_argument('--steps', type=int, default=25)
    parser.add_argument('--seed', type=int)
    parser.add_argument('--image', type=Path)
    parser.add_argument('--mask', type=Path, help='White edits, black preserves; PNG matching source dimensions.')
    parser.add_argument('--strength', type=float, default=0.5)
    args = parser.parse_args(argv)
    if not args.prompt.strip():
        parser.error('--prompt cannot be empty')
    if args.width < 256 or args.height < 256 or args.width % 16 or args.height % 16:
        parser.error('Dimensions must be at least 256 and multiples of 16')
    if args.steps < 1:
        parser.error('--steps must be positive')
    if args.seed is None:
        args.seed = secrets.randbelow(2**63)
    if not 0 <= args.seed < 2**64:
        parser.error('--seed must be between 0 and 2^64 - 1')
    if args.command != 'generate' and (args.image is None or not args.image.is_file()):
        parser.error('--image must name an existing file for edits and reimagining')
    if not 0 <= args.strength <= 1:
        parser.error('--strength must be between 0 and 1')
    if args.output.suffix.lower() != '.png' or args.output.exists() or args.output.with_suffix('.json').exists():
        parser.error('--output must be an unused PNG path')

    client = ComfyClient(args.server)
    info = client.request('/object_info')
    for kind, field, value in [('UNETLoader', 'unet_name', MODEL),
                               ('CLIPLoader', 'clip_name', ENCODER), ('VAELoader', 'vae_name', VAE)]:
        choices = info.get(kind, {}).get('input', {}).get('required', {}).get(field, [[]])[0]
        if value not in choices:
            raise RuntimeError(f'Missing {kind} model on {args.server}: {value}')
    if 'TextEncodeQwenImage21' not in info:
        raise RuntimeError('ComfyUI must be updated to version 0.37.0 or newer')
    image_name = client.upload(args.image) if args.image else None
    graph = build_graph(args, image_name)
    prepare_inpainting(graph, args, client)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    metadata = {'settings': {key: str(value) if isinstance(value, Path) else value
                             for key, value in vars(args).items()}, 'prompt': graph}
    metadata_path = args.output.with_suffix('.json')
    with metadata_path.open('x', encoding='utf-8') as handle:
        json.dump(metadata, handle, indent=2)
    queued = client.request('/prompt', {'prompt': graph, 'client_id': str(uuid.uuid4())})
    if queued.get('node_errors') or 'prompt_id' not in queued:
        raise RuntimeError('ComfyUI rejected the graph: ' + json.dumps(queued))
    metadata['prompt_id'] = queued['prompt_id']
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(f'Queued {args.command}: {queued["prompt_id"]}; seed={args.seed}', flush=True)
    result = client.wait(queued['prompt_id'], 900)
    images = result.get('outputs', {}).get('8', {}).get('images', [])
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
