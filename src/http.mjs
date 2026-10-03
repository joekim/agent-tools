export async function readJson(stream, limit = 30 * 1024 * 1024) {
  const chunks = []; let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export async function request(url, { token, method = 'GET', body, timeout = 10000 } = {}) {
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} from ${new URL(url).origin}`), { status: 502 });
  const buffer = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error('Response too large');
    buffer.push(chunk);
  }
  const bytes = Buffer.concat(buffer);
  if (response.headers.get('content-type')?.includes('application/json')) return JSON.parse(bytes.toString('utf8'));
  return { contentType: response.headers.get('content-type'), encoding: 'base64', data: bytes.toString('base64') };
}
