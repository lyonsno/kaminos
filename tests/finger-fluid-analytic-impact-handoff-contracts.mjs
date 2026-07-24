import assert from 'node:assert/strict';

import {
  measureFingerFluidLiveInletReleasePlan,
  planFingerFluidLiveInletEconomics,
} from '../finger-fluid-webgpu-core.js';
import * as handoff from '../finger-fluid-analytic-impact-handoff.js';

const {
  KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA,
  KAMINOS_FINGER_FLUID_ANALYTIC_IMPACT_HANDOFF_SCHEMA,
  KAMINOS_FINGER_FLUID_ANALYTIC_OWNERSHIP_CONTRACT,
  createFingerFluidAnalyticImpactHandoffReceipt,
  createFingerFluidAnalyticJetDescriptor,
  measureFingerFluidAnalyticJetFirstImpact,
  sampleFingerFluidAnalyticJetAtTime,
  validateFingerFluidAnalyticImpactHandoffReceipt,
} = handoff;

assert.equal(
  KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA,
  'kaminos.finger-fluid.analytic-pre-impact-carrier.v1',
);
assert.equal(
  KAMINOS_FINGER_FLUID_ANALYTIC_IMPACT_HANDOFF_SCHEMA,
  'kaminos.finger-fluid.analytic-impact-handoff.v1',
);
assert.equal(
  KAMINOS_FINGER_FLUID_ANALYTIC_OWNERSHIP_CONTRACT,
  'exclusive-material-interval-carrier-to-particles-v0',
);

const packet = {
  packet_id: 'analytic-impact-source-a',
  route_identity: 'tests/live-hand/exact-source-a',
  artifact_sha256: 'a'.repeat(64),
  simulation_authority: 'live_simulation',
  authority: { simulation_safe: true, stale: false },
  emitters: [{
    id: 'index-finger',
    origin_world: [0.1, 1.2, -0.2],
    aim_world: [0.08, -1, 0.12],
    radius: 0.055,
    strength: 1.4,
    active: true,
    emission_state: 'jet',
    source_flux_particles_per_second: 720,
    active_budget_particles: 720,
    lifetime_seconds: 2,
    residence_distance_world: 3,
  }],
};
const economics = planFingerFluidLiveInletEconomics(packet, 2400);
const releasePlan = measureFingerFluidLiveInletReleasePlan(packet, 2400);
const publication = {
  generation: 7,
  packetId: economics.packetId,
  sourceRoute: economics.sourceRoute,
  artifactSha256: economics.artifactSha256,
};
const supportIdentity = {
  schema: 'kaminos.portable-macro-support-source.v1',
  sourceId: 'hill-support-source-a',
  providerRoute: '@kaminos/fluid-webgpu/portable-macro-support',
  artifactSha256: 'b'.repeat(64),
  terrainId: 'hill-of-hills-a',
  terrainGeneration: 13,
  transformEpoch: 21,
  topologyEpoch: 34,
  supportEpoch: 55,
  remapEpoch: 8,
  stale: false,
  fallbackRoute: null,
};

const descriptor = createFingerFluidAnalyticJetDescriptor({
  packet,
  economics,
  releasePlan,
  publication,
  sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
  handId: 'operator-right-hand',
  fingerId: 'index',
  inletId: 'index-finger',
  material: { id: 'juice-water-a', density: 998.2, chemistry: [0.2, 0.6, 0.1, 0.1] },
  sourceTimeInterval: [41.0, 41.5],
  gravity: [0, -9.81, 0],
  supportIdentity,
});
assert.equal(descriptor.schema, KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_SCHEMA);
assert.equal(descriptor.source.packetId, packet.packet_id);
assert.equal(descriptor.source.generation, 7);
assert.equal(descriptor.source.artifactSha256, packet.artifact_sha256);
assert.equal(descriptor.route.requested, 'kaminos.finger-fluid.analytic-ballistic-carrier.v0');
assert.equal(descriptor.route.effective, descriptor.route.requested);
assert.equal(descriptor.route.fallback, null);
assert.equal(descriptor.flux.volumePerSecond, releasePlan.inlets[0].physicalSourceFlux);
assert.equal(descriptor.opticalPolicyAuthority, 'consumer_owned_not_applied');

