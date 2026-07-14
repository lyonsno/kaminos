import {
  createSam31BrowserTrackerInvocationId,
  SAM31_BROWSER_TRACKER_INVOCATION_SCHEMA,
  SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
} from './sam31-browser-tracker-package.js';
import { createSam31BrowserTrackerDualInvocationEvidence } from './sam31-browser-tracker-package-runtime.js';

const PACKET_NAMES = Object.freeze(['ingress', 'decoder', 'memory', 'temporal', 'episode', 'pointer']);

function bytesView(value, label) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new Error(`${label} must be an ArrayBuffer or typed-array view`);
}

async function sourceBytes(value, label) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { bytes: new Uint8Array(await value.arrayBuffer()), mediaType: value.type || 'application/octet-stream' };
  }
  return { bytes: bytesView(value, label), mediaType: 'application/octet-stream' };
}

async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function sha256Text(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function canonicalText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateSession(value, multiplexCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('caller tracker session must be an object');
  if (typeof value.sessionId !== 'string' || !value.sessionId) throw new Error('caller tracker sessionId is required');
  if (value.conditioningFrameIndex !== 0) throw new Error('caller tracker conditioningFrameIndex must be 0');
  if (!Array.isArray(value.propagationFrameIndices) || value.propagationFrameIndices.length !== 1 || value.propagationFrameIndices[0] !== 1) {
    throw new Error('caller tracker propagationFrameIndices must be [1]');
  }
  if (!Array.isArray(value.conditioningObjects)
      || value.conditioningObjects.length !== multiplexCount
      || value.conditioningObjects.some((object, index) => object !== index)) {
    throw new Error(`caller tracker conditioningObjects must enumerate ${multiplexCount} objects`);
  }
  if (!Number.isInteger(value.maskVariant)) throw new Error('caller tracker maskVariant must be an integer');
  return structuredClone(value);
}

function composeManifests(modelPackage, invocation) {
  const dynamicByPacket = Object.fromEntries(PACKET_NAMES.map(name => [name, []]));
  for (const entry of invocation.dynamicArtifacts) dynamicByPacket[entry.packetName].push(entry);
  return Object.fromEntries(PACKET_NAMES.map(name => {
    const component = modelPackage.components[name];
    if (!component) throw new Error(`model package is missing ${name} component`);
    const packet = {
      ...structuredClone(component),
      tensors: [...structuredClone(component.staticTensors || []), ...structuredClone(dynamicByPacket[name])],
    };
    if (name === 'temporal') {
      packet.attentionWeights = packet.weights || [];
      delete packet.weights;
    }
    if (name === 'ingress') packet.sourceImages = structuredClone(invocation.sourceImages);
    if (name === 'episode') packet.stateTransition = { conditioningObjects: [...invocation.session.conditioningObjects] };
    return [name, packet];
  }));
}

export async function decodeSam31BrowserTrackerSourceImage(bytes, { width, height, mediaType = 'application/octet-stream' }) {
  if (typeof createImageBitmap !== 'function') throw new Error('browser image decoder createImageBitmap is required');
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }), {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : globalThis.document?.createElement?.('canvas');
    if (!canvas) throw new Error('browser canvas surface is required to decode caller images');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('browser 2D canvas context is required to decode caller images');
    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' });
    const rgba = resizeRgbaMetaBicubic(image.data, bitmap.width, bitmap.height, width, height);
    return {
      rgba: new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)),
      width,
      height,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      decoder: 'browser-createImageBitmap-native-rgb-pillow-default-bicubic',
    };
  } finally {
    bitmap.close?.();
  }
}

