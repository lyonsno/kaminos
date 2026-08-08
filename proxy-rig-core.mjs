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

import { createHash } from 'node:crypto';

import { buildSurfaceIndex, sampleSurface } from './cast-registration-core.mjs';
import { applyChain } from './bone-containment-probe-core.mjs';
import { deriveRefinementGroups } from './articulated-refinement-core.mjs';
import {
  canonicalProxyRigJson,
  PROXY_RIG_PACKAGE_SCHEMA,
  PROXY_RIG_RUNTIME_SCHEMA,
} from './proxy-rig-runtime.mjs';

export {
  buildCastAdjacency,
  PROXY_RIG_PACKAGE_SCHEMA,
  PROXY_RIG_RUNTIME_SCHEMA,
  poseCastThroughProxy,
  poseEnvelope,
  smoothDisplacementField,
} from './proxy-rig-runtime.mjs';

export const PROXY_RIG_SCHEMA = 'kaminos.proxy-rig.v0';

function serialGeometry(geometry) {
  return {
    positions: Array.from(geometry.positions),
    triangles: Array.from(geometry.triangles),
  };
}

export function createProxyRigPackage({
  envelopeInCastFrame,
  cast,
  skinBinding,
  castBinding,
  source,
}) {
  for (const key of ['cast', 'envelope', 'skeleton']) {
    if (typeof source?.[key] !== 'string' || !source[key].trim()) {
      throw new Error(`Proxy rig package source.${key} is required`);
    }
  }
  const content = {
    schema: PROXY_RIG_PACKAGE_SCHEMA,
    runtimeSchema: PROXY_RIG_RUNTIME_SCHEMA,
    source: { ...source },
    envelope: serialGeometry(envelopeInCastFrame),
    cast: serialGeometry(cast),
    skinBinding: {
      groups: skinBinding.groups.map(group => ({ name: group.name, pivot: Array.from(group.pivot) })),
      neighbors: skinBinding.neighbors,
      weightGroups: Array.from(skinBinding.weightGroups),
      weightValues: Array.from(skinBinding.weightValues),
    },
    castBinding: {
      triangle: Array.from(castBinding.triangle),
      local: Array.from(castBinding.local),
    },
  };
  const digest = createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex');
  return { ...content, packageId: `sha256:${digest}` };
}

export function assertProxyRigArtifactHash(bytes, expectedSha256, label) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(`Proxy rig ${label} receipt hash is missing or malformed`);
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(`Proxy rig ${label} bytes do not match receipt hash: ${actual} != ${expectedSha256}`);
  }
  return actual;
}

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
