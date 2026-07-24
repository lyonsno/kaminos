import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as optics from '../finger-fluid-webgpu-core.js';
import {
  createFingerFluidAnalyticImpactHandoffReceipt,
  createFingerFluidAnalyticJetDescriptor,
  measureFingerFluidAnalyticJetFirstImpact,
} from '../finger-fluid-analytic-impact-handoff.js';

assert.equal(
  typeof optics.createFingerFluidAnalyticCarrierOpticalGeometry,
  'function',
  'the renderer must expose a source-derived analytic carrier geometry builder',
);

const packet = {
  packet_id: 'analytic-optics-source-a',
  route_identity: 'tests/live-hand/analytic-optics-source-a',
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
const poolCapacity = 2400;
const economics = optics.planFingerFluidLiveInletEconomics(packet, poolCapacity);
const releasePlan = optics.measureFingerFluidLiveInletReleasePlan(packet, poolCapacity);
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
  sourceMechanicsRevision: '3db86bc203c954fb76d301e21b0ba7126d5c36be',
  handId: 'operator-right-hand',
  fingerId: 'index',
  inletId: 'index-finger',
  material: {
    id: 'juice-water-a',
    density: 998.2,
    chemistry: [0.2, 0.6, 0.1, 0.1],
  },
  sourceTimeInterval: [41, 41.5],
  gravity: [0, -9.81, 0],
  supportIdentity,
});
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
const particleCount = 12;
const transferDuration = particleCount / releasePlan.inlets[0].expectedParticleReleaseRate;
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
    velocities: Array.from({ length: particleCount }, () => impact.incomingVelocity),
    material: descriptor.material,
  },
  expectedParticleCount: particleCount,
  tolerances: {
    volumeAbsolute: 1e-10,
    momentumAbsolute: 1e-8,
  },
});

const geometry = optics.createFingerFluidAnalyticCarrierOpticalGeometry({
  descriptor,
  impact,
  handoffReceipt: receipt,
  sourceIndex: 0,
});

assert.equal(
  geometry.schema,
  'kaminos.finger-fluid.analytic-carrier-optical-geometry.v1',
);
assert.deepEqual(geometry.route, {
  requested: 'kaminos.finger-fluid.source-derived-swept-volume-quadrature.v0',
  effective: 'kaminos.finger-fluid.source-derived-swept-volume-quadrature.v0',
  fallback: null,
});
assert.equal(geometry.source.packetId, descriptor.source.packetId);
assert.equal(geometry.supportIdentity.supportEpoch, supportIdentity.supportEpoch);
assert.equal(geometry.handoffReceiptId, receipt.receiptId);
assert.equal(geometry.sourceIndex, 0);
assert.ok(geometry.sampleCount >= 2);
assert.equal(geometry.samples.length, geometry.sampleCount);
assert.deepEqual(geometry.samples[0].position, descriptor.inlet.origin);
assert.ok(
  Math.hypot(
    ...geometry.samples.at(-1).position.map(
      (value, axis) => value - impact.carrierPosition[axis],
    ),
  ) < 1e-6,
  'the optical carrier must terminate at the exact descriptor-bound first hit',
);
assert.ok(
  geometry.samples.every(sample => (
    Number.isFinite(sample.radius)
    && sample.radius > 0
    && sample.flightSeconds >= 0
    && sample.flightSeconds <= impact.flightSeconds
  )),
  'every quadrature sample must carry finite positive optical support inside the pre-impact interval',
);
assert.equal(geometry.ownership.preImpactCarrierVisible, true);
assert.equal(geometry.ownership.preImpactParticlesVisible, false);
assert.equal(geometry.ownership.postImpactCarrierVisible, false);
assert.equal(geometry.ownership.postImpactParticlesVisible, true);
assert.equal(geometry.particleSuppression.sourceIndex, 0);
assert.equal(geometry.particleSuppression.maximumParticleAgeSeconds, impact.flightSeconds);
assert.equal(
  geometry.particleSuppression.contract,
  'matching-source-pre-impact-age-exclusive-visibility-v0',
);
assert.equal(geometry.evidence.status, 'admitted');
assert.equal(geometry.evidence.blank, false);
assert.equal(geometry.evidence.partial, false);
assert.equal(geometry.evidence.doubleRendered, false);

