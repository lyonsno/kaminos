import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const moduleUrl = new URL('../src/chunked-json-evidence.js', import.meta.url);
assert.equal(existsSync(moduleUrl), true, 'the uncapped chunked JSON evidence transport module must exist');
const { readCompleteChunkedJsonEvidence } = await import(moduleUrl);

function readerFor(raw, { transportId = 'transport:fixture', totalCharacters = raw.length, mutate = value => value } = {}) {
  return async ({ offset, length }) => mutate({
    transportId,
    offset,
    totalCharacters,
    payload: raw.slice(offset, offset + length),
  });
}

const largeValue = {
  status: 'passed',
  resources: Array.from({ length: 1007 }, (_, index) => ({ index, identity: `sha256:${String(index).padStart(64, '0')}` })),
};
const largeRaw = JSON.stringify(largeValue);
const progress = [];
const complete = await readCompleteChunkedJsonEvidence({
  metadata: { transportId: 'transport:fixture', totalCharacters: largeRaw.length },
  chunkCharacters: 32,
  readChunk: readerFor(largeRaw),
  onProgress: evidence => progress.push(evidence),
});
assert.deepEqual(complete.value, largeValue);
assert.equal(complete.transport.passed, true);
assert.equal(complete.transport.completedCharacters, largeRaw.length);
assert.ok(complete.transport.chunkCount > 300, 'transport must continue through the declared total without a hidden chunk-count cap');
assert.equal(progress.at(-1).completedCharacters, largeRaw.length);

await assert.rejects(
  readCompleteChunkedJsonEvidence({
    metadata: { transportId: 'transport:fixture', totalCharacters: largeRaw.length },
    chunkCharacters: 64,
    readChunk: readerFor(largeRaw, { transportId: 'transport:stale' }),
  }),
  /transport identity/i,
);
await assert.rejects(
  readCompleteChunkedJsonEvidence({
    metadata: { transportId: 'transport:fixture', totalCharacters: largeRaw.length },
    chunkCharacters: 64,
    readChunk: readerFor(largeRaw, { mutate: fragment => ({ ...fragment, offset: fragment.offset + 1 }) }),
  }),
  /offset/i,
);
await assert.rejects(
  readCompleteChunkedJsonEvidence({
    metadata: { transportId: 'transport:fixture', totalCharacters: largeRaw.length },
    chunkCharacters: 64,
    readChunk: readerFor(largeRaw, { totalCharacters: largeRaw.length + 1 }),
  }),
  /total/i,
);
await assert.rejects(
  readCompleteChunkedJsonEvidence({
    metadata: { transportId: 'transport:fixture', totalCharacters: largeRaw.length },
    chunkCharacters: 64,
    readChunk: readerFor(largeRaw, { mutate: fragment => ({ ...fragment, payload: '' }) }),
  }),
  /blank|payload/i,
);
await assert.rejects(
  readCompleteChunkedJsonEvidence({
    metadata: { transportId: 'transport:fixture', totalCharacters: 5 },
    chunkCharacters: 2,
    readChunk: readerFor('{bad}', { totalCharacters: 5 }),
  }),
  /parse|JSON/i,
);

console.log('chunked JSON evidence contracts passed');
