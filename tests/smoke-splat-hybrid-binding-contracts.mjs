import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const sourceModule = await import(new URL('../smoke-splat-motion-source.mjs', import.meta.url));

assert.equal(
  typeof sourceModule.buildPhaseMatchedHybridSmokePlan,
  'function',
  'the accepted motion source must expose an explicit flame-to-smoke phase binding plan',
);

const products = [
  {
    identity: 'smoke:older',
    slotIdentity: { historySlot: 0, slotWriteTick: 96, simulatorGeneration: 1, modelIdentity: 'target:v0' },
    hierarchyCounts: { coarse: 1, fine: 1, total: 2 },
    splats: [
      { index: 0, hierarchyRoleCode: 0, extinctionMass: 0.6 },
      { index: 1, hierarchyRoleCode: 1, extinctionMass: 0.4 },
    ],
  },
  {
    identity: 'smoke:latest',
    slotIdentity: { historySlot: 1, slotWriteTick: 97, simulatorGeneration: 1, modelIdentity: 'learned:v0' },
    hierarchyCounts: { coarse: 1, fine: 1, total: 2 },
    splats: [
      { index: 0, hierarchyRoleCode: 0, extinctionMass: 0.7 },
      { index: 1, hierarchyRoleCode: 1, extinctionMass: 0.3 },
    ],
  },
];

const instances = Array.from({ length: 257 }, (_, index) => ({
  identity: 'boundary-splat-instance-descriptor-v0',
  index,
  phaseHistoryOffsetSlots: index % 2,
  transform: { translate: [index * 0.01, 0, 0], scale: 0.5 },
}));

const plan = sourceModule.buildPhaseMatchedHybridSmokePlan({
  products,
  flameInstances: instances,
  fineLodFraction: 0,
  requestedRoute: 'spatial-strata-hybrid-smoke-v0',
  effectiveRoute: 'spatial-strata-hybrid-smoke-v0',
});

assert.equal(plan.identity, 'phase-matched-spatial-strata-hybrid-plan-v0');
assert.equal(plan.status, 'bound');
assert.equal(plan.temporalHorizonProducts, 2);
assert.equal(plan.latestSlotWriteTick, 97);
assert.equal(plan.oldestSlotWriteTick, 96);
assert.equal(plan.flameInstanceCount, 257, 'the caller-owned instance count must remain uncapped');
assert.equal(plan.instanceBindings.length, 257);
assert.equal(plan.productUploads.length, 2, 'GPU uploads scale with unique temporal products');
assert.equal(plan.productUploads.every(upload => upload.coarseCount === 1), true, 'coarse transport survives fine LOD removal');
assert.equal(plan.rejectedExtinctionMass, 0);
assert.equal(plan.instanceBindings[0].relativeAgeSlots, 0);
assert.equal(plan.instanceBindings[0].productIdentity, 'smoke:latest');
assert.equal(plan.instanceBindings[1].relativeAgeSlots, 1);
assert.equal(plan.instanceBindings[1].productIdentity, 'smoke:older');
assert.equal(plan.instanceBindings[256].instanceIndex, 256);
assert.equal(plan.instanceBindings[256].productIdentity, 'smoke:latest');
assert.equal(plan.requestedRoute, plan.effectiveRoute);

assert.throws(
  () => sourceModule.buildPhaseMatchedHybridSmokePlan({
    products,
    flameInstances: [{ ...instances[0], phaseHistoryOffsetSlots: 2 }],
    requestedRoute: 'spatial-strata-hybrid-smoke-v0',
    effectiveRoute: 'spatial-strata-hybrid-smoke-v0',
  }),
  /relative age 2 exceeds the 2-product temporal horizon/i,
  'an unavailable phase must fail instead of substituting shared-current smoke',
);

assert.throws(
  () => sourceModule.buildPhaseMatchedHybridSmokePlan({
    products: [products[0], { ...products[1], slotIdentity: { ...products[1].slotIdentity, slotWriteTick: 99 } }],
    flameInstances: instances.slice(0, 1),
    requestedRoute: 'spatial-strata-hybrid-smoke-v0',
    effectiveRoute: 'spatial-strata-hybrid-smoke-v0',
  }),
  /consecutive/i,
  'a missing temporal product cannot masquerade as coherent phase motion',
);

