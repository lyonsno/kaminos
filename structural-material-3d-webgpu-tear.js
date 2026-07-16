import {
  STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
  buildLayeredStructuralCpuSequenceOracle,
  runLayeredStructuralRetainedWebGpuParity,
} from './structural-material-3d-webgpu-retained.js';

export const STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE = 'kaminos.structural-material.webgpu-sympathetic-tear.v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_AUTHORITY = 'retained-webgpu-liveness-component-labels-v0';
export const STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_VISUAL_AUTHORITY = 'gpu-component-label-to-visible-separation-v0';

export function createLayeredStructuralGpuTearRequestGate() {
  let epoch = 0;
  return {
    begin() {
      epoch += 1;
      return epoch;
    },
    invalidate() {
      epoch += 1;
      return epoch;
    },
    accepts(token) {
      return token === epoch;
    },
  };
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function normalizedVector(vector = {}) {
  const x = finite(vector.x, 1);
  const y = finite(vector.y);
  const z = finite(vector.z);
  const length = Math.hypot(x, y, z);
  if (length < 0.000001) return { x: 1, y: 0, z: 0 };
  return { x: x / length, y: y / length, z: z / length };
}

function assertReceipt(condition, message) {
  if (!condition) throw new Error(`GPU sympathetic tear receipt ${message}`);
}

export function buildLayeredStructuralCpuComponentOracle(state, finalBondLiveness = []) {
  if (!state?.nodes || !state?.bonds) throw new Error('component oracle requires layered structural state');
  if (finalBondLiveness.length !== state.bonds.length) {
    throw new Error('component oracle bond-liveness length mismatch');
  }
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  const adjacency = state.nodes.map(() => []);
  state.bonds.forEach((bond, bondIndex) => {
    if (!finalBondLiveness[bondIndex]) return;
    const a = nodeIndexById.get(bond.a);
    const b = nodeIndexById.get(bond.b);
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error(`component oracle cannot resolve bond endpoints: ${bond.id}`);
    }
    adjacency[a].push(b);
    adjacency[b].push(a);
  });

  const labels = new Array(state.nodes.length).fill(-1);
  const components = [];
  for (let start = 0; start < state.nodes.length; start += 1) {
    if (labels[start] >= 0) continue;
    const stack = [start];
    const nodeIndices = [];
    labels[start] = start;
    while (stack.length > 0) {
      const index = stack.pop();
      nodeIndices.push(index);
      for (const next of adjacency[index]) {
        if (labels[next] >= 0) continue;
        labels[next] = start;
        stack.push(next);
      }
    }
    const label = Math.min(...nodeIndices);
    for (const index of nodeIndices) labels[index] = label;
    const nodes = nodeIndices.map(index => state.nodes[index]);
    components.push({
      label,
      nodeIndices: nodeIndices.sort((a, b) => a - b),
      nodeIds: nodeIndices.map(index => state.nodes[index].id),
      nodeCount: nodeIndices.length,
      pinned: nodes.some(node => node.pinned),
      center: {
        x: round(nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length),
        y: round(nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length),
        z: round(nodes.reduce((sum, node) => sum + node.z, 0) / nodes.length),
      },
    });
  }
  components.sort((a, b) => a.label - b.label);
  const anchored = components.filter(component => component.pinned);
  const anchoredComponentLabel = anchored.length === 1 ? anchored[0].label : null;
  const detachedComponentLabels = components
    .filter(component => !component.pinned)
    .map(component => component.label);
  return {
    authority: 'deterministic-alive-bond-component-oracle-v0',
    labels,
    components,
    componentCount: components.length,
    anchoredComponentLabel,
    anchoredComponentCount: anchored.length,
    detachedComponentLabels,
  };
}

