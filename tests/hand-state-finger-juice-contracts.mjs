import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createLiveFingerJuiceEmitterPacket,
  normalizeManoSurface,
} from '../hand-state-finger-juice.mjs';

const root = new URL('..', import.meta.url).pathname;
const page = readFileSync(join(root, 'hand-state-runtime.html'), 'utf8');
const viewer = readFileSync(join(root, 'hand-state-runtime.mjs'), 'utf8');
const solver = readFileSync(join(root, 'lerms-finger-juice-webgpu-core.js'), 'utf8');

const surface = normalizeManoSurface([
  [-1, -2, 0.5],
  [1, 2, -0.5],
]);
assert.ok(surface, 'MANO normalization returns a surface and transform');
assert.ok(surface.positions[0] > 0 && surface.positions[1] > 0, 'display transform rotates source x/y by pi so fingers point up without a reflection');
assert.ok(surface.positions[2] > 0, 'display transform preserves palm-facing depth');
assert.equal(surface.orientationContract, 'mano-proper-rotation-z-pi-v0');

const points = Array.from({ length: 21 }, () => [0, 0, 0]);
points[0] = [0, -0.4, 0];
points[1] = [-0.25, -0.1, 0];
points[2] = [-0.38, 0.02, 0];
points[3] = [-0.5, 0.12, 0];
points[4] = [-0.63, 0.22, 0];
points[5] = [-0.18, 0, 0];
points[6] = [-0.18, 0.32, 0];
points[7] = [-0.18, 0.66, 0];
points[8] = [-0.18, 1.0, 0];
points[9] = [0, 0, 0];
points[10] = [0, 0.34, 0];
points[11] = [0.25, 0.46, 0];
points[12] = [0.05, 0.2, 0];
points[13] = [0.18, 0, 0];
points[14] = [0.18, 0.3, 0];
points[15] = [0.18, 0.61, 0];
points[16] = [0.18, 0.92, 0];
points[17] = [0.34, -0.02, 0];
points[18] = [0.36, 0.24, 0];
points[19] = [0.38, 0.5, 0];
points[20] = [0.4, 0.76, 0];

const liveState = {
  runtimeOwner: 'hand-state-runtime',
  eventSequence: 42,
  frame: {
    authority: { sourceAuthority: 'live_simulation', freshness: 'fresh' },
    frame: { frameId: 'live-42', captureTimestampMs: 10_000 },
    source: { effectiveRoute: 'native_wilor_mini_mlx_detector_sidecar_live', model: 'WiLoR-MLX+HandDetector-MLX' },
    timing: { publishAgeMs: 8, stateStreamAgeMs: 0 },
    hand: { handedness: 'Right', confidence: 0.96, keypoints3d: points.map(([x, y, z]) => ({ x, y, z })) },
  },
};

const packet = createLiveFingerJuiceEmitterPacket(liveState, {
  manoTransform: { center: [0, 0, 0], scale: 1 },
  nowMs: 10_050,
});
assert.equal(packet.schema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(packet.simulation_authority, 'live_simulation');
assert.equal(packet.authority.simulation_safe, true);
assert.deepEqual(packet.emitters.filter(emitter => emitter.active).map(emitter => emitter.id), ['thumb', 'index', 'ring', 'pinky']);
assert.equal(packet.emitters.find(emitter => emitter.id === 'middle').emission_state, 'off', 'bent finger fails closed');
assert.ok(packet.emitters.filter(emitter => emitter.active).every(emitter => emitter.emission_state === 'jet'), 'active fingers only jet');
assert.ok(packet.emitters.every(emitter => emitter.emission_state !== 'dribble'), 'first live slice has no dribble state');

const stalePacket = createLiveFingerJuiceEmitterPacket({
  ...liveState,
  frame: { ...liveState.frame, authority: { sourceAuthority: 'stale_hold', freshness: 'stale' } },
}, { manoTransform: { center: [0, 0, 0], scale: 1 }, nowMs: 10_050 });
assert.equal(stalePacket.authority.simulation_safe, false);
assert.equal(stalePacket.active_emitter_count, 0);

assert.match(page, /id="finger-juice-canvas"/, 'live hand route has a composited fluid canvas');
assert.match(viewer, /createLiveFingerJuiceEmitterPacket/, 'viewer maps live hand frames into emitter packets');
assert.match(viewer, /setEmitterPacket/, 'viewer updates the live WebGPU emitter buffer');
assert.match(viewer, /createWebGPUFingerJuiceSolver/, 'viewer uses Big Papa WebGPU fluid solver');
assert.match(solver, /nextEmitterData\.data\.byteLength > emitterBufferByteLength/, 'GPU emitter storage detects live packet growth');
assert.match(solver, /emitterBuffer = device\.createBuffer/, 'GPU emitter storage can be replaced for larger live packets');
assert.match(solver, /bindGroup = createComputeBindGroup\(\)/, 'GPU emitter storage growth rebinds compute resources');
assert.doesNotMatch(solver, /expanded emitter packet has/, 'larger live emitter packets are not rejected by startup capacity');
assert.match(viewer, /cpuOracle:\s*false/, 'live hand route disables startup CPU oracle');
assert.match(solver, /options\.cpuOracle === false \? null/, 'WebGPU solver honors the no-oracle live initialization path');

console.log('hand-state finger-juice contracts passed');
