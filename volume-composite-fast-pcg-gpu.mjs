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
  const mask0 = new Uint8Array(coarseCount), open0 = new Uint8Array(coarseCount);
  for (let c = 0; c < coarseCount; c++) mask0[c] = children[c].length ? 1 : 0;
  for (const f of grid.faces) if (f.b < 0) open0[parentOf[f.a]] |= 1 << (f.axis * 2 + (f.side > 0 ? 1 : 0));
  const levels = [{ shape: shape.slice(), width: grid.geometry.cellWidth, mask: mask0, open: open0 }];
  while (Math.max(...levels.at(-1).shape) > 4) {
    const prev = levels.at(-1);
    const next = { shape: prev.shape.map(v => Math.ceil(v / 2)), width: prev.width * 2 };
    const count = next.shape[0] * next.shape[1] * next.shape[2];
    next.mask = new Uint8Array(count); next.open = new Uint8Array(count);
    for (let z = 0; z < prev.shape[2]; z++) for (let y = 0; y < prev.shape[1]; y++) for (let x = 0; x < prev.shape[0]; x++) {
      const c = idx3([x, y, z], prev.shape), C = idx3([x >> 1, y >> 1, z >> 1], next.shape);
      next.mask[C] |= prev.mask[c]; next.open[C] |= prev.open[c];
    }
    if (next.shape.every((v, a) => v === prev.shape[a])) break;
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

// One workgroup folds the partials and takes the scalar decision.
// MODE 0 start: max residual -> active; failure on bad.
// MODE 1 alpha: alpha = rho / (d.q).
// MODE 2 converge: iterations += 1; active = max > TOL.
// MODE 3 beta: beta = rho' / rho (0 when rho = 0); rho = rho'.
// MODE 4 true residual -> ctrl[7].
// MODE 5 refresh: the true residual replaces the recursive one (residual
// replacement; the search direction is kept); active follows the true residual.
function reduceSource(groups, tolerance) {
  return /* wgsl */`
override MODE: u32 = 0u;
const GROUPS: u32 = ${groups}u; const TOL: f32 = ${Math.fround(tolerance)};
@group(0) @binding(0) var<storage, read> partial: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> ctrl: array<f32>;
fn finite(x: f32) -> bool { return abs(x) <= 3.402823466e38; }
fn combine(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> { return vec4<f32>(a.x + b.x, 0.0, max(a.z, b.z), max(a.w, b.w)); }
var<workgroup> scratch: array<vec4<f32>, 256>;
fn fail() { ctrl[6] = 1.0; ctrl[3] = 0.0; }
@compute @workgroup_size(256) fn reduce(@builtin(local_invocation_index) lane: u32) {
  var acc = vec4<f32>(0.0);
  for (var i = lane; i < GROUPS; i += 256u) { acc = combine(acc, partial[i]); }
  scratch[lane] = acc; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) { if (lane < stride) { scratch[lane] = combine(scratch[lane], scratch[lane + stride]); } workgroupBarrier(); }
  if (lane != 0u) { return; }
  let v = scratch[0];
  if (MODE == 0u) {
    ctrl[0] = 0.0; ctrl[2] = 0.0; ctrl[5] = 0.0; ctrl[6] = 0.0; ctrl[4] = v.z; ctrl[3] = select(0.0, 1.0, v.z > TOL);
    if (v.w > 0.0 || !finite(v.z)) { fail(); }
  } else if (MODE == 1u) {
    if (ctrl[3] == 0.0) { return; }
    if (v.w > 0.0 || !finite(v.x) || v.x <= 0.0 || ctrl[0] <= 0.0) { fail(); return; }
    ctrl[1] = ctrl[0] / v.x; if (!finite(ctrl[1])) { fail(); }
  } else if (MODE == 2u) {
    if (ctrl[3] == 0.0) { return; }
    ctrl[5] += 1.0; ctrl[4] = v.z;
    if (v.w > 0.0 || !finite(v.z)) { fail(); return; }
    if (v.z <= TOL) { ctrl[3] = 0.0; }
  } else if (MODE == 3u) {
    if (ctrl[3] == 0.0) { return; }
    if (v.w > 0.0 || !finite(v.x) || v.x <= 0.0) { fail(); return; }
    if (ctrl[0] > 0.0) { ctrl[2] = v.x / ctrl[0]; } else { ctrl[2] = 0.0; }
    ctrl[0] = v.x; if (!finite(ctrl[2])) { fail(); }
  } else if (MODE == 5u) {
    if (ctrl[6] != 0.0) { return; }
    if (v.w > 0.0 || !finite(v.z)) { fail(); return; }
    ctrl[4] = v.z;
    ctrl[3] = select(0.0, 1.0, v.z > TOL);
  } else {
    ctrl[7] = v.z; if (v.w > 0.0) { ctrl[6] = 1.0; }
  }
}
`;
}

// Structured level kernels (levels >= 1). lv: b, z, res, pad per cell. lmeta:
// bit 0 fluid, bits 1..6 open faces (axis*2+side). Rediscretised Poisson:
// same-width neighbour k = w, open face k = 2w, wall/solid nothing.
function levelSource(level, next) {
  const [X, Y, Z] = level.shape;
  const nextShape = next ? next.shape : [1, 1, 1];
  return /* wgsl */`
const X: u32 = ${X}u; const Y: u32 = ${Y}u; const Z: u32 = ${Z}u; const COUNT: u32 = ${X * Y * Z}u;
const NX: u32 = ${nextShape[0]}u; const NY: u32 = ${nextShape[1]}u; const NZ: u32 = ${nextShape[2]}u;
const W: f32 = ${level.width};
override COLOR: u32 = 0u;
@group(0) @binding(0) var<storage, read_write> lv: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> lmeta: array<u32>;
@group(0) @binding(2) var<storage, read> ctrl: array<f32>;
@group(0) @binding(3) var<storage, read_write> nextLv: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> nextMeta: array<u32>;
fn isActive() -> bool { return ctrl[3] > 0.0; }
fn lin(x: u32, y: u32, z: u32) -> u32 { return x + X * (y + Y * z); }
fn fluid(c: u32) -> bool { return (lmeta[c] & 1u) == 1u; }
struct Row { diag: f32, sum: f32 }
// diag and sum of k * z[neighbour]
fn row(x: u32, y: u32, z: u32, c: u32) -> Row {
  var diag = 0.0; var sum = 0.0; let bits = lmeta[c];
  let q = vec3<i32>(i32(x), i32(y), i32(z)); let s = vec3<i32>(i32(X), i32(Y), i32(Z));
  for (var axis = 0u; axis < 3u; axis++) {
    for (var side = 0u; side < 2u; side++) {
      var nb = q; nb[axis] += select(-1, 1, side == 1u);
      if (nb[axis] >= 0 && nb[axis] < s[axis]) {
        let j = lin(u32(nb.x), u32(nb.y), u32(nb.z));
        if (fluid(j)) { diag += W; sum += W * lv[j].y; continue; }
      }
      if (((bits >> (1u + axis * 2u + side)) & 1u) == 1u) { diag += 2.0 * W; }
    }
  }
  return Row(diag, sum);
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
// Next level: b = sum of this level's residual over the (up to 8) children; z = 0.
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
// z += next level's z at the parent
@compute @workgroup_size(${WG}) fn prolongFromNext(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x; if (c >= COUNT || !isActive() || !fluid(c)) { return; }
  let p = coords(c);
  lv[c].y += nextLv[(p.x / 2u) + NX * ((p.y / 2u) + NY * (p.z / 2u))].y;
}
`;
}

// Level 0 <-> level 1 transfers.
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
// level 1: b = sum of children's level-0 residual (qb.x); z = 0
@compute @workgroup_size(${WG}) fn restrict0(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x; if (c >= C1 || !isActive()) { return; }
  var sum = 0.0;
  for (var t = childStart[c]; t < childStart[c + 1u]; t++) { sum += qb[u32(child[t])].x; }
  lv1[c] = vec4<f32>(sum, 0.0, 0.0, 0.0);
}
// level 0: z += level-1 z at the parent
@compute @workgroup_size(${WG}) fn prolong0(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= N || !isActive()) { return; }
  state[i].w += lv1[u32(cellMeta[i * 2u + 1u].w)].y;
}
`;
}

export function createCompositeFastPCGGPU(device, grid, { tolerance = 1e-5, preconditioner = 'multigrid', smoothing = 1, coarsestSweeps = 8, omega = 1.0, refreshEvery = 8 } = {}) {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || Math.fround(tolerance) === 0) throw new Error('positive float32 tolerance required');
  if (!['diagonal', 'multigrid'].includes(preconditioner)) throw new Error('preconditioner must be diagonal or multigrid');
  if (!Number.isInteger(refreshEvery) || refreshEvery < 1) throw new Error('refreshEvery must be a positive integer');
  const structure = buildCompositeStructure(grid);
  const n = structure.cells, m = grid.faces.length, groups = Math.ceil(n / WG);
  if (!n || !m) throw new Error('solve requires nonempty cells and faces');
  if (Math.max(n, m) >= 2 ** 24) throw new Error('indices exceed exact float32 integer representation');
  if (Math.ceil(Math.max(n, m) / WG) > device.limits.maxComputeWorkgroupsPerDimension) throw new Error('dispatch exceeds device capacity');
  const hierarchy = buildCompositeHierarchy(grid);
  const owned = [], shaders = [];
  const alloc = (label, size, data) => {
    if (size > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)) throw new Error(`${label} exceeds device capacity`);
    const b = device.createBuffer({ label, size: Math.max(16, size), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    owned.push(b); if (data) device.queue.writeBuffer(b, 0, data); return b;
  };
  const shader = (label, code) => { const s = device.createShaderModule({ label, code }); shaders.push(s); return s; };
  const f32bits = i => new Float32Array(new Int32Array([i]).buffer)[0];
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
    buffers = {
      slots: alloc('fast PCG slots', slots.byteLength, slots),
      tails: alloc('fast PCG seam tails', tails.byteLength, tails),
      meta: alloc('fast PCG cell meta', meta.byteLength, meta),
      state: alloc('fast PCG state', n * 16),
      qb: alloc('fast PCG q/b/target', n * 16),
      partial: alloc('fast PCG partials', groups * 16),
      ctrl: alloc('fast PCG control', 32),
      faces: alloc('fast PCG faces', m * 16, Float32Array.from(grid.faces.flatMap(f => [f.a, f.b, f.area / f.distance, 0]))),
      flux: alloc('fast PCG shared flux', m * 4),
      cellFace: alloc('fast PCG cell faces', structure.cellFace.byteLength, structure.cellFace),
      cpuTarget: alloc('fast PCG CPU input target', n * 4),
      dummy: alloc('fast PCG unused level vectors', 16),
      dummyMeta: alloc('fast PCG unused level meta', 16),
      childStart: alloc('fast PCG parent child start', hierarchy.parentChildStart.byteLength, hierarchy.parentChildStart),
      child: alloc('fast PCG parent child', hierarchy.parentChild.byteLength, hierarchy.parentChild),
      levels: hierarchy.levels.map((L, k) => {
        const count = L.shape[0] * L.shape[1] * L.shape[2];
        const bits = new Uint32Array(count);
        for (let c = 0; c < count; c++) bits[c] = L.mask[c] | (L.open[c] << 1);
        return { lv: alloc(`fast PCG level ${k + 1} vectors`, count * 16), meta: alloc(`fast PCG level ${k + 1} meta`, bits.byteLength, bits), count };
      }),
    };
  } catch (e) { for (const b of owned) b.destroy(); throw e; }

  // Pipelines. The default device allows eight storage buffers per stage, so
  // each kernel family binds only what it reads: the iteration kernels the
  // seven core buffers, init the six it needs plus flux and cell faces,
  // project the state, control, flux and faces.
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
  const diag = preconditioner === 'diagonal' ? 1 : 0;
  const mkPipeline = (entryPoint, layouts, constants = {}) => device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: layouts.map(l => l.layout) }), compute: { module: level0Module, entryPoint, constants: { DIAG_PRECONDITION: diag, ...constants } } });
  const iter = (entryPoint, constants) => ({ pipeline: mkPipeline(entryPoint, [coreAll], constants), groups: [coreAll.group] });
  const pipelines = {
    init: { pipeline: mkPipeline('init', [coreInit, ioInit]), groups: [coreInit.group, ioInit.group] },
    project: { pipeline: mkPipeline('project', [coreProject, ioProject]), groups: [coreProject.group, ioProject.group] },
    matvec: iter('matvec'), update: iter('update'), dotrz: iter('dotrz'), direction: iter('direction'), trueResidual: iter('trueResidual'), residual: iter('residual'), refresh: iter('refresh'),
    smooth: [iter('smoothRB', { COLOR: 0, OMEGA: omega }), iter('smoothRB', { COLOR: 1, OMEGA: omega })],
  };
  // Target intake: copies the (CPU-uploaded or caller-owned) target into qb.z.
  const intakeModule = shader('fast composite PCG intake', /* wgsl */`
