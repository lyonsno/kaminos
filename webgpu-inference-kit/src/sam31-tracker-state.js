import { createSam31TemporalMemoryBankPlan } from './sam31-temporal-memory-bank-phase-program.js';

const STATE_SCHEMA = 'kaminos.sam31-tracker-state.v0';
const MASK_CONDITIONING_ROUTE_ID = 'sam3.1.mask-conditioning.phase-program.webgpu-local.v0';
const FRAME_KINDS = new Set(['conditioning', 'non-conditioning']);
const ORIGIN_KINDS = new Set(['mask-conditioning', 'propagation-decoder']);
const ORIGIN_OWNERS = new Set(['browser-webgpu', 'official-reference-bridge']);
const STATE_STORAGE = new WeakMap();

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requireState(state) {
  const storage = STATE_STORAGE.get(state);
  if (state?.schema !== STATE_SCHEMA || !storage) throw new Error('a SAM3.1 tracker state is required');
  return storage;
}

function cloneFloat32(value, expectedLength, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  if (value.length !== expectedLength) throw new Error(`${name} length ${value.length} != ${expectedLength}`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Number.isFinite(value[index])) throw new Error(`${name} contains a non-finite value at ${index}`);
  }
  return new Float32Array(value);
}

async function sha256Float32(value) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required for SAM3.1 tracker state identity');
  const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function sortedFrameIndices(storage, kind) {
  return [...storage.frames.values()]
    .filter(frame => frame.kind === kind)
    .map(frame => frame.frameIndex)
    .sort((left, right) => left - right);
}

