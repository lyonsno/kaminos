import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'lerms-finger-juice-core.js');
const webgpuCorePath = join(root, 'lerms-finger-juice-webgpu-core.js');
const pagePath = join(root, 'lerms-finger-juice.html');
const witnessPath = join(root, 'lerms-finger-juice-witness.mjs');
const tabWitnessPath = join(root, 'kaminos-finger-juice-tab-witness.mjs');
const hostPacketCliPath = join(root, 'lerms-finger-juice-host-packet.mjs');
const indexPath = join(root, 'index.html');
const previewBenchDocsPath = join(root, 'docs', 'preview-bench-adapters.md');

assert.ok(existsSync(corePath), 'world finger-juice core module exists');
assert.ok(existsSync(webgpuCorePath), 'WebGPU finger-juice core module exists');
assert.ok(existsSync(pagePath), 'world finger-juice prototype page exists');
assert.ok(existsSync(witnessPath), 'world finger-juice route witness exists');
assert.ok(existsSync(tabWitnessPath), 'Kaminos Finger Juice tab witness exists');
assert.ok(existsSync(hostPacketCliPath), 'Big Papa host-packet file emitter exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');
assert.ok(existsSync(previewBenchDocsPath), 'Kaminos Preview Bench adapter docs exist for generic payload smokes');

const coreSource = readFileSync(corePath, 'utf8');
const webgpuCoreSource = readFileSync(webgpuCorePath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');
const tabWitnessSource = existsSync(tabWitnessPath) ? readFileSync(tabWitnessPath, 'utf8') : '';
const hostPacketCliSource = existsSync(hostPacketCliPath) ? readFileSync(hostPacketCliPath, 'utf8') : '';
const indexSource = readFileSync(indexPath, 'utf8');
const previewBenchDocsSource = readFileSync(previewBenchDocsPath, 'utf8');

assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA\s*=\s*'lerms\.world-finger-juice-emitters\.v0'/, 'emitter packet schema is explicit');
assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_ROUTE\s*=\s*'world-space-ballistic-surface-flow-particles-v0'/, 'transport route identity is explicit');
assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT\s*=\s*'hill-of-hills-heightfield-collision-v0'/, 'terrain collision contract is explicit');
assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT\s*=\s*'finger-aim-ballistic-arc-range-v0'/, 'ballistic arc contract is explicit');
assert.match(coreSource, /stale_visual_only/, 'normalization preserves stale visual-only authority');
assert.match(coreSource, /simulation_authority/, 'normalization records whole-packet simulation authority');
assert.match(coreSource, /hand_sample_space/, 'packet records source hand sample space');
assert.match(coreSource, /lerms_world_frame/, 'packet records destination LERMS world frame');
assert.match(coreSource, /world_from_hand_sample/, 'packet records transform identity instead of guessing signs');
assert.match(coreSource, /force_safe/, 'per-emitter authority records force safety');
assert.match(coreSource, /synthetic_fixture/, 'synthetic fixture authority is explicitly labeled');
assert.match(coreSource, /origin_world/, 'per-finger packet carries world origin');
assert.match(coreSource, /aim_world/, 'per-finger packet carries world aim');
assert.match(coreSource, /motion_world/, 'per-finger packet carries world motion');
assert.match(coreSource, /surface_flow/, 'particle state records surface-flow phase');
assert.match(coreSource, /visual_trail/, 'particle state records visual trail samples');
assert.match(coreSource, /source_anchor/, 'trail debug state separates source anchor from recent path');
assert.match(coreSource, /trailSampleCount/, 'debug state records trail sample coverage');
assert.match(coreSource, /surfaceStreakCount/, 'debug state records surface streak coverage');
assert.match(coreSource, /maxTrailSegmentLength/, 'debug state records maximum trail segment length');
assert.match(coreSource, /airborneBreadcrumbCount/, 'debug state records airborne breadcrumb coverage');
assert.match(coreSource, /impactRingCount/, 'debug state records impact/contact ring coverage');
assert.match(coreSource, /surfaceSmearCount/, 'debug state records phase-aware surface smear coverage');
assert.match(coreSource, /velocity_hint/, 'trail debug state carries velocity hints');
assert.match(coreSource, /lerm_impulse/, 'particle hit records lerm impulse events');
assert.match(coreSource, /goin_impulse/, 'particle hit records goin impulse events');
assert.match(coreSource, /terrain_frame/, 'debug state records terrain frame identity');
assert.match(coreSource, /FINGER_JUICE_SUPPORT_FRAME_SCHEMA\s*=\s*'big-papa-finger-juice\.support-frame\.v0'/, 'finger juice names its Hill-compatible support-frame schema');
assert.match(coreSource, /FINGER_JUICE_RESERVOIR_DIAGNOSTICS_SCHEMA\s*=\s*'big-papa-finger-juice\.substrate-reservoir-diagnostics\.v0'/, 'finger juice names substrate reservoir diagnostics');
assert.match(coreSource, /FINGER_JUICE_PREVIEW_BENCH_PAYLOAD_SCHEMA\s*=\s*'big-papa-finger-juice\.preview-bench-payload\.v0'/, 'finger juice names its source-owned Preview Bench payload schema');
assert.match(coreSource, /FINGER_JUICE_HOST_PACKET_SCHEMA\s*=\s*'big-papa-finger-juice\.host-packet\.v0'/, 'finger juice names its first-class host packet schema');
assert.match(coreSource, /FINGER_JUICE_HOST_PACKET_ROUTE\s*=\s*'big-papa\/finger-juice\/host-packet'/, 'finger juice names its first-class host packet route');
assert.match(coreSource, /FINGER_JUICE_HOST_RENDER_PAYLOAD_PREVIEW_SCHEMA\s*=\s*'big-papa-finger-juice\.render-payload\.preview\.v0'/, 'finger juice names its downgraded host render payload schema');
assert.match(coreSource, /HILL_OF_HILLS_PREVIEW_BENCH_PAYLOAD_SCHEMA\s*=\s*'lerms\.hill-of-hills\.preview-bench-payload\.v0'/, 'finger juice names the Hill of Hills Preview Bench payload schema it ingests');
assert.match(coreSource, /FINGER_JUICE_HILL_SUPPORT_FRAME_INGESTION_CONTRACT\s*=\s*'hill-preview-bench-support-frame-ingestion-v0'/, 'finger juice names its Hill support-frame ingestion contract');
assert.match(coreSource, /createFingerJuiceSupportFrame/, 'core creates a Hill-compatible support frame for reservoir state');
assert.match(coreSource, /normalizeHillSupportFramePayload/, 'core exports Hill support-frame payload normalization');
assert.match(coreSource, /createReservoirDomainDiagnostics/, 'core creates active-domain reservoir diagnostics in support coordinates');
assert.match(coreSource, /createFingerJuicePreviewBenchPayload/, 'core exports a source-owned Preview Bench payload wrapper');
assert.match(coreSource, /createFingerJuiceHostPacket/, 'core exports a first-class Kaminos host packet wrapper');
assert.match(coreSource, /supportFrameChecksum/, 'support-frame diagnostics expose checksum identity');
assert.match(coreSource, /fluid_collision_heightfield_still_local_procedural/, 'Hill support ingestion keeps collision downgrade explicit until raw samples are wired');
assert.match(coreSource, /activeReservoirDomains/, 'reservoir diagnostics expose active domains instead of only scalar metrics');
assert.match(coreSource, /host_visualization_not_source_truth/, 'Preview Bench payload downgrades host visuals explicitly');
assert.match(coreSource, /export function normalizeWorldFingerJuiceEmitterPacket/, 'core exports packet normalizer');
assert.match(coreSource, /export function createWorldFingerJuiceTransportPrototype/, 'core exports deterministic transport prototype');
assert.match(pageSource, /__lermsFingerJuiceHostPacket/, 'prototype page exposes the current host packet to Kaminos composition');
assert.match(hostPacketCliSource, /createFingerJuiceHostPacket/, 'host-packet CLI writes the source-owned host packet');

