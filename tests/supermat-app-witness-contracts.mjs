// kaminos-test: node
import assert from 'node:assert/strict';
import { checkSuperMatAppWitness, checkSuperMatDemoWitness } from '../models/supermat/app-witness-checks.mjs';
const run = { identity: { backend: 'webgpu-local', modelId: 'supermat.single-image' }, cpuWorker: true, dutyCount: 5, frames: 3, width: 64, height: 64 };
const good = { source: { rev: 'exact', dirtyFiles: [] }, expectedRevision: 'exact', installed: { name: '@kaminos/supermat' }, outsideCheckout: true,
  browserExit: { code: 0 }, gpuErrors: [], runs: [run, run], size: 64, albedo: { std: 12, bytes: 64 * 64 * 4 },
  paused: { status: 'paused' }, pausedFrames: 2, resumed: true, stopped: true, invalidSize: 'positive multiple of 64',
  afterBorrowedDestroy: { phase: 'idle', loaded: true }, afterDestroy: { destroyed: true, loaded: false } };
assert.deepEqual(checkSuperMatAppWitness(good), []);
for (const mutate of [r => r.source.rev = 'other', r => r.source.dirtyFiles.push('changed'), r => r.outsideCheckout = false,
  r => r.runs[0].identity.backend = 'cpu-fallback', r => r.runs[0].cpuWorker = false, r => r.runs[0].width = 32,
  r => r.runs[0].frames = 0, r => r.albedo.std = 0, r => r.pausedFrames = 0, r => r.stopped = false,
  r => r.afterBorrowedDestroy.loaded = false, r => r.afterDestroy.destroyed = false, r => r.gpuErrors.push('bad GPU')]) {
  const record = structuredClone(good); mutate(record); assert.ok(checkSuperMatAppWitness(record).length);
}
console.log('SuperMat native witness rejects fallback, stale source, blank output, hidden size and missing lifecycle evidence');

// Actual demo gate must fail closed on absent frame/duty observations.
const demo = { state: { status: 'done', identity: { backend: 'webgpu-local' }, runs: [{ size: 512, dutyCount: 3, cpuWorker: true, frames: { frames: 2 } }] } };
assert.deepEqual(checkSuperMatDemoWitness(demo), []);
for (const mutate of [d => d.state.runs[0].frames = null, d => delete d.state.runs[0].frames,
  d => delete d.state.runs[0].dutyCount, d => d.state.runs[0].dutyCount = 0,
  d => d.state.runs[0].frames.frames = 0]) {
  const record = structuredClone(demo); mutate(record);
  assert.ok(checkSuperMatDemoWitness(record).length, 'demo validator must reject absent foreground frames or cooperative duties');
}
