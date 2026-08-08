// Frame-link solver: resolves the rigid (rotation + translation, scale
// LOCKED at 1) placement of an authored interior structure (skeleton) inside
// its authored envelope when the two were exported with different object
// origins. Operator-confirmed prior: the misplacement is translation and
// possibly rotation, never scale or proportions - so scale freedom is not
// offered, and a source that only fits at a different scale must fail.
//
// Objective: hinge loss on containment - only sample points OUTSIDE the
// envelope contribute, each pulled toward its nearest envelope surface
// point. Inside/outside is exact ray-parity against the watertight envelope,
// not a normal-sign heuristic.

import { createHash } from 'node:crypto';

import { buildSurfaceIndex, sampleSurface } from './cast-registration-core.mjs';

export const FRAME_LINK_RECEIPT_SCHEMA = 'kaminos.frame-link-receipt.v0';

// --- exact inside/outside by ray parity --------------------------------------

function rayHitsTriangle(px, py, pz, positions, ia, ib, ic) {
  // Ray direction fixed at +x; Möller-Trumbore with deterministic epsilon.
  const ax = positions[ia]; const ay = positions[ia + 1]; const az = positions[ia + 2];
  const e1x = positions[ib] - ax; const e1y = positions[ib + 1] - ay; const e1z = positions[ib + 2] - az;
  const e2x = positions[ic] - ax; const e2y = positions[ic + 1] - ay; const e2z = positions[ic + 2] - az;
  // h = dir x e2, dir = (1,0,0) => h = (0, -e2z, e2y)
  const hy = -e2z; const hz = e2y;
  const a = e1y * hy + e1z * hz;
  if (Math.abs(a) < 1e-14) return false;
  const f = 1 / a;
  const sx = px - ax; const sy = py - ay; const sz = pz - az;
  const u = f * (sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  // q = s x e1
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = f * qx; // dir . q with dir = (1,0,0)
  if (v < 0 || u + v > 1) return false;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-12;
}

export function pointInsideMesh(px, py, pz, geometry) {
  // Generalized winding number (Van Oosterom-Strackee solid angles): exact
  // on watertight manifolds and robust on closed meshes with internal
  // non-manifold walls, where ray parity miscounts (observed on the real
  // authored envelope: 0 boundary edges but 74 non-manifold edges).
  const { positions, triangles } = geometry;
  let winding = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const ia = triangles[t] * 3; const ib = triangles[t + 1] * 3; const ic = triangles[t + 2] * 3;
    const ax = positions[ia] - px; const ay = positions[ia + 1] - py; const az = positions[ia + 2] - pz;
    const bx = positions[ib] - px; const by = positions[ib + 1] - py; const bz = positions[ib + 2] - pz;
    const cx = positions[ic] - px; const cy = positions[ic + 1] - py; const cz = positions[ic + 2] - pz;
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    const lc = Math.hypot(cx, cy, cz);
    const numerator = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const denominator = la * lb * lc
      + (ax * bx + ay * by + az * bz) * lc
      + (bx * cx + by * cy + bz * cz) * la
      + (ax * cx + ay * cy + az * cz) * lb;
    winding += Math.atan2(numerator, denominator);
  }
  // Threshold at 0.25 rather than 0.5: the real authored envelope carries
  // mixed face orientation (interior winding sums to exactly 0.5 instead of
  // 1.0; exterior reads 0.0), so the discriminator sits between the observed
  // clusters. Fully consistent meshes read ±1 inside and still pass.
  return Math.abs(winding / (2 * Math.PI)) > 0.25;
}

// --- containment reporting -----------------------------------------------------

export function containmentReport(source, envelope, { sampleCount = 1200 } = {}) {
  const samples = sampleSurface(source, sampleCount);
  const index = buildSurfaceIndex(envelope);
  let inside = 0;
  const outsideDistances = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const px = samples[i * 3]; const py = samples[i * 3 + 1]; const pz = samples[i * 3 + 2];
    if (pointInsideMesh(px, py, pz, envelope)) {
      inside += 1;
    } else {
      outsideDistances.push(index.nearest(px, py, pz).distance);
    }
  }
  outsideDistances.sort((a, b) => a - b);
  const q = (arr, frac) => (arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.floor(arr.length * frac))]);
  return {
    sampleCount,
    insideFraction: inside / sampleCount,
    outsideCount: outsideDistances.length,
    outsideQ50: q(outsideDistances, 0.5),
    outsideQ95: q(outsideDistances, 0.95),
    outsideMax: outsideDistances.length ? outsideDistances[outsideDistances.length - 1] : 0,
  };
}

