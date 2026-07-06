import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
  createRouteInvocationRequest,
  createSam3MaskDecoderIslandRouteDefinition,
  createSam3MaskProjectionCpuOracle,
  createSam3ImagePreprocessPhaseProgramCpuOracle,
  createSam3ImagePreprocessPhaseProgramRouteDefinition,
  createSam3MaskTailPhaseProgramCpuOracle,
  createSam3MaskTailPhaseProgramRouteDefinition,
  createSam3PixelDecoderPhaseProgramCpuOracle,
  createSam3PixelDecoderPhaseProgramRouteDefinition,
  createSam3PromptFpnPhaseProgramCpuOracle,
  createSam3PromptFpnPhaseProgramRouteDefinition,
  createSam3DetrEncoderPhaseProgramRouteDefinition,
  createSam3DetrDecoderPhaseProgramRouteDefinition,
  createSam3ScoringPhaseProgramCpuOracle,
  createSam3ScoringPhaseProgramRouteDefinition,
  createSam3SelectionPostprocessPhaseProgramCpuOracle,
  createSam3SelectionPostprocessPhaseProgramRouteDefinition,
  runSam3MaskDecoderIslandRoute,
  runSam3MaskTailPhaseProgramRoute,
  runSam3PixelDecoderPhaseProgramRoute,
  runSam3PromptFpnPhaseProgramRoute,
  runSam3DetrEncoderPhaseProgramRoute,
  runSam3DetrDecoderPhaseProgramRoute,
  runSam3ScoringPhaseProgramRoute,
  runSam3SelectionPostprocessPhaseProgramRoute,
  runSam3ImagePreprocessPhaseProgramRoute,
} from '../src/index.js';

