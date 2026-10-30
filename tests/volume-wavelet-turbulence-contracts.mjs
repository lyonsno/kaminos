// kaminos-test: node
// Wavelet turbulence (Kim, Thürey, James & Gross 2008) as a spectral closure on
// the fine grid: the sub-band the grid cannot sustain is relaxed toward a
// divergence-free curl-noise field whose amplitude is extrapolated from the
// resolved mid band with the Kolmogorov slope, on noise coordinates advected
// with the flow. CPU contracts for the law; the kernel pins its WGSL to the
// same constants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WAVELET_TURBULENCE_IDENTITY,
  WAVELET_TURBULENCE_DEFAULTS,
  WAVELET_TURBULENCE_RANGES,
  WAVELET_BAND_SLOPE,
  WAVELET_COHERENCE_PERIOD_STEPS,
  resolveWaveletTurbulence,
  waveletTurbulenceUniformValues,
  waveletGradientNoise,
  waveletCurlUnit,
  waveletDetailVelocity,
  waveletTargetAmplitude,
  waveletBlendWeights,
  velocityBandEnergies,
  waveletDetailRms,
  waveletCurlUnit as curlUnit,
  WAVELET_ESTIMATOR_GAIN,
  WAVELET_ESTIMATOR_CENTRE_CELLS,
  WAVELET_DETAIL_HIGHPASS_GAIN,
  WAVELET_TARGET_PER_ROOT_ENERGY,
  WAVELET_TURBULENCE_WGSL,
} from '../volume-wavelet-turbulence.mjs';

const seeded = (n, seed = 11) => { let s = seed >>> 0; return Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }); };

test('resolver: off at gain 0, admitted above it, octaves and gain clamped to their ranges', () => {
  const off = resolveWaveletTurbulence({});
  assert.equal(off.identity, WAVELET_TURBULENCE_IDENTITY);
  assert.equal(off.requested, false);
  assert.equal(off.effective.admitted, false);
  assert.equal(off.gain, 0);
  assert.equal(off.octaves, WAVELET_TURBULENCE_DEFAULTS.octaves);
  const on = resolveWaveletTurbulence({ waveletTurbulence: 0.4, waveletOctaves: 2 });
  assert.equal(on.effective.admitted, true);
  assert.equal(on.gain, 0.4);
  assert.equal(on.octaves, 2);
  assert.equal(on.strength, 1, 'strength defaults to the cascade expectation');
  assert.equal(resolveWaveletTurbulence({ waveletStrength: 9 }).strength, 9);
  assert.equal(resolveWaveletTurbulence({ waveletStrength: 2.5 }).strength, 2.5);
  const clamped = resolveWaveletTurbulence({ waveletTurbulence: 9, waveletOctaves: 7 });
  assert.equal(clamped.gain, WAVELET_TURBULENCE_RANGES.gain[1]);
  assert.equal(clamped.octaves, WAVELET_TURBULENCE_RANGES.octaves[1]);
  assert.equal(resolveWaveletTurbulence({ waveletTurbulence: 'x', waveletOctaves: 1.6 }).octaves, 2, 'octaves is an integer');
  assert.deepEqual(WAVELET_TURBULENCE_RANGES.octaves, [1, 2], 'a third octave would sit at one cell, below Nyquist');
});

test('uniforms: gain, octaves, strength, step count; the coherence period is a WGSL constant', () => {
  const r = resolveWaveletTurbulence({ waveletTurbulence: 0.25, waveletOctaves: 1, waveletStrength: 2 });
  assert.deepEqual(waveletTurbulenceUniformValues(r, { simStepCount: 17 }), [0.25, 1, 2, 17]);
  assert.deepEqual(waveletTurbulenceUniformValues(resolveWaveletTurbulence({}), { simStepCount: 17 }), [0, WAVELET_TURBULENCE_DEFAULTS.octaves, 1, 17]);
  assert.match(WAVELET_TURBULENCE_WGSL, new RegExp(`const WAVELET_COHERENCE_PERIOD_STEPS: u32 = ${WAVELET_COHERENCE_PERIOD_STEPS}u;`));
});

