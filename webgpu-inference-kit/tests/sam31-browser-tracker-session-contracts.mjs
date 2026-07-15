import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as kit from '../src/index.js';
import { createSam31BrowserTrackerSessionForTest } from '../src/sam31-browser-tracker-session.js';
import {
  createSam31BrowserTrackerPackageAuthority,
  deriveSam31BrowserTrackerExecutionContracts,
} from '../src/sam31-browser-tracker-session-driver.js';

assert.equal(kit.SAM31_BROWSER_TRACKER_SESSION_SCHEMA, 'kaminos.sam31-browser-tracker-session.v0');
assert.equal(typeof kit.createSam31BrowserTrackerSession, 'function', 'the inference kit must export the package-backed tracker session');
assert.equal(typeof kit.runSam31TwoImageBackbone, 'function', 'the inference kit must export the promoted two-image backbone');
assert.equal(typeof kit.runSam31BrowserTrackerPackageInvocation, 'function', 'the inference kit must export the package-backed invocation driver');
assert.equal(typeof kit.evaluateSam31TrackerDownstreamParity, 'function', 'the inference kit must export the compound downstream parity evaluator');
assert.equal(typeof kit.evaluateSam31ImageBackboneParity, 'function', 'the inference kit must export the image-backbone compound parity evaluator');
assert.equal(typeof kit.createSam31NumericalVerificationEvidence, 'function', 'the inference kit must expose one numerical-verification authority contract');
assert.equal(kit.createSam31BrowserTrackerSessionForTest, undefined, 'the lifecycle test seam must not be part of the package API');
assert.equal(kit.createSam31BrowserTrackerPackageAuthority, undefined, 'the raw runtime authority helper must not be part of the package API');

if (typeof kit.createSam31NumericalVerificationEvidence === 'function') {
  assert.deepEqual(
    kit.createSam31NumericalVerificationEvidence({ verificationAttached: false }),
    {
      schema: 'kaminos.sam31-numerical-verification-evidence.v0',
      state: 'not-attached',
      attached: false,
      passed: null,
      gatePassed: true,
    },
    'verification-free execution must remain admissible without claiming numerical passage',
  );
  assert.deepEqual(
    kit.createSam31NumericalVerificationEvidence({ verificationAttached: true, parityPassed: true }),
    {
      schema: 'kaminos.sam31-numerical-verification-evidence.v0',
      state: 'verified-passed',
      attached: true,
      passed: true,
      gatePassed: true,
    },
  );
  assert.deepEqual(
    kit.createSam31NumericalVerificationEvidence({ verificationAttached: true, parityPassed: false }),
    {
      schema: 'kaminos.sam31-numerical-verification-evidence.v0',
      state: 'verified-failed',
      attached: true,
      passed: false,
      gatePassed: false,
    },
    'an attached failed comparison must still block the numerical gate',
  );
}

