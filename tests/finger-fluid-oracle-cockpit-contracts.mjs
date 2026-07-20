import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const moduleUrl = new URL('../finger-fluid-oracle-cockpit.js', import.meta.url);
const indexUrl = new URL('../index.html', import.meta.url);

assert.ok(existsSync(moduleUrl), 'waterfall oracle cockpit module exists');
assert.ok(existsSync(indexUrl), 'Kaminos app shell exists');

const cockpit = await import(moduleUrl);
const indexSource = readFileSync(indexUrl, 'utf8');

assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.schema, 'kaminos.finger-fluid.oracle-cockpit.adapter.v0');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.routeGateKey, 'finger_fluid_waterfall_oracle_cockpit');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.requiredTruthScene, 'waterfall_resolution_oracle');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.resolutionPreset, 'finger_fluid_oracle_resolution');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.particleSpacing, 'finger_fluid_oracle_particle_spacing');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.kernelScale, 'finger_fluid_oracle_kernel_scale');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.sourceFlux, 'finger_fluid_oracle_source_flux');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.pressureIterations, 'finger_fluid_oracle_pressure_iterations');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.viscosity, 'finger_fluid_oracle_viscosity');
assert.equal(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys.cohesion, 'finger_fluid_oracle_cohesion');
assert.ok(Object.isFrozen(cockpit.FINGER_FLUID_ORACLE_COCKPIT_ADAPTER.queryKeys), 'query keys are centralized and immutable');

assert.equal(
  cockpit.isFingerFluidOracleCockpitRoute(new URLSearchParams('kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=waterfall_resolution_oracle&finger_fluid_waterfall_oracle_cockpit=1')),
  true,
  'cockpit opts into only the waterfall oracle bench route',
);
assert.equal(
  cockpit.isFingerFluidOracleCockpitRoute(new URLSearchParams('kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=multi_regime_playground&finger_fluid_waterfall_oracle_cockpit=1')),
  false,
  'cockpit does not attach to the ordinary multi-regime bench',
);
assert.equal(
  cockpit.isFingerFluidOracleCockpitRoute(new URLSearchParams('kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=waterfall_resolution_oracle')),
  false,
  'waterfall route still requires explicit cockpit opt-in',
);
const defaultRequested = cockpit.fingerFluidOracleRequestedConfigFromParams(
  new URLSearchParams('kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=waterfall_resolution_oracle&finger_fluid_waterfall_oracle_cockpit=1'),
);
assert.equal(defaultRequested.resolutionPreset, 'baseline');
assert.equal(defaultRequested.particleCount, 12_288);
assert.equal(defaultRequested.particleSpacing, 1);
assert.equal(defaultRequested.kernelScale, 1);
assert.equal(defaultRequested.sourceFlux, 1);
assert.equal(defaultRequested.pressureIterations, 3);
assert.equal(defaultRequested.viscosity, 0.17);
assert.equal(defaultRequested.cohesion, 0.72);

const productionRequested = cockpit.fingerFluidOracleRequestedConfigFromParams(
  new URLSearchParams('kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=waterfall_resolution_oracle&finger_fluid_waterfall_oracle_cockpit=1&finger_fluid_oracle_resolution=production'),
);
assert.equal(productionRequested.resolutionPreset, 'production');
assert.equal(productionRequested.particleCount, 24_576);
assert.equal(productionRequested.particleSpacing, 1 / Math.cbrt(2));
assert.match(indexSource, /<option value="production">Production<\/option>/);

const requestedUrl = new URL('http://127.0.0.1:8090/?kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=waterfall_resolution_oracle&finger_fluid_waterfall_oracle_cockpit=1&finger_fluid_oracle_resolution=high&finger_fluid_oracle_particle_spacing=0.62&finger_fluid_oracle_kernel_scale=1.18&finger_fluid_oracle_source_flux=1.35&finger_fluid_oracle_pressure_iterations=5&finger_fluid_oracle_viscosity=0.21&finger_fluid_oracle_cohesion=0.88&finger_fluid_oracle_fixed_camera=1&finger_fluid_oracle_pause=1&finger_fluid_oracle_replay=wet-ab');
const routeState = cockpit.createFingerFluidOracleCockpitState({
  url: requestedUrl,
  effective: {
    truthScene: 'waterfall_resolution_oracle',
    effectiveParticleCount: 98_304,
    densityIterationsPerStep: 5,
    freeFlightViscosityBoost: 0.21,
    capillaryStrength: 0.88,
    solverRoute: 'webgpu-pbf-linked-cell-fluid-v0',
    waterfallContinuityContract: 'wgsl-support-aware-symmetric-capillary-sheet-v0',
  },
});

