import {
  createRouteInvocationRequest,
  createSam3ImagePatchEmbedPhaseProgramRouteDefinition,
  createSam3ImagePreprocessPhaseProgramRouteDefinition,
  createSam3ImageVitBlockStackPhaseProgramRouteDefinition,
  createSam3ImageVitPrefixPhaseProgramRouteDefinition,
  createSam31DecoderHighResolutionProjectionPhaseProgramRouteDefinition,
  createSam31ImagePropagationNeckPhaseProgramRouteDefinition,
  createSam31InteractiveNeckPhaseProgramRouteDefinition,
  runSam3ImagePatchEmbedPhaseProgramRoute,
  runSam3ImagePreprocessPhaseProgramRoute,
  runSam3ImageVitBlockStackPhaseProgramRoute,
  runSam3ImageVitPrefixPhaseProgramRoute,
  runSam31DecoderHighResolutionProjectionPhaseProgramRoute,
  runSam31ImagePropagationNeckPhaseProgramRoute,
  runSam31InteractiveNeckPhaseProgramRoute,
  verifySam31PacketFloat32Bytes,
} from '../src/index.js';

function entryMap(entries) {
  return new Map(entries.map(entry => [entry.role, entry]));
}

export function resolveSam31SpatialPositionEmbeddings({ values, shape, hiddenSize }) {
  if (!(values instanceof Float32Array)) throw new TypeError('SAM 3.1 position embeddings must be a Float32Array');
  if (!Array.isArray(shape) || shape.length !== 3 || shape[0] !== 1 || shape[2] !== hiddenSize) {
    throw new Error(`SAM 3.1 position embedding shape must be [1,N,${hiddenSize}]`);
  }
  if (values.length !== shape[1] * hiddenSize) throw new Error('SAM 3.1 position embedding values do not match the declared shape');
  const spatialPositionCount = shape[1] - 1;
  const pretrainGridSize = Math.sqrt(spatialPositionCount);
  if (!Number.isInteger(pretrainGridSize)) throw new Error(`SAM 3.1 spatial position count ${spatialPositionCount} is not square`);
  return {
    pretrainGridSize,
    positionEmbeddings: values.slice(hiddenSize),
  };
}

export function maximumSam31ParityValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.abs(value) : Number.POSITIVE_INFINITY;
  if (Array.isArray(value)) return value.reduce((maximum, item) => Math.max(maximum, maximumSam31ParityValue(item)), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((maximum, item) => Math.max(maximum, maximumSam31ParityValue(item)), 0);
  return 0;
}

