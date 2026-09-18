import assert from 'node:assert/strict';
import {
  createMogeFrameAdmission,
  resolveMogeFrameAdmissionMode,
  verifyMogeFrameAdmission,
} from '../lib/moge-frame-admission.mjs';

const flush = () => new Promise(setImmediate);
function fixture() {
  let release;
  let frame;
  let fences = 0;
  let clock = 0;
  const controller = new AbortController();
  const events = [];
  const flame = { active: true, backend: 'WebGPU:fixture', frameCount: 10, simStepCount: 20 };
  const queue = { onSubmittedWorkDone() { fences++; return new Promise(resolve => { release = resolve; }); } };
  const gate = createMogeFrameAdmission({
    queue,
    readFlame: () => flame,
    visibility: () => flame.visibility ?? 'visible',
    requestFrame: fn => { frame = fn; return 1; },
    cancelFrame: () => { frame = null; },
    now: () => ++clock,
    events,
  });
  let done = false;
  const pending = gate({ phase: 'backbone', chunk: 'block-0:qkv', signal: controller.signal }).then(() => { done = true; });
  pending.catch(() => {});
  return {
    controller, events, flame, pending,
    get done() { return done; },
    get fences() { return fences; },
    release: () => release(),
    tick: () => frame?.(),
  };
}

const candidate = fixture();
await flush();
assert.equal(candidate.done, false);
assert.equal(candidate.fences, 1);
candidate.flame.frameCount++;
candidate.flame.simStepCount++;
candidate.release();
await flush();
candidate.tick();
await flush();
assert.equal(candidate.done, false, 'advances before the model queue fence do not count');
candidate.flame.frameCount++;
candidate.tick();
await flush();
assert.equal(candidate.done, false, 'render alone cannot close simulation advancement');
candidate.flame.simStepCount++;
candidate.tick();
await candidate.pending;
assert.equal(candidate.events[0].status, 'advanced');

for (const when of ['before-fence', 'after-fence']) {
  const value = fixture();
  await flush();
  if (when === 'after-fence') { value.release(); await flush(); }
  value.controller.abort();
  await assert.rejects(value.pending, { name: 'AbortError' });
  assert.equal(value.events[0].status, 'failed');
}
for (const mutation of [
  state => { state.active = false; },
  state => { state.visibility = 'hidden'; },
  state => { state.frameCount = 0; },
  state => { state.backend = 'CPU:fallback'; },
]) {
  const value = fixture();
  await flush();
  value.release();
  await flush();
  mutation(value.flame);
  value.tick();
  await assert.rejects(value.pending);
  assert.equal(value.events[0].status, 'failed');
}

const admitted = candidate.events[0];
const schedulerReceipt = {
  scheduler: { effectiveScheduler: { hostAdmission: 'callback' } },
  eventTrace: { events: [
    { kind: 'host-admission-start' },
    { kind: 'host-admission-end', status: 'advanced' },
  ] },
};
assert.equal(verifyMogeFrameAdmission({ events: [admitted], schedulerReceipt }).admissions, 1);
for (const mutate of [
  value => { value.events[0].after.simStepCount = value.events[0].before.simStepCount; },
  value => { value.schedulerReceipt.scheduler.effectiveScheduler.hostAdmission = 'none'; },
  value => { value.schedulerReceipt.eventTrace.events.pop(); },
]) {
  const value = structuredClone({ events: [admitted], schedulerReceipt });
  mutate(value);
  assert.throws(() => verifyMogeFrameAdmission(value));
}

assert.throws(() => createMogeFrameAdmission({ queue: {}, readFlame() {} }), /requires/);
assert.equal(resolveMogeFrameAdmissionMode('#composition_module_url=./moge-live-flame-inject.mjs'), 'none');
assert.equal(resolveMogeFrameAdmissionMode('#composition_module_url=x&moge_frame_admission=fresh-flame'), 'fresh-flame');
assert.throws(() => resolveMogeFrameAdmissionMode('#moge_frame_admission=typo'), /Unknown/);
console.log('MoGe frame admission: queue fence, fresh dual-counter advance, abort, failure paths and evidence parity pass');
