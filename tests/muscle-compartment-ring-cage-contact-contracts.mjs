import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_MEASUREMENT_SCHEMA,
  MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_RESULT_SCHEMA,
  extractMuscleCompartmentRingCageBoundary,
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);

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
    maxIterations: 24,
    relaxationStep: 0.32,
    smoothness: 0.18,
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
  assert.ok(result.iterations > 0 && result.iterations <= requestedConfig.maxIterations);
  assert.deepEqual(
    solveMuscleCompartmentRingCageContact(carrier, source, requestedConfig),
    result,
  );
});
