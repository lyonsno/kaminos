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
  sourceImage: null,
  selectedMaskIndex: null,
  error: null,
};

window.samMaskIslandParitySmokeState = () => JSON.parse(JSON.stringify(state));

const params = new URLSearchParams(window.location.search);
const manifestUrl = params.get('manifest') || '/oracle/tensor-manifest.json';
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const reportEl = document.getElementById('report');
const canvas = document.getElementById('sam-mask-parity-canvas');
const sourceImageEl = document.getElementById('sam-source-image');

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

function sliceMask(values, shape, tokenIndex) {
  const hw = shape.height * shape.width;
  const offset = tokenIndex * hw;
  return Array.from(values.slice(offset, offset + hw));
}

function loadImage(url) {
  return new Promise((resolveLoad, rejectLoad) => {
    const image = new Image();
    image.onload = () => resolveLoad(image);
    image.onerror = () => rejectLoad(new Error(`source image failed to load: ${url}`));
    image.src = url;
  });
}

function drawBinaryPanel(ctx, values, shape, x, y, width, height, colors) {
  const image = ctx.createImageData(shape.width, shape.height);
  for (let index = 0; index < values.length; index += 1) {
    const on = Number(values[index]) !== 0;
    const color = on ? colors.on : colors.off;
    const pixel = index * 4;
    image.data[pixel] = color[0];
    image.data[pixel + 1] = color[1];
    image.data[pixel + 2] = color[2];
    image.data[pixel + 3] = 255;
  }
  const scratch = document.createElement('canvas');
  scratch.width = shape.width;
  scratch.height = shape.height;
  scratch.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x, y, width, height);
}

function drawSourcePanel(ctx, sourceImage, sourceImageIdentity, x, y, width, height) {
  if (sourceImage) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sourceImage, x, y, width, height);
    return;
  }
  ctx.fillStyle = '#151a18';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#59635e';
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = '#dfe8e0';
  ctx.font = '12px monospace';
  ctx.fillText('synthetic source', x + 12, y + 30);
  ctx.fillStyle = '#9fafaa';
  ctx.font = '10px monospace';
  const artifact = sourceImageIdentity?.artifactId || 'image:synthetic';
  const sha = sourceImageIdentity?.sha256 || 'sha256:synthetic-image';
  ctx.fillText(artifact.slice(0, 26), x + 12, y + 52);
  ctx.fillText(sha.slice(0, 30), x + 12, y + 70);
}

function drawVisualWitness({ sourceImage, sourceImageIdentity, expected, actual, shape, selectedMaskIndex }) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#050706';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const expectedMask = sliceMask(expected, shape, selectedMaskIndex);
  const actualMask = sliceMask(actual, shape, selectedMaskIndex);
  const diffMask = expectedMask.map((value, index) => value === actualMask[index] ? 0 : 1);
  const panels = [
    { label: 'source', x: 16, draw: () => drawSourcePanel(ctx, sourceImage, sourceImageIdentity, 16, 34, 200, 200) },
    { label: `reference mask ${selectedMaskIndex}`, x: 248, draw: () => drawBinaryPanel(ctx, expectedMask, shape, 248, 34, 200, 200, { on: [99, 230, 142], off: [34, 48, 42] }) },
    { label: 'webgpu', x: 480, draw: () => drawBinaryPanel(ctx, actualMask, shape, 480, 34, 200, 200, { on: [88, 182, 255], off: [34, 43, 52] }) },
    { label: 'diff', x: 712, draw: () => drawBinaryPanel(ctx, diffMask, shape, 712, 34, 200, 200, { on: [255, 77, 109], off: [30, 32, 32] }) },
  ];
  ctx.font = '13px monospace';
  for (const panel of panels) {
    ctx.fillStyle = '#dfe8e0';
    ctx.fillText(panel.label, panel.x, 20);
    panel.draw();
    ctx.strokeStyle = '#59635e';
    ctx.strokeRect(panel.x, 34, 200, 200);
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
    state.claims = {
      fullSam3BrowserExecution: manifest.claims.fullSam3BrowserExecution,
      upstream: manifest.claims.upstream,
      browserExecutedStages: manifest.claims.browserExecutedStages,
    };
    if (!manifest.staticWeights?.sha256 || !['none', 'reference-upstream'].includes(manifest.staticWeights.role)) {
      throw new Error('oracle packet must preserve explicit static-weight or reference-weight identity');
    }

    const hyperTensor = tensorByRole(manifest, 'hyper-input');
    const embeddingTensor = tensorByRole(manifest, 'upscaled-embedding');
    const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
    const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
    const hyperInput = await fetchArray(resolveManifestFile(hyperTensor.file), Float32Array);
    const upscaledEmbedding = await fetchArray(resolveManifestFile(embeddingTensor.file), Float32Array);
    const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
    const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);
    const sourceImageUrl = manifest.sourceImage?.file ? resolveManifestFile(manifest.sourceImage.file) : null;
    const sourceImage = sourceImageUrl ? await loadImage(sourceImageUrl) : null;
    if (sourceImageUrl) sourceImageEl.src = sourceImageUrl;
    const selectedMaskIndex = Number.isInteger(manifest.visualization?.selectedMaskIndex)
      ? manifest.visualization.selectedMaskIndex
      : 0;
    if (selectedMaskIndex < 0 || selectedMaskIndex >= manifest.shape.maskTokens) {
      throw new Error(`selectedMaskIndex ${selectedMaskIndex} out of range`);
    }

    const cpuOracle = createSam3MaskProjectionCpuOracle({
      hyperInput,
      upscaledEmbedding,
      shape: manifest.shape,
    });
    const oracleSelfCheck = {
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, cpuOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, cpuOracle.binaryMask),
    };
    const cpuTolerance = manifest.tolerances?.cpuOracleLogitsMaxAbsDiff ?? 0;
    const binaryTolerance = manifest.tolerances?.binaryMismatchCount ?? 0;
    if (oracleSelfCheck.logitsMaxAbsDiff > cpuTolerance || oracleSelfCheck.binaryMismatchCount > binaryTolerance) {
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
    const gpuTolerance = manifest.tolerances?.webGpuLogitsMaxAbsDiff ?? 0.00001;
    if (parity.maskLogitsMaxAbsDiff > gpuTolerance || parity.binaryMismatchCount > binaryTolerance) {
      throw new Error(`WebGPU parity mismatch: ${JSON.stringify(parity)}`);
    }

    drawVisualWitness({
      sourceImage,
      sourceImageIdentity: manifest.sourceImage || null,
      expected: expectedBinary,
      actual: gpuBinary,
      shape: manifest.shape,
      selectedMaskIndex,
    });
    state.status = 'passed';
    state.effectiveRouteId = result.receipt.effectiveRouteId;
    state.sourceImage = manifest.sourceImage || null;
    state.selectedMaskIndex = selectedMaskIndex;
    state.tensorPacket = {
      manifestUrl,
      schema: manifest.schema,
      mode: manifest.mode,
      boundary: manifest.boundary,
      sourceImage: manifest.sourceImage || null,
      reference: manifest.reference || null,
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
      mode: manifest.mode,
      adapter: state.backendIdentity?.adapterName,
      selectedMask: selectedMaskIndex,
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
