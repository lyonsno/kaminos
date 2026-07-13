import {
  createRouteInvocationRequest,
  createSam31MemoryAttentionPhaseProgramCpuOracle,
  createSam31MemoryAttentionPhaseProgramRouteDefinition,
  classifySam31MemoryAttentionAdapter,
  evaluateSam31MemoryAttentionEvidence,
  runSam31MemoryAttentionPhaseProgramRoute,
  verifySam31PacketFloat32Bytes,
} from '../src/index.js';

const params = new URLSearchParams(location.search);
const manifestUrl = params.get('manifest') || '/oracle/tensor-manifest.json';
const statusElement = document.querySelector('#status');
let state = { status: 'loading', phase: 'load-manifest', requestedManifestUrl: manifestUrl };
window.sam31MemoryAttentionParitySmokeState = () => state;

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
  const fallback = classifySam31MemoryAttentionAdapter({
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
  if (!serialized.description && !serialized.vendor && !serialized.architecture && !serialized.device) serialized.description = 'browser-webgpu-adapter';
  return serialized;
}

async function run() {
  const manifest = await fetchJson(manifestUrl);
  if (manifest.schema !== 'kaminos.sam31-memory-attention-meta-packet.v0') throw new Error(`unsupported manifest schema ${manifest.schema}`);
  const tensorsByRole = Object.fromEntries(manifest.tensors.map(entry => [entry.role, entry]));
  const weightsByRole = Object.fromEntries(manifest.weights.map(entry => [entry.role, entry]));
  const tensor = role => fetchFloat32(tensorsByRole[role]);
  const weight = role => fetchFloat32(weightsByRole[role]);
  const projection = async (prefix, inChannels, outChannels) => ({
    weight: await weight(`${prefix}-weight`),
    bias: await weight(`${prefix}-bias`),
    inChannels,
    outChannels,
  });
  const norm = async prefix => ({ weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), epsilon: 1e-5 });

  updateStatus('running', 'request-adapter', {
    packetManifest: manifest,
    manifest: {
      schema: manifest.schema,
      boundary: manifest.boundary,
      reference: manifest.reference,
      checkpointAudit: manifest.checkpointAudit,
      shape: manifest.shape,
    },
  });
  if (!navigator.gpu) throw new Error('navigator.gpu is unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const uncapturedErrors = [];
  device.addEventListener('uncapturederror', event => uncapturedErrors.push(String(event.error?.message || event.error || 'unknown WebGPU error')));
  const adapterInfo = serializeAdapterInfo(adapter);
  const adapterName = adapterInfo.description || adapterInfo.device || 'browser-webgpu-adapter';

  const layers = [];
  for (let index = 0; index < manifest.shape.layerCount; index += 1) {
    const prefix = `layer-${index}`;
    layers.push({
      norm1: await norm(`${prefix}-norm1`),
      selfQ: await projection(`${prefix}-self-q`, 256, 256),
      selfK: await projection(`${prefix}-self-k`, 256, 256),
      selfV: await projection(`${prefix}-self-v`, 256, 256),
      selfOut: await projection(`${prefix}-self-out`, 256, 256),
      norm2: await norm(`${prefix}-norm2`),
      crossQ: await projection(`${prefix}-cross-q`, 256, 256),
      crossK: await projection(`${prefix}-cross-k`, 256, 256),
      crossV: await projection(`${prefix}-cross-v`, 256, 256),
      crossOut: await projection(`${prefix}-cross-out`, 256, 256),
      imageCrossQ: await projection(`${prefix}-image-cross-q`, 256, 256),
      imageCrossK: await projection(`${prefix}-image-cross-k`, 256, 256),
      norm3: await norm(`${prefix}-norm3`),
      linear1: await projection(`${prefix}-linear1`, 256, 2048),
      linear2: await projection(`${prefix}-linear2`, 2048, 256),
    });
  }
  const current = {
    image: await tensor('current-image'),
    src: await tensor('current-src'),
    srcPos: await tensor('current-src-pos'),
  };
  const bank = {
    memoryImage: await tensor('memory-image'),
    memory: await tensor('memory'),
    memoryImagePos: await tensor('memory-image-pos'),
    memoryPos: await tensor('memory-pos'),
  };
  const finalNorm = await norm('final-norm');
  const currentHash = await sha256Text(['current-image', 'current-src', 'current-src-pos'].map(role => `${role}:${tensorsByRole[role].sha256}`).join('\n'));
  const bankHash = await sha256Text(['memory-image', 'memory', 'memory-image-pos', 'memory-pos'].map(role => `${role}:${tensorsByRole[role].sha256}`).join('\n'));
  const weightsHash = await sha256Text(manifest.weights.map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const sourceImage = { artifactId: `sam31-memory-attention-source:${manifest.fixture.seed}`, sha256: await sha256Text(`sam31-memory-attention-source:${manifest.fixture.seed}`), shape: [1, 3, 8, 8] };
  const route = createSam31MemoryAttentionPhaseProgramRouteDefinition({
    shape: manifest.shape,
    model: { revision: manifest.reference.model.revision, dtype: 'fp32' },
    kernel: { profile: 'sam31-memory-attention-phase-program-v0', commit: params.get('commit') || null },
  });
  const request = createRouteInvocationRequest(route, {
    requestId: `sam31-memory-attention-${Date.now()}`,
    inputs: {
      'source-image': sourceImage,
      'sam31-memory-attention-current-tensors': { artifactId: 'sam31-memory-attention-current:official-packet', sha256: currentHash, shape: [manifest.shape.batch, manifest.shape.queryTokens, manifest.shape.channels] },
      'sam31-memory-attention-bank-tensors': { artifactId: 'sam31-memory-attention-bank:official-packet', sha256: bankHash, shape: [manifest.shape.batch, manifest.shape.memoryTokens, manifest.shape.channels] },
      'sam31-memory-attention-weights': { artifactId: 'sam31-memory-attention-weights:official-packet', sha256: weightsHash, mappedTensorCount: manifest.checkpointAudit.mappedTensorCount },
    },
    outputs: {
      'sam31-memory-conditioned-features': { artifactId: 'sam31-memory-conditioned-features:browser', shape: [manifest.shape.batch, manifest.shape.queryTokens, manifest.shape.channels] },
    },
    routeConfig: { reference: manifest.reference, packetBoundary: manifest.boundary, numObjPtrTokens: manifest.shape.numObjPtrTokens },
  });
  updateStatus('running', 'run-memory-attention', { adapterInfo, requestedRouteId: manifest.routeId });
  const result = await runSam31MemoryAttentionPhaseProgramRoute({
    request,
    route,
    adapter,
    device,
    queue: device.queue,
    adapterName,
    browser: navigator.userAgent,
    kernel: route.kernel,
    model: { revision: manifest.reference.model.revision, weightsHash, dtype: 'fp32' },
    tensors: { shape: manifest.shape, current, bank, layers, finalNorm },
    includeReadback: true,
  });
  const actual = new Float32Array(result.debugReadback.memory);
  const expected = await tensor('expected-memory');
  const layerMaxAbsDiffs = [];
  for (let layer = 0; layer < manifest.shape.layerCount; layer += 1) {
    layerMaxAbsDiffs.push(maxAbsDiff(new Float32Array(result.debugReadback.layerOutputs[layer]), await tensor(`expected-layer-${layer}-memory`)));
  }
  const cpuOracle = createSam31MemoryAttentionPhaseProgramCpuOracle({ shape: manifest.shape, current, bank, layers, finalNorm });
  const layerStageMaxAbsDiffs = result.debugReadback.stageOutputs.map((stages, layer) => ({
    selfAttentionResidual: maxAbsDiff(new Float32Array(stages.selfAttentionResidual), cpuOracle.stageOutputs[layer].selfAttentionResidual),
    crossAttentionResidual: maxAbsDiff(new Float32Array(stages.crossAttentionResidual), cpuOracle.stageOutputs[layer].crossAttentionResidual),
    mlpResidual: maxAbsDiff(new Float32Array(stages.mlpResidual), cpuOracle.stageOutputs[layer].mlpResidual),
  }));
  const crossAttentionInputMaxAbsDiffs = result.debugReadback.stageOutputs.map((stages, layer) => ({
    crossQueryRope: maxAbsDiff(new Float32Array(stages.crossQueryRope), cpuOracle.stageOutputs[layer].crossQueryRope),
    crossKeyRope: maxAbsDiff(new Float32Array(stages.crossKeyRope), cpuOracle.stageOutputs[layer].crossKeyRope),
    crossValue: maxAbsDiff(new Float32Array(stages.crossValue), cpuOracle.stageOutputs[layer].crossValue),
    crossAttention: maxAbsDiff(new Float32Array(stages.crossAttention), cpuOracle.stageOutputs[layer].crossAttention),
  }));
  const parity = { memoryMaxAbsDiff: maxAbsDiff(actual, expected), layerMaxAbsDiffs, layerStageMaxAbsDiffs, crossAttentionInputMaxAbsDiffs };
  const packet = {
    mappedTensorCount: manifest.checkpointAudit.mappedTensorCount,
    layerCount: manifest.shape.layerCount,
    numObjPtrTokens: manifest.shape.numObjPtrTokens,
  };
  const evidence = evaluateSam31MemoryAttentionEvidence({
    adapterInfo,
    requestedRouteId: manifest.routeId,
    receipt: result.receipt,
    parity,
    tolerance: manifest.tolerances.webGpuMaxAbsDiff,
    uncapturedErrors,
    packet,
  });
  const effectiveRouteId = result.receipt.effectiveRouteId;
  const final = {
    adapterInfo,
    requestedRouteId: manifest.routeId,
    effectiveRouteId,
    receipt: result.receipt,
    parity,
    tolerance: manifest.tolerances.webGpuMaxAbsDiff,
    packet,
    evidence,
    uncapturedErrors,
  };
  if (!evidence.passed) throw Object.assign(new Error(`memory attention evidence failed: ${JSON.stringify(evidence)}`), { evidenceState: final });
  updateStatus('passed', 'complete', final);
}

run().catch(error => {
  console.error(error);
  updateStatus('failed', state.phase, { ...(error.evidenceState || {}), error: String(error?.stack || error) });
});