export function resizeRgbaMetaBicubic(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const precisionBits = 22;
  const precisionScale = 2 ** precisionBits;
  const rounding = 2 ** (precisionBits - 1);
  const cubic = value => {
    const x = Math.abs(value);
    if (x < 1) return ((1.5 * x - 2.5) * x * x) + 1;
    if (x < 2) return (((-0.5 * x + 2.5) * x - 4) * x) + 2;
    return 0;
  };
  const coefficients = (inputSize, outputSize) => {
    const scale = inputSize / outputSize;
    const filterScale = Math.max(scale, 1);
    const support = 2 * filterScale;
    return Array.from({ length: outputSize }, (_, outputIndex) => {
      const center = (outputIndex + 0.5) * scale;
      const start = Math.max(0, Math.floor(center - support + 0.5));
      const end = Math.min(inputSize, Math.floor(center + support + 0.5));
      const weights = new Float64Array(end - start);
      let total = 0;
      for (let index = start; index < end; index += 1) {
        const weight = cubic((index - center + 0.5) / filterScale);
        weights[index - start] = weight;
        total += weight;
      }
      for (let index = 0; index < weights.length; index += 1) weights[index] /= total;
      return {
        start,
        end,
        weights: Int32Array.from(weights, weight => Math.trunc(weight * precisionScale + (weight < 0 ? -0.5 : 0.5))),
      };
    });
  };
  const horizontal = new Uint8Array(sourceHeight * targetWidth * 3);
  const horizontalCoefficients = coefficients(sourceWidth, targetWidth);
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const { start, end, weights } = horizontalCoefficients[x];
      for (let channel = 0; channel < 3; channel += 1) {
        let value = rounding;
        for (let sourceX = start; sourceX < end; sourceX += 1) value += source[(y * sourceWidth + sourceX) * 4 + channel] * weights[sourceX - start];
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
        for (let sourceY = start; sourceY < end; sourceY += 1) value += horizontal[(sourceY * targetWidth + x) * 3 + channel] * weights[sourceY - start];
        output[(y * targetWidth + x) * 4 + channel] = Math.min(255, Math.max(0, Math.floor(value / precisionScale)));
      }
      output[(y * targetWidth + x) * 4 + 3] = 255;
    }
  }
  return new Uint8Array(output.buffer);
}

