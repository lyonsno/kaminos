export const KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA = 'kaminos.finger-fluid-bench.state.v0';
export const KAMINOS_FINGER_FLUID_BENCH_ROUTE = 'kaminos/finger-fluid-bench';
export const BIG_PAPA_FLUID_SOURCE_SCHEMA = 'big-papa.finger-fluid.synthetic-source.v0';
export const KAMINOS_FINGER_FLUID_SOLVER_IDENTITY = 'webgpu-pbf-linked-cell-fluid-v0';
export const KAMINOS_FINGER_FLUID_RENDERER_IDENTITY = 'webgpu-particle-sphere-renderer-v0';
export const KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_IDENTITY = 'webgpu-screen-space-liquid-surface-v0';
export const KAMINOS_FINGER_FLUID_REFRACTION_RENDERER_IDENTITY = 'webgpu-screen-space-liquid-refraction-v0';
export const KAMINOS_FINGER_FLUID_SPHERE_DEBUG_RENDERER_IDENTITY = 'webgpu-particle-sphere-debug-renderer-v0';
export const KAMINOS_FINGER_FLUID_PLAYGROUND_IDENTITY = 'wgsl-shared-multi-regime-toy-playground-v0';
export const KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_IDENTITY = 'kaminos.liquid-interface-carrier.v0';
export const KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_IDENTITY = 'wgsl-solver-owned-interface-normal-curvature-confidence-v1';
export const KAMINOS_FINGER_FLUID_REST_STATE_IDENTITY = 'wgsl-support-aware-persistent-rest-state-v0';
export const KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_IDENTITY = 'wgsl-support-tangential-transport-v0';
export const KAMINOS_FINGER_FLUID_SUPPORT_FRICTION_IDENTITY = 'wgsl-analytic-contact-partial-slip-v0';
export const KAMINOS_FINGER_FLUID_ENERGY_LEDGER_IDENTITY = 'wgsl-per-pass-kinetic-energy-ledger-v0';
export const KAMINOS_FINGER_FLUID_TOPOLOGY_IDENTITY = 'wgsl-four-neighbor-topology-retention-v0';
export const KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_IDENTITY = 'wgsl-opt-in-support-tangential-particle-shift-v0';
export const KAMINOS_FINGER_FLUID_CHEMISTRY_IDENTITY = 'wgsl-passive-material-tracer-diffusion-v0';

export const KAMINOS_FINGER_FLUID_DOWGRADES = [
  'kaminos_native_synthetic_fluid_not_lerms_source_truth',
  'particle_render_not_final_surface_reconstruction',
  'screen_space_surface_first_slice_not_final_surface_reconstruction',
  'screen_space_refraction_projected_slab_v0_not_watertight_optical_transport',
];

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, Math.floor(finite(value, fallback)));
}

function ratio(value, fallback = 0) {
  return Math.max(0, Math.min(1, finite(value, fallback)));
}

function viewportOrDefault(viewport) {
  const source = viewport && typeof viewport === 'object' ? viewport : {};
  return {
    width: nonNegativeInteger(source.width, 0),
    height: nonNegativeInteger(source.height, 0),
  };
}

