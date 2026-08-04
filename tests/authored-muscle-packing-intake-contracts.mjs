import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  AUTHORED_MUSCLE_PACKING_COORDINATE_CARRIER_SCHEMA,
  AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA,
  admitAuthoredMusclePackingIntake,
} from '../authored-muscle-packing-intake-core.mjs';
import { solveMuscleCompartmentPacking } from '../muscle-compartment-packing-core.mjs';

const fixturePath = new URL(
  '../fixtures/track-m-routing/m31-m47-routing-fixture.json',
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const left = centerline[index];
    const right = centerline[index + 1];
    const length = Math.hypot(...left.position.map(
      (value, axis) => value - right.position[axis],
    ));
    volume += Math.PI * length / 3 * (
      left.radius ** 2 + left.radius * right.radius + right.radius ** 2
    );
  }
  return volume;
}

function interpolate(left, right, amount) {
  return left.map((value, axis) => value + (right[axis] - value) * amount);
}

function makeCoordinateCarrier() {
  const routes = fixture.conditions.correct.routes;
  const muscles = routes.map((route, routeIndex) => {
    const centerline = [0, 1 / 3, 2 / 3, 1].map((amount, knotIndex) => ({
      position: interpolate(route.origin.point, route.insertion.point, amount).map(
        (value, axis) => value + (knotIndex === 1 || knotIndex === 2
          ? (routeIndex === 0 ? -0.35 : 0.35) * (axis === 0 ? 1 : 0)
          : 0),
      ),
      radius: knotIndex === 0 || knotIndex === 3 ? 0.18 : 0.32,
    }));
    return {
      constructionId: route.constructionId,
      lineageId: route.lineageId,
      instanceId: route.instanceId,
      surfaceInstanceId: route.components.surfaceInstanceId,
      surfaceGeometrySha256: route.components.surfaceGeometrySha256,
      pathInstanceId: route.components.pathInstanceId,
      pathGeometrySha256: route.components.pathGeometrySha256,
      attachments: {
        origin: {
          id: route.origin.assignedHandleInstanceId,
          sourceAuthority: route.origin.sourceAuthority,
          position: route.origin.point,
        },
        insertion: {
          id: route.insertion.assignedHandleInstanceId,
          sourceAuthority: route.insertion.sourceAuthority,
          position: route.insertion.point,
        },
      },
      centerline,
      targetVolume: carrierVolume(centerline),
      volumeAuthority: 'byte-bound-surface-derived',
    };
  });
  return {
    schema: AUTHORED_MUSCLE_PACKING_COORDINATE_CARRIER_SCHEMA,
    id: 'm31-m47-test-coordinate-carrier-v0',
    source: {
      assetSha256: fixture.source.assetSha256,
      graphSha256: fixture.source.graphSha256,
      graphFileSha256: fixture.source.graphFileSha256,
      routingFixtureSha256: fixture.fixtureSha256,
    },
    coordinateSpace: {
      kind: 'source-world',
      dimension: 3,
      unit: 'blender-scene-unit',
    },
    compartment: {
      id: 'm31-m47-local-compartment',
      kind: 'box',
      minimum: [3, -4, 8],
      maximum: [11, 13, 27],
      clearance: 0,
    },
    obstacles: [{
      id: 'test-skeletal-shaft',
      kind: 'capsule',
      start: [6.7, -3, 11],
      end: [6.7, 12, 24],
      radius: 0.2,
      clearance: 0.05,
      sourceAuthority: 'byte-bound-skeletal-clearance-proxy',
    }],
    muscles,
  };
}

function intakeIdentity(coordinateCarrier = null) {
  return {
    routingFixture: {
      requested: { kind: 'track-m-routing-fixture', id: fixture.selection.id, sha256: HASH_A },
      effective: { kind: 'track-m-routing-fixture', id: fixture.selection.id, sha256: HASH_A },
    },
    coordinateCarrier: coordinateCarrier && {
      requested: { kind: 'authored-coordinate-carrier', id: coordinateCarrier.id, sha256: HASH_B },
      effective: { kind: 'authored-coordinate-carrier', id: coordinateCarrier.id, sha256: HASH_B },
    },
  };
}