const SUPPORTED_ROUTE_IDS = new Set([
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
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
  detectorStackEvidence: null,
  imagePreprocessEvidence: null,
  parity: null,
  debugReadbackSamples: null,
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

function imagePreprocessShape(manifest) {
  return {
    batch: manifest.shape.batch || 1,
    height: manifest.shape.imageHeight || manifest.sourceImage?.resolution?.[1],
    width: manifest.shape.imageWidth || manifest.sourceImage?.resolution?.[0],
    channels: manifest.shape.imageChannels || 3,
  };
}

function rgbaFromSourceImage(sourceImage, shape) {
  if (!sourceImage) throw new Error('source image is required for SAM3 image-preprocess ingress');
  const scratch = document.createElement('canvas');
  scratch.width = shape.width;
  scratch.height = shape.height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceImage, 0, 0, shape.width, shape.height);
  return ctx.getImageData(0, 0, shape.width, shape.height).data;
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

function drawScoringWitness({ sourceImage, sourceImageIdentity, expected, actual }) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#050706';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawSourcePanel(ctx, sourceImage, sourceImageIdentity, 16, 34, 200, 200);
  ctx.strokeStyle = '#59635e';
  ctx.strokeRect(16, 34, 200, 200);
  ctx.fillStyle = '#dfe8e0';
  ctx.font = '13px monospace';
  ctx.fillText('source', 16, 20);
  ctx.fillText('SAM3 scoring logits', 248, 20);
  const count = Math.min(expected.length, 64);
  let maxAbs = 1e-6;
  for (let index = 0; index < count; index += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(expected[index]), Math.abs(actual[index]));
  }
  const baseY = 135;
  const step = Math.max(4, Math.floor(680 / Math.max(count, 1)));
  for (let index = 0; index < count; index += 1) {
    const x = 248 + index * step;
    const expectedHeight = Math.round((Math.abs(expected[index]) / maxAbs) * 90);
    const actualHeight = Math.round((Math.abs(actual[index]) / maxAbs) * 90);
    ctx.fillStyle = expected[index] >= 0 ? '#63e68e' : '#ff6b8a';
    ctx.fillRect(x, expected[index] >= 0 ? baseY - expectedHeight : baseY, Math.max(1, step - 2), expectedHeight);
    ctx.fillStyle = actual[index] >= 0 ? '#58b6ff' : '#d985ff';
    ctx.fillRect(x, actual[index] >= 0 ? baseY + 104 - actualHeight : baseY + 104, Math.max(1, step - 2), actualHeight);
  }
  ctx.strokeStyle = '#59635e';
  ctx.beginPath();
  ctx.moveTo(248, baseY + 0.5);
  ctx.lineTo(928, baseY + 0.5);
  ctx.moveTo(248, baseY + 104.5);
  ctx.lineTo(928, baseY + 104.5);
  ctx.stroke();
  ctx.fillStyle = '#9fafaa';
  ctx.font = '12px monospace';
  ctx.fillText(`reference logits first ${count}`, 248, 248);
  ctx.fillText(`webgpu logits first ${count}`, 248, 268);
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

function loadDetrDecoderLayerWeightRoles(layerCount) {
  const roles = [];
  for (let layer = 0; layer < layerCount; layer += 1) {
    roles.push(
      `detr-decoder-layer-${layer}-self-q-weight`,
      `detr-decoder-layer-${layer}-self-q-bias`,
      `detr-decoder-layer-${layer}-self-k-weight`,
      `detr-decoder-layer-${layer}-self-k-bias`,
      `detr-decoder-layer-${layer}-self-v-weight`,
      `detr-decoder-layer-${layer}-self-v-bias`,
      `detr-decoder-layer-${layer}-self-o-weight`,
      `detr-decoder-layer-${layer}-self-o-bias`,
      `detr-decoder-layer-${layer}-text-q-weight`,
      `detr-decoder-layer-${layer}-text-q-bias`,
      `detr-decoder-layer-${layer}-text-k-weight`,
      `detr-decoder-layer-${layer}-text-k-bias`,
      `detr-decoder-layer-${layer}-text-v-weight`,
      `detr-decoder-layer-${layer}-text-v-bias`,
      `detr-decoder-layer-${layer}-text-o-weight`,
      `detr-decoder-layer-${layer}-text-o-bias`,
      `detr-decoder-layer-${layer}-vision-q-weight`,
      `detr-decoder-layer-${layer}-vision-q-bias`,
      `detr-decoder-layer-${layer}-vision-k-weight`,
      `detr-decoder-layer-${layer}-vision-k-bias`,
      `detr-decoder-layer-${layer}-vision-v-weight`,
      `detr-decoder-layer-${layer}-vision-v-bias`,
      `detr-decoder-layer-${layer}-vision-o-weight`,
      `detr-decoder-layer-${layer}-vision-o-bias`,
      `detr-decoder-layer-${layer}-self-layernorm-weight`,
      `detr-decoder-layer-${layer}-self-layernorm-bias`,
      `detr-decoder-layer-${layer}-text-layernorm-weight`,
      `detr-decoder-layer-${layer}-text-layernorm-bias`,
      `detr-decoder-layer-${layer}-vision-layernorm-weight`,
      `detr-decoder-layer-${layer}-vision-layernorm-bias`,
      `detr-decoder-layer-${layer}-mlp-layernorm-weight`,
      `detr-decoder-layer-${layer}-mlp-layernorm-bias`,
      `detr-decoder-layer-${layer}-fc1-weight`,
      `detr-decoder-layer-${layer}-fc1-bias`,
      `detr-decoder-layer-${layer}-fc2-weight`,
      `detr-decoder-layer-${layer}-fc2-bias`,
    );
  }
  return roles;
}

async function loadDetrDecoderLayers(manifest, weightsByRole) {
  return Promise.all(Array.from({ length: manifest.shape.layerCount }, async (_, layer) => ({
    selfQWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-q-weight`].file), Float32Array),
    selfQBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-q-bias`].file), Float32Array),
    selfKWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-k-weight`].file), Float32Array),
    selfKBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-k-bias`].file), Float32Array),
    selfVWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-v-weight`].file), Float32Array),
    selfVBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-v-bias`].file), Float32Array),
    selfOWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-o-weight`].file), Float32Array),
    selfOBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-o-bias`].file), Float32Array),
    textQWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-q-weight`].file), Float32Array),
    textQBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-q-bias`].file), Float32Array),
    textKWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-k-weight`].file), Float32Array),
    textKBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-k-bias`].file), Float32Array),
    textVWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-v-weight`].file), Float32Array),
    textVBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-v-bias`].file), Float32Array),
    textOWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-o-weight`].file), Float32Array),
    textOBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-o-bias`].file), Float32Array),
    visionQWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-q-weight`].file), Float32Array),
    visionQBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-q-bias`].file), Float32Array),
    visionKWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-k-weight`].file), Float32Array),
    visionKBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-k-bias`].file), Float32Array),
    visionVWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-v-weight`].file), Float32Array),
    visionVBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-v-bias`].file), Float32Array),
    visionOWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-o-weight`].file), Float32Array),
    visionOBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-o-bias`].file), Float32Array),
    selfLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-layernorm-weight`].file), Float32Array),
    selfLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-self-layernorm-bias`].file), Float32Array),
    textLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-layernorm-weight`].file), Float32Array),
    textLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-text-layernorm-bias`].file), Float32Array),
    visionLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-layernorm-weight`].file), Float32Array),
    visionLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-vision-layernorm-bias`].file), Float32Array),
    mlpLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-mlp-layernorm-weight`].file), Float32Array),
    mlpLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-mlp-layernorm-bias`].file), Float32Array),
    fc1Weight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-fc1-weight`].file), Float32Array),
    fc1Bias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-fc1-bias`].file), Float32Array),
    fc2Weight: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-fc2-weight`].file), Float32Array),
    fc2Bias: await fetchArray(resolveManifestFile(weightsByRole[`detr-decoder-layer-${layer}-fc2-bias`].file), Float32Array),
  })));
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

async function loadDetrDecoderPayload(manifest) {
  const encoderTensor = tensorByRole(manifest, 'encoder-hidden-states');
  const encoderPosTensor = tensorByRole(manifest, 'encoder-pos');
  const promptTensor = tensorByRole(manifest, 'prompt-features');
  const promptMaskTensor = tensorByRole(manifest, 'prompt-mask');
  const expectedLastHsTensor = tensorByRole(manifest, 'expected-last-hs');
  const expectedReferenceBoxesTensor = tensorByRole(manifest, 'expected-reference-boxes');
  const expectedPresenceLogitsTensor = tensorByRole(manifest, 'expected-presence-logits');
  const pixelEmbedTensor = tensorByRole(manifest, 'pixel-embed');
  const expectedMaskEmbeddingsTensor = tensorByRole(manifest, 'expected-mask-embeddings');
  const expectedUpscaledTensor = tensorByRole(manifest, 'expected-upscaled-embedding');
  const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
  const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
  const decoderLayerRoles = loadDetrDecoderLayerWeightRoles(manifest.shape.layerCount);
  const decoderSharedRoles = [
    'detr-decoder-query-embed-weight',
    'detr-decoder-reference-points-weight',
    'detr-decoder-presence-token-weight',
    'detr-decoder-output-layernorm-weight',
    'detr-decoder-output-layernorm-bias',
    'detr-decoder-ref-point-head-layer-1-weight',
    'detr-decoder-ref-point-head-layer-1-bias',
    'detr-decoder-ref-point-head-layer-2-weight',
    'detr-decoder-ref-point-head-layer-2-bias',
    'detr-decoder-box-head-layer-1-weight',
    'detr-decoder-box-head-layer-1-bias',
    'detr-decoder-box-head-layer-2-weight',
    'detr-decoder-box-head-layer-2-bias',
    'detr-decoder-box-head-layer-3-weight',
    'detr-decoder-box-head-layer-3-bias',
    'detr-decoder-box-rpb-x-layer-1-weight',
    'detr-decoder-box-rpb-x-layer-1-bias',
    'detr-decoder-box-rpb-x-layer-2-weight',
    'detr-decoder-box-rpb-x-layer-2-bias',
    'detr-decoder-box-rpb-y-layer-1-weight',
    'detr-decoder-box-rpb-y-layer-1-bias',
    'detr-decoder-box-rpb-y-layer-2-weight',
    'detr-decoder-box-rpb-y-layer-2-bias',
    'detr-decoder-presence-layernorm-weight',
    'detr-decoder-presence-layernorm-bias',
    'detr-decoder-presence-head-layer-1-weight',
    'detr-decoder-presence-head-layer-1-bias',
    'detr-decoder-presence-head-layer-2-weight',
    'detr-decoder-presence-head-layer-2-bias',
    'detr-decoder-presence-head-layer-3-weight',
    'detr-decoder-presence-head-layer-3-bias',
  ];
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
  const weightsByRole = Object.fromEntries([...decoderLayerRoles, ...decoderSharedRoles, ...tailWeightRoles].map(role => [role, weightByRole(manifest, role)]));
  const visionFeatures = await fetchArray(resolveManifestFile(encoderTensor.file), Float32Array);
  const visionPosEncoding = await fetchArray(resolveManifestFile(encoderPosTensor.file), Float32Array);
  const promptFeatures = await fetchArray(resolveManifestFile(promptTensor.file), Float32Array);
  const promptMask = await fetchArray(resolveManifestFile(promptMaskTensor.file), Float32Array);
  const expectedLastHs = await fetchArray(resolveManifestFile(expectedLastHsTensor.file), Float32Array);
  const expectedReferenceBoxes = await fetchArray(resolveManifestFile(expectedReferenceBoxesTensor.file), Float32Array);
  const expectedPresenceLogits = await fetchArray(resolveManifestFile(expectedPresenceLogitsTensor.file), Float32Array);
  const pixelEmbed = await fetchArray(resolveManifestFile(pixelEmbedTensor.file), Float32Array);
  const expectedMaskEmbeddings = await fetchArray(resolveManifestFile(expectedMaskEmbeddingsTensor.file), Float32Array);
  const expectedUpscaledEmbedding = await fetchArray(resolveManifestFile(expectedUpscaledTensor.file), Float32Array);
  const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
  const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);
  const decoderWeights = {
    layers: await loadDetrDecoderLayers(manifest, weightsByRole),
    queryEmbed: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-query-embed-weight'].file), Float32Array),
    referencePoints: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-reference-points-weight'].file), Float32Array),
    presenceToken: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-token-weight'].file), Float32Array),
    outputLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-output-layernorm-weight'].file), Float32Array),
    outputLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-output-layernorm-bias'].file), Float32Array),
    refPointHeadLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-1-weight'].file), Float32Array),
    refPointHeadLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-1-bias'].file), Float32Array),
    refPointHeadLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-2-weight'].file), Float32Array),
    refPointHeadLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-2-bias'].file), Float32Array),
    boxHeadLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-1-weight'].file), Float32Array),
    boxHeadLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-1-bias'].file), Float32Array),
    boxHeadLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-2-weight'].file), Float32Array),
    boxHeadLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-2-bias'].file), Float32Array),
    boxHeadLayer3Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-3-weight'].file), Float32Array),
    boxHeadLayer3Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-3-bias'].file), Float32Array),
    boxRpbXLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-1-weight'].file), Float32Array),
    boxRpbXLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-1-bias'].file), Float32Array),
    boxRpbXLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-2-weight'].file), Float32Array),
    boxRpbXLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-2-bias'].file), Float32Array),
    boxRpbYLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-1-weight'].file), Float32Array),
    boxRpbYLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-1-bias'].file), Float32Array),
    boxRpbYLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-2-weight'].file), Float32Array),
    boxRpbYLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-2-bias'].file), Float32Array),
    presenceLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-layernorm-weight'].file), Float32Array),
    presenceLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-layernorm-bias'].file), Float32Array),
    presenceHeadLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-1-weight'].file), Float32Array),
    presenceHeadLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-1-bias'].file), Float32Array),
    presenceHeadLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-2-weight'].file), Float32Array),
    presenceHeadLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-2-bias'].file), Float32Array),
    presenceHeadLayer3Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-3-weight'].file), Float32Array),
    presenceHeadLayer3Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-3-bias'].file), Float32Array),
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
  const decoderShape = {
    batch: manifest.shape.batch,
    queryTokens: manifest.shape.queryTokens,
    promptTokens: manifest.shape.promptTokens,
    spatialTokens: manifest.shape.spatialTokens,
    channels: manifest.shape.channels,
    heads: manifest.shape.heads,
    layerCount: manifest.shape.layerCount,
    mlpHidden: manifest.shape.mlpHidden,
    sineFeatures: manifest.shape.sineFeatures,
    height: manifest.shape.height,
    width: manifest.shape.width,
  };
  const maskTailShape = {
    batch: manifest.shape.batch,
    maskTokens: manifest.shape.maskTokens,
    channels: manifest.shape.channels,
    height: manifest.shape.maskHeight,
    width: manifest.shape.maskWidth,
  };
  const maskOracle = createSam3MaskTailPhaseProgramCpuOracle({ lastHs: expectedLastHs, pixelEmbed, weights: tailWeights, shape: maskTailShape });
  return {
    routeKind: 'detr-decoder-mask-tail-composition',
    expectedLastHs,
    expectedReferenceBoxes,
    expectedPresenceLogits,
    expectedMaskEmbeddings,
    expectedUpscaledEmbedding,
    expectedLogits,
    expectedBinary,
    maskShape: maskTailShape,
    cpuSelfCheck: {
      maskEmbeddingsMaxAbsDiff: maxAbsDiff(expectedMaskEmbeddings, maskOracle.maskEmbeddings),
      upscaledEmbeddingMaxAbsDiff: maxAbsDiff(expectedUpscaledEmbedding, maskOracle.upscaledEmbedding),
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, maskOracle.maskLogits),
      binaryMismatchCount: mismatchCount(expectedBinary, maskOracle.binaryMask),
    },
    tensorIdentity: {
      encoderHiddenStatesSha256: encoderTensor.sha256,
      encoderPosSha256: encoderPosTensor.sha256,
      promptFeaturesSha256: promptTensor.sha256,
      promptMaskSha256: promptMaskTensor.sha256,
      expectedLastHsSha256: expectedLastHsTensor.sha256,
      expectedReferenceBoxesSha256: expectedReferenceBoxesTensor.sha256,
      expectedPresenceLogitsSha256: expectedPresenceLogitsTensor.sha256,
      pixelEmbedSha256: pixelEmbedTensor.sha256,
      expectedMaskEmbeddingsSha256: expectedMaskEmbeddingsTensor.sha256,
      expectedUpscaledEmbeddingSha256: expectedUpscaledTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
      weightsSha256: Object.fromEntries(Object.entries(weightsByRole).map(([role, weight]) => [role, weight.sha256])),
    },
    async run({ device, adapter, route, request }) {
      const decoderResult = await runSam3DetrDecoderPhaseProgramRoute({
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
          visionFeatures,
          visionPosEncoding,
          promptFeatures,
          promptMask,
          shape: decoderShape,
          ...decoderWeights,
        },
        includeReadback: true,
      });
      const gpuLastHs = new Float32Array(decoderResult.debugReadback.lastHs);
      const gpuReferenceBoxes = new Float32Array(decoderResult.debugReadback.referenceBoxes);
      const gpuPresenceLogits = new Float32Array(decoderResult.debugReadback.presenceLogits);
      const lastHsOutput = decoderResult.receipt.outputs.find(output => output.role === 'last-hs');
      const referenceBoxesOutput = decoderResult.receipt.outputs.find(output => output.role === 'reference-boxes');
      const presenceLogitsOutput = decoderResult.receipt.outputs.find(output => output.role === 'presence-logits');
      if (!lastHsOutput?.sha256 || !lastHsOutput?.artifactId) throw new Error('DETR decoder last-hs output identity missing');
      if (!referenceBoxesOutput?.sha256 || !referenceBoxesOutput?.artifactId) throw new Error('DETR decoder reference-boxes output identity missing');
      if (!presenceLogitsOutput?.sha256 || !presenceLogitsOutput?.artifactId) throw new Error('DETR decoder presence-logits output identity missing');
      const downstreamTensorSha256 = await aggregateTensorBundleSha256('sam3-mask-tail-composed-tensors', [
        { role: 'last-hs', artifactId: lastHsOutput.artifactId, sha256: lastHsOutput.sha256, shape: lastHsOutput.shape },
        { role: 'pixel-embed', sha256: pixelEmbedTensor.sha256 },
      ]);
      const maskRoute = createSam3MaskTailPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-mask-tail', dtype: 'fp32' }, kernel: { profile: 'sam3-mask-tail-phase-program-v0', commit: params.get('commit') || null } });
      const maskRequest = createRouteInvocationRequest(maskRoute, {
        requestId: `sam-browser-detr-decoder-tail-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-mask-tail-tensors': { artifactId: 'sam3-mask-tail-tensors:browser-detr-decoder-composition', sha256: downstreamTensorSha256 },
          'sam3-mask-tail-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: {
          'mask-logits': { artifactId: 'sam3-mask-logits:browser-detr-decoder-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.maskHeight, manifest.shape.maskWidth] },
          'mask-binary': { artifactId: 'sam3-mask-binary:browser-detr-decoder-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.maskHeight, manifest.shape.maskWidth] },
        },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-decoder', promptHash: manifest.prompt?.sha256, composedFrom: decoderResult.receipt?.effectiveRouteId, lastHsOutput },
      });
      const tailResult = await runSam3MaskTailPhaseProgramRoute({ request: maskRequest, route: maskRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: maskRoute.kernel, model: { revision: maskRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { lastHs: gpuLastHs, pixelEmbed, weights: tailWeights, shape: maskTailShape }, includeReadback: true });
      return {
        ...tailResult,
        receipt: decoderResult.receipt,
        routeReceipt: decoderResult.receipt,
        downstreamRouteReceipt: tailResult.receipt,
        compositionRouteReceipts: [decoderResult.receipt, tailResult.receipt],
        backend: tailResult.backend,
        debugReadback: {
          lastHs: Array.from(gpuLastHs),
          referenceBoxes: Array.from(gpuReferenceBoxes),
          presenceLogits: Array.from(gpuPresenceLogits),
          intermediate: decoderResult.debugReadback.intermediate || null,
          maskLogits: tailResult.debugReadback.maskLogits,
          binaryMask: tailResult.debugReadback.binaryMask,
        },
        compositionEdge: {
          upstreamRouteId: decoderResult.receipt.effectiveRouteId,
          downstreamRouteId: tailResult.receipt.effectiveRouteId,
          lastHsOutput,
          referenceBoxesOutput,
          presenceLogitsOutput,
          downstreamTensorSha256,
        },
      };
    },
  };
}

