import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_MEASUREMENT_SCHEMA,
  MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESIDUAL_LEDGER_SCHEMA,
  MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESULT_SCHEMA,
  extractMuscleCompartmentRingCageBoundary,
  measureMuscleCompartmentRingCageContactState,
  measureMuscleCompartmentRingCageContactResidualLedger,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function centerlineShape(cage) {
  const axis = cage.manifest.nodes
    .filter(node => node.id.endsWith(':axis'))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(node => node.currentPosition);
  const turningAngles = [];
  for (let index = 1; index < axis.length - 1; index += 1) {
    const incoming = axis[index].map((value, coordinate) =>
      value - axis[index - 1][coordinate]);
    const outgoing = axis[index + 1].map((value, coordinate) =>
      value - axis[index][coordinate]);
    const incomingLength = Math.hypot(...incoming);
    const outgoingLength = Math.hypot(...outgoing);
    const cosine = incoming.reduce(
      (sum, value, coordinate) => sum + value * outgoing[coordinate],
      0,
    ) / (incomingLength * outgoingLength);
    turningAngles.push(Math.acos(Math.max(-1, Math.min(1, cosine))));
  }
  return {
    maximumTurningAngle: Math.max(0, ...turningAngles),
    totalTurningAngle: turningAngles.reduce((sum, value) => sum + value, 0),
  };
}

async function fixture() {
  return {
    carrier: JSON.parse(await readFile(path.join(
      REPO_ROOT,
      'artifacts/current-k4-ring-cage-admission-v0/solver-carrier.json',
    ), 'utf8')),
    source: JSON.parse(await readFile(path.join(
      REPO_ROOT,
      'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
    ), 'utf8')),
  };
}

test('tetrahedral incidence yields one closed deterministic boundary per current K4 cage', async () => {
  const { carrier } = await fixture();
  for (const cage of carrier.cages) {
    const boundary = extractMuscleCompartmentRingCageBoundary(cage.manifest);
    assert.equal(boundary.faceCount, 312);
    assert.equal(boundary.boundaryNodeIds.length, 158);
    assert.equal(boundary.interiorNodeIds.length, 11);
    assert.equal(boundary.fixedBoundaryNodeIds.length, 26);
    assert.equal(boundary.nonManifoldFaceCount, 0);
    assert.equal(boundary.closed, true);
    assert.deepEqual(
      extractMuscleCompartmentRingCageBoundary(structuredClone(cage.manifest)),
      boundary,
    );
  }
});

test('exact current K4 cage measurement exposes contact without losing volume or cell orientation', async () => {
  const { carrier, source } = await fixture();
  const measurement = measureMuscleCompartmentRingCageContactState(carrier, source);
  assert.equal(measurement.schema, MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_MEASUREMENT_SCHEMA);
  assert.equal(measurement.sourceCarrierSha256, carrier.identity.sha256);
  assert.equal(measurement.sourceInputSha256, source.input.effective.sha256);
  assert.equal(measurement.cages.length, 4);
  assert.ok(measurement.pairwise.penetratingBoundaryNodeCount > 0);
  assert.ok(measurement.pairwise.maximumPenetration > 0);
  assert.ok(measurement.skeletal.maximumPenetration > 0);
  assert.equal(measurement.compartment.maximumEscape, 0);
  for (const cage of measurement.cages) {
    assert.equal(cage.nonPositiveCellCount, 0);
    assert.ok(cage.referenceVolume > 0);
    assert.ok(cage.currentVolume > 0);
    assert.ok(cage.relativeVolumeError <= 1e-12);
    assert.equal(cage.boundaryFaceCount, 312);
  }
  assert.deepEqual(
    measureMuscleCompartmentRingCageContactState(
      structuredClone(carrier),
      structuredClone(source),
    ),
    measurement,
  );
});

