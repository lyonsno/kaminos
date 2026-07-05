import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  createRouteInvocationRequest,
  createSam3MaskDecoderIslandRouteDefinition,
  createSam3MaskProjectionCpuOracle,
  runSam3MaskDecoderIslandRoute,
} from '../src/index.js';

const state = {
  schema: 'kaminos.sam3-mask-island.browser-parity-state.v0',
  status: 'loading',
  requestedRouteId: SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  effectiveRouteId: null,
  claims: {
    fullSam3BrowserExecution: false,
    upstream: 'synthetic-oracle',
    browserExecutedStages: ['decode-mask', 'threshold-mask'],
  },
  tensorPacket: null,
  backendIdentity: null,
  routeReceipt: null,
  parity: null,
  error: null,
};

window.samMaskIslandParitySmokeState = () => JSON.parse(JSON.stringify(state));

const params = new URLSearchParams(window.location.search);
const manifestUrl = params.get('manifest') || '/oracle/tensor-manifest.json';
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const reportEl = document.getElementById('report');
const canvas = document.getElementById('sam-mask-parity-canvas');

function setStatus(status, message = status) {
  state.status = status;
  statusEl.textContent = message;
  reportEl.textContent = JSON.stringify(state, null, 2);
}

function renderSummary(entries) {
  summaryEl.replaceChildren(...Object.entries(entries).flatMap(([key, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    return [dt, dd];
  }));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.json();
}

async function fetchArray(url, Type) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return new Type(await response.arrayBuffer());
}

function resolveManifestFile(file) {
  return new URL(file, new URL(manifestUrl, window.location.href)).toString();
}

function tensorByRole(manifest, role) {
  const tensor = manifest.tensors.find(entry => entry.role === role);
  if (!tensor) throw new Error(`manifest missing tensor role ${role}`);
  return tensor;
}

function maxAbsDiff(a, b) {
  if (a.length !== b.length) throw new Error(`length mismatch ${a.length} !== ${b.length}`);
  let max = 0;
  for (let index = 0; index < a.length; index += 1) {
    max = Math.max(max, Math.abs(Number(a[index]) - Number(b[index])));
  }
  return max;
}

function mismatchCount(a, b) {
  if (a.length !== b.length) throw new Error(`length mismatch ${a.length} !== ${b.length}`);
  let count = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (Number(a[index]) !== Number(b[index])) count += 1;
  }
  return count;
}

function drawMaskGrid(expected, actual, shape) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#050706';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cell = Math.max(12, Math.floor(Math.min(80 / shape.width, 80 / shape.height)));
  const panels = [
    { label: 'expected', values: expected, x: 8 },
    { label: 'webgpu', values: actual, x: 92 },
    { label: 'diff', values: expected.map((value, index) => value === actual[index] ? 0 : 1), x: 176 },
  ];
  ctx.font = '10px monospace';
  for (const panel of panels) {
    ctx.fillStyle = '#dfe8e0';
    ctx.fillText(panel.label, panel.x, 12);
    for (let y = 0; y < shape.height; y += 1) {
      for (let x = 0; x < shape.width; x += 1) {
        const value = panel.values[y * shape.width + x];
        ctx.fillStyle = value ? '#63e68e' : '#22302a';
        if (panel.label === 'diff' && value) ctx.fillStyle = '#ff4d6d';
        ctx.fillRect(panel.x + x * cell, 22 + y * cell, cell - 1, cell - 1);
      }
    }
  }
}

