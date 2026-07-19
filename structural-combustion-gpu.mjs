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
const PRESENTATION_BYTES = 112;
const MESH_VERTEX_BYTES = 32;
const MESH_BINDING_BYTES = 48;
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

async function createShaderPipeline({ create, moduleLabel, entryPoint, source }) {
  try {
    return await create();
  } catch (error) {
    throw new Error(
      `${moduleLabel} pipeline validation failed (entry point ${entryPoint}, source ${shaderSourceIdentity(source)}): ` +
      `${error?.message || String(error)}`,
    );
  }
}

async function constructWithOwnedBufferCleanup(ownedBuffers, construct) {
  try {
    return await construct();
  } catch (error) {
    ownedBuffers.forEach(buffer => {
      try { buffer.destroy(); } catch {}
    });
    throw error;
  }
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
  peakExposure = 0,
  liveExposure = 0,
  phase = 0,
  consumptionRate = 0,
  bondAlive = true,
  strengthRatio = 1,
} = {}) {
  const thermal = Math.max(0, finite(temperature, 0.08));
  const remainingFuel = clamp(finite(fuel, 1), 0, 1);
  const charPersistence = clamp(finite(char, 0), 0, 1);
  const historicalExposure = Math.max(0, finite(peakExposure, 0));
  const currentExposure = Math.max(0, finite(liveExposure, 0));
  const ignition = smoothstep(0.25, 0.75, Math.max(0, finite(phase, 0)));
  const reaction = Math.max(0, finite(consumptionRate, 0));
  const fuelLoss = 1 - remainingFuel;
  const heat = smoothstep(0.48, 1.15, thermal);
  const charStage = smoothstep(0.02, 0.8, charPersistence);
  const pyrolysis = smoothstep(0.000001, 0.0025, reaction) *
    smoothstep(0.02, 0.35, remainingFuel) * ignition;
  const preheat = Math.max(
    smoothstep(0.12, 0.52, thermal),
    smoothstep(0.02, 0.45, historicalExposure),
  ) * (1 - charStage) * (1 - pyrolysis);
  const contact = smoothstep(0.01, 0.6, currentExposure);
  const virginWeight = clamp(1 - Math.max(preheat, pyrolysis, charStage), 0, 1);
  const virgin = [0.44, 0.29, 0.14];
  const heated = [0.52, 0.19, 0.05];
  const pyrolyzing = [0.98, 0.20, 0.018];
  const mildChar = [0.16, 0.11, 0.07];
  const deepChar = [0.085, 0.062, 0.045];
  const contactChar = [0.23, 0.075, 0.025];
  const exposureScorch = smoothstep(0.15, 2.2, historicalExposure);
  const charColor = mixColor(mildChar, deepChar, exposureScorch);
  let materialColor = mixColor(virgin, heated, preheat);
  materialColor = mixColor(materialColor, charColor, charStage);
  materialColor = mixColor(materialColor, contactChar, contact * charStage * (1 - pyrolysis) * 0.28);
  materialColor = mixColor(materialColor, pyrolyzing, pyrolysis * (0.28 + contact * 0.44));
  const emissiveStrength = heat * pyrolysis * (0.25 + contact * 0.75) * (1 - charPersistence * 0.35);
  const remainingStrength = clamp(finite(strengthRatio, 1), 0, 1);
  const bondOpacity = bondAlive
    ? clamp(0.15 + 0.75 * remainingStrength * (1 - charPersistence * 0.35), 0.08, 0.9)
    : 0;
  const semanticWeights = {
    virgin: virginWeight,
    preheat,
    pyrolysis,
    char: charStage,
    contact,
    ignition,
  };
  const dominantStage = pyrolysis > 0.35
    ? 'pyrolysis'
    : charStage > 0.35
      ? 'char'
      : preheat > 0.25
        ? 'preheat'
        : 'virgin';
  return {
    materialColor,
    emissiveStrength,
    charPersistence,
    fuelLoss,
    bondOpacity,
    semanticWeights,
    dominantStage,
  };
}

export function evaluateStructuralBurnMesostructure({
  materialPosition = [0, 0, 0],
  faceAxis = [0, 1, 0],
  fractureFace = false,
  ...burnState
} = {}) {
  const position = Array.from({ length: 3 }, (_, index) => finite(materialPosition?.[index], 0));
  const axis = Array.from({ length: 3 }, (_, index) => finite(faceAxis?.[index], index === 1 ? 1 : 0));
  const [x, y, z] = position;
  const longitudinal = 0.5 + 0.5 * Math.sin(
    (y * 15.7 + z * 10.9 + Math.sin(x * Math.PI * 3) * 0.18) * Math.PI * 2,
  );
  const fineFiber = 0.5 + 0.5 * Math.sin(
    (y * 43.1 + z * 29.7 + Math.sin(x * Math.PI * 5) * 0.11) * Math.PI * 2,
  );
  const sidePattern = clamp(longitudinal * 0.72 + fineFiber * 0.28, 0, 1);
  const dominantAxis = Math.abs(axis[0]) >= Math.abs(axis[1]) && Math.abs(axis[0]) >= Math.abs(axis[2])
    ? 0
    : Math.abs(axis[1]) >= Math.abs(axis[2]) ? 1 : 2;
  const plane = dominantAxis === 0 ? [y, z] : dominantAxis === 1 ? [x, z] : [x, y];
  const planeX = (plane[0] - 0.5) * 1.25;
  const planeY = (plane[1] - 0.5) * 1.25;
  const radius = Math.hypot(planeX, planeY);
  const angle = Math.atan2(planeY, planeX);
  const rings = 0.5 + 0.5 * Math.sin((radius * 19 + angle * 0.16) * Math.PI * 2);
  const rays = 0.5 + 0.5 * Math.cos(angle * 9 + radius * 5);
  const crossPattern = clamp(rings * 0.78 + rays * 0.22, 0, 1);
  const crossGrainWeight = fractureFace ? 1 : smoothstep(0.65, 1, Math.abs(axis[0]));
  const pattern = sidePattern + (crossPattern - sidePattern) * crossGrainWeight;
  const poreSignal = 0.5 + 0.5 * Math.sin(
    (x * 37.1 + y * 61.7 + z * 73.3 + pattern * 0.67) * Math.PI * 2,
  );
  const pore = smoothstep(0.74, 0.96, poreSignal);
  const appearance = evaluateStructuralBurnAppearance(burnState);
  const { preheat, pyrolysis, char: charStage } = appearance.semanticWeights;
  const roughness = clamp(
    0.34 + preheat * 0.1 + pyrolysis * 0.16 + charStage * 0.43 + pore * charStage * 0.09 + crossGrainWeight * 0.05,
    0.28,
    0.96,
  );
  const specular = clamp(0.2 * (1 - charStage * 0.88) * (1 - preheat * 0.22) * (1 - pyrolysis * 0.3), 0.015, 0.22);
  const activeBreakup = pyrolysis * smoothstep(0.34, 0.82, pattern * 0.68 + pore * 0.32);
  return {
    pattern,
    crossGrainWeight,
    pore,
    roughness,
    specular,
    activeBreakup,
    localEmission: appearance.emissiveStrength * (0.52 + activeBreakup * 0.78),
  };
}