const initialSample = sampleFingerFluidAnalyticJetAtTime(descriptor, 0);
assert.deepEqual(initialSample.position, descriptor.inlet.origin);
assert.deepEqual(initialSample.velocity, descriptor.inlet.velocity);

const supportQuery = {
  identity: supportIdentity,
  maximumSignedDistanceRate: 32,
  sampleSignedDistance(position) {
    return {
      distance: position[1],
      point: [position[0], 0, position[2]],
      normal: [0, 1, 0],
    };
  },
};
const impact = measureFingerFluidAnalyticJetFirstImpact(descriptor, supportQuery, {
  maximumFlightSeconds: 2,
  bracketStepSeconds: 1 / 120,
  timeToleranceSeconds: 1e-7,
});
assert.equal(impact.state, 'hit');
assert.equal(impact.supportIdentity.supportEpoch, supportIdentity.supportEpoch);
assert.ok(impact.flightSeconds > 0 && impact.flightSeconds < 1);
assert.ok(Math.abs(impact.point[1]) < 1e-6);
assert.deepEqual(impact.normal, [0, 1, 0]);

const particleCount = 12;
const transferDuration = particleCount / releasePlan.inlets[0].expectedParticleReleaseRate;
const transferVolume = descriptor.flux.volumePerSecond * transferDuration;
const introducedVelocity = impact.incomingVelocity;
const receipt = createFingerFluidAnalyticImpactHandoffReceipt({
  descriptor,
  impact,
  supportQuery,
  transitionGeneration: 8,
  transitionInterval: [41, 41 + transferDuration],
  particleAllocation: {
    allocationId: 'canonical-pool-a/generation-8',
    particleIds: Array.from({ length: particleCount }, (_, index) => 600 + index),
    particleVolume: releasePlan.particleVolume,
    velocities: Array.from({ length: particleCount }, () => introducedVelocity),
    material: descriptor.material,
  },
  expectedParticleCount: particleCount,
  predecessorReceiptId: null,
  tolerances: {
    volumeAbsolute: 1e-10,
    momentumAbsolute: 1e-8,
  },
});
assert.equal(receipt.schema, KAMINOS_FINGER_FLUID_ANALYTIC_IMPACT_HANDOFF_SCHEMA);
assert.equal(receipt.ownership.contract, KAMINOS_FINGER_FLUID_ANALYTIC_OWNERSHIP_CONTRACT);
assert.equal(receipt.ownership.carrierOwnsTransferredInterval, false);
assert.equal(receipt.ownership.particlesOwnTransferredInterval, true);
assert.equal(receipt.transfer.particleCount, particleCount);
assert.ok(Math.abs(receipt.transfer.volume - transferVolume) < 1e-12);
assert.ok(receipt.conservation.volumeResidualAbsolute < 1e-12);
assert.ok(receipt.conservation.momentumResidualMagnitude < 1e-9);
assert.doesNotThrow(() => validateFingerFluidAnalyticImpactHandoffReceipt(receipt));

const roundTrippedDescriptor = JSON.parse(JSON.stringify(descriptor));
const roundTrippedImpact = JSON.parse(JSON.stringify(impact));
assert.doesNotThrow(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor: roundTrippedDescriptor,
    impact: roundTrippedImpact,
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41, 41 + transferDuration],
    particleAllocation: {
      allocationId: 'canonical-pool-a/round-trip',
      particleIds: Array.from({ length: particleCount }, (_, index) => 900 + index),
      particleVolume: releasePlan.particleVolume,
      velocities: Array.from({ length: particleCount }, () => introducedVelocity),
      material: roundTrippedDescriptor.material,
    },
    expectedParticleCount: particleCount,
  }),
  'portable descriptor and impact receipts must survive a JSON boundary without relying on object identity',
);

