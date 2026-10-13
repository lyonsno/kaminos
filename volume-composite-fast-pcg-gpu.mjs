import { compositeDivergence, COMPOSITE_GRID_ID } from './volume-composite-grid.mjs';

// Fast composite pressure solve: the same matrix as Sexy's composite grid
// (`volume-composite-grid.mjs`, one flux per face, two-point gradients), with
// the per-iteration work laid out for the GPU:
//  - six fixed neighbour slots per cell (index + coefficient) plus a short tail
//    for the coarse cells whose face against the fine box is tiled, instead of
//    a variable adjacency gather per cell;
//  - one matrix pass per iteration; the recursive residual is tracked, and the
//    true residual is measured once at the end;
//  - the two dot products and the convergence test ride on the kernels that
//    produce their operands, each followed by one single-workgroup reduce that
//    also takes the scalar decision;
//  - preconditioner `diagonal` (like-for-like with the PCG candidate) or
//    `multigrid`: one V-cycle on a geometric hierarchy (level 0 = the
//    composite, level 1 = the all-coarse grid, then halving), red-black
//    Gauss-Seidel smoothing, injection prolongation, summed restriction.
// Interface matches `createCompositePCGGPU` so the same conformance and cost
// harnesses drive it. Pressure is warm across steps unless `reset`.
export const FAST_PCG_ROUTE = 'gpu-composite-fast-pcg';

const idx3 = (q, s) => q[0] + s[0] * (q[1] + s[1] * q[2]);

// Fixed slots: slot k is axis k>>1, side k&1 (0 = lower neighbour, 1 = upper).
// Interior faces have `a` at the lower position along `axis` (the lower cell
// emits the face), so `a` takes the upper slot and `b` the lower slot; a tiled
// coarse face puts its first fine neighbour in the slot and the rest in the tail.
export function buildCompositeStructure(grid) {
  const n = grid.cells.length;
  const slotIndex = new Int32Array(n * 6).fill(-1);
  const slotCoefficient = new Float64Array(n * 6);
  const tails = Array.from({ length: n }, () => []);
  const place = (i, slot, j, k) => {
    if (slotIndex[i * 6 + slot] < 0) { slotIndex[i * 6 + slot] = j; slotCoefficient[i * 6 + slot] = k; } else tails[i].push([j, k]);
  };
  const cellFaces = Array.from({ length: n }, () => []);
  grid.faces.forEach((f, fi) => {
    cellFaces[f.a].push(fi * 2);
    if (f.b < 0) return;
    cellFaces[f.b].push(fi * 2 + 1);
    const k = f.area / f.distance;
    place(f.a, f.axis * 2 + 1, f.b, k);
    place(f.b, f.axis * 2, f.a, k);
  });
  const tailStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) tailStart[i + 1] = tailStart[i] + tails[i].length;
  const tailIndex = new Int32Array(tailStart[n]), tailCoefficient = new Float64Array(tailStart[n]);
  for (let i = 0; i < n; i++) tails[i].forEach(([j, k], t) => { tailIndex[tailStart[i] + t] = j; tailCoefficient[tailStart[i] + t] = k; });
  const faceStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) faceStart[i + 1] = faceStart[i] + cellFaces[i].length;
  const cellFace = new Int32Array(faceStart[n]);
  for (let i = 0; i < n; i++) cellFaces[i].forEach((v, t) => { cellFace[faceStart[i] + t] = v; });
  return {
    cells: n, slotIndex, slotCoefficient, tailStart, tailIndex, tailCoefficient,
    diagonal: Float64Array.from(grid.diagonal), volume: Float64Array.from(grid.cells, c => c.volume),
    faceStart, cellFace,
  };
}

export function applyCompositeStructure(s, p) {
  const out = new Float64Array(s.cells);
  for (let i = 0; i < s.cells; i++) {
    let v = s.diagonal[i] * p[i];
    for (let k = 0; k < 6; k++) { const j = s.slotIndex[i * 6 + k]; if (j >= 0) v -= s.slotCoefficient[i * 6 + k] * p[j]; }
    for (let t = s.tailStart[i]; t < s.tailStart[i + 1]; t++) v -= s.tailCoefficient[t] * p[s.tailIndex[t]];
    out[i] = v;
  }
  return out;
}

// Geometric hierarchy for the preconditioner. Level 0 is the composite itself
// (handled through the structure); `levels[0]` here is the all-coarse grid of
// the composite's coarse shape, each later level halves the shape. A level
// cell is fluid when any child is; its open-face bits are the union of its
// children's. Open faces come from the composite's boundary faces (b < 0).
export function buildCompositeHierarchy(grid) {
  const shape = grid.geometry.shape.slice();
  const n = grid.cells.length;
  const parentOf = new Int32Array(n);
  const coarseCount = shape[0] * shape[1] * shape[2];
  const children = Array.from({ length: coarseCount }, () => []);
  for (let i = 0; i < n; i++) { const c = idx3(grid.cells[i].coarse, shape); parentOf[i] = c; children[c].push(i); }
  const parentChildStart = new Uint32Array(coarseCount + 1);
  for (let c = 0; c < coarseCount; c++) parentChildStart[c + 1] = parentChildStart[c] + children[c].length;
  const parentChild = new Int32Array(parentChildStart[coarseCount]);
  for (let c = 0; c < coarseCount; c++) children[c].forEach((i, t) => { parentChild[parentChildStart[c] + t] = i; });
  // Each level's operator is the Galerkin product of the finer level with
  // piecewise-constant transfer: a level face coefficient is the sum of the
  // finer faces crossing it, and the open-boundary sum carries up likewise.
  // coef per cell: k[axis*2+side] x6, openSum, fluid.
  const unpack = (c, sh) => [c % sh[0], Math.floor(c / sh[0]) % sh[1], Math.floor(c / (sh[0] * sh[1]))];
  const coef0 = new Float64Array(coarseCount * 8);
  for (let c = 0; c < coarseCount; c++) coef0[c * 8 + 7] = children[c].length ? 1 : 0;
  for (const f of grid.faces) {
    const k = f.area / f.distance, pa = parentOf[f.a];
    if (f.b < 0) { coef0[pa * 8 + 6] += k; continue; }
    const pb = parentOf[f.b];
    if (pa === pb) continue;
    const qa = unpack(pa, shape), qb = unpack(pb, shape);
    const axis = [0, 1, 2].find(a => qa[a] !== qb[a]);
    if (axis === undefined || Math.abs(qa[axis] - qb[axis]) !== 1 || [0, 1, 2].some(a => a !== axis && qa[a] !== qb[a])) throw new Error('level-0 face joins non-adjacent parents');
    const upper = qb[axis] > qa[axis];
    coef0[pa * 8 + axis * 2 + (upper ? 1 : 0)] += k;
    coef0[pb * 8 + axis * 2 + (upper ? 0 : 1)] += k;
  }
  const levels = [{ shape: shape.slice(), width: grid.geometry.cellWidth, coef: coef0, mask: Uint8Array.from({ length: coarseCount }, (_, c) => coef0[c * 8 + 7]) }];
  while (Math.max(...levels.at(-1).shape) > 4) {
    const prev = levels.at(-1);
    const next = { shape: prev.shape.map(v => Math.ceil(v / 2)), width: prev.width * 2 };
    if (next.shape.every((v, a) => v === prev.shape[a])) break;
    const count = next.shape[0] * next.shape[1] * next.shape[2];
    next.coef = new Float64Array(count * 8);
    const pc = prev.shape[0] * prev.shape[1] * prev.shape[2];
    for (let c = 0; c < pc; c++) {
      const q = unpack(c, prev.shape), C = idx3([q[0] >> 1, q[1] >> 1, q[2] >> 1], next.shape);
      if (prev.coef[c * 8 + 7] > 0) next.coef[C * 8 + 7] = 1;
      next.coef[C * 8 + 6] += prev.coef[c * 8 + 6];
      for (let axis = 0; axis < 3; axis++) for (let side = 0; side < 2; side++) {
        const k = prev.coef[c * 8 + axis * 2 + side]; if (!(k > 0)) continue;
        const nq = q.slice(); nq[axis] += side ? 1 : -1;
        if ((nq[axis] >> 1) !== (q[axis] >> 1)) next.coef[C * 8 + axis * 2 + side] += k;
      }
    }
    next.mask = Uint8Array.from({ length: count }, (_, c) => next.coef[c * 8 + 7]);
    levels.push(next);
  }
  return { parentOf, parentChildStart, parentChild, levels };
}