export async function createSam31BrowserTrackerCallerInvocationRuntime({
  modelPackageRuntime,
  sourceImages,
  initialMask,
  session,
  decodeImage = decodeSam31BrowserTrackerSourceImage,
}) {
  const modelPackage = modelPackageRuntime?.modelPackage;
  if (!modelPackage || modelPackage.packageId !== modelPackageRuntime?.packageId) throw new Error('authenticated SAM 3.1 model package runtime is required');
  if (!Array.isArray(sourceImages) || sourceImages.length !== 2) throw new Error('caller tracker invocation requires two encoded source images');
  if (typeof decodeImage !== 'function') throw new Error('caller tracker image decoder is required');
  const imageHeight = modelPackage.geometry?.ingress?.imageHeight;
  const imageWidth = modelPackage.geometry?.ingress?.imageWidth;
  const multiplexCount = modelPackage.geometry?.episode?.multiplexCount;
  const maskHeight = modelPackage.geometry?.episode?.maskHeight;
  const maskWidth = modelPackage.geometry?.episode?.maskWidth;
  if (![imageHeight, imageWidth, multiplexCount, maskHeight, maskWidth].every(Number.isInteger)) throw new Error('model package caller-input geometry is incomplete');
  const effectiveSession = validateSession(session, multiplexCount);
  if (!(initialMask instanceof Float32Array)) throw new Error('caller initial mask must be Float32Array');
  const expectedMaskLength = multiplexCount * maskHeight * maskWidth;
  if (initialMask.length !== expectedMaskLength) throw new Error(`caller initial mask length ${initialMask.length} != ${expectedMaskLength}`);
  if (initialMask.some(value => !Number.isFinite(value))) throw new Error('caller initial mask contains non-finite values');
  if (initialMask.some(value => value !== 0 && value !== 1)) throw new Error('caller initial mask must contain only binary values');
  const effectiveMask = new Float32Array(initialMask);

  const sourceSnapshots = await Promise.all(sourceImages.map((source, frameIndex) => sourceBytes(source, `caller source image ${frameIndex}`)));
  const decoded = [];
  for (let frameIndex = 0; frameIndex < sourceImages.length; frameIndex += 1) {
    const source = sourceSnapshots[frameIndex];
    if (source.bytes.byteLength === 0) throw new Error(`caller source image ${frameIndex} is empty`);
    const result = await decodeImage(source.bytes, { width: imageWidth, height: imageHeight, mediaType: source.mediaType, frameIndex });
    const rgba = bytesView(result?.rgba, `decoded source image ${frameIndex} RGBA`);
    if (result?.width !== imageWidth || result?.height !== imageHeight || rgba.length !== imageHeight * imageWidth * 4) {
      throw new Error(`caller decoded image geometry mismatch for frame ${frameIndex}`);
    }
    decoded.push({ frameIndex, source, rgba, decoder: result.decoder || 'caller-decoder', sourceWidth: result.sourceWidth ?? null, sourceHeight: result.sourceHeight ?? null });
  }
  const encodedDigests = await Promise.all(decoded.map(frame => sha256Bytes(frame.source.bytes)));
  const rgbaDigests = await Promise.all(decoded.map(frame => sha256Bytes(frame.rgba)));
  if (new Set(encodedDigests).size !== 2) throw new Error('tracker invocation requires distinct encoded source images');
  if (new Set(rgbaDigests).size !== 2) throw new Error('tracker invocation requires distinct decoded RGBA source images');
  const maskBytes = new Uint8Array(effectiveMask.buffer);
  const maskSha256 = await sha256Bytes(maskBytes);
  const registry = new Map();
  const dynamicArtifacts = decoded.map((frame, frameIndex) => {
    const role = `frame-${frameIndex}-rgba`;
    const file = `caller://ingress/${role}/${rgbaDigests[frameIndex].slice(7)}`;
    registry.set(file, frame.rgba);
    return { role, layout: 'H,W,RGBA', file, sha256: rgbaDigests[frameIndex], byteLength: frame.rgba.byteLength, dtype: 'uint8', shape: [imageHeight, imageWidth, 4], packetName: 'ingress', invocationRole: 'source-image' };
  });
  const maskFile = `caller://episode/frame-0-binary-mask-inputs/${maskSha256.slice(7)}`;
  registry.set(maskFile, effectiveMask);
  dynamicArtifacts.push({ role: 'frame-0-binary-mask-inputs', file: maskFile, sha256: maskSha256, byteLength: effectiveMask.byteLength, dtype: 'float32', shape: [multiplexCount, 1, maskHeight, maskWidth], packetName: 'episode', invocationRole: 'initial-mask' });
  const invocation = {
    schema: SAM31_BROWSER_TRACKER_INVOCATION_SCHEMA,
    invocationId: 'pending',
    modelPackageId: modelPackage.packageId,
    sourceImages: decoded.map((frame, frameIndex) => ({
      frameIndex,
      role: `frame-${frameIndex}-rgba`,
      file: dynamicArtifacts[frameIndex].file,
      sha256: rgbaDigests[frameIndex],
      byteLength: frame.rgba.byteLength,
      originalSha256: encodedDigests[frameIndex],
      rgbaSha256: rgbaDigests[frameIndex],
    })),
    initialMask: { role: 'frame-0-binary-mask-inputs', file: maskFile, sha256: maskSha256, byteLength: effectiveMask.byteLength },
    session: effectiveSession,
    dynamicArtifacts,
  };
  invocation.invocationId = await createSam31BrowserTrackerInvocationId(invocation);
  const invocationSha256 = await sha256Text(canonicalText(invocation));
  const manifests = composeManifests(modelPackage, invocation);
  const inputEvidence = {
    schema: 'kaminos.sam31-browser-tracker-caller-input-evidence.v0',
    source: 'caller-owned-browser-memory',
    decoder: decoded.map(frame => ({ decoder: frame.decoder, sourceWidth: frame.sourceWidth, sourceHeight: frame.sourceHeight, targetWidth: imageWidth, targetHeight: imageHeight })),
    encodedSourceImageSha256: encodedDigests,
    rgbaSourceImageSha256: rgbaDigests,
    initialMaskSha256: maskSha256,
    dynamicOriginFetchCount: 0,
    callerArtifactReadCount: 0,
  };
  const readCaller = (entry, Type) => {
    const value = registry.get(entry?.file);
    if (!value) return null;
    if (!(value instanceof Type)) throw new Error(`${entry.role || entry.file} caller artifact dtype mismatch`);
    if (entry.sha256 !== (entry.role === 'frame-0-binary-mask-inputs' ? maskSha256 : rgbaDigests[Number(entry.role?.match(/^frame-(\d+)-rgba$/)?.[1])])) {
      throw new Error(`${entry.role || entry.file} caller artifact identity mismatch`);
    }
    inputEvidence.callerArtifactReadCount += 1;
    return new Type(value);
  };
  return {
    rootUrl: modelPackageRuntime.rootUrl,
    packageId: modelPackage.packageId,
    invocationId: invocation.invocationId,
    verificationId: null,
    verificationAttached: false,
    encodedSourceImageSha256: encodedDigests,
    rgbaSourceImageSha256: rgbaDigests,
    sourceImageSha256: rgbaDigests,
    initialMaskSha256: maskSha256,
    session: structuredClone(invocation.session),
    manifests,
    packageResolution: {
      schema: SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.evidenceSchema,
      packageId: modelPackage.packageId,
      invocationId: invocation.invocationId,
      modelPackage: structuredClone(modelPackageRuntime.packageResolution.modelPackage),
      invocation: { schema: invocation.schema, source: 'browser-caller-inputs', sha256: invocationSha256, effectiveSha256: invocationSha256 },
      verification: { attached: false },
    },
    componentAuthorities: null,
    inputEvidence,
    invocation: structuredClone(invocation),
    async loadFloat32(entry) { return readCaller(entry, Float32Array) || modelPackageRuntime.loadFloat32(entry); },
    async loadUint8(entry) { return readCaller(entry, Uint8Array) || modelPackageRuntime.loadUint8(entry); },
    cacheEvidence: () => ({ ...modelPackageRuntime.cacheEvidence(), callerArtifactReadCount: inputEvidence.callerArtifactReadCount, dynamicOriginFetchCount: 0 }),
  };
}

