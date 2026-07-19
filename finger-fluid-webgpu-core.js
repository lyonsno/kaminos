export const KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE = 'webgpu-pbf-linked-cell-fluid-v0';
export const KAMINOS_FINGER_FLUID_NEIGHBOR_GRID_CONTRACT = 'wgsl-linked-cell-neighbor-grid-v0';
export const KAMINOS_FINGER_FLUID_DENSITY_CONTRACT = 'wgsl-pbf-density-constraint-v0';
export const KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT = 'wgsl-analytic-boundary-density-support-v0';
export const KAMINOS_FINGER_FLUID_SUPPORT_FRICTION_CONTRACT = 'wgsl-analytic-contact-partial-slip-v0';
export const KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION = 1.6;
export const KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT = 'wgsl-per-pass-kinetic-energy-ledger-v0';
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
export const KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT = 'wgsl-solver-owned-interface-normal-curvature-confidence-v1';
export const KAMINOS_FINGER_FLUID_LAMINAR_INLET_CONTRACT = 'wgsl-descriptor-laminar-inlet-recycling-v0';
export const KAMINOS_FINGER_FLUID_LAMINAR_FIXTURE_CONTRACT = 'wgsl-analytic-laminar-inlet-fixture-presentation-v0';
export const KAMINOS_FINGER_FLUID_LAMINAR_SOURCE_POPULATION_CONTRACT = 'wgsl-distinct-flux-cadenced-inlet-population-v0';
export const KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT = 'wgsl-support-aware-symmetric-capillary-sheet-v0';
export const KAMINOS_FINGER_FLUID_INTERFACE_PRESSURE_CONTRACT = 'wgsl-unilateral-free-surface-pressure-v0';
export const KAMINOS_FINGER_FLUID_WATERFALL_DIAGNOSTICS_SCHEMA = 'kaminos.finger-fluid.waterfall-continuity-diagnostics.v0';
export const KAMINOS_FINGER_FLUID_WATERFALL_SOAK_EVIDENCE_IDENTITY_SCHEMA = 'kaminos.finger-fluid.waterfall-soak-evidence-identity.v0';
export const KAMINOS_FINGER_FLUID_PARTICLE_ALLOCATION_PREFLIGHT_CONTRACT = 'webgpu-device-limit-derived-particle-allocation-preflight-v0';
export const KAMINOS_FINGER_FLUID_DEFAULT_CAPILLARY_STRENGTH = 0.72;
export const KAMINOS_FINGER_FLUID_DEFAULT_THIN_SHEET_VORTICITY_ATTENUATION = 0.88;
export const KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST = 0.17;
export const KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT = 49_152;
export const KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS = 1 / 60;
export const KAMINOS_FINGER_FLUID_BENCH_TIME_INTEGRATION_CONTRACT = 'fixed-step-60hz-one-simulation-step-per-render-frame-v0';
export const KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA = 'kaminos.liquid-fire-contact-descriptor.v1';
export const KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING = 'gpu-sparse-liquid-fire-contact-source-vec4x8-v1';
export const KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE = 'webgpu-particle-sphere-renderer-v0';
export const KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE = 'webgpu-screen-space-liquid-surface-v0';
export const KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE = 'webgpu-screen-space-liquid-refraction-v0';
export const KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE = 'snell-two-interface-screen-space-slab-v0';
export const KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE = 'wgsl-particle-projected-front-back-slab-v0';
export const KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE = 'webgpu-particle-sphere-debug-renderer-v0';
export const KAMINOS_FINGER_FLUID_GPU_SHADER_ROUTE = 'wgsl-pbf-linked-cell-fluid-v0';
export const KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE = 'wgsl-fluid-particle-sphere-v0';
export const KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE = 'wgsl-fluid-screen-space-surface-v0';
export const KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE = 'wgsl-analytic-heightfield-obstacle-depth-v0';
export const KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE = 'wgsl-analytic-heightfield-obstacle-presentation-v0';
export const KAMINOS_FINGER_FLUID_STABILITY_CONTRACT = 'bounded-pbf-energy-v0';
export const KAMINOS_FINGER_FLUID_TRUTH_GAUNTLET_CONTRACT = 'kaminos-fluid-truth-gauntlet-v0';

const PARTICLE_FLOATS = 16;
const PARTICLE_BYTES = PARTICLE_FLOATS * 4;
const INTERFACE_RECORD_FLOATS = 20;
const INTERFACE_RECORD_BYTES = INTERFACE_RECORD_FLOATS * 4;
const LIQUID_FIRE_CONTACT_RECORD_FLOATS = 32;
const LIQUID_FIRE_CONTACT_RECORD_BYTES = LIQUID_FIRE_CONTACT_RECORD_FLOATS * 4;
const LIQUID_FIRE_CONTACT_HEADER_WORDS = 20;
const LIQUID_FIRE_CONTACT_HEADER_BYTES = LIQUID_FIRE_CONTACT_HEADER_WORDS * 4;
const LIQUID_FIRE_CONTACT_MAGIC = 0x4b4c4643;
const LIQUID_FIRE_CONTACT_VERSION = 1;
const LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID = 'kaminos/finger-fluid-bench:gpu-simulation-frame';
const LIQUID_FIRE_CONTACT_SOURCE_FRAME_HASH = 0x6c2673d1;
const INTERFACE_SAMPLE_COUNT = 16;
const WORKGROUP_SIZE = 64;
const DEFAULT_PARTICLE_COUNT = KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT;
const LAMINAR_SOURCE_REFERENCE_FPS = 60;
const LAMINAR_SOURCE_AXIAL_SPACING = 0.055;
const LAMINAR_SOURCE_PARTICLE_VOLUME = LAMINAR_SOURCE_AXIAL_SPACING ** 3;
const MAX_FLUID_SPEED = 3.2;
const GRID_DIMS = [32, 20, 32];
const GRID_CELL_COUNT = GRID_DIMS[0] * GRID_DIMS[1] * GRID_DIMS[2];
const BOUNDS_MIN = [-3.4, -1.2, -3.4];
const BOUNDS_MAX = [3.4, 3.0, 3.4];
const TRUTH_OCCUPIED_CELL_VOLUME = GRID_DIMS.reduce(
  (volume, count, axis) => volume * ((BOUNDS_MAX[axis] - BOUNDS_MIN[axis]) / count),
  1,
);
const MIN_TRUTH_OCCUPIED_CELL_COUNT = 2;
const MIN_TRUTH_OCCUPIED_VOLUME = MIN_TRUTH_OCCUPIED_CELL_COUNT * TRUTH_OCCUPIED_CELL_VOLUME;
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
const ANALYTIC_SUPPORT_GRID_COLUMNS = 64;
const ANALYTIC_SUPPORT_GRID_ROWS = 64;
const ANALYTIC_SUPPORT_TERRAIN_VERTEX_COUNT = ANALYTIC_SUPPORT_GRID_COLUMNS * ANALYTIC_SUPPORT_GRID_ROWS * 6;
const ANALYTIC_SUPPORT_SPHERE_COLUMNS = 24;
const ANALYTIC_SUPPORT_SPHERE_ROWS = 12;
const ANALYTIC_SUPPORT_SPHERE_VERTEX_COUNT = ANALYTIC_SUPPORT_SPHERE_COLUMNS * ANALYTIC_SUPPORT_SPHERE_ROWS * 6;
const ANALYTIC_SUPPORT_BASE_VERTEX_COUNT = ANALYTIC_SUPPORT_TERRAIN_VERTEX_COUNT + ANALYTIC_SUPPORT_SPHERE_VERTEX_COUNT;
const ANALYTIC_SUPPORT_ROUND_INLET_COLUMNS = 24;
const ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT = ANALYTIC_SUPPORT_ROUND_INLET_COLUMNS * 6;
const ANALYTIC_SUPPORT_SLOT_INLET_VERTEX_COUNT = 4 * 6;
// homogenized_visual_boundary_not_resolved_pore_geometry
const ANALYTIC_SUPPORT_POROUS_INLET_VERTEX_COUNT = 6 * 6;
const ANALYTIC_SUPPORT_INLET_FIXTURE_VERTEX_COUNT = ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT
  + ANALYTIC_SUPPORT_SLOT_INLET_VERTEX_COUNT
  + ANALYTIC_SUPPORT_POROUS_INLET_VERTEX_COUNT;
const INTERFACE_THRESHOLD = 0.32;
const INTERFACE_ENTER_THRESHOLD = 0.38;
const INTERFACE_EXIT_THRESHOLD = 0.22;
const REST_STATE_FLOATS = 4;
const REST_STATE_BYTES = REST_STATE_FLOATS * 4;
const NEIGHBOR_TOPOLOGY_WORDS = 8;
const NEIGHBOR_TOPOLOGY_BYTES = NEIGHBOR_TOPOLOGY_WORDS * 4;
const MATERIAL_TRACER_FLOATS = 4;
const MATERIAL_TRACER_BYTES = MATERIAL_TRACER_FLOATS * 4;
const ENERGY_RECORD_FLOATS = 4;
const ENERGY_RECORD_BYTES = ENERGY_RECORD_FLOATS * 4;
const INVALID_NEIGHBOR_ID = 0xffffffff;
let nextLiquidFireContactAllocationGeneration = 1;

export const KAMINOS_FINGER_FLUID_COLOR_MODES = Object.freeze(['phase', 'particle_id', 'speed', 'density', 'surface', 'neighbor_retention', 'chemistry']);
export const KAMINOS_FINGER_FLUID_TRUTH_SCENES = Object.freeze(['multi_regime_playground', 'deep_pool_rest', 'dam_break', 'laminar_inlets']);
export const KAMINOS_FINGER_FLUID_INLET_PROFILES = Object.freeze(['round_poiseuille', 'slot_poiseuille', 'porous_darcy']);
export const KAMINOS_FINGER_FLUID_RENDERER_MODES = Object.freeze(['screen_space_surface', 'screen_space_refraction', 'sphere_debug']);
export const KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES = Object.freeze(['shaded', 'depth', 'entry_depth', 'normal', 'exit_depth', 'exit_normal', 'thickness', 'path_length', 'exit_validity', 'refraction_offset', 'fresnel', 'absorption']);

export function resolveFingerFluidColorMode(value = 'phase') {
  const mode = String(value || 'phase');
  if (!KAMINOS_FINGER_FLUID_COLOR_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid color mode: ${mode}`);
  }
  return mode;
}

export function resolveFingerFluidTruthScene(value = 'multi_regime_playground') {
  const scene = String(value || 'multi_regime_playground');
  if (!KAMINOS_FINGER_FLUID_TRUTH_SCENES.includes(scene)) {
    throw new RangeError(`Unsupported finger fluid truth scene: ${scene}`);
  }
  return scene;
}

export function resolveFingerFluidParticleCount(value = KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT) {
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new TypeError(`Finger fluid particle count must be a safe integer: ${value}`);
  }
  if (count < 1024) {
    throw new RangeError(`Finger fluid particle count must be at least 1024: ${count}`);
  }
  return count;
}

const PARTICLE_ALLOCATION_BUFFER_DESCRIPTORS = Object.freeze([
  { label: 'liquid-fire-contact-records', bytesPerParticle: LIQUID_FIRE_CONTACT_RECORD_BYTES, storage: true },
  { label: 'interface-records', bytesPerParticle: INTERFACE_RECORD_BYTES, storage: true },
  { label: 'particles', bytesPerParticle: PARTICLE_BYTES, storage: true },
  { label: 'neighbor-topology', bytesPerParticle: NEIGHBOR_TOPOLOGY_BYTES, storage: true },
  { label: 'energy-diagnostics', bytesPerParticle: ENERGY_RECORD_BYTES, storage: true },
  { label: 'rest-state', bytesPerParticle: REST_STATE_BYTES, storage: true },
  { label: 'material-tracers', bytesPerParticle: MATERIAL_TRACER_BYTES, storage: true },
  { label: 'particle-next', bytesPerParticle: 4, storage: true },
  { label: 'diagnostics-readback', bytesPerParticle: PARTICLE_BYTES, storage: false },
  { label: 'interface-records-readback', bytesPerParticle: INTERFACE_RECORD_BYTES, storage: false },
  { label: 'neighbor-topology-readback', bytesPerParticle: NEIGHBOR_TOPOLOGY_BYTES, storage: false },
  { label: 'energy-diagnostics-readback', bytesPerParticle: ENERGY_RECORD_BYTES, storage: false },
  { label: 'rest-state-readback', bytesPerParticle: REST_STATE_BYTES, storage: false },
  { label: 'material-tracers-readback', bytesPerParticle: MATERIAL_TRACER_BYTES, storage: false },
]);

export function measureFingerFluidParticleAllocationCapacity(limits = {}) {
  const maxBufferSize = Number(limits.maxBufferSize);
  const maxStorageBufferBindingSize = Number(limits.maxStorageBufferBindingSize);
  if (!Number.isSafeInteger(maxBufferSize) || maxBufferSize <= 0) {
    throw new TypeError(`Finger fluid allocation preflight requires a positive safe maxBufferSize: ${limits.maxBufferSize}`);
  }
  if (!Number.isSafeInteger(maxStorageBufferBindingSize) || maxStorageBufferBindingSize <= 0) {
    throw new TypeError(`Finger fluid allocation preflight requires a positive safe maxStorageBufferBindingSize: ${limits.maxStorageBufferBindingSize}`);
  }
  const buffers = PARTICLE_ALLOCATION_BUFFER_DESCRIPTORS.map(descriptor => {
    const bindingLimitBytes = descriptor.storage
      ? Math.min(maxBufferSize, maxStorageBufferBindingSize)
      : maxBufferSize;
    return {
      ...descriptor,
      bindingLimitBytes,
      maximumParticleCount: Math.floor(bindingLimitBytes / descriptor.bytesPerParticle),
    };
  });
  const limiting = buffers.reduce((minimum, buffer) => (
    buffer.maximumParticleCount < minimum.maximumParticleCount ? buffer : minimum
  ));
  return {
    contract: KAMINOS_FINGER_FLUID_PARTICLE_ALLOCATION_PREFLIGHT_CONTRACT,
    maxBufferSize,
    maxStorageBufferBindingSize,
    maximumSupportedParticleCount: limiting.maximumParticleCount,
    limitingBuffer: limiting.label,
    limitingBytesPerParticle: limiting.bytesPerParticle,
    buffers,
  };
}

export function evaluateFingerFluidParticleAllocationRequest(particleCount, capacity) {
  const requestedParticleCount = resolveFingerFluidParticleCount(particleCount);
  if (capacity?.contract !== KAMINOS_FINGER_FLUID_PARTICLE_ALLOCATION_PREFLIGHT_CONTRACT
    || !Number.isSafeInteger(capacity?.maximumSupportedParticleCount)
    || capacity.maximumSupportedParticleCount <= 0) {
    throw new TypeError(`Finger fluid allocation request requires measured device capacity: ${JSON.stringify(capacity)}`);
  }
  const ok = requestedParticleCount <= capacity.maximumSupportedParticleCount;
  return {
    contract: KAMINOS_FINGER_FLUID_PARTICLE_ALLOCATION_PREFLIGHT_CONTRACT,
    requestedParticleCount,
    effectiveParticleCount: ok ? requestedParticleCount : null,
    maximumSupportedParticleCount: capacity.maximumSupportedParticleCount,
    limitingBuffer: capacity.limitingBuffer,
    limitingBytesPerParticle: capacity.limitingBytesPerParticle,
    maxBufferSize: capacity.maxBufferSize,
    maxStorageBufferBindingSize: capacity.maxStorageBufferBindingSize,
    ok,
    reason: ok
      ? null
      : `Finger fluid particle count ${requestedParticleCount} exceeds device-derived maximum ${capacity.maximumSupportedParticleCount} (${capacity.limitingBuffer}, ${capacity.limitingBytesPerParticle} bytes per particle)`,
  };
}

function normalizeFingerFluidInletVector(vector, label) {
  if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) {
    throw new TypeError(`Finger fluid inlet ${label} must be a finite 3D vector`);
  }
  const length = Math.hypot(...vector);
  if (length <= 1e-9) throw new TypeError(`Finger fluid inlet ${label} must be nonzero`);
  return vector.map(value => value / length);
}

export function createFingerFluidLaminarInletDescriptors() {
  const raw = [
    {
      id: 'round-spout',
      profile: 'round_poiseuille',
      origin: [-1.34, 0.58, -2.30],
      axis: [0, -0.22, 0.975499871],
      tangent: [1, 0, 0],
      radius: 0.30,
      maximumSpeed: 0.92,
      reservoirLength: 0.48,
      mouthTransitionLength: 0.18,
      laneCount: 72,
      phase: 0.08,
    },
    {
      id: 'slot-spout',
      profile: 'slot_poiseuille',
      origin: [0, 0.62, -2.32],
      axis: [0, -0.18, 0.98366661],
      tangent: [1, 0, 0],
      halfWidth: 0.48,
      halfHeight: 0.13,
      maximumSpeed: 0.72,
      reservoirLength: 0.42,
      mouthTransitionLength: 0.16,
      laneColumns: 15,
      laneRows: 4,
      laneCount: 60,
      phase: 0.48,
    },
    {
      id: 'porous-patch',
      profile: 'porous_darcy',
      origin: [1.34, 0.26, -2.24],
      axis: [0, -0.08, 0.996794864],
      tangent: [1, 0, 0],
      halfWidth: 0.46,
      halfHeight: 0.34,
      maximumSpeed: 0.22,
      reservoirLength: 0.28,
      mouthTransitionLength: 0.14,
      laneColumns: 16,
      laneRows: 11,
      laneCount: 176,
      phase: 0.82,
      resolutionMode: 'homogenized_sub_kernel_porous_flux',
    },
  ];
  return raw.map(descriptor => Object.freeze({
    ...descriptor,
    origin: Object.freeze([...descriptor.origin]),
    axis: Object.freeze(normalizeFingerFluidInletVector(descriptor.axis, `${descriptor.id} axis`)),
    tangent: Object.freeze(normalizeFingerFluidInletVector(descriptor.tangent, `${descriptor.id} tangent`)),
  }));
}

function validateFingerFluidLaminarInletDescriptor(descriptor) {
  if (!descriptor || !KAMINOS_FINGER_FLUID_INLET_PROFILES.includes(descriptor.profile)) {
    throw new TypeError(`Unsupported finger fluid inlet profile: ${descriptor?.profile}`);
  }
  if (!Number.isFinite(descriptor.maximumSpeed) || descriptor.maximumSpeed < 0) {
    throw new RangeError(`Finger fluid inlet maximum speed must be finite and nonnegative: ${descriptor.maximumSpeed}`);
  }
  return descriptor;
}

export function evaluateFingerFluidLaminarInletProfile(descriptor, localCoordinates) {
  validateFingerFluidLaminarInletDescriptor(descriptor);
  if (!Array.isArray(localCoordinates) || localCoordinates.length !== 2 || !localCoordinates.every(Number.isFinite)) {
    throw new TypeError('Finger fluid inlet profile requires finite aperture-local coordinates');
  }
  const [u, v] = localCoordinates;
  let inside = false;
  let normalizedRadius = Infinity;
  let profileWeight = 0;
  let resolutionMode = 'resolved_aperture_profile';
  if (descriptor.profile === 'round_poiseuille') {
    normalizedRadius = Math.hypot(u, v) / descriptor.radius;
    inside = normalizedRadius <= 1;
    profileWeight = inside ? Math.max(0, 1 - normalizedRadius ** 2) : 0;
  } else {
    inside = Math.abs(u) <= descriptor.halfWidth && Math.abs(v) <= descriptor.halfHeight;
    if (descriptor.profile === 'slot_poiseuille') {
      normalizedRadius = Math.abs(v) / descriptor.halfHeight;
      profileWeight = inside ? Math.max(0, 1 - normalizedRadius ** 2) : 0;
    } else {
      normalizedRadius = inside ? 0 : Infinity;
      profileWeight = inside ? 1 : 0;
      resolutionMode = 'homogenized_sub_kernel_porous_flux';
    }
  }
  return {
    profile: descriptor.profile,
    inside,
    normalizedRadius,
    profileWeight,
    axialSpeed: descriptor.maximumSpeed * profileWeight,
    resolutionMode,
  };
}

export function measureFingerFluidLaminarInletFlux(descriptor) {
  validateFingerFluidLaminarInletDescriptor(descriptor);
  if (descriptor.profile === 'round_poiseuille') {
    return Math.PI * descriptor.radius ** 2 * descriptor.maximumSpeed * 0.5;
  }
  if (descriptor.profile === 'slot_poiseuille') {
    return (8 / 3) * descriptor.halfWidth * descriptor.halfHeight * descriptor.maximumSpeed;
  }
  return 4 * descriptor.halfWidth * descriptor.halfHeight * descriptor.maximumSpeed;
}

export function evaluateFingerFluidLaminarInletBoundaryBlend(descriptor, axialPosition) {
  validateFingerFluidLaminarInletDescriptor(descriptor);
  if (!Number.isFinite(axialPosition)) throw new TypeError(`Finger fluid inlet boundary blend requires a finite axial position: ${axialPosition}`);
  const transitionStart = -Math.min(0.08, descriptor.reservoirLength * 0.25);
  const transitionEnd = descriptor.mouthTransitionLength;
  const normalized = clamp((axialPosition - transitionStart) / Math.max(1e-9, transitionEnd - transitionStart), 0, 1);
  const smooth = normalized * normalized * (3 - 2 * normalized);
  return {
    transitionStart,
    transitionEnd,
    profileWeight: 1 - smooth,
  };
}

export function measureFingerFluidLaminarInletDiagnostics(
  particleData,
  particleCount,
  descriptors = createFingerFluidLaminarInletDescriptors(),
) {
  const count = Math.max(0, Math.min(
    Math.floor(finite(particleCount, 0)),
    Math.floor((particleData?.length || 0) / PARTICLE_FLOATS),
  ));
  if (descriptors.length !== KAMINOS_FINGER_FLUID_INLET_PROFILES.length) {
    throw new RangeError(`Finger fluid laminar diagnostics require exactly three inlet descriptors: ${descriptors.length}`);
  }
  const expectedParticleCounts = Array(descriptors.length).fill(0);
  for (let index = 0; index < count; index += 1) {
    expectedParticleCounts[allocateFingerFluidLaminarInletParticle(index).sourceIndex] += 1;
  }
  const accumulators = descriptors.map((descriptor, sourceIndex) => ({
    descriptor,
    sourceIndex,
    taggedParticleCount: 0,
    activeParticleCount: 0,
    dormantParticleCount: 0,
    sourceLeakParticleCount: 0,
    inletCoreParticleCount: 0,
    mouthParticleCount: 0,
    positiveAxialFlowCount: 0,
    axialSpeedSum: 0,
    crossflowSpeedSum: 0,
    profileErrorSquaredSum: 0,
    expectedSpeedSquaredSum: 0,
    expectedActualSpeedProductSum: 0,
  }));
  for (let index = 0; index < count; index += 1) {
    const offset = index * PARTICLE_FLOATS;
    const signedPhase = particleData[offset + 11];
    const phase = Math.abs(signedPhase);
    const active = signedPhase >= 0;
    const sourceIndex = phase < 0.28 ? 0 : phase < 0.68 ? 1 : 2;
    const accumulator = accumulators[sourceIndex];
    const { descriptor } = accumulator;
    const position = [particleData[offset], particleData[offset + 1], particleData[offset + 2]];
    const velocity = [particleData[offset + 8], particleData[offset + 9], particleData[offset + 10]];
    const relative = position.map((value, axis) => value - descriptor.origin[axis]);
    const bitangent = normalizeFingerFluidInletVector([
      descriptor.axis[1] * descriptor.tangent[2] - descriptor.axis[2] * descriptor.tangent[1],
      descriptor.axis[2] * descriptor.tangent[0] - descriptor.axis[0] * descriptor.tangent[2],
      descriptor.axis[0] * descriptor.tangent[1] - descriptor.axis[1] * descriptor.tangent[0],
    ], `${descriptor.id} diagnostic bitangent`);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const axialPosition = dot(relative, descriptor.axis);
    const localCoordinates = [dot(relative, descriptor.tangent), dot(relative, bitangent)];
    const profile = evaluateFingerFluidLaminarInletProfile(descriptor, localCoordinates);
    const actualAxialSpeed = dot(velocity, descriptor.axis);
    const crossflowVelocity = velocity.map((value, axis) => value - descriptor.axis[axis] * actualAxialSpeed);
    const crossflowSpeed = Math.hypot(...crossflowVelocity);
    const insideCore = profile.inside
      && axialPosition >= -descriptor.reservoirLength - 0.02
      && axialPosition <= 0.015;
    accumulator.taggedParticleCount += 1;
    if (!active) {
      accumulator.dormantParticleCount += 1;
      continue;
    }
    accumulator.activeParticleCount += 1;
    if (
      axialPosition >= -descriptor.reservoirLength - 0.02
      && axialPosition <= 0
      && !profile.inside
    ) {
      accumulator.sourceLeakParticleCount += 1;
    }
    if (profile.inside && axialPosition >= -0.08 && axialPosition <= 0.18) accumulator.mouthParticleCount += 1;
    if (!insideCore) continue;
    accumulator.inletCoreParticleCount += 1;
    accumulator.axialSpeedSum += actualAxialSpeed;
    accumulator.crossflowSpeedSum += crossflowSpeed;
    if (actualAxialSpeed >= -1e-5) accumulator.positiveAxialFlowCount += 1;
    const profileError = actualAxialSpeed - profile.axialSpeed;
    accumulator.profileErrorSquaredSum += profileError * profileError;
    accumulator.expectedSpeedSquaredSum += profile.axialSpeed * profile.axialSpeed;
    accumulator.expectedActualSpeedProductSum += profile.axialSpeed * actualAxialSpeed;
  }
  const inlets = accumulators.map(accumulator => {
    const {
      descriptor,
      sourceIndex,
      taggedParticleCount,
      activeParticleCount,
      dormantParticleCount,
      sourceLeakParticleCount,
      inletCoreParticleCount,
      mouthParticleCount,
      positiveAxialFlowCount,
      axialSpeedSum,
      crossflowSpeedSum,
      profileErrorSquaredSum,
      expectedSpeedSquaredSum,
      expectedActualSpeedProductSum,
    } = accumulator;
    const expectedFlux = measureFingerFluidLaminarInletFlux(descriptor);
    const effectiveFluxGain = expectedSpeedSquaredSum > 1e-12
      ? expectedActualSpeedProductSum / expectedSpeedSquaredSum
      : 0;
    return {
      id: descriptor.id,
      profile: descriptor.profile,
      resolutionMode: descriptor.resolutionMode || 'resolved_aperture_profile',
      sourceIndex,
      expectedParticleCount: expectedParticleCounts[sourceIndex],
      taggedParticleCount,
      activeParticleCount,
      dormantParticleCount,
      sourceLeakParticleCount,
      allocationErrorRatio: Number((Math.abs(taggedParticleCount - expectedParticleCounts[sourceIndex]) / Math.max(1, expectedParticleCounts[sourceIndex])).toFixed(6)),
      inletCoreParticleCount,
      mouthParticleCount,
      meanAxialSpeed: Number((axialSpeedSum / Math.max(1, inletCoreParticleCount)).toFixed(6)),
      meanCrossflowRatio: Number((crossflowSpeedSum / Math.max(1, inletCoreParticleCount) / Math.max(descriptor.maximumSpeed, 1e-9)).toFixed(6)),
      positiveAxialFlowRatio: Number((positiveAxialFlowCount / Math.max(1, inletCoreParticleCount)).toFixed(6)),
      profileNormalizedRmse: Number((Math.sqrt(profileErrorSquaredSum / Math.max(1, inletCoreParticleCount)) / Math.max(descriptor.maximumSpeed, 1e-9)).toFixed(6)),
      effectiveFluxGain: Number(effectiveFluxGain.toFixed(6)),
      expectedFlux: Number(expectedFlux.toFixed(6)),
      measuredFlux: Number((expectedFlux * effectiveFluxGain).toFixed(6)),
      fluxRelativeError: Number(Math.abs(effectiveFluxGain - 1).toFixed(6)),
    };
  });
  return {
    schema: 'kaminos.finger-fluid.laminar-inlet-diagnostics.v0',
    contract: KAMINOS_FINGER_FLUID_LAMINAR_INLET_CONTRACT,
    particleCount: count,
    accountedParticleCount: inlets.reduce((sum, inlet) => sum + inlet.taggedParticleCount, 0),
    inlets,
  };
}

const FINGER_FLUID_LAMINAR_INLET_ALLOCATION = Object.freeze([0, 0, 0, 0, 1, 1, 1, 2, 2, 2]);

function countFingerFluidLaminarInletParticles(particleCount) {
  const count = Math.max(0, Math.floor(finite(particleCount, 0)));
  const completeBlocks = Math.floor(count / FINGER_FLUID_LAMINAR_INLET_ALLOCATION.length);
  const remainder = count % FINGER_FLUID_LAMINAR_INLET_ALLOCATION.length;
  return [
    completeBlocks * 4 + Math.min(remainder, 4),
    completeBlocks * 3 + Math.min(Math.max(remainder - 4, 0), 3),
    completeBlocks * 3 + Math.min(Math.max(remainder - 7, 0), 3),
  ];
}

export function allocateFingerFluidLaminarInletParticle(index) {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError(`Finger fluid inlet particle index must be a nonnegative integer: ${index}`);
  const allocationSlot = index % FINGER_FLUID_LAMINAR_INLET_ALLOCATION.length;
  const completeBlocks = Math.floor(index / FINGER_FLUID_LAMINAR_INLET_ALLOCATION.length);
  const sourceIndex = FINGER_FLUID_LAMINAR_INLET_ALLOCATION[allocationSlot];
  const localRank = sourceIndex === 0 ? allocationSlot : sourceIndex === 1 ? allocationSlot - 4 : allocationSlot - 7;
  const particlesPerBlock = sourceIndex === 0 ? 4 : 3;
  return {
    sourceIndex,
    localOrdinal: completeBlocks * particlesPerBlock + localRank,
  };
}

function sampleFingerFluidLaminarInletLane(descriptor, laneIndex) {
  if (descriptor.profile === 'round_poiseuille') {
    const radius = descriptor.radius * 0.86 * Math.sqrt((laneIndex + 0.5) / descriptor.laneCount);
    const angle = laneIndex * 2.39996322973;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }
  const column = laneIndex % descriptor.laneColumns;
  const row = Math.floor(laneIndex / descriptor.laneColumns);
  return [
    (((column + 0.5) / descriptor.laneColumns) * 2 - 1) * descriptor.halfWidth * 0.92,
    (((row + 0.5) / descriptor.laneRows) * 2 - 1) * descriptor.halfHeight * 0.88,
  ];
}

function createFingerFluidLaminarInletReleaseSchedule(index, descriptors, particleCount) {
  const allocation = allocateFingerFluidLaminarInletParticle(index);
  const descriptor = validateFingerFluidLaminarInletDescriptor(descriptors[allocation.sourceIndex]);
  const localOrdinal = allocation.localOrdinal;
  const laneIndex = localOrdinal % descriptor.laneCount;
  const laneOrdinal = Math.floor(localOrdinal / descriptor.laneCount);
  const [u, v] = sampleFingerFluidLaminarInletLane(descriptor, laneIndex);
  const profile = evaluateFingerFluidLaminarInletProfile(descriptor, [u, v]);
  const sourceParticleCounts = countFingerFluidLaminarInletParticles(particleCount);
  const sourceParticleCount = sourceParticleCounts[allocation.sourceIndex];
  const laneParticleCount = Math.floor((sourceParticleCount - 1 - laneIndex) / descriptor.laneCount) + 1;
  let laneSpeedSum = 0;
  for (let lane = 0; lane < descriptor.laneCount; lane += 1) {
    laneSpeedSum += evaluateFingerFluidLaminarInletProfile(descriptor, sampleFingerFluidLaminarInletLane(descriptor, lane)).axialSpeed;
  }
  const expectedReleaseRate = measureFingerFluidLaminarInletFlux(descriptor) / LAMINAR_SOURCE_PARTICLE_VOLUME;
  const laneReleaseRate = expectedReleaseRate * profile.axialSpeed / Math.max(laneSpeedSum, 1e-9);
  const releasePeriodFrames = Math.max(1, Math.round(LAMINAR_SOURCE_REFERENCE_FPS / Math.max(laneReleaseRate, 1e-9)));
  const cycleFrames = Math.max(1, laneParticleCount * releasePeriodFrames);
  const lanePhaseOffset = Math.floor((laneIndex + 0.5) * releasePeriodFrames / descriptor.laneCount);
  const releaseFrame = laneOrdinal * releasePeriodFrames + lanePhaseOffset;
  const ageFramesAtStart = releaseFrame === 0 ? 0 : cycleFrames - releaseFrame;
  const ageSecondsAtStart = ageFramesAtStart / LAMINAR_SOURCE_REFERENCE_FPS;
  const initialAxialPosition = -descriptor.reservoirLength + LAMINAR_SOURCE_AXIAL_SPACING * 0.5 + profile.axialSpeed * ageSecondsAtStart;
  const activeAtFrameZero = initialAxialPosition <= 0;
  return {
    ...allocation,
    descriptor,
    laneIndex,
    laneOrdinal,
    localCoordinates: [u, v],
    profile,
    sourceParticleCount,
    laneParticleCount,
    laneSpeedSum,
    expectedReleaseRate,
    laneReleaseRate,
    releasePeriodFrames,
    lanePhaseOffset,
    cycleFrames,
    releaseFrame,
    ageFramesAtStart,
    initialAxialPosition,
    activeAtFrameZero,
  };
}

export function sampleFingerFluidLaminarInletParticle(index, descriptors = createFingerFluidLaminarInletDescriptors(), {
  particleCount = DEFAULT_PARTICLE_COUNT,
} = {}) {
  const schedule = createFingerFluidLaminarInletReleaseSchedule(index, descriptors, particleCount);
  const {
    descriptor,
    sourceIndex,
    localOrdinal,
    laneIndex,
    laneOrdinal,
    localCoordinates: [u, v],
    profile,
    releasePeriodFrames,
    cycleFrames,
    releaseFrame,
    activeAtFrameZero,
    initialAxialPosition,
  } = schedule;
  const axis = descriptor.axis;
  const tangent = descriptor.tangent;
  const bitangent = normalizeFingerFluidInletVector([
    axis[1] * tangent[2] - axis[2] * tangent[1],
    axis[2] * tangent[0] - axis[0] * tangent[2],
    axis[0] * tangent[1] - axis[1] * tangent[0],
  ], `${descriptor.id} bitangent`);
  const axialPosition = activeAtFrameZero
    ? initialAxialPosition
    : -descriptor.reservoirLength + LAMINAR_SOURCE_AXIAL_SPACING * 0.5;
  const position = descriptor.origin.map((value, component) => (
    value + tangent[component] * u + bitangent[component] * v + axis[component] * axialPosition
  ));
  const velocity = axis.map(value => value * profile.axialSpeed);
  return {
    sourceIndex,
    localOrdinal,
    laneIndex,
    laneOrdinal,
    profile: descriptor.profile,
    phase: descriptor.phase,
    activeAtFrameZero,
    releasePeriodFrames,
    cycleFrames,
    releaseFrame,
    position,
    velocity,
    localCoordinates: [u, v],
    profileWeight: profile.profileWeight,
  };
}

export function createFingerFluidLaminarSourcePopulation(
  particleCount = DEFAULT_PARTICLE_COUNT,
  descriptors = createFingerFluidLaminarInletDescriptors(),
) {
  const count = Math.max(1, Math.floor(finite(particleCount, DEFAULT_PARTICLE_COUNT)));
  const sourceParticleCounts = countFingerFluidLaminarInletParticles(count);
  const sources = descriptors.map((descriptor, sourceIndex) => ({
    descriptor,
    sourceIndex,
    particleCount: sourceParticleCounts[sourceIndex],
    initialActivePositions: [],
    releasePeriods: new Map(),
    cycleFrames: [],
  }));
  for (let index = 0; index < count; index += 1) {
    const sample = sampleFingerFluidLaminarInletParticle(index, descriptors, { particleCount: count });
    const source = sources[sample.sourceIndex];
    source.releasePeriods.set(sample.laneIndex, sample.releasePeriodFrames);
    source.cycleFrames.push(sample.cycleFrames);
    if (sample.activeAtFrameZero) source.initialActivePositions.push(sample.position);
  }
  return {
    contract: KAMINOS_FINGER_FLUID_LAMINAR_SOURCE_POPULATION_CONTRACT,
    particleCount: count,
    referenceFps: LAMINAR_SOURCE_REFERENCE_FPS,
    axialSpacing: LAMINAR_SOURCE_AXIAL_SPACING,
    particleVolume: LAMINAR_SOURCE_PARTICLE_VOLUME,
    sources: sources.map(source => {
      let minimumInitialActiveSeparation = Infinity;
      const uniquePositions = new Set();
      for (let index = 0; index < source.initialActivePositions.length; index += 1) {
        const position = source.initialActivePositions[index];
        uniquePositions.add(position.map(value => value.toFixed(9)).join(','));
        for (let other = index + 1; other < source.initialActivePositions.length; other += 1) {
          minimumInitialActiveSeparation = Math.min(
            minimumInitialActiveSeparation,
            Math.hypot(...position.map((value, axis) => value - source.initialActivePositions[other][axis])),
          );
        }
      }
      const measuredReleaseRate = [...source.releasePeriods.values()]
        .reduce((sum, period) => sum + LAMINAR_SOURCE_REFERENCE_FPS / period, 0);
      const expectedReleaseRate = measureFingerFluidLaminarInletFlux(source.descriptor) / LAMINAR_SOURCE_PARTICLE_VOLUME;
      const minimumCycleFrames = Math.min(...source.cycleFrames);
      const minimumProfileSpeed = Math.min(...Array.from({ length: source.descriptor.laneCount }, (_, lane) => (
        evaluateFingerFluidLaminarInletProfile(source.descriptor, sampleFingerFluidLaminarInletLane(source.descriptor, lane)).axialSpeed
      )));
      const reservoirResidenceFrames = Math.ceil(
        source.descriptor.reservoirLength / Math.max(minimumProfileSpeed, 1e-9) * LAMINAR_SOURCE_REFERENCE_FPS,
      );
      const initialActiveCount = source.initialActivePositions.length;
      return {
        id: source.descriptor.id,
        sourceIndex: source.sourceIndex,
        particleCount: source.particleCount,
        initialActiveCount,
        initialDormantCount: source.particleCount - initialActiveCount,
        reservoirCapacity: source.descriptor.laneCount * (Math.ceil(source.descriptor.reservoirLength / LAMINAR_SOURCE_AXIAL_SPACING) + 1),
        uniqueInitialActivePositionCount: uniquePositions.size,
        minimumInitialActiveSeparation: Number((Number.isFinite(minimumInitialActiveSeparation) ? minimumInitialActiveSeparation : 0).toFixed(6)),
        expectedReleaseRate: Number(expectedReleaseRate.toFixed(6)),
        measuredReleaseRate: Number(measuredReleaseRate.toFixed(6)),
        releaseRateRelativeError: Number((Math.abs(measuredReleaseRate - expectedReleaseRate) / expectedReleaseRate).toFixed(6)),
        cycleFrames: minimumCycleFrames,
        reservoirResidenceFrames,
      };
    }),
  };
}

export function resolveFingerFluidRendererMode(value = 'screen_space_surface') {
  const mode = String(value || 'screen_space_surface');
  if (!KAMINOS_FINGER_FLUID_RENDERER_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid renderer mode: ${mode}`);
  }
  return mode;
}

