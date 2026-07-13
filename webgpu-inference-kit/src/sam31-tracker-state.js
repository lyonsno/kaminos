import { createSam31TemporalMemoryBankPlan } from './sam31-temporal-memory-bank-phase-program.js';

const STATE_SCHEMA = 'kaminos.sam31-tracker-state.v0';
const FRAME_KINDS = new Set(['conditioning', 'non-conditioning']);
const ORIGIN_KINDS = new Set(['mask-conditioning', 'propagation-decoder']);
const ORIGIN_OWNERS = new Set(['browser-webgpu', 'official-reference-bridge']);

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requireState(state) {
  if (state?.schema !== STATE_SCHEMA || !(state.frames instanceof Map)) throw new Error('a SAM3.1 tracker state is required');
  return state;
}

function cloneFloat32(value, expectedLength, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  if (value.length !== expectedLength) throw new Error(`${name} length ${value.length} != ${expectedLength}`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Number.isFinite(value[index])) throw new Error(`${name} contains a non-finite value at ${index}`);
  }
  return new Float32Array(value);
}

function sortedFrameIndices(state, kind) {
  return [...state.frames.values()]
    .filter(frame => frame.kind === kind)
    .map(frame => frame.frameIndex)
    .sort((left, right) => left - right);
}

function validateOrigin(origin) {
  if (!origin || !ORIGIN_KINDS.has(origin.kind)) throw new Error('frame origin.kind must be mask-conditioning or propagation-decoder');
  if (!ORIGIN_OWNERS.has(origin.maskOwner)) throw new Error('frame origin.maskOwner is unsupported');
  if (!ORIGIN_OWNERS.has(origin.pointerOwner)) throw new Error('frame origin.pointerOwner is unsupported');
  if (origin.pointerOwner === 'browser-webgpu') {
    const receipt = origin.pointerReceipt;
    if (receipt?.status !== 'real' || receipt?.fallbackReason != null || typeof receipt?.effectiveRouteId !== 'string') {
      throw new Error('browser-owned pointer requires a real non-fallback receipt');
    }
    if (receipt.requestedRouteId !== receipt.effectiveRouteId) throw new Error('browser-owned pointer receipt requested and effective route ids must match');
    if (receipt.backend?.kind !== 'webgpu-local' || receipt.backend?.runtime !== 'browser') throw new Error('browser-owned pointer receipt requires a browser WebGPU backend');
  }
  return {
    kind: origin.kind,
    maskOwner: origin.maskOwner,
    pointerOwner: origin.pointerOwner,
    pointerReceipt: origin.pointerReceipt ? structuredClone(origin.pointerReceipt) : null,
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
  return { schema: STATE_SCHEMA, config, frames: new Map(), version: 0 };
}

export function insertSam31TrackerFrame(stateInput, input = {}) {
  const state = requireState(stateInput);
  const { config } = state;
  const frameIndex = input.frameIndex;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= config.numFrames) throw new Error(`frameIndex must be in [0, ${config.numFrames})`);
  if (!FRAME_KINDS.has(input.kind)) throw new Error('frame kind must be conditioning or non-conditioning');
  if (state.frames.has(frameIndex)) throw new Error(`tracker frame ${frameIndex} already exists`);
  if (input.kind === 'non-conditioning' && sortedFrameIndices(state, 'conditioning').length === 0) throw new Error('a non-conditioning frame requires stored conditioning state');
  if (!Array.isArray(input.conditioningObjects) || input.conditioningObjects.some(value => !Number.isInteger(value) || value < 0 || value >= config.multiplexCount)) {
    throw new Error('conditioningObjects must contain valid multiplex indices');
  }
  if (new Set(input.conditioningObjects).size !== input.conditioningObjects.length) throw new Error('conditioningObjects must not contain duplicates');

  const frameTensorLength = config.frameTokenCount * config.channels;
  const pointerLength = config.multiplexCount * config.channels;
  const record = Object.freeze({
    frameIndex,
    kind: input.kind,
    conditioningObjects: Object.freeze([...input.conditioningObjects]),
    memory: cloneFloat32(input.memory, frameTensorLength, 'memory'),
    memoryPosition: cloneFloat32(input.memoryPosition, frameTensorLength, 'memoryPosition'),
    image: cloneFloat32(input.image, frameTensorLength, 'image'),
    imagePosition: cloneFloat32(input.imagePosition, frameTensorLength, 'imagePosition'),
    pointers: cloneFloat32(input.pointers, pointerLength, 'pointers'),
    maskLogits: cloneFloat32(input.maskLogits, config.multiplexCount * config.maskHeight * config.maskWidth, 'maskLogits'),
    objectScores: cloneFloat32(input.objectScores, config.multiplexCount, 'objectScores'),
    origin: Object.freeze(validateOrigin(input.origin)),
  });
  state.frames.set(frameIndex, record);
  state.version += 1;
  return record;
}

export function prepareSam31TrackerTemporalInputs(stateInput, input = {}) {
  const state = requireState(stateInput);
  const conditioningFrameIndices = sortedFrameIndices(state, 'conditioning');
  if (conditioningFrameIndices.length === 0) throw new Error('at least one stored conditioning frame is required');
  const nonConditioningFrameIndices = sortedFrameIndices(state, 'non-conditioning');
  const plan = createSam31TemporalMemoryBankPlan({
    ...state.config,
    frameIndex: input.frameIndex,
    conditioningFrameIndices,
    nonConditioningFrameIndices,
    trackInReverse: input.trackInReverse === true,
  });
  const spatialFrames = plan.spatialFrames.map(({ frameIndex }) => {
    const frame = state.frames.get(frameIndex);
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
    const frame = state.frames.get(frameIndex);
    if (!frame) throw new Error(`temporal plan selected missing pointer frame ${frameIndex}`);
    return { frameIndex, pointers: new Float32Array(frame.pointers) };
  });
  return { stateVersion: state.version, plan, spatialFrames, pointerFrames };
}

export function getSam31TrackerStateSnapshot(stateInput) {
  const state = requireState(stateInput);
  const frames = [...state.frames.values()].sort((left, right) => left.frameIndex - right.frameIndex);
  const maskConditioningFrames = frames.filter(frame => frame.origin.kind === 'mask-conditioning');
  const bridgeDebt = [];
  if (maskConditioningFrames.some(frame => frame.origin.maskOwner === 'official-reference-bridge')) bridgeDebt.push('interactive-mask-conditioning-mask-logits');
  if (maskConditioningFrames.some(frame => frame.origin.pointerOwner === 'official-reference-bridge')) bridgeDebt.push('interactive-mask-conditioning-object-pointer');
  return {
    schema: state.schema,
    version: state.version,
    config: { ...state.config },
    conditioningFrameIndices: sortedFrameIndices(state, 'conditioning'),
    nonConditioningFrameIndices: sortedFrameIndices(state, 'non-conditioning'),
    frames: frames.map(frame => ({ frameIndex: frame.frameIndex, kind: frame.kind, conditioningObjects: [...frame.conditioningObjects], origin: structuredClone(frame.origin) })),
    bridgeDebt,
    claims: {
      browserNativeMaskConditioning: maskConditioningFrames.length > 0 && bridgeDebt.length === 0 && maskConditioningFrames.every(frame => frame.origin.maskOwner === 'browser-webgpu' && frame.origin.pointerOwner === 'browser-webgpu'),
    },
  };
}
