import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NBODY_PACKING_ASSAY_FIXTURE_SCHEMA,
  NBODY_PACKING_ASSAY_RESULT_SCHEMA,
  createNBodyRosetteFixture,
  runNBodyRosetteCounterfeitAssay,
} from '../nbody-packing-assay-core.mjs';

const PRESSURE_CHAIN = ['rosette-west', 'rosette-center', 'rosette-east'];

function endpoints(muscle) {
  return [muscle.centerline[0].position, muscle.centerline.at(-1).position];
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
