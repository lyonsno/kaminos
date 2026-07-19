import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_LIRM_ARMATURE_GESTALT_FAMILY_SOURCES,
  loadLirmArmatureGestaltFamily,
  writeLirmArmatureGestaltFamilyWitness,
} from '../lirm-armature-gestalt-family-core.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const family = await loadLirmArmatureGestaltFamily({ repoRoot });
assert.equal(family.schema, 'kaminos.lirm-armature-gestalt-family.v0');
assert.equal(family.requestedRoute, 'kaminos/lirm-armature-gestalt-family/source-anchored-conditioning-v0');
assert.equal(family.requestedRoute, family.effectiveRoute);
assert.equal(family.candidates.length, 7);
assert.equal(new Set(family.candidates.map(candidate => candidate.id)).size, 7);
assert.equal(new Set(family.candidates.map(candidate => candidate.armatureProgram.id)).size, 5);
assert.deepEqual(
  family.candidates.slice(-2).map(candidate => candidate.id),
  ['forked-saddle-lirm02', 'asymmetric-bead-chain-lirm07'],
);
assert.deepEqual(
  family.candidates.map(candidate => candidate.acceptance.outcome),
  [
    'assay-passed-inspected',
    'recovered',
    'recovered',
    'recovered',
    'assay-passed-inspected',
    'assay-passed-inspected',
    'assay-passed-inspected',
  ],
);

for (const candidate of family.candidates) {
  assert.match(candidate.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(candidate.sourceEvidence.fitReport.path.startsWith('artifacts/'));
  assert.match(candidate.sourceEvidence.fitReport.sha256, /^sha256:[0-9a-f]{64}$/);
  const fitPath = join(repoRoot, candidate.sourceEvidence.fitReport.path);
  assert.equal(statSync(fitPath).size, candidate.sourceEvidence.fitReport.byteSize);
  assert.equal(
    `sha256:${createHash('sha256').update(readFileSync(fitPath)).digest('hex')}`,
    candidate.sourceEvidence.fitReport.sha256,
  );
  const specIds = candidate.armatureProgram.parameterSpecs.map(spec => spec.id);
  assert.deepEqual(Object.keys(candidate.parameters), specIds);
  for (const spec of candidate.armatureProgram.parameterSpecs) {
    assert.ok(candidate.parameters[spec.id] >= spec.min && candidate.parameters[spec.id] <= spec.max);
  }
  if (candidate.acceptance.outcome === 'recovered') {
    assert.equal(candidate.acceptance.status, 'basin-passed-inspected');
    assert.equal(candidate.acceptance.visualDisposition, 'accepted');
    assert.match(candidate.sourceEvidence.acceptanceReport.sha256, /^sha256:[0-9a-f]{64}$/);
  }
}

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-armature-gestalt-family-'));
const result = await writeLirmArmatureGestaltFamilyWitness({
  repoRoot,
  outDir,
  pixelWidth: 48,
  pixelHeight: 36,
});
assert.equal(result.schema, 'kaminos.lirm-armature-gestalt-family-write-result.v0');
assert.equal(result.status, 'complete');
assert.ok(existsSync(result.receiptPath));
const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
assert.equal(receipt.status, 'complete');
assert.equal(receipt.phase, 'family_witness_written');
assert.equal(receipt.requestedRoute, receipt.effectiveRoute);
assert.deepEqual(receipt.effectiveConfig, { pixelWidth: 48, pixelHeight: 36 });
assert.equal(receipt.candidates.length, 7);
assert.equal(receipt.sourceEvidence.length, 8);
for (const candidate of receipt.candidates) {
  const candidateReceiptPath = join(outDir, candidate.receiptPath);
  assert.ok(existsSync(candidateReceiptPath));
  assert.equal(statSync(candidateReceiptPath).size, candidate.receiptEvidence.byteSize);
  assert.equal(
    `sha256:${createHash('sha256').update(readFileSync(candidateReceiptPath)).digest('hex')}`,
    candidate.receiptEvidence.sha256,
  );
  const candidateReceipt = JSON.parse(readFileSync(candidateReceiptPath, 'utf8'));
  assert.equal(candidateReceipt.status, 'complete');
  assert.equal(candidateReceipt.outputInventory.maps.length, 5);
  assert.equal(candidateReceipt.outputInventory.trellisSource.kind, 'trellis-clay');
}

const failedOutDir = await mkdtemp(join(tmpdir(), 'kaminos-armature-gestalt-family-failure-'));
const lyingSources = DEFAULT_LIRM_ARMATURE_GESTALT_FAMILY_SOURCES.map((source, index) => (
  index === 0 ? { ...source, fitReportSha256: `sha256:${'0'.repeat(64)}` } : source
));
await assert.rejects(
  writeLirmArmatureGestaltFamilyWitness({
    repoRoot,
    outDir: failedOutDir,
    sourceDefinitions: lyingSources,
    pixelWidth: 48,
    pixelHeight: 36,
  }),
  /fit report hash mismatch/,
);
const failureReceipt = JSON.parse(await readFile(join(failedOutDir, 'receipt.json'), 'utf8'));
assert.equal(failureReceipt.status, 'failed');
assert.equal(failureReceipt.failurePhase, 'source-validation');
assert.equal(failureReceipt.effectiveRoute, null);
assert.match(failureReceipt.errorMessage, /fit report hash mismatch/);

console.log('LIRM armature gestalt family contracts passed');
