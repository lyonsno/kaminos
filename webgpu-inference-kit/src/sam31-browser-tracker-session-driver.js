import { createRouteInvocationRequest } from './route-boundary.js';
import { createSam31TrackerState, getSam31TrackerStateSnapshot, insertSam31TrackerFrame, prepareSam31TrackerTemporalInputs } from './sam31-tracker-state.js';
import { createSam31MemoryAttentionPhaseProgramRouteDefinition, runSam31MemoryAttentionPhaseProgramRoute } from './sam31-memory-attention-phase-program.js';
import { createSam31MaskConditioningPhaseProgramRouteDefinition, runSam31MaskConditioningPhaseProgramRoute } from './sam31-mask-conditioning-phase-program.js';
import { createSam31InteractivePointerPhaseProgramRouteDefinition, runSam31InteractivePointerPhaseProgramRoute } from './sam31-interactive-pointer-phase-program.js';
import { createSam31MemoryEncoderPhaseProgramRouteDefinition, runSam31MemoryEncoderPhaseProgramRoute } from './sam31-memory-encoder-phase-program.js';
import { createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition, runSam31MultiplexMaskDecoderPhaseProgramRoute } from './sam31-multiplex-mask-decoder-phase-program.js';
import { createSam31TemporalMemoryBankPhaseProgramRouteDefinition, runSam31TemporalMemoryBankPhaseProgramRoute } from './sam31-temporal-memory-bank-phase-program.js';
import { runSam31TwoImageBackbone } from './sam31-two-image-backbone.js';

const TRACKER_PACKET_NAMES = Object.freeze(['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer']);

function resolvedArtifactPassed(artifact, schema) {
  return artifact?.schema === schema
    && typeof artifact.sha256 === 'string'
    && artifact.sha256 === artifact.effectiveSha256;
}

export function createSam31BrowserTrackerPackageAuthority(packageRuntime) {
  const verificationAttached = packageRuntime?.verificationAttached === true;
  const resolution = packageRuntime?.packageResolution;
  const packageExecutionAuthorityPassed = resolution?.schema === 'kaminos.sam31-browser-tracker-package-invocation-evidence.v0'
    && resolution.packageId === packageRuntime?.packageId
    && resolution.invocationId === packageRuntime?.invocationId
    && resolvedArtifactPassed(resolution.modelPackage, 'kaminos.sam31-browser-tracker-model-package.v0')
    && resolvedArtifactPassed(resolution.invocation, 'kaminos.sam31-browser-tracker-invocation.v0')
    && resolution.verification?.attached === verificationAttached
    && (verificationAttached
      ? packageRuntime?.verificationId != null
        && resolvedArtifactPassed(resolution.verification, 'kaminos.sam31-browser-tracker-verification.v0')
      : packageRuntime?.verificationId == null);
  const packets = packageRuntime?.componentAuthorities || {};
  const verifiedPackets = verificationAttached
    ? TRACKER_PACKET_NAMES.filter(name => packets[name]?.passed === true)
    : [];
  const componentVerificationPassed = verificationAttached
    ? verifiedPackets.length === TRACKER_PACKET_NAMES.length
    : null;
  const componentVerificationState = verificationAttached
    ? componentVerificationPassed ? 'verified' : 'failed'
    : 'not-attached';
  const componentVerificationGatePassed = !verificationAttached || componentVerificationPassed === true;
  return {
    passed: packageExecutionAuthorityPassed && componentVerificationGatePassed,
    packetSource: 'browser-package',
    authorityKind: 'authenticated-package-invocation',
    executablePackets: [...TRACKER_PACKET_NAMES],
    verifiedPackets,
    packets,
    packageId: packageRuntime?.packageId ?? null,
    invocationId: packageRuntime?.invocationId ?? null,
    verificationId: packageRuntime?.verificationId ?? null,
    verificationAttached,
    packageResolution: resolution ?? null,
    packageExecutionAuthorityPassed,
    componentVerificationState,
    componentVerificationPassed,
    componentVerificationGatePassed,
    pointerPacketDigestState: 'not-applicable',
    pointerPacketInputDigestPassed: null,
    pointerPacketOutputDigestPassed: null,
  };
}

