import { createCooperativeYield } from '../../webgpu-inference-kit/src/core.js';

// Packed weight tensors as float32 bytes for the GPU. A tensor stored as float16 (manifest
// tensor dtype 'float16', written by pack-half.py) is widened to float32 at load through a
// 65536-entry table, so the kernels always compute in float32; a float32 tensor is passed through.

let HALF_TO_FLOAT = null;
function halfTable() {
  if (HALF_TO_FLOAT) return HALF_TO_FLOAT;
  HALF_TO_FLOAT = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    HALF_TO_FLOAT[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return HALF_TO_FLOAT;
}

// t: a manifest tensor { offset, byteLength, dtype? }. Returns a Uint8Array of float32 bytes.
export function tensorFloat32Bytes(bytes, t) {
  if ((t.dtype ?? 'float32') === 'float32') return new Uint8Array(bytes, t.offset, t.byteLength);
  if (t.dtype !== 'float16') throw new Error(`unsupported tensor dtype ${t.dtype} for ${t.name}`);
  const table = halfTable(), half = new Uint16Array(bytes.slice(t.offset, t.offset + t.byteLength));
  const out = new Float32Array(half.length);
  for (let i = 0; i < half.length; i++) out[i] = table[half[i]];
  return new Uint8Array(out.buffer);
}

// The largest T5 embedding widens to 99 MB. Convert directly into its mapped GPU buffer,
// offering a browser task after each 4 MiB of output rather than blocking on the whole model.
// This changes scheduling and temporary storage only: GPU buffers and FP32 values stay the same.
const CHUNK_VALUES = 1 << 20;
const fallbackYield = createCooperativeYield();
const yieldToBrowser = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : fallbackYield();
export async function uploadWeightTensors(device, manifest, bytes, options = {}) {
  const weights = new Map(), allocated = [];
  try {
    for (const t of manifest.tensors) {
      const dtype = t.dtype ?? 'float32';
      if (!['float16', 'float32'].includes(dtype)) throw new Error(`unsupported tensor dtype ${dtype} for ${t.name}`);
      const values = t.byteLength / (dtype === 'float16' ? 2 : 4), byteLength = values * 4;
      const buffer = device.createBuffer({ size: Math.max(256, Math.ceil(byteLength / 256) * 256),
        usage: 128 | 4 | 8, mappedAtCreation: true });
      allocated.push(buffer);
      const mapped = buffer.getMappedRange();
      if (dtype === 'float16') {
        const half = new Uint16Array(bytes, t.offset, values), out = new Float32Array(mapped, 0, values), table = halfTable();
        for (let at = 0; at < values; at += CHUNK_VALUES) {
          const end = Math.min(values, at + CHUNK_VALUES);
          for (let i = at; i < end; i++) out[i] = table[half[i]];
          await (options.yieldToBrowser ?? yieldToBrowser)();
        }
      } else {
        const source = new Uint8Array(bytes, t.offset, t.byteLength), out = new Uint8Array(mapped);
        for (let at = 0; at < source.length; at += CHUNK_VALUES * 4) {
          out.set(source.subarray(at, at + CHUNK_VALUES * 4), at);
          await (options.yieldToBrowser ?? yieldToBrowser)();
        }
      }
      buffer.unmap();
      weights.set(t.name, { buffer, shape: t.shape, byteLength });
    }
    return weights;
  } catch (e) {
    allocated.forEach(buffer => buffer.destroy());
    throw e;
  }
}
