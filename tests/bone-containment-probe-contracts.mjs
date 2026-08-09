import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BONE_CONTAINMENT_RECEIPT_SCHEMA,
  applyChain,
  boneContainmentReceiptIdentity,
  buildBoneContainmentReceipt,
  parseGlbNodeGeometries,
  probeBoneContainment,
} from '../bone-containment-probe-core.mjs';

// --- fixtures ---------------------------------------------------------------

// Small closed octahedron mesh at a given center/size: cheap bone stand-in.
function octa(center, size) {
  const [cx, cy, cz] = center;
  const positions = Float64Array.from([
    cx + size, cy, cz, cx - size, cy, cz,
    cx, cy + size, cz, cx, cy - size, cz,
    cx, cy, cz + size, cx, cy, cz - size,
  ]);
  const triangles = Uint32Array.from([
    0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4,
    2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5,
  ]);
  return { positions, triangles };
}

// Closed cube "cast" spanning [-2,2]^3.
function cubeMesh(half) {
  const p = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    p.push(sx * half, sy * half, sz * half);
  }
  const quads = [
    [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
  ];
  const triangles = [];
  for (const [a, b, c, d] of quads) triangles.push(a, b, c, a, c, d);
  return { positions: Float64Array.from(p), triangles: Uint32Array.from(triangles) };
}

const IDENTITY = { scale: 1, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] };

// --- contracts ---------------------------------------------------------------

test('applyChain composes similarity transforms in order', () => {
  const shift = { scale: 1, rotation: IDENTITY.rotation, translation: [1, 0, 0] };
  const double = { scale: 2, rotation: IDENTITY.rotation, translation: [0, 0, 0] };
  // shift then double: (p + [1,0,0]) * 2
  const out = applyChain([1, 1, 1], [shift, double]);
  assert.deepEqual(out, [4, 2, 2]);
});

test('probeBoneContainment separates contained, straddling, and outside bones', () => {
  const cast = cubeMesh(2);
  const bones = [
    { name: 'inside-bone', geometry: octa([0, 0, 0], 0.5) },
    { name: 'straddling-bone', geometry: octa([2, 0, 0], 0.8) },
    { name: 'outside-bone', geometry: octa([6, 0, 0], 0.5) },
  ];
  const probe = probeBoneContainment({ bones, cast, transforms: [IDENTITY], samplesPerBone: 60 });
  const byName = Object.fromEntries(probe.perBone.map(b => [b.name, b]));
  assert.ok(byName['inside-bone'].insideFraction > 0.95,
    `inside bone got ${byName['inside-bone'].insideFraction}`);
  assert.ok(byName['outside-bone'].insideFraction < 0.05,
    `outside bone got ${byName['outside-bone'].insideFraction}`);
  const straddle = byName['straddling-bone'].insideFraction;
  assert.ok(straddle > 0.2 && straddle < 0.8, `straddling bone got ${straddle}`);
  // Worst bone sorts first.
  assert.equal(probe.perBone[0].name, 'outside-bone');
  // Outside distance for the far bone is materially nonzero.
  assert.ok(byName['outside-bone'].outsideQ50 > 3, byName['outside-bone'].outsideQ50);
});

test('probe carries points through the receipted chain before scoring', () => {
  const cast = cubeMesh(2);
  // Bone authored far away; chain translates it into the cast.
  const bones = [{ name: 'translated-bone', geometry: octa([100, 0, 0], 0.5) }];
  const chain = [{ scale: 1, rotation: IDENTITY.rotation, translation: [-100, 0, 0] }];
  const probe = probeBoneContainment({ bones, cast, transforms: chain, samplesPerBone: 40 });
  assert.ok(probe.perBone[0].insideFraction > 0.95,
    `chain must land the bone inside, got ${probe.perBone[0].insideFraction}`);
});

test('receipt identity is deterministic and wall-clock-free', () => {
  const cast = cubeMesh(2);
  const bones = [{ name: 'b', geometry: octa([0, 0, 0], 0.5) }];
  const run = () => buildBoneContainmentReceipt({
    skeletonSha256: 'a'.repeat(64),
    castSha256: 'b'.repeat(64),
    castLabel: 'contract-cast',
    chain: { frameLink: 'x'.repeat(64), stageA: 'y'.repeat(64) },
    probe: probeBoneContainment({ bones, cast, transforms: [IDENTITY], samplesPerBone: 40 }),
  });
  const first = run();
  const second = run();
  assert.equal(first.schema, BONE_CONTAINMENT_RECEIPT_SCHEMA);
  assert.equal(boneContainmentReceiptIdentity(first), boneContainmentReceiptIdentity(second));
  const mutated = { ...first, generatedAt: '1999-01-01T00:00:00.000Z' };
  assert.equal(boneContainmentReceiptIdentity(first), boneContainmentReceiptIdentity(mutated));
  assert.equal(first.regionTagsProvisional, true, 'provisional tags must be labeled');
});

test('parseGlbNodeGeometries returns separable named nodes (real skeleton smoke)', async () => {
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(new URL(
    '../artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb', import.meta.url,
  ));
  const nodes = parseGlbNodeGeometries(bytes);
  assert.ok(nodes.length >= 90, `expected ~96 bone nodes, got ${nodes.length}`);
  assert.ok(nodes.some(n => n.name === 'SRC_PELVIS'), 'named pelvis node must survive');
  assert.deepEqual(
    nodes.find(n => n.name === 'Cube.003')?.worldOrigin,
    [25.05453109741211, -9.382328987121582, -5.397850036621094],
    'skeletal controls must retain their authored node origin independently of relation fixtures',
  );
  const totalTris = nodes.reduce((acc, n) => acc + n.geometry.triangles.length / 3, 0);
  assert.equal(totalTris, 9111, 'per-node parse must cover the merged triangle count');
});
