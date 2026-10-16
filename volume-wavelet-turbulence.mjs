// Wavelet turbulence as a spectral closure on the fine grid.
//
// Physics: a grid of spacing h cannot carry eddies smaller than a few h; the
// semi-Lagrangian step damps them and the cascade stops short. Kolmogorov's
// inertial range says what the missing band should carry: energy density
// E(k) ∝ k^(-5/3), so the velocity amplitude of each successive octave is
// 2^(-5/6) of the one above it. Kim, Thürey, James & Gross (2008) synthesise
// that band as a divergence-free curl-noise field whose amplitude is slaved
// to the resolved flow's own small-scale energy, on noise coordinates that are
// advected with the flow so the synthesised eddies travel with the fluid.
//
// This module owns the law: the resolver and uniform packing, a CPU reference
// of the noise, the curl field and the band weights for the contracts, and the
// WGSL helpers the fine kernel includes. The kernel owns where the correction
// enters (a band-limited velocity relaxation before projection) and the
// advected-coordinate storage.
//
// No trigonometric authorship: the noise is hash-based gradient noise with a
// quintic fade and analytic derivatives, so the curl is exact, not a stencil.

export const WAVELET_TURBULENCE_IDENTITY = 'wavelet-turbulence-v0';
export const WAVELET_BAND_SLOPE = -5 / 6;
// Wavelength of the first synthesised octave, in cells. The resolved mid band
// the kernel measures sits at roughly 4–8 cells; the synthesised band fills
// 4 cells downward, one octave per step of 2.
export const WAVELET_BASE_WAVELENGTH_CELLS = 4;
export const WAVELET_LACUNARITY = 2;
// Advected noise coordinates distort; each coordinate set is reset to the
// lattice every period and two sets half a period apart are cross-faded so
// the reset never shows. Even, so the second set's reset step is exact.
export const WAVELET_COHERENCE_PERIOD_STEPS = 48;
export const WAVELET_TURBULENCE_DEFAULTS = Object.freeze({ gain: 0, octaves: 2 });
// Octaves at 4 and 2 cells; a third would sit at one cell, below Nyquist.
export const WAVELET_TURBULENCE_RANGES = Object.freeze({ gain: [0, 1], octaves: [1, 2] });

// Band estimator (measured on unit curl fields, see the contracts). The kernel
// stores L1 = box3(v) and L2 = box3(L1) in a pre-pass; the resolved band it
// reads is E = L3 − L4 with L3 the 27-tap stride-2 box of L2 and L4 the
// stride-4 box of L2. Its amplitude response peaks at 0.40 around 8–11 cells
// and is 0.13 at the first synthesized octave (4 cells), so the closure feeds
// its own estimator at a few percent, not at unity.
export const WAVELET_ESTIMATOR_GAIN = 0.40;
export const WAVELET_ESTIMATOR_CENTRE_CELLS = 9.5;
// High-pass (v − L1) amplitude response of the synthesized detail field, by
// octave count: what the kernel reads back of a pattern it injected.
export const WAVELET_DETAIL_HIGHPASS_GAIN = Object.freeze([0.503, 0.648]);
// Measured rms of the raw curl of the three-potential gradient noise at unit
// frequency (see the contracts); divides the curl so one octave at weight one
// has unit rms velocity.
export const WAVELET_CURL_RMS = 1.2196;

const OCTAVE_OFFSETS = [[0, 0, 0], [17.31, 9.27, 31.63], [41.17, 23.91, 7.53]];
const POTENTIAL_OFFSETS = [[0, 0, 0], [31.416, 27.183, 16.180], [57.721, 14.142, 73.205]];

const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

export function resolveWaveletTurbulence(params = {}) {
  const gain = clamp(finite(Number(params.waveletTurbulence), WAVELET_TURBULENCE_DEFAULTS.gain), WAVELET_TURBULENCE_RANGES.gain);
  const octaves = clamp(Math.round(finite(Number(params.waveletOctaves), WAVELET_TURBULENCE_DEFAULTS.octaves)), WAVELET_TURBULENCE_RANGES.octaves);
  const requested = gain > 0;
  return {
    identity: WAVELET_TURBULENCE_IDENTITY,
    requested,
    gain,
    octaves,
    baseWavelengthCells: WAVELET_BASE_WAVELENGTH_CELLS,
    bandSlope: WAVELET_BAND_SLOPE,
    coherencePeriodSteps: WAVELET_COHERENCE_PERIOD_STEPS,
    effective: { admitted: requested, reason: requested ? 'gain above zero' : 'gain zero: closure off, kernel path byte-identical to main' },
  };
}

