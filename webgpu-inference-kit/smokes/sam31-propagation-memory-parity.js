import {
  createRouteInvocationRequest,
  classifySam31PropagationMemoryAdapter,
  createSam31MemoryEncoderPhaseProgramRouteDefinition,
  createSam31PropagationNeckPhaseProgramRouteDefinition,
  evaluateSam31PropagationMemoryEvidence,
  runSam31MemoryEncoderPhaseProgramRoute,
  runSam31PropagationNeckPhaseProgramRoute,
} from '../src/index.js';

const params = new URLSearchParams(location.search);
const manifestUrl = params.get('manifest') || '/oracle/tensor-manifest.json';
const statusElement = document.querySelector('#status');
let state = { status: 'loading', phase: 'load-manifest', requestedManifestUrl: manifestUrl };
window.sam31PropagationMemoryParitySmokeState = () => state;

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

async function fetchFloat32(file) {
  const response = await fetch(`/oracle/${file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch /oracle/${file} failed ${response.status}`);
  return new Float32Array(await response.arrayBuffer());
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
  const fallback = classifySam31PropagationMemoryAdapter({
    explicitFallback: typeof adapter.isFallbackAdapter === 'boolean' ? adapter.isFallbackAdapter : undefined,
    vendor: info?.vendor,
    architecture: info?.architecture,
  });
  const serialized = {
    description: String(info?.description || ''),
    vendor: String(info?.vendor || ''),
    architecture: String(info?.architecture || ''),
    device: String(info?.device || ''),
    ...fallback,
  };
  if (!serialized.description && !serialized.vendor && !serialized.architecture && !serialized.device) {
    serialized.description = 'browser-webgpu-adapter';
  }
  return serialized;
}

