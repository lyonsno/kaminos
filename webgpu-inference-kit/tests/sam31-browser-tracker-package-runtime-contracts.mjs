import assert from 'node:assert/strict';

import {
  createSam31BrowserTrackerPackageCache,
  loadSam31BrowserTrackerModelPackageRuntime,
  loadSam31BrowserTrackerPackageRuntime,
} from '../src/sam31-browser-tracker-package-runtime.js';
import * as trackerPackageRuntime from '../src/sam31-browser-tracker-package-runtime.js';
import { createSam31BrowserTrackerPackageProjection } from '../src/sam31-browser-tracker-package.js';

async function digest(bytes) {
  const value = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function entry(role, value, dtype = 'float32') {
  const bytes = dtype === 'uint8'
    ? new Uint8Array([value, value + 1, value + 2, 255])
    : new Uint8Array(new Float32Array([value]).buffer);
  return {
    descriptor: { role, file: `${role}.bin`, sha256: await digest(bytes), byteLength: bytes.byteLength, shape: dtype === 'uint8' ? [1, 1, 4] : [1], dtype },
    bytes,
  };
}

async function fixture(dynamicOffset, sessionId, geometry = null) {
  const records = {};
  async function add(packetName, role, value, dtype) {
    const record = await entry(role, value, dtype);
    records[`${packetName}/${record.descriptor.file}`] = record.bytes;
    return record.descriptor;
  }
  const reference = { model: { id: 'facebook/sam3.1', revision: 'fixture' }, source: { repository: 'facebookresearch/sam3' } };
  const sharedWeight = await add('ingress', 'shared-weight', 1);
  const frame0 = await add('ingress', 'frame-0-rgba', 20 + dynamicOffset, 'uint8');
  const frame1 = await add('ingress', 'frame-1-rgba', 30 + dynamicOffset, 'uint8');
  records[`decoder/${sharedWeight.file}`] = records[`ingress/${sharedWeight.file}`];
  const packets = {
    ingress: {
      schema: 'ingress', routeIds: ['image-route'], shape: geometry?.ingress || { imageHeight: 1, imageWidth: 1, imageChannels: 4 }, reference,
      sourceImages: [
        { frameIndex: 0, originalSha256: `sha256:${String(dynamicOffset + 1).padStart(64, '0')}`, rgbaSha256: frame0.sha256 },
        { frameIndex: 1, originalSha256: `sha256:${String(dynamicOffset + 2).padStart(64, '0')}`, rgbaSha256: frame1.sha256 },
      ],
      weights: [sharedWeight],
      tensors: [frame0, frame1, await add('ingress', 'expected-ingress', 4 + dynamicOffset)],
      tolerances: { maximum: 0.001 },
    },
    decoder: { schema: 'decoder', routeId: 'decoder-route', shape: { channels: 256 }, reference, weights: [sharedWeight], tensors: [await add('decoder', 'expected-decoder', 5 + dynamicOffset)], tolerances: { maximum: 0.001 } },
    memory: { schema: 'memory', routeIds: ['memory-route'], shape: { channels: 256 }, reference, weights: [await add('memory', 'memory-weight', 6)], tensors: [await add('memory', 'expected-memory', 7 + dynamicOffset)], tolerances: { maximum: 0.001 } },
    temporal: {
      schema: 'temporal', routeId: 'temporal-route', shape: { channels: 256 }, reference,
      attentionWeights: [await add('temporal', 'attention-weight', 8)],
      tensors: [await add('temporal', 'maskmem-temporal-embeddings', 9), await add('temporal', 'pointer-position-projection-weight', 10), await add('temporal', 'pointer-position-projection-bias', 11), await add('temporal', 'expected-temporal', 12 + dynamicOffset)],
      tolerances: { maximum: 0.001 },
    },
    episode: {
      schema: 'episode', shape: geometry?.episode || { channels: 256 }, plan: { frameIndex: 1 }, imageIngress: { tensorManifestSha256: `dynamic-ingress-${dynamicOffset}` }, fixture: { maskVariant: dynamicOffset }, stateTransition: { conditioningObjects: [0], frame1AppearingObjectCount: dynamicOffset }, reference,
      tensors: [await add('episode', 'frame-0-binary-mask-inputs', 13 + dynamicOffset), await add('episode', 'frame-0-extra-per-object-embedding', 14), await add('episode', 'frame-1-extra-per-object-embedding', 15), await add('episode', 'expected-episode', 16 + dynamicOffset)],
      tolerances: { maximum: 0.001 },
    },
    pointer: { schema: 'pointer', routeId: 'pointer-route', shape: { channels: 256 }, reference, weights: [await add('pointer', 'pointer-weight', 17)], tensors: [await add('pointer', 'expected-pointer', 18 + dynamicOffset)], tolerances: { maximum: 0.001 } },
  };
  const projection = await createSam31BrowserTrackerPackageProjection({ packets, sessionId, componentAuthorities: { ingress: { passed: true }, episode: { ingressBindingsPassed: true } } });
  const files = new Map([
    ['tracker-model-root.json', new TextEncoder().encode(projection.texts.modelRoot)],
    ['tracker-root.json', new TextEncoder().encode(projection.texts.root)],
    ['tracker-runtime-root.json', new TextEncoder().encode(projection.texts.runtimeRoot)],
    ['sam31-model-package.json', new TextEncoder().encode(projection.texts.modelPackage)],
    ['sam31-invocation.json', new TextEncoder().encode(projection.texts.invocation)],
    ['sam31-verification.json', new TextEncoder().encode(projection.texts.verification)],
  ]);
  for (const item of projection.materialization) files.set(item.targetFile, records[`${item.packetName}/${item.sourceFile}`]);
  return { projection, files };
}

const first = await fixture(0, 'session-a');
const second = await fixture(40, 'session-b');
await assert.rejects(
  () => fixture(80, 'session-incoherent-geometry', {
    ingress: {
      imageHeight: 56,
      imageWidth: 56,
      imageChannels: 3,
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
    episode: {
      batch: 1,
      multiplexCount: 16,
      queryHeight: 2,
      queryWidth: 2,
      queryTokens: 4,
      memorySpatialTokens: 4,
      numObjPtrTokens: 16,
      memoryTokens: 20,
      channels: 256,
      maskHeight: 8,
      maskWidth: 8,
    },
  }),
  /episode query geometry does not match ingress patch geometry/,
  'the model package must reject a reduced episode attached to a larger authenticated ingress geometry',
);
assert.equal(first.projection.modelPackage.packageId, second.projection.modelPackage.packageId, 'dynamic invocation bytes must not alter the reusable model package identity');
assert.notEqual(first.projection.invocation.invocationId, second.projection.invocation.invocationId, 'different images, mask, and session must alter invocation identity');
assert.deepEqual(
  first.projection.invocation.sourceImages.map(image => ({ originalSha256: image.originalSha256, rgbaSha256: image.rgbaSha256 })),
  [
    { originalSha256: `sha256:${String(1).padStart(64, '0')}`, rgbaSha256: first.projection.invocation.sourceImages[0].sha256 },
    { originalSha256: `sha256:${String(2).padStart(64, '0')}`, rgbaSha256: first.projection.invocation.sourceImages[1].sha256 },
  ],
  'the invocation must preserve encoded-image authority separately from its owned RGBA tensor bytes',
);

const stores = new Map([['one', first.files], ['two', second.files]]);
let networkReads = 0;
const fetchImpl = async url => {
  networkReads += 1;
  const parsed = new URL(url);
  const [, storeName, ...parts] = parsed.pathname.split('/');
  const bytes = stores.get(storeName)?.get(parts.join('/'));
  return {
    ok: Boolean(bytes), status: bytes ? 200 : 404,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};
const cache = createSam31BrowserTrackerPackageCache({ fetchImpl });
const modelOnlyReads = [];
const modelOnlyFetch = async url => {
  modelOnlyReads.push(new URL(url).pathname);
  return fetchImpl(url);
};
const modelOnlyCache = createSam31BrowserTrackerPackageCache({ fetchImpl: modelOnlyFetch });
const modelOnlyRuntime = await loadSam31BrowserTrackerModelPackageRuntime({
  rootUrl: 'https://example.test/one/tracker-model-root.json',
  pageUrl: 'https://example.test/smoke.html',
  fetchImpl: modelOnlyFetch,
  cache: modelOnlyCache,
});
assert.equal(modelOnlyRuntime.packageId, first.projection.modelPackage.packageId);
assert.equal(modelOnlyRuntime.modelPackage.schema, 'kaminos.sam31-browser-tracker-model-package.v0');
assert.equal(modelOnlyRuntime.packageResolution.modelPackage.sha256, first.projection.root.modelPackage.sha256);
assert.equal(modelOnlyRuntime.cacheEvidence().dynamicNetworkLoadCount, 0);
assert.equal(modelOnlyReads.some(path => path.endsWith('/sam31-invocation.json')), false, 'model-only loading must not fetch a prebuilt invocation manifest');
assert.equal(modelOnlyReads.some(path => path.endsWith('/sam31-verification.json')), false, 'model-only loading must not fetch verification');
await modelOnlyRuntime.loadFloat32(modelOnlyRuntime.modelPackage.components.decoder.weights[0]);
assert.equal(modelOnlyRuntime.cacheEvidence().staticNetworkLoadCount, 1);
await assert.rejects(
  () => loadSam31BrowserTrackerModelPackageRuntime({ rootUrl: 'https://example.test/one/tracker-root.json', pageUrl: 'https://example.test/smoke.html', fetchImpl: modelOnlyFetch, cache: createSam31BrowserTrackerPackageCache({ fetchImpl: modelOnlyFetch }) }),
  /model-only root must not contain invocation or verification references/,
  'a model-only public route must reject a root whose authority surface still carries invocation state',
);

const firstRuntime = await loadSam31BrowserTrackerPackageRuntime({ rootUrl: 'https://example.test/one/tracker-root.json', pageUrl: 'https://example.test/smoke.html', fetchImpl, cache });
assert.equal(firstRuntime.verificationAttached, true);
assert.deepEqual(firstRuntime.encodedSourceImageSha256, first.projection.invocation.sourceImages.map(image => image.originalSha256));
assert.deepEqual(firstRuntime.rgbaSourceImageSha256, first.projection.invocation.sourceImages.map(image => image.rgbaSha256));
assert.equal(firstRuntime.manifests.temporal.attentionWeights.length, 1);
assert.equal(firstRuntime.manifests.temporal.weights, undefined);
assert.equal(firstRuntime.manifests.episode.tensors.some(item => item.role === 'expected-episode'), true);
await firstRuntime.loadFloat32(firstRuntime.manifests.decoder.weights[0]);
await firstRuntime.loadUint8(firstRuntime.manifests.ingress.tensors.find(item => item.role === 'frame-0-rgba'));
const firstCacheEvidence = cache.evidence();
assert.equal(firstCacheEvidence.staticNetworkLoadCount, 1);
assert.equal(firstCacheEvidence.dynamicNetworkLoadCount, 1);
assert.equal(firstCacheEvidence.backingStore.kind, 'retained-memory');
assert.equal(firstCacheEvidence.backingStore.staticOriginNetworkLoadCount, 1, 'retained-memory evidence must expose the first static origin load');
assert.equal(firstCacheEvidence.backingStore.staticBackingStoreHitCount, 0);

const secondRuntime = await loadSam31BrowserTrackerPackageRuntime({ rootUrl: 'https://example.test/two/tracker-runtime-root.json', pageUrl: 'https://example.test/smoke.html', fetchImpl, cache });
assert.equal(secondRuntime.verificationAttached, false);
assert.equal(secondRuntime.manifests.episode.tensors.some(item => item.role === 'expected-episode'), false, 'verification-free runtime must not expose expected tensors');
await secondRuntime.loadFloat32(secondRuntime.manifests.decoder.weights[0]);
await secondRuntime.loadUint8(secondRuntime.manifests.ingress.tensors.find(item => item.role === 'frame-0-rgba'));
await secondRuntime.loadFloat32(secondRuntime.manifests.episode.tensors.find(item => item.role === 'frame-0-binary-mask-inputs'));
const secondCacheEvidence = cache.evidence();
assert.equal(secondCacheEvidence.staticNetworkLoadCount, firstCacheEvidence.staticNetworkLoadCount, 'second invocation must not reload static model bytes');
assert.equal(secondCacheEvidence.staticCacheHitCount, firstCacheEvidence.staticCacheHitCount + 1);
assert.equal(secondCacheEvidence.backingStore.staticOriginNetworkLoadCount, firstCacheEvidence.backingStore.staticOriginNetworkLoadCount, 'retained-memory reuse must not report a second origin load');
assert.equal(secondCacheEvidence.backingStore.staticBackingStoreHitCount, firstCacheEvidence.backingStore.staticBackingStoreHitCount + 1, 'retained-memory reuse must report the second static cache hit through backing evidence');
assert.equal(secondCacheEvidence.dynamicNetworkLoadCount, firstCacheEvidence.dynamicNetworkLoadCount + 2, 'fresh image and mask reads must remain invocation-scoped');
assert.equal(secondCacheEvidence.dynamicHashVerificationFailureCount, 0);
await assert.rejects(
  secondRuntime.loadFloat32({ role: 'undeclared', file: 'undeclared.bin', sha256: `sha256:${'0'.repeat(64)}`, byteLength: 4 }),
  /not declared by the authenticated package root/,
);
assert.ok(networkReads > secondCacheEvidence.dynamicNetworkLoadCount + secondCacheEvidence.staticNetworkLoadCount, 'manifest reads are separate from authenticated tensor cache accounting');

const backingFiles = new Map();
const backingEvents = [];
let backedOriginReads = 0;
const backedCache = createSam31BrowserTrackerPackageCache({
  fetchImpl: async url => {
    backedOriginReads += 1;
    return fetchImpl(url);
  },
  staticBackingStore: {
    kind: 'test-digest-store',
    async read(identity) {
      backingEvents.push(['read', identity]);
      const bytes = backingFiles.get(identity);
      return bytes ? bytes.slice(0) : null;
    },
    async write(identity, bytes) {
      backingEvents.push(['write', identity]);
      backingFiles.set(identity, bytes.slice(0));
    },
  },
});
const backedFirst = await loadSam31BrowserTrackerPackageRuntime({ rootUrl: 'https://example.test/one/tracker-root.json', pageUrl: 'https://example.test/smoke.html', fetchImpl, cache: backedCache });
await backedFirst.loadFloat32(backedFirst.manifests.decoder.weights[0]);
const backedAfterFirst = backedCache.evidence();
const backedSecond = await loadSam31BrowserTrackerPackageRuntime({ rootUrl: 'https://example.test/two/tracker-runtime-root.json', pageUrl: 'https://example.test/smoke.html', fetchImpl, cache: backedCache });
await backedSecond.loadFloat32(backedSecond.manifests.decoder.weights[0]);
const backedAfterSecond = backedCache.evidence();
assert.equal(backedOriginReads, 1, 'the second static load must not reach origin when the digest backing store has the artifact');
assert.equal(backedAfterFirst.backingStore.kind, 'test-digest-store');
assert.equal(backedAfterFirst.backingStore.staticOriginNetworkLoadCount, 1);
assert.equal(backedAfterFirst.backingStore.staticBackingStoreWriteCount, 1);
assert.equal(backedAfterSecond.backingStore.staticOriginNetworkLoadCount, 1);
assert.equal(backedAfterSecond.backingStore.staticBackingStoreHitCount, 1);
assert.equal(backingEvents.filter(([event]) => event === 'write').length, 1);
assert.equal(backingEvents.filter(([event]) => event === 'read').length, 2);

assert.equal(typeof trackerPackageRuntime.createSam31BrowserTrackerDualInvocationEvidence, 'function', 'the package runtime must own the cross-realm dual-invocation gate');
function invocationSummary({ invocationId, executionRealmId, verificationAttached, verificationId, encodedImageSha256, rgbaImageSha256, maskSha256, requestPrefix, outputPrefix, maskOutputSha256, cacheEvidence }) {
  return {
    executionRealmId,
    packageRuntime: {
      packageId: 'sam31-tracker-model-package:fixture', invocationId, verificationId,
      sourceImageSha256: rgbaImageSha256,
      encodedSourceImageSha256: encodedImageSha256,
      rgbaSourceImageSha256: rgbaImageSha256,
      initialMaskSha256: maskSha256,
      session: { conditioningFrameIndex: 0, propagationFrameIndices: [1], conditioningObjects: [0] },
      cacheEvidence,
    },
    verificationAttached,
    parity: verificationAttached ? { maximums: {} } : null,
    requestIds: Array.from({ length: 19 }, (_, index) => `${requestPrefix}-${index}`),
    receipts: Array.from({ length: 19 }, (_, index) => ({
      status: 'real', fallbackReason: null, effectiveRouteId: `route-${index}`,
      outputs: [{ role: index === 18 ? 'sam31-multiplex-selected-masks' : `output-${index}`, artifactId: `${outputPrefix}-${index}`, sha256: index === 18 ? maskOutputSha256 : `${outputPrefix}-sha-${index}` }],
    })),
    evidence: { routeChainPassed: true },
    trackerState: {
      version: 1,
      conditioningFrameIndices: [0],
      nonConditioningFrameIndices: [],
      frames: [{
        frameIndex: 0,
        kind: 'conditioning',
        conditioningObjects: [0],
        tensorDigests: {
          memory: `${outputPrefix}-state-memory`,
          memoryPosition: 'deterministic-memory-position',
          image: `${outputPrefix}-state-image`,
          imagePosition: 'deterministic-image-position',
          pointers: `${outputPrefix}-state-pointers`,
          maskLogits: `${outputPrefix}-state-mask`,
          objectScores: 'deterministic-object-scores',
        },
      }],
    },
    deviceLoss: null,
  };
}
const firstInvocationSummary = invocationSummary({
  invocationId: 'invocation-a', executionRealmId: 'realm-a', verificationAttached: true, verificationId: 'verification-a',
  encodedImageSha256: ['encoded-a0', 'encoded-a1'], rgbaImageSha256: ['rgba-a0', 'rgba-a1'], maskSha256: 'mask-a', requestPrefix: 'request-a', outputPrefix: 'output-a', maskOutputSha256: 'result-a',
  cacheEvidence: { staticNetworkLoadCount: 1, staticCacheHitCount: 0, dynamicNetworkLoadCount: 2, backingStore: { staticOriginNetworkLoadCount: 1, staticBackingStoreHitCount: 0 } },
});
const secondInvocationSummary = invocationSummary({
  invocationId: 'invocation-b', executionRealmId: 'realm-b', verificationAttached: false, verificationId: null,
  encodedImageSha256: ['encoded-b0', 'encoded-b1'], rgbaImageSha256: ['rgba-b0', 'rgba-b1'], maskSha256: 'mask-b', requestPrefix: 'request-b', outputPrefix: 'output-b', maskOutputSha256: 'result-b',
  cacheEvidence: { staticNetworkLoadCount: 1, staticCacheHitCount: 1, dynamicNetworkLoadCount: 4, backingStore: { staticOriginNetworkLoadCount: 1, staticBackingStoreHitCount: 1 } },
});
const dualEvidence = trackerPackageRuntime.createSam31BrowserTrackerDualInvocationEvidence({
  invocations: [firstInvocationSummary, secondInvocationSummary],
  betweenInvocationCheckpoints: [{ afterInvocationIndex: 0, realmRemoved: true, passed: true }],
});
assert.equal(dualEvidence.passed, true);
assert.equal(dualEvidence.sameModelPackage, true);
assert.equal(dualEvidence.secondVerificationFree, true);
assert.equal(dualEvidence.noSecondStaticOriginNetworkLoads, true);
assert.equal(dualEvidence.distinctEncodedSourceImages, true);
assert.equal(dualEvidence.distinctRgbaSourceImages, true);
assert.equal(dualEvidence.trackerStateShapePassed, true);
assert.equal(dualEvidence.distinctCausalTrackerState, true);
assert.equal(dualEvidence.deterministicTrackerStateShared, true);
assert.deepEqual(dualEvidence.causalTrackerStateDigestNames, ['memory', 'image', 'pointers', 'maskLogits']);
assert.deepEqual(dualEvidence.deterministicTrackerStateDigestNames, ['memoryPosition', 'imagePosition', 'objectScores']);
assert.equal(dualEvidence.stateIsolationPassed, true);

const encodedReuse = structuredClone(secondInvocationSummary);
encodedReuse.packageRuntime.encodedSourceImageSha256 = firstInvocationSummary.packageRuntime.encodedSourceImageSha256.slice();
const encodedReuseEvidence = trackerPackageRuntime.createSam31BrowserTrackerDualInvocationEvidence({
  invocations: [firstInvocationSummary, encodedReuse],
  betweenInvocationCheckpoints: [{ afterInvocationIndex: 0, realmRemoved: true, passed: true }],
});
assert.equal(encodedReuseEvidence.distinctEncodedSourceImages, false, 'encoded-image reuse must fail even when resized RGBA bytes differ');
assert.equal(encodedReuseEvidence.passed, false);

const rgbaReuse = structuredClone(secondInvocationSummary);
rgbaReuse.packageRuntime.rgbaSourceImageSha256 = firstInvocationSummary.packageRuntime.rgbaSourceImageSha256.slice();
rgbaReuse.packageRuntime.sourceImageSha256 = rgbaReuse.packageRuntime.rgbaSourceImageSha256;
const rgbaReuseEvidence = trackerPackageRuntime.createSam31BrowserTrackerDualInvocationEvidence({
  invocations: [firstInvocationSummary, rgbaReuse],
  betweenInvocationCheckpoints: [{ afterInvocationIndex: 0, realmRemoved: true, passed: true }],
});
assert.equal(rgbaReuseEvidence.distinctRgbaSourceImages, false, 'resized RGBA reuse must fail independently of encoded-image identity');
assert.equal(rgbaReuseEvidence.passed, false);

for (const digestName of ['memory', 'image', 'pointers', 'maskLogits']) {
  const reusedState = structuredClone(secondInvocationSummary);
  reusedState.trackerState.frames[0].tensorDigests[digestName] = firstInvocationSummary.trackerState.frames[0].tensorDigests[digestName];
  const reusedStateEvidence = trackerPackageRuntime.createSam31BrowserTrackerDualInvocationEvidence({
    invocations: [firstInvocationSummary, reusedState],
    betweenInvocationCheckpoints: [{ afterInvocationIndex: 0, realmRemoved: true, passed: true }],
  });
  assert.equal(reusedStateEvidence.distinctCausalTrackerState, false, `${digestName} reuse must fail the causal state gate`);
  assert.equal(reusedStateEvidence.stateIsolationPassed, false);
  assert.equal(reusedStateEvidence.passed, false);
}

const carriedFrame = structuredClone(secondInvocationSummary);
carriedFrame.trackerState.nonConditioningFrameIndices = [1];
carriedFrame.trackerState.frames.push({ frameIndex: 1, kind: 'non-conditioning', conditioningObjects: [], tensorDigests: {} });
const carriedFrameEvidence = trackerPackageRuntime.createSam31BrowserTrackerDualInvocationEvidence({
  invocations: [firstInvocationSummary, carriedFrame],
  betweenInvocationCheckpoints: [{ afterInvocationIndex: 0, realmRemoved: true, passed: true }],
});
assert.equal(carriedFrameEvidence.trackerStateShapePassed, false, 'carried non-conditioning frames must fail fresh-session shape');
assert.equal(carriedFrameEvidence.stateIsolationPassed, false);
assert.equal(carriedFrameEvidence.passed, false);

const changedDeterministicDigest = structuredClone(secondInvocationSummary);
changedDeterministicDigest.trackerState.frames[0].tensorDigests.imagePosition = 'changed-image-position';
const changedDeterministicEvidence = trackerPackageRuntime.createSam31BrowserTrackerDualInvocationEvidence({
  invocations: [firstInvocationSummary, changedDeterministicDigest],
  betweenInvocationCheckpoints: [{ afterInvocationIndex: 0, realmRemoved: true, passed: true }],
});
assert.equal(changedDeterministicEvidence.deterministicTrackerStateShared, false);
assert.equal(changedDeterministicEvidence.stateIsolationPassed, false);
assert.equal(changedDeterministicEvidence.passed, false);

console.log('sam3.1 browser tracker package runtime contracts passed');
