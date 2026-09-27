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
const equilibrium = {
  ...state,
  nodes: state.nodes.map((node, index) => ({
    ...node,
    displacement: index === 0 ? { x: 0.04, y: -0.09, z: 0 } : node.displacement,
  })),
};
const opened = buildArchVolumeFrame(state, equilibrium);
assert.deepEqual(opened.nodes[0].position, [0.04, -0.09, 0.18]);
assert.deepEqual(opened.brokenSegments[0], [0.04, -0.09, 0.18, 0.1, 0, 0.18]);
assert.equal(opened.nodes[0].componentId, state.nodes[0].componentId);
console.log('arch volume frame contracts passed');