test('contact measurement rejects a re-signed or reordered carrier/source mismatch', async () => {
  const { carrier, source } = await fixture();
  const tamperedCarrier = structuredClone(carrier);
  tamperedCarrier.cages[0].manifest.nodes[0].currentPosition[0] += 0.25;
  assert.throws(
    () => measureMuscleCompartmentRingCageContactState(tamperedCarrier, source),
    /solver carrier identity/i,
  );

  const reorderedSource = structuredClone(source);
  reorderedSource.muscles.reverse();
  assert.throws(
    () => measureMuscleCompartmentRingCageContactState(carrier, reorderedSource),
    /source input identity|construction order/i,
  );

  const contentTamperedSource = structuredClone(source);
  contentTamperedSource.obstacles[0].radius *= 10;
  assert.throws(
    () => measureMuscleCompartmentRingCageContactState(carrier, contentTamperedSource),
    /source input identity/i,
    'recorded source labels cannot authorize source content that no longer hashes to them',
  );

  const identityTamperedSource = structuredClone(source);
  identityTamperedSource.muscles[0].identity.instanceId = 'substituted-instance';
  assert.throws(
    () => measureMuscleCompartmentRingCageContactState(carrier, identityTamperedSource),
    /source input identity|source muscle identity/i,
    'carrier cages remain bound to the full source construction identity',
  );
});

test('reciprocal section contact materially reduces movable residuals without drifting fixed nodes', async () => {
  const { carrier, source } = await fixture();
  const requestedConfig = {
    curvatureRegularization: 12,
    maxIterations: 24,
    maximumLocalTurningAngleChange: 0.25,
    relaxationStep: 0.32,
    maximumTotalTurningAngleChange: 1.25,
    convergenceTolerance: 1e-4,
    maximumRelativeVolumeError: 0.015,
  };
  const result = solveMuscleCompartmentRingCageContact(
    carrier,
    source,
    requestedConfig,
  );
  assert.equal(result.schema, MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESULT_SCHEMA);
  assert.deepEqual(result.config.requested, requestedConfig);
  assert.deepEqual(result.config.effective, requestedConfig);
  assert.equal(result.config.fallbackUsed, false);
  assert.equal(result.fixedNodeMaximumDrift, 0);
  assert.equal(result.metrics.packed.compartment.maximumEscape, 0);
  assert.ok(result.metrics.initial.pairwise.movableTotalPenetration > 0);
  assert.ok(
    result.metrics.packed.pairwise.movableTotalPenetration <
      result.metrics.initial.pairwise.movableTotalPenetration * 0.65,
  );
  assert.ok(result.metrics.initial.skeletal.movableTotalPenetration > 0);
  assert.ok(
    result.metrics.packed.skeletal.movableTotalPenetration <
      result.metrics.initial.skeletal.movableTotalPenetration * 0.65,
  );
  assert.ok(result.metrics.packed.cages.every(cage => cage.nonPositiveCellCount === 0));
  assert.ok(result.metrics.packed.cages.every(
    cage => cage.relativeVolumeError <= requestedConfig.maximumRelativeVolumeError,
  ));
  const packedShape = result.packedCarrier.cages.map(centerlineShape);
  assert.ok(
    packedShape.every(shape => shape.maximumTurningAngle <= 0.25),
    `packed centerlines must not contain section-local hard elbows: ${JSON.stringify(packedShape)}`,
  );
  assert.ok(
    packedShape.every(shape => shape.totalTurningAngle <= 1.25),
    `packed centerlines must distribute bending instead of accumulating zig-zags: ${JSON.stringify(packedShape)}`,
  );
  assert.ok(result.iterations > 0 && result.iterations <= requestedConfig.maxIterations);
  assert.deepEqual(result.termination, {
    reason: 'iteration-limit',
    attemptedIteration: null,
    lineSearchAttempts: [],
  });
  assert.deepEqual(
    solveMuscleCompartmentRingCageContact(carrier, source, requestedConfig),
    result,
  );
});

