# Media Hub preview

Media Hub is the product name for this independent copy. Its agent interface includes `media-hub.transcript` for YouTube captions and `media-hub.library` for galleries. Visit `/agents` for connection instructions. Existing directory/config names are retained for compatibility; the original Image Studio remains separate.

This source is maintained in agent-tools. The independent preview uses port **3002** and `~/.agent-tools/image-studio` for its own galleries, screenshots, and saved jobs. The original service remains on port 3001 with separate data. Use `npm run start:studio` from the agent-tools root, or let the hub start it at login. Share `http://meesa.local:3002/` and `http://meesa.local:3002/assets/`.

Generation and model downloads are disabled in this staging copy until its backend is configured independently. The historical documentation below describes the original generation features; its port 3001 and launcher references refer to the original installation, not this preview.

Double-click **Start Image Server.cmd**, then open http://127.0.0.1:3001.
On a phone on the same Wi-Fi, open http://Meesa.local:3001 (or
http://Meesa:3001). The launcher enables local-network access, and the server
accepts the PC's hostname and its `.local` name.
Keep the existing ComfyUI instance running on port 8189. Generation needs the
installed Krea 2 models; editing also needs the Identity Edit nodes and LoRA
documented in `krea2/README.md`. No npm dependencies or API key are required.
For FLUX.2 Klein, also start `flux2/Start FLUX2.ps1`; it serves the installed
FLUX.2 models and reduced-refusal encoder on port 8190. Qwen-Image-2.1 uses
the main ComfyUI server on port 8189 and requires ComfyUI 0.37.0 or newer plus
the model, text encoder, and VAE installed under its `models` directory.

Alternatively run `npm run start:images` with Node 20 or newer.

The browser page supports text-to-image, instruction editing, and img2img
restyling. Upload PNG, JPEG or WebP files up to 10 MB. Jobs run one at a time;
up to five can be running or waiting. Outputs and metadata are saved under
`image-runs/<job-id>/` (ignored by Git). Restarting preserves the gallery but
does not resubmit unfinished work. Stopping this server does not cancel work
already submitted to ComfyUI. The CLI stops waiting after 15 minutes; a timed-out
ComfyUI job may still finish there. Editing may change unintended details.

## API

`POST /api/jobs` accepts JSON and returns HTTP 202 with a job ID:

```json
{"mode":"generate","prompt":"A red ceramic mug on a wooden table","width":768,"height":768,"steps":8,"seed":"42"}
```

For `mode: "edit"` or `"img2img"`, include `image` as an image data URL
(`data:image/png;base64,...`). For edits, describe the change. For img2img,
describe the desired final image and optionally set `strength` from 0 to 1
(default 0.5). Seed is optional; use a decimal string to retain 64-bit precision.
Dimensions are multiples of 16 from 256 to 1536. Steps range from 1 to 40.
Set `model` to `krea2` (default), `flux2-fast`, `flux2-base`, or
`qwen-image-2.1`. The FLUX.2 defaults are 4 steps for fast and 20 for base;
Qwen-Image-2.1 defaults to 25 steps. FLUX.2 and Qwen editing use the source
image as a reference; reimagine uses the denoise strength slider.

- `GET /api/jobs`: saved jobs, newest first.
- `GET /api/jobs/<id>`: status (`queued`, `running`, `completed`, `failed`, or `interrupted`).
- `DELETE /api/jobs/<id>`: remove a finished job and its saved files. Queued and running jobs return HTTP 409.
- `GET /images/<id>/image.png`: completed image.
- `GET /images/<id>/image.json`: full generation metadata, including actual seed.

