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
export const M31_SOURCE_REGISTRATION_SCHEMA = 'kaminos.m31-source-registration-receipt.v0';

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
  muscles = [],
  interaction = null,
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
      groups: skinBinding.groups.map(group => ({
        name: group.name,
        pivot: Array.from(group.pivot),
        parent: group.parent ?? null,
        ...(group.sourceBones ? { sourceBones: [...group.sourceBones] } : {}),
        ...(group.pivotDerivation ? { pivotDerivation: group.pivotDerivation } : {}),
      })),
      neighbors: skinBinding.neighbors,
      weightGroups: Array.from(skinBinding.weightGroups),
      weightValues: Array.from(skinBinding.weightValues),
    },
    castBinding: {
      triangle: Array.from(castBinding.triangle),
      local: Array.from(castBinding.local),
    },
    muscles: muscles.map(muscle => ({
      ...muscle,
      source: { ...muscle.source },
      supportMapping: { ...muscle.supportMapping },
      positions: Array.from(muscle.positions),
      triangles: Array.from(muscle.triangles),
      sectionIndices: Array.from(muscle.sectionIndices),
    })),
    ...(interaction ? {
      interaction: {
        initialControl: interaction.initialControl,
      },
    } : {}),
  };
  const digest = createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex');
  return { ...content, packageId: `sha256:${digest}` };
}

export function validateM31SourceRegistration(receipt, { sourceFixture = null, skeletonSha256 = null } = {}) {
  if (!receipt || receipt.schema !== M31_SOURCE_REGISTRATION_SCHEMA) {
    throw new Error('M31 source registration receipt is required');
  }
  const { receiptSha256, ...content } = receipt;
  const digest = createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex');
  if (receiptSha256 !== `sha256:${digest}`) {
    throw new Error(`M31 source registration receipt identity mismatch: ${String(receiptSha256)} != sha256:${digest}`);
  }
  const transform = receipt.transform;
  if (!(transform?.scale > 0)
      || !Array.isArray(transform.rotation) || transform.rotation.length !== 3
      || transform.rotation.some(row => !Array.isArray(row) || row.length !== 3 || row.some(value => !Number.isFinite(value)))
      || !Array.isArray(transform.translation) || transform.translation.length !== 3
      || transform.translation.some(value => !Number.isFinite(value))) {
    throw new Error('M31 source registration transform is malformed');
  }
  if (canonicalProxyRigJson(receipt.inputs?.supports) !== canonicalProxyRigJson(['Cube.002', 'Cube.003'])) {
    throw new Error('M31 source registration support identity mismatched');
  }
  if (sourceFixture && receipt.inputs?.sourceBlendSha256 !== sourceFixture.source?.assetSha256) {
    throw new Error('M31 source registration blend identity mismatched');
  }
  if (skeletonSha256 && receipt.inputs?.authoredSkeletonSha256 !== skeletonSha256) {
    throw new Error('M31 source registration skeleton identity mismatched');
  }
  if (!(receipt.residual?.rms <= 0.5) || !(receipt.residual?.max <= 1)) {
    throw new Error('M31 source registration residual exceeds its admission gate');
  }
  return receipt;
}