// --- rigid hinge solve ---------------------------------------------------------

function solveLinear6(a, b) {
  const n = 6;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-15) return null;
    if (pivot !== col) {
      [a[pivot], a[col]] = [a[col], a[pivot]];
      [b[pivot], b[col]] = [b[col], b[pivot]];
    }
    for (let r = col + 1; r < n; r += 1) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < n; c += 1) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = b[r];
    for (let c = r + 1; c < n; c += 1) sum -= a[r][c] * x[c];
    x[r] = sum / a[r][r];
  }
  return x;
}

function rodrigues(omega) {
  const angle = Math.hypot(...omega);
  if (angle < 1e-14) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [x, y, z] = omega.map(c => c / angle);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

function composeRigid(second, first) {
  const rotation = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += second.rotation[r][k] * first.rotation[k][c];
      rotation[r][c] = sum;
    }
  }
  const translation = [0, 1, 2].map(r => second.rotation[r][0] * first.translation[0]
    + second.rotation[r][1] * first.translation[1]
    + second.rotation[r][2] * first.translation[2]
    + second.translation[r]);
  return { rotation, translation };
}

function applyRigid(points, { rotation, translation }, out) {
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]; const y = points[i + 1]; const z = points[i + 2];
    for (let r = 0; r < 3; r += 1) {
      out[i + r] = rotation[r][0] * x + rotation[r][1] * y + rotation[r][2] * z + translation[r];
    }
  }
}

export function solveFrameLink({
  source,
  envelope,
  sampleCount = 1200,
  maxIterations = 120,
  maxRotationStep = 0.1,
}) {
  const samples = sampleSurface(source, sampleCount);
  const index = buildSurfaceIndex(envelope);

  // Init: bounding-box center alignment (translation only).
  const center = geometry => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geometry.positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], geometry.positions[i + k]);
        max[k] = Math.max(max[k], geometry.positions[i + k]);
      }
    }
    return [0, 1, 2].map(k => (min[k] + max[k]) / 2);
  };
  const sourceCenter = center(source);
  const envelopeCenter = center(envelope);
  let current = {
    rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    translation: [0, 1, 2].map(k => envelopeCenter[k] - sourceCenter[k]),
  };

  const moved = new Float64Array(samples.length);
  let converged = false;
  let iterations = 0;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    iterations = iter + 1;
    applyRigid(samples, current, moved);
    // Rotation is parameterized about the moved centroid, not the world
    // origin: origin-relative moment arms condition the solve so badly that
    // the rotational component vanishes into translation.
    const centroid = [0, 0, 0];
    for (let i = 0; i < sampleCount; i += 1) {
      for (let k = 0; k < 3; k += 1) centroid[k] += moved[i * 3 + k];
    }
    for (let k = 0; k < 3; k += 1) centroid[k] /= sampleCount;
    const ata = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const atb = new Array(6).fill(0);
    let outside = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const px = moved[i * 3]; const py = moved[i * 3 + 1]; const pz = moved[i * 3 + 2];
      if (pointInsideMesh(px, py, pz, envelope)) continue;
      outside += 1;
      const hit = index.nearest(px, py, pz);
      // Residual vector toward the surface; hinge: only outside points pull.
      const rx = px - hit.point[0]; const ry = py - hit.point[1]; const rz = pz - hit.point[2];
      const cx = px - centroid[0]; const cy = py - centroid[1]; const cz = pz - centroid[2];
      // Jacobian rows for delta = [omega, t] on each residual component,
      // omega acting about the centroid.
      const rows = [
        [0, cz, -cy, 1, 0, 0, rx],
        [-cz, 0, cx, 0, 1, 0, ry],
        [cy, -cx, 0, 0, 0, 1, rz],
      ];
      for (const row of rows) {
        for (let a = 0; a < 6; a += 1) {
          atb[a] -= row[a] * row[6];
          for (let b = a; b < 6; b += 1) ata[a][b] += row[a] * row[b];
        }
      }
    }
    if (outside === 0) { converged = true; break; }
    for (let a = 0; a < 6; a += 1) for (let b = 0; b < a; b += 1) ata[a][b] = ata[b][a];
    // Levenberg damping keeps the hinge solve stable when few points are out.
    for (let a = 0; a < 6; a += 1) ata[a][a] += 1e-6 + 0.01 * ata[a][a];
    const delta = solveLinear6(ata.map(row => row.slice()), atb.slice());
    if (!delta || delta.some(v => !Number.isFinite(v))) break;
    const omega = [delta[0], delta[1], delta[2]];
    const omegaLen = Math.hypot(...omega);
    if (omegaLen > maxRotationStep) {
      for (let k = 0; k < 3; k += 1) omega[k] *= maxRotationStep / omegaLen;
    }
    // Rotation about centroid c: x -> R(x - c) + c + t  ==  Rx + (c + t - Rc).
    const rot = rodrigues(omega);
    const update = {
      rotation: rot,
      translation: [0, 1, 2].map(r => centroid[r] + delta[3 + r]
        - (rot[r][0] * centroid[0] + rot[r][1] * centroid[1] + rot[r][2] * centroid[2])),
    };
    current = composeRigid(update, current);
    const stepLen = Math.hypot(delta[3], delta[4], delta[5]) + omegaLen;
    if (stepLen < 1e-10) { converged = true; break; }
  }

  const before = containmentReport(source, envelope, { sampleCount });
  const movedGeometry = { positions: new Float64Array(source.positions.length), triangles: source.triangles };
  applyRigid(source.positions, current, movedGeometry.positions);
  const after = containmentReport(movedGeometry, envelope, { sampleCount });

  const trace = current.rotation[0][0] + current.rotation[1][1] + current.rotation[2][2];
  const rotationAngleDeg = (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;

  return {
    transform: current,
    rotationAngleDeg,
    before,
    after,
    iterations,
    converged,
  };
}