export function createStructuralBurnFaceEmitter({
  worldOffset = [0, 0, 0],
  displayScale = [1.12, 0.42, 0.36],
  radius,
} = {}) {
  const vector = (value, fallback) => Array.from({ length: 3 }, (_, index) => finite(value?.[index], fallback[index]));
  const center = vector(worldOffset, [0, 0, 0]);
  const scale = vector(displayScale, [1.12, 0.42, 0.36]).map(value => Math.abs(value));
  const contactRadius = Math.max(0.0001, finite(radius, Math.min(scale[1], scale[2]) * (17 / 72)));
  const facePosition = [center[0] + scale[0] * 0.5, center[1], center[2]];
  const emitterX = facePosition[0];
  const segmentHalfWidth = contactRadius * (4 / 17);
  const start = [emitterX - segmentHalfWidth, center[1] - scale[1] * (6 / 7), center[2]];
  const end = [emitterX + segmentHalfWidth, center[1] - scale[1] * (5 / 42), center[2]];
  return {
    face: 'positive-x',
    facePosition,
    overlapDepth: contactRadius - Math.abs(emitterX - facePosition[0]),
    start,
    end,
    radius: contactRadius,
  };
}

function structuralMeshVector(name, value, length) {
  if ((!ArrayBuffer.isView(value) && !Array.isArray(value)) || value.length !== length) {
    throw new Error(`structural mesh ${name} must contain ${length} numeric values`);
  }
  const values = Array.from(value, Number);
  if (values.some(item => !Number.isFinite(item))) {
    throw new Error(`structural mesh ${name} must be finite`);
  }
  return values;
}

function structuralMeshNodeBounds(island, islandIndex) {
  const minimum = structuralMeshVector(`island ${islandIndex} node bounds minimum`, island?.nodeBounds?.min, 3);
  const maximum = structuralMeshVector(`island ${islandIndex} node bounds maximum`, island?.nodeBounds?.max, 3);
  const motionAnchor = structuralMeshVector(`island ${islandIndex} motion anchor`, island?.motionAnchor, 3);
  if (minimum.some((value, axis) => value > maximum[axis])) {
    throw new Error(`structural mesh island ${islandIndex} node bounds are inverted`);
  }
  if (motionAnchor.some((value, axis) => value < minimum[axis] || value > maximum[axis])) {
    throw new Error(`structural mesh island ${islandIndex} motion anchor is outside its node bounds`);
  }
  return { minimum, maximum, motionAnchor };
}