assert.throws(
  () => sourceModule.buildPhaseMatchedHybridSmokePlan({
    products,
    flameInstances: instances.slice(0, 1),
    requestedRoute: 'spatial-strata-hybrid-smoke-v0',
    effectiveRoute: 'raymarched-smoke-fallback-v0',
  }),
  /requested and effective hybrid route mismatch/i,
  'fallback rendering cannot present as the requested spatial-strata witness',
);

assert.throws(
  () => sourceModule.buildPhaseMatchedHybridSmokePlan({
    products,
    flameInstances: [{ ...instances[0], index: 4 }],
    requestedRoute: 'spatial-strata-hybrid-smoke-v0',
    effectiveRoute: 'spatial-strata-hybrid-smoke-v0',
  }),
  /dense descriptor index/i,
  'caller indices cannot address beyond the allocated packed descriptor array',
);

assert.throws(
  () => sourceModule.assessControlledHybridSmokeMotion({
    sameTimeRepeatMeanAbsDiff: 0,
    simulatorStepCounts: [40, 41],
    controlledTimesMs: [1000, 1500],
    rendererElapsedSeconds: [1, 1.5],
    frameHashes: ['a', 'b'],
    adjacentMeanAbsDiffs: [2],
    flameControlMeanAbsDiffs: [0],
  }),
  /simulator state moved/i,
  'moving flames cannot impersonate accepted smoke motion',
);

assert.throws(
  () => sourceModule.assessControlledHybridSmokeMotion({
    sameTimeRepeatMeanAbsDiff: 0,
    simulatorStepCounts: [40, 40],
    controlledTimesMs: [1000, 1500],
    rendererElapsedSeconds: [1, 1.5],
    frameHashes: ['a', 'a'],
    adjacentMeanAbsDiffs: [0],
    flameControlMeanAbsDiffs: [0],
  }),
  /smoke did not move/i,
  'a frozen or cached smoke layer must fail with flame state held fixed',
);

assert.deepEqual(
  sourceModule.assessControlledHybridSmokeMotion({
    sameTimeRepeatMeanAbsDiff: 0,
    simulatorStepCounts: [40, 40, 40],
    controlledTimesMs: [1000, 1500, 2000],
    rendererElapsedSeconds: [1, 1.5, 2],
    frameHashes: ['a', 'b', 'c'],
    adjacentMeanAbsDiffs: [0.25, 0.4],
    flameControlMeanAbsDiffs: [0, 0],
  }),
  {
    status: 'passed',
    authority: 'frozen-simulator-controlled-smoke-time-pixel-delta-v0',
    simulatorStepCount: 40,
    controlledDurationMs: 1000,
    uniqueFrameHashCount: 3,
    maxMeanAbsDiff: 0.4,
    sameTimeRepeatMeanAbsDiff: 0,
    maxFlameControlMeanAbsDiff: 0,
  },
  'controlled smoke motion requires frozen simulation, deterministic repeat, and explicit-time pixel deltas',
);

assert.throws(
  () => sourceModule.assessControlledHybridSmokeMotion({
    sameTimeRepeatMeanAbsDiff: 0,
    simulatorStepCounts: [40, 40],
    controlledTimesMs: [1000, 1500],
    rendererElapsedSeconds: [1, 1.6],
    frameHashes: ['a', 'b'],
    adjacentMeanAbsDiffs: [0.4],
    flameControlMeanAbsDiffs: [0],
  }),
  /renderer elapsed time disagreement/i,
  'declared controlled time cannot stand in for the time consumed by the renderer',
);

assert.throws(
  () => sourceModule.assessControlledHybridSmokeMotion({
    sameTimeRepeatMeanAbsDiff: 0,
    simulatorStepCounts: [40, 40],
    controlledTimesMs: [1000, 1500],
    rendererElapsedSeconds: [1, 1.5],
    frameHashes: ['a', 'b'],
    adjacentMeanAbsDiffs: [0.4],
    flameControlMeanAbsDiffs: [0.3],
  }),
  /flame control moved/i,
  'moving flame pixels cannot satisfy a smoke-only motion claim at fixed simulator count',
);

