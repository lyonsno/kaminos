import assert from 'node:assert/strict';
import {
  createMogeFrameAdmission,
  resolveMogeFrameAdmissionMode,
  verifyMogeFrameAdmission,
} from '../lib/moge-frame-admission.mjs';
import { createWebGpuForegroundService } from '../webgpu-inference-kit/src/index.js';

const flush = () => new Promise(setImmediate);

async function fixture() {
  let frame;
  let clock = 0;
  const controller = new AbortController();
  const events = [];
  const flame = { active: true, backend: 'WebGPU:fixture', frameCount: 10, simStepCount: 20 };
  const device = { queue: { submit() {} } };
  const foregroundService = createWebGpuForegroundService({
    routeId: 'test.moge-frame-admission',
    device,
    now: () => ++clock,
  });
  const admission = await createMogeFrameAdmission({
    foregroundService,
    runId: 'run-1',
    readFlame: () => flame,
    visibility: () => flame.visibility ?? 'visible',
    requestFrame: fn => { frame = fn; return 1; },
    cancelFrame: () => { frame = null; },
    now: () => ++clock,
    events,
  });
  let done = false;
  const pending = admission.admit({
    phase: 'backbone', chunk: 'block-0:qkv', signal: controller.signal,
  }).then(() => { done = true; });
  pending.catch(() => {});
  await flush();
  return {
    admission, controller, events, flame, foregroundService, pending,
    get done() { return done; },
    tick: () => frame?.(),
  };
}

const candidate = await fixture();
assert.equal(candidate.done, false);
assert.equal(candidate.events[0].before.frameCount, 10);
candidate.flame.frameCount++;
candidate.tick();
await flush();
assert.equal(candidate.done, false, 'render alone cannot close simulation advancement');
candidate.flame.simStepCount++;
candidate.tick();
await candidate.pending;
assert.equal(candidate.events[0].status, 'advanced');
assert.equal(candidate.events[0].foregroundReceipt.status, 'completed');
assert.equal(candidate.events[0].foregroundReceipt.submissionCount, 0,
  'the host observation callback does not pretend to submit on the model device');
const candidateFinish = await candidate.admission.finish();
assert.equal(candidateFinish.status, 'succeeded');
assert.equal(candidate.foregroundService.snapshot().activeRun, null);

const aborted = await fixture();
aborted.controller.abort();
await assert.rejects(aborted.pending, { name: 'AbortError' });
assert.equal(aborted.events[0].status, 'failed');
assert.equal(aborted.events[0].foregroundReceipt.status, 'canceled-during-service');
await aborted.admission.finish();

for (const mutation of [
  state => { state.active = false; },
  state => { state.visibility = 'hidden'; },
  state => { state.frameCount = 0; },
  state => { state.backend = 'CPU:fallback'; },
]) {
  const value = await fixture();
  mutation(value.flame);
  value.tick();
  await assert.rejects(value.pending);
  assert.equal(value.events[0].status, 'failed');
  assert.equal(value.events[0].foregroundReceipt.status, 'failed-before-submission');
  await value.admission.finish();
}

const admitted = candidate.events[0];
const schedulerReceipt = {
  scheduler: { effectiveScheduler: {
    hostAdmission: 'callback', pacing: 'strict-drain', waitForSubmittedWorkDone: true,
  } },
  eventTrace: { events: [
    { kind: 'queue-work-done-end', phase: admitted.phase, chunk: admitted.chunk, provenance: 'observed' },
    { kind: 'host-admission-start', phase: admitted.phase, chunk: admitted.chunk, provenance: 'observed' },
    { kind: 'host-admission-end', phase: admitted.phase, chunk: admitted.chunk, status: 'advanced', provenance: 'observed' },
  ] },
};
assert.equal(verifyMogeFrameAdmission({
  events: [admitted], schedulerReceipt, finishReport: candidateFinish,
}).admissions, 1);
for (const mutate of [
  value => { value.events[0].foregroundReceipt.result.after.simStepCount = value.events[0].foregroundReceipt.result.before.simStepCount; },
  value => { value.schedulerReceipt.scheduler.effectiveScheduler.hostAdmission = 'none'; },
  value => { value.schedulerReceipt.scheduler.effectiveScheduler.pacing = 'bounded-prefix'; },
  value => { value.schedulerReceipt.scheduler.effectiveScheduler.waitForSubmittedWorkDone = false; },
  value => { delete value.schedulerReceipt.scheduler.effectiveScheduler.pacing; },
  value => { value.schedulerReceipt.eventTrace.events.shift(); },
  value => { value.schedulerReceipt.eventTrace.events[1].chunk = 'wrong-chunk'; },
  value => { value.schedulerReceipt.eventTrace.events.splice(1, 0, structuredClone(value.schedulerReceipt.eventTrace.events[1])); },
  value => { value.events[0].foregroundReceipt.requestId = 'wrong-request'; },
  value => { value.finishReport.receipts[0].requestId = 'wrong-retained-request'; },
  value => { value.finishReport.status = 'incomplete'; },
]) {
  const value = structuredClone({ events: [admitted], schedulerReceipt, finishReport: candidateFinish });
  mutate(value);
  assert.throws(() => verifyMogeFrameAdmission(value));
}

await assert.rejects(createMogeFrameAdmission({
  foregroundService: {}, runId: 'run-1', readFlame() {},
}), /requires/);
assert.equal(resolveMogeFrameAdmissionMode('#composition_module_url=./moge-live-flame-inject.mjs'), 'none');
assert.equal(resolveMogeFrameAdmissionMode('#composition_module_url=x&moge_frame_admission=fresh-flame'), 'fresh-flame');
assert.throws(() => resolveMogeFrameAdmissionMode('#moge_frame_admission=typo'), /Unknown/);
console.log('MoGe frame admission: shared foreground lifecycle, fresh dual-counter advance, abort, failure paths and evidence parity pass');
