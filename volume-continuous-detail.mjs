import { waveletCurlUnit, waveletBlendWeights } from './volume-wavelet-turbulence.mjs';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function resolveContinuousDetail(controls = {}) {
  const amount = Math.min(1, Math.max(0, finite(controls.renderDetail, 0)));
  const scale = Math.min(4, Math.max(0.5, finite(controls.renderDetailScale, 2)));
  return { identity: 'continuous-advected-material-displacement-v0', amount, scale, admitted: amount > 0 };
}

// A bounded lookup displacement, not a velocity or a conservative transport law.
export function continuousDetailOffset(a, b, step, amount, scale) {
  const config = resolveContinuousDetail({ renderDetail: amount, renderDetailScale: scale });
  const noise = c => {
    const p = c.map(x => x / config.scale);
    const coarse = waveletCurlUnit(p);
    const fine = waveletCurlUnit(p.map((x, i) => x * 2 + [17.1, 31.7, 11.3][i]));
    return coarse.map((x, i) => x + 0.35 * fine[i]);
  };
  if (!config.admitted) return [0, 0, 0];
  const weights = waveletBlendWeights(step), na = noise(a), nb = noise(b);
  const n = na.map((x, i) => weights.a * x + weights.b * nb[i]);
  const gain = config.amount / Math.sqrt(1 + n.reduce((s, x) => s + x * x, 0));
  return n.map(x => x * gain);
}

export const CONTINUOUS_DETAIL_WGSL = /* wgsl */`
fn continuousDetailNoise(coord: vec3<f32>) -> vec3<f32> {
  let p = coord / u.continuous_detail.y;
  return waveletCurlUnit(p) + 0.35 * waveletCurlUnit(p * 2.0 + vec3<f32>(17.1, 31.7, 11.3));
}
fn continuousDetailPosition(p: vec3<f32>) -> vec3<f32> {
  if (u.continuous_detail.x <= 0.0) { return p; }
  let cell = worldToCell(p);
  if (sceneSolidAt(vec3<i32>(floor(cell)))) { return p; }
  let a = continuousDetailNoise(waveletCoordSample(cell, 0));
  let b = continuousDetailNoise(waveletCoordSample(cell, 1));
  // The generation stamp stays with the consumed texture during both moving and held draws.
  let phase = textureLoad(waveletCoordSrc, vec3<i32>(0), 0).w;
  let weight = waveletBlendA(u32(phase), WAVELET_COHERENCE_PERIOD_STEPS);
  let n = mix(b, a, weight);
  let edge = min(cell, vec3<f32>(f32(GRID), f32(GRID_Y), f32(GRID)) - cell);
  let fade = smoothstep(0.0, 1.0, min(edge.x, min(edge.y, edge.z)));
  let offset = n * (u.continuous_detail.x * fade / sqrt(1.0 + dot(n, n)));
  return cellToWorld(sceneClipCharacteristic(cell, cell + offset));
}
`;