test('long-horizon current K4 contact fails loud on the exact line-search custody ceiling', async () => {
  const { carrier, source } = await fixture();
  const requestedConfig = {
    curvatureRegularization: 12,
    maxIterations: 96,
    maximumLocalTurningAngleChange: 0.25,
    relaxationStep: 0.32,
    maximumTotalTurningAngleChange: 1.25,
    convergenceTolerance: 1e-4,
    maximumRelativeVolumeError: 0.015,
  };
  const result = solveMuscleCompartmentRingCageContact(
    carrier,
    source,
    requestedConfig,
  );

  assert.equal(result.status, 'residual-constraint');
  assert.equal(result.iterations, 80);
  assert.equal(result.termination.reason, 'line-search-exhausted');
  assert.equal(result.termination.attemptedIteration, 81);
  assert.equal(result.termination.lineSearchAttempts.length, 9);
  assert.equal(result.termination.lineSearchAttempts[0].scale, 0.32);
  assert.equal(result.termination.lineSearchAttempts.at(-1).scale, 0.00125);
  assert.ok(result.termination.lineSearchAttempts.every(attempt =>
    attempt.accepted === false && attempt.rejectionReasons.length > 0));
  assert.ok(result.termination.lineSearchAttempts.every(attempt =>
    attempt.rejectionReasons.includes('maximum-relative-volume-error')));
  assert.ok(result.termination.lineSearchAttempts.every(attempt =>
    attempt.maximumRelativeVolumeError > requestedConfig.maximumRelativeVolumeError));
  assert.ok(result.termination.lineSearchAttempts.every(attempt =>
    attempt.nonPositiveCellCount === 0 && attempt.compartmentMaximumEscape === 0));
});

test('curvature-6 challenger changes only regularization inside the extended-horizon comparison class', async () => {
  const selected = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'fixtures/current-k4-packing/current-k4-curvature-contact-volume-bound-v0.json',
  ), 'utf8'));
  const challenger = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'fixtures/current-k4-packing/current-k4-curvature-6-contact-volume-bound-v0.json',
  ), 'utf8'));
  const {
    curvatureRegularization: selectedRegularization,
    ...selectedComparisonClass
  } = selected;
  const {
    curvatureRegularization: challengerRegularization,
    ...challengerComparisonClass
  } = challenger;

  assert.equal(selectedRegularization, 12);
  assert.equal(challengerRegularization, 6);
  assert.deepEqual(challengerComparisonClass, selectedComparisonClass);
});

test('curvature challenger receipt binds the persistent dominant residual family to the anisotropy redirect', async () => {
  const comparison = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-curvature-6-contact-volume-bound-assay-v0/curvature-comparison.json',
  ), 'utf8'));

  assert.equal(comparison.schema, 'kaminos.current-k4-curvature-challenger-comparison.v0');
  assert.equal(comparison.status, 'completed');
  assert.equal(comparison.selected.curvatureRegularization, 12);
  assert.equal(comparison.challenger.curvatureRegularization, 6);
  assert.equal(comparison.comparisonClass.onlyRegularizationChanged, true);
  assert.equal(comparison.comparisonClass.sameSourceInputIdentity, true);
  assert.equal(comparison.comparisonClass.sameConstructionOrder, true);
  assert.equal(comparison.residualFamily.sameDominantMovableDirectedPair, true);
  assert.equal(comparison.residualFamily.selected.dominantMovableDirectedPair.pair,
    'muscle-12->muscle-45');
  assert.equal(comparison.residualFamily.challenger.dominantMovableDirectedPair.pair,
    'muscle-12->muscle-45');
  assert.equal(comparison.residualFamily.sameDominantFixedDirectedPair, true);
  assert.equal(comparison.residualFamily.selected.dominantFixedDirectedPair.pair,
    'muscle-34->muscle-45');
  assert.equal(comparison.residualFamily.challenger.dominantFixedDirectedPair.pair,
    'muscle-34->muscle-45');
  assert.equal(comparison.residualFamily.sameSkeletalContactCount, true);
  assert.equal(comparison.visual.selected.routeVerificationStatus, 'verified');
  assert.equal(comparison.visual.challenger.routeVerificationStatus, 'verified');
  assert.equal(comparison.visual.selected.inspectionStatus,
    'inspected-volume-bound-pressure-localization');
  assert.equal(comparison.visual.challenger.inspectionStatus, 'agent-inspected');
  assert.equal(comparison.decision.classification,
    'dominant-residual-family-persists-under-curvature-challenger');
  assert.equal(comparison.decision.nextAssay,
    'constant-area-cross-section-anisotropy');
});

