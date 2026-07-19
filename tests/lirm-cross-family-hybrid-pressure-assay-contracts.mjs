import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES,
  writeCrossFamilyHybridPressureWitness,
} from '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/assay-contract.mjs';

assert.equal(CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES.length, 3);
assert.equal(new Set(CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES.map(item => item.id)).size, 3);
assert.ok(CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES.every(item => (
  item.program.id === 'kaminos.lirm-armature-program.annular-canopy-hybrid.v0'
)));
assert.ok(CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES.every(item => item.loadBearingCommitments.length >= 4));

const outDir = await mkdtemp(join(tmpdir(), 'lirm-cross-family-hybrid-'));
const result = await writeCrossFamilyHybridPressureWitness({
  outDir,
  pixelWidth: 176,
  pixelHeight: 160,
});
assert.equal(result.status, 'complete-uninspected');
assert.equal(result.candidates.length, 3);
assert.ok(result.candidates.every(item => item.receipt.status === 'complete'));
for (const item of result.candidates) {
  const rasterByKind = Object.fromEntries(
    item.receipt.outputInventory.maps.map(map => [map.kind, map.rasterPath]),
  );
  assert.ok(rasterByKind.clay.endsWith('.png'));
  assert.ok(rasterByKind.depth.endsWith('.png'));
  assert.ok(rasterByKind.normal.endsWith('.png'));
}

const receipt = JSON.parse(await readFile(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.status, 'complete-uninspected');
assert.equal(receipt.failurePhase, null);
assert.equal(receipt.visualInspectionClaim, 'not-yet-inspected');
assert.equal(receipt.comparisonContract.parentFamilies.length, 2);
assert.equal(receipt.comparisonContract.minimumCommitmentsPerCandidate, 4);
assert.equal(receipt.falseClosureGuards.parentReversionCountsAsSuccess, false);
assert.equal(receipt.falseClosureGuards.blankOrMissingControlCountsAsSuccess, false);
assert.equal(receipt.falseClosureGuards.generatorFiringClaim, 'forbidden');

await assert.rejects(
  writeCrossFamilyHybridPressureWitness({
    outDir: join(outDir, 'invalid-duplicate'),
    candidates: [
      CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES[0],
      CROSS_FAMILY_HYBRID_PRESSURE_CANDIDATES[0],
    ],
  }),
  /invalid or duplicate candidate id/,
);

console.log('LIRM cross-family hybrid pressure assay contracts passed');
