// Articulated refinement (v1: per-limb rigid corrections).
//
// After the receipted global similarity fit, each limb-instance group of the
// authored skeleton receives ONE bounded rotation about its attachment pivot
// - lawful pose freedom expressed in the authored structure's own terms. No
// translation at joints (a translating joint is a dislocation, not a pose),
// no scale, no free-form warp. Correction magnitudes are the measurement:
// what remains outside after bounded lawful pose is proportion mismatch.
//
// Grouping composes the (provisional, operator-sign-pending) semantic region
// manifest with a spatial instance split: region class x mediolateral sign x
// anteroposterior half. Chain-level refinement (knee/ankle) is a later
// version; v1 is limb-level.

import { createHash } from 'node:crypto';

import { buildSurfaceIndex, sampleSurface } from './cast-registration-core.mjs';
import { pointInsideMesh } from './frame-link-core.mjs';
import { applyChain } from './bone-containment-probe-core.mjs';

export const ARTICULATED_REFINEMENT_RECEIPT_SCHEMA = 'kaminos.articulated-refinement-receipt.v0';

// --- group derivation ---------------------------------------------------------

const CORE_REGIONS = new Set(['spine', 'ribcage', 'pelvis', 'scapulae']);

export function deriveRefinementGroups(bones, manifest) {
  const boneToRegion = manifest.bone_to_region;
  const frame = manifest.frame; // { ML: 'X', AP: 'Z', DV: 'Y', head_direction_z }
  const axisIndex = { X: 0, Y: 1, Z: 2 };
  const ml = axisIndex[frame.ML];
  const ap = axisIndex[frame.AP];
  const centroidOf = geometry => {
    const c = [0, 0, 0];
    const n = geometry.positions.length / 3;
    for (let i = 0; i < geometry.positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) c[k] += geometry.positions[i + k];
    }
    return c.map(v => v / n);
  };
  const entries = bones.map(bone => ({
    bone,
    region: boneToRegion[bone.name] ?? 'unmapped',
    centroid: centroidOf(bone.geometry),
  }));
  const core = entries.filter(e => CORE_REGIONS.has(e.region));
  if (core.length === 0) throw new Error('derive-groups: no core bones under manifest');
  const coreCenter = [0, 1, 2].map(k => core.reduce((a, e) => a + e.centroid[k], 0) / core.length);
  const headSign = Math.sign(manifest.frame.head_direction_z ?? 1) || 1;

  const groups = new Map();
  const put = (name, entry) => {
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(entry);
  };
  for (const entry of entries) {
    const { region } = entry;
    if (CORE_REGIONS.has(region) || region === 'unmapped') { put('core', entry); continue; }
    if (region === 'skull_mandible') { put('head', entry); continue; }
    if (region === 'caudal') { put('tail', entry); continue; }
    // Limb instances: forelimb/hindlimb/pedal split by ML sign; pedal bones
    // join the limb instance on their side and AP half.
    const side = entry.centroid[ml] >= coreCenter[ml] ? 'left' : 'right';
    const front = (entry.centroid[ap] - coreCenter[ap]) * headSign >= 0;
    if (region === 'forelimb') { put(`forelimb-${side}`, entry); continue; }
    if (region === 'hindlimb') { put(`hindlimb-${side}`, entry); continue; }
    if (region === 'pedal') { put(`${front ? 'forelimb' : 'hindlimb'}-${side}`, entry); continue; }
    put('core', entry); // unknown region class: refuse to invent a joint
  }

  const result = [];
  for (const [name, members] of groups) {
    const boneNames = members.map(m => m.bone.name);
    // Pivot: member centroid nearest the core center = attachment end.
    let pivot = null;
    let best = Infinity;
    for (const member of members) {
      const d = Math.hypot(...[0, 1, 2].map(k => member.centroid[k] - coreCenter[k]));
      if (d < best) { best = d; pivot = member.centroid.slice(); }
    }
    result.push({
      name,
      boneNames,
      bones: members.map(m => m.bone),
      pivot,
      refinable: name !== 'core',
    });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// --- bounded rotation solve ----------------------------------------------------

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

function matMul3(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      for (let k = 0; k < 3; k += 1) out[r][c] += a[r][k] * b[k][c];
    }
  }
  return out;
}