function assertShape(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} shape does not match stored tensor geometry`);
}

function validateBrowserReceipt(receipt, label) {
  if (receipt?.status !== 'real' || receipt?.fallbackReason != null) throw new Error(`${label} requires a real non-fallback receipt`);
  if (typeof receipt.requestedRouteId !== 'string' || receipt.requestedRouteId.length === 0 || receipt.requestedRouteId !== receipt.effectiveRouteId) {
    throw new Error(`${label} receipt requested and effective route ids must match`);
  }
  if (receipt.backend?.kind !== 'webgpu-local' || receipt.backend?.runtime !== 'browser') throw new Error(`${label} receipt requires a browser WebGPU backend`);
  return receipt;
}

function validateReceiptOutput(receipt, role, digest, shape, label) {
  const output = receipt.outputs?.find(entry => entry?.role === role);
  if (!output) throw new Error(`${label} receipt is missing ${role}`);
  if (output.sha256 !== digest) throw new Error(`${label} digest does not match ${label.includes('maskLogits') ? 'mask receipt' : 'receipt'} output`);
  assertShape(output.shape, shape, `${label} receipt output`);
}

function validateOrigin(origin, tensors, digests, config) {
  if (!origin || !ORIGIN_KINDS.has(origin.kind)) throw new Error('frame origin.kind must be mask-conditioning or propagation-decoder');
  if (!ORIGIN_OWNERS.has(origin.maskOwner)) throw new Error('frame origin.maskOwner is unsupported');
  if (!ORIGIN_OWNERS.has(origin.pointerOwner)) throw new Error('frame origin.pointerOwner is unsupported');

  let pointerReceipt = null;
  const pointerOutputRole = origin.pointerOutputRole || 'sam31-multiplex-object-pointers';
  if (origin.pointerOwner === 'browser-webgpu') {
    pointerReceipt = validateBrowserReceipt(origin.pointerReceipt, 'browser-owned pointer');
    validateReceiptOutput(pointerReceipt, pointerOutputRole, digests.pointers, [config.multiplexCount, config.channels], 'pointers');
  }

  let maskReceipt = null;
  if (origin.kind === 'mask-conditioning' && origin.maskOwner === 'browser-webgpu') {
    maskReceipt = validateBrowserReceipt(origin.maskReceipt, 'browser-owned mask conditioning');
    if (maskReceipt.requestedRouteId !== MASK_CONDITIONING_ROUTE_ID) throw new Error(`browser-owned mask conditioning requires route ${MASK_CONDITIONING_ROUTE_ID}`);
    validateReceiptOutput(maskReceipt, 'sam31-mask-conditioning-logits', digests.maskLogits, [config.multiplexCount, 1, config.maskHeight, config.maskWidth], 'maskLogits');
    validateReceiptOutput(maskReceipt, 'sam31-mask-conditioning-object-scores', digests.objectScores, [config.multiplexCount, 1], 'objectScores');
  }

  return {
    kind: origin.kind,
    maskOwner: origin.maskOwner,
    pointerOwner: origin.pointerOwner,
    pointerOutputRole,
    maskReceipt: maskReceipt ? structuredClone(maskReceipt) : null,
    pointerReceipt: pointerReceipt ? structuredClone(pointerReceipt) : null,
  };
}

export function createSam31TrackerState(input = {}) {
  const config = Object.freeze({
    numFrames: positiveInteger(input.numFrames, 'numFrames'),
    frameTokenCount: positiveInteger(input.frameTokenCount, 'frameTokenCount'),
    multiplexCount: positiveInteger(input.multiplexCount, 'multiplexCount'),
    channels: positiveInteger(input.channels, 'channels'),
    maskHeight: positiveInteger(input.maskHeight, 'maskHeight'),
    maskWidth: positiveInteger(input.maskWidth, 'maskWidth'),
    numMaskmem: positiveInteger(input.numMaskmem, 'numMaskmem'),
    maxConditioningFrames: input.maxConditioningFrames === -1 ? -1 : positiveInteger(input.maxConditioningFrames, 'maxConditioningFrames'),
    maxObjectPointerFrames: positiveInteger(input.maxObjectPointerFrames, 'maxObjectPointerFrames'),
    memoryTemporalStride: positiveInteger(input.memoryTemporalStride ?? 1, 'memoryTemporalStride'),
    useMaskmemTemporalPositionV2: input.useMaskmemTemporalPositionV2 !== false,
    keepFirstConditioningFrame: input.keepFirstConditioningFrame === true,
    onlyObjectPointersInPastForEval: input.onlyObjectPointersInPastForEval === true,
    useSignedPointerTemporalPosition: input.useSignedPointerTemporalPosition === true,
  });
  const state = Object.freeze({ schema: STATE_SCHEMA, config });
  STATE_STORAGE.set(state, { config, frames: new Map(), version: 0 });
  return state;
}

export async function insertSam31TrackerFrame(stateInput, input = {}) {
  const storage = requireState(stateInput);
  const { config } = storage;
  const frameIndex = input.frameIndex;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= config.numFrames) throw new Error(`frameIndex must be in [0, ${config.numFrames})`);
  if (!FRAME_KINDS.has(input.kind)) throw new Error('frame kind must be conditioning or non-conditioning');
  if (storage.frames.has(frameIndex)) throw new Error(`tracker frame ${frameIndex} already exists`);
  if (input.kind === 'non-conditioning' && sortedFrameIndices(storage, 'conditioning').length === 0) throw new Error('a non-conditioning frame requires stored conditioning state');
  if (!Array.isArray(input.conditioningObjects) || input.conditioningObjects.some(value => !Number.isInteger(value) || value < 0 || value >= config.multiplexCount)) {
    throw new Error('conditioningObjects must contain valid multiplex indices');
  }
  if (new Set(input.conditioningObjects).size !== input.conditioningObjects.length) throw new Error('conditioningObjects must not contain duplicates');

  const frameTensorLength = config.frameTokenCount * config.channels;
  const pointerLength = config.multiplexCount * config.channels;
  const tensors = {
    memory: cloneFloat32(input.memory, frameTensorLength, 'memory'),
    memoryPosition: cloneFloat32(input.memoryPosition, frameTensorLength, 'memoryPosition'),
    image: cloneFloat32(input.image, frameTensorLength, 'image'),
    imagePosition: cloneFloat32(input.imagePosition, frameTensorLength, 'imagePosition'),
    pointers: cloneFloat32(input.pointers, pointerLength, 'pointers'),
    maskLogits: cloneFloat32(input.maskLogits, config.multiplexCount * config.maskHeight * config.maskWidth, 'maskLogits'),
    objectScores: cloneFloat32(input.objectScores, config.multiplexCount, 'objectScores'),
  };
  const digestEntries = await Promise.all(Object.entries(tensors).map(async ([name, value]) => [name, await sha256Float32(value)]));
  const tensorDigests = Object.freeze(Object.fromEntries(digestEntries));
  const origin = Object.freeze(validateOrigin(input.origin, tensors, tensorDigests, config));
  const record = {
    frameIndex,
    kind: input.kind,
    conditioningObjects: Object.freeze([...input.conditioningObjects]),
    ...tensors,
    tensorDigests,
    origin,
  };
  storage.frames.set(frameIndex, record);
  storage.version += 1;
  return Object.freeze({ frameIndex, kind: record.kind, stateVersion: storage.version, tensorDigests });
}

export function prepareSam31TrackerTemporalInputs(stateInput, input = {}) {
  const storage = requireState(stateInput);
  const conditioningFrameIndices = sortedFrameIndices(storage, 'conditioning');
  if (conditioningFrameIndices.length === 0) throw new Error('at least one stored conditioning frame is required');
  const nonConditioningFrameIndices = sortedFrameIndices(storage, 'non-conditioning');
  const plan = createSam31TemporalMemoryBankPlan({
    ...storage.config,
    frameIndex: input.frameIndex,
    conditioningFrameIndices,
    nonConditioningFrameIndices,
    trackInReverse: input.trackInReverse === true,
  });
  const spatialFrames = plan.spatialFrames.map(({ frameIndex }) => {
    const frame = storage.frames.get(frameIndex);
    if (!frame) throw new Error(`temporal plan selected missing spatial frame ${frameIndex}`);
    return {
      frameIndex,
      memory: new Float32Array(frame.memory),
      memoryPosition: new Float32Array(frame.memoryPosition),
      image: new Float32Array(frame.image),
      imagePosition: new Float32Array(frame.imagePosition),
    };
  });
  const pointerFrames = plan.pointerFrames.map(({ frameIndex }) => {
    const frame = storage.frames.get(frameIndex);
    if (!frame) throw new Error(`temporal plan selected missing pointer frame ${frameIndex}`);
    return { frameIndex, pointers: new Float32Array(frame.pointers) };
  });
  return { stateVersion: storage.version, plan, spatialFrames, pointerFrames };
}

export function getSam31TrackerStateSnapshot(stateInput) {
  const storage = requireState(stateInput);
  const frames = [...storage.frames.values()].sort((left, right) => left.frameIndex - right.frameIndex);
  const maskConditioningFrames = frames.filter(frame => frame.origin.kind === 'mask-conditioning');
  const bridgeDebt = [];
  if (maskConditioningFrames.some(frame => frame.origin.maskOwner === 'official-reference-bridge')) bridgeDebt.push('interactive-mask-conditioning-mask-logits');
  if (maskConditioningFrames.some(frame => frame.origin.pointerOwner === 'official-reference-bridge')) bridgeDebt.push('interactive-mask-conditioning-object-pointer');
  return {
    schema: stateInput.schema,
    version: storage.version,
    config: { ...storage.config },
    conditioningFrameIndices: sortedFrameIndices(storage, 'conditioning'),
    nonConditioningFrameIndices: sortedFrameIndices(storage, 'non-conditioning'),
    frames: frames.map(frame => ({
      frameIndex: frame.frameIndex,
      kind: frame.kind,
      conditioningObjects: [...frame.conditioningObjects],
      tensorDigests: { ...frame.tensorDigests },
      origin: structuredClone(frame.origin),
    })),
    bridgeDebt,
    claims: {
      browserNativeMaskConditioning: maskConditioningFrames.length > 0
        && bridgeDebt.length === 0
        && maskConditioningFrames.every(frame => frame.origin.maskOwner === 'browser-webgpu'
          && frame.origin.pointerOwner === 'browser-webgpu'
          && frame.origin.maskReceipt !== null
          && frame.origin.pointerReceipt !== null),
    },
  };
}
