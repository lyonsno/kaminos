import {
  classifySam31MemoryAttentionAdapter,
  createSam31BrowserTrackerCallerDualInvocationEvidence,
  createSam31BrowserTrackerDualInvocationEvidence,
  createSam31BrowserTrackerPackageCache,
  createSam31BrowserTrackerSession,
  createRouteInvocationRequest,
  createSam31TrackerState,
  createSam31MemoryAttentionPhaseProgramRouteDefinition,
  createSam31MaskConditioningPhaseProgramRouteDefinition,
  createSam31InteractivePointerPhaseProgramRouteDefinition,
  createSam31MemoryEncoderPhaseProgramRouteDefinition,
  createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition,
  createSam31TemporalMemoryBankPhaseProgramRouteDefinition,
  getSam31TrackerStateSnapshot,
  insertSam31TrackerFrame,
  loadSam31BrowserTrackerPackageRuntime,
  prepareSam31TrackerTemporalInputs,
  runSam31MemoryAttentionPhaseProgramRoute,
  runSam31MaskConditioningPhaseProgramRoute,
  runSam31InteractivePointerPhaseProgramRoute,
  runSam31MemoryEncoderPhaseProgramRoute,
  runSam31MultiplexMaskDecoderPhaseProgramRoute,
  runSam31TemporalMemoryBankPhaseProgramRoute,
  verifySam31PacketFloat32Bytes,
  verifySam31TwoImageIngressPacketAuthority,
  verifySam31TwoFramePacketAuthority,
} from '../src/index.js';
import { runSam31TwoImageBackbone } from './sam31-two-image-backbone.js';

const statusElement = document.querySelector('#status');
const params = new URLSearchParams(location.search);
const packageRoots = params.getAll('packageRoot');
const packageMode = packageRoots.length > 0;
const callerInput = params.get('callerInput') === '1';
const callerInputIndex = Number(params.get('invocationIndex') || 0);
if (!Number.isInteger(callerInputIndex) || callerInputIndex < 0) throw new Error(`invalid caller invocation index ${params.get('invocationIndex')}`);
const inheritedPackageCache = globalThis.parent !== globalThis ? parent.sam31SharedTrackerPackageCache : null;
const packageCache = packageMode ? inheritedPackageCache || createSam31BrowserTrackerPackageCache({
  persistentStaticBacking: params.get('staticBacking') === 'opfs',
}) : null;
let activePackageRuntime = null;
let activeInvocationTag = null;
const NO_OBJ_SCORE = -1024.0;
const episodeMode = params.get('episodeMode') || 'propagation-decoder';
if (!['propagation-decoder', 'mask-conditioning', 'two-image'].includes(episodeMode)) throw new Error(`unsupported episodeMode ${episodeMode}`);
const isTwoImage = episodeMode === 'two-image';
const isMaskConditioned = episodeMode !== 'propagation-decoder';
const PACKET_NAMES = isTwoImage
  ? ['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer']
  : isMaskConditioned
  ? ['decoder', 'memory', 'temporal', 'episode', 'pointer']
  : ['decoder', 'memory', 'temporal', 'episode'];
const episodeAuthorityName = isTwoImage ? 'twoImageEpisode' : isMaskConditioned ? 'conditionedEpisode' : 'episode';
document.querySelector('h1').textContent = isTwoImage
  ? 'SAM3.1 two raw images → full ViT → temporal tracker'
  : isMaskConditioned
  ? 'SAM3.1 mask conditioning → memory → attention → decoder'
  : 'SAM3.1 two-frame decoder → memory → attention → decoder';
let state = { status: 'loading', phase: 'load-manifests' };
window.sam31TwoFrameTrackerParityState = () => state;

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

async function fetchBytes(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.text();
}

