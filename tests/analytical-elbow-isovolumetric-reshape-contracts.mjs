import assert from 'node:assert/strict';

import * as packingCore from '../constructional-packing-core.mjs';

const requiredApi = [
  'applyExactElbowMuscleReshape',
  'coupleExactElbowIsovolumetricEnvelope',
  'compareExactElbowIsovolumetricReshape',
];

for (const name of requiredApi) {
  assert.equal(
    typeof packingCore[name],
    'function',
    `exact-elbow isovolumetric reshape contract requires ${name}`,
  );
}

const {
  applyExactElbowMuscleReshape,
  compareExactElbowIsovolumetricReshape,
  compareExactElbowPackings,
  coupleExactElbowIsovolumetricEnvelope,
  createExactElbowPackingSource,
  prepareExactElbowEnvelopeCouplingSource,
  sampleExactElbowEnvelopeSurface,
  solveExactElbowPacking,
} = packingCore;

const rawSource = createExactElbowPackingSource();
const source = prepareExactElbowEnvelopeCouplingSource({ source: rawSource });
const baseline = solveExactElbowPacking(source);
const muscleId = 'brachialis-like-flexor';

const reshapedSource = applyExactElbowMuscleReshape({
  source,
  reshape: {
    id: 'contract-brachialis-isovolumetrically',
    muscleId,
    centerPathT: 0.55,
    width: 0.2,
    amplitude: 0.42,
  },
});
const fixedEnvelopeReshaped = solveExactElbowPacking(reshapedSource);
const fixedComparison = compareExactElbowPackings({
  baseline,
  edited: fixedEnvelopeReshaped,
});

assert.equal(
  reshapedSource.elbowDescriptor.muscles.find(muscle => muscle.id === muscleId).targetVolume,
  source.elbowDescriptor.muscles.find(muscle => muscle.id === muscleId).targetVolume,
  'reshape preserves analytical muscle target volume',
);
assert.equal(fixedEnvelopeReshaped.metrics.activeCellCount, baseline.metrics.activeCellCount);
assert.equal(fixedComparison.brachialisCellDelta, 0);
assert.equal(fixedComparison.tricepsCellDelta, 0);
assert.equal(fixedComparison.residualCellDelta, 0);
assert.equal(fixedComparison.addedSourceCellCount, 0);
assert.equal(fixedComparison.lostSourceCellCount, 0);
assert.ok(fixedComparison.changedOwnerCellCount >= 80);
assert.equal(
  fixedComparison.ownerTransitionCounts[`residual-tissue->${muscleId}`],
  fixedComparison.ownerTransitionCounts[`${muscleId}->residual-tissue`],
  'fixed-envelope reshape exchanges equal muscle and residual cell counts',
);
assert.equal(fixedComparison.unexpectedOwnerTransitionCount, 0);

const response = coupleExactElbowIsovolumetricEnvelope({
  source,
  baseline,
  reshapedSource,
  fixedEnvelopeReshaped,
  muscleId,
});
assert.equal(
  response.ledger.schema,
  'kaminos.exact-elbow-isovolumetric-reshape-ledger.v0',
);
assert.equal(response.ledger.muscleCellDelta, 0);
assert.equal(response.ledger.targetActiveCellCount, baseline.metrics.activeCellCount);
assert.ok(response.ledger.gainedMuscleCellCount >= 40);
assert.equal(
  response.ledger.gainedMuscleCellCount,
  response.ledger.releasedMuscleCellCount,
);
assert.equal(response.source.domain.surfaceLobes.length, 2);
assert.ok(response.source.domain.surfaceLobes.some(lobe => lobe.amplitude > 0));
assert.ok(response.source.domain.surfaceLobes.some(lobe => lobe.amplitude < 0));

const coupled = solveExactElbowPacking(response.source);
const comparison = compareExactElbowIsovolumetricReshape({
  baseline,
  fixedEnvelopeReshaped,
  coupled,
  ledger: response.ledger,
});

for (const result of [fixedEnvelopeReshaped, coupled]) {
  assert.equal(result.metrics.unownedCellCount, 0);
  assert.equal(result.metrics.multiOwnedCellCount, 0);
  assert.equal(result.metrics.rigidOwnedCellCount, 0);
  assert.equal(result.metrics.finiteRigidOverlapCellCount, 0);
  assert.equal(result.metrics.anchorViolationCount, 0);
  assert.equal(result.metrics.duplicateSourceCellCount, 0);
}
assert.equal(comparison.activeCellDelta, 0);
assert.equal(comparison.addedSourceCellCount, comparison.lostSourceCellCount);
assert.ok(comparison.addedSourceCellCount > 0);
assert.equal(comparison.brachialisCellDelta, 0);
assert.equal(comparison.tricepsCellDelta, 0);
assert.equal(comparison.residualCellDelta, 0);
assert.equal(comparison.rigidIdentityViolationCount, 0);
assert.equal(comparison.attachmentIdentityViolationCount, 0);
assert.equal(comparison.gridIdentityViolationCount, 0);
assert.equal(comparison.sharedUnchangedMaterialIdentityViolationCount, 0);
assert.equal(comparison.unexpectedSharedOwnerTransitionCount, 0);
assert.ok(comparison.outwardSurfaceDisplacement > 0.025);
assert.ok(comparison.compensatingSurfaceDisplacement < -0.01);
assert.ok(Math.abs(comparison.remoteSurfaceDisplacement) < 0.004);
assert.equal(comparison.exteriorVolumeDelta, 0);
assert.equal(comparison.muscleVolumeDelta, 0);

const outwardSurface = sampleExactElbowEnvelopeSurface(
  response.source.domain,
  response.ledger.outwardDirection,
);
const baselineOutwardSurface = sampleExactElbowEnvelopeSurface(
  source.domain,
  response.ledger.outwardDirection,
);
const compensationSurface = sampleExactElbowEnvelopeSurface(
  response.source.domain,
  response.ledger.compensationDirection,
);
const baselineCompensationSurface = sampleExactElbowEnvelopeSurface(
  source.domain,
  response.ledger.compensationDirection,
);
assert.ok(outwardSurface.distance > baselineOutwardSurface.distance);
assert.ok(compensationSurface.distance < baselineCompensationSurface.distance);

assert.deepEqual(
  coupleExactElbowIsovolumetricEnvelope({
    source,
    baseline,
    reshapedSource,
    fixedEnvelopeReshaped,
    muscleId,
  }),
  response,
  'isovolumetric envelope response must be deterministic',
);

console.log('analytical elbow isovolumetric reshape contracts passed');