export function createFingerFluidBenchState(options = {}) {
  const downgrades = [...KAMINOS_FINGER_FLUID_DOWGRADES];
  for (const downgrade of Array.isArray(options.downgrades) ? options.downgrades : []) {
    if (downgrade && !downgrades.includes(String(downgrade))) downgrades.push(String(downgrade));
  }
  const requestedRendererMode = options.requestedRendererMode || 'screen_space_surface';
  const effectiveRendererMode = options.effectiveRendererMode || requestedRendererMode;
  const requestedOpticalLightingMode = options.requestedOpticalLightingMode || 'transport_only';
  const requestedOpticalLightingRoute = options.requestedOpticalLightingRoute || {
    transport_only: 'wgsl-liquid-transport-only-lighting-v0',
    bounded_ggx: 'wgsl-liquid-bounded-ggx-lighting-v0',
    legacy_shading: 'wgsl-liquid-legacy-shading-v0',
  }[requestedOpticalLightingMode] || `unsupported-optical-lighting-mode:${requestedOpticalLightingMode}`;
  const effectiveOpticalLightingMode = options.effectiveOpticalLightingMode
    || (effectiveRendererMode === 'screen_space_refraction' ? requestedOpticalLightingMode : 'not_executed');
  const effectiveOpticalLightingRoute = options.effectiveOpticalLightingRoute
    || (effectiveOpticalLightingMode === 'not_executed'
      ? 'not-executed-non-refraction-renderer-v0'
      : requestedOpticalLightingRoute);
  const requestedOpticalFootprintMode = options.requestedOpticalFootprintMode || 'resolved_detail';
  const requestedOpticalFootprintRoute = options.requestedOpticalFootprintRoute || {
    resolved_detail: 'wgsl-liquid-resolved-detail-reflection-footprint-v0',
    variance_filtered: 'wgsl-liquid-dense-variance-filtered-reflection-footprint-v0',
  }[requestedOpticalFootprintMode] || `unsupported-optical-footprint-mode:${requestedOpticalFootprintMode}`;
  const effectiveOpticalFootprintMode = options.effectiveOpticalFootprintMode
    || (effectiveRendererMode === 'screen_space_refraction' ? requestedOpticalFootprintMode : 'not_executed');
  const effectiveOpticalFootprintRoute = options.effectiveOpticalFootprintRoute
    || (effectiveOpticalFootprintMode === 'not_executed'
      ? 'not-executed-non-refraction-renderer-v0'
      : requestedOpticalFootprintRoute);

  return {
    schema: KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA,
    route: KAMINOS_FINGER_FLUID_BENCH_ROUTE,
    status: options.status || 'running',
    source: {
      schema: BIG_PAPA_FLUID_SOURCE_SCHEMA,
      producerDiaulos: 'big-papa-finger-fluid',
      authority: 'synthetic_kaminos_fluid_bench',
      sourceTruthAuthority: 'kaminos_native_synthetic_fluid_not_lerms_source_truth',
      sourcePacketId: options.sourcePacketId || 'kaminos-native-fluid-bench-synthetic-source-v0',
    },
    solver: {
      identity: KAMINOS_FINGER_FLUID_SOLVER_IDENTITY,
      backend: options.solverBackend || 'loading',
      mode: 'gpu_3d_linked_cell_position_based_fluid',
      particleCount: nonNegativeInteger(options.particleCount, 0),
      gridDimensions: options.gridDimensions || [32, 20, 32],
      neighborGridContract: options.neighborGridContract || 'wgsl-linked-cell-neighbor-grid-v0',
      densityContinuity: options.densityContract || 'wgsl-pbf-density-constraint-v0',
      boundaryPressureContract: options.boundaryPressureContract || 'wgsl-analytic-boundary-density-support-v0',
      pressureProjection: 'iterative_position_density_projection',
      vorticityConfinement: options.vorticityConfinementContract || 'wgsl-neighbor-vorticity-confinement-v0',
      freeSurfaceCohesion: options.freeSurfaceContract || 'wgsl-neighbor-free-surface-cohesion-v0',
      restStateContract: options.restStateContract || KAMINOS_FINGER_FLUID_REST_STATE_IDENTITY,
      supportTransportContract: options.supportTransportContract || KAMINOS_FINGER_FLUID_SUPPORT_TRANSPORT_IDENTITY,
      supportFrictionContract: options.supportFrictionContract || KAMINOS_FINGER_FLUID_SUPPORT_FRICTION_IDENTITY,
      supportFriction: finite(options.supportFriction, 1.6),
      energyLedgerContract: options.energyLedgerContract || KAMINOS_FINGER_FLUID_ENERGY_LEDGER_IDENTITY,
      energyLedger: options.energyLedger || null,
      topologyContract: options.topologyContract || KAMINOS_FINGER_FLUID_TOPOLOGY_IDENTITY,
      particleShiftContract: options.particleShiftContract || KAMINOS_FINGER_FLUID_PARTICLE_SHIFT_IDENTITY,
      particleShiftStrength: finite(options.particleShiftStrength, 0),
      particleShiftPassCount: nonNegativeInteger(options.particleShiftPassCount, 0),
      chemistryContract: options.chemistryContract || KAMINOS_FINGER_FLUID_CHEMISTRY_IDENTITY,
      chemistryDiffusion: finite(options.chemistryDiffusion, 0),
      chemistryDiffusionPassCount: nonNegativeInteger(options.chemistryDiffusionPassCount, 0),
      playgroundContract: options.playgroundContract || KAMINOS_FINGER_FLUID_PLAYGROUND_IDENTITY,
      interfaceCarrierSchema: options.interfaceCarrierSchema || KAMINOS_FINGER_FLUID_INTERFACE_CARRIER_IDENTITY,
      interfaceGeometryContract: options.interfaceGeometryContract || KAMINOS_FINGER_FLUID_INTERFACE_GEOMETRY_IDENTITY,
      stepCount: nonNegativeInteger(options.stepCount, 0),
      linkedCellGridBuildCount: nonNegativeInteger(options.linkedCellGridBuildCount, 0),
      densityIterationCount: nonNegativeInteger(options.densityIterationCount, 0),
      vorticityPassCount: nonNegativeInteger(options.vorticityPassCount, 0),
      postProjectionGridRefreshCount: nonNegativeInteger(options.postProjectionGridRefreshCount, 0),
      freeSurfaceClassificationPassCount: nonNegativeInteger(options.freeSurfaceClassificationPassCount, 0),
      surfaceCohesionPassCount: nonNegativeInteger(options.surfaceCohesionPassCount, 0),
      interfaceCompactionPassCount: nonNegativeInteger(options.interfaceCompactionPassCount, 0),
      frameTimeMsEstimate: finite(options.frameTimeMsEstimate, 26.5),
    },
    renderer: {
      identity: options.rendererIdentity || KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_IDENTITY,
      backend: options.renderBackend || 'loading',
      requestedMode: requestedRendererMode,
      effectiveMode: effectiveRendererMode,
      requestedRenderer: options.requestedRenderer || KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_IDENTITY,
      effectiveRenderer: options.effectiveRenderer || options.rendererIdentity || KAMINOS_FINGER_FLUID_SCREEN_SPACE_RENDERER_IDENTITY,
      fallbackReason: options.rendererFallbackReason || null,
      surface: options.rendererSurface || 'screen_space_particle_depth_optical_thickness_smooth_normals_fresnel_absorption',
      obstacleContract: options.obstacleContract || 'shared-solver-render-obstacle-v0',
      playgroundContract: options.playgroundContract || KAMINOS_FINGER_FLUID_PLAYGROUND_IDENTITY,
      supportGeometryCount: nonNegativeInteger(options.supportGeometryCount, 0),
      directRenderFrameCount: nonNegativeInteger(options.directRenderFrameCount, 0),
      sphereDebugRenderFrameCount: nonNegativeInteger(options.sphereDebugRenderFrameCount, 0),
      screenSpaceSurfaceRenderFrameCount: nonNegativeInteger(options.screenSpaceSurfaceRenderFrameCount, 0),
      screenSpaceRefractionRenderFrameCount: nonNegativeInteger(options.screenSpaceRefractionRenderFrameCount, 0),
      requestedOpticalDebugMode: options.requestedOpticalDebugMode || 'shaded',
      effectiveOpticalDebugMode: options.effectiveOpticalDebugMode || options.requestedOpticalDebugMode || 'shaded',
      requestedOpticalLightingMode,
      effectiveOpticalLightingMode,
      requestedOpticalLightingRoute,
      effectiveOpticalLightingRoute,
      opticalLightingFallbackReason: options.opticalLightingFallbackReason || null,
      requestedOpticalFootprintMode,
      effectiveOpticalFootprintMode,
      requestedOpticalFootprintRoute,
      effectiveOpticalFootprintRoute,
      opticalFootprintFallbackReason: options.opticalFootprintFallbackReason || null,
      opticalTransportRoute: options.opticalTransportRoute || 'snell-two-interface-screen-space-slab-v0',
      finalFingerJuiceRenderer: false,
      colorMode: options.colorMode || 'phase',
    },
    visual: {
      viewport: viewportOrDefault(options.viewport),
      timeSeconds: finite(options.timeSeconds, 0),
      basinFillRatio: ratio(options.basinFillRatio, 0.48),
      activeRatio: ratio(options.activeRatio, 0.42),
      colorModel: 'teal_blue_lilac_gold_source_channels',
      activeExtent3d: options.activeExtent3d || null,
    },
    playground: options.playground || null,
    config: options.config || null,
    playgroundZoneDiagnostics: options.playgroundZoneDiagnostics || null,
    laminarInletDiagnostics: options.laminarInletDiagnostics || null,
    interfaceCarrier: options.interfaceCarrier || null,
    downgrades,
    compatibility: {
      lermsEventSchemas: ['lerms.juice-hit-event.v0'],
      expectedExports: [
        'route/config/freshness/world-frame truth',
        'target kind/id',
        'contact point',
        'impulse vector',
        'chemistry',
        'source packet id',
      ],
    },
    graduation: {
      mode: 'remain_in_kaminos_terrarium_until_source_exports_earn_extraction',
      nextGate: 'real_solver_state_and_source_honest_lerms_export_adapter',
    },
    acceptance: {
      acceptanceSurface: 'native_kaminos_route',
      iframeAcceptance: false,
      openDirectAcceptance: false,
    },
  };
}
