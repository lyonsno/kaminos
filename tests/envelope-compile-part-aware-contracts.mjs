/**
 * Fail-first contracts for part-aware envelope compilation.
 *
 * The defect these guard against is measured, not hypothetical: a single global
 * closing radius over an undifferentiated cloud inverted the source's fore/aft
 * mass distribution, because thin structures were swallowed while bulk regions
 * were inflated.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  connectedComponents,
  partThickness,
  planPartAwareElements,
} from '../envelope-compile-part-aware-core.mjs';

function boxMesh({ min, max }) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return {
    positions: [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ],
    triangles: [
      [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
      [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
    ],
  };
}

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

/** A thick trunk and a thin distal rod: the geometry that broke the old compiler. */
function trunkAndRodMesh() {
  const trunk = boxMesh({ min: [-5, -5, -5], max: [5, 5, 5] });
  const rod = boxMesh({ min: [-0.4, 20, -0.4], max: [0.4, 40, 0.4] });
  return { mesh: mergeMeshes(trunk, rod), trunkPart: 0, rodPart: 1 };
}

test('connected components recover disjoint parts', () => {
  const { mesh } = trunkAndRodMesh();
  const parts = connectedComponents(mesh);
  assert.equal(parts.length, 2, 'a trunk and a separate rod are two parts');
  const totals = parts.reduce((sum, part) => sum + part.triangles.length, 0);
  assert.equal(totals, mesh.triangles.length, 'no triangle may be dropped or duplicated');
});

test('connected components fail loud on empty or malformed meshes', () => {
  assert.throws(() => connectedComponents({ positions: [], triangles: [] }), /no triangles/);
  assert.throws(
    () => connectedComponents({ positions: [[0, 0, 0]], triangles: [[0, 5, 9]] }),
    /missing vertex/,
  );
});

test('thickness uses the second-smallest extent so flat parts survive', () => {
  // A blade: near-zero on one axis, broad on the others. The smallest extent
  // would report ~0 and drive the radius to its floor; the second-smallest
  // reports the cross-section that actually matters.
  const blade = boxMesh({ min: [0, 0, 0], max: [0.01, 8, 6] });
  const indices = blade.positions.map((_, i) => i);
  assert.ok(Math.abs(partThickness(blade.positions, indices) - 6) < 1e-9);
});

test('a thin part receives a smaller radius than a thick part', () => {
  const { mesh, trunkPart, rodPart } = trunkAndRodMesh();
  const plan = planPartAwareElements(mesh);
  const trunk = plan.parts.find((p) => p.partIndex === trunkPart);
  const rod = plan.parts.find((p) => p.partIndex === rodPart);
  assert.ok(
    rod.radius < trunk.radius,
    'a per-part radius must scale to local thickness, not to the whole body',
  );
});

test('every element carries the source part it came from', () => {
  const { mesh } = trunkAndRodMesh();
  const plan = planPartAwareElements(mesh);
  const seen = new Set(plan.elements.map((element) => element.partIndex));
  assert.deepEqual([...seen].sort(), [0, 1], 'both parts must contribute elements');
  for (const element of plan.elements) {
    assert.ok(Number.isInteger(element.partIndex), 'source identity must survive compilation');
  }
});

test('a thin distal part is not erased by the whole-body scale', () => {
  // The measured failure: the rod is ~1% of the body diagonal. Under a single
  // global radius it disappears into the trunk's field. Per-part planning must
  // keep it represented.
  const { mesh, rodPart } = trunkAndRodMesh();
  const plan = planPartAwareElements(mesh);
  const rod = plan.parts.find((p) => p.partIndex === rodPart);
  assert.ok(rod.elementCount > 0, 'the thin part must produce elements');
  assert.ok(
    rod.radius < plan.diagonal * 0.05,
    'the thin part radius must stay far below whole-body scale',
  );
});

test('radii are bounded so one degenerate part cannot dominate or vanish', () => {
  const { mesh } = trunkAndRodMesh();
  const plan = planPartAwareElements(mesh);
  for (const part of plan.parts) {
    assert.ok(part.radius >= plan.minRadius - 1e-12, `${part.partIndex} below floor`);
    assert.ok(part.radius <= plan.maxRadius + 1e-12, `${part.partIndex} above ceiling`);
  }
});

test('inverted radius bounds fail loud rather than silently reordering', () => {
  const { mesh } = trunkAndRodMesh();
  assert.throws(
    () => planPartAwareElements(mesh, { minRadiusFraction: 0.5, maxRadiusFraction: 0.001 }),
    /must not exceed/,
  );
});

test('element centers stay inside a plausible neighbourhood of their part', () => {
  const { mesh, rodPart } = trunkAndRodMesh();
  const plan = planPartAwareElements(mesh);
  const rodElements = plan.elements.filter((element) => element.partIndex === rodPart);
  for (const element of rodElements) {
    assert.ok(
      element.center[1] > 15,
      'a rod element must not be planted in the trunk; parts must not bleed',
    );
  }
});
