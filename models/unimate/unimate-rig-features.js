// Skeleton conditioning for a new rig, computed in the browser the way UniMate's preprocessing
// (data_process/rig_preprocess, utils/skeleton.py and utils/topology.py) and its inference
// dataset (unimate/dataset/conditioning.py) compute it:
//
// - bfsOrder: joints breadth-first from the root, each joint's children by subtree size
//   (largest first), then bone length (shortest first), then their original order.
// - canonicalizeRest: turn the rest pose to face +Z, put the root over the origin, scale the
//   skeleton's tree diameter (summed bone lengths along its longest path) to 2, then ground it.
// - topology: joint depths, pairwise relations (0 self, 1 parent, 2 child, 3 sibling, 4 none,
//   5 on a leaf's diagonal) and graph distances clamped to 5.
// - spectralFeatures: the 8 smallest non-trivial eigenvectors of the normalized Laplacian
//   I - D^-1/2 A D^-1/2, each scaled to unit length, zero-padded for small skeletons.
// - skeletonConditioning: all of the above plus the rest pose as 12-D motion features
//   (position, identity rotation in 6D, zero velocity), normalized with the model's root and
//   joint statistics; tposParents copies each joint's parent row.
//
// All arithmetic is float64; outputs are float32 / int32 like the exported bundles.

// The released model's normalization statistics (dataset_stats.npy of unimate_uniml3d_f60_v3,
// the same for every skeleton): row 0 is the root, every other joint uses the local row.
export const UNIMATE_STATS = {
  meanRoot: Float32Array.from([0.0, 0.6336892247200012, 0.0, 0.8751117587089539, 0.0, 0.019100574776530266, 0.0, 1.0, 0.0, -2.965589374070987e-05, -0.0002424663252895698, 0.00199503218755126]),
  stdRoot: Float32Array.from([9.99999993922529e-09, 0.2575699985027313, 9.99999993922529e-09, 0.34596070647239685, 9.99999993922529e-09, 0.3378250002861023, 9.99999993922529e-09, 9.99999993922529e-09, 9.99999993922529e-09, 0.008597022853791714, 0.012492304667830467, 0.016221370548009872]),
  meanLocal: Float32Array.from([0.005389598663896322, 0.6580477356910706, 0.11634606868028641, 0.8839133977890015, 3.766495137824677e-05, -0.0040334551595151424, -0.002283016685396433, 0.8641964793205261, 0.01581546664237976, 7.011938691903197e-07, -0.00021781495888717473, 0.0017208107747137547]),
  stdLocal: Float32Array.from([0.21756397187709808, 0.4045361578464508, 0.2280835509300232, 0.24027802050113678, 0.2976488173007965, 0.26898419857025146, 0.3014633059501648, 0.2475081980228424, 0.31744083762168884, 0.019386809319257736, 0.023225940763950348, 0.026975031942129135]),
};
export const MAX_JOINTS = 71, FEATURES = 12, SPECTRAL = 8, MAX_PATH = 5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);

function childrenOf(parents) {
  const children = parents.map(() => []);
  parents.forEach((p, j) => { if (p >= 0) children[p].push(j); });
  return children;
}

// Breadth-first order. rest (optional, world positions) supplies bone lengths for tie-breaks.
// Returns { order (new index -> old index), parents (in the new order) }.
export function bfsOrder(parents, rest = null) {
  const roots = parents.map((p, j) => (p < 0 ? j : -1)).filter(j => j >= 0);
  if (roots.length !== 1) throw new Error(`a skeleton needs exactly one root joint (found ${roots.length})`);
  const children = childrenOf(parents);
  const size = parents.map(() => 1);
  const post = [];
  for (const stack = [roots[0]]; stack.length;) { const j = stack.pop(); post.push(j); stack.push(...children[j]); }
  for (let i = post.length - 1; i >= 0; i--) { const j = post[i]; if (parents[j] >= 0) size[parents[j]] += size[j]; }
  if (post.length !== parents.length) throw new Error('the joint hierarchy is not a single tree');
  const bone = j => (rest && parents[j] >= 0 ? len(sub(rest[j], rest[parents[j]])) : 0);
  const order = [];
  for (const queue = [roots[0]]; queue.length;) {
    const j = queue.shift();
    order.push(j);
    const kids = children[j].map((c, i) => ({ c, i })).sort((a, b) => (size[b.c] - size[a.c]) || (bone(a.c) - bone(b.c)) || (a.i - b.i));
    queue.push(...kids.map(k => k.c));
  }
  const slot = new Map(order.map((old, i) => [old, i]));
  return { order, parents: order.map(old => (parents[old] < 0 ? -1 : slot.get(parents[old]))) };
}

