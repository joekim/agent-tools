"""Generate island speech using the local Qwen3 CustomVoice model; never download weights."""
import argparse
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--bundle", action="store_true", help="Also copy recordings into the Godot export")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--manifest", type=Path, default=ROOT / "docs/island-voice-lines.json")
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")
    with redirect_stdout(sys.stderr):
        import soundfile as sf
        import torch
        from qwen_tts import Qwen3TTSModel

        model_path = Path(os.environ.get("ISLAND_VOICE_MODEL", ROOT / ".cache/qwen3-tts/model-narrator"))
        if not model_path.is_dir():
            raise FileNotFoundError(f"Local voice model missing: {model_path}")
        torch.set_num_threads(8)
        model = Qwen3TTSModel.from_pretrained(
            str(model_path), device_map=os.environ.get("ISLAND_VOICE_DEVICE", "cpu"),
            dtype=torch.bfloat16, attn_implementation="sdpa", low_cpu_mem_usage=True,
        )

    def generate(requests):
        requests = [(text, Path(output)) for text, output in requests if not Path(output).is_file()]
        if not requests:
            return
        with redirect_stdout(sys.stderr):
            torch.manual_seed(101)
            waves, rate = model.generate_custom_voice(
                text=[text for text, _ in requests], language="English", speaker="Aiden",
                instruct="Warm, clear storybook narration for young children. Playful and unhurried.",
            )
        for (_, output), wave in zip(requests, waves, strict=True):
            output.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
                ogg = Path(temporary) / "line.ogg"
                if wave.ndim > 1:
                    wave = wave.mean(axis=1)
                sf.write(ogg, wave, rate, format="OGG", subtype="VORBIS")
                if ogg.stat().st_size == 0:
                    raise RuntimeError("Empty voice recording")
                os.replace(ogg, output)

    if args.serve:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                generate([(request["text"], request["output"])])
                print(json.dumps({"ok": True}), flush=True)
            except Exception as error:
                print(json.dumps({"ok": False, "error": str(error)}), flush=True)
    else:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        if manifest["voice"] != "Qwen3-CustomVoice-Aiden-v1":
            raise ValueError("Regenerate the manifest with scripts/voice-lines.ts first")
        for offset in range(0, len(manifest["lines"]), args.batch_size):
            batch = manifest["lines"][offset:offset + args.batch_size]
            generate([(line["text"], ROOT / manifest["folder"] / line["file"]) for line in batch])
            for index, line in enumerate(batch, offset + 1):
                output = ROOT / manifest["folder"] / line["file"]
                if args.bundle:
                    destination = ROOT / "apps/island/assets/voices/qwen3" / line["file"]
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(output, destination)
                print(f"{index}/{len(manifest['lines'])} {line['text']}", flush=True)


if __name__ == "__main__":
    main()
