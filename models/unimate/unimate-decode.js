// Decode UniMate motion features into a skeleton animation, matching upstream
// unimate.utils.motion_utils.recover_unimate_joint_pos_from_rot /
// recover_unimate_anim_from_rot (UniMate b78c7807, Holden Animation/Quaternions).
//
// features: Float32Array [T, J, 12], already denormalized (x * std + mean).
// Per joint: [0:3] RIFKE position, [3:9] 6D rotation in HML slot order
// (slot j holds the BVH rotation of parents[j]; slot 0 holds root facing),
// [9:12] local velocity. The root row carries height in [1] and XZ velocity
// in [9], [11].
//
// Returns world positions [T, J, 3], local (BVH-order) rotations [T, J, 4]
// as (w, x, y, z) with w >= 0, root translation [T, 3], root facing [T, 4],
// and the offsets used. Math is float64 except the 6D Gram-Schmidt, which
// upstream runs in the features' float32.

const f32 = Math.fround;
const AXIS_TOL = 1e-6, PARALLEL_TOL = 1e-6;

// Rest-pose offsets as upstream builds them for decoding: lowest rest-pose Y
// moved to 0, then parent-relative (root keeps its position), cast to float32.
export function groundedOffsets(tposFirstFrame, parents) {
  const J = parents.length, minY = Math.min(...tposFirstFrame.map(p => p[1]));
  const pos = tposFirstFrame.map(p => [p[0], p[1] - minY, p[2]]);
  const out = new Float32Array(J * 3);
  for (let j = 0; j < J; j++) {
    const p = parents[j];
    for (let c = 0; c < 3; c++) out[j * 3 + c] = p < 0 ? pos[j][c] : pos[j][c] - pos[p][c];
  }
  return out;
}

function norm3f(a, b, c) { return f32(Math.sqrt(f32(f32(f32(a * a) + f32(b * b)) + f32(c * c)))); }
function cross3f(a, b) {
  return [f32(f32(a[1] * b[2]) - f32(a[2] * b[1])), f32(f32(a[2] * b[0]) - f32(a[0] * b[2])), f32(f32(a[0] * b[1]) - f32(a[1] * b[0]))];
}

// 6D -> 3x3 rotation (row-major, columns are the Gram-Schmidt axes x, y, z), in
// float32 like _gram_schmidt_np on float32 input; degenerate input -> identity.
function sixdToMatrix(v) {
  const gs = s => {
    const nx = norm3f(s[0], s[1], s[2]);
    const x = [f32(s[0] / nx), f32(s[1] / nx), f32(s[2] / nx)];
    let z = cross3f(x, [s[3], s[4], s[5]]);
    const nz = norm3f(z[0], z[1], z[2]);
    z = [f32(z[0] / nz), f32(z[1] / nz), f32(z[2] / nz)];
    const y = cross3f(z, x);
    return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  };
  const m = gs(v);
  const nx = norm3f(v[0], v[1], v[2]), ny = norm3f(v[3], v[4], v[5]);
  const c = cross3f([f32(v[0] / nx), f32(v[1] / nx), f32(v[2] / nx)], [f32(v[3] / ny), f32(v[4] / ny), f32(v[5] / ny)]);
  const sine = norm3f(c[0], c[1], c[2]);
  const valid = v.every(Number.isFinite) && m.every(Number.isFinite) && nx > AXIS_TOL && ny > AXIS_TOL && sine > PARALLEL_TOL;
  return valid ? m : gs([1, 0, 0, 0, 1, 0]);
}

// Rotation matrix (row-major) -> unit quaternion (w, x, y, z), w >= 0 (Shepperd).
function matToQuat(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const cand = [1 + m00 + m11 + m22, 1 + m00 - m11 - m22, 1 - m00 + m11 - m22, 1 - m00 - m11 + m22];
  let b = 0;
  for (let i = 1; i < 4; i++) if (cand[i] > cand[b]) b = i;
  const s = 2 * Math.sqrt(Math.max(cand[b], 1e-12));
  let q;
  if (b === 0) q = [s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
  else if (b === 1) q = [(m21 - m12) / s, s / 4, (m10 + m01) / s, (m02 + m20) / s];
  else if (b === 2) q = [(m02 - m20) / s, (m10 + m01) / s, s / 4, (m21 + m12) / s];
  else q = [(m10 - m01) / s, (m02 + m20) / s, (m21 + m12) / s, s / 4];
  const n = Math.hypot(...q);
  q = q.map(x => x / n);
  return q[0] < 0 ? q.map(x => -x) : q;
}

function quatToMat([w, x, y, z]) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, yy = y * y2, wx = w * x2, xy = x * y2, yz = y * z2, wy = w * y2, xz = x * z2, zz = z * z2, wz = w * z2;
  return [1 - (yy + zz), xy - wz, xz + wy, xy + wz, 1 - (xx + zz), yz - wx, xz - wy, yz + wx, 1 - (xx + yy)];
}