const WG = 64;
const COMMON = /* wgsl */`
fn finite(x: f32) -> bool { return abs(x) <= 3.402823466e38; }
fn combine(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> { return vec4<f32>(a.x + b.x, 0.0, max(a.z, b.z), max(a.w, b.w)); }
var<workgroup> scratch: array<vec4<f32>, ${WG}>;
fn emit(value: vec4<f32>, lane: u32, group: u32) {
  scratch[lane] = value; workgroupBarrier();
  for (var stride = ${WG / 2}u; stride > 0u; stride /= 2u) { if (lane < stride) { scratch[lane] = combine(scratch[lane], scratch[lane + stride]); } workgroupBarrier(); }
  if (lane == 0u) { partial[group] = scratch[0]; }
}
`;

// Level-0 kernels. ctrl: 0 rho, 1 alpha, 2 beta, 3 active, 4 max residual,
// 5 iterations, 6 failure, 7 true residual.
function level0Source(n, m) {
  return /* wgsl */`
const N: u32 = ${n}u; const M: u32 = ${m}u;
override COLOR: u32 = 0u;
override DIAG_PRECONDITION: u32 = 0u;
override OMEGA: f32 = 1.0;
@group(0) @binding(0) var<storage, read> slots: array<vec2<f32>>;       // (index bits, coefficient) x6 per cell
@group(0) @binding(1) var<storage, read> tails: array<vec2<f32>>;       // (index bits, coefficient)
@group(0) @binding(2) var<storage, read> cellMeta: array<vec4<f32>>;        // 2i: diag, vol, tailStart, tailCount; 2i+1: faceStart, faceCount, color, parent
@group(0) @binding(3) var<storage, read_write> state: array<vec4<f32>>; // p, r, d, z
@group(0) @binding(4) var<storage, read_write> qb: array<vec4<f32>>;    // q (scratch), b, target, 0
@group(0) @binding(5) var<storage, read_write> partial: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> ctrl: array<f32>;
@group(1) @binding(0) var<storage, read_write> flux: array<f32>;
@group(1) @binding(1) var<storage, read> cellFace: array<i32>;          // face*2 + (1 if the cell is b)
@group(1) @binding(2) var<storage, read> faces: array<vec4<f32>>;       // a, b, k, 0
${COMMON}
fn isActive() -> bool { return ctrl[3] > 0.0; }
fn slotOf(i: u32, k: u32) -> vec2<f32> { return slots[i * 6u + k]; }
// Sum of coefficient * field over the cell's neighbours; field 0 = p, 1 = r, 2 = d, 3 = z.
fn gather(i: u32, field: u32) -> f32 {
  var v = 0.0;
  for (var k = 0u; k < 6u; k++) {
    let s = slotOf(i, k); let j = bitcast<i32>(s.x);
    if (j >= 0) { v += s.y * state[u32(j)][field]; }
  }
  let m0 = cellMeta[i * 2u];
  let start = u32(m0.z); let count = u32(m0.w);
  for (var t = 0u; t < count; t++) { let s = tails[start + t]; v += s.y * state[u32(bitcast<i32>(s.x))][field]; }
  return v;
}
fn applyField(i: u32, field: u32) -> f32 { return cellMeta[i * 2u].x * state[i][field] - gather(i, field); }

// b = target * vol - sum of signed fluxes (target was copied into qb.z by intake); r = b - A p; z = 0 (or r / diag); partial max|r|/vol.
@compute @workgroup_size(${WG}) fn init(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let i = id.x; var value = vec4<f32>(0.0);
  if (i < N) {
    let m0 = cellMeta[i * 2u]; let m1 = cellMeta[i * 2u + 1u];
    var sum = 0.0; var bad = 0.0;
    for (var t = 0u; t < u32(m1.y); t++) {
      let e = cellFace[u32(m1.x) + t]; let q = flux[u32(e) >> 1u];
      if ((e & 1) == 0) { sum += q; } else { sum -= q; }
      if (!finite(q)) { bad = 1.0; }
    }
    let tgt = qb[i].z;
    let b = tgt * m0.y - sum;
    let r = b - applyField(i, 0u);
    var z = 0.0; if (DIAG_PRECONDITION == 1u) { z = r / max(m0.x, 1e-30); }
    qb[i] = vec4<f32>(0.0, b, tgt, 0.0); state[i].y = r; state[i].w = z; state[i].z = 0.0;
    if (!finite(b) || !finite(r) || !finite(tgt) || !finite(state[i].x)) { bad = 1.0; }
    value = vec4<f32>(0.0, 0.0, abs(r) / m0.y, bad);
  }
  emit(value, lane, group.x);
}
// q = A d; partial d.q
@compute @workgroup_size(${WG}) fn matvec(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let i = id.x; var value = vec4<f32>(0.0);
  if (i < N && isActive()) { let q = applyField(i, 2u); qb[i].x = q; let v = state[i].z * q; value = vec4<f32>(v, 0.0, 0.0, select(1.0, 0.0, finite(v))); }
  emit(value, lane, group.x);
}
// p += alpha d; r -= alpha q; z = 0 (or r / diag); partial max|r|/vol
@compute @workgroup_size(${WG}) fn update(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let i = id.x; var value = vec4<f32>(0.0);
  if (i < N && isActive()) {
    let a = ctrl[1]; var s = state[i];
    s.x += a * s.z; s.y -= a * qb[i].x;
    let m0 = cellMeta[i * 2u];
    s.w = 0.0; if (DIAG_PRECONDITION == 1u) { s.w = s.y / max(m0.x, 1e-30); }
    state[i] = s;
    value = vec4<f32>(0.0, 0.0, abs(s.y) / m0.y, select(1.0, 0.0, finite(s.x) && finite(s.y)));
  }
  emit(value, lane, group.x);
}
// Red-black Gauss-Seidel on A z = r, one colour per dispatch.
@compute @workgroup_size(${WG}) fn smoothRB(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < N && isActive() && u32(cellMeta[i * 2u + 1u].z) == COLOR) {
    let m0 = cellMeta[i * 2u];
    let gs = (state[i].y + gather(i, 3u)) / max(m0.x, 1e-30);
    state[i].w = mix(state[i].w, gs, OMEGA);
  }
}
// q = r - A z (level-0 residual of the preconditioner solve)
@compute @workgroup_size(${WG}) fn residual(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i < N && isActive()) { qb[i].x = state[i].y - applyField(i, 3u); }
}
// partial r.z
@compute @workgroup_size(${WG}) fn dotrz(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let i = id.x; var value = vec4<f32>(0.0);
  if (i < N && isActive()) { let v = state[i].y * state[i].w; value = vec4<f32>(v, 0.0, 0.0, select(1.0, 0.0, finite(v))); }
  emit(value, lane, group.x);
}
// d = z + beta d
@compute @workgroup_size(${WG}) fn direction(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i < N && isActive()) { state[i].z = state[i].w + ctrl[2] * state[i].z; }
}
// Residual replacement: r = b - A p from the current pressure, z reset; partial
// max|r|/vol. Runs whether or not the recursive test has stopped the loop, so a
// drifted recursive residual cannot close the solve (reduce MODE 5 restarts it).
@compute @workgroup_size(${WG}) fn refresh(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let i = id.x; var value = vec4<f32>(0.0);
  if (i < N && ctrl[6] == 0.0) {
    let m0 = cellMeta[i * 2u]; let r = qb[i].y - applyField(i, 0u);
    var z = 0.0; if (DIAG_PRECONDITION == 1u) { z = r / max(m0.x, 1e-30); }
    state[i].y = r; state[i].w = z;
    value = vec4<f32>(0.0, 0.0, abs(r) / m0.y, select(1.0, 0.0, finite(r)));
  }
  emit(value, lane, group.x);
}
// p += z (plain multigrid iteration)
@compute @workgroup_size(${WG}) fn correct(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i < N && isActive()) { state[i].x += state[i].w; }
}
// partial max|b - A p|/vol (end-of-solve measurement; ignores active)
@compute @workgroup_size(${WG}) fn trueResidual(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let i = id.x; var value = vec4<f32>(0.0);
  if (i < N) { let m0 = cellMeta[i * 2u]; let t = qb[i].y - applyField(i, 0u); value = vec4<f32>(0.0, 0.0, abs(t) / m0.y, select(1.0, 0.0, finite(t))); }
  emit(value, lane, group.x);
}
// flux += k (p_a - p_b) unless the solve failed
@compute @workgroup_size(${WG}) fn project(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < M && ctrl[6] == 0.0) {
    let f = faces[i]; var pb = 0.0; if (f.y >= 0.0) { pb = state[u32(f.y)].x; }
    flux[i] += f.z * (state[u32(f.x)].x - pb);
  }
}
`;
}

