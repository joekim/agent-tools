export const popupMs = 10000;
export const initialVisibility = () => ({ signature: null, manual: false, visible: false, until: null });
export function activitySignature(snapshot) {
  return JSON.stringify([snapshot.online, (snapshot.notifications || []).map(n => n.id), [...snapshot.services].sort((a, b) => a.kind.localeCompare(b.kind)).map(s =>
    [s.kind, s.state, s.queued, [...s.active, ...s.recent].map(j => [j.id, j.status, j.phase])])]);
}
export function visibilityEvent(state, event, now = Date.now()) {
  if (event.type === 'open') return { ...state, manual: true, visible: true, until: null };
  if (event.type === 'hide') return { ...state, manual: false, visible: false, until: null };
  // Clicking the tray during an automatic peek makes it stay open.
  if (event.type === 'toggle') return visibilityEvent(state, { type: state.manual && state.visible ? 'hide' : 'open' }, now);
  if (event.type === 'expire') return !state.manual && state.until !== null && now >= state.until ? { ...state, visible: false, until: null } : state;
  if (event.type === 'snapshot') {
    const changed = state.signature !== null && state.signature !== event.signature;
    return { ...state, signature: event.signature, ...(changed && !state.manual ? { visible: true, until: now + popupMs } : {}) };
  }
  return state;
}
