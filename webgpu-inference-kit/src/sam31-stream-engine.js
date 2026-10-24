import { createSam31TemporalMemoryBankPlan } from './sam31-temporal-memory-bank-phase-program.js';

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function tensor(value, length, name) {
  if (!(value instanceof Float32Array) || value.length !== length || value.some(n => !Number.isFinite(n))) {
    throw new Error(`${name} must contain ${length} finite float32 values`);
  }
  return new Float32Array(value);
}

// The executor owns kernels; this owner commits only completed frames and retains
// exactly the forward, stride-one model memory. Raw capture retention is separate.
export function createSam31StreamEngine({ config: supplied, imageWidth, imageHeight, execute, close }) {
  positive(imageWidth, 'imageWidth'); positive(imageHeight, 'imageHeight');
  if (typeof execute !== 'function' || typeof close !== 'function') throw new Error('stream executor and close are required');
  const config = { ...supplied, numFrames: null, memoryTemporalStride: 1 };
  for (const key of ['frameTokenCount', 'channels', 'multiplexCount', 'numMaskmem', 'maxObjectPointerFrames', 'maxConditioningFrames']) positive(config[key], key);
  if (supplied.memoryTemporalStride != null && supplied.memoryTemporalStride !== 1) throw new Error('stream memory retention requires stride one');
  if (config.maxObjectPointerFrames < 2) throw new Error('pointer time scale requires at least two frames');
  const spatial = new Map(), pointers = new Map();
  let status = 'uninitialized', nextFrameIndex = 0, lastTimestamp = null, objectSlot = null;
  let closeResult;
  function idle(forClose = false) {
    if (status === 'busy') throw new Error('tracker is busy');
    if (status === 'closed') throw new Error('tracker is closed');
    if (status === 'close-failed' && !forClose) throw new Error('tracker close failed; retry close');
  }
  async function run(input, conditioning) {
    idle();
    if (conditioning ? status !== 'uninitialized' : status !== 'tracking') {
      throw new Error(conditioning ? 'tracker already initialized' : 'initialize the tracker first');
    }
    if (!Number.isFinite(input.timestamp) || input.timestamp < 0
        || (lastTimestamp !== null && input.timestamp <= lastTimestamp)) throw new Error('timestamp must increase for each completed frame');
    if (!(input.rgba instanceof Uint8Array) || input.rgba.length !== imageWidth * imageHeight * 4) throw new Error('RGBA input does not match tracker geometry');
    let mask = null;
    const slot = conditioning ? input.objectSlot ?? 0 : objectSlot;
    if (conditioning) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= config.multiplexCount) throw new Error('invalid object slot');
      if (!(input.mask instanceof Uint8Array) || input.mask.length !== imageWidth * imageHeight
          || input.mask.some(n => n !== 0 && n !== 1) || !input.mask.some(Boolean)) throw new Error('initial mask must be a nonempty binary source mask');
      mask = new Uint8Array(input.mask);
    }
    const frameIndex = nextFrameIndex, rgba = new Uint8Array(input.rgba), timestamp = input.timestamp;
    const previousStatus = status;
    status = 'busy';
    try {
      let temporal = null;
      if (!conditioning) {
        const plan = createSam31TemporalMemoryBankPlan({ ...config, frameIndex, conditioningFrameIndices: [0],
          nonConditioningFrameIndices: [...new Set([...spatial.keys(), ...pointers.keys()])].filter(i => i !== 0) });
        temporal = { plan,
          spatialFrames: plan.spatialFrames.map(({ frameIndex: i }) => {
            if (!spatial.has(i)) throw new Error(`missing spatial memory for frame ${i}`);
            return { frameIndex: i, ...spatial.get(i) };
          }),
          pointerFrames: plan.pointerFrames.map(({ frameIndex: i }) => {
            if (!pointers.has(i)) throw new Error(`missing pointer memory for frame ${i}`);
            return { frameIndex: i, pointers: pointers.get(i) };
          }) };
      }
      const result = await execute({ rgba, timestamp, frameIndex, conditioning, mask, objectSlot: slot, temporal });
      if (result?.frameIndex !== frameIndex || typeof result.sourceImageSha256 !== 'string' || !result.sourceImageSha256) throw new Error('executor returned an unbound frame');
      const pixels = positive(result.maskWidth, 'maskWidth') * positive(result.maskHeight, 'maskHeight');
      const output = { ...result, timestamp, objectSlot: slot,
        maskLogits: tensor(result.maskLogits, config.multiplexCount * pixels, 'maskLogits'),
        objectScores: tensor(result.objectScores, config.multiplexCount, 'objectScores') };
      delete output.memory;
      const features = config.frameTokenCount * config.channels;
      const memory = Object.fromEntries(['memory', 'memoryPosition', 'image', 'imagePosition'].map(key =>
        [key, tensor(result.memory?.[key], features, key)]));
      const pointer = tensor(result.memory?.pointers, config.multiplexCount * config.channels, 'pointers');
      spatial.set(frameIndex, memory); pointers.set(frameIndex, pointer);
      nextFrameIndex++; lastTimestamp = timestamp; objectSlot = slot;
      // Frame zero is the persistent prompt; every other retained entry is within
      // the next frame's trained memory window, not an arbitrary history limit.
      const spatialStart = nextFrameIndex - (config.numMaskmem - 1);
      const pointerStart = nextFrameIndex - (config.maxObjectPointerFrames - 1);
      for (const i of spatial.keys()) if (i !== 0 && i < spatialStart) spatial.delete(i);
      for (const i of pointers.keys()) if (i !== 0 && i < pointerStart) pointers.delete(i);
      status = 'tracking';
      return output;
    } catch (error) { status = previousStatus; throw error; }
  }
  return Object.freeze({
    initialize: input => run(input, true),
    track: input => run(input, false),
    reset() {
      idle();
      if (status === 'uninitialized') throw new Error('tracker is not initialized');
      spatial.clear(); pointers.clear(); nextFrameIndex = 0; lastTimestamp = null; objectSlot = null; status = 'uninitialized';
    },
    snapshot() { return { status, nextFrameIndex, completedFrames: nextFrameIndex, lastTimestamp, objectSlot,
      spatialFrameIndices: [...spatial.keys()], pointerFrameIndices: [...pointers.keys()] }; },
    async close() {
      if (status === 'closed') return closeResult;
      idle(true); status = 'busy';
      try { closeResult = await close(); status = 'closed'; }
      catch (error) { status = 'close-failed'; throw error; }
      finally { spatial.clear(); pointers.clear(); }
      return closeResult;
    },
  });
}
