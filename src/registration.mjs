import { request } from './http.mjs';

// Use after the service starts listening. A sidecar can use the same helper.
export async function registerService({ hubUrl, token, manifest, onError = console.error }) {
  let stopped = false, timer;
  async function renew() {
    if (stopped) return;
    let delay = 5000;
    try {
      const result = await request(new URL('/v1/services/register', hubUrl), { token, method: 'POST', body: manifest, timeout: 5000 });
      delay = result.renewWithinMs;
    } catch (error) { onError(new Error(`Agent-tools registration failed: ${error.message}`)); }
    if (!stopped) { timer = setTimeout(renew, delay); timer.unref(); }
  }
  await renew();
  return () => { stopped = true; clearTimeout(timer); };
}