// One workgroup folds the partials and takes the scalar decision. It also
// writes the indirect dispatch arguments every gated kernel reads, so a
// converged or failed solve encodes zero workgroups for the rest of its
// budget (the fixed cost of an empty dispatch remains).
// MODE 0 start: max residual -> active; failure on bad.
// MODE 1 alpha: alpha = rho / (d.q).
// MODE 2 converge: iterations += 1; the recursive residual decides whether a
//   verification (true residual) is scheduled: when it is below TOL, or every
//   REFRESH iterations.
// MODE 3 beta: beta = rho' / rho (0 when rho = 0); rho = rho'.
// MODE 4 true residual -> ctrl[7].
// MODE 5 refresh: the true residual replaces the recursive one (residual
//   replacement; the search direction is kept); active follows it.
// ctrl: 0 rho, 1 alpha, 2 beta, 3 active, 4 max residual, 5 iterations,
// 6 failure, 7 true residual, 8 verify requested.
// Indirect entries (vec4<u32>, x = workgroups): 0 level 0, 1.. per structured
// level, then ONE (single workgroup), then VERIFY (level 0, only when a
// verification is requested) and VERIFY_ONE.
function reduceSource(groups, tolerance, counts, refreshEvery) {
  const K = counts.length;
  return /* wgsl */`
override MODE: u32 = 0u;
override ALWAYS_VERIFY: u32 = 0u;
const GROUPS: u32 = ${groups}u; const TOL: f32 = ${Math.fround(tolerance)}; const REFRESH: f32 = ${refreshEvery}.0;
const K: u32 = ${K}u;
var<private> COUNTS: array<u32, ${K}> = array<u32, ${K}>(${counts.map(c => `${c}u`).join(', ')});
@group(0) @binding(0) var<storage, read> partial: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> ctrl: array<f32>;
@group(0) @binding(2) var<storage, read_write> indirect: array<vec4<u32>>;
fn finite(x: f32) -> bool { return abs(x) <= 3.402823466e38; }
fn combine(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> { return vec4<f32>(a.x + b.x, 0.0, max(a.z, b.z), max(a.w, b.w)); }
var<workgroup> scratch: array<vec4<f32>, 256>;
fn gate(on: bool) { for (var i = 0u; i < K; i++) { indirect[i] = vec4<u32>(select(0u, COUNTS[i], on), 1u, 1u, 0u); } }
fn verify(on: bool) { indirect[K] = vec4<u32>(select(0u, COUNTS[0], on), 1u, 1u, 0u); indirect[K + 1u] = vec4<u32>(select(0u, 1u, on), 1u, 1u, 0u); ctrl[8] = select(0.0, 1.0, on); }
fn fail() { ctrl[6] = 1.0; ctrl[3] = 0.0; gate(false); verify(false); }
fn stop() { ctrl[3] = 0.0; gate(false); verify(false); }
@compute @workgroup_size(256) fn reduce(@builtin(local_invocation_index) lane: u32) {
  var acc = vec4<f32>(0.0);
  for (var i = lane; i < GROUPS; i += 256u) { acc = combine(acc, partial[i]); }
  scratch[lane] = acc; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) { if (lane < stride) { scratch[lane] = combine(scratch[lane], scratch[lane + stride]); } workgroupBarrier(); }
  if (lane != 0u) { return; }
  let v = scratch[0];
  if (MODE == 0u) {
    ctrl[0] = 0.0; ctrl[2] = 0.0; ctrl[5] = 0.0; ctrl[6] = 0.0; ctrl[4] = v.z;
    let on = v.z > TOL; ctrl[3] = select(0.0, 1.0, on); gate(on); verify(on && ALWAYS_VERIFY == 1u);
    if (v.w > 0.0 || !finite(v.z)) { fail(); }
  } else if (MODE == 1u) {
    if (ctrl[3] == 0.0) { return; }
    if (v.w > 0.0 || !finite(v.x) || v.x <= 0.0 || ctrl[0] <= 0.0) { fail(); return; }
    ctrl[1] = ctrl[0] / v.x; if (!finite(ctrl[1])) { fail(); }
  } else if (MODE == 2u) {
    if (ctrl[3] == 0.0) { return; }
    ctrl[5] += 1.0; ctrl[4] = v.z;
    if (v.w > 0.0 || !finite(v.z)) { fail(); return; }
    verify(v.z <= TOL || (ctrl[5] - REFRESH * floor(ctrl[5] / REFRESH)) == 0.0);
  } else if (MODE == 3u) {
    if (ctrl[3] == 0.0) { return; }
    if (v.w > 0.0 || !finite(v.x) || v.x <= 0.0) { fail(); return; }
    if (ctrl[0] > 0.0) { ctrl[2] = v.x / ctrl[0]; } else { ctrl[2] = 0.0; }
    ctrl[0] = v.x; if (!finite(ctrl[2])) { fail(); }
  } else if (MODE == 5u) {
    if (ctrl[6] != 0.0 || ctrl[8] == 0.0) { return; }
    if (v.w > 0.0 || !finite(v.z)) { fail(); return; }
    ctrl[4] = v.z; if (ALWAYS_VERIFY == 1u) { ctrl[5] += 1.0; }
    if (v.z <= TOL) { stop(); } else { verify(ALWAYS_VERIFY == 1u); }
  } else {
    ctrl[7] = v.z; if (v.w > 0.0) { ctrl[6] = 1.0; }
  }
}
`;
}