export function validateFingerFluidTruthRendererState(requestedMode, runtime) {
  const expectedMode = resolveFingerFluidRendererMode(requestedMode);
  if (!runtime || typeof runtime !== 'object') {
    throw new Error('Finger fluid truth renderer state is missing');
  }
  const expectedRenderer = rendererRouteForMode(expectedMode);
  if (runtime.requestedRendererMode !== expectedMode || runtime.effectiveRendererMode !== expectedMode) {
    throw new Error(`Finger fluid truth renderer mode disagreement: ${JSON.stringify({
      expectedMode,
      requestedRendererMode: runtime.requestedRendererMode,
      effectiveRendererMode: runtime.effectiveRendererMode,
    })}`);
  }
  if (runtime.requestedRenderer !== expectedRenderer || runtime.effectiveRenderer !== expectedRenderer) {
    throw new Error(`Finger fluid truth renderer identity disagreement: ${JSON.stringify({
      expectedRenderer,
      requestedRenderer: runtime.requestedRenderer,
      effectiveRenderer: runtime.effectiveRenderer,
    })}`);
  }
  if (runtime.fallbackReason) {
    throw new Error(`Finger fluid truth renderer fallback is not accepted: ${runtime.fallbackReason}`);
  }

  const supportPresentationEvidence = runtime.supportPresentationEvidence;
  if (
    supportPresentationEvidence?.route !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE
    || supportPresentationEvidence?.depthRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE
    || supportPresentationEvidence?.colorDepthAuthority !== 'same_pass_same_analytic_geometry_v0'
    || supportPresentationEvidence?.refractionCaptureOrder !== 'copy_after_analytic_support_presentation_v0'
    || !Number.isInteger(supportPresentationEvidence?.passCount)
    || supportPresentationEvidence.passCount <= 0
    || supportPresentationEvidence?.particleSupportDrawCount !== 0
  ) {
    throw new Error(`Finger fluid truth support presentation evidence is missing or partial: ${JSON.stringify(supportPresentationEvidence)}`);
  }

  let screenSpaceSurfaceEvidence = null;
  if (expectedMode === 'screen_space_surface') {
    const evidence = runtime.screenSpaceSurfaceEvidence;
    if (
      evidence?.route !== KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE
      || evidence?.shaderRoute !== KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE
      || evidence?.supportDepthRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE
      || !Number.isInteger(evidence?.analyticSupportDepthPassCount)
      || evidence.analyticSupportDepthPassCount <= 0
      || !Number.isInteger(evidence?.accumulationPassCount)
      || evidence.accumulationPassCount <= 0
      || !Number.isInteger(evidence?.compositePassCount)
      || evidence.compositePassCount <= 0
    ) {
      throw new Error(`Finger fluid truth screen-space renderer evidence is missing or partial: ${JSON.stringify(evidence)}`);
    }
    screenSpaceSurfaceEvidence = {
      ...evidence,
    };
  }

  let refractionEvidence = null;
  if (expectedMode === 'screen_space_refraction') {
    const evidence = runtime.refractionEvidence;
    if (
      evidence?.route !== KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE
      || evidence?.shaderRoute !== KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE
      || evidence?.opticalTransportRoute !== KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE
      || evidence?.slabRoute !== KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE
      || evidence?.supportDepthRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE
      || !Number.isInteger(evidence?.analyticSupportDepthPassCount)
      || evidence.analyticSupportDepthPassCount <= 0
      || !Number.isInteger(evidence?.scenePassCount)
      || evidence.scenePassCount <= 0
      || !Number.isInteger(evidence?.slabGeometryPassCount)
      || evidence.slabGeometryPassCount <= 0
      || evidence?.frontDepthTexture?.format !== 'rgba16float'
      || evidence?.backDepthTexture?.format !== 'rgba16float'
      || evidence?.invalidSlabDisposition !== 'entry_interface_only_no_exit_claim_v0'
      || !Number.isInteger(evidence?.accumulationPassCount)
      || evidence.accumulationPassCount <= 0
      || !Number.isInteger(evidence?.compositePassCount)
      || evidence.compositePassCount <= 0
    ) {
      throw new Error(`Finger fluid truth refraction renderer evidence is missing or partial: ${JSON.stringify(evidence)}`);
    }
    refractionEvidence = {
      ...evidence,
    };
  }

  return {
    requestedRendererMode: runtime.requestedRendererMode,
    effectiveRendererMode: runtime.effectiveRendererMode,
    requestedRenderer: runtime.requestedRenderer,
    effectiveRenderer: runtime.effectiveRenderer,
    fallbackReason: runtime.fallbackReason || null,
    supportPresentationEvidence: {
      ...supportPresentationEvidence,
    },
    screenSpaceSurfaceEvidence,
    ...(expectedMode === 'screen_space_refraction' ? { refractionEvidence } : {}),
  };
}

