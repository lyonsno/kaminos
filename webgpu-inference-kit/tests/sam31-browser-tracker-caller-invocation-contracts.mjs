import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSam31BrowserTrackerCallerDualInvocationEvidence,
  createSam31BrowserTrackerCallerInvocationRuntime,
} from '../src/sam31-browser-tracker-caller-invocation.js';

const packetNames = ['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer'];
const packageId = 'sam31-tracker-model-package:fixture';
const modelPackage = {
  schema: 'kaminos.sam31-browser-tracker-model-package.v0',
  packageId,
  model: { id: 'facebook/sam3.1', revision: 'fixture' },
  source: { repository: 'facebookresearch/sam3', commit: 'fixture' },
  geometry: {
    ingress: { imageHeight: 1, imageWidth: 1 },
    episode: { multiplexCount: 2, maskHeight: 1, maskWidth: 1 },
    plan: { frameIndex: 1 },
  },
  components: Object.fromEntries(packetNames.map(name => [name, {
    schema: name === 'episode' ? 'kaminos.sam31-two-image-tracker-meta-packet.v0' : `fixture.${name}`,
    weights: [],
    staticTensors: [],
    ...(name === 'temporal' ? { weights: [] } : {}),
    ...(name === 'ingress' ? { sourceImages: [{ frameIndex: 0 }, { frameIndex: 1 }] } : {}),
  }])),
  staticArtifacts: [],
};
const modelPackageRuntime = {
  rootUrl: 'https://example.test/tracker-model-root.json',
  packageId,
  modelPackage,
  packageResolution: {
    schema: 'kaminos.sam31-browser-tracker-model-package-evidence.v0',
    packageId,
    modelPackage: {
      schema: modelPackage.schema,
      sha256: 'sha256:model',
      effectiveSha256: 'sha256:model',
    },
  },
  async loadFloat32() { throw new Error('fixture has no static float32 values'); },
  async loadUint8() { throw new Error('fixture has no static uint8 values'); },
  cacheEvidence() { return { staticNetworkLoadCount: 1, dynamicNetworkLoadCount: 0 }; },
};
const sourceImages = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
const decodedByFirstByte = new Map([
  [1, new Uint8Array([10, 20, 30, 255])],
  [4, new Uint8Array([40, 50, 60, 255])],
  [7, new Uint8Array([70, 80, 90, 255])],
]);
const decodeImage = async (bytes, target) => ({
  rgba: decodedByFirstByte.get(bytes[0]),
  width: target.width,
  height: target.height,
  decoder: 'fixture-browser-decoder',
});
const initialMask = new Float32Array([1, 0]);
const session = {
  sessionId: 'caller-session-a',
  conditioningFrameIndex: 0,
  propagationFrameIndices: [1],
  conditioningObjects: [0, 1],
  maskVariant: 0,
};

const first = await createSam31BrowserTrackerCallerInvocationRuntime({
  modelPackageRuntime,
  sourceImages,
  initialMask,
  session,
  decodeImage,
});
const repeat = await createSam31BrowserTrackerCallerInvocationRuntime({
  modelPackageRuntime,
  sourceImages,
  initialMask,
  session,
  decodeImage,
});
assert.equal(first.packageId, packageId);
assert.equal(first.verificationAttached, false);
assert.equal(first.verificationId, null);
assert.equal(first.componentAuthorities, null);
assert.equal(first.packageResolution.verification.attached, false);
assert.equal(first.packageResolution.invocation.source, 'browser-caller-inputs');
assert.equal(first.invocationId, repeat.invocationId, 'identical caller bytes, mask, and session must derive one stable invocation id');
assert.equal(first.inputEvidence.dynamicOriginFetchCount, 0);
assert.equal(first.cacheEvidence().dynamicNetworkLoadCount, 0);
assert.deepEqual(first.manifests.ingress.sourceImages.map(image => image.frameIndex), [0, 1]);
assert.equal(new Set(first.encodedSourceImageSha256).size, 2);
assert.equal(new Set(first.rgbaSourceImageSha256).size, 2);
assert.equal(first.manifests.episode.tensors.some(entry => entry.role === 'frame-0-binary-mask-inputs'), true);

const frame0 = first.manifests.ingress.tensors.find(entry => entry.role === 'frame-0-rgba');
const mask = first.manifests.episode.tensors.find(entry => entry.role === 'frame-0-binary-mask-inputs');
assert.deepEqual(await first.loadUint8(frame0), decodedByFirstByte.get(1));
assert.deepEqual(await first.loadFloat32(mask), initialMask);
assert.equal(first.inputEvidence.callerArtifactReadCount, 2, 'reads must be serviced from invocation-local caller memory');