assert.throws(
  () => sourceModule.assessControlledHybridSmokeMotion({
    sameTimeRepeatMeanAbsDiff: 0.03,
    simulatorStepCounts: [40, 40],
    controlledTimesMs: [1000, 1500],
    rendererElapsedSeconds: [1, 1.5],
    frameHashes: ['a', 'b'],
    adjacentMeanAbsDiffs: [0.4],
    flameControlMeanAbsDiffs: [0],
  }),
  /same-time smoke determinism failed/i,
  'hybrid same-time determinism uses the measured near-zero envelope rather than a permissive image threshold',
);

const lifecycleModule = await import(
  new URL('../spatial-strata-hybrid-smoke-source-lifecycle.mjs', import.meta.url)
);
const configA = {
  manifestUrl: './a.json',
  fineLodFraction: 1,
  coarseCoverageScale: 1.8,
  motionRate: 0.16,
};
const configB = { ...configA, manifestUrl: './b.json' };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
};
const loadCalls = [];
const createCalls = [];
const pendingLoads = [];
const lifecycle = lifecycleModule.createSpatialStrataHybridSmokeSourceLifecycle({
  loadSource(config) {
    loadCalls.push(lifecycleModule.spatialStrataHybridSmokeConfigIdentity(config));
    const next = deferred();
    pendingLoads.push(next);
    return next.promise;
  },
  createRenderer(source, config) {
    const renderer = {
      source,
      config,
      disposed: false,
      dispose() { this.disposed = true; },
    };
    createCalls.push(renderer);
    return renderer;
  },
});

const loadA = lifecycle.ensure(configA);
pendingLoads.shift().resolve({ identity: 'source-a' });
const rendererA = await loadA;
assert.equal(lifecycle.currentRenderer(configA), rendererA);

const failingB = lifecycle.ensure(configB);
assert.equal(lifecycle.currentRenderer(configB), null, 'replacement detaches source A before source B resolves');
assert.equal(rendererA.disposed, true, 'replacement disposes the stale source renderer immediately');
pendingLoads.shift().reject(new Error('source b unavailable'));
await assert.rejects(failingB, /source b unavailable/);
assert.equal(lifecycle.currentRenderer(configB), null, 'failed source B cannot alias the old source A renderer');

const retryB = lifecycle.ensure(configB);
pendingLoads.shift().resolve({ identity: 'source-b' });
const rendererB = await retryB;
assert.equal(lifecycle.currentRenderer(configB), rendererB, 'failed replacement remains retryable');

const reconfiguredB = { ...configB, fineLodFraction: 0.5 };
const reloadB = lifecycle.ensure(reconfiguredB);
assert.equal(lifecycle.currentRenderer(reconfiguredB), null, 'constructor-owned control changes invalidate the old renderer');
pendingLoads.shift().resolve({ identity: 'source-b-reconfigured' });
const rendererB2 = await reloadB;
assert.notEqual(rendererB2, rendererB);
assert.equal(rendererB.disposed, true);
assert.equal(loadCalls.length, 4, 'A, failed B, retried B, and reconfigured B each load under distinct generations');

const lateCreate = deferred();
const lateLifecycle = lifecycleModule.createSpatialStrataHybridSmokeSourceLifecycle({
  async loadSource() { return { identity: 'late-source' }; },
  createRenderer() { return lateCreate.promise; },
});
const lateEnsure = lateLifecycle.ensure(configA);
await Promise.resolve();
lateLifecycle.dispose();
const lateRenderer = { disposed: false, dispose() { this.disposed = true; } };
lateCreate.resolve(lateRenderer);
assert.equal(await lateEnsure, null, 'a completion after disposal cannot install a renderer');
assert.equal(lateRenderer.disposed, true, 'a renderer created after disposal is destroyed immediately');
assert.equal(lateLifecycle.currentRenderer(configA), null);

async function exerciseOverlappingRuntime({ rejectStale }) {
  const loads = [];
  const lifecycle = lifecycleModule.createSpatialStrataHybridSmokeSourceLifecycle({
    loadSource() {
      const next = deferred();
      loads.push(next);
      return next.promise;
    },
    createRenderer(source) {
      return { source, disposed: false, dispose() { this.disposed = true; } };
    },
  });
  let currentConfig = configA;
  const publications = [];
  const runtime = lifecycleModule.createSpatialStrataHybridSmokeSourceRuntime({
    lifecycle,
    getCurrentConfig: () => currentConfig,
    publishState: state => publications.push(state),
  });
  const staleA = runtime.ensure(configA);
  currentConfig = configB;
  const currentB = runtime.ensure(configB);
  loads[1].resolve({ identity: 'new-b' });
  const rendererB = await currentB;
  assert.equal(runtime.currentRenderer(), rendererB);
  if (rejectStale) loads[0].reject(new Error('late a failed'));
  else loads[0].resolve({ identity: 'late-a' });
  assert.equal(await staleA, rendererB, 'a stale completion resolves to current B without taking write authority');
  assert.equal(runtime.currentRenderer(), rendererB, 'late A cannot clear current B');
  assert.equal(publications.at(-1).lifecycle.status, 'loaded');
  assert.equal(publications.at(-1).renderer, rendererB);
}

