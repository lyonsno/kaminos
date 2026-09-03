import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(typeof kit.compareWebGpuParityArrays, 'function');
assert.equal(typeof kit.createWebGpuParityCaptureRegistry, 'function');
assert.equal(typeof kit.encodeWebGpuParityCaptureChunks, 'function');
assert.equal(typeof kit.decodeWebGpuParityCaptureChunks, 'function');

const {
  compareWebGpuParityArrays,
  createWebGpuParityCaptureRegistry,
  decodeWebGpuParityCaptureChunks,
  encodeWebGpuParityCaptureChunks,
} = kit;

assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1, 2]),
    new Float32Array([1]),
  ),
  /same length/,
);

assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1, Number.NaN]),
    new Float32Array([1, 2]),
  ),
  /non-finite/,
);

assert.throws(
  () => compareWebGpuParityArrays(
    new Float32Array([1, 2]),
    new Float32Array([1, Number.POSITIVE_INFINITY]),
  ),
  /non-finite/,
);

const comparison = compareWebGpuParityArrays(
  new Float32Array([1, 2, 4, 8]),
  new Float32Array([1, 3, 4, 10]),
  {
    stageId: 'decoder.fusion',
    sampling: { mode: 'stride', stride: 2, offset: 1 },
  },
);

assert.equal(comparison.schema, 'kaminos.webgpu-parity-comparison.v0');
assert.equal(comparison.stageId, 'decoder.fusion');
assert.equal(comparison.sourceElementCount, 4);
assert.equal(comparison.comparedElementCount, 2);
assert.deepEqual(comparison.sampling, {
  mode: 'stride',
  stride: 2,
  offset: 1,
  firstSourceIndex: 1,
  lastSourceIndex: 3,
});
assert.equal(comparison.metrics.maxAbsoluteError, 2);
assert.equal(comparison.metrics.worstSourceIndex, 3);
assert.equal(comparison.metrics.meanAbsoluteError, 1.5);
assert.equal(comparison.metrics.rootMeanSquareError, Math.sqrt(2.5));
assert.equal(comparison.metrics.relativeL2Error, Math.sqrt(5 / 109));
assert.equal(comparison.nonFinite.actual.count, 0);
assert.equal(comparison.nonFinite.reference.count, 0);

const zeroComparison = compareWebGpuParityArrays(
  new Float32Array([0, 0]),
  new Float32Array([0, 0]),
);
assert.equal(zeroComparison.metrics.relativeL2Error, 0);
assert.equal(zeroComparison.metrics.cosineSimilarity, null);
assert.deepEqual(JSON.parse(JSON.stringify(zeroComparison)).metrics, zeroComparison.metrics);

assert.throws(
  () => compareWebGpuParityArrays(
    new Float64Array([Number.MAX_VALUE]),
    new Float64Array([-Number.MAX_VALUE]),
  ),
  /finite JavaScript number range/,
);

const registry = createWebGpuParityCaptureRegistry({ runId: 'run-a' });
const source = new Float32Array([0.5, -1.25, 3, 9.5, 12]);
const capture = registry.capture('encoder.block-0', source, {
  shape: [1, 5],
  layout: 'NC',
});
source[0] = 99;
assert.equal(capture.runId, 'run-a');
assert.equal(capture.stageId, 'encoder.block-0');
assert.deepEqual(capture.shape, [1, 5]);
assert.equal(registry.get('encoder.block-0').values[0], 0.5);
assert.throws(
  () => registry.capture('encoder.block-0', new Float32Array([4])),
  /already exists/,
);
assert.deepEqual(registry.stageIds(), ['encoder.block-0']);

const chunks = await encodeWebGpuParityCaptureChunks(registry.get('encoder.block-0'), {
  chunkByteLength: 8,
});
assert.equal(chunks.length, 3);
assert.deepEqual(chunks.map(chunk => chunk.chunkIndex), [0, 1, 2]);
assert.deepEqual(chunks.map(chunk => chunk.byteLength), [8, 8, 4]);
assert.ok(chunks.every(chunk => chunk.runId === 'run-a'));
assert.ok(chunks.every(chunk => chunk.stageId === 'encoder.block-0'));
assert.ok(chunks.every(chunk => ['little-endian', 'big-endian'].includes(chunk.byteOrder)));
assert.ok(chunks.every(chunk => typeof chunk.payloadBase64 === 'string'));
assert.ok(chunks.every(chunk => typeof chunk.payloadSha256 === 'string'));
assert.ok(chunks.every(chunk => chunk.tensorSha256 === chunks[0].tensorSha256));

const decoded = await decodeWebGpuParityCaptureChunks(chunks, {
  expectedRunId: 'run-a',
  expectedStageId: 'encoder.block-0',
});
assert.equal(decoded.schema, 'kaminos.webgpu-parity-capture.v0');
assert.deepEqual(decoded.shape, [1, 5]);
assert.equal(decoded.layout, 'NC');
assert.deepEqual(Array.from(decoded.values), [0.5, -1.25, 3, 9.5, 12]);

await assert.rejects(
  decodeWebGpuParityCaptureChunks(chunks, { expectedRunId: 'stale-run' }),
  /runId/,
);
await assert.rejects(
  decodeWebGpuParityCaptureChunks(
    chunks.map(chunk => ({
      ...chunk,
      byteOrder: chunk.byteOrder === 'little-endian' ? 'big-endian' : 'little-endian',
    })),
    { expectedRunId: 'run-a' },
  ),
  /byteOrder/,
);
await assert.rejects(
  decodeWebGpuParityCaptureChunks([chunks[0], chunks[2]], { expectedRunId: 'run-a' }),
  /chunk count|contiguous/,
);
await assert.rejects(
  decodeWebGpuParityCaptureChunks([chunks[0], chunks[0], chunks[2]], { expectedRunId: 'run-a' }),
  /ordered|chunkIndex/,
);
await assert.rejects(
  decodeWebGpuParityCaptureChunks([chunks[1], chunks[0], chunks[2]], { expectedRunId: 'run-a' }),
  /ordered|chunkIndex/,
);

const truncatedChunk = {
  ...chunks[1],
  payloadBase64: chunks[1].payloadBase64.slice(0, -4),
};
await assert.rejects(
  decodeWebGpuParityCaptureChunks([chunks[0], truncatedChunk, chunks[2]], {
    expectedRunId: 'run-a',
  }),
  /byteLength|digest|base64/,
);

const corruptedChunk = {
  ...chunks[1],
  payloadBase64: `${chunks[1].payloadBase64[0] === 'A' ? 'B' : 'A'}${chunks[1].payloadBase64.slice(1)}`,
};
await assert.rejects(
  decodeWebGpuParityCaptureChunks([chunks[0], corruptedChunk, chunks[2]], {
    expectedRunId: 'run-a',
  }),
  /digest/,
);

console.log('parity primitive contracts passed');
