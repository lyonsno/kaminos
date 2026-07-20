import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMotionRoutePlanFromTerrainAffordance,
  decodeHillMotionAffordancePacket,
} from '../motion-core.js';
import * as creatureCore from '../motion-ready-719024-core.js';

for (const exportName of [
  'createAxialTerrainRouteTransitionEvaluator',
  'compileCreatureScaleLocomotionRail',
  'sampleCreatureScaleLocomotionRail',
]) {
  assert.equal(
    typeof creatureCore[exportName],
    'function',
    `${exportName} must be an exported locomotion-rail contract`,
  );
}

const root = new URL('../', import.meta.url);
const packet = JSON.parse(await readFile(new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', root), 'utf8'));
const data = JSON.parse(await readFile(new URL('artifacts/motion-ready-719024/hill/motion-affordance-data.json', root), 'utf8'));
const registration = creatureCore.validateAxialCrawlerRegistration(JSON.parse(
  await readFile(new URL('artifacts/motion-ready-719024/registration.json', root), 'utf8'),
));
const source = decodeHillMotionAffordancePacket({ packet, data });
const bounds = source.worldBounds;
const start = [
  bounds.x.min + (bounds.x.max - bounds.x.min) * 0.13,
  0,
  bounds.z.min + (bounds.z.max - bounds.z.min) * 0.18,
];
const goal = [
  bounds.x.min + (bounds.x.max - bounds.x.min) * 0.82,
  0,
  bounds.z.min + (bounds.z.max - bounds.z.min) * 0.74,
];

const baseline = createMotionRoutePlanFromTerrainAffordance(source, {
  id: 'locomotion-rail-baseline',
  start,
  goal,
  costProfile: 'ridge-runner',
});
const blockedIndex = baseline.routePoints[Math.floor(baseline.routePoints.length / 2)].index;
const constrained = createMotionRoutePlanFromTerrainAffordance(source, {
  id: 'locomotion-rail-transition-contract',
  start,
  goal,
  costProfile: 'ridge-runner',
  transitionEvaluator: transition => ({
    schema: 'test.transition-evaluation.v0',
    admissible: transition.to.index !== blockedIndex,
    additionalCost: 0,
    evidence: { blockedIndex },
  }),
});
assert.ok(
  !constrained.routePoints.some(point => point.index === blockedIndex),
  'the route planner must honor candidate-state rejection instead of planning through it',
);
assert.equal(constrained.evidence.transitionAdmission, 'caller-evaluated');
assert.ok(
  constrained.routePoints.slice(1).every(point => point.transitionEvidence),
  'admitted route points must retain the evidence that admitted their incoming transition',
);
assert.throws(
  () => createMotionRoutePlanFromTerrainAffordance(source, {
    id: 'locomotion-rail-malformed-transition-contract',
    start,
    goal,
    costProfile: 'ridge-runner',
    transitionEvaluator: () => undefined,
  }),
  /explicit boolean admissible/,
  'a missing oracle return must fail loud instead of becoming positive admission',
);

function syntheticTerrain(heightAt, resolution = 81, extent = 4) {
  const values = [];
  for (let row = 0; row < resolution; row++) {
    const z = -extent + row * extent * 2 / (resolution - 1);
    for (let column = 0; column < resolution; column++) {
      const x = -extent + column * extent * 2 / (resolution - 1);
      values.push(heightAt(x, z));
    }
  }
  return {
    grid: { columns: resolution, rows: resolution },
    worldBounds: {
      x: { min: -extent, max: extent },
      z: { min: -extent, max: extent },
    },
    channels: { height: { componentCount: 1, values } },
  };
}

const gentleTerrain = syntheticTerrain((x, z) => 0.025 * x + 0.012 * Math.sin(z * 0.8));
const transitionEvaluator = creatureCore.createAxialTerrainRouteTransitionEvaluator(
  gentleTerrain,
  registration,
  {
    scale: 1.14,
    clearance: 0.018,
    lateralExcursion: 0.1,
    maxPitchRadians: Math.PI / 5,
    maxBendRadiansPerStation: Math.PI / 10,
    maxSuspensionLift: 0.114,
  },
);
const admitted = transitionEvaluator({
  from: { index: 0, grid: { column: 10, row: 30 }, world: [-3, 0, -1] },
  to: { index: 1, grid: { column: 11, row: 30 }, world: [-2.7, 0, -1] },
  heading: [1, 0, 0],
  directionIndex: 1,
});
assert.equal(admitted.admissible, true, 'a gentle full-body transition must be admitted');
assert.ok(admitted.evidence.minimumNormalizedMargin >= 0);

const cliffTerrain = syntheticTerrain(x => x < 0 ? 0 : 0.8, 161, 2);
const cliffEvaluator = creatureCore.createAxialTerrainRouteTransitionEvaluator(
  cliffTerrain,
  registration,
  {
    scale: 1.14,
    clearance: 0.018,
    lateralExcursion: 0.1,
    maxSuspensionLift: 0.114,
  },
);
const rejected = cliffEvaluator({
  from: { index: 0, grid: { column: 78, row: 80 }, world: [-0.05, 0, 0] },
  to: { index: 1, grid: { column: 82, row: 80 }, world: [0.05, 0, 0] },
  heading: [1, 0, 0],
  directionIndex: 1,
});
assert.equal(rejected.admissible, false, 'a body-length cliff transition must be rejected upstream');
assert.ok(rejected.evidence.minimumNormalizedMargin < 0);

const authoredRoute = {
  id: 'gentle-creature-rail',
  source: { sourceRef: 'synthetic:gentle-terrain' },
  evidence: { transitionAdmission: 'caller-evaluated' },
  routePoints: [
    [-3.1, -1.25],
    [-2.2, -0.7],
    [-1.1, -0.45],
    [0.2, 0.15],
    [1.15, 1.05],
    [2.2, 1.45],
    [3.1, 1.1],
  ].map(([x, z], index) => ({
    index,
    world: [x, creatureCore.sampleHillTerrainSurface(gentleTerrain, x, z).height, z],
    ...(index > 0 ? { transitionEvidence: { schema: 'test.transition-evidence.v0', admissible: true } } : {}),
  })),
};
assert.throws(
  () => creatureCore.compileCreatureScaleLocomotionRail(
    gentleTerrain,
    registration,
    {
      ...authoredRoute,
      evidence: { transitionAdmission: 'root-point-only' },
      routePoints: authoredRoute.routePoints.map(({ transitionEvidence, ...point }) => point),
    },
    { scale: 1.14, transitionEvaluator },
  ),
  /caller-evaluated route plan/,
  'a root-only route must not be promoted into a creature-scale rail',
);
const rail = creatureCore.compileCreatureScaleLocomotionRail(
  gentleTerrain,
  registration,
  authoredRoute,
  {
    scale: 1.14,
    clearance: 0.018,
    lateralExcursion: 0.1,
    maxPitchRadians: Math.PI / 5,
    maxBendRadiansPerStation: Math.PI / 10,
    maxSuspensionLift: 0.114,
    sampleSpacing: 0.08,
    transitionEvaluator,
  },
);
assert.equal(rail.schema, 'kaminos.creature-scale-locomotion-rail.v0');
assert.ok(rail.samples.length > authoredRoute.routePoints.length * 4);
assert.ok(rail.length > 5);
assert.ok(
  rail.samples.every(sample => sample.support.compliance.minimumNormalizedMargin >= 0),
  'every rail sample must retain nonnegative full-body terrain-support margin',
);
assert.ok(
  rail.continuity.maximumHeadingDeltaRadians < 0.22,
  'the rail must replace raw grid-heading jumps with a bounded locomotion tangent',
);
assert.ok(
  rail.continuity.maximumSupportCorrectionDelta < 0.035,
  'terrain support correction must remain continuous along the admitted rail',
);
assert.equal(rail.evidence.transitionAdmission, 'caller-evaluated-dense-revalidation');
assert.ok(rail.evidence.denseTransitionCount >= rail.samples.length - 1);
assert.throws(
  () => creatureCore.compileCreatureScaleLocomotionRail(
    gentleTerrain,
    registration,
    authoredRoute,
    {
      scale: 1.14,
      transitionEvaluator: transition => ({
        admissible: transition?.from?.interpolation !== 'locomotion-rail',
        evidence: { schema: 'test.rail-corridor-evidence.v0' },
      }),
    },
  ),
  /dense transition admission/,
  'the rail compiler must rerun caller admission over interpolated segments',
);

const supportSegmentIndex = rail.samples.findIndex((sample, index) => (
  index < rail.samples.length - 1
  && Math.abs(rail.samples[index + 1].support.rootLift - sample.support.rootLift) > 1e-5
));
assert.ok(supportSegmentIndex >= 0, 'fixture must exercise changing terrain support');
const supportStart = rail.samples[supportSegmentIndex];
const supportEnd = rail.samples[supportSegmentIndex + 1];
const midpointSupport = creatureCore.sampleCreatureScaleLocomotionRail(
  rail,
  (supportStart.sourceDistance + supportEnd.sourceDistance) * 0.5,
).support;
assert.ok(
  Math.abs(midpointSupport.rootLift - (supportStart.support.rootLift + supportEnd.support.rootLift) * 0.5) < 1e-10,
  'playback must interpolate support lift instead of stepping between compiled envelopes',
);
assert.ok(
  Math.abs(
    midpointSupport.profile[0].localOffset
      - (supportStart.support.profile[0].localOffset + supportEnd.support.profile[0].localOffset) * 0.5,
  ) < 1e-10,
  'playback must interpolate the full support profile that deforms the body',
);

const distance = rail.length * 0.57;
const targetLeft = creatureCore.sampleCreatureScaleLocomotionRail(rail, distance, {
  attentionTarget: [-3, 2, 1],
});
const targetRight = creatureCore.sampleCreatureScaleLocomotionRail(rail, distance, {
  attentionTarget: [3, 2, -1],
});
assert.deepEqual(
  targetLeft.position,
  targetRight.position,
  'attention changes must not alter the locomotion position',
);
assert.deepEqual(
  targetLeft.tangent,
  targetRight.tangent,
  'attention changes must not torque the body locomotion frame',
);
assert.notDeepEqual(targetLeft.attention.direction, targetRight.attention.direction);

for (const cadence of [30, 60, 144]) {
  const cadenceSample = creatureCore.sampleCreatureScaleLocomotionRail(
    rail,
    (Math.round(distance / (rail.length / cadence)) * rail.length / cadence),
  );
  assert.ok(Number.isFinite(cadenceSample.sourceDistance));
}
const repeatedA = creatureCore.sampleCreatureScaleLocomotionRail(rail, distance);
const repeatedB = creatureCore.sampleCreatureScaleLocomotionRail(rail, distance);
assert.deepEqual(repeatedA, repeatedB, 'the same route distance must resolve the same pose source at every frame cadence');

console.log('motion-ready-719024 locomotion rail contracts passed');
