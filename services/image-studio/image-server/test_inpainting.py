"""Checks mask polarity, sampler wiring, and exact preservation outside the mask."""
from io import BytesIO
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from krea2.krea import prepare_inpainting, composite_inpainting, parse_args, build_graph as krea_graph
from flux2.flux2 import build_graph as flux_graph
from qwen2.qwen import build_graph as qwen_graph


class InpaintingTests(unittest.TestCase):
    def test_all_model_samplers_receive_mask(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.png'
            mask = Path(directory) / 'mask.png'
            Image.new('RGB', (256, 256), 'red').save(source)
            Image.new('L', (256, 256), 'white').save(mask)
            args = parse_args(['img2img', '--prompt', 'blue mug', '--image', str(source),
                               '--mask', str(mask), '--output', str(Path(directory) / 'out.png')])
            client = SimpleNamespace(upload=lambda path: path.name)
            for builder, model, sampler in [(krea_graph, args.model, '7'),
                                            (flux_graph, 'flux2-fast', '11'),
                                            (qwen_graph, 'qwen-image-2.1', '6')]:
                args.model = model
                graph = builder(args, source.name)
                original_latent = graph[sampler]['inputs']['latent_image']
                prepare_inpainting(graph, args, client)
                self.assertEqual(graph['mask_latent']['inputs']['samples'], original_latent)
                self.assertEqual(graph[sampler]['inputs']['latent_image'], ['mask_latent', 0])
                self.assertEqual(graph['mask_channel']['inputs']['channel'], 'red')
                self.assertTrue(all(node['inputs']['crop'] == 'disabled' for node in graph.values()
                                    if node['class_type'] == 'ImageScale'))

    def test_composite_preserves_unmasked_pixels_and_dimensions(self):
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(image=Path(directory)/'source.png', mask=Path(directory)/'mask.png')
            source = Image.new('RGBA', (8, 6), (50, 70, 90, 123))
            source.save(args.image)
            mask = Image.new('L', source.size, 0)
            mask.putpixel((3, 2), 255)
            mask.save(args.mask)
            generated = BytesIO()
            Image.new('RGB', (4, 4), 'blue').save(generated, format='PNG')
            result = Image.open(BytesIO(composite_inpainting(generated.getvalue(), args)))
            self.assertEqual(result.size, source.size)
            for y in range(6):
                for x in range(8):
                    self.assertEqual(result.getpixel((x, y)), (0, 0, 255, 255) if (x, y)==(3, 2) else source.getpixel((x, y)))

    def test_empty_or_mismatched_masks_fail_before_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(command='img2img', image=Path(directory)/'source.png', mask=Path(directory)/'mask.png')
            Image.new('RGB', (8, 6)).save(args.image)
            for size in [(8, 6), (3, 3)]:
                Image.new('L', size, 0).save(args.mask)
                with self.assertRaises(ValueError):
                    prepare_inpainting({}, args, None)


if __name__ == '__main__':
    unittest.main()
