import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function fixturePayload(routingFixture) {
  const {
    fixtureSha256: ignoredFixtureIdentity,
    schema: ignoredEnvelopeSchema,
    ...payload
  } = routingFixture;
  return payload;
}

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

function makeCoordinateCarrier(routingFixture = fixture, {
  atlasId = 'cat-armature-001-complete-route-atlas-v0',
  atlasSha256 = 'c'.repeat(64),
  carrierId = 'm31-m47-test-coordinate-carrier-v0',
} = {}) {
  const routes = routingFixture.conditions.correct.routes;
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
    id: carrierId,
    derivation: {
      kind: 'atlas-route-subset',
      atlas: {
        id: atlasId,
        sha256: atlasSha256,
      },
      selectedConstructionIds: routes.map(route => route.constructionId),
      selectionAuthority: {
        receipt: {
          id: `${carrierId}-authority-receipt`,
          sha256: 'd'.repeat(64),
        },
        sharedFields: {
          'coordinateSpace.unit': 'admitted',
          compartment: 'admitted',
          obstacles: 'admitted',
        },
        rows: routes.map(route => ({
          constructionId: route.constructionId,
          state: 'admitted',
          requiredFields: {
            'attachments.origin.position': 'admitted',
            'attachments.insertion.position': 'admitted',
            centerline: 'admitted',
            targetVolume: 'admitted',
            volumeAuthority: 'admitted',
          },
        })),
      },
    },
    source: {
      assetSha256: routingFixture.source.assetSha256,
      graphSha256: routingFixture.source.graphSha256,
      graphFileSha256: routingFixture.source.graphFileSha256,
      routingFixtureSha256: routingFixture.fixtureSha256,
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

function intakeIdentity(coordinateCarrier = null, routingFixture = fixture) {
  return {
    routingFixture: {
      requested: { kind: 'track-m-routing-fixture', id: routingFixture.selection.id, sha256: HASH_A },
      effective: { kind: 'track-m-routing-fixture', id: routingFixture.selection.id, sha256: HASH_A },
    },
    coordinateCarrier: coordinateCarrier && {
      requested: { kind: 'authored-coordinate-carrier', id: coordinateCarrier.id, sha256: HASH_B },
      effective: { kind: 'authored-coordinate-carrier', id: coordinateCarrier.id, sha256: HASH_B },
    },
  };
}

function makeAtlasRoute(index) {
  const route = structuredClone(fixture.conditions.correct.routes[index % 2]);
  const suffix = String(index + 1).padStart(2, '0');
  route.constructionId = `atlas-muscle-${suffix}`;
  route.lineageId = `atlas-lineage-${suffix}`;
  route.instanceId = `atlas-instance-${suffix}`;
  route.name = `Atlas Muscle ${suffix}`;
  route.components.surfaceInstanceId = `atlas-surface-${suffix}`;
  route.components.surfaceGeometrySha256 = hashJson(['surface', suffix]);
  route.components.pathInstanceId = `atlas-path-${suffix}`;
  route.components.pathGeometrySha256 = hashJson(['path', suffix]);
  route.origin.assignedFromConstructionId = route.constructionId;
  route.origin.assignedHandleInstanceId = `atlas-origin-${suffix}`;
  route.origin.authoredHandleInstanceId = route.origin.assignedHandleInstanceId;
  route.origin.point = [4 + index * 0.45, -2.5 + index * 0.08, 10 + index * 0.2];
  route.insertion.assignedFromConstructionId = route.constructionId;
  route.insertion.assignedHandleInstanceId = `atlas-insertion-${suffix}`;
  route.insertion.authoredHandleInstanceId = route.insertion.assignedHandleInstanceId;
  route.insertion.point = [5 + index * 0.5, 10.5 + index * 0.1, 21.5 + index * 0.3];
  return route;
}

function makeSubsetFixture(atlasRoutes, selectedIndices, id) {
  const routingFixture = structuredClone(fixture);
  const selectedRoutes = selectedIndices.map(index => structuredClone(atlasRoutes[index]));
  routingFixture.selection = {
    ...routingFixture.selection,
    id,
    correctConstructionId: selectedRoutes[0].constructionId,
    crossWireDonorConstructionId: selectedRoutes[1].constructionId,
    nullConstructionIds: [],
  };
  routingFixture.conditions.correct.routes = selectedRoutes;
  routingFixture.fixtureSha256 = hashJson(fixturePayload(routingFixture));
  return routingFixture;
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
    'coordinateCarrier.derivation',
    'coordinateCarrier.derivation.selectionAuthority',
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
  assert.deepEqual(receipt.packingSource.formation, {
    centerlineSmoothingReference: 'source-displacement',
  }, 'authored intake must retain source-relative formation instead of silently using absolute smoothing');
  assert.deepEqual(receipt.packingSource.derivation, coordinateCarrier.derivation);
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

test('fixture-specific geometry cannot omit reusable atlas derivation provenance', () => {
  const missingDerivation = makeCoordinateCarrier();
  delete missingDerivation.derivation;
  const missingReceipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: missingDerivation,
    input: intakeIdentity(missingDerivation),
  });
  assert.equal(missingReceipt.status, 'geometry-invalid');
  assert.equal(missingReceipt.admitted, false);
  assert.match(missingReceipt.reason, /atlas.*derivation/i);

  const wrongSubset = makeCoordinateCarrier();
  wrongSubset.derivation.selectedConstructionIds = ['muscle-47', 'muscle-31'];
  const wrongSubsetReceipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: wrongSubset,
    input: intakeIdentity(wrongSubset),
  });
  assert.equal(wrongSubsetReceipt.status, 'source-identity-mismatch');
  assert.equal(wrongSubsetReceipt.admitted, false);
  assert.match(wrongSubsetReceipt.reason, /selected construction ids.*route set/i);
});