export function createStructuralMeshSkinBinding({ mesh, state } = {}) {
  if (mesh?.schema !== 'kaminos.structural-mesh-surface.v0') {
    throw new Error('structural mesh surface schema mismatch');
  }
  if (typeof mesh.assetIdentity !== 'string' || mesh.assetIdentity.trim().length === 0) {
    throw new Error('structural mesh requires an asset identity');
  }
  if (!ArrayBuffer.isView(mesh.positions) || mesh.positions.length < 9 || mesh.positions.length % 3 !== 0) {
    throw new Error('structural mesh positions must contain typed triangle vertices');
  }
  const vertexCount = mesh.positions.length / 3;
  const positions = structuralMeshVector('positions', mesh.positions, vertexCount * 3);
  const normals = structuralMeshVector('normals', mesh.normals, vertexCount * 3);
  if (!(mesh.indices instanceof Uint32Array) || mesh.indices.length < 3 || mesh.indices.length % 3 !== 0) {
    throw new Error('structural mesh indices must be a Uint32Array of complete triangles');
  }
  if (!(mesh.vertexIslands instanceof Uint32Array) || mesh.vertexIslands.length !== vertexCount) {
    throw new Error('structural mesh vertex islands must identify every vertex');
  }
  if (!Array.isArray(mesh.islands) || mesh.islands.length < 1) {
    throw new Error('structural mesh requires authored surface islands');
  }
  if (!Array.isArray(state?.nodes) || state.nodes.length < 4) {
    throw new Error('structural mesh binding requires at least four structural nodes');
  }
  const nodePositions = state.nodes.map((node, index) => {
    const position = [Number(node?.x), Number(node?.y), Number(node?.z)];
    if (position.some(value => !Number.isFinite(value))) {
      throw new Error(`structural mesh binding node ${index} has invalid position`);
    }
    return position;
  });
  const islandBounds = mesh.islands.map(structuralMeshNodeBounds);
  const candidatesByIsland = islandBounds.map(({ minimum, maximum }, islandIndex) => {
    const candidates = nodePositions.flatMap((position, nodeIndex) => (
      position.every((value, axis) => value >= minimum[axis] && value <= maximum[axis])
        ? [{ nodeIndex, position }]
        : []
    ));
    if (candidates.length < 4) {
      throw new Error(`structural mesh island ${islandIndex} binds fewer than four structural nodes`);
    }
    return candidates;
  });
  const motionNodeByIsland = islandBounds.map(({ motionAnchor }, islandIndex) => {
    return candidatesByIsland[islandIndex].map(candidate => ({
      ...candidate,
      distanceSquared: candidate.position.reduce((sum, value, axis) => {
        const delta = value - motionAnchor[axis];
        return sum + delta * delta;
      }, 0),
    })).sort((left, right) => left.distanceSquared - right.distanceSquared || left.nodeIndex - right.nodeIndex)[0].nodeIndex;
  });
  for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
    const triangleIndices = [mesh.indices[triangle], mesh.indices[triangle + 1], mesh.indices[triangle + 2]];
    if (triangleIndices.some(index => index >= vertexCount)) {
      throw new Error(`structural mesh triangle ${triangle / 3} index is out of range`);
    }
    const island = mesh.vertexIslands[triangleIndices[0]];
    if (island >= mesh.islands.length || triangleIndices.some(index => mesh.vertexIslands[index] !== island)) {
      throw new Error(`structural mesh triangle ${triangle / 3} spans more than one authored island`);
    }
  }
  const nodeIndices = new Uint32Array(vertexCount * 4);
  const nodeWeights = new Float32Array(vertexCount * 4);
  const motionNodeIndices = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const islandIndex = mesh.vertexIslands[vertex];
    if (islandIndex >= candidatesByIsland.length) {
      throw new Error(`structural mesh vertex ${vertex} references unknown island ${islandIndex}`);
    }
    const position = positions.slice(vertex * 3, vertex * 3 + 3);
    const nearest = candidatesByIsland[islandIndex].map(candidate => ({
      ...candidate,
      distanceSquared: candidate.position.reduce((sum, value, axis) => {
        const delta = value - position[axis];
        return sum + delta * delta;
      }, 0),
    })).sort((left, right) => left.distanceSquared - right.distanceSquared || left.nodeIndex - right.nodeIndex).slice(0, 4);
    const inverseDistances = nearest.map(candidate => 1 / Math.max(1e-8, candidate.distanceSquared));
    const inverseDistanceSum = inverseDistances.reduce((sum, value) => sum + value, 0);
    nearest.forEach((candidate, offset) => {
      nodeIndices[vertex * 4 + offset] = candidate.nodeIndex;
      nodeWeights[vertex * 4 + offset] = inverseDistances[offset] / inverseDistanceSum;
    });
    motionNodeIndices[vertex] = motionNodeByIsland[islandIndex];
  }
  const normalizedNormals = new Float32Array(normals.length);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]);
    if (!(length > 1e-8)) throw new Error(`structural mesh normal ${vertex} has zero length`);
    normalizedNormals[offset] = normals[offset] / length;
    normalizedNormals[offset + 1] = normals[offset + 1] / length;
    normalizedNormals[offset + 2] = normals[offset + 2] / length;
  }
  return {
    schema: 'kaminos.structural-mesh-skin-binding.v0',
    assetIdentity: mesh.assetIdentity,
    vertexCount,
    indexCount: mesh.indices.length,
    triangleCount: mesh.indices.length / 3,
    islandCount: mesh.islands.length,
    nodesPerVertex: 4,
    positions: new Float32Array(positions),
    normals: normalizedNormals,
    indices: new Uint32Array(mesh.indices),
    vertexIslands: new Uint32Array(mesh.vertexIslands),
    nodeIndices,
    nodeWeights,
    motionNodeIndices,
  };
}

function packStructuralMeshVertices(meshSkin) {
  const packed = new Float32Array(meshSkin.vertexCount * MESH_VERTEX_BYTES / Float32Array.BYTES_PER_ELEMENT);
  for (let vertex = 0; vertex < meshSkin.vertexCount; vertex += 1) {
    const target = vertex * 8;
    const source = vertex * 3;
    packed.set(meshSkin.positions.subarray(source, source + 3), target);
    packed[target + 3] = meshSkin.vertexIslands[vertex];
    packed.set(meshSkin.normals.subarray(source, source + 3), target + 4);
  }
  return packed;
}

function packStructuralMeshBindings(meshSkin) {
  const bytes = new ArrayBuffer(meshSkin.vertexCount * MESH_BINDING_BYTES);
  const integers = new Uint32Array(bytes);
  const values = new Float32Array(bytes);
  const wordsPerBinding = MESH_BINDING_BYTES / Uint32Array.BYTES_PER_ELEMENT;
  for (let vertex = 0; vertex < meshSkin.vertexCount; vertex += 1) {
    const target = vertex * wordsPerBinding;
    const source = vertex * meshSkin.nodesPerVertex;
    integers.set(meshSkin.nodeIndices.subarray(source, source + 4), target);
    values.set(meshSkin.nodeWeights.subarray(source, source + 4), target + 4);
    integers.set([
      meshSkin.motionNodeIndices[vertex],
      meshSkin.vertexIslands[vertex],
      0,
      0,
    ], target + 8);
  }
  return new Uint32Array(bytes);
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

struct MeshVertex {
  position: vec4<f32>,
  normal: vec4<f32>,
}

struct MeshBinding {
  nodeIndices: vec4<u32>,
  nodeWeights: vec4<f32>,
  motion: vec4<u32>,
}

struct Presentation {
  viewProjection: mat4x4<f32>,
  world: vec4<f32>,
  style: vec4<f32>,
  topology: vec4<u32>,
}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) surface: f32,
  @location(3) emissive: f32,
  @location(4) thermal: vec4<f32>,
  @location(5) reaction: vec4<f32>,
  @location(6) materialPosition: vec3<f32>,
  @location(7) @interpolate(flat) faceFrame: vec4<f32>,
}