await exerciseOverlappingRuntime({ rejectStale: false });
await exerciseOverlappingRuntime({ rejectStale: true });

const disposeLoads = [];
const disposeLifecycle = lifecycleModule.createSpatialStrataHybridSmokeSourceLifecycle({
  loadSource() {
    const next = deferred();
    disposeLoads.push(next);
    return next.promise;
  },
  createRenderer(source) { return { source, dispose() {} }; },
});
const disposePublications = [];
const disposeRuntime = lifecycleModule.createSpatialStrataHybridSmokeSourceRuntime({
  lifecycle: disposeLifecycle,
  getCurrentConfig: () => configA,
  publishState: state => disposePublications.push(state),
});
const disposedEnsure = disposeRuntime.ensure(configA);
disposeRuntime.dispose();
disposeLoads[0].resolve({ identity: 'too-late' });
assert.equal(await disposedEnsure, null);
assert.equal(disposeRuntime.currentRenderer(), null);
assert.equal(disposePublications.at(-1).lifecycle.status, 'disposed');

const witnessContracts = await import(
  new URL('../spatial-strata-hybrid-smoke-witness-contracts.mjs', import.meta.url)
);
const validWitnessUrl = 'http://127.0.0.1:8237/?volume_hybrid_smoke_representation=spatial-strata&volume_hybrid_smoke_manifest=.%2Fsmoke.json&volume_hybrid_smoke_fine_lod=1&volume_hybrid_smoke_motion_rate=0.16&volume_hybrid_smoke_coarse_coverage=1.8';
const requestedWitnessConfig = witnessContracts.parseSpatialStrataHybridSmokeWitnessRequest(validWitnessUrl);
assert.equal(requestedWitnessConfig.manifestUrl, './smoke.json');
assert.equal(requestedWitnessConfig.motionRate, 0.16);
assert.throws(
  () => witnessContracts.parseSpatialStrataHybridSmokeWitnessRequest(validWitnessUrl.replace('0.16', 'bogus')),
  /motion rate.*finite/i,
  'malformed numeric request values fail instead of silently normalizing to defaults',
);
assert.throws(
  () => witnessContracts.requirePositiveHybridWitnessWallDelay(0),
  /positive wall delay/i,
  'same-time determinism authority requires a real wall delay',
);
witnessContracts.requirePositiveHybridWitnessWallDelay(300);
const effectiveIdentity = JSON.stringify({
  manifestUrl: './smoke.json',
  fineLodFraction: 1,
  coarseCoverageScale: 1.8,
  motionRate: 0.16,
});
assert.doesNotThrow(() => witnessContracts.validateSpatialStrataHybridSmokeWitnessConfig({
  requested: requestedWitnessConfig,
  lifecycle: { status: 'loaded', hasRenderer: true, requestedConfigIdentity: effectiveIdentity, effectiveConfigIdentity: effectiveIdentity },
}));
assert.throws(
  () => witnessContracts.validateSpatialStrataHybridSmokeWitnessConfig({
    requested: requestedWitnessConfig,
    lifecycle: {
      status: 'loaded',
      hasRenderer: true,
      requestedConfigIdentity: effectiveIdentity,
      effectiveConfigIdentity: effectiveIdentity.replace('0.16', '0.2'),
    },
  }),
  /requested and effective smoke config mismatch/i,
);
assert.equal(
  witnessContracts.deriveSpatialStrataHybridSmokeEffectiveRoute([
    { spatialStrataHybridSmokeDebug: { identity: 'phase-matched-spatial-strata-front-back-raster-v0', requestedRoute: 'spatial-strata-hybrid-smoke-v0', effectiveRoute: 'spatial-strata-hybrid-smoke-v0' } },
    { spatialStrataHybridSmokeDebug: { identity: 'phase-matched-spatial-strata-front-back-raster-v0', requestedRoute: 'spatial-strata-hybrid-smoke-v0', effectiveRoute: 'spatial-strata-hybrid-smoke-v0' } },
  ]),
  'spatial-strata-hybrid-smoke-v0',
);
assert.throws(
  () => witnessContracts.deriveSpatialStrataHybridSmokeEffectiveRoute([
    { spatialStrataHybridSmokeDebug: { identity: 'phase-matched-spatial-strata-front-back-raster-v0', requestedRoute: 'spatial-strata-hybrid-smoke-v0', effectiveRoute: 'fallback' } },
  ]),
  /nested smoke route mismatch/i,
);
assert.equal(
  witnessContracts.requireHybridWitnessArtifactPath({ evidenceRoot: '/repo', bundleRoot: '/repo/artifacts/run', artifact: '/repo/artifacts/run/frame.png' }),
  '/repo/artifacts/run/frame.png',
);
assert.throws(
  () => witnessContracts.requireHybridWitnessArtifactPath({ evidenceRoot: '/repo', bundleRoot: '/tmp/run', artifact: '/tmp/run/frame.png' }),
  /outside evidence root/i,
);
assert.throws(
  () => witnessContracts.requireHybridWitnessArtifactPath({ evidenceRoot: '/repo', bundleRoot: '/repo/artifacts/run', artifact: '/repo/other.png' }),
  /outside witness bundle/i,
);

