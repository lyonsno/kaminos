import { resizeSam3MaskLogits } from './sam3-source-mask.js';

function finiteTensor(value, length, name, copy = true) {
  if (!(value instanceof Float32Array) || value.length !== length || value.some(n => !Number.isFinite(n))) {
    throw new Error(`${name} must contain ${length} finite float32 values`);
  }
  return copy ? new Float32Array(value) : value;
}

// Meta VideoTrackingMultiplex._forward_sam_heads and _get_interactive_pix_mem.
// These are learned production inputs, not the random embeddings in kernel fixtures.
export function createSam31TrackingInputs({ valid, invalid, noMemory, positionMatrix, height, width, objectSlots }) {
  if (![height, width].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('positive feature geometry is required');
  if (!Array.isArray(objectSlots) || !objectSlots.length || new Set(objectSlots).size !== objectSlots.length
      || objectSlots.some(n => !Number.isInteger(n) || n < 0 || n >= 16)) throw new Error('objectSlots must select distinct multiplex slots in [0,16)');
  const validValues = finiteTensor(valid, 16 * 256, 'valid embeddings');
  const invalidValues = finiteTensor(invalid, 16 * 256, 'invalid embeddings');
  const noMemoryValues = finiteTensor(noMemory, 256, 'no-memory embedding');
  const matrix = finiteTensor(positionMatrix, 256, 'position matrix');
  const slots = new Set(objectSlots);
  const extraPerObjectEmbedding = new Float32Array(16 * 256);
  for (let slot = 0; slot < 16; slot++) {
    const source = slots.has(slot) ? validValues : invalidValues;
    extraPerObjectEmbedding.set(source.subarray(slot * 256, (slot + 1) * 256), slot * 256);
  }
  const imagePosition = new Float32Array(height * width * 256);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = 2 * (x + 0.5) / width - 1;
    const ny = 2 * (y + 0.5) / height - 1;
    const offset = (y * width + x) * 256;
    for (let c = 0; c < 128; c++) {
      const angle = (nx * matrix[c] + ny * matrix[128 + c]) * 2 * Math.PI;
      imagePosition[offset + c] = Math.sin(angle);
      imagePosition[offset + 128 + c] = Math.cos(angle);
    }
  }
  return Object.freeze({
    extraPerObjectEmbedding, imagePosition,
    conditionImage(features) {
      const result = finiteTensor(features, height * width * 256, 'interactive features');
      for (let i = 0; i < result.length; i++) result[i] += noMemoryValues[i % 256];
      return result;
    },
    suppressMasks(masks, scores) {
      if (!(masks instanceof Float32Array) || !masks.length || masks.length % 16) throw new Error('mask logits must contain 16 equal planes');
      finiteTensor(scores, 16, 'object scores');
      const result = finiteTensor(masks, masks.length, 'mask logits');
      const pixels = result.length / 16;
      for (let slot = 0; slot < 16; slot++) {
        if (!slots.has(slot) || scores[slot] <= 0) result.fill(-1024, slot * pixels, (slot + 1) * pixels);
      }
      return result;
    },
    memoryInputs({ masks, scores, pointers, width, height, targetWidth, targetHeight, conditioning }) {
      if (![width, height, targetWidth, targetHeight].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('invalid memory mask geometry');
      if (typeof conditioning !== 'boolean') throw new Error('conditioning must be boolean');
      finiteTensor(masks, 16 * width * height, 'memory mask logits', false);
      const objectScores = finiteTensor(scores, 16, 'object scores');
      const objectPointers = finiteTensor(pointers, 16 * 256, 'pointers');
      const maskLogits = new Float32Array(16 * targetWidth * targetHeight);
      const conditions = new Float32Array(16);
      for (let slot = 0; slot < 16; slot++) {
        if (!slots.has(slot)) {
          objectScores[slot] = 0;
          objectPointers.fill(0, slot * 256, (slot + 1) * 256);
          continue;
        }
        // Official order: upsample logits to image resolution, then sigmoid,
        // affine transform and memory-grid resize in the memory encoder.
        maskLogits.set(resizeSam3MaskLogits(masks.subarray(slot * width * height, (slot + 1) * width * height),
          width, height, targetWidth, targetHeight), slot * targetWidth * targetHeight);
        conditions[slot] = conditioning ? 1 : 0;
      }
      return { maskLogits, objectScores, pointers: objectPointers, conditioning: conditions };
    },
  });
}
