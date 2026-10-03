# Shared agent tools

This repository owns the cross-platform tool hub. Use Node 22+ and run `npm test` after protocol changes.

Media Hub is the independent preview on port 3002; original Image Studio remains on 3001. Use `media-hub.transcript` for YouTube captions and `media-hub.site`, `media-hub.library`, `media-hub.capabilities` for media discovery. Preserve separate data and ports. Voice is an external adapter; music is planned. Follow docs/project-agent-instructions.md for sharing: default mobile on the same LAN, media-hub.publish with an absolute output path; explicit external audience uses Dropbox /ai-workspace. Run media-hub.diagnostics to check readiness. Dropbox requires native hub authorization.

macOS uses the files-only profile: no model tools, model APIs, or forwarding model calls to peers. Keep files, galleries, saved media and non-model utilities available. Windows can expose model adapters, but the user has authorized isolated WAI v17 + Absolute Regression generation on backend 8195. Keep other model families disabled; never route this preview to the original backend 8189.

Before recreating a desktop/media tool or guessing a service URL, use the `agent-tools` MCP server's `discover_tools`. It returns node IDs, current availability, descriptions, and input schemas. Use `call_tool` with the exact node ID and name. Desktop operations affect that owning machine.

Do not assume a configured service is running, or that an available Image Studio frontend means every GPU model is ready. Generation returns a job ID; poll the job operation and inspect its result. An ambiguous submission timeout does not authorize duplicate generation.

Keep credentials out of source, tool schemas, discovery snapshots, logs and chat. Only the owning hub resolves credentials. Register external services using `src/registration.mjs` or the CLI sidecar after approving their origin in the local configuration. Registration expires unless renewed.

Read README.md for setup, peer pairing, and the inventory. Preserve existing tools and service data while integrating them.