const containmentProbeRoot = await mkdtemp(join(tmpdir(), 'kaminos-hybrid-containment-'));
const containmentProbeBundle = join(containmentProbeRoot, 'bundle');
const containmentProbeReport = join(
  dirname(containmentProbeRoot),
  `${basename(containmentProbeRoot)}-outside-report.json`,
);
try {
  await rm(containmentProbeReport, { force: true });
  const containmentProbe = spawnSync(process.execPath, [
    new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url).pathname,
    '--url', validWitnessUrl,
    '--out-dir', containmentProbeBundle,
    '--report', containmentProbeReport,
    '--evidence-root', containmentProbeRoot,
    '--hybrid-only',
    '--wall-step-ms', '0',
  ], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
  });
  assert.notEqual(containmentProbe.status, 0, 'an invalid hybrid startup request must fail');
  assert.match(
    containmentProbe.stderr,
    /"status": "skipped-unvalidated-path"/,
    'the failure receipt must say that an unvalidated report path was not written',
  );
  await assert.rejects(
    access(containmentProbeReport),
    /ENOENT/,
    'an early startup failure must not write a caller-supplied report outside the evidence root',
  );
} finally {
  await rm(containmentProbeRoot, { recursive: true, force: true });
  await rm(containmentProbeReport, { force: true });
}

const rendererModuleSource = await readFile(
  new URL('../spatial-strata-hybrid-smoke-renderer.mjs', import.meta.url),
  'utf8',
).catch(() => '');
const volumeCoreSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const volumeWitnessSource = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');

