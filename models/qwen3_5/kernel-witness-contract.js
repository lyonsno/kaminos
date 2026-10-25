function length(meta, name) {
  const row = meta.arrays?.[name];
  if (!row || row.dtype !== 'f32' || !Array.isArray(row.shape) || row.shape.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error(`missing f32 reference ${name}`);
  const n = row.shape.reduce((a, b) => a * b, 1);
  if (!Number.isSafeInteger(n) || row.bytes !== n * 4) throw new Error(`invalid reference shape ${name}`);
  return n;
}
export function kernelWitnessContract(meta) {
  if (meta?.schema !== 'kaminos.qwen35-kernel-reference.v1' || meta.source?.effective?.backend !== 'mlx-metal') throw new Error('expected the native MLX Metal kernel reference');
  if (!meta.affine?.length || !meta.gdn?.length || !meta.attention || !meta.chunks?.length) throw new Error('incomplete kernel reference manifest');
  const rows = new Map();
  for (const cs of meta.affine) {
    rows.set(`affine-${cs.name}.full`, length(meta, `affine-${cs.name}.output`));
    rows.set(`affine-${cs.name}.strided`, cs.tokens * 13 + 4);
  }
  for (const cs of meta.gdn) {
    if (meta.chunks.reduce((a, b) => a + b, 0) !== cs.tokens) throw new Error('chunk schedule must cover every reference token');
    for (const mode of ['batch', 'chunks']) for (const stage of ['convolved', 'prepared', 'recurrence', 'state', 'gated', 'history']) {
      rows.set(`gdn-${cs.name}.${mode}.${stage}`, length(meta, `gdn-${cs.name}.${stage}`));
    }
  }
  for (const mode of ['batch', 'chunks']) for (const stage of ['q', 'key-cache', 'value-cache', 'output', 'gated']) {
    rows.set(`attention.${mode}.${stage}`, length(meta, `attention.${stage}`));
  }
  if (rows.size !== meta.affine.length * 2 + meta.gdn.length * 12 + 10) throw new Error('duplicate reference case identities');
  return rows;
}
export function validateKernelWitness(result, meta) {
  const expected = kernelWitnessContract(meta);
  if (result?.backend !== 'webgpu' || !result.adapter || result.adapter.isFallbackAdapter === true) throw new Error('native WebGPU adapter evidence required');
  const info = ['vendor', 'architecture', 'device', 'description'].map(k => result.adapter[k] ?? '').join(' ');
  if (!info.trim() || /swiftshader|software|llvmpipe|lavapipe/i.test(info)) throw new Error('software or unidentified adapter is not native GPU evidence');
  if (!Array.isArray(result.errors) || result.errors.length || !Array.isArray(result.rows)) throw new Error('GPU validation/device errors or missing rows');
  const seen = new Set();
  for (const row of result.rows) {
    if (seen.has(row.name) || !expected.has(row.name)) throw new Error(`duplicate or unexpected observation ${row.name}`);
    seen.add(row.name);
    if (row.elements !== expected.get(row.name) || row.nonFinite !== 0 || !Number.isFinite(row.relL2) || !Number.isFinite(row.maxAbs)
      || row.relL2 > 2e-4 || row.maxAbs > 2e-4 || typeof row.data !== 'string') throw new Error(`kernel mismatch or partial observation ${row.name}`);
  }
  if (seen.size !== expected.size) throw new Error('missing kernel observations');
  return { rows: seen.size };
}
export function adjudicateKernelReadbacks(result, meta, arrays, { affineKernel = null } = {}) {
  if (affineKernel !== null && (!['oracle', 'tiled'].includes(affineKernel) || result?.affineKernel !== affineKernel)) throw new Error('wrong or missing affine kernel route');
  // The page supplies raw bytes. Recompute its metrics on the host against the
  // hash-checked native arrays, so a blank read with optimistic metrics fails.
  const expected = new Map();
  for (const cs of meta.affine) {
    const root = `affine-${cs.name}`, full = arrays.get(`${root}.output`);
    expected.set(`${root}.full`, full);
    const strided = new Float32Array(cs.tokens * 13 + 4).fill(-1234);
    for (let t = 0; t < cs.tokens; t++) strided.set(full.subarray(t * cs.rows + 3, t * cs.rows + 10), 2 + t * 13);
    expected.set(`${root}.strided`, strided);
  }
  for (const cs of meta.gdn) for (const mode of ['batch', 'chunks']) for (const stage of ['convolved', 'prepared', 'recurrence', 'state', 'gated', 'history']) {
    expected.set(`gdn-${cs.name}.${mode}.${stage}`, arrays.get(`gdn-${cs.name}.${stage}`));
  }
  for (const mode of ['batch', 'chunks']) for (const stage of ['q', 'key-cache', 'value-cache', 'output', 'gated']) {
    expected.set(`attention.${mode}.${stage}`, arrays.get(`attention.${stage}`));
  }
  for (const row of result?.rows ?? []) {
    const reference = expected.get(row.name), raw = typeof row.data === 'string' ? Buffer.from(row.data, 'base64') : null;
    if (!reference || !raw || raw.length !== reference.byteLength || raw.length !== row.elements * 4) throw new Error(`partial or unexpected raw observation ${row.name}`);
    const values = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let delta = 0, norm = 0, maxAbs = 0, nonFinite = 0;
    row.pageMetrics = { relL2: row.relL2, maxAbs: row.maxAbs, nonFinite: row.nonFinite };
    for (let i = 0; i < reference.length; i++) {
      const v = values.getFloat32(i * 4, true), r = reference[i];
      if (!Number.isFinite(v) || !Number.isFinite(r)) { nonFinite++; continue; }
      const d = v - r; delta += d * d; norm += r * r; maxAbs = Math.max(maxAbs, Math.abs(d));
    }
    Object.assign(row, { relL2: norm > 0 ? Math.sqrt(delta / norm) : Math.sqrt(delta), maxAbs, nonFinite });
  }
  return validateKernelWitness(result, meta);
}
