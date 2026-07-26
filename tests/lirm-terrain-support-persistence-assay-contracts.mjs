import assert from 'node:assert/strict';
import {
  applyRootCorrection,
  contactStateAtUnitPhase,
  enumerateSupportPermutations,
  interpolatePeriodicRootState,
  runTerrainSupportPersistenceAssay,
  solveRootCorrection,
  SUPPORT_IDS,
  TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE,
} from '../lirm-terrain-support-persistence-assay-core.mjs';

const closeTo = (actual, expected, tolerance = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} must be within ${tolerance} of ${expected}`,
  );
};

const closeVector = (actual, expected, tolerance = 1e-10) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => closeTo(value, expected[index], tolerance));
};

assert.equal(
  TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE,
  'kaminos/lirm-719024/terrain-support-persistence-assay-v0',
);
assert.equal(contactStateAtUnitPhase(0.49, 0).state, 'stance');
assert.equal(contactStateAtUnitPhase(0.5, 0).state, 'release');
assert.equal(contactStateAtUnitPhase(0.58, 0).state, 'swing');
assert.equal(contactStateAtUnitPhase(0.75, 0.5).state, 'stance');

const permutations = enumerateSupportPermutations(SUPPORT_IDS);
assert.equal(permutations.length, 24);
assert.equal(new Set(permutations.map(item => item.mappingKey)).size, 24);
assert.ok(permutations.some(item => (
  SUPPORT_IDS.every(id => item.mapping[id] === id)
)));

const oneSupport = solveRootCorrection({
  correspondences: [{
    supportId: 'front-left',
    current: [1, 2, 3],
    target: [2, 4, 6],
  }],
  translationBudget: 10,
  rotationBudget: 10,
});
closeVector(oneSupport.translation, [1, 2, 3]);
closeVector(oneSupport.rotationVector, [0, 0, 0]);
assert.equal(oneSupport.capHit, false);

const quarterTurn = solveRootCorrection({
  correspondences: [
    { supportId: 'front-left', current: [-1, 0, 0], target: [0, 0, -1] },
    { supportId: 'rear-right', current: [1, 0, 0], target: [0, 0, 1] },
  ],
  translationBudget: 10,
  rotationBudget: 10,
});
closeVector(quarterTurn.translation, [0, 0, 0]);
closeVector(quarterTurn.pivot, [0, 0, 0]);
closeVector(quarterTurn.rotationVector, [0, -Math.PI / 2, 0]);

const uncapped = solveRootCorrection({
  correspondences: [{
    supportId: 'front-left',
    current: [0, 0, 0],
    target: [2, 0, 0],
  }],
  translationBudget: 0.25,
  rotationBudget: 0.5,
});
closeVector(uncapped.rawTranslation, [2, 0, 0]);
closeVector(uncapped.translation, [0.25, 0, 0]);
assert.equal(uncapped.capHit, true);
closeTo(uncapped.translationBudgetUtilization, 8);

const corrected = applyRootCorrection([2, 0, 0], quarterTurn);
closeVector(corrected, [2, 0, Math.PI]);

const fitStates = [
  {
    sampleId: 'sample-46',
    phase: 46 / 48,
    translation: [46, 0, 0],
    rotationVector: [0, 46, 0],
  },
  {
    sampleId: 'sample-00',
    phase: 0,
    translation: [48, 0, 0],
    rotationVector: [0, 48, 0],
  },
  {
    sampleId: 'sample-02',
    phase: 2 / 48,
    translation: [50, 0, 0],
    rotationVector: [0, 50, 0],
  },
];
const wrapped = interpolatePeriodicRootState({
  heldoutSampleId: 'sample-47',
  heldoutPhase: 47 / 48,
  fitStates,
});
closeVector(wrapped.translation, [47, 0, 0]);
closeVector(wrapped.rotationVector, [0, 47, 0]);
assert.equal(wrapped.reconstruction.previousFitSampleId, 'sample-46');
assert.equal(wrapped.reconstruction.nextFitSampleId, 'sample-00');
closeTo(wrapped.reconstruction.weight, 0.5);
assert.equal(wrapped.reconstruction.periodicWrap, true);

const sameRuleDifferentFamily = interpolatePeriodicRootState({
  heldoutSampleId: 'sample-01',
  heldoutPhase: 1 / 48,
  fitStates,
  realizationId: 'permuted:rear-left>front-right',
});
closeVector(sameRuleDifferentFamily.translation, [49, 0, 0]);
assert.equal(sameRuleDifferentFamily.reconstruction.previousFitSampleId, 'sample-00');
assert.equal(sameRuleDifferentFamily.reconstruction.nextFitSampleId, 'sample-02');
closeTo(sameRuleDifferentFamily.reconstruction.weight, 0.5);
assert.equal(sameRuleDifferentFamily.reconstruction.periodicWrap, false);

const sampleCount = 8;
const samples = Array.from({ length: sampleCount }, (_, index) => ({
  sampleId: `sample-${String(index).padStart(2, '0')}`,
  phase: index / sampleCount,
  probes: SUPPORT_IDS.map((id, supportIndex) => ({
    id,
    phaseOffset: supportIndex % 2 === 0 ? 0 : 0.5,
    worldPosition: [
      supportIndex < 2 ? -1 : 1,
      1 + Math.sin(index / sampleCount * Math.PI * 2) * 0.1,
      supportIndex % 2 === 0 ? -1 : 1,
    ],
  })),
}));
const plantTargets = Object.fromEntries(SUPPORT_IDS.map((id, index) => [
  id,
  {
    supportId: id,
    plantSampleId: index % 2 === 0 ? 'sample-00' : 'sample-04',
    releaseSampleId: index % 2 === 0 ? 'sample-04' : 'sample-08',
    worldPoint: [index < 2 ? -1 : 1, 0, index % 2 === 0 ? -1 : 1],
    normal: [0, 1, 0],
    tangent: [1, 0, 0],
    bitangent: [0, 0, 1],
  },
]));
const terrainSampler = (x, z) => ({
  world: [x, 0, z],
  normal: [0, 1, 0],
  inBounds: true,
});
const synthetic = runTerrainSupportPersistenceAssay({
  samples,
  plantTargets,
  terrainSampler,
  supportRadius: 0.1,
  translationBudget: 2,
  rotationBudget: 1,
});
assert.equal(synthetic.supportHoldouts.persistent.length, 4);
assert.equal(synthetic.timeHoldouts.persistent.length, 2);
assert.equal(synthetic.permutations.length, 24);
for (const family of ['persistent', 'transient', 'absent']) {
  for (const fold of synthetic.supportHoldouts[family]) {
    assert.ok(fold.fit.sampleMetrics.length > 0);
    assert.ok(fold.fit.sampleMetrics.every(metric => (
      !metric.includedSupportIds.includes(fold.heldoutSupportId)
    )));
  }
}
for (const family of ['persistent', 'transient', 'absent']) {
  for (const fold of synthetic.timeHoldouts[family]) {
    assert.equal(fold.reconstructions.length, sampleCount / 2);
    assert.ok(fold.reconstructions.every(item => (
      item.previousFitSampleId && item.nextFitSampleId
      && Number.isFinite(item.weight)
    )));
  }
}
assert.equal(synthetic.routeProgressDeviation, 0);
assert.equal(synthetic.sourcePhaseDeviation, 0);

console.log('lirm terrain support persistence assay contracts passed');
