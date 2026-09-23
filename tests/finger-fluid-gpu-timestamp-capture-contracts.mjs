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
console.log('finger-fluid GPU timestamp capture contracts passed');
