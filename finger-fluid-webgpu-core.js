export const KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE = 'webgpu-pbf-linked-cell-fluid-v0';
export const KAMINOS_FINGER_FLUID_NEIGHBOR_GRID_CONTRACT = 'wgsl-linked-cell-neighbor-grid-v0';
export const KAMINOS_FINGER_FLUID_DENSITY_CONTRACT = 'wgsl-pbf-density-constraint-v0';
export const KAMINOS_FINGER_FLUID_VORTICITY_CONTRACT = 'wgsl-neighbor-vorticity-confinement-v0';
export const KAMINOS_FINGER_FLUID_FREE_SURFACE_CONTRACT = 'wgsl-neighbor-free-surface-cohesion-v0';
export const KAMINOS_FINGER_FLUID_REST_STATE_CONTRACT = 'wgsl-support-aware-persistent-rest-state-v0';
export const KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT = 'wgsl-support-tangential-transport-v0';
export const KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT = 'wgsl-four-neighbor-topology-retention-v0';
export const KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_CONTRACT = 'wgsl-opt-in-support-tangential-particle-shift-v0';
export const KAMINOS_FINGER_FLUID_CHEMISTRY_CONTRACT = 'wgsl-passive-material-tracer-diffusion-v0';
export const KAMINOS_FINGER_FLUID_OBSTACLE_CONTRACT = 'shared-solver-render-obstacle-v0';
export const KAMINOS_FINGER_FLUID_PLAYGROUND_CONTRACT = 'wgsl-shared-multi-regime-toy-playground-v0';
export const KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA = 'kaminos.liquid-interface-carrier.v0';
export const KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE = 'webgpu-particle-sphere-renderer-v0';
export const KAMINOS_FINGER_FLUID_GPU_SHADER_ROUTE = 'wgsl-pbf-linked-cell-fluid-v0';
export const KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE = 'wgsl-fluid-particle-sphere-v0';
export const KAMINOS_FINGER_FLUID_STABILITY_CONTRACT = 'bounded-pbf-energy-v0';

const PARTICLE_FLOATS = 16;
const PARTICLE_BYTES = PARTICLE_FLOATS * 4;
const INTERFACE_RECORD_FLOATS = 20;
const INTERFACE_RECORD_BYTES = INTERFACE_RECORD_FLOATS * 4;
const INTERFACE_SAMPLE_COUNT = 16;
const WORKGROUP_SIZE = 64;
const DEFAULT_PARTICLE_COUNT = 24_576;
const MAX_FLUID_SPEED = 3.2;
const GRID_DIMS = [32, 20, 32];
const GRID_CELL_COUNT = GRID_DIMS[0] * GRID_DIMS[1] * GRID_DIMS[2];
const BOUNDS_MIN = [-3.4, -1.2, -3.4];
const BOUNDS_MAX = [3.4, 3.0, 3.4];
const OBSTACLE_CENTER = [0.85, -0.43, 0.02];
const OBSTACLE_RADIUS = 0.52;
const VORTICITY_UPDATE_INTERVAL = 3;
const PLAYGROUND_TILE_COLUMNS = 22;
const PLAYGROUND_TILE_ROWS = 22;
const PLAYGROUND_TILE_COUNT = PLAYGROUND_TILE_COLUMNS * PLAYGROUND_TILE_ROWS;
const PLAYGROUND_SKIRT_COLUMNS = 22;
const PLAYGROUND_SKIRT_ROWS = 5;
const PLAYGROUND_SKIRT_COUNT = PLAYGROUND_SKIRT_COLUMNS * PLAYGROUND_SKIRT_ROWS;
const PLAYGROUND_OBSTACLE_COUNT = 1;
const INTERFACE_THRESHOLD = 0.32;
const INTERFACE_ENTER_THRESHOLD = 0.38;
const INTERFACE_EXIT_THRESHOLD = 0.22;
const REST_STATE_FLOATS = 4;
const REST_STATE_BYTES = REST_STATE_FLOATS * 4;
const NEIGHBOR_TOPOLOGY_WORDS = 8;
const NEIGHBOR_TOPOLOGY_BYTES = NEIGHBOR_TOPOLOGY_WORDS * 4;
const MATERIAL_TRACER_FLOATS = 4;
const MATERIAL_TRACER_BYTES = MATERIAL_TRACER_FLOATS * 4;
const INVALID_NEIGHBOR_ID = 0xffffffff;

export const KAMINOS_FINGER_FLUID_COLOR_MODES = Object.freeze(['phase', 'particle_id', 'speed', 'density', 'surface', 'neighbor_retention', 'chemistry']);

