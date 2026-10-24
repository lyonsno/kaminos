import { createRouteInvocationRequest } from './route-boundary.js';
import { createSam31SingleFrameBackbone } from './sam31-two-image-backbone.js';
import { createSam31TrackingInputs } from './sam31-stream-inputs.js';
import { sha256Bytes, sha256Text, loadDecoderWeights, loadInteractivePointerWeights, loadMemoryWeights,
  loadAttentionWeights, decoderInvocation, maskConditioningInvocation, interactivePointerInvocation } from './sam31-browser-tracker-session-driver.js';
import { createSam31MemoryEncoderPhaseProgramRouteDefinition, runSam31MemoryEncoderPhaseProgramRoute } from './sam31-memory-encoder-phase-program.js';
import { createSam31MemoryAttentionPhaseProgramRouteDefinition, runSam31MemoryAttentionPhaseProgramRoute } from './sam31-memory-attention-phase-program.js';
import { createSam31TemporalMemoryBankPhaseProgramRouteDefinition, runSam31TemporalMemoryBankPhaseProgramRoute } from './sam31-temporal-memory-bank-phase-program.js';

export async function hashSam31StreamTensorSet(tensors) {
  const entries = [];
  for (const name of Object.keys(tensors).sort()) {
    const tensor = tensors[name];
    entries.push([name, tensor.constructor.name, tensor.byteLength, await sha256Bytes(tensor)]);
  }
  return sha256Text(JSON.stringify(entries));
}