test('identity-coherent M31/M47 fixture fails loud when packing geometry is unavailable', () => {
  const receipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: null,
    input: intakeIdentity(),
  });

  assert.equal(receipt.schema, AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA);
  assert.equal(receipt.status, 'identity-coherent_geometry-unavailable');
  assert.equal(receipt.admitted, false);
  assert.equal(receipt.packingSource, null);
  assert.deepEqual(receipt.source, {
    assetSha256: fixture.source.assetSha256,
    graphSha256: fixture.source.graphSha256,
    graphFileSha256: fixture.source.graphFileSha256,
    routingFixtureSha256: fixture.fixtureSha256,
  });
  assert.deepEqual(receipt.acceptedFields, [
    'source.assetSha256',
    'source.graphSha256',
    'source.graphFileSha256',
    'source.routingFixtureSha256',
    'muscles[].constructionId',
    'muscles[].lineageId',
    'muscles[].instanceId',
    'muscles[].surfaceInstanceId',
    'muscles[].surfaceGeometrySha256',
    'muscles[].pathInstanceId',
    'muscles[].pathGeometrySha256',
    'muscles[].attachments.origin',
    'muscles[].attachments.insertion',
  ]);
  assert.deepEqual(receipt.missingFields, [
    'coordinateCarrier.coordinateSpace',
    'coordinateCarrier.compartment',
    'coordinateCarrier.obstacles',
    'coordinateCarrier.muscles[].centerline',
    'coordinateCarrier.muscles[].targetVolume',
    'coordinateCarrier.muscles[].volumeAuthority',
  ]);
  assert.match(receipt.receiptSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    admitAuthoredMusclePackingIntake({
      routingFixture: fixture,
      coordinateCarrier: null,
      input: intakeIdentity(),
    }),
    receipt,
    'the same identity-only input must produce a byte-stable receipt',
  );
});

test('complete world-space carrier is admitted only when every route identity remains exact', () => {
  const coordinateCarrier = makeCoordinateCarrier();
  const receipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier,
    input: intakeIdentity(coordinateCarrier),
  });

  assert.equal(receipt.status, 'admitted');
  assert.equal(receipt.admitted, true);
  assert.deepEqual(receipt.missingFields, []);
  assert.equal(receipt.packingSource.authority.kind, 'operator-authored');
  assert.equal(receipt.packingSource.authority.anatomicalAdmission, 'geometric-only');
  assert.equal(receipt.packingSource.muscles.length, 2);
  assert.deepEqual(
    receipt.packingSource.muscles.map(muscle => muscle.identity.constructionId),
    ['muscle-31', 'muscle-47'],
  );
  assert.doesNotThrow(() => solveMuscleCompartmentPacking(receipt.packingSource, {
    maxIterations: 1,
    relaxationStep: 0.01,
    smoothnessStep: 0.001,
    sampleCount: 5,
    convergenceTolerance: 1e-7,
  }));

  const mismatched = structuredClone(coordinateCarrier);
  mismatched.muscles[0].instanceId = 'instance-wrong-source-identity';
  const rejected = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: mismatched,
    input: intakeIdentity(mismatched),
  });
  assert.equal(rejected.status, 'source-identity-mismatch');
  assert.equal(rejected.admitted, false);
  assert.equal(rejected.packingSource, null);
  assert.match(rejected.reason, /muscle-31.*instanceId/i);
});

test('requested and effective carrier identity disagreement cannot look admitted', () => {
  const coordinateCarrier = makeCoordinateCarrier();
  const input = intakeIdentity(coordinateCarrier);
  input.coordinateCarrier.effective.sha256 = 'c'.repeat(64);
  const receipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier,
    input,
  });
  assert.equal(receipt.status, 'input-identity-mismatch');
  assert.equal(receipt.admitted, false);
  assert.equal(receipt.packingSource, null);
  assert.match(receipt.reason, /requested.*effective/i);
});

test('authored geometry cannot omit the skeletal clearance witness or source-world unit', () => {
  const noSkeleton = makeCoordinateCarrier();
  noSkeleton.obstacles = [];
  const noSkeletonReceipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: noSkeleton,
    input: intakeIdentity(noSkeleton),
  });
  assert.equal(noSkeletonReceipt.status, 'geometry-invalid');
  assert.match(noSkeletonReceipt.reason, /skeletal.*obstacle/i);

  const noUnit = makeCoordinateCarrier();
  noUnit.coordinateSpace.unit = '';
  const noUnitReceipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: noUnit,
    input: intakeIdentity(noUnit),
  });
  assert.equal(noUnitReceipt.status, 'geometry-invalid');
  assert.match(noUnitReceipt.reason, /source-world.*unit/i);
});
