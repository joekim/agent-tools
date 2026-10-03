"""Validate mono Vorbis recordings and optionally package them for download."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', type=Path, default=ROOT / 'docs/island-voice-lines.json')
parser.add_argument('--audio-dir', type=Path, default=ROOT / 'apps/island/assets/voices/qwen3')
parser.add_argument('--archive', type=Path)
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
for line in manifest["lines"]:
    expected = hashlib.sha1((manifest["voice"] + "\n" + line["text"]).encode()).hexdigest()[:24] + ".ogg"
    if line["file"] != expected:
        raise ValueError(f"Wrong filename for {line['text']}")
    recording = args.audio_dir / expected
    wave, rate = sf.read(recording)
    info = sf.info(recording)
    if info.format != "OGG" or info.subtype != "VORBIS" or info.channels != 1:
        raise ValueError(f"Not mono Vorbis: {recording}")
    if len(wave) == 0 or not max(abs(wave)) > 0.001:
        raise ValueError(f"Empty or silent: {recording}")
if args.archive:
    portable = {key: manifest[key] for key in ('voice', 'format', 'lines')}
    temporary = args.archive.with_suffix('.zip.tmp')
    with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED) as archive:
        for line in manifest['lines']:
            archive.write(args.audio_dir / line['file'], arcname=line['file'])
        archive.writestr('manifest.json', json.dumps(portable, ensure_ascii=False, indent=2))
    temporary.replace(args.archive)
print(f"Validated {len(manifest['lines'])} mono Ogg voice recordings")