assert.equal(routeState.schema, 'kaminos.finger-fluid.oracle-cockpit.state.v0');
assert.equal(routeState.routeReady, true);
assert.equal(routeState.requested.resolutionPreset, 'high');
assert.equal(routeState.requested.particleSpacing, 0.62);
assert.equal(routeState.requested.kernelScale, 1.18);
assert.equal(routeState.requested.sourceFlux, 1.35);
assert.equal(routeState.requested.pressureIterations, 5);
assert.equal(routeState.requested.viscosity, 0.21);
assert.equal(routeState.requested.cohesion, 0.88);
assert.equal(routeState.requested.paused, true);
assert.equal(routeState.requested.fixedCamera, true);
assert.equal(routeState.requested.replayId, 'wet-ab');
assert.equal(routeState.effective.resolutionPreset, 'high');
assert.equal(routeState.effective.particleCount, 98_304);
assert.equal(routeState.effective.pressureIterations, 5);
assert.equal(routeState.effective.viscosity, 0.21);
assert.equal(routeState.effective.cohesion, 0.88);
assert.equal(routeState.effective.routeIdentity.solverRoute, 'webgpu-pbf-linked-cell-fluid-v0');
assert.equal(routeState.effective.routeIdentity.waterfallContinuityContract, 'wgsl-support-aware-symmetric-capillary-sheet-v0');
assert.equal(routeState.acceptanceClaimAllowed, false);
assert.match(routeState.operatorJudgment, /operator observation owns continuity judgment/);
assert.ok(routeState.unsupported.some(row => row.key === 'finger_fluid_oracle_particle_spacing' && row.requested === 0.62));
assert.ok(routeState.unsupported.some(row => row.key === 'finger_fluid_oracle_kernel_scale' && row.requested === 1.18));
assert.ok(routeState.unsupported.some(row => row.key === 'finger_fluid_oracle_source_flux' && row.requested === 1.35));
assert.ok(routeState.unsupported.every(row => row.severity === 'unsupported_loud'));
assert.ok(!routeState.downgrades.includes('hidden_cap_applied'), 'cockpit must not hide caps inside adapter resolution');

const authoritativePresetState = cockpit.createFingerFluidOracleCockpitState({
  url: 'http://127.0.0.1:8090/?kaminos_finger_fluid_bench=1&finger_fluid_truth_scene=waterfall_resolution_oracle&finger_fluid_waterfall_oracle_cockpit=1&finger_fluid_oracle_resolution=baseline&finger_fluid_particle_count=24576',
  effective: {
    effectiveWaterfallOraclePreset: 'baseline',
    effectiveParticleCount: 24_576,
  },
});
assert.equal(
  authoritativePresetState.effective.resolutionPreset,
  'baseline',
  'authoritative solver preset must outrank particle-count inference',
);

const urlEdit = cockpit.updateFingerFluidOracleCockpitUrl({
  url: requestedUrl,
  control: 'pressureIterations',
  value: 7,
});
assert.equal(urlEdit.restartRequired, true);
assert.equal(urlEdit.structural, true);
assert.equal(new URL(urlEdit.url).searchParams.get('finger_fluid_oracle_pressure_iterations'), '7');
assert.equal(new URL(urlEdit.url).searchParams.get('finger_fluid_oracle_restart_required'), '1');
assert.equal(urlEdit.requestedValuePreserved, true);

const pauseEdit = cockpit.updateFingerFluidOracleCockpitUrl({
  url: requestedUrl,
  control: 'paused',
  value: false,
});
assert.equal(pauseEdit.restartRequired, false);
assert.equal(new URL(pauseEdit.url).searchParams.get('finger_fluid_oracle_pause'), '0');
const resolutionEdit = cockpit.updateFingerFluidOracleCockpitUrl({
  url: requestedUrl,
  control: 'resolutionPreset',
  value: 'baseline',
});
assert.equal(resolutionEdit.restartRequired, true);
assert.equal(new URL(resolutionEdit.url).searchParams.get('finger_fluid_oracle_resolution'), 'baseline');
assert.equal(new URL(resolutionEdit.url).searchParams.get('finger_fluid_particle_count'), '12288');

const replayUrls = cockpit.createFingerFluidOracleABReplayUrls({
  url: requestedUrl,
  replayId: 'wet-sheet-0719',
});
assert.match(replayUrls.low, /finger_fluid_waterfall_oracle_cockpit=1/);
assert.match(replayUrls.high, /finger_fluid_waterfall_oracle_cockpit=1/);
assert.match(replayUrls.low, /finger_fluid_truth_scene=waterfall_resolution_oracle/);
assert.match(replayUrls.high, /finger_fluid_truth_scene=waterfall_resolution_oracle/);
assert.match(replayUrls.low, /finger_fluid_oracle_resolution=baseline/);
assert.match(replayUrls.high, /finger_fluid_oracle_resolution=high/);
assert.match(replayUrls.low, /finger_fluid_particle_count=12288/);
assert.match(replayUrls.high, /finger_fluid_particle_count=98304/);
assert.match(replayUrls.low, /finger_fluid_oracle_replay=wet-sheet-0719-low/);
assert.match(replayUrls.high, /finger_fluid_oracle_replay=wet-sheet-0719-high/);

assert.match(indexSource, /finger-fluid-oracle-cockpit\.js/, 'app shell imports the cockpit sidecar module');
assert.match(indexSource, /finger-fluid-oracle-cockpit-panel/, 'app shell provides compact cockpit markup');
assert.match(indexSource, /kaminosFingerFluidOracleCockpitDebugState/, 'app exposes cockpit route/config debug state');
assert.match(indexSource, /restartFingerFluidBenchForOracleCockpit/, 'structural cockpit edits restart the bench explicitly');
assert.doesNotMatch(indexSource, /FINGER_FLUID_ORACLE_COCKPIT_ADAPTER\.presets\.standard/, 'fixed-camera control must reference an actual oracle preset');
assert.doesNotMatch(indexSource, /waterfall oracle accepted|physical acceptance|continuous sheet accepted/i, 'cockpit text must not claim physical acceptance');

console.log('finger fluid oracle cockpit contracts passed');
