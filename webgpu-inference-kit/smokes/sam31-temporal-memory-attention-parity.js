import {
  classifySam31MemoryAttentionAdapter,
  createRouteInvocationRequest,
  createSam31MemoryAttentionPhaseProgramRouteDefinition,
  createSam31TemporalMemoryBankPhaseProgramRouteDefinition,
  createSam31TemporalMemoryBankPlan,
  runSam31MemoryAttentionPhaseProgramRoute,
  runSam31TemporalMemoryBankPhaseProgramRoute,
  verifySam31PacketFloat32Bytes,
} from '../src/index.js';

const params = new URLSearchParams(location.search);
const manifestUrl = params.get('manifest') || '/oracle/tensor-manifest.json';
const statusElement = document.querySelector('#status');
let state = { status: 'loading', phase: 'load-manifest', requestedManifestUrl: manifestUrl };
window.sam31TemporalMemoryAttentionParitySmokeState = () => state;

function updateStatus(status, phase, extra = {}) {
  state = { ...state, ...extra, status, phase };
  document.body.dataset.status = status;
  statusElement.textContent = JSON.stringify(state, null, 2);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.json();
}

async function fetchFloat32(entry) {
  const response = await fetch(`/oracle/${entry.file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch /oracle/${entry.file} failed ${response.status}`);
  return verifySam31PacketFloat32Bytes(entry, await response.arrayBuffer());
}