assert.equal(
  typeof optics.createFingerFluidAnalyticCarrierGpuPayload,
  'function',
  'the renderer must expose deterministic carrier storage payload construction',
);
const visibleParticleRadius = 0.046;
const gpuPayload = optics.createFingerFluidAnalyticCarrierGpuPayload(
  geometry,
  visibleParticleRadius,
);
assert.equal(
  gpuPayload.schema,
  'kaminos.finger-fluid.analytic-carrier-gpu-payload.v1',
);
assert.equal(gpuPayload.sampleCount, geometry.sampleCount);
assert.equal(gpuPayload.particles.length, geometry.sampleCount * 16);
assert.equal(gpuPayload.neighborTopology.length, geometry.sampleCount * 36);
assert.equal(gpuPayload.materialTracers.length, geometry.sampleCount * 16);
assert.deepEqual(
  gpuPayload.particleSuppressionControls,
  [1, geometry.sourceIndex, impact.flightSeconds, descriptor.source.generation],
);
assert.deepEqual(gpuPayload.source, {
  packetId: descriptor.source.packetId,
  sourceRoute: descriptor.source.sourceRoute,
  artifactSha256: descriptor.source.artifactSha256,
  handId: descriptor.source.handId,
  fingerId: descriptor.source.fingerId,
  inletId: descriptor.source.inletId,
  generation: descriptor.source.generation,
  sourceMechanicsRevision: descriptor.source.sourceMechanicsRevision,
});
assert.equal(
  gpuPayload.particleSuppression.contract,
  'matching-source-pre-impact-age-exclusive-visibility-v0',
);
assert.equal(
  gpuPayload.evidence.ageContract,
  'gpu-material-tracer-release-age-v0',
  'carrier evidence must bind suppression to the dedicated source-owned age channel',
);
assert.equal(gpuPayload.evidence.blank, false);
assert.equal(gpuPayload.evidence.partial, false);
for (let index = 0; index < geometry.sampleCount; index += 1) {
  const particleOffset = index * 16;
  const topologyOffset = index * 36;
  const tracerOffset = index * 16;
  assert.deepEqual(
    Array.from(gpuPayload.particles.subarray(particleOffset, particleOffset + 3)),
    geometry.samples[index].position.map(Math.fround),
  );
  assert.equal(gpuPayload.materialTracers[tracerOffset + 10], -1);
  const reconstructedRadius = visibleParticleRadius
    * Math.cbrt(gpuPayload.neighborTopology[topologyOffset + 32])
    * 1.78;
  assert.ok(
    Math.abs(reconstructedRadius - geometry.samples[index].radius)
      <= Math.max(1e-7, geometry.samples[index].radius * 1e-5),
    'the accumulation shader must reconstruct the admitted flux-scaled carrier radius',
  );
}

assert.throws(
  () => optics.createFingerFluidAnalyticCarrierOpticalGeometry({
    descriptor,
    impact,
    handoffReceipt: receipt,
    sourceIndex: 0,
    effectiveRoute: 'fallback-spheres',
  }),
  error => (
    error?.code === 'fallback_analytic_carrier_optics'
    && error?.report?.phase === 'validate-route'
    && error?.report?.lastTrustworthyEvidence === 'no-optical-carrier-input-validated'
  ),
  'a fallback optical route must fail before it can look authoritative',
);

assert.throws(
  () => optics.createFingerFluidAnalyticCarrierOpticalGeometry({
    descriptor: {
      ...descriptor,
      supportIdentity: {
        ...descriptor.supportIdentity,
        remapEpoch: descriptor.supportIdentity.remapEpoch + 1,
      },
    },
    impact,
    handoffReceipt: receipt,
    sourceIndex: 0,
  }),
  error => (
    error?.code === 'analytic_carrier_identity_mismatch'
    && error?.report?.phase === 'validate-identity'
  ),
  'stale or mismatched moving-support identity must fail before geometry construction',
);

