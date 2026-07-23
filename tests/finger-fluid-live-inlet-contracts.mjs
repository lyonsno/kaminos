import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fluid = await import('../finger-fluid-webgpu-core.js');
const {
  KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
  KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT,
  KAMINOS_FINGER_FLUID_LIVE_INLET_SOURCE_AUTHORITY_CONTRACT,
  KAMINOS_FINGER_FLUID_TRUTH_SCENES,
  measureFingerFluidLiveInletReleasePlan,
  normalizeFingerFluidLiveInletPacket,
} = fluid;

const source = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');

assert.equal(
  KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
  'wgsl-live-hand-round-inlet-uniform-v1',
);
assert.equal(
  KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT,
  'gpu-dormant-pool-source-flux-release-v0',
);
assert.equal(
  KAMINOS_FINGER_FLUID_LIVE_INLET_SOURCE_AUTHORITY_CONTRACT,
  'new-release-fail-closed-emitted-material-persists-v0',
);
assert.ok(
  KAMINOS_FINGER_FLUID_TRUTH_SCENES.includes('live_hand_inlets'),
  'the current solver must expose the dynamic live-hand truth scene',
);
assert.match(source, /function setLiveInletPacket\(packet\)/, 'the GPU solver must expose live inlet updates');
assert.match(source, /fn live_inlet_release_phase\(index: u32\) -> vec4<f32>/, 'live inlets need a GPU release schedule');
assert.match(source, /live_inlet_release_due\(params\.frameIndex, inletSample\.releaseSchedule\)/, 'dormant live particles must obey the release schedule');
assert.match(source, /liveInletContract:\s*KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT/, 'debug truth must identify the effective inlet contract');
assert.match(source, /liveInletReleaseContract:\s*KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT/, 'debug truth must identify the effective source lifecycle');
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

assert.equal(
  typeof fluid.createFingerFluidLiveInletParticles,
  'function',
  'the dormant live-inlet inventory must be independently testable',
);
if (typeof fluid.createFingerFluidLiveInletParticles === 'function') {
  const particles = fluid.createFingerFluidLiveInletParticles(2400, {
    packet_id: 'active-at-boot',
    simulation_authority: 'live_simulation',
    authority: { simulation_safe: true, stale: false },
    emitters: [{
      id: 'index',
      origin_world: [0, 0, -0.8],
      aim_world: [0, 0.2, -1],
      radius: 0.05,
      strength: 1.1,
      active: true,
      emission_state: 'jet',
    }],
  });
  assert.equal(particles.length, 2400 * 16);
  let activeParticleCount = 0;
  for (let index = 0; index < 2400; index += 1) {
    const phase = particles[index * 16 + 11];
    if (phase >= 0) activeParticleCount += 1;
    assert.ok(Number.isFinite(phase), `particle ${index} must have finite lifecycle state`);
  }
  assert.equal(
    activeParticleCount,
    0,
    'an active packet must arm GPU release without filling the linked-cell neighborhood on the CPU',
  );
}

const setterStart = source.indexOf('  function setLiveInletPacket(packet) {');
const setterEnd = source.indexOf('\n  function dispatch(', setterStart);
assert.ok(setterStart >= 0 && setterEnd > setterStart, 'the live inlet setter must remain inspectable');
const setterSource = source.slice(setterStart, setterEnd);
assert.doesNotMatch(
  setterSource,
  /createLiveHandInletParticles|writeBuffer\(particleBuffer/,
  'packet updates must not replace the particle pool or activate it en masse',
);

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
assert.equal(
  measureFingerFluidLiveInletReleasePlan(stale).expectedParticleReleaseRate,
  0,
  'stale source authority must schedule no new particle release',
);
assert.match(
  source,
  /liveInletSourceAuthorityContract:\s*KAMINOS_FINGER_FLUID_LIVE_INLET_SOURCE_AUTHORITY_CONTRACT/,
  'debug truth must distinguish release authority from already-emitted material lifetime',
);
assert.match(
  source,
  /liveInletScene && live_inlet_active_count\(\) == 0u/,
  'the shader must keep dormant inventory closed when no source remains authoritative',
);
assert.doesNotMatch(
  source,
  /recycleLiveInlet[\s\S]{0,180}liveSource\.tangentActive\.w/,
  'source deactivation must stop new releases without teleporting already-emitted material',
);

console.log('finger fluid live inlet contracts passed');
