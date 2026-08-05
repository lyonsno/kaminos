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
const BELLY_PROFILE_ID = 'volume-preserving-tapered-belly.v0';

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const start = centerline[index];
    const end = centerline[index + 1];
    const segmentLength = Math.hypot(...start.position.map(
      (value, axis) => end.position[axis] - value,
    ));
    volume += Math.PI * segmentLength / 3 * (
      start.radius ** 2 + start.radius * end.radius + end.radius ** 2
    );
  }
  return volume;
}

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

function minimumAttachmentTangentCosine(source, result) {
  let minimum = 1;
  for (const [muscleIndex, sourceMuscle] of source.muscles.entries()) {
    const resultMuscle = result.muscles[muscleIndex];
    for (const [sourceStart, sourceEnd, resultStart, resultEnd] of [
      [
        sourceMuscle.centerline[0],
        sourceMuscle.centerline[1],
        resultMuscle.centerline[0],
        resultMuscle.centerline[1],
      ],
      [
        sourceMuscle.centerline.at(-2),
        sourceMuscle.centerline.at(-1),
        resultMuscle.centerline.at(-2),
        resultMuscle.centerline.at(-1),
      ],
    ]) {
      const sourceTangent = sourceEnd.position.map(
        (value, axis) => value - sourceStart.position[axis],
      );
      const resultTangent = resultEnd.position.map(
        (value, axis) => value - resultStart.position[axis],
      );
      const cosine = sourceTangent.reduce(
        (sum, value, axis) => sum + value * resultTangent[axis],
        0,
      ) / (Math.hypot(...sourceTangent) * Math.hypot(...resultTangent));
      minimum = Math.min(minimum, cosine);
    }
  }
  return minimum;
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

test('Bytebound tapered belly profile composes without changing tube identity or measured volume', async () => {
  const api = assayApi();
  const fixture = await atlasFixture();
  const tube = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });
  const belly = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
    shapeProfileId: BELLY_PROFILE_ID,
  });

  assert.equal(
    packing.VOLUME_PRESERVING_TAPERED_BELLY_PROFILE,
    BELLY_PROFILE_ID,
    'Packer must consume Bytebound e356e402/54fa0067 profile identity exactly',
  );
  assert.equal(tube.shapeProfile, undefined, 'the tube comparison must remain unchanged');
  assert.deepEqual(belly.shapeProfile.requested, { id: BELLY_PROFILE_ID });
  assert.deepEqual(belly.shapeProfile.effective, {
    id: BELLY_PROFILE_ID,
    authority: 'agent-authored-provisional',
    parameterization: 'normalized-candidate-centerline-arc-length',
    endpointRadiusFraction: 0.32,
    bellyExponent: 0.8,
    volumePolicy: 'global-radius-scale-to-measured-candidate-target-volume',
  });
  assert.deepEqual(belly.requestedConstructionIds, tube.requestedConstructionIds);
  assert.deepEqual(belly.effectiveConstructionIds, tube.effectiveConstructionIds);
  assert.equal(belly.parentAtlas.fileSha256, tube.parentAtlas.fileSha256);

  for (const condition of belly.conditions) {
    assert.deepEqual(condition.source.assayProvenance.shapeProfile, belly.shapeProfile);
    const tubeCondition = tube.conditions.find(candidate => candidate.id === condition.id);
    for (const muscle of condition.source.muscles) {
      const tubeMuscle = tubeCondition.source.muscles.find(candidate => candidate.id === muscle.id);
      assert.equal(muscle.shapeProfile.id, BELLY_PROFILE_ID);
      assert.equal(muscle.shapeProfile.authority, 'agent-authored-provisional');
      const middle = muscle.centerline[Math.floor(muscle.centerline.length / 2)].radius;
      assert.ok(middle > muscle.centerline[0].radius * 2.5, `${muscle.id} origin must taper`);
      assert.ok(middle > muscle.centerline.at(-1).radius * 2.5, `${muscle.id} insertion must taper`);
      assert.ok(
        Math.abs(carrierVolume(muscle.centerline) - muscle.targetVolume) /
          muscle.targetVolume <= 1e-12,
        `${muscle.id} belly profile must preserve measured-candidate target volume`,
      );
      assert.deepEqual(
        muscle.centerline.map(knot => knot.position),
        tubeMuscle.centerline.map(knot => knot.position),
        `${muscle.id} profile must not move the candidate centerline or attachments`,
      );
    }
  }

  const replay = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
    shapeProfileId: BELLY_PROFILE_ID,
  });
  assert.deepEqual(replay, belly, 'identical belly inputs must replay byte-identically');
  assert.throws(
    () => api.createSourceShapedPackingPerturbationSeries({
      ...fixture,
      requestedConstructionIds: K4_IDS,
      levels: LEVELS,
      shapeProfileId: 'convenient-unbound-belly',
    }),
    /shape profile.*unsupported|unsupported.*shape profile/i,
  );
});

