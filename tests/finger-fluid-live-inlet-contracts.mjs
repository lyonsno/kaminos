import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fluid = await import('../finger-fluid-webgpu-core.js');
const {
  KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
  KAMINOS_FINGER_FLUID_LIVE_INLET_COHORT_CONTRACT,
  KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
  KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT,
  KAMINOS_FINGER_FLUID_LIVE_INLET_SOURCE_AUTHORITY_CONTRACT,
  KAMINOS_FINGER_FLUID_LIVE_INLET_WITNESS_CAMERA,
  KAMINOS_FINGER_FLUID_TRUTH_SCENES,
  createFingerFluidLiveInletPublicationState,
  measureFingerFluidLiveInletReleaseRealizability,
  measureFingerFluidLiveInletReleasePlan,
  measureFingerFluidLiveInletSchedulerCapacity,
  normalizeFingerFluidLiveInletPacket,
  planFingerFluidLiveInletEconomics,
  validateFingerFluidLiveInletCohortLedger,
  validateFingerFluidLiveInletCohortTrajectory,
  validateFingerFluidLiveInletDiagnosticsEpoch,
  validateFingerFluidLiveInletRuntimeReceipt,
} = fluid;

const source = readFileSync(new URL('../finger-fluid-webgpu-core.js', import.meta.url), 'utf8');
const benchSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witnessSource = readFileSync(new URL('../finger-fluid-truth-witness.mjs', import.meta.url), 'utf8');

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
assert.equal(
  KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
  'requested-effective-release-pool-residence-v1',
);
assert.equal(
  KAMINOS_FINGER_FLUID_LIVE_INLET_COHORT_CONTRACT,
  'gpu-particle-residence-cohort-v0',
);
assert.deepEqual(
  KAMINOS_FINGER_FLUID_LIVE_INLET_WITNESS_CAMERA,
  {
    yaw: -0.48,
    pitch: 0.3,
    distance: 3.25,
    target: [0, 0.12, -0.42],
  },
  'live-inlet evidence needs a stable source-focused camera instead of the full-playground overview',
);
assert.ok(
  KAMINOS_FINGER_FLUID_TRUTH_SCENES.includes('live_hand_inlets'),
  'the current solver must expose the dynamic live-hand truth scene',
);
assert.match(source, /function setLiveInletPacket\(packet\)/, 'the GPU solver must expose live inlet updates');
assert.match(source, /fn live_inlet_release_phase\(index: u32\) -> vec4<f32>/, 'live inlets need a GPU release schedule');
assert.match(
  source,
  /live_inlet_release_due\([\s\S]{0,180}params\.liveInletControl\.y[\s\S]{0,180}inletSample\.releaseSchedule/,
  'dormant live particles must obey the packet-local release schedule',
);
assert.match(source, /liveInletContract:\s*KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT/, 'debug truth must identify the effective inlet contract');
assert.match(source, /liveInletReleaseContract:\s*KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT/, 'debug truth must identify the effective source lifecycle');
assert.match(source, /setLiveInletPacket,/, 'the public solver API must return the live inlet setter');
assert.match(
  benchSource,
  /window\.kaminosFingerFluidBenchSetLiveInletPacket\s*=\s*setFingerFluidBenchLiveInletPacket/,
  'the Kaminos bench must expose the canonical live-inlet producer control to pinned consumers',
);
assert.match(witnessSource, /--live-inlet-packet/, 'the truth witness must accept an explicit live-inlet packet artifact');
assert.match(
  witnessSource,
  /--live-inlet-replacement-packet/,
  'the truth witness must exercise replacement while emitted particles from the prior packet remain resident',
);
assert.match(
  witnessSource,
  /--live-inlet-second-replacement-packet/,
  'the truth witness must exercise A -> B -> C replacement with two distinct resident predecessors',
);
assert.match(
  witnessSource,
  /initialLiveInletPacketSha256/,
  'the truth witness must preserve the exact source-bound initial packet artifact identity',
);
assert.match(
  witnessSource,
  /currentLiveInletPacketSha256/,
  'the truth witness must preserve the exact currently published packet artifact identity',
);
assert.match(
  witnessSource,
  /initialLiveInletPacketSha256[\s\S]*currentLiveInletPacketSha256[\s\S]*liveInletReplacementPacketSha256[\s\S]*liveInletSecondReplacementPacketSha256/,
  'multi-publication reports must name immutable source-bound digests separately from the current packet digest',
);
assert.doesNotMatch(
  witnessSource,
  /^\s{4}liveInletPacketSha256,\s*$/m,
  'the report must not pair the initial packet path with an ambiguously mutable packet digest',
);
assert.match(witnessSource, /liveInletPublicationReceipt/, 'the truth witness must preserve the bench publication receipt');
assert.match(
  witnessSource,
  /liveInletPublicationHistory/,
  'the truth witness must preserve every packet publication instead of overwriting predecessor evidence',
);
assert.match(
  witnessSource,
  /missing live-inlet packet/,
  'a live-hand witness must fail loud instead of presenting a dormant default pool as source evidence',
);
assert.match(
  witnessSource,
  /liveInletAgeRecycleCount[\s\S]*liveInletDistanceRecycleCount[\s\S]*priorGenerationAgeRecycleCount[\s\S]*priorGenerationDistanceRecycleCount/,
  'the live-hand witness must preserve GPU-authored recycle-reason telemetry',
);
assert.match(
  witnessSource,
  /densityParticleCount = sourceScene\s*\?\s*fluidTruthSnapshot\.activeParticleCount/,
  'source-scene density accounting must bind to active particles while dormant inventory remains retained',
);
assert.match(
  witnessSource,
  /effectiveTruthScene !== 'live_hand_inlets'\s*&&\s*fluidTruthSnapshot\.boundaryParticleCount <= 0/,
  'a finite live-hand source must not require support-boundary contact at every checkpoint while its explicit residence cohorts are airborne',
);
assert.match(
  witnessSource,
  /kaminosFingerFluidBenchSetCameraForWitness[\s\S]*KAMINOS_FINGER_FLUID_LIVE_INLET_WITNESS_CAMERA/,
  'the live-inlet witness must publish the canonical source-focused camera before collecting pixels',
);
assert.match(
  benchSource,
  /effectiveTruthScene === 'live_hand_inlets'[\s\S]{0,240}KAMINOS_FINGER_FLUID_LIVE_INLET_WITNESS_CAMERA/,
  'the operator bench and automated witness must share the same live-inlet framing contract',
);
assert.match(
  source,
  /liveInletActivated = currentLiveInletEconomics\.effectiveActiveInletCount > 0/,
  'initial activation must follow effective inventory rather than a requested source with zero budget',
);

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

const liveReleasePlan = measureFingerFluidLiveInletReleasePlan({
  packet_id: 'reserved-versus-active',
  route_identity: 'tests/reserved-versus-active',
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: true, stale: false },
  emitters: [{
    id: 'reserved-zero-rate',
    origin_world: [0, 0.2, -0.8],
    aim_world: [0, 0.2, -1],
    radius: 0.05,
    strength: 1.1,
    active: true,
    emission_state: 'jet',
    source_flux_particles_per_second: 0,
    active_budget_particles: 64,
  }],
}, 128);
assert.equal(liveReleasePlan.effectiveReservedInletCount, 1);
assert.equal(liveReleasePlan.effectiveActiveInletCount, 0);