// Structured level kernels for the first structured level (the all-coarse
// grid), which is too large for one workgroup. lv: b, z, res, pad per cell.
// lmeta: bit 0 fluid, bits 1..6 open faces (axis*2+side). Rediscretised
// Poisson: same-width neighbour k = w, open face k = 2w, wall/solid nothing.
// The next level lives at offset 0 of the fused buffer (or is absent).
function levelSource(level, next) {
  const [X, Y, Z] = level.shape;
  const nextShape = next ? next.shape : [1, 1, 1];
  return /* wgsl */`
const X: u32 = ${X}u; const Y: u32 = ${Y}u; const Z: u32 = ${Z}u; const COUNT: u32 = ${X * Y * Z}u;
const NX: u32 = ${nextShape[0]}u; const NY: u32 = ${nextShape[1]}u; const NZ: u32 = ${nextShape[2]}u;
override COLOR: u32 = 0u;
@group(0) @binding(0) var<storage, read_write> lv: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lcoef: array<vec4<f32>>;   // 2c: k0..k3; 2c+1: k4, k5, openSum, fluid
@group(0) @binding(2) var<storage, read> ctrl: array<f32>;
@group(0) @binding(3) var<storage, read_write> nextLv: array<vec4<f32>>;
fn isActive() -> bool { return ctrl[3] > 0.0; }
fn lin(x: u32, y: u32, z: u32) -> u32 { return x + X * (y + Y * z); }
fn fluid(c: u32) -> bool { return lcoef[c * 2u + 1u].w > 0.5; }
struct Row { diag: f32, sum: f32 }
fn row(x: u32, y: u32, z: u32, c: u32) -> Row {
  let a = lcoef[c * 2u]; let b = lcoef[c * 2u + 1u];
  let k = array<f32, 6>(a.x, a.y, a.z, a.w, b.x, b.y);
  var sum = 0.0;
  let q = vec3<i32>(i32(x), i32(y), i32(z));
  for (var axis = 0u; axis < 3u; axis++) {
    for (var side = 0u; side < 2u; side++) {
      let kk = k[axis * 2u + side]; if (kk <= 0.0) { continue; }
      var nb = q; nb[axis] += select(-1, 1, side == 1u);
      sum += kk * lv[lin(u32(nb.x), u32(nb.y), u32(nb.z))].y;
    }
  }
  return Row(a.x + a.y + a.z + a.w + b.x + b.y + b.z, sum);
}
fn coords(c: u32) -> vec3<u32> { return vec3<u32>(c % X, (c / X) % Y, c / (X * Y)); }
@compute @workgroup_size(${WG}) fn smoothRB(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x; if (c >= COUNT || !isActive() || !fluid(c)) { return; }
  let p = coords(c); if (((p.x + p.y + p.z) & 1u) != COLOR) { return; }
  let r = row(p.x, p.y, p.z, c);
  lv[c].y = (lv[c].x + r.sum) / max(r.diag, 1e-30);
}
@compute @workgroup_size(${WG}) fn residual(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x; if (c >= COUNT || !isActive()) { return; }
  if (!fluid(c)) { lv[c].z = 0.0; return; }
  let p = coords(c); let r = row(p.x, p.y, p.z, c);
  lv[c].z = lv[c].x - (r.diag * lv[c].y - r.sum);
}
@compute @workgroup_size(${WG}) fn restrictNext(@builtin(global_invocation_id) id: vec3<u32>) {
  let C = id.x; if (C >= NX * NY * NZ || !isActive()) { return; }
  let cx = C % NX; let cy = (C / NX) % NY; let cz = C / (NX * NY);
  var sum = 0.0;
  for (var dz = 0u; dz < 2u; dz++) { for (var dy = 0u; dy < 2u; dy++) { for (var dx = 0u; dx < 2u; dx++) {
    let x = cx * 2u + dx; let y = cy * 2u + dy; let z = cz * 2u + dz;
    if (x < X && y < Y && z < Z) { sum += lv[lin(x, y, z)].z; }
  } } }
  nextLv[C] = vec4<f32>(sum, 0.0, 0.0, 0.0);
}
@compute @workgroup_size(${WG}) fn prolongFromNext(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x; if (c >= COUNT || !isActive() || !fluid(c)) { return; }
  let p = coords(c);
  lv[c].y += nextLv[(p.x / 2u) + NX * ((p.y / 2u) + NY * (p.z / 2u))].y;
}
`;
}