// Tree diameter: the longest path through the skeleton, measured in bone lengths
// (two farthest-node sweeps, the first from joint 0).
export function treeDiameter(rest, parents) {
  const adj = parents.map(() => []);
  parents.forEach((p, j) => { if (p >= 0) { const w = len(sub(rest[j], rest[p])); adj[j].push([p, w]); adj[p].push([j, w]); } });
  const far = start => {
    const dist = parents.map(() => -1);
    dist[start] = 0;
    for (const stack = [start]; stack.length;) {
      const u = stack.pop();
      for (const [v, w] of adj[u]) if (dist[v] < 0) { dist[v] = dist[u] + w; stack.push(v); }
    }
    let best = start;
    dist.forEach((d, j) => { if (d > dist[best]) best = j; });
    return [best, dist[best]];
  };
  return far(far(0)[0])[1];
}

// Facing: { forward: [x, y, z] } directly, or { right, left } joint indices (the facing pair:
// forward = up x (right - left)), or { right, left, bodyAxis: true } for a head/tail pair.
export function facingDirection(rest, facing) {
  if (!facing) return null;
  if (facing.forward) return facing.forward;
  const across = sub(rest[facing.right], rest[facing.left]);
  let f = [across[2], 0, -across[0]];                         // cross([0, 1, 0], across)
  if (facing.bodyAxis) f = [-f[2], 0, f[0]];                 // Rot_Y(-90 deg)
  if (Math.hypot(f[0], f[2]) < 1e-9) throw new Error('the facing pair has no horizontal separation');
  return f;
}

// The similarity taking a rest pose to UniMate's canonical frame: x' = scale * (R x - [rx, 0, rz]) - [0, minY, 0],
// R the yaw turning the facing direction to +Z. apply(p) maps a point, rotation (columns) is R.
export function canonicalTransform(rest, parents, facing) {
  const f = facingDirection(rest, facing);
  const a = f ? Math.atan2(f[0], f[2]) : 0;                  // turn by -a about Y so f points at +Z
  const c = Math.cos(-a), s = Math.sin(-a);
  const turn = ([x, y, z]) => [x * c + z * s, y, -x * s + z * c];
  let p = rest.map(turn);
  const [rx, , rz] = p[0];
  p = p.map(([x, y, z]) => [x - rx, y, z - rz]);
  const scale = 2.0 / treeDiameter(p, parents);
  const minY = Math.min(...p.map(q => q[1] * scale));
  const apply = q => { const [x, y, z] = turn(q); return [scale * (x - rx), scale * y - minY, scale * (z - rz)]; };
  return { yaw: -a, scale, offset: [rx, rz, minY], rotation: [[c, 0, -s], [0, 1, 0], [s, 0, c]], apply };
}

// Rest pose in UniMate's canonical frame. rest: J x [x, y, z] world positions (Y up), root first.
export function canonicalizeRest(rest, parents, facing) {
  const { scale, offset: [rx, rz, minY] } = canonicalTransform(rest, parents, facing);
  const f = facingDirection(rest, facing);
  const a = f ? Math.atan2(f[0], f[2]) : 0;
  const c = Math.cos(-a), s = Math.sin(-a);
  let p = rest.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c]);
  p = p.map(([x, y, z]) => [x - rx, y, z - rz]);
  p = p.map(q => q.map(v => v * scale));
  p = p.map(([x, y, z]) => [x, y - minY, z]);
  p[0][0] = 0; p[0][2] = 0;                                  // exactly: the root's x, z statistics have std 1e-8
  return p;
}