export async function createSam31StreamDriver({ packageRuntime, adapter, device, adapterInfo, errors,
  commit = null, userAgent = 'unknown-browser', onProgress = () => {}, memoryAttentionKernel = 'online' }) {
  const components = packageRuntime?.modelPackage?.components;
  if (components?.stream?.schema !== 'kaminos.sam31-stream-model.v1') throw new Error('a production stream model component is required');
  if (!['online', 'flash'].includes(memoryAttentionKernel)) throw new Error('unsupported memory attention kernel');
  const { ingress, decoder, pointer, memory, temporal, stream } = components;
  const load = entry => packageRuntime.loadFloat32(entry);
  const imageWidth = ingress.shape.imageWidth, imageHeight = ingress.shape.imageHeight;
  const h = imageHeight / 14, w = imageWidth / 14, channels = 256, multiplexCount = 16;
  if (![h, w].every(n => Number.isInteger(n) && n > 0)) throw new Error('stream model patch geometry is invalid');
  const pointerManifest = { ...pointer, shape: { ...pointer.shape, imageHeight: h, imageWidth: w, imageTokens: h * w,
    sourceImageHeight: imageHeight, sourceImageWidth: imageWidth, sourceMaskHeight: imageHeight, sourceMaskWidth: imageWidth,
    promptMaskHeight: h * 4, promptMaskWidth: w * 4, decoderMaskHeight: h * 4, decoderMaskWidth: w * 4 } };
  const decoderManifest = { ...decoder, shape: { ...decoder.shape, imageHeight: h, imageWidth: w, imageTokens: h * w, maskHeight: h * 4, maskWidth: w * 4 } };
  const temporalManifest = { ...temporal, attentionWeights: temporal.weights };
  let weights = {
    decoder: await loadDecoderWeights(decoder, load), pointer: await loadInteractivePointerWeights(pointer, load),
    memory: await loadMemoryWeights(memory, load), attention: await loadAttentionWeights(temporalManifest, load),
    controls: Object.fromEntries(await Promise.all(Object.entries(stream.controls).map(async ([name, entry]) => [name, await load(entry)]))),
  };
  const temporalEntries = Object.fromEntries(temporal.staticTensors.map(entry => [entry.role, entry]));
  weights.temporalEmbeddings = await load(temporalEntries['maskmem-temporal-embeddings']);
  weights.pointerPositionProjection = { weight: await load(temporalEntries['pointer-position-projection-weight']), bias: await load(temporalEntries['pointer-position-projection-bias']) };
  const hashes = Object.fromEntries(await Promise.all(['decoder', 'pointer', 'memory', 'temporal'].map(async name =>
    [name, await sha256Text(components[name].weights.map(e => `${e.sha256}:${e.byteLength}`).join('\n'))])));
  const backbone = await createSam31SingleFrameBackbone({ packageRuntime, adapter, device, errors, commit, userAgent,
    update: phase => onProgress(phase) });
  const context = { adapter, device, adapterInfo, errors, commit, userAgent, residentTensorResolver: packageRuntime.residentTensorResolver };
  const model = { revision: ingress.reference.model.revision };
  const config = { ...stream.plan, frameTokenCount: h * w, multiplexCount, channels };
  let inputs = null;
  function checked(result, tag) {
    const r = result?.receipt;
    if (errors.length) throw new Error(`stream WebGPU errors: ${errors.join('; ')}`);
    if (r?.status !== 'real' || r.fallbackReason != null || r.requestedRouteId !== r.effectiveRouteId
        || !r.outputs?.length || !r.outputs.every(o => o.artifactId.endsWith(`:${tag}`))) throw new Error('stream phase returned incomplete route evidence');
    return result;
  }
  async function invoke(routeFactory, run, { profile, phase, tag, shape, tensors, roles, outputRoles, extra = {}, weightsHash }) {
    onProgress(phase);
    const kernel = { profile, commit };
    const route = routeFactory({ model, kernel, ...(shape ? { shape } : {}),
      ...(extra.captureIntermediateReadbacks === undefined ? {} : { captureIntermediateReadbacks: extra.captureIntermediateReadbacks }) });
    const inputs = {};
    for (const [role, value, shape] of roles) inputs[role] = { artifactId: `${phase}:${role}:${tag}`,
      sha256: typeof value === 'string' ? value : await sha256Bytes(value), ...(shape ? { shape } : {}) };
    const outputs = Object.fromEntries(outputRoles.map(([role, shape]) => [role, { artifactId: `${phase}:${role}:${tag}`, shape }]));
    const request = createRouteInvocationRequest(route, { requestId: `${phase}:${tag}`, inputs, outputs });
    return checked(await run({ request, route, adapter, device, queue: device.queue,
      adapterName: adapterInfo.description || 'browser-webgpu-adapter', browser: userAgent,
      model: { ...model, weightsHash }, kernel, tensors, residentTensorResolver: context.residentTensorResolver,
      includeReadback: true, ...extra }), tag);
  }
  async function execute({ rgba, frameIndex, conditioning, mask, objectSlot, temporal: prepared }) {
    if (!weights) throw new Error('stream driver is closed');
    const started = performance.now(), tag = `sam31-stream-${crypto.randomUUID()}`;
    if (conditioning) inputs = createSam31TrackingInputs({ ...weights.controls, height: h, width: w, objectSlots: [objectSlot] });
    if (!inputs) throw new Error('stream must be conditioned first');
    const encoded = await backbone.run({ rgba, frameIndex, conditioning, invocationTag: tag });
    const frame = encoded.frame, receipts = [...encoded.receipts];
    let masks, scores, pointers, maskHeight, maskWidth;
    if (conditioning) {
      const binaryMasks = new Float32Array(16 * imageWidth * imageHeight);
      binaryMasks.set(mask, objectSlot * mask.length);
      const conditioned = checked((await maskConditioningInvocation({ ...context, invocationTag: tag,
        inputs: { imageEmbedding: frame.interactiveEmbedding, binaryMasks },
        manifest: { reference: ingress.reference, shape: { multiplexCount, sourceMaskHeight: imageHeight, sourceMaskWidth: imageWidth } } })).result, tag);
      const pointed = checked((await interactivePointerInvocation({ ...context, invocationTag: tag,
        inputs: { imageEmbedding: inputs.conditionImage(frame.interactiveEmbedding), binaryMasks },
        manifest: pointerManifest, weights: weights.pointer })).result, tag);
      masks = new Float32Array(conditioned.debugReadback.maskLogits);
      scores = new Float32Array(conditioned.debugReadback.objectScores);
      pointers = new Float32Array(pointed.debugReadback.objectPointers);
      maskHeight = imageHeight; maskWidth = imageWidth;
      receipts.push(conditioned.receipt, pointed.receipt);
    } else {
      const { plan, spatialFrames, pointerFrames } = prepared;
      const spatialHash = await hashSam31StreamTensorSet(Object.fromEntries(spatialFrames.flatMap(f =>
        ['memory', 'memoryPosition', 'image', 'imagePosition'].map(key => [`${f.frameIndex}:${key}`, f[key]]))));
      const pointerHash = await hashSam31StreamTensorSet(Object.fromEntries(pointerFrames.map(f => [`${f.frameIndex}:pointers`, f.pointers])));
      const positionHash = await hashSam31StreamTensorSet({ temporal: weights.temporalEmbeddings, ...weights.pointerPositionProjection });
      const bankResult = await invoke(createSam31TemporalMemoryBankPhaseProgramRouteDefinition, runSam31TemporalMemoryBankPhaseProgramRoute,
        { phase: 'temporal-bank', profile: 'sam31-temporal-memory-bank-phase-program-v0', tag, weightsHash: hashes.temporal,
          roles: [['source-video-episode', await sha256Text(JSON.stringify(plan))],
            ['sam31-temporal-spatial-memory-frames', spatialHash, [1, spatialFrames.length, h * w, channels]],
            ['sam31-temporal-object-pointer-frames', pointerHash, [1, pointerFrames.length, 16, channels]],
            ['sam31-temporal-memory-position-weights', positionHash]],
          outputRoles: [['sam31-temporal-memory-attention-bank', [1, plan.memoryTokenCount, channels]]],
          extra: { plan, spatialFrames, pointerFrames, temporalEmbeddings: weights.temporalEmbeddings,
            pointerPositionProjection: weights.pointerPositionProjection, channels, batch: 1, multiplexCount } });
      const readback = bankResult.debugReadback;
      const bank = { memory: new Float32Array(readback.memory), memoryImage: new Float32Array(readback.memoryImage),
        memoryPos: new Float32Array(readback.memoryPosition), memoryImagePos: new Float32Array(readback.memoryImagePosition) };
      const shape = { batch: 1, queryHeight: h, queryWidth: w, queryTokens: h * w,
        memorySpatialTokens: plan.spatialTokenCount, numObjPtrTokens: plan.objectPointerTokenCount, memoryTokens: plan.memoryTokenCount,
        channels, heads: 8, headDim: 32, mlpHidden: 2048, layerCount: 4 };
      const attended = await invoke(createSam31MemoryAttentionPhaseProgramRouteDefinition, runSam31MemoryAttentionPhaseProgramRoute,
        { phase: 'memory-attention', profile: 'sam31-memory-attention-phase-program-v0', tag, shape, weightsHash: hashes.temporal,
          roles: [['source-image', rgba, [imageHeight, imageWidth, 4]],
            ['sam31-memory-attention-current-tensors', await hashSam31StreamTensorSet({ image: frame.propagationEmbedding, position: frame.propagationPosition }), [1, h * w, channels]],
            ['sam31-memory-attention-bank-tensors', await hashSam31StreamTensorSet(bank), [1, plan.memoryTokenCount, channels]],
            ['sam31-memory-attention-weights', hashes.temporal]],
          outputRoles: [['sam31-memory-conditioned-features', [1, h * w, channels]]],
          tensors: { shape, current: { image: frame.propagationEmbedding, src: frame.propagationEmbedding, srcPos: frame.propagationPosition },
            bank, layers: weights.attention.layers, finalNorm: weights.attention.finalNorm },
          extra: { attentionKernel: memoryAttentionKernel, captureIntermediateReadbacks: false } });
      const decoded = checked((await decoderInvocation({ ...context, invocationTag: tag, frame: frameIndex,
        manifest: decoderManifest, weights: weights.decoder, weightsHash: hashes.decoder,
        inputs: { imageEmbedding: new Float32Array(attended.debugReadback.memory), imagePosition: inputs.imagePosition,
          highResolutionS0: frame.highResolutionS0, highResolutionS1: frame.highResolutionS1,
          extraPerObjectEmbedding: inputs.extraPerObjectEmbedding } })).result, tag);
      scores = new Float32Array(decoded.debugReadback.objectScores);
      pointers = new Float32Array(decoded.debugReadback.objectPointers);
      masks = inputs.suppressMasks(new Float32Array(decoded.debugReadback.selectedMasks), scores);
      maskWidth = w * 4; maskHeight = h * 4;
      receipts.push(bankResult.receipt, attended.receipt, decoded.receipt);
    }
    const memoryInput = inputs.memoryInputs({ masks, scores, pointers, width: maskWidth, height: maskHeight,
      targetWidth: imageWidth, targetHeight: imageHeight, conditioning });
    const memoryShape = { batch: 1, featureHeight: h, featureWidth: w, featureChannels: channels,
      maskHeight: imageHeight, maskWidth: imageWidth, multiplexCount, conditionChannels: true,
      conditioning: memoryInput.conditioning, resampledMaskHeight: h * 16, resampledMaskWidth: w * 16 };
    const stored = await invoke(createSam31MemoryEncoderPhaseProgramRouteDefinition, runSam31MemoryEncoderPhaseProgramRoute,
      { phase: 'memory-encoder', profile: 'sam31-memory-encoder-phase-program-v0', tag, weightsHash: hashes.memory,
        roles: [['source-image', rgba, [imageHeight, imageWidth, 4]], ['sam31-propagation-feature-2', frame.propagationEmbedding, [1, h, w, channels]],
          ['sam31-multiplex-mask-logits', memoryInput.maskLogits, [16, 1, imageHeight, imageWidth]],
          ['sam31-multiplex-conditioning', memoryInput.conditioning, [1, 16]],
          ['sam31-multiplex-object-scores', memoryInput.objectScores, [16, 1]], ['sam31-memory-encoder-weights', hashes.memory]],
        outputRoles: [['sam31-mask-memory-features', [1, h, w, channels]], ['sam31-mask-memory-position-encoding', [1, h, w, channels]]],
        tensors: { propagationFeature: frame.propagationEmbedding, ...memoryInput, shape: memoryShape,
          config: memory.config, weights: weights.memory } });
    receipts.push(stored.receipt);
    return { frameIndex, sourceImageSha256: encoded.sourceImageSha256, maskLogits: masks, objectScores: memoryInput.objectScores,
      maskWidth, maskHeight, receipts, verificationAttached: false, numericalParity: null,
      memory: { memory: new Float32Array(stored.debugReadback.memoryFeatures), memoryPosition: new Float32Array(stored.debugReadback.memoryPositionEncoding),
        image: frame.propagationEmbedding, imagePosition: frame.propagationPosition, pointers: memoryInput.pointers },
      timing: { kind: 'host-wall', frameMs: performance.now() - started, backbone: encoded.timing } };
  }
  return { config, imageWidth, imageHeight, execute, close() { backbone.close(); weights = null; inputs = null; } };
}
