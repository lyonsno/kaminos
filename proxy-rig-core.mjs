// Proxy rig v0: the authored skeleton drives the authored envelope (crude
// group-level linear-blend weights), and the generated cast rides the
// envelope through surface correspondence (triangle + barycentric + normal
// offset). The generated mesh is never skinned directly - binding to
// reconstruction sludge is exactly the ill-posed path this program rejected.
//
// All binding happens in the cast frame through the receipted chain
// (frame link, Stage A), so posed output composes with every measurement
// artifact. Weights are deliberately crude (inverse-distance to the two
// nearest refinement groups); quality upgrades are future slices with the
// same interfaces.

import { buildSurfaceIndex, sampleSurface } from './cast-registration-core.mjs';
import { applyChain } from './bone-containment-probe-core.mjs';
import { deriveRefinementGroups } from './articulated-refinement-core.mjs';

export const PROXY_RIG_SCHEMA = 'kaminos.proxy-rig.v0';

// --- envelope <- skeleton binding ----------------------------------------------

export function bindEnvelopeToSkeleton({
  envelope,
  bones,
  manifest,
  chainTransforms,
  samplesPerBone = 30,
  neighbors = 2,
}) {
  const groups = deriveRefinementGroups(bones, manifest);
  // Group control points: bone surface samples carried into cast frame.
  const controls = groups.map(group => {
    const points = [];
    for (const bone of group.bones) {
      let s;
      try { s = sampleSurface(bone.geometry, samplesPerBone); } catch { continue; }
      for (let i = 0; i < s.length; i += 3) {
        points.push(applyChain([s[i], s[i + 1], s[i + 2]], chainTransforms));
      }
    }
    return {
      name: group.name,
      pivot: applyChain(group.pivot, chainTransforms),
      points,
    };
  }).filter(g => g.points.length > 0);

  const vertexCount = envelope.positions.length / 3;
  const weightGroups = new Int16Array(vertexCount * neighbors).fill(-1);
  const weightValues = new Float64Array(vertexCount * neighbors);
  for (let v = 0; v < vertexCount; v += 1) {
    const px = envelope.positions[v * 3];
    const py = envelope.positions[v * 3 + 1];
    const pz = envelope.positions[v * 3 + 2];
    const best = [];
    for (let g = 0; g < controls.length; g += 1) {
      let dMin = Infinity;
      for (const q of controls[g].points) {
        const d = (q[0] - px) ** 2 + (q[1] - py) ** 2 + (q[2] - pz) ** 2;
        if (d < dMin) dMin = d;
      }
      best.push([g, Math.sqrt(dMin)]);
    }
    best.sort((a, b) => a[1] - b[1]);
    let total = 0;
    for (let k = 0; k < neighbors; k += 1) {
      const [, d] = best[k];
      const w = 1 / Math.max(d, 1e-9);
      weightGroups[v * neighbors + k] = best[k][0];
      weightValues[v * neighbors + k] = w;
      total += w;
    }
    for (let k = 0; k < neighbors; k += 1) weightValues[v * neighbors + k] /= total;
  }
  return {
    groups: controls.map(c => ({ name: c.name, pivot: c.pivot })),
    neighbors,
    weightGroups,
    weightValues,
  };
}

// --- cast <- envelope binding ---------------------------------------------------