async function loadDetrStackPayload(manifest) {
  const includeImagePreprocess = manifest.mode === 'mlx-detector-stack-preprocess-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-detector-stack-phase-program';
  const includeDetectorStack = includeImagePreprocess || manifest.mode === 'mlx-detector-stack-export' || manifest.boundary === 'sam3-detector-stack-browser-local-detector-mask-phase-program';
  const includeStackSelection = includeDetectorStack || manifest.mode === 'mlx-detr-stack-selection-export' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-selection-mask-tail-phase-program';
  const includeStackScoring = includeStackSelection || manifest.mode === 'mlx-detr-stack-scoring-export' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-mask-tail-phase-program';
  const expectedPixelValuesTensor = includeImagePreprocess ? tensorByRole(manifest, 'expected-pixel-values') : null;
  const encoderSrcTensor = tensorByRole(manifest, 'encoder-src');
  const encoderPosTensor = tensorByRole(manifest, 'encoder-pos');
  const promptTensor = tensorByRole(manifest, 'prompt-features');
  const promptMaskTensor = tensorByRole(manifest, 'prompt-mask');
  const expectedEncoderTensor = tensorByRole(manifest, 'expected-encoder-hidden-states');
  const expectedDecoderHiddenStatesTensor = tensorByRole(manifest, 'expected-decoder-hidden-states');
  const expectedLastHsTensor = tensorByRole(manifest, 'expected-last-hs');
  const expectedReferenceBoxesTensor = tensorByRole(manifest, 'expected-reference-boxes');
  const expectedPresenceLogitsTensor = tensorByRole(manifest, 'expected-presence-logits');
  const expectedPredLogitsTensor = includeStackScoring ? tensorByRole(manifest, 'expected-pred-logits') : null;
  const expectedSelectionScoresTensor = includeStackSelection ? tensorByRole(manifest, 'expected-selection-scores') : null;
  const expectedSelectionBoxesTensor = includeStackSelection ? tensorByRole(manifest, 'expected-selection-boxes') : null;
  const expectedSelectionKeepTensor = includeStackSelection ? tensorByRole(manifest, 'expected-selection-keep') : null;
  const expectedSelectedIndexTensor = includeStackSelection ? tensorByRole(manifest, 'expected-selected-index') : null;
  const expectedSelectedScoreTensor = includeStackSelection ? tensorByRole(manifest, 'expected-selected-score') : null;
  const expectedSelectedBoxTensor = includeStackSelection ? tensorByRole(manifest, 'expected-selected-box') : null;
  const pixelEmbedTensor = tensorByRole(manifest, 'pixel-embed');
  const expectedMaskEmbeddingsTensor = tensorByRole(manifest, 'expected-mask-embeddings');
  const expectedUpscaledTensor = tensorByRole(manifest, 'expected-upscaled-embedding');
  const expectedLogitsTensor = tensorByRole(manifest, 'expected-mask-logits');
  const expectedBinaryTensor = tensorByRole(manifest, 'expected-binary-mask');
  const encoderRoles = loadDetrLayerWeightRoles(manifest.shape.layerCount);
  const decoderLayerRoles = loadDetrDecoderLayerWeightRoles(manifest.shape.layerCount);
  const decoderSharedRoles = [
    'detr-decoder-query-embed-weight',
    'detr-decoder-reference-points-weight',
    'detr-decoder-presence-token-weight',
    'detr-decoder-output-layernorm-weight',
    'detr-decoder-output-layernorm-bias',
    'detr-decoder-ref-point-head-layer-1-weight',
    'detr-decoder-ref-point-head-layer-1-bias',
    'detr-decoder-ref-point-head-layer-2-weight',
    'detr-decoder-ref-point-head-layer-2-bias',
    'detr-decoder-box-head-layer-1-weight',
    'detr-decoder-box-head-layer-1-bias',
    'detr-decoder-box-head-layer-2-weight',
    'detr-decoder-box-head-layer-2-bias',
    'detr-decoder-box-head-layer-3-weight',
    'detr-decoder-box-head-layer-3-bias',
    'detr-decoder-box-rpb-x-layer-1-weight',
    'detr-decoder-box-rpb-x-layer-1-bias',
    'detr-decoder-box-rpb-x-layer-2-weight',
    'detr-decoder-box-rpb-x-layer-2-bias',
    'detr-decoder-box-rpb-y-layer-1-weight',
    'detr-decoder-box-rpb-y-layer-1-bias',
    'detr-decoder-box-rpb-y-layer-2-weight',
    'detr-decoder-box-rpb-y-layer-2-bias',
    'detr-decoder-presence-layernorm-weight',
    'detr-decoder-presence-layernorm-bias',
    'detr-decoder-presence-head-layer-1-weight',
    'detr-decoder-presence-head-layer-1-bias',
    'detr-decoder-presence-head-layer-2-weight',
    'detr-decoder-presence-head-layer-2-bias',
    'detr-decoder-presence-head-layer-3-weight',
    'detr-decoder-presence-head-layer-3-bias',
  ];
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
  const scoringWeightRoles = [
    'scoring-text-mlp-layer-1-weight',
    'scoring-text-mlp-layer-1-bias',
    'scoring-text-mlp-layer-2-weight',
    'scoring-text-mlp-layer-2-bias',
    'scoring-text-mlp-out-norm-weight',
    'scoring-text-mlp-out-norm-bias',
    'scoring-text-proj-weight',
    'scoring-text-proj-bias',
    'scoring-query-proj-weight',
    'scoring-query-proj-bias',
  ];
  const weightsByRole = Object.fromEntries([...encoderRoles, ...decoderLayerRoles, ...decoderSharedRoles, ...(includeStackScoring ? scoringWeightRoles : []), ...tailWeightRoles].map(role => [role, weightByRole(manifest, role)]));
  const encoderSrc = await fetchArray(resolveManifestFile(encoderSrcTensor.file), Float32Array);
  const encoderPos = await fetchArray(resolveManifestFile(encoderPosTensor.file), Float32Array);
  const promptFeatures = await fetchArray(resolveManifestFile(promptTensor.file), Float32Array);
  const promptMask = await fetchArray(resolveManifestFile(promptMaskTensor.file), Float32Array);
  const expectedEncoderHiddenStates = await fetchArray(resolveManifestFile(expectedEncoderTensor.file), Float32Array);
  const expectedDecoderHiddenStates = await fetchArray(resolveManifestFile(expectedDecoderHiddenStatesTensor.file), Float32Array);
  const expectedLastHs = await fetchArray(resolveManifestFile(expectedLastHsTensor.file), Float32Array);
  const expectedReferenceBoxes = await fetchArray(resolveManifestFile(expectedReferenceBoxesTensor.file), Float32Array);
  const expectedPresenceLogits = await fetchArray(resolveManifestFile(expectedPresenceLogitsTensor.file), Float32Array);
  const expectedPredLogits = expectedPredLogitsTensor ? await fetchArray(resolveManifestFile(expectedPredLogitsTensor.file), Float32Array) : null;
  const expectedSelectionScores = expectedSelectionScoresTensor ? await fetchArray(resolveManifestFile(expectedSelectionScoresTensor.file), Float32Array) : null;
  const expectedSelectionBoxes = expectedSelectionBoxesTensor ? await fetchArray(resolveManifestFile(expectedSelectionBoxesTensor.file), Float32Array) : null;
  const expectedSelectionKeep = expectedSelectionKeepTensor ? await fetchArray(resolveManifestFile(expectedSelectionKeepTensor.file), Uint32Array) : null;
  const expectedSelectedIndex = expectedSelectedIndexTensor ? await fetchArray(resolveManifestFile(expectedSelectedIndexTensor.file), Uint32Array) : null;
  const expectedSelectedScore = expectedSelectedScoreTensor ? await fetchArray(resolveManifestFile(expectedSelectedScoreTensor.file), Float32Array) : null;
  const expectedSelectedBox = expectedSelectedBoxTensor ? await fetchArray(resolveManifestFile(expectedSelectedBoxTensor.file), Float32Array) : null;
  const expectedPixelValues = expectedPixelValuesTensor ? await fetchArray(resolveManifestFile(expectedPixelValuesTensor.file), Float32Array) : null;
  const pixelEmbed = await fetchArray(resolveManifestFile(pixelEmbedTensor.file), Float32Array);
  const expectedMaskEmbeddings = await fetchArray(resolveManifestFile(expectedMaskEmbeddingsTensor.file), Float32Array);
  const expectedUpscaledEmbedding = await fetchArray(resolveManifestFile(expectedUpscaledTensor.file), Float32Array);
  const expectedLogits = await fetchArray(resolveManifestFile(expectedLogitsTensor.file), Float32Array);
  const expectedBinary = await fetchArray(resolveManifestFile(expectedBinaryTensor.file), Uint32Array);
  const encoderWeights = { layers: await loadDetrEncoderLayers(manifest, weightsByRole) };
  const decoderWeights = {
    layers: await loadDetrDecoderLayers(manifest, weightsByRole),
    queryEmbed: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-query-embed-weight'].file), Float32Array),
    referencePoints: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-reference-points-weight'].file), Float32Array),
    presenceToken: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-token-weight'].file), Float32Array),
    outputLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-output-layernorm-weight'].file), Float32Array),
    outputLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-output-layernorm-bias'].file), Float32Array),
    refPointHeadLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-1-weight'].file), Float32Array),
    refPointHeadLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-1-bias'].file), Float32Array),
    refPointHeadLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-2-weight'].file), Float32Array),
    refPointHeadLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-ref-point-head-layer-2-bias'].file), Float32Array),
    boxHeadLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-1-weight'].file), Float32Array),
    boxHeadLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-1-bias'].file), Float32Array),
    boxHeadLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-2-weight'].file), Float32Array),
    boxHeadLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-2-bias'].file), Float32Array),
    boxHeadLayer3Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-3-weight'].file), Float32Array),
    boxHeadLayer3Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-head-layer-3-bias'].file), Float32Array),
    boxRpbXLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-1-weight'].file), Float32Array),
    boxRpbXLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-1-bias'].file), Float32Array),
    boxRpbXLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-2-weight'].file), Float32Array),
    boxRpbXLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-x-layer-2-bias'].file), Float32Array),
    boxRpbYLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-1-weight'].file), Float32Array),
    boxRpbYLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-1-bias'].file), Float32Array),
    boxRpbYLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-2-weight'].file), Float32Array),
    boxRpbYLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-box-rpb-y-layer-2-bias'].file), Float32Array),
    presenceLayerNormWeight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-layernorm-weight'].file), Float32Array),
    presenceLayerNormBias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-layernorm-bias'].file), Float32Array),
    presenceHeadLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-1-weight'].file), Float32Array),
    presenceHeadLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-1-bias'].file), Float32Array),
    presenceHeadLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-2-weight'].file), Float32Array),
    presenceHeadLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-2-bias'].file), Float32Array),
    presenceHeadLayer3Weight: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-3-weight'].file), Float32Array),
    presenceHeadLayer3Bias: await fetchArray(resolveManifestFile(weightsByRole['detr-decoder-presence-head-layer-3-bias'].file), Float32Array),
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
  const scoringWeights = includeStackScoring ? {
    textMlpLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-1-weight'].file), Float32Array),
    textMlpLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-1-bias'].file), Float32Array),
    textMlpLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-2-weight'].file), Float32Array),
    textMlpLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-2-bias'].file), Float32Array),
    textMlpOutNormWeight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-out-norm-weight'].file), Float32Array),
    textMlpOutNormBias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-out-norm-bias'].file), Float32Array),
    textProjWeight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-proj-weight'].file), Float32Array),
    textProjBias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-proj-bias'].file), Float32Array),
    queryProjWeight: await fetchArray(resolveManifestFile(weightsByRole['scoring-query-proj-weight'].file), Float32Array),
    queryProjBias: await fetchArray(resolveManifestFile(weightsByRole['scoring-query-proj-bias'].file), Float32Array),
  } : null;
  const encoderShape = { batch: manifest.shape.batch, spatialTokens: manifest.shape.spatialTokens, promptTokens: manifest.shape.promptTokens, channels: manifest.shape.channels, heads: manifest.shape.heads, layerCount: manifest.shape.layerCount, mlpHidden: manifest.shape.mlpHidden, height: manifest.shape.height, width: manifest.shape.width };
  const decoderShape = { batch: manifest.shape.batch, queryTokens: manifest.shape.queryTokens, promptTokens: manifest.shape.promptTokens, spatialTokens: manifest.shape.spatialTokens, channels: manifest.shape.channels, heads: manifest.shape.heads, layerCount: manifest.shape.layerCount, mlpHidden: manifest.shape.mlpHidden, sineFeatures: manifest.shape.sineFeatures, height: manifest.shape.height, width: manifest.shape.width };
  const maskTailShape = { batch: manifest.shape.batch, maskTokens: manifest.shape.maskTokens, channels: manifest.shape.channels, height: manifest.shape.maskHeight, width: manifest.shape.maskWidth };
  const scoringShape = { layerCount: manifest.shape.layerCount, batch: manifest.shape.batch, queryTokens: manifest.shape.queryTokens, promptTokens: manifest.shape.promptTokens, channels: manifest.shape.channels, mlpHidden: manifest.shape.mlpHidden };
  const selectionShape = { layerCount: manifest.shape.layerCount, batch: manifest.shape.batch, queryTokens: manifest.shape.queryTokens, imageHeight: manifest.sourceImage?.resolution?.[1] || manifest.shape.maskHeight, imageWidth: manifest.sourceImage?.resolution?.[0] || manifest.shape.maskWidth, scoreThreshold: manifest.postprocess?.scoreThreshold ?? 0.5 };
  const maskOracle = createSam3MaskTailPhaseProgramCpuOracle({ lastHs: expectedLastHs, pixelEmbed, weights: tailWeights, shape: maskTailShape });
  const scoringOracle = includeStackScoring ? createSam3ScoringPhaseProgramCpuOracle({ hiddenStates: expectedDecoderHiddenStates, promptFeatures, promptMask, weights: scoringWeights, shape: scoringShape }) : null;
  const selectionOracle = includeStackSelection ? createSam3SelectionPostprocessPhaseProgramCpuOracle({ predLogits: expectedPredLogits, referenceBoxes: expectedReferenceBoxes, presenceLogits: expectedPresenceLogits, shape: selectionShape }) : null;
  return {
    routeKind: includeImagePreprocess ? 'image-preprocess-detector-stack-composition' : includeDetectorStack ? 'detector-stack-browser-local-composition' : includeStackSelection ? 'detr-encoder-detr-decoder-scoring-selection-mask-tail-composition' : includeStackScoring ? 'detr-encoder-detr-decoder-scoring-mask-tail-composition' : 'detr-encoder-detr-decoder-mask-tail-composition',
    detectorStackEvidence: includeDetectorStack ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.boundary,
      routeKind: includeImagePreprocess ? 'image-preprocess-detector-stack-composition' : 'detector-stack-browser-local-composition',
      upstreamBoundaries: manifest.upstreamBoundaries || [],
      nonClaims: {
        fullSam3BrowserExecution: true,
        browserLocalVisionEncoder: true,
        browserLocalTextEncoder: true,
        originalImageResize: true,
        nms: manifest.postprocess?.nms === false,
      },
    } : null,
    imagePreprocessEvidence: includeImagePreprocess ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.imagePreprocess?.boundary || manifest.boundary,
      routeKind: 'image-preprocess-detector-stack-composition',
      source: manifest.imagePreprocess?.source || 'browser-served-source-image',
      normalization: manifest.imagePreprocess?.normalization || null,
      nonClaims: {
        originalImageResize: true,
        browserLocalVisionEncoder: true,
        browserLocalTextEncoder: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    expectedPixelValues,
    expectedEncoderHiddenStates,
    expectedDecoderHiddenStates,
    expectedLastHs,
    expectedReferenceBoxes,
    expectedPresenceLogits,
    expectedPredLogits,
    expectedSelectionScores,
    expectedSelectionBoxes,
    expectedSelectionKeep,
    expectedSelectedIndex,
    expectedSelectedScore,
    expectedSelectedBox,
    expectedMaskEmbeddings,
    expectedUpscaledEmbedding,
    expectedLogits,
    expectedBinary,
    maskShape: maskTailShape,
    cpuSelfCheck: {
      maskEmbeddingsMaxAbsDiff: maxAbsDiff(expectedMaskEmbeddings, maskOracle.maskEmbeddings),
      upscaledEmbeddingMaxAbsDiff: maxAbsDiff(expectedUpscaledEmbedding, maskOracle.upscaledEmbedding),
      logitsMaxAbsDiff: maxAbsDiff(expectedLogits, maskOracle.maskLogits),
      predLogitsMaxAbsDiff: scoringOracle ? maxAbsDiff(expectedPredLogits, scoringOracle.predLogits) : undefined,
      selectionScoresMaxAbsDiff: selectionOracle ? maxAbsDiff(expectedSelectionScores, selectionOracle.scores) : undefined,
      selectionBoxesMaxAbsDiff: selectionOracle ? maxAbsDiff(expectedSelectionBoxes, selectionOracle.boxes) : undefined,
      selectionKeepMismatchCount: selectionOracle ? mismatchCount(expectedSelectionKeep, selectionOracle.keep) : undefined,
      selectedIndexMaxAbsDiff: selectionOracle ? maxAbsDiff(expectedSelectedIndex, selectionOracle.selectedIndex) : undefined,
      selectedScoreMaxAbsDiff: selectionOracle ? maxAbsDiff(expectedSelectedScore, selectionOracle.selectedScore) : undefined,
      selectedBoxMaxAbsDiff: selectionOracle ? maxAbsDiff(expectedSelectedBox, selectionOracle.selectedBox) : undefined,
      binaryMismatchCount: mismatchCount(expectedBinary, maskOracle.binaryMask),
    },
    tensorIdentity: {
      encoderSrcSha256: encoderSrcTensor.sha256,
      encoderPosSha256: encoderPosTensor.sha256,
      promptFeaturesSha256: promptTensor.sha256,
      promptMaskSha256: promptMaskTensor.sha256,
      expectedEncoderHiddenStatesSha256: expectedEncoderTensor.sha256,
      expectedDecoderHiddenStatesSha256: expectedDecoderHiddenStatesTensor.sha256,
      expectedLastHsSha256: expectedLastHsTensor.sha256,
      expectedReferenceBoxesSha256: expectedReferenceBoxesTensor.sha256,
      expectedPresenceLogitsSha256: expectedPresenceLogitsTensor.sha256,
      expectedPredLogitsSha256: expectedPredLogitsTensor?.sha256,
      expectedSelectionScoresSha256: expectedSelectionScoresTensor?.sha256,
      expectedSelectionBoxesSha256: expectedSelectionBoxesTensor?.sha256,
      expectedSelectionKeepSha256: expectedSelectionKeepTensor?.sha256,
      expectedSelectedIndexSha256: expectedSelectedIndexTensor?.sha256,
      expectedSelectedScoreSha256: expectedSelectedScoreTensor?.sha256,
      expectedSelectedBoxSha256: expectedSelectedBoxTensor?.sha256,
      expectedPixelValuesSha256: expectedPixelValuesTensor?.sha256,
      pixelEmbedSha256: pixelEmbedTensor.sha256,
      expectedMaskEmbeddingsSha256: expectedMaskEmbeddingsTensor.sha256,
      expectedUpscaledEmbeddingSha256: expectedUpscaledTensor.sha256,
      expectedMaskLogitsSha256: expectedLogitsTensor.sha256,
      expectedBinaryMaskSha256: expectedBinaryTensor.sha256,
      weightsSha256: Object.fromEntries(Object.entries(weightsByRole).map(([role, weight]) => [role, weight.sha256])),
    },
    async run({ device, adapter, route, request, sourceImage }) {
      let imagePreprocessResult = null;
      let gpuPixelValues = null;
      let pixelValuesOutput = null;
      let pixelValuesTensorSha256 = null;
      let imagePreprocessCpuMaxAbsDiff = undefined;
      if (includeImagePreprocess) {
        const preprocessShape = imagePreprocessShape(manifest);
        const rgba = rgbaFromSourceImage(sourceImage, preprocessShape);
        const cpuOracle = createSam3ImagePreprocessPhaseProgramCpuOracle({ rgba, shape: preprocessShape });
        imagePreprocessCpuMaxAbsDiff = maxAbsDiff(expectedPixelValues, cpuOracle.pixelValues);
        pixelValuesTensorSha256 = await aggregateTensorBundleSha256('sam3-image-preprocess-composed-tensors', [
          { role: 'source-image', artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          { role: 'expected-pixel-values', sha256: expectedPixelValuesTensor.sha256, shape: expectedPixelValuesTensor.shape },
        ]);
        const imagePreprocessRoute = createSam3ImagePreprocessPhaseProgramRouteDefinition({
          model: { revision: manifest.model?.id || 'mlx-reference-image-preprocess', dtype: 'u8-to-fp32' },
          kernel: { profile: 'sam3-image-preprocess-phase-program-v0', commit: params.get('commit') || null },
        });
        const imagePreprocessRequest = createRouteInvocationRequest(imagePreprocessRoute, {
          requestId: `sam-browser-image-preprocess-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'sam3-image-preprocess-tensors': { artifactId: 'sam3-image-preprocess-tensors:browser-detector-stack-composition', sha256: pixelValuesTensorSha256 },
          },
          outputs: {
            'pixel-values': { artifactId: 'sam3-pixel-values:browser-detector-stack-composition', shape: [preprocessShape.batch, preprocessShape.height, preprocessShape.width, preprocessShape.channels] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', imagePreprocess: manifest.imagePreprocess || null },
        });
        imagePreprocessResult = await runSam3ImagePreprocessPhaseProgramRoute({ request: imagePreprocessRequest, route: imagePreprocessRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: imagePreprocessRoute.kernel, model: { revision: imagePreprocessRoute.model.revision, weightsHash: 'none', dtype: 'u8-to-fp32' }, tensors: { rgba, shape: preprocessShape }, includeReadback: true });
        gpuPixelValues = new Float32Array(imagePreprocessResult.debugReadback.pixelValues);
        pixelValuesOutput = imagePreprocessResult.receipt.outputs.find(output => output.role === 'pixel-values');
        if (!pixelValuesOutput?.sha256 || !pixelValuesOutput?.artifactId) throw new Error('SAM3 image-preprocess pixel-values output identity missing');
      }
      const encoderResult = await runSam3DetrEncoderPhaseProgramRoute({ request, route, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: route.kernel, model: { revision: route.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { encoderSrc, encoderPos, promptFeatures, promptMask, layers: encoderWeights.layers, shape: encoderShape }, includeReadback: true });
      const gpuEncoderHiddenStates = new Float32Array(encoderResult.debugReadback.encoderHiddenStates);
      const detrEncoderOutput = encoderResult.receipt.outputs.find(output => output.role === 'encoder-hidden-states');
      if (!detrEncoderOutput?.sha256 || !detrEncoderOutput?.artifactId) throw new Error('DETR encoder output identity missing for decoder composition');
      const decoderTensorSha256 = await aggregateTensorBundleSha256('sam3-detr-decoder-composed-tensors', [
        { role: 'encoder-hidden-states', artifactId: detrEncoderOutput.artifactId, sha256: detrEncoderOutput.sha256, shape: detrEncoderOutput.shape },
        { role: 'encoder-pos', sha256: encoderPosTensor.sha256 },
        { role: 'prompt-features', sha256: promptTensor.sha256 },
        { role: 'prompt-mask', sha256: promptMaskTensor.sha256 },
      ]);
      const decoderRoute = createSam3DetrDecoderPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-detr-decoder', dtype: 'fp32' }, kernel: { profile: 'sam3-detr-decoder-phase-program-v0', commit: params.get('commit') || null }, shape: manifest.shape });
      const decoderRequest = createRouteInvocationRequest(decoderRoute, {
        requestId: `sam-browser-detr-stack-decoder-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-detr-decoder-tensors': { artifactId: 'sam3-detr-decoder-tensors:browser-detr-stack-composition', sha256: decoderTensorSha256 },
          'sam3-detr-decoder-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: {
          'last-hs': { artifactId: 'sam3-last-hs:browser-detr-stack-composition', shape: [manifest.shape.batch, manifest.shape.queryTokens, manifest.shape.channels] },
          'reference-boxes': { artifactId: 'sam3-reference-boxes:browser-detr-stack-composition', shape: [manifest.shape.batch, manifest.shape.queryTokens, 4] },
          ...(includeStackScoring ? { 'decoder-hidden-states': { artifactId: 'sam3-decoder-hidden-states:browser-detr-stack-composition', shape: [manifest.shape.layerCount, manifest.shape.batch, manifest.shape.queryTokens, manifest.shape.channels] } } : {}),
          'presence-logits': { artifactId: 'sam3-presence-logits:browser-detr-stack-composition', shape: [manifest.shape.layerCount, manifest.shape.batch, 1] },
        },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: encoderResult.receipt?.effectiveRouteId, detrEncoderOutput },
      });
      const decoderResult = await runSam3DetrDecoderPhaseProgramRoute({ request: decoderRequest, route: decoderRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: decoderRoute.kernel, model: { revision: decoderRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { visionFeatures: gpuEncoderHiddenStates, visionPosEncoding: encoderPos, promptFeatures, promptMask, shape: decoderShape, ...decoderWeights }, includeReadback: true, includeAllHiddenStatesReadback: includeStackScoring });
      const gpuLastHs = new Float32Array(decoderResult.debugReadback.lastHs);
      const gpuDecoderHiddenStates = includeStackScoring ? new Float32Array(decoderResult.debugReadback.decoderHiddenStates) : null;
      const gpuReferenceBoxes = new Float32Array(decoderResult.debugReadback.referenceBoxes);
      const gpuPresenceLogits = new Float32Array(decoderResult.debugReadback.presenceLogits);
      const lastHsOutput = decoderResult.receipt.outputs.find(output => output.role === 'last-hs');
      const decoderHiddenStatesOutput = includeStackScoring ? decoderResult.receipt.outputs.find(output => output.role === 'decoder-hidden-states') : null;
      const referenceBoxesOutput = decoderResult.receipt.outputs.find(output => output.role === 'reference-boxes');
      const presenceLogitsOutput = decoderResult.receipt.outputs.find(output => output.role === 'presence-logits');
      if (!lastHsOutput?.sha256 || !lastHsOutput?.artifactId) throw new Error('DETR stack decoder last-hs output identity missing');
      if (includeStackScoring && (!decoderHiddenStatesOutput?.sha256 || !decoderHiddenStatesOutput?.artifactId)) throw new Error('DETR stack decoder hidden-states output identity missing for scoring composition');
      if (!referenceBoxesOutput?.sha256 || !referenceBoxesOutput?.artifactId) throw new Error('DETR stack decoder reference-boxes output identity missing');
      if (!presenceLogitsOutput?.sha256 || !presenceLogitsOutput?.artifactId) throw new Error('DETR stack decoder presence-logits output identity missing');
      let scoringResult = null;
      let scoringOutput = null;
      let scoringTensorSha256 = null;
      let gpuPredLogits = null;
      let selectionResult = null;
      let selectionOutput = null;
      let selectionTensorSha256 = null;
      let gpuSelectionScores = null;
      let gpuSelectionBoxes = null;
      let gpuSelectionKeep = null;
      let gpuSelectedIndex = null;
      let gpuSelectedScore = null;
      let gpuSelectedBox = null;
      if (includeStackScoring) {
        scoringTensorSha256 = await aggregateTensorBundleSha256('sam3-scoring-composed-tensors', [
          { role: 'hidden-states', artifactId: decoderHiddenStatesOutput.artifactId, sha256: decoderHiddenStatesOutput.sha256, shape: decoderHiddenStatesOutput.shape },
          { role: 'prompt-features', sha256: promptTensor.sha256 },
          { role: 'prompt-mask', sha256: promptMaskTensor.sha256 },
        ]);
        const scoringRoute = createSam3ScoringPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-scoring', dtype: 'fp32' }, kernel: { profile: 'sam3-scoring-phase-program-v0', commit: params.get('commit') || null } });
        const scoringRequest = createRouteInvocationRequest(scoringRoute, {
          requestId: `sam-browser-detr-stack-scoring-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'sam3-scoring-tensors': { artifactId: 'sam3-scoring-tensors:browser-detr-stack-composition', sha256: scoringTensorSha256 },
            'sam3-scoring-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
          },
          outputs: {
            'pred-logits': { artifactId: 'sam3-pred-logits:browser-detr-stack-composition', shape: [manifest.shape.layerCount, manifest.shape.batch, manifest.shape.queryTokens, 1] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: decoderResult.receipt?.effectiveRouteId, decoderHiddenStatesOutput },
        });
        scoringResult = await runSam3ScoringPhaseProgramRoute({ request: scoringRequest, route: scoringRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: scoringRoute.kernel, model: { revision: scoringRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { hiddenStates: gpuDecoderHiddenStates, promptFeatures, promptMask, weights: scoringWeights, shape: scoringShape }, includeReadback: true });
        gpuPredLogits = new Float32Array(scoringResult.debugReadback.predLogits);
        scoringOutput = scoringResult.receipt.outputs.find(output => output.role === 'pred-logits');
        if (!scoringOutput?.sha256 || !scoringOutput?.artifactId) throw new Error('DETR stack scoring pred-logits output identity missing');
      }
      if (includeStackSelection) {
        selectionTensorSha256 = await aggregateTensorBundleSha256('sam3-selection-composed-tensors', [
          { role: 'pred-logits', artifactId: scoringOutput.artifactId, sha256: scoringOutput.sha256, shape: scoringOutput.shape },
          { role: 'reference-boxes', artifactId: referenceBoxesOutput.artifactId, sha256: referenceBoxesOutput.sha256, shape: referenceBoxesOutput.shape },
          { role: 'presence-logits', artifactId: presenceLogitsOutput.artifactId, sha256: presenceLogitsOutput.sha256, shape: presenceLogitsOutput.shape },
        ]);
        const selectionRoute = createSam3SelectionPostprocessPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-selection', dtype: 'fp32' }, kernel: { profile: 'sam3-selection-postprocess-phase-program-v0', commit: params.get('commit') || null } });
        const selectionRequest = createRouteInvocationRequest(selectionRoute, {
          requestId: `sam-browser-detr-stack-selection-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'sam3-selection-tensors': { artifactId: 'sam3-selection-tensors:browser-detr-stack-composition', sha256: selectionTensorSha256 },
          },
          outputs: {
            'selection-scores': { artifactId: 'sam3-selection-scores:browser-detr-stack-composition', shape: [manifest.shape.batch, manifest.shape.queryTokens] },
            'selection-boxes': { artifactId: 'sam3-selection-boxes:browser-detr-stack-composition', shape: [manifest.shape.batch, manifest.shape.queryTokens, 4] },
            'selection-keep': { artifactId: 'sam3-selection-keep:browser-detr-stack-composition', shape: [manifest.shape.batch, manifest.shape.queryTokens] },
            'selected-index': { artifactId: 'sam3-selected-index:browser-detr-stack-composition', shape: [manifest.shape.batch] },
            'selected-score': { artifactId: 'sam3-selected-score:browser-detr-stack-composition', shape: [manifest.shape.batch] },
            'selected-box': { artifactId: 'sam3-selected-box:browser-detr-stack-composition', shape: [manifest.shape.batch, 4] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: scoringResult.receipt?.effectiveRouteId, scoringOutput, referenceBoxesOutput, presenceLogitsOutput },
        });
        selectionResult = await runSam3SelectionPostprocessPhaseProgramRoute({ request: selectionRequest, route: selectionRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: selectionRoute.kernel, model: { revision: selectionRoute.model.revision, weightsHash: 'none', dtype: 'fp32' }, tensors: { predLogits: gpuPredLogits, referenceBoxes: gpuReferenceBoxes, presenceLogits: gpuPresenceLogits, shape: selectionShape }, includeReadback: true });
        gpuSelectionScores = new Float32Array(selectionResult.debugReadback.scores);
        gpuSelectionBoxes = new Float32Array(selectionResult.debugReadback.boxes);
        gpuSelectionKeep = new Uint32Array(selectionResult.debugReadback.keep);
        gpuSelectedIndex = new Uint32Array(selectionResult.debugReadback.selectedIndex);
        gpuSelectedScore = new Float32Array(selectionResult.debugReadback.selectedScore);
        gpuSelectedBox = new Float32Array(selectionResult.debugReadback.selectedBox);
        selectionOutput = selectionResult.receipt.outputs.find(output => output.role === 'selected-index');
        if (!selectionOutput?.sha256 || !selectionOutput?.artifactId) throw new Error('DETR stack selection output identity missing');
      }
      const downstreamTensorSha256 = await aggregateTensorBundleSha256('sam3-mask-tail-composed-tensors', [
        { role: 'last-hs', artifactId: lastHsOutput.artifactId, sha256: lastHsOutput.sha256, shape: lastHsOutput.shape },
        { role: 'pixel-embed', sha256: pixelEmbedTensor.sha256 },
      ]);
      const maskRoute = createSam3MaskTailPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-mask-tail', dtype: 'fp32' }, kernel: { profile: 'sam3-mask-tail-phase-program-v0', commit: params.get('commit') || null } });
      const maskRequest = createRouteInvocationRequest(maskRoute, {
        requestId: `sam-browser-detr-stack-tail-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-mask-tail-tensors': { artifactId: 'sam3-mask-tail-tensors:browser-detr-stack-composition', sha256: downstreamTensorSha256 },
          'sam3-mask-tail-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: {
          'mask-logits': { artifactId: 'sam3-mask-logits:browser-detr-stack-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.maskHeight, manifest.shape.maskWidth] },
          'mask-binary': { artifactId: 'sam3-mask-binary:browser-detr-stack-composition', shape: [manifest.shape.batch, manifest.shape.maskTokens, manifest.shape.maskHeight, manifest.shape.maskWidth] },
        },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: decoderResult.receipt?.effectiveRouteId, lastHsOutput },
      });
      const tailResult = await runSam3MaskTailPhaseProgramRoute({ request: maskRequest, route: maskRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: maskRoute.kernel, model: { revision: maskRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { lastHs: gpuLastHs, pixelEmbed, weights: tailWeights, shape: maskTailShape }, includeReadback: true });
      return {
        ...tailResult,
        receipt: encoderResult.receipt,
        routeReceipt: encoderResult.receipt,
        midstreamRouteReceipt: decoderResult.receipt,
        downstreamRouteReceipt: tailResult.receipt,
        compositionRouteReceipts: includeImagePreprocess ? [imagePreprocessResult.receipt, encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeStackSelection ? [encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeStackScoring ? [encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, tailResult.receipt] : [encoderResult.receipt, decoderResult.receipt, tailResult.receipt],
        backend: tailResult.backend,
        debugReadback: {
          pixelValues: gpuPixelValues ? Array.from(gpuPixelValues) : undefined,
          imagePreprocessCpuMaxAbsDiff,
          encoderHiddenStates: Array.from(gpuEncoderHiddenStates),
          decoderHiddenStates: gpuDecoderHiddenStates ? Array.from(gpuDecoderHiddenStates) : undefined,
          lastHs: Array.from(gpuLastHs),
          referenceBoxes: Array.from(gpuReferenceBoxes),
          presenceLogits: Array.from(gpuPresenceLogits),
          predLogits: gpuPredLogits ? Array.from(gpuPredLogits) : undefined,
          selectionScores: gpuSelectionScores ? Array.from(gpuSelectionScores) : undefined,
          selectionBoxes: gpuSelectionBoxes ? Array.from(gpuSelectionBoxes) : undefined,
          selectionKeep: gpuSelectionKeep ? Array.from(gpuSelectionKeep) : undefined,
          selectedIndex: gpuSelectedIndex ? Array.from(gpuSelectedIndex) : undefined,
          selectedScore: gpuSelectedScore ? Array.from(gpuSelectedScore) : undefined,
          selectedBox: gpuSelectedBox ? Array.from(gpuSelectedBox) : undefined,
          maskLogits: tailResult.debugReadback.maskLogits,
          binaryMask: tailResult.debugReadback.binaryMask,
        },
        compositionEdge: {
          upstreamRouteId: encoderResult.receipt.effectiveRouteId,
          imagePreprocessRouteId: imagePreprocessResult?.receipt?.effectiveRouteId,
          pixelValuesTensorSha256,
          pixelValuesOutput,
          midstreamRouteId: decoderResult.receipt.effectiveRouteId,
          downstreamRouteId: tailResult.receipt.effectiveRouteId,
          detrEncoderOutput,
          decoderTensorSha256,
          lastHsOutput,
          decoderHiddenStatesOutput,
          referenceBoxesOutput,
          presenceLogitsOutput,
          scoringRouteId: scoringResult?.receipt?.effectiveRouteId,
          scoringTensorSha256,
          scoringOutput,
          selectionRouteId: selectionResult?.receipt?.effectiveRouteId,
          selectionTensorSha256,
          selectionOutput,
          downstreamTensorSha256,
        },
      };
    },
  };
}

async function loadScoringPayload(manifest) {
  const hiddenTensor = tensorByRole(manifest, 'hidden-states');
  const promptTensor = tensorByRole(manifest, 'prompt-features');
  const promptMaskTensor = tensorByRole(manifest, 'prompt-mask');
  const expectedPredLogitsTensor = tensorByRole(manifest, 'expected-pred-logits');
  const weightRoles = [
    'scoring-text-mlp-layer-1-weight',
    'scoring-text-mlp-layer-1-bias',
    'scoring-text-mlp-layer-2-weight',
    'scoring-text-mlp-layer-2-bias',
    'scoring-text-mlp-out-norm-weight',
    'scoring-text-mlp-out-norm-bias',
    'scoring-text-proj-weight',
    'scoring-text-proj-bias',
    'scoring-query-proj-weight',
    'scoring-query-proj-bias',
  ];
  const weightsByRole = Object.fromEntries(weightRoles.map(role => [role, weightByRole(manifest, role)]));
  const hiddenStates = await fetchArray(resolveManifestFile(hiddenTensor.file), Float32Array);
  const promptFeatures = await fetchArray(resolveManifestFile(promptTensor.file), Float32Array);
  const promptMask = await fetchArray(resolveManifestFile(promptMaskTensor.file), Float32Array);
  const expectedPredLogits = await fetchArray(resolveManifestFile(expectedPredLogitsTensor.file), Float32Array);
  const weights = {
    textMlpLayer1Weight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-1-weight'].file), Float32Array),
    textMlpLayer1Bias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-1-bias'].file), Float32Array),
    textMlpLayer2Weight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-2-weight'].file), Float32Array),
    textMlpLayer2Bias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-layer-2-bias'].file), Float32Array),
    textMlpOutNormWeight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-out-norm-weight'].file), Float32Array),
    textMlpOutNormBias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-mlp-out-norm-bias'].file), Float32Array),
    textProjWeight: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-proj-weight'].file), Float32Array),
    textProjBias: await fetchArray(resolveManifestFile(weightsByRole['scoring-text-proj-bias'].file), Float32Array),
    queryProjWeight: await fetchArray(resolveManifestFile(weightsByRole['scoring-query-proj-weight'].file), Float32Array),
    queryProjBias: await fetchArray(resolveManifestFile(weightsByRole['scoring-query-proj-bias'].file), Float32Array),
  };
  const shape = {
    layerCount: manifest.shape.layerCount,
    batch: manifest.shape.batch,
    queryTokens: manifest.shape.queryTokens,
    promptTokens: manifest.shape.promptTokens,
    channels: manifest.shape.channels,
    mlpHidden: manifest.shape.mlpHidden,
  };
  const oracle = createSam3ScoringPhaseProgramCpuOracle({ hiddenStates, promptFeatures, promptMask, weights, shape });
  return {
    routeKind: 'scoring-phase-program',
    expectedPredLogits,
    cpuSelfCheck: {
      predLogitsMaxAbsDiff: maxAbsDiff(expectedPredLogits, oracle.predLogits),
      binaryMismatchCount: 0,
    },
    tensorIdentity: {
      hiddenStatesSha256: hiddenTensor.sha256,
      promptFeaturesSha256: promptTensor.sha256,
      promptMaskSha256: promptMaskTensor.sha256,
      expectedPredLogitsSha256: expectedPredLogitsTensor.sha256,
      weightsSha256: Object.fromEntries(Object.entries(weightsByRole).map(([role, weight]) => [role, weight.sha256])),
    },
    async run({ device, adapter, route, request }) {
      return runSam3ScoringPhaseProgramRoute({
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
        tensors: { hiddenStates, promptFeatures, promptMask, weights, shape },
        includeReadback: true,
      });
    },
  };
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

    const payload = manifest.mode === 'mlx-detr-stack-export' || manifest.mode === 'mlx-detr-stack-scoring-export' || manifest.mode === 'mlx-detr-stack-selection-export' || manifest.mode === 'mlx-detector-stack-export' || manifest.mode === 'mlx-detector-stack-preprocess-export' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-mask-tail-phase-program' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-mask-tail-phase-program' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-selection-mask-tail-phase-program' || manifest.boundary === 'sam3-detector-stack-browser-local-detector-mask-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-detector-stack-phase-program'
      ? await loadDetrStackPayload(manifest)
      : manifest.routeId === SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? await loadDetrDecoderPayload(manifest)
      : manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
      ? await loadDetrEncoderPayload(manifest)
      : manifest.routeId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
      ? await loadPromptFpnPayload(manifest)
      : manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? await loadPixelDecoderPayload(manifest)
      : manifest.routeId === SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID
        ? await loadMaskTailPayload(manifest)
      : manifest.routeId === SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID
        ? await loadScoringPayload(manifest)
        : await loadMaskDecoderIslandPayload(manifest);
    const expectedLogits = payload.expectedLogits;
    const expectedBinary = payload.expectedBinary;
    const expectedPredLogits = payload.expectedPredLogits;
    const visualShape = payload.maskShape || manifest.shape;
    const hasMaskOutput = Boolean(expectedBinary);
    const sourceImageUrl = manifest.sourceImage?.file ? resolveManifestFile(manifest.sourceImage.file) : null;
    const sourceImage = sourceImageUrl ? await loadImage(sourceImageUrl) : null;
    if (sourceImageUrl) sourceImageEl.src = sourceImageUrl;
    const legacySelectedMaskIndex = Number.isInteger(manifest.visualization?.selectedMaskIndex)
      ? manifest.visualization.selectedMaskIndex
      : 0;
    let selectedMaskIndex = legacySelectedMaskIndex;
    let selectedMaskIndexSource = 'manifest-visualization';

    const binaryTolerance = manifest.tolerances?.binaryMismatchCount ?? 0;
    const cpuOracleBinaryTolerance = manifest.tolerances?.cpuOracleBinaryMismatchCount ?? binaryTolerance;
    const oracleLogitsTolerance = manifest.tolerances?.cpuOracleLogitsMaxAbsDiff ?? manifest.tolerances?.webGpuLogitsMaxAbsDiff ?? 0;
    const promptFpnTolerance = manifest.tolerances?.promptFpnMaxAbsDiff ?? 0;
    const pixelEmbedTolerance = manifest.tolerances?.pixelEmbedMaxAbsDiff ?? 0;
    const maskEmbeddingsTolerance = manifest.tolerances?.maskEmbeddingsMaxAbsDiff ?? 0;
    const upscaledTolerance = manifest.tolerances?.upscaledEmbeddingMaxAbsDiff ?? 0;
    const scoringTolerance = manifest.tolerances?.predLogitsMaxAbsDiff ?? 0;
    if (
      (payload.cpuSelfCheck.logitsMaxAbsDiff ?? 0) > oracleLogitsTolerance
      || (payload.cpuSelfCheck.predLogitsMaxAbsDiff ?? 0) > scoringTolerance
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

    const route = manifest.routeId === SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? createSam3DetrDecoderPhaseProgramRouteDefinition({
          model: {
            revision: manifest.model?.id || 'mlx-reference-detr-decoder',
            dtype: 'fp32',
          },
          kernel: {
            profile: 'sam3-detr-decoder-phase-program-v0',
            commit: params.get('commit') || null,
          },
          shape: manifest.shape,
        })
      : manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
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
      : manifest.routeId === SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID
      ? createSam3ScoringPhaseProgramRouteDefinition({
          model: {
            revision: manifest.model?.id || 'mlx-reference-scoring',
            dtype: 'fp32',
          },
          kernel: {
            profile: 'sam3-scoring-phase-program-v0',
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
    const detrDecoderTensorBundleSha256 = manifest.routeId === SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? await aggregateTensorBundleSha256('sam3-detr-decoder-tensors', [
          { role: 'encoder-hidden-states', sha256: payload.tensorIdentity.encoderHiddenStatesSha256 },
          { role: 'encoder-pos', sha256: payload.tensorIdentity.encoderPosSha256 },
          { role: 'prompt-features', sha256: payload.tensorIdentity.promptFeaturesSha256 },
          { role: 'prompt-mask', sha256: payload.tensorIdentity.promptMaskSha256 },
        ])
      : null;
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
    const scoringTensorBundleSha256 = manifest.routeId === SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID
      ? await aggregateTensorBundleSha256('sam3-scoring-tensors', [
          { role: 'hidden-states', sha256: payload.tensorIdentity.hiddenStatesSha256 },
          { role: 'prompt-features', sha256: payload.tensorIdentity.promptFeaturesSha256 },
          { role: 'prompt-mask', sha256: payload.tensorIdentity.promptMaskSha256 },
        ])
      : null;
    const inputArtifacts = manifest.routeId === SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID
      ? {
          'source-image': sourceArtifact,
          'sam3-detr-decoder-tensors': {
            artifactId: 'sam3-detr-decoder-tensors:browser-parity',
            sha256: detrDecoderTensorBundleSha256,
          },
          'sam3-detr-decoder-weights': {
            artifactId: manifest.staticWeights.artifactId,
            sha256: manifest.staticWeights.sha256,
          },
        }
      : manifest.routeId === SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
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
      : manifest.routeId === SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID
      ? {
          'source-image': sourceArtifact,
          'sam3-scoring-tensors': {
            artifactId: 'sam3-scoring-tensors:browser-parity',
            sha256: scoringTensorBundleSha256,
          },
          'sam3-scoring-weights': {
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
          : manifest.routeId === SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID
          ? {
              'last-hs': { artifactId: 'sam3-last-hs:browser-parity', shape: [manifest.shape.batch, manifest.shape.queryTokens, manifest.shape.channels] },
              'reference-boxes': { artifactId: 'sam3-reference-boxes:browser-parity', shape: [manifest.shape.batch, manifest.shape.queryTokens, 4] },
              'presence-logits': { artifactId: 'sam3-presence-logits:browser-parity', shape: [manifest.shape.layerCount, manifest.shape.batch, 1] },
            }
          : manifest.routeId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
          ? { 'prompt-fpn-feature': { artifactId: 'sam3-prompt-fpn-feature:browser-parity', shape: [manifest.shape.batch, manifest.shape.height, manifest.shape.width, manifest.shape.channels] } }
          : manifest.routeId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
          ? { 'pixel-embed': { artifactId: 'sam3-pixel-embed:browser-parity', shape: [manifest.shape.batch, manifest.shape.height, manifest.shape.width, manifest.shape.channels] } }
          : manifest.routeId === SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID
          ? { 'pred-logits': { artifactId: 'sam3-pred-logits:browser-parity', shape: [manifest.shape.layerCount, manifest.shape.batch, manifest.shape.queryTokens, 1] } }
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
    const result = await payload.run({ device, adapter, route, request, sourceImage });

    const gpuLogits = result.debugReadback.maskLogits ? new Float32Array(result.debugReadback.maskLogits) : null;
    const gpuBinary = result.debugReadback.binaryMask ? new Uint32Array(result.debugReadback.binaryMask) : null;
    const gpuPredLogits = result.debugReadback.predLogits ? new Float32Array(result.debugReadback.predLogits) : null;
    const parity = {
      encoderHiddenStatesMaxAbsDiff: result.debugReadback.encoderHiddenStates ? maxAbsDiff(payload.expectedEncoderHiddenStates || [], new Float32Array(result.debugReadback.encoderHiddenStates)) : undefined,
      decoderHiddenStatesMaxAbsDiff: result.debugReadback.decoderHiddenStates ? maxAbsDiff(payload.expectedDecoderHiddenStates || [], new Float32Array(result.debugReadback.decoderHiddenStates)) : undefined,
      lastHsMaxAbsDiff: result.debugReadback.lastHs ? maxAbsDiff(payload.expectedLastHs || [], new Float32Array(result.debugReadback.lastHs)) : undefined,
      referenceBoxesMaxAbsDiff: result.debugReadback.referenceBoxes ? maxAbsDiff(payload.expectedReferenceBoxes || [], new Float32Array(result.debugReadback.referenceBoxes)) : undefined,
      presenceLogitsMaxAbsDiff: result.debugReadback.presenceLogits ? maxAbsDiff(payload.expectedPresenceLogits || [], new Float32Array(result.debugReadback.presenceLogits)) : undefined,
      pixelValuesMaxAbsDiff: result.debugReadback.pixelValues ? maxAbsDiff(payload.expectedPixelValues || [], new Float32Array(result.debugReadback.pixelValues)) : undefined,
      imagePreprocessCpuMaxAbsDiff: result.debugReadback.imagePreprocessCpuMaxAbsDiff,
      promptFpnMaxAbsDiff: result.debugReadback.promptFpnFeature ? maxAbsDiff(payload.expectedPromptFpnFeature || [], new Float32Array(result.debugReadback.promptFpnFeature)) : undefined,
      pixelEmbedMaxAbsDiff: result.debugReadback.pixelEmbed ? maxAbsDiff(payload.expectedPixelEmbed || [], new Float32Array(result.debugReadback.pixelEmbed)) : undefined,
      maskLogitsMaxAbsDiff: gpuLogits ? maxAbsDiff(expectedLogits, gpuLogits) : undefined,
      predLogitsMaxAbsDiff: gpuPredLogits ? maxAbsDiff(expectedPredLogits, gpuPredLogits) : undefined,
      selectionScoresMaxAbsDiff: result.debugReadback.selectionScores ? maxAbsDiff(payload.expectedSelectionScores || [], new Float32Array(result.debugReadback.selectionScores)) : undefined,
      selectionBoxesMaxAbsDiff: result.debugReadback.selectionBoxes ? maxAbsDiff(payload.expectedSelectionBoxes || [], new Float32Array(result.debugReadback.selectionBoxes)) : undefined,
      selectionKeepMismatchCount: result.debugReadback.selectionKeep ? mismatchCount(payload.expectedSelectionKeep || [], new Uint32Array(result.debugReadback.selectionKeep)) : undefined,
      selectedIndexMaxAbsDiff: result.debugReadback.selectedIndex ? maxAbsDiff(payload.expectedSelectedIndex || [], new Uint32Array(result.debugReadback.selectedIndex)) : undefined,
      selectedScoreMaxAbsDiff: result.debugReadback.selectedScore ? maxAbsDiff(payload.expectedSelectedScore || [], new Float32Array(result.debugReadback.selectedScore)) : undefined,
      selectedBoxMaxAbsDiff: result.debugReadback.selectedBox ? maxAbsDiff(payload.expectedSelectedBox || [], new Float32Array(result.debugReadback.selectedBox)) : undefined,
      binaryMismatchCount: gpuBinary ? mismatchCount(expectedBinary, gpuBinary) : 0,
      expectedElementCount: expectedLogits?.length ?? expectedPredLogits?.length,
      gpuElementCount: gpuLogits?.length ?? gpuPredLogits?.length,
    };
    const gpuTolerance = manifest.tolerances?.webGpuLogitsMaxAbsDiff ?? 0.00001;
    const gpuLastHsTolerance = manifest.tolerances?.lastHsMaxAbsDiff ?? 0.0002;
    const gpuReferenceBoxesTolerance = manifest.tolerances?.referenceBoxesMaxAbsDiff ?? 0.0002;
    const gpuPresenceLogitsTolerance = manifest.tolerances?.presenceLogitsMaxAbsDiff ?? 0.0002;
    const gpuEncoderTolerance = manifest.tolerances?.encoderHiddenStatesMaxAbsDiff ?? 0.0002;
    const gpuDecoderHiddenStatesTolerance = manifest.tolerances?.decoderHiddenStatesMaxAbsDiff ?? gpuLastHsTolerance;
    const gpuPixelValuesTolerance = manifest.tolerances?.pixelValuesMaxAbsDiff ?? 0.000001;
    const gpuPromptFpnTolerance = manifest.tolerances?.promptFpnMaxAbsDiff ?? 0.00001;
    const gpuPixelTolerance = manifest.tolerances?.pixelEmbedMaxAbsDiff ?? 0.00001;
    const selectionScoresTolerance = manifest.tolerances?.selectionScoresMaxAbsDiff ?? 0.00001;
    const selectionBoxesTolerance = manifest.tolerances?.selectionBoxesMaxAbsDiff ?? 0.0001;
    const selectionKeepTolerance = manifest.tolerances?.selectionKeepMismatchCount ?? 0;
    const selectedIndexTolerance = manifest.tolerances?.selectedIndexMaxAbsDiff ?? 0;
    const selectedScoreTolerance = manifest.tolerances?.selectedScoreMaxAbsDiff ?? 0.00001;
    const selectedBoxTolerance = manifest.tolerances?.selectedBoxMaxAbsDiff ?? 0.0001;
    const debugReadbackSamples = {
      lastHs: result.debugReadback.lastHs ? Array.from(new Float32Array(result.debugReadback.lastHs).slice(0, 16)) : undefined,
      expectedLastHs: payload.expectedLastHs ? Array.from(payload.expectedLastHs.slice(0, 16)) : undefined,
      decoderHiddenStates: result.debugReadback.decoderHiddenStates ? Array.from(new Float32Array(result.debugReadback.decoderHiddenStates).slice(0, 16)) : undefined,
      expectedDecoderHiddenStates: payload.expectedDecoderHiddenStates ? Array.from(payload.expectedDecoderHiddenStates.slice(0, 16)) : undefined,
      referenceBoxes: result.debugReadback.referenceBoxes ? Array.from(new Float32Array(result.debugReadback.referenceBoxes).slice(0, 16)) : undefined,
      expectedReferenceBoxes: payload.expectedReferenceBoxes ? Array.from(payload.expectedReferenceBoxes.slice(0, 16)) : undefined,
      presenceLogits: result.debugReadback.presenceLogits ? Array.from(new Float32Array(result.debugReadback.presenceLogits).slice(0, 8)) : undefined,
      expectedPresenceLogits: payload.expectedPresenceLogits ? Array.from(payload.expectedPresenceLogits.slice(0, 8)) : undefined,
      pixelValues: result.debugReadback.pixelValues ? Array.from(new Float32Array(result.debugReadback.pixelValues).slice(0, 16)) : undefined,
      expectedPixelValues: payload.expectedPixelValues ? Array.from(payload.expectedPixelValues.slice(0, 16)) : undefined,
      predLogits: result.debugReadback.predLogits ? Array.from(new Float32Array(result.debugReadback.predLogits).slice(0, 16)) : undefined,
      expectedPredLogits: payload.expectedPredLogits ? Array.from(payload.expectedPredLogits.slice(0, 16)) : undefined,
      selectedIndex: result.debugReadback.selectedIndex ? Array.from(new Uint32Array(result.debugReadback.selectedIndex).slice(0, 8)) : undefined,
      expectedSelectedIndex: payload.expectedSelectedIndex ? Array.from(payload.expectedSelectedIndex.slice(0, 8)) : undefined,
      selectedScore: result.debugReadback.selectedScore ? Array.from(new Float32Array(result.debugReadback.selectedScore).slice(0, 8)) : undefined,
      expectedSelectedScore: payload.expectedSelectedScore ? Array.from(payload.expectedSelectedScore.slice(0, 8)) : undefined,
    };
    const detectorSelectedMaskIndex = Number.isInteger(debugReadbackSamples.selectedIndex?.[0])
      ? debugReadbackSamples.selectedIndex[0]
      : null;
    if (payload.detectorStackEvidence && detectorSelectedMaskIndex !== null) {
      selectedMaskIndex = detectorSelectedMaskIndex;
      selectedMaskIndexSource = 'detector-selection';
    }
    if (hasMaskOutput && (selectedMaskIndex < 0 || selectedMaskIndex >= manifest.shape.maskTokens)) {
      throw new Error(`selectedMaskIndex ${selectedMaskIndex} out of range`);
    }
    state.parity = parity;
    state.debugReadbackSamples = debugReadbackSamples;
    state.routeReceipt = result.receipt;
    state.midstreamRouteReceipt = result.midstreamRouteReceipt || null;
    state.downstreamRouteReceipt = result.downstreamRouteReceipt || null;
    state.compositionRouteReceipts = result.compositionRouteReceipts || null;
    state.compositionEdge = result.compositionEdge || null;
    state.detectorStackEvidence = payload.detectorStackEvidence ? {
      ...payload.detectorStackEvidence,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      edge: result.compositionEdge || null,
      parity,
      selectedIndex: debugReadbackSamples.selectedIndex?.[0],
      selectedScore: debugReadbackSamples.selectedScore?.[0],
      visualSelectedMaskIndex: selectedMaskIndex,
      selectedMaskIndexSource,
    } : null;
    state.imagePreprocessEvidence = payload.imagePreprocessEvidence ? {
      ...payload.imagePreprocessEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      pixelValuesTensorSha256: result.compositionEdge?.pixelValuesTensorSha256 || null,
      pixelValuesOutput: result.compositionEdge?.pixelValuesOutput || null,
      parity: {
        pixelValuesMaxAbsDiff: parity.pixelValuesMaxAbsDiff,
        imagePreprocessCpuMaxAbsDiff: parity.imagePreprocessCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.pixelValues,
    } : null;
    if (
      (parity.encoderHiddenStatesMaxAbsDiff ?? 0) > gpuEncoderTolerance
      || (parity.decoderHiddenStatesMaxAbsDiff ?? 0) > gpuDecoderHiddenStatesTolerance
      || (parity.lastHsMaxAbsDiff ?? 0) > gpuLastHsTolerance
      || (parity.referenceBoxesMaxAbsDiff ?? 0) > gpuReferenceBoxesTolerance
      || (parity.presenceLogitsMaxAbsDiff ?? 0) > gpuPresenceLogitsTolerance
      || (parity.pixelValuesMaxAbsDiff ?? 0) > gpuPixelValuesTolerance
      || (parity.imagePreprocessCpuMaxAbsDiff ?? 0) > gpuPixelValuesTolerance
      || (parity.promptFpnMaxAbsDiff ?? 0) > gpuPromptFpnTolerance
      || (parity.pixelEmbedMaxAbsDiff ?? 0) > gpuPixelTolerance
      || (parity.maskLogitsMaxAbsDiff ?? 0) > gpuTolerance
      || (parity.predLogitsMaxAbsDiff ?? 0) > scoringTolerance
      || (parity.selectionScoresMaxAbsDiff ?? 0) > selectionScoresTolerance
      || (parity.selectionBoxesMaxAbsDiff ?? 0) > selectionBoxesTolerance
      || (parity.selectionKeepMismatchCount ?? 0) > selectionKeepTolerance
      || (parity.selectedIndexMaxAbsDiff ?? 0) > selectedIndexTolerance
      || (parity.selectedScoreMaxAbsDiff ?? 0) > selectedScoreTolerance
      || (parity.selectedBoxMaxAbsDiff ?? 0) > selectedBoxTolerance
      || parity.binaryMismatchCount > binaryTolerance
    ) {
      throw new Error(`WebGPU parity mismatch: ${JSON.stringify(parity)}`);
    }

    if (hasMaskOutput) {
      drawVisualWitness({
        sourceImage,
        sourceImageIdentity: manifest.sourceImage || null,
        expected: expectedBinary,
        actual: gpuBinary,
        shape: visualShape,
        selectedMaskIndex,
      });
    } else {
      drawScoringWitness({
        sourceImage,
        sourceImageIdentity: manifest.sourceImage || null,
        expected: expectedPredLogits,
        actual: gpuPredLogits,
      });
    }
    state.status = 'passed';
    state.effectiveRouteId = result.receipt.effectiveRouteId;
    state.sourceImage = manifest.sourceImage || null;
    state.selectedMaskIndex = selectedMaskIndex;
    state.selectedMaskIndexSource = selectedMaskIndexSource;
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
    state.imagePreprocessEvidence = payload.imagePreprocessEvidence ? {
      ...payload.imagePreprocessEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      pixelValuesTensorSha256: result.compositionEdge?.pixelValuesTensorSha256 || null,
      pixelValuesOutput: result.compositionEdge?.pixelValuesOutput || null,
      parity: {
        pixelValuesMaxAbsDiff: parity.pixelValuesMaxAbsDiff,
        imagePreprocessCpuMaxAbsDiff: parity.imagePreprocessCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.pixelValues,
    } : null;
    state.debugReadbackSamples = debugReadbackSamples;
    state.parity = parity;
    renderSummary({
      status: state.status,
      route: state.effectiveRouteId,
      mode: manifest.mode,
      adapter: state.backendIdentity?.adapterName,
      selectedMask: selectedMaskIndex,
      logitsDiff: parity.maskLogitsMaxAbsDiff ?? parity.predLogitsMaxAbsDiff,
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
