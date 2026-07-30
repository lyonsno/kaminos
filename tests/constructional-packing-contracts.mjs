import assert from 'node:assert/strict';

import {
  CONSTRUCTIONAL_PACKING_RESULT_SCHEMA,
  CONSTRUCTIONAL_PACKING_SOURCE_SCHEMA,
  applyEnvelopeEdits,
  createSyntheticHipCrossSection,
  relaxEnvelopeFromTargets,
  sampleEnvelopeRadius,
  solveConstructionalPacking,
} from '../constructional-packing-core.mjs';

function compartmentMetric(result, id) {
  const metric = result.metrics.compartments[id];
  assert.ok(metric, `missing compartment metric ${id}`);
  return metric;
}

function cellKey(cell) {
  return `${cell.ix}:${cell.iy}`;
}

const source = createSyntheticHipCrossSection();
assert.equal(source.schema, CONSTRUCTIONAL_PACKING_SOURCE_SCHEMA);
assert.deepEqual(source.authority, {
  kind: 'synthetic-proxy',
  anatomicalAdmission: 'none',
});
assert.equal(source.dimension, 2);
assert.equal(source.obstacles[0].id, 'hip-joint-clearance');
assert.equal(source.compartments.length, 4);
assert.equal(
  Number(source.compartments.reduce((sum, compartment) => sum + compartment.targetShare, 0).toFixed(9)),
  1,
);

const malformedSources = [
  {
    label: 'negative target share',
    mutate(candidate) {
      candidate.compartments[0].targetShare = -0.2;
      candidate.compartments[1].targetShare = 0.5;
      candidate.compartments[2].targetShare = 0.5;
      candidate.compartments[3].targetShare = 0.2;
    },
    error: /targetShare must be finite and between 0 and 1/,
  },
  {
    label: 'non-finite field scale',
    mutate(candidate) {
      candidate.compartments[0].fieldScale[1] = Number.NaN;
    },
    error: /fieldScale must contain positive finite numbers/,
  },
  {
    label: 'degenerate centerline',
    mutate(candidate) {
      candidate.compartments[0].centerline = [
        [0.2, 0.2],
        [0.2, 0.2],
      ];
    },
    error: /centerline must have nonzero length/,
  },
  {
    label: 'invalid grid dimension',
    mutate(candidate) {
      candidate.grid.width = 0;
    },
    error: /grid width and height must be positive integers/,
  },
  {
    label: 'non-finite envelope offset',
    mutate(candidate) {
      candidate.envelope.radialOffsets[4] = Number.POSITIVE_INFINITY;
    },
    error: /radialOffsets must contain finite numbers/,
  },
  {
    label: 'unknown obstacle shape',
    mutate(candidate) {
      candidate.obstacles[0].kind = 'torus';
    },
    error: /unsupported constructional obstacle kind/,
  },
  {
    label: 'missing source authority',
    mutate(candidate) {
      candidate.authority = {};
    },
    error: /source authority kind must be one of/,
  },
  {
    label: 'collapsed effective envelope',
    mutate(candidate) {
      candidate.envelope.radialOffsets = Array(64).fill(-10);
    },
    error: /effective envelope radius must remain above/,
  },
  {
    label: 'inter-sample collapsed effective envelope',
    mutate(candidate) {
      candidate.envelope.radialOffsets = Array(64).fill(0);
      candidate.envelope.radialOffsets[42] =
        -1.0069691796985574 + 0.000005;
      candidate.envelope.radialOffsets[43] =
        -0.9750590892097216 + 0.000005;
    },
    error: /effective envelope radius must remain above/,
  },
  {
    label: 'obstacle detached from fitted envelope',
    mutate(candidate) {
      candidate.obstacles[0].center = [50, 50];
    },
    error: /obstacle center must remain inside the fitted envelope/,
  },
];

for (const malformed of malformedSources) {
  const candidate = structuredClone(source);
  malformed.mutate(candidate);
  assert.throws(
    () => solveConstructionalPacking(candidate),
    malformed.error,
    `malformed source was accepted: ${malformed.label}`,
  );
}

const baseline = solveConstructionalPacking(source);
assert.equal(baseline.schema, CONSTRUCTIONAL_PACKING_RESULT_SCHEMA);
assert.equal(baseline.sourceSchema, CONSTRUCTIONAL_PACKING_SOURCE_SCHEMA);
assert.equal(baseline.sourceAuthority, 'synthetic-proxy');
assert.ok(baseline.cells.length > 2500);
assert.equal(baseline.metrics.unownedCellCount, 0);
assert.equal(baseline.metrics.multiOwnedCellCount, 0);
assert.equal(baseline.metrics.obstacleOwnedCellCount, 0);
assert.ok(baseline.metrics.excludedObstacleCellCount > 0);
assert.equal(baseline.metrics.anchorViolations.length, 0);
assert.ok(baseline.metrics.maxTargetShareError < 0.055);