assert.match(webgpuCoreSource, /webgpu_particle_solver_v0/, 'WebGPU solver route identity is explicit');
assert.match(webgpuCoreSource, /wgsl-ballistic-heightfield-surface-v0/, 'WebGPU shader route identity is explicit');
assert.match(webgpuCoreSource, /webgpu_particle_splat_renderer_v0/, 'WebGPU render route identity is explicit');
assert.match(webgpuCoreSource, /wgsl-particle-splat-renderer-v0/, 'WebGPU render shader identity is explicit');
assert.match(webgpuCoreSource, /webgpu_emitter_buffer_v0/, 'WebGPU emitter buffer route identity is explicit');
assert.match(webgpuCoreSource, /wgsl-gpu-emitter-respawn-v0/, 'WebGPU respawn contract identity is explicit');
assert.match(webgpuCoreSource, /wgsl-local-density-pressure-v0/, 'WebGPU local-density pressure contract identity is explicit');
assert.match(webgpuCoreSource, /wgsl-spatial-cell-pressure-v0/, 'WebGPU spatial cell pressure contract identity is explicit');
assert.match(webgpuCoreSource, /wgsl-spatial-viscosity-pressure-v0/, 'WebGPU deeper fluid pressure/viscosity contract identity is explicit');
assert.match(webgpuCoreSource, /wgsl-same-chemistry-surface-cohesion-v0/, 'WebGPU solver names the same-chemistry surface cohesion contract');
assert.match(webgpuCoreSource, /wgsl-spatial-surface-relaxation-v0/, 'WebGPU solver names the spatial surface relaxation contract');
assert.match(webgpuCoreSource, /wgsl-stability-damped-relaxation-v0/, 'WebGPU solver names the stability damping contract');
assert.match(webgpuCoreSource, /wgsl-visual-streak-bead-damping-v0/, 'WebGPU solver names the visual streak/bead damping contract');
assert.match(webgpuCoreSource, /wgsl-density-position-solve-v0/, 'WebGPU solver names the density/position solve contract');
assert.match(webgpuCoreSource, /wgsl-particle-support-budget-v0/, 'WebGPU solver names the particle support/budget contract');
assert.match(webgpuCoreSource, /wgsl-density-continuity-projection-v0/, 'WebGPU solver names the density continuity projection contract');
assert.match(webgpuCoreSource, /wgsl-sampled-neighborhood-density-v0/, 'WebGPU solver names the sampled particle-neighborhood density contract');
assert.match(webgpuCoreSource, /wgsl-deep-density-continuity-projection-v0/, 'WebGPU solver names the deeper density continuity projection contract');
assert.match(webgpuCoreSource, /wgsl-local-pair-density-projection-v0/, 'WebGPU solver names the local same-chemistry pair density projection contract');
assert.match(webgpuCoreSource, /wgsl-neighbor-support-substrate-v0/, 'WebGPU solver names the GPU neighbor-support substrate contract');
assert.match(webgpuCoreSource, /wgsl-substrate-density-constraint-solve-v0/, 'WebGPU solver names the substrate-driven density constraint solve contract');
assert.match(webgpuCoreSource, /DEFAULT_PARTICLE_SUPPORT_BUDGET\s*=\s*36000/, 'WebGPU solver names the 36k support budget after 96k/48k witness evidence');
assert.match(webgpuCoreSource, /SPATIAL_PRESSURE_GRID_X\s*=\s*80/, 'WebGPU support grid has enough horizontal cells for 36k support smoke');
assert.match(webgpuCoreSource, /SPATIAL_PRESSURE_GRID_Z\s*=\s*120/, 'WebGPU support grid has enough forward cells for 36k support smoke');
assert.match(webgpuCoreSource, /MIN_PARTICLE_SUPPORT_SCALE\s*=\s*0\.26/, 'WebGPU support scale floor shrinks for 36k particle sampling');
assert.match(webgpuCoreSource, /lerms\.source-truth\.v0/, 'WebGPU route emits LERMS source-truth envelopes');
assert.match(webgpuCoreSource, /lerms\.juice-hit-event\.v0/, 'WebGPU route emits LERMS juice-hit events');
assert.match(webgpuCoreSource, /solver_backend/, 'WebGPU solver reports effective backend');
assert.match(webgpuCoreSource, /webgpu_compute/, 'WebGPU solver can report compute backend');
assert.match(webgpuCoreSource, /render_backend/, 'WebGPU solver reports effective render backend');
assert.match(webgpuCoreSource, /webgpu_direct_render/, 'WebGPU solver can report direct render backend');
assert.match(webgpuCoreSource, /webgpu_unavailable/, 'WebGPU solver can report unavailable backend');
assert.match(webgpuCoreSource, /GPUBufferUsage\.STORAGE/, 'WebGPU solver uses storage buffers');
assert.match(webgpuCoreSource, /GPUBufferUsage\.COPY_SRC/, 'WebGPU solver exposes readback from GPU-owned state');
assert.match(webgpuCoreSource, /createComputePipeline/, 'WebGPU solver advances through a compute pipeline');
assert.match(webgpuCoreSource, /createRenderPipeline/, 'WebGPU solver renders particles through a render pipeline');
assert.match(webgpuCoreSource, /GPUCanvasContext/, 'WebGPU renderer configures a canvas context');
assert.match(webgpuCoreSource, /createRenderer/, 'WebGPU solver exposes a direct renderer');
assert.match(webgpuCoreSource, /nonzero_webgpu_canvas_extent_v0/, 'WebGPU renderer names the nonzero canvas extent guard contract');
assert.match(webgpuCoreSource, /resolveNonzeroWebGPUCanvasExtent/, 'WebGPU renderer exposes a testable nonzero canvas extent resolver');
assert.match(webgpuCoreSource, /configureCanvasContextForExtent/, 'WebGPU renderer configures the canvas context with an explicit nonzero extent');
assert.match(webgpuCoreSource, /empty_canvas_extent_deferred_v0/, 'WebGPU renderer defers rendering instead of requesting a zero-size swapchain texture');
assert.match(webgpuCoreSource, /createWebGPUEmitterBufferData/, 'WebGPU solver serializes emitters into a GPU buffer');
assert.match(webgpuCoreSource, /@binding\(2\)\s+var<storage,\s*read>\s+emitters/, 'WebGPU solver shader reads a storage emitter buffer');
assert.match(webgpuCoreSource, /spawn_jitter_hash_v0/, 'WebGPU respawn path uses deterministic spawn jitter');
assert.match(webgpuCoreSource, /respawnCount/, 'WebGPU solver exposes particle respawn counts');
assert.match(webgpuCoreSource, /particlesPerEmitter/, 'WebGPU solver reports per-emitter active particle counts');
assert.match(webgpuCoreSource, /ringEmitterLateralDrift/, 'WebGPU solver attributes ring emitter lateral drift');
assert.match(webgpuCoreSource, /emitterBufferRoute/, 'WebGPU solver reports effective emitter buffer route');
assert.match(webgpuCoreSource, /applyLocalDensityPressure/, 'WebGPU solver applies a local-density pressure correction');
assert.match(webgpuCoreSource, /applySpatialCellPressure/, 'WebGPU solver applies spatial cell pressure correction');
assert.match(webgpuCoreSource, /applySurfaceViscosity/, 'WebGPU solver applies surface viscosity after pressure correction');
assert.match(webgpuCoreSource, /applySameChemistrySurfaceCohesion/, 'WebGPU solver applies same-chemistry cohesion to make surface flow ribbon together');
assert.match(webgpuCoreSource, /surfaceCohesionStats/, 'WebGPU solver reports surface cohesion diagnostics');
assert.match(webgpuCoreSource, /cohesionNeighborCount/, 'WebGPU cohesion diagnostics report same-chemistry neighbor counts');
assert.match(webgpuCoreSource, /ribbonAlignment/, 'WebGPU cohesion diagnostics report ribbon alignment');
assert.match(webgpuCoreSource, /applySpatialSurfaceRelaxation/, 'WebGPU solver applies spatial surface relaxation after cohesion');
assert.match(webgpuCoreSource, /applyDensityPositionSolve/, 'WebGPU solver applies an explicit density/position correction pass');
assert.match(webgpuCoreSource, /applyDensityContinuityProjection/, 'WebGPU solver applies a spatial density continuity projection pass');
assert.match(webgpuCoreSource, /applySampledNeighborhoodDensity/, 'WebGPU solver applies a sampled particle-neighborhood density pass');
assert.match(webgpuCoreSource, /applyDeepDensityContinuityProjection/, 'WebGPU solver applies a deeper multi-ring density continuity projection pass');
assert.match(webgpuCoreSource, /applyLocalPairDensityProjection/, 'WebGPU solver applies a local same-chemistry pair density projection pass');
assert.match(webgpuCoreSource, /applySurfaceStabilityDamping/, 'WebGPU solver damps high-density surface relaxation before the next density solve');
assert.match(webgpuCoreSource, /applyVisualStreakBeadDamping/, 'WebGPU solver damps visually obvious streaks and detached bead chains');
assert.match(webgpuCoreSource, /densityPositionSolveStats/, 'WebGPU solver reports density/position solve diagnostics');
assert.match(webgpuCoreSource, /densityContinuityProjectionStats/, 'WebGPU solver reports density continuity projection diagnostics');
assert.match(webgpuCoreSource, /continuityPeakOccupancyRatio/, 'continuity diagnostics report peak occupancy pressure');
assert.match(webgpuCoreSource, /continuityProjectionCandidateCount/, 'continuity diagnostics report projection candidate count');
assert.match(webgpuCoreSource, /CONTINUITY_BIN_REFRESH_CHUNK/, 'continuity solve refreshes spatial bins across long step batches');
assert.match(webgpuCoreSource, /sampledNeighborhoodDensityStats/, 'WebGPU solver reports sampled particle-neighborhood density diagnostics');
assert.match(webgpuCoreSource, /averageSampledNeighborCount/, 'sampled neighborhood diagnostics report average sampled neighbor support');
assert.match(webgpuCoreSource, /neighborhoodDensityCorrectionCandidateCount/, 'sampled neighborhood diagnostics report correction candidates');
assert.match(webgpuCoreSource, /deepDensityContinuityStats/, 'WebGPU solver reports deeper density continuity diagnostics');
assert.match(webgpuCoreSource, /deepContinuityProjectionCandidateCount/, 'deeper continuity diagnostics report correction candidates');
assert.match(webgpuCoreSource, /localPairDensityStats/, 'WebGPU solver reports local same-chemistry pair density diagnostics');
assert.match(webgpuCoreSource, /localPairProjectionCandidateCount/, 'local pair diagnostics report projection candidate count');
assert.match(webgpuCoreSource, /averageLocalPairNeighbors/, 'local pair diagnostics report average same-chemistry pair support');
assert.match(webgpuCoreSource, /neighborSupportSubstrateStats/, 'WebGPU solver reports GPU neighbor-support substrate diagnostics');
assert.match(webgpuCoreSource, /neighborSupportSubstrateMode/, 'neighbor-support diagnostics report the substrate construction mode');
assert.match(webgpuCoreSource, /averageSubstrateNeighborSupport/, 'neighbor-support diagnostics report average substrate support');
assert.match(webgpuCoreSource, /unsupportedSubstrateParticleCount/, 'neighbor-support diagnostics report unsupported particles from the substrate');
assert.match(webgpuCoreSource, /neighborSupportBuffer/, 'WebGPU solver owns a neighbor-support storage buffer');
assert.match(webgpuCoreSource, /applySubstrateDensityConstraintSolve/, 'WebGPU solver applies substrate-driven density constraint correction');
assert.match(webgpuCoreSource, /substrateDensityConstraintStats/, 'WebGPU solver reports substrate density constraint diagnostics');
assert.match(webgpuCoreSource, /substrateConstraintCandidateCount/, 'substrate density diagnostics report candidate counts');
assert.match(webgpuCoreSource, /averageSubstrateConstraintError/, 'substrate density diagnostics report average constraint error');
assert.match(webgpuCoreSource, /unsupportedSubstrateConstraintRatio/, 'substrate density diagnostics report unsupported constraint ratio');
assert.match(webgpuCoreSource, /wgsl-iterative-density-continuity-projection-v0/, 'WebGPU solver names the iterative density continuity contract');
assert.match(webgpuCoreSource, /applyIterativeDensityContinuityProjection/, 'WebGPU solver applies an iterative density continuity projection pass');
assert.match(webgpuCoreSource, /iterativeDensityContinuityStats/, 'WebGPU solver reports iterative density continuity diagnostics');
assert.match(webgpuCoreSource, /iterativeDensityContinuityIterationCount/, 'iterative density diagnostics report iteration count');
assert.match(webgpuCoreSource, /averageIterativeDensityResidual/, 'iterative density diagnostics report average residual');
assert.match(webgpuCoreSource, /iterativeDensityConvergenceRatio/, 'iterative density diagnostics report convergence ratio');
assert.match(webgpuCoreSource, /iterativeDensityClampCount/, 'iterative density diagnostics report clamped corrections');
assert.match(webgpuCoreSource, /particleSupportBudgetStats/, 'WebGPU solver reports particle support budget diagnostics');
assert.match(webgpuCoreSource, /spatial_cell_radius_support_v0/, 'support diagnostics measure physical spatial-cell radius support');
assert.match(webgpuCoreSource, /supportFrame/, 'WebGPU summaries expose support-frame identity');
assert.match(webgpuCoreSource, /setHillSupportFramePayload/, 'WebGPU solver accepts live Hill support-frame payload updates after startup');
assert.match(webgpuCoreSource, /hillSupportFramePayload/, 'WebGPU summaries route Hill support-frame payload identity into readback diagnostics');
assert.match(webgpuCoreSource, /substrateReservoirDiagnostics/, 'WebGPU summaries expose substrate reservoir diagnostics');
assert.match(webgpuCoreSource, /activeReservoirDomains/, 'WebGPU summaries expose active reservoir domains');
assert.match(webgpuCoreSource, /supportFrameChecksum/, 'WebGPU support diagnostics preserve checksum identity');
assert.match(webgpuCoreSource, /settleRestEnergyStats/, 'WebGPU solver reports settle/rest energy diagnostics');
assert.match(webgpuCoreSource, /@binding\(5\)\s+var<storage,\s*read>\s+terrainSamples/, 'WebGPU compute shader reads source terrain samples from a GPU storage buffer');
assert.match(webgpuCoreSource, /source_height_samples_gpu_storage_v0/, 'WebGPU solver names source terrain sample GPU collision mode');
assert.match(webgpuCoreSource, /terrainSampleGpuCollisionMode/, 'WebGPU summaries report whether live collision is source-sample-backed on GPU');
assert.match(webgpuCoreSource, /uploadTerrainSampleSurface/, 'WebGPU solver can upload live Hill terrain samples after startup');
assert.match(webgpuCoreSource, /averageSupportNeighborCount/, 'support diagnostics report average neighbor support');
assert.match(webgpuCoreSource, /unsupportedCorrectionRatio/, 'support diagnostics report unsupported correction ratio');
assert.match(webgpuCoreSource, /p95SettledSurfaceSpeed/, 'rest diagnostics report p95 settled surface speed');
assert.match(webgpuCoreSource, /particle_budget_render_scale_v0/, 'renderer scales splats for the higher particle budget without hiding route identity');
assert.match(webgpuCoreSource, /correctionCandidateCount/, 'density solve diagnostics report particles eligible for correction');
assert.match(webgpuCoreSource, /averageConstraintError/, 'density solve diagnostics report average density constraint error');
assert.match(webgpuCoreSource, /maxConstraintError/, 'density solve diagnostics report maximum density constraint error');
assert.match(webgpuCoreSource, /spatialSurfaceRelaxationStats/, 'WebGPU solver reports spatial surface relaxation diagnostics');
assert.match(webgpuCoreSource, /relaxedParticleCount/, 'WebGPU relaxation diagnostics report affected particle counts');
assert.match(webgpuCoreSource, /sheetConnectedParticleCount/, 'WebGPU relaxation diagnostics report particles connected to occupied neighbor cells');
assert.match(webgpuCoreSource, /sheetContinuityRatio/, 'WebGPU relaxation diagnostics report sheet continuity across occupied cells');
assert.match(webgpuCoreSource, /stabilityStats/, 'WebGPU solver reports stability diagnostics before stronger density solving');
assert.match(webgpuCoreSource, /highSpeedParticleCount/, 'WebGPU stability diagnostics report high-speed outliers');
assert.match(webgpuCoreSource, /denseCellSaturation/, 'WebGPU stability diagnostics report dense cell saturation');
assert.match(webgpuCoreSource, /visualStreakBeadStats/, 'WebGPU solver reports visual streak/bead damping diagnostics');
assert.match(webgpuCoreSource, /detachedBeadParticleCount/, 'WebGPU visual damping diagnostics report detached bead particle counts');
assert.match(webgpuCoreSource, /fluidDepthStats/, 'WebGPU solver reports deeper fluid diagnostics');
assert.match(webgpuCoreSource, /spatialPressureIterations/, 'WebGPU deeper fluid diagnostics report pressure iteration count');
assert.match(webgpuCoreSource, /viscosityAffectedCount/, 'WebGPU deeper fluid diagnostics report viscosity affected particles');
assert.match(webgpuCoreSource, /pressureBins/, 'WebGPU solver owns a pressure bin buffer');
assert.match(webgpuCoreSource, /clear_pressure_bins/, 'WebGPU solver clears pressure bins before accumulation');
assert.match(webgpuCoreSource, /accumulate_pressure_bins/, 'WebGPU solver accumulates surface particles into pressure bins');
assert.match(webgpuCoreSource, /spatialPressureStats/, 'WebGPU solver reports spatial pressure diagnostics');
assert.match(webgpuCoreSource, /occupiedCellCount/, 'WebGPU spatial diagnostics report occupied cells');
assert.match(webgpuCoreSource, /pressureNeighborWindow/, 'WebGPU solver reports bounded pressure neighbor scope');
assert.match(webgpuCoreSource, /pressureDensityStats/, 'WebGPU solver reports pressure/density diagnostics');
assert.match(webgpuCoreSource, /createLermsSourceTruth/, 'WebGPU summaries preserve LERMS source truth');
assert.match(webgpuCoreSource, /juiceHitEvents/, 'WebGPU summaries expose LERMS-compatible juice hit events');
assert.match(webgpuCoreSource, /sourceDiagnostics/, 'WebGPU summaries expose source diagnostics');
assert.match(webgpuCoreSource, /emitterDiagnostics/, 'WebGPU summaries expose live emitter diagnostics');
assert.match(webgpuCoreSource, /@compute\s+@workgroup_size/, 'WebGPU solver shader contains compute entry point');
assert.match(webgpuCoreSource, /runCpuFingerJuiceOracle/, 'WebGPU route keeps CPU oracle comparison');
assert.match(webgpuCoreSource, /cpuOracleMode/, 'WebGPU readback reports whether CPU oracle ran or was skipped');
assert.match(webgpuCoreSource, /skip_cpu_oracle_live_readback_v0/, 'WebGPU readback can skip CPU oracle for live debug sampling');
assert.match(webgpuCoreSource, /live_lightweight_readback_v0/, 'WebGPU readback supports a lightweight live summary that avoids expensive diagnostics');
assert.match(webgpuCoreSource, /adapterInfo/, 'WebGPU route records adapter identity');