if (typeof kit.evaluateSam31TrackerDownstreamParity === 'function') {
  const summary = ({ maxAbsDiff, meanAbsDiff, rootMeanSquareDiff, expectedAtMaxAbsDiff }) => ({
    elementCount: 1024,
    maxAbsDiff,
    meanAbsDiff,
    rootMeanSquareDiff,
    maxAbsExpected: Math.abs(expectedAtMaxAbsDiff),
    maxAbsActual: Math.abs(expectedAtMaxAbsDiff),
    maxAbsDiffIndex: 7,
    expectedAtMaxAbsDiff,
    actualAtMaxAbsDiff: expectedAtMaxAbsDiff + maxAbsDiff,
  });
  const tolerances = {
    memory: { maxAbsDiff: 0.0008, meanAbsDiff: 0.000025, rootMeanSquareDiff: 0.00005, relativeDiffAtMaxAbsDiff: 0.004 },
    position: { maxAbsDiff: 0.000005, meanAbsDiff: 0.0000001, rootMeanSquareDiff: 0.0000002, relativeDiffAtMaxAbsDiff: 0 },
    attention: { maxAbsDiff: 0.002, meanAbsDiff: 0.00006, rootMeanSquareDiff: 0.000125, relativeDiffAtMaxAbsDiff: 0.0012 },
    selectedMasks: { maxAbsDiff: 0.0025, meanAbsDiff: 0.000275, rootMeanSquareDiff: 0.000425, relativeDiffAtMaxAbsDiff: 0.0005 },
    objectScores: { maxAbsDiff: 0.00015, meanAbsDiff: 0.0003, rootMeanSquareDiff: 0.00035, relativeDiffAtMaxAbsDiff: 0.0001 },
    objectPointers: { maxAbsDiff: 0.00005, meanAbsDiff: 0.00003, rootMeanSquareDiff: 0.000045, relativeDiffAtMaxAbsDiff: 0.0003 },
  };
  const diagnostics = {
    frame0Memory: {
      features: summary({ maxAbsDiff: 0.0019183158874511719, meanAbsDiff: 0.0000163027471420385, rootMeanSquareDiff: 0.0000345334655447844, expectedAtMaxAbsDiff: 0.40148764848709106 }),
      position: summary({ maxAbsDiff: 4.76837158203125e-7, meanAbsDiff: 2.6377142248396393e-8, rootMeanSquareDiff: 5.0456245131076384e-8, expectedAtMaxAbsDiff: -0.29088088870048523 }),
    },
    temporalBank: {
      memoryImage: summary({ maxAbsDiff: 0.0019121766090393066, meanAbsDiff: 0.000023816006377161457, rootMeanSquareDiff: 0.000043751815821820305, expectedAtMaxAbsDiff: -0.49984779953956604 }),
      memory: summary({ maxAbsDiff: 0.0019183158874511719, meanAbsDiff: 0.000016122087383070475, rootMeanSquareDiff: 0.00003427531686709912, expectedAtMaxAbsDiff: 0.40148764848709106 }),
      memoryImagePosition: summary({ maxAbsDiff: 4.76837158203125e-7, meanAbsDiff: 2.6689406240620883e-8, rootMeanSquareDiff: 5.5356739058342276e-8, expectedAtMaxAbsDiff: -0.5267646312713623 }),
      memoryPosition: summary({ maxAbsDiff: 0.000003337860107421875, meanAbsDiff: 3.049080987693742e-8, rootMeanSquareDiff: 8.397723665356406e-8, expectedAtMaxAbsDiff: 6.349081993103027 }),
    },
    frame1Attention: summary({ maxAbsDiff: 0.0032601356506347656, meanAbsDiff: 0.00004259872047839225, rootMeanSquareDiff: 0.00008923158881220331, expectedAtMaxAbsDiff: -1.8377070426940918 }),
    frame1Decoder: {
      selectedMasks: summary({ maxAbsDiff: 0.004762172698974609, meanAbsDiff: 0.00020913046037987493, rootMeanSquareDiff: 0.00032128836594632904, expectedAtMaxAbsDiff: -7.485759258270264 }),
      objectScores: summary({ maxAbsDiff: 0.000385284423828125, meanAbsDiff: 0.00022513419389724731, rootMeanSquareDiff: 0.00026561371449116734, expectedAtMaxAbsDiff: 3.3998336791992188 }),
      objectPointers: summary({ maxAbsDiff: 0.0001850724220275879, meanAbsDiff: 0.00001784950393401985, rootMeanSquareDiff: 0.00002690295763449788, expectedAtMaxAbsDiff: 0.5780418515205383 }),
    },
  };
  const accepted = kit.evaluateSam31TrackerDownstreamParity({ diagnostics, tolerances });
  assert.equal(accepted.passed, true, 'the measured authenticated 448 downstream distribution must pass the compound FP32 gate');
  assert.deepEqual(accepted.failedCheckpoints, []);
  assert.equal(accepted.checkpoints.length, 10, 'every memory, position, attention, and decoder tensor must be checked independently');

  const broadDrift = structuredClone(diagnostics);
  broadDrift.frame1Decoder.selectedMasks.meanAbsDiff = 0.0003;
  assert.equal(
    kit.evaluateSam31TrackerDownstreamParity({ diagnostics: broadDrift, tolerances }).passed,
    false,
    'a broadly shifted decoder distribution must fail even when its maximum remains accepted',
  );

  const sparseOverage = structuredClone(diagnostics);
  sparseOverage.frame1Attention.maxAbsDiff = 0.0043;
  assert.equal(
    kit.evaluateSam31TrackerDownstreamParity({ diagnostics: sparseOverage, tolerances }).passed,
    false,
    'a sparse attention outlier beyond the absolute-plus-relative allowance must fail',
  );

  const auxiliaryOverage = structuredClone(diagnostics);
  auxiliaryOverage.frame1Decoder.objectPointers.rootMeanSquareDiff = 0.00005;
  assert.equal(
    kit.evaluateSam31TrackerDownstreamParity({ diagnostics: auxiliaryOverage, tolerances }).passed,
    false,
    'decoder pointer drift must not hide behind the selected-mask distribution',
  );

  assert.equal(
    kit.evaluateSam31TrackerDownstreamParity({ diagnostics, tolerances: { decoderMaxAbsDiff: 0.01 } }).passed,
    false,
    'legacy absolute-only tolerances must not silently authorize the compound gate',
  );
}

