// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { projectionSlices, decodeTensor, fetchTensor } from '../models/qwen3_5/model-source.js';
test('projection sharding follows device binding capacity and covers every vocabulary row', () => {
  const slices = projectionSlices(248320, 4096, 64, 128 * 1024 * 1024);
  assert.equal(slices[0].rows, 65536);
  assert.equal(slices.reduce((sum, x) => sum + x.rows, 0), 248320);
  let offset = 0; for (const s of slices) { assert.equal(s.rowStart, offset); assert.ok(s.rows * 4096 / 2 <= 128 * 1024 * 1024); offset += s.rows; }
  assert.throws(() => projectionSlices(10, 4096, 64, 2047), /binding/);
});
test('BF16 tensor decoding preserves signs, tiny values, and direct norm weights', () => {
  const raw = new Uint8Array([0x80, 0x3f, 0x00, 0xc0, 0x80, 0x00]).buffer;
  const values = decodeTensor(raw, { dtype: 'BF16', shape: [3], bytes: 6 });
  assert.equal(values[0], 1); assert.equal(values[1], -2); assert.equal(values[2], 2 ** -126);
  assert.throws(() => decodeTensor(raw.slice(0, 4), { dtype: 'BF16', shape: [3], bytes: 6 }), /partial/);
});
test('tensor acquisition rejects ignored ranges, truncated and changed bytes', async () => {
  const raw = new Uint8Array([1, 0, 0, 0]), row = { file: 'model.safetensors', offset: 16, bytes: 4, shape: [1], dtype: 'U32', sha256: createHash('sha256').update(raw).digest('hex') };
  const fake = (status, bytes = raw, range = 'bytes 16-19/20') => async (url, options) => {
    assert.equal(options.headers.Range, 'bytes=16-19');
    return new Response(bytes, { status, headers: { 'content-range': range } });
  };
  assert.equal((await fetchTensor('http://localhost/model/', row, { fetchImpl: fake(206) }))[0], 1);
  for (const source of [fake(200), fake(206, raw.slice(1)), fake(206, new Uint8Array(4)), fake(206, raw, 'bytes 0-3/20')]) {
    await assert.rejects(fetchTensor('http://localhost/model/', row, { fetchImpl: source }), /range|partial|hash/);
  }
});
