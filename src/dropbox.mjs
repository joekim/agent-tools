import { loadSecret } from './credentials.mjs';

// Only the owning hub reads credentials. Neither provider responses nor tokens
// are included in errors returned to agents.
export async function dropboxClient(config, { secret = loadSecret, fetcher = fetch } = {}) {
  const settings = config.dropbox;
  if (!settings) throw new Error('Dropbox is not connected to this hub; configure native Dropbox credentials.');
  let token;
  try {
    if (settings.refreshCredential && settings.appKey) {
      const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: secret(settings.refreshCredential), client_id: settings.appKey });
      if (settings.appSecretCredential) body.set('client_secret', secret(settings.appSecretCredential));
      const response = await fetcher('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      token = (await response.json()).access_token;
    } else if (settings.accessCredentialParts) {
      if (!Array.isArray(settings.accessCredentialParts) || !settings.accessCredentialParts.length || settings.accessCredentialParts.some(name => typeof name !== 'string' || !name)) throw new Error();
      token = settings.accessCredentialParts.map(name => secret(name)).join('');
    } else if (settings.credential) token = secret(settings.credential);
    if (!token) throw new Error();
  } catch { throw new Error('Dropbox authorization unavailable or expired; reconnect the hub using native credential storage.'); }
  return async (operation, args, bytes) => {
    let response;
    try {
      const headers = { authorization: `Bearer ${token}`, 'content-type': bytes ? 'application/octet-stream' : 'application/json' };
      if (bytes) headers['Dropbox-API-Arg'] = JSON.stringify(args).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      response = await fetcher(`https://${bytes ? 'content' : 'api'}.dropboxapi.com/2/${operation}`, { method: 'POST', headers, body: bytes || JSON.stringify(args), redirect: 'error', signal: AbortSignal.timeout(60000) });
    } catch { throw new Error('Dropbox request timed out or could not connect; completion may be ambiguous. Inspect the destination before retrying.'); }
    if (!response.ok) throw new Error(`Dropbox ${operation} failed (HTTP ${response.status}); check authorization, scopes and account policy.`);
    return response.json();
  };
}