// Largest-eigenvalue eigenvector of a symmetric 4x4 matrix (cyclic Jacobi).
function maxEigenvector4(a) {
  const A = a.map(r => r.slice()), V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] * A[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (A[i][i] > A[best][best]) best = i;
  return [V[0][best], V[1][best], V[2][best], V[3][best]];
}

// Nearest rotation to M (row-major 3x3) maximizing tr(R^T M): the SO(3) projection
// upstream computes as U @ Vt with the determinant sign fix. Horn's quaternion form.
function nearestRotationQuat(M) {
  // S = M^T: S[i][j] = M[j][i]
  const S = (i, j) => M[j * 3 + i];
  const [sxx, sxy, sxz, syx, syy, syz, szx, szy, szz] = [S(0, 0), S(0, 1), S(0, 2), S(1, 0), S(1, 1), S(1, 2), S(2, 0), S(2, 1), S(2, 2)];
  const N = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  let q = maxEigenvector4(N);
  const n = Math.hypot(...q);
  q = q.map(x => x / n);
  return q[0] < 0 ? q.map(x => -x) : q;
}

function qmul(a, b) {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}
function qrotate(q, v) {
  const r = qmul(qmul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
  return [r[1], r[2], r[3]];
}

export function decodeUniMateMotion({ features, frames: T, parents, offsets }) {
  const J = parents.length, Fe = 12, at = (t, j, c) => features[(t * J + j) * Fe + c];
  // Root facing and trajectory (recover_unimate_root_quat_and_pos).
  const rootFacing = new Float64Array(T * 4), rootTranslation = new Float64Array(T * 3);
  let acc = [0, 0, 0];
  for (let t = 0; t < T; t++) {
    const q = matToQuat(sixdToMatrix([3, 4, 5, 6, 7, 8].map(c => at(t, 0, c))));
    rootFacing.set(q, t * 4);
    const vel = t === 0 ? [0, 0, 0] : [at(t - 1, 0, 9), 0, at(t - 1, 0, 11)];
    const w = qrotate([q[0], -q[1], -q[2], -q[3]], vel);
    acc = [acc[0] + w[0], acc[1] + w[1], acc[2] + w[2]];
    rootTranslation.set([acc[0], at(t, 0, 1), acc[2]], t * 3);
  }
  // BVH-order local rotations: chordal mean of each parent's child-slot copies.
  const children = Array.from({ length: J }, () => []);
  parents.forEach((p, j) => { if (j > 0 && p >= 0) children[p].push(j); });
  const localRotations = new Float64Array(T * J * 4);
  for (let t = 0; t < T; t++) {
    const slot = Array.from({ length: J }, (_, j) => sixdToMatrix([3, 4, 5, 6, 7, 8].map(c => at(t, j, c))));
    for (let j = 0; j < J; j++) {
      let q = [1, 0, 0, 0];
      if (children[j].length) {
        const M = new Array(9).fill(0);
        for (const c of children[j]) for (let k = 0; k < 9; k++) M[k] += slot[c][k];
        q = nearestRotationQuat(M);
      }
      localRotations.set(q, (t * J + j) * 4);
    }
  }
  // Forward kinematics: global = parent global * local; root translated by the trajectory.
  const positions = new Float64Array(T * J * 3);
  for (let t = 0; t < T; t++) {
    const gq = new Array(J), gp = new Array(J);
    for (let j = 0; j < J; j++) {
      const lq = Array.from(localRotations.subarray((t * J + j) * 4, (t * J + j) * 4 + 4));
      const p = parents[j];
      if (p < 0) { gq[j] = lq; gp[j] = Array.from(rootTranslation.subarray(t * 3, t * 3 + 3)); }
      else {
        const Rm = quatToMat(gq[p]), o = [offsets[j * 3], offsets[j * 3 + 1], offsets[j * 3 + 2]];
        gp[j] = [0, 1, 2].map(r => gp[p][r] + Rm[r * 3] * o[0] + Rm[r * 3 + 1] * o[1] + Rm[r * 3 + 2] * o[2]);
        gq[j] = qmul(gq[p], lq);
      }
      positions.set(gp[j], (t * J + j) * 3);
    }
  }
  return { positions, localRotations, rootTranslation, rootFacing, offsets: Float32Array.from(offsets), frames: T, joints: J };
}
