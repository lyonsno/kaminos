import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  createRouteInvocationRequest,
  createSam3MaskDecoderIslandRouteDefinition,
  createSam3MaskProjectionCpuOracle,
  createSam3MaskTailPhaseProgramCpuOracle,
  createSam3MaskTailPhaseProgramRouteDefinition,
  createSam3PixelDecoderPhaseProgramCpuOracle,
  createSam3PixelDecoderPhaseProgramRouteDefinition,
  runSam3MaskDecoderIslandRoute,
  runSam3MaskTailPhaseProgramRoute,
  runSam3PixelDecoderPhaseProgramRoute,
} from '../src/index.js';

const SUPPORTED_ROUTE_IDS = new Set([
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
]);
const PIXEL_DECODER_WEIGHT_ROLE_EXAMPLES = ['pixel-decoder-stage-0-conv-weight'];

const state = {
  schema: 'kaminos.sam3-mask-island.browser-parity-state.v0',
  status: 'loading',
  requestedRouteId: null,
  effectiveRouteId: null,
  claims: {
    fullSam3BrowserExecution: false,
    upstream: 'synthetic-oracle',
    browserExecutedStages: ['decode-mask', 'threshold-mask'],
  },
  tensorPacket: null,
  backendIdentity: null,
  routeReceipt: null,
  downstreamRouteReceipt: null,
  compositionEdge: null,
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

function weightByRole(manifest, role) {
  const weight = manifest.weights?.find(entry => entry.role === role);
  if (!weight) throw new Error(`manifest missing weight role ${role}`);
  return weight;
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

function sourceImageShape(manifest) {
  const resolution = manifest.sourceImage?.resolution;
  if (!Array.isArray(resolution) || resolution.length !== 2) return undefined;
  const [width, height] = resolution;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return undefined;
  return [height, width, 3];
}

async function aggregateTensorBundleSha256(kind, entries) {
  const canonical = JSON.stringify({
    kind,
    entries: entries.map(entry => ({
      role: entry.role,
      artifactId: entry.artifactId,
      sha256: entry.sha256,
      shape: entry.shape,
    })),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
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

async function loadMaskDecoderIslandPayload(manifest) {
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
  return {
    routeKind: 'mask-decoder-island',
    expectedLogits,
    expectedBinary,
    cpuSelfCheck: {
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, cpuOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, cpuOracle.binaryMask),
    },
    tensorIdentity: {
      hyperInputSha256: hyperTensor.sha256,
      upscaledEmbeddingSha256: embeddingTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
    },
    async run({ device, adapter, route, request }) {
      return runSam3MaskDecoderIslandRoute({
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
    },
  };
}

async function loadMaskTailPayload(manifest) {
  const lastHsTensor = tensorByRole(manifest, 'last-hs');
  const pixelEmbedTensor = tensorByRole(manifest, 'pixel-embed');
  const expectedMaskEmbeddingsTensor = tensorByRole(manifest, 'expected-mask-embeddings');
  const expectedUpscaledTensor = tensorByRole(manifest, 'expected-upscaled-embedding');
  const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
  const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
  const weightRoles = [
    'mask-embedder-layer-0-weight',
    'mask-embedder-layer-0-bias',
    'mask-embedder-layer-1-weight',
    'mask-embedder-layer-1-bias',
    'mask-embedder-layer-2-weight',
    'mask-embedder-layer-2-bias',
    'instance-projection-weight',
    'instance-projection-bias',
  ];
  const weightsByRole = Object.fromEntries(weightRoles.map(role => [role, weightByRole(manifest, role)]));
  const lastHs = await fetchArray(resolveManifestFile(lastHsTensor.file), Float32Array);
  const pixelEmbed = await fetchArray(resolveManifestFile(pixelEmbedTensor.file), Float32Array);
  const expectedMaskEmbeddings = await fetchArray(resolveManifestFile(expectedMaskEmbeddingsTensor.file), Float32Array);
  const expectedUpscaledEmbedding = await fetchArray(resolveManifestFile(expectedUpscaledTensor.file), Float32Array);
  const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
  const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);
  const weights = {
    maskEmbedder: [
      {
        weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-weight'].file), Float32Array),
        bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-bias'].file), Float32Array),
      },
      {
        weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-weight'].file), Float32Array),
        bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-bias'].file), Float32Array),
      },
      {
        weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-weight'].file), Float32Array),
        bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-bias'].file), Float32Array),
      },
    ],
    instanceProjection: {
      weight: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-weight'].file), Float32Array),
      bias: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-bias'].file), Float32Array),
    },
  };
  const cpuOracle = createSam3MaskTailPhaseProgramCpuOracle({
    lastHs,
    pixelEmbed,
    weights,
    shape: manifest.shape,
  });
  return {
    routeKind: 'mask-tail-phase-program',
    expectedLogits,
    expectedBinary,
    cpuSelfCheck: {
      maskEmbeddingsMaxAbsDiff: maxAbsDiff(expectedMaskEmbeddings, cpuOracle.maskEmbeddings),
      upscaledEmbeddingMaxAbsDiff: maxAbsDiff(expectedUpscaledEmbedding, cpuOracle.upscaledEmbedding),
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, cpuOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, cpuOracle.binaryMask),
    },
    tensorIdentity: {
      lastHsSha256: lastHsTensor.sha256,
      pixelEmbedSha256: pixelEmbedTensor.sha256,
      expectedMaskEmbeddingsSha256: expectedMaskEmbeddingsTensor.sha256,
      expectedUpscaledEmbeddingSha256: expectedUpscaledTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
      weightsSha256: Object.fromEntries(Object.entries(weightsByRole).map(([role, weight]) => [role, weight.sha256])),
    },
    async run({ device, adapter, route, request }) {
      return runSam3MaskTailPhaseProgramRoute({
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
          lastHs,
          pixelEmbed,
          weights,
          shape: manifest.shape,
        },
        includeReadback: true,
      });
    },
  };
}

async function loadPixelDecoderPayload(manifest) {
  const featureTensors = manifest.shape.levels.map((_, index) => tensorByRole(manifest, `fpn-feature-${index}`));
  const lastHsTensor = tensorByRole(manifest, 'last-hs');
  const expectedPixelTensor = tensorByRole(manifest, 'expected-pixel-embed');
  const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
  const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
  const expectedPixelEmbed = await fetchArray(resolveManifestFile(expectedPixelTensor.file), Float32Array);
  const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
  const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);
  const features = await Promise.all(featureTensors.map(tensor => fetchArray(resolveManifestFile(tensor.file), Float32Array)));
  const lastHs = await fetchArray(resolveManifestFile(lastHsTensor.file), Float32Array);
  const pixelWeightRoles = [];
  for (let stage = 0; stage < manifest.shape.levels.length - 1; stage += 1) {
    pixelWeightRoles.push(
      `pixel-decoder-stage-${stage}-conv-weight`,
      `pixel-decoder-stage-${stage}-conv-bias`,
      `pixel-decoder-stage-${stage}-norm-weight`,
      `pixel-decoder-stage-${stage}-norm-bias`,
    );
  }
  const tailWeightRoles = [
    'mask-embedder-layer-0-weight',
    'mask-embedder-layer-0-bias',
    'mask-embedder-layer-1-weight',
    'mask-embedder-layer-1-bias',
    'mask-embedder-layer-2-weight',
    'mask-embedder-layer-2-bias',
    'instance-projection-weight',
    'instance-projection-bias',
  ];
  const weightsByRole = Object.fromEntries([...pixelWeightRoles, ...tailWeightRoles].map(role => [role, weightByRole(manifest, role)]));
  const pixelWeights = {
    stages: await Promise.all(Array.from({ length: manifest.shape.levels.length - 1 }, async (_, stage) => ({
      convWeight: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-conv-weight`].file), Float32Array),
      convBias: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-conv-bias`].file), Float32Array),
      normWeight: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-norm-weight`].file), Float32Array),
      normBias: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-norm-bias`].file), Float32Array),
    }))),
  };
  const tailWeights = {
    maskEmbedder: [
      {
        weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-weight'].file), Float32Array),
        bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-bias'].file), Float32Array),
      },
      {
        weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-weight'].file), Float32Array),
        bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-bias'].file), Float32Array),
      },
      {
        weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-weight'].file), Float32Array),
        bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-bias'].file), Float32Array),
      },
    ],
    instanceProjection: {
      weight: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-weight'].file), Float32Array),
      bias: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-bias'].file), Float32Array),
    },
  };
  const pixelShape = {
    batch: manifest.shape.batch,
    channels: manifest.shape.channels,
    groups: manifest.shape.groups,
    levels: manifest.shape.levels,
  };
  const maskTailShape = {
    batch: manifest.shape.batch,
    maskTokens: manifest.shape.maskTokens,
    channels: manifest.shape.channels,
    height: manifest.shape.height,
    width: manifest.shape.width,
  };
  const pixelOracle = createSam3PixelDecoderPhaseProgramCpuOracle({
    features,
    weights: pixelWeights,
    shape: pixelShape,
  });
  const maskOracle = createSam3MaskTailPhaseProgramCpuOracle({
    lastHs,
    pixelEmbed: expectedPixelEmbed,
    weights: tailWeights,
    shape: maskTailShape,
  });
  return {
    routeKind: 'pixel-decoder-mask-tail-composition',
    expectedPixelEmbed,
    expectedLogits,
    expectedBinary,
    cpuSelfCheck: {
      pixelEmbedMaxAbsDiff: maxAbsDiff(expectedPixelEmbed, pixelOracle.pixelEmbed),
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, maskOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, maskOracle.binaryMask),
    },
    tensorIdentity: {
      fpnFeatureSha256: Object.fromEntries(featureTensors.map((tensor, index) => [`fpn-feature-${index}`, tensor.sha256])),
      lastHsSha256: lastHsTensor.sha256,
      expectedPixelEmbedSha256: expectedPixelTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
      weightsSha256: Object.fromEntries(Object.entries(weightsByRole).map(([role, weight]) => [role, weight.sha256])),
    },
    async run({ device, adapter, route, request }) {
      const pixelResult = await runSam3PixelDecoderPhaseProgramRoute({
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
          features,
          weights: pixelWeights,
          shape: pixelShape,
        },
        includeReadback: true,
      });
      const gpuPixelEmbed = new Float32Array(pixelResult.debugReadback.pixelEmbed);
      const pixelEmbedOutput = pixelResult.receipt.outputs.find(output => output.role === 'pixel-embed');
      if (!pixelEmbedOutput?.sha256 || !pixelEmbedOutput?.artifactId) throw new Error('pixel route output identity missing');
      const downstreamTensorSha256 = await aggregateTensorBundleSha256('sam3-mask-tail-composed-tensors', [
        { role: 'last-hs', sha256: lastHsTensor.sha256 },
        { role: 'pixel-embed', artifactId: pixelEmbedOutput.artifactId, sha256: pixelEmbedOutput.sha256, shape: pixelEmbedOutput.shape },
      ]);
      const maskRoute = createSam3MaskTailPhaseProgramRouteDefinition({
        model: {
          revision: manifest.model?.id || 'mlx-reference-mask-tail',
          dtype: 'fp32',
        },
        kernel: {
          profile: 'sam3-mask-tail-phase-program-v0',
          commit: params.get('commit') || null,
        },
      });
      const maskRequest = createRouteInvocationRequest(maskRoute, {
        requestId: `sam-browser-pixel-tail-${Date.now()}`,
        inputs: {
          'source-image': {
            artifactId: manifest.sourceImage?.artifactId || 'image:synthetic',
            sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image',
            shape: sourceImageShape(manifest),
          },
          'sam3-mask-tail-tensors': {
            artifactId: 'sam3-mask-tail-tensors:browser-pixel-decoder-composition',
            sha256: downstreamTensorSha256,
          },
          'sam3-mask-tail-weights': {
            artifactId: manifest.staticWeights.artifactId,
            sha256: manifest.staticWeights.sha256,
          },
        },
        outputs: {
          'mask-logits': { artifactId: 'sam3-mask-logits:browser-pixel-decoder-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.height, manifest.shape.width] },
          'mask-binary': { artifactId: 'sam3-mask-binary:browser-pixel-decoder-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.height, manifest.shape.width] },
        },
        routeConfig: {
          upstream: manifest.claims?.upstream || 'mlx-reference-pixel-decoder',
          promptHash: manifest.prompt?.sha256,
          composedFrom: pixelResult.receipt?.effectiveRouteId,
          pixelEmbedOutput,
        },
      });
      const tailResult = await runSam3MaskTailPhaseProgramRoute({
        request: maskRequest,
        route: maskRoute,
        device,
        queue: device.queue,
        adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter',
        browser: navigator.userAgent,
        kernel: maskRoute.kernel,
        model: {
          revision: maskRoute.model.revision,
          weightsHash: manifest.staticWeights.sha256,
          dtype: 'fp32',
        },
        tensors: {
          lastHs,
          pixelEmbed: gpuPixelEmbed,
          weights: tailWeights,
          shape: maskTailShape,
        },
        includeReadback: true,
      });
      return {
        ...tailResult,
        receipt: pixelResult.receipt,
        routeReceipt: pixelResult.receipt,
        downstreamRouteReceipt: tailResult.receipt,
        backend: tailResult.backend,
        debugReadback: {
          pixelEmbed: Array.from(gpuPixelEmbed),
          maskLogits: tailResult.debugReadback.maskLogits,
          binaryMask: tailResult.debugReadback.binaryMask,
        },
        compositionEdge: {
          upstreamRouteId: pixelResult.receipt.effectiveRouteId,
          downstreamRouteId: tailResult.receipt.effectiveRouteId,
          pixelEmbedOutput,
          downstreamTensorSha256,
        },
      };
    },
  };
}

