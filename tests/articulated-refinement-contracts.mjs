import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ARTICULATED_REFINEMENT_RECEIPT_SCHEMA,
  articulatedRefinementReceiptIdentity,
  buildArticulatedRefinementReceipt,
  deriveRefinementGroups,
  refineArticulated,
  solveGroupRotation,
} from '../articulated-refinement-core.mjs';
import { buildSurfaceIndex } from '../cast-registration-core.mjs';
import { parseGlbNodeGeometries } from '../bone-containment-probe-core.mjs';

// --- fixtures -----------------------------------------------------------------

function octa(center, size) {
  const [cx, cy, cz] = center;
  return {
    positions: Float64Array.from([
      cx + size, cy, cz, cx - size, cy, cz,
      cx, cy + size, cz, cx, cy - size, cz,
      cx, cy, cz + size, cx, cy, cz - size,
    ]),
    triangles: Uint32Array.from([
      0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4,
      2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5,
    ]),
  };
}

// Axis-aligned closed box mesh.
function boxMesh(center, half) {
  const p = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    p.push(center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]);
  }
  const quads = [
    [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
  ];
  const triangles = [];
  for (const [a, b, c, d] of quads) triangles.push(a, b, c, a, c, d);
  return { positions: Float64Array.from(p), triangles: Uint32Array.from(triangles) };
}

function rotateAboutPivot(geometry, pivot, axis, angle) {
  const len = Math.hypot(...axis);
  const [x, y, z] = axis.map(v => v / len);
  const c = Math.cos(angle); const s = Math.sin(angle); const t = 1 - c;
  const R = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
  const out = geometry.positions.slice();
  for (let i = 0; i < out.length; i += 3) {
    const px = out[i] - pivot[0]; const py = out[i + 1] - pivot[1]; const pz = out[i + 2] - pivot[2];
    for (let r = 0; r < 3; r += 1) {
      out[i + r] = R[r][0] * px + R[r][1] * py + R[r][2] * pz + pivot[r];
    }
  }
  return { positions: out, triangles: geometry.triangles.slice() };
}

const IDENTITY = { scale: 1, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] };

function sampleGeometry(geometry, count) {
  // simple deterministic vertex+midpoint sampling is enough for the small fixtures
  const out = [];
  for (let i = 0; i < geometry.positions.length && out.length < count * 3; i += 3) {
    out.push(geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]);
  }
  return Float64Array.from(out);
}

// --- contracts ------------------------------------------------------------------

test('solveGroupRotation recovers a known limb rotation about its pivot', () => {
  // "Leg" cast volume: a vertical box below the pivot. Limb authored straight
  // down; displaced by 15 deg; solver must rotate it back inside.
  const pivot = [0, 2, 0];
  const legCast = boxMesh([0, 0, 0], [0.8, 2.2, 0.8]);
  const limb = octa([0, -1, 0], 0.5); // inside the box when straight
  const displaced = rotateAboutPivot(limb, pivot, [0, 0, 1], 0.6); // ~34deg: swings outside
  const samples = sampleGeometry(displaced, 6);
  const solved = solveGroupRotation({
    samples,
    cast: legCast,
    castIndex: buildSurfaceIndex(legCast),
    pivot,
    maxAngleRad: 45 * (Math.PI / 180),
  });
  assert.ok(solved.after.insideFraction > solved.before.insideFraction,
    'refinement must improve containment');
  assert.ok(solved.after.insideFraction > 0.9,
    `limb must return inside, got ${solved.after.insideFraction}`);
  assert.ok(solved.angleDeg > 20 && solved.angleDeg < 45,
    `correction should be material, got ${solved.angleDeg}`);
});

test('rotation bound clamps and reports rather than absorbing', () => {
  const pivot = [0, 2, 0];
  const legCast = boxMesh([0, 0, 0], [0.8, 2.2, 0.8]);
  const limb = octa([0, -1, 0], 0.5);
  const displaced = rotateAboutPivot(limb, pivot, [0, 0, 1], 1.2); // ~69deg, beyond bound
  const samples = sampleGeometry(displaced, 6);
  const solved = solveGroupRotation({
    samples,
    cast: legCast,
    castIndex: buildSurfaceIndex(legCast),
    pivot,
    maxAngleRad: 25 * (Math.PI / 180),
  });
  assert.ok(solved.clampedAtBound, 'bound clamp must be reported');
  assert.ok(solved.angleDeg <= 25.01, `angle must respect bound, got ${solved.angleDeg}`);
  assert.ok(solved.after.insideFraction < 0.9,
    'a beyond-bound displacement must remain visibly unresolved');
});