assert.throws(
  () => normalizeFingerFluidLiveInletPacket({
    packet_id: 'too-many',
    simulation_authority: 'live_simulation',
    authority: { simulation_safe: true, stale: false },
    emitters: Array.from({ length: 6 }, (_, index) => ({
      id: `finger-${index}`,
      origin_world: [0, 0, -0.8],
      aim_world: [0, 0.2, -1],
      active: true,
      emission_state: 'jet',
    })),
  }),
  /emitter count 6 exceeds GPU capacity 5/,
  'the fixed GPU source capacity must fail loud instead of truncating authoritative emitters',
);

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
const staleEconomics = planFingerFluidLiveInletEconomics({
  packet_id: 'stale-request-preserved',
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: true, stale: true },
  emitters: [{
    id: 'index',
    origin_world: [0, 0, 0],
    aim_world: [0, 0, -1],
    active: true,
    emission_state: 'jet',
    source_flux_particles_per_second: 500,
    active_budget_particles: 100,
  }],
}, 2400);
assert.equal(staleEconomics.requestedActiveInletCount, 1);
assert.equal(staleEconomics.effectiveReservedInletCount, 0);
assert.equal(staleEconomics.effectiveActiveInletCount, 0);
assert.equal(staleEconomics.inlets[0].requested.active, true);
assert.equal(staleEconomics.inlets[0].requested.particleReleaseRate, 500);
assert.equal(staleEconomics.inlets[0].requested.releasePoolBudget, 100);
assert.equal(staleEconomics.inlets[0].effective.releaseAuthority, 'stale_source_authority');
assert.equal(staleEconomics.inlets[0].effective.releasePoolAuthority, 'stale_source_authority');

