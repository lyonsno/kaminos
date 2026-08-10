import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NBODY_PACKING_ASSAY_FIXTURE_SCHEMA,
  NBODY_PACKING_ASSAY_RESULT_SCHEMA,
  createNBodyRosetteFixture,
  runNBodyRosetteCounterfeitAssay,
} from '../nbody-packing-assay-core.mjs';
import { hashMusclePackingCanonicalJson } from '../muscle-compartment-packing-core.mjs';

const PRESSURE_CHAIN = ['rosette-west', 'rosette-center', 'rosette-east'];

function endpoints(muscle) {
  return [muscle.centerline[0].position, muscle.centerline.at(-1).position];
}

function normalizedPenetrationRows(fixture) {
  const muscles = new Map(fixture.crowded.muscles.map(muscle => [muscle.id, muscle]));
  return fixture.metrics.crowdedBelt.pairs.map(pair => {
    const left = muscles.get(pair.members[0]).centerline[pair.controllingKnotIndex];
    const right = muscles.get(pair.members[1]).centerline[pair.controllingKnotIndex];
    return {
      ...pair,
      normalizedPenetration:pair.penetration / (left.radius + right.radius),
    };
  });
}

function maximumBellyDisplacement(left, right) {
  return Math.max(...left.centerline.slice(1, -1).map((knot, index) => {
    const other = right.centerline[index + 1];
    return Math.hypot(...knot.position.map((value, axis) => value - other.position[axis]));
  }));
}

function rehashSyntheticSource(source) {
  const { input, ...core } = source;
  const sha256 = hashMusclePackingCanonicalJson(core);
  source.input = {
    requested:{ kind:'synthetic-fixture', id:source.id, sha256 },
    effective:{ kind:'synthetic-fixture', id:source.id, sha256 },
  };
}

function rehashFixture(fixture) {
  const { identity, input, ...core } = fixture;
  const sha256 = hashMusclePackingCanonicalJson(core);
  fixture.identity = { sha256 };
  fixture.input = {
    requested:{ kind:'synthetic-nbody-assay-fixture', id:fixture.id, sha256 },
    effective:{ kind:'synthetic-nbody-assay-fixture', id:fixture.id, sha256 },
  };
}

test('manufactured five-body rosette starts from a known admissible packed witness', () => {
  const fixture = createNBodyRosetteFixture();

  assert.equal(fixture.schema, NBODY_PACKING_ASSAY_FIXTURE_SCHEMA);
  assert.equal(fixture.authority.kind, 'synthetic-known-feasible');
  assert.equal(fixture.authority.anatomicalAdmission, 'none');
  assert.equal(fixture.dimension, 3);
  assert.equal(fixture.knownFeasible.muscles.length, 5);
  assert.deepEqual(fixture.pressureChain, PRESSURE_CHAIN);
  assert.equal(fixture.contactGraph.members.length, 5);
  assert.ok(fixture.contactGraph.edges.length >= 8, 'fixture needs a star plus a closed ring');
  assert.equal(fixture.contactGraph.requiredCycle.length, 4);
  assert.match(fixture.identity.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(fixture.input.requested, fixture.input.effective);

  assert.equal(fixture.metrics.knownFeasible.pairwisePenetration, 0);
  assert.equal(fixture.metrics.knownFeasible.skeletalPenetration, 0);
  assert.equal(fixture.metrics.knownFeasible.compartmentEscape, 0);
  assert.equal(fixture.metrics.knownFeasible.endpointDrift, 0);
  assert.ok(fixture.metrics.knownFeasible.maximumRelativeVolumeError <= 1e-12);
  assert.equal(fixture.metrics.knownFeasibleBelt.totalPenetration, 0);
  assert.ok(
    fixture.metrics.knownFeasibleBelt.minimumDeclaredContactGap > 0 &&
      fixture.metrics.knownFeasibleBelt.minimumDeclaredContactGap < 0.06,
    'known witness must be close-packed without already interpenetrating',
  );

  assert.ok(fixture.metrics.crowded.pairwisePenetration > 0.1);
  assert.ok(fixture.metrics.crowdedBelt.byPair['rosette-west|rosette-center'].penetration > 0.08);
  assert.equal(fixture.metrics.crowded.endpointDrift, 0);
  assert.ok(fixture.metrics.crowded.maximumRelativeVolumeError <= 1e-12);

  for (const [index, crowded] of fixture.crowded.muscles.entries()) {
    const packed = fixture.knownFeasible.muscles[index];
    assert.equal(crowded.id, packed.id);
    assert.deepEqual(crowded.identity, packed.identity);
    assert.deepEqual(crowded.attachments, packed.attachments);
    assert.deepEqual(endpoints(crowded), endpoints(packed));
    assert.equal(crowded.targetVolume, packed.targetVolume);
  }

  assert.deepEqual(
    createNBodyRosetteFixture(),
    fixture,
    'fixture and deterministic crowding continuation must be byte-stable',
  );
});

test('severe comparative rosette is visibly multi-contact while retaining a known feasible witness', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'severe-comparative-v0' });

  assert.equal(fixture.assayProfile.stressTier, 'severe-comparative-v0');
  assert.equal(fixture.assayProfile.comparisonAuthority, 'visual-and-hard-gates-only');
  assert.equal(fixture.metrics.knownFeasible.pairwisePenetration, 0);
  assert.equal(fixture.metrics.knownFeasible.skeletalPenetration, 0);
  assert.equal(fixture.metrics.knownFeasible.compartmentEscape, 0);
  assert.equal(fixture.metrics.knownFeasible.endpointDrift, 0);
  assert.ok(fixture.metrics.knownFeasible.maximumRelativeVolumeError <= 1e-12);

  const substantial = normalizedPenetrationRows(fixture).filter(
    pair => pair.normalizedPenetration >= 0.2,
  );
  assert.ok(
    substantial.length >= 4,
    `severe crowded state needs at least four >=20% normalized contacts, got ${substantial.length}`,
  );
  assert.ok(
    new Set(substantial.flatMap(pair => pair.members)).size >= 4,
    'substantial contacts must involve at least four bodies',
  );

  const knownById = new Map(fixture.knownFeasible.muscles.map(muscle => [muscle.id, muscle]));
  const materiallyMoved = fixture.crowded.muscles.filter(muscle =>
    maximumBellyDisplacement(muscle, knownById.get(muscle.id)) >= 0.14,
  );
  assert.ok(
    materiallyMoved.length >= 4,
    `severe recovery witness needs at least four members moving >=0.14, got ${materiallyMoved.length}`,
  );
  assert.equal(fixture.crowded.derivation.fallbackUsed, false);
  assert.ok(fixture.crowded.derivation.transforms.length >= 4);
  assert.equal(fixture.crowded.derivation.transforms.every(row => row.fallbackUsed === false), true);

  const obstacle = fixture.knownFeasible.obstacles[0];
  const compartmentCenterX = (
    fixture.knownFeasible.compartment.minimum[0] +
    fixture.knownFeasible.compartment.maximum[0]
  ) / 2;
  const obstacleCenterX = (obstacle.start[0] + obstacle.end[0]) / 2;
  assert.ok(
    Math.abs(obstacleCenterX - compartmentCenterX) >= 0.5,
    'severe fixture must retain an off-center skeletal bottleneck',
  );

  assert.deepEqual(
    createNBodyRosetteFixture({ stressTier:'severe-comparative-v0' }),
    fixture,
    'severe fixture and crowding continuation must be byte-stable',
  );
});