async function sha256Bytes(values) {
  const digest = await crypto.subtle.digest('SHA-256', values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
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

function entryMap(entries) { return Object.fromEntries(entries.map(entry => [entry.role, entry])); }
function scopedArtifactId(value, invocationTag) { return `${value}:${invocationTag}`; }

async function loadDecoderWeights(manifest, loadFloat32) {
  const weights = {};
  for (const entry of manifest.weights) {
    const key = entry.group === 'decoder' ? entry.localKey : `${entry.group}.${entry.localKey}`;
    weights[key] = await loadFloat32(entry);
  }
  return weights;
}

async function loadInteractivePointerWeights(manifest, loadFloat32) {
  const weights = {};
  for (const entry of manifest.weights) {
    weights[`${entry.group}.${entry.localKey}`] = await loadFloat32(entry);
  }
  return weights;
}

async function loadMemoryWeights(manifest, loadFloat32) {
  const byRole = entryMap(manifest.weights);
  const weight = role => loadFloat32(byRole[role]);
  const conv = async (prefix, { stride = 1, padding = 0, activation = null, groups = 1 } = {}) => {
    const entry = byRole[`${prefix}-weight`];
    const [outChannels, kernelSize, , maybeInChannels] = entry.shape;
    return { weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), kernelSize, stride, padding, inChannels: maybeInChannels ?? outChannels, outChannels, activation, groups };
  };
  const result = { downsampleLayers: [], fuserLayers: [] };
  for (let level = 0; level < 4; level += 1) {
    result.downsampleLayers.push({ conv: await conv(`memory-downsample-${level}-conv`, { stride: 2, padding: 1 }), layerNorm: { weight: await weight(`memory-downsample-${level}-norm-weight`), bias: await weight(`memory-downsample-${level}-norm-bias`), epsilon: 1e-6 } });
  }
  result.maskFinal = await conv('memory-mask-final');
  result.featureProjection = await conv('memory-feature-projection');
  for (let level = 0; level < 2; level += 1) {
    const depthwise = await conv(`memory-fuser-${level}-depthwise`, { padding: 3, groups: 256 });
    depthwise.inChannels = 256;
    result.fuserLayers.push({
      depthwise,
      layerNorm: { weight: await weight(`memory-fuser-${level}-norm-weight`), bias: await weight(`memory-fuser-${level}-norm-bias`), epsilon: 1e-6 },
      pointwise1: { weight: await weight(`memory-fuser-${level}-pointwise-1-weight`), bias: await weight(`memory-fuser-${level}-pointwise-1-bias`), inChannels: 256, outChannels: 1024 },
      pointwise2: { weight: await weight(`memory-fuser-${level}-pointwise-2-weight`), bias: await weight(`memory-fuser-${level}-pointwise-2-bias`), inChannels: 1024, outChannels: 256 },
      scale: await weight(`memory-fuser-${level}-scale`),
    });
  }
  result.noObjectSpatialEmbedding = await weight('memory-no-object-spatial-embedding');
  return result;
}

async function loadAttentionWeights(manifest, loadFloat32) {
  const byRole = entryMap(manifest.attentionWeights);
  const weight = role => loadFloat32(byRole[role]);
  const projection = async (prefix, inChannels, outChannels) => ({ weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), inChannels, outChannels });
  const norm = async prefix => ({ weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), epsilon: 1e-5 });
  const layers = [];
  for (let index = 0; index < 4; index += 1) {
    const prefix = `layer-${index}`;
    layers.push({
      norm1: await norm(`${prefix}-norm1`), selfQ: await projection(`${prefix}-self-q`, 256, 256), selfK: await projection(`${prefix}-self-k`, 256, 256), selfV: await projection(`${prefix}-self-v`, 256, 256), selfOut: await projection(`${prefix}-self-out`, 256, 256),
      norm2: await norm(`${prefix}-norm2`), crossQ: await projection(`${prefix}-cross-q`, 256, 256), crossK: await projection(`${prefix}-cross-k`, 256, 256), crossV: await projection(`${prefix}-cross-v`, 256, 256), crossOut: await projection(`${prefix}-cross-out`, 256, 256), imageCrossQ: await projection(`${prefix}-image-cross-q`, 256, 256), imageCrossK: await projection(`${prefix}-image-cross-k`, 256, 256),
      norm3: await norm(`${prefix}-norm3`), linear1: await projection(`${prefix}-linear1`, 256, 2048), linear2: await projection(`${prefix}-linear2`, 2048, 256),
    });
  }
  return { layers, finalNorm: await norm('final-norm') };
}

async function decoderInvocation({ frame, inputs, expected, manifest, weights, weightsHash, adapter, device, adapterInfo, errors, commit, userAgent, invocationTag }) {
  const scopedOutputId = value => scopedArtifactId(value, invocationTag);
  const route = createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-multiplex-mask-decoder-phase-program-v0', commit: commit } });
  const sourceHash = await sha256Bytes(inputs.imageEmbedding);
  const request = createRouteInvocationRequest(route, {
    requestId: scopedArtifactId(`sam31-two-frame-decoder-${frame}-${Date.now()}`, invocationTag),
    inputs: {
      'source-frame': { artifactId: `sam31-two-frame:${frame}`, sha256: sourceHash, shape: [1] },
      'sam31-multiplex-decoder-tensors': { artifactId: `sam31-two-frame-decoder-tensors:${frame}`, sha256: sourceHash, shape: [5] },
      'sam31-multiplex-decoder-weights': { artifactId: 'sam31-multiplex-decoder-weights:official', sha256: weightsHash, mappedTensorCount: manifest.weights.length },
    },
    outputs: {
      'sam31-multiplex-sam-output-tokens': { artifactId: scopedOutputId(`sam31-two-frame-sam-tokens:${frame}`), shape: [1, 16, 3, 256] },
      'sam31-multiplex-mask-logits': { artifactId: scopedOutputId(`sam31-two-frame-mask-logits:${frame}`), shape: [16, 3, 8, 8] },
      'sam31-multiplex-selected-masks': { artifactId: scopedOutputId(`sam31-two-frame-selected-masks:${frame}`), shape: [16, 1, 8, 8] },
      'sam31-multiplex-object-scores': { artifactId: scopedOutputId(`sam31-two-frame-object-scores:${frame}`), shape: [16, 1] },
      'sam31-multiplex-object-pointers': { artifactId: scopedOutputId(`sam31-two-frame-object-pointers:${frame}`), shape: [16, 256] },
    },
  });
  const result = await runSam31MultiplexMaskDecoderPhaseProgramRoute({ request, route, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: userAgent, model: { revision: manifest.reference.model.revision, weightsHash }, kernel: route.kernel, tensors: { shape: manifest.shape, tensors: inputs, weights }, includeReadback: true });
  const parity = expected ? { selectedMasks: maxAbs(result.debugReadback.selectedMasks, expected.selectedMasks), objectScores: maxAbs(result.debugReadback.objectScores, expected.objectScores), objectPointers: maxAbs(result.debugReadback.objectPointers, expected.objectPointers) } : null;
  if (errors.length) throw new Error(`decoder ${frame} uncaptured WebGPU errors: ${errors.join('; ')}`);
  return { result, route, requestId: request.requestId, parity, maximum: parity ? Math.max(...Object.values(parity)) : null };
}