const unsafeEconomics = planFingerFluidLiveInletEconomics({
  packet_id: 'unsafe-request-preserved',
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: false, stale: false },
  emitters: [{
    id: 'index',
    origin_world: [0, 0, 0],
    aim_world: [0, 0, -1],
    active: true,
    emission_state: 'jet',
    source_flux_particles_per_second: 500,
    active_budget_particles: 100,
  }],
}, 2400);
assert.equal(unsafeEconomics.requestedActiveInletCount, 1);
assert.equal(unsafeEconomics.effectiveReservedInletCount, 0);
assert.equal(unsafeEconomics.effectiveActiveInletCount, 0);
assert.equal(unsafeEconomics.inlets[0].effective.releaseAuthority, 'simulation_unsafe');
assert.equal(unsafeEconomics.inlets[0].effective.releasePoolAuthority, 'simulation_unsafe');
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
  /liveInletScene && \(live_inlet_active_count\(\) == 0u/,
  'the shader must keep dormant inventory closed when no source remains authoritative',
);
assert.match(
  source,
  /!live_inlet_particle_has_budget\(index\)/,
  'the shader must keep inventory outside the effective release pool dormant',
);
assert.doesNotMatch(
  source,
  /recycleLiveInlet[\s\S]{0,180}liveSource\.tangentActive\.w/,
  'source deactivation must stop new releases without teleporting already-emitted material',
);

