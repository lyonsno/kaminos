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
