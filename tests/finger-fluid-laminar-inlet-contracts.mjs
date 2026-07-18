import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const webgpuCorePath = join(root, 'finger-fluid-webgpu-core.js');
const webgpuCoreSource = readFileSync(webgpuCorePath, 'utf8');
const witnessSource = readFileSync(join(root, 'finger-fluid-bench-witness.mjs'), 'utf8');
const webgpuCore = await import(webgpuCorePath);

assert.equal(
  webgpuCore.KAMINOS_FINGER_FLUID_LAMINAR_INLET_CONTRACT,
  'wgsl-descriptor-laminar-inlet-recycling-v0',
  'laminar inlets have an explicit solver-owned route',
);
assert.equal(
  webgpuCore.KAMINOS_FINGER_FLUID_LAMINAR_FIXTURE_CONTRACT,
  'wgsl-analytic-laminar-inlet-fixture-presentation-v0',
  'the mathematical apertures have a named operator-visible presentation route',
);
assert.deepEqual(
  webgpuCore.KAMINOS_FINGER_FLUID_INLET_PROFILES,
  ['round_poiseuille', 'slot_poiseuille', 'porous_darcy'],
  'resolved round/slot apertures and homogenized porous flux remain distinct mechanisms',
);
assert.ok(
  webgpuCore.KAMINOS_FINGER_FLUID_TRUTH_SCENES.includes('laminar_inlets'),
  'the operator can request the laminar inlet playground explicitly',
);

const descriptors = webgpuCore.createFingerFluidLaminarInletDescriptors();
assert.deepEqual(descriptors.map(descriptor => descriptor.profile), webgpuCore.KAMINOS_FINGER_FLUID_INLET_PROFILES);
assert.deepEqual(descriptors.map(descriptor => descriptor.id), ['round-spout', 'slot-spout', 'porous-patch']);

const [round, slot, porous] = descriptors;
const roundCenter = webgpuCore.evaluateFingerFluidLaminarInletProfile(round, [0, 0]);
const roundHalfRadius = webgpuCore.evaluateFingerFluidLaminarInletProfile(round, [round.radius * 0.5, 0]);
const roundWall = webgpuCore.evaluateFingerFluidLaminarInletProfile(round, [round.radius, 0]);
const roundOutside = webgpuCore.evaluateFingerFluidLaminarInletProfile(round, [round.radius * 1.01, 0]);
assert.equal(roundCenter.axialSpeed, round.maximumSpeed);
assert.ok(Math.abs(roundHalfRadius.axialSpeed - round.maximumSpeed * 0.75) < 1e-12);
assert.equal(roundWall.axialSpeed, 0, 'resolved round-spout no-slip profile reaches zero at the wall');
assert.equal(roundOutside.inside, false);

const slotCenter = webgpuCore.evaluateFingerFluidLaminarInletProfile(slot, [0, 0]);
const slotWide = webgpuCore.evaluateFingerFluidLaminarInletProfile(slot, [slot.halfWidth * 0.9, 0]);
const slotWall = webgpuCore.evaluateFingerFluidLaminarInletProfile(slot, [0, slot.halfHeight]);
assert.equal(slotCenter.axialSpeed, slot.maximumSpeed);
assert.equal(slotWide.axialSpeed, slot.maximumSpeed, 'slot flow is uniform across its long axis');
assert.equal(slotWall.axialSpeed, 0, 'slot profile reaches zero at the narrow wall');

const porousCenter = webgpuCore.evaluateFingerFluidLaminarInletProfile(porous, [0, 0]);
const porousEdge = webgpuCore.evaluateFingerFluidLaminarInletProfile(porous, [porous.halfWidth, porous.halfHeight]);
assert.equal(porousCenter.axialSpeed, porous.maximumSpeed);
assert.equal(porousEdge.axialSpeed, porous.maximumSpeed, 'sub-kernel pores use one homogenized Darcy normal flux');
assert.equal(porousCenter.resolutionMode, 'homogenized_sub_kernel_porous_flux');

const roundFlux = webgpuCore.measureFingerFluidLaminarInletFlux(round);
const slotFlux = webgpuCore.measureFingerFluidLaminarInletFlux(slot);
const porousFlux = webgpuCore.measureFingerFluidLaminarInletFlux(porous);
assert.ok(Math.abs(roundFlux - Math.PI * round.radius ** 2 * round.maximumSpeed * 0.5) < 1e-12);
assert.ok(Math.abs(slotFlux - (8 / 3) * slot.halfWidth * slot.halfHeight * slot.maximumSpeed) < 1e-12);
assert.ok(Math.abs(porousFlux - 4 * porous.halfWidth * porous.halfHeight * porous.maximumSpeed) < 1e-12);

