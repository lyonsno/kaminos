#!/usr/bin/env node

import assert from 'node:assert/strict';

const multiview = await import('../lirm-metaball-silhouette-authority-core.mjs');

assert.equal(
  typeof multiview.createMetaballTargetFirstMultiviewTranche,
  'function',
  'metaball core must expose the target-first multiview assay contract',
);

const tranche = multiview.createMetaballTargetFirstMultiviewTranche();

assert.equal(tranche.schema, 'kaminos.lirm-metaball-target-first-multiview.v0');
assert.equal(tranche.status, 'source-contract-frozen');
assert.deepEqual(
  tranche.views.map(view => [view.id, view.cameraYawRadians]),
  [
    ['target-three-quarter', 0.42],
    ['front', 0],
    ['side', 1.3],
    ['rear-three-quarter', 2.2],
  ],
);
assert.deepEqual(
  tranche.conditions.map(condition => [condition.id, condition.referenceViewIds]),
  [
    ['target-only', ['target-three-quarter', 'target-three-quarter', 'target-three-quarter']],
    ['target-plus-front', ['target-three-quarter', 'target-three-quarter', 'front']],
    ['target-plus-side', ['target-three-quarter', 'target-three-quarter', 'side']],
    ['target-plus-side-plus-rear', ['target-three-quarter', 'side', 'rear-three-quarter']],
  ],
);

for (const condition of tranche.conditions) {
  assert.equal(condition.referenceViewIds.length, 3);
  assert.equal(condition.referenceViewIds[0], 'target-three-quarter');
}

assert.equal(tranche.fixedGenerator.guidance, 1);
assert.deepEqual(tranche.fixedGenerator.seeds, [80401]);
assert.equal(tranche.fixedGenerator.provisionalCarrierKind, 'clay');
assert.equal(tranche.fixedGenerator.carrierDisposition, 'pending-projection-sentinel');
assert.match(tranche.fixedGenerator.prompt, /first reference image is the authoritative target view/i);
assert.match(tranche.claimCeiling, /experimental/i);

process.stdout.write('LIRM target-first multiview contracts passed\n');
