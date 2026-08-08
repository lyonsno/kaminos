import assert from 'node:assert/strict';
import test from 'node:test';

import { measureFootCorrections, LIMB_PROPORTION_SCHEMA } from '../limb-proportion-correction-core.mjs';

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

function boxMesh(center, half) {
  const p = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    p.push(center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]);
  }
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const triangles = [];
  for (const [a, b, c, d] of quads) triangles.push(a, b, c, a, c, d);
  return { positions: Float64Array.from(p), triangles: Uint32Array.from(triangles) };
}

const IDENTITY = { scale: 1, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] };

// Four "paw boxes" at quadrant corners; pedal bones displaced by a known
// coherent offset from the fore-left paw, seated in the others.
function setup(displacement) {
  const paws = {
    'fore-left': [3, 0, 3], 'fore-right': [-3, 0, 3],
    'hind-left': [3, 0, -3], 'hind-right': [-3, 0, -3],
  };
  const boxes = Object.values(paws).map(c => boxMesh(c, [1, 1, 1]));
  const cast = {
    positions: Float64Array.from(boxes.flatMap(b => Array.from(b.positions))),
    triangles: Uint32Array.from(boxes.flatMap((b, i) => Array.from(b.triangles, t => t + i * 8))),
  };
  const bones = [];
  const manifest = { bone_to_region: {} };
  for (const [foot, c] of Object.entries(paws)) {
    for (let i = 0; i < 2; i += 1) {
      const name = `${foot}-bone-${i}`;
      const offset = foot === 'fore-left' ? displacement : [0, 0, 0];
      bones.push({
        name,
        geometry: octa([c[0] + offset[0] + i * 0.3, c[1] + offset[1], c[2] + offset[2]], 0.4),
      });
      manifest.bone_to_region[name] = 'pedal';
    }
  }
  return { cast, bones, manifest };
}

test('schema and a seated foot earns no correction', () => {
  const { cast, bones, manifest } = setup([0, 0, 0]);
  const result = measureFootCorrections({ bones, manifest, cast, chainTransforms: [IDENTITY] });
  assert.equal(result.schema, LIMB_PROPORTION_SCHEMA);
  for (const [foot, entry] of Object.entries(result.corrections)) {
    assert.equal(entry.earned, false, `${foot} is seated; no correction may be earned`);
    assert.equal(entry.magnitude, 0);
  }
});

test('a coherently displaced foot earns a bounded correction that restores containment', () => {
  const { cast, bones, manifest } = setup([0, -1.4, 0]); // pushed out the paw bottom
  const result = measureFootCorrections({
    bones, manifest, cast, chainTransforms: [IDENTITY], maxCorrectionFraction: 0.5,
  });
  const fl = result.corrections['fore-left'];
  assert.equal(fl.earned, true, 'displaced foot must earn a correction');
  assert.ok(fl.coherence > 0.6, `exits must be coherent, got ${fl.coherence}`);
  assert.ok(fl.translation[1] > 0.2, `correction must push back up, got ${fl.translation}`);
  assert.ok(fl.insideFractionAfter > fl.insideFractionBefore + 0.2,
    `correction must restore containment: ${fl.insideFractionBefore} -> ${fl.insideFractionAfter}`);
  // The other feet stay untouched.
  for (const foot of ['fore-right', 'hind-left', 'hind-right']) {
    assert.equal(result.corrections[foot].earned, false, `${foot} must not be corrected`);
  }
});

test('the bound clamps a large displacement and reports it', () => {
  const { cast, bones, manifest } = setup([0, -1.4, 0]);
  const result = measureFootCorrections({
    bones, manifest, cast, chainTransforms: [IDENTITY], maxCorrectionFraction: 0.01,
  });
  const fl = result.corrections['fore-left'];
  assert.equal(fl.earned, true);
  assert.equal(fl.bounded, true, 'clamp must be reported');
  assert.ok(fl.magnitude <= result.bodyScale * 0.01 + 1e-9, 'magnitude must respect the bound');
});
