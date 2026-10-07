import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

// Immersed source (report section 31): an authored disc anywhere in the volume,
// in any direction, entering gas as a divergence target the converged solve
// honours, a momentum relaxation toward the authored direction, and scalar
// entry with the created volume — three terms from one flux number.
const base = { emitterSourceLaw: 'immersed-source', pressureSolver: 'converged-open-top', immersedCentreX: 0, immersedCentreY: -0.5, immersedCentreZ: 0, immersedYaw: 0, immersedPitch: 90, immersedRadius: 0.2, immersedThickness: 1.5, immersedSpeed: 0.1, immersedFuel: 0.56, immersedTemperature: 1.2, immersedMomentumGain: 1, immersedCapFraction: 0.5 };

test('the immersed source resolves from the controls and is admitted only under a dispatched converged solve with its source law', () => {
  const on = core.resolveImmersedSourceConfig(base, { grid: 64 });
  assert.equal(on.identity, 'kaminos.volume.immersed-source.v1');
  assert.equal(on.effective.admitted, true);
  assert.deepEqual(on.effective.direction.map(v => Number(v.toFixed(6))), [0, 1, 0], 'pitch 90 points up');
  assert.deepEqual(on.effective.centreCells.map(v => Number(v.toFixed(3))), [32, 16, 32], 'normalised centre to cell coordinates on a 64 grid');
  assert.equal(Number(on.effective.radiusCells.toFixed(3)), 6.4, 'radius 0.2 of the half-domain is 6.4 cells on 64');
  assert.ok(Math.abs(on.effective.analyticVolume - Math.PI * 6.4 * 6.4 * 1.5) < 1e-9, 'π r² t in cells³ kept for reference');
  assert.ok(on.effective.normaliser > on.effective.analyticVolume && on.effective.normaliser < 1.2 * on.effective.analyticVolume, 'the normaliser is the discrete weight sum, a little over the analytic volume');
  assert.ok(Math.abs(on.effective.fluxRequested - 0.1 * Math.PI * 6.4 * 6.4) < 1e-9, 'Q = v π r² at puff 1');
  assert.equal(core.resolveImmersedSourceConfig({ ...base, emitterSourceLaw: 'inflow-boundary' }, { grid: 64 }).effective.reason, 'source-law-is-not-immersed-source');
  assert.equal(core.resolveImmersedSourceConfig({ ...base, pressureSolver: 'legacy' }, { grid: 64 }).effective.reason, 'immersed-source-requires-converged-pressure-solver');
  assert.equal(core.resolveImmersedSourceConfig({ ...base, pressureSolver: 'converged' }, { grid: 64 }).effective.admitted, true, 'closed top is fine: the source needs the target, not the top');
  assert.match(core.resolveImmersedSourceConfig({ ...base, pressureIterations: 0 }, { grid: 64 }).effective.reason, /^immersed-source-requires-pressure-projection-dispatch/);
  const side = core.resolveImmersedSourceConfig({ ...base, immersedYaw: 90, immersedPitch: 0 }, { grid: 64 });
  assert.deepEqual(side.effective.direction.map(v => Number(v.toFixed(6))), [0, 0, 1], 'yaw 90 pitch 0 points along +z');
  const puffed = core.resolveImmersedSourceConfig(base, { grid: 64, puffFactor: 0.5 });
  assert.ok(Math.abs(puffed.effective.fluxRequested - 0.05 * Math.PI * 6.4 * 6.4) < 1e-9, 'puff scales the flux');
});

test('the uniform block follows velocity staggering and packs the compiled source only when admitted', () => {
  assert.equal(core.IMMERSED_SOURCE_UNIFORM_OFFSET, core.VELOCITY_STAGGERING_UNIFORM_OFFSET + 4);
  assert.equal(core.IMMERSED_SOURCE_UNIFORM_FLOATS, 16);
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.IMMERSED_SOURCE_UNIFORM_OFFSET + 16);
  const on = core.resolveImmersedSourceConfig(base, { grid: 64 });
  const u = core.immersedSourceUniformValues(on);
  assert.equal(u.length, 16);
  assert.deepEqual(u.slice(0, 4).map(v => Number(v.toFixed(3))), [1, 32, 16, 32], 'enabled + centre in cells');
  assert.deepEqual(u.slice(4, 8).map(v => Number(v.toFixed(3))), [0, 1, 0, 6.4], 'direction + radius in cells');
  assert.deepEqual(u.slice(8, 12).map(v => Number(v.toFixed(3))), [1.5, 0.1, 0.56, 1.2], 'thickness, speed, fuel, temperature');
  assert.equal(Number(u[12].toFixed(3)), 1, 'momentum gain');
  assert.ok(Math.abs(u[13] - on.effective.capPerCell) < 1e-12, 'cap per cell');
  assert.ok(Math.abs(u[14] - on.effective.fluxRequested / on.effective.normaliser) < 1e-12, 'target per unit weight = Q / Σw');
  assert.deepEqual(core.immersedSourceUniformValues(core.resolveImmersedSourceConfig({ ...base, pressureSolver: 'legacy' }, { grid: 64 })), new Array(16).fill(0));
  assert.match(source, /velocity_staggering: vec4<f32>,\n(?:\s*\/\/[^\n]*\n)*\s*immersed_source_a: vec4<f32>,\s*immersed_source_b: vec4<f32>,\s*immersed_source_c: vec4<f32>,\s*immersed_source_d: vec4<f32>,/);
});