// vec4 packed after joined_ghost_dims: gain, octave count, coherence period, step count.
export function waveletTurbulenceUniformValues(resolved, { simStepCount = 0 } = {}) {
  return [resolved.gain, resolved.octaves, WAVELET_COHERENCE_PERIOD_STEPS, simStepCount >>> 0];
}

// ---- CPU reference -------------------------------------------------------

function hashU32(x, y, z, salt) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}
const unitFromHash = h => (h >>> 8) / 16777216 * 2 - 1;
function latticeGradient(x, y, z, salt) {
  const g = [unitFromHash(hashU32(x, y, z, salt * 3 + 1)), unitFromHash(hashU32(x, y, z, salt * 3 + 2)), unitFromHash(hashU32(x, y, z, salt * 3 + 3))];
  const len = Math.hypot(g[0], g[1], g[2]);
  return len < 1e-6 ? [1, 0, 0] : g.map(v => v / len);
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const fadeDerivative = t => 30 * t * t * (t - 1) * (t - 1);

// Gradient noise with its analytic gradient. `salt` selects an independent
// field (one per potential component).
export function waveletGradientNoise(p, salt = 0) {
  const i = p.map(Math.floor), t = p.map((v, a) => v - i[a]);
  const f = t.map(fade), df = t.map(fadeDerivative);
  let value = 0; const gradient = [0, 0, 0];
  for (let c = 0; c < 8; c++) {
    const cx = c & 1, cy = (c >> 1) & 1, cz = (c >> 2) & 1;
    const g = latticeGradient((i[0] + cx) >>> 0, (i[1] + cy) >>> 0, (i[2] + cz) >>> 0, salt);
    const d = [t[0] - cx, t[1] - cy, t[2] - cz];
    const dot = g[0] * d[0] + g[1] * d[1] + g[2] * d[2];
    const wx = cx ? f[0] : 1 - f[0], wy = cy ? f[1] : 1 - f[1], wz = cz ? f[2] : 1 - f[2];
    const dwx = cx ? df[0] : -df[0], dwy = cy ? df[1] : -df[1], dwz = cz ? df[2] : -df[2];
    const w = wx * wy * wz;
    value += w * dot;
    gradient[0] += dwx * wy * wz * dot + w * g[0];
    gradient[1] += wx * dwy * wz * dot + w * g[1];
    gradient[2] += wx * wy * dwz * dot + w * g[2];
  }
  return { value, gradient };
}

// Curl of the three-component potential ψ_k = n_k(p + o_k) at unit frequency,
// scaled to unit rms. Divergence-free by construction.
export function waveletCurlUnit(p) {
  const psi = POTENTIAL_OFFSETS.map((o, k) => waveletGradientNoise([p[0] + o[0], p[1] + o[1], p[2] + o[2]], k).gradient);
  return [
    (psi[2][1] - psi[1][2]) / WAVELET_CURL_RMS,
    (psi[0][2] - psi[2][0]) / WAVELET_CURL_RMS,
    (psi[1][0] - psi[0][1]) / WAVELET_CURL_RMS,
  ];
}

export const waveletOctaveWeight = i => WAVELET_LACUNARITY ** (WAVELET_BAND_SLOPE * i);
export const waveletOctaveFrequency = i => WAVELET_LACUNARITY ** i / WAVELET_BASE_WAVELENGTH_CELLS;

// Unit-amplitude detail velocity at cell-space position p: octaves of the
// unit curl field on the Kolmogorov slope. Multiply by the target amplitude.
export function waveletDetailVelocity(p, octaves) {
  const out = [0, 0, 0];
  for (let i = 0; i < octaves; i++) {
    const s = waveletOctaveFrequency(i), o = OCTAVE_OFFSETS[i], w = waveletOctaveWeight(i);
    const c = waveletCurlUnit([p[0] * s + o[0], p[1] * s + o[1], p[2] * s + o[2]]);
    out[0] += w * c[0]; out[1] += w * c[1]; out[2] += w * c[2];
  }
  return out;
}

// Amplitude of the first synthesised octave (4 cells) from the estimator
// band's measured specific kinetic energy (½|E|²): undo the estimator gain,
// then walk the Kolmogorov slope from the band's centre down to 4 cells.
export const WAVELET_TARGET_PER_ROOT_ENERGY = (WAVELET_BASE_WAVELENGTH_CELLS / WAVELET_ESTIMATOR_CENTRE_CELLS) ** (-WAVELET_BAND_SLOPE) / WAVELET_ESTIMATOR_GAIN;
export function waveletTargetAmplitude(energy) {
  return energy <= 0 ? 0 : Math.sqrt(2 * energy) * WAVELET_TARGET_PER_ROOT_ENERGY;
}
// rms of the unit detail field for n octaves (octaves add in quadrature).
export function waveletDetailRms(octaves) {
  let s = 0;
  for (let i = 0; i < octaves; i++) s += waveletOctaveWeight(i) ** 2;
  return Math.sqrt(s);
}

// Cross-fade between the two advected coordinate sets. Set A resets at phase
// 0 and carries no weight there; set B resets half a period later.
export function waveletBlendWeights(simStepCount) {
  const P = WAVELET_COHERENCE_PERIOD_STEPS, phase = ((simStepCount % P) + P) % P;
  const a = 1 - Math.abs(2 * phase / P - 1);
  return { a, b: 1 - a, resetA: phase === 0, resetB: phase === P / 2 };
}

// ---- Evidence: velocity band energies -----------------------------------
// Specific kinetic energy of a readback velocity field split the way the kernel
// splits it (clamped at the box; solids are not excluded here): sub = v − L1
// (under ~4 cells), near = L1 − L2, mid = L3 − L4 (the estimator band, ~8–11
// cells), large = L4. kolmogorovSubEnergy is the energy the closure would hold
// in the synthesized band at equilibrium (½ A² rms² per cell, averaged), from
// the same per-cell estimator the kernel uses.
export function velocityBandEnergies(values, dims, { stride = 16, offset = 0, octaves = WAVELET_TURBULENCE_DEFAULTS.octaves } = {}) {
  const [nx, ny, nz] = dims, cells = nx * ny * nz;
  if (values.length < cells * stride) throw new Error(`velocity readback holds ${values.length} floats, ${cells * stride} expected`);
  const index = (x, y, z) => (Math.min(nz - 1, Math.max(0, z)) * ny + Math.min(ny - 1, Math.max(0, y))) * nx + Math.min(nx - 1, Math.max(0, x));
  const at = (x, y, z, k) => values[index(x, y, z) * stride + offset + k];
  const box = (src, s) => {
    const out = new Float32Array(cells * 3);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) for (let k = 0; k < 3; k++) {
      let acc = 0;
      for (let dz = -s; dz <= s; dz += s) for (let dy = -s; dy <= s; dy += s) for (let dx = -s; dx <= s; dx += s) acc += src(x + dx, y + dy, z + dz, k);
      out[index(x, y, z) * 3 + k] = acc / 27;
    }
    return out;
  };
  const reader = arr => (x, y, z, k) => arr[index(x, y, z) * 3 + k];
  const l1 = box(at, 1), l2 = box(reader(l1), 1), l3 = box(reader(l2), 2), l4 = box(reader(l2), 4);
  const detailRms2 = waveletDetailRms(octaves) ** 2;
  let total = 0, sub = 0, near = 0, mid = 0, large = 0, kolmogorov = 0, hash = 0x811c9dc5;
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = index(x, y, z) * 3;
    let band = 0;
    for (let k = 0; k < 3; k++) {
      const v = at(x, y, z, k), m1 = l1[i + k], m2 = l2[i + k], m3 = l3[i + k], m4 = l4[i + k];
      total += v * v; sub += (v - m1) ** 2; near += (m1 - m2) ** 2; mid += (m3 - m4) ** 2; large += m4 * m4; band += (m3 - m4) ** 2;
      hash = Math.imul(hash ^ bits[index(x, y, z) * stride + offset + k], 0x01000193) >>> 0;
    }
    kolmogorov += 0.5 * waveletTargetAmplitude(0.5 * band) ** 2 * detailRms2;
  }
  const n = cells;
  return { cells: n, total: 0.5 * total / n, sub: 0.5 * sub / n, near: 0.5 * near / n, mid: 0.5 * mid / n, large: 0.5 * large / n, kolmogorovSubEnergy: kolmogorov / n, octaves, velocityHash: hash.toString(16).padStart(8, '0') };
}