assert.throws(
  () => measureFingerFluidAnalyticJetFirstImpact(descriptor, {
    ...supportQuery,
    identity: { ...supportIdentity, remapEpoch: supportIdentity.remapEpoch + 1 },
  }),
  error => error?.code === 'stale_support_identity',
  'a remapped support cannot impersonate the descriptor-bound impact surface',
);
assert.throws(
  () => createFingerFluidAnalyticJetDescriptor({
    packet,
    economics,
    releasePlan,
    publication,
    sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
    handId: 'operator-right-hand',
    fingerId: 'index',
    inletId: 'index-finger',
    material: { id: 'juice-water-a', density: 998.2 },
    sourceTimeInterval: [41, 41.5],
    supportIdentity,
    fallbackRoute: 'screen-space-proxy',
  }),
  error => error?.code === 'fallback_carrier_route',
  'a fallback carrier route must fail before it can look authoritative',
);
assert.throws(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact: {
      ...impact,
      point: [999, 999, 999],
      incomingVelocity: [123, 456, 789],
    },
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41, 41 + transferDuration],
    particleAllocation: {
      allocationId: 'forged-impact-pool',
      particleIds: Array.from({ length: particleCount }, (_, index) => 1000 + index),
      particleVolume: releasePlan.particleVolume,
      velocities: Array.from({ length: particleCount }, () => [123, 456, 789]),
      material: descriptor.material,
    },
    expectedParticleCount: particleCount,
  }),
  error => error?.code === 'invalid_impact_receipt',
  'a caller-forged impact cannot mint a source-authoritative transfer receipt',
);
assert.throws(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact,
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41, 41 + transferDuration],
    particleAllocation: {
      allocationId: 'partial-pool',
      particleIds: Array.from({ length: particleCount - 1 }, (_, index) => 700 + index),
      particleVolume: releasePlan.particleVolume,
      velocities: Array.from({ length: particleCount - 1 }, () => introducedVelocity),
      material: descriptor.material,
    },
    expectedParticleCount: particleCount,
  }),
  error => error?.code === 'partial_particle_allocation',
  'a partial allocation must fail before the carrier relinquishes its interval',
);
assert.throws(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact,
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41, 41 + transferDuration],
    particleAllocation: {
      allocationId: 'duplicate-pool',
      particleIds: Array.from({ length: particleCount }, (_, index) => 800 + index),
      particleVolume: releasePlan.particleVolume,
      velocities: Array.from({ length: particleCount }, () => introducedVelocity),
      material: descriptor.material,
    },
    expectedParticleCount: particleCount,
    carrierRetainedMaterialIntervals: [[41, 41 + transferDuration]],
  }),
  error => error?.code === 'duplicate_material_ownership',
  'the carrier and particles cannot simultaneously claim the transferred material interval',
);
assert.throws(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact,
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41, 41 + transferDuration],
    particleAllocation: {
      allocationId: 'inflated-particle-volume-pool',
      particleIds: [1100, 1101, 1102],
      particleVolume: releasePlan.particleVolume * 4,
      velocities: Array.from({ length: 3 }, () => introducedVelocity),
      material: descriptor.material,
    },
    expectedParticleCount: 3,
  }),
  error => error?.code === 'particle_allocation_volume_mismatch'
    || error?.code === 'partial_particle_allocation',
  'inflating particle volume cannot let a partial canonical allocation close conservation',
);
assert.throws(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact,
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41.2, 41.2 + transferDuration],
    particleAllocation: {
      allocationId: 'wrong-source-cohort-pool',
      particleIds: Array.from({ length: particleCount }, (_, index) => 1200 + index),
      particleVolume: releasePlan.particleVolume,
      velocities: Array.from({ length: particleCount }, () => introducedVelocity),
      material: descriptor.material,
    },
    expectedParticleCount: particleCount,
  }),
  error => error?.code === 'transition_impact_mismatch',
  'a receipt can transfer only the source cohort whose emission time was measured at first impact',
);

const thinMovingImpact = measureFingerFluidAnalyticJetFirstImpact(descriptor, {
  identity: supportIdentity,
  maximumSignedDistanceRate: 2,
  sampleSignedDistance(_position, worldTime) {
    const elapsed = worldTime - descriptor.sourceTimeInterval[0];
    return {
      distance: Math.abs(elapsed - 0.012) - 0.001,
      point: [0, 0, 0],
      normal: [0, 1, 0],
    };
  },
}, {
  maximumFlightSeconds: 0.02,
  bracketStepSeconds: 0.01,
  timeToleranceSeconds: 1e-7,
});
assert.ok(
  thinMovingImpact.flightSeconds >= 0.0109 && thinMovingImpact.flightSeconds <= 0.0111,
  `conservative advancement must not skip a thin moving support: ${thinMovingImpact.flightSeconds}`,
);

