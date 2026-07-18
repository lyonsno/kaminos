import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildLayeredStructuralWitnessScenario } from '../structural-material-3d-core.js';
import { buildLayeredStructuralCpuComponentOracle } from '../structural-material-3d-webgpu-tear.js';
import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  layeredStructuralHotSidecarObjectIdentity,
  validateLayeredStructuralHotBindingReceipt,
} from '../structural-material-3d-webgpu-hot-sidecar.js';
import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_VISUAL_AUTHORITY,
  buildLayeredStructuralGpuBindingMaterial,
} from '../structural-material-3d-webgpu-bind.js';

assert.equal(
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  'kaminos.structural-material.webgpu-resident-binding.v0',
  'resident binding has an explicit route distinct from fracture execution',
);

const scenario = buildLayeredStructuralWitnessScenario();
const cracked = scenario.states.cracked;
const cpuBound = scenario.states.bound;
const finalBondLiveness = cpuBound.bonds.map(bond => bond.alive);
const topology = buildLayeredStructuralCpuComponentOracle(cracked, finalBondLiveness);
const point = scenario.summaries.cracked.crackPath.find(edge => edge.bondKind === 'depth')?.midpoint ||
  scenario.summaries.cracked.crackPath[0].midpoint;
const effective = { point, radius: 0.22, strength: 1.25 };
const eventEpoch = 2;
const events = cracked.bonds.flatMap((bond, bondIndex) => {
  if (bond.alive || !finalBondLiveness[bondIndex]) return [];
  const distance = Math.hypot(
    bond.midpoint.x - point.x,
    bond.midpoint.y - point.y,
    bond.midpoint.z - point.z,
  );
  return [{
    eventEpoch,
    bondIndex,
    bondId: bond.id,
    bondKind: bond.bondKind,
    geometryRole: bond.geometryRole,
    cause: 'operator-binding',
    previousAlive: false,
    midpoint: { ...bond.midpoint },
    priorFailure: { stress: bond.lastStress, strain: bond.lastStrain },
    requestedStrength: effective.strength,
    effectiveStrength: Math.max(bond.strength, effective.strength),
    distance,
    energy: (effective.radius - distance) * effective.strength * (bond.bondKind === 'depth' ? 0.72 : 0.55),
  }];
});
const eventIndices = new Set(events.map(event => event.bondIndex));
const bondMutationState = cracked.bonds.map((bond, bondIndex) => ({
  bondIndex,
  bondId: bond.id,
  alive: finalBondLiveness[bondIndex],
  strength: cpuBound.bonds[bondIndex].strength,
  lastStress: bond.lastStress,
  lastStrain: bond.lastStrain,
  repaired: cpuBound.bonds[bondIndex].repaired,
  lastMutationEpoch: eventIndices.has(bondIndex) ? eventEpoch : 0,
}));
const lifecycle = {
  adapterRequestCount: 1,
  deviceRequestCount: 1,
  pipelineCreateCount: 4,
  bufferAllocationCount: 13,
  executionAttemptCount: 1,
  executionCount: 1,
  bindingAttemptCount: 1,
  bindingCount: 1,
  bindingDispatchCount: 1,
  bindEventCount: events.length,
  eventHeaderResetCount: 2,
  compactReadbackCount: 2,
  compactReadbackBufferCount: 2,
  fullValidationReadbackCount: 0,
  disposed: false,
};
const receipt = {
  schema: 'kaminos.structural-material.webgpu-resident-binding-receipt.v0',
  status: 'passed',
  requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  executionRoute: 'kaminos.structural-material.webgpu-hot-sidecar.v0',
  requestedBackend: 'webgpu',
  effectiveBackend: 'webgpu',
  cpuFallbackUsed: false,
  authority: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY,
  objectIdentity: layeredStructuralHotSidecarObjectIdentity(cracked),
  eventEpoch,
  lifecycle,
  gpuStructuralState: {
    finalBondLiveness,
    componentLabels: topology.labels,
    bondMutationState,
  },
  topology: {
    authority: 'webgpu-minimum-node-component-labels-v0',
    componentCount: topology.componentCount,
    componentLabels: topology.components.map(component => component.label),
    anchoredComponentLabel: topology.anchoredComponentLabel,
    anchoredComponentCount: topology.anchoredComponentCount,
    detachedComponentLabels: topology.detachedComponentLabels,
  },
  binding: { requested: effective, effective, eventCount: events.length, events, noOp: false },
};