export function topology(parents) {
  const J = parents.length, children = childrenOf(parents);
  const depths = new Int32Array(J);
  for (let j = 0; j < J; j++) depths[j] = parents[j] < 0 ? 0 : depths[parents[j]] + 1;   // parents precede children
  const jointRelations = new Int32Array(J * J).fill(4);
  for (let i = 0; i < J; i++) {
    const pi = parents[i];
    for (let j = 0; j < J; j++) {
      const pj = parents[j];
      let r = 4;
      if (i === j) r = 0;
      else if (pj === i) r = 2;
      else if (j === pi && pi !== -1) r = 1;
      else if (pi !== -1 && pj === pi) r = 3;
      jointRelations[i * J + j] = r;
    }
    if (!children[i].length) jointRelations[i * J + i] = 5;
  }
  const adj = parents.map(() => []);
  parents.forEach((p, j) => { if (p >= 0) { adj[j].push(p); adj[p].push(j); } });
  const graphDist = new Int32Array(J * J).fill(MAX_PATH);
  for (let s = 0; s < J; s++) {
    const dist = new Array(J).fill(Infinity);
    dist[s] = 0;
    for (const queue = [s]; queue.length;) {
      const u = queue.shift();
      if (dist[u] >= MAX_PATH) continue;
      for (const v of adj[u]) if (dist[v] > dist[u] + 1) { dist[v] = dist[u] + 1; queue.push(v); }
    }
    for (let t = 0; t < J; t++) graphDist[s * J + t] = Math.min(dist[t], MAX_PATH);
  }
  return { depths, jointRelations, graphDist };
}

// Symmetric eigendecomposition by cyclic Jacobi rotations (ascending eigenvalues; columns are
// eigenvectors). Ample for J <= 71.
export function symmetricEigen(A, n) {
  const a = Float64Array.from(A), v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k * n + p], akq = a[k * n + q];
        a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p * n + k], aqk = a[q * n + k];
        a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k * n + p], vkq = v[k * n + q];
        v[k * n + p] = c * vkp - s * vkq; v[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[x * n + x] - a[y * n + y]);
  return { values: idx.map(i => a[i * n + i]), vectors: idx.map(i => Array.from({ length: n }, (_, k) => v[k * n + i])) };
}

// (J x 8) float32, row-major; with withValues, also the ascending eigenvalues from column 1 on.
export function spectralFeatures(parents, { withValues = false } = {}) {
  const J = parents.length, k = Math.min(J - 1, SPECTRAL);
  const deg = new Float64Array(J), L = new Float64Array(J * J);
  parents.forEach((p, j) => { if (p >= 0) { deg[j]++; deg[p]++; } });
  for (let i = 0; i < J; i++) L[i * J + i] = deg[i] > 0 ? 1 : 0;
  parents.forEach((p, j) => {
    if (p < 0) return;
    const w = -1 / Math.sqrt(deg[j] * deg[p]);
    L[j * J + p] = w; L[p * J + j] = w;
  });
  const { values, vectors } = symmetricEigen(L, J);
  const out = new Float32Array(J * SPECTRAL);
  for (let q = 0; q < k; q++) {
    const col = vectors[q + 1], norm = Math.hypot(...col);
    for (let j = 0; j < J; j++) out[j * SPECTRAL + q] = norm > 1e-12 ? col[j] / norm : col[j];
  }
  return withValues ? { vectors: out, values: values.slice(1) } : out;
}

// Model conditioning for a skeleton already in canonical frame and BFS order.
// rest: J x [x, y, z]; parents: BFS-ordered, root first.
export function skeletonConditioning({ rest, parents }) {
  const J = parents.length;
  if (J < 2 || J > MAX_JOINTS) throw new Error(`UniMate animates skeletons of 2 to ${MAX_JOINTS} joints (this one has ${J})`);
  parents.forEach((p, j) => { if (j === 0 ? p !== -1 : !(p >= 0 && p < j)) throw new Error('joints must be in breadth-first order with the root first'); });
  const minY = Math.min(...rest.map(q => q[1]));
  const tpos = new Float32Array(J * FEATURES), mean = new Float32Array(J * FEATURES), std = new Float32Array(J * FEATURES);
  for (let j = 0; j < J; j++) {
    const m = j === 0 ? UNIMATE_STATS.meanRoot : UNIMATE_STATS.meanLocal, s = j === 0 ? UNIMATE_STATS.stdRoot : UNIMATE_STATS.stdLocal;
    const raw = [rest[j][0], rest[j][1] - minY, rest[j][2], 1, 0, 0, 0, 1, 0, 0, 0, 0];
    for (let d = 0; d < FEATURES; d++) {
      const v = (raw[d] - m[d]) / s[d];
      tpos[j * FEATURES + d] = Number.isFinite(v) ? v : 0;
      mean[j * FEATURES + d] = m[d]; std[j * FEATURES + d] = s[d];
    }
  }
  const tposParents = new Float32Array(tpos);
  parents.forEach((p, j) => { if (p >= 0) tposParents.set(tpos.subarray(p * FEATURES, (p + 1) * FEATURES), j * FEATURES); });
  return { tpos, tposParents, mean, std, ...topology(parents), spectral: spectralFeatures(parents),
    restPositions: Float32Array.from(rest.flat()) };
}