test('deriveRefinementGroups composes manifest classes with spatial instances (real data)', async () => {
  const skelBytes = await readFile(new URL(
    '../artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb', import.meta.url,
  ));
  const manifest = JSON.parse(await readFile(new URL(
    '../artifacts/cast-correspondence-v0/frozen/region-manifest-golden-provisional.json', import.meta.url,
  ), 'utf8'));
  const bones = parseGlbNodeGeometries(skelBytes);
  const groups = deriveRefinementGroups(bones, manifest);
  const names = groups.map(g => g.name).sort();
  for (const expected of ['core', 'head', 'tail', 'forelimb-left', 'forelimb-right', 'hindlimb-left', 'hindlimb-right']) {
    assert.ok(names.includes(expected), `missing group ${expected}: ${names}`);
  }
  const core = groups.find(g => g.name === 'core');
  assert.equal(core.refinable, false, 'core is measured, never rotated');
  for (const limb of groups.filter(g => g.name.includes('limb'))) {
    assert.ok(limb.bones.length >= 3, `${limb.name} has ${limb.bones.length} bones`);
    assert.ok(Array.isArray(limb.pivot) && limb.pivot.length === 3);
  }
  const covered = groups.reduce((a, g) => a + g.bones.length, 0);
  assert.equal(covered, bones.length, 'every bone belongs to exactly one group');
});

test('coverage leg detects an underspanning chain that containment cannot see', async () => {
  const { measureChainCoverage } = await import('../articulated-refinement-core.mjs');
  const pivot = [0, 2, 0];
  // Long leg volume extending to y=-3.
  const legCast = boxMesh([0, -0.5, 0], [0.8, 2.7, 0.8]);
  // Short chain reaching only y=-0.5: fully contained, underspanning.
  const shortChain = octa([0, 0, 0], 0.5);
  const short = measureChainCoverage({ samples: shortChain.positions.slice(), cast: legCast, pivot });
  assert.ok(short.coverage !== null, 'coverage must compute');
  assert.ok(short.coverage < 0.65, `short chain must underspan, got ${short.coverage}`);
  // Full-length chain reaching y=-2.8: near-full coverage.
  const longChain = octa([0, -2.3, 0], 0.5);
  const full = measureChainCoverage({ samples: longChain.positions.slice(), cast: legCast, pivot });
  assert.ok(full.coverage > 0.85, `full chain must cover, got ${full.coverage}`);
});

test('receipt is deterministic, wall-clock-free, and declares the joint model', async () => {
  const pivotCast = boxMesh([0, 0, 0], [2, 2, 2]);
  const bones = [{ name: 'SRC_PELVIS', geometry: octa([0, 0, 0], 0.4) }];
  const manifest = {
    frame: { ML: 'X', AP: 'Z', DV: 'Y', head_direction_z: 1 },
    bone_to_region: { SRC_PELVIS: 'pelvis' },
  };
  const run = () => buildArticulatedRefinementReceipt({
    skeletonSha256: 'a'.repeat(64),
    castSha256: 'b'.repeat(64),
    castLabel: 'contract-cast',
    manifestSha256: 'c'.repeat(64),
    chain: { frameLinkReceiptSha256: 'd'.repeat(64), stageAReceiptSha256: 'e'.repeat(64) },
    refinement: refineArticulated({
      bones, manifest, cast: pivotCast, chainTransforms: [IDENTITY], samplesPerBone: 12,
    }),
  });
  const first = run();
  const second = run();
  assert.equal(first.schema, ARTICULATED_REFINEMENT_RECEIPT_SCHEMA);
  assert.equal(articulatedRefinementReceiptIdentity(first), articulatedRefinementReceiptIdentity(second));
  const mutated = { ...first, generatedAt: '1999-01-01T00:00:00.000Z' };
  assert.equal(articulatedRefinementReceiptIdentity(first), articulatedRefinementReceiptIdentity(mutated));
  assert.match(first.jointModel, /limb-level/);
  assert.match(first.manifestAuthority, /operator sign pending/);
});