const economicsPacket = {
  packet_id: 'economics-explicit',
  route_identity: 'hand-state-runtime/canonical-economics',
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
    source_flux_particles_per_second: 900,
    active_budget_particles: 600,
    lifetime_seconds: 4.25,
    residence_distance_world: 9.5,
    optical_density_scale: 1.8,
    reconstruction_radius_scale: 1.4,
  }],
};
assert.equal(
  typeof planFingerFluidLiveInletEconomics,
  'function',
  'canonical live-inlet economics must be independently testable before GPU construction',
);
if (typeof planFingerFluidLiveInletEconomics === 'function') {
  const economics = planFingerFluidLiveInletEconomics(economicsPacket, 2400);
  assert.equal(economics.contract, KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT);
  assert.equal(economics.poolCapacity, 2400);
  assert.equal(economics.requestedActiveInletCount, 1);
  assert.equal(economics.effectiveActiveInletCount, 1);
  assert.equal(economics.effectiveReleasePoolBudget, 600);
  assert.equal(economics.unallocatedDormantParticleCount, 1800);
  assert.equal(economics.inlets[0].requested.particleReleaseRate, 900);
  assert.ok(
    Math.abs(
      economics.inlets[0].effective.aggregateResidenceCeilingParticleReleaseRate
        - (600 / 4.25),
    ) < 1e-9,
    'aggregate turnover remains diagnostic even though it is not scheduler authority',
  );
  assert.equal(
    economics.inlets[0].effective.particleReleaseRate,
    economics.inlets[0].effective.laneResidenceCeilingParticleReleaseRate,
    'published effective rate must respect sustainable turnover in every weighted lane',
  );
  assert.equal(economics.inlets[0].effective.releaseAuthority, 'explicit_particle_rate_scheduler_limited');
  assert.equal(economics.inlets[0].requested.releasePoolBudget, 600);
  assert.equal(economics.inlets[0].effective.releasePoolBudget, 600);
  assert.equal(economics.inlets[0].requested.residenceSeconds, 4.25);
  assert.equal(economics.inlets[0].effective.residenceSeconds, 4.25);
  assert.equal(economics.inlets[0].effective.residenceDistanceWorld, 9.5);
  assert.deepEqual(economics.inlets[0].opticalDensity, {
    requested: 1.8,
    effective: null,
    authority: 'consumer_owned_not_applied',
    appliedToPhysicalInlet: false,
  });
  assert.deepEqual(economics.inlets[0].reconstructionRadius, {
    requested: 1.4,
    effective: null,
    authority: 'consumer_owned_not_applied',
    appliedToPhysicalInlet: false,
  });
  assert.equal(
    measureFingerFluidLiveInletReleasePlan(economicsPacket, 2400).expectedParticleReleaseRate,
    economics.inlets[0].effective.particleReleaseRate,
    'release plans must use the published lane-realizable effective rate',
  );

  const opticsOnlyDelta = structuredClone(economicsPacket);
  opticsOnlyDelta.emitters[0].optical_density_scale = 7.5;
  opticsOnlyDelta.emitters[0].reconstruction_radius_scale = 3.25;
  const opticsOnlyEconomics = planFingerFluidLiveInletEconomics(opticsOnlyDelta, 2400);
  assert.equal(opticsOnlyEconomics.inlets[0].radius, economics.inlets[0].radius);
  assert.equal(opticsOnlyEconomics.inlets[0].maximumSpeed, economics.inlets[0].maximumSpeed);
  assert.equal(
    opticsOnlyEconomics.inlets[0].effective.particleReleaseRate,
    economics.inlets[0].effective.particleReleaseRate,
    'consumer-owned optical requests must not silently mutate physical release',
  );

  const overCapacity = structuredClone(economicsPacket);
  overCapacity.emitters[0].active_budget_particles = 2401;
  assert.throws(
    () => planFingerFluidLiveInletEconomics(overCapacity, 2400),
    /release-pool budget .* exceeds runtime capacity 2400/,
    'pool overcommit must fail loud instead of silently clamping',
  );

  const zeroBudget = structuredClone(economicsPacket);
  zeroBudget.emitters[0].active_budget_particles = 0;
  const zeroBudgetEconomics = planFingerFluidLiveInletEconomics(zeroBudget, 2400);
  assert.equal(zeroBudgetEconomics.requestedActiveInletCount, 1);
  assert.equal(
    zeroBudgetEconomics.effectiveActiveInletCount,
    0,
    'an active request with no release-pool inventory must not present as an effective source',
  );
  assert.equal(
    zeroBudgetEconomics.inlets[1].effective.releaseAuthority,
    'inactive_zero_release',
    'padded inactive descriptors must not claim geometry-derived release authority',
  );

  const schedulerLimited = structuredClone(economicsPacket);
  schedulerLimited.emitters[0].active_budget_particles = 1;
  schedulerLimited.emitters[0].source_flux_particles_per_second = 900;
  schedulerLimited.emitters[0].lifetime_seconds = 4.25;
  delete schedulerLimited.emitters[0].residence_distance_world;
  const schedulerLimitedEconomics = planFingerFluidLiveInletEconomics(schedulerLimited, 2400);
  assert.equal(schedulerLimitedEconomics.inlets[0].requested.particleReleaseRate, 900);
  assert.ok(
    Math.abs(
      schedulerLimitedEconomics.inlets[0].effective.particleReleaseRate - (1 / 4.25)
    ) < 1e-9,
    'one long-lived release slot must publish its sustainable residence-limited rate',
  );
  assert.ok(
    Math.abs(
      schedulerLimitedEconomics.inlets[0].effective.residenceCeilingParticleReleaseRate - (1 / 4.25)
    ) < 1e-9,
  );
  assert.equal(
    schedulerLimitedEconomics.inlets[0].effective.particleReleaseRate,
    Math.min(
      schedulerLimitedEconomics.inlets[0].requested.particleReleaseRate,
      schedulerLimitedEconomics.inlets[0].effective.schedulerCeilingParticleReleaseRate,
    ),
  );
  assert.equal(schedulerLimitedEconomics.inlets[0].effective.releaseSaturated, true);
  assert.equal(
    schedulerLimitedEconomics.inlets[0].effective.releaseAuthority,
    'explicit_particle_rate_scheduler_limited',
  );

  assert.equal(typeof measureFingerFluidLiveInletSchedulerCapacity, 'function');
  const schedulerCapacity = measureFingerFluidLiveInletSchedulerCapacity({
    radius: schedulerLimitedEconomics.inlets[0].radius,
    maximumSpeed: schedulerLimitedEconomics.inlets[0].maximumSpeed,
    releasePoolBudget: 10,
    residenceSeconds: 1 / 60,
    residenceDistanceWorld: Number.MAX_VALUE,
  });
  assert.ok(schedulerCapacity.laneDispatchCeilingParticleReleaseRate <= 600);
  assert.ok(schedulerCapacity.schedulerCeilingParticleReleaseRate <= 600);

  const laneResidenceCapacity = measureFingerFluidLiveInletSchedulerCapacity({
    radius: 0.1015,
    maximumSpeed: 1.107,
    releasePoolBudget: 200,
    residenceSeconds: 1.2,
    residenceDistanceWorld: Number.MAX_VALUE,
  });
  assert.ok(
    Math.abs(
      laneResidenceCapacity.residenceCeilingParticleReleaseRate
        - 119.25675337747023,
    ) < 1e-9,
    'multi-lane residence capacity must use the least sustainable weighted lane rather than aggregate budget divided by residence',
  );
  assert.ok(
    laneResidenceCapacity.residenceCeilingParticleReleaseRate < 200 / 1.2,
    'aggregate inventory must not overstate the rate realizable by a lane-weighted GPU schedule',
  );

  const zeroFlux = structuredClone(economicsPacket);
  zeroFlux.emitters[0].source_flux_particles_per_second = 0;
  const zeroFluxEconomics = planFingerFluidLiveInletEconomics(zeroFlux, 2400);
  assert.equal(zeroFluxEconomics.effectiveReservedInletCount, 1);
  assert.equal(
    zeroFluxEconomics.effectiveActiveInletCount,
    0,
    'reserved occupancy with zero effective release is not an active source',
  );

  const invalidFlux = structuredClone(economicsPacket);
  invalidFlux.emitters[0].source_flux_particles_per_second = 'not-a-number';
  assert.throws(
    () => planFingerFluidLiveInletEconomics(invalidFlux, 2400),
    /source release must be finite/,
    'an invalid explicit source flux must fail loud instead of falling back to geometry-derived release',
  );

  const unpackableLifetime = structuredClone(economicsPacket);
  unpackableLifetime.emitters[0].lifetime_seconds = Number.MAX_VALUE;
  assert.throws(
    () => planFingerFluidLiveInletEconomics(unpackableLifetime, 2400),
    /residence seconds must fit finite f32/,
    'producer values that cannot survive WGSL packing must fail before publication',
  );

  const defaultPacket = structuredClone(economicsPacket);
  delete defaultPacket.emitters[0].source_flux_particles_per_second;
  delete defaultPacket.emitters[0].active_budget_particles;
  delete defaultPacket.emitters[0].lifetime_seconds;
  delete defaultPacket.emitters[0].residence_distance_world;
  const defaultEconomics = planFingerFluidLiveInletEconomics(defaultPacket, 2400);
  assert.equal(defaultEconomics.inlets[0].effective.releaseAuthority, 'derived_from_aperture_and_speed');
  assert.equal(defaultEconomics.inlets[0].effective.residenceAuthority, 'legacy_default');
  assert.equal(defaultEconomics.inlets[0].effective.residenceDistanceAuthority, 'legacy_default');
}