Environment options: `IMAGE_PORT` (3001), `IMAGE_HOST` (127.0.0.1),
`COMFY_URL` (http://127.0.0.1:8189), `FLUX2_COMFY_URL`
(http://127.0.0.1:8190), and `IMAGE_PYTHON` (Python executable).
The default Python is the existing ComfyUI virtual environment, falling back
to `python` on PATH. To allow home-network access, set `IMAGE_HOST=0.0.0.0`
and allow the port through the private-network firewall, then open the PC's
LAN IP on your phone. This server has no authentication; keep it on a trusted
network and do not forward its port publicly.

Generate mode enables Krea2T Enhancer Advanced by default (strength 1, text
scale 1). Open **Advanced generation options** to change or disable it, or to
set TextFusion, Rebalance, a projector patch, or assistant-side conditioning
text. Edit mode exposes TextFusion, Rebalance, projector patches, and reference
boost. Reimagine mode exposes TextFusion and denoise strength. The prompt is
passed through as written; assistant-side conditioning is optional text you
enter yourself. Completed jobs link to their full settings JSON.
The gallery's **Delete** button removes a finished job, its image, metadata,
and uploaded source from `image-runs` after confirmation. ComfyUI's separate
output copy remains in its own output folder.

Run checks with `node --test image-server/server.test.mjs`.

## Inpainting

Click **Inpaint** on a completed image, or upload a source and click
**Paint inpainting mask**. Brush over the area to change; the translucent red
overlay marks the selection and is never painted into the source image.
Use the eraser, adjustable brush size, undo/redo, and clear to refine it.
Click **Use mask**, describe the desired content in that area, then
**Apply inpainting**. Higher strength redraws the selected area more strongly.
Masks can be reopened and adjusted until you change the source or reload.
**Download mask** exports a white-on-black PNG.

All model families use masked img2img sampling with `SetLatentNoiseMask`.
This uses the existing models, not a dedicated inpainting checkpoint. Final
results are composited at the original source resolution, preserving exact
decoded source pixels wherever the mask is black. Antialiased edges blend
the generated content. The original saved image remains unchanged.
Pillow (included in the ComfyUI environment) is required for compositing.
ComfyUI's own output copy is the intermediate image; the Image studio download
is the final composite.

The API accepts `mode: "inpaint"`, a source `image`, and a separate `mask`
PNG data URL (white edits, black preserves). Each file is limited to 10 MB;
the combined request limit is 28 MB. The mask must match the oriented source
dimensions and contain a selected area. Source and mask are saved with the job.
`strength` defaults to 0.85. CLI callers can use `img2img --mask mask.png`.

Run mask/preservation checks with the ComfyUI Python environment:
`python image-server/test_inpainting.py`.


## Comic generation and expression editing

Select **WAI v17 · comic style** to generate with WAI-Illustrious v17 and
the Absolute Regression style LoRA (default strength 0.75; set 0 to disable).
The preset adds the `ar art` trigger when the style is enabled. Default: 25
steps, CFG 7, Euler/normal, CLIP -2. WAI currently supports Generate only.

Select **Qwen Image Edit 2509 · fast edits**, upload a reference image, and
describe the change. This uses the installed 2509 FP8 checkpoint with the
4-step Lightning adapter, CFG 1, Euler/simple and shift 3. Editing only;
steps are fixed at 4. Both presets use the main ComfyUI server at COMFY_URL.
The model selector starts these presets at 1024 square; editing can preserve
the source aspect ratio. Clicking Edit this image on a WAI result selects
Qwen Edit automatically. Other existing models retain their modes.

API model IDs: `wai-v17` (mode `generate`, optional `styleStrength` 0–1.5)
and `qwen-edit-2509` (mode `edit`, source image required, steps 4).
Exact workflows are bundled under `image-server/workflows`; no files from
the separate RPG experiment project are needed at runtime.


## Civitai imports

Open **Import a model from Civitai**, paste a model page URL, optionally name
the configuration and choose its base checkpoint, then download. A
`modelVersionId` query selects an exact version; otherwise the first/latest
version is used. SDXL-family full checkpoints and standard LoRAs in
SafeTensors format are supported. Flux, SD1.5, SD3, diffusion-only files,
LyCORIS and other architectures are rejected with a workflow explanation.

LoRAs require an installed matching-family checkpoint: Illustrious defaults
to WAI v17; Pony and generic SDXL need matching imported checkpoints. This
is family compatibility, not a guarantee of the creator's exact recipe.
Saved configurations expose trigger words, base pairing and adjustable LoRA
strength. **Save these defaults** persists name, steps and strength.
Imported generation results switch to Qwen Edit when Edit is clicked.

Downloads run in the background with progress, a 12 GB limit, SHA256 checks
and SafeTensors/header checks before registration. Interrupted imports can
be retried. Already installed matching files are reused. Models are saved
under `IMAGE_MODELS_DIR` (default Documents/ComfyUI/models); configs and import
status live under image-runs/configurations and image-runs/imports.
No browser automation, login bypass, model scripts or arbitrary workflows
are executed. Private/paid models still require account access.
The optional Civitai API key is passed only to the worker environment, not
saved in jobs/configs or command-line arguments. CIVITAI_API_TOKEN is also
supported as a server environment variable.

API: GET /api/configurations, GET /api/imports, POST /api/imports with
{url,name?,base?,token?}; POST /api/configurations/<id> with
{name,steps,styleStrength}. Generation uses the saved config ID as model.
Each job snapshots its configuration to preserve reproducibility.

Civitai imports accept both `civitai.com` and `civitai.red` page links (including `www`). Red links are normalized to the existing Civitai API, preserving the model and version IDs.

If the model file download fails, the importer checks the Windows Downloads folder (including a redirected Downloads location) for a matching SafeTensors file. It verifies SHA256 and model format, copies it into the model directory, keeps the original, and registers the configuration. Renamed files are supported. Metadata must still resolve so the expected version and checksum are known. After a manual download, retry the failed import.

Character LoRAs: standard SDXL, Pony and Illustrious character adapters use the same Civitai importer. Select their configuration, expand Character / LoRA preset, and save editable triggers (one per line), a reusable character/outfit prompt prefix, negative prompt, and CFG. Steps and LoRA strength are saved with the preset. The main prompt describes the scene. One LoRA per configuration; multi-LoRA stacking and other architectures are not supported.

Imported SDXL-family configurations support Reimagine an image (img2img). Upload a source or choose Reimagine with this model on a result. Describe the desired image and set redraw strength: lower values preserve more structure; higher values redraw more. Source pixels are resized with nearest-exact and encoded using the checkpoint VAE. This is not instruction editing or masked inpainting.

Body pose reference: WAI v17 and imported SDXL-family models accept an optional PNG/JPEG/WebP pose reference up to 10 MB, plus pose strength (0�2, default 0.8). Use a clear single-person reference; match output proportions to the reference. Native SDPose extracts the body skeleton, and xinsir SDXL OpenPose guides generation. Hands and face detail are excluded. Works with character LoRAs and img2img; precise adherence varies. Results include a detected-pose PNG. Reference files are saved per job but not in browser preferences. Required weights: checkpoints/sdpose_wholebody_fp16.safetensors and controlnet/xinsir-openpose-sdxl.safetensors.