const allocations = [0, 0, 0];
for (let index = 0; index < 1000; index += 1) {
  const allocation = webgpuCore.allocateFingerFluidLaminarInletParticle(index);
  allocations[allocation.sourceIndex] += 1;
  assert.equal(allocation.localOrdinal, Math.floor(index / 10));
}
assert.deepEqual(allocations, [400, 300, 300], 'finite particle pool allocation remains exact and uncapped');

for (let index = 0; index < 300; index += 1) {
  const sample = webgpuCore.sampleFingerFluidLaminarInletParticle(index, descriptors);
  const descriptor = descriptors[sample.sourceIndex];
  const relative = sample.position.map((value, axis) => value - descriptor.origin[axis]);
  const axialPosition = relative.reduce((sum, value, axis) => sum + value * descriptor.axis[axis], 0);
  const axialVelocity = sample.velocity.reduce((sum, value, axis) => sum + value * descriptor.axis[axis], 0);
  assert.ok(axialPosition <= 1e-12 && axialPosition >= -descriptor.reservoirLength - 1e-12);
  assert.ok(axialVelocity >= 0 && axialVelocity <= descriptor.maximumSpeed + 1e-12);
  assert.equal(sample.profile, descriptor.profile);
}

const diagnosticParticleCount = 1000;
const diagnosticParticles = new Float32Array(diagnosticParticleCount * 16);
for (let index = 0; index < diagnosticParticleCount; index += 1) {
  const sample = webgpuCore.sampleFingerFluidLaminarInletParticle(index, descriptors);
  const offset = index * 16;
  diagnosticParticles.set(sample.position, offset);
  diagnosticParticles.set(sample.velocity, offset + 8);
  diagnosticParticles[offset + 11] = sample.phase;
}
const inletDiagnostics = webgpuCore.measureFingerFluidLaminarInletDiagnostics(
  diagnosticParticles,
  diagnosticParticleCount,
  descriptors,
);
assert.equal(inletDiagnostics.schema, 'kaminos.finger-fluid.laminar-inlet-diagnostics.v0');
assert.equal(inletDiagnostics.particleCount, diagnosticParticleCount);
assert.equal(inletDiagnostics.accountedParticleCount, diagnosticParticleCount);
assert.deepEqual(inletDiagnostics.inlets.map(inlet => inlet.taggedParticleCount), [400, 300, 300]);
for (const inlet of inletDiagnostics.inlets) {
  assert.equal(inlet.taggedParticleCount, inlet.expectedParticleCount);
  assert.equal(inlet.inletCoreParticleCount, inlet.taggedParticleCount);
  assert.ok(inlet.profileNormalizedRmse < 1e-6, JSON.stringify(inlet));
  assert.ok(inlet.meanCrossflowRatio < 1e-6, JSON.stringify(inlet));
  assert.equal(inlet.positiveAxialFlowRatio, 1);
  assert.ok(Math.abs(inlet.effectiveFluxGain - 1) < 1e-6, JSON.stringify(inlet));
  assert.ok(Math.abs(inlet.measuredFlux - inlet.expectedFlux) < 1e-6, JSON.stringify(inlet));
}

assert.match(webgpuCoreSource, /fn laminar_inlet_sample\(index: u32\) -> LaminarInletSample/);
assert.match(webgpuCoreSource, /fn apply_laminar_inlet_boundary/);
assert.match(webgpuCoreSource, /params\.particleShift\.z > 0\.5/);
assert.match(webgpuCoreSource, /inletCoreWeight/);
assert.match(webgpuCoreSource, /confinementActivity[\s\S]*\(1\.0 - inletCoreWeight/);
assert.doesNotMatch(webgpuCoreSource, /individually_resolved_sub_kernel_pores/);
assert.match(webgpuCoreSource, /ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT/);
assert.match(webgpuCoreSource, /ANALYTIC_SUPPORT_SLOT_INLET_VERTEX_COUNT/);
assert.match(webgpuCoreSource, /ANALYTIC_SUPPORT_POROUS_INLET_VERTEX_COUNT/);
assert.match(webgpuCoreSource, /homogenized_visual_boundary_not_resolved_pore_geometry/);
assert.match(webgpuCoreSource, /implicit_prescribed_inlet_core_no_separate_mesh_collision_v0/);
assert.match(webgpuCoreSource, /safeTruthScene === 'laminar_inlets'[\s\S]*ANALYTIC_SUPPORT_INLET_FIXTURE_VERTEX_COUNT/);
assert.match(witnessSource, /laminar inlet diagnostics missing or partial/);
assert.match(witnessSource, /laminar inlet profile fit escaped its analytic contract/);
assert.match(witnessSource, /laminar inlet flux escaped its analytic contract/);
assert.match(witnessSource, /laminar inlet developed material crossflow before release/);

console.log('finger fluid laminar inlet contracts passed');
