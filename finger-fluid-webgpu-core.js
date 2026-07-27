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
export const KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT = 'wgsl-live-hand-round-inlet-uniform-v1';
export const KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT = 'gpu-material-tracer-release-age-v0';
export const KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT = 'gpu-dormant-pool-source-flux-release-v0';
export const KAMINOS_FINGER_FLUID_LIVE_INLET_SOURCE_AUTHORITY_CONTRACT = 'new-release-fail-closed-emitted-material-persists-v0';
export const KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT = 'requested-effective-release-pool-residence-v1';
export const KAMINOS_FINGER_FLUID_LIVE_INLET_COHORT_CONTRACT = 'gpu-particle-residence-cohort-v0';
export const KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT =
  'gpu-spatial-first-support-contact-ownership-v0';
export const KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING =
  'material-tracer-vec4-index-4-phase-source-generation-transition-frame-support-contact-v0';
export const KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES = Object.freeze({
  dormant: 0,
  preImpact: 1,
  postImpact: 2,
});
export const KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD = 0.5;
export const KAMINOS_FINGER_FLUID_RUNTIME_ROUTE = 'kaminos/finger-fluid/webgpu-core-v0';
export const KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE =
  'kaminos/finger-fluid/analytic-support-contact-diagnostic-v0';
export const KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE =
  'lerms/hill-of-hills/gpu-moving-support-contact-v0';
export const KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_EXECUTION =
  'gpu_same_device_moving_hill_signed_distance_v0';
export const KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_PROVIDER_SCHEMA =
  'kaminos.finger-fluid.moving-hill-support-contact-provider.v0';
export const KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_OWNER = 'lerms_hill_of_hills';
export const KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_SAMPLE_STRIDE_FLOATS = 8;
export const KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT = 'wgsl-support-aware-symmetric-capillary-sheet-v0';
export const KAMINOS_FINGER_FLUID_UNSUPPORTED_SHEET_CONTRACT = 'wgsl-anisotropic-unsupported-sheet-support-v0';
export const KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTIC_CONTRACT = 'wgsl-per-particle-sheet-release-diagnostic-channels-v0';
export const KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTICS_SCHEMA = 'kaminos.finger-fluid.sheet-release-diagnostics.v0';
export const KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES = Object.freeze({
  active: 0,
  disabled: 1,
  dormant: 2,
  low_transport_speed: 3,
  support_contact: 4,
  density_loss: 5,
  bulk_density: 6,
  not_interface: 7,
  topology_loss: 8,
  neighbor_loss: 9,
  velocity_incoherent: 10,
  not_planar: 11,
  inlet_core: 12,
  activity_floor: 13,
});
const KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASONS_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES).map(([reason, code]) => [code, reason]),
));
export const KAMINOS_FINGER_FLUID_INTERFACE_PRESSURE_CONTRACT = 'wgsl-unilateral-free-surface-pressure-v0';
export const KAMINOS_FINGER_FLUID_WATERFALL_DIAGNOSTICS_SCHEMA = 'kaminos.finger-fluid.waterfall-continuity-diagnostics.v0';
export const KAMINOS_FINGER_FLUID_WATERFALL_SOAK_EVIDENCE_IDENTITY_SCHEMA = 'kaminos.finger-fluid.waterfall-soak-evidence-identity.v0';
export const KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT = 'isolated-slot-waterfall-uniform-resolution-oracle-v0';
export const KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA = 'kaminos.finger-fluid.waterfall-resolution-oracle-evidence.v0';
export const KAMINOS_FINGER_FLUID_PULSE_DRAINAGE_CONTRACT = 'fixed-step-source-cutoff-drainage-v0';
export const KAMINOS_FINGER_FLUID_SOURCE_RELEASE_SCHEDULE_CONTRACT = 'fractional-lane-error-diffusion-v0';
export const KAMINOS_FINGER_FLUID_PARTICLE_ALLOCATION_PREFLIGHT_CONTRACT = 'webgpu-device-limit-derived-particle-allocation-preflight-v0';
export const KAMINOS_FINGER_FLUID_DEFAULT_CAPILLARY_STRENGTH = 0.72;
export const KAMINOS_FINGER_FLUID_DEFAULT_THIN_SHEET_VORTICITY_ATTENUATION = 0.88;
export const KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST = 0.17;
export const KAMINOS_FINGER_FLUID_DEFAULT_UNSUPPORTED_SHEET_STRENGTH = 0;
export const KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT = 49_152;
export const KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS = 1 / 60;
export const KAMINOS_FINGER_FLUID_BENCH_TIME_INTEGRATION_CONTRACT = 'fixed-step-60hz-one-simulation-step-per-render-frame-v0';
export const KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_SCHEMA = 'kaminos.liquid-fire-contact-descriptor.v1';
export const KAMINOS_LIQUID_FIRE_CONTACT_DESCRIPTOR_PACKING = 'gpu-sparse-liquid-fire-contact-source-vec4x8-v1';
export const KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE = 'webgpu-particle-sphere-renderer-v0';
export const KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE = 'webgpu-screen-space-liquid-surface-v0';
export const KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE = 'webgpu-screen-space-liquid-refraction-v0';
export const KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE = 'snell-two-interface-screen-space-slab-v0';
export const KAMINOS_FINGER_FLUID_TRANSPORT_ONLY_LIGHTING_ROUTE = 'wgsl-liquid-transport-only-lighting-v0';
export const KAMINOS_FINGER_FLUID_BOUNDED_GGX_LIGHTING_ROUTE = 'wgsl-liquid-bounded-ggx-lighting-v0';
export const KAMINOS_FINGER_FLUID_LEGACY_SHADING_ROUTE = 'wgsl-liquid-legacy-shading-v0';
export const KAMINOS_FINGER_FLUID_LIGHTING_NOT_EXECUTED_ROUTE = 'not-executed-non-refraction-renderer-v0';
export const KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE = 'wgsl-particle-projected-front-back-slab-v0';
export const KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE = 'webgpu-particle-sphere-debug-renderer-v0';
export const KAMINOS_FINGER_FLUID_GPU_SHADER_ROUTE = 'wgsl-pbf-linked-cell-fluid-v0';
export const KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE = 'wgsl-fluid-particle-sphere-v0';
export const KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE = 'wgsl-fluid-screen-space-surface-v0';
export const KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE = 'wgsl-analytic-heightfield-obstacle-depth-v0';
export const KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE = 'wgsl-analytic-heightfield-obstacle-presentation-v0';
export const KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE = 'webgpu-deferred-indexed-mesh-scene-v0';
export const KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE = 'wgsl-indexed-mesh-world-space-reflection-v0';
export const KAMINOS_FINGER_FLUID_REFLECTION_QUERY_SCHEMA = 'kaminos.reflection-query-provider.v0';
export const KAMINOS_FINGER_FLUID_OPTICAL_QUERY_SCHEMA = 'kaminos.optical-query-provider.v0';
export const KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE = 'wgsl-hybrid-deferred-world-optical-query-v0';
export const KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE = 'wgsl-deferred-linear-depth-ray-traversal-v0';
export const KAMINOS_FINGER_FLUID_INTERFACE_FIDELITY_ROUTE = 'wgsl-regime-aware-interface-footprint-v0';
export const KAMINOS_FINGER_FLUID_OPTICAL_QUERY_RESOLVER_ORDER = 'deferred_depth_then_uncapped_world_mesh_then_hdr_environment-v0';
export const KAMINOS_FINGER_FLUID_REFLECTION_ACCELERATION_ROUTE = 'uncapped-exact-triangle-scan-v0';
export const KAMINOS_FINGER_FLUID_REFLECTION_QUADRATURE_ROUTE = 'deterministic-five-ray-cone-quadrature-v0';
export const KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_REFLECTION_QUADRATURE_ROUTE = 'deterministic-nine-ray-trimmed-variance-footprint-quadrature-v0';
export const KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE = 'wgsl-liquid-resolved-detail-reflection-footprint-v0';
export const KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE = 'wgsl-liquid-dense-variance-filtered-reflection-footprint-v0';
export const KAMINOS_FINGER_FLUID_FOOTPRINT_NOT_EXECUTED_ROUTE = 'not-executed-non-refraction-renderer-v0';
export const KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE = 'wgsl-liquid-resolved-exit-transmission-footprint-v0';
export const KAMINOS_FINGER_FLUID_DENSE_EXIT_TRANSMISSION_FOOTPRINT_ROUTE = 'wgsl-liquid-dense-variance-filtered-exit-transmission-footprint-v0';
export const KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_NOT_EXECUTED_ROUTE = 'not-executed-non-refraction-renderer-v0';
export const KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_ROUTE = 'deterministic-one-ray-exit-transport-v0';
export const KAMINOS_FINGER_FLUID_DENSE_EXIT_TRANSMISSION_QUADRATURE_ROUTE = 'deterministic-five-ray-trimmed-exit-footprint-quadrature-v0';
export const KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE = 'wgsl-liquid-geometric-slab-body-transport-v0';
export const KAMINOS_FINGER_FLUID_ROBUST_DENSE_BODY_TRANSPORT_ROUTE = 'wgsl-liquid-robust-dense-body-transport-v1';
export const KAMINOS_FINGER_FLUID_BODY_TRANSPORT_NOT_EXECUTED_ROUTE = 'not-executed-non-refraction-renderer-v0';
export const KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE = 'wgsl-liquid-coupled-detail-interface-frequency-v0';
export const KAMINOS_FINGER_FLUID_MACRO_MICRO_INTERFACE_FREQUENCY_ROUTE = 'wgsl-liquid-macro-micro-interface-frequency-v1';
export const KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_NOT_EXECUTED_ROUTE = 'not-executed-non-refraction-renderer-v0';
export const KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE = 'radiance-rgbe-equirectangular-environment-v0';
export const KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE = 'webgpu-linear-hdr-scene-radiance-v0';
export const KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE = 'wgsl-shared-hdr-world-background-v0';
export const KAMINOS_FINGER_FLUID_ENVIRONMENT_FILTER_ROUTE = 'deterministic-five-tap-roughness-cone-v0';
export const KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE = 'wgsl-linear-exposure-aces-presentation-v0';
export const KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_ID = 'polyhaven-studio-small-09-1k';
export const KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SHA256 = 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45';
export const KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_URL = './assets/hdr/studio_small_09_1k.hdr';
export const KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_ASSET_URL = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';
export const KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_PAGE_URL = 'https://polyhaven.com/a/studio_small_09';
export const KAMINOS_FINGER_FLUID_STABILITY_CONTRACT = 'bounded-pbf-energy-v0';
export const KAMINOS_FINGER_FLUID_TRUTH_GAUNTLET_CONTRACT = 'kaminos-fluid-truth-gauntlet-v0';
export const KAMINOS_FINGER_FLUID_ADAPTIVE_DENSITY_CONTRACT = 'deterministic-binary-volume-weighted-sheet-refinement-v0';
export const KAMINOS_FLUID_REPRESENTATION_FRAME_SCHEMA = 'kaminos.fluid.representation-frame.v1';
export const KAMINOS_FLUID_REPRESENTATION_FRAME_ROUTE = 'kaminos/fluid/representation-frame';
export const KAMINOS_FLUID_REPRESENTATION_OWNERSHIP_IDENTITY = 'macro-local-parcel-exclusive-v1';
export const KAMINOS_FLUID_PACKAGE_DESCRIPTOR_SCHEMA = 'kaminos.fluid.package-descriptor.v1';
export const KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_CAPABILITY = 'kaminos.fluid.portable-macro-source.v1';
export const KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_ROUTE = 'kaminos/fluid/portable-macro-source';
export const KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_HANDLE_SCHEMA = 'kaminos.fluid.portable-macro-source-handle.v1';
export const KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_SNAPSHOT_SCHEMA = 'kaminos.fluid.portable-macro-source-snapshot.v1';
export const KAMINOS_FINGER_FLUID_PORTABLE_MACRO_PROVIDER_SCHEMA = 'kaminos.finger-fluid.portable-macro-geometry-provider.v1';
export const KAMINOS_FINGER_FLUID_PORTABLE_MACRO_PROVIDER_ROUTE = 'kaminos/finger-fluid/portable-macro-geometry-provider';
export const KAMINOS_FINGER_FLUID_PORTABLE_MACRO_UPLOAD_SCHEMA = 'kaminos.finger-fluid.portable-macro-upload-snapshot.v1';
export const KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_GEOMETRY_SCHEMA = 'kaminos.finger-fluid.analytic-carrier-optical-geometry.v2';
export const KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_ROUTE = 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0';
export const KAMINOS_FINGER_FLUID_OPTICAL_TRANSITION_SCHEMA = 'kaminos.finger-fluid.optical-representation-transition.v1';
export const KAMINOS_FINGER_FLUID_OPTICAL_EXECUTION_SCHEMA = 'kaminos.finger-fluid.optical-execution.v1';
export const KAMINOS_FINGER_FLUID_CHANGING_FRAME_OPTICS_ROUTE = 'webgpu-watershed-changing-frame-optics-v1';
export const KAMINOS_FINGER_FLUID_OPTICAL_TIMING_ROUTE = 'webgpu-timestamp-query-optical-pass-v1';
const KAMINOS_FLUID_PACKAGE_VERSION = '0.3.0';
const KAMINOS_FLUID_PACKAGE_RUNTIME_ROUTE = 'kaminos/fluid/mapped-orthogonal-heightfield-hll-reference-v1';

function representationFrameFailure(message) {
  throw new Error(`Fluid representation frame ${message}`);
}

function representationFrameString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    representationFrameFailure(`${label} is missing`);
  }
  return value;
}

function representationFrameFinite(value, label, { positive = false, nonNegative = false } = {}) {
  if (
    !Number.isFinite(value)
    || (positive && value <= 0)
    || (nonNegative && value < 0)
  ) {
    representationFrameFailure(`${label} is invalid: ${value}`);
  }
  return value;
}

function representationFrameTypedArray(value, length, label, { nonNegative = false } = {}) {
  if (!ArrayBuffer.isView(value) || value instanceof DataView || value.length !== length) {
    representationFrameFailure(`${label} sample count is invalid`);
  }
  for (let index = 0; index < value.length; index += 1) {
    representationFrameFinite(value[index], `${label}[${index}]`, { nonNegative });
  }
}

function representationFrameGrid(value, label) {
  if (!value || typeof value !== 'object') {
    representationFrameFailure(`${label} is missing`);
  }
  if (
    !Number.isInteger(value.width)
    || value.width <= 0
    || !Number.isInteger(value.height)
    || value.height <= 0
  ) {
    representationFrameFailure(`${label} dimensions are invalid`);
  }
  if (
    !Array.isArray(value.spacing)
    || value.spacing.length !== 2
    || !value.spacing.every(component => Number.isFinite(component) && component > 0)
    || !Array.isArray(value.origin)
    || value.origin.length !== 3
    || !value.origin.every(Number.isFinite)
  ) {
    representationFrameFailure(`${label} metric is invalid`);
  }
  return value;
}

function movingHillSupportFailure(message) {
  throw new Error(`Finger fluid moving Hill support ${message}`);
}

function movingHillSupportString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    movingHillSupportFailure(`${label} is missing`);
  }
  return value;
}

function movingHillSupportEpoch(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    movingHillSupportFailure(`${label} is invalid: ${value}`);
  }
  return value;
}

function movingHillSupportField(frame, field, length) {
  const value = frame.fields?.[field];
  if (!ArrayBuffer.isView(value) || value instanceof DataView || value.length !== length) {
    movingHillSupportFailure(`${field} sample count is invalid`);
  }
  return value;
}

function validateMovingHillTerrainFrame(terrainFrame, identity) {
  if (!terrainFrame || terrainFrame.schema !== 'kaminos.fluid.terrain-fluid-frame.v1') {
    movingHillSupportFailure('canonical terrain frame schema is invalid');
  }
  if (terrainFrame.supportClass !== 'heightfield') {
    movingHillSupportFailure(`support class must be heightfield, received ${terrainFrame.supportClass}`);
  }
  if (terrainFrame.complete !== true) {
    movingHillSupportFailure('canonical terrain frame must be complete');
  }
  if (terrainFrame.worldMetersPerUnit !== 1) {
    movingHillSupportFailure('canonical terrain frame must use one world meter per unit');
  }
  const grid = representationFrameGrid(terrainFrame.grid, 'moving Hill support grid');
  const sampleCount = grid.width * grid.height;
  if (
    terrainFrame.expectedSampleCount !== sampleCount
    || terrainFrame.actualSampleCount !== sampleCount
  ) {
    movingHillSupportFailure('canonical terrain frame sample accounting is incomplete');
  }
  movingHillSupportField(terrainFrame, 'bedHeight', sampleCount);
  movingHillSupportField(terrainFrame, 'normal', sampleCount * 3);
  movingHillSupportField(terrainFrame, 'supportVelocity', sampleCount * 3);
  const valid = movingHillSupportField(terrainFrame, 'valid', sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    if (valid[index] !== 1) {
      movingHillSupportFailure(`valid support sample ${index} is unavailable`);
    }
  }
  if (!identity || typeof identity !== 'object') {
    movingHillSupportFailure('identity is missing');
  }
  const terrainId = movingHillSupportString(identity.terrainId, 'terrain id');
  const sourceId = movingHillSupportString(identity.sourceId, 'source id');
  if (terrainId !== terrainFrame.terrainId) {
    movingHillSupportFailure('terrain id diverges from the canonical terrain frame');
  }
  if (sourceId !== terrainFrame.source?.effective) {
    movingHillSupportFailure('source id diverges from the canonical terrain frame');
  }
  const terrainEpoch = movingHillSupportEpoch(identity.terrainEpoch, 'terrain epoch');
  if (terrainEpoch !== terrainFrame.currentEpoch) {
    movingHillSupportFailure('terrain epoch diverges from the canonical terrain frame');
  }
  const supportEpoch = movingHillSupportEpoch(identity.supportEpoch, 'support epoch');
  const remapEpoch = movingHillSupportEpoch(identity.remapEpoch, 'remap epoch');
  if (identity.stale !== false) {
    movingHillSupportFailure('identity is stale');
  }
  if (identity.fallbackRoute !== null) {
    movingHillSupportFailure('identity declares a fallback route');
  }
  return {
    grid,
    sampleCount,
    sourceId,
    terrainId,
    terrainEpoch,
    supportEpoch,
    remapEpoch,
  };
}

export function createFingerFluidMovingHillSupportContactProvider({
  device,
  terrainFrame,
  identity,
} = {}) {
  if (
    !device?.createBuffer
    || !device.createTexture
    || !device.queue?.writeBuffer
    || !device.queue.writeTexture
  ) {
    movingHillSupportFailure('GPU device is missing');
  }
  const packFrame = (nextTerrainFrame, nextIdentity) => {
    const validated = validateMovingHillTerrainFrame(nextTerrainFrame, nextIdentity);
    const bedHeight = nextTerrainFrame.fields.bedHeight;
    const normal = nextTerrainFrame.fields.normal;
    const supportVelocity = nextTerrainFrame.fields.supportVelocity;
    const rowBytes = validated.grid.width * 4 * Float32Array.BYTES_PER_ELEMENT;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const rowStrideFloats = bytesPerRow / Float32Array.BYTES_PER_ELEMENT;
    const rowsPerLayer = validated.grid.height;
    const samples = new Float32Array(rowStrideFloats * rowsPerLayer * 2);
    for (let index = 0; index < validated.sampleCount; index += 1) {
      const x = index % validated.grid.width;
      const z = Math.floor(index / validated.grid.width);
      const heightNormalOffset = z * rowStrideFloats + x * 4;
      const supportVelocityOffset = rowStrideFloats * rowsPerLayer + heightNormalOffset;
      const vectorOffset = index * 3;
      const normalLength = Math.hypot(
        normal[vectorOffset],
        normal[vectorOffset + 1],
        normal[vectorOffset + 2],
      );
      if (!Number.isFinite(bedHeight[index]) || !Number.isFinite(normalLength) || normalLength <= 1e-8) {
        movingHillSupportFailure(`support sample ${index} geometry is invalid`);
      }
      for (let component = 0; component < 3; component += 1) {
        if (!Number.isFinite(supportVelocity[vectorOffset + component])) {
          movingHillSupportFailure(`support sample ${index} velocity is invalid`);
        }
      }
      samples[heightNormalOffset] = bedHeight[index];
      samples[heightNormalOffset + 1] = normal[vectorOffset] / normalLength;
      samples[heightNormalOffset + 2] = normal[vectorOffset + 1] / normalLength;
      samples[heightNormalOffset + 3] = normal[vectorOffset + 2] / normalLength;
      samples[supportVelocityOffset] = supportVelocity[vectorOffset];
      samples[supportVelocityOffset + 1] = supportVelocity[vectorOffset + 1];
      samples[supportVelocityOffset + 2] = supportVelocity[vectorOffset + 2];
      samples[supportVelocityOffset + 3] = 1;
    }

    const paramsData = new ArrayBuffer(48);
    const paramsFloats = new Float32Array(paramsData);
    const paramsWords = new Uint32Array(paramsData);
    paramsFloats.set([
      validated.grid.origin[0],
      validated.grid.origin[2],
      validated.grid.spacing[0],
      validated.grid.spacing[1],
    ], 0);
    paramsWords.set([
      validated.grid.width,
      validated.grid.height,
      validated.terrainEpoch,
      validated.supportEpoch,
      validated.remapEpoch,
      validated.sampleCount,
      0,
      0,
    ], 4);
    return {
      validated,
      samples,
      textureLayout: {
        bytesPerRow,
        rowsPerImage: rowsPerLayer,
      },
      paramsData,
    };
  };

  const initial = packFrame(terrainFrame, identity);
  const { validated } = initial;

  const sampleTexture = device.createTexture({
    label: 'kaminos-finger-fluid-moving-hill-support-samples',
    size: {
      width: validated.grid.width,
      height: validated.grid.height,
      depthOrArrayLayers: 2,
    },
    dimension: '2d',
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const sampleTextureView = sampleTexture.createView({
    label: 'kaminos-finger-fluid-moving-hill-support-samples-view',
    dimension: '2d-array',
    baseArrayLayer: 0,
    arrayLayerCount: 2,
  });
  const paramsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-moving-hill-support-params',
    size: initial.paramsData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: sampleTexture },
    initial.samples,
    initial.textureLayout,
    {
      width: validated.grid.width,
      height: validated.grid.height,
      depthOrArrayLayers: 2,
    },
  );
  device.queue.writeBuffer(paramsBuffer, 0, initial.paramsData);
  let released = false;
  let currentIdentity = validated;
  let writeTick = 0;
  const initialGrid = {
    width: validated.grid.width,
    height: validated.grid.height,
    spacing: [...validated.grid.spacing],
    origin: [...validated.grid.origin],
  };
  const provider = {
    schema: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_PROVIDER_SCHEMA,
    route: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
    owner: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_OWNER,
    execution: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_EXECUTION,
    get sourceId() { return currentIdentity.sourceId; },
    get terrainId() { return currentIdentity.terrainId; },
    get terrainEpoch() { return currentIdentity.terrainEpoch; },
    get supportEpoch() { return currentIdentity.supportEpoch; },
    get remapEpoch() { return currentIdentity.remapEpoch; },
    stale: false,
    fallbackRoute: null,
    complete: true,
    device,
    queue: device.queue,
    sampleTexture,
    sampleTextureView,
    paramsBuffer,
    sampleCount: validated.sampleCount,
    sampleStrideFloats: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_SAMPLE_STRIDE_FLOATS,
    visibilityAuthority: 'gpu_descriptor_texture_without_host_readback',
    hostReadbackVisibility: false,
    get writeTick() { return writeTick; },
    update({
      terrainFrame: nextTerrainFrame,
      identity: nextIdentity,
    } = {}) {
      if (released) {
        movingHillSupportFailure('provider has been released');
      }
      const next = packFrame(nextTerrainFrame, nextIdentity);
      if (next.validated.sourceId !== currentIdentity.sourceId) {
        movingHillSupportFailure('source id changed');
      }
      if (next.validated.terrainId !== currentIdentity.terrainId) {
        movingHillSupportFailure('terrain id changed');
      }
      if (next.validated.terrainEpoch <= currentIdentity.terrainEpoch) {
        movingHillSupportFailure('terrain epoch must advance');
      }
      if (next.validated.supportEpoch < currentIdentity.supportEpoch) {
        movingHillSupportFailure('support epoch must not regress');
      }
      if (next.validated.remapEpoch < currentIdentity.remapEpoch) {
        movingHillSupportFailure('remap epoch must not regress');
      }
      const nextGrid = next.validated.grid;
      if (
        nextGrid.width !== initialGrid.width
        || nextGrid.height !== initialGrid.height
        || nextGrid.spacing[0] !== initialGrid.spacing[0]
        || nextGrid.spacing[1] !== initialGrid.spacing[1]
        || nextGrid.origin[0] !== initialGrid.origin[0]
        || nextGrid.origin[1] !== initialGrid.origin[1]
        || nextGrid.origin[2] !== initialGrid.origin[2]
      ) {
        movingHillSupportFailure('grid topology changed; reconstruct the provider explicitly');
      }
      device.queue.writeTexture(
        { texture: sampleTexture },
        next.samples,
        next.textureLayout,
        {
          width: next.validated.grid.width,
          height: next.validated.grid.height,
          depthOrArrayLayers: 2,
        },
      );
      device.queue.writeBuffer(paramsBuffer, 0, next.paramsData);
      currentIdentity = next.validated;
      writeTick += 1;
      return provider;
    },
    release() {
      if (released) return;
      released = true;
      sampleTexture.destroy();
      paramsBuffer.destroy();
    },
  };
  return Object.freeze(provider);
}

export function validateFingerFluidMovingHillSupportContactProvider(provider, { device } = {}) {
  if (!provider || typeof provider !== 'object') {
    movingHillSupportFailure('provider is missing');
  }
  if (provider.schema !== KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_PROVIDER_SCHEMA) {
    movingHillSupportFailure('provider schema is invalid');
  }
  if (provider.route !== KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE) {
    movingHillSupportFailure('provider route is invalid');
  }
  if (provider.owner !== KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_OWNER) {
    movingHillSupportFailure('provider owner is invalid');
  }
  if (provider.execution !== KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_EXECUTION) {
    movingHillSupportFailure('provider execution is invalid');
  }
  if (!device || provider.device !== device || provider.queue !== device.queue) {
    movingHillSupportFailure('provider GPU device or queue does not match the solver');
  }
  if (provider.stale !== false) {
    movingHillSupportFailure('provider is stale');
  }
  if (provider.fallbackRoute !== null) {
    movingHillSupportFailure('provider declares a fallback route');
  }
  if (provider.complete !== true) {
    movingHillSupportFailure('provider is partial');
  }
  if (!provider.sampleTexture || typeof provider.sampleTexture !== 'object') {
    movingHillSupportFailure('provider sample texture is missing');
  }
  if (!provider.sampleTextureView || typeof provider.sampleTextureView !== 'object') {
    movingHillSupportFailure('provider sample texture view is missing');
  }
  if (!provider.paramsBuffer || typeof provider.paramsBuffer !== 'object') {
    movingHillSupportFailure('provider params buffer is missing');
  }
  if (
    !Number.isSafeInteger(provider.sampleCount)
    || provider.sampleCount <= 0
    || provider.sampleStrideFloats !== KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_SAMPLE_STRIDE_FLOATS
  ) {
    movingHillSupportFailure('provider sample layout is invalid');
  }
  movingHillSupportString(provider.sourceId, 'provider source id');
  movingHillSupportString(provider.terrainId, 'provider terrain id');
  movingHillSupportEpoch(provider.terrainEpoch, 'provider terrain epoch');
  movingHillSupportEpoch(provider.supportEpoch, 'provider support epoch');
  movingHillSupportEpoch(provider.remapEpoch, 'provider remap epoch');
  if (
    provider.visibilityAuthority !== 'gpu_descriptor_texture_without_host_readback'
    || provider.hostReadbackVisibility !== false
  ) {
    movingHillSupportFailure('provider visibility authority is invalid');
  }
  return provider;
}

export function createFingerFluidSupportContactIdentity(provider, { device } = {}) {
  if (!provider) {
    return Object.freeze({
      route: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE,
      owner: 'kaminos_diagnostic',
      sourceId: 'built-in-toy-support',
      terrainId: null,
      terrainEpoch: null,
      supportEpoch: null,
      remapEpoch: null,
      stale: false,
      fallbackRoute: null,
      execution: 'gpu_same_device_analytic_diagnostic_signed_distance_v0',
      deviceMatchesSolver: true,
      visibilityAuthority: 'gpu_descriptor_without_host_readback',
      hostReadbackVisibility: false,
    });
  }
  return Object.freeze({
    route: provider.route,
    owner: provider.owner,
    sourceId: provider.sourceId,
    terrainId: provider.terrainId,
    terrainEpoch: provider.terrainEpoch,
    supportEpoch: provider.supportEpoch,
    remapEpoch: provider.remapEpoch,
    stale: provider.stale,
    fallbackRoute: provider.fallbackRoute,
    execution: provider.execution,
    deviceMatchesSolver: provider.device === device,
    visibilityAuthority: provider.visibilityAuthority,
    hostReadbackVisibility: provider.hostReadbackVisibility,
  });
}

function portableGeometryFailure(message) {
  throw new Error(`Portable fluid support geometry ${message}`);
}

function analyticCarrierOpticalFailure(code, message, diagnostics, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.defineProperty(error, 'report', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      schema: 'kaminos.finger-fluid.analytic-carrier-optical-failure.v1',
      status: 'failed',
      phase: diagnostics.phase,
      requestedRoute: diagnostics.requestedRoute,
      effectiveRoute: diagnostics.effectiveRoute,
      lastTrustworthyEvidence: diagnostics.lastTrustworthyEvidence,
      message,
      details: Object.freeze({ ...details }),
    }),
  });
  throw error;
}

function analyticCarrierFiniteNumber(value, label, diagnostics, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (positive && number <= 0)) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_geometry',
      `${label} must be ${positive ? 'finite and positive' : 'finite'}`,
      diagnostics,
      { label, value },
    );
  }
  return number;
}

function analyticCarrierFiniteVector(value, label, diagnostics) {
  if (!Array.isArray(value) || value.length !== 3) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_geometry',
      `${label} must have exactly three components`,
      diagnostics,
      { label, value },
    );
  }
  return value.map((component, index) => (
    analyticCarrierFiniteNumber(component, `${label}[${index}]`, diagnostics)
  ));
}

function analyticCarrierVectorLength(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function analyticCarrierNormalize(vector, label, diagnostics) {
  const length = analyticCarrierVectorLength(vector);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_geometry',
      `${label} must have nonzero finite length`,
      diagnostics,
      { label, vector },
    );
  }
  return vector.map(component => component / length);
}

function analyticCarrierCross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function analyticCarrierIdentityMatches(expected, actual, fields) {
  return expected && actual && fields.every(field => expected[field] === actual[field]);
}

function analyticCarrierSamplesMatch(expected, actual, tolerance = 1e-6) {
  return Array.isArray(expected)
    && Array.isArray(actual)
    && expected.length === actual.length
    && expected.every((value, index) => Math.abs(value - actual[index]) <= tolerance);
}

export function reconstructFingerFluidAnalyticCarrierCapsuleSupport({
  analyticCapsuleSupport,
  position,
  tangent,
  radius,
  backwardLengthRatio,
  forwardLengthRatio,
  quadratureWeight,
  cameraRight,
  cameraUp,
} = {}) {
  const diagnostics = {
    phase: 'reconstruct-capsule-support',
    requestedRoute: KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_ROUTE,
    effectiveRoute: KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_ROUTE,
    lastTrustworthyEvidence: 'no-capsule-support-input-validated',
  };
  const safePosition = analyticCarrierFiniteVector(
    position,
    'analytic capsule position',
    diagnostics,
  );
  const safeTangent = analyticCarrierNormalize(
    analyticCarrierFiniteVector(tangent, 'analytic capsule tangent', diagnostics),
    'analytic capsule tangent',
    diagnostics,
  );
  const safeCameraRight = analyticCarrierNormalize(
    analyticCarrierFiniteVector(cameraRight, 'analytic capsule camera right', diagnostics),
    'analytic capsule camera right',
    diagnostics,
  );
  const safeCameraUp = analyticCarrierNormalize(
    analyticCarrierFiniteVector(cameraUp, 'analytic capsule camera up', diagnostics),
    'analytic capsule camera up',
    diagnostics,
  );
  const safeRadius = analyticCarrierFiniteNumber(
    radius,
    'analytic capsule radius',
    diagnostics,
    { positive: true },
  );
  const safeBackwardRatio = analyticCarrierFiniteNumber(
    backwardLengthRatio,
    'analytic capsule backward length ratio',
    diagnostics,
  );
  const safeForwardRatio = analyticCarrierFiniteNumber(
    forwardLengthRatio,
    'analytic capsule forward length ratio',
    diagnostics,
  );
  const safeQuadratureWeight = analyticCarrierFiniteNumber(
    quadratureWeight,
    'analytic capsule quadrature weight',
    diagnostics,
  );
  if (
    safeBackwardRatio < 0
    || safeForwardRatio < 0
    || safeQuadratureWeight <= 0
    || safeQuadratureWeight > 1
  ) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_geometry',
      'analytic capsule ratios and quadrature weight are outside their supported range',
      diagnostics,
      {
        backwardLengthRatio,
        forwardLengthRatio,
        quadratureWeight,
      },
    );
  }
  const carrierTangent = analyticCapsuleSupport ? safeTangent : safeCameraRight;
  const tangentScreen = [
    carrierTangent.reduce(
      (sum, component, axis) => sum + component * safeCameraRight[axis],
      0,
    ),
    carrierTangent.reduce(
      (sum, component, axis) => sum + component * safeCameraUp[axis],
      0,
    ),
  ];
  const projectedTangentMagnitude = Math.hypot(...tangentScreen);
  const projectedTangentAxis = projectedTangentMagnitude > 1e-6
    ? tangentScreen.map(component => component / projectedTangentMagnitude)
    : [1, 0];
  const projectedTangentWorld = safeCameraRight.map(
    (component, axis) => (
      component * projectedTangentAxis[0]
      + safeCameraUp[axis] * projectedTangentAxis[1]
    ),
  );
  const projectedTangentPerpendicular = safeCameraRight.map(
    (component, axis) => (
      component * -projectedTangentAxis[1]
      + safeCameraUp[axis] * projectedTangentAxis[0]
    ),
  );
  const segmentBackwardLength = analyticCapsuleSupport
    ? safeBackwardRatio * safeRadius
    : 0;
  const segmentForwardLength = analyticCapsuleSupport
    ? safeForwardRatio * safeRadius
    : 0;
  const effectiveQuadratureWeight = analyticCapsuleSupport ? safeQuadratureWeight : 1;
  const segmentCenterOffset = (
    segmentForwardLength - segmentBackwardLength
  ) * 0.5;
  const segmentHalfLength = (
    segmentBackwardLength + segmentForwardLength
  ) * 0.5;
  const projectedHalfLength = segmentHalfLength * projectedTangentMagnitude;
  const segmentCenter = safePosition.map(
    (component, axis) => component + carrierTangent[axis] * segmentCenterOffset,
  );
  const capsuleHalfLengthRatio = projectedHalfLength / safeRadius;
  const validateCorner = corner => {
    if (
      !Array.isArray(corner)
      || corner.length !== 2
      || !corner.every(Number.isFinite)
    ) {
      throw new TypeError('analytic capsule quad corner must contain two finite components');
    }
  };
  return Object.freeze({
    segmentLengths: Object.freeze([segmentBackwardLength, segmentForwardLength]),
    segmentCenter: Object.freeze(segmentCenter),
    segmentHalfLength,
    projectedHalfLength,
    capsuleHalfLengthRatio,
    quadratureWeight: effectiveQuadratureWeight,
    quadWorldPosition(corner) {
      validateCorner(corner);
      return segmentCenter.map((component, axis) => (
        component
        + carrierTangent[axis] * segmentHalfLength * corner[0]
        + projectedTangentWorld[axis] * safeRadius * corner[0]
        + projectedTangentPerpendicular[axis] * safeRadius * corner[1]
      ));
    },
    quadUv(corner) {
      validateCorner(corner);
      return [
        corner[0] * (capsuleHalfLengthRatio + 1),
        corner[1],
      ];
    },
  });
}

function validateAnalyticCarrierOpticalInputs({
  descriptor,
  impact,
  handoffReceipt,
  sourceIndex,
}, diagnostics) {
  diagnostics.phase = 'validate-handoff';
  if (
    handoffReceipt?.schema !== 'kaminos.finger-fluid.analytic-impact-handoff.v1'
    || handoffReceipt.state !== 'transferred'
    || handoffReceipt.ownership?.contract !== 'exclusive-material-interval-carrier-to-particles-v0'
    || handoffReceipt.ownership.carrierOwnsTransferredInterval !== false
    || handoffReceipt.ownership.particlesOwnTransferredInterval !== true
    || handoffReceipt.ownership.analyticVisibleBeforeImpact !== true
    || handoffReceipt.ownership.analyticVisibleAfterImpact !== false
    || handoffReceipt.ownership.canonicalParticlesVisibleBeforeImpact !== false
    || handoffReceipt.ownership.canonicalParticlesVisibleAfterImpact !== true
    || handoffReceipt.conservation?.valid !== true
    || typeof handoffReceipt.receiptId !== 'string'
    || handoffReceipt.receiptId.length === 0
  ) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_handoff_receipt',
      'analytic carrier optics require a complete exclusive and conservative handoff receipt',
      diagnostics,
    );
  }
  diagnostics.lastTrustworthyEvidence = 'handoff-ownership-validated';
  diagnostics.phase = 'validate-identity';
  if (
    descriptor?.schema !== 'kaminos.finger-fluid.analytic-pre-impact-carrier.v1'
    || descriptor.route?.requested !== 'kaminos.finger-fluid.analytic-ballistic-carrier.v0'
    || descriptor.route?.effective !== descriptor.route.requested
    || descriptor.route?.fallback !== null
    || impact?.state !== 'hit'
  ) {
    analyticCarrierOpticalFailure(
      'analytic_carrier_identity_mismatch',
      'analytic carrier descriptor or first-impact identity is unsupported',
      diagnostics,
    );
  }
  const sourceFields = [
    'packetId',
    'sourceRoute',
    'artifactSha256',
    'handId',
    'fingerId',
    'inletId',
    'generation',
    'sourceMechanicsRevision',
  ];
  const supportFields = [
    'schema',
    'sourceId',
    'providerRoute',
    'artifactSha256',
    'terrainId',
    'terrainGeneration',
    'transformEpoch',
    'topologyEpoch',
    'supportEpoch',
    'remapEpoch',
  ];
  const identityMatches = (
    analyticCarrierIdentityMatches(descriptor.source, impact.source, sourceFields)
    && analyticCarrierIdentityMatches(descriptor.source, handoffReceipt.source, sourceFields)
    && analyticCarrierIdentityMatches(
      descriptor.supportIdentity,
      impact.supportIdentity,
      supportFields,
    )
    && analyticCarrierIdentityMatches(
      descriptor.supportIdentity,
      handoffReceipt.supportIdentity,
      supportFields,
    )
    && descriptor.supportIdentity?.stale === false
    && descriptor.supportIdentity?.fallbackRoute === null
    && impact.carrierCutParameterization === 'flight_seconds'
    && handoffReceipt.impact?.carrierCutParameterization === 'flight_seconds'
    && Math.abs(impact.flightSeconds - handoffReceipt.impact.flightSeconds) <= 1e-6
    && analyticCarrierSamplesMatch(
      impact.carrierPosition,
      handoffReceipt.impact.carrierPosition,
    )
  );
  if (!identityMatches) {
    analyticCarrierOpticalFailure(
      'analytic_carrier_identity_mismatch',
      'analytic carrier descriptor, support hit, and handoff receipt do not share exact identity',
      diagnostics,
    );
  }
  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= LIVE_HAND_INLET_CAPACITY) {
    analyticCarrierOpticalFailure(
      'analytic_carrier_identity_mismatch',
      'analytic carrier source index is outside the live-inlet contract',
      diagnostics,
      { sourceIndex },
    );
  }
  diagnostics.lastTrustworthyEvidence = 'descriptor-impact-handoff-identity-validated';
}

export function createFingerFluidAnalyticCarrierOpticalGeometry({
  descriptor,
  impact,
  handoffReceipt,
  sourceIndex,
  requestedRoute = KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_ROUTE,
  effectiveRoute = requestedRoute,
  fallbackRoute = null,
  axialStepRadiusRatio = 0.32,
} = {}) {
  const diagnostics = {
    phase: 'validate-route',
    requestedRoute,
    effectiveRoute,
    lastTrustworthyEvidence: 'no-optical-carrier-input-validated',
  };
  if (
    requestedRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_ROUTE
    || effectiveRoute !== requestedRoute
    || fallbackRoute !== null
  ) {
    analyticCarrierOpticalFailure(
      'fallback_analytic_carrier_optics',
      'analytic carrier optical route must be exact with explicit null fallback',
      diagnostics,
      { requestedRoute, effectiveRoute, fallbackRoute },
    );
  }
  diagnostics.lastTrustworthyEvidence = 'exact-optical-route-validated';
  validateAnalyticCarrierOpticalInputs({
    descriptor,
    impact,
    handoffReceipt,
    sourceIndex,
  }, diagnostics);

  diagnostics.phase = 'construct-geometry';
  const stepRatio = analyticCarrierFiniteNumber(
    axialStepRadiusRatio,
    'analytic carrier axial step radius ratio',
    diagnostics,
    { positive: true },
  );
  const origin = analyticCarrierFiniteVector(
    descriptor.inlet?.origin,
    'analytic carrier inlet origin',
    diagnostics,
  );
  const initialVelocity = analyticCarrierFiniteVector(
    descriptor.inlet?.velocity,
    'analytic carrier inlet velocity',
    diagnostics,
  );
  const gravity = analyticCarrierFiniteVector(
    descriptor.gravity,
    'analytic carrier gravity',
    diagnostics,
  );
  const inletRadius = analyticCarrierFiniteNumber(
    descriptor.inlet?.radius,
    'analytic carrier inlet radius',
    diagnostics,
    { positive: true },
  );
  const impactFlightSeconds = analyticCarrierFiniteNumber(
    impact.flightSeconds,
    'analytic carrier impact flight time',
    diagnostics,
    { positive: true },
  );
  const initialSpeed = analyticCarrierVectorLength(initialVelocity);
  if (!Number.isFinite(initialSpeed) || initialSpeed <= Number.EPSILON) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_geometry',
      'analytic carrier inlet velocity must have nonzero finite length',
      diagnostics,
    );
  }
  const pathProbeCount = 32;
  let pathLength = 0;
  let previousProbe = origin;
  for (let index = 1; index <= pathProbeCount; index += 1) {
    const time = impactFlightSeconds * index / pathProbeCount;
    const position = origin.map((component, axis) => (
      component + initialVelocity[axis] * time + 0.5 * gravity[axis] * time * time
    ));
    pathLength += analyticCarrierVectorLength(position.map(
      (component, axis) => component - previousProbe[axis],
    ));
    previousProbe = position;
  }
  const axialStep = inletRadius * stepRatio;
  const sampleCount = Math.max(2, Math.ceil(pathLength / axialStep) + 1);
  const rawSamples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const unit = index / (sampleCount - 1);
    const flightSeconds = impactFlightSeconds * unit;
    const position = origin.map((component, axis) => (
      component
      + initialVelocity[axis] * flightSeconds
      + 0.5 * gravity[axis] * flightSeconds * flightSeconds
    ));
    const velocity = initialVelocity.map(
      (component, axis) => component + gravity[axis] * flightSeconds,
    );
    const speed = analyticCarrierVectorLength(velocity);
    if (!Number.isFinite(speed) || speed <= Number.EPSILON) {
      analyticCarrierOpticalFailure(
        'invalid_analytic_carrier_geometry',
        'analytic carrier velocity became degenerate before first impact',
        diagnostics,
        { index, flightSeconds, velocity },
      );
    }
    const tangent = analyticCarrierNormalize(
      velocity,
      `analytic carrier tangent ${index}`,
      diagnostics,
    );
    const helper = Math.abs(tangent[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    const tangentU = analyticCarrierNormalize(
      analyticCarrierCross(helper, tangent),
      `analytic carrier tangent U ${index}`,
      diagnostics,
    );
    const tangentV = analyticCarrierNormalize(
      analyticCarrierCross(tangent, tangentU),
      `analytic carrier tangent V ${index}`,
      diagnostics,
    );
    const radius = inletRadius * Math.sqrt(initialSpeed / speed);
    const halfInterval = impactFlightSeconds / Math.max(1, sampleCount - 1) * 0.5;
    rawSamples.push({
      index,
      flightSeconds,
      position,
      velocity,
      speed,
      tangent,
      tangentU,
      tangentV,
      radius,
      entryExitInterval: [
        Math.max(0, flightSeconds - halfInterval),
        Math.min(impactFlightSeconds, flightSeconds + halfInterval),
      ],
      thickness: radius * 2,
      material: descriptor.material,
      confidence: 1,
      sourceGeneration: descriptor.source.generation,
    });
  }
  const samples = rawSamples.map((sample, index) => {
    const backwardLength = index > 0
      ? analyticCarrierVectorLength(sample.position.map(
        (component, axis) => component - rawSamples[index - 1].position[axis],
      )) * 0.5
      : 0;
    const forwardLength = index + 1 < rawSamples.length
      ? analyticCarrierVectorLength(rawSamples[index + 1].position.map(
        (component, axis) => component - sample.position[axis],
      )) * 0.5
      : 0;
    const quadratureWeight = Math.min(
      1,
      (backwardLength + forwardLength) / Math.max(sample.radius * 2, Number.EPSILON),
    );
    return Object.freeze({
      ...sample,
      position: Object.freeze(sample.position),
      velocity: Object.freeze(sample.velocity),
      tangent: Object.freeze(sample.tangent),
      tangentU: Object.freeze(sample.tangentU),
      tangentV: Object.freeze(sample.tangentV),
      entryExitInterval: Object.freeze(sample.entryExitInterval),
      segmentHalfLengths: Object.freeze([backwardLength, forwardLength]),
      quadratureWeight,
    });
  });
  if (
    samples.length < 2
    || !analyticCarrierSamplesMatch(samples[0].position, origin, 1e-9)
    || !analyticCarrierSamplesMatch(
      samples.at(-1).position,
      impact.carrierPosition,
      1e-5,
    )
  ) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_geometry',
      'analytic carrier quadrature is blank, partial, or detached from the first hit',
      diagnostics,
      { sampleCount: samples.length },
    );
  }
  diagnostics.lastTrustworthyEvidence = 'nonblank-source-to-impact-quadrature-constructed';
  return Object.freeze({
    schema: KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_GEOMETRY_SCHEMA,
    route: Object.freeze({
      requested: requestedRoute,
      effective: effectiveRoute,
      fallback: null,
    }),
    source: descriptor.source,
    supportIdentity: descriptor.supportIdentity,
    handoffReceiptId: handoffReceipt.receiptId,
    sourceIndex,
    sampleCount,
    samples: Object.freeze(samples),
    geometry: Object.freeze({
      representation: 'source-derived-tangent-capsule-quadrature',
      pathLength,
      axialStepRadiusRatio: stepRatio,
      noSampleCap: true,
      sampleCountTripwire: sampleCount > 4096,
    }),
    ownership: Object.freeze({
      contract: handoffReceipt.ownership.contract,
      preImpactCarrierVisible: true,
      preImpactParticlesVisible: false,
      postImpactCarrierVisible: false,
      postImpactParticlesVisible: true,
      transferredInterval: handoffReceipt.ownership.transferredInterval,
      carrierRetainedMaterialIntervals: handoffReceipt.ownership.carrierRetainedMaterialIntervals,
    }),
    particleSuppression: Object.freeze({
      contract: 'matching-source-pre-impact-age-exclusive-visibility-v0',
      sourceIndex,
      maximumParticleAgeSeconds: impactFlightSeconds,
    }),
    evidence: Object.freeze({
      schema: 'kaminos.finger-fluid.analytic-carrier-optical-admission.v1',
      status: 'admitted',
      requestedRoute,
      effectiveRoute,
      fallbackRoute: null,
      sourcePacketId: descriptor.source.packetId,
      sourceGeneration: descriptor.source.generation,
      sourceMechanicsRevision: descriptor.source.sourceMechanicsRevision,
      ageContract: KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT,
      supportSourceId: descriptor.supportIdentity.sourceId,
      supportEpoch: descriptor.supportIdentity.supportEpoch,
      remapEpoch: descriptor.supportIdentity.remapEpoch,
      handoffReceiptId: handoffReceipt.receiptId,
      sampleCount,
      blank: false,
      partial: false,
      doubleRendered: false,
      lastTrustworthyEvidence: diagnostics.lastTrustworthyEvidence,
    }),
  });
}

export function createFingerFluidAnalyticCarrierGpuPayload(
  geometry,
  visibleParticleRadius,
) {
  const diagnostics = {
    phase: 'construct-gpu-payload',
    requestedRoute: geometry?.route?.requested ?? null,
    effectiveRoute: geometry?.route?.effective ?? null,
    lastTrustworthyEvidence: 'no-gpu-payload-input-validated',
  };
  if (
    geometry?.schema !== KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_GEOMETRY_SCHEMA
    || geometry.route?.requested !== KAMINOS_FINGER_FLUID_ANALYTIC_CARRIER_OPTICAL_ROUTE
    || geometry.route?.effective !== geometry.route.requested
    || geometry.route?.fallback !== null
    || geometry.evidence?.status !== 'admitted'
    || geometry.evidence?.blank !== false
    || geometry.evidence?.partial !== false
    || geometry.evidence?.doubleRendered !== false
    || !Array.isArray(geometry.samples)
    || geometry.samples.length !== geometry.sampleCount
    || geometry.sampleCount < 2
  ) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_gpu_payload',
      'analytic carrier GPU payload requires complete admitted nonfallback geometry',
      diagnostics,
    );
  }
  const safeVisibleRadius = analyticCarrierFiniteNumber(
    visibleParticleRadius,
    'analytic carrier visible particle radius',
    diagnostics,
    { positive: true },
  );
  diagnostics.lastTrustworthyEvidence = 'admitted-optical-geometry-validated';
  const particles = new Float32Array(geometry.sampleCount * PARTICLE_FLOATS);
  const neighborTopology = new Float32Array(
    geometry.sampleCount * NEIGHBOR_TOPOLOGY_WORDS,
  );
  const materialTracers = new Float32Array(
    geometry.sampleCount * MATERIAL_TRACER_FLOATS,
  );
  geometry.samples.forEach((sample, index) => {
    const particleOffset = index * PARTICLE_FLOATS;
    const topologyOffset = index * NEIGHBOR_TOPOLOGY_WORDS;
    const tracerOffset = index * MATERIAL_TRACER_FLOATS;
    particles.set(sample.position, particleOffset);
    particles[particleOffset + 3] = sample.flightSeconds;
    particles.set(sample.tangent, particleOffset + 4);
    particles[particleOffset + 7] = 1;
    particles.set(sample.velocity, particleOffset + 8);
    particles[particleOffset + 11] = 0;
    particles[particleOffset + 15] = 24.3;
    const shaderRadiusScale = sample.radius / (safeVisibleRadius * 1.78);
    neighborTopology[topologyOffset + 32] = shaderRadiusScale ** 3;
    neighborTopology[topologyOffset + 33] = sample.segmentHalfLengths[0] / sample.radius;
    neighborTopology[topologyOffset + 34] = sample.segmentHalfLengths[1] / sample.radius;
    neighborTopology[topologyOffset + 35] = sample.quadratureWeight;
    materialTracers[tracerOffset] = Number(sample.material?.chemistry?.[0] ?? 0);
    materialTracers[tracerOffset + 2] = materialTracers[tracerOffset];
    materialTracers[tracerOffset + 10] = -1;
    materialTracers[tracerOffset + 15] = 1;
  });
  const partial = (
    particles.some(value => !Number.isFinite(value))
    || neighborTopology.some(value => !Number.isFinite(value))
    || materialTracers.some(value => !Number.isFinite(value))
  );
  if (partial) {
    analyticCarrierOpticalFailure(
      'invalid_analytic_carrier_gpu_payload',
      'analytic carrier GPU payload contains nonfinite storage data',
      diagnostics,
    );
  }
  diagnostics.lastTrustworthyEvidence = 'finite-nonblank-gpu-payload-constructed';
  return Object.freeze({
    schema: 'kaminos.finger-fluid.analytic-carrier-gpu-payload.v2',
    route: geometry.route,
    source: geometry.source,
    supportIdentity: geometry.supportIdentity,
    handoffReceiptId: geometry.handoffReceiptId,
    sampleCount: geometry.sampleCount,
    particleSuppression: geometry.particleSuppression,
    particles,
    neighborTopology,
    materialTracers,
    particleSuppressionControls: Object.freeze([
      1,
      geometry.particleSuppression.sourceIndex,
      geometry.particleSuppression.maximumParticleAgeSeconds,
      geometry.source.generation,
    ]),
    evidence: Object.freeze({
      schema: 'kaminos.finger-fluid.analytic-carrier-gpu-payload-evidence.v1',
      status: 'constructed',
      requestedRoute: geometry.route.requested,
      effectiveRoute: geometry.route.effective,
      fallbackRoute: null,
      sampleCount: geometry.sampleCount,
      sourceMechanicsRevision: geometry.source.sourceMechanicsRevision,
      ageContract: KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT,
      blank: false,
      partial: false,
      doubleRendered: false,
      lastTrustworthyEvidence: diagnostics.lastTrustworthyEvidence,
    }),
  });
}

function portableGeometryReportedFailure(error, {
  phase,
  sourceHandleId,
  lastTrustworthyEvidence,
}) {
  if (error?.report) return error;
  const failure = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(failure, 'report', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      schema: 'kaminos.finger-fluid.portable-macro-geometry-failure.v1',
      status: 'failed',
      phase,
      sourceHandleId,
      lastTrustworthyEvidence,
      message: failure.message,
    }),
  });
  return failure;
}

function portableGeometryVectorField(value, sampleCount, label, { requireUnit = false } = {}) {
  representationFrameTypedArray(value, sampleCount * 3, label);
  const copy = Float64Array.from(value);
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * 3;
    const length = Math.hypot(copy[offset], copy[offset + 1], copy[offset + 2]);
    if (!Number.isFinite(length) || length <= 1e-8) {
      portableGeometryFailure(`${label} contains a degenerate vector at sample ${index}`);
    }
    if (requireUnit && Math.abs(length - 1) > 1e-5) {
      portableGeometryFailure(`${label} must be unit length at sample ${index}`);
    }
  }
  return copy;
}

function validatePortablePackageIdentity(expectedIdentity) {
  const packageDescriptor = expectedIdentity?.packageDescriptor;
  if (
    !expectedIdentity
    || typeof expectedIdentity !== 'object'
    || typeof expectedIdentity.artifactRevision !== 'string'
    || expectedIdentity.artifactRevision.trim().length === 0
    || typeof expectedIdentity.producerRevision !== 'string'
    || expectedIdentity.producerRevision.trim().length === 0
    || !Number.isInteger(expectedIdentity.fluidEpoch)
    || expectedIdentity.fluidEpoch < 0
    || !Number.isInteger(expectedIdentity.terrainEpoch)
    || expectedIdentity.terrainEpoch < 0
    || !expectedIdentity.source
    || typeof expectedIdentity.source !== 'object'
    || !packageDescriptor
    || typeof packageDescriptor !== 'object'
  ) {
    portableGeometryFailure('expected producer identity is incomplete');
  }
  for (const label of ['requested', 'effective', 'producerId', 'producerRevision']) {
    representationFrameString(expectedIdentity.source[label], `portable expected source ${label}`);
  }
  if (expectedIdentity.source.requested !== expectedIdentity.source.effective) {
    portableGeometryFailure('expected terrain source route disagreement');
  }
  if (packageDescriptor.schema !== KAMINOS_FLUID_PACKAGE_DESCRIPTOR_SCHEMA) {
    portableGeometryFailure(`package schema is unsupported: ${packageDescriptor.schema || 'missing'}`);
  }
  if (packageDescriptor.sourceAuthority !== 'live_runtime') {
    portableGeometryFailure(`package source authority is unsupported: ${packageDescriptor.sourceAuthority || 'missing'}`);
  }
  if (packageDescriptor.fallbackStatus !== 'none') {
    portableGeometryFailure(`package fallback is not accepted: ${packageDescriptor.fallbackStatus || 'missing'}`);
  }
  if (packageDescriptor.packageName !== '@kaminos/fluid-webgpu') {
    portableGeometryFailure(`package identity is unsupported: ${packageDescriptor.packageName || 'missing'}`);
  }
  representationFrameString(packageDescriptor.packageVersion, 'portable package version');
  if (packageDescriptor.packageVersion !== KAMINOS_FLUID_PACKAGE_VERSION) {
    portableGeometryFailure(`package version is unsupported: ${packageDescriptor.packageVersion}`);
  }
  representationFrameString(packageDescriptor.artifactRevision, 'portable package artifact revision');
  representationFrameString(packageDescriptor.runtimeRevision, 'portable package runtime revision');
  representationFrameString(packageDescriptor.runtimeRoute, 'portable package runtime route');
  if (packageDescriptor.runtimeRoute !== KAMINOS_FLUID_PACKAGE_RUNTIME_ROUTE) {
    portableGeometryFailure(`package runtime route is unsupported: ${packageDescriptor.runtimeRoute}`);
  }
  if (packageDescriptor.artifactRevision !== expectedIdentity.artifactRevision) {
    portableGeometryFailure(`package artifact revision disagreement: ${JSON.stringify({
      expected: expectedIdentity.artifactRevision,
      observed: packageDescriptor.artifactRevision,
    })}`);
  }
  if (packageDescriptor.runtimeRevision !== expectedIdentity.producerRevision) {
    portableGeometryFailure(`package runtime revision disagreement: ${JSON.stringify({
      expected: expectedIdentity.producerRevision,
      observed: packageDescriptor.runtimeRevision,
    })}`);
  }
  if (
    !Array.isArray(packageDescriptor.representationRoutes)
    || !packageDescriptor.representationRoutes.includes(KAMINOS_FLUID_REPRESENTATION_FRAME_ROUTE)
  ) {
    portableGeometryFailure('package does not publish the canonical representation capability');
  }
  return packageDescriptor;
}

function validatePortableExactRoute(route, expectedRoute, label) {
  if (
    !route
    || route.requested !== expectedRoute
    || route.effective !== expectedRoute
    || route.requested !== route.effective
  ) {
    portableGeometryFailure(`${label} route disagreement`);
  }
  return route;
}

function validatePortableNoCameraState(value, label, seen = new Set()) {
  if (
    value == null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
    || value instanceof ArrayBuffer
    || seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  const forbiddenKeys = new Set([
    'camera',
    'view',
    'projection',
    'viewport',
    'screenSpaceDemand',
    'opticalResidency',
  ]);
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      portableGeometryFailure(`${label} contains camera-owned state: ${key}`);
    }
    validatePortableNoCameraState(child, `${label}.${key}`, seen);
  }
}

function validatePortableRecursivelyFrozen(value, label, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  if (!Object.isFrozen(value)) {
    portableGeometryFailure(`${label} must be recursively frozen`);
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    validatePortableRecursivelyFrozen(child, label, seen);
  }
}

function validatePortablePhysicalMaterial(physicalMaterial, label = 'physical material') {
  if (!physicalMaterial || typeof physicalMaterial !== 'object') {
    portableGeometryFailure(`${label} is missing`);
  }
  representationFrameFinite(physicalMaterial.densityKgM3, `${label} density`, { positive: true });
  if (!physicalMaterial.absorptionPerMeter || physicalMaterial.absorptionPerMeter.length !== 3) {
    portableGeometryFailure(`${label} absorption is invalid`);
  }
  return {
    densityKgM3: physicalMaterial.densityKgM3,
    dynamicViscosityPaS: physicalMaterial.dynamicViscosityPaS == null
      ? null
      : representationFrameFinite(
        physicalMaterial.dynamicViscosityPaS,
        `${label} dynamic viscosity`,
        { nonNegative: true },
      ),
    absorptionPerMeter: Array.from(physicalMaterial.absorptionPerMeter, (value, index) => (
      representationFrameFinite(value, `${label} absorption[${index}]`, { nonNegative: true })
    )),
  };
}

function validatePortableMacroSourceHandleForOptics(
  sourceHandle,
  expectedIdentity,
  packageDescriptor,
  diagnostics,
) {
  diagnostics.phase = 'validate-source-descriptor';
  if (
    !Array.isArray(packageDescriptor.sourceRoutes)
    || !packageDescriptor.sourceRoutes.includes(KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_ROUTE)
  ) {
    portableGeometryFailure('package does not publish the canonical portable source route');
  }

  if (!sourceHandle || typeof sourceHandle !== 'object' || !Object.isFrozen(sourceHandle)) {
    portableGeometryFailure('macro source handle must be immutable');
  }
  const descriptor = sourceHandle.descriptor;
  if (!descriptor || typeof descriptor !== 'object' || !Object.isFrozen(descriptor)) {
    portableGeometryFailure('macro source descriptor must be immutable');
  }
  validatePortableRecursivelyFrozen(descriptor, 'macro source descriptor');
  if (descriptor.schema !== KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_HANDLE_SCHEMA) {
    portableGeometryFailure(`macro source handle schema is unsupported: ${descriptor.schema || 'missing'}`);
  }
  validatePortableExactRoute(
    descriptor.route,
    KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_ROUTE,
    'macro source descriptor',
  );
  if (
    descriptor.requestedCapability !== KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_CAPABILITY
    || descriptor.effectiveCapability !== descriptor.requestedCapability
    || descriptor.capability !== descriptor.effectiveCapability
  ) {
    portableGeometryFailure('macro source capability disagreement');
  }
  representationFrameString(descriptor.sourceHandleId, 'portable macro source handle id');
  diagnostics.sourceHandleId = descriptor.sourceHandleId;
  if (descriptor.sourceAuthority !== 'live_runtime') {
    portableGeometryFailure(`macro source authority is unsupported: ${descriptor.sourceAuthority || 'missing'}`);
  }
  if (descriptor.fallbackStatus !== 'none') {
    portableGeometryFailure(`macro source fallback is not accepted: ${descriptor.fallbackStatus || 'missing'}`);
  }
  if (descriptor.ownershipIdentity !== KAMINOS_FLUID_REPRESENTATION_OWNERSHIP_IDENTITY) {
    portableGeometryFailure('macro source ownership identity disagreement');
  }
  validatePortableExactRoute(
    descriptor.representationRoute,
    KAMINOS_FLUID_REPRESENTATION_FRAME_ROUTE,
    'macro source representation',
  );
  representationFrameString(descriptor.producer?.revision, 'portable macro source producer revision');
  representationFrameString(descriptor.producer?.runtimeRoute, 'portable macro source runtime route');
  representationFrameString(descriptor.producer?.method, 'portable macro source method');
  if (descriptor.producer.revision !== expectedIdentity.producerRevision) {
    portableGeometryFailure('macro source producer revision disagreement');
  }
  if (descriptor.producer.runtimeRoute !== packageDescriptor.runtimeRoute) {
    portableGeometryFailure('macro source and package runtime route disagreement');
  }
  const supportDescriptor = descriptor.supportGeometry;
  if (!supportDescriptor || typeof supportDescriptor !== 'object') {
    portableGeometryFailure('macro source support descriptor is missing');
  }
  for (const label of ['topologyId', 'terrainId', 'supportClass', 'transformId']) {
    representationFrameString(supportDescriptor[label], `portable macro support ${label}`);
  }
  if (
    supportDescriptor.coordinateSpace !== 'world_meters'
    || supportDescriptor.worldMetersPerUnit !== 1
    || supportDescriptor.mapping !== 'explicit-world-position-buffer-v1'
    || supportDescriptor.positionSource !== 'terrain-fluid-frame.fields.worldPosition'
    || !Number.isInteger(supportDescriptor.sampleCount)
    || supportDescriptor.sampleCount <= 0
  ) {
    portableGeometryFailure('macro source support descriptor is unsupported or incomplete');
  }
  if (
    descriptor.lifetime?.releasePolicy !== 'explicit-release-v1'
    || !Number.isInteger(descriptor.lifetime.retainedTerrainEpoch)
    || !Number.isInteger(descriptor.lifetime.retainedFluidEpoch)
    || descriptor.lifetime.retainedTerrainEpoch < 0
    || descriptor.lifetime.retainedFluidEpoch < 0
    || descriptor.lifetime.retainedTerrainEpoch > expectedIdentity.terrainEpoch
    || descriptor.lifetime.retainedFluidEpoch > expectedIdentity.fluidEpoch
  ) {
    portableGeometryFailure('macro source lifetime is invalid');
  }
  validatePortablePhysicalMaterial(descriptor.physicalMaterial, 'macro source descriptor material');
  validatePortableNoCameraState(descriptor, 'macro source descriptor');
  if (typeof sourceHandle.read !== 'function' || typeof sourceHandle.release !== 'function') {
    portableGeometryFailure('macro source handle is incomplete');
  }

  diagnostics.phase = 'read-live-source';
  diagnostics.lastTrustworthyEvidence = 'source-descriptor-validated';
  const snapshot = sourceHandle.read({
    minimumTerrainEpoch: expectedIdentity.terrainEpoch,
    minimumFluidEpoch: expectedIdentity.fluidEpoch,
  });
  diagnostics.phase = 'validate-source-snapshot';
  diagnostics.lastTrustworthyEvidence = 'source-snapshot-read';
  if (!snapshot || typeof snapshot !== 'object') {
    portableGeometryFailure('macro source read returned no snapshot');
  }
  if (snapshot.schema !== KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_SNAPSHOT_SCHEMA) {
    portableGeometryFailure(`macro source snapshot schema is unsupported: ${snapshot.schema || 'missing'}`);
  }
  validatePortableExactRoute(
    snapshot.route,
    KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_ROUTE,
    'macro source snapshot',
  );
  if (
    snapshot.requestedCapability !== KAMINOS_FLUID_PORTABLE_MACRO_SOURCE_CAPABILITY
    || snapshot.effectiveCapability !== snapshot.requestedCapability
    || snapshot.capability !== snapshot.effectiveCapability
  ) {
    portableGeometryFailure('macro source snapshot capability disagreement');
  }
  if (snapshot.sourceHandleId !== descriptor.sourceHandleId) {
    portableGeometryFailure('macro source snapshot handle identity disagreement');
  }
  if (snapshot.sourceAuthority !== 'live_runtime' || snapshot.fallbackStatus !== 'none') {
    portableGeometryFailure('macro source snapshot authority or fallback is invalid');
  }
  validatePortableExactRoute(
    snapshot.representationRoute,
    KAMINOS_FLUID_REPRESENTATION_FRAME_ROUTE,
    'macro source snapshot representation',
  );
  if (
    snapshot.ownershipIdentity !== descriptor.ownershipIdentity
    || snapshot.producer?.revision !== descriptor.producer.revision
    || snapshot.producer?.runtimeRoute !== descriptor.producer.runtimeRoute
    || snapshot.producer?.method !== descriptor.producer.method
  ) {
    portableGeometryFailure('macro source snapshot producer identity disagreement');
  }
  if (!snapshot.source || typeof snapshot.source !== 'object') {
    portableGeometryFailure('macro source snapshot terrain source identity is missing');
  }
  for (const label of ['requested', 'effective', 'producerId', 'producerRevision']) {
    representationFrameString(snapshot.source[label], `portable snapshot source ${label}`);
  }
  if (
    snapshot.source.requested !== expectedIdentity.source.requested
    || snapshot.source.effective !== expectedIdentity.source.effective
    || snapshot.source.requested !== snapshot.source.effective
  ) {
    portableGeometryFailure('macro source snapshot source route disagreement');
  }
  if (
    snapshot.source.producerId !== expectedIdentity.source.producerId
    || snapshot.source.producerRevision !== expectedIdentity.source.producerRevision
  ) {
    portableGeometryFailure('macro source snapshot source producer disagreement');
  }
  const terrainSource = Object.freeze({
    requested: snapshot.source.requested,
    effective: snapshot.source.effective,
    producerId: snapshot.source.producerId,
    producerRevision: snapshot.source.producerRevision,
  });
  if (
    snapshot.terrainEpoch !== expectedIdentity.terrainEpoch
    || snapshot.fluidEpoch !== expectedIdentity.fluidEpoch
  ) {
    portableGeometryFailure('macro source snapshot epoch disagreement');
  }
  if (snapshot.complete !== true) {
    portableGeometryFailure('macro source snapshot is incomplete');
  }
  if (
    !Number.isFinite(snapshot.confidence)
    || snapshot.confidence < 0
    || snapshot.confidence > 1
  ) {
    portableGeometryFailure('macro source snapshot confidence is invalid');
  }
  if (!Array.isArray(snapshot.dirtyRegions)) {
    portableGeometryFailure('macro source snapshot dirty regions are missing');
  }
  validatePortableNoCameraState(snapshot, 'macro source snapshot');

  diagnostics.phase = 'validate-support-geometry';
  diagnostics.lastTrustworthyEvidence = 'source-snapshot-identity-validated';
  const support = snapshot.supportGeometry;
  if (!support || typeof support !== 'object') {
    portableGeometryFailure('macro source support geometry is missing');
  }
  for (const label of ['geometryId', 'topologyId', 'terrainId', 'supportClass', 'transformId']) {
    representationFrameString(support[label], `portable macro support ${label}`);
  }
  if (
    support.topologyId !== supportDescriptor.topologyId
    || support.terrainId !== supportDescriptor.terrainId
    || support.supportClass !== supportDescriptor.supportClass
    || support.transformId !== supportDescriptor.transformId
    || support.coordinateSpace !== supportDescriptor.coordinateSpace
    || support.worldMetersPerUnit !== supportDescriptor.worldMetersPerUnit
    || support.mapping !== supportDescriptor.mapping
    || support.positionSource !== supportDescriptor.positionSource
  ) {
    portableGeometryFailure('macro source support descriptor disagreement');
  }
  const grid = representationFrameGrid(support.grid, 'portable macro source grid');
  const sampleCount = grid.width * grid.height;
  if (support.sampleCount !== sampleCount || support.sampleCount !== supportDescriptor.sampleCount) {
    portableGeometryFailure('macro source support sample count disagreement');
  }
  const dirtyRegions = snapshot.dirtyRegions.map((region, index) => {
    if (
      !region
      || !Number.isInteger(region.x)
      || !Number.isInteger(region.y)
      || !Number.isInteger(region.width)
      || !Number.isInteger(region.height)
      || region.x < 0
      || region.y < 0
      || region.width <= 0
      || region.height <= 0
      || region.x + region.width > grid.width
      || region.y + region.height > grid.height
    ) {
      portableGeometryFailure(`macro source dirty region ${index} is invalid`);
    }
    return Object.freeze({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
  });
  representationFrameTypedArray(support.worldPosition, sampleCount * 3, 'portable macro world position');
  const tangentU = portableGeometryVectorField(support.tangentU, sampleCount, 'tangent U');
  const tangentV = portableGeometryVectorField(support.tangentV, sampleCount, 'tangent V');
  const normal = portableGeometryVectorField(support.normal, sampleCount, 'normal', { requireUnit: true });
  representationFrameTypedArray(support.jacobian, sampleCount, 'portable macro jacobian');
  const jacobian = Float64Array.from(support.jacobian);
  for (let index = 0; index < sampleCount; index += 1) {
    if (jacobian[index] <= 0) {
      portableGeometryFailure(`jacobian is nonpositive at sample ${index}`);
    }
  }
  representationFrameTypedArray(
    support.supportVelocity,
    sampleCount * 3,
    'portable macro support velocity',
  );
  const supportVelocity = Float64Array.from(support.supportVelocity);

  diagnostics.phase = 'validate-macro-fields';
  diagnostics.lastTrustworthyEvidence = 'support-geometry-validated';
  if (snapshot.macro?.method !== descriptor.producer.method) {
    portableGeometryFailure('macro source method disagreement');
  }
  representationFrameTypedArray(snapshot.macro.mappedDepth, sampleCount, 'portable mapped depth', { nonNegative: true });
  representationFrameTypedArray(snapshot.macro.mappedMomentumU, sampleCount, 'portable mapped momentum U');
  representationFrameTypedArray(snapshot.macro.mappedMomentumV, sampleCount, 'portable mapped momentum V');
  if (!snapshot.macro.materialMasses || typeof snapshot.macro.materialMasses !== 'object') {
    portableGeometryFailure('portable macro material masses are missing');
  }
  const materialMasses = {};
  for (const [key, values] of Object.entries(snapshot.macro.materialMasses)) {
    representationFrameString(key, 'portable material mass channel');
    representationFrameTypedArray(values, sampleCount, `portable material mass ${key}`, { nonNegative: true });
    materialMasses[key] = Float64Array.from(values);
  }
  const physicalMaterial = validatePortablePhysicalMaterial(
    snapshot.physicalMaterial,
    'macro source snapshot material',
  );
  diagnostics.phase = 'construct-provider';
  diagnostics.lastTrustworthyEvidence = 'macro-source-snapshot-validated';

  return {
    representation: {
      grid,
      sampleCount,
      mappedDepth: Float64Array.from(snapshot.macro.mappedDepth),
      mappedMomentumU: Float64Array.from(snapshot.macro.mappedMomentumU),
      mappedMomentumV: Float64Array.from(snapshot.macro.mappedMomentumV),
      materialMasses,
      method: snapshot.macro.method,
      physicalMaterial,
    },
    geometrySource: {
      grid,
      sampleCount,
      supportPosition: Float64Array.from(support.worldPosition),
      tangentU,
      tangentV,
      normal,
      jacobian,
      supportVelocity,
      worldMetersPerUnit: support.worldMetersPerUnit,
      sourceHandle: {
        id: descriptor.sourceHandleId,
        revision: descriptor.producer.revision,
        lifetime: descriptor.lifetime.releasePolicy,
      },
    },
    metadata: {
      identity: support.geometryId,
      transformIdentity: support.transformId,
      terrainId: support.terrainId,
      producerId: terrainSource.producerId,
      producerRevision: terrainSource.producerRevision,
      runtimeProducerRevision: descriptor.producer.revision,
      ownershipIdentity: descriptor.ownershipIdentity,
      capability: descriptor.capability,
    },
    source: Object.freeze({
      schema: descriptor.schema,
      route: Object.freeze({
        requested: descriptor.route.requested,
        effective: descriptor.route.effective,
      }),
      capability: descriptor.capability,
      handleId: descriptor.sourceHandleId,
      sourceAuthority: descriptor.sourceAuthority,
      fallbackStatus: descriptor.fallbackStatus,
      releasePolicy: descriptor.lifetime.releasePolicy,
      retainedTerrainEpoch: descriptor.lifetime.retainedTerrainEpoch,
      retainedFluidEpoch: descriptor.lifetime.retainedFluidEpoch,
      terrain: terrainSource,
    }),
    confidence: snapshot.confidence,
    dirtyRegions: Object.freeze(dirtyRegions),
  };
}

function createFingerFluidPortableMacroGeometryProviderInternal({
  sourceHandle,
  expectedIdentity,
} = {}, diagnostics) {
  const packageDescriptor = validatePortablePackageIdentity(expectedIdentity);
  diagnostics.phase = 'validate-source-descriptor';
  diagnostics.lastTrustworthyEvidence = 'package-identity-validated';
  if (sourceHandle == null) {
    portableGeometryFailure('canonical retained source handle is required');
  }
  const retainedSource = validatePortableMacroSourceHandleForOptics(
    sourceHandle,
    expectedIdentity,
    packageDescriptor,
    diagnostics,
  );
  const {
    representation,
    geometrySource,
    metadata,
    source,
    confidence,
    dirtyRegions,
  } = retainedSource;
  const route = Object.freeze({
    requested: KAMINOS_FINGER_FLUID_PORTABLE_MACRO_PROVIDER_ROUTE,
    effective: KAMINOS_FINGER_FLUID_PORTABLE_MACRO_PROVIDER_ROUTE,
  });
  const packageIdentity = Object.freeze({
    name: packageDescriptor.packageName,
    version: packageDescriptor.packageVersion,
    artifactRevision: packageDescriptor.artifactRevision,
    runtimeRevision: packageDescriptor.runtimeRevision,
    runtimeRoute: packageDescriptor.runtimeRoute,
    sourceAuthority: packageDescriptor.sourceAuthority,
    fallbackStatus: packageDescriptor.fallbackStatus,
  });
  const geometry = Object.freeze({
    identity: metadata.identity,
    transformIdentity: metadata.transformIdentity,
    terrainId: metadata.terrainId,
    producerId: metadata.producerId,
    producerRevision: metadata.producerRevision,
    runtimeProducerRevision: metadata.runtimeProducerRevision,
    sourceHandleId: geometrySource.sourceHandle.id,
    sourceHandleRevision: geometrySource.sourceHandle.revision,
    sourceHandleLifetime: geometrySource.sourceHandle.lifetime,
    width: geometrySource.grid.width,
    height: geometrySource.grid.height,
    spacing: Object.freeze([...geometrySource.grid.spacing]),
    origin: Object.freeze([...geometrySource.grid.origin]),
    worldMetersPerUnit: geometrySource.worldMetersPerUnit,
  });
  const physicalMaterial = Object.freeze({
    densityKgM3: representation.physicalMaterial.densityKgM3,
    dynamicViscosityPaS: representation.physicalMaterial.dynamicViscosityPaS,
    absorptionPerMeter: Object.freeze([...representation.physicalMaterial.absorptionPerMeter]),
  });

  function sampleSurface(index) {
    if (!Number.isInteger(index) || index < 0 || index >= representation.sampleCount) {
      portableGeometryFailure(`sample index is out of range: ${index}`);
    }
    const offset = index * 3;
    const mappedDepth = representation.mappedDepth[index];
    const sampleJacobian = geometrySource.jacobian[index];
    const physicalDepthMeters = mappedDepth / sampleJacobian;
    const worldDepth = physicalDepthMeters / geometrySource.worldMetersPerUnit;
    const support = Array.from(geometrySource.supportPosition.subarray(offset, offset + 3));
    const sampleNormal = Array.from(geometrySource.normal.subarray(offset, offset + 3));
    const surface = support.map((component, componentIndex) => (
      component + sampleNormal[componentIndex] * worldDepth
    ));
    return {
      index,
      wet: mappedDepth > 0,
      mappedDepth,
      physicalDepthMeters,
      supportPosition: support,
      surfacePosition: surface,
      normal: sampleNormal,
      tangentU: Array.from(geometrySource.tangentU.subarray(offset, offset + 3)),
      tangentV: Array.from(geometrySource.tangentV.subarray(offset, offset + 3)),
      jacobian: sampleJacobian,
      supportVelocity: Array.from(geometrySource.supportVelocity.subarray(offset, offset + 3)),
      mappedMomentum: [
        representation.mappedMomentumU[index],
        representation.mappedMomentumV[index],
      ],
      materialMasses: Object.fromEntries(Object.entries(representation.materialMasses).map(
        ([key, values]) => [key, values[index]],
      )),
    };
  }

  function createUploadSnapshot() {
    return {
      schema: KAMINOS_FINGER_FLUID_PORTABLE_MACRO_UPLOAD_SCHEMA,
      geometryIdentity: geometry.identity,
      terrainId: geometry.terrainId,
      sourceHandleId: geometry.sourceHandleId,
      source: source.terrain,
      producerRevision: expectedIdentity.producerRevision,
      fluidEpoch: expectedIdentity.fluidEpoch,
      terrainEpoch: expectedIdentity.terrainEpoch,
      width: geometry.width,
      height: geometry.height,
      sampleCount: representation.sampleCount,
      worldMetersPerUnit: geometry.worldMetersPerUnit,
      physicalMaterial,
      mappedDepth: Float64Array.from(representation.mappedDepth),
      mappedMomentumU: Float64Array.from(representation.mappedMomentumU),
      mappedMomentumV: Float64Array.from(representation.mappedMomentumV),
      materialMasses: Object.fromEntries(Object.entries(representation.materialMasses).map(
        ([key, values]) => [key, Float64Array.from(values)],
      )),
      supportPosition: Float64Array.from(geometrySource.supportPosition),
      tangentU: Float64Array.from(geometrySource.tangentU),
      tangentV: Float64Array.from(geometrySource.tangentV),
      normal: Float64Array.from(geometrySource.normal),
      jacobian: Float64Array.from(geometrySource.jacobian),
      supportVelocity: Float64Array.from(geometrySource.supportVelocity),
      confidence,
      dirtyRegions,
    };
  }

  return Object.freeze({
    schema: KAMINOS_FINGER_FLUID_PORTABLE_MACRO_PROVIDER_SCHEMA,
    route,
    source,
    capability: metadata.capability,
    hostIndependent: true,
    package: packageIdentity,
    producerRevision: expectedIdentity.producerRevision,
    fluidEpoch: expectedIdentity.fluidEpoch,
    terrainEpoch: expectedIdentity.terrainEpoch,
    ownershipIdentity: metadata.ownershipIdentity,
    method: representation.method,
    geometry,
    physicalMaterial,
    confidence,
    dirtyRegions,
    sampleCount: representation.sampleCount,
    sampleSurface,
    createUploadSnapshot,
  });
}

export function createFingerFluidPortableMacroGeometryProvider(options = {}) {
  const diagnostics = {
    phase: 'validate-package-identity',
    sourceHandleId: null,
    lastTrustworthyEvidence: 'no-provider-input-validated',
  };
  try {
    return createFingerFluidPortableMacroGeometryProviderInternal(options, diagnostics);
  } catch (error) {
    throw portableGeometryReportedFailure(error, diagnostics);
  }
}

export function validateFingerFluidOpticalRepresentationFrame(frame, expectedIdentity = {}) {
  if (!frame || typeof frame !== 'object') {
    throw new TypeError('Fluid representation frame is missing');
  }
  const packageDescriptor = expectedIdentity?.packageDescriptor;
  if (
    !expectedIdentity
    || typeof expectedIdentity !== 'object'
    || typeof expectedIdentity.artifactRevision !== 'string'
    || expectedIdentity.artifactRevision.trim().length === 0
    || typeof expectedIdentity.producerRevision !== 'string'
    || expectedIdentity.producerRevision.trim().length === 0
    || !Number.isInteger(expectedIdentity.fluidEpoch)
    || expectedIdentity.fluidEpoch < 0
    || !Number.isInteger(expectedIdentity.terrainEpoch)
    || expectedIdentity.terrainEpoch < 0
    || !packageDescriptor
    || typeof packageDescriptor !== 'object'
  ) {
    throw new Error('Expected fluid representation frame identity is incomplete');
  }
  if (packageDescriptor.schema !== KAMINOS_FLUID_PACKAGE_DESCRIPTOR_SCHEMA) {
    representationFrameFailure(`package descriptor schema is unsupported: ${packageDescriptor.schema || 'missing'}`);
  }
  if (packageDescriptor.sourceAuthority !== 'live_runtime') {
    representationFrameFailure(`package source authority is unsupported: ${packageDescriptor.sourceAuthority || 'missing'}`);
  }
  if (packageDescriptor.fallbackStatus !== 'none') {
    representationFrameFailure(`package fallback is not accepted: ${packageDescriptor.fallbackStatus || 'missing'}`);
  }
  if (packageDescriptor.packageName !== '@kaminos/fluid-webgpu') {
    representationFrameFailure(`package identity is unsupported: ${packageDescriptor.packageName || 'missing'}`);
  }
  representationFrameString(packageDescriptor.packageVersion, 'package version');
  if (packageDescriptor.packageVersion !== KAMINOS_FLUID_PACKAGE_VERSION) {
    representationFrameFailure(`package version is unsupported: ${packageDescriptor.packageVersion}`);
  }
  representationFrameString(packageDescriptor.artifactRevision, 'package artifact revision');
  representationFrameString(packageDescriptor.runtimeRevision, 'package runtime revision');
  representationFrameString(packageDescriptor.runtimeRoute, 'package runtime route');
  if (packageDescriptor.runtimeRoute !== KAMINOS_FLUID_PACKAGE_RUNTIME_ROUTE) {
    representationFrameFailure(`package runtime route is unsupported: ${packageDescriptor.runtimeRoute}`);
  }
  if (packageDescriptor.artifactRevision !== expectedIdentity.artifactRevision) {
    representationFrameFailure(`package artifact revision disagreement: ${JSON.stringify({
      expected: expectedIdentity.artifactRevision,
      observed: packageDescriptor.artifactRevision,
    })}`);
  }
  if (packageDescriptor.runtimeRevision !== expectedIdentity.producerRevision) {
    representationFrameFailure(`package runtime revision disagreement: ${JSON.stringify({
      expected: expectedIdentity.producerRevision,
      observed: packageDescriptor.runtimeRevision,
    })}`);
  }
  if (
    !Array.isArray(packageDescriptor.representationRoutes)
    || !packageDescriptor.representationRoutes.includes(KAMINOS_FLUID_REPRESENTATION_FRAME_ROUTE)
  ) {
    representationFrameFailure('package does not publish the canonical representation route');
  }
  if (frame.schema !== KAMINOS_FLUID_REPRESENTATION_FRAME_SCHEMA) {
    representationFrameFailure(`schema is unsupported: ${frame.schema || 'missing'}`);
  }
  if (
    !frame.route
    || typeof frame.route !== 'object'
    || frame.route.requested !== KAMINOS_FLUID_REPRESENTATION_FRAME_ROUTE
    || frame.route.effective !== KAMINOS_FLUID_REPRESENTATION_FRAME_ROUTE
    || frame.route.requested !== frame.route.effective
  ) {
    representationFrameFailure(`route disagreement: ${JSON.stringify({
      requested: frame.route?.requested || null,
      effective: frame.route?.effective || null,
    })}`);
  }
  for (const forbidden of ['camera', 'view', 'projection', 'viewport', 'screenSpaceDemand']) {
    if (Object.hasOwn(frame, forbidden)) {
      representationFrameFailure(`contains camera-owned state: ${forbidden}`);
    }
  }
  representationFrameString(frame.producerRevision, 'producer revision');
  if (frame.producerRevision !== expectedIdentity.producerRevision) {
    representationFrameFailure(`producer revision disagreement: ${JSON.stringify({
      expected: expectedIdentity.producerRevision,
      observed: frame.producerRevision,
    })}`);
  }
  if (!Number.isInteger(frame.fluidEpoch) || frame.fluidEpoch < 0) {
    representationFrameFailure(`fluid epoch is invalid: ${frame.fluidEpoch}`);
  }
  if (frame.fluidEpoch !== expectedIdentity.fluidEpoch) {
    representationFrameFailure(`fluid epoch disagreement: ${JSON.stringify({
      expected: expectedIdentity.fluidEpoch,
      observed: frame.fluidEpoch,
    })}`);
  }
  if (!Number.isInteger(frame.terrainEpoch) || frame.terrainEpoch < 0) {
    representationFrameFailure(`terrain epoch is invalid: ${frame.terrainEpoch}`);
  }
  if (frame.terrainEpoch !== expectedIdentity.terrainEpoch) {
    representationFrameFailure(`terrain epoch disagreement: ${JSON.stringify({
      expected: expectedIdentity.terrainEpoch,
      observed: frame.terrainEpoch,
    })}`);
  }
  if (frame.complete !== true) {
    representationFrameFailure('is incomplete');
  }
  if (frame.ownershipIdentity !== KAMINOS_FLUID_REPRESENTATION_OWNERSHIP_IDENTITY) {
    representationFrameFailure(`ownership identity is invalid: ${frame.ownershipIdentity || 'missing'}`);
  }

  const outputGrid = representationFrameGrid(frame.grid, 'output grid');
  const grid = representationFrameGrid(frame.macro?.grid, 'macro grid');
  const expectedSampleCount = outputGrid.width * outputGrid.height;
  if (frame.expectedSampleCount !== expectedSampleCount) {
    representationFrameFailure(`expected sample count mismatch: ${frame.expectedSampleCount}`);
  }
  if (
    grid.width !== outputGrid.width
    || grid.height !== outputGrid.height
    || grid.spacing.some((component, index) => component !== outputGrid.spacing[index])
    || grid.origin.some((component, index) => component !== outputGrid.origin[index])
  ) {
    representationFrameFailure('macro and output grid disagreement');
  }
  representationFrameString(frame.macro.method, 'macro method');
  representationFrameTypedArray(
    frame.macro.mappedDepth,
    expectedSampleCount,
    'macro.mappedDepth',
    { nonNegative: true },
  );
  representationFrameTypedArray(
    frame.macro.mappedMomentumU,
    expectedSampleCount,
    'macro.mappedMomentumU',
  );
  representationFrameTypedArray(
    frame.macro.mappedMomentumV,
    expectedSampleCount,
    'macro.mappedMomentumV',
  );
  if (
    !frame.macro.materialMasses
    || typeof frame.macro.materialMasses !== 'object'
    || Array.isArray(frame.macro.materialMasses)
  ) {
    representationFrameFailure('macro material masses are missing');
  }
  const materialKeys = Object.keys(frame.macro.materialMasses).sort();
  for (const key of materialKeys) {
    representationFrameString(key, 'macro material key');
    representationFrameTypedArray(
      frame.macro.materialMasses[key],
      expectedSampleCount,
      `macro.materialMasses.${key}`,
      { nonNegative: true },
    );
  }

  if (!frame.local || !Number.isInteger(frame.local.count) || frame.local.count < 0) {
    representationFrameFailure('local representation count is invalid');
  }
  representationFrameFinite(frame.local.supportScale, 'local support scale', { nonNegative: true });
  if (frame.local.count > 0 && frame.local.sourceBuffer == null) {
    representationFrameFailure('local representation source buffer is missing');
  }
  if (!frame.parcels || !Number.isInteger(frame.parcels.count) || frame.parcels.count < 0) {
    representationFrameFailure('parcel representation count is invalid');
  }
  if (frame.parcels.count > 0 && frame.parcels.sourceBuffer == null) {
    representationFrameFailure('parcel representation source buffer is missing');
  }
  if (!Array.isArray(frame.dirtyRegions)) {
    representationFrameFailure('dirty regions are missing');
  }

  const physicalMaterial = frame.physicalMaterial;
  if (!physicalMaterial || typeof physicalMaterial !== 'object') {
    representationFrameFailure('physical material descriptor is missing');
  }
  representationFrameFinite(
    physicalMaterial.densityKgM3,
    'physical material density',
    { positive: true },
  );
  const dynamicViscosityPaS = physicalMaterial.dynamicViscosityPaS == null
    ? null
    : representationFrameFinite(
      physicalMaterial.dynamicViscosityPaS,
      'physical material dynamic viscosity',
      { nonNegative: true },
    );
  if (
    !physicalMaterial.absorptionPerMeter
    || typeof physicalMaterial.absorptionPerMeter.length !== 'number'
    || physicalMaterial.absorptionPerMeter.length !== 3
  ) {
    representationFrameFailure('physical material absorption is invalid');
  }
  const absorptionPerMeter = Array.from(physicalMaterial.absorptionPerMeter, (value, index) => (
    representationFrameFinite(value, `physical material absorption[${index}]`, { nonNegative: true })
  ));

  const availableRepresentations = ['macro'];
  if (frame.local.count > 0) {
    availableRepresentations.push('local');
  }
  if (frame.parcels.count > 0) {
    availableRepresentations.push('parcel');
  }
  const route = Object.freeze({
    requested: frame.route.requested,
    effective: frame.route.effective,
  });
  const packageIdentity = Object.freeze({
    name: packageDescriptor.packageName,
    version: packageDescriptor.packageVersion,
    artifactRevision: packageDescriptor.artifactRevision,
    runtimeRevision: packageDescriptor.runtimeRevision,
    sourceAuthority: packageDescriptor.sourceAuthority,
    fallbackStatus: packageDescriptor.fallbackStatus,
  });
  const macro = Object.freeze({
    method: frame.macro.method,
    width: grid.width,
    height: grid.height,
    expectedSampleCount,
    materialKeys: Object.freeze(materialKeys),
  });
  const material = Object.freeze({
    densityKgM3: physicalMaterial.densityKgM3,
    dynamicViscosityPaS,
    absorptionPerMeter: Object.freeze(absorptionPerMeter),
  });

  return Object.freeze({
    schema: frame.schema,
    route,
    package: packageIdentity,
    producerRevision: frame.producerRevision,
    fluidEpoch: frame.fluidEpoch,
    terrainEpoch: frame.terrainEpoch,
    ownershipIdentity: frame.ownershipIdentity,
    macro,
    local: Object.freeze({
      count: frame.local.count,
      supportScale: frame.local.supportScale,
    }),
    parcels: Object.freeze({ count: frame.parcels.count }),
    physicalMaterial: material,
    dirtyRegionCount: frame.dirtyRegions.length,
    complete: true,
    expectedSampleCount,
    availableRepresentations: Object.freeze(availableRepresentations),
  });
}

function representationFrameStringArray(value, label) {
  if (!Array.isArray(value)) {
    representationFrameFailure(`${label} is missing`);
  }
  return value.map((entry, index) => representationFrameString(entry, `${label}[${index}]`));
}

function sameStringArray(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validateOpticalExecutionEvidence(execution, transitionIdentity) {
  if (!execution || typeof execution !== 'object') {
    representationFrameFailure('optical execution evidence is missing');
  }
  if (execution.schema !== KAMINOS_FINGER_FLUID_OPTICAL_EXECUTION_SCHEMA) {
    representationFrameFailure(`optical execution schema is unsupported: ${execution.schema || 'missing'}`);
  }
  if (
    !execution.route
    || execution.route.requested !== KAMINOS_FINGER_FLUID_CHANGING_FRAME_OPTICS_ROUTE
    || execution.route.effective !== KAMINOS_FINGER_FLUID_CHANGING_FRAME_OPTICS_ROUTE
    || execution.route.requested !== execution.route.effective
  ) {
    representationFrameFailure(`optical execution route disagreement: ${JSON.stringify({
      requested: execution.route?.requested ?? null,
      effective: execution.route?.effective ?? null,
    })}`);
  }
  if (execution.fallbackStatus !== 'none') {
    representationFrameFailure(`optical execution fallback is not accepted: ${execution.fallbackStatus || 'missing'}`);
  }
  const requestedQuality = representationFrameString(
    execution.quality?.requested,
    'requested optical quality',
  );
  const effectiveQuality = representationFrameString(
    execution.quality?.effective,
    'effective optical quality',
  );
  let adaptationReason = execution.quality?.adaptationReason ?? null;
  if (requestedQuality !== effectiveQuality) {
    adaptationReason = representationFrameString(
      adaptationReason,
      'optical quality adaptation reason',
    );
  } else if (adaptationReason != null) {
    adaptationReason = representationFrameString(
      adaptationReason,
      'optical quality adaptation reason',
    );
  }

  const budget = execution.budget;
  if (!budget || typeof budget !== 'object') {
    representationFrameFailure('optical budget evidence is missing');
  }
  if (budget.measurementStatus !== 'measured' && budget.measurementStatus !== 'unmeasured') {
    representationFrameFailure(`optical budget measurement status is unsupported: ${budget.measurementStatus || 'missing'}`);
  }
  const resolutionScale = representationFrameFinite(
    budget.resolutionScale,
    'optical budget resolution scale',
    { positive: true },
  );
  if (resolutionScale > 1) {
    representationFrameFailure(`optical budget resolution scale is invalid: ${resolutionScale}`);
  }
  const transitionId = `${KAMINOS_FINGER_FLUID_OPTICAL_TRANSITION_SCHEMA}:${JSON.stringify([
    transitionIdentity.packageArtifactRevision,
    transitionIdentity.packageRuntimeRevision,
    transitionIdentity.producerRevision,
    transitionIdentity.previousTerrainEpoch,
    transitionIdentity.currentTerrainEpoch,
    transitionIdentity.previousFluidEpoch,
    transitionIdentity.remapFluidEpoch,
    transitionIdentity.currentFluidEpoch,
    transitionIdentity.remapReceiptId,
    execution.route.requested,
    execution.route.effective,
    requestedQuality,
    effectiveQuality,
    resolutionScale,
  ])}`;
  let gpuTimeMs = null;
  let activeSupportSamples = null;
  let activePixelCount = null;
  let measurementRoute = null;
  let measurementFrameId = null;
  if (budget.measurementStatus === 'measured') {
    if (budget.measurementRoute !== KAMINOS_FINGER_FLUID_OPTICAL_TIMING_ROUTE) {
      representationFrameFailure(`optical budget measurement route is unsupported: ${budget.measurementRoute || 'missing'}`);
    }
    measurementRoute = budget.measurementRoute;
    measurementFrameId = representationFrameString(
      budget.measurementFrameId,
      'optical budget measurement frame id',
    );
    if (measurementFrameId !== transitionId) {
      representationFrameFailure(`optical budget measurement frame id disagreement: ${JSON.stringify({
        expected: transitionId,
        observed: measurementFrameId,
      })}`);
    }
    gpuTimeMs = representationFrameFinite(
      budget.gpuTimeMs,
      'optical budget GPU time',
      { nonNegative: true },
    );
    for (const [value, label] of [
      [budget.activeSupportSamples, 'optical budget active support samples'],
      [budget.activePixelCount, 'optical budget active pixel count'],
    ]) {
      if (!Number.isInteger(value) || value < 0) {
        representationFrameFailure(`${label} is invalid: ${value}`);
      }
    }
    activeSupportSamples = budget.activeSupportSamples;
    activePixelCount = budget.activePixelCount;
  } else if (
    budget.measurementRoute != null
    || budget.measurementFrameId != null
    || budget.gpuTimeMs != null
    || budget.activeSupportSamples != null
    || budget.activePixelCount != null
  ) {
    representationFrameFailure('unmeasured optical budget cannot publish measured values');
  }

  return {
    transitionId,
    route: Object.freeze({
      requested: execution.route.requested,
      effective: execution.route.effective,
    }),
    fallbackStatus: execution.fallbackStatus,
    quality: Object.freeze({
      requested: requestedQuality,
      effective: effectiveQuality,
      adaptationReason,
    }),
    budget: Object.freeze({
      measurementStatus: budget.measurementStatus,
      measurementRoute,
      measurementFrameId,
      gpuTimeMs,
      activeSupportSamples,
      activePixelCount,
      resolutionScale,
    }),
  };
}

export function validateFingerFluidOpticalRepresentationTransition({
  previousFrame,
  currentFrame,
  remapReceipt,
  expectedPreviousIdentity,
  expectedCurrentIdentity,
  opticalExecution,
} = {}) {
  const previous = validateFingerFluidOpticalRepresentationFrame(
    previousFrame,
    expectedPreviousIdentity,
  );
  const current = validateFingerFluidOpticalRepresentationFrame(
    currentFrame,
    expectedCurrentIdentity,
  );
  if (
    previous.package.artifactRevision !== current.package.artifactRevision
    || previous.package.runtimeRevision !== current.package.runtimeRevision
    || previous.producerRevision !== current.producerRevision
  ) {
    representationFrameFailure('changing-frame producer identity changed');
  }
  if (current.terrainEpoch !== previous.terrainEpoch + 1) {
    representationFrameFailure(`changing-frame transition requires exact successor terrain epoch: ${JSON.stringify({
      previous: previous.terrainEpoch,
      current: current.terrainEpoch,
    })}`);
  }
  if (current.fluidEpoch < previous.fluidEpoch) {
    representationFrameFailure(`changing-frame fluid epoch regressed: ${JSON.stringify({
      previous: previous.fluidEpoch,
      current: current.fluidEpoch,
    })}`);
  }

  if (!remapReceipt || typeof remapReceipt !== 'object') {
    representationFrameFailure('terrain remap receipt is missing');
  }
  if (remapReceipt.schema !== 'kaminos.fluid.terrain-remap-receipt.v1') {
    representationFrameFailure(`terrain remap receipt schema is unsupported: ${remapReceipt.schema || 'missing'}`);
  }
  const receiptId = representationFrameString(remapReceipt.receiptId, 'terrain remap receipt id');
  if (remapReceipt.mode !== 'phase_morph') {
    representationFrameFailure(`terrain remap receipt must be phase_morph: ${remapReceipt.mode || 'missing'}`);
  }
  if (remapReceipt.state !== 'committed') {
    representationFrameFailure(`terrain remap receipt must be committed: ${remapReceipt.state || 'missing'}`);
  }
  const terrainId = representationFrameString(remapReceipt.terrainId, 'terrain remap terrain id');
  const sourceId = representationFrameString(remapReceipt.sourceId, 'terrain remap source id');
  const transformId = representationFrameString(remapReceipt.transformId, 'terrain remap transform id');
  if (
    remapReceipt.previousTerrainEpoch !== previous.terrainEpoch
    || remapReceipt.terrainEpoch !== current.terrainEpoch
  ) {
    representationFrameFailure(`terrain remap epoch disagreement: ${JSON.stringify({
      expectedPrevious: previous.terrainEpoch,
      observedPrevious: remapReceipt.previousTerrainEpoch,
      expectedCurrent: current.terrainEpoch,
      observedCurrent: remapReceipt.terrainEpoch,
    })}`);
  }
  if (
    !Number.isInteger(remapReceipt.fluidEpoch)
    || remapReceipt.fluidEpoch < previous.fluidEpoch
    || remapReceipt.fluidEpoch > current.fluidEpoch
  ) {
    representationFrameFailure(`terrain remap fluid epoch is outside the accepted transition: ${remapReceipt.fluidEpoch}`);
  }

  const predecessorReceiptIds = representationFrameStringArray(
    remapReceipt.predecessorReceiptIds,
    'terrain remap predecessor receipt ids',
  );
  const receiptLineageIds = representationFrameStringArray(
    remapReceipt.lineageIds,
    'terrain remap lineage ids',
  );
  const previousReceiptIds = representationFrameStringArray(
    previousFrame.conservationReceiptIds,
    'previous frame conservation receipt ids',
  );
  const currentReceiptIds = representationFrameStringArray(
    currentFrame.conservationReceiptIds,
    'current frame conservation receipt ids',
  );
  const previousLineageIds = representationFrameStringArray(
    previousFrame.lineageIds,
    'previous frame lineage ids',
  );
  const currentLineageIds = representationFrameStringArray(
    currentFrame.lineageIds,
    'current frame lineage ids',
  );
  if (!sameStringArray(predecessorReceiptIds, previousReceiptIds)) {
    representationFrameFailure('terrain remap predecessor receipt chain disagrees with the previous frame');
  }
  if (
    currentReceiptIds.length < previousReceiptIds.length
    || !sameStringArray(
      currentReceiptIds.slice(0, previousReceiptIds.length),
      previousReceiptIds,
    )
  ) {
    representationFrameFailure('current frame lost the previous conservation receipt chain');
  }
  if (!currentReceiptIds.includes(receiptId)) {
    representationFrameFailure('current frame is missing the terrain remap receipt');
  }
  for (const lineageId of new Set([...previousLineageIds, ...receiptLineageIds])) {
    if (!currentLineageIds.includes(lineageId)) {
      representationFrameFailure(`current frame lost terrain remap lineage: ${lineageId}`);
    }
  }

  const displacedVolume = representationFrameFinite(
    remapReceipt.displacedVolume,
    'terrain remap displaced volume',
  );
  const supportWork = representationFrameFinite(
    remapReceipt.supportWork,
    'terrain remap support work',
  );
  const maximumBedDisplacement = representationFrameFinite(
    remapReceipt.maximumBedDisplacement,
    'terrain remap maximum bed displacement',
    { nonNegative: true },
  );
  const maximumSupportSpeed = representationFrameFinite(
    remapReceipt.maximumSupportSpeed,
    'terrain remap maximum support speed',
    { nonNegative: true },
  );
  const deltaSeconds = representationFrameFinite(
    remapReceipt.deltaSeconds,
    'terrain remap delta seconds',
    { positive: true },
  );
  const motionSubstepEnvelope = representationFrameFinite(
    remapReceipt.motionSubstepEnvelope,
    'terrain remap motion substep envelope',
    { positive: true },
  );
  if (deltaSeconds > motionSubstepEnvelope) {
    representationFrameFailure('terrain remap delta exceeds its motion substep envelope');
  }
  const tolerance = representationFrameFinite(
    remapReceipt.tolerance,
    'terrain remap tolerance',
    { nonNegative: true },
  );
  const volumeResidual = representationFrameFinite(
    remapReceipt.residual?.volume,
    'terrain remap volume residual',
  );
  if (Math.abs(volumeResidual) > tolerance) {
    representationFrameFailure(`terrain remap volume residual exceeds tolerance: ${volumeResidual}`);
  }
  if (
    !Array.isArray(remapReceipt.residual?.momentum)
    || remapReceipt.residual.momentum.length !== 3
  ) {
    representationFrameFailure('terrain remap momentum residual is invalid');
  }
  for (const [index, residual] of remapReceipt.residual.momentum.entries()) {
    representationFrameFinite(residual, `terrain remap momentum residual[${index}]`);
    if (Math.abs(residual) > tolerance) {
      representationFrameFailure(`terrain remap momentum residual exceeds tolerance: ${residual}`);
    }
  }
  if (
    !remapReceipt.residual?.materials
    || typeof remapReceipt.residual.materials !== 'object'
    || Array.isArray(remapReceipt.residual.materials)
  ) {
    representationFrameFailure('terrain remap material residuals are invalid');
  }
  for (const [material, residual] of Object.entries(remapReceipt.residual.materials)) {
    representationFrameFinite(residual, `terrain remap material residual ${material}`);
    if (Math.abs(residual) > tolerance) {
      representationFrameFailure(`terrain remap material residual exceeds tolerance: ${material}`);
    }
  }

  const execution = validateOpticalExecutionEvidence(opticalExecution, {
    packageArtifactRevision: current.package.artifactRevision,
    packageRuntimeRevision: current.package.runtimeRevision,
    producerRevision: current.producerRevision,
    previousTerrainEpoch: previous.terrainEpoch,
    currentTerrainEpoch: current.terrainEpoch,
    previousFluidEpoch: previous.fluidEpoch,
    remapFluidEpoch: remapReceipt.fluidEpoch,
    currentFluidEpoch: current.fluidEpoch,
    remapReceiptId: receiptId,
  });
  return Object.freeze({
    schema: KAMINOS_FINGER_FLUID_OPTICAL_TRANSITION_SCHEMA,
    transitionId: execution.transitionId,
    route: execution.route,
    fallbackStatus: execution.fallbackStatus,
    quality: execution.quality,
    package: current.package,
    epochs: Object.freeze({
      previousTerrain: previous.terrainEpoch,
      currentTerrain: current.terrainEpoch,
      previousFluid: previous.fluidEpoch,
      remapFluid: remapReceipt.fluidEpoch,
      currentFluid: current.fluidEpoch,
    }),
    remap: Object.freeze({
      receiptId,
      mode: remapReceipt.mode,
      state: remapReceipt.state,
      terrainId,
      sourceId,
      transformId,
      displacedVolume,
      supportWork,
      maximumBedDisplacement,
      maximumSupportSpeed,
      deltaSeconds,
      motionSubstepEnvelope,
    }),
    conservationReceiptIds: Object.freeze([...currentReceiptIds]),
    lineageIds: Object.freeze([...currentLineageIds]),
    budget: execution.budget,
  });
}

function radianceFailure(message) {
  throw new Error(`Radiance HDR ${message}`);
}

export function decodeRadianceHdrRgbe(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  let cursor = 0;
  const readLine = () => {
    const start = cursor;
    while (cursor < bytes.length && bytes[cursor] !== 0x0a) cursor += 1;
    if (cursor >= bytes.length) radianceFailure('header is truncated');
    let end = cursor;
    cursor += 1;
    if (end > start && bytes[end - 1] === 0x0d) end -= 1;
    return new TextDecoder('ascii').decode(bytes.subarray(start, end));
  };

  const signature = readLine();
  if (signature !== '#?RADIANCE' && signature !== '#?RGBE') {
    radianceFailure(`signature is unsupported: ${signature || 'missing'}`);
  }
  let format = null;
  while (true) {
    const line = readLine();
    if (!line) break;
    if (line.startsWith('FORMAT=')) format = line.slice('FORMAT='.length);
  }
  if (format !== '32-bit_rle_rgbe') radianceFailure(`format is unsupported: ${format || 'missing'}`);

  const resolution = readLine();
  const resolutionMatch = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(resolution);
  if (!resolutionMatch) radianceFailure(`orientation is unsupported: ${resolution || 'missing'}`);
  const height = Number(resolutionMatch[1]);
  const width = Number(resolutionMatch[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 8 || width > 0x7fff || height < 1) {
    radianceFailure(`dimensions are unsupported: ${width}x${height}`);
  }

  const rgbe = new Uint8Array(width * height * 4);
  const channels = new Uint8Array(width * 4);
  for (let y = 0; y < height; y += 1) {
    if (cursor + 4 > bytes.length) radianceFailure(`scanline ${y} header is truncated`);
    if (bytes[cursor] !== 2 || bytes[cursor + 1] !== 2 || (bytes[cursor + 2] & 0x80) !== 0) {
      radianceFailure(`scanline ${y} does not use supported RLE`);
    }
    const scanlineWidth = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    cursor += 4;
    if (scanlineWidth !== width) radianceFailure(`scanline ${y} width ${scanlineWidth} disagrees with ${width}`);

    for (let channel = 0; channel < 4; channel += 1) {
      let x = 0;
      while (x < width) {
        if (cursor >= bytes.length) radianceFailure(`scanline ${y} channel ${channel} run is truncated`);
        const code = bytes[cursor];
        cursor += 1;
        if (code > 128) {
          const runLength = code - 128;
          if (runLength === 0 || x + runLength > width || cursor >= bytes.length) {
            radianceFailure(`scanline ${y} channel ${channel} repeat run is invalid`);
          }
          channels.fill(bytes[cursor], channel * width + x, channel * width + x + runLength);
          cursor += 1;
          x += runLength;
        } else {
          const runLength = code;
          if (runLength === 0 || x + runLength > width || cursor + runLength > bytes.length) {
            radianceFailure(`scanline ${y} channel ${channel} literal run is invalid or truncated`);
          }
          channels.set(bytes.subarray(cursor, cursor + runLength), channel * width + x);
          cursor += runLength;
          x += runLength;
        }
      }
    }

    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const texelOffset = rowOffset + x * 4;
      rgbe[texelOffset] = channels[x];
      rgbe[texelOffset + 1] = channels[width + x];
      rgbe[texelOffset + 2] = channels[width * 2 + x];
      rgbe[texelOffset + 3] = channels[width * 3 + x];
    }
  }

  return {
    width,
    height,
    format,
    orientation: '-Y +X',
    rgbe,
    encodedByteLength: bytes.byteLength,
  };
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loadFingerFluidHdrEnvironment() {
  const response = await fetch(KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HDR environment request failed with HTTP ${response.status}`);
  const encoded = await response.arrayBuffer();
  const assetSha256 = await sha256Hex(encoded);
  if (assetSha256 !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SHA256) {
    throw new Error(`HDR environment SHA-256 mismatch: expected ${KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SHA256}, received ${assetSha256}`);
  }
  const decoded = decodeRadianceHdrRgbe(encoded);
  if (decoded.width !== 1024 || decoded.height !== 512) {
    throw new Error(`HDR environment dimensions mismatch: expected 1024x512, received ${decoded.width}x${decoded.height}`);
  }
  return { ...decoded, assetSha256 };
}

const PARTICLE_FLOATS = 16;
const PARTICLE_BYTES = PARTICLE_FLOATS * 4;
const INTERFACE_RECORD_FLOATS = 20;
const INTERFACE_RECORD_BYTES = INTERFACE_RECORD_FLOATS * 4;
const INTERFACE_COUNTER_WORDS = 10;
const INTERFACE_COUNTER_BYTES = INTERFACE_COUNTER_WORDS * 4;
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
export const KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED = Math.fround(3.2);
export const KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE = 3.2;
const MIN_NORMAL_F32 = 2 ** -126;
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
const DYNAMIC_REFLECTION_MESH_OBJECT_ID = 101;
const DYNAMIC_REFLECTION_MESH_VERTEX_COUNT = 24;
const DYNAMIC_REFLECTION_MESH_INDEX_COUNT = 36;
const DYNAMIC_REFLECTION_MESH_TRIANGLE_COUNT = DYNAMIC_REFLECTION_MESH_INDEX_COUNT / 3;
const LINEAR_SCENE_FORMAT = 'rgba16float';
const LINEAR_SCENE_EXPOSURE = 0.58;
const LINEAR_HDR_WORLD_LIGHTING_CONSUMERS = Object.freeze([
  'visible_world_background',
  'analytic_support',
  'dynamic_indexed_mesh',
  'liquid_world_reflection',
]);
const INTERFACE_THRESHOLD = 0.32;
const INTERFACE_ENTER_THRESHOLD = 0.38;
const INTERFACE_EXIT_THRESHOLD = 0.22;
const REST_STATE_FLOATS = 4;
const REST_STATE_BYTES = REST_STATE_FLOATS * 4;
export const KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS = 36;
const NEIGHBOR_TOPOLOGY_WORDS = KAMINOS_FINGER_FLUID_NEIGHBOR_TOPOLOGY_WORDS;
const NEIGHBOR_TOPOLOGY_BYTES = NEIGHBOR_TOPOLOGY_WORDS * 4;
const MATERIAL_TRACER_FLOATS = 20;
const MATERIAL_TRACER_BYTES = MATERIAL_TRACER_FLOATS * 4;
const ENERGY_RECORD_FLOATS = 4;
const ENERGY_RECORD_BYTES = ENERGY_RECORD_FLOATS * 4;
const INVALID_NEIGHBOR_ID = 0xffffffff;
let nextLiquidFireContactAllocationGeneration = 1;

export function createFingerFluidInitialParticleOwnershipState({
  active,
  sourceOwned,
  sourceGeneration = 0,
} = {}) {
  if (typeof active !== 'boolean' || typeof sourceOwned !== 'boolean') {
    throw new TypeError('Finger fluid initial ownership requires explicit active and sourceOwned booleans');
  }
  if (!Number.isSafeInteger(sourceGeneration) || sourceGeneration < 0) {
    throw new TypeError('Finger fluid initial ownership source generation must be a non-negative safe integer');
  }
  if (!active) {
    return {
      phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant,
      sourceGeneration,
      transitionFrame: 0,
      supportContact: 0,
    };
  }
  return {
    phase: sourceOwned
      ? KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.preImpact
      : KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration,
    transitionFrame: 0,
    supportContact: sourceOwned
      ? 0
      : KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD,
  };
}

export function advanceFingerFluidParticleOwnershipState(state, {
  active,
  supportContact,
  frameIndex,
} = {}) {
  const phase = Number(state?.phase);
  const sourceGeneration = Number(state?.sourceGeneration);
  const transitionFrame = Number(state?.transitionFrame);
  const priorSupportContact = Number(state?.supportContact);
  if (
    !Object.values(KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES).includes(phase)
    || !Number.isSafeInteger(sourceGeneration)
    || sourceGeneration < 0
    || !Number.isSafeInteger(transitionFrame)
    || transitionFrame < 0
    || !Number.isFinite(priorSupportContact)
    || priorSupportContact < 0
    || priorSupportContact > 1
  ) {
    throw new TypeError('Finger fluid particle ownership state is invalid');
  }
  if (!active) {
    return {
      phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant,
      sourceGeneration,
      transitionFrame: 0,
      supportContact: 0,
    };
  }
  if (phase !== KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.preImpact) {
    return { phase, sourceGeneration, transitionFrame, supportContact: priorSupportContact };
  }
  const contact = Number(supportContact);
  const frame = Number(frameIndex);
  if (!Number.isFinite(contact) || contact < 0 || contact > 1) {
    throw new TypeError('Finger fluid particle ownership support contact must be in [0, 1]');
  }
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new TypeError('Finger fluid particle ownership frame index must be a non-negative safe integer');
  }
  if (contact < KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD) {
    return { phase, sourceGeneration, transitionFrame, supportContact: priorSupportContact };
  }
  return {
    phase: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact,
    sourceGeneration,
    transitionFrame: frame,
    supportContact: contact,
  };
}

function fingerFluidParticleOwnershipStateValues(state, label) {
  const values = {
    phase: state?.phase,
    sourceGeneration: state?.sourceGeneration,
    transitionFrame: state?.transitionFrame,
    supportContact: state?.supportContact,
  };
  if (
    !Object.values(KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES).includes(values.phase)
    || !Number.isSafeInteger(values.sourceGeneration)
    || values.sourceGeneration < 0
    || !Number.isSafeInteger(values.transitionFrame)
    || values.transitionFrame < 0
    || !Number.isFinite(values.supportContact)
    || values.supportContact < 0
    || values.supportContact > 1
  ) {
    throw new TypeError(`Finger fluid ${label} ownership state is invalid`);
  }
  return values;
}

export function mergeFingerFluidParticleOwnershipStates(parentState, childState) {
  const parent = fingerFluidParticleOwnershipStateValues(parentState, 'parent');
  const child = fingerFluidParticleOwnershipStateValues(childState, 'child');
  if (child.phase > parent.phase) return child;
  if (parent.phase > child.phase) return parent;
  if (parent.phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact) {
    if (child.transitionFrame < parent.transitionFrame) return child;
    if (parent.transitionFrame < child.transitionFrame) return parent;
  }
  if (child.sourceGeneration > parent.sourceGeneration) return child;
  return parent;
}

export function classifyFingerFluidParticleOwnershipRecord(state, { active } = {}) {
  const phase = state?.phase;
  const sourceGeneration = state?.sourceGeneration;
  const transitionFrame = state?.transitionFrame;
  const supportContact = state?.supportContact;
  const invalid = reason => ({ valid: false, phase: null, reason });
  if (typeof active !== 'boolean') return invalid('active_state_invalid');
  if (!Object.values(KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES).includes(phase)) {
    return invalid('phase_invalid');
  }
  if (!Number.isSafeInteger(sourceGeneration) || sourceGeneration < 0) {
    return invalid('source_generation_invalid');
  }
  if (!Number.isSafeInteger(transitionFrame) || transitionFrame < 0) {
    return invalid('transition_frame_invalid');
  }
  if (!Number.isFinite(supportContact) || supportContact < 0 || supportContact > 1) {
    return invalid('support_contact_invalid');
  }
  if (!active && phase !== KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant) {
    return invalid('inactive_phase_not_dormant');
  }
  if (active && phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant) {
    return invalid('active_phase_dormant');
  }
  if (
    phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant
    && (transitionFrame !== 0 || supportContact !== 0)
  ) {
    return invalid('dormant_transition_payload_stale');
  }
  if (
    phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.preImpact
    && (transitionFrame !== 0 || supportContact !== 0)
  ) {
    return invalid('pre_impact_transition_completed');
  }
  if (
    phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact
    && supportContact < KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD
  ) {
    return invalid('post_impact_contact_below_threshold');
  }
  return { valid: true, phase, reason: null };
}

function adaptiveVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(component => !Number.isFinite(component))) {
    throw new TypeError(`Finger fluid adaptive density ${label} must be a finite vec3`);
  }
  return value.map(Number);
}

function adaptiveScalar(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`Finger fluid adaptive density ${label} must be finite`);
  return Number(value);
}

function adaptiveParticleState(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`Finger fluid adaptive density ${label} state is required`);
  return {
    active: Boolean(value.active),
    volumeScale: adaptiveScalar(value.volumeScale, `${label} volumeScale`),
    position: adaptiveVector3(value.position, `${label} position`),
    velocity: adaptiveVector3(value.velocity, `${label} velocity`),
    chemistry: adaptiveScalar(value.chemistry, `${label} chemistry`),
  };
}

function adaptiveConservation(parent, child) {
  const states = [parent, child].filter(state => state.active && state.volumeScale > 0);
  const volume = states.reduce((sum, state) => sum + state.volumeScale, 0);
  const momentum = [0, 1, 2].map(axis => states.reduce(
    (sum, state) => sum + state.velocity[axis] * state.volumeScale,
    0,
  ));
  const chemistryMass = states.reduce((sum, state) => sum + state.chemistry * state.volumeScale, 0);
  return { volume, momentum, chemistryMass };
}

function adaptiveCenterOfMass(parent, child) {
  const conservation = adaptiveConservation(parent, child);
  if (conservation.volume <= 0) return [0, 0, 0];
  return [0, 1, 2].map(axis => (
    (parent.active ? parent.position[axis] * parent.volumeScale : 0)
      + (child.active ? child.position[axis] * child.volumeScale : 0)
  ) / conservation.volume);
}

export function evaluateFingerFluidAdaptivePairTransition({
  action,
  parent: parentInput,
  child: childInput,
  splitDirection = [1, 0, 0],
  splitDistance = 0,
} = {}) {
  const parent = adaptiveParticleState(parentInput, 'parent');
  const child = adaptiveParticleState(childInput, 'child');
  const before = adaptiveConservation(parent, child);
  const centerOfMassBefore = adaptiveCenterOfMass(parent, child);
  let nextParent;
  let nextChild;
  if (action === 'split') {
    if (!parent.active || parent.volumeScale !== 1 || child.active || child.volumeScale !== 0) {
      throw new Error('Finger fluid adaptive split requires one active unit-volume parent and one dormant zero-volume child');
    }
    const direction = adaptiveVector3(splitDirection, 'splitDirection');
    const length = Math.hypot(...direction);
    if (length <= 0) throw new RangeError('Finger fluid adaptive splitDirection must be nonzero');
    const distance = adaptiveScalar(splitDistance, 'splitDistance');
    const offset = direction.map(component => component / length * distance * 0.5);
    nextParent = { ...parent, volumeScale: 0.5, position: parent.position.map((value, axis) => value - offset[axis]) };
    nextChild = { ...parent, active: true, volumeScale: 0.5, position: parent.position.map((value, axis) => value + offset[axis]) };
  } else if (action === 'merge') {
    if (!parent.active || !child.active || parent.volumeScale <= 0 || child.volumeScale <= 0) {
      throw new Error('Finger fluid adaptive merge requires an active represented-volume pair');
    }
    const volumeScale = parent.volumeScale + child.volumeScale;
    const weighted = key => [0, 1, 2].map(axis => (
      parent[key][axis] * parent.volumeScale + child[key][axis] * child.volumeScale
    ) / volumeScale);
    nextParent = {
      ...parent,
      volumeScale,
      position: weighted('position'),
      velocity: weighted('velocity'),
      chemistry: (parent.chemistry * parent.volumeScale + child.chemistry * child.volumeScale) / volumeScale,
    };
    nextChild = { ...child, active: false, volumeScale: 0, velocity: [0, 0, 0], chemistry: 0 };
  } else {
    throw new RangeError(`Unsupported finger fluid adaptive transition: ${action}`);
  }
  return {
    parent: nextParent,
    child: nextChild,
    conservation: { before, after: adaptiveConservation(nextParent, nextChild) },
    centerOfMassBefore,
    centerOfMassAfter: adaptiveCenterOfMass(nextParent, nextChild),
  };
}

export function summarizeFingerFluidAdaptiveDensityLedger(states) {
  if (!Array.isArray(states)) throw new TypeError('Finger fluid adaptive density ledger requires particle states');
  const active = states.filter(state => state.active && state.volumeScale > 0);
  const round = value => Number(value.toFixed(9));
  return {
    activeParticleCount: active.length,
    baseParticleCount: active.filter(state => state.role === 'base').length,
    refinedParentCount: active.filter(state => state.role === 'parent').length,
    activeChildCount: active.filter(state => state.role === 'child').length,
    reservedChildCount: states.filter(state => state.role === 'child' && !state.active).length,
    representedVolume: round(active.reduce((sum, state) => sum + state.volumeScale, 0)),
    momentum: [0, 1, 2].map(axis => round(active.reduce(
      (sum, state) => sum + state.velocity[axis] * state.volumeScale,
      0,
    ))),
    chemistryMass: round(active.reduce((sum, state) => sum + state.chemistry * state.volumeScale, 0)),
  };
}

export function validateFingerFluidAdaptiveDensityLedger(
  ledger,
  {
    baseParticleCount = ledger?.baseParticleCount,
    simulationCapacity = ledger?.simulationCapacity,
    requireActiveRefinement = false,
  } = {},
) {
  if (!ledger || typeof ledger !== 'object') {
    throw new TypeError('Finger fluid adaptive density ledger must be an object');
  }
  if (ledger.contract !== KAMINOS_FINGER_FLUID_ADAPTIVE_DENSITY_CONTRACT || ledger.enabled !== true) {
    throw new Error(`Finger fluid adaptive density ledger route identity mismatch: ${JSON.stringify({ contract: ledger.contract, enabled: ledger.enabled })}`);
  }
  const expectedBaseParticleCount = Number(baseParticleCount);
  const expectedSimulationCapacity = Number(simulationCapacity);
  if (
    !Number.isSafeInteger(expectedBaseParticleCount)
    || expectedBaseParticleCount <= 0
    || !Number.isSafeInteger(expectedSimulationCapacity)
    || expectedSimulationCapacity <= 0
  ) {
    throw new Error(`Finger fluid adaptive density expected populations are malformed: ${JSON.stringify({ baseParticleCount, simulationCapacity })}`);
  }
  const integerFields = [
    'baseParticleCount',
    'simulationCapacity',
    'activeParticleCount',
    'unrefinedBaseParticleCount',
    'refinedParentCount',
    'activeChildCount',
    'reservedChildCount',
    'splitCount',
    'mergeCount',
  ];
  for (const field of integerFields) {
    if (!Number.isSafeInteger(ledger[field]) || ledger[field] < 0) {
      throw new Error(`Finger fluid adaptive density ledger has malformed ${field}: ${ledger[field]}`);
    }
  }
  if (
    ledger.baseParticleCount !== expectedBaseParticleCount
    || ledger.simulationCapacity !== expectedSimulationCapacity
    || expectedSimulationCapacity !== expectedBaseParticleCount * 2
  ) {
    throw new Error(`Finger fluid adaptive density population identity mismatch: ${JSON.stringify({ expectedBaseParticleCount, expectedSimulationCapacity, ledgerBaseParticleCount: ledger.baseParticleCount, ledgerSimulationCapacity: ledger.simulationCapacity })}`);
  }
  if (
    ledger.refinedParentCount !== ledger.activeChildCount
    || ledger.activeChildCount + ledger.reservedChildCount !== expectedBaseParticleCount
    || ledger.activeParticleCount !== ledger.unrefinedBaseParticleCount + ledger.refinedParentCount + ledger.activeChildCount
  ) {
    throw new Error(`Finger fluid adaptive density pair accounting mismatch: ${JSON.stringify(ledger)}`);
  }
  const representedVolumeTolerance = Math.max(0.001, expectedBaseParticleCount * 0.000001);
  if (
    !Number.isFinite(ledger.representedVolume)
    || Math.abs(ledger.representedVolume - expectedBaseParticleCount) > representedVolumeTolerance
    || ledger.accountingValid !== true
  ) {
    throw new Error(`Finger fluid adaptive density represented-volume accounting invalid: ${JSON.stringify(ledger)}`);
  }
  if (
    requireActiveRefinement
    && (ledger.splitCount <= 0 || ledger.refinedParentCount <= 0 || ledger.activeChildCount <= 0)
  ) {
    throw new Error(`Finger fluid adaptive transition traffic missing: ${JSON.stringify(ledger)}`);
  }
  return ledger;
}

export const KAMINOS_FINGER_FLUID_COLOR_MODES = Object.freeze(['phase', 'particle_id', 'speed', 'density', 'surface', 'neighbor_retention', 'chemistry', 'sheet_release']);
export const KAMINOS_FINGER_FLUID_TRUTH_SCENES = Object.freeze(['multi_regime_playground', 'deep_pool_rest', 'dam_break', 'laminar_inlets', 'waterfall_resolution_oracle', 'live_hand_inlets']);
export const KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_PRESETS = Object.freeze([
  'baseline', 'production', 'sweep3x', 'sweep4x', 'sweep6x', 'high',
]);
const KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_RESOLUTIONS = Object.freeze({
  baseline: Object.freeze({ volumeMultiplier: 1, particleCount: 12_288, laneColumns: 15, laneRows: 4 }),
  production: Object.freeze({ volumeMultiplier: 2, particleCount: 24_576, laneColumns: 19, laneRows: 5 }),
  sweep3x: Object.freeze({ volumeMultiplier: 3, particleCount: 36_864, laneColumns: 22, laneRows: 6 }),
  sweep4x: Object.freeze({ volumeMultiplier: 4, particleCount: 49_152, laneColumns: 24, laneRows: 6 }),
  sweep6x: Object.freeze({ volumeMultiplier: 6, particleCount: 73_728, laneColumns: 27, laneRows: 7 }),
  high: Object.freeze({ volumeMultiplier: 8, particleCount: 98_304, laneColumns: 30, laneRows: 8 }),
});
export const KAMINOS_FINGER_FLUID_INLET_PROFILES = Object.freeze(['round_poiseuille', 'slot_poiseuille', 'porous_darcy']);
export const KAMINOS_FINGER_FLUID_RENDERER_MODES = Object.freeze(['screen_space_surface', 'screen_space_refraction', 'sphere_debug']);
export const KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES = Object.freeze(['shaded', 'depth', 'entry_depth', 'normal', 'exit_depth', 'exit_normal', 'thickness', 'path_length', 'exit_validity', 'refraction_offset', 'fresnel', 'absorption', 'reflection', 'reflection_hit_kind', 'reflection_distance', 'environment', 'liquid_support', 'environment_contribution', 'coverage', 'refraction_hit_kind', 'refraction_distance', 'refraction_fallback_delta', 'legacy_interface', 'interface_fidelity', 'transmitted_transport', 'reflected_transport', 'scatter_transport', 'pre_tonemap_luminance', 'normal_variance', 'reflection_footprint', 'exit_normal_variance', 'transmission_footprint', 'body_transport_path', 'body_transport_residual', 'macro_interface_normal', 'micro_normal_residual', 'interface_roughness', 'transmission_detail_weight']);
export const KAMINOS_FINGER_FLUID_OPTICAL_LIGHTING_MODES = Object.freeze(['transport_only', 'bounded_ggx', 'legacy_shading']);
export const KAMINOS_FINGER_FLUID_OPTICAL_FOOTPRINT_MODES = Object.freeze(['resolved_detail', 'variance_filtered']);
export const KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_MODES = Object.freeze(['resolved_exit', 'dense_exit_filtered']);
export const KAMINOS_FINGER_FLUID_BODY_TRANSPORT_MODES = Object.freeze(['geometric_slab', 'robust_dense_body']);
export const KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_MODES = Object.freeze(['coupled_detail', 'macro_micro_separated']);
export const KAMINOS_FINGER_FLUID_LIVE_INLET_WITNESS_CAMERA = Object.freeze({
  yaw: -0.48,
  pitch: 0.3,
  distance: 3.25,
  target: Object.freeze([0, 0.12, -0.42]),
});

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

export function resolveFingerFluidMaxSpeed(value = KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED) {
  const speed = Number(value ?? KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError(`Finger fluid maximum speed must be finite and positive: ${value}`);
  }
  const f32Speed = Math.fround(speed);
  if (!Number.isFinite(f32Speed) || f32Speed < MIN_NORMAL_F32) {
    throw new RangeError(`Finger fluid maximum speed must be representable as a normal finite f32: ${value}`);
  }
  return f32Speed;
}

function isFingerFluidLaminarSourceScene(scene) {
  return scene === 'laminar_inlets' || scene === 'waterfall_resolution_oracle' || scene === 'live_hand_inlets';
}

const LIVE_HAND_INLET_CAPACITY = 5;
const LIVE_HAND_INLET_FLOATS = 16;
const LIVE_HAND_DEFAULT_RESIDENCE_SECONDS = 1.65;
const LIVE_HAND_DEFAULT_RESIDENCE_DISTANCE_WORLD = 2.4;
const MAX_FINITE_F32 = 3.402823466e38;

function finiteFingerFluidVector(vector, fallback) {
  if (!Array.isArray(vector) || vector.length !== 3) return [...fallback];
  return vector.map((value, index) => Number.isFinite(Number(value)) ? Number(value) : fallback[index]);
}

function tangentForInletAxis(axis) {
  const reference = Math.abs(axis[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
  return normalizeFingerFluidInletVector([
    reference[1] * axis[2] - reference[2] * axis[1],
    reference[2] * axis[0] - reference[0] * axis[2],
    reference[0] * axis[1] - reference[1] * axis[0],
  ], 'live inlet tangent');
}

export function normalizeFingerFluidLiveInletPacket(packet) {
  const source = packet && typeof packet === 'object' ? packet : {};
  const sourceEmitters = Array.isArray(source.emitters) ? source.emitters : [];
  if (sourceEmitters.length > LIVE_HAND_INLET_CAPACITY) {
    throw new RangeError(
      `Finger fluid live-inlet emitter count ${sourceEmitters.length} exceeds GPU capacity ${LIVE_HAND_INLET_CAPACITY}`,
    );
  }
  const sourceAuthority = source.authority?.stale === true
    ? 'stale_source_authority'
    : source.simulation_authority !== 'live_simulation'
      ? 'non_live_simulation_authority'
      : source.authority?.simulation_safe !== true
        ? 'simulation_unsafe'
        : 'live_simulation_authority';
  const simulationSafe = sourceAuthority === 'live_simulation_authority';
  const emitters = sourceEmitters
    .map((emitter, index) => {
      const axis = normalizeFingerFluidInletVector(
        finiteFingerFluidVector(emitter.aim_world, [0, 0.15, -1]),
        `live inlet ${emitter.id || index} axis`,
      );
      const requestedActive = emitter.active === true && emitter.emission_state === 'jet';
      const active = simulationSafe && requestedActive;
      return Object.freeze({
        id: String(emitter.id || `inlet-${index}`),
        origin: Object.freeze(finiteFingerFluidVector(emitter.origin_world, [0, 0, -0.8])),
        axis: Object.freeze(axis),
        tangent: Object.freeze(tangentForInletAxis(axis)),
        radius: Math.max(0.035, Math.min(0.18, finite(emitter.radius, 0.07) * 1.45)),
        maximumSpeed: Math.max(0.25, Math.min(2.6, finite(emitter.strength, 1.15) * 1.35)),
        reservoirLength: 0.26,
        requestedActive,
        active,
        activationAuthority: requestedActive
          ? sourceAuthority
          : 'inactive_request',
      });
    });
  while (emitters.length < LIVE_HAND_INLET_CAPACITY) {
    emitters.push(Object.freeze({
      id: `inactive-${emitters.length}`,
      origin: Object.freeze([0, 0, -0.8]),
      axis: Object.freeze([0, 0.15, -0.988686]),
      tangent: Object.freeze([1, 0, 0]),
      radius: 0.07,
      maximumSpeed: 0,
      reservoirLength: 0.26,
      requestedActive: false,
      active: false,
      activationAuthority: 'inactive_padding',
    }));
  }
  return Object.freeze({
    schema: 'kaminos.finger-fluid.live-inlet-packet.v0',
    contract: KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
    packetId: source.packet_id || source.packetId || 'no-live-inlet-packet',
    sourceRoute: source.route_identity || source.source_route || 'unknown',
    artifactSha256: source.artifact_sha256 || source.artifactSha256 || null,
    sourceAuthority,
    requestedActiveInletCount: emitters.filter(inlet => inlet.requestedActive).length,
    activeInletCount: emitters.filter(inlet => inlet.active).length,
    inlets: Object.freeze(emitters),
  });
}

function readOptionalLiveInletNumber(emitter, keys, label, {
  minimum = 0,
  integer = false,
  minimumInclusive = true,
} = {}) {
  const key = keys.find(candidate => Object.hasOwn(emitter, candidate) && emitter[candidate] !== null);
  if (!key) return { provided: false, value: null };
  const value = Number(emitter[key]);
  const belowMinimum = minimumInclusive ? value < minimum : value <= minimum;
  if (!Number.isFinite(value) || belowMinimum || (integer && !Number.isSafeInteger(value))) {
    const expectation = integer ? `a safe integer >= ${minimum}` : `finite and ${minimumInclusive ? '>=' : '>'} ${minimum}`;
    throw new RangeError(`Finger fluid live-inlet ${label} must be ${expectation}: ${emitter[key]}`);
  }
  return { provided: true, value };
}

function requireFiniteF32(value, label) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_FINITE_F32) {
    throw new RangeError(`Finger fluid live-inlet ${label} must fit finite f32: ${value}`);
  }
  return value;
}

export function measureFingerFluidLiveInletSchedulerCapacity({
  radius,
  maximumSpeed,
  releasePoolBudget,
  residenceSeconds,
  residenceDistanceWorld,
}) {
  const budget = Number(releasePoolBudget);
  const safeRadius = Number(radius);
  const safeMaximumSpeed = Number(maximumSpeed);
  const safeResidenceSeconds = Number(residenceSeconds);
  const safeResidenceDistanceWorld = Number(residenceDistanceWorld);
  if (!Number.isSafeInteger(budget) || budget < 0) {
    throw new RangeError(`Finger fluid live-inlet scheduler budget must be a non-negative safe integer: ${releasePoolBudget}`);
  }
  if (![safeRadius, safeMaximumSpeed, safeResidenceSeconds, safeResidenceDistanceWorld].every(Number.isFinite)) {
    throw new RangeError('Finger fluid live-inlet scheduler capacity requires finite physical inputs');
  }
  if (safeRadius <= 0 || safeMaximumSpeed <= 0 || safeResidenceSeconds <= 0 || safeResidenceDistanceWorld <= 0) {
    throw new RangeError('Finger fluid live-inlet scheduler capacity requires positive physical inputs');
  }
  if (budget === 0) {
    return Object.freeze({
      laneCount: 0,
      nominalResidenceCycleSeconds: safeResidenceSeconds,
      dispatchCeilingParticleReleaseRate: 0,
      laneDispatchCeilingParticleReleaseRate: 0,
      aggregateResidenceCeilingParticleReleaseRate: 0,
      laneResidenceCeilingParticleReleaseRate: 0,
      residenceCeilingParticleReleaseRate: 0,
      schedulerCeilingParticleReleaseRate: 0,
    });
  }
  const apertureArea = Math.PI * safeRadius * safeRadius;
  const laneCount = Math.min(
    budget,
    Math.max(1, Math.round(apertureArea / (LAMINAR_SOURCE_AXIAL_SPACING ** 2))),
  );
  const laneWeights = Array.from({ length: laneCount }, (_, laneIndex) => {
    const radial = safeRadius * 0.82 * Math.sqrt((laneIndex + 0.5) / laneCount);
    const normalizedRadius = radial / safeRadius;
    return Math.max(0, 1 - normalizedRadius * normalizedRadius);
  });
  const laneWeightSum = laneWeights.reduce((sum, weight) => sum + weight, 0);
  const distanceResidenceSeconds = safeResidenceDistanceWorld / safeMaximumSpeed;
  const nominalResidenceCycleSeconds = Math.max(
    1 / LAMINAR_SOURCE_REFERENCE_FPS,
    Math.min(safeResidenceSeconds, distanceResidenceSeconds),
  );
  let laneDispatchCeilingParticleReleaseRate = Infinity;
  let laneResidenceCeilingParticleReleaseRate = Infinity;
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
    const laneParticleCount = Math.floor((budget - 1 - laneIndex) / laneCount) + 1;
    const laneWeight = laneWeights[laneIndex];
    if (laneWeight <= 0) continue;
    laneDispatchCeilingParticleReleaseRate = Math.min(
      laneDispatchCeilingParticleReleaseRate,
      laneParticleCount * LAMINAR_SOURCE_REFERENCE_FPS * laneWeightSum / laneWeight,
    );
    laneResidenceCeilingParticleReleaseRate = Math.min(
      laneResidenceCeilingParticleReleaseRate,
      laneParticleCount / nominalResidenceCycleSeconds * laneWeightSum / laneWeight,
    );
  }
  const dispatchCeilingParticleReleaseRate = budget * LAMINAR_SOURCE_REFERENCE_FPS;
  const aggregateResidenceCeilingParticleReleaseRate = budget / nominalResidenceCycleSeconds;
  const residenceCeilingParticleReleaseRate = laneResidenceCeilingParticleReleaseRate;
  return Object.freeze({
    laneCount,
    nominalResidenceCycleSeconds,
    dispatchCeilingParticleReleaseRate,
    laneDispatchCeilingParticleReleaseRate,
    aggregateResidenceCeilingParticleReleaseRate,
    laneResidenceCeilingParticleReleaseRate,
    residenceCeilingParticleReleaseRate,
    schedulerCeilingParticleReleaseRate: Math.min(
      dispatchCeilingParticleReleaseRate,
      laneDispatchCeilingParticleReleaseRate,
      residenceCeilingParticleReleaseRate,
    ),
  });
}

export function planFingerFluidLiveInletEconomics(
  packet,
  poolCapacity = KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT,
) {
  const capacity = Number(poolCapacity);
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError(`Finger fluid live-inlet pool capacity must be a positive safe integer: ${poolCapacity}`);
  }
  const normalized = normalizeFingerFluidLiveInletPacket(packet);
  const sourceEmitters = Array.isArray(packet?.emitters) ? packet.emitters : [];
  const requested = normalized.inlets.map((inlet, index) => {
    const emitter = sourceEmitters[index] && typeof sourceEmitters[index] === 'object'
      ? sourceEmitters[index]
      : {};
    return {
      active: inlet.requestedActive,
      particleReleaseRate: readOptionalLiveInletNumber(
        emitter,
        ['source_flux_particles_per_second', 'sourceFluxParticlesPerSecond'],
        `${inlet.id} source release`,
      ),
      releasePoolBudget: readOptionalLiveInletNumber(
        emitter,
        ['active_budget_particles', 'activeBudgetParticles', 'release_pool_budget_particles', 'releasePoolBudgetParticles'],
        `${inlet.id} release-pool budget`,
        { integer: true },
      ),
      residenceSeconds: readOptionalLiveInletNumber(
        emitter,
        ['lifetime_seconds', 'lifetimeSeconds', 'residence_seconds', 'residenceSeconds'],
        `${inlet.id} residence seconds`,
        { minimum: 0, minimumInclusive: false },
      ),
      residenceDistanceWorld: readOptionalLiveInletNumber(
        emitter,
        ['residence_distance_world', 'residenceDistanceWorld'],
        `${inlet.id} residence distance`,
        { minimum: 0, minimumInclusive: false },
      ),
      opticalDensityScale: readOptionalLiveInletNumber(
        emitter,
        ['optical_density_scale', 'opticalDensityScale'],
        `${inlet.id} optical density scale`,
        { minimum: 0, minimumInclusive: false },
      ),
      reconstructionRadiusScale: readOptionalLiveInletNumber(
        emitter,
        ['reconstruction_radius_scale', 'reconstructionRadiusScale'],
        `${inlet.id} reconstruction radius scale`,
        { minimum: 0, minimumInclusive: false },
      ),
    };
  });
  const requestedExplicitBudget = requested.reduce((sum, values) => (
    sum + (values.active && values.releasePoolBudget.provided
      ? values.releasePoolBudget.value
      : 0)
  ), 0);
  if (requestedExplicitBudget > capacity) {
    throw new RangeError(`Finger fluid live-inlet release-pool budget ${requestedExplicitBudget} exceeds runtime capacity ${capacity}`);
  }
  const effectiveExplicitBudget = requested.reduce((sum, values, index) => (
    sum + (normalized.inlets[index].active && values.releasePoolBudget.provided
      ? values.releasePoolBudget.value
      : 0)
  ), 0);
  const unspecifiedActiveIndices = normalized.inlets
    .map((inlet, index) => ({ inlet, index }))
    .filter(({ inlet, index }) => inlet.active && !requested[index].releasePoolBudget.provided)
    .map(({ index }) => index);
  const remainingBudget = capacity - effectiveExplicitBudget;
  const sharedBudget = unspecifiedActiveIndices.length
    ? Math.floor(remainingBudget / unspecifiedActiveIndices.length)
    : 0;
  let sharedBudgetRemainder = unspecifiedActiveIndices.length
    ? remainingBudget % unspecifiedActiveIndices.length
    : 0;
  const inlets = normalized.inlets.map((inlet, index) => {
    const values = requested[index];
    let releasePoolBudget = 0;
    if (inlet.active && values.releasePoolBudget.provided) {
      releasePoolBudget = values.releasePoolBudget.value;
    } else if (inlet.active) {
      releasePoolBudget = sharedBudget + (sharedBudgetRemainder > 0 ? 1 : 0);
      sharedBudgetRemainder = Math.max(0, sharedBudgetRemainder - 1);
    }
    const geometryDerivedParticleReleaseRate = inlet.requestedActive
      ? Math.PI * inlet.radius * inlet.radius * inlet.maximumSpeed * 0.5 / LAMINAR_SOURCE_PARTICLE_VOLUME
      : 0;
    const requestedParticleReleaseRate = inlet.requestedActive
      ? (values.particleReleaseRate.provided
        ? values.particleReleaseRate.value
        : geometryDerivedParticleReleaseRate)
      : 0;
    const residenceSeconds = requireFiniteF32(values.residenceSeconds.provided
      ? values.residenceSeconds.value
      : LIVE_HAND_DEFAULT_RESIDENCE_SECONDS, `${inlet.id} residence seconds`);
    const residenceDistanceWorld = requireFiniteF32(values.residenceDistanceWorld.provided
      ? values.residenceDistanceWorld.value
      : values.residenceSeconds.provided
        ? MAX_FINITE_F32
        : LIVE_HAND_DEFAULT_RESIDENCE_DISTANCE_WORLD, `${inlet.id} residence distance`);
    const schedulerCapacity = inlet.active && releasePoolBudget > 0
      ? measureFingerFluidLiveInletSchedulerCapacity({
        radius: inlet.radius,
        maximumSpeed: inlet.maximumSpeed,
        releasePoolBudget,
        residenceSeconds,
        residenceDistanceWorld,
      })
      : {
        laneCount: 0,
        nominalResidenceCycleSeconds: residenceSeconds,
        dispatchCeilingParticleReleaseRate: 0,
        laneDispatchCeilingParticleReleaseRate: 0,
        aggregateResidenceCeilingParticleReleaseRate: 0,
        laneResidenceCeilingParticleReleaseRate: 0,
        residenceCeilingParticleReleaseRate: 0,
        schedulerCeilingParticleReleaseRate: 0,
      };
    const particleReleaseRate = inlet.active
      ? Math.min(
        requestedParticleReleaseRate,
        schedulerCapacity.schedulerCeilingParticleReleaseRate,
      )
      : 0;
    const releaseSaturated = inlet.active && particleReleaseRate < requestedParticleReleaseRate;
    requireFiniteF32(particleReleaseRate, `${inlet.id} source release`);
    const deniedAuthority = inlet.requestedActive && !inlet.active
      ? inlet.activationAuthority
      : null;
    return Object.freeze({
      ...inlet,
      requested: Object.freeze({
        active: values.active,
        particleReleaseRate: values.particleReleaseRate.value,
        releasePoolBudget: values.releasePoolBudget.value,
        residenceSeconds: values.residenceSeconds.value,
        residenceDistanceWorld: values.residenceDistanceWorld.value,
      }),
      effective: Object.freeze({
        particleReleaseRate,
        geometryDerivedParticleReleaseRate,
        ...schedulerCapacity,
        releaseSaturated,
        releaseAuthority: deniedAuthority
          ? deniedAuthority
          : !inlet.active
          ? 'inactive_zero_release'
          : releasePoolBudget <= 0
            ? 'zero_budget_zero_release'
          : values.particleReleaseRate.provided
            ? releaseSaturated
              ? 'explicit_particle_rate_scheduler_limited'
              : 'explicit_particle_rate'
            : releaseSaturated
              ? 'derived_from_aperture_and_speed_scheduler_limited'
              : 'derived_from_aperture_and_speed',
        releasePoolBudget,
        releasePoolAuthority: deniedAuthority
          ? deniedAuthority
          : values.releasePoolBudget.provided
          ? 'explicit_particle_budget'
          : inlet.active
            ? 'equal_share_remaining_pool'
            : 'inactive_zero_budget',
        residenceSeconds,
        residenceDistanceWorld,
        residenceAuthority: values.residenceSeconds.provided
          ? 'explicit_lifetime'
          : 'legacy_default',
        residenceDistanceAuthority: values.residenceDistanceWorld.provided
          ? 'explicit_distance'
          : values.residenceSeconds.provided
            ? 'unbounded_for_explicit_lifetime'
            : 'legacy_default',
      }),
      opticalDensity: Object.freeze({
        requested: values.opticalDensityScale.value,
        effective: null,
        authority: 'consumer_owned_not_applied',
        appliedToPhysicalInlet: false,
      }),
      reconstructionRadius: Object.freeze({
        requested: values.reconstructionRadiusScale.value,
        effective: null,
        authority: 'consumer_owned_not_applied',
        appliedToPhysicalInlet: false,
      }),
    });
  });
  const effectiveReleasePoolBudget = inlets.reduce(
    (sum, inlet) => sum + inlet.effective.releasePoolBudget,
    0,
  );
  const requestedActiveInletCount = normalized.requestedActiveInletCount;
  const effectiveReservedInletCount = inlets.filter(
    inlet => inlet.active && inlet.effective.releasePoolBudget > 0,
  ).length;
  const effectiveActiveInletCount = inlets.filter(
    inlet => inlet.active
      && inlet.effective.releasePoolBudget > 0
      && inlet.effective.particleReleaseRate > 0,
  ).length;
  return Object.freeze({
    schema: 'kaminos.finger-fluid.live-inlet-economics.v1',
    contract: KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
    packetId: normalized.packetId,
    sourceRoute: normalized.sourceRoute,
    artifactSha256: normalized.artifactSha256,
    sourceAuthority: normalized.sourceAuthority,
    poolCapacity: capacity,
    requestedActiveInletCount,
    effectiveReservedInletCount,
    effectiveActiveInletCount,
    requestedReleasePoolBudget: requestedExplicitBudget,
    effectiveReleasePoolBudget,
    unallocatedDormantParticleCount: capacity - effectiveReleasePoolBudget,
    inlets: Object.freeze(inlets),
  });
}

export function measureFingerFluidLiveInletReleasePlan(
  packet,
  poolCapacity = KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT,
) {
  const normalized = normalizeFingerFluidLiveInletPacket(packet);
  const economics = planFingerFluidLiveInletEconomics(packet, poolCapacity);
  const inlets = economics.inlets.map(inlet => {
    const expectedParticleReleaseRate = inlet.effective.particleReleaseRate;
    const physicalSourceFlux = expectedParticleReleaseRate * LAMINAR_SOURCE_PARTICLE_VOLUME;
    return Object.freeze({
      id: inlet.id,
      active: inlet.active,
      physicalSourceFlux,
      expectedParticleReleaseRate,
      expectedParticlesPerReferenceFrame: expectedParticleReleaseRate / LAMINAR_SOURCE_REFERENCE_FPS,
      requested: inlet.requested,
      effective: inlet.effective,
      opticalDensity: inlet.opticalDensity,
      reconstructionRadius: inlet.reconstructionRadius,
    });
  });
  return Object.freeze({
    contract: KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT,
    economicsContract: KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
    packetId: normalized.packetId,
    sourceRoute: normalized.sourceRoute,
    artifactSha256: normalized.artifactSha256,
    sourceAuthority: normalized.sourceAuthority,
    particleVolume: LAMINAR_SOURCE_PARTICLE_VOLUME,
    referenceFps: LAMINAR_SOURCE_REFERENCE_FPS,
    activeInletCount: economics.effectiveActiveInletCount,
    requestedActiveInletCount: economics.requestedActiveInletCount,
    effectiveReservedInletCount: economics.effectiveReservedInletCount,
    effectiveActiveInletCount: economics.effectiveActiveInletCount,
    poolCapacity: economics.poolCapacity,
    effectiveReleasePoolBudget: economics.effectiveReleasePoolBudget,
    unallocatedDormantParticleCount: economics.unallocatedDormantParticleCount,
    expectedParticleReleaseRate: inlets.reduce((sum, inlet) => sum + inlet.expectedParticleReleaseRate, 0),
    expectedParticlesPerReferenceFrame: inlets.reduce((sum, inlet) => sum + inlet.expectedParticlesPerReferenceFrame, 0),
    inlets: Object.freeze(inlets),
  });
}

function comparableFingerFluidLiveInletEconomics(economics) {
  return {
    contract: economics?.contract ?? null,
    packetId: economics?.packetId ?? null,
    sourceRoute: economics?.sourceRoute ?? null,
    artifactSha256: economics?.artifactSha256 ?? null,
    sourceAuthority: economics?.sourceAuthority ?? null,
    poolCapacity: economics?.poolCapacity ?? null,
    requestedActiveInletCount: economics?.requestedActiveInletCount ?? null,
    effectiveReservedInletCount: economics?.effectiveReservedInletCount ?? null,
    effectiveActiveInletCount: economics?.effectiveActiveInletCount ?? null,
    requestedReleasePoolBudget: economics?.requestedReleasePoolBudget ?? null,
    effectiveReleasePoolBudget: economics?.effectiveReleasePoolBudget ?? null,
    unallocatedDormantParticleCount: economics?.unallocatedDormantParticleCount ?? null,
    inlets: Array.isArray(economics?.inlets) ? economics.inlets.map(inlet => ({
      id: inlet.id,
      origin: Array.from(inlet.origin || []),
      axis: Array.from(inlet.axis || []),
      radius: inlet.radius,
      maximumSpeed: inlet.maximumSpeed,
      requestedActive: inlet.requestedActive,
      active: inlet.active,
      activationAuthority: inlet.activationAuthority,
      requested: inlet.requested,
      effective: inlet.effective,
      opticalDensity: inlet.opticalDensity,
      reconstructionRadius: inlet.reconstructionRadius,
    })) : [],
  };
}

export function validateFingerFluidLiveInletDiagnosticsEpoch(
  requestedGeneration,
  completedGeneration,
) {
  if (requestedGeneration !== completedGeneration) {
    throw new Error(
      `Finger fluid live-inlet packet generation changed during diagnostics readback: ${requestedGeneration} !== ${completedGeneration}`,
    );
  }
  return requestedGeneration;
}

export function measureFingerFluidLiveInletReleaseRealizability({
  expectedParticleReleaseRate,
  elapsedSteps,
  predecessorBlockedReleaseCount,
  observedParticleReleaseCount,
} = {}) {
  const releaseRate = Number(expectedParticleReleaseRate);
  const steps = Number(elapsedSteps);
  const blocked = Number(predecessorBlockedReleaseCount);
  const observed = Number(observedParticleReleaseCount);
  if (!Number.isFinite(releaseRate) || releaseRate < 0) {
    throw new TypeError(`Finger fluid live-inlet realizability requires a nonnegative release rate: ${expectedParticleReleaseRate}`);
  }
  for (const [label, value] of [
    ['elapsed steps', steps],
    ['predecessor-blocked release count', blocked],
    ['observed particle release count', observed],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`Finger fluid live-inlet realizability requires nonnegative integer ${label}: ${value}`);
    }
  }
  const nominalExpectedParticleReleaseCount = releaseRate
    * steps
    / LAMINAR_SOURCE_REFERENCE_FPS;
  const realizableExpectedParticleReleaseCount = Math.max(
    0,
    nominalExpectedParticleReleaseCount - blocked,
  );
  return Object.freeze({
    nominalExpectedParticleReleaseCount: Number(nominalExpectedParticleReleaseCount.toFixed(6)),
    predecessorBlockedReleaseCount: blocked,
    realizableExpectedParticleReleaseCount: Number(realizableExpectedParticleReleaseCount.toFixed(6)),
    observedParticleReleaseCount: observed,
    observedRealizableReleaseRatio: realizableExpectedParticleReleaseCount > 0
      ? Number((observed / realizableExpectedParticleReleaseCount).toFixed(6))
      : null,
  });
}

export function validateFingerFluidLiveInletCohortLedger(publications, ledger) {
  if (ledger?.contract !== 'gpu-particle-residence-cohort-ledger-v1') {
    throw new Error(`Finger fluid live-inlet cohort ledger contract mismatch: ${ledger?.contract}`);
  }
  const publicationByGeneration = new Map();
  for (const publication of publications || []) {
    const generation = Number(publication?.generation);
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      throw new Error(`Finger fluid live-inlet publication has invalid generation: ${publication?.generation}`);
    }
    if (publicationByGeneration.has(generation)) {
      throw new Error(`Finger fluid live-inlet publication generation is duplicated: ${generation}`);
    }
    publicationByGeneration.set(generation, publication);
  }
  for (const cohort of ledger.generations || []) {
    const publication = publicationByGeneration.get(cohort.generation);
    if (!publication) {
      throw new Error(`Finger fluid live-inlet cohort has unknown publication generation: ${cohort.generation}`);
    }
    if (
      cohort.packetId !== publication.packetId
      || cohort.sourceRoute !== publication.sourceRoute
      || (cohort.artifactSha256 ?? null) !== (publication.artifactSha256 ?? null)
    ) {
      throw new Error(`Finger fluid live-inlet cohort publication identity mismatch: ${JSON.stringify({
        cohort,
        publication: {
          generation: publication.generation,
          packetId: publication.packetId,
          sourceRoute: publication.sourceRoute,
          artifactSha256: publication.artifactSha256 ?? null,
        },
      })}`);
    }
    if ((cohort.authorityMismatchCount || 0) > 0) {
      throw new Error(`Finger fluid live-inlet cohort authority mismatch: ${JSON.stringify(cohort)}`);
    }
    if ((cohort.unknownSourceCount || 0) > 0) {
      throw new Error(`Finger fluid live-inlet cohort has unknown source attribution: ${JSON.stringify(cohort)}`);
    }
  }
  return ledger;
}

export function validateFingerFluidLiveInletCohortTrajectory({
  publications = [],
  economics = [],
  replacementRequired = false,
} = {}) {
  if (!Array.isArray(publications) || publications.length < 1) {
    throw new Error('Finger fluid live-inlet cohort trajectory has no packet publications');
  }
  for (let index = 0; index < publications.length; index += 1) {
    const generation = Number(publications[index]?.generation);
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      throw new Error(`Finger fluid live-inlet publication has invalid generation: ${publications[index]?.generation}`);
    }
    if (index > 0 && generation !== publications[index - 1].generation + 1) {
      throw new Error(`Finger fluid live-inlet replacement generation was not monotonic: ${JSON.stringify(publications)}`);
    }
  }
  if (replacementRequired && publications.length < 2) {
    throw new Error(`Finger fluid live-inlet replacement witness has fewer than two publications: ${JSON.stringify(publications)}`);
  }

  const currentPublication = publications[publications.length - 1];
  const currentEconomics = (economics || []).filter(
    entry => entry?.generation === currentPublication.generation,
  );
  if (currentEconomics.length < 1) {
    throw new Error(`Finger fluid live-inlet trajectory has no diagnostics for current generation ${currentPublication.generation}`);
  }
  const currentAgeRecycleCount = Math.max(
    0,
    ...currentEconomics.map(entry => Number(entry.liveInletAgeRecycleCount) || 0),
  );
  const currentDistanceRecycleCount = Math.max(
    0,
    ...currentEconomics.map(entry => Number(entry.liveInletDistanceRecycleCount) || 0),
  );
  if (currentAgeRecycleCount < 1 || currentDistanceRecycleCount < 1) {
    throw new Error(`Finger fluid live-inlet current generation did not exercise both recycle reasons: ${JSON.stringify({
      currentPublication,
      currentEconomics,
    })}`);
  }

  const priorGenerationAgeRecycleCount = Math.max(
    0,
    ...currentEconomics.map(entry => Number(entry.priorGenerationAgeRecycleCount) || 0),
  );
  const priorGenerationDistanceRecycleCount = Math.max(
    0,
    ...currentEconomics.map(entry => Number(entry.priorGenerationDistanceRecycleCount) || 0),
  );
  const predecessors = publications.slice(0, -1);
  const predecessorCohorts = predecessors.map(predecessor => {
    const matchingCohorts = [];
    for (const entry of currentEconomics) {
      if (!entry.cohortLedger) continue;
      validateFingerFluidLiveInletCohortLedger(publications, entry.cohortLedger);
      const cohort = entry.cohortLedger.generations?.find(
        candidate => candidate.generation === predecessor.generation,
      );
      if (cohort) matchingCohorts.push(cohort);
    }
    const ageRecycledDormantParticleCount = Math.max(
      0,
      ...matchingCohorts.map(cohort => Number(cohort.ageRecycledDormantParticleCount) || 0),
    );
    const distanceRecycledDormantParticleCount = Math.max(
      0,
      ...matchingCohorts.map(cohort => Number(cohort.distanceRecycledDormantParticleCount) || 0),
    );
    if (
      matchingCohorts.length < 1
      || ageRecycledDormantParticleCount < 1
      || distanceRecycledDormantParticleCount < 1
    ) {
      throw new Error(`Finger fluid live-inlet predecessor generation did not retire under preserved cohort authority: ${JSON.stringify({
        predecessor,
        matchingCohorts,
      })}`);
    }
    return Object.freeze({
      generation: predecessor.generation,
      packetId: predecessor.packetId,
      ageRecycledDormantParticleCount,
      distanceRecycledDormantParticleCount,
    });
  });
  if (
    predecessors.length > 0
    && (priorGenerationAgeRecycleCount < 1 || priorGenerationDistanceRecycleCount < 1)
  ) {
    throw new Error(`Finger fluid live-inlet predecessor recycle counters are incomplete: ${JSON.stringify({
      priorGenerationAgeRecycleCount,
      priorGenerationDistanceRecycleCount,
    })}`);
  }

  return Object.freeze({
    contract: 'gpu-particle-residence-cohort-witness-v1',
    publicationCount: publications.length,
    currentPacketId: currentPublication.packetId,
    currentGeneration: currentPublication.generation,
    predecessorPacketId: predecessors.length === 1 ? predecessors[0].packetId : null,
    predecessorGeneration: predecessors.length === 1 ? predecessors[0].generation : null,
    successorPacketId: predecessors.length === 1 ? currentPublication.packetId : null,
    successorGeneration: predecessors.length === 1 ? currentPublication.generation : null,
    predecessorGenerations: Object.freeze(predecessors.map(publication => publication.generation)),
    currentAgeRecycleCount,
    currentDistanceRecycleCount,
    priorGenerationAgeRecycleCount,
    priorGenerationDistanceRecycleCount,
    predecessorCohorts: Object.freeze(predecessorCohorts),
    predecessorAgeRecycledDormantParticleCount: predecessors.length === 1
      ? predecessorCohorts[0].ageRecycledDormantParticleCount
      : 0,
    predecessorDistanceRecycledDormantParticleCount: predecessors.length === 1
      ? predecessorCohorts[0].distanceRecycledDormantParticleCount
      : 0,
  });
}

export function createFingerFluidLiveInletPublicationState(
  packet,
  economics,
  releasePlan,
) {
  if (packet === null || packet === undefined) {
    return { generation: 0, releaseEpochFrame: 0, publications: [] };
  }
  if (!economics || !releasePlan) {
    throw new TypeError('Finger fluid initial live-inlet publication requires economics and release plan');
  }
  const generation = 1;
  return {
    generation,
    releaseEpochFrame: 0,
    publications: [Object.freeze({
      generation,
      packetId: economics.packetId,
      sourceRoute: economics.sourceRoute,
      artifactSha256: economics.artifactSha256,
      expectedEconomics: economics,
      releasePlan,
    })],
  };
}

function measureFingerFluidLiveInletCohortLedger(
  particleValues,
  materialTracerValues,
  particleCount,
  publications,
) {
  const publicationByGeneration = new Map(
    publications.map(publication => [publication.generation, publication]),
  );
  const cohorts = new Map();
  const cohortForGeneration = generation => {
    if (!cohorts.has(generation)) {
      const publication = publicationByGeneration.get(generation);
      cohorts.set(generation, {
        generation,
        packetId: publication?.packetId ?? null,
        sourceRoute: publication?.sourceRoute ?? null,
        artifactSha256: publication?.artifactSha256 ?? null,
        activeParticleCount: 0,
        ageRecycledDormantParticleCount: 0,
        distanceRecycledDormantParticleCount: 0,
        authorityMismatchCount: 0,
        unknownSourceCount: 0,
      });
    }
    return cohorts.get(generation);
  };
  const approximatelyEqual = (left, right) => (
    Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= 1e-4 * Math.max(1, Math.abs(right))
  );
  for (let index = 0; index < particleCount; index += 1) {
    const particleOffset = index * PARTICLE_FLOATS;
    const tracerOffset = index * MATERIAL_TRACER_FLOATS;
    const marker = Math.round(materialTracerValues[tracerOffset + 11]);
    const generation = Math.round(materialTracerValues[tracerOffset + 7]);
    if (marker < 1 || marker > 3 || generation <= 0) continue;
    const cohort = cohortForGeneration(generation);
    const publication = publicationByGeneration.get(generation);
    const sourceIndex = Math.round(materialTracerValues[tracerOffset + 10]);
    const expectedInlet = publication?.expectedEconomics?.inlets?.[sourceIndex];
    if (!expectedInlet) {
      cohort.unknownSourceCount += 1;
      continue;
    }
    const originMatches = [0, 1, 2].every(axis => approximatelyEqual(
      materialTracerValues[tracerOffset + 4 + axis],
      expectedInlet.origin[axis],
    ));
    const residenceMatches = approximatelyEqual(
      materialTracerValues[tracerOffset + 8],
      expectedInlet.effective.residenceSeconds,
    ) && approximatelyEqual(
      materialTracerValues[tracerOffset + 9],
      expectedInlet.effective.residenceDistanceWorld,
    );
    const particleActive = particleValues[particleOffset + 11] >= 0;
    if (!originMatches || !residenceMatches || (marker === 1) !== particleActive) {
      cohort.authorityMismatchCount += 1;
    }
    if (marker === 1) cohort.activeParticleCount += 1;
    if (marker === 2) cohort.ageRecycledDormantParticleCount += 1;
    if (marker === 3) cohort.distanceRecycledDormantParticleCount += 1;
  }
  return Object.freeze({
    contract: 'gpu-particle-residence-cohort-ledger-v1',
    generations: Object.freeze(
      [...cohorts.values()]
        .sort((left, right) => left.generation - right.generation)
        .map(cohort => Object.freeze(cohort)),
    ),
  });
}

export function validateFingerFluidLiveInletRuntimeReceipt(
  expectedEconomics,
  receipt,
  { artifactSha256 = null } = {},
) {
  if (receipt?.schema !== 'kaminos.finger-fluid.live-inlet-publication-receipt.v0') {
    throw new Error(`Finger fluid live-inlet publication receipt schema mismatch: ${receipt?.schema}`);
  }
  if (receipt.economicsContract !== expectedEconomics?.contract) {
    throw new Error(
      `Finger fluid live-inlet economics contract mismatch: ${receipt.economicsContract} !== ${expectedEconomics?.contract}`,
    );
  }
  if (receipt.packetId !== expectedEconomics?.packetId || receipt.sourceRoute !== expectedEconomics?.sourceRoute) {
    throw new Error('Finger fluid live-inlet packet route identity differs from requested economics');
  }
  if (artifactSha256 !== null && receipt.artifactSha256 !== artifactSha256) {
    throw new Error(
      `Finger fluid live-inlet packet artifact digest differs: ${receipt.artifactSha256} !== ${artifactSha256}`,
    );
  }
  const expected = comparableFingerFluidLiveInletEconomics(expectedEconomics);
  const effective = comparableFingerFluidLiveInletEconomics(receipt.runtimeEconomics);
  if (JSON.stringify(effective) !== JSON.stringify(expected)) {
    throw new Error(`Finger fluid live-inlet runtime economics differs from requested economics: ${JSON.stringify({
      expected,
      effective,
    })}`);
  }
  return Object.freeze({
    packetId: receipt.packetId,
    sourceRoute: receipt.sourceRoute,
    artifactSha256: receipt.artifactSha256 ?? null,
    economicsContract: receipt.economicsContract,
  });
}

function packFingerFluidLiveInletPacket(
  packet,
  poolCapacity = KAMINOS_FINGER_FLUID_DEFAULT_PARTICLE_COUNT,
) {
  const normalized = normalizeFingerFluidLiveInletPacket(packet);
  const economics = planFingerFluidLiveInletEconomics(packet, poolCapacity);
  const data = new Float32Array(LIVE_HAND_INLET_CAPACITY * LIVE_HAND_INLET_FLOATS);
  economics.inlets.forEach((inlet, index) => {
    const offset = index * LIVE_HAND_INLET_FLOATS;
    data.set([...inlet.origin, inlet.radius], offset);
    data.set([...inlet.axis, inlet.maximumSpeed], offset + 4);
    data.set([...inlet.tangent, inlet.active ? 1 : 0], offset + 8);
    data.set([
      inlet.effective.particleReleaseRate,
      inlet.effective.releasePoolBudget,
      inlet.effective.residenceSeconds,
      inlet.effective.residenceDistanceWorld,
    ], offset + 12);
  });
  return { normalized, economics, data };
}

export function resolveFingerFluidWaterfallOraclePreset(value = 'baseline') {
  const preset = String(value || 'baseline');
  if (!KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_PRESETS.includes(preset)) {
    throw new RangeError(`Unsupported finger fluid waterfall oracle preset: ${preset}`);
  }
  return preset;
}

export function resolveFingerFluidWaterfallWitnessPresetArgument({
  argumentPresent = false,
  value,
  fallback = 'high',
  argumentName = '--waterfall-oracle-preset',
} = {}) {
  if (!argumentPresent) return resolveFingerFluidWaterfallOraclePreset(fallback);
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
    throw new RangeError(`${argumentName} requires a value`);
  }
  return resolveFingerFluidWaterfallOraclePreset(value);
}

export function createFingerFluidWaterfallOracleConfig(value = 'baseline') {
  const preset = resolveFingerFluidWaterfallOraclePreset(value);
  const resolution = KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_RESOLUTIONS[preset];
  const refinementFactor = Math.cbrt(resolution.volumeMultiplier);
  const particleSpacing = LAMINAR_SOURCE_AXIAL_SPACING / refinementFactor;
  const descriptor = createFingerFluidLaminarInletDescriptors()[1];
  const physicalSourceFlux = measureFingerFluidLaminarInletFlux(descriptor);
  const particleVolume = particleSpacing ** 3;
  const laneColumns = resolution.laneColumns;
  const laneRows = resolution.laneRows;
  return Object.freeze({
    contract: KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
    preset,
    sourceId: descriptor.id,
    sourceIndex: 1,
    refinementFactor,
    particleSpacing,
    particleVolume,
    kernelRadius: 0.185 / refinementFactor,
    visibleParticleRadius: 0.046 / refinementFactor,
    defaultParticleCount: resolution.particleCount,
    laneColumns,
    laneRows,
    laneCount: laneColumns * laneRows,
    releaseScheduleContract: KAMINOS_FINGER_FLUID_SOURCE_RELEASE_SCHEDULE_CONTRACT,
    physicalSourceFlux,
    expectedParticleReleaseRate: physicalSourceFlux / particleVolume,
    camera: Object.freeze({
      yaw: -0.46,
      pitch: 0.30,
      distance: 3.05,
      target: Object.freeze([0, -0.35, -0.92]),
    }),
  });
}

function requireFingerFluidOracleArtifact(artifact, label) {
  if (!artifact
    || typeof artifact.path !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))
    || !Number.isSafeInteger(artifact.width)
    || artifact.width <= 0
    || !Number.isSafeInteger(artifact.height)
    || artifact.height <= 0) {
    throw new Error(`${label} artifact missing or partial`);
  }
  return { ...artifact };
}

export function createFingerFluidWaterfallOracleEvidenceIdentity(values = {}) {
  const requestedPreset = resolveFingerFluidWaterfallOraclePreset(values.requestedPreset);
  const effectivePreset = resolveFingerFluidWaterfallOraclePreset(values.effectivePreset);
  const config = createFingerFluidWaterfallOracleConfig(effectivePreset);
  const identity = {
    schema: KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA,
    contract: KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
    truthScene: values.truthScene,
    requestedPreset,
    effectivePreset,
    sourceId: values.sourceId,
    refinementFactor: Number(values.refinementFactor),
    particleSpacing: Number(values.particleSpacing),
    particleVolume: Number(values.particleVolume),
    kernelRadius: Number(values.kernelRadius),
    visibleParticleRadius: Number(values.visibleParticleRadius),
    particleCount: Number(values.particleCount),
    laneColumns: Number(values.laneColumns),
    laneRows: Number(values.laneRows),
    laneCount: Number(values.laneCount),
    releaseScheduleContract: config.releaseScheduleContract,
    physicalSourceFlux: Number(values.physicalSourceFlux),
    expectedParticleReleaseRate: Number(values.expectedParticleReleaseRate),
    rendererMode: values.rendererMode,
    colorMode: values.colorMode,
    opticalDebugMode: values.opticalDebugMode,
    fixedTimeStepSeconds: Number(values.fixedTimeStepSeconds),
    capturedStep: Number(values.capturedStep),
    densityIterations: Number(values.densityIterations),
    capillaryStrength: Number(values.capillaryStrength),
    supportFriction: Number(values.supportFriction),
    freeFlightViscosityBoost: Number(values.freeFlightViscosityBoost),
    thinSheetVorticityAttenuation: Number(values.thinSheetVorticityAttenuation),
    unsupportedSheetStrength: Number(values.unsupportedSheetStrength),
    maxFluidSpeed: resolveFingerFluidMaxSpeed(values.maxFluidSpeed),
    speedReferenceScale: KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE,
    inletCutoffStep: resolveFingerFluidInletCutoffStep(values.inletCutoffStep ?? null),
    camera: values.camera ? JSON.parse(JSON.stringify(values.camera)) : null,
  };
  const numericKeys = [
    'refinementFactor', 'particleSpacing', 'particleVolume', 'kernelRadius', 'visibleParticleRadius',
    'particleCount', 'laneColumns', 'laneRows', 'laneCount', 'physicalSourceFlux',
    'expectedParticleReleaseRate', 'fixedTimeStepSeconds', 'capturedStep', 'densityIterations',
    'capillaryStrength', 'supportFriction', 'freeFlightViscosityBoost', 'thinSheetVorticityAttenuation',
    'unsupportedSheetStrength', 'maxFluidSpeed', 'speedReferenceScale',
  ];
  if (identity.truthScene !== 'waterfall_resolution_oracle'
    || identity.sourceId !== config.sourceId
    || numericKeys.some(key => !Number.isFinite(identity[key]))) {
    throw new Error(`Waterfall oracle evidence identity missing or incoherent: ${JSON.stringify(identity)}`);
  }
  return identity;
}

export function evaluateFingerFluidWaterfallOraclePair({
  baselineIdentity,
  highIdentity,
  baselineArtifact,
  highArtifact,
} = {}) {
  if (baselineIdentity?.schema !== KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA
    || highIdentity?.schema !== KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA) {
    throw new Error('waterfall oracle evidence identity missing');
  }
  if (baselineIdentity.effectivePreset !== 'baseline' || highIdentity.effectivePreset !== 'high') {
    throw new Error('waterfall oracle pair does not contain baseline and high presets');
  }
  const exactCommonKeys = [
    'contract', 'truthScene', 'sourceId', 'releaseScheduleContract', 'rendererMode', 'colorMode', 'opticalDebugMode',
    'fixedTimeStepSeconds', 'capturedStep', 'densityIterations', 'capillaryStrength',
    'supportFriction', 'freeFlightViscosityBoost', 'thinSheetVorticityAttenuation', 'unsupportedSheetStrength',
    'maxFluidSpeed', 'speedReferenceScale', 'inletCutoffStep',
  ];
  for (const key of exactCommonKeys) {
    if (JSON.stringify(baselineIdentity[key]) !== JSON.stringify(highIdentity[key])) {
      throw new Error(`waterfall oracle common identity mismatch at ${key}`);
    }
  }
  if (JSON.stringify(baselineIdentity.camera) !== JSON.stringify(highIdentity.camera)) {
    throw new Error('waterfall oracle camera mismatch');
  }
  if (Math.abs(baselineIdentity.physicalSourceFlux - highIdentity.physicalSourceFlux) > 1e-9) {
    throw new Error('waterfall oracle physical source flux mismatch');
  }
  if (highIdentity.particleSpacing !== baselineIdentity.particleSpacing / 2) {
    throw new Error('waterfall oracle high-resolution spacing is not exactly half baseline');
  }
  if (highIdentity.kernelRadius !== baselineIdentity.kernelRadius / 2
    || highIdentity.visibleParticleRadius !== baselineIdentity.visibleParticleRadius / 2
    || highIdentity.particleVolume !== baselineIdentity.particleVolume / 8
    || highIdentity.particleCount !== baselineIdentity.particleCount * 8
    || highIdentity.laneCount !== baselineIdentity.laneCount * 4) {
    throw new Error('waterfall oracle high-resolution scale law mismatch');
  }
  return {
    schema: 'kaminos.finger-fluid.waterfall-resolution-oracle-pair.v0',
    contract: KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_CONTRACT,
    mechanicalChecksOk: true,
    status: 'captured_pending_operator_disposition',
    operatorDispositionRequired: true,
    visualContinuityAccepted: null,
    baselineIdentity,
    highIdentity,
    baselineArtifact: requireFingerFluidOracleArtifact(baselineArtifact, 'baseline'),
    highArtifact: requireFingerFluidOracleArtifact(highArtifact, 'high'),
  };
}

export function evaluateFingerFluidUnsupportedSheetOraclePair({
  controlIdentity,
  treatmentIdentity,
  controlArtifact,
  treatmentArtifact,
} = {}) {
  if (controlIdentity?.schema !== KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA
    || treatmentIdentity?.schema !== KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA) {
    throw new Error('unsupported-sheet oracle evidence identity missing');
  }
  if (controlIdentity.requestedPreset !== controlIdentity.effectivePreset
    || treatmentIdentity.requestedPreset !== treatmentIdentity.effectivePreset) {
    throw new Error('unsupported-sheet oracle preset silently fell back');
  }
  for (const identity of [controlIdentity, treatmentIdentity]) {
    const canonical = createFingerFluidWaterfallOracleConfig(identity.effectivePreset);
    const canonicalIdentity = {
      contract: canonical.contract,
      sourceId: canonical.sourceId,
      refinementFactor: canonical.refinementFactor,
      particleSpacing: canonical.particleSpacing,
      particleVolume: canonical.particleVolume,
      kernelRadius: canonical.kernelRadius,
      visibleParticleRadius: canonical.visibleParticleRadius,
      particleCount: canonical.defaultParticleCount,
      laneColumns: canonical.laneColumns,
      laneRows: canonical.laneRows,
      laneCount: canonical.laneCount,
      physicalSourceFlux: canonical.physicalSourceFlux,
      expectedParticleReleaseRate: canonical.expectedParticleReleaseRate,
      releaseScheduleContract: canonical.releaseScheduleContract,
      camera: canonical.camera,
    };
    for (const [key, expected] of Object.entries(canonicalIdentity)) {
      if (JSON.stringify(identity[key]) !== JSON.stringify(expected)) {
        throw new Error(`unsupported-sheet oracle canonical ${canonical.preset} identity mismatch at ${key}`);
      }
    }
  }
  const exactCommonKeys = [
    'contract', 'truthScene', 'requestedPreset', 'effectivePreset', 'sourceId', 'refinementFactor', 'particleSpacing', 'particleVolume',
    'kernelRadius', 'visibleParticleRadius', 'particleCount', 'laneColumns', 'laneRows', 'laneCount',
    'physicalSourceFlux', 'expectedParticleReleaseRate', 'releaseScheduleContract', 'rendererMode', 'colorMode', 'opticalDebugMode',
    'fixedTimeStepSeconds', 'capturedStep', 'densityIterations', 'capillaryStrength', 'supportFriction',
    'freeFlightViscosityBoost', 'thinSheetVorticityAttenuation', 'maxFluidSpeed', 'speedReferenceScale', 'camera',
    'inletCutoffStep',
  ];
  for (const key of exactCommonKeys) {
    if (JSON.stringify(controlIdentity[key]) !== JSON.stringify(treatmentIdentity[key])) {
      throw new Error(`unsupported-sheet oracle common identity mismatch at ${key}`);
    }
  }
  if (controlIdentity.unsupportedSheetStrength !== 0
    || !Number.isFinite(treatmentIdentity.unsupportedSheetStrength)
    || treatmentIdentity.unsupportedSheetStrength <= 0) {
    throw new Error('unsupported-sheet oracle requires zero-strength control and positive-strength treatment');
  }
  return {
    schema: 'kaminos.finger-fluid.unsupported-sheet-oracle-pair.v0',
    contract: KAMINOS_FINGER_FLUID_UNSUPPORTED_SHEET_CONTRACT,
    mechanicalChecksOk: true,
    status: 'captured_pending_operator_disposition',
    operatorDispositionRequired: true,
    visualContinuityAccepted: null,
    controlIdentity,
    treatmentIdentity,
    controlArtifact: requireFingerFluidOracleArtifact(controlArtifact, 'unsupported-sheet control'),
    treatmentArtifact: requireFingerFluidOracleArtifact(treatmentArtifact, 'unsupported-sheet treatment'),
  };
}

export function evaluateFingerFluidPulseDrainageSeries({
  slices,
  expectedCaptureSteps,
  expectedPreset = 'high',
} = {}) {
  const resolvedExpectedPreset = resolveFingerFluidWaterfallOraclePreset(expectedPreset);
  const expectedConfig = createFingerFluidWaterfallOracleConfig(resolvedExpectedPreset);
  if (!Array.isArray(expectedCaptureSteps)
    || expectedCaptureSteps.length < 2
    || expectedCaptureSteps.some(step => !Number.isSafeInteger(step) || step < 1)) {
    throw new TypeError('Pulse drainage requires an ordered list of positive capture steps');
  }
  if (!Array.isArray(slices) || slices.length !== expectedCaptureSteps.length) {
    throw new Error('Pulse drainage series is missing one or more exact time slices');
  }
  let sourceActivationCount = null;
  let initialActiveParticleCount = null;
  let previousActiveParticleCount = Infinity;
  let commonIdentity = null;
  const acceptedSlices = slices.map((slice, index) => {
    const identity = slice?.identity;
    const diagnostics = slice?.diagnostics;
    const expectedStep = expectedCaptureSteps[index];
    if (identity?.schema !== KAMINOS_FINGER_FLUID_WATERFALL_ORACLE_EVIDENCE_SCHEMA
      || identity.truthScene !== 'waterfall_resolution_oracle'
      || identity.requestedPreset !== resolvedExpectedPreset
      || identity.effectivePreset !== resolvedExpectedPreset
      || identity.particleCount !== expectedConfig.defaultParticleCount
      || identity.refinementFactor !== expectedConfig.refinementFactor
      || identity.particleSpacing !== expectedConfig.particleSpacing
      || identity.particleVolume !== expectedConfig.particleVolume
      || identity.kernelRadius !== expectedConfig.kernelRadius
      || identity.visibleParticleRadius !== expectedConfig.visibleParticleRadius
      || identity.laneColumns !== expectedConfig.laneColumns
      || identity.laneRows !== expectedConfig.laneRows
      || identity.laneCount !== expectedConfig.laneCount
      || identity.releaseScheduleContract !== expectedConfig.releaseScheduleContract
      || identity.physicalSourceFlux !== expectedConfig.physicalSourceFlux
      || identity.expectedParticleReleaseRate !== expectedConfig.expectedParticleReleaseRate
      || identity.unsupportedSheetStrength !== 2
      || identity.inletCutoffStep !== expectedCaptureSteps[0]
      || identity.capturedStep !== expectedStep) {
      throw new Error(`Pulse drainage identity mismatch at capture step ${expectedStep}`);
    }
    const comparableIdentity = { ...identity, capturedStep: null };
    if (commonIdentity === null) commonIdentity = comparableIdentity;
    else if (JSON.stringify(comparableIdentity) !== JSON.stringify(commonIdentity)) {
      throw new Error(`Pulse drainage common identity mismatch at capture step ${expectedStep}`);
    }
    if (diagnostics?.stepCount !== expectedStep
      || diagnostics.inletCutoffStep !== expectedCaptureSteps[0]
      || diagnostics.inletCutoffReached !== true
      || !Number.isSafeInteger(diagnostics.sourceRecirculationCount)
      || !Number.isSafeInteger(diagnostics.activeParticleCount)
      || !Number.isSafeInteger(diagnostics.dormantParticleCount)) {
      throw new Error(`Pulse drainage diagnostics missing or stale at capture step ${expectedStep}`);
    }
    if (sourceActivationCount === null) sourceActivationCount = diagnostics.sourceRecirculationCount;
    else if (diagnostics.sourceRecirculationCount !== sourceActivationCount) {
      throw new Error(`Source activation continued after cutoff at capture step ${expectedStep}`);
    }
    if (diagnostics.activeParticleCount > previousActiveParticleCount) {
      throw new Error(`Active particle count increased after cutoff at capture step ${expectedStep}`);
    }
    if (initialActiveParticleCount === null) initialActiveParticleCount = diagnostics.activeParticleCount;
    previousActiveParticleCount = diagnostics.activeParticleCount;
    return {
      identity,
      diagnostics: { ...diagnostics },
      artifact: requireFingerFluidOracleArtifact(slice.artifact, `pulse drainage step ${expectedStep}`),
    };
  });
  if (sourceActivationCount <= 0) {
    throw new Error('Source never activated before cutoff');
  }
  if (previousActiveParticleCount >= initialActiveParticleCount) {
    throw new Error('No particle drainage observed after cutoff');
  }
  return {
    schema: 'kaminos.finger-fluid.pulse-drainage-series.v0',
    contract: KAMINOS_FINGER_FLUID_PULSE_DRAINAGE_CONTRACT,
    mechanicalChecksOk: true,
    sourceActivationCountStableAfterCutoff: true,
    sourceActivationCount,
    particleDrainageObserved: true,
    drainedParticleCount: initialActiveParticleCount - previousActiveParticleCount,
    drainedParticleRatio: (initialActiveParticleCount - previousActiveParticleCount) / initialActiveParticleCount,
    status: 'captured_pending_operator_disposition',
    operatorDispositionRequired: true,
    visualDrainageAccepted: null,
    effectivePreset: resolvedExpectedPreset,
    particleCount: expectedConfig.defaultParticleCount,
    expectedCaptureSteps: [...expectedCaptureSteps],
    slices: acceptedSlices,
  };
}

export function createFingerFluidPulseControlReadout({
  stepCount,
  inletCutoffStep = null,
  witnessTargetStep = null,
  paused = false,
} = {}) {
  if (!Number.isSafeInteger(stepCount) || stepCount < 0) {
    throw new TypeError(`Finger fluid pulse readout step must be a nonnegative integer: ${stepCount}`);
  }
  const cutoff = resolveFingerFluidInletCutoffStep(inletCutoffStep);
  const target = witnessTargetStep === null || witnessTargetStep === undefined
    ? null
    : Number(witnessTargetStep);
  if (target !== null && (!Number.isSafeInteger(target) || target < 1)) {
    throw new TypeError(`Finger fluid pulse readout target must be a positive integer: ${witnessTargetStep}`);
  }
  const stepLabel = target === null ? `STEP ${stepCount}` : `STEP ${stepCount} / ${target}`;
  const sourceLabel = cutoff === null
    ? 'SOURCE OPEN · NO CUT SCHEDULED'
    : stepCount < cutoff
      ? `SOURCE OPEN · CUT @ ${cutoff}`
      : `SOURCE CUT @ ${cutoff} · DRAINING ACTIVE RESERVOIR`;
  const runLabel = paused ? 'PAUSED' : 'RUNNING';
  return {
    stepLabel,
    sourceLabel,
    runLabel,
    text: [stepLabel, sourceLabel, runLabel].join('\n'),
  };
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
  { sourceParticleCount = particleCount } = {},
) {
  const simulationCapacity = Math.max(0, Math.min(
    Math.floor(finite(particleCount, 0)),
    Math.floor((particleData?.length || 0) / PARTICLE_FLOATS),
  ));
  const count = Math.max(0, Math.min(
    Math.floor(finite(sourceParticleCount, 0)),
    simulationCapacity,
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
    simulationCapacity,
    reservedParticleCount: simulationCapacity - count,
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
  const releasePeriodFrames = Math.max(1, LAMINAR_SOURCE_REFERENCE_FPS / Math.max(laneReleaseRate, 1e-9));
  const cycleFrames = Math.max(1, laneParticleCount * releasePeriodFrames);
  const lanePhaseOffset = ((laneIndex + 0.5) / descriptor.laneCount) * releasePeriodFrames;
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

export function sampleFingerFluidWaterfallOracleParticle(index, preset = 'baseline', {
  particleCount = createFingerFluidWaterfallOracleConfig(preset).defaultParticleCount,
} = {}) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError(`Finger fluid waterfall oracle particle index must be a nonnegative integer: ${index}`);
  }
  const config = createFingerFluidWaterfallOracleConfig(preset);
  const descriptor = createFingerFluidLaminarInletDescriptors()[1];
  const laneIndex = index % config.laneCount;
  const laneOrdinal = Math.floor(index / config.laneCount);
  const column = laneIndex % config.laneColumns;
  const row = Math.floor(laneIndex / config.laneColumns);
  const u = (((column + 0.5) / config.laneColumns) * 2 - 1) * descriptor.halfWidth * 0.92;
  const v = (((row + 0.5) / config.laneRows) * 2 - 1) * descriptor.halfHeight * 0.88;
  const profile = evaluateFingerFluidLaminarInletProfile(descriptor, [u, v]);
  let laneSpeedSum = 0;
  for (let lane = 0; lane < config.laneCount; lane += 1) {
    const laneColumn = lane % config.laneColumns;
    const laneRow = Math.floor(lane / config.laneColumns);
    const laneU = (((laneColumn + 0.5) / config.laneColumns) * 2 - 1) * descriptor.halfWidth * 0.92;
    const laneV = (((laneRow + 0.5) / config.laneRows) * 2 - 1) * descriptor.halfHeight * 0.88;
    laneSpeedSum += evaluateFingerFluidLaminarInletProfile(descriptor, [laneU, laneV]).axialSpeed;
  }
  const laneParticleCount = Math.floor((particleCount - 1 - laneIndex) / config.laneCount) + 1;
  const laneReleaseRate = config.expectedParticleReleaseRate * profile.axialSpeed / Math.max(laneSpeedSum, 1e-9);
  const releasePeriodFrames = Math.max(1, LAMINAR_SOURCE_REFERENCE_FPS / Math.max(laneReleaseRate, 1e-9));
  const cycleFrames = Math.max(1, laneParticleCount * releasePeriodFrames);
  const lanePhaseOffset = ((laneIndex + 0.5) / config.laneCount) * releasePeriodFrames;
  const releaseFrame = laneOrdinal * releasePeriodFrames + lanePhaseOffset;
  const ageFramesAtStart = releaseFrame === 0 ? 0 : cycleFrames - releaseFrame;
  const initialAxialPosition = -descriptor.reservoirLength
    + config.particleSpacing * 0.5
    + profile.axialSpeed * (ageFramesAtStart / LAMINAR_SOURCE_REFERENCE_FPS);
  const activeAtFrameZero = initialAxialPosition <= 0;
  const axialPosition = activeAtFrameZero
    ? initialAxialPosition
    : -descriptor.reservoirLength + config.particleSpacing * 0.5;
  const axis = descriptor.axis;
  const tangent = descriptor.tangent;
  const bitangent = normalizeFingerFluidInletVector([
    axis[1] * tangent[2] - axis[2] * tangent[1],
    axis[2] * tangent[0] - axis[0] * tangent[2],
    axis[0] * tangent[1] - axis[1] * tangent[0],
  ], `${descriptor.id} waterfall oracle bitangent`);
  return {
    sourceIndex: 1,
    localOrdinal: index,
    laneIndex,
    laneOrdinal,
    profile: descriptor.profile,
    phase: descriptor.phase,
    activeAtFrameZero,
    releasePeriodFrames,
    cycleFrames,
    releaseFrame,
    position: descriptor.origin.map((value, component) => (
      value + tangent[component] * u + bitangent[component] * v + axis[component] * axialPosition
    )),
    velocity: axis.map(value => value * profile.axialSpeed),
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

export function estimateFingerFluidInterfaceGeometry(position, neighbors, {
  kernelRadius = 0.185,
  fallbackNormal = [0, 1, 0],
} = {}) {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
    throw new TypeError('Finger fluid interface geometry requires a finite 3D source position');
  }
  if (!Array.isArray(neighbors)) {
    throw new TypeError('Finger fluid interface geometry requires a neighbor array');
  }
  if (!Number.isFinite(kernelRadius) || kernelRadius <= 0) {
    throw new RangeError(`Finger fluid interface geometry requires a positive kernel radius, received: ${kernelRadius}`);
  }
  if (!Array.isArray(fallbackNormal) || fallbackNormal.length !== 3 || !fallbackNormal.every(Number.isFinite)) {
    throw new TypeError('Finger fluid interface geometry requires a finite nonzero fallback normal');
  }
  const fallbackLength = Math.hypot(...fallbackNormal);
  if (fallbackLength <= 1e-9) throw new TypeError('Finger fluid interface geometry requires a finite nonzero fallback normal');

  const directionalSupport = [0, 0, 0];
  const accepted = [];
  let supportWeight = 0;
  for (const neighbor of neighbors) {
    const neighborPosition = neighbor?.position;
    const confidence = Number(neighbor?.confidence ?? 1);
    if (!Array.isArray(neighborPosition) || neighborPosition.length !== 3 || !neighborPosition.every(Number.isFinite) || !Number.isFinite(confidence)) {
      throw new TypeError('Finger fluid interface geometry received a malformed neighbor');
    }
    if (confidence < 0.32) continue;
    const offset = position.map((value, axis) => value - neighborPosition[axis]);
    const distance = Math.hypot(...offset);
    if (distance <= 1e-9 || distance >= kernelRadius) continue;
    const normalizedDistance = distance / kernelRadius;
    const weight = ((1 - normalizedDistance) ** 3) * confidence;
    supportWeight += weight;
    for (let axis = 0; axis < 3; axis += 1) directionalSupport[axis] += offset[axis] / distance * weight;
    accepted.push({ offset, weight });
  }

  const supportLength = Math.hypot(...directionalSupport);
  const normal = supportLength > 1e-9
    ? directionalSupport.map(value => value / supportLength)
    : fallbackNormal.map(value => value / fallbackLength);
  let weightedNormalOffset = 0;
  let weightedTangentSpan = 0;
  for (const { offset, weight } of accepted) {
    const normalOffset = offset.reduce((sum, value, axis) => sum + value * normal[axis], 0);
    const tangentOffset = offset.map((value, axis) => value - normal[axis] * normalOffset);
    weightedNormalOffset += normalOffset * weight;
    weightedTangentSpan += tangentOffset.reduce((sum, value) => sum + value * value, 0) * weight;
  }
  const smoothstep = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  const meanTangentSpanSquared = weightedTangentSpan / Math.max(1e-9, supportWeight);
  const countConfidence = smoothstep(3, 8, accepted.length);
  const spanConfidence = smoothstep((kernelRadius * 0.08) ** 2, (kernelRadius * 0.2) ** 2, meanTangentSpanSquared);
  const resolutionConfidence = countConfidence * spanConfidence;
  const rawCurvature = weightedTangentSpan > 1e-9
    ? 2 * weightedNormalOffset / weightedTangentSpan
    : 0;
  const maximumResolvableCurvature = 2 / kernelRadius;
  const resolved = resolutionConfidence >= 0.2 && Math.abs(rawCurvature) <= maximumResolvableCurvature;
  const curvature = resolved ? rawCurvature : 0;
  const supportConfidence = Math.min(1, supportWeight / Math.max(1e-9, accepted.length * 0.08));
  return {
    contract: KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT,
    normal,
    curvature,
    confidence: resolved ? supportConfidence * resolutionConfidence : 0,
    resolved,
    maximumResolvableCurvature,
    neighborCount: accepted.length,
  };
}

export function validateFingerFluidTruthRendererState(requestedMode, runtime, {
  requestedOpticalDebugMode = 'shaded',
  requestedOpticalFootprintMode = null,
  requestedTransmissionFootprintMode = null,
  requestedBodyTransportMode = null,
  requestedInterfaceFrequencyMode = null,
} = {}) {
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

  const deferredSceneEvidence = runtime.deferredSceneEvidence;
  const renderFrameId = deferredSceneEvidence?.renderFrameId;
  const reflectionDiagnostic = expectedMode === 'screen_space_refraction'
    && ['reflection', 'reflection_hit_kind', 'reflection_distance', 'environment', 'liquid_support', 'environment_contribution', 'reflected_transport', 'reflection_footprint'].includes(runtime.opticalDebugMode);
  const dynamicMeshPresentationIsCurrent = reflectionDiagnostic
    ? deferredSceneEvidence?.dynamicMesh?.presentationMode === 'suppressed_in_reflection_debug_provider_remains_active_v0'
      && deferredSceneEvidence?.dynamicIndexedMeshLastDrawFrameId !== renderFrameId
    : deferredSceneEvidence?.dynamicMesh?.presentationMode === 'deferred_scene_visible_v0'
      && deferredSceneEvidence?.dynamicIndexedMeshLastDrawFrameId === renderFrameId;
  if (
    deferredSceneEvidence?.requestedRoute !== KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE
    || deferredSceneEvidence?.effectiveRoute !== KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE
    || deferredSceneEvidence?.route !== KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE
    || deferredSceneEvidence?.fallbackReason
    || !Number.isInteger(deferredSceneEvidence?.passCount)
    || deferredSceneEvidence.passCount <= 0
    || !Number.isInteger(deferredSceneEvidence?.dynamicIndexedMeshDrawCount)
    || deferredSceneEvidence.dynamicIndexedMeshDrawCount < 0
    || !Number.isInteger(renderFrameId)
    || renderFrameId <= 0
    || deferredSceneEvidence?.deferredSceneFrameId !== renderFrameId
    || !dynamicMeshPresentationIsCurrent
    || deferredSceneEvidence?.dynamicMesh?.objectId !== DYNAMIC_REFLECTION_MESH_OBJECT_ID
    || deferredSceneEvidence?.dynamicMesh?.indexCount !== DYNAMIC_REFLECTION_MESH_INDEX_COUNT
    || deferredSceneEvidence?.attachments?.worldNormalRoughness?.format !== 'rgba16float'
    || deferredSceneEvidence?.attachments?.albedoMetallic?.format !== 'rgba8unorm'
    || deferredSceneEvidence?.attachments?.linearDepthObject?.format !== 'rgba16float'
  ) {
    throw new Error(`Finger fluid truth deferred scene evidence is missing or partial: ${JSON.stringify(deferredSceneEvidence)}`);
  }

  const supportPresentationEvidence = runtime.supportPresentationEvidence;
  if (
    supportPresentationEvidence?.route !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE
    || supportPresentationEvidence?.depthRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE
    || supportPresentationEvidence?.colorDepthAuthority !== 'same_pass_same_analytic_geometry_v0'
    || supportPresentationEvidence?.refractionCaptureOrder !== 'copy_after_deferred_scene_v0'
    || !Number.isInteger(supportPresentationEvidence?.passCount)
    || supportPresentationEvidence.passCount <= 0
    || supportPresentationEvidence?.particleSupportDrawCount !== 0
  ) {
    throw new Error(`Finger fluid truth support presentation evidence is missing or partial: ${JSON.stringify(supportPresentationEvidence)}`);
  }

  const linearHdrSceneEvidence = runtime.linearHdrSceneEvidence;
  const worldLightingConsumers = linearHdrSceneEvidence?.worldLightingConsumers;
  const hasExactWorldLightingConsumers = Array.isArray(worldLightingConsumers)
    && worldLightingConsumers.length === LINEAR_HDR_WORLD_LIGHTING_CONSUMERS.length
    && new Set(worldLightingConsumers).size === LINEAR_HDR_WORLD_LIGHTING_CONSUMERS.length
    && LINEAR_HDR_WORLD_LIGHTING_CONSUMERS.every((consumer) => worldLightingConsumers.includes(consumer));
  if (
    linearHdrSceneEvidence?.requestedRoute !== KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE
    || linearHdrSceneEvidence?.effectiveRoute !== KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE
    || linearHdrSceneEvidence?.format !== LINEAR_SCENE_FORMAT
    || linearHdrSceneEvidence?.colorSpace !== 'scene_linear_rec2020_agnostic_rgb_v0'
    || linearHdrSceneEvidence?.backgroundRoute !== KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE
    || linearHdrSceneEvidence?.environmentFilterRoute !== KAMINOS_FINGER_FLUID_ENVIRONMENT_FILTER_ROUTE
    || !Number.isInteger(linearHdrSceneEvidence?.backgroundPassCount)
    || linearHdrSceneEvidence.backgroundPassCount <= 0
    || !hasExactWorldLightingConsumers
    || linearHdrSceneEvidence?.fallbackReason
  ) {
    throw new Error(`Finger fluid truth linear HDR scene evidence is missing or partial: ${JSON.stringify(linearHdrSceneEvidence)}`);
  }
  const finalPresentationEvidence = runtime.finalPresentationEvidence;
  if (
    finalPresentationEvidence?.requestedRoute !== KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE
    || finalPresentationEvidence?.effectiveRoute !== KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE
    || finalPresentationEvidence?.sourceFormat !== LINEAR_SCENE_FORMAT
    || finalPresentationEvidence?.toneMap !== 'aces-fitted-v0'
    || finalPresentationEvidence?.exposure !== LINEAR_SCENE_EXPOSURE
    || finalPresentationEvidence?.displayTransformCountPerFrame !== 1
    || finalPresentationEvidence?.exactDiagnosticBypass !== 'liquid_support'
    || finalPresentationEvidence?.diagnosticVisibilityRoute !== 'post-composite-depth24plus-identity-v0'
    || !Number.isInteger(finalPresentationEvidence?.passCount)
    || finalPresentationEvidence.passCount <= 0
    || finalPresentationEvidence?.fallbackReason
  ) {
    throw new Error(`Finger fluid truth final presentation evidence is missing or partial: ${JSON.stringify(finalPresentationEvidence)}`);
  }

  let screenSpaceSurfaceEvidence = null;
  if (expectedMode === 'screen_space_surface') {
    const evidence = runtime.screenSpaceSurfaceEvidence;
    if (
      evidence?.route !== KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE
      || evidence?.shaderRoute !== KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE
      || evidence?.supportDepthRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE
      || evidence?.accumulationTexture?.format !== 'rgba16float'
      || evidence?.accumulationTexture?.channels?.join('|') !== 'optical_thickness|material_weighted_thickness|depth_weight|depth_weighted_view_depth_sum'
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
  let worldSpaceReflectionEvidence = null;
  let opticalQueryEvidence = null;
  let environmentMapEvidence = null;
  let expectedOpticalDebugMode = null;
  if (expectedMode === 'screen_space_refraction') {
    expectedOpticalDebugMode = resolveFingerFluidOpticalDebugMode(requestedOpticalDebugMode);
    const expectedOpticalFootprintMode = resolveFingerFluidOpticalFootprintMode(
      requestedOpticalFootprintMode || runtime.requestedOpticalFootprintMode,
    );
    const expectedOpticalFootprintRoute = opticalFootprintRouteForMode(expectedOpticalFootprintMode);
    if (
      runtime.requestedOpticalFootprintMode !== expectedOpticalFootprintMode
      || runtime.effectiveOpticalFootprintMode !== expectedOpticalFootprintMode
      || runtime.requestedOpticalFootprintRoute !== expectedOpticalFootprintRoute
      || runtime.effectiveOpticalFootprintRoute !== expectedOpticalFootprintRoute
      || runtime.opticalFootprintFallbackReason
    ) {
      throw new Error(`Finger fluid truth optical footprint disagreement: ${JSON.stringify({
        expectedOpticalFootprintMode,
        expectedOpticalFootprintRoute,
        requestedOpticalFootprintMode: runtime.requestedOpticalFootprintMode,
        effectiveOpticalFootprintMode: runtime.effectiveOpticalFootprintMode,
        requestedOpticalFootprintRoute: runtime.requestedOpticalFootprintRoute,
        effectiveOpticalFootprintRoute: runtime.effectiveOpticalFootprintRoute,
        opticalFootprintFallbackReason: runtime.opticalFootprintFallbackReason,
      })}`);
    }
    const expectedTransmissionFootprintMode = resolveFingerFluidTransmissionFootprintMode(
      requestedTransmissionFootprintMode || runtime.requestedTransmissionFootprintMode,
    );
    const expectedTransmissionFootprintRoute = transmissionFootprintRouteForMode(expectedTransmissionFootprintMode);
    if (
      runtime.requestedTransmissionFootprintMode !== expectedTransmissionFootprintMode
      || runtime.effectiveTransmissionFootprintMode !== expectedTransmissionFootprintMode
      || runtime.requestedTransmissionFootprintRoute !== expectedTransmissionFootprintRoute
      || runtime.effectiveTransmissionFootprintRoute !== expectedTransmissionFootprintRoute
      || runtime.transmissionFootprintFallbackReason
    ) {
      throw new Error(`Finger fluid truth transmission footprint disagreement: ${JSON.stringify({
        expectedTransmissionFootprintMode,
        expectedTransmissionFootprintRoute,
        requestedTransmissionFootprintMode: runtime.requestedTransmissionFootprintMode,
        effectiveTransmissionFootprintMode: runtime.effectiveTransmissionFootprintMode,
        requestedTransmissionFootprintRoute: runtime.requestedTransmissionFootprintRoute,
        effectiveTransmissionFootprintRoute: runtime.effectiveTransmissionFootprintRoute,
        transmissionFootprintFallbackReason: runtime.transmissionFootprintFallbackReason,
      })}`);
    }
    const expectedBodyTransportMode = resolveFingerFluidBodyTransportMode(
      requestedBodyTransportMode || runtime.requestedBodyTransportMode,
    );
    const expectedBodyTransportRoute = bodyTransportRouteForMode(expectedBodyTransportMode);
    if (
      runtime.requestedBodyTransportMode !== expectedBodyTransportMode
      || runtime.effectiveBodyTransportMode !== expectedBodyTransportMode
      || runtime.requestedBodyTransportRoute !== expectedBodyTransportRoute
      || runtime.effectiveBodyTransportRoute !== expectedBodyTransportRoute
      || runtime.bodyTransportFallbackReason
    ) {
      throw new Error(`Finger fluid truth body transport disagreement: ${JSON.stringify({
        expectedBodyTransportMode,
        expectedBodyTransportRoute,
        requestedBodyTransportMode: runtime.requestedBodyTransportMode,
        effectiveBodyTransportMode: runtime.effectiveBodyTransportMode,
        requestedBodyTransportRoute: runtime.requestedBodyTransportRoute,
        effectiveBodyTransportRoute: runtime.effectiveBodyTransportRoute,
        bodyTransportFallbackReason: runtime.bodyTransportFallbackReason,
      })}`);
    }
    const expectedInterfaceFrequencyMode = resolveFingerFluidInterfaceFrequencyMode(
      requestedInterfaceFrequencyMode || runtime.requestedInterfaceFrequencyMode,
    );
    const expectedInterfaceFrequencyRoute = interfaceFrequencyRouteForMode(expectedInterfaceFrequencyMode);
    if (
      runtime.requestedInterfaceFrequencyMode !== expectedInterfaceFrequencyMode
      || runtime.effectiveInterfaceFrequencyMode !== expectedInterfaceFrequencyMode
      || runtime.requestedInterfaceFrequencyRoute !== expectedInterfaceFrequencyRoute
      || runtime.effectiveInterfaceFrequencyRoute !== expectedInterfaceFrequencyRoute
      || runtime.interfaceFrequencyFallbackReason
    ) {
      throw new Error(`Finger fluid truth interface frequency disagreement: ${JSON.stringify({
        expectedInterfaceFrequencyMode,
        expectedInterfaceFrequencyRoute,
        requestedInterfaceFrequencyMode: runtime.requestedInterfaceFrequencyMode,
        effectiveInterfaceFrequencyMode: runtime.effectiveInterfaceFrequencyMode,
        requestedInterfaceFrequencyRoute: runtime.requestedInterfaceFrequencyRoute,
        effectiveInterfaceFrequencyRoute: runtime.effectiveInterfaceFrequencyRoute,
        interfaceFrequencyFallbackReason: runtime.interfaceFrequencyFallbackReason,
      })}`);
    }
    if (
      runtime.requestedOpticalDebugMode !== expectedOpticalDebugMode
      || runtime.effectiveOpticalDebugMode !== expectedOpticalDebugMode
    ) {
      throw new Error(`Finger fluid truth optical debug mode disagreement: ${JSON.stringify({
        expectedOpticalDebugMode,
        requestedOpticalDebugMode: runtime.requestedOpticalDebugMode,
        effectiveOpticalDebugMode: runtime.effectiveOpticalDebugMode,
      })}`);
    }
    const evidence = runtime.refractionEvidence;
    const interfaceFidelityDiagnostic = runtime.opticalDebugMode === 'interface_fidelity';
    const expectedOpticalTransportExecution = interfaceFidelityDiagnostic
      ? 'not_executed_early_interface_diagnostic_v0'
      : 'executed_refraction_and_reflection_transport_v0';
    if (
      evidence?.route !== KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE
      || evidence?.shaderRoute !== KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE
      || evidence?.opticalTransportRoute !== KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE
      || evidence?.opticalQueryRoute !== KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE
      || evidence?.deferredTraversalRoute !== KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE
      || evidence?.interfaceFidelityRoute !== KAMINOS_FINGER_FLUID_INTERFACE_FIDELITY_ROUTE
      || evidence?.coverageClosure !== 'dense_support_footprint_closure_sparse_identity_v0'
      || evidence?.normalFiltering !== 'detail_macro_chord_variance_blend_v0'
      || evidence?.legacyDebugMode !== 'legacy_interface'
      || evidence?.opticalTransportExecution !== expectedOpticalTransportExecution
      || evidence?.slabRoute !== KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE
      || evidence?.supportDepthRoute !== KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE
      || !Number.isInteger(evidence?.analyticSupportDepthPassCount)
      || evidence.analyticSupportDepthPassCount <= 0
      || !Number.isInteger(evidence?.scenePassCount)
      || evidence.scenePassCount <= 0
      || !Number.isInteger(evidence?.slabGeometryPassCount)
      || evidence.slabGeometryPassCount <= 0
      || evidence?.frontDepthTexture?.format !== 'rgba16float'
      || evidence?.frontDepthTexture?.channels?.join('|') !== 'projected_particle_sphere_front_view_depth_min|nearest_particle_center_view_depth_min'
      || evidence?.backDepthTexture?.format !== 'rgba16float'
      || evidence?.backDepthTexture?.channel !== 'projected_particle_sphere_back_view_depth_max'
      || evidence?.accumulationTexture?.format !== 'rgba16float'
      || evidence?.accumulationTexture?.channels?.join('|') !== 'optical_thickness|material_weighted_thickness|depth_weight|depth_weighted_view_depth_sum'
      || evidence?.invalidSlabDisposition !== 'entry_interface_only_no_exit_claim_v0'
      || evidence?.opticalDebugMode !== expectedOpticalDebugMode
      || evidence?.requestedOpticalFootprintMode !== expectedOpticalFootprintMode
      || evidence?.effectiveOpticalFootprintMode !== expectedOpticalFootprintMode
      || evidence?.requestedOpticalFootprintRoute !== expectedOpticalFootprintRoute
      || evidence?.effectiveOpticalFootprintRoute !== expectedOpticalFootprintRoute
      || evidence?.opticalFootprintFallbackReason
      || evidence?.reflectionFootprintComposition !== (expectedOpticalFootprintMode === 'variance_filtered'
        ? 'dense_unresolved_variance_widens_normalized_nine_ray_reflection_lobe_v0'
        : 'resolved_detail_normalized_five_ray_reflection_lobe_v0')
      || evidence?.requestedTransmissionFootprintMode !== expectedTransmissionFootprintMode
      || evidence?.effectiveTransmissionFootprintMode !== expectedTransmissionFootprintMode
      || evidence?.requestedTransmissionFootprintRoute !== expectedTransmissionFootprintRoute
      || evidence?.effectiveTransmissionFootprintRoute !== expectedTransmissionFootprintRoute
      || evidence?.transmissionFootprintFallbackReason
      || evidence?.transmissionFootprintComposition !== (expectedTransmissionFootprintMode === 'dense_exit_filtered'
        ? 'dense_exit_variance_trimmed_three_of_five_hybrid_query_radiance_v0'
        : 'resolved_exit_single_hybrid_query_radiance_v0')
      || evidence?.transmissionQuadratureRoute !== (expectedTransmissionFootprintMode === 'dense_exit_filtered'
        ? KAMINOS_FINGER_FLUID_DENSE_EXIT_TRANSMISSION_QUADRATURE_ROUTE
        : KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_ROUTE)
      || evidence?.transmissionApplicability !== 'dense_body_and_unresolved_entry_or_exit_normal_only_sparse_sheet_resolved_v0'
      || evidence?.requestedBodyTransportMode !== expectedBodyTransportMode
      || evidence?.effectiveBodyTransportMode !== expectedBodyTransportMode
      || evidence?.requestedBodyTransportRoute !== expectedBodyTransportRoute
      || evidence?.effectiveBodyTransportRoute !== expectedBodyTransportRoute
      || evidence?.bodyTransportFallbackReason
      || evidence?.bodyTransportComposition !== (expectedBodyTransportMode === 'robust_dense_body'
        ? 'dense_valid_geometric_thickness_path_closure_with_filtered_radiance_residual_v1'
        : 'geometric_valid_exit_path_with_entry_thickness_fallback_v0')
      || evidence?.requestedInterfaceFrequencyMode !== expectedInterfaceFrequencyMode
      || evidence?.effectiveInterfaceFrequencyMode !== expectedInterfaceFrequencyMode
      || evidence?.requestedInterfaceFrequencyRoute !== expectedInterfaceFrequencyRoute
      || evidence?.effectiveInterfaceFrequencyRoute !== expectedInterfaceFrequencyRoute
      || evidence?.interfaceFrequencyFallbackReason
      || evidence?.interfaceFrequencyComposition !== (expectedInterfaceFrequencyMode === 'macro_micro_separated'
        ? 'macro_snell_fresnel_bounded_micro_reflection_path_conditioned_transmission_v1'
        : 'coupled_detail_interface_transport_baseline_v0')
      || evidence?.sceneColorTexture?.source !== 'same-camera-linear-hdr-scene-radiance-v0'
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
    const queryEvidence = runtime.opticalQueryEvidence;
    const reflectionEvidence = runtime.worldSpaceReflectionEvidence;
    const environmentEvidence = runtime.environmentMapEvidence;
    if (interfaceFidelityDiagnostic && (
      queryEvidence !== undefined
      || reflectionEvidence !== undefined
      || environmentEvidence !== undefined
    )) {
      throw new Error(`Finger fluid truth interface diagnostic published inactive optical provider evidence: ${JSON.stringify({ queryEvidence, reflectionEvidence, environmentEvidence })}`);
    }
    if (!interfaceFidelityDiagnostic) {
    const expectedQuadratureRoute = expectedOpticalFootprintMode === 'variance_filtered'
      ? KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_REFLECTION_QUADRATURE_ROUTE
      : KAMINOS_FINGER_FLUID_REFLECTION_QUADRATURE_ROUTE;
    const expectedMaximumQuadratureSampleCount = expectedOpticalFootprintMode === 'variance_filtered' ? 9 : 5;
    const expectedQuadratureSampleCountMode = expectedOpticalFootprintMode === 'variance_filtered'
      ? 'adaptive_5_sparse_9_dense_v0'
      : 'fixed_5_v0';
    const expectedQuadratureEstimator = expectedOpticalFootprintMode === 'variance_filtered'
      ? 'trimmed_min_max_7_of_9_equal_weight_v0'
      : 'weighted_five_ray_mean_v0';
    if (
      queryEvidence?.schema !== KAMINOS_FINGER_FLUID_OPTICAL_QUERY_SCHEMA
      || queryEvidence?.requestedRoute !== KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE
      || queryEvidence?.effectiveRoute !== KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE
      || queryEvidence?.route !== KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE
      || queryEvidence?.deferredTraversalRoute !== KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE
      || queryEvidence?.worldProviderRoute !== KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE
      || queryEvidence?.environmentRoute !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE
      || queryEvidence?.resolverOrder !== KAMINOS_FINGER_FLUID_OPTICAL_QUERY_RESOLVER_ORDER
      || queryEvidence?.fallbackReason
      || queryEvidence?.queryFrameId !== renderFrameId
      || !Number.isInteger(queryEvidence?.compositePassCount)
      || queryEvidence.compositePassCount <= 0
      || queryEvidence?.maximumDeferredMarchSteps !== 24
      || queryEvidence?.minimumDeferredConfidence !== 0.55
      || queryEvidence?.deferredInputs?.linearDepthObject?.format !== 'rgba16float'
      || queryEvidence?.deferredInputs?.worldNormalRoughness?.format !== 'rgba16float'
      || queryEvidence?.deferredInputs?.albedoMetallic?.format !== 'rgba8unorm'
      || queryEvidence?.consumers?.join('|') !== 'reflection_center_ray|two_interface_refraction_exit_ray'
      || queryEvidence?.resultFields?.join('|') !== 'origin|direction|cone|interval|hit_kind|object_id|distance|normal|material|radiance|transmittance|confidence|provider|fallback'
    ) {
      throw new Error(`Finger fluid truth hybrid optical query evidence is missing or partial: ${JSON.stringify(queryEvidence)}`);
    }
    opticalQueryEvidence = { ...queryEvidence };
    if (
      reflectionEvidence?.schema !== KAMINOS_FINGER_FLUID_REFLECTION_QUERY_SCHEMA
      || reflectionEvidence?.requestedProviderRoute !== KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE
      || reflectionEvidence?.effectiveProviderRoute !== KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE
      || reflectionEvidence?.providerRoute !== KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE
      || reflectionEvidence?.accelerationRoute !== KAMINOS_FINGER_FLUID_REFLECTION_ACCELERATION_ROUTE
      || reflectionEvidence?.quadratureRoute !== expectedQuadratureRoute
      || reflectionEvidence?.requestedFootprintMode !== expectedOpticalFootprintMode
      || reflectionEvidence?.effectiveFootprintMode !== expectedOpticalFootprintMode
      || reflectionEvidence?.requestedFootprintRoute !== expectedOpticalFootprintRoute
      || reflectionEvidence?.effectiveFootprintRoute !== expectedOpticalFootprintRoute
      || reflectionEvidence?.footprintFallbackReason
      || reflectionEvidence?.minimumQuadratureSampleCount !== 5
      || reflectionEvidence?.maximumQuadratureSampleCount !== expectedMaximumQuadratureSampleCount
      || reflectionEvidence?.quadratureSampleCountMode !== expectedQuadratureSampleCountMode
      || reflectionEvidence?.quadratureEstimator !== expectedQuadratureEstimator
      || reflectionEvidence?.quadratureWeightSum !== 1
      || reflectionEvidence?.hitKindDiagnosticScope !== 'center_ray_only_v0'
      || reflectionEvidence?.fallbackReason
      || reflectionEvidence?.candidateCapMode !== 'uncapped_exact_dynamic_mesh_triangle_population_v0'
      || reflectionEvidence?.exactTriangleCount !== DYNAMIC_REFLECTION_MESH_TRIANGLE_COUNT
      || !Number.isInteger(reflectionEvidence?.compositePassCount)
      || reflectionEvidence.compositePassCount <= 0
      || reflectionEvidence?.reflectionProviderFrameId !== renderFrameId
      || reflectionEvidence?.dynamicMeshTransformGeneration !== deferredSceneEvidence?.dynamicMesh?.transformGeneration
      || !reflectionEvidence?.hitKinds?.includes('environment')
      || !reflectionEvidence?.hitKinds?.includes('analytic_sphere')
      || !reflectionEvidence?.hitKinds?.includes('indexed_mesh')
    ) {
      throw new Error(`Finger fluid truth world-space reflection evidence is missing or partial: ${JSON.stringify(reflectionEvidence)}`);
    }
    worldSpaceReflectionEvidence = { ...reflectionEvidence };
    if (
      environmentEvidence?.schema !== 'kaminos.hdr-environment-map.v0'
      || environmentEvidence?.requestedRoute !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE
      || environmentEvidence?.effectiveRoute !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE
      || environmentEvidence?.assetId !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_ID
      || environmentEvidence?.assetSha256 !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SHA256
      || environmentEvidence?.runtimeAssetUrl !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_URL
      || environmentEvidence?.sourceAssetUrl !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_ASSET_URL
      || environmentEvidence?.sourcePageUrl !== KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_PAGE_URL
      || environmentEvidence?.license !== 'CC0-1.0'
      || environmentEvidence?.decodeRoute !== 'cpu-radiance-rle-rgbe-v0'
      || environmentEvidence?.samplingRoute !== 'wgsl-manual-bilinear-rgbe-equirectangular-v0'
      || environmentEvidence?.width !== 1024
      || environmentEvidence?.height !== 512
      || environmentEvidence?.gpuTextureFormat !== 'rgba8unorm'
      || environmentEvidence?.fallbackReason
    ) {
      throw new Error(`Finger fluid truth HDR environment evidence is missing or partial: ${JSON.stringify(environmentEvidence)}`);
    }
    environmentMapEvidence = { ...environmentEvidence };
    }
  }

  return {
    requestedRendererMode: runtime.requestedRendererMode,
    effectiveRendererMode: runtime.effectiveRendererMode,
    requestedRenderer: runtime.requestedRenderer,
    effectiveRenderer: runtime.effectiveRenderer,
    fallbackReason: runtime.fallbackReason || null,
    deferredSceneEvidence: { ...deferredSceneEvidence },
    ...(expectedMode === 'screen_space_refraction' ? {
      requestedOpticalDebugMode: runtime.requestedOpticalDebugMode,
      effectiveOpticalDebugMode: runtime.effectiveOpticalDebugMode,
      requestedOpticalFootprintMode: runtime.requestedOpticalFootprintMode,
      effectiveOpticalFootprintMode: runtime.effectiveOpticalFootprintMode,
      requestedOpticalFootprintRoute: runtime.requestedOpticalFootprintRoute,
      effectiveOpticalFootprintRoute: runtime.effectiveOpticalFootprintRoute,
      opticalFootprintFallbackReason: runtime.opticalFootprintFallbackReason || null,
      requestedTransmissionFootprintMode: runtime.requestedTransmissionFootprintMode,
      effectiveTransmissionFootprintMode: runtime.effectiveTransmissionFootprintMode,
      requestedTransmissionFootprintRoute: runtime.requestedTransmissionFootprintRoute,
      effectiveTransmissionFootprintRoute: runtime.effectiveTransmissionFootprintRoute,
      transmissionFootprintFallbackReason: runtime.transmissionFootprintFallbackReason || null,
      requestedBodyTransportMode: runtime.requestedBodyTransportMode,
      effectiveBodyTransportMode: runtime.effectiveBodyTransportMode,
      requestedBodyTransportRoute: runtime.requestedBodyTransportRoute,
      effectiveBodyTransportRoute: runtime.effectiveBodyTransportRoute,
      bodyTransportFallbackReason: runtime.bodyTransportFallbackReason || null,
      requestedInterfaceFrequencyMode: runtime.requestedInterfaceFrequencyMode,
      effectiveInterfaceFrequencyMode: runtime.effectiveInterfaceFrequencyMode,
      requestedInterfaceFrequencyRoute: runtime.requestedInterfaceFrequencyRoute,
      effectiveInterfaceFrequencyRoute: runtime.effectiveInterfaceFrequencyRoute,
      interfaceFrequencyFallbackReason: runtime.interfaceFrequencyFallbackReason || null,
    } : {}),
    supportPresentationEvidence: {
      ...supportPresentationEvidence,
    },
    linearHdrSceneEvidence: { ...linearHdrSceneEvidence },
    finalPresentationEvidence: { ...finalPresentationEvidence },
    screenSpaceSurfaceEvidence,
    ...(expectedMode === 'screen_space_refraction' ? { refractionEvidence, opticalQueryEvidence, worldSpaceReflectionEvidence, environmentMapEvidence } : {}),
  };
}

export function resolveFingerFluidOpticalDebugMode(value = 'shaded') {
  const mode = String(value || 'shaded');
  if (!KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid optical debug mode: ${mode}`);
  }
  return mode;
}

export function resolveFingerFluidOpticalLightingMode(value = 'transport_only') {
  const mode = String(value || 'transport_only');
  if (!KAMINOS_FINGER_FLUID_OPTICAL_LIGHTING_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid optical lighting mode: ${mode}`);
  }
  return mode;
}

export function resolveFingerFluidOpticalFootprintMode(value = 'resolved_detail') {
  const mode = String(value || 'resolved_detail');
  if (!KAMINOS_FINGER_FLUID_OPTICAL_FOOTPRINT_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid optical footprint mode: ${mode}`);
  }
  return mode;
}

export function resolveFingerFluidTransmissionFootprintMode(value = 'resolved_exit') {
  const mode = String(value || 'resolved_exit');
  if (!KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid transmission footprint mode: ${mode}`);
  }
  return mode;
}

export function resolveFingerFluidBodyTransportMode(value = 'geometric_slab') {
  const mode = String(value || 'geometric_slab');
  if (!KAMINOS_FINGER_FLUID_BODY_TRANSPORT_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid body transport mode: ${mode}`);
  }
  return mode;
}

export function resolveFingerFluidInterfaceFrequencyMode(value = 'coupled_detail') {
  const mode = String(value || 'coupled_detail');
  if (!KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_MODES.includes(mode)) {
    throw new RangeError(`Unsupported finger fluid interface frequency mode: ${mode}`);
  }
  return mode;
}

export function fingerFluidAbsorptionCoefficientsForLightingMode(value = 'transport_only') {
  const mode = resolveFingerFluidOpticalLightingMode(value);
  return mode === 'legacy_shading' ? [0.46, 0.15, 0.055] : [1.10, 0.42, 0.18];
}

function opticalLightingRouteForMode(mode) {
  if (mode === 'bounded_ggx') return KAMINOS_FINGER_FLUID_BOUNDED_GGX_LIGHTING_ROUTE;
  if (mode === 'legacy_shading') return KAMINOS_FINGER_FLUID_LEGACY_SHADING_ROUTE;
  return KAMINOS_FINGER_FLUID_TRANSPORT_ONLY_LIGHTING_ROUTE;
}

function opticalFootprintRouteForMode(mode) {
  if (mode === 'variance_filtered') return KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_FOOTPRINT_ROUTE;
  return KAMINOS_FINGER_FLUID_RESOLVED_DETAIL_FOOTPRINT_ROUTE;
}

function transmissionFootprintRouteForMode(mode) {
  if (mode === 'dense_exit_filtered') return KAMINOS_FINGER_FLUID_DENSE_EXIT_TRANSMISSION_FOOTPRINT_ROUTE;
  return KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_FOOTPRINT_ROUTE;
}

function bodyTransportRouteForMode(mode) {
  if (mode === 'robust_dense_body') return KAMINOS_FINGER_FLUID_ROBUST_DENSE_BODY_TRANSPORT_ROUTE;
  return KAMINOS_FINGER_FLUID_GEOMETRIC_SLAB_BODY_TRANSPORT_ROUTE;
}

function interfaceFrequencyRouteForMode(mode) {
  if (mode === 'macro_micro_separated') return KAMINOS_FINGER_FLUID_MACRO_MICRO_INTERFACE_FREQUENCY_ROUTE;
  return KAMINOS_FINGER_FLUID_COUPLED_DETAIL_INTERFACE_FREQUENCY_ROUTE;
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

const KAMINOS_FINGER_FLUID_COMPUTE_MAX_SPEED_TOKEN = '__KAMINOS_FINGER_FLUID_MAX_SPEED__';
const KAMINOS_FINGER_FLUID_SUPPORT_BINDINGS_TOKEN = '__KAMINOS_FINGER_FLUID_SUPPORT_BINDINGS__';
const KAMINOS_FINGER_FLUID_SUPPORT_FUNCTIONS_TOKEN = '__KAMINOS_FINGER_FLUID_SUPPORT_FUNCTIONS__';
const ANALYTIC_SUPPORT_BINDINGS_WGSL = '';
const MOVING_HILL_SUPPORT_BINDINGS_WGSL = /* wgsl */`
struct MovingHillSupportSample {
  heightNormal: vec4<f32>,
  supportVelocityValid: vec4<f32>,
}

struct MovingHillSupportParams {
  originSpacing: vec4<f32>,
  dimensionsEpochs: vec4<u32>,
  remapIdentity: vec4<u32>,
}

@group(0) @binding(12) var movingHillSupportSamples: texture_2d_array<f32>;
@group(0) @binding(13) var<uniform> movingHillSupportParams: MovingHillSupportParams;
`;
const ANALYTIC_SUPPORT_FUNCTIONS_WGSL = /* wgsl */`
const analyticObstacleSupportEnabled: bool = true;

fn floorHeight(p: vec3<f32>) -> f32 {
  return toyFloorHeight(p);
}

fn floorNormal(p: vec3<f32>) -> vec3<f32> {
  return toyFloorNormal(p);
}

fn supportVelocityAt(position: vec3<f32>) -> vec3<f32> {
  _ = position;
  return vec3<f32>(0.0);
}

fn supportSignedDistanceFrame(position: vec3<f32>, radius: f32) -> vec4<f32> {
  let normal = floorNormal(position);
  let signedDistance = (position.y - (floorHeight(position) + radius)) * normal.y;
  return vec4<f32>(normal, signedDistance);
}

fn resolveSupportPenetration(inputPosition: vec3<f32>, radius: f32) -> vec3<f32> {
  var p = inputPosition;
  let normal = floorNormal(p);
  let penetration = floorHeight(p) + radius - p.y;
  if (penetration > 0.0) {
    p = p + normal * (penetration / max(normal.y, 0.15));
  }
  return p;
}

fn resolveSupportVelocity(inputVelocity: vec3<f32>, position: vec3<f32>, radius: f32) -> vec3<f32> {
  var velocity = inputVelocity;
  let frame = supportSignedDistanceFrame(position, radius);
  let normal = frame.xyz;
  if (frame.w <= 0.01) {
    let normalSpeed = dot(velocity, normal);
    if (normalSpeed < 0.0) {
      velocity = velocity - normal * normalSpeed;
    }
  }
  return velocity;
}

fn supportContactFrame(position: vec3<f32>) -> vec4<f32> {
  let radius = params.fluid.x * 0.22;
  let floorFrame = supportSignedDistanceFrame(position, radius);
  let floorSupport = 1.0 - smoothstep(0.012, 0.09, max(0.0, floorFrame.w));
  let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let fromSphere = position - sphereCenter;
  let sphereSupportDistance = abs(length(fromSphere) - (${OBSTACLE_RADIUS} + radius));
  let sphereSupport = 1.0 - smoothstep(0.012, 0.09, sphereSupportDistance);
  let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
  return vec4<f32>(
    select(sphereNormal, floorFrame.xyz, floorSupport >= sphereSupport),
    max(floorSupport, sphereSupport),
  );
}
`;
const MOVING_HILL_SUPPORT_FUNCTIONS_WGSL = /* wgsl */`
const analyticObstacleSupportEnabled: bool = false;

fn movingHillSupportTexel(x: u32, z: u32) -> MovingHillSupportSample {
  let coordinates = vec2<i32>(i32(x), i32(z));
  return MovingHillSupportSample(
    textureLoad(movingHillSupportSamples, coordinates, 0, 0),
    textureLoad(movingHillSupportSamples, coordinates, 1, 0),
  );
}

fn movingHillSupportSample(position: vec3<f32>) -> MovingHillSupportSample {
  let dimensions = vec2<u32>(
    movingHillSupportParams.dimensionsEpochs.x,
    movingHillSupportParams.dimensionsEpochs.y,
  );
  let origin = movingHillSupportParams.originSpacing.xy;
  let spacing = movingHillSupportParams.originSpacing.zw;
  let gridPosition = (position.xz - origin) / spacing;
  if (
    any(gridPosition < vec2<f32>(0.0))
    || gridPosition.x > f32(dimensions.x - 1u)
    || gridPosition.y > f32(dimensions.y - 1u)
  ) {
    return MovingHillSupportSample(
      vec4<f32>(-1000000.0, 0.0, 1.0, 0.0),
      vec4<f32>(0.0),
    );
  }
  let lower = vec2<u32>(floor(gridPosition));
  let upper = min(lower + vec2<u32>(1u), dimensions - vec2<u32>(1u));
  let blend = fract(gridPosition);
  let sample00 = movingHillSupportTexel(lower.x, lower.y);
  let sample10 = movingHillSupportTexel(upper.x, lower.y);
  let sample01 = movingHillSupportTexel(lower.x, upper.y);
  let sample11 = movingHillSupportTexel(upper.x, upper.y);
  let heightNormal0 = mix(sample00.heightNormal, sample10.heightNormal, blend.x);
  let heightNormal1 = mix(sample01.heightNormal, sample11.heightNormal, blend.x);
  let velocityValid0 = mix(sample00.supportVelocityValid, sample10.supportVelocityValid, blend.x);
  let velocityValid1 = mix(sample01.supportVelocityValid, sample11.supportVelocityValid, blend.x);
  var heightNormal = mix(heightNormal0, heightNormal1, blend.y);
  let velocityValid = mix(velocityValid0, velocityValid1, blend.y);
  heightNormal.yzw = normalize(heightNormal.yzw);
  return MovingHillSupportSample(heightNormal, velocityValid);
}

fn floorHeight(p: vec3<f32>) -> f32 {
  return movingHillSupportSample(p).heightNormal.x;
}

fn floorNormal(p: vec3<f32>) -> vec3<f32> {
  return movingHillSupportSample(p).heightNormal.yzw;
}

fn supportVelocityAt(position: vec3<f32>) -> vec3<f32> {
  return movingHillSupportSample(position).supportVelocityValid.xyz;
}

fn supportSignedDistanceFrame(position: vec3<f32>, radius: f32) -> vec4<f32> {
  let sample = movingHillSupportSample(position);
  let normal = sample.heightNormal.yzw;
  let valid = sample.supportVelocityValid.w;
  let signedDistance = select(
    1000000.0,
    (position.y - (sample.heightNormal.x + radius)) * normal.y,
    valid > 0.999,
  );
  return vec4<f32>(normal, signedDistance);
}

fn resolveSupportPenetration(inputPosition: vec3<f32>, radius: f32) -> vec3<f32> {
  let supportFrame = supportSignedDistanceFrame(inputPosition, radius);
  return select(
    inputPosition,
    inputPosition - supportFrame.xyz * supportFrame.w,
    supportFrame.w < 0.0,
  );
}

fn resolveSupportVelocity(inputVelocity: vec3<f32>, position: vec3<f32>, radius: f32) -> vec3<f32> {
  let supportFrame = supportSignedDistanceFrame(position, radius);
  let supportVelocity = supportVelocityAt(position);
  var relativeVelocity = inputVelocity - supportVelocity;
  if (supportFrame.w <= 0.01) {
    let normalSpeed = dot(relativeVelocity, supportFrame.xyz);
    if (normalSpeed < 0.0) {
      relativeVelocity = relativeVelocity - supportFrame.xyz * normalSpeed;
    }
  }
  return supportVelocity + relativeVelocity;
}

fn movingHillSupportContactFrame(position: vec3<f32>) -> vec4<f32> {
  let radius = params.fluid.x * 0.22;
  let supportFrame = supportSignedDistanceFrame(position, radius);
  let supportContact = 1.0 - smoothstep(0.012, 0.09, max(0.0, supportFrame.w));
  return vec4<f32>(supportFrame.xyz, supportContact);
}

fn supportContactFrame(position: vec3<f32>) -> vec4<f32> {
  return movingHillSupportContactFrame(position);
}
`;

function supportShaderSourceForRoute(route) {
  if (route === KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE) {
    return {
      bindings: ANALYTIC_SUPPORT_BINDINGS_WGSL,
      functions: ANALYTIC_SUPPORT_FUNCTIONS_WGSL,
    };
  }
  if (route === KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE) {
    return {
      bindings: MOVING_HILL_SUPPORT_BINDINGS_WGSL,
      functions: MOVING_HILL_SUPPORT_FUNCTIONS_WGSL,
    };
  }
  movingHillSupportFailure(`route is unsupported: ${route}`);
}

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
  sheet: vec4<f32>,
  sheetNeighborIds: vec4<u32>,
  sheetRestDistances: vec4<f32>,
  sheetDiagnosticClassification: vec4<f32>,
  sheetDiagnosticKinematics: vec4<f32>,
  sheetDiagnosticNeighborhood: vec4<f32>,
  refinement: vec4<f32>,
}

struct MaterialTracerState {
  concentrationDeltaRecipeSource: vec4<f32>,
  liveInletOriginGeneration: vec4<f32>,
  liveInletLimitsSource: vec4<f32>,
  liveInletAgeState: vec4<f32>,
  ownershipTransitionState: vec4<f32>,
}

struct LaminarInletSample {
  positionPhase: vec4<f32>,
  velocityCore: vec4<f32>,
  releaseSchedule: vec4<f32>,
}

struct LiveInletDescriptor {
  originRadius: vec4<f32>,
  axisSpeed: vec4<f32>,
  tangentActive: vec4<f32>,
  economics: vec4<f32>,
}

struct LiveInletPacket {
  inlets: array<LiveInletDescriptor, ${LIVE_HAND_INLET_CAPACITY}>,
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
  sheet: vec4<f32>,
  contactIdentity: vec4<u32>,
  sourceControl: vec4<u32>,
  refinementControl: vec4<u32>,
  liveInletControl: vec4<u32>,
}

const solverMaximumSpeed: f32 = ${KAMINOS_FINGER_FLUID_COMPUTE_MAX_SPEED_TOKEN};

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
@group(0) @binding(11) var<uniform> liveInletPacket: LiveInletPacket;
${KAMINOS_FINGER_FLUID_SUPPORT_BINDINGS_TOKEN}

${PLAYGROUND_WGSL}
${KAMINOS_FINGER_FLUID_SUPPORT_FUNCTIONS_TOKEN}

fn mark_particle_ownership_dormant(index: u32) {
  let sourceGeneration = materialTracers[index].ownershipTransitionState.y;
  materialTracers[index].ownershipTransitionState = vec4<f32>(0.0, sourceGeneration, 0.0, 0.0);
}

fn reset_particle_ownership_for_release(index: u32, liveInletScene: bool) {
  let sourceGeneration = select(
    f32(params.frameIndex + 1u),
    f32(params.liveInletControl.x),
    liveInletScene,
  );
  materialTracers[index].ownershipTransitionState = vec4<f32>(1.0, sourceGeneration, 0.0, 0.0);
}

fn transition_particle_ownership_on_support_contact(index: u32, supportContact: f32) {
  var state = materialTracers[index];
  if (state.ownershipTransitionState.x == 1.0 && supportContact >= 0.5) {
    state.ownershipTransitionState = vec4<f32>(
      2.0,
      state.ownershipTransitionState.y,
      f32(params.frameIndex),
      supportContact,
    );
    materialTracers[index] = state;
  }
}

fn merge_particle_ownership_state(parentState: vec4<f32>, childState: vec4<f32>) -> vec4<f32> {
  if (childState.x > parentState.x) { return childState; }
  if (parentState.x > childState.x) { return parentState; }
  if (parentState.x == 2.0) {
    if (childState.z < parentState.z) { return childState; }
    if (parentState.z < childState.z) { return parentState; }
  }
  if (childState.y > parentState.y) { return childState; }
  return parentState;
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
  if (params.particleShift.z > 1.5) { return 1u; }
  let allocationSlot = index % 10u;
  if (allocationSlot < 4u) { return 0u; }
  if (allocationSlot < 7u) { return 1u; }
  return 2u;
}

fn laminar_inlet_source_local_ordinal(index: u32) -> u32 {
  if (params.particleShift.z > 1.5) { return index; }
  let allocationSlot = index % 10u;
  let completeBlocks = index / 10u;
  if (allocationSlot < 4u) { return completeBlocks * 4u + allocationSlot; }
  if (allocationSlot < 7u) { return completeBlocks * 3u + allocationSlot - 4u; }
  return completeBlocks * 3u + allocationSlot - 7u;
}

fn laminar_inlet_source_particle_count(sourceIndex: u32) -> u32 {
  let baseParticleCount = params.refinementControl.x;
  if (params.particleShift.z > 1.5) { return select(0u, baseParticleCount, sourceIndex == 1u); }
  let completeBlocks = baseParticleCount / 10u;
  let remainder = baseParticleCount % 10u;
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
  if (sourceIndex == 1u) {
    if (params.particleShift.z > 1.5) {
      return max(1u, params.sourceControl.z * params.sourceControl.w);
    }
    return 60u;
  }
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
  if (sourceIndex == 1u && params.particleShift.z > 1.5) {
    columns = max(1u, params.sourceControl.z);
    rows = max(1u, params.sourceControl.w);
  }
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

fn slot_lane_speed_sum(columns: u32, rows: u32) -> f32 {
  var speedSum = 0.0;
  var row = 0u;
  loop {
    if (row >= rows) { break; }
    let localV = (((f32(row) + 0.5) / f32(rows)) * 2.0 - 1.0) * 0.13 * 0.88;
    speedSum += f32(columns) * laminar_inlet_profile_speed(1u, vec2<f32>(0.0, localV));
    row += 1u;
  }
  return speedSum;
}

fn laminar_inlet_release_phase(index: u32) -> vec4<f32> {
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
    let refinementFactor = max(1.0, params.particleShift.w);
    let columns = select(15u, max(1u, params.sourceControl.z), params.particleShift.z > 1.5);
    let rows = select(4u, max(1u, params.sourceControl.w), params.particleShift.z > 1.5);
    laneSpeedSum = slot_lane_speed_sum(columns, rows);
    expectedReleaseRate = 720.1081893313 * refinementFactor * refinementFactor * refinementFactor;
  } else if (sourceIndex == 2u) {
    laneSpeedSum = 38.72;
    expectedReleaseRate = 827.2396694215;
  }
  let laneReleaseRate = expectedReleaseRate * speed / max(laneSpeedSum, 0.000001);
  let lanePhaseEvents = (f32(laneIndex) + 0.5) / f32(laneCount);
  return vec4<f32>(f32(laneOrdinal), f32(laneParticleCount), laneReleaseRate, lanePhaseEvents);
}

fn laminar_inlet_release_due(frameIndex: u32, schedule: vec4<f32>) -> bool {
  let laneOrdinal = u32(schedule.x);
  let laneParticleCount = max(1u, u32(schedule.y));
  let laneReleaseRate = schedule.z;
  let lanePhaseEvents = schedule.w;
  let previousEventCount = u32(floor(f32(frameIndex) * laneReleaseRate / 60.0 + lanePhaseEvents));
  let nextEventCount = u32(floor(f32(frameIndex + 1u) * laneReleaseRate / 60.0 + lanePhaseEvents));
  return nextEventCount > previousEventCount
    && (nextEventCount - 1u) % laneParticleCount == laneOrdinal;
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
  let axialPosition = -reservoirLength + 0.0275 / max(1.0, params.particleShift.w);
  let releasePhase = laminar_inlet_release_phase(index);
  var sample: LaminarInletSample;
  sample.positionPhase = vec4<f32>(origin + tangent * localU + bitangent * localV + axis * axialPosition, phase);
  sample.velocityCore = vec4<f32>(axis * axialSpeed, 1.0);
  sample.releaseSchedule = releasePhase;
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

fn live_inlet_active_count() -> u32 {
  var count = 0u;
  for (var sourceIndex = 0u; sourceIndex < ${LIVE_HAND_INLET_CAPACITY}u; sourceIndex = sourceIndex + 1u) {
    let descriptor = liveInletPacket.inlets[sourceIndex];
    if (descriptor.tangentActive.w > 0.5 && descriptor.economics.y >= 0.5) { count = count + 1u; }
  }
  return count;
}

fn live_inlet_source_particle_count(sourceIndex: u32) -> u32 {
  let descriptor = liveInletPacket.inlets[sourceIndex];
  if (descriptor.tangentActive.w <= 0.5) { return 0u; }
  return u32(round(max(0.0, descriptor.economics.y)));
}

fn live_inlet_total_budget() -> u32 {
  var budget = 0u;
  for (var sourceIndex = 0u; sourceIndex < ${LIVE_HAND_INLET_CAPACITY}u; sourceIndex = sourceIndex + 1u) {
    budget = budget + live_inlet_source_particle_count(sourceIndex);
  }
  return min(params.refinementControl.x, budget);
}

fn live_inlet_particle_has_budget(index: u32) -> bool {
  return index < live_inlet_total_budget();
}

fn live_inlet_source_index(index: u32) -> u32 {
  var sourceStart = 0u;
  for (var sourceIndex = 0u; sourceIndex < ${LIVE_HAND_INLET_CAPACITY}u; sourceIndex = sourceIndex + 1u) {
    let sourceEnd = sourceStart + live_inlet_source_particle_count(sourceIndex);
    if (index >= sourceStart && index < sourceEnd) { return sourceIndex; }
    sourceStart = sourceEnd;
  }
  return 0u;
}

fn live_inlet_source_local_ordinal(index: u32, sourceIndex: u32) -> u32 {
  var sourceStart = 0u;
  for (var candidateIndex = 0u; candidateIndex < sourceIndex; candidateIndex = candidateIndex + 1u) {
    sourceStart = sourceStart + live_inlet_source_particle_count(candidateIndex);
  }
  return index - sourceStart;
}

fn live_inlet_source_from_phase(phase: f32) -> u32 {
  return min(${LIVE_HAND_INLET_CAPACITY - 1}u, u32(floor(clamp(abs(phase), 0.0, 0.999999) * ${LIVE_HAND_INLET_CAPACITY}.0)));
}

fn live_inlet_particle_is_current_generation(index: u32) -> bool {
  return u32(round(materialTracers[index].liveInletOriginGeneration.w)) == params.liveInletControl.x;
}

fn live_inlet_lane_count(sourceParticleCount: u32, descriptor: LiveInletDescriptor) -> u32 {
  let particleCrossSection = ${LAMINAR_SOURCE_AXIAL_SPACING ** 2};
  let apertureArea = 3.141592653589793 * descriptor.originRadius.w * descriptor.originRadius.w;
  let resolvedLaneCount = max(1u, u32(round(apertureArea / particleCrossSection)));
  return min(max(1u, sourceParticleCount), resolvedLaneCount);
}

fn live_inlet_lane_coordinates(descriptor: LiveInletDescriptor, laneIndex: u32, laneCount: u32) -> vec2<f32> {
  let radius = max(0.02, descriptor.originRadius.w);
  let radial = radius * 0.82 * sqrt((f32(laneIndex) + 0.5) / f32(max(1u, laneCount)));
  let angle = f32(laneIndex) * 2.39996322973;
  return vec2<f32>(cos(angle) * radial, sin(angle) * radial);
}

fn live_inlet_profile_weight(descriptor: LiveInletDescriptor, localCoordinates: vec2<f32>) -> f32 {
  let radius = max(0.02, descriptor.originRadius.w);
  let normalizedRadius = length(localCoordinates) / radius;
  return max(0.0, 1.0 - normalizedRadius * normalizedRadius);
}

fn live_inlet_release_phase(index: u32) -> vec4<f32> {
  let sourceIndex = live_inlet_source_index(index);
  let descriptor = liveInletPacket.inlets[sourceIndex];
  let localOrdinal = live_inlet_source_local_ordinal(index, sourceIndex);
  let sourceParticleCount = max(1u, live_inlet_source_particle_count(sourceIndex));
  let laneCount = live_inlet_lane_count(sourceParticleCount, descriptor);
  let laneIndex = localOrdinal % laneCount;
  let laneOrdinal = localOrdinal / laneCount;
  let laneParticleCount = (sourceParticleCount - 1u - laneIndex) / laneCount + 1u;
  let localCoordinates = live_inlet_lane_coordinates(descriptor, laneIndex, laneCount);
  let profileWeight = live_inlet_profile_weight(descriptor, localCoordinates);
  var laneSpeedSum = 0.0;
  for (var candidateLane = 0u; candidateLane < laneCount; candidateLane = candidateLane + 1u) {
    laneSpeedSum += live_inlet_profile_weight(
      descriptor,
      live_inlet_lane_coordinates(descriptor, candidateLane, laneCount),
    );
  }
  let expectedReleaseRate = max(0.0, descriptor.economics.x);
  let laneReleaseRate = expectedReleaseRate * profileWeight / max(laneSpeedSum, 0.000001);
  let lanePhaseEvents = (f32(laneIndex) + 0.5) / f32(laneCount);
  return vec4<f32>(f32(laneOrdinal), f32(laneParticleCount), laneReleaseRate, lanePhaseEvents);
}

fn live_inlet_release_due(frameIndex: u32, schedule: vec4<f32>) -> bool {
  let laneOrdinal = u32(schedule.x);
  let laneParticleCount = max(1u, u32(schedule.y));
  let laneReleaseRate = schedule.z;
  let lanePhaseEvents = schedule.w;
  let previousEventCount = u32(floor(f32(frameIndex) * laneReleaseRate / 60.0 + lanePhaseEvents));
  let nextEventCount = u32(floor(f32(frameIndex + 1u) * laneReleaseRate / 60.0 + lanePhaseEvents));
  if (nextEventCount <= previousEventCount) { return false; }
  let priorOrdinal = previousEventCount % laneParticleCount;
  let distanceToLane = (laneOrdinal + laneParticleCount - priorOrdinal) % laneParticleCount;
  return previousEventCount + distanceToLane < nextEventCount;
}

fn live_inlet_sample(index: u32) -> LaminarInletSample {
  let sourceIndex = live_inlet_source_index(index);
  let descriptor = liveInletPacket.inlets[sourceIndex];
  let localOrdinal = live_inlet_source_local_ordinal(index, sourceIndex);
  let sourceParticleCount = max(1u, live_inlet_source_particle_count(sourceIndex));
  let laneCount = live_inlet_lane_count(sourceParticleCount, descriptor);
  let laneIndex = localOrdinal % laneCount;
  let axis = normalize(descriptor.axisSpeed.xyz + vec3<f32>(0.000001, 0.000002, 0.000003));
  let tangent = normalize(descriptor.tangentActive.xyz + vec3<f32>(0.000003, 0.000001, 0.000002));
  let bitangent = normalize(cross(axis, tangent));
  let localCoordinates = live_inlet_lane_coordinates(descriptor, laneIndex, laneCount);
  let profileWeight = live_inlet_profile_weight(descriptor, localCoordinates);
  let axialPosition = -0.26 + ${LAMINAR_SOURCE_AXIAL_SPACING} * 0.5;
  var sample: LaminarInletSample;
  sample.positionPhase = vec4<f32>(
    descriptor.originRadius.xyz
      + tangent * localCoordinates.x
      + bitangent * localCoordinates.y
      + axis * axialPosition,
    (f32(sourceIndex) + 0.5) / ${LIVE_HAND_INLET_CAPACITY}.0,
  );
  sample.velocityCore = vec4<f32>(axis * descriptor.axisSpeed.w * profileWeight, descriptor.tangentActive.w);
  sample.releaseSchedule = live_inlet_release_phase(index);
  return sample;
}

fn apply_live_inlet_boundary(index: u32, position: vec3<f32>, phase: f32, velocity: vec3<f32>) -> vec4<f32> {
  if (!live_inlet_particle_is_current_generation(index)) { return vec4<f32>(velocity, 0.0); }
  let descriptor = liveInletPacket.inlets[live_inlet_source_from_phase(phase)];
  if (descriptor.tangentActive.w <= 0.5) { return vec4<f32>(velocity, 0.0); }
  let axis = normalize(descriptor.axisSpeed.xyz + vec3<f32>(0.000001, 0.000002, 0.000003));
  let tangent = normalize(descriptor.tangentActive.xyz + vec3<f32>(0.000003, 0.000001, 0.000002));
  let bitangent = normalize(cross(axis, tangent));
  let relative = position - descriptor.originRadius.xyz;
  let axialPosition = dot(relative, axis);
  let localU = dot(relative, tangent);
  let localV = dot(relative, bitangent);
  let radius = max(0.02, descriptor.originRadius.w);
  let normalizedRadius = length(vec2<f32>(localU, localV)) / radius;
  let insideCore = normalizedRadius <= 1.0 && axialPosition >= -0.28 && axialPosition <= 0.02;
  let inletCoreWeight = select(0.0, 1.0, insideCore);
  let profileWeight = max(0.0, 1.0 - normalizedRadius * normalizedRadius);
  let targetVelocity = axis * descriptor.axisSpeed.w * profileWeight;
  return vec4<f32>(mix(velocity, targetVelocity, inletCoreWeight), inletCoreWeight);
}

fn apply_active_inlet_boundary(index: u32, position: vec3<f32>, phase: f32, velocity: vec3<f32>) -> vec4<f32> {
  if (params.particleShift.z > 2.5) { return apply_live_inlet_boundary(index, position, phase, velocity); }
  return apply_laminar_inlet_boundary(position, phase, velocity);
}

fn constrain_live_inlet_reservoir(index: u32, position: vec3<f32>, phase: f32) -> vec3<f32> {
  if (!live_inlet_particle_is_current_generation(index)) { return position; }
  let descriptor = liveInletPacket.inlets[live_inlet_source_from_phase(phase)];
  if (descriptor.tangentActive.w <= 0.5) { return position; }
  let axis = normalize(descriptor.axisSpeed.xyz + vec3<f32>(0.000001, 0.000002, 0.000003));
  let tangent = normalize(descriptor.tangentActive.xyz + vec3<f32>(0.000003, 0.000001, 0.000002));
  let bitangent = normalize(cross(axis, tangent));
  let relative = position - descriptor.originRadius.xyz;
  let axialPosition = dot(relative, axis);
  if (axialPosition < -0.28 || axialPosition > 0.0) { return position; }
  var local = vec2<f32>(dot(relative, tangent), dot(relative, bitangent));
  let radialDistance = length(local);
  let confinedRadius = descriptor.originRadius.w * 0.98;
  if (radialDistance > confinedRadius) { local = local * (confinedRadius / radialDistance); }
  return descriptor.originRadius.xyz + axis * axialPosition + tangent * local.x + bitangent * local.y;
}

fn constrain_active_inlet_reservoir(index: u32, position: vec3<f32>, phase: f32) -> vec3<f32> {
  if (params.particleShift.z > 2.5) { return constrain_live_inlet_reservoir(index, position, phase); }
  return constrain_laminar_inlet_reservoir(position, phase);
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
  p = resolveSupportPenetration(p, radius);

  if (analyticObstacleSupportEnabled) {
    let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
    let sphereRadius = ${OBSTACLE_RADIUS} + radius;
    let fromSphere = p - sphereCenter;
    let sphereDistance = length(fromSphere);
    if (sphereDistance < sphereRadius) {
      p = sphereCenter + normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003)) * sphereRadius;
    }
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

fn adaptive_volume_scale(index: u32) -> f32 {
  return max(0.0, neighborTopology[index].refinement.x);
}

fn adaptive_radius_scale(index: u32) -> f32 {
  return pow(max(adaptive_volume_scale(index), 0.000001), 1.0 / 3.0);
}

fn adaptive_pair_kernel_weight(index: u32, neighborIndex: u32, distance: f32) -> f32 {
  let pairRadiusScale = max(adaptive_radius_scale(index), adaptive_radius_scale(neighborIndex));
  let supportRadius = params.fluid.x * pairRadiusScale;
  let q = distance / max(supportRadius, 0.00001);
  if (q >= 1.0) { return 0.0; }
  let x = 1.0 - q * q;
  let kernelNormalization = 1.0 / max(pairRadiusScale * pairRadiusScale * pairRadiusScale, 0.000001);
  let neighborVolumeScale = adaptive_volume_scale(neighborIndex);
  return neighborVolumeScale * kernelNormalization * x * x * x;
}

fn adaptive_pair_kernel_gradient(index: u32, neighborIndex: u32, offset: vec3<f32>) -> vec3<f32> {
  let distance = length(offset);
  let pairRadiusScale = max(adaptive_radius_scale(index), adaptive_radius_scale(neighborIndex));
  let supportRadius = params.fluid.x * pairRadiusScale;
  if (distance <= 0.00001 || distance >= supportRadius) { return vec3<f32>(0.0); }
  let q = distance / supportRadius;
  let kernelNormalization = 1.0 / max(pairRadiusScale * pairRadiusScale * pairRadiusScale, 0.000001);
  let neighborVolumeScale = adaptive_volume_scale(neighborIndex);
  let magnitude = -6.0 * (1.0 - q) * (1.0 - q) / (supportRadius * params.fluid.y);
  return offset / distance * magnitude * neighborVolumeScale * kernelNormalization;
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
  let terrainFrame = supportSignedDistanceFrame(position, particleRadius);
  let terrainNormal = terrainFrame.xyz;
  let terrainSignedDistance = terrainFrame.w;
  let terrainDistance = max(0.0, terrainSignedDistance);
  let terrainFraction = boundary_missing_fraction(terrainDistance);
  let terrainFractionGradient = terrainNormal * boundary_missing_fraction_derivative(terrainDistance);

  var sphereFraction = 0.0;
  var sphereFractionGradient = vec3<f32>(0.0);
  if (analyticObstacleSupportEnabled) {
    let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
    let fromSphere = position - sphereCenter;
    let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
    let sphereSignedDistance = length(fromSphere) - (${OBSTACLE_RADIUS} + particleRadius);
    let sphereDistance = max(0.0, sphereSignedDistance);
    sphereFraction = boundary_missing_fraction(sphereDistance);
    sphereFractionGradient = sphereNormal * boundary_missing_fraction_derivative(sphereDistance);
  }

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

fn clear_unsupported_sheet_state(index: u32) {
  neighborTopology[index].sheet = vec4<f32>(0.0);
  neighborTopology[index].sheetNeighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
  neighborTopology[index].sheetRestDistances = vec4<f32>(0.0);
}

fn measure_sheet_link_diagnostics(index: u32, position: vec3<f32>) -> vec4<f32> {
  let ids = neighborTopology[index].sheetNeighborIds;
  let restDistances = neighborTopology[index].sheetRestDistances;
  var persistentLinkCount = 0.0;
  var maximumStretch = 0.0;
  var maximumKernelRatio = 0.0;
  for (var slot = 0u; slot < 4u; slot = slot + 1u) {
    let neighborIndex = ids[slot];
    let restDistance = restDistances[slot];
    if (neighborIndex != ${INVALID_NEIGHBOR_ID}u && neighborIndex < params.particleCount && restDistance > 0.00001) {
      let distance = length(particles[neighborIndex].predicted.xyz - position);
      persistentLinkCount = persistentLinkCount + 1.0;
      maximumStretch = max(maximumStretch, distance / restDistance);
      maximumKernelRatio = max(maximumKernelRatio, distance / max(params.fluid.x, 0.00001));
    }
  }
  return vec4<f32>(persistentLinkCount, maximumStretch, maximumKernelRatio, 0.0);
}

fn write_sheet_release_diagnostics(
  index: u32,
  reasonCode: f32,
  priorActivity: f32,
  activity: f32,
  inletCoreWeight: f32,
  kinematics: vec4<f32>,
  neighborhood: vec3<f32>,
  linkDiagnostics: vec4<f32>,
  topology: vec4<f32>,
) {
  neighborTopology[index].sheetDiagnosticClassification = vec4<f32>(reasonCode, priorActivity, inletCoreWeight, linkDiagnostics.z);
  neighborTopology[index].sheetDiagnosticKinematics = kinematics;
  neighborTopology[index].sheetDiagnosticNeighborhood = vec4<f32>(neighborhood, linkDiagnostics.y);
}

fn supportNormalAt(position: vec3<f32>) -> vec3<f32> {
  let radius = params.fluid.x * 0.22;
  let terrainFrame = supportSignedDistanceFrame(position, radius);
  var supportNormal = terrainFrame.xyz;
  if (analyticObstacleSupportEnabled) {
    let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
    let fromSphere = position - sphereCenter;
    let sphereDistance = abs(length(fromSphere) - (${OBSTACLE_RADIUS} + radius));
    let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
    supportNormal = select(sphereNormal, terrainFrame.xyz, abs(terrainFrame.w) <= sphereDistance);
  }
  return supportNormal;
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
  if (params.refinementControl.y != 0u && index >= params.refinementControl.x && particle.velocity.w < 0.0) {
    particle.predicted = vec4<f32>(particle.position.xyz, 0.0);
    particle.delta = vec4<f32>(0.0);
    particles[index] = particle;
    return;
  }
  let laminarInletScene = params.particleShift.z > 0.5;
  let waterfallOracleScene = params.particleShift.z > 1.5 && params.particleShift.z < 2.5;
  let liveInletScene = params.particleShift.z > 2.5;
  _ = waterfallOracleScene;
  if (
    liveInletScene
    && particle.velocity.w >= 0.0
    && live_inlet_particle_has_budget(index)
    && !live_inlet_particle_is_current_generation(index)
  ) {
    let successorSample = live_inlet_sample(index);
    let successorReleaseDue = live_inlet_release_due(
      params.frameIndex - min(params.frameIndex, params.liveInletControl.y),
      successorSample.releaseSchedule,
    );
    if (successorReleaseDue) {
      atomicAdd(&interfaceCounters[9], 1u);
    }
  }
  if (laminarInletScene && particle.velocity.w < 0.0) {
    if (liveInletScene && (live_inlet_active_count() == 0u || !live_inlet_particle_has_budget(index))) {
      particle.predicted = vec4<f32>(particle.position.xyz, 0.0);
      particle.delta = vec4<f32>(0.0);
      particles[index] = particle;
      return;
    }
    if (!liveInletScene && params.sourceControl.y != 0u && params.frameIndex >= params.sourceControl.x) {
      particle.predicted = vec4<f32>(particle.position.xyz, 0.0);
      particle.delta = vec4<f32>(0.0);
      particles[index] = particle;
      return;
    }
    var inletSample: LaminarInletSample;
    if (liveInletScene) {
      inletSample = live_inlet_sample(index);
    } else {
      inletSample = laminar_inlet_sample(index);
    }
    let releaseDue = select(
      laminar_inlet_release_due(params.frameIndex, inletSample.releaseSchedule),
      live_inlet_release_due(
        params.frameIndex - min(params.frameIndex, params.liveInletControl.y),
        inletSample.releaseSchedule,
      ),
      liveInletScene,
    );
    if (!releaseDue) {
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
    particle.position = vec4<f32>(inletSample.positionPhase.xyz, select(1.0, 0.0, liveInletScene));
    particle.predicted = vec4<f32>(inletSample.positionPhase.xyz, 0.0);
    particle.velocity = vec4<f32>(inletSample.velocityCore.xyz, resetPhase);
    particle.delta = vec4<f32>(0.0);
    if (liveInletScene) {
      let liveSource = liveInletPacket.inlets[live_inlet_source_from_phase(resetPhase)];
      materialTracers[index].liveInletOriginGeneration = vec4<f32>(
        liveSource.originRadius.xyz,
        f32(params.liveInletControl.x),
      );
      materialTracers[index].liveInletLimitsSource = vec4<f32>(
        liveSource.economics.z,
        liveSource.economics.w,
        f32(live_inlet_source_from_phase(resetPhase)),
        1.0,
      );
      materialTracers[index].liveInletAgeState = vec4<f32>(0.0);
    }
    reset_particle_ownership_for_release(index, liveInletScene);
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    clear_unsupported_sheet_state(index);
    atomicAdd(&interfaceCounters[2], 1u);
  }
  let liveResidence = materialTracers[index];
  let liveAge = liveResidence.liveInletAgeState.x + params.dt;
  if (liveInletScene) { materialTracers[index].liveInletAgeState.x = liveAge; }
  let liveInletAgeExpired = liveInletScene && liveAge > liveResidence.liveInletLimitsSource.x;
  let liveInletDistanceExpired = liveInletScene
    && distance(particle.position.xyz, liveResidence.liveInletOriginGeneration.xyz)
      > liveResidence.liveInletLimitsSource.y;
  let recycleLiveInlet = liveInletAgeExpired || liveInletDistanceExpired;
  let recycleLaminarInlet = !liveInletScene && laminarInletScene && particle.velocity.w >= 0.0 && particle.position.z > 2.35;
  let recyclePlaygroundSource = !laminarInletScene && particle.velocity.w < 0.15 && particle.position.z > -0.15;
  if (recycleLiveInlet) {
    let currentGeneration = live_inlet_particle_is_current_generation(index);
    if (liveInletAgeExpired) {
      atomicAdd(&interfaceCounters[select(7u, 5u, currentGeneration)], 1u);
      materialTracers[index].liveInletLimitsSource.w = 2.0;
    } else {
      atomicAdd(&interfaceCounters[select(8u, 6u, currentGeneration)], 1u);
      materialTracers[index].liveInletLimitsSource.w = 3.0;
    }
    particle.velocity = vec4<f32>(vec3<f32>(0.0), -abs(particle.velocity.w));
    particle.predicted = vec4<f32>(particle.position.xyz, 0.0);
    particle.delta = vec4<f32>(0.0);
    particles[index] = particle;
    mark_particle_ownership_dormant(index);
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (recycleLaminarInlet) {
    particle.velocity = vec4<f32>(vec3<f32>(0.0), -abs(particle.velocity.w));
    particle.predicted = vec4<f32>(particle.position.xyz, 0.0);
    particle.delta = vec4<f32>(0.0);
    particles[index] = particle;
    mark_particle_ownership_dormant(index);
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    clear_unsupported_sheet_state(index);
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
    reset_particle_ownership_for_release(index, false);
    restStates[index] = vec4<f32>(0.0);
    neighborTopology[index].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
    neighborTopology[index].metrics = vec4<f32>(0.0);
    clear_unsupported_sheet_state(index);
    atomicAdd(&interfaceCounters[2], 1u);
    return;
  }
  var velocity = particle.velocity.xyz;
  var inletCoreWeight = 0.0;
  if (laminarInletScene) {
    let inletBoundary = apply_active_inlet_boundary(index, particle.position.xyz, particle.velocity.w, velocity);
    velocity = inletBoundary.xyz;
    inletCoreWeight = inletBoundary.w;
  }
  velocity.y = velocity.y + params.forces.x * params.dt * (1.0 - inletCoreWeight);
  particle.velocity = vec4<f32>(velocity, particle.velocity.w);
  var predictedPosition = collideDomain(particle.position.xyz + velocity * params.dt);
  if (laminarInletScene) {
    predictedPosition = constrain_active_inlet_reservoir(index, predictedPosition, particle.velocity.w);
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
    clear_unsupported_sheet_state(index);
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
            let chemistryWeight = adaptive_pair_kernel_weight(index, neighborIndex, distance);
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
  if (particles[index].velocity.w < 0.0 || adaptive_volume_scale(index) <= 0.0) {
    particles[index].predicted.w = 0.0;
    particles[index].delta.w = 0.0;
    return;
  }
  let position = particles[index].predicted.xyz;
  let baseCell = gridCoord(position);
  let selfRadiusScale = adaptive_radius_scale(index);
  var density = adaptive_volume_scale(index) / max(selfRadiusScale * selfRadiusScale * selfRadiusScale, 0.000001);
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
            let weight = adaptive_pair_kernel_weight(index, neighborIndex, distance);
            density = density + weight;
            let gradient = adaptive_pair_kernel_gradient(index, neighborIndex, offset);
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
  if (particles[index].velocity.w < 0.0 || adaptive_volume_scale(index) <= 0.0) { return; }
  let position = particles[index].predicted.xyz;
  let baseCell = gridCoord(position);
  let lambda = particles[index].predicted.w;
  let referenceWeight = max(
    adaptive_pair_kernel_weight(index, index, params.fluid.x * adaptive_radius_scale(index) * 0.34),
    0.0001,
  );
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
            let weight = adaptive_pair_kernel_weight(index, neighborIndex, length(offset));
            let tensile = -0.0012 * pow(weight / referenceWeight, 4.0);
            correction = correction + (lambda + particles[neighborIndex].predicted.w + tensile) * adaptive_pair_kernel_gradient(index, neighborIndex, offset);
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
    let inletCoreWeight = apply_active_inlet_boundary(index, particle.predicted.xyz, particle.velocity.w, particle.velocity.xyz).w;
    correction = correction * (1.0 - inletCoreWeight);
  }
  var correctedPosition = collideDomain(particle.predicted.xyz + correction);
  if (params.particleShift.z > 0.5) {
    correctedPosition = constrain_active_inlet_reservoir(index, correctedPosition, particle.velocity.w);
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
            let weight = adaptive_pair_kernel_weight(index, neighborIndex, distance);
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
            let weight = adaptive_pair_kernel_weight(
              index,
              neighborIndex,
              length(position - particles[neighborIndex].predicted.xyz),
            );
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
  let terrainVelocity = supportVelocityAt(position);
  velocity = resolveSupportVelocity(velocity, position, radius);
  if (analyticObstacleSupportEnabled) {
    let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
    let fromSphere = position - sphereCenter;
    let sphereDistance = length(fromSphere);
    if (sphereDistance <= ${OBSTACLE_RADIUS} + radius + 0.01) {
      let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
      let sphereNormalSpeed = dot(velocity, sphereNormal);
      if (sphereNormalSpeed < 0.0) { velocity = velocity - sphereNormal * sphereNormalSpeed; }
    }
  }
  let supportFrame = supportContactFrame(position);
  let supportContact = supportFrame.w;
  let supportNormal = supportFrame.xyz;
  transition_particle_ownership_on_support_contact(index, supportContact);
  let relativeSupportVelocity = velocity - terrainVelocity;
  let supportNormalSpeed = dot(relativeSupportVelocity, supportNormal);
  let supportTangentialVelocity = relativeSupportVelocity - supportNormal * supportNormalSpeed;
  let supportTangentialRetention = exp(-params.particleShift.y * supportContact * params.dt);
  let frictionVelocity = terrainVelocity
    + supportNormal * supportNormalSpeed
    + supportTangentialVelocity * supportTangentialRetention;
  velocity = mix(velocity, frictionVelocity, supportContact);
  if (params.particleShift.z > 0.5) {
    velocity = apply_active_inlet_boundary(index, position, particle.velocity.w, velocity).xyz;
  }
  if (position.x <= params.boundsMin.x + radius + 0.006 && velocity.x < 0.0) { velocity.x = 0.0; }
  if (position.x >= params.boundsMax.x - radius - 0.006 && velocity.x > 0.0) { velocity.x = 0.0; }
  if (position.z <= params.boundsMin.z + radius + 0.006 && velocity.z < 0.0) { velocity.z = 0.0; }
  if (position.z >= params.boundsMax.z - radius - 0.006 && velocity.z > 0.0) { velocity.z = 0.0; }
  let relaxedSpeed = length(velocity);
  if (relaxedSpeed > solverMaximumSpeed) { velocity = velocity * (solverMaximumSpeed / relaxedSpeed); }
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
            omega = omega + cross(velocityDifference, adaptive_pair_kernel_gradient(index, neighborIndex, offset));
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
            magnitudeGradient = magnitudeGradient
              + (neighborMagnitude - omegaMagnitude) * adaptive_pair_kernel_gradient(index, neighborIndex, offset);
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
    inletCoreWeight = apply_active_inlet_boundary(index, position, particle.velocity.w, particle.delta.xyz).w;
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
  if (speed > solverMaximumSpeed) { velocity = velocity * (solverMaximumSpeed / speed); }
  particles[index].delta = vec4<f32>(velocity, particle.delta.w);
  particles[index].position.w = min(omegaMagnitude, 4096.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn classify_unsupported_sheet(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let particle = particles[index];
  let priorSheetActivity = neighborTopology[index].sheet.w;
  let position = particle.predicted.xyz;
  let velocity = particle.delta.xyz;
  let speed = length(velocity);
  let supportContact = supportContactFrame(position).w;
  let densityRatio = particle.delta.w / max(params.fluid.y, 0.0001);
  let surfaceFactor = particle.predicted.w;
  let topology = neighborTopology[index].metrics;
  var linkDiagnostics = vec4<f32>(0.0);
  if (priorSheetActivity > 0.0001) {
    linkDiagnostics = measure_sheet_link_diagnostics(index, position);
  }
  let kinematics = vec4<f32>(speed, supportContact, densityRatio, surfaceFactor);
  let classificationStrength = select(
    params.sheet.x,
    max(2.0, params.sheet.x),
    params.refinementControl.y != 0u,
  );
  neighborTopology[index].sheet = vec4<f32>(0.0);
  if (particle.velocity.w < 0.0) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.dormant}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (classificationStrength <= 0.0 || params.particleShift.z <= 1.5) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.disabled}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (speed < 0.18) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.low_transport_speed}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (supportContact >= 0.20) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.support_contact}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (densityRatio < 0.10) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.density_loss}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (densityRatio > 1.05) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.bulk_density}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (surfaceFactor < 0.20) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.not_interface}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (topology.x < 0.25 || topology.y < 0.03) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.topology_loss}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }

  let flowTangent = velocity / speed;
  var seed = vec3<f32>(1.0, 0.0, 0.0);
  if (abs(flowTangent.x) >= 0.82) { seed = vec3<f32>(0.0, 0.0, 1.0); }
  let transverseU = normalize(cross(flowTangent, seed));
  let transverseV = normalize(cross(flowTangent, transverseU));
  let baseCell = gridCoord(position);
  var covarianceUU = 0.0;
  var covarianceUV = 0.0;
  var covarianceVV = 0.0;
  var velocityCoherenceSum = 0.0;
  var acceptedNeighborCount = 0u;

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          if (neighborIndex != index && particles[neighborIndex].velocity.w >= 0.0) {
            let offset = particles[neighborIndex].predicted.xyz - position;
            let distance = length(offset);
            if (distance > 0.00001 && distance < params.fluid.x) {
              let u = dot(offset, transverseU);
              let v = dot(offset, transverseV);
              covarianceUU = covarianceUU + u * u;
              covarianceUV = covarianceUV + u * v;
              covarianceVV = covarianceVV + v * v;
              let neighborVelocity = particles[neighborIndex].delta.xyz;
              let neighborSpeed = length(neighborVelocity);
              if (neighborSpeed > 0.0001) {
                velocityCoherenceSum = velocityCoherenceSum + clamp(dot(neighborVelocity / neighborSpeed, flowTangent), -1.0, 1.0);
              }
              acceptedNeighborCount = acceptedNeighborCount + 1u;
            }
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }
  if (acceptedNeighborCount < 3u) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.neighbor_loss}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(f32(acceptedNeighborCount), 0.0, 0.0), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  let neighborCount = f32(acceptedNeighborCount);
  let covarianceTrace = covarianceUU + covarianceVV;
  let covarianceDiscriminant = sqrt(max(0.0, (covarianceUU - covarianceVV) * (covarianceUU - covarianceVV) + 4.0 * covarianceUV * covarianceUV));
  let dominantVariance = (covarianceTrace + covarianceDiscriminant) * 0.5;
  let transverseAnisotropy = dominantVariance / max(covarianceTrace, 0.0000001);
  let velocityCoherence = velocityCoherenceSum / neighborCount;
  if (velocityCoherence < 0.72) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.velocity_incoherent}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(neighborCount, velocityCoherence, transverseAnisotropy), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (transverseAnisotropy < 0.66) {
    write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.not_planar}.0, priorSheetActivity, 0.0, 0.0, kinematics, vec3<f32>(neighborCount, velocityCoherence, transverseAnisotropy), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }

  var eigenvector = vec2<f32>(covarianceUV, dominantVariance - covarianceUU);
  if (length(eigenvector) < 0.000001) {
    eigenvector = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), covarianceUU >= covarianceVV);
  }
  eigenvector = normalize(eigenvector);
  let widthTangent = normalize(transverseU * eigenvector.x + transverseV * eigenvector.y);
  let sheetNormal = normalize(cross(flowTangent, widthTangent));
  let inletCoreWeight = apply_active_inlet_boundary(index, position, particle.velocity.w, velocity).w;
  let activity = clamp(
    classificationStrength
      * (1.0 - smoothstep(0.04, 0.20, supportContact))
      * smoothstep(0.10, 0.32, densityRatio)
      * (1.0 - smoothstep(0.90, 1.05, densityRatio))
      * smoothstep(0.20, 0.58, surfaceFactor)
      * smoothstep(0.25, 0.65, topology.x)
      * smoothstep(0.03, 0.22, topology.y)
      * smoothstep(0.72, 0.92, velocityCoherence)
      * smoothstep(0.66, 0.86, transverseAnisotropy)
      * smoothstep(2.0, 6.0, neighborCount)
      * (1.0 - inletCoreWeight),
    0.0,
    1.0,
  );
  if (activity <= 0.0001) {
    let reasonCode = select(
      ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.activity_floor}.0,
      ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.inlet_core}.0,
      inletCoreWeight >= 0.9999,
    );
    write_sheet_release_diagnostics(index, reasonCode, priorSheetActivity, 0.0, inletCoreWeight, kinematics, vec3<f32>(neighborCount, velocityCoherence, transverseAnisotropy), linkDiagnostics, topology);
    clear_unsupported_sheet_state(index);
    return;
  }
  if (priorSheetActivity <= 0.0001) {
    let links = neighborTopology[index].neighborIds;
    var restDistances = vec4<f32>(0.0);
    for (var slot = 0u; slot < 4u; slot = slot + 1u) {
      let neighborIndex = links[slot];
      if (neighborIndex != ${INVALID_NEIGHBOR_ID}u && neighborIndex < params.particleCount) {
        restDistances[slot] = length(particles[neighborIndex].predicted.xyz - position);
      }
    }
    neighborTopology[index].sheetNeighborIds = links;
    neighborTopology[index].sheetRestDistances = restDistances;
  }
  neighborTopology[index].sheet = vec4<f32>(sheetNormal, activity);
  let activeLinkDiagnostics = measure_sheet_link_diagnostics(index, position);
  write_sheet_release_diagnostics(index, ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.active}.0, priorSheetActivity, activity, inletCoreWeight, kinematics, vec3<f32>(neighborCount, velocityCoherence, transverseAnisotropy), activeLinkDiagnostics, topology);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn apply_unsupported_sheet_support(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  let sheetState = neighborTopology[index].sheet;
  let sheetActivity = sheetState.w;
  let particle = particles[index];
  if (sheetActivity <= 0.0001) {
    particles[index].position = vec4<f32>(vec3<f32>(0.0), particle.position.w);
    return;
  }
  let position = particle.predicted.xyz;
  let sheetNormal = sheetState.xyz;
  let sheetNeighborIds = neighborTopology[index].sheetNeighborIds;
  let sheetRestDistances = neighborTopology[index].sheetRestDistances;
  var tangentAttraction = vec3<f32>(0.0);
  var normalOffsetSum = 0.0;
  var normalWeight = 0.0;
  var coherentPairCount = 0u;

  for (var slot = 0u; slot < 4u; slot = slot + 1u) {
    let neighborIndex = sheetNeighborIds[slot];
    let restDistance = sheetRestDistances[slot];
    if (neighborIndex != ${INVALID_NEIGHBOR_ID}u && neighborIndex < params.particleCount && restDistance > 0.00001) {
      let neighborSheet = neighborTopology[neighborIndex].sheet;
      let offset = particles[neighborIndex].predicted.xyz - position;
      let distance = length(offset);
      let normalAlignment = abs(dot(sheetNormal, neighborSheet.xyz));
      if (distance > 0.00001 && distance < params.fluid.x * 1.75 && neighborSheet.w > 0.0001 && normalAlignment > 0.72) {
        let pairActivity = min(sheetActivity, neighborSheet.w) * smoothstep(0.72, 0.94, normalAlignment);
        let normalOffset = dot(offset, sheetNormal);
        let tangentOffset = offset - sheetNormal * normalOffset;
        let tangentDistance = length(tangentOffset);
        let stretch = max(0.0, tangentDistance - restDistance * 1.08);
        let bridgeRelease = 1.0 - smoothstep(1.55, 1.75, distance / params.fluid.x);
        if (tangentDistance > 0.00001 && stretch > 0.0) {
          tangentAttraction = tangentAttraction + tangentOffset / tangentDistance * stretch * bridgeRelease * pairActivity;
        }
        let thicknessWeight = bridgeRelease * pairActivity;
        normalOffsetSum = normalOffsetSum + normalOffset * thicknessWeight;
        normalWeight = normalWeight + thicknessWeight;
        coherentPairCount = coherentPairCount + 1u;
      }
    }
  }
  if (coherentPairCount < 2u || normalWeight <= 0.0001) {
    particles[index].position = vec4<f32>(vec3<f32>(0.0), particle.position.w);
    return;
  }
  let normalError = normalOffsetSum / normalWeight;
  let pairScale = 1.0 / f32(coherentPairCount);
  var correction = tangentAttraction * pairScale * (0.42 * params.sheet.x)
    + sheetNormal * normalError * (0.18 * sheetActivity);
  let correctionLimit = params.fluid.x * 0.055;
  let correctionLength = length(correction);
  if (correctionLength > correctionLimit) { correction = correction * (correctionLimit / correctionLength); }
  particles[index].position = vec4<f32>(correction, particle.position.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn commit_unsupported_sheet_support(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) { return; }
  var particle = particles[index];
  let correction = particle.position.xyz;
  let correctionLength = length(correction);
  if (correctionLength > 0.0000001) {
    let sheetState = neighborTopology[index].sheet;
    var velocity = particle.delta.xyz + correction / max(params.dt, 0.00001);
    let normalSpeed = dot(velocity, sheetState.xyz);
    velocity = velocity - sheetState.xyz * normalSpeed * min(0.18, sheetState.w * params.sheet.x * 0.12);
    let speed = length(velocity);
    if (speed > solverMaximumSpeed) { velocity = velocity * (solverMaximumSpeed / speed); }
    particle.predicted = vec4<f32>(particle.predicted.xyz + correction, particle.predicted.w);
    particle.delta = vec4<f32>(velocity, particle.delta.w);
    particles[index] = particle;
  }
}

fn capillary_pair_weight(
  neighborIndex: u32,
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
  return adaptive_volume_scale(neighborIndex)
    * cohesionBand
    * (0.15 + 0.85 * pairSurface)
    * pairSupportConfidence;
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
                neighborIndex,
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
    inletCoreWeight = apply_active_inlet_boundary(index, position, particle.velocity.w, particle.delta.xyz).w;
  }
  let cohesionActivity = (1.0 - restStates[index].z * 0.72) * (1.0 - supportTransportWeight * 0.62) * (1.0 - inletCoreWeight);
  var cohesionAcceleration = attraction * (0.12 * params.chemistry.y) * cohesionActivity;
  let cohesionLength = length(cohesionAcceleration);
  if (cohesionLength > 0.42) { cohesionAcceleration = cohesionAcceleration * (0.42 / cohesionLength); }
  var velocity = particle.delta.xyz + cohesionAcceleration * params.dt;
  let radius = params.fluid.x * 0.22;
  let terrainFrame = supportSignedDistanceFrame(position, radius);
  let terrainVelocity = supportVelocityAt(position);
  if (terrainFrame.w <= 0.01) {
    let relativeVelocity = velocity - terrainVelocity;
    let normalSpeed = dot(relativeVelocity, terrainFrame.xyz);
    if (normalSpeed < 0.0) {
      velocity = terrainVelocity + relativeVelocity - terrainFrame.xyz * normalSpeed;
    }
  }
  if (analyticObstacleSupportEnabled) {
    let sphereCenter = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
    let fromSphere = position - sphereCenter;
    if (length(fromSphere) <= ${OBSTACLE_RADIUS} + radius + 0.01) {
      let sphereNormal = normalize(fromSphere + vec3<f32>(0.00001, 0.00002, 0.00003));
      let sphereNormalSpeed = dot(velocity, sphereNormal);
      if (sphereNormalSpeed < 0.0) { velocity = velocity - sphereNormal * sphereNormalSpeed; }
    }
  }
  if (params.particleShift.z > 0.5) {
    velocity = apply_active_inlet_boundary(index, position, particle.velocity.w, velocity).xyz;
  }
  let speed = length(velocity);
  if (speed > solverMaximumSpeed) { velocity = velocity * (solverMaximumSpeed / speed); }
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
fn adaptive_refine_or_merge(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (params.refinementControl.y == 0u || index >= params.refinementControl.x) { return; }
  let childIndex = index + params.refinementControl.x;
  if (childIndex >= params.particleCount) { return; }
  var parent = particles[index];
  var child = particles[childIndex];
  var parentRefinement = neighborTopology[index].refinement;
  let childActive = child.velocity.w >= 0.0 && neighborTopology[childIndex].refinement.x > 0.0;

  if (parent.velocity.w < 0.0) {
    parentRefinement = vec4<f32>(1.0, 0.0, 0.0, 0.0);
    neighborTopology[index].refinement = parentRefinement;
    mark_particle_ownership_dormant(index);
    if (childActive) {
      child.velocity = vec4<f32>(vec3<f32>(0.0), -abs(child.velocity.w));
      child.delta = vec4<f32>(0.0);
      particles[childIndex] = child;
      mark_particle_ownership_dormant(childIndex);
      neighborTopology[childIndex].refinement = vec4<f32>(0.0, 2.0, 0.0, -1.0);
      atomicAdd(&interfaceCounters[4], 1u);
    }
    return;
  }

  if (parentRefinement.y < 0.5) {
    let sheetState = neighborTopology[index].sheet;
    let reasonCode = neighborTopology[index].sheetDiagnosticClassification.x;
    let supportContact = supportContactFrame(parent.position.xyz).w;
    let speed = length(parent.velocity.xyz);
    let splitCandidate = sheetState.w >= 0.08
      && reasonCode == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.active}.0
      && supportContact < 0.18
      && speed >= 0.18
      && !childActive;
    if (!splitCandidate) { return; }
    let flowTangent = normalize(parent.velocity.xyz + vec3<f32>(0.00001, 0.00002, 0.00003));
    var splitDirection = cross(sheetState.xyz, flowTangent);
    if (length(splitDirection) < 0.0001) {
      splitDirection = cross(sheetState.xyz, vec3<f32>(1.0, 0.0, 0.0));
    }
    splitDirection = normalize(splitDirection + vec3<f32>(0.00001, 0.00002, 0.00003));
    let splitOffset = splitDirection * params.fluid.x * 0.16;
    parent.position = vec4<f32>(collideDomain(parent.position.xyz - splitOffset), parent.position.w);
    parent.predicted = vec4<f32>(parent.position.xyz, parent.predicted.w);
    child = parent;
    child.position = vec4<f32>(collideDomain(parent.position.xyz + splitOffset * 2.0), parent.position.w);
    child.predicted = vec4<f32>(child.position.xyz, parent.predicted.w);
    particles[index] = parent;
    particles[childIndex] = child;
    restStates[childIndex] = restStates[index];
    materialTracers[childIndex] = materialTracers[index];
    neighborTopology[childIndex] = neighborTopology[index];
    neighborTopology[index].refinement = vec4<f32>(0.5, 1.0, 0.0, 1.0);
    neighborTopology[childIndex].refinement = vec4<f32>(0.5, 2.0, 0.0, 1.0);
    atomicAdd(&interfaceCounters[3], 1u);
    return;
  }

  if (!childActive) {
    neighborTopology[index].refinement = vec4<f32>(1.0, 0.0, 0.0, -1.0);
    return;
  }
  let parentSupport = supportContactFrame(parent.position.xyz).w;
  let childSupport = supportContactFrame(child.position.xyz).w;
  let pairDistance = length(parent.position.xyz - child.position.xyz);
  let parentDensityRatio = parent.delta.w / max(params.fluid.y, 0.0001);
  let childDensityRatio = child.delta.w / max(params.fluid.y, 0.0001);
  let stableContact = max(parentSupport, childSupport) >= 0.62;
  let stableBulk = min(parentDensityRatio, childDensityRatio) >= 0.94
    && max(length(parent.velocity.xyz), length(child.velocity.xyz)) < 0.34;
  let mergeCandidate = pairDistance < params.fluid.x * 0.72
    && max(neighborTopology[index].sheet.w, neighborTopology[childIndex].sheet.w) < 0.02
    && (stableContact || stableBulk);
  let mergeAge = select(0.0, parentRefinement.z + params.dt, mergeCandidate);
  neighborTopology[index].refinement.z = mergeAge;
  neighborTopology[childIndex].refinement.z = mergeAge;
  if (mergeAge < 0.32) { return; }

  let parentVolume = max(parentRefinement.x, 0.0);
  let childVolume = max(neighborTopology[childIndex].refinement.x, 0.0);
  let totalVolume = max(parentVolume + childVolume, 0.000001);
  let mergedPosition = (parent.position.xyz * parentVolume + child.position.xyz * childVolume) / totalVolume;
  let mergedVelocity = (parent.velocity.xyz * parentVolume + child.velocity.xyz * childVolume) / totalVolume;
  let parentTracer = materialTracers[index].concentrationDeltaRecipeSource;
  let childTracer = materialTracers[childIndex].concentrationDeltaRecipeSource;
  let mergedTracer = (parentTracer * parentVolume + childTracer * childVolume) / totalVolume;
  let mergedOwnership = merge_particle_ownership_state(
    materialTracers[index].ownershipTransitionState,
    materialTracers[childIndex].ownershipTransitionState,
  );
  parent.position = vec4<f32>(mergedPosition, parent.position.w);
  parent.predicted = vec4<f32>(mergedPosition, max(parent.predicted.w, child.predicted.w));
  parent.velocity = vec4<f32>(mergedVelocity, parent.velocity.w);
  parent.delta = vec4<f32>(mergedVelocity, max(parent.delta.w, child.delta.w));
  child.velocity = vec4<f32>(vec3<f32>(0.0), -abs(child.velocity.w));
  child.predicted = vec4<f32>(child.position.xyz, 0.0);
  child.delta = vec4<f32>(0.0);
  particles[index] = parent;
  particles[childIndex] = child;
  materialTracers[index].concentrationDeltaRecipeSource = mergedTracer;
  materialTracers[index].ownershipTransitionState = mergedOwnership;
  materialTracers[childIndex].concentrationDeltaRecipeSource = vec4<f32>(0.0);
  materialTracers[childIndex].ownershipTransitionState = vec4<f32>(0.0);
  restStates[index] = (restStates[index] * parentVolume + restStates[childIndex] * childVolume) / totalVolume;
  restStates[childIndex] = vec4<f32>(0.0);
  neighborTopology[index].refinement = vec4<f32>(1.0, 0.0, 0.0, -1.0);
  neighborTopology[childIndex].neighborIds = vec4<u32>(${INVALID_NEIGHBOR_ID}u);
  neighborTopology[childIndex].metrics = vec4<f32>(0.0);
  clear_unsupported_sheet_state(childIndex);
  neighborTopology[childIndex].sheetDiagnosticClassification = vec4<f32>(${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.dormant}.0, 0.0, 0.0, 0.0);
  neighborTopology[childIndex].sheetDiagnosticKinematics = vec4<f32>(0.0);
  neighborTopology[childIndex].sheetDiagnosticNeighborhood = vec4<f32>(0.0);
  neighborTopology[childIndex].refinement = vec4<f32>(0.0, 2.0, 0.0, -1.0);
  atomicAdd(&interfaceCounters[4], 1u);
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
            let weight = adaptive_pair_kernel_weight(index, neighborIndex, distance);
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

fn estimate_interface_curvature(index: u32, position: vec3<f32>, interfaceNormal: vec3<f32>) -> vec2<f32> {
  let baseCell = gridCoord(position);
  var weightedNormalOffset = 0.0;
  var weightedTangentSpan = 0.0;
  var interfaceWeight = 0.0;
  var interfaceNeighborCount = 0u;

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let neighborCell = baseCell + vec3<i32>(x, y, z);
        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }
        var current = atomicLoad(&cellHeads[cellIndex(neighborCell)]);
        while (current >= 0) {
          let neighborIndex = u32(current);
          let offset = position - particles[neighborIndex].position.xyz;
          let distance = length(offset);
          let neighborConfidence = restStates[neighborIndex].x;
          let weight = adaptive_pair_kernel_weight(index, neighborIndex, distance) * neighborConfidence;
          if (distance > 0.00001 && weight > 0.0 && neighborConfidence >= ${INTERFACE_THRESHOLD}) {
            let normalOffset = dot(offset, interfaceNormal);
            let tangentOffset = offset - interfaceNormal * dot(offset, interfaceNormal);
            weightedNormalOffset = weightedNormalOffset + normalOffset * weight;
            weightedTangentSpan = weightedTangentSpan + dot(tangentOffset, tangentOffset) * weight;
            interfaceWeight = interfaceWeight + weight;
            interfaceNeighborCount = interfaceNeighborCount + 1u;
          }
          current = particleNext[neighborIndex];
        }
      }
    }
  }
  if (interfaceNeighborCount < 4u || weightedTangentSpan <= 0.000001 || interfaceWeight <= 0.000001) {
    return vec2<f32>(0.0);
  }
  let meanTangentSpanSquared = weightedTangentSpan / interfaceWeight;
  let countConfidence = smoothstep(3.0, 8.0, f32(interfaceNeighborCount));
  let minimumSpan = params.fluid.x * 0.08;
  let resolvedSpan = params.fluid.x * 0.2;
  let spanConfidence = smoothstep(minimumSpan * minimumSpan, resolvedSpan * resolvedSpan, meanTangentSpanSquared);
  let resolutionConfidence = countConfidence * spanConfidence;
  let rawCurvature = 2.0 * weightedNormalOffset / weightedTangentSpan;
  let maximumResolvableCurvature = 2.0 / params.fluid.x;
  if (resolutionConfidence < 0.2 || abs(rawCurvature) > maximumResolvableCurvature) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(rawCurvature, resolutionConfidence);
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
            let weight = adaptive_pair_kernel_weight(index, neighborIndex, distance);
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

  let supportFrame = supportContactFrame(position);
  let contact = supportFrame.w;
  let contactSupportNormal = supportFrame.xyz;
  let fallbackNormal = select(vec3<f32>(0.0, 1.0, 0.0), contactSupportNormal, contact > 0.5);
  var interfaceNormal = select(fallbackNormal, normalize(directionalSupport), length(directionalSupport) > 0.0001);
  if (contact > 0.5 && dot(interfaceNormal, contactSupportNormal) < 0.0) {
    interfaceNormal = -interfaceNormal;
  }
  let supportAlignment = select(1.0, dot(interfaceNormal, contactSupportNormal), contact > 0.5);
  let interfaceAge = restStates[index].y;
  if (surfaceFactor < ${INTERFACE_THRESHOLD}) { return; }
  let curvatureGeometry = estimate_interface_curvature(index, position, interfaceNormal);
  let interfaceCurvature = curvatureGeometry.x;
  let geometryConfidence = surfaceFactor * curvatureGeometry.y;

  let slot = atomicAdd(&interfaceCounters[0], 1u);
  if (slot >= params.particleCount) {
    atomicAdd(&interfaceCounters[1], 1u);
    return;
  }
  let speed = length(particle.velocity.xyz);
  let thickness = params.fluid.x * clamp(supportWeight / max(params.fluid.y, 0.0001), 0.18, 2.5);
  interfaceRecords[slot].positionId = vec4<f32>(position, f32(index));
  interfaceRecords[slot].velocityConfidence = vec4<f32>(particle.velocity.xyz, geometryConfidence);
  interfaceRecords[slot].normalCurvature = vec4<f32>(interfaceNormal, interfaceCurvature);
  interfaceRecords[slot].thicknessContactWetnessMaterial = vec4<f32>(thickness, contact, surfaceFactor, particle.velocity.w);
  interfaceRecords[slot].stabilityAgeSource = vec4<f32>(1.0 - clamp(speed / ${KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE}, 0.0, 1.0), interfaceAge, f32(params.frameIndex), supportAlignment);
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
  sheet: vec4<f32>,
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
  sheet: vec4<f32>,
  sheetNeighborIds: vec4<u32>,
  sheetRestDistances: vec4<f32>,
  sheetDiagnosticClassification: vec4<f32>,
  sheetDiagnosticKinematics: vec4<f32>,
  sheetDiagnosticNeighborhood: vec4<f32>,
  refinement: vec4<f32>,
}

struct MaterialTracerState {
  concentrationDeltaRecipeSource: vec4<f32>,
  liveInletOriginGeneration: vec4<f32>,
  liveInletLimitsSource: vec4<f32>,
  liveInletAgeState: vec4<f32>,
  ownershipTransitionState: vec4<f32>,
}

struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraPosition: vec4<f32>,
  viewport: vec4<f32>,
  opticalModes: vec4<f32>,
  analyticCarrierControls: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(2) var<storage, read> neighborTopology: array<NeighborTopologyState>;
@group(0) @binding(3) var<storage, read> materialTracers: array<MaterialTracerState>;

${PLAYGROUND_WGSL}

fn sheet_release_reason_color(reasonCode: f32) -> vec3<f32> {
  let reason = u32(round(reasonCode));
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.active}u) { return vec3<f32>(0.12, 0.95, 0.52); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.disabled}u) { return vec3<f32>(0.20, 0.22, 0.26); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.dormant}u) { return vec3<f32>(0.08, 0.08, 0.10); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.low_transport_speed}u) { return vec3<f32>(0.26, 0.52, 0.96); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.support_contact}u) { return vec3<f32>(0.58, 0.58, 0.62); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.density_loss}u) { return vec3<f32>(0.08, 0.76, 1.00); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.bulk_density}u) { return vec3<f32>(0.12, 0.28, 0.82); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.not_interface}u) { return vec3<f32>(0.68, 0.50, 0.22); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.topology_loss}u) { return vec3<f32>(1.00, 0.44, 0.08); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.neighbor_loss}u) { return vec3<f32>(1.00, 0.10, 0.58); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.velocity_incoherent}u) { return vec3<f32>(0.94, 0.12, 0.12); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.not_planar}u) { return vec3<f32>(0.68, 0.20, 1.00); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.inlet_core}u) { return vec3<f32>(0.12, 0.94, 0.96); }
  if (reason == ${KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.activity_floor}u) { return vec3<f32>(1.00, 0.86, 0.12); }
  return vec3<f32>(1.0, 1.0, 1.0);
}

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
    let volumeRadiusScale = pow(max(neighborTopology[instanceIndex].refinement.x, 0.000001), 1.0 / 3.0);
    radius = params.viewport.z * volumeRadiusScale * (0.88 + clamp(particle.delta.w / 16.0, 0.0, 0.42));
    phase = abs(particle.velocity.w);
    base = mix(cold, warm, smoothstep(0.0, 0.62, phase));
    if (colorMode == 1u) {
      let hash = fract(sin(f32(instanceIndex) * 12.9898) * 43758.5453);
      base = 0.42 + 0.48 * cos(vec3<f32>(0.0, 2.094, 4.188) + hash * 6.28318);
      phase = 0.0;
    } else if (colorMode == 2u) {
      let value = clamp(speed / ${KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE}, 0.0, 1.0);
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
    } else if (colorMode == 7u) {
      base = sheet_release_reason_color(neighborTopology[instanceIndex].sheetDiagnosticClassification.x);
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
  let opticalDebugMode = u32(params.cameraUp.w + 0.5);
  if (opticalDebugMode == 16u) { return vec4<f32>(1.0); }
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

const HDR_ENVIRONMENT_SAMPLING_WGSL = /* wgsl */`
fn decodeRgbe(encoded: vec4<f32>) -> vec3<f32> {
  let bytes = floor(encoded * 255.0 + vec4<f32>(0.5));
  if (bytes.a < 1.0) { return vec3<f32>(0.0); }
  return bytes.rgb * exp2(bytes.a - 136.0);
}

fn loadEnvironmentTexel(pixel: vec2<i32>) -> vec3<f32> {
  let dims = vec2<i32>(textureDimensions(hdrEnvironmentTexture));
  let wrappedX = ((pixel.x % dims.x) + dims.x) % dims.x;
  let safePixel = vec2<i32>(wrappedX, clamp(pixel.y, 0, dims.y - 1));
  return decodeRgbe(textureLoad(hdrEnvironmentTexture, safePixel, 0));
}

fn sampleEnvironment(rayDirection: vec3<f32>) -> vec3<f32> {
  let direction = normalize(rayDirection);
  let longitude = atan2(direction.z, direction.x);
  let uv = vec2<f32>(fract(0.5 + longitude / (2.0 * 3.14159265)), acos(clamp(direction.y, -1.0, 1.0)) / 3.14159265);
  let dims = vec2<f32>(textureDimensions(hdrEnvironmentTexture));
  let texelPosition = uv * dims - vec2<f32>(0.5);
  let base = vec2<i32>(floor(texelPosition));
  let blend = fract(texelPosition);
  let top = mix(loadEnvironmentTexel(base), loadEnvironmentTexel(base + vec2<i32>(1, 0)), blend.x);
  let bottom = mix(loadEnvironmentTexel(base + vec2<i32>(0, 1)), loadEnvironmentTexel(base + vec2<i32>(1, 1)), blend.x);
  return mix(top, bottom, blend.y) * 0.72;
}

fn sampleEnvironmentFiltered(rayDirection: vec3<f32>, roughness: f32) -> vec3<f32> {
  let direction = normalize(rayDirection);
  let helperAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(direction.y) > 0.92);
  let tangent = normalize(cross(helperAxis, direction));
  let bitangent = normalize(cross(direction, tangent));
  let coneRadius = 0.015 + clamp(roughness * roughness, 0.0, 1.0) * 0.36;
  return sampleEnvironment(direction) * 0.40
    + sampleEnvironment(normalize(direction + tangent * coneRadius)) * 0.15
    + sampleEnvironment(normalize(direction - tangent * coneRadius)) * 0.15
    + sampleEnvironment(normalize(direction + bitangent * coneRadius)) * 0.15
    + sampleEnvironment(normalize(direction - bitangent * coneRadius)) * 0.15;
}
`;

const HDR_WORLD_BACKGROUND_SHADER = /* wgsl */`
struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraPosition: vec4<f32>,
  viewport: vec4<f32>,
  opticalModes: vec4<f32>,
  analyticCarrierControls: vec4<f32>,
}

@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(12) var hdrEnvironmentTexture: texture_2d<f32>;

${HDR_ENVIRONMENT_SAMPLING_WGSL}

@vertex
fn vs_hdr_world_background(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs_hdr_world_background(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let normalized = fragmentPosition.xy / params.viewport.xy;
  let ndc = normalized * 2.0 - vec2<f32>(1.0);
  let aspect = params.viewport.x / max(params.viewport.y, 1.0);
  let tanHalfFov = tan(0.5 * 3.14159265 / 3.15);
  let cameraRay = normalize(
    params.cameraForward.xyz
      + params.cameraRight.xyz * ndc.x * aspect * tanHalfFov
      - params.cameraUp.xyz * ndc.y * tanHalfFov
  );
  return vec4<f32>(sampleEnvironment(cameraRay), 1.0);
}
`;

const FINAL_PRESENTATION_SHADER = /* wgsl */`
struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraPosition: vec4<f32>,
  viewport: vec4<f32>,
  opticalModes: vec4<f32>,
  analyticCarrierControls: vec4<f32>,
}

@group(0) @binding(0) var linearSceneRadiance: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(2) var presentationSurfaceAccumulation: texture_2d<f32>;
@group(0) @binding(3) var presentationSupportFrontDepth: texture_2d<f32>;
@group(0) @binding(4) var presentationCompositeDepth: texture_depth_2d;

fn toneMapAces(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + vec3<f32>(b))) / (color * (c * color + vec3<f32>(d)) + vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn viewDepthToNdc(viewDepth: f32) -> f32 {
  let near = 0.08;
  let far = 30.0;
  return far / (far - near) - (near * far) / ((far - near) * max(viewDepth, near));
}

@vertex
fn vs_final_presentation(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs_final_presentation(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let source = textureLoad(linearSceneRadiance, vec2<i32>(fragmentPosition.xy), 0);
  let opticalDebugMode = i32(round(params.cameraUp.w));
  let linearRadiance = max(source.rgb, vec3<f32>(0.0));
  let exposure = ${LINEAR_SCENE_EXPOSURE};
  let displayColor = toneMapAces(linearRadiance * exposure);
  if (opticalDebugMode == 16) { return source; }
  let liquidSample = textureLoad(presentationSurfaceAccumulation, vec2<i32>(fragmentPosition.xy), 0);
  let liquidResident = liquidSample.z >= 0.018 && liquidSample.x >= 0.012;
  let supportOrderingDepth = textureLoad(presentationSupportFrontDepth, vec2<i32>(fragmentPosition.xy), 0).y;
  let presentedDepth = textureLoad(presentationCompositeDepth, vec2<i32>(fragmentPosition.xy), 0);
  let expectedLiquidDepth = viewDepthToNdc(supportOrderingDepth + 0.003);
  let liquidVisible = liquidResident && abs(presentedDepth - expectedLiquidDepth) < 0.00002;
  let diagnosticQuantity = opticalDebugMode != 0
    && opticalDebugMode != 12
    && opticalDebugMode != 15
    && opticalDebugMode != 17;
  let diagnosticColor = clamp(linearRadiance, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(select(displayColor, diagnosticColor, diagnosticQuantity && liquidVisible), source.a);
}
`;

const ANALYTIC_SUPPORT_PRESENTATION_SHADER = /* wgsl */`
struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraPosition: vec4<f32>,
  viewport: vec4<f32>,
  opticalModes: vec4<f32>,
  analyticCarrierControls: vec4<f32>,
}

@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(12) var hdrEnvironmentTexture: texture_2d<f32>;

${HDR_ENVIRONMENT_SAMPLING_WGSL}

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
  @location(3) viewDepth: f32,
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
  output.viewDepth = max(0.001, output.position.w);
  return output;
}

fn worldGrid(worldPosition: vec3<f32>, cellsPerWorldUnit: f32) -> f32 {
  let coordinate = worldPosition.xz * cellsPerWorldUnit;
  let derivative = max(fwidth(coordinate), vec2<f32>(0.0001));
  let distanceToLine = abs(fract(coordinate - 0.5) - 0.5) / derivative;
  return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
}

struct DeferredSceneOutput {
  @location(0) color: vec4<f32>,
  @location(1) worldNormalRoughness: vec4<f32>,
  @location(2) albedoMetallic: vec4<f32>,
  @location(3) linearDepthObject: vec4<f32>,
}

@fragment
fn fs_analytic_support_presentation(input: AnalyticSupportVertexOutput) -> DeferredSceneOutput {
  let normal = normalize(input.worldNormal);
  let viewDirection = normalize(params.cameraPosition.xyz - input.worldPosition);
  let roughness = select(0.82, 0.36, input.supportKind > 0.5);
  let metallic = select(0.0, 0.58, input.supportKind > 0.5);
  let baseColor = select(vec3<f32>(0.20, 0.23, 0.215), vec3<f32>(0.48, 0.34, 0.14), input.supportKind > 0.5);
  let diffuseEnvironment = sampleEnvironment(normal) * 0.16;
  let reflectionDirection = reflect(-viewDirection, normal);
  let specularEnvironment = sampleEnvironmentFiltered(reflectionDirection, roughness);
  let ndv = clamp(dot(normal, viewDirection), 0.0, 1.0);
  let f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  let fresnel = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - ndv, 5.0);
  let terrainBase = baseColor * (vec3<f32>(0.62) + diffuseEnvironment) + specularEnvironment * fresnel * (1.0 - roughness * 0.72);
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

  let obstacleColor = terrainBase;
  let color = select(terrainColor, obstacleColor, input.supportKind > 0.5);
  let objectId = select(1.0, 2.0, input.supportKind > 0.5);
  var output: DeferredSceneOutput;
  output.color = vec4<f32>(color, 1.0);
  output.worldNormalRoughness = vec4<f32>(normal, roughness);
  output.albedoMetallic = vec4<f32>(color, metallic);
  output.linearDepthObject = vec4<f32>(input.viewDepth, objectId, input.supportKind, 1.0);
  return output;
}
`;

const DYNAMIC_INDEXED_MESH_SHADER = /* wgsl */`
struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraPosition: vec4<f32>,
  viewport: vec4<f32>,
  opticalModes: vec4<f32>,
  analyticCarrierControls: vec4<f32>,
}

struct SceneParams {
  model: mat4x4<f32>,
  normalTransform: mat4x4<f32>,
  albedoRoughness: vec4<f32>,
  identityMetallicPhase: vec4<f32>,
}

@group(0) @binding(0) var<uniform> scene: SceneParams;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(12) var hdrEnvironmentTexture: texture_2d<f32>;

${HDR_ENVIRONMENT_SAMPLING_WGSL}

struct DynamicMeshVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) viewDepth: f32,
}

@vertex
fn vs_dynamic_indexed_mesh(
  @location(0) localPosition: vec4<f32>,
  @location(1) localNormal: vec4<f32>,
) -> DynamicMeshVertexOutput {
  let worldPosition = scene.model * localPosition;
  let clipPosition = params.viewProjection * worldPosition;
  var output: DynamicMeshVertexOutput;
  output.position = clipPosition;
  output.worldPosition = worldPosition.xyz;
  output.worldNormal = normalize((scene.normalTransform * localNormal).xyz);
  output.viewDepth = max(0.001, clipPosition.w);
  return output;
}

struct DeferredSceneOutput {
  @location(0) color: vec4<f32>,
  @location(1) worldNormalRoughness: vec4<f32>,
  @location(2) albedoMetallic: vec4<f32>,
  @location(3) linearDepthObject: vec4<f32>,
}

@fragment
fn fs_dynamic_indexed_mesh(input: DynamicMeshVertexOutput) -> DeferredSceneOutput {
  let normal = normalize(input.worldNormal);
  let viewDirection = normalize(params.cameraPosition.xyz - input.worldPosition);
  let roughness = scene.albedoRoughness.w;
  let metallic = scene.identityMetallicPhase.y;
  let diffuseEnvironment = sampleEnvironment(normal) * 0.17;
  let reflectionDirection = reflect(-viewDirection, normal);
  let specularEnvironment = sampleEnvironmentFiltered(reflectionDirection, roughness);
  let ndv = clamp(dot(normal, viewDirection), 0.0, 1.0);
  let f0 = mix(vec3<f32>(0.04), scene.albedoRoughness.rgb, metallic);
  let fresnel = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - ndv, 5.0);
  let color = scene.albedoRoughness.rgb * (vec3<f32>(0.07) + diffuseEnvironment) * (1.0 - metallic)
    + specularEnvironment * fresnel * (1.0 - roughness * 0.64);
  var output: DeferredSceneOutput;
  output.color = vec4<f32>(color, 1.0);
  output.worldNormalRoughness = vec4<f32>(normal, scene.albedoRoughness.w);
  output.albedoMetallic = vec4<f32>(scene.albedoRoughness.rgb, scene.identityMetallicPhase.y);
  output.linearDepthObject = vec4<f32>(input.viewDepth, scene.identityMetallicPhase.x, scene.identityMetallicPhase.z, 1.0);
  return output;
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
  sheet: vec4<f32>,
  sheetNeighborIds: vec4<u32>,
  sheetRestDistances: vec4<f32>,
  sheetDiagnosticClassification: vec4<f32>,
  sheetDiagnosticKinematics: vec4<f32>,
  sheetDiagnosticNeighborhood: vec4<f32>,
  refinement: vec4<f32>,
}

struct MaterialTracerState {
  concentrationDeltaRecipeSource: vec4<f32>,
  liveInletOriginGeneration: vec4<f32>,
  liveInletLimitsSource: vec4<f32>,
  liveInletAgeState: vec4<f32>,
  ownershipTransitionState: vec4<f32>,
}

struct RenderParams {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraPosition: vec4<f32>,
  viewport: vec4<f32>,
  opticalModes: vec4<f32>,
  analyticCarrierControls: vec4<f32>,
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
@group(0) @binding(9) var<storage, read> reflectionMeshPositions: array<vec4<f32>>;
@group(0) @binding(10) var<storage, read> reflectionMeshIndices: array<u32>;

struct SceneParams {
  model: mat4x4<f32>,
  normalTransform: mat4x4<f32>,
  albedoRoughness: vec4<f32>,
  identityMetallicPhase: vec4<f32>,
}

@group(0) @binding(11) var<uniform> reflectionScene: SceneParams;
@group(0) @binding(12) var hdrEnvironmentTexture: texture_2d<f32>;
@group(0) @binding(13) var deferredLinearDepthObject: texture_2d<f32>;
@group(0) @binding(14) var deferredWorldNormalRoughness: texture_2d<f32>;
@group(0) @binding(15) var deferredAlbedoMetallic: texture_2d<f32>;

const REFLECTION_HIT_ENVIRONMENT = 0u;
const REFLECTION_HIT_ANALYTIC = 1u;
const REFLECTION_HIT_INDEXED_MESH = 2u;
const REFLECTION_HIT_DEFERRED_SCENE = 3u;
const REFLECTION_HIT_NONE = 4u;
const OPTICAL_PROVIDER_ENVIRONMENT = 0u;
const OPTICAL_PROVIDER_WORLD = 1u;
const OPTICAL_PROVIDER_DEFERRED = 2u;
const OPTICAL_PROVIDER_NONE = 3u;

struct AccumVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) viewDepth: f32,
  @location(2) surface: f32,
  @location(3) speed: f32,
  @location(4) tracer: f32,
  @location(5) radius: f32,
  @location(6) capsuleHalfLengthRatio: f32,
  @location(7) quadratureWeight: f32,
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
  let volumeRadiusScale = pow(max(neighborTopology[instanceIndex].refinement.x, 0.000001), 1.0 / 3.0);
  let radius = params.viewport.z * volumeRadiusScale * mix(1.22, 1.78, surface) * densityRadius;
  let analyticCapsuleSupport =
    materialTracers[instanceIndex].liveInletAgeState.w > 0.5;
  let tangentMagnitude = length(particle.predicted.xyz);
  var carrierTangent = params.cameraRight.xyz;
  if (analyticCapsuleSupport && tangentMagnitude > 0.000001) {
    carrierTangent = particle.predicted.xyz / tangentMagnitude;
  }
  let tangentScreen = vec2<f32>(
    dot(carrierTangent, params.cameraRight.xyz),
    dot(carrierTangent, params.cameraUp.xyz)
  );
  let projectedTangentMagnitude = length(tangentScreen);
  var projectedTangentAxis = vec2<f32>(1.0, 0.0);
  if (projectedTangentMagnitude > 0.000001) {
    projectedTangentAxis = tangentScreen / projectedTangentMagnitude;
  }
  let projectedTangentWorld =
    params.cameraRight.xyz * projectedTangentAxis.x
    + params.cameraUp.xyz * projectedTangentAxis.y;
  let projectedTangentPerpendicular =
    params.cameraRight.xyz * -projectedTangentAxis.y
    + params.cameraUp.xyz * projectedTangentAxis.x;
  var segmentBackwardLength = 0.0;
  var segmentForwardLength = 0.0;
  var quadratureWeight = 1.0;
  if (analyticCapsuleSupport) {
    segmentBackwardLength = max(0.0, neighborTopology[instanceIndex].refinement.y) * radius;
    segmentForwardLength = max(0.0, neighborTopology[instanceIndex].refinement.z) * radius;
    quadratureWeight = clamp(neighborTopology[instanceIndex].refinement.w, 0.000001, 1.0);
  }
  let segmentCenterOffset = (segmentForwardLength - segmentBackwardLength) * 0.5;
  let segmentHalfLength = (segmentBackwardLength + segmentForwardLength) * 0.5;
  let projectedHalfLength = segmentHalfLength * projectedTangentMagnitude;
  let segmentCenter = particle.position.xyz + carrierTangent * segmentCenterOffset;
  let worldPosition =
    segmentCenter
    + carrierTangent * segmentHalfLength * corner.x
    + projectedTangentWorld * radius * corner.x
    + projectedTangentPerpendicular * radius * corner.y;
  var clip = params.viewProjection * vec4<f32>(worldPosition, 1.0);
  let analyticCarrierEnabled = params.analyticCarrierControls.x > 0.5;
  let matchingAnalyticCarrierSource =
    abs(materialTracers[instanceIndex].liveInletLimitsSource.z - params.analyticCarrierControls.y) < 0.25;
  let matchingAnalyticCarrierGeneration =
    abs(materialTracers[instanceIndex].liveInletOriginGeneration.w - params.analyticCarrierControls.w) < 0.25;
  let preImpactParticle =
    materialTracers[instanceIndex].liveInletAgeState.x < params.analyticCarrierControls.z;
  if (
    particle.velocity.w < 0.0
    || (
      analyticCarrierEnabled
      && matchingAnalyticCarrierSource
      && matchingAnalyticCarrierGeneration
      && preImpactParticle
    )
  ) {
    clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  var output: AccumVertexOutput;
  output.position = clip;
  output.uv = vec2<f32>(
    corner.x * (projectedHalfLength / max(radius, 0.000001) + 1.0),
    corner.y
  );
  output.viewDepth = max(0.001, clip.w);
  output.surface = surface;
  output.speed = length(particle.velocity.xyz);
  output.tracer = materialTracers[instanceIndex].concentrationDeltaRecipeSource.x;
  output.radius = radius;
  output.capsuleHalfLengthRatio = projectedHalfLength / max(radius, 0.000001);
  output.quadratureWeight = quadratureWeight;
  return output;
}

struct AccumFragmentOutput {
  @location(0) accumulation: vec4<f32>,
  @location(1) frontDepth: vec4<f32>,
  @location(2) backDepth: vec4<f32>,
}

@fragment
fn fs_accumulate(input: AccumVertexOutput) -> AccumFragmentOutput {
  let capsuleDistance = vec2<f32>(
    max(abs(input.uv.x) - input.capsuleHalfLengthRatio, 0.0),
    input.uv.y
  );
  let r2 = dot(capsuleDistance, capsuleDistance);
  if (r2 > 1.0) { discard; }
  let cap = sqrt(max(0.0, 1.0 - r2));
  let edge = smoothstep(1.0, 0.46, r2);
  let surfaceWeight = mix(0.55, 1.0, input.surface);
  let thickness = edge * surfaceWeight * (0.35 + cap * 1.85) * input.quadratureWeight;
  let opticalThickness = thickness * (0.55 + 0.45 * smoothstep(0.0, ${KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE}, input.speed));
  let depthWeight = edge * surfaceWeight * input.quadratureWeight;
  let supportSafeViewDepth = input.viewDepth;
  let frontSurfaceViewDepth = max(0.001, input.viewDepth - cap * input.radius);
  var output: AccumFragmentOutput;
  output.accumulation = vec4<f32>(opticalThickness, input.tracer * opticalThickness, depthWeight, supportSafeViewDepth * depthWeight);
  output.frontDepth = vec4<f32>(frontSurfaceViewDepth, supportSafeViewDepth, frontSurfaceViewDepth, frontSurfaceViewDepth);
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

fn readSupportOrderingDepth(pixel: vec2<i32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(opticalSlabFrontDepth));
  return textureLoad(opticalSlabFrontDepth, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0).y;
}

fn readBackDepth(pixel: vec2<i32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(opticalSlabBackDepth));
  return textureLoad(opticalSlabBackDepth, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0).x;
}

struct ReflectionHit {
  distance: f32,
  normal: vec3<f32>,
  kind: u32,
  position: vec3<f32>,
}

fn reconstructWorldPosition(pixel: vec2<i32>, viewDepth: f32) -> vec3<f32> {
  let dims = vec2<f32>(textureDimensions(surfaceAccumulation));
  var ndc = (vec2<f32>(pixel) + vec2<f32>(0.5)) / dims * 2.0 - vec2<f32>(1.0);
  ndc.y = -ndc.y;
  let tanHalfFov = tan(0.5 * 3.14159265 / 3.15);
  let aspect = dims.x / max(dims.y, 1.0);
  return params.cameraPosition.xyz
    + params.cameraForward.xyz * viewDepth
    + params.cameraRight.xyz * ndc.x * viewDepth * tanHalfFov * aspect
    + params.cameraUp.xyz * ndc.y * viewDepth * tanHalfFov;
}

fn worldSurfaceNormal(viewNormal: vec3<f32>) -> vec3<f32> {
  let worldNormal = normalize(
    params.cameraRight.xyz * viewNormal.x
    + params.cameraUp.xyz * viewNormal.y
    - params.cameraForward.xyz * viewNormal.z
  );
  return worldNormal;
}

fn viewDirectionToWorld(viewDirection: vec3<f32>) -> vec3<f32> {
  return normalize(
    params.cameraRight.xyz * viewDirection.x
    + params.cameraUp.xyz * viewDirection.y
    - params.cameraForward.xyz * viewDirection.z
  );
}

struct DeferredSceneHit {
  valid: f32,
  distance: f32,
  uv: vec2<f32>,
  position: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  roughness: f32,
  metallic: f32,
  objectId: f32,
  confidence: f32,
}

fn projectWorldToDeferred(worldPosition: vec3<f32>) -> vec4<f32> {
  let clip = params.viewProjection * vec4<f32>(worldPosition, 1.0);
  if (clip.w <= 0.001) { return vec4<f32>(-1.0); }
  let ndc = clip.xy / clip.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, -ndc.y * 0.5 + 0.5);
  return vec4<f32>(uv, clip.w, 1.0);
}

fn traceDeferredScene(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> DeferredSceneHit {
  var hit: DeferredSceneHit;
  hit.valid = 0.0;
  hit.distance = 60.0;
  hit.uv = vec2<f32>(-1.0);
  hit.position = rayOrigin + rayDirection * hit.distance;
  hit.normal = vec3<f32>(0.0, 1.0, 0.0);
  hit.albedo = vec3<f32>(0.0);
  hit.roughness = 1.0;
  hit.metallic = 0.0;
  hit.objectId = 0.0;
  hit.confidence = 0.0;
  let dims = vec2<i32>(textureDimensions(deferredLinearDepthObject));
  let dimsFloat = vec2<f32>(dims);
  var distance = 0.055;
  for (var stepIndex = 0u; stepIndex < 24u; stepIndex = stepIndex + 1u) {
    let samplePosition = rayOrigin + rayDirection * distance;
    let projected = projectWorldToDeferred(samplePosition);
    if (projected.w < 0.5 || any(projected.xy <= vec2<f32>(0.001)) || any(projected.xy >= vec2<f32>(0.999))) {
      distance = distance + 0.05 + distance * 0.105;
      continue;
    }
    let scenePixel = clamp(vec2<i32>(projected.xy * dimsFloat), vec2<i32>(0), dims - vec2<i32>(1));
    let depthObject = textureLoad(deferredLinearDepthObject, scenePixel, 0);
    let sceneDepth = depthObject.x;
    let objectId = depthObject.y;
    let depthDelta = projected.z - sceneDepth;
    let crossingTolerance = 0.028 + distance * 0.012;
    if (depthObject.w > 0.5 && sceneDepth < 29.5 && depthDelta >= -crossingTolerance && depthDelta <= 0.18 + distance * 0.02) {
      let normalRoughness = textureLoad(deferredWorldNormalRoughness, scenePixel, 0);
      let albedoMetallic = textureLoad(deferredAlbedoMetallic, scenePixel, 0);
      hit.valid = 1.0;
      hit.uv = projected.xy;
      hit.position = reconstructWorldPosition(scenePixel, sceneDepth);
      hit.distance = length(hit.position - rayOrigin);
      hit.normal = normalize(normalRoughness.xyz);
      hit.albedo = albedoMetallic.rgb;
      hit.roughness = normalRoughness.w;
      hit.metallic = albedoMetallic.w;
      hit.objectId = objectId;
      hit.confidence = 1.0 - smoothstep(0.0, 0.22, abs(depthDelta));
      return hit;
    }
    distance = distance + 0.05 + distance * 0.105;
  }
  return hit;
}

fn intersectTriangle(
  rayOrigin: vec3<f32>,
  rayDirection: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  c: vec3<f32>,
) -> vec4<f32> {
  let edge1 = b - a;
  let edge2 = c - a;
  let p = cross(rayDirection, edge2);
  let determinant = dot(edge1, p);
  if (abs(determinant) < 0.00001) { return vec4<f32>(-1.0); }
  let inverseDeterminant = 1.0 / determinant;
  let t = rayOrigin - a;
  let u = dot(t, p) * inverseDeterminant;
  if (u < 0.0 || u > 1.0) { return vec4<f32>(-1.0); }
  let q = cross(t, edge1);
  let v = dot(rayDirection, q) * inverseDeterminant;
  if (v < 0.0 || u + v > 1.0) { return vec4<f32>(-1.0); }
  let distance = dot(edge2, q) * inverseDeterminant;
  if (distance <= 0.012) { return vec4<f32>(-1.0); }
  var normal = normalize(cross(edge1, edge2));
  normal = select(normal, -normal, dot(normal, rayDirection) > 0.0);
  return vec4<f32>(normal, distance);
}

fn traceIndexedMesh(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, current: ReflectionHit) -> ReflectionHit {
  var hit = current;
  for (var triangleIndex = 0u; triangleIndex < ${DYNAMIC_REFLECTION_MESH_TRIANGLE_COUNT}u; triangleIndex = triangleIndex + 1u) {
    let indexOffset = triangleIndex * 3u;
    let a = (reflectionScene.model * reflectionMeshPositions[reflectionMeshIndices[indexOffset]]).xyz;
    let b = (reflectionScene.model * reflectionMeshPositions[reflectionMeshIndices[indexOffset + 1u]]).xyz;
    let c = (reflectionScene.model * reflectionMeshPositions[reflectionMeshIndices[indexOffset + 2u]]).xyz;
    let candidate = intersectTriangle(rayOrigin, rayDirection, a, b, c);
    if (candidate.w > 0.0 && candidate.w < hit.distance) {
      hit.distance = candidate.w;
      hit.normal = candidate.xyz;
      hit.kind = REFLECTION_HIT_INDEXED_MESH;
      hit.position = rayOrigin + rayDirection * candidate.w;
    }
  }
  return hit;
}

fn traceAnalyticSphere(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, current: ReflectionHit) -> ReflectionHit {
  var hit = current;
  let center = vec3<f32>(${OBSTACLE_CENTER[0]}, ${OBSTACLE_CENTER[1]}, ${OBSTACLE_CENTER[2]});
  let offset = rayOrigin - center;
  let halfB = dot(offset, rayDirection);
  let discriminant = halfB * halfB - (dot(offset, offset) - ${OBSTACLE_RADIUS * OBSTACLE_RADIUS});
  if (discriminant > 0.0) {
    let distance = -halfB - sqrt(discriminant);
    if (distance > 0.012 && distance < hit.distance) {
      hit.distance = distance;
      hit.position = rayOrigin + rayDirection * distance;
      hit.normal = normalize(hit.position - center);
      hit.kind = REFLECTION_HIT_ANALYTIC;
    }
  }
  return hit;
}

fn traceClosestSurface(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> ReflectionHit {
  var hit: ReflectionHit;
  hit.distance = 60.0;
  hit.normal = vec3<f32>(0.0, 1.0, 0.0);
  hit.kind = REFLECTION_HIT_ENVIRONMENT;
  hit.position = rayOrigin + rayDirection * hit.distance;
  hit = traceIndexedMesh(rayOrigin, rayDirection, hit);
  hit = traceAnalyticSphere(rayOrigin, rayDirection, hit);
  return hit;
}

${HDR_ENVIRONMENT_SAMPLING_WGSL}

fn integrateParticipatingRadiance(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, tMax: f32) -> vec3<f32> {
  _ = rayOrigin;
  _ = rayDirection;
  _ = tMax;
  return vec3<f32>(0.0);
}

fn shadeSurfaceHit(hit: ReflectionHit, outgoingRay: vec3<f32>) -> vec3<f32> {
  if (hit.kind == REFLECTION_HIT_ENVIRONMENT) { return sampleEnvironment(outgoingRay); }
  let lightDirection = normalize(vec3<f32>(-0.38, 0.82, 0.43));
  let diffuse = max(dot(hit.normal, lightDirection), 0.0);
  let edge = pow(1.0 - max(dot(hit.normal, -outgoingRay), 0.0), 3.0);
  if (hit.kind == REFLECTION_HIT_INDEXED_MESH) {
    let stripe = 0.5 + 0.5 * cos((hit.position.y + hit.position.x * 0.35) * 18.0 + reflectionScene.identityMetallicPhase.z * 2.0);
    let base = mix(reflectionScene.albedoRoughness.rgb, vec3<f32>(1.0, 0.46, 0.08), stripe * 0.48);
    return base * (0.24 + diffuse * 0.96) + vec3<f32>(0.24, 0.66, 1.0) * edge * 0.72;
  }
  return vec3<f32>(0.54, 0.32, 0.08) * (0.26 + diffuse * 0.88) + vec3<f32>(0.92, 0.68, 0.28) * edge * 0.35;
}

struct ReflectionSample {
  radiance: vec3<f32>,
  environmentRadiance: vec3<f32>,
}

struct OpticalQuerySample {
  radiance: vec3<f32>,
  environmentRadiance: vec3<f32>,
  distance: f32,
  hitKind: u32,
  providerKind: u32,
  position: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  roughness: f32,
  metallic: f32,
  objectId: f32,
  confidence: f32,
}

fn makeNoOpticalQuerySample() -> OpticalQuerySample {
  var sample: OpticalQuerySample;
  sample.radiance = vec3<f32>(0.0);
  sample.environmentRadiance = vec3<f32>(0.0);
  sample.distance = 0.0;
  sample.hitKind = REFLECTION_HIT_NONE;
  sample.providerKind = OPTICAL_PROVIDER_NONE;
  sample.position = vec3<f32>(0.0);
  sample.normal = vec3<f32>(0.0, 1.0, 0.0);
  sample.albedo = vec3<f32>(0.0);
  sample.roughness = 1.0;
  sample.metallic = 0.0;
  sample.objectId = 0.0;
  sample.confidence = 0.0;
  return sample;
}

struct ReflectionQuadrature {
  radiance: vec3<f32>,
  environmentRadiance: vec3<f32>,
}

fn sampleWorldOpticalQuery(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> OpticalQuerySample {
  let hit = traceClosestSurface(rayOrigin, rayDirection);
  let surfaceRadiance = shadeSurfaceHit(hit, rayDirection);
  var sample: OpticalQuerySample;
  sample.radiance = surfaceRadiance + integrateParticipatingRadiance(rayOrigin, rayDirection, hit.distance);
  sample.environmentRadiance = select(vec3<f32>(0.0), surfaceRadiance, hit.kind == REFLECTION_HIT_ENVIRONMENT);
  sample.distance = hit.distance;
  sample.hitKind = hit.kind;
  sample.providerKind = select(OPTICAL_PROVIDER_WORLD, OPTICAL_PROVIDER_ENVIRONMENT, hit.kind == REFLECTION_HIT_ENVIRONMENT);
  sample.position = hit.position;
  sample.normal = hit.normal;
  sample.albedo = select(vec3<f32>(0.54, 0.32, 0.08), reflectionScene.albedoRoughness.rgb, hit.kind == REFLECTION_HIT_INDEXED_MESH);
  sample.roughness = select(0.42, reflectionScene.albedoRoughness.w, hit.kind == REFLECTION_HIT_INDEXED_MESH);
  sample.metallic = select(0.0, reflectionScene.identityMetallicPhase.y, hit.kind == REFLECTION_HIT_INDEXED_MESH);
  sample.objectId = select(2.0, reflectionScene.identityMetallicPhase.x, hit.kind == REFLECTION_HIT_INDEXED_MESH);
  sample.confidence = 1.0;
  return sample;
}

fn sampleHybridOpticalQuery(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> OpticalQuerySample {
  let deferredHit = traceDeferredScene(rayOrigin, rayDirection);
  if (deferredHit.valid > 0.5 && deferredHit.confidence >= 0.55) {
    var sample: OpticalQuerySample;
    sample.radiance = textureSampleLevel(refractionSceneColor, refractionSceneSampler, deferredHit.uv, 0.0).rgb
      + integrateParticipatingRadiance(rayOrigin, rayDirection, deferredHit.distance);
    sample.environmentRadiance = vec3<f32>(0.0);
    sample.distance = deferredHit.distance;
    sample.hitKind = REFLECTION_HIT_DEFERRED_SCENE;
    sample.providerKind = OPTICAL_PROVIDER_DEFERRED;
    sample.position = deferredHit.position;
    sample.normal = deferredHit.normal;
    sample.albedo = deferredHit.albedo;
    sample.roughness = deferredHit.roughness;
    sample.metallic = deferredHit.metallic;
    sample.objectId = deferredHit.objectId;
    sample.confidence = deferredHit.confidence;
    return sample;
  }
  return sampleWorldOpticalQuery(rayOrigin, rayDirection);
}

fn integrateTransmissionQuadrature(
  rayOrigin: vec3<f32>,
  centerDirection: vec3<f32>,
  center: OpticalQuerySample,
  coneRadius: f32,
  transmissionFootprintMode: i32,
) -> vec3<f32> {
  if (transmissionFootprintMode == 0) {
    return center.radiance;
  }
  let helperAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(centerDirection.y) > 0.92);
  let tangent = normalize(cross(helperAxis, centerDirection));
  let bitangent = normalize(cross(centerDirection, tangent));
  var samples: array<OpticalQuerySample, 5>;
  samples[0] = center;
  samples[1] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection + tangent * coneRadius));
  samples[2] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection - tangent * coneRadius));
  samples[3] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection + bitangent * coneRadius));
  samples[4] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection - bitangent * coneRadius));
  var minimumIndex = 0;
  var maximumIndex = 0;
  var minimumLuminance = dot(samples[0].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
  var maximumLuminance = minimumLuminance;
  var radianceSum = vec3<f32>(0.0);
  for (var sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
    let sampleLuminance = dot(samples[sampleIndex].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
    if (sampleLuminance < minimumLuminance) {
      minimumLuminance = sampleLuminance;
      minimumIndex = sampleIndex;
    }
    if (sampleLuminance > maximumLuminance) {
      maximumLuminance = sampleLuminance;
      maximumIndex = sampleIndex;
    }
    radianceSum += samples[sampleIndex].radiance;
  }
  if (maximumIndex == minimumIndex) {
    maximumIndex = select(0, 1, minimumIndex == 0);
  }
  return (radianceSum - samples[minimumIndex].radiance - samples[maximumIndex].radiance) / 3.0;
}

fn reflectionSampleFromOpticalQuery(query: OpticalQuerySample) -> ReflectionSample {
  var sample: ReflectionSample;
  sample.radiance = query.radiance;
  sample.environmentRadiance = query.environmentRadiance;
  return sample;
}

fn sampleWorldReflection(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> ReflectionSample {
  return reflectionSampleFromOpticalQuery(sampleWorldOpticalQuery(rayOrigin, rayDirection));
}

fn integrateWorldReflectionQuadrature(
  worldPosition: vec3<f32>,
  cameraRay: vec3<f32>,
  worldNormal: vec3<f32>,
  coneRadius: f32,
  opticalFootprintMode: i32,
) -> ReflectionQuadrature {
  let centerDirection = normalize(reflect(cameraRay, worldNormal));
  let helperAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(centerDirection.y) > 0.92);
  let tangent = normalize(cross(helperAxis, centerDirection));
  let bitangent = normalize(cross(centerDirection, tangent));
  let rayOrigin = worldPosition + worldNormal * 0.026;
  let center = reflectionSampleFromOpticalQuery(sampleHybridOpticalQuery(rayOrigin, centerDirection));
  let tangentPositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + tangent * coneRadius));
  let tangentNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + tangent * -coneRadius));
  let bitangentPositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + bitangent * coneRadius));
  let bitangentNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + bitangent * -coneRadius));
  var quadrature: ReflectionQuadrature;
  if (opticalFootprintMode == 0) {
    quadrature.radiance = center.radiance * 0.36
      + (tangentPositive.radiance + tangentNegative.radiance + bitangentPositive.radiance + bitangentNegative.radiance) * 0.16;
    quadrature.environmentRadiance = center.environmentRadiance * 0.36
      + (tangentPositive.environmentRadiance + tangentNegative.environmentRadiance + bitangentPositive.environmentRadiance + bitangentNegative.environmentRadiance) * 0.16;
    return quadrature;
  }
  let diagonalRadius = coneRadius * 0.70710678;
  let diagonalPositivePositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + (tangent + bitangent) * diagonalRadius));
  let diagonalPositiveNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + (tangent - bitangent) * diagonalRadius));
  let diagonalNegativePositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + (-tangent + bitangent) * diagonalRadius));
  let diagonalNegativeNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + (-tangent - bitangent) * diagonalRadius));
  var samples: array<ReflectionSample, 9>;
  samples[0] = center;
  samples[1] = tangentPositive;
  samples[2] = tangentNegative;
  samples[3] = bitangentPositive;
  samples[4] = bitangentNegative;
  samples[5] = diagonalPositivePositive;
  samples[6] = diagonalPositiveNegative;
  samples[7] = diagonalNegativePositive;
  samples[8] = diagonalNegativeNegative;
  var minimumIndex = 0;
  var maximumIndex = 0;
  var minimumLuminance = dot(samples[0].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
  var maximumLuminance = minimumLuminance;
  var radianceSum = vec3<f32>(0.0);
  var environmentRadianceSum = vec3<f32>(0.0);
  for (var sampleIndex = 0; sampleIndex < 9; sampleIndex += 1) {
    let sampleLuminance = dot(samples[sampleIndex].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
    if (sampleLuminance < minimumLuminance) {
      minimumLuminance = sampleLuminance;
      minimumIndex = sampleIndex;
    }
    if (sampleLuminance > maximumLuminance) {
      maximumLuminance = sampleLuminance;
      maximumIndex = sampleIndex;
    }
    radianceSum += samples[sampleIndex].radiance;
    environmentRadianceSum += samples[sampleIndex].environmentRadiance;
  }
  if (maximumIndex == minimumIndex) {
    maximumIndex = select(0, 1, minimumIndex == 0);
  }
  quadrature.radiance = (radianceSum - samples[minimumIndex].radiance - samples[maximumIndex].radiance) / 7.0;
  quadrature.environmentRadiance = (environmentRadianceSum
    - samples[minimumIndex].environmentRadiance
    - samples[maximumIndex].environmentRadiance) / 7.0;
  return quadrature;
}

fn weightedDepth(sampleValue: vec4<f32>) -> f32 {
  return sampleValue.w / max(sampleValue.z, 0.0001);
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

fn reconstructWorldReflectionNormal(pixel: vec2<i32>) -> vec3<f32> {
  let leftPixel = pixel + vec2<i32>(-6, 0);
  let rightPixel = pixel + vec2<i32>(6, 0);
  let screenUpPixel = pixel + vec2<i32>(0, -6);
  let screenDownPixel = pixel + vec2<i32>(0, 6);
  let left = reconstructWorldPosition(leftPixel, edgePreservingDepth(leftPixel, readAccum(leftPixel)));
  let right = reconstructWorldPosition(rightPixel, edgePreservingDepth(rightPixel, readAccum(rightPixel)));
  let screenUp = reconstructWorldPosition(screenUpPixel, edgePreservingDepth(screenUpPixel, readAccum(screenUpPixel)));
  let screenDown = reconstructWorldPosition(screenDownPixel, edgePreservingDepth(screenDownPixel, readAccum(screenDownPixel)));
  var worldNormal = normalize(cross(right - left, screenDown - screenUp));
  let center = reconstructWorldPosition(pixel, edgePreservingDepth(pixel, readAccum(pixel)));
  let viewToCamera = normalize(params.cameraPosition.xyz - center);
  worldNormal = select(worldNormal, -worldNormal, dot(worldNormal, viewToCamera) < 0.0);
  return worldNormal;
}

fn reconstructWorldReflectionDetailNormal(pixel: vec2<i32>) -> vec3<f32> {
  let leftPixel = pixel + vec2<i32>(-2, 0);
  let rightPixel = pixel + vec2<i32>(2, 0);
  let screenUpPixel = pixel + vec2<i32>(0, -2);
  let screenDownPixel = pixel + vec2<i32>(0, 2);
  let left = reconstructWorldPosition(leftPixel, edgePreservingDepth(leftPixel, readAccum(leftPixel)));
  let right = reconstructWorldPosition(rightPixel, edgePreservingDepth(rightPixel, readAccum(rightPixel)));
  let screenUp = reconstructWorldPosition(screenUpPixel, edgePreservingDepth(screenUpPixel, readAccum(screenUpPixel)));
  let screenDown = reconstructWorldPosition(screenDownPixel, edgePreservingDepth(screenDownPixel, readAccum(screenDownPixel)));
  var worldNormal = normalize(cross(right - left, screenDown - screenUp));
  let center = reconstructWorldPosition(pixel, edgePreservingDepth(pixel, readAccum(pixel)));
  let viewToCamera = normalize(params.cameraPosition.xyz - center);
  worldNormal = select(worldNormal, -worldNormal, dot(worldNormal, viewToCamera) < 0.0);
  return worldNormal;
}

fn reconstructEntryNormalAtRadius(pixel: vec2<i32>, centerDepth: f32, radius: i32) -> vec3<f32> {
  let left = coherentSlabDepth(pixel + vec2<i32>(-radius, 0), centerDepth, false);
  let right = coherentSlabDepth(pixel + vec2<i32>(radius, 0), centerDepth, false);
  let down = coherentSlabDepth(pixel + vec2<i32>(0, -radius), centerDepth, false);
  let up = coherentSlabDepth(pixel + vec2<i32>(0, radius), centerDepth, false);
  let gradient = vec2<f32>(right - left, up - down) / f32(radius);
  return normalize(vec3<f32>(-gradient.x * 7.2, gradient.y * 7.2, 1.0));
}

struct InterfaceNormalEstimate {
  detailNormal: vec3<f32>,
  macroNormal: vec3<f32>,
  microResidual: vec3<f32>,
  filteredNormal: vec3<f32>,
  variance: f32,
  denseBodyConfidence: f32,
}

fn estimateInterfaceNormal(
  pixel: vec2<i32>,
  centerDepth: f32,
  centerAccum: vec4<f32>,
  coverageContinuity: f32,
) -> InterfaceNormalEstimate {
  let detailNormal = reconstructEntryNormalAtRadius(pixel, centerDepth, 1);
  let macroNormal = reconstructEntryNormalAtRadius(pixel, centerDepth, 3);
  let variance = sqrt(max(1.0 - dot(detailNormal, macroNormal), 0.0));
  let denseBodyConfidence = smoothstep(0.68, 0.94, coverageContinuity)
    * smoothstep(2.35, 4.60, centerAccum.x)
    * smoothstep(1.15, 2.50, centerAccum.z);
  let normalBlend = denseBodyConfidence * clamp(0.14 + variance * 0.9, 0.14, 0.58);
  var estimate: InterfaceNormalEstimate;
  estimate.detailNormal = detailNormal;
  estimate.macroNormal = macroNormal;
  estimate.microResidual = detailNormal - macroNormal;
  estimate.filteredNormal = normalize(mix(detailNormal, macroNormal, normalBlend));
  estimate.variance = variance;
  estimate.denseBodyConfidence = denseBodyConfidence;
  return estimate;
}

fn reconstructExitNormalAtRadius(pixel: vec2<i32>, centerDepth: f32, radius: i32) -> vec3<f32> {
  let left = coherentSlabDepth(pixel + vec2<i32>(-radius, 0), centerDepth, true);
  let right = coherentSlabDepth(pixel + vec2<i32>(radius, 0), centerDepth, true);
  let down = coherentSlabDepth(pixel + vec2<i32>(0, -radius), centerDepth, true);
  let up = coherentSlabDepth(pixel + vec2<i32>(0, radius), centerDepth, true);
  let gradient = vec2<f32>(right - left, up - down) / f32(radius);
  return normalize(vec3<f32>(gradient.x * 7.2, -gradient.y * 7.2, -1.0));
}

fn reconstructExitNormal(pixel: vec2<i32>, centerDepth: f32) -> vec3<f32> {
  return reconstructExitNormalAtRadius(pixel, centerDepth, 1);
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
  let supportOrderingDepth = readSupportOrderingDepth(pixel);
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

fn distributionGgx(noh: f32, roughness: f32) -> f32 {
  let alpha = roughness * roughness;
  let alphaSquared = alpha * alpha;
  let denominator = noh * noh * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / max(3.14159265 * denominator * denominator, 0.0001);
}

fn geometrySchlickGgx(nod: f32, roughness: f32) -> f32 {
  let k = (roughness + 1.0) * (roughness + 1.0) * 0.125;
  return nod / max(nod * (1.0 - k) + k, 0.0001);
}

fn geometrySmith(nov: f32, nol: f32, roughness: f32) -> f32 {
  return geometrySchlickGgx(nov, roughness) * geometrySchlickGgx(nol, roughness);
}

fn fresnelSchlick(voh: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - voh, 5.0);
}

fn evaluateBoundedGgxDirectSpecular(
  normal: vec3<f32>,
  viewDirection: vec3<f32>,
  lightDirection: vec3<f32>,
  roughness: f32,
) -> vec3<f32> {
  let halfVector = normalize(viewDirection + lightDirection);
  let nov = clamp(dot(normal, viewDirection), 0.0, 1.0);
  let nol = clamp(dot(normal, lightDirection), 0.0, 1.0);
  let noh = clamp(dot(normal, halfVector), 0.0, 1.0);
  let voh = clamp(dot(viewDirection, halfVector), 0.0, 1.0);
  let distribution = distributionGgx(noh, roughness);
  let geometry = geometrySmith(nov, nol, roughness);
  let fresnel = fresnelSchlick(voh, vec3<f32>(0.02037));
  let specular = vec3<f32>(0.72, 0.92, 1.0) * 6.0 * distribution * geometry * fresnel * nol
    / max(4.0 * nov * nol, 0.0001);
  return min(specular, vec3<f32>(0.22));
}

@fragment
fn fs_refraction(@builtin(position) fragmentPosition: vec4<f32>) -> CompositeOutput {
  let dims = vec2<i32>(textureDimensions(surfaceAccumulation));
  let dimsFloat = vec2<f32>(dims);
  let pixel = vec2<i32>(fragmentPosition.xy);
  let opticalLightingMode = i32(round(params.cameraForward.w));
  let opticalFootprintMode = i32(round(params.cameraPosition.w));
  let transmissionFootprintMode = i32(round(params.opticalModes.x));
  let bodyTransportMode = i32(round(params.opticalModes.y));
  let interfaceFrequencyMode = i32(round(params.opticalModes.z));
  let sceneUv = clamp((vec2<f32>(pixel) + vec2<f32>(0.5)) / dimsFloat, vec2<f32>(0.0), vec2<f32>(1.0));
  let centerAccum = readAccum(pixel);
  if (centerAccum.z < 0.018 || centerAccum.x < 0.012) { discard; }

  let supportOrderingDepth = readSupportOrderingDepth(pixel);
  let opticalDebugMode = i32(round(params.cameraUp.w));
  if (opticalDebugMode == 16) {
    return refractionOutput(vec4<f32>(1.0, 1.0, 1.0, 1.0), supportOrderingDepth);
  }
  let centerCoverage = smoothstep(0.018, 0.10, centerAccum.z)
    * smoothstep(0.012, 0.085, centerAccum.x);
  var coverageSupportSum = 0.0;
  var coverageWeightSum = 0.0;
  for (var coverageY = -2; coverageY <= 2; coverageY = coverageY + 1) {
    for (var coverageX = -2; coverageX <= 2; coverageX = coverageX + 1) {
      let neighborAccum = readAccum(pixel + vec2<i32>(coverageX, coverageY));
      let neighborSupport = smoothstep(0.018, 0.075, neighborAccum.z)
        * smoothstep(0.012, 0.065, neighborAccum.x);
      let coverageWeight = 1.0 / (1.0 + f32(abs(coverageX) + abs(coverageY)));
      coverageSupportSum = coverageSupportSum + neighborSupport * coverageWeight;
      coverageWeightSum = coverageWeightSum + coverageWeight;
    }
  }
  let coverageContinuity = smoothstep(0.42, 0.90, coverageSupportSum / max(coverageWeightSum, 0.001));
  let legacyCoverage = centerCoverage * coverageContinuity;
  let shadingDepth = edgePreservingDepth(pixel, centerAccum);
  let slab = evaluateOpticalSlab(pixel, centerAccum);
  let interfaceNormal = estimateInterfaceNormal(pixel, slab.entryDepth, centerAccum, coverageContinuity);
  let denseCoverageClosure = max(legacyCoverage, smoothstep(0.48, 0.84, coverageContinuity));
  let adaptiveCoverage = mix(legacyCoverage, denseCoverageClosure, interfaceNormal.denseBodyConfidence);
  let interfaceFidelityEnabled = opticalDebugMode != 22;
  let geometricCoverage = select(legacyCoverage, adaptiveCoverage, interfaceFidelityEnabled);
  let coupledTransportNormal = select(interfaceNormal.detailNormal, interfaceNormal.filteredNormal, interfaceFidelityEnabled);
  let transportNormal = select(coupledTransportNormal, interfaceNormal.macroNormal, interfaceFrequencyMode == 1);
  if (opticalDebugMode == 18) {
    return refractionOutput(vec4<f32>(vec3<f32>(geometricCoverage), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 23) {
    return refractionOutput(vec4<f32>(interfaceNormal.denseBodyConfidence, coverageContinuity, interfaceNormal.variance, 1.0), supportOrderingDepth);
  }
  let thickness = centerAccum.x;
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let insideRay = refract(-viewDir, transportNormal, 1.0 / 1.333);
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
  let exitMacroNormal = reconstructExitNormalAtRadius(exitPixel, sampledExitDepth, 3);
  let exitTransportNormal = select(exitNormal, exitMacroNormal, interfaceFrequencyMode == 1);
  let exitNormalVariance = sqrt(max(1.0 - dot(exitNormal, exitMacroNormal), 0.0));
  let exitRayAngularVariance = max(exitNormalVariance, interfaceNormal.variance * 0.85);
  let outgoingRay = refract(insideRay, -exitTransportNormal, 1.333);
  let outgoingRayValid = length(outgoingRay) > 0.001;
  let exitWorldPosition = reconstructWorldPosition(exitPixel, sampledExitDepth);
  let outgoingWorldRay = viewDirectionToWorld(select(insideRay, outgoingRay, outgoingRayValid));
  let exitDirectionDelta = outgoingRay.xy / max(abs(outgoingRay.z), 0.25)
    - insideRay.xy / max(abs(insideRay.z), 0.25);
  let exitOffset = exitDirectionDelta * clamp(geometricPathLength * 7.0, 0.0, 12.0);
  let twoInterfaceOffset = clamp(insideOffset + exitOffset, vec2<f32>(-28.0), vec2<f32>(28.0));
  let entryOnlyOffset = reconstructRefractionOffset(transportNormal, thickness);
  let exitValidity = slab.exitValidity
    * select(0.0, 1.0, exitInFrame)
    * select(0.0, 1.0, insideRayValid && outgoingRayValid && exitDepthValid);
  let queryValidity = select(0.0, 1.0, exitValidity > 0.5);
  let transmissionFootprintActivation = interfaceNormal.denseBodyConfidence
    * smoothstep(0.04, 0.34, exitRayAngularVariance)
    * queryValidity;
  let transmissionConeRadius = clamp(
    0.008 + transmissionFootprintActivation * (0.055 + exitRayAngularVariance * 0.18),
    0.008,
    0.22,
  );
  let effectiveTransmissionQuadratureMode = select(
    0,
    1,
    transmissionFootprintMode == 1 && transmissionFootprintActivation > 0.05,
  );
  let offsetPixels = mix(entryOnlyOffset, twoInterfaceOffset, queryValidity);
  let refractedUv = clamp(sceneUv + offsetPixels / dimsFloat, vec2<f32>(0.001), vec2<f32>(0.999));
  let refractedScene = textureSampleLevel(refractionSceneColor, refractionSceneSampler, refractedUv, 0.0);
  let opticalThicknessPath = thickness * 0.12;
  let geometricSlabPath = mix(opticalThicknessPath, geometricPathLength, queryValidity);
  let denseBodyPathActivation = interfaceNormal.denseBodyConfidence
    * smoothstep(0.035, 0.42, opticalThicknessPath - geometricPathLength)
    * queryValidity;
  let robustBodyPath = mix(
    geometricPathLength,
    max(geometricPathLength, opticalThicknessPath),
    denseBodyPathActivation,
  );
  let robustBodyPathWithFallback = mix(opticalThicknessPath, robustBodyPath, queryValidity);
  let absorptionPath = select(geometricSlabPath, robustBodyPathWithFallback, bodyTransportMode == 1);
  let calibratedAbsorptionCoefficient = vec3<f32>(1.10, 0.42, 0.18);
  let legacyAbsorptionCoefficient = vec3<f32>(0.46, 0.15, 0.055);
  let absorptionCoefficient = select(calibratedAbsorptionCoefficient, legacyAbsorptionCoefficient, opticalLightingMode == 2);
  let absorption = exp(-absorptionCoefficient * absorptionPath);
  if (opticalDebugMode == 1) {
    let depthView = 1.0 - exp(-supportOrderingDepth * 0.22);
    return refractionOutput(vec4<f32>(vec3<f32>(depthView), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 2) {
    let depthView = 1.0 - exp(-slab.entryDepth * 0.22);
    return refractionOutput(vec4<f32>(depthView * 0.45, depthView * 0.72, depthView, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 3) {
    return refractionOutput(vec4<f32>(transportNormal * 0.5 + vec3<f32>(0.5), 1.0), supportOrderingDepth);
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
  if (opticalDebugMode == 11) {
    return refractionOutput(vec4<f32>(absorption, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 32) {
    let pathScale = max(max(geometricPathLength, opticalThicknessPath), 0.001);
    return refractionOutput(vec4<f32>(
      geometricPathLength / pathScale,
      opticalThicknessPath / pathScale,
      absorptionPath / pathScale,
      1.0
    ), supportOrderingDepth);
  }

  var refractionQuery = makeNoOpticalQuerySample();
  if (queryValidity > 0.5) {
    refractionQuery = sampleHybridOpticalQuery(exitWorldPosition + outgoingWorldRay * 0.035, outgoingWorldRay);
  }
  if (opticalDebugMode == 19) {
    if (queryValidity <= 0.5) {
      return refractionOutput(vec4<f32>(0.86, 0.10, 0.68, 1.0), supportOrderingDepth);
    }
    let hitKindColor = select(
      select(
        select(vec3<f32>(0.10, 0.32, 0.92), vec3<f32>(0.96, 0.62, 0.10), refractionQuery.hitKind == REFLECTION_HIT_ANALYTIC),
        vec3<f32>(0.96, 0.12, 0.38),
        refractionQuery.hitKind == REFLECTION_HIT_INDEXED_MESH,
      ),
      vec3<f32>(0.16, 0.92, 0.48),
      refractionQuery.hitKind == REFLECTION_HIT_DEFERRED_SCENE,
    );
    return refractionOutput(vec4<f32>(hitKindColor, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 20) {
    if (queryValidity <= 0.5) {
      return refractionOutput(vec4<f32>(0.86, 0.10, 0.68, 1.0), supportOrderingDepth);
    }
    let distanceView = 1.0 - exp(-refractionQuery.distance * 0.18);
    return refractionOutput(vec4<f32>(distanceView, refractionQuery.confidence, 1.0 - distanceView, 1.0), supportOrderingDepth);
  }
  var transmissionQuadratureRadiance = refractionQuery.radiance;
  if (queryValidity > 0.5) {
    transmissionQuadratureRadiance = integrateTransmissionQuadrature(
      exitWorldPosition + outgoingWorldRay * 0.035,
      outgoingWorldRay,
      refractionQuery,
      transmissionConeRadius,
      effectiveTransmissionQuadratureMode,
    );
  }
  let bodyRadianceLowFrequency = transmissionQuadratureRadiance;
  let bodyRadianceDirectionalResidual = refractionQuery.radiance - bodyRadianceLowFrequency;
  let bodyRadianceResidualWeight = 1.0 - denseBodyPathActivation * 0.72;
  let pathConditionedDetailDecay = interfaceNormal.denseBodyConfidence
    * queryValidity
    * smoothstep(0.10, 0.85, absorptionPath);
  let transmissionDetailWeight = select(
    bodyRadianceResidualWeight,
    1.0 - pathConditionedDetailDecay * 0.58,
    interfaceFrequencyMode == 1,
  );
  let robustBodyRadiance = max(bodyRadianceLowFrequency + bodyRadianceDirectionalResidual * transmissionDetailWeight, vec3<f32>(0.0));
  let refractedRadiance = mix(
    refractedScene.rgb,
    select(transmissionQuadratureRadiance, robustBodyRadiance, bodyTransportMode == 1),
    queryValidity,
  );
  if (opticalDebugMode == 21) {
    let fallbackDelta = abs(refractedRadiance - refractedScene.rgb);
    return refractionOutput(vec4<f32>(fallbackDelta, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 33) {
    let residualMagnitude = length(bodyRadianceDirectionalResidual) / max(length(bodyRadianceLowFrequency), 0.001);
    return refractionOutput(vec4<f32>(pathConditionedDetailDecay, transmissionDetailWeight, clamp(residualMagnitude, 0.0, 1.0), 1.0), supportOrderingDepth);
  }

  let reflectionEntryDepth = coherentSlabDepth(pixel, shadingDepth, false);
  let worldPosition = reconstructWorldPosition(pixel, reflectionEntryDepth);
  let worldNormal = reconstructWorldReflectionNormal(pixel);
  let viewToCamera = normalize(params.cameraPosition.xyz - worldPosition);
  let cameraRay = -viewToCamera;
  let macroFresnelNormal = worldNormal;
  let ndv = clamp(dot(macroFresnelNormal, viewToCamera), 0.0, 1.0);
  let f0 = 0.02037;
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
  if (opticalDebugMode == 10) {
    return refractionOutput(vec4<f32>(vec3<f32>(fresnel), 1.0), supportOrderingDepth);
  }
  let reflectionDetailNormal = reconstructWorldReflectionDetailNormal(pixel);
  let unresolvedNormalVariance = sqrt(max(1.0 - dot(worldNormal, reflectionDetailNormal), 0.0));
  let microReflectionWeight = select(
    0.0,
    clamp(
      (1.0 - interfaceNormal.denseBodyConfidence) * 0.18
        + interfaceNormal.denseBodyConfidence * unresolvedNormalVariance * 0.12,
      0.0,
      0.24,
    ),
    interfaceFrequencyMode == 1,
  );
  let reflectionSurfaceNormal = normalize(mix(worldNormal, reflectionDetailNormal, microReflectionWeight));
  let reflectionDirection = normalize(reflect(cameraRay, reflectionSurfaceNormal));
  let reflectionRoughness = clamp(
    0.06 + unresolvedNormalVariance * 2.1 + pow(1.0 - ndv, 2.0) * 0.34,
    0.06,
    1.0,
  );
  let footprintActivation = interfaceNormal.denseBodyConfidence
    * smoothstep(0.08, 0.42, unresolvedNormalVariance);
  let baselineReflectionConeRadius = clamp(0.018 + reflectionRoughness * 0.10, 0.018, 0.118);
  let varianceFilteredConeRadius = clamp(
    baselineReflectionConeRadius + footprintActivation * (0.018 + reflectionRoughness * 0.024),
    0.018,
    0.16,
  );
  let reflectionConeRadius = select(baselineReflectionConeRadius, varianceFilteredConeRadius, opticalFootprintMode == 1);
  let effectiveFootprintQuadratureMode = select(0, 1, opticalFootprintMode == 1 && footprintActivation > 0.05);
  if (opticalDebugMode == 34) {
    return refractionOutput(vec4<f32>(interfaceNormal.macroNormal * 0.5 + vec3<f32>(0.5), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 35) {
    return refractionOutput(vec4<f32>(interfaceNormal.microResidual * 2.5 + vec3<f32>(0.5), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 36) {
    return refractionOutput(vec4<f32>(unresolvedNormalVariance, microReflectionWeight / 0.24, reflectionRoughness, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 37) {
    return refractionOutput(vec4<f32>(pathConditionedDetailDecay, transmissionDetailWeight, interfaceNormal.denseBodyConfidence, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 15) {
    return refractionOutput(vec4<f32>(sampleEnvironmentFiltered(reflectionDirection, reflectionRoughness), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 13 || opticalDebugMode == 14) {
    let reflectionHit = sampleHybridOpticalQuery(worldPosition + worldNormal * 0.026, reflectionDirection);
    if (opticalDebugMode == 13) {
      let hitKindColor = select(
        select(
          select(vec3<f32>(0.10, 0.32, 0.92), vec3<f32>(0.96, 0.62, 0.10), reflectionHit.hitKind == REFLECTION_HIT_ANALYTIC),
          vec3<f32>(0.96, 0.12, 0.38),
          reflectionHit.hitKind == REFLECTION_HIT_INDEXED_MESH,
        ),
        vec3<f32>(0.16, 0.92, 0.48),
        reflectionHit.hitKind == REFLECTION_HIT_DEFERRED_SCENE,
      );
      return refractionOutput(vec4<f32>(hitKindColor, 1.0), supportOrderingDepth);
    }
    let distanceView = 1.0 - exp(-reflectionHit.distance * 0.18);
    return refractionOutput(vec4<f32>(distanceView, distanceView * 0.72, 1.0 - distanceView, 1.0), supportOrderingDepth);
  }

  let reflectionQuadrature = integrateWorldReflectionQuadrature(
    worldPosition,
    cameraRay,
    reflectionSurfaceNormal,
    reflectionConeRadius,
    effectiveFootprintQuadratureMode,
  );
  let reflectionRadiance = reflectionQuadrature.radiance;
  if (opticalDebugMode == 12) {
    return refractionOutput(vec4<f32>(reflectionRadiance, 1.0), supportOrderingDepth);
  }
  let environmentContribution = reflectionQuadrature.environmentRadiance * fresnel;
  if (opticalDebugMode == 17) {
    return refractionOutput(vec4<f32>(environmentContribution, 1.0), supportOrderingDepth);
  }

  let absorptionLoss = vec3<f32>(1.0) - absorption;
  let waterScatter = vec3<f32>(0.055, 0.30, 0.42) * (vec3<f32>(0.42) + absorptionLoss * 0.58);
  let directRoughness = select(
    0.0,
    clamp(interfaceNormal.variance * interfaceNormal.denseBodyConfidence, 0.0, 0.48),
    interfaceFidelityEnabled,
  );
  let directRoughnessWeight = smoothstep(0.025, 0.34, directRoughness);
  let broadSpecularExponent = mix(38.0, 12.0, directRoughnessWeight);
  let crestSpecularExponent = mix(128.0, 46.0, directRoughnessWeight);
  let directLight = max(dot(transportNormal, normalize(vec3<f32>(-0.28, 0.64, 1.72))), 0.0);
  let broadSpecular = pow(directLight, broadSpecularExponent) * 0.32;
  let crestSpecular = pow(directLight, crestSpecularExponent) * 0.46 * mix(1.0, 0.82, directRoughnessWeight);
  let transmittedTransport = refractedRadiance * absorption * (1.0 - fresnel);
  let reflectedTransport = reflectionRadiance * fresnel;
  let scatterTransport = waterScatter * (1.0 - fresnel);
  let transportOnlyColor = transmittedTransport + reflectedTransport + scatterTransport;
  if (opticalDebugMode == 24) {
    return refractionOutput(vec4<f32>(transmittedTransport, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 25) {
    return refractionOutput(vec4<f32>(reflectedTransport, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 26) {
    return refractionOutput(vec4<f32>(scatterTransport, 1.0), supportOrderingDepth);
  }
  let preToneLuminance = dot(transportOnlyColor, vec3<f32>(0.2126, 0.7152, 0.0722));
  if (opticalDebugMode == 27) {
    return refractionOutput(vec4<f32>(vec3<f32>(preToneLuminance), 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 28) {
    return refractionOutput(vec4<f32>(unresolvedNormalVariance, interfaceNormal.denseBodyConfidence, footprintActivation, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 29) {
    let sampleCount = select(5.0, 9.0, effectiveFootprintQuadratureMode == 1);
    return refractionOutput(vec4<f32>(baselineReflectionConeRadius / 0.16, reflectionConeRadius / 0.16, sampleCount / 9.0, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 30) {
    return refractionOutput(vec4<f32>(exitNormalVariance, interfaceNormal.denseBodyConfidence, transmissionFootprintActivation, 1.0), supportOrderingDepth);
  }
  if (opticalDebugMode == 31) {
    let sampleCount = select(1.0, 5.0, effectiveTransmissionQuadratureMode == 1);
    return refractionOutput(vec4<f32>(transmissionConeRadius / 0.22, f32(effectiveTransmissionQuadratureMode), sampleCount / 5.0, 1.0), supportOrderingDepth);
  }
  var color = transportOnlyColor;
  if (opticalLightingMode == 1) {
    let ggxRoughness = clamp(0.12 + directRoughness * 1.8, 0.12, 0.68);
    color += evaluateBoundedGgxDirectSpecular(
      worldNormal,
      viewToCamera,
      normalize(vec3<f32>(-0.28, 0.64, 1.72)),
      ggxRoughness,
    );
  } else if (opticalLightingMode == 2) {
    color += vec3<f32>(0.72, 0.92, 1.0) * broadSpecular
      + vec3<f32>(1.0) * crestSpecular * (0.22 + fresnel * 0.78);
  }
  return refractionOutput(vec4<f32>(color, geometricCoverage), supportOrderingDepth);
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

export function resolveFingerFluidUnsupportedSheetStrength(
  value = KAMINOS_FINGER_FLUID_DEFAULT_UNSUPPORTED_SHEET_STRENGTH,
) {
  const strength = finite(value, KAMINOS_FINGER_FLUID_DEFAULT_UNSUPPORTED_SHEET_STRENGTH);
  if (strength < 0 || strength > 2) {
    throw new RangeError(`Finger fluid unsupported-sheet strength must be within [0, 2]: ${value}`);
  }
  return strength;
}

export function resolveFingerFluidInletCutoffStep(value = null) {
  if (value === null || value === undefined || value === '') return null;
  const step = Number(value);
  if (!Number.isSafeInteger(step) || step < 1) {
    throw new RangeError(`Finger fluid inlet cutoff step must be a positive safe integer: ${value}`);
  }
  return step;
}

export function evaluateFingerFluidUnsupportedSheetNeighborhood({
  velocity = [0, 0, 0],
  densityRatio = 1,
  surfaceFactor = 0,
  supportContact = 1,
  neighborRetention = 0,
  neighborRetentionAge = 0,
  kernelRadius = 0.185,
  strength = KAMINOS_FINGER_FLUID_DEFAULT_UNSUPPORTED_SHEET_STRENGTH,
  neighbors = [],
} = {}) {
  if (!Array.isArray(velocity) || velocity.length !== 3 || !velocity.every(Number.isFinite)) {
    throw new TypeError('Finger fluid unsupported-sheet neighborhood requires a finite 3D velocity');
  }
  if (!Array.isArray(neighbors) || neighbors.some(neighbor => (
    !Array.isArray(neighbor?.offset)
      || neighbor.offset.length !== 3
      || !neighbor.offset.every(Number.isFinite)
      || !Array.isArray(neighbor?.velocity)
      || neighbor.velocity.length !== 3
      || !neighbor.velocity.every(Number.isFinite)
  ))) {
    throw new TypeError('Finger fluid unsupported-sheet neighborhood requires finite offset/velocity samples');
  }
  if (!Number.isFinite(kernelRadius) || kernelRadius <= 0) {
    throw new RangeError(`Finger fluid unsupported-sheet neighborhood requires a positive kernel radius: ${kernelRadius}`);
  }
  const safeStrength = resolveFingerFluidUnsupportedSheetStrength(strength);
  const contact = clamp(finite(supportContact, 1), 0, 1);
  const safeDensityRatio = Math.max(0, finite(densityRatio, 0));
  const safeSurfaceFactor = clamp(finite(surfaceFactor, 0), 0, 1);
  const retention = clamp(finite(neighborRetention, 0), 0, 1);
  const retentionAge = Math.max(0, finite(neighborRetentionAge, 0));
  const speed = Math.hypot(...velocity);
  const flow = normalize3(velocity);
  const seed = Math.abs(flow[0]) < 0.82 ? [1, 0, 0] : [0, 0, 1];
  const transverseU = normalize3(cross3(flow, seed));
  const transverseV = normalize3(cross3(flow, transverseU));
  let covarianceUU = 0;
  let covarianceUV = 0;
  let covarianceVV = 0;
  let velocityCoherenceSum = 0;
  let acceptedNeighborCount = 0;
  for (const neighbor of neighbors) {
    const distance = Math.hypot(...neighbor.offset);
    if (distance <= 1e-9 || distance >= kernelRadius) continue;
    const u = neighbor.offset.reduce((sum, component, axis) => sum + component * transverseU[axis], 0);
    const v = neighbor.offset.reduce((sum, component, axis) => sum + component * transverseV[axis], 0);
    covarianceUU += u * u;
    covarianceUV += u * v;
    covarianceVV += v * v;
    const neighborSpeed = Math.hypot(...neighbor.velocity);
    velocityCoherenceSum += neighborSpeed > 1e-9
      ? clamp(neighbor.velocity.reduce((sum, component, axis) => sum + component * flow[axis], 0) / neighborSpeed, -1, 1)
      : 0;
    acceptedNeighborCount += 1;
  }
  const covarianceTrace = covarianceUU + covarianceVV;
  const covarianceDiscriminant = Math.sqrt(Math.max(0, (covarianceUU - covarianceVV) ** 2 + 4 * covarianceUV ** 2));
  const transverseAnisotropy = covarianceTrace > 1e-12
    ? (covarianceTrace + covarianceDiscriminant) * 0.5 / covarianceTrace
    : 0;
  const velocityCoherence = acceptedNeighborCount > 0 ? velocityCoherenceSum / acceptedNeighborCount : 0;

  let releaseReason = null;
  if (safeStrength === 0) releaseReason = 'disabled';
  else if (contact >= 0.2) releaseReason = 'support_contact';
  else if (acceptedNeighborCount < 3) releaseReason = 'neighbor_loss';
  else if (speed < 0.18) releaseReason = 'low_transport_speed';
  else if (safeDensityRatio < 0.1) releaseReason = 'density_loss';
  else if (safeDensityRatio > 1.05) releaseReason = 'bulk_density';
  else if (safeSurfaceFactor < 0.2) releaseReason = 'not_interface';
  else if (retention < 0.25 || retentionAge < 0.03) releaseReason = 'topology_loss';
  else if (velocityCoherence < 0.72) releaseReason = 'velocity_incoherent';
  else if (transverseAnisotropy < 0.66) releaseReason = 'not_planar';

  const activity = releaseReason ? 0 : clamp(
    safeStrength
      * (1 - smoothstepNumber(0.04, 0.20, contact))
      * smoothstepNumber(0.10, 0.32, safeDensityRatio)
      * (1 - smoothstepNumber(0.90, 1.05, safeDensityRatio))
      * smoothstepNumber(0.20, 0.58, safeSurfaceFactor)
      * smoothstepNumber(0.25, 0.65, retention)
      * smoothstepNumber(0.03, 0.22, retentionAge)
      * smoothstepNumber(0.72, 0.92, velocityCoherence)
      * smoothstepNumber(0.66, 0.86, transverseAnisotropy)
      * smoothstepNumber(2, 6, acceptedNeighborCount),
    0,
    1,
  );
  return {
    contract: KAMINOS_FINGER_FLUID_UNSUPPORTED_SHEET_CONTRACT,
    activity: Number(activity.toFixed(6)),
    releaseReason,
    neighborCount: acceptedNeighborCount,
    transverseAnisotropy: Number(transverseAnisotropy.toFixed(6)),
    velocityCoherence: Number(velocityCoherence.toFixed(6)),
  };
}

export function summarizeFingerFluidSheetReleaseDiagnostics(
  topologyValues,
  particleValues,
  particleCount,
) {
  if (!Number.isSafeInteger(particleCount) || particleCount < 1) {
    throw new TypeError(`Finger fluid sheet diagnostics require a positive particle count: ${particleCount}`);
  }
  const expectedTopologyValues = particleCount * NEIGHBOR_TOPOLOGY_WORDS;
  const expectedParticleValues = particleCount * PARTICLE_FLOATS;
  if (!topologyValues || topologyValues.length !== expectedTopologyValues) {
    throw new RangeError(`Finger fluid sheet diagnostics received partial topology diagnostics: expected ${expectedTopologyValues}, received ${topologyValues?.length ?? 0}`);
  }
  if (!particleValues || particleValues.length !== expectedParticleValues) {
    throw new RangeError(`Finger fluid sheet diagnostics received partial particle diagnostics: expected ${expectedParticleValues}, received ${particleValues?.length ?? 0}`);
  }

  const reasonCounts = Object.fromEntries(
    Object.keys(KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES).map(reason => [reason, 0]),
  );
  const measurementNames = [
    'priorActivity',
    'currentActivity',
    'inletCoreWeight',
    'speed',
    'supportContact',
    'densityRatio',
    'surfaceFactor',
    'neighborCount',
    'velocityCoherence',
    'transverseAnisotropy',
    'topologyRetention',
    'topologyRetentionAge',
  ];
  const reasonAccumulators = Object.fromEntries(
    Object.keys(reasonCounts).map(reason => [reason, {
      positionMin: [Infinity, Infinity, Infinity],
      positionMax: [-Infinity, -Infinity, -Infinity],
      positionSum: [0, 0, 0],
      measurementSums: Object.fromEntries(measurementNames.map(name => [name, 0])),
      maximumLinkStretch: 0,
      maximumLinkKernelRatio: 0,
    }]),
  );
  let activeParticleCount = 0;
  let dormantParticleCount = 0;
  let activeSheetParticleCount = 0;
  let releasedSheetParticleCount = 0;
  let maximumLinkStretch = 0;
  let maximumLinkKernelRatio = 0;
  let neighborCountSum = 0;
  let densityRatioSum = 0;
  let topologyRetentionSum = 0;

  const requireFiniteReadback = (value, field, index) => {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite sheet diagnostic readback for particle ${index}: ${field}=${value}`);
    }
    return value;
  };

  for (let index = 0; index < particleCount; index += 1) {
    const topologyOffset = index * NEIGHBOR_TOPOLOGY_WORDS;
    const diagnosticOffset = topologyOffset + 20;
    const channels = Array.from(topologyValues.slice(diagnosticOffset, diagnosticOffset + 12));
    if (channels.length !== 12) {
      throw new TypeError(`Finger fluid sheet diagnostics contain malformed channels for particle ${index}`);
    }
    channels.forEach((value, channelIndex) => requireFiniteReadback(value, `diagnosticChannel[${channelIndex}]`, index));
    const reasonCode = channels[0];
    if (!Number.isInteger(reasonCode) || !Object.hasOwn(KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASONS_BY_CODE, reasonCode)) {
      throw new RangeError(`Unknown sheet release reason code ${reasonCode} for particle ${index}`);
    }
    const reason = KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASONS_BY_CODE[reasonCode];
    const particleOffset = index * PARTICLE_FLOATS;
    const activeDiscriminator = requireFiniteReadback(
      particleValues[particleOffset + 11],
      'particle.activeDiscriminator',
      index,
    );
    const active = activeDiscriminator >= 0;
    if (!active) {
      dormantParticleCount += 1;
      if (reason !== 'dormant' && reason !== 'disabled') {
        throw new Error(`Dormant particle ${index} carries non-dormant sheet release reason ${reason}`);
      }
      continue;
    }
    if (reason === 'dormant') {
      throw new Error(`Active particle ${index} carries dormant sheet release reason`);
    }
    const activity = requireFiniteReadback(topologyValues[topologyOffset + 11], 'topology.sheetActivity', index);
    if ((reason === 'active' && activity <= 0) || (reason !== 'active' && activity > 0.0001)) {
      throw new Error(`Particle ${index} sheet activity ${activity} contradicts release reason ${reason}`);
    }
    activeParticleCount += 1;
    reasonCounts[reason] += 1;
    const accumulator = reasonAccumulators[reason];
    for (let axis = 0; axis < 3; axis += 1) {
      const position = requireFiniteReadback(
        particleValues[particleOffset + axis],
        `particle.position[${axis}]`,
        index,
      );
      accumulator.positionMin[axis] = Math.min(accumulator.positionMin[axis], position);
      accumulator.positionMax[axis] = Math.max(accumulator.positionMax[axis], position);
      accumulator.positionSum[axis] += position;
    }
    const measurements = {
      priorActivity: channels[1],
      currentActivity: activity,
      inletCoreWeight: channels[2],
      speed: channels[4],
      supportContact: channels[5],
      densityRatio: channels[6],
      surfaceFactor: channels[7],
      neighborCount: channels[8],
      velocityCoherence: channels[9],
      transverseAnisotropy: channels[10],
      topologyRetention: requireFiniteReadback(
        topologyValues[topologyOffset + 4],
        'topology.retention',
        index,
      ),
      topologyRetentionAge: requireFiniteReadback(
        topologyValues[topologyOffset + 5],
        'topology.retentionAge',
        index,
      ),
    };
    for (const name of measurementNames) accumulator.measurementSums[name] += measurements[name];
    accumulator.maximumLinkStretch = Math.max(accumulator.maximumLinkStretch, channels[11]);
    accumulator.maximumLinkKernelRatio = Math.max(accumulator.maximumLinkKernelRatio, channels[3]);
    if (reason === 'active') activeSheetParticleCount += 1;
    else releasedSheetParticleCount += 1;
    neighborCountSum += channels[8];
    densityRatioSum += channels[6];
    topologyRetentionSum += measurements.topologyRetention;
    maximumLinkStretch = Math.max(maximumLinkStretch, channels[11]);
    maximumLinkKernelRatio = Math.max(maximumLinkKernelRatio, channels[3]);
  }

  const rounded = value => Number(value.toFixed(6));
  const reasonRows = Object.entries(reasonCounts).map(([reason, count]) => {
    const accumulator = reasonAccumulators[reason];
    return {
      reason,
      code: KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES[reason],
      particleCount: count,
      activeParticleRatio: rounded(count / Math.max(1, activeParticleCount)),
      positionBounds: count > 0 ? {
        min: accumulator.positionMin.map(rounded),
        max: accumulator.positionMax.map(rounded),
        centroid: accumulator.positionSum.map(value => rounded(value / count)),
      } : null,
      measurements: count > 0 ? {
        ...Object.fromEntries(measurementNames.map(name => [
          `average${name[0].toUpperCase()}${name.slice(1)}`,
          rounded(accumulator.measurementSums[name] / count),
        ])),
        maximumLinkStretch: rounded(accumulator.maximumLinkStretch),
        maximumLinkKernelRatio: rounded(accumulator.maximumLinkKernelRatio),
      } : null,
    };
  });
  return {
    schema: KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTICS_SCHEMA,
    contract: KAMINOS_FINGER_FLUID_SHEET_DIAGNOSTIC_CONTRACT,
    layout: 'neighbor-topology-words-20-through-31-reusing-sheet-and-metrics-v0',
    accountedParticleCount: particleCount,
    activeParticleCount,
    dormantParticleCount,
    diagnosedActiveParticleCount: reasonRows.reduce((sum, row) => sum + row.particleCount, 0),
    activeSheetParticleCount,
    releasedSheetParticleCount,
    reasonCounts,
    reasonRows,
    averageNeighborCount: Number((neighborCountSum / Math.max(1, activeParticleCount)).toFixed(6)),
    averageDensityRatio: Number((densityRatioSum / Math.max(1, activeParticleCount)).toFixed(6)),
    averageTopologyRetention: Number((topologyRetentionSum / Math.max(1, activeParticleCount)).toFixed(6)),
    maximumLinkStretch: Number(maximumLinkStretch.toFixed(6)),
    maximumLinkKernelRatio: Number(maximumLinkKernelRatio.toFixed(6)),
  };
}

export function validateFingerFluidWaterfallWitnessRenderIdentity(route, {
  rendererMode,
  colorMode,
  opticalDebugMode,
} = {}) {
  const identity = {
    requestedRendererMode: route?.requestedRendererMode,
    effectiveRendererMode: route?.effectiveRendererMode,
    requestedColorMode: route?.requestedColorMode,
    effectiveColorMode: route?.effectiveColorMode,
    requestedOpticalDebugMode: route?.requestedOpticalDebugMode,
    effectiveOpticalDebugMode: route?.effectiveOpticalDebugMode,
  };
  if (identity.requestedRendererMode !== rendererMode
    || identity.effectiveRendererMode !== rendererMode
    || identity.requestedColorMode !== colorMode
    || identity.effectiveColorMode !== colorMode
    || identity.requestedOpticalDebugMode !== opticalDebugMode
    || identity.effectiveOpticalDebugMode !== opticalDebugMode) {
    throw new Error(`Requested/effective waterfall witness render identity mismatch: ${JSON.stringify({
      expected: { rendererMode, colorMode, opticalDebugMode },
      identity,
    })}`);
  }
  return identity;
}

export function validateFingerFluidFiniteDiagnosticPayload(payload, label = 'finger fluid diagnostics') {
  const visit = (value, path) => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new TypeError(`Non-finite diagnostic payload at ${path}: ${value}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) visit(entry, `${path}.${key}`);
    }
  };
  visit(payload, label);
  return payload;
}

export function evaluateFingerFluidUnsupportedSheetPair({
  distance,
  kernelRadius,
  normalAlignment,
  particleActivity,
  neighborActivity,
} = {}) {
  if (![distance, kernelRadius, normalAlignment, particleActivity, neighborActivity].every(Number.isFinite)
    || kernelRadius <= 0 || distance < 0) {
    throw new TypeError('Finger fluid unsupported-sheet pair requires finite non-negative geometry and activity');
  }
  const q = distance / kernelRadius;
  let releaseReason = null;
  if (q >= 1.75) releaseReason = 'outside_bridge_radius';
  else if (q <= 0.0001) releaseReason = 'degenerate_pair';
  else if (normalAlignment < 0.72) releaseReason = 'normal_incoherent';
  else if (particleActivity <= 0 || neighborActivity <= 0) releaseReason = 'inactive_pair';
  const pairActivity = releaseReason
    ? 0
    : Math.min(particleActivity, neighborActivity) * smoothstepNumber(0.72, 0.94, normalAlignment);
  const gapClosureWeight = releaseReason
    ? 0
    : pairActivity * smoothstepNumber(0.55, 0.90, q) * (1 - smoothstepNumber(1.55, 1.75, q));
  return {
    contract: KAMINOS_FINGER_FLUID_UNSUPPORTED_SHEET_CONTRACT,
    q: Number(q.toFixed(6)),
    pairActivity: Number(pairActivity.toFixed(6)),
    gapClosureWeight: Number(gapClosureWeight.toFixed(6)),
    releaseReason,
  };
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
  const adaptiveDensity = matchingWaterfallEvidenceIdentityValue(
    runtime,
    'requestedAdaptiveDensity',
    'effectiveAdaptiveDensity',
    'adaptive density',
  );
  let particleCount;
  let baseParticleCount;
  if (adaptiveDensity) {
    baseParticleCount = runtime.requestedParticleCount;
    particleCount = runtime.effectiveParticleCount;
    if (baseParticleCount !== runtime.baseParticleCount) {
      throw new TypeError(`Waterfall soak evidence adaptive base-population disagreement: ${JSON.stringify({ requestedParticleCount: baseParticleCount, runtimeBaseParticleCount: runtime.baseParticleCount })}`);
    }
    if (particleCount !== runtime.particleCount || particleCount !== runtime.simulationCapacity) {
      throw new TypeError(`Waterfall soak evidence adaptive capacity disagreement: ${JSON.stringify({ particleCount, runtimeParticleCount: runtime.particleCount, simulationCapacity: runtime.simulationCapacity })}`);
    }
  } else {
    particleCount = matchingWaterfallEvidenceIdentityValue(
      runtime,
      'requestedParticleCount',
      'effectiveParticleCount',
      'particle count',
    );
    baseParticleCount = particleCount;
    if (particleCount !== runtime.particleCount) {
      throw new TypeError(`Waterfall soak evidence particle-count runtime disagreement: ${JSON.stringify({ particleCount, runtimeParticleCount: runtime.particleCount })}`);
    }
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
    adaptiveDensity,
    baseParticleCount,
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
  const adaptiveDensity = identity.adaptiveDensity === true;
  const baseParticleCount = identity.baseParticleCount ?? identity.particleCount;
  if (!Number.isSafeInteger(baseParticleCount) || baseParticleCount < 1024 || baseParticleCount > identity.particleCount) {
    throw new TypeError(`Waterfall soak evidence identity requires a valid baseParticleCount: ${baseParticleCount}`);
  }
  if (!adaptiveDensity && baseParticleCount !== identity.particleCount) {
    throw new TypeError(`Non-adaptive waterfall evidence cannot carry distinct base/capacity populations: ${JSON.stringify({ baseParticleCount, particleCount: identity.particleCount })}`);
  }
  for (const field of numericFields) {
    if (!Number.isFinite(identity[field])) {
      throw new TypeError(`Waterfall soak evidence identity requires finite ${field}: ${identity[field]}`);
    }
  }
  return {
    schema: KAMINOS_FINGER_FLUID_WATERFALL_SOAK_EVIDENCE_IDENTITY_SCHEMA,
    ...Object.fromEntries(stringFields.map(field => [field, identity[field]])),
    adaptiveDensity,
    baseParticleCount,
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

export function createFingerFluidLiveInletParticles(particleCount, packet = null) {
  const normalized = normalizeFingerFluidLiveInletPacket(packet);
  const active = normalized.inlets.filter(inlet => inlet.active);
  const assignedInlets = active.length ? active : normalized.inlets;
  const data = new Float32Array(particleCount * PARTICLE_FLOATS);
  for (let index = 0; index < particleCount; index += 1) {
    const inlet = assignedInlets[index % assignedInlets.length];
    const localOrdinal = Math.floor(index / assignedInlets.length);
    const apertureOrdinal = Math.floor(localOrdinal / 8);
    const axialLayer = localOrdinal % 8;
    const radialSequence = ((apertureOrdinal + 0.5) * 0.61803398875) % 1;
    const radial = inlet.radius * 0.82 * Math.sqrt(radialSequence);
    const angle = apertureOrdinal * 2.39996322973;
    const u = Math.cos(angle) * radial;
    const v = Math.sin(angle) * radial;
    const bitangent = normalizeFingerFluidInletVector([
      inlet.axis[1] * inlet.tangent[2] - inlet.axis[2] * inlet.tangent[1],
      inlet.axis[2] * inlet.tangent[0] - inlet.axis[0] * inlet.tangent[2],
      inlet.axis[0] * inlet.tangent[1] - inlet.axis[1] * inlet.tangent[0],
    ], `${inlet.id} initial bitangent`);
    const axialPosition = -inlet.reservoirLength * ((axialLayer + 0.5) / 8);
    const position = inlet.origin.map((value, component) => (
      value
      + inlet.tangent[component] * u
      + bitangent[component] * v
      + inlet.axis[component] * axialPosition
    ));
    const profileWeight = Math.max(0, 1 - (radial / Math.max(inlet.radius, 1e-6)) ** 2);
    const sourceIndex = normalized.inlets.indexOf(inlet);
    const phase = (sourceIndex + 0.5) / LIVE_HAND_INLET_CAPACITY;
    const offset = index * PARTICLE_FLOATS;
    data.set(position, offset);
    data[offset + 3] = 0;
    data.set(position, offset + 4);
    data.set(inlet.axis.map(value => value * inlet.maximumSpeed * profileWeight), offset + 8);
    data[offset + 11] = -phase;
  }
  return data;
}

function createWaterfallOracleParticles(particleCount, preset) {
  const data = new Float32Array(particleCount * PARTICLE_FLOATS);
  for (let index = 0; index < particleCount; index += 1) {
    const sample = sampleFingerFluidWaterfallOracleParticle(index, preset, { particleCount });
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

export function createFingerFluidTruthSceneParticles(particleCount, scene = 'multi_regime_playground', {
  waterfallOraclePreset = 'baseline',
} = {}) {
  const safeParticleCount = Math.max(1, Math.floor(finite(particleCount, DEFAULT_PARTICLE_COUNT)));
  const effectiveScene = resolveFingerFluidTruthScene(scene);
  if (effectiveScene === 'multi_regime_playground') return createMultiRegimePlaygroundParticles(safeParticleCount);
  if (effectiveScene === 'laminar_inlets') return createLaminarInletParticles(safeParticleCount);
  if (effectiveScene === 'live_hand_inlets') return createFingerFluidLiveInletParticles(safeParticleCount);
  if (effectiveScene === 'waterfall_resolution_oracle') {
    return createWaterfallOracleParticles(safeParticleCount, resolveFingerFluidWaterfallOraclePreset(waterfallOraclePreset));
  }
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
    const active = !isFingerFluidLaminarSourceScene(effectiveScene) || particleData[offset + 11] >= 0;
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
    populationMode: effectiveScene === 'multi_regime_playground' || isFingerFluidLaminarSourceScene(effectiveScene)
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
      : isFingerFluidLaminarSourceScene(effectiveScene) ? NaN : snapshot.finiteParticleCount;
    const dormantParticleCount = Number.isInteger(snapshot.dormantParticleCount)
      ? snapshot.dormantParticleCount
      : isFingerFluidLaminarSourceScene(effectiveScene) ? NaN : 0;
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
    if (effectiveScene !== 'multi_regime_playground' && !isFingerFluidLaminarSourceScene(effectiveScene) && snapshot.sourceRecirculationCount !== 0) {
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

function createInitialMaterialTracers(
  particleData,
  particleCount,
  sourceParticleCount = particleCount,
  {
    sourceOwned = false,
    sourceGeneration = 0,
  } = {},
) {
  const data = new Float32Array(particleCount * MATERIAL_TRACER_FLOATS);
  for (let index = 0; index < particleCount; index += 1) {
    const particlePhase = particleData[index * PARTICLE_FLOATS + 11];
    const phase = index < sourceParticleCount ? Math.abs(particlePhase) : 0;
    const active = index < sourceParticleCount && particlePhase >= 0;
    const offset = index * MATERIAL_TRACER_FLOATS;
    data[offset] = phase;
    data[offset + 1] = 0;
    data[offset + 2] = phase;
    data[offset + 3] = 0;
    const ownership = createFingerFluidInitialParticleOwnershipState({
      active,
      sourceOwned,
      sourceGeneration: sourceOwned ? sourceGeneration : 0,
    });
    data[offset + 16] = ownership.phase;
    data[offset + 17] = ownership.sourceGeneration;
    data[offset + 18] = ownership.transitionFrame;
    data[offset + 19] = ownership.supportContact;
  }
  return data;
}

function createDynamicReflectionMeshData() {
  const positions = [];
  const normals = [];
  const indices = [];
  const addFace = (normal, corners) => {
    const base = positions.length / 4;
    for (const corner of corners) {
      positions.push(...corner, 1);
      normals.push(...normal, 0);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const x = 0.42;
  const y = 0.72;
  const z = 0.20;
  addFace([1, 0, 0], [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]]);
  addFace([-1, 0, 0], [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]]);
  addFace([0, 1, 0], [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]]);
  addFace([0, -1, 0], [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]]);
  addFace([0, 0, 1], [[x, -y, z], [x, y, z], [-x, y, z], [-x, -y, z]]);
  addFace([0, 0, -1], [[-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z]]);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

function dynamicReflectionMeshMatrices(phase) {
  const angle = finite(phase, 0);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const model = new Float32Array([
    cosine, 0, -sine, 0,
    0, 1, 0, 0,
    sine, 0, cosine, 0,
    0.52, -0.02, -0.68, 1,
  ]);
  const normal = new Float32Array(model);
  normal[12] = 0;
  normal[13] = 0;
  normal[14] = 0;
  return { model, normal };
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

export function failFingerFluidWebGPUInitialization({
  provider = null,
  device,
  reason,
  details = {},
} = {}) {
  try {
    provider?.release?.();
  } finally {
    device?.destroy?.();
  }
  return createUnavailableSolver(reason, details);
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
  opticalLightingMode = 'transport_only',
  opticalFootprintMode = 'resolved_detail',
  transmissionFootprintMode = 'resolved_exit',
  bodyTransportMode = 'geometric_slab',
  interfaceFrequencyMode = 'coupled_detail',
  particleShiftStrength = 0,
  supportFriction = KAMINOS_FINGER_FLUID_DEFAULT_SUPPORT_FRICTION,
  chemistryDiffusion = 0,
  capillaryStrength = KAMINOS_FINGER_FLUID_DEFAULT_CAPILLARY_STRENGTH,
  thinSheetVorticityAttenuation = KAMINOS_FINGER_FLUID_DEFAULT_THIN_SHEET_VORTICITY_ATTENUATION,
  freeFlightViscosityBoost = KAMINOS_FINGER_FLUID_DEFAULT_FREE_FLIGHT_VISCOSITY_BOOST,
  unsupportedSheetStrength = KAMINOS_FINGER_FLUID_DEFAULT_UNSUPPORTED_SHEET_STRENGTH,
  adaptiveDensity = false,
  maxFluidSpeed = KAMINOS_FINGER_FLUID_DEFAULT_MAX_SPEED,
  inletCutoffStep = null,
  waterfallOraclePreset = 'baseline',
  transparentBackground = false,
  liveInletPacket = null,
  supportContactRoute = KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE,
  movingHillSupportContactProviderFactory = null,
  composedRevision = null,
} = {}) {
  if (!canvas?.getContext) return createUnavailableSolver('missing canvas');
  if (!globalThis.navigator?.gpu) return createUnavailableSolver('navigator.gpu unavailable');
  const supportShaderSource = supportShaderSourceForRoute(supportContactRoute);
  const safeComposedRevision = typeof composedRevision === 'string' && /^[0-9a-f]{40}$/.test(composedRevision)
    ? composedRevision
    : null;
  if (
    supportContactRoute === KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE
    && !safeComposedRevision
  ) {
    movingHillSupportFailure('composed source revision is missing or invalid');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return createUnavailableSolver('WebGPU adapter unavailable');
  const requiredStorageBindings = 10;
  if (adapter.limits.maxStorageBuffersPerShaderStage < requiredStorageBindings) {
    return createUnavailableSolver(`WebGPU adapter exposes ${adapter.limits.maxStorageBuffersPerShaderStage} storage buffers per shader stage; liquid/fire composition requires ${requiredStorageBindings}`);
  }
  const device = await adapter.requestDevice({
    requiredLimits: { maxStorageBuffersPerShaderStage: requiredStorageBindings },
  });
  let movingHillSupportProvider = null;
  if (supportContactRoute === KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE) {
    if (typeof movingHillSupportContactProviderFactory !== 'function') {
      device.destroy();
      movingHillSupportFailure('provider factory is missing');
    }
    try {
      movingHillSupportProvider = await movingHillSupportContactProviderFactory({
        device,
        queue: device.queue,
      });
      validateFingerFluidMovingHillSupportContactProvider(
        movingHillSupportProvider,
        { device },
      );
    } catch (error) {
      movingHillSupportProvider?.release?.();
      device.destroy();
      throw error;
    }
  }
  function failFingerFluidInitialization(reason, details = {}) {
    return failFingerFluidWebGPUInitialization({
      provider: movingHillSupportProvider,
      device,
      reason,
      details,
    });
  }
  const context = canvas.getContext('webgpu');
  if (!context) return failFingerFluidInitialization('GPUCanvasContext unavailable');
  let hdrEnvironment;
  try {
    hdrEnvironment = await loadFingerFluidHdrEnvironment();
  } catch (error) {
    return failFingerFluidInitialization(`HDR environment initialization failed: ${error.message || String(error)}`);
  }

  const safeBaseParticleCount = resolveFingerFluidParticleCount(particleCount);
  const safeAdaptiveDensity = Boolean(adaptiveDensity);
  const safeParticleCount = safeAdaptiveDensity ? safeBaseParticleCount * 2 : safeBaseParticleCount;
  const particleAllocationCapacity = measureFingerFluidParticleAllocationCapacity(device.limits);
  const particleAllocationPreflight = evaluateFingerFluidParticleAllocationRequest(safeParticleCount, particleAllocationCapacity);
  if (!particleAllocationPreflight.ok) {
    return failFingerFluidInitialization(particleAllocationPreflight.reason, {
      requestedParticleCount: safeBaseParticleCount,
      requestedSimulationCapacity: safeParticleCount,
      effectiveParticleCount: null,
      particleAllocationCapacity,
      particleAllocationPreflight,
    });
  }
  const safeDensityIterations = Math.max(1, Math.floor(finite(densityIterations, 3)));
  const safeSubsteps = Math.max(1, Math.floor(finite(substeps, 1)));
  const safeTruthScene = resolveFingerFluidTruthScene(truthScene);
  const safeWaterfallOraclePreset = resolveFingerFluidWaterfallOraclePreset(waterfallOraclePreset);
  const waterfallOracleConfig = safeTruthScene === 'waterfall_resolution_oracle'
    ? createFingerFluidWaterfallOracleConfig(safeWaterfallOraclePreset)
    : null;
  const safeKernelRadius = waterfallOracleConfig?.kernelRadius ?? 0.185;
  const safeVisibleParticleRadius = waterfallOracleConfig?.visibleParticleRadius ?? 0.046;
  const safeRestDensity = 24.3;
  const safeSourceRefinementFactor = waterfallOracleConfig?.refinementFactor ?? 1;
  const analyticSupportVertexCount = ANALYTIC_SUPPORT_BASE_VERTEX_COUNT
    + (safeTruthScene !== 'live_hand_inlets' && isFingerFluidLaminarSourceScene(safeTruthScene)
      ? ANALYTIC_SUPPORT_INLET_FIXTURE_VERTEX_COUNT
      : 0);
  const safeColorMode = resolveFingerFluidColorMode(colorMode);
  const safeRendererMode = resolveFingerFluidRendererMode(rendererMode);
  const safeOpticalDebugMode = resolveFingerFluidOpticalDebugMode(opticalDebugMode);
  const safeOpticalLightingMode = resolveFingerFluidOpticalLightingMode(opticalLightingMode);
  const safeOpticalFootprintMode = resolveFingerFluidOpticalFootprintMode(opticalFootprintMode);
  const safeTransmissionFootprintMode = resolveFingerFluidTransmissionFootprintMode(transmissionFootprintMode);
  const safeBodyTransportMode = resolveFingerFluidBodyTransportMode(bodyTransportMode);
  const safeInterfaceFrequencyMode = resolveFingerFluidInterfaceFrequencyMode(interfaceFrequencyMode);
  const safeParticleShiftStrength = resolveFingerFluidParticleShiftStrength(particleShiftStrength);
  const safeSupportFriction = resolveFingerFluidSupportFriction(supportFriction);
  const safeChemistryDiffusion = resolveFingerFluidChemistryDiffusion(chemistryDiffusion);
  const safeCapillaryStrength = resolveFingerFluidCapillaryStrength(capillaryStrength);
  const safeThinSheetVorticityAttenuation = resolveFingerFluidThinSheetVorticityAttenuation(thinSheetVorticityAttenuation);
  const safeFreeFlightViscosityBoost = resolveFingerFluidFreeFlightViscosityBoost(freeFlightViscosityBoost);
  const safeUnsupportedSheetStrength = resolveFingerFluidUnsupportedSheetStrength(unsupportedSheetStrength);
  const safeMaxFluidSpeed = resolveFingerFluidMaxSpeed(maxFluidSpeed);
  const safeInletCutoffStep = resolveFingerFluidInletCutoffStep(inletCutoffStep);
  const initialLiveInletPacket = packFingerFluidLiveInletPacket(liveInletPacket, safeBaseParticleCount);
  let currentLiveInletPacket = initialLiveInletPacket.normalized;
  let currentLiveInletEconomics = initialLiveInletPacket.economics;
  let liveInletActivated = currentLiveInletEconomics.effectiveActiveInletCount > 0;
  let liveInletReleasePlan = measureFingerFluidLiveInletReleasePlan(liveInletPacket, safeBaseParticleCount);
  const initialLiveInletPublicationState = createFingerFluidLiveInletPublicationState(
    liveInletPacket,
    currentLiveInletEconomics,
    liveInletReleasePlan,
  );
  const liveInletPublicationHistory = [...initialLiveInletPublicationState.publications];
  const liquidFireContactAllocationGeneration = nextLiquidFireContactAllocationGeneration;
  nextLiquidFireContactAllocationGeneration = (nextLiquidFireContactAllocationGeneration % 0x00fffffe) + 1;
  const liquidFireContactEpoch = 1;
  const baseParticleData = safeTruthScene === 'live_hand_inlets'
    ? createFingerFluidLiveInletParticles(safeBaseParticleCount, liveInletPacket)
    : createFingerFluidTruthSceneParticles(safeBaseParticleCount, safeTruthScene, {
      waterfallOraclePreset: safeWaterfallOraclePreset,
    });
  const particleData = new Float32Array(safeParticleCount * PARTICLE_FLOATS);
  particleData.set(baseParticleData);
  for (let index = safeBaseParticleCount; index < safeParticleCount; index += 1) {
    particleData[index * PARTICLE_FLOATS + 11] = -2;
  }
  const laminarSourcePopulation = safeTruthScene === 'laminar_inlets'
    ? createFingerFluidLaminarSourcePopulation(safeBaseParticleCount)
    : null;
  const materialTracerData = createInitialMaterialTracers(
    particleData,
    safeParticleCount,
    safeBaseParticleCount,
    {
      sourceOwned: isFingerFluidLaminarSourceScene(safeTruthScene),
      sourceGeneration: initialLiveInletPublicationState.generation || 1,
    },
  );
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
    size: 208,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const liveInletBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-live-inlets',
    size: LIVE_HAND_INLET_CAPACITY * LIVE_HAND_INLET_FLOATS * 4,
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
    size: INTERFACE_COUNTER_BYTES,
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
  let analyticCarrierParticleBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-analytic-carrier-particles-inactive',
    size: PARTICLE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let analyticCarrierNeighborTopologyBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-analytic-carrier-topology-inactive',
    size: NEIGHBOR_TOPOLOGY_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let analyticCarrierMaterialTracerBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-analytic-carrier-tracers-inactive',
    size: MATERIAL_TRACER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const interfaceCountersReadbackBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-interface-counters-readback',
    size: INTERFACE_COUNTER_BYTES,
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
  device.queue.writeBuffer(interfaceCountersBuffer, 0, new Uint32Array(INTERFACE_COUNTER_WORDS));
  device.queue.writeBuffer(liquidFireContactHeaderBuffer, 0, new Uint32Array(LIQUID_FIRE_CONTACT_HEADER_WORDS));
  device.queue.writeBuffer(restStateBuffer, 0, new Float32Array(safeParticleCount * REST_STATE_FLOATS));
  const initialTopology = new Uint32Array(safeParticleCount * NEIGHBOR_TOPOLOGY_WORDS);
  const initialTopologyFloats = new Float32Array(initialTopology.buffer);
  for (let index = 0; index < safeParticleCount; index += 1) {
    initialTopology.fill(INVALID_NEIGHBOR_ID, index * NEIGHBOR_TOPOLOGY_WORDS, index * NEIGHBOR_TOPOLOGY_WORDS + 4);
    initialTopology.fill(INVALID_NEIGHBOR_ID, index * NEIGHBOR_TOPOLOGY_WORDS + 12, index * NEIGHBOR_TOPOLOGY_WORDS + 16);
    const diagnosticOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 20;
    initialTopologyFloats[diagnosticOffset] = index < safeBaseParticleCount
      ? KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.disabled
      : KAMINOS_FINGER_FLUID_SHEET_RELEASE_REASON_CODES.dormant;
    const refinementOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 32;
    initialTopologyFloats[refinementOffset] = index < safeBaseParticleCount ? 1 : 0;
    initialTopologyFloats[refinementOffset + 1] = index < safeBaseParticleCount ? 0 : 2;
  }
  device.queue.writeBuffer(neighborTopologyBuffer, 0, initialTopology);
  device.queue.writeBuffer(materialTracerBuffer, 0, materialTracerData);
  device.queue.writeBuffer(liveInletBuffer, 0, initialLiveInletPacket.data);

  const dynamicReflectionMeshData = createDynamicReflectionMeshData();
  const dynamicReflectionMeshPositionBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-dynamic-reflection-mesh-positions',
    size: dynamicReflectionMeshData.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const dynamicReflectionMeshNormalBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-dynamic-reflection-mesh-normals',
    size: dynamicReflectionMeshData.normals.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const dynamicReflectionMeshIndexBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-dynamic-reflection-mesh-indices',
    size: dynamicReflectionMeshData.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const dynamicReflectionSceneParamsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-dynamic-reflection-scene-params',
    size: 160,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(dynamicReflectionMeshPositionBuffer, 0, dynamicReflectionMeshData.positions);
  device.queue.writeBuffer(dynamicReflectionMeshNormalBuffer, 0, dynamicReflectionMeshData.normals);
  device.queue.writeBuffer(dynamicReflectionMeshIndexBuffer, 0, dynamicReflectionMeshData.indices);

  const computeShader = COMPUTE_SHADER
    .replaceAll(
      KAMINOS_FINGER_FLUID_COMPUTE_MAX_SPEED_TOKEN,
      String(safeMaxFluidSpeed),
    )
    .replace(KAMINOS_FINGER_FLUID_SUPPORT_BINDINGS_TOKEN, supportShaderSource.bindings)
    .replace(KAMINOS_FINGER_FLUID_SUPPORT_FUNCTIONS_TOKEN, supportShaderSource.functions);
  const computeModule = device.createShaderModule({ label: KAMINOS_FINGER_FLUID_GPU_SHADER_ROUTE, code: computeShader });
  const movingHillComputeLayoutEntries = movingHillSupportProvider
    ? [
      {
        binding: 12,
        visibility: GPUShaderStage.COMPUTE,
        texture: {
          sampleType: 'unfilterable-float',
          viewDimension: '2d-array',
          multisampled: false,
        },
      },
      { binding: 13, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]
    : [];
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
      { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ...movingHillComputeLayoutEntries,
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
      classifyUnsupportedSheet: await pipelineFor('classify_unsupported_sheet'),
      applyUnsupportedSheet: await pipelineFor('apply_unsupported_sheet_support'),
      commitUnsupportedSheet: await pipelineFor('commit_unsupported_sheet_support'),
      cohesion: await pipelineFor('apply_surface_cohesion'),
      applyVelocity: await pipelineFor('apply_velocity_position'),
      adaptiveDensity: await pipelineFor('adaptive_refine_or_merge'),
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
    return failFingerFluidInitialization(`WebGPU compute pipeline validation failed: ${error.message || String(error)}`);
  }
  let computeBindGroup;
  try {
    computeBindGroup = device.createBindGroup({
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
        { binding: 11, resource: { buffer: liveInletBuffer } },
        ...(movingHillSupportProvider ? [
          { binding: 12, resource: movingHillSupportProvider.sampleTextureView },
          { binding: 13, resource: { buffer: movingHillSupportProvider.paramsBuffer } },
        ] : []),
      ],
    });
  } catch (error) {
    return failFingerFluidInitialization(`WebGPU compute bind group validation failed: ${error.message || String(error)}`);
  }
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
    return failFingerFluidInitialization(`WebGPU energy diagnostic pipeline validation failed: ${error.message || String(error)}`);
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
  const hdrEnvironmentTexture = device.createTexture({
    label: 'kaminos-finger-fluid-hdr-environment-rgbe',
    size: [hdrEnvironment.width, hdrEnvironment.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const hdrEnvironmentUnpaddedBytesPerRow = hdrEnvironment.width * 4;
  const hdrEnvironmentBytesPerRow = Math.ceil(hdrEnvironmentUnpaddedBytesPerRow / 256) * 256;
  let hdrEnvironmentUpload = hdrEnvironment.rgbe;
  if (hdrEnvironmentBytesPerRow !== hdrEnvironmentUnpaddedBytesPerRow) {
    hdrEnvironmentUpload = new Uint8Array(hdrEnvironmentBytesPerRow * hdrEnvironment.height);
    for (let row = 0; row < hdrEnvironment.height; row += 1) {
      const sourceOffset = row * hdrEnvironmentUnpaddedBytesPerRow;
      hdrEnvironmentUpload.set(
        hdrEnvironment.rgbe.subarray(sourceOffset, sourceOffset + hdrEnvironmentUnpaddedBytesPerRow),
        row * hdrEnvironmentBytesPerRow,
      );
    }
  }
  device.queue.writeTexture(
    { texture: hdrEnvironmentTexture },
    hdrEnvironmentUpload,
    { bytesPerRow: hdrEnvironmentBytesPerRow, rowsPerImage: hdrEnvironment.height },
    { width: hdrEnvironment.width, height: hdrEnvironment.height, depthOrArrayLayers: 1 },
  );
  const renderParamsBuffer = device.createBuffer({
    label: 'kaminos-finger-fluid-render-params',
    size: 176,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderModule = device.createShaderModule({ label: KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE, code: RENDER_SHADER });
  const screenSpaceModule = device.createShaderModule({ label: KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE, code: SCREEN_SPACE_SURFACE_SHADER });
  const analyticSupportPresentationModule = device.createShaderModule({
    label: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
    code: ANALYTIC_SUPPORT_PRESENTATION_SHADER,
  });
  const dynamicIndexedMeshModule = device.createShaderModule({
    label: KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
    code: DYNAMIC_INDEXED_MESH_SHADER,
  });
  const hdrWorldBackgroundModule = device.createShaderModule({
    label: KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE,
    code: HDR_WORLD_BACKGROUND_SHADER,
  });
  const finalPresentationModule = device.createShaderModule({
    label: KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE,
    code: FINAL_PRESENTATION_SHADER,
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
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ],
  });
  const analyticSupportPresentationLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-analytic-support-presentation-layout',
    entries: [
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
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
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 13, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 14, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 15, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const dynamicIndexedMeshLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-dynamic-indexed-mesh-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const hdrWorldBackgroundLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-hdr-world-background-layout',
    entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const finalPresentationLayout = device.createBindGroupLayout({
    label: 'kaminos-finger-fluid-final-presentation-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  });
  const screenSpaceAccumulationPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [screenSpaceAccumulationLayout] });
  const screenSpaceCompositePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [screenSpaceCompositeLayout] });
  const analyticSupportPresentationPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [analyticSupportPresentationLayout] });
  const screenSpaceRefractionCompositePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [screenSpaceRefractionCompositeLayout] });
  const dynamicIndexedMeshPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [dynamicIndexedMeshLayout] });
  const hdrWorldBackgroundPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [hdrWorldBackgroundLayout] });
  const finalPresentationPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [finalPresentationLayout] });
  let renderPipeline;
  let screenSpaceSurfaceAccumulationPipeline;
  let screenSpaceSurfaceCompositePipeline;
  let analyticSupportPresentationPipeline;
  let screenSpaceRefractionCompositePipeline;
  let dynamicIndexedMeshPipeline;
  let hdrWorldBackgroundPipeline;
  let finalPresentationPipeline;
  try {
    renderPipeline = await device.createRenderPipelineAsync({
      label: KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE,
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: LINEAR_SCENE_FORMAT,
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
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
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
          format: LINEAR_SCENE_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    analyticSupportPresentationPipeline = await device.createRenderPipelineAsync({
      label: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
      layout: analyticSupportPresentationPipelineLayout,
      vertex: { module: analyticSupportPresentationModule, entryPoint: 'vs_analytic_support_presentation' },
      fragment: {
        module: analyticSupportPresentationModule,
        entryPoint: 'fs_analytic_support_presentation',
        targets: [
          { format: LINEAR_SCENE_FORMAT },
          { format: 'rgba16float' },
          { format: 'rgba8unorm' },
          { format: 'rgba16float' },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    dynamicIndexedMeshPipeline = await device.createRenderPipelineAsync({
      label: KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
      layout: dynamicIndexedMeshPipelineLayout,
      vertex: {
        module: dynamicIndexedMeshModule,
        entryPoint: 'vs_dynamic_indexed_mesh',
        buffers: [
          { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] },
        ],
      },
      fragment: {
        module: dynamicIndexedMeshModule,
        entryPoint: 'fs_dynamic_indexed_mesh',
        targets: [
          { format: LINEAR_SCENE_FORMAT },
          { format: 'rgba16float' },
          { format: 'rgba8unorm' },
          { format: 'rgba16float' },
        ],
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
        targets: [{
          format: LINEAR_SCENE_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    hdrWorldBackgroundPipeline = await device.createRenderPipelineAsync({
      label: KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE,
      layout: hdrWorldBackgroundPipelineLayout,
      vertex: { module: hdrWorldBackgroundModule, entryPoint: 'vs_hdr_world_background' },
      fragment: {
        module: hdrWorldBackgroundModule,
        entryPoint: 'fs_hdr_world_background',
        targets: [{ format: LINEAR_SCENE_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    finalPresentationPipeline = await device.createRenderPipelineAsync({
      label: KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE,
      layout: finalPresentationPipelineLayout,
      vertex: { module: finalPresentationModule, entryPoint: 'vs_final_presentation' },
      fragment: {
        module: finalPresentationModule,
        entryPoint: 'fs_final_presentation',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
  } catch (error) {
    return failFingerFluidInitialization(`WebGPU render pipeline validation failed: ${error.message || String(error)}`);
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
      { binding: 12, resource: hdrEnvironmentTexture.createView() },
    ],
  });
  const dynamicIndexedMeshBindGroup = device.createBindGroup({
    label: 'kaminos-finger-fluid-dynamic-indexed-mesh-bind-group',
    layout: dynamicIndexedMeshLayout,
    entries: [
      { binding: 0, resource: { buffer: dynamicReflectionSceneParamsBuffer } },
      { binding: 1, resource: { buffer: renderParamsBuffer } },
      { binding: 12, resource: hdrEnvironmentTexture.createView() },
    ],
  });
  const hdrWorldBackgroundBindGroup = device.createBindGroup({
    label: 'kaminos-finger-fluid-hdr-world-background-bind-group',
    layout: hdrWorldBackgroundLayout,
    entries: [
      { binding: 1, resource: { buffer: renderParamsBuffer } },
      { binding: 12, resource: hdrEnvironmentTexture.createView() },
    ],
  });

  let screenSpaceSurfaceAccumulationTexture = null;
  let screenSpaceOpticalSlabFrontDepthTexture = null;
  let screenSpaceOpticalSlabBackDepthTexture = null;
  let screenSpaceSurfaceAccumulationBindGroup = null;
  let analyticCarrierAccumulationBindGroup = null;
  let screenSpaceSurfaceCompositeBindGroup = null;
  let screenSpaceRefractionSceneTexture = null;
  let screenSpaceRefractionCompositeBindGroup = null;
  let linearSceneRadianceTexture = null;
  let finalPresentationBindGroup = null;
  let deferredWorldNormalRoughnessTexture = null;
  let deferredAlbedoMetallicTexture = null;
  let deferredLinearDepthObjectTexture = null;
  const screenSpaceRefractionSceneSampler = device.createSampler({
    label: 'kaminos-finger-fluid-refraction-scene-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
  });

  let depthTexture = null;
  let configuredExtent = '';
  let runtimeApi = null;
  let frameIndex = 0;
  let stepCount = 0;
  let liveInletPlanStep = 0;
  let liveInletGeneration = initialLiveInletPublicationState.generation;
  let liveInletReleaseEpochFrame = initialLiveInletPublicationState.releaseEpochFrame;
  let linkedCellGridBuildCount = 0;
  let densityIterationCount = 0;
  let vorticityPassCount = 0;
  let postProjectionGridRefreshCount = 0;
  let freeSurfaceClassificationPassCount = 0;
  let surfaceCohesionPassCount = 0;
  let sheetSupportPassCount = 0;
  let adaptiveDensityPassCount = 0;
  let interfaceCompactionPassCount = 0;
  let topologyMeasurementPassCount = 0;
  let particleShiftPassCount = 0;
  let chemistryDiffusionPassCount = 0;
  let liquidFireContactCompactionPassCount = 0;
  let directRenderFrameCount = 0;
  let sphereDebugRenderFrameCount = 0;
  let screenSpaceSurfaceRenderFrameCount = 0;
  let screenSpaceSurfaceAccumulationPassCount = 0;
  let analyticCarrierAccumulationDrawCount = 0;
  let analyticCarrierLastFrameDrawCount = 0;
  let screenSpaceOpticalSlabGeometryPassCount = 0;
  let screenSpaceSurfaceCompositePassCount = 0;
  let analyticSupportDepthPassCount = 0;
  let analyticSupportPresentationPassCount = 0;
  let particleSupportDrawCount = 0;
  let screenSpaceRefractionRenderFrameCount = 0;
  let screenSpaceRefractionScenePassCount = 0;
  let screenSpaceRefractionCompositePassCount = 0;
  let deferredScenePassCount = 0;
  let dynamicIndexedMeshDrawCount = 0;
  let worldSpaceReflectionCompositePassCount = 0;
  let hybridOpticalQueryCompositePassCount = 0;
  let hdrWorldBackgroundPassCount = 0;
  let finalPresentationPassCount = 0;
  let lastRenderFrameId = 0;
  let lastDeferredSceneFrameId = 0;
  let lastDynamicIndexedMeshDrawFrameId = 0;
  let lastReflectionProviderFrameId = 0;
  let lastOpticalQueryFrameId = 0;
  let reflectionMeshPhase = 0.36;
  let reflectionMeshTransformGeneration = 1;
  let lastDeferredMeshTransformGeneration = 0;
  let lastDeferredMeshPhase = 0;
  let lastReflectionProviderTransformGeneration = 0;
  let lastReflectionProviderPhase = 0;
  let reflectionMeshWitnessOverride = false;
  let lastDynamicMeshPresentationMode = 'deferred_scene_visible_v0';
  let lastEffectiveRendererMode = safeRendererMode;
  let lastRequestedRendererMode = safeRendererMode;
  let lastOpticalDebugMode = safeOpticalDebugMode;
  let lastRequestedOpticalLightingMode = safeOpticalLightingMode;
  let lastEffectiveOpticalLightingMode = safeRendererMode === 'screen_space_refraction'
    ? safeOpticalLightingMode
    : 'not_executed';
  let lastOpticalLightingFallbackReason = null;
  let lastRequestedOpticalFootprintMode = safeOpticalFootprintMode;
  let lastEffectiveOpticalFootprintMode = safeRendererMode === 'screen_space_refraction'
    ? safeOpticalFootprintMode
    : 'not_executed';
  let lastOpticalFootprintFallbackReason = null;
  let lastRequestedTransmissionFootprintMode = safeTransmissionFootprintMode;
  let lastEffectiveTransmissionFootprintMode = safeRendererMode === 'screen_space_refraction'
    ? safeTransmissionFootprintMode
    : 'not_executed';
  let lastTransmissionFootprintFallbackReason = null;
  let lastRequestedBodyTransportMode = safeBodyTransportMode;
  let lastEffectiveBodyTransportMode = safeRendererMode === 'screen_space_refraction'
    ? safeBodyTransportMode
    : 'not_executed';
  let lastBodyTransportFallbackReason = null;
  let lastRequestedInterfaceFrequencyMode = safeInterfaceFrequencyMode;
  let lastEffectiveInterfaceFrequencyMode = safeRendererMode === 'screen_space_refraction'
    ? safeInterfaceFrequencyMode
    : 'not_executed';
  let lastInterfaceFrequencyFallbackReason = null;
  let lastRendererFallbackReason = null;
  let lastFrameCpuMs = 0;
  let diagnosticsPending = false;
  let diagnosticsRequestCount = 0;
  let diagnosticsCompletionCount = 0;
  let diagnosticsLastDurationMs = 0;
  let diagnostics = null;
  let analyticCarrierOpticalGeometry = null;
  let analyticCarrierGpuPayload = null;
  let analyticCarrierSampleCount = 0;
  let canonicalParticleVisibility = 'all';
  let analyticCarrierRouteEvidence = {
    schema: 'kaminos.finger-fluid.analytic-carrier-live-route-evidence.v1',
    status: 'inactive_not_requested',
    requestedRoute: null,
    effectiveRoute: null,
    fallbackRoute: null,
    blank: null,
    partial: null,
    failurePhase: null,
    lastTrustworthyEvidence: 'analytic-carrier-not-requested',
  };
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
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
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
    linearSceneRadianceTexture?.destroy();
    linearSceneRadianceTexture = device.createTexture({
      label: 'kaminos-finger-fluid-linear-scene-radiance',
      size: [targetWidth, targetHeight],
      format: LINEAR_SCENE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    screenSpaceRefractionSceneTexture?.destroy();
    screenSpaceRefractionSceneTexture = device.createTexture({
      label: 'kaminos-finger-fluid-refraction-scene-color',
      size: [targetWidth, targetHeight],
      format: LINEAR_SCENE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    deferredWorldNormalRoughnessTexture?.destroy();
    deferredWorldNormalRoughnessTexture = device.createTexture({
      label: 'kaminos-finger-fluid-deferred-world-normal-roughness',
      size: [targetWidth, targetHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    deferredAlbedoMetallicTexture?.destroy();
    deferredAlbedoMetallicTexture = device.createTexture({
      label: 'kaminos-finger-fluid-deferred-albedo-metallic',
      size: [targetWidth, targetHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    deferredLinearDepthObjectTexture?.destroy();
    deferredLinearDepthObjectTexture = device.createTexture({
      label: 'kaminos-finger-fluid-deferred-linear-depth-object',
      size: [targetWidth, targetHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
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
    analyticCarrierAccumulationBindGroup = device.createBindGroup({
      label: 'kaminos-finger-fluid-analytic-carrier-accumulation-bind-group',
      layout: screenSpaceAccumulationLayout,
      entries: [
        { binding: 0, resource: { buffer: analyticCarrierParticleBuffer } },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 2, resource: { buffer: analyticCarrierNeighborTopologyBuffer } },
        { binding: 3, resource: { buffer: analyticCarrierMaterialTracerBuffer } },
      ],
    });
    screenSpaceSurfaceCompositeBindGroup = device.createBindGroup({
      label: 'kaminos-finger-fluid-screen-space-composite-bind-group',
      layout: screenSpaceCompositeLayout,
      entries: [
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 4, resource: screenSpaceSurfaceAccumulationTexture.createView() },
        { binding: 7, resource: screenSpaceOpticalSlabFrontDepthTexture.createView() },
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
        { binding: 9, resource: { buffer: dynamicReflectionMeshPositionBuffer } },
        { binding: 10, resource: { buffer: dynamicReflectionMeshIndexBuffer } },
        { binding: 11, resource: { buffer: dynamicReflectionSceneParamsBuffer } },
        { binding: 12, resource: hdrEnvironmentTexture.createView() },
        { binding: 13, resource: deferredLinearDepthObjectTexture.createView() },
        { binding: 14, resource: deferredWorldNormalRoughnessTexture.createView() },
        { binding: 15, resource: deferredAlbedoMetallicTexture.createView() },
      ],
    });
    finalPresentationBindGroup = device.createBindGroup({
      label: 'kaminos-finger-fluid-final-presentation-bind-group',
      layout: finalPresentationLayout,
      entries: [
        { binding: 0, resource: linearSceneRadianceTexture.createView() },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 2, resource: screenSpaceSurfaceAccumulationTexture.createView() },
        { binding: 3, resource: screenSpaceOpticalSlabFrontDepthTexture.createView() },
        { binding: 4, resource: depthTexture.createView() },
      ],
    });
    configuredExtent = key;
    return { width: targetWidth, height: targetHeight };
  }

  function writeDynamicReflectionSceneParams() {
    const { model, normal } = dynamicReflectionMeshMatrices(reflectionMeshPhase);
    const data = new Float32Array(40);
    data.set(model, 0);
    data.set(normal, 16);
    data.set([0.90, 0.10, 0.045, 0.24], 32);
    data.set([DYNAMIC_REFLECTION_MESH_OBJECT_ID, 0.68, reflectionMeshPhase, reflectionMeshTransformGeneration], 36);
    device.queue.writeBuffer(dynamicReflectionSceneParamsBuffer, 0, data);
  }

  function setReflectionMeshPhaseForWitness(phase) {
    const nextPhase = Number(phase);
    if (!Number.isFinite(nextPhase) || Math.abs(nextPhase) > Math.PI * 8) {
      throw new RangeError(`Finger Fluid reflection mesh phase must be finite and bounded, received: ${phase}`);
    }
    if (nextPhase !== reflectionMeshPhase) reflectionMeshTransformGeneration += 1;
    reflectionMeshPhase = nextPhase;
    reflectionMeshWitnessOverride = true;
    writeDynamicReflectionSceneParams();
    return {
      schema: 'kaminos.dynamic-indexed-mesh-transform.v0',
      objectId: DYNAMIC_REFLECTION_MESH_OBJECT_ID,
      phase: reflectionMeshPhase,
      transformGeneration: reflectionMeshTransformGeneration,
      stepCount,
    };
  }

  function setAnalyticCarrierOpticalGeometry(
    geometry,
    { canonicalParticleVisibility: requestedCanonicalParticleVisibility = 'matching_pre_impact_suppressed' } = {},
  ) {
    if (safeTruthScene !== 'live_hand_inlets') {
      analyticCarrierRouteEvidence = {
        schema: 'kaminos.finger-fluid.analytic-carrier-live-route-evidence.v1',
        status: 'rejected',
        requestedRoute: geometry?.route?.requested ?? null,
        effectiveRoute: null,
        fallbackRoute: null,
        blank: true,
        partial: false,
        failurePhase: 'truth-scene-admission',
        lastTrustworthyEvidence: `truth-scene:${safeTruthScene}`,
      };
      throw new Error('analytic carrier optics require the live_hand_inlets truth scene');
    }
    if (!['matching_pre_impact_suppressed', 'hidden'].includes(requestedCanonicalParticleVisibility)) {
      throw new RangeError(
        `Unsupported analytic carrier canonical particle visibility: ${requestedCanonicalParticleVisibility}`,
      );
    }
    let payload;
    try {
      payload = createFingerFluidAnalyticCarrierGpuPayload(geometry, safeVisibleParticleRadius);
    } catch (error) {
      analyticCarrierRouteEvidence = {
        schema: 'kaminos.finger-fluid.analytic-carrier-live-route-evidence.v1',
        status: 'failed_before_gpu_upload',
        requestedRoute: geometry?.route?.requested ?? null,
        effectiveRoute: null,
        fallbackRoute: null,
        blank: true,
        partial: false,
        failurePhase: 'gpu-payload-construction',
        lastTrustworthyEvidence: error?.report?.lastTrustworthyEvidence ?? 'geometry-received',
        error: error?.message || String(error),
      };
      throw error;
    }
    const nextParticleBuffer = device.createBuffer({
      label: `kaminos-finger-fluid-analytic-carrier-particles:${payload.source.packetId}`,
      size: payload.particles.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const nextTopologyBuffer = device.createBuffer({
      label: `kaminos-finger-fluid-analytic-carrier-topology:${payload.source.packetId}`,
      size: payload.neighborTopology.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const nextTracerBuffer = device.createBuffer({
      label: `kaminos-finger-fluid-analytic-carrier-tracers:${payload.source.packetId}`,
      size: payload.materialTracers.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(nextParticleBuffer, 0, payload.particles);
    device.queue.writeBuffer(nextTopologyBuffer, 0, payload.neighborTopology);
    device.queue.writeBuffer(nextTracerBuffer, 0, payload.materialTracers);
    const nextBindGroup = device.createBindGroup({
      label: `kaminos-finger-fluid-analytic-carrier-accumulation-bind-group:${payload.source.packetId}`,
      layout: screenSpaceAccumulationLayout,
      entries: [
        { binding: 0, resource: { buffer: nextParticleBuffer } },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 2, resource: { buffer: nextTopologyBuffer } },
        { binding: 3, resource: { buffer: nextTracerBuffer } },
      ],
    });
    analyticCarrierParticleBuffer.destroy();
    analyticCarrierNeighborTopologyBuffer.destroy();
    analyticCarrierMaterialTracerBuffer.destroy();
    analyticCarrierParticleBuffer = nextParticleBuffer;
    analyticCarrierNeighborTopologyBuffer = nextTopologyBuffer;
    analyticCarrierMaterialTracerBuffer = nextTracerBuffer;
    analyticCarrierAccumulationBindGroup = nextBindGroup;
    analyticCarrierOpticalGeometry = geometry;
    analyticCarrierGpuPayload = payload;
    analyticCarrierSampleCount = payload.sampleCount;
    canonicalParticleVisibility = requestedCanonicalParticleVisibility;
    analyticCarrierRouteEvidence = {
      schema: 'kaminos.finger-fluid.analytic-carrier-live-route-evidence.v1',
      status: 'admitted',
      requestedRoute: payload.route.requested,
      effectiveRoute: payload.route.effective,
      fallbackRoute: null,
      sourcePacketId: payload.source.packetId,
      sourceRoute: payload.source.sourceRoute,
      sourceArtifactSha256: payload.source.artifactSha256,
      sourceGeneration: payload.source.generation,
      sourceMechanicsRevision: payload.source.sourceMechanicsRevision,
      ageContract: KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT,
      supportSourceId: payload.supportIdentity.sourceId,
      supportEpoch: payload.supportIdentity.supportEpoch,
      remapEpoch: payload.supportIdentity.remapEpoch,
      handoffReceiptId: payload.handoffReceiptId,
      sampleCount: payload.sampleCount,
      particleSuppressionContract: payload.particleSuppression.contract,
      canonicalParticleVisibility,
      blank: false,
      partial: false,
      doubleRendered: false,
      failurePhase: null,
      lastTrustworthyEvidence: 'carrier-storage-uploaded-and-bind-group-created',
    };
    return { ...analyticCarrierRouteEvidence };
  }

  function clearAnalyticCarrierOpticalGeometry() {
    analyticCarrierOpticalGeometry = null;
    analyticCarrierGpuPayload = null;
    analyticCarrierSampleCount = 0;
    canonicalParticleVisibility = 'all';
    analyticCarrierRouteEvidence = {
      schema: 'kaminos.finger-fluid.analytic-carrier-live-route-evidence.v1',
      status: 'inactive_not_requested',
      requestedRoute: null,
      effectiveRoute: null,
      fallbackRoute: null,
      sourcePacketId: null,
      sourceRoute: null,
      sourceArtifactSha256: null,
      sourceGeneration: null,
      sourceMechanicsRevision: null,
      ageContract: null,
      supportSourceId: null,
      supportEpoch: null,
      remapEpoch: null,
      handoffReceiptId: null,
      sampleCount: 0,
      particleSuppressionContract: null,
      canonicalParticleVisibility,
      blank: null,
      partial: null,
      failurePhase: null,
      lastTrustworthyEvidence: 'analytic-carrier-cleared-explicitly',
    };
    return { ...analyticCarrierRouteEvidence };
  }

  function writeSimulationParams(dt) {
    const buffer = new ArrayBuffer(208);
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
    view.setFloat32(64, safeKernelRadius, true);
    view.setFloat32(68, safeRestDensity, true);
    view.setFloat32(72, 0.012, true);
    view.setFloat32(76, 0.22, true);
    view.setFloat32(80, -9.2, true);
    view.setFloat32(84, 0.991, true);
    view.setFloat32(88, 0.07, true);
    view.setFloat32(92, 0.025, true);
    view.setFloat32(96, safeParticleShiftStrength, true);
    view.setFloat32(100, safeSupportFriction, true);
    view.setFloat32(
      104,
      safeTruthScene === 'live_hand_inlets' ? 3 : safeTruthScene === 'waterfall_resolution_oracle' ? 2 : safeTruthScene === 'laminar_inlets' ? 1 : 0,
      true,
    );
    view.setFloat32(108, safeSourceRefinementFactor, true);
    view.setFloat32(112, safeChemistryDiffusion, true);
    view.setFloat32(116, safeCapillaryStrength, true);
    view.setFloat32(120, safeThinSheetVorticityAttenuation, true);
    view.setFloat32(124, safeFreeFlightViscosityBoost, true);
    view.setFloat32(128, safeUnsupportedSheetStrength, true);
    view.setFloat32(132, 0.62, true);
    view.setFloat32(136, 0.66, true);
    view.setFloat32(140, 0.78, true);
    view.setUint32(144, liquidFireContactAllocationGeneration, true);
    view.setUint32(148, liquidFireContactEpoch, true);
    view.setUint32(152, LIQUID_FIRE_CONTACT_SOURCE_FRAME_HASH, true);
    view.setUint32(156, 1, true);
    view.setUint32(160, safeInletCutoffStep ?? 0xffffffff, true);
    view.setUint32(164, safeInletCutoffStep === null ? 0 : 1, true);
    view.setUint32(168, waterfallOracleConfig?.laneColumns ?? 0, true);
    view.setUint32(172, waterfallOracleConfig?.laneRows ?? 0, true);
    view.setUint32(176, safeBaseParticleCount, true);
    view.setUint32(180, safeAdaptiveDensity ? 1 : 0, true);
    view.setUint32(184, safeParticleCount, true);
    view.setUint32(188, 1, true);
    view.setUint32(192, liveInletGeneration, true);
    view.setUint32(196, liveInletReleaseEpochFrame, true);
    view.setUint32(200, 0, true);
    view.setUint32(204, 0, true);
    device.queue.writeBuffer(paramsBuffer, 0, buffer);
  }

  function setLiveInletPacket(packet) {
    if (safeTruthScene !== 'live_hand_inlets') {
      throw new Error(`Live inlet packets require truthScene live_hand_inlets, not ${safeTruthScene}`);
    }
    const packed = packFingerFluidLiveInletPacket(packet, safeBaseParticleCount);
    liveInletGeneration = (liveInletGeneration % 0x00fffffe) + 1;
    liveInletReleaseEpochFrame = frameIndex;
    currentLiveInletPacket = packed.normalized;
    currentLiveInletEconomics = packed.economics;
    liveInletReleasePlan = measureFingerFluidLiveInletReleasePlan(packet, safeBaseParticleCount);
    liveInletPublicationHistory.push(Object.freeze({
      generation: liveInletGeneration,
      packetId: currentLiveInletPacket.packetId,
      sourceRoute: currentLiveInletPacket.sourceRoute,
      artifactSha256: currentLiveInletPacket.artifactSha256,
      expectedEconomics: currentLiveInletEconomics,
      releasePlan: liveInletReleasePlan,
    }));
    device.queue.writeBuffer(liveInletBuffer, 0, packed.data);
    device.queue.writeBuffer(interfaceCountersBuffer, 2 * Uint32Array.BYTES_PER_ELEMENT, new Uint32Array([0]));
    device.queue.writeBuffer(interfaceCountersBuffer, 5 * Uint32Array.BYTES_PER_ELEMENT, new Uint32Array([0, 0]));
    device.queue.writeBuffer(interfaceCountersBuffer, 9 * Uint32Array.BYTES_PER_ELEMENT, new Uint32Array([0]));
    liveInletPlanStep = stepCount;
    const firstActivation = !liveInletActivated && currentLiveInletEconomics.effectiveActiveInletCount > 0;
    if (firstActivation) liveInletActivated = true;
    return {
      contract: KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
      ageContract: KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT,
      releaseContract: KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT,
      packetId: currentLiveInletPacket.packetId,
      sourceRoute: currentLiveInletPacket.sourceRoute,
      activeInletCount: currentLiveInletEconomics.effectiveActiveInletCount,
      requestedActiveInletCount: currentLiveInletEconomics.requestedActiveInletCount,
      effectiveReservedInletCount: currentLiveInletEconomics.effectiveReservedInletCount,
      effectiveActiveInletCount: currentLiveInletEconomics.effectiveActiveInletCount,
      economicsContract: KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
      cohortContract: KAMINOS_FINGER_FLUID_LIVE_INLET_COHORT_CONTRACT,
      generation: liveInletGeneration,
      artifactSha256: currentLiveInletPacket.artifactSha256,
      poolCapacity: currentLiveInletEconomics.poolCapacity,
      effectiveReleasePoolBudget: currentLiveInletEconomics.effectiveReleasePoolBudget,
      unallocatedDormantParticleCount: currentLiveInletEconomics.unallocatedDormantParticleCount,
      expectedParticleReleaseRate: liveInletReleasePlan.expectedParticleReleaseRate,
      expectedParticlesPerReferenceFrame: liveInletReleasePlan.expectedParticlesPerReferenceFrame,
      firstActivation,
    };
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
      if (safeUnsupportedSheetStrength > 0 || safeAdaptiveDensity) {
        dispatch(pass, pipelines.classifyUnsupportedSheet, safeParticleCount);
      }
      if (safeUnsupportedSheetStrength > 0) {
        dispatch(pass, pipelines.applyUnsupportedSheet, safeParticleCount);
        dispatch(pass, pipelines.commitUnsupportedSheet, safeParticleCount);
        sheetSupportPassCount += 3;
      }
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
      if (safeAdaptiveDensity) {
        dispatch(pass, pipelines.adaptiveDensity, safeBaseParticleCount);
        adaptiveDensityPassCount += 1;
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
    opticalLightingMode = safeOpticalLightingMode,
    opticalFootprintMode = safeOpticalFootprintMode,
    transmissionFootprintMode = safeTransmissionFootprintMode,
    bodyTransportMode = safeBodyTransportMode,
    interfaceFrequencyMode = safeInterfaceFrequencyMode,
  } = {}) {
    if (destroyed) return;
    analyticCarrierLastFrameDrawCount = 0;
    const extent = ensureExtent(width, height, pixelRatio);
    const requestedRendererMode = String(rendererMode || safeRendererMode);
    const effectiveRendererMode = resolveFingerFluidRendererMode(requestedRendererMode);
    const effectiveOpticalDebugMode = resolveFingerFluidOpticalDebugMode(opticalDebugMode);
    const requestedOpticalLightingMode = String(opticalLightingMode || safeOpticalLightingMode);
    const resolvedOpticalLightingMode = resolveFingerFluidOpticalLightingMode(requestedOpticalLightingMode);
    const requestedOpticalFootprintMode = String(opticalFootprintMode || safeOpticalFootprintMode);
    const resolvedOpticalFootprintMode = resolveFingerFluidOpticalFootprintMode(requestedOpticalFootprintMode);
    const requestedTransmissionFootprintMode = String(transmissionFootprintMode || safeTransmissionFootprintMode);
    const resolvedTransmissionFootprintMode = resolveFingerFluidTransmissionFootprintMode(requestedTransmissionFootprintMode);
    const requestedBodyTransportMode = String(bodyTransportMode || safeBodyTransportMode);
    const resolvedBodyTransportMode = resolveFingerFluidBodyTransportMode(requestedBodyTransportMode);
    const requestedInterfaceFrequencyMode = String(interfaceFrequencyMode || safeInterfaceFrequencyMode);
    const resolvedInterfaceFrequencyMode = resolveFingerFluidInterfaceFrequencyMode(requestedInterfaceFrequencyMode);
    const effectiveOpticalLightingMode = effectiveRendererMode === 'screen_space_refraction'
      ? resolvedOpticalLightingMode
      : 'not_executed';
    const effectiveOpticalFootprintMode = effectiveRendererMode === 'screen_space_refraction'
      ? resolvedOpticalFootprintMode
      : 'not_executed';
    const effectiveTransmissionFootprintMode = effectiveRendererMode === 'screen_space_refraction'
      ? resolvedTransmissionFootprintMode
      : 'not_executed';
    const effectiveBodyTransportMode = effectiveRendererMode === 'screen_space_refraction'
      ? resolvedBodyTransportMode
      : 'not_executed';
    const effectiveInterfaceFrequencyMode = effectiveRendererMode === 'screen_space_refraction'
      ? resolvedInterfaceFrequencyMode
      : 'not_executed';
    const renderFrameId = directRenderFrameCount + 1;
    lastRequestedRendererMode = requestedRendererMode;
    lastEffectiveRendererMode = effectiveRendererMode;
    lastOpticalDebugMode = effectiveOpticalDebugMode;
    lastRequestedOpticalLightingMode = requestedOpticalLightingMode;
    lastEffectiveOpticalLightingMode = effectiveOpticalLightingMode;
    lastOpticalLightingFallbackReason = null;
    lastRequestedOpticalFootprintMode = requestedOpticalFootprintMode;
    lastEffectiveOpticalFootprintMode = effectiveOpticalFootprintMode;
    lastOpticalFootprintFallbackReason = null;
    lastRequestedTransmissionFootprintMode = requestedTransmissionFootprintMode;
    lastEffectiveTransmissionFootprintMode = effectiveTransmissionFootprintMode;
    lastTransmissionFootprintFallbackReason = null;
    lastRequestedBodyTransportMode = requestedBodyTransportMode;
    lastEffectiveBodyTransportMode = effectiveBodyTransportMode;
    lastBodyTransportFallbackReason = null;
    lastRequestedInterfaceFrequencyMode = requestedInterfaceFrequencyMode;
    lastEffectiveInterfaceFrequencyMode = effectiveInterfaceFrequencyMode;
    lastInterfaceFrequencyFallbackReason = null;
    lastRendererFallbackReason = null;
    if (!reflectionMeshWitnessOverride) {
      const animatedPhase = (stepCount * 0.012) % (Math.PI * 2);
      if (animatedPhase !== reflectionMeshPhase) reflectionMeshTransformGeneration += 1;
      reflectionMeshPhase = animatedPhase;
    }
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
    const renderData = new Float32Array(44);
    const effectiveColorMode = resolveFingerFluidColorMode(colorMode);
    const colorModeIndex = KAMINOS_FINGER_FLUID_COLOR_MODES.indexOf(effectiveColorMode);
    renderData.set(viewProjection, 0);
    renderData.set([...right, colorModeIndex], 16);
    renderData.set([...up, KAMINOS_FINGER_FLUID_OPTICAL_DEBUG_MODES.indexOf(effectiveOpticalDebugMode)], 20);
    renderData.set([...forward, KAMINOS_FINGER_FLUID_OPTICAL_LIGHTING_MODES.indexOf(resolvedOpticalLightingMode)], 24);
    renderData.set([...eye, KAMINOS_FINGER_FLUID_OPTICAL_FOOTPRINT_MODES.indexOf(resolvedOpticalFootprintMode)], 28);
    renderData.set([extent.width, extent.height, safeVisibleParticleRadius, safeParticleCount], 32);
    renderData.set([
      KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_MODES.indexOf(resolvedTransmissionFootprintMode),
      KAMINOS_FINGER_FLUID_BODY_TRANSPORT_MODES.indexOf(resolvedBodyTransportMode),
      KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_MODES.indexOf(resolvedInterfaceFrequencyMode),
      0,
    ], 36);
    renderData.set(
      analyticCarrierGpuPayload?.particleSuppressionControls ?? [0, -1, 0, 0],
      40,
    );
    device.queue.writeBuffer(renderParamsBuffer, 0, renderData);
    writeDynamicReflectionSceneParams();

    const currentTexture = context.getCurrentTexture();
    const currentTextureView = currentTexture.createView();
    const linearSceneRadianceView = linearSceneRadianceTexture.createView();
    const encoder = device.createCommandEncoder({ label: `kaminos-finger-fluid-render-frame:${effectiveRendererMode}` });
    const refractionEnabled = effectiveRendererMode === 'screen_space_refraction';
    const liquidSupportDiagnostic = effectiveOpticalDebugMode === 'liquid_support';
    const hdrWorldBackgroundPass = encoder.beginRenderPass({
      label: KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE,
      colorAttachments: [{
        view: linearSceneRadianceView,
        clearValue: { r: 0, g: 0, b: 0, a: transparentBackground ? 0 : 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (!transparentBackground && !liquidSupportDiagnostic) {
      hdrWorldBackgroundPass.setPipeline(hdrWorldBackgroundPipeline);
      hdrWorldBackgroundPass.setBindGroup(0, hdrWorldBackgroundBindGroup);
      hdrWorldBackgroundPass.draw(3);
    }
    hdrWorldBackgroundPass.end();
    hdrWorldBackgroundPassCount += 1;
    const analyticSupportPresentationPass = encoder.beginRenderPass({
      label: `${KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE}:shared-color-depth`,
      colorAttachments: [{
        view: linearSceneRadianceView,
        loadOp: 'load',
        storeOp: 'store',
      }, {
        view: deferredWorldNormalRoughnessTexture.createView(),
        clearValue: { r: 0, g: 1, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }, {
        view: deferredAlbedoMetallicTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }, {
        view: deferredLinearDepthObjectTexture.createView(),
        clearValue: { r: 30, g: 0, b: 0, a: 0 },
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

    const dynamicIndexedMeshPass = encoder.beginRenderPass({
      label: `${KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE}:dynamic-indexed-mesh`,
      colorAttachments: [{
        view: linearSceneRadianceView,
        loadOp: 'load',
        storeOp: 'store',
      }, {
        view: deferredWorldNormalRoughnessTexture.createView(),
        loadOp: 'load',
        storeOp: 'store',
      }, {
        view: deferredAlbedoMetallicTexture.createView(),
        loadOp: 'load',
        storeOp: 'store',
      }, {
        view: deferredLinearDepthObjectTexture.createView(),
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });
    const isolateWorldReflection = refractionEnabled
      && ['reflection', 'reflection_hit_kind', 'reflection_distance', 'environment', 'liquid_support', 'environment_contribution', 'reflected_transport', 'reflection_footprint'].includes(effectiveOpticalDebugMode);
    if (!isolateWorldReflection) {
      dynamicIndexedMeshPass.setPipeline(dynamicIndexedMeshPipeline);
      dynamicIndexedMeshPass.setBindGroup(0, dynamicIndexedMeshBindGroup);
      dynamicIndexedMeshPass.setVertexBuffer(0, dynamicReflectionMeshPositionBuffer);
      dynamicIndexedMeshPass.setVertexBuffer(1, dynamicReflectionMeshNormalBuffer);
      dynamicIndexedMeshPass.setIndexBuffer(dynamicReflectionMeshIndexBuffer, 'uint32');
      dynamicIndexedMeshPass.drawIndexed(DYNAMIC_REFLECTION_MESH_INDEX_COUNT);
      dynamicIndexedMeshDrawCount += 1;
      lastDynamicIndexedMeshDrawFrameId = renderFrameId;
      lastDynamicMeshPresentationMode = 'deferred_scene_visible_v0';
    } else {
      lastDynamicMeshPresentationMode = 'suppressed_in_reflection_debug_provider_remains_active_v0';
    }
    dynamicIndexedMeshPass.end();
    deferredScenePassCount += 1;
    lastDeferredSceneFrameId = renderFrameId;
    lastDeferredMeshTransformGeneration = reflectionMeshTransformGeneration;
    lastDeferredMeshPhase = reflectionMeshPhase;

    if (refractionEnabled) {
      encoder.copyTextureToTexture(
        { texture: linearSceneRadianceTexture },
        { texture: screenSpaceRefractionSceneTexture },
        { width: extent.width, height: extent.height, depthOrArrayLayers: 1 },
      );
      screenSpaceRefractionScenePassCount += 1;
    }

    if (effectiveRendererMode === 'sphere_debug') {
      const pass = encoder.beginRenderPass({
        label: KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
        colorAttachments: [{
          view: linearSceneRadianceView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: liquidSupportDiagnostic ? 'clear' : 'load',
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
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
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
      if (canonicalParticleVisibility !== 'hidden') {
        accumulationPass.setBindGroup(0, screenSpaceSurfaceAccumulationBindGroup);
        accumulationPass.draw(6, safeParticleCount);
      }
      if (analyticCarrierAccumulationBindGroup && analyticCarrierSampleCount > 0) {
        accumulationPass.setBindGroup(0, analyticCarrierAccumulationBindGroup);
        accumulationPass.draw(6, analyticCarrierSampleCount);
        analyticCarrierAccumulationDrawCount += 1;
        analyticCarrierLastFrameDrawCount = 1;
      }
      accumulationPass.end();
      screenSpaceSurfaceAccumulationPassCount += 1;
      screenSpaceOpticalSlabGeometryPassCount += 1;

      const compositePass = encoder.beginRenderPass({
        label: refractionEnabled
          ? `${KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE}:two-interface-optical-slab-composite`
          : `${KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE}:edge-preserving-surface-composite`,
        colorAttachments: [{
          view: linearSceneRadianceView,
          clearValue: liquidSupportDiagnostic
            ? { r: 0, g: 0, b: 0, a: 1 }
            : transparentBackground
            ? { r: 0, g: 0, b: 0, a: 0 }
            : { r: 0.006, g: 0.012, b: 0.018, a: 1 },
          loadOp: liquidSupportDiagnostic ? 'clear' : 'load',
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
        if (lastOpticalDebugMode !== 'interface_fidelity') {
          worldSpaceReflectionCompositePassCount += 1;
          hybridOpticalQueryCompositePassCount += 1;
          lastOpticalQueryFrameId = renderFrameId;
          lastReflectionProviderFrameId = renderFrameId;
          lastReflectionProviderTransformGeneration = reflectionMeshTransformGeneration;
          lastReflectionProviderPhase = reflectionMeshPhase;
        }
      } else {
        screenSpaceSurfaceCompositePassCount += 1;
        screenSpaceSurfaceRenderFrameCount += 1;
      }
    }
    const finalPresentationPass = encoder.beginRenderPass({
      label: KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE,
      colorAttachments: [{
        view: currentTextureView,
        clearValue: { r: 0, g: 0, b: 0, a: transparentBackground ? 0 : 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    finalPresentationPass.setPipeline(finalPresentationPipeline);
    finalPresentationPass.setBindGroup(0, finalPresentationBindGroup);
    finalPresentationPass.draw(3);
    finalPresentationPass.end();
    finalPresentationPassCount += 1;
    device.queue.submit([encoder.finish()]);
    directRenderFrameCount += 1;
    lastRenderFrameId = renderFrameId;
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
      const diagnosticsLiveInletGeneration = liveInletGeneration;
      const diagnosticsLiveInletEconomics = currentLiveInletEconomics;
      const diagnosticsLiveInletReleasePlan = liveInletReleasePlan;
      const diagnosticsLiveInletPlanStep = liveInletPlanStep;
      const diagnosticsLiveInletPublications = [...liveInletPublicationHistory];
      const encoder = device.createCommandEncoder({ label: 'kaminos-finger-fluid-diagnostics-copy' });
      encoder.copyBufferToBuffer(particleBuffer, 0, diagnosticsBuffer, 0, particleData.byteLength);
      encoder.copyBufferToBuffer(energyDiagnosticsBuffer, 0, energyDiagnosticsReadbackBuffer, 0, safeParticleCount * ENERGY_RECORD_BYTES);
      encoder.copyBufferToBuffer(
        interfaceCountersBuffer,
        0,
        interfaceCountersReadbackBuffer,
        0,
        INTERFACE_COUNTER_BYTES,
      );
      encoder.copyBufferToBuffer(interfaceRecordsBuffer, 0, interfaceRecordsReadbackBuffer, 0, safeParticleCount * INTERFACE_RECORD_BYTES);
      encoder.copyBufferToBuffer(restStateBuffer, 0, restStateReadbackBuffer, 0, safeParticleCount * REST_STATE_BYTES);
      encoder.copyBufferToBuffer(neighborTopologyBuffer, 0, neighborTopologyReadbackBuffer, 0, safeParticleCount * NEIGHBOR_TOPOLOGY_BYTES);
      encoder.copyBufferToBuffer(materialTracerBuffer, 0, materialTracerReadbackBuffer, 0, safeParticleCount * MATERIAL_TRACER_BYTES);
      encoder.copyBufferToBuffer(liquidFireContactHeaderBuffer, 0, liquidFireContactHeaderReadbackBuffer, 0, LIQUID_FIRE_CONTACT_HEADER_BYTES);
      device.queue.submit([encoder.finish()]);
      const mapResults = await Promise.allSettled(readbackBuffers.map(buffer => buffer.mapAsync(GPUMapMode.READ)));
      const failedMap = mapResults.find(result => result.status === 'rejected');
      if (failedMap) throw failedMap.reason;
      if (safeTruthScene === 'live_hand_inlets') {
        validateFingerFluidLiveInletDiagnosticsEpoch(
          diagnosticsLiveInletGeneration,
          liveInletGeneration,
        );
      }
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
      let unsupportedSheetActiveParticleCount = 0;
      let unsupportedSheetActivitySum = 0;
      let maximumUnsupportedSheetActivity = 0;
      const neighborRetentionHistogram = [0, 0, 0, 0];
      const chemistryHistogram = [0, 0, 0, 0, 0, 0, 0, 0];
      let chemistryMass = 0;
      let sourceResetMassAdjustment = 0;
      let chemistryMin = Infinity;
      let chemistryMax = -Infinity;
      let chemistryRecipeDeviationSum = 0;
      let activeParticleCount = 0;
      let dormantParticleCount = 0;
      let representedVolume = 0;
      const adaptiveMomentum = [0, 0, 0];
      let unrefinedBaseParticleCount = 0;
      let refinedParentCount = 0;
      let activeChildCount = 0;
      let reservedChildCount = 0;
      let dormantOwnershipParticleCount = 0;
      let preImpactOwnershipParticleCount = 0;
      let postImpactOwnershipParticleCount = 0;
      let invalidOwnershipParticleCount = 0;
      for (let index = 0; index < safeParticleCount; index += 1) {
        const offset = index * PARTICLE_FLOATS;
        const restOffset = index * REST_STATE_FLOATS;
        const topologyOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 4;
        const sheetOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 8;
        const chemistryOffset = index * MATERIAL_TRACER_FLOATS;
        const refinementOffset = index * NEIGHBOR_TOPOLOGY_WORDS + 32;
        const volumeScale = Math.max(0, topologyValues[refinementOffset]);
        const refinementRole = Math.round(topologyValues[refinementOffset + 1]);
        const concentration = materialTracerValues[chemistryOffset];
        const recipe = materialTracerValues[chemistryOffset + 2];
        chemistryMass += concentration * volumeScale;
        sourceResetMassAdjustment += materialTracerValues[chemistryOffset + 3] * volumeScale;
        chemistryMin = Math.min(chemistryMin, concentration);
        chemistryMax = Math.max(chemistryMax, concentration);
        chemistryRecipeDeviationSum += Math.abs(concentration - recipe);
        chemistryHistogram[Math.min(7, Math.max(0, Math.floor(concentration * 8)))] += 1;
        const active = values[offset + 11] >= 0 && volumeScale > 0;
        const ownershipRecord = classifyFingerFluidParticleOwnershipRecord({
          phase: materialTracerValues[chemistryOffset + 16],
          sourceGeneration: materialTracerValues[chemistryOffset + 17],
          transitionFrame: materialTracerValues[chemistryOffset + 18],
          supportContact: materialTracerValues[chemistryOffset + 19],
        }, { active });
        if (!ownershipRecord.valid) {
          invalidOwnershipParticleCount += 1;
        } else if (ownershipRecord.phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.dormant) {
          dormantOwnershipParticleCount += 1;
        } else if (ownershipRecord.phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.preImpact) {
          preImpactOwnershipParticleCount += 1;
        } else if (ownershipRecord.phase === KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES.postImpact) {
          postImpactOwnershipParticleCount += 1;
        }
        representedVolume += volumeScale;
        if (!active) {
          dormantParticleCount += 1;
          if (index >= safeBaseParticleCount) reservedChildCount += 1;
          continue;
        }
        activeParticleCount += 1;
        if (refinementRole === 0) unrefinedBaseParticleCount += 1;
        if (refinementRole === 1) refinedParentCount += 1;
        if (refinementRole === 2) activeChildCount += 1;
        for (let axis = 0; axis < 3; axis += 1) {
          adaptiveMomentum[axis] += values[offset + 8 + axis] * volumeScale;
        }
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
        const unsupportedSheetActivity = topologyValues[sheetOffset + 3];
        unsupportedSheetActivitySum += unsupportedSheetActivity;
        maximumUnsupportedSheetActivity = Math.max(maximumUnsupportedSheetActivity, unsupportedSheetActivity);
        if (unsupportedSheetActivity >= 0.01) unsupportedSheetActiveParticleCount += 1;
        neighborRetentionHistogram[Math.min(3, Math.max(0, Math.floor(neighborRetention * 4)))] += 1;
      }
      const physicalParticleCount = Math.max(1, activeParticleCount);
      const adaptiveDensityLedger = {
        contract: KAMINOS_FINGER_FLUID_ADAPTIVE_DENSITY_CONTRACT,
        enabled: safeAdaptiveDensity,
        baseParticleCount: safeBaseParticleCount,
        simulationCapacity: safeParticleCount,
        activeParticleCount,
        unrefinedBaseParticleCount,
        refinedParentCount,
        activeChildCount,
        reservedChildCount,
        representedVolume: Number(representedVolume.toFixed(6)),
        momentum: adaptiveMomentum.map(value => Number(value.toFixed(6))),
        chemistryMass: Number(chemistryMass.toFixed(6)),
        splitCount: interfaceCounters[3],
        mergeCount: interfaceCounters[4],
        accountingValid: Math.abs(representedVolume - safeBaseParticleCount) <= Math.max(0.001, safeBaseParticleCount * 0.000001),
      };
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
      let curvatureSum = 0;
      let absoluteCurvatureSum = 0;
      let minimumCurvature = Infinity;
      let maximumCurvature = -Infinity;
      let resolvedCurvatureRecordCount = 0;
      let unresolvedCurvatureRecordCount = 0;
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
        if (record.confidence > 0) {
          resolvedCurvatureRecordCount += 1;
          curvatureSum += record.curvature;
          absoluteCurvatureSum += Math.abs(record.curvature);
          minimumCurvature = Math.min(minimumCurvature, record.curvature);
          maximumCurvature = Math.max(maximumCurvature, record.curvature);
        } else {
          unresolvedCurvatureRecordCount += 1;
        }
      }
      const sampleRecords = [];
      for (let index = 0; index < sampleRecordCount; index += 1) {
        const sampleIndex = Math.floor(index * (activeInterfaceCount - 1) / Math.max(1, sampleRecordCount - 1));
        sampleRecords.push(readInterfaceRecord(sampleIndex));
      }
      const fluidTruthSnapshot = measureFingerFluidTruthSnapshot(values, safeParticleCount, {
        scene: safeTruthScene,
        restDensity: safeRestDensity,
        kernelRadius: safeKernelRadius,
        sourceRecirculationCount: interfaceCounters[2],
      });
      const energyLedger = summarizeFingerFluidEnergyLedger(energyValues, safeParticleCount, diagnosticsStepCount);
      const waterfallContinuityDiagnostics = safeTruthScene === 'laminar_inlets'
        ? measureFingerFluidWaterfallContinuity(values, restStateValues, safeParticleCount)
        : null;
      const unsupportedSheetReleaseDiagnostics = safeUnsupportedSheetStrength > 0 || safeAdaptiveDensity
        ? summarizeFingerFluidSheetReleaseDiagnostics(topologyValues, values, safeParticleCount)
        : null;
      const liveInletCohortLedger = safeTruthScene === 'live_hand_inlets'
        ? measureFingerFluidLiveInletCohortLedger(
          values,
          materialTracerValues,
          safeParticleCount,
          diagnosticsLiveInletPublications,
        )
        : null;
      if (liveInletCohortLedger) {
        validateFingerFluidLiveInletCohortLedger(
          diagnosticsLiveInletPublications,
          liveInletCohortLedger,
        );
      }
      const liveInletObservedReleaseCount = interfaceCounters[2];
      const liveInletReleaseRealizability = safeTruthScene === 'live_hand_inlets'
        ? measureFingerFluidLiveInletReleaseRealizability({
          expectedParticleReleaseRate: diagnosticsLiveInletReleasePlan.expectedParticleReleaseRate,
          elapsedSteps: Math.max(0, diagnosticsStepCount - diagnosticsLiveInletPlanStep),
          predecessorBlockedReleaseCount: interfaceCounters[9],
          observedParticleReleaseCount: liveInletObservedReleaseCount,
        })
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
        adaptiveDensityLedger,
        particleOwnership: {
          contract: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT,
          packing: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING,
          contactThreshold: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD,
          dormantParticleCount: dormantOwnershipParticleCount,
          preImpactParticleCount: preImpactOwnershipParticleCount,
          postImpactParticleCount: postImpactOwnershipParticleCount,
          invalidParticleCount: invalidOwnershipParticleCount,
          recordsValid: invalidOwnershipParticleCount === 0,
          populationAccountingValid: dormantOwnershipParticleCount
            + preImpactOwnershipParticleCount
            + postImpactOwnershipParticleCount
            + invalidOwnershipParticleCount === safeParticleCount,
          accountingValid: dormantOwnershipParticleCount
            + preImpactOwnershipParticleCount
            + postImpactOwnershipParticleCount
            + invalidOwnershipParticleCount === safeParticleCount
            && invalidOwnershipParticleCount === 0,
        },
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
        unsupportedSheetContract: KAMINOS_FINGER_FLUID_UNSUPPORTED_SHEET_CONTRACT,
        unsupportedSheetStrength: safeUnsupportedSheetStrength,
        unsupportedSheetActiveParticleCount,
        unsupportedSheetActiveParticleRatio: Number((unsupportedSheetActiveParticleCount / physicalParticleCount).toFixed(6)),
        averageUnsupportedSheetActivity: Number((unsupportedSheetActivitySum / physicalParticleCount).toFixed(6)),
        maximumUnsupportedSheetActivity: Number(maximumUnsupportedSheetActivity.toFixed(6)),
        unsupportedSheetReleaseDiagnostics,
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
          ? measureFingerFluidLaminarInletDiagnostics(values, safeParticleCount, undefined, {
            sourceParticleCount: safeBaseParticleCount,
          })
          : null,
        waterfallContinuityDiagnostics,
        sourceRecirculationCount: interfaceCounters[2],
        liveInletEconomics: safeTruthScene === 'live_hand_inlets' ? {
          contract: KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
          ageContract: KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT,
          cohortContract: KAMINOS_FINGER_FLUID_LIVE_INLET_COHORT_CONTRACT,
          generation: diagnosticsLiveInletGeneration,
          packetId: diagnosticsLiveInletEconomics.packetId,
          sourceRoute: diagnosticsLiveInletEconomics.sourceRoute,
          artifactSha256: diagnosticsLiveInletEconomics.artifactSha256,
          sourceAuthority: diagnosticsLiveInletEconomics.sourceAuthority,
          poolCapacity: diagnosticsLiveInletEconomics.poolCapacity,
          requestedActiveInletCount: diagnosticsLiveInletEconomics.requestedActiveInletCount,
          effectiveReservedInletCount: diagnosticsLiveInletEconomics.effectiveReservedInletCount,
          effectiveActiveInletCount: diagnosticsLiveInletEconomics.effectiveActiveInletCount,
          requestedReleasePoolBudget: diagnosticsLiveInletEconomics.requestedReleasePoolBudget,
          effectiveReleasePoolBudget: diagnosticsLiveInletEconomics.effectiveReleasePoolBudget,
          unallocatedDormantParticleCount: diagnosticsLiveInletEconomics.unallocatedDormantParticleCount,
          observedActiveParticleCount: activeParticleCount,
          observedDormantParticleCount: dormantParticleCount,
          expectedParticleReleaseRate: diagnosticsLiveInletReleasePlan.expectedParticleReleaseRate,
          releaseRealizabilityContract: 'gpu-predecessor-occupancy-adjusted-release-v0',
          nominalExpectedParticleReleaseCount: liveInletReleaseRealizability.nominalExpectedParticleReleaseCount,
          predecessorBlockedReleaseCount: interfaceCounters[9],
          realizableExpectedParticleReleaseCount: liveInletReleaseRealizability.realizableExpectedParticleReleaseCount,
          expectedParticleReleaseCount: liveInletReleaseRealizability.realizableExpectedParticleReleaseCount,
          observedParticleReleaseCount: liveInletObservedReleaseCount,
          observedExpectedReleaseRatio: liveInletReleaseRealizability.observedRealizableReleaseRatio,
          liveInletAgeRecycleCount: interfaceCounters[5],
          liveInletDistanceRecycleCount: interfaceCounters[6],
          priorGenerationAgeRecycleCount: interfaceCounters[7],
          priorGenerationDistanceRecycleCount: interfaceCounters[8],
          cohortLedger: liveInletCohortLedger,
          planStartStep: diagnosticsLiveInletPlanStep,
          capturedStep: diagnosticsStepCount,
        } : null,
        inletCutoffStep: safeInletCutoffStep,
        inletCutoffReached: safeInletCutoffStep !== null && diagnosticsStepCount >= safeInletCutoffStep,
        interfaceCarrier: {
          schema: KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA,
          interfaceGeometryContract: KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT,
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
          curvatureResolutionMode: 'kernel-bandwidth-reject-unresolved-v0',
          maximumResolvableCurvature: Number((2 / safeKernelRadius).toFixed(6)),
          resolvedCurvatureRecordCount,
          unresolvedCurvatureRecordCount,
          curvatureResolutionRatio: Number((resolvedCurvatureRecordCount / Math.max(1, activeInterfaceCount)).toFixed(6)),
          averageCurvature: resolvedCurvatureRecordCount > 0 ? Number((curvatureSum / resolvedCurvatureRecordCount).toFixed(6)) : 0,
          averageAbsoluteCurvature: resolvedCurvatureRecordCount > 0 ? Number((absoluteCurvatureSum / resolvedCurvatureRecordCount).toFixed(6)) : 0,
          minimumCurvature: resolvedCurvatureRecordCount > 0 ? Number(minimumCurvature.toFixed(6)) : 0,
          maximumCurvature: resolvedCurvatureRecordCount > 0 ? Number(maximumCurvature.toFixed(6)) : 0,
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

  function getParticleOwnershipDescriptor() {
    const supportContact = createFingerFluidSupportContactIdentity(
      movingHillSupportProvider,
      { device },
    );
    return {
      contract: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT,
      packing: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING,
      source: {
        repository: 'kaminos',
        composedRevision: safeComposedRevision,
        runtimeRoute: KAMINOS_FINGER_FLUID_RUNTIME_ROUTE,
        runtime: runtimeApi,
      },
      device,
      queue: device.queue,
      buffer: materialTracerBuffer,
      recordFloats: MATERIAL_TRACER_FLOATS,
      recordBytes: MATERIAL_TRACER_BYTES,
      ownershipOffsetFloats: 16,
      ownershipOffsetBytes: 16 * Float32Array.BYTES_PER_ELEMENT,
      ownershipFloats: 4,
      capacity: safeParticleCount,
      states: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_STATES,
      contactThreshold: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD,
      sourceFrame: LIQUID_FIRE_CONTACT_SOURCE_FRAME_ID,
      writeTick: Math.max(0, frameIndex - 1),
      ownershipAuthority: 'solver_spatial_first_support_contact_v0',
      consumerVisibilityRule: 'pre_impact_hidden_post_impact_visible_v0',
      visibilityAuthority: movingHillSupportProvider?.visibilityAuthority
        ?? 'gpu_descriptor_without_host_readback',
      hostReadbackVisibility: false,
      supportContact,
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
      supportContactRoute,
      supportContact: movingHillSupportProvider ? {
        route: movingHillSupportProvider.route,
        owner: movingHillSupportProvider.owner,
        sourceId: movingHillSupportProvider.sourceId,
        terrainId: movingHillSupportProvider.terrainId,
        terrainEpoch: movingHillSupportProvider.terrainEpoch,
        supportEpoch: movingHillSupportProvider.supportEpoch,
        remapEpoch: movingHillSupportProvider.remapEpoch,
        stale: movingHillSupportProvider.stale,
        fallbackRoute: movingHillSupportProvider.fallbackRoute,
        execution: movingHillSupportProvider.execution,
        deviceMatchesSolver: movingHillSupportProvider.device === device,
        sampleTextureIdentity: movingHillSupportProvider.sampleTexture.label || null,
        paramsBufferIdentity: movingHillSupportProvider.paramsBuffer.label || null,
        hostReadbackVisibility: movingHillSupportProvider.hostReadbackVisibility,
      } : {
        route: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_CONTACT_ROUTE,
        owner: 'kaminos_diagnostic',
        fallbackRoute: null,
      },
      boundaryPressureContract: KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT,
      supportFrictionContract: KAMINOS_FINGER_FLUID_SUPPORT_FRICTION_CONTRACT,
      energyLedgerContract: KAMINOS_FINGER_FLUID_ENERGY_LEDGER_CONTRACT,
      vorticityConfinementContract: KAMINOS_FINGER_FLUID_VORTICITY_CONTRACT,
      freeSurfaceContract: KAMINOS_FINGER_FLUID_FREE_SURFACE_CONTRACT,
      waterfallContinuityContract: KAMINOS_FINGER_FLUID_WATERFALL_CONTINUITY_CONTRACT,
      unsupportedSheetContract: KAMINOS_FINGER_FLUID_UNSUPPORTED_SHEET_CONTRACT,
      waterfallOracleContract: waterfallOracleConfig?.contract || null,
      oracleReleaseScheduleContract: waterfallOracleConfig?.releaseScheduleContract || null,
      requestedWaterfallOraclePreset: safeTruthScene === 'waterfall_resolution_oracle' ? waterfallOraclePreset : null,
      effectiveWaterfallOraclePreset: safeTruthScene === 'waterfall_resolution_oracle' ? safeWaterfallOraclePreset : null,
      oracleParticleSpacing: waterfallOracleConfig?.particleSpacing ?? null,
      oracleParticleSpacingScale: waterfallOracleConfig ? 1 / waterfallOracleConfig.refinementFactor : null,
      oracleKernelScale: waterfallOracleConfig ? safeKernelRadius / 0.185 : null,
      oracleSourceFlux: waterfallOracleConfig?.physicalSourceFlux ?? null,
      oracleSourceFluxScale: waterfallOracleConfig ? 1 : null,
      interfacePressureContract: KAMINOS_FINGER_FLUID_INTERFACE_PRESSURE_CONTRACT,
      restStateContract: KAMINOS_FINGER_FLUID_REST_STATE_CONTRACT,
      supportTransportContract: KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_CONTRACT,
      topologyContract: KAMINOS_FINGER_FLUID_TOPOLOGY_CONTRACT,
      particleShiftContract: KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_CONTRACT,
      chemistryContract: KAMINOS_FINGER_FLUID_CHEMISTRY_CONTRACT,
      laminarInletContract: KAMINOS_FINGER_FLUID_LAMINAR_INLET_CONTRACT,
      liveInletContract: KAMINOS_FINGER_FLUID_LIVE_INLET_CONTRACT,
      liveInletAgeContract: KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT,
      liveInletReleaseContract: KAMINOS_FINGER_FLUID_LIVE_INLET_RELEASE_CONTRACT,
      liveInletSourceAuthorityContract: KAMINOS_FINGER_FLUID_LIVE_INLET_SOURCE_AUTHORITY_CONTRACT,
      liveInletEconomicsContract: KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
      liveInletCohortContract: KAMINOS_FINGER_FLUID_LIVE_INLET_COHORT_CONTRACT,
      particleOwnershipContract: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT,
      particleOwnershipPacking: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING,
      particleOwnership: diagnostics?.particleOwnership || {
        contract: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT,
        packing: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING,
        contactThreshold: KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTACT_THRESHOLD,
        dormantParticleCount: null,
        preImpactParticleCount: null,
        postImpactParticleCount: null,
        invalidParticleCount: null,
        recordsValid: null,
        populationAccountingValid: null,
        accountingValid: null,
      },
      liveInlets: safeTruthScene === 'live_hand_inlets' ? {
        schema: 'kaminos.finger-fluid.live-inlet-economics.v1',
        contract: KAMINOS_FINGER_FLUID_LIVE_INLET_ECONOMICS_CONTRACT,
        requestedMode: 'live_hand_inlets',
        effectiveMode: 'live_hand_inlets',
        packetId: currentLiveInletPacket.packetId,
        sourceRoute: currentLiveInletPacket.sourceRoute,
        artifactSha256: currentLiveInletPacket.artifactSha256,
        sourceAuthority: currentLiveInletEconomics.sourceAuthority,
        ageContract: KAMINOS_FINGER_FLUID_LIVE_INLET_AGE_CONTRACT,
        cohortContract: KAMINOS_FINGER_FLUID_LIVE_INLET_COHORT_CONTRACT,
        generation: liveInletGeneration,
        capacity: LIVE_HAND_INLET_CAPACITY,
        activeInletCount: currentLiveInletEconomics.effectiveActiveInletCount,
        requestedActiveInletCount: currentLiveInletEconomics.requestedActiveInletCount,
        effectiveReservedInletCount: currentLiveInletEconomics.effectiveReservedInletCount,
        effectiveActiveInletCount: currentLiveInletEconomics.effectiveActiveInletCount,
        activated: liveInletActivated,
        sourceLifecycle: 'dormant_pool_progressive_gpu_release',
        initialActiveParticleCount: 0,
        initialDormantParticleCount: safeBaseParticleCount,
        particleVolume: liveInletReleasePlan.particleVolume,
        poolCapacity: currentLiveInletEconomics.poolCapacity,
        requestedReleasePoolBudget: currentLiveInletEconomics.requestedReleasePoolBudget,
        effectiveReleasePoolBudget: currentLiveInletEconomics.effectiveReleasePoolBudget,
        unallocatedDormantParticleCount: currentLiveInletEconomics.unallocatedDormantParticleCount,
        expectedParticleReleaseRate: liveInletReleasePlan.expectedParticleReleaseRate,
        expectedParticlesPerReferenceFrame: liveInletReleasePlan.expectedParticlesPerReferenceFrame,
        inlets: currentLiveInletEconomics.inlets.map(inlet => ({
          id: inlet.id,
          origin: [...inlet.origin],
          axis: [...inlet.axis],
          radius: inlet.radius,
          maximumSpeed: inlet.maximumSpeed,
          requestedActive: inlet.requestedActive,
          active: inlet.active,
          activationAuthority: inlet.activationAuthority,
          requested: inlet.requested,
          effective: inlet.effective,
          opticalDensity: inlet.opticalDensity,
          reconstructionRadius: inlet.reconstructionRadius,
        })),
      } : null,
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
      waterfallResolutionOracle: waterfallOracleConfig ? {
        ...waterfallOracleConfig,
        requestedPreset: waterfallOraclePreset,
        effectivePreset: safeWaterfallOraclePreset,
        particleCount: safeParticleCount,
        densityIterations: safeDensityIterations,
        fixedTimeStepSeconds: KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS,
        requestedEqualsEffective: waterfallOraclePreset === safeWaterfallOraclePreset,
        visualDisposition: 'pending_operator_observation',
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
      unsupportedSheetStrength: safeUnsupportedSheetStrength,
      adaptiveDensityContract: KAMINOS_FINGER_FLUID_ADAPTIVE_DENSITY_CONTRACT,
      adaptiveDensity: safeAdaptiveDensity,
      adaptiveDensityPassCount,
      adaptiveDensityLedger: diagnostics?.adaptiveDensityLedger || {
        contract: KAMINOS_FINGER_FLUID_ADAPTIVE_DENSITY_CONTRACT,
        enabled: safeAdaptiveDensity,
        baseParticleCount: safeBaseParticleCount,
        simulationCapacity: safeParticleCount,
        splitCount: 0,
        mergeCount: 0,
        accountingValid: null,
      },
      pulseDrainageContract: KAMINOS_FINGER_FLUID_PULSE_DRAINAGE_CONTRACT,
      inletCutoffStep: safeInletCutoffStep,
      inletCutoffReached: safeInletCutoffStep !== null && frameIndex >= safeInletCutoffStep,
      sheetSupportPassCount,
      energyLedgerAttribution: safeUnsupportedSheetStrength > 0
        ? 'cohesion_stage_includes_unsupported_sheet_support_then_surface_cohesion'
        : 'nominal_projection_viscosity_vorticity_cohesion_stages',
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
        inletFixtureVertexCount: safeTruthScene !== 'live_hand_inlets' && isFingerFluidLaminarSourceScene(safeTruthScene) ? ANALYTIC_SUPPORT_INLET_FIXTURE_VERTEX_COUNT : 0,
        inletFixtures: safeTruthScene !== 'live_hand_inlets' && isFingerFluidLaminarSourceScene(safeTruthScene) ? [
          { id: 'round-spout', presentation: 'open_round_tube', vertexCount: ANALYTIC_SUPPORT_ROUND_INLET_VERTEX_COUNT },
          { id: 'slot-spout', presentation: 'open_rectangular_duct', vertexCount: ANALYTIC_SUPPORT_SLOT_INLET_VERTEX_COUNT },
          { id: 'porous-patch', presentation: 'homogenized_visual_boundary_not_resolved_pore_geometry', vertexCount: ANALYTIC_SUPPORT_POROUS_INLET_VERTEX_COUNT },
        ] : [],
        obstacleCount: PLAYGROUND_OBSTACLE_COUNT,
        particleSupportDrawCount,
        rendered: directRenderFrameCount > 0,
      },
      interfaceCarrierSchema: KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA,
      interfaceGeometryContract: KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT,
      interfaceCapacity: safeParticleCount,
      candidateCapMode: 'uncapped_exact_particle_population_capacity',
      interfaceCarrier: diagnostics?.interfaceCarrier || {
        schema: KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_SCHEMA,
        interfaceGeometryContract: KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_CONTRACT,
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
        : safeTruthScene === 'live_hand_inlets'
          ? 'live_hand_dynamic_inlet_finite_particle_loop_v0'
        : safeTruthScene === 'laminar_inlets'
          ? 'descriptor_laminar_inlet_finite_particle_loop_v0'
          : safeTruthScene === 'waterfall_resolution_oracle'
            ? 'isolated_slot_uniform_resolution_finite_particle_loop_v0'
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
      requestedOpticalLightingMode: lastRequestedOpticalLightingMode,
      effectiveOpticalLightingMode: lastEffectiveOpticalLightingMode,
      requestedOpticalLightingRoute: opticalLightingRouteForMode(lastRequestedOpticalLightingMode),
      effectiveOpticalLightingRoute: lastEffectiveOpticalLightingMode === 'not_executed'
        ? KAMINOS_FINGER_FLUID_LIGHTING_NOT_EXECUTED_ROUTE
        : opticalLightingRouteForMode(lastEffectiveOpticalLightingMode),
      opticalLightingFallbackReason: lastOpticalLightingFallbackReason,
      requestedOpticalFootprintMode: lastRequestedOpticalFootprintMode,
      effectiveOpticalFootprintMode: lastEffectiveOpticalFootprintMode,
      requestedOpticalFootprintRoute: opticalFootprintRouteForMode(lastRequestedOpticalFootprintMode),
      effectiveOpticalFootprintRoute: lastEffectiveOpticalFootprintMode === 'not_executed'
        ? KAMINOS_FINGER_FLUID_FOOTPRINT_NOT_EXECUTED_ROUTE
        : opticalFootprintRouteForMode(lastEffectiveOpticalFootprintMode),
      opticalFootprintFallbackReason: lastOpticalFootprintFallbackReason,
      requestedTransmissionFootprintMode: lastRequestedTransmissionFootprintMode,
      effectiveTransmissionFootprintMode: lastEffectiveTransmissionFootprintMode,
      requestedTransmissionFootprintRoute: transmissionFootprintRouteForMode(lastRequestedTransmissionFootprintMode),
      effectiveTransmissionFootprintRoute: lastEffectiveTransmissionFootprintMode === 'not_executed'
        ? KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_NOT_EXECUTED_ROUTE
        : transmissionFootprintRouteForMode(lastEffectiveTransmissionFootprintMode),
      transmissionFootprintFallbackReason: lastTransmissionFootprintFallbackReason,
      requestedBodyTransportMode: lastRequestedBodyTransportMode,
      effectiveBodyTransportMode: lastEffectiveBodyTransportMode,
      requestedBodyTransportRoute: bodyTransportRouteForMode(lastRequestedBodyTransportMode),
      effectiveBodyTransportRoute: lastEffectiveBodyTransportMode === 'not_executed'
        ? KAMINOS_FINGER_FLUID_BODY_TRANSPORT_NOT_EXECUTED_ROUTE
        : bodyTransportRouteForMode(lastEffectiveBodyTransportMode),
      bodyTransportFallbackReason: lastBodyTransportFallbackReason,
      requestedInterfaceFrequencyMode: lastRequestedInterfaceFrequencyMode,
      effectiveInterfaceFrequencyMode: lastEffectiveInterfaceFrequencyMode,
      requestedInterfaceFrequencyRoute: interfaceFrequencyRouteForMode(lastRequestedInterfaceFrequencyMode),
      effectiveInterfaceFrequencyRoute: lastEffectiveInterfaceFrequencyMode === 'not_executed'
        ? KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_NOT_EXECUTED_ROUTE
        : interfaceFrequencyRouteForMode(lastEffectiveInterfaceFrequencyMode),
      interfaceFrequencyFallbackReason: lastInterfaceFrequencyFallbackReason,
      opticalTransportRoute: KAMINOS_FINGER_FLUID_OPTICAL_TRANSPORT_ROUTE,
      sphereDebugRendererRoute: KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_ROUTE,
      screenSpaceSurfaceRendererRoute: KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_ROUTE,
      screenSpaceRefractionRendererRoute: KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_ROUTE,
      renderShaderRoute: KAMINOS_FINGER_FLUID_RENDER_SHADER_ROUTE,
      screenSpaceSurfaceShaderRoute: KAMINOS_FINGER_FLUID_SCREEN_SPACE_SHADER_ROUTE,
      analyticSupportDepthRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
      analyticSupportPresentationRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
      particleCount: safeParticleCount,
      baseParticleCount: safeBaseParticleCount,
      simulationCapacity: safeParticleCount,
      particleAllocationCapacity,
      particleAllocationPreflight,
      gridDimensions: [...GRID_DIMS],
      gridCellCount: GRID_CELL_COUNT,
      densityIterationsPerStep: safeDensityIterations,
      restDensity: 24.3,
      kernelRadius: safeKernelRadius,
      visibleParticleRadius: safeVisibleParticleRadius,
      maxFluidSpeed: safeMaxFluidSpeed,
      speedReferenceScale: KAMINOS_FINGER_FLUID_SPEED_REFERENCE_SCALE,
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
      analyticCarrierAccumulationDrawCount,
      analyticCarrierLastFrameDrawCount,
      screenSpaceOpticalSlabGeometryPassCount,
      screenSpaceSurfaceCompositePassCount,
      analyticSupportDepthPassCount,
      analyticSupportPresentationPassCount,
      particleSupportDrawCount,
      screenSpaceRefractionRenderFrameCount,
      screenSpaceRefractionScenePassCount,
      screenSpaceRefractionCompositePassCount,
      deferredScenePassCount,
      dynamicIndexedMeshDrawCount,
      worldSpaceReflectionCompositePassCount,
      hybridOpticalQueryCompositePassCount,
      hdrWorldBackgroundPassCount,
      finalPresentationPassCount,
      analyticCarrierOptics: {
        ...analyticCarrierRouteEvidence,
        geometrySchema: analyticCarrierOpticalGeometry?.schema ?? null,
        gpuPayloadSchema: analyticCarrierGpuPayload?.schema ?? null,
        sampleCount: analyticCarrierSampleCount,
        lastFrameDrawCount: analyticCarrierLastFrameDrawCount,
        accumulationDrawCount: analyticCarrierAccumulationDrawCount,
        particleSuppressionContract: analyticCarrierOpticalGeometry?.particleSuppression?.contract ?? null,
        canonicalParticleVisibility,
        visualOwnership: analyticCarrierOpticalGeometry?.ownership ?? null,
      },
      linearHdrSceneEvidence: {
        requestedRoute: KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE,
        effectiveRoute: KAMINOS_FINGER_FLUID_LINEAR_HDR_SCENE_ROUTE,
        format: LINEAR_SCENE_FORMAT,
        colorSpace: 'scene_linear_rec2020_agnostic_rgb_v0',
        backgroundRoute: KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE,
        environmentFilterRoute: KAMINOS_FINGER_FLUID_ENVIRONMENT_FILTER_ROUTE,
        backgroundPassCount: hdrWorldBackgroundPassCount,
        worldLightingConsumers: [...LINEAR_HDR_WORLD_LIGHTING_CONSUMERS],
        fallbackReason: null,
      },
      finalPresentationEvidence: {
        requestedRoute: KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE,
        effectiveRoute: KAMINOS_FINGER_FLUID_FINAL_PRESENTATION_ROUTE,
        sourceFormat: LINEAR_SCENE_FORMAT,
        targetFormat: format,
        toneMap: 'aces-fitted-v0',
        exposure: LINEAR_SCENE_EXPOSURE,
        displayTransformCountPerFrame: 1,
        exactDiagnosticBypass: 'liquid_support',
        diagnosticVisibilityRoute: 'post-composite-depth24plus-identity-v0',
        passCount: finalPresentationPassCount,
        fallbackReason: null,
      },
      deferredSceneEvidence: {
        requestedRoute: KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
        effectiveRoute: KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
        route: KAMINOS_FINGER_FLUID_DEFERRED_SCENE_ROUTE,
        fallbackReason: null,
        passCount: deferredScenePassCount,
        dynamicIndexedMeshDrawCount,
        renderFrameId: lastRenderFrameId,
        deferredSceneFrameId: lastDeferredSceneFrameId,
        dynamicIndexedMeshLastDrawFrameId: lastDynamicIndexedMeshDrawFrameId,
        dynamicMesh: {
          objectId: DYNAMIC_REFLECTION_MESH_OBJECT_ID,
          vertexCount: DYNAMIC_REFLECTION_MESH_VERTEX_COUNT,
          indexCount: DYNAMIC_REFLECTION_MESH_INDEX_COUNT,
          triangleCount: DYNAMIC_REFLECTION_MESH_TRIANGLE_COUNT,
          transformGeneration: lastDeferredMeshTransformGeneration,
          phase: Number(lastDeferredMeshPhase.toFixed(6)),
          presentationMode: lastDynamicMeshPresentationMode,
          animationMode: reflectionMeshWitnessOverride ? 'witness_phase_override_v0' : 'simulation_tick_phase_v0',
        },
        attachments: configuredExtent ? {
          worldNormalRoughness: { label: 'kaminos-finger-fluid-deferred-world-normal-roughness', format: 'rgba16float', extent: configuredExtent },
          albedoMetallic: { label: 'kaminos-finger-fluid-deferred-albedo-metallic', format: 'rgba8unorm', extent: configuredExtent },
          linearDepthObject: { label: 'kaminos-finger-fluid-deferred-linear-depth-object', format: 'rgba16float', extent: configuredExtent },
        } : null,
      },
      ...(lastEffectiveRendererMode === 'screen_space_refraction' && lastOpticalDebugMode !== 'interface_fidelity' ? {
        opticalQueryEvidence: {
          schema: KAMINOS_FINGER_FLUID_OPTICAL_QUERY_SCHEMA,
          requestedRoute: KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
          effectiveRoute: KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
          route: KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
          deferredTraversalRoute: KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE,
          worldProviderRoute: KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
          environmentRoute: KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE,
          resolverOrder: KAMINOS_FINGER_FLUID_OPTICAL_QUERY_RESOLVER_ORDER,
          fallbackReason: null,
          queryFrameId: lastOpticalQueryFrameId,
          compositePassCount: hybridOpticalQueryCompositePassCount,
          maximumDeferredMarchSteps: 24,
          minimumDeferredConfidence: 0.55,
          deferredInputs: configuredExtent ? {
            linearDepthObject: { label: 'kaminos-finger-fluid-deferred-linear-depth-object', format: 'rgba16float', extent: configuredExtent },
            worldNormalRoughness: { label: 'kaminos-finger-fluid-deferred-world-normal-roughness', format: 'rgba16float', extent: configuredExtent },
            albedoMetallic: { label: 'kaminos-finger-fluid-deferred-albedo-metallic', format: 'rgba8unorm', extent: configuredExtent },
          } : null,
          consumers: ['reflection_center_ray', 'two_interface_refraction_exit_ray'],
          resultFields: ['origin', 'direction', 'cone', 'interval', 'hit_kind', 'object_id', 'distance', 'normal', 'material', 'radiance', 'transmittance', 'confidence', 'provider', 'fallback'],
          deferredMissDisposition: 'uncapped_world_mesh_then_hdr_environment_v0',
          invalidSlabDisposition: 'legacy_entry_interface_uv_only_no_exit_query_claim_v0',
          participatingRadianceBoundary: 'reserved_zero_until_flame_contract_v0',
        },
        worldSpaceReflectionEvidence: {
          schema: KAMINOS_FINGER_FLUID_REFLECTION_QUERY_SCHEMA,
          requestedProviderRoute: KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
          effectiveProviderRoute: KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
          providerRoute: KAMINOS_FINGER_FLUID_WORLD_SPACE_REFLECTION_ROUTE,
          accelerationRoute: KAMINOS_FINGER_FLUID_REFLECTION_ACCELERATION_ROUTE,
          quadratureRoute: lastEffectiveOpticalFootprintMode === 'variance_filtered'
            ? KAMINOS_FINGER_FLUID_VARIANCE_FILTERED_REFLECTION_QUADRATURE_ROUTE
            : KAMINOS_FINGER_FLUID_REFLECTION_QUADRATURE_ROUTE,
          requestedFootprintMode: lastRequestedOpticalFootprintMode,
          effectiveFootprintMode: lastEffectiveOpticalFootprintMode,
          requestedFootprintRoute: opticalFootprintRouteForMode(lastRequestedOpticalFootprintMode),
          effectiveFootprintRoute: opticalFootprintRouteForMode(lastEffectiveOpticalFootprintMode),
          footprintFallbackReason: lastOpticalFootprintFallbackReason,
          minimumQuadratureSampleCount: 5,
          maximumQuadratureSampleCount: lastEffectiveOpticalFootprintMode === 'variance_filtered' ? 9 : 5,
          quadratureSampleCountMode: lastEffectiveOpticalFootprintMode === 'variance_filtered'
            ? 'adaptive_5_sparse_9_dense_v0'
            : 'fixed_5_v0',
          quadratureEstimator: lastEffectiveOpticalFootprintMode === 'variance_filtered'
            ? 'trimmed_min_max_7_of_9_equal_weight_v0'
            : 'weighted_five_ray_mean_v0',
          quadratureWeightSum: 1,
          hitKindDiagnosticScope: 'center_ray_only_v0',
          fallbackReason: null,
          compositePassCount: worldSpaceReflectionCompositePassCount,
          reflectionProviderFrameId: lastReflectionProviderFrameId,
          candidateCapMode: 'uncapped_exact_dynamic_mesh_triangle_population_v0',
          exactTriangleCount: DYNAMIC_REFLECTION_MESH_TRIANGLE_COUNT,
          hitKinds: ['environment', 'analytic_sphere', 'indexed_mesh'],
          dynamicMeshObjectId: DYNAMIC_REFLECTION_MESH_OBJECT_ID,
          dynamicMeshTransformGeneration: lastReflectionProviderTransformGeneration,
          dynamicMeshPhase: Number(lastReflectionProviderPhase.toFixed(6)),
          dynamicMeshPresentationMode: lastDynamicMeshPresentationMode,
          participatingRadianceBoundary: 'integrateParticipatingRadiance(ray,tMax)_reserved_not_executed_v0',
          composition: 'fresnel_world_reflection_plus_two_interface_refraction_v0',
        },
        environmentMapEvidence: {
          schema: 'kaminos.hdr-environment-map.v0',
          requestedRoute: KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE,
          effectiveRoute: KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ROUTE,
          assetId: KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_ID,
          assetSha256: hdrEnvironment.assetSha256,
          runtimeAssetUrl: KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_ASSET_URL,
          sourceAssetUrl: KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_ASSET_URL,
          sourcePageUrl: KAMINOS_FINGER_FLUID_HDR_ENVIRONMENT_SOURCE_PAGE_URL,
          license: 'CC0-1.0',
          encodedByteLength: hdrEnvironment.encodedByteLength,
          decodeRoute: 'cpu-radiance-rle-rgbe-v0',
          samplingRoute: 'wgsl-manual-bilinear-rgbe-equirectangular-v0',
          filterRoute: KAMINOS_FINGER_FLUID_ENVIRONMENT_FILTER_ROUTE,
          worldBackgroundRoute: KAMINOS_FINGER_FLUID_HDR_WORLD_BACKGROUND_ROUTE,
          width: hdrEnvironment.width,
          height: hdrEnvironment.height,
          gpuTextureFormat: 'rgba8unorm',
          fallbackReason: null,
        },
      } : {}),
      supportPresentationEvidence: {
        route: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_PRESENTATION_ROUTE,
        depthRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
        colorDepthAuthority: 'same_pass_same_analytic_geometry_v0',
        geometrySource: 'toyFloorHeight_toyFloorNormal_plus_analytic_obstacle_v0',
        calibrationLandmarks: 'world_anchored_half_unit_grid_major_grid_and_axes_v0',
        refractionCaptureOrder: 'copy_after_deferred_scene_v0',
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
          channels: ['optical_thickness', 'material_weighted_thickness', 'depth_weight', 'depth_weighted_view_depth_sum'],
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
        opticalQueryRoute: KAMINOS_FINGER_FLUID_HYBRID_OPTICAL_QUERY_ROUTE,
        deferredTraversalRoute: KAMINOS_FINGER_FLUID_DEFERRED_RAY_TRAVERSAL_ROUTE,
        interfaceFidelityRoute: KAMINOS_FINGER_FLUID_INTERFACE_FIDELITY_ROUTE,
        coverageClosure: 'dense_support_footprint_closure_sparse_identity_v0',
        normalFiltering: 'detail_macro_chord_variance_blend_v0',
        legacyDebugMode: 'legacy_interface',
        opticalTransportExecution: lastEffectiveRendererMode !== 'screen_space_refraction'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastOpticalDebugMode === 'interface_fidelity'
            ? 'not_executed_early_interface_diagnostic_v0'
            : 'executed_refraction_and_reflection_transport_v0',
        slabRoute: KAMINOS_FINGER_FLUID_OPTICAL_SLAB_ROUTE,
        slabGeometryPassCount: screenSpaceOpticalSlabGeometryPassCount,
        frontDepthTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-optical-slab-front-depth',
          format: 'rgba16float',
          extent: configuredExtent,
          channels: ['projected_particle_sphere_front_view_depth_min', 'nearest_particle_center_view_depth_min'],
        } : null,
        backDepthTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-optical-slab-back-depth',
          format: 'rgba16float',
          extent: configuredExtent,
          channel: 'projected_particle_sphere_back_view_depth_max',
        } : null,
        accumulationTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-surface-accumulation',
          format: 'rgba16float',
          extent: configuredExtent,
          channels: ['optical_thickness', 'material_weighted_thickness', 'depth_weight', 'depth_weighted_view_depth_sum'],
        } : null,
        slabGeometry: 'projected_particle_interval_hull_not_watertight_surface_v0',
        invalidSlabDisposition: 'entry_interface_only_no_exit_claim_v0',
        supportDepthRoute: KAMINOS_FINGER_FLUID_ANALYTIC_SUPPORT_DEPTH_ROUTE,
        analyticSupportDepthPassCount,
        opticalDebugMode: lastOpticalDebugMode,
        requestedOpticalLightingMode: lastRequestedOpticalLightingMode,
        effectiveOpticalLightingMode: lastEffectiveOpticalLightingMode,
        requestedOpticalLightingRoute: opticalLightingRouteForMode(lastRequestedOpticalLightingMode),
        effectiveOpticalLightingRoute: lastEffectiveOpticalLightingMode === 'not_executed'
          ? KAMINOS_FINGER_FLUID_LIGHTING_NOT_EXECUTED_ROUTE
          : opticalLightingRouteForMode(lastEffectiveOpticalLightingMode),
        opticalLightingFallbackReason: lastOpticalLightingFallbackReason,
        requestedOpticalFootprintMode: lastRequestedOpticalFootprintMode,
        effectiveOpticalFootprintMode: lastEffectiveOpticalFootprintMode,
        requestedOpticalFootprintRoute: opticalFootprintRouteForMode(lastRequestedOpticalFootprintMode),
        effectiveOpticalFootprintRoute: lastEffectiveOpticalFootprintMode === 'not_executed'
          ? KAMINOS_FINGER_FLUID_FOOTPRINT_NOT_EXECUTED_ROUTE
          : opticalFootprintRouteForMode(lastEffectiveOpticalFootprintMode),
        opticalFootprintFallbackReason: lastOpticalFootprintFallbackReason,
        reflectionFootprintComposition: lastEffectiveOpticalFootprintMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastEffectiveOpticalFootprintMode === 'variance_filtered'
            ? 'dense_unresolved_variance_widens_normalized_nine_ray_reflection_lobe_v0'
            : 'resolved_detail_normalized_five_ray_reflection_lobe_v0',
        requestedTransmissionFootprintMode: lastRequestedTransmissionFootprintMode,
        effectiveTransmissionFootprintMode: lastEffectiveTransmissionFootprintMode,
        requestedTransmissionFootprintRoute: transmissionFootprintRouteForMode(lastRequestedTransmissionFootprintMode),
        effectiveTransmissionFootprintRoute: lastEffectiveTransmissionFootprintMode === 'not_executed'
          ? KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_NOT_EXECUTED_ROUTE
          : transmissionFootprintRouteForMode(lastEffectiveTransmissionFootprintMode),
        transmissionFootprintFallbackReason: lastTransmissionFootprintFallbackReason,
        transmissionFootprintComposition: lastEffectiveTransmissionFootprintMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastEffectiveTransmissionFootprintMode === 'dense_exit_filtered'
            ? 'dense_exit_variance_trimmed_three_of_five_hybrid_query_radiance_v0'
            : 'resolved_exit_single_hybrid_query_radiance_v0',
        transmissionQuadratureRoute: lastEffectiveTransmissionFootprintMode === 'not_executed'
          ? KAMINOS_FINGER_FLUID_TRANSMISSION_FOOTPRINT_NOT_EXECUTED_ROUTE
          : lastEffectiveTransmissionFootprintMode === 'dense_exit_filtered'
            ? KAMINOS_FINGER_FLUID_DENSE_EXIT_TRANSMISSION_QUADRATURE_ROUTE
            : KAMINOS_FINGER_FLUID_RESOLVED_EXIT_TRANSMISSION_ROUTE,
        transmissionQuadratureMinimumSampleCount: lastEffectiveTransmissionFootprintMode === 'not_executed' ? null : 1,
        transmissionQuadratureMaximumSampleCount: lastEffectiveTransmissionFootprintMode === 'not_executed'
          ? null
          : lastEffectiveTransmissionFootprintMode === 'dense_exit_filtered' ? 5 : 1,
        transmissionQuadratureSampleCountMode: lastEffectiveTransmissionFootprintMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastEffectiveTransmissionFootprintMode === 'dense_exit_filtered'
            ? 'adaptive_1_sparse_sheet_5_dense_exit_v0'
            : 'fixed_1_v0',
        transmissionQuadratureEstimator: lastEffectiveTransmissionFootprintMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastEffectiveTransmissionFootprintMode === 'dense_exit_filtered'
            ? 'trimmed_min_max_3_of_5_equal_weight_v0'
            : 'resolved_center_ray_v0',
        transmissionApplicability: lastEffectiveTransmissionFootprintMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : 'dense_body_and_unresolved_entry_or_exit_normal_only_sparse_sheet_resolved_v0',
        requestedBodyTransportMode: lastRequestedBodyTransportMode,
        effectiveBodyTransportMode: lastEffectiveBodyTransportMode,
        requestedBodyTransportRoute: bodyTransportRouteForMode(lastRequestedBodyTransportMode),
        effectiveBodyTransportRoute: lastEffectiveBodyTransportMode === 'not_executed'
          ? KAMINOS_FINGER_FLUID_BODY_TRANSPORT_NOT_EXECUTED_ROUTE
          : bodyTransportRouteForMode(lastEffectiveBodyTransportMode),
        bodyTransportFallbackReason: lastBodyTransportFallbackReason,
        bodyTransportComposition: lastEffectiveBodyTransportMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastEffectiveBodyTransportMode === 'robust_dense_body'
            ? 'dense_valid_geometric_thickness_path_closure_with_filtered_radiance_residual_v1'
            : 'geometric_valid_exit_path_with_entry_thickness_fallback_v0',
        bodyTransportApplicability: lastEffectiveBodyTransportMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : 'valid_dense_body_only_sparse_sheet_and_invalid_slab_baseline_v1',
        requestedInterfaceFrequencyMode: lastRequestedInterfaceFrequencyMode,
        effectiveInterfaceFrequencyMode: lastEffectiveInterfaceFrequencyMode,
        requestedInterfaceFrequencyRoute: interfaceFrequencyRouteForMode(lastRequestedInterfaceFrequencyMode),
        effectiveInterfaceFrequencyRoute: lastEffectiveInterfaceFrequencyMode === 'not_executed'
          ? KAMINOS_FINGER_FLUID_INTERFACE_FREQUENCY_NOT_EXECUTED_ROUTE
          : interfaceFrequencyRouteForMode(lastEffectiveInterfaceFrequencyMode),
        interfaceFrequencyFallbackReason: lastInterfaceFrequencyFallbackReason,
        interfaceFrequencyComposition: lastEffectiveInterfaceFrequencyMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastEffectiveInterfaceFrequencyMode === 'macro_micro_separated'
            ? 'macro_snell_fresnel_bounded_micro_reflection_path_conditioned_transmission_v1'
            : 'coupled_detail_interface_transport_baseline_v0',
        interfaceFrequencyApplicability: lastEffectiveInterfaceFrequencyMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : 'all_refraction_fragments_macro_transport_bounded_micro_optics_v1',
        lightingComposition: lastEffectiveOpticalLightingMode === 'not_executed'
          ? 'not_executed_non_refraction_renderer_v0'
          : lastEffectiveOpticalLightingMode === 'transport_only'
            ? 'fresnel_reflection_refraction_absorption_scatter_no_direct_addition_v0'
            : lastEffectiveOpticalLightingMode === 'bounded_ggx'
              ? 'transport_plus_energy_bounded_view_dependent_ggx_v0'
              : 'diagnostic_legacy_absorption_and_post_fresnel_additive_lobes_v0',
        sceneColorTexture: configuredExtent ? {
          label: 'kaminos-finger-fluid-refraction-scene-color',
          format: LINEAR_SCENE_FORMAT,
          extent: configuredExtent,
          source: 'same-camera-linear-hdr-scene-radiance-v0',
        } : null,
        scenePassCount: screenSpaceRefractionScenePassCount,
        accumulationPassCount: screenSpaceSurfaceAccumulationPassCount,
        compositePassCount: screenSpaceRefractionCompositePassCount,
        refraction: 'bounded_air_to_water_slab_propagation_water_to_air_snell_then_hybrid_exit_ray_query_v0',
        fresnel: 'schlick_f0_0.02037_v0',
        absorption: 'beer_lambert_from_particle_optical_thickness_v0',
        absorptionCoefficients: lastEffectiveOpticalLightingMode === 'not_executed'
          ? null
          : fingerFluidAbsorptionCoefficientsForLightingMode(lastEffectiveOpticalLightingMode),
        coverage: 'geometric_accumulation_support_alpha_independent_of_fresnel_v0',
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
    liveInletBuffer.destroy();
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
    movingHillSupportProvider?.release?.();
    analyticCarrierParticleBuffer.destroy();
    analyticCarrierNeighborTopologyBuffer.destroy();
    analyticCarrierMaterialTracerBuffer.destroy();
    dynamicReflectionMeshPositionBuffer.destroy();
    dynamicReflectionMeshNormalBuffer.destroy();
    dynamicReflectionMeshIndexBuffer.destroy();
    dynamicReflectionSceneParamsBuffer.destroy();
    hdrEnvironmentTexture.destroy();
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
    linearSceneRadianceTexture?.destroy();
    screenSpaceRefractionSceneTexture?.destroy();
    deferredWorldNormalRoughnessTexture?.destroy();
    deferredAlbedoMetallicTexture?.destroy();
    deferredLinearDepthObjectTexture?.destroy();
  }

  device.lost.then(info => {
    destroyed = true;
    console.error('Kaminos Finger Fluid WebGPU device lost:', info.message || info.reason);
  });

  runtimeApi = {
    available: true,
    solver_backend: 'webgpu_compute',
    render_backend: 'webgpu_direct_render',
    renderer_mode: safeRendererMode,
    optical_lighting_mode: safeOpticalLightingMode,
    optical_footprint_mode: safeOpticalFootprintMode,
    transmission_footprint_mode: safeTransmissionFootprintMode,
    body_transport_mode: safeBodyTransportMode,
    interface_frequency_mode: safeInterfaceFrequencyMode,
    step,
    render,
    requestDiagnostics,
    setLiveInletPacket,
    setAnalyticCarrierOpticalGeometry,
    clearAnalyticCarrierOpticalGeometry,
    getLiquidFireContactDescriptor,
    setReflectionMeshPhaseForWitness,
    getParticleOwnershipDescriptor,
    getDebugState,
    destroy,
  };
  return runtimeApi;
}