assert.throws(
  () => optics.createFingerFluidAnalyticCarrierOpticalGeometry({
    descriptor,
    impact,
    handoffReceipt: {
      ...receipt,
      ownership: {
        ...receipt.ownership,
        carrierOwnsTransferredInterval: true,
      },
    },
    sourceIndex: 0,
  }),
  error => (
    error?.code === 'invalid_analytic_handoff_receipt'
    && error?.report?.phase === 'validate-handoff'
  ),
  'a detached or double-owned handoff must fail before visual admission',
);

assert.throws(
  () => optics.createFingerFluidAnalyticCarrierOpticalGeometry({
    descriptor,
    impact,
    handoffReceipt: receipt,
    sourceIndex: 0,
    axialStepRadiusRatio: Number.POSITIVE_INFINITY,
  }),
  error => (
    error?.code === 'invalid_analytic_carrier_geometry'
    && error?.report?.phase === 'construct-geometry'
  ),
  'nonfinite geometry configuration must leave a durable pre-output failure report',
);

const rendererSource = await readFile(
  new URL('../finger-fluid-webgpu-core.js', import.meta.url),
  'utf8',
);
const browserSource = await readFile(
  new URL('../index.html', import.meta.url),
  'utf8',
);
assert.match(
  rendererSource,
  /struct RenderParams \{[\s\S]*analyticCarrierControls: vec4<f32>,[\s\S]*fn vs_accumulate/,
  'the accumulation shader must receive explicit analytic-carrier suppression controls',
);
assert.match(
  rendererSource,
  /matchingAnalyticCarrierSource[\s\S]*preImpactParticle[\s\S]*clip = vec4<f32>\(2\.0, 2\.0, 2\.0, 1\.0\)/,
  'the particle accumulation route must suppress only the matching pre-impact source cohort',
);
const suppressionReadsPositionW = (
  /preImpactParticle\s*=\s*particle\.position\.w\s*</.test(rendererSource)
);
const vorticityOverwritesPositionW = (
  /particles\[index\]\.position\.w\s*=\s*min\(omegaMagnitude/.test(rendererSource)
);
assert.equal(
  suppressionReadsPositionW && vorticityOverwritesPositionW,
  false,
  'analytic-carrier suppression age must not share particle storage with vorticity magnitude',
);
assert.match(
  rendererSource,
  /preImpactParticle\s*=\s*[\s\S]{0,120}materialTracers\[instanceIndex\]\.liveInletAgeState\.x\s*</,
  'analytic-carrier suppression must consume the source-owned stable live-inlet age channel',
);
assert.match(
  rendererSource,
  /function setAnalyticCarrierOpticalGeometry\(geometry\)[\s\S]*createFingerFluidAnalyticCarrierGpuPayload/,
  'the live renderer must admit carrier geometry through the tested GPU payload builder',
);
assert.match(
  rendererSource,
  /analyticCarrierAccumulationBindGroup[\s\S]*accumulationPass\.draw\(6, analyticCarrierSampleCount\)/,
  'the analytic carrier must accumulate into the same optical slab before the shared composite',
);
assert.match(
  browserSource,
  /resolveFingerFluidAnalyticCarrierMode[\s\S]*hybrid_analytic_carrier/,
  'the browser route must resolve an exact particle-only or hybrid analytic-carrier mode',
);
assert.match(
  browserSource,
  /createFingerFluidAnalyticJetDescriptor[\s\S]*measureFingerFluidAnalyticJetFirstImpact[\s\S]*createFingerFluidAnalyticImpactHandoffReceipt[\s\S]*createFingerFluidAnalyticCarrierOpticalGeometry/,
  'the browser smoke must construct the canonical source, first-hit, handoff, and optical geometry chain',
);
assert.match(
  browserSource,
  /fingerFluidBenchSolver\.setAnalyticCarrierOpticalGeometry\(geometry\)/,
  'the live bench must explicitly admit the source-derived carrier after solver creation',
);
assert.match(
  browserSource,
  /analyticCarrierOptics[\s\S]*requestedMode[\s\S]*effectiveMode[\s\S]*fallbackRoute/,
  'the browser-visible witness state must expose exact requested/effective carrier identity with null fallback',
);

console.log('finger fluid analytic carrier optics contracts passed');
