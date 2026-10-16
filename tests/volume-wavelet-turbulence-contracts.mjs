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
  const clamped = resolveWaveletTurbulence({ waveletTurbulence: 9, waveletOctaves: 7 });
  assert.equal(clamped.gain, WAVELET_TURBULENCE_RANGES.gain[1]);
  assert.equal(clamped.octaves, WAVELET_TURBULENCE_RANGES.octaves[1]);
  assert.equal(resolveWaveletTurbulence({ waveletTurbulence: 'x', waveletOctaves: 2.6 }).octaves, 3, 'octaves is an integer');
});

test('uniforms: gain, octaves, coherence period, step count', () => {
  const r = resolveWaveletTurbulence({ waveletTurbulence: 0.25, waveletOctaves: 3 });
  assert.deepEqual(waveletTurbulenceUniformValues(r, { simStepCount: 17 }), [0.25, 3, WAVELET_COHERENCE_PERIOD_STEPS, 17]);
  assert.deepEqual(waveletTurbulenceUniformValues(resolveWaveletTurbulence({}), { simStepCount: 17 }), [0, WAVELET_TURBULENCE_DEFAULTS.octaves, WAVELET_COHERENCE_PERIOD_STEPS, 17]);
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

test('target amplitude: zero where the resolved mid band has no energy, one octave below it on the slope otherwise', () => {
  assert.equal(waveletTargetAmplitude(0), 0);
  const e = 0.5 * 0.2 ** 2; // a mid-band rms of 0.2 cells per tick
  assert.ok(Math.abs(waveletTargetAmplitude(e) - 0.2 * 2 ** WAVELET_BAND_SLOPE) < 1e-12);
  assert.ok(waveletTargetAmplitude(4 * e) > waveletTargetAmplitude(e));
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

test('WGSL: the kernel module carries the same slope, period and no trigonometric authorship', () => {
  assert.match(WAVELET_TURBULENCE_WGSL, /const WAVELET_BAND_SLOPE: f32 = -0\.8333333/);
  assert.match(WAVELET_TURBULENCE_WGSL, /fn waveletCurlUnit\(p: vec3<f32>\) -> vec3<f32>/);
  assert.match(WAVELET_TURBULENCE_WGSL, /fn waveletDetail\(p: vec3<f32>, octaves: u32\) -> vec3<f32>/);
  assert.match(WAVELET_TURBULENCE_WGSL, /fn waveletTargetAmplitude\(energy: f32\) -> f32/);
  assert.doesNotMatch(WAVELET_TURBULENCE_WGSL, /(?<![\w.])(?:sin|cos|tan)\s*\(/);
  const source = readFileSync(new URL('../volume-wavelet-turbulence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.(?:sin|cos|tan)\b/);
});
