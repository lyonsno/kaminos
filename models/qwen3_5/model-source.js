function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer`);
}
export function projectionSlices(rows, columns, group, bindingBytes) {
  for (const [key, value] of Object.entries({ rows, columns, group, bindingBytes })) positive(value, key);
  if (columns % group || columns % 8 || group % 8) throw new RangeError('invalid affine4 geometry');
  const rowBytes = Math.max(columns / 2, columns / group * 4);
  const perSlice = Math.floor(bindingBytes / rowBytes);
  if (!perSlice) throw new RangeError('one projection row exceeds device binding capacity');
  const slices = [];
  for (let rowStart = 0; rowStart < rows; rowStart += perSlice) slices.push({ rowStart, rows: Math.min(perSlice, rows - rowStart) });
  return slices;
}
export function decodeTensor(raw, row) {
  if (!(raw instanceof ArrayBuffer) || raw.byteLength !== row.bytes) throw new Error('partial tensor bytes');
  const elements = row.shape?.reduce((a, b) => { positive(b, 'shape dimension'); return a * b; }, 1);
  const width = row.dtype === 'BF16' ? 2 : row.dtype === 'U32' || row.dtype === 'F32' ? 4 : 0;
  if (!width || !Number.isSafeInteger(elements) || elements * width !== row.bytes) throw new Error('unsupported dtype or tensor shape');
  if (row.dtype === 'U32') return new Uint32Array(raw);
  if (row.dtype === 'F32') return new Float32Array(raw);
  const bits = new Uint32Array(elements), view = new DataView(raw);
  for (let i = 0; i < elements; i++) bits[i] = view.getUint16(i * 2, true) << 16;
  return new Float32Array(bits.buffer);
}
export async function fetchTensor(baseUrl, row, { fetchImpl = fetch, signal = null } = {}) {
  if (typeof row.file !== 'string' || row.file.includes('/') || row.file.includes('\\') || row.file === '..') throw new Error('tensor file must be a local basename');
  if (!Number.isSafeInteger(row.offset) || row.offset < 0) throw new Error('invalid tensor offset');
  positive(row.bytes, 'tensor bytes');
  const end = row.offset + row.bytes - 1;
  if (!Number.isSafeInteger(end)) throw new Error('tensor range exceeds integer address domain');
  const response = await fetchImpl(new URL(encodeURIComponent(row.file), baseUrl), { signal, headers: { Range: `bytes=${row.offset}-${end}` } });
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  if (response.status !== 206 || !range || Number(range[1]) !== row.offset || Number(range[2]) !== end || Number(range[3]) <= end) throw new Error('source did not honor the tensor range');
  const raw = await response.arrayBuffer();
  if (raw.byteLength !== row.bytes) throw new Error('partial tensor response');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== row.sha256) throw new Error('tensor hash mismatch');
  return decodeTensor(raw, row);
}
