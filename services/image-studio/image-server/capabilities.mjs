export function mediaCapabilities(generationEnabled, modelUse = true) {
  return {
    name: 'Media Hub', service: 'media-hub', apiVersion: 1, modelUse,
    agentInterface: { transport: 'MCP via agent-tools', discovery: 'discover_tools', invocation: 'call_tool', instructions: '/agents' },
    capabilities: [
      { id: 'projects', status: 'check-agent-discovery', tools: ['media-hub.create-project'], description: 'Create a project under ~/projects with Git and shared agent instructions. Requires Git on the owning node.' },
      { id: 'library', status: 'available', tools: ['media-hub.site', 'media-hub.library', 'media-hub.download'], description: 'Browse copied galleries and share files over the local network.' },
      { id: 'youtube-transcripts', status: 'check-agent-discovery', tools: ['media-hub.transcript'], description: 'Download available captions as VTT and text through the authenticated agent gateway. Requires yt-dlp; discovery reports readiness.' },
      { id: 'images', status: generationEnabled ? 'enabled-backend-required' : 'disabled-in-preview', description: generationEnabled ? 'Generation is enabled for configured models. Read /api/site allowedModels and configurations; backend readiness still requires a successful job.' : 'Image generation is disabled on this node.' },
      { id: 'voice', status: 'external-adapter', tools: ['voice.generate', 'voice.job', 'voice.download'], description: 'Existing voice service is discoverable separately; not migrated into this preview. Check online status.' },
      { id: 'music', status: 'planned', description: 'Music generation integration is not implemented yet.' },
      { id: 'publishing', status: 'check-agent-discovery', tools: ['media-hub.publish', 'media-hub.diagnostics'], description: 'Publish an output path as a mobile LAN gallery.' },
      { id: 'dropbox', status: 'authorization-required', tools: ['media-hub.publish', 'media-hub.diagnostics'], description: 'Explicit external sharing uploads to Dropbox /ai-workspace. Run diagnostics for this hub’s current authorization status.' }
    ].filter(c => modelUse || !['images','voice','music'].includes(c.id))
  };
}
