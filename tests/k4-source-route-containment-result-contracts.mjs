import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RESULT = path.join(
  REPO_ROOT, 'artifacts/k4-source-route-containment-v0/result.json',
);
const REPORT = path.join(
  REPO_ROOT, 'artifacts/k4-source-route-containment-v0/run-report.json',
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('the exact K4 result localizes Packer escapes without source/export conflation', async () => {
  const [resultBytes, reportBytes] = await Promise.all([
    readFile(RESULT), readFile(REPORT),
  ]);
  const result = JSON.parse(resultBytes);
  const report = JSON.parse(reportBytes);
  assert.equal(result.schema, 'kaminos.k4-source-route-containment-assay.v0');
  assert.equal(result.status, 'completed-provisional');
  assert.equal(result.rows.length, 52);
  assert.equal(result.returnedEscapeRows.length, 11);
  assert.equal(result.fixedAttachmentRows.length, 8);
  assert.ok(result.rows.every(row => row.sourceToRestDrift === 0),
    'fixture rest axes drift from source samples');
  const escapeClassifications = result.returnedEscapeRows.reduce(
    (counts, row) => ({
      ...counts,
      [row.classification]: (counts[row.classification] || 0) + 1,
    }),
    {},
  );
  assert.deepEqual(escapeClassifications, {
    'source-route-outside': 10,
    'packing-induced-route-escape': 1,
  });
  assert.equal(
    result.returnedEscapeRows.find(row =>
      row.classification === 'packing-induced-route-escape')?.sectionId,
    'muscle-12:section:0008',
  );
  assert.equal(result.fixedAttachmentRows.filter(row => row.sourceOutside).length, 4);
  assert.equal(report.status, 'completed');
  assert.equal(report.output.fileSha256, sha256(resultBytes));
  assert.deepEqual(report.effectiveConstructionIds,
    ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45']);
});

