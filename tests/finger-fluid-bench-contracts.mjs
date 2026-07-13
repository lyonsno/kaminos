import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const benchCorePath = join(root, 'finger-fluid-bench-core.js');
const webgpuCorePath = join(root, 'finger-fluid-webgpu-core.js');
const benchWitnessPath = join(root, 'finger-fluid-bench-witness.mjs');
const indexPath = join(root, 'index.html');

assert.ok(existsSync(benchCorePath), 'Kaminos-native finger fluid bench core exists');
assert.ok(existsSync(webgpuCorePath), 'Kaminos-native WebGPU 3D fluid core exists');
assert.ok(existsSync(benchWitnessPath), 'Kaminos-native finger fluid bench witness exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');

const benchCoreSource = readFileSync(benchCorePath, 'utf8');
const webgpuCoreSource = readFileSync(webgpuCorePath, 'utf8');
const benchWitnessSource = readFileSync(benchWitnessPath, 'utf8');
const indexSource = readFileSync(indexPath, 'utf8');

assert.match(benchCoreSource, /KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA\s*=\s*'kaminos\.finger-fluid-bench\.state\.v0'/, 'bench state schema is explicit');
assert.match(benchCoreSource, /KAMINOS_FINGER_FLUID_BENCH_ROUTE\s*=\s*'kaminos\/finger-fluid-bench'/, 'bench route identity is explicit');
assert.match(benchCoreSource, /BIG_PAPA_FLUID_SOURCE_SCHEMA\s*=\s*'big-papa\.finger-fluid\.synthetic-source\.v0'/, 'bench source schema is explicit');
assert.match(benchCoreSource, /webgpu-pbf-linked-cell-fluid-v0/, 'bench records the real GPU solver identity');
assert.match(benchCoreSource, /kaminos_native_synthetic_fluid_not_lerms_source_truth/, 'bench keeps synthetic source downgrade loud');
assert.match(benchCoreSource, /particle_render_not_final_surface_reconstruction/, 'bench distinguishes particle rendering from final surface reconstruction');
assert.match(benchCoreSource, /createFingerFluidBenchState/, 'bench core exports state creation');

assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_GPU_SOLVER_ROUTE\s*=\s*'webgpu-pbf-linked-cell-fluid-v0'/, 'GPU solver route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_NEIGHBOR_GRID_CONTRACT\s*=\s*'wgsl-linked-cell-neighbor-grid-v0'/, 'linked-cell neighbor grid contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_DENSITY_CONTRACT\s*=\s*'wgsl-pbf-density-constraint-v0'/, 'PBF density contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_VORTICITY_CONTRACT\s*=\s*'wgsl-neighbor-vorticity-confinement-v0'/, 'neighbor-derived vorticity contract is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_OBSTACLE_CONTRACT\s*=\s*'shared-solver-render-obstacle-v0'/, 'solver and renderer share an obstacle contract');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_GPU_RENDERER_ROUTE\s*=\s*'webgpu-particle-sphere-renderer-v0'/, 'direct GPU renderer route is explicit');
assert.match(webgpuCoreSource, /KAMINOS_FINGER_FLUID_STABILITY_CONTRACT\s*=\s*'bounded-pbf-energy-v0'/, 'bounded-energy stability contract is explicit');
assert.match(webgpuCoreSource, /MAX_FLUID_SPEED\s*=\s*3\.2/, 'fluid speed ceiling is explicit and source-owned');
assert.match(webgpuCoreSource, /restDensity:\s*24\.3/, 'calibrated packed-state rest density is exposed');
assert.match(webgpuCoreSource, /GRID_DIMS\s*=\s*\[32, 20, 32\]/, 'linked-cell domain has 3D neighborhood resolution');
assert.match(webgpuCoreSource, /BOUNDS_MIN\s*=\s*\[-3\.4, -1\.2, -3\.4\]/, 'fluid domain leaves room around the finite liquid body');
assert.match(webgpuCoreSource, /let radial = 0\.15 \* \(p\.x \* p\.x \+ p\.z \* p\.z\)/, 'smoke basin confines the calibrated volume into a deep finite body');
assert.match(webgpuCoreSource, /fn floorNormal\(p: vec3<f32>\) -> vec3<f32>/, 'height-field collision exposes an analytic terrain normal');
assert.match(webgpuCoreSource, /p = p \+ normal \* \(penetration \/ max\(normal\.y, 0\.15\)\)/, 'terrain penetration resolves along the support normal');
assert.match(webgpuCoreSource, /velocity = velocity - normal \* normalSpeed/, 'terrain contact removes inward normal velocity without vertical teleport energy');
assert.match(webgpuCoreSource, /const OBSTACLE_CENTER = \[0\.85, -0\.43, 0\.02\]/, 'obstacle center has one JavaScript source of truth');
assert.match(webgpuCoreSource, /const OBSTACLE_RADIUS = 0\.52/, 'obstacle radius has one JavaScript source of truth');
assert.match(webgpuCoreSource, /const VORTICITY_UPDATE_INTERVAL = 3/, 'vorticity cadence is explicit rather than silently omitted under load');
assert.match(webgpuCoreSource, /let sphereCenter = vec3<f32>\(\$\{OBSTACLE_CENTER\[0\]\}, \$\{OBSTACLE_CENTER\[1\]\}, \$\{OBSTACLE_CENTER\[2\]\}\)/, 'collision shader consumes the shared obstacle center');
assert.match(webgpuCoreSource, /let sphereRadius = \$\{OBSTACLE_RADIUS\} \+ radius/, 'collision shader consumes the shared obstacle radius');
assert.match(webgpuCoreSource, /const y = -0\.45 \+ yIndex \* spacing/, 'packed source volume begins above terrain support');
assert.match(webgpuCoreSource, /GPUBufferUsage\.STORAGE/, 'particle and neighbor state lives in GPU storage buffers');
assert.match(webgpuCoreSource, /atomicExchange\s*\(/, 'particles are binned into GPU linked cells');
assert.match(webgpuCoreSource, /cellHeads/, 'linked-cell head storage is present');
assert.match(webgpuCoreSource, /particleNext/, 'linked-cell particle links are present');
assert.match(webgpuCoreSource, /pipelineFor\('predict_positions'\)/, 'solver predicts 3D positions on GPU');
assert.match(webgpuCoreSource, /pipelineFor\('compute_density_lambda'\)/, 'solver computes PBF density lambdas');
assert.match(webgpuCoreSource, /pipelineFor\('solve_position_delta'\)/, 'solver computes density position corrections');
assert.match(webgpuCoreSource, /pipelineFor\('apply_position_delta'\)/, 'solver applies density position corrections');
assert.match(webgpuCoreSource, /pipelineFor\('compute_vorticity'\)/, 'solver computes neighbor-derived curl after projection');
assert.match(webgpuCoreSource, /pipelineFor\('apply_vorticity_confinement'\)/, 'solver applies a separate vorticity confinement pass');
assert.match(webgpuCoreSource, /dispatch\(pass, pipelines\.vorticity, safeParticleCount\);[\s\S]*?dispatch\(pass, pipelines\.confinement, safeParticleCount\);/, 'vorticity passes execute across separate GPU dispatch barriers');
assert.doesNotMatch(webgpuCoreSource, /let swirl = vec3<f32>/, 'neighbor-derived vorticity replaces synthetic global swirl forcing');
assert.match(webgpuCoreSource, /dispatchWorkgroups/, 'solver dispatches GPU compute work');
assert.match(webgpuCoreSource, /createRenderPipeline/, 'solver state is rendered directly on GPU');
assert.match(webgpuCoreSource, /createWebGPUFingerFluidSolver/, 'GPU solver factory is exported');
assert.match(webgpuCoreSource, /stepCount:\s*diagnosticsStepCount/, 'sparse GPU diagnostics carry the exact simulation step they represent');
assert.match(webgpuCoreSource, /const diagnosticsCapturedAtMs = performance\.now\(\);[\s\S]*?createCommandEncoder/, 'diagnostic age begins when the GPU copy is submitted');
assert.match(webgpuCoreSource, /capturedAtMs:\s*Number\(diagnosticsCapturedAtMs\.toFixed\(1\)\)/, 'sparse GPU diagnostics preserve submission-time provenance');
assert.match(webgpuCoreSource, /averageVorticity/, 'GPU diagnostics quantify settled curl rather than only counting passes');
assert.match(webgpuCoreSource, /vorticityPassCount/, 'runtime evidence reports executed vorticity passes');
assert.match(webgpuCoreSource, /vorticityUpdateInterval/, 'runtime evidence reports the effective vorticity cadence');
assert.match(webgpuCoreSource, /isObstacle/, 'the direct renderer distinguishes shared obstacle support geometry');
assert.match(webgpuCoreSource, /pass\.draw\(6, safeParticleCount \+ 1\)/, 'the exact solver obstacle is rendered as one additional instance');

assert.match(indexSource, /data-tab="finger-fluid-bench"/, 'Kaminos sidebar exposes a Finger Fluid bench tab');
assert.match(indexSource, /id="tab-finger-fluid-bench"/, 'Kaminos app shell contains Finger Fluid bench content');
assert.match(indexSource, /kaminos_finger_fluid_bench=1/, 'Kaminos route can open directly into the fluid bench');
assert.match(indexSource, /id="finger-fluid-bench-canvas"/, 'fluid bench owns a native canvas');
assert.match(indexSource, /window\.kaminosFingerFluidBenchDebugState/, 'fluid bench exposes browser witness state');
assert.match(indexSource, /createWebGPUFingerFluidSolver/, 'native bench constructs the real WebGPU fluid solver');
assert.match(indexSource, /fingerFluidBenchCamera = \{ yaw: -0\.55, pitch: 0\.34, distance: 4\.45/, 'default camera fills the native viewport with the simulated volume');
assert.doesNotMatch(indexSource, /smoothFluidNoise/, 'native bench no longer renders a synthetic noise field');
const canvasExtentFunction = indexSource.match(/function ensureFingerFluidBenchCanvasSize\(canvas\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(canvasExtentFunction, 'fluid bench canvas extent measurement exists');
assert.doesNotMatch(canvasExtentFunction, /canvas\.(?:width|height)\s*=/, 'page code must not resize a WebGPU-configured drawing buffer');
assert.match(indexSource, /kaminos\/finger-fluid-bench/, 'fluid bench displays route identity');
assert.doesNotMatch(indexSource, /finger-fluid-bench-open-direct/, 'fluid bench must not expose Open Direct/new-tab acceptance escape');
assert.doesNotMatch(indexSource, /id="finger-fluid-bench-frame"/, 'fluid bench must not use iframe as acceptance surface');

assert.match(benchWitnessSource, /kaminos_finger_fluid_bench=1/, 'bench witness opens the native fluid bench route');
assert.match(benchWitnessSource, /kaminosFingerFluidBenchDebugState/, 'bench witness reads native fluid bench debug state');
assert.match(benchWitnessSource, /kaminos\.finger-fluid-bench\.state\.v0/, 'bench witness requires bench state schema');
assert.match(benchWitnessSource, /primary_output_written/, 'bench witness writes durable failure reports before screenshot success');
assert.match(benchWitnessSource, /activeRatio/, 'bench witness measures visible activity ratio');
assert.match(benchWitnessSource, /canvasActivity\.activeRatio < 0\.09/, 'bench witness rejects a fluid subject that wastes the viewport');
assert.match(benchWitnessSource, /kaminos_native_synthetic_fluid_not_lerms_source_truth/, 'bench witness requires synthetic downgrade evidence');
assert.match(benchWitnessSource, /webgpu_compute/, 'bench witness requires the WebGPU compute backend');
assert.match(benchWitnessSource, /webgpu_direct_render/, 'bench witness requires direct WebGPU rendering');
assert.match(benchWitnessSource, /linkedCellGridBuildCount/, 'bench witness requires linked-cell grid evidence');
assert.match(benchWitnessSource, /densityIterationCount/, 'bench witness requires density iteration evidence');
assert.match(benchWitnessSource, /vorticityPassCount/, 'bench witness requires vorticity execution evidence');
assert.match(benchWitnessSource, /averageVorticity/, 'bench witness requires quantitative curl evidence');
assert.match(benchWitnessSource, /shared-solver-render-obstacle-v0/, 'bench witness requires attributable obstacle geometry');
assert.match(benchWitnessSource, /activeExtent3d/, 'bench witness requires non-flat 3D extent evidence');
assert.match(benchWitnessSource, /maxSpeed\s*>\s*3\.35/, 'bench witness rejects energetic solver blow-up');
assert.match(benchWitnessSource, /relativeDensityError/, 'bench witness rejects density convergence to the wrong basin');
assert.match(benchWitnessSource, /diagnosticsAgeMs > 3000/, 'bench witness rejects stale sparse diagnostics by elapsed time rather than frame count');
assert.match(benchWitnessSource, /cadenceProbe/, 'bench witness measures settled live cadence');
assert.match(benchWitnessSource, /--cadence-ms/, 'bench witness accepts an explicit, reportable cadence observation window');
assert.match(benchWitnessSource, /--device-scale-factor/, 'bench witness can reproduce Retina drawing-buffer behavior');
assert.match(benchWitnessSource, /deviceScaleFactor/, 'bench witness records and applies its effective device scale factor');
assert.match(benchWitnessSource, /cadenceWindowMs:\s*cadenceMs/, 'bench witness records its effective cadence window');
assert.match(benchWitnessSource, /fallback/, 'bench witness explicitly rejects fallback closure');
assert.ok(
  benchWitnessSource.indexOf("phase = 'measure_canvas'") < benchWitnessSource.indexOf("phase = 'cadence_probe'"),
  'visual evidence is preserved before a later cadence failure',
);

const mod = await import(benchCorePath);
assert.equal(mod.KAMINOS_FINGER_FLUID_BENCH_STATE_SCHEMA, 'kaminos.finger-fluid-bench.state.v0');
assert.equal(mod.KAMINOS_FINGER_FLUID_BENCH_ROUTE, 'kaminos/finger-fluid-bench');
assert.equal(mod.BIG_PAPA_FLUID_SOURCE_SCHEMA, 'big-papa.finger-fluid.synthetic-source.v0');
assert.equal(typeof mod.createFingerFluidBenchState, 'function');

const state = mod.createFingerFluidBenchState({
  viewport: { width: 1280, height: 800 },
  timeSeconds: 2.5,
  fieldColumns: 96,
  fieldRows: 64,
  basinFillRatio: 0.46,
  activeRatio: 0.38,
  frameTimeMsEstimate: 26.5,
});

assert.equal(state.schema, 'kaminos.finger-fluid-bench.state.v0');
assert.equal(state.route, 'kaminos/finger-fluid-bench');
assert.equal(state.source.schema, 'big-papa.finger-fluid.synthetic-source.v0');
assert.equal(state.source.producerDiaulos, 'big-papa-finger-fluid');
assert.equal(state.solver.identity, 'webgpu-pbf-linked-cell-fluid-v0');
assert.deepEqual(state.solver.gridDimensions, [32, 20, 32]);
assert.equal(state.solver.vorticityConfinement, 'wgsl-neighbor-vorticity-confinement-v0');
assert.equal(state.renderer.identity, 'webgpu-particle-sphere-renderer-v0');
assert.equal(state.renderer.obstacleContract, 'shared-solver-render-obstacle-v0');
assert.equal(state.graduation.mode, 'remain_in_kaminos_terrarium_until_source_exports_earn_extraction');
assert.ok(state.downgrades.includes('kaminos_native_synthetic_fluid_not_lerms_source_truth'));
assert.ok(state.downgrades.includes('particle_render_not_final_surface_reconstruction'));
assert.ok(state.compatibility.lermsEventSchemas.includes('lerms.juice-hit-event.v0'));
assert.ok(state.visual.activeRatio >= 0.38);
assert.ok(state.visual.basinFillRatio >= 0.46);
assert.equal(state.acceptance.acceptanceSurface, 'native_kaminos_route');
assert.equal(state.acceptance.iframeAcceptance, false);
assert.equal(state.acceptance.openDirectAcceptance, false);
