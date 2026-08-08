/**
 * Contracts for anatomical frame detection.
 *
 * The failure this guards is silent: a wrong frame produces numbers that look
 * fine and mean nothing, which is how the first depth comparison read a cast as
 * "inflated" when the axes were mislabelled. So the tests must prove the
 * detector survives the exact transforms that cause the problem — a Y-up export
 * conversion and an arbitrary axis permutation — and that it refuses rather than
 * guesses when the geometry does not support a call.
 *
 * Run: node --test tests/detect-anatomical-frame-contracts.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnatomicalFrame } from '../detect-anatomical-frame.mjs';

/** Synthetic quadruped: long in AP, medium in DV, narrow and symmetric in ML. */
function syntheticQuadruped({ ml = 0, ap = 1, dv = 2 } = {}) {
  const points = [];
  // Body: symmetric about ML, longer in AP than tall in DV.
  for (let i = -50; i <= 50; i += 1) {
    for (const side of [-1, 1]) {
      for (let h = 0; h < 12; h += 1) {
        const p = [0, 0, 0];
        p[ap] = i * 0.08;            // span ~8
        p[ml] = side * (0.6 + 0.2 * Math.cos(i / 12)); // narrow, symmetric
        p[dv] = h * 0.45;            // span ~5
        points.push(p);
      }
    }
  }
  // Asymmetric head at one AP end only — makes AP genuinely non-symmetric.
  for (let k = 0; k < 240; k += 1) {
    const p = [0, 0, 0];
    p[ap] = 4.4 + (k % 12) * 0.05;
    p[ml] = ((k % 7) - 3) * 0.12;
    p[dv] = 4.6 + Math.floor(k / 60) * 0.1;
    points.push(p);
  }
  return points;
}

function permute(points, mapping) {
  return points.map((p) => mapping.map((src) => p[src]));
}

test('detects the frame of a canonical quadruped', () => {
  const frame = detectAnatomicalFrame(syntheticQuadruped());
  assert.equal(frame.medioLateral, 0);
  assert.equal(frame.anteriorPosterior, 1);
  assert.equal(frame.dorsoVentral, 2);
  assert.ok(frame.sane, frame.sanityNotes.join('; '));
});

test('survives a Y-up export conversion', () => {
  // Y-up conversion: (x, y, z) -> (x, z, -y). The exact transform that made the
  // authored envelope and the reconstructed cast disagree.
  const base = syntheticQuadruped();
  const converted = base.map(([x, y, z]) => [x, z, -y]);
  const frame = detectAnatomicalFrame(converted);
  assert.equal(frame.medioLateral, 0, 'mediolateral must follow the geometry, not the axis index');
  assert.equal(frame.anteriorPosterior, 2, 'AP moved to Z under the conversion');
  assert.ok(frame.sane);
});

test('is invariant under arbitrary axis permutation', () => {
  // The detector must return the SAME anatomical assignment regardless of which
  // world axes the mesh arrives on. This is the property that makes two meshes
  // from different tools comparable.
  const base = syntheticQuadruped();
  const permutations = [
    [0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [2, 1, 0], [1, 0, 2],
  ];
  for (const mapping of permutations) {
    const frame = detectAnatomicalFrame(permute(base, mapping));
    // Under permutation `mapping`, original axis k lands at index mapping.indexOf(k).
    assert.equal(frame.medioLateral, mapping.indexOf(0), `ML wrong under ${mapping}`);
    assert.equal(frame.anteriorPosterior, mapping.indexOf(1), `AP wrong under ${mapping}`);
    assert.equal(frame.dorsoVentral, mapping.indexOf(2), `DV wrong under ${mapping}`);
  }
});

test('is invariant to uniform scale', () => {
  // The cast is ~9x smaller than the envelope; scale must not change the frame.
  const base = syntheticQuadruped();
  const scaled = base.map((p) => p.map((v) => v * 0.11));
  const a = detectAnatomicalFrame(base);
  const b = detectAnatomicalFrame(scaled);
  assert.deepEqual(
    [a.medioLateral, a.anteriorPosterior, a.dorsoVentral],
    [b.medioLateral, b.anteriorPosterior, b.dorsoVentral],
  );
});

test('reports unsane when the shape is not quadruped-like', () => {
  // A tall thin column: taller than it is long. The detector must NOT quietly
  // return a frame that downstream code would treat as scored.
  const points = [];
  for (let i = 0; i < 400; i += 1) {
    points.push([((i % 5) - 2) * 0.1, ((i % 3) - 1) * 0.1, i * 0.05]);
  }
  const frame = detectAnatomicalFrame(points);
  assert.equal(frame.sane, false);
  assert.ok(frame.sanityNotes.length > 0);
});

test('rejects empty input rather than returning a default frame', () => {
  assert.throws(() => detectAnatomicalFrame([]), /non-empty/);
});

test('distinguishes symmetry detection from extent ordering', () => {
  // THE DISCRIMINATING FIXTURE. On an ordinary quadruped the mediolateral axis
  // is also the shortest, so a symmetry detector and a naive shortest-extent
  // detector agree and every other test in this file passes under either.
  // Verified by sabotage: replacing the symmetry rule with shortest-extent left
  // all other contracts green.
  //
  // This body is DEEPER than it is WIDE — a crouched, barrel-chested stance —
  // so dorsoventral is the shortest axis while mediolateral remains the
  // symmetric one. Extent ordering gets it wrong here; symmetry gets it right.
  const points = [];
  for (let i = -50; i <= 50; i += 1) {
    for (const side of [-1, 1]) {
      for (let h = 0; h < 12; h += 1) {
        const p = [0, 0, 0];
        p[1] = i * 0.08;                                  // AP span ~8
        p[0] = side * (1.4 + 0.3 * Math.cos(i / 12));     // ML span ~3.4, symmetric
        p[2] = h * 0.20;                                  // DV span ~2.4, SHORTEST
        points.push(p);
      }
    }
  }
  // Asymmetric head so AP is not mistaken for the symmetric axis.
  for (let k = 0; k < 240; k += 1) {
    points.push([((k % 7) - 3) * 0.1, 4.4 + (k % 12) * 0.05, 2.3 + Math.floor(k / 60) * 0.05]);
  }

  const extents = [0, 1, 2].map(
    (i) => Math.max(...points.map((p) => p[i])) - Math.min(...points.map((p) => p[i])),
  );
  const shortest = extents.indexOf(Math.min(...extents));
  assert.equal(shortest, 2, 'fixture precondition: dorsoventral must be the shortest axis');

  const frame = detectAnatomicalFrame(points);
  assert.equal(frame.medioLateral, 0, 'mediolateral must come from symmetry, not from shortest extent');
  assert.notEqual(
    frame.medioLateral,
    shortest,
    'a shortest-extent detector would fail here; this is what makes the test discriminating',
  );
});

test('confidence collapses on a shape with no distinguishing symmetry', () => {
  // A symmetric cube has no unique mediolateral axis. Confidence must be low so
  // a caller can refuse to score, instead of the detector inventing an answer.
  const points = [];
  for (let x = -5; x <= 5; x += 1)
    for (let y = -5; y <= 5; y += 1)
      for (let z = -5; z <= 5; z += 1) points.push([x, y, z]);
  const frame = detectAnatomicalFrame(points);
  assert.ok(frame.confidence < 0.05, `expected low confidence, got ${frame.confidence}`);
});
