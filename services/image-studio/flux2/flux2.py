"""Generate and edit with local FLUX.2 Klein through ComfyUI."""
import argparse
import json
from pathlib import Path
import secrets
import sys
from urllib.parse import urlencode
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from krea2.krea import ComfyClient, node, prepare_inpainting, composite_inpainting


MODELS = {
    'flux2-fast': ('flux-2-klein-4b-fp8.safetensors', 1.0, 4),
    'flux2-base': ('flux-2-klein-base-4b-fp8.safetensors', 5.0, 20),
}
ENCODER = 'qwen3-4b-heretic_fp8_e4m3fn.safetensors'
VAE = 'flux2-vae.safetensors'


def build_graph(args, image_name=None):
    model, cfg, _ = MODELS[args.model]
    graph = {
        '1': node('UNETLoader', unet_name=model, weight_dtype='default'),
        '2': node('CLIPLoader', clip_name=ENCODER, type='flux2', device='default'),
        '3': node('VAELoader', vae_name=VAE),
        '4': node('EmptyFlux2LatentImage', width=args.width, height=args.height, batch_size=1),
        '5': node('CLIPTextEncode', clip=['2', 0], text=args.prompt),
        '6': node('ConditioningZeroOut', conditioning=['5', 0]),
        '7': node('CFGGuider', model=['1', 0], positive=['5', 0], negative=['6', 0], cfg=cfg),
        '8': node('RandomNoise', noise_seed=args.seed),
        '9': node('KSamplerSelect', sampler_name='euler'),
        '10': node('Flux2Scheduler', steps=args.steps, width=args.width, height=args.height),
        '11': node('SamplerCustomAdvanced', noise=['8', 0], guider=['7', 0], sampler=['9', 0],
                   sigmas=['10', 0], latent_image=['4', 0]),
        '12': node('VAEDecode', samples=['11', 0], vae=['3', 0]),
        '13': node('SaveImage', images=['12', 0], filename_prefix='Flux2-Klein/Image-Studio'),
    }
    if image_name:
        graph['14'] = node('LoadImage', image=image_name)
        graph['15'] = node('ImageScale', image=['14', 0], upscale_method='lanczos',
                           width=args.width, height=args.height, crop='center')
        graph['16'] = node('VAEEncode', pixels=['15', 0], vae=['3', 0])
        if args.command == 'edit':
            graph['6'] = node('CLIPTextEncode', clip=['2', 0], text='')
            graph['17'] = node('ReferenceLatent', conditioning=['5', 0], latent=['16', 0])
            graph['18'] = node('ReferenceLatent', conditioning=['6', 0], latent=['16', 0])
            graph['7']['inputs'].update(positive=['17', 0], negative=['18', 0])
        else:
            graph['19'] = node('SplitSigmasDenoise', sigmas=['10', 0], denoise=args.strength)
            graph['11']['inputs'].update(sigmas=['19', 1], latent_image=['16', 0])
            del graph['4']
    return graph


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('generate', 'edit', 'img2img'))
    parser.add_argument('--model', choices=MODELS, required=True)
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--server', default='http://127.0.0.1:8190')
    parser.add_argument('--width', type=int, default=768)
    parser.add_argument('--height', type=int, default=768)
    parser.add_argument('--steps', type=int)
    parser.add_argument('--seed', type=int)
    parser.add_argument('--image', type=Path)
    parser.add_argument('--mask', type=Path, help='White edits, black preserves; PNG matching source dimensions.')
    parser.add_argument('--strength', type=float, default=0.5)
    args = parser.parse_args(argv)
    if not args.prompt.strip():
        parser.error('--prompt cannot be empty')
    if args.width < 16 or args.height < 16 or args.width % 16 or args.height % 16:
        parser.error('Dimensions must be positive multiples of 16')
    if args.steps is None:
        args.steps = MODELS[args.model][2]
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
    checks = [('UNETLoader', 'unet_name', MODELS[args.model][0]),
              ('CLIPLoader', 'clip_name', ENCODER), ('VAELoader', 'vae_name', VAE)]
    for kind, field, value in checks:
        choices = info.get(kind, {}).get('input', {}).get('required', {}).get(field, [[]])[0]
        if value not in choices:
            raise RuntimeError(f'Missing {kind} model on {args.server}: {value}')
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
    images = result.get('outputs', {}).get('13', {}).get('images', [])
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
