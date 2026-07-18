#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../volume-exact-state-cadence-gpu.mjs', import.meta.url);
assert.ok(existsSync(fileURLToPath(moduleUrl)), 'exact-state cadence GPU runtime exists');

const source = readFileSync(moduleUrl, 'utf8');
const runtime = await import(moduleUrl.href);

assert.equal(runtime.EXACT_STATE_CADENCE_GPU_IDENTITY, 'kaminos.volume.exact-state-cadence-gpu.v0');
assert.equal(typeof runtime.createExactStateCadenceGpuRuntime, 'function');
assert.match(source, /exactStateCadenceAllocationPlan/, 'GPU allocation delegates depth and device-limit authority to the pure plan');
assert.match(source, /createExactStateCadenceRing/, 'GPU runtime owns one pure completed-state authority object');
assert.match(source, /planExactStateProduction/, 'GPU archive reserves a slot without prematurely publishing completion');
assert.match(source, /queue\.onSubmittedWorkDone\(\)[\s\S]*recordCompletedExactState/, 'GPU state becomes completed only after submitted work finishes');
assert.match(source, /copyBufferToBuffer\(\s*sourceFluidBuffer[\s\S]*slot\.fluidBuffer/, 'archive copies the authoritative completed fluid state into its reserved slot');
assert.match(source, /copyBufferToBuffer\(\s*sourceFrontBuffer[\s\S]*slot\.frontBuffer/, 'archive copies the authoritative completed front state into its reserved slot');
assert.match(source, /@binding\(1\) var<storage, read> fromFluid/, 'interpolator reads the lower completed fluid state');
assert.match(source, /@binding\(2\) var<storage, read> toFluid/, 'interpolator reads the upper completed fluid state');
assert.match(source, /@binding\(3\) var<storage, read_write> presentationFluid/, 'interpolator writes a separate presentation fluid buffer');
assert.match(source, /@binding\(4\) var<storage, read> fromFront/, 'interpolator reads the lower completed front state');
assert.match(source, /@binding\(5\) var<storage, read> toFront/, 'interpolator reads the upper completed front state');
assert.match(source, /@binding\(6\) var<storage, read_write> presentationFront/, 'interpolator writes a separate presentation front buffer');
assert.match(source, /mix\(fromFluid\[index\], toFluid\[index\], params\.alpha\)/, 'fluid presentation is linearly interpolated between adjacent completed states');
assert.match(source, /mix\(fromFront\[index\], toFront\[index\], params\.alpha\)/, 'front presentation is linearly interpolated between adjacent completed states');
assert.doesNotMatch(source, /dispatchWorkgroups\([^)]*gridSize[^)]*,[^)]*gridSize/, 'cadence runtime does not contain a second 3D simulator dispatch');
assert.match(source, /phaseSource:\s*ring\.phaseSource/, 'debug telemetry labels continuation history rather than prediction or independent simulation');
assert.match(source, /destroy\(\)[\s\S]*fluidBuffer\.destroy\(\)[\s\S]*frontBuffer\.destroy\(\)/, 'runtime destroys every exact-state slot buffer');

globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8 };
globalThis.GPUShaderStage = { COMPUTE: 1 };
const fakeDevice = {
  limits: {
    maxBufferSize: 4096,
    maxStorageBufferBindingSize: 4096,
  },
  queue: {
    writeBuffer() {},
    async onSubmittedWorkDone() {},
  },
  createBuffer({ label, size, usage }) {
    return { label, size, usage, destroy() {} };
  },
  createBindGroupLayout(descriptor) { return descriptor; },
  createPipelineLayout(descriptor) { return descriptor; },
  createShaderModule(descriptor) { return descriptor; },
  createComputePipeline(descriptor) { return descriptor; },
  createBindGroup(descriptor) { return descriptor; },
};
const fakeRuntime = runtime.createExactStateCadenceGpuRuntime({
  device: fakeDevice,
  fluidBytes: 64,
  frontBytes: 16,
  requestedDepth: 4,
  presentationDelaySteps: 2,
  stepDurationMs: 40,
  controlGeneration: 1,
});
const { recordCompletedExactState } = await import(new URL('../volume-exact-state-cadence-ring.mjs', import.meta.url));
for (let sourceStep = 1; sourceStep <= 4; sourceStep += 1) {
  assert.equal(recordCompletedExactState(fakeRuntime.ring, {
    sourceStep,
    completedAtMs: sourceStep * 10,
    controlGeneration: 1,
  }).ok, true);
}
const selected = fakeRuntime.selectPresentation({ nowMs: 1000 });
assert.equal(selected.ok, true);
const fakeEncoder = {
  beginComputePass() {
    return {
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups() {},
      end() {},
    };
  },
};
const encoded = fakeRuntime.encodePresentation(fakeEncoder, selected.receipt);
assert.equal(encoded.ok, true);
assert.equal(encoded.receipt.status, 'encoded-not-submitted', 'presentation telemetry cannot claim selection alone is encoded');
assert.equal(encoded.receipt.selectionStatus, 'selected');
assert.equal(fakeRuntime.debugState().lastSubmittedPresentationReceipt, null, 'encoding alone cannot become visible presentation authority');
const mismatchedSubmission = fakeRuntime.markPresentationSubmitted({
  ...encoded.receipt,
  sourcePosition: encoded.receipt.sourcePosition + 1,
}, 1000);
assert.equal(mismatchedSubmission.ok, false, 'an arbitrary encoded receipt cannot impersonate the command buffer just encoded');
assert.equal(mismatchedSubmission.reason, 'exact-state-presentation-submission-receipt-mismatch');
const submitted = fakeRuntime.markPresentationSubmitted(encoded.receipt, 1001);
assert.equal(submitted.ok, true);
assert.equal(submitted.receipt.status, 'submitted-visible');
assert.equal(submitted.receipt.encodedStatus, 'encoded-not-submitted');
assert.equal(submitted.receipt.sourcePosition, encoded.receipt.sourcePosition);
assert.deepEqual(fakeRuntime.debugState().lastSubmittedPresentationReceipt, submitted.receipt);
const debugSnapshot = fakeRuntime.debugState();
debugSnapshot.lastSubmittedPresentationReceipt.sourcePosition += 100;
assert.equal(
  fakeRuntime.debugState().lastSubmittedPresentationReceipt.sourcePosition,
  submitted.receipt.sourcePosition,
  'mutating debug telemetry cannot forge the private submitted presentation authority',
);
fakeRuntime.reset({ controlGeneration: 2, reason: 'test-reset' });
assert.equal(fakeRuntime.debugState().lastPresentationReceipt, null, 'reset clears stale encoded presentation identity');
assert.equal(fakeRuntime.debugState().lastSubmittedPresentationReceipt, null, 'reset clears stale visible presentation identity');

console.log('exact-state cadence GPU contracts passed');