test('gradient noise: zero-mean, bounded, and its analytic gradient matches finite differences', () => {
  const r = seeded(600);
  let sum = 0, worst = 0;
  for (let i = 0; i < 200; i++) {
    const p = [r[3 * i] * 40 - 20, r[3 * i + 1] * 40 - 20, r[3 * i + 2] * 40 - 20];
    const n = waveletGradientNoise(p);
    assert.ok(Math.abs(n.value) <= 1.0001, `value ${n.value} out of range`);
    sum += n.value;
    const h = 1e-4;
    for (let a = 0; a < 3; a++) {
      const lo = p.slice(), hi = p.slice(); lo[a] -= h; hi[a] += h;
      const fd = (waveletGradientNoise(hi).value - waveletGradientNoise(lo).value) / (2 * h);
      worst = Math.max(worst, Math.abs(fd - n.gradient[a]));
    }
  }
  assert.ok(Math.abs(sum / 200) < 0.08, `mean ${sum / 200}`);
  assert.ok(worst < 2e-3, `analytic gradient vs finite difference ${worst}`);
});

test('curl noise: divergence-free to finite-difference precision', () => {
  const r = seeded(300, 5);
  let worstDiv = 0, rms = 0;
  for (let i = 0; i < 100; i++) {
    const p = [r[3 * i] * 30, r[3 * i + 1] * 30, r[3 * i + 2] * 30];
    const h = 1e-3; let div = 0;
    for (let a = 0; a < 3; a++) {
      const lo = p.slice(), hi = p.slice(); lo[a] -= h; hi[a] += h;
      div += (waveletCurlUnit(hi)[a] - waveletCurlUnit(lo)[a]) / (2 * h);
    }
    const w = waveletCurlUnit(p); rms += w[0] ** 2 + w[1] ** 2 + w[2] ** 2;
    worstDiv = Math.max(worstDiv, Math.abs(div));
  }
  rms = Math.sqrt(rms / 100);
  assert.ok(worstDiv < 1e-2 * Math.max(1, rms), `divergence ${worstDiv} at rms ${rms}`);
  assert.ok(Math.abs(rms - 1) < 0.25, `unit curl field has rms ${rms}, expected ~1`);
});

test('bands: each octave carries 2^(-5/6) of the previous amplitude and the sum stays divergence-free', () => {
  const r = seeded(300, 9);
  const points = Array.from({ length: 100 }, (_, i) => [r[3 * i] * 20, r[3 * i + 1] * 20, r[3 * i + 2] * 20]);
  const rmsOf = f => Math.sqrt(points.reduce((s, p) => { const w = f(p); return s + w[0] ** 2 + w[1] ** 2 + w[2] ** 2; }, 0) / points.length);
  const one = rmsOf(p => waveletDetailVelocity(p, 1)), two = rmsOf(p => waveletDetailVelocity(p, 2));
  // Independent octaves add in quadrature: rms2^2 = rms1^2 (1 + 2^(-5/3)).
  const expected = one * Math.sqrt(1 + 2 ** (2 * WAVELET_BAND_SLOPE));
  assert.ok(Math.abs(two / expected - 1) < 0.2, `two-octave rms ${two}, expected ${expected}`);
  assert.equal(WAVELET_BAND_SLOPE, -5 / 6);
  let worstDiv = 0;
  for (const p of points.slice(0, 40)) {
    const h = 1e-3; let div = 0;
    for (let a = 0; a < 3; a++) { const lo = p.slice(), hi = p.slice(); lo[a] -= h; hi[a] += h; div += (waveletDetailVelocity(hi, 3)[a] - waveletDetailVelocity(lo, 3)[a]) / (2 * h); }
    worstDiv = Math.max(worstDiv, Math.abs(div));
  }
  assert.ok(worstDiv < 5e-2, `three-octave divergence ${worstDiv}`);
});

test('target amplitude: zero where the estimator band has no energy; otherwise the band amplitude with the estimator gain undone, walked down the slope from the band centre to four cells', () => {
  assert.equal(waveletTargetAmplitude(0), 0);
  const e = 0.5 * 0.2 ** 2; // an estimator-band rms of 0.2 cells per tick
  const expected = 0.2 / WAVELET_ESTIMATOR_GAIN * (4 / WAVELET_ESTIMATOR_CENTRE_CELLS) ** (5 / 6);
  assert.ok(Math.abs(waveletTargetAmplitude(e) - expected) < 1e-12);
  assert.ok(Math.abs(WAVELET_TARGET_PER_ROOT_ENERGY - expected / 0.2) < 1e-12);
  assert.ok(waveletTargetAmplitude(4 * e) > waveletTargetAmplitude(e));
  assert.ok(Math.abs(waveletDetailRms(2) - Math.sqrt(1 + 2 ** (-5 / 3))) < 1e-12);
});