test('candidate selected rows cannot pass as an admitted packing carrier', () => {
  const candidateCarrier = makeCoordinateCarrier();
  candidateCarrier.derivation.selectionAuthority.rows[0].state = 'candidate';
  candidateCarrier.source.graphSha256 = 'd'.repeat(64);
  candidateCarrier.source.graphFileSha256 = 'e'.repeat(64);

  const receipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: candidateCarrier,
    input: intakeIdentity(candidateCarrier),
  });

  assert.equal(receipt.status, 'authority-incomplete');
  assert.equal(receipt.admitted, false);
  assert.equal(receipt.packingSource, null);
  assert.match(receipt.reason, /muscle-31.*candidate/i);
  assert.deepEqual(
    receipt.acceptedFields,
    [],
    'an early authority refusal cannot claim that later source/carrier comparisons passed',
  );
});

test('selected-row admission requires a byte-bound receipt and every required solve field', () => {
  const missingReceipt = makeCoordinateCarrier();
  delete missingReceipt.derivation.selectionAuthority;
  const missingReceiptResult = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: missingReceipt,
    input: intakeIdentity(missingReceipt),
  });
  assert.equal(missingReceiptResult.status, 'authority-incomplete');
  assert.deepEqual(missingReceiptResult.missingFields, [
    'coordinateCarrier.derivation.selectionAuthority',
  ]);

  const candidateCenterline = makeCoordinateCarrier();
  candidateCenterline.derivation.selectionAuthority.rows[1]
    .requiredFields.centerline = 'candidate';
  const candidateCenterlineResult = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: candidateCenterline,
    input: intakeIdentity(candidateCenterline),
  });
  assert.equal(candidateCenterlineResult.status, 'authority-incomplete');
  assert.match(candidateCenterlineResult.reason, /muscle-47.*centerline.*candidate/i);

  const conflictingCompartment = makeCoordinateCarrier();
  conflictingCompartment.derivation.selectionAuthority.sharedFields.compartment = 'conflict';
  const conflictingCompartmentResult = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: conflictingCompartment,
    input: intakeIdentity(conflictingCompartment),
  });
  assert.equal(conflictingCompartmentResult.status, 'source-to-carrier-binding-invalid');
  assert.equal(conflictingCompartmentResult.admitted, false);
  assert.equal(conflictingCompartmentResult.packingSource, null);
  assert.match(conflictingCompartmentResult.reason, /compartment.*conflict/i);
  assert.deepEqual(conflictingCompartmentResult.conflictingFields, [
    'coordinateCarrier.derivation.selectionAuthority.sharedFields.compartment',
  ]);

  const conflictingCenterline = makeCoordinateCarrier();
  conflictingCenterline.derivation.selectionAuthority.rows[0]
    .requiredFields.centerline = 'conflict';
  const conflictingCenterlineResult = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: conflictingCenterline,
    input: intakeIdentity(conflictingCenterline),
  });
  assert.equal(conflictingCenterlineResult.status, 'source-to-carrier-binding-invalid');
  assert.match(conflictingCenterlineResult.reason, /muscle-31.*centerline.*conflict/i);
  assert.deepEqual(conflictingCenterlineResult.conflictingFields, [
    'coordinateCarrier.derivation.selectionAuthority.rows[muscle-31].requiredFields.centerline',
  ]);
});

