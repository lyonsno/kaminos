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
assert.equal(kit.createSam31BrowserTrackerSessionForTest, undefined, 'the lifecycle test seam must not be part of the package API');
assert.equal(kit.createSam31BrowserTrackerPackageAuthority, undefined, 'the raw runtime authority helper must not be part of the package API');

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
  },
  { imageHeight: 4, imageWidth: 4, imageTokens: 16, maskHeight: 16, maskWidth: 16 },
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
  { featureHeight: 4, featureWidth: 4, maskHeight: 16, maskWidth: 16, resampledMaskHeight: 64, resampledMaskWidth: 64 },
  'memory execution geometry must preserve the official sixteen-fold mask-tower input ratio at the authenticated query size',
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
  evidence: { passed: true },
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
assert.doesNotMatch(driverSource, /const attentionShape = \{ batch: 1, queryHeight: 2/, 'memory attention must consume authenticated query and bank geometry');

console.log('sam3.1 browser tracker session contracts passed');
