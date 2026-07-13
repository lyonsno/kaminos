export const KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA = 'kaminos.finger-fluid-bench.state.v0';
export const KAMINOS_FINGER_FLUID_BENCH_ROUTE = 'kaminos/finger-fluid-bench';
export const BIG_PAPA_FLUID_SOURCE_SCHEMA = 'big-papa.finger-fluid.synthetic-source.v0';
export const KAMINOS_FINGER_FLUID_SOLVER_IDENTITY = 'webgpu-pbf-linked-cell-fluid-v0';
export const KAMINOS_FINGER_FLUID_RENDERER_IDENTITY = 'webgpu-particle-sphere-renderer-v0';

export const KAMINOS_FINGER_FLUID_DOWGRADES = [
  'kaminos_native_synthetic_fluid_not_lerms_source_truth',
  'particle_render_not_final_surface_reconstruction',
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
      pressureProjection: 'iterative_position_density_projection',
      stepCount: nonNegativeInteger(options.stepCount, 0),
      linkedCellGridBuildCount: nonNegativeInteger(options.linkedCellGridBuildCount, 0),
      densityIterationCount: nonNegativeInteger(options.densityIterationCount, 0),
      frameTimeMsEstimate: finite(options.frameTimeMsEstimate, 26.5),
    },
    renderer: {
      identity: KAMINOS_FINGER_FLUID_RENDERER_IDENTITY,
      backend: options.renderBackend || 'loading',
      surface: 'direct_webgpu_particle_sphere_billboards_in_kaminos_viewport',
      directRenderFrameCount: nonNegativeInteger(options.directRenderFrameCount, 0),
      finalFingerJuiceRenderer: false,
    },
    visual: {
      viewport: viewportOrDefault(options.viewport),
      timeSeconds: finite(options.timeSeconds, 0),
      basinFillRatio: ratio(options.basinFillRatio, 0.48),
      activeRatio: ratio(options.activeRatio, 0.42),
      colorModel: 'teal_blue_lilac_gold_source_channels',
      activeExtent3d: options.activeExtent3d || null,
    },
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
