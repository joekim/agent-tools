# Shared agent tools

Media Hub is the separate preview on port 3002. Discover `media-hub.transcript` for YouTube caption tasks and `media-hub.library` for shared galleries. Preserve the original Image Studio on 3001. Music is planned; image generation is disabled in the preview. Follow docs/project-agent-instructions.md: publish output paths with media-hub.publish, defaulting to mobile on the same LAN. Explicit external audience uses Dropbox /ai-workspace; media-hub.diagnostics reports authorization and sharing readiness.

Follow AGENTS.md in this repository. The `agent-tools` MCP server is the common Windows/macOS entry point: call `discover_tools`, then `call_tool` with the discovered node ID, tool name, and input. Report unavailable nodes rather than guessing endpoints. Never put credentials in chat or source files.