if (typeof kit.evaluateSam31ImageBackboneParity === 'function') {
  const summary = ({ maxAbsDiff, meanAbsDiff, rootMeanSquareDiff, expectedAtMaxAbsDiff }) => ({
    elementCount: 1_048_576,
    maxAbsDiff,
    meanAbsDiff,
    rootMeanSquareDiff,
    maxAbsExpected: Math.abs(expectedAtMaxAbsDiff),
    maxAbsActual: Math.abs(expectedAtMaxAbsDiff + maxAbsDiff),
    maxAbsDiffIndex: 448,
    expectedAtMaxAbsDiff,
    actualAtMaxAbsDiff: expectedAtMaxAbsDiff + maxAbsDiff,
  });
  const diagnostics = {
    frame0: {
      vitPrefix: summary({ maxAbsDiff: 0.00836181640625, meanAbsDiff: 0.00005, rootMeanSquareDiff: 0.00015, expectedAtMaxAbsDiff: 6 }),
      vitBackbone: summary({ maxAbsDiff: 0.093658447265625, meanAbsDiff: 0.00008, rootMeanSquareDiff: 0.00025, expectedAtMaxAbsDiff: 40 }),
    },
    frame1: {
      vitPrefix: summary({ maxAbsDiff: 0.008340835571289062, meanAbsDiff: 0.00005, rootMeanSquareDiff: 0.00015, expectedAtMaxAbsDiff: -6 }),
      vitBackbone: summary({ maxAbsDiff: 0.06201171875, meanAbsDiff: 0.00008, rootMeanSquareDiff: 0.00025, expectedAtMaxAbsDiff: -40 }),
    },
  };
  const tolerances = {
    vitPrefixMaxAbsDiff: 0.006,
    vitPrefixMeanAbsDiff: 0.000075,
    vitPrefixRootMeanSquareDiff: 0.0002,
    vitPrefixRelativeDiffAtMaxAbsDiff: 0.0005,
    vitBackboneMaxAbsDiff: 0.02,
    vitBackboneMeanAbsDiff: 0.0001,
    vitBackboneRootMeanSquareDiff: 0.0003,
    vitBackboneRelativeDiffAtMaxAbsDiff: 0.002,
  };
  const accepted = kit.evaluateSam31ImageBackboneParity({ diagnostics, tolerances });
  assert.equal(accepted.passed, true, 'sparse 448 ViT maxima must remain auditable through their compound distributions');
  assert.equal(accepted.checkpointCount, 4);
  assert.deepEqual(accepted.failedCheckpoints, []);
  for (const checkpoint of accepted.checkpoints) {
    assert.equal(Number.isInteger(checkpoint.elementCount), true);
    assert.equal(Number.isInteger(checkpoint.maxAbsDiffIndex), true);
    assert.equal(Number.isFinite(checkpoint.expectedAtMaxAbsDiff), true);
    assert.equal(Number.isFinite(checkpoint.actualAtMaxAbsDiff), true);
    assert.equal(Number.isFinite(checkpoint.maximumAllowed), true);
    assert.equal(Number.isFinite(checkpoint.meanAbsDiffAllowed), true);
    assert.equal(Number.isFinite(checkpoint.rootMeanSquareDiffAllowed), true);
    assert.equal(typeof checkpoint.toleranceProfile, 'object');
  }
  const hiddenBroadDrift = structuredClone(diagnostics);
  hiddenBroadDrift.frame0.vitBackbone.meanAbsDiff = 0.00011;
  assert.equal(
    kit.evaluateSam31ImageBackboneParity({ diagnostics: hiddenBroadDrift, tolerances }).passed,
    false,
    'a report-level image-backbone evaluator must reject broad drift hidden beneath an allowed sparse maximum',
  );
}

