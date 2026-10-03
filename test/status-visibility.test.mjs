import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySignature, initialVisibility, visibilityEvent } from '../desktop/status/visibility.mjs';
test('automatic peeks expire, repeated polling does not extend them, manual opening persists', () => {
  let s = visibilityEvent(initialVisibility(), { type: 'snapshot', signature: 'idle' }, 0);
  assert.equal(s.visible, false);
  s = visibilityEvent(s, { type: 'snapshot', signature: 'running' }, 100);
  assert.equal(s.visible, true); assert.equal(s.until, 10100);
  s = visibilityEvent(s, { type: 'snapshot', signature: 'running' }, 500);
  assert.equal(s.until, 10100);
  assert.equal(visibilityEvent(s, { type: 'expire' }, 10100).visible, false);
  s = visibilityEvent(s, { type: 'toggle' }, 600);
  assert.equal(s.manual, true);
  s = visibilityEvent(s, { type: 'snapshot', signature: 'finished' }, 700);
  assert.equal(visibilityEvent(s, { type: 'expire' }, 99999).visible, true);
  s = visibilityEvent(s, { type: 'toggle' }, 100000);
  assert.equal(s.visible, false); assert.equal(s.manual, false);
  s = visibilityEvent(s, { type: 'snapshot', signature: 'new-job' }, 100001);
  assert.equal(s.visible, true);
});
test('elapsed time updates do not trigger popups but job and service changes do', () => {
  const a = { online: true, services: [{ kind: 'voice', state: 'generating', queued: 0, active: [{ id: 'a', status: 'generating', phase: 'generating', elapsedSeconds: 2 }], recent: [] }] };
  const b = structuredClone(a); b.services[0].active[0].elapsedSeconds = 30;
  assert.equal(activitySignature(a), activitySignature(b));
  b.services[0].active[0].phase = 'validating';
  assert.notEqual(activitySignature(a), activitySignature(b));
});
