// kaminos-test: node
import assert from 'node:assert/strict';
import { checkExternalApp } from '../models/flux2-klein/external-app-checks.mjs';
const good = { gpuErrors: [], failedLoad: 'no-weights-here', first: { greenStd: 20 },
  second: { greenStd: 20, textCached: true }, invalidRequest: 'multiples of 16', afterDestroy: 'destroyed',
  deviceAfterDestroy: [1, 2, 3, 4], app: { ownership: { device: 'borrowed' } },
  paused: { status: 'paused' }, resumed: { status: 'running' }, pausedFrame: { status: 'completed' },
  afterRuns: { phase: 'idle', error: null }, routesAfterRuns: 0,
  events: [{ step: 1 }, { preview: 1 }, { seed: 1, cooperativeDuties: 12, frames: 3 }, { seed: 2, cooperativeDuties: 10, frames: 2 }] };
assert.deepEqual(checkExternalApp(good), []);
for (const mutate of [
  r => { r.events[2].cooperativeDuties = 0; },
  r => { r.events[3].frames = 0; },
  r => { r.paused = null; },
  r => { r.pausedFrame.status = 'failed'; },
  r => { r.routesAfterRuns = 1; },
  r => { r.afterRuns.error = 'cleanup failed'; },
  r => { r.first.greenStd = 0; },
  r => { r.gpuErrors.push('bad GPU'); },
]) {
  const record = structuredClone(good); mutate(record);
  assert.ok(checkExternalApp(record).length, 'the native witness must reject missing cooperation, frames, controls, cleanup or output');
}
console.log('Klein application witness rejection contracts passed');