assert.equal(validateLayeredStructuralHotBindingReceipt(cracked, receipt).ok, true);
const bound = buildLayeredStructuralGpuBindingMaterial(cracked, receipt);
assert.equal(bound.sympatheticBinding.authority, STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_VISUAL_AUTHORITY);
assert.equal(bound.sympatheticBinding.repairedBondCount, events.length);
assert.equal(bound.components.length, topology.componentCount);
assert.deepEqual(bound.bonds.map(bond => bond.alive), finalBondLiveness);
assert.equal(bound.sound.events.filter(event => event.kind === 'bind').length, events.length);
assert.ok(bound.nodes.some(node => node.displacement.x === 0), 'reconnected anchored topology returns to rest space');

const duplicate = structuredClone(receipt);
duplicate.eventEpoch = 3;
duplicate.lifecycle.bindingAttemptCount = 2;
duplicate.lifecycle.bindingCount = 2;
duplicate.lifecycle.bindingDispatchCount = 2;
duplicate.lifecycle.eventHeaderResetCount = 3;
duplicate.lifecycle.compactReadbackCount = 3;
duplicate.binding = { ...duplicate.binding, eventCount: 0, events: [], noOp: true };
duplicate.gpuStructuralState.bondMutationState.forEach(bond => {
  if (bond.lastMutationEpoch === eventEpoch) bond.lastMutationEpoch = eventEpoch;
});
assert.equal(
  validateLayeredStructuralHotBindingReceipt(bound, duplicate).ok,
  true,
  'duplicate contact over already-live edges is an exact zero-event no-op',
);
const crackedTopology = buildLayeredStructuralCpuComponentOracle(
  cracked,
  cracked.bonds.map(bond => bond.alive),
);
const falseNoOp = structuredClone(duplicate);
falseNoOp.gpuStructuralState.finalBondLiveness = cracked.bonds.map(bond => bond.alive);
falseNoOp.gpuStructuralState.componentLabels = crackedTopology.labels;
falseNoOp.gpuStructuralState.bondMutationState = cracked.bonds.map((bond, bondIndex) => ({
  bondIndex,
  bondId: bond.id,
  alive: bond.alive,
  strength: bond.strength,
  lastStress: bond.lastStress,
  lastStrain: bond.lastStrain,
  repaired: bond.repaired,
  lastMutationEpoch: 0,
}));
falseNoOp.topology = {
  authority: 'webgpu-minimum-node-component-labels-v0',
  componentCount: crackedTopology.componentCount,
  componentLabels: crackedTopology.components.map(component => component.label),
  anchoredComponentLabel: crackedTopology.anchoredComponentLabel,
  anchoredComponentCount: crackedTopology.anchoredComponentCount,
  detachedComponentLabels: crackedTopology.detachedComponentLabels,
};
assert.equal(
  validateLayeredStructuralHotBindingReceipt(cracked, falseNoOp).ok,
  false,
  'zero events cannot pass while the source still contains failed edges inside the binding contact',
);
const duplicateBound = buildLayeredStructuralGpuBindingMaterial(bound, duplicate);
assert.deepEqual(
  duplicateBound.sympatheticBinding,
  bound.sympatheticBinding,
  'a zero-event operation cannot replace the provenance of the visible repaired topology',
);

const outsideContact = structuredClone(receipt);
outsideContact.binding.events[0].midpoint.x = 0;
assert.equal(
  validateLayeredStructuralHotBindingReceipt(cracked, outsideContact).ok,
  false,
  'an event outside the submitted contact neighborhood cannot pass as binding evidence',
);
const duplicateEvent = structuredClone(receipt);
duplicateEvent.binding.events.push({ ...duplicateEvent.binding.events[0] });
duplicateEvent.binding.eventCount += 1;
assert.equal(
  validateLayeredStructuralHotBindingReceipt(cracked, duplicateEvent).ok,
  false,
  'duplicate mutation events cannot pass compact receipt validation',
);

const pageSource = readFileSync(new URL('../structural-material-3d.html', import.meta.url), 'utf8');
assert.doesNotMatch(
  pageSource,
  /bindLayeredStructuralConnectivity/,
  'the product Bind action cannot mutate authoritative connectivity on the CPU',
);
assert.match(pageSource, /requestGpuBinding/, 'the product Bind action reaches the resident sidecar');

console.log('structural-material-3d WebGPU binding contracts passed');