function solveLinear3(a, b) {
  const m = a.map(row => row.slice());
  const v = b.slice();
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 3; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-15) return null;
    if (pivot !== col) { [m[pivot], m[col]] = [m[col], m[pivot]]; [v[pivot], v[col]] = [v[col], v[pivot]]; }
    for (let r = col + 1; r < 3; r += 1) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 3; c += 1) m[r][c] -= f * m[col][c];
      v[r] -= f * v[col];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r -= 1) {
    let sum = v[r];
    for (let c = r + 1; c < 3; c += 1) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

// Solve one bounded rotation about `pivot` for `samples` (already in cast
// frame) against the cast: hinge objective, only outside points pull.
export function solveGroupRotation({
  samples,
  cast,
  castIndex,
  pivot,
  maxAngleRad = 25 * (Math.PI / 180),
  maxIterations = 60,
  stepClamp = 0.08,
}) {
  const count = samples.length / 3;
  let rotation = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const moved = new Float64Array(samples.length);
  const applyAboutPivot = () => {
    for (let i = 0; i < samples.length; i += 3) {
      const x = samples[i] - pivot[0];
      const y = samples[i + 1] - pivot[1];
      const z = samples[i + 2] - pivot[2];
      for (let r = 0; r < 3; r += 1) {
        moved[i + r] = rotation[r][0] * x + rotation[r][1] * y + rotation[r][2] * z + pivot[r];
      }
    }
  };
  const containment = () => {
    let inside = 0;
    let outsideSum = 0;
    for (let i = 0; i < count; i += 1) {
      const px = moved[i * 3]; const py = moved[i * 3 + 1]; const pz = moved[i * 3 + 2];
      if (pointInsideMesh(px, py, pz, cast)) inside += 1;
      else outsideSum += castIndex.nearest(px, py, pz).distance;
    }
    return { insideFraction: inside / count, meanOutside: outsideSum / count };
  };
  applyAboutPivot();
  const before = containment();
  let clampedAtBound = false;
  // Soft interior margin: 5% of the sample cloud's radius about the pivot.
  // Pure hinge objectives stall with points sitting fractionally outside
  // (their pull vanishes at the boundary); the margin keeps gradient alive
  // until bones sit comfortably inside, not marginally.
  let cloudRadius = 0;
  for (let i = 0; i < count; i += 1) {
    cloudRadius = Math.max(cloudRadius, Math.hypot(
      samples[i * 3] - pivot[0], samples[i * 3 + 1] - pivot[1], samples[i * 3 + 2] - pivot[2],
    ));
  }
  const margin = cloudRadius * 0.05;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    applyAboutPivot();
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const atb = [0, 0, 0];
    let active = 0;
    for (let i = 0; i < count; i += 1) {
      const px = moved[i * 3]; const py = moved[i * 3 + 1]; const pz = moved[i * 3 + 2];
      const inside = pointInsideMesh(px, py, pz, cast);
      const hit = castIndex.nearest(px, py, pz);
      let rx; let ry; let rz; let weight;
      if (!inside) {
        // Outside: pull to the surface and through it by the margin.
        const len = hit.distance || 1e-12;
        const over = (hit.distance + margin) / len;
        rx = (px - hit.point[0]) * over;
        ry = (py - hit.point[1]) * over;
        rz = (pz - hit.point[2]) * over;
        weight = 1;
      } else if (hit.distance < margin) {
        // Inside but shallow: keep pulling inward with reduced weight.
        const len = hit.distance || 1e-12;
        const deficit = (margin - hit.distance) / len;
        rx = -(px - hit.point[0]) * deficit;
        ry = -(py - hit.point[1]) * deficit;
        rz = -(pz - hit.point[2]) * deficit;
        weight = 0.3;
      } else {
        continue;
      }
      active += 1;
      const cx = px - pivot[0]; const cy = py - pivot[1]; const cz = pz - pivot[2];
      const rows = [
        [0, cz, -cy, rx],
        [-cz, 0, cx, ry],
        [cy, -cx, 0, rz],
      ];
      for (const row of rows) {
        for (let a = 0; a < 3; a += 1) {
          atb[a] -= weight * row[a] * row[3];
          for (let b = 0; b < 3; b += 1) ata[a][b] += weight * row[a] * row[b];
        }
      }
    }
    if (active === 0) break;
    for (let a = 0; a < 3; a += 1) ata[a][a] += 1e-6 + 0.05 * ata[a][a];
    const delta = solveLinear3(ata, atb);
    if (!delta || delta.some(v => !Number.isFinite(v))) break;
    const len = Math.hypot(...delta);
    const omega = len > stepClamp ? delta.map(v => (v * stepClamp) / len) : delta;
    let next = matMul3(rodrigues(omega), rotation);
    // Bound total angle: project back to the max-angle sphere in axis-angle.
    const trace = next[0][0] + next[1][1] + next[2][2];
    const totalAngle = Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
    if (totalAngle > maxAngleRad) {
      clampedAtBound = true;
      const scaleBack = maxAngleRad / totalAngle;
      // extract axis
      const ax = [
        next[2][1] - next[1][2],
        next[0][2] - next[2][0],
        next[1][0] - next[0][1],
      ];
      const axLen = Math.hypot(...ax) || 1;
      next = rodrigues(ax.map(v => (v / axLen) * totalAngle * scaleBack));
    }
    rotation = next;
    if (len < 1e-9) break;
  }
  applyAboutPivot();
  const after = containment();
  const trace = rotation[0][0] + rotation[1][1] + rotation[2][2];
  const angleRad = Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
  const axisRaw = [
    rotation[2][1] - rotation[1][2],
    rotation[0][2] - rotation[2][0],
    rotation[1][0] - rotation[0][1],
  ];
  const axisLen = Math.hypot(...axisRaw);
  return {
    rotation,
    angleDeg: (angleRad * 180) / Math.PI,
    axis: axisLen > 1e-12 ? axisRaw.map(v => Number((v / axisLen).toPrecision(6))) : [0, 0, 0],
    clampedAtBound,
    before,
    after,
  };
}