export function bindCastToEnvelope({ cast, envelopeInCastFrame }) {
  const index = buildSurfaceIndex(envelopeInCastFrame);
  const { positions, triangles } = envelopeInCastFrame;
  const vertexCount = cast.positions.length / 3;
  // Local-frame offset: express (castVertex - triangleOrigin) exactly in the
  // triangle's frame [e0, e1, n]. Identity pose reconstructs exactly by
  // construction, including vertices whose nearest point lies on an edge.
  const binding = {
    triangle: new Int32Array(vertexCount),
    local: new Float64Array(vertexCount * 3),
  };
  for (let v = 0; v < vertexCount; v += 1) {
    const px = cast.positions[v * 3];
    const py = cast.positions[v * 3 + 1];
    const pz = cast.positions[v * 3 + 2];
    const hit = index.nearest(px, py, pz);
    const t = hit.triangle;
    binding.triangle[v] = t;
    const ia = triangles[t * 3] * 3; const ib = triangles[t * 3 + 1] * 3; const ic = triangles[t * 3 + 2] * 3;
    const e0 = [positions[ib] - positions[ia], positions[ib + 1] - positions[ia + 1], positions[ib + 2] - positions[ia + 2]];
    const e1 = [positions[ic] - positions[ia], positions[ic + 1] - positions[ia + 1], positions[ic + 2] - positions[ia + 2]];
    let n = [
      e0[1] * e1[2] - e0[2] * e1[1],
      e0[2] * e1[0] - e0[0] * e1[2],
      e0[0] * e1[1] - e0[1] * e1[0],
    ];
    const nLen = Math.hypot(...n) || 1e-18;
    n = n.map(c => c / nLen);
    const d = [px - positions[ia], py - positions[ia + 1], pz - positions[ia + 2]];
    // Solve [e0 e1 n] x = d (3x3).
    const m = [
      [e0[0], e1[0], n[0]],
      [e0[1], e1[1], n[1]],
      [e0[2], e1[2], n[2]],
    ];
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const inv = 1 / (det || 1e-18);
    const cofactor = (r, c) => {
      const rows = [0, 1, 2].filter(i => i !== r);
      const cols = [0, 1, 2].filter(i => i !== c);
      const minor = m[rows[0]][cols[0]] * m[rows[1]][cols[1]] - m[rows[0]][cols[1]] * m[rows[1]][cols[0]];
      return ((r + c) % 2 === 0 ? 1 : -1) * minor;
    };
    for (let k = 0; k < 3; k += 1) {
      binding.local[v * 3 + k] = inv * (
        cofactor(0, k) * d[0] + cofactor(1, k) * d[1] + cofactor(2, k) * d[2]
      );
    }
  }
  return binding;
}

// --- posing ---------------------------------------------------------------------

function rotationFromAxisAngle(axis, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  const len = Math.hypot(...axis) || 1;
  if (Math.abs(angleDeg) < 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [x, y, z] = axis.map(v => v / len);
  const c = Math.cos(angle); const s = Math.sin(angle); const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

// pose: { [groupName]: { axis: [x,y,z], angleDeg, pivot?: override } }
export function poseEnvelope({ envelopeInCastFrame, skinBinding, pose }) {
  const { weightGroups, weightValues, neighbors, groups } = skinBinding;
  const transforms = groups.map(group => {
    const spec = pose[group.name];
    if (!spec) return null;
    return {
      rotation: rotationFromAxisAngle(spec.axis, spec.angleDeg),
      pivot: spec.pivot ?? group.pivot,
    };
  });
  const vertexCount = envelopeInCastFrame.positions.length / 3;
  const posed = envelopeInCastFrame.positions.slice();
  for (let v = 0; v < vertexCount; v += 1) {
    const px = posed[v * 3]; const py = posed[v * 3 + 1]; const pz = posed[v * 3 + 2];
    let ox = 0; let oy = 0; let oz = 0;
    for (let k = 0; k < neighbors; k += 1) {
      const g = weightGroups[v * neighbors + k];
      const w = weightValues[v * neighbors + k];
      const t = g >= 0 ? transforms[g] : null;
      if (!t) { ox += w * px; oy += w * py; oz += w * pz; continue; }
      const [cx, cy, cz] = t.pivot;
      const x = px - cx; const y = py - cy; const z = pz - cz;
      ox += w * (t.rotation[0][0] * x + t.rotation[0][1] * y + t.rotation[0][2] * z + cx);
      oy += w * (t.rotation[1][0] * x + t.rotation[1][1] * y + t.rotation[1][2] * z + cy);
      oz += w * (t.rotation[2][0] * x + t.rotation[2][1] * y + t.rotation[2][2] * z + cz);
    }
    posed[v * 3] = ox; posed[v * 3 + 1] = oy; posed[v * 3 + 2] = oz;
  }
  return { positions: posed, triangles: envelopeInCastFrame.triangles };
}

// --- displacement-field smoothing ------------------------------------------------

// Correspondence discontinuities (adjacent cast vertices bound to envelope
// triangles that diverge under pose - chin/chest, ear/shoulder gaps) produce
// spike artifacts. Body motion is low-frequency; spikes are single-vertex
// outliers - so smooth the DISPLACEMENT field over the cast's own topology,
// never the positions, preserving surface detail exactly at identity.
// Adjacency merges positionally-duplicated vertices (flat-shaded exports)
// so smoothing crosses shading seams.
export function buildCastAdjacency(cast) {
  const vertexCount = cast.positions.length / 3;
  const key = v => `${cast.positions[v * 3].toFixed(6)},${cast.positions[v * 3 + 1].toFixed(6)},${cast.positions[v * 3 + 2].toFixed(6)}`;
  const canon = new Map();
  const vid = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const k = key(v);
    if (!canon.has(k)) canon.set(k, v);
    vid[v] = canon.get(k);
  }
  const adjacency = new Map();
  const link = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  const { triangles } = cast;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = vid[triangles[t]]; const b = vid[triangles[t + 1]]; const c = vid[triangles[t + 2]];
    link(a, b); link(b, a); link(b, c); link(c, b); link(a, c); link(c, a);
  }
  return { vid, adjacency };
}

