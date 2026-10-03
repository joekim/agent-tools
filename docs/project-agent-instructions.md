<!-- agent-tools-hub -->
## Shared desktop and Media Hub tools

When asked to create a new project, discover and call `media-hub.create-project` on the intended machine with `{"name":"my-project"}`. It creates a directory under that node's projects root (default `~/projects`), initializes Git on `main`, and installs these instructions in both `AGENTS.md` and `CLAUDE.md`. Existing directories are refused. Check `status` and use the returned directory; no commit, remote repository or publication is created automatically.

Use the `agent-tools` MCP server before building a replacement tool or guessing an endpoint. Call `discover_tools` to find Windows/macOS nodes, availability, descriptions, and input schemas. Call `call_tool` with the exact owning `nodeId` and tool name. Paths and desktop actions belong to that machine; a Windows path cannot be opened by the Mac hub.

Assume the user will open deliverables on a phone on the same local network. For an output file or dedicated output folder, call `media-hub.publish` with `{"path":"ABSOLUTE_PATH_ON_OWNING_NODE"}`. The default audience is `lan`. Return the hub's ready URL: do not send localhost, raw IP, or filesystem paths as mobile links. The hub snapshots outputs and creates a mobile gallery; do not set up another file server or copy files manually. Only publish intended deliverables, never a whole repository, home folder, secrets, or unrelated inputs.

If the user needs access outside the network, call the same tool with `"audience":"external"`. Media Hub uploads to Dropbox `/ai-workspace` and returns a verified public share link. Do not make internet copies by default. Only report success when `status` is `ready` and a URL is returned. On a failed or ambiguous upload, inspect the reported destination before retrying; do not invent a link or equate a local Dropbox copy with confirmed cloud sharing.

Run `media-hub.diagnostics` for setup or sharing failures; optionally pass the same `path`. Report which checks passed and any specific blocker. A check from the host does not prove phone DNS/firewall access. Dropbox read access does not prove upload or public-link permission; use `probeExternal:true` to test those with a temporary synthetic file and clean it up. Report cleanup failures. Never fall back to internet sharing without an external-sharing request.

Use `media-hub.transcript` for YouTube captions on either machine, then publish its returned text-file path if the user needs a mobile link. Poll image/voice job IDs and inspect results before reporting generation success. macOS exposes no model use. Credentials stay in native OS storage on the owning hub: never put them in chat, source, or `.env` files.

If MCP is unavailable, read the agent-tools repository's README and use its CLI (`node src/cli.mjs list`, then `node src/cli.mjs call NODE TOOL JSON`). A new agent session may be needed after MCP installation. Do not guess another service address.
<!-- /agent-tools-hub -->
