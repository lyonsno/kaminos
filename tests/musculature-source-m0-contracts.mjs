import assert from 'node:assert/strict';

import {
  FAIL_MUSCULATURE_SOURCE,
  HOLD_MUSCULATURE_SOURCE_EVIDENCE,
  MUSCULATURE_SOURCE_M0_SCHEMA,
  MUSCULATURE_SOURCE_M0_VALIDATION_SCHEMA,
  PASS_MUSCULATURE_SOURCE_ONLY,
  validateMusculatureSourceM0,
} from '../musculature-source-m0-core.mjs';

const H = index => index.toString(16).repeat(64).slice(0, 64);

function frame(id, ownerId, origin = [0, 0, 0]) {
  return {
    id,
    ownerId,
    handedness: 'right',
    origin,
    axes: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  };
}

function makeReceipt({ pending = false, suffix = 'a' } = {}) {
  const sourceHash = H(1);
  const controlHash = H(2);
  const supportShapeHash = H(3);
  return {
    schema: MUSCULATURE_SOURCE_M0_SCHEMA,
    receiptId: `caller-musculature-${suffix}`,
    track: { id: `shape-bearing-track-${suffix}`, kind: 'shape-bearing-musculature' },
    source: {
      id: `blender-source-${suffix}`,
      sha256: sourceHash,
      path: `/operator-assets/blender-source-${suffix}.blend`,
      completeness: 'complete',
      knownOmissions: [],
    },
    control: { id: `matched-control-${suffix}`, sha256: controlHash },
    units: suffix === 'a' ? 'meters' : 'centimeters',
    semanticNames: {
      supportIds: [`neighbor-support-${suffix}`],
      attachmentIds: [`attachment-${suffix}`],
      insertionIds: [`insertion-${suffix}`],
      routedPathIds: [`route-${suffix}`],
      pathControlIds: [`control-a-${suffix}`, `control-b-${suffix}`, `control-c-${suffix}`],
      tendonIntervalIds: [`tendon-${suffix}`],
      bellyIntervalIds: [`belly-${suffix}`],
      wrapGuideIds: [`wrap-${suffix}`],
    },
    localFrames: [
      frame(`source-frame-${suffix}`, `blender-source-${suffix}`),
      frame(`attachment-frame-${suffix}`, `attachment-${suffix}`, [0.1, 0, 0]),
      frame(`insertion-frame-${suffix}`, `insertion-${suffix}`, [0.8, 0, 0]),
      frame(`camera-frame-${suffix}`, `camera-${suffix}`, [0, 1, 4]),
      frame(`wrap-frame-${suffix}`, `wrap-${suffix}`, [0.45, 0.1, 0]),
    ],
    attachments: [{
      id: `attachment-${suffix}`,
      insertionId: `insertion-${suffix}`,
      frameId: `attachment-frame-${suffix}`,
    }],
    insertions: [{ id: `insertion-${suffix}`, frameId: `insertion-frame-${suffix}` }],
    routedPaths: [{
      id: `route-${suffix}`,
      controlIds: [`control-a-${suffix}`, `control-b-${suffix}`, `control-c-${suffix}`],
      intervalIds: [`tendon-${suffix}`, `belly-${suffix}`],
      wrapGuideIds: [`wrap-${suffix}`],
    }],
    pathControls: [
      { id: `control-a-${suffix}`, pathId: `route-${suffix}`, frameId: `source-frame-${suffix}`, position: [0, 0, 0] },
      { id: `control-b-${suffix}`, pathId: `route-${suffix}`, frameId: `source-frame-${suffix}`, position: [0.4, 0.1, 0] },
      { id: `control-c-${suffix}`, pathId: `route-${suffix}`, frameId: `source-frame-${suffix}`, position: [0.8, 0, 0] },
    ],
    intervals: [
      {
        id: `tendon-${suffix}`,
        kind: 'tendon',
        pathId: `route-${suffix}`,
        startControlId: `control-a-${suffix}`,
        endControlId: `control-b-${suffix}`,
        startT: 0,
        endT: 0.35,
      },
      {
        id: `belly-${suffix}`,
        kind: 'belly',
        pathId: `route-${suffix}`,
        startControlId: `control-b-${suffix}`,
        endControlId: `control-c-${suffix}`,
        startT: 0.35,
        endT: 1,
      },
    ],
    wrapGuides: [{
      id: `wrap-${suffix}`,
      pathId: `route-${suffix}`,
      frameId: `wrap-frame-${suffix}`,
      geometrySha256: H(4),
    }],
    poseAuthority: { id: `external-pose-authority-${suffix}`, kind: 'external', sha256: H(5) },
    poses: {
      neutral: { id: `neutral-${suffix}`, sha256: H(6), authorityId: `external-pose-authority-${suffix}` },
      conservative: { id: `conservative-${suffix}`, sha256: H(7), authorityId: `external-pose-authority-${suffix}` },
      pairing: { neutralPoseId: `neutral-${suffix}`, conservativePoseId: `conservative-${suffix}` },
    },
    camera: {
      id: `camera-${suffix}`,
      sha256: H(8),
      frameId: `camera-frame-${suffix}`,
      fixed: true,
    },
    packing: {
      id: `packing-${suffix}`,
      sha256: H(9),
      behavior: suffix === 'a' ? 'declared-volume-preserving' : 'caller-defined-fiber-packing',
    },
    routingIntervention: {
      relationId: `route-relation-${suffix}`,
      routeToCastCouplingId: `route-to-cast-${suffix}`,
      sourceControlSha256: controlHash,
      conditionIds: {
        absent: 'deep_geometry_absent',
        correct: 'deep_geometry_correct_routing',
        wrongRoutingMatched: 'deep_geometry_wrong_routing_matched',
      },
      testedPathIds: [`route-${suffix}`],
      correct: {
        transformId: `correct-transform-${suffix}`,
        transformSha256: H(12),
        relationWitnessSha256: H(15),
        containsCorrectRouting: true,
      },
      wrongRoutingMatched: {
        transformId: `wrong-transform-${suffix}`,
        transformSha256: H(13),
        relationWitnessSha256: H(16),
        budgetWitnessSha256: H(17),
        destroysRoutingRelation: true,
        selectedBeforeOutputInspection: true,
      },
      absent: {
        transformId: `absent-transform-${suffix}`,
        transformSha256: H(14),
        kind: 'literal_absent',
      },
      matchedBudget: {
        ledgerSha256: H(18),
        fieldIds: [
          'primitiveCount',
          'curveCount',
          'controlCount',
          'crossSectionBudget',
          'routeLength',
          'occupiedVolume',
          'surfaceArea',
        ],
        correct: {
          primitiveCount: 1,
          curveCount: 1,
          controlCount: 3,
          crossSectionBudget: 0.2,
          routeLength: 0.9,
          occupiedVolume: 0.08,
          surfaceArea: 0.5,
        },
        wrongRoutingMatched: {
          primitiveCount: 1,
          curveCount: 1,
          controlCount: 3,
          crossSectionBudget: 0.2,
          routeLength: 0.9,
          occupiedVolume: 0.08,
          surfaceArea: 0.5,
        },
        tolerances: {
          primitiveCount: 0,
          curveCount: 0,
          controlCount: 0,
          crossSectionBudget: 0,
          routeLength: 0,
          occupiedVolume: 0,
          surfaceArea: 0,
        },
      },
    },
    neighboringSupports: [{
      id: `neighbor-support-${suffix}`,
      neutralLocalShapeSha256: supportShapeHash,
      conservativeLocalShapeSha256: supportShapeHash,
      independent: true,
    }],
    evidence: pending ? {
      status: 'pending',
    } : {
      status: 'complete',
      sourceSha256: sourceHash,
      controlSha256: controlHash,
      checks: {
        semanticNamesResolved: true,
        localFramesResolved: true,
        attachmentInsertionsResolved: true,
        routedPathsResolved: true,
        intervalsResolved: true,
        wrapGuidesResolved: true,
        posePairResolved: true,
        cameraFixed: true,
        packingBehaviorWitnessed: true,
        neighboringSupportsIndependent: true,
        containsCorrectRouting: true,
        destroysRoutingWithMatchedBudget: true,
      },
    },
  };
}