async function run() {
  const manifest = await fetchJson(manifestUrl);
  if (manifest.schema !== 'kaminos.sam31-propagation-memory-meta-packet.v0') throw new Error(`unsupported manifest schema ${manifest.schema}`);
  const tensorsByRole = Object.fromEntries(manifest.tensors.map(entry => [entry.role, entry]));
  const weightsByRole = Object.fromEntries(manifest.weights.map(entry => [entry.role, entry]));
  const tensor = role => fetchFloat32(tensorsByRole[role].file);
  const weight = role => fetchFloat32(weightsByRole[role].file);
  const conv = async (prefix, { stride = 1, padding = 0, activation = null, groups = 1 } = {}) => {
    const entry = weightsByRole[`${prefix}-weight`];
    const [outChannels, kernelSize, , maybeInChannels] = entry.shape;
    return {
      weight: await weight(`${prefix}-weight`),
      bias: await weight(`${prefix}-bias`),
      kernelSize,
      stride,
      padding,
      inChannels: maybeInChannels ?? outChannels,
      outChannels,
      activation,
      groups,
    };
  };

  updateStatus('running', 'request-adapter', { manifest: { schema: manifest.schema, boundary: manifest.boundary, reference: manifest.reference, checkpointAudit: manifest.checkpointAudit } });
  if (!navigator.gpu) throw new Error('navigator.gpu is unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const uncapturedErrors = [];
  device.addEventListener('uncapturederror', event => uncapturedErrors.push(String(event.error?.message || event.error || 'unknown WebGPU error')));
  const adapterInfo = serializeAdapterInfo(adapter);
  const adapterName = adapterInfo.description || adapterInfo.device || 'browser-webgpu-adapter';

  const propagationWeights = { levels: [
    { level: 0, scaleLayers: [await conv('propagation-level-0-scale-0', { stride: 2, activation: 'gelu' }), await conv('propagation-level-0-scale-1', { stride: 2 })], proj1: await conv('propagation-level-0-proj1'), proj2: await conv('propagation-level-0-proj2', { padding: 1 }) },
    { level: 1, scaleLayers: [await conv('propagation-level-1-scale-0', { stride: 2 })], proj1: await conv('propagation-level-1-proj1'), proj2: await conv('propagation-level-1-proj2', { padding: 1 }) },
    { level: 2, scaleLayers: [], proj1: await conv('propagation-level-2-proj1'), proj2: await conv('propagation-level-2-proj2', { padding: 1 }) },
  ] };
  const backbone = await tensor('vit-backbone-hidden-states');
  const sourceArtifact = { artifactId: `sam31-source:${manifest.fixture.seed}`, sha256: await sha256Text(`sam31-source:${manifest.fixture.seed}`), shape: [1, 3, 32, 32] };
  const propagationWeightsSha = await sha256Text(manifest.weights.filter(entry => entry.role.startsWith('propagation-')).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const propagationRoute = createSam31PropagationNeckPhaseProgramRouteDefinition({
    model: { revision: manifest.reference.model.revision, dtype: 'fp32' },
    kernel: { profile: 'sam31-propagation-neck-phase-program-v0', commit: params.get('commit') || null },
  });
  const propagationRequest = createRouteInvocationRequest(propagationRoute, {
    requestId: `sam31-propagation-${Date.now()}`,
    inputs: {
      'source-image': sourceArtifact,
      'sam31-vit-backbone-hidden-states': { artifactId: 'sam31-vit-backbone-hidden-states:official-packet', sha256: tensorsByRole['vit-backbone-hidden-states'].sha256, shape: tensorsByRole['vit-backbone-hidden-states'].shape },
      'sam31-propagation-neck-weights': { artifactId: 'sam31-propagation-neck-weights:official-packet', sha256: propagationWeightsSha },
    },
    outputs: Object.fromEntries(manifest.shape.levels.map(level => [`sam31-propagation-feature-${level.level}`, { artifactId: `sam31-propagation-feature-${level.level}:browser`, shape: [manifest.shape.batch, level.height, level.width, manifest.shape.fpnHiddenSize] }])),
    routeConfig: { reference: manifest.reference, packetBoundary: manifest.boundary },
  });
  updateStatus('running', 'run-propagation', { adapterInfo, requestedRouteIds: manifest.routeIds });
  const propagationResult = await runSam31PropagationNeckPhaseProgramRoute({
    request: propagationRequest,
    route: propagationRoute,
    device,
    queue: device.queue,
    adapterName,
    browser: navigator.userAgent,
    kernel: propagationRoute.kernel,
    model: { revision: manifest.reference.model.revision, weightsHash: propagationWeightsSha, dtype: 'fp32' },
    tensors: { backboneHiddenStates: backbone, weights: propagationWeights, shape: manifest.shape },
    includeReadback: true,
  });
  const propagationFeatures = [0, 1, 2].map(level => new Float32Array(propagationResult.debugReadback[`propagationFeature${level}`]));
  const propagationDiffs = [];
  for (let level = 0; level < 3; level += 1) propagationDiffs.push(maxAbsDiff(propagationFeatures[level], await tensor(`expected-propagation-feature-${level}`)));

  const memoryShape = manifest.shape.memory;
  const memoryWeights = { downsampleLayers: [], fuserLayers: [] };
  for (let level = 0; level < 4; level += 1) {
    memoryWeights.downsampleLayers.push({
      conv: await conv(`memory-downsample-${level}-conv`, { stride: 2, padding: 1 }),
      layerNorm: { weight: await weight(`memory-downsample-${level}-norm-weight`), bias: await weight(`memory-downsample-${level}-norm-bias`), epsilon: 1e-6 },
    });
  }
  memoryWeights.maskFinal = await conv('memory-mask-final');
  memoryWeights.featureProjection = await conv('memory-feature-projection');
  for (let level = 0; level < 2; level += 1) {
    const depthwise = await conv(`memory-fuser-${level}-depthwise`, { padding: 3, groups: 256 });
    depthwise.inChannels = 256;
    memoryWeights.fuserLayers.push({
      depthwise,
      layerNorm: { weight: await weight(`memory-fuser-${level}-norm-weight`), bias: await weight(`memory-fuser-${level}-norm-bias`), epsilon: 1e-6 },
      pointwise1: { weight: await weight(`memory-fuser-${level}-pointwise-1-weight`), bias: await weight(`memory-fuser-${level}-pointwise-1-bias`), inChannels: 256, outChannels: 1024 },
      pointwise2: { weight: await weight(`memory-fuser-${level}-pointwise-2-weight`), bias: await weight(`memory-fuser-${level}-pointwise-2-bias`), inChannels: 1024, outChannels: 256 },
      scale: await weight(`memory-fuser-${level}-scale`),
    });
  }
  memoryWeights.noObjectSpatialEmbedding = await weight('memory-no-object-spatial-embedding');
  const maskLogits = await tensor('multiplex-mask-logits');
  const conditioning = await tensor('multiplex-conditioning');
  const objectScores = await tensor('multiplex-object-scores');
  const memoryWeightsSha = await sha256Text(manifest.weights.filter(entry => entry.role.startsWith('memory-')).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const propagationOutput2 = propagationResult.receipt.outputs.find(output => output.role === 'sam31-propagation-feature-2');
  const memoryRoute = createSam31MemoryEncoderPhaseProgramRouteDefinition({
    model: { revision: manifest.reference.model.revision, dtype: 'fp32' },
    kernel: { profile: 'sam31-memory-encoder-phase-program-v0', commit: params.get('commit') || null },
  });
  const outputShape = [manifest.shape.batch, memoryShape.featureHeight, memoryShape.featureWidth, memoryShape.featureChannels];
  const memoryRequest = createRouteInvocationRequest(memoryRoute, {
    requestId: `sam31-memory-${Date.now()}`,
    inputs: {
      'source-image': sourceArtifact,
      'sam31-propagation-feature-2': { artifactId: propagationOutput2.artifactId, sha256: propagationOutput2.sha256, shape: propagationOutput2.shape },
      'sam31-multiplex-mask-logits': { artifactId: 'sam31-multiplex-mask-logits:official-packet', sha256: tensorsByRole['multiplex-mask-logits'].sha256, shape: tensorsByRole['multiplex-mask-logits'].shape },
      'sam31-multiplex-conditioning': { artifactId: 'sam31-multiplex-conditioning:official-packet', sha256: tensorsByRole['multiplex-conditioning'].sha256, shape: tensorsByRole['multiplex-conditioning'].shape },
      'sam31-multiplex-object-scores': { artifactId: 'sam31-multiplex-object-scores:official-packet', sha256: tensorsByRole['multiplex-object-scores'].sha256, shape: tensorsByRole['multiplex-object-scores'].shape },
      'sam31-memory-encoder-weights': { artifactId: 'sam31-memory-encoder-weights:official-packet', sha256: memoryWeightsSha },
    },
    outputs: {
      'sam31-mask-memory-features': { artifactId: 'sam31-mask-memory-features:browser', shape: outputShape },
      'sam31-mask-memory-position-encoding': { artifactId: 'sam31-mask-memory-position-encoding:browser', shape: outputShape },
    },
    routeConfig: { reference: manifest.reference, composedFrom: propagationResult.receipt.effectiveRouteId, propagationOutput2 },
  });
  updateStatus('running', 'run-memory', { propagationDiffs, propagationReceipt: propagationResult.receipt });
  const memoryResult = await runSam31MemoryEncoderPhaseProgramRoute({
    request: memoryRequest,
    route: memoryRoute,
    device,
    queue: device.queue,
    adapterName,
    browser: navigator.userAgent,
    kernel: memoryRoute.kernel,
    model: { revision: manifest.reference.model.revision, weightsHash: memoryWeightsSha, dtype: 'fp32' },
    tensors: {
      propagationFeature: propagationFeatures[2],
      maskLogits,
      objectScores,
      shape: {
        batch: manifest.shape.batch,
        featureHeight: memoryShape.featureHeight,
        featureWidth: memoryShape.featureWidth,
        featureChannels: memoryShape.featureChannels,
        maskHeight: memoryShape.maskHeight,
        maskWidth: memoryShape.maskWidth,
        multiplexCount: memoryShape.multiplexCount,
        conditionChannels: memoryShape.conditionChannels,
        conditioning,
        resampledMaskHeight: memoryShape.resampledMaskHeight,
        resampledMaskWidth: memoryShape.resampledMaskWidth,
      },
      config: manifest.config,
      weights: memoryWeights,
    },
    includeReadback: true,
  });
  const memoryFeatures = new Float32Array(memoryResult.debugReadback.memoryFeatures);
  const memoryPosition = new Float32Array(memoryResult.debugReadback.memoryPositionEncoding);
  const memoryDiff = maxAbsDiff(memoryFeatures, await tensor('expected-memory-features'));
  const positionDiff = maxAbsDiff(memoryPosition, await tensor('expected-memory-position-encoding'));
  const parity = {
    propagationDiffs,
    propagationMaxAbsDiff: Math.max(...propagationDiffs),
    memoryMaxAbsDiff: memoryDiff,
    positionMaxAbsDiff: positionDiff,
    tolerances: manifest.tolerances,
  };
  const receipts = [propagationResult.receipt, memoryResult.receipt];
  const routeIdentity = evaluateSam31PropagationMemoryEvidence({
    adapterInfo,
    receipts,
    requestedRouteIds: manifest.routeIds,
    parity,
    tolerances: manifest.tolerances,
    uncapturedErrors,
  });
  const { passed, effectiveRouteIds } = routeIdentity;
  const completed = {
    adapterInfo,
    browser: navigator.userAgent,
    manifest: { schema: manifest.schema, boundary: manifest.boundary, reference: manifest.reference, checkpointAudit: manifest.checkpointAudit },
    requestedRouteIds: manifest.routeIds,
    effectiveRouteIds,
    routeIdentity,
    propagationReceipt: propagationResult.receipt,
    memoryReceipt: memoryResult.receipt,
    parity,
    uncapturedErrors,
    composition: { propagationFeature2: propagationOutput2, memoryInputRole: 'sam31-propagation-feature-2' },
  };
  if (!passed) throw Object.assign(new Error(`SAM3.1 WebGPU parity mismatch: ${JSON.stringify(parity)}`), { completed });
  updateStatus('passed', 'complete', completed);
}

run().catch(error => {
  console.error(error);
  updateStatus('failed', state.phase || 'unknown', {
    ...(error.completed || {}),
    error: String(error?.stack || error?.message || error),
  });
});
