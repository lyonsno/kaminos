import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createM31GeneratedRelationTransfer } from '../m31-generated-relation-transfer-core.mjs';

const sourceFixture = JSON.parse(await readFile(new URL(
  '../artifacts/m31-generated-relation-positive-volume-transfer-v0/source-fixture.json',
  import.meta.url,
), 'utf8'));

const bundle = createM31GeneratedRelationTransfer(sourceFixture);
assert.notEqual(bundle.failurePhase, 'generated-fixture-construction',
  bundle.lastTrustworthyEvidence);
assert.equal(bundle.status, 'M31_TRANSFER_COMPLETE', JSON.stringify(
  bundle.poses?.map(pose => ({ angleDegrees: pose.angleDegrees, hardVetoes: pose.hardVetoes })),
));
assert.ok(bundle.poses.every(pose => pose.hardVetoes.rigidLeakage.pass),
  'manifest-declared attachment caps must obey their rigid support transforms');
assert.equal(bundle.identityMap?.sourceVertexIds.length, 300);
assert.equal(bundle.identityMap?.sourceTriangleIds.length, 596);
assert.deepEqual(bundle.poses?.map(pose => pose.angleDegrees), [0, 24]);

console.log('m31 generated-relation real fixture contracts passed');