test('coordinate sets: two phases half a period apart, weights sum to one and vanish at each set\'s own reset', () => {
  const P = WAVELET_COHERENCE_PERIOD_STEPS;
  for (const step of [0, 1, Math.floor(P / 4), Math.floor(P / 2), P - 1, P, 3 * P + 2]) {
    const w = waveletBlendWeights(step);
    assert.ok(Math.abs(w.a + w.b - 1) < 1e-12);
    assert.ok(w.a >= 0 && w.b >= 0);
    assert.equal(w.resetA, step % P === 0);
    assert.equal(w.resetB, step % P === Math.floor(P / 2));
    if (w.resetA) assert.ok(w.a < 1e-12, 'set A carries no weight on its reset step');
    if (w.resetB) assert.ok(w.b < 1e-12, 'set B carries no weight on its reset step');
  }
});

test('band energies: a smooth field is all large band, a two-cell checkerboard is all sub band, the hash tracks the bits', () => {
  const dims = [12, 10, 8], cells = dims[0] * dims[1] * dims[2];
  const smooth = new Float32Array(cells * 16), fine = new Float32Array(cells * 16);
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
    const i = ((z * dims[1] + y) * dims[0] + x) * 16;
    smooth[i] = 0.3; smooth[i + 1] = 0.1; smooth[i + 2] = -0.2;
    fine[i + 1] = ((x + y + z) & 1) ? 0.5 : -0.5;
  }
  const a = velocityBandEnergies(smooth, dims);
  assert.ok(Math.abs(a.total - 0.5 * (0.09 + 0.01 + 0.04)) < 1e-7);
  assert.ok(a.sub < 1e-12 && a.near < 1e-12 && a.mid < 1e-12 && Math.abs(a.large - a.total) < 1e-7 && a.kolmogorovSubEnergy === 0, 'uniform flow has no sub, near or mid band and asks for no detail');
  const b = velocityBandEnergies(fine, dims);
  // L1 passes the checkerboard at 1/27 in the interior (box filter; the clamped
  // edges dilute it), so the sub band holds the energy and the mid and large
  // bands see only the leak.
  assert.ok(b.sub > 0.98 * b.total && b.near < 0.01 * b.total && b.mid < 0.001 * b.total && b.large < 0.001 * b.total, `checkerboard sub ${b.sub} near ${b.near} mid ${b.mid} large ${b.large} total ${b.total}`);
  assert.notEqual(a.velocityHash, b.velocityHash);
  fine[1] = -fine[1];
  assert.notEqual(velocityBandEnergies(fine, dims).velocityHash, b.velocityHash, 'one changed bit changes the hash');
  assert.throws(() => velocityBandEnergies(new Float32Array(8), dims), /expected/);
});