// All structured levels after the first, fused into one single-workgroup
// kernel: the whole lower part of the V-cycle (smooth, residual, restrict,
// ..., coarsest sweeps, ..., prolong, smooth) in one dispatch with barriers
// between phases. The levels share one vector buffer and one meta buffer at
// the given offsets; the first fused level sits at offset 0.
const FUSED_WG = 256;
function fusedSource(levels, { smoothing, coarsestSweeps }) {
  const per = levels.map((L, j) => {
    const [X, Y, Z] = L.shape, count = X * Y * Z;
    return /* wgsl */`
const X${j}: u32 = ${X}u; const Y${j}: u32 = ${Y}u; const Z${j}: u32 = ${Z}u; const COUNT${j}: u32 = ${count}u; const OFF${j}: u32 = ${L.offset}u;
fn fluid${j}(c: u32) -> bool { return lcoef[(OFF${j} + c) * 2u + 1u].w > 0.5; }
fn row${j}(c: u32) -> Row {
  let a = lcoef[(OFF${j} + c) * 2u]; let b = lcoef[(OFF${j} + c) * 2u + 1u];
  let k = array<f32, 6>(a.x, a.y, a.z, a.w, b.x, b.y);
  var sum = 0.0;
  let q = vec3<i32>(i32(c % X${j}), i32((c / X${j}) % Y${j}), i32(c / (X${j} * Y${j})));
  for (var axis = 0u; axis < 3u; axis++) {
    for (var side = 0u; side < 2u; side++) {
      let kk = k[axis * 2u + side]; if (kk <= 0.0) { continue; }
      var nb = q; nb[axis] += select(-1, 1, side == 1u);
      sum += kk * lv[OFF${j} + u32(nb.x) + X${j} * (u32(nb.y) + Y${j} * u32(nb.z))].y;
    }
  }
  return Row(a.x + a.y + a.z + a.w + b.x + b.y + b.z, sum);
}
fn smooth${j}(lane: u32, color: u32) {
  for (var c = lane; c < COUNT${j}; c += ${FUSED_WG}u) {
    if (!fluid${j}(c)) { continue; }
    let x = c % X${j}; let y = (c / X${j}) % Y${j}; let z = c / (X${j} * Y${j});
    if (((x + y + z) & 1u) != color) { continue; }
    let r = row${j}(c); lv[OFF${j} + c].y = (lv[OFF${j} + c].x + r.sum) / max(r.diag, 1e-30);
  }
  sync();
}
fn residual${j}(lane: u32) {
  for (var c = lane; c < COUNT${j}; c += ${FUSED_WG}u) {
    if (!fluid${j}(c)) { lv[OFF${j} + c].z = 0.0; continue; }
    let r = row${j}(c); lv[OFF${j} + c].z = lv[OFF${j} + c].x - (r.diag * lv[OFF${j} + c].y - r.sum);
  }
  sync();
}
${j + 1 < levels.length ? /* wgsl */`
fn restrict${j}(lane: u32) {
  for (var C = lane; C < COUNT${j + 1}; C += ${FUSED_WG}u) {
    let cx = C % X${j + 1}; let cy = (C / X${j + 1}) % Y${j + 1}; let cz = C / (X${j + 1} * Y${j + 1});
    var sum = 0.0;
    for (var dz = 0u; dz < 2u; dz++) { for (var dy = 0u; dy < 2u; dy++) { for (var dx = 0u; dx < 2u; dx++) {
      let x = cx * 2u + dx; let y = cy * 2u + dy; let z = cz * 2u + dz;
      if (x < X${j} && y < Y${j} && z < Z${j}) { sum += lv[OFF${j} + x + X${j} * (y + Y${j} * z)].z; }
    } } }
    lv[OFF${j + 1} + C] = vec4<f32>(sum, 0.0, 0.0, 0.0);
  }
  sync();
}
fn prolong${j}(lane: u32) {
  for (var c = lane; c < COUNT${j}; c += ${FUSED_WG}u) {
    if (!fluid${j}(c)) { continue; }
    let x = c % X${j}; let y = (c / X${j}) % Y${j}; let z = c / (X${j} * Y${j});
    lv[OFF${j} + c].y += lv[OFF${j + 1} + (x / 2u) + X${j + 1} * ((y / 2u) + Y${j + 1} * (z / 2u))].y;
  }
  sync();
}` : ''}
`;
  });
  const last = levels.length - 1;
  const body = [];
  for (let j = 0; j < last; j++) {
    for (let s = 0; s < smoothing; s++) body.push(`smooth${j}(lane, 0u); smooth${j}(lane, 1u);`);
    body.push(`residual${j}(lane); restrict${j}(lane);`);
  }
  for (let s = 0; s < coarsestSweeps; s++) body.push(`smooth${last}(lane, 0u); smooth${last}(lane, 1u);`);
  for (let j = last - 1; j >= 0; j--) {
    body.push(`prolong${j}(lane);`);
    for (let s = 0; s < smoothing; s++) body.push(`smooth${j}(lane, 0u); smooth${j}(lane, 1u);`);
  }
  return /* wgsl */`
@group(0) @binding(0) var<storage, read_write> lv: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lcoef: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> ctrl: array<f32>;
struct Row { diag: f32, sum: f32 }
fn sync() { storageBarrier(); workgroupBarrier(); }
${per.join('\n')}
@compute @workgroup_size(${FUSED_WG}) fn coarseCycle(@builtin(local_invocation_index) lane: u32) {
  if (ctrl[3] == 0.0) { return; }
  ${body.join('\n  ')}
}
`;
}

// Level 0 <-> first structured level transfers.
function transferSource(n, coarseCount) {
  return /* wgsl */`
const N: u32 = ${n}u; const C1: u32 = ${coarseCount}u;
@group(0) @binding(0) var<storage, read_write> state: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> qb: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> cellMeta: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> lv1: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> childStart: array<u32>;
@group(0) @binding(5) var<storage, read> child: array<i32>;
@group(0) @binding(6) var<storage, read> ctrl: array<f32>;
fn isActive() -> bool { return ctrl[3] > 0.0; }
@compute @workgroup_size(${WG}) fn restrict0(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x; if (c >= C1 || !isActive()) { return; }
  var sum = 0.0;
  for (var t = childStart[c]; t < childStart[c + 1u]; t++) { sum += qb[u32(child[t])].x; }
  lv1[c] = vec4<f32>(sum, 0.0, 0.0, 0.0);
}
@compute @workgroup_size(${WG}) fn prolong0(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= N || !isActive()) { return; }
  state[i].w += lv1[u32(cellMeta[i * 2u + 1u].w)].y;
}
`;
}

