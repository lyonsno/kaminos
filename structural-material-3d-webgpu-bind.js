import { buildLayeredStructuralSound } from './structural-material-3d-core.js';
import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY,
  STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  validateLayeredStructuralHotBindingReceipt,
} from './structural-material-3d-webgpu-hot-sidecar.js';

export const STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_VISUAL_AUTHORITY =
  'gpu-binding-labels-to-visible-reconnection-v0';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function assertReceipt(condition, message) {
  if (!condition) throw new Error(`GPU resident binding receipt ${message}`);
}

function componentsFromLabels(state, componentLabels) {
  const byLabel = new Map();
  state.nodes.forEach((node, index) => {
    const label = componentLabels[index];
    assertReceipt(Number.isInteger(label) && label >= 0 && label < state.nodes.length, 'contains an invalid component label');
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(index);
  });
  return [...byLabel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([label, nodeIndices]) => {
      assertReceipt(label === Math.min(...nodeIndices), 'contains a noncanonical component label');
      const nodes = nodeIndices.map(index => state.nodes[index]);
      return {
        id: `g${label}`,
        label,
        nodeIds: nodes.map(node => node.id),
        nodeCount: nodes.length,
        pinned: nodes.some(node => node.pinned),
        center: {
          x: round(nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length),
          y: round(nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length),
          z: round(nodes.reduce((sum, node) => sum + node.z, 0) / nodes.length),
        },
      };
    });
}

export function buildLayeredStructuralGpuBindingMaterial(state, receipt) {
  assertReceipt(receipt?.status === 'passed', 'did not pass');
  assertReceipt(receipt.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE, 'effective route mismatch');
  assertReceipt(receipt.effectiveBackend === 'webgpu', 'effective backend mismatch');
  assertReceipt(receipt.cpuFallbackUsed === false, 'used a CPU fallback');
  assertReceipt(receipt.authority === STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY, 'authority mismatch');
  const validation = validateLayeredStructuralHotBindingReceipt(state, receipt);
  assertReceipt(validation.ok, `failed compact validation: ${validation.reasons.join(', ')}`);
  if (receipt.binding.eventCount === 0) return state;

  const finalBondLiveness = receipt.gpuStructuralState.finalBondLiveness;
  const componentLabels = receipt.gpuStructuralState.componentLabels;
  const components = componentsFromLabels(state, componentLabels);
  const anchored = components.filter(component => component.pinned);
  assertReceipt(anchored.length === 1, 'does not identify exactly one anchored component');
  assertReceipt(anchored[0].label === receipt.topology.anchoredComponentLabel, 'anchored component differs from topology receipt');

  const eventsByBondIndex = new Map(receipt.binding.events.map(event => [event.bondIndex, event]));
  const bonds = state.bonds.map((bond, bondIndex) => {
    const event = eventsByBondIndex.get(bondIndex);
    return {
      ...bond,
      alive: finalBondLiveness[bondIndex],
      repaired: event ? true : bond.repaired,
      cause: finalBondLiveness[bondIndex] ? null : bond.cause,
      strength: event ? round(event.effectiveStrength) : bond.strength,
      lastStress: event ? 0 : bond.lastStress,
      lastStrain: event ? 0 : bond.lastStrain,
    };
  });
  const componentByLabel = new Map(components.map(component => [component.label, component]));
  const nodes = state.nodes.map((node, index) => {
    const label = componentLabels[index];
    return {
      ...node,
      componentId: `g${label}`,
      displacement: componentByLabel.get(label).pinned
        ? { x: 0, y: 0, z: 0 }
        : { ...node.displacement },
    };
  });
  const bindEvents = receipt.binding.events.map((event, index) => ({
    kind: 'bind',
    bondId: event.bondId,
    bondKind: event.bondKind,
    geometryRole: event.geometryRole,
    cause: event.cause,
    stress: 0,
    strain: 0,
    priorFailure: { ...event.priorFailure },
    energy: round(event.energy),
    midpoint: { ...event.midpoint },
    eventEpoch: event.eventEpoch,
    step: index + 1,
  }));
  const soundEvents = [...state.sound.events, ...bindEvents];
  const brokenBondCount = bonds.filter(bond => !bond.alive).length;
  const repairedBondCount = bonds.filter(bond => bond.repaired).length;
  const eventCount = receipt.binding.eventCount;
  const material = {
    ...state,
    nodes,
    bonds,
    components,
    topologyEpoch: state.topologyEpoch + (eventCount > 0 ? 1 : 0),
    connectivityEpoch: state.connectivityEpoch + (eventCount > 0 ? 1 : 0),
    sound: buildLayeredStructuralSound(soundEvents, brokenBondCount, repairedBondCount),
    sympatheticBinding: {
      authority: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_VISUAL_AUTHORITY,
      structuralAuthority: receipt.authority,
      semantics: 'reactivate-failed-authored-edges-within-3d-contact-neighborhood',
      effectiveRoute: receipt.effectiveRoute,
      effectiveBackend: receipt.effectiveBackend,
      eventEpoch: receipt.eventEpoch,
      point: { ...receipt.binding.effective.point },
      radius: receipt.binding.effective.radius,
      strength: receipt.binding.effective.strength,
      repairedBondCount: eventCount,
      repairedBondIds: receipt.binding.events.map(event => event.bondId),
      componentCountBefore: state.components.length,
      componentCountAfter: components.length,
      anchoredComponentLabel: anchored[0].label,
      detachedComponentLabels: components.filter(component => !component.pinned).map(component => component.label),
      noOp: receipt.binding.noOp,
    },
  };
  delete material.sympatheticTear;
  return material;
}

export function buildLayeredStructuralGpuBindingFailureReceipt(error, failurePhase = 'gpu-resident-binding') {
  const initialization = error?.hotSidecarInitialization || {};
  return {
    schema: 'kaminos.structural-material.webgpu-resident-binding-receipt.v0',
    status: 'failed',
    failurePhase: failurePhase || initialization.failurePhase,
    requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
    effectiveRoute: null,
    requestedBackend: 'webgpu',
    effectiveBackend: initialization.effectiveBackend || null,
    cpuFallbackUsed: false,
    authority: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_AUTHORITY,
    objectIdentity: initialization.objectIdentity || null,
    lifecycle: initialization.lifecycle || null,
    error: { name: error?.name || 'Error', message: error?.message || String(error) },
  };
}