test('severe local counterfeit relieves one contact only by exporting already-loaded distal debt', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'severe-comparative-v0' });
  const result = runNBodyRosetteCounterfeitAssay({ fixture });

  assert.equal(result.status, 'counterfeit-rejected-global-debt');
  assert.ok(result.counterfeit.selectedPair.improvement >= 0.06);
  assert.ok(result.counterfeit.exportedDebt.beforePenetration > 0.05);
  assert.ok(result.counterfeit.exportedDebt.increase >= 0.05);
  assert.equal(result.admission.localSelectedPairImproved, true);
  assert.equal(result.admission.distalDebtExported, true);
  assert.equal(result.admission.globallyAdmissible, false);
});

test('frustrated comparative tier makes straight contact relief collide with an asymmetric bone route', () => {
  const fixture = createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' });

  assert.equal(fixture.assayProfile.stressTier, 'frustrated-comparative-v0');
  assert.equal(
    fixture.assayProfile.falsifier,
    'contact-only-radial-relief-exports-skeletal-debt',
  );
  assert.equal(fixture.metrics.knownFeasible.pairwisePenetration, 0);
  assert.equal(fixture.metrics.knownFeasible.skeletalPenetration, 0);
  assert.equal(fixture.metrics.knownFeasible.compartmentEscape, 0);
  assert.equal(fixture.metrics.crowded.skeletalPenetration, 0);
  assert.equal(fixture.metrics.crowded.compartmentEscape, 0);

  const substantial = normalizedPenetrationRows(fixture).filter(
    pair => pair.normalizedPenetration >= 0.2,
  );
  assert.ok(substantial.length >= 4);
  assert.ok(new Set(substantial.flatMap(pair => pair.members)).size >= 4);

  const knownById = new Map(fixture.knownFeasible.muscles.map(muscle => [muscle.id, muscle]));
  const materiallyMoved = fixture.crowded.muscles.filter(muscle =>
    maximumBellyDisplacement(muscle, knownById.get(muscle.id)) >= 0.24,
  );
  assert.ok(materiallyMoved.length >= 4);
  assert.ok(fixture.crowded.derivation.transforms.length >= 4);
  assert.equal(fixture.crowded.derivation.transforms.every(row => row.fallbackUsed === false), true);

  const westKnown = knownById.get('rosette-west').centerline[2].position;
  const westCrowded = fixture.crowded.muscles.find(
    muscle => muscle.id === 'rosette-west',
  ).centerline[2].position;
  assert.ok(westKnown[2] - westCrowded[2] >= 0.25, 'known route must bypass in z');
  assert.ok(westKnown[0] < westCrowded[0], 'known route must also recover westward clearance');

  assert.deepEqual(
    createNBodyRosetteFixture({ stressTier:'frustrated-comparative-v0' }),
    fixture,
  );
});