export function createM31LiveOverlay({ sourceFixture, sourceRegistration, chainTransforms }) {
  const { fixtureId: claimedFixtureId, ...fixtureContent } = sourceFixture ?? {};
  const fixtureDigest = createHash('sha256')
    .update(canonicalProxyRigJson(fixtureContent)).digest('hex');
  if (claimedFixtureId !== `sha256:${fixtureDigest}`) {
    throw new Error(`M31 live fixture identity mismatch: ${String(claimedFixtureId)} != sha256:${fixtureDigest}`);
  }
  if (sourceFixture.schema !== 'kaminos.proxy-rig-muscle-source.v0'
      || sourceFixture.relationId !== 'muscle-31'
      || canonicalProxyRigJson(sourceFixture.selection?.supportFamily)
        !== canonicalProxyRigJson(['Cube.002', 'Cube.003'])) {
    throw new Error('M31 live fixture relation or support family mismatched');
  }
  validateM31SourceRegistration(sourceRegistration, { sourceFixture });
  const sourceToSkeleton = sourceRegistration.transform;
  const sourceToCast = [sourceToSkeleton, ...chainTransforms];
  const positions = new Float64Array(sourceFixture.positions.length);
  for (let index = 0; index < sourceFixture.positions.length; index += 3) {
    positions.set(applyChain(sourceFixture.positions.slice(index, index + 3), sourceToCast), index);
  }
  const hingePivot = applyChain(sourceFixture.hinge.pivotWorld, sourceToCast);
  const rigidSectionCount = Math.max(2, Math.floor(sourceFixture.sectionCount * 0.2));
  const route = 'authenticated-m31-two-support-live-overlay';
  return {
    muscle: {
      schema: 'kaminos.proxy-rig-muscle.v0',
      relationId: 'muscle-31',
      requestedRoute: route,
      effectiveRoute: route,
      fallbackUsed: false,
      source: {
        historicalRef: sourceFixture.historicalRef,
        fixtureId: sourceFixture.fixtureId,
        sourceArtifactSha256: sourceFixture.sourceArtifactSha256,
        surfaceGeometrySha256: sourceFixture.source.surfaceGeometrySha256,
        sourceAssetSha256: sourceFixture.source.assetSha256,
        routingFixtureSha256: sourceFixture.source.routingFixtureSha256,
        registrationReceiptSha256: sourceRegistration.receiptSha256,
      },
      supportMapping: {
        fixed: 'hindlimb-left',
        moving: 'hindlimb-left-distal-support',
        fixedSource: 'Cube.002',
        movingSource: 'Cube.003',
      },
      hingePivot,
      positions,
      triangles: Uint32Array.from(sourceFixture.triangles),
      sectionIndices: Uint16Array.from(sourceFixture.sectionIndices),
      sectionCount: sourceFixture.sectionCount,
      originCapLastSection: rigidSectionCount - 1,
      insertionCapFirstSection: sourceFixture.sectionCount - rigidSectionCount,
    },
  };
}

export function createSkeletalSupportRefinement({
  parentGroup,
  childName,
  supportBone,
}) {
  const pivot = supportBone?.worldOrigin;
  if (typeof parentGroup !== 'string' || !parentGroup
      || typeof childName !== 'string' || !childName
      || typeof supportBone?.name !== 'string' || !supportBone.name
      || !Array.isArray(pivot) || pivot.length !== 3
      || pivot.some(value => !Number.isFinite(value))) {
    throw new Error('Skeletal support refinement requires named controls and an authored support origin');
  }
  return {
    parentGroup,
    childName,
    sourceBones: [supportBone.name],
    pivot: [...pivot],
    pivotDerivation: `authored ${supportBone.name} skeleton-node world origin`,
  };
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

export function assertM31AuthoredSupportProximity({
  pivot,
  supportBone,
  chainTransforms,
  maxRelativeDistance = 0.25,
}) {
  if (!Array.isArray(pivot) || pivot.length !== 3 || pivot.some(value => !Number.isFinite(value))) {
    throw new Error('M31 authored support proximity requires a finite pivot');
  }
  const positions = supportBone?.geometry?.positions;
  if (!positions?.length || positions.length % 3 !== 0) {
    throw new Error('M31 authored support proximity requires support geometry');
  }

  const lower = [Infinity, Infinity, Infinity];
  const upper = [-Infinity, -Infinity, -Infinity];
  let nearestDistance = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const point = applyChain(
      [positions[i], positions[i + 1], positions[i + 2]],
      chainTransforms,
    );
    for (let axis = 0; axis < 3; axis += 1) {
      lower[axis] = Math.min(lower[axis], point[axis]);
      upper[axis] = Math.max(upper[axis], point[axis]);
    }
    nearestDistance = Math.min(
      nearestDistance,
      Math.hypot(...point.map((value, axis) => value - pivot[axis])),
    );
  }
  const supportDiagonal = Math.hypot(...upper.map((value, axis) => value - lower[axis]));
  const maximumDistance = supportDiagonal * maxRelativeDistance;
  if (!(supportDiagonal > 0) || nearestDistance > maximumDistance) {
    throw new Error(
      `M31 authored support proximity failed for ${supportBone.name ?? 'unknown support'}: `
      + `${nearestDistance} > ${maximumDistance} (${maxRelativeDistance} x support diagonal)`,
    );
  }
  return { nearestDistance, supportDiagonal, maximumDistance };
}

