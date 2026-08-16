import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROCEDURAL_GROOM_ESTIMATION_REPORT_SCHEMA,
  PROCEDURAL_GROOM_OBSERVATION_SCHEMA,
  PROCEDURAL_GROOM_PROPOSAL_SCHEMA,
  PROCEDURAL_GROOM_TRUTH_REFERENCE_SCHEMA,
  evaluateProceduralGroomEstimationAssay,
} from '../procedural-groom-estimation-core.mjs';

const H = digit => digit.repeat(64);

function observation(overrides = {}) {
  return {
    schema: PROCEDURAL_GROOM_OBSERVATION_SCHEMA,
    observationId: 'procedural-groom-neutral-observation-v0',
    fixtureId: 'procedural-groom-truth-v0',
    digest: H('a'),
    truthExposure: 'withheld',
    requestedRoute: 'kaminos:membership-neutral-canvas',
    effectiveRoute: 'kaminos:membership-neutral-canvas',
    views: [
      {
        id: 'front-three-quarter',
        path: 'observations/front-three-quarter.png',
        sha256: H('1'),
        byteLength: 12000,
        membershipColorsVisible: false,
        labelsVisible: false,
        gizmoVisible: false,
      },
    ],
    ...overrides,
  };
}

function region(id) {
  return {
    id,
    presenceProbability: 0.8,
    mask: { path: `masks/${id}.png`, sha256: H('2'), byteLength: 900 },
    flow2d: [0.8, 0.6],
    lengthToCarrierScale: 0.3,
    density: 0.5,
    puff: 0.4,
    confidence: 0.7,
  };
}

function proposal(overrides = {}) {
  return {
    schema: PROCEDURAL_GROOM_PROPOSAL_SCHEMA,
    proposalId: 'proposal-v0',
    proposalDigest: H('b'),
    observationId: 'procedural-groom-neutral-observation-v0',
    observationDigest: H('a'),
    sealed: true,
    requestedRoute: 'vlm-sam:groom-proposal-v0',
    effectiveRoute: 'vlm-sam:groom-proposal-v0',
    regions: [
      region('short-coat'),
      region('puffy-coat'),
      region('ruff'),
      region('mystacial-pad-left'),
      region('mystacial-pad-right'),
    ],
    whiskers: {
      detectionTarget: 'whisker-presence',
      segmentationTarget: 'mystacial-pad',
      presenceProbability: 0.9,
      lengthToMuzzleWidth: 1.1,
      sparseness: 0.8,
      confidence: 0.75,
    },
    visualAdmission: false,
    scientificAdmission: false,
    ...overrides,
  };
}

function truthReference(overrides = {}) {
  return {
    schema: PROCEDURAL_GROOM_TRUTH_REFERENCE_SCHEMA,
    fixtureId: 'procedural-groom-truth-v0',
    manifestPath: 'generated/manifest.json',
    manifestSha256: H('c'),
    releasedAfterProposalDigest: H('b'),
    ...overrides,
  };
}

test('membership colors, labels, and transform gizmos cannot enter a blind observation', () => {
  for (const field of ['membershipColorsVisible', 'labelsVisible', 'gizmoVisible']) {
    const contaminated = observation();
    contaminated.views[0][field] = true;
    const report = evaluateProceduralGroomEstimationAssay({
      observation: contaminated,
      proposal: proposal(),
      truthReference: truthReference(),
    });
    assert.equal(report.state, 'invalid_observation');
    assert.match(report.failures.join('\n'), new RegExp(field));
  }
});

test('a proposal fails loud when observation identity or effective route falls back', () => {
  const stale = proposal({ observationDigest: H('f') });
  assert.equal(evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: stale, truthReference: truthReference(),
  }).state, 'invalid_proposal');

  const fallback = proposal({ effectiveRoute: 'manual-defaults' });
  assert.equal(evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: fallback, truthReference: truthReference(),
  }).state, 'invalid_proposal_route');
});

test('truth fields cannot leak into the estimator proposal', () => {
  const leaked = proposal({
    truthManifest: 'generated/manifest.json',
    guideIds: ['short-coat-low-puff-00'],
  });
  const report = evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: leaked, truthReference: truthReference(),
  });
  assert.equal(report.state, 'proposal_truth_leakage');
  assert.match(report.failures.join('\n'), /truthManifest|guideIds/);
});

test('blank masks and missing target regions cannot become comparison evidence', () => {
  const blank = proposal();
  blank.regions.find(candidate => candidate.id === 'ruff').mask.byteLength = 0;
  assert.equal(evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: blank, truthReference: truthReference(),
  }).state, 'invalid_proposal');

  const missingPad = proposal();
  missingPad.regions = missingPad.regions.filter(candidate => candidate.id !== 'mystacial-pad-right');
  assert.equal(evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: missingPad, truthReference: truthReference(),
  }).state, 'invalid_proposal');
});

test('truth cannot be released against an unsealed or different proposal', () => {
  const unsealed = proposal({ sealed: false });
  assert.equal(evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: unsealed, truthReference: truthReference(),
  }).state, 'premature_truth_release');

  const mismatched = truthReference({ releasedAfterProposalDigest: H('d') });
  assert.equal(evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: proposal(), truthReference: mismatched,
  }).state, 'premature_truth_release');
});

test('complete sealed inputs permit comparison without granting scientific admission', () => {
  const report = evaluateProceduralGroomEstimationAssay({
    observation: observation(), proposal: proposal(), truthReference: truthReference(),
  });
  assert.equal(report.schema, PROCEDURAL_GROOM_ESTIMATION_REPORT_SCHEMA);
  assert.equal(report.state, 'estimation_ready_for_comparison');
  assert.deepEqual(report.failures, []);
  assert.equal(report.visualAdmission, false);
  assert.equal(report.scientificAdmission, false);
});