function maxAbsDiff(actual, expected) {
  if (actual.length !== expected.length) throw new Error(`tensor length mismatch ${actual.length} != ${expected.length}`);
  let maximum = 0;
  for (let index = 0; index < actual.length; index += 1) {
    if (!Number.isFinite(actual[index]) || !Number.isFinite(expected[index])) throw new Error(`non-finite parity value at ${index}`);
    maximum = Math.max(maximum, Math.abs(Number(actual[index]) - Number(expected[index])));
  }
  return maximum;
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function serializeAdapterInfo(adapter) {
  const info = adapter.info;
  const classified = classifySam31MemoryAttentionAdapter({
    explicitFallback: typeof adapter.isFallbackAdapter === 'boolean' ? adapter.isFallbackAdapter : undefined,
    vendor: info?.vendor,
    architecture: info?.architecture,
  });
  return {
    description: String(info?.description || ''),
    vendor: String(info?.vendor || ''),
    architecture: String(info?.architecture || ''),
    device: String(info?.device || ''),
    ...classified,
  };
}

function splitFrames(values, count, frameLength, frameIndices, key) {
  if (values.length !== count * frameLength) throw new Error(`${key} aggregate length mismatch`);
  return Array.from({ length: count }, (_, index) => ({
    frameIndex: frameIndices[index],
    [key]: values.slice(index * frameLength, (index + 1) * frameLength),
  }));
}

function assertArrayEqual(actual, expected, name) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`${name} mismatch: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

async function run() {
  const manifest = await fetchJson(manifestUrl);
  if (manifest.schema !== 'kaminos.sam31-temporal-memory-bank-meta-packet.v0') throw new Error(`unsupported manifest schema ${manifest.schema}`);
  const tensorsByRole = Object.fromEntries(manifest.tensors.map(entry => [entry.role, entry]));
  const weightsByRole = Object.fromEntries(manifest.attentionWeights.map(entry => [entry.role, entry]));
  const tensor = role => fetchFloat32(tensorsByRole[role]);
  const weight = role => fetchFloat32(weightsByRole[role]);

  const plan = createSam31TemporalMemoryBankPlan({
    frameIndex: manifest.plan.frameIndex,
    numFrames: manifest.plan.numFrames,
    conditioningFrameIndices: manifest.plan.conditioningFrameIndices,
    nonConditioningFrameIndices: manifest.plan.nonConditioningFrameIndices,
    frameTokenCount: manifest.shape.frameTokens,
    multiplexCount: manifest.shape.multiplexCount,
    numMaskmem: manifest.plan.numMaskmem,
    maxConditioningFrames: manifest.plan.maxConditioningFrames,
    maxObjectPointerFrames: 16,
    memoryTemporalStride: manifest.plan.memoryTemporalStride,
    useMaskmemTemporalPositionV2: manifest.plan.useMaskmemTemporalPositionV2,
    trackInReverse: manifest.plan.trackInReverse,
  });
  assertArrayEqual(plan.selectedConditioningFrameIndices, manifest.plan.selectedConditioningFrameIndices, 'selected conditioning frames');
  assertArrayEqual(plan.spatialFrames.map(frame => frame.frameIndex), manifest.plan.spatialFrameIndices, 'spatial frames');
  assertArrayEqual(plan.spatialFrames.map(frame => frame.temporalPositionIndex), manifest.plan.spatialTemporalPositionIndices, 'spatial temporal indices');
  assertArrayEqual(plan.pointerFrames.map(frame => frame.frameIndex), manifest.plan.pointerFrameIndices, 'pointer frames');
  assertArrayEqual(plan.pointerFrames.map(frame => frame.relativePosition), manifest.plan.pointerRelativePositions, 'pointer relative positions');

  updateStatus('running', 'request-adapter', { packetManifest: manifest, manifest: { schema: manifest.schema, boundary: manifest.boundary, reference: manifest.reference, checkpointAudit: manifest.checkpointAudit, plan: manifest.plan, shape: manifest.shape } });
  if (!navigator.gpu) throw new Error('navigator.gpu is unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const uncapturedErrors = [];
  device.addEventListener('uncapturederror', event => uncapturedErrors.push(String(event.error?.message || event.error || 'unknown WebGPU error')));
  const adapterInfo = serializeAdapterInfo(adapter);
  const adapterName = adapterInfo.description || adapterInfo.device || 'browser-webgpu-adapter';

  const frameLength = manifest.shape.batch * manifest.shape.frameTokens * manifest.shape.channels;
  const pointerFrameLength = manifest.shape.batch * manifest.shape.multiplexCount * manifest.shape.channels;
  const spatialMemory = splitFrames(await tensor('spatial-frame-memory'), manifest.shape.spatialFrameCount, frameLength, manifest.plan.spatialFrameIndices, 'memory');
  const spatialMemoryPos = splitFrames(await tensor('spatial-frame-memory-pos'), manifest.shape.spatialFrameCount, frameLength, manifest.plan.spatialFrameIndices, 'memoryPosition');
  const spatialImage = splitFrames(await tensor('spatial-frame-image'), manifest.shape.spatialFrameCount, frameLength, manifest.plan.spatialFrameIndices, 'image');
  const spatialImagePos = splitFrames(await tensor('spatial-frame-image-pos'), manifest.shape.spatialFrameCount, frameLength, manifest.plan.spatialFrameIndices, 'imagePosition');
  const spatialFrames = plan.spatialFrames.map((frame, index) => ({ ...spatialMemory[index], ...spatialMemoryPos[index], ...spatialImage[index], ...spatialImagePos[index], frameIndex: frame.frameIndex }));
  const pointerFrames = splitFrames(await tensor('pointer-frame-values'), manifest.shape.pointerFrameCount, pointerFrameLength, manifest.plan.pointerFrameIndices, 'pointers');
  const temporalEmbeddings = await tensor('maskmem-temporal-embeddings');
  const pointerPositionProjection = { weight: await tensor('pointer-position-projection-weight'), bias: await tensor('pointer-position-projection-bias') };

  const episodeHash = await sha256Text(JSON.stringify(manifest.plan));
  const spatialHash = await sha256Text(['spatial-frame-memory', 'spatial-frame-memory-pos', 'spatial-frame-image', 'spatial-frame-image-pos'].map(role => `${role}:${tensorsByRole[role].sha256}`).join('\n'));
  const pointerHash = await sha256Text(`pointer-frame-values:${tensorsByRole['pointer-frame-values'].sha256}`);
  const temporalWeightsHash = await sha256Text(['maskmem-temporal-embeddings', 'pointer-position-projection-weight', 'pointer-position-projection-bias'].map(role => `${role}:${tensorsByRole[role].sha256}`).join('\n'));
  const temporalRoute = createSam31TemporalMemoryBankPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-temporal-memory-bank-phase-program-v0', commit: params.get('commit') || null } });
  const temporalRequest = createRouteInvocationRequest(temporalRoute, {
    requestId: `sam31-temporal-memory-${Date.now()}`,
    inputs: {
      'source-video-episode': { artifactId: `sam31-temporal-episode:${manifest.fixture.seed}`, sha256: episodeHash, shape: [manifest.plan.numFrames] },
      'sam31-temporal-spatial-memory-frames': { artifactId: 'sam31-temporal-spatial-frames:official-packet', sha256: spatialHash, shape: [manifest.shape.spatialFrameCount, manifest.shape.batch, manifest.shape.frameTokens, manifest.shape.channels] },
      'sam31-temporal-object-pointer-frames': { artifactId: 'sam31-temporal-pointer-frames:official-packet', sha256: pointerHash, shape: [manifest.shape.pointerFrameCount, manifest.shape.batch, manifest.shape.multiplexCount, manifest.shape.channels] },
      'sam31-temporal-memory-position-weights': { artifactId: 'sam31-temporal-position-weights:official-checkpoint', sha256: temporalWeightsHash, mappedTensorCount: 3 },
    },
    outputs: { 'sam31-temporal-memory-attention-bank': { artifactId: 'sam31-temporal-memory-attention-bank:browser', shape: [manifest.shape.batch, manifest.shape.memoryTokens, manifest.shape.channels] } },
    routeConfig: { plan: manifest.plan, reference: manifest.reference },
  });
  updateStatus('running', 'run-temporal-memory-bank', { adapterInfo, requestedTemporalRouteId: manifest.routeId });
  const temporalResult = await runSam31TemporalMemoryBankPhaseProgramRoute({
    request: temporalRequest,
    route: temporalRoute,
    adapter,
    device,
    queue: device.queue,
    adapterName,
    browser: navigator.userAgent,
    kernel: temporalRoute.kernel,
    model: { revision: manifest.reference.model.revision, weightsHash: temporalWeightsHash },
    plan,
    spatialFrames,
    pointerFrames,
    temporalEmbeddings,
    pointerPositionProjection,
    channels: manifest.shape.channels,
    batch: manifest.shape.batch,
    multiplexCount: manifest.shape.multiplexCount,
    includeReadback: true,
  });
  const bank = {
    memoryImage: new Float32Array(temporalResult.debugReadback.memoryImage),
    memory: new Float32Array(temporalResult.debugReadback.memory),
    memoryImagePos: new Float32Array(temporalResult.debugReadback.memoryImagePosition),
    memoryPos: new Float32Array(temporalResult.debugReadback.memoryPosition),
  };
  const assemblyParity = {
    memoryImage: maxAbsDiff(bank.memoryImage, await tensor('assembled-memory-image')),
    memory: maxAbsDiff(bank.memory, await tensor('assembled-memory')),
    memoryImagePosition: maxAbsDiff(bank.memoryImagePos, await tensor('assembled-memory-image-pos')),
    memoryPosition: maxAbsDiff(bank.memoryPos, await tensor('assembled-memory-pos')),
  };
  const assemblyMaxAbsDiff = Math.max(...Object.values(assemblyParity));

  const projection = async (prefix, inChannels, outChannels) => ({ weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), inChannels, outChannels });
  const norm = async prefix => ({ weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), epsilon: 1e-5 });
  const layers = [];
  for (let index = 0; index < 4; index += 1) {
    const prefix = `layer-${index}`;
    layers.push({
      norm1: await norm(`${prefix}-norm1`), selfQ: await projection(`${prefix}-self-q`, 256, 256), selfK: await projection(`${prefix}-self-k`, 256, 256), selfV: await projection(`${prefix}-self-v`, 256, 256), selfOut: await projection(`${prefix}-self-out`, 256, 256),
      norm2: await norm(`${prefix}-norm2`), crossQ: await projection(`${prefix}-cross-q`, 256, 256), crossK: await projection(`${prefix}-cross-k`, 256, 256), crossV: await projection(`${prefix}-cross-v`, 256, 256), crossOut: await projection(`${prefix}-cross-out`, 256, 256), imageCrossQ: await projection(`${prefix}-image-cross-q`, 256, 256), imageCrossK: await projection(`${prefix}-image-cross-k`, 256, 256),
      norm3: await norm(`${prefix}-norm3`), linear1: await projection(`${prefix}-linear1`, 256, 2048), linear2: await projection(`${prefix}-linear2`, 2048, 256),
    });
  }
  const finalNorm = await norm('final-norm');
  const current = { image: await tensor('current-image'), src: await tensor('current-src'), srcPos: await tensor('current-src-pos') };
  const attentionShape = { batch: 1, queryHeight: 2, queryWidth: 2, queryTokens: 4, memorySpatialTokens: 36, numObjPtrTokens: 160, memoryTokens: 196, channels: 256, heads: 8, headDim: 32, mlpHidden: 2048, layerCount: 4 };
  const attentionWeightsHash = await sha256Text(manifest.attentionWeights.map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const currentHash = await sha256Text(['current-image', 'current-src', 'current-src-pos'].map(role => `${role}:${tensorsByRole[role].sha256}`).join('\n'));
  const temporalOutput = temporalResult.receipt.outputs.find(output => output.role === 'sam31-temporal-memory-attention-bank');
  const attentionRoute = createSam31MemoryAttentionPhaseProgramRouteDefinition({ shape: attentionShape, model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-memory-attention-phase-program-v0', commit: params.get('commit') || null } });
  const attentionRequest = createRouteInvocationRequest(attentionRoute, {
    requestId: `sam31-temporal-attention-${Date.now()}`,
    inputs: {
      'source-image': { artifactId: `sam31-temporal-episode:${manifest.fixture.seed}`, sha256: episodeHash, shape: [manifest.plan.numFrames] },
      'sam31-memory-attention-current-tensors': { artifactId: 'sam31-memory-attention-current:official-video-packet', sha256: currentHash, shape: [1, 4, 256] },
      'sam31-memory-attention-bank-tensors': { artifactId: temporalOutput.artifactId, sha256: temporalOutput.sha256, shape: [1, 196, 256] },
      'sam31-memory-attention-weights': { artifactId: 'sam31-memory-attention-weights:official-checkpoint', sha256: attentionWeightsHash, mappedTensorCount: 122 },
    },
    outputs: { 'sam31-memory-conditioned-features': { artifactId: 'sam31-memory-conditioned-features:browser-temporal-episode', shape: [1, 4, 256] } },
    routeConfig: { numObjPtrTokens: 160, upstreamTemporalReceipt: temporalResult.receipt.receiptId },
  });
  updateStatus('running', 'run-memory-attention', { adapterInfo, requestedTemporalRouteId: manifest.routeId, effectiveTemporalRouteId: temporalResult.receipt.effectiveRouteId, temporalReceipt: temporalResult.receipt, assemblyParity, assemblyMaxAbsDiff, requestedAttentionRouteId: attentionRoute.routeId });
  const attentionResult = await runSam31MemoryAttentionPhaseProgramRoute({
    request: attentionRequest,
    route: attentionRoute,
    adapter,
    device,
    queue: device.queue,
    adapterName,
    browser: navigator.userAgent,
    kernel: attentionRoute.kernel,
    model: { revision: manifest.reference.model.revision, weightsHash: attentionWeightsHash },
    tensors: { shape: attentionShape, current, bank, layers, finalNorm },
    includeReadback: true,
  });
  const conditionedFeaturesMaxAbsDiff = maxAbsDiff(new Float32Array(attentionResult.debugReadback.memory), await tensor('expected-memory-conditioned-features'));
  const requestedTemporalRouteId = manifest.routeId;
  const effectiveTemporalRouteId = temporalResult.receipt.effectiveRouteId;
  const requestedAttentionRouteId = attentionRoute.routeId;
  const effectiveAttentionRouteId = attentionResult.receipt.effectiveRouteId;
  const evidence = {
    adapterPassed: adapterInfo.isFallbackAdapter === false,
    temporalReceiptPassed: temporalResult.receipt.status === 'real' && temporalResult.receipt.fallbackReason == null,
    attentionReceiptPassed: attentionResult.receipt.status === 'real' && attentionResult.receipt.fallbackReason == null,
    temporalRoutePassed: requestedTemporalRouteId === effectiveTemporalRouteId,
    attentionRoutePassed: requestedAttentionRouteId === effectiveAttentionRouteId,
    assemblyPassed: assemblyMaxAbsDiff <= manifest.tolerances.webGpuAssemblyMaxAbsDiff,
    conditionedFeaturesPassed: conditionedFeaturesMaxAbsDiff <= manifest.tolerances.webGpuConditionedFeaturesMaxAbsDiff,
    errorsPassed: uncapturedErrors.length === 0,
  };
  evidence.passed = Object.values(evidence).every(Boolean);
  const final = {
    adapterInfo,
    requestedTemporalRouteId,
    effectiveTemporalRouteId,
    requestedAttentionRouteId,
    effectiveAttentionRouteId,
    temporalReceipt: temporalResult.receipt,
    attentionReceipt: attentionResult.receipt,
    parity: { assemblyMaxAbsDiff, assemblyByTensor: assemblyParity, conditionedFeaturesMaxAbsDiff },
    packet: { spatialFrameCount: 9, pointerFrameCount: 10, numObjPtrTokens: 160, memoryTokens: 196, memoryAttentionTensorCount: 122 },
    evidence,
    uncapturedErrors,
  };
  if (!evidence.passed) throw Object.assign(new Error(`temporal memory-attention evidence failed: ${JSON.stringify(evidence)}`), { evidenceState: final });
  updateStatus('passed', 'complete', final);
}

run().catch(error => {
  console.error(error);
  updateStatus('failed', state.phase, { ...(error.evidenceState || {}), error: String(error?.stack || error) });
});
