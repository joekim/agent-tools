const el = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
let latest = { services: [] }, selected = null;
const duration = seconds => seconds === null ? '' : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
async function navigate(kind) {
  selected = kind;
  document.body.classList.toggle('detail', !!kind);
  document.querySelector('#back').hidden = !kind;
  await window.mediaStatus.view(kind);
  render();
  document.querySelector(kind ? '#back' : '[data-kind]')?.focus();
}
function render() {
  const focusKind = document.activeElement?.dataset.kind;
  document.querySelector('#pin').checked = latest.pinned;
  document.querySelector('h1').textContent = selected === 'tasks' ? 'Task messages' : selected ? `${selected === 'voice' ? 'Voice' : 'Image'} activity` : 'Media Hub';
  document.querySelector('#connection').textContent = latest.online ? `${latest.nodeId} · Live · Updates every 3s` : 'Hub unavailable · Reconnecting…';
  const root = document.querySelector('#services'); root.replaceChildren();
  if (!selected) {
    const n = latest.notifications?.[0];
    const card = el('button', '', `notification ${n?.status || ''}`); card.dataset.kind = 'tasks';
    card.append(el('span', n ? `${n.agent} · ${n.status === 'completed' ? 'Task complete' : n.status === 'blocked' ? 'Needs your attention' : 'Task failed'}` : 'Task notifications', 'eyebrow'),
      el('strong', n?.title || 'Waiting for task updates'), el('span', n?.message || 'Completed tasks and blockers will appear here.', 'message'));
    if (n) card.append(el('span', new Date(n.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · Click for details', 'notification-meta'));
    card.onclick = () => navigate('tasks'); root.append(card);
  }
  if (selected === 'tasks') {
    const messages = latest.notifications || [];
    if (!messages.length) root.append(el('p', 'No task messages yet.', 'muted'));
    for (const n of messages) {
      const card = el('section', '', 'job');
      const row = el('div', '', 'row'); row.append(el('strong', n.title), el('span', n.status, 'badge'));
      card.append(row, el('p', n.message), el('p', `${n.agent} · ${new Date(n.createdAt).toLocaleString()}`, 'muted'));
      if (n.threadId) card.append(el('p', `Task: ${n.threadId}`, 'job-id'));
      root.append(card);
    }
    return;
  }
  const services = ['image', 'voice'].map(kind => latest.services.find(s => s.kind === kind) || { kind, state: 'offline', online: false, active: [], recent: [], queued: 0 });
  for (const s of services.filter(s => selected ? s.kind === selected : ['generating', 'queued'].includes(s.state))) {
    if (!selected) {
      const card = el('button', '', 'service'); card.dataset.kind = s.kind;
      card.setAttribute('aria-label', `${s.kind} ${s.state}, open details`);
      const current = s.active[0];
      card.append(el('span', '', `dot ${s.state}`), el('strong', s.kind === 'voice' ? 'Voice' : 'Image'),
        el('span', current ? `${s.state} · ${duration(current.elapsedSeconds)}${s.queued ? ` · ${s.queued} queued` : ''}` : s.state, 'summary'), el('span', '›', 'chevron'));
      card.onclick = () => navigate(s.kind); root.append(card);
      continue;
    }
    const heading = el('div', '', 'row'); heading.append(el('h2', 'Current status'), el('span', s.state, `badge ${s.state}`)); root.append(heading);
    root.append(el('p', s.active.length ? `${s.active.length} active · ${s.queued} queued` : s.online ? 'No generation in progress.' : 'Service status is unavailable.', 'muted'));
    for (const [title, jobs] of [['In progress', s.active], ['Recent jobs', s.recent]]) {
      if (!jobs.length) continue;
      root.append(el('h2', title));
      for (const j of jobs) {
        const job = el('section', '', 'job'); const row = el('div', '', 'row');
        row.append(el('strong', j.status), el('span', duration(j.elapsedSeconds), 'muted')); job.append(row);
        job.append(el('p', j.id, 'job-id'));
        if (j.phase && j.status !== 'finished') job.append(el('p', `Phase: ${j.phase}`, 'muted'));
        if (j.startedAt) job.append(el('p', new Date(j.startedAt).toLocaleString(), 'muted'));
        if (j.status === 'finished') {
          const open = el('button', s.kind === 'voice' ? 'Show audio files' : 'Open image');
          open.onclick = async () => { try { await window.mediaStatus.open(s.kind, j.id); } catch { open.textContent = 'Could not open result'; } }; job.append(open);
        }
        root.append(job);
      }
    }
  }
  if (focusKind) root.querySelector(`[data-kind="${focusKind}"]`)?.focus();
}
async function refresh() {
  try { latest = await window.mediaStatus.state(); render(); }
  catch { document.querySelector('#connection').textContent = 'Status unavailable'; }
  setTimeout(refresh, 3000);
}
document.querySelector('#pin').onchange = event => window.mediaStatus.pin(event.target.checked);
document.querySelector('#back').onclick = () => navigate(null);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && selected) navigate(null); });
window.mediaStatus.onUpdate(state => {
  latest = state;
  if (state.resetView) { selected = null; document.body.classList.remove('detail'); document.querySelector('#back').hidden = true; }
  render();
});
refresh();
