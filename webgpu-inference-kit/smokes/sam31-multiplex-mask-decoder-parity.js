import {
  classifySam31MemoryAttentionAdapter,
  createRouteInvocationRequest,
  createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition,
  runSam31MultiplexMaskDecoderPhaseProgramRoute,
  verifySam31PacketFloat32Bytes,
} from '../src/index.js';

const statusElement = document.querySelector('#status');
let state = { status: 'loading', phase: 'load-manifest' };
window.sam31MultiplexMaskDecoderParityState = () => state;

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

async function fetchTensor(entry) {
  const response = await fetch(`/oracle/${entry.file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${entry.file} failed ${response.status}`);
  return verifySam31PacketFloat32Bytes(entry, await response.arrayBuffer());
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
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

function adapterInfo(adapter) {
  const info = adapter.info;
  return {
    description: String(info?.description || ''), vendor: String(info?.vendor || ''), architecture: String(info?.architecture || ''), device: String(info?.device || ''),
    ...classifySam31MemoryAttentionAdapter({ explicitFallback: typeof adapter.isFallbackAdapter === 'boolean' ? adapter.isFallbackAdapter : undefined, vendor: info?.vendor, architecture: info?.architecture }),
  };
}

async function run() {
  const manifest = await fetchJson('/oracle/tensor-manifest.json');
  const referenceReceipt = await fetchJson('/oracle/reference-receipt.json');
  if (manifest.schema !== 'kaminos.sam31-multiplex-mask-decoder-meta-packet.v0') throw new Error(`unsupported manifest ${manifest.schema}`);
  if (referenceReceipt.ok !== true || referenceReceipt.routeId !== manifest.routeId) throw new Error('official reference receipt is not authoritative');
  const tensors = Object.fromEntries(await Promise.all(manifest.tensors.map(async entry => [entry.role, await fetchTensor(entry)])));
  const weights = {};
  for (const entry of manifest.weights) {
    const key = entry.group === 'decoder' ? entry.localKey : `${entry.group}.${entry.localKey}`;
    weights[key] = await fetchTensor(entry);
  }
  update('running', 'request-adapter', { manifest: { reference: manifest.reference, shape: manifest.shape, checkpointAudit: manifest.checkpointAudit, outputSummary: manifest.outputSummary } });
  if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', event => errors.push(String(event.error?.message || event.error)));
  const effectiveAdapter = adapterInfo(adapter);
  const route = createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-multiplex-mask-decoder-phase-program-v0', commit: new URLSearchParams(location.search).get('commit') } });
  const tensorHash = await sha256Text(manifest.tensors.map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const weightsHash = await sha256Text(manifest.weights.map(entry => `${entry.officialKey}:${entry.sha256}`).join('\n'));
  const request = createRouteInvocationRequest(route, {
    requestId: `sam31-multiplex-decoder-${Date.now()}`,
    inputs: {
      'source-frame': { artifactId: `sam31-multiplex-fixture:${manifest.fixture.seed}`, sha256: manifest.tensors.find(entry => entry.role === 'image-embedding').sha256, shape: [1] },
      'sam31-multiplex-decoder-tensors': { artifactId: 'sam31-multiplex-decoder-tensors:official', sha256: tensorHash, shape: [manifest.tensors.length] },
      'sam31-multiplex-decoder-weights': { artifactId: 'sam31-multiplex-decoder-weights:official', sha256: weightsHash, mappedTensorCount: manifest.weights.length },
    },
    outputs: {
      'sam31-multiplex-sam-output-tokens': { artifactId: 'sam31-multiplex-sam-output-tokens:webgpu', shape: [1, 16, 3, 256] },
      'sam31-multiplex-mask-logits': { artifactId: 'sam31-multiplex-mask-logits:webgpu', shape: [16, 3, 4, 4] },
      'sam31-multiplex-selected-masks': { artifactId: 'sam31-multiplex-selected-masks:webgpu', shape: [16, 1, 4, 4] },
      'sam31-multiplex-object-pointers': { artifactId: 'sam31-multiplex-object-pointers:webgpu', shape: [16, 256] },
    },
  });
  const result = await runSam31MultiplexMaskDecoderPhaseProgramRoute({
    request, route, adapter, device, queue: device.queue, adapterName: effectiveAdapter.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { revision: manifest.reference.model.revision, weightsHash }, kernel: route.kernel,
    tensors: { shape: manifest.shape, tensors: { imageEmbedding: tensors['image-embedding'], imagePosition: tensors['image-position'], highResolutionS0: tensors['high-resolution-s0'], highResolutionS1: tensors['high-resolution-s1'], extraPerObjectEmbedding: tensors['extra-per-object-embedding'] }, weights },
    includeReadback: true,
  });
  const parity = {
    layer0Queries: maxAbs(result.debugReadback.layerQueries[0], tensors['layer-0-queries']),
    layer0Keys: maxAbs(result.debugReadback.layerKeys[0], tensors['layer-0-keys']),
    layer1Queries: maxAbs(result.debugReadback.layerQueries[1], tensors['layer-1-queries']),
    layer1Keys: maxAbs(result.debugReadback.layerKeys[1], tensors['layer-1-keys']),
    samTokens: maxAbs(result.debugReadback.samTokens, tensors['expected-sam-tokens']),
    maskLogits: maxAbs(result.debugReadback.maskLogits, tensors['expected-masks']),
    iou: maxAbs(result.debugReadback.iou, tensors['expected-iou']),
    objectScores: maxAbs(result.debugReadback.objectScores, tensors['expected-object-scores']),
    bestMaskIndices: maxAbs(result.debugReadback.bestMaskIndices, tensors['expected-best-mask-indices']),
    selectedMasks: maxAbs(result.debugReadback.selectedMasks, tensors['expected-selected-masks']),
    projectedPointers: maxAbs(result.debugReadback.projectedPointers, tensors['expected-projected-pointers']),
    objectPointers: maxAbs(result.debugReadback.objectPointers, tensors['expected-object-pointers']),
  };
  const maximum = Math.max(...Object.values(parity));
  const evidence = {
    adapterPassed: effectiveAdapter.isFallbackAdapter === false,
    routePassed: result.receipt.status === 'real' && result.receipt.fallbackReason == null && result.receipt.effectiveRouteId === route.routeId,
    checkpointPassed: manifest.checkpointAudit.mappedTensorCount === 133 && manifest.checkpointAudit.allMappedOfficialKeysPresent === true,
    parityPassed: maximum <= manifest.tolerances.webGpuFinalMaxAbsDiff,
    errorsPassed: errors.length === 0,
  };
  evidence.passed = Object.values(evidence).every(Boolean);
  const final = { adapterInfo: effectiveAdapter, requestedRouteId: route.routeId, effectiveRouteId: result.receipt.effectiveRouteId, receipt: result.receipt, parity: { ...parity, maximum }, evidence, uncapturedErrors: errors, manifest: { reference: manifest.reference, shape: manifest.shape, checkpointAudit: manifest.checkpointAudit, outputSummary: manifest.outputSummary } };
  if (!evidence.passed) throw Object.assign(new Error(`multiplex decoder evidence failed: ${JSON.stringify(evidence)}`), { evidenceState: final });
  update('passed', 'complete', final);
}

run().catch(error => {
  console.error(error);
  update('failed', state.phase, { ...(error.evidenceState || {}), error: String(error?.stack || error) });
});