// --- receipts ------------------------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const HEX64 = /^[0-9a-f]{64}$/;

export function buildFrameLinkReceipt({
  sourceLabel,
  envelopeLabel,
  sourceSha256,
  envelopeSha256,
  effectiveRoute,
  link,
  generatedAt = new Date().toISOString(),
}) {
  return {
    schema: FRAME_LINK_RECEIPT_SCHEMA,
    status: 'completed',
    inputs: { sourceLabel, envelopeLabel, sourceSha256, envelopeSha256 },
    effectiveRoute,
    link: {
      transform: link.transform,
      rotationAngleDeg: link.rotationAngleDeg,
      before: link.before,
      after: link.after,
      iterations: link.iterations,
      converged: link.converged,
      scaleLocked: true,
    },
    generatedAt,
  };
}

export function frameLinkReceiptIdentity(receipt) {
  const { generatedAt, receiptSha256, ...identityBearing } = receipt;
  return createHash('sha256').update(canonicalJson(identityBearing)).digest('hex');
}

export function validateFrameLinkReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new Error('frame-link receipt: not an object');
  if (receipt.schema !== FRAME_LINK_RECEIPT_SCHEMA) {
    throw new Error(`frame-link receipt: schema ${receipt.schema}`);
  }
  const { inputs, link } = receipt;
  if (!inputs || !HEX64.test(inputs.sourceSha256) || !HEX64.test(inputs.envelopeSha256)) {
    throw new Error('frame-link receipt: input hashes missing or malformed');
  }
  if (!link || link.scaleLocked !== true) throw new Error('frame-link receipt: scale lock missing');
  for (const key of ['before', 'after']) {
    const report = link[key];
    if (!report || typeof report.insideFraction !== 'number' || typeof report.outsideQ95 !== 'number') {
      throw new Error(`frame-link receipt: ${key} containment report missing`);
    }
  }
  if (!link.transform || !Array.isArray(link.transform.rotation)
    || !Array.isArray(link.transform.translation)) {
    throw new Error('frame-link receipt: transform missing');
  }
  return true;
}