assert.match(pageSource, /lerms_world_finger_juice=1/, 'prototype page declares its smoke route query');
assert.match(pageSource, /window\.__lermsFingerJuiceDebug/, 'prototype exposes route debug state for witnesses');
assert.match(pageSource, /window\.__lermsFingerJuiceStepForWitness/, 'prototype exposes deterministic witness stepping');
assert.match(pageSource, /createWebGPUFingerJuiceSolver/, 'prototype integrates WebGPU finger-juice solver');
assert.match(pageSource, /juice-gpu-layer/, 'prototype includes a WebGPU juice overlay canvas');
assert.match(pageSource, /nonzero_webgpu_canvas_extent_v0/, 'prototype names its nonzero WebGPU canvas extent contract');
assert.match(pageSource, /measureViewportExtent/, 'prototype measures a nonzero viewport extent before resizing render canvases');
assert.match(pageSource, /webgpu_particle_solver_v0/, 'prototype displays WebGPU solver route identity');
assert.match(pageSource, /webgpu_particle_splat_renderer_v0/, 'prototype displays WebGPU render route identity');
assert.match(pageSource, /particleSupportBudget\s*=\s*36000/, 'prototype uses the 36k particle support budget');
assert.match(pageSource, /live_readback_decoupled_v0/, 'prototype names the live readback decoupling contract');
assert.match(pageSource, /summaryMode:\s*'live_lightweight_readback_v0'/, 'prototype uses lightweight summaries for live animation readbacks');
assert.match(pageSource, /liveReadbackSkippedCount/, 'prototype records skipped live debug readbacks instead of blocking frames');
assert.match(pageSource, /cpuOracle:\s*false/, 'prototype disables CPU oracle during live animation readbacks');
assert.match(pageSource, /webgpuMaxFrameSteps\s*=\s*8/, 'prototype caps per-frame WebGPU catch-up work for high particle budgets');
assert.match(pageSource, /dropped_catchup_steps_total/, 'prototype exposes dropped catch-up steps instead of silently hitching');
assert.match(pageSource, /sourceDiagnostics/, 'prototype displays source diagnostics');
assert.match(pageSource, /emitterDiagnostics/, 'prototype displays live emitter diagnostics');
assert.match(pageSource, /pressureDensityStats/, 'prototype displays pressure density diagnostics');
assert.match(pageSource, /spatialPressureStats/, 'prototype displays spatial pressure diagnostics');
assert.match(pageSource, /fluidDepthStats/, 'prototype displays deeper fluid diagnostics');
assert.match(pageSource, /surfaceCohesionStats/, 'prototype displays surface cohesion diagnostics');
assert.match(pageSource, /spatialSurfaceRelaxationStats/, 'prototype displays spatial surface relaxation diagnostics');
assert.match(pageSource, /densityPositionSolveStats/, 'prototype displays density/position solve diagnostics');
assert.match(pageSource, /densityContinuityProjectionStats/, 'prototype displays density continuity projection diagnostics');
assert.match(pageSource, /sampledNeighborhoodDensityStats/, 'prototype displays sampled particle-neighborhood density diagnostics');
assert.match(pageSource, /localPairDensityStats/, 'prototype displays local pair density projection diagnostics');
assert.match(pageSource, /neighborSupportSubstrateStats/, 'prototype displays neighbor-support substrate diagnostics');
assert.match(pageSource, /substrateDensityConstraintStats/, 'prototype displays substrate density constraint diagnostics');
assert.match(pageSource, /iterativeDensityContinuityStats/, 'prototype displays iterative density continuity diagnostics');
assert.match(pageSource, /particleSupportBudgetStats/, 'prototype displays support budget diagnostics');
assert.match(pageSource, /settleRestEnergyStats/, 'prototype displays settle/rest energy diagnostics');
assert.match(pageSource, /visualStreakBeadStats/, 'prototype displays visual streak/bead damping diagnostics');
assert.match(pageSource, /drawReservoirDomains/, 'prototype visibly draws active support/reservoir domains, not only sidebar metrics');
assert.match(pageSource, /support-domain-renderer-v0/, 'prototype names the support-domain visual renderer contract');
assert.match(pageSource, /__lermsFingerJuicePreviewBenchPayload/, 'prototype exposes source-owned Preview Bench payload evidence');
assert.match(pageSource, /supportFrameChecksum/, 'prototype HUD/witness state exposes support-frame checksum');
assert.match(pageSource, /hill_support_payload_root/, 'prototype accepts a Hill support payload file root for live support-frame ingestion');
assert.match(pageSource, /hillSupportFramePayloadStatus/, 'prototype exposes Hill support payload load status to witnesses and HUD');
assert.match(pageSource, /normalizeHillTerrainSamplePacket/, 'prototype normalizes source-owned Hill terrain sample packets for collision ingestion');
assert.match(pageSource, /terrain_sample_packet_root/, 'prototype accepts a Hill terrain sample packet file root for live height-sample ingestion');
assert.match(pageSource, /terrain_sample_data_root/, 'prototype accepts a Hill terrain sample data file root when the packet transport must be overridden');
assert.match(pageSource, /setTerrainSampleSurface/, 'prototype pushes decoded Hill terrain samples into the solver/prototype surface path');
assert.match(pageSource, /source_height_samples_v0/, 'prototype exposes source height-sample coupling instead of hiding behind local procedural terrain');
assert.match(pageSource, /terrainSampleStatus/, 'prototype exposes terrain sample load status to witnesses and HUD');
assert.match(pageSource, /__lermsFingerJuiceStressForWitness/, 'prototype exposes an expanded witness stress phase hook');
assert.match(pageSource, /__lermsFingerJuiceFreezeForWitness/, 'prototype exposes a frozen capture hook so screenshot and state cannot drift');
assert.match(pageSource, /witness-frozen-state-capture-v0/, 'prototype names the frozen witness capture contract');
assert.match(pageSource, /__lermsFingerJuiceVisualFrameForWitness/, 'prototype exposes a focused visual frame for witness capture');
assert.match(pageSource, /visualActivityFrame/, 'prototype computes projected activity framing for witness capture');
assert.match(pageSource, /dense-fluid-activity-clip-v0/, 'prototype can focus witness capture on dense fluid activity instead of sparse outliers');
assert.match(pageSource, /responsiveSmokeProjection/, 'prototype uses viewport-responsive smoke projection instead of fixed-pixel scale');
assert.match(pageSource, /orbit-perspective-camera-projection-v1/, 'prototype names the corrected orbit projection contract');
assert.match(pageSource, /orbit-camera-controls-v0/, 'prototype exposes operator orbit camera controls');
assert.match(pageSource, /fingerJuiceCamera/, 'prototype keeps an explicit mutable orbit camera state');
assert.match(pageSource, /source-terrain-sample-mesh-overlay-v0/, 'prototype visibly distinguishes source Hill terrain samples from the older local terrain backdrop');
assert.match(pageSource, /operator-expanded-flow-v0/, 'prototype automatically expands operator flow after the initial small smoke');
assert.match(pageSource, /pointerdown/, 'prototype lets the operator drag to orbit the camera');
assert.match(pageSource, /cameraPan/, 'prototype keeps explicit camera pan state');
assert.match(pageSource, /panCamera/, 'prototype lets the operator pan the camera target');
assert.match(pageSource, /shiftKey/, 'prototype supports modifier drag for camera pan');
assert.match(pageSource, /zoom\s*=\s*Math\.max\(0\.28/, 'prototype permits enough zoom-out for whole-field inspection');
assert.match(pageSource, /wheel/, 'prototype lets the operator zoom the orbit camera');
assert.match(pageSource, /__lermsFingerJuiceCameraForWitness/, 'prototype exposes camera state for witness/debug inspection');
assert.match(webgpuCoreSource, /orbitCameraYaw/, 'WebGPU renderer accepts orbit camera yaw');
assert.match(webgpuCoreSource, /orbitCameraPitch/, 'WebGPU renderer accepts orbit camera pitch');
assert.match(webgpuCoreSource, /orbitCameraZoom/, 'WebGPU renderer accepts orbit camera zoom');
assert.match(webgpuCoreSource, /orbitCameraPan/, 'WebGPU renderer accepts orbit camera pan');
assert.match(webgpuCoreSource, /orbit-perspective-camera-projection-v1/, 'WebGPU renderer uses the same corrected orbit projection contract as CPU overlays');
assert.match(pageSource, /expanded-flow-stress-v0/, 'prototype names the expanded stress emitter config');
assert.match(pageSource, /juiceHitEvents/, 'prototype exposes LERMS juice-hit events in debug state');
assert.match(pageSource, /world-space-ballistic-surface-flow-particles-v0/, 'prototype page displays effective route identity');
assert.match(pageSource, /hill-of-hills-heightfield-collision-v0/, 'prototype page displays terrain contract');
assert.match(pageSource, /drawJuiceTrails/, 'prototype page draws persistent juice trails');
assert.match(pageSource, /source-legible-phase-breadcrumbs-v2/, 'prototype page labels the phase-aware breadcrumb renderer');
assert.match(pageSource, /drawAirborneBreadcrumb/, 'prototype page draws airborne breadcrumb ticks');
assert.match(pageSource, /drawImpactRing/, 'prototype page draws contact/impact rings');
assert.match(pageSource, /drawSurfaceSmear/, 'prototype page draws surface-flow smears');
assert.doesNotMatch(pageSource, /globalCompositeOperation\s*=\s*['"]lighter['"]/, 'trail renderer must not use additive lighter compositing');

assert.match(indexSource, /data-tab="finger-juice"/, 'Kaminos sidebar exposes a Finger Juice primitive tab');
assert.match(indexSource, /id="tab-finger-juice"/, 'Kaminos app shell contains Finger Juice tab content');
assert.match(indexSource, /kaminos_lerms_finger_juice=1/, 'Kaminos route can open directly into the Finger Juice primitive tab');
assert.match(indexSource, /id="finger-juice-viewport-frame"/, 'Finger Juice tab embeds the existing smoke route in an inspectable viewport frame');
assert.match(indexSource, /lerms-finger-juice\.html\?lerms_world_finger_juice=1/, 'Finger Juice tab embeds the source-honest standalone smoke route instead of duplicating solver code');
assert.match(indexSource, /preview_bench_payload_root/, 'Kaminos Preview Bench supports generic source payload file roots');
assert.match(indexSource, /preview_bench_payload_path/, 'Kaminos Preview Bench supports generic source payload file paths');
assert.match(indexSource, /kaminos\.preview-bench\.payload-state\.v0/, 'Kaminos Preview Bench preserves source payload state identity');
assert.match(previewBenchDocsSource, /kaminos\.preview-bench\.payload-report\.v0/, 'Preview Bench docs define the generic payload report envelope');
assert.match(previewBenchDocsSource, /preview_bench_payload_root/, 'Preview Bench docs name generic root/path route params');
assert.match(indexSource, /kaminos-finger-juice-tab-embed-v0/, 'Finger Juice tab names its Kaminos embed route identity');
assert.match(indexSource, /window\.kaminosFingerJuiceTabDebugState/, 'Kaminos exposes Finger Juice tab state for browser witnesses');
assert.match(indexSource, /fingerJuiceFrame\.contentWindow\.__lermsFingerJuiceDebug/, 'Kaminos tab reads child smoke debug state through a same-origin debug bridge');
assert.match(indexSource, /finger-juice-source-authority/, 'Finger Juice tab surfaces synthetic_fixture\/live authority instead of hiding source truth in the child frame');
assert.match(indexSource, /finger-juice-open-direct/, 'Finger Juice tab keeps a direct smoke link for isolated solver witnessing');

assert.match(witnessSource, /lerms_world_finger_juice=1/, 'witness captures the explicit LERMS finger-juice route');
assert.match(witnessSource, /effectiveRoute/, 'witness records effective route identity');
assert.match(witnessSource, /__lermsFingerJuiceStepForWitness/, 'witness advances simulation through explicit route hook');
assert.match(witnessSource, /solver_backend/, 'witness records effective solver backend');
assert.match(witnessSource, /webgpu_compute/, 'witness requires WebGPU compute backend');
assert.match(witnessSource, /webgpu_particle_solver_v0/, 'witness records WebGPU solver route');
assert.match(witnessSource, /webgpu_direct_render/, 'witness requires direct WebGPU render backend');
assert.match(witnessSource, /webgpu_particle_splat_renderer_v0/, 'witness records WebGPU render route');
assert.match(witnessSource, /webgpu_emitter_buffer_v0/, 'witness records WebGPU emitter buffer route');
assert.match(witnessSource, /wgsl-gpu-emitter-respawn-v0/, 'witness records GPU respawn contract');
assert.match(witnessSource, /wgsl-local-density-pressure-v0/, 'witness records local-density pressure contract');
assert.match(witnessSource, /wgsl-spatial-cell-pressure-v0/, 'witness records spatial cell pressure contract');
assert.match(witnessSource, /wgsl-spatial-viscosity-pressure-v0/, 'witness records deeper fluid pressure/viscosity contract');
assert.match(witnessSource, /lerms\.juice-hit-event\.v0/, 'witness records LERMS juice-hit-event schema');
assert.match(witnessSource, /readbackCadence/, 'witness records throttled readback cadence');
assert.match(witnessSource, /framePacingProbe/, 'witness records requestAnimationFrame pacing over live smoke');
assert.match(witnessSource, /framePacingMs/, 'witness accepts a configurable long frame pacing probe duration');
assert.match(witnessSource, /cdpRequestTimeoutMs/, 'witness CDP timeout scales with the configured frame pacing duration');
assert.match(witnessSource, /maxFrameGapMs/, 'witness reports maximum live frame gap');
assert.match(witnessSource, /p95FrameGapMs/, 'witness reports p95 live frame gap');
assert.match(witnessSource, /readbackHitchEvents/, 'witness correlates frame hitches with live readback activity');
assert.match(witnessSource, /live_readback_decoupled_v0/, 'witness requires live readback decoupling identity');
assert.match(witnessSource, /last_live_readback_summary_mode/, 'witness records the effective live readback summary mode');
assert.match(witnessSource, /adapterInfo/, 'witness records WebGPU adapter identity');
assert.match(witnessSource, /cpuOracle/, 'witness records CPU oracle comparison');
assert.match(witnessSource, /respawnProbeSteps/, 'witness forces a bounded respawn probe');
assert.match(witnessSource, /gpuRespawnCount/, 'witness requires GPU respawn evidence');
assert.match(witnessSource, /particlesPerEmitter/, 'witness records per-emitter particle counts');
assert.match(witnessSource, /ringEmitterLateralDrift/, 'witness records ring emitter lateral drift attribution');
assert.match(witnessSource, /pressureDensityStats/, 'witness requires pressure/density diagnostics');
assert.match(witnessSource, /spatialPressureStats/, 'witness requires spatial pressure diagnostics');
assert.match(witnessSource, /occupiedCellCount/, 'witness requires occupied spatial pressure cells');
assert.match(witnessSource, /fluidDepthStats/, 'witness requires deeper fluid diagnostics');
assert.match(witnessSource, /surfaceCohesionStats/, 'witness requires surface cohesion/ribbon diagnostics');
assert.match(witnessSource, /cohesionNeighborCount/, 'witness checks same-chemistry cohesion neighbor coverage');
assert.match(witnessSource, /ribbonAlignment/, 'witness checks directional ribbon alignment');
assert.match(witnessSource, /spatialSurfaceRelaxationStats/, 'witness requires spatial surface relaxation diagnostics');
assert.match(witnessSource, /relaxedParticleCount/, 'witness checks relaxation affected particle coverage');
assert.match(witnessSource, /sheetContinuityRatio/, 'witness checks spatial sheet continuity');
assert.match(witnessSource, /densityPositionSolveStats/, 'witness requires density/position solve diagnostics');
assert.match(witnessSource, /wgsl-density-position-solve-v0/, 'witness records density/position solve contract');
assert.match(witnessSource, /densityContinuityProjectionStats/, 'witness requires density continuity projection diagnostics');
assert.match(witnessSource, /wgsl-density-continuity-projection-v0/, 'witness records density continuity projection contract');
assert.match(witnessSource, /continuityPeakOccupancyRatio/, 'witness records continuity peak occupancy ratio');
assert.match(witnessSource, /continuityProjectionCandidateCount/, 'witness records continuity projection candidate count');
assert.match(witnessSource, /sampledNeighborhoodDensityStats/, 'witness requires sampled particle-neighborhood density diagnostics');
assert.match(witnessSource, /wgsl-sampled-neighborhood-density-v0/, 'witness records sampled particle-neighborhood density contract');
assert.match(witnessSource, /averageSampledNeighborCount/, 'witness records sampled neighborhood density support');
assert.match(witnessSource, /wgsl-deep-density-continuity-projection-v0/, 'witness records deeper density continuity projection contract');
assert.match(witnessSource, /deepDensityContinuityStats/, 'witness requires deeper density continuity diagnostics');
assert.match(witnessSource, /wgsl-local-pair-density-projection-v0/, 'witness records local pair density projection contract');
assert.match(witnessSource, /localPairDensityStats/, 'witness requires local pair density projection diagnostics');
assert.match(witnessSource, /averageLocalPairNeighbors/, 'witness records local same-chemistry pair support');
assert.match(witnessSource, /wgsl-neighbor-support-substrate-v0/, 'witness records neighbor-support substrate contract');
assert.match(witnessSource, /neighborSupportSubstrateStats/, 'witness requires neighbor-support substrate diagnostics');
assert.match(witnessSource, /averageSubstrateNeighborSupport/, 'witness records average GPU substrate support');
assert.match(witnessSource, /unsupportedSubstrateParticleCount/, 'witness records unsupported substrate particle counts');
assert.match(witnessSource, /wgsl-substrate-density-constraint-solve-v0/, 'witness records substrate density constraint solve contract');
assert.match(witnessSource, /substrateDensityConstraintStats/, 'witness requires substrate density constraint diagnostics');
assert.match(witnessSource, /substrateConstraintCandidateCount/, 'witness records substrate density constraint candidates');
assert.match(witnessSource, /averageSubstrateConstraintError/, 'witness records substrate density constraint error');
assert.match(witnessSource, /wgsl-iterative-density-continuity-projection-v0/, 'witness records iterative density continuity contract');
assert.match(witnessSource, /iterativeDensityContinuityStats/, 'witness requires iterative density continuity diagnostics');
assert.match(witnessSource, /iterativeDensityContinuityCandidateCount/, 'witness records iterative density continuity candidates');
assert.match(witnessSource, /averageIterativeDensityResidual/, 'witness records iterative density continuity residual');
assert.match(witnessSource, /iterativeDensityConvergenceRatio/, 'witness records iterative density convergence ratio');
assert.match(witnessSource, /wgsl-particle-support-budget-v0/, 'witness records particle support budget contract');
assert.match(witnessSource, /particleBudget\s*>=\s*36000/, 'witness requires the 36k particle support budget');
assert.match(witnessSource, /supportGridCellCount\s*>=\s*9600/, 'witness requires the finer 80x120 support grid');
assert.match(witnessSource, /particleSupportBudgetStats/, 'witness requires support budget diagnostics');
assert.match(witnessSource, /settleRestEnergyStats/, 'witness requires settle/rest energy diagnostics');
assert.match(witnessSource, /averageSupportNeighborCount/, 'witness records average support neighbor count');
assert.match(witnessSource, /unsupportedCorrectionRatio/, 'witness records unsupported correction ratio');
assert.match(witnessSource, /p95SettledSurfaceSpeed/, 'witness records p95 settled surface speed');
assert.match(witnessSource, /correctionCandidateCount/, 'witness checks density correction coverage');
assert.match(witnessSource, /averageConstraintError/, 'witness records average density constraint error');
assert.match(witnessSource, /maxConstraintError/, 'witness records maximum density constraint error');
assert.match(witnessSource, /stabilityStats/, 'witness requires solver stability diagnostics');
assert.match(witnessSource, /stabilityGrowthStats/, 'witness records long-run growth diagnostics');
assert.match(witnessSource, /visualFailureMetrics/, 'witness records visual streak and bead-chain failure metrics');
assert.match(witnessSource, /longThinComponentCount/, 'witness detects long thin colored streak components');
assert.match(witnessSource, /elongatedBandCount/, 'witness detects thick elongated colored rail components');
assert.match(witnessSource, /sourceTerrainBroadSheetVisualMode/, 'witness allows source-terrain broad fluid sheets only under source-backed GPU terrain collision');
assert.match(witnessSource, /sourceTerrainFullViewportLegible/, 'witness allows source-terrain full viewport sparsity only with dense-crop proof');
assert.match(witnessSource, /detachedBeadChainCount/, 'witness detects detached bead-chain components');
assert.match(witnessSource, /visual-attractor-failure-v0/, 'witness labels visual-attractor failure diagnostics');
assert.match(witnessSource, /captureStateConsistency/, 'witness records screenshot/state consistency diagnostics');
assert.match(witnessSource, /witness-frozen-state-capture-v0/, 'witness freezes route state before full viewport capture');
assert.match(witnessSource, /runawayStreakScore/, 'witness records runaway streak risk from visual spread versus filled activity');
assert.match(witnessSource, /extendedFlowProbe/, 'witness records the expanded long-flow probe');
assert.match(witnessSource, /expanded-flow-stress-v0/, 'witness requires stress phase route/config identity');
assert.match(witnessSource, /extendedFlowSteps/, 'witness records the requested extended stress duration');
assert.match(witnessSource, /flowExtentX/, 'witness checks widened horizontal fluid extent');
assert.match(witnessSource, /flowExtentZ/, 'witness checks widened forward fluid extent');
assert.match(witnessSource, /visualActivityMetrics/, 'witness records captured pixel activity metrics');
assert.match(witnessSource, /parsePngRgba/, 'witness parses PNG screenshots for visual activity metrics');
assert.match(witnessSource, /activityBoundsAreaRatio/, 'witness rejects visually tiny activity bounding boxes');
assert.match(witnessSource, /filledActivityRatio/, 'witness rejects mostly empty captures even when sparse activity bounds are large');
assert.match(witnessSource, /dilatedActivityRatio/, 'witness measures visual activity occupancy after local dilation, not just raw colored pixels');
assert.match(witnessSource, /fullViewportVisualActivityMetrics/, 'witness records the full operator viewport as primary smoke evidence');
assert.match(witnessSource, /denseDiagnosticScreenshot/, 'witness labels the dense crop as a secondary diagnostic artifact');
assert.match(witnessSource, /diagnostic_crop_secondary/, 'witness must not present the dense crop as the full smoke viewport');
assert.match(witnessSource, /largeViewportSmokeWitness/, 'witness exercises a large operator-scale viewport, not only a tiny headless viewport');
assert.match(witnessSource, /Emulation\.setDeviceMetricsOverride/, 'witness sets explicit viewport dimensions before judging full-screen legibility');
assert.match(witnessSource, /Page\.captureScreenshot[^]*clip/, 'witness captures a focused clip instead of only the whole distant viewport');
assert.match(witnessSource, /sourceDiagnostics/, 'witness requires source diagnostics');
assert.match(witnessSource, /emitterDiagnostics/, 'witness requires emitter diagnostics');
assert.match(witnessSource, /juiceHitEvents/, 'witness requires LERMS juice-hit events');
assert.match(witnessSource, /world-space-ballistic-surface-flow-particles-v0/, 'witness requires the world-space transport route');
assert.match(witnessSource, /trailSampleCount/, 'witness requires trail sample evidence');
assert.match(witnessSource, /trailEmitterCount/, 'witness requires multi-emitter trail evidence');
assert.match(witnessSource, /maxTrailSegmentLength/, 'witness rejects false long trail bridges');
assert.match(witnessSource, /airborneBreadcrumbCount/, 'witness requires airborne breadcrumb evidence');
assert.match(witnessSource, /impactRingCount/, 'witness requires impact/contact ring evidence');
assert.match(witnessSource, /surfaceSmearCount/, 'witness requires surface smear evidence');
assert.match(witnessSource, /primary_output_written/, 'witness records primary output durability');
assert.match(witnessSource, /failure_phase/, 'witness records failure phase before throwing');
assert.match(tabWitnessSource, /kaminos_lerms_finger_juice=1/, 'Kaminos tab witness opens the app-level Finger Juice route');
assert.match(tabWitnessSource, /kaminosFingerJuiceTabDebugState/, 'Kaminos tab witness reads the app-level debug bridge');
assert.match(tabWitnessSource, /kaminos-finger-juice-tab-embed-v0/, 'Kaminos tab witness requires the tab embed route identity');
assert.match(tabWitnessSource, /fullViewportActivityMetrics/, 'Kaminos tab witness records full-viewport activity metrics');
assert.match(tabWitnessSource, /blank frame/i, 'Kaminos tab witness fails loudly on blank visual output');
assert.match(tabWitnessSource, /childReady/, 'Kaminos tab witness refuses to pass before the child smoke route is live');
assert.match(tabWitnessSource, /failure_phase:\s*null/, 'Kaminos tab witness clears failure_phase in successful reports');

const mod = await import(corePath);
const webgpuMod = await import(webgpuCorePath);

function encodeF32(values) {
  return Buffer.from(new Float32Array(values).buffer).toString('base64');
}
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA, 'lerms.world-finger-juice-emitters.v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ROUTE, 'world-space-ballistic-surface-flow-particles-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT, 'hill-of-hills-heightfield-collision-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT, 'finger-aim-ballistic-arc-range-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE, 'webgpu_particle_solver_v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE, 'wgsl-ballistic-heightfield-surface-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE, 'webgpu_particle_splat_renderer_v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE, 'wgsl-particle-splat-renderer-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_CANVAS_EXTENT_CONTRACT, 'nonzero_webgpu_canvas_extent_v0');
assert.equal(
  webgpuMod.resolveNonzeroWebGPUCanvasExtent(
    { width: 0, height: 0, clientWidth: 0, clientHeight: 0, getBoundingClientRect: () => ({ width: 0, height: 0 }) },
    { width: 0, height: 0, pixelRatio: 2 },
  ),
  null,
  'zero CSS and drawing-buffer extents are rejected before getCurrentTexture',
);
assert.deepEqual(
  webgpuMod.resolveNonzeroWebGPUCanvasExtent(
    { width: 0, height: 0, clientWidth: 640, clientHeight: 360, getBoundingClientRect: () => ({ width: 0, height: 0 }) },
    { width: 0, height: 0, pixelRatio: 2 },
  ),
  {
    extentContract: 'nonzero_webgpu_canvas_extent_v0',
    cssWidth: 640,
    cssHeight: 360,
    ratio: 2,
    targetWidth: 1280,
    targetHeight: 720,
  },
  'client extents produce a nonzero WebGPU drawing buffer',
);
assert.deepEqual(
  webgpuMod.resolveNonzeroWebGPUCanvasExtent(
    { width: 1280, height: 720, clientWidth: 0, clientHeight: 0, getBoundingClientRect: () => ({ width: 0, height: 0 }) },
    { width: 0, height: 0, pixelRatio: 2 },
  ),
  {
    extentContract: 'nonzero_webgpu_canvas_extent_v0',
    cssWidth: 640,
    cssHeight: 360,
    ratio: 2,
    targetWidth: 1280,
    targetHeight: 720,
  },
  'existing drawing-buffer extents can recover a transient zero client extent',
);
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE, 'webgpu_emitter_buffer_v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT, 'wgsl-gpu-emitter-respawn-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT, 'wgsl-local-density-pressure-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT, 'wgsl-spatial-cell-pressure-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT, 'wgsl-spatial-viscosity-pressure-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SURFACE_COHESION_CONTRACT, 'wgsl-same-chemistry-surface-cohesion-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SURFACE_RELAXATION_CONTRACT, 'wgsl-spatial-surface-relaxation-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_STABILITY_CONTRACT, 'wgsl-stability-damped-relaxation-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT, 'wgsl-visual-streak-bead-damping-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_LOCAL_PAIR_DENSITY_CONTRACT, 'wgsl-local-pair-density-projection-v0');
assert.equal(webgpuMod.LERMS_SOURCE_TRUTH_SCHEMA, 'lerms.source-truth.v0');
assert.equal(webgpuMod.LERMS_JUICE_HIT_EVENT_SCHEMA, 'lerms.juice-hit-event.v0');
assert.equal(mod.FINGER_JUICE_HOST_PACKET_SCHEMA, 'big-papa-finger-juice.host-packet.v0');
assert.equal(mod.FINGER_JUICE_HOST_PACKET_ROUTE, 'big-papa/finger-juice/host-packet');
assert.equal(mod.FINGER_JUICE_HOST_RENDER_PAYLOAD_PREVIEW_SCHEMA, 'big-papa-finger-juice.render-payload.preview.v0');
assert.equal(mod.HILL_OF_HILLS_PREVIEW_BENCH_PAYLOAD_SCHEMA, 'lerms.hill-of-hills.preview-bench-payload.v0');
assert.equal(mod.FINGER_JUICE_HILL_SUPPORT_FRAME_INGESTION_CONTRACT, 'hill-preview-bench-support-frame-ingestion-v0');

const hillPayloadReport = {
  ok: true,
  schema: 'kaminos.preview-bench.payload-report.v0',
  route: 'kaminos/preview-bench/payload-file',
  payload: {
    schema: 'lerms.hill-of-hills.preview-bench-payload.v0',
    route: 'lerms/hill-of-hills/preview-bench-payload-file',
    acceptanceSurface: {
      kind: 'kaminos_preview_bench_payload',
      worldChamberId: 'lerms-underhill',
      posture: 'inspect',
      bench: 'terrain-preview',
    },
    source: {
      authority: 'live_simulation',
      diaulos: 'hill-of-hills-fucker',
      route: 'hill-of-hills/preview-bench-payload',
      frameId: 'hill-frame-1',
      backend: 'deterministic-cpu-heightfield',
    },
    sourceTruth: {
      schema: 'lerms.source-truth.v0',
      authority: 'live_simulation',
      route: 'hill-of-hills/preview-bench-payload',
      frameId: 'hill-frame-1',
      backend: 'deterministic-cpu-heightfield',
      configId: 'hill-of-hills-preview-bench-payload-v0',
    },
    sourceRef: {
      repo: 'lerms',
      path: 'terrain/hill-of-hills-preview-bench-payload.ts',
    },
    terrainBuffer: {
      schema: 'lerms.hill-of-hills-terrain-buffer.v0',
      sampleSchema: 'lerms.terrain-sample.v0',
      transport: 'summary_only_typed_arrays_remain_source_owned',
      gridResolution: { x: 116, z: 148 },
      sampleCount: 17168,
      sampleChecksum: '9360a055',
      topologyChecksum: 'aea2ce25',
      heightRange: { min: -0.6246, max: 4.4339 },
    },
    phase: {
      mode: 'trail-phase',
      terrainEpoch: 3,
      activePhaseCount: 2,
      phaseChecksum: 'phase-a',
    },
    supportFrame: {
      supportClass: 'single_valued_heightfield',
      mappingMode: 'static_domain_to_world',
      supportEpoch: 4,
      topologyEpoch: 3,
      substrateTileCount: 1073,
      dirtySubstrateTileCount: 612,
      supportFrameChecksum: 'a85a912b',
      maxHeightDelta: 0.026139946188593447,
      maxSurfaceSpeed: 1.6337466367870903,
    },
    downgrades: [
      'host_visualization_not_source_truth',
      'terrain_only_not_full_vertical',
      'kaminos_preview_bench_not_lerms_world_law',
    ],
  },
};
const hillSupportFrame = mod.normalizeHillSupportFramePayload(hillPayloadReport, { stepCount: 7 });
assert.equal(hillSupportFrame.schema, 'big-papa-finger-juice.support-frame.v0', 'Hill support normalization preserves Big Papa support-frame schema');
assert.equal(hillSupportFrame.supportFrameIngestionContract, 'hill-preview-bench-support-frame-ingestion-v0', 'Hill support normalization names ingestion contract');
assert.equal(hillSupportFrame.supportFrameSource, 'hill_preview_bench_payload_v0', 'Hill support normalization records source kind');
assert.equal(hillSupportFrame.sourceAuthority, 'live_simulation', 'Hill support normalization preserves live source authority');
assert.equal(hillSupportFrame.sourceDiaulos, 'hill-of-hills-fucker', 'Hill support normalization preserves source diaulos');
assert.equal(hillSupportFrame.supportFrameChecksum, 'a85a912b', 'Hill support normalization preserves source checksum');
assert.equal(hillSupportFrame.substrateGrid.x, 116, 'Hill support normalization adopts source grid x resolution');
assert.equal(hillSupportFrame.substrateGrid.z, 148, 'Hill support normalization adopts source grid z resolution');
assert.equal(hillSupportFrame.terrainBufferTransport, 'summary_only_typed_arrays_remain_source_owned', 'Hill support normalization records metadata-only transport');
assert.ok(hillSupportFrame.supportFrameDowngrades.includes('fluid_collision_heightfield_still_local_procedural'), 'Hill support normalization states collision remains local until raw samples are wired');
const hillPreviewPayload = mod.createFingerJuicePreviewBenchPayload({
  supportFrame: hillSupportFrame,
  substrateReservoirDiagnostics: {
    schema: 'big-papa-finger-juice.substrate-reservoir-diagnostics.v0',
    supportFrameChecksum: hillSupportFrame.supportFrameChecksum,
    activeReservoirDomains: { componentCount: 0, largestComponent: null, components: [] },
    occupiedCellCount: 0,
    surfaceParticleCount: 0,
    estimatedFluidVolume: 0,
  },
  particleCount: 0,
}, { reportPath: null });
assert.equal(hillPreviewPayload.payload.summary.supportFrameSource, 'hill_preview_bench_payload_v0', 'Preview Bench payload summarizes Hill support source');
assert.equal(hillPreviewPayload.payload.summary.sourceAuthority, 'live_simulation', 'Preview Bench payload summarizes Hill source authority');
assert.ok(hillPreviewPayload.payload.downgrades.includes('fluid_collision_heightfield_still_local_procedural'), 'Preview Bench payload carries honest local-collision downgrade');
assert.ok(!hillPreviewPayload.payload.downgrades.includes('local_procedural_support_frame_not_live_hill'), 'Preview Bench payload does not claim local support frame after Hill support ingestion');

const hillTerrainSamplePacket = {
  ok: true,
  schema: 'kaminos.preview-bench.terrain-sample-packet.v0',
  route: 'kaminos/preview-bench/terrain-sample-file',
  frameId: 'hill-terrain-sample-frame-1',
  source: {
    authority: 'live_simulation',
    producerDiaulos: 'hill-of-hills-fucker',
    route: 'lerms/hill-of-hills/terrain-sample-packet-file',
    configId: 'hill-of-hills-terrain-sample-packet-v0',
    backend: 'deterministic-cpu-heightfield',
  },
  freshness: {
    status: 'fresh-live-terrain-sample',
    sampleAgeMs: 0,
    budgetMs: 900000,
  },
  terrainSample: {
    schema: 'lerms.terrain-sample.v0',
    route: 'lerms/hill-of-hills/terrain-sample-fetch',
    grid: { columns: 2, rows: 2, sampleCount: 4, spacing: { x: 2, z: 2 } },
    worldBounds: {
      x: { min: -1, max: 1 },
      y: { min: 0, max: 0.6 },
      z: { min: -1, max: 1 },
    },
    domainBounds: { u: { min: 0, max: 1 }, v: { min: 0, max: 1 } },
    channelLayout: ['height', 'normal', 'gradient', 'heightDelta', 'surfaceVelocity'],
    transport: {
      kind: 'source-owned-fetch-url',
      encoding: 'json-base64-f32-le',
      fetchUrl: '/api/read?root=scratch&path=hill-terrain-data.json',
    },
    checksums: {
      supportFrame: 'hill-live-support',
      topology: 'hill-live-topology',
      sample: 'hill-live-sample',
      channels: 'hill-live-channels',
    },
  },
};
const hillTerrainSampleData = {
  schema: 'lerms.hill-of-hills.terrain-sample-data.v0',
  sourceTruth: {
    schema: 'lerms.source-truth.v0',
    authority: 'live_simulation',
    route: 'hill-of-hills/terrain-sample-packet',
    frameId: 'hill-terrain-sample-frame-1',
    backend: 'deterministic-cpu-heightfield',
    configId: 'hill-of-hills-terrain-sample-packet-v0',
  },
  grid: { columns: 2, rows: 2, sampleCount: 4, spacing: { x: 2, z: 2 } },
  worldBounds: {
    x: { min: -1, max: 1 },
    y: { min: 0, max: 0.6 },
    z: { min: -1, max: 1 },
  },
  domainBounds: { u: { min: 0, max: 1 }, v: { min: 0, max: 1 } },
  checksums: {
    supportFrame: 'hill-live-support',
    topology: 'hill-live-topology',
    sample: 'hill-live-sample',
    channels: 'hill-live-channels',
  },
  channels: {
    height: { encoding: 'base64-f32-le', components: ['height'], shape: [4], byteLength: 16, data: encodeF32([0, 0.2, 0.4, 0.6]) },
    normal: { encoding: 'base64-f32-le', components: ['x', 'y', 'z'], shape: [4, 3], byteLength: 48, data: encodeF32([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]) },
    gradient: { encoding: 'base64-f32-le', components: ['dx', 'dz'], shape: [4, 2], byteLength: 32, data: encodeF32([1, 10, 1, 10, 1, 10, 1, 10]) },
    heightDelta: { encoding: 'base64-f32-le', components: ['heightDelta'], shape: [4], byteLength: 16, data: encodeF32([0.1, 0.2, 0.3, 0.4]) },
    surfaceVelocity: { encoding: 'base64-f32-le', components: ['x', 'y', 'z'], shape: [4, 3], byteLength: 48, data: encodeF32([0.01, 0, 0.02, 0.01, 0, 0.02, 0.01, 0, 0.02, 0.01, 0, 0.02]) },
  },
};
const hillTerrainSurface = mod.normalizeHillTerrainSamplePacket(hillTerrainSamplePacket, hillTerrainSampleData, { stepCount: 9 });
assert.equal(hillTerrainSurface.schema, 'big-papa-finger-juice.terrain-sample-surface.v0', 'Hill terrain sample normalization produces a Big Papa sample surface');
assert.equal(hillTerrainSurface.supportFrame.heightfieldCouplingMode, 'source_height_samples_v0', 'Hill terrain samples switch coupling to source samples');
assert.equal(hillTerrainSurface.supportFrame.terrainBufferTransport, 'source-owned-fetch-url', 'Hill terrain sample normalization preserves source-owned fetch transport');
assert.equal(hillTerrainSurface.supportFrame.terrainChannelChecksum, 'hill-live-channels', 'Hill terrain sample normalization preserves channel checksum');
assert.equal(hillTerrainSurface.sampleHeightAt(0, 0), 0.3, 'Hill terrain sample bilinearly samples source height data');
assert.deepEqual(hillTerrainSurface.sampleNormalAt(0, 0).map(value => Number(value.toFixed(3))), [0, 1, 0], 'Hill terrain sample exposes source normals');
assert.equal(hillTerrainSurface.sampleSurfaceVelocityAt(0, 0)[0], 0.01, 'Hill terrain sample exposes source surface velocity');
assert.ok(!hillTerrainSurface.supportFrame.supportFrameDowngrades.includes('fluid_collision_heightfield_still_local_procedural'), 'live sample surface removes local-collision downgrade');

const packet = mod.normalizeWorldFingerJuiceEmitterPacket({
  packet_id: 'test-live-packet-1',
  source_route: 'perceptasia-finger-fluid-swarm',
  source_backend: 'perceptasia.synthetic-hand-route',
  source_frame_id: 'perceptasia-swarm-world-v0',
  sidecar_sequence: 42,
  evidence_kind: 'synthetic_fixture',
  sample_age_ms: 24,
  simulation_authority: 'synthetic_fixture',
  hand_sample_space: {
    id: 'perceptasia.hand-sample-space.v0',
    handedness: 'right',
    screen_x: 'operator_unmirrored',
  },
  lerms_world_frame: {
    id: 'palm-daddy-rounded-channel',
    units: 'normalized_world',
    projection_contract: 'sampled_triangle_mesh_rounded_channel_manifold_v0',
    world_from_hand_sample: 'synthetic-fixture-transform-v0',
  },
  emitters: [
    {
      id: 'index',
      tip_index: 8,
      origin_world: [0, 0.38, -0.82],
      aim_world: [0.18, 0.48, 1.0],
      motion_world: [0.08, 0, 0.12],
      extension: 0.95,
      chemistry: 'knockback',
      radius: 0.044,
      strength: 1.25,
      authority: { valid: true, stale: false, confidence: 0.93, force_safe: true },
      active: true,
    },
    {
      id: 'middle',
      tip_index: 12,
      origin_world: [0.12, 0.35, -0.78],
      aim_world: [0, 0.22, 1.0],
      extension: 0.45,
      chemistry: 'pooling',
      authority: { valid: true, stale: false, confidence: 0.82, force_safe: true },
      active: true,
    },
  ],
});

assert.equal(packet.schema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(packet.packet_id, 'test-live-packet-1');
assert.equal(packet.source_route, 'perceptasia-finger-fluid-swarm');
assert.equal(packet.source_frame_id, 'perceptasia-swarm-world-v0');
assert.equal(packet.sidecar_sequence, 42);
assert.equal(packet.evidence_kind, 'synthetic_fixture');
assert.equal(packet.simulation_authority, 'synthetic_fixture');
assert.equal(packet.authority.simulation_safe, true);
assert.equal(packet.hand_sample_space.screen_x, 'operator_unmirrored');
assert.equal(packet.lerms_world_frame.world_from_hand_sample, 'synthetic-fixture-transform-v0');
assert.equal(packet.active_emitter_count, 2);
assert.equal(packet.authority.stale_visual_only, false);
assert.equal(packet.emitters[0].id, 'index');
assert.equal(packet.emitters[0].authority.force_safe, true);
assert.equal(packet.emitters[0].origin_screen, null);
assert.equal(packet.emitters[0].aim_screen, null);
assert.ok(Math.abs(packet.emitters[0].aim_world.y - 0.427) < 0.002, 'world aim is normalized with upward arc intact');
assert.equal(packet.emitters[1].chemistry, 'pooling');
assert.equal(packet.terrain_frame.id, 'palm-daddy-rounded-channel');

const prototype = mod.createWorldFingerJuiceTransportPrototype({ maxParticles: 64, seed: 7 });
prototype.setEmitters(packet);
prototype.setTerrainSampleSurface(hillTerrainSurface);
const afterSpawn = prototype.step(1 / 30);
assert.equal(afterSpawn.effectiveRoute, 'world-space-ballistic-surface-flow-particles-v0');
assert.equal(afterSpawn.emitterSchema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(afterSpawn.arcContract, 'finger-aim-ballistic-arc-range-v0');
assert.equal(afterSpawn.terrainContract, 'hill-of-hills-heightfield-collision-v0');
assert.equal(afterSpawn.supportFrame.heightfieldCouplingMode, 'source_height_samples_v0', 'prototype reports live terrain sample coupling after sample ingestion');
assert.ok(afterSpawn.particleCount > 0, 'active world emitters spawn particles');
assert.ok(afterSpawn.airborneCount > 0, 'first step preserves ballistic airborne particles');

for (let i = 0; i < 75; i += 1) {
  prototype.step(1 / 60);
}
const settled = prototype.debugState();
assert.ok(settled.surfaceFlowCount > 0, 'particles collide with heightfield and enter surface flow');
assert.ok(settled.poolingCount > 0, 'surface-flow particles can pool on the terrain');
assert.ok(settled.maxRangeZ > 0.25, 'ballistic arc produces forward range');
assert.ok(settled.trailSampleCount >= 96, 'late state retains enough trail samples to show motion');
assert.ok(settled.trailEmitterCount >= 2, 'late state preserves multiple emitter trail identities');
assert.ok(settled.surfaceStreakCount > 0, 'late state exposes surface-flow streak evidence');
assert.ok(settled.trailSpanZ > 0.35, 'late trails preserve forward travel span');
assert.ok(settled.sourceAnchorCount >= 2, 'late state preserves separate source anchors');
assert.ok(settled.maxTrailSegmentLength < 0.34, 'late state does not draw false long trail bridges');
assert.ok(settled.airborneBreadcrumbCount > 0, 'late state preserves airborne breadcrumb evidence');
assert.ok(settled.impactRingCount > 0, 'late state preserves contact/impact ring evidence');
assert.ok(settled.surfaceSmearCount > 0, 'late state preserves phase-aware surface smear evidence');
assert.ok(settled.trails.some(trail => trail.samples.some(sample => Array.isArray(sample.velocity_hint))), 'trail samples carry velocity hints');
assert.ok(settled.heightfieldSamples.length >= 5, 'debug state records heightfield samples');
assert.ok(settled.heightfieldSamples.every(sample => sample.y > 0.2), 'debug heightfield samples come from Hill source terrain data');
assert.equal(settled.terrainSampleDiagnostics.sampleChecksum, 'hill-live-sample', 'debug state preserves Hill terrain sample checksum');
assert.equal(settled.supportFrame.schema, 'big-papa-finger-juice.support-frame.v0', 'debug state carries Big Papa support frame schema');
assert.equal(settled.supportFrame.supportClass, 'single_valued_heightfield', 'support frame declares Hill-compatible single-valued support');
assert.equal(settled.supportFrame.mappingMode, 'static_domain_to_world', 'support frame declares current static domain mapping');
assert.equal(settled.supportFrame.domainBounds.u.min, 0, 'support domain u begins at zero');
assert.equal(settled.supportFrame.domainBounds.u.max, 1, 'support domain u ends at one');
assert.ok(settled.supportFrame.supportFrameChecksum, 'support frame exposes checksum identity');
assert.equal(settled.substrateReservoirDiagnostics.schema, 'big-papa-finger-juice.substrate-reservoir-diagnostics.v0', 'debug state carries reservoir diagnostics schema');
assert.equal(settled.substrateReservoirDiagnostics.supportFrameChecksum, settled.supportFrame.supportFrameChecksum, 'reservoir diagnostics bind to the sampled support frame checksum');
assert.ok(settled.substrateReservoirDiagnostics.occupiedCellCount > 0, 'reservoir diagnostics count occupied support cells');
assert.ok(settled.substrateReservoirDiagnostics.activeReservoirDomains.componentCount > 0, 'reservoir diagnostics expose active component count');
assert.ok(settled.substrateReservoirDiagnostics.activeReservoirDomains.largestComponent.particleCount > 0, 'largest active domain reports particle count');
assert.ok(settled.substrateReservoirDiagnostics.activeReservoirDomains.largestComponent.domainBounds.u.min >= 0, 'largest domain reports normalized support bounds');
const previewPayload = mod.createFingerJuicePreviewBenchPayload(settled, {
  reportPath: '/private/tmp/big-papa-finger-juice-preview-bench-payload-test.json',
});
assert.equal(previewPayload.schema, 'kaminos.preview-bench.payload-report.v0', 'Preview Bench export uses Kaminos report envelope');
assert.equal(previewPayload.payload.schema, 'big-papa-finger-juice.preview-bench-payload.v0', 'Preview Bench payload preserves Big Papa source schema');
assert.equal(previewPayload.payload.source.authority, 'synthetic_fixture', 'Preview Bench payload preserves source authority');
assert.equal(previewPayload.payload.summary.supportFrameChecksum, settled.supportFrame.supportFrameChecksum, 'Preview Bench payload summarizes support-frame checksum');
assert.ok(previewPayload.payload.fields.some(field => field.label === 'Active domains'), 'Preview Bench payload exposes active domain field for operator inspection');
assert.ok(previewPayload.payload.downgrades.includes('local_procedural_support_frame_not_live_hill'), 'Preview Bench payload declares local support frame downgrade');
assert.ok(previewPayload.payload.rejectedSurfaces.some(surface => surface.acceptanceSurface === false), 'Preview Bench payload rejects debug/visual surfaces explicitly');
const hostPacket = mod.createFingerJuiceHostPacket(settled, {
  packetUrl: '/api/read?root=lerms-preview&path=big-papa-finger-juice-host-packet.json',
  sourceRef: 'cc/big-papa-finger-juice-0626@host-packet-test',
  generatedAt: '2026-06-30T00:00:00.000Z',
  observedAt: '2026-06-30T00:00:00.000Z',
  freshnessBudgetMs: 1500,
});
assert.equal(hostPacket.schema, 'big-papa-finger-juice.host-packet.v0', 'host packet uses Big Papa source schema');
assert.equal(hostPacket.route, 'big-papa/finger-juice/host-packet', 'host packet uses Big Papa source route');
assert.equal(hostPacket.packetUrl, '/api/read?root=lerms-preview&path=big-papa-finger-juice-host-packet.json', 'host packet carries file/root-path compatible URL');
assert.equal(hostPacket.source.producerDiaulos, 'big-papa-finger-juice-fucker', 'host packet names Big Papa as producer diaulos');
assert.equal(hostPacket.source.authority, 'synthetic_fixture', 'host packet preserves source authority');
assert.equal(hostPacket.source.sourceTruthAuthority, 'synthetic_fixture', 'host packet exposes source-truth authority separately');
assert.equal(hostPacket.freshness.budgetMs, 1500, 'host packet carries explicit freshness budget');
assert.equal(hostPacket.terrain.couplingMode, 'source_height_samples_v0', 'host packet preserves Hill terrain sample coupling');
assert.equal(hostPacket.terrain.sampleChecksum, 'hill-live-sample', 'host packet preserves Hill sample checksum');
assert.equal(hostPacket.terrain.channelChecksum, 'hill-live-channels', 'host packet preserves Hill channel checksum');
assert.ok(hostPacket.solver.solverRoute, 'host packet carries solver route identity');
assert.ok(hostPacket.solver.particleCount > 0, 'host packet carries particle count');
assert.equal(hostPacket.render.payload.schema, 'big-papa-finger-juice.render-payload.preview.v0', 'host packet carries downgraded render payload schema');
assert.equal(hostPacket.render.payload.downgraded, true, 'host packet marks preview payload as downgraded');
assert.ok(hostPacket.render.payload.downgrades.includes('preview_particle_samples_not_full_render_buffer'), 'host packet names preview particle sample downgrade');
assert.ok(hostPacket.visual.cameraHints.presets.some(preset => preset.id === 'operator-oblique'), 'host packet carries operator camera hint preset');
assert.ok(hostPacket.custody.rejectedDebugSurfaces.some(surface => surface.surface === 'direct_lerms_finger_juice_debug_route'), 'host packet rejects direct debug route as acceptance surface');
assert.ok(hostPacket.custody.downgrades.includes('host_packet_preview_payload_not_native_render_buffer'), 'host packet names native-render-buffer downgrade');
assert.ok(Array.isArray(hostPacket.hitRefs.events), 'host packet exposes hit event refs array');

const hitPrototype = mod.createWorldFingerJuiceTransportPrototype({
  maxParticles: 64,
  seed: 3,
  lerms: [{ id: 'red-lerm-1', position: [0.11, 0.1, -0.13], radius: 0.18, mass: 1.4 }],
  goins: [{ id: 'goin-1', position: [0.22, 0.1, -0.08], radius: 0.14, mass: 2 }],
});
hitPrototype.setEmitters(packet);
for (let i = 0; i < 90; i += 1) {
  hitPrototype.step(1 / 60);
}
const hitState = hitPrototype.debugState();
assert.ok(hitState.lermImpulseCount > 0, 'world particles apply lerm impulses');
assert.ok(hitState.goinImpulseCount > 0, 'world particles apply goin impulses');

const { data: initialWebgpuData, sources: initialWebgpuSources } = webgpuMod.createInitialWebGPUParticles(packet, {
  maxParticles: 96,
  seed: 13,
});
const oracleHitState = webgpuMod.runCpuFingerJuiceOracle(initialWebgpuData, {
  steps: 140,
  dt: 1 / 60,
  sources: initialWebgpuSources,
  emitterPacket: packet,
  lerms: [{ id: 'red-lerm-1', position: [0.11, 0.1, -0.13], radius: 0.18, mass: 1.4 }],
  goins: [{ id: 'goin-1', position: [0.22, 0.1, -0.08], radius: 0.14, mass: 2 }],
  terrainSampleSurface: hillTerrainSurface,
});
assert.equal(oracleHitState.sourceTruth.schema, 'lerms.source-truth.v0', 'WebGPU summary carries LERMS source truth');
assert.equal(oracleHitState.sourceTruth.authority, 'synthetic_fixture', 'WebGPU summary preserves packet authority');
assert.ok(oracleHitState.sourceDiagnostics.sourcePacketId, 'WebGPU summary reports source packet identity');
assert.ok(Array.isArray(oracleHitState.emitterDiagnostics) && oracleHitState.emitterDiagnostics.length >= 2, 'WebGPU summary reports emitter diagnostics');
assert.equal(oracleHitState.supportFrame.supportClass, 'single_valued_heightfield', 'WebGPU summary carries Hill-compatible support frame');
assert.equal(oracleHitState.supportFrame.heightfieldCouplingMode, 'source_height_samples_v0', 'WebGPU oracle summary reports live source-height terrain coupling');
assert.equal(oracleHitState.terrainSampleDiagnostics.sampleChecksum, 'hill-live-sample', 'WebGPU oracle summary preserves Hill terrain sample checksum');
assert.equal(oracleHitState.substrateReservoirDiagnostics.supportFrameChecksum, oracleHitState.supportFrame.supportFrameChecksum, 'WebGPU reservoir diagnostics bind to support-frame checksum');
assert.ok(oracleHitState.substrateReservoirDiagnostics.activeReservoirDomains.componentCount > 0, 'WebGPU summary reports active reservoir domains');
assert.ok(oracleHitState.pressureDensityStats.pressureNeighborWindow > 0, 'WebGPU summary reports bounded pressure neighbor scope');
assert.equal(oracleHitState.spatialPressureStats.pressureContract, 'wgsl-spatial-cell-pressure-v0', 'WebGPU summary reports spatial pressure contract');
assert.ok(oracleHitState.spatialPressureStats.spatialCellCount > 0, 'WebGPU summary reports spatial pressure cell count');
assert.ok(oracleHitState.spatialPressureStats.occupiedCellCount > 0, 'WebGPU summary reports occupied pressure cells');
assert.equal(oracleHitState.fluidDepthStats.pressureContract, 'wgsl-spatial-viscosity-pressure-v0', 'WebGPU summary reports deeper fluid contract');
assert.ok(oracleHitState.fluidDepthStats.spatialPressureIterations >= 2, 'WebGPU summary reports multiple pressure iterations');
assert.ok(oracleHitState.fluidDepthStats.viscosityAffectedCount > 0, 'WebGPU summary reports viscosity affected particles');
assert.ok(oracleHitState.juiceHitEvents.length > 0, 'WebGPU summary emits LERMS juice-hit events');
assert.equal(oracleHitState.juiceHitEvents[0].schema, 'lerms.juice-hit-event.v0', 'juice hit event schema is LERMS compatible');
assert.ok(['lerm', 'goin'].includes(oracleHitState.juiceHitEvents[0].targetKind), 'juice hit targets LERMS receiver kinds');
assert.equal(oracleHitState.juiceHitEvents[0].sourcePacketId, packet.packet_id, 'juice hit preserves source packet id');
assert.equal(oracleHitState.juiceHitEvents[0].source.schema, 'lerms.source-truth.v0', 'juice hit carries source truth');
assert.ok(Array.isArray(oracleHitState.juiceHitEvents[0].contactWorld), 'juice hit carries contact world');
assert.ok(Array.isArray(oracleHitState.juiceHitEvents[0].impulse), 'juice hit carries impulse vector');

for (const simulation_authority of ['visual_only', 'stale_hold', 'invalid']) {
  const unsafe = mod.normalizeWorldFingerJuiceEmitterPacket({
    simulation_authority,
    source_route: 'perceptasia-finger-fluid-swarm',
    source_backend: 'perceptasia.synthetic-hand-route',
    source_frame_id: 'perceptasia-swarm-world-v0',
    evidence_kind: simulation_authority,
    hand_sample_space: { id: 'perceptasia.hand-sample-space.v0' },
    lerms_world_frame: {
      id: 'palm-daddy-rounded-channel',
      units: 'normalized_world',
      world_from_hand_sample: 'visual-only-transform-v0',
    },
    emitters: [{
      id: 'index',
      origin_world: [0, 0.38, -0.82],
      aim_world: [0.18, 0.48, 1.0],
      extension: 0.95,
      chemistry: 'knockback',
      authority: { valid: true, stale: simulation_authority !== 'visual_only', confidence: 0.9, force_safe: true },
      active: true,
    }],
  });
  assert.equal(unsafe.authority.simulation_safe, false, `${simulation_authority} packet must not be simulation-safe`);
  assert.equal(unsafe.emitters[0].active, false, `${simulation_authority} emitter must not apply force`);
  assert.equal(unsafe.emitters[0].authority.render_safe, true, `${simulation_authority} emitter can remain render/debug safe`);
  const unsafePrototype = mod.createWorldFingerJuiceTransportPrototype({
    maxParticles: 64,
    seed: 5,
    lerms: [{ id: 'red-lerm-unsafe', position: [0.11, 0.1, -0.13], radius: 0.18 }],
  });
  unsafePrototype.setEmitters(unsafe);
  for (let i = 0; i < 90; i += 1) {
    unsafePrototype.step(1 / 60);
  }
  const unsafeState = unsafePrototype.debugState();
  assert.equal(unsafeState.particleCount, 0, `${simulation_authority} packet must not spawn particles`);
  assert.equal(unsafeState.lermImpulseCount, 0, `${simulation_authority} packet must not apply lerm force`);
}

const missingFrame = mod.normalizeWorldFingerJuiceEmitterPacket({
  simulation_authority: 'live_simulation',
  source_backend: 'perceptasia.synthetic-hand-route',
  emitters: [{
    id: 'index',
    origin_world: [0, 0.38, -0.82],
    aim_world: [0.18, 0.48, 1.0],
    extension: 0.95,
    authority: { valid: true, stale: false, confidence: 0.9, force_safe: true },
    active: true,
  }],
});
assert.equal(missingFrame.simulation_authority, 'invalid');
assert.equal(missingFrame.authority.simulation_safe, false);
assert.match(missingFrame.authority.reason, /missing.*frame/i);
