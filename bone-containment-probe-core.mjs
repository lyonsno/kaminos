// Per-bone containment probe: for each separable bone node of the authored
// skeleton, carry its surface samples through the receipted chain
// (frame link: skeleton -> envelope frame; Stage A similarity: envelope ->
// cast frame) and score containment against the generated cast.
//
// Preregistered positive control: the operator-verified paw punch-through on
// the Trellis skin cast. If the probe does not independently surface high
// outside fractions on the distal foot bones there, the probe is wrong.
//
// Region tags emitted here are PROVISIONAL SPATIAL GROUPING derived from
// bone centroid position in the envelope frame - reporting convenience, not
// semantic authority. A node-to-region manifest supersedes them when it
// exists.

import { createHash } from 'node:crypto';

import { buildSurfaceIndex, sampleSurface } from './cast-registration-core.mjs';
import { pointInsideMesh } from './frame-link-core.mjs';

export const BONE_CONTAINMENT_RECEIPT_SCHEMA = 'kaminos.bone-containment-receipt.v0';

// --- per-node GLB parsing -----------------------------------------------------

const COMPONENT_ARRAYS = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function matMul(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nodeLocalMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx; const y2 = qy + qy; const z2 = qz + qz;
  const xx = qx * x2; const xy = qx * y2; const xz = qx * z2;
  const yy = qy * y2; const yz = qy * z2; const zz = qz * z2;
  const wx = qw * x2; const wy = qw * y2; const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function accessorData(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const ArrayType = COMPONENT_ARRAYS[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (!ArrayType || !components) {
    throw new Error(`parse-glb: unsupported accessor ${accessor.componentType}/${accessor.type}`);
  }
  const view = gltf.bufferViews[accessor.bufferView];
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new ArrayType(bin.buffer, bin.byteOffset + byteOffset, accessor.count * components);
}

export function parseGlbNodeGeometries(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('parse-glb: not a GLB container');
  }
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let offset = 20 + jsonLen;
  let bin = null;
  while (offset + 8 <= buf.length) {
    const chunkLength = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    if (chunkType === 0x004e4942) { bin = buf.subarray(offset + 8, offset + 8 + chunkLength); break; }
    offset += 8 + chunkLength;
  }
  const nodes = [];
  const visit = (nodeIndex, parentMatrix) => {
    const node = gltf.nodes[nodeIndex];
    const world = matMul(parentMatrix, nodeLocalMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      const positions = [];
      const triangles = [];
      for (const primitive of mesh.primitives ?? []) {
        if (primitive.mode !== undefined && primitive.mode !== 4) continue;
        if (primitive.attributes?.POSITION === undefined) continue;
        const local = accessorData(gltf, bin, primitive.attributes.POSITION);
        const base = positions.length / 3;
        for (let i = 0; i < local.length; i += 3) {
          const x = local[i]; const y = local[i + 1]; const z = local[i + 2];
          positions.push(
            world[0] * x + world[4] * y + world[8] * z + world[12],
            world[1] * x + world[5] * y + world[9] * z + world[13],
            world[2] * x + world[6] * y + world[10] * z + world[14],
          );
        }
        if (primitive.indices !== undefined) {
          for (const index of accessorData(gltf, bin, primitive.indices)) triangles.push(base + index);
        } else {
          for (let i = 0; i < local.length / 3; i += 1) triangles.push(base + i);
        }
      }
      if (triangles.length >= 3) {
        nodes.push({
          name: node.name ?? `node-${nodeIndex}`,
          geometry: {
            positions: Float64Array.from(positions),
            triangles: Uint32Array.from(triangles),
          },
        });
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const referenced = new Set();
  for (const node of gltf.nodes ?? []) for (const child of node.children ?? []) referenced.add(child);
  const roots = scene?.nodes ?? (gltf.nodes ?? []).map((_, i) => i).filter(i => !referenced.has(i));
  for (const root of roots) visit(root, IDENTITY4);
  return nodes;
}

// --- transforms ----------------------------------------------------------------

export function applyChain(point, transforms) {
  let [x, y, z] = point;
  for (const t of transforms) {
    const s = t.scale ?? 1;
    const r = t.rotation;
    const nx = s * (r[0][0] * x + r[0][1] * y + r[0][2] * z) + t.translation[0];
    const ny = s * (r[1][0] * x + r[1][1] * y + r[1][2] * z) + t.translation[1];
    const nz = s * (r[2][0] * x + r[2][1] * y + r[2][2] * z) + t.translation[2];
    x = nx; y = ny; z = nz;
  }
  return [x, y, z];
}

// --- provisional spatial grouping ----------------------------------------------

// Coarse tags from bone centroid position in the ENVELOPE frame. Fractions
// are of the skeleton's own bounding box: axis 2 = body axis (longest),
// axis 1 = height. Tags are reporting convenience only.
export function provisionalRegionTag(centroid, bounds) {
  const frac = k => (centroid[k] - bounds.min[k]) / (bounds.max[k] - bounds.min[k] || 1);
  const body = frac(2);
  const height = frac(1);
  if (body > 0.86) return 'head-end';
  if (body < 0.10) return 'tail-end';
  if (height < 0.22) return 'distal-limb/paw-band';
  if (height > 0.55 && body > 0.15 && body < 0.85) return 'axial/dorsal-band';
  return 'mid-body/limb-band';
}

// --- probe ---------------------------------------------------------------------

export function probeBoneContainment({
  bones,
  cast,
  transforms,
  samplesPerBone = 40,
}) {
  const castIndex = buildSurfaceIndex(cast);
  const boundsOf = geometries => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const { geometry } of geometries) {
      for (let i = 0; i < geometry.positions.length; i += 3) {
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], geometry.positions[i + k]);
          max[k] = Math.max(max[k], geometry.positions[i + k]);
        }
      }
    }
    return { min, max };
  };
  const bounds = boundsOf(bones);
  const perBone = [];
  for (const bone of bones) {
    let samples;
    try {
      samples = sampleSurface(bone.geometry, samplesPerBone);
    } catch {
      continue; // zero-area node: skip, never fabricate
    }
    const centroid = [0, 0, 0];
    for (let i = 0; i < samplesPerBone; i += 1) {
      for (let k = 0; k < 3; k += 1) centroid[k] += samples[i * 3 + k];
    }
    for (let k = 0; k < 3; k += 1) centroid[k] /= samplesPerBone;
    let inside = 0;
    const outsideDistances = [];
    for (let i = 0; i < samplesPerBone; i += 1) {
      const p = applyChain([samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]], transforms);
      if (pointInsideMesh(p[0], p[1], p[2], cast)) {
        inside += 1;
      } else {
        outsideDistances.push(castIndex.nearest(p[0], p[1], p[2]).distance);
      }
    }
    outsideDistances.sort((a, b) => a - b);
    perBone.push({
      name: bone.name,
      regionTag: provisionalRegionTag(centroid, bounds),
      centroid: centroid.map(v => Number(v.toPrecision(6))),
      sampleCount: samplesPerBone,
      insideFraction: inside / samplesPerBone,
      outsideMax: outsideDistances.length
        ? Number(outsideDistances[outsideDistances.length - 1].toPrecision(6)) : 0,
      outsideQ50: outsideDistances.length
        ? Number(outsideDistances[Math.floor(outsideDistances.length / 2)].toPrecision(6)) : 0,
    });
  }
  perBone.sort((a, b) => a.insideFraction - b.insideFraction);
  const overall = perBone.reduce((acc, b) => acc + b.insideFraction, 0) / (perBone.length || 1);
  const byRegion = {};
  for (const bone of perBone) {
    byRegion[bone.regionTag] ??= { bones: 0, meanInsideFraction: 0 };
    byRegion[bone.regionTag].bones += 1;
    byRegion[bone.regionTag].meanInsideFraction += bone.insideFraction;
  }
  for (const tag of Object.keys(byRegion)) {
    byRegion[tag].meanInsideFraction = Number(
      (byRegion[tag].meanInsideFraction / byRegion[tag].bones).toPrecision(6),
    );
  }
  return { perBone, overallMeanInsideFraction: Number(overall.toPrecision(6)), byRegion };
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

export function buildBoneContainmentReceipt({
  skeletonSha256,
  castSha256,
  castLabel,
  chain,
  probe,
  generatedAt = new Date().toISOString(),
}) {
  return {
    schema: BONE_CONTAINMENT_RECEIPT_SCHEMA,
    status: 'completed',
    inputs: { skeletonSha256, castSha256, castLabel },
    chain,
    probe,
    regionTagsProvisional: true,
    generatedAt,
  };
}

export function boneContainmentReceiptIdentity(receipt) {
  const { generatedAt, receiptSha256, ...identityBearing } = receipt;
  return createHash('sha256').update(canonicalJson(identityBearing)).digest('hex');
}
