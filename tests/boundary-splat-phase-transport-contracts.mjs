import assert from 'node:assert/strict';

import {
  buildBoundedTransportCorrespondence,
  interpolateTransportRows,
  validateMovingPhaseWitness,
} from '../boundary-splat-phase-transport.mjs';

function candidate(value) {
  return Array.from({ length: 16 }, (_, index) => value + index * 0.01);
}

function splat(position, opacity = 1) {
  return [...position, 1, 0.5, 0.2, 0.04, opacity, 0.02, 0.02, 0, 1];
}

function site(position, value, opacity = 1) {
  return { position, candidate: candidate(value), splat: splat(position, opacity) };
}

{
  const source = [
    site([0, 0, 0], 1),
    site([0, 1, 0], 2),
    site([4, 4, 4], 3),
  ];
  const target = [
    site([1, 0, 0], 1.01),
    site([0, 1, 0], 2.01),
    site([8, 8, 8], 9),
  ];
  const result = buildBoundedTransportCorrespondence(source, target, {
    gridStep: 1,
    radiusCells: 1,
  });

  assert.equal(result.authority, 'stable-site-first-bounded-local-grid-feature-correspondence-v0');
  assert.deepEqual(result.supportSemantics, {
    stable: 'same world-position site is reserved before displaced matching',
    transported: 'one source carrier is assigned to one unmatched target within the bounded local grid',
    birth: 'target support has no assigned source carrier inside the bounded local grid',
    death: 'source support has no assigned target inside the bounded local grid',
  });
  assert.equal(result.matches.length, 2);
  assert.equal(result.stableCount, 1);
  assert.equal(result.transportedCount, 1);
  assert.equal(result.births.length, 1);
  assert.equal(result.deaths.length, 1);
  assert.deepEqual(result.matches.find(match => match.kind === 'transported').deltaCells, [1, 0, 0]);
  assert.ok(result.matches.every(match => match.distanceCells <= 1));
  assert.equal(new Set(result.matches.map(match => match.sourceIndex)).size, result.matches.length);
  assert.equal(new Set(result.matches.map(match => match.targetIndex)).size, result.matches.length);
}

{
  const source = [site([0, 0, 0], 1)];
  const target = [site([-1, 0, 0], 1), site([1, 0, 0], 1)];
  const result = buildBoundedTransportCorrespondence(source, target, {
    gridStep: 1,
    radiusCells: 1,
  });
  assert.equal(result.ambiguityCount, 1, 'equal local candidates must be reported as ambiguous');
  assert.equal(result.matches.length, 1, 'a source carrier cannot silently clone into two targets');
  assert.equal(result.births.length, 1, 'the unassigned target remains an explicit residual birth');
}

{
  const source = [site([0, 0, 0], 1, 0.8)];
  const target = [site([2, 0, 0], 1.1, 0.4)];
  const rows = interpolateTransportRows(source, target, [{
    sourceIndex: 0,
    targetIndex: 0,
    kind: 'transported',
    deltaCells: [2, 0, 0],
  }], 0.25);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(0, 3), [0.5, 0, 0]);
  assert.ok(Math.abs(rows[0][7] - 0.7) < 1e-9);
  assert.throws(() => interpolateTransportRows(source, target, [], -0.1), /interpolation fraction/);
  assert.throws(() => interpolateTransportRows(source, target, [], 1.1), /interpolation fraction/);
}

{
  const valid = {
    schema: 'kaminos-boundary-splat-moving-phase-witness-v0',
    status: 'completed',
    playback: {
      authority: 'finite-forward-heldout-phase-sequence-v0',
      requestedFps: 12,
      effectiveFps: 12,
      frameCount: 4,
      loops: false,
      resetDisclosure: 'playback ends on the farthest held-out target and restarts only by explicit viewer action',
    },
    roles: {
      reference: { authority: 'exact-heldout-target-state-v0', frameHashes: ['r0', 'r1', 'r2', 'r3'] },
      control: { authority: 'copied-current-zero-velocity-v0', frameHashes: ['c0', 'c0', 'c0', 'c0'] },
      predicted: { authority: 'learned-local-grid-transport-plus-residual-churn-v0', frameHashes: ['p0', 'p1', 'p2', 'p3'] },
    },
    partialFlowDebug: {
      authority: 'display-only-support-flow-debug-mix-v0',
      requestedGain: 0.625,
      effectiveGain: 0.625,
      roles: ['reference', 'control', 'predicted'],
      frameCount: 4,
      effectiveFps: 12,
    },
  };
  assert.equal(validateMovingPhaseWitness(valid), true);
  assert.throws(
    () => validateMovingPhaseWitness({ ...valid, playback: { ...valid.playback, loops: true } }),
    /must not loop/,
  );
  assert.throws(
    () => validateMovingPhaseWitness({
      ...valid,
      roles: { ...valid.roles, predicted: { ...valid.roles.predicted, frameHashes: ['p0', 'p0', 'p0', 'p0'] } },
    }),
    /predicted motion is a copied frame/,
  );
  assert.throws(
    () => validateMovingPhaseWitness({
      ...valid,
      partialFlowDebug: { ...valid.partialFlowDebug, effectiveFps: 10 },
    }),
    /cadence mismatch/,
  );
}

console.log('boundary splat phase transport contracts passed');