assert.equal(typeof validateFingerFluidLiveInletDiagnosticsEpoch, 'function');
assert.doesNotThrow(() => validateFingerFluidLiveInletDiagnosticsEpoch(7, 7));
assert.throws(
  () => validateFingerFluidLiveInletDiagnosticsEpoch(7, 8),
  /packet generation changed during diagnostics readback/,
  'diagnostics must fail loud instead of labeling packet-A GPU bytes with packet-B identity',
);

assert.equal(typeof measureFingerFluidLiveInletReleaseRealizability, 'function');
if (typeof measureFingerFluidLiveInletReleaseRealizability === 'function') {
  assert.deepEqual(
    measureFingerFluidLiveInletReleaseRealizability({
      expectedParticleReleaseRate: 300,
      elapsedSteps: 279,
      predecessorBlockedReleaseCount: 155,
      observedParticleReleaseCount: 1240,
    }),
    {
      nominalExpectedParticleReleaseCount: 1395,
      predecessorBlockedReleaseCount: 155,
      realizableExpectedParticleReleaseCount: 1240,
      observedParticleReleaseCount: 1240,
      observedRealizableReleaseRatio: 1,
    },
    'successor release acceptance must subtract GPU-authored predecessor occupancy instead of weakening the ratio gate',
  );
}