// method 'pcg': conjugate gradients preconditioned by `preconditioner`
// ('diagonal' or 'multigrid'). method 'multigrid': plain V-cycle iteration
// (p += V(r)), verified by the true residual each cycle.
export function createCompositeFastPCGGPU(device, grid, { tolerance = 1e-5, method = 'pcg', preconditioner = 'multigrid', smoothing = 1, coarsestSweeps = 8, omega = 1.0, refreshEvery = 8 } = {}) {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || Math.fround(tolerance) === 0) throw new Error('positive float32 tolerance required');
  if (!['pcg', 'multigrid'].includes(method)) throw new Error('method must be pcg or multigrid');
  if (!['diagonal', 'multigrid'].includes(preconditioner)) throw new Error('preconditioner must be diagonal or multigrid');
  if (!Number.isInteger(refreshEvery) || refreshEvery < 1) throw new Error('refreshEvery must be a positive integer');
  const usesHierarchy = method === 'multigrid' || preconditioner === 'multigrid';
  const structure = buildCompositeStructure(grid);
  const n = structure.cells, m = grid.faces.length, groups = Math.ceil(n / WG);
  if (!n || !m) throw new Error('solve requires nonempty cells and faces');
  if (Math.max(n, m) >= 2 ** 24) throw new Error('indices exceed exact float32 integer representation');
  if (Math.ceil(Math.max(n, m) / WG) > device.limits.maxComputeWorkgroupsPerDimension) throw new Error('dispatch exceeds device capacity');
  const hierarchy = buildCompositeHierarchy(grid);
  const first = hierarchy.levels[0];
  const fused = hierarchy.levels.slice(1);
  let offset = 0; for (const L of fused) { L.offset = offset; offset += L.shape[0] * L.shape[1] * L.shape[2]; }
  const firstCount = first.shape[0] * first.shape[1] * first.shape[2];
  const owned = [], shaders = [];
  const alloc = (label, size, data, extraUsage = 0) => {
    if (size > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)) throw new Error(`${label} exceeds device capacity`);
    const b = device.createBuffer({ label, size: Math.max(16, size), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | extraUsage });
    owned.push(b); if (data) device.queue.writeBuffer(b, 0, data); return b;
  };
  const shader = (label, code) => { const s = device.createShaderModule({ label, code }); shaders.push(s); return s; };
  const f32bits = i => new Float32Array(new Int32Array([i]).buffer)[0];
  const coefOf = L => Float32Array.from(L.coef);
  // Indirect entries: level 0, first structured level, ONE, VERIFY, VERIFY_ONE.
  const counts = [groups, Math.ceil(firstCount / WG), 1];
  const IND = { L0: 0, L1: 1, ONE: 2, VERIFY: 3, VERIFY_ONE: 4 };
  let buffers;
  try {
    const slots = new Float32Array(n * 12);
    for (let i = 0; i < n * 6; i++) { slots[i * 2] = f32bits(structure.slotIndex[i]); slots[i * 2 + 1] = structure.slotCoefficient[i]; }
    const tailCount = structure.tailStart[n];
    const tails = new Float32Array(Math.max(1, tailCount) * 2);
    for (let t = 0; t < tailCount; t++) { tails[t * 2] = f32bits(structure.tailIndex[t]); tails[t * 2 + 1] = structure.tailCoefficient[t]; }
    const meta = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const c = grid.cells[i], color = (c.index[0] + c.index[1] + c.index[2]) & 1;
      meta.set([structure.diagonal[i], structure.volume[i], structure.tailStart[i], structure.tailStart[i + 1] - structure.tailStart[i],
        structure.faceStart[i], structure.faceStart[i + 1] - structure.faceStart[i], color, hierarchy.parentOf[i]], i * 8);
    }
    const fusedCoef = new Float32Array(Math.max(1, offset) * 8);
    for (const L of fused) fusedCoef.set(coefOf(L), L.offset * 8);
    buffers = {
      slots: alloc('fast PCG slots', slots.byteLength, slots),
      tails: alloc('fast PCG seam tails', tails.byteLength, tails),
      meta: alloc('fast PCG cell meta', meta.byteLength, meta),
      state: alloc('fast PCG state', n * 16),
      qb: alloc('fast PCG q/b/target', n * 16),
      partial: alloc('fast PCG partials', groups * 16),
      ctrl: alloc('fast PCG control', 48),
      indirectSrc: alloc('fast PCG indirect dispatch source', (counts.length + 2) * 16),
      indirect: (() => { const b = device.createBuffer({ label: 'fast PCG indirect dispatch', size: (counts.length + 2) * 16, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST }); owned.push(b); return b; })(),
      faces: alloc('fast PCG faces', m * 16, Float32Array.from(grid.faces.flatMap(f => [f.a, f.b, f.area / f.distance, 0]))),
      flux: alloc('fast PCG shared flux', m * 4),
      cellFace: alloc('fast PCG cell faces', structure.cellFace.byteLength, structure.cellFace),
      cpuTarget: alloc('fast PCG CPU input target', n * 4),
      childStart: alloc('fast PCG parent child start', hierarchy.parentChildStart.byteLength, hierarchy.parentChildStart),
      child: alloc('fast PCG parent child', hierarchy.parentChild.byteLength, hierarchy.parentChild),
      firstLv: alloc('fast PCG first level vectors', firstCount * 16),
      firstMeta: alloc('fast PCG first level coefficients', firstCount * 32, coefOf(first)),
      fusedLv: alloc('fast PCG fused level vectors', Math.max(1, offset) * 16),
      fusedMeta: alloc('fast PCG fused level coefficients', fusedCoef.byteLength, fusedCoef),
    };
  } catch (e) { for (const b of owned) b.destroy(); throw e; }

  // Pipelines. The default device allows eight storage buffers per stage, so
  // each kernel family binds only what it reads.
  const entry = (binding, type) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
  const coreTypes = ['read-only-storage', 'read-only-storage', 'read-only-storage', 'storage', 'storage', 'storage', 'storage'];
  const coreBuffers = ['slots', 'tails', 'meta', 'state', 'qb', 'partial', 'ctrl'].map(k => buffers[k]);
  const ioTypes = ['storage', 'read-only-storage', 'read-only-storage'];
  const ioBuffers = [buffers.flux, buffers.cellFace, buffers.faces];
  const subset = (types, bufs, bindings) => {
    const layout = device.createBindGroupLayout({ entries: bindings.map(b => entry(b, types[b])) });
    return { layout, group: device.createBindGroup({ layout, entries: bindings.map(b => ({ binding: b, resource: { buffer: bufs[b] } })) }) };
  };
  const coreAll = subset(coreTypes, coreBuffers, [0, 1, 2, 3, 4, 5, 6]);
  const coreInit = subset(coreTypes, coreBuffers, [0, 1, 2, 3, 4, 5]);
  const ioInit = subset(ioTypes, ioBuffers, [0, 1]);
  const coreProject = subset(coreTypes, coreBuffers, [3, 6]);
  const ioProject = subset(ioTypes, ioBuffers, [0, 2]);
  const level0Module = shader('fast composite PCG level 0', level0Source(n, m));
  const diag = preconditioner === 'diagonal' && method === 'pcg' ? 1 : 0;
  const mkPipeline = (entryPoint, layouts, constants = {}) => device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: layouts.map(l => l.layout) }), compute: { module: level0Module, entryPoint, constants: { DIAG_PRECONDITION: diag, ...constants } } });
  const iter = (entryPoint, constants) => ({ pipeline: mkPipeline(entryPoint, [coreAll], constants), groups: [coreAll.group], indirect: IND.L0 });
  const pipelines = {
    init: { pipeline: mkPipeline('init', [coreInit, ioInit]), groups: [coreInit.group, ioInit.group] },
    project: { pipeline: mkPipeline('project', [coreProject, ioProject]), groups: [coreProject.group, ioProject.group] },
    matvec: iter('matvec'), update: iter('update'), dotrz: iter('dotrz'), direction: iter('direction'), trueResidual: iter('trueResidual'), residual: iter('residual'), correct: iter('correct'),
    refresh: { ...iter('refresh'), indirect: IND.VERIFY },
    smooth: [iter('smoothRB', { COLOR: 0, OMEGA: omega }), iter('smoothRB', { COLOR: 1, OMEGA: omega })],
  };
  const intakeModule = shader('fast composite PCG intake', /* wgsl */`
const N: u32 = ${n}u;
@group(0) @binding(0) var<storage, read> targetIn: array<f32>;
@group(0) @binding(1) var<storage, read_write> qb: array<vec4<f32>>;
@compute @workgroup_size(${WG}) fn intake(@builtin(global_invocation_id) id: vec3<u32>) { if (id.x < N) { qb[id.x].z = targetIn[id.x]; } }
`);
  const intakePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: intakeModule, entryPoint: 'intake' } });
  const intakeGroup = targetBuffer => device.createBindGroup({ layout: intakePipeline.getBindGroupLayout(0), entries: [targetBuffer, buffers.qb].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const reduceModule = shader('fast composite PCG reduce', reduceSource(groups, tolerance, counts, refreshEvery));
  const reducePipelines = [0, 1, 2, 3, 4, 5].map(MODE => device.createComputePipeline({ layout: 'auto', compute: { module: reduceModule, entryPoint: 'reduce', constants: { MODE, ALWAYS_VERIFY: method === 'multigrid' ? 1 : 0 } } }));
  const reduceGroups = reducePipelines.map(p => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [buffers.partial, buffers.ctrl, buffers.indirectSrc].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
  // Hierarchy pipelines.
  let transfer = null, firstLevel = null, coarse = null;
  if (usesHierarchy) {
    const tModule = shader('fast composite PCG transfer', transferSource(n, firstCount));
    const tTypes = ['storage', 'read-only-storage', 'read-only-storage', 'storage', 'read-only-storage', 'read-only-storage', 'read-only-storage'];
    const tLayout = device.createBindGroupLayout({ entries: tTypes.map((type, binding) => entry(binding, type)) });
    const tPipe = entryPoint => device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [tLayout] }), compute: { module: tModule, entryPoint } });
    const tGroup = device.createBindGroup({ layout: tLayout, entries: [buffers.state, buffers.qb, buffers.meta, buffers.firstLv, buffers.childStart, buffers.child, buffers.ctrl].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    transfer = { restrict0: { pipeline: tPipe('restrict0'), group: tGroup }, prolong0: { pipeline: tPipe('prolong0'), group: tGroup } };
    const lModule = shader('fast composite PCG first level', levelSource(first, fused[0] ?? null));
    const lLayout = device.createBindGroupLayout({ entries: [entry(0, 'storage'), entry(1, 'read-only-storage'), entry(2, 'read-only-storage'), entry(3, 'storage')] });
    const lPl = device.createPipelineLayout({ bindGroupLayouts: [lLayout] });
    const lmk = (entryPoint, constants = {}) => device.createComputePipeline({ layout: lPl, compute: { module: lModule, entryPoint, constants } });
    firstLevel = {
      group: device.createBindGroup({ layout: lLayout, entries: [buffers.firstLv, buffers.firstMeta, buffers.ctrl, buffers.fusedLv].map((buffer, binding) => ({ binding, resource: { buffer } })) }),
      smooth: [lmk('smoothRB', { COLOR: 0 }), lmk('smoothRB', { COLOR: 1 })], residual: lmk('residual'), restrictNext: fused.length ? lmk('restrictNext') : null, prolongFromNext: fused.length ? lmk('prolongFromNext') : null,
    };
    if (fused.length) {
      const cModule = shader('fast composite PCG fused coarse levels', fusedSource(fused, { smoothing, coarsestSweeps }));
      const cLayout = device.createBindGroupLayout({ entries: [entry(0, 'storage'), entry(1, 'read-only-storage'), entry(2, 'read-only-storage')] });
      coarse = {
        pipeline: device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [cLayout] }), compute: { module: cModule, entryPoint: 'coarseCycle' } }),
        group: device.createBindGroup({ layout: cLayout, entries: [buffers.fusedLv, buffers.fusedMeta, buffers.ctrl].map((buffer, binding) => ({ binding, resource: { buffer } })) }),
      };
    }
  }

  let generation = 0, encoded = -1, inputRoute = 'none', hasInput = false, destroyed = false, budget = 0, warm = false, hasPressure = false, lastDispatches = 0, lastPasses = 0;
  const alive = () => { if (destroyed) throw new Error('fast PCG destroyed'); };
  const validate = iterations => { alive(); if (!Number.isInteger(iterations) || iterations < 0) throw new Error('explicit nonnegative iteration budget required'); };

  // A buffer cannot be written as storage and read as indirect arguments in
  // one compute pass, so the gate decisions land in `indirectSrc` and each
  // decision point ends the pass, copies the arguments across, and begins the
  // next pass. `timestampWrites` ({ querySet, base }) stamps every pass; the
  // caller sums the pairs (`passesFor(iterations)` sizes the query set).
  const encode = (encoder, targetBuffer, iterations, reset, timestampWrites = null) => {
    if (reset) { encoder.clearBuffer(buffers.state); encoder.clearBuffer(buffers.ctrl); }
    let pass = null, passes = 0, dispatches = 0;
    // Timestamps are only ordered within one pass on this route, so each pass
    // gets its own begin/end pair: indices base + 2*pass, base + 2*pass + 1.
    const begin = () => {
      const descriptor = { label: 'fast composite PCG' };
      if (timestampWrites) descriptor.timestampWrites = { querySet: timestampWrites.querySet, beginningOfPassWriteIndex: (timestampWrites.base ?? 0) + passes * 2, endOfPassWriteIndex: (timestampWrites.base ?? 0) + passes * 2 + 1 };
      pass = encoder.beginComputePass(descriptor); passes++;
    };
    const flushGate = () => { pass.end(); encoder.copyBufferToBuffer(buffers.indirectSrc, 0, buffers.indirect, 0, buffers.indirect.size); begin(); };
    begin();
    const direct = (pipeline, groupsList, count) => { pass.setPipeline(pipeline); groupsList.forEach((g, i) => pass.setBindGroup(i, g)); pass.dispatchWorkgroups(count); dispatches++; };
    const gated = (pipeline, groupsList, slot) => { pass.setPipeline(pipeline); groupsList.forEach((g, i) => pass.setBindGroup(i, g)); pass.dispatchWorkgroupsIndirect(buffers.indirect, slot * 16); dispatches++; };
    const l0 = e => gated(e.pipeline, e.groups, e.indirect);
    const reduce = mode => gated(reducePipelines[mode], [reduceGroups[mode]], mode === 5 ? IND.VERIFY_ONE : IND.ONE);
    const vcycle = () => {
      for (let s = 0; s < smoothing; s++) { l0(pipelines.smooth[0]); l0(pipelines.smooth[1]); }
      l0(pipelines.residual);
      gated(transfer.restrict0.pipeline, [transfer.restrict0.group], IND.L1);
      const F = firstLevel;
      if (!F.restrictNext) {
        for (let s = 0; s < coarsestSweeps; s++) { gated(F.smooth[0], [F.group], IND.L1); gated(F.smooth[1], [F.group], IND.L1); }
      } else {
        for (let s = 0; s < smoothing; s++) { gated(F.smooth[0], [F.group], IND.L1); gated(F.smooth[1], [F.group], IND.L1); }
        gated(F.residual, [F.group], IND.L1);
        // restrictNext runs over the next level's cells: a direct dispatch of its
        // group count would do; it is gated through L1 (a superset of workgroups
        // whose extra threads exit on the bound) so the converged path stays empty.
        gated(F.restrictNext, [F.group], IND.L1);
        gated(coarse.pipeline, [coarse.group], IND.ONE);
        gated(F.prolongFromNext, [F.group], IND.L1);
        for (let s = 0; s < smoothing; s++) { gated(F.smooth[0], [F.group], IND.L1); gated(F.smooth[1], [F.group], IND.L1); }
      }
      gated(transfer.prolong0.pipeline, [transfer.prolong0.group], IND.L0);
      for (let s = 0; s < smoothing; s++) { l0(pipelines.smooth[0]); l0(pipelines.smooth[1]); }
    };
    direct(intakePipeline, [intakeGroup(targetBuffer)], groups);
    direct(pipelines.init.pipeline, pipelines.init.groups, groups); direct(reducePipelines[0], [reduceGroups[0]], 1);
    flushGate();
    if (method === 'pcg') {
      if (preconditioner === 'multigrid') vcycle();
      l0(pipelines.dotrz); reduce(3); l0(pipelines.direction);
      for (let i = 0; i < iterations; i++) {
        l0(pipelines.matvec); reduce(1);
        l0(pipelines.update); reduce(2);
        flushGate();
        l0(pipelines.refresh); reduce(5);
        flushGate();
        if (preconditioner === 'multigrid') vcycle();
        l0(pipelines.dotrz); reduce(3); l0(pipelines.direction);
      }
    } else {
      // Plain V-cycles: z = V(r); p += z; r = b - A p (verified every cycle).
      for (let i = 0; i < iterations; i++) {
        vcycle(); l0(pipelines.correct); l0(pipelines.refresh); reduce(5);
        flushGate();
      }
    }
    flushGate();
    direct(pipelines.trueResidual.pipeline, pipelines.trueResidual.groups, groups); direct(reducePipelines[4], [reduceGroups[4]], 1);
    direct(pipelines.project.pipeline, pipelines.project.groups, Math.ceil(m / WG));
    pass.end();
    lastDispatches = dispatches; lastPasses = passes;
    warm = hasPressure && !reset; hasPressure = true; budget = iterations; hasInput = false; encoded = generation;
  };

  return {
    shaders, fluxBuffer: buffers.flux, structure, hierarchy,
    get dispatches() { return lastDispatches; },
    get passes() { return lastPasses; },
    passesFor(iterations) { return method === 'pcg' ? 3 + 2 * iterations : 2 + iterations; },
    setInput(flux, target = new Float32Array(n)) {
      alive(); if (flux.length !== m || target.length !== n || !flux.every(Number.isFinite) || !target.every(Number.isFinite)) throw new Error('finite complete flux/target arrays required');
      const q = Float32Array.from(flux), t = Float32Array.from(target); if (!q.every(Number.isFinite) || !t.every(Number.isFinite)) throw new Error('input exceeds float32 range');
      const d = compositeDivergence(grid, q);
      for (const c of grid.components) if (!c.grounded) { const sum = c.ids.reduce((s, i) => s + (t[i] - d[i]) * grid.cells[i].volume, 0); if (Math.abs(sum) > tolerance * c.ids.reduce((s, i) => s + grid.cells[i].volume, 0)) throw new Error('sealed component has incompatible net source/flux'); }
      device.queue.writeBuffer(buffers.flux, 0, q); device.queue.writeBuffer(buffers.cpuTarget, 0, t); hasInput = true; generation++; inputRoute = 'cpu-upload';
    },
    encode(encoder, { iterations, reset = false, timestampWrites = null } = {}) { validate(iterations); if (!hasInput) throw new Error('setInput required before projection'); encode(encoder, buffers.cpuTarget, iterations, reset, timestampWrites); },
    encodeGPU(encoder, { targetBuffer, iterations, reset = false, timestampWrites = null } = {}) {
      validate(iterations);
      if (!targetBuffer || targetBuffer.size !== n * 4 || !(targetBuffer.usage & GPUBufferUsage.STORAGE) || owned.includes(targetBuffer)) throw new Error('distinct complete GPU target storage required');
      generation++; inputRoute = 'gpu-buffers'; encode(encoder, targetBuffer, iterations, reset, timestampWrites);
    },
    async readback() {
      alive(); if (encoded < 0 || encoded !== generation) throw new Error('current input has not been encoded');
      const captured = generation, b = device.createBuffer({ size: m * 4 + n * 32 + 48, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const e = device.createCommandEncoder();
        e.copyBufferToBuffer(buffers.flux, 0, b, 0, m * 4); e.copyBufferToBuffer(buffers.state, 0, b, m * 4, n * 16); e.copyBufferToBuffer(buffers.qb, 0, b, m * 4 + n * 16, n * 16); e.copyBufferToBuffer(buffers.ctrl, 0, b, m * 4 + n * 32, 48);
        device.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ);
        if (captured !== generation) throw new Error('projection changed during readback');
        const raw = b.getMappedRange(), flux = new Float32Array(raw.slice(0, m * 4)), state = new Float32Array(raw.slice(m * 4, m * 4 + n * 16)), qb = new Float32Array(raw.slice(m * 4 + n * 16, m * 4 + n * 32)), c = new Float32Array(raw.slice(m * 4 + n * 32));
        const pressure = Float32Array.from({ length: n }, (_, i) => state[i * 4]);
        const target = Float32Array.from({ length: n }, (_, i) => qb[i * 4 + 2]);
        const d = compositeDivergence(grid, flux), maxDivergenceError = d.reduce((s, v, i) => Math.max(s, Math.abs(v - target[i])), 0), targetFinite = target.every(Number.isFinite);
        const converged = c[6] === 0 && targetFinite && pressure.every(Number.isFinite) && Number.isFinite(maxDivergenceError) && maxDivergenceError <= tolerance;
        return { flux, pressure, target, divergence: d, converged, receipt: { identity: COMPOSITE_GRID_ID, route: FAST_PCG_ROUTE, method, preconditioner: method === 'pcg' ? preconditioner : 'none', smoothing, coarsestSweeps, inputRoute, generation: captured, iterations: c[5], iterationBudget: budget, warmStartRequested: warm, tolerance, maxDivergenceError, gpuTrueResidual: c[7], recursiveResidual: c[4], breakdown: c[6] !== 0, converged, targetFinite, cells: n, faces: m, levels: hierarchy.levels.map(L => L.shape), dispatches: lastDispatches, passes: lastPasses, innerFeedback: true, liveFlame: false } };
      } finally { b.destroy(); }
    },
    destroy() { if (!destroyed) { owned.forEach(b => b.destroy()); destroyed = true; } },
  };
}
