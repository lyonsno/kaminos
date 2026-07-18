import {
  COMBUSTIBLE_OBJECT_FIRE_CONSUMER_STATS_BYTES,
  COMBUSTIBLE_OBJECT_FIRE_ROUTE,
  COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
  COMBUSTIBLE_OBJECT_SOURCE_MAGIC,
  COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES,
  COMBUSTIBLE_OBJECT_SOURCE_VERSION,
  decodeCombustibleObjectFireConsumerStats,
} from './combustible-object-fire-gpu.mjs';

export const STRUCTURAL_COMBUSTION_SCHEMA = 'kaminos.structural-combustion.node-material.v0';
export const STRUCTURAL_COMBUSTION_AUTHORITY = 'same-device-pyro-node-material-bond-strength-v0';
export const STRUCTURAL_EXPOSURE_ENABLED = 1 << 0;
export const STRUCTURAL_EMISSION_ENABLED = 1 << 1;
export const STRUCTURAL_CONTROL = 1 << 2;
export const STRUCTURAL_MOTION_ENABLED = 1 << 3;
export const STRUCTURAL_CARRIED_FIRE_MODE = 'carried-fire';

const NODE_MATERIAL_BYTES = 64;
const COMPONENT_MOTION_BYTES = 32;
const CARRIED_FIRE_AUDIT_BYTES = 32;
const PARAMS_BYTES = 144;
const PRESENTATION_BYTES = 96;
const SOURCE_FRAME_HASH = 0x53545243;
const WORKGROUP_SIZE = 64;

