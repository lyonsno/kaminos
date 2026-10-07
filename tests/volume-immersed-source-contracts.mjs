import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import { effectiveMismatches } from '../volume-arm-capture-checks.mjs';

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
  assert.equal(core.resolveImmersedSourceConfig({ ...base, pressureSolver: 'converged' }, { grid: 64 }).effective.reason, 'immersed-source-requires-open-top-pressure-solver', 'a positive supply needs the open top as its outlet (IS-02)');
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
  assert.match(weight, /\(1\.0 - smoothstep\(halfThickness - 0\.5, halfThickness \+ 0\.5, abs\(along\)\)\)/, 'ascending edges (Metal leaves reversed edges undefined)');
  assert.match(weight, /\(1\.0 - smoothstep\(radius - 0\.5, radius \+ 0\.5, radial\)\)/);
  assert.doesNotMatch(weight, /smoothstep\([a-zA-Z]+ \+ 0\.5, [a-zA-Z]+ - 0\.5/, 'no reversed-edge smoothstep');
  const main = source.slice(source.indexOf('\nfn cs(@builtin'), source.indexOf('\nfn ', source.indexOf('\nfn cs(@builtin') + 10));
  assert.match(main, /let immersedWeight = immersedSourceWeight\(cell\);/);
  assert.match(main, /let immersedTarget = min\(u\.immersed_source_d\.y, immersedWeight \* u\.immersed_source_d\.z\);/, 'target per cell = min(cap, w × Q/Σw)');
  assert.match(main, /textureStore\(burnRate, cellI, vec4<f32>\(u\.heat_release\.x \* fuelBurned \/ max\(timeStep, 1e-6\) \+ immersedTarget, 0\.0, 0\.0, 0\.0\)\);/, 'stored beside heat release');
  assert.match(main, /let immersedEntry = clamp\(immersedTarget \* dynamicsBacktraceScale\(\), 0\.0, 1\.0\);/, 'scalar entry mirrors the floor law');
  assert.match(main, /heat = mix\(heat, u\.immersed_source_c\.w, immersedEntry\);/);
  assert.match(main, /fuel = mix\(fuel, u\.immersed_source_c\.z, immersedEntry\);/);
  assert.match(main, /vel = mix\(vel, u\.immersed_source_c\.y \* immersedDirection\(\), stepBlend\(min\(1\.0, immersedWeight \* u\.immersed_source_d\.x\)\)\);/, 'momentum relaxes toward v·n through stepBlend (follows the step; velocity-dependent, so it stays local under the staggered reading)');
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
  assert.equal(schema.controlCount, 248);
  assert.equal(schema.controls.length, 248);
});