test('sequential local counterfeit improves its selected pair while exporting distal debt', () => {
  const requestedConfig = {
    update:'selected-pair-center-translation',
    selectedPair:['rosette-west', 'rosette-center'],
    pressureChain:PRESSURE_CHAIN,
    centerTranslation:[0.08, 0, 0],
    envelope:'sine-zero-at-attachments',
  };
  const result = runNBodyRosetteCounterfeitAssay({ requestedConfig });

  assert.equal(result.schema, NBODY_PACKING_ASSAY_RESULT_SCHEMA);
  assert.equal(result.status, 'counterfeit-rejected-global-debt');
  assert.deepEqual(result.config.requested, requestedConfig);
  assert.deepEqual(result.config.effective, requestedConfig);
  assert.equal(result.config.fallbackUsed, false);
  assert.deepEqual(result.input.requested, result.input.effective);
  assert.match(result.input.effective.sha256, /^[0-9a-f]{64}$/);

  const selectedPair = result.counterfeit.selectedPair;
  assert.deepEqual(selectedPair.members, requestedConfig.selectedPair);
  assert.ok(selectedPair.beforePenetration > 0.08);
  assert.ok(selectedPair.afterPenetration < selectedPair.beforePenetration * 0.3);
  assert.ok(selectedPair.improvement > 0.07);

  const distal = result.counterfeit.exportedDebt;
  assert.deepEqual(distal.members, ['rosette-center', 'rosette-east']);
  assert.equal(distal.beforePenetration, 0);
  assert.ok(distal.afterPenetration > 0.045);
  assert.ok(distal.increase > 0.045);

  assert.ok(
    result.states.sequentialCounterfeit.metrics.pairwisePenetration <
      result.states.crowded.metrics.pairwisePenetration,
    'counterfeit should look persuasive under aggregate penetration alone',
  );
  assert.ok(result.states.sequentialCounterfeit.metrics.pairwisePenetration > 0.1);
  assert.equal(result.states.sequentialCounterfeit.metrics.endpointDrift, 0);
  assert.ok(
    result.states.sequentialCounterfeit.metrics.maximumRelativeVolumeError <= 1e-12,
  );
  assert.equal(result.admission.localSelectedPairImproved, true);
  assert.equal(result.admission.aggregatePenetrationImproved, true);
  assert.equal(result.admission.distalDebtExported, true);
  assert.equal(result.admission.globallyAdmissible, false);
  assert.deepEqual(result.admission.rejectionReasons, [
    'remaining-global-pairwise-penetration',
    'distal-pressure-debt-exported',
  ]);

  const centerBefore = result.states.crowded.muscles.find(
    muscle => muscle.id === 'rosette-center',
  );
  const centerAfter = result.states.sequentialCounterfeit.muscles.find(
    muscle => muscle.id === 'rosette-center',
  );
  assert.deepEqual(endpoints(centerAfter), endpoints(centerBefore));
  assert.deepEqual(centerAfter.attachments, centerBefore.attachments);
  assert.deepEqual(centerAfter.identity, centerBefore.identity);

  assert.deepEqual(
    runNBodyRosetteCounterfeitAssay({ requestedConfig }),
    result,
    'counterfeit and its rejection ledger must be deterministic',
  );
});

test('counterfeit refuses hidden defaults, stale identities, and non-chain pair authority', () => {
  assert.throws(
    () => runNBodyRosetteCounterfeitAssay({ requestedConfig:{} }),
    /counterfeit config requires exact keys/,
  );
  assert.throws(
    () => runNBodyRosetteCounterfeitAssay({
      requestedConfig: {
        update:'selected-pair-center-translation',
        selectedPair:['rosette-center', 'rosette-north'],
        pressureChain:PRESSURE_CHAIN,
        centerTranslation:[0.08, 0, 0],
        envelope:'sine-zero-at-attachments',
      },
    }),
    /selectedPair must be the first pressure-chain edge/,
  );
  const fixture = createNBodyRosetteFixture();
  fixture.identity.sha256 = '0'.repeat(64);
  assert.throws(
    () => runNBodyRosetteCounterfeitAssay({ fixture, requestedConfig: {
      update:'selected-pair-center-translation',
      selectedPair:['rosette-west', 'rosette-center'],
      pressureChain:PRESSURE_CHAIN,
      centerTranslation:[0.08, 0, 0],
      envelope:'sine-zero-at-attachments',
    } }),
    /fixture identity mismatch/,
  );
});

test('hash-consistent metadata cannot promote a physically inadmissible known witness', () => {
  const fixture = createNBodyRosetteFixture();
  const center = fixture.knownFeasible.muscles.find(
    muscle => muscle.id === 'rosette-center',
  );
  center.centerline[2].radius = 1.2;
  center.centerline[3].radius = 1.2;
  rehashSyntheticSource(fixture.knownFeasible);
  rehashFixture(fixture);

  assert.throws(
    () => runNBodyRosetteCounterfeitAssay({ fixture }),
    /known-feasible state is physically inadmissible/,
  );
});
