import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'lerms-finger-juice-core.js');
const webgpuCorePath = join(root, 'lerms-finger-juice-webgpu-core.js');
const pagePath = join(root, 'lerms-finger-juice.html');
const witnessPath = join(root, 'lerms-finger-juice-witness.mjs');

assert.ok(existsSync(corePath), 'world finger-juice core module exists');
assert.ok(existsSync(webgpuCorePath), 'WebGPU finger-juice core module exists');
assert.ok(existsSync(pagePath), 'world finger-juice prototype page exists');
assert.ok(existsSync(witnessPath), 'world finger-juice route witness exists');

const coreSource = readFileSync(corePath, 'utf8');
const webgpuCoreSource = readFileSync(webgpuCorePath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');

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
assert.match(coreSource, /export function normalizeWorldFingerJuiceEmitterPacket/, 'core exports packet normalizer');
assert.match(coreSource, /export function createWorldFingerJuiceTransportPrototype/, 'core exports deterministic transport prototype');

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
assert.match(webgpuCoreSource, /DEFAULT_PARTICLE_SUPPORT_BUDGET\s*=\s*24000/, 'WebGPU solver names the 24k first support budget');
assert.match(webgpuCoreSource, /SPATIAL_PRESSURE_GRID_X\s*=\s*64/, 'WebGPU support grid has enough horizontal cells for 24k support smoke');
assert.match(webgpuCoreSource, /SPATIAL_PRESSURE_GRID_Z\s*=\s*96/, 'WebGPU support grid has enough forward cells for 24k support smoke');
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
assert.match(webgpuCoreSource, /applySurfaceStabilityDamping/, 'WebGPU solver damps high-density surface relaxation before the next density solve');
assert.match(webgpuCoreSource, /applyVisualStreakBeadDamping/, 'WebGPU solver damps visually obvious streaks and detached bead chains');
assert.match(webgpuCoreSource, /densityPositionSolveStats/, 'WebGPU solver reports density/position solve diagnostics');
assert.match(webgpuCoreSource, /densityContinuityProjectionStats/, 'WebGPU solver reports density continuity projection diagnostics');
assert.match(webgpuCoreSource, /continuityPeakOccupancyRatio/, 'continuity diagnostics report peak occupancy pressure');
assert.match(webgpuCoreSource, /continuityProjectionCandidateCount/, 'continuity diagnostics report projection candidate count');
assert.match(webgpuCoreSource, /CONTINUITY_BIN_REFRESH_CHUNK/, 'continuity solve refreshes spatial bins across long step batches');
assert.match(webgpuCoreSource, /particleSupportBudgetStats/, 'WebGPU solver reports particle support budget diagnostics');
assert.match(webgpuCoreSource, /spatial_cell_radius_support_v0/, 'support diagnostics measure physical spatial-cell radius support');
assert.match(webgpuCoreSource, /settleRestEnergyStats/, 'WebGPU solver reports settle/rest energy diagnostics');
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
assert.match(webgpuCoreSource, /adapterInfo/, 'WebGPU route records adapter identity');

assert.match(pageSource, /lerms_world_finger_juice=1/, 'prototype page declares its smoke route query');
assert.match(pageSource, /window\.__lermsFingerJuiceDebug/, 'prototype exposes route debug state for witnesses');
assert.match(pageSource, /window\.__lermsFingerJuiceStepForWitness/, 'prototype exposes deterministic witness stepping');
assert.match(pageSource, /createWebGPUFingerJuiceSolver/, 'prototype integrates WebGPU finger-juice solver');
assert.match(pageSource, /juice-gpu-layer/, 'prototype includes a WebGPU juice overlay canvas');
assert.match(pageSource, /webgpu_particle_solver_v0/, 'prototype displays WebGPU solver route identity');
assert.match(pageSource, /webgpu_particle_splat_renderer_v0/, 'prototype displays WebGPU render route identity');
assert.match(pageSource, /particleSupportBudget\s*=\s*24000/, 'prototype uses the 24k particle support budget');
assert.match(pageSource, /live_readback_decoupled_v0/, 'prototype names the live readback decoupling contract');
assert.match(pageSource, /liveReadbackSkippedCount/, 'prototype records skipped live debug readbacks instead of blocking frames');
assert.match(pageSource, /cpuOracle:\s*false/, 'prototype disables CPU oracle during live animation readbacks');
assert.match(pageSource, /sourceDiagnostics/, 'prototype displays source diagnostics');
assert.match(pageSource, /emitterDiagnostics/, 'prototype displays live emitter diagnostics');
assert.match(pageSource, /pressureDensityStats/, 'prototype displays pressure density diagnostics');
assert.match(pageSource, /spatialPressureStats/, 'prototype displays spatial pressure diagnostics');
assert.match(pageSource, /fluidDepthStats/, 'prototype displays deeper fluid diagnostics');
assert.match(pageSource, /surfaceCohesionStats/, 'prototype displays surface cohesion diagnostics');
assert.match(pageSource, /spatialSurfaceRelaxationStats/, 'prototype displays spatial surface relaxation diagnostics');
assert.match(pageSource, /densityPositionSolveStats/, 'prototype displays density/position solve diagnostics');
assert.match(pageSource, /densityContinuityProjectionStats/, 'prototype displays density continuity projection diagnostics');
assert.match(pageSource, /particleSupportBudgetStats/, 'prototype displays support budget diagnostics');
assert.match(pageSource, /settleRestEnergyStats/, 'prototype displays settle/rest energy diagnostics');
assert.match(pageSource, /visualStreakBeadStats/, 'prototype displays visual streak/bead damping diagnostics');
assert.match(pageSource, /__lermsFingerJuiceStressForWitness/, 'prototype exposes an expanded witness stress phase hook');
assert.match(pageSource, /__lermsFingerJuiceFreezeForWitness/, 'prototype exposes a frozen capture hook so screenshot and state cannot drift');
assert.match(pageSource, /witness-frozen-state-capture-v0/, 'prototype names the frozen witness capture contract');
assert.match(pageSource, /__lermsFingerJuiceVisualFrameForWitness/, 'prototype exposes a focused visual frame for witness capture');
assert.match(pageSource, /visualActivityFrame/, 'prototype computes projected activity framing for witness capture');
assert.match(pageSource, /dense-fluid-activity-clip-v0/, 'prototype can focus witness capture on dense fluid activity instead of sparse outliers');
assert.match(pageSource, /responsiveSmokeProjection/, 'prototype uses viewport-responsive smoke projection instead of fixed-pixel scale');
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
assert.match(witnessSource, /maxFrameGapMs/, 'witness reports maximum live frame gap');
assert.match(witnessSource, /p95FrameGapMs/, 'witness reports p95 live frame gap');
assert.match(witnessSource, /readbackHitchEvents/, 'witness correlates frame hitches with live readback activity');
assert.match(witnessSource, /live_readback_decoupled_v0/, 'witness requires live readback decoupling identity');
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
assert.match(witnessSource, /wgsl-particle-support-budget-v0/, 'witness records particle support budget contract');
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

const mod = await import(corePath);
const webgpuMod = await import(webgpuCorePath);
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA, 'lerms.world-finger-juice-emitters.v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ROUTE, 'world-space-ballistic-surface-flow-particles-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT, 'hill-of-hills-heightfield-collision-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT, 'finger-aim-ballistic-arc-range-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SOLVER_ROUTE, 'webgpu_particle_solver_v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SHADER_ROUTE, 'wgsl-ballistic-heightfield-surface-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_RENDERER_ROUTE, 'webgpu_particle_splat_renderer_v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_RENDER_SHADER_ROUTE, 'wgsl-particle-splat-renderer-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_EMITTER_BUFFER_ROUTE, 'webgpu_emitter_buffer_v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_RESPAWN_CONTRACT, 'wgsl-gpu-emitter-respawn-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_PRESSURE_CONTRACT, 'wgsl-local-density-pressure-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SPATIAL_PRESSURE_CONTRACT, 'wgsl-spatial-cell-pressure-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_FLUID_DEPTH_CONTRACT, 'wgsl-spatial-viscosity-pressure-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SURFACE_COHESION_CONTRACT, 'wgsl-same-chemistry-surface-cohesion-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_SURFACE_RELAXATION_CONTRACT, 'wgsl-spatial-surface-relaxation-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_STABILITY_CONTRACT, 'wgsl-stability-damped-relaxation-v0');
assert.equal(webgpuMod.LERMS_FINGER_JUICE_WEBGPU_VISUAL_DAMPING_CONTRACT, 'wgsl-visual-streak-bead-damping-v0');
assert.equal(webgpuMod.LERMS_SOURCE_TRUTH_SCHEMA, 'lerms.source-truth.v0');
assert.equal(webgpuMod.LERMS_JUICE_HIT_EVENT_SCHEMA, 'lerms.juice-hit-event.v0');

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
const afterSpawn = prototype.step(1 / 30);
assert.equal(afterSpawn.effectiveRoute, 'world-space-ballistic-surface-flow-particles-v0');
assert.equal(afterSpawn.emitterSchema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(afterSpawn.arcContract, 'finger-aim-ballistic-arc-range-v0');
assert.equal(afterSpawn.terrainContract, 'hill-of-hills-heightfield-collision-v0');
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
});
assert.equal(oracleHitState.sourceTruth.schema, 'lerms.source-truth.v0', 'WebGPU summary carries LERMS source truth');
assert.equal(oracleHitState.sourceTruth.authority, 'synthetic_fixture', 'WebGPU summary preserves packet authority');
assert.ok(oracleHitState.sourceDiagnostics.sourcePacketId, 'WebGPU summary reports source packet identity');
assert.ok(Array.isArray(oracleHitState.emitterDiagnostics) && oracleHitState.emitterDiagnostics.length >= 2, 'WebGPU summary reports emitter diagnostics');
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