const N: u32 = ${n}u;
@group(0) @binding(0) var<storage, read> targetIn: array<f32>;
@group(0) @binding(1) var<storage, read_write> qb: array<vec4<f32>>;
@compute @workgroup_size(${WG}) fn intake(@builtin(global_invocation_id) id: vec3<u32>) { if (id.x < N) { qb[id.x].z = targetIn[id.x]; } }
`);
  const intakePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: intakeModule, entryPoint: 'intake' } });
  const intakeGroup = targetBuffer => device.createBindGroup({ layout: intakePipeline.getBindGroupLayout(0), entries: [targetBuffer, buffers.qb].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const reduceModule = shader('fast composite PCG reduce', reduceSource(groups, tolerance));
  const reducePipelines = [0, 1, 2, 3, 4, 5].map(MODE => device.createComputePipeline({ layout: 'auto', compute: { module: reduceModule, entryPoint: 'reduce', constants: { MODE } } }));
  const reduceGroups = reducePipelines.map(p => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [buffers.partial, buffers.ctrl].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
  // Multigrid pipelines.
  let transfer = null, levels = [];
  if (preconditioner === 'multigrid') {
    const tModule = shader('fast composite PCG transfer', transferSource(n, buffers.levels[0].count));
    const tTypes = ['storage', 'read-only-storage', 'read-only-storage', 'storage', 'read-only-storage', 'read-only-storage', 'read-only-storage'];
    const tLayout = device.createBindGroupLayout({ entries: tTypes.map((type, binding) => entry(binding, type)) });
    const tPipe = entryPoint => device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [tLayout] }), compute: { module: tModule, entryPoint } });
    const tEntries = [buffers.state, buffers.qb, buffers.meta, buffers.levels[0].lv, buffers.childStart, buffers.child, buffers.ctrl];
    const tGroup = device.createBindGroup({ layout: tLayout, entries: tEntries.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    transfer = { restrict0: { pipeline: tPipe('restrict0'), group: tGroup }, prolong0: { pipeline: tPipe('prolong0'), group: tGroup } };
    levels = hierarchy.levels.map((L, k) => {
      const next = hierarchy.levels[k + 1] ?? null;
      const module = shader(`fast composite PCG level ${k + 1}`, levelSource(L, next));
      const layout = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: binding === 0 || binding === 3 ? 'storage' : 'read-only-storage' } })) });
      const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const mk = (entryPoint, constants = {}) => device.createComputePipeline({ layout: pl, compute: { module, entryPoint, constants } });
      const nb = next ? buffers.levels[k + 1] : { lv: buffers.dummy, meta: buffers.dummyMeta };
      const group = device.createBindGroup({ layout, entries: [buffers.levels[k].lv, buffers.levels[k].meta, buffers.ctrl, nb.lv, nb.meta].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      return { count: buffers.levels[k].count, nextCount: next ? buffers.levels[k + 1].count : 0, group, smooth: [mk('smoothRB', { COLOR: 0 }), mk('smoothRB', { COLOR: 1 })], residual: mk('residual'), restrictNext: next ? mk('restrictNext') : null, prolongFromNext: next ? mk('prolongFromNext') : null };
    });
  }

  let generation = 0, encoded = -1, inputRoute = 'none', hasInput = false, destroyed = false, budget = 0, warm = false, hasPressure = false, lastDispatches = 0;
  const alive = () => { if (destroyed) throw new Error('fast PCG destroyed'); };
  const validate = iterations => { alive(); if (!Number.isInteger(iterations) || iterations < 0) throw new Error('explicit nonnegative iteration budget required'); };

  const encode = (encoder, targetBuffer, iterations, reset) => {
    if (reset) { encoder.clearBuffer(buffers.state); encoder.clearBuffer(buffers.ctrl); }
    const pass = encoder.beginComputePass({ label: 'fast composite PCG' });
    let dispatches = 0;
    const call = (pipeline, groupsList, count) => { pass.setPipeline(pipeline); groupsList.forEach((g, i) => pass.setBindGroup(i, g)); pass.dispatchWorkgroups(count); dispatches++; };
    const l0call = (entry, count = groups) => call(entry.pipeline, entry.groups, count);
    call(intakePipeline, [intakeGroup(targetBuffer)], groups);
    const reduce = mode => call(reducePipelines[mode], [reduceGroups[mode]], 1);
    const vcycle = () => {
      if (preconditioner !== 'multigrid') return;
      // Level 0: z starts at 0 (update/init zeroed it); smooth, residual, restrict.
      for (let s = 0; s < smoothing; s++) { l0call(pipelines.smooth[0]); l0call(pipelines.smooth[1]); }
      l0call(pipelines.residual);
      call(transfer.restrict0.pipeline, [transfer.restrict0.group], Math.ceil(levels[0].count / WG));
      const down = k => {
        const L = levels[k], wg = Math.ceil(L.count / WG);
        if (!L.restrictNext) { for (let s = 0; s < coarsestSweeps; s++) { call(L.smooth[0], [L.group], wg); call(L.smooth[1], [L.group], wg); } return; }
        for (let s = 0; s < smoothing; s++) { call(L.smooth[0], [L.group], wg); call(L.smooth[1], [L.group], wg); }
        call(L.residual, [L.group], wg);
        call(L.restrictNext, [L.group], Math.ceil(L.nextCount / WG));
        down(k + 1);
        call(L.prolongFromNext, [L.group], wg);
        for (let s = 0; s < smoothing; s++) { call(L.smooth[0], [L.group], wg); call(L.smooth[1], [L.group], wg); }
      };
      down(0);
      call(transfer.prolong0.pipeline, [transfer.prolong0.group], groups);
      for (let s = 0; s < smoothing; s++) { l0call(pipelines.smooth[0]); l0call(pipelines.smooth[1]); }
    };
    l0call(pipelines.init); reduce(0);
    vcycle(); l0call(pipelines.dotrz); reduce(3); l0call(pipelines.direction);
    for (let i = 0; i < iterations; i++) {
      l0call(pipelines.matvec); reduce(1);
      l0call(pipelines.update); reduce(2);
      if ((i + 1) % refreshEvery === 0 || i === iterations - 1) { l0call(pipelines.refresh); reduce(5); }
      vcycle(); l0call(pipelines.dotrz); reduce(3); l0call(pipelines.direction);
    }
    l0call(pipelines.trueResidual); reduce(4);
    l0call(pipelines.project, Math.ceil(m / WG));
    pass.end();
    lastDispatches = dispatches;
    warm = hasPressure && !reset; hasPressure = true; budget = iterations; hasInput = false; encoded = generation;
  };

  return {
    shaders, fluxBuffer: buffers.flux, structure, hierarchy,
    get dispatches() { return lastDispatches; },
    setInput(flux, target = new Float32Array(n)) {
      alive(); if (flux.length !== m || target.length !== n || !flux.every(Number.isFinite) || !target.every(Number.isFinite)) throw new Error('finite complete flux/target arrays required');
      const q = Float32Array.from(flux), t = Float32Array.from(target); if (!q.every(Number.isFinite) || !t.every(Number.isFinite)) throw new Error('input exceeds float32 range');
      const d = compositeDivergence(grid, q);
      for (const c of grid.components) if (!c.grounded) { const sum = c.ids.reduce((s, i) => s + (t[i] - d[i]) * grid.cells[i].volume, 0); if (Math.abs(sum) > tolerance * c.ids.reduce((s, i) => s + grid.cells[i].volume, 0)) throw new Error('sealed component has incompatible net source/flux'); }
      device.queue.writeBuffer(buffers.flux, 0, q); device.queue.writeBuffer(buffers.cpuTarget, 0, t); hasInput = true; generation++; inputRoute = 'cpu-upload';
    },
    encode(encoder, { iterations, reset = false } = {}) { validate(iterations); if (!hasInput) throw new Error('setInput required before projection'); encode(encoder, buffers.cpuTarget, iterations, reset); },
    encodeGPU(encoder, { targetBuffer, iterations, reset = false } = {}) {
      validate(iterations);
      if (!targetBuffer || targetBuffer.size !== n * 4 || !(targetBuffer.usage & GPUBufferUsage.STORAGE) || owned.includes(targetBuffer)) throw new Error('distinct complete GPU target storage required');
      generation++; inputRoute = 'gpu-buffers'; encode(encoder, targetBuffer, iterations, reset);
    },
    async readback() {
      alive(); if (encoded < 0 || encoded !== generation) throw new Error('current input has not been encoded');
      const captured = generation, b = device.createBuffer({ size: m * 4 + n * 32 + 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const e = device.createCommandEncoder();
        e.copyBufferToBuffer(buffers.flux, 0, b, 0, m * 4); e.copyBufferToBuffer(buffers.state, 0, b, m * 4, n * 16); e.copyBufferToBuffer(buffers.qb, 0, b, m * 4 + n * 16, n * 16); e.copyBufferToBuffer(buffers.ctrl, 0, b, m * 4 + n * 32, 32);
        device.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ);
        if (captured !== generation) throw new Error('projection changed during readback');
        const raw = b.getMappedRange(), flux = new Float32Array(raw.slice(0, m * 4)), state = new Float32Array(raw.slice(m * 4, m * 4 + n * 16)), qb = new Float32Array(raw.slice(m * 4 + n * 16, m * 4 + n * 32)), c = new Float32Array(raw.slice(m * 4 + n * 32));
        const pressure = Float32Array.from({ length: n }, (_, i) => state[i * 4]);
        const target = Float32Array.from({ length: n }, (_, i) => qb[i * 4 + 2]);
        const d = compositeDivergence(grid, flux), maxDivergenceError = d.reduce((s, v, i) => Math.max(s, Math.abs(v - target[i])), 0), targetFinite = target.every(Number.isFinite);
        const converged = c[6] === 0 && targetFinite && pressure.every(Number.isFinite) && Number.isFinite(maxDivergenceError) && maxDivergenceError <= tolerance;
        return { flux, pressure, target, divergence: d, converged, receipt: { identity: COMPOSITE_GRID_ID, route: FAST_PCG_ROUTE, preconditioner, inputRoute, generation: captured, iterations: c[5], iterationBudget: budget, warmStartRequested: warm, tolerance, maxDivergenceError, gpuTrueResidual: c[7], recursiveResidual: c[4], breakdown: c[6] !== 0, converged, targetFinite, cells: n, faces: m, levels: hierarchy.levels.map(L => L.shape), dispatches: lastDispatches, innerFeedback: true, liveFlame: false } };
      } finally { b.destroy(); }
    },
    destroy() { if (!destroyed) { owned.forEach(b => b.destroy()); destroyed = true; } },
  };
}
