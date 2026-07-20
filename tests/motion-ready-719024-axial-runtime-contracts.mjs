import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MOTION_READY_719024_CAST_ID,
  MOTION_READY_719024_DEFORMATION_MODE,
  createAxialGeometryBinding,
  createAxialSquirmState,
  deformAxialGeometryBinding,
  deformAxialPoint,
  samplePolylineRoute,
  stepAxialSquirmController,
  validateAxialCrawlerRegistration,
} from '../motion-ready-719024-core.js';

const root = new URL('../artifacts/motion-ready-719024/', import.meta.url);
const registration = JSON.parse(await readFile(new URL('registration.json', root), 'utf8'));

assert.equal(MOTION_READY_719024_CAST_ID, 'motion-ready-719024');
assert.equal(MOTION_READY_719024_DEFORMATION_MODE, 'axial-parallel-transport-wave-v0');

const normalized = validateAxialCrawlerRegistration(registration);
assert.equal(normalized.spineStations.length, 7);
assert.equal(normalized.tailZ, 0.47);
assert.equal(normalized.headZ, -0.47);
assert.equal(normalized.contactPlaneY, -0.2068822681903839);

assert.throws(
  () => validateAxialCrawlerRegistration({ ...registration, localForwardAxis: [1, 0, 0] }),
  /local forward axis must be -Z/,
);

const route = [
  [-2, 0.1, -1],
  [-0.5, 0.35, -0.25],
  [1.25, 0.2, 0.5],
  [2.5, 0.45, 1.5],
];
const early = samplePolylineRoute(route, 0.2);
const late = samplePolylineRoute(route, 0.8);
assert.ok(late.distance > early.distance, 'route travel must advance monotonically');
assert.ok(Math.hypot(...early.forward) > 0.999, 'route heading must be normalized');
assert.ok(Number.isFinite(early.position[1]), 'route sampling must retain terrain height');

let controller = stepAxialSquirmController(null, {
  deltaSeconds: 1 / 60,
  routeSpeed: 0.72,
  elapsedSeconds: 0,
});
for (let frame = 1; frame <= 90; frame++) {
  controller = stepAxialSquirmController(controller, {
    deltaSeconds: 1 / 60,
    routeSpeed: 0.72,
    elapsedSeconds: frame / 60,
  });
}
assert.ok(controller.amplitude > 0.055, 'moving cast must develop a visible axial wave');

for (let frame = 0; frame < 240; frame++) {
  controller = stepAxialSquirmController(controller, {
    deltaSeconds: 1 / 60,
    routeSpeed: 0,
    elapsedSeconds: 1.5 + frame / 60,
  });
}
assert.ok(controller.amplitude < 0.0025, 'stationary cast must visibly settle');
assert.ok(controller.phaseVelocity < 0.08, 'stationary cast phase must settle instead of swimming in place');

const activeState = createAxialSquirmState({
  amplitude: 0.075,
  phase: 1.1,
  phaseVelocity: 5.2,
  verticalAmplitude: 0.018,
});
const pointA = [0.12, -0.08, 0.08];
const pointB = [-0.07, 0.11, 0.08];
const deformedA = deformAxialPoint(pointA, normalized, activeState);
const deformedB = deformAxialPoint(pointB, normalized, activeState);
const originalCrossSectionDistance = Math.hypot(pointA[0] - pointB[0], pointA[1] - pointB[1]);
const deformedCrossSectionDistance = Math.hypot(
  deformedA[0] - deformedB[0],
  deformedA[1] - deformedB[1],
  deformedA[2] - deformedB[2],
);
assert.ok(
  Math.abs(deformedCrossSectionDistance - originalCrossSectionDistance) < 1e-6,
  'vertices sharing an axial station must preserve their X/Y cross-section distance',
);

const originalPositions = new Float32Array([
  ...pointA,
  ...pointB,
  0.03, -0.02, normalized.spineStations[5].localPosition[2],
]);
const originalNormals = new Float32Array([
  1, 0, 0,
  0, 1, 0,
  0, 0, -1,
]);
const outputPositions = new Float32Array(originalPositions.length);
const outputNormals = new Float32Array(originalNormals.length);
const binding = createAxialGeometryBinding(originalPositions, originalNormals, normalized, { segments: 96 });
assert.equal(binding.vertexCount, 3, 'batch binding records every vertex');
assert.equal(binding.segments, 96, 'batch binding preserves requested axial resolution');
deformAxialGeometryBinding(binding, activeState, outputPositions, outputNormals);
for (let vertex = 0; vertex < binding.vertexCount; vertex++) {
  const offset = vertex * 3;
  const scalar = deformAxialPoint(
    [originalPositions[offset], originalPositions[offset + 1], originalPositions[offset + 2]],
    normalized,
    activeState,
  );
  assert.ok(
    Math.hypot(
      scalar[0] - outputPositions[offset],
      scalar[1] - outputPositions[offset + 1],
      scalar[2] - outputPositions[offset + 2],
    ) < 2e-4,
    `batch position ${vertex} matches scalar deformation`,
  );
  assert.ok(
    Math.abs(Math.hypot(outputNormals[offset], outputNormals[offset + 1], outputNormals[offset + 2]) - 1) < 2e-5,
    `batch normal ${vertex} remains normalized`,
  );
}

const stationOffsets = normalized.spineStations.map(station =>
  deformAxialPoint(station.localPosition, normalized, activeState),
);
for (let index = 1; index < stationOffsets.length; index++) {
  const previous = stationOffsets[index - 1];
  const current = stationOffsets[index];
  assert.ok(
    Math.hypot(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]) < 0.24,
    'adjacent spine stations must remain continuous',
  );
}

console.log('motion-ready-719024 axial runtime contracts passed');