function codes(validation) {
  return validation.failures.map(failure => failure.code);
}

const dispositions = new Set([
  PASS_MUSCULATURE_SOURCE_ONLY,
  HOLD_MUSCULATURE_SOURCE_EVIDENCE,
  FAIL_MUSCULATURE_SOURCE,
]);

const receipt = makeReceipt();
const accepted = validateMusculatureSourceM0(receipt);
assert.equal(accepted.schema, MUSCULATURE_SOURCE_M0_VALIDATION_SCHEMA);
assert.equal(accepted.disposition, PASS_MUSCULATURE_SOURCE_ONLY, JSON.stringify(accepted, null, 2));
assert.equal(accepted.ok, true);
assert.deepEqual(accepted.failures, []);
assert.deepEqual(accepted.holds, []);
assert.match(accepted.receiptSha256, /^[0-9a-f]{64}$/);
assert.equal(accepted.sourceId, receipt.source.id);
assert.equal(accepted.controlId, receipt.control.id);
assert.deepEqual(accepted.preserved.semanticNames, receipt.semanticNames);
assert.deepEqual(accepted.preserved.pathControlIds, receipt.semanticNames.pathControlIds);

const callerVariant = makeReceipt({ suffix: 'b' });
const callerVariantResult = validateMusculatureSourceM0(callerVariant);
assert.equal(callerVariantResult.disposition, PASS_MUSCULATURE_SOURCE_ONLY);
assert.equal(callerVariantResult.preserved.units, 'centimeters');
assert.equal(callerVariantResult.preserved.packingBehaviorId, 'packing-b');