// ---- WGSL ---------------------------------------------------------------

export const WAVELET_TURBULENCE_WGSL = /* wgsl */`
const WAVELET_BAND_SLOPE: f32 = -0.8333333;
const WAVELET_BASE_WAVELENGTH_CELLS: f32 = ${WAVELET_BASE_WAVELENGTH_CELLS.toFixed(1)};
const WAVELET_LACUNARITY: f32 = ${WAVELET_LACUNARITY.toFixed(1)};
const WAVELET_CURL_RMS: f32 = ${WAVELET_CURL_RMS};
const WAVELET_TARGET_PER_ROOT_ENERGY: f32 = ${WAVELET_TARGET_PER_ROOT_ENERGY.toFixed(6)};
const WAVELET_DETAIL_HIGHPASS_GAIN = array<f32, 2>(${WAVELET_DETAIL_HIGHPASS_GAIN.join(', ')});
const WAVELET_OCTAVE_OFFSETS = array<vec3<f32>, 3>(${OCTAVE_OFFSETS.map(o => `vec3<f32>(${o.join(', ')})`).join(', ')});
const WAVELET_POTENTIAL_OFFSETS = array<vec3<f32>, 3>(${POTENTIAL_OFFSETS.map(o => `vec3<f32>(${o.join(', ')})`).join(', ')});

fn waveletHash(x: u32, y: u32, z: u32, salt: u32) -> u32 {
  var h = (x * 0x8da6b343u) ^ (y * 0xd8163841u) ^ (z * 0xcb1ab31fu) ^ (salt * 0x9e3779b9u);
  h = h ^ (h >> 15u); h = h * 0x2c1b3c6du; h = h ^ (h >> 12u); h = h * 0x297a2d39u; h = h ^ (h >> 15u);
  return h;
}
fn waveletUnit(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0 * 2.0 - 1.0; }
fn waveletLatticeGradient(c: vec3<i32>, salt: u32) -> vec3<f32> {
  let x = bitcast<u32>(c.x); let y = bitcast<u32>(c.y); let z = bitcast<u32>(c.z);
  let g = vec3<f32>(waveletUnit(waveletHash(x, y, z, salt * 3u + 1u)), waveletUnit(waveletHash(x, y, z, salt * 3u + 2u)), waveletUnit(waveletHash(x, y, z, salt * 3u + 3u)));
  let len = length(g);
  return select(g / len, vec3<f32>(1.0, 0.0, 0.0), len < 1e-6);
}
fn waveletFade(t: vec3<f32>) -> vec3<f32> { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn waveletFadeDerivative(t: vec3<f32>) -> vec3<f32> { return 30.0 * t * t * (t - 1.0) * (t - 1.0); }

// Analytic gradient of hash gradient noise; the value itself is not needed.
fn waveletNoiseGradient(p: vec3<f32>, salt: u32) -> vec3<f32> {
  let i = vec3<i32>(floor(p)); let t = p - floor(p);
  let f = waveletFade(t); let df = waveletFadeDerivative(t);
  var gradient = vec3<f32>(0.0);
  for (var c = 0u; c < 8u; c = c + 1u) {
    let corner = vec3<i32>(i32(c & 1u), i32((c >> 1u) & 1u), i32((c >> 2u) & 1u));
    let g = waveletLatticeGradient(i + corner, salt);
    let d = t - vec3<f32>(corner);
    let dot_ = dot(g, d);
    let on = vec3<f32>(corner);
    let w = mix(1.0 - f, f, on);
    let dw = mix(-df, df, on);
    gradient = gradient + vec3<f32>(dw.x * w.y * w.z, w.x * dw.y * w.z, w.x * w.y * dw.z) * dot_ + (w.x * w.y * w.z) * g;
  }
  return gradient;
}

// Unit-rms, divergence-free curl of three independent potentials at unit frequency.
fn waveletCurlUnit(p: vec3<f32>) -> vec3<f32> {
  let gx = waveletNoiseGradient(p + WAVELET_POTENTIAL_OFFSETS[0], 0u);
  let gy = waveletNoiseGradient(p + WAVELET_POTENTIAL_OFFSETS[1], 1u);
  let gz = waveletNoiseGradient(p + WAVELET_POTENTIAL_OFFSETS[2], 2u);
  return vec3<f32>(gz.y - gy.z, gx.z - gz.x, gy.x - gx.y) / WAVELET_CURL_RMS;
}

// Unit-amplitude detail velocity at cell-space position p: octaves on the
// Kolmogorov slope, each 2^(-5/6) of the previous.
fn waveletDetail(p: vec3<f32>, octaves: u32) -> vec3<f32> {
  var out = vec3<f32>(0.0);
  var s = 1.0 / WAVELET_BASE_WAVELENGTH_CELLS;
  var w = 1.0;
  for (var i = 0u; i < min(octaves, 2u); i = i + 1u) {
    out = out + w * waveletCurlUnit(p * s + WAVELET_OCTAVE_OFFSETS[i]);
    s = s * WAVELET_LACUNARITY;
    w = w * pow(WAVELET_LACUNARITY, WAVELET_BAND_SLOPE);
  }
  return out;
}

// First-octave amplitude from the estimator band's specific kinetic energy.
fn waveletTargetAmplitude(energy: f32) -> f32 {
  return select(sqrt(2.0 * max(energy, 0.0)) * WAVELET_TARGET_PER_ROOT_ENERGY, 0.0, energy <= 0.0);
}

// Cross-fade weight of coordinate set A at this step; set B carries the rest.
fn waveletBlendA(step: u32, period: u32) -> f32 {
  let phase = f32(step % period) / f32(period);
  return 1.0 - abs(2.0 * phase - 1.0);
}
`;