struct WoodCharacter {
  tint: vec3<f32>,
  roughness: f32,
  specular: f32,
  activeBreakup: f32,
}

@group(0) @binding(0) var<storage, read> nodes: array<NodeRecord>;
@group(0) @binding(1) var<storage, read> bonds: array<BondRecord>;
@group(0) @binding(2) var<storage, read> materials: array<NodeMaterial>;
@group(0) @binding(3) var<storage, read> componentLabels: array<u32>;
@group(0) @binding(4) var<uniform> presentation: Presentation;
@group(0) @binding(5) var<storage, read> bondBaselines: array<f32>;
@group(0) @binding(6) var<storage, read> componentMotions: array<ComponentMotion>;
@group(0) @binding(7) var<storage, read> meshVertices: array<MeshVertex>;
@group(0) @binding(8) var<storage, read> meshBindings: array<MeshBinding>;
@group(0) @binding(9) var<storage, read> meshIndices: array<u32>;

fn carriedNodePosition(nodeIndex: u32) -> vec3<f32> {
  return nodes[nodeIndex].position.xyz + componentMotions[nodeIndex].translation.xyz;
}

fn displayedPosition(nodeIndex: u32) -> vec3<f32> {
  let node = nodes[nodeIndex];
  return (carriedNodePosition(nodeIndex) - vec3<f32>(0.5)) * presentation.style.xyz +
    node.displacement.xyz + presentation.world.xyz;
}

fn semanticBurnWeights(thermal: vec4<f32>, reaction: vec4<f32>) -> vec4<f32> {
  let temperature = max(0.0, thermal.x);
  let fuel = clamp(thermal.y, 0.0, 1.0);
  let charMass = clamp(thermal.z, 0.0, 1.0);
  let peakExposure = max(0.0, thermal.w);
  let liveExposure = max(0.0, reaction.x);
  let consumedFuel = max(0.0, reaction.y);
  let ignited = smoothstep(0.25, 0.75, reaction.z);
  let charStage = smoothstep(0.02, 0.8, charMass);
  let pyrolysis = smoothstep(0.000001, 0.0025, consumedFuel) *
    smoothstep(0.02, 0.35, fuel) * ignited;
  let preheat = max(
    smoothstep(0.12, 0.52, temperature),
    smoothstep(0.02, 0.45, peakExposure)
  ) * (1.0 - charStage) * (1.0 - pyrolysis);
  let contact = smoothstep(0.01, 0.6, liveExposure);
  return vec4<f32>(preheat, pyrolysis, charStage, contact);
}

fn semanticBurnAppearance(thermal: vec4<f32>, reaction: vec4<f32>) -> vec4<f32> {
  let temperature = max(0.0, thermal.x);
  let charMass = clamp(thermal.z, 0.0, 1.0);
  let peakExposure = max(0.0, thermal.w);
  let heat = smoothstep(0.48, 1.15, temperature);
  let weights = semanticBurnWeights(thermal, reaction);
  let preheat = weights.x;
  let pyrolysis = weights.y;
  let charStage = weights.z;
  let contact = weights.w;
  let virgin = vec3<f32>(0.44, 0.29, 0.14);
  let heated = vec3<f32>(0.52, 0.19, 0.05);
  let pyrolyzing = vec3<f32>(0.98, 0.20, 0.018);
  let mildChar = vec3<f32>(0.16, 0.11, 0.07);
  let deepChar = vec3<f32>(0.085, 0.062, 0.045);
  let contactChar = vec3<f32>(0.23, 0.075, 0.025);
  let exposureScorch = smoothstep(0.15, 2.2, peakExposure);
  let charColor = mix(mildChar, deepChar, exposureScorch);
  var color = mix(virgin, heated, preheat);
  color = mix(color, charColor, charStage);
  color = mix(color, contactChar, contact * charStage * (1.0 - pyrolysis) * 0.28);
  color = mix(color, pyrolyzing, pyrolysis * (0.28 + contact * 0.44));
  let emissive = heat * pyrolysis * (0.25 + contact * 0.75) * (1.0 - charMass * 0.35);
  return vec4<f32>(color, emissive);
}

fn woodMaterialCharacter(
  materialPosition: vec3<f32>,
  faceFrame: vec4<f32>,
  thermal: vec4<f32>,
  reaction: vec4<f32>
) -> WoodCharacter {
  let x = materialPosition.x;
  let y = materialPosition.y;
  let z = materialPosition.z;
  let longitudinal = 0.5 + 0.5 * sin(
    (y * 15.7 + z * 10.9 + sin(x * 9.42477796) * 0.18) * 6.28318531
  );
  let fineFiber = 0.5 + 0.5 * sin(
    (y * 43.1 + z * 29.7 + sin(x * 15.70796327) * 0.11) * 6.28318531
  );
  let sidePattern = clamp(longitudinal * 0.72 + fineFiber * 0.28, 0.0, 1.0);
  let faceAxis = abs(faceFrame.xyz);
  var plane = materialPosition.yz;
  if (faceAxis.y >= faceAxis.x && faceAxis.y >= faceAxis.z) {
    plane = materialPosition.xz;
  } else if (faceAxis.z >= faceAxis.x && faceAxis.z >= faceAxis.y) {
    plane = materialPosition.xy;
  }
  let centeredPlane = (plane - vec2<f32>(0.5)) * 1.25;
  let radius = length(centeredPlane);
  let angle = atan2(centeredPlane.y, centeredPlane.x);
  let rings = 0.5 + 0.5 * sin((radius * 19.0 + angle * 0.16) * 6.28318531);
  let rays = 0.5 + 0.5 * cos(angle * 9.0 + radius * 5.0);
  let crossPattern = clamp(rings * 0.78 + rays * 0.22, 0.0, 1.0);
  let crossGrainWeight = max(faceFrame.w, smoothstep(0.65, 1.0, faceAxis.x));
  let pattern = mix(sidePattern, crossPattern, crossGrainWeight);
  let poreSignal = 0.5 + 0.5 * sin(
    (x * 37.1 + y * 61.7 + z * 73.3 + pattern * 0.67) * 6.28318531
  );
  let pore = smoothstep(0.74, 0.96, poreSignal);
  let weights = semanticBurnWeights(thermal, reaction);
  let preheat = weights.x;
  let pyrolysis = weights.y;
  let charStage = weights.z;
  let roughness = clamp(
    0.34 + preheat * 0.1 + pyrolysis * 0.16 + charStage * 0.43 +
      pore * charStage * 0.09 + crossGrainWeight * 0.05,
    0.28,
    0.96
  );
  let specular = clamp(
    0.2 * (1.0 - charStage * 0.88) * (1.0 - preheat * 0.22) * (1.0 - pyrolysis * 0.3),
    0.015,
    0.22
  );
  let activeBreakup = pyrolysis * smoothstep(0.34, 0.82, pattern * 0.68 + pore * 0.32);
  let warmFiber = mix(vec3<f32>(0.82, 0.76, 0.67), vec3<f32>(1.14, 1.06, 0.9), pattern);
  let endGrainLift = mix(vec3<f32>(1.0), vec3<f32>(1.06, 1.0, 0.9), crossGrainWeight * (1.0 - charStage));
  let charPoreShadow = 1.0 - pore * charStage * 0.26;
  return WoodCharacter(warmFiber * endGrainLift * charPoreShadow, roughness, specular, activeBreakup);
}

