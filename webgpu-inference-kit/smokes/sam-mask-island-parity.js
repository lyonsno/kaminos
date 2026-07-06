import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  createRouteInvocationRequest,
  createSam3MaskDecoderIslandRouteDefinition,
  createSam3MaskProjectionCpuOracle,
  createSam3MaskTailPhaseProgramCpuOracle,
  createSam3MaskTailPhaseProgramRouteDefinition,
  createSam3PixelDecoderPhaseProgramCpuOracle,
  createSam3PixelDecoderPhaseProgramRouteDefinition,
  createSam3PromptFpnPhaseProgramCpuOracle,
  createSam3PromptFpnPhaseProgramRouteDefinition,
  createSam3DetrEncoderPhaseProgramRouteDefinition,
  runSam3MaskDecoderIslandRoute,
  runSam3MaskTailPhaseProgramRoute,
  runSam3PixelDecoderPhaseProgramRoute,
  runSam3PromptFpnPhaseProgramRoute,
  runSam3DetrEncoderPhaseProgramRoute,
} from '../src/index.js';

const SUPPORTED_ROUTE_IDS = new Set([
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
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
  midstreamRouteReceipt: null,
  downstreamRouteReceipt: null,
  compositionRouteReceipts: null,
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

function loadDetrLayerWeightRoles(layerCount) {
  const roles = [];
  for (let layer = 0; layer < layerCount; layer += 1) {
    roles.push(
      `detr-encoder-layer-${layer}-layernorm1-weight`,
      `detr-encoder-layer-${layer}-layernorm1-bias`,
      `detr-encoder-layer-${layer}-self-q-weight`,
      `detr-encoder-layer-${layer}-self-q-bias`,
      `detr-encoder-layer-${layer}-self-k-weight`,
      `detr-encoder-layer-${layer}-self-k-bias`,
      `detr-encoder-layer-${layer}-self-v-weight`,
      `detr-encoder-layer-${layer}-self-v-bias`,
      `detr-encoder-layer-${layer}-self-o-weight`,
      `detr-encoder-layer-${layer}-self-o-bias`,
      `detr-encoder-layer-${layer}-layernorm2-weight`,
      `detr-encoder-layer-${layer}-layernorm2-bias`,
      `detr-encoder-layer-${layer}-cross-q-weight`,
      `detr-encoder-layer-${layer}-cross-q-bias`,
      `detr-encoder-layer-${layer}-cross-k-weight`,
      `detr-encoder-layer-${layer}-cross-k-bias`,
      `detr-encoder-layer-${layer}-cross-v-weight`,
      `detr-encoder-layer-${layer}-cross-v-bias`,
      `detr-encoder-layer-${layer}-cross-o-weight`,
      `detr-encoder-layer-${layer}-cross-o-bias`,
      `detr-encoder-layer-${layer}-layernorm3-weight`,
      `detr-encoder-layer-${layer}-layernorm3-bias`,
      `detr-encoder-layer-${layer}-fc1-weight`,
      `detr-encoder-layer-${layer}-fc1-bias`,
      `detr-encoder-layer-${layer}-fc2-weight`,
      `detr-encoder-layer-${layer}-fc2-bias`,
    );
  }
  return roles;
}

async function loadDetrEncoderLayers(manifest, weightsByRole) {
  return Promise.all(Array.from({ length: manifest.shape.layerCount }, async (_, layer) => ({
    layerNorm1Weight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-layernorm1-weight`].file), Float32Array),
    layerNorm1Bias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-layernorm1-bias`].file), Float32Array),
    selfQWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-q-weight`].file), Float32Array),
    selfQBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-q-bias`].file), Float32Array),
    selfKWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-k-weight`].file), Float32Array),
    selfKBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-k-bias`].file), Float32Array),
    selfVWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-v-weight`].file), Float32Array),
    selfVBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-v-bias`].file), Float32Array),
    selfOWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-o-weight`].file), Float32Array),
    selfOBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-self-o-bias`].file), Float32Array),
    layerNorm2Weight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-layernorm2-weight`].file), Float32Array),
    layerNorm2Bias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-layernorm2-bias`].file), Float32Array),
    crossQWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-q-weight`].file), Float32Array),
    crossQBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-q-bias`].file), Float32Array),
    crossKWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-k-weight`].file), Float32Array),
    crossKBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-k-bias`].file), Float32Array),
    crossVWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-v-weight`].file), Float32Array),
    crossVBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-v-bias`].file), Float32Array),
    crossOWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-o-weight`].file), Float32Array),
    crossOBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-cross-o-bias`].file), Float32Array),
    layerNorm3Weight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-layernorm3-weight`].file), Float32Array),
    layerNorm3Bias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-layernorm3-bias`].file), Float32Array),
    fc1Weight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-fc1-weight`].file), Float32Array),
    fc1Bias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-fc1-bias`].file), Float32Array),
    fc2Weight: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-fc2-weight`].file), Float32Array),
    fc2Bias: await fetchArray(resolveManifestFile(weightsByRole[`detr-encoder-layer-${layer}-fc2-bias`].file), Float32Array),
  })));
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

async function loadDetrEncoderPayload(manifest) {
  const encoderSrcTensor = tensorByRole(manifest, 'encoder-src');
  const encoderPosTensor = tensorByRole(manifest, 'encoder-pos');
  const promptTensor = tensorByRole(manifest, 'prompt-features');
  const promptMaskTensor = tensorByRole(manifest, 'prompt-mask');
  const expectedEncoderTensor = tensorByRole(manifest, 'expected-encoder-hidden-states');
  const backboneTensors = manifest.shape.levels.map((_, index) => tensorByRole(manifest, `backbone-fpn-feature-${index}`));
  const expectedPromptTensor = tensorByRole(manifest, 'expected-prompt-fpn-feature');
  const lastHsTensor = tensorByRole(manifest, 'last-hs');
  const expectedPixelTensor = tensorByRole(manifest, 'expected-pixel-embed');
  const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
  const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
  const encoderSrc = await fetchArray(resolveManifestFile(encoderSrcTensor.file), Float32Array);
  const encoderPos = await fetchArray(resolveManifestFile(encoderPosTensor.file), Float32Array);
  const promptFeatures = await fetchArray(resolveManifestFile(promptTensor.file), Float32Array);
  const promptMask = await fetchArray(resolveManifestFile(promptMaskTensor.file), Float32Array);
  const expectedEncoderHiddenStates = await fetchArray(resolveManifestFile(expectedEncoderTensor.file), Float32Array);
  const backboneFeatures = await Promise.all(backboneTensors.map(tensor => fetchArray(resolveManifestFile(tensor.file), Float32Array)));
  const expectedPromptFpnFeature = await fetchArray(resolveManifestFile(expectedPromptTensor.file), Float32Array);
  const lastHs = await fetchArray(resolveManifestFile(lastHsTensor.file), Float32Array);
  const expectedPixelEmbed = await fetchArray(resolveManifestFile(expectedPixelTensor.file), Float32Array);
  const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
  const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);
  const detrWeightRoles = loadDetrLayerWeightRoles(manifest.shape.layerCount);
  const promptWeightRoles = [
    'prompt-cross-attn-norm-weight',
    'prompt-cross-attn-norm-bias',
    'prompt-cross-attn-q-weight',
    'prompt-cross-attn-q-bias',
    'prompt-cross-attn-k-weight',
    'prompt-cross-attn-k-bias',
    'prompt-cross-attn-v-weight',
    'prompt-cross-attn-v-bias',
    'prompt-cross-attn-o-weight',
    'prompt-cross-attn-o-bias',
  ];
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
  const weightsByRole = Object.fromEntries([...detrWeightRoles, ...promptWeightRoles, ...pixelWeightRoles, ...tailWeightRoles].map(role => [role, weightByRole(manifest, role)]));
  const detrWeights = { layers: await loadDetrEncoderLayers(manifest, weightsByRole) };
  const promptWeights = {
    layerNormWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-norm-weight'].file), Float32Array),
    layerNormBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-norm-bias'].file), Float32Array),
    qWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-q-weight'].file), Float32Array),
    qBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-q-bias'].file), Float32Array),
    kWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-k-weight'].file), Float32Array),
    kBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-k-bias'].file), Float32Array),
    vWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-v-weight'].file), Float32Array),
    vBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-v-bias'].file), Float32Array),
    oWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-o-weight'].file), Float32Array),
    oBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-o-bias'].file), Float32Array),
  };
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
      { weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-weight'].file), Float32Array), bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-bias'].file), Float32Array) },
      { weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-weight'].file), Float32Array), bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-bias'].file), Float32Array) },
      { weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-weight'].file), Float32Array), bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-bias'].file), Float32Array) },
    ],
    instanceProjection: {
      weight: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-weight'].file), Float32Array),
      bias: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-bias'].file), Float32Array),
    },
  };
  const detrShape = { batch: manifest.shape.batch, spatialTokens: manifest.shape.spatialTokens, promptTokens: manifest.shape.promptTokens, channels: manifest.shape.channels, heads: manifest.shape.heads, layerCount: manifest.shape.layerCount, mlpHidden: manifest.shape.mlpHidden, height: manifest.shape.height, width: manifest.shape.width };
  const promptShape = { batch: manifest.shape.batch, spatialTokens: manifest.shape.spatialTokens, promptTokens: manifest.shape.promptTokens, channels: manifest.shape.channels, heads: manifest.shape.heads, height: manifest.shape.height, width: manifest.shape.width };
  const pixelShape = { batch: manifest.shape.batch, channels: manifest.shape.channels, groups: manifest.shape.groups, levels: manifest.shape.levels };
  const maskTailShape = { batch: manifest.shape.batch, maskTokens: manifest.shape.maskTokens, channels: manifest.shape.channels, height: manifest.shape.levels[0].height, width: manifest.shape.levels[0].width };
  const pixelOracle = createSam3PixelDecoderPhaseProgramCpuOracle({ features: [backboneFeatures[0], backboneFeatures[1], expectedPromptFpnFeature], weights: pixelWeights, shape: pixelShape });
  const maskOracle = createSam3MaskTailPhaseProgramCpuOracle({ lastHs, pixelEmbed: expectedPixelEmbed, weights: tailWeights, shape: maskTailShape });
  return {
    routeKind: 'detr-encoder-prompt-fpn-pixel-decoder-mask-tail-composition',
    expectedEncoderHiddenStates,
    expectedPromptFpnFeature,
    expectedPixelEmbed,
    expectedLogits,
    expectedBinary,
    cpuSelfCheck: {
      pixelEmbedMaxAbsDiff: maxAbsDiff(expectedPixelEmbed, pixelOracle.pixelEmbed),
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, maskOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, maskOracle.binaryMask),
    },
    tensorIdentity: {
      encoderSrcSha256: encoderSrcTensor.sha256,
      encoderPosSha256: encoderPosTensor.sha256,
      promptFeaturesSha256: promptTensor.sha256,
      promptMaskSha256: promptMaskTensor.sha256,
      expectedEncoderHiddenStatesSha256: expectedEncoderTensor.sha256,
      expectedPromptFpnFeatureSha256: expectedPromptTensor.sha256,
      backboneFpnFeatureSha256: Object.fromEntries(backboneTensors.map((tensor, index) => [`backbone-fpn-feature-${index}`, tensor.sha256])),
      lastHsSha256: lastHsTensor.sha256,
      expectedPixelEmbedSha256: expectedPixelTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
      weightsSha256: Object.fromEntries(Object.entries(weightsByRole).map(([role, weight]) => [role, weight.sha256])),
    },
    async run({ device, adapter, route, request }) {
      const detrResult = await runSam3DetrEncoderPhaseProgramRoute({ request, route, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: route.kernel, model: { revision: route.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { encoderSrc, encoderPos, promptFeatures, promptMask, layers: detrWeights.layers, shape: detrShape }, includeReadback: true });
      const gpuEncoderHiddenStates = new Float32Array(detrResult.debugReadback.encoderHiddenStates);
      const encoderHiddenStatesOutput = detrResult.receipt.outputs.find(output => output.role === 'encoder-hidden-states');
      if (!encoderHiddenStatesOutput?.sha256 || !encoderHiddenStatesOutput?.artifactId) throw new Error('DETR encoder output identity missing');
      const encoderTensorSha256 = await aggregateTensorBundleSha256('sam3-prompt-fpn-composed-tensors', [
        { role: 'encoder-hidden-states', artifactId: encoderHiddenStatesOutput.artifactId, sha256: encoderHiddenStatesOutput.sha256, shape: encoderHiddenStatesOutput.shape },
        { role: 'prompt-features', sha256: promptTensor.sha256 },
        { role: 'prompt-mask', sha256: promptMaskTensor.sha256 },
      ]);
      const promptRoute = createSam3PromptFpnPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-prompt-fpn', dtype: 'fp32' }, kernel: { profile: 'sam3-prompt-fpn-phase-program-v0', commit: params.get('commit') || null } });
      const promptRequest = createRouteInvocationRequest(promptRoute, {
        requestId: `sam-browser-detr-prompt-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-prompt-fpn-tensors': { artifactId: 'sam3-prompt-fpn-tensors:browser-detr-composition', sha256: encoderTensorSha256 },
          'sam3-prompt-fpn-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: { 'prompt-fpn-feature': { artifactId: 'sam3-prompt-fpn-feature:browser-detr-composition', shape: [manifest.shape.batch, manifest.shape.height, manifest.shape.width, manifest.shape.channels] } },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-encoder', promptHash: manifest.prompt?.sha256, composedFrom: detrResult.receipt?.effectiveRouteId, encoderHiddenStatesOutput },
      });
      const promptResult = await runSam3PromptFpnPhaseProgramRoute({ request: promptRequest, route: promptRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: promptRoute.kernel, model: { revision: promptRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { encoderHiddenStates: gpuEncoderHiddenStates, promptFeatures, promptMask, weights: promptWeights, shape: promptShape }, includeReadback: true });
      const gpuPromptFpnFeature = new Float32Array(promptResult.debugReadback.promptFpnFeature);
      const promptFpnOutput = promptResult.receipt.outputs.find(output => output.role === 'prompt-fpn-feature');
      if (!promptFpnOutput?.sha256 || !promptFpnOutput?.artifactId) throw new Error('prompt-FPN route output identity missing');
      const pixelTensorSha256 = await aggregateTensorBundleSha256('sam3-pixel-decoder-composed-tensors', [
        { role: 'backbone-fpn-feature-0', sha256: backboneTensors[0].sha256 },
        { role: 'backbone-fpn-feature-1', sha256: backboneTensors[1].sha256 },
        { role: 'prompt-fpn-feature', artifactId: promptFpnOutput.artifactId, sha256: promptFpnOutput.sha256, shape: promptFpnOutput.shape },
      ]);
      const pixelRoute = createSam3PixelDecoderPhaseProgramRouteDefinition({ stageCount: manifest.shape.levels.length - 1, model: { revision: manifest.model?.id || 'mlx-reference-pixel-decoder', dtype: 'fp32' }, kernel: { profile: 'sam3-pixel-decoder-phase-program-v0', commit: params.get('commit') || null } });
      const pixelRequest = createRouteInvocationRequest(pixelRoute, {
        requestId: `sam-browser-detr-pixel-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-pixel-decoder-tensors': { artifactId: 'sam3-pixel-decoder-tensors:browser-detr-composition', sha256: pixelTensorSha256 },
          'sam3-pixel-decoder-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: { 'pixel-embed': { artifactId: 'sam3-pixel-embed:browser-detr-composition', shape: [manifest.shape.batch, manifest.shape.levels[0].height, manifest.shape.levels[0].width, manifest.shape.channels] } },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-encoder', promptHash: manifest.prompt?.sha256, composedFrom: promptResult.receipt?.effectiveRouteId, promptFpnOutput },
      });
      const pixelResult = await runSam3PixelDecoderPhaseProgramRoute({ request: pixelRequest, route: pixelRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: pixelRoute.kernel, model: { revision: pixelRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { features: [backboneFeatures[0], backboneFeatures[1], gpuPromptFpnFeature], weights: pixelWeights, shape: pixelShape }, includeReadback: true });
      const gpuPixelEmbed = new Float32Array(pixelResult.debugReadback.pixelEmbed);
      const pixelEmbedOutput = pixelResult.receipt.outputs.find(output => output.role === 'pixel-embed');
      if (!pixelEmbedOutput?.sha256 || !pixelEmbedOutput?.artifactId) throw new Error('pixel route output identity missing');
      const downstreamTensorSha256 = await aggregateTensorBundleSha256('sam3-mask-tail-composed-tensors', [
        { role: 'last-hs', sha256: lastHsTensor.sha256 },
        { role: 'pixel-embed', artifactId: pixelEmbedOutput.artifactId, sha256: pixelEmbedOutput.sha256, shape: pixelEmbedOutput.shape },
      ]);
      const maskRoute = createSam3MaskTailPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-mask-tail', dtype: 'fp32' }, kernel: { profile: 'sam3-mask-tail-phase-program-v0', commit: params.get('commit') || null } });
      const maskRequest = createRouteInvocationRequest(maskRoute, {
        requestId: `sam-browser-detr-tail-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-mask-tail-tensors': { artifactId: 'sam3-mask-tail-tensors:browser-detr-composition', sha256: downstreamTensorSha256 },
          'sam3-mask-tail-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: {
          'mask-logits': { artifactId: 'sam3-mask-logits:browser-detr-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.levels[0].height, manifest.shape.levels[0].width] },
          'mask-binary': { artifactId: 'sam3-mask-binary:browser-detr-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.levels[0].height, manifest.shape.levels[0].width] },
        },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-encoder', promptHash: manifest.prompt?.sha256, composedFrom: pixelResult.receipt?.effectiveRouteId, pixelEmbedOutput },
      });
      const tailResult = await runSam3MaskTailPhaseProgramRoute({ request: maskRequest, route: maskRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: maskRoute.kernel, model: { revision: maskRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { lastHs, pixelEmbed: gpuPixelEmbed, weights: tailWeights, shape: maskTailShape }, includeReadback: true });
      return {
        ...tailResult,
        receipt: detrResult.receipt,
        routeReceipt: detrResult.receipt,
        midstreamRouteReceipt: promptResult.receipt,
        downstreamRouteReceipt: tailResult.receipt,
        compositionRouteReceipts: [detrResult.receipt, promptResult.receipt, pixelResult.receipt, tailResult.receipt],
        backend: tailResult.backend,
        debugReadback: { encoderHiddenStates: Array.from(gpuEncoderHiddenStates), promptFpnFeature: Array.from(gpuPromptFpnFeature), pixelEmbed: Array.from(gpuPixelEmbed), maskLogits: tailResult.debugReadback.maskLogits, binaryMask: tailResult.debugReadback.binaryMask },
        compositionEdge: { upstreamRouteId: detrResult.receipt.effectiveRouteId, promptRouteId: promptResult.receipt.effectiveRouteId, midstreamRouteId: pixelResult.receipt.effectiveRouteId, downstreamRouteId: tailResult.receipt.effectiveRouteId, encoderHiddenStatesOutput, encoderTensorSha256, promptFpnOutput, pixelTensorSha256, pixelEmbedOutput, downstreamTensorSha256 },
      };
    },
  };
}

