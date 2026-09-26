import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Confinement mode (flame-doctor slice 3): retire the Curl slider as the driver
// of vorticity confinement and thermal expansion under an opt-in mode, keep the
// legacy Curl-driven expressions byte-identical for saved basins, and add an
// enstrophy readout to the residual probe so a confinement level can be
// calibrated against a measured quantity instead of a look.

const core = await import('../volume-core.js');
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

function mainKernel() {
  const start = source.indexOf('\nfn cs(@builtin(global_invocation_id) gid: vec3<u32>) {');
  assert.notEqual(start, -1, 'main sim kernel is located');
  const end = source.indexOf('\n@compute', start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

test('resolveConfinementConfig keeps the Curl-driven law by default and byte-compatible', () => {
  assert.equal(typeof core.resolveConfinementConfig, 'function');
  assert.deepEqual(core.CONFINEMENT_MODE_VALUES, ['curl-slider', 'calibrated', 'off']);
  const legacy = core.resolveConfinementConfig({ curl: 4, advectionScheme: 'legacy' });
  assert.equal(legacy.effective.mode, 'curl-slider');
  assert.equal(legacy.effective.curlDrives, true);
  assert.ok(Math.abs(legacy.effective.confinementAmount - (0.034 + 4 * 0.044)) < 1e-12, 'confinement floor plus Curl gain, as the shader has always computed it');
  assert.equal(legacy.effective.confinementWeighting, 'material');
  assert.ok(Math.abs(legacy.effective.thermalExpansionAmount - (0.048 + 4 * 0.019)) < 1e-12);
  assert.equal(legacy.effective.reason, null);
  const unknown = core.resolveConfinementConfig({ confinement: 'bogus', curl: 1 });
  assert.equal(unknown.effective.mode, 'curl-slider');
  assert.match(unknown.effective.reason, /unknown/);
});

test('calibrated mode takes its epsilon from the scheme table, not from Curl, and drops the material weighting', () => {
  assert.equal(typeof core.CONFINEMENT_CALIBRATED_EPSILON, 'object');
  for (const scheme of ['legacy', 'undamped', 'maccormack-velocity', 'maccormack']) {
    assert.equal(typeof core.CONFINEMENT_CALIBRATED_EPSILON[scheme], 'number', `calibrated epsilon declared for ${scheme}`);
    const low = core.resolveConfinementConfig({ confinement: 'calibrated', curl: 0, advectionScheme: scheme });
    const high = core.resolveConfinementConfig({ confinement: 'calibrated', curl: 4, advectionScheme: scheme });
    assert.equal(low.effective.mode, 'calibrated');
    assert.equal(low.effective.curlDrives, false);
    assert.equal(low.effective.confinementAmount, core.CONFINEMENT_CALIBRATED_EPSILON[scheme]);
    assert.equal(high.effective.confinementAmount, low.effective.confinementAmount, 'Curl no longer moves confinement');
    assert.equal(low.effective.confinementWeighting, 'uniform');
    assert.equal(low.effective.thermalExpansionAmount, core.THERMAL_EXPANSION_BASELINE, 'thermal expansion is decoupled from Curl');
    assert.equal(high.effective.thermalExpansionAmount, core.THERMAL_EXPANSION_BASELINE);
    assert.equal(low.effective.calibration.scheme, scheme);
    assert.equal(low.effective.calibration.measured, core.CONFINEMENT_CALIBRATED_MEASURED_SCHEMES.includes(scheme), `the receipt says whether ${scheme} was measured or inherited`);
  }
  assert.deepEqual([...core.CONFINEMENT_CALIBRATED_MEASURED_SCHEMES], ['undamped', 'maccormack-velocity'], 'only the schemes the sweep ran count as measured');
  assert.match(core.CONFINEMENT_CALIBRATION_STATUS, /provisional/, 'the status names the table a provisional choice, not a demonstrated physical level');
  assert.doesNotMatch(source, /only compensates the scheme's numerical loss/, 'source text no longer claims demonstrated loss compensation');
  assert.doesNotMatch(index, /injects no authored curl energy/, 'help text no longer claims isolated injection');
  assert.ok(core.CONFINEMENT_CALIBRATED_EPSILON['maccormack-velocity'] < core.CONFINEMENT_CALIBRATED_EPSILON.legacy, 'the provisional table orders the second-order schemes below first-order');
});

test('off mode removes confinement and keeps the decoupled expansion baseline', () => {
  const off = core.resolveConfinementConfig({ confinement: 'off', curl: 4, advectionScheme: 'maccormack' });
  assert.equal(off.effective.mode, 'off');
  assert.equal(off.effective.confinementAmount, 0);
  assert.equal(off.effective.curlDrives, false);
  assert.equal(off.effective.thermalExpansionAmount, core.THERMAL_EXPANSION_BASELINE);
});

test('an epsilon override is an evidence route: honored only in calibrated mode and named in the receipt', () => {
  const overridden = core.resolveConfinementConfig({ confinement: 'calibrated', curl: 2, advectionScheme: 'maccormack-velocity' }, { epsilonOverride: 0.0125 });
  assert.equal(overridden.effective.confinementAmount, 0.0125);
  assert.equal(overridden.effective.calibration.epsilonOverride, 0.0125);
  assert.equal(overridden.effective.calibration.source, 'override');
  const ignored = core.resolveConfinementConfig({ confinement: 'curl-slider', curl: 2 }, { epsilonOverride: 0.0125 });
  assert.ok(Math.abs(ignored.effective.confinementAmount - (0.034 + 2 * 0.044)) < 1e-12, 'the Curl-driven law ignores the override');
  const bad = core.resolveConfinementConfig({ confinement: 'calibrated', advectionScheme: 'maccormack' }, { epsilonOverride: -1 });
  assert.equal(bad.effective.calibration.source, 'table', 'a negative or non-finite override is rejected, not clamped');
  assert.match(source, /setConfinementEpsilonOverride\(value\)/, 'the prototype exposes the override as a debug API');
  assert.match(source, /confinementEpsilonOverride: /, 'the receipt names the override');
});

test('the shader branches on the mode uniform and keeps the legacy expressions byte-identical', () => {
  const main = mainKernel();
  assert.match(source, /uniforms\[345\] = confinementModeUniformValue\(confinementConfig\.effective\.mode\);/, 'mode packed at slot 345');
  assert.match(source, /uniforms\[346\] = confinementConfig\.effective\.confinementAmount;/, 'confinement amount packed at slot 346');
  assert.match(source, /uniforms\[347\] = confinementConfig\.effective\.thermalExpansionAmount;/, 'thermal expansion amount packed at slot 347');
  assert.match(main, /let confinementMode = u\.reserved_source_extension_0\.y;/, 'main kernel reads the mode');
  assert.match(main, /vorticityConfinement\(cellI, 0\.034 \+ curl \* 0\.044\)/, 'Curl-driven confinement amount survives unchanged');
  assert.match(main, /\* \(0\.35 \+ smoke \* 0\.34 \+ heat \* 0\.52\)/, 'Curl-driven material weighting survives unchanged');
  assert.match(main, /vorticityConfinement\(cellI, u\.reserved_source_extension_0\.z\)/, 'calibrated confinement takes the uniform epsilon');
  assert.doesNotMatch(main, /vorticityConfinement\(cellI, u\.reserved_source_extension_0\.z\)\s*\*\s*\(0\.35/, 'calibrated confinement is uniform, not material weighted');
  assert.match(main, /thermalExpansionForce\(cellI, heat, select\(u\.reserved_source_extension_0\.w, 0\.048 \+ curl \* 0\.019, confinementMode < 0\.5\)\)/, 'thermal expansion is Curl-driven only under the legacy mode');
  assert.equal((source.match(/vel = vel \+ confinement/g) || []).length, 1, 'confinement is added to the velocity exactly once');
});

test('the residual probe also reduces enstrophy so confinement can be calibrated against a measurement', () => {
  assert.equal(core.PRESSURE_RESIDUAL_FLOATS_PER_WORKGROUP, 12, 'three vec4 partials per workgroup: compact, wide, vorticity');
  const reduce = source.slice(source.indexOf('fn pressureResidualReduce('), source.indexOf('fn csPressureResidualBefore('));
  assert.match(reduce, /let omega = curlAtCell\(vec3<i32>\(gid\)\);/, 'vorticity sampled at the cell');
  assert.match(reduce, /dot\(omega, omega\)/, 'enstrophy accumulates |omega|^2');
  assert.match(reduce, /let partialIndex = 3u \* \(/, 'partial stride is three vec4');
  assert.match(reduce, /pressureResidualPartials\[partialIndex \+ 2u\] = vec4<f32>\(enstrophySum, vorticityPeak, 0\.0, 0\.0\);/, 'vorticity partial written by the before pass');
  assert.match(source, /vorticity: \{\s*identity: 'enstrophy-before-projection-v0',/, 'CPU reduction exports the vorticity readout');
  assert.match(source, /enstrophyMean: enstrophySum \/ cells/, 'enstrophy is reported per cell');
});

test('receipt, cockpit, schema and layout carry the confinement mode', () => {
  assert.match(source, /state\.confinement = \{\s*\.\.\.confinementConfig,\s*uniform: \{ mode: uniforms\[345\], confinementAmount: uniforms\[346\], thermalExpansionAmount: uniforms\[347\] \},/, 'runtime receipt records the packed values');
  assert.equal((source.match(/^\s*confinement: state\.confinement,$/gm) || []).length, 2, 'debugState exports the receipt on both routes');
  assert.match(index, /<select id="volume-confinement"[^>]*data-volume-settings-param="volume_confinement"[^>]*>[^]*?<option value="curl-slider" selected>[^]*?<option value="calibrated">[^]*?<option value="off">/, 'Confinement select with the three modes, default curl-slider');
  assert.match(index, /\['confinement', 'volume_confinement'\]/, 'route field');
  assert.match(index, /confinement: document\.getElementById\('volume-confinement'\)\.value,/, 'controls read the mode');
  assert.match(index, /document\.getElementById\('volume-confinement-val'\)\.textContent = /, 'label renders the effective mode');
  assert.match(index, /document\.getElementById\('volume-curl-val'\)\.textContent = confinementConfig\.effective\.curlDrives/, 'the Curl label says when Curl no longer drives confinement');
  assert.match(index, /\['volume-confinement', 'volume_confinement'\],/, 'route param applies the mode');
  assert.match(index, /'volume-advection-scheme',\s*\n\s*'volume-confinement',/, 'live listener registered next to the scheme');
  assert.match(layout, /advection-scheme\|confinement\|/, 'Simulation dynamics layout group owns the control');
  const control = schema.controls.find(entry => entry.key === 'volume-confinement');
  assert.ok(control, 'schema declares volume-confinement');
  assert.equal(control.param, 'volume_confinement');
  assert.equal(control.additiveDefault, 'curl-slider');
  assert.deepEqual(control.allowedValues, ['curl-slider', 'calibrated', 'off']);
  assert.equal(control.additiveSinceControlCount, 215);
  assert.ok(schema.controlCount >= 215 && schema.controls.length === schema.controlCount, 'the schema count is at least the confinement addition and consistent');
});

test('the arm capture records confinement and enstrophy in its receipt', () => {
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /confinement: s\.confinement\?\.effective \?\? null/, 'effective confinement in the arm receipt');
  assert.match(capture, /vorticity: s\.pressureSolver\?\.residual\?\.vorticity \?\? null/, 'enstrophy readout in the arm receipt');
  assert.match(capture, /volume-confinement/, 'requested-vs-effective check covers the confinement mode');
  assert.match(capture, /confinementUniform: s\.confinement\?\.uniform \?\? null/, 'the packed uniform is recorded');
  assert.match(capture, /observed !== Math\.fround\(Number\(value\)\)/, 'the packed epsilon is compared as float32 against the request');
  assert.match(capture, /null override: packed epsilon/, 'a null override must return to the table value in calibrated mode');
  assert.match(capture, /stale residual: probe step/, 'an arm needs a residual probe newer than its switch');
  assert.match(capture, /\['arm-error', 'packed-epsilon', 'stale-residual', 'null-mode-drift'\]/, 'every failure path has a fault case');
  assert.match(capture, /effectiveMismatches\(arm, end, expectedMode\)/, 'the expected confinement mode is carried across arms');
  assert.match(capture, /confinement mode drifted: expected/, 'an override-only arm must end in the expected mode');
});