async function fetchTensor(base, entry) {
  if (activePackageRuntime) return activePackageRuntime.loadFloat32(entry);
  const response = await fetch(`${base}/${entry.file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fetch ${base}/${entry.file} failed ${response.status}`);
  return verifySam31PacketFloat32Bytes(entry, await response.arrayBuffer());
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

function adapterIdentity(adapter) {
  const info = adapter.info;
  return {
    description: String(info?.description || ''), vendor: String(info?.vendor || ''), architecture: String(info?.architecture || ''), device: String(info?.device || ''),
    ...classifySam31MemoryAttentionAdapter({ explicitFallback: typeof adapter.isFallbackAdapter === 'boolean' ? adapter.isFallbackAdapter : undefined, vendor: info?.vendor, architecture: info?.architecture }),
  };
}

function entryMap(entries) { return Object.fromEntries(entries.map(entry => [entry.role, entry])); }
function scopedOutputId(value) { return activeInvocationTag ? `${value}:${activeInvocationTag}` : value; }

async function verifyPacketAuthority(packageRoot = null) {
  if (packageRoot) {
    activePackageRuntime = await loadSam31BrowserTrackerPackageRuntime({
      rootUrl: packageRoot,
      pageUrl: location.href,
      cache: packageCache,
    });
    const componentAuthorities = activePackageRuntime.componentAuthorities || {};
    return {
      authority: {
        passed: true,
        packetSource: 'browser-package',
        verifiedPackets: PACKET_NAMES,
        packets: componentAuthorities,
        packageId: activePackageRuntime.packageId,
        invocationId: activePackageRuntime.invocationId,
        verificationId: activePackageRuntime.verificationId,
        verificationAttached: activePackageRuntime.verificationAttached,
        packageResolution: activePackageRuntime.packageResolution,
      },
      manifests: activePackageRuntime.manifests,
    };
  }
  const packetSource = params.get('packetSource');
  if (!['generated', 'caller-provided-existing'].includes(packetSource)) throw new Error(`unsupported packetSource ${packetSource}`);
  const packets = {};
  const manifests = {};
  for (const name of PACKET_NAMES) {
    const expectedManifestSha256 = params.get(`expected-${name}-manifest-sha256`);
    if (!expectedManifestSha256) throw new Error(`${name} browser authority is missing its invocation-scoped manifest digest`);
    const manifestText = await fetchText(`/oracle/${name}/tensor-manifest.json`);
    const manifest = JSON.parse(manifestText);
    const referenceReceipt = await fetchJson(`/oracle/${name}/reference-receipt.json`);
    packets[name] = name === 'ingress'
      ? await verifySam31TwoImageIngressPacketAuthority({ manifestText, manifest, referenceReceipt, expectedManifestSha256 })
      : await verifySam31TwoFramePacketAuthority({
        name,
        authorityName: name === 'episode' ? episodeAuthorityName : name,
        manifestText,
        manifest,
        referenceReceipt,
        expectedManifestSha256,
        authenticatedIngress: isTwoImage && (name === 'episode' || name === 'pointer')
          ? { manifest: manifests.ingress, authority: packets.ingress }
          : null,
      });
    manifests[name] = manifest;
  }
  return { authority: { passed: true, packetSource, verifiedPackets: PACKET_NAMES, packets }, manifests };
}

function suppressAbsentMasks(rawSelectedMasks, objectScores, maskArea) {
  if (rawSelectedMasks.length !== objectScores.length * maskArea) throw new Error('frame-zero suppression shape mismatch');
  const memoryInputMasks = new Float32Array(rawSelectedMasks);
  let suppressedAbsentMaskCount = 0;
  for (let object = 0; object < objectScores.length; object += 1) {
    if (objectScores[object] > 0) continue;
    suppressedAbsentMaskCount += 1;
    memoryInputMasks.fill(NO_OBJ_SCORE, object * maskArea, (object + 1) * maskArea);
  }
  let semanticsPassed = true;
  for (let object = 0; object < objectScores.length; object += 1) {
    for (let offset = object * maskArea; offset < (object + 1) * maskArea; offset += 1) {
      const expected = objectScores[object] > 0 ? rawSelectedMasks[offset] : NO_OBJ_SCORE;
      if (memoryInputMasks[offset] !== expected) semanticsPassed = false;
    }
  }
  return { memoryInputMasks, suppressedAbsentMaskCount, semanticsPassed };
}

async function loadDecoderWeights(manifest) {
  const weights = {};
  for (const entry of manifest.weights) {
    const key = entry.group === 'decoder' ? entry.localKey : `${entry.group}.${entry.localKey}`;
    weights[key] = await fetchTensor('/oracle/decoder', entry);
  }
  return weights;
}

async function loadInteractivePointerWeights(manifest) {
  const weights = {};
  for (const entry of manifest.weights) {
    weights[`${entry.group}.${entry.localKey}`] = await fetchTensor('/oracle/pointer', entry);
  }
  return weights;
}

async function loadMemoryWeights(manifest) {
  const byRole = entryMap(manifest.weights);
  const weight = role => fetchTensor('/oracle/memory', byRole[role]);
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

async function loadAttentionWeights(manifest) {
  const byRole = entryMap(manifest.attentionWeights);
  const weight = role => fetchTensor('/oracle/temporal', byRole[role]);
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

async function decoderInvocation({ frame, inputs, expected, manifest, shape = manifest.shape, weights, weightsHash, adapter, device, adapterInfo, errors }) {
  const route = createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition({ shape, model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-multiplex-mask-decoder-phase-program-v0', commit: params.get('commit') || null } });
  const sourceHash = await sha256Bytes(inputs.imageEmbedding);
  const request = createRouteInvocationRequest(route, {
    requestId: `sam31-two-frame-decoder-${frame}-${Date.now()}`,
    inputs: {
      'source-frame': { artifactId: `sam31-two-frame:${frame}`, sha256: sourceHash, shape: [1] },
      'sam31-multiplex-decoder-tensors': { artifactId: `sam31-two-frame-decoder-tensors:${frame}`, sha256: sourceHash, shape: [5] },
      'sam31-multiplex-decoder-weights': { artifactId: 'sam31-multiplex-decoder-weights:official', sha256: weightsHash, mappedTensorCount: manifest.weights.length },
    },
    outputs: {
      'sam31-multiplex-sam-output-tokens': { artifactId: scopedOutputId(`sam31-two-frame-sam-tokens:${frame}`), shape: [1, 16, 3, 256] },
      'sam31-multiplex-mask-logits': { artifactId: scopedOutputId(`sam31-two-frame-mask-logits:${frame}`), shape: [shape.multiplexCount, shape.maskOutputsPerObject, shape.maskHeight, shape.maskWidth] },
      'sam31-multiplex-selected-masks': { artifactId: scopedOutputId(`sam31-two-frame-selected-masks:${frame}`), shape: [shape.multiplexCount, 1, shape.maskHeight, shape.maskWidth] },
      'sam31-multiplex-object-scores': { artifactId: scopedOutputId(`sam31-two-frame-object-scores:${frame}`), shape: [shape.multiplexCount, 1] },
      'sam31-multiplex-object-pointers': { artifactId: scopedOutputId(`sam31-two-frame-object-pointers:${frame}`), shape: [shape.multiplexCount, shape.channels] },
    },
  });
  const result = await runSam31MultiplexMaskDecoderPhaseProgramRoute({ request, route, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: manifest.reference.model.revision, weightsHash }, kernel: route.kernel, tensors: { shape, tensors: inputs, weights }, includeReadback: true });
  const parity = expected ? { selectedMasks: maxAbs(result.debugReadback.selectedMasks, expected.selectedMasks), objectScores: maxAbs(result.debugReadback.objectScores, expected.objectScores), objectPointers: maxAbs(result.debugReadback.objectPointers, expected.objectPointers) } : null;
  if (errors.length) throw new Error(`decoder ${frame} uncaptured WebGPU errors: ${errors.join('; ')}`);
  return { result, route, requestId: request.requestId, parity, maximum: parity ? Math.max(...Object.values(parity)) : null };
}

async function maskConditioningInvocation({ inputs, expected, manifest, adapter, device, adapterInfo, errors }) {
  const route = createSam31MaskConditioningPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-mask-conditioning-phase-program-v0', commit: params.get('commit') || null } });
  const sourceHash = await sha256Bytes(inputs.imageEmbedding);
  const binaryHash = await sha256Bytes(inputs.binaryMasks);
  const request = createRouteInvocationRequest(route, {
    requestId: `sam31-two-frame-mask-conditioning-${Date.now()}`,
    inputs: {
      'source-frame': { artifactId: 'sam31-two-frame:0', sha256: sourceHash, shape: [1] },
      'sam31-binary-mask-inputs': { artifactId: 'sam31-frame-0-binary-mask-inputs', sha256: binaryHash, shape: [manifest.shape.multiplexCount, 1, manifest.shape.sourceMaskHeight, manifest.shape.sourceMaskWidth] },
    },
    outputs: {
      'sam31-mask-conditioning-logits': { artifactId: scopedOutputId('sam31-frame-0-mask-conditioning-logits'), shape: [manifest.shape.multiplexCount, 1, manifest.shape.sourceMaskHeight, manifest.shape.sourceMaskWidth] },
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
    browser: navigator.userAgent,
    model: { revision: manifest.reference.model.revision },
    kernel: route.kernel,
    tensors: { binaryMasks: inputs.binaryMasks, shape: { multiplexCount: manifest.shape.multiplexCount, maskHeight: manifest.shape.sourceMaskHeight, maskWidth: manifest.shape.sourceMaskWidth } },
    includeReadback: true,
  });
  const parity = expected ? {
    maskLogits: maxAbs(result.debugReadback.maskLogits, expected.memoryInputMasks),
    objectScores: maxAbs(result.debugReadback.objectScores, expected.objectScores),
  } : null;
  if (errors.length) throw new Error(`mask conditioning uncaptured WebGPU errors: ${errors.join('; ')}`);
  return { result, route, requestId: request.requestId, parity, maximum: parity ? Math.max(...Object.values(parity)) : null };
}

async function interactivePointerInvocation({ inputs, expected, manifest, weights, adapter, device, adapterInfo, errors }) {
  const route = createSam31InteractivePointerPhaseProgramRouteDefinition({ model: { revision: manifest.reference.model.revision }, kernel: { profile: 'sam31-interactive-pointer-phase-program-v0', commit: params.get('commit') || null } });
  const sourceHash = await sha256Bytes(inputs.imageEmbedding);
  const binaryHash = await sha256Bytes(inputs.binaryMasks);
  const weightsHash = await sha256Text(manifest.weights.map(entry => `${entry.officialKey}:${entry.sha256}`).join('\n'));
  const request = createRouteInvocationRequest(route, {
    requestId: `sam31-two-frame-interactive-pointer-${Date.now()}`,
    inputs: {
      'source-frame': { artifactId: 'sam31-two-frame:0', sha256: sourceHash, shape: [1] },
      'sam31-binary-mask-inputs': { artifactId: 'sam31-frame-0-binary-mask-inputs', sha256: binaryHash, shape: [manifest.shape.batch, 1, manifest.shape.sourceMaskHeight, manifest.shape.sourceMaskWidth] },
      'sam31-interactive-image-embedding': { artifactId: 'sam31-frame-0-interactive-image-embedding', sha256: sourceHash, shape: [1, manifest.shape.imageHeight, manifest.shape.imageWidth, manifest.shape.channels] },
      'sam31-interactive-pointer-weights': { artifactId: 'sam31-interactive-pointer-weights:official', sha256: weightsHash, shape: [manifest.weights.length] },
    },
    outputs: { 'sam31-interactive-object-pointers': { artifactId: scopedOutputId('sam31-frame-0-interactive-object-pointers'), shape: [manifest.shape.batch, manifest.shape.channels] } },
  });
  const result = await runSam31InteractivePointerPhaseProgramRoute({
    request, route, adapter, device, queue: device.queue,
    adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent,
    model: { revision: manifest.reference.model.revision, weightsHash }, kernel: route.kernel,
    tensors: { shape: manifest.shape, tensors: { binaryMasks: inputs.binaryMasks, imageEmbedding: inputs.imageEmbedding }, weights },
    includeReadback: true,
  });
  const parity = expected ? { objectPointers: maxAbs(result.debugReadback.objectPointers, expected.objectPointers) } : null;
  if (errors.length) throw new Error(`interactive pointer uncaptured WebGPU errors: ${errors.join('; ')}`);
  return { result, route, requestId: request.requestId, parity, maximum: parity?.objectPointers ?? null };
}

async function ensureExecutionContext(execution, packetAuthority) {
  if (execution.device) return execution;
  update('running', 'request-adapter', { episodeMode, packetAuthority });
  if (!navigator.gpu) throw new Error('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', event => errors.push(String(event.error?.message || event.error)));
  Object.assign(execution, { adapter, device, errors, adapterInfo: adapterIdentity(adapter) });
  device.lost.then(info => {
    if (execution.closing) return;
    execution.deviceLoss = {
      reason: info?.reason || 'unknown',
      message: info?.message || '',
      observedAtPhase: state.phase,
    };
    errors.push(`WebGPU device lost: ${execution.deviceLoss.reason}: ${execution.deviceLoss.message}`);
    update('failed', 'device-lost', { deviceLoss: execution.deviceLoss });
  });
  return execution;
}

async function closeExecutionContext(execution, { collectGarbage = false } = {}) {
  if (!execution?.device || execution.closed) return { queueDrained: false, deviceDestroyed: false, gcObserved: false };
  execution.closing = true;
  await execution.device.queue.onSubmittedWorkDone();
  execution.device.destroy();
  await execution.device.lost;
  execution.closed = true;
  const gcObserved = collectGarbage && typeof globalThis.gc === 'function';
  if (gcObserved) globalThis.gc();
  await new Promise(resolveCheckpoint => setTimeout(resolveCheckpoint, 0));
  return { queueDrained: true, deviceDestroyed: true, gcObserved };
}

async function runInvocation(packageRoot = null, invocationIndex = 0, execution = {}) {
  const verifiedPackets = await verifyPacketAuthority(packageRoot);
  const packetAuthority = verifiedPackets.authority;
  const verificationAttached = packageRoot ? activePackageRuntime.verificationAttached : true;
  activeInvocationTag = activePackageRuntime ? activePackageRuntime.invocationId.slice(-12) : null;
  const { ingress, episode, decoder: decoderManifest, memory: memoryManifest, temporal: temporalManifest, pointer: pointerManifest } = verifiedPackets.manifests;
  const expectedEpisodeSchema = isTwoImage
    ? 'kaminos.sam31-two-image-tracker-meta-packet.v0'
    : isMaskConditioned
    ? 'kaminos.sam31-mask-conditioned-two-frame-tracker-meta-packet.v0'
    : 'kaminos.sam31-two-frame-tracker-meta-packet.v0';
  if (episode.schema !== expectedEpisodeSchema) throw new Error(`unsupported ${episodeMode} episode ${episode.schema}`);
  const episodeEntries = entryMap(episode.tensors);
  const episodeTensor = role => fetchTensor('/oracle/episode', episodeEntries[role]);
  const expectedEpisodeTensor = role => verificationAttached ? episodeTensor(role) : Promise.resolve(null);
  const temporalEntries = entryMap(temporalManifest.tensors);
  const temporalTensor = role => fetchTensor('/oracle/temporal', temporalEntries[role]);
  const pointerEntries = pointerManifest ? entryMap(pointerManifest.tensors) : null;
  const pointerPacketInputDigestPassed = !verificationAttached || !isMaskConditioned || isTwoImage || (
    pointerEntries['binary-mask-inputs'].sha256 === episodeEntries['frame-0-binary-mask-inputs'].sha256
    && pointerEntries['image-embedding'].sha256 === episodeEntries['frame-0-image-embedding'].sha256
  );
  const pointerPacketOutputDigestPassed = !verificationAttached || !isMaskConditioned || isTwoImage
    || pointerEntries['expected-final-object-pointers'].sha256 === episodeEntries['frame-0-object-pointers'].sha256;
  if (!pointerPacketInputDigestPassed || !pointerPacketOutputDigestPassed) throw new Error('interactive pointer packet does not bind to the conditioned episode inputs and output');

  const { adapter, device, errors, adapterInfo } = await ensureExecutionContext(execution, packetAuthority);
  update('running', 'execution-context-bound', { episodeMode, packetAuthority, adapterInfo, manifest: { reference: episode.reference, shape: episode.shape, plan: episode.plan, stateTransition: episode.stateTransition } });
  let imageBackbone = null;
  if (isTwoImage) {
    if (verificationAttached && packetAuthority.packets.episode.ingressBindingsPassed !== true) throw new Error('two-image episode does not bind the complete authenticated ingress packet');
    imageBackbone = await runSam31TwoImageBackbone({
      manifest: ingress,
      adapter,
      device,
      errors,
      commit: params.get('commit') || null,
      update: phase => update('running', phase, { episodeMode, invocationIndex, adapterInfo, packetAuthority }),
      loadFloat32: activePackageRuntime?.loadFloat32,
      loadUint8: activePackageRuntime?.loadUint8,
      verificationAttached,
      invocationTag: activeInvocationTag,
    });
  }
  const decoderWeights = await loadDecoderWeights(decoderManifest);
  const memoryWeights = await loadMemoryWeights(memoryManifest);
  const attentionWeights = await loadAttentionWeights(temporalManifest);
  const pointerWeights = pointerManifest ? await loadInteractivePointerWeights(pointerManifest) : null;
  const decoderWeightsHash = await sha256Text(decoderManifest.weights.map(entry => `${entry.officialKey}:${entry.sha256}`).join('\n'));
  const memoryWeightsHash = await sha256Text(memoryManifest.weights.filter(entry => entry.role.startsWith('memory-')).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const attentionWeightsHash = await sha256Text(temporalManifest.attentionWeights.map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const decoderExecutionShape = {
    ...decoderManifest.shape,
    imageHeight: episode.shape.queryHeight,
    imageWidth: episode.shape.queryWidth,
    imageTokens: episode.shape.queryTokens,
    maskHeight: episode.shape.decoderMaskHeight,
    maskWidth: episode.shape.decoderMaskWidth,
  };

  const frame0Inputs = {
    imageEmbedding: isTwoImage ? imageBackbone.frame0.interactiveEmbedding : await episodeTensor('frame-0-image-embedding'),
    imagePosition: isTwoImage ? imageBackbone.frame0.interactivePosition : await episodeTensor('frame-0-image-position'),
    highResolutionS0: isTwoImage ? imageBackbone.frame0.interactiveHighResolutionS0 : await episodeTensor('frame-0-high-resolution-s0'),
    highResolutionS1: isTwoImage ? imageBackbone.frame0.interactiveHighResolutionS1 : await episodeTensor('frame-0-high-resolution-s1'),
    extraPerObjectEmbedding: await episodeTensor('frame-0-extra-per-object-embedding'),
  };
  const frame0PropagationEmbedding = isTwoImage ? imageBackbone.frame0.propagationEmbedding : frame0Inputs.imageEmbedding;
  const frame0PropagationPosition = isTwoImage ? imageBackbone.frame0.propagationPosition : frame0Inputs.imagePosition;
  const frame0Expected = verificationAttached ? { memoryInputMasks: await expectedEpisodeTensor('frame-0-memory-input-masks'), objectScores: await expectedEpisodeTensor('frame-0-object-scores'), objectPointers: await expectedEpisodeTensor('frame-0-object-pointers') } : null;
  let frame0Decoder = null;
  let frame0DecoderResult = null;
  let frame0MaskConditioning = null;
  let frame0MaskConditioningResult = null;
  let frame0InteractivePointer = null;
  let frame0InteractivePointerResult = null;
  let frame0Producer;
  let suppression;
  let suppressionParity;
  if (isMaskConditioned) {
    frame0Inputs.binaryMasks = await episodeTensor('frame-0-binary-mask-inputs');
    update('running', 'frame-0-mask-conditioning', { adapterInfo });
    frame0MaskConditioning = await maskConditioningInvocation({ inputs: frame0Inputs, expected: frame0Expected, manifest: episode, adapter, device, adapterInfo, errors });
    frame0MaskConditioningResult = frame0MaskConditioning.result;
    update('running', 'frame-0-interactive-pointer', { adapterInfo, frame0MaskConditioningReceipt: frame0MaskConditioningResult.receipt });
    frame0InteractivePointer = await interactivePointerInvocation({ inputs: frame0Inputs, expected: frame0Expected, manifest: pointerManifest, weights: pointerWeights, adapter, device, adapterInfo, errors });
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
  } else {
    frame0Expected.selectedMasks = await expectedEpisodeTensor('frame-0-selected-masks');
    update('running', 'frame-0-decoder', { adapterInfo });
    frame0Decoder = await decoderInvocation({ frame: 0, inputs: frame0Inputs, expected: frame0Expected, manifest: decoderManifest, shape: decoderExecutionShape, weights: decoderWeights, weightsHash: decoderWeightsHash, adapter, device, adapterInfo, errors });
    frame0DecoderResult = frame0Decoder.result;
    suppression = suppressAbsentMasks(new Float32Array(frame0DecoderResult.debugReadback.selectedMasks), new Float32Array(frame0DecoderResult.debugReadback.objectScores), episode.shape.maskHeight * episode.shape.maskWidth);
    suppressionParity = verificationAttached ? maxAbs(suppression.memoryInputMasks, frame0Expected.memoryInputMasks) : null;
    frame0Producer = {
      memoryInputMasks: suppression.memoryInputMasks,
      objectScores: new Float32Array(frame0DecoderResult.debugReadback.objectScores),
      pointers: new Float32Array(frame0DecoderResult.debugReadback.objectPointers),
      receipt: frame0DecoderResult.receipt,
      route: frame0Decoder.route,
      maximum: frame0Decoder.maximum,
      parity: frame0Decoder.parity,
      scoreOutputRole: 'sam31-multiplex-object-scores',
      pointerOutput: frame0DecoderResult.receipt.outputs.find(output => output.role === 'sam31-multiplex-object-pointers'),
      origin: { kind: 'propagation-decoder', maskOwner: 'browser-webgpu', pointerOwner: 'browser-webgpu', pointerReceipt: frame0DecoderResult.receipt },
    };
  }

  const conditioning = new Float32Array(16).fill(1);
  const memoryShape = memoryManifest.shape.memory;
  const memoryRoute = createSam31MemoryEncoderPhaseProgramRouteDefinition({ model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-memory-encoder-phase-program-v0', commit: params.get('commit') || null } });
  const scoreOutput = frame0Producer.receipt.outputs.find(output => output.role === frame0Producer.scoreOutputRole);
  const memoryInputMaskHash = await sha256Bytes(frame0Producer.memoryInputMasks);
  const conditioningHash = await sha256Bytes(conditioning);
  const featureHash = await sha256Bytes(frame0PropagationEmbedding);
  const memoryRequest = createRouteInvocationRequest(memoryRoute, {
    requestId: `sam31-two-frame-memory-${Date.now()}`,
    inputs: {
      'source-image': { artifactId: 'sam31-two-frame:0', sha256: featureHash, shape: [1] },
      'sam31-propagation-feature-2': { artifactId: 'sam31-frame-0-propagation-feature', sha256: featureHash, shape: [episode.shape.batch, episode.shape.queryHeight, episode.shape.queryWidth, episode.shape.channels] },
      'sam31-multiplex-mask-logits': { artifactId: 'sam31-frame-0-memory-input-masks', sha256: memoryInputMaskHash, shape: [episode.shape.multiplexCount, 1, episode.shape.memoryInputMaskHeight, episode.shape.memoryInputMaskWidth] },
      'sam31-multiplex-conditioning': { artifactId: 'sam31-frame-0-conditioning', sha256: conditioningHash, shape: [episode.shape.batch, episode.shape.multiplexCount] },
      'sam31-multiplex-object-scores': { artifactId: scoreOutput.artifactId, sha256: scoreOutput.sha256, shape: scoreOutput.shape },
      'sam31-memory-encoder-weights': { artifactId: 'sam31-memory-weights:official', sha256: memoryWeightsHash },
    },
    outputs: { 'sam31-mask-memory-features': { artifactId: scopedOutputId('sam31-frame-0-memory-features'), shape: [episode.shape.batch, episode.shape.queryHeight, episode.shape.queryWidth, episode.shape.channels] }, 'sam31-mask-memory-position-encoding': { artifactId: scopedOutputId('sam31-frame-0-memory-position'), shape: [episode.shape.batch, episode.shape.queryHeight, episode.shape.queryWidth, episode.shape.channels] } },
  });
  update('running', 'frame-0-memory', { frame0ProducerReceipt: frame0Producer.receipt });
  const frame0MemoryResult = await runSam31MemoryEncoderPhaseProgramRoute({ request: memoryRequest, route: memoryRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: episode.reference.model.revision, weightsHash: memoryWeightsHash }, kernel: memoryRoute.kernel, tensors: { propagationFeature: frame0PropagationEmbedding, maskLogits: frame0Producer.memoryInputMasks, objectScores: frame0Producer.objectScores, shape: { batch: episode.shape.batch, featureHeight: episode.shape.queryHeight, featureWidth: episode.shape.queryWidth, featureChannels: episode.shape.channels, maskHeight: episode.shape.memoryInputMaskHeight, maskWidth: episode.shape.memoryInputMaskWidth, multiplexCount: episode.shape.multiplexCount, conditionChannels: true, conditioning, resampledMaskHeight: episode.shape.sourceMaskHeight, resampledMaskWidth: episode.shape.sourceMaskWidth }, config: memoryManifest.config, weights: memoryWeights }, includeReadback: true });
  const memoryParity = verificationAttached ? { features: maxAbs(frame0MemoryResult.debugReadback.memoryFeatures, await expectedEpisodeTensor('frame-0-memory-features')), position: maxAbs(frame0MemoryResult.debugReadback.memoryPositionEncoding, await expectedEpisodeTensor('frame-0-memory-position')) } : null;

  const trackerState = createSam31TrackerState({
    numFrames: episode.plan.numFrames,
    frameTokenCount: episode.shape.queryTokens,
    multiplexCount: episode.shape.multiplexCount,
    channels: episode.shape.channels,
    maskHeight: episode.shape.memoryInputMaskHeight,
    maskWidth: episode.shape.memoryInputMaskWidth,
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
  const temporalRoute = createSam31TemporalMemoryBankPhaseProgramRouteDefinition({ model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-temporal-memory-bank-phase-program-v0', commit: params.get('commit') || null } });
  const episodeHash = await sha256Text(JSON.stringify(trackerStateSnapshot));
  const temporalHash = await sha256Text(temporalManifest.tensors.filter(entry => ['maskmem-temporal-embeddings', 'pointer-position-projection-weight', 'pointer-position-projection-bias'].includes(entry.role)).map(entry => `${entry.role}:${entry.sha256}`).join('\n'));
  const pointerPacketEntry = episodeEntries['frame-0-object-pointers'];
  const pointerSourceSha256 = frame0Producer.pointerOutput?.sha256 || pointerPacketEntry?.sha256;
  if (!pointerSourceSha256) throw new Error('frame-zero object pointer output identity is missing');
  const temporalRequest = createRouteInvocationRequest(temporalRoute, { requestId: `sam31-two-frame-bank-${Date.now()}`, inputs: { 'source-video-episode': { artifactId: 'sam31-two-frame-episode', sha256: episodeHash, shape: [episode.plan.numFrames] }, 'sam31-temporal-spatial-memory-frames': { artifactId: 'sam31-frame-0-spatial-state', sha256: frame0MemoryResult.receipt.outputs[0].sha256, shape: [episode.shape.batch, 1, episode.shape.memorySpatialTokens, episode.shape.channels] }, 'sam31-temporal-object-pointer-frames': { artifactId: 'sam31-frame-0-pointer-state', sha256: pointerSourceSha256, shape: [episode.shape.batch, 1, episode.shape.numObjPtrTokens, episode.shape.channels] }, 'sam31-temporal-memory-position-weights': { artifactId: 'sam31-temporal-weights:official', sha256: temporalHash, mappedTensorCount: 3 } }, outputs: { 'sam31-temporal-memory-attention-bank': { artifactId: scopedOutputId('sam31-frame-1-memory-bank'), shape: [episode.shape.batch, episode.shape.memoryTokens, episode.shape.channels] } } });
  update('running', 'frame-1-temporal-bank', { frame0MemoryReceipt: frame0MemoryResult.receipt });
  const temporalResult = await runSam31TemporalMemoryBankPhaseProgramRoute({ request: temporalRequest, route: temporalRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: episode.reference.model.revision, weightsHash: temporalHash }, kernel: temporalRoute.kernel, plan, spatialFrames, pointerFrames, temporalEmbeddings, pointerPositionProjection, channels: 256, batch: 1, multiplexCount: 16, includeReadback: true });
  const bank = { memoryImage: new Float32Array(temporalResult.debugReadback.memoryImage), memory: new Float32Array(temporalResult.debugReadback.memory), memoryImagePos: new Float32Array(temporalResult.debugReadback.memoryImagePosition), memoryPos: new Float32Array(temporalResult.debugReadback.memoryPosition) };
  const bankParity = verificationAttached ? { memoryImage: maxAbs(bank.memoryImage, await expectedEpisodeTensor('frame-1-assembled-memory-image')), memory: maxAbs(bank.memory, await expectedEpisodeTensor('frame-1-assembled-memory')), memoryImagePosition: maxAbs(bank.memoryImagePos, await expectedEpisodeTensor('frame-1-assembled-memory-image-position')), memoryPosition: maxAbs(bank.memoryPos, await expectedEpisodeTensor('frame-1-assembled-memory-position')) } : null;

  const frame1Image = isTwoImage ? imageBackbone.frame1.propagationEmbedding : await episodeTensor('frame-1-image-embedding');
  const frame1Position = isTwoImage ? imageBackbone.frame1.propagationPosition : await episodeTensor('frame-1-image-position');
  const attentionShape = { batch: episode.shape.batch, queryHeight: episode.shape.queryHeight, queryWidth: episode.shape.queryWidth, queryTokens: episode.shape.queryTokens, memorySpatialTokens: episode.shape.memorySpatialTokens, numObjPtrTokens: episode.shape.numObjPtrTokens, memoryTokens: episode.shape.memoryTokens, channels: episode.shape.channels, heads: 8, headDim: 32, mlpHidden: 2048, layerCount: 4 };
  const attentionRoute = createSam31MemoryAttentionPhaseProgramRouteDefinition({ shape: attentionShape, model: { revision: episode.reference.model.revision }, kernel: { profile: 'sam31-memory-attention-phase-program-v0', commit: params.get('commit') || null } });
  const temporalOutput = temporalResult.receipt.outputs.find(output => output.role === 'sam31-temporal-memory-attention-bank');
  const currentHash = await sha256Bytes(frame1Image);
  const attentionRequest = createRouteInvocationRequest(attentionRoute, { requestId: `sam31-two-frame-attention-${Date.now()}`, inputs: { 'source-image': { artifactId: 'sam31-two-frame:1', sha256: currentHash, shape: [1] }, 'sam31-memory-attention-current-tensors': { artifactId: 'sam31-frame-1-current', sha256: currentHash, shape: [episode.shape.batch, episode.shape.queryTokens, episode.shape.channels] }, 'sam31-memory-attention-bank-tensors': { artifactId: temporalOutput.artifactId, sha256: temporalOutput.sha256, shape: [episode.shape.batch, episode.shape.memoryTokens, episode.shape.channels] }, 'sam31-memory-attention-weights': { artifactId: 'sam31-attention-weights:official', sha256: attentionWeightsHash, mappedTensorCount: 122 } }, outputs: { 'sam31-memory-conditioned-features': { artifactId: scopedOutputId('sam31-frame-1-conditioned-features'), shape: [episode.shape.batch, episode.shape.queryTokens, episode.shape.channels] } }, routeConfig: { numObjPtrTokens: episode.shape.numObjPtrTokens, upstreamTemporalReceipt: temporalResult.receipt.receiptId } });
  update('running', 'frame-1-memory-attention', { temporalReceipt: temporalResult.receipt });
  const frame1AttentionResult = await runSam31MemoryAttentionPhaseProgramRoute({ request: attentionRequest, route: attentionRoute, adapter, device, queue: device.queue, adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: navigator.userAgent, model: { revision: episode.reference.model.revision, weightsHash: attentionWeightsHash }, kernel: attentionRoute.kernel, tensors: { shape: attentionShape, current: { image: frame1Image, src: frame1Image, srcPos: frame1Position }, bank, layers: attentionWeights.layers, finalNorm: attentionWeights.finalNorm }, includeReadback: true });
  const conditionedParity = verificationAttached ? maxAbs(frame1AttentionResult.debugReadback.memory, await expectedEpisodeTensor('frame-1-memory-conditioned-features')) : null;

  const frame1Inputs = { imageEmbedding: new Float32Array(frame1AttentionResult.debugReadback.memory), imagePosition: frame1Position, highResolutionS0: isTwoImage ? imageBackbone.frame1.highResolutionS0 : await episodeTensor('frame-1-high-resolution-s0'), highResolutionS1: isTwoImage ? imageBackbone.frame1.highResolutionS1 : await episodeTensor('frame-1-high-resolution-s1'), extraPerObjectEmbedding: await episodeTensor('frame-1-extra-per-object-embedding') };
  const frame1Expected = verificationAttached ? { selectedMasks: await expectedEpisodeTensor('frame-1-selected-masks'), objectScores: await expectedEpisodeTensor('frame-1-object-scores'), objectPointers: await expectedEpisodeTensor('frame-1-object-pointers') } : null;
  update('running', 'frame-1-decoder', { frame1AttentionReceipt: frame1AttentionResult.receipt });
  const frame1Decoder = await decoderInvocation({ frame: 1, inputs: frame1Inputs, expected: frame1Expected, manifest: decoderManifest, shape: decoderExecutionShape, weights: decoderWeights, weightsHash: decoderWeightsHash, adapter, device, adapterInfo, errors });
  const frame1DecoderResult = frame1Decoder.result;

  const frame0Receipts = isMaskConditioned
    ? [frame0MaskConditioningResult.receipt, frame0InteractivePointerResult.receipt]
    : [frame0DecoderResult.receipt];
  const frame0Routes = isMaskConditioned
    ? [frame0MaskConditioning.route, frame0InteractivePointer.route]
    : [frame0Decoder.route];
  const receipts = [...(imageBackbone?.receipts || []), ...frame0Receipts, frame0MemoryResult.receipt, temporalResult.receipt, frame1AttentionResult.receipt, frame1DecoderResult.receipt];
  const requestIds = [
    ...(imageBackbone?.requestIds || []),
    ...(isMaskConditioned ? [frame0MaskConditioning.requestId, frame0InteractivePointer.requestId] : [frame0Decoder.requestId]),
    memoryRequest.requestId,
    temporalRequest.requestId,
    attentionRequest.requestId,
    frame1Decoder.requestId,
  ];
  const requestedRouteIds = [...(imageBackbone?.requestedRouteIds || []), ...frame0Routes.map(route => route.routeId), memoryRoute.routeId, temporalRoute.routeId, attentionRoute.routeId, frame1Decoder.route.routeId];
  const effectiveRouteIds = receipts.map(receipt => receipt.effectiveRouteId);
  const maximums = verificationAttached ? { frame0Producer: frame0Producer.maximum, frame0Decoder: frame0Decoder?.maximum ?? null, frame0MaskConditioning: frame0MaskConditioning?.maximum ?? null, frame0InteractivePointer: frame0InteractivePointer?.maximum ?? null, frame0Memory: Math.max(...Object.values(memoryParity)), temporalBank: Math.max(...Object.values(bankParity)), frame1Attention: conditionedParity, frame1Decoder: frame1Decoder.maximum } : null;
  const routeChainPassed = receipts.every((receipt, index) => receipt.status === 'real' && receipt.fallbackReason == null && receipt.effectiveRouteId === requestedRouteIds[index]);
  const suppressionPassed = !verificationAttached
    ? isMaskConditioned && suppression.suppressedAbsentMaskCount === 0 && suppression.semanticsPassed
    : isMaskConditioned
    ? episode.stateTransition.noObjectMaskScore === null && episode.stateTransition.frame0SuppressedAbsentMaskCount === 0 && suppression.suppressedAbsentMaskCount === 0
    : episode.stateTransition.noObjectMaskScore === NO_OBJ_SCORE && suppression.suppressedAbsentMaskCount === episode.stateTransition.frame0SuppressedAbsentMaskCount && suppression.suppressedAbsentMaskCount === episode.stateTransition.frame0AbsentObjectCount && suppression.semanticsPassed;
  const expectedBridgeDebt = [];
  const pointerDigestPassed = !isMaskConditioned
    || trackerStateSnapshot.frames[0].tensorDigests.pointers === frame0Producer.pointerOutput.sha256;
  const persistentStatePassed = preparedTrackerState.stateVersion === 1
    && trackerStateSnapshot.conditioningFrameIndices.length === 1
    && trackerStateSnapshot.conditioningFrameIndices[0] === 0
    && trackerStateSnapshot.nonConditioningFrameIndices.length === 0
    && JSON.stringify(trackerStateSnapshot.bridgeDebt) === JSON.stringify(expectedBridgeDebt)
    && trackerStateSnapshot.claims.browserNativeMaskConditioning === isMaskConditioned
    && pointerDigestPassed;
  const stateTransitionPassed = (!verificationAttached || (episode.stateTransition.frame0AppearingObjectCount > 0 && episode.stateTransition.frame0AbsentObjectCount > 0)) && suppressionPassed && persistentStatePassed && plan.spatialFrames.length === 1 && plan.pointerFrames.length === 1 && bank.memory.length === episode.shape.batch * episode.shape.memoryTokens * episode.shape.channels;
  const frame0Tolerance = verificationAttached ? (isMaskConditioned ? episode.tolerances.maskConditioningMaxAbsDiff : episode.tolerances.decoderMaxAbsDiff) : null;
  const pointerParityPassed = !verificationAttached || !isMaskConditioned || maximums.frame0InteractivePointer <= pointerManifest.tolerances.webGpuFinalMaxAbsDiff;
  const frame0ProducerParityPassed = !verificationAttached || (isMaskConditioned
    ? maximums.frame0MaskConditioning <= frame0Tolerance && pointerParityPassed
    : maximums.frame0Decoder <= frame0Tolerance);
  const parityPassed = !verificationAttached || ((imageBackbone?.parityPassed ?? true) && suppressionParity <= frame0Tolerance && frame0ProducerParityPassed && maximums.frame0Memory <= episode.tolerances.memoryMaxAbsDiff && maximums.temporalBank <= episode.tolerances.bankMaxAbsDiff && maximums.frame1Attention <= episode.tolerances.conditionedMaxAbsDiff && maximums.frame1Decoder <= episode.tolerances.decoderMaxAbsDiff);
  const packetAuthorityPassed = packetAuthority.passed === true && packetAuthority.verifiedPackets.length === (isTwoImage ? 6 : isMaskConditioned ? 5 : 4);
  const ingressBindingsPassed = !verificationAttached || !isTwoImage || packetAuthority.packets.episode.ingressBindingsPassed === true;
  const evidence = { packetAuthorityPassed, ingressBindingsPassed, pointerPacketInputDigestPassed, pointerPacketOutputDigestPassed, adapterPassed: adapterInfo.isFallbackAdapter === false, routeChainPassed, persistentStatePassed, stateTransitionPassed, parityPassed, verificationContractPassed: verificationAttached ? parityPassed : activePackageRuntime?.packageResolution?.verification?.attached === false, errorsPassed: errors.length === 0 };
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
  const final = { invocationIndex, episodeMode, verificationAttached, deviceLoss: execution.deviceLoss || null, packageRuntime: activePackageRuntime ? { rootUrl: activePackageRuntime.rootUrl, packageId: activePackageRuntime.packageId, invocationId: activePackageRuntime.invocationId, verificationId: activePackageRuntime.verificationId, sourceImageSha256: activePackageRuntime.sourceImageSha256, encodedSourceImageSha256: activePackageRuntime.encodedSourceImageSha256, rgbaSourceImageSha256: activePackageRuntime.rgbaSourceImageSha256, initialMaskSha256: activePackageRuntime.initialMaskSha256, session: activePackageRuntime.session, packageResolution: activePackageRuntime.packageResolution, cacheEvidence: activePackageRuntime.cacheEvidence() } : null, packetAuthority, trackerState: trackerStateSnapshot, adapterInfo, requestIds, requestedRouteIds, effectiveRouteIds, receipts, parity: verificationAttached ? { imageBackbone: imageBackbone?.parity ?? null, maximums, frame0Decoder: frame0Decoder?.parity ?? null, frame0MaskConditioning: frame0MaskConditioning?.parity ?? null, frame0InteractivePointer: frame0InteractivePointer?.parity ?? null, frame0MaskSuppression: { maxAbsDiff: suppressionParity, suppressedAbsentMaskCount: suppression.suppressedAbsentMaskCount, semanticsPassed: suppression.semanticsPassed, memoryInputMaskSha256: memoryInputMaskHash }, frame0Memory: memoryParity, temporalBank: bankParity, frame1Attention: conditionedParity, frame1Decoder: frame1Decoder.parity } : null, imageBackbone: imageBackbone ? { routeChainPassed: imageBackbone.routeChainPassed, parityPassed: imageBackbone.parityPassed, parityMaximum: imageBackbone.parityMaximum, sourceImageSha256: imageBackbone.sourceImageSha256 } : null, stateTransition: effectiveStateTransition, referenceStateTransition, effectiveStateTransition, pointerDigestPassed, pointerPacketInputDigestPassed, pointerPacketOutputDigestPassed, evidence, uncapturedErrors: errors, manifest: { reference: episode.reference, shape: episode.shape, plan: episode.plan } };
  if (!evidence.passed) throw Object.assign(new Error(`two-frame tracker evidence failed: ${JSON.stringify(evidence)}`), { evidenceState: final });
  return final;
}

async function run() {
  if (!packageMode) {
    const invocationExecution = {};
    try {
      const final = await runInvocation(null, 0, invocationExecution);
      update('passed', 'complete', final);
      return;
    } finally {
      await closeExecutionContext(invocationExecution).catch(() => {});
    }
  }
  let activeSession = null;
  try {
    const invocations = [];
    const betweenInvocationCheckpoints = [];
    for (let index = 0; index < packageRoots.length; index += 1) {
      let callerMetadata = null;
      let callerSourceImages = null;
      let callerInitialMask = null;
      let callerEncodedDigests = null;
      let callerMaskDigest = null;
      if (callerInput) {
        callerMetadata = await fetchJson(`/caller/${callerInputIndex}/metadata.json`);
        callerSourceImages = await Promise.all(callerMetadata.frameUrls.map(fetchBytes));
        const maskBytes = await fetchBytes(callerMetadata.maskUrl);
        if (maskBytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) throw new Error('caller mask byte length is not Float32 aligned');
        callerInitialMask = new Float32Array(maskBytes.buffer.slice(maskBytes.byteOffset, maskBytes.byteOffset + maskBytes.byteLength));
        callerEncodedDigests = await Promise.all(callerSourceImages.map(sha256Bytes));
        callerMaskDigest = await sha256Bytes(maskBytes);
        if (JSON.stringify(callerEncodedDigests) !== JSON.stringify(callerMetadata.authority.encodedSourceImageSha256)
            || callerMaskDigest !== callerMetadata.authority.initialMaskSha256) {
          throw new Error('caller preload bytes do not match the terminal witness authority');
        }
      }
      const session = await createSam31BrowserTrackerSession({
        ...(callerInput ? {
          modelPackageRoot: packageRoots[index],
          sourceImages: callerSourceImages,
          initialMask: callerInitialMask,
          session: callerMetadata.session,
        } : { packageRoot: packageRoots[index] }),
        pageUrl: location.href,
        cache: packageCache,
        commit: params.get('commit') || null,
        onProgress: phase => update('running', phase, { episodeMode, invocationIndex: index }),
      });
      activeSession = session;
      let invocation = await session.run();
      if (callerInput) {
        const callerInputAuthority = {
          encodedSourceImagesPassed: JSON.stringify(invocation.packageRuntime.encodedSourceImageSha256) === JSON.stringify(callerEncodedDigests),
          rgbaSourceImagesPassed: JSON.stringify(invocation.packageRuntime.rgbaSourceImageSha256) === JSON.stringify(callerMetadata.authority.rgbaSourceImageSha256),
          initialMaskPassed: invocation.packageRuntime.initialMaskSha256 === callerMaskDigest,
          expectedRgbaSourceImageSha256: callerMetadata.authority.rgbaSourceImageSha256,
          effectiveRgbaSourceImageSha256: invocation.packageRuntime.rgbaSourceImageSha256,
        };
        callerInputAuthority.passed = callerInputAuthority.encodedSourceImagesPassed
          && callerInputAuthority.rgbaSourceImagesPassed
          && callerInputAuthority.initialMaskPassed;
        if (!callerInputAuthority.passed) throw new Error(`caller browser input authority failed: ${JSON.stringify(callerInputAuthority)}`);
        invocation = { ...invocation, callerInputAuthority };
      }
      const sessionClose = await session.close();
      const gcObserved = index + 1 < packageRoots.length && typeof globalThis.gc === 'function';
      if (gcObserved) globalThis.gc();
      invocations.push({
        ...invocation,
        invocationIndex: index,
        deviceLoss: session.deviceLoss,
        runtimeSession: {
          schema: session.schema,
          executionOwner: '@kaminos/webgpu-inference-kit',
          status: session.status,
          closeEvidence: sessionClose,
        },
      });
      const disposal = {
        queueDrained: sessionClose.queueDrained,
        deviceDestroyed: sessionClose.deviceDestroyed,
        deviceLossAwaited: sessionClose.deviceLossAwaited,
        gcObserved,
      };
      activeSession = null;
      if (index + 1 >= packageRoots.length) continue;
      const checkpoint = { afterInvocationIndex: index, ...disposal, passed: disposal.queueDrained && disposal.deviceDestroyed };
      betweenInvocationCheckpoints.push(checkpoint);
      update('running', 'between-invocation-checkpoint', { completedInvocationCount: invocations.length, invocations, betweenInvocationCheckpoints, deviceLoss: session.deviceLoss });
    }
    const final = invocations.at(-1);
    let dualInvocationEvidence = null;
    if (invocations.length >= 2) {
      dualInvocationEvidence = callerInput
        ? createSam31BrowserTrackerCallerDualInvocationEvidence({ invocations, betweenInvocationCheckpoints })
        : createSam31BrowserTrackerDualInvocationEvidence({ invocations, betweenInvocationCheckpoints });
      if (!dualInvocationEvidence.passed) throw Object.assign(new Error(`dual tracker invocation evidence failed: ${JSON.stringify(dualInvocationEvidence)}`), { evidenceState: { ...final, invocations, dualInvocationEvidence } });
    }
    update('passed', 'complete', { ...final, invocations, betweenInvocationCheckpoints, dualInvocationEvidence, deviceLoss: null });
  } finally {
    await activeSession?.close().catch(() => {});
  }
}

run().catch(error => {
  console.error(error);
  update('failed', state.phase, { ...(error.evidenceState || {}), error: String(error?.stack || error) });
});