test('the CPU weight model mirrors the shader: an antialiased slab, normalised to π r² t within a few percent, and the per-cell cap predicts clipping', () => {
  const on = core.resolveImmersedSourceConfig(base, { grid: 64 });
  const w = core.immersedSourceWeights(on.effective, { grid: 64, gridHeight: 64 });
  assert.ok(w.cells.length > 0);
  assert.ok(Math.abs(w.sum - on.effective.normaliser) < 1e-9, 'the normaliser is this sum, so Σ target = Q');
  assert.ok(Math.abs(w.sum / on.effective.analyticVolume - 1) < 0.15, `Σw ${w.sum} vs π r² t ${on.effective.analyticVolume}`);
  const centre = w.cells.find(c => c.x === 32 && c.y === 16 && c.z === 32);
  assert.ok(centre && centre.w > 0.8, 'the cell at the centre is nearly fully inside (centres sit at integer + 0.5, half a cell off the authored centre)');
  assert.ok(!w.cells.some(c => Math.hypot(c.x + 0.5 - 32, c.z + 0.5 - 32) > 6.4 + 1.5 && c.w > 0), 'nothing outside the antialias skirt');
  assert.ok(!w.cells.some(c => Math.abs(c.y + 0.5 - 16) > 0.75 + 1 && c.w > 0), 'the slab is thin along the direction');
  // Sideways: the slab stands up.
  const side = core.resolveImmersedSourceConfig({ ...base, immersedYaw: 0, immersedPitch: 0 }, { grid: 64 });
  const ws = core.immersedSourceWeights(side.effective, { grid: 64, gridHeight: 64 });
  assert.ok(ws.cells.some(c => c.y === 20) && ws.cells.some(c => c.y === 12), 'extends vertically when aimed along +x');
  assert.ok(!ws.cells.some(c => Math.abs(c.x + 0.5 - 32) > 1.75 && c.w > 0), 'thin along +x');
  // Cap: a tiny radius concentrates the flux and the model predicts clipping.
  const tight = core.resolveImmersedSourceConfig({ ...base, immersedRadius: 0.02, immersedSpeed: 1, immersedCapFraction: 0.1 }, { grid: 64 });
  assert.ok(tight.effective.clipPredicted.cells > 0, 'clipping predicted');
  assert.ok(tight.effective.fluxEffectivePredicted < tight.effective.fluxRequested, 'effective supply below requested when the cap acts');
  assert.equal(on.effective.clipPredicted.cells, 0, 'the default source is not clipped');
  assert.ok(Math.abs(on.effective.fluxEffectivePredicted - on.effective.fluxRequested) < 1e-9);
});