async function maskConditioningInvocation({ inputs, expected, manifest, adapter, device, adapterInfo, errors, commit, userAgent, invocationTag }) {
  const scopedOutputId = value => scopedArtifactId(value, invocationTag);
  const route = createSam31MaskConditioningPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-mask-conditioning-phase-program-v0', commit: commit } });
  const sourceHash = await sha256Bytes(inputs.imageEmbedding);
  const binaryHash = await sha256Bytes(inputs.binaryMasks);
  const request = createRouteInvocationRequest(route, {
    requestId: scopedArtifactId(`sam31-two-frame-mask-conditioning-${Date.now()}`, invocationTag),
    inputs: {
      'source-frame': { artifactId: 'sam31-two-frame:0', sha256: sourceHash, shape: [1] },
      'sam31-binary-mask-inputs': { artifactId: 'sam31-frame-0-binary-mask-inputs', sha256: binaryHash, shape: [manifest.shape.multiplexCount, 1, manifest.shape.maskHeight, manifest.shape.maskWidth] },
    },
    outputs: {
      'sam31-mask-conditioning-logits': { artifactId: scopedOutputId('sam31-frame-0-mask-conditioning-logits'), shape: [manifest.shape.multiplexCount, 1, manifest.shape.maskHeight, manifest.shape.maskWidth] },
      'sam31-mask-conditioning-object-scores': { artifactId: scopedOutputId('sam31-frame-0-mask-conditioning-object-scores'), shape: [manifest.shape.multiplexCount, 1] },
    },
  });
  const result = await runSam31MaskConditioningPhaseProgramRoute({
    request,
    route,
    adapter,
    device,
    queue: device.queue,
    adapterName: adapterInfo.description || 'browser-webgpu-adapter',
    browser: userAgent,
    model: { revision: manifest.reference.model.revision },
    kernel: route.kernel,
    tensors: { binaryMasks: inputs.binaryMasks, shape: { multiplexCount: manifest.shape.multiplexCount, maskHeight: manifest.shape.maskHeight, maskWidth: manifest.shape.maskWidth } },
    includeReadback: true,
  });
  const parity = expected ? {
    maskLogits: maxAbs(result.debugReadback.maskLogits, expected.memoryInputMasks),
    objectScores: maxAbs(result.debugReadback.objectScores, expected.objectScores),
  } : null;
  if (errors.length) throw new Error(`mask conditioning uncaptured WebGPU errors: ${errors.join('; ')}`);
  return { result, route, requestId: request.requestId, parity, maximum: parity ? Math.max(...Object.values(parity)) : null };
}

async function interactivePointerInvocation({ inputs, expected, manifest, weights, adapter, device, adapterInfo, errors, commit, userAgent, invocationTag }) {
  const scopedOutputId = value => scopedArtifactId(value, invocationTag);
  const route = createSam31InteractivePointerPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-interactive-pointer-phase-program-v0', commit: commit } });
  const sourceHash = await sha256Bytes(inputs.imageEmbedding);
  const binaryHash = await sha256Bytes(inputs.binaryMasks);
  const weightsHash = await sha256Text(manifest.weights.map(entry => `${entry.officialKey}:${entry.sha256}`).join('\n'));
  const request = createRouteInvocationRequest(route, {
    requestId: scopedArtifactId(`sam31-two-frame-interactive-pointer-${Date.now()}`, invocationTag),
    inputs: {
      'source-frame': { artifactId: 'sam31-two-frame:0', sha256: sourceHash, shape: [1] },
      'sam31-binary-mask-inputs': { artifactId: 'sam31-frame-0-binary-mask-inputs', sha256: binaryHash, shape: [16, 1, 8, 8] },
      'sam31-interactive-image-embedding': { artifactId: 'sam31-frame-0-interactive-image-embedding', sha256: sourceHash, shape: [1, 2, 2, 256] },
      'sam31-interactive-pointer-weights': { artifactId: 'sam31-interactive-pointer-weights:official', sha256: weightsHash, shape: [manifest.weights.length] },
    },
    outputs: { 'sam31-interactive-object-pointers': { artifactId: scopedOutputId('sam31-frame-0-interactive-object-pointers'), shape: [16, 256] } },
  });
  const result = await runSam31InteractivePointerPhaseProgramRoute({
    request, route, adapter, device, queue: device.queue,
    adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: userAgent,
    model: { revision: manifest.reference.model.revision, weightsHash }, kernel: route.kernel,
    tensors: { shape: manifest.shape, tensors: { binaryMasks: inputs.binaryMasks, imageEmbedding: inputs.imageEmbedding }, weights },
    includeReadback: true,
  });
  const parity = expected ? { objectPointers: maxAbs(result.debugReadback.objectPointers, expected.objectPointers) } : null;
  if (errors.length) throw new Error(`interactive pointer uncaptured WebGPU errors: ${errors.join('; ')}`);
  return { result, route, requestId: request.requestId, parity, maximum: parity?.objectPointers ?? null };
}