test('selected current K4 carrier exposes an exact source-linked residual contact ledger', async () => {
  const { source } = await fixture();
  const carrier = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-curvature-contact-pareto-sweep-v0/candidates/curvature-12/packed-carrier.json',
  ), 'utf8'));
  const measurement = measureMuscleCompartmentRingCageContactState(carrier, source);
  const ledger = measureMuscleCompartmentRingCageContactResidualLedger(carrier, source);

  assert.equal(ledger.schema, MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESIDUAL_LEDGER_SCHEMA);
  assert.equal(ledger.sourceCarrierSha256, carrier.identity.sha256);
  assert.equal(ledger.sourceInputSha256, source.input.effective.sha256);
  assert.ok(ledger.pairwise.contacts.length > 0);
  assert.ok(ledger.skeletal.contacts.length > 0);
  assert.deepEqual(ledger.orderedConstructionIds, carrier.orderedConstructionIds);

  for (const contact of ledger.pairwise.contacts) {
    assert.equal(contact.kind, 'pairwise-boundary-inside-cage');
    assert.match(contact.nodeId, new RegExp(`^${contact.subjectConstructionId}:section:`));
    assert.match(contact.sectionId, new RegExp(`^${contact.subjectConstructionId}:section:`));
    assert.ok(carrier.orderedConstructionIds.includes(contact.subjectConstructionId));
    assert.ok(carrier.orderedConstructionIds.includes(contact.obstacleConstructionId));
    assert.ok(contact.penetration > 0);
    assert.equal(contact.point.length, 3);
    assert.equal(contact.closestObstacleBoundaryPoint.length, 3);
  }
  for (const contact of ledger.skeletal.contacts) {
    assert.ok([
      'cage-boundary-inside-capsule-clearance',
      'capsule-axis-inside-cage-clearance',
    ].includes(contact.kind));
    assert.equal(contact.obstacleId, 'agent-authored-k4-central-pressure-capsule');
    assert.ok(contact.penetration > 0);
  }

  const pairwiseFixed = ledger.pairwise.contacts
    .filter(contact => contact.fixed)
    .map(contact => contact.penetration);
  const pairwiseMovable = ledger.pairwise.contacts
    .filter(contact => !contact.fixed)
    .map(contact => contact.penetration);
  assert.equal(ledger.pairwise.fixedTotalPenetration,
    pairwiseFixed.reduce((sum, value) => sum + value, 0));
  assert.equal(ledger.pairwise.fixedMaximumPenetration, Math.max(0, ...pairwiseFixed));
  assert.equal(ledger.pairwise.movableTotalPenetration,
    pairwiseMovable.reduce((sum, value) => sum + value, 0));
  assert.equal(ledger.pairwise.movableMaximumPenetration, Math.max(0, ...pairwiseMovable));
  assert.equal(ledger.pairwise.fixedTotalPenetration,
    measurement.pairwise.fixedTotalPenetration);
  assert.equal(ledger.pairwise.movableTotalPenetration,
    measurement.pairwise.movableTotalPenetration);
  assert.equal(ledger.pairwise.movableMaximumPenetration,
    measurement.pairwise.movableMaximumPenetration);

  const skeletalFixed = ledger.skeletal.contacts
    .filter(contact => contact.fixed)
    .map(contact => contact.penetration);
  const skeletalMovable = ledger.skeletal.contacts
    .filter(contact => !contact.fixed)
    .map(contact => contact.penetration);
  assert.equal(ledger.skeletal.fixedTotalPenetration,
    skeletalFixed.reduce((sum, value) => sum + value, 0));
  assert.equal(ledger.skeletal.movableTotalPenetration,
    skeletalMovable.reduce((sum, value) => sum + value, 0));
  assert.equal(ledger.skeletal.movableMaximumPenetration,
    Math.max(0, ...skeletalMovable));
  assert.equal(ledger.skeletal.fixedTotalPenetration,
    measurement.skeletal.fixedTotalPenetration);
  assert.equal(ledger.skeletal.movableTotalPenetration,
    measurement.skeletal.movableTotalPenetration);
  assert.equal(ledger.skeletal.movableMaximumPenetration,
    measurement.skeletal.movableMaximumPenetration);

  assert.deepEqual(
    measureMuscleCompartmentRingCageContactResidualLedger(
      structuredClone(carrier),
      structuredClone(source),
    ),
    ledger,
  );
});