test('the shader derives target, momentum and scalar entry from one weight and one flux, caps the target, and stores it beside heat release', () => {
  const weight = source.slice(source.indexOf('fn immersedSourceWeight('), source.indexOf('\n}\n', source.indexOf('fn immersedSourceWeight(')));
  assert.match(weight, /let along = dot\(d, n\);/);
  assert.match(weight, /smoothstep\(halfThickness \+ 0\.5, halfThickness - 0\.5, abs\(along\)\)/);
  assert.match(weight, /smoothstep\(radius \+ 0\.5, radius - 0\.5, radial\)/);
  const main = source.slice(source.indexOf('\nfn cs(@builtin'), source.indexOf('\nfn ', source.indexOf('\nfn cs(@builtin') + 10));
  assert.match(main, /let immersedWeight = immersedSourceWeight\(cell\);/);
  assert.match(main, /let immersedTarget = min\(u\.immersed_source_d\.y, immersedWeight \* u\.immersed_source_d\.z\);/, 'target per cell = min(cap, w × Q/Σw)');
  assert.match(main, /textureStore\(burnRate, cellI, vec4<f32>\(u\.heat_release\.x \* fuelBurned \/ max\(timeStep, 1e-6\) \+ immersedTarget, 0\.0, 0\.0, 0\.0\)\);/, 'stored beside heat release');
  assert.match(main, /let immersedEntry = clamp\(immersedTarget \* dynamicsBacktraceScale\(\), 0\.0, 1\.0\);/, 'scalar entry mirrors the floor law');
  assert.match(main, /heat = mix\(heat, u\.immersed_source_c\.w, immersedEntry\);/);
  assert.match(main, /fuel = mix\(fuel, u\.immersed_source_c\.z, immersedEntry\);/);
  assert.match(main, /vel = mix\(vel, u\.immersed_source_c\.y \* immersedDirection\(\), min\(1\.0, immersedWeight \* u\.immersed_source_d\.x\)\);/, 'momentum relaxes toward v·n (velocity-dependent: stays local under the staggered reading)');
  assert.doesNotMatch(main, /centredForce = centredForce \+ [^\n]*immersed/, 'not averaged onto faces');
});

test('cockpit: the source law option, eleven bench rows with help, snapshot, listeners, route restore, receipt; schema 236–246', () => {
  assert.match(index, /<option value="immersed-source">Immersed source \(anywhere, any direction\)<\/option>/);
  const ids = ['volume-immersed-centre-x', 'volume-immersed-centre-y', 'volume-immersed-centre-z', 'volume-immersed-yaw', 'volume-immersed-pitch', 'volume-immersed-radius', 'volume-immersed-thickness', 'volume-immersed-speed', 'volume-immersed-fuel', 'volume-immersed-temperature', 'volume-immersed-momentum-gain', 'volume-immersed-cap-fraction'];
  const keys = { 'volume-immersed-centre-x': 'immersedCentreX', 'volume-immersed-centre-y': 'immersedCentreY', 'volume-immersed-centre-z': 'immersedCentreZ', 'volume-immersed-yaw': 'immersedYaw', 'volume-immersed-pitch': 'immersedPitch', 'volume-immersed-radius': 'immersedRadius', 'volume-immersed-thickness': 'immersedThickness', 'volume-immersed-speed': 'immersedSpeed', 'volume-immersed-fuel': 'immersedFuel', 'volume-immersed-temperature': 'immersedTemperature', 'volume-immersed-momentum-gain': 'immersedMomentumGain', 'volume-immersed-cap-fraction': 'immersedCapFraction' };
  const init = index.slice(index.indexOf('async function initKaminosVolumeRoute()'), index.indexOf('\n}\n', index.indexOf('async function initKaminosVolumeRoute()')));
  const listenerList = index.slice(index.indexOf("'volume-emitter-source-law',"), index.indexOf("'volume-wind-gust-veer',") + 1200);
  for (const id of ids) {
    assert.match(index, new RegExp(`<input type="range" id="${id}" data-volume-settings-param="${id.replace(/-/g, '_')}"`), `${id} row`);
    assert.match(index, new RegExp(`${keys[id]}: parseFloat\\(document\\.getElementById\\('${id}'\\)\\.value\\)`), `${id} snapshot`);
    assert.match(index, new RegExp(`getElementById\\('${id}-val'\\)\\.textContent = `), `${id} value`);
    assert.ok(listenerList.includes(`'${id}',`), `${id} listener`);
    assert.match(init, new RegExp(`VOLUME_ROUTE_RESTORED_CONTROL_IDS = \\[[^\\]]*'${id}'`), `${id} restored`);
  }
  assert.match(index, /id="volume-immersed-source-state"/, 'receipt field');
  assert.match(index, /immersed — NOT ADMITTED \(\$\{/, 'a refused source is named');
  assert.match(index, /requested \$\{[^}]*fluxRequested[^}]*\} · effective \$\{[^}]*fluxEffectivePredicted/, 'receipt shows requested vs effective supply');
  const expected = ids.map((id, i) => ({ key: id, param: id.replace(/-/g, '_'), tagName: 'INPUT', type: 'range', additiveSinceControlCount: 235 + i + 1 }));
  for (const e of expected) {
    const control = schema.controls.find(c => c.key === e.key);
    assert.ok(control, `${e.key} in schema`);
    assert.equal(control.additiveSinceControlCount, e.additiveSinceControlCount);
    assert.ok('additiveDefault' in control);
  }
  assert.equal(schema.controlCount, 247);
  assert.equal(schema.controls.length, 247);
});
