import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSam31BrowserTrackerCallerDualInvocationEvidence,
  createSam31BrowserTrackerCallerInvocationRuntime,
  createSam31BrowserTrackerResidentCallerDualInvocationEvidence,
} from '../src/sam31-browser-tracker-caller-invocation.js';
import * as callerInvocationModule from '../src/sam31-browser-tracker-caller-invocation.js';
import { canonicalSam3IdentityJson } from '../src/sam-browser-package-manifest.js';
import { SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT } from '../src/sam31-browser-tracker-package.js';

async function canonicalInvocationId(invocation) {
  const contract = Object.fromEntries(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationFields
    .filter(field => field !== 'invocationId')
    .map(field => [field, invocation[field]]));
  const text = new TextEncoder().encode(canonicalSam3IdentityJson(contract));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', text));
  return `${SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationPrefix}sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

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
const residentStaticValues = new Float32Array([11, 12, 13, 14]);
const residentStaticEntry = {
  role: 'patch-embed-projection-weight',
  file: 'static/resident-patch.bin',
  sha256: `sha256:${'a'.repeat(64)}`,
  byteLength: residentStaticValues.byteLength,
  dtype: 'float32',
  shape: [4],
};
const residentResolver = () => null;
const residentBindCalls = [];
const residentModelPackageRuntime = {
  ...modelPackageRuntime,
  residentTensorResolver: residentResolver,
  bindResidentTensor(entry, values) { residentBindCalls.push({ entry, values }); },
  async loadFloat32(entry) {
    assert.equal(entry, residentStaticEntry);
    return new Float32Array(residentStaticValues);
  },
};
const residentInvocation = await createSam31BrowserTrackerCallerInvocationRuntime({
  modelPackageRuntime: residentModelPackageRuntime,
  sourceImages,
  initialMask,
  session,
  decodeImage,
});
assert.equal(residentInvocation.residentTensorResolver, residentResolver, 'caller runtime must preserve the resident resolver identity');
const residentLoadedValues = await residentInvocation.loadFloat32(residentStaticEntry);
assert.deepEqual(residentLoadedValues, residentStaticValues);
assert.equal(residentBindCalls.length, 1, 'every fresh static CPU view must bind to its authenticated resident allocation');
assert.equal(residentBindCalls[0].entry, residentStaticEntry);
assert.equal(residentBindCalls[0].values, residentLoadedValues);
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
assert.equal(
  first.invocationId,
  await canonicalInvocationId(first.invocation),
  'a caller-derived invocation must reproduce exactly through the shared package invocation contract',
);
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

assert.equal(typeof callerInvocationModule.resizeRgbaMetaBicubic, 'function', 'the caller path must expose its pinned Meta resize primitive for exact fixture testing');
const resizeSourceRgb = new Uint8Array([
  0, 10, 20, 40, 50, 60, 80, 90, 100, 120, 130, 140, 160, 170, 180,
  15, 25, 35, 55, 65, 75, 95, 105, 115, 135, 145, 155, 175, 185, 195,
  30, 40, 50, 70, 80, 90, 110, 120, 130, 150, 160, 170, 190, 200, 210,
  45, 55, 65, 85, 95, 105, 125, 135, 145, 165, 175, 185, 205, 215, 225,
]);
const resizeSourceRgba = new Uint8Array(5 * 4 * 4);
for (let pixel = 0; pixel < 20; pixel += 1) {
  resizeSourceRgba.set(resizeSourceRgb.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
  resizeSourceRgba[pixel * 4 + 3] = 255;
}
const metaBicubicRgb = [
  17, 27, 37, 83, 93, 103, 149, 159, 169,
  37, 47, 57, 103, 113, 123, 169, 179, 189,
  56, 66, 76, 122, 132, 142, 188, 198, 208,
];
const metaBicubicRgba = new Uint8Array(3 * 3 * 4);
for (let pixel = 0; pixel < 9; pixel += 1) {
  metaBicubicRgba.set(metaBicubicRgb.slice(pixel * 3, pixel * 3 + 3), pixel * 4);
  metaBicubicRgba[pixel * 4 + 3] = 255;
}
assert.deepEqual(
  callerInvocationModule.resizeRgbaMetaBicubic(resizeSourceRgba, 5, 4, 3, 3),
  metaBicubicRgba,
  'browser resize bytes must exactly match Pillow 12.2.0 RGB.resize default bicubic output used by pinned Meta SAM 3.1',
);
const downsampleSourceRgba = new Uint8Array(17 * 13 * 4);
let downsampleState = 9;
for (let pixel = 0; pixel < 17 * 13; pixel += 1) {
  for (let channel = 0; channel < 3; channel += 1) {
    downsampleState = (Math.imul(1664525, downsampleState) + 1013904223) >>> 0;
    downsampleSourceRgba[pixel * 4 + channel] = downsampleState >>> 24;
  }
  downsampleSourceRgba[pixel * 4 + 3] = 255;
}
const expectedDownsampleRgb = [113, 130, 119, 126, 119, 129, 116, 125, 116, 124, 148, 120, 143, 142, 128, 127, 125, 119];
const expectedDownsampleRgba = new Uint8Array(3 * 2 * 4);
for (let pixel = 0; pixel < 6; pixel += 1) {
  expectedDownsampleRgba.set(expectedDownsampleRgb.slice(pixel * 3, pixel * 3 + 3), pixel * 4);
  expectedDownsampleRgba[pixel * 4 + 3] = 255;
}
assert.deepEqual(
  callerInvocationModule.resizeRgbaMetaBicubic(downsampleSourceRgba, 17, 13, 3, 2),
  expectedDownsampleRgba,
  'strong downsampling must reproduce Pillow signed coefficient rounding, not only interpolation-scale fixtures',
);

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

function residentInvocationEvidence(index) {
  const invocation = invocationEvidence(index);
  return {
    ...invocation,
    executionRealmId: 'resident-realm',
    residentRuntime: {
      schema: 'kaminos.sam31-browser-tracker-resident-invocation-evidence.v0',
      residentSessionId: 'resident-session',
      invocationIndex: index,
      modelPackageId: packageId,
      resourceCount: 2,
      bindingCountBefore: index * 19,
      bindingCountAfter: (index + 1) * 19,
      liveBufferIds: ['resident-buffer:1', 'resident-buffer:2'],
      modelAllocationDelta: 0,
      modelUploadDelta: 0,
      truncated: false,
    },
  };
}

const residentInvocations = [residentInvocationEvidence(0), residentInvocationEvidence(1)];
const residentSessionEvidence = {
  schema: 'kaminos.sam31-browser-tracker-resident-session-evidence.v0',
  packageId,
  status: 'open',
  invocationCount: 2,
  attemptCount: 2,
  truncated: false,
  invocations: residentInvocations.map((invocation, invocationIndex) => ({
    invocationIndex,
    invocationId: invocation.packageRuntime.invocationId,
    status: 'completed',
    requestIds: invocation.requestIds,
    residentRuntime: invocation.residentRuntime,
  })),
  residentModel: {
    truncated: false,
    resourceCount: 2,
    allocationCount: 2,
    uploadCount: 2,
    resources: residentInvocations[0].residentRuntime.liveBufferIds.map(liveBufferId => ({ liveBufferId })),
  },
  inferenceSession: { sessionId: 'resident-session', status: 'active', deviceLoss: null },
};
const residentCloseEvidence = {
  queueDrained: true,
  modelReleased: true,
  ownerRouteDetached: true,
  sessionClosed: true,
  deviceLossAwaited: true,
};
const residentDual = createSam31BrowserTrackerResidentCallerDualInvocationEvidence({
  invocations: residentInvocations,
  residentSessionEvidence,
  closeEvidence: residentCloseEvidence,
});
assert.equal(residentDual.passed, true);
assert.equal(residentDual.sameExecutionRealm, true);
assert.equal(residentDual.sameResidentSession, true);
assert.equal(residentDual.sameLiveModelBuffers, true);
assert.equal(residentDual.zeroModelAllocationDeltas, true);
assert.equal(residentDual.zeroModelUploadDeltas, true);
assert.equal(residentDual.residentSessionAccountingPassed, true);
assert.equal(residentDual.closeEvidencePassed, true);

const substitutedResidentBuffer = structuredClone(residentInvocations);
substitutedResidentBuffer[1].residentRuntime.liveBufferIds[1] = 'resident-buffer:substituted';
const substitutedResidentEvidence = createSam31BrowserTrackerResidentCallerDualInvocationEvidence({
  invocations: substitutedResidentBuffer,
  residentSessionEvidence,
  closeEvidence: residentCloseEvidence,
});
assert.equal(substitutedResidentEvidence.sameLiveModelBuffers, false);
assert.equal(substitutedResidentEvidence.passed, false, 'a substituted model buffer identity must fail the resident witness');

const driverSource = await readFile(new URL('../src/sam31-browser-tracker-session-driver.js', import.meta.url), 'utf8');
assert.match(driverSource, /inputEvidence:\s*packageRuntime\.inputEvidence/, 'the session result must preserve caller input evidence');
const orchestratorSource = await readFile(new URL('../smokes/sam31-two-image-tracker-orchestrator.js', import.meta.url), 'utf8');
assert.match(orchestratorSource, /createSam31BrowserTrackerCallerDualInvocationEvidence/, 'the isolated browser orchestrator must judge caller-mode semantics');
assert.match(orchestratorSource, /callerInput/, 'the isolated browser orchestrator must propagate caller-input mode');
assert.match(orchestratorSource, /return \{ \.\.\.invocation, invocationIndex, executionRealmId \}/, 'the parent evidence record must preserve the global invocation index');
assert.match(orchestratorSource, /createSam31BrowserTrackerResidentSession/, 'the browser orchestrator must execute the public resident session route');
assert.match(orchestratorSource, /createSam31BrowserTrackerResidentCallerDualInvocationEvidence/, 'the browser orchestrator must judge resident reuse separately from isolated-realm reuse');
assert.match(orchestratorSource, /residentSession\.run/, 'both resident invocations must execute through one retained session owner');
assert.match(orchestratorSource, /residentSession\.close/, 'the browser witness must close the resident owner after both invocations');
const invocationSmokeSource = await readFile(new URL('../smokes/sam31-two-frame-tracker-parity.js', import.meta.url), 'utf8');
assert.match(invocationSmokeSource, /modelPackageRoot/, 'the invocation smoke must call the public model-only session route');
assert.match(invocationSmokeSource, /callerMetadata/, 'the invocation smoke must preload caller-owned images, mask, and session metadata');
assert.match(invocationSmokeSource, /callerInputIndex/, 'an isolated one-root child must address caller inputs by its parent invocation index');
assert.match(invocationSmokeSource, /expectedRgbaSourceImageSha256/, 'caller authority failures must preserve expected Meta RGBA digests');
assert.match(invocationSmokeSource, /effectiveRgbaSourceImageSha256/, 'caller authority failures must preserve effective browser RGBA digests');
const terminalSmokeSource = await readFile(new URL('../tools/sam31-two-frame-tracker-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const ingressExporterSource = await readFile(new URL('../tools/sam31-two-image-ingress-meta-packet.py', import.meta.url), 'utf8');
const metaPreprocessSource = await readFile(new URL('../tools/sam31-meta-image-preprocess.py', import.meta.url), 'utf8');
assert.match(terminalSmokeSource, /--caller-inputs/, 'the terminal witness must expose caller-input mode');
assert.match(terminalSmokeSource, /--resident-session/, 'the terminal witness must expose an explicit resident-session mode');
assert.match(terminalSmokeSource, /browserParams\.set\('residentSession', '1'\)/, 'the terminal witness must propagate resident mode into the browser realm');
assert.match(terminalSmokeSource, /callerRequestEvidence/, 'the terminal witness must record caller and package request counts');
assert.match(terminalSmokeSource, /deriveMetaCallerImageAuthority/, 'the caller witness must derive expected RGBA bytes from pinned Meta preprocessing');
assert.doesNotMatch(terminalSmokeSource, /rgbaSourceImageSha256:\s*invocation\.sourceImages\.map/, 'pregenerated invocation RGBA hashes must not certify browser caller preprocessing');
assert.match(terminalSmokeSource, /metaPreprocessEvidence/, 'the caller witness must preserve effective source and Pillow preprocessing identity');
assert.match(metaPreprocessSource, /5dd401d1c5c1d5c3eedff06d41b77af824517619/, 'the preprocessing witness must pin the reviewed Meta source commit');
assert.match(metaPreprocessSource, /load_resource_as_video_frames/, 'the preprocessing witness must execute the named pinned Meta loader entry point');
assert.match(metaPreprocessSource, /loaderExecutionObserved/, 'the preprocessing witness must record that the named Meta loader actually executed');
assert.match(metaPreprocessSource, /list-of-PIL-images/, 'the preprocessing witness must name the exact Meta loader branch whose resize semantics it certifies');
assert.doesNotMatch(metaPreprocessSource, /image\s*=\s*Image\.open\(path\)\.convert\("RGB"\)\.resize/, 'a locally retyped PIL operation must not impersonate execution through the pinned Meta loader');
assert.match(metaPreprocessSource, /failurePhase/, 'the preprocessing witness must preserve its failure phase');
assert.match(metaPreprocessSource, /lastTrustworthyEvidence/, 'the preprocessing witness must preserve its last trustworthy evidence before failure');
assert.match(terminalSmokeSource, /browserParams\.set\('commit', requestedCommit\)/, 'the terminal witness must propagate requested commit identity into browser receipts');
assert.match(terminalSmokeSource, /commitIdentityPassed/, 'the terminal witness must fail when effective receipt commit identity does not match the request');
assert.doesNotMatch(ingressExporterSource, /Image\.Resampling\.BILINEAR/, 'the local reference exporter must not fork pinned Meta default RGB bicubic resize semantics');

console.log('sam3.1 browser tracker caller invocation contracts passed');