export function resolveFingerFluidColorMode(value = 'phase') {
  const mode = String(value || 'phase');
  if (!KAMINOS_FINGER_FLUID_COLOR_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid color mode: ${mode}`);
  }
  return mode;
}

export function resolveFingerFluidParticleShiftStrength(value = 0) {
  const strength = Number(value);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError(`Finger fluid particle shift strength must be in [0, 1], received: ${value}`);
  }
  return strength;
}

export function resolveFingerFluidChemistryDiffusion(value = 0) {
  const strength = Number(value);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError(`Finger fluid chemistry diffusion strength must be in [0, 1], received: ${value}`);
  }
  return strength;
}

export function diffusePassiveScalarStep(values, weightedPairs, coefficient, dt) {
  const source = Array.from(values || [], Number);
  const safeCoefficient = resolveFingerFluidChemistryDiffusion(coefficient);
  const safeDt = Number(dt);
  if (!Number.isFinite(safeDt) || safeDt < 0) throw new RangeError(`Passive scalar dt must be finite and non-negative, received: ${dt}`);
  if (safeCoefficient === 0 || safeDt === 0) return { values: source, massDrift: 0 };
  const delta = new Float64Array(source.length);
  for (const pair of weightedPairs || []) {
    const [left, right, weight = 1] = pair;
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || left >= source.length || right >= source.length || left === right) {
      throw new RangeError(`Passive scalar pair is out of range: ${JSON.stringify(pair)}`);
    }
    const safeWeight = Number(weight);
    if (!Number.isFinite(safeWeight) || safeWeight < 0) throw new RangeError(`Passive scalar pair weight must be finite and non-negative: ${JSON.stringify(pair)}`);
    const exchange = safeCoefficient * safeDt * safeWeight * (source[right] - source[left]);
    delta[left] += exchange;
    delta[right] -= exchange;
  }
  const next = source.map((value, index) => value + delta[index]);
  const massBefore = source.reduce((sum, value) => sum + value, 0);
  const massAfter = next.reduce((sum, value) => sum + value, 0);
  return { values: next, massDrift: massAfter - massBefore };
}

export function measureNeighborRetention(previousNeighborIds, currentNeighborIds) {
  const previous = new Set(Array.from(previousNeighborIds || []).filter(id => id !== INVALID_NEIGHBOR_ID));
  const current = Array.from(currentNeighborIds || []).filter(id => id !== INVALID_NEIGHBOR_ID);
  if (current.length === 0) return 0;
  return current.reduce((count, id) => count + (previous.has(id) ? 1 : 0), 0) / current.length;
}

export const KAMINOS_FINGER_FLUID_PLAYGROUND_ZONES = Object.freeze([
  'source_shelf',
  'spillway',
  'shallow_pool',
  'deep_pool',
  'obstacle_channel',
  'catch_basin',
]);

const PLAYGROUND_WGSL = /* wgsl */`
fn toyFloorHeight(p: vec3<f32>) -> f32 {
  let radial = 0.15 * (p.x * p.x + p.z * p.z);
  let sourceShelfWidth = 1.0 - smoothstep(1.55, 2.55, abs(p.x + 0.35));
  let sourceShelf = (1.0 - smoothstep(-1.54, -1.31, p.z)) * 0.94 * sourceShelfWidth;
  let spillway = -0.17 * exp(-p.x * p.x * 2.4) * exp(-(p.z + 0.72) * (p.z + 0.72) * 1.1);
  let shallowPool = -0.15 * exp(-(p.x - 1.42) * (p.x - 1.42) * 2.0 - (p.z - 0.35) * (p.z - 0.35) * 1.7);
  let deepPool = -0.34 * exp(-(p.x + 1.42) * (p.x + 1.42) * 1.8 - (p.z - 0.48) * (p.z - 0.48) * 1.45);
  let catchBasin = -0.27 * exp(-p.x * p.x * 0.62 - (p.z - 2.05) * (p.z - 2.05) * 2.2);
  let leftGate = 0.22 * exp(-(p.x + 0.58) * (p.x + 0.58) * 11.0 - (p.z - 0.48) * (p.z - 0.48) * 4.0);
  let rightGate = 0.22 * exp(-(p.x - 0.58) * (p.x - 0.58) * 11.0 - (p.z - 0.48) * (p.z - 0.48) * 4.0);
  let toyRipple = 0.035 * sin(p.x * 2.25) * cos(p.z * 1.8);
  return -1.02 + radial * 0.22 + sourceShelf + spillway + shallowPool + deepPool + catchBasin + leftGate + rightGate + toyRipple;
}

fn toyFloorNormal(p: vec3<f32>) -> vec3<f32> {
  let epsilon = 0.018;
  let gradientX = (toyFloorHeight(p + vec3<f32>(epsilon, 0.0, 0.0)) - toyFloorHeight(p - vec3<f32>(epsilon, 0.0, 0.0))) / (2.0 * epsilon);
  let gradientZ = (toyFloorHeight(p + vec3<f32>(0.0, 0.0, epsilon)) - toyFloorHeight(p - vec3<f32>(0.0, 0.0, epsilon))) / (2.0 * epsilon);
  return normalize(vec3<f32>(-gradientX, 1.0, -gradientZ));
}
`;

const COMPUTE_SHADER = /* wgsl */`
struct Particle {
  position: vec4<f32>,
  predicted: vec4<f32>,
  velocity: vec4<f32>,
  delta: vec4<f32>,
}

struct NeighborTopologyState {
  neighborIds: vec4<u32>,
  metrics: vec4<f32>,
}

struct MaterialTracerState {
  concentrationDeltaRecipeSource: vec4<f32>,
}

struct InterfaceRecord {
  positionId: vec4<f32>,
  velocityConfidence: vec4<f32>,
  normalCurvature: vec4<f32>,
  thicknessContactWetnessMaterial: vec4<f32>,
  stabilityAgeSource: vec4<f32>,
}

struct Params {
  dt: f32,
  particleCount: u32,
  frameIndex: u32,
  gridCellCount: u32,
  gridDims: vec4<u32>,
  boundsMin: vec4<f32>,
  boundsMax: vec4<f32>,
  fluid: vec4<f32>,
  forces: vec4<f32>,
  particleShift: vec4<f32>,
  chemistry: vec4<f32>,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> cellHeads: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read_write> particleNext: array<i32>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read_write> interfaceRecords: array<InterfaceRecord>;
@group(0) @binding(5) var<storage, read_write> interfaceCounters: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> restStates: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> neighborTopology: array<NeighborTopologyState>;
@group(0) @binding(8) var<storage, read_write> materialTracers: array<MaterialTracerState>;

${PLAYGROUND_WGSL}

fn floorHeight(p: vec3<f32>) -> f32 {
  return toyFloorHeight(p);
}

fn floorNormal(p: vec3<f32>) -> vec3<f32> {
  return toyFloorNormal(p);
}

fn supportPhaseWeights(position: vec3<f32>, velocity: vec3<f32>) -> vec4<f32> {
  let radius = params.fluid.x * 0.22;
  let floorSupportDistance = max(0.0, position.y - (floorHeight(position) + radius));
  let floorSupport = 1.0 - smoothstep(0.012, 0.09, floorSupportDistance);
  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let fromSphere = position - sphereCenter;
  let sphereSupportDistance = abs(length(fromSphere) - (${OBSTACLE_RADIUS} + radius));
  let sphereSupport = 1.0 - smoothstep(0.012, 0.09, sphereSupportDistance);
  let supportContact = max(floorSupport, sphereSupport);
  let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
  let supportNormal = select(sphereNormal, floorNormal(position), floorSupport >= sphereSupport);
  let tangentialVelocity = velocity - supportNormal * dot(velocity, supportNormal);
  let tangentialSpeed = length(tangentialVelocity);
  let speed = length(velocity);
  let supportRestWeight = supportContact * (1.0 - smoothstep(0.06, 0.28, speed));
  let supportTransportWeight = supportContact * smoothstep(0.22, 0.72, tangentialSpeed) * (1.0 - supportRestWeight);
  return vec4<f32>(supportContact, supportRestWeight, supportTransportWeight, tangentialSpeed);
}

fn sourceParticleResetPosition(index: u32) -> vec3<f32> {
  let sourceOrdinal = (index / 20u) * 8u + min(index % 20u, 7u);
  let xIndex = sourceOrdinal % 20u;
  let zIndex = (sourceOrdinal / 20u) % 20u;
  let yIndex = sourceOrdinal / 400u;
  let x = -0.42 + (f32(xIndex) - 9.5) * 0.055;
  let z = -2.06 + (f32(zIndex) - 9.5) * 0.055;
  return vec3<f32>(x, floorHeight(vec3<f32>(x, 0.0, z)) + 0.055 + f32(yIndex) * 0.055, z);
}

fn collideDomain(inputPosition: vec3<f32>) -> vec3<f32> {
  let radius = params.fluid.x * 0.22;
  var p = clamp(inputPosition, params.boundsMin.xyz + vec3<f32>(radius), params.boundsMax.xyz - vec3<f32>(radius));
  let floorY = floorHeight(p) + radius;
  let penetration = floorY - p.y;
  if (penetration > 0.0) {
    let normal = floorNormal(p);
    p = p + normal * (penetration / max(normal.y, 0.15));
  }

  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let sphereRadius = ${OBSTACLE_RADIUS} + radius;
  let fromSphere = p - sphereCenter;
  let sphereDistance = length(fromSphere);
  if (sphereDistance < sphereRadius) {
    p = sphereCenter + normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003)) * sphereRadius;
  }
  return p;
}

fn gridCoord(position: vec3<f32>) -> vec3<i32> {
  let span = max(params.boundsMax.xyz - params.boundsMin.xyz, vec3<f32>(0.001));
  let normalized = clamp((position - params.boundsMin.xyz) / span, vec3<f32>(0.0), vec3<f32>(0.999999));
  return vec3<i32>(normalized * vec3<f32>(params.gridDims.xyz));
}

fn cellIndex(coord: vec3<i32>) -> u32 {
  let bounded = clamp(coord, vec3<i32>(0), vec3<i32>(params.gridDims.xyz) - vec3<i32>(1));
  return u32(bounded.x) + params.gridDims.x * (u32(bounded.y) + params.gridDims.y * u32(bounded.z));
}

fn kernelWeight(distance: f32) -> f32 {
  let q = distance / params.fluid.x;
  if (q >= 1.0) { return 0.0; }
  let x = 1.0 - q * q;
  return x * x * x;
}

fn kernelGradient(offset: vec3<f32>) -> vec3<f32> {
  let distance = length(offset);
  if (distance <= 0.00001 || distance >= params.fluid.x) { return vec3<f32>(0.0); }
  let q = distance / params.fluid.x;
  let magnitude = -6.0 * (1.0 - q) * (1.0 - q) / (params.fluid.x * params.fluid.y);
  return offset / distance * magnitude;
}

fn containsNeighbor(ids: vec4<u32>, candidate: u32) -> bool {
  return candidate != ${INVALID_NEIGHBOR_ID}u && any(ids == vec4<u32>(candidate));
}

fn supportNormalAt(position: vec3<f32>) -> vec3<f32> {
  let radius = params.fluid.x * 0.22;
  let floorDistance = abs(position.y - (floorHeight(position) + radius));
  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let fromSphere = position - sphereCenter;
  let sphereDistance = abs(length(fromSphere) - (${OBSTACLE_RADIUS} + radius));
  let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
  return select(sphereNormal, floorNormal(position), floorDistance <= sphereDistance);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn clear_grid(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < params.gridCellCount) { atomicStore(&cellHeads[gid.x], -1); }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn predict_positions(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  var particle = particles[index];
  if (particle.velocity.w < 0.15 && particle.position.z > -0.15) {
    var state = materialTracers[index];
    let sourceResetDelta = state.concentrationDeltaRecipeSource.z - state.concentrationDeltaRecipeSource.x;
    state.concentrationDeltaRecipeSource.x = state.concentrationDeltaRecipeSource.z;
    state.concentrationDeltaRecipeSource.y = 0.0;
    state.concentrationDeltaRecipeSource.w = state.concentrationDeltaRecipeSource.w + sourceResetDelta;
    materialTracers[index] = state;
    let resetPosition = sourceParticleResetPosition(index);
    particle.position = vec4<f32>(resetPosition, 1.0);
    particle.predicted = vec4<f32>(resetPosition, 0.0);
    particle.velocity = vec4<f32>(0.03, 0.0, 0.18, particle.velocity.w);
    particle.delta = vec4<f32>(0.0);
    particles[index] = particle;
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    atomicAdd(&interfaceCounters[2], 1u);
    return;
  }
  var velocity = particle.velocity.xyz;
  velocity.y = velocity.y + params.forces.x * params.dt;
  particle.velocity = vec4<f32>(velocity, particle.velocity.w);
  particle.predicted = vec4<f32>(collideDomain(particle.position.xyz + velocity * params.dt), 0.0);
  particle.delta = vec4<f32>(0.0);
  particles[index] = particle;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn build_linked_cell_grid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let gridIndex = cellIndex(gridCoord(particles[index].predicted.xyz));
  particleNext[index] = atomicExchange(&cellHeads[gridIndex], i32(index));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn measure_neighbor_topology(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let position = particles[index].predicted.xyz;
  let baseCell = gridCoord(position);
  var nearestIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
  var nearestDistances = vec4<f32>(1e9);

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let distance = length(position - particles[neighborIndex].predicted.xyz);
            if (distance < params.fluid.x) {
              if (distance < nearestDistances.x) {
                nearestDistances = vec4<f32>(distance, nearestDistances.xyz);
                nearestIds = vec4<u32>(neighborIndex, nearestIds.xyz);
              } else if (distance < nearestDistances.y) {
                nearestDistances = vec4<f32>(nearestDistances.x, distance, nearestDistances.yz);
                nearestIds = vec4<u32>(nearestIds.x, neighborIndex, nearestIds.yz);
              } else if (distance < nearestDistances.z) {
                nearestDistances = vec4<f32>(nearestDistances.xy, distance, nearestDistances.z);
                nearestIds = vec4<u32>(nearestIds.xy, neighborIndex, nearestIds.z);
              } else if (distance < nearestDistances.w) {
                nearestDistances.w = distance;
                nearestIds.w = neighborIndex;
              }
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }

  let prior = neighborTopology[index];
  var validNeighborCount = 0u;
  var retainedNeighborCount = 0u;
  for (var slot = 0u; slot < 4u; slot = slot + 1u) {
    let neighborId = nearestIds[slot];
    if (neighborId != ${INVALID_NEIGHBOR_ID}u) {
      validNeighborCount = validNeighborCount + 1u;
      retainedNeighborCount = retainedNeighborCount + select(0u, 1u, containsNeighbor(prior.neighborIds, neighborId));
    }
  }
  let retention = f32(retainedNeighborCount) / max(1.0, f32(validNeighborCount));
  let retentionAge = select(0.0, prior.metrics.y + params.dt, retention >= 0.75 && validNeighborCount >= 3u);
  let speed = length(particles[index].velocity.xyz);
  let movingLocked = select(0.0, 1.0, retentionAge >= 0.5 && speed >= 0.35);
  neighborTopology[index].neighborIds = nearestIds;
  neighborTopology[index].metrics = vec4<f32>(retention, retentionAge, f32(validNeighborCount), movingLocked);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compute_material_tracer_diffusion(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let position = particles[index].predicted.xyz;
  let baseCell = gridCoord(position);
  let concentration = materialTracers[index].concentrationDeltaRecipeSource.x;
  var concentrationDelta = 0.0;

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let distance = length(position - particles[neighborIndex].predicted.xyz);
            let chemistryWeight = kernelWeight(distance);
            if (chemistryWeight > 0.0) {
              let neighborConcentration = materialTracers[neighborIndex].concentrationDeltaRecipeSource.x;
              let neighborDelta = chemistryWeight * (neighborConcentration - concentration);
              concentrationDelta = concentrationDelta + neighborDelta;
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }
  materialTracers[index].concentrationDeltaRecipeSource.y = params.chemistry.x * params.dt * concentrationDelta;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_material_tracer_diffusion(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  var state = materialTracers[index];
  state.concentrationDeltaRecipeSource.x = state.concentrationDeltaRecipeSource.x + state.concentrationDeltaRecipeSource.y;
  state.concentrationDeltaRecipeSource.y = 0.0;
  materialTracers[index] = state;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compute_density_lambda(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let position = particles[index].predicted.xyz;
  let baseCell = gridCoord(position);
  var density = 1.0;
  var gradientSelf = vec3<f32>(0.0);
  var gradientSquared = 0.0;

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = position - particles[neighborIndex].predicted.xyz;
            let distance = length(offset);
            let weight = kernelWeight(distance);
            density = density + weight;
            let gradient = kernelGradient(offset);
            gradientSelf = gradientSelf + gradient;
            gradientSquared = gradientSquared + dot(gradient, gradient);
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }

  let constraint = density / params.fluid.y - 1.0;
  let lambda = -constraint / (gradientSquared + dot(gradientSelf, gradientSelf) + params.fluid.z);
  particles[index].predicted.w = clamp(lambda, -0.18, 0.12);
  particles[index].delta.w = density;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn solve_position_delta(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let position = particles[index].predicted.xyz;
  let baseCell = gridCoord(position);
  let lambda = particles[index].predicted.w;
  let referenceWeight = max(kernelWeight(params.fluid.x * 0.34), 0.0001);
  var correction = vec3<f32>(0.0);

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = position - particles[neighborIndex].predicted.xyz;
            let weight = kernelWeight(length(offset));
            let tensile = -0.0012 * pow(weight / referenceWeight, 4.0);
            correction = correction + (lambda + particles[neighborIndex].predicted.w + tensile) * kernelGradient(offset);
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }
  let scaled = correction * params.fluid.w;
  let correctionLength = length(scaled);
  particles[index].delta = vec4<f32>(select(scaled, scaled * (0.008 / correctionLength), correctionLength > 0.008), particles[index].delta.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_position_delta(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  particles[index].predicted = vec4<f32>(collideDomain(particles[index].predicted.xyz + particles[index].delta.xyz), particles[index].predicted.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn classify_free_surface(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.predicted.xyz;
  let baseCell = gridCoord(position);
  var supportWeight = 0.0;
  var directionalSupport = vec3<f32>(0.0);

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = position - particles[neighborIndex].predicted.xyz;
            let distance = length(offset);
            let weight = kernelWeight(distance);
            if (distance > 0.00001 && weight > 0.0) {
              supportWeight = supportWeight + weight;
              directionalSupport = directionalSupport + (offset / distance) * weight;
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }

  let supportAnisotropy = length(directionalSupport) / max(supportWeight, 0.0001);
  let densityRatio = particle.delta.w / max(params.fluid.y, 0.0001);
  let densityDeficit = 1.0 - smoothstep(0.72, 0.98, densityRatio);
  let anisotropicSurface = smoothstep(0.14, 0.46, supportAnisotropy);
  let rawSurfaceFactor = clamp(max(anisotropicSurface, densityDeficit * 0.55), 0.0, 1.0);
  let priorRestState = restStates[index];
  let wasInterface = priorRestState.x >= ${INTERFACE_THRESHOLD};
  let enterInterface = rawSurfaceFactor >= ${INTERFACE_ENTER_THRESHOLD};
  let retainInterface = wasInterface && rawSurfaceFactor >= ${INTERFACE_EXIT_THRESHOLD};
  let isInterface = enterInterface || retainInterface;
  let smoothedSurface = max(${INTERFACE_THRESHOLD}, mix(priorRestState.x, rawSurfaceFactor, 0.34));
  let surfaceFactor = select(0.0, smoothedSurface, isInterface);
  let interfaceAge = select(0.0, priorRestState.y + params.dt, isInterface);
  var transition = 0.0;
  transition = select(transition, 1.0, isInterface && !wasInterface);
  transition = select(transition, -1.0, !isInterface && wasInterface);
  restStates[index] = vec4<f32>(surfaceFactor, interfaceAge, priorRestState.z, transition);
  particles[index].predicted = vec4<f32>(position, surfaceFactor);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compute_velocity_viscosity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.predicted.xyz;
  let baseCell = gridCoord(position);
  var velocity = (position - particle.position.xyz) / max(params.dt, 0.00001);
  var neighborVelocity = vec3<f32>(0.0);
  var neighborWeight = 0.0;

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let weight = kernelWeight(length(position - particles[neighborIndex].predicted.xyz));
            neighborVelocity = neighborVelocity + particles[neighborIndex].velocity.xyz * weight;
            neighborWeight = neighborWeight + weight;
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }
  let supportPhase = supportPhaseWeights(position, velocity);
  let supportRestWeight = supportPhase.y;
  let supportTransportWeight = supportPhase.z;
  let transportViscosityScale = 1.0 - supportTransportWeight * 0.68;
  let restViscosityBlend = clamp(params.forces.z * transportViscosityScale + supportRestWeight * 0.16, 0.0, 0.24);
  if (neighborWeight > 0.0001) {
    velocity = mix(velocity, neighborVelocity / neighborWeight, restViscosityBlend);
  }
  velocity = velocity * params.forces.y;
  restStates[index].z = supportRestWeight;
  let radius = params.fluid.x * 0.22;
  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  if (position.y <= floorHeight(position) + radius + 0.01) {
    let normal = floorNormal(position);
    let normalSpeed = dot(velocity, normal);
    if (normalSpeed < 0.0) { velocity = velocity - normal * normalSpeed; }
  }
  let fromSphere = position - sphereCenter;
  let sphereDistance = length(fromSphere);
  if (sphereDistance <= ${OBSTACLE_RADIUS} + radius + 0.01) {
    let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
    let sphereNormalSpeed = dot(velocity, sphereNormal);
    if (sphereNormalSpeed < 0.0) { velocity = velocity - sphereNormal * sphereNormalSpeed; }
  }
  if (position.x <= params.boundsMin.x + radius + 0.006 && velocity.x < 0.0) { velocity.x = 0.0; }
  if (position.x >= params.boundsMax.x - radius - 0.006 && velocity.x > 0.0) { velocity.x = 0.0; }
  if (position.z <= params.boundsMin.z + radius + 0.006 && velocity.z < 0.0) { velocity.z = 0.0; }
  if (position.z >= params.boundsMax.z - radius - 0.006 && velocity.z > 0.0) { velocity.z = 0.0; }
  let relaxedSpeed = length(velocity);
  if (relaxedSpeed > ${MAX_FLUID_SPEED}) { velocity = velocity * (${MAX_FLUID_SPEED} / relaxedSpeed); }
  particles[index].delta = vec4<f32>(velocity, particle.delta.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compute_vorticity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.predicted.xyz;
  let velocity = particle.delta.xyz;
  let baseCell = gridCoord(position);
  var omega = vec3<f32>(0.0);

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = position - particles[neighborIndex].predicted.xyz;
            let velocityDifference = particles[neighborIndex].delta.xyz - velocity;
            omega = omega + cross(velocityDifference, kernelGradient(offset));
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }
  particles[index].velocity = vec4<f32>(omega, particle.velocity.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_vorticity_confinement(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.predicted.xyz;
  let omega = particle.velocity.xyz;
  let omegaMagnitude = length(omega);
  let baseCell = gridCoord(position);
  var magnitudeGradient = vec3<f32>(0.0);

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = position - particles[neighborIndex].predicted.xyz;
            let neighborMagnitude = length(particles[neighborIndex].velocity.xyz);
            magnitudeGradient = magnitudeGradient + (neighborMagnitude - omegaMagnitude) * kernelGradient(offset);
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }

  let gradientLength = length(magnitudeGradient);
  let confinementNormal = magnitudeGradient / max(gradientLength, 0.00001);
  let confinementActivity = 1.0 - restStates[index].z * 0.92;
  var confinement = cross(confinementNormal, omega) * params.forces.w * confinementActivity;
  let confinementLength = length(confinement);
  if (confinementLength > 1.25) { confinement = confinement * (1.25 / confinementLength); }
  var velocity = particle.delta.xyz + confinement * params.dt;
  let speed = length(velocity);
  if (speed > ${MAX_FLUID_SPEED}) { velocity = velocity * (${MAX_FLUID_SPEED} / speed); }
  particles[index].delta = vec4<f32>(velocity, particle.delta.w);
  particles[index].position.w = min(omegaMagnitude, 4096.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_surface_cohesion(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.predicted.xyz;
  let surfaceFactor = particle.predicted.w;
  let baseCell = gridCoord(position);
  var attraction = vec3<f32>(0.0);
  var attractionWeight = 0.0;

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = particles[neighborIndex].predicted.xyz - position;
            let distance = length(offset);
            if (distance > 0.00001 && distance < params.fluid.x) {
              let q = distance / params.fluid.x;
              let cohesionBand = smoothstep(0.28, 0.58, q) * (1.0 - smoothstep(0.82, 1.0, q));
              let neighborSurface = particles[neighborIndex].predicted.w;
              let weight = cohesionBand * (0.30 + 0.70 * neighborSurface);
              attraction = attraction + (offset / distance) * weight;
              attractionWeight = attractionWeight + weight;
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }

  let supportTransportWeight = supportPhaseWeights(position, particle.delta.xyz).z;
  let cohesionActivity = (1.0 - restStates[index].z * 0.72) * (1.0 - supportTransportWeight * 0.62);
  var cohesionAcceleration = attraction / max(attractionWeight, 0.0001) * surfaceFactor * 0.72 * cohesionActivity;
  let cohesionLength = length(cohesionAcceleration);
  if (cohesionLength > 0.58) { cohesionAcceleration = cohesionAcceleration * (0.58 / cohesionLength); }
  var velocity = particle.delta.xyz + cohesionAcceleration * params.dt;
  let radius = params.fluid.x * 0.22;
  if (position.y <= floorHeight(position) + radius + 0.01) {
    let normal = floorNormal(position);
    let normalSpeed = dot(velocity, normal);
    if (normalSpeed < 0.0) { velocity = velocity - normal * normalSpeed; }
  }
  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let fromSphere = position - sphereCenter;
  if (length(fromSphere) <= ${OBSTACLE_RADIUS} + radius + 0.01) {
    let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
    let sphereNormalSpeed = dot(velocity, sphereNormal);
    if (sphereNormalSpeed < 0.0) { velocity = velocity - sphereNormal * sphereNormalSpeed; }
  }
  let speed = length(velocity);
  if (speed > ${MAX_FLUID_SPEED}) { velocity = velocity * (${MAX_FLUID_SPEED} / speed); }
  particles[index].delta = vec4<f32>(velocity, particle.delta.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_velocity_position(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  particles[index].velocity = vec4<f32>(particles[index].delta.xyz, particles[index].velocity.w);
  particles[index].position = vec4<f32>(particles[index].predicted.xyz, particles[index].position.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compute_support_particle_shift(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.position.xyz;
  let supportContact = supportPhaseWeights(position, particle.velocity.xyz).x;
  let topologyLock = smoothstep(0.2, 0.9, neighborTopology[index].metrics.y) * smoothstep(0.55, 0.85, neighborTopology[index].metrics.x);
  if (params.particleShift.x <= 0.0 || supportContact <= 0.01 || topologyLock <= 0.001) {
    particles[index].delta = vec4<f32>(0.0, 0.0, 0.0, particle.delta.w);
    return;
  }
  let baseCell = gridCoord(position);
  var crowdingDirection = vec3<f32>(0.0);
  var crowdingWeight = 0.0;
  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = position - particles[neighborIndex].position.xyz;
            let distance = length(offset);
            let weight = kernelWeight(distance);
            if (distance > 0.00001 && weight > 0.0) {
              crowdingDirection = crowdingDirection + offset / distance * weight;
              crowdingWeight = crowdingWeight + weight;
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }
  let normal = supportNormalAt(position);
  let tangentCrowding = crowdingDirection - normal * dot(crowdingDirection, normal);
  let angle = f32(index % 4093u) * 2.3999632 + f32(params.frameIndex % 997u) * 2.176;
  let seedDirection = vec3<f32>(cos(angle), 0.31 * sin(angle * 0.73), sin(angle));
  let seedTangent = seedDirection - normal * dot(seedDirection, normal);
  let crowdingLength = length(tangentCrowding);
  let crowdingUnit = select(vec3<f32>(0.0), tangentCrowding / crowdingLength, crowdingLength > 0.00001);
  let blendedDirection = normalize(seedTangent + vec3<f32>(0.00001)) + crowdingUnit * min(0.18, crowdingWeight * 0.01);
  let directionLength = length(blendedDirection);
  let shiftMagnitude = 0.0045 * params.particleShift.x * supportContact * topologyLock;
  let shift = select(vec3<f32>(0.0), blendedDirection / directionLength * shiftMagnitude, directionLength > 0.00001);
  particles[index].delta = vec4<f32>(shift, particle.delta.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_support_particle_shift(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  var particle = particles[index];
  let shiftedPosition = collideDomain(particle.position.xyz + particle.delta.xyz);
  particle.position = vec4<f32>(shiftedPosition, particle.position.w);
  particle.predicted = vec4<f32>(shiftedPosition, particle.predicted.w);
  particle.delta = vec4<f32>(particle.velocity.xyz, particle.delta.w);
  particles[index] = particle;
}

@compute @workgroup_size(1)
fn clear_interface_counters(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x == 0u) {
    atomicStore(&interfaceCounters[0], 0u);
    atomicStore(&interfaceCounters[1], 0u);
  }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compact_interface_records(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.position.xyz;
  let surfaceFactor = particle.predicted.w;
  let baseCell = gridCoord(position);
  var supportWeight = 0.0;
  var directionalSupport = vec3<f32>(0.0);

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index) {
            let offset = position - particles[neighborIndex].position.xyz;
            let distance = length(offset);
            let weight = kernelWeight(distance);
            if (distance > 0.00001 && weight > 0.0) {
              supportWeight = supportWeight + weight;
              directionalSupport = directionalSupport + offset / distance * weight;
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }

  let radius = params.fluid.x * 0.22;
  let floorContact = select(0.0, 1.0, position.y <= floorHeight(position) + radius + 0.035);
  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let sphereContact = select(0.0, 1.0, abs(length(position - sphereCenter) - (${OBSTACLE_RADIUS} + radius)) < 0.045);
  let contact = max(floorContact, sphereContact);
  let anisotropy = length(directionalSupport) / max(supportWeight, 0.0001);
  let fallbackNormal = select(vec3<f32>(0.0, 1.0, 0.0), floorNormal(position), floorContact > 0.5);
  let sphereSupportNormal = normalize(position - sphereCenter + vec3<f32>(0.00001, 0.00002, 0.00003));
  let contactSupportNormal = select(sphereSupportNormal, floorNormal(position), floorContact > 0.5);
  var interfaceNormal = select(fallbackNormal, normalize(directionalSupport), length(directionalSupport) > 0.0001);
  if (contact > 0.5 && dot(interfaceNormal, contactSupportNormal) < 0.0) {
    interfaceNormal = -interfaceNormal;
  }
  let supportAlignment = select(1.0, dot(interfaceNormal, contactSupportNormal), contact > 0.5);
  let interfaceAge = restStates[index].y;
  if (surfaceFactor < ${INTERFACE_THRESHOLD}) { return; }

  let slot = atomicAdd(&interfaceCounters[0], 1u);
  if (slot >= params.particleCount) {
    atomicAdd(&interfaceCounters[1], 1u);
    return;
  }
  let speed = length(particle.velocity.xyz);
  let thickness = params.fluid.x * clamp(supportWeight / max(params.fluid.y, 0.0001), 0.18, 2.5);
  interfaceRecords[slot].positionId = vec4<f32>(position, f32(index));
  interfaceRecords[slot].velocityConfidence = vec4<f32>(particle.velocity.xyz, surfaceFactor);
  interfaceRecords[slot].normalCurvature = vec4<f32>(interfaceNormal, anisotropy);
  interfaceRecords[slot].thicknessContactWetnessMaterial = vec4<f32>(thickness, contact, surfaceFactor, particle.velocity.w);
  interfaceRecords[slot].stabilityAgeSource = vec4<f32>(1.0 - clamp(speed / ${MAX_FLUID_SPEED}, 0.0, 1.0), interfaceAge, f32(params.frameIndex), supportAlignment);
}
`;

const RENDER_SHADER = /* wgsl */`
struct Particle {
  position: vec4<f32>,
  predicted: vec4<f32>,
  velocity: vec4<f32>,
  delta: vec4<f32>,
}

struct NeighborTopologyState {
  neighborIds: vec4<u32>,
  metrics: vec4<f32>,
}

struct MaterialTracerState {
  concentrationDeltaRecipeSource: vec4<f32>,
}

struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  viewport: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(2) var<storage, read> neighborTopology: array<NeighborTopologyState>;
@group(0) @binding(3) var<storage, read> materialTracers: array<MaterialTracerState>;

${PLAYGROUND_WGSL}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) speed: f32,
  @location(3) supportKind: f32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let corner = quad[vertexIndex];
  let particleCount = u32(params.viewport.w);
  let supportIndex = instanceIndex - min(instanceIndex, particleCount);
  let isFluid = instanceIndex < particleCount;
  let isTerrain = !isFluid && supportIndex < ${PLAYGROUND_TILE_COUNT + PLAYGROUND_SKIRT_COUNT}u;
  let isSkirt = isTerrain && supportIndex >= ${PLAYGROUND_TILE_COUNT}u;
  let isObstacle = !isFluid && !isTerrain;
  var center = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  var radius = ${OBSTACLE_RADIUS};
  var speed = 0.0;
  var phase = 0.0;
  let cold = vec3<f32>(0.055, 0.54, 0.78);
  let warm = vec3<f32>(0.18, 0.94, 0.71);
  let crest = vec3<f32>(0.80, 0.57, 1.0);
  var base = vec3<f32>(0.19, 0.23, 0.25);
  if (isFluid) {
    let particle = particles[instanceIndex];
    let colorMode = u32(params.cameraRight.w + 0.5);
    center = particle.position.xyz;
    speed = length(particle.velocity.xyz);
    radius = params.viewport.z * (0.88 + clamp(particle.delta.w / 16.0, 0.0, 0.42));
    phase = particle.velocity.w;
    base = mix(cold, warm, smoothstep(0.0, 0.62, phase));
    if (colorMode == 1u) {
      let hash = fract(sin(f32(instanceIndex) * 12.9898) * 43758.5453);
      base = 0.42 + 0.48 * cos(vec3<f32>(0.0, 2.094, 4.188) + hash * 6.28318);
      phase = 0.0;
    } else if (colorMode == 2u) {
      let value = clamp(speed / ${MAX_FLUID_SPEED}, 0.0, 1.0);
      base = mix(vec3<f32>(0.02, 0.10, 0.34), vec3<f32>(1.0, 0.25, 0.04), value);
      phase = 0.0;
    } else if (colorMode == 3u) {
      let value = clamp(particle.delta.w / 24.3, 0.45, 1.45);
      base = mix(vec3<f32>(0.30, 0.04, 0.62), vec3<f32>(0.96, 0.88, 0.12), (value - 0.45) / 1.0);
      phase = 0.0;
    } else if (colorMode == 4u) {
      base = mix(vec3<f32>(0.04, 0.16, 0.32), vec3<f32>(0.97, 0.28, 0.78), particle.predicted.w);
      phase = 0.0;
    } else if (colorMode == 5u) {
      let retention = neighborTopology[instanceIndex].metrics.x;
      base = mix(vec3<f32>(0.03, 0.12, 0.62), vec3<f32>(1.0, 0.12, 0.04), retention);
      phase = 0.0;
    } else if (colorMode == 6u) {
      let concentration = materialTracers[instanceIndex].concentrationDeltaRecipeSource.x;
      base = 0.52 + 0.46 * cos(vec3<f32>(0.0, 2.094, 4.188) + concentration * 6.28318);
      phase = 0.0;
    }
  } else if (isTerrain && !isSkirt) {
    let tileX = supportIndex % ${PLAYGROUND_TILE_COLUMNS}u;
    let tileZ = supportIndex / ${PLAYGROUND_TILE_COLUMNS}u;
    let x = mix(${BOUNDS_MIN[0]}, ${BOUNDS_MAX[0]}, (f32(tileX) + 0.5) / f32(${PLAYGROUND_TILE_COLUMNS}));
    let z = mix(${BOUNDS_MIN[2]}, ${BOUNDS_MAX[2]}, (f32(tileZ) + 0.5) / f32(${PLAYGROUND_TILE_ROWS}));
    center = vec3<f32>(x, toyFloorHeight(vec3<f32>(x, 0.0, z)) - 0.035, z);
    radius = 0.205;
    phase = clamp((center.y + 1.25) * 0.42, 0.0, 1.0);
    base = mix(vec3<f32>(0.18, 0.24, 0.21), vec3<f32>(0.45, 0.52, 0.27), phase);
  } else if (isSkirt) {
    let skirtIndex = supportIndex - ${PLAYGROUND_TILE_COUNT}u;
    let skirtX = skirtIndex % ${PLAYGROUND_SKIRT_COLUMNS}u;
    let skirtY = skirtIndex / ${PLAYGROUND_SKIRT_COLUMNS}u;
    let x = mix(-2.55, 1.75, (f32(skirtX) + 0.5) / f32(${PLAYGROUND_SKIRT_COLUMNS}));
    let lowY = toyFloorHeight(vec3<f32>(x, 0.0, -1.22));
    let highY = toyFloorHeight(vec3<f32>(x, 0.0, -1.66));
    center = vec3<f32>(x, mix(lowY, highY, (f32(skirtY) + 0.5) / f32(${PLAYGROUND_SKIRT_ROWS})), -1.43);
    radius = 0.14;
    phase = clamp((center.y + 1.25) * 0.42, 0.0, 1.0);
    base = mix(vec3<f32>(0.16, 0.22, 0.20), vec3<f32>(0.50, 0.55, 0.25), phase);
  }
  let worldPosition = center + params.cameraRight.xyz * corner.x * radius + params.cameraUp.xyz * corner.y * radius;
  var output: VertexOutput;
  output.position = params.viewProjection * vec4<f32>(worldPosition, 1.0);
  output.uv = corner;
  output.color = mix(base, crest, smoothstep(0.68, 1.0, phase) * 0.72);
  output.speed = speed;
  output.supportKind = select(select(0.0, 1.0, isTerrain), 2.0, isObstacle);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let radiusSquared = dot(input.uv, input.uv);
  if (radiusSquared > 1.0) { discard; }
  let normal = normalize(vec3<f32>(input.uv.x, -input.uv.y, sqrt(max(0.0, 1.0 - radiusSquared))));
  let light = normalize(vec3<f32>(-0.42, 0.70, 0.58));
  let diffuse = max(dot(normal, light), 0.0);
  let rim = pow(1.0 - normal.z, 2.2);
  let specular = pow(max(dot(reflect(-light, normal), vec3<f32>(0.0, 0.0, 1.0)), 0.0), 34.0);
  let speedGlow = smoothstep(0.7, 4.0, input.speed);
  let fluidColor = input.color * (0.28 + diffuse * 0.86) + vec3<f32>(0.36, 0.72, 0.90) * rim * 0.24 + vec3<f32>(1.0) * specular * 0.72 + speedGlow * vec3<f32>(0.12, 0.18, 0.24);
  let terrainColor = input.color * (0.30 + diffuse * 0.70) + vec3<f32>(0.42, 0.34, 0.16) * rim * 0.18 + vec3<f32>(1.0) * specular * 0.12;
  let obstacleColor = input.color * (0.30 + diffuse * 0.64) + vec3<f32>(0.82, 0.61, 0.24) * rim * 0.38 + vec3<f32>(1.0) * specular * 0.32;
  let supportColor = select(terrainColor, obstacleColor, input.supportKind > 1.5);
  let color = select(fluidColor, supportColor, input.supportKind > 0.5);
  let edgeAlpha = smoothstep(1.0, 0.70, radiusSquared);
  let alpha = select(0.90, select(0.72, 0.86, input.supportKind > 1.5), input.supportKind > 0.5);
  return vec4<f32>(color, alpha * edgeAlpha);
}
`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize3(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function perspectiveMatrix(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * range, -1,
    0, 0, near * far * range, 0,
  ]);
}

function lookAtMatrix(eye, target, up) {
  const z = normalize3(subtract3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

function multiplyMatrices(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0]
        + a[1 * 4 + row] * b[column * 4 + 1]
        + a[2 * 4 + row] * b[column * 4 + 2]
        + a[3 * 4 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

export function sampleFingerFluidPlaygroundHeight(x, z) {
  const radial = 0.15 * (x * x + z * z);
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const sourceShelfWidth = 1 - smoothstep(1.55, 2.55, Math.abs(x + 0.35));
  const sourceShelf = (1 - smoothstep(-1.54, -1.31, z)) * 0.94 * sourceShelfWidth;
  const spillway = -0.17 * Math.exp(-x * x * 2.4) * Math.exp(-((z + 0.72) ** 2) * 1.1);
  const shallowPool = -0.15 * Math.exp(-((x - 1.42) ** 2) * 2 - ((z - 0.35) ** 2) * 1.7);
  const deepPool = -0.34 * Math.exp(-((x + 1.42) ** 2) * 1.8 - ((z - 0.48) ** 2) * 1.45);
  const catchBasin = -0.27 * Math.exp(-x * x * 0.62 - ((z - 2.05) ** 2) * 2.2);
  const leftGate = 0.22 * Math.exp(-((x + 0.58) ** 2) * 11 - ((z - 0.48) ** 2) * 4);
  const rightGate = 0.22 * Math.exp(-((x - 0.58) ** 2) * 11 - ((z - 0.48) ** 2) * 4);
  const toyRipple = 0.035 * Math.sin(x * 2.25) * Math.cos(z * 1.8);
  return -1.02 + radial * 0.22 + sourceShelf + spillway + shallowPool + deepPool + catchBasin + leftGate + rightGate + toyRipple;
}

function smoothstepNumber(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function measureSupportTransport(position, velocity, radius = 0.185 * 0.22) {
  const [x, y, z] = position;
  const floorY = sampleFingerFluidPlaygroundHeight(x, z) + radius;
  const floorSupportDistance = Math.max(0, y - floorY);
  const floorSupport = 1 - smoothstepNumber(0.012, 0.09, floorSupportDistance);
  const fromSphere = [x - OBSTACLE_CENTER[0], y - OBSTACLE_CENTER[1], z - OBSTACLE_CENTER[2]];
  const sphereDistance = Math.hypot(...fromSphere);
  const sphereSupportDistance = Math.abs(sphereDistance - (OBSTACLE_RADIUS + radius));
  const sphereSupport = 1 - smoothstepNumber(0.012, 0.09, sphereSupportDistance);
  const supportContact = Math.max(floorSupport, sphereSupport);
  const epsilon = 0.018;
  const floorNormal = normalize3([
    -(sampleFingerFluidPlaygroundHeight(x + epsilon, z) - sampleFingerFluidPlaygroundHeight(x - epsilon, z)) / (2 * epsilon),
    1,
    -(sampleFingerFluidPlaygroundHeight(x, z + epsilon) - sampleFingerFluidPlaygroundHeight(x, z - epsilon)) / (2 * epsilon),
  ]);
  const sphereNormal = normalize3(fromSphere);
  const supportNormal = floorSupport >= sphereSupport ? floorNormal : sphereNormal;
  const normalSpeed = velocity[0] * supportNormal[0] + velocity[1] * supportNormal[1] + velocity[2] * supportNormal[2];
  const tangentialVelocity = velocity.map((component, axis) => component - supportNormal[axis] * normalSpeed);
  const tangentialSpeed = Math.hypot(...tangentialVelocity);
  const speed = Math.hypot(...velocity);
  const supportRestWeight = supportContact * (1 - smoothstepNumber(0.06, 0.28, speed));
  const supportTransportWeight = supportContact * smoothstepNumber(0.22, 0.72, tangentialSpeed) * (1 - supportRestWeight);
  return { supportContact, tangentialSpeed, supportRestWeight, supportTransportWeight };
}

function playgroundZoneAt(x, z) {
  if (z < -1.35) return 'source_shelf';
  if (z < -0.34) return 'spillway';
  if (z >= 1.3) return 'catch_basin';
  if (x < -0.62) return 'deep_pool';
  if (x > 0.62) return 'shallow_pool';
  return 'obstacle_channel';
}

function playgroundZoneDiagnostics(values, restStateValues, topologyValues, particleCount) {
  const zones = Object.fromEntries(KAMINOS_FINGER_FLUID_PLAYGROUND_ZONES.map(name => [name, {
    name,
    particleCount: 0,
    surfaceParticleCount: 0,
    persistentInterfaceParticleCount: 0,
    supportedRestingParticleCount: 0,
    activeTransportParticleCount: 0,
    supportedTransportParticleCount: 0,
    interfaceTransitionCount: 0,
    kineticEnergy: 0,
    supportRestWeightSum: 0,
    interfaceAgeSum: 0,
    supportedTangentialSpeedSum: 0,
    neighborRetentionSum: 0,
    neighborRetentionAgeSum: 0,
    movingLockedParticleCount: 0,
  }]));
  for (let index = 0; index < particleCount; index += 1) {
    const offset = index * PARTICLE_FLOATS;
    const restOffset = index * REST_STATE_FLOATS;
    const topologyOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 4;
    const zone = zones[playgroundZoneAt(values[offset], values[offset + 2])];
    const speedSquared = values[offset + 8] ** 2 + values[offset + 9] ** 2 + values[offset + 10] ** 2;
    const speed = Math.sqrt(speedSquared);
    const supportRestWeight = restStateValues[restOffset + 2];
    const supportTransport = measureSupportTransport(
      [values[offset], values[offset + 1], values[offset + 2]],
      [values[offset + 8], values[offset + 9], values[offset + 10]],
    );
    zone.particleCount += 1;
    zone.kineticEnergy += 0.5 * speedSquared;
    zone.supportRestWeightSum += supportRestWeight;
    zone.neighborRetentionSum += topologyValues[topologyOffset];
    zone.neighborRetentionAgeSum += topologyValues[topologyOffset + 1];
    if (topologyValues[topologyOffset + 3] >= 0.5) zone.movingLockedParticleCount += 1;
    if (values[offset + 7] >= 0.5) zone.surfaceParticleCount += 1;
    if (supportRestWeight >= 0.5) zone.supportedRestingParticleCount += 1;
    if (speed >= 0.35) zone.activeTransportParticleCount += 1;
    if (supportTransport.supportTransportWeight >= 0.5) {
      zone.supportedTransportParticleCount += 1;
      zone.supportedTangentialSpeedSum += supportTransport.tangentialSpeed;
    }
    if (Math.abs(restStateValues[restOffset + 3]) >= 0.5) zone.interfaceTransitionCount += 1;
    if (restStateValues[restOffset] >= INTERFACE_THRESHOLD) {
      zone.persistentInterfaceParticleCount += 1;
      zone.interfaceAgeSum += restStateValues[restOffset + 1];
    }
  }
  const rows = KAMINOS_FINGER_FLUID_PLAYGROUND_ZONES.map(name => {
    const zone = zones[name];
    return {
      ...zone,
      averageKineticEnergy: Number((zone.kineticEnergy / Math.max(1, zone.particleCount)).toFixed(5)),
      kineticEnergy: Number(zone.kineticEnergy.toFixed(4)),
      interfaceRatio: Number((zone.surfaceParticleCount / Math.max(1, zone.particleCount)).toFixed(4)),
      supportedRestingRatio: Number((zone.supportedRestingParticleCount / Math.max(1, zone.particleCount)).toFixed(4)),
      activeTransportRatio: Number((zone.activeTransportParticleCount / Math.max(1, zone.particleCount)).toFixed(4)),
      supportedTransportRatio: Number((zone.supportedTransportParticleCount / Math.max(1, zone.particleCount)).toFixed(4)),
      averageSupportedTangentialSpeed: Number((zone.supportedTangentialSpeedSum / Math.max(1, zone.supportedTransportParticleCount)).toFixed(4)),
      interfaceChurnRatio: Number((zone.interfaceTransitionCount / Math.max(1, zone.particleCount)).toFixed(4)),
      averageSupportRestWeight: Number((zone.supportRestWeightSum / Math.max(1, zone.particleCount)).toFixed(4)),
      averageInterfaceAge: Number((zone.interfaceAgeSum / Math.max(1, zone.persistentInterfaceParticleCount)).toFixed(4)),
      averageNeighborRetention: Number((zone.neighborRetentionSum / Math.max(1, zone.particleCount)).toFixed(4)),
      averageNeighborRetentionAge: Number((zone.neighborRetentionAgeSum / Math.max(1, zone.particleCount)).toFixed(4)),
      movingLockedParticleRatio: Number((zone.movingLockedParticleCount / Math.max(1, zone.particleCount)).toFixed(4)),
    };
  });
  const materialThreshold = Math.ceil(particleCount * 0.01);
  return {
    schema: 'kaminos.finger-fluid.playground-zone-diagnostics.v0',
    zoneCount: rows.length,
    occupiedZoneCount: rows.filter(zone => zone.particleCount > 0).length,
    materialOccupancyThreshold: materialThreshold,
    materiallyOccupiedZoneCount: rows.filter(zone => zone.particleCount >= materialThreshold).length,
    particleCount: rows.reduce((sum, zone) => sum + zone.particleCount, 0),
    zones: rows,
  };
}

function createInitialParticles(particleCount) {
  const data = new Float32Array(particleCount * PARTICLE_FLOATS);
  const spacing = 0.055;
  const zoneSeeds = [
    { name: 'source_shelf', center: [-0.42, -2.06], columns: 20, velocity: [0.03, 0, 0.18], phase: 0.08 },
    { name: 'spillway', center: [0.0, -0.83], columns: 16, velocity: [0, 0, 0.42], phase: 0.28 },
    { name: 'shallow_pool', center: [1.43, 0.36], columns: 16, velocity: [-0.05, 0, 0.03], phase: 0.48 },
    { name: 'deep_pool', center: [-1.42, 0.48], columns: 16, velocity: [0.04, 0, 0.02], phase: 0.66 },
    { name: 'obstacle_channel', center: [0.0, 0.51], columns: 16, velocity: [0.02, 0, 0.25], phase: 0.82 },
    { name: 'catch_basin', center: [0.0, 2.02], columns: 16, velocity: [0, 0, 0], phase: 0.96 },
  ];
  const zoneSchedule = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5];
  const zoneLocalCounts = new Uint32Array(zoneSeeds.length);
  for (let index = 0; index < particleCount; index += 1) {
    const zoneIndex = zoneSchedule[index % zoneSchedule.length];
    const localIndex = zoneLocalCounts[zoneIndex];
    zoneLocalCounts[zoneIndex] += 1;
    const zone = zoneSeeds[zoneIndex];
    const columns = zone.columns;
    const xIndex = localIndex % columns;
    const zIndex = Math.floor(localIndex / columns) % columns;
    const yIndex = Math.floor(localIndex / (columns * columns));
    const jitter = ((index * 1664525 + 1013904223) >>> 8) / 0x00ffffff - 0.5;
    const offset = index * PARTICLE_FLOATS;
    const x = zone.center[0] + (xIndex - (columns - 1) * 0.5) * spacing + jitter * 0.004;
    const z = zone.center[1] + (zIndex - (columns - 1) * 0.5) * spacing + Math.cos(index * 0.19) * 0.0025;
    const y = sampleFingerFluidPlaygroundHeight(x, z) + 0.055 + yIndex * spacing + Math.sin(index * 0.37) * 0.0025;
    data[offset + 0] = x;
    data[offset + 1] = y;
    data[offset + 2] = z;
    data[offset + 3] = 1;
    data[offset + 4] = x;
    data[offset + 5] = y;
    data[offset + 6] = z;
    data[offset + 7] = 0;
    data[offset + 8] = zone.velocity[0] + Math.sin(z * 2.7) * 0.018;
    data[offset + 9] = zone.velocity[1];
    data[offset + 10] = zone.velocity[2] + Math.sin(y * 3.1) * 0.018;
    data[offset + 11] = zone.phase;
  }
  return data;
}

function createInitialMaterialTracers(particleData, particleCount) {
  const data = new Float32Array(particleCount * MATERIAL_TRACER_FLOATS);
  for (let index = 0; index < particleCount; index += 1) {
    const phase = particleData[index * PARTICLE_FLOATS + 11];
    const offset = index * MATERIAL_TRACER_FLOATS;
    data[offset] = phase;
    data[offset + 1] = 0;
    data[offset + 2] = phase;
    data[offset + 3] = 0;
  }
  return data;
}

function createUnavailableSolver(reason) {
  return {
    available: false,
    solver_backend: 'webgpu_unavailable',
    render_backend: 'webgpu_unavailable',
    reason,
    destroy() {},
  };
}

export async function createWebGPUFingerFluidSolver({
  canvas,
  particleCount = DEFAULT_PARTICLE_COUNT,
  densityIterations = 3,
  substeps = 1,
  colorMode = 'phase',
  particleShiftStrength = 0,
  chemistryDiffusion = 0,
} = {}) {
  if (!canvas?.getContext) return createUnavailableSolver('missing canvas');
  if (!globalThis.navigator?.gpu) return createUnavailableSolver('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return createUnavailableSolver('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) return createUnavailableSolver('GPUCanvasContext unavailable');

  const safeParticleCount = Math.max(1024, Math.floor(finite(particleCount, DEFAULT_PARTICLE_COUNT)));
  const safeDensityIterations = Math.max(1, Math.floor(finite(densityIterations, 3)));
  const safeSubsteps = Math.max(1, Math.floor(finite(substeps, 1)));
  const safeColorMode = resolveFingerFluidColorMode(colorMode);
  const safeParticleShiftStrength = resolveFingerFluidParticleShiftStrength(particleShiftStrength);
  const safeChemistryDiffusion = resolveFingerFluidChemistryDiffusion(chemistryDiffusion);
  const particleData = createInitialParticles(safeParticleCount);
  const materialTracerData = createInitialMaterialTracers(particleData, safeParticleCount);
  const initialChemistryMass = materialTracerData.reduce((sum, value, index) => sum + (index % MATERIAL_TRACER_FLOATS === 0 ? value : 0), 0);
  const particleBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-particles',
    size: particleData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const cellHeadsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-cellHeads',
    size: GRID_CELL_COUNT * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const particleNextBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-particleNext',
    size: safeParticleCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-params',
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const diagnosticsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-diagnostics-readback',
    size: particleData.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const interfaceRecordsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-interface-records',
    size: safeParticleCount * INTERFACE_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const interfaceCountersBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-interface-counters',
    size: 12,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const restStateBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-rest-state',
    size: safeParticleCount * REST_STATE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const neighborTopologyBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-neighbor-topology',
    size: safeParticleCount * NEIGHBOR_TOPOLOGY_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const materialTracerBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-material-tracers',
    size: safeParticleCount * MATERIAL_TRACER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const interfaceCountersReadbackBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-interface-counters-readback',
    size: 12,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const interfaceRecordsReadbackBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-interface-records-readback',
    size: safeParticleCount * INTERFACE_RECORD_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const restStateReadbackBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-rest-state-readback',
    size: safeParticleCount * REST_STATE_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const neighborTopologyReadbackBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-neighbor-topology-readback',
    size: safeParticleCount * NEIGHBOR_TOPOLOGY_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const materialTracerReadbackBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-material-tracers-readback',
    size: safeParticleCount * MATERIAL_TRACER_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  device.queue.writeBuffer(particleBuffer, 0, particleData);
  device.queue.writeBuffer(interfaceCountersBuffer, 0, new Uint32Array(3));
  device.queue.writeBuffer(restStateBuffer, 0, new Float32Array(safeParticleCount * REST_STATE_FLOATS));
  const initialTopology = new Uint32Array(safeParticleCount * NEIGHBOR_TOPOLOGY_WORDS);
  for (let index = 0; index < safeParticleCount; index += 1) {
    initialTopology.fill(INVALID_NEIGHBOR_ID, index * NEIGHBOR_TOPOLOGY_WORDS, index * NEIGHBOR_TOPOLOGY_WORDS + 4);
  }
  device.queue.writeBuffer(neighborTopologyBuffer, 0, initialTopology);
  device.queue.writeBuffer(materialTracerBuffer, 0, materialTracerData);

  const computeModule = device.createShaderModule({ label: KAMINOS_FINGER_FLUID_GPU_SHADER_ROUTE, code: COMPUTE_SHADER });
  const computeLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-compute-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
  const pipelineFor = entryPoint => device.createComputePipelineAsync({
    label: `${KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE}:${entryPoint}`,
    layout: computePipelineLayout,
    compute: { module: computeModule, entryPoint },
  });
  let pipelines;
  try {
    pipelines = {
      clear: await pipelineFor('clear_grid'),
      predict: await pipelineFor('predict_positions'),
      build: await pipelineFor('build_linked_cell_grid'),
      lambda: await pipelineFor('compute_density_lambda'),
      delta: await pipelineFor('solve_position_delta'),
      applyDelta: await pipelineFor('apply_position_delta'),
      classifySurface: await pipelineFor('classify_free_surface'),
      velocity: await pipelineFor('compute_velocity_viscosity'),
      vorticity: await pipelineFor('compute_vorticity'),
      confinement: await pipelineFor('apply_vorticity_confinement'),
      cohesion: await pipelineFor('apply_surface_cohesion'),
      applyVelocity: await pipelineFor('apply_velocity_position'),
      clearInterface: await pipelineFor('clear_interface_counters'),
      compactInterface: await pipelineFor('compact_interface_records'),
      measureTopology: await pipelineFor('measure_neighbor_topology'),
      computeParticleShift: await pipelineFor('compute_support_particle_shift'),
      applyParticleShift: await pipelineFor('apply_support_particle_shift'),
      computeChemistry: await pipelineFor('compute_material_tracer_diffusion'),
      applyChemistry: await pipelineFor('apply_material_tracer_diffusion'),
    };
  } catch (error) {
    return createUnavailableSolver(`WebGPU compute pipeline validation failed: ${error.message || String(error)}`);
  }
  const computeBindGroup = device.createBindGroup({
    label: 'kaminos-finger-fluid-compute-bind-group',
    layout: computeLayout,
    entries: [
      { binding: 0, resource: { buffer: particleBuffer } },
      { binding: 1, resource: { buffer: cellHeadsBuffer } },
      { binding: 2, resource: { buffer: particleNextBuffer } },
      { binding: 3, resource: { buffer: paramsBuffer } },
      { binding: 4, resource: { buffer: interfaceRecordsBuffer } },
      { binding: 5, resource: { buffer: interfaceCountersBuffer } },
      { binding: 6, resource: { buffer: restStateBuffer } },
      { binding: 7, resource: { buffer: neighborTopologyBuffer } },
      { binding: 8, resource: { buffer: materialTracerBuffer } },
    ],
  });

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const renderParamsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-render-params',
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderModule = device.createShaderModule({ label: KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE, code: RENDER_SHADER });
  let renderPipeline;
  try {
    renderPipeline = await device.createRenderPipelineAsync({
      label: KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE,
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
  } catch (error) {
    return createUnavailableSolver(`WebGPU render pipeline validation failed: ${error.message || String(error)}`);
  }
  const renderBindGroup = device.createBindGroup({
    label: 'kaminos-finger-fluid-render-bind-group',
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: particleBuffer } },
      { binding: 1, resource: { buffer: renderParamsBuffer } },
      { binding: 2, resource: { buffer: neighborTopologyBuffer } },
      { binding: 3, resource: { buffer: materialTracerBuffer } },
    ],
  });

  let depthTexture = null;
  let configuredExtent = '';
  let frameIndex = 0;
  let stepCount = 0;
  let linkedCellGridBuildCount = 0;
  let densityIterationCount = 0;
  let vorticityPassCount = 0;
  let postProjectionGridRefreshCount = 0;
  let freeSurfaceClassificationPassCount = 0;
  let surfaceCohesionPassCount = 0;
  let interfaceCompactionPassCount = 0;
  let topologyMeasurementPassCount = 0;
  let particleShiftPassCount = 0;
  let chemistryDiffusionPassCount = 0;
  let directRenderFrameCount = 0;
  let lastFrameCpuMs = 0;
  let diagnosticsPending = false;
  let diagnosticsRequestCount = 0;
  let diagnosticsCompletionCount = 0;
  let diagnosticsLastDurationMs = 0;
  let diagnostics = null;
  let destroyed = false;

  function ensureExtent(width, height, pixelRatio = globalThis.devicePixelRatio || 1) {
    const targetWidth = Math.max(1, Math.floor(width * pixelRatio));
    const targetHeight = Math.max(1, Math.floor(height * pixelRatio));
    const key = `${targetWidth}x${targetHeight}`;
    if (configuredExtent === key) return { width: targetWidth, height: targetHeight };
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.configure({ device, format, alphaMode: 'opaque' });
    depthTexture?.destroy();
    depthTexture = device.createTexture({
      label: 'kaminos-finger-fluid-depth',
      size: [targetWidth, targetHeight],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    configuredExtent = key;
    return { width: targetWidth, height: targetHeight };
  }

  function writeSimulationParams(dt) {
    const buffer = new ArrayBuffer(128);
    const view = new DataView(buffer);
    view.setFloat32(0, dt, true);
    view.setUint32(4, safeParticleCount, true);
    view.setUint32(8, frameIndex, true);
    view.setUint32(12, GRID_CELL_COUNT, true);
    view.setUint32(16, GRID_DIMS[0], true);
    view.setUint32(20, GRID_DIMS[1], true);
    view.setUint32(24, GRID_DIMS[2], true);
    view.setUint32(28, GRID_CELL_COUNT, true);
    BOUNDS_MIN.forEach((value, index) => view.setFloat32(32 + index * 4, value, true));
    BOUNDS_MAX.forEach((value, index) => view.setFloat32(48 + index * 4, value, true));
    view.setFloat32(64, 0.185, true);
    view.setFloat32(68, 24.3, true);
    view.setFloat32(72, 0.012, true);
    view.setFloat32(76, 0.22, true);
    view.setFloat32(80, -9.2, true);
    view.setFloat32(84, 0.991, true);
    view.setFloat32(88, 0.07, true);
    view.setFloat32(92, 0.025, true);
    view.setFloat32(96, safeParticleShiftStrength, true);
    view.setFloat32(112, safeChemistryDiffusion, true);
    device.queue.writeBuffer(paramsBuffer, 0, buffer);
  }

  function dispatch(pass, pipeline, count) {
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
  }

  function step(dt = 1 / 60) {
    if (destroyed) return;
    const startedAt = performance.now();
    const frameDt = clamp(finite(dt, 1 / 60), 1 / 240, 1 / 30);
    const substepDt = frameDt / safeSubsteps;
    for (let substep = 0; substep < safeSubsteps; substep += 1) {
      writeSimulationParams(substepDt);
      const encoder = device.createCommandEncoder({ label: 'kaminos-finger-fluid-simulation-step' });
      const pass = encoder.beginComputePass({ label: KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE });
      pass.setBindGroup(0, computeBindGroup);
      dispatch(pass, pipelines.predict, safeParticleCount);
      for (let iteration = 0; iteration < safeDensityIterations; iteration += 1) {
        dispatch(pass, pipelines.clear, GRID_CELL_COUNT);
        dispatch(pass, pipelines.build, safeParticleCount);
        dispatch(pass, pipelines.lambda, safeParticleCount);
        dispatch(pass, pipelines.delta, safeParticleCount);
        dispatch(pass, pipelines.applyDelta, safeParticleCount);
        linkedCellGridBuildCount += 1;
        densityIterationCount += 1;
      }
      dispatch(pass, pipelines.clear, GRID_CELL_COUNT);
      dispatch(pass, pipelines.build, safeParticleCount);
      linkedCellGridBuildCount += 1;
      postProjectionGridRefreshCount += 1;
      dispatch(pass, pipelines.measureTopology, safeParticleCount);
      topologyMeasurementPassCount += 1;
      if (safeChemistryDiffusion > 0) {
        dispatch(pass, pipelines.computeChemistry, safeParticleCount);
        dispatch(pass, pipelines.applyChemistry, safeParticleCount);
        chemistryDiffusionPassCount += 2;
      }
      dispatch(pass, pipelines.classifySurface, safeParticleCount);
      freeSurfaceClassificationPassCount += 1;
      dispatch(pass, pipelines.velocity, safeParticleCount);
      if (frameIndex % VORTICITY_UPDATE_INTERVAL === 0) {
        dispatch(pass, pipelines.vorticity, safeParticleCount);
        dispatch(pass, pipelines.confinement, safeParticleCount);
        vorticityPassCount += 2;
      }
      dispatch(pass, pipelines.cohesion, safeParticleCount);
      surfaceCohesionPassCount += 1;
      dispatch(pass, pipelines.applyVelocity, safeParticleCount);
      dispatch(pass, pipelines.clearInterface, 1);
      dispatch(pass, pipelines.compactInterface, safeParticleCount);
      interfaceCompactionPassCount += 1;
      if (safeParticleShiftStrength > 0) {
        dispatch(pass, pipelines.computeParticleShift, safeParticleCount);
        dispatch(pass, pipelines.applyParticleShift, safeParticleCount);
        particleShiftPassCount += 2;
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      stepCount += 1;
      frameIndex += 1;
    }
    lastFrameCpuMs = performance.now() - startedAt;
  }

  function render({
    width = canvas.clientWidth || 1,
    height = canvas.clientHeight || 1,
    pixelRatio = globalThis.devicePixelRatio || 1,
    yaw = -0.55,
    pitch = 0.34,
    distance = 4.45,
    target = [0, -0.05, 0],
    colorMode = safeColorMode,
  } = {}) {
    if (destroyed) return;
    const extent = ensureExtent(width, height, pixelRatio);
    const cp = Math.cos(pitch);
    const eye = [
      target[0] + Math.sin(yaw) * cp * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * cp * distance,
    ];
    const forward = normalize3(subtract3(target, eye));
    const right = normalize3(cross3(forward, [0, 1, 0]));
    const up = normalize3(cross3(right, forward));
    const projection = perspectiveMatrix(Math.PI / 3.15, extent.width / extent.height, 0.08, 30);
    const view = lookAtMatrix(eye, target, [0, 1, 0]);
    const viewProjection = multiplyMatrices(projection, view);
    const renderData = new Float32Array(28);
    const effectiveColorMode = resolveFingerFluidColorMode(colorMode);
    const colorModeIndex = KAMINOS_FINGER_FLUID_COLOR_MODES.indexOf(effectiveColorMode);
    renderData.set(viewProjection, 0);
    renderData.set([...right, colorModeIndex], 16);
    renderData.set([...up, 0], 20);
    renderData.set([extent.width, extent.height, 0.046, safeParticleCount], 24);
    device.queue.writeBuffer(renderParamsBuffer, 0, renderData);

    const encoder = device.createCommandEncoder({ label: 'kaminos-finger-fluid-render-frame' });
    const pass = encoder.beginRenderPass({
      label: KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE,
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.006, g: 0.012, b: 0.018, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderBindGroup);
    pass.draw(6, safeParticleCount + PLAYGROUND_TILE_COUNT + PLAYGROUND_SKIRT_COUNT + PLAYGROUND_OBSTACLE_COUNT);
    pass.end();
    device.queue.submit([encoder.finish()]);
    directRenderFrameCount += 1;
  }

  async function requestDiagnostics() {
    if (diagnosticsPending || destroyed) return diagnostics;
    diagnosticsPending = true;
    diagnosticsRequestCount += 1;
    const diagnosticsStartedAtMs = performance.now();
    const readbackBuffers = [diagnosticsBuffer, interfaceCountersReadbackBuffer, interfaceRecordsReadbackBuffer, restStateReadbackBuffer, neighborTopologyReadbackBuffer, materialTracerReadbackBuffer];
    try {
      const diagnosticsStepCount = stepCount;
      const diagnosticsCapturedAtMs = performance.now();
      const encoder = device.createCommandEncoder({ label: 'kaminos-finger-fluid-diagnostics-copy' });
      encoder.copyBufferToBuffer(particleBuffer, 0, diagnosticsBuffer, 0, particleData.byteLength);
      encoder.copyBufferToBuffer(interfaceCountersBuffer, 0, interfaceCountersReadbackBuffer, 0, 12);
      encoder.copyBufferToBuffer(interfaceRecordsBuffer, 0, interfaceRecordsReadbackBuffer, 0, safeParticleCount * INTERFACE_RECORD_BYTES);
      encoder.copyBufferToBuffer(restStateBuffer, 0, restStateReadbackBuffer, 0, safeParticleCount * REST_STATE_BYTES);
      encoder.copyBufferToBuffer(neighborTopologyBuffer, 0, neighborTopologyReadbackBuffer, 0, safeParticleCount * NEIGHBOR_TOPOLOGY_BYTES);
      encoder.copyBufferToBuffer(materialTracerBuffer, 0, materialTracerReadbackBuffer, 0, safeParticleCount * MATERIAL_TRACER_BYTES);
      device.queue.submit([encoder.finish()]);
      const mapResults = await Promise.allSettled(readbackBuffers.map(buffer => buffer.mapAsync(GPUMapMode.READ)));
      const failedMap = mapResults.find(result => result.status === 'rejected');
      if (failedMap) throw failedMap.reason;
      const values = new Float32Array(diagnosticsBuffer.getMappedRange());
      const interfaceCounters = new Uint32Array(interfaceCountersReadbackBuffer.getMappedRange());
      const interfaceValues = new Float32Array(interfaceRecordsReadbackBuffer.getMappedRange());
      const restStateValues = new Float32Array(restStateReadbackBuffer.getMappedRange());
      const topologyRange = neighborTopologyReadbackBuffer.getMappedRange();
      const topologyValues = new Float32Array(topologyRange);
      const materialTracerValues = new Float32Array(materialTracerReadbackBuffer.getMappedRange());
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let speedSum = 0;
      let maxSpeed = 0;
      let densitySum = 0;
      let vorticitySum = 0;
      let maxVorticity = 0;
      let surfaceFactorSum = 0;
      let maxSurfaceFactor = 0;
      let surfaceParticleCount = 0;
      let persistentInterfaceParticleCount = 0;
      let interfaceTransitionCount = 0;
      let supportedRestingParticleCount = 0;
      let activeTransportParticleCount = 0;
      let supportedTransportParticleCount = 0;
      let supportedTangentialSpeedSum = 0;
      let supportRestWeightSum = 0;
      let interfaceAgeSum = 0;
      let neighborRetentionSum = 0;
      let neighborRetentionAgeSum = 0;
      let movingLockedParticleCount = 0;
      const neighborRetentionHistogram = [0, 0, 0, 0];
      const chemistryHistogram = [0, 0, 0, 0, 0, 0, 0, 0];
      let chemistryMass = 0;
      let sourceResetMassAdjustment = 0;
      let chemistryMin = Infinity;
      let chemistryMax = -Infinity;
      let chemistryRecipeDeviationSum = 0;
      for (let index = 0; index < safeParticleCount; index += 1) {
        const offset = index * PARTICLE_FLOATS;
        const restOffset = index * REST_STATE_FLOATS;
        const topologyOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 4;
        const chemistryOffset = index * MATERIAL_TRACER_FLOATS;
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], values[offset + axis]);
          max[axis] = Math.max(max[axis], values[offset + axis]);
        }
        const speed = Math.hypot(values[offset + 8], values[offset + 9], values[offset + 10]);
        speedSum += speed;
        maxSpeed = Math.max(maxSpeed, speed);
        densitySum += values[offset + 15];
        const vorticity = values[offset + 3];
        vorticitySum += vorticity;
        maxVorticity = Math.max(maxVorticity, vorticity);
        const surfaceFactor = values[offset + 7];
        surfaceFactorSum += surfaceFactor;
        maxSurfaceFactor = Math.max(maxSurfaceFactor, surfaceFactor);
        if (surfaceFactor >= 0.5) surfaceParticleCount += 1;
        const supportRestWeight = restStateValues[restOffset + 2];
        supportRestWeightSum += supportRestWeight;
        if (supportRestWeight >= 0.5) supportedRestingParticleCount += 1;
        if (speed >= 0.35) activeTransportParticleCount += 1;
        const supportTransport = measureSupportTransport(
          [values[offset], values[offset + 1], values[offset + 2]],
          [values[offset + 8], values[offset + 9], values[offset + 10]],
        );
        if (supportTransport.supportTransportWeight >= 0.5) {
          supportedTransportParticleCount += 1;
          supportedTangentialSpeedSum += supportTransport.tangentialSpeed;
        }
        if (Math.abs(restStateValues[restOffset + 3]) >= 0.5) interfaceTransitionCount += 1;
        if (restStateValues[restOffset] >= INTERFACE_THRESHOLD) {
          persistentInterfaceParticleCount += 1;
          interfaceAgeSum += restStateValues[restOffset + 1];
        }
        const neighborRetention = topologyValues[topologyOffset];
        neighborRetentionSum += neighborRetention;
        neighborRetentionAgeSum += topologyValues[topologyOffset + 1];
        if (topologyValues[topologyOffset + 3] >= 0.5) movingLockedParticleCount += 1;
        neighborRetentionHistogram[Math.min(3, Math.max(0, Math.floor(neighborRetention * 4)))] += 1;
        const concentration = materialTracerValues[chemistryOffset];
        const recipe = materialTracerValues[chemistryOffset + 2];
        chemistryMass += concentration;
        sourceResetMassAdjustment += materialTracerValues[chemistryOffset + 3];
        chemistryMin = Math.min(chemistryMin, concentration);
        chemistryMax = Math.max(chemistryMax, concentration);
        chemistryRecipeDeviationSum += Math.abs(concentration - recipe);
        chemistryHistogram[Math.min(7, Math.max(0, Math.floor(concentration * 8)))] += 1;
      }
      const diffusionMassDrift = chemistryMass - initialChemistryMass - sourceResetMassAdjustment;
      const chemistryMassTolerance = Math.max(0.02, safeParticleCount * 0.000002);
      const activeInterfaceCount = Math.min(interfaceCounters[0], safeParticleCount);
      const sampleRecordCount = Math.min(activeInterfaceCount, INTERFACE_SAMPLE_COUNT);
      const readInterfaceRecord = recordIndex => {
        const offset = recordIndex * INTERFACE_RECORD_FLOATS;
        return {
          position: Array.from(interfaceValues.slice(offset, offset + 3), value => Number(value.toFixed(4))),
          particleId: Math.round(interfaceValues[offset + 3]),
          velocity: Array.from(interfaceValues.slice(offset + 4, offset + 7), value => Number(value.toFixed(4))),
          confidence: Number(interfaceValues[offset + 7].toFixed(4)),
          normal: Array.from(interfaceValues.slice(offset + 8, offset + 11), value => Number(value.toFixed(4))),
          curvature: Number(interfaceValues[offset + 11].toFixed(4)),
          thickness: Number(interfaceValues[offset + 12].toFixed(4)),
          contact: Number(interfaceValues[offset + 13].toFixed(4)),
          wetness: Number(interfaceValues[offset + 14].toFixed(4)),
          material: Number(interfaceValues[offset + 15].toFixed(4)),
          stability: Number(interfaceValues[offset + 16].toFixed(4)),
          ageSeconds: Number(interfaceValues[offset + 17].toFixed(4)),
          sourceFrame: Math.round(interfaceValues[offset + 18]),
          supportAlignment: Number(interfaceValues[offset + 19].toFixed(4)),
        };
      };
      let malformedRecordCount = 0;
      let contactRecordCount = 0;
      let minimumContactSupportAlignment = 1;
      for (let index = 0; index < activeInterfaceCount; index += 1) {
        const record = readInterfaceRecord(index);
        const fields = [...record.position, ...record.velocity, ...record.normal, record.confidence, record.curvature, record.thickness, record.contact, record.wetness, record.material, record.stability, record.ageSeconds, record.sourceFrame, record.supportAlignment];
        const normalLength = Math.hypot(...record.normal);
        if (!Number.isSafeInteger(record.particleId) || !fields.every(Number.isFinite) || normalLength < 0.8 || normalLength > 1.2 || record.confidence < 0 || record.confidence > 1.001 || record.thickness <= 0) {
          malformedRecordCount += 1;
        }
        if (record.contact >= 0.5) {
          contactRecordCount += 1;
          minimumContactSupportAlignment = Math.min(minimumContactSupportAlignment, record.supportAlignment);
        }
      }
      const sampleRecords = [];
      for (let index = 0; index < sampleRecordCount; index += 1) {
        const sampleIndex = Math.floor(index * (activeInterfaceCount - 1) / Math.max(1, sampleRecordCount - 1));
        sampleRecords.push(readInterfaceRecord(sampleIndex));
      }
      diagnostics = {
        readbackMode: 'explicit_sparse_gpu_diagnostics_v0',
        stepCount: diagnosticsStepCount,
        capturedAtMs: Number(diagnosticsCapturedAtMs.toFixed(1)),
        activeExtent3d: {
          min: min.map(value => Number(value.toFixed(4))),
          max: max.map(value => Number(value.toFixed(4))),
          size: max.map((value, axis) => Number((value - min[axis]).toFixed(4))),
        },
        averageSpeed: Number((speedSum / safeParticleCount).toFixed(4)),
        maxSpeed: Number(maxSpeed.toFixed(4)),
        averageDensity: Number((densitySum / safeParticleCount).toFixed(4)),
        averageVorticity: Number((vorticitySum / safeParticleCount).toFixed(4)),
        maxVorticity: Number(maxVorticity.toFixed(4)),
        surfaceParticleCount,
        surfaceParticleRatio: Number((surfaceParticleCount / safeParticleCount).toFixed(4)),
        averageSurfaceFactor: Number((surfaceFactorSum / safeParticleCount).toFixed(4)),
        maxSurfaceFactor: Number(maxSurfaceFactor.toFixed(4)),
        restStateContract: KAMINOS_FINGER_FLUID_REST_STATE_CONTRACT,
        supportTransportContract: KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT,
        topologyContract: KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT,
        averageNeighborRetention: Number((neighborRetentionSum / safeParticleCount).toFixed(4)),
        averageNeighborRetentionAge: Number((neighborRetentionAgeSum / safeParticleCount).toFixed(4)),
        movingLockedParticleCount,
        movingLockedParticleRatio: Number((movingLockedParticleCount / safeParticleCount).toFixed(4)),
        neighborRetentionHistogram,
        neighborRetentionHistogramEdges: [0, 0.25, 0.5, 0.75, 1.001],
        chemistry: {
          contract: KAMINOS_FINGER_FLUID_CHEMISTRY_CONTRACT,
          mode: 'passive_transported_scalar_not_reactive_chemistry',
          diffusionStrength: safeChemistryDiffusion,
          initialMass: Number(initialChemistryMass.toFixed(6)),
          currentMass: Number(chemistryMass.toFixed(6)),
          sourceResetMassAdjustment: Number(sourceResetMassAdjustment.toFixed(6)),
          diffusionMassDrift: Number(diffusionMassDrift.toFixed(6)),
          massTolerance: Number(chemistryMassTolerance.toFixed(6)),
          minimum: Number(chemistryMin.toFixed(6)),
          maximum: Number(chemistryMax.toFixed(6)),
          averageRecipeDeviation: Number((chemistryRecipeDeviationSum / safeParticleCount).toFixed(6)),
          chemistryHistogram,
          chemistryHistogramEdges: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.001],
          particleCount: safeParticleCount,
        },
        interfaceTransitionCount,
        interfaceChurnRatio: Number((interfaceTransitionCount / safeParticleCount).toFixed(5)),
        persistentInterfaceParticleCount,
        averageInterfaceAge: Number((interfaceAgeSum / Math.max(1, persistentInterfaceParticleCount)).toFixed(4)),
        supportedRestingParticleCount,
        supportedRestingParticleRatio: Number((supportedRestingParticleCount / safeParticleCount).toFixed(4)),
        averageSupportRestWeight: Number((supportRestWeightSum / safeParticleCount).toFixed(4)),
        activeTransportParticleCount,
        activeTransportParticleRatio: Number((activeTransportParticleCount / safeParticleCount).toFixed(4)),
        supportedTransportParticleCount,
        supportedTransportParticleRatio: Number((supportedTransportParticleCount / safeParticleCount).toFixed(4)),
        averageSupportedTangentialSpeed: Number((supportedTangentialSpeedSum / Math.max(1, supportedTransportParticleCount)).toFixed(4)),
        playgroundZoneDiagnostics: playgroundZoneDiagnostics(values, restStateValues, topologyValues, safeParticleCount),
        sourceRecirculationCount: interfaceCounters[2],
        interfaceCarrier: {
          schema: KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA,
          sourceFrame: 'kaminos/finger-fluid-bench:gpu-simulation-frame',
          recordFloats: INTERFACE_RECORD_FLOATS,
          recordBytes: INTERFACE_RECORD_BYTES,
          interfaceCapacity: safeParticleCount,
          capacity: safeParticleCount,
          candidateCapMode: 'uncapped_exact_particle_population_capacity',
          activeCount: activeInterfaceCount,
          overflowCount: interfaceCounters[1],
          copyMode: 'gpu_compaction_full_active_population_diagnostics_v0',
          qualifyingThreshold: INTERFACE_THRESHOLD,
          validatedRecordCount: activeInterfaceCount,
          malformedRecordCount,
          contactRecordCount,
          minimumContactSupportAlignment: contactRecordCount > 0 ? Number(minimumContactSupportAlignment.toFixed(4)) : null,
          sampleCoverageMode: 'stratified_across_active_compacted_population_v0',
          sampleRecords,
        },
      };
      diagnosticsCompletionCount += 1;
      return diagnostics;
    } finally {
      for (const buffer of readbackBuffers) {
        if (buffer.mapState === 'mapped') buffer.unmap();
      }
      diagnosticsLastDurationMs = performance.now() - diagnosticsStartedAtMs;
      diagnosticsPending = false;
    }
  }

  function getDebugState() {
    return {
      available: true,
      solver_backend: 'webgpu_compute',
      render_backend: 'webgpu_direct_render',
      solverRoute: KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE,
      shaderRoute: KAMINOS_FINGER_FLUID_GPU_SHADER_ROUTE,
      neighborGridContract: KAMINOS_FINGER_FLUID_NEIGHBOR_GRID_CONTRACT,
      densityContract: KAMINOS_FINGER_FLUID_DENSITY_CONTRACT,
      vorticityConfinementContract: KAMINOS_FINGER_FLUID_VORTICITY_CONTRACT,
      freeSurfaceContract: KAMINOS_FINGER_FLUID_FREE_SURFACE_CONTRACT,
      restStateContract: KAMINOS_FINGER_FLUID_REST_STATE_CONTRACT,
      supportTransportContract: KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT,
      topologyContract: KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT,
      particleShiftContract: KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_CONTRACT,
      chemistryContract: KAMINOS_FINGER_FLUID_CHEMISTRY_CONTRACT,
      colorMode: safeColorMode,
      particleShiftStrength: safeParticleShiftStrength,
      chemistryDiffusion: safeChemistryDiffusion,
      obstacleContract: KAMINOS_FINGER_FLUID_OBSTACLE_CONTRACT,
      obstacle: { center: [...OBSTACLE_CENTER], radius: OBSTACLE_RADIUS, rendered: directRenderFrameCount > 0 },
      playgroundContract: KAMINOS_FINGER_FLUID_PLAYGROUND_CONTRACT,
      playground: {
        zones: [...KAMINOS_FINGER_FLUID_PLAYGROUND_ZONES],
        supportGeometryMode: 'shared_analytic_heightfield_billboard_tiles_and_cliff_skirt_v0',
        supportGeometryCount: PLAYGROUND_TILE_COUNT + PLAYGROUND_SKIRT_COUNT + PLAYGROUND_OBSTACLE_COUNT,
        terrainTileCount: PLAYGROUND_TILE_COUNT,
        cliffSkirtCount: PLAYGROUND_SKIRT_COUNT,
        obstacleCount: PLAYGROUND_OBSTACLE_COUNT,
        rendered: directRenderFrameCount > 0,
      },
      interfaceCarrierSchema: KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA,
      interfaceCapacity: safeParticleCount,
      candidateCapMode: 'uncapped_exact_particle_population_capacity',
      interfaceCarrier: diagnostics?.interfaceCarrier || {
        schema: KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA,
        sourceFrame: 'kaminos/finger-fluid-bench:gpu-simulation-frame',
        recordFloats: INTERFACE_RECORD_FLOATS,
        recordBytes: INTERFACE_RECORD_BYTES,
        interfaceCapacity: safeParticleCount,
        capacity: safeParticleCount,
        candidateCapMode: 'uncapped_exact_particle_population_capacity',
        activeCount: 0,
        overflowCount: 0,
        copyMode: 'gpu_compaction_exact_particle_capacity_v0',
        qualifyingThreshold: INTERFACE_THRESHOLD,
        sampleRecords: [],
      },
      playgroundZoneDiagnostics: diagnostics?.playgroundZoneDiagnostics || null,
      sourceRecirculationMode: 'material_tagged_finite_particle_loop_v0',
      sourceRecirculationCount: diagnostics?.sourceRecirculationCount || 0,
      stabilityContract: KAMINOS_FINGER_FLUID_STABILITY_CONTRACT,
      renderRoute: KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE,
      renderShaderRoute: KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE,
      particleCount: safeParticleCount,
      gridDimensions: [...GRID_DIMS],
      gridCellCount: GRID_CELL_COUNT,
      densityIterationsPerStep: safeDensityIterations,
      restDensity: 24.3,
      maxFluidSpeed: MAX_FLUID_SPEED,
      substeps: safeSubsteps,
      stepCount,
      linkedCellGridBuildCount,
      densityIterationCount,
      vorticityPassCount,
      vorticityUpdateInterval: VORTICITY_UPDATE_INTERVAL,
      postProjectionGridRefreshCount,
      freeSurfaceClassificationPassCount,
      surfaceCohesionPassCount,
      interfaceCompactionPassCount,
      topologyMeasurementPassCount,
      particleShiftPassCount,
      chemistryDiffusionPassCount,
      diagnosticsPending,
      diagnosticsRequestCount,
      diagnosticsCompletionCount,
      diagnosticsLastDurationMs: Number(diagnosticsLastDurationMs.toFixed(3)),
      directRenderFrameCount,
      lastFrameCpuMs: Number(lastFrameCpuMs.toFixed(3)),
      diagnostics: diagnostics ? {
        ...diagnostics,
        ageMs: Number(Math.max(0, performance.now() - diagnostics.capturedAtMs).toFixed(1)),
      } : null,
      adapterInfo: adapter.info ? {
        vendor: adapter.info.vendor || null,
        architecture: adapter.info.architecture || null,
        device: adapter.info.device || null,
        description: adapter.info.description || null,
      } : { vendor: 'unknown' },
    };
  }

  function destroy() {
    destroyed = true;
    particleBuffer.destroy();
    cellHeadsBuffer.destroy();
    particleNextBuffer.destroy();
    paramsBuffer.destroy();
    diagnosticsBuffer.destroy();
    interfaceRecordsBuffer.destroy();
    interfaceCountersBuffer.destroy();
    restStateBuffer.destroy();
    neighborTopologyBuffer.destroy();
    materialTracerBuffer.destroy();
    interfaceCountersReadbackBuffer.destroy();
    interfaceRecordsReadbackBuffer.destroy();
    restStateReadbackBuffer.destroy();
    neighborTopologyReadbackBuffer.destroy();
    materialTracerReadbackBuffer.destroy();
    renderParamsBuffer.destroy();
    depthTexture?.destroy();
  }

  device.lost.then(info => {
    destroyed = true;
    console.error('Kaminos Finger Fluid WebGPU device lost:', info.message || info.reason);
  });

  return {
    available: true,
    solver_backend: 'webgpu_compute',
    render_backend: 'webgpu_direct_render',
    step,
    render,
    requestDiagnostics,
    getDebugState,
    destroy,
  };
}