export function resolveFingerFluidOpticalDebugMode(value = 'shaded') {
  const mode = String(value || 'shaded');
  if (!KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid optical debug mode: ${mode}`);
  }
  return mode;
}

function rendererRouteForMode(mode) {
  if (mode === 'sphere_debug') return KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE;
  if (mode === 'screen_space_refraction') return KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE;
  return KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE;
}

export function resolveFingerFluidParticleShiftStrength(value = 0) {
  const strength = Number(value);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError(`Finger fluid particle shift strength must be in [0, 1], received: ${value}`);
  }
  return strength;
}

export function resolveFingerFluidSupportFriction(value = KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION) {
  const friction = Number(value);
  if (!Number.isFinite(friction) || friction < 0) {
    throw new RangeError(`Finger fluid support friction must be finite and non-negative, received: ${value}`);
  }
  return friction;
}

export function resolveFingerFluidChemistryDiffusion(value = 0) {
  const strength = Number(value);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError(`Finger fluid chemistry diffusion strength must be in [0, 1], received: ${value}`);
  }
  return strength;
}

export function validateLiquidFireContactDescriptorHeader(header, {
  allocationGeneration,
  epoch,
  minimumWriteTick,
  sourceFrameId,
} = {}) {
  if (!header || header.schema !== KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA) throw new Error('Liquid fire contact descriptor schema mismatch');
  if (header.packing !== KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING) throw new Error('Liquid fire contact descriptor packing mismatch');
  if (header.magic !== LIQUID_FIRE_CONTACT_MAGIC || header.version !== LIQUID_FIRE_CONTACT_VERSION) throw new Error('Liquid fire contact descriptor GPU header identity mismatch');
  if (!header.valid) throw new Error('Liquid fire contact descriptor is not valid');
  if (!header.complete) throw new Error('Liquid fire contact descriptor is not complete');
  if (header.allocationGeneration !== allocationGeneration) throw new Error('Liquid fire contact descriptor allocation generation mismatch');
  if (header.epoch !== epoch) throw new Error('Liquid fire contact descriptor epoch mismatch');
  if (header.writeTick < minimumWriteTick) throw new Error('Liquid fire contact descriptor has a stale write tick');
  if (header.sourceFrameId !== sourceFrameId) throw new Error('Liquid fire contact descriptor source frame identity mismatch');
  const counts = ['sourceCount', 'packedCount', 'contactCount', 'rejectedCount', 'capacity', 'overflowCount', 'malformedCount'];
  if (!counts.every(field => Number.isSafeInteger(header[field]) && header[field] >= 0)) throw new Error('Liquid fire contact descriptor accounting contains invalid counts');
  if (header.sourceCount !== header.packedCount + header.rejectedCount || header.contactCount < header.packedCount || header.contactCount > header.sourceCount) {
    throw new Error('Liquid fire contact descriptor accounting does not reconcile');
  }
  if (header.malformedCount !== 0) throw new Error('Liquid fire contact descriptor contains malformed source records');
  if (header.packedCount > header.capacity || header.overflowCount !== 0) throw new Error('Liquid fire contact descriptor overflowed its declared capacity');
  return header;
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

struct LaminarInletSample {
  positionPhase: vec4<f32>,
  velocityCore: vec4<f32>,
  releaseSchedule: vec4<u32>,
}

struct InterfaceRecord {
  positionId: vec4<f32>,
  velocityConfidence: vec4<f32>,
  normalCurvature: vec4<f32>,
  thicknessContactWetnessMaterial: vec4<f32>,
  stabilityAgeSource: vec4<f32>,
}

struct LiquidFireContactRecord {
  worldPositionId: vec4<f32>,
  sourcePositionConfidence: vec4<f32>,
  normalThickness: vec4<f32>,
  velocityNormalSpeed: vec4<f32>,
  tangentVelocitySpeed: vec4<f32>,
  wetnessMaterialTracerVolume: vec4<f32>,
  sourceGenerationEpochTick: vec4<f32>,
  supportSourceFlags: vec4<f32>,
}

struct LiquidFireContactHeader {
  magic: atomic<u32>,
  version: atomic<u32>,
  allocationGeneration: atomic<u32>,
  epoch: atomic<u32>,
  writeTick: atomic<u32>,
  valid: atomic<u32>,
  complete: atomic<u32>,
  sourceFrameHash: atomic<u32>,
  sourceCount: atomic<u32>,
  packedCount: atomic<u32>,
  contactCount: atomic<u32>,
  rejectedCount: atomic<u32>,
  capacity: atomic<u32>,
  overflowCount: atomic<u32>,
  malformedCount: atomic<u32>,
  recordWords: atomic<u32>,
  flags: atomic<u32>,
  reserved0: atomic<u32>,
  reserved1: atomic<u32>,
  reserved2: atomic<u32>,
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
  contactIdentity: vec4<u32>,
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
@group(0) @binding(9) var<storage, read_write> liquidFireContactRecords: array<LiquidFireContactRecord>;
@group(0) @binding(10) var<storage, read_write> liquidFireContactHeader: LiquidFireContactHeader;

${PLAYGROUND_WGSL}

fn floorHeight(p: vec3<f32>) -> f32 {
  return toyFloorHeight(p);
}

fn floorNormal(p: vec3<f32>) -> vec3<f32> {
  return toyFloorNormal(p);
}

fn supportContactFrame(position: vec3<f32>) -> vec4<f32> {
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
  return vec4<f32>(supportNormal, supportContact);
}

fn supportPhaseWeights(position: vec3<f32>, velocity: vec3<f32>) -> vec4<f32> {
  let supportFrame = supportContactFrame(position);
  let supportNormal = supportFrame.xyz;
  let supportContact = supportFrame.w;
  let tangentialVelocity = velocity - supportNormal * dot(velocity, supportNormal);
  let tangentialSpeed = length(tangentialVelocity);
  let speed = length(velocity);
  let supportRestWeight = supportContact * (1.0 - smoothstep(0.06, 0.28, speed));
  let supportTransportWeight = supportContact * smoothstep(0.22, 0.72, tangentialSpeed) * (1.0 - supportRestWeight);
  return vec4<f32>(supportContact, supportRestWeight, supportTransportWeight, tangentialSpeed);
}

fn laminar_inlet_source_index(index: u32) -> u32 {
  let allocationSlot = index % 10u;
  if (allocationSlot < 4u) { return 0u; }
  if (allocationSlot < 7u) { return 1u; }
  return 2u;
}

fn laminar_inlet_source_local_ordinal(index: u32) -> u32 {
  let allocationSlot = index % 10u;
  let completeBlocks = index / 10u;
  if (allocationSlot < 4u) { return completeBlocks * 4u + allocationSlot; }
  if (allocationSlot < 7u) { return completeBlocks * 3u + allocationSlot - 4u; }
  return completeBlocks * 3u + allocationSlot - 7u;
}

fn laminar_inlet_source_particle_count(sourceIndex: u32) -> u32 {
  let completeBlocks = params.particleCount / 10u;
  let remainder = params.particleCount % 10u;
  if (sourceIndex == 0u) { return completeBlocks * 4u + min(remainder, 4u); }
  if (sourceIndex == 1u) { return completeBlocks * 3u + min(u32(max(i32(remainder) - 4, 0)), 3u); }
  return completeBlocks * 3u + min(u32(max(i32(remainder) - 7, 0)), 3u);
}

fn laminar_inlet_source_from_phase(phase: f32) -> u32 {
  let sourcePhase = abs(phase);
  if (sourcePhase < 0.28) { return 0u; }
  if (sourcePhase < 0.68) { return 1u; }
  return 2u;
}

fn laminar_inlet_lane_count(sourceIndex: u32) -> u32 {
  if (sourceIndex == 0u) { return 72u; }
  if (sourceIndex == 1u) { return 60u; }
  return 176u;
}

fn laminar_inlet_lane_coordinates(sourceIndex: u32, laneIndex: u32) -> vec2<f32> {
  if (sourceIndex == 0u) {
    let radius = 0.30 * 0.86 * sqrt((f32(laneIndex) + 0.5) / 72.0);
    let angle = f32(laneIndex) * 2.39996322973;
    return vec2<f32>(cos(angle) * radius, sin(angle) * radius);
  }
  var columns = 15u;
  var rows = 4u;
  var halfWidth = 0.48;
  var halfHeight = 0.13;
  if (sourceIndex == 2u) {
    columns = 16u;
    rows = 11u;
    halfWidth = 0.46;
    halfHeight = 0.34;
  }
  let column = laneIndex % columns;
  let row = laneIndex / columns;
  return vec2<f32>(
    (((f32(column) + 0.5) / f32(columns)) * 2.0 - 1.0) * halfWidth * 0.92,
    (((f32(row) + 0.5) / f32(rows)) * 2.0 - 1.0) * halfHeight * 0.88,
  );
}

fn laminar_inlet_profile_speed(sourceIndex: u32, localCoordinates: vec2<f32>) -> f32 {
  if (sourceIndex == 0u) {
    let normalizedRadius = length(localCoordinates) / 0.30;
    return 0.92 * max(0.0, 1.0 - normalizedRadius * normalizedRadius);
  }
  if (sourceIndex == 1u) {
    let normalizedHeight = abs(localCoordinates.y) / 0.13;
    return 0.72 * max(0.0, 1.0 - normalizedHeight * normalizedHeight);
  }
  return 0.22;
}

fn laminar_inlet_release_phase(index: u32) -> vec2<u32> {
  let sourceIndex = laminar_inlet_source_index(index);
  let localOrdinal = laminar_inlet_source_local_ordinal(index);
  let laneCount = laminar_inlet_lane_count(sourceIndex);
  let laneIndex = localOrdinal % laneCount;
  let laneOrdinal = localOrdinal / laneCount;
  let sourceParticleCount = laminar_inlet_source_particle_count(sourceIndex);
  let laneParticleCount = (sourceParticleCount - 1u - laneIndex) / laneCount + 1u;
  let localCoordinates = laminar_inlet_lane_coordinates(sourceIndex, laneIndex);
  let speed = laminar_inlet_profile_speed(sourceIndex, localCoordinates);
  var laneSpeedSum = 41.744448;
  var expectedReleaseRate = 781.7396595559;
  if (sourceIndex == 1u) {
    laneSpeedSum = 32.7456;
    expectedReleaseRate = 720.1081893313;
  } else if (sourceIndex == 2u) {
    laneSpeedSum = 38.72;
    expectedReleaseRate = 827.2396694215;
  }
  let laneReleaseRate = expectedReleaseRate * speed / max(laneSpeedSum, 0.000001);
  let releasePeriodFrames = u32(max(1.0, floor(60.0 / max(laneReleaseRate, 0.000001) + 0.5)));
  let cycleFrames = max(1u, laneParticleCount * releasePeriodFrames);
  let lanePhaseOffset = ((laneIndex * 2u + 1u) * releasePeriodFrames) / (laneCount * 2u);
  return vec2<u32>(laneOrdinal * releasePeriodFrames + lanePhaseOffset, cycleFrames);
}

fn laminar_inlet_sample(index: u32) -> LaminarInletSample {
  let sourceIndex = laminar_inlet_source_index(index);
  let localOrdinal = laminar_inlet_source_local_ordinal(index);
  let laneCount = laminar_inlet_lane_count(sourceIndex);
  let laneIndex = localOrdinal % laneCount;
  var origin = vec3<f32>(-1.34, 0.58, -2.30);
  var axis = normalize(vec3<f32>(0.0, -0.22, 0.975499871));
  let tangent = vec3<f32>(1.0, 0.0, 0.0);
  var bitangent = normalize(cross(axis, tangent));
  var reservoirLength = 0.48;
  var phase = 0.08;
  let localCoordinates = laminar_inlet_lane_coordinates(sourceIndex, laneIndex);
  let localU = localCoordinates.x;
  let localV = localCoordinates.y;

  if (sourceIndex == 1u) {
    origin = vec3<f32>(0.0, 0.62, -2.32);
    axis = normalize(vec3<f32>(0.0, -0.18, 0.98366661));
    bitangent = normalize(cross(axis, tangent));
    reservoirLength = 0.42;
    phase = 0.48;
  } else if (sourceIndex == 2u) {
    origin = vec3<f32>(1.34, 0.26, -2.24);
    axis = normalize(vec3<f32>(0.0, -0.08, 0.996794864));
    bitangent = normalize(cross(axis, tangent));
    reservoirLength = 0.28;
    phase = 0.82;
  }

  let axialSpeed = laminar_inlet_profile_speed(sourceIndex, localCoordinates);
  let axialPosition = -reservoirLength + 0.0275;
  let releasePhase = laminar_inlet_release_phase(index);
  var sample: LaminarInletSample;
  sample.positionPhase = vec4<f32>(origin + tangent * localU + bitangent * localV + axis * axialPosition, phase);
  sample.velocityCore = vec4<f32>(axis * axialSpeed, 1.0);
  sample.releaseSchedule = vec4<u32>(releasePhase, sourceIndex, laneIndex);
  return sample;
}

fn apply_laminar_inlet_boundary(position: vec3<f32>, phase: f32, velocity: vec3<f32>) -> vec4<f32> {
  let sourceIndex = laminar_inlet_source_from_phase(phase);
  var origin = vec3<f32>(-1.34, 0.58, -2.30);
  var axis = normalize(vec3<f32>(0.0, -0.22, 0.975499871));
  let tangent = vec3<f32>(1.0, 0.0, 0.0);
  var bitangent = normalize(cross(axis, tangent));
  var reservoirLength = 0.48;
  var halfWidth = 0.30;
  var halfHeight = 0.30;
  var maximumSpeed = 0.92;
  var mouthTransitionLength = 0.18;
  if (sourceIndex == 1u) {
    origin = vec3<f32>(0.0, 0.62, -2.32);
    axis = normalize(vec3<f32>(0.0, -0.18, 0.98366661));
    bitangent = normalize(cross(axis, tangent));
    reservoirLength = 0.42;
    halfWidth = 0.48;
    halfHeight = 0.13;
    maximumSpeed = 0.72;
    mouthTransitionLength = 0.16;
  } else if (sourceIndex == 2u) {
    origin = vec3<f32>(1.34, 0.26, -2.24);
    axis = normalize(vec3<f32>(0.0, -0.08, 0.996794864));
    bitangent = normalize(cross(axis, tangent));
    reservoirLength = 0.28;
    halfWidth = 0.46;
    halfHeight = 0.34;
    maximumSpeed = 0.22;
    mouthTransitionLength = 0.14;
  }
  let relative = position - origin;
  let axialPosition = dot(relative, axis);
  let localU = dot(relative, tangent);
  let localV = dot(relative, bitangent);
  var insideAperture = abs(localU) <= halfWidth && abs(localV) <= halfHeight;
  var profileWeight = 1.0;
  if (sourceIndex == 0u) {
    let normalizedRadius = length(vec2<f32>(localU, localV)) / halfWidth;
    insideAperture = normalizedRadius <= 1.0;
    profileWeight = max(0.0, 1.0 - normalizedRadius * normalizedRadius);
  } else if (sourceIndex == 1u) {
    let normalizedHeight = abs(localV) / halfHeight;
    profileWeight = max(0.0, 1.0 - normalizedHeight * normalizedHeight);
  }
  let transitionStart = -min(0.08, reservoirLength * 0.25);
  let insideReservoir = axialPosition >= -reservoirLength - 0.02 && axialPosition <= mouthTransitionLength;
  let boundaryBlend = 1.0 - smoothstep(transitionStart, mouthTransitionLength, axialPosition);
  let inletCoreWeight = select(0.0, boundaryBlend, insideAperture && insideReservoir);
  let targetVelocity = axis * (maximumSpeed * profileWeight);
  return vec4<f32>(mix(velocity, targetVelocity, inletCoreWeight), inletCoreWeight);
}

fn constrain_laminar_inlet_reservoir(position: vec3<f32>, phase: f32) -> vec3<f32> {
  let sourceIndex = laminar_inlet_source_from_phase(phase);
  var origin = vec3<f32>(-1.34, 0.58, -2.30);
  var axis = normalize(vec3<f32>(0.0, -0.22, 0.975499871));
  let tangent = vec3<f32>(1.0, 0.0, 0.0);
  var bitangent = normalize(cross(axis, tangent));
  var reservoirLength = 0.48;
  var halfWidth = 0.30;
  var halfHeight = 0.30;
  if (sourceIndex == 1u) {
    origin = vec3<f32>(0.0, 0.62, -2.32);
    axis = normalize(vec3<f32>(0.0, -0.18, 0.98366661));
    bitangent = normalize(cross(axis, tangent));
    reservoirLength = 0.42;
    halfWidth = 0.48;
    halfHeight = 0.13;
  } else if (sourceIndex == 2u) {
    origin = vec3<f32>(1.34, 0.26, -2.24);
    axis = normalize(vec3<f32>(0.0, -0.08, 0.996794864));
    bitangent = normalize(cross(axis, tangent));
    reservoirLength = 0.28;
    halfWidth = 0.46;
    halfHeight = 0.34;
  }
  let relative = position - origin;
  let axialPosition = dot(relative, axis);
  if (axialPosition < -reservoirLength - 0.02 || axialPosition > 0.0) { return position; }
  var local = vec2<f32>(dot(relative, tangent), dot(relative, bitangent));
  if (sourceIndex == 0u) {
    let radialDistance = length(local);
    let confinedRadius = halfWidth * 0.98;
    if (radialDistance > confinedRadius) { local = local * (confinedRadius / radialDistance); }
  } else {
    local = clamp(local, vec2<f32>(-halfWidth, -halfHeight) * 0.98, vec2<f32>(halfWidth, halfHeight) * 0.98);
  }
  return origin + axis * axialPosition + tangent * local.x + bitangent * local.y;
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

fn boundary_kernel_antiderivative(x: f32) -> f32 {
  let x2 = x * x;
  let x3 = x2 * x;
  let x5 = x3 * x2;
  let x7 = x5 * x2;
  let x9 = x7 * x2;
  return x - (4.0 / 3.0) * x3 + (6.0 / 5.0) * x5 - (4.0 / 7.0) * x7 + x9 / 9.0;
}

fn boundary_missing_fraction(distance: f32) -> f32 {
  let normalizedDistance = clamp(distance / params.fluid.x, 0.0, 1.0);
  let fullHalfIntegral = boundary_kernel_antiderivative(1.0);
  return (fullHalfIntegral - boundary_kernel_antiderivative(normalizedDistance)) / (2.0 * fullHalfIntegral);
}

fn boundary_missing_fraction_derivative(distance: f32) -> f32 {
  if (distance >= params.fluid.x) { return 0.0; }
  let normalizedDistance = distance / params.fluid.x;
  let radialRemainder = 1.0 - normalizedDistance * normalizedDistance;
  return -pow(radialRemainder, 4.0) / (2.0 * boundary_kernel_antiderivative(1.0) * params.fluid.x);
}

fn analytic_boundary_density_support(position: vec3<f32>) -> vec4<f32> {
  let particleRadius = params.fluid.x * 0.22;
  let terrainNormal = floorNormal(position);
  let terrainSignedDistance = (position.y - (floorHeight(position) + particleRadius)) * terrainNormal.y;
  let terrainDistance = max(0.0, terrainSignedDistance);
  let terrainFraction = boundary_missing_fraction(terrainDistance);
  let terrainFractionGradient = terrainNormal * boundary_missing_fraction_derivative(terrainDistance);

  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let fromSphere = position - sphereCenter;
  let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
  let sphereSignedDistance = length(fromSphere) - (${OBSTACLE_RADIUS} + particleRadius);
  let sphereDistance = max(0.0, sphereSignedDistance);
  let sphereFraction = boundary_missing_fraction(sphereDistance);
  let sphereFractionGradient = sphereNormal * boundary_missing_fraction_derivative(sphereDistance);

  let missingFraction = terrainFraction + sphereFraction - terrainFraction * sphereFraction;
  let fractionGradient = terrainFractionGradient * (1.0 - sphereFraction)
    + sphereFractionGradient * (1.0 - terrainFraction);
  let nonSelfRestDensity = max(params.fluid.y - 1.0, 0.0);
  let densityContribution = nonSelfRestDensity * missingFraction;
  let constraintGradient = fractionGradient * nonSelfRestDensity / max(params.fluid.y, 0.001);
  return vec4<f32>(constraintGradient, densityContribution);
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
  let laminarInletScene = params.particleShift.z > 0.5;
  if (laminarInletScene && particle.velocity.w < 0.0) {
    let inletSample = laminar_inlet_sample(index);
    let releaseFrame = inletSample.releaseSchedule.x;
    let cycleFrames = inletSample.releaseSchedule.y;
    if (params.frameIndex % cycleFrames != releaseFrame) {
      particle.predicted = vec4<f32>(particle.position.xyz, 0.0);
      particle.delta = vec4<f32>(0.0);
      particles[index] = particle;
      return;
    }
    var state = materialTracers[index];
    let resetPhase = inletSample.positionPhase.w;
    state.concentrationDeltaRecipeSource.z = resetPhase;
    let sourceResetDelta = state.concentrationDeltaRecipeSource.z - state.concentrationDeltaRecipeSource.x;
    state.concentrationDeltaRecipeSource.x = state.concentrationDeltaRecipeSource.z;
    state.concentrationDeltaRecipeSource.y = 0.0;
    state.concentrationDeltaRecipeSource.w = state.concentrationDeltaRecipeSource.w + sourceResetDelta;
    materialTracers[index] = state;
    particle.position = vec4<f32>(inletSample.positionPhase.xyz, 1.0);
    particle.predicted = vec4<f32>(inletSample.positionPhase.xyz, 0.0);
    particle.velocity = vec4<f32>(inletSample.velocityCore.xyz, resetPhase);
    particle.delta = vec4<f32>(0.0);
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    atomicAdd(&interfaceCounters[2], 1u);
  }
  let recycleLaminarInlet = laminarInletScene && particle.velocity.w >= 0.0 && particle.position.z > 2.35;
  let recyclePlaygroundSource = !laminarInletScene && particle.velocity.w < 0.15 && particle.position.z > -0.15;
  if (recycleLaminarInlet) {
    particle.velocity = vec4<f32>(vec3<f32>(0.0), -abs(particle.velocity.w));
    particle.predicted = vec4<f32>(particle.position.xyz, 0.0);
    particle.delta = vec4<f32>(0.0);
    particles[index] = particle;
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    return;
  }
  if (recyclePlaygroundSource) {
    var state = materialTracers[index];
    let resetPosition = sourceParticleResetPosition(index);
    let resetVelocity = vec3<f32>(0.03, 0.0, 0.18);
    let resetPhase = state.concentrationDeltaRecipeSource.z;
    state.concentrationDeltaRecipeSource.z = resetPhase;
    let sourceResetDelta = state.concentrationDeltaRecipeSource.z - state.concentrationDeltaRecipeSource.x;
    state.concentrationDeltaRecipeSource.x = state.concentrationDeltaRecipeSource.z;
    state.concentrationDeltaRecipeSource.y = 0.0;
    state.concentrationDeltaRecipeSource.w = state.concentrationDeltaRecipeSource.w + sourceResetDelta;
    materialTracers[index] = state;
    particle.position = vec4<f32>(resetPosition, 1.0);
    particle.predicted = vec4<f32>(resetPosition, 0.0);
    particle.velocity = vec4<f32>(resetVelocity, resetPhase);
    particle.delta = vec4<f32>(0.0);
    particles[index] = particle;
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    atomicAdd(&interfaceCounters[2], 1u);
    return;
  }
  var velocity = particle.velocity.xyz;
  var inletCoreWeight = 0.0;
  if (laminarInletScene) {
    let inletBoundary = apply_laminar_inlet_boundary(particle.position.xyz, particle.velocity.w, velocity);
    velocity = inletBoundary.xyz;
    inletCoreWeight = inletBoundary.w;
  }
  velocity.y = velocity.y + params.forces.x * params.dt * (1.0 - inletCoreWeight);
  particle.velocity = vec4<f32>(velocity, particle.velocity.w);
  var predictedPosition = collideDomain(particle.position.xyz + velocity * params.dt);
  if (laminarInletScene) {
    predictedPosition = constrain_laminar_inlet_reservoir(predictedPosition, particle.velocity.w);
  }
  particle.predicted = vec4<f32>(predictedPosition, 0.0);
  particle.delta = vec4<f32>(0.0);
  particles[index] = particle;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn build_linked_cell_grid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  if (particles[index].velocity.w < 0.0) {
    particleNext[index] = -1;
    return;
  }
  let gridIndex = cellIndex(gridCoord(particles[index].predicted.xyz));
  particleNext[index] = atomicExchange(&cellHeads[gridIndex], i32(index));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn measure_neighbor_topology(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  if (particles[index].velocity.w < 0.0) {
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    return;
  }
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

fn interface_density_constraint(densityRatio: f32, priorSurfaceFactor: f32) -> f32 {
  let interfaceWeight = smoothstep(0.45, 0.75, clamp(priorSurfaceFactor, 0.0, 1.0));
  let interiorTensionAllowance = 0.03 * (1.0 - interfaceWeight);
  return max(densityRatio - 1.0, -interiorTensionAllowance);
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

  let boundarySupport = analytic_boundary_density_support(position);
  density = density + boundarySupport.w;
  gradientSelf = gradientSelf + boundarySupport.xyz;

  let constraint = interface_density_constraint(density / params.fluid.y, restStates[index].x);
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
  let boundarySupport = analytic_boundary_density_support(position);
  correction = correction + lambda * boundarySupport.xyz;
  let scaled = correction * params.fluid.w;
  let correctionLength = length(scaled);
  particles[index].delta = vec4<f32>(select(scaled, scaled * (0.008 / correctionLength), correctionLength > 0.008), particles[index].delta.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_position_delta(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  var correction = particle.delta.xyz;
  if (params.particleShift.z > 0.5) {
    let inletCoreWeight = apply_laminar_inlet_boundary(particle.predicted.xyz, particle.velocity.w, particle.velocity.xyz).w;
    correction = correction * (1.0 - inletCoreWeight);
  }
  var correctedPosition = collideDomain(particle.predicted.xyz + correction);
  if (params.particleShift.z > 0.5) {
    correctedPosition = constrain_laminar_inlet_reservoir(correctedPosition, particle.velocity.w);
  }
  particles[index].predicted = vec4<f32>(correctedPosition, particle.predicted.w);
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
  let freeFlightWeight = 1.0 - supportPhase.x;
  let restViscosityBlend = clamp(
    params.forces.z * transportViscosityScale + supportRestWeight * 0.16 + freeFlightWeight * params.chemistry.w,
    0.0,
    0.24,
  );
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
  let supportFrame = supportContactFrame(position);
  let supportContact = supportFrame.w;
  let supportNormal = supportFrame.xyz;
  let supportNormalSpeed = dot(velocity, supportNormal);
  let supportTangentialVelocity = velocity - supportNormal * supportNormalSpeed;
  let supportTangentialRetention = exp(-params.particleShift.y * supportContact * params.dt);
  velocity = supportNormal * supportNormalSpeed + supportTangentialVelocity * supportTangentialRetention;
  if (params.particleShift.z > 0.5) {
    velocity = apply_laminar_inlet_boundary(position, particle.velocity.w, velocity).xyz;
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

fn thin_sheet_vorticity_activity(surfaceFactor: f32, densityRatio: f32) -> f32 {
  let supportConfidence = smoothstep(0.52, 0.90, densityRatio);
  return 1.0 - clamp(surfaceFactor, 0.0, 1.0) * params.chemistry.z * (1.0 - supportConfidence);
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
  var inletCoreWeight = 0.0;
  if (params.particleShift.z > 0.5) {
    inletCoreWeight = apply_laminar_inlet_boundary(position, particle.velocity.w, particle.delta.xyz).w;
  }
  var confinementActivity = 1.0 - restStates[index].z * 0.92;
  confinementActivity = confinementActivity * (1.0 - inletCoreWeight);
  confinementActivity = confinementActivity * thin_sheet_vorticity_activity(
    particle.predicted.w,
    particle.delta.w / max(params.fluid.y, 0.0001),
  );
  var confinement = cross(confinementNormal, omega) * params.forces.w * confinementActivity;
  let confinementLength = length(confinement);
  if (confinementLength > 1.25) { confinement = confinement * (1.25 / confinementLength); }
  var velocity = particle.delta.xyz + confinement * params.dt;
  let speed = length(velocity);
  if (speed > ${MAX_FLUID_SPEED}) { velocity = velocity * (${MAX_FLUID_SPEED} / speed); }
  particles[index].delta = vec4<f32>(velocity, particle.delta.w);
  particles[index].position.w = min(omegaMagnitude, 4096.0);
}

fn capillary_pair_weight(
  distance: f32,
  surfaceFactor: f32,
  neighborSurface: f32,
  densityRatio: f32,
  neighborDensityRatio: f32,
) -> f32 {
  if (distance <= 0.00001 || distance >= params.fluid.x) { return 0.0; }
  let q = distance / params.fluid.x;
  let cohesionBand = smoothstep(0.28, 0.58, q) * (1.0 - smoothstep(0.82, 1.0, q));
  let pairSurface = clamp((surfaceFactor + neighborSurface) * 0.5, 0.0, 1.0);
  let pairSupportConfidence = smoothstep(0.48, 0.90, min(densityRatio, neighborDensityRatio));
  return cohesionBand * (0.15 + 0.85 * pairSurface) * pairSupportConfidence;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_surface_cohesion(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let position = particle.predicted.xyz;
  let surfaceFactor = particle.predicted.w;
  let densityRatio = particle.delta.w / max(params.fluid.y, 0.0001);
  let baseCell = gridCoord(position);
  var attraction = vec3<f32>(0.0);

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
              let neighborSurface = particles[neighborIndex].predicted.w;
              let neighborDensityRatio = particles[neighborIndex].delta.w / max(params.fluid.y, 0.0001);
              let weight = capillary_pair_weight(
                distance,
                surfaceFactor,
                neighborSurface,
                densityRatio,
                neighborDensityRatio,
              );
              attraction = attraction + (offset / distance) * weight;
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }

  let supportTransportWeight = supportPhaseWeights(position, particle.delta.xyz).z;
  var inletCoreWeight = 0.0;
  if (params.particleShift.z > 0.5) {
    inletCoreWeight = apply_laminar_inlet_boundary(position, particle.velocity.w, particle.delta.xyz).w;
  }
  let cohesionActivity = (1.0 - restStates[index].z * 0.72) * (1.0 - supportTransportWeight * 0.62) * (1.0 - inletCoreWeight);
  var cohesionAcceleration = attraction * (0.12 * params.chemistry.y) * cohesionActivity;
  let cohesionLength = length(cohesionAcceleration);
  if (cohesionLength > 0.42) { cohesionAcceleration = cohesionAcceleration * (0.42 / cohesionLength); }
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
  if (params.particleShift.z > 0.5) {
    velocity = apply_laminar_inlet_boundary(position, particle.velocity.w, velocity).xyz;
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
  if (particle.velocity.w < 0.0) { return; }
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

@compute @workgroup_size(1)
fn clear_liquid_fire_contact_descriptor(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x != 0u) { return; }
  atomicStore(&liquidFireContactHeader.magic, ${LIQUID_FIRE_CONTACT_MAGIC}u);
  atomicStore(&liquidFireContactHeader.version, ${LIQUID_FIRE_CONTACT_VERSION}u);
  atomicStore(&liquidFireContactHeader.allocationGeneration, params.contactIdentity.x);
  atomicStore(&liquidFireContactHeader.epoch, params.contactIdentity.y);
  atomicStore(&liquidFireContactHeader.writeTick, params.frameIndex);
  atomicStore(&liquidFireContactHeader.valid, 0u);
  atomicStore(&liquidFireContactHeader.complete, 0u);
  atomicStore(&liquidFireContactHeader.sourceFrameHash, params.contactIdentity.z);
  atomicStore(&liquidFireContactHeader.sourceCount, 0u);
  atomicStore(&liquidFireContactHeader.packedCount, 0u);
  atomicStore(&liquidFireContactHeader.contactCount, 0u);
  atomicStore(&liquidFireContactHeader.rejectedCount, 0u);
  atomicStore(&liquidFireContactHeader.capacity, params.particleCount);
  atomicStore(&liquidFireContactHeader.overflowCount, 0u);
  atomicStore(&liquidFireContactHeader.malformedCount, 0u);
  atomicStore(&liquidFireContactHeader.recordWords, ${LIQUID_FIRE_CONTACT_RECORD_FLOATS}u);
  atomicStore(&liquidFireContactHeader.flags, 1u);
  atomicStore(&liquidFireContactHeader.reserved0, 0u);
  atomicStore(&liquidFireContactHeader.reserved1, 0u);
  atomicStore(&liquidFireContactHeader.reserved2, 0u);
}

fn finite3(value: vec3<f32>) -> bool {
  return all(value == value) && all(abs(value) < vec3<f32>(1e20));
}

fn finite1(value: f32) -> bool {
  return value == value && abs(value) < 1e20;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compact_liquid_fire_contacts(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sourceIndex = gid.x;
  let activeInterfaceCount = min(atomicLoad(&interfaceCounters[0]), params.particleCount);
  if (sourceIndex >= activeInterfaceCount) { return; }
  atomicAdd(&liquidFireContactHeader.sourceCount, 1u);
  let source = interfaceRecords[sourceIndex];
  let sourceIsFinite = finite3(source.positionId.xyz)
    && finite1(source.positionId.w)
    && finite3(source.velocityConfidence.xyz)
    && finite1(source.velocityConfidence.w)
    && finite3(source.normalCurvature.xyz)
    && finite1(source.normalCurvature.w)
    && all(source.thicknessContactWetnessMaterial == source.thicknessContactWetnessMaterial)
    && all(abs(source.thicknessContactWetnessMaterial) < vec4<f32>(1e20))
    && all(source.stabilityAgeSource == source.stabilityAgeSource)
    && all(abs(source.stabilityAgeSource) < vec4<f32>(1e20));
  if (!sourceIsFinite || source.thicknessContactWetnessMaterial.x <= 0.0) {
    atomicAdd(&liquidFireContactHeader.malformedCount, 1u);
    atomicAdd(&liquidFireContactHeader.rejectedCount, 1u);
    return;
  }
  let contact = source.thicknessContactWetnessMaterial.y;
  if (contact < 0.5) {
    atomicAdd(&liquidFireContactHeader.rejectedCount, 1u);
    return;
  }
  atomicAdd(&liquidFireContactHeader.contactCount, 1u);
  let sourcePosition = source.positionId.xyz;
  let inSourceDomain = all(sourcePosition >= params.boundsMin.xyz) && all(sourcePosition <= params.boundsMax.xyz);
  if (!inSourceDomain) {
    atomicAdd(&liquidFireContactHeader.rejectedCount, 1u);
    return;
  }
  let slot = atomicAdd(&liquidFireContactHeader.packedCount, 1u);
  if (slot >= params.particleCount) {
    atomicAdd(&liquidFireContactHeader.overflowCount, 1u);
    return;
  }
  let particleId = min(u32(source.positionId.w), params.particleCount - 1u);
  let velocity = source.velocityConfidence.xyz;
  let normal = normalize(source.normalCurvature.xyz + vec3<f32>(0.000001));
  let normalSpeed = dot(velocity, normal);
  let tangentVelocity = velocity - normal * normalSpeed;
  let thickness = source.thicknessContactWetnessMaterial.x;
  let tracer = materialTracers[particleId].concentrationDeltaRecipeSource.x;
  let volumeProxy = thickness * params.fluid.x * params.fluid.x;
  liquidFireContactRecords[slot].worldPositionId = source.positionId;
  liquidFireContactRecords[slot].sourcePositionConfidence = vec4<f32>(sourcePosition, source.velocityConfidence.w);
  liquidFireContactRecords[slot].normalThickness = vec4<f32>(normal, thickness);
  liquidFireContactRecords[slot].velocityNormalSpeed = vec4<f32>(velocity, normalSpeed);
  liquidFireContactRecords[slot].tangentVelocitySpeed = vec4<f32>(tangentVelocity, length(tangentVelocity));
  liquidFireContactRecords[slot].wetnessMaterialTracerVolume = vec4<f32>(source.thicknessContactWetnessMaterial.z, source.thicknessContactWetnessMaterial.w, tracer, volumeProxy);
  liquidFireContactRecords[slot].sourceGenerationEpochTick = vec4<f32>(f32(params.contactIdentity.x), f32(params.contactIdentity.y), f32(params.frameIndex), f32(sourceIndex));
  liquidFireContactRecords[slot].supportSourceFlags = vec4<f32>(source.stabilityAgeSource.w, source.stabilityAgeSource.x, source.stabilityAgeSource.y, 1.0);
}

@compute @workgroup_size(1)
fn finalize_liquid_fire_contact_descriptor(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x != 0u) { return; }
  let sourceCount = atomicLoad(&liquidFireContactHeader.sourceCount);
  let packedCount = atomicLoad(&liquidFireContactHeader.packedCount);
  let rejectedCount = atomicLoad(&liquidFireContactHeader.rejectedCount);
  let overflowCount = atomicLoad(&liquidFireContactHeader.overflowCount);
  let malformedCount = atomicLoad(&liquidFireContactHeader.malformedCount);
  let accountingMatches = sourceCount == packedCount + rejectedCount;
  let valid = accountingMatches && overflowCount == 0u && malformedCount == 0u && packedCount <= params.particleCount && params.contactIdentity.z != 0u;
  atomicStore(&liquidFireContactHeader.valid, select(0u, 1u, valid));
  atomicStore(&liquidFireContactHeader.complete, 1u);
}
`;

const ENERGY_DIAGNOSTICS_SHADER = /* wgsl */`
struct Particle {
  position: vec4<f32>,
  predicted: vec4<f32>,
  velocity: vec4<f32>,
  delta: vec4<f32>,
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
  contactIdentity: vec4<u32>,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> energyRecords: array<vec4<f32>>;

fn kineticEnergy(velocity: vec3<f32>) -> f32 {
  return 0.5 * dot(velocity, velocity);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn measure_projection_energy(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.particleCount) { return; }
  let particle = particles[gid.x];
  let velocity = (particle.predicted.xyz - particle.position.xyz) / max(params.dt, 0.00001);
  energyRecords[gid.x].x = kineticEnergy(velocity);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn measure_viscosity_energy(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.particleCount) { return; }
  energyRecords[gid.x].y = kineticEnergy(particles[gid.x].delta.xyz);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn measure_vorticity_energy(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.particleCount) { return; }
  energyRecords[gid.x].z = kineticEnergy(particles[gid.x].delta.xyz);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn measure_cohesion_energy(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.particleCount) { return; }
  energyRecords[gid.x].w = kineticEnergy(particles[gid.x].delta.xyz);
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
  var inactiveFluid = false;
  let cold = vec3<f32>(0.055, 0.54, 0.78);
  let warm = vec3<f32>(0.18, 0.94, 0.71);
  let crest = vec3<f32>(0.80, 0.57, 1.0);
  var base = vec3<f32>(0.19, 0.23, 0.25);
  if (isFluid) {
    let particle = particles[instanceIndex];
    inactiveFluid = particle.velocity.w < 0.0;
    let colorMode = u32(params.cameraRight.w + 0.5);
    center = particle.position.xyz;
    speed = length(particle.velocity.xyz);
    radius = params.viewport.z * (0.88 + clamp(particle.delta.w / 16.0, 0.0, 0.42));
    phase = abs(particle.velocity.w);
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
  if (inactiveFluid) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
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

const ANALYTIC_SUPPORT_PRESENTATION_SHADER = /* wgsl */`
struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  viewport: vec4<f32>,
}

@group(0) @binding(1) var<uniform> params: RenderParams;

${PLAYGROUND_WGSL}

fn triangleCorner(vertexInCell: u32) -> vec2<f32> {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );
  return corners[vertexInCell];
}