test('kernel: the closure fills the deficit of the transported sub band at the foot, scaled for the time step, and never subtracts', () => {
  const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
  const start = core.indexOf('fn waveletCorrection('), body = core.slice(start, core.indexOf('\n}\n', start));
  assert.match(body, /fn waveletCorrection\(foot: vec3<f32>, transported: vec3<f32>, coordA: vec3<f32>, coordB: vec3<f32>, timeStep: f32\)/);
  assert.match(body, /let band = waveletLevel2Box\(footCell, 2\) - waveletLevel2Box\(footCell, 4\);/, 'the estimator band is L3 − L4 at the foot');
  assert.match(body, /let highPass = transported - waveletLowPassSample\(foot\);/, 'the sub band is the transported velocity against L1 at the same foot');
  assert.match(body, /let carried = dot\(highPass, detail\) \/ \(dd \* readGain\);/, 'only the component along the pattern is read');
  assert.match(body, /let blend = stepBlend\(clamp\(u\.wavelet_turbulence\.x, 0\.0, 1\.0\)\);/);
  assert.match(body, /let fillTo = amplitude \* max\(u\.wavelet_turbulence\.z, 0\.0\);/, 'strength multiplies the Kolmogorov amplitude');
  assert.doesNotMatch(body, /\blet (target|set|meta|active|smooth)\b/, 'no WGSL reserved words as locals');
  assert.match(body, /return blend \/ max\(timeStep, 1e-6\) \* max\(fillTo - carried, 0\.0\) \* detail;/, 'one-sided fill along the pattern; the fold restores the per-step blend');
  assert.match(body, /waveletBlendA\(u32\(u\.wavelet_turbulence\.w\), WAVELET_COHERENCE_PERIOD_STEPS\)/);
  assert.doesNotMatch(body, /readSlot\(/, 'no destination-cell old-field term');
  assert.match(core, /if \(waveletOn\(\) && !VELOCITY_ONLY\) \{ vel = vel \+ waveletCorrection\(backCell, velTransported, waveletCoordA, waveletCoordB, timeStep\); \}/);
  const pre = core.slice(core.indexOf('fn csWaveletLowPass('), core.indexOf('\n}\n', core.indexOf('fn csWaveletLowPass(')));
  assert.match(pre, /for \(var dz = -1; dz <= 1; dz = dz \+ 1\)/); assert.match(pre, /if \(!sceneSolidAt\(nc\)\)/); assert.match(pre, /waveletPlaneStore\(c, 3,/);
  const pre2 = core.slice(core.indexOf('fn csWaveletLowPass2('), core.indexOf('\n}\n', core.indexOf('fn csWaveletLowPass2(')));
  assert.match(pre2, /waveletLowPassLoad\(c \+ vec3<i32>\(dx, dy, dz\)\)/); assert.match(pre2, /waveletPlaneStore\(c, 6,/);
  assert.match(core, /const planes = waveletSidecarFull \? 9 : 3;/);
});

test('estimator calibration: the pinned gains match the filters on unit curl fields (band 0.40 at eight cells, 0.13 at four; detail high-pass 0.50 / 0.65)', () => {
  const n = 36, dims = [n, n, n], cells = n ** 3;
  const field = fn => { const v = new Float32Array(cells * 16); for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const w = fn([x + 0.5, y + 0.5, z + 0.5]); const i = ((z * n + y) * n + x) * 16; v[i] = w[0]; v[i + 1] = w[1]; v[i + 2] = w[2]; } return v; };
  const gains = (v, octaves) => { const b = velocityBandEnergies(v, dims, { octaves }); return { sub: Math.sqrt(b.sub / b.total), mid: Math.sqrt(b.mid / b.total), b }; };
  const at8 = gains(field(p => curlUnit([p[0] / 8 + 3.1, p[1] / 8 + 7.7, p[2] / 8 + 11.3])), 2);
  const at4 = gains(field(p => curlUnit([p[0] / 4 + 3.1, p[1] / 4 + 7.7, p[2] / 4 + 11.3])), 2);
  // Clamped edges on a 36-cell box dilute the interior response by a few percent.
  assert.ok(Math.abs(at8.mid - WAVELET_ESTIMATOR_GAIN) < 0.07, `estimator response at eight cells ${at8.mid}`);
  assert.ok(at4.mid < 0.2 && at4.mid > 0.05, `estimator response at the first synthesized octave ${at4.mid}`);
  const d1 = gains(field(p => waveletDetailVelocity(p, 1)), 1), d2 = gains(field(p => waveletDetailVelocity(p, 2)), 2);
  assert.ok(Math.abs(d1.sub - WAVELET_DETAIL_HIGHPASS_GAIN[0]) < 0.06, `one-octave detail high-pass gain ${d1.sub}`);
  assert.ok(Math.abs(d2.sub - WAVELET_DETAIL_HIGHPASS_GAIN[1]) < 0.06, `two-octave detail high-pass gain ${d2.sub}`);
  // Self-consistency: a field that is exactly the synthesized detail at unit
  // amplitude asks the estimator for far less than it carries (the leak).
  assert.ok(d2.b.kolmogorovSubEnergy < 0.1 * d2.b.sub, `the detail field feeds its own estimator at ${d2.b.kolmogorovSubEnergy / d2.b.sub}`);
});

test('parity: the coordinate textures ride the quench parity, which flips once per step; the fluid parity flips again under projection without copying them', () => {
  const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
  assert.match(core, /waveletRead: waveletTextures\[quenchIndex\],\s*waveletWrite: waveletTextures\[1 - quenchIndex\],/, 'bind groups key the coordinate ping-pong to the quench index');
  assert.doesNotMatch(core, /waveletRead: waveletTextures\[fluidIndex\]/);
  const encodeSim = core.slice(core.indexOf('function encodeSim('), core.indexOf('\n  }\n', core.indexOf('function encodeSim(')));
  assert.equal((encodeSim.match(/currentQuench = 1 - currentQuench;/g) || []).length, 1, 'encodeSim flips the quench parity once');
  assert.equal((core.match(/currentQuench = 1 - currentQuench;/g) || []).length, 1, 'nothing else flips the quench parity');
  assert.ok((core.match(/currentFluid = 1 - currentFluid;/g) || []).length >= 2, 'the fluid parity also flips under projection');
  // Replay of the bookkeeping (review WT-01): with projection on, the fluid
  // parity returns to its start every step, so coordinates keyed to it would be
  // re-read from the same texture; keyed to the quench parity they alternate.
  let fluid = 0, quench = 0; const readsByFluid = [], readsByQuench = [];
  for (let step = 0; step < 4; step++) {
    readsByFluid.push(fluid); readsByQuench.push(quench);
    fluid = 1 - fluid; quench = 1 - quench; // encodeSim
    fluid = 1 - fluid;                       // projection writes back into the other fluid buffer
  }
  assert.deepEqual(readsByFluid, [0, 0, 0, 0]);
  assert.deepEqual(readsByQuench, [0, 1, 0, 1], 'each step reads the set the previous step wrote');
});

test('capture: the band-energy readback must be its own arm and must postdate the configuration it is evidence for', async () => {
  const { waveletBandEnergyMismatch, armSetsConfiguration } = await import('../volume-arm-capture-checks.mjs');
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /if \(cid === '@waveletBandEnergy'\) \{\s*if \(armSetsConfiguration\(arm\.set\)\) fail\(/, 'a configuring arm cannot carry the readback');
  assert.match(capture, /waveletBandEnergyMismatch\(sample, \{ minStep: lastConfigStep \}\)/);
  assert.equal(armSetsConfiguration([['volume-wavelet-turbulence', '0.5'], ['@waveletBandEnergy', '1']]), true);
  assert.equal(armSetsConfiguration([['@waveletBandEnergy', '1']]), false);
  const good = { status: 'sampled', simStepCount: 600, wavelet: { gain: 0.5, octaves: 2, strength: 1, admitted: true } };
  assert.equal(waveletBandEnergyMismatch(good, { minStep: 574 }), null);
  assert.match(waveletBandEnergyMismatch({ ...good, simStepCount: 400 }, { minStep: 574 }), /before the configuration settled/);
  assert.match(waveletBandEnergyMismatch({ ...good, wavelet: { gain: 0, octaves: 2, strength: 1, admitted: false } }, { minStep: 0 }) ?? 'null', /null/);
  assert.match(waveletBandEnergyMismatch({ ...good, wavelet: { gain: 0.5, octaves: 2, strength: 1, admitted: false } }), /incoherent/);
  assert.match(waveletBandEnergyMismatch({ status: 'invalid' }), /invalid/);
  assert.match(waveletBandEnergyMismatch(null), /missing/);
});

test('WGSL: the kernel module carries the same slope, period and no trigonometric authorship', () => {
  assert.match(WAVELET_TURBULENCE_WGSL, /const WAVELET_BAND_SLOPE: f32 = -0\.8333333/);
  assert.match(WAVELET_TURBULENCE_WGSL, /fn waveletCurlUnit\(p: vec3<f32>\) -> vec3<f32>/);
  assert.match(WAVELET_TURBULENCE_WGSL, /fn waveletDetail\(p: vec3<f32>, octaves: u32\) -> vec3<f32>/);
  assert.match(WAVELET_TURBULENCE_WGSL, /fn waveletTargetAmplitude\(energy: f32\) -> f32/);
  assert.doesNotMatch(WAVELET_TURBULENCE_WGSL, /(?<![\w.])(?:sin|cos|tan)\s*\(/);
  const source = readFileSync(new URL('../volume-wavelet-turbulence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.(?:sin|cos|tan)\b/);
});

test('cockpit: the two wavelet controls exist, are in the control table, and the snapshot builder forwards them', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['volume-wavelet-turbulence', 'volume-wavelet-octaves', 'volume-wavelet-strength']) assert.ok(index.includes(`id="${id}"`), `${id} is in the cockpit`);
  assert.match(index, /\{ key: 'waveletStrength', id: 'volume-wavelet-strength', param: 'volume_wavelet_strength'/);
  assert.match(index, /\{ key: 'waveletTurbulence', id: 'volume-wavelet-turbulence', param: 'volume_wavelet_turbulence'/);
  assert.match(index, /\{ key: 'waveletOctaves', id: 'volume-wavelet-octaves', param: 'volume_wavelet_octaves'/);
  // The live capture of 2026-10-16 found the sliders moving while the kernel stayed at gain 0:
  // the snapshot builder filtered the table to keys starting with `physical`.
  assert.match(index, /REACTION_FRONT_EXTRACTOR_CONTROL_FIELDS\.filter\(field => field\.key\.startsWith\('physical'\) \|\| field\.key\.startsWith\('wavelet'\)\)/, 'the snapshot builder forwards the wavelet keys');
});
