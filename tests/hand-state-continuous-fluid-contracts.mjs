import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeFingerFluidLiveInletPacket } from '../finger-fluid-webgpu-core.js';

const root = new URL('..', import.meta.url).pathname;
const viewer = readFileSync(join(root, 'hand-state-runtime.mjs'), 'utf8');
const fluid = readFileSync(join(root, 'finger-fluid-webgpu-core.js'), 'utf8');

assert.match(
  viewer,
  /createWebGPUFingerFluidSolver[\s\S]*from ['"]\.\/finger-fluid-webgpu-core\.js['"]/,
  'live Hand imports the continuous PBF liquid solver',
);
assert.match(viewer, /truthScene:\s*['"]live_hand_inlets['"]/, 'live Hand selects the dynamic fingertip-inlet scene');
assert.match(viewer, /rendererMode:\s*['"]screen_space_refraction['"]/, 'live Hand requests the continuous refracting liquid renderer');
assert.match(viewer, /setLiveInletPacket/, 'live Hand updates the continuous solver through its native inlet seam');
assert.match(
  viewer,
  /new THREE\.WebGPURenderer\(\{\s*canvas,\s*antialias:\s*true,\s*alpha:\s*true\s*\}\)/,
  'the upper MANO canvas preserves the continuous fluid rendered beneath it',
);
assert.match(viewer, /renderer\.setClearColor\([^,]+,\s*0\)/, 'the MANO canvas clears to transparent instead of an opaque black lid');
assert.match(viewer, /screenSpaceRefractionRenderFrameCount/, 'Hand debug truth exposes completed continuous-fluid render frames');
assert.doesNotMatch(
  viewer,
  /lerms-finger-juice-webgpu-core|createWebGPUFingerJuiceSolver/,
  'the old particle-splat bridge cannot masquerade as the continuous Hand route',
);

assert.match(fluid, /live_hand_inlets/, 'continuous solver declares the live fingertip inlet scene');
assert.match(fluid, /setLiveInletPacket/, 'continuous solver exposes a dynamic inlet update method');
assert.match(fluid, /webgpu-pbf-linked-cell-fluid-v0/, 'continuous route preserves PBF solver identity');
assert.match(fluid, /webgpu-screen-space-liquid-refraction-v0/, 'continuous route preserves refraction renderer identity');

const livePacket = normalizeFingerFluidLiveInletPacket({
  packet_id: 'live-five',
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: true },
  emitters: Array.from({ length: 5 }, (_, index) => ({
    id: `finger-${index}`,
    origin_world: [index * 0.1, 0.2, -0.8],
    aim_world: [0, 0.2, -1],
    radius: 0.05,
    strength: 1.1,
    active: true,
    emission_state: 'jet',
  })),
});
assert.equal(livePacket.activeInletCount, 5, 'all five extended fingers reach the native inlet packet');
assert.equal(livePacket.inlets.length, 5, 'native inlet packet has fixed GPU capacity');
assert.ok(livePacket.inlets.every(inlet => inlet.active && inlet.maximumSpeed > 0), 'live inlet descriptors preserve active flow');

const stalePacket = normalizeFingerFluidLiveInletPacket({
  simulation_authority: 'invalid',
  authority: { simulation_safe: false },
  emitters: [{ id: 'index', active: true, emission_state: 'jet', aim_world: [0, 0, -1] }],
});
assert.equal(stalePacket.activeInletCount, 0, 'stale hand authority fails closed at the solver inlet boundary');

console.log('hand-state continuous fluid contracts passed');