for (const cell of baseline.cells) {
  assert.equal(typeof cell.ownerId, 'string');
  assert.equal(cell.material.length, 2);
  assert.ok(cell.material.every(Number.isFinite));
}

const repeat = solveConstructionalPacking(source);
assert.deepEqual(repeat, baseline, 'packing must be deterministic');

const dorsalBefore = compartmentMetric(baseline, 'dorsal-extensor');
const connectiveBefore = compartmentMetric(baseline, 'connective-envelope');
const dorsalAngle = Math.atan2(0.46, -0.52);
const oppositeAngle = dorsalAngle + Math.PI;
const localRadiusBefore = sampleEnvelopeRadius(source, dorsalAngle);
const remoteRadiusBefore = sampleEnvelopeRadius(source, oppositeAngle);

const pressureResponse = relaxEnvelopeFromTargets({
  source,
  packing: baseline,
  targetEdits: [
    {
      id: 'grow-dorsal-extensor',
      compartmentId: 'dorsal-extensor',
      deltaShare: 0.09,
      authority: 'operator-authored',
    },
    {
      id: 'yield-connective-envelope',
      compartmentId: 'connective-envelope',
      deltaShare: -0.09,
      authority: 'operator-authored',
    },
  ],
});
assert.equal(pressureResponse.ledger.schema, 'kaminos.constructional-pressure-ledger.v0');
assert.equal(pressureResponse.ledger.edits.length, 2);
assert.equal(pressureResponse.ledger.inferredEnvelopeResponse.length, 1);
assert.equal(
  pressureResponse.source.compartments.find(item => item.id === 'dorsal-extensor').targetShare,
  0.43,
);
assert.equal(
  pressureResponse.source.compartments.find(item => item.id === 'connective-envelope').targetShare,
  0.07,
);

const localRadiusAfter = sampleEnvelopeRadius(pressureResponse.source, dorsalAngle);
const remoteRadiusAfter = sampleEnvelopeRadius(pressureResponse.source, oppositeAngle);
const localExpansion = localRadiusAfter - localRadiusBefore;
const remoteExpansion = remoteRadiusAfter - remoteRadiusBefore;
assert.ok(localExpansion > 0.05, `local pressure response too weak: ${localExpansion}`);
assert.ok(
  localExpansion > remoteExpansion + 0.04,
  `pressure response is insufficiently local: local=${localExpansion}, remote=${remoteExpansion}`,
);

const pressurePacking = solveConstructionalPacking(pressureResponse.source);
assert.equal(pressurePacking.metrics.unownedCellCount, 0);
assert.equal(pressurePacking.metrics.multiOwnedCellCount, 0);
assert.equal(pressurePacking.metrics.anchorViolations.length, 0);
assert.ok(pressurePacking.metrics.maxTargetShareError < 0.055);
assert.ok(
  compartmentMetric(pressurePacking, 'dorsal-extensor').cellCount >
    dorsalBefore.cellCount,
);
assert.ok(
  compartmentMetric(pressurePacking, 'connective-envelope').cellCount <
    connectiveBefore.cellCount,
);

const exteriorResponse = applyEnvelopeEdits({
  source,
  edits: [
    {
      id: 'compress-posterior-flank',
      kind: 'radial-offset',
      angle: 0.18,
      amplitude: -0.14,
      angularWidth: 0.34,
      authority: 'operator-authored',
    },
  ],
});
assert.equal(exteriorResponse.ledger.schema, 'kaminos.constructional-envelope-edit-ledger.v0');
assert.deepEqual(
  exteriorResponse.ledger.edits.map(edit => ({
    id: edit.id,
    authority: edit.authority,
  })),
  [{ id: 'compress-posterior-flank', authority: 'operator-authored' }],
);
assert.ok(
  sampleEnvelopeRadius(exteriorResponse.source, 0.18) <
    sampleEnvelopeRadius(source, 0.18) - 0.1,
);

const exteriorPacking = solveConstructionalPacking(exteriorResponse.source);
assert.equal(exteriorPacking.metrics.unownedCellCount, 0);
assert.equal(exteriorPacking.metrics.multiOwnedCellCount, 0);
assert.equal(exteriorPacking.metrics.obstacleOwnedCellCount, 0);
assert.equal(exteriorPacking.metrics.anchorViolations.length, 0);
assert.ok(exteriorPacking.metrics.maxTargetShareError < 0.055);

const baselineCells = new Map(baseline.cells.map(cell => [cellKey(cell), cell]));
let stableMaterialCoordinates = 0;
for (const cell of exteriorPacking.cells) {
  const prior = baselineCells.get(cellKey(cell));
  if (!prior || prior.ownerId !== cell.ownerId) continue;
  assert.deepEqual(
    cell.material,
    prior.material,
    `material coordinates drifted at ${cellKey(cell)}`,
  );
  stableMaterialCoordinates += 1;
}
assert.ok(
  stableMaterialCoordinates > baseline.cells.length * 0.72,
  `too little source material survived the exterior edit: ${stableMaterialCoordinates}`,
);

console.log('Constructional packing contracts passed');