fn materialColor(material: NodeMaterial) -> vec3<f32> {
  return semanticBurnAppearance(
    material.thermal,
    vec4<f32>(material.rates.xy, f32(material.identity.z), 0.0)
  ).rgb;
}

fn materialEmissive(material: NodeMaterial) -> f32 {
  return semanticBurnAppearance(
    material.thermal,
    vec4<f32>(material.rates.xy, f32(material.identity.z), 0.0)
  ).a;
}

fn surfaceCell(cellIndex: u32) -> vec3<u32> {
  let cellsX = presentation.topology.x - 1u;
  let cellsY = presentation.topology.y - 1u;
  let cellsPerLayer = cellsX * cellsY;
  let z = cellIndex / cellsPerLayer;
  let remainder = cellIndex - z * cellsPerLayer;
  let y = remainder / cellsX;
  return vec3<u32>(remainder - y * cellsX, y, z);
}

fn cellNodeIndex(cell: vec3<u32>, corner: u32) -> u32 {
  let x = cell.x + (corner & 1u);
  let y = cell.y + ((corner >> 1u) & 1u);
  let z = cell.z + ((corner >> 2u) & 1u);
  return z * presentation.topology.x * presentation.topology.y + y * presentation.topology.x + x;
}

fn surfaceCornerIndex(vertexIndex: u32) -> u32 {
  let corners = array<u32, 36>(
    0u, 4u, 2u, 2u, 4u, 6u,
    1u, 3u, 5u, 5u, 3u, 7u,
    0u, 1u, 4u, 4u, 1u, 5u,
    2u, 6u, 3u, 3u, 6u, 7u,
    0u, 2u, 1u, 1u, 2u, 3u,
    4u, 5u, 6u, 6u, 5u, 7u
  );
  return corners[vertexIndex];
}

fn surfaceFaceIsExterior(cell: vec3<u32>, faceIndex: u32) -> bool {
  let cells = presentation.topology.xyz - vec3<u32>(1u);
  return (faceIndex == 0u && cell.x == 0u) ||
    (faceIndex == 1u && cell.x + 1u == cells.x) ||
    (faceIndex == 2u && cell.y == 0u) ||
    (faceIndex == 3u && cell.y + 1u == cells.y) ||
    (faceIndex == 4u && cell.z == 0u) ||
    (faceIndex == 5u && cell.z + 1u == cells.z);
}

fn surfaceCellIsFractured(cell: vec3<u32>) -> bool {
  let rootLabel = componentLabels[cellNodeIndex(cell, 0u)];
  for (var corner = 1u; corner < 8u; corner = corner + 1u) {
    if (componentLabels[cellNodeIndex(cell, corner)] != rootLabel) { return true; }
  }
  return false;
}

fn surfaceFaceFrame(faceIndex: u32, fractureFace: bool) -> vec4<f32> {
  let axes = array<vec3<f32>, 6>(
    vec3<f32>(-1.0, 0.0, 0.0), vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, -1.0, 0.0), vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, -1.0), vec3<f32>(0.0, 0.0, 1.0)
  );
  return vec4<f32>(axes[faceIndex], select(0.0, 1.0, fractureFace));
}

fn meshMaterial(binding: MeshBinding) -> NodeMaterial {
  let material0 = materials[binding.nodeIndices.x];
  let material1 = materials[binding.nodeIndices.y];
  let material2 = materials[binding.nodeIndices.z];
  let material3 = materials[binding.nodeIndices.w];
  var material = materials[binding.motion.x];
  material.thermal = material0.thermal * binding.nodeWeights.x +
    material1.thermal * binding.nodeWeights.y +
    material2.thermal * binding.nodeWeights.z +
    material3.thermal * binding.nodeWeights.w;
  material.rates = material0.rates * binding.nodeWeights.x +
    material1.rates * binding.nodeWeights.y +
    material2.rates * binding.nodeWeights.z +
    material3.rates * binding.nodeWeights.w;
  return material;
}

