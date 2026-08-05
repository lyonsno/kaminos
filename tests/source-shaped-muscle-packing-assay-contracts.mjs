import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as packing from '../muscle-compartment-packing-core.mjs';

const ATLAS_PATH = new URL(
  '../artifacts/authored-muscle-coordinate-export-v0/dense-selectors/k4-current-graph/parent-atlas.json',
  import.meta.url,
);
const K4_IDS = ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'];
const LEVELS = [
  { id: 'baseline', crowdingFraction: 0 },
  { id: 'mild', crowdingFraction: 0.12 },
  { id: 'moderate', crowdingFraction: 0.24 },
];

async function atlasFixture() {
  const bytes = await readFile(ATLAS_PATH);
  return {
    parentAtlas: JSON.parse(bytes),
    parentAtlasFileSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function assayApi() {
  assert.equal(
    typeof packing.createSourceShapedPackingPerturbationSeries,
    'function',
    'packing core must expose the route-addressed provisional-fixture builder',
  );
  assert.equal(
    typeof packing.runSourceShapedPackingPerturbationSeries,
    'function',
    'packing core must expose the deterministic perturbation-series runner',
  );
  return packing;
}

test('source-shaped K4 ladder preserves measured identity while declaring every added fact provisional', async () => {
  const api = assayApi();
  const fixture = await atlasFixture();
  const series = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });

  assert.equal(series.schema, 'kaminos.source-shaped-muscle-packing-perturbation-series.v0');
  assert.equal(series.claimCeiling, 'qualitative-route-local-mechanical-response');
  assert.deepEqual(series.requestedConstructionIds, K4_IDS);
  assert.deepEqual(series.effectiveConstructionIds, K4_IDS);
  assert.equal(series.parentAtlas.fileSha256, fixture.parentAtlasFileSha256);
  assert.equal(series.parentAtlas.atlasSha256, fixture.parentAtlas.atlasSha256);
  assert.deepEqual(series.conditions.map(condition => condition.id), ['baseline', 'mild', 'moderate']);

  for (const [conditionIndex, condition] of series.conditions.entries()) {
    assert.equal(condition.crowdingFraction, LEVELS[conditionIndex].crowdingFraction);
    assert.equal(condition.source.authority.kind, 'synthetic-proxy');
    assert.equal(condition.source.authority.anatomicalAdmission, 'none');
    assert.equal(condition.source.assayProvenance.compartment.authority, 'agent-authored-provisional');
    assert.equal(condition.source.assayProvenance.obstacle.authority, 'agent-authored-provisional');
    assert.deepEqual(
      condition.source.assayProvenance.perturbation.requested,
      {
        kind: 'interior-samples-toward-cohort-centroid',
        crowdingFraction: LEVELS[conditionIndex].crowdingFraction,
        endpointPolicy: 'fixed-measured-candidates',
      },
    );
    assert.deepEqual(
      condition.source.assayProvenance.perturbation.effective,
      condition.source.assayProvenance.perturbation.requested,
    );
    assert.equal(
      condition.source.assayProvenance.assumptions.requested.id,
      'source-shaped-k4-provisional-environment.v0',
    );
    assert.equal(
      condition.source.assayProvenance.assumptions.effective.id,
      'source-shaped-k4-provisional-environment.v0',
    );
    assert.match(
      condition.source.assayProvenance.assumptions.effective.sha256,
      /^[0-9a-f]{64}$/,
    );
    assert.deepEqual(
      condition.source.muscles.map(muscle => muscle.identity.constructionId),
      K4_IDS,
    );
    assert.ok(condition.source.muscles.every(
      muscle => muscle.authority.kind === 'synthetic-proxy'
        && muscle.authority.anatomicalAdmission === 'none'
        && muscle.candidateEvidence.centerlineState === 'candidate'
        && muscle.candidateEvidence.targetVolumeState === 'candidate',
    ));
    assert.doesNotThrow(() => packing.measureMuscleCompartmentPacking(condition.source));
  }
});

