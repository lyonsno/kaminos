/**
 * Fail-first contracts for envelope relation measurement.
 *
 * These execute the measurement and assert on computed geometry, unlike the
 * existing provisional-envelope contracts, which assert only that the compiler
 * source text contains certain strings and therefore cannot fail if an envelope
 * stops preserving morphology.
 *
 * Coverage includes the harness-must-try-to-lie cases: a blank mesh, a
 * degenerate mesh, a shape-blind blob of correct bounding volume, a dropped
 * source class, and a stale-comparison mismatch.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAT_ANATOMICAL_FRAME,
  adjudicatePerturbation,
  axialProfile,
  compareRelations,
  proportionalRelations,
  resolveFrame,
} from '../envelope-relation-measure-core.mjs';

/** Axis-aligned box as a closed triangle mesh. */
function boxMesh({ min, max }) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const triangles = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
  ];
  return { positions, triangles };
}

/** Merge meshes into one, offsetting triangle indices. */
function mergeMeshes(...meshes) {
  const positions = [];
  const triangles = [];
  for (const mesh of meshes) {
    const offset = positions.length;
    positions.push(...mesh.positions);
    triangles.push(...mesh.triangles.map((t) => [t[0] + offset, t[1] + offset, t[2] + offset]));
  }
  return { positions, triangles };
}

/**
 * A crude quadruped in the measured cat frame: Y anterior-posterior,
 * Z dorsoventral, X mediolateral. Anterior is -Y, so the head sits at low Y.
 */
function quadrupedMesh({ thoraxDepth = 8, haunchDepth = 9, supportLength = 10 } = {}) {
  const head = boxMesh({ min: [-2, -30, -4], max: [2, -24, 1] });
  const thorax = boxMesh({ min: [-4, -22, -thoraxDepth], max: [4, -8, 0] });
  const haunch = boxMesh({ min: [-4, -6, -haunchDepth], max: [4, 8, 0] });
  const foreLeft = boxMesh({ min: [-4, -20, 0], max: [-2, -17, supportLength] });
  const foreRight = boxMesh({ min: [2, -20, 0], max: [4, -17, supportLength] });
  const hindLeft = boxMesh({ min: [-4, 2, 0], max: [-2, 5, supportLength] });
  const hindRight = boxMesh({ min: [2, 2, 0], max: [4, 5, supportLength] });
  return mergeMeshes(head, thorax, haunch, foreLeft, foreRight, hindLeft, hindRight);
}

test('frame resolves measured cat axes to distinct cardinal indices', () => {
  const frame = resolveFrame(CAT_ANATOMICAL_FRAME);
  assert.equal(frame.anteriorPosterior.index, 1, 'anterior-posterior is Y');
  assert.equal(frame.anteriorPosterior.sign, -1, 'anterior is -Y');
  assert.equal(frame.dorsoVentral.index, 2, 'dorsoventral is Z');
  assert.equal(frame.medioLateral.index, 0, 'mediolateral is X');
});

test('frame rejects non-cardinal and duplicated axes', () => {
  assert.throws(
    () => resolveFrame({ right: [1, 1, 0], anterior: [0, -1, 0], dorsal: [0, 0, -1] }),
    /cardinal/,
  );
  assert.throws(
    () => resolveFrame({ right: [1, 0, 0], anterior: [1, 0, 0], dorsal: [0, 0, -1] }),
    /distinct/,
  );
});

