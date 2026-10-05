export async function fileDataURL(blob) {
  if (blob.size > 5 * 1024 * 1024) throw new Error('Pose result exceeds the 5 MB chat limit. Download it from Extract controls.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
async function api(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Pose request failed.');
  return result;
}
export async function submitPose(data, fetchImpl = fetch) {
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(data);
  if (!match) throw new Error('Choose a PNG, JPG or WebP pose photo.');
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const result = await api(`/api/controls?mode=pose&ext=${match[1]}`, { method: 'POST', headers: {'Content-Type':'application/octet-stream'}, body: bytes }, fetchImpl);
  if (!/^[a-f0-9-]{36}$/.test(result.id)) throw new Error('Pose submission returned an uncertain result. Check existing jobs before retrying.');
  return result.id;
}
export async function pollPose(id, { fetchImpl = fetch, wait = () => new Promise(resolve => setTimeout(resolve, 2000)), onStatus = () => {} } = {}) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid pose job ID.');
  for (;;) {
    const job = await api(`/api/controls/${id}`, undefined, fetchImpl);
    if (job.status === 'ready') {
      const file = job.files?.find(file => file.name?.endsWith('.png') && file.url === `/api/controls/${id}/${file.name}` && /^[a-zA-Z0-9_.-]+$/.test(file.name));
      if (!file) throw new Error('The pose job has no PNG result. Open Extract controls to inspect it.');
      const response = await fetchImpl(file.url);
      if (!response.ok) throw new Error('Could not load the existing pose result. Resume this job; do not submit it again.');
      const blob = await response.blob();
      if (blob.type !== 'image/png') throw new Error('Expected a PNG pose map.');
      return { data: await fileDataURL(blob), name: file.name, role: 'pose_map', url: file.url, jobId: id, warning: job.warning };
    }
    if (['failed','unknown'].includes(job.status)) throw new Error(job.error || `Pose job is ${job.status}. Inspect the existing result before retrying.`);
    if (!['submitted','running','queued','processing'].includes(job.status)) throw new Error('Pose job status is uncertain. Inspect the existing result before retrying.');
    onStatus(job.status); await wait();
  }
}