// Bounded A (report section 31, after the cold bench): a solid back disc one to
// two cells thick immediately behind the source layer, written into the
// scene-solid mask the kiln collision uses, so the projection can only expand
// the created volume forward and sideways. Toggle for the bench comparison.
test('the back wall: resolved as a toggle, its cells lie strictly behind the source slab inside the radius, and compose into a solid field', () => {
  const on = core.resolveImmersedSourceConfig(base, { grid: 64 });
  assert.deepEqual(on.effective.backWall, { requested: false, thicknessCells: 2 }, 'off by default: the bench found no measurable benefit (section 31)');
  assert.deepEqual(core.resolveImmersedSourceConfig({ ...base, immersedBackWall: 1 }, { grid: 64 }).effective.backWall, { requested: true, thicknessCells: 2 });
  const walled = core.resolveImmersedSourceConfig({ ...base, immersedBackWall: 1 }, { grid: 64 });
  const wall = core.immersedBackWallCells(walled.effective, { grid: 64, gridHeight: 128 });
  assert.ok(wall.length > 0);
  const n = on.effective.direction, c = on.effective.centreCells, r = on.effective.radiusCells, half = on.effective.thickness / 2;
  for (const cell of wall) {
    const d = [cell.x + 0.5 - c[0], cell.y + 0.5 - c[1], cell.z + 0.5 - c[2]];
    const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    const radial = Math.hypot(d[0] - along * n[0], d[1] - along * n[1], d[2] - along * n[2]);
    assert.ok(along < -half + 1e-9 && along >= -(half + 2) - 1e-9, `behind the slab: along ${along}`);
    assert.ok(radial <= r + 0.5 + 1e-9, `inside the sealed radius: ${radial}`);
  }
  // No wall cell carries source weight: the source layer and the wall are disjoint.
  const weights = core.immersedSourceWeights(on.effective, { grid: 64, gridHeight: 128 });
  const weightKeys = new Set(weights.cells.filter(w => w.w > 0.5).map(w => `${w.x},${w.y},${w.z}`));
  assert.ok(!wall.some(w => weightKeys.has(`${w.x},${w.y},${w.z}`)), 'the wall never sits on a cell that is mostly source');
  // Aimed +x the wall stands on the −x side of the disc.
  const side = core.resolveImmersedSourceConfig({ ...base, immersedPitch: 0 }, { grid: 64 });
  const sideWall = core.immersedBackWallCells(side.effective, { grid: 64, gridHeight: 128 });
  assert.ok(sideWall.every(w => w.x + 0.5 < side.effective.centreCells[0]), 'behind means −x for a +x aim');
  // Composition into the mask: zeros plus the wall, or a kiln field plus the wall.
  const composed = core.composeSolidField(null, wall, { grid: 64, gridHeight: 128 });
  assert.equal(composed.cells.length, 64 * 128 * 64);
  assert.equal(composed.addedCells, wall.length);
  assert.equal(composed.cells[wall[0].x + 64 * (wall[0].y + 128 * wall[0].z)], 1);
  const kiln = new Uint8Array(64 * 128 * 64); kiln[5] = 1; kiln[wall[0].x + 64 * (wall[0].y + 128 * wall[0].z)] = 1;
  const merged = core.composeSolidField(kiln, wall, { grid: 64, gridHeight: 128 });
  assert.equal(merged.cells[5], 1, 'the kiln is kept');
  assert.equal(merged.addedCells, wall.length - 1, 'a wall cell already solid is not counted twice');
  // The collision refresh composes the wall whether or not a kiln is requested, keyed by the source pose.
  const refresh = source.slice(source.indexOf('function refreshSceneCollision()'), source.indexOf('\n  }\n', source.indexOf('function refreshSceneCollision()') + 10));
  assert.match(refresh, /const backWall = immersedBackWallForState\(\);/);
  assert.match(refresh, /effective: 'emitter-back-wall'/, 'a wall without a kiln is its own mode');
  assert.match(refresh, /composeSolidField\(field\.cells, backWall\.cells/, 'a wall with a kiln is composed into the voxel field');
  assert.match(source, /pressureResidualCopyFluidCells = pressureResidualCopyCells - \(state\.sceneCollision\?\.solidCellCount \?\? 0\);/, 'fluid-cell count follows any solid mode, over the full grid shape');
  // Cockpit and schema.
  assert.match(index, /<input type="range" id="volume-immersed-back-wall" data-volume-settings-param="volume_immersed_back_wall" min="0" max="1" step="1" value="0">/);
  assert.match(index, /immersedBackWall: parseFloat\(document\.getElementById\('volume-immersed-back-wall'\)\.value\)/);
  const control = schema.controls.find(c => c.key === 'volume-immersed-back-wall');
  assert.deepEqual(control, { key: 'volume-immersed-back-wall', param: 'volume_immersed_back_wall', tagName: 'INPUT', type: 'range', additiveDefault: 0, additiveSinceControlCount: 248 });
  assert.equal(schema.controlCount, 248);
});

// Fresh review at 25431599 (IS-01..06).
test('IS-01: the momentum relaxation carries the time step once, after the fold', () => {
  // CPU model of the completed update for an isolated relaxation.
  for (const [w, dt, expected] of [[1, 0.5, 0.1], [1, 2, 0.1], [0.5, 0.5, 0.029289], [0.5, 2, 0.075], [0.5, 1, 0.05]]) {
    const v = core.immersedMomentumModel({ transported: 0, target: 0.1, weight: w, gain: 1, dt });
    assert.ok(Math.abs(v - expected) < 1e-5, `w ${w} dt ${dt}: ${v} vs ${expected}`);
  }
  assert.ok(Math.abs(core.immersedMomentumModel({ transported: 0.04, target: 0.1, weight: 1, gain: 0.5, dt: 1 }) - 0.07) < 1e-9, 'partial gain relaxes halfway');
  const main = source.slice(source.indexOf('\nfn cs(@builtin'), source.indexOf('\nfn ', source.indexOf('\nfn cs(@builtin') + 10));
  const foldAt = main.indexOf('let forceIncrement = (vel - velTransported) * timeStep;');
  const relaxAt = main.indexOf('vel = mix(vel, u.immersed_source_c.y * immersedDirection(), stepBlend(min(1.0, immersedWeight * u.immersed_source_d.x)));');
  const spongeAt = main.indexOf('vel = vel * stepRate(mix(0.55, 1.0, wallFade));');
  assert.ok(foldAt > 0 && relaxAt > 0 && spongeAt > 0);
  assert.ok(relaxAt > foldAt && relaxAt < spongeAt, 'the relaxation follows the fold (its stepBlend is the only time dependence) and precedes the sponge');
});

test('IS-02: positive supply needs a volume outlet — the closed-top converged solve is refused', () => {
  const closed = core.resolveImmersedSourceConfig({ ...base, pressureSolver: 'converged' }, { grid: 64 });
  assert.equal(closed.effective.admitted, false);
  assert.equal(closed.effective.reason, 'immersed-source-requires-open-top-pressure-solver');
  assert.equal(core.resolveImmersedSourceConfig({ ...base, pressureSolver: 'converged-open-top' }, { grid: 64 }).effective.admitted, true);
  assert.match(index, /immersed — NOT ADMITTED \(\$\{immersed\.effective\.reason\}\); set Pressure solver to converged open top and Projection above 0/);
});

test('IS-03: supply accounting follows the composed fluid support: the wall sits beyond the antialias skirt and solid cells are excluded from the normaliser', () => {
  const walled = core.resolveImmersedSourceConfig({ ...base, immersedBackWall: 1 }, { grid: 64 });
  for (const pitch of [90, 45, 30, 0]) for (const thickness of [1, 1.5, 3]) {
    const cfg = core.resolveImmersedSourceConfig({ ...base, immersedBackWall: 1, immersedPitch: pitch, immersedThickness: thickness }, { grid: 64 });
    const weights = core.immersedSourceWeights(cfg.effective, { grid: 64, gridHeight: 128 });
    const positive = new Set(weights.cells.filter(c => c.w > 0).map(c => `${c.x},${c.y},${c.z}`));
    const wall = core.immersedBackWallCells(cfg.effective, { grid: 64, gridHeight: 128 });
    assert.ok(!wall.some(c => positive.has(`${c.x},${c.y},${c.z}`)), `pitch ${pitch} thickness ${thickness}: no wall cell carries any source weight`);
  }
  // A solid mask covering part of the slab lowers the normaliser and the effective supply, and the receipt says so.
  const open = core.resolveImmersedSourceConfig(base, { grid: 64 });
  const solid = new Uint8Array(64 * 128 * 64);
  const weights = core.immersedSourceWeights(open.effective, { grid: 64, gridHeight: 128 });
  const covered = weights.cells.filter(c => c.x + 0.5 < open.effective.centreCells[0]);
  for (const c of covered) solid[c.x + 64 * (c.y + 128 * c.z)] = 1;
  const masked = core.resolveImmersedSourceConfig(base, { grid: 64, gridHeight: 128, solidCells: solid });
  assert.ok(masked.effective.normaliser < open.effective.normaliser, 'the normaliser excludes solid cells');
  assert.ok(Math.abs(masked.effective.normaliser - (open.effective.normaliser - covered.reduce((s, c) => s + c.w, 0))) < 1e-9);
  assert.ok(Math.abs(masked.effective.fluxEffectivePredicted - masked.effective.fluxRequested) < 1e-9, 'with the normaliser over fluid cells, Σ target over fluid cells = Q again');
  assert.equal(masked.effective.masked.cells, covered.length);
  assert.ok(masked.effective.masked.weightShare > 0.3 && masked.effective.masked.weightShare < 0.7);
  assert.match(index, /masked \$\{\(immersed\.effective\.masked\.weightShare \* 100\)\.toFixed\(0\)\}%/, 'the receipt names the masked share');
  assert.match(source, /resolveImmersedSourceConfig\(controlsSnapshot, \{ grid: gridSize, gridHeight, puffFactor: [^}]*, solidCells: sceneSolidCellsCpu \}\)/, 'the pack passes the current solid mask');
});