test('source-linked exact attachment contact opens belly negotiation without hiding its fixed residual', async () => {
  const api = assayApi();
  const fixture = await atlasFixture();
  const unadmitted = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
    shapeProfileId: BELLY_PROFILE_ID,
  });
  const baseline = unadmitted.conditions[0].source;
  const attachment = (muscleId, endpoint) => {
    const muscle = baseline.muscles.find(candidate => candidate.id === muscleId);
    return {
      muscleId,
      attachment: endpoint,
      attachmentId: muscle.attachments[endpoint].id,
    };
  };
  const contacts = [
    {
      id: 'current-k4-m34-m45-shared-insertion-contact',
      authority: 'agent-authored-provisional',
      left: attachment('muscle-34', 'insertion'),
      right: attachment('muscle-45', 'insertion'),
      scope: { kind: 'exact-fixed-endpoint', maximumPathFraction: 0 },
    },
    {
      id: 'current-k4-m12-m45-shared-insertion-contact',
      authority: 'agent-authored-provisional',
      left: attachment('muscle-12', 'insertion'),
      right: attachment('muscle-45', 'insertion'),
      scope: { kind: 'exact-fixed-endpoint', maximumPathFraction: 0 },
    },
  ];
  const admitted = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
    shapeProfileId: BELLY_PROFILE_ID,
    fixedAttachmentContacts: contacts,
  });
  const source = admitted.conditions[0].source;
  const schedule = [
    { muscleId: 'muscle-34', azimuthRadians: -1.2, radialDistance: 1.8, axialOffset: 0 },
    { muscleId: 'muscle-13', azimuthRadians: 2.65, radialDistance: 2.2, axialOffset: 0 },
    { muscleId: 'muscle-12', azimuthRadians: 0.75, radialDistance: 1.4, axialOffset: -0.25 },
    { muscleId: 'muscle-45', azimuthRadians: 0.05, radialDistance: 1.8, axialOffset: 0.25 },
  ];
  const config = {
    maxIterations: 2,
    clusterUpdate: 'capsule-axis-occupancy-allocation',
    clusterObstacleId: source.obstacles[0].id,
    clusterOccupancyReferenceDirection: [1, 0, 0],
    clusterAllocationSchedule: schedule,
    clusterOccupancyEnvelope: 'normalized-sine',
  };
  const sourceBefore = structuredClone(source);
  const result = api.solveMuscleCompartmentPacking(source, config);

  assert.deepEqual(source.fixedAttachmentContacts, contacts);
  assert.deepEqual(source.assayProvenance.fixedAttachmentContacts.requested, contacts);
  assert.deepEqual(source.assayProvenance.fixedAttachmentContacts.effective, contacts);
  assert.notEqual(result.status, 'immutable-constraint-conflict');
  assert.ok(result.iterations > 0, 'the exact admitted endpoint contacts must open belly negotiation');
  assert.equal(result.fixedAttachmentContact.policy, 'exact-source-linked-endpoint-only');
  assert.deepEqual(result.fixedAttachmentContact.requested, contacts);
  assert.equal(result.fixedAttachmentContact.effective.length, 2);
  assert.equal(result.fixedAttachmentContact.admittedResiduals.length, 2);
  assert.deepEqual(
    result.fixedAttachmentContact.admittedResiduals.map(row => row.penetration),
    [0.204054995089, 0.105802263217],
  );
  assert.ok(
    result.metrics.packed.pairwisePenetration >= 0.204054995089,
    'admitted fixed contact remains in the full pairwise residual instead of disappearing',
  );
  assert.equal(result.metrics.packed.endpointDrift, 0);
  assert.deepEqual(source, sourceBefore, 'contact admission must not mutate the source fixture');

  const partial = api.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
    shapeProfileId: BELLY_PROFILE_ID,
    fixedAttachmentContacts: contacts.slice(0, 1),
  }).conditions[0].source;
  const partialResult = api.solveMuscleCompartmentPacking(partial, {
    ...config,
    clusterObstacleId: partial.obstacles[0].id,
  });
  assert.equal(partialResult.status, 'immutable-constraint-conflict');
  assert.equal(partialResult.failure.blockingMechanisms.length, 1);
  assert.equal(partialResult.failure.blockingMechanisms[0].left.muscleId, 'muscle-12');
  assert.equal(partialResult.failure.blockingMechanisms[0].right.muscleId, 'muscle-45');
  assert.equal(partialResult.fixedAttachmentContact.admittedResiduals.length, 1);

  assert.throws(
    () => api.createSourceShapedPackingPerturbationSeries({
      ...fixture,
      requestedConstructionIds: K4_IDS,
      levels: LEVELS,
      shapeProfileId: BELLY_PROFILE_ID,
      fixedAttachmentContacts: [{ ...contacts[0], authority: 'anatomical-fact' }],
    }),
    /fixed attachment contact.*authority|authority.*fixed attachment contact/i,
  );
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
  const tapered = packing.deriveEndpointTaperedPackingSource(parent, {
    endpointRadiusMultiplier: 0.26,
    transitionFraction: 0.2,
    profile: 'smoothstep-arc-length',
    volumeCompensation: 'global-radius',
  }).source;
  assert.throws(
    () => packing.solveMuscleCompartmentPacking(tapered, {
      maxIterations: 1,
      clusterOccupancyEnvelope: 'normalized-sine-squared',
    }),
    /clusterOccupancyEnvelope requires a capsule-axis clusterUpdate/,
  );
  assert.throws(
    () => packing.solveMuscleCompartmentPacking(tapered, {
      maxIterations: 1,
      clusterUpdate: 'capsule-axis-occupancy-allocation',
      clusterObstacleId: tapered.obstacles[0].id,
      clusterOccupancyReferenceDirection: [1, 0, 0],
      clusterAllocationSchedule: K4_IDS.map(muscleId => ({
        muscleId,
        azimuthRadians: 0,
        radialDistance: 1,
        axialOffset: 0,
      })),
      clusterOccupancyEnvelope: 'implicit-smoothing',
    }),
    /clusterOccupancyEnvelope must be normalized-sine or normalized-sine-squared/,
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
      'capsule-axis-belly-anchor-absolute-role-preserve-local-shape-normalized-sine-zero-at-attachments',
    requestedEnvelopeProfile: 'normalized-sine',
    effectiveEnvelopeProfile: 'normalized-sine',
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

test('clamped current-K4 occupancy transition preserves attachment-near tangent direction', async () => {
  const fixture = await atlasFixture();
  const series = packing.createSourceShapedPackingPerturbationSeries({
    ...fixture,
    requestedConstructionIds: K4_IDS,
    levels: LEVELS,
  });
  const tapered = packing.deriveEndpointTaperedPackingSource(series.conditions[0].source, {
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
  const common = {
    maxIterations: 4,
    clusterUpdate: 'capsule-axis-occupancy-allocation',
    clusterObstacleId: tapered.obstacles[0].id,
    clusterOccupancyReferenceDirection: [1, 0, 0],
    clusterAllocationSchedule: K4_IDS.map((muscleId, index) => ({
      muscleId,
      ...requestedRoles[index],
    })),
  };
  const sine = packing.solveMuscleCompartmentPacking(tapered, common);
  const clamped = packing.solveMuscleCompartmentPacking(tapered, {
    ...common,
    clusterOccupancyEnvelope: 'normalized-sine-squared',
  });

  assert.equal(
    clamped.clusterProjection.effectiveEnvelopeProfile,
    'normalized-sine-squared',
    'the zero-slope transition must be explicit in the effective cluster receipt',
  );
  assert.equal(
    clamped.clusterProjection.requestedEnvelopeProfile,
    'normalized-sine-squared',
  );
  const sineAttachmentTangentCosine = minimumAttachmentTangentCosine(tapered, sine);
  const clampedAttachmentTangentCosine = minimumAttachmentTangentCosine(tapered, clamped);
  assert.ok(
    clampedAttachmentTangentCosine > sineAttachmentTangentCosine + 0.03,
    'the clamped envelope must materially improve the worst attachment-adjacent tangent: ' +
      JSON.stringify({ sineAttachmentTangentCosine, clampedAttachmentTangentCosine }),
  );
  assert.ok(
    clamped.metrics.packed.pairwisePenetration <
      clamped.metrics.initial.pairwisePenetration * 0.2,
    'clamping the endpoint slope must retain material pairwise relief',
  );
  assert.equal(clamped.metrics.packed.endpointDrift, 0);
  assert.ok(clamped.metrics.packed.maximumRelativeVolumeError <= 1e-9);
  assert.equal(clamped.metrics.packed.sourceTangentReversalCount, 0);
  assert.equal(clamped.metrics.packed.pairwiseRelationReversalCount, 0);
});
