const $ = id => document.getElementById(id);
let history = [], attached = null, controller = null;
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
    for (const data of message.images || []) { const img = document.createElement('img'); img.src = data; img.alt = 'Your image for this message'; article.append(img); }
    const body = document.createElement('div'); body.className = 'body'; body.textContent = message.content; article.append(body); $('messages').append(article);
  }
}
function attachment() { $('attachment').hidden = !attached; $('preview').src = attached?.data || ''; $('filename').textContent = attached?.name || ''; }
function busy(value) { $('send').disabled = value; $('message').disabled = value; $('image-input').disabled = value; $('remove-image').disabled = value; $('new-chat').disabled = value; $('stop').hidden = !value; }
$('image-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return feedback('Choose a PNG, JPG or WebP image no larger than 5 MB.');
  if (history.filter(m => m.images?.length).length >= 2) return feedback('This chat already has two images. Start a new chat to work with more.');
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    attached = { data, name: file.name }; attachment(); feedback('Image ready. Add your goal, then send.'); $('message').focus();
  } catch { feedback('Could not read that image. Please choose it again.'); }
});
$('remove-image').addEventListener('click', () => { attached = null; attachment(); feedback(''); });
$('new-chat').addEventListener('click', () => { history = []; attached = null; $('message').value = ''; render(); attachment(); feedback('New chat started.'); $('message').focus(); });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('message').value = button.dataset.prompt; $('message').focus(); }));
$('stop').addEventListener('click', () => controller?.abort());
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('chat-form').requestSubmit(); } });
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); if (controller) return;
  const content = $('message').value.trim(); if (!content && !attached) return feedback('Write a message or add an image.');
  const draft = attached;
  const message = { role: 'user', content: content || 'Please critique this image and suggest one useful improvement.', ...(draft ? { images: [draft.data] } : {}) };
  if (history.length >= 24 || history.reduce((n, m) => n + m.content.length, 0) + message.content.length > 18000) return feedback('This conversation is full. Start a new chat with your key preferences.');
  history.push(message); attached = null; attachment(); $('message').value = ''; render(); busy(true);
  controller = new AbortController(); feedback('Looking and thinking… The first reply can take up to two minutes.');
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