const absent = validateMusculatureSourceM0(null);
assert.equal(absent.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
assert.deepEqual(absent.failures, []);
assert.equal(absent.holds[0].code, 'musculature-source-receipt-missing');

const pending = makeReceipt({ pending: true });
pending.measurementStation = { status: 'passed' };
pending.cells = Array.from({ length: 6 }, (_, index) => ({ id: index, status: 'passed' }));
pending.compilerCompatibility = { status: 'passed' };
const pendingResult = validateMusculatureSourceM0(pending);
assert.equal(
  pendingResult.disposition,
  HOLD_MUSCULATURE_SOURCE_EVIDENCE,
  'station, six-cell, and compiler evidence cannot promote pending Track M source evidence',
);
assert.deepEqual(pendingResult.failures, []);

const incompleteSource = makeReceipt();
incompleteSource.source.completeness = 'incomplete';
incompleteSource.source.knownOmissions = ['belly interval witness is not exported'];
const incompleteSourceResult = validateMusculatureSourceM0(incompleteSource);
assert.equal(incompleteSourceResult.disposition, HOLD_MUSCULATURE_SOURCE_EVIDENCE);
assert.deepEqual(incompleteSourceResult.failures, []);
assert.equal(incompleteSourceResult.holds[0].code, 'musculature-exact-source-incomplete');

const relationalOnly = {
  track: { id: 'relational', kind: 'generator-relational-sensitivity' },
  measurementStation: { status: 'passed' },
  cells: Array.from({ length: 6 }, (_, index) => ({ id: index, status: 'passed' })),
  compilerCompatibility: { status: 'passed' },
};
const relationalOnlyResult = validateMusculatureSourceM0(relationalOnly);
assert.equal(relationalOnlyResult.disposition, FAIL_MUSCULATURE_SOURCE);
assert.ok(codes(relationalOnlyResult).includes('musculature-track-scope-mismatch'));

const mutations = [
  ['source/control identity', value => { value.source.sha256 = 'not-a-hash'; }, 'musculature-source-control-identity-invalid'],
  ['exact source path', value => { delete value.source.path; }, 'musculature-exact-source-receipt-invalid'],
  ['source completeness', value => { value.source.completeness = 'invented'; }, 'musculature-exact-source-receipt-invalid'],
  ['semantic name coverage', value => { value.semanticNames.attachmentIds = []; }, 'musculature-semantic-names-invalid'],
  ['local frame degeneracy', value => { value.localFrames[0].axes.y = [2, 0, 0]; }, 'musculature-local-frames-invalid'],
  ['attachment insertion binding', value => { value.attachments[0].insertionId = 'invented'; }, 'musculature-attachment-insertion-mismatch'],
  ['path control binding', value => { value.pathControls[0].pathId = 'invented'; }, 'musculature-path-controls-invalid'],
  ['interval ordering', value => { value.intervals[0].startT = 0.8; }, 'musculature-interval-invalid'],
  ['wrap identity', value => { value.wrapGuides[0].geometrySha256 = null; }, 'musculature-wrap-guides-invalid'],
  ['pose authority', value => { value.poses.conservative.authorityId = 'invented'; }, 'musculature-pose-pair-invalid'],
  ['fixed camera', value => { value.camera.fixed = false; }, 'musculature-camera-invalid'],
  ['packing declaration', value => { delete value.packing.behavior; }, 'musculature-packing-behavior-invalid'],
  ['tested route relation', value => { delete value.routingIntervention.relationId; }, 'musculature-routing-intervention-invalid'],
  ['condition identity', value => { value.routingIntervention.conditionIds.correct = 'deep_geometry_absent'; }, 'musculature-routing-intervention-invalid'],
  ['correct routing witness', value => { value.routingIntervention.correct.containsCorrectRouting = false; }, 'musculature-correct-routing-unproved'],
  ['correct routing witness identity', value => { delete value.routingIntervention.correct.relationWitnessSha256; }, 'musculature-correct-routing-unproved'],
  ['wrong routing destruction witness', value => { value.routingIntervention.wrongRoutingMatched.destroysRoutingRelation = false; }, 'musculature-wrong-routing-unproved'],
  ['wrong routing witness identity', value => { delete value.routingIntervention.wrongRoutingMatched.relationWitnessSha256; }, 'musculature-wrong-routing-unproved'],
  ['wrong routing budget witness identity', value => { delete value.routingIntervention.wrongRoutingMatched.budgetWitnessSha256; }, 'musculature-wrong-routing-unproved'],
  ['wrong route preregistration', value => { value.routingIntervention.wrongRoutingMatched.selectedBeforeOutputInspection = false; }, 'musculature-wrong-routing-unproved'],
  ['condition transform distinction', value => { value.routingIntervention.wrongRoutingMatched.transformSha256 = value.routingIntervention.correct.transformSha256; }, 'musculature-routing-transform-collision'],
  ['correct/wrong relation witness distinction', value => { value.routingIntervention.wrongRoutingMatched.relationWitnessSha256 = value.routingIntervention.correct.relationWitnessSha256; }, 'musculature-routing-witness-collision'],
  ['relation/budget witness distinction', value => { value.routingIntervention.wrongRoutingMatched.budgetWitnessSha256 = value.routingIntervention.correct.relationWitnessSha256; }, 'musculature-routing-witness-collision'],
  ['witness/ledger distinction', value => { value.routingIntervention.matchedBudget.ledgerSha256 = value.routingIntervention.wrongRoutingMatched.budgetWitnessSha256; }, 'musculature-routing-witness-collision'],
  ['matched routing budget', value => { value.routingIntervention.matchedBudget.wrongRoutingMatched.occupiedVolume = 0.2; }, 'musculature-routing-budget-unmatched'],
  ['matched routing budget ledger', value => { delete value.routingIntervention.matchedBudget.ledgerSha256; }, 'musculature-routing-budget-invalid'],
  ['negative routing tolerance', value => { value.routingIntervention.matchedBudget.tolerances.surfaceArea = -0.1; }, 'musculature-routing-budget-invalid'],
  ['neighbor independence', value => { value.neighboringSupports[0].conservativeLocalShapeSha256 = H(10); }, 'musculature-neighboring-support-independence-failed'],
  ['evidence source binding', value => { value.evidence.sourceSha256 = H(11); }, 'musculature-evidence-identity-mismatch'],
  ['evidence check', value => { value.evidence.checks.cameraFixed = false; }, 'musculature-evidence-check-failed'],
];

for (const [label, mutate, expectedCode] of mutations) {
  const value = makeReceipt();
  mutate(value);
  const result = validateMusculatureSourceM0(value);
  assert.equal(result.disposition, FAIL_MUSCULATURE_SOURCE, label);
  assert.ok(codes(result).includes(expectedCode), `${label}: ${JSON.stringify(result.failures)}`);
  assert.ok(dispositions.has(result.disposition));
}

assert.deepEqual(receipt, makeReceipt(), 'validation must not mutate the caller receipt');

process.stdout.write('musculature source M0 contracts passed\n');