export function smoothDisplacementField({
  cast,
  posedPositions,
  adjacency: adjacencyInput = null,
  iterations = 15,
  lambda = 0.6,
}) {
  const { vid, adjacency } = adjacencyInput ?? buildCastAdjacency(cast);
  const vertexCount = cast.positions.length / 3;
  // Canonical displacement (merged verts share one displacement).
  let disp = new Map();
  for (let v = 0; v < vertexCount; v += 1) {
    const c = vid[v];
    if (!disp.has(c)) {
      disp.set(c, [
        posedPositions[v * 3] - cast.positions[v * 3],
        posedPositions[v * 3 + 1] - cast.positions[v * 3 + 1],
        posedPositions[v * 3 + 2] - cast.positions[v * 3 + 2],
      ]);
    }
  }
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Map();
    for (const [v, d] of disp) {
      const neighbors = adjacency.get(v);
      if (!neighbors || neighbors.size === 0) { next.set(v, d); continue; }
      const mean = [0, 0, 0];
      for (const n of neighbors) {
        const nd = disp.get(n) ?? [0, 0, 0];
        mean[0] += nd[0]; mean[1] += nd[1]; mean[2] += nd[2];
      }
      const inv = 1 / neighbors.size;
      next.set(v, [
        d[0] + lambda * (mean[0] * inv - d[0]),
        d[1] + lambda * (mean[1] * inv - d[1]),
        d[2] + lambda * (mean[2] * inv - d[2]),
      ]);
    }
    disp = next;
  }
  const out = new Float64Array(cast.positions.length);
  for (let v = 0; v < vertexCount; v += 1) {
    const d = disp.get(vid[v]);
    out[v * 3] = cast.positions[v * 3] + d[0];
    out[v * 3 + 1] = cast.positions[v * 3 + 1] + d[1];
    out[v * 3 + 2] = cast.positions[v * 3 + 2] + d[2];
  }
  return out;
}

export function poseCastThroughProxy({ cast, posedEnvelope, castBinding }) {
  const { positions, triangles } = posedEnvelope;
  const vertexCount = cast.positions.length / 3;
  const posed = new Float64Array(cast.positions.length);
  for (let v = 0; v < vertexCount; v += 1) {
    const t = castBinding.triangle[v];
    const ia = triangles[t * 3] * 3; const ib = triangles[t * 3 + 1] * 3; const ic = triangles[t * 3 + 2] * 3;
    const e0x = positions[ib] - positions[ia]; const e0y = positions[ib + 1] - positions[ia + 1]; const e0z = positions[ib + 2] - positions[ia + 2];
    const e1x = positions[ic] - positions[ia]; const e1y = positions[ic + 1] - positions[ia + 1]; const e1z = positions[ic + 2] - positions[ia + 2];
    let nx = e0y * e1z - e0z * e1y;
    let ny = e0z * e1x - e0x * e1z;
    let nz = e0x * e1y - e0y * e1x;
    const nLen = Math.hypot(nx, ny, nz) || 1e-18;
    nx /= nLen; ny /= nLen; nz /= nLen;
    const a = castBinding.local[v * 3];
    const b = castBinding.local[v * 3 + 1];
    const c = castBinding.local[v * 3 + 2];
    posed[v * 3] = positions[ia] + a * e0x + b * e1x + c * nx;
    posed[v * 3 + 1] = positions[ia + 1] + a * e0y + b * e1y + c * ny;
    posed[v * 3 + 2] = positions[ia + 2] + a * e0z + b * e1z + c * nz;
  }
  return { positions: posed, triangles: cast.triangles };
}
