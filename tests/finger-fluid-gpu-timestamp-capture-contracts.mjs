import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fingerFluidCore from '../finger-fluid-webgpu-core.js';

const { createFingerFluidSolverGpuTimingStagePlan, createFingerFluidSolverTimestampWrites } = fingerFluidCore;
assert.equal(typeof createFingerFluidSolverGpuTimingStagePlan, 'function',
  'solver exposes a density-aware detailed timing plan');

const querySet = { type: 'timestamp', count: 8 };
const threePassPlan = createFingerFluidSolverGpuTimingStagePlan(3);
assert.equal(threePassPlan.length, 22,
  'three density iterations expose every density dispatch and both post-projection grid refresh dispatches');
assert.deepEqual(threePassPlan.slice(1, 6), [
  'density_iteration_0_clear_grid',
  'density_iteration_0_build_grid',
  'density_iteration_0_lambda',
  'density_iteration_0_position_delta',
  'density_iteration_0_apply_position_delta',
]);
assert.ok(threePassPlan.includes('density_iteration_2_position_delta'));
assert.ok(threePassPlan.includes('post_projection_grid_refresh_clear'));
assert.ok(threePassPlan.includes('post_projection_grid_refresh_build'));
assert.throws(() => createFingerFluidSolverGpuTimingStagePlan(0), /positive integer/);
assert.throws(() => createFingerFluidSolverGpuTimingStagePlan(1.5), /positive integer/);
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
  'coarse solver pass-stage timing retains stable semantic group names');
assert.ok(coreSource.includes("'apply_velocity_interface_contact_compaction_particle_shift_adaptive'"),
  'optional particle-shift/adaptive dispatches share the always-active final solver timing group');
assert.doesNotMatch(coreSource, /advanceStage\(7\)/,
  'solver stage capture does not create a trailing compute pass that can be empty when optional work is disabled');
assert.doesNotMatch(coreSource, /pass\.writeTimestamp\(/,
  'solver-stage capture does not depend on Chromium-only in-pass timestamp writes');
const stageArmStart = coreSource.indexOf('function armSolverStageGpuTimestampCaptureForWitness');
const stageArmEnd = coreSource.indexOf('function finishSolverStageGpuTimestampCaptureForWitness', stageArmStart);
assert.ok(stageArmStart >= 0 && stageArmEnd > stageArmStart,
  'solver stage timestamp capture arm has a bounded implementation');
assert.match(coreSource.slice(stageArmStart, stageArmEnd),
  /device\.features\?\.has\?\.\('timestamp-query'\)/,
  'solver stage capture requires the standard WebGPU timestamp-query feature');
assert.doesNotMatch(coreSource, /encoder\.writeTimestamp\(/,
  'renderer capture does not depend on Chromium-only command-encoder timestamp writes');
assert.match(coreSource, /hdrWorldBackgroundPass = encoder\.beginRenderPass\([\s\S]{0,300}rendererTimestampCapture\.querySet/,
  'renderer timing begins at the first direct render pass using standard pass-boundary timestamps');
assert.match(coreSource, /finalPresentationPass = encoder\.beginRenderPass\([\s\S]{0,500}rendererTimestampCapture\.querySet/,
  'renderer timing ends at the final direct render pass using standard pass-boundary timestamps');
assert.match(coreSource, /lastRenderCpuMs: Number\(lastRenderCpuMs\.toFixed\(3\)\)/,
  'debug state exposes JavaScript renderer submission time separately');
assert.match(coreSource, /stageCapture\.querySet,[\s\S]{0,140}stageQueryBase \+ \(stageIndex \* 2\)/,
  'each dynamically planned solver dispatch group uses standard pass-begin/pass-end timestamp writes');
assert.match(benchSource, /frameTimeMsEstimate: fingerFluidBenchLastFrameMs/,
  'visible frame CPU estimate reports the complete synchronous bench-frame work');
assert.match(benchSource, /kaminosFingerFluidBenchBeginSolverStageTimestampCaptureForWitness[\s\S]*?armSolverStageGpuTimestampCaptureForWitness/,
  'bench witness exposes opt-in stage capture');
assert.match(benchSource, /kaminosFingerFluidBenchBeginRendererTimestampCaptureForWitness[\s\S]*?armRendererGpuTimestampCaptureForWitness/,
  'bench witness exposes opt-in renderer capture');
console.log('finger-fluid GPU timestamp capture contracts passed');
