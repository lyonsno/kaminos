import {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
  createSam3BrowserStaticArtifactCache,
  resolveSam3BrowserArtifactUrl,
  resolveSam3BrowserPackageManifest,
  createRouteInvocationRequest,
  createSam3MaskDecoderIslandRouteDefinition,
  createSam3MaskProjectionCpuOracle,
  createSam3ImagePreprocessPhaseProgramCpuOracle,
  createSam3ImagePreprocessPhaseProgramRouteDefinition,
  createSam3ImagePatchEmbedPhaseProgramCpuOracle,
  createSam3ImagePatchEmbedPhaseProgramRouteDefinition,
  createSam3ImageVitPrefixPhaseProgramCpuOracle,
  createSam3ImageVitPrefixPhaseProgramRouteDefinition,
  createSam3ImageVitFirstBlockPhaseProgramCpuOracle,
  createSam3ImageVitFirstBlockPhaseProgramRouteDefinition,
  createSam3ImageVitBlockStackPhaseProgramCpuOracle,
  createSam3ImageVitBlockStackPhaseProgramRouteDefinition,
  createSam3ImageFpnNeckPhaseProgramCpuOracle,
  createSam3ImageFpnNeckPhaseProgramRouteDefinition,
  createSam3ClipTokenizer,
  parseSam3ClipMerges,
  createSam3MaskTailPhaseProgramCpuOracle,
  createSam3MaskTailPhaseProgramRouteDefinition,
  createSam3PixelDecoderPhaseProgramCpuOracle,
  createSam3PixelDecoderPhaseProgramRouteDefinition,
  createSam3PromptTextIngressPhaseProgramCpuOracle,
  createSam3PromptTextIngressPhaseProgramRouteDefinition,
  createSam3PromptFpnPhaseProgramCpuOracle,
  createSam3PromptFpnPhaseProgramRouteDefinition,
  createSam3DetrImageIngressFromFpnFeatures,
  createSam3DetrEncoderPhaseProgramRouteDefinition,
  createSam3DetrDecoderPhaseProgramRouteDefinition,
  createSam3ScoringPhaseProgramCpuOracle,
  createSam3ScoringPhaseProgramRouteDefinition,
  createSam3SelectionPostprocessPhaseProgramCpuOracle,
  createSam3SelectionPostprocessPhaseProgramRouteDefinition,
  runSam3MaskDecoderIslandRoute,
  runSam3MaskTailPhaseProgramRoute,
  runSam3PixelDecoderPhaseProgramRoute,
  runSam3PromptTextIngressPhaseProgramRoute,
  runSam3PromptFpnPhaseProgramRoute,
  runSam3DetrEncoderPhaseProgramRoute,
  runSam3DetrDecoderPhaseProgramRoute,
  runSam3ScoringPhaseProgramRoute,
  runSam3SelectionPostprocessPhaseProgramRoute,
  runSam3ImagePreprocessPhaseProgramRoute,
  runSam3ImagePatchEmbedPhaseProgramRoute,
  runSam3ImageVitPrefixPhaseProgramRoute,
  runSam3ImageVitFirstBlockPhaseProgramRoute,
  runSam3ImageVitBlockStackPhaseProgramRoute,
  runSam3ImageFpnNeckPhaseProgramRoute,
} from '../src/index.js';

const SUPPORTED_ROUTE_IDS = new Set([
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
  SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
]);
const PIXEL_DECODER_WEIGHT_ROLE_EXAMPLES = ['pixel-decoder-stage-0-conv-weight'];
const SAM3_PILLOW_12_FIXED_POINT_BILINEAR_RESIZE = 'pillow-12-fixed-point-bilinear-v0';

const initialState = {
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
  imagePatchEmbedEvidence: null,
  imageVitPrefixEvidence: null,
  imageVitFirstBlockEvidence: null,
  imageVitBlockStackEvidence: null,
  imageFpnNeckEvidence: null,
  browserPromptTextEvidence: null,
  browserPromptFpnPixelEvidence: null,
  browserPromptTokenizerEvidence: null,
  browserOriginalImageIngressEvidence: null,
  packageInvocationEvidence: null,
  staticArtifactCacheEvidence: null,
  invocationRequestIds: null,
  invocationOutputIdentity: null,
  preDecoderCheckpointEvidence: null,
  browserFpnDetrIngressEvidence: null,
  parity: null,
  binaryThresholdMismatchEvidence: null,
  debugReadbackSamples: null,
  sourceImage: null,
  selectedMaskIndex: null,
  error: null,
};
const state = JSON.parse(JSON.stringify(initialState));
let diagnosticReadback = null;
let diagnosticReadbackEncoded = new Map();
let visualOutput = null;

function resetInvocationState() {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, JSON.parse(JSON.stringify(initialState)));
  diagnosticReadback = null;
  diagnosticReadbackEncoded = new Map();
  visualOutput = null;
}

window.samMaskIslandParitySmokeState = () => JSON.parse(JSON.stringify(state));
window.samMaskIslandVisualOutput = () => visualOutput;

const params = new URLSearchParams(window.location.search);
const initialManifestUrl = params.get('manifest') || '/oracle/tensor-manifest.json';
let activeManifestUrl = initialManifestUrl;
const diagnosticReadbackEnabled = params.get('diagnosticReadback') === '1';
const vitFinitePhaseLayerParam = params.get('vitFinitePhaseLayer');
const vitFinitePhaseLayerIndex = vitFinitePhaseLayerParam == null ? null : Number(vitFinitePhaseLayerParam);
if (vitFinitePhaseLayerIndex != null && (!Number.isInteger(vitFinitePhaseLayerIndex) || vitFinitePhaseLayerIndex < 0)) {
  throw new Error(`invalid vitFinitePhaseLayer ${vitFinitePhaseLayerParam}`);
}
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const reportEl = document.getElementById('report');
const canvas = document.getElementById('sam-mask-parity-canvas');
const sourceImageEl = document.getElementById('sam-source-image');

function encodeFloat32Diagnostic(values) {
  const typed = new Float32Array(values);
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 32768)));
  }
  return {
    dtype: 'float32-le',
    elementCount: typed.length,
    byteLength: typed.byteLength,
    base64: btoa(binary),
  };
}

window.samMaskIslandDiagnosticReadback = ({ tensorName = null, base64Offset = 0, base64Length = null } = {}) => {
  if (!diagnosticReadbackEnabled || !diagnosticReadback) return null;
  if (!Number.isInteger(base64Offset) || base64Offset < 0) throw new Error(`invalid diagnostic base64Offset ${base64Offset}`);
  if (base64Length !== null && (!Number.isInteger(base64Length) || base64Length < 1)) throw new Error(`invalid diagnostic base64Length ${base64Length}`);
  const tensors = {};
  for (const [name, values] of Object.entries(diagnosticReadback.tensors)) {
    if (tensorName !== null && name !== tensorName) continue;
    if (!values) continue;
    if (!diagnosticReadbackEncoded.has(name)) diagnosticReadbackEncoded.set(name, encodeFloat32Diagnostic(values));
    const encoded = diagnosticReadbackEncoded.get(name);
    const base64TotalLength = encoded.base64.length;
    const end = base64Length === null ? base64TotalLength : Math.min(base64TotalLength, base64Offset + base64Length);
    tensors[name] = {
      ...encoded,
      base64: encoded.base64.slice(base64Offset, end),
      base64Offset,
      base64TotalLength,
    };
  }
  if (tensorName !== null && !tensors[tensorName]) throw new Error(`diagnostic tensor ${tensorName} unavailable`);
  return {
    schema: 'kaminos.sam3-browser-diagnostic-readback.v0',
    packageId: diagnosticReadback.packageId,
    invocationId: diagnosticReadback.invocationId,
    tensors,
  };
};

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

async function fetchArrayBufferRaw(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.arrayBuffer();
}

async function fetchTextRaw(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.text();
}

const staticArtifactCache = createSam3BrowserStaticArtifactCache({
  fetchArrayBuffer: fetchArrayBufferRaw,
  fetchText: fetchTextRaw,
});

async function fetchArray(url, Type) {
  return staticArtifactCache.fetchArray(url, Type);
}

async function fetchText(url) {
  return staticArtifactCache.fetchText(url);
}

function configureStaticModelPackage(manifest) {
  const artifacts = (manifest.weights || []).map(weight => ({
    url: resolveManifestFile(weight.file),
    kind: 'array-buffer',
    sha256: weight.sha256,
  }));
  for (const tokenizerArtifact of [manifest.promptTokenizer?.vocab, manifest.promptTokenizer?.merges]) {
    if (!tokenizerArtifact?.file || !tokenizerArtifact?.sha256) continue;
    artifacts.push({
      url: resolveManifestFile(tokenizerArtifact.file),
      kind: 'text',
      sha256: tokenizerArtifact.sha256,
    });
  }
  staticArtifactCache.configure({ packageId: manifest.packageId, artifacts });
  staticArtifactCache.configureInvocation({
    invocationId: manifest.invocationId,
    artifacts: (manifest.tensors || []).map(tensor => ({
      url: resolveManifestFile(tensor.file),
      kind: 'array-buffer',
      sha256: tensor.sha256,
    })),
  });
  state.staticArtifactCacheEvidence = staticArtifactCache.evidence();
}

async function resolveBrowserManifest(rootManifest) {
  return resolveSam3BrowserPackageManifest(rootManifest, {
    readArtifactText: file => fetchTextRaw(resolveManifestFile(file)),
    sha256Text,
  });
}

function resolveManifestFile(file) {
  return resolveSam3BrowserArtifactUrl(file, activeManifestUrl, window.location.href);
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

function collectBinaryThresholdMismatchEvidence(expectedLogits, gpuLogits, expectedBinary, gpuBinary) {
  if (!expectedLogits || !gpuLogits || !expectedBinary || !gpuBinary) return null;
  if (expectedLogits.length !== gpuLogits.length || expectedBinary.length !== gpuBinary.length || expectedLogits.length !== expectedBinary.length) {
    throw new Error('binary threshold mismatch evidence length mismatch');
  }
  const mismatches = [];
  for (let index = 0; index < expectedBinary.length; index += 1) {
    if (Number(expectedBinary[index]) === Number(gpuBinary[index])) continue;
    const expectedLogit = Number(expectedLogits[index]);
    const gpuLogit = Number(gpuLogits[index]);
    mismatches.push({
      index,
      expectedBinary: Number(expectedBinary[index]),
      gpuBinary: Number(gpuBinary[index]),
      expectedLogit,
      gpuLogit,
      logitAbsDiff: Math.abs(expectedLogit - gpuLogit),
    });
  }
  return {
    threshold: 0,
    mismatchCount: mismatches.length,
    maxExpectedAbsLogit: mismatches.reduce((max, item) => Math.max(max, Math.abs(item.expectedLogit)), 0),
    maxGpuAbsLogit: mismatches.reduce((max, item) => Math.max(max, Math.abs(item.gpuLogit)), 0),
    maxLogitAbsDiff: mismatches.reduce((max, item) => Math.max(max, item.logitAbsDiff), 0),
    mismatches,
  };
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

async function loadSourceImageAsset(url, identity) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const effectiveSourceImageSha256 = await sha256TypedArray(bytes);
  if (identity?.sha256 && effectiveSourceImageSha256 !== identity.sha256) {
    throw new Error(`SAM3 source image asset hash mismatch: ${effectiveSourceImageSha256} != ${identity.sha256}`);
  }
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get('content-type') || 'application/octet-stream' }));
  const image = await loadImage(objectUrl);
  return {
    image,
    objectUrl,
    evidence: {
      schema: 'kaminos.sam3-browser-original-image-ingress-evidence.v0',
      runtimeOwner: 'browser',
      sourceFile: identity?.file || null,
      requestedSourceImageSha256: identity?.sha256 || null,
      effectiveSourceImageSha256,
      encodedByteLength: bytes.byteLength,
      decodedResolution: [image.naturalWidth, image.naturalHeight],
    },
  };
}

function sourceImageShape(manifest) {
  const resolution = manifest.sourceImage?.encodedResolution || manifest.sourceImage?.resolution;
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

function imagePatchEmbedShape(manifest) {
  return {
    batch: manifest.shape.batch || 1,
    imageHeight: manifest.shape.imageHeight || manifest.sourceImage?.resolution?.[1],
    imageWidth: manifest.shape.imageWidth || manifest.sourceImage?.resolution?.[0],
    imageChannels: manifest.shape.imageChannels || 3,
    patchSize: manifest.shape.patchSize,
    patchHeight: manifest.shape.patchHeight,
    patchWidth: manifest.shape.patchWidth,
    hiddenSize: manifest.shape.visionHiddenSize,
  };
}

function imageVitPrefixShape(manifest) {
  return {
    batch: manifest.shape.batch || 1,
    patchHeight: manifest.shape.patchHeight,
    patchWidth: manifest.shape.patchWidth,
    hiddenSize: manifest.shape.visionHiddenSize,
    pretrainGridSize: manifest.shape.pretrainGridSize,
  };
}

function imageVitFirstBlockShape(manifest) {
  return {
    batch: manifest.shape.batch || 1,
    height: manifest.shape.patchHeight,
    width: manifest.shape.patchWidth,
    hiddenSize: manifest.shape.visionHiddenSize,
    numHeads: manifest.shape.visionHeads,
    windowSize: manifest.shape.visionWindowSize,
    intermediateSize: manifest.shape.visionMlpHidden,
    layerNormEps: manifest.shape.visionLayerNormEps,
    ropeTheta: manifest.shape.visionRopeTheta,
  };
}

function imageVitBlockStackShape(manifest) {
  return {
    batch: manifest.shape.batch || 1,
    height: manifest.shape.patchHeight,
    width: manifest.shape.patchWidth,
    hiddenSize: manifest.shape.visionHiddenSize,
    numHeads: manifest.shape.visionHeads,
    windowSize: manifest.shape.visionWindowSize,
    intermediateSize: manifest.shape.visionMlpHidden,
    layerNormEps: manifest.shape.visionLayerNormEps,
    ropeTheta: manifest.shape.visionRopeTheta,
    startLayerIndex: manifest.shape.vitBlockStackStartLayerIndex ?? 0,
    endLayerIndex: manifest.shape.vitBlockStackEndLayerIndex ?? manifest.shape.firstGlobalLayerIndex,
    firstGlobalLayerIndex: manifest.shape.firstGlobalLayerIndex,
    finalLayerIndex: manifest.shape.vitBackboneFinalLayerIndex ?? manifest.shape.vitBlockStackEndLayerIndex ?? manifest.shape.firstGlobalLayerIndex,
    fullBackbone: manifest.shape.vitBlockStackFullBackbone === true || manifest.imageVitBlockStack?.fullBackbone === true,
    globalAttnIndexes: manifest.shape.globalAttnIndexes,
  };
}

function imageVitBlockStackWeightRoles(startLayerIndex, endLayerIndex) {
  const suffixes = [
    'layernorm1-weight',
    'layernorm1-bias',
    'q-proj-weight',
    'q-proj-bias',
    'k-proj-weight',
    'k-proj-bias',
    'v-proj-weight',
    'v-proj-bias',
    'o-proj-weight',
    'o-proj-bias',
    'layernorm2-weight',
    'layernorm2-bias',
    'mlp-fc1-weight',
    'mlp-fc1-bias',
    'mlp-fc2-weight',
    'mlp-fc2-bias',
  ];
  const roles = [];
  for (let layerIndex = startLayerIndex; layerIndex <= endLayerIndex; layerIndex += 1) {
    for (const suffix of suffixes) roles.push(`vit-block-stack-layer${layerIndex}-${suffix}`);
  }
  return roles;
}

function imageFpnNeckShape(manifest) {
  return {
    batch: manifest.shape.batch || 1,
    backboneHeight: manifest.shape.patchHeight,
    backboneWidth: manifest.shape.patchWidth,
    backboneChannels: manifest.shape.visionHiddenSize,
    fpnHiddenSize: manifest.shape.fpnHiddenSize,
    levels: manifest.shape.fpnNeckLevels,
  };
}

function imageFpnNeckWeightRoles() {
  return [
    'fpn-neck-layer0-scale0-weight',
    'fpn-neck-layer0-scale0-bias',
    'fpn-neck-layer0-scale2-weight',
    'fpn-neck-layer0-scale2-bias',
    'fpn-neck-layer0-proj1-weight',
    'fpn-neck-layer0-proj1-bias',
    'fpn-neck-layer0-proj2-weight',
    'fpn-neck-layer0-proj2-bias',
    'fpn-neck-layer1-scale0-weight',
    'fpn-neck-layer1-scale0-bias',
    'fpn-neck-layer1-proj1-weight',
    'fpn-neck-layer1-proj1-bias',
    'fpn-neck-layer1-proj2-weight',
    'fpn-neck-layer1-proj2-bias',
    'fpn-neck-layer2-proj1-weight',
    'fpn-neck-layer2-proj1-bias',
    'fpn-neck-layer2-proj2-weight',
    'fpn-neck-layer2-proj2-bias',
    'fpn-neck-layer3-proj1-weight',
    'fpn-neck-layer3-proj1-bias',
    'fpn-neck-layer3-proj2-weight',
    'fpn-neck-layer3-proj2-bias',
  ];
}

function promptTextIngressShape(manifest) {
  return {
    batch: manifest.shape.batch || 1,
    promptTokens: manifest.shape.promptTokens,
    hiddenSize: manifest.shape.textHiddenSize,
    channels: manifest.shape.channels,
    intermediateSize: manifest.shape.textIntermediateSize,
    heads: manifest.shape.textHeads,
    layerCount: manifest.shape.textLayerCount,
    vocabSize: manifest.shape.textVocabSize,
    maxPositionEmbeddings: manifest.shape.textMaxPositionEmbeddings,
  };
}

function promptTextIngressWeightRoles(layerCount) {
  const roles = [
    'prompt-token-embedding-weight',
    'prompt-position-embedding-weight',
    'prompt-text-final-layernorm-weight',
    'prompt-text-final-layernorm-bias',
    'prompt-text-projection-weight',
    'prompt-text-projection-bias',
  ];
  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    for (const suffix of [
      'layernorm1-weight',
      'layernorm1-bias',
      'q-weight',
      'q-bias',
      'k-weight',
      'k-bias',
      'v-weight',
      'v-bias',
      'o-weight',
      'o-bias',
      'layernorm2-weight',
      'layernorm2-bias',
      'fc1-weight',
      'fc1-bias',
      'fc2-weight',
      'fc2-bias',
    ]) roles.push(`prompt-text-layer-${layerIndex}-${suffix}`);
  }
  return roles;
}