const otherPackage = structuredClone(modelPackage);
otherPackage.packageId = 'sam31-tracker-model-package:other';
const otherPackageRuntime = {
  ...modelPackageRuntime,
  packageId: otherPackage.packageId,
  modelPackage: otherPackage,
  packageResolution: {
    ...modelPackageRuntime.packageResolution,
    packageId: otherPackage.packageId,
  },
};
const otherPackageInvocation = await createSam31BrowserTrackerCallerInvocationRuntime({
  modelPackageRuntime: otherPackageRuntime,
  sourceImages,
  initialMask,
  session,
  decodeImage,
});
assert.notEqual(first.invocationId, otherPackageInvocation.invocationId, 'caller invocation identity must bind immutable model-package identity');

const changed = await createSam31BrowserTrackerCallerInvocationRuntime({
  modelPackageRuntime,
  sourceImages: [new Uint8Array([7, 8, 9]), sourceImages[1]],
  initialMask,
  session,
  decodeImage,
});
assert.notEqual(first.invocationId, changed.invocationId);
assert.equal(first.packageId, changed.packageId, 'caller inputs must not mutate immutable model-package identity');

await assert.rejects(
  () => createSam31BrowserTrackerCallerInvocationRuntime({ modelPackageRuntime, sourceImages: [sourceImages[0], sourceImages[0]], initialMask, session, decodeImage }),
  /distinct encoded source images/,
);
await assert.rejects(
  () => createSam31BrowserTrackerCallerInvocationRuntime({ modelPackageRuntime, sourceImages, initialMask, session, decodeImage: async () => ({ rgba: decodedByFirstByte.get(1), width: 1, height: 1 }) }),
  /distinct decoded RGBA source images/,
);
await assert.rejects(
  () => createSam31BrowserTrackerCallerInvocationRuntime({ modelPackageRuntime, sourceImages, initialMask, session, decodeImage: async bytes => ({ rgba: decodedByFirstByte.get(bytes[0]), width: 2, height: 1 }) }),
  /decoded image geometry/,
);
await assert.rejects(
  () => createSam31BrowserTrackerCallerInvocationRuntime({ modelPackageRuntime, sourceImages, initialMask: new Float32Array([1]), session, decodeImage }),
  /initial mask length/,
);
await assert.rejects(
  () => createSam31BrowserTrackerCallerInvocationRuntime({ modelPackageRuntime, sourceImages, initialMask: new Float32Array([1, Number.NaN]), session, decodeImage }),
  /initial mask contains non-finite values/,
);
await assert.rejects(
  () => createSam31BrowserTrackerCallerInvocationRuntime({ modelPackageRuntime, sourceImages, initialMask: new Float32Array([1, 0.5]), session, decodeImage }),
  /initial mask must contain only binary values/,
);

let releaseFirstDecode;
const firstDecodeWaiting = new Promise(resolve => { releaseFirstDecode = resolve; });
const mutableFrame0 = new Uint8Array([1, 2, 3]);
const mutableFrame1 = new Uint8Array([4, 5, 6]);
const mutableMask = new Float32Array([1, 0]);
let decodeCount = 0;
const racingRuntimePromise = createSam31BrowserTrackerCallerInvocationRuntime({
  modelPackageRuntime,
  sourceImages: [mutableFrame0, mutableFrame1],
  initialMask: mutableMask,
  session,
  decodeImage: async (bytes, target) => {
    decodeCount += 1;
    if (decodeCount === 1) await firstDecodeWaiting;
    return decodeImage(bytes, target);
  },
});
await new Promise(resolve => setTimeout(resolve, 0));
mutableFrame1.fill(7);
mutableMask.set([0, 1]);
releaseFirstDecode();
const racingRuntime = await racingRuntimePromise;
assert.deepEqual(racingRuntime.encodedSourceImageSha256, first.encodedSourceImageSha256, 'all encoded inputs must be snapshotted before asynchronous decode');
assert.equal(racingRuntime.initialMaskSha256, first.initialMaskSha256, 'the mask must be snapshotted before asynchronous decode');

await assert.rejects(
  () => first.loadUint8({ role: 'frame-9-rgba', file: 'caller://ingress/unknown', sha256: 'sha256:unknown', byteLength: 4 }),
  /fixture has no static uint8 values/,
  'an unknown caller descriptor must fail closed without entering a dynamic origin fetch path',
);

const sessionSource = await readFile(new URL('../src/sam31-browser-tracker-session.js', import.meta.url), 'utf8');
assert.match(sessionSource, /modelPackageRoot/, 'the public session must expose a model-only caller-input route');
assert.match(sessionSource, /createSam31BrowserTrackerCallerInvocationRuntime/, 'the public caller-input route must derive an invocation runtime in-browser');
assert.match(sessionSource, /decodeSam31BrowserTrackerSourceImage/, 'the public route must bind the kit-owned browser decoder');

