import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOLD_MUSCULATURE_SOURCE_EVIDENCE,
} from '../musculature-source-m0-core.mjs';
import {
  TRACK_M_SOURCE_SCHEMA,
  buildTrackMEvidencePlan,
} from '../track-m-evidence-bundle-core.mjs';
import {
  TRACK_M_M0_BUNDLE_COMPATIBILITY_SCHEMA,
  validateTrackMM0BundleCompatibility,
} from '../track-m-m0-bundle-compatibility.mjs';

const H = value => value.repeat(64).slice(0, 64);
const budget = {
  primitiveCount: 12,
  vertexCount: 480,
  triangleCount: 912,
  parameterCount: 36,
};

function makeBundleSource() {
  return {
    schema: TRACK_M_SOURCE_SCHEMA,
    trackId: 'shape-bearing-musculature',
    receiptId: 'operator-musculature-source-receipt-v0',
    asset: { id: 'operator-musculature-source-v0', path: '/caller/source.blend', sha256: H('0') },
    pose: { id: 'conservative-pose-v0', kind: 'conservative', authorityId: 'external-pose-authority', sha256: H('1') },
    camera: { id: 'track-m-fixed-camera-v0', projection: 'orthographic', width: 640, height: 640, sha256: H('2') },
    material: { id: 'track-m-clay-v0', sha256: H('3') },
    illumination: { id: 'track-m-light-v0', sha256: H('4') },
    renderConfig: { id: 'track-m-render-v0', width: 640, height: 640, sha256: H('5') },
    route: {
      requestedRouteId: 'cpu-shape-bearing-oracle-route',
      executionClass: 'cpu',
      requiresGpu: false,
      adapterContractSha256: H('e'),
    },
    productContract: [
      { kind: 'clay', mimeType: 'image/png' },
      { kind: 'depth', mimeType: 'image/png' },
      { kind: 'normal', mimeType: 'image/png' },
    ],
    testedRelation: {
      id: 'deep-flexor-routing-v0',
      deepGeometryIds: ['deep-flexor-a', 'deep-flexor-b'],
      deepGeometryContentSetSha256: H('6'),
      attachmentEndpointMultisetSha256: H('7'),
      expectedRoutingGraphSha256: H('8'),
      representationalBudget: { ...budget },
    },
    conditions: {
      'deep-geometry-absent': {
        transform: { id: 'remove-deep-geometry-v0', kind: 'remove-deep-geometry', sha256: H('a') },
        deepGeometryPresent: false,
        testedRelationPresent: false,
        removedGeometryIds: ['deep-flexor-a', 'deep-flexor-b'],
      },
      'deep-geometry-correctly-routed': {
        transform: { id: 'correct-routing-v0', kind: 'preserve-correct-routing', sha256: H('b') },
        deepGeometryPresent: true,
        testedRelationPresent: true,
        deepGeometryContentSetSha256: H('6'),
        attachmentEndpointMultisetSha256: H('7'),
        routingGraphSha256: H('8'),
        representationalBudget: { ...budget },
      },
      'deep-geometry-matched-wrong-routing': {
        transform: { id: 'wrong-routing-v0', kind: 'matched-wrong-routing', sha256: H('c') },
        deepGeometryPresent: true,
        testedRelationPresent: false,
        destroyedRelationId: 'deep-flexor-routing-v0',
        deepGeometryContentSetSha256: H('6'),
        attachmentEndpointMultisetSha256: H('7'),
        routingGraphSha256: H('9'),
        routingPermutationSha256: H('d'),
        representationalBudget: { ...budget },
      },
    },
  };
}

