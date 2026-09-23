import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createFingerFluidSolverTimestampWrites,
} from '../finger-fluid-webgpu-core.js';

const querySet = { type: 'timestamp', count: 8 };
assert.deepEqual(createFingerFluidSolverTimestampWrites(querySet, 2), {
  querySet,
  beginningOfPassWriteIndex: 2,
  endOfPassWriteIndex: 3,
});
assert.throws(() => createFingerFluidSolverTimestampWrites(null, 0), /query set/);
assert.throws(() => createFingerFluidSolverTimestampWrites(querySet, -1), /nonnegative/);
assert.throws(() => createFingerFluidSolverTimestampWrites(querySet, 1.5), /nonnegative/);
assert.throws(() => createFingerFluidSolverTimestampWrites(querySet, 7), /exceeds query set count/);
const coreSource = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const benchSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(coreSource, /timestampWrites:\s*createFingerFluidSolverTimestampWrites\(/,
  'timestamp writes are attached to the solver compute pass itself');
assert.match(coreSource, /armSolverGpuTimestampCaptureForWitness,\s*finishSolverGpuTimestampCaptureForWitness/,
  'solver GPU capture is explicit and can be fully disabled after the witness');
assert.match(benchSource, /kaminosFingerFluidBenchBeginSolverTimestampCaptureForWitness\s*=\s*\(querySet, firstQueryIndex, pairCount\)\s*=>[\s\S]*?armSolverGpuTimestampCaptureForWitness/,
  'bench witness arms the real solver capture API');
assert.match(coreSource, /KAMINOS_FINGER_FLUID_SOLVER_GPU_TIMING_STAGES[\s\S]*?density_projection[\s\S]*?post_projection_grid_refresh/,
  'solver pass-stage timing has stable semantic stage names');
assert.match(coreSource, /pass\.writeTimestamp\(stageCapture\.querySet/,
  'solver stages are timestamped inside the real compute pass');
const stageArmStart = coreSource.indexOf('function armSolverStageGpuTimestampCaptureForWitness');
const stageArmEnd = coreSource.indexOf('function finishSolverStageGpuTimestampCaptureForWitness', stageArmStart);
assert.ok(stageArmStart >= 0 && stageArmEnd > stageArmStart,
  'solver stage timestamp capture arm has a bounded implementation');
assert.match(coreSource.slice(stageArmStart, stageArmEnd),
  /device\.features\?\.has\?\.\('chromium-experimental-timestamp-query-inside-passes'\)/,
  'experimental in-pass timestamps are rejected at arm time unless their WebGPU feature is enabled');
assert.match(coreSource, /encoder\.writeTimestamp\([\s\S]*?rendererTimestampCapture\.querySet/,
  'direct renderer GPU work is timestamped on its real command encoder');
assert.match(coreSource, /lastRenderCpuMs: Number\(lastRenderCpuMs\.toFixed\(3\)\)/,
  'debug state exposes JavaScript renderer submission time separately');
assert.match(benchSource, /frameTimeMsEstimate: fingerFluidBenchLastFrameMs/,
  'visible frame CPU estimate reports the complete synchronous bench-frame work');
assert.match(benchSource, /kaminosFingerFluidBenchBeginSolverStageTimestampCaptureForWitness[\s\S]*?armSolverStageGpuTimestampCaptureForWitness/,
  'bench witness exposes opt-in stage capture');
assert.match(benchSource, /kaminosFingerFluidBenchBeginRendererTimestampCaptureForWitness[\s\S]*?armRendererGpuTimestampCaptureForWitness/,
  'bench witness exposes opt-in renderer capture');
console.log('finger-fluid GPU timestamp capture contracts passed');