function invocationEvidence(index) {
  const causal = Object.fromEntries(['memory', 'image', 'pointers', 'maskLogits'].map(name => [name, `${name}-${index}`]));
  const deterministic = Object.fromEntries(['memoryPosition', 'imagePosition', 'objectScores'].map(name => [name, `${name}-shared`]));
  const encodedSourceImageSha256 = [`sha256:encoded-${index}-0`, `sha256:encoded-${index}-1`];
  const rgbaSourceImageSha256 = [`sha256:rgba-${index}-0`, `sha256:rgba-${index}-1`];
  const initialMaskSha256 = `sha256:mask-${index}`;
  return {
    verificationAttached: false,
    parity: null,
    executionRealmId: `realm-${index}`,
    deviceLoss: null,
    requestIds: Array.from({ length: 19 }, (_, route) => `request-${index}-${route}`),
    receipts: Array.from({ length: 19 }, (_, route) => ({
      status: 'real',
      outputs: [{ role: route === 18 ? 'sam31-multiplex-selected-masks' : `output-${route}`, artifactId: `artifact-${index}-${route}`, sha256: `sha256:output-${index}-${route}` }],
    })),
    evidence: { routeChainPassed: true },
    callerInputAuthority: { passed: true },
    packageRuntime: {
      packageId,
      invocationId: `invocation-${index}`,
      verificationId: null,
      encodedSourceImageSha256,
      rgbaSourceImageSha256,
      initialMaskSha256,
      session,
      packageResolution: { verification: { attached: false } },
      inputEvidence: {
        source: 'caller-owned-browser-memory',
        encodedSourceImageSha256,
        rgbaSourceImageSha256,
        initialMaskSha256,
        callerArtifactReadCount: 3,
        dynamicOriginFetchCount: 0,
      },
      cacheEvidence: {
        staticNetworkLoadCount: 100,
        staticCacheHitCount: index === 0 ? 3 : 103,
        dynamicNetworkLoadCount: 0,
        backingStore: {
          staticOriginNetworkLoadCount: 100,
          staticBackingStoreHitCount: index === 0 ? 3 : 103,
        },
      },
    },
    trackerState: {
      version: 1,
      conditioningFrameIndices: [0],
      nonConditioningFrameIndices: [],
      frames: [{ frameIndex: 0, kind: 'conditioning', conditioningObjects: [0, 1], tensorDigests: { ...causal, ...deterministic } }],
    },
  };
}

const callerDual = createSam31BrowserTrackerCallerDualInvocationEvidence({
  invocations: [invocationEvidence(0), invocationEvidence(1)],
  betweenInvocationCheckpoints: [{ passed: true, realmRemoved: true }],
});
assert.equal(callerDual.passed, true);
assert.equal(callerDual.bothVerificationFree, true);
assert.equal(callerDual.noDynamicNetworkLoads, true);
assert.equal(callerDual.noDynamicOriginFetches, true);
assert.equal(callerDual.callerInputAuthorityPassed, true);
assert.equal(callerDual.callerArtifactReadsPassed, true);

const driverSource = await readFile(new URL('../src/sam31-browser-tracker-session-driver.js', import.meta.url), 'utf8');
assert.match(driverSource, /inputEvidence:\s*packageRuntime\.inputEvidence/, 'the session result must preserve caller input evidence');
const orchestratorSource = await readFile(new URL('../smokes/sam31-two-image-tracker-orchestrator.js', import.meta.url), 'utf8');
assert.match(orchestratorSource, /createSam31BrowserTrackerCallerDualInvocationEvidence/, 'the isolated browser orchestrator must judge caller-mode semantics');
assert.match(orchestratorSource, /callerInput/, 'the isolated browser orchestrator must propagate caller-input mode');
assert.match(orchestratorSource, /return \{ \.\.\.invocation, invocationIndex, executionRealmId \}/, 'the parent evidence record must preserve the global invocation index');
const invocationSmokeSource = await readFile(new URL('../smokes/sam31-two-frame-tracker-parity.js', import.meta.url), 'utf8');
assert.match(invocationSmokeSource, /modelPackageRoot/, 'the invocation smoke must call the public model-only session route');
assert.match(invocationSmokeSource, /callerMetadata/, 'the invocation smoke must preload caller-owned images, mask, and session metadata');
assert.match(invocationSmokeSource, /callerInputIndex/, 'an isolated one-root child must address caller inputs by its parent invocation index');
const terminalSmokeSource = await readFile(new URL('../tools/sam31-two-frame-tracker-browser-parity-smoke.mjs', import.meta.url), 'utf8');
assert.match(terminalSmokeSource, /--caller-inputs/, 'the terminal witness must expose caller-input mode');
assert.match(terminalSmokeSource, /callerRequestEvidence/, 'the terminal witness must record caller and package request counts');
assert.match(terminalSmokeSource, /browserParams\.set\('commit', requestedCommit\)/, 'the terminal witness must propagate requested commit identity into browser receipts');
assert.match(terminalSmokeSource, /commitIdentityPassed/, 'the terminal witness must fail when effective receipt commit identity does not match the request');

console.log('sam3.1 browser tracker caller invocation contracts passed');