const foreignPacket = structuredClone(packet);
foreignPacket.packet_id = 'analytic-impact-source-foreign';
foreignPacket.artifact_sha256 = 'f'.repeat(64);
const foreignReleasePlan = measureFingerFluidLiveInletReleasePlan(foreignPacket, 2400);
assert.throws(
  () => createFingerFluidAnalyticJetDescriptor({
    packet,
    economics,
    releasePlan: foreignReleasePlan,
    publication,
    sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
    handId: 'operator-right-hand',
    fingerId: 'index',
    inletId: 'index-finger',
    material: { id: 'juice-water-a', density: 998.2 },
    sourceTimeInterval: [41, 41.5],
    supportIdentity,
  }),
  error => error?.code === 'source_identity_mismatch',
  'a release plan from another exact source packet cannot supply carrier flux authority',
);

const forgedReleasePlan = structuredClone(releasePlan);
forgedReleasePlan.inlets[0].physicalSourceFlux *= 100;
forgedReleasePlan.inlets[0].expectedParticleReleaseRate *= 100;
assert.throws(
  () => createFingerFluidAnalyticJetDescriptor({
    packet,
    economics,
    releasePlan: forgedReleasePlan,
    publication,
    sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
    handId: 'operator-right-hand',
    fingerId: 'index',
    inletId: 'index-finger',
    material: { id: 'juice-water-a', density: 998.2 },
    sourceTimeInterval: [41, 41.5],
    supportIdentity,
  }),
  error => error?.code === 'source_economics_mismatch',
  'same-identity release values must still match canonical packet-derived economics',
);

const delayedFlightSeconds = impact.flightSeconds + 0.05;
const delayedJet = sampleFingerFluidAnalyticJetAtTime(descriptor, delayedFlightSeconds, 41);
const delayedSupport = supportQuery.sampleSignedDistance(delayedJet.position, delayedJet.worldTime);
const delayedImpact = {
  ...impact,
  sourceEmissionTime: delayedJet.sourceEmissionTime,
  flightSeconds: delayedFlightSeconds,
  worldTime: delayedJet.worldTime,
  carrierCutParameter: delayedFlightSeconds,
  carrierPosition: delayedJet.position,
  point: delayedSupport.point,
  normal: delayedSupport.normal,
  incomingVelocity: delayedJet.velocity,
  signedDistance: delayedSupport.distance,
};
assert.throws(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact: delayedImpact,
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41, 41 + transferDuration],
    particleAllocation: {
      allocationId: 'delayed-penetrating-impact-pool',
      particleIds: Array.from({ length: particleCount }, (_, index) => 1400 + index),
      particleVolume: releasePlan.particleVolume,
      velocities: Array.from({ length: particleCount }, () => delayedJet.velocity),
      material: descriptor.material,
    },
    expectedParticleCount: particleCount,
  }),
  error => error?.code === 'invalid_impact_receipt',
  'a later penetrating contact cannot impersonate the first support hit',
);

const forgedSerializedReceipt = structuredClone(receipt);
forgedSerializedReceipt.transfer.introducedVolume = 0;
forgedSerializedReceipt.transfer.introducedMomentum = [0, 0, 0];
forgedSerializedReceipt.conservation.volumeResidualAbsolute = 0;
forgedSerializedReceipt.conservation.momentumResidual = [0, 0, 0];
forgedSerializedReceipt.conservation.momentumResidualMagnitude = 0;
forgedSerializedReceipt.ownership.canonicalParticlesVisibleAfterImpact = false;
assert.throws(
  () => validateFingerFluidAnalyticImpactHandoffReceipt(forgedSerializedReceipt),
  error => error?.code === 'duplicate_material_ownership'
    || error?.code === 'conservation_failure',
  'detached validation must recompute conservation and require complete visibility transfer',
);

const nonCanonicalParticleIdsReceipt = structuredClone(receipt);
nonCanonicalParticleIdsReceipt.transfer.particleIds[0] = 'not-a-canonical-particle-id';
assert.throws(
  () => validateFingerFluidAnalyticImpactHandoffReceipt(nonCanonicalParticleIdsReceipt),
  error => error?.code === 'partial_particle_allocation',
  'detached validation must reject non-integer canonical particle ids',
);

