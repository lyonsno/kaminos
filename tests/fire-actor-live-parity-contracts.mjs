import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const contractPath = join(root, 'fire-actor-live-parity-contract.mjs');
assert.ok(existsSync(contractPath), 'shared promoted-fire live parity contract must exist');

const {
  FIRE_ACTOR_LIVE_PARITY_ARMS,
  createFireActorLiveParityDescriptor,
  validateFireActorLiveParityReceipt,
} = await import('../fire-actor-live-parity-contract.mjs');
const { recoverQuantizedGpuStageTiming } = await import('../fire-actor-live-parity-browser.mjs');

assert.deepEqual(FIRE_ACTOR_LIVE_PARITY_ARMS, ['splats', 'smoke', 'composite']);
const descriptor = await createFireActorLiveParityDescriptor();
assert.equal(descriptor.schema, 'kaminos.fire-actor-live-parity-descriptor.v1');
assert.match(descriptor.descriptorId, /^fireparity-[a-f0-9]{64}$/);
assert.equal(descriptor.basin.revision, 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95');
assert.equal(descriptor.engine.sha256, 'ab0af0ee9abe11a2495e880a9986179727a6027217ce9768299ec3e43114b7ab');
assert.equal(descriptor.state.targetSimStep, 120);
assert.equal(descriptor.state.pauseAuthority, 'renderer-internal-exact-sim-step-pause-gpu-complete-v0');
assert.deepEqual(descriptor.camera.position, [1.65, 0.42, 3.15]);
assert.deepEqual(descriptor.camera.target, [0, 0.08, 0]);
assert.deepEqual(descriptor.actor.transform, { translate: [0, 0, 0], scale: 1 });
const pinnedPackage = JSON.parse(readFileSync(join(
  root,
  'artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/revisions/basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95/package.json',
), 'utf8'));
assert.deepEqual(descriptor.controls, {
  basin: Object.keys(pinnedPackage.settingsPreset.artifact.preset.domControls).length,
  renderer: Object.keys(pinnedPackage.settingsPreset.artifact.preset.rendererControls).length,
}, 'the parity descriptor preserves the exact immutable package inventory instead of borrowing the current cockpit schema count');

const receipt = {
  schema: 'kaminos.fire-actor-live-parity-receipt.v1',
  status: 'effective',
  surface: 'cockpit',
  descriptorId: descriptor.descriptorId,
  basin: structuredClone(descriptor.basin),
  engine: structuredClone(descriptor.engine),
  state: {
    requestedSimStep: 120,
    effectiveSimStep: 120,
    paused: true,
    gpuComplete: true,
    pauseAuthority: descriptor.state.pauseAuthority,
    controlsSignature: descriptor.state.controlsSignature,
    deterministicClock: structuredClone(descriptor.state.deterministicClock),
  },
  camera: structuredClone(descriptor.camera),
  actor: structuredClone(descriptor.actor),
  viewport: { cssWidth: 960, cssHeight: 720, backingWidth: 1920, backingHeight: 1440, dpr: 2 },
  presentation: { arm: 'composite', smoke: 'on', splats: 'on', composition: 'smoke-raymarch-under-splats-v0' },
  controls: structuredClone(descriptor.controls),
  fallbackReason: null,
  gpuStageTiming: {
    identity: 'selective-head-live-arm-gpu-timestamp-profile-v0',
    timestampStatus: 'available',
    reason: 'timestamp-query-sampled',
    aggregationAuthority: 'independent-pass-intervals-may-overlap-total-is-envelope-not-sum-v0',
    sample: {
      authority: 'same-state-selective-render-composition-gpu-timestamp-v0',
      arm: 'composite',
      simStepCount: 120,
      advanceSim: false,
      presentation: { arm: 'composite', smoke: 'on', splats: 'on', composition: 'smoke-raymarch-under-splats-v0' },
    },
    stages: Object.fromEntries([
      'simulation', 'sidecar', 'compaction', 'finalize', 'candidateCopy',
      'indirectSetup', 'splatRaster', 'matchedRaymarchRaster', 'total',
    ].map(name => [name, {
      status: name === 'simulation' ? 'not-run-frozen-state' : (name === 'candidateCopy' ? 'removed' : 'sampled'),
      ms: name === 'candidateCopy' || name === 'simulation' ? 0 : 1,
    }])),
  },
};
assert.doesNotThrow(() => validateFireActorLiveParityReceipt(receipt, descriptor));

const quantizedIndirectSetupReceipt = structuredClone(receipt);
quantizedIndirectSetupReceipt.gpuStageTiming.stages.indirectSetup = {
  status: 'quantized-below-resolution',
  ms: 0,
  rawStartNs: '24063383240704',
  rawEndNs: '24063383175168',
  quantizationAuthority: 'implementation-defined-webgpu-timestamp-query-quantization-v0',
};
assert.doesNotThrow(
  () => validateFireActorLiveParityReceipt(quantizedIndirectSetupReceipt, descriptor),
  'a sub-resolution copy interval remains explicit without invalidating real pass timing',
);
const recoveredTiming = recoverQuantizedGpuStageTiming(
  { reason: 'timestamp-query-nonmonotonic:1000000,1200000,1300000,1500000,1500000,1500000,1490000,1480000,1600000,2000000' },
  { arm: 'splats', smoke: 'off', splats: 'on', composition: 'splat-only-v0' },
  'splats',
  120,
);
assert.deepEqual(recoveredTiming.stages.indirectSetup, {
  status: 'quantized-below-resolution',
  ms: 0,
  rawStartNs: '1490000',
  rawEndNs: '1480000',
  quantizationAuthority: 'implementation-defined-webgpu-timestamp-query-quantization-v0',
});
assert.equal(recoveredTiming.stages.total.ms, 1);
assert.equal(
  recoverQuantizedGpuStageTiming(
    { reason: 'timestamp-query-nonmonotonic:1000000,900000,1300000,1500000,1500000,1500000,1490000,1480000,1600000,2000000' },
    { arm: 'splats', smoke: 'off', splats: 'on', composition: 'splat-only-v0' },
    'splats',
    120,
  ),
  null,
  'a reversed real pass remains a hard timing failure',
);

for (const [name, mutate, pattern] of [
  ['wrong step', value => { value.state.effectiveSimStep = 121; }, /simulation step/],
  ['not paused', value => { value.state.paused = false; }, /GPU-complete pause/],
  ['wrong camera', value => { value.camera.fov = 41; }, /camera/],
  ['wrong actor', value => { value.actor.transform.scale = 1.1; }, /actor/],
  ['fallback', value => { value.fallbackReason = 'ordinary-renderer'; }, /fallback/],
  ['wrong arm', value => { value.presentation.arm = 'beauty'; }, /presentation arm/],
  ['missing GPU timing', value => { value.gpuStageTiming = null; }, /GPU stage timing/],
  ['unsampled GPU timing', value => { value.gpuStageTiming.stages.splatRaster.status = 'not-sampled'; }, /GPU stage timing/],
  ['stale GPU timing step', value => { value.gpuStageTiming.sample.simStepCount = 119; }, /GPU stage timing sample/],
  ['wrong GPU timing arm', value => { value.gpuStageTiming.sample.arm = 'smoke'; }, /GPU stage timing sample/],
  ['advancing GPU timing sample', value => { value.gpuStageTiming.sample.advanceSim = true; }, /GPU stage timing sample/],
  ['missing timing aggregation authority', value => { delete value.gpuStageTiming.aggregationAuthority; }, /GPU stage timing/],
  ['unattributed quantized interval', value => {
    value.gpuStageTiming.stages.indirectSetup = structuredClone(quantizedIndirectSetupReceipt.gpuStageTiming.stages.indirectSetup);
    delete value.gpuStageTiming.stages.indirectSetup.quantizationAuthority;
  }, /GPU stage timing/],
]) {
  const candidate = structuredClone(receipt);
  mutate(candidate);
  assert.throws(() => validateFireActorLiveParityReceipt(candidate, descriptor), pattern, name);
}

const index = readFileSync(join(root, 'index.html'), 'utf8');
const browserContract = readFileSync(join(root, 'fire-actor-live-parity-browser.mjs'), 'utf8');
const volumeCore = readFileSync(join(root, 'volume-core.js'), 'utf8');
assert.match(
  volumeCore,
  /'smoke-raymarch-only-v0'[\s\S]*?raymarch:\s*true,[\s\S]*?splat:\s*false,[\s\S]*?raymarchFireAuthority:\s*0/,
  'smoke-only parity arm must raymarch broad smoke without raymarched or splatted fire',
);
assert.match(volumeCore, /stepSelectiveHeadLiveCaptureFrame\(options\s*=\s*\{\}\)[\s\S]*?render\(sampleNow\)/, 'deterministic parity stepping supplies an explicit simulation clock');
assert.match(
  volumeCore,
  /encodeSim\(encoder,\s*\{[\s\S]*?finalTimestampWrites:[\s\S]*?endOfPassWriteIndex:\s*0[\s\S]*?encodeSim\(encoder,\s*\{[\s\S]*?finalTimestampWrites:[\s\S]*?endOfPassWriteIndex:\s*1/,
  'GPU profile measures simulation between two complete real simulation endpoints',
);
assert.match(
  volumeCore,
  /compactTimestampWrites:[\s\S]*?endOfPassWriteIndex:\s*3[\s\S]*?finalizeTimestampWrites:[\s\S]*?endOfPassWriteIndex:\s*4[\s\S]*?encodeBoundarySplatDraw\([\s\S]*?endOfPassWriteIndex:\s*5/,
  'GPU profile uses real compaction, finalize, and raster pass endpoints',
);
assert.match(index, /window\.kaminosFireActorParity\s*=/, 'cockpit exposes the shared live parity API');
assert.match(index, /id="volume-steps"[^>]+step="1"/, 'cockpit ray-step slider must preserve caller-selected integer counts without rounding');
assert.match(index, /verifyFireActorParityPackage/, 'cockpit parity verifies the canonical package without a machine-local preset dependency');
assert.match(index, /verifyFireActorParityEngine/, 'cockpit parity hashes the engine module served by its live route');
assert.match(browserContract, /pauseAtExactStep/, 'cockpit parity uses exact-step GPU-complete pause');
assert.match(browserContract, /sampleDeterministicReplayFrame/, 'cockpit parity settles through the engine deterministic replay path');
assert.match(browserContract, /setArm/, 'cockpit parity exposes live presentation arms');
assert.match(browserContract, /captureSelectiveHeadLiveFrame[\s\S]*advanceSim:\s*false[\s\S]*presentToCanvas:\s*true/, 'arm switching presents the frozen state instead of changing receipts only');
assert.match(browserContract, /captureSelectiveHeadLiveFrame[\s\S]*collectGpuTiming:\s*true/, 'each arm samples its own frozen presented frame GPU timing');
assert.match(browserContract, /implementation-defined-webgpu-timestamp-query-quantization-v0/, 'sub-resolution copy timing remains explicit instead of being silently clamped');
assert.match(browserContract, /applyCamera/, 'cockpit parity accepts exact camera transfer');
assert.match(browserContract, /kaminos-fire-parity-command/, 'cockpit parity accepts workbench postMessage commands');

console.log('promoted fire actor live parity contracts passed');