// --- envelope <- skeleton binding ----------------------------------------------

function geometryCentroid(geometry) {
  const centroid = [0, 0, 0];
  const count = geometry.positions.length / 3;
  for (let i = 0; i < geometry.positions.length; i += 3) {
    centroid[0] += geometry.positions[i];
    centroid[1] += geometry.positions[i + 1];
    centroid[2] += geometry.positions[i + 2];
  }
  return centroid.map(value => value / count);
}

function averageCentroid(entries) {
  return [0, 1, 2].map(axis => (
    entries.reduce((sum, entry) => sum + entry.centroid[axis], 0) / entries.length
  ));
}

function splitAtLargestProjectionGaps(entries, count) {
  if (entries.length < count) {
    throw new Error(`derive-hindlimb-chain: ${entries.length} source bones cannot form ${count} segments`);
  }
  const sorted = entries.slice().sort((a, b) => a.projection - b.projection || a.bone.name.localeCompare(b.bone.name));
  const splitAfter = new Set(sorted.slice(0, -1).map((entry, index) => ({
    index,
    gap: sorted[index + 1].projection - entry.projection,
  })).sort((a, b) => b.gap - a.gap || a.index - b.index).slice(0, count - 1).map(value => value.index));
  const clusters = [[]];
  sorted.forEach((entry, index) => {
    clusters.at(-1).push(entry);
    if (splitAfter.has(index)) clusters.push([]);
  });
  return clusters;
}

function nearestSurfaceBoundary(leftEntries, rightEntries) {
  let bestDistanceSquared = Infinity;
  let leftPoint = null;
  let rightPoint = null;
  for (const left of leftEntries) {
    const a = left.bone.geometry.positions;
    for (const right of rightEntries) {
      const b = right.bone.geometry.positions;
      for (let i = 0; i < a.length; i += 3) {
        for (let j = 0; j < b.length; j += 3) {
          const distanceSquared = (a[i] - b[j]) ** 2
            + (a[i + 1] - b[j + 1]) ** 2
            + (a[i + 2] - b[j + 2]) ** 2;
          if (distanceSquared < bestDistanceSquared) {
            bestDistanceSquared = distanceSquared;
            leftPoint = [a[i], a[i + 1], a[i + 2]];
            rightPoint = [b[j], b[j + 1], b[j + 2]];
          }
        }
      }
    }
  }
  if (!leftPoint || !rightPoint) throw new Error('derive-hindlimb-chain: no finite segment boundary');
  return leftPoint.map((value, axis) => (value + rightPoint[axis]) / 2);
}