struct FixtureSurface {
  position: vec3<f32>,
  normal: vec3<f32>,
}

fn fixtureBoxSurface(
  vertexIndex: u32,
  origin: vec3<f32>,
  axis: vec3<f32>,
  tangent: vec3<f32>,
  halfWidth: f32,
  halfHeight: f32,
  axialMinimum: f32,
  axialMaximum: f32
) -> FixtureSurface {
  let bitangent = normalize(cross(axis, tangent));
  let face = vertexIndex / 6u;
  let corner = triangleCorner(vertexIndex % 6u);
  var localU = 0.0;
  var localV = 0.0;
  var localAxial = 0.0;
  var normal = vec3<f32>(0.0);
  if (face < 2u) {
    localU = select(-halfWidth, halfWidth, face == 1u);
    localV = mix(-halfHeight, halfHeight, corner.x);
    localAxial = mix(axialMinimum, axialMaximum, corner.y);
    normal = tangent * select(-1.0, 1.0, face == 1u);
  } else if (face < 4u) {
    localU = mix(-halfWidth, halfWidth, corner.x);
    localV = select(-halfHeight, halfHeight, face == 3u);
    localAxial = mix(axialMinimum, axialMaximum, corner.y);
    normal = bitangent * select(-1.0, 1.0, face == 3u);
  } else {
    localU = mix(-halfWidth, halfWidth, corner.x);
    localV = mix(-halfHeight, halfHeight, corner.y);
    localAxial = select(axialMinimum, axialMaximum, face == 5u);
    normal = axis * select(-1.0, 1.0, face == 5u);
  }
  var surface: FixtureSurface;
  surface.position = origin + tangent * localU + bitangent * localV + axis * localAxial;
  surface.normal = normal;
  return surface;
}

struct AnalyticSupportVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) supportKind: f32,
}

@vertex
fn vs_analytic_support_presentation(@builtin(vertex_index) vertexIndex: u32) -> AnalyticSupportVertexOutput {
  var worldPosition = vec3<f32>(0.0);
  var worldNormal = vec3<f32>(0.0, 1.0, 0.0);
  var supportKind = 0.0;
  if (vertexIndex < ${ANALYTIC_SUPPORT_TERRAIN_VERTEX_COUNT}u) {
    let cellIndex = vertexIndex / 6u;
    let corner = triangleCorner(vertexIndex % 6u);
    let cellX = cellIndex % ${ANALYTIC_SUPPORT_GRID_COLUMNS}u;
    let cellZ = cellIndex / ${ANALYTIC_SUPPORT_GRID_COLUMNS}u;
    let u = (f32(cellX) + corner.x) / f32(${ANALYTIC_SUPPORT_GRID_COLUMNS});
    let v = (f32(cellZ) + corner.y) / f32(${ANALYTIC_SUPPORT_GRID_ROWS});
    let x = mix(${BOUNDS_MIN[0]}, ${BOUNDS_MAX[0]}, u);
    let z = mix(${BOUNDS_MIN[2]}, ${BOUNDS_MAX[2]}, v);
    worldPosition = vec3<f32>(x, toyFloorHeight(vec3<f32>(x, 0.0, z)), z);
    worldNormal = toyFloorNormal(worldPosition);
  } else if (vertexIndex < ${ANALYTIC_SUPPORT_BASE_VERTEX_COUNT}u) {
    let sphereVertex = vertexIndex - ${ANALYTIC_SUPPORT_TERRAIN_VERTEX_COUNT}u;
    let sphereCell = sphereVertex / 6u;
    let corner = triangleCorner(sphereVertex % 6u);
    let longitudeCell = sphereCell % ${ANALYTIC_SUPPORT_SPHERE_COLUMNS}u;
    let latitudeCell = sphereCell / ${ANALYTIC_SUPPORT_SPHERE_COLUMNS}u;
    let longitude = (f32(longitudeCell) + corner.x) / f32(${ANALYTIC_SUPPORT_SPHERE_COLUMNS}) * 6.28318530718;
    let latitude = (f32(latitudeCell) + corner.y) / f32(${ANALYTIC_SUPPORT_SPHERE_ROWS}) * 3.14159265359;
    let radial = sin(latitude);
    worldNormal = vec3<f32>(radial * cos(longitude), cos(latitude), radial * sin(longitude));
    worldPosition = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]}) + worldNormal * ${OBSTACLE_RADIUS};
    supportKind = 1.0;
  } else {
    let fixtureVertex = vertexIndex - ${ANALYTIC_SUPPORT_BASE_VERTEX_COUNT}u;
    if (fixtureVertex < ${ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT}u) {
      let corner = triangleCorner(fixtureVertex % 6u);
      let segment = fixtureVertex / 6u;
      let angle = (f32(segment) + corner.x) / f32(${ANALYTIC_SUPPORT_ROUND_INLET_COLUMNS}) * 6.28318530718;
      let axis = normalize(vec3<f32>(0.0, -0.22, 0.975499871));
      let tangent = vec3<f32>(1.0, 0.0, 0.0);
      let bitangent = normalize(cross(axis, tangent));
      worldNormal = normalize(tangent * cos(angle) + bitangent * sin(angle));
      worldPosition = vec3<f32>(-1.34, 0.58, -2.30)
        + worldNormal * 0.36
        + axis * mix(-0.36, -0.025, corner.y);
      supportKind = 2.0;
    } else if (fixtureVertex < ${ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT + ANALYTIC_SUPPORT_SLOT_INLET_VERTEX_COUNT}u) {
      let slotVertex = fixtureVertex - ${ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT}u;
      let axis = normalize(vec3<f32>(0.0, -0.18, 0.98366661));
      let surface = fixtureBoxSurface(
        slotVertex,
        vec3<f32>(0.0, 0.62, -2.32),
        axis,
        vec3<f32>(1.0, 0.0, 0.0),
        0.54,
        0.19,
        -0.34,
        -0.025
      );
      worldPosition = surface.position;
      worldNormal = surface.normal;
      supportKind = 3.0;
    } else {
      let porousVertex = fixtureVertex - ${ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT + ANALYTIC_SUPPORT_SLOT_INLET_VERTEX_COUNT}u;
      let axis = normalize(vec3<f32>(0.0, -0.08, 0.996794864));
      let surface = fixtureBoxSurface(
        porousVertex,
        vec3<f32>(1.34, 0.26, -2.24),
        axis,
        vec3<f32>(1.0, 0.0, 0.0),
        0.56,
        0.44,
        -0.16,
        -0.035
      );
      worldPosition = surface.position;
      worldNormal = surface.normal;
      supportKind = 4.0;
    }
  }
  var output: AnalyticSupportVertexOutput;
  output.position = params.viewProjection * vec4<f32>(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.worldNormal = worldNormal;
  output.supportKind = supportKind;
  return output;
}

fn worldGrid(worldPosition: vec3<f32>, cellsPerWorldUnit: f32) -> f32 {
  let coordinate = worldPosition.xz * cellsPerWorldUnit;
  let derivative = max(fwidth(coordinate), vec2<f32>(0.0001));
  let distanceToLine = abs(fract(coordinate - 0.5) - 0.5) / derivative;
  return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
}

@fragment
fn fs_analytic_support_presentation(input: AnalyticSupportVertexOutput) -> @location(0) vec4<f32> {
  let normal = normalize(input.worldNormal);
  let lightDirection = normalize(vec3<f32>(-0.38, 0.82, 0.43));
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let hemisphere = normal.y * 0.5 + 0.5;
  let terrainLight = 0.34 + diffuse * 0.48 + hemisphere * 0.18;
  let terrainBase = vec3<f32>(0.20, 0.23, 0.215) * terrainLight;
  let minorGrid = worldGrid(input.worldPosition, 2.0);
  let majorGrid = worldGrid(input.worldPosition, 0.5);
  var terrainColor = mix(terrainBase, vec3<f32>(0.37, 0.43, 0.40), minorGrid * 0.34);
  terrainColor = mix(terrainColor, vec3<f32>(0.63, 0.66, 0.56), majorGrid * 0.52);
  let xAxisWidth = max(fwidth(input.worldPosition.z), 0.0005);
  let zAxisWidth = max(fwidth(input.worldPosition.x), 0.0005);
  let xAxis = 1.0 - smoothstep(xAxisWidth, xAxisWidth * 2.5, abs(input.worldPosition.z));
  let zAxis = 1.0 - smoothstep(zAxisWidth, zAxisWidth * 2.5, abs(input.worldPosition.x));
  terrainColor = mix(terrainColor, vec3<f32>(0.65, 0.25, 0.20), xAxis * 0.68);
  terrainColor = mix(terrainColor, vec3<f32>(0.18, 0.48, 0.60), zAxis * 0.68);

  let obstacleLight = 0.28 + diffuse * 0.58 + hemisphere * 0.14;
  let obstacleColor = vec3<f32>(0.48, 0.34, 0.14) * obstacleLight;
  let fixtureLight = 0.24 + diffuse * 0.62 + hemisphere * 0.14;
  let roundFixtureColor = vec3<f32>(0.25, 0.39, 0.46) * fixtureLight + vec3<f32>(0.04, 0.12, 0.15);
  let slotFixtureColor = vec3<f32>(0.53, 0.34, 0.13) * fixtureLight + vec3<f32>(0.10, 0.04, 0.01);
  let porousGrain = 0.82 + 0.18 * sin(dot(input.worldPosition, vec3<f32>(53.0, 71.0, 89.0)));
  let porousFixtureColor = vec3<f32>(0.34, 0.38, 0.35) * fixtureLight * porousGrain;
  var color = terrainColor;
  if (input.supportKind > 3.5) {
    color = porousFixtureColor;
  } else if (input.supportKind > 2.5) {
    color = slotFixtureColor;
  } else if (input.supportKind > 1.5) {
    color = roundFixtureColor;
  } else if (input.supportKind > 0.5) {
    color = obstacleColor;
  }
  return vec4<f32>(color, 1.0);
}
`;

const SCREEN_SPACE_SURFACE_SHADER = /* wgsl */`
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
@group(0) @binding(4) var surfaceAccumulation: texture_2d<f32>;
@group(0) @binding(5) var refractionSceneColor: texture_2d<f32>;
@group(0) @binding(6) var refractionSceneSampler: sampler;
@group(0) @binding(7) var opticalSlabFrontDepth: texture_2d<f32>;
@group(0) @binding(8) var opticalSlabBackDepth: texture_2d<f32>;

struct AccumVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) viewDepth: f32,
  @location(2) surface: f32,
  @location(3) speed: f32,
  @location(4) tracer: f32,
  @location(5) radius: f32,
}

@vertex
fn vs_accumulate(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> AccumVertexOutput {
  let quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let particle = particles[instanceIndex];
  let corner = quad[vertexIndex];
  let surface = max(particle.predicted.w, 0.16);
  let densityRadius = clamp(particle.delta.w / 24.3, 0.62, 1.55);
  let radius = params.viewport.z * mix(1.22, 1.78, surface) * densityRadius;
  let worldPosition = particle.position.xyz + params.cameraRight.xyz * corner.x * radius + params.cameraUp.xyz * corner.y * radius;
  var clip = params.viewProjection * vec4<f32>(worldPosition, 1.0);
  if (particle.velocity.w < 0.0) {
    clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  var output: AccumVertexOutput;
  output.position = clip;
  output.uv = corner;
  output.viewDepth = max(0.001, clip.w);
  output.surface = surface;
  output.speed = length(particle.velocity.xyz);
  output.tracer = materialTracers[instanceIndex].concentrationDeltaRecipeSource.x;
  output.radius = radius;
  return output;
}

struct AccumFragmentOutput {
  @location(0) accumulation: vec4<f32>,
  @location(1) frontDepth: vec4<f32>,
  @location(2) backDepth: vec4<f32>,
}

@fragment
fn fs_accumulate(input: AccumVertexOutput) -> AccumFragmentOutput {
  let r2 = dot(input.uv, input.uv);
  if (r2 > 1.0) { discard; }
  let cap = sqrt(max(0.0, 1.0 - r2));
  let edge = smoothstep(1.0, 0.46, r2);
  let surfaceWeight = mix(0.55, 1.0, input.surface);
  let thickness = edge * surfaceWeight * (0.35 + cap * 1.85);
  let opticalThickness = thickness * (0.55 + 0.45 * smoothstep(0.0, ${MAX_FLUID_SPEED}, input.speed));
  let depthWeight = edge * surfaceWeight;
  let supportSafeViewDepth = input.viewDepth;
  var output: AccumFragmentOutput;
  output.accumulation = vec4<f32>(opticalThickness, input.tracer * opticalThickness, depthWeight, supportSafeViewDepth);
  output.frontDepth = vec4<f32>(max(0.001, input.viewDepth - cap * input.radius));
  output.backDepth = vec4<f32>(input.viewDepth + cap * input.radius);
  return output;
}

struct FullscreenVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let pos = positions[vertexIndex];
  var output: FullscreenVertexOutput;
  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.uv = pos * 0.5 + vec2<f32>(0.5);
  return output;
}

fn readAccum(pixel: vec2<i32>) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(surfaceAccumulation));
  return textureLoad(surfaceAccumulation, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0);
}

fn readFrontDepth(pixel: vec2<i32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(opticalSlabFrontDepth));
  return textureLoad(opticalSlabFrontDepth, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0).x;
}

fn readBackDepth(pixel: vec2<i32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(opticalSlabBackDepth));
  return textureLoad(opticalSlabBackDepth, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0).x;
}

fn weightedDepth(sampleValue: vec4<f32>) -> f32 {
  return sampleValue.w;
}

fn edgePreservingDepth(pixel: vec2<i32>, centerAccum: vec4<f32>) -> f32 {
  let centerDepth = weightedDepth(centerAccum);
  var depthSum = centerDepth * centerAccum.z * 2.0;
  var weightSum = centerAccum.z * 2.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      if (x == 0 && y == 0) { continue; }
      let sampleValue = readAccum(pixel + vec2<i32>(x, y));
      let sampleDepth = weightedDepth(sampleValue);
      let continuity = exp(-abs(sampleDepth - centerDepth) * 11.0);
      let spatial = select(0.74, 1.0, abs(x) + abs(y) == 1);
      let weight = sampleValue.z * continuity * spatial;
      depthSum = depthSum + sampleDepth * weight;
      weightSum = weightSum + weight;
    }
  }
  return depthSum / max(weightSum, 0.0001);
}

fn reconstructSurfaceNormal(pixel: vec2<i32>, centerDepth: f32) -> vec3<f32> {
  let left = edgePreservingDepth(pixel + vec2<i32>(-1, 0), readAccum(pixel + vec2<i32>(-1, 0)));
  let right = edgePreservingDepth(pixel + vec2<i32>(1, 0), readAccum(pixel + vec2<i32>(1, 0)));
  let down = edgePreservingDepth(pixel + vec2<i32>(0, -1), readAccum(pixel + vec2<i32>(0, -1)));
  let up = edgePreservingDepth(pixel + vec2<i32>(0, 1), readAccum(pixel + vec2<i32>(0, 1)));
  let gradient = vec2<f32>(right - left, up - down);
  return normalize(vec3<f32>(-gradient.x * 7.2, gradient.y * 7.2, 1.0 + centerDepth * 0.015));
}

fn coherentSlabDepth(pixel: vec2<i32>, centerDepth: f32, backSurface: bool) -> f32 {
  let candidate = select(readFrontDepth(pixel), readBackDepth(pixel), backSurface);
  let populated = select((candidate < 29.5), (candidate > 0.001), backSurface);
  return select(centerDepth, candidate, populated && abs(candidate - centerDepth) < 0.72);
}

fn reconstructEntryNormal(pixel: vec2<i32>, centerDepth: f32) -> vec3<f32> {
  let left = coherentSlabDepth(pixel + vec2<i32>(-1, 0), centerDepth, false);
  let right = coherentSlabDepth(pixel + vec2<i32>(1, 0), centerDepth, false);
  let down = coherentSlabDepth(pixel + vec2<i32>(0, -1), centerDepth, false);
  let up = coherentSlabDepth(pixel + vec2<i32>(0, 1), centerDepth, false);
  let gradient = vec2<f32>(right - left, up - down);
  return normalize(vec3<f32>(-gradient.x * 7.2, gradient.y * 7.2, 1.0));
}

fn reconstructExitNormal(pixel: vec2<i32>, centerDepth: f32) -> vec3<f32> {
  let left = coherentSlabDepth(pixel + vec2<i32>(-1, 0), centerDepth, true);
  let right = coherentSlabDepth(pixel + vec2<i32>(1, 0), centerDepth, true);
  let down = coherentSlabDepth(pixel + vec2<i32>(0, -1), centerDepth, true);
  let up = coherentSlabDepth(pixel + vec2<i32>(0, 1), centerDepth, true);
  let gradient = vec2<f32>(right - left, up - down);
  return normalize(vec3<f32>(gradient.x * 7.2, -gradient.y * 7.2, -1.0));
}

struct OpticalSlab {
  entryDepth: f32,
  exitDepth: f32,
  geometricPathLength: f32,
  supportPerSpanConfidence: f32,
  exitValidity: f32,
}

fn evaluateOpticalSlab(pixel: vec2<i32>, centerAccum: vec4<f32>) -> OpticalSlab {
  let entryDepth = readFrontDepth(pixel);
  let exitDepth = readBackDepth(pixel);
  let geometricPathLength = max(0.0, exitDepth - entryDepth);
  let spanInParticleDiameters = geometricPathLength / max(params.viewport.z * 2.0, 0.001);
  let supportPerSpan = centerAccum.z / max(spanInParticleDiameters, 1.0);
  let supportPerSpanConfidence = smoothstep(0.10, 0.72, supportPerSpan);
  let geometryValid = entryDepth < 29.5
    && exitDepth > entryDepth + 0.004
    && geometricPathLength < 3.2;
  var slab: OpticalSlab;
  slab.entryDepth = entryDepth;
  slab.exitDepth = exitDepth;
  slab.geometricPathLength = geometricPathLength;
  slab.supportPerSpanConfidence = supportPerSpanConfidence;
  slab.exitValidity = select(0.0, supportPerSpanConfidence, geometryValid);
  return slab;
}

struct CompositeOutput {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
}

fn viewDepthToNdc(viewDepth: f32) -> f32 {
  let near = 0.08;
  let far = 30.0;
  return far / (far - near) - (near * far) / ((far - near) * max(viewDepth, near));
}

fn reconstructRefractionOffset(normal: vec3<f32>, thickness: f32) -> vec2<f32> {
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let refracted = refract(-viewDir, normal, 1.0 / 1.333);
  let projectedDirection = refracted.xy / max(abs(refracted.z), 0.25);
  let offsetPixels = projectedDirection * clamp(thickness * 3.6, 1.0, 42.0);
  return clamp(offsetPixels, vec2<f32>(-28.0), vec2<f32>(28.0));
}

fn projectViewRayOffset(ray: vec3<f32>, pathLength: f32, entryDepth: f32) -> vec2<f32> {
  let focalPixels = params.viewport.y * 0.5 / tan(0.5 * 3.14159265 / 3.15);
  let projectedDirection = ray.xy / max(abs(ray.z), 0.25);
  return projectedDirection * pathLength * focalPixels / max(entryDepth, 0.08);
}

fn refractionOutput(color: vec4<f32>, supportOrderingDepth: f32) -> CompositeOutput {
  var output: CompositeOutput;
  output.color = color;
  output.depth = clamp(viewDepthToNdc(supportOrderingDepth + 0.003), 0.0, 1.0);
  return output;
}

@fragment
fn fs_composite(@builtin(position) fragmentPosition: vec4<f32>) -> CompositeOutput {
  let pixel = vec2<i32>(fragmentPosition.xy);
  let centerAccum = readAccum(pixel);
  if (centerAccum.z < 0.018 || centerAccum.x < 0.012) { discard; }
  let supportOrderingDepth = weightedDepth(centerAccum);
  let shadingDepth = edgePreservingDepth(pixel, centerAccum);
  let normal = reconstructSurfaceNormal(pixel, shadingDepth);
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let light = normalize(vec3<f32>(-0.28, 0.64, 0.72));
  let halfVector = normalize(light + viewDir);
  let ndv = clamp(dot(normal, viewDir), 0.0, 1.0);
  let fresnel = pow(1.0 - ndv, 5.0) * 0.82 + 0.04;
  let diffuse = max(dot(normal, light), 0.0);
  let specular = pow(max(dot(normal, halfVector), 0.0), 92.0) * (0.62 + fresnel);
  let thickness = centerAccum.x;
  let tracer = centerAccum.y / max(thickness, 0.0001);
  let absorption = exp(-vec3<f32>(0.42, 0.18, 0.06) * thickness * 0.10);
  let shallow = vec3<f32>(0.34, 0.96, 1.08);
  let deep = vec3<f32>(0.05, 0.36, 0.72);
  let mineral = 0.5 + 0.5 * cos(vec3<f32>(0.0, 2.094, 4.188) + tracer * 6.28318);
  let body = mix(shallow, deep, smoothstep(1.2, 8.0, thickness)) * absorption;
  let color = body * (0.54 + diffuse * 0.84) + mineral * 0.08 + vec3<f32>(0.78, 0.98, 1.0) * fresnel * 0.52 + vec3<f32>(1.0) * specular * 1.25;
  let alpha = clamp(0.34 + thickness * 0.070 + fresnel * 0.22, 0.34, 0.88);
  var output: CompositeOutput;
  output.color = vec4<f32>(color, alpha);
  output.depth = clamp(viewDepthToNdc(supportOrderingDepth + 0.003), 0.0, 1.0);
  return output;
}

