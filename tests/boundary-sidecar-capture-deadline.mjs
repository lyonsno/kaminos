import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import {
  BOUNDARY_SIDECAR_CAPTURE_DEADLINE_IDENTITY,
  runBoundarySidecarCaptureWithDeadline,
} from '../boundary-sidecar-capture-deadline.mjs';

let resolveLateCapture;
const releasedCaptureIds = [];
const deadlineReceipt = await runBoundarySidecarCaptureWithDeadline({
  capture: () => new Promise(resolve => { resolveLateCapture = resolve; }),
  release: async captureId => { releasedCaptureIds.push(captureId); },
  deadlineMs: 5,
});
assert.deepEqual(deadlineReceipt, {
  ok: false,
  identity: BOUNDARY_SIDECAR_CAPTURE_DEADLINE_IDENTITY,
  reason: 'boundary-sidecar-raw-capture-deadline-exceeded',
  deadlineMs: 5,
  lateReleaseScheduled: true,
  browserSessionDisposition: 'poisoned-close-required',
});
resolveLateCapture({ ok: true, captureId: 'late-capture-1' });
await delay(0);
assert.deepEqual(releasedCaptureIds, ['late-capture-1'], 'a capture completing after the browser deadline is released automatically');

const immediateReceipt = await runBoundarySidecarCaptureWithDeadline({
  capture: async () => ({ ok: true, captureId: 'immediate-capture-1' }),
  release: async captureId => { releasedCaptureIds.push(captureId); },
  deadlineMs: 50,
});
assert.equal(immediateReceipt.captureId, 'immediate-capture-1');
assert.deepEqual(releasedCaptureIds, ['late-capture-1'], 'a capture returned before deadline remains under caller release custody');

await assert.rejects(
  runBoundarySidecarCaptureWithDeadline({
    capture: async () => { throw new Error('capture exploded'); },
    release: async () => {},
    deadlineMs: 50,
  }),
  /capture exploded/,
);

console.log('boundary sidecar capture deadline: PASS');