async function loadPromptTextIngressWeights(weightsByRole, shape) {
  const load = role => fetchArray(resolveManifestFile(weightsByRole[role].file), Float32Array);
  return {
    tokenEmbeddingWeight: await load('prompt-token-embedding-weight'),
    positionEmbeddingWeight: await load('prompt-position-embedding-weight'),
    finalLayerNormWeight: await load('prompt-text-final-layernorm-weight'),
    finalLayerNormBias: await load('prompt-text-final-layernorm-bias'),
    textProjectionWeight: await load('prompt-text-projection-weight'),
    textProjectionBias: await load('prompt-text-projection-bias'),
    layers: await Promise.all(Array.from({ length: shape.layerCount }, async (_, layerIndex) => ({
      layerNorm1Weight: await load(`prompt-text-layer-${layerIndex}-layernorm1-weight`),
      layerNorm1Bias: await load(`prompt-text-layer-${layerIndex}-layernorm1-bias`),
      qWeight: await load(`prompt-text-layer-${layerIndex}-q-weight`),
      qBias: await load(`prompt-text-layer-${layerIndex}-q-bias`),
      kWeight: await load(`prompt-text-layer-${layerIndex}-k-weight`),
      kBias: await load(`prompt-text-layer-${layerIndex}-k-bias`),
      vWeight: await load(`prompt-text-layer-${layerIndex}-v-weight`),
      vBias: await load(`prompt-text-layer-${layerIndex}-v-bias`),
      oWeight: await load(`prompt-text-layer-${layerIndex}-o-weight`),
      oBias: await load(`prompt-text-layer-${layerIndex}-o-bias`),
      layerNorm2Weight: await load(`prompt-text-layer-${layerIndex}-layernorm2-weight`),
      layerNorm2Bias: await load(`prompt-text-layer-${layerIndex}-layernorm2-bias`),
      fc1Weight: await load(`prompt-text-layer-${layerIndex}-fc1-weight`),
      fc1Bias: await load(`prompt-text-layer-${layerIndex}-fc1-bias`),
      fc2Weight: await load(`prompt-text-layer-${layerIndex}-fc2-weight`),
      fc2Bias: await load(`prompt-text-layer-${layerIndex}-fc2-bias`),
    }))),
  };
}

async function loadImageFpnNeckWeights(weightsByRole) {
  const load = role => fetchArray(resolveManifestFile(weightsByRole[role].file), Float32Array);
  const conv = async (prefix, kernelSize, stride, padding, inChannels, outChannels, activation = null) => ({
    weight: await load(`${prefix}-weight`),
    bias: await load(`${prefix}-bias`),
    kernelSize,
    stride,
    padding,
    inChannels,
    outChannels,
    activation,
  });
  return {
    levels: [
      {
        level: 0,
        scaleLayers: [
          await conv('fpn-neck-layer0-scale0', 2, 2, 0, 1024, 512, 'gelu'),
          await conv('fpn-neck-layer0-scale2', 2, 2, 0, 512, 256),
        ],
        proj1: await conv('fpn-neck-layer0-proj1', 1, 1, 0, 256, 256),
        proj2: await conv('fpn-neck-layer0-proj2', 3, 1, 1, 256, 256),
      },
      {
        level: 1,
        scaleLayers: [await conv('fpn-neck-layer1-scale0', 2, 2, 0, 1024, 512)],
        proj1: await conv('fpn-neck-layer1-proj1', 1, 1, 0, 512, 256),
        proj2: await conv('fpn-neck-layer1-proj2', 3, 1, 1, 256, 256),
      },
      {
        level: 2,
        scaleLayers: [],
        proj1: await conv('fpn-neck-layer2-proj1', 1, 1, 0, 1024, 256),
        proj2: await conv('fpn-neck-layer2-proj2', 3, 1, 1, 256, 256),
      },
      {
        level: 3,
        scaleLayers: [],
        proj1: await conv('fpn-neck-layer3-proj1', 1, 1, 0, 1024, 256),
        proj2: await conv('fpn-neck-layer3-proj2', 3, 1, 1, 256, 256),
      },
    ],
  };
}