@fragment
fn fs_refraction(@builtin(position) fragmentPosition: vec4<f32>) -> CompositeOutput {
  let dims = vec2<i32>(textureDimensions(surfaceAccumulation));
  let dimsFloat = vec2<f32>(dims);
  let pixel = vec2<i32>(fragmentPosition.xy);
  let sceneUv = clamp((vec2<f32>(pixel) + vec2<f32>(0.5)) / dimsFloat, vec2<f32>(0.0), vec2<f32>(1.0));
  let centerAccum = readAccum(pixel);
  if (centerAccum.z < 0.018 || centerAccum.x < 0.012) { discard; }

  let supportOrderingDepth = weightedDepth(centerAccum);
  let shadingDepth = edgePreservingDepth(pixel, centerAccum);
  let slab = evaluateOpticalSlab(pixel, centerAccum);
  let normal = reconstructEntryNormal(pixel, slab.entryDepth);
  let thickness = centerAccum.x;
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let insideRay = refract(-viewDir, normal, 1.0 / 1.333);
  let insideRayValid = length(insideRay) > 0.001;
  let geometricPathLength = slab.geometricPathLength / max(abs(insideRay.z), 0.25);
  let insideOffset = projectViewRayOffset(insideRay, geometricPathLength, slab.entryDepth);
  let unclampedExitUv = sceneUv + insideOffset / dimsFloat;
  let exitInFrame = all(unclampedExitUv >= vec2<f32>(0.001)) && all(unclampedExitUv <= vec2<f32>(0.999));
  let exitUv = clamp(unclampedExitUv, vec2<f32>(0.001), vec2<f32>(0.999));
  let exitPixel = vec2<i32>(exitUv * dimsFloat);
  let sampledExitDepth = readBackDepth(exitPixel);
  let exitDepthValid = sampledExitDepth > slab.entryDepth + 0.004 && sampledExitDepth < 29.5;
  let exitNormal = reconstructExitNormal(exitPixel, sampledExitDepth);
  let outgoingRay = refract(insideRay, -exitNormal, 1.333);
  let outgoingRayValid = length(outgoingRay) > 0.001;
  let exitDirectionDelta = outgoingRay.xy / max(abs(outgoingRay.z), 0.25)
    - insideRay.xy / max(abs(insideRay.z), 0.25);
  let exitOffset = exitDirectionDelta * clamp(geometricPathLength * 7.0, 0.0, 12.0);
  let twoInterfaceOffset = clamp(insideOffset + exitOffset, vec2<f32>(-28.0), vec2<f32>(28.0));
  let entryOnlyOffset = reconstructRefractionOffset(normal, thickness);
  let exitValidity = slab.exitValidity
    * select(0.0, 1.0, exitInFrame)
    * select(0.0, 1.0, insideRayValid && outgoingRayValid && exitDepthValid);
  let offsetPixels = mix(entryOnlyOffset, twoInterfaceOffset, exitValidity);
  let refractedUv = clamp(sceneUv + offsetPixels / dimsFloat, vec2<f32>(0.001), vec2<f32>(0.999));
  let refractedScene = textureSampleLevel(refractionSceneColor, refractionSceneSampler, refractedUv, 0.0);
  let ndv = clamp(dot(normal, viewDir), 0.0, 1.0);
  let f0 = 0.02037;
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
  let absorptionPath = mix(thickness * 0.12, geometricPathLength, exitValidity);
  let absorption = exp(-vec3<f32>(0.46, 0.15, 0.055) * absorptionPath);
  let opticalDebugMode = i32(round(params.cameraUp.w));

  if (opticalDebugMode == 1) {
    let depthView = 1.0 - exp(-supportOrderingDepth * 0.22);
    return refractionOutput(vec4<f32>(vec3<f32>(depthView), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 2) {
    let depthView = 1.0 - exp(-slab.entryDepth * 0.22);
    return refractionOutput(vec4<f32>(depthView * 0.45, depthView * 0.72, depthView, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 3) {
    return refractionOutput(vec4<f32>(normal * 0.5 + vec3<f32>(0.5), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 4) {
    let depthView = 1.0 - exp(-sampledExitDepth * 0.22);
    return refractionOutput(vec4<f32>(depthView, depthView * 0.54, depthView * 0.24, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 5) {
    return refractionOutput(vec4<f32>(exitNormal * 0.5 + vec3<f32>(0.5), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 6) {
    let thicknessView = 0.62 + 0.38 * (1.0 - exp(-thickness * 0.18));
    return refractionOutput(vec4<f32>(thicknessView, thicknessView * 0.76, thicknessView * 0.34, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 7) {
    let pathView = 1.0 - exp(-geometricPathLength * 1.4);
    return refractionOutput(vec4<f32>(pathView, pathView * 0.82, 0.12 + pathView * 0.3, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 8) {
    return refractionOutput(vec4<f32>(1.0 - exitValidity, exitValidity, slab.supportPerSpanConfidence * 0.35, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 9) {
    let encodedOffset = offsetPixels / 56.0 + vec2<f32>(0.5);
    return refractionOutput(vec4<f32>(encodedOffset, length(offsetPixels) / 28.0, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 10) {
    return refractionOutput(vec4<f32>(vec3<f32>(fresnel), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 11) {
    return refractionOutput(vec4<f32>(absorption, 1.0), supportOrderingDepth);
  }

  let absorptionLoss = vec3<f32>(1.0) - absorption;
  let waterScatter = vec3<f32>(0.055, 0.30, 0.42) * (vec3<f32>(0.42) + absorptionLoss * 0.58);
  let transmitted = refractedScene.rgb * absorption + waterScatter;
  let reflectedSky = vec3<f32>(0.48, 0.78, 0.94) * (0.62 + 0.38 * max(normal.y, 0.0));
  let directLight = max(dot(normal, normalize(vec3<f32>(-0.28, 0.64, 1.72))), 0.0);
  let broadSpecular = pow(directLight, 38.0) * 0.32;
  let crestSpecular = pow(directLight, 128.0) * 0.46;
  let color = mix(transmitted, reflectedSky, fresnel)
    + vec3<f32>(0.72, 0.92, 1.0) * broadSpecular
    + vec3<f32>(1.0) * crestSpecular * (0.22 + fresnel * 0.78);
  return refractionOutput(vec4<f32>(color, 1.0), supportOrderingDepth);
}
`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function applySupportFrictionVelocity(velocity, normal, contactWeight, friction, dt) {
  if (!Array.isArray(velocity) || velocity.length !== 3 || !velocity.every(Number.isFinite)) {
    throw new TypeError('Finger fluid support friction requires a finite 3D velocity');
  }
  if (!Array.isArray(normal) || normal.length !== 3 || !normal.every(Number.isFinite)) {
    throw new TypeError('Finger fluid support friction requires a finite 3D support normal');
  }
  const normalLength = Math.hypot(...normal);
  if (normalLength <= 1e-9) throw new RangeError('Finger fluid support friction requires a nonzero support normal');
  const safeContactWeight = Number(contactWeight);
  const safeDt = Number(dt);
  if (!Number.isFinite(safeContactWeight)) throw new TypeError('Finger fluid support friction requires a finite contact weight');
  if (!Number.isFinite(safeDt) || safeDt < 0) throw new RangeError('Finger fluid support friction requires a non-negative finite time step');
  const safeFriction = resolveFingerFluidSupportFriction(friction);
  const contact = clamp(safeContactWeight, 0, 1);
  if (contact === 0 || safeFriction === 0 || safeDt === 0) return [...velocity];

  const supportNormal = normal.map(value => value / normalLength);
  const normalSpeed = velocity.reduce((sum, value, axis) => sum + value * supportNormal[axis], 0);
  const tangentialRetention = Math.exp(-safeFriction * contact * safeDt);
  return velocity.map((value, axis) => {
    const normalVelocity = supportNormal[axis] * normalSpeed;
    return normalVelocity + (value - normalVelocity) * tangentialRetention;
  });
}

export function summarizeFingerFluidEnergyLedger(records, particleCount, stepCount) {
  const count = Number(particleCount);
  if (!(records instanceof Float32Array) || !Number.isSafeInteger(count) || count <= 0 || records.length !== count * ENERGY_RECORD_FLOATS) {
    throw new Error(`Finger fluid energy ledger readback is missing or partial: ${JSON.stringify({
      recordType: records?.constructor?.name || typeof records,
      recordLength: records?.length ?? null,
      particleCount,
    })}`);
  }
  if (!Number.isSafeInteger(stepCount) || stepCount < 0) {
    throw new Error(`Finger fluid energy ledger has invalid step count: ${stepCount}`);
  }
  const stageNames = ['projection', 'viscosity', 'vorticity', 'cohesion'];
  const totals = [0, 0, 0, 0];
  for (let offset = 0; offset < records.length; offset += ENERGY_RECORD_FLOATS) {
    for (let stage = 0; stage < ENERGY_RECORD_FLOATS; stage += 1) {
      const value = records[offset + stage];
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Finger fluid energy ledger contains invalid ${stageNames[stage]} energy at particle ${offset / ENERGY_RECORD_FLOATS}: ${value}`);
      }
      totals[stage] += value;
    }
  }
  const totalKineticEnergy = Object.fromEntries(stageNames.map((name, index) => [name, totals[index]]));
  const averageKineticEnergy = Object.fromEntries(stageNames.map((name, index) => [name, totals[index] / count]));
  return {
    contract: KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT,
    stepCount,
    particleCount: count,
    totalKineticEnergy,
    averageKineticEnergy,
    stageDelta: {
      viscosity: averageKineticEnergy.viscosity - averageKineticEnergy.projection,
      vorticity: averageKineticEnergy.vorticity - averageKineticEnergy.viscosity,
      cohesion: averageKineticEnergy.cohesion - averageKineticEnergy.vorticity,
    },
  };
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

function boundaryKernelAntiderivative(value) {
  const x2 = value * value;
  const x3 = x2 * value;
  const x5 = x3 * x2;
  const x7 = x5 * x2;
  const x9 = x7 * x2;
  return value - (4 / 3) * x3 + (6 / 5) * x5 - (4 / 7) * x7 + x9 / 9;
}

export function evaluateStaticBoundaryLambdaDenominator(constraintGradient, regularization = 0.012) {
  if (!Array.isArray(constraintGradient) || constraintGradient.length !== 3 || !constraintGradient.every(Number.isFinite)) {
    throw new TypeError(`Static boundary lambda denominator received an invalid constraint gradient: ${JSON.stringify(constraintGradient)}`);
  }
  if (!Number.isFinite(regularization) || regularization < 0) {
    throw new RangeError(`Static boundary lambda denominator requires finite non-negative regularization: ${regularization}`);
  }
  return constraintGradient.reduce((sum, component) => sum + component * component, regularization);
}

export function evaluateAnalyticBoundaryKernelSupport(boundaries, {
  kernelRadius = 0.185,
  restDensity = 24.3,
} = {}) {
  const radius = finite(kernelRadius, 0);
  const targetDensity = finite(restDensity, 0);
  if (radius <= 0 || targetDensity <= 0) {
    throw new RangeError(`Boundary kernel support requires positive kernel radius and rest density: ${JSON.stringify({ kernelRadius, restDensity })}`);
  }
  if (!Array.isArray(boundaries)) throw new TypeError('Boundary kernel support requires an array of analytic boundaries');
  const fullHalfIntegral = boundaryKernelAntiderivative(1);
  let missingFraction = 0;
  let fractionGradient = [0, 0, 0];
  for (const boundary of boundaries) {
    const distance = finite(boundary?.distance, Number.NaN);
    const normal = boundary?.normal;
    if (!Number.isFinite(distance) || !Array.isArray(normal) || normal.length !== 3 || !normal.every(Number.isFinite)) {
      throw new TypeError(`Boundary kernel support received an invalid boundary: ${JSON.stringify(boundary)}`);
    }
    const normalLength = Math.hypot(...normal);
    if (normalLength <= 1e-8) {
      throw new TypeError(`Boundary kernel support received an invalid boundary normal: ${JSON.stringify(normal)}`);
    }
    const normalizedDistance = clamp(distance / radius, 0, 1);
    const boundaryFraction = (fullHalfIntegral - boundaryKernelAntiderivative(normalizedDistance)) / (2 * fullHalfIntegral);
    const derivative = distance < radius
      ? -((1 - normalizedDistance ** 2) ** 4) / (2 * fullHalfIntegral * radius)
      : 0;
    const boundaryGradient = normal.map(component => component * derivative / normalLength);
    fractionGradient = fractionGradient.map((component, axis) => (
      component * (1 - boundaryFraction) + boundaryGradient[axis] * (1 - missingFraction)
    ));
    missingFraction += boundaryFraction - missingFraction * boundaryFraction;
  }
  const nonSelfRestDensity = Math.max(targetDensity - 1, 0);
  return {
    contract: KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT,
    missingFraction,
    densityContribution: nonSelfRestDensity * missingFraction,
    constraintGradient: fractionGradient.map(component => component * nonSelfRestDensity / targetDensity),
  };
}

function measureAnalyticBoundaryDistance(position, kernelRadius) {
  const [x, y, z] = position;
  const particleRadius = kernelRadius * 0.22;
  const sampleOffset = 0.018;
  const terrainDx = (
    sampleFingerFluidPlaygroundHeight(x + sampleOffset, z)
    - sampleFingerFluidPlaygroundHeight(x - sampleOffset, z)
  ) / (2 * sampleOffset);
  const terrainDz = (
    sampleFingerFluidPlaygroundHeight(x, z + sampleOffset)
    - sampleFingerFluidPlaygroundHeight(x, z - sampleOffset)
  ) / (2 * sampleOffset);
  const terrainNormal = normalize3([-terrainDx, 1, -terrainDz]);
  const terrainSignedDistance = (y - (sampleFingerFluidPlaygroundHeight(x, z) + particleRadius)) * terrainNormal[1];
  const fromSphere = [x - OBSTACLE_CENTER[0], y - OBSTACLE_CENTER[1], z - OBSTACLE_CENTER[2]];
  const sphereSignedDistance = Math.hypot(...fromSphere) - (OBSTACLE_RADIUS + particleRadius);
  return {
    distance: Math.max(0, Math.min(terrainSignedDistance, sphereSignedDistance)),
    penetration: Math.max(0, -terrainSignedDistance, -sphereSignedDistance),
  };
}

function smoothstepNumber(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function evaluateFingerFluidInterfaceDensityConstraint({
  densityRatio = 1,
  surfaceFactor = 0,
} = {}) {
  const interfaceWeight = smoothstepNumber(0.45, 0.75, clamp(finite(surfaceFactor, 0), 0, 1));
  const interiorTensionAllowance = 0.03 * (1 - interfaceWeight);
  return Number(Math.max(finite(densityRatio, 0) - 1, -interiorTensionAllowance).toFixed(6));
}

export function resolveFingerFluidCapillaryStrength(value = KAMINOS_FINGER_FLUID_DEFAULT_CAPILLARY_STRENGTH) {
  const strength = finite(value, KAMINOS_FINGER_FLUID_DEFAULT_CAPILLARY_STRENGTH);
  if (strength < 0 || strength > 2) throw new RangeError(`Finger fluid capillary strength must be within [0, 2]: ${value}`);
  return strength;
}

export function resolveFingerFluidThinSheetVorticityAttenuation(
  value = KAMINOS_FINGER_FLUID_DEFAULT_THIN_SHEET_VORTICITY_ATTENUATION,
) {
  const attenuation = finite(value, KAMINOS_FINGER_FLUID_DEFAULT_THIN_SHEET_VORTICITY_ATTENUATION);
  if (attenuation < 0 || attenuation > 1) {
    throw new RangeError(`Finger fluid thin-sheet vorticity attenuation must be within [0, 1]: ${value}`);
  }
  return attenuation;
}

export function evaluateFingerFluidCapillaryPair({
  offset,
  kernelRadius = 0.185,
  surfaceFactors = [1, 1],
  densityRatios = [1, 1],
  strength = KAMINOS_FINGER_FLUID_DEFAULT_CAPILLARY_STRENGTH,
} = {}) {
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) {
    throw new TypeError(`Finger fluid capillary pair requires a finite 3D offset: ${JSON.stringify(offset)}`);
  }
  if (!Number.isFinite(kernelRadius) || kernelRadius <= 0) {
    throw new RangeError(`Finger fluid capillary pair requires a positive kernel radius: ${kernelRadius}`);
  }
  if (!Array.isArray(surfaceFactors) || surfaceFactors.length !== 2 || !surfaceFactors.every(Number.isFinite)) {
    throw new TypeError(`Finger fluid capillary pair requires two finite surface factors: ${JSON.stringify(surfaceFactors)}`);
  }
  if (!Array.isArray(densityRatios) || densityRatios.length !== 2 || !densityRatios.every(Number.isFinite)) {
    throw new TypeError(`Finger fluid capillary pair requires two finite density ratios: ${JSON.stringify(densityRatios)}`);
  }
  const safeStrength = resolveFingerFluidCapillaryStrength(strength);
  const distance = Math.hypot(...offset);
  if (distance <= 1e-9 || distance >= kernelRadius || safeStrength === 0) {
    return { accelerationA: [0, 0, 0], accelerationB: [0, 0, 0], magnitude: 0, pairSupportConfidence: 0 };
  }
  const q = distance / kernelRadius;
  const cohesionBand = smoothstepNumber(0.28, 0.58, q) * (1 - smoothstepNumber(0.82, 1, q));
  const pairSurface = clamp((surfaceFactors[0] + surfaceFactors[1]) * 0.5, 0, 1);
  const pairSupportConfidence = smoothstepNumber(0.48, 0.90, Math.min(...densityRatios));
  const magnitude = cohesionBand * (0.15 + 0.85 * pairSurface) * pairSupportConfidence * safeStrength * 0.12;
  const direction = offset.map(component => component / distance);
  const accelerationA = direction.map(component => component * magnitude);
  return {
    accelerationA,
    accelerationB: accelerationA.map(component => -component),
    magnitude,
    pairSupportConfidence,
  };
}

export function evaluateFingerFluidThinSheetVorticityActivity({
  surfaceFactor = 0,
  densityRatio = 1,
  attenuation = KAMINOS_FINGER_FLUID_DEFAULT_THIN_SHEET_VORTICITY_ATTENUATION,
} = {}) {
  const safeAttenuation = resolveFingerFluidThinSheetVorticityAttenuation(attenuation);
  const supportConfidence = smoothstepNumber(0.52, 0.90, finite(densityRatio, 0));
  return 1 - clamp(finite(surfaceFactor, 0), 0, 1) * safeAttenuation * (1 - supportConfidence);
}

export function resolveFingerFluidFreeFlightViscosityBoost(
  value = KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST,
) {
  const boost = finite(value, KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST);
  if (boost < 0 || boost > 0.3) throw new RangeError(`Finger fluid free-flight viscosity boost must be within [0, 0.3]: ${value}`);
  return boost;
}

export function evaluateFingerFluidFreeFlightViscosityBlend({
  baseViscosity = 0.07,
  supportContact = 0,
  supportRestWeight = 0,
  supportTransportWeight = 0,
  boost = KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST,
} = {}) {
  const safeBoost = resolveFingerFluidFreeFlightViscosityBoost(boost);
  const transportViscosityScale = 1 - clamp(finite(supportTransportWeight, 0), 0, 1) * 0.68;
  const freeFlightWeight = 1 - clamp(finite(supportContact, 0), 0, 1);
  return clamp(
    finite(baseViscosity, 0.07) * transportViscosityScale
      + clamp(finite(supportRestWeight, 0), 0, 1) * 0.16
      + freeFlightWeight * safeBoost,
    0,
    0.24,
  );
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

function waterfallSourceIndexFromPhase(phase) {
  const sourcePhase = Math.abs(phase);
  return sourcePhase < 0.28 ? 0 : sourcePhase < 0.68 ? 1 : 2;
}

export function measureFingerFluidWaterfallContinuity(
  particleData,
  restStateData,
  particleCount,
  descriptors = createFingerFluidLaminarInletDescriptors(),
) {
  if (!(particleData instanceof Float32Array)) throw new TypeError('Waterfall diagnostics require Float32Array particle data');
  if (!(restStateData instanceof Float32Array)) throw new TypeError('Waterfall diagnostics require Float32Array rest-state data');
  const count = Math.min(
    Math.max(0, Math.floor(finite(particleCount, 0))),
    Math.floor(particleData.length / PARTICLE_FLOATS),
    Math.floor(restStateData.length / REST_STATE_FLOATS),
  );
  const rows = descriptors.map((descriptor, sourceIndex) => ({
    sourceIndex,
    sourceId: descriptor.id,
    apertureWidth: descriptor.profile === 'round_poiseuille' ? descriptor.radius * 2 : descriptor.halfWidth * 2,
    samples: [],
  }));
  for (let index = 0; index < count; index += 1) {
    const offset = index * PARTICLE_FLOATS;
    const restOffset = index * REST_STATE_FLOATS;
    const phase = particleData[offset + 11];
    if (phase < 0) continue;
    const position = [particleData[offset], particleData[offset + 1], particleData[offset + 2]];
    if (position[2] < -1.52 || position[2] > -0.38) continue;
    const velocity = [particleData[offset + 8], particleData[offset + 9], particleData[offset + 10]];
    const support = measureSupportTransport(position, velocity);
    if (support.supportContact > 0.22) continue;
    rows[waterfallSourceIndexFromPhase(phase)].samples.push({
      index,
      position,
      velocity,
      densityRatio: particleData[offset + 15] / 24.3,
      surfaceFactor: particleData[offset + 7],
      interfaceAge: restStateData[restOffset + 1],
    });
  }
  const waterfalls = rows.map(row => {
    const sorted = [...row.samples].sort((a, b) => b.position[1] - a.position[1]);
    const closeNeighborRadius = 0.185 * 0.55;
    const closeNeighborCounts = row.samples.map((sample, sampleIndex) => {
      let closeNeighborCount = 0;
      for (let neighborIndex = 0; neighborIndex < row.samples.length; neighborIndex += 1) {
        if (neighborIndex === sampleIndex) continue;
        const neighbor = row.samples[neighborIndex];
        const distance = Math.hypot(
          sample.position[0] - neighbor.position[0],
          sample.position[1] - neighbor.position[1],
          sample.position[2] - neighbor.position[2],
        );
        if (distance <= closeNeighborRadius) closeNeighborCount += 1;
      }
      return closeNeighborCount;
    });
    const closeNeighborSupportedParticleCount = closeNeighborCounts.filter(count => count >= 4).length;
    const components = [];
    const maximumConnectedGap = 0.13;
    for (const sample of sorted) {
      const component = components.at(-1);
      if (!component || component.at(-1).position[1] - sample.position[1] > maximumConnectedGap) components.push([sample]);
      else component.push(sample);
    }
    components.sort((a, b) => b.length - a.length);
    const largest = components[0] || [];
    const connectedSurvivalLength = largest.length > 1
      ? Math.max(...largest.map(sample => sample.position[1])) - Math.min(...largest.map(sample => sample.position[1]))
      : 0;
    const meanVelocity = [0, 1, 2].map(axis => row.samples.reduce((sum, sample) => sum + sample.velocity[axis], 0) / Math.max(1, row.samples.length));
    const transverseVariance = row.samples.reduce((sum, sample) => (
      sum + (sample.velocity[0] - meanVelocity[0]) ** 2 + (sample.velocity[2] - meanVelocity[2]) ** 2
    ), 0) / Math.max(1, row.samples.length);
    return {
      sourceIndex: row.sourceIndex,
      sourceId: row.sourceId,
      particleCount: row.samples.length,
      componentCount: components.length,
      largestComponentParticleCount: largest.length,
      largestComponentParticleRatio: Number((largest.length / Math.max(1, row.samples.length)).toFixed(5)),
      connectedSurvivalLength: Number(connectedSurvivalLength.toFixed(5)),
      connectedSurvivalWidths: Number((connectedSurvivalLength / Math.max(0.001, row.apertureWidth)).toFixed(5)),
      closeNeighborRadius,
      averageCloseNeighborCount: Number((closeNeighborCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, closeNeighborCounts.length)).toFixed(5)),
      closeNeighborSupportedParticleCount,
      closeNeighborSupportedParticleRatio: Number((closeNeighborSupportedParticleCount / Math.max(1, row.samples.length)).toFixed(5)),
      transverseVelocityStdDev: Number(Math.sqrt(transverseVariance).toFixed(5)),
      averageDensityRatio: Number((row.samples.reduce((sum, sample) => sum + sample.densityRatio, 0) / Math.max(1, row.samples.length)).toFixed(5)),
      averageSurfaceFactor: Number((row.samples.reduce((sum, sample) => sum + sample.surfaceFactor, 0) / Math.max(1, row.samples.length)).toFixed(5)),
      averageInterfaceAge: Number((row.samples.reduce((sum, sample) => sum + sample.interfaceAge, 0) / Math.max(1, row.samples.length)).toFixed(5)),
      verticalExtent: sorted.length > 1 ? Number((sorted[0].position[1] - sorted.at(-1).position[1]).toFixed(5)) : 0,
    };
  });
  return {
    schema: KAMINOS_FINGER_FLUID_WATERFALL_DIAGNOSTICS_SCHEMA,
    contract: KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT,
    particleCount: count,
    accountedParticleCount: waterfalls.reduce((sum, waterfall) => sum + waterfall.particleCount, 0),
    waterfallCount: waterfalls.length,
    maximumConnectedGap: 0.13,
    waterfalls,
  };
}

export function evaluateFingerFluidWaterfallContinuityAcceptance({
  diagnostics,
  sourceParticleCounts,
  activeSourceParticleCounts = sourceParticleCounts,
} = {}) {
  if (diagnostics?.schema !== KAMINOS_FINGER_FLUID_WATERFALL_DIAGNOSTICS_SCHEMA
    || diagnostics?.contract !== KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT
    || !Array.isArray(diagnostics?.waterfalls)
    || diagnostics.waterfalls.length !== 3) {
    throw new TypeError(`Waterfall acceptance requires complete continuity diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  if (!Array.isArray(sourceParticleCounts)
    || sourceParticleCounts.length !== diagnostics.waterfalls.length
    || sourceParticleCounts.some(count => !Number.isSafeInteger(count) || count <= 0)) {
    throw new TypeError(`Waterfall acceptance requires positive source particle counts: ${JSON.stringify(sourceParticleCounts)}`);
  }
  if (!Array.isArray(activeSourceParticleCounts)
    || activeSourceParticleCounts.length !== diagnostics.waterfalls.length
    || activeSourceParticleCounts.some((count, sourceIndex) => (
      !Number.isSafeInteger(count)
      || count <= 0
      || count > sourceParticleCounts[sourceIndex]
    ))) {
    throw new TypeError(`Waterfall acceptance requires active source particle counts bounded by total allocation: ${JSON.stringify({ sourceParticleCounts, activeSourceParticleCounts })}`);
  }
  const minimumSurvivalWidths = [0.75, 0.75, 0.25];
  const waterfalls = diagnostics.waterfalls.map((waterfall, sourceIndex) => {
    const sourceParticleCount = sourceParticleCounts[sourceIndex];
    const activeSourceParticleCount = activeSourceParticleCounts[sourceIndex];
    const fallingCoverageRatio = waterfall.particleCount / activeSourceParticleCount;
    const coverageAccepted = fallingCoverageRatio >= 0.08;
    const componentAccepted = waterfall.largestComponentParticleRatio >= 0.75;
    const survivalAccepted = waterfall.connectedSurvivalWidths >= minimumSurvivalWidths[sourceIndex];
    const closeNeighborSupportAccepted = waterfall.closeNeighborSupportedParticleRatio >= 0.65;
    const transverseVelocityAccepted = Number.isFinite(waterfall.transverseVelocityStdDev)
      && waterfall.transverseVelocityStdDev <= 0.75;
    return {
      sourceIndex,
      sourceId: waterfall.sourceId,
      sourceParticleCount,
      activeSourceParticleCount,
      fallingParticleCount: waterfall.particleCount,
      fallingCoverageRatio: Number(fallingCoverageRatio.toFixed(5)),
      minimumFallingCoverageRatio: 0.08,
      coverageAccepted,
      largestComponentParticleRatio: waterfall.largestComponentParticleRatio,
      minimumLargestComponentParticleRatio: 0.75,
      componentAccepted,
      connectedSurvivalWidths: waterfall.connectedSurvivalWidths,
      minimumConnectedSurvivalWidths: minimumSurvivalWidths[sourceIndex],
      survivalAccepted,
      averageCloseNeighborCount: waterfall.averageCloseNeighborCount,
      closeNeighborSupportedParticleRatio: waterfall.closeNeighborSupportedParticleRatio,
      minimumCloseNeighborSupportedParticleRatio: 0.65,
      closeNeighborSupportAccepted,
      transverseVelocityStdDev: waterfall.transverseVelocityStdDev,
      maximumTransverseVelocityStdDev: 0.75,
      transverseVelocityAccepted,
      ok: coverageAccepted && componentAccepted && survivalAccepted && closeNeighborSupportAccepted && transverseVelocityAccepted,
    };
  });
  return {
    schema: 'kaminos.finger-fluid.waterfall-continuity-acceptance.v0',
    diagnosticsSchema: diagnostics.schema,
    contract: diagnostics.contract,
    sourcePopulationCount: sourceParticleCounts.reduce((sum, count) => sum + count, 0),
    activeSourcePopulationCount: activeSourceParticleCounts.reduce((sum, count) => sum + count, 0),
    waterfalls,
    ok: waterfalls.every(waterfall => waterfall.ok),
  };
}

function matchingWaterfallEvidenceIdentityValue(runtime, requestedKey, effectiveKey, label) {
  const requested = runtime?.[requestedKey];
  const effective = runtime?.[effectiveKey];
  if (requested === undefined || effective === undefined || !Object.is(requested, effective)) {
    throw new TypeError(`Waterfall soak evidence requires matching requested/effective ${label}: ${JSON.stringify({ requested, effective })}`);
  }
  return effective;
}

export function createFingerFluidWaterfallSoakEvidenceIdentity(runtime) {
  if (!runtime || typeof runtime !== 'object') {
    throw new TypeError('Waterfall soak evidence identity requires runtime route/config truth');
  }
  const particleCount = matchingWaterfallEvidenceIdentityValue(
    runtime,
    'requestedParticleCount',
    'effectiveParticleCount',
    'particle count',
  );
  if (particleCount !== runtime.particleCount) {
    throw new TypeError(`Waterfall soak evidence particle-count runtime disagreement: ${JSON.stringify({ particleCount, runtimeParticleCount: runtime.particleCount })}`);
  }
  return normalizeFingerFluidWaterfallSoakEvidenceIdentity({
    schema: KAMINOS_FINGER_FLUID_WATERFALL_SOAK_EVIDENCE_IDENTITY_SCHEMA,
    truthScene: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedTruthScene', 'effectiveTruthScene', 'truth scene'),
    colorMode: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedColorMode', 'effectiveColorMode', 'color mode'),
    rendererMode: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedRendererMode', 'effectiveRendererMode', 'renderer mode'),
    rendererRoute: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedRenderer', 'effectiveRenderer', 'renderer route'),
    solverBackend: runtime.solver_backend,
    renderBackend: runtime.render_backend,
    adapterVendor: runtime.adapterInfo?.vendor,
    adapterArchitecture: runtime.adapterInfo?.architecture,
    opticalDebugMode: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedOpticalDebugMode', 'effectiveOpticalDebugMode', 'optical debug mode'),
    particleCount,
    timeIntegrationContract: runtime.timeIntegrationContract,
    fixedTimeStepSeconds: runtime.fixedTimeStepSeconds,
    solverRoute: runtime.solverRoute,
    shaderRoute: runtime.shaderRoute,
    waterfallContinuityContract: runtime.waterfallContinuityContract,
    supportFriction: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedSupportFriction', 'effectiveSupportFriction', 'support friction'),
    particleShiftStrength: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedParticleShiftStrength', 'effectiveParticleShiftStrength', 'particle shift'),
    chemistryDiffusion: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedChemistryDiffusion', 'effectiveChemistryDiffusion', 'chemistry diffusion'),
    capillaryStrength: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedCapillaryStrength', 'effectiveCapillaryStrength', 'capillary strength'),
    thinSheetVorticityAttenuation: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedThinSheetVorticityAttenuation', 'effectiveThinSheetVorticityAttenuation', 'thin-sheet vorticity attenuation'),
    freeFlightViscosityBoost: matchingWaterfallEvidenceIdentityValue(runtime, 'requestedFreeFlightViscosityBoost', 'effectiveFreeFlightViscosityBoost', 'free-flight viscosity boost'),
    densityIterationsPerStep: runtime.densityIterationsPerStep,
    substeps: runtime.substeps,
  });
}

function normalizeFingerFluidWaterfallSoakEvidenceIdentity(identity) {
  const stringFields = [
    'truthScene',
    'colorMode',
    'rendererMode',
    'rendererRoute',
    'solverBackend',
    'renderBackend',
    'adapterVendor',
    'adapterArchitecture',
    'opticalDebugMode',
    'timeIntegrationContract',
    'solverRoute',
    'shaderRoute',
    'waterfallContinuityContract',
  ];
  const numericFields = [
    'fixedTimeStepSeconds',
    'supportFriction',
    'particleShiftStrength',
    'chemistryDiffusion',
    'capillaryStrength',
    'thinSheetVorticityAttenuation',
    'freeFlightViscosityBoost',
    'densityIterationsPerStep',
    'substeps',
  ];
  if (identity?.schema !== KAMINOS_FINGER_FLUID_WATERFALL_SOAK_EVIDENCE_IDENTITY_SCHEMA) {
    throw new TypeError(`Waterfall soak evidence identity schema mismatch: ${identity?.schema}`);
  }
  for (const field of stringFields) {
    if (typeof identity[field] !== 'string' || identity[field].length === 0) {
      throw new TypeError(`Waterfall soak evidence identity requires ${field}: ${JSON.stringify(identity[field])}`);
    }
  }
  if (!Number.isSafeInteger(identity.particleCount) || identity.particleCount < 1024) {
    throw new TypeError(`Waterfall soak evidence identity requires a valid particleCount: ${identity.particleCount}`);
  }
  for (const field of numericFields) {
    if (!Number.isFinite(identity[field])) {
      throw new TypeError(`Waterfall soak evidence identity requires finite ${field}: ${identity[field]}`);
    }
  }
  return {
    schema: KAMINOS_FINGER_FLUID_WATERFALL_SOAK_EVIDENCE_IDENTITY_SCHEMA,
    ...Object.fromEntries(stringFields.map(field => [field, identity[field]])),
    particleCount: identity.particleCount,
    ...Object.fromEntries(numericFields.map(field => [field, identity[field]])),
  };
}

export function evaluateFingerFluidWaterfallSoakAcceptance({
  requiredTargetSteps,
  horizons,
} = {}) {
  if (!Array.isArray(requiredTargetSteps)
    || requiredTargetSteps.length === 0
    || requiredTargetSteps.some(step => !Number.isSafeInteger(step) || step <= 0)) {
    throw new TypeError(`Waterfall soak acceptance requires positive integer target steps: ${JSON.stringify(requiredTargetSteps)}`);
  }
  if (!Array.isArray(horizons)) throw new TypeError('Waterfall soak acceptance requires horizon evidence');
  if (new Set(requiredTargetSteps).size !== requiredTargetSteps.length) {
    throw new TypeError(`Waterfall soak acceptance requires unique target steps: ${JSON.stringify(requiredTargetSteps)}`);
  }
  const targetStepCounts = new Map();
  const byTargetStep = new Map();
  for (const horizon of horizons) {
    const targetStep = horizon?.requestedTargetStep;
    targetStepCounts.set(targetStep, (targetStepCounts.get(targetStep) || 0) + 1);
    if (!byTargetStep.has(targetStep)) byTargetStep.set(targetStep, horizon);
  }
  const duplicateTargetSteps = requiredTargetSteps.filter(step => (targetStepCounts.get(step) || 0) > 1);
  const missingTargetSteps = requiredTargetSteps.filter(step => !byTargetStep.has(step));
  let commonEvidenceIdentity = null;
  let commonEvidenceIdentityKey = null;
  const evaluatedHorizons = requiredTargetSteps
    .filter(step => byTargetStep.has(step))
    .map(requestedTargetStep => {
      const horizon = byTargetStep.get(requestedTargetStep);
      let evidenceIdentity = null;
      let identityError = null;
      try {
        evidenceIdentity = normalizeFingerFluidWaterfallSoakEvidenceIdentity(
          horizon?.evidenceIdentity ?? horizon?.waterfallSoakEvidenceIdentity,
        );
      } catch (error) {
        identityError = error.message || String(error);
      }
      const evidenceIdentityKey = evidenceIdentity ? JSON.stringify(evidenceIdentity) : null;
      if (evidenceIdentity && commonEvidenceIdentity === null) {
        commonEvidenceIdentity = evidenceIdentity;
        commonEvidenceIdentityKey = evidenceIdentityKey;
      }
      const identityAccepted = evidenceIdentity !== null && evidenceIdentityKey === commonEvidenceIdentityKey;
      if (evidenceIdentity && !identityAccepted) identityError = 'evidence identity differs from the common soak identity';
      const capturedTargetStep = horizon?.capturedTargetStep;
      const captureAccepted = Number.isSafeInteger(capturedTargetStep)
        && capturedTargetStep >= requestedTargetStep
        && capturedTargetStep <= requestedTargetStep + 8;
      const continuityAccepted = horizon?.waterfallContinuityAcceptance?.ok === true
        && Array.isArray(horizon?.waterfallContinuityAcceptance?.waterfalls)
        && horizon.waterfallContinuityAcceptance.waterfalls.length === 3
        && horizon.waterfallContinuityAcceptance.waterfalls.every(waterfall => waterfall?.closeNeighborSupportAccepted === true);
      const imageAccepted = horizon?.waterfallImageContinuity?.ok === true;
      return {
        requestedTargetStep,
        capturedTargetStep,
        evidenceIdentity,
        identityAccepted,
        identityError,
        captureAccepted,
        continuityAccepted,
        imageAccepted,
        ok: identityAccepted && captureAccepted && continuityAccepted && imageAccepted,
      };
    });
  const rejectedTargetSteps = evaluatedHorizons.filter(horizon => !horizon.ok).map(horizon => horizon.requestedTargetStep);
  const identityRejectedTargetSteps = evaluatedHorizons
    .filter(horizon => !horizon.identityAccepted)
    .map(horizon => horizon.requestedTargetStep);
  return {
    schema: 'kaminos.finger-fluid.waterfall-soak-acceptance.v0',
    requiredTargetSteps: [...requiredTargetSteps],
    commonEvidenceIdentity,
    missingTargetSteps,
    duplicateTargetSteps,
    identityRejectedTargetSteps,
    rejectedTargetSteps,
    horizons: evaluatedHorizons,
    ok: missingTargetSteps.length === 0
      && duplicateTargetSteps.length === 0
      && identityRejectedTargetSteps.length === 0
      && rejectedTargetSteps.length === 0,
  };
}

export function measureFingerFluidWaterfallImageContinuity(rgbData, width, height) {
  if (!(rgbData instanceof Uint8Array)) throw new TypeError('Waterfall image continuity requires Uint8Array RGB data');
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError(`Waterfall image continuity requires positive integer dimensions: ${width}x${height}`);
  }
  if (rgbData.length !== width * height * 3) {
    throw new RangeError(`Waterfall image continuity RGB length mismatch: ${rgbData.length} !== ${width * height * 3}`);
  }
  const minX = 0;
  const maxX = Math.max(1, Math.floor(width * 0.72));
  const minY = Math.max(0, Math.floor(height * 0.34));
  const maxY = Math.max(minY + 1, Math.floor(height * 0.64));
  const corridorWidth = maxX - minX;
  const rowLiquidWidthRatios = [];
  const rowLargestRunRatios = [];
  for (let y = minY; y < maxY; y += 1) {
    let liquidPixelCount = 0;
    let currentRun = 0;
    let largestRun = 0;
    for (let x = minX; x < maxX; x += 1) {
      const offset = (y * width + x) * 3;
      const r = rgbData[offset];
      const g = rgbData[offset + 1];
      const b = rgbData[offset + 2];
      const liquid = b >= 58 && b >= r * 1.28 && b >= g * 0.92 && g >= r * 1.02;
      if (liquid) {
        liquidPixelCount += 1;
        currentRun += 1;
        largestRun = Math.max(largestRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    rowLiquidWidthRatios.push(liquidPixelCount / corridorWidth);
    rowLargestRunRatios.push(largestRun / corridorWidth);
  }
  const sortedRatios = [...rowLiquidWidthRatios].sort((a, b) => a - b);
  const sortedRunRatios = [...rowLargestRunRatios].sort((a, b) => a - b);
  const percentile10 = sortedRatios[Math.floor((sortedRatios.length - 1) * 0.10)] || 0;
  const percentile10LargestRun = sortedRunRatios[Math.floor((sortedRunRatios.length - 1) * 0.10)] || 0;
  const minimumRowWidthRatio = sortedRatios[0] || 0;
  const occupiedRowRatio = rowLiquidWidthRatios.filter(ratio => ratio >= 0.08).length / rowLiquidWidthRatios.length;
  const percentileAccepted = percentile10 >= 0.25;
  const minimumRowAccepted = minimumRowWidthRatio >= 0.08;
  const occupiedRowsAccepted = occupiedRowRatio >= 0.95;
  const largestRunAccepted = percentile10LargestRun >= 0.04;
  return {
    schema: 'kaminos.finger-fluid.waterfall-image-continuity.v1',
    measurement: 'same_camera_sphere_debug_rgb24_row_coverage_and_run_v1',
    width,
    height,
    corridor: { minX, maxX, minY, maxY },
    rowCount: rowLiquidWidthRatios.length,
    percentile10LiquidWidthRatio: Number(percentile10.toFixed(5)),
    minimumRequiredPercentile10LiquidWidthRatio: 0.25,
    minimumRowLiquidWidthRatio: Number(minimumRowWidthRatio.toFixed(5)),
    minimumRequiredRowLiquidWidthRatio: 0.08,
    percentile10LargestRunRatio: Number(percentile10LargestRun.toFixed(5)),
    minimumRequiredPercentile10LargestRunRatio: 0.04,
    occupiedRowRatio: Number(occupiedRowRatio.toFixed(5)),
    minimumOccupiedRowRatio: 0.95,
    percentileAccepted,
    minimumRowAccepted,
    occupiedRowsAccepted,
    largestRunAccepted,
    ok: percentileAccepted && minimumRowAccepted && occupiedRowsAccepted && largestRunAccepted,
  };
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

function createMultiRegimePlaygroundParticles(particleCount) {
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

function createLaminarInletParticles(particleCount) {
  const data = new Float32Array(particleCount * PARTICLE_FLOATS);
  const descriptors = createFingerFluidLaminarInletDescriptors();
  for (let index = 0; index < particleCount; index += 1) {
    const sample = sampleFingerFluidLaminarInletParticle(index, descriptors, { particleCount });
    const offset = index * PARTICLE_FLOATS;
    data[offset + 0] = sample.position[0];
    data[offset + 1] = sample.position[1];
    data[offset + 2] = sample.position[2];
    data[offset + 3] = 1;
    data[offset + 4] = sample.position[0];
    data[offset + 5] = sample.position[1];
    data[offset + 6] = sample.position[2];
    data[offset + 7] = 0;
    data[offset + 8] = sample.velocity[0];
    data[offset + 9] = sample.velocity[1];
    data[offset + 10] = sample.velocity[2];
    data[offset + 11] = sample.activeAtFrameZero ? sample.phase : -sample.phase;
  }
  return data;
}

function createPackedTruthSceneParticles(particleCount, {
  center,
  horizontalAspect = [1, 1],
  velocity = [0, 0, 0],
  phase = 0.5,
  spacing = 0.055,
} = {}) {
  const data = new Float32Array(particleCount * PARTICLE_FLOATS);
  const root = Math.cbrt(particleCount);
  const xCount = Math.max(2, Math.ceil(root * horizontalAspect[0]));
  const zCount = Math.max(2, Math.ceil(root * horizontalAspect[1]));
  for (let index = 0; index < particleCount; index += 1) {
    const xIndex = index % xCount;
    const zIndex = Math.floor(index / xCount) % zCount;
    const yIndex = Math.floor(index / (xCount * zCount));
    const jitter = ((index * 1664525 + 1013904223) >>> 8) / 0x00ffffff - 0.5;
    const x = center[0] + (xIndex - (xCount - 1) * 0.5) * spacing + jitter * 0.0025;
    const z = center[1] + (zIndex - (zCount - 1) * 0.5) * spacing + Math.cos(index * 0.19) * 0.0015;
    const y = sampleFingerFluidPlaygroundHeight(x, z) + 0.055 + yIndex * spacing + Math.sin(index * 0.37) * 0.0015;
    const offset = index * PARTICLE_FLOATS;
    data[offset + 0] = x;
    data[offset + 1] = y;
    data[offset + 2] = z;
    data[offset + 3] = 1;
    data[offset + 4] = x;
    data[offset + 5] = y;
    data[offset + 6] = z;
    data[offset + 7] = 0;
    data[offset + 8] = velocity[0];
    data[offset + 9] = velocity[1];
    data[offset + 10] = velocity[2];
    data[offset + 11] = phase;
  }
  return data;
}

export function createFingerFluidTruthSceneParticles(particleCount, scene = 'multi_regime_playground') {
  const safeParticleCount = Math.max(1, Math.floor(finite(particleCount, DEFAULT_PARTICLE_COUNT)));
  const effectiveScene = resolveFingerFluidTruthScene(scene);
  if (effectiveScene === 'multi_regime_playground') return createMultiRegimePlaygroundParticles(safeParticleCount);
  if (effectiveScene === 'laminar_inlets') return createLaminarInletParticles(safeParticleCount);
  if (effectiveScene === 'deep_pool_rest') {
    return createPackedTruthSceneParticles(safeParticleCount, {
      center: [-1.25, 0.58],
      horizontalAspect: [1.1, 1.1],
      phase: 0.66,
    });
  }
  return createPackedTruthSceneParticles(safeParticleCount, {
    center: [-0.25, -1.72],
    horizontalAspect: [1, 0.78],
    phase: 0.45,
  });
}

export function measureFingerFluidTruthSnapshot(particleData, particleCount, {
  scene = 'multi_regime_playground',
  restDensity = 24.3,
  kernelRadius = 0.185,
  sourceRecirculationCount = 0,
} = {}) {
  const effectiveScene = resolveFingerFluidTruthScene(scene);
  const count = Math.max(0, Math.min(Math.floor(finite(particleCount, 0)), Math.floor((particleData?.length || 0) / PARTICLE_FLOATS)));
  const occupancies = new Uint32Array(GRID_CELL_COUNT);
  const densityErrors = [];
  const boundaryDensityErrors = [];
  const bulkDensityErrors = [];
  const centerOfMass = [0, 0, 0];
  let finiteParticleCount = 0;
  let activeParticleCount = 0;
  let dormantParticleCount = 0;
  let retainedParticleCount = 0;
  let totalKineticEnergy = 0;
  let densitySum = 0;
  let maxDensity = 0;
  let maximumBoundaryPenetration = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * PARTICLE_FLOATS;
    const position = [particleData[offset], particleData[offset + 1], particleData[offset + 2]];
    const velocity = [particleData[offset + 8], particleData[offset + 9], particleData[offset + 10]];
    const density = particleData[offset + 15];
    if (![...position, ...velocity, density].every(Number.isFinite)) continue;
    finiteParticleCount += 1;
    const active = effectiveScene !== 'laminar_inlets' || particleData[offset + 11] >= 0;
    if (!active) {
      dormantParticleCount += 1;
      retainedParticleCount += Number(position.every((value, axis) => value >= BOUNDS_MIN[axis] && value <= BOUNDS_MAX[axis]));
      continue;
    }
    activeParticleCount += 1;
    centerOfMass[0] += position[0];
    centerOfMass[1] += position[1];
    centerOfMass[2] += position[2];
    totalKineticEnergy += 0.5 * (velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2);
    densitySum += density;
    maxDensity = Math.max(maxDensity, density);
    const relativeDensityError = Math.abs(density - restDensity) / Math.max(0.001, restDensity);
    densityErrors.push(relativeDensityError);
    const boundary = measureAnalyticBoundaryDistance(position, kernelRadius);
    maximumBoundaryPenetration = Math.max(maximumBoundaryPenetration, boundary.penetration);
    (boundary.distance < kernelRadius ? boundaryDensityErrors : bulkDensityErrors).push(relativeDensityError);
    const inBounds = position.every((value, axis) => value >= BOUNDS_MIN[axis] && value <= BOUNDS_MAX[axis]);
    if (!inBounds) continue;
    retainedParticleCount += 1;
    const coord = position.map((value, axis) => {
      const normalized = clamp((value - BOUNDS_MIN[axis]) / (BOUNDS_MAX[axis] - BOUNDS_MIN[axis]), 0, 0.999999);
      return Math.floor(normalized * GRID_DIMS[axis]);
    });
    const cellIndex = coord[0] + GRID_DIMS[0] * (coord[1] + GRID_DIMS[1] * coord[2]);
    occupancies[cellIndex] += 1;
  }
  const occupied = Array.from(occupancies).filter(value => value > 0).sort((a, b) => a - b);
  const sortedDensityErrors = densityErrors.sort((a, b) => a - b);
  const sortedBoundaryDensityErrors = boundaryDensityErrors.sort((a, b) => a - b);
  const sortedBulkDensityErrors = bulkDensityErrors.sort((a, b) => a - b);
  const percentile = (values, fraction) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] : 0;
  const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const cellSize = BOUNDS_MAX.map((value, axis) => (value - BOUNDS_MIN[axis]) / GRID_DIMS[axis]);
  const cellVolume = cellSize[0] * cellSize[1] * cellSize[2];
  return {
    schema: 'kaminos.finger-fluid-truth-snapshot.v0',
    contract: KAMINOS_FINGER_FLUID_TRUTH_GAUNTLET_CONTRACT,
    boundaryPressureContract: KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT,
    scene: effectiveScene,
    populationMode: effectiveScene === 'multi_regime_playground' || effectiveScene === 'laminar_inlets'
      ? 'finite_source_recirculation'
      : 'closed_particle_population',
    particleCount: count,
    finiteParticleCount,
    activeParticleCount,
    dormantParticleCount,
    retainedParticleCount,
    retainedParticleRatio: Number((retainedParticleCount / Math.max(1, count)).toFixed(6)),
    sourceRecirculationCount,
    centerOfMass: centerOfMass.map(value => Number((value / Math.max(1, activeParticleCount)).toFixed(5))),
    totalKineticEnergy: Number(totalKineticEnergy.toFixed(6)),
    averageKineticEnergy: Number((totalKineticEnergy / Math.max(1, activeParticleCount)).toFixed(6)),
    averageDensity: Number((densitySum / Math.max(1, activeParticleCount)).toFixed(5)),
    maxDensity: Number(maxDensity.toFixed(5)),
    relativeDensityErrorMean: Number((sortedDensityErrors.reduce((sum, value) => sum + value, 0) / Math.max(1, sortedDensityErrors.length)).toFixed(6)),
    relativeDensityErrorP95: Number(percentile(sortedDensityErrors, 0.95).toFixed(6)),
    boundaryParticleCount: sortedBoundaryDensityErrors.length,
    bulkParticleCount: sortedBulkDensityErrors.length,
    boundaryRelativeDensityErrorMean: Number(mean(sortedBoundaryDensityErrors).toFixed(6)),
    boundaryRelativeDensityErrorP95: Number(percentile(sortedBoundaryDensityErrors, 0.95).toFixed(6)),
    bulkRelativeDensityErrorMean: Number(mean(sortedBulkDensityErrors).toFixed(6)),
    bulkRelativeDensityErrorP95: Number(percentile(sortedBulkDensityErrors, 0.95).toFixed(6)),
    maximumBoundaryPenetration: Number(maximumBoundaryPenetration.toFixed(6)),
    occupiedCellCount: occupied.length,
    occupiedVolumeProxy: Number((occupied.length * cellVolume).toFixed(6)),
    maximumCellOccupancy: occupied.at(-1) || 0,
    p95CellOccupancy: percentile(occupied, 0.95),
    gridDimensions: [...GRID_DIMS],
  };
}

export function evaluateFingerFluidTruthTrajectory(scene, trajectory) {
  const effectiveScene = resolveFingerFluidTruthScene(scene);
  if (!Array.isArray(trajectory) || trajectory.length < 2) {
    throw new Error(`Finger fluid truth trajectory requires at least two checkpoints: ${trajectory?.length || 0}`);
  }
  const elapsedTimes = trajectory.map(checkpoint => checkpoint?.elapsedMs);
  if (!elapsedTimes.every(Number.isFinite) || elapsedTimes.some((value, index) => index > 0 && value <= elapsedTimes[index - 1])) {
    throw new Error(`Finger fluid truth trajectory requires finite strictly increasing checkpoint times: ${JSON.stringify(elapsedTimes)}`);
  }
  const elapsedHorizonMs = elapsedTimes.at(-1) - elapsedTimes[0];
  if (effectiveScene === 'deep_pool_rest' && elapsedHorizonMs < 5000) {
    throw new Error(`Deep-pool trajectory requires at least 5000ms after its first checkpoint: ${elapsedHorizonMs}`);
  }
  if (effectiveScene === 'dam_break') {
    if (trajectory.length < 3) throw new Error(`Dam-break trajectory requires at least three checkpoints: ${trajectory.length}`);
    if (elapsedHorizonMs < 7000) {
      throw new Error(`Dam-break trajectory requires at least 7000ms after its first checkpoint: ${elapsedHorizonMs}`);
    }
  }
  let expectedParticleCount = null;
  const snapshots = trajectory.map((checkpoint, index) => {
    const snapshot = checkpoint?.fluidTruthSnapshot;
    if (!snapshot) throw new Error(`Finger fluid truth checkpoint ${index} is missing its snapshot`);
    if (snapshot.schema !== 'kaminos.finger-fluid-truth-snapshot.v0') {
      throw new Error(`Finger fluid truth checkpoint ${index} has invalid snapshot schema: ${snapshot.schema}`);
    }
    if (snapshot.contract !== KAMINOS_FINGER_FLUID_TRUTH_GAUNTLET_CONTRACT) {
      throw new Error(`Finger fluid truth checkpoint ${index} has invalid snapshot contract: ${snapshot.contract}`);
    }
    if (snapshot.scene !== effectiveScene) {
      throw new Error(`Finger fluid truth checkpoint ${index} has mismatched snapshot scene: ${snapshot.scene}; expected ${effectiveScene}`);
    }
    if (
      !Number.isFinite(snapshot.relativeDensityErrorMean)
      || !Number.isFinite(snapshot.relativeDensityErrorP95)
      || snapshot.relativeDensityErrorMean < 0
      || snapshot.relativeDensityErrorP95 < 0
    ) {
      throw new Error(`Finger fluid truth checkpoint ${index} contains invalid density evidence`);
    }
    if (snapshot.boundaryPressureContract !== KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT) {
      throw new Error(`Finger fluid truth checkpoint ${index} has invalid boundary pressure contract: ${snapshot.boundaryPressureContract}`);
    }
    if (!Number.isFinite(snapshot.totalKineticEnergy) || snapshot.totalKineticEnergy < 0) {
      throw new Error(`Finger fluid truth checkpoint ${index} contains invalid kinetic energy evidence`);
    }
    const activeParticleCount = Number.isInteger(snapshot.activeParticleCount)
      ? snapshot.activeParticleCount
      : effectiveScene === 'laminar_inlets' ? NaN : snapshot.finiteParticleCount;
    const dormantParticleCount = Number.isInteger(snapshot.dormantParticleCount)
      ? snapshot.dormantParticleCount
      : effectiveScene === 'laminar_inlets' ? NaN : 0;
    const required = [
      snapshot.particleCount,
      snapshot.finiteParticleCount,
      snapshot.retainedParticleCount,
      snapshot.retainedParticleRatio,
      snapshot.sourceRecirculationCount,
      snapshot.totalKineticEnergy,
      snapshot.relativeDensityErrorMean,
      snapshot.relativeDensityErrorP95,
      snapshot.boundaryParticleCount,
      snapshot.bulkParticleCount,
      snapshot.boundaryRelativeDensityErrorMean,
      snapshot.boundaryRelativeDensityErrorP95,
      snapshot.bulkRelativeDensityErrorMean,
      snapshot.bulkRelativeDensityErrorP95,
      snapshot.maximumBoundaryPenetration,
      snapshot.occupiedCellCount,
      snapshot.occupiedVolumeProxy,
      ...(snapshot.centerOfMass || []),
    ];
    if (required.length !== 20 || !required.every(Number.isFinite)) {
      throw new Error(`Finger fluid truth checkpoint ${index} contains non-finite or partial state`);
    }
    if (
      !Number.isInteger(snapshot.particleCount)
      || !Number.isInteger(snapshot.finiteParticleCount)
      || !Number.isInteger(activeParticleCount)
      || !Number.isInteger(dormantParticleCount)
      || !Number.isInteger(snapshot.retainedParticleCount)
      || !Number.isInteger(snapshot.boundaryParticleCount)
      || !Number.isInteger(snapshot.bulkParticleCount)
      || !Number.isInteger(snapshot.sourceRecirculationCount)
      || snapshot.sourceRecirculationCount < 0
    ) {
      throw new Error(`Finger fluid truth checkpoint ${index} contains invalid population identity`);
    }
    if (activeParticleCount + dormantParticleCount !== snapshot.finiteParticleCount) {
      throw new Error(`Finger fluid truth checkpoint ${index} has inconsistent active/dormant population accounting`);
    }
    if (expectedParticleCount === null) expectedParticleCount = snapshot.particleCount;
    if (snapshot.particleCount !== expectedParticleCount) {
      throw new Error(`Finger fluid truth checkpoint ${index} changed particle identity: ${snapshot.particleCount}; expected ${expectedParticleCount}`);
    }
    if (
      snapshot.particleCount <= 0
      || snapshot.finiteParticleCount !== snapshot.particleCount
      || snapshot.retainedParticleCount !== snapshot.particleCount
      || snapshot.retainedParticleRatio < 0.999999
    ) {
      throw new Error(`Finger fluid truth checkpoint ${index} lost its particle population`);
    }
    if (
      snapshot.boundaryParticleCount < 0
      || snapshot.bulkParticleCount < 0
      || snapshot.boundaryParticleCount + snapshot.bulkParticleCount !== activeParticleCount
      || snapshot.boundaryRelativeDensityErrorMean < 0
      || snapshot.boundaryRelativeDensityErrorP95 < 0
      || snapshot.bulkRelativeDensityErrorMean < 0
      || snapshot.bulkRelativeDensityErrorP95 < 0
      || snapshot.maximumBoundaryPenetration < 0
    ) {
      throw new Error(`Finger fluid truth checkpoint ${index} contains invalid boundary density evidence`);
    }
    if (!Number.isInteger(snapshot.occupiedCellCount) || snapshot.occupiedCellCount < MIN_TRUTH_OCCUPIED_CELL_COUNT) {
      throw new Error(`Finger fluid truth checkpoint ${index} has insufficient occupied support: ${snapshot.occupiedCellCount} cells`);
    }
    if (snapshot.occupiedVolumeProxy < MIN_TRUTH_OCCUPIED_VOLUME) {
      throw new Error(`Finger fluid truth checkpoint ${index} has collapsed absolute support: ${snapshot.occupiedVolumeProxy}; minimum ${MIN_TRUTH_OCCUPIED_VOLUME}`);
    }
    if (effectiveScene !== 'multi_regime_playground' && effectiveScene !== 'laminar_inlets' && snapshot.sourceRecirculationCount !== 0) {
      throw new Error(`Finger fluid truth checkpoint ${index} recirculated a closed population`);
    }
    return snapshot;
  });
  const initial = snapshots[0];
  const final = snapshots.at(-1);
  const energyRetentionRatio = final.totalKineticEnergy / Math.max(1e-6, initial.totalKineticEnergy);
  const minimumSupportRatio = Math.min(...snapshots.map(snapshot => snapshot.occupiedVolumeProxy))
    / Math.max(1e-6, initial.occupiedVolumeProxy);
  const peakSupportExpansionRatio = Math.max(...snapshots.map(snapshot => snapshot.occupiedVolumeProxy))
    / Math.max(1e-6, initial.occupiedVolumeProxy);
  const downstreamDisplacement = final.centerOfMass[2] - initial.centerOfMass[2];
  const verticalCollapse = initial.centerOfMass[1] - final.centerOfMass[1];
  const receipt = {
    contract: 'kaminos-fluid-truth-trajectory-v0',
    scene: effectiveScene,
    checkpointCount: snapshots.length,
    elapsedHorizonMs: Number(elapsedHorizonMs.toFixed(1)),
    energyRetentionRatio: Number(energyRetentionRatio.toFixed(6)),
    minimumSupportRatio: Number(minimumSupportRatio.toFixed(6)),
    peakSupportExpansionRatio: Number(peakSupportExpansionRatio.toFixed(6)),
    downstreamDisplacement: Number(downstreamDisplacement.toFixed(6)),
    verticalCollapse: Number(verticalCollapse.toFixed(6)),
    accepted: true,
  };
  if (effectiveScene === 'deep_pool_rest') {
    if (energyRetentionRatio > 0.35) {
      throw new Error(`Deep-pool trajectory failed to dissipate: energy retention ${receipt.energyRetentionRatio}`);
    }
    if (minimumSupportRatio < 0.7) {
      throw new Error(`Deep-pool trajectory collapsed support volume: minimum ratio ${receipt.minimumSupportRatio}`);
    }
  }
  if (effectiveScene === 'dam_break') {
    if (downstreamDisplacement < 1.2) {
      throw new Error(`Dam-break trajectory failed to travel downstream: displacement ${receipt.downstreamDisplacement}`);
    }
    if (verticalCollapse < 0.8) {
      throw new Error(`Dam-break trajectory failed to collapse vertically: collapse ${receipt.verticalCollapse}`);
    }
    if (energyRetentionRatio > 0.1) {
      throw new Error(`Dam-break trajectory failed to settle: energy retention ${receipt.energyRetentionRatio}`);
    }
    if (peakSupportExpansionRatio < 1.08) {
      throw new Error(`Dam-break trajectory failed to expand transient support: peak ratio ${receipt.peakSupportExpansionRatio}`);
    }
  }
  return receipt;
}

function createInitialMaterialTracers(particleData, particleCount) {
  const data = new Float32Array(particleCount * MATERIAL_TRACER_FLOATS);
  for (let index = 0; index < particleCount; index += 1) {
    const phase = Math.abs(particleData[index * PARTICLE_FLOATS + 11]);
    const offset = index * MATERIAL_TRACER_FLOATS;
    data[offset] = phase;
    data[offset + 1] = 0;
    data[offset + 2] = phase;
    data[offset + 3] = 0;
  }
  return data;
}

function createUnavailableSolver(reason, details = {}) {
  return {
    available: false,
    solver_backend: 'webgpu_unavailable',
    render_backend: 'webgpu_unavailable',
    reason,
    ...details,
    destroy() {},
  };
}

export async function createWebGPUFingerFluidSolver({
  canvas,
  particleCount = DEFAULT_PARTICLE_COUNT,
  densityIterations = 3,
  substeps = 1,
  truthScene = 'multi_regime_playground',
  colorMode = 'phase',
  rendererMode = 'screen_space_surface',
  opticalDebugMode = 'shaded',
  particleShiftStrength = 0,
  supportFriction = KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION,
  chemistryDiffusion = 0,
  capillaryStrength = KAMINOS_FINGER_FLUID_DEFAULT_CAPILLARY_STRENGTH,
  thinSheetVorticityAttenuation = KAMINOS_FINGER_FLUID_DEFAULT_THIN_SHEET_VORTICITY_ATTENUATION,
  freeFlightViscosityBoost = KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST,
  transparentBackground = false,
} = {}) {
  if (!canvas?.getContext) return createUnavailableSolver('missing canvas');
  if (!globalThis.navigator?.gpu) return createUnavailableSolver('navigator.gpu unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return createUnavailableSolver('WebGPU adapter unavailable');
  const requiredStorageBindings = 10;
  if (adapter.limits.maxStorageBuffersPerShaderStage < requiredStorageBindings) {
    return createUnavailableSolver(`WebGPU adapter exposes ${adapter.limits.maxStorageBuffersPerShaderStage} storage buffers per shader stage; liquid/fire composition requires ${requiredStorageBindings}`);
  }
  const device = await adapter.requestDevice({
    requiredLimits: { maxStorageBuffersPerShaderStage: requiredStorageBindings },
  });
  const context = canvas.getContext('webgpu');
  if (!context) return createUnavailableSolver('GPUCanvasContext unavailable');

  const safeParticleCount = resolveFingerFluidParticleCount(particleCount);
  const particleAllocationCapacity = measureFingerFluidParticleAllocationCapacity(device.limits);
  const particleAllocationPreflight = evaluateFingerFluidParticleAllocationRequest(safeParticleCount, particleAllocationCapacity);
  if (!particleAllocationPreflight.ok) {
    return createUnavailableSolver(particleAllocationPreflight.reason, {
      requestedParticleCount: safeParticleCount,
      effectiveParticleCount: null,
      particleAllocationCapacity,
      particleAllocationPreflight,
    });
  }
  const safeDensityIterations = Math.max(1, Math.floor(finite(densityIterations, 3)));
  const safeSubsteps = Math.max(1, Math.floor(finite(substeps, 1)));
  const safeTruthScene = resolveFingerFluidTruthScene(truthScene);
  const analyticSupportVertexCount = ANALYTIC_SUPPORT_BASE_VERTEX_COUNT
    + (safeTruthScene === 'laminar_inlets' ? ANALYTIC_SUPPORT_INLET_FIXTURE_VERTEX_COUNT : 0);
  const safeColorMode = resolveFingerFluidColorMode(colorMode);
  const safeRendererMode = resolveFingerFluidRendererMode(rendererMode);
  const safeOpticalDebugMode = resolveFingerFluidOpticalDebugMode(opticalDebugMode);
  const safeParticleShiftStrength = resolveFingerFluidParticleShiftStrength(particleShiftStrength);
  const safeSupportFriction = resolveFingerFluidSupportFriction(supportFriction);
  const safeChemistryDiffusion = resolveFingerFluidChemistryDiffusion(chemistryDiffusion);
  const safeCapillaryStrength = resolveFingerFluidCapillaryStrength(capillaryStrength);
  const safeThinSheetVorticityAttenuation = resolveFingerFluidThinSheetVorticityAttenuation(thinSheetVorticityAttenuation);
  const safeFreeFlightViscosityBoost = resolveFingerFluidFreeFlightViscosityBoost(freeFlightViscosityBoost);
  const liquidFireContactAllocationGeneration = nextLiquidFireContactAllocationGeneration;
  nextLiquidFireContactAllocationGeneration = (nextLiquidFireContactAllocationGeneration % 0x00fffffe) + 1;
  const liquidFireContactEpoch = 1;
  const particleData = createFingerFluidTruthSceneParticles(safeParticleCount, safeTruthScene);
  const laminarSourcePopulation = safeTruthScene === 'laminar_inlets'
    ? createFingerFluidLaminarSourcePopulation(safeParticleCount)
    : null;
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
    size: 144,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const diagnosticsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-diagnostics-readback',
    size: particleData.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const energyDiagnosticsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-energy-diagnostics',
    size: safeParticleCount * ENERGY_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const energyDiagnosticsReadbackBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-energy-diagnostics-readback',
    size: safeParticleCount * ENERGY_RECORD_BYTES,
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
  const liquidFireContactRecordsBuffer = device.createBuffer({
    label: 'kaminos-liquid-fire-contact-records',
    size: safeParticleCount * LIQUID_FIRE_CONTACT_RECORD_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const liquidFireContactHeaderBuffer = device.createBuffer({
    label: 'kaminos-liquid-fire-contact-header',
    size: LIQUID_FIRE_CONTACT_HEADER_BYTES,
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
  const liquidFireContactHeaderReadbackBuffer = device.createBuffer({
    label: 'kaminos-liquid-fire-contact-header-readback',
    size: LIQUID_FIRE_CONTACT_HEADER_BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  device.queue.writeBuffer(particleBuffer, 0, particleData);
  device.queue.writeBuffer(energyDiagnosticsBuffer, 0, new Float32Array(safeParticleCount * ENERGY_RECORD_FLOATS));
  device.queue.writeBuffer(interfaceCountersBuffer, 0, new Uint32Array(3));
  device.queue.writeBuffer(liquidFireContactHeaderBuffer, 0, new Uint32Array(LIQUID_FIRE_CONTACT_HEADER_WORDS));
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
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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
      clearLiquidFireContacts: await pipelineFor('clear_liquid_fire_contact_descriptor'),
      compactLiquidFireContacts: await pipelineFor('compact_liquid_fire_contacts'),
      finalizeLiquidFireContacts: await pipelineFor('finalize_liquid_fire_contact_descriptor'),
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
      { binding: 9, resource: { buffer: liquidFireContactRecordsBuffer } },
      { binding: 10, resource: { buffer: liquidFireContactHeaderBuffer } },
    ],
  });
  const energyDiagnosticsModule = device.createShaderModule({
    label: KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT,
    code: ENERGY_DIAGNOSTICS_SHADER,
  });
  const energyDiagnosticsLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-energy-diagnostics-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const energyDiagnosticsPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [energyDiagnosticsLayout] });
  const energyPipelineFor = entryPoint => device.createComputePipelineAsync({
    label: `${KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT}:${entryPoint}`,
    layout: energyDiagnosticsPipelineLayout,
    compute: { module: energyDiagnosticsModule, entryPoint },
  });
  let energyPipelines;
  try {
    energyPipelines = {
      projection: await energyPipelineFor('measure_projection_energy'),
      viscosity: await energyPipelineFor('measure_viscosity_energy'),
      vorticity: await energyPipelineFor('measure_vorticity_energy'),
      cohesion: await energyPipelineFor('measure_cohesion_energy'),
    };
  } catch (error) {
    return createUnavailableSolver(`WebGPU energy diagnostic pipeline validation failed: ${error.message || String(error)}`);
  }
  const energyDiagnosticsBindGroup = device.createBindGroup({
    label: 'kaminos-finger-fluid-energy-diagnostics-bind-group',
    layout: energyDiagnosticsLayout,
    entries: [
      { binding: 0, resource: { buffer: particleBuffer } },
      { binding: 1, resource: { buffer: paramsBuffer } },
      { binding: 2, resource: { buffer: energyDiagnosticsBuffer } },
    ],
  });

  const format = navigator.gpu.getPreferredCanvasFormat();
  const canvasAlphaMode = transparentBackground ? 'premultiplied' : 'opaque';
  context.configure({ device, format, alphaMode: canvasAlphaMode, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const renderParamsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-render-params',
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderModule = device.createShaderModule({ label: KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE, code: RENDER_SHADER });
  const screenSpaceModule = device.createShaderModule({ label: KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE, code: SCREEN_SPACE_SURFACE_SHADER });
  const analyticSupportPresentationModule = device.createShaderModule({
    label: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
    code: ANALYTIC_SUPPORT_PRESENTATION_SHADER,
  });
  const screenSpaceAccumulationLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-screen-space-accumulation-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const screenSpaceCompositeLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-screen-space-composite-layout',
    entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ],
  });
  const analyticSupportPresentationLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-analytic-support-presentation-layout',
    entries: [
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const screenSpaceRefractionCompositeLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-screen-space-refraction-composite-layout',
    entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ],
  });
  const screenSpaceAccumulationPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [screenSpaceAccumulationLayout] });
  const screenSpaceCompositePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [screenSpaceCompositeLayout] });
  const analyticSupportPresentationPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [analyticSupportPresentationLayout] });
  const screenSpaceRefractionCompositePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [screenSpaceRefractionCompositeLayout] });
  let renderPipeline;
  let screenSpaceSurfaceAccumulationPipeline;
  let screenSpaceSurfaceCompositePipeline;
  let analyticSupportPresentationPipeline;
  let screenSpaceRefractionCompositePipeline;
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
    screenSpaceSurfaceAccumulationPipeline = await device.createRenderPipelineAsync({
      label: `${KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE}:particle-depth-thickness-accumulation`,
      layout: screenSpaceAccumulationPipelineLayout,
      vertex: { module: screenSpaceModule, entryPoint: 'vs_accumulate' },
      fragment: {
        module: screenSpaceModule,
        entryPoint: 'fs_accumulate',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },
            },
          },
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },
            },
          },
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    screenSpaceSurfaceCompositePipeline = await device.createRenderPipelineAsync({
      label: `${KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE}:edge-preserving-depth-normal-optical-shading`,
      layout: screenSpaceCompositePipelineLayout,
      vertex: { module: screenSpaceModule, entryPoint: 'vs_fullscreen' },
      fragment: {
        module: screenSpaceModule,
        entryPoint: 'fs_composite',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });
    analyticSupportPresentationPipeline = await device.createRenderPipelineAsync({
      label: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
      layout: analyticSupportPresentationPipelineLayout,
      vertex: { module: analyticSupportPresentationModule, entryPoint: 'vs_analytic_support_presentation' },
      fragment: {
        module: analyticSupportPresentationModule,
        entryPoint: 'fs_analytic_support_presentation',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    screenSpaceRefractionCompositePipeline = await device.createRenderPipelineAsync({
      label: `${KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE}:snell-fresnel-absorption-composite`,
      layout: screenSpaceRefractionCompositePipelineLayout,
      vertex: { module: screenSpaceModule, entryPoint: 'vs_fullscreen' },
      fragment: {
        module: screenSpaceModule,
        entryPoint: 'fs_refraction',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
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
  const analyticSupportPresentationBindGroup = device.createBindGroup({
    label: 'kaminos-finger-fluid-analytic-support-presentation-bind-group',
    layout: analyticSupportPresentationLayout,
    entries: [
      { binding: 1, resource: { buffer: renderParamsBuffer } },
    ],
  });

  let screenSpaceSurfaceAccumulationTexture = null;
  let screenSpaceOpticalSlabFrontDepthTexture = null;
  let screenSpaceOpticalSlabBackDepthTexture = null;
  let screenSpaceSurfaceAccumulationBindGroup = null;
  let screenSpaceSurfaceCompositeBindGroup = null;
  let screenSpaceRefractionSceneTexture = null;
  let screenSpaceRefractionCompositeBindGroup = null;
  const screenSpaceRefractionSceneSampler = device.createSampler({
    label: 'kaminos-finger-fluid-refraction-scene-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
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
  let liquidFireContactCompactionPassCount = 0;
  let directRenderFrameCount = 0;
  let sphereDebugRenderFrameCount = 0;
  let screenSpaceSurfaceRenderFrameCount = 0;
  let screenSpaceSurfaceAccumulationPassCount = 0;
  let screenSpaceOpticalSlabGeometryPassCount = 0;
  let screenSpaceSurfaceCompositePassCount = 0;
  let analyticSupportDepthPassCount = 0;
  let analyticSupportPresentationPassCount = 0;
  let particleSupportDrawCount = 0;
  let screenSpaceRefractionRenderFrameCount = 0;
  let screenSpaceRefractionScenePassCount = 0;
  let screenSpaceRefractionCompositePassCount = 0;
  let lastEffectiveRendererMode = safeRendererMode;
  let lastRequestedRendererMode = safeRendererMode;
  let lastOpticalDebugMode = safeOpticalDebugMode;
  let lastRendererFallbackReason = null;
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
    context.configure({ device, format, alphaMode: canvasAlphaMode, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    depthTexture?.destroy();
    depthTexture = device.createTexture({
      label: 'kaminos-finger-fluid-depth',
      size: [targetWidth, targetHeight],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    screenSpaceSurfaceAccumulationTexture?.destroy();
    screenSpaceSurfaceAccumulationTexture = device.createTexture({
      label: 'kaminos-finger-fluid-surface-accumulation',
      size: [targetWidth, targetHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    screenSpaceOpticalSlabFrontDepthTexture?.destroy();
    screenSpaceOpticalSlabFrontDepthTexture = device.createTexture({
      label: 'kaminos-finger-fluid-optical-slab-front-depth',
      size: [targetWidth, targetHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    screenSpaceOpticalSlabBackDepthTexture?.destroy();
    screenSpaceOpticalSlabBackDepthTexture = device.createTexture({
      label: 'kaminos-finger-fluid-optical-slab-back-depth',
      size: [targetWidth, targetHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    screenSpaceRefractionSceneTexture?.destroy();
    screenSpaceRefractionSceneTexture = device.createTexture({
      label: 'kaminos-finger-fluid-refraction-scene-color',
      size: [targetWidth, targetHeight],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    screenSpaceSurfaceAccumulationBindGroup = device.createBindGroup({
      label: 'kaminos-finger-fluid-screen-space-accumulation-bind-group',
      layout: screenSpaceAccumulationLayout,
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 2, resource: { buffer: neighborTopologyBuffer } },
        { binding: 3, resource: { buffer: materialTracerBuffer } },
      ],
    });
    screenSpaceSurfaceCompositeBindGroup = device.createBindGroup({
      label: 'kaminos-finger-fluid-screen-space-composite-bind-group',
      layout: screenSpaceCompositeLayout,
      entries: [
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 4, resource: screenSpaceSurfaceAccumulationTexture.createView() },
      ],
    });
    screenSpaceRefractionCompositeBindGroup = device.createBindGroup({
      label: 'kaminos-finger-fluid-screen-space-refraction-composite-bind-group',
      layout: screenSpaceRefractionCompositeLayout,
      entries: [
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 4, resource: screenSpaceSurfaceAccumulationTexture.createView() },
        { binding: 5, resource: screenSpaceRefractionSceneTexture.createView() },
        { binding: 6, resource: screenSpaceRefractionSceneSampler },
        { binding: 7, resource: screenSpaceOpticalSlabFrontDepthTexture.createView() },
        { binding: 8, resource: screenSpaceOpticalSlabBackDepthTexture.createView() },
      ],
    });
    configuredExtent = key;
    return { width: targetWidth, height: targetHeight };
  }

  function writeSimulationParams(dt) {
    const buffer = new ArrayBuffer(144);
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
    view.setFloat32(100, safeSupportFriction, true);
    view.setFloat32(104, safeTruthScene === 'laminar_inlets' ? 1 : 0, true);
    view.setFloat32(112, safeChemistryDiffusion, true);
    view.setFloat32(116, safeCapillaryStrength, true);
    view.setFloat32(120, safeThinSheetVorticityAttenuation, true);
    view.setFloat32(124, safeFreeFlightViscosityBoost, true);
    view.setUint32(128, liquidFireContactAllocationGeneration, true);
    view.setUint32(132, liquidFireContactEpoch, true);
    view.setUint32(136, LIQUID_FIRE_CONTACT_SOURCE_FRAME_HASH, true);
    view.setUint32(140, 1, true);
    device.queue.writeBuffer(paramsBuffer, 0, buffer);
  }

  function dispatch(pass, pipeline, count) {
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
  }

  function dispatchEnergy(pass, pipeline) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, energyDiagnosticsBindGroup);
    pass.dispatchWorkgroups(Math.ceil(safeParticleCount / WORKGROUP_SIZE));
    pass.setBindGroup(0, computeBindGroup);
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
      dispatchEnergy(pass, energyPipelines.projection);
      dispatch(pass, pipelines.velocity, safeParticleCount);
      dispatchEnergy(pass, energyPipelines.viscosity);
      if (frameIndex % VORTICITY_UPDATE_INTERVAL === 0) {
        dispatch(pass, pipelines.vorticity, safeParticleCount);
        dispatch(pass, pipelines.confinement, safeParticleCount);
        vorticityPassCount += 2;
      }
      dispatchEnergy(pass, energyPipelines.vorticity);
      dispatch(pass, pipelines.cohesion, safeParticleCount);
      surfaceCohesionPassCount += 1;
      dispatchEnergy(pass, energyPipelines.cohesion);
      dispatch(pass, pipelines.applyVelocity, safeParticleCount);
      dispatch(pass, pipelines.clearInterface, 1);
      dispatch(pass, pipelines.compactInterface, safeParticleCount);
      interfaceCompactionPassCount += 1;
      dispatch(pass, pipelines.clearLiquidFireContacts, 1);
      dispatch(pass, pipelines.compactLiquidFireContacts, safeParticleCount);
      dispatch(pass, pipelines.finalizeLiquidFireContacts, 1);
      liquidFireContactCompactionPassCount += 1;
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
    rendererMode = safeRendererMode,
    opticalDebugMode = safeOpticalDebugMode,
  } = {}) {
    if (destroyed) return;
    const extent = ensureExtent(width, height, pixelRatio);
    const requestedRendererMode = String(rendererMode || safeRendererMode);
    const effectiveRendererMode = resolveFingerFluidRendererMode(requestedRendererMode);
    const effectiveOpticalDebugMode = resolveFingerFluidOpticalDebugMode(opticalDebugMode);
    lastRequestedRendererMode = requestedRendererMode;
    lastEffectiveRendererMode = effectiveRendererMode;
    lastOpticalDebugMode = effectiveOpticalDebugMode;
    lastRendererFallbackReason = null;
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
    renderData.set([...up, KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES.indexOf(effectiveOpticalDebugMode)], 20);
    renderData.set([extent.width, extent.height, 0.046, safeParticleCount], 24);
    device.queue.writeBuffer(renderParamsBuffer, 0, renderData);

    const currentTexture = context.getCurrentTexture();
    const currentTextureView = currentTexture.createView();
    const encoder = device.createCommandEncoder({ label: `kaminos-finger-fluid-render-frame:${effectiveRendererMode}` });
    const refractionEnabled = effectiveRendererMode === 'screen_space_refraction';
    const analyticSupportPresentationPass = encoder.beginRenderPass({
      label: `${KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE}:shared-color-depth`,
      colorAttachments: [{
        view: currentTextureView,
        clearValue: transparentBackground
          ? { r: 0, g: 0, b: 0, a: 0 }
          : { r: 0.006, g: 0.012, b: 0.018, a: 1 },
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
    analyticSupportPresentationPass.setPipeline(analyticSupportPresentationPipeline);
    analyticSupportPresentationPass.setBindGroup(0, analyticSupportPresentationBindGroup);
    analyticSupportPresentationPass.draw(analyticSupportVertexCount);
    analyticSupportPresentationPass.end();
    analyticSupportPresentationPassCount += 1;
    analyticSupportDepthPassCount += 1;

    if (refractionEnabled) {
      encoder.copyTextureToTexture(
        { texture: currentTexture },
        { texture: screenSpaceRefractionSceneTexture },
        { width: extent.width, height: extent.height, depthOrArrayLayers: 1 },
      );
      screenSpaceRefractionScenePassCount += 1;
    }

    if (effectiveRendererMode === 'sphere_debug') {
      const pass = encoder.beginRenderPass({
        label: KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
        colorAttachments: [{
          view: currentTextureView,
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(renderPipeline);
      pass.setBindGroup(0, renderBindGroup);
      pass.draw(6, safeParticleCount);
      pass.end();
      sphereDebugRenderFrameCount += 1;
    } else {
      const accumulationPass = encoder.beginRenderPass({
        label: `${KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE}:particle-depth-optical-thickness`,
        colorAttachments: [
          {
            view: screenSpaceSurfaceAccumulationTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 30 },
            loadOp: 'clear',
            storeOp: 'store',
          },
          {
            view: screenSpaceOpticalSlabFrontDepthTexture.createView(),
            clearValue: { r: 30, g: 30, b: 30, a: 30 },
            loadOp: 'clear',
            storeOp: 'store',
          },
          {
            view: screenSpaceOpticalSlabBackDepthTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      accumulationPass.setPipeline(screenSpaceSurfaceAccumulationPipeline);
      accumulationPass.setBindGroup(0, screenSpaceSurfaceAccumulationBindGroup);
      accumulationPass.draw(6, safeParticleCount);
      accumulationPass.end();
      screenSpaceSurfaceAccumulationPassCount += 1;
      screenSpaceOpticalSlabGeometryPassCount += 1;

      const compositePass = encoder.beginRenderPass({
        label: refractionEnabled
          ? `${KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE}:two-interface-optical-slab-composite`
          : `${KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE}:edge-preserving-surface-composite`,
        colorAttachments: [{
          view: currentTextureView,
          clearValue: transparentBackground
            ? { r: 0, g: 0, b: 0, a: 0 }
            : { r: 0.006, g: 0.012, b: 0.018, a: 1 },
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      compositePass.setPipeline(refractionEnabled ? screenSpaceRefractionCompositePipeline : screenSpaceSurfaceCompositePipeline);
      compositePass.setBindGroup(0, refractionEnabled ? screenSpaceRefractionCompositeBindGroup : screenSpaceSurfaceCompositeBindGroup);
      compositePass.draw(3);
      compositePass.end();
      if (refractionEnabled) {
        screenSpaceRefractionCompositePassCount += 1;
        screenSpaceRefractionRenderFrameCount += 1;
      } else {
        screenSpaceSurfaceCompositePassCount += 1;
        screenSpaceSurfaceRenderFrameCount += 1;
      }
    }
    device.queue.submit([encoder.finish()]);
    directRenderFrameCount += 1;
  }

  async function requestDiagnostics() {
    if (diagnosticsPending || destroyed) return diagnostics;
    diagnosticsPending = true;
    diagnosticsRequestCount += 1;
    const diagnosticsStartedAtMs = performance.now();
    const readbackBuffers = [diagnosticsBuffer, energyDiagnosticsReadbackBuffer, interfaceCountersReadbackBuffer, interfaceRecordsReadbackBuffer, restStateReadbackBuffer, neighborTopologyReadbackBuffer, materialTracerReadbackBuffer, liquidFireContactHeaderReadbackBuffer];
    try {
      const diagnosticsStepCount = stepCount;
      const diagnosticsCapturedAtMs = performance.now();
      const encoder = device.createCommandEncoder({ label: 'kaminos-finger-fluid-diagnostics-copy' });
      encoder.copyBufferToBuffer(particleBuffer, 0, diagnosticsBuffer, 0, particleData.byteLength);
      encoder.copyBufferToBuffer(energyDiagnosticsBuffer, 0, energyDiagnosticsReadbackBuffer, 0, safeParticleCount * ENERGY_RECORD_BYTES);
      encoder.copyBufferToBuffer(interfaceCountersBuffer, 0, interfaceCountersReadbackBuffer, 0, 12);
      encoder.copyBufferToBuffer(interfaceRecordsBuffer, 0, interfaceRecordsReadbackBuffer, 0, safeParticleCount * INTERFACE_RECORD_BYTES);
      encoder.copyBufferToBuffer(restStateBuffer, 0, restStateReadbackBuffer, 0, safeParticleCount * REST_STATE_BYTES);
      encoder.copyBufferToBuffer(neighborTopologyBuffer, 0, neighborTopologyReadbackBuffer, 0, safeParticleCount * NEIGHBOR_TOPOLOGY_BYTES);
      encoder.copyBufferToBuffer(materialTracerBuffer, 0, materialTracerReadbackBuffer, 0, safeParticleCount * MATERIAL_TRACER_BYTES);
      encoder.copyBufferToBuffer(liquidFireContactHeaderBuffer, 0, liquidFireContactHeaderReadbackBuffer, 0, LIQUID_FIRE_CONTACT_HEADER_BYTES);
      device.queue.submit([encoder.finish()]);
      const mapResults = await Promise.allSettled(readbackBuffers.map(buffer => buffer.mapAsync(GPUMapMode.READ)));
      const failedMap = mapResults.find(result => result.status === 'rejected');
      if (failedMap) throw failedMap.reason;
      const values = new Float32Array(diagnosticsBuffer.getMappedRange());
      const energyValues = new Float32Array(energyDiagnosticsReadbackBuffer.getMappedRange());
      const interfaceCounters = new Uint32Array(interfaceCountersReadbackBuffer.getMappedRange());
      const interfaceValues = new Float32Array(interfaceRecordsReadbackBuffer.getMappedRange());
      const restStateValues = new Float32Array(restStateReadbackBuffer.getMappedRange());
      const topologyRange = neighborTopologyReadbackBuffer.getMappedRange();
      const topologyValues = new Float32Array(topologyRange);
      const materialTracerValues = new Float32Array(materialTracerReadbackBuffer.getMappedRange());
      const liquidFireContactHeaderWords = new Uint32Array(liquidFireContactHeaderReadbackBuffer.getMappedRange());
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
      let activeParticleCount = 0;
      let dormantParticleCount = 0;
      for (let index = 0; index < safeParticleCount; index += 1) {
        const offset = index * PARTICLE_FLOATS;
        const restOffset = index * REST_STATE_FLOATS;
        const topologyOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 4;
        const chemistryOffset = index * MATERIAL_TRACER_FLOATS;
        const concentration = materialTracerValues[chemistryOffset];
        const recipe = materialTracerValues[chemistryOffset + 2];
        chemistryMass += concentration;
        sourceResetMassAdjustment += materialTracerValues[chemistryOffset + 3];
        chemistryMin = Math.min(chemistryMin, concentration);
        chemistryMax = Math.max(chemistryMax, concentration);
        chemistryRecipeDeviationSum += Math.abs(concentration - recipe);
        chemistryHistogram[Math.min(7, Math.max(0, Math.floor(concentration * 8)))] += 1;
        const active = safeTruthScene !== 'laminar_inlets' || values[offset + 11] >= 0;
        if (!active) {
          dormantParticleCount += 1;
          continue;
        }
        activeParticleCount += 1;
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
      }
      const physicalParticleCount = Math.max(1, activeParticleCount);
      const diffusionMassDrift = chemistryMass - initialChemistryMass - sourceResetMassAdjustment;
      const chemistryMassTolerance = Math.max(0.02, safeParticleCount * 0.000002);
      const activeInterfaceCount = Math.min(interfaceCounters[0], safeParticleCount);
      const liquidFireContactDescriptor = validateLiquidFireContactDescriptorHeader({
        schema: KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA,
        packing: KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING,
        magic: liquidFireContactHeaderWords[0],
        version: liquidFireContactHeaderWords[1],
        allocationGeneration: liquidFireContactHeaderWords[2],
        epoch: liquidFireContactHeaderWords[3],
        writeTick: liquidFireContactHeaderWords[4],
        valid: liquidFireContactHeaderWords[5] === 1,
        complete: liquidFireContactHeaderWords[6] === 1,
        sourceFrameHash: liquidFireContactHeaderWords[7],
        sourceFrameId: liquidFireContactHeaderWords[7] === LIQUID_FIRE_CONTACT_SOURCE_FRAME_HASH ? LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID : 'unknown-source-frame',
        sourceCount: liquidFireContactHeaderWords[8],
        packedCount: liquidFireContactHeaderWords[9],
        contactCount: liquidFireContactHeaderWords[10],
        rejectedCount: liquidFireContactHeaderWords[11],
        capacity: liquidFireContactHeaderWords[12],
        overflowCount: liquidFireContactHeaderWords[13],
        malformedCount: liquidFireContactHeaderWords[14],
        recordWords: liquidFireContactHeaderWords[15],
        flags: liquidFireContactHeaderWords[16],
        diagnosticsStepCount,
        candidateCapMode: 'uncapped_exact_particle_population_capacity',
      }, {
        allocationGeneration: liquidFireContactAllocationGeneration,
        epoch: liquidFireContactEpoch,
        minimumWriteTick: Math.max(0, diagnosticsStepCount - 1),
        sourceFrameId: LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID,
      });
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
      const fluidTruthSnapshot = measureFingerFluidTruthSnapshot(values, safeParticleCount, {
        scene: safeTruthScene,
        restDensity: 24.3,
        sourceRecirculationCount: interfaceCounters[2],
      });
      const energyLedger = summarizeFingerFluidEnergyLedger(energyValues, safeParticleCount, diagnosticsStepCount);
      const waterfallContinuityDiagnostics = safeTruthScene === 'laminar_inlets'
        ? measureFingerFluidWaterfallContinuity(values, restStateValues, safeParticleCount)
        : null;
      diagnostics = {
        readbackMode: 'explicit_sparse_gpu_diagnostics_v0',
        stepCount: diagnosticsStepCount,
        capturedAtMs: Number(diagnosticsCapturedAtMs.toFixed(1)),
        activeExtent3d: {
          min: min.map(value => Number(value.toFixed(4))),
          max: max.map(value => Number(value.toFixed(4))),
          size: max.map((value, axis) => Number((value - min[axis]).toFixed(4))),
        },
        activeParticleCount,
        dormantParticleCount,
        averageSpeed: Number((speedSum / physicalParticleCount).toFixed(4)),
        maxSpeed: Number(maxSpeed.toFixed(4)),
        averageDensity: Number((densitySum / physicalParticleCount).toFixed(4)),
        averageVorticity: Number((vorticitySum / physicalParticleCount).toFixed(4)),
        maxVorticity: Number(maxVorticity.toFixed(4)),
        surfaceParticleCount,
        surfaceParticleRatio: Number((surfaceParticleCount / physicalParticleCount).toFixed(4)),
        averageSurfaceFactor: Number((surfaceFactorSum / physicalParticleCount).toFixed(4)),
        maxSurfaceFactor: Number(maxSurfaceFactor.toFixed(4)),
        restStateContract: KAMINOS_FINGER_FLUID_REST_STATE_CONTRACT,
        supportTransportContract: KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT,
        topologyContract: KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT,
        averageNeighborRetention: Number((neighborRetentionSum / physicalParticleCount).toFixed(4)),
        averageNeighborRetentionAge: Number((neighborRetentionAgeSum / physicalParticleCount).toFixed(4)),
        movingLockedParticleCount,
        movingLockedParticleRatio: Number((movingLockedParticleCount / physicalParticleCount).toFixed(4)),
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
        interfaceChurnRatio: Number((interfaceTransitionCount / physicalParticleCount).toFixed(5)),
        persistentInterfaceParticleCount,
        averageInterfaceAge: Number((interfaceAgeSum / Math.max(1, persistentInterfaceParticleCount)).toFixed(4)),
        supportedRestingParticleCount,
        supportedRestingParticleRatio: Number((supportedRestingParticleCount / physicalParticleCount).toFixed(4)),
        averageSupportRestWeight: Number((supportRestWeightSum / physicalParticleCount).toFixed(4)),
        activeTransportParticleCount,
        activeTransportParticleRatio: Number((activeTransportParticleCount / physicalParticleCount).toFixed(4)),
        supportedTransportParticleCount,
        supportedTransportParticleRatio: Number((supportedTransportParticleCount / physicalParticleCount).toFixed(4)),
        averageSupportedTangentialSpeed: Number((supportedTangentialSpeedSum / Math.max(1, supportedTransportParticleCount)).toFixed(4)),
        energyLedger,
        fluidTruthSnapshot,
        playgroundZoneDiagnostics: playgroundZoneDiagnostics(values, restStateValues, topologyValues, safeParticleCount),
        laminarInletDiagnostics: safeTruthScene === 'laminar_inlets'
          ? measureFingerFluidLaminarInletDiagnostics(values, safeParticleCount)
          : null,
        waterfallContinuityDiagnostics,
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
        liquidFireContactDescriptor,
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

  function getLiquidFireContactDescriptor() {
    return {
      schema: KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA,
      packing: KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING,
      device,
      queue: device.queue,
      headerBuffer: liquidFireContactHeaderBuffer,
      recordsBuffer: liquidFireContactRecordsBuffer,
      headerBytes: LIQUID_FIRE_CONTACT_HEADER_BYTES,
      recordFloats: LIQUID_FIRE_CONTACT_RECORD_FLOATS,
      recordBytes: LIQUID_FIRE_CONTACT_RECORD_BYTES,
      liquidFireContactCapacity: safeParticleCount,
      capacity: safeParticleCount,
      candidateCapMode: 'uncapped_exact_particle_population_capacity',
      allocationGeneration: liquidFireContactAllocationGeneration,
      epoch: liquidFireContactEpoch,
      writeTick: Math.max(0, frameIndex - 1),
      sourceFrame: LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID,
      sourceFrameId: LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID,
      sourceFrameHash: LIQUID_FIRE_CONTACT_SOURCE_FRAME_HASH,
      transformStage: 'consumer-owned',
      completionMode: 'gpu_ordered_clear_compact_finalize_same_compute_pass_v0',
      validitySource: 'gpu_header_only_fail_closed_v0',
    };
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
      boundaryPressureContract: KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT,
      supportFrictionContract: KAMINOS_FINGER_FLUID_SUPPORT_FRICTION_CONTRACT,
      energyLedgerContract: KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT,
      vorticityConfinementContract: KAMINOS_FINGER_FLUID_VORTICITY_CONTRACT,
      freeSurfaceContract: KAMINOS_FINGER_FLUID_FREE_SURFACE_CONTRACT,
      waterfallContinuityContract: KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT,
      interfacePressureContract: KAMINOS_FINGER_FLUID_INTERFACE_PRESSURE_CONTRACT,
      restStateContract: KAMINOS_FINGER_FLUID_REST_STATE_CONTRACT,
      supportTransportContract: KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT,
      topologyContract: KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT,
      particleShiftContract: KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_CONTRACT,
      chemistryContract: KAMINOS_FINGER_FLUID_CHEMISTRY_CONTRACT,
      laminarInletContract: KAMINOS_FINGER_FLUID_LAMINAR_INLET_CONTRACT,
      laminarInlets: safeTruthScene === 'laminar_inlets' ? {
        requestedMode: 'descriptor_laminar_inlets',
        effectiveMode: 'descriptor_laminar_inlets',
        finitePoolAllocation: [0.4, 0.3, 0.3],
        sourcePopulationContract: KAMINOS_FINGER_FLUID_LAMINAR_SOURCE_POPULATION_CONTRACT,
        sourcePopulation: laminarSourcePopulation,
        descriptors: createFingerFluidLaminarInletDescriptors().map(descriptor => ({
          ...descriptor,
          expectedFlux: Number(measureFingerFluidLaminarInletFlux(descriptor).toFixed(6)),
        })),
      } : null,
      truthGauntletContract: KAMINOS_FINGER_FLUID_TRUTH_GAUNTLET_CONTRACT,
      truthScene: safeTruthScene,
      colorMode: safeColorMode,
      particleShiftStrength: safeParticleShiftStrength,
      supportFriction: safeSupportFriction,
      chemistryDiffusion: safeChemistryDiffusion,
      capillaryStrength: safeCapillaryStrength,
      thinSheetVorticityAttenuation: safeThinSheetVorticityAttenuation,
      freeFlightViscosityBoost: safeFreeFlightViscosityBoost,
      obstacleContract: KAMINOS_FINGER_FLUID_OBSTACLE_CONTRACT,
      obstacle: { center: [...OBSTACLE_CENTER], radius: OBSTACLE_RADIUS, rendered: directRenderFrameCount > 0 },
      playgroundContract: KAMINOS_FINGER_FLUID_PLAYGROUND_CONTRACT,
      playground: {
        zones: [...KAMINOS_FINGER_FLUID_PLAYGROUND_ZONES],
        supportGeometryMode: 'shared_analytic_heightfield_mesh_plus_analytic_obstacle_v0',
        supportPresentationRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
        supportGeometryCount: analyticSupportVertexCount,
        supportGeometryCountUnit: 'vertices',
        terrainVertexCount: ANALYTIC_SUPPORT_TERRAIN_VERTEX_COUNT,
        obstacleVertexCount: ANALYTIC_SUPPORT_SPHERE_VERTEX_COUNT,
        inletFixtureContract: KAMINOS_FINGER_FLUID_LAMINAR_FIXTURE_CONTRACT,
        inletFixtureCollisionMode: 'implicit_prescribed_inlet_core_no_separate_mesh_collision_v0',
        inletFixtureVertexCount: safeTruthScene === 'laminar_inlets' ? ANALYTIC_SUPPORT_INLET_FIXTURE_VERTEX_COUNT : 0,
        inletFixtures: safeTruthScene === 'laminar_inlets' ? [
          { id: 'round-spout', presentation: 'open_round_tube', vertexCount: ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT },
          { id: 'slot-spout', presentation: 'open_rectangular_duct', vertexCount: ANALYTIC_SUPPORT_SLOT_INLET_VERTEX_COUNT },
          { id: 'porous-patch', presentation: 'homogenized_visual_boundary_not_resolved_pore_geometry', vertexCount: ANALYTIC_SUPPORT_POROUS_INLET_VERTEX_COUNT },
        ] : [],
        obstacleCount: PLAYGROUND_OBSTACLE_COUNT,
        particleSupportDrawCount,
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
      liquidFireContactDescriptor: diagnostics?.liquidFireContactDescriptor || {
        schema: KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA,
        packing: KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING,
        sourceFrame: LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID,
        sourceFrameId: LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID,
        sourceFrameHash: LIQUID_FIRE_CONTACT_SOURCE_FRAME_HASH,
        transformStage: 'consumer-owned',
        allocationGeneration: liquidFireContactAllocationGeneration,
        epoch: liquidFireContactEpoch,
        writeTick: Math.max(0, frameIndex - 1),
        liquidFireContactCapacity: safeParticleCount,
        capacity: safeParticleCount,
        candidateCapMode: 'uncapped_exact_particle_population_capacity',
        headerBytes: LIQUID_FIRE_CONTACT_HEADER_BYTES,
        recordFloats: LIQUID_FIRE_CONTACT_RECORD_FLOATS,
        recordBytes: LIQUID_FIRE_CONTACT_RECORD_BYTES,
        completionMode: 'gpu_ordered_clear_compact_finalize_same_compute_pass_v0',
        valid: false,
        complete: false,
      },
      playgroundZoneDiagnostics: diagnostics?.playgroundZoneDiagnostics || null,
      laminarInletDiagnostics: diagnostics?.laminarInletDiagnostics || null,
      waterfallContinuityDiagnostics: diagnostics?.waterfallContinuityDiagnostics || null,
      fluidTruthSnapshot: diagnostics?.fluidTruthSnapshot || null,
      energyLedger: diagnostics?.energyLedger || null,
      sourceRecirculationMode: safeTruthScene === 'multi_regime_playground'
        ? 'material_tagged_finite_particle_loop_v0'
        : safeTruthScene === 'laminar_inlets'
          ? 'descriptor_laminar_inlet_finite_particle_loop_v0'
        : 'closed_particle_population_no_source_recirculation_v0',
      sourceRecirculationCount: diagnostics?.sourceRecirculationCount || 0,
      stabilityContract: KAMINOS_FINGER_FLUID_STABILITY_CONTRACT,
      requestedRendererMode: lastRequestedRendererMode,
      effectiveRendererMode: lastEffectiveRendererMode,
      requestedRenderer: rendererRouteForMode(lastRequestedRendererMode),
      effectiveRenderer: rendererRouteForMode(lastEffectiveRendererMode),
      fallbackReason: lastRendererFallbackReason,
      renderRoute: rendererRouteForMode(lastEffectiveRendererMode),
      opticalDebugMode: lastOpticalDebugMode,
      opticalTransportRoute: KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE,
      sphereDebugRendererRoute: KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
      screenSpaceSurfaceRendererRoute: KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
      screenSpaceRefractionRendererRoute: KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
      renderShaderRoute: KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE,
      screenSpaceSurfaceShaderRoute: KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE,
      analyticSupportDepthRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
      analyticSupportPresentationRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
      particleCount: safeParticleCount,
      particleAllocationCapacity,
      particleAllocationPreflight,
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
      liquidFireContactCompactionPassCount,
      sphereDebugRenderFrameCount,
      screenSpaceSurfaceRenderFrameCount,
      screenSpaceSurfaceAccumulationPassCount,
      screenSpaceOpticalSlabGeometryPassCount,
      screenSpaceSurfaceCompositePassCount,
      analyticSupportDepthPassCount,
      analyticSupportPresentationPassCount,
      particleSupportDrawCount,
      screenSpaceRefractionRenderFrameCount,
      screenSpaceRefractionScenePassCount,
      screenSpaceRefractionCompositePassCount,
      supportPresentationEvidence: {
        route: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
        depthRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
        colorDepthAuthority: 'same_pass_same_analytic_geometry_v0',
        geometrySource: 'toyFloorHeight_toyFloorNormal_plus_analytic_obstacle_v0',
        calibrationLandmarks: 'world_anchored_half_unit_grid_major_grid_and_axes_v0',
        refractionCaptureOrder: 'copy_after_analytic_support_presentation_v0',
        passCount: analyticSupportPresentationPassCount,
        particleSupportDrawCount,
      },
      screenSpaceSurfaceEvidence: {
        route: KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
        shaderRoute: KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE,
        supportDepthRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
        analyticSupportDepthPassCount,
        accumulationTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-surface-accumulation',
          format: 'rgba16float',
          extent: configuredExtent,
          channels: ['optical_thickness', 'material_weighted_thickness', 'depth_weight', 'nearest_particle_center_view_depth'],
        } : null,
        accumulationPassCount: screenSpaceSurfaceAccumulationPassCount,
        compositePassCount: screenSpaceSurfaceCompositePassCount,
        smoothing: 'edgePreservingDepth',
        normalReconstruction: 'reconstructSurfaceNormal',
        shading: 'fresnel_specular_absorption_from_particle_depth_plus_optical_thickness_v0',
      },
      refractionEvidence: {
        route: KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
        shaderRoute: KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE,
        opticalTransportRoute: KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE,
        slabRoute: KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE,
        slabGeometryPassCount: screenSpaceOpticalSlabGeometryPassCount,
        frontDepthTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-optical-slab-front-depth',
          format: 'rgba16float',
          extent: configuredExtent,
          channel: 'projected_particle_sphere_front_view_depth_min',
        } : null,
        backDepthTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-optical-slab-back-depth',
          format: 'rgba16float',
          extent: configuredExtent,
          channel: 'projected_particle_sphere_back_view_depth_max',
        } : null,
        slabGeometry: 'projected_particle_interval_hull_not_watertight_surface_v0',
        invalidSlabDisposition: 'entry_interface_only_no_exit_claim_v0',
        supportDepthRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
        analyticSupportDepthPassCount,
        opticalDebugMode: lastOpticalDebugMode,
        sceneColorTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-refraction-scene-color',
          format,
          extent: configuredExtent,
          source: 'same-camera-analytic-support-presentation-color-v0',
        } : null,
        scenePassCount: screenSpaceRefractionScenePassCount,
        accumulationPassCount: screenSpaceSurfaceAccumulationPassCount,
        compositePassCount: screenSpaceRefractionCompositePassCount,
        refraction: 'bounded_air_to_water_slab_propagation_water_to_air_snell_v0',
        fresnel: 'schlick_f0_0.02037_v0',
        absorption: 'beer_lambert_from_particle_optical_thickness_v0',
      },
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
    energyDiagnosticsBuffer.destroy();
    energyDiagnosticsReadbackBuffer.destroy();
    interfaceRecordsBuffer.destroy();
    interfaceCountersBuffer.destroy();
    liquidFireContactRecordsBuffer.destroy();
    liquidFireContactHeaderBuffer.destroy();
    restStateBuffer.destroy();
    neighborTopologyBuffer.destroy();
    materialTracerBuffer.destroy();
    interfaceCountersReadbackBuffer.destroy();
    interfaceRecordsReadbackBuffer.destroy();
    restStateReadbackBuffer.destroy();
    neighborTopologyReadbackBuffer.destroy();
    materialTracerReadbackBuffer.destroy();
    liquidFireContactHeaderReadbackBuffer.destroy();
    renderParamsBuffer.destroy();
    depthTexture?.destroy();
    screenSpaceSurfaceAccumulationTexture?.destroy();
    screenSpaceOpticalSlabFrontDepthTexture?.destroy();
    screenSpaceOpticalSlabBackDepthTexture?.destroy();
    screenSpaceRefractionSceneTexture?.destroy();
  }

  device.lost.then(info => {
    destroyed = true;
    console.error('Kaminos Finger Fluid WebGPU device lost:', info.message || info.reason);
  });

  return {
    available: true,
    solver_backend: 'webgpu_compute',
    render_backend: 'webgpu_direct_render',
    renderer_mode: safeRendererMode,
    step,
    render,
    requestDiagnostics,
    getLiquidFireContactDescriptor,
    getDebugState,
    destroy,
  };
}