test('selected-row authority receipt preserves exact fixture route order', () => {
  const wrongOrder = makeCoordinateCarrier();
  wrongOrder.derivation.selectionAuthority.rows.reverse();
  const receipt = admitAuthoredMusclePackingIntake({
    routingFixture: fixture,
    coordinateCarrier: wrongOrder,
    input: intakeIdentity(wrongOrder),
  });
  assert.equal(receipt.status, 'source-identity-mismatch');
  assert.match(receipt.reason, /authority construction ids.*route set/i);
});

test('two arbitrary non-M31/M47 atlas subsets feed the generic intake deterministically', () => {
  const atlasRoutes = Array.from({ length: 6 }, (_, index) => makeAtlasRoute(index));
  const atlasId = 'synthetic-complete-route-atlas-v0';
  const atlasSha256 = hashJson({ schema: atlasId, routes: atlasRoutes });
  const subsetCases = [
    { id: 'atlas-subset-two-v0', selectedIndices: [5, 1] },
    { id: 'atlas-subset-four-v0', selectedIndices: [2, 0, 4, 3] },
  ];

  for (const subsetCase of subsetCases) {
    const routingFixture = makeSubsetFixture(
      atlasRoutes,
      subsetCase.selectedIndices,
      subsetCase.id,
    );
    const coordinateCarrier = makeCoordinateCarrier(routingFixture, {
      atlasId,
      atlasSha256,
      carrierId: `${subsetCase.id}-coordinate-carrier`,
    });
    const input = intakeIdentity(coordinateCarrier, routingFixture);
    const admitted = admitAuthoredMusclePackingIntake({
      routingFixture,
      coordinateCarrier,
      input,
    });

    assert.equal(admitted.status, 'admitted');
    assert.equal(admitted.admitted, true);
    assert.deepEqual(admitted.packingSource.derivation, coordinateCarrier.derivation);
    assert.deepEqual(
      admitted.packingSource.muscles.map(muscle => muscle.identity.constructionId),
      routingFixture.conditions.correct.routes.map(route => route.constructionId),
    );
    assert.deepEqual(
      admitted.packingSource.muscles.map(muscle => muscle.attachments.origin.position),
      routingFixture.conditions.correct.routes.map(route => route.origin.point),
    );
    assert.deepEqual(
      admitAuthoredMusclePackingIntake({ routingFixture, coordinateCarrier, input }),
      admitted,
      `${subsetCase.id} must produce a byte-stable intake receipt`,
    );
    assert.doesNotThrow(() => solveMuscleCompartmentPacking(admitted.packingSource, {
      maxIterations: 1,
      relaxationStep: 0.01,
      smoothnessStep: 0.001,
      sampleCount: 5,
      convergenceTolerance: 1e-7,
    }));
  }
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
