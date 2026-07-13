import {
  classifySam31MemoryAttentionAdapter,
  createRouteInvocationRequest,
  createSam31InteractivePointerPhaseProgramRouteDefinition,
  runSam31InteractivePointerPhaseProgramRoute,
  verifySam31PacketFloat32Bytes,
} from '../src/index.js';

const statusElement = document.querySelector('#status');
let state = { status: 'loading', phase: 'load-manifest' };
window.sam31InteractivePointerParityState = () => state;

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

function effectiveAdapterInfo(adapter) {
  const info = adapter.info;
  return {
    description: String(info?.description || ''), vendor: String(info?.vendor || ''), architecture: String(info?.architecture || ''), device: String(info?.device || ''),
    ...classifySam31MemoryAttentionAdapter({ explicitFallback: typeof adapter.isFallbackAdapter === 'boolean' ? adapter.isFallbackAdapter : undefined, vendor: info?.vendor, architecture: info?.architecture }),
  };
}

async function run() {
  const expectedManifestSha256 = new URLSearchParams(location.search).get('expectedManifestSha256');
  if (!expectedManifestSha256) throw new Error('expectedManifestSha256 is required');
  const manifestResponse = await fetch('/oracle/tensor-manifest.json', { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`fetch tensor manifest failed ${manifestResponse.status}`);
  const manifestText = await manifestResponse.text();
  const manifestSha256 = await sha256Text(manifestText);
  if (manifestSha256 !== expectedManifestSha256) throw new Error(`manifest digest mismatch: expected ${expectedManifestSha256}, got ${manifestSha256}`);
  const manifest = JSON.parse(manifestText);
  const referenceReceipt = await fetchJson('/oracle/reference-receipt.json');
  if (manifest.schema !== 'kaminos.sam31-interactive-pointer-meta-packet.v0') throw new Error(`unsupported manifest ${manifest.schema}`);
  if (referenceReceipt.ok !== true || referenceReceipt.routeId !== manifest.routeId) throw new Error('official reference receipt is not authoritative');
  const tensors = Object.fromEntries(await Promise.all(manifest.tensors.map(async entry => [entry.role, await fetchTensor(entry)])));
  const weights = {};
  for (const entry of manifest.weights) weights[`${entry.group}.${entry.localKey}`] = await fetchTensor(entry);
  update('running', 'request-adapter', { manifest: { reference: manifest.reference, shape: manifest.shape, checkpointAudit: manifest.checkpointAudit, outputSummary: manifest.outputSummary } });
  if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', event => errors.push(String(event.error?.message || event.error)));
  const adapterInfo = effectiveAdapterInfo(adapter);
  const route = createSam31InteractivePointerPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-interactive-pointer-phase-program-v0', commit: new URLSearchParams(location.search).get('commit') } });
  const binaryEntry = manifest.tensors.find(entry => entry.role === 'binary-mask-inputs');
  const imageEntry = manifest.tensors.find(entry => entry.role === 'image-embedding');
  const weightsHash = await sha256Text(manifest.weights.map(entry => `${entry.officialKey}:${entry.sha256}`).join('\n'));
  const request = createRouteInvocationRequest(route, {
    requestId: `sam31-interactive-pointer-${Date.now()}`,
    inputs: {
      'source-frame': { artifactId: `sam31-interactive-pointer-fixture:${manifest.fixture.seed}`, sha256: imageEntry.sha256, shape: [1] },
      'sam31-binary-mask-inputs': { artifactId: 'sam31-interactive-binary-masks:official', sha256: binaryEntry.sha256, shape: binaryEntry.shape },
      'sam31-interactive-image-embedding': { artifactId: 'sam31-interactive-image-embedding:official', sha256: imageEntry.sha256, shape: imageEntry.shape },
      'sam31-interactive-pointer-weights': { artifactId: 'sam31-interactive-pointer-weights:official', sha256: weightsHash, shape: [manifest.weights.length] },
    },
    outputs: { 'sam31-interactive-object-pointers': { artifactId: 'sam31-interactive-object-pointers:webgpu', shape: [16, 256] } },
  });
  const result = await runSam31InteractivePointerPhaseProgramRoute({
    request, route, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { revision: manifest.reference.model.revision, weightsHash }, kernel: route.kernel,
    tensors: { shape: manifest.shape, tensors: { binaryMasks: tensors['binary-mask-inputs'], imageEmbedding: tensors['image-embedding'] }, weights },
    includeReadback: true,
  });
  const parity = {
    maskDownsample: maxAbs(result.debugReadback.maskDownsample, tensors['expected-mask-downsample']),
    denseEmbeddings: maxAbs(result.debugReadback.denseEmbeddings, tensors['expected-dense-embeddings']),
    imagePosition: maxAbs(result.debugReadback.imagePosition, tensors['expected-image-position']),
    layer0Queries: maxAbs(result.debugReadback.layerQueries[0], tensors['expected-layer-0-queries']),
    layer0Keys: maxAbs(result.debugReadback.layerKeys[0], tensors['expected-layer-0-keys']),
    layer1Queries: maxAbs(result.debugReadback.layerQueries[1], tensors['expected-layer-1-queries']),
    layer1Keys: maxAbs(result.debugReadback.layerKeys[1], tensors['expected-layer-1-keys']),
    samOutputTokens: maxAbs(result.debugReadback.samOutputTokens, tensors['expected-sam-output-tokens']),
    decoderObjectScores: maxAbs(result.debugReadback.decoderObjectScores, tensors['expected-decoder-object-scores']),
    projectedPointers: maxAbs(result.debugReadback.projectedPointers, tensors['expected-projected-pointers']),
    forwardObjectPointers: maxAbs(result.debugReadback.forwardObjectPointers, tensors['expected-forward-object-pointers']),
    objectPointers: maxAbs(result.debugReadback.objectPointers, tensors['expected-final-object-pointers']),
  };
  const maximum = Math.max(...Object.values(parity));
  const evidence = {
    adapterPassed: adapterInfo.isFallbackAdapter === false,
    routePassed: result.receipt.status === 'real' && result.receipt.fallbackReason == null && result.receipt.requestedRouteId === route.routeId && result.receipt.effectiveRouteId === route.routeId,
    checkpointPassed: manifest.checkpointAudit.mappedTensorCount === 158 && manifest.checkpointAudit.allMappedOfficialKeysPresent === true,
    branchCoveragePassed: manifest.outputSummary.appearingObjectCount > 0 && manifest.outputSummary.absentObjectCount > 0,
    parityPassed: maximum <= manifest.tolerances.webGpuFinalMaxAbsDiff,
    errorsPassed: errors.length === 0,
  };
  evidence.passed = Object.values(evidence).every(Boolean);
  const final = { adapterInfo, requestedRouteId: route.routeId, effectiveRouteId: result.receipt.effectiveRouteId, receipt: result.receipt, parity: { ...parity, maximum }, evidence, uncapturedErrors: errors, manifest: { manifestSha256, expectedManifestSha256, reference: manifest.reference, shape: manifest.shape, checkpointAudit: manifest.checkpointAudit, outputSummary: manifest.outputSummary } };
  if (!evidence.passed) throw Object.assign(new Error(`interactive pointer evidence failed: ${JSON.stringify(evidence)}`), { evidenceState: final });
  update('passed', 'complete', final);
}

run().catch(error => {
  console.error(error);
  update('failed', state.phase, { ...(error.evidenceState || {}), error: String(error?.stack || error) });
});