function packageRuntimeAuthorityFixture({ verificationAttached, componentAuthorities = null }) {
  const packageId = 'sam31-tracker-model-package:test';
  const invocationId = 'sam31-tracker-invocation:test';
  const verificationId = verificationAttached ? 'sam31-tracker-verification:test' : null;
  return {
    packageId,
    invocationId,
    verificationId,
    verificationAttached,
    componentAuthorities,
    packageResolution: {
      schema: 'kaminos.sam31-browser-tracker-package-invocation-evidence.v0',
      packageId,
      invocationId,
      modelPackage: {
        schema: 'kaminos.sam31-browser-tracker-model-package.v0',
        sha256: 'sha256:model',
        effectiveSha256: 'sha256:model',
      },
      invocation: {
        schema: 'kaminos.sam31-browser-tracker-invocation.v0',
        sha256: 'sha256:invocation',
        effectiveSha256: 'sha256:invocation',
      },
      verification: verificationAttached
        ? {
            attached: true,
            schema: 'kaminos.sam31-browser-tracker-verification.v0',
            sha256: 'sha256:verification',
            effectiveSha256: 'sha256:verification',
          }
        : { attached: false },
    },
  };
}

const packetNames = ['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer'];
const verificationFreeAuthority = createSam31BrowserTrackerPackageAuthority(
  packageRuntimeAuthorityFixture({ verificationAttached: false }),
);
assert.equal(verificationFreeAuthority.passed, true, 'authenticated package and invocation roots must authorize verification-free execution');
assert.deepEqual(verificationFreeAuthority.executablePackets, packetNames);
assert.deepEqual(verificationFreeAuthority.verifiedPackets, [], 'verification-free execution must not claim component verification');
assert.equal(verificationFreeAuthority.componentVerificationState, 'not-attached');
assert.equal(verificationFreeAuthority.componentVerificationPassed, null);
assert.equal(verificationFreeAuthority.pointerPacketDigestState, 'not-applicable');
assert.equal(verificationFreeAuthority.pointerPacketInputDigestPassed, null);
assert.equal(verificationFreeAuthority.pointerPacketOutputDigestPassed, null);

const verifiedComponents = Object.fromEntries(packetNames.map(name => [name, { passed: true, name }]));
const verifiedAuthority = createSam31BrowserTrackerPackageAuthority(
  packageRuntimeAuthorityFixture({ verificationAttached: true, componentAuthorities: verifiedComponents }),
);
assert.equal(verifiedAuthority.passed, true);
assert.deepEqual(verifiedAuthority.executablePackets, packetNames);
assert.deepEqual(verifiedAuthority.verifiedPackets, packetNames);
assert.equal(verifiedAuthority.componentVerificationState, 'verified');
assert.equal(verifiedAuthority.componentVerificationPassed, true);
assert.equal(verifiedAuthority.pointerPacketDigestState, 'not-applicable');
assert.equal(verifiedAuthority.pointerPacketInputDigestPassed, null);
assert.equal(verifiedAuthority.pointerPacketOutputDigestPassed, null);

const failedComponents = structuredClone(verifiedComponents);
failedComponents.pointer.passed = false;
const failedAuthority = createSam31BrowserTrackerPackageAuthority(
  packageRuntimeAuthorityFixture({ verificationAttached: true, componentAuthorities: failedComponents }),
);
assert.equal(failedAuthority.passed, false, 'an attached but failed component receipt must block execution authority');
assert.deepEqual(failedAuthority.verifiedPackets, packetNames.filter(name => name !== 'pointer'));
assert.equal(failedAuthority.componentVerificationState, 'failed');
assert.equal(failedAuthority.componentVerificationPassed, false);

