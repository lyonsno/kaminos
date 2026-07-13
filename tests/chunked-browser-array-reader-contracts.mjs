import assert from 'node:assert/strict';

import { readBrowserArrayInChunks } from '../lib/chunked-browser-array-reader.mjs';

const identity = {
  nonce: 'snapshot-a',
  reportPath: '/tmp/run-a/pipeline-witness.json',
  firingId: 'firing-a',
  runId: 'sharp-run-a',
};

function queuedEvaluator(replies) {
  const queue = [...replies];
  return async () => {
    assert.ok(queue.length, 'reader made an unexpected browser evaluation');
    return queue.shift();
  };
}

const rows = Array.from({ length: 5 }, (_, index) => ({ index }));
const exact = await readBrowserArrayInChunks({
  evaluateExpression: queuedEvaluator([
    { identity, arrayPresent: true, totalLength: 5 },
    { identity, arrayPresent: true, totalLength: 5, start: 0, end: 2, rows: rows.slice(0, 2) },
    { identity, arrayPresent: true, totalLength: 5, start: 2, end: 4, rows: rows.slice(2, 4) },
    { identity, arrayPresent: true, totalLength: 5, start: 4, end: 5, rows: rows.slice(4, 5) },
  ]),
  snapshotExpression: 'window.__snapshot',
  arrayKey: 'foregroundSamples',
  expectedCount: 5,
  expectedIdentity: identity,
  timeoutMs: 100,
  label: 'foreground samples',
  chunkSize: 2,
});
assert.deepEqual(exact, rows);

await assert.rejects(
  readBrowserArrayInChunks({
    evaluateExpression: queuedEvaluator([
      { identity, arrayPresent: true, totalLength: 6 },
    ]),
    snapshotExpression: 'window.__snapshot',
    arrayKey: 'foregroundSamples',
    expectedCount: 5,
    expectedIdentity: identity,
    timeoutMs: 100,
    label: 'foreground samples',
  }),
  /browser length mismatch.*expected 5, observed 6/,
);

await assert.rejects(
  readBrowserArrayInChunks({
    evaluateExpression: queuedEvaluator([
      { identity, arrayPresent: false, totalLength: null },
    ]),
    snapshotExpression: 'window.__snapshot',
    arrayKey: 'foregroundSamples',
    expectedCount: 0,
    expectedIdentity: identity,
    timeoutMs: 100,
    label: 'foreground samples',
  }),
  /browser array is missing/,
);

await assert.rejects(
  readBrowserArrayInChunks({
    evaluateExpression: queuedEvaluator([
      { identity, arrayPresent: true, totalLength: 3 },
      { identity, arrayPresent: true, totalLength: 3, start: 0, end: 3, rows: rows.slice(0, 2) },
    ]),
    snapshotExpression: 'window.__snapshot',
    arrayKey: 'foregroundSamples',
    expectedCount: 3,
    expectedIdentity: identity,
    timeoutMs: 100,
    label: 'foreground samples',
  }),
  /partial chunk.*0-3.*received 2/,
);

await assert.rejects(
  readBrowserArrayInChunks({
    evaluateExpression: queuedEvaluator([
      { identity, arrayPresent: true, totalLength: 3 },
      {
        identity: { ...identity, firingId: 'firing-b' },
        arrayPresent: true,
        totalLength: 3,
        start: 0,
        end: 3,
        rows: rows.slice(0, 3),
      },
    ]),
    snapshotExpression: 'window.__snapshot',
    arrayKey: 'foregroundSamples',
    expectedCount: 3,
    expectedIdentity: identity,
    timeoutMs: 100,
    label: 'foreground samples',
  }),
  /snapshot identity changed.*firingId/,
);

console.log('chunked browser array reader contracts passed');