test('ordered route selection is caller-addressed and current Packer refuses exact fixed-attachment conflicts', async () => {
  const api = assayApi();
  const fixture = await atlasFixture();
  const alternateIds = ['muscle-13', 'muscle-12', 'muscle-45', 'muscle-18'];
  const alternate = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: alternateIds,
    levels: LEVELS,
  });
  assert.deepEqual(alternate.effectiveConstructionIds, alternateIds);
  assert.deepEqual(
    alternate.conditions[0].source.muscles.map(muscle => muscle.identity.constructionId),
    alternateIds,
    'the builder must neither fall back to K4 defaults nor reorder the caller selection',
  );

  const first = api.runSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });
  const replay = api.runSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });
  assert.deepEqual(replay, first, 'identical atlas, routes, levels, and config must replay byte-identically');
  assert.equal(first.mechanism.requested.id, 'muscle-compartment-packing-projection.v0');
  assert.equal(first.mechanism.effective.id, 'muscle-compartment-packing-projection.v0');
  assert.deepEqual(first.mechanism.effective.config, first.mechanism.requested.config);
  const initialPenetrations = first.conditions.map(
    condition => condition.result.metrics.initial.pairwisePenetration,
  );
  assert.ok(initialPenetrations[0] < initialPenetrations[1]);
  assert.ok(initialPenetrations[1] < initialPenetrations[2]);
  assert.ok(first.conditions.every(condition => condition.result.metrics.packed.endpointDrift === 0));
  assert.ok(first.conditions.every(condition => (
    condition.result.status === 'immutable-constraint-conflict'
      && condition.result.failure?.phase === 'preflight'
      && condition.result.failure?.blockingMechanisms.length === 4
      && condition.result.failure.blockingMechanisms.every(
        mechanism => mechanism.kind === 'pairwise-fixed-attachment-penetration',
      )
  )));
  assert.deepEqual(
    first.conditions.map(condition => Math.max(
      ...condition.result.failure.blockingMechanisms.map(mechanism => mechanism.penetration),
    )),
    [1.555076559298, 1.555076559298, 1.555076559298],
    'interior crowding must not change the exact fixed-attachment blocker',
  );
  assert.ok(first.conditions.every(condition => (
    condition.result.metrics.packed.pairwisePenetration
      === condition.result.metrics.initial.pairwisePenetration
      && condition.result.metrics.packed.maximumRelativeVolumeError
        === condition.result.metrics.initial.maximumRelativeVolumeError
  )), 'preflight refusal must return the unmutated source instead of a partial packing result');
  assert.equal(first.interpretationChecks.fixedEndpointsPreserved, true);
  assert.equal(first.interpretationChecks.targetVolumesPreserved, false);
});

test('parent-atlas and candidate disagreements fail before a provisional fixture can launder them', async () => {
  const api = assayApi();
  const fixture = await atlasFixture();
  const stale = structuredClone(fixture.parentAtlas);
  const unselected = stale.routeInventory.find(route => !K4_IDS.includes(route.constructionId));
  unselected.name = `${unselected.name} edited-after-hash`;
  assert.throws(
    () => api.createSourceShapedPackingPerturbationSeries({
      ...fixture,
      parentAtlas: stale,
      requestedConstructionIds: K4_IDS,
      levels: LEVELS,
    }),
    /parent atlas SHA-256 does not match/i,
  );

  const conflicting = structuredClone(fixture.parentAtlas);
  const selected = conflicting.routeInventory.find(route => route.constructionId === K4_IDS[0]);
  selected.fields['attachments.origin.position'].candidates[0].value[0] += 1;
  const { atlasSha256: ignored, ...core } = conflicting;
  conflicting.atlasSha256 = packing.hashMusclePackingCanonicalJson(core);
  assert.throws(
    () => api.createSourceShapedPackingPerturbationSeries({
      ...fixture,
      parentAtlas: conflicting,
      requestedConstructionIds: K4_IDS,
      levels: LEVELS,
    }),
    /candidate.*disagree|disagree.*candidate/i,
  );

  const centerlineConflict = structuredClone(fixture.parentAtlas);
  const centerlineRoute = centerlineConflict.routeInventory.find(
    route => route.constructionId === K4_IDS[0],
  );
  const disagreeingCenterline = structuredClone(centerlineRoute.fields.centerline.candidates[0]);
  disagreeingCenterline.value.resampledSamples[1].position[0] += 0.25;
  centerlineRoute.fields.centerline.candidates.push(disagreeingCenterline);
  const { atlasSha256: staleSha256, ...centerlineCore } = centerlineConflict;
  centerlineConflict.atlasSha256 = packing.hashMusclePackingCanonicalJson(centerlineCore);
  assert.throws(
    () => api.createSourceShapedPackingPerturbationSeries({
      ...fixture,
      parentAtlas: centerlineConflict,
      requestedConstructionIds: K4_IDS,
      levels: LEVELS,
    }),
    /centerline.*candidate.*disagree/i,
  );
});