assert.match(
  rendererModuleSource,
  /export function createSpatialStrataHybridSmokeRenderer/,
  'the spatial-strata GPU layer must be an explicit reusable renderer boundary',
);
assert.match(rendererModuleSource, /array<PackedSplat>/, 'the layer consumes reviewed packed hierarchy products on GPU');
assert.match(rendererModuleSource, /hybridSplatDepthMoments/, 'smoke fragments classify against learned-flame depth');
assert.match(rendererModuleSource, /frontColor[\s\S]*frontInterval[\s\S]*backColor[\s\S]*backInterval/, 'the layer emits all four compositor attachments');
assert.match(rendererModuleSource, /draw\(6, plan\.drawInstanceCount\)/, 'the GPU draw count comes from the uncapped phase plan');
assert.match(rendererModuleSource, /phaseBindingSignature/, 'camera-only frames reuse the static product\/phase plan instead of repacking products');
assert.doesNotMatch(rendererModuleSource, /MAX_(?:INSTANCE|SPLAT)|Math\.min\([^\n]*flameInstanceCount/, 'the layer must not hide an instance or splat cap');
assert.match(volumeCoreSource, /SPATIAL_STRATA_HYBRID_SMOKE_ROUTE_IDENTITY/, 'volume runtime publishes the effective spatial-strata route identity');
assert.match(volumeCoreSource, /createSpatialStrataHybridSmokeRenderer/, 'volume runtime owns the smoke layer lifecycle');
assert.match(volumeCoreSource, /encodeSpatialStrataSmoke/, 'the existing hybrid pass can select the packed smoke layer');
assert.match(pageSource, /two-phase-alternating/, 'the witness route exposes exact age-0\/age-1 flame descriptors');
assert.match(pageSource, /volume_hybrid_smoke_manifest/, 'the evidence manifest path is invocation-owned');
assert.match(volumeWitnessSource, /--hybrid-only/, 'the reusable volume witness can capture the hybrid route without substituting A\/B modes');
assert.match(volumeWitnessSource, /hybridSmokeRepresentationEffective/, 'hybrid witness receipts preserve the effective smoke representation');
assert.match(volumeWitnessSource, /spatialStrataHybridSmokeSourceStatus/, 'hybrid witness receipts fail loud on missing or partial source load');
assert.match(volumeWitnessSource, /spatialStrataHybridSmokeSourceLifecycle/, 'hybrid witness preserves generation-keyed requested and effective source config identity');
assert.match(volumeWitnessSource, /cached or static hybrid output/i, 'hybrid motion proof rejects static or cached frame sequences');
assert.match(volumeWitnessSource, /advanceSim:\s*!hybridOnly\s*&&\s*frameIndex\s*>\s*0/, 'hybrid capture freezes simulator and learned-flame state');
assert.match(volumeWitnessSource, /hybrid-spatial-strata-determinism-repeat/, 'hybrid capture measures a same-time wall-delay repeat');
assert.match(volumeWitnessSource, /path:\s*artifactPath\(imagePath\)/, 'durable witness image references are repo-relative rather than worktree-absolute');
assert.match(volumeWitnessSource, /status:\s*'failed'[\s\S]*failurePhase/, 'the witness preserves a durable report when failure precedes primary output');

globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 };
const { createSpatialStrataHybridSmokeRenderer } = await import(
  new URL('../spatial-strata-hybrid-smoke-renderer.mjs', import.meta.url)
);
const bufferWrites = [];
const fakeDevice = {
  queue: {
    writeBuffer(buffer) { bufferWrites.push(buffer.label); },
  },
  createBuffer(descriptor) {
    const mapped = new ArrayBuffer(descriptor.size);
    return {
      label: descriptor.label,
      destroy() {},
      getMappedRange() { return mapped; },
      unmap() {},
    };
  },
  createShaderModule(descriptor) { return descriptor; },
  createRenderPipeline() {
    return { getBindGroupLayout() { return {}; } };
  },
};
const packedProduct = (identity, tick) => ({
  identity,
  slotIdentity: { historySlot: tick % 2, slotWriteTick: tick, simulatorGeneration: 1, modelIdentity: identity },
  hierarchyCounts: { coarse: 1, fine: 0, total: 1 },
  packed: new Float32Array([
    0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.1, 0.5, 0.25, 0.1, 0, 0.2, 0, 0,
  ]),
  splats: [{ index: 0, hierarchyRoleCode: 0, extinctionMass: 0.5 }],
});
const fakeRenderer = createSpatialStrataHybridSmokeRenderer({
  device: fakeDevice,
  products: [packedProduct('smoke:96', 96), packedProduct('smoke:97', 97)],
});
const repeatedUpdate = {
  flameInstances: [{ index: 0, phaseHistoryOffsetSlots: 0, transform: { translate: [0, 0, 0], scale: 1 } }],
  viewProj: new Float32Array(16),
  cameraMatrix: new Float32Array(16),
  cameraPosition: [0, 0, 4],
  elapsedSeconds: 1,
};
fakeRenderer.update(repeatedUpdate);
fakeRenderer.update({ ...repeatedUpdate, elapsedSeconds: 2 });
assert.equal(
  bufferWrites.filter(label => label === 'kaminos phase-matched spatial-strata smoke descriptors').length,
  1,
  'camera/time-only updates must not re-upload unchanged phase descriptors',
);
assert.equal(
  bufferWrites.filter(label => label === 'kaminos spatial-strata hybrid smoke uniforms').length,
  2,
  'camera/time uniforms still update on every frame',
);
fakeRenderer.dispose();

console.log('smoke splat hybrid binding contracts passed');