assert.equal(typeof validateFingerFluidLiveInletCohortLedger, 'function');
const predecessorPublication = {
  generation: 1,
  packetId: 'packet-a',
  sourceRoute: 'tests/packet-a',
  artifactSha256: 'a'.repeat(64),
  expectedEconomics: {
    inlets: [{
      id: 'age-source',
      origin: [0, 0, 0],
      requested: { residenceSeconds: 0.75, residenceDistanceWorld: null },
      effective: { residenceSeconds: 0.75, residenceDistanceWorld: Number.MAX_VALUE },
    }, {
      id: 'distance-source',
      origin: [1, 0, 0],
      requested: { residenceSeconds: 10, residenceDistanceWorld: 0.55 },
      effective: { residenceSeconds: 10, residenceDistanceWorld: 0.55 },
    }],
  },
};
const exactCohortLedger = {
  contract: 'gpu-particle-residence-cohort-ledger-v1',
  generations: [{
    generation: 1,
    packetId: 'packet-a',
    sourceRoute: 'tests/packet-a',
    artifactSha256: 'a'.repeat(64),
    activeParticleCount: 12,
    ageRecycledDormantParticleCount: 3,
    distanceRecycledDormantParticleCount: 4,
    authorityMismatchCount: 0,
    unknownSourceCount: 0,
  }],
};
assert.doesNotThrow(() => validateFingerFluidLiveInletCohortLedger(
  [predecessorPublication],
  exactCohortLedger,
));
const forgedCohortLedger = structuredClone(exactCohortLedger);
forgedCohortLedger.generations[0].authorityMismatchCount = 1;
assert.throws(
  () => validateFingerFluidLiveInletCohortLedger([predecessorPublication], forgedCohortLedger),
  /cohort authority mismatch/,
  'generation counts cannot close replacement evidence when origin or residence law was reattributed',
);