test('IS-04: the residual measurement names the combined target (heat release + immersed source), snapshotted at copy time', () => {
  const hrOn = { effective: { admitted: true, expansion: 1 } }, hrOff = { effective: { admitted: false, expansion: 0 } };
  const imOn = { effective: { admitted: true, fluxRequested: 12.9 } }, imOff = { effective: { admitted: false, fluxRequested: 0 } };
  assert.equal(core.pressureResidualMeasurement(hrOff, imOff).compact, 'divergence');
  const both = core.pressureResidualMeasurement(hrOn, imOn);
  assert.equal(both.compact, 'divergence-minus-expansion-target');
  assert.deepEqual(both.targets, ['heat-release', 'immersed-source']);
  assert.match(both.statement, /heat-release expansion target at gain 1/);
  assert.match(both.statement, /immersed source supply 12\.9/);
  assert.deepEqual(core.pressureResidualMeasurement(hrOff, imOn).targets, ['immersed-source']);
  assert.equal(core.pressureResidualMeasurement(hrOff, imOn).compact, 'divergence-minus-expansion-target');
  assert.deepEqual(core.pressureResidualMeasurement(hrOn, imOff).targets, ['heat-release']);
  assert.match(source, /pressureResidualCopyMeasurement = pressureResidualMeasurement\(state\.heatRelease, state\.immersedSource\);/, 'both contexts snapshotted at copy time');
});