// --- full refinement pass ------------------------------------------------------

export function refineArticulated({
  bones,
  manifest,
  cast,
  chainTransforms,
  samplesPerBone = 30,
  maxAngleDeg = 25,
}) {
  const groups = deriveRefinementGroups(bones, manifest);
  const castIndex = buildSurfaceIndex(cast);
  const results = [];
  for (const group of groups) {
    // Sample every member bone, carry through the receipted chain.
    const parts = [];
    for (const bone of group.bones) {
      let s;
      try { s = sampleSurface(bone.geometry, samplesPerBone); } catch { continue; }
      parts.push(s);
    }
    if (parts.length === 0) continue;
    const samples = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
    let cursor = 0;
    for (const part of parts) { samples.set(part, cursor); cursor += part.length; }
    for (let i = 0; i < samples.length; i += 3) {
      const p = applyChain([samples[i], samples[i + 1], samples[i + 2]], chainTransforms);
      samples[i] = p[0]; samples[i + 1] = p[1]; samples[i + 2] = p[2];
    }
    const pivotCast = applyChain(group.pivot, chainTransforms);
    if (!group.refinable) {
      // Core is measured, never rotated.
      let inside = 0;
      const count = samples.length / 3;
      for (let i = 0; i < count; i += 1) {
        if (pointInsideMesh(samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2], cast)) inside += 1;
      }
      results.push({
        group: group.name,
        boneCount: group.bones.length,
        refinable: false,
        insideFraction: Number((inside / count).toPrecision(6)),
      });
      continue;
    }
    const solved = solveGroupRotation({
      samples, cast, castIndex, pivot: pivotCast,
      maxAngleRad: maxAngleDeg * (Math.PI / 180),
    });
    results.push({
      group: group.name,
      boneCount: group.bones.length,
      refinable: true,
      pivotCastFrame: pivotCast.map(v => Number(v.toPrecision(6))),
      correctionAngleDeg: Number(solved.angleDeg.toPrecision(6)),
      correctionAxis: solved.axis,
      clampedAtBound: solved.clampedAtBound,
      insideFractionBefore: Number(solved.before.insideFraction.toPrecision(6)),
      insideFractionAfter: Number(solved.after.insideFraction.toPrecision(6)),
      meanOutsideBefore: Number(solved.before.meanOutside.toPrecision(6)),
      meanOutsideAfter: Number(solved.after.meanOutside.toPrecision(6)),
    });
  }
  return { groups: results, maxAngleDeg, samplesPerBone };
}

// --- receipt -------------------------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildArticulatedRefinementReceipt({
  skeletonSha256,
  castSha256,
  castLabel,
  manifestSha256,
  chain,
  refinement,
  generatedAt = new Date().toISOString(),
}) {
  return {
    schema: ARTICULATED_REFINEMENT_RECEIPT_SCHEMA,
    status: 'completed',
    inputs: { skeletonSha256, castSha256, castLabel, manifestSha256 },
    manifestAuthority: 'provisional-spatial-derivation; operator sign pending',
    chain,
    refinement,
    jointModel: 'v1 limb-level: one bounded rotation per limb instance about its attachment pivot; no joint translation; no scale; chain-level (knee/ankle) deferred',
    generatedAt,
  };
}

export function articulatedRefinementReceiptIdentity(receipt) {
  const { generatedAt, receiptSha256, ...identityBearing } = receipt;
  return createHash('sha256').update(canonicalJson(identityBearing)).digest('hex');
}
