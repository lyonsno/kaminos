import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const wgslFunction = name => { const start = source.indexOf(`fn ${name}(`); return source.slice(start, source.indexOf('\n}\n', start)); };

test('heat release resolves from the controls and is admitted only under a dispatched converged open-top solve', () => {
  const off = core.resolveHeatReleaseConfig({});
  assert.equal(off.requested.expansion, 0);
  assert.deepEqual(off.effective, { admitted: false, expansion: 0, reason: 'heat-release-expansion-is-zero' });
  const legacy = core.resolveHeatReleaseConfig({ heatReleaseExpansion: 1 });
  assert.equal(legacy.effective.admitted, false);
  assert.equal(legacy.effective.reason, 'heat-release-requires-converged-open-top-pressure-solver');
  const closed = core.resolveHeatReleaseConfig({ heatReleaseExpansion: 1, pressureSolver: 'converged' });
  assert.equal(closed.effective.reason, 'heat-release-requires-converged-open-top-pressure-solver', 'a closed top cannot absorb the net volume');
  const noDispatch = core.resolveHeatReleaseConfig({ heatReleaseExpansion: 1, pressureSolver: 'converged-open-top', projection: 0 });
  assert.match(noDispatch.effective.reason, /^heat-release-requires-pressure-projection-dispatch:/);
  const on = core.resolveHeatReleaseConfig({ heatReleaseExpansion: 1.5, pressureSolver: 'converged-open-top', projection: 1 });
  assert.deepEqual(on.effective, { admitted: true, expansion: 1.5, reason: null });
  assert.equal(core.resolveHeatReleaseConfig({ heatReleaseExpansion: 9, pressureSolver: 'converged-open-top' }).requested.expansion, 3, 'gain clamps to [0, 3]');
  assert.equal(core.resolveHeatReleaseConfig({ heatReleaseExpansion: -1, pressureSolver: 'converged-open-top' }).effective.admitted, false);
});

test('the heat-release uniform follows the inflow block and packs the gain only when admitted', () => {
  assert.equal(core.HEAT_RELEASE_UNIFORM_OFFSET, core.INFLOW_UNIFORM_OFFSET + core.INFLOW_UNIFORM_FLOATS);
  assert.equal(core.HEAT_RELEASE_UNIFORM_FLOATS, 4);
  assert.equal(core.VELOCITY_STAGGERING_UNIFORM_OFFSET, core.HEAT_RELEASE_UNIFORM_OFFSET + 4, 'the velocity-staggering block follows');
  assert.equal(core.VOLUME_UNIFORM_FLOATS % 4, 0);
  assert.deepEqual(core.heatReleaseUniformValues(core.resolveHeatReleaseConfig({ heatReleaseExpansion: 1.5, pressureSolver: 'converged-open-top' })), [1.5, 0, 0, 0]);
  assert.deepEqual(core.heatReleaseUniformValues(core.resolveHeatReleaseConfig({ heatReleaseExpansion: 1.5 })), [0, 0, 0, 0], 'a refused expansion packs zero: the legacy solve never sees a source');
  assert.match(source, /heat_release: vec4<f32>,/, 'the uniform struct carries the block');
  assert.match(source, /uniforms\.set\(heatReleaseUniformValues\(heatReleaseConfig\), HEAT_RELEASE_UNIFORM_OFFSET\);\s*\n\s*state\.heatRelease = heatReleaseConfig;/, 'packed each frame and receipted');
});

