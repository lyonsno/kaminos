import {
  classifySam31MemoryAttentionAdapter,
  createRouteInvocationRequest,
  createSam31MemoryAttentionPhaseProgramRouteDefinition,
  createSam31MemoryEncoderPhaseProgramRouteDefinition,
  createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition,
  createSam31TemporalMemoryBankPhaseProgramRouteDefinition,
  createSam31TemporalMemoryBankPlan,
  runSam31MemoryAttentionPhaseProgramRoute,
  runSam31MemoryEncoderPhaseProgramRoute,
  runSam31MultiplexMaskDecoderPhaseProgramRoute,
  runSam31TemporalMemoryBankPhaseProgramRoute,
  verifySam31PacketFloat32Bytes,
} from '../src/index.js';

const statusElement = document.querySelector('#status');
const params = new URLSearchParams(location.search);
let state = { status: 'loading', phase: 'load-manifests' };
window.sam31TwoFrameTrackerParityState = () => state;

function update(status, phase, extra = {}) {
  state = { ...state, ...extra, status, phase };
  document.body.dataset.status = status;
  statusElement.textContent = JSON.stringify(state, null, 2);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.json();
}

async function fetchTensor(base, entry) {
  const response = await fetch(`${base}/${entry.file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${base}/${entry.file} failed ${response.status}`);
  return verifySam31PacketFloat32Bytes(entry, await response.arrayBuffer());
}