export function compareLayeredStructuralGpuComponentParity(cpuOracle, gpuLabels = []) {
  const labelsMatch = cpuOracle.labels.length === gpuLabels.length &&
    cpuOracle.labels.every((label, index) => gpuLabels[index] === label);
  const gpuComponentLabels = [...new Set(gpuLabels)].sort((a, b) => a - b);
  const expectedComponentLabels = cpuOracle.components.map(component => component.label);
  const componentSetMatches = expectedComponentLabels.length === gpuComponentLabels.length &&
    expectedComponentLabels.every((label, index) => gpuComponentLabels[index] === label);
  const stableMinimumLabels = gpuComponentLabels.every(label => gpuLabels[label] === label);
  const pinnedLabels = [...new Set(cpuOracle.components
    .filter(component => component.pinned)
    .map(component => gpuLabels[component.nodeIndices[0]]))];
  const anchoredComponentMatches = pinnedLabels.length === 1 &&
    pinnedLabels[0] === cpuOracle.anchoredComponentLabel;
  return {
    ok: labelsMatch && componentSetMatches && stableMinimumLabels && anchoredComponentMatches,
    labelsMatch,
    componentSetMatches,
    stableMinimumLabels,
    anchoredComponentMatches,
    cpuComponentCount: cpuOracle.componentCount,
    gpuComponentCount: gpuComponentLabels.length,
    anchoredComponentLabel: pinnedLabels.length === 1 ? pinnedLabels[0] : null,
  };
}

export function buildLayeredStructuralGpuTearMaterial(state, receipt, interaction = {}) {
  assertReceipt(receipt?.status === 'passed', 'did not pass');
  assertReceipt(receipt.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE, 'effective route mismatch');
  assertReceipt(receipt.effectiveBackend === 'webgpu', 'effective backend mismatch');
  assertReceipt(receipt.cpuFallbackUsed === false, 'used a CPU fallback');
  assertReceipt(
    receipt.requestedSequenceIdentity === receipt.effectiveSequenceIdentity,
    'interaction-sequence identity mismatch',
  );
  assertReceipt(receipt.topology?.parity?.ok === true, 'topology parity did not pass');

  const finalBondLiveness = receipt.gpuStructuralState?.finalBondLiveness;
  const componentLabels = receipt.gpuStructuralState?.componentLabels;
  assertReceipt(Array.isArray(finalBondLiveness), 'omits final bond liveness');
  assertReceipt(Array.isArray(componentLabels), 'omits component labels');
  assertReceipt(finalBondLiveness.length === state.bonds.length, 'bond-liveness length mismatch');
  assertReceipt(componentLabels.length === state.nodes.length, 'component-label length mismatch');

  const componentsByLabel = new Map();
  state.nodes.forEach((node, index) => {
    const label = componentLabels[index];
    assertReceipt(Number.isInteger(label) && label >= 0 && label < state.nodes.length, 'contains an invalid component label');
    if (!componentsByLabel.has(label)) componentsByLabel.set(label, []);
    componentsByLabel.get(label).push(index);
  });
  const components = [...componentsByLabel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([label, nodeIndices]) => {
      assertReceipt(label === Math.min(...nodeIndices), 'contains a noncanonical component label');
      const nodes = nodeIndices.map(index => state.nodes[index]);
      return {
        id: `g${label}`,
        label,
        nodeIds: nodeIndices.map(index => state.nodes[index].id),
        nodeCount: nodeIndices.length,
        pinned: nodes.some(node => node.pinned),
        center: {
          x: round(nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length),
          y: round(nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length),
          z: round(nodes.reduce((sum, node) => sum + node.z, 0) / nodes.length),
        },
      };
    });
  const anchored = components.filter(component => component.pinned);
  assertReceipt(anchored.length === 1, 'does not identify exactly one anchored component');
  assertReceipt(
    anchored[0].label === receipt.topology.anchoredComponentLabel,
    'anchored component differs from topology receipt',
  );

  const direction = normalizedVector(interaction.vector);
  const magnitude = clamp(interaction.magnitude, 0, 5);
  const separationScale = components.length > 1 ? clamp(magnitude * 0.095, 0.055, 0.18) : 0;
  const componentByLabel = new Map(components.map(component => [component.label, component]));
  let detachedNodeCount = 0;
  const nodes = state.nodes.map((node, index) => {
    const label = componentLabels[index];
    const component = componentByLabel.get(label);
    const anchoredNode = component.pinned;
    if (!anchoredNode) detachedNodeCount += 1;
    const distanceFactor = anchoredNode
      ? 0
      : 0.82 + clamp(component.center.x, 0, 1) * 0.36;
    return {
      ...node,
      componentId: `g${label}`,
      displacement: anchoredNode
        ? { x: 0, y: 0, z: 0 }
        : {
            x: round(direction.x * separationScale * distanceFactor),
            y: round(direction.y * separationScale * distanceFactor),
            z: round(direction.z * separationScale * distanceFactor),
          },
    };
  });
  const bonds = state.bonds.map((bond, index) => ({
    ...bond,
    alive: finalBondLiveness[index],
    cause: finalBondLiveness[index] ? bond.cause : 'stress-threshold',
  }));
  const brokenBondCount = finalBondLiveness.filter(alive => !alive).length;

  return {
    ...state,
    nodes,
    bonds,
    components,
    topologyEpoch: state.topologyEpoch + (brokenBondCount > 0 ? 1 : 0),
    connectivityEpoch: state.connectivityEpoch + (brokenBondCount > 0 ? 1 : 0),
    sympatheticTear: {
      authority: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_VISUAL_AUTHORITY,
      structuralAuthority: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_AUTHORITY,
      effectiveRoute: receipt.effectiveRoute,
      effectiveBackend: receipt.effectiveBackend,
      effectiveSequenceIdentity: receipt.effectiveSequenceIdentity,
      anchoredComponentLabel: anchored[0].label,
      detachedComponentLabels: components.filter(component => !component.pinned).map(component => component.label),
      detachedNodeCount,
      brokenBondCount,
      causingEventEpochs: [...new Set(receipt.gpuResult?.eventEpochs || [])].sort((a, b) => a - b),
      direction: { x: round(direction.x), y: round(direction.y), z: round(direction.z) },
      separationScale: round(separationScale),
    },
  };
}