@vertex
fn meshSurfaceVertex(@builtin(vertex_index) indexStreamOffset: u32) -> VertexOut {
  let meshVertexIndex = meshIndices[indexStreamOffset];
  let vertex = meshVertices[meshVertexIndex];
  let binding = meshBindings[meshVertexIndex];
  let material = meshMaterial(binding);
  let motion = componentMotions[binding.motion.x].translation.xyz;
  let nodeDisplacement = nodes[binding.motion.x].displacement.xyz;
  let materialPosition = vertex.position.xyz;
  let worldPosition = (materialPosition + motion - vec3<f32>(0.5)) * presentation.style.xyz +
    nodeDisplacement + presentation.world.xyz;
  let surfaceNormal = normalize(vertex.normal.xyz / max(abs(presentation.style.xyz), vec3<f32>(0.0001)));
  var out: VertexOut;
  out.position = presentation.viewProjection * vec4<f32>(worldPosition, 1.0);
  out.color = vec4<f32>(vec3<f32>(1.0), 0.98);
  out.normal = surfaceNormal;
  out.surface = 1.0;
  out.emissive = materialEmissive(material);
  out.thermal = material.thermal;
  out.reaction = vec4<f32>(material.rates.xy, f32(material.identity.z), 0.0);
  out.materialPosition = materialPosition;
  out.faceFrame = vec4<f32>(surfaceNormal, select(0.0, 1.0, abs(surfaceNormal.x) > 0.82));
  return out;
}