const executionContracts = deriveSam31BrowserTrackerExecutionContracts({
  ingressShape: {
    imageHeight: 56,
    imageWidth: 56,
    patchSize: 14,
    patchHeight: 4,
    patchWidth: 4,
    patchTokens: 16,
    fpnLevels: [
      { level: 0, scaleFactor: 4, height: 16, width: 16 },
      { level: 1, scaleFactor: 2, height: 8, width: 8 },
      { level: 2, scaleFactor: 1, height: 4, width: 4 },
    ],
  },
  episodeShape: {
    batch: 1,
    multiplexCount: 16,
    queryHeight: 4,
    queryWidth: 4,
    queryTokens: 16,
    maskHeight: 16,
    maskWidth: 16,
    sourceImageHeight: 56,
    sourceImageWidth: 56,
    sourceMaskHeight: 64,
    sourceMaskWidth: 64,
    promptMaskHeight: 16,
    promptMaskWidth: 16,
    decoderMaskHeight: 16,
    decoderMaskWidth: 16,
    memoryInputMaskHeight: 64,
    memoryInputMaskWidth: 64,
    memorySpatialTokens: 16,
    numObjPtrTokens: 16,
    memoryTokens: 32,
    channels: 256,
  },
  decoderShape: {
    imageHeight: 2,
    imageWidth: 2,
    imageTokens: 4,
    maskHeight: 8,
    maskWidth: 8,
    channels: 256,
  },
  memoryShape: {
    featureHeight: 2,
    featureWidth: 2,
    featureChannels: 256,
    maskHeight: 8,
    maskWidth: 8,
    resampledMaskHeight: 32,
    resampledMaskWidth: 32,
    multiplexCount: 16,
    conditionChannels: true,
  },
});
assert.deepEqual(
  {
    imageHeight: executionContracts.decoder.imageHeight,
    imageWidth: executionContracts.decoder.imageWidth,
    imageTokens: executionContracts.decoder.imageTokens,
    maskHeight: executionContracts.decoder.maskHeight,
    maskWidth: executionContracts.decoder.maskWidth,
    sourceMaskHeight: executionContracts.geometry.sourceMaskHeight,
    promptMaskHeight: executionContracts.geometry.promptMaskHeight,
  },
  { imageHeight: 4, imageWidth: 4, imageTokens: 16, maskHeight: 16, maskWidth: 16, sourceMaskHeight: 64, promptMaskHeight: 16 },
  'decoder execution geometry must come from the authenticated ingress and episode, not the component verification fixture',
);
assert.deepEqual(
  {
    featureHeight: executionContracts.memory.featureHeight,
    featureWidth: executionContracts.memory.featureWidth,
    maskHeight: executionContracts.memory.maskHeight,
    maskWidth: executionContracts.memory.maskWidth,
    resampledMaskHeight: executionContracts.memory.resampledMaskHeight,
    resampledMaskWidth: executionContracts.memory.resampledMaskWidth,
  },
  { featureHeight: 4, featureWidth: 4, maskHeight: 64, maskWidth: 64, resampledMaskHeight: 64, resampledMaskWidth: 64 },
  'memory execution geometry must preserve the source-resolution H*16 mask without a decoder-mask impersonation',
);