test('blank and degenerate meshes fail loud rather than yielding an empty profile', () => {
  assert.throws(() => axialProfile({ positions: [], triangles: [] }), /no triangles/);
  assert.throws(() => axialProfile(null), /positions and triangles/);

  // Every vertex at one anterior-posterior station: no axial span to measure.
  const flat = {
    positions: [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
    triangles: [[0, 1, 2]],
  };
  assert.throws(() => axialProfile(flat), /degenerate along the anterior-posterior axis/);
});

test('zero-area triangles cannot masquerade as measured geometry', () => {
  const collapsed = {
    positions: [[0, -5, 0], [0, 5, 0], [0, 0, 0]],
    triangles: [[0, 1, 2]],
  };
  assert.throws(() => axialProfile(collapsed), /no positive-area triangles/);
});

test('profile partitions surface area across slices without loss', () => {
  const profile = axialProfile(quadrupedMesh(), { sliceCount: 24 });
  const summed = profile.slices.reduce((total, slice) => total + slice.area, 0);
  assert.ok(Math.abs(summed - profile.totalArea) < 1e-9, 'slice areas must sum to total area');
  const fractions = profile.slices.reduce((total, slice) => total + slice.areaFraction, 0);
  assert.ok(Math.abs(fractions - 1) < 1e-9, 'area fractions must sum to one');
});

test('relations are dimensionless and survive uniform rescaling', () => {
  const mesh = quadrupedMesh();
  const scaled = {
    positions: mesh.positions.map((p) => [p[0] * 3.7, p[1] * 3.7, p[2] * 3.7]),
    triangles: mesh.triangles,
  };
  const base = proportionalRelations(axialProfile(mesh));
  const big = proportionalRelations(axialProfile(scaled));
  for (const key of Object.keys(base)) {
    assert.ok(
      Math.abs(base[key] - big[key]) < 1e-9,
      `${key} must be scale-invariant; scene scale does not establish real-world size`,
    );
  }
});

test('thoracic depth responds to a deeper thorax and support length to longer supports', () => {
  const base = proportionalRelations(axialProfile(quadrupedMesh()));
  const deeper = proportionalRelations(axialProfile(quadrupedMesh({ thoraxDepth: 14 })));
  assert.ok(
    deeper.thoracicDepthRatio > base.thoracicDepthRatio,
    'a deeper thorax must raise the measured depth ratio',
  );
});

test('a shape-blind blob of correct bounding volume is distinguishable from the source', () => {
  const source = quadrupedMesh();
  const profile = axialProfile(source);
  const relations = proportionalRelations(profile);

  // A single box spanning the same bounds: right volume, no internal organization.
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const p of source.positions) {
    for (let i = 0; i < 3; i += 1) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  const blob = proportionalRelations(axialProfile(boxMesh({ min, max })));

  const comparison = compareRelations(relations, blob);
  const moved = Object.values(comparison).filter(
    (entry) => entry.relativeDelta !== null && Math.abs(entry.relativeDelta) > 0.05,
  );
  assert.ok(
    moved.length > 0,
    'a bounding blob must not reproduce the source relations; otherwise the measurement is blind',
  );
});

test('comparison fails loud when the envelope is missing a measured relation', () => {
  const relations = proportionalRelations(axialProfile(quadrupedMesh()));
  const truncated = { ...relations };
  delete truncated.thoracicDepthRatio;
  assert.throws(
    () => compareRelations(relations, truncated),
    /missing measured keys: thoracicDepthRatio/,
  );
});

test('a faithful envelope passes even though the relations are coupled', () => {
  // Deepening the thorax moves fore/aft mass ratio MORE than it moves the depth
  // ratio: a deeper thorax genuinely puts mass forward. The relations are not
  // orthogonal, so the assertion compares the envelope against the source's own
  // coupled response rather than requiring unrelated relations to stay still.
  const source = proportionalRelations(axialProfile(quadrupedMesh()));
  const baseline = compareRelations(source, source);
  const perturbedSource = proportionalRelations(axialProfile(quadrupedMesh({ thoraxDepth: 14 })));
  const perturbed = compareRelations(perturbedSource, perturbedSource);

  const coupled = perturbedSource.shoulderToHaunchRatio - source.shoulderToHaunchRatio;
  const target = perturbedSource.thoracicDepthRatio - source.thoracicDepthRatio;
  assert.ok(
    Math.abs(coupled) > Math.abs(target),
    'fixture must exhibit real coupling, else this test proves nothing',
  );

  const verdict = adjudicatePerturbation({
    baselineComparison: baseline,
    perturbedComparison: perturbed,
    perturbedRelation: 'thoracicDepthRatio',
    expectedDirection: 1,
  });
  assert.equal(verdict.directionHeld, true, 'depth must move in the perturbed direction');
  assert.equal(verdict.passed, true, 'an envelope reproducing the source coupling must pass');
});

test('perturbation adjudication rejects an envelope that moves the wrong way', () => {
  const source = proportionalRelations(axialProfile(quadrupedMesh()));
  const baseline = compareRelations(source, source);
  const shallower = proportionalRelations(axialProfile(quadrupedMesh({ thoraxDepth: 4 })));
  const perturbed = compareRelations(shallower, shallower);

  const verdict = adjudicatePerturbation({
    baselineComparison: baseline,
    perturbedComparison: perturbed,
    perturbedRelation: 'thoracicDepthRatio',
    expectedDirection: 1,
  });
  assert.equal(verdict.directionHeld, false, 'a shallower envelope must not pass a deepen request');
  assert.equal(verdict.passed, false);
});

test('adjudication rejects an envelope that invents motion the source did not have', () => {
  // The source edit deepens the thorax only. The envelope deepens the thorax
  // AND swings the supports out -- motion with no source warrant. This is the
  // real locality failure: not coupling, but invention.
  const source = proportionalRelations(axialProfile(quadrupedMesh()));
  const perturbedSource = proportionalRelations(axialProfile(quadrupedMesh({ thoraxDepth: 14 })));
  const inventedEnvelope = proportionalRelations(
    axialProfile(quadrupedMesh({ thoraxDepth: 14, supportLength: 40 })),
  );

  const baseline = compareRelations(source, source);
  const perturbed = compareRelations(perturbedSource, inventedEnvelope);

  const verdict = adjudicatePerturbation({
    baselineComparison: baseline,
    perturbedComparison: perturbed,
    perturbedRelation: 'thoracicDepthRatio',
    expectedDirection: 1,
  });
  assert.equal(
    verdict.couplingHeld,
    false,
    'an envelope moving relations the source held still must fail',
  );
  assert.equal(verdict.passed, false);
});

test('adjudication rejects an envelope that flattens a response the source had', () => {
  // The source edit moves several coupled relations; the envelope reproduces
  // the target but leaves everything else where it was. Flattening real
  // structure is as much a failure as inventing false structure.
  const source = proportionalRelations(axialProfile(quadrupedMesh()));
  const perturbedSource = proportionalRelations(axialProfile(quadrupedMesh({ thoraxDepth: 14 })));
  const flattened = {
    ...source,
    thoracicDepthRatio: perturbedSource.thoracicDepthRatio,
  };

  const baseline = compareRelations(source, source);
  const perturbed = compareRelations(perturbedSource, flattened);

  const verdict = adjudicatePerturbation({
    baselineComparison: baseline,
    perturbedComparison: perturbed,
    perturbedRelation: 'thoracicDepthRatio',
    expectedDirection: 1,
  });
  assert.equal(verdict.directionHeld, true, 'the target relation did move correctly');
  assert.equal(
    verdict.couplingHeld,
    false,
    'holding coupled relations still when the source moved them must fail',
  );
  assert.equal(verdict.passed, false);
});

test('adjudication rejects an unmeasured relation and a bad direction', () => {
  const source = proportionalRelations(axialProfile(quadrupedMesh()));
  const baseline = compareRelations(source, source);
  assert.throws(
    () =>
      adjudicatePerturbation({
        baselineComparison: baseline,
        perturbedComparison: baseline,
        perturbedRelation: 'furLength',
        expectedDirection: 1,
      }),
    /not measured: furLength/,
  );
  assert.throws(
    () =>
      adjudicatePerturbation({
        baselineComparison: baseline,
        perturbedComparison: baseline,
        perturbedRelation: 'thoracicDepthRatio',
        expectedDirection: 0,
      }),
    /expectedDirection must be 1 or -1/,
  );
});