test('IS-05: the capture compares every immersed control an arm sets against the source receipt', () => {
  const receipt = { immersedSource: { requested: { sourceLaw: 'immersed-source', speed: 0.1, yaw: 0, pitch: 90, backWall: false, radius: 0.2, centre: [0, -0.5, 0], capFraction: 0.5 }, effective: { admitted: true, reason: null, speed: 0.1, direction: [0, 1, 0], backWall: { requested: false } } } };
  const ok = (cid, v) => effectiveMismatches({ set: [[cid, v]] }, receipt, null);
  assert.deepEqual(ok('volume-immersed-speed', '0.1'), []);
  assert.equal(ok('volume-immersed-speed', '0').length, 1, 'stale speed');
  assert.equal(ok('volume-immersed-pitch', '0').length, 1, 'stale pitch');
  assert.deepEqual(ok('volume-immersed-pitch', '90'), []);
  assert.equal(ok('volume-immersed-back-wall', '1').length, 1, 'stale wall');
  assert.deepEqual(ok('volume-immersed-back-wall', '0'), []);
  assert.deepEqual(ok('volume-immersed-centre-x', '0'), []);
  assert.equal(ok('volume-immersed-centre-x', '0.1').length, 1, 'stale centre');
  assert.equal(effectiveMismatches({ set: [['volume-immersed-speed', '0.1']] }, {}, null).length, 1, 'no receipt fails');
  assert.equal(effectiveMismatches({ set: [['volume-immersed-speed', '0.1']] }, { immersedSource: { requested: { speed: 0.1 }, effective: { admitted: false, reason: 'immersed-source-requires-open-top-pressure-solver' } } }, null).length, 1, 'a refused receipt fails a source-dependent arm');
});

test('IS-06: the residual probe counts the full tall grid, with and without the wall', async () => {
  const vm = await import('node:vm');
  const start = source.indexOf('  function finishPressureResidualProbe(');
  const end = source.indexOf('  function encodePressureProjection(', start);
  const run = async (solidCellCount) => {
    let release; const mapped = new Promise(r => { release = r; });
    const state = { frameCount: 50, simStepCount: 48, heatRelease: { effective: { admitted: false, expansion: 0 } }, immersedSource: { effective: { admitted: false } }, sceneCollision: { solidCellCount }, pressureSolver: { effective: { solver: 'converged', openTop: true } } };
    const context = { state, gridSize: 4, gridHeight: 8, pressureResidualCopyPending: false, pressureResidualMapPending: false, pressureResidualMapStartedFrame: 0, pressureResidualMapGeneration: 0, pressureResidualWorkgroupCount: 2, pressureResidualCopyStep: 0, pressureResidualCopyFrame: 0, pressureResidualCopyFluidCells: 0, pressureResidualCopyCells: 0, pressureResidualCopyGridHeight: 0, pressureResidualCopySolver: null, pressureResidualCopyMeasurement: null, pressureResidualAfterPipeline: {}, pressureResidualBindGroup: {}, pressureResidualPartialsBuffer: {}, fluidBindGroup: () => ({}), pressureResidualReadbackBuffer: { mapAsync: () => mapped, getMappedRange: () => new Float32Array(2 * 20).buffer, unmap() {} }, GPUMapMode: { READ: 1 }, setTimeout, clearTimeout, Float32Array, performance, Math, Number, Promise, Error, PRESSURE_RESIDUAL_MAP_TIMEOUT_MS: 10000, PRESSURE_RESIDUAL_MAP_TIMEOUT_ERROR: 'synthetic-timeout', PRESSURE_RESIDUAL_FLOATS_PER_WORKGROUP: 20, gridCellCount: g => g ** 3, gridHeightForSize: g => g * 2, pressureResidualMeasurement: core.pressureResidualMeasurement, residualProfileFromPartials: core.residualProfileFromPartials };
    context.encoder = { beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), copyBufferToBuffer() {} };
    const pending = vm.runInNewContext(source.slice(start, end) + '\nfinishPressureResidualProbe(encoder);\nresolvePressureResidualProbe();', context);
    release(); await pending;
    if (!state.pressureSolver.residual) throw new Error(`probe did not publish: ${JSON.stringify(state.pressureSolver)}`);
    return state.pressureSolver.residual;
  };
  const plain = await run(0);
  assert.equal(plain.cells, 4 * 8 * 4, 'the full tall grid');
  assert.equal(plain.fluidCells, 4 * 8 * 4);
  const walled = await run(10);
  assert.equal(walled.cells, 128); assert.equal(walled.fluidCells, 118); assert.equal(walled.solidCells, 10);
});
