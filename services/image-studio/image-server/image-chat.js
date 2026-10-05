import { submitPose, pollPose, fileDataURL } from './image-chat-pose.js';
const $ = id => document.getElementById(id);
const imageRoles = { candidate: 'Image to revise', reference_sheet: 'Character reference sheet', pose_photo: 'Pose photo', pose_map: 'Pose map' };
let history = [], attached = [], controller = null, poseBusy = false;
const imageCount = () => history.reduce((n, m) => n + (m.images?.length || 0), 0) + attached.length;
let memoryRevision = null;
async function loadMemory() {
  $('save-memory').disabled = true;
  try {
    const response = await fetch('/api/image-chat/memory'); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load memory.');
    $('memory-content').value = data.content; memoryRevision = data.revision;
    $('memory-status').textContent = 'Loaded saved memory. Review your changes before saving.';
  } catch (error) { memoryRevision = null; $('memory-status').textContent = error.message; }
  finally { $('save-memory').disabled = !memoryRevision; }
}
$('open-memory').addEventListener('click', async () => { $('memory-panel').hidden = false; if (!memoryRevision) await loadMemory(); $('memory-panel').scrollIntoView({block:'start'}); });
$('close-memory').addEventListener('click', () => { $('memory-panel').hidden = true; });
$('reload-memory').addEventListener('click', loadMemory);
$('save-memory').addEventListener('click', async () => {
  if (!memoryRevision) return;
  $('save-memory').disabled = true; $('reload-memory').disabled = true; $('memory-content').disabled = true;
  $('memory-status').textContent = 'Saving memory and creating a local commit…';
  try {
    const response = await fetch('/api/image-chat/memory', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({content:$('memory-content').value,revision:memoryRevision}) });
    const data = await response.json();
    if (data.revision) { memoryRevision = data.revision; $('memory-content').value = data.content; }
    if (!response.ok) throw new Error(data.error || 'Could not save memory.');
    $('memory-status').textContent = `Saved and committed (${data.commit}). Future replies will use this memory.`;
  } catch (error) { $('memory-status').textContent = error.message; }
  finally { $('save-memory').disabled = !memoryRevision; $('reload-memory').disabled = false; $('memory-content').disabled = false; }
});
const feedback = text => { $('feedback').textContent = text; };
function render() {
  $('welcome').hidden = history.length > 0;
  $('messages').replaceChildren();
  for (const message of history) {
    const article = document.createElement('article'); article.className = `message ${message.role}`;
    const role = document.createElement('div'); role.className = 'role'; role.textContent = message.role === 'user' ? 'You' : 'Image Chat'; article.append(role);
    for (const [i, data] of (message.images || []).entries()) {
      const label = imageRoles[message.image_roles?.[i] || 'candidate'];
      const caption = document.createElement('div'); caption.className = 'role'; caption.textContent = label;
      const img = document.createElement('img'); img.src = data; img.alt = label; article.append(caption, img);
      if (message.image_roles?.[i] === 'pose_map') {
        const download = document.createElement('a'); download.href = data; download.download = 'pose-map.png'; download.textContent = 'Download pose map'; download.className = 'pose-download'; article.append(download);
      }
    }
    const body = document.createElement('div'); body.className = 'body'; body.textContent = message.content; article.append(body); $('messages').append(article);
  }
}
function attachment() {
  $('attachment').hidden = !attached.length; $('attachment').replaceChildren();
  for (const item of attached) {
    const card = document.createElement('div'); card.className = 'attachment-card';
    const img = document.createElement('img'); img.src = item.data; img.alt = item.name;
    const label = document.createElement('label'); label.textContent = item.name;
    const select = document.createElement('select'); select.setAttribute('aria-label', `Role for ${item.name}`);
    for (const [value, text] of Object.entries(imageRoles)) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
    select.value = item.role; select.disabled = !!controller || poseBusy;
    select.addEventListener('change', () => { item.role = select.value; attachment(); }); label.append(select);
    const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.className = 'quiet'; remove.disabled = !!controller || poseBusy; remove.addEventListener('click', () => { attached = attached.filter(a => a !== item); attachment(); });
    card.append(img, label, remove);
    if (item.role === 'pose_photo') {
      const extract = document.createElement('button'); extract.className = 'quiet'; extract.textContent = item.jobId ? 'Resume pose result' : 'Extract pose';
      extract.disabled = !!controller || poseBusy || (item.poseSubmitted && !item.jobId);
      extract.addEventListener('click', () => extractPose(item)); card.append(extract);
    }
    if (item.jobId) { const link = document.createElement('a'); link.href = `/controls#${item.jobId}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open pose result'; card.append(link); }
    if (item.url) { const download = document.createElement('a'); download.href = item.url; download.download = item.name; download.textContent = 'Download pose map'; card.append(download); }
    $('attachment').append(card);
  }
}
function busy(value) { $('send').disabled = value; $('message').disabled = value; $('image-input').disabled = value; $('new-chat').disabled = value; $('stop').hidden = !controller; attachment(); }
async function extractPose(item) {
  if (poseBusy || controller) return;
  poseBusy = true; busy(true); feedback('Extracting pose with the local pose model…');
  try {
    if (!item.jobId) { item.poseSubmitted = true; item.jobId = await submitPose(item.data); attachment(); }
    const result = await pollPose(item.jobId, {onStatus: () => feedback('Extracting pose… The existing job is running. Use Open pose result to reopen it.')} );
    // Replace the photo in this draft, keeping room for the sheet and candidate.
    Object.assign(item, result); attachment(); feedback(result.warning || 'Pose map ready. Send it with your character sheet and image brief.');
  } catch (error) {
    feedback(error.message + (item.jobId ? ' Use Resume pose result to check this same job.' : ' If submission was interrupted, ask an agent to inspect existing jobs before retrying.'));
  } finally { poseBusy = false; busy(false); }
}
$('image-input').addEventListener('change', async event => {
  const files = [...event.target.files]; if (!files.length) return;
  event.target.value = '';
  if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) return feedback('Choose PNG, JPG or WebP images no larger than 5 MB each.');
  if (imageCount() + files.length > 4) return feedback('Use up to four images per chat, including reference sheets and pose maps. Start a new chat for more.');
  try {
    for (const file of files) attached.push({ data: await fileDataURL(file), name: file.name, role: 'candidate' });
    attachment(); feedback('Choose the role of each attachment, describe your goal, then send.'); $('message').focus();
  } catch { feedback('Could not read that image. Please choose it again.'); }
});
$('new-chat').addEventListener('click', () => { history = []; attached = []; $('message').value = ''; render(); attachment(); feedback('New chat started.'); $('message').focus(); });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('message').value = button.dataset.prompt; $('message').focus(); }));
$('stop').addEventListener('click', () => controller?.abort());
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('chat-form').requestSubmit(); } });
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); if (controller || poseBusy) return;
  const content = $('message').value.trim(); if (!content && !attached.length) return feedback('Write a message or add an image.');
  const draft = attached;
  const message = { role: 'user', content: content || 'Review these images using their attachment roles and suggest one useful next step.', ...(draft.length ? { images: draft.map(item => item.data), image_roles: draft.map(item => item.role) } : {}) };
  if (history.length >= 24 || history.reduce((n, m) => n + m.content.length, 0) + message.content.length > 18000) return feedback('This conversation is full. Start a new chat with your key preferences.');
  history.push(message); attached = []; attachment(); $('message').value = ''; render(); controller = new AbortController(); busy(true);
  feedback('Looking and thinking… The first reply can take up to two minutes.');
  $('feedback').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  try {
    const response = await fetch('/api/image-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history }), signal: controller.signal });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The request failed.');
    history.push({ role: 'assistant', content: result.content }); render(); feedback(result.truncated ? 'The reply reached its length limit. Ask for a shorter answer or continue.' : '');
    $('messages').lastElementChild?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (error) {
    history.pop(); $('message').value = content; attached = draft; attachment(); render();
    feedback(error.name === 'AbortError' ? 'Stopped. Your draft is ready to edit or send again.' : error.message);
  } finally { controller = null; busy(false); $('message').focus({ preventScroll: true }); }
});
fetch('/api/image-chat/status').then(r => r.json()).then(status => { $('model-status').textContent = status.online ? '● Qwen · running locally' : '○ Local model unavailable'; if (!status.online) feedback(status.error); }).catch(() => { $('model-status').textContent = '○ Connection unavailable'; });
