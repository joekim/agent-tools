# Generate and download island audio

This guide is also available from authenticated `GET /instructions` on the running service.

The Windows GPU service accepts the text to speak and returns downloadable Qwen3 Aiden
recordings. **It does not pull, commit, push, inspect Git state, refresh source catalogs,
or write to either app's assets.** A dirty checkout or Git conflict does not block it.

Git is used only to synchronize this service's code and documentation between developers.
Audio delivery is through the authenticated HTTP downloads below.

## Claude's workflow

1. Refresh the app's UI catalog and voice manifest locally, then select lines whose `.ogg`
   files are missing from your own `apps/island/assets/voices/qwen3/` folder. Check actual
   files rather than relying on another machine's `made` flags.
2. Submit those lines to `POST /audio-jobs`. Do not send an empty request or ask the service
   to pull your branch; the JSON payload supplies all text needed for generation.
3. Poll the returned job ID until `completed`; if it becomes `failed`, read `error` and `log`.
4. Download `archiveUrl` with the same bearer token and extract its `.ogg` files into your
   local asset folder. Alternatively download `files[].url` and verify each listed SHA-256.
5. Let Godot import the audio and build the app. Handle any asset commits on your side.

The existing bearer token still works after this change. If you already called the old
service, keep that credential and use the new payload. The token is never stored in this
repository; if you do not have it yet, get it from the user or the Windows token file below.

## Start the service

```powershell
$env:VOICE_SERVICE_HOST = '192.168.1.47'
$env:VOICE_SERVICE_ALLOW_CIDR = '192.168.1.0/24'
npm run voice:service
```

Without those settings it binds only to localhost. The port defaults to 8791; override
with `VOICE_SERVICE_PORT`. The service checks the actual TCP peer's subnet and requires
a bearer token for every endpoint, including downloads. Use it on the trusted home network.
The machine must be awake and the process running; Windows must allow Node on the Private
network. There is no need for the requester to push or synchronize its code first.

The service reads the Python/model/GPU settings from `apps/server/.env`, as described in
[ISLAND-VOICE.md](ISLAND-VOICE.md). All generated audio, archives, job status and the token
live **outside the repository**, by default at:

```text
%LOCALAPPDATA%\Chorequest\voice-service\
  token
  jobs.json
  audio\<hashed filename>.ogg
  jobs\<job-id>\audio.zip
  jobs\<job-id>\manifest.json
```

`VOICE_SERVICE_DATA_DIR` overrides that folder. On first migration the existing token in
`.cache/voice-service/token` is copied over, so requesters can keep their current credential.
Keep the token out of Git and logs. The old Git-based jobs are not carried into the new store.

## Request audio

Set `VOICE_UPDATE_URL=http://192.168.1.47:8791` and `VOICE_UPDATE_TOKEN` to the secret token.
Send a JSON list of exact spoken strings:

```sh
curl --fail-with-body -X POST "$VOICE_UPDATE_URL/audio-jobs" \
  -H "Authorization: Bearer $VOICE_UPDATE_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: starter-dialogue-v2' \
  -d '{"lines":["Choose a new partner","Welcome to the team"]}'
```

`POST /voice-updates` remains an alias, but now requires the same text payload. An empty
request is rejected instead of starting a Git workflow. There are 1–1000 lines per request,
each 1–300 characters, and a 1 MB body limit. Leading/trailing whitespace is trimmed and
duplicate lines are collapsed. Each line can also be an object with `text` and optionally
`file`; supplied filenames must match the canonical voice/text hash. Optional `voice` must
be `Qwen3-CustomVoice-Aiden-v1`. Caller-selected paths, model settings and commands are not accepted.

To send an existing voice manifest, extract only its lines (do not send its `folder`):

```sh
jq '{lines: .lines}' docs/island-voice-lines.json > voice-request.json
curl --fail-with-body -X POST "$VOICE_UPDATE_URL/audio-jobs" \
  -H "Authorization: Bearer $VOICE_UPDATE_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @voice-request.json
```

## Poll and download

HTTP 202 returns the job `id`. Poll until `status` is `completed` or `failed`:

```sh
curl --fail-with-body "$VOICE_UPDATE_URL/jobs/JOB_ID" \
  -H "Authorization: Bearer $VOICE_UPDATE_TOKEN"
```

A completed job includes `archiveUrl`, `manifestUrl`, and `files`, each with its text,
canonical filename, byte count, SHA-256 and relative download `url`. Prefix those URLs
with `VOICE_UPDATE_URL`. Download the ZIP with the same authorization header:

```sh
curl --fail-with-body "$VOICE_UPDATE_URL/jobs/JOB_ID/audio.zip" \
  -H "Authorization: Bearer $VOICE_UPDATE_TOKEN" -o island-audio.zip
```

The ZIP contains the requested `.ogg` files and a portable `manifest.json` mapping filenames
to text. Extract the `.ogg` files into the requester's `apps/island/assets/voices/qwen3/`.
Let Godot import them before building. Commit or distribute them using the requester's normal
workflow; the generation service does not manage that step. Individual Ogg downloads use
`/jobs/JOB_ID/files/FILENAME.ogg`. Downloading an unrelated file or a not-yet-validated job is refused.

Existing service-cache audio is reused. Every requested recording is decoded and checked
for non-silent mono Ogg Vorbis before downloads become available. `generated` and `cached`
report counts; there is no commit ID in the response.

## Queue and retries

One job runs at a time. HTTP 409 with `jobId` means to poll the active job, then retry.
The same `Idempotency-Key` with the same lines returns the previous job; reusing it with
different lines is rejected. After a failed job, use a new key for a deliberate retry.
Failures retain generated files for reuse. Restarted jobs become failed, not silently replayed.

The latest 100 job statuses are retained across restarts. Audio/cache files remain on disk;
expired job IDs are no longer served. `GET /health` returns `apiVersion: 2`,
`mode: "audio-downloads"` and the active job. Stop the service only while idle.