const lifecycle = [];
let resolveLost;
const device = {
  queue: {
    async onSubmittedWorkDone() {
      lifecycle.push('queue-drained');
    },
  },
  lost: new Promise(resolve => { resolveLost = resolve; }),
  destroy() {
    lifecycle.push('device-destroyed');
    resolveLost({ reason: 'destroyed', message: 'test close' });
  },
};
const packageRuntime = {
  packageId: 'sam31-tracker-model-package:test',
  invocationId: 'sam31-tracker-invocation:test',
  verificationAttached: false,
};
const completeInvocationResult = () => ({
  evidence: {
    passed: true,
    parityPassed: null,
    parityState: 'not-attached',
    parityGatePassed: true,
  },
  receipts: Array.from({ length: 19 }, (_, index) => ({ index })),
  requestIds: Array.from({ length: 19 }, (_, index) => `request-${index}`),
  requestedRouteIds: Array.from({ length: 19 }, (_, index) => `route-${index}`),
  effectiveRouteIds: Array.from({ length: 19 }, (_, index) => `route-${index}`),
});
let invocationRuns = 0;
for (const [name, value] of Object.entries({
  packageRuntime,
  executionContext: { adapter: {}, device, errors: [] },
  executeInvocation: async () => completeInvocationResult(),
  modelPackageRuntime: {},
  callerInvocationRuntime: {},
  decodeImage: async () => ({ rgba: new Uint8Array(4), width: 1, height: 1 }),
})) {
  await assert.rejects(
    () => kit.createSam31BrowserTrackerSession({ packageRoot: '/fake-root.json', cache: {}, [name]: value }),
    new RegExp(`public tracker session does not accept ${name}`),
    `the public session must reject caller-owned ${name} injection before package loading`,
  );
}

const session = createSam31BrowserTrackerSessionForTest({
  packageRuntime,
  executionContext: { adapter: { info: { vendor: 'test', architecture: 'test' } }, device, errors: [] },
  executeInvocation: async input => {
    invocationRuns += 1;
    assert.equal(input.packageRuntime, packageRuntime);
    assert.equal(input.device, device);
    return completeInvocationResult();
  },
});
assert.equal(session.schema, kit.SAM31_BROWSER_TRACKER_SESSION_SCHEMA);
assert.equal(session.status, 'open');
assert.equal('packageRuntime' in session, false, 'the session must not expose mutable package authority');
assert.equal('execution' in session, false, 'the session must not expose its mutable WebGPU execution context');
assert.deepEqual(await session.run(), completeInvocationResult());
assert.equal(session.status, 'completed');
await assert.rejects(() => session.run(), /already executed/);
const closeEvidence = await session.close();
assert.deepEqual(lifecycle, ['queue-drained', 'device-destroyed']);
assert.equal(closeEvidence.queueDrained, true);
assert.equal(closeEvidence.deviceDestroyed, true);
assert.equal(closeEvidence.deviceLossAwaited, true);
assert.equal(session.status, 'closed');
assert.equal(invocationRuns, 1);
await assert.rejects(() => session.run(), /closed/);
assert.equal(await session.close(), closeEvidence, 'close must be idempotent and preserve its first evidence object');

let resolveUnexpectedLoss;
const unexpectedLossDevice = {
  queue: {
    async onSubmittedWorkDone() {
      resolveUnexpectedLoss({ reason: 'unknown', message: 'lost while draining' });
      await Promise.resolve();
    },
  },
  lost: new Promise(resolve => { resolveUnexpectedLoss = resolve; }),
  destroy() {},
};
const unexpectedLossSession = createSam31BrowserTrackerSessionForTest({
  packageRuntime,
  executionContext: { adapter: { info: { vendor: 'test', architecture: 'test' } }, device: unexpectedLossDevice, errors: [] },
  executeInvocation: async () => completeInvocationResult(),
});
await unexpectedLossSession.run();
const unexpectedLossClose = await unexpectedLossSession.close();
assert.deepEqual(
  unexpectedLossClose.deviceLoss,
  { reason: 'unknown', message: 'lost while draining' },
  'device loss during queue drain must not be laundered into intentional close evidence',
);

let resolveIncompleteLost;
const incompleteDevice = {
  queue: { async onSubmittedWorkDone() {} },
  lost: new Promise(resolve => { resolveIncompleteLost = resolve; }),
  destroy() { resolveIncompleteLost({ reason: 'destroyed', message: 'test close' }); },
};
const incompleteSession = createSam31BrowserTrackerSessionForTest({
  packageRuntime,
  executionContext: { adapter: { info: { vendor: 'test', architecture: 'test' } }, device: incompleteDevice, errors: [] },
  executeInvocation: async () => ({ ...completeInvocationResult(), receipts: Array.from({ length: 18 }, (_, index) => ({ index })) }),
});
await assert.rejects(
  () => incompleteSession.run(),
  /complete 19-route evidence/,
  'the public session must reject an incomplete driver result even when it claims passage',
);
assert.equal(incompleteSession.status, 'failed');
await incompleteSession.close();

