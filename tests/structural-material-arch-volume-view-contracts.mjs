import assert from 'node:assert/strict';
import { buildArchVolumeFrame } from '../structural-material-arch-volume-view.js';

const state = {
  layers: 3,
  nodes: [
    { x: 0, y: 0, z: 0.18, layer: 2, componentId: 0, pinned: false, displacement: { x: 0.02, y: -0.03, z: 0 } },
    { x: 0.1, y: 0, z: 0.18, layer: 2, componentId: 1, pinned: true, displacement: { x: 0, y: 0, z: 0 } },
  ],
  bonds: [{ a: 0, b: 1, alive: false, lastStrain: 0.08 }],
  components: [{ id: 0, size: 1 }, { id: 1, size: 1 }],
};

const frame = buildArchVolumeFrame(state);
assert.equal(frame.nodes.length, 2);
assert.deepEqual(frame.nodes[0].position, [0.02, -0.03, 0.18]);
assert.equal(frame.nodes[0].componentId, 0);
assert.equal(frame.nodes[0].strain, 0.08);
assert.equal(frame.nodes[1].pinned, true);
assert.equal(frame.brokenSegments.length, 1);
assert.deepEqual(frame.brokenSegments[0], [0.02, -0.03, 0.18, 0.1, 0, 0.18]);
console.log('arch volume frame contracts passed');
