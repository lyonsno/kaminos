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
assert.ok(surface.positions[0] < 0 && surface.positions[1] > 0, 'display transform preserves camera x while inverting y so thumb side and finger direction both agree with the operator');
assert.ok(surface.positions[2] > 0, 'display transform preserves palm-facing depth');
assert.equal(surface.orientationContract, 'mano-camera-display-x-preserved-y-inverted-v1');

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
  viewport: { width: 1340, height: 1080 },
  nowMs: 10_050,
});
assert.equal(packet.schema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(packet.simulation_authority, 'live_simulation');
assert.equal(packet.authority.simulation_safe, true);
assert.deepEqual(packet.emitters.filter(emitter => emitter.active).map(emitter => emitter.id), ['thumb', 'index', 'ring', 'pinky']);
assert.equal(packet.emitters.find(emitter => emitter.id === 'middle').emission_state, 'off', 'bent finger fails closed');
assert.ok(packet.emitters.filter(emitter => emitter.active).every(emitter => emitter.emission_state === 'jet'), 'active fingers only jet');
assert.ok(packet.emitters.every(emitter => emitter.emission_state !== 'dribble'), 'first live slice has no dribble state');

const indexEmitter = packet.emitters.find(emitter => emitter.id === 'index');
const handFocalLength = 1080 / (2 * Math.tan((33 * Math.PI / 180) / 2));
const handDepth = 3.8;
const expectedIndexScreen = [
  1340 * 0.5 + points[8][0] * handFocalLength / handDepth,
  1080 * 0.5 - (-points[8][1] - 0.05) * handFocalLength / handDepth,
];
const fluidProjectionDepth = 4.25 - indexEmitter.origin_world[2];
const fluidProjectionScale = 1080 / (2 * Math.tan((Math.PI / 3.15) / 2)) / fluidProjectionDepth;
const actualIndexScreen = [
  1340 * 0.5 + indexEmitter.origin_world[0] * fluidProjectionScale,
  1080 * 0.5 - indexEmitter.origin_world[1] * fluidProjectionScale,
];
assert.ok(Math.abs(expectedIndexScreen[0] - actualIndexScreen[0]) < 1, 'finger-fluid x projection lands on the rendered fingertip');
assert.ok(Math.abs(expectedIndexScreen[1] - actualIndexScreen[1]) < 1, 'finger-fluid y projection lands on the rendered fingertip');

const stalePacket = createLiveFingerJuiceEmitterPacket({
  ...liveState,
  frame: { ...liveState.frame, authority: { sourceAuthority: 'stale_hold', freshness: 'stale' } },
}, { manoTransform: { center: [0, 0, 0], scale: 1 }, nowMs: 10_050 });
assert.equal(stalePacket.authority.simulation_safe, false);
assert.equal(stalePacket.active_emitter_count, 0);

assert.match(page, /id="finger-juice-canvas"/, 'live hand route has a composited fluid canvas');
assert.match(viewer, /createLiveFingerJuiceEmitterPacket/, 'viewer maps live hand frames into emitter packets');
assert.match(viewer, /setLiveInletPacket/, 'viewer updates the native continuous-fluid inlet buffer');
assert.match(viewer, /createWebGPUFingerFluidSolver/, 'viewer uses Big Papa continuous WebGPU fluid solver');
assert.match(solver, /nextEmitterData\.data\.byteLength > emitterBufferByteLength/, 'GPU emitter storage detects live packet growth');
assert.match(solver, /emitterBuffer = device\.createBuffer/, 'GPU emitter storage can be replaced for larger live packets');
assert.match(solver, /bindGroup = createComputeBindGroup\(\)/, 'GPU emitter storage growth rebinds compute resources');
assert.doesNotMatch(solver, /expanded emitter packet has/, 'larger live emitter packets are not rejected by startup capacity');
assert.match(solver, /particle\.flags\.y < 0\.5[\s\S]*respawnParticle/, 'particles initialized without emitters can activate when live emitters arrive');
assert.match(viewer, /particleCount:\s*18_000/, 'live continuous route uses the bounded interactive particle population');
assert.match(viewer, /densityIterations:\s*2/, 'live continuous route avoids the truth-bench density cost');

console.log('hand-state finger-juice contracts passed');