test('valid Track M bundle is a compatible predecessor that still holds M0', () => {
  const source = makeBundleSource();
  const plan = buildTrackMEvidencePlan(source);
  const result = validateTrackMM0BundleCompatibility({ source, plan });

  assert.equal(result.schema, TRACK_M_M0_BUNDLE_COMPATIBILITY_SCHEMA);
  assert.equal(result.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
  assert.equal(result.comparisonClassCompatible, true);
  assert.equal(result.losslessM0Receipt, false);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.mappedPredicates.conditionIds, [
    'deep-geometry-absent',
    'deep-geometry-correctly-routed',
    'deep-geometry-matched-wrong-routing',
  ]);
  assert.equal(result.mappedPredicates.assetSha256, source.asset.sha256);
  assert.equal(result.mappedPredicates.conservativePoseSha256, source.pose.sha256);
  assert.equal(result.mappedPredicates.fixedCameraSha256, source.camera.sha256);
  assert.equal(result.mappedPredicates.routingRelationId, source.testedRelation.id);
  assert.ok(result.missingM0Authority.includes('semanticNames'));
  assert.ok(result.missingM0Authority.includes('localFrames'));
  assert.ok(result.missingM0Authority.includes('neutralConservativePosePair'));
  assert.ok(result.missingM0Authority.includes('packingBehavior'));
  assert.ok(result.missingM0Authority.includes('neighboringSupportIndependence'));
});

test('downstream station-shaped baggage cannot promote a bundle into M0', () => {
  const source = makeBundleSource();
  const plan = buildTrackMEvidencePlan(source);
  plan.measurementStation = { status: 'passed' };
  plan.cells = Array.from({ length: 6 }, (_, index) => ({ id: index, status: 'passed' }));

  const result = validateTrackMM0BundleCompatibility({ source, plan });
  assert.equal(result.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
  assert.equal(result.losslessM0Receipt, false);
  assert.ok(result.ignoredDownstreamFields.includes('measurementStation'));
  assert.ok(result.ignoredDownstreamFields.includes('cells'));
});

test('source and plan identity drift fails instead of looking like a source hold', () => {
  const source = makeBundleSource();
  const plan = buildTrackMEvidencePlan(source);
  plan.id = H('f');

  const result = validateTrackMM0BundleCompatibility({ source, plan });
  assert.equal(result.comparisonClassCompatible, false);
  assert.equal(result.losslessM0Receipt, false);
  assert.equal(result.failures[0].code, 'track-m-plan-identity-mismatch');
});

test('nested persisted-plan drift fails even when copied public identities stay unchanged', () => {
  const source = makeBundleSource();
  const plan = buildTrackMEvidencePlan(source);
  plan.asset.sha256 = H('f');

  const result = validateTrackMM0BundleCompatibility({ source, plan });
  assert.equal(result.comparisonClassCompatible, false);
  assert.equal(result.losslessM0Receipt, false);
  assert.equal(result.failures[0].code, 'track-m-plan-content-mismatch');
});

test('plan schema drift fails even when copied public identities stay unchanged', () => {
  const source = makeBundleSource();
  const plan = buildTrackMEvidencePlan(source);
  plan.schema = 'kaminos.track-m-evidence-plan.stale';

  const result = validateTrackMM0BundleCompatibility({ source, plan });
  assert.equal(result.comparisonClassCompatible, false);
  assert.equal(result.failures[0].code, 'track-m-plan-content-mismatch');
});

test('unrecognized plan baggage fails rather than silently escaping comparison', () => {
  const source = makeBundleSource();
  const plan = buildTrackMEvidencePlan(source);
  plan.unreviewedAuthority = { status: 'passed' };

  const result = validateTrackMM0BundleCompatibility({ source, plan });
  assert.equal(result.comparisonClassCompatible, false);
  assert.equal(result.failures[0].code, 'track-m-plan-content-mismatch');
});

test('malformed plan shapes return structured incompatibility evidence', () => {
  const source = makeBundleSource();

  for (const plan of [null, 'stale-plan', [], 17]) {
    const result = validateTrackMM0BundleCompatibility({ source, plan });
    assert.equal(result.comparisonClassCompatible, false);
    assert.equal(result.losslessM0Receipt, false);
    assert.equal(result.failures[0].code, 'track-m-plan-shape-invalid');
    assert.deepEqual(result.ignoredDownstreamFields, []);
  }
});