test('endpoint taper is an identity-bound source derivation that preserves attachments and target volume', async () => {
  assert.equal(
    typeof packing.deriveEndpointTaperedPackingSource,
    'function',
    'current K4 needs an explicit cross-section derivation before belly allocation can be assayed',
  );
  const fixture = await atlasFixture();
  const series = packing.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });
  const parent = series.conditions[0].source;
  const parentSnapshot = structuredClone(parent);
  const derived = packing.deriveEndpointTaperedPackingSource(parent, {
    endpointRadiusMultiplier: 0.26,
    transitionFraction: 0.2,
    profile: 'smoothstep-arc-length',
    volumeCompensation: 'global-radius',
  });

  assert.deepEqual(parent, parentSnapshot, 'endpoint taper must not mutate its source condition');
  assert.deepEqual(
    derived.source.muscles.map(muscle => muscle.identity),
    parent.muscles.map(muscle => muscle.identity),
  );
  assert.deepEqual(
    derived.source.muscles.map(muscle => muscle.attachments),
    parent.muscles.map(muscle => muscle.attachments),
  );
  assert.deepEqual(derived.receipt.requested, {
    endpointRadiusMultiplier: 0.26,
    transitionFraction: 0.2,
    profile: 'smoothstep-arc-length',
    volumeCompensation: 'global-radius',
  });
  assert.equal(derived.receipt.fallbackUsed, false);
  assert.deepEqual(derived.source.input.requested, derived.source.input.effective);
  assert.match(derived.source.input.effective.sha256, /^[0-9a-f]{64}$/);
  for (const [index, muscle] of derived.source.muscles.entries()) {
    const parentMuscle = parent.muscles[index];
    assert.deepEqual(muscle.centerline[0].position, parentMuscle.centerline[0].position);
    assert.deepEqual(muscle.centerline.at(-1).position, parentMuscle.centerline.at(-1).position);
    assert.equal(muscle.targetVolume, parentMuscle.targetVolume);
    assert.ok(muscle.centerline[0].radius < parentMuscle.centerline[0].radius * 0.4);
    assert.ok(muscle.centerline.at(-1).radius < parentMuscle.centerline.at(-1).radius * 0.4);
  }
  const measured = packing.measureMuscleCompartmentPacking(derived.source);
  assert.ok(measured.maximumRelativeVolumeError <= 1e-12);
  const result = packing.solveMuscleCompartmentPacking(derived.source, { maxIterations: 1 });
  assert.notEqual(
    result.status,
    'immutable-constraint-conflict',
    'a strong diagnostic taper must open preflight before allocation is compared',
  );
});

test('endpoint taper rejects implicit defaults and unknown mechanism fields', async () => {
  const fixture = await atlasFixture();
  const series = packing.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });
  const parent = series.conditions[0].source;
  assert.throws(
    () => packing.deriveEndpointTaperedPackingSource(parent, {
      endpointRadiusMultiplier: 0.26,
      transitionFraction: 0.2,
      profile: 'smoothstep-arc-length',
      volumeCompensation: 'global-radius',
      silentFallback: true,
    }),
    /unknown fields: silentFallback/,
  );
  assert.throws(
    () => packing.deriveEndpointTaperedPackingSource(parent, {
      endpointRadiusMultiplier: 1,
      transitionFraction: 0.2,
      profile: 'smoothstep-arc-length',
      volumeCompensation: 'global-radius',
    }),
    /radius multiplier must be in \(0, 1\)/,
  );
});