function shaderSourceIdentity(source) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function assertShaderModuleCompiles(module, label, source) {
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length === 0) return;
  const detail = errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n');
  throw new Error(`${label} WGSL compilation failed (source ${shaderSourceIdentity(source)}):\n${detail}`);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(finite(value, fallback));
  return number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(minimum, maximum, value) {
  const normalized = clamp((value - minimum) / Math.max(0.000001, maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function mixColor(left, right, amount) {
  return left.map((value, index) => value + (right[index] - value) * amount);
}

export function evaluateStructuralBurnAppearance({
  temperature = 0.08,
  fuel = 1,
  char = 0,
  bondAlive = true,
  strengthRatio = 1,
} = {}) {
  const thermal = Math.max(0, finite(temperature, 0.08));
  const remainingFuel = clamp(finite(fuel, 1), 0, 1);
  const charPersistence = clamp(finite(char, 0), 0, 1);
  const fuelLoss = 1 - remainingFuel;
  const heat = smoothstep(0.48, 1.15, thermal);
  const scorch = clamp(charPersistence * 0.72 + fuelLoss * 0.22, 0, 1);
  const virgin = [0.44, 0.29, 0.14];
  const scorched = [0.16, 0.07, 0.025];
  const charred = [0.025, 0.018, 0.015];
  const ember = [1, 0.15, 0.018];
  const base = mixColor(mixColor(virgin, scorched, scorch), charred, charPersistence ** 1.2);
  const emissiveStrength = heat * (1 - charPersistence * 0.35);
  const materialColor = mixColor(base, ember, Math.min(0.88, emissiveStrength * 0.84));
  const remainingStrength = clamp(finite(strengthRatio, 1), 0, 1);
  const bondOpacity = bondAlive
    ? clamp(0.15 + 0.75 * remainingStrength * (1 - charPersistence * 0.35), 0.08, 0.9)
    : 0;
  return {
    materialColor,
    emissiveStrength,
    charPersistence,
    fuelLoss,
    bondOpacity,
  };
}

export function evaluateStructuralComponentMotion({
  componentLabel = 0,
  step = 0,
  detachmentStep = 0,
  dt = 1 / 60,
  lateralRate = 0.18,
  gravity = -0.82,
  depthRate = 0.04,
  maximumAge = 1,
} = {}) {
  const label = Math.max(0, Math.floor(finite(componentLabel, 0)));
  const currentStep = Math.max(0, Math.floor(finite(step, 0)));
  if (label === 0) return { active: false, componentLabel: 0, detachmentStep: 0, translation: [0, 0, 0] };
  const firstStep = Math.max(0, Math.floor(finite(detachmentStep, 0))) || currentStep;
  const age = Math.min(
    Math.max(0, (currentStep - firstStep) * Math.max(0, finite(dt, 1 / 60))),
    Math.max(0, finite(maximumAge, 1)),
  );
  return {
    active: true,
    componentLabel: label,
    detachmentStep: firstStep,
    translation: [
      finite(lateralRate, 0.18) * age,
      finite(gravity, -0.82) * age * age,
      finite(depthRate, 0.04) * age,
    ].map(value => value || 0),
  };
}

export function transformStructuralCarriedNode({
  position,
  displacement = [0, 0, 0],
  translation = [0, 0, 0],
  pyroScale,
  pyroOffset,
  displayScale = [1.12, 0.68, 0.58],
  worldOffset = [0, 0, 0],
} = {}) {
  const vector = (value, fallback) => Array.from({ length: 3 }, (_, index) => finite(value?.[index], fallback[index]));
  const local = vector(position, [0, 0, 0]);
  const nodeDisplacement = vector(displacement, [0, 0, 0]);
  const carriedTranslation = vector(translation, [0, 0, 0]);
  const sourceScale = vector(pyroScale, [1, 1, 1]);
  const sourceOffset = vector(pyroOffset, [0, 0, 0]);
  const renderScale = vector(displayScale, [1.12, 0.68, 0.58]);
  const renderOffset = vector(worldOffset, [0, 0, 0]);
  const carriedLocal = local.map((value, index) => value + carriedTranslation[index]);
  const sourcePosition = carriedLocal.map((value, index) => value * sourceScale[index] + sourceOffset[index]);
  const displayedPosition = carriedLocal.map(
    (value, index) => (value - 0.5) * renderScale[index] + nodeDisplacement[index] + renderOffset[index],
  );
  return { carriedLocal, sourcePosition, exposurePosition: [...sourcePosition], displayedPosition };
}

export function evaluateStructuralCarriedFireTerminalChecks({
  decodedStructures,
  receiverAudit,
  carriedAudit,
  hostCausalFeedbackCount = 0,
} = {}) {
  const emitter = decodedStructures?.find(structure => structure.role === 'emitter');
  const propagationTarget = decodedStructures?.find(structure => structure.role === 'propagation-target');
  const propagationControl = decodedStructures?.find(structure => structure.role === 'propagation-control');
  if (!emitter || !propagationTarget || !propagationControl || !receiverAudit?.audit || !carriedAudit) {
    throw new Error('structural carried-fire terminal evidence is incomplete');
  }
  const detachedMotions = emitter.nodes
    .map(node => node.componentMotion)
    .filter(motion => motion?.active && motion.detachmentStep > 0);
  const detachmentSteps = detachedMotions.map(motion => motion.detachmentStep);
  const firstDetachmentStep = detachmentSteps.length ? Math.min(...detachmentSteps) : 0;
  const moved = detachedMotions.some(motion => motion.translation.some(value => Math.abs(value) > 0.01));
  const targetExposureSteps = propagationTarget.nodes.map(node => node.firstExposureStep).filter(Boolean);
  const targetIgnitionSteps = propagationTarget.nodes.map(node => node.ignitionStep).filter(Boolean);
  const firstTargetExposure = targetExposureSteps.length ? Math.min(...targetExposureSteps) : 0;
  const firstTargetIgnition = targetIgnitionSteps.length ? Math.min(...targetIgnitionSteps) : 0;
  return {
    detachedEmitterMoved: moved,
    movedSourceAccepted: moved && carriedAudit.movedSourceRecords > 0 &&
      carriedAudit.firstMovedSourceStep >= firstDetachmentStep &&
      carriedAudit.lastMovedSourceStep <= receiverAudit.audit.lastAcceptedStep &&
      receiverAudit.audit.auditObjectId === emitter.objectId &&
      receiverAudit.audit.acceptedRecords > 0 && receiverAudit.audit.rejectedRecords === 0 &&
      receiverAudit.audit.lastAcceptedStep > firstDetachmentStep,
    propagationTargetExposed: firstTargetExposure > 0 &&
      propagationTarget.nodes.some(node => node.peakExposure > 0),
    propagationAfterDetachment: firstDetachmentStep > 0 && firstTargetExposure > firstDetachmentStep,
    propagationWithinMovedSourceWindow: firstTargetExposure >= carriedAudit.firstMovedSourceStep &&
      firstTargetExposure <= carriedAudit.lastMovedSourceStep,
    propagationTargetIgnited: firstTargetIgnition >= firstTargetExposure &&
      firstTargetIgnition <= receiverAudit.audit.lastAcceptedStep,
    propagationControlCool: propagationControl.nodes.every(
      node => node.ignitionStep === 0 && node.temperature <= 0.085 && node.firstExposureStep === 0,
    ),
    noHostFeedback: hostCausalFeedbackCount === 0,
  };
}

export function evaluateStructuralCombustionTerminalChecks({
  decodedStructures,
  sourceHeader,
  receiverAudit,
  hostCausalFeedbackCount = 0,
} = {}) {
  const targetResult = decodedStructures?.find(structure => structure.role === 'emitter') ||
    decodedStructures?.find(structure => !structure.control);
  const controlResult = decodedStructures?.find(structure => structure.role === 'control') ||
    decodedStructures?.find(structure => structure.control);
  if (!targetResult || !controlResult || !sourceHeader || !receiverAudit?.audit) {
    throw new Error('structural combustion terminal evidence is incomplete');
  }
  const targetIgnitionSteps = targetResult.nodes.map(node => node.ignitionStep).filter(Boolean);
  const targetFractureSteps = targetResult.nodes.map(node => node.firstIncidentFractureStep).filter(Boolean);
  const nearNodes = targetResult.nodes.filter(node => node.position[2] === 0);
  const farNodes = targetResult.nodes.filter(node => node.position[2] === 1);
  return {
    targetIgnited: targetIgnitionSteps.length > 0,
    nearFaceExposed: nearNodes.some(node => node.peakExposure > 0),
    farFaceHeated: farNodes.some(node => node.temperature > 0.1),
    targetWeakened: targetResult.weakenedBondCount > 0,
    targetSeparated: targetResult.componentCount > 1 && targetResult.brokenBondCount > 0,
    fractureAfterIgnition: targetFractureSteps.length > 0 && targetIgnitionSteps.length > 0 &&
      Math.min(...targetFractureSteps) > Math.min(...targetIgnitionSteps),
    controlCool: controlResult.nodes.every(node => node.ignitionStep === 0 && node.temperature <= 0.081),
    controlConnected: controlResult.componentCount === 1 && controlResult.brokenBondCount === 0,
    sourceFinalized: sourceHeader.complete === 1 && sourceHeader.published === 1 &&
      sourceHeader.rejectedCount === 0 && sourceHeader.overflowCount === 0,
    sourceAccepted: receiverAudit.audit.auditObjectId === targetResult.objectId &&
      receiverAudit.audit.acceptedRecords > 0 && receiverAudit.audit.rejectedRecords === 0,
    noHostFeedback: hostCausalFeedbackCount === 0,
  };
}

export function simulateStructuralCombustionReference({
  structures = [],
  steps = 1,
  dt = 1 / 60,
  exposure = {},
  ambientTemperature = 0.08,
  ignitionTemperature = 0.62,
  heatCapacity = 1,
  cooling = 0.035,
  conduction = 0.22,
  burnRate = 0.005,
  charStrengthLoss = 0.82,
} = {}) {
  const stepCount = positiveInteger(steps, 1);
  const timeStep = Math.max(0.000001, finite(dt, 1 / 60));
  const ambient = finite(ambientTemperature, 0.08);
  const ignition = Math.max(ambient, finite(ignitionTemperature, 0.62));
  const capacity = Math.max(0.000001, finite(heatCapacity, 1));
  const coolingRate = Math.max(0, finite(cooling, 0.035));
  const conductionRate = Math.max(0, finite(conduction, 0.22));
  const fuelBurnRate = Math.max(0, finite(burnRate, 0.005));
  const strengthLoss = clamp(finite(charStrengthLoss, 0.82), 0, 1);
  const sourcePosition = Array.isArray(exposure.position) ? exposure.position.map(Number) : [0.5, 0.5, 0];
  const sourceRadius = Math.max(0.000001, finite(exposure.radius, 0.28));
  const sourceIntensity = Math.max(0, finite(exposure.intensity, 0));

  const results = structures.map(structure => {
    const nodeIndexById = new Map(structure.state.nodes.map((node, index) => [node.id, index]));
    const neighbors = structure.state.nodes.map(() => []);
    for (const bond of structure.state.bonds) {
      const a = nodeIndexById.get(bond.a);
      const b = nodeIndexById.get(bond.b);
      if (a === undefined || b === undefined) continue;
      const nodeA = structure.state.nodes[a];
      const nodeB = structure.state.nodes[b];
      const distanceSquared =
        (nodeA.x - nodeB.x) ** 2 + (nodeA.y - nodeB.y) ** 2 + (nodeA.z - nodeB.z) ** 2;
      const inverseDistanceSquared = 1 / Math.max(distanceSquared, 0.001);
      neighbors[a].push({ index: b, inverseDistanceSquared });
      neighbors[b].push({ index: a, inverseDistanceSquared });
    }
    return {
      id: structure.id,
      control: Boolean(structure.control),
      nodeIndexById,
      neighbors,
      nodes: structure.state.nodes.map(node => ({
        nodeId: node.id,
        position: [node.x, node.y, node.z],
        temperature: ambient,
        fuel: 1,
        char: 0,
        phase: 0,
        ignitionStep: 0,
        peakExposure: 0,
      })),
      bonds: structure.state.bonds.map(bond => ({
        bondId: bond.id,
        a: nodeIndexById.get(bond.a),
        b: nodeIndexById.get(bond.b),
        strength: bond.strength,
        initialStrength: bond.strength,
      })),
    };
  });
  const emissions = [];
  const ledger = { emittedFuel: 0, emittedSoot: 0, sourceCount: 0 };

  for (let step = 1; step <= stepCount; step += 1) {
    for (const structure of results) {
      const priorTemperatures = structure.nodes.map(node => node.temperature);
      const nextTemperatures = structure.nodes.map((node, index) => {
        let directExposure = 0;
        if (!structure.control) {
          const distanceSquared = node.position.reduce((sum, component, axis) => {
            const delta = component - sourcePosition[axis];
            return sum + delta * delta;
          }, 0);
          if (distanceSquared <= sourceRadius * sourceRadius) {
            directExposure = sourceIntensity * Math.exp(-distanceSquared / (sourceRadius * sourceRadius * 0.5));
          }
        }
        node.peakExposure = Math.max(node.peakExposure, directExposure);
        const adjacent = structure.neighbors[index];
        const conductiveDelta = adjacent.length === 0
          ? 0
          : adjacent.reduce(
            (sum, neighbor) => sum +
              (priorTemperatures[neighbor.index] - priorTemperatures[index]) * neighbor.inverseDistanceSquared,
            0,
          ) /
            adjacent.length;
        return Math.max(
          ambient,
          priorTemperatures[index] +
            (directExposure / capacity + conductionRate * conductiveDelta -
              coolingRate * Math.max(0, priorTemperatures[index] - ambient)) * timeStep,
        );
      });

      structure.nodes.forEach((node, index) => {
        node.temperature = nextTemperatures[index];
        if (node.phase === 0 && node.temperature >= ignition) {
          node.phase = 1;
          node.ignitionStep = step;
        }
        if (node.phase === 0 || node.fuel <= 0) return;
        const consumedFuel = Math.min(node.fuel, fuelBurnRate);
        node.fuel -= consumedFuel;
        node.char = 1 - node.fuel;
        node.temperature += consumedFuel * 1.8;
        const emittedFuel = consumedFuel * 0.72;
        const emittedSoot = consumedFuel * 0.28;
        emissions.push({
          objectId: structure.id,
          nodeId: node.nodeId,
          step,
          ignitionStep: node.ignitionStep,
          position: [...node.position],
          radius: sourceRadius * 0.22,
          heat: node.temperature * consumedFuel * 3.2,
          fuel: emittedFuel,
          soot: emittedSoot,
        });
        ledger.emittedFuel += emittedFuel;
        ledger.emittedSoot += emittedSoot;
      });

      for (const bond of structure.bonds) {
        const adjacentChar = Math.max(structure.nodes[bond.a].char, structure.nodes[bond.b].char);
        bond.strength = bond.initialStrength * (1 - strengthLoss * adjacentChar);
      }
    }
  }
  ledger.sourceCount = emissions.length;

  return {
    schema: STRUCTURAL_COMBUSTION_SCHEMA,
    authority: STRUCTURAL_COMBUSTION_AUTHORITY,
    structures: results.map(({ nodeIndexById, neighbors, ...result }) => result),
    emissions,
    ledger,
  };
}

function structureFlags(structure) {
  const control = Boolean(structure.control);
  const exposureEnabled = structure.exposureEnabled ?? !control;
  const emissionEnabled = structure.emissionEnabled ?? !control;
  const motionEnabled = structure.motionEnabled ?? emissionEnabled;
  return (exposureEnabled ? STRUCTURAL_EXPOSURE_ENABLED : 0) |
    (emissionEnabled ? STRUCTURAL_EMISSION_ENABLED : 0) |
    (control ? STRUCTURAL_CONTROL : 0) |
    (motionEnabled ? STRUCTURAL_MOTION_ENABLED : 0);
}

function packNodeMaterials(state, objectId, flags) {
  const bytes = new ArrayBuffer(state.nodes.length * NODE_MATERIAL_BYTES);
  const view = new DataView(bytes);
  state.nodes.forEach((node, index) => {
    const offset = index * NODE_MATERIAL_BYTES;
    view.setUint32(offset, objectId, true);
    view.setUint32(offset + 4, index, true);
    view.setUint32(offset + 8, 0, true);
    view.setUint32(offset + 12, flags, true);
    view.setFloat32(offset + 16, 0.08, true);
    view.setFloat32(offset + 20, 1, true);
  });
  return bytes;
}

function packBondBaselines(state) {
  return new Float32Array(state.bonds.map(bond => Number(bond.strength) || 0));
}

function packParams(structure, nodeCount, bondCount, capacity, gridSize) {
  const bytes = new ArrayBuffer(PARAMS_BYTES);
  const u32 = new Uint32Array(bytes);
  const f32 = new Float32Array(bytes);
  u32.set([1, 0, structure.objectId >>> 0, structure.flags >>> 0], 0);
  u32.set([nodeCount, bondCount, capacity, gridSize], 4);
  f32.set([...(structure.pyroScale || [0.28, 0.32, 0.32]), 0], 8);
  f32.set([
    ...(structure.pyroOffset || [0.3, 0.26, 0.32]),
    finite(structure.contactThreshold, 0.0001),
  ], 12);
  f32.set([
    finite(structure.dt, 1 / 60),
    finite(structure.ambientTemperature, 0.08),
    finite(structure.ignitionTemperature, 0.62),
    finite(structure.cooling, 0.035),
  ], 16);
  f32.set([
    finite(structure.conduction, 0.22),
    finite(structure.burnRate, 0.005),
    finite(structure.charStrengthLoss, 0.82),
    finite(structure.sourceRadius, 0.018),
  ], 20);
  f32.set([3.2, 0.72, 0.28, 0.45], 24);
  f32.set([...(structure.worldOffset || [0, 0, 0]), structure.control ? 1 : 0], 28);
  f32.set([...(structure.motion || [0.18, -0.82, 0.04]), finite(structure.maximumMotionAge, 1)], 32);
  return bytes;
}

function structuralCombustionShader(gridSize) {
  return /* wgsl */`
const GRID: u32 = ${gridSize}u;
const WORKGROUP_SIZE: u32 = ${WORKGROUP_SIZE}u;
const SOURCE_MAGIC: u32 = ${COMBUSTIBLE_OBJECT_SOURCE_MAGIC}u;
const SOURCE_VERSION: u32 = ${COMBUSTIBLE_OBJECT_SOURCE_VERSION}u;
const FIXED_POINT: f32 = 65536.0;
const STRUCTURAL_EXPOSURE_ENABLED: u32 = ${STRUCTURAL_EXPOSURE_ENABLED}u;
const STRUCTURAL_EMISSION_ENABLED: u32 = ${STRUCTURAL_EMISSION_ENABLED}u;
const STRUCTURAL_MOTION_ENABLED: u32 = ${STRUCTURAL_MOTION_ENABLED}u;

struct NodeRecord {
  position: vec4<f32>,
  displacement: vec4<f32>,
}

struct BondRecord {
  endpoints: vec4<u32>,
  direction: vec4<f32>,
  midpoint: vec4<f32>,
  material: vec4<f32>,
  prior: vec4<f32>,
}

struct NodeMaterial {
  identity: vec4<u32>,
  thermal: vec4<f32>,
  events: vec4<u32>,
  rates: vec4<f32>,
}

struct ComponentMotion {
  translation: vec4<f32>,
  identity: vec4<u32>,
}

struct SourceRecord {
  localPositionRadius: vec4<f32>,
  localNormalExtent: vec4<f32>,
  velocityAngular: vec4<f32>,
  emission: vec4<f32>,
  material: vec4<f32>,
  sourceGenerationEpochTick: vec4<f32>,
  support: vec4<f32>,
  reserved: vec4<f32>,
}

struct Params {
  identity: vec4<u32>,
  counts: vec4<u32>,
  pyroScale: vec4<f32>,
  pyroOffset: vec4<f32>,
  thermal: vec4<f32>,
  kinetics: vec4<f32>,
  emission: vec4<f32>,
  world: vec4<f32>,
  motion: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> fluid: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> nodes: array<NodeRecord>;
@group(0) @binding(2) var<storage, read_write> bonds: array<BondRecord>;
@group(0) @binding(3) var<storage, read> materialsIn: array<NodeMaterial>;
@group(0) @binding(4) var<storage, read_write> materialsOut: array<NodeMaterial>;
@group(0) @binding(5) var<storage, read> bondBaselines: array<f32>;
@group(0) @binding(6) var<storage, read_write> sourceHeader: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> sourceRecords: array<SourceRecord>;
@group(0) @binding(8) var<uniform> params: Params;
@group(0) @binding(9) var<storage, read> componentLabels: array<u32>;
@group(0) @binding(10) var<storage, read_write> componentMotions: array<ComponentMotion>;
@group(0) @binding(11) var<storage, read_write> carriedFireAudit: array<atomic<u32>>;

fn carriedNodePosition(nodeIndex: u32) -> vec3<f32> {
  return nodes[nodeIndex].position.xyz + componentMotions[nodeIndex].translation.xyz;
}

fn fluidExposure(position: vec3<f32>) -> f32 {
  let samplePosition = clamp(position * params.pyroScale.xyz + params.pyroOffset.xyz, vec3<f32>(0.0), vec3<f32>(0.9999));
  let cell = min(vec3<u32>(samplePosition * f32(GRID)), vec3<u32>(GRID - 1u));
  let cellIndex = cell.x + cell.y * GRID + cell.z * GRID * GRID;
  let base = cellIndex * 4u;
  return max(0.0, fluid[base + 1u].y) + max(0.0, fluid[base + 2u].x) * 0.20;
}

@compute @workgroup_size(1)
fn clearSource() {
  let step = atomicAdd(&sourceHeader[18], 1u) + 1u;
  atomicStore(&sourceHeader[0], SOURCE_MAGIC);
  atomicStore(&sourceHeader[1], SOURCE_VERSION);
  atomicStore(&sourceHeader[2], params.identity.x);
  atomicStore(&sourceHeader[3], params.identity.y);
  atomicStore(&sourceHeader[4], step);
  atomicStore(&sourceHeader[5], 0u);
  atomicStore(&sourceHeader[6], 0u);
  atomicStore(&sourceHeader[7], ${SOURCE_FRAME_HASH}u);
  atomicStore(&sourceHeader[8], 0u);
  atomicStore(&sourceHeader[9], 0u);
  atomicStore(&sourceHeader[10], 0u);
  atomicStore(&sourceHeader[11], 0u);
  atomicStore(&sourceHeader[12], 0u);
  atomicStore(&sourceHeader[13], 32u);
  atomicStore(&sourceHeader[14], 0u);
  atomicStore(&sourceHeader[15], 0u);
  atomicStore(&sourceHeader[16], 0u);
  atomicStore(&sourceHeader[17], 0u);
  atomicStore(&sourceHeader[19], 0u);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn updateNodes(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nodeIndex = gid.x;
  if (nodeIndex >= params.counts.x) { return; }
  var state = materialsIn[nodeIndex];
  var exposure = 0.0;
  if ((params.identity.w & STRUCTURAL_EXPOSURE_ENABLED) != 0u) {
    exposure = fluidExposure(carriedNodePosition(nodeIndex));
  }

  var conductiveDelta = 0.0;
  var conductiveCount = 0.0;
  var incidentFracture = false;
  for (var bondIndex = 0u; bondIndex < params.counts.y; bondIndex += 1u) {
    let bond = bonds[bondIndex];
    var neighbor = params.counts.x;
    if (bond.endpoints.x == nodeIndex) { neighbor = bond.endpoints.y; }
    if (bond.endpoints.y == nodeIndex) { neighbor = bond.endpoints.x; }
    if (neighbor >= params.counts.x) { continue; }
    if (bond.material.w < 0.5) {
      incidentFracture = true;
      continue;
    }
    let delta = nodes[neighbor].position.xyz - nodes[nodeIndex].position.xyz;
    conductiveDelta += (materialsIn[neighbor].thermal.x - state.thermal.x) / max(dot(delta, delta), 0.001);
    conductiveCount += 1.0;
  }
  conductiveDelta = conductiveDelta / max(conductiveCount, 1.0);

  var temperature = max(
    params.thermal.y,
    state.thermal.x + (
      exposure + params.kinetics.x * conductiveDelta -
      params.thermal.w * max(0.0, state.thermal.x - params.thermal.y)
    ) * params.thermal.x
  );
  var fuel = state.thermal.y;
  var charMass = state.thermal.z;
  var phase = state.identity.z;
  var consumedFuel = 0.0;
  let step = atomicLoad(&sourceHeader[18]);
  if (exposure > params.pyroOffset.w && state.events.w == 0u) { state.events.w = step; }
  if (incidentFracture && state.events.z == 0u) { state.events.z = step; }
  if (phase == 0u && temperature >= params.thermal.z) {
    phase = 1u;
    state.events.x = step;
  }
  if (phase > 0u && fuel > 0.0) {
    consumedFuel = min(fuel, params.kinetics.y);
    fuel -= consumedFuel;
    charMass = 1.0 - fuel;
    temperature += consumedFuel * 1.8;
  }
  state.identity.z = phase;
  state.thermal = vec4<f32>(temperature, fuel, charMass, max(state.thermal.w, exposure));
  state.rates = vec4<f32>(exposure, consumedFuel, state.rates.z, state.rates.w);
  materialsOut[nodeIndex] = state;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn weakenBonds(@builtin(global_invocation_id) gid: vec3<u32>) {
  let bondIndex = gid.x;
  if (bondIndex >= params.counts.y) { return; }
  var bond = bonds[bondIndex];
  let adjacentChar = max(materialsOut[bond.endpoints.x].thermal.z, materialsOut[bond.endpoints.y].thermal.z);
  bond.material.y = bondBaselines[bondIndex] * (1.0 - params.kinetics.z * adjacentChar);
  bonds[bondIndex] = bond;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn updateComponentMotions(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nodeIndex = gid.x;
  if (nodeIndex >= params.counts.x) { return; }
  let label = componentLabels[nodeIndex];
  let step = atomicLoad(&sourceHeader[18]);
  var motion = componentMotions[nodeIndex];
  if (label == 0u || (params.identity.w & STRUCTURAL_MOTION_ENABLED) == 0u) {
    motion.translation = vec4<f32>(0.0);
    motion.identity = vec4<u32>(0u, 0u, step, 0u);
  } else {
    let newlyDetached = motion.identity.w == 0u || motion.identity.x != label;
    let detachmentStep = select(motion.identity.y, step, newlyDetached);
    let age = min(f32(step - detachmentStep) * params.thermal.x, params.motion.w);
    motion.translation = vec4<f32>(
      params.motion.x * age,
      params.motion.y * age * age,
      params.motion.z * age,
      1.0
    );
    motion.identity = vec4<u32>(label, detachmentStep, step, 1u);
  }
  componentMotions[nodeIndex] = motion;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn emitSources(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nodeIndex = gid.x;
  if (nodeIndex >= params.counts.x || (params.identity.w & STRUCTURAL_EMISSION_ENABLED) == 0u) { return; }
  var state = materialsOut[nodeIndex];
  let consumedFuel = state.rates.y;
  if (state.identity.z == 0u || consumedFuel <= 0.0) { return; }
  let step = atomicLoad(&sourceHeader[18]);
  let sourceIndex = atomicAdd(&sourceHeader[9], 1u);
  if (sourceIndex < params.counts.z) {
    let position = carriedNodePosition(nodeIndex) * params.pyroScale.xyz + params.pyroOffset.xyz;
    let emittedFuel = consumedFuel * params.emission.y;
    let emittedSoot = consumedFuel * params.emission.z;
    sourceRecords[sourceIndex] = SourceRecord(
      vec4<f32>(position, params.kinetics.w),
      vec4<f32>(0.0, 1.0, 0.0, params.kinetics.w),
      vec4<f32>(params.motion.x, params.motion.y, params.motion.z, 0.0),
      vec4<f32>(state.thermal.x * consumedFuel * params.emission.x, emittedFuel, emittedSoot, emittedSoot * params.emission.w),
      vec4<f32>(state.thermal.y, state.thermal.z, state.thermal.x, 1.0),
      vec4<f32>(f32(params.identity.x), f32(params.identity.y), f32(step), f32(params.identity.z)),
      vec4<f32>(1.0 - state.thermal.z, f32(state.events.x), f32(nodeIndex), f32(componentMotions[nodeIndex].identity.x)),
      vec4<f32>(componentMotions[nodeIndex].translation.xyz, f32(componentMotions[nodeIndex].identity.y))
    );
    atomicAdd(&sourceHeader[14], u32(round((emittedFuel + emittedSoot) * FIXED_POINT)));
    atomicAdd(&sourceHeader[15], u32(round(emittedFuel * FIXED_POINT)));
    atomicAdd(&sourceHeader[16], u32(round(emittedSoot * FIXED_POINT)));
    atomicAdd(&sourceHeader[17], u32(round(state.thermal.x * consumedFuel * params.emission.x * FIXED_POINT)));
    if (state.events.y == 0u) { state.events.y = step; }
    materialsOut[nodeIndex] = state;
    let translation = componentMotions[nodeIndex].translation.xyz;
    if (componentMotions[nodeIndex].identity.w != 0u && dot(translation, translation) > 0.0001) {
      atomicAdd(&carriedFireAudit[0], 1u);
      atomicMin(&carriedFireAudit[1], step);
      atomicMax(&carriedFireAudit[2], step);
      atomicAdd(&carriedFireAudit[3], u32(round(state.thermal.x * consumedFuel * params.emission.x * FIXED_POINT)));
    }
  } else {
    atomicAdd(&sourceHeader[11], 1u);
  }
}

@compute @workgroup_size(1)
fn finalizeSource() {
  let packed = atomicLoad(&sourceHeader[9]);
  let rejected = atomicLoad(&sourceHeader[10]);
  let overflow = atomicLoad(&sourceHeader[11]);
  atomicStore(&sourceHeader[8], packed + rejected + overflow);
  atomicStore(&sourceHeader[5], select(1u, 0u, overflow > 0u));
  atomicStore(&sourceHeader[6], select(1u, 0u, overflow > 0u));
}
`;
}

const STRUCTURAL_COMBUSTION_PRESENTATION_SHADER = /* wgsl */ `
struct NodeRecord {
  position: vec4<f32>,
  displacement: vec4<f32>,
}

struct BondRecord {
  endpoints: vec4<u32>,
  direction: vec4<f32>,
  midpoint: vec4<f32>,
  material: vec4<f32>,
  prior: vec4<f32>,
}

struct NodeMaterial {
  identity: vec4<u32>,
  thermal: vec4<f32>,
  events: vec4<u32>,
  rates: vec4<f32>,
}

struct ComponentMotion {
  translation: vec4<f32>,
  identity: vec4<u32>,
}

struct Presentation {
  viewProjection: mat4x4<f32>,
  world: vec4<f32>,
  style: vec4<f32>,
}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> nodes: array<NodeRecord>;
@group(0) @binding(1) var<storage, read> bonds: array<BondRecord>;
@group(0) @binding(2) var<storage, read> materials: array<NodeMaterial>;
@group(0) @binding(3) var<storage, read> componentLabels: array<u32>;
@group(0) @binding(4) var<uniform> presentation: Presentation;
@group(0) @binding(5) var<storage, read> bondBaselines: array<f32>;
@group(0) @binding(6) var<storage, read> componentMotions: array<ComponentMotion>;

fn carriedNodePosition(nodeIndex: u32) -> vec3<f32> {
  return nodes[nodeIndex].position.xyz + componentMotions[nodeIndex].translation.xyz;
}

fn displayedPosition(nodeIndex: u32) -> vec3<f32> {
  let node = nodes[nodeIndex];
  return (carriedNodePosition(nodeIndex) - vec3<f32>(0.5)) * presentation.style.xyz +
    node.displacement.xyz + presentation.world.xyz;
}

fn materialColor(material: NodeMaterial) -> vec3<f32> {
  let heat = smoothstep(0.48, 1.15, material.thermal.x);
  let charMass = clamp(material.thermal.z, 0.0, 1.0);
  let fuelLoss = 1.0 - clamp(material.thermal.y, 0.0, 1.0);
  let scorch = clamp(charMass * 0.72 + fuelLoss * 0.22, 0.0, 1.0);
  let virgin = vec3<f32>(0.44, 0.29, 0.14);
  let scorched = vec3<f32>(0.16, 0.07, 0.025);
  let charred = vec3<f32>(0.025, 0.018, 0.015);
  let ember = vec3<f32>(1.0, 0.15, 0.018);
  let base = mix(mix(virgin, scorched, scorch), charred, pow(charMass, 1.2));
  let emissive = heat * (1.0 - charMass * 0.35);
  return mix(base, ember, min(0.88, emissive * 0.84));
}

@vertex
fn bondVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) bondIndex: u32) -> VertexOut {
  let bond = bonds[bondIndex];
  let nodeIndex = select(bond.endpoints.x, bond.endpoints.y, vertexIndex == 1u);
  let material = materials[nodeIndex];
  var out: VertexOut;
  out.position = presentation.viewProjection * vec4<f32>(displayedPosition(nodeIndex), 1.0);
  let baseColor = materialColor(material);
  let charMass = max(materials[bond.endpoints.x].thermal.z, materials[bond.endpoints.y].thermal.z);
  let strengthRatio = clamp(bond.material.y / max(0.0001, bondBaselines[bondIndex]), 0.0, 1.0);
  let alive = bond.material.w >= 0.5;
  let opacity = select(0.0, clamp(0.15 + 0.75 * strengthRatio * (1.0 - charMass * 0.35), 0.08, 0.9), alive);
  out.color = vec4<f32>(baseColor * mix(0.42, 1.0, strengthRatio), opacity);
  return out;
}

@vertex
fn nodeVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) nodeIndex: u32) -> VertexOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let material = materials[nodeIndex];
  var clip = presentation.viewProjection * vec4<f32>(displayedPosition(nodeIndex), 1.0);
  let pinnedScale = select(1.0, 1.35, nodes[nodeIndex].position.w > 0.5);
  clip.xy += corners[vertexIndex] * 0.0095 * pinnedScale * clip.w;
  var out: VertexOut;
  out.position = clip;
  out.color = vec4<f32>(materialColor(material), 0.96);
  return out;
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
}
`;

export async function createGpuStructuralCombustionAssembly({
  device,
  gridSize,
  format,
  structures = [],
  load,
  mode = 'structural-combustion',
} = {}) {
  if (!device?.queue) throw new Error('GPU structural combustion requires a caller-owned GPUDevice and GPUQueue');
  const grid = positiveInteger(gridSize, 0);
  if (grid < 4) throw new Error('GPU structural combustion grid must be at least 4');
  if (!format) throw new Error('GPU structural combustion requires a presentation format');
  if (!Array.isArray(structures) || structures.length < 1) throw new Error('GPU structural combustion requires structural sockets');

  const sockets = structures.map(structure => {
    const descriptor = structure.sidecar?.residentDescriptor?.();
    if (descriptor?.schema !== 'kaminos.structural-material.webgpu-resident-buffers.v0') {
      throw new Error(`structural combustion resident descriptor mismatch for ${structure.id}`);
    }
    if (descriptor.device !== device || descriptor.queue !== device.queue) {
      throw new Error(`structural combustion GPU identity mismatch for ${structure.id}`);
    }
    if (descriptor.nodeCount !== structure.state?.nodes?.length || descriptor.bondCount !== structure.state?.bonds?.length) {
      throw new Error(`structural combustion topology count mismatch for ${structure.id}`);
    }
    if (descriptor.nodeStrideBytes !== 32 || descriptor.bondStrideBytes !== 80) {
      throw new Error(`structural combustion structural ABI mismatch for ${structure.id}`);
    }
    const flags = structureFlags(structure);
    return {
      ...structure,
      role: structure.role || (structure.control ? 'control' : 'emitter'),
      flags,
      exposureEnabled: (flags & STRUCTURAL_EXPOSURE_ENABLED) !== 0,
      emissionEnabled: (flags & STRUCTURAL_EMISSION_ENABLED) !== 0,
      motionEnabled: (flags & STRUCTURAL_MOTION_ENABLED) !== 0,
      descriptor,
      materialIndex: 0,
      bindGroups: [new Map(), new Map()],
    };
  });
  const emittingSockets = sockets.filter(socket => socket.emissionEnabled);
  if (emittingSockets.length !== 1) throw new Error('GPU structural combustion requires exactly one emitting target');
  if (mode === STRUCTURAL_CARRIED_FIRE_MODE) {
    const requiredRoles = ['emitter', 'control', 'propagation-target', 'propagation-control'];
    for (const role of requiredRoles) {
      if (sockets.filter(socket => socket.role === role).length !== 1) {
        throw new Error(`GPU structural carried fire requires exactly one ${role}`);
      }
    }
    if (sockets.length !== requiredRoles.length) {
      throw new Error('GPU structural carried fire contains unexpected structural roles');
    }
  }
  const targetSocket = emittingSockets[0];
  const target = targetSocket;
  const sourceCapacity = targetSocket.state.nodes.length;
  const ownedBuffers = [];
  const makeBuffer = descriptor => {
    const buffer = device.createBuffer(descriptor);
    ownedBuffers.push(buffer);
    return buffer;
  };
  const sourceHeaderBuffer = makeBuffer({
    label: 'structural combustion source header',
    size: COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const sourceRecordsBuffer = makeBuffer({
    label: 'structural combustion source records',
    size: sourceCapacity * COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const carriedFireAuditBuffer = makeBuffer({
    label: 'structural combustion carried fire audit',
    size: CARRIED_FIRE_AUDIT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(sourceHeaderBuffer, 0, new Uint32Array(COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES / 4));
  device.queue.writeBuffer(carriedFireAuditBuffer, 0, new Uint32Array([
    0, 0xffffffff, 0, 0, 0, 0, 0, 0,
  ]));

  for (const socket of sockets) {
    const initialMaterials = packNodeMaterials(socket.state, socket.objectId, socket.flags);
    socket.materialBuffers = [0, 1].map(index => makeBuffer({
      label: `structural combustion ${socket.id} materials ${index}`,
      size: initialMaterials.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }));
    socket.materialBuffers.forEach(buffer => device.queue.writeBuffer(buffer, 0, initialMaterials));
    socket.componentMotionBuffer = makeBuffer({
      label: `structural combustion ${socket.id} component motions`,
      size: socket.descriptor.nodeCount * COMPONENT_MOTION_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(
      socket.componentMotionBuffer,
      0,
      new Uint32Array(socket.descriptor.nodeCount * COMPONENT_MOTION_BYTES / Uint32Array.BYTES_PER_ELEMENT),
    );
    const baselines = packBondBaselines(socket.state);
    socket.baselineBuffer = makeBuffer({
      label: `structural combustion ${socket.id} bond baselines`,
      size: Math.max(4, baselines.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(socket.baselineBuffer, 0, baselines);
    socket.paramsBuffer = makeBuffer({
      label: `structural combustion ${socket.id} params`,
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      socket.paramsBuffer,
      0,
      packParams(socket, socket.descriptor.nodeCount, socket.descriptor.bondCount, sourceCapacity, grid),
    );
    socket.presentationBuffer = makeBuffer({
      label: `structural combustion ${socket.id} presentation`,
      size: PRESENTATION_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  const computeShaderSource = structuralCombustionShader(grid);
  const module = device.createShaderModule({
    label: STRUCTURAL_COMBUSTION_AUTHORITY,
    code: computeShaderSource,
  });
  const presentationModule = device.createShaderModule({
    label: 'structural combustion dimensional presentation',
    code: STRUCTURAL_COMBUSTION_PRESENTATION_SHADER,
  });
  try {
    await Promise.all([
      assertShaderModuleCompiles(module, STRUCTURAL_COMBUSTION_AUTHORITY, computeShaderSource),
      assertShaderModuleCompiles(
        presentationModule,
        'structural combustion dimensional presentation',
        STRUCTURAL_COMBUSTION_PRESENTATION_SHADER,
      ),
    ]);
  } catch (error) {
    ownedBuffers.forEach(buffer => buffer.destroy());
    throw error;
  }
  const computeLayout = device.createBindGroupLayout({
    label: 'structural combustion compute layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const motionLayout = device.createBindGroupLayout({
    label: 'structural combustion component motion layout',
    entries: [
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const emissionLayout = device.createBindGroupLayout({
    label: 'structural combustion carried source emission layout',
    entries: [
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const computePipelineLayout = device.createPipelineLayout({
    label: 'structural combustion compute pipeline layout',
    bindGroupLayouts: [computeLayout],
  });
  const motionPipelineLayout = device.createPipelineLayout({
    label: 'structural combustion component motion pipeline layout',
    bindGroupLayouts: [motionLayout],
  });
  const emissionPipelineLayout = device.createPipelineLayout({
    label: 'structural combustion carried source emission pipeline layout',
    bindGroupLayouts: [emissionLayout],
  });
  const [clearPipeline, updatePipeline, weakenPipeline, motionPipeline, emitPipeline, finalizePipeline] = await Promise.all([
    device.createComputePipelineAsync({ label: 'structural combustion clear source', layout: computePipelineLayout, compute: { module, entryPoint: 'clearSource' } }),
    device.createComputePipelineAsync({ label: 'structural combustion update nodes', layout: computePipelineLayout, compute: { module, entryPoint: 'updateNodes' } }),
    device.createComputePipelineAsync({ label: 'structural combustion weaken bonds', layout: computePipelineLayout, compute: { module, entryPoint: 'weakenBonds' } }),
    device.createComputePipelineAsync({ label: 'structural combustion project component motion', layout: motionPipelineLayout, compute: { module, entryPoint: 'updateComponentMotions' } }),
    device.createComputePipelineAsync({ label: 'structural combustion emit carried sources', layout: emissionPipelineLayout, compute: { module, entryPoint: 'emitSources' } }),
    device.createComputePipelineAsync({ label: 'structural combustion finalize source', layout: computePipelineLayout, compute: { module, entryPoint: 'finalizeSource' } }),
  ]);
  const presentationLayout = device.createBindGroupLayout({
    label: 'structural combustion presentation layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const presentationPipelineLayout = device.createPipelineLayout({
    label: 'structural combustion presentation pipeline layout',
    bindGroupLayouts: [presentationLayout],
  });
  const presentationTargets = [{
    format,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    },
  }];
  const [bondPresentationPipeline, nodePresentationPipeline] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'structural combustion resident bonds',
      layout: presentationPipelineLayout,
      vertex: { module: presentationModule, entryPoint: 'bondVertex' },
      fragment: { module: presentationModule, entryPoint: 'fragmentMain', targets: presentationTargets },
      primitive: { topology: 'line-list', cullMode: 'none' },
    }),
    device.createRenderPipelineAsync({
      label: 'structural combustion resident nodes',
      layout: presentationPipelineLayout,
      vertex: { module: presentationModule, entryPoint: 'nodeVertex' },
      fragment: { module: presentationModule, entryPoint: 'fragmentMain', targets: presentationTargets },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  ]);
  sockets.forEach(socket => {
    socket.presentationBindGroups = socket.materialBuffers.map((materialBuffer, index) => device.createBindGroup({
      label: `structural combustion ${socket.id} presentation ${index}`,
      layout: presentationLayout,
      entries: [
        { binding: 0, resource: { buffer: socket.descriptor.nodeBuffer } },
        { binding: 1, resource: { buffer: socket.descriptor.bondBuffer } },
        { binding: 2, resource: { buffer: materialBuffer } },
        { binding: 3, resource: { buffer: socket.descriptor.componentLabelBuffer } },
        { binding: 4, resource: { buffer: socket.presentationBuffer } },
        { binding: 5, resource: { buffer: socket.baselineBuffer } },
        { binding: 6, resource: { buffer: socket.componentMotionBuffer } },
      ],
    }));
    socket.motionBindGroup = device.createBindGroup({
      label: `structural combustion ${socket.id} component motion`,
      layout: motionLayout,
      entries: [
        { binding: 6, resource: { buffer: sourceHeaderBuffer } },
        { binding: 8, resource: { buffer: socket.paramsBuffer } },
        { binding: 9, resource: { buffer: socket.descriptor.componentLabelBuffer } },
        { binding: 10, resource: { buffer: socket.componentMotionBuffer } },
      ],
    });
    socket.emissionBindGroups = socket.materialBuffers.map((_, materialIndex) => device.createBindGroup({
      label: `structural combustion ${socket.id} carried source emission ${materialIndex}`,
      layout: emissionLayout,
      entries: [
        { binding: 1, resource: { buffer: socket.descriptor.nodeBuffer } },
        { binding: 4, resource: { buffer: socket.materialBuffers[1 - materialIndex] } },
        { binding: 6, resource: { buffer: sourceHeaderBuffer } },
        { binding: 7, resource: { buffer: sourceRecordsBuffer } },
        { binding: 8, resource: { buffer: socket.paramsBuffer } },
        { binding: 10, resource: { buffer: socket.componentMotionBuffer } },
        { binding: 11, resource: { buffer: carriedFireAuditBuffer } },
      ],
    }));
  });

  function bindGroup(socket, fluidBuffer) {
    const cache = socket.bindGroups[socket.materialIndex];
    let bindGroup = cache.get(fluidBuffer);
    if (bindGroup) return bindGroup;
    bindGroup = device.createBindGroup({
      label: `structural combustion ${socket.id} state ${socket.materialIndex}`,
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: fluidBuffer } },
        { binding: 1, resource: { buffer: socket.descriptor.nodeBuffer } },
        { binding: 2, resource: { buffer: socket.descriptor.bondBuffer } },
        { binding: 3, resource: { buffer: socket.materialBuffers[socket.materialIndex] } },
        { binding: 4, resource: { buffer: socket.materialBuffers[1 - socket.materialIndex] } },
        { binding: 5, resource: { buffer: socket.baselineBuffer } },
        { binding: 6, resource: { buffer: sourceHeaderBuffer } },
        { binding: 8, resource: { buffer: socket.paramsBuffer } },
        { binding: 10, resource: { buffer: socket.componentMotionBuffer } },
      ],
    });
    cache.set(fluidBuffer, bindGroup);
    return bindGroup;
  }

  let dispatchCount = 0;
  let presentationCount = 0;
  let runtimeReadbackCount = 0;
  let frozen = false;
  let destroyed = false;
  let lastTerminalReceipt = null;

  function encodePass(encoder, label, pipeline, group, workgroups) {
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
  }

  function encode(encoder, fluidBuffer) {
    if (destroyed) throw new Error('GPU structural combustion assembly is destroyed');
    if (frozen) throw new Error('GPU structural combustion assembly is frozen');
    if (!encoder?.beginComputePass || !fluidBuffer) throw new Error('GPU structural combustion encode requires an encoder and current Pyro field');
    const groups = sockets.map(socket => bindGroup(socket, fluidBuffer));
    const targetGroup = groups[sockets.indexOf(targetSocket)];
    encodePass(encoder, 'structural combustion clear source', clearPipeline, targetGroup, 1);
    sockets.forEach((socket, index) => {
      encodePass(
        encoder,
        `structural combustion heat and conduct ${socket.id}`,
        updatePipeline,
        groups[index],
        Math.ceil(socket.descriptor.nodeCount / WORKGROUP_SIZE),
      );
    });
    sockets.forEach((socket, index) => {
      encodePass(
        encoder,
        `structural combustion weaken ${socket.id}`,
        weakenPipeline,
        groups[index],
        Math.ceil(socket.descriptor.bondCount / WORKGROUP_SIZE),
      );
      socket.sidecar.encodeResidentInteraction(encoder, socket.load || load);
    });
    sockets.forEach((socket, index) => {
      encodePass(
        encoder,
        `structural combustion component motion ${socket.id}`,
        motionPipeline,
        socket.motionBindGroup,
        Math.ceil(socket.descriptor.nodeCount / WORKGROUP_SIZE),
      );
    });
    encodePass(
      encoder,
      `structural combustion emit carried sources ${targetSocket.id}`,
      emitPipeline,
      targetSocket.emissionBindGroups[targetSocket.materialIndex],
      Math.ceil(targetSocket.descriptor.nodeCount / WORKGROUP_SIZE),
    );
    encodePass(encoder, 'structural combustion finalize source', finalizePipeline, targetGroup, 1);
    sockets.forEach(socket => { socket.materialIndex = 1 - socket.materialIndex; });
    dispatchCount += 1;
    return {
      status: 'encoded',
      dispatchCount,
      structureCount: sockets.length,
      readbackCount: 0,
      hostCausalFeedbackCount: 0,
    };
  }

  function sourceDescriptor() {
    return {
      schema: 'kaminos.combustible-object-source-descriptor.v0',
      packing: 'gpu-sparse-combustible-object-source-vec4x8-v0',
      device,
      queue: device.queue,
      headerBuffer: sourceHeaderBuffer,
      recordsBuffer: sourceRecordsBuffer,
      headerBytes: COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
      recordBytes: COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES,
      recordFloats: COMBUSTIBLE_OBJECT_SOURCE_RECORD_BYTES / Float32Array.BYTES_PER_ELEMENT,
      capacity: sourceCapacity,
      allocationGeneration: 1,
      topologyEpoch: 0,
      materialStep: 0,
      writeTick: 1,
      sourceFrameId: 'gpu-structural-combustion-assembly',
      sourceFrameHash: SOURCE_FRAME_HASH,
      transformId: 'gpu-structural-node-unit-domain-v0',
      objectToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      sourceCount: sourceCapacity,
      packedCount: sourceCapacity,
      rejectedCount: 0,
      overflowCount: 0,
      malformedCount: 0,
      emittedVolatileMass: 0,
      emittedFuelMass: 0,
      emittedSootMass: 0,
      emittedHeat: 0,
      accountingResidual: 0,
      gpuAuthoredDynamic: true,
      auditObjectId: target.objectId,
    };
  }

  function encodePresentation(encoder, view, viewProjection) {
    if (destroyed) throw new Error('GPU structural combustion assembly is destroyed');
    if (!encoder?.beginRenderPass || !view) throw new Error('GPU structural combustion presentation requires an encoder and texture view');
    if (!viewProjection || viewProjection.length !== 16 || [...viewProjection].some(value => !Number.isFinite(value))) {
      throw new Error('GPU structural combustion presentation requires a finite view-projection matrix');
    }
    sockets.forEach(socket => {
      const values = new Float32Array(PRESENTATION_BYTES / 4);
      values.set(viewProjection, 0);
      values.set([...(socket.worldOffset || [0, 0, 0]), socket.control ? 1 : 0], 16);
      values.set([...(socket.displayScale || [1.12, 0.68, 0.58]), socket.control ? 1 : 0], 20);
      device.queue.writeBuffer(socket.presentationBuffer, 0, values);
    });
    const pass = encoder.beginRenderPass({
      label: 'structural combustion dimensional overlay',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    });
    sockets.forEach(socket => {
      pass.setBindGroup(0, socket.presentationBindGroups[socket.materialIndex]);
      pass.setPipeline(bondPresentationPipeline);
      pass.draw(2, socket.descriptor.bondCount);
      pass.setPipeline(nodePresentationPipeline);
      pass.draw(6, socket.descriptor.nodeCount);
    });
    pass.end();
    presentationCount += 1;
    return true;
  }

  async function readTerminalReceipt(receiverStatsDescriptor) {
    if (!frozen) throw new Error('GPU structural combustion terminal readback requires a frozen runtime');
    if (runtimeReadbackCount !== 0) throw new Error('GPU structural combustion terminal receipt was already read');
    if (receiverStatsDescriptor?.schema !== 'kaminos.pyro-combustible-object-source-consumer-stats-buffer.v0' ||
        receiverStatsDescriptor.routeIdentity !== COMBUSTIBLE_OBJECT_FIRE_ROUTE ||
        receiverStatsDescriptor.bytes !== COMBUSTIBLE_OBJECT_FIRE_CONSUMER_STATS_BYTES ||
        !receiverStatsDescriptor.buffer) {
      throw new Error('GPU structural combustion receiver terminal stats descriptor mismatch');
    }
    let cursor = 0;
    const layouts = sockets.map(socket => {
      const materialBytes = socket.descriptor.nodeCount * NODE_MATERIAL_BYTES;
      const bondBytes = socket.descriptor.bondCount * socket.descriptor.bondStrideBytes;
      const componentBytes = socket.descriptor.nodeCount * Uint32Array.BYTES_PER_ELEMENT;
      const motionBytes = socket.descriptor.nodeCount * COMPONENT_MOTION_BYTES;
      const layout = {
        socket,
        materialOffset: cursor,
        materialBytes,
        bondOffset: cursor + materialBytes,
        bondBytes,
        componentOffset: cursor + materialBytes + bondBytes,
        componentBytes,
        motionOffset: cursor + materialBytes + bondBytes + componentBytes,
        motionBytes,
      };
      cursor += materialBytes + bondBytes + componentBytes + motionBytes;
      return layout;
    });
    const sourceHeaderOffset = cursor;
    cursor += COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES;
    const carriedAuditOffset = cursor;
    cursor += CARRIED_FIRE_AUDIT_BYTES;
    const receiverStatsOffset = cursor;
    cursor += COMBUSTIBLE_OBJECT_FIRE_CONSUMER_STATS_BYTES;
    const readback = device.createBuffer({
      label: 'structural combustion frozen terminal readback',
      size: cursor,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'structural combustion frozen terminal copy' });
    layouts.forEach(layout => {
      const socket = layout.socket;
      encoder.copyBufferToBuffer(
        socket.materialBuffers[socket.materialIndex],
        0,
        readback,
        layout.materialOffset,
        layout.materialBytes,
      );
      encoder.copyBufferToBuffer(
        socket.descriptor.bondBuffer,
        0,
        readback,
        layout.bondOffset,
        layout.bondBytes,
      );
      encoder.copyBufferToBuffer(
        socket.descriptor.componentLabelBuffer,
        0,
        readback,
        layout.componentOffset,
        layout.componentBytes,
      );
      encoder.copyBufferToBuffer(
        socket.componentMotionBuffer,
        0,
        readback,
        layout.motionOffset,
        layout.motionBytes,
      );
    });
    encoder.copyBufferToBuffer(
      sourceHeaderBuffer,
      0,
      readback,
      sourceHeaderOffset,
      COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
    );
    encoder.copyBufferToBuffer(
      carriedFireAuditBuffer,
      0,
      readback,
      carriedAuditOffset,
      CARRIED_FIRE_AUDIT_BYTES,
    );
    encoder.copyBufferToBuffer(
      receiverStatsDescriptor.buffer,
      0,
      readback,
      receiverStatsOffset,
      COMBUSTIBLE_OBJECT_FIRE_CONSUMER_STATS_BYTES,
    );
    device.queue.submit([encoder.finish()]);
    runtimeReadbackCount += 1;
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = readback.getMappedRange().slice(0);
    readback.unmap();
    readback.destroy();
    const view = new DataView(bytes);
    const decodedStructures = layouts.map(layout => {
      const socket = layout.socket;
      const nodes = socket.state.nodes.map((node, index) => {
        const offset = layout.materialOffset + index * NODE_MATERIAL_BYTES;
        const motionOffset = layout.motionOffset + index * COMPONENT_MOTION_BYTES;
        return {
          nodeId: node.id,
          objectId: view.getUint32(offset, true),
          nodeIndex: view.getUint32(offset + 4, true),
          phase: view.getUint32(offset + 8, true),
          control: (view.getUint32(offset + 12, true) & STRUCTURAL_CONTROL) !== 0,
          position: [node.x, node.y, node.z],
          temperature: view.getFloat32(offset + 16, true),
          fuel: view.getFloat32(offset + 20, true),
          char: view.getFloat32(offset + 24, true),
          peakExposure: view.getFloat32(offset + 28, true),
          ignitionStep: view.getUint32(offset + 32, true),
          firstEmissionStep: view.getUint32(offset + 36, true),
          firstIncidentFractureStep: view.getUint32(offset + 40, true),
          firstExposureStep: view.getUint32(offset + 44, true),
          lastExposure: view.getFloat32(offset + 48, true),
          componentMotion: {
            translation: [
              view.getFloat32(motionOffset, true),
              view.getFloat32(motionOffset + 4, true),
              view.getFloat32(motionOffset + 8, true),
            ],
            componentLabel: view.getUint32(motionOffset + 16, true),
            detachmentStep: view.getUint32(motionOffset + 20, true),
            updatedStep: view.getUint32(motionOffset + 24, true),
            active: view.getUint32(motionOffset + 28, true) !== 0,
          },
        };
      });
      const bonds = socket.state.bonds.map((bond, index) => {
        const offset = layout.bondOffset + index * socket.descriptor.bondStrideBytes;
        return {
          bondId: bond.id,
          initialStrength: Number(bond.strength) || 0,
          strength: view.getFloat32(offset + 52, true),
          alive: view.getFloat32(offset + 60, true) >= 0.5,
        };
      });
      const componentLabels = Array.from(new Uint32Array(
        bytes.slice(layout.componentOffset, layout.componentOffset + layout.componentBytes),
      ));
      return {
        id: socket.id,
        role: socket.role,
        objectId: socket.objectId,
        control: Boolean(socket.control),
        exposureEnabled: socket.exposureEnabled,
        emissionEnabled: socket.emissionEnabled,
        motionEnabled: socket.motionEnabled,
        nodes,
        bonds,
        componentLabels,
        componentCount: new Set(componentLabels).size,
        brokenBondCount: bonds.filter(bond => !bond.alive).length,
        weakenedBondCount: bonds.filter(bond => bond.strength < bond.initialStrength * 0.75).length,
      };
    });
    const header = new Uint32Array(bytes.slice(
      sourceHeaderOffset,
      sourceHeaderOffset + COMBUSTIBLE_OBJECT_SOURCE_HEADER_BYTES,
    ));
    const sourceHeader = {
      magic: header[0],
      version: header[1],
      allocationGeneration: header[2],
      topologyEpoch: header[3],
      writeTick: header[4],
      complete: header[5],
      published: header[6],
      sourceFrameHash: header[7],
      sourceCount: header[8],
      packedCount: header[9],
      rejectedCount: header[10],
      overflowCount: header[11],
      materialStep: header[18],
    };
    const carriedAuditValues = new Uint32Array(bytes.slice(
      carriedAuditOffset,
      carriedAuditOffset + CARRIED_FIRE_AUDIT_BYTES,
    ));
    const carriedAudit = {
      movedSourceRecords: carriedAuditValues[0],
      firstMovedSourceStep: carriedAuditValues[1] === 0xffffffff ? 0 : carriedAuditValues[1],
      lastMovedSourceStep: carriedAuditValues[2],
      movedSourceHeat: carriedAuditValues[3] / 65536,
    };
    const receiverAudit = decodeCombustibleObjectFireConsumerStats(
      bytes.slice(receiverStatsOffset, receiverStatsOffset + COMBUSTIBLE_OBJECT_FIRE_CONSUMER_STATS_BYTES),
    );
    const checks = evaluateStructuralCombustionTerminalChecks({
      decodedStructures,
      sourceHeader,
      receiverAudit,
      hostCausalFeedbackCount: 0,
    });
    if (mode === STRUCTURAL_CARRIED_FIRE_MODE) {
      Object.assign(checks, evaluateStructuralCarriedFireTerminalChecks({
        decodedStructures,
        receiverAudit,
        carriedAudit,
        hostCausalFeedbackCount: 0,
      }));
    }
    lastTerminalReceipt = {
      schema: 'kaminos.structural-combustion.frozen-terminal-receipt.v0',
      authority: STRUCTURAL_COMBUSTION_AUTHORITY,
      mode,
      status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
      checks,
      dispatchCount,
      presentationCount,
      runtimeReadbackCount,
      liveRuntimeReadbackCount: 0,
      terminalReadbackCount: runtimeReadbackCount,
      terminalMapAsyncCount: 1,
      hostCausalFeedbackCount: 0,
      structures: decodedStructures,
      sourceHeader,
      carriedAudit,
      receiverAudit,
    };
    return lastTerminalReceipt;
  }

  function debugState() {
    return {
      schema: STRUCTURAL_COMBUSTION_SCHEMA,
      authority: STRUCTURAL_COMBUSTION_AUTHORITY,
      mode,
      status: destroyed ? 'destroyed' : frozen ? 'frozen' : 'active',
      dispatchCount,
      presentationCount,
      runtimeReadbackCount,
      liveRuntimeReadbackCount: 0,
      terminalReadbackCount: runtimeReadbackCount,
      hostCausalFeedbackCount: 0,
      structureCount: sockets.length,
      emittingObjectId: target.objectId,
      sourceCapacity,
      deviceOwnership: 'borrowed',
      lastTerminalReceipt,
    };
  }

  return {
    schema: STRUCTURAL_COMBUSTION_SCHEMA,
    authority: STRUCTURAL_COMBUSTION_AUTHORITY,
    gridSize: grid,
    encode,
    encodePresentation,
    readTerminalReceipt,
    sourceDescriptor,
    debugState,
    freeze() { frozen = true; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ownedBuffers.forEach(buffer => buffer.destroy());
      sockets.forEach(socket => socket.bindGroups.forEach(cache => cache.clear()));
    },
  };
}