export async function runSam31BrowserTrackerPackageInvocation({
  packageRuntime, adapter, device, errors, adapterInfo, userAgent, commit, onProgress = () => {},
}) {
  if (!packageRuntime || typeof packageRuntime.loadFloat32 !== 'function' || typeof packageRuntime.loadUint8 !== 'function') throw new Error('SAM 3.1 tracker invocation requires an authenticated package runtime');
  if (!adapter || !device || !Array.isArray(errors) || !adapterInfo) throw new Error('SAM 3.1 tracker invocation requires a complete WebGPU execution context');
  const progress = (phase, detail = {}) => onProgress(phase, detail);
  const invocationTag = packageRuntime.invocationId;
  const invocationIndex = packageRuntime.session?.invocationIndex ?? 0;
  const scopedOutputId = value => scopedArtifactId(value, invocationTag);
  const verificationAttached = packageRuntime.verificationAttached === true;
  const packetAuthority = createSam31BrowserTrackerPackageAuthority(packageRuntime);
  if (!packetAuthority.passed) throw new Error(`SAM 3.1 tracker package authority failed: ${JSON.stringify(packetAuthority)}`);
  const { ingress, episode, decoder: decoderManifest, memory: memoryManifest, temporal: temporalManifest, pointer: pointerManifest } = packageRuntime.manifests || {};
  if (episode?.schema !== 'kaminos.sam31-two-image-tracker-meta-packet.v0') throw new Error(`unsupported two-image episode ${episode?.schema}`);
  const episodeEntries = entryMap(episode.tensors);
  const episodeTensor = role => packageRuntime.loadFloat32(episodeEntries[role]);
  const expectedEpisodeTensor = role => verificationAttached ? episodeTensor(role) : Promise.resolve(null);
  const temporalEntries = entryMap(temporalManifest.tensors);
  const temporalTensor = role => packageRuntime.loadFloat32(temporalEntries[role]);
  const { pointerPacketInputDigestPassed, pointerPacketOutputDigestPassed } = packetAuthority;
  progress('execution-context-bound', { packetAuthority, adapterInfo });
  if (verificationAttached && packetAuthority.packets.episode?.ingressBindingsPassed !== true) throw new Error('two-image episode does not bind the complete authenticated ingress packet');
  const imageBackbone = await runSam31TwoImageBackbone({ packageRuntime, adapter, device, errors, commit, userAgent, update: phase => progress(phase, { adapterInfo, packetAuthority }) });
  const decoderWeights = await loadDecoderWeights(decoderManifest, packageRuntime.loadFloat32);
  const memoryWeights = await loadMemoryWeights(memoryManifest, packageRuntime.loadFloat32);
  const attentionWeights = await loadAttentionWeights(temporalManifest, packageRuntime.loadFloat32);
  const pointerWeights = pointerManifest ? await loadInteractivePointerWeights(pointerManifest, packageRuntime.loadFloat32) : null;
  const decoderWeightsHash = await sha256Text(decoderManifest.weights.map(entry => `${entry.officialKey}:${entry.sha256}`).join('\n'));
  const memoryWeightsHash = await sha256Text(memoryManifest.weights.filter(entry => entry.role.startsWith('memory-')).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const attentionWeightsHash = await sha256Text(temporalManifest.attentionWeights.map(entry => `${entry.role}:${entry.sha256}`).join('\n'));

  const frame0Inputs = {
    imageEmbedding: imageBackbone.frame0.interactiveEmbedding,
    imagePosition: imageBackbone.frame0.interactivePosition,
    highResolutionS0: imageBackbone.frame0.interactiveHighResolutionS0,
    highResolutionS1: imageBackbone.frame0.interactiveHighResolutionS1,
    extraPerObjectEmbedding: await episodeTensor('frame-0-extra-per-object-embedding'),
  };
  const frame0PropagationEmbedding = imageBackbone.frame0.propagationEmbedding;
  const frame0PropagationPosition = imageBackbone.frame0.propagationPosition;
  const frame0Expected = verificationAttached ? { memoryInputMasks: await expectedEpisodeTensor('frame-0-memory-input-masks'), objectScores: await expectedEpisodeTensor('frame-0-object-scores'), objectPointers: await expectedEpisodeTensor('frame-0-object-pointers') } : null;
  let frame0MaskConditioning = null;
  let frame0MaskConditioningResult = null;
  let frame0InteractivePointer = null;
  let frame0InteractivePointerResult = null;
  let frame0Producer;
  let suppression;
  let suppressionParity;
  frame0Inputs.binaryMasks = await episodeTensor('frame-0-binary-mask-inputs');
  progress('frame-0-mask-conditioning', { adapterInfo });
  frame0MaskConditioning = await maskConditioningInvocation({ inputs: frame0Inputs, expected: frame0Expected, manifest: episode, adapter, device, adapterInfo, errors, commit, userAgent, invocationTag });
  frame0MaskConditioningResult = frame0MaskConditioning.result;
  progress('frame-0-interactive-pointer', { adapterInfo, frame0MaskConditioningReceipt: frame0MaskConditioningResult.receipt });
  frame0InteractivePointer = await interactivePointerInvocation({ inputs: frame0Inputs, expected: frame0Expected, manifest: pointerManifest, weights: pointerWeights, adapter, device, adapterInfo, errors, commit, userAgent, invocationTag });
  frame0InteractivePointerResult = frame0InteractivePointer.result;
  const pointerOutput = frame0InteractivePointerResult.receipt.outputs.find(output => output.role === 'sam31-interactive-object-pointers');
  frame0Producer = {
    memoryInputMasks: new Float32Array(frame0MaskConditioningResult.debugReadback.maskLogits),
    objectScores: new Float32Array(frame0MaskConditioningResult.debugReadback.objectScores),
    pointers: new Float32Array(frame0InteractivePointerResult.debugReadback.objectPointers),
    receipt: frame0MaskConditioningResult.receipt,
    route: frame0MaskConditioning.route,
    maximum: verificationAttached ? Math.max(frame0MaskConditioning.maximum, frame0InteractivePointer.maximum) : null,
    parity: verificationAttached ? { ...frame0MaskConditioning.parity, objectPointers: frame0InteractivePointer.maximum } : null,
    scoreOutputRole: 'sam31-mask-conditioning-object-scores',
    pointerOutput,
    origin: { kind: 'mask-conditioning', maskOwner: 'browser-webgpu', pointerOwner: 'browser-webgpu', pointerOutputRole: 'sam31-interactive-object-pointers', maskReceipt: frame0MaskConditioningResult.receipt, pointerReceipt: frame0InteractivePointerResult.receipt },
  };
  suppression = { memoryInputMasks: frame0Producer.memoryInputMasks, suppressedAbsentMaskCount: 0, semanticsPassed: true };
  suppressionParity = frame0MaskConditioning.parity?.maskLogits ?? null;
  const conditioning = new Float32Array(16).fill(1);
  const memoryShape = memoryManifest.shape.memory;
  const memoryRoute = createSam31MemoryEncoderPhaseProgramRouteDefinition({ model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-memory-encoder-phase-program-v0', commit: commit } });
  const scoreOutput = frame0Producer.receipt.outputs.find(output => output.role === frame0Producer.scoreOutputRole);
  const memoryInputMaskHash = await sha256Bytes(frame0Producer.memoryInputMasks);
  const conditioningHash = await sha256Bytes(conditioning);
  const featureHash = await sha256Bytes(frame0PropagationEmbedding);
  const memoryRequest = createRouteInvocationRequest(memoryRoute, {
    requestId: scopedArtifactId(`sam31-two-frame-memory-${Date.now()}`, invocationTag),
    inputs: {
      'source-image': { artifactId: 'sam31-two-frame:0', sha256: featureHash, shape: [1] },
      'sam31-propagation-feature-2': { artifactId: 'sam31-frame-0-propagation-feature', sha256: featureHash, shape: [1, 2, 2, 256] },
      'sam31-multiplex-mask-logits': { artifactId: 'sam31-frame-0-memory-input-masks', sha256: memoryInputMaskHash, shape: [16, 1, 8, 8] },
      'sam31-multiplex-conditioning': { artifactId: 'sam31-frame-0-conditioning', sha256: conditioningHash, shape: [1, 16] },
      'sam31-multiplex-object-scores': { artifactId: scoreOutput.artifactId, sha256: scoreOutput.sha256, shape: scoreOutput.shape },
      'sam31-memory-encoder-weights': { artifactId: 'sam31-memory-weights:official', sha256: memoryWeightsHash },
    },
    outputs: { 'sam31-mask-memory-features': { artifactId: scopedOutputId('sam31-frame-0-memory-features'), shape: [1, 2, 2, 256] }, 'sam31-mask-memory-position-encoding': { artifactId: scopedOutputId('sam31-frame-0-memory-position'), shape: [1, 2, 2, 256] } },
  });
  progress( 'frame-0-memory', { frame0ProducerReceipt: frame0Producer.receipt });
  const frame0MemoryResult = await runSam31MemoryEncoderPhaseProgramRoute({ request: memoryRequest, route: memoryRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: userAgent, model: { revision: episode.reference.model.revision, weightsHash: memoryWeightsHash }, kernel: memoryRoute.kernel, tensors: { propagationFeature: frame0PropagationEmbedding, maskLogits: frame0Producer.memoryInputMasks, objectScores: frame0Producer.objectScores, shape: { batch: 1, featureHeight: 2, featureWidth: 2, featureChannels: 256, maskHeight: 8, maskWidth: 8, multiplexCount: 16, conditionChannels: true, conditioning, resampledMaskHeight: 32, resampledMaskWidth: 32 }, config: memoryManifest.config, weights: memoryWeights }, includeReadback: true });
  const memoryParity = verificationAttached ? { features: maxAbs(frame0MemoryResult.debugReadback.memoryFeatures, await expectedEpisodeTensor('frame-0-memory-features')), position: maxAbs(frame0MemoryResult.debugReadback.memoryPositionEncoding, await expectedEpisodeTensor('frame-0-memory-position')) } : null;

  const trackerState = createSam31TrackerState({
    numFrames: episode.plan.numFrames,
    frameTokenCount: episode.shape.queryTokens,
    multiplexCount: episode.shape.multiplexCount,
    channels: episode.shape.channels,
    maskHeight: episode.shape.maskHeight,
    maskWidth: episode.shape.maskWidth,
    numMaskmem: episode.plan.numMaskmem,
    maxConditioningFrames: episode.plan.maxConditioningFrames,
    maxObjectPointerFrames: episode.plan.maxObjectPointerFrames,
    memoryTemporalStride: episode.plan.memoryTemporalStride,
    useMaskmemTemporalPositionV2: episode.plan.useMaskmemTemporalPositionV2,
  });
  await insertSam31TrackerFrame(trackerState, {
    frameIndex: 0,
    kind: 'conditioning',
    conditioningObjects: episode.stateTransition.conditioningObjects,
    memory: new Float32Array(frame0MemoryResult.debugReadback.memoryFeatures),
    memoryPosition: new Float32Array(frame0MemoryResult.debugReadback.memoryPositionEncoding),
    image: frame0PropagationEmbedding,
    imagePosition: frame0PropagationPosition,
    pointers: frame0Producer.pointers,
    maskLogits: frame0Producer.memoryInputMasks,
    objectScores: frame0Producer.objectScores,
    origin: frame0Producer.origin,
  });
  const preparedTrackerState = prepareSam31TrackerTemporalInputs(trackerState, { frameIndex: 1, trackInReverse: false });
  const { plan, spatialFrames, pointerFrames } = preparedTrackerState;
  const trackerStateSnapshot = getSam31TrackerStateSnapshot(trackerState);
  const temporalEmbeddings = await temporalTensor('maskmem-temporal-embeddings');
  const pointerPositionProjection = { weight: await temporalTensor('pointer-position-projection-weight'), bias: await temporalTensor('pointer-position-projection-bias') };
  const temporalRoute = createSam31TemporalMemoryBankPhaseProgramRouteDefinition({ model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-temporal-memory-bank-phase-program-v0', commit: commit } });
  const episodeHash = await sha256Text(JSON.stringify(trackerStateSnapshot));
  const temporalHash = await sha256Text(temporalManifest.tensors.filter(entry => ['maskmem-temporal-embeddings', 'pointer-position-projection-weight', 'pointer-position-projection-bias'].includes(entry.role)).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const pointerPacketEntry = episodeEntries['frame-0-object-pointers'];
  const pointerSourceSha256 = frame0Producer.pointerOutput?.sha256 || pointerPacketEntry?.sha256;
  if (!pointerSourceSha256) throw new Error('frame-zero object pointer output identity is missing');
  const temporalRequest = createRouteInvocationRequest(temporalRoute, { requestId: scopedArtifactId(`sam31-two-frame-bank-${Date.now()}`, invocationTag), inputs: { 'source-video-episode': { artifactId: 'sam31-two-frame-episode', sha256: episodeHash, shape: [2] }, 'sam31-temporal-spatial-memory-frames': { artifactId: 'sam31-frame-0-spatial-state', sha256: frame0MemoryResult.receipt.outputs[0].sha256, shape: [1, 1, 4, 256] }, 'sam31-temporal-object-pointer-frames': { artifactId: 'sam31-frame-0-pointer-state', sha256: pointerSourceSha256, shape: [1, 1, 16, 256] }, 'sam31-temporal-memory-position-weights': { artifactId: 'sam31-temporal-weights:official', sha256: temporalHash, mappedTensorCount: 3 } }, outputs: { 'sam31-temporal-memory-attention-bank': { artifactId: scopedOutputId('sam31-frame-1-memory-bank'), shape: [1, 20, 256] } } });
  progress( 'frame-1-temporal-bank', { frame0MemoryReceipt: frame0MemoryResult.receipt });
  const temporalResult = await runSam31TemporalMemoryBankPhaseProgramRoute({ request: temporalRequest, route: temporalRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: userAgent, model: { revision: episode.reference.model.revision, weightsHash: temporalHash }, kernel: temporalRoute.kernel, plan, spatialFrames, pointerFrames, temporalEmbeddings, pointerPositionProjection, channels: 256, batch: 1, multiplexCount: 16, includeReadback: true });
  const bank = { memoryImage: new Float32Array(temporalResult.debugReadback.memoryImage), memory: new Float32Array(temporalResult.debugReadback.memory), memoryImagePos: new Float32Array(temporalResult.debugReadback.memoryImagePosition), memoryPos: new Float32Array(temporalResult.debugReadback.memoryPosition) };
  const bankParity = verificationAttached ? { memoryImage: maxAbs(bank.memoryImage, await expectedEpisodeTensor('frame-1-assembled-memory-image')), memory: maxAbs(bank.memory, await expectedEpisodeTensor('frame-1-assembled-memory')), memoryImagePosition: maxAbs(bank.memoryImagePos, await expectedEpisodeTensor('frame-1-assembled-memory-image-position')), memoryPosition: maxAbs(bank.memoryPos, await expectedEpisodeTensor('frame-1-assembled-memory-position')) } : null;

  const frame1Image = imageBackbone.frame1.propagationEmbedding;
  const frame1Position = imageBackbone.frame1.propagationPosition;
  const attentionShape = { batch: 1, queryHeight: 2, queryWidth: 2, queryTokens: 4, memorySpatialTokens: 4, numObjPtrTokens: 16, memoryTokens: 20, channels: 256, heads: 8, headDim: 32, mlpHidden: 2048, layerCount: 4 };
  const attentionRoute = createSam31MemoryAttentionPhaseProgramRouteDefinition({ shape: attentionShape, model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-memory-attention-phase-program-v0', commit: commit } });
  const temporalOutput = temporalResult.receipt.outputs.find(output => output.role === 'sam31-temporal-memory-attention-bank');
  const currentHash = await sha256Bytes(frame1Image);
  const attentionRequest = createRouteInvocationRequest(attentionRoute, { requestId: scopedArtifactId(`sam31-two-frame-attention-${Date.now()}`, invocationTag), inputs: { 'source-image': { artifactId: 'sam31-two-frame:1', sha256: currentHash, shape: [1] }, 'sam31-memory-attention-current-tensors': { artifactId: 'sam31-frame-1-current', sha256: currentHash, shape: [1, 4, 256] }, 'sam31-memory-attention-bank-tensors': { artifactId: temporalOutput.artifactId, sha256: temporalOutput.sha256, shape: [1, 20, 256] }, 'sam31-memory-attention-weights': { artifactId: 'sam31-attention-weights:official', sha256: attentionWeightsHash, mappedTensorCount: 122 } }, outputs: { 'sam31-memory-conditioned-features': { artifactId: scopedOutputId('sam31-frame-1-conditioned-features'), shape: [1, 4, 256] } }, routeConfig: { numObjPtrTokens: 16, upstreamTemporalReceipt: temporalResult.receipt.receiptId } });
  progress( 'frame-1-memory-attention', { temporalReceipt: temporalResult.receipt });
  const frame1AttentionResult = await runSam31MemoryAttentionPhaseProgramRoute({ request: attentionRequest, route: attentionRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: userAgent, model: { revision: episode.reference.model.revision, weightsHash: attentionWeightsHash }, kernel: attentionRoute.kernel, tensors: { shape: attentionShape, current: { image: frame1Image, src: frame1Image, srcPos: frame1Position }, bank, layers: attentionWeights.layers, finalNorm: attentionWeights.finalNorm }, includeReadback: true });
  const conditionedParity = verificationAttached ? maxAbs(frame1AttentionResult.debugReadback.memory, await expectedEpisodeTensor('frame-1-memory-conditioned-features')) : null;

  const frame1Inputs = { imageEmbedding: new Float32Array(frame1AttentionResult.debugReadback.memory), imagePosition: frame1Position, highResolutionS0: imageBackbone.frame1.highResolutionS0, highResolutionS1: imageBackbone.frame1.highResolutionS1, extraPerObjectEmbedding: await episodeTensor('frame-1-extra-per-object-embedding') };
  const frame1Expected = verificationAttached ? { selectedMasks: await expectedEpisodeTensor('frame-1-selected-masks'), objectScores: await expectedEpisodeTensor('frame-1-object-scores'), objectPointers: await expectedEpisodeTensor('frame-1-object-pointers') } : null;
  progress( 'frame-1-decoder', { frame1AttentionReceipt: frame1AttentionResult.receipt });
  const frame1Decoder = await decoderInvocation({ frame: 1, inputs: frame1Inputs, expected: frame1Expected, manifest: decoderManifest, weights: decoderWeights, weightsHash: decoderWeightsHash, adapter, device, adapterInfo, errors, commit, userAgent, invocationTag });
  const frame1DecoderResult = frame1Decoder.result;

  const frame0Receipts = [frame0MaskConditioningResult.receipt, frame0InteractivePointerResult.receipt];
  const frame0Routes = [frame0MaskConditioning.route, frame0InteractivePointer.route];
  const receipts = [...(imageBackbone?.receipts || []), ...frame0Receipts, frame0MemoryResult.receipt, temporalResult.receipt, frame1AttentionResult.receipt, frame1DecoderResult.receipt];
  const requestIds = [
    ...(imageBackbone?.requestIds || []),
    frame0MaskConditioning.requestId, frame0InteractivePointer.requestId,
    memoryRequest.requestId,
    temporalRequest.requestId,
    attentionRequest.requestId,
    frame1Decoder.requestId,
  ];
  const requestedRouteIds = [...(imageBackbone?.requestedRouteIds || []), ...frame0Routes.map(route => route.routeId), memoryRoute.routeId, temporalRoute.routeId, attentionRoute.routeId, frame1Decoder.route.routeId];
  const effectiveRouteIds = receipts.map(receipt => receipt.effectiveRouteId);
  const maximums = verificationAttached ? { frame0Producer: frame0Producer.maximum, frame0Decoder: null, frame0MaskConditioning: frame0MaskConditioning?.maximum ?? null, frame0InteractivePointer: frame0InteractivePointer?.maximum ?? null, frame0Memory: Math.max(...Object.values(memoryParity)), temporalBank: Math.max(...Object.values(bankParity)), frame1Attention: conditionedParity, frame1Decoder: frame1Decoder.maximum } : null;
  const routeChainPassed = receipts.length === 19
    && requestIds.length === 19
    && requestedRouteIds.length === 19
    && receipts.every((receipt, index) => receipt.status === 'real'
      && receipt.fallbackReason == null
      && receipt.effectiveRouteId === requestedRouteIds[index]
      && receipt.outputs.every(output => output.artifactId.endsWith(`:${invocationTag}`)));
  const suppressionPassed = !verificationAttached
    ? suppression.suppressedAbsentMaskCount === 0 && suppression.semanticsPassed
    : episode.stateTransition.noObjectMaskScore === null
      && episode.stateTransition.frame0SuppressedAbsentMaskCount === 0
      && suppression.suppressedAbsentMaskCount === 0;
  const expectedBridgeDebt = [];
  const pointerDigestPassed = trackerStateSnapshot.frames[0].tensorDigests.pointers === frame0Producer.pointerOutput.sha256;
  const persistentStatePassed = preparedTrackerState.stateVersion === 1
    && trackerStateSnapshot.conditioningFrameIndices.length === 1
    && trackerStateSnapshot.conditioningFrameIndices[0] === 0
    && trackerStateSnapshot.nonConditioningFrameIndices.length === 0
    && JSON.stringify(trackerStateSnapshot.bridgeDebt) === JSON.stringify(expectedBridgeDebt)
    && trackerStateSnapshot.claims.browserNativeMaskConditioning === true
    && pointerDigestPassed;
  const stateTransitionPassed = (!verificationAttached || (episode.stateTransition.frame0AppearingObjectCount > 0 && episode.stateTransition.frame0AbsentObjectCount > 0)) && suppressionPassed && persistentStatePassed && plan.spatialFrames.length === 1 && plan.pointerFrames.length === 1 && bank.memory.length === 20 * 256;
  const frame0Tolerance = verificationAttached ? episode.tolerances.maskConditioningMaxAbsDiff : null;
  const pointerParityPassed = !verificationAttached || maximums.frame0InteractivePointer <= pointerManifest.tolerances.webGpuFinalMaxAbsDiff;
  const frame0ProducerParityPassed = !verificationAttached
    || (maximums.frame0MaskConditioning <= frame0Tolerance && pointerParityPassed);
  const parityPassed = !verificationAttached || ((imageBackbone?.parityPassed ?? true) && suppressionParity <= frame0Tolerance && frame0ProducerParityPassed && maximums.frame0Memory <= episode.tolerances.memoryMaxAbsDiff && maximums.temporalBank <= episode.tolerances.bankMaxAbsDiff && maximums.frame1Attention <= episode.tolerances.conditionedMaxAbsDiff && maximums.frame1Decoder <= episode.tolerances.decoderMaxAbsDiff);
  const ingressBindingsPassed = !verificationAttached || packetAuthority.packets.episode?.ingressBindingsPassed === true;
  const evidence = {
    packageExecutionAuthorityPassed: packetAuthority.packageExecutionAuthorityPassed,
    componentVerificationGatePassed: packetAuthority.componentVerificationGatePassed,
    pointerPacketDigestContractPassed: packetAuthority.pointerPacketDigestState === 'not-applicable'
      && pointerPacketInputDigestPassed === null
      && pointerPacketOutputDigestPassed === null,
    ingressBindingsPassed,
    adapterPassed: adapterInfo.isFallbackAdapter === false,
    routeChainPassed,
    persistentStatePassed,
    stateTransitionPassed,
    parityPassed,
    verificationContractPassed: verificationAttached ? parityPassed : packageRuntime.packageResolution?.verification?.attached === false,
    errorsPassed: errors.length === 0,
  };
  evidence.passed = Object.values(evidence).every(Boolean);
  const referenceStateTransition = episode.stateTransition;
  const effectiveStateTransition = {
    ...referenceStateTransition,
    frame0OriginKind: trackerStateSnapshot.frames[0].origin.kind,
    maskOwner: trackerStateSnapshot.frames[0].origin.maskOwner,
    pointerOwner: trackerStateSnapshot.frames[0].origin.pointerOwner,
    browserNativeMaskConditioning: trackerStateSnapshot.claims.browserNativeMaskConditioning,
    bridgeDebt: trackerStateSnapshot.bridgeDebt,
  };
  const final = { invocationIndex, episodeMode: 'two-image', verificationAttached, deviceLoss: null, packageRuntime: { rootUrl: packageRuntime.rootUrl, packageId: packageRuntime.packageId, invocationId: packageRuntime.invocationId, verificationId: packageRuntime.verificationId, sourceImageSha256: packageRuntime.sourceImageSha256, encodedSourceImageSha256: packageRuntime.encodedSourceImageSha256, rgbaSourceImageSha256: packageRuntime.rgbaSourceImageSha256, initialMaskSha256: packageRuntime.initialMaskSha256, session: packageRuntime.session, packageResolution: packageRuntime.packageResolution, cacheEvidence: packageRuntime.cacheEvidence() }, packetAuthority, trackerState: trackerStateSnapshot, adapterInfo, requestIds, requestedRouteIds, effectiveRouteIds, receipts, parity: verificationAttached ? { imageBackbone: imageBackbone?.parity ?? null, maximums, frame0Decoder: null, frame0MaskConditioning: frame0MaskConditioning?.parity ?? null, frame0InteractivePointer: frame0InteractivePointer?.parity ?? null, frame0MaskSuppression: { maxAbsDiff: suppressionParity, suppressedAbsentMaskCount: suppression.suppressedAbsentMaskCount, semanticsPassed: suppression.semanticsPassed, memoryInputMaskSha256: memoryInputMaskHash }, frame0Memory: memoryParity, temporalBank: bankParity, frame1Attention: conditionedParity, frame1Decoder: frame1Decoder.parity } : null, imageBackbone: imageBackbone ? { routeChainPassed: imageBackbone.routeChainPassed, parityPassed: imageBackbone.parityPassed, parityMaximum: imageBackbone.parityMaximum, sourceImageSha256: imageBackbone.sourceImageSha256 } : null, stateTransition: effectiveStateTransition, referenceStateTransition, effectiveStateTransition, pointerDigestPassed, pointerPacketInputDigestPassed, pointerPacketOutputDigestPassed, evidence, uncapturedErrors: errors, manifest: { reference: episode.reference, shape: episode.shape, plan: episode.plan } };
  if (!evidence.passed) throw Object.assign(new Error(`two-frame tracker evidence failed: ${JSON.stringify(evidence)}`), { evidenceState: final });
  return final;
}