async function loadImageVitBlockStackWeights(manifest, weightsByRole, shape) {
  const globalAttnIndexes = shape.globalAttnIndexes || [];
  const layers = [];
  for (let layerIndex = shape.startLayerIndex; layerIndex <= shape.endLayerIndex; layerIndex += 1) {
    layers.push({
      layerIndex,
      isGlobal: globalAttnIndexes.includes(layerIndex),
      layerNorm1Weight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-layernorm1-weight`].file), Float32Array),
      layerNorm1Bias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-layernorm1-bias`].file), Float32Array),
      qProjWeight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-q-proj-weight`].file), Float32Array),
      qProjBias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-q-proj-bias`].file), Float32Array),
      kProjWeight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-k-proj-weight`].file), Float32Array),
      kProjBias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-k-proj-bias`].file), Float32Array),
      vProjWeight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-v-proj-weight`].file), Float32Array),
      vProjBias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-v-proj-bias`].file), Float32Array),
      oProjWeight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-o-proj-weight`].file), Float32Array),
      oProjBias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-o-proj-bias`].file), Float32Array),
      layerNorm2Weight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-layernorm2-weight`].file), Float32Array),
      layerNorm2Bias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-layernorm2-bias`].file), Float32Array),
      mlpFc1Weight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-mlp-fc1-weight`].file), Float32Array),
      mlpFc1Bias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-mlp-fc1-bias`].file), Float32Array),
      mlpFc2Weight: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-mlp-fc2-weight`].file), Float32Array),
      mlpFc2Bias: await fetchArray(resolveManifestFile(weightsByRole[`vit-block-stack-layer${layerIndex}-mlp-fc2-bias`].file), Float32Array),
    });
  }
  return { layers };
}

function rgbaFromSourceImage(sourceImage, shape) {
  if (!sourceImage) throw new Error('source image is required for SAM3 image-preprocess ingress');
  const scratch = document.createElement('canvas');
  scratch.width = sourceImage.naturalWidth;
  scratch.height = sourceImage.naturalHeight;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceImage, 0, 0);
  const source = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
  return resizeRgbaPillowCompatibleBilinear(source, scratch.width, scratch.height, shape.width, shape.height);
}

function resizeRgbaPillowCompatibleBilinear(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const precisionBits = 22;
  const precisionScale = 2 ** precisionBits;
  const rounding = 2 ** (precisionBits - 1);
  const coefficients = (inputSize, outputSize) => {
    const scale = inputSize / outputSize;
    const filterScale = Math.max(scale, 1);
    const support = filterScale;
    return Array.from({ length: outputSize }, (_, outputIndex) => {
      const center = (outputIndex + 0.5) * scale;
      const start = Math.max(0, Math.floor(center - support + 0.5));
      const end = Math.min(inputSize, Math.floor(center + support + 0.5));
      const weights = new Float64Array(end - start);
      let total = 0;
      for (let index = start; index < end; index += 1) {
        const weight = Math.max(0, 1 - Math.abs((index - center + 0.5) / filterScale));
        weights[index - start] = weight;
        total += weight;
      }
      for (let index = 0; index < weights.length; index += 1) weights[index] /= total;
      const fixedWeights = Int32Array.from(weights, weight => Math.floor(weight * precisionScale + 0.5));
      return { start, end, weights: fixedWeights };
    });
  };
  const horizontal = new Uint8Array(sourceHeight * targetWidth * 3);
  const horizontalCoefficients = coefficients(sourceWidth, targetWidth);
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const { start, end, weights } = horizontalCoefficients[x];
      for (let channel = 0; channel < 3; channel += 1) {
        let value = rounding;
        for (let sourceX = start; sourceX < end; sourceX += 1) {
          value += source[(y * sourceWidth + sourceX) * 4 + channel] * weights[sourceX - start];
        }
        horizontal[(y * targetWidth + x) * 3 + channel] = Math.min(255, Math.max(0, Math.floor(value / precisionScale)));
      }
    }
  }
  const output = new Uint8ClampedArray(targetHeight * targetWidth * 4);
  const verticalCoefficients = coefficients(sourceHeight, targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const { start, end, weights } = verticalCoefficients[y];
    for (let x = 0; x < targetWidth; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = rounding;
        for (let sourceY = start; sourceY < end; sourceY += 1) {
          value += horizontal[(sourceY * targetWidth + x) * 3 + channel] * weights[sourceY - start];
        }
        output[(y * targetWidth + x) * 4 + channel] = Math.min(255, Math.max(0, Math.floor(value / precisionScale)));
      }
      output[(y * targetWidth + x) * 4 + 3] = 255;
    }
  }
  return output;
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

async function sha256TypedArray(values) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
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
  const includeImageFpnNeck = manifest.mode === 'mlx-detector-stack-image-fpn-neck-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-full-backbone-fpn-neck-detector-stack-phase-program';
  const includeImageVitFullBackbone = includeImageFpnNeck || manifest.mode === 'mlx-detector-stack-vit-backbone-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-full-backbone-detector-stack-phase-program';
  const includeImageVitBlockStack = includeImageVitFullBackbone || manifest.mode === 'mlx-detector-stack-vit-block-stack-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-block-stack-first-global-detector-stack-phase-program';
  const includeImageVitFirstBlock = !includeImageVitBlockStack && (manifest.mode === 'mlx-detector-stack-vit-first-block-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-first-block-detector-stack-phase-program');
  const includeImageVitPrefix = includeImageVitBlockStack || includeImageVitFirstBlock || manifest.mode === 'mlx-detector-stack-vit-prefix-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-detector-stack-phase-program';
  const includeImagePatchEmbed = includeImageVitPrefix || manifest.mode === 'mlx-detector-stack-patch-embed-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-detector-stack-phase-program';
  const includeImagePreprocess = includeImagePatchEmbed || manifest.mode === 'mlx-detector-stack-preprocess-export' || manifest.boundary === 'sam3-browser-local-image-preprocess-detector-stack-phase-program';
  const includeDetectorStack = includeImagePreprocess || includeImagePatchEmbed || manifest.mode === 'mlx-detector-stack-export' || manifest.boundary === 'sam3-detector-stack-browser-local-detector-mask-phase-program';
  const includeStackSelection = includeDetectorStack || manifest.mode === 'mlx-detr-stack-selection-export' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-selection-mask-tail-phase-program';
  const includeStackScoring = includeStackSelection || manifest.mode === 'mlx-detr-stack-scoring-export' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-mask-tail-phase-program';
  const expectedPixelValuesTensor = includeImagePreprocess ? tensorByRole(manifest, 'expected-pixel-values') : null;
  const expectedPatchEmbeddingsTensor = includeImagePatchEmbed ? tensorByRole(manifest, 'expected-patch-embeddings') : null;
  const expectedVitPrefixTensor = includeImageVitPrefix ? tensorByRole(manifest, 'expected-vit-prefix-hidden-states') : null;
  const expectedVitFirstBlockTensor = includeImageVitFirstBlock ? tensorByRole(manifest, 'expected-vit-first-block-hidden-states') : null;
  const expectedVitFirstGlobalTensor = includeImageVitBlockStack ? tensorByRole(manifest, 'expected-vit-first-global-hidden-states') : null;
  const expectedVitBlockStackTensor = includeImageVitBlockStack ? tensorByRole(manifest, 'expected-vit-block-stack-hidden-states') : null;
  const expectedVitBackboneTensor = includeImageVitFullBackbone ? tensorByRole(manifest, 'expected-vit-backbone-hidden-states') : null;
  const expectedVitLayerTensors = includeImageVitBlockStack
    ? manifest.tensors
      .map(tensor => {
        const match = /^expected-vit-layer-(\d+)-hidden-states$/.exec(tensor.role);
        return match ? { layerIndex: Number(match[1]), tensor } : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.layerIndex - right.layerIndex)
    : [];
  const expectedFpnNeckFeature0Tensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-fpn-neck-feature-0') : null;
  const expectedFpnNeckFeature1Tensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-fpn-neck-feature-1') : null;
  const expectedFpnNeckFeature2Tensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-fpn-neck-feature-2') : null;
  const expectedFpnNeckFeature3Tensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-fpn-neck-feature-3') : null;
  const promptInputIdsTensor = includeImageFpnNeck ? tensorByRole(manifest, 'prompt-input-ids') : null;
  const promptAttentionMaskTensor = includeImageFpnNeck ? tensorByRole(manifest, 'prompt-attention-mask') : null;
  const expectedPromptFeaturesTensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-prompt-features') : null;
  const expectedPromptMaskTensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-prompt-mask') : null;
  const expectedPromptFpnTensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-prompt-fpn-feature') : null;
  const expectedPixelEmbedTensor = includeImageFpnNeck ? tensorByRole(manifest, 'expected-pixel-embed') : null;
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
  const patchEmbedWeightRoles = includeImagePatchEmbed ? ['patch-embed-projection-weight'] : [];
  const vitPrefixWeightRoles = includeImageVitPrefix ? ['vit-position-embeddings', 'vit-backbone-layernorm-weight', 'vit-backbone-layernorm-bias'] : [];
  const vitBlockStackShapeForRoles = includeImageVitBlockStack ? imageVitBlockStackShape(manifest) : null;
  const fpnNeckWeightRoles = includeImageFpnNeck ? imageFpnNeckWeightRoles() : [];
  const promptTextShape = includeImageFpnNeck ? promptTextIngressShape(manifest) : null;
  const promptTextWeightRoles = includeImageFpnNeck ? promptTextIngressWeightRoles(promptTextShape.layerCount) : [];
  const promptWeightRoles = includeImageFpnNeck ? [
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
  ] : [];
  const pixelWeightRoles = [];
  if (includeImageFpnNeck) {
    const levels = manifest.shape.levels || manifest.shape.fpnNeckLevels;
    for (let stage = 0; stage < levels.length - 1; stage += 1) {
      pixelWeightRoles.push(
        `pixel-decoder-stage-${stage}-conv-weight`,
        `pixel-decoder-stage-${stage}-conv-bias`,
        `pixel-decoder-stage-${stage}-norm-weight`,
        `pixel-decoder-stage-${stage}-norm-bias`,
      );
    }
  }
  const vitFirstBlockWeightRoles = includeImageVitFirstBlock ? [
    'vit-block0-layernorm1-weight',
    'vit-block0-layernorm1-bias',
    'vit-block0-q-proj-weight',
    'vit-block0-q-proj-bias',
    'vit-block0-k-proj-weight',
    'vit-block0-k-proj-bias',
    'vit-block0-v-proj-weight',
    'vit-block0-v-proj-bias',
    'vit-block0-o-proj-weight',
    'vit-block0-o-proj-bias',
    'vit-block0-layernorm2-weight',
    'vit-block0-layernorm2-bias',
    'vit-block0-mlp-fc1-weight',
    'vit-block0-mlp-fc1-bias',
    'vit-block0-mlp-fc2-weight',
    'vit-block0-mlp-fc2-bias',
  ] : [];
  const vitBlockStackWeightRoles = includeImageVitBlockStack ? imageVitBlockStackWeightRoles(vitBlockStackShapeForRoles.startLayerIndex, vitBlockStackShapeForRoles.endLayerIndex) : [];
  const weightsByRole = Object.fromEntries([...encoderRoles, ...decoderLayerRoles, ...decoderSharedRoles, ...patchEmbedWeightRoles, ...vitPrefixWeightRoles, ...vitFirstBlockWeightRoles, ...vitBlockStackWeightRoles, ...fpnNeckWeightRoles, ...promptTextWeightRoles, ...promptWeightRoles, ...pixelWeightRoles, ...(includeStackScoring ? scoringWeightRoles : []), ...tailWeightRoles].map(role => [role, weightByRole(manifest, role)]));
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
  const expectedPatchEmbeddings = expectedPatchEmbeddingsTensor ? await fetchArray(resolveManifestFile(expectedPatchEmbeddingsTensor.file), Float32Array) : null;
  const expectedVitPrefixHiddenStates = expectedVitPrefixTensor ? await fetchArray(resolveManifestFile(expectedVitPrefixTensor.file), Float32Array) : null;
  const expectedVitFirstBlockHiddenStates = expectedVitFirstBlockTensor ? await fetchArray(resolveManifestFile(expectedVitFirstBlockTensor.file), Float32Array) : null;
  const expectedVitFirstGlobalHiddenStates = expectedVitFirstGlobalTensor ? await fetchArray(resolveManifestFile(expectedVitFirstGlobalTensor.file), Float32Array) : null;
  const expectedVitBlockStackHiddenStates = expectedVitBlockStackTensor ? await fetchArray(resolveManifestFile(expectedVitBlockStackTensor.file), Float32Array) : null;
  const expectedVitBackboneHiddenStates = expectedVitBackboneTensor ? await fetchArray(resolveManifestFile(expectedVitBackboneTensor.file), Float32Array) : null;
  const expectedVitLayerCheckpoints = await Promise.all(expectedVitLayerTensors.map(async ({ layerIndex, tensor }) => ({
    layerIndex,
    hiddenStates: await fetchArray(resolveManifestFile(tensor.file), Float32Array),
  })));
  if (includeImageVitBlockStack) {
    const expectedLayerIndexes = Array.from(
      { length: manifest.shape.vitBlockStackEndLayerIndex - manifest.shape.vitBlockStackStartLayerIndex + 1 },
      (_, offset) => manifest.shape.vitBlockStackStartLayerIndex + offset,
    );
    if (expectedVitLayerCheckpoints.length !== expectedLayerIndexes.length
      || expectedVitLayerCheckpoints.some((checkpoint, offset) => checkpoint.layerIndex !== expectedLayerIndexes[offset])) {
      throw new Error(`authenticated ViT layer checkpoint coverage mismatch: expected ${expectedLayerIndexes.join(',')}, received ${expectedVitLayerCheckpoints.map(checkpoint => checkpoint.layerIndex).join(',')}`);
    }
  }
  const expectedFpnNeckFeature0 = expectedFpnNeckFeature0Tensor ? await fetchArray(resolveManifestFile(expectedFpnNeckFeature0Tensor.file), Float32Array) : null;
  const expectedFpnNeckFeature1 = expectedFpnNeckFeature1Tensor ? await fetchArray(resolveManifestFile(expectedFpnNeckFeature1Tensor.file), Float32Array) : null;
  const expectedFpnNeckFeature2 = expectedFpnNeckFeature2Tensor ? await fetchArray(resolveManifestFile(expectedFpnNeckFeature2Tensor.file), Float32Array) : null;
  const expectedFpnNeckFeature3 = expectedFpnNeckFeature3Tensor ? await fetchArray(resolveManifestFile(expectedFpnNeckFeature3Tensor.file), Float32Array) : null;
  const referencePromptInputIds = promptInputIdsTensor ? await fetchArray(resolveManifestFile(promptInputIdsTensor.file), Uint32Array) : null;
  const referencePromptAttentionMask = promptAttentionMaskTensor ? await fetchArray(resolveManifestFile(promptAttentionMaskTensor.file), Float32Array) : null;
  const expectedPromptFeatures = expectedPromptFeaturesTensor ? await fetchArray(resolveManifestFile(expectedPromptFeaturesTensor.file), Float32Array) : promptFeatures;
  const expectedPromptMask = expectedPromptMaskTensor ? await fetchArray(resolveManifestFile(expectedPromptMaskTensor.file), Float32Array) : promptMask;
  const expectedPromptFpnFeature = expectedPromptFpnTensor ? await fetchArray(resolveManifestFile(expectedPromptFpnTensor.file), Float32Array) : null;
  const expectedBrowserPixelEmbed = expectedPixelEmbedTensor ? await fetchArray(resolveManifestFile(expectedPixelEmbedTensor.file), Float32Array) : null;
  const patchProjectionWeight = includeImagePatchEmbed ? await fetchArray(resolveManifestFile(weightsByRole['patch-embed-projection-weight'].file), Float32Array) : null;
  const vitPrefixWeights = includeImageVitPrefix ? {
    positionEmbeddings: await fetchArray(resolveManifestFile(weightsByRole['vit-position-embeddings'].file), Float32Array),
    layerNormWeight: await fetchArray(resolveManifestFile(weightsByRole['vit-backbone-layernorm-weight'].file), Float32Array),
    layerNormBias: await fetchArray(resolveManifestFile(weightsByRole['vit-backbone-layernorm-bias'].file), Float32Array),
  } : null;
  const vitFirstBlockWeights = includeImageVitFirstBlock ? {
    layerNorm1Weight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-layernorm1-weight'].file), Float32Array),
    layerNorm1Bias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-layernorm1-bias'].file), Float32Array),
    qProjWeight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-q-proj-weight'].file), Float32Array),
    qProjBias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-q-proj-bias'].file), Float32Array),
    kProjWeight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-k-proj-weight'].file), Float32Array),
    kProjBias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-k-proj-bias'].file), Float32Array),
    vProjWeight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-v-proj-weight'].file), Float32Array),
    vProjBias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-v-proj-bias'].file), Float32Array),
    oProjWeight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-o-proj-weight'].file), Float32Array),
    oProjBias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-o-proj-bias'].file), Float32Array),
    layerNorm2Weight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-layernorm2-weight'].file), Float32Array),
    layerNorm2Bias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-layernorm2-bias'].file), Float32Array),
    mlpFc1Weight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-mlp-fc1-weight'].file), Float32Array),
    mlpFc1Bias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-mlp-fc1-bias'].file), Float32Array),
    mlpFc2Weight: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-mlp-fc2-weight'].file), Float32Array),
    mlpFc2Bias: await fetchArray(resolveManifestFile(weightsByRole['vit-block0-mlp-fc2-bias'].file), Float32Array),
  } : null;
  const vitBlockStackWeights = includeImageVitBlockStack ? await loadImageVitBlockStackWeights(manifest, weightsByRole, vitBlockStackShapeForRoles) : null;
  const fpnNeckWeights = includeImageFpnNeck ? await loadImageFpnNeckWeights(weightsByRole) : null;
  const promptTextWeights = includeImageFpnNeck ? await loadPromptTextIngressWeights(weightsByRole, promptTextShape) : null;
  const promptWeights = includeImageFpnNeck ? {
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
  } : null;
  const pixelWeights = includeImageFpnNeck ? {
    stages: await Promise.all(Array.from({ length: (manifest.shape.levels || manifest.shape.fpnNeckLevels).length - 1 }, async (_, stage) => ({
      convWeight: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-conv-weight`].file), Float32Array),
      convBias: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-conv-bias`].file), Float32Array),
      normWeight: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-norm-weight`].file), Float32Array),
      normBias: await fetchArray(resolveManifestFile(weightsByRole[`pixel-decoder-stage-${stage}-norm-bias`].file), Float32Array),
    }))),
  } : null;
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
  const selectionShape = { layerCount: manifest.shape.layerCount, batch: manifest.shape.batch, queryTokens: manifest.shape.queryTokens, imageHeight: manifest.sourceImage?.resolution?.[1] || manifest.shape.maskHeight, imageWidth: manifest.sourceImage?.resolution?.[0] || manifest.shape.maskWidth, scoreThreshold: manifest.postprocess?.scoreThreshold ?? 0.5, nmsIouThreshold: manifest.postprocess?.nmsIouThreshold ?? 1 };
  const patchEmbedShape = includeImagePatchEmbed ? imagePatchEmbedShape(manifest) : null;
  const vitPrefixShape = includeImageVitPrefix ? imageVitPrefixShape(manifest) : null;
  const vitFirstBlockShape = includeImageVitFirstBlock ? imageVitFirstBlockShape(manifest) : null;
  const vitBlockStackShape = includeImageVitBlockStack ? imageVitBlockStackShape(manifest) : null;
  const fpnNeckShape = includeImageFpnNeck ? imageFpnNeckShape(manifest) : null;
  const promptShape = includeImageFpnNeck ? { batch: manifest.shape.batch, spatialTokens: manifest.shape.spatialTokens, promptTokens: manifest.shape.promptTokens, channels: manifest.shape.channels, heads: manifest.shape.heads, height: manifest.shape.height, width: manifest.shape.width } : null;
  const pixelShape = includeImageFpnNeck ? { batch: manifest.shape.batch, channels: manifest.shape.channels, groups: manifest.shape.groups || 8, levels: manifest.shape.levels || manifest.shape.fpnNeckLevels } : null;
  const effectiveExpectedPixelEmbed = expectedBrowserPixelEmbed || pixelEmbed;
  let browserPromptInputIds = null;
  let browserPromptAttentionMask = null;
  let browserPromptTokenizerEvidence = null;
  if (includeImageFpnNeck) {
    const tokenizerContract = manifest.promptTokenizer;
    if (!tokenizerContract || tokenizerContract.runtimeOwner !== 'browser') {
      throw new Error('manifest missing browser-owned SAM3 prompt tokenizer contract');
    }
    const [tokenizerVocabText, tokenizerMergesText] = await Promise.all([
      fetchText(resolveManifestFile(tokenizerContract.vocab.file)),
      fetchText(resolveManifestFile(tokenizerContract.merges.file)),
    ]);
    const [effectiveVocabSha256, effectiveMergesSha256] = await Promise.all([
      sha256Text(tokenizerVocabText),
      sha256Text(tokenizerMergesText),
    ]);
    if (effectiveVocabSha256 !== tokenizerContract.vocab.sha256 || effectiveMergesSha256 !== tokenizerContract.merges.sha256) {
      throw new Error(`SAM3 tokenizer asset hash mismatch: vocab ${effectiveVocabSha256} != ${tokenizerContract.vocab.sha256}; merges ${effectiveMergesSha256} != ${tokenizerContract.merges.sha256}`);
    }
    const tokenizerVocab = JSON.parse(tokenizerVocabText);
    const tokenizer = createSam3ClipTokenizer({
      vocab: tokenizerVocab,
      merges: parseSam3ClipMerges(tokenizerMergesText),
      contextLength: tokenizerContract.contextLength,
      bosTokenId: tokenizerContract.bosTokenId,
      eosTokenId: tokenizerContract.eosTokenId,
      padTokenId: tokenizerContract.padTokenId,
    });
    const prompts = manifest.prompt?.texts || [manifest.prompt?.text];
    const browserTokens = tokenizer.tokenizeBatch(prompts);
    browserPromptInputIds = browserTokens.inputIds;
    browserPromptAttentionMask = browserTokens.attentionMask;
    const promptTokenIdMismatchCount = mismatchCount(referencePromptInputIds, browserPromptInputIds);
    const promptAttentionMaskMismatchCount = mismatchCount(referencePromptAttentionMask, browserPromptAttentionMask);
    browserPromptTokenizerEvidence = {
      schema: 'kaminos.sam3-browser-prompt-tokenizer-evidence.v0',
      runtimeOwner: 'browser',
      boundary: 'prompt-text-to-browser-owned-clip-token-tensors',
      promptSha256: manifest.prompt?.sha256 || null,
      normalizedPrompts: browserTokens.normalizedPrompts,
      validLengths: browserTokens.validLengths,
      shape: browserTokens.shape,
      contextLength: tokenizer.contextLength,
      bosTokenId: tokenizer.bosTokenId,
      eosTokenId: tokenizer.eosTokenId,
      padTokenId: tokenizer.padTokenId,
      vocab: tokenizerContract.vocab,
      merges: tokenizerContract.merges,
      effectiveVocabSha256,
      effectiveMergesSha256,
      inputIdsSha256: await sha256TypedArray(browserPromptInputIds),
      attentionMaskSha256: await sha256TypedArray(browserPromptAttentionMask),
      referenceInputIdsSha256: promptInputIdsTensor.sha256,
      referenceAttentionMaskSha256: promptAttentionMaskTensor.sha256,
      promptTokenIdMismatchCount,
      promptAttentionMaskMismatchCount,
    };
  }
  const maskOracle = createSam3MaskTailPhaseProgramCpuOracle({ lastHs: expectedLastHs, pixelEmbed: effectiveExpectedPixelEmbed, weights: tailWeights, shape: maskTailShape });
  const patchEmbedOracle = includeImagePatchEmbed ? createSam3ImagePatchEmbedPhaseProgramCpuOracle({ pixelValues: expectedPixelValues, weights: { projection: patchProjectionWeight }, shape: patchEmbedShape }) : null;
  const vitPrefixOracle = includeImageVitPrefix ? createSam3ImageVitPrefixPhaseProgramCpuOracle({ patchEmbeddings: expectedPatchEmbeddings, weights: vitPrefixWeights, shape: vitPrefixShape }) : null;
  const vitFirstBlockOracle = includeImageVitFirstBlock ? createSam3ImageVitFirstBlockPhaseProgramCpuOracle({ hiddenStates: expectedVitPrefixHiddenStates, weights: vitFirstBlockWeights, shape: vitFirstBlockShape }) : null;
  const vitBlockStackOracle = includeImageVitBlockStack ? createSam3ImageVitBlockStackPhaseProgramCpuOracle({ hiddenStates: expectedVitPrefixHiddenStates, weights: vitBlockStackWeights, shape: vitBlockStackShape }) : null;
  const fpnNeckOracle = includeImageFpnNeck ? createSam3ImageFpnNeckPhaseProgramCpuOracle({ backboneHiddenStates: expectedVitBackboneHiddenStates, weights: fpnNeckWeights, shape: fpnNeckShape }) : null;
  const promptTextOracle = includeImageFpnNeck ? createSam3PromptTextIngressPhaseProgramCpuOracle({ inputIds: browserPromptInputIds, attentionMask: browserPromptAttentionMask, weights: promptTextWeights, shape: promptTextShape }) : null;
  const promptFpnOracle = includeImageFpnNeck ? createSam3PromptFpnPhaseProgramCpuOracle({ encoderHiddenStates: expectedEncoderHiddenStates, promptFeatures: expectedPromptFeatures, promptMask: expectedPromptMask, weights: promptWeights, shape: promptShape }) : null;
  const pixelDecoderOracle = includeImageFpnNeck ? createSam3PixelDecoderPhaseProgramCpuOracle({ features: [expectedFpnNeckFeature0, expectedFpnNeckFeature1, expectedPromptFpnFeature], weights: pixelWeights, shape: pixelShape }) : null;
  const scoringOracle = includeStackScoring ? createSam3ScoringPhaseProgramCpuOracle({ hiddenStates: expectedDecoderHiddenStates, promptFeatures, promptMask, weights: scoringWeights, shape: scoringShape }) : null;
  const selectionOracle = includeStackSelection ? createSam3SelectionPostprocessPhaseProgramCpuOracle({ predLogits: expectedPredLogits, referenceBoxes: expectedReferenceBoxes, presenceLogits: expectedPresenceLogits, shape: selectionShape }) : null;
  return {
    routeKind: includeImageFpnNeck ? 'image-fpn-neck-detector-stack-composition' : includeImageVitBlockStack ? (includeImageVitFullBackbone ? 'image-vit-backbone-detector-stack-composition' : 'image-vit-block-stack-detector-stack-composition') : includeImageVitFirstBlock ? 'image-vit-first-block-detector-stack-composition' : includeImageVitPrefix ? 'image-vit-prefix-detector-stack-composition' : includeImagePatchEmbed ? 'image-patch-embed-detector-stack-composition' : includeImagePreprocess ? 'image-preprocess-detector-stack-composition' : includeDetectorStack ? 'detector-stack-browser-local-composition' : includeStackSelection ? 'detr-encoder-detr-decoder-scoring-selection-mask-tail-composition' : includeStackScoring ? 'detr-encoder-detr-decoder-scoring-mask-tail-composition' : 'detr-encoder-detr-decoder-mask-tail-composition',
    detectorStackEvidence: includeDetectorStack ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.boundary,
      routeKind: includeImageFpnNeck ? 'image-fpn-neck-detector-stack-composition' : includeImageVitBlockStack ? (includeImageVitFullBackbone ? 'image-vit-backbone-detector-stack-composition' : 'image-vit-block-stack-detector-stack-composition') : includeImageVitFirstBlock ? 'image-vit-first-block-detector-stack-composition' : includeImageVitPrefix ? 'image-vit-prefix-detector-stack-composition' : includeImagePatchEmbed ? 'image-patch-embed-detector-stack-composition' : includeImagePreprocess ? 'image-preprocess-detector-stack-composition' : 'detector-stack-browser-local-composition',
      upstreamBoundaries: manifest.upstreamBoundaries || [],
      nonClaims: {
        fullSam3BrowserExecution: true,
        browserLocalVisionEncoder: true,
        browserLocalTextEncoder: true,
        originalImageResize: includeImagePreprocess ? false : true,
        nms: manifest.postprocess?.nms === false,
      },
    } : null,
    imagePreprocessEvidence: includeImagePreprocess ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.imagePreprocess?.boundary || manifest.boundary,
      routeKind: 'image-preprocess-detector-stack-composition',
      source: manifest.imagePreprocess?.source || 'browser-original-encoded-image-decode-resize',
      normalization: manifest.imagePreprocess?.normalization || null,
      nonClaims: {
        originalImageResize: false,
        browserLocalVisionEncoder: true,
        browserLocalTextEncoder: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    imagePatchEmbedEvidence: includeImagePatchEmbed ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.imagePatchEmbed?.boundary || manifest.boundary,
      routeKind: 'image-patch-embed-detector-stack-composition',
      source: manifest.imagePatchEmbed?.source || 'browser-local-normalized-pixel-values',
      projection: manifest.imagePatchEmbed?.projection || null,
      nonClaims: {
        originalImageResize: true,
        browserLocalViTBlocks: true,
        browserLocalFpnNeck: true,
        browserLocalTextEncoder: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    imageVitPrefixEvidence: includeImageVitPrefix ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.imageVitPrefix?.boundary || manifest.boundary,
      routeKind: 'image-vit-prefix-detector-stack-composition',
      source: manifest.imageVitPrefix?.source || 'browser-local-patch-embeddings',
      positionEmbeddings: manifest.imageVitPrefix?.positionEmbeddings || null,
      layerNorm: manifest.imageVitPrefix?.layerNorm || null,
      nonClaims: {
        originalImageResize: true,
        browserLocalViTBlocks: true,
        browserLocalFpnNeck: true,
        browserLocalTextEncoder: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    imageVitFirstBlockEvidence: includeImageVitFirstBlock ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.imageVitFirstBlock?.boundary || manifest.boundary,
      routeKind: 'image-vit-first-block-detector-stack-composition',
      source: manifest.imageVitFirstBlock?.source || 'browser-local-vit-prefix-hidden-states',
      windowPartition: manifest.imageVitFirstBlock?.windowPartition || null,
      ropeWindow: manifest.imageVitFirstBlock?.ropeWindow || null,
      layerNorm: manifest.imageVitFirstBlock?.layerNorm || null,
      mlp: manifest.imageVitFirstBlock?.mlp || null,
      nonClaims: {
        remainingViTBlocks: true,
        browserLocalFpnNeck: true,
        browserLocalTextEncoder: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    imageVitBlockStackEvidence: includeImageVitBlockStack ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.imageVitBlockStack?.boundary || manifest.boundary,
      routeKind: manifest.imageVitBlockStack?.routeKind || (includeImageVitFullBackbone ? 'image-vit-backbone-detector-stack-composition' : 'image-vit-block-stack-detector-stack-composition'),
      source: manifest.imageVitBlockStack?.source || 'browser-local-vit-prefix-hidden-states',
      layerRange: manifest.imageVitBlockStack?.layerRange || null,
      windowPartition: manifest.imageVitBlockStack?.windowPartition || null,
      globalAttention: manifest.imageVitBlockStack?.globalAttention || null,
      rope: manifest.imageVitBlockStack?.rope || null,
      layerNorm: manifest.imageVitBlockStack?.layerNorm || null,
      mlp: manifest.imageVitBlockStack?.mlp || null,
      firstGlobalLayerIndex: vitBlockStackShape.firstGlobalLayerIndex,
      finalLayerIndex: vitBlockStackShape.finalLayerIndex,
      fullBackbone: vitBlockStackShape.fullBackbone,
      nonClaims: {
        remainingViTBlocks: !vitBlockStackShape.fullBackbone,
        browserLocalFpnNeck: true,
        browserProducedDetrFpnInputs: true,
        browserLocalTextEncoder: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    imageFpnNeckEvidence: includeImageFpnNeck ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.imageFpnNeck?.boundary || manifest.boundary,
      routeKind: manifest.imageFpnNeck?.routeKind || 'image-fpn-neck-detector-stack-composition',
      source: manifest.imageFpnNeck?.source || 'browser-local-vit-backbone-hidden-states',
      levels: manifest.imageFpnNeck?.levels || fpnNeckShape.levels,
      scaleLayers: manifest.imageFpnNeck?.scaleLayers || null,
      projection: manifest.imageFpnNeck?.projection || null,
      nonClaims: {
        level3DetectorConsumption: true,
        browserLocalTextEncoder: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    browserFpnDetrIngressEvidence: includeImageFpnNeck ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: 'sam3-browser-local-fpn-neck-detr-image-ingress',
      routeKind: 'image-fpn-neck-detr-image-ingress-composition',
      encoderSrcSource: 'browser-fpn-neck-feature-2',
      encoderPosSource: 'browser-position-embedding-sine',
      textTensorOwner: 'browser-local-prompt-text-ingress',
      nonClaims: {
        browserTokenizer: false,
        level3DetectorConsumption: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    browserPromptTokenizerEvidence,
    browserPromptTextEvidence: includeImageFpnNeck ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: manifest.promptTextIngress?.boundary || 'sam3-prompt-input-ids-to-projected-text-features-phase-program',
      routeKind: manifest.promptTextIngress?.routeKind || 'prompt-text-ingress-detector-stack-composition',
      source: manifest.promptTextIngress?.source || 'browser-owned-sam3-clip-tokenizer-tensors',
      textEncoder: manifest.promptTextIngress?.textEncoder || null,
      promptFeaturesOwner: 'browser-local-prompt-text-ingress',
      promptMaskOwner: 'browser-local-prompt-text-ingress',
      nonClaims: {
        browserTokenizer: false,
        level3DetectorConsumption: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    browserPromptFpnPixelEvidence: includeImageFpnNeck ? {
      packetMode: manifest.mode,
      schema: manifest.schema,
      boundary: 'sam3-browser-local-prompt-fpn-pixel-decoder',
      routeKind: 'image-fpn-neck-prompt-fpn-pixel-decoder-composition',
      promptTensorOwner: 'browser-local-prompt-text-ingress',
      fpnTensorOwner: 'browser-local-image-fpn-neck',
      pixelEmbedOwner: 'browser-local-pixel-decoder',
      nonClaims: {
        browserTokenizer: false,
        level3DetectorConsumption: true,
        fullSam3BrowserExecution: true,
      },
    } : null,
    expectedPixelValues,
    expectedPatchEmbeddings,
    expectedVitPrefixHiddenStates,
      expectedVitFirstBlockHiddenStates,
      expectedVitFirstGlobalHiddenStates,
      expectedVitBlockStackHiddenStates,
      expectedVitBackboneHiddenStates,
      expectedVitLayerCheckpoints,
    expectedFpnNeckFeature0,
    expectedFpnNeckFeature1,
    expectedFpnNeckFeature2,
    expectedFpnNeckFeature3,
    browserPromptInputIds,
    browserPromptAttentionMask,
    expectedPromptFeatures,
    expectedPromptMask,
    expectedPromptFpnFeature,
    expectedPixelEmbed: effectiveExpectedPixelEmbed,
    expectedEncoderSrc: encoderSrc,
    expectedEncoderPos: encoderPos,
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
      patchEmbeddingsMaxAbsDiff: patchEmbedOracle ? maxAbsDiff(expectedPatchEmbeddings, patchEmbedOracle.patchEmbeddings) : undefined,
      vitPrefixHiddenStatesMaxAbsDiff: vitPrefixOracle ? maxAbsDiff(expectedVitPrefixHiddenStates, vitPrefixOracle.vitPrefixHiddenStates) : undefined,
      vitFirstBlockHiddenStatesMaxAbsDiff: vitFirstBlockOracle ? maxAbsDiff(expectedVitFirstBlockHiddenStates, vitFirstBlockOracle.vitFirstBlockHiddenStates) : undefined,
      vitFirstGlobalHiddenStatesMaxAbsDiff: vitBlockStackOracle ? maxAbsDiff(expectedVitFirstGlobalHiddenStates, vitBlockStackOracle.layerCheckpoints.find(entry => entry.layerIndex === vitBlockStackShape.firstGlobalLayerIndex)?.hiddenStates || vitBlockStackOracle.vitBlockStackHiddenStates) : undefined,
      vitBlockStackHiddenStatesMaxAbsDiff: vitBlockStackOracle ? maxAbsDiff(expectedVitBlockStackHiddenStates, vitBlockStackOracle.vitBlockStackHiddenStates) : undefined,
      vitBackboneHiddenStatesMaxAbsDiff: includeImageVitFullBackbone && vitBlockStackOracle ? maxAbsDiff(expectedVitBackboneHiddenStates, vitBlockStackOracle.vitBlockStackHiddenStates) : undefined,
      fpnNeckFeature0MaxAbsDiff: fpnNeckOracle ? maxAbsDiff(expectedFpnNeckFeature0, fpnNeckOracle.fpnNeckFeatures[0]) : undefined,
      fpnNeckFeature1MaxAbsDiff: fpnNeckOracle ? maxAbsDiff(expectedFpnNeckFeature1, fpnNeckOracle.fpnNeckFeatures[1]) : undefined,
      fpnNeckFeature2MaxAbsDiff: fpnNeckOracle ? maxAbsDiff(expectedFpnNeckFeature2, fpnNeckOracle.fpnNeckFeatures[2]) : undefined,
      fpnNeckFeature3MaxAbsDiff: fpnNeckOracle ? maxAbsDiff(expectedFpnNeckFeature3, fpnNeckOracle.fpnNeckFeatures[3]) : undefined,
      promptTextMaxAbsDiff: promptTextOracle ? maxAbsDiff(expectedPromptFeatures, promptTextOracle.promptFeatures) : undefined,
      promptMaskMaxAbsDiff: promptTextOracle ? maxAbsDiff(expectedPromptMask, promptTextOracle.promptMask) : undefined,
      promptFpnMaxAbsDiff: promptFpnOracle ? maxAbsDiff(expectedPromptFpnFeature, promptFpnOracle.promptFpnFeature) : undefined,
      pixelEmbedMaxAbsDiff: pixelDecoderOracle ? maxAbsDiff(effectiveExpectedPixelEmbed, pixelDecoderOracle.pixelEmbed) : undefined,
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
      expectedPatchEmbeddingsSha256: expectedPatchEmbeddingsTensor?.sha256,
      expectedVitPrefixHiddenStatesSha256: expectedVitPrefixTensor?.sha256,
      expectedVitFirstBlockHiddenStatesSha256: expectedVitFirstBlockTensor?.sha256,
      expectedVitFirstGlobalHiddenStatesSha256: expectedVitFirstGlobalTensor?.sha256,
      expectedVitBlockStackHiddenStatesSha256: expectedVitBlockStackTensor?.sha256,
      expectedVitBackboneHiddenStatesSha256: expectedVitBackboneTensor?.sha256,
      expectedFpnNeckFeature0Sha256: expectedFpnNeckFeature0Tensor?.sha256,
      expectedFpnNeckFeature1Sha256: expectedFpnNeckFeature1Tensor?.sha256,
      expectedFpnNeckFeature2Sha256: expectedFpnNeckFeature2Tensor?.sha256,
      expectedFpnNeckFeature3Sha256: expectedFpnNeckFeature3Tensor?.sha256,
      promptInputIdsSha256: promptInputIdsTensor?.sha256,
      promptAttentionMaskSha256: promptAttentionMaskTensor?.sha256,
      expectedPromptFeaturesSha256: expectedPromptFeaturesTensor?.sha256,
      expectedPromptMaskSha256: expectedPromptMaskTensor?.sha256,
      expectedPromptFpnFeatureSha256: expectedPromptFpnTensor?.sha256,
      expectedPixelEmbedSha256: expectedPixelEmbedTensor?.sha256,
      patchProjectionWeightSha256: weightsByRole['patch-embed-projection-weight']?.sha256,
      positionEmbeddingsSha256: weightsByRole['vit-position-embeddings']?.sha256,
      backboneLayerNormWeightSha256: weightsByRole['vit-backbone-layernorm-weight']?.sha256,
      backboneLayerNormBiasSha256: weightsByRole['vit-backbone-layernorm-bias']?.sha256,
      firstBlockWeightsSha256: includeImageVitFirstBlock ? await aggregateTensorBundleSha256('sam3-image-vit-first-block-weights', vitFirstBlockWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 }))) : undefined,
      blockStackWeightsSha256: includeImageVitBlockStack ? await aggregateTensorBundleSha256('sam3-image-vit-block-stack-weights', vitBlockStackWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 }))) : undefined,
      fpnNeckWeightsSha256: includeImageFpnNeck ? await aggregateTensorBundleSha256('sam3-image-fpn-neck-weights', fpnNeckWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 }))) : undefined,
      promptTextWeightsSha256: includeImageFpnNeck ? await aggregateTensorBundleSha256('sam3-prompt-text-weights', promptTextWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 }))) : undefined,
      promptFpnWeightsSha256: includeImageFpnNeck ? await aggregateTensorBundleSha256('sam3-prompt-fpn-weights', promptWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 }))) : undefined,
      pixelDecoderWeightsSha256: includeImageFpnNeck ? await aggregateTensorBundleSha256('sam3-pixel-decoder-weights', pixelWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 }))) : undefined,
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
      let imagePatchEmbedResult = null;
      let gpuPatchEmbeddings = null;
      let patchEmbeddingsOutput = null;
      let patchEmbeddingsTensorSha256 = null;
      let imagePatchEmbedCpuMaxAbsDiff = undefined;
      let imageVitPrefixResult = null;
      let gpuVitPrefixHiddenStates = null;
      let vitPrefixHiddenStatesOutput = null;
      let vitPrefixHiddenStatesTensorSha256 = null;
      let imageVitPrefixCpuMaxAbsDiff = undefined;
      let imageVitFirstBlockResult = null;
      let gpuVitFirstBlockHiddenStates = null;
      let vitFirstBlockHiddenStatesOutput = null;
      let vitFirstBlockHiddenStatesTensorSha256 = null;
      let firstBlockWeightsSha256 = null;
      let imageVitFirstBlockCpuMaxAbsDiff = undefined;
      let imageVitBlockStackResult = null;
      let gpuVitBlockStackHiddenStates = null;
      let vitBlockStackHiddenStatesOutput = null;
      let vitBlockStackHiddenStatesTensorSha256 = null;
      let blockStackWeightsSha256 = null;
      let imageVitBlockStackCpuMaxAbsDiff = undefined;
      let vitFirstGlobalHiddenStatesMaxAbsDiff = undefined;
      let imageFpnNeckResult = null;
      let gpuFpnNeckFeature0 = null;
      let gpuFpnNeckFeature1 = null;
      let gpuFpnNeckFeature2 = null;
      let gpuFpnNeckFeature3 = null;
      let fpnNeckFeature0Output = null;
      let fpnNeckFeature1Output = null;
      let fpnNeckFeature2Output = null;
      let fpnNeckFeature3Output = null;
      let fpnNeckFeature0TensorSha256 = null;
      let fpnNeckFeature1TensorSha256 = null;
      let fpnNeckFeature2TensorSha256 = null;
      let fpnNeckFeature3TensorSha256 = null;
      let fpnNeckWeightsSha256 = null;
      let imageFpnNeckCpuMaxAbsDiff = undefined;
      let browserFpnDetrIngress = null;
      let browserFpnDetrIngressEvidence = null;
      let promptTextResult = null;
      let gpuPromptFeatures = null;
      let gpuPromptMask = null;
      let promptFeaturesOutput = null;
      let promptMaskOutput = null;
      let promptTextTensorSha256 = null;
      let promptTextWeightsSha256 = null;
      let promptTextMaxAbsDiff = undefined;
      let promptMaskMaxAbsDiff = undefined;
      let effectivePromptFeatures = promptFeatures;
      let effectivePromptMask = promptMask;
      let effectivePromptFeaturesOutput = { artifactId: promptTensor.artifactId || 'sam3-prompt-features:mlx-reference-detector-stack', sha256: promptTensor.sha256, shape: promptTensor.shape };
      let effectivePromptMaskOutput = { artifactId: promptMaskTensor.artifactId || 'sam3-prompt-mask:mlx-reference-detector-stack', sha256: promptMaskTensor.sha256, shape: promptMaskTensor.shape };
      let effectiveEncoderSrc = encoderSrc;
      let effectiveEncoderPos = encoderPos;
      let effectiveEncoderSrcSha256 = encoderSrcTensor.sha256;
      let effectiveEncoderPosSha256 = encoderPosTensor.sha256;
      let detrImageIngressTensorSha256 = null;
      if (includeImagePreprocess) {
        setStatus('run-image-preprocess');
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
      if (includeImagePatchEmbed) {
        setStatus('run-image-patch-embed');
        const patchCpuOracle = createSam3ImagePatchEmbedPhaseProgramCpuOracle({ pixelValues: gpuPixelValues, weights: { projection: patchProjectionWeight }, shape: patchEmbedShape });
        imagePatchEmbedCpuMaxAbsDiff = maxAbsDiff(expectedPatchEmbeddings, patchCpuOracle.patchEmbeddings);
        patchEmbeddingsTensorSha256 = await aggregateTensorBundleSha256('sam3-image-patch-embed-composed-tensors', [
          { role: 'pixel-values', artifactId: pixelValuesOutput.artifactId, sha256: pixelValuesOutput.sha256, shape: pixelValuesOutput.shape },
          { role: 'patch-embed-projection-weight', sha256: weightsByRole['patch-embed-projection-weight'].sha256 },
        ]);
        const imagePatchEmbedRoute = createSam3ImagePatchEmbedPhaseProgramRouteDefinition({
          model: { revision: manifest.model?.id || 'mlx-reference-image-patch-embed', dtype: 'fp32' },
          kernel: { profile: 'sam3-image-patch-embed-phase-program-v0', commit: params.get('commit') || null },
        });
        const imagePatchEmbedRequest = createRouteInvocationRequest(imagePatchEmbedRoute, {
          requestId: `sam-browser-image-patch-embed-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'pixel-values': { artifactId: pixelValuesOutput.artifactId, sha256: pixelValuesOutput.sha256, shape: pixelValuesOutput.shape },
            'sam3-image-patch-embed-weights': { artifactId: manifest.staticWeights.artifactId, sha256: weightsByRole['patch-embed-projection-weight'].sha256 },
          },
          outputs: {
            'patch-embeddings': { artifactId: 'sam3-patch-embeddings:browser-detector-stack-composition', shape: [patchEmbedShape.batch, patchEmbedShape.patchHeight * patchEmbedShape.patchWidth, patchEmbedShape.hiddenSize] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', imagePatchEmbed: manifest.imagePatchEmbed || null, composedFrom: imagePreprocessResult.receipt?.effectiveRouteId, pixelValuesOutput },
        });
        imagePatchEmbedResult = await runSam3ImagePatchEmbedPhaseProgramRoute({ request: imagePatchEmbedRequest, route: imagePatchEmbedRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: imagePatchEmbedRoute.kernel, model: { revision: imagePatchEmbedRoute.model.revision, weightsHash: weightsByRole['patch-embed-projection-weight'].sha256, dtype: 'fp32' }, tensors: { pixelValues: gpuPixelValues, weights: { projection: patchProjectionWeight }, shape: patchEmbedShape }, includeReadback: true });
        gpuPatchEmbeddings = new Float32Array(imagePatchEmbedResult.debugReadback.patchEmbeddings);
        patchEmbeddingsOutput = imagePatchEmbedResult.receipt.outputs.find(output => output.role === 'patch-embeddings');
        if (!patchEmbeddingsOutput?.sha256 || !patchEmbeddingsOutput?.artifactId) throw new Error('SAM3 image patch-embed output identity missing');
      }
      if (includeImageVitPrefix) {
        setStatus('run-image-vit-prefix');
        const vitPrefixCpuOracle = createSam3ImageVitPrefixPhaseProgramCpuOracle({ patchEmbeddings: gpuPatchEmbeddings, weights: vitPrefixWeights, shape: vitPrefixShape });
        imageVitPrefixCpuMaxAbsDiff = maxAbsDiff(expectedVitPrefixHiddenStates, vitPrefixCpuOracle.vitPrefixHiddenStates);
        vitPrefixHiddenStatesTensorSha256 = await aggregateTensorBundleSha256('sam3-image-vit-prefix-composed-tensors', [
          { role: 'patch-embeddings', artifactId: patchEmbeddingsOutput.artifactId, sha256: patchEmbeddingsOutput.sha256, shape: patchEmbeddingsOutput.shape },
          { role: 'vit-position-embeddings', sha256: weightsByRole['vit-position-embeddings'].sha256 },
          { role: 'vit-backbone-layernorm-weight', sha256: weightsByRole['vit-backbone-layernorm-weight'].sha256 },
          { role: 'vit-backbone-layernorm-bias', sha256: weightsByRole['vit-backbone-layernorm-bias'].sha256 },
        ]);
        const imageVitPrefixRoute = createSam3ImageVitPrefixPhaseProgramRouteDefinition({
          model: { revision: manifest.model?.id || 'mlx-reference-image-vit-prefix', dtype: 'fp32' },
          kernel: { profile: 'sam3-image-vit-prefix-phase-program-v0', commit: params.get('commit') || null },
        });
        const imageVitPrefixRequest = createRouteInvocationRequest(imageVitPrefixRoute, {
          requestId: `sam-browser-image-vit-prefix-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'patch-embeddings': { artifactId: patchEmbeddingsOutput.artifactId, sha256: patchEmbeddingsOutput.sha256, shape: patchEmbeddingsOutput.shape },
            'sam3-image-vit-prefix-weights': { artifactId: manifest.staticWeights.artifactId, sha256: await aggregateTensorBundleSha256('sam3-image-vit-prefix-weights', [
              { role: 'vit-position-embeddings', sha256: weightsByRole['vit-position-embeddings'].sha256 },
              { role: 'vit-backbone-layernorm-weight', sha256: weightsByRole['vit-backbone-layernorm-weight'].sha256 },
              { role: 'vit-backbone-layernorm-bias', sha256: weightsByRole['vit-backbone-layernorm-bias'].sha256 },
            ]) },
          },
          outputs: {
            'vit-prefix-hidden-states': { artifactId: 'sam3-vit-prefix-hidden-states:browser-detector-stack-composition', shape: [vitPrefixShape.batch, vitPrefixShape.patchHeight, vitPrefixShape.patchWidth, vitPrefixShape.hiddenSize] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', imageVitPrefix: manifest.imageVitPrefix || null, composedFrom: imagePatchEmbedResult.receipt?.effectiveRouteId, patchEmbeddingsOutput },
        });
        imageVitPrefixResult = await runSam3ImageVitPrefixPhaseProgramRoute({ request: imageVitPrefixRequest, route: imageVitPrefixRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: imageVitPrefixRoute.kernel, model: { revision: imageVitPrefixRoute.model.revision, weightsHash: imageVitPrefixRequest.inputs.find(input => input.role === 'sam3-image-vit-prefix-weights')?.sha256, dtype: 'fp32' }, tensors: { patchEmbeddings: gpuPatchEmbeddings, weights: vitPrefixWeights, shape: vitPrefixShape }, includeReadback: true });
        gpuVitPrefixHiddenStates = new Float32Array(imageVitPrefixResult.debugReadback.vitPrefixHiddenStates);
        vitPrefixHiddenStatesOutput = imageVitPrefixResult.receipt.outputs.find(output => output.role === 'vit-prefix-hidden-states');
        if (!vitPrefixHiddenStatesOutput?.sha256 || !vitPrefixHiddenStatesOutput?.artifactId) throw new Error('SAM3 image ViT-prefix output identity missing');
      }
      if (includeImageVitFirstBlock) {
        setStatus('run-image-vit-first-block');
        const firstBlockCpuOracle = createSam3ImageVitFirstBlockPhaseProgramCpuOracle({ hiddenStates: gpuVitPrefixHiddenStates, weights: vitFirstBlockWeights, shape: vitFirstBlockShape });
        imageVitFirstBlockCpuMaxAbsDiff = maxAbsDiff(expectedVitFirstBlockHiddenStates, firstBlockCpuOracle.vitFirstBlockHiddenStates);
        firstBlockWeightsSha256 = await aggregateTensorBundleSha256('sam3-image-vit-first-block-weights', vitFirstBlockWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 })));
        vitFirstBlockHiddenStatesTensorSha256 = await aggregateTensorBundleSha256('sam3-image-vit-first-block-composed-tensors', [
          { role: 'vit-prefix-hidden-states', artifactId: vitPrefixHiddenStatesOutput.artifactId, sha256: vitPrefixHiddenStatesOutput.sha256, shape: vitPrefixHiddenStatesOutput.shape },
          ...vitFirstBlockWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 })),
        ]);
        const imageVitFirstBlockRoute = createSam3ImageVitFirstBlockPhaseProgramRouteDefinition({
          model: { revision: manifest.model?.id || 'mlx-reference-image-vit-first-block', dtype: 'fp32' },
          kernel: { profile: 'sam3-image-vit-first-block-phase-program-v0', commit: params.get('commit') || null },
        });
        const imageVitFirstBlockRequest = createRouteInvocationRequest(imageVitFirstBlockRoute, {
          requestId: `sam-browser-image-vit-first-block-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'vit-prefix-hidden-states': { artifactId: vitPrefixHiddenStatesOutput.artifactId, sha256: vitPrefixHiddenStatesOutput.sha256, shape: vitPrefixHiddenStatesOutput.shape },
            'sam3-image-vit-first-block-weights': { artifactId: manifest.staticWeights.artifactId, sha256: firstBlockWeightsSha256 },
          },
          outputs: {
            'vit-first-block-hidden-states': { artifactId: 'sam3-vit-first-block-hidden-states:browser-detector-stack-composition', shape: [vitFirstBlockShape.batch, vitFirstBlockShape.height, vitFirstBlockShape.width, vitFirstBlockShape.hiddenSize] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', imageVitFirstBlock: manifest.imageVitFirstBlock || null, composedFrom: imageVitPrefixResult.receipt?.effectiveRouteId, vitPrefixHiddenStatesOutput },
        });
        imageVitFirstBlockResult = await runSam3ImageVitFirstBlockPhaseProgramRoute({ request: imageVitFirstBlockRequest, route: imageVitFirstBlockRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: imageVitFirstBlockRoute.kernel, model: { revision: imageVitFirstBlockRoute.model.revision, weightsHash: imageVitFirstBlockRequest.inputs.find(input => input.role === 'sam3-image-vit-first-block-weights')?.sha256, dtype: 'fp32' }, tensors: { hiddenStates: gpuVitPrefixHiddenStates, weights: vitFirstBlockWeights, shape: vitFirstBlockShape }, includeReadback: true });
        gpuVitFirstBlockHiddenStates = new Float32Array(imageVitFirstBlockResult.debugReadback.vitFirstBlockHiddenStates);
        vitFirstBlockHiddenStatesOutput = imageVitFirstBlockResult.receipt.outputs.find(output => output.role === 'vit-first-block-hidden-states');
        if (!vitFirstBlockHiddenStatesOutput?.sha256 || !vitFirstBlockHiddenStatesOutput?.artifactId) throw new Error('SAM3 image ViT first-block output identity missing');
      }
      if (includeImageVitBlockStack) {
        setStatus('run-image-vit-block-stack');
        const blockStackCpuOracle = createSam3ImageVitBlockStackPhaseProgramCpuOracle({ hiddenStates: gpuVitPrefixHiddenStates, weights: vitBlockStackWeights, shape: vitBlockStackShape });
        imageVitBlockStackCpuMaxAbsDiff = maxAbsDiff(expectedVitBlockStackHiddenStates, blockStackCpuOracle.vitBlockStackHiddenStates);
        const firstGlobalCheckpoint = blockStackCpuOracle.layerCheckpoints.find(entry => entry.layerIndex === vitBlockStackShape.firstGlobalLayerIndex);
        vitFirstGlobalHiddenStatesMaxAbsDiff = maxAbsDiff(expectedVitFirstGlobalHiddenStates, firstGlobalCheckpoint?.hiddenStates || blockStackCpuOracle.vitBlockStackHiddenStates);
        blockStackWeightsSha256 = await aggregateTensorBundleSha256('sam3-image-vit-block-stack-weights', vitBlockStackWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 })));
        vitBlockStackHiddenStatesTensorSha256 = await aggregateTensorBundleSha256('sam3-image-vit-block-stack-composed-tensors', [
          { role: 'vit-prefix-hidden-states', artifactId: vitPrefixHiddenStatesOutput.artifactId, sha256: vitPrefixHiddenStatesOutput.sha256, shape: vitPrefixHiddenStatesOutput.shape },
          ...vitBlockStackWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 })),
        ]);
        const imageVitBlockStackRoute = createSam3ImageVitBlockStackPhaseProgramRouteDefinition({
          model: { revision: manifest.model?.id || 'mlx-reference-image-vit-block-stack', dtype: 'fp32' },
          kernel: { profile: 'sam3-image-vit-block-stack-phase-program-v0', commit: params.get('commit') || null },
        });
        const imageVitBlockStackRequest = createRouteInvocationRequest(imageVitBlockStackRoute, {
          requestId: `sam-browser-image-vit-block-stack-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'vit-prefix-hidden-states': { artifactId: vitPrefixHiddenStatesOutput.artifactId, sha256: vitPrefixHiddenStatesOutput.sha256, shape: vitPrefixHiddenStatesOutput.shape },
            'sam3-image-vit-block-stack-weights': { artifactId: manifest.staticWeights.artifactId, sha256: blockStackWeightsSha256 },
          },
          outputs: {
            'vit-block-stack-hidden-states': { artifactId: 'sam3-vit-block-stack-hidden-states:browser-detector-stack-composition', shape: [vitBlockStackShape.batch, vitBlockStackShape.height, vitBlockStackShape.width, vitBlockStackShape.hiddenSize] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', imageVitBlockStack: manifest.imageVitBlockStack || null, composedFrom: imageVitPrefixResult.receipt?.effectiveRouteId, vitPrefixHiddenStatesOutput, firstGlobalLayerIndex: vitBlockStackShape.firstGlobalLayerIndex },
        });
        imageVitBlockStackResult = await runSam3ImageVitBlockStackPhaseProgramRoute({ request: imageVitBlockStackRequest, route: imageVitBlockStackRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: imageVitBlockStackRoute.kernel, model: { revision: imageVitBlockStackRoute.model.revision, weightsHash: imageVitBlockStackRequest.inputs.find(input => input.role === 'sam3-image-vit-block-stack-weights')?.sha256, dtype: 'fp32' }, tensors: { hiddenStates: gpuVitPrefixHiddenStates, weights: vitBlockStackWeights, shape: vitBlockStackShape }, expectedLayerCheckpoints: expectedVitLayerCheckpoints, includeReadback: true, validateFiniteCheckpoints: true, validateFinitePhaseLayerIndex: vitFinitePhaseLayerIndex });
        gpuVitBlockStackHiddenStates = new Float32Array(imageVitBlockStackResult.debugReadback.vitBlockStackHiddenStates);
        vitBlockStackHiddenStatesOutput = imageVitBlockStackResult.receipt.outputs.find(output => output.role === 'vit-block-stack-hidden-states');
        if (!vitBlockStackHiddenStatesOutput?.sha256 || !vitBlockStackHiddenStatesOutput?.artifactId) throw new Error('SAM3 image ViT block-stack output identity missing');
      }
      if (includeImageFpnNeck) {
        setStatus('run-image-fpn-neck');
        const fpnCpuOracle = createSam3ImageFpnNeckPhaseProgramCpuOracle({ backboneHiddenStates: gpuVitBlockStackHiddenStates, weights: fpnNeckWeights, shape: fpnNeckShape });
        imageFpnNeckCpuMaxAbsDiff = Math.max(
          maxAbsDiff(expectedFpnNeckFeature0, fpnCpuOracle.fpnNeckFeatures[0]),
          maxAbsDiff(expectedFpnNeckFeature1, fpnCpuOracle.fpnNeckFeatures[1]),
          maxAbsDiff(expectedFpnNeckFeature2, fpnCpuOracle.fpnNeckFeatures[2]),
          maxAbsDiff(expectedFpnNeckFeature3, fpnCpuOracle.fpnNeckFeatures[3]),
        );
        fpnNeckWeightsSha256 = await aggregateTensorBundleSha256('sam3-image-fpn-neck-weights', fpnNeckWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 })));
        fpnNeckFeature0TensorSha256 = await aggregateTensorBundleSha256('sam3-image-fpn-neck-feature0-composed-tensors', [
          { role: 'vit-backbone-hidden-states', artifactId: vitBlockStackHiddenStatesOutput.artifactId, sha256: vitBlockStackHiddenStatesOutput.sha256, shape: vitBlockStackHiddenStatesOutput.shape },
          { role: 'fpn-neck-weights', sha256: fpnNeckWeightsSha256 },
        ]);
        fpnNeckFeature1TensorSha256 = fpnNeckFeature0TensorSha256;
        fpnNeckFeature2TensorSha256 = fpnNeckFeature0TensorSha256;
        fpnNeckFeature3TensorSha256 = fpnNeckFeature0TensorSha256;
        const imageFpnNeckRoute = createSam3ImageFpnNeckPhaseProgramRouteDefinition({
          model: { revision: manifest.model?.id || 'mlx-reference-image-fpn-neck', dtype: 'fp32' },
          kernel: { profile: 'sam3-image-fpn-neck-phase-program-v0', commit: params.get('commit') || null },
        });
        const imageFpnNeckRequest = createRouteInvocationRequest(imageFpnNeckRoute, {
          requestId: `sam-browser-image-fpn-neck-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'vit-backbone-hidden-states': { artifactId: vitBlockStackHiddenStatesOutput.artifactId, sha256: vitBlockStackHiddenStatesOutput.sha256, shape: vitBlockStackHiddenStatesOutput.shape },
            'sam3-image-fpn-neck-weights': { artifactId: manifest.staticWeights.artifactId, sha256: fpnNeckWeightsSha256 },
          },
          outputs: {
            'fpn-neck-feature-0': { artifactId: 'sam3-fpn-neck-feature-0:browser-detector-stack-composition', shape: [fpnNeckShape.batch, fpnNeckShape.levels[0].height, fpnNeckShape.levels[0].width, fpnNeckShape.fpnHiddenSize] },
            'fpn-neck-feature-1': { artifactId: 'sam3-fpn-neck-feature-1:browser-detector-stack-composition', shape: [fpnNeckShape.batch, fpnNeckShape.levels[1].height, fpnNeckShape.levels[1].width, fpnNeckShape.fpnHiddenSize] },
            'fpn-neck-feature-2': { artifactId: 'sam3-fpn-neck-feature-2:browser-detector-stack-composition', shape: [fpnNeckShape.batch, fpnNeckShape.levels[2].height, fpnNeckShape.levels[2].width, fpnNeckShape.fpnHiddenSize] },
            'fpn-neck-feature-3': { artifactId: 'sam3-fpn-neck-feature-3:browser-detector-stack-composition', shape: [fpnNeckShape.batch, fpnNeckShape.levels[3].height, fpnNeckShape.levels[3].width, fpnNeckShape.fpnHiddenSize] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', imageFpnNeck: manifest.imageFpnNeck || null, composedFrom: imageVitBlockStackResult.receipt?.effectiveRouteId, vitBlockStackHiddenStatesOutput },
        });
        imageFpnNeckResult = await runSam3ImageFpnNeckPhaseProgramRoute({ request: imageFpnNeckRequest, route: imageFpnNeckRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: imageFpnNeckRoute.kernel, model: { revision: imageFpnNeckRoute.model.revision, weightsHash: imageFpnNeckRequest.inputs.find(input => input.role === 'sam3-image-fpn-neck-weights')?.sha256, dtype: 'fp32' }, tensors: { backboneHiddenStates: gpuVitBlockStackHiddenStates, weights: fpnNeckWeights, shape: fpnNeckShape }, includeReadback: true });
        gpuFpnNeckFeature0 = new Float32Array(imageFpnNeckResult.debugReadback.fpnNeckFeature0);
        gpuFpnNeckFeature1 = new Float32Array(imageFpnNeckResult.debugReadback.fpnNeckFeature1);
        gpuFpnNeckFeature2 = new Float32Array(imageFpnNeckResult.debugReadback.fpnNeckFeature2);
        gpuFpnNeckFeature3 = new Float32Array(imageFpnNeckResult.debugReadback.fpnNeckFeature3);
        fpnNeckFeature0Output = imageFpnNeckResult.receipt.outputs.find(output => output.role === 'fpn-neck-feature-0');
        fpnNeckFeature1Output = imageFpnNeckResult.receipt.outputs.find(output => output.role === 'fpn-neck-feature-1');
        fpnNeckFeature2Output = imageFpnNeckResult.receipt.outputs.find(output => output.role === 'fpn-neck-feature-2');
        fpnNeckFeature3Output = imageFpnNeckResult.receipt.outputs.find(output => output.role === 'fpn-neck-feature-3');
        if (!fpnNeckFeature0Output?.sha256 || !fpnNeckFeature1Output?.sha256 || !fpnNeckFeature2Output?.sha256 || !fpnNeckFeature3Output?.sha256) throw new Error('SAM3 image FPN-neck output identity missing');
        browserFpnDetrIngress = createSam3DetrImageIngressFromFpnFeatures({
          fpnNeckFeatures: [gpuFpnNeckFeature0, gpuFpnNeckFeature1, gpuFpnNeckFeature2, gpuFpnNeckFeature3],
          levels: fpnNeckShape.levels.map(level => ({ ...level, batch: fpnNeckShape.batch })),
          sourceLevel: 2,
          channels: manifest.shape.channels,
        });
        effectiveEncoderSrc = browserFpnDetrIngress.encoderSrc;
        effectiveEncoderPos = browserFpnDetrIngress.encoderPos;
        effectiveEncoderSrcSha256 = fpnNeckFeature2Output.sha256;
        effectiveEncoderPosSha256 = await sha256TypedArray(effectiveEncoderPos);
        promptTextWeightsSha256 = await aggregateTensorBundleSha256('sam3-prompt-text-weights', promptTextWeightRoles.map(role => ({ role, sha256: weightsByRole[role].sha256 })));
        promptTextTensorSha256 = await aggregateTensorBundleSha256('sam3-prompt-text-tensors:browser-image-fpn-detector-stack', [
          { role: 'browser-prompt-input-ids', sha256: browserPromptTokenizerEvidence.inputIdsSha256, shape: promptInputIdsTensor.shape },
          { role: 'browser-prompt-attention-mask', sha256: browserPromptTokenizerEvidence.attentionMaskSha256, shape: promptAttentionMaskTensor.shape },
          { role: 'prompt-tokenizer-vocab', sha256: browserPromptTokenizerEvidence.vocab.sha256 },
          { role: 'prompt-tokenizer-merges', sha256: browserPromptTokenizerEvidence.merges.sha256 },
        ]);
        const promptTextRoute = createSam3PromptTextIngressPhaseProgramRouteDefinition({
          model: { revision: manifest.model?.id || 'mlx-reference-prompt-text-ingress', dtype: 'fp32' },
          kernel: { profile: 'sam3-prompt-text-ingress-phase-program-v0', commit: params.get('commit') || null },
        });
        setStatus('run-prompt-text-ingress');
        const promptTextRequest = createRouteInvocationRequest(promptTextRoute, {
          requestId: `sam-browser-prompt-text-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'sam3-prompt-text-tensors': { artifactId: 'sam3-prompt-text-tensors:browser-image-fpn-detector-stack-composition', sha256: promptTextTensorSha256 },
            'sam3-prompt-text-weights': { artifactId: manifest.staticWeights.artifactId, sha256: promptTextWeightsSha256 },
          },
          outputs: {
            'prompt-features': { artifactId: 'sam3-prompt-features:browser-image-fpn-detector-stack-composition', shape: [promptTextShape.batch, promptTextShape.promptTokens, promptTextShape.channels] },
            'prompt-mask': { artifactId: 'sam3-prompt-mask:browser-image-fpn-detector-stack-composition', shape: [promptTextShape.batch, promptTextShape.promptTokens] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, promptTextIngress: manifest.promptTextIngress || null },
        });
        promptTextResult = await runSam3PromptTextIngressPhaseProgramRoute({ request: promptTextRequest, route: promptTextRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: promptTextRoute.kernel, model: { revision: promptTextRoute.model.revision, weightsHash: promptTextWeightsSha256, dtype: 'fp32' }, tensors: { inputIds: browserPromptInputIds, attentionMask: browserPromptAttentionMask, weights: promptTextWeights, shape: promptTextShape }, includeReadback: true });
        gpuPromptFeatures = new Float32Array(promptTextResult.debugReadback.promptFeatures);
        gpuPromptMask = new Float32Array(promptTextResult.debugReadback.promptMask);
        promptFeaturesOutput = promptTextResult.receipt.outputs.find(output => output.role === 'prompt-features');
        promptMaskOutput = promptTextResult.receipt.outputs.find(output => output.role === 'prompt-mask');
        if (!promptFeaturesOutput?.sha256 || !promptFeaturesOutput?.artifactId || !promptMaskOutput?.sha256 || !promptMaskOutput?.artifactId) throw new Error('SAM3 prompt/text ingress output identity missing');
        promptTextMaxAbsDiff = maxAbsDiff(expectedPromptFeatures, gpuPromptFeatures);
        promptMaskMaxAbsDiff = maxAbsDiff(expectedPromptMask, gpuPromptMask);
        effectivePromptFeatures = gpuPromptFeatures;
        effectivePromptMask = gpuPromptMask;
        effectivePromptFeaturesOutput = promptFeaturesOutput;
        effectivePromptMaskOutput = promptMaskOutput;
        detrImageIngressTensorSha256 = await aggregateTensorBundleSha256('sam3-detr-encoder-tensors:browser-fpn-image-ingress', [
          { role: 'encoder-src', artifactId: fpnNeckFeature2Output.artifactId, sha256: effectiveEncoderSrcSha256, shape: fpnNeckFeature2Output.shape },
          { role: 'encoder-pos', artifactId: 'sam3-detr-encoder-pos:browser-position-embedding-sine', sha256: effectiveEncoderPosSha256, shape: [browserFpnDetrIngress.shape.batch, browserFpnDetrIngress.shape.spatialTokens, browserFpnDetrIngress.shape.channels] },
          { role: 'prompt-features', artifactId: effectivePromptFeaturesOutput.artifactId, sha256: effectivePromptFeaturesOutput.sha256, shape: effectivePromptFeaturesOutput.shape },
          { role: 'prompt-mask', artifactId: effectivePromptMaskOutput.artifactId, sha256: effectivePromptMaskOutput.sha256, shape: effectivePromptMaskOutput.shape },
        ]);
        browserFpnDetrIngressEvidence = {
          encoderSrcSource: 'browser-fpn-neck-feature-2',
          encoderSrcOutput: fpnNeckFeature2Output,
          encoderSrcSha256: effectiveEncoderSrcSha256,
          encoderPosSource: 'browser-position-embedding-sine',
          encoderPosSha256: effectiveEncoderPosSha256,
          detrImageIngressTensorSha256,
          fpnLevels: [0, 1, 2, 3],
          detectorConsumedLevel: 2,
          shape: browserFpnDetrIngress.shape,
          positionEncoding: browserFpnDetrIngress.positionEncoding,
          parity: {
            encoderSrcMaxAbsDiff: maxAbsDiff(encoderSrc, effectiveEncoderSrc),
            encoderPosMaxAbsDiff: maxAbsDiff(encoderPos, effectiveEncoderPos),
            promptTextMaxAbsDiff,
            promptMaskMaxAbsDiff,
          },
        };
      }
      const encoderRequest = includeImageFpnNeck ? createRouteInvocationRequest(route, {
        requestId: `sam-browser-detr-stack-encoder-${Date.now()}`,
        inputs: {
          'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
          'sam3-detr-encoder-tensors': { artifactId: 'sam3-detr-encoder-tensors:browser-fpn-image-ingress-composition', sha256: detrImageIngressTensorSha256 },
          'sam3-detr-encoder-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
        },
        outputs: {
          'encoder-hidden-states': { artifactId: 'sam3-encoder-hidden-states:browser-fpn-image-ingress-composition', shape: [manifest.shape.batch, manifest.shape.spatialTokens, manifest.shape.channels] },
        },
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, browserFpnDetrIngress: browserFpnDetrIngressEvidence },
      }) : request;
      setStatus('run-detr-encoder');
      const encoderResult = await runSam3DetrEncoderPhaseProgramRoute({ request: encoderRequest, route, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: route.kernel, model: { revision: route.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { encoderSrc: effectiveEncoderSrc, encoderPos: effectiveEncoderPos, promptFeatures: effectivePromptFeatures, promptMask: effectivePromptMask, layers: encoderWeights.layers, shape: encoderShape }, includeReadback: true });
      const gpuEncoderHiddenStates = new Float32Array(encoderResult.debugReadback.encoderHiddenStates);
      const detrEncoderOutput = encoderResult.receipt.outputs.find(output => output.role === 'encoder-hidden-states');
      if (!detrEncoderOutput?.sha256 || !detrEncoderOutput?.artifactId) throw new Error('DETR encoder output identity missing for decoder composition');
      let promptResult = null;
      let pixelResult = null;
      let gpuPromptFpnFeature = null;
      let gpuPixelEmbed = null;
      let promptFpnOutput = null;
      let pixelEmbedOutput = null;
      let promptFpnTensorSha256 = null;
      let pixelTensorSha256 = null;
      if (includeImageFpnNeck) {
        setStatus('run-prompt-fpn');
        promptFpnTensorSha256 = await aggregateTensorBundleSha256('sam3-prompt-fpn-tensors:browser-image-fpn-detector-stack', [
          { role: 'encoder-hidden-states', artifactId: detrEncoderOutput.artifactId, sha256: detrEncoderOutput.sha256, shape: detrEncoderOutput.shape },
          { role: 'prompt-features', artifactId: effectivePromptFeaturesOutput.artifactId, sha256: effectivePromptFeaturesOutput.sha256, shape: effectivePromptFeaturesOutput.shape },
          { role: 'prompt-mask', artifactId: effectivePromptMaskOutput.artifactId, sha256: effectivePromptMaskOutput.sha256, shape: effectivePromptMaskOutput.shape },
        ]);
        const promptRoute = createSam3PromptFpnPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-prompt-fpn', dtype: 'fp32' }, kernel: { profile: 'sam3-prompt-fpn-phase-program-v0', commit: params.get('commit') || null } });
        const promptRequest = createRouteInvocationRequest(promptRoute, {
          requestId: `sam-browser-image-fpn-prompt-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'sam3-prompt-fpn-tensors': { artifactId: 'sam3-prompt-fpn-tensors:browser-image-fpn-detector-stack-composition', sha256: promptFpnTensorSha256 },
            'sam3-prompt-fpn-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
          },
          outputs: {
            'prompt-fpn-feature': { artifactId: 'sam3-prompt-fpn-feature:browser-image-fpn-detector-stack-composition', shape: [manifest.shape.batch, manifest.shape.height, manifest.shape.width, manifest.shape.channels] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: encoderResult.receipt?.effectiveRouteId, detrEncoderOutput, browserFpnDetrIngress: browserFpnDetrIngressEvidence },
        });
        promptResult = await runSam3PromptFpnPhaseProgramRoute({ request: promptRequest, route: promptRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: promptRoute.kernel, model: { revision: promptRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { encoderHiddenStates: gpuEncoderHiddenStates, promptFeatures: effectivePromptFeatures, promptMask: effectivePromptMask, weights: promptWeights, shape: promptShape }, includeReadback: true });
        gpuPromptFpnFeature = new Float32Array(promptResult.debugReadback.promptFpnFeature);
        promptFpnOutput = promptResult.receipt.outputs.find(output => output.role === 'prompt-fpn-feature');
        if (!promptFpnOutput?.sha256 || !promptFpnOutput?.artifactId) throw new Error('image-FPN detector-stack prompt-FPN output identity missing');
        setStatus('run-pixel-decoder');
        pixelTensorSha256 = await aggregateTensorBundleSha256('sam3-pixel-decoder-tensors:browser-image-fpn-detector-stack', [
          { role: 'fpn-neck-feature-0', artifactId: fpnNeckFeature0Output.artifactId, sha256: fpnNeckFeature0Output.sha256, shape: fpnNeckFeature0Output.shape },
          { role: 'fpn-neck-feature-1', artifactId: fpnNeckFeature1Output.artifactId, sha256: fpnNeckFeature1Output.sha256, shape: fpnNeckFeature1Output.shape },
          { role: 'prompt-fpn-feature', artifactId: promptFpnOutput.artifactId, sha256: promptFpnOutput.sha256, shape: promptFpnOutput.shape },
        ]);
        const pixelRoute = createSam3PixelDecoderPhaseProgramRouteDefinition({ stageCount: pixelShape.levels.length - 1, model: { revision: manifest.model?.id || 'mlx-reference-pixel-decoder', dtype: 'fp32' }, kernel: { profile: 'sam3-pixel-decoder-phase-program-v0', commit: params.get('commit') || null } });
        const pixelRequest = createRouteInvocationRequest(pixelRoute, {
          requestId: `sam-browser-image-fpn-pixel-${Date.now()}`,
          inputs: {
            'source-image': { artifactId: manifest.sourceImage?.artifactId || 'image:synthetic', sha256: manifest.sourceImage?.sha256 || 'sha256:synthetic-image', shape: sourceImageShape(manifest) },
            'sam3-pixel-decoder-tensors': { artifactId: 'sam3-pixel-decoder-tensors:browser-image-fpn-detector-stack-composition', sha256: pixelTensorSha256 },
            'sam3-pixel-decoder-weights': { artifactId: manifest.staticWeights.artifactId, sha256: manifest.staticWeights.sha256 },
          },
          outputs: {
            'pixel-embed': { artifactId: 'sam3-pixel-embed:browser-image-fpn-detector-stack-composition', shape: [manifest.shape.batch, manifest.shape.maskHeight, manifest.shape.maskWidth, manifest.shape.channels] },
          },
          routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: promptResult.receipt?.effectiveRouteId, promptFpnOutput },
        });
        pixelResult = await runSam3PixelDecoderPhaseProgramRoute({ request: pixelRequest, route: pixelRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: pixelRoute.kernel, model: { revision: pixelRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { features: [gpuFpnNeckFeature0, gpuFpnNeckFeature1, gpuPromptFpnFeature], weights: pixelWeights, shape: pixelShape }, includeReadback: true });
        gpuPixelEmbed = new Float32Array(pixelResult.debugReadback.pixelEmbed);
        pixelEmbedOutput = pixelResult.receipt.outputs.find(output => output.role === 'pixel-embed');
        if (!pixelEmbedOutput?.sha256 || !pixelEmbedOutput?.artifactId) throw new Error('image-FPN detector-stack pixel-decoder output identity missing');
      }
      const decoderTensorSha256 = await aggregateTensorBundleSha256('sam3-detr-decoder-composed-tensors', [
        { role: 'encoder-hidden-states', artifactId: detrEncoderOutput.artifactId, sha256: detrEncoderOutput.sha256, shape: detrEncoderOutput.shape },
        { role: 'encoder-pos', sha256: effectiveEncoderPosSha256 },
        { role: 'prompt-features', artifactId: effectivePromptFeaturesOutput.artifactId, sha256: effectivePromptFeaturesOutput.sha256, shape: effectivePromptFeaturesOutput.shape },
        { role: 'prompt-mask', artifactId: effectivePromptMaskOutput.artifactId, sha256: effectivePromptMaskOutput.sha256, shape: effectivePromptMaskOutput.shape },
      ]);
      state.preDecoderCheckpointEvidence = {
        schema: 'kaminos.sam3-browser-pre-decoder-checkpoint-evidence.v0',
        checkpoint: 'pre-detr-decoder',
        packageId: state.packageInvocationEvidence?.packageId || null,
        invocationId: state.packageInvocationEvidence?.invocationId || null,
        effectiveRouteIds: [
          imagePreprocessResult?.receipt?.effectiveRouteId,
          imagePatchEmbedResult?.receipt?.effectiveRouteId,
          imageVitPrefixResult?.receipt?.effectiveRouteId,
          imageVitFirstBlockResult?.receipt?.effectiveRouteId,
          imageVitBlockStackResult?.receipt?.effectiveRouteId,
          imageFpnNeckResult?.receipt?.effectiveRouteId,
          promptTextResult?.receipt?.effectiveRouteId,
          encoderResult?.receipt?.effectiveRouteId,
          promptResult?.receipt?.effectiveRouteId,
          pixelResult?.receipt?.effectiveRouteId,
        ].filter(Boolean),
        parity: {
          pixelValuesMaxAbsDiff: expectedPixelValues && gpuPixelValues ? maxAbsDiff(expectedPixelValues, gpuPixelValues) : undefined,
          patchEmbeddingsMaxAbsDiff: expectedPatchEmbeddings && gpuPatchEmbeddings ? maxAbsDiff(expectedPatchEmbeddings, gpuPatchEmbeddings) : undefined,
          vitPrefixHiddenStatesMaxAbsDiff: expectedVitPrefixHiddenStates && gpuVitPrefixHiddenStates ? maxAbsDiff(expectedVitPrefixHiddenStates, gpuVitPrefixHiddenStates) : undefined,
          vitFirstBlockHiddenStatesMaxAbsDiff: expectedVitFirstBlockHiddenStates && gpuVitFirstBlockHiddenStates ? maxAbsDiff(expectedVitFirstBlockHiddenStates, gpuVitFirstBlockHiddenStates) : undefined,
          vitBlockStackHiddenStatesMaxAbsDiff: expectedVitBlockStackHiddenStates && gpuVitBlockStackHiddenStates ? maxAbsDiff(expectedVitBlockStackHiddenStates, gpuVitBlockStackHiddenStates) : undefined,
          vitBackboneHiddenStatesMaxAbsDiff: expectedVitBackboneHiddenStates && gpuVitBlockStackHiddenStates ? maxAbsDiff(expectedVitBackboneHiddenStates, gpuVitBlockStackHiddenStates) : undefined,
          fpnNeckFeature0MaxAbsDiff: expectedFpnNeckFeature0 && gpuFpnNeckFeature0 ? maxAbsDiff(expectedFpnNeckFeature0, gpuFpnNeckFeature0) : undefined,
          fpnNeckFeature1MaxAbsDiff: expectedFpnNeckFeature1 && gpuFpnNeckFeature1 ? maxAbsDiff(expectedFpnNeckFeature1, gpuFpnNeckFeature1) : undefined,
          fpnNeckFeature2MaxAbsDiff: expectedFpnNeckFeature2 && gpuFpnNeckFeature2 ? maxAbsDiff(expectedFpnNeckFeature2, gpuFpnNeckFeature2) : undefined,
          fpnNeckFeature3MaxAbsDiff: expectedFpnNeckFeature3 && gpuFpnNeckFeature3 ? maxAbsDiff(expectedFpnNeckFeature3, gpuFpnNeckFeature3) : undefined,
          promptFeaturesMaxAbsDiff: expectedPromptFeatures && effectivePromptFeatures ? maxAbsDiff(expectedPromptFeatures, effectivePromptFeatures) : undefined,
          promptMaskMaxAbsDiff: expectedPromptMask && effectivePromptMask ? maxAbsDiff(expectedPromptMask, effectivePromptMask) : undefined,
          encoderHiddenStatesMaxAbsDiff: maxAbsDiff(expectedEncoderHiddenStates, gpuEncoderHiddenStates),
          promptFpnMaxAbsDiff: expectedPromptFpnFeature && gpuPromptFpnFeature ? maxAbsDiff(expectedPromptFpnFeature, gpuPromptFpnFeature) : undefined,
          pixelEmbedMaxAbsDiff: effectiveExpectedPixelEmbed && gpuPixelEmbed ? maxAbsDiff(effectiveExpectedPixelEmbed, gpuPixelEmbed) : undefined,
        },
      };
      const decoderRoute = createSam3DetrDecoderPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-detr-decoder', dtype: 'fp32' }, kernel: { profile: 'sam3-detr-decoder-phase-program-v0', commit: params.get('commit') || null }, shape: manifest.shape });
      setStatus('run-detr-decoder');
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
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: encoderResult.receipt?.effectiveRouteId, detrEncoderOutput, browserFpnDetrIngress: browserFpnDetrIngressEvidence },
      });
      const decoderResult = await runSam3DetrDecoderPhaseProgramRoute({ request: decoderRequest, route: decoderRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: decoderRoute.kernel, model: { revision: decoderRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { visionFeatures: gpuEncoderHiddenStates, visionPosEncoding: effectiveEncoderPos, promptFeatures: effectivePromptFeatures, promptMask: effectivePromptMask, shape: decoderShape, ...decoderWeights }, includeReadback: true, includeAllHiddenStatesReadback: includeStackScoring });
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
        setStatus('run-scoring');
        scoringTensorSha256 = await aggregateTensorBundleSha256('sam3-scoring-composed-tensors', [
          { role: 'hidden-states', artifactId: decoderHiddenStatesOutput.artifactId, sha256: decoderHiddenStatesOutput.sha256, shape: decoderHiddenStatesOutput.shape },
          { role: 'prompt-features', artifactId: effectivePromptFeaturesOutput.artifactId, sha256: effectivePromptFeaturesOutput.sha256, shape: effectivePromptFeaturesOutput.shape },
          { role: 'prompt-mask', artifactId: effectivePromptMaskOutput.artifactId, sha256: effectivePromptMaskOutput.sha256, shape: effectivePromptMaskOutput.shape },
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
        scoringResult = await runSam3ScoringPhaseProgramRoute({ request: scoringRequest, route: scoringRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: scoringRoute.kernel, model: { revision: scoringRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { hiddenStates: gpuDecoderHiddenStates, promptFeatures: effectivePromptFeatures, promptMask: effectivePromptMask, weights: scoringWeights, shape: scoringShape }, includeReadback: true });
        gpuPredLogits = new Float32Array(scoringResult.debugReadback.predLogits);
        scoringOutput = scoringResult.receipt.outputs.find(output => output.role === 'pred-logits');
        if (!scoringOutput?.sha256 || !scoringOutput?.artifactId) throw new Error('DETR stack scoring pred-logits output identity missing');
      }
      if (includeStackSelection) {
        setStatus('run-selection');
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
      const effectivePixelEmbed = gpuPixelEmbed || pixelEmbed;
      const effectivePixelEmbedOutput = pixelEmbedOutput || { artifactId: pixelEmbedTensor.artifactId || 'sam3-pixel-embed:mlx-reference-detector-stack', sha256: pixelEmbedTensor.sha256, shape: pixelEmbedTensor.shape };
      const downstreamTensorSha256 = await aggregateTensorBundleSha256('sam3-mask-tail-composed-tensors', [
        { role: 'last-hs', artifactId: lastHsOutput.artifactId, sha256: lastHsOutput.sha256, shape: lastHsOutput.shape },
        { role: 'pixel-embed', artifactId: effectivePixelEmbedOutput.artifactId, sha256: effectivePixelEmbedOutput.sha256, shape: effectivePixelEmbedOutput.shape },
      ]);
      const maskRoute = createSam3MaskTailPhaseProgramRouteDefinition({ model: { revision: manifest.model?.id || 'mlx-reference-mask-tail', dtype: 'fp32' }, kernel: { profile: 'sam3-mask-tail-phase-program-v0', commit: params.get('commit') || null } });
      setStatus('run-mask-tail');
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
        routeConfig: { upstream: manifest.claims?.upstream || 'mlx-reference-detr-stack', promptHash: manifest.prompt?.sha256, composedFrom: pixelResult?.receipt?.effectiveRouteId || decoderResult.receipt?.effectiveRouteId, lastHsOutput, pixelEmbedOutput },
      });
      const tailResult = await runSam3MaskTailPhaseProgramRoute({ request: maskRequest, route: maskRoute, device, queue: device.queue, adapterName: adapter.info?.description || adapter.info?.device || 'browser-webgpu-adapter', browser: navigator.userAgent, kernel: maskRoute.kernel, model: { revision: maskRoute.model.revision, weightsHash: manifest.staticWeights.sha256, dtype: 'fp32' }, tensors: { lastHs: gpuLastHs, pixelEmbed: effectivePixelEmbed, weights: tailWeights, shape: maskTailShape }, includeReadback: true });
      return {
        ...tailResult,
        receipt: encoderResult.receipt,
        routeReceipt: encoderResult.receipt,
        midstreamRouteReceipt: decoderResult.receipt,
        downstreamRouteReceipt: tailResult.receipt,
        compositionRouteReceipts: includeImageFpnNeck ? [imagePreprocessResult.receipt, imagePatchEmbedResult.receipt, imageVitPrefixResult.receipt, imageVitBlockStackResult.receipt, imageFpnNeckResult.receipt, promptTextResult.receipt, encoderResult.receipt, promptResult.receipt, pixelResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeImageVitBlockStack ? [imagePreprocessResult.receipt, imagePatchEmbedResult.receipt, imageVitPrefixResult.receipt, imageVitBlockStackResult.receipt, encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeImageVitFirstBlock ? [imagePreprocessResult.receipt, imagePatchEmbedResult.receipt, imageVitPrefixResult.receipt, imageVitFirstBlockResult.receipt, encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeImageVitPrefix ? [imagePreprocessResult.receipt, imagePatchEmbedResult.receipt, imageVitPrefixResult.receipt, encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeImagePatchEmbed ? [imagePreprocessResult.receipt, imagePatchEmbedResult.receipt, encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeImagePreprocess ? [imagePreprocessResult.receipt, encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeStackSelection ? [encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, selectionResult.receipt, tailResult.receipt] : includeStackScoring ? [encoderResult.receipt, decoderResult.receipt, scoringResult.receipt, tailResult.receipt] : [encoderResult.receipt, decoderResult.receipt, tailResult.receipt],
        compositionRequestIds: [
          imagePreprocessResult,
          imagePatchEmbedResult,
          imageVitPrefixResult,
          imageVitFirstBlockResult,
          imageVitBlockStackResult,
          imageFpnNeckResult,
          promptTextResult,
          encoderResult,
          promptResult,
          pixelResult,
          decoderResult,
          scoringResult,
          selectionResult,
          tailResult,
        ].filter(Boolean).map(routeResult => routeResult.requestId),
        backend: tailResult.backend,
        debugReadback: {
          pixelValues: gpuPixelValues ? Array.from(gpuPixelValues) : undefined,
          imagePreprocessCpuMaxAbsDiff,
          patchEmbeddings: gpuPatchEmbeddings ? Array.from(gpuPatchEmbeddings) : undefined,
          imagePatchEmbedCpuMaxAbsDiff,
          vitPrefixHiddenStates: gpuVitPrefixHiddenStates ? Array.from(gpuVitPrefixHiddenStates) : undefined,
          imageVitPrefixCpuMaxAbsDiff,
          vitFirstBlockHiddenStates: gpuVitFirstBlockHiddenStates ? Array.from(gpuVitFirstBlockHiddenStates) : undefined,
          imageVitFirstBlockCpuMaxAbsDiff,
          vitBlockStackHiddenStates: gpuVitBlockStackHiddenStates ? Array.from(gpuVitBlockStackHiddenStates) : undefined,
          vitLayerParityCheckpoints: imageVitBlockStackResult?.finiteCheckpoints,
          imageVitBlockStackCpuMaxAbsDiff,
          vitFirstGlobalHiddenStatesMaxAbsDiff,
          fpnNeckFeature0: gpuFpnNeckFeature0 ? Array.from(gpuFpnNeckFeature0) : undefined,
          fpnNeckFeature1: gpuFpnNeckFeature1 ? Array.from(gpuFpnNeckFeature1) : undefined,
          fpnNeckFeature2: gpuFpnNeckFeature2 ? Array.from(gpuFpnNeckFeature2) : undefined,
          fpnNeckFeature3: gpuFpnNeckFeature3 ? Array.from(gpuFpnNeckFeature3) : undefined,
          imageFpnNeckCpuMaxAbsDiff,
          encoderSrc: includeImageFpnNeck ? Array.from(effectiveEncoderSrc) : undefined,
          encoderPos: includeImageFpnNeck ? Array.from(effectiveEncoderPos) : undefined,
          promptFeatures: gpuPromptFeatures ? Array.from(gpuPromptFeatures) : undefined,
          promptMask: gpuPromptMask ? Array.from(gpuPromptMask) : undefined,
          promptTextMaxAbsDiff,
          promptMaskMaxAbsDiff,
          encoderHiddenStates: Array.from(gpuEncoderHiddenStates),
          promptFpnFeature: gpuPromptFpnFeature ? Array.from(gpuPromptFpnFeature) : undefined,
          pixelEmbed: gpuPixelEmbed ? Array.from(gpuPixelEmbed) : undefined,
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
          imagePatchEmbedRouteId: imagePatchEmbedResult?.receipt?.effectiveRouteId,
          patchEmbeddingsTensorSha256,
          patchEmbeddingsOutput,
          patchProjectionWeightSha256: weightsByRole['patch-embed-projection-weight']?.sha256,
          imageVitPrefixRouteId: imageVitPrefixResult?.receipt?.effectiveRouteId,
          vitPrefixHiddenStatesTensorSha256,
          vitPrefixHiddenStatesOutput,
          positionEmbeddingsSha256: weightsByRole['vit-position-embeddings']?.sha256,
          backboneLayerNormWeightSha256: weightsByRole['vit-backbone-layernorm-weight']?.sha256,
          backboneLayerNormBiasSha256: weightsByRole['vit-backbone-layernorm-bias']?.sha256,
          imageVitFirstBlockRouteId: imageVitFirstBlockResult?.receipt?.effectiveRouteId,
          vitFirstBlockHiddenStatesTensorSha256,
          vitFirstBlockHiddenStatesOutput,
          firstBlockWeightsSha256,
          imageVitBlockStackRouteId: imageVitBlockStackResult?.receipt?.effectiveRouteId,
          vitBlockStackHiddenStatesTensorSha256,
          vitBlockStackHiddenStatesOutput,
          blockStackWeightsSha256,
          firstGlobalLayerIndex: vitBlockStackShape?.firstGlobalLayerIndex,
          imageFpnNeckRouteId: imageFpnNeckResult?.receipt?.effectiveRouteId,
          fpnNeckFeature0TensorSha256,
          fpnNeckFeature1TensorSha256,
          fpnNeckFeature2TensorSha256,
          fpnNeckFeature3TensorSha256,
          fpnNeckFeature0Output,
          fpnNeckFeature1Output,
          fpnNeckFeature2Output,
          fpnNeckFeature3Output,
          fpnNeckWeightsSha256,
          browserFpnDetrIngressEvidence,
          promptTextRouteId: promptTextResult?.receipt?.effectiveRouteId,
          promptTextTensorSha256,
          promptTextWeightsSha256,
          promptFeaturesOutput,
          promptMaskOutput,
          detrImageIngressTensorSha256,
          effectiveEncoderSrcSha256,
          effectiveEncoderPosSha256,
          promptFpnRouteId: promptResult?.receipt?.effectiveRouteId,
          promptFpnTensorSha256,
          promptFpnOutput,
          pixelDecoderRouteId: pixelResult?.receipt?.effectiveRouteId,
          pixelTensorSha256,
          pixelEmbedOutput,
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

async function main(manifestUrl = initialManifestUrl, invocationOptions = {}) {
  try {
    const verificationMode = invocationOptions.verificationMode || 'reference-parity';
    if (!['reference-parity', 'execution-only'].includes(verificationMode)) {
      throw new Error(`unsupported SAM3 verification mode: ${verificationMode}`);
    }
    const verificationAttached = verificationMode === 'reference-parity';
    const hasDynamicInput = Object.hasOwn(invocationOptions, 'promptText') || Object.hasOwn(invocationOptions, 'sourceImage');
    if (verificationAttached && hasDynamicInput) {
      throw new Error('dynamic SAM3 input requires verificationMode execution-only');
    }
    const invocationId = invocationOptions.invocationId || crypto.randomUUID();
    activeManifestUrl = manifestUrl;
    setStatus('load-oracle-packet');
    const rootManifest = await fetchJson(manifestUrl);
    const { manifest, evidence: packageInvocationEvidence } = await resolveBrowserManifest(rootManifest);
    if (!verificationAttached) {
      const promptText = String(invocationOptions.promptText || '').trim();
      const sourceImage = invocationOptions.sourceImage;
      if (!promptText) throw new Error('execution-only SAM3 invocation requires a non-empty promptText');
      if (!sourceImage?.url || !sourceImage?.sha256 || !sourceImage?.artifactId || !Array.isArray(sourceImage?.encodedResolution)) {
        throw new Error('execution-only SAM3 invocation requires sourceImage url, sha256, artifactId, and encodedResolution');
      }
      const sourceImageUrl = new URL(sourceImage.url, window.location.href);
      if (sourceImageUrl.origin !== window.location.origin) {
        throw new Error(`execution-only SAM3 source image must be same-origin: ${sourceImageUrl.origin}`);
      }
      manifest.prompt = {
        text: promptText,
        sha256: await sha256Text(promptText),
        runtimeOwner: 'browser-workbench',
      };
      manifest.sourceImage = {
        file: sourceImageUrl.href,
        artifactId: sourceImage.artifactId,
        sha256: sourceImage.sha256,
        encodedResolution: sourceImage.encodedResolution,
        resolution: manifest.sourceImage?.resolution,
        runtimeOwner: 'browser-workbench',
      };
    }
    state.invocationId = invocationId;
    state.verificationMode = verificationMode;
    state.verificationState = verificationAttached ? 'attached' : 'not-attached';
    state.requestedPromptText = manifest.prompt?.text || null;
    state.packageInvocationEvidence = packageInvocationEvidence;
    if (packageInvocationEvidence) configureStaticModelPackage(manifest);
    if (!SUPPORTED_ROUTE_IDS.has(manifest.routeId)) {
      throw new Error(`unsupported manifest route: ${manifest.routeId}`);
    }
    state.requestedRouteId = manifest.routeId;
    state.sourceImage = manifest.sourceImage || null;
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

    const payload = manifest.mode === 'mlx-detr-stack-export' || manifest.mode === 'mlx-detr-stack-scoring-export' || manifest.mode === 'mlx-detr-stack-selection-export' || manifest.mode === 'mlx-detector-stack-export' || manifest.mode === 'mlx-detector-stack-preprocess-export' || manifest.mode === 'mlx-detector-stack-patch-embed-export' || manifest.mode === 'mlx-detector-stack-vit-prefix-export' || manifest.mode === 'mlx-detector-stack-vit-first-block-export' || manifest.mode === 'mlx-detector-stack-vit-block-stack-export' || manifest.mode === 'mlx-detector-stack-vit-backbone-export' || manifest.mode === 'mlx-detector-stack-image-fpn-neck-export' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-mask-tail-phase-program' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-mask-tail-phase-program' || manifest.boundary === 'sam3-detector-detr-encoder-decoder-scoring-selection-mask-tail-phase-program' || manifest.boundary === 'sam3-detector-stack-browser-local-detector-mask-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-detector-stack-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-detector-stack-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-detector-stack-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-first-block-detector-stack-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-block-stack-first-global-detector-stack-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-full-backbone-detector-stack-phase-program' || manifest.boundary === 'sam3-browser-local-image-preprocess-patch-embed-vit-prefix-full-backbone-fpn-neck-detector-stack-phase-program'
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
    const sourceImageUrl = manifest.sourceImage?.file
      ? manifest.sourceImage.runtimeOwner === 'browser-workbench'
        ? manifest.sourceImage.file
        : resolveManifestFile(manifest.sourceImage.file)
      : null;
    const sourceImageAsset = sourceImageUrl ? await loadSourceImageAsset(sourceImageUrl, manifest.sourceImage) : null;
    const sourceImage = sourceImageAsset?.image || null;
    if (sourceImageAsset) {
      sourceImageEl.src = sourceImageAsset.objectUrl;
      const preprocessShape = payload.imagePreprocessEvidence ? imagePreprocessShape(manifest) : null;
      state.browserOriginalImageIngressEvidence = {
        ...sourceImageAsset.evidence,
        targetResolution: preprocessShape ? [preprocessShape.width, preprocessShape.height] : null,
        resizeOwner: preprocessShape ? 'browser' : null,
        resizeAlgorithm: preprocessShape ? SAM3_PILLOW_12_FIXED_POINT_BILINEAR_RESIZE : null,
      };
    }
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
    if (diagnosticReadbackEnabled) {
      diagnosticReadback = {
        packageId: state.packageInvocationEvidence?.packageId || null,
        invocationId: state.packageInvocationEvidence?.invocationId || null,
        tensors: {
          encoderHiddenStates: result.debugReadback.encoderHiddenStates,
          encoderPos: result.debugReadback.encoderPos,
          promptFeatures: result.debugReadback.promptFeatures,
          promptMask: result.debugReadback.promptMask,
          pixelEmbed: result.debugReadback.pixelEmbed,
          decoderHiddenStates: result.debugReadback.decoderHiddenStates,
          lastHs: result.debugReadback.lastHs,
          referenceBoxes: result.debugReadback.referenceBoxes,
          presenceLogits: result.debugReadback.presenceLogits,
          maskLogits: result.debugReadback.maskLogits,
        },
      };
    }
    state.invocationRequestIds = result.compositionRequestIds || [result.requestId].filter(Boolean);
    const terminalOutputs = result.downstreamRouteReceipt?.outputs || result.outputs || [];
    state.invocationOutputIdentity = terminalOutputs.length > 0
      ? await aggregateTensorBundleSha256('sam3-browser-invocation-terminal-outputs', terminalOutputs)
      : null;

    const gpuLogits = result.debugReadback.maskLogits ? new Float32Array(result.debugReadback.maskLogits) : null;
    const gpuBinary = result.debugReadback.binaryMask ? new Uint32Array(result.debugReadback.binaryMask) : null;
    const gpuPredLogits = result.debugReadback.predLogits ? new Float32Array(result.debugReadback.predLogits) : null;
    const binaryThresholdMismatchEvidence = collectBinaryThresholdMismatchEvidence(
      expectedLogits,
      gpuLogits,
      expectedBinary,
      gpuBinary,
    );
    const parity = {
      promptTokenIdMismatchCount: payload.browserPromptTokenizerEvidence?.promptTokenIdMismatchCount,
      promptAttentionMaskMismatchCount: payload.browserPromptTokenizerEvidence?.promptAttentionMaskMismatchCount,
      encoderHiddenStatesMaxAbsDiff: result.debugReadback.encoderHiddenStates ? maxAbsDiff(payload.expectedEncoderHiddenStates || [], new Float32Array(result.debugReadback.encoderHiddenStates)) : undefined,
      decoderHiddenStatesMaxAbsDiff: result.debugReadback.decoderHiddenStates ? maxAbsDiff(payload.expectedDecoderHiddenStates || [], new Float32Array(result.debugReadback.decoderHiddenStates)) : undefined,
      lastHsMaxAbsDiff: result.debugReadback.lastHs ? maxAbsDiff(payload.expectedLastHs || [], new Float32Array(result.debugReadback.lastHs)) : undefined,
      referenceBoxesMaxAbsDiff: result.debugReadback.referenceBoxes ? maxAbsDiff(payload.expectedReferenceBoxes || [], new Float32Array(result.debugReadback.referenceBoxes)) : undefined,
      presenceLogitsMaxAbsDiff: result.debugReadback.presenceLogits ? maxAbsDiff(payload.expectedPresenceLogits || [], new Float32Array(result.debugReadback.presenceLogits)) : undefined,
      pixelValuesMaxAbsDiff: result.debugReadback.pixelValues ? maxAbsDiff(payload.expectedPixelValues || [], new Float32Array(result.debugReadback.pixelValues)) : undefined,
      imagePreprocessCpuMaxAbsDiff: result.debugReadback.imagePreprocessCpuMaxAbsDiff,
      patchEmbeddingsMaxAbsDiff: result.debugReadback.patchEmbeddings ? maxAbsDiff(payload.expectedPatchEmbeddings || [], new Float32Array(result.debugReadback.patchEmbeddings)) : undefined,
      imagePatchEmbedCpuMaxAbsDiff: result.debugReadback.imagePatchEmbedCpuMaxAbsDiff,
      vitPrefixHiddenStatesMaxAbsDiff: result.debugReadback.vitPrefixHiddenStates ? maxAbsDiff(payload.expectedVitPrefixHiddenStates || [], new Float32Array(result.debugReadback.vitPrefixHiddenStates)) : undefined,
      imageVitPrefixCpuMaxAbsDiff: result.debugReadback.imageVitPrefixCpuMaxAbsDiff,
      vitFirstBlockHiddenStatesMaxAbsDiff: result.debugReadback.vitFirstBlockHiddenStates ? maxAbsDiff(payload.expectedVitFirstBlockHiddenStates || [], new Float32Array(result.debugReadback.vitFirstBlockHiddenStates)) : undefined,
      imageVitFirstBlockCpuMaxAbsDiff: result.debugReadback.imageVitFirstBlockCpuMaxAbsDiff,
      vitBlockStackHiddenStatesMaxAbsDiff: result.debugReadback.vitBlockStackHiddenStates ? maxAbsDiff(payload.expectedVitBlockStackHiddenStates || [], new Float32Array(result.debugReadback.vitBlockStackHiddenStates)) : undefined,
      vitBackboneHiddenStatesMaxAbsDiff: result.debugReadback.vitBlockStackHiddenStates && payload.expectedVitBackboneHiddenStates ? maxAbsDiff(payload.expectedVitBackboneHiddenStates, new Float32Array(result.debugReadback.vitBlockStackHiddenStates)) : undefined,
      imageVitBlockStackCpuMaxAbsDiff: result.debugReadback.imageVitBlockStackCpuMaxAbsDiff,
      vitFirstGlobalHiddenStatesMaxAbsDiff: result.debugReadback.vitFirstGlobalHiddenStatesMaxAbsDiff,
      fpnNeckFeature0MaxAbsDiff: result.debugReadback.fpnNeckFeature0 ? maxAbsDiff(payload.expectedFpnNeckFeature0 || [], new Float32Array(result.debugReadback.fpnNeckFeature0)) : undefined,
      fpnNeckFeature1MaxAbsDiff: result.debugReadback.fpnNeckFeature1 ? maxAbsDiff(payload.expectedFpnNeckFeature1 || [], new Float32Array(result.debugReadback.fpnNeckFeature1)) : undefined,
      fpnNeckFeature2MaxAbsDiff: result.debugReadback.fpnNeckFeature2 ? maxAbsDiff(payload.expectedFpnNeckFeature2 || [], new Float32Array(result.debugReadback.fpnNeckFeature2)) : undefined,
      fpnNeckFeature3MaxAbsDiff: result.debugReadback.fpnNeckFeature3 ? maxAbsDiff(payload.expectedFpnNeckFeature3 || [], new Float32Array(result.debugReadback.fpnNeckFeature3)) : undefined,
      imageFpnNeckCpuMaxAbsDiff: result.debugReadback.imageFpnNeckCpuMaxAbsDiff,
      encoderSrcMaxAbsDiff: result.debugReadback.encoderSrc ? maxAbsDiff(payload.expectedEncoderSrc || [], new Float32Array(result.debugReadback.encoderSrc)) : undefined,
      encoderPosMaxAbsDiff: result.debugReadback.encoderPos ? maxAbsDiff(payload.expectedEncoderPos || [], new Float32Array(result.debugReadback.encoderPos)) : undefined,
      promptTextMaxAbsDiff: result.debugReadback.promptFeatures ? maxAbsDiff(payload.expectedPromptFeatures || [], new Float32Array(result.debugReadback.promptFeatures)) : undefined,
      promptMaskMaxAbsDiff: result.debugReadback.promptMask ? maxAbsDiff(payload.expectedPromptMask || [], new Float32Array(result.debugReadback.promptMask)) : undefined,
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
    const gpuPatchEmbeddingsTolerance = manifest.tolerances?.patchEmbeddingsMaxAbsDiff ?? 0.0005;
    const gpuPatchEmbedCpuTolerance = manifest.tolerances?.imagePatchEmbedCpuMaxAbsDiff ?? 0.000002;
    const gpuVitPrefixTolerance = manifest.tolerances?.vitPrefixHiddenStatesMaxAbsDiff ?? 0.0007;
    const gpuVitPrefixCpuTolerance = manifest.tolerances?.imageVitPrefixCpuMaxAbsDiff ?? 0.0007;
    const gpuVitFirstBlockTolerance = manifest.tolerances?.vitFirstBlockHiddenStatesMaxAbsDiff ?? 0.0025;
    const gpuVitFirstBlockCpuTolerance = manifest.tolerances?.imageVitFirstBlockCpuMaxAbsDiff ?? 0.0025;
    const gpuVitBlockStackTolerance = manifest.tolerances?.vitBlockStackHiddenStatesMaxAbsDiff ?? 0.01;
    const gpuVitBlockStackCpuTolerance = manifest.tolerances?.imageVitBlockStackCpuMaxAbsDiff ?? 0.01;
    const gpuVitFirstGlobalTolerance = manifest.tolerances?.vitFirstGlobalHiddenStatesMaxAbsDiff ?? gpuVitBlockStackTolerance;
    const gpuFpnNeckTolerance = Math.max(manifest.tolerances?.fpnNeckFeature0MaxAbsDiff ?? 0.02, manifest.tolerances?.fpnNeckFeature1MaxAbsDiff ?? 0.02, manifest.tolerances?.fpnNeckFeature2MaxAbsDiff ?? 0.02, manifest.tolerances?.fpnNeckFeature3MaxAbsDiff ?? 0.02);
    const gpuFpnNeckCpuTolerance = manifest.tolerances?.imageFpnNeckCpuMaxAbsDiff ?? gpuFpnNeckTolerance;
    const gpuEncoderSrcTolerance = manifest.tolerances?.encoderSrcMaxAbsDiff ?? gpuFpnNeckTolerance;
    const gpuEncoderPosTolerance = manifest.tolerances?.encoderPosMaxAbsDiff ?? 0.00001;
    const gpuPromptTextTolerance = manifest.tolerances?.promptTextMaxAbsDiff ?? 0.0005;
    const gpuPromptMaskTolerance = manifest.tolerances?.promptMaskMaxAbsDiff ?? 0;
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
      patchEmbeddings: result.debugReadback.patchEmbeddings ? Array.from(new Float32Array(result.debugReadback.patchEmbeddings).slice(0, 16)) : undefined,
      expectedPatchEmbeddings: payload.expectedPatchEmbeddings ? Array.from(payload.expectedPatchEmbeddings.slice(0, 16)) : undefined,
      vitPrefixHiddenStates: result.debugReadback.vitPrefixHiddenStates ? Array.from(new Float32Array(result.debugReadback.vitPrefixHiddenStates).slice(0, 16)) : undefined,
      expectedVitPrefixHiddenStates: payload.expectedVitPrefixHiddenStates ? Array.from(payload.expectedVitPrefixHiddenStates.slice(0, 16)) : undefined,
      vitFirstBlockHiddenStates: result.debugReadback.vitFirstBlockHiddenStates ? Array.from(new Float32Array(result.debugReadback.vitFirstBlockHiddenStates).slice(0, 16)) : undefined,
      expectedVitFirstBlockHiddenStates: payload.expectedVitFirstBlockHiddenStates ? Array.from(payload.expectedVitFirstBlockHiddenStates.slice(0, 16)) : undefined,
      vitBlockStackHiddenStates: result.debugReadback.vitBlockStackHiddenStates ? Array.from(new Float32Array(result.debugReadback.vitBlockStackHiddenStates).slice(0, 16)) : undefined,
      expectedVitBlockStackHiddenStates: payload.expectedVitBlockStackHiddenStates ? Array.from(payload.expectedVitBlockStackHiddenStates.slice(0, 16)) : undefined,
      expectedVitFirstGlobalHiddenStates: payload.expectedVitFirstGlobalHiddenStates ? Array.from(payload.expectedVitFirstGlobalHiddenStates.slice(0, 16)) : undefined,
      fpnNeckFeature0: result.debugReadback.fpnNeckFeature0 ? Array.from(new Float32Array(result.debugReadback.fpnNeckFeature0).slice(0, 16)) : undefined,
      expectedFpnNeckFeature0: payload.expectedFpnNeckFeature0 ? Array.from(payload.expectedFpnNeckFeature0.slice(0, 16)) : undefined,
      fpnNeckFeature3: result.debugReadback.fpnNeckFeature3 ? Array.from(new Float32Array(result.debugReadback.fpnNeckFeature3).slice(0, 16)) : undefined,
      expectedFpnNeckFeature3: payload.expectedFpnNeckFeature3 ? Array.from(payload.expectedFpnNeckFeature3.slice(0, 16)) : undefined,
      encoderSrc: result.debugReadback.encoderSrc ? Array.from(new Float32Array(result.debugReadback.encoderSrc).slice(0, 16)) : undefined,
      expectedEncoderSrc: payload.expectedEncoderSrc ? Array.from(payload.expectedEncoderSrc.slice(0, 16)) : undefined,
      encoderPos: result.debugReadback.encoderPos ? Array.from(new Float32Array(result.debugReadback.encoderPos).slice(0, 16)) : undefined,
      expectedEncoderPos: payload.expectedEncoderPos ? Array.from(payload.expectedEncoderPos.slice(0, 16)) : undefined,
      promptFeatures: result.debugReadback.promptFeatures ? Array.from(new Float32Array(result.debugReadback.promptFeatures).slice(0, 16)) : undefined,
      expectedPromptFeatures: payload.expectedPromptFeatures ? Array.from(payload.expectedPromptFeatures.slice(0, 16)) : undefined,
      promptMask: result.debugReadback.promptMask ? Array.from(new Float32Array(result.debugReadback.promptMask).slice(0, 16)) : undefined,
      expectedPromptMask: payload.expectedPromptMask ? Array.from(payload.expectedPromptMask.slice(0, 16)) : undefined,
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
    state.binaryThresholdMismatchEvidence = binaryThresholdMismatchEvidence;
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
    state.imagePatchEmbedEvidence = payload.imagePatchEmbedEvidence ? {
      ...payload.imagePatchEmbedEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      patchEmbeddingsTensorSha256: result.compositionEdge?.patchEmbeddingsTensorSha256 || null,
      patchEmbeddingsOutput: result.compositionEdge?.patchEmbeddingsOutput || null,
      patchProjectionWeightSha256: result.compositionEdge?.patchProjectionWeightSha256 || null,
      parity: {
        patchEmbeddingsMaxAbsDiff: parity.patchEmbeddingsMaxAbsDiff,
        imagePatchEmbedCpuMaxAbsDiff: parity.imagePatchEmbedCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.patchEmbeddings,
    } : null;
    state.imageVitPrefixEvidence = payload.imageVitPrefixEvidence ? {
      ...payload.imageVitPrefixEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      vitPrefixHiddenStatesTensorSha256: result.compositionEdge?.vitPrefixHiddenStatesTensorSha256 || null,
      vitPrefixHiddenStatesOutput: result.compositionEdge?.vitPrefixHiddenStatesOutput || null,
      positionEmbeddingsSha256: result.compositionEdge?.positionEmbeddingsSha256 || null,
      backboneLayerNormWeightSha256: result.compositionEdge?.backboneLayerNormWeightSha256 || null,
      backboneLayerNormBiasSha256: result.compositionEdge?.backboneLayerNormBiasSha256 || null,
      parity: {
        vitPrefixHiddenStatesMaxAbsDiff: parity.vitPrefixHiddenStatesMaxAbsDiff,
        imageVitPrefixCpuMaxAbsDiff: parity.imageVitPrefixCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.vitPrefixHiddenStates,
    } : null;
    state.imageVitFirstBlockEvidence = payload.imageVitFirstBlockEvidence ? {
      ...payload.imageVitFirstBlockEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      vitFirstBlockHiddenStatesTensorSha256: result.compositionEdge?.vitFirstBlockHiddenStatesTensorSha256 || null,
      vitFirstBlockHiddenStatesOutput: result.compositionEdge?.vitFirstBlockHiddenStatesOutput || null,
      firstBlockWeightsSha256: result.compositionEdge?.firstBlockWeightsSha256 || null,
      parity: {
        vitFirstBlockHiddenStatesMaxAbsDiff: parity.vitFirstBlockHiddenStatesMaxAbsDiff,
        imageVitFirstBlockCpuMaxAbsDiff: parity.imageVitFirstBlockCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.vitFirstBlockHiddenStates,
    } : null;
    state.imageVitBlockStackEvidence = payload.imageVitBlockStackEvidence ? {
      ...payload.imageVitBlockStackEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      vitBlockStackHiddenStatesTensorSha256: result.compositionEdge?.vitBlockStackHiddenStatesTensorSha256 || null,
      vitBlockStackHiddenStatesOutput: result.compositionEdge?.vitBlockStackHiddenStatesOutput || null,
      blockStackWeightsSha256: result.compositionEdge?.blockStackWeightsSha256 || null,
      firstGlobalLayerIndex: result.compositionEdge?.firstGlobalLayerIndex ?? payload.imageVitBlockStackEvidence.firstGlobalLayerIndex,
      layerParityCheckpoints: result.debugReadback.vitLayerParityCheckpoints,
      parity: {
        vitBlockStackHiddenStatesMaxAbsDiff: parity.vitBlockStackHiddenStatesMaxAbsDiff,
        imageVitBlockStackCpuMaxAbsDiff: parity.imageVitBlockStackCpuMaxAbsDiff,
        vitFirstGlobalHiddenStatesMaxAbsDiff: parity.vitFirstGlobalHiddenStatesMaxAbsDiff,
        vitBackboneHiddenStatesMaxAbsDiff: parity.vitBackboneHiddenStatesMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.vitBlockStackHiddenStates,
    } : null;
    state.imageFpnNeckEvidence = payload.imageFpnNeckEvidence ? {
      ...payload.imageFpnNeckEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      fpnNeckFeature0TensorSha256: result.compositionEdge?.fpnNeckFeature0TensorSha256 || null,
      fpnNeckFeature1TensorSha256: result.compositionEdge?.fpnNeckFeature1TensorSha256 || null,
      fpnNeckFeature2TensorSha256: result.compositionEdge?.fpnNeckFeature2TensorSha256 || null,
      fpnNeckFeature3TensorSha256: result.compositionEdge?.fpnNeckFeature3TensorSha256 || null,
      fpnNeckFeature0Output: result.compositionEdge?.fpnNeckFeature0Output || null,
      fpnNeckFeature1Output: result.compositionEdge?.fpnNeckFeature1Output || null,
      fpnNeckFeature2Output: result.compositionEdge?.fpnNeckFeature2Output || null,
      fpnNeckFeature3Output: result.compositionEdge?.fpnNeckFeature3Output || null,
      fpnNeckWeightsSha256: result.compositionEdge?.fpnNeckWeightsSha256 || null,
      parity: {
        fpnNeckFeature0MaxAbsDiff: parity.fpnNeckFeature0MaxAbsDiff,
        fpnNeckFeature1MaxAbsDiff: parity.fpnNeckFeature1MaxAbsDiff,
        fpnNeckFeature2MaxAbsDiff: parity.fpnNeckFeature2MaxAbsDiff,
        fpnNeckFeature3MaxAbsDiff: parity.fpnNeckFeature3MaxAbsDiff,
        imageFpnNeckCpuMaxAbsDiff: parity.imageFpnNeckCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.fpnNeckFeature0,
    } : null;
    state.browserFpnDetrIngressEvidence = payload.browserFpnDetrIngressEvidence ? {
      ...payload.browserFpnDetrIngressEvidence,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      encoderReceipt: result.routeReceipt || result.receipt || null,
      edge: result.compositionEdge?.browserFpnDetrIngressEvidence || null,
      detrImageIngressTensorSha256: result.compositionEdge?.detrImageIngressTensorSha256 || null,
      effectiveEncoderSrcSha256: result.compositionEdge?.effectiveEncoderSrcSha256 || null,
      effectiveEncoderPosSha256: result.compositionEdge?.effectiveEncoderPosSha256 || null,
      parity: {
        encoderSrcMaxAbsDiff: parity.encoderSrcMaxAbsDiff,
        encoderPosMaxAbsDiff: parity.encoderPosMaxAbsDiff,
        encoderHiddenStatesMaxAbsDiff: parity.encoderHiddenStatesMaxAbsDiff,
      },
      debugReadbackSamples: {
        encoderSrc: debugReadbackSamples.encoderSrc,
        encoderPos: debugReadbackSamples.encoderPos,
      },
    } : null;
    state.browserPromptTokenizerEvidence = payload.browserPromptTokenizerEvidence ? {
      ...payload.browserPromptTokenizerEvidence,
      parity: {
        promptTokenIdMismatchCount: parity.promptTokenIdMismatchCount,
        promptAttentionMaskMismatchCount: parity.promptAttentionMaskMismatchCount,
      },
    } : null;
    state.browserPromptTextEvidence = payload.browserPromptTextEvidence ? {
      ...payload.browserPromptTextEvidence,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID) || null,
      promptTextTensorSha256: result.compositionEdge?.promptTextTensorSha256 || null,
      promptTextWeightsSha256: result.compositionEdge?.promptTextWeightsSha256 || null,
      promptFeaturesOutput: result.compositionEdge?.promptFeaturesOutput || null,
      promptMaskOutput: result.compositionEdge?.promptMaskOutput || null,
      parity: {
        promptTextMaxAbsDiff: parity.promptTextMaxAbsDiff,
        promptMaskMaxAbsDiff: parity.promptMaskMaxAbsDiff,
      },
      debugReadbackSamples: {
        promptFeatures: debugReadbackSamples.promptFeatures,
        promptMask: debugReadbackSamples.promptMask,
      },
    } : null;
    state.browserPromptFpnPixelEvidence = payload.browserPromptFpnPixelEvidence ? {
      ...payload.browserPromptFpnPixelEvidence,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      promptReceipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID) || null,
      pixelReceipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) || null,
      promptFpnTensorSha256: result.compositionEdge?.promptFpnTensorSha256 || null,
      promptFpnOutput: result.compositionEdge?.promptFpnOutput || null,
      pixelTensorSha256: result.compositionEdge?.pixelTensorSha256 || null,
      pixelEmbedOutput: result.compositionEdge?.pixelEmbedOutput || null,
      downstreamTensorSha256: result.compositionEdge?.downstreamTensorSha256 || null,
      parity: {
        promptFpnMaxAbsDiff: parity.promptFpnMaxAbsDiff,
        pixelEmbedMaxAbsDiff: parity.pixelEmbedMaxAbsDiff,
        maskLogitsMaxAbsDiff: parity.maskLogitsMaxAbsDiff,
        binaryMismatchCount: parity.binaryMismatchCount,
      },
      debugReadbackSamples: {
        promptFpnFeature: result.debugReadback.promptFpnFeature ? Array.from(new Float32Array(result.debugReadback.promptFpnFeature).slice(0, 16)) : undefined,
        pixelEmbed: result.debugReadback.pixelEmbed ? Array.from(new Float32Array(result.debugReadback.pixelEmbed).slice(0, 16)) : undefined,
      },
    } : null;
    if (verificationAttached) {
      if (
      (parity.encoderHiddenStatesMaxAbsDiff ?? 0) > gpuEncoderTolerance
      || (parity.decoderHiddenStatesMaxAbsDiff ?? 0) > gpuDecoderHiddenStatesTolerance
      || (parity.lastHsMaxAbsDiff ?? 0) > gpuLastHsTolerance
      || (parity.referenceBoxesMaxAbsDiff ?? 0) > gpuReferenceBoxesTolerance
      || (parity.presenceLogitsMaxAbsDiff ?? 0) > gpuPresenceLogitsTolerance
      || (parity.pixelValuesMaxAbsDiff ?? 0) > gpuPixelValuesTolerance
      || (parity.imagePreprocessCpuMaxAbsDiff ?? 0) > gpuPixelValuesTolerance
      || (parity.patchEmbeddingsMaxAbsDiff ?? 0) > gpuPatchEmbeddingsTolerance
      || (parity.imagePatchEmbedCpuMaxAbsDiff ?? 0) > gpuPatchEmbedCpuTolerance
      || (parity.vitPrefixHiddenStatesMaxAbsDiff ?? 0) > gpuVitPrefixTolerance
      || (parity.imageVitPrefixCpuMaxAbsDiff ?? 0) > gpuVitPrefixCpuTolerance
      || (parity.vitFirstBlockHiddenStatesMaxAbsDiff ?? 0) > gpuVitFirstBlockTolerance
      || (parity.imageVitFirstBlockCpuMaxAbsDiff ?? 0) > gpuVitFirstBlockCpuTolerance
      || (parity.vitBlockStackHiddenStatesMaxAbsDiff ?? 0) > gpuVitBlockStackTolerance
      || (parity.imageVitBlockStackCpuMaxAbsDiff ?? 0) > gpuVitBlockStackCpuTolerance
      || (parity.vitFirstGlobalHiddenStatesMaxAbsDiff ?? 0) > gpuVitFirstGlobalTolerance
      || (parity.fpnNeckFeature0MaxAbsDiff ?? 0) > gpuFpnNeckTolerance
      || (parity.fpnNeckFeature1MaxAbsDiff ?? 0) > gpuFpnNeckTolerance
      || (parity.fpnNeckFeature2MaxAbsDiff ?? 0) > gpuFpnNeckTolerance
      || (parity.fpnNeckFeature3MaxAbsDiff ?? 0) > gpuFpnNeckTolerance
      || (parity.imageFpnNeckCpuMaxAbsDiff ?? 0) > gpuFpnNeckCpuTolerance
      || (parity.encoderSrcMaxAbsDiff ?? 0) > gpuEncoderSrcTolerance
      || (parity.encoderPosMaxAbsDiff ?? 0) > gpuEncoderPosTolerance
      || (parity.promptTextMaxAbsDiff ?? 0) > gpuPromptTextTolerance
      || (parity.promptMaskMaxAbsDiff ?? 0) > gpuPromptMaskTolerance
      || (parity.promptTokenIdMismatchCount ?? 0) > 0
      || (parity.promptAttentionMaskMismatchCount ?? 0) > 0
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
    }

    const selectionKeep = result.debugReadback.selectionKeep
      ? new Uint32Array(result.debugReadback.selectionKeep)
      : null;
    const selectedCandidateCount = selectionKeep
      ? selectionKeep.reduce((count, keep) => count + (keep ? 1 : 0), 0)
      : null;
    if (!verificationAttached && !gpuBinary) {
      throw new Error('execution-only SAM3 invocation produced no binary mask readback');
    }
    if (gpuBinary) {
      const maskElementCount = visualShape.height * visualShape.width;
      const selectedMaskOffset = selectedMaskIndex * maskElementCount;
      const selectedMask = selectedCandidateCount === 0
        ? new Uint32Array(maskElementCount)
        : gpuBinary.slice(selectedMaskOffset, selectedMaskOffset + maskElementCount);
      const selectedLogits = selectedCandidateCount === 0
        ? new Float32Array(maskElementCount)
        : gpuLogits?.slice(selectedMaskOffset, selectedMaskOffset + maskElementCount) || null;
      const executionAuthority = {
        outputAuthority: 'actual-webgpu-readback',
        verificationState: 'not-attached',
      };
      visualOutput = {
        schema: 'kaminos.sam3-semantic-mask-visual-output.v0',
        invocationId,
        ...executionAuthority,
        promptText: manifest.prompt?.text || null,
        promptSha256: manifest.prompt?.sha256 || null,
        sourceImage: manifest.sourceImage || null,
        requestedRouteId: manifest.routeId,
        effectiveRouteId: result.receipt.effectiveRouteId,
        receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
        selectedCandidateCount,
        selectedMaskIndex: selectedCandidateCount === 0 ? null : selectedMaskIndex,
        selectedMaskIndexSource,
        selectedScore: selectedCandidateCount === 0 ? 0 : debugReadbackSamples.selectedScore?.[0] ?? null,
        selectedBox: selectedCandidateCount === 0
          ? [0, 0, 0, 0]
          : result.debugReadback.selectedBox
            ? Array.from(new Float32Array(result.debugReadback.selectedBox).slice(0, 4))
            : null,
        width: visualShape.width,
        height: visualShape.height,
        mask: selectedMask,
        logits: selectedLogits,
        foregroundPixelCount: selectedMask.reduce((count, value) => count + (value ? 1 : 0), 0),
        completedAt: new Date().toISOString(),
      };
      if (verificationAttached) visualOutput.verificationState = 'verified-passed';
    }

    if (verificationAttached && hasMaskOutput) {
      drawVisualWitness({
        sourceImage,
        sourceImageIdentity: manifest.sourceImage || null,
        expected: expectedBinary,
        actual: gpuBinary,
        shape: visualShape,
        selectedMaskIndex,
      });
    } else if (verificationAttached) {
      drawScoringWitness({
        sourceImage,
        sourceImageIdentity: manifest.sourceImage || null,
        expected: expectedPredLogits,
        actual: gpuPredLogits,
      });
    }
    state.status = verificationAttached ? 'passed' : 'executed';
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
    state.imagePatchEmbedEvidence = payload.imagePatchEmbedEvidence ? {
      ...payload.imagePatchEmbedEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      patchEmbeddingsTensorSha256: result.compositionEdge?.patchEmbeddingsTensorSha256 || null,
      patchEmbeddingsOutput: result.compositionEdge?.patchEmbeddingsOutput || null,
      patchProjectionWeightSha256: result.compositionEdge?.patchProjectionWeightSha256 || null,
      parity: {
        patchEmbeddingsMaxAbsDiff: parity.patchEmbeddingsMaxAbsDiff,
        imagePatchEmbedCpuMaxAbsDiff: parity.imagePatchEmbedCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.patchEmbeddings,
    } : null;
    state.imageVitPrefixEvidence = payload.imageVitPrefixEvidence ? {
      ...payload.imageVitPrefixEvidence,
      receipt: result.compositionRouteReceipts?.find(receipt => receipt.effectiveRouteId === SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID) || null,
      receiptChain: (result.compositionRouteReceipts || []).map(receipt => receipt.effectiveRouteId),
      vitPrefixHiddenStatesTensorSha256: result.compositionEdge?.vitPrefixHiddenStatesTensorSha256 || null,
      vitPrefixHiddenStatesOutput: result.compositionEdge?.vitPrefixHiddenStatesOutput || null,
      positionEmbeddingsSha256: result.compositionEdge?.positionEmbeddingsSha256 || null,
      backboneLayerNormWeightSha256: result.compositionEdge?.backboneLayerNormWeightSha256 || null,
      backboneLayerNormBiasSha256: result.compositionEdge?.backboneLayerNormBiasSha256 || null,
      parity: {
        vitPrefixHiddenStatesMaxAbsDiff: parity.vitPrefixHiddenStatesMaxAbsDiff,
        imageVitPrefixCpuMaxAbsDiff: parity.imageVitPrefixCpuMaxAbsDiff,
      },
      debugReadbackSample: debugReadbackSamples.vitPrefixHiddenStates,
    } : null;
    state.debugReadbackSamples = debugReadbackSamples;
    state.parity = parity;
    state.staticArtifactCacheEvidence = staticArtifactCache.evidence();
    renderSummary({
      status: state.status,
      route: state.effectiveRouteId,
      mode: manifest.mode,
      adapter: state.backendIdentity?.adapterName,
      selectedMask: selectedMaskIndex,
      logitsDiff: parity.maskLogitsMaxAbsDiff ?? parity.predLogitsMaxAbsDiff,
      binaryMismatch: parity.binaryMismatchCount,
    });
    setStatus(
      state.status,
      verificationAttached
        ? 'WebGPU parity passed'
        : 'WebGPU execution completed; reference verification not attached',
    );
    return visualOutput;
  } catch (error) {
    state.status = 'failed';
    state.error = String(error?.stack || error?.message || error);
    state.staticArtifactCacheEvidence = staticArtifactCache.evidence();
    setStatus('failed', state.error);
    throw error;
  }
}

let invocationPromise = null;
window.runSam3Invocation = (manifestUrl, invocationOptions = {}) => {
  if (invocationPromise) throw new Error('SAM3 browser invocation already in flight');
  resetInvocationState();
  const run = main(manifestUrl, invocationOptions);
  invocationPromise = run;
  const clearInvocation = () => {
    if (invocationPromise === run) invocationPromise = null;
  };
  run.then(clearInvocation, clearInvocation);
  return run;
};

if (params.get('autorun') !== '0') window.runSam3Invocation(initialManifestUrl);
