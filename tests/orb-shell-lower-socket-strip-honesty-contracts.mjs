import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');

assert.match(core, /LowerSocketStripHonestyLaw/, 'composition core must name the lower socket strip honesty law');
assert.match(core, /LowerSocketPlateBodyHonestyLaw/, 'composition core must name the lower socket plate-body honesty law');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(point) {
  const length = Math.hypot(...point) || 1;
  return point.map(value => value / length);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distance(a, b) {
  return Math.hypot(...subtract(a, b));
}

function summarize(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(point, scalar) {
  return point.map(value => value * scalar);
}

function tangentTurnAngles(points) {
  const turns = [];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = normalize(subtract(points[index], points[index - 1]));
    const next = normalize(subtract(points[index + 1], points[index]));
    turns.push(Math.acos(Math.max(-1, Math.min(1, dot(previous, next)))));
  }
  return turns;
}

function tangentTurnSamples(samples) {
  const turns = [];
  for (let index = 1; index < samples.length - 1; index++) {
    const previous = normalize(subtract(samples[index].outer, samples[index - 1].outer));
    const next = normalize(subtract(samples[index + 1].outer, samples[index].outer));
    turns.push({
      t: samples[index].t,
      angle: Math.acos(Math.max(-1, Math.min(1, dot(previous, next)))),
    });
  }
  return turns;
}

const fiveMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const lowerSocket = fiveMacro.macroAssemblages.find(item => item.id === 'lower-socket-keel');
assert.ok(lowerSocket, 'five-macro stress case includes lower socket keel');
assert.equal(
  lowerSocket.lowerSocketFamilyRoleLaw?.selectedRole,
  'tuck-tongue',
  'stress case still classifies lower socket as tuck tongue',
);

assert.equal(
  lowerSocket.lowerSocketStripHonestyLaw?.schema,
  'LowerSocketStripHonestyLaw',
  'lower socket carries the strip-honesty law after role classification',
);
assert.equal(
  lowerSocket.lowerSocketStripHonestyLaw.role,
  'tuck-tongue',
  'strip-honesty law is specialized for the selected lower socket role',
);
assert.equal(
  lowerSocket.lowerSocketStripHonestyLaw.coherentStripClass,
  'subordinate-tuck-lamella',
  'lower socket is treated as one subordinate lamellar strip before tuck/merge solving',
);
assert.ok(
  lowerSocket.lowerSocketStripHonestyLaw.forbiddenHybridSignals.includes('right-rim-re-emergence'),
  'strip-honesty law explicitly forbids the old visible-rim re-emergence trigger',
);
assert.ok(
  lowerSocket.lowerSocketStripHonestyLaw.requiredInvariants.includes('no-visible-rim-exit-for-tuck-role'),
  'strip-honesty law forbids visible rim exit while role is tuck tongue',
);
assert.equal(
  lowerSocket.lowerSocketStripHonestyLaw.centerlinePathLaw?.mode,
  'law-owned-directed-socket-return-spine-v0',
  'strip-honesty law owns the lower socket centerline path, not just sidewall cleanup',
);

const allLayerIntervals = [
  ...(lowerSocket.layerItinerary?.intervals || []),
  ...lowerSocket.childBandPlan.flatMap(member => member.layerIntervals || []),
];
assert.equal(
  allLayerIntervals.some(interval => interval.trigger === 'right-rim-re-emergence'),
  false,
  'tuck-tongue lower socket cannot retain right-rim-re-emergence in macro or child-band layer itineraries',
);
assert.notEqual(
  lowerSocket.entryZone,
  lowerSocket.exitZone,
  'lower socket strip keeps a coherent direction and does not collapse to an untracked point',
);
assert.equal(
  lowerSocket.exitZone,
  'lower-equatorial-shared-socket-seam',
  'tuck-tongue lower socket exits into the shared socket seam instead of lower-front-rim',
);

const bodyBand = lowerSocket.childBandPlan.find(member => member.role === 'body');
assert.equal(
  bodyBand?.endTermination?.type,
  'shared-socket-seam-absorption',
  'primary lower socket strip terminates into the shared socket seam instead of rim absorption',
);
assert.ok(
  lowerSocket.macroPromotedBody.sideSilhouettePolicy.stripHonestyLawId,
  'promoted lower socket side silhouette points at the strip-honesty law before visual meshing',
);
assert.equal(
  lowerSocket.lowerSocketStripHonestyLaw.visualContract,
  'normal render may show one smooth lower-socket strip, not a crumpled foot or visible-rim/tuck hybrid',
  'strip-honesty law carries the operator-facing visual contract for the next smoke',
);
assert.equal(
  lowerSocket.lowerSocketPlateBodyHonestyLaw?.schema,
  'LowerSocketPlateBodyHonestyLaw',
  'lower socket carries a plate-body honesty law before tuck/merge can shrink the member',
);
assert.equal(
  lowerSocket.lowerSocketPlateBodyHonestyLaw.cordLikeShrinkageForbidden,
  true,
  'plate-body honesty law forbids converting the lower socket into a tendril before occlusion',
);
assert.equal(
  lowerSocket.lowerSocketPlateBodyHonestyLaw.tuckDisappearancePolicy,
  'defer-until-bottom-ownership-or-occlusion-solved',
  'future tuck intent cannot apply terminal disappearance before a receiving owner exists',
);

const lowerSocketSideWalls = fiveMacro.liveMacroSideWallPlan.sideWalls.filter(wall => wall.parentAssemblage === 'lower-socket-keel');
assert.equal(
  lowerSocketSideWalls.length,
  2,
  'strip-honesty contract inspects both promoted-body side curves for the lower socket',
);
const maxSideCurveTurn = Math.max(...lowerSocketSideWalls.flatMap(wall => (
  tangentTurnAngles(wall.sideWallSamples.map(sample => sample.outer))
)));
assert.ok(
  maxSideCurveTurn <= 0.92,
  `lower socket side curves must be smooth enough to read as one strip before tuck/merge solving; max turn ${maxSideCurveTurn.toFixed(3)}`,
);
const visibleSideCurveTurns = lowerSocketSideWalls.flatMap(wall => (
  tangentTurnSamples(wall.sideWallSamples)
    .filter(sample => sample.t >= 0.08 && sample.t <= 0.88)
));
const visibleKinkCount = visibleSideCurveTurns.filter(sample => sample.angle >= 0.29).length;
const visibleKinkEnergy = visibleSideCurveTurns
  .filter(sample => sample.angle >= 0.18)
  .reduce((sum, sample) => sum + sample.angle, 0);
assert.ok(
  visibleKinkCount <= 4,
  `lower socket visible side curves must not carry repeated medium kinks; kink count ${visibleKinkCount}`,
);
assert.ok(
  visibleKinkEnergy <= 2.2,
  `lower socket visible side curves must read as one smooth sheet, not a chain of bends; kink energy ${visibleKinkEnergy.toFixed(3)}`,
);

const leftWall = lowerSocketSideWalls.find(wall => wall.targetEdge === 'left-promoted-body-edge');
const rightWall = lowerSocketSideWalls.find(wall => wall.targetEdge === 'right-promoted-body-edge');
const centerlineSamples = leftWall.sideWallSamples.map((leftSample, index) => ({
  t: leftSample.t,
  point: scale(add(leftSample.outer, rightWall.sideWallSamples[index].outer), 0.5),
}));
const centerlineStart = centerlineSamples[0].point;
const centerlineEnd = centerlineSamples[centerlineSamples.length - 1].point;
const centerlineChord = distance(centerlineEnd, centerlineStart);
const centerlineAxis = normalize(subtract(centerlineEnd, centerlineStart));
let lateralWander = 0;
let backwardStepCount = 0;
let previousProgress = null;
for (const sample of centerlineSamples) {
  const relative = subtract(sample.point, centerlineStart);
  const progress = dot(relative, centerlineAxis);
  const projected = add(centerlineStart, scale(centerlineAxis, progress));
  lateralWander = Math.max(lateralWander, distance(sample.point, projected));
  if (previousProgress !== null && progress < previousProgress - 0.002) backwardStepCount += 1;
  previousProgress = progress;
}
assert.equal(
  backwardStepCount,
  0,
  'lower socket tuck-tongue centerline must make monotone progress into its socket seam',
);
assert.ok(
  lateralWander / centerlineChord <= lowerSocket.lowerSocketStripHonestyLaw.centerlinePathLaw.maxLateralWanderRatio,
  `lower socket tuck-tongue centerline must not wander like an independent mini-macro; lateral/chord ${(lateralWander / centerlineChord).toFixed(3)}`,
);
const visiblePlateWidths = leftWall.sideWallSamples
  .map((leftSample, index) => ({
    t: leftSample.t,
    width: distance(leftSample.outer, rightWall.sideWallSamples[index].outer),
  }))
  .filter(sample => sample.t >= 0.05 && sample.t <= 0.82);
const widthStats = summarize(visiblePlateWidths.map(sample => sample.width));
assert.ok(
  widthStats.min >= lowerSocket.lowerSocketPlateBodyHonestyLaw.visiblePlateWidthFloor,
  `lower socket visible pre-tuck body must not collapse into cord/tendril width; min width ${widthStats.min.toFixed(4)}`,
);
assert.ok(
  widthStats.mean >= lowerSocket.lowerSocketPlateBodyHonestyLaw.visiblePlateMeanWidthFloor,
  `lower socket visible pre-tuck body must retain lamellar plate occupancy; mean width ${widthStats.mean.toFixed(4)}`,
);
