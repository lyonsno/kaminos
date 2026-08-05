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

test('ordered route selection is caller-addressed and the ladder produces deterministic ordered pressure', async () => {
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
  assert.ok(first.conditions.every(
    condition => condition.result.metrics.packed.maximumRelativeVolumeError <= 1e-9,
  ));
});

test('tapered belly mode is explicit, volume preserving, and leaves the tube baseline untouched', async () => {
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

  assert.equal(tube.shapeProfile, undefined, 'the legacy tube comparison must remain byte-stable');
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
    for (const muscle of condition.source.muscles) {
      assert.equal(muscle.shapeProfile.id, BELLY_PROFILE_ID);
      assert.equal(muscle.shapeProfile.authority, 'agent-authored-provisional');
      const middle = muscle.centerline[Math.floor(muscle.centerline.length / 2)].radius;
      assert.ok(middle > muscle.centerline[0].radius * 2.5, `${muscle.id} origin must taper`);
      assert.ok(middle > muscle.centerline.at(-1).radius * 2.5, `${muscle.id} insertion must taper`);
      assert.ok(
        Math.abs(carrierVolume(muscle.centerline) - muscle.targetVolume) / muscle.targetVolume <= 1e-12,
        `${muscle.id} belly profile must preserve the measured-candidate target volume`,
      );
      assert.deepEqual(
        muscle.centerline.map(knot => knot.position),
        tube.conditions.find(candidate => candidate.id === condition.id)
          .source.muscles.find(candidate => candidate.id === muscle.id)
          .centerline.map(knot => knot.position),
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
