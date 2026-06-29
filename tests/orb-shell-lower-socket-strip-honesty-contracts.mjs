import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');

assert.match(core, /LowerSocketStripHonestyLaw/, 'composition core must name the lower socket strip honesty law');

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

function tangentTurnAngles(points) {
  const turns = [];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = normalize(subtract(points[index], points[index - 1]));
    const next = normalize(subtract(points[index + 1], points[index]));
    turns.push(Math.acos(Math.max(-1, Math.min(1, dot(previous, next)))));
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
