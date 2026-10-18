// Image-space comparison of a coarse level against its reference, one view at a time.
//
// Each view supplies, for reference and level rendered with the same camera:
//   g: Float32Array res*res*4 — linear view depth in [0] (0 = nothing drawn), view-space
//      shading normal packed n*0.5+0.5 in [1..3]
//   a: Float32Array res*res*3 — unlit base colour in 0..1
// Channels are kept apart; nothing here blends them into one score.
//   silhouetteMismatch: pixels covered by exactly one of the two / pixels covered by either
//   differentSurface:   of pixels both cover, the fraction whose depths differ by more than
//                       `sameSurface` of the reference diagonal (the level shows another surface)
//   depth:              |depth difference| / diagonal, over pixels both cover
//   normalDegrees:      angle between shading normals by direction (0-180; the renderer turns the
//                       visible side's normal toward the viewer), over same-surface pixels where
//                       both normals are usable; normalUndefined counts, per side, same-surface
//                       pixels whose normal is NaN or zero (degenerate geometry), left out
//   albedo:             mean |dRGB|, over same-surface pixels
//   meanAlbedo:         mean colour of each, over same-surface pixels (overall shift)

export const SCHEMA = 'kaminos.lod-image-error.v1';

// 26 directions: cube faces, edges and corners.
export function viewDirections() {
  const dirs = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) {
    const l = Math.hypot(x, y, z); dirs.push([x / l, y / l, z / l]);
  }
  return dirs;
}

export function stats(values) {
  if (!values.length) return {max: 0, p95: 0, mean: 0, count: 0};
  const s = Float64Array.from(values).sort();
  let sum = 0; for (const v of s) sum += v;
  return {max: s[s.length - 1], p95: s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)], mean: sum / s.length, count: s.length};
}

// Per-pixel maps are returned when `maps` is set, for drawing: depth / normal / albedo error
// (NaN where the channel does not apply) and coverage codes (0 neither, 1 both, 2 reference only, 3 level only).
export function compareView({reference: R, level: L, res, diagonal, sameSurface = 0.01, maps = false}) {
  const n = res * res;
  if (R.g.length !== n * 4 || L.g.length !== n * 4 || R.a.length !== n * 3 || L.a.length !== n * 3) throw Error('buffer sizes do not match the resolution');
  if (!(diagonal > 0)) throw Error('diagonal must be positive');
  const out = maps ? {coverage: new Uint8Array(n), depth: new Float32Array(n).fill(NaN), normal: new Float32Array(n).fill(NaN), albedo: new Float32Array(n).fill(NaN)} : null;
  let union = 0, xor = 0, both = 0, other = 0, referenceCoverage = 0;
  const normalUndefined = {reference: 0, level: 0};
  const depth = [], normal = [], albedo = [], meanR = [0, 0, 0], meanL = [0, 0, 0];
  for (let p = 0; p < n; p++) {
    const rc = R.g[p * 4] > 0, lc = L.g[p * 4] > 0;
    if (rc) referenceCoverage++;
    if (rc || lc) union++;
    if (rc !== lc) xor++;
    if (out) out.coverage[p] = rc && lc ? 1 : rc ? 2 : lc ? 3 : 0;
    if (!(rc && lc)) continue;
    both++;
    const de = Math.abs(R.g[p * 4] - L.g[p * 4]) / diagonal; depth.push(de); if (out) out.depth[p] = de;
    if (de > sameSurface) { other++; continue; }
    let dot = 0, rl = 0, ll = 0;
    for (let k = 1; k <= 3; k++) { const r = R.g[p * 4 + k] * 2 - 1, l = L.g[p * 4 + k] * 2 - 1; dot += r * l; rl += r * r; ll += l * l; }
    const rOk = rl > 1e-6, lOk = ll > 1e-6; // false for NaN as well as zero
    if (!rOk) normalUndefined.reference++;
    if (!lOk) normalUndefined.level++;
    let ne = NaN;
    if (rOk && lOk) { ne = Math.acos(Math.max(-1, Math.min(1, dot / Math.sqrt(rl * ll)))) * 180 / Math.PI; normal.push(ne); }
    let ae = 0; for (let c = 0; c < 3; c++) { ae += Math.abs(R.a[p * 3 + c] - L.a[p * 3 + c]); meanR[c] += R.a[p * 3 + c]; meanL[c] += L.a[p * 3 + c]; }
    albedo.push(ae / 3);
    if (out) { out.normal[p] = ne; out.albedo[p] = ae / 3; }
  }
  const same = Math.max(1, albedo.length);
  const view = {referenceCoverage: referenceCoverage / n, silhouetteMismatch: union ? xor / union : 0, differentSurface: both ? other / both : 0,
    depth: stats(depth), normalDegrees: stats(normal), normalUndefined, albedo: stats(albedo),
    meanAlbedo: {reference: meanR.map(v => v / same), level: meanL.map(v => v / same)}};
  return out ? {view, maps: out} : {view};
}

// Spread of each per-view figure over the views; still one entry per channel.
export function aggregate(perView) {
  const over = key => stats(perView.map(key));
  return {silhouetteMismatch: over(v => v.silhouetteMismatch), differentSurface: over(v => v.differentSurface),
    depthP95: over(v => v.depth.p95), normalP95Degrees: over(v => v.normalDegrees.p95), normalMeanDegrees: over(v => v.normalDegrees.mean),
    albedoP95: over(v => v.albedo.p95)};
}