async function main() {
  try {
    setStatus('load-oracle-packet');
    const manifest = await fetchJson(manifestUrl);
    if (manifest.routeId !== SAM3_MASK_DECODER_ISLAND_ROUTE_ID) {
      throw new Error(`manifest route mismatch: ${manifest.routeId}`);
    }
    if (manifest.claims?.fullSam3BrowserExecution !== false) {
      throw new Error('oracle packet must not claim full SAM3 browser execution');
    }
    if (!manifest.staticWeights?.sha256 || manifest.staticWeights.role !== 'none') {
      throw new Error('oracle packet must preserve explicit no-static-weights identity');
    }

    const hyperTensor = tensorByRole(manifest, 'hyper-input');
    const embeddingTensor = tensorByRole(manifest, 'upscaled-embedding');
    const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
    const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
    const hyperInput = await fetchArray(resolveManifestFile(hyperTensor.file), Float32Array);
    const upscaledEmbedding = await fetchArray(resolveManifestFile(embeddingTensor.file), Float32Array);
    const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
    const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);

    const cpuOracle = createSam3MaskProjectionCpuOracle({
      hyperInput,
      upscaledEmbedding,
      shape: manifest.shape,
    });
    const oracleSelfCheck = {
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, cpuOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, cpuOracle.binaryMask),
    };
    if (oracleSelfCheck.logitsMaxAbsDiff !== 0 || oracleSelfCheck.binaryMismatchCount !== 0) {
      throw new Error(`oracle packet self-check failed: ${JSON.stringify(oracleSelfCheck)}`);
    }

    setStatus('request-webgpu-adapter');
    if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const device = await adapter.requestDevice();

    const route = createSam3MaskDecoderIslandRouteDefinition({
      model: {
        revision: manifest.model?.id || 'synthetic-oracle',
        dtype: 'fp32',
      },
      kernel: {
        profile: 'sam3-mask-projection-threshold-v0',
        commit: params.get('commit') || null,
      },
    });
    const request = createRouteInvocationRequest(route, {
      requestId: `sam-browser-parity-${Date.now()}`,
      inputs: {
        'source-image': {
          artifactId: manifest.sourceImage?.artifactId || 'image:synthetic',
          sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image',
          shape: [manifest.shape.height, manifest.shape.width, 3],
        },
        'sam3-decoder-tensors': {
          artifactId: 'sam3-tensors:browser-parity',
          sha256: hyperTensor.sha256,
          shape: [1],
        },
        'sam3-decoder-weights': {
          artifactId: manifest.staticWeights.artifactId,
          sha256: manifest.staticWeights.sha256,
          shape: [1],
        },
      },
      outputs: {
        'mask-logits': { artifactId: 'sam3-mask-logits:browser-parity', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.height, manifest.shape.width] },
        'mask-binary': { artifactId: 'sam3-mask-binary:browser-parity', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.height, manifest.shape.width] },
      },
      routeConfig: {
        upstream: manifest.claims?.upstream || 'synthetic-oracle',
        promptHash: manifest.prompt?.sha256,
      },
    });

    setStatus('run-webgpu-route');
    const result = await runSam3MaskDecoderIslandRoute({
      request,
      route,
      device,
      queue: device.queue,
      adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter',
      browser: navigator.userAgent,
      kernel: route.kernel,
      model: {
        revision: route.model.revision,
        weightsHash: manifest.staticWeights.sha256,
        dtype: 'fp32',
      },
      tensors: {
        hyperInput,
        upscaledEmbedding,
        shape: manifest.shape,
      },
      includeReadback: true,
    });

    const gpuLogits = new Float32Array(result.debugReadback.maskLogits);
    const gpuBinary = new Uint32Array(result.debugReadback.binaryMask);
    const parity = {
      maskLogitsMaxAbsDiff: maxAbsDiff(expectedLogits, gpuLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, gpuBinary),
      expectedElementCount: expectedLogits.length,
      gpuElementCount: gpuLogits.length,
    };
    if (parity.maskLogitsMaxAbsDiff > 0.00001 || parity.binaryMismatchCount !== 0) {
      throw new Error(`WebGPU parity mismatch: ${JSON.stringify(parity)}`);
    }

    drawMaskGrid(Array.from(expectedBinary), Array.from(gpuBinary), manifest.shape);
    state.status = 'passed';
    state.effectiveRouteId = result.receipt.effectiveRouteId;
    state.tensorPacket = {
      manifestUrl,
      schema: manifest.schema,
      mode: manifest.mode,
      boundary: manifest.boundary,
      hyperInputSha256: hyperTensor.sha256,
      upscaledEmbeddingSha256: embeddingTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
      staticWeights: manifest.staticWeights,
    };
    state.backendIdentity = result.backend;
    state.routeReceipt = result.receipt;
    state.parity = parity;
    renderSummary({
      status: state.status,
      route: state.effectiveRouteId,
      adapter: state.backendIdentity?.adapterName,
      logitsDiff: parity.maskLogitsMaxAbsDiff,
      binaryMismatch: parity.binaryMismatchCount,
    });
    setStatus('passed', 'WebGPU parity passed');
  } catch (error) {
    state.status = 'failed';
    state.error = String(error?.stack || error?.message || error);
    setStatus('failed', state.error);
    throw error;
  }
}

main();