test('explicit current-K4 azimuthal and radial roles preserve tube refusal and reach tapered relaxation', async () => {
  const fixture = await atlasFixture();
  const series = packing.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });
  const authenticatedTube = series.conditions[0].source;
  const tapered = packing.deriveEndpointTaperedPackingSource(authenticatedTube, {
    endpointRadiusMultiplier: 0.26,
    transitionFraction: 0.2,
    profile: 'smoothstep-arc-length',
    volumeCompensation: 'global-radius',
  }).source;
  const requestedRoles = [
    { azimuthRadians: -1.2, radialDistance: 1.8, axialOffset: 0 },
    { azimuthRadians: 2.65, radialDistance: 2.2, axialOffset: 0 },
    { azimuthRadians: 0.75, radialDistance: 1.4, axialOffset: -0.25 },
    { azimuthRadians: 0.05, radialDistance: 1.8, axialOffset: 0.25 },
  ];
  const allocationSchedule = K4_IDS.map((muscleId, index) => ({
    muscleId,
    ...requestedRoles[index],
  }));
  const solverConfig = {
    maxIterations: 1,
    clusterUpdate: 'capsule-axis-occupancy-allocation',
    clusterObstacleId: authenticatedTube.obstacles[0].id,
    clusterOccupancyReferenceDirection: [1, 0, 0],
    clusterAllocationSchedule: allocationSchedule,
  };

  const tubeResult = packing.solveMuscleCompartmentPacking(authenticatedTube, solverConfig);
  assert.equal(tubeResult.status, 'immutable-constraint-conflict');
  assert.deepEqual(
    tubeResult.muscles.map(({ realizedVolume: ignored, ...muscle }) => muscle),
    authenticatedTube.muscles,
  );
  assert.equal(tubeResult.failure.blockingMechanisms.length, 4);

  const taperedResult = packing.solveMuscleCompartmentPacking(tapered, solverConfig);
  assert.notEqual(taperedResult.status, 'immutable-constraint-conflict');
  assert.deepEqual(taperedResult.clusterProjection, {
    requestedUpdate: 'capsule-axis-occupancy-allocation',
    effectiveUpdate: 'capsule-axis-occupancy-allocation',
    obstacleId: authenticatedTube.obstacles[0].id,
    referenceDirection: [1, 0, 0],
    effectiveReferenceDirection: taperedResult.clusterProjection.effectiveReferenceDirection,
    allocationSchedule,
    allocationReference:
      'capsule-axis-belly-anchor-absolute-role-preserve-local-shape-sine-zero-at-attachments',
    fallbackUsed: false,
  });
  assert.equal(taperedResult.clusterProjection.effectiveReferenceDirection.length, 3);
  assert.ok(
    Math.abs(Math.hypot(...taperedResult.clusterProjection.effectiveReferenceDirection) - 1) <= 1e-12,
  );
  assert.equal(taperedResult.metrics.packed.endpointDrift, 0);
  assert.ok(taperedResult.metrics.packed.maximumRelativeVolumeError <= 1e-9);
  assert.ok(
    taperedResult.metrics.packed.maximumSourceKnotDisplacement <= 2,
    'source-aligned occupancy roles must not collapse axial overhangs onto the finite capsule',
  );
  assert.ok(
    taperedResult.metrics.packed.pairwisePenetration <
      taperedResult.metrics.initial.pairwisePenetration,
    'local relaxation after occupancy allocation must materially reduce pairwise overlap',
  );
  assert.equal(
    taperedResult.metrics.packed.sourceTangentReversalCount,
    0,
    'the first explicit occupancy carrier must not fold its longitudinal direction',
  );
  assert.equal(
    taperedResult.metrics.packed.pairwiseRelationReversalCount,
    0,
    'the first explicit occupancy carrier must not invert pairwise source relations',
  );
});
