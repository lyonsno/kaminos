import assert from 'node:assert/strict';
import {judgeForegroundRebind} from '../foreground-rebind-probe.mjs';

const good = {
  sameDevice: true,
  phases: ['a', 'b', 'a'].map((routeId, index) => ({
    routeId,
    before: {frameCount: index * 4, simStepCount: index * 4},
    after: {frameCount: index * 4 + 3, simStepCount: index * 4 + 3},
    receipts: [1, 2, 3].map(n => ({
      status: 'completed',
      result: {status: 'submitted', renderer: 'ordinary-volume', frameCount: index * 4 + n, simStepCount: index * 4 + n},
      submissions: [{submissionStatus: 'queue-submit-returned', commandBufferCount: 1}],
    })),
  })),
  final: {active: true, error: null},
};
assert.deepEqual(judgeForegroundRebind(good), []);
assert.match(judgeForegroundRebind({...good, sameDevice: false}).join(' '), /device/);
assert.match(judgeForegroundRebind({...good, phases: good.phases.slice(0, 2)}).join(' '), /A-B-A/);
assert.match(judgeForegroundRebind({...good, phases: good.phases.map((phase, index) => index !== 1 ? phase : {...phase, receipts: phase.receipts.map(r => ({...r, submissions: []}))})}).join(' '), /submission/);
assert.match(judgeForegroundRebind({...good, final: {active: false, error: 'lost'}}).join(' '), /renderer/);
console.log('foreground rebind evidence judge rejects false closure');
