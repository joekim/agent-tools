# Agent Tools Hub

## Desktop activity window

Run `npm ci` and `npm run status:install` once, then `npm run status` opens the Electron tray app with an optional always-on-top window. It polls the authenticated hub `/v1/activity` endpoint every three seconds for image and voice jobs, including website and agent submissions. Close hides to tray; the tray menu can reopen or quit it. Pin preference persists. `scripts/install-status-startup.ps1` installs and launches the Windows login entry. Requires this checkout and development dependencies. The Mac UI is portable but not installed/tested there; a files-only Mac hub has no generation activity.

The hub returns only job IDs, states, queue counts, and timing, never prompts, voice text, logs, or credentials. Voice history comes from the configured isolated runtime's persisted job list, gated by a live health check; image history comes from the image service. Offline means status is unavailable, not idle. Elapsed time includes queue time for image jobs. No percentage is shown because the workers do not provide reliable progress counts. Completed images open in the browser; completed voice jobs open their local output folder containing the audio archive. Credentials are resolved from native storage only in the desktop main process. No new listener or public port is used.

## Media Hub voice runtime

Claude can generate voice automatically for the current task. Run `node scripts/install-voice-permissions.mjs` to install user-level Claude Code allow rules for discovery and the dedicated `voice_generate`, `voice_job`, and `voice_download` MCP tools, plus the shared instructions. Restart Claude after installing the new tools. The rules do not approve the general-purpose `call_tool` dispatcher. Existing ask/deny and managed policies still take precedence. See [Claude permission rules](https://code.claude.com/docs/en/permissions).

On another computer, update this repository and run the installer there too. If the direct Windows MCP connection has a different name, pass it, for example `node scripts/install-voice-permissions.mjs agent-tools-windows`. That connection must already use the Windows hub; this does not enable model execution or forwarding on a Mac hub. Discover voice availability, submit `{ "nodeId": "meesa", "lines": ["Hello."] }` to `voice_generate`, then poll `voice_job` and retrieve completed audio using `voice_download` with `{ "nodeId": "meesa", "id": "RETURNED_JOB_ID" }`.

Windows voice now has independent service code under `services/voice`, model/package copies under `~/.agent-tools/voice`, and job/audio data under `~/.agent-tools/voice/data`. It uses loopback port 8792 and the native `services/voice` credential, so a changed LAN IP cannot break the hub-to-voice connection. The existing Chorequest source and port 8791 remain untouched. The existing Python interpreter is reused read-only, with copied package overlays; it must remain installed.

`node scripts/voice-service.mjs` starts the server. `scripts/voice-watchdog.mjs` checks health every 10 seconds, restarts an exited process, and restarts its own unresponsive server after three failed checks. It does not automatically resubmit interrupted audio jobs. Logs are in `~/.agent-tools/voice/stdout.log` and `stderr.log`. The Windows installer `scripts/install-voice-startup.ps1` installs a hidden login launcher. It was installed on the Windows node on October 3, 2026; service recovery after process termination was verified twice, and all three voice tools reported online afterward. Other machines must run the installer separately. It needs a signed-in user and an awake PC and cannot guarantee availability during sleep, shutdown, GPU failure, or missing dependencies. A full reboot/sign-in test has not yet been performed.

## Isolated WAI generation

Claude Code can automatically use the enabled image models. Run `node scripts/install-image-permissions.mjs` and restart Claude to load the dedicated `image_configurations`, `image_generate`, `image_jobs`, `image_job`, and `image_download` tools and their user-level permissions. The installer preserves voice permissions and other settings and does not approve the general dispatcher. Generation takes `{ "nodeId": "meesa", "input": { "model": "wai-v17", "prompt": "A mountain landscape" } }`; status/download take `{ "nodeId": "meesa", "id": "RETURNED_JOB_ID" }`. Configuration and job-list tools take only `nodeId`. On another computer, update the code and run the installer with its direct Windows MCP server name, for example `node scripts/install-image-permissions.mjs agent-tools-windows`. Existing ask/deny and managed policies still apply; macOS model restrictions remain unchanged.

Windows Media Hub now enables WAI v17 with Absolute Regression, using independent checkpoint/LoRA/ControlNet copies in `~/projects/ltx-alpha-gen/ComfyUI/models` and backend port 8195. The original studio on 3001 and backend on 8189 are unchanged. Other model families and downloads remain disabled in this preview. This scoped enablement supersedes older statements below that all preview generation is disabled.

On the home page choose WAI v17 or Absolute Regression - WAI v17, enter a prompt, and optionally upload a pose. Select **Reference photo** to detect a pose or **Extracted pose map** to use a skeleton map directly. Pose maps use the SDXL Xinsir OpenPose ControlNet, not LTX Union Control. Depth and edge maps are not supported by this image-generation workflow. Agents discover `media-hub.generate`, submit `model: "wai-v17"` with a prompt and optional `poseImage` data URL, `poseInputType: "map"`, and `poseStrength`, then poll `media-hub.job`. Generation stays unavailable on macOS.


## Extract control maps from images or videos (Windows)

Open `/controls` in Media Hub, or choose **Extract controls** in its navigation. The browser workflow is **Upload → choose Depth / Edges / Pose → Extract → view/download**. These are alternative control types, not sequential processing steps. The form accepts PNG/JPEG/WebP or MP4/MOV/WebM up to 20 MB, processes at 512 pixels, and limits videos to their first 145 frames. Results have a reopenable `/controls#JOB_ID` link. Like the existing LAN galleries, uploaded results are readable by anyone with the link on the local network. The form cannot submit arbitrary host paths or access agent-created jobs, and refuses cross-origin uploads and files-only nodes. It does not enable LTX generation.

Discover `media-hub.extract-control` and submit `{"path":"ABSOLUTE_IMAGE_OR_VIDEO_PATH","mode":"depth"}` on the owning Windows node. Modes are `depth`, `canny` (edges), and `pose` (human skeletons). Optional `resolution` is 256, 512 (default), or 768; `maxFrames` is 1–145 (default 145, videos are truncated to this many initial frames). Images return a PNG map; videos return PNG frames and an MP4 preview. Pose requires a visible person for useful output. This extracts controls; it does not run LTX video generation or infer animation from a still.

The call returns `id`; poll `media-hub.control-job` with `{"id":"RETURNED_ID"}`. Only `status: ready` confirms completion. Submit the ready `directory` to `media-hub.publish` for a mobile LAN gallery. Unknown status or an ambiguous submission requires inspecting persisted job logs/ComfyUI history before resubmitting. Jobs and worker output persist under `artifacts/control-jobs` across hub restarts.

The local, non-secret `controlExtraction` config specifies absolute `python` and `script` paths plus the isolated ComfyUI `baseUrl`. This installation uses `~/projects/ltx-alpha-gen/.venv`, `extract-control.py`, and loopback port 8195. Run that project's `start.ps1` when the backend is stopped; discovery health-checks its required nodes and reports it offline when unavailable. Media Hub exposes the tools through its existing authenticated port 3002, without another public port. No backend autostart is installed. Both tools are classified as model operations and hidden/blocked on macOS and files-only hubs.

## Create a project

Discover `media-hub.create-project`, then call it on the desired Windows or Mac node with `{"name":"my-project"}`. It creates `~/projects/my-project` (or the node's configured `projectsRoot`), runs `git init` with branch `main`, and writes the current shared instructions into both `AGENTS.md` and `CLAUDE.md`. It returns the absolute directory and `status: "ready"`. Git must be available in the service PATH; discovery checks this dependency. No initial commit, remote repository, or public share is created.

Names accept 1–80 letters, numbers, hyphens and underscores, starting with a letter or number. Paths, traversal and Windows reserved names are rejected. An existing directory is never reused or overwritten. If initialization fails after creating the directory, the response reports `status: "failed"` and preserves the partial directory for inspection.

## Publish a path for mobile or external sharing

Copy [the reusable instruction block](docs/project-agent-instructions.md) into any project's `CLAUDE.md` or `AGENTS.md`, or run `node scripts/install-project-instructions.mjs ABSOLUTE_PROJECT_DIRECTORY` to update both. The installer preserves surrounding instructions and makes backups. `node scripts/install-agents.mjs` updates global Claude/Codex instructions so new projects inherit the policy; projects still need access to the MCP bridge.

Discover tools, then call on the machine that owns the path:

```json
{"nodeId":"NODE_FROM_DISCOVERY","name":"media-hub.publish","input":{"path":"ABSOLUTE_OUTPUT_PATH"}}
```

The default is `audience: "lan"`: a snapshot and mobile gallery at the configured hostname on the existing hub port. A phone must be on the same network and the host awake. No additional server or port is started. The source stays unchanged. Publish a file or dedicated output folder, not a repository/home directory. Hidden files, symlinks, common credential filenames and key files are rejected; this is not a comprehensive content-secret scanner. Limits: 100 MiB total, 500 files, 20 directory levels. Images/audio/video preview in the gallery; other formats have download links. HTML/SVG are downloads, not executable hosted sites. Published snapshots persist under `artifacts/publications`; remove a publication's UUID directory to withdraw its LAN link.

For a requested internet share add `"audience":"external"`. The hub uploads to a unique `/ai-workspace/UUID` folder through Dropbox's API and checks the link's resolved public visibility. It does not depend on desktop sync timing. Only `status: "ready"` confirms a share URL. Failure can leave uploads in the reported `remotePath`; inspect that location before retrying. Do not retry a timed-out external publication blindly. External snapshots are not exposed through the LAN route. Removing a local snapshot does not delete Dropbox uploads or revoke Dropbox links.

`media-hub.diagnostics` checks the LAN hostname, actual sharing endpoint, writable storage, optional `path`, and Dropbox read access. `{"probeExternal":true}` additionally uploads a tiny synthetic file, creates a public link, then revokes the link and deletes the file. Cleanup failures are reported with the exact remote path. Even a passing local diagnostic cannot confirm phone DNS, firewall, Wi-Fi isolation, or access while the host sleeps.

### Dropbox authorization for the background hub

Dropbox must be authorized separately on each node. A ChatGPT Dropbox connection does not automatically authorize this background service. Store access/refresh credentials in the existing native credential store. The hub supports either `dropbox.credential` for a short-lived access token, or the following non-secret configuration for refreshable authorization:

```json
{"dropbox":{"appKey":"YOUR_DROPBOX_APP_KEY","refreshCredential":"services/dropbox/refresh","appSecretCredential":"services/dropbox/app-secret"}}
```

For PKCE public-client authorization, omit `appSecretCredential`. Use Dropbox OAuth with offline access and a Full Dropbox app to target the actual account-level `/ai-workspace` folder; App Folder access targets the app's sandbox instead and is unsuitable for that requirement. Create `/ai-workspace` in that account before publishing. Required scopes are `files.metadata.read`, `files.content.write`, `sharing.read`, and `sharing.write`. Use the documented native `secret-import`/`secret-set` commands; never paste credentials into chat or config. OAuth consent/bootstrap is not automated by this repository. Restart after changing config, then run the diagnostic probe. Until authorization is configured, external publishing reports a blocker instead of a fabricated link.

Provider references: [Dropbox shared-link API](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/sharing/create-shared-link-with-settings) and [upload API](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload).

## Windows and Mac roles

Both machines run Media Hub on **3002** with independent data and native credentials. Fresh `npm run setup` installations enable the website and authenticated task API on one listener.

- **Windows:** the `full` profile can expose configured model services. Image generation in this isolated preview remains disabled until the full migration.
- **macOS:** the `files-only` profile is automatic, even if a Windows configuration is copied over. Files, galleries, saved media, screenshots and YouTube caption downloads remain available. Image/voice/music model operations and model configuration/import APIs are unavailable.

The Mac profile filters local and peer model tools and refuses calls to them; it does not proxy model execution to Windows. Agents needing Windows model tools must connect to the Windows hub directly. Unknown custom service operations are also excluded unless their trusted manifest explicitly declares `modelUse: false`. Do not label a model operation as a utility.

To install on the Mac, copy the repository without Windows `node_modules`, then run `npm ci`, `npm run setup`, `node scripts/install-agents.mjs`, and `node scripts/install-service.mjs`. Install yt-dlp separately for caption downloads. This session has not installed or tested the actual Mac laptop; remote setup remains deferred.

## Media Hub: media and tasks for AI agents

The preview is now named **Media Hub**: [website](http://meesa.local:3002/), [library](http://meesa.local:3002/assets/), and [AI access instructions](http://meesa.local:3002/agents). It remains independent from the original Image Studio on port 3001.

Agents use the existing `agent-tools` MCP connection to discover and execute tasks. For example:

```json
{"query":"YouTube"}
```

Pass that to `discover_tools`, then call `call_tool` with the returned node ID:

```json
{"nodeId":"meesa","name":"media-hub.transcript","input":{"url":"https://www.youtube.com/watch?v=VIDEO_ID","language":"en"}}
```

The transcript task returns text plus paths to saved VTT/text files on the owning machine. It downloads available captions; it does not generate a transcript when captions are missing. `media-hub.site`, `media-hub.library`, and `media-hub.capabilities` expose links, galleries, and feature status. Discovery reports runtime availability. Existing `youtube.transcript` and `image-studio.*` calls remain compatibility aliases for this preview.

Any local MCP-compatible agent can launch `node /absolute/path/to/agent-tools/src/mcp.mjs` over stdio. The Media Hub website, file serving, and task API share **port 3002**. Non-MCP integrations use authenticated `GET /v1/catalog` and `POST /v1/call` on that same origin, with the invocation JSON and a bearer credential resolved from native storage. Gallery browsing does not grant task access. Remote peer federation still requires explicit hub pairing; task access requires the bearer credential. Do not expose this listener publicly or put credentials into prompts.

The local configuration uses `port: 3002`, `host: "::"`, and `imageStudio.sharedPort: true`. Port 4777 is no longer used by this installation. Existing MCP sessions created before this change may need a restart; the updated bridge rereads the connection configuration on each call. Fresh setups also use 3002; old installations retain their saved configuration until changed explicitly.

Voice remains an external adapter; music is planned. Dropbox publishing is implemented but requires native authorization on each hub. Image generation stays disabled in this preview pending the full migration. Legacy implementation directories (`services/image-studio`, `~/.agent-tools/image-studio`) and the `imageStudio` configuration key are retained to avoid another data migration; the product and discovered service are Media Hub. `npm run start:media` starts or finds the preview.

One discovery and invocation interface for tools owned by Windows and macOS machines. Each machine runs its own Node.js hub. Claude Code and Codex/Astra connect through the same stdio MCP server. Image Studio has an independent preview copy; the original services and data remain separate.

## Current inventory

| Capability | Existing implementation | Hub integration |
| --- | --- | --- |
| Windows hotkeys | `~/projects/agent-tools/hotkeys` | `desktop.hotkeys` reads existing bindings; installation/editing stays with the existing scripts |
| Windows screenshots | `~/projects/agent-tools/screenshot` | `desktop.screenshot` invokes the existing capture script |
| macOS screenshots | `/usr/sbin/screencapture` | Native adapter; needs Screen Recording permission; not yet verified on the laptop |
| YouTube transcripts | `yt-dlp` | Downloads available captions as VTT and text; does not invent or transcribe missing captions |
| Image Studio preview | `services/image-studio`, port 3002 | Independent copy of galleries/jobs, stable hostname links; original remains on port 3001 |
| Voice generation | `~/projects/chorequest/tools/voice-update-service.mjs`, port 8791 | Submit spoken lines, poll jobs, download audio ZIP |
| Dad Console / pokemon-multiplayer | Not found on this Windows machine | Registration helper and sidecar ready; actual API integration awaits source/access |
| Blender, Godot, local-coder | Existing separate MCP servers in the Windows Codex configuration | Existing connections preserved; not proxied by this HTTP hub |
| Mac hotkeys and other laptop tools | Not inventoried yet | Requires laptop access; Windows key bindings are not assumed to work on macOS |

The hub currently runs on Windows. Cross-machine discovery is tested with two loopback hubs; the real Mac has not been paired or tested.

## Image Studio preview: separate from the original

Open the preview at **http://meesa.local:3002/** or its gallery at **http://meesa.local:3002/assets/**. The original stays on **port 3001**, using its own source and data in `~/projects/yue2-music`. No directory junctions connect the original to the preview. Later changes in either copy do not sync automatically.

Preview source is in `services/image-studio`; its independent data is in `~/.agent-tools/image-studio/{jobs,assets,screenshots}`. The hub starts the preview at login when `imageStudio.enabled` is true. `imageStudio.publicUrl` controls hostname-based share links; `host: "::"` supports IPv4 and IPv6. Every gallery page includes **Copy share link**, and agents can use `image-studio.site` / `image-studio.library` to obtain stable links. Internal asset links remain relative.

Generation and model downloads are disabled in the preview (`generationEnabled: false`) so it does not use the original GPU backend or modify shared model files. Existing copied images, files and galleries remain available. Keep using the original for generation until the full migration is planned.

`node scripts/copy-image-studio.mjs /path/to/yue2-music` prepares a verified independent copy without changing the source or its launchers. It refuses to overwrite differing destination files. The original launchers and independent source directories were restored after the initial cutover was reversed. Original snapshots remain in dated `.pre-agent-tools-*` backups; the preview's `separation.json` records that reversal.

The host computer must be awake and reachable on your local network. Existing URLs containing an old numeric IP cannot redirect themselves once that IP is no longer assigned to this PC; replace those bookmarks with the hostname-based link above.

## Install on either machine

Requires Node 22+ and npm. Copy/clone this repository without `node_modules`, then:

```sh
npm ci
npm run setup
node scripts/install-agents.mjs
node scripts/install-service.mjs
```

Setup writes `~/.agent-tools/config.json` and generates a hub credential in the native OS credential store. It does not require an OpenAI or Anthropic API key. Install `yt-dlp` separately, for example `uv tool install yt-dlp`; set `ytdlpCommand` to its absolute path for reliable background-service access.

The service installer starts the hub at user login: a hidden Windows startup launcher or a macOS LaunchAgent. It runs under the logged-in account so it can access that account's credentials and desktop. The Mac LaunchAgent has restart-on-failure behavior; the Windows runner restarts a crashed hub. This is not a pre-login system service. Re-run the agent installer if relocating the checkout, after removing/updating the existing MCP entry. New agent sessions may be required to load MCP changes.

To run in the foreground instead, use `npm start`. To inspect availability:

```sh
node src/cli.mjs list
node src/cli.mjs call YOUR_NODE image-studio.configurations '{}'
node src/cli.mjs call YOUR_NODE youtube.transcript '{"url":"https://www.youtube.com/watch?v=VIDEO_ID","language":"en"}'
```

Use the real node ID returned by `list`. PowerShell and POSIX shell quoting can differ for JSON; MCP avoids that issue. Generated transcript files belong to the owning node; the result also contains text. Image/audio download operations return base64 plus content type. Windows screenshots are saved in that user's Pictures/Screenshots folder; the path is not a shared network path.

## Agents

`discover_tools({query?, onlineOnly?})` returns nodes, availability, descriptions and JSON input schemas. `call_tool({nodeId, name, input})` invokes the exact discovered operation. Tool discovery is read-only; invocation may capture a desktop or submit GPU work. The hub does not automatically generate media during installation or health checks.

Agents should discover before calling, identify the correct machine, and poll image/voice job IDs to completion. Health checks establish frontend reachability, not that every image model is installed or a generation will succeed. Existing service errors remain authoritative. Never retry a timed-out generation blindly; check existing jobs first.

The installer preserves existing Codex/Claude entries and updates its marked instruction block in `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`, making timestamped backups before changes. It configures clients, not the model itself. Other Claude/Astra runtimes must also be connected to the MCP bridge.

## Native credentials

Windows Credential Manager and macOS Keychain are accessed through `@napi-rs/keyring`. Configuration stores a name, for example:

```json
{"credential":"services/voice"}
```

The owning hub resolves that name internally. No MCP tool returns credentials, and peer snapshots never include token files or credential names. Native storage protects secrets at rest; it is not a sandbox against arbitrary code running as the same OS user. Windows/macOS stores do not automatically synchronize with each other. macOS may require an unlock/access prompt.

Import a known existing token without putting its value in command arguments or chat:

```sh
node src/cli.mjs secret-import services/voice /absolute/path/to/existing/token
node src/cli.mjs secret-check services/voice
```

`secret-import` preserves the source file because the existing service may still need it. `secret-set NAME` accepts a value on stdin from a secure prompt or process; there is deliberately no `secret-get` command. `setup` migrates the hub's own legacy token and deletes only that hub-owned plaintext file after successful native-store verification.

For programs that expect environment variables, create a non-secret mapping file:

```json
{"PROVIDER_API_KEY":"providers/example"}
```

Then run `node scripts/with-secrets.mjs mapping.json node app.mjs`. The launcher fetches secrets into the child process environment at runtime, without a plaintext `.env`. The child can still expose its environment, so keep its logging disciplined. Existing project `.env` files have not been bulk-migrated.

## Pair Windows and Mac

Pairing is explicit trust, not open LAN enrollment. Each machine needs a unique `nodeId`, the other's reachable URL, and a copy of the other's hub credential stored locally. Exchange credentials through an authenticated private channel or native credential UI; do not paste them in agent chat. Public URLs and node IDs are not secrets.

1. Install and run the hub on both machines. Verify each with `list`.
2. Set `host` to `0.0.0.0` (IPv4 listen) and `publicUrl` to each machine's actual LAN/VPN URL, such as `http://WINDOWS_HOST:4777`. `publicUrl` documents the advertised address; peer connections use the explicit `peers[].url`.
3. On Windows, store the Mac token under `peers/mac-laptop`; on Mac, store the Windows token under `peers/windows-desktop`.
4. Add reciprocal entries to each machine's local config, using the actual node IDs:

```json
{
  "peers": [
    {"id":"mac-laptop","url":"http://MAC_HOST:4777","credential":"peers/mac-laptop"}
  ]
}
```

5. Restart both hubs and permit port 4777 only on the intended private network. For traffic outside a trusted LAN, use an encrypted VPN or HTTPS reverse proxy; a bearer token does not encrypt HTTP traffic.

Only allowlisted peers exchange heartbeats. The owner exports only its local tools, preventing cycles or stale records being re-broadcast as fresh. Remote calls are routed to the owning hub once, which can access its own loopback services without exposing their ports. Peer health expires 45 seconds after the last successful snapshot. Failed peers remain visible as offline and recover automatically when reachable again. Registrations are intentionally in-memory: services renew after hub restart, and configured adapters are rebuilt from config.

## Register another server

Two approaches:

- **Existing service:** add a local manifest to `services` in config. The hub health-checks it continuously. Credentials are configured here with `credential`, never sent in a registration request.
- **Self-registering service:** approve its exact origin in `allowedServiceOrigins`, then renew a manifest through `registerService` after the service starts listening. A separate sidecar can renew for an unmodified server.

See `examples/service.json` for the manifest shape. Its port/routes are illustrative: replace them with the actual Dad Console API after inspecting its source. Each operation needs an input schema and a fixed GET/POST path; `{id}` substitutions accept simple identifiers, never arbitrary paths. Dynamic registration cannot supply credentials or override a configured service. Credentialed services should use local config adapters.

```js
import { registerService } from '/absolute/path/agent-tools/src/registration.mjs';
import { readConfig } from '/absolute/path/agent-tools/src/config.mjs';
const config = readConfig();
const stopRegistration = await registerService({
  hubUrl: `http://127.0.0.1:${config.port}`,
  token: config.token,
  manifest: yourActualServiceManifest
});
// Call stopRegistration when the service shuts down.
```

Or run `node src/cli.mjs register /absolute/path/service.json` alongside the service. Registrations renew every 15 seconds and expire after 45 seconds without renewal. A live sidecar alone does not mark a dead backend online: the hub also probes the health endpoint.

## Configuration and maintenance

`AGENT_TOOLS_HOME` and `AGENT_TOOLS_CONFIG` override paths for foreground/custom launches. The provided login installers use the default paths and do not persist those overrides. `AGENT_TOOLS_URL` changes the bridge/CLI target; it still uses the configured local credential.

Built-in project detection uses `projectsRoot` and `legacyToolsRoot`. Explicit `services` override detected entries by ID. Windows voice currently listens on its specific LAN IP rather than loopback; the local override must follow that address if it changes. After editing config, restart the hub. Logs from the initial Windows background launch and the Mac service go to `~/.agent-tools/stdout.log` and `stderr.log`.

To uninstall startup on Windows, remove only `AgentToolsHub.vbs` from the user's Startup folder and stop the corresponding runner/hub processes. On macOS, run `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.agent-tools.hub.plist`, then remove that plist. Remove only the `agent-tools` MCP entries and the marked instruction blocks to undo agent integration. Native credentials remain until removed using the OS credential UI.

## Verification

`npm test` covers authenticated access, origin restrictions, approved registrations, expiry, schema validation, credential redaction, peer routing, offline behavior, transcript parsing and a real MCP stdio handshake. Native Windows credentials and live service reads are checked during installation. macOS behavior and real cross-machine pairing still require a Mac test.

Protocol references: [MCP server development](https://modelcontextprotocol.io/docs/develop/build-server), [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [native keyring binding](https://github.com/Brooooooklyn/keyring-node), [yt-dlp subtitle options](https://github.com/yt-dlp/yt-dlp#subtitle-options).

## GLB animation previews

LAN publication galleries now display GLB files interactively using a locally served model-viewer bundle. Choose an embedded animation, play/pause, scrub the timeline, change speed, or return to Rest pose. Drag to orbit and pinch/scroll to zoom. Existing publication links gain these controls without republishing. Models without clips remain orbitable; downloads remain available. GLTF files with external resources and FBX/Blend files remain downloads. Viewer assets are served from an exact allowlist; published HTML/scripts remain sandboxed downloads.