async function loadPromptFpnPayload(manifest) {
  const encoderTensor = tensorByRole(manifest, 'encoder-hidden-states');
  const promptTensor = tensorByRole(manifest, 'prompt-features');
  const promptMaskTensor = tensorByRole(manifest, 'prompt-mask');
  const backboneTensors = manifest.shape.levels.map((_, index) => tensorByRole(manifest, `backbone-fpn-feature-${index}`));
  const expectedPromptTensor = tensorByRole(manifest, 'expected-prompt-fpn-feature');
  const lastHsTensor = tensorByRole(manifest, 'last-hs');
  const expectedPixelTensor = tensorByRole(manifest, 'expected-pixel-embed');
  const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
  const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
  const encoderHiddenStates = await fetchArray(resolveManifestFile(encoderTensor.file), Float32Array);
  const promptFeatures = await fetchArray(resolveManifestFile(promptTensor.file), Float32Array);
  const promptMask = await fetchArray(resolveManifestFile(promptMaskTensor.file), Float32Array);
  const backboneFeatures = await Promise.all(backboneTensors.map(tensor => fetchArray(resolveManifestFile(tensor.file), Float32Array)));
  const expectedPromptFpnFeature = await fetchArray(resolveManifestFile(expectedPromptTensor.file), Float32Array);
  const lastHs = await fetchArray(resolveManifestFile(lastHsTensor.file), Float32Array);
  const expectedPixelEmbed = await fetchArray(resolveManifestFile(expectedPixelTensor.file), Float32Array);
  const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
  const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);
  const promptWeightRoles = [
    'prompt-cross-attn-norm-weight',
    'prompt-cross-attn-norm-bias',
    'prompt-cross-attn-q-weight',
    'prompt-cross-attn-q-bias',
    'prompt-cross-attn-k-weight',
    'prompt-cross-attn-k-bias',
    'prompt-cross-attn-v-weight',
    'prompt-cross-attn-v-bias',
    'prompt-cross-attn-o-weight',
    'prompt-cross-attn-o-bias',
  ];
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
  const weightsByRole = Object.fromEntries([...promptWeightRoles, ...pixelWeightRoles, ...tailWeightRoles].map(role => [role, weightByRole(manifest, role)]));
  const promptWeights = {
    layerNormWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-norm-weight'].file), Float32Array),
    layerNormBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-norm-bias'].file), Float32Array),
    qWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-q-weight'].file), Float32Array),
    qBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-q-bias'].file), Float32Array),
    kWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-k-weight'].file), Float32Array),
    kBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-k-bias'].file), Float32Array),
    vWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-v-weight'].file), Float32Array),
    vBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-v-bias'].file), Float32Array),
    oWeight: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-o-weight'].file), Float32Array),
    oBias: await fetchArray(resolveManifestFile(weightsByRole['prompt-cross-attn-o-bias'].file), Float32Array),
  };
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
      { weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-weight'].file), Float32Array), bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-0-bias'].file), Float32Array) },
      { weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-weight'].file), Float32Array), bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-1-bias'].file), Float32Array) },
      { weight: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-weight'].file), Float32Array), bias: await fetchArray(resolveManifestFile(weightsByRole['mask-embedder-layer-2-bias'].file), Float32Array) },
    ],
    instanceProjection: {
      weight: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-weight'].file), Float32Array),
      bias: await fetchArray(resolveManifestFile(weightsByRole['instance-projection-bias'].file), Float32Array),
    },
  };
  const promptShape = { batch: manifest.shape.batch, spatialTokens: manifest.shape.spatialTokens, promptTokens: manifest.shape.promptTokens, channels: manifest.shape.channels, heads: manifest.shape.heads, height: manifest.shape.height, width: manifest.shape.width };
  const pixelShape = { batch: manifest.shape.batch, channels: manifest.shape.channels, groups: manifest.shape.groups, levels: manifest.shape.levels };
  const maskTailShape = { batch: manifest.shape.batch, maskTokens: manifest.shape.maskTokens, channels: manifest.shape.channels, height: manifest.shape.levels[0].height, width: manifest.shape.levels[0].width };
  const promptOracle = createSam3PromptFpnPhaseProgramCpuOracle({ encoderHiddenStates, promptFeatures, promptMask, weights: promptWeights, shape: promptShape });
  const pixelOracle = createSam3PixelDecoderPhaseProgramCpuOracle({ features: [backboneFeatures[0], backboneFeatures[1], expectedPromptFpnFeature], weights: pixelWeights, shape: pixelShape });
  const maskOracle = createSam3MaskTailPhaseProgramCpuOracle({ lastHs, pixelEmbed: expectedPixelEmbed, weights: tailWeights, shape: maskTailShape });
  return {
    routeKind: 'prompt-fpn-pixel-decoder-mask-tail-composition',
    expectedPromptFpnFeature,
    expectedPixelEmbed,
    expectedLogits,
    expectedBinary,
    cpuSelfCheck: {
      promptFpnMaxAbsDiff: maxAbsDiff(expectedPromptFpnFeature, promptOracle.promptFpnFeature),
      pixelEmbedMaxAbsDiff: maxAbsDiff(expectedPixelEmbed, pixelOracle.pixelEmbed),
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, maskOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, maskOracle.binaryMask),
    },
    tensorIdentity: {
      encoderHiddenStatesSha256: encoderTensor.sha256,
      promptFeaturesSha256: promptTensor.sha256,
      promptMaskSha256: promptMaskTensor.sha256,
      backboneFpnFeatureSha256: Object.fromEntries(backboneTensors.map((tensor, index) => [`backbone-fpn-feature-${index}`, tensor.sha256])),
      expectedPromptFpnFeatureSha256: expectedPromptTensor.sha256,
      lastHsSha256: lastHsTensor.sha256,
      expectedPixelEmbedSha256: expectedPixelTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
      weightsSha256: Object.fromEntries(Object.entries(weightsByRole).map(([role, weight]) => [role, weight.sha256])),
    },
    async run({ device, adapter, route, request }) {
      const promptResult = await runSam3PromptFpnPhaseProgramRoute({ request, route, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: route.kernel, model: { revision: route.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { encoderHiddenStates, promptFeatures, promptMask, weights: promptWeights, shape: promptShape }, includeReadback: true });
      const gpuPromptFpnFeature = new Float32Array(promptResult.debugReadback.promptFpnFeature);
      const promptFpnOutput = promptResult.receipt.outputs.find(output => output.role === 'prompt-fpn-feature');
      if (!promptFpnOutput?.sha256 || !promptFpnOutput?.artifactId) throw new Error('prompt-FPN route output identity missing');
      const pixelTensorSha256 = await aggregateTensorBundleSha256('sam3-pixel-decoder-composed-tensors', [
        { role: 'backbone-fpn-feature-0', sha256: backboneTensors[0].sha256 },
        { role: 'backbone-fpn-feature-1', sha256: backboneTensors[1].sha256 },
        { role: 'prompt-fpn-feature', artifactId: promptFpnOutput.artifactId, sha256: promptFpnOutput.sha256, shape: promptFpnOutput.shape },
      ]);
      const pixelRoute = createSam3PixelDecoderPhaseProgramRouteDefinition({ stageCount: manifest.shape.levels.length - 1, model: { revision: manifest.model?.id || 'mlx-reference-pixel-decoder', dtype: 'fp32' }, kernel: { profile: 'sam3-pixel-decoder-phase-program-v0', commit: params.get('commit') || null } });
      const pixelRequest = createRouteInvocationRequest(pixelRoute, {
        requestId: `sam-browser-prompt-pixel-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-pixel-decoder-tensors': { artifactId: 'sam3-pixel-decoder-tensors:browser-prompt-fpn-composition', sha256: pixelTensorSha256 },
          'sam3-pixel-decoder-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: { 'pixel-embed': { artifactId: 'sam3-pixel-embed:browser-prompt-fpn-composition', shape: [manifest.shape.batch, manifest.shape.levels[0].height, manifest.shape.levels[0].width, manifest.shape.channels] } },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-prompt-fpn', promptHash: manifest.prompt?.sha256, composedFrom: promptResult.receipt?.effectiveRouteId, promptFpnOutput },
      });
      const pixelResult = await runSam3PixelDecoderPhaseProgramRoute({ request: pixelRequest, route: pixelRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: pixelRoute.kernel, model: { revision: pixelRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { features: [backboneFeatures[0], backboneFeatures[1], gpuPromptFpnFeature], weights: pixelWeights, shape: pixelShape }, includeReadback: true });
      const gpuPixelEmbed = new Float32Array(pixelResult.debugReadback.pixelEmbed);
      const pixelEmbedOutput = pixelResult.receipt.outputs.find(output => output.role === 'pixel-embed');
      if (!pixelEmbedOutput?.sha256 || !pixelEmbedOutput?.artifactId) throw new Error('pixel route output identity missing');
      const downstreamTensorSha256 = await aggregateTensorBundleSha256('sam3-mask-tail-composed-tensors', [
        { role: 'last-hs', sha256: lastHsTensor.sha256 },
        { role: 'pixel-embed', artifactId: pixelEmbedOutput.artifactId, sha256: pixelEmbedOutput.sha256, shape: pixelEmbedOutput.shape },
      ]);
      const maskRoute = createSam3MaskTailPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-mask-tail', dtype: 'fp32' }, kernel: { profile: 'sam3-mask-tail-phase-program-v0', commit: params.get('commit') || null } });
      const maskRequest = createRouteInvocationRequest(maskRoute, {
        requestId: `sam-browser-prompt-tail-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-mask-tail-tensors': { artifactId: 'sam3-mask-tail-tensors:browser-prompt-fpn-composition', sha256: downstreamTensorSha256 },
          'sam3-mask-tail-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: {
          'mask-logits': { artifactId: 'sam3-mask-logits:browser-prompt-fpn-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.levels[0].height, manifest.shape.levels[0].width] },
          'mask-binary': { artifactId: 'sam3-mask-binary:browser-prompt-fpn-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.levels[0].height, manifest.shape.levels[0].width] },
        },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-prompt-fpn', promptHash: manifest.prompt?.sha256, composedFrom: pixelResult.receipt?.effectiveRouteId, pixelEmbedOutput },
      });
      const tailResult = await runSam3MaskTailPhaseProgramRoute({ request: maskRequest, route: maskRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: maskRoute.kernel, model: { revision: maskRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { lastHs, pixelEmbed: gpuPixelEmbed, weights: tailWeights, shape: maskTailShape }, includeReadback: true });
      return { ...tailResult, receipt: promptResult.receipt, routeReceipt: promptResult.receipt, midstreamRouteReceipt: pixelResult.receipt, downstreamRouteReceipt: tailResult.receipt, backend: tailResult.backend, debugReadback: { promptFpnFeature: Array.from(gpuPromptFpnFeature), pixelEmbed: Array.from(gpuPixelEmbed), maskLogits: tailResult.debugReadback.maskLogits, binaryMask: tailResult.debugReadback.binaryMask }, compositionEdge: { upstreamRouteId: promptResult.receipt.effectiveRouteId, midstreamRouteId: pixelResult.receipt.effectiveRouteId, downstreamRouteId: tailResult.receipt.effectiveRouteId, promptFpnOutput, pixelTensorSha256, pixelEmbedOutput, downstreamTensorSha256 } };
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

    const payload = manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
      ? await loadDetrEncoderPayload(manifest)
      : manifest.routeId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
      ? await loadPromptFpnPayload(manifest)
      : manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
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
    const promptFpnTolerance = manifest.tolerances?.promptFpnMaxAbsDiff ?? 0;
    const pixelEmbedTolerance = manifest.tolerances?.pixelEmbedMaxAbsDiff ?? 0;
    const maskEmbeddingsTolerance = manifest.tolerances?.maskEmbeddingsMaxAbsDiff ?? 0;
    const upscaledTolerance = manifest.tolerances?.upscaledEmbeddingMaxAbsDiff ?? 0;
    if (
      (payload.cpuSelfCheck.logitsMaxAbsDiff ?? 0) > oracleLogitsTolerance
      || (payload.cpuSelfCheck.promptFpnMaxAbsDiff ?? 0) > promptFpnTolerance
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

    const route = manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
      ? createSam3DetrEncoderPhaseProgramRouteDefinition({
          model: {
            revision: manifest.model?.id || 'mlx-reference-detr-encoder',
            dtype: 'fp32',
          },
          kernel: {
            profile: 'sam3-detr-encoder-phase-program-v0',
            commit: params.get('commit') || null,
          },
          shape: manifest.shape,
        })
      : manifest.routeId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
      ? createSam3PromptFpnPhaseProgramRouteDefinition({
          model: {
            revision: manifest.model?.id || 'mlx-reference-prompt-fpn',
            dtype: 'fp32',
          },
          kernel: {
            profile: 'sam3-prompt-fpn-phase-program-v0',
            commit: params.get('commit') || null,
          },
        })
      : manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
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
    const detrTensorBundleSha256 = manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
      ? await aggregateTensorBundleSha256('sam3-detr-encoder-tensors', [
          { role: 'encoder-src', sha256: payload.tensorIdentity.encoderSrcSha256 },
          { role: 'encoder-pos', sha256: payload.tensorIdentity.encoderPosSha256 },
          { role: 'prompt-features', sha256: payload.tensorIdentity.promptFeaturesSha256 },
          { role: 'prompt-mask', sha256: payload.tensorIdentity.promptMaskSha256 },
        ])
      : null;
    const promptTensorBundleSha256 = manifest.routeId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
      ? await aggregateTensorBundleSha256('sam3-prompt-fpn-tensors', [
          { role: 'encoder-hidden-states', sha256: payload.tensorIdentity.encoderHiddenStatesSha256 },
          { role: 'prompt-features', sha256: payload.tensorIdentity.promptFeaturesSha256 },
          { role: 'prompt-mask', sha256: payload.tensorIdentity.promptMaskSha256 },
        ])
      : null;
    const pixelTensorBundleSha256 = manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? await aggregateTensorBundleSha256('sam3-pixel-decoder-tensors', Object.entries(payload.tensorIdentity.fpnFeatureSha256).map(([role, sha256]) => ({ role, sha256 })))
      : null;
    const inputArtifacts = manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
      ? {
          'source-image': sourceArtifact,
          'sam3-detr-encoder-tensors': {
            artifactId: 'sam3-detr-encoder-tensors:browser-parity',
            sha256: detrTensorBundleSha256,
          },
          'sam3-detr-encoder-weights': {
            artifactId: manifest.staticWeights.artifactId,
            sha256: manifest.staticWeights.sha256,
          },
        }
      : manifest.routeId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
      ? {
          'source-image': sourceArtifact,
          'sam3-prompt-fpn-tensors': {
            artifactId: 'sam3-prompt-fpn-tensors:browser-parity',
            sha256: promptTensorBundleSha256,
          },
          'sam3-prompt-fpn-weights': {
            artifactId: manifest.staticWeights.artifactId,
            sha256: manifest.staticWeights.sha256,
          },
        }
      : manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
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
        ...(manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
          ? { 'encoder-hidden-states': { artifactId: 'sam3-encoder-hidden-states:browser-parity', shape: [manifest.shape.batch, manifest.shape.spatialTokens, manifest.shape.channels] } }
          : manifest.routeId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
          ? { 'prompt-fpn-feature': { artifactId: 'sam3-prompt-fpn-feature:browser-parity', shape: [manifest.shape.batch, manifest.shape.height, manifest.shape.width, manifest.shape.channels] } }
          : manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
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
      encoderHiddenStatesMaxAbsDiff: result.debugReadback.encoderHiddenStates ? maxAbsDiff(payload.expectedEncoderHiddenStates || [], new Float32Array(result.debugReadback.encoderHiddenStates)) : undefined,
      promptFpnMaxAbsDiff: result.debugReadback.promptFpnFeature ? maxAbsDiff(payload.expectedPromptFpnFeature || [], new Float32Array(result.debugReadback.promptFpnFeature)) : undefined,
      pixelEmbedMaxAbsDiff: result.debugReadback.pixelEmbed ? maxAbsDiff(payload.expectedPixelEmbed || [], new Float32Array(result.debugReadback.pixelEmbed)) : undefined,
      maskLogitsMaxAbsDiff: maxAbsDiff(expectedLogits, gpuLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, gpuBinary),
      expectedElementCount: expectedLogits.length,
      gpuElementCount: gpuLogits.length,
    };
    const gpuTolerance = manifest.tolerances?.webGpuLogitsMaxAbsDiff ?? 0.00001;
    const gpuEncoderTolerance = manifest.tolerances?.encoderHiddenStatesMaxAbsDiff ?? 0.0002;
    const gpuPromptFpnTolerance = manifest.tolerances?.promptFpnMaxAbsDiff ?? 0.00001;
    const gpuPixelTolerance = manifest.tolerances?.pixelEmbedMaxAbsDiff ?? 0.00001;
    if ((parity.encoderHiddenStatesMaxAbsDiff ?? 0) > gpuEncoderTolerance || (parity.promptFpnMaxAbsDiff ?? 0) > gpuPromptFpnTolerance || (parity.pixelEmbedMaxAbsDiff ?? 0) > gpuPixelTolerance || parity.maskLogitsMaxAbsDiff > gpuTolerance || parity.binaryMismatchCount > binaryTolerance) {
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
    state.midstreamRouteReceipt = result.midstreamRouteReceipt || null;
    state.downstreamRouteReceipt = result.downstreamRouteReceipt || null;
    state.compositionRouteReceipts = result.compositionRouteReceipts || null;
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
