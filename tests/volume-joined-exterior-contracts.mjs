// kaminos-test: node
// Geometry of the provisional joined exterior: where the fine box sits in the
// exterior, and the ghost geometry handed to the fine producer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveJoinedExteriorGeometry, resolveJoinedExteriorWall } from '../volume-joined-exterior.mjs';

test('exterior geometry: scalar and per-axis extents centre the fine box in x/z, one cell above the floor', () => {
  for (const extent of [24, [24, 48, 24]]) {
    const g = resolveJoinedExteriorGeometry({ fineDims: [48, 96, 48], pitch: 2 / 48, ratio: 4, extent });
    assert.equal(g.admitted, true);
    assert.deepEqual(g.fineCoarse, [12, 24, 12]);
    assert.deepEqual(g.origin, [6, 1, 6]);
    assert.ok(g.shape[1] >= 26);
    assert.deepEqual(g.ghosts.originFine, [-24, -4, -24]);
    assert.equal(g.ghosts.cellWidthFine, 4);
    g.geometry.fine.min.forEach((v, a) => assert.ok(Math.abs(v - g.origin[a] * g.cellWidth) < 1e-12));
  }
  assert.deepEqual(resolveJoinedExteriorGeometry({ fineDims: [48, 96, 48], pitch: 2 / 48, ratio: 4, extent: [24, 48, 24] }).shape, [24, 48, 24]);
});

test('exterior geometry: refuses a ratio that does not divide the fine box and an extent without margins', () => {
  assert.match(resolveJoinedExteriorGeometry({ fineDims: [48, 96, 48], pitch: 2 / 48, ratio: 5, extent: 24 }).reason, /not-multiples/);
  assert.match(resolveJoinedExteriorGeometry({ fineDims: [48, 96, 48], pitch: 2 / 48, ratio: 4, extent: 13 }).reason, /too-small/);
});

test('exterior wall: side-relative slabs sit gap cells off the fine box', () => {
  const g = resolveJoinedExteriorGeometry({ fineDims: [48, 96, 48], pitch: 2 / 48, ratio: 4, extent: 24 });
  assert.deepEqual(resolveJoinedExteriorWall({ side: '+x', gap: 2, thickness: 2 }, g), { axis: 0, at: 20, thickness: 2, side: '+x', gap: 2 });
  assert.deepEqual(resolveJoinedExteriorWall({ side: '-z', gap: 2, thickness: 2 }, g), { axis: 2, at: 2, thickness: 2, side: '-z', gap: 2 });
  assert.equal(resolveJoinedExteriorWall({ side: '+x', gap: 9, thickness: 2 }, g).outside, true);
});