async function sha256Bytes(values) {
  const digest = await crypto.subtle.digest('SHA-256', values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function maxAbs(left, right) {
  if (left.length !== right.length) throw new Error(`parity length mismatch ${left.length} != ${right.length}`);
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new Error(`non-finite parity value at ${index}`);
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

function adapterIdentity(adapter) {
  const info = adapter.info;
  return {
    description: String(info?.description || ''), vendor: String(info?.vendor || ''), architecture: String(info?.architecture || ''), device: String(info?.device || ''),
    ...classifySam31MemoryAttentionAdapter({ explicitFallback: typeof adapter.isFallbackAdapter === 'boolean' ? adapter.isFallbackAdapter : undefined, vendor: info?.vendor, architecture: info?.architecture }),
  };
}

function entryMap(entries) { return Object.fromEntries(entries.map(entry => [entry.role, entry])); }

async function loadDecoderWeights(manifest) {
  const weights = {};
  for (const entry of manifest.weights) {
    const key = entry.group === 'decoder' ? entry.localKey : `${entry.group}.${entry.localKey}`;
    weights[key] = await fetchTensor('/oracle/decoder', entry);
  }
  return weights;
}

async function loadMemoryWeights(manifest) {
  const byRole = entryMap(manifest.weights);
  const weight = role => fetchTensor('/oracle/memory', byRole[role]);
  const conv = async (prefix, { stride = 1, padding = 0, activation = null, groups = 1 } = {}) => {
    const entry = byRole[`${prefix}-weight`];
    const [outChannels, kernelSize, , maybeInChannels] = entry.shape;
    return { weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), kernelSize, stride, padding, inChannels: maybeInChannels ?? outChannels, outChannels, activation, groups };
  };
  const result = { downsampleLayers: [], fuserLayers: [] };
  for (let level = 0; level < 4; level += 1) {
    result.downsampleLayers.push({ conv: await conv(`memory-downsample-${level}-conv`, { stride: 2, padding: 1 }), layerNorm: { weight: await weight(`memory-downsample-${level}-norm-weight`), bias: await weight(`memory-downsample-${level}-norm-bias`), epsilon: 1e-6 } });
  }
  result.maskFinal = await conv('memory-mask-final');
  result.featureProjection = await conv('memory-feature-projection');
  for (let level = 0; level < 2; level += 1) {
    const depthwise = await conv(`memory-fuser-${level}-depthwise`, { padding: 3, groups: 256 });
    depthwise.inChannels = 256;
    result.fuserLayers.push({
      depthwise,
      layerNorm: { weight: await weight(`memory-fuser-${level}-norm-weight`), bias: await weight(`memory-fuser-${level}-norm-bias`), epsilon: 1e-6 },
      pointwise1: { weight: await weight(`memory-fuser-${level}-pointwise-1-weight`), bias: await weight(`memory-fuser-${level}-pointwise-1-bias`), inChannels: 256, outChannels: 1024 },
      pointwise2: { weight: await weight(`memory-fuser-${level}-pointwise-2-weight`), bias: await weight(`memory-fuser-${level}-pointwise-2-bias`), inChannels: 1024, outChannels: 256 },
      scale: await weight(`memory-fuser-${level}-scale`),
    });
  }
  result.noObjectSpatialEmbedding = await weight('memory-no-object-spatial-embedding');
  return result;
}

async function loadAttentionWeights(manifest) {
  const byRole = entryMap(manifest.attentionWeights);
  const weight = role => fetchTensor('/oracle/temporal', byRole[role]);
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
  return { layers, finalNorm: await norm('final-norm') };
}

async function decoderInvocation({ frame, inputs, expected, manifest, weights, weightsHash, adapter, device, adapterInfo, errors }) {
  const route = createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-multiplex-mask-decoder-phase-program-v0', commit: params.get('commit') || null } });
  const sourceHash = await sha256Bytes(inputs.imageEmbedding);
  const request = createRouteInvocationRequest(route, {
    requestId: `sam31-two-frame-decoder-${frame}-${Date.now()}`,
    inputs: {
      'source-frame': { artifactId: `sam31-two-frame:${frame}`, sha256: sourceHash, shape: [1] },
      'sam31-multiplex-decoder-tensors': { artifactId: `sam31-two-frame-decoder-tensors:${frame}`, sha256: sourceHash, shape: [5] },
      'sam31-multiplex-decoder-weights': { artifactId: 'sam31-multiplex-decoder-weights:official', sha256: weightsHash, mappedTensorCount: manifest.weights.length },
    },
    outputs: {
      'sam31-multiplex-sam-output-tokens': { artifactId: `sam31-two-frame-sam-tokens:${frame}`, shape: [1, 16, 3, 256] },
      'sam31-multiplex-mask-logits': { artifactId: `sam31-two-frame-mask-logits:${frame}`, shape: [16, 3, 8, 8] },
      'sam31-multiplex-selected-masks': { artifactId: `sam31-two-frame-selected-masks:${frame}`, shape: [16, 1, 8, 8] },
      'sam31-multiplex-object-scores': { artifactId: `sam31-two-frame-object-scores:${frame}`, shape: [16, 1] },
      'sam31-multiplex-object-pointers': { artifactId: `sam31-two-frame-object-pointers:${frame}`, shape: [16, 256] },
    },
  });
  const result = await runSam31MultiplexMaskDecoderPhaseProgramRoute({ request, route, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: manifest.reference.model.revision, weightsHash }, kernel: route.kernel, tensors: { shape: manifest.shape, tensors: inputs, weights }, includeReadback: true });
  const parity = { selectedMasks: maxAbs(result.debugReadback.selectedMasks, expected.selectedMasks), objectScores: maxAbs(result.debugReadback.objectScores, expected.objectScores), objectPointers: maxAbs(result.debugReadback.objectPointers, expected.objectPointers) };
  if (errors.length) throw new Error(`decoder ${frame} uncaptured WebGPU errors: ${errors.join('; ')}`);
  return { result, route, parity, maximum: Math.max(...Object.values(parity)) };
}

async function run() {
  const [episode, decoderManifest, memoryManifest, temporalManifest] = await Promise.all([
    fetchJson('/oracle/episode/tensor-manifest.json'), fetchJson('/oracle/decoder/tensor-manifest.json'), fetchJson('/oracle/memory/tensor-manifest.json'), fetchJson('/oracle/temporal/tensor-manifest.json'),
  ]);
  if (episode.schema !== 'kaminos.sam31-two-frame-tracker-meta-packet.v0') throw new Error(`unsupported episode ${episode.schema}`);
  const episodeEntries = entryMap(episode.tensors);
  const episodeTensor = role => fetchTensor('/oracle/episode', episodeEntries[role]);
  const decoderWeights = await loadDecoderWeights(decoderManifest);
  const memoryWeights = await loadMemoryWeights(memoryManifest);
  const attentionWeights = await loadAttentionWeights(temporalManifest);
  const temporalEntries = entryMap(temporalManifest.tensors);
  const temporalTensor = role => fetchTensor('/oracle/temporal', temporalEntries[role]);

  update('running', 'request-adapter', { manifest: { reference: episode.reference, shape: episode.shape, plan: episode.plan, stateTransition: episode.stateTransition } });
  if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', event => errors.push(String(event.error?.message || event.error)));
  const adapterInfo = adapterIdentity(adapter);
  const decoderWeightsHash = await sha256Text(decoderManifest.weights.map(entry => `${entry.officialKey}:${entry.sha256}`).join('\n'));
  const memoryWeightsHash = await sha256Text(memoryManifest.weights.filter(entry => entry.role.startsWith('memory-')).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const attentionWeightsHash = await sha256Text(temporalManifest.attentionWeights.map(entry => `${entry.role}:${entry.sha256}`).join('\n'));

  const frame0Inputs = { imageEmbedding: await episodeTensor('frame-0-image-embedding'), imagePosition: await episodeTensor('frame-0-image-position'), highResolutionS0: await episodeTensor('frame-0-high-resolution-s0'), highResolutionS1: await episodeTensor('frame-0-high-resolution-s1'), extraPerObjectEmbedding: await episodeTensor('frame-0-extra-per-object-embedding') };
  const frame0Expected = { selectedMasks: await episodeTensor('frame-0-selected-masks'), objectScores: await episodeTensor('frame-0-object-scores'), objectPointers: await episodeTensor('frame-0-object-pointers') };
  update('running', 'frame-0-decoder', { adapterInfo });
  const frame0Decoder = await decoderInvocation({ frame: 0, inputs: frame0Inputs, expected: frame0Expected, manifest: decoderManifest, weights: decoderWeights, weightsHash: decoderWeightsHash, adapter, device, adapterInfo, errors });
  const frame0DecoderResult = frame0Decoder.result;

  const conditioning = new Float32Array(16).fill(1);
  const memoryShape = memoryManifest.shape.memory;
  const memoryRoute = createSam31MemoryEncoderPhaseProgramRouteDefinition({ model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-memory-encoder-phase-program-v0', commit: params.get('commit') || null } });
  const scoreOutput = frame0DecoderResult.receipt.outputs.find(output => output.role === 'sam31-multiplex-object-scores');
  const maskOutput = frame0DecoderResult.receipt.outputs.find(output => output.role === 'sam31-multiplex-selected-masks');
  const conditioningHash = await sha256Bytes(conditioning);
  const featureHash = await sha256Bytes(frame0Inputs.imageEmbedding);
  const memoryRequest = createRouteInvocationRequest(memoryRoute, {
    requestId: `sam31-two-frame-memory-${Date.now()}`,
    inputs: {
      'source-image': { artifactId: 'sam31-two-frame:0', sha256: featureHash, shape: [1] },
      'sam31-propagation-feature-2': { artifactId: 'sam31-frame-0-propagation-feature', sha256: featureHash, shape: [1, 2, 2, 256] },
      'sam31-multiplex-mask-logits': { artifactId: maskOutput.artifactId, sha256: maskOutput.sha256, shape: maskOutput.shape },
      'sam31-multiplex-conditioning': { artifactId: 'sam31-frame-0-conditioning', sha256: conditioningHash, shape: [1, 16] },
      'sam31-multiplex-object-scores': { artifactId: scoreOutput.artifactId, sha256: scoreOutput.sha256, shape: scoreOutput.shape },
      'sam31-memory-encoder-weights': { artifactId: 'sam31-memory-weights:official', sha256: memoryWeightsHash },
    },
    outputs: { 'sam31-mask-memory-features': { artifactId: 'sam31-frame-0-memory-features', shape: [1, 2, 2, 256] }, 'sam31-mask-memory-position-encoding': { artifactId: 'sam31-frame-0-memory-position', shape: [1, 2, 2, 256] } },
  });
  update('running', 'frame-0-memory', { frame0DecoderReceipt: frame0DecoderResult.receipt });
  const frame0MemoryResult = await runSam31MemoryEncoderPhaseProgramRoute({ request: memoryRequest, route: memoryRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: episode.reference.model.revision, weightsHash: memoryWeightsHash }, kernel: memoryRoute.kernel, tensors: { propagationFeature: frame0Inputs.imageEmbedding, maskLogits: new Float32Array(frame0DecoderResult.debugReadback.selectedMasks), objectScores: new Float32Array(frame0DecoderResult.debugReadback.objectScores), shape: { batch: 1, featureHeight: 2, featureWidth: 2, featureChannels: 256, maskHeight: 8, maskWidth: 8, multiplexCount: 16, conditionChannels: true, conditioning, resampledMaskHeight: 32, resampledMaskWidth: 32 }, config: memoryManifest.config, weights: memoryWeights }, includeReadback: true });
  const memoryParity = { features: maxAbs(frame0MemoryResult.debugReadback.memoryFeatures, await episodeTensor('frame-0-memory-features')), position: maxAbs(frame0MemoryResult.debugReadback.memoryPositionEncoding, await episodeTensor('frame-0-memory-position')) };

  const plan = createSam31TemporalMemoryBankPlan({ ...episode.plan, frameTokenCount: 4, multiplexCount: 16 });
  const temporalEmbeddings = await temporalTensor('maskmem-temporal-embeddings');
  const pointerPositionProjection = { weight: await temporalTensor('pointer-position-projection-weight'), bias: await temporalTensor('pointer-position-projection-bias') };
  const spatialFrames = [{ frameIndex: 0, memory: new Float32Array(frame0MemoryResult.debugReadback.memoryFeatures), memoryPosition: new Float32Array(frame0MemoryResult.debugReadback.memoryPositionEncoding), image: frame0Inputs.imageEmbedding, imagePosition: frame0Inputs.imagePosition }];
  const pointerFrames = [{ frameIndex: 0, pointers: new Float32Array(frame0DecoderResult.debugReadback.objectPointers) }];
  const temporalRoute = createSam31TemporalMemoryBankPhaseProgramRouteDefinition({ model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-temporal-memory-bank-phase-program-v0', commit: params.get('commit') || null } });
  const episodeHash = await sha256Text(JSON.stringify(episode.plan));
  const temporalHash = await sha256Text(temporalManifest.tensors.filter(entry => ['maskmem-temporal-embeddings', 'pointer-position-projection-weight', 'pointer-position-projection-bias'].includes(entry.role)).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const temporalRequest = createRouteInvocationRequest(temporalRoute, { requestId: `sam31-two-frame-bank-${Date.now()}`, inputs: { 'source-video-episode': { artifactId: 'sam31-two-frame-episode', sha256: episodeHash, shape: [2] }, 'sam31-temporal-spatial-memory-frames': { artifactId: 'sam31-frame-0-spatial-state', sha256: frame0MemoryResult.receipt.outputs[0].sha256, shape: [1, 1, 4, 256] }, 'sam31-temporal-object-pointer-frames': { artifactId: 'sam31-frame-0-pointer-state', sha256: frame0DecoderResult.receipt.outputs.find(output => output.role === 'sam31-multiplex-object-pointers').sha256, shape: [1, 1, 16, 256] }, 'sam31-temporal-memory-position-weights': { artifactId: 'sam31-temporal-weights:official', sha256: temporalHash, mappedTensorCount: 3 } }, outputs: { 'sam31-temporal-memory-attention-bank': { artifactId: 'sam31-frame-1-memory-bank', shape: [1, 20, 256] } } });
  update('running', 'frame-1-temporal-bank', { frame0MemoryReceipt: frame0MemoryResult.receipt });
  const temporalResult = await runSam31TemporalMemoryBankPhaseProgramRoute({ request: temporalRequest, route: temporalRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: episode.reference.model.revision, weightsHash: temporalHash }, kernel: temporalRoute.kernel, plan, spatialFrames, pointerFrames, temporalEmbeddings, pointerPositionProjection, channels: 256, batch: 1, multiplexCount: 16, includeReadback: true });
  const bank = { memoryImage: new Float32Array(temporalResult.debugReadback.memoryImage), memory: new Float32Array(temporalResult.debugReadback.memory), memoryImagePos: new Float32Array(temporalResult.debugReadback.memoryImagePosition), memoryPos: new Float32Array(temporalResult.debugReadback.memoryPosition) };
  const bankParity = { memoryImage: maxAbs(bank.memoryImage, await episodeTensor('frame-1-assembled-memory-image')), memory: maxAbs(bank.memory, await episodeTensor('frame-1-assembled-memory')), memoryImagePosition: maxAbs(bank.memoryImagePos, await episodeTensor('frame-1-assembled-memory-image-position')), memoryPosition: maxAbs(bank.memoryPos, await episodeTensor('frame-1-assembled-memory-position')) };

  const frame1Image = await episodeTensor('frame-1-image-embedding');
  const frame1Position = await episodeTensor('frame-1-image-position');
  const attentionShape = { batch: 1, queryHeight: 2, queryWidth: 2, queryTokens: 4, memorySpatialTokens: 4, numObjPtrTokens: 16, memoryTokens: 20, channels: 256, heads: 8, headDim: 32, mlpHidden: 2048, layerCount: 4 };
  const attentionRoute = createSam31MemoryAttentionPhaseProgramRouteDefinition({ shape: attentionShape, model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-memory-attention-phase-program-v0', commit: params.get('commit') || null } });
  const temporalOutput = temporalResult.receipt.outputs.find(output => output.role === 'sam31-temporal-memory-attention-bank');
  const currentHash = await sha256Bytes(frame1Image);
  const attentionRequest = createRouteInvocationRequest(attentionRoute, { requestId: `sam31-two-frame-attention-${Date.now()}`, inputs: { 'source-image': { artifactId: 'sam31-two-frame:1', sha256: currentHash, shape: [1] }, 'sam31-memory-attention-current-tensors': { artifactId: 'sam31-frame-1-current', sha256: currentHash, shape: [1, 4, 256] }, 'sam31-memory-attention-bank-tensors': { artifactId: temporalOutput.artifactId, sha256: temporalOutput.sha256, shape: [1, 20, 256] }, 'sam31-memory-attention-weights': { artifactId: 'sam31-attention-weights:official', sha256: attentionWeightsHash, mappedTensorCount: 122 } }, outputs: { 'sam31-memory-conditioned-features': { artifactId: 'sam31-frame-1-conditioned-features', shape: [1, 4, 256] } }, routeConfig: { numObjPtrTokens: 16, upstreamTemporalReceipt: temporalResult.receipt.receiptId } });
  update('running', 'frame-1-memory-attention', { temporalReceipt: temporalResult.receipt });
  const frame1AttentionResult = await runSam31MemoryAttentionPhaseProgramRoute({ request: attentionRequest, route: attentionRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: episode.reference.model.revision, weightsHash: attentionWeightsHash }, kernel: attentionRoute.kernel, tensors: { shape: attentionShape, current: { image: frame1Image, src: frame1Image, srcPos: frame1Position }, bank, layers: attentionWeights.layers, finalNorm: attentionWeights.finalNorm }, includeReadback: true });
  const conditionedParity = maxAbs(frame1AttentionResult.debugReadback.memory, await episodeTensor('frame-1-memory-conditioned-features'));

  const frame1Inputs = { imageEmbedding: new Float32Array(frame1AttentionResult.debugReadback.memory), imagePosition: frame1Position, highResolutionS0: await episodeTensor('frame-1-high-resolution-s0'), highResolutionS1: await episodeTensor('frame-1-high-resolution-s1'), extraPerObjectEmbedding: await episodeTensor('frame-1-extra-per-object-embedding') };
  const frame1Expected = { selectedMasks: await episodeTensor('frame-1-selected-masks'), objectScores: await episodeTensor('frame-1-object-scores'), objectPointers: await episodeTensor('frame-1-object-pointers') };
  update('running', 'frame-1-decoder', { frame1AttentionReceipt: frame1AttentionResult.receipt });
  const frame1Decoder = await decoderInvocation({ frame: 1, inputs: frame1Inputs, expected: frame1Expected, manifest: decoderManifest, weights: decoderWeights, weightsHash: decoderWeightsHash, adapter, device, adapterInfo, errors });
  const frame1DecoderResult = frame1Decoder.result;

  const receipts = [frame0DecoderResult.receipt, frame0MemoryResult.receipt, temporalResult.receipt, frame1AttentionResult.receipt, frame1DecoderResult.receipt];
  const requestedRouteIds = [frame0Decoder.route.routeId, memoryRoute.routeId, temporalRoute.routeId, attentionRoute.routeId, frame1Decoder.route.routeId];
  const effectiveRouteIds = receipts.map(receipt => receipt.effectiveRouteId);
  const maximums = { frame0Decoder: frame0Decoder.maximum, frame0Memory: Math.max(...Object.values(memoryParity)), temporalBank: Math.max(...Object.values(bankParity)), frame1Attention: conditionedParity, frame1Decoder: frame1Decoder.maximum };
  const routeChainPassed = receipts.every((receipt, index) => receipt.status === 'real' && receipt.fallbackReason == null && receipt.effectiveRouteId === requestedRouteIds[index]);
  const stateTransitionPassed = episode.stateTransition.frame0AppearingObjectCount > 0 && episode.stateTransition.frame0AbsentObjectCount > 0 && plan.spatialFrames.length === 1 && plan.pointerFrames.length === 1 && bank.memory.length === 20 * 256;
  const parityPassed = maximums.frame0Decoder <= episode.tolerances.decoderMaxAbsDiff && maximums.frame0Memory <= episode.tolerances.memoryMaxAbsDiff && maximums.temporalBank <= episode.tolerances.bankMaxAbsDiff && maximums.frame1Attention <= episode.tolerances.conditionedMaxAbsDiff && maximums.frame1Decoder <= episode.tolerances.decoderMaxAbsDiff;
  const evidence = { adapterPassed: adapterInfo.isFallbackAdapter === false, routeChainPassed, stateTransitionPassed, parityPassed, errorsPassed: errors.length === 0 };
  evidence.passed = Object.values(evidence).every(Boolean);
  const final = { adapterInfo, requestedRouteIds, effectiveRouteIds, receipts, parity: { maximums, frame0Decoder: frame0Decoder.parity, frame0Memory: memoryParity, temporalBank: bankParity, frame1Attention: conditionedParity, frame1Decoder: frame1Decoder.parity }, stateTransition: episode.stateTransition, evidence, uncapturedErrors: errors, manifest: { reference: episode.reference, shape: episode.shape, plan: episode.plan } };
  if (!evidence.passed) throw Object.assign(new Error(`two-frame tracker evidence failed: ${JSON.stringify(evidence)}`), { evidenceState: final });
  update('passed', 'complete', final);
}

run().catch(error => {
  console.error(error);
  update('failed', state.phase, { ...(error.evidenceState || {}), error: String(error?.stack || error) });
});