export async function runLayeredStructuralSympatheticTearWebGpu(options = {}) {
  const retainedReceipt = await runLayeredStructuralRetainedWebGpuParity({
    ...options,
    includeComponentTopology: true,
  });
  let topology = retainedReceipt.topology;
  if (retainedReceipt.gpuStructuralState?.componentLabels && options.state && options.interactions) {
    const cpuSequence = buildLayeredStructuralCpuSequenceOracle(options.state, options.interactions);
    const cpuComponents = buildLayeredStructuralCpuComponentOracle(
      options.state,
      cpuSequence.finalBondLiveness,
    );
    const parity = compareLayeredStructuralGpuComponentParity(
      cpuComponents,
      retainedReceipt.gpuStructuralState.componentLabels,
    );
    topology = {
      ...retainedReceipt.topology,
      parity,
      componentCount: parity.gpuComponentCount,
      anchoredComponentLabel: cpuComponents.anchoredComponentLabel,
      anchoredComponentCount: cpuComponents.anchoredComponentCount,
      detachedComponentLabels: [...cpuComponents.detachedComponentLabels],
      cpuComponentCount: cpuComponents.componentCount,
    };
  }
  const topologyPassed = topology?.parity?.ok === true;
  const passed = retainedReceipt.status === 'passed' && topologyPassed;
  return {
    ...retainedReceipt,
    schema: 'kaminos.structural-material.webgpu-sympathetic-tear-receipt.v0',
    requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
    effectiveRoute: passed ? STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE : null,
    retainedRoute: retainedReceipt.effectiveRoute || STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
    tearAuthority: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_AUTHORITY,
    topology,
    status: passed ? 'passed' : 'failed',
    failurePhase: passed ? null : retainedReceipt.failurePhase || 'component-topology-validation',
  };
}
