const el = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
async function refresh() {
  try {
    const state = await window.mediaStatus.state();
    document.querySelector('#pin').checked = state.pinned;
    document.querySelector('#connection').textContent = state.online ? `${state.nodeId} · Connected` : 'Hub unavailable · reconnecting';
    const root = document.querySelector('#services'); root.replaceChildren();
    for (const s of state.services || []) {
      const card = el('section', ''); const row = el('div', '', 'row');
      row.append(el('h2', s.kind === 'voice' ? 'Voice' : 'Image'), el('span', s.state, `badge ${s.state}`)); card.append(row);
      if (s.queued) card.append(el('p', `${s.queued} queued`, 'muted'));
      for (const j of [...s.active, ...s.recent.slice(0, 1)]) {
        const job = el('div', '', 'job');
        job.append(el('div', `${j.id.slice(0, 8)} · ${j.phase || j.status}`));
        if (j.elapsedSeconds !== null) job.append(el('div', `${Math.floor(j.elapsedSeconds / 60)}m ${j.elapsedSeconds % 60}s`, 'muted'));
        if (j.status === 'finished') { const open = el('button', s.kind === 'voice' ? 'Show audio files' : 'Open image'); open.onclick = () => window.mediaStatus.open(s.kind, j.id); job.append(open); }
        card.append(job);
      }
      if (!s.active.length && !s.recent.length) card.append(el('p', s.online ? 'No recent jobs' : 'Service unavailable', 'muted'));
      root.append(card);
    }
  } catch { document.querySelector('#connection').textContent = 'Status unavailable'; }
  setTimeout(refresh, 3000);
}
document.querySelector('#pin').onchange = event => window.mediaStatus.pin(event.target.checked);
document.querySelector('#hide').onclick = () => window.mediaStatus.hide();
refresh();