const releasePlanAtDifferentPoolCapacity = measureFingerFluidLiveInletReleasePlan(packet, 4800);
assert.throws(
  () => createFingerFluidAnalyticJetDescriptor({
    packet,
    economics,
    releasePlan: releasePlanAtDifferentPoolCapacity,
    publication,
    sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
    handId: 'operator-right-hand',
    fingerId: 'index',
    inletId: 'index-finger',
    material: { id: 'juice-water-a', density: 998.2 },
    sourceTimeInterval: [41, 41.5],
    supportIdentity,
  }),
  error => error?.code === 'source_economics_mismatch',
  'economics and release authority from different canonical pool capacities cannot be mixed',
);

for (const [label, mutate, expectedCode] of [
  [
    'ownership transferred interval',
    candidate => { candidate.ownership.transferredInterval = [0, 1]; },
    'duplicate_material_ownership',
  ],
  [
    'retained carrier interval ledger',
    candidate => { delete candidate.ownership.carrierRetainedMaterialIntervals; },
    'duplicate_material_ownership',
  ],
  [
    'transition generation',
    candidate => { candidate.transfer.transitionGeneration = candidate.source.generation; },
    'invalid_transition_generation',
  ],
  [
    'receipt identity',
    candidate => {
      candidate.receiptId = 'forged-receipt';
      candidate.successorReceiptId = 'forged-successor';
    },
    'invalid_receipt_identity',
  ],
]) {
  const forgedReceipt = structuredClone(receipt);
  mutate(forgedReceipt);
  assert.throws(
    () => validateFingerFluidAnalyticImpactHandoffReceipt(forgedReceipt),
    error => error?.code === expectedCode,
    `detached validation must rebind ${label}`,
  );
}

const counterbalancedVelocities = Array.from(
  { length: particleCount },
  () => [...introducedVelocity],
);
counterbalancedVelocities[0] = [
  introducedVelocity[0] + 1000,
  introducedVelocity[1] - 500,
  introducedVelocity[2] + 250,
];
counterbalancedVelocities[1] = [
  introducedVelocity[0] - 1000,
  introducedVelocity[1] + 500,
  introducedVelocity[2] - 250,
];
assert.throws(
  () => createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact,
    supportQuery,
    transitionGeneration: 8,
    transitionInterval: [41, 41 + transferDuration],
    particleAllocation: {
      allocationId: 'counterbalanced-velocity-pool',
      particleIds: Array.from({ length: particleCount }, (_, index) => 1600 + index),
      particleVolume: releasePlan.particleVolume,
      velocities: counterbalancedVelocities,
      material: descriptor.material,
    },
    expectedParticleCount: particleCount,
  }),
  error => error?.code === 'noncanonical_particle_velocity',
  'aggregate momentum cancellation cannot hide noncanonical per-particle introduction velocity',
);

const malformedDigestPacket = structuredClone(packet);
malformedDigestPacket.artifact_sha256 = 'not-a-sha256';
const malformedDigestEconomics = planFingerFluidLiveInletEconomics(malformedDigestPacket, 2400);
const malformedDigestReleasePlan = measureFingerFluidLiveInletReleasePlan(
  malformedDigestPacket,
  2400,
);
assert.throws(
  () => createFingerFluidAnalyticJetDescriptor({
    packet: malformedDigestPacket,
    economics: malformedDigestEconomics,
    releasePlan: malformedDigestReleasePlan,
    publication: {
      generation: 7,
      packetId: malformedDigestEconomics.packetId,
      sourceRoute: malformedDigestEconomics.sourceRoute,
      artifactSha256: malformedDigestEconomics.artifactSha256,
    },
    sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
    handId: 'operator-right-hand',
    fingerId: 'index',
    inletId: 'index-finger',
    material: { id: 'juice-water-a', density: 998.2 },
    sourceTimeInterval: [41, 41.5],
    supportIdentity,
  }),
  error => error?.code === 'invalid_artifact_digest',
  'source artifact identity must be an exact SHA-256 digest',
);
assert.throws(
  () => createFingerFluidAnalyticJetDescriptor({
    packet,
    economics,
    releasePlan,
    publication,
    sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
    handId: 'operator-right-hand',
    fingerId: 'index',
    inletId: 'index-finger',
    material: { id: 'juice-water-a', density: 998.2 },
    sourceTimeInterval: [41, 41.5],
    supportIdentity: { ...supportIdentity, artifactSha256: 'fixture-label' },
  }),
  error => error?.code === 'invalid_artifact_digest',
  'portable support artifact identity must be an exact SHA-256 digest',
);

console.log('finger fluid analytic impact handoff contracts passed');