@vertex
fn surfaceVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) cellIndex: u32) -> VertexOut {
  let cell = surfaceCell(cellIndex);
  let surfaceCorner = surfaceCornerIndex(vertexIndex);
  let surfaceNodeIndex = cellNodeIndex(cell, surfaceCorner);
  let material = materials[surfaceNodeIndex];
  let surfaceComponent = componentLabels[surfaceNodeIndex];
  let triangleStart = (vertexIndex / 3u) * 3u;
  let triangleNode0 = cellNodeIndex(cell, surfaceCornerIndex(triangleStart));
  let triangleNode1 = cellNodeIndex(cell, surfaceCornerIndex(triangleStart + 1u));
  let triangleNode2 = cellNodeIndex(cell, surfaceCornerIndex(triangleStart + 2u));
  let triangleConnected = surfaceComponent == componentLabels[triangleNode0] &&
    surfaceComponent == componentLabels[triangleNode1] &&
    surfaceComponent == componentLabels[triangleNode2];
  let faceIndex = vertexIndex / 6u;
  let exteriorFace = surfaceFaceIsExterior(cell, faceIndex);
  let fracturedCell = surfaceCellIsFractured(cell);
  let fractureFace = !exteriorFace && fracturedCell;
  let surfaceVisible = triangleConnected &&
    (exteriorFace || fracturedCell);
  let point0 = displayedPosition(triangleNode0);
  let point1 = displayedPosition(triangleNode1);
  let point2 = displayedPosition(triangleNode2);
  let rawNormal = cross(point1 - point0, point2 - point0);
  var surfaceNormal = vec3<f32>(0.0, 0.0, 1.0);
  if (dot(rawNormal, rawNormal) > 0.0000001) { surfaceNormal = normalize(rawNormal); }
  var out: VertexOut;
  out.position = presentation.viewProjection * vec4<f32>(displayedPosition(surfaceNodeIndex), 1.0);
  out.color = vec4<f32>(vec3<f32>(1.0), select(0.0, 0.98, surfaceVisible));
  out.normal = surfaceNormal;
  out.surface = 1.0;
  out.emissive = materialEmissive(material);
  out.thermal = material.thermal;
  out.reaction = vec4<f32>(material.rates.xy, f32(material.identity.z), 0.0);
  out.materialPosition = nodes[surfaceNodeIndex].position.xyz;
  out.faceFrame = surfaceFaceFrame(faceIndex, fractureFace);
  return out;
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
  let bondOpacity = select(0.0, clamp(0.15 + 0.75 * strengthRatio * (1.0 - charMass * 0.35), 0.08, 0.9), alive);
  out.color = vec4<f32>(baseColor * mix(0.42, 1.0, strengthRatio), bondOpacity * 0.2);
  out.normal = vec3<f32>(0.0);
  out.surface = 0.0;
  out.emissive = 0.0;
  out.thermal = material.thermal;
  out.reaction = vec4<f32>(material.rates.xy, f32(material.identity.z), 0.0);
  out.materialPosition = nodes[nodeIndex].position.xyz;
  out.faceFrame = vec4<f32>(0.0);
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
  let billboardOffset = corners[vertexIndex] * 0.0095 * pinnedScale * clip.w;
  clip = vec4<f32>(clip.xy + billboardOffset, clip.z, clip.w);
  var out: VertexOut;
  out.position = clip;
  out.color = vec4<f32>(materialColor(material), 0.32);
  out.normal = vec3<f32>(0.0);
  out.surface = 0.0;
  out.emissive = 0.0;
  out.thermal = material.thermal;
  out.reaction = vec4<f32>(material.rates.xy, f32(material.identity.z), 0.0);
  out.materialPosition = nodes[nodeIndex].position.xyz;
  out.faceFrame = vec4<f32>(0.0);
  return out;
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  if (in.color.a <= 0.001) { discard; }
  if (in.surface > 0.5) {
    let appearance = semanticBurnAppearance(in.thermal, in.reaction);
    let character = woodMaterialCharacter(in.materialPosition, in.faceFrame, in.thermal, in.reaction);
    let normal = normalize(in.normal);
    let keyLight = normalize(vec3<f32>(0.38, 0.82, 0.44));
    let diffuse = max(0.0, dot(normal, keyLight));
    let albedo = appearance.rgb * character.tint * in.color.rgb;
    var litColor = albedo * (0.46 + diffuse * 0.54);
    let sheen = pow(diffuse, mix(18.0, 3.5, character.roughness)) * character.specular;
    litColor += vec3<f32>(1.0, 0.82, 0.58) * sheen;
    let localEmission = appearance.a * mix(0.52, 1.3, character.activeBreakup);
    let emissionColor = appearance.rgb * mix(0.72, 1.12, character.activeBreakup);
    let finalColor = mix(litColor, emissionColor, clamp(localEmission, 0.0, 1.0));
    return vec4<f32>(finalColor, in.color.a);
  }
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
    const columns = positiveInteger(structure.state?.columns, 0);
    const rows = positiveInteger(structure.state?.rows, 0);
    const layers = positiveInteger(structure.state?.layers, 0);
    if (columns * rows * layers !== descriptor.nodeCount || columns < 2 || rows < 2 || layers < 2) {
      throw new Error(`structural combustion solid topology mismatch for ${structure.id}`);
    }
    const meshRequested = structure.presentationMode === 'mesh-skin' || structure.meshSurface != null;
    if (meshRequested && structure.meshSurface == null) {
      throw new Error(`structural combustion mesh surface missing for ${structure.id}`);
    }
    const meshSkin = meshRequested
      ? createStructuralMeshSkinBinding({ mesh: structure.meshSurface, state: structure.state })
      : null;
    const flags = structureFlags(structure);
    return {
      ...structure,
      role: structure.role || (structure.control ? 'control' : 'emitter'),
      flags,
      exposureEnabled: (flags & STRUCTURAL_EXPOSURE_ENABLED) !== 0,
      emissionEnabled: (flags & STRUCTURAL_EMISSION_ENABLED) !== 0,
      motionEnabled: (flags & STRUCTURAL_MOTION_ENABLED) !== 0,
      columns,
      rows,
      layers,
      surfaceCellCount: (columns - 1) * (rows - 1) * (layers - 1),
      meshSkin,
      showStructuralOverlay: structure.showStructuralOverlay === true || !meshSkin,
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
    if (socket.meshSkin) {
      const packedVertices = packStructuralMeshVertices(socket.meshSkin);
      const packedBindings = packStructuralMeshBindings(socket.meshSkin);
      socket.meshVertexBuffer = makeBuffer({
        label: `structural combustion ${socket.id} mesh vertices ${socket.meshSkin.assetIdentity}`,
        size: packedVertices.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      socket.meshBindingBuffer = makeBuffer({
        label: `structural combustion ${socket.id} mesh bindings ${socket.meshSkin.assetIdentity}`,
        size: packedBindings.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      socket.meshIndexBuffer = makeBuffer({
        label: `structural combustion ${socket.id} mesh indices ${socket.meshSkin.assetIdentity}`,
        size: socket.meshSkin.indices.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(socket.meshVertexBuffer, 0, packedVertices);
      device.queue.writeBuffer(socket.meshBindingBuffer, 0, packedBindings);
      device.queue.writeBuffer(socket.meshIndexBuffer, 0, socket.meshSkin.indices);
    }
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

  const {
    computeLayout,
    clearPipeline,
    updatePipeline,
    weakenPipeline,
    motionPipeline,
    emitPipeline,
    finalizePipeline,
    meshPresentationPipeline,
    surfacePresentationPipeline,
    bondPresentationPipeline,
    nodePresentationPipeline,
  } = await constructWithOwnedBufferCleanup(ownedBuffers, async () => {
    const computeShaderSource = structuralCombustionShader(grid);
    const module = device.createShaderModule({
      label: STRUCTURAL_COMBUSTION_AUTHORITY,
      code: computeShaderSource,
    });
    const presentationModule = device.createShaderModule({
      label: 'structural combustion dimensional presentation',
      code: STRUCTURAL_COMBUSTION_PRESENTATION_SHADER,
    });
    await Promise.all([
      assertShaderModuleCompiles(module, STRUCTURAL_COMBUSTION_AUTHORITY, computeShaderSource),
      assertShaderModuleCompiles(
        presentationModule,
        'structural combustion dimensional presentation',
        STRUCTURAL_COMBUSTION_PRESENTATION_SHADER,
      ),
    ]);
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
    const computePipeline = descriptor => createShaderPipeline({
      create: () => device.createComputePipelineAsync(descriptor),
      moduleLabel: STRUCTURAL_COMBUSTION_AUTHORITY,
      entryPoint: descriptor.compute.entryPoint,
      source: computeShaderSource,
    });
    const [clearPipeline, updatePipeline, weakenPipeline, motionPipeline, emitPipeline, finalizePipeline] = await Promise.all([
      computePipeline({ label: 'structural combustion clear source', layout: computePipelineLayout, compute: { module, entryPoint: 'clearSource' } }),
      computePipeline({ label: 'structural combustion update nodes', layout: computePipelineLayout, compute: { module, entryPoint: 'updateNodes' } }),
      computePipeline({ label: 'structural combustion weaken bonds', layout: computePipelineLayout, compute: { module, entryPoint: 'weakenBonds' } }),
      computePipeline({ label: 'structural combustion project component motion', layout: motionPipelineLayout, compute: { module, entryPoint: 'updateComponentMotions' } }),
      computePipeline({ label: 'structural combustion emit carried sources', layout: emissionPipelineLayout, compute: { module, entryPoint: 'emitSources' } }),
      computePipeline({ label: 'structural combustion finalize source', layout: computePipelineLayout, compute: { module, entryPoint: 'finalizeSource' } }),
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
    const meshPresentationLayout = device.createBindGroupLayout({
      label: 'structural combustion mesh presentation layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 8, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 9, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const presentationPipelineLayout = device.createPipelineLayout({
      label: 'structural combustion presentation pipeline layout',
      bindGroupLayouts: [presentationLayout],
    });
    const meshPresentationPipelineLayout = device.createPipelineLayout({
      label: 'structural combustion mesh presentation pipeline layout',
      bindGroupLayouts: [meshPresentationLayout],
    });
    const presentationTargets = [{
      format,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      },
    }];
    const renderPipeline = (
      label,
      entryPoint,
      primitive,
      depthWriteEnabled,
      layout = presentationPipelineLayout,
    ) => createShaderPipeline({
      create: () => device.createRenderPipelineAsync({
        label,
        layout,
        vertex: { module: presentationModule, entryPoint },
        fragment: { module: presentationModule, entryPoint: 'fragmentMain', targets: presentationTargets },
        primitive,
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled,
          depthCompare: depthWriteEnabled ? 'less' : 'less-equal',
        },
      }),
      moduleLabel: 'structural combustion dimensional presentation',
      entryPoint,
      source: STRUCTURAL_COMBUSTION_PRESENTATION_SHADER,
    });
    const [meshPresentationPipeline, surfacePresentationPipeline, bondPresentationPipeline, nodePresentationPipeline] = await Promise.all([
      renderPipeline('structural combustion resident mesh surface', 'meshSurfaceVertex', {
        topology: 'triangle-list',
        cullMode: 'back',
      }, true, meshPresentationPipelineLayout),
      renderPipeline('structural combustion resident solid surface', 'surfaceVertex', {
        topology: 'triangle-list',
        cullMode: 'back',
      }, true),
      renderPipeline('structural combustion resident bonds', 'bondVertex', {
        topology: 'line-list',
        cullMode: 'none',
      }, false),
      renderPipeline('structural combustion resident nodes', 'nodeVertex', {
        topology: 'triangle-list',
        cullMode: 'none',
      }, false),
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
      socket.meshPresentationBindGroups = socket.meshSkin
        ? socket.materialBuffers.map((materialBuffer, index) => device.createBindGroup({
          label: `structural combustion ${socket.id} mesh presentation ${index}`,
          layout: meshPresentationLayout,
          entries: [
            { binding: 0, resource: { buffer: socket.descriptor.nodeBuffer } },
            { binding: 2, resource: { buffer: materialBuffer } },
            { binding: 4, resource: { buffer: socket.presentationBuffer } },
            { binding: 6, resource: { buffer: socket.componentMotionBuffer } },
            { binding: 7, resource: { buffer: socket.meshVertexBuffer } },
            { binding: 8, resource: { buffer: socket.meshBindingBuffer } },
            { binding: 9, resource: { buffer: socket.meshIndexBuffer } },
          ],
        }))
        : null;
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
    return {
      computeLayout,
      clearPipeline,
      updatePipeline,
      weakenPipeline,
      motionPipeline,
      emitPipeline,
      finalizePipeline,
      meshPresentationPipeline,
      surfacePresentationPipeline,
      bondPresentationPipeline,
      nodePresentationPipeline,
    };
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
  let presentationDepthTexture = null;
  let presentationDepthSize = '';

  function presentationDepthView(viewportSize) {
    const width = positiveInteger(viewportSize?.width, 0);
    const height = positiveInteger(viewportSize?.height, 0);
    if (width < 1 || height < 1) {
      throw new Error('GPU structural combustion presentation requires a positive viewport size');
    }
    const key = `${width}x${height}`;
    if (!presentationDepthTexture || presentationDepthSize !== key) {
      presentationDepthTexture?.destroy();
      presentationDepthTexture = device.createTexture({
        label: 'structural combustion solid surface depth',
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      presentationDepthSize = key;
    }
    return presentationDepthTexture.createView();
  }

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

  function encodePresentation(encoder, view, viewProjection, viewportSize) {
    if (destroyed) throw new Error('GPU structural combustion assembly is destroyed');
    if (!encoder?.beginRenderPass || !view) throw new Error('GPU structural combustion presentation requires an encoder and texture view');
    if (!viewProjection || viewProjection.length !== 16 || [...viewProjection].some(value => !Number.isFinite(value))) {
      throw new Error('GPU structural combustion presentation requires a finite view-projection matrix');
    }
    sockets.forEach(socket => {
      const bytes = new ArrayBuffer(PRESENTATION_BYTES);
      const values = new Float32Array(bytes);
      const integers = new Uint32Array(bytes);
      values.set(viewProjection, 0);
      values.set([...(socket.worldOffset || [0, 0, 0]), socket.control ? 1 : 0], 16);
      values.set([...(socket.displayScale || [1.12, 0.68, 0.58]), socket.control ? 1 : 0], 20);
      integers.set([socket.columns, socket.rows, socket.layers, socket.surfaceCellCount], 24);
      device.queue.writeBuffer(socket.presentationBuffer, 0, bytes);
    });
    const pass = encoder.beginRenderPass({
      label: 'structural combustion solid surface and structural overlay',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: {
        view: presentationDepthView(viewportSize),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    sockets.forEach(socket => {
      if (socket.meshSkin) {
        pass.setBindGroup(0, socket.meshPresentationBindGroups[socket.materialIndex]);
        pass.setPipeline(meshPresentationPipeline);
        pass.draw(socket.meshSkin.indexCount);
      } else {
        pass.setBindGroup(0, socket.presentationBindGroups[socket.materialIndex]);
        pass.setPipeline(surfacePresentationPipeline);
        pass.draw(36, socket.surfaceCellCount);
      }
      if (socket.showStructuralOverlay) {
        pass.setBindGroup(0, socket.presentationBindGroups[socket.materialIndex]);
        pass.setPipeline(bondPresentationPipeline);
        pass.draw(2, socket.descriptor.bondCount);
        pass.setPipeline(nodePresentationPipeline);
        pass.draw(6, socket.descriptor.nodeCount);
      }
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
        meshAssetIdentity: socket.meshSkin?.assetIdentity ?? null,
        meshTriangleCount: socket.meshSkin?.triangleCount ?? 0,
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
      surfaceCellCount: sockets.reduce((sum, socket) => sum + socket.surfaceCellCount, 0),
      meshTriangleCount: sockets.reduce((sum, socket) => sum + (socket.meshSkin?.triangleCount ?? 0), 0),
      meshAssetIdentities: sockets.flatMap(socket => socket.meshSkin ? [socket.meshSkin.assetIdentity] : []),
      presentationMode: sockets.some(socket => socket.meshSkin)
        ? 'indexed-mesh-skin-resident-structural-proxy-v0'
        : 'solid-cell-surface-with-structural-overlay-v0',
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
      presentationDepthTexture?.destroy();
      presentationDepthTexture = null;
      ownedBuffers.forEach(buffer => buffer.destroy());
      sockets.forEach(socket => socket.bindGroups.forEach(cache => cache.clear()));
    },
  };
}
