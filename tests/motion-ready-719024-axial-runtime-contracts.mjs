import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MOTION_READY_719024_CAST_ID,
  MOTION_READY_719024_DEFORMATION_MODE,
  createAxialGeometryBinding,
  createAxialSquirmState,
  deformAxialGeometryBinding,
  deformAxialPoint,
  sampleHillTerrainSurface,
  samplePolylineRoute,
  solveAxialTerrainSupportEnvelope,
  stepAxialSquirmController,
  validateAxialCrawlerRegistration,
} from '../motion-ready-719024-core.js';

const root = new URL('../artifacts/motion-ready-719024/', import.meta.url);
const registration = JSON.parse(await readFile(new URL('registration.json', root), 'utf8'));

assert.equal(MOTION_READY_719024_CAST_ID, 'motion-ready-719024');
assert.equal(MOTION_READY_719024_DEFORMATION_MODE, 'axial-parallel-transport-wave-v1');

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

const cadenceRuns = [
  [
    { deltaSeconds: 1 / 30, routeSpeed: 0.41, routeDistance: 0.11 },
    { deltaSeconds: 1 / 120, routeSpeed: 1.9, routeDistance: 0.37 },
    { deltaSeconds: 1 / 24, routeSpeed: 0.18, routeDistance: 0.82 },
  ],
  [
    { deltaSeconds: 1 / 144, routeSpeed: 3.7, routeDistance: 0.29 },
    { deltaSeconds: 1 / 55, routeSpeed: 0.08, routeDistance: 0.51 },
    { deltaSeconds: 1 / 90, routeSpeed: 2.2, routeDistance: 0.82 },
  ],
].map(steps => steps.reduce(
  (state, step) => stepAxialSquirmController(state, step),
  createAxialSquirmState(),
));
assert.ok(
  Math.abs(cadenceRuns[0].phase - cadenceRuns[1].phase) < 1e-10,
  'axial phase must be determined by traveled route distance, not noisy frame cadence or instantaneous speed',
);
assert.equal(cadenceRuns[0].phaseSource, 'route-distance-v0');
assert.equal(cadenceRuns[0].routeDistance, 0.82);

const distanceDriven = stepAxialSquirmController(createAxialSquirmState(), {
  deltaSeconds: 1 / 60,
  routeSpeed: 0.8,
  routeDistance: 1,
});
const missingDistance = stepAxialSquirmController(distanceDriven, {
  deltaSeconds: 0.1,
  routeSpeed: 0.8,
});
assert.equal(
  missingDistance.phase,
  distanceDriven.phase,
  'an absent route-distance sample must hold the last distance-derived phase instead of resuming frame integration',
);
assert.equal(missingDistance.routeDistance, 1);
assert.equal(missingDistance.phaseSource, 'route-distance-v0');

function syntheticTerrain(heightAt, resolution = 5) {
  const columns = resolution;
  const rows = resolution;
  const values = [];
  for (let row = 0; row < rows; row++) {
    const z = -1 + row * 2 / (rows - 1);
    for (let column = 0; column < columns; column++) {
      const x = -1 + column * 2 / (columns - 1);
      values.push(heightAt(x, z));
    }
  }
  return {
    grid: { columns, rows },
    worldBounds: { x: { min: -1, max: 1 }, z: { min: -1, max: 1 } },
    channels: { height: { componentCount: 1, values } },
  };
}

const cliffTerrain = syntheticTerrain(x => x <= 0 ? 0 : x);
const quarterSurface = sampleHillTerrainSurface(cliffTerrain, 0.25, 0);
assert.ok(Math.abs(quarterSurface.height - 0.25) < 1e-9, 'terrain support must sample sub-cell height bilinearly');
assert.equal(quarterSurface.inBounds, true);

const cliffSupport = solveAxialTerrainSupportEnvelope(cliffTerrain, normalized, {
  rootSurface: [0, 0, 0],
  forward: [1, 0, 0],
  scale: 1,
  clearance: 0.02,
  lateralExcursion: 0.08,
  maxPitchRadians: Math.PI / 5,
  maxBendRadiansPerStation: Math.PI / 12,
  maxSuspensionLift: 0.08,
});
assert.equal(cliffSupport.schema, 'kaminos.axial-terrain-support-envelope.v0');
assert.ok(cliffSupport.profile.length >= normalized.spineStations.length);
assert.ok(
  cliffSupport.rootLift <= Math.max(...cliffSupport.samples.map(sample => sample.requiredOffset)) + 1e-10,
  'support solve must remain bounded by a real terrain demand instead of ratcheting upward',
);
for (const sample of cliffSupport.samples) {
  assert.ok(
    sample.supportedContactY + 1e-8 >= sample.terrainHeight + cliffSupport.clearance,
    `${sample.stationId} terrain support must clear the full creature corridor`,
  );
}
assert.equal(cliffSupport.compliance.exceeded, true, 'a cliff under one body length must exceed local axial compliance');
assert.equal(cliffSupport.plannerDisposition, 'reroute-required');

const gentleSupport = solveAxialTerrainSupportEnvelope(
  syntheticTerrain(x => x * 0.08),
  normalized,
  {
    rootSurface: [0, 0, 0],
    forward: [1, 0, 0],
    scale: 1,
    clearance: 0.02,
    maxSuspensionLift: 0.08,
  },
);
assert.equal(gentleSupport.compliance.exceeded, false, 'a gentle slope belongs to local body support');
assert.equal(gentleSupport.plannerDisposition, 'local-support');

const narrowFeatureSupport = solveAxialTerrainSupportEnvelope(
  syntheticTerrain(x => Math.abs(x - 0.1) < 0.025 ? 0.32 : 0, 41),
  normalized,
  {
    rootSurface: [0, 0, 0],
    forward: [1, 0, 0],
    scale: 1,
    clearance: 0.02,
  },
);
assert.ok(
  narrowFeatureSupport.profile.length > normalized.spineStations.length,
  'support sampling must densify when terrain cells are finer than authored spine-station spacing',
);
assert.ok(
  narrowFeatureSupport.samples.some(sample => sample.terrainHeight > 0.2),
  'a narrow terrain feature between authored stations must enter the support envelope',
);

const exactHeadLongitudinal = -normalized.bounds.min[2];
const capObstacleSupport = solveAxialTerrainSupportEnvelope(
  syntheticTerrain(x => x > 0.472 && x < 0.505 ? 0.4 : 0, 401),
  normalized,
  {
    rootSurface: [0, 0, 0],
    forward: [1, 0, 0],
    scale: 1,
    clearance: 0.02,
    maxSuspensionLift: 0.08,
  },
);
assert.ok(
  Math.max(...capObstacleSupport.samples.map(sample => sample.longitudinal)) >= exactHeadLongitudinal - 1e-9,
  'support sampling must reach the exact residual-bearing head cap instead of stopping at the authored head station',
);
assert.ok(
  capObstacleSupport.samples.some(sample => sample.longitudinal > 0.47 && sample.terrainHeight > 0.3),
  'terrain confined beneath the exact head cap must enter the support envelope',
);
assert.equal(capObstacleSupport.plannerDisposition, 'reroute-required');

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
