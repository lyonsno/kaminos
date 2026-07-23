import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
  KAMINOS_FINGER_FLUID_TRUTH_SCENES,
  normalizeFingerFluidLiveInletPacket,
} from '../finger-fluid-webgpu-core.js';

const source = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');

assert.equal(
  KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
  'wgsl-live-hand-round-inlet-uniform-v0',
);
assert.ok(
  KAMINOS_FINGER_FLUID_TRUTH_SCENES.includes('live_hand_inlets'),
  'the current solver must expose the dynamic live-hand truth scene',
);
assert.match(source, /function setLiveInletPacket\(packet\)/, 'the GPU solver must expose live inlet updates');
assert.match(source, /liveInletContract:\s*KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT/, 'debug truth must identify the effective inlet contract');
assert.match(source, /setLiveInletPacket,/, 'the public solver API must return the live inlet setter');

const live = normalizeFingerFluidLiveInletPacket({
  packet_id: 'live-five',
  route_identity: 'hand-state-runtime/native_wilor_mini_mlx_detector_sidecar_live',
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: true, stale: false },
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

assert.equal(live.activeInletCount, 5, 'all five authoritative extended fingers remain active');
assert.equal(live.inlets.length, 5, 'the packet has fixed GPU capacity');
assert.equal(live.packetId, 'live-five');
assert.match(live.sourceRoute, /native_wilor_mini_mlx_detector_sidecar_live/);
assert.ok(live.inlets.every(inlet => inlet.active && inlet.maximumSpeed > 0));

const unsafe = normalizeFingerFluidLiveInletPacket({
  packet_id: 'unsafe',
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: false, stale: false },
  emitters: [{
    id: 'index',
    origin_world: [0, 0, 0],
    aim_world: [0, 0, -1],
    active: true,
    emission_state: 'jet',
  }],
});
assert.equal(unsafe.activeInletCount, 0, 'unsafe source authority fails closed');

const stale = normalizeFingerFluidLiveInletPacket({
  packet_id: 'stale',
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: true, stale: true },
  emitters: [{
    id: 'index',
    origin_world: [0, 0, 0],
    aim_world: [0, 0, -1],
    active: true,
    emission_state: 'jet',
  }],
});
assert.equal(stale.activeInletCount, 0, 'stale source authority fails closed');

console.log('finger fluid live inlet contracts passed');