assert.equal(
  typeof validateFingerFluidLiveInletCohortTrajectory,
  'function',
  'replacement acceptance must be an executable shared contract instead of witness-local arithmetic',
);
if (typeof validateFingerFluidLiveInletCohortTrajectory === 'function') {
  const publications = [
    predecessorPublication,
    {
      ...structuredClone(predecessorPublication),
      generation: 2,
      packetId: 'packet-b',
      sourceRoute: 'tests/packet-b',
      artifactSha256: 'b'.repeat(64),
    },
  ];
  const predecessorCurrentOnly = [{
    generation: 1,
    liveInletAgeRecycleCount: 8,
    liveInletDistanceRecycleCount: 9,
    priorGenerationAgeRecycleCount: 0,
    priorGenerationDistanceRecycleCount: 0,
    cohortLedger: exactCohortLedger,
  }, {
    generation: 2,
    liveInletAgeRecycleCount: 0,
    liveInletDistanceRecycleCount: 0,
    priorGenerationAgeRecycleCount: 3,
    priorGenerationDistanceRecycleCount: 4,
    cohortLedger: exactCohortLedger,
  }];
  assert.throws(
    () => validateFingerFluidLiveInletCohortTrajectory({
      publications,
      economics: predecessorCurrentOnly,
      replacementRequired: true,
    }),
    /current generation did not exercise both recycle reasons/,
    'predecessor current counters must not impersonate successor-current recycle coverage',
  );

  const threePublications = [
    predecessorPublication,
    {
      ...structuredClone(predecessorPublication),
      generation: 2,
      packetId: 'packet-b',
      sourceRoute: 'tests/packet-b',
      artifactSha256: 'b'.repeat(64),
    },
    {
      ...structuredClone(predecessorPublication),
      generation: 3,
      packetId: 'packet-c',
      sourceRoute: 'tests/packet-c',
      artifactSha256: 'c'.repeat(64),
    },
  ];
  const threeGenerationLedger = {
    contract: 'gpu-particle-residence-cohort-ledger-v1',
    generations: threePublications.map(publication => ({
      generation: publication.generation,
      packetId: publication.packetId,
      sourceRoute: publication.sourceRoute,
      artifactSha256: publication.artifactSha256,
      activeParticleCount: publication.generation === 3 ? 12 : 0,
      ageRecycledDormantParticleCount: publication.generation < 3 ? 2 : 1,
      distanceRecycledDormantParticleCount: publication.generation < 3 ? 3 : 1,
      authorityMismatchCount: 0,
      unknownSourceCount: 0,
    })),
  };
  const threeGenerationAcceptance = validateFingerFluidLiveInletCohortTrajectory({
    publications: threePublications,
    economics: [{
      generation: 3,
      liveInletAgeRecycleCount: 1,
      liveInletDistanceRecycleCount: 1,
      priorGenerationAgeRecycleCount: 4,
      priorGenerationDistanceRecycleCount: 6,
      cohortLedger: threeGenerationLedger,
    }],
    replacementRequired: true,
  });
  assert.deepEqual(
    threeGenerationAcceptance.predecessorGenerations,
    [1, 2],
    'A -> B -> C replacement must retain both predecessor generations as exact cohorts',
  );
}