assert.throws(
  () => createSam31BrowserTrackerSessionForTest({ packageRuntime, executionContext: {}, executeInvocation: async () => completeInvocationResult() }),
  /execution context requires an adapter and device/,
);
await assert.rejects(
  () => kit.createSam31BrowserTrackerSession(),
  /package root and shared cache are required/,
);

const smokeSource = await readFile(new URL('../smokes/sam31-two-frame-tracker-parity.js', import.meta.url), 'utf8');
const driverSource = await readFile(new URL('../src/sam31-browser-tracker-session-driver.js', import.meta.url), 'utf8');
for (const token of [
  'summarizeSam3TensorParityCheckpoint',
  'Float32Array.from',
  'downstreamParityDiagnostics',
  'memoryFromPropagation',
  'temporalFromMemory',
  'attentionFromTemporal',
  'decoderFromAttention',
]) assert.match(driverSource, new RegExp(token), `package tracker driver must preserve downstream parity evidence through ${token}`);
assert.match(driverSource, /imageBackboneCompoundParity/, 'the successful package report must preserve the image-backbone compound verdict and diagnostics');
assert.match(
  driverSource,
  /const residentTensorResolver = packageRuntime\.residentTensorResolver \|\| null/,
  'the tracker driver must derive one resident tensor resolver from the authenticated package runtime',
);
for (const routeRunner of [
  'runSam31InteractivePointerPhaseProgramRoute',
  'runSam31MemoryEncoderPhaseProgramRoute',
  'runSam31TemporalMemoryBankPhaseProgramRoute',
  'runSam31MemoryAttentionPhaseProgramRoute',
  'runSam31MultiplexMaskDecoderPhaseProgramRoute',
]) {
  assert.match(
    driverSource,
    new RegExp(`${routeRunner}\\(\\{[\\s\\S]{0,1600}?residentTensorResolver`),
    `${routeRunner} must receive the authenticated resident tensor resolver`,
  );
}
assert.match(smokeSource, /createSam31BrowserTrackerSession/, 'package smoke must consume the exported session');
assert.doesNotMatch(smokeSource, /invocations\.push\(await runInvocation\(packageRoots\[index\]/, 'package smoke must not bypass the exported session with its private invocation function');
assert.match(smokeSource, /runtimeSession:\s*\{/, 'package smoke must preserve public session identity in each invocation row');
assert.match(smokeSource, /closeEvidence:\s*sessionClose/, 'package smoke must preserve session close evidence after awaiting device loss');
assert.match(
  driverSource,
  /deriveSam31BrowserTrackerExecutionContracts\(\{\s*ingressShape: ingress\.shape,\s*episodeShape: episode\.shape,/,
  'the tracker driver must derive component execution contracts from the package-authenticated ingress and episode geometry',
);
assert.doesNotMatch(driverSource, /shape:\s*\[16,\s*1,\s*8,\s*8\]/, 'the tracker driver must not stamp reduced mask geometry into route receipts');
assert.doesNotMatch(driverSource, /shape:\s*\[1,\s*2,\s*2,\s*256\]/, 'the tracker driver must not stamp reduced feature geometry into route receipts');
assert.doesNotMatch(driverSource, /featureHeight:\s*2,\s*featureWidth:\s*2/, 'the memory encoder must consume authenticated query geometry');
assert.match(
  driverSource,
  /maskHeight:\s*memoryShape\.maskHeight,\s*maskWidth:\s*memoryShape\.maskWidth/,
  'the memory encoder must consume package-authenticated memory-input mask geometry',
);
assert.doesNotMatch(driverSource, /const attentionShape = \{ batch: 1, queryHeight: 2/, 'memory attention must consume authenticated query and bank geometry');

console.log('sam3.1 browser tracker session contracts passed');