function sameValues(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function createSam31BrowserTrackerCallerDualInvocationEvidence({
  invocations,
  betweenInvocationCheckpoints = [],
}) {
  const base = createSam31BrowserTrackerDualInvocationEvidence({ invocations, betweenInvocationCheckpoints });
  const callerInputAuthorityPassed = invocations.every(invocation => {
    const runtime = invocation.packageRuntime;
    const input = runtime?.inputEvidence;
    return input?.source === 'caller-owned-browser-memory'
      && sameValues(input.encodedSourceImageSha256, runtime.encodedSourceImageSha256)
      && sameValues(input.rgbaSourceImageSha256, runtime.rgbaSourceImageSha256)
      && input.initialMaskSha256 === runtime.initialMaskSha256
      && input.dynamicOriginFetchCount === 0;
  });
  const evidence = {
    schema: 'kaminos.sam31-browser-tracker-caller-dual-invocation-evidence.v0',
    sameModelPackage: base.sameModelPackage,
    distinctInvocationIds: base.distinctInvocationIds,
    distinctEncodedSourceImages: base.distinctEncodedSourceImages,
    distinctRgbaSourceImages: base.distinctRgbaSourceImages,
    distinctSourceImages: base.distinctSourceImages,
    distinctInitialMasks: base.distinctInitialMasks,
    distinctRequestIds: base.distinctRequestIds,
    distinctOutputIds: base.distinctOutputIds,
    distinctFinalOutputs: base.distinctFinalOutputs,
    bothVerificationFree: invocations.every(invocation => invocation.verificationAttached === false
      && invocation.verificationId == null
      && invocation.parity === null
      && invocation.packageRuntime?.packageResolution?.verification?.attached === false),
    bothRouteChainsReal: base.bothRouteChainsReal,
    noSecondStaticNetworkLoads: base.noSecondStaticNetworkLoads,
    secondStaticCacheHitsObserved: base.secondStaticCacheHitsObserved,
    noSecondStaticOriginNetworkLoads: base.noSecondStaticOriginNetworkLoads,
    secondBackingStoreHitsObserved: base.secondBackingStoreHitsObserved,
    noDynamicNetworkLoads: invocations.every(invocation => invocation.packageRuntime?.cacheEvidence?.dynamicNetworkLoadCount === 0),
    noDynamicOriginFetches: invocations.every(invocation => invocation.packageRuntime?.inputEvidence?.dynamicOriginFetchCount === 0),
    callerArtifactReadsPassed: invocations.every(invocation => invocation.packageRuntime?.inputEvidence?.callerArtifactReadCount === 3),
    callerInputAuthorityPassed,
    externalCallerInputAuthorityPassed: invocations.every(invocation => invocation.callerInputAuthority?.passed === true),
    trackerStateShapePassed: base.trackerStateShapePassed,
    distinctCausalTrackerState: base.distinctCausalTrackerState,
    deterministicTrackerStateShared: base.deterministicTrackerStateShared,
    stateIsolationPassed: base.stateIsolationPassed,
    distinctExecutionRealms: base.distinctExecutionRealms,
    betweenInvocationCheckpointPassed: base.betweenInvocationCheckpointPassed,
    noDeviceLoss: base.noDeviceLoss,
  };
  evidence.passed = Object.entries(evidence)
    .filter(([key]) => key !== 'schema')
    .every(([, value]) => value === true);
  return evidence;
}