assert.equal(
  typeof createFingerFluidLiveInletPublicationState,
  'function',
  'constructor-supplied packets need the same generation provenance as setter publications',
);
if (typeof createFingerFluidLiveInletPublicationState === 'function') {
  const initialEconomics = planFingerFluidLiveInletEconomics(economicsPacket, 2400);
  const initialReleasePlan = measureFingerFluidLiveInletReleasePlan(economicsPacket, 2400);
  const initialPublicationState = createFingerFluidLiveInletPublicationState(
    economicsPacket,
    initialEconomics,
    initialReleasePlan,
  );
  assert.equal(initialPublicationState.generation, 1);
  assert.equal(initialPublicationState.releaseEpochFrame, 0);
  assert.equal(initialPublicationState.publications.length, 1);
  assert.equal(initialPublicationState.publications[0].packetId, initialEconomics.packetId);
  assert.equal(initialPublicationState.publications[0].generation, 1);
  assert.deepEqual(
    createFingerFluidLiveInletPublicationState(null, null, null),
    { generation: 0, releaseEpochFrame: 0, publications: [] },
    'an absent constructor packet must remain unpublished generation zero',
  );
}
assert.match(
  source,
  /createFingerFluidLiveInletPublicationState\(\s*liveInletPacket,\s*currentLiveInletEconomics,\s*liveInletReleasePlan/,
  'the canonical GPU constructor must consume the publication-state contract',
);

assert.match(source, /economics:\s*vec4<f32>/, 'the GPU descriptor must carry producer economics');
assert.match(
  source,
  /materialTracers\[index\]\.liveInletOriginGeneration/,
  'the GPU recycle path must consume particle-local cohort residence authority',
);
assert.match(
  source,
  /params\.liveInletControl\.y/,
  'the GPU release scheduler must use a packet-local epoch instead of process-global frame zero',
);
assert.doesNotMatch(
  source,
  /let liveSource = liveInletPacket\.inlets\[live_inlet_source_from_phase\(particle\.velocity\.w\)\]/,
  'already-emitted particles must not inherit a replacement packet lifetime or origin',
);
assert.match(source, /liveInletAgeRecycleCount/, 'diagnostics must expose GPU-authored age recycle counts');
assert.match(source, /liveInletDistanceRecycleCount/, 'diagnostics must expose GPU-authored distance recycle counts');
assert.match(
  source,
  /predecessorBlockedReleaseCount:\s*interfaceCounters\[9\]/,
  'replacement diagnostics must expose GPU-authored successor releases blocked by predecessor occupancy',
);

assert.equal(
  typeof validateFingerFluidLiveInletRuntimeReceipt,
  'function',
  'the witness must use a shared exact receipt validator rather than aggregate spot checks',
);
if (typeof validateFingerFluidLiveInletRuntimeReceipt === 'function') {
  const expected = planFingerFluidLiveInletEconomics(economicsPacket, 2400);
  const exactReceipt = {
    schema: 'kaminos.finger-fluid.live-inlet-publication-receipt.v0',
    economicsContract: expected.contract,
    packetId: expected.packetId,
    sourceRoute: expected.sourceRoute,
    artifactSha256: 'fixture-sha256',
    runtimeEconomics: {
      ...expected,
      inlets: expected.inlets.map(inlet => ({
        id: inlet.id,
        origin: [...inlet.origin],
        axis: [...inlet.axis],
        radius: inlet.radius,
        maximumSpeed: inlet.maximumSpeed,
        requestedActive: inlet.requestedActive,
        active: inlet.active,
        activationAuthority: inlet.activationAuthority,
        requested: inlet.requested,
        effective: inlet.effective,
        opticalDensity: inlet.opticalDensity,
        reconstructionRadius: inlet.reconstructionRadius,
      })),
    },
  };
  assert.equal(
    validateFingerFluidLiveInletRuntimeReceipt(expected, exactReceipt, {
      artifactSha256: 'fixture-sha256',
    }).packetId,
    expected.packetId,
  );
  const decoyReceipt = structuredClone(exactReceipt);
  decoyReceipt.runtimeEconomics.inlets[0].effective.particleReleaseRate += 1;
  assert.throws(
    () => validateFingerFluidLiveInletRuntimeReceipt(expected, decoyReceipt, {
      artifactSha256: 'fixture-sha256',
    }),
    /runtime economics differs from requested economics/,
    'a stale or decoy producer with matching aggregate budget must fail the evidence contract',
  );
}

console.log('finger fluid live inlet contracts passed');
