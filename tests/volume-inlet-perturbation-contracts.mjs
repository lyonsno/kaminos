import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as inlet from '../volume-inlet-perturbation.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

test('a stochastic signal set is seeded, step-locked, bounded, slowly varying, and replayable', () => {
  const a = new inlet.StochasticSignalSet(7, 5); const b = new inlet.StochasticSignalSet(7, 5); const c = new inlet.StochasticSignalSet(8, 5);
  const sa = a.sampleAt(600, 480); const sb = b.sampleAt(600, 480); const sc = c.sampleAt(600, 480);
  assert.deepEqual([...sa], [...sb], 'same seed, same signals');
  assert.notDeepEqual([...sa], [...sc], 'another seed, other signals');
  assert.equal(sa.length, 5);
  assert.ok([...sa].every(v => v >= -1 && v <= 1), 'bounded to [-1, 1]');
  const next = a.sampleAt(660, 480);
  assert.ok(Math.abs(next[0] - sa[0]) < 0.6, 'one second moves a signal by less than its range at an eight-second correlation time');
  assert.deepEqual([...new inlet.StochasticSignalSet(7, 5).sampleAt(660, 480)], [...next], 'incremental advance equals a fresh walk');
  const long = new inlet.StochasticSignalSet(3, 1); let lo = 1; let hi = -1;
  for (let step = 0; step <= 20000; step += 100) { const s = long.sampleAt(step, 480); lo = Math.min(lo, s[0]); hi = Math.max(hi, s[0]); }
  assert.ok(lo < -0.3 && hi > 0.3, `visits both signs (${lo.toFixed(2)} … ${hi.toFixed(2)})`);
  const moduleSource = readFileSync(new URL('../volume-inlet-perturbation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(moduleSource, /Math\.(sin|cos|tan)\(/, 'no periodic math animates the inlet (periodic-authorship inventory)');
});

test('the inlet turbulence field is a patchwork of signals interpolated to the floor grid, deterministic in seed, step and scale', () => {
  const field = new inlet.InletPerturbationField({ grid: 64, seed: 1 });
  const cells = field.sampleAt({ step: 300, tauSteps: 120, scaleCells: 8 });
  assert.equal(cells.length, 64 * 64);
  assert.ok([...cells].every(v => v >= -1 && v <= 1), 'cells stay within [-1, 1]');
  const again = new inlet.InletPerturbationField({ grid: 64, seed: 1 }).sampleAt({ step: 300, tauSteps: 120, scaleCells: 8 });
  assert.deepEqual([...cells], [...again], 'replayable');
  // Neighbouring cells inside one patch differ smoothly; cells a patch apart are nearly independent.
  let near = 0; let far = 0; let n = 0;
  for (let z = 0; z < 64; z += 4) for (let x = 0; x < 48; x += 4) { near += Math.abs(cells[z * 64 + x + 1] - cells[z * 64 + x]); far += Math.abs(cells[z * 64 + x + 16] - cells[z * 64 + x]); n += 1; }
  assert.ok(near / n < far / n * 0.5, `adjacent cells differ less than cells two patches apart (${(near / n).toFixed(3)} vs ${(far / n).toFixed(3)})`);
  const coarse = new inlet.InletPerturbationField({ grid: 64, seed: 1 }).sampleAt({ step: 300, tauSteps: 120, scaleCells: 32 });
  let coarseNear = 0; for (let z = 0; z < 64; z += 4) for (let x = 0; x < 48; x += 4) coarseNear += Math.abs(coarse[z * 64 + x + 1] - coarse[z * 64 + x]);
  assert.ok(coarseNear < near, 'a larger scale makes a smoother field');
  const rms = Math.sqrt([...cells].reduce((s, v) => s + v * v, 0) / cells.length);
  assert.ok(rms > 0.15 && rms < 0.6, `the field has unit-order rms (${rms.toFixed(3)})`);
});

test('inlet dynamics resolve from the controls: puff factor, turbulence intensity and scale, periods in simulated seconds', () => {
  const steady = inlet.resolveInletDynamicsConfig({}, { puff: [0], turbulence: null });
  assert.equal(steady.effective.puffFactor, 1);
  assert.equal(steady.effective.turbulence, 0);
  assert.equal(steady.effective.active, false);
  const controls = { emitterInletTurbulence: 0.5, emitterInletTurbulenceScale: 6, emitterPuff: 0.4, emitterPuffPeriod: 3, timeStep: 'uniform', advectionScheme: 'maccormack', commonGasTransport: true, speed: 0.5 };
  const live = inlet.resolveInletDynamicsConfig(controls, { puff: [0.5], turbulence: { rms: 0.3 } });
  assert.equal(live.effective.turbulence, 0.5);
  assert.equal(live.effective.turbulenceScaleCells, 6);
  assert.ok(Math.abs(live.effective.puffFactor - 1.2) < 1e-12, 'puff factor = 1 + depth × signal');
  assert.equal(live.effective.active, true);
  assert.equal(inlet.resolveInletDynamicsConfig({ ...controls, emitterPuff: 1 }, { puff: [-1] }).effective.puffFactor, 0, 'a full negative puff closes the inlet, never reverses it');
  // Periods are simulated seconds: at Speed 0.5 under the uniform step, twice the steps.
  assert.equal(inlet.inletDynamicsTauSteps({ ...controls, speed: 1 }, 3), 180);
  assert.equal(inlet.inletDynamicsTauSteps(controls, 3), 360);
  assert.equal(inlet.INLET_TURBULENCE_CORRELATION_SECONDS, 0.5, 'turbulence decorrelates on a fixed half-second (its scale is spatial)');
  // Sub-second periods survive the conversion: the floor of one applies to steps, not seconds.
  assert.equal(inlet.inletDynamicsTauSteps({}, 0.5), 30, 'half a second is thirty steps at the reference rate');
  assert.equal(inlet.inletDynamicsTauSteps({}, inlet.INLET_TURBULENCE_CORRELATION_SECONDS), 30, 'the turbulence correlation is thirty steps, not sixty');
  assert.equal(inlet.inletDynamicsTauSteps({ ...controls, speed: 1 }, 0.5), 30);
  assert.equal(inlet.inletDynamicsTauSteps({ ...controls, speed: 0.1 }, 0.5), 300, 'and ten times that at Speed 0.1 under the uniform step');
  assert.equal(inlet.inletDynamicsTauSteps({}, 0.001), 1, 'never below one step');
});

test('the shader derives every inflow quantity from one inlet speed that carries the puff and the turbulence', () => {
  assert.match(source, /fn inflowInletSpeed\(cell: vec3<i32>\) -> f32/, 'one inlet speed function');
  const speed = source.slice(source.indexOf('fn inflowInletSpeed('), source.indexOf('\n}\n', source.indexOf('fn inflowInletSpeed(')));
  assert.match(speed, /u\.inflow_state\.y \* u\.inflow_state\.x/, 'base inlet velocity times the puff factor');
  assert.match(speed, /max\(0\.0, 1\.0 \+ u\.inflow_shape\.y \* /, 'times one plus intensity times the perturbation, never negative');
  assert.match(speed, /textureLoad\(inflowPerturbation,/, 'the perturbation comes from the floor field texture');
  assert.match(source, /fn inflowFaceVelocity\(cell: vec3<i32>\) -> f32 \{\s*\n\s*return inflowInletSpeed\(cell\) \* inflowApertureWeight\(cell\);/, 'the face flux is inlet speed times coverage');
  assert.match(source, /let inflowFraction = clamp\(inflowInletSpeed\(cellI\) \* inflowApertureWeight\(cellI\) \* dynamicsBacktraceScale\(\), 0\.0, 1\.0\);/, 'the floor source uses the same inlet speed');
  assert.match(source, /let penetration = min\(below, inflowInletSpeed\(floorCell\) \* coverage \* dynamicsBacktraceScale\(\)\);/, 'the ghost cap uses the same inlet speed');
  assert.match(source, /return inflowInletSpeed\(floorCell\) \* vec3<f32>\(tangent\.x \* swirl, 1\.0, tangent\.y \* swirl\);/, 'the ghost momentum uses the same inlet speed');
  assert.match(source, /@group\(0\) @binding\(18\) var inflowPerturbation: texture_2d<f32>;/, 'binding 18 carries the perturbation field');
  assert.match(source, /\{ binding: 18, visibility: GPUShaderStage\.FRAGMENT \| GPUShaderStage\.COMPUTE, texture: \{ sampleType: 'unfilterable-float', viewDimension: '2d' \} \}/, 'layout entry');
  assert.match(source, /\{ binding: 18, resource: inflowPerturbationTexture\.createView\(\) \}/, 'bound with the fluid state');
  // Packing: the puff factor rides in inflow_state.x, the intensity in inflow_shape.y; the field is written each step while active.
  assert.match(source, /e\.inletDynamics\.puffFactor, e\.inletVelocity, e\.fuelFraction, e\.inletTemperature,/, 'puff factor packed in inflow_state.x');
  assert.match(source, /e\.swirl, e\.inletDynamics\.turbulence, /, 'turbulence intensity packed in inflow_shape.y');
  assert.match(source, /device\.queue\.writeTexture\(\{ texture: inflowPerturbationTexture \}, inletPerturbationField\.sampleAt\(/, 'the field is uploaded from the step-locked process');
});