test('cockpit: the expansion gain is a control with help, restored from routes, receipted, additive 234', () => {
  assert.match(index, /<input type="range" id="volume-heat-release-expansion" data-volume-settings-param="volume_heat_release_expansion" min="0" max="3" step="any" value="0">/);
  assert.match(index, /heatReleaseExpansion: parseFloat\(document\.getElementById\('volume-heat-release-expansion'\)\.value\)/);
  assert.match(index, /getElementById\('volume-heat-release-expansion-val'\)\.textContent = /);
  const listenerList = index.slice(index.indexOf("'volume-emitter-source-law',"), index.indexOf("'volume-wind-gust-veer',") + 400);
  assert.ok(listenerList.includes("'volume-heat-release-expansion',"), 'change listener');
  const init = index.slice(index.indexOf('async function initKaminosVolumeRoute()'), index.indexOf('\n}\n', index.indexOf('async function initKaminosVolumeRoute()')));
  assert.match(init, /VOLUME_ROUTE_RESTORED_CONTROL_IDS = \[[^\]]*'volume-heat-release-expansion'/, 'restored from a saved route');
  const rowEnd = index.indexOf('</div>', index.indexOf('id="volume-heat-release-expansion"'));
  assert.match(index.slice(rowEnd, rowEnd + 400), /^<\/div>\s*<span class="slider-help">/, 'help follows the row');
  assert.match(index, /id="volume-heat-release-state"/, 'receipt field');
  assert.match(index, /heat-release — NOT ADMITTED \(\$\{/, 'a refused expansion is named');
  const control = schema.controls.find(c => c.key === 'volume-heat-release-expansion');
  assert.deepEqual(control, { key: 'volume-heat-release-expansion', param: 'volume_heat_release_expansion', tagName: 'INPUT', type: 'range', additiveDefault: 0, additiveSinceControlCount: 234 });
  assert.equal(schema.controlCount, schema.controls.length);
});

test('the residual probe names what it measures once expansion is active (review HR-02)', () => {
  const offMeasure = core.pressureResidualMeasurement({ effective: { admitted: false, expansion: 0, reason: 'heat-release-expansion-is-zero' } });
  assert.deepEqual(offMeasure, { compact: 'divergence', wide: 'legacy-central-divergence', targets: [], heatRelease: { admitted: false, expansion: 0 }, immersedSource: { admitted: false, fluxRequested: 0, fluxEffectivePredicted: 0, capPerCell: 0, clipPredicted: { cells: 0, of: 0 }, law: null }, statement: 'compact = |D(v)| on the compact operator; heat-release expansion and immersed source off' });
  const onMeasure = core.pressureResidualMeasurement({ effective: { admitted: true, expansion: 1.5, reason: null } });
  assert.equal(onMeasure.compact, 'divergence-minus-expansion-target');
  assert.deepEqual(onMeasure.heatRelease, { admitted: true, expansion: 1.5 });
  assert.match(onMeasure.statement, /D\(v\) − S/);
  assert.match(onMeasure.statement, /gain 1\.5/);
  assert.deepEqual(core.pressureResidualMeasurement(null).heatRelease, { admitted: false, expansion: 0 }, 'a missing receipt reads as off');
  // The readback carries the measurement alongside the numbers, and the capture passes it through.
  const residualBlock = source.slice(source.indexOf("identity: 'pressure-divergence-residual-probe-v1'"), source.indexOf('measuredAtMs:', source.indexOf("identity: 'pressure-divergence-residual-probe-v1'")));
  assert.match(residualBlock, /\n\s+measurement,\n/, 'the readback publishes the copy-time snapshot');
  assert.match(source, /pressureResidualCopyMeasurement = pressureResidualMeasurement\(state\.heatRelease, state\.immersedSource, state\.immersedSources\);/, 'snapshot taken where the copy is encoded, both targets');
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /residualMeasurement: s\.pressureSolver\.residual\.measurement \?\? null/, 'the capture probe carries the measurement');
  assert.match(capture, /residualMeasurement: end\.residual\?\.residualMeasurement \?\? null/, 'the arm report records it');
  // The cockpit says so too: the receipt and both help texts.
  assert.match(index, /admitted · gain \$\{heatRelease\.effective\.expansion\.toFixed\(2\)\} · residual measures D\(v\) − S/, 'receipt names the residual meaning');
  const solverHelp = index.slice(index.indexOf('Legacy keeps the damped 1-3 pass Jacobi'), index.indexOf('</span>', index.indexOf('Legacy keeps the damped 1-3 pass Jacobi')));
  assert.match(solverHelp, /When Heat release is above 0 the converged solve targets that expansion instead of zero: at gain 1\.0 the divergence converges to the target S, and a partial projection leaves \(1 − gain\) × D\(v_before\) \+ gain × S/);
  const heatHelp = index.slice(index.indexOf('Expansion where fuel burns:'), index.indexOf('</span>', index.indexOf('Expansion where fuel burns:')));
  assert.match(heatHelp, /residual readout then measures divergence minus that target/);
  assert.match(heatHelp, /Heat and smoke are carried undiluted through the expansion, so their field totals grow with the gain and are not conservation evidence/);
});

test('the residual measurement is the heat-release context at probe-copy time, not at readback (confirmation 1, HR-02)', async () => {
  // Runs the actual probe functions with a deferred mapAsync: the heat-release
  // configuration changes between the copy and the readback, and the published
  // measurement must describe the configuration the probed numbers came from.
  const vm = await import('node:vm');
  const start = source.indexOf('  function finishPressureResidualProbe(');
  const end = source.indexOf('  function encodePressureProjection(', start);
  assert.ok(start > 0 && end > start, 'probe functions located');
  const run = async (atCopy, atReadback) => {
    let release;
    const mapped = new Promise(resolve => { release = resolve; });
    const state = { frameCount: 50, simStepCount: 48, heatRelease: atCopy, pressureSolver: { effective: { solver: 'converged', openTop: true } } };
    const context = {
      state, gridSize: 4, gridHeight: 4,
      pressureResidualCopyPending: false, pressureResidualMapPending: false, pressureResidualMapStartedFrame: 0, pressureResidualMapGeneration: 0,
      pressureResidualWorkgroupCount: 1, pressureResidualCopyStep: 0, pressureResidualCopyFrame: 0, pressureResidualCopyFluidCells: 0, pressureResidualCopySolver: null, pressureResidualCopyMeasurement: null,
      pressureResidualAfterPipeline: {}, pressureResidualBindGroup: {}, pressureResidualPartialsBuffer: {}, fluidBindGroup: () => ({}),
      pressureResidualReadbackBuffer: { mapAsync: () => mapped, getMappedRange: () => new Float32Array(16).buffer, unmap() {} },
      GPUMapMode: { READ: 1 }, setTimeout, clearTimeout, Float32Array, performance, Math, Number, Promise, Error,
      PRESSURE_RESIDUAL_MAP_TIMEOUT_MS: 10000, PRESSURE_RESIDUAL_MAP_TIMEOUT_ERROR: 'synthetic-timeout', PRESSURE_RESIDUAL_FLOATS_PER_WORKGROUP: 16,
      gridCellCount: grid => grid ** 3, gridHeightForSize: grid => grid, pressureResidualMeasurement: core.pressureResidualMeasurement, residualProfileFromPartials: core.residualProfileFromPartials,
    };
    const encoder = { beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), copyBufferToBuffer() {} };
    context.encoder = encoder;
    const pending = vm.runInNewContext(source.slice(start, end) + '\nfinishPressureResidualProbe(encoder);\nresolvePressureResidualProbe();', context);
    state.heatRelease = atReadback;
    release();
    await pending;
    if (!state.pressureSolver.residual) throw new Error(`probe did not publish: ${JSON.stringify(state.pressureSolver)}`);
    return state.pressureSolver.residual.measurement;
  };
  const on1 = { effective: { admitted: true, expansion: 1, reason: null } };
  const on2 = { effective: { admitted: true, expansion: 2, reason: null } };
  const off = { effective: { admitted: false, expansion: 0, reason: 'heat-release-expansion-is-zero' } };
  assert.deepEqual(await run(on1, off), core.pressureResidualMeasurement(on1), 'on at copy, off at readback: keeps on');
  assert.deepEqual(await run(off, on1), core.pressureResidualMeasurement(off), 'off at copy, on at readback: keeps off');
  assert.deepEqual(await run(on1, on2), core.pressureResidualMeasurement(on1), 'gain 1 at copy, gain 2 at readback: keeps gain 1');
});