export function deriveHindlimbHierarchy({ bones, manifest, broadGroup, side = 'right' }) {
  const regionOf = bone => manifest.bone_to_region[bone.name] ?? 'unmapped';
  const members = broadGroup.bones.map(bone => ({
    bone,
    region: regionOf(bone),
    centroid: geometryCentroid(bone.geometry),
  }));
  const hindlimb = members.filter(entry => entry.region === 'hindlimb');
  const pedal = members.filter(entry => entry.region === 'pedal');
  if (hindlimb.length < 3 || pedal.length < 2) {
    throw new Error(`derive-hindlimb-chain: ${broadGroup.name} lacks hindlimb/pedal source support`);
  }
  const pedalCenter = averageCentroid(pedal);
  const direction = pedalCenter.map((value, axis) => value - broadGroup.pivot[axis]);
  const length = Math.hypot(...direction);
  if (length < 1e-9) throw new Error(`derive-hindlimb-chain: ${broadGroup.name} has no proximodistal extent`);
  direction.forEach((value, axis) => { direction[axis] = value / length; });
  for (const entry of members) {
    entry.projection = entry.centroid.reduce(
      (sum, value, axis) => sum + (value - broadGroup.pivot[axis]) * direction[axis],
      0,
    );
  }

  const [proximal, middle, distal] = splitAtLargestProjectionGaps(hindlimb, 3);
  const [proximalPedal, distalPedal] = splitAtLargestProjectionGaps(pedal, 2);
  const pelvis = bones.filter(bone => regionOf(bone) === 'pelvis').map(bone => ({
    bone,
    region: 'pelvis',
    centroid: geometryCentroid(bone.geometry),
  }));
  if (pelvis.length === 0) throw new Error('derive-hindlimb-chain: pelvis attachment source is missing');

  const specifications = [
    {
      suffix: 'hip',
      entries: proximal,
      pivot: nearestSurfaceBoundary(pelvis, proximal),
      parent: null,
      pivotDerivation: 'pelvis/proximal nearest-surface attachment midpoint',
    },
    {
      suffix: 'stifle',
      entries: middle,
      pivot: nearestSurfaceBoundary(proximal, middle),
      parent: `${broadGroup.name}-hip`,
      pivotDerivation: 'proximal/middle nearest-surface boundary midpoint',
    },
    {
      suffix: 'hock',
      entries: [...distal, ...proximalPedal],
      pivot: nearestSurfaceBoundary(middle, distal),
      parent: `${broadGroup.name}-stifle`,
      pivotDerivation: 'middle/distal nearest-surface boundary midpoint',
    },
    {
      suffix: 'paw',
      entries: distalPedal,
      pivot: nearestSurfaceBoundary(proximalPedal, distalPedal),
      parent: `${broadGroup.name}-hock`,
      pivotDerivation: 'proximal/distal pedal nearest-surface boundary midpoint',
    },
  ];
  return specifications.map(specification => ({
    name: `${broadGroup.name}-${specification.suffix}`,
    parent: specification.parent,
    pivot: specification.pivot,
    bones: specification.entries.map(entry => entry.bone),
    sourceBones: specification.entries.map(entry => entry.bone.name).sort(),
    pivotDerivation: specification.pivotDerivation,
    derivation: `manifest ${broadGroup.name} instance; ${side} side; largest proximodistal source-geometry gaps`,
  }));
}

export function bindEnvelopeToSkeleton({
  envelope,
  bones,
  manifest,
  chainTransforms,
  supportRefinements = [],
  samplesPerBone = 30,
  neighbors = 2,
}) {
  const broadGroups = deriveRefinementGroups(bones, manifest);
  let groups = broadGroups.flatMap(group => (
    group.name === 'hindlimb-right'
      ? deriveHindlimbHierarchy({ bones, manifest, broadGroup: group, side: 'right' })
      : [{
        ...group,
        parent: null,
        sourceBones: group.boneNames.slice().sort(),
        pivotDerivation: 'nearest source-member centroid to core center',
      }]
  ));
  for (const refinement of supportRefinements) {
    const parentIndex = groups.findIndex(group => group.name === refinement.parentGroup);
    if (parentIndex < 0) throw new Error(`support refinement parent ${refinement.parentGroup} is missing`);
    const parent = groups[parentIndex];
    const childNames = new Set(refinement.sourceBones);
    const childBones = parent.bones.filter(bone => childNames.has(bone.name));
    if (childBones.length !== childNames.size) {
      throw new Error(`support refinement ${refinement.childName} source bones are not all owned by ${parent.name}`);
    }
    const remainingBones = parent.bones.filter(bone => !childNames.has(bone.name));
    if (remainingBones.length === 0) throw new Error(`support refinement ${refinement.childName} empties ${parent.name}`);
    const refinedParent = {
      ...parent,
      bones: remainingBones,
      sourceBones: remainingBones.map(bone => bone.name).sort(),
    };
    const child = {
      name: refinement.childName,
      parent: parent.name,
      pivot: refinement.pivot,
      bones: childBones,
      sourceBones: childBones.map(bone => bone.name).sort(),
      pivotDerivation: refinement.pivotDerivation,
    };
    groups = [...groups.slice(0, parentIndex), refinedParent, child, ...groups.slice(parentIndex + 1)];
  }
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
      parent: group.parent,
      sourceBones: group.sourceBones,
      pivotDerivation: group.pivotDerivation,
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
    groups: controls.map(c => ({
      name: c.name,
      pivot: c.pivot,
      parent: c.parent,
      sourceBones: c.sourceBones,
      pivotDerivation: c.pivotDerivation,
    })),
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