async function main() {
  try {
    setStatus('load-oracle-packet');
    const manifest = await fetchJson(manifestUrl);
    if (!SUPPORTED_ROUTE_IDS.has(manifest.routeId)) {
      throw new Error(`unsupported manifest route: ${manifest.routeId}`);
    }
    state.requestedRouteId = manifest.routeId;
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

    const payload = manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? await loadPixelDecoderPayload(manifest)
      : manifest.routeId === SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID
        ? await loadMaskTailPayload(manifest)
        : await loadMaskDecoderIslandPayload(manifest);
    const expectedLogits = payload.expectedLogits;
    const expectedBinary = payload.expectedBinary;
    const sourceImageUrl = manifest.sourceImage?.file ? resolveManifestFile(manifest.sourceImage.file) : null;
    const sourceImage = sourceImageUrl ? await loadImage(sourceImageUrl) : null;
    if (sourceImageUrl) sourceImageEl.src = sourceImageUrl;
    const selectedMaskIndex = Number.isInteger(manifest.visualization?.selectedMaskIndex)
      ? manifest.visualization.selectedMaskIndex
      : 0;
    if (selectedMaskIndex < 0 || selectedMaskIndex >= manifest.shape.maskTokens) {
      throw new Error(`selectedMaskIndex ${selectedMaskIndex} out of range`);
    }

    const binaryTolerance = manifest.tolerances?.binaryMismatchCount ?? 0;
    const cpuOracleBinaryTolerance = manifest.tolerances?.cpuOracleBinaryMismatchCount ?? binaryTolerance;
    const oracleLogitsTolerance = manifest.tolerances?.cpuOracleLogitsMaxAbsDiff ?? manifest.tolerances?.webGpuLogitsMaxAbsDiff ?? 0;
    const pixelEmbedTolerance = manifest.tolerances?.pixelEmbedMaxAbsDiff ?? 0;
    const maskEmbeddingsTolerance = manifest.tolerances?.maskEmbeddingsMaxAbsDiff ?? 0;
    const upscaledTolerance = manifest.tolerances?.upscaledEmbeddingMaxAbsDiff ?? 0;
    if (
      (payload.cpuSelfCheck.logitsMaxAbsDiff ?? 0) > oracleLogitsTolerance
      || (payload.cpuSelfCheck.pixelEmbedMaxAbsDiff ?? 0) > pixelEmbedTolerance
      || (payload.cpuSelfCheck.maskEmbeddingsMaxAbsDiff ?? 0) > maskEmbeddingsTolerance
      || (payload.cpuSelfCheck.upscaledEmbeddingMaxAbsDiff ?? 0) > upscaledTolerance
      || payload.cpuSelfCheck.binaryMismatchCount > cpuOracleBinaryTolerance
    ) {
      throw new Error(`oracle packet self-check failed: ${JSON.stringify(payload.cpuSelfCheck)}`);
    }

    setStatus('request-webgpu-adapter');
    if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const device = await adapter.requestDevice();

    const route = manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? createSam3PixelDecoderPhaseProgramRouteDefinition({
          stageCount: manifest.shape.levels.length - 1,
          model: {
            revision: manifest.model?.id || 'mlx-reference-pixel-decoder',
            dtype: 'fp32',
          },
          kernel: {
            profile: 'sam3-pixel-decoder-phase-program-v0',
            commit: params.get('commit') || null,
          },
        })
      : manifest.routeId === SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID
      ? createSam3MaskTailPhaseProgramRouteDefinition({
          model: {
            revision: manifest.model?.id || 'mlx-reference-mask-tail',
            dtype: 'fp32',
          },
          kernel: {
            profile: 'sam3-mask-tail-phase-program-v0',
            commit: params.get('commit') || null,
          },
        })
      : createSam3MaskDecoderIslandRouteDefinition({
      model: {
        revision: manifest.model?.id || 'synthetic-oracle',
        dtype: 'fp32',
      },
      kernel: {
        profile: 'sam3-mask-projection-threshold-v0',
        commit: params.get('commit') || null,
      },
    });
    const sourceArtifact = {
      artifactId: manifest.sourceImage?.artifactId || 'image:synthetic',
      sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image',
      shape: sourceImageShape(manifest),
    };
    const pixelTensorBundleSha256 = manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? await aggregateTensorBundleSha256('sam3-pixel-decoder-tensors', Object.entries(payload.tensorIdentity.fpnFeatureSha256).map(([role, sha256]) => ({ role, sha256 })))
      : null;
    const inputArtifacts = manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? {
          'source-image': sourceArtifact,
          'sam3-pixel-decoder-tensors': {
            artifactId: 'sam3-pixel-decoder-tensors:browser-parity',
            sha256: pixelTensorBundleSha256,
          },
          'sam3-pixel-decoder-weights': {
            artifactId: manifest.staticWeights.artifactId,
            sha256: manifest.staticWeights.sha256,
          },
        }
      : manifest.routeId === SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID
      ? {
          'source-image': sourceArtifact,
          'sam3-mask-tail-tensors': {
            artifactId: 'sam3-mask-tail-tensors:browser-parity',
            sha256: payload.tensorIdentity.lastHsSha256,
          },
          'sam3-mask-tail-weights': {
            artifactId: manifest.staticWeights.artifactId,
            sha256: manifest.staticWeights.sha256,
          },
        }
      : {
          'source-image': sourceArtifact,
          'sam3-decoder-tensors': {
            artifactId: 'sam3-tensors:browser-parity',
            sha256: payload.tensorIdentity.hyperInputSha256,
          },
          'sam3-decoder-weights': {
            artifactId: manifest.staticWeights.artifactId,
            sha256: manifest.staticWeights.sha256,
          },
        };
    const request = createRouteInvocationRequest(route, {
      requestId: `sam-browser-parity-${Date.now()}`,
      inputs: inputArtifacts,
      outputs: {
        ...(manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
          ? { 'pixel-embed': { artifactId: 'sam3-pixel-embed:browser-parity', shape: [manifest.shape.batch, manifest.shape.height, manifest.shape.width, manifest.shape.channels] } }
          : {
              'mask-logits': { artifactId: 'sam3-mask-logits:browser-parity', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.height, manifest.shape.width] },
              'mask-binary': { artifactId: 'sam3-mask-binary:browser-parity', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.height, manifest.shape.width] },
            }),
      },
      routeConfig: {
        upstream: manifest.claims?.upstream || 'synthetic-oracle',
        promptHash: manifest.prompt?.sha256,
      },
    });

    setStatus('run-webgpu-route');
    const result = await payload.run({ device, adapter, route, request });

    const gpuLogits = new Float32Array(result.debugReadback.maskLogits);
    const gpuBinary = new Uint32Array(result.debugReadback.binaryMask);
    const parity = {
      pixelEmbedMaxAbsDiff: result.debugReadback.pixelEmbed ? maxAbsDiff(payload.expectedPixelEmbed || [], new Float32Array(result.debugReadback.pixelEmbed)) : undefined,
      maskLogitsMaxAbsDiff: maxAbsDiff(expectedLogits, gpuLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, gpuBinary),
      expectedElementCount: expectedLogits.length,
      gpuElementCount: gpuLogits.length,
    };
    const gpuTolerance = manifest.tolerances?.webGpuLogitsMaxAbsDiff ?? 0.00001;
    const gpuPixelTolerance = manifest.tolerances?.pixelEmbedMaxAbsDiff ?? 0.00001;
    if ((parity.pixelEmbedMaxAbsDiff ?? 0) > gpuPixelTolerance || parity.maskLogitsMaxAbsDiff > gpuTolerance || parity.binaryMismatchCount > binaryTolerance) {
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
      routeKind: payload.routeKind,
      sourceImage: manifest.sourceImage || null,
      reference: manifest.reference || null,
      ...payload.tensorIdentity,
      staticWeights: manifest.staticWeights,
    };
    state.backendIdentity = result.backend;
    state.routeReceipt = result.receipt;
    state.downstreamRouteReceipt = result.downstreamRouteReceipt || null;
    state.compositionEdge = result.compositionEdge || null;
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