function maxAbs(left, right) {
  if (left.length !== right.length) throw new Error(`two-image parity length mismatch ${left.length} != ${right.length}`);
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new Error(`two-image non-finite parity value at ${index}`);
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

async function sha256Bytes(values) {
  const bytes = values instanceof Uint8Array
    ? values
    : new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function sha256Text(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function routeOutput(result, role) {
  const output = result.receipt.outputs.find(item => item.role === role);
  if (!output?.artifactId || !output?.sha256) throw new Error(`two-image route output identity missing: ${role}`);
  return output;
}

function modelFor(manifest) {
  return { id: manifest.reference.model.id, revision: manifest.reference.model.revision, dtype: 'fp32' };
}

function kernel(profile, commit) {
  return { profile, commit: commit || null };
}

function scopedArtifactId(value, invocationTag) {
  return invocationTag ? `${value}:${invocationTag}` : value;
}

function sourceArtifact(manifest, frameIndex) {
  const source = manifest.sourceImages[frameIndex];
  return {
    artifactId: `sam31-two-image:frame-${frameIndex}:rgba`,
    sha256: source.rgbaSha256,
    shape: [manifest.shape.imageHeight, manifest.shape.imageWidth, 4],
  };
}

function blockWeightRoles() {
  const suffixes = [
    'layernorm1-weight', 'layernorm1-bias',
    'q-proj-weight', 'q-proj-bias', 'k-proj-weight', 'k-proj-bias', 'v-proj-weight', 'v-proj-bias', 'o-proj-weight', 'o-proj-bias',
    'layernorm2-weight', 'layernorm2-bias', 'mlp-fc1-weight', 'mlp-fc1-bias', 'mlp-fc2-weight', 'mlp-fc2-bias',
  ];
  return Array.from({ length: 32 }, (_, layerIndex) => suffixes.map(suffix => `vit-block-stack-layer${layerIndex}-${suffix}`)).flat();
}

async function loadFloat(base, entry) {
  if (!entry) throw new Error('two-image packet entry is missing');
  const response = await fetch(`${base}/${entry.file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${base}/${entry.file} failed ${response.status}`);
  return verifySam31PacketFloat32Bytes(entry, await response.arrayBuffer());
}

async function loadRgba(base, entry) {
  const response = await fetch(`${base}/${entry.file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${base}/${entry.file} failed ${response.status}`);
  const values = new Uint8Array(await response.arrayBuffer());
  if (values.byteLength !== entry.byteLength) throw new Error(`${entry.role} byte length mismatch`);
  const digest = await sha256Bytes(values);
  if (digest !== entry.sha256) throw new Error(`${entry.role} digest mismatch: ${digest} != ${entry.sha256}`);
  return values;
}

async function compareExpected(actual, entry, loadFloat32, verificationAttached) {
  return verificationAttached ? maxAbs(actual, await loadFloat32(entry)) : null;
}

async function loadBlockWeights(loadFloat32, weightsByRole) {
  const layers = [];
  for (let layerIndex = 0; layerIndex < 32; layerIndex += 1) {
    const load = suffix => loadFloat32(weightsByRole.get(`vit-block-stack-layer${layerIndex}-${suffix}`));
    layers.push({
      layerIndex,
      isGlobal: [7, 15, 23, 31].includes(layerIndex),
      layerNorm1Weight: await load('layernorm1-weight'), layerNorm1Bias: await load('layernorm1-bias'),
      qProjWeight: await load('q-proj-weight'), qProjBias: await load('q-proj-bias'),
      kProjWeight: await load('k-proj-weight'), kProjBias: await load('k-proj-bias'),
      vProjWeight: await load('v-proj-weight'), vProjBias: await load('v-proj-bias'),
      oProjWeight: await load('o-proj-weight'), oProjBias: await load('o-proj-bias'),
      layerNorm2Weight: await load('layernorm2-weight'), layerNorm2Bias: await load('layernorm2-bias'),
      mlpFc1Weight: await load('mlp-fc1-weight'), mlpFc1Bias: await load('mlp-fc1-bias'),
      mlpFc2Weight: await load('mlp-fc2-weight'), mlpFc2Bias: await load('mlp-fc2-bias'),
    });
  }
  return { layers };
}

async function loadNeckWeights(loadFloat32, weightsByRole, branch) {
  const load = role => loadFloat32(weightsByRole.get(role));
  const conv = async (prefix, kernelSize, stride, padding, inChannels, outChannels, activation = null) => ({
    weight: await load(`${prefix}-weight`), bias: await load(`${prefix}-bias`),
    kernelSize, stride, padding, inChannels, outChannels, activation,
  });
  return {
    levels: [
      {
        level: 0,
        scaleLayers: [
          await conv(`${branch}-level-0-scale-0`, 2, 2, 0, 1024, 512, 'gelu'),
          await conv(`${branch}-level-0-scale-1`, 2, 2, 0, 512, 256),
        ],
        proj1: await conv(`${branch}-level-0-proj1`, 1, 1, 0, 256, 256),
        proj2: await conv(`${branch}-level-0-proj2`, 3, 1, 1, 256, 256),
      },
      {
        level: 1,
        scaleLayers: [await conv(`${branch}-level-1-scale-0`, 2, 2, 0, 1024, 512)],
        proj1: await conv(`${branch}-level-1-proj1`, 1, 1, 0, 512, 256),
        proj2: await conv(`${branch}-level-1-proj2`, 3, 1, 1, 256, 256),
      },
      {
        level: 2,
        scaleLayers: [],
        proj1: await conv(`${branch}-level-2-proj1`, 1, 1, 0, 1024, 256),
        proj2: await conv(`${branch}-level-2-proj2`, 3, 1, 1, 256, 256),
      },
    ],
  };
}

function request(route, requestId, inputs, outputs, routeConfig = {}, requestIds = null) {
  const value = createRouteInvocationRequest(route, { requestId, inputs, outputs, routeConfig });
  requestIds?.push(value.requestId);
  return value;
}

async function runFrameTrunk({ frameIndex, manifest, tensorsByRole, weightsByRole, rgba, patchProjection, prefixWeights, blockWeights, blockWeightsHash, adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds }) {
  const source = sourceArtifact(manifest, frameIndex);
  const model = modelFor(manifest);
  const preprocessShape = { batch: 1, height: manifest.shape.imageHeight, width: manifest.shape.imageWidth, channels: manifest.shape.imageChannels };
  const patchShape = { batch: 1, imageHeight: manifest.shape.imageHeight, imageWidth: manifest.shape.imageWidth, imageChannels: manifest.shape.imageChannels, patchSize: manifest.shape.patchSize, patchHeight: manifest.shape.patchHeight, patchWidth: manifest.shape.patchWidth, hiddenSize: manifest.shape.visionHiddenSize };
  const prefixShape = { batch: 1, patchHeight: manifest.shape.patchHeight, patchWidth: manifest.shape.patchWidth, hiddenSize: manifest.shape.visionHiddenSize, pretrainGridSize: prefixWeights.pretrainGridSize };
  const blockShape = { batch: 1, height: manifest.shape.patchHeight, width: manifest.shape.patchWidth, hiddenSize: manifest.shape.visionHiddenSize, numHeads: manifest.shape.visionHeads, windowSize: manifest.shape.visionWindowSize, intermediateSize: manifest.shape.visionMlpHidden, layerNormEps: 0.000001, ropeTheta: 10000, ropePretrainGridSize: prefixWeights.pretrainGridSize, interpolateRope: true, startLayerIndex: 0, endLayerIndex: 31, firstGlobalLayerIndex: 7, finalLayerIndex: 31, fullBackbone: true, globalAttnIndexes: [7, 15, 23, 31] };
  const receipts = [];
  const routes = [];
  const parity = {};

  update(`frame-${frameIndex}-image-preprocess`);
  const preprocessRoute = createSam3ImagePreprocessPhaseProgramRouteDefinition({ model, kernel: kernel('sam3-image-preprocess-phase-program-v0', commit) });
  const preprocessResult = await runSam3ImagePreprocessPhaseProgramRoute({
    request: request(preprocessRoute, `sam31-two-image-preprocess-${frameIndex}-${Date.now()}`, {
      'source-image': source,
      'sam3-image-preprocess-tensors': { artifactId: `sam31-two-image:frame-${frameIndex}:preprocess-input`, sha256: source.sha256 },
    }, { 'pixel-values': { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:pixel-values`, invocationTag), shape: [1, preprocessShape.height, preprocessShape.width, 3] } }, {}, requestIds),
    route: preprocessRoute, adapter, device, queue: device.queue, adapterName: adapter.info?.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { ...model, weightsHash: 'none', dtype: 'u8-to-fp32' }, kernel: preprocessRoute.kernel, tensors: { rgba, shape: preprocessShape }, includeReadback: true,
  });
  const pixelValues = new Float32Array(preprocessResult.debugReadback.pixelValues);
  parity.pixelValues = await compareExpected(pixelValues, tensorsByRole.get(`frame-${frameIndex}-pixel-values`), loadFloat32, verificationAttached);
  receipts.push(preprocessResult.receipt); routes.push(preprocessRoute.routeId);
  const pixelOutput = routeOutput(preprocessResult, 'pixel-values');

  update(`frame-${frameIndex}-patch-embed`);
  const patchRoute = createSam3ImagePatchEmbedPhaseProgramRouteDefinition({ model, kernel: kernel('sam3-image-patch-embed-phase-program-v0', commit) });
  const patchResult = await runSam3ImagePatchEmbedPhaseProgramRoute({
    request: request(patchRoute, `sam31-two-image-patch-${frameIndex}-${Date.now()}`, {
      'source-image': source, 'pixel-values': pixelOutput,
      'sam3-image-patch-embed-weights': { artifactId: 'sam31-two-image:patch-weights', sha256: weightsByRole.get('patch-embed-projection-weight').sha256 },
    }, { 'patch-embeddings': { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:patch-embeddings`, invocationTag), shape: [1, manifest.shape.patchTokens, manifest.shape.visionHiddenSize] } }, {}, requestIds),
    route: patchRoute, adapter, device, queue: device.queue, adapterName: adapter.info?.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { ...model, weightsHash: weightsByRole.get('patch-embed-projection-weight').sha256 }, kernel: patchRoute.kernel, tensors: { pixelValues, weights: { projection: patchProjection }, shape: patchShape }, includeReadback: true,
  });
  const patchEmbeddings = new Float32Array(patchResult.debugReadback.patchEmbeddings);
  parity.patchEmbeddings = await compareExpected(patchEmbeddings, tensorsByRole.get(`frame-${frameIndex}-patch-embeddings`), loadFloat32, verificationAttached);
  receipts.push(patchResult.receipt); routes.push(patchRoute.routeId);
  const patchOutput = routeOutput(patchResult, 'patch-embeddings');

  update(`frame-${frameIndex}-vit-prefix`);
  const prefixHash = await sha256Text(['vit-position-embeddings', 'vit-backbone-layernorm-weight', 'vit-backbone-layernorm-bias'].map(role => `${role}:${weightsByRole.get(role).sha256}`).join('\n'));
  const prefixRoute = createSam3ImageVitPrefixPhaseProgramRouteDefinition({ model, kernel: kernel('sam3-image-vit-prefix-phase-program-v0', commit) });
  const prefixResult = await runSam3ImageVitPrefixPhaseProgramRoute({
    request: request(prefixRoute, `sam31-two-image-prefix-${frameIndex}-${Date.now()}`, {
      'source-image': source, 'patch-embeddings': patchOutput,
      'sam3-image-vit-prefix-weights': { artifactId: 'sam31-two-image:prefix-weights', sha256: prefixHash },
    }, { 'vit-prefix-hidden-states': { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:vit-prefix`, invocationTag), shape: [1, manifest.shape.patchHeight, manifest.shape.patchWidth, manifest.shape.visionHiddenSize] } }, {}, requestIds),
    route: prefixRoute, adapter, device, queue: device.queue, adapterName: adapter.info?.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { ...model, weightsHash: prefixHash }, kernel: prefixRoute.kernel, tensors: { patchEmbeddings, weights: prefixWeights.values, shape: prefixShape }, includeReadback: true,
  });
  const prefixHiddenStates = new Float32Array(prefixResult.debugReadback.vitPrefixHiddenStates);
  parity.vitPrefix = await compareExpected(prefixHiddenStates, tensorsByRole.get(`frame-${frameIndex}-vit-prefix-hidden-states`), loadFloat32, verificationAttached);
  receipts.push(prefixResult.receipt); routes.push(prefixRoute.routeId);
  const prefixOutput = routeOutput(prefixResult, 'vit-prefix-hidden-states');

  update(`frame-${frameIndex}-vit-block-stack`);
  const stackRoute = createSam3ImageVitBlockStackPhaseProgramRouteDefinition({ model, kernel: kernel('sam3-image-vit-block-stack-phase-program-v0', commit) });
  const stackResult = await runSam3ImageVitBlockStackPhaseProgramRoute({
    request: request(stackRoute, `sam31-two-image-stack-${frameIndex}-${Date.now()}`, {
      'source-image': source, 'vit-prefix-hidden-states': prefixOutput,
      'sam3-image-vit-block-stack-weights': { artifactId: 'sam31-two-image:block-stack-weights', sha256: blockWeightsHash },
    }, { 'vit-block-stack-hidden-states': { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:vit-backbone`, invocationTag), shape: [1, manifest.shape.patchHeight, manifest.shape.patchWidth, manifest.shape.visionHiddenSize] } }, {}, requestIds),
    route: stackRoute, adapter, device, queue: device.queue, adapterName: adapter.info?.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { ...model, weightsHash: blockWeightsHash }, kernel: stackRoute.kernel, tensors: { hiddenStates: prefixHiddenStates, weights: blockWeights, shape: blockShape }, includeReadback: true, validateFiniteCheckpoints: true,
  });
  const backboneHiddenStates = new Float32Array(stackResult.debugReadback.vitBlockStackHiddenStates);
  parity.vitBackbone = await compareExpected(backboneHiddenStates, tensorsByRole.get(`frame-${frameIndex}-vit-backbone-hidden-states`), loadFloat32, verificationAttached);
  receipts.push(stackResult.receipt); routes.push(stackRoute.routeId);
  return { backboneHiddenStates, backboneOutput: routeOutput(stackResult, 'vit-block-stack-hidden-states'), receipts, routes, parity, source };
}

async function runNeck({ branch, frameIndex, manifest, tensorsByRole, weightsByRole, weights, backbone, adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds }) {
  update(`frame-${frameIndex}-${branch}-neck`);
  const isInteractive = branch === 'interactive';
  const factory = isInteractive ? createSam31InteractiveNeckPhaseProgramRouteDefinition : createSam31ImagePropagationNeckPhaseProgramRouteDefinition;
  const runner = isInteractive ? runSam31InteractiveNeckPhaseProgramRoute : runSam31ImagePropagationNeckPhaseProgramRoute;
  const route = factory({ model: modelFor(manifest), kernel: kernel(`sam31-${branch}-neck-phase-program-v0`, commit) });
  const weightsHash = await sha256Text(Array.from(weightsByRole.values()).filter(entry => entry.role.startsWith(`${branch}-`)).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const outputPrefix = `sam31-${branch}`;
  const outputs = {};
  for (let level = 0; level < 3; level += 1) outputs[`${outputPrefix}-feature-${level}`] = { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:${branch}-feature-${level}`, invocationTag), shape: [1, manifest.shape.fpnLevels[level].height, manifest.shape.fpnLevels[level].width, 256] };
  outputs[`${outputPrefix}-position-2`] = { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:${branch}-position-2`, invocationTag), shape: [1, manifest.shape.patchHeight, manifest.shape.patchWidth, 256] };
  const result = await runner({
    request: request(route, `sam31-two-image-${branch}-${frameIndex}-${Date.now()}`, {
      'source-image': backbone.source, 'sam31-vit-backbone-hidden-states': backbone.backboneOutput,
      [`sam31-${branch}-neck-weights`]: { artifactId: `sam31-two-image:${branch}-neck-weights`, sha256: weightsHash },
    }, outputs, {}, requestIds),
    route, adapter, device, queue: device.queue, adapterName: adapter.info?.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { ...modelFor(manifest), weightsHash }, kernel: route.kernel,
    tensors: { backboneHiddenStates: backbone.backboneHiddenStates, weights, shape: { batch: 1, backboneHeight: manifest.shape.patchHeight, backboneWidth: manifest.shape.patchWidth, backboneChannels: manifest.shape.visionHiddenSize, fpnHiddenSize: 256, levels: manifest.shape.fpnLevels } }, includeReadback: true,
  });
  const features = [];
  const parity = {};
  for (let level = 0; level < 3; level += 1) {
    features[level] = new Float32Array(result.debugReadback[`${branch}Feature${level}`]);
    parity[`feature${level}`] = await compareExpected(features[level], tensorsByRole.get(`frame-${frameIndex}-${branch}-feature-${level}`), loadFloat32, verificationAttached);
  }
  const position2 = new Float32Array(result.debugReadback[`${branch}Position2`]);
  parity.position2 = await compareExpected(position2, tensorsByRole.get(`frame-${frameIndex}-${branch}-position-2`), loadFloat32, verificationAttached);
  return { result, route, features, position2, parity };
}

async function runHighResolution({ branch, frameIndex, manifest, tensorsByRole, weightsByRole, weights, neck, adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds }) {
  update(`frame-${frameIndex}-${branch}-high-resolution`);
  const route = createSam31DecoderHighResolutionProjectionPhaseProgramRouteDefinition({ model: modelFor(manifest), kernel: kernel('sam31-decoder-high-resolution-projection-phase-program-v0', commit) });
  const weightsHash = await sha256Text(['decoder-high-resolution-s0-weight', 'decoder-high-resolution-s0-bias', 'decoder-high-resolution-s1-weight', 'decoder-high-resolution-s1-bias'].map(role => `${role}:${weightsByRole.get(role).sha256}`).join('\n'));
  const feature0 = routeOutput(neck.result, `sam31-${branch}-feature-0`);
  const feature1 = routeOutput(neck.result, `sam31-${branch}-feature-1`);
  const result = await runSam31DecoderHighResolutionProjectionPhaseProgramRoute({
    request: request(route, `sam31-two-image-high-resolution-${branch}-${frameIndex}-${Date.now()}`, {
      'source-image': sourceArtifact(manifest, frameIndex),
      'sam31-decoder-high-resolution-feature-0': feature0,
      'sam31-decoder-high-resolution-feature-1': feature1,
      'sam31-decoder-high-resolution-projection-weights': { artifactId: 'sam31-two-image:decoder-high-resolution-weights', sha256: weightsHash },
    }, {
      'sam31-decoder-high-resolution-s0': { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:${branch}-high-resolution-s0`, invocationTag), shape: [1, 32, manifest.shape.fpnLevels[0].height, manifest.shape.fpnLevels[0].width] },
      'sam31-decoder-high-resolution-s1': { artifactId: scopedArtifactId(`sam31-two-image:frame-${frameIndex}:${branch}-high-resolution-s1`, invocationTag), shape: [1, 64, manifest.shape.fpnLevels[1].height, manifest.shape.fpnLevels[1].width] },
    }, {}, requestIds),
    route, adapter, device, queue: device.queue, adapterName: adapter.info?.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { ...modelFor(manifest), weightsHash }, kernel: route.kernel,
    tensors: { feature0: neck.features[0], feature1: neck.features[1], shape: { batch: 1, feature0Height: manifest.shape.fpnLevels[0].height, feature0Width: manifest.shape.fpnLevels[0].width, feature1Height: manifest.shape.fpnLevels[1].height, feature1Width: manifest.shape.fpnLevels[1].width, inputChannels: 256, s0Channels: 32, s1Channels: 64 }, weights }, includeReadback: true,
  });
  const highResolutionS0 = new Float32Array(result.debugReadback.highResolutionS0);
  const highResolutionS1 = new Float32Array(result.debugReadback.highResolutionS1);
  const rolePrefix = frameIndex === 0 ? 'frame-0-interactive-high-resolution' : 'frame-1-high-resolution';
  return {
    result, route, highResolutionS0, highResolutionS1,
    parity: {
      highResolutionS0: await compareExpected(highResolutionS0, tensorsByRole.get(`${rolePrefix}-s0`), loadFloat32, verificationAttached),
      highResolutionS1: await compareExpected(highResolutionS1, tensorsByRole.get(`${rolePrefix}-s1`), loadFloat32, verificationAttached),
    },
  };
}

export async function runSam31TwoImageBackbone({
  manifest,
  adapter,
  device,
  errors,
  commit = null,
  update = () => {},
  loadFloat32: packageLoadFloat32 = null,
  loadUint8: packageLoadUint8 = null,
  verificationAttached = true,
  invocationTag = null,
}) {
  if (manifest.schema !== 'kaminos.sam31-two-image-ingress-meta-packet.v0') throw new Error(`unsupported two-image ingress ${manifest.schema}`);
  const base = '/oracle/ingress';
  const loadFloat32 = packageLoadFloat32 || (entry => loadFloat(base, entry));
  const loadUint8 = packageLoadUint8 || (entry => loadRgba(base, entry));
  const tensorsByRole = entryMap(manifest.tensors);
  const weightsByRole = entryMap(manifest.weights);
  const requestIds = [];
  const rgba = [await loadUint8(tensorsByRole.get('frame-0-rgba')), await loadUint8(tensorsByRole.get('frame-1-rgba'))];
  if (await sha256Bytes(rgba[0]) === await sha256Bytes(rgba[1])) throw new Error('two-image browser ingress collapsed to identical RGBA tensors');

  update('load-trunk-weights');
  const patchProjection = await loadFloat32(weightsByRole.get('patch-embed-projection-weight'));
  const positionEntry = weightsByRole.get('vit-position-embeddings');
  const spatialPositions = resolveSam31SpatialPositionEmbeddings({
    values: await loadFloat32(positionEntry),
    shape: positionEntry.shape,
    hiddenSize: manifest.shape.visionHiddenSize,
  });
  const prefixWeights = {
    pretrainGridSize: spatialPositions.pretrainGridSize,
    values: {
      positionEmbeddings: spatialPositions.positionEmbeddings,
      layerNormWeight: await loadFloat32(weightsByRole.get('vit-backbone-layernorm-weight')),
      layerNormBias: await loadFloat32(weightsByRole.get('vit-backbone-layernorm-bias')),
    },
  };
  const blockWeights = await loadBlockWeights(loadFloat32, weightsByRole);
  const blockWeightsHash = await sha256Text(blockWeightRoles().map(role => `${role}:${weightsByRole.get(role).sha256}`).join('\n'));
  const backbones = [];
  for (let frameIndex = 0; frameIndex < 2; frameIndex += 1) backbones.push(await runFrameTrunk({ frameIndex, manifest, tensorsByRole, weightsByRole, rgba: rgba[frameIndex], patchProjection, prefixWeights, blockWeights, blockWeightsHash, adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds }));
  blockWeights.layers.length = 0;

  update('load-interactive-neck-weights');
  const interactiveWeights = await loadNeckWeights(loadFloat32, weightsByRole, 'interactive');
  const interactive = await runNeck({ branch: 'interactive', frameIndex: 0, manifest, tensorsByRole, weightsByRole, weights: interactiveWeights, backbone: backbones[0], adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds });
  interactiveWeights.levels.length = 0;

  update('load-propagation-neck-weights');
  const propagationWeights = await loadNeckWeights(loadFloat32, weightsByRole, 'propagation');
  const propagation = [];
  for (let frameIndex = 0; frameIndex < 2; frameIndex += 1) propagation.push(await runNeck({ branch: 'propagation', frameIndex, manifest, tensorsByRole, weightsByRole, weights: propagationWeights, backbone: backbones[frameIndex], adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds }));
  propagationWeights.levels.length = 0;

  const projectionWeights = {
    s0: { weight: await loadFloat32(weightsByRole.get('decoder-high-resolution-s0-weight')), bias: await loadFloat32(weightsByRole.get('decoder-high-resolution-s0-bias')) },
    s1: { weight: await loadFloat32(weightsByRole.get('decoder-high-resolution-s1-weight')), bias: await loadFloat32(weightsByRole.get('decoder-high-resolution-s1-bias')) },
  };
  const frame0High = await runHighResolution({ branch: 'interactive', frameIndex: 0, manifest, tensorsByRole, weightsByRole, weights: projectionWeights, neck: interactive, adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds });
  const frame1High = await runHighResolution({ branch: 'propagation', frameIndex: 1, manifest, tensorsByRole, weightsByRole, weights: projectionWeights, neck: propagation[1], adapter, device, commit, update, loadFloat32, verificationAttached, invocationTag, requestIds });

  const receipts = [
    ...backbones[0].receipts, ...backbones[1].receipts,
    interactive.result.receipt, propagation[0].result.receipt, propagation[1].result.receipt,
    frame0High.result.receipt, frame1High.result.receipt,
  ];
  const requestedRouteIds = [
    ...backbones[0].routes, ...backbones[1].routes,
    interactive.route.routeId, propagation[0].route.routeId, propagation[1].route.routeId,
    frame0High.route.routeId, frame1High.route.routeId,
  ];
  const maximums = {
    frame0: { ...backbones[0].parity, interactive: interactive.parity, propagation: propagation[0].parity, highResolution: frame0High.parity },
    frame1: { ...backbones[1].parity, propagation: propagation[1].parity, highResolution: frame1High.parity },
  };
  const parityMaximum = maximumSam31ParityValue(maximums);
  const routeChainPassed = receipts.every((receipt, index) => receipt.status === 'real' && receipt.fallbackReason == null && receipt.effectiveRouteId === requestedRouteIds[index]);
  const tolerances = manifest.tolerances;
  const parityPassed = !verificationAttached || (backbones.every(frame => frame.parity.pixelValues <= tolerances.pixelValuesMaxAbsDiff && frame.parity.patchEmbeddings <= tolerances.patchEmbeddingsMaxAbsDiff && frame.parity.vitPrefix <= tolerances.vitPrefixMaxAbsDiff && frame.parity.vitBackbone <= tolerances.vitBackboneMaxAbsDiff)
    && Object.values(interactive.parity).every(value => value <= (value === interactive.parity.position2 ? tolerances.positionMaxAbsDiff : tolerances.neckMaxAbsDiff))
    && propagation.every(neck => Object.entries(neck.parity).every(([name, value]) => value <= (name === 'position2' ? tolerances.positionMaxAbsDiff : tolerances.neckMaxAbsDiff)))
    && [frame0High, frame1High].every(item => Object.values(item.parity).every(value => value <= tolerances.highResolutionMaxAbsDiff)));
  if (errors.length) throw new Error(`two-image backbone uncaptured WebGPU errors: ${errors.join('; ')}`);
  if (!routeChainPassed || !parityPassed) throw Object.assign(new Error(`two-image backbone evidence failed: ${JSON.stringify({ routeChainPassed, parityPassed, maximums })}`), { backboneEvidence: { routeChainPassed, parityPassed, maximums } });
  return {
    frame0: { interactiveEmbedding: interactive.features[2], interactivePosition: interactive.position2, interactiveHighResolutionS0: frame0High.highResolutionS0, interactiveHighResolutionS1: frame0High.highResolutionS1, propagationEmbedding: propagation[0].features[2], propagationPosition: propagation[0].position2 },
    frame1: { propagationEmbedding: propagation[1].features[2], propagationPosition: propagation[1].position2, highResolutionS0: frame1High.highResolutionS0, highResolutionS1: frame1High.highResolutionS1 },
    receipts, requestIds, requestedRouteIds, effectiveRouteIds: receipts.map(receipt => receipt.effectiveRouteId), parity: verificationAttached ? maximums : null, parityMaximum: verificationAttached ? parityMaximum : null, routeChainPassed, parityPassed, verificationAttached,
    sourceImageSha256: manifest.sourceImages.map(image => image.rgbaSha256),
  };
}
