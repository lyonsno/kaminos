import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FRAME_LINK_RECEIPT_SCHEMA,
  buildFrameLinkReceipt,
  containmentReport,
  frameLinkReceiptIdentity,
  solveFrameLink,
  validateFrameLinkReceipt,
} from '../frame-link-core.mjs';

// Deterministic blobby closed surface (same construction as the registration
// contracts; duplicated locally to keep each contract file self-contained).
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function syntheticBlob({ seed = 7, segments = 12, radius = 1, shrink = 1 } = {}) {
  const rand = lcg(seed);
  const bump = [];
  for (let i = 0; i < 32; i += 1) {
    const dir = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const len = Math.hypot(...dir) || 1;
    bump.push({ dir: dir.map(c => c / len), amp: 0.08 + rand() * 0.12, sharp: 2 + rand() * 6 });
  }
  const displace = p => {
    const len = Math.hypot(...p) || 1;
    const unit = p.map(c => c / len);
    let r = radius;
    for (const { dir, amp, sharp } of bump) {
      const d = unit[0] * dir[0] + unit[1] * dir[1] + unit[2] * dir[2];
      r += amp * Math.exp(sharp * (d - 1));
    }
    return unit.map(c => c * r * shrink);
  };
  const positions = [];
  const triangles = [];
  const faceAxes = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ];
  for (const [normal, uAxis, vAxis] of faceAxes) {
    const base = positions.length / 3;
    for (let iv = 0; iv <= segments; iv += 1) {
      for (let iu = 0; iu <= segments; iu += 1) {
        const u = (iu / segments) * 2 - 1;
        const v = (iv / segments) * 2 - 1;
        positions.push(...displace([0, 1, 2].map(k => normal[k] + u * uAxis[k] + v * vAxis[k])));
      }
    }
    for (let iv = 0; iv < segments; iv += 1) {
      for (let iu = 0; iu < segments; iu += 1) {
        const a = base + iv * (segments + 1) + iu;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        triangles.push(a, b, d, a, d, c);
      }
    }
  }
  return {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
  };
}

function translate(geometry, offset) {
  const out = geometry.positions.slice();
  for (let i = 0; i < out.length; i += 3) {
    for (let k = 0; k < 3; k += 1) out[i + k] += offset[k];
  }
  return { positions: out, triangles: geometry.triangles.slice() };
}

function rotateZ(geometry, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out = geometry.positions.slice();
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i];
    const y = out[i + 1];
    out[i] = c * x - s * y;
    out[i + 1] = s * x + c * y;
  }
  return { positions: out, triangles: geometry.triangles.slice() };
}

const ENVELOPE = syntheticBlob();
const INNER = syntheticBlob({ shrink: 0.75 }); // nests inside ENVELOPE by construction

test('containmentReport counts inside points exactly on a nested pair', () => {
  const report = containmentReport(INNER, ENVELOPE);
  assert.ok(report.insideFraction > 0.999,
    `nested inner shape must be contained, got ${report.insideFraction}`);
  const outside = containmentReport(translate(INNER, [5, 0, 0]), ENVELOPE);
  assert.ok(outside.insideFraction < 0.01,
    `far-translated shape must be outside, got ${outside.insideFraction}`);
});

test('solveFrameLink recovers a pure translation', () => {
  const moved = translate(INNER, [3.2, -1.4, 0.8]);
  const link = solveFrameLink({ source: moved, envelope: ENVELOPE });
  assert.ok(link.after.insideFraction > 0.995,
    `solved link must restore containment, got ${link.after.insideFraction}`);
  for (let k = 0; k < 3; k += 1) {
    assert.ok(Math.abs(link.transform.translation[k] - [-3.2, 1.4, -0.8][k]) < 0.15,
      `translation[${k}] ${link.transform.translation[k]}`);
  }
  assert.ok(link.rotationAngleDeg < 3, `rotation should be near zero, got ${link.rotationAngleDeg}`);
});

test('solveFrameLink recovers translation plus a small rotation when clearance makes rotation load-bearing', () => {
  // Rotation is only identifiable from containment when the shape is
  // elongated (a quasi-spherical fixture treats rotation as a symmetry — a
  // recorded limitation, not a defect). Stretch both shapes 3x along x, keep
  // ~4% clearance: a 0.2 rad rotation then swings the long ends outside and
  // translation alone cannot restore nesting.
  const stretchX = (geometry, factor) => {
    const out = geometry.positions.slice();
    for (let i = 0; i < out.length; i += 3) out[i] *= factor;
    return { positions: out, triangles: geometry.triangles.slice() };
  };
  const longEnvelope = stretchX(ENVELOPE, 3);
  const tight = stretchX(syntheticBlob({ shrink: 0.96 }), 3);
  const moved = translate(rotateZ(tight, 0.2), [2.0, 1.0, -0.5]);
  const link = solveFrameLink({ source: moved, envelope: longEnvelope });
  assert.ok(link.after.insideFraction > 0.98,
    `solved link must restore containment, got ${link.after.insideFraction}`);
  assert.ok(link.rotationAngleDeg > 5,
    `solver must apply a material rotation, got ${link.rotationAngleDeg}`);
  assert.ok(Math.abs(link.rotationAngleDeg - (0.2 * 180) / Math.PI) < 4,
    `rotation magnitude ${link.rotationAngleDeg} should be near ${(0.2 * 180) / Math.PI}`);
});

test('scale is locked: a scaled source must NOT be absorbed', () => {
  const grown = {
    positions: Float64Array.from(INNER.positions, v => v * 1.6),
    triangles: INNER.triangles.slice(),
  };
  const link = solveFrameLink({ source: grown, envelope: ENVELOPE });
  assert.ok(link.after.insideFraction < 0.95,
    `oversize source must stay partially outside, got ${link.after.insideFraction}`);
});

test('frame-link receipt is deterministic, validated, and wall-clock-free', () => {
  const moved = translate(INNER, [3.2, -1.4, 0.8]);
  const run = () => {
    const link = solveFrameLink({ source: moved, envelope: ENVELOPE });
    return buildFrameLinkReceipt({
      sourceLabel: 'skeleton',
      envelopeLabel: 'envelope',
      sourceSha256: 'a'.repeat(64),
      envelopeSha256: 'b'.repeat(64),
      effectiveRoute: 'contract-test',
      link,
    });
  };
  const first = run();
  const second = run();
  validateFrameLinkReceipt(first);
  assert.equal(first.schema, FRAME_LINK_RECEIPT_SCHEMA);
  assert.equal(frameLinkReceiptIdentity(first), frameLinkReceiptIdentity(second));
  const mutated = { ...first, generatedAt: '1999-01-01T00:00:00.000Z' };
  assert.equal(frameLinkReceiptIdentity(first), frameLinkReceiptIdentity(mutated));
  for (const broken of [
    { ...first, schema: 'kaminos.other.v0' },
    { ...first, link: { ...first.link, after: undefined } },
    { ...first, inputs: { ...first.inputs, sourceSha256: 'zz' } },
  ]) {
    assert.throws(() => validateFrameLinkReceipt(broken));
  }
});
