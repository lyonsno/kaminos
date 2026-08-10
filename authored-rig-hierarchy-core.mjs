import { createHash } from 'node:crypto';

import { canonicalProxyRigJson } from './proxy-rig-runtime.mjs';

export const AUTHORED_RIG_HIERARCHY_SCHEMA = 'kaminos.authored-rig-hierarchy.v0';
export const AUTHORED_RIG_SOURCE_MESH_IDENTITY_SCHEMA = 'kaminos.authored-rig-source-mesh-identity.v0';

const SOURCE_BONE_ASSIGNMENTS = {
  left: {
    hip: ['Icosphere', 'Cube.002'],
    stifle: ['Cube.001', 'Cube.005'],
    hock: ['Cube.003', 'Cube.004', 'Cube.012', 'Cube.045', 'Cube.066', 'Cube.067', 'Cube.072', 'Cube.073', 'Cube.074', 'Cube.075'],
  },
  right: {
    hip: ['Cube.083', 'Cube.087'],
    stifle: ['Cube.086', 'Cube.089'],
    hock: ['Cube.068', 'Cube.069', 'Cube.070', 'Cube.071', 'Cube.081', 'Cube.082', 'Cube.084', 'Cube.085', 'Cube.088'],
  },
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function meshIdentityRows(matches) {
  return matches.map(({ nodeIndex, nodeName, meshIndex }) => ({ nodeIndex, nodeName, meshIndex }));
}

export function createAuthoredRigSourceMeshIdentity(receipt) {
  const content = {
    schema: AUTHORED_RIG_SOURCE_MESH_IDENTITY_SCHEMA,
    source: {
      hierarchy: receipt.source.hierarchy,
      hierarchySha256: receipt.source.hierarchySha256,
    },
    effectiveRoot: { ...receipt.effectiveRoot },
    meshNodes: meshIdentityRows(receipt.meshMatches),
  };
  return {
    ...content,
    identitySha256: `sha256:${createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex')}`,
  };
}

export function validateAuthoredRigSourceMeshIdentity(identity) {
  if (!identity || identity.schema !== AUTHORED_RIG_SOURCE_MESH_IDENTITY_SCHEMA) {
    throw new Error('Authored rig source mesh identity is required');
  }
  const { identitySha256, ...content } = identity;
  const expected = `sha256:${createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex')}`;
  if (identitySha256 !== expected) {
    throw new Error(`Authored rig source mesh identity mismatch: ${String(identitySha256)} != ${expected}`);
  }
  if (!Array.isArray(identity.meshNodes) || identity.meshNodes.length === 0
      || identity.meshNodes.some(node => (
        !Number.isInteger(node?.nodeIndex)
          || !String(node?.nodeName ?? '')
          || !Number.isInteger(node?.meshIndex)
      ))
      || new Set(identity.meshNodes.map(node => node.nodeIndex)).size !== identity.meshNodes.length) {
    throw new Error('Authored rig source mesh identity table is malformed');
  }
  return identity;
}

export function parseGlbDocument(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20
      || bytes.readUInt32LE(0) !== 0x46546c67
      || bytes.readUInt32LE(4) !== 2) {
    throw new Error('Authored hierarchy source must be a GLB v2 buffer');
  }
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > bytes.length) {
    throw new Error('Authored hierarchy GLB JSON chunk is malformed');
  }
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/u, ''));
}

function multiplyMatrix(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        out[column * 4 + row] += a[inner * 4 + row] * b[column * 4 + inner];
      }
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return [...node.matrix];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    (2 * (x * y + z * w)) * sx,
    (2 * (x * z - y * w)) * sx,
    0,
    (2 * (x * y - z * w)) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    (2 * (y * z + x * w)) * sy,
    0,
    (2 * (x * z + y * w)) * sz,
    (2 * (y * z - x * w)) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function worldMatrices(document) {
  const parents = new Array(document.nodes.length).fill(-1);
  document.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      if (parents[child] >= 0) throw new Error(`Authored hierarchy node ${child} has multiple parents`);
      parents[child] = index;
    }
  });
  const cache = new Array(document.nodes.length);
  const active = new Set();
  const resolve = index => {
    if (cache[index]) return cache[index];
    if (active.has(index)) throw new Error(`Authored hierarchy contains a cycle at node ${index}`);
    active.add(index);
    const local = nodeMatrix(document.nodes[index]);
    cache[index] = parents[index] < 0 ? local : multiplyMatrix(resolve(parents[index]), local);
    active.delete(index);
    return cache[index];
  };
  document.nodes.forEach((_, index) => resolve(index));
  return cache;
}

function matrixOrigin(matrix) {
  return [matrix[12], matrix[13], matrix[14]];
}

function descendants(document, rootIndex) {
  const result = [];
  const visit = index => {
    result.push(index);
    for (const child of document.nodes[index].children ?? []) visit(child);
  };
  visit(rootIndex);
  return result;
}

function oneControlChild(document, index, role) {
  const controls = (document.nodes[index].children ?? []).filter(child => (
    document.nodes[child].mesh === undefined
  ));
  if (controls.length !== 1) {
    throw new Error(`Authored ${role} node must have exactly one child control, got ${controls.length}`);
  }
  return controls[0];
}

function hierarchyControlIndices(document, rootIndex) {
  const branches = (document.nodes[rootIndex].children ?? []).filter(index => (
    document.nodes[index].mesh === undefined
  ));
  if (branches.length !== 2) throw new Error(`Authored pelvis must have two limb branches, got ${branches.length}`);
  return branches.map(hip => {
    const stifle = oneControlChild(document, hip, 'hip');
    const hock = oneControlChild(document, stifle, 'stifle');
    if ((document.nodes[hock].children ?? []).some(child => document.nodes[child].mesh === undefined)) {
      throw new Error('Authored hock must terminate the control branch');
    }
    return { hip, stifle, hock };
  });
}

function nearestBone(origin, bones) {
  return bones.map(bone => ({
    name: bone.name,
    distance: Math.hypot(...bone.worldOrigin.map((value, axis) => value - origin[axis])),
  })).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))[0];
}

function validateAssignedBones(bones) {
  const available = new Set(bones.map(bone => bone.name));
  for (const [side, controls] of Object.entries(SOURCE_BONE_ASSIGNMENTS)) {
    for (const [role, names] of Object.entries(controls)) {
      const missing = names.filter(name => !available.has(name));
      if (missing.length) throw new Error(`Authored ${side} ${role} source map is missing ${missing.join(', ')}`);
    }
  }
}

export function extractAuthoredRigHierarchy({
  hierarchyBytes,
  hierarchyLabel,
  skeletonBytes,
  bones,
  rootName = 'pelvis',
  matchTolerance = 1e-3,
  unmatchedAdmissions = [],
}) {
  const document = parseGlbDocument(hierarchyBytes);
  const roots = document.nodes.map((node, index) => ({ node, index }))
    .filter(({ node }) => node.name === rootName);
  if (roots.length !== 1) throw new Error(`Authored hierarchy requires one ${rootName} root, got ${roots.length}`);
  const rootIndex = roots[0].index;
  const subtree = descendants(document, rootIndex);
  const subtreeSet = new Set(subtree);
  const matrices = worldMatrices(document);
  const pelvisMeshes = (document.nodes[rootIndex].children ?? []).filter(index => (
    document.nodes[index].mesh !== undefined
  ));
  if (pelvisMeshes.length !== 1) {
    throw new Error(`Authored pelvis must directly own one mesh, got ${pelvisMeshes.length}`);
  }
  const skeletonPelvis = bones.find(bone => bone.name === 'SRC_PELVIS');
  if (!skeletonPelvis) throw new Error('Authored hierarchy registration requires skeleton SRC_PELVIS');
  const hierarchyPelvisOrigin = matrixOrigin(matrices[pelvisMeshes[0]]);
  const translation = skeletonPelvis.worldOrigin.map((value, axis) => value - hierarchyPelvisOrigin[axis]);
  const inSkeletonFrame = index => matrixOrigin(matrices[index]).map((value, axis) => value + translation[axis]);

  const meshMatches = subtree.filter(index => document.nodes[index].mesh !== undefined).map(index => {
    const nearest = nearestBone(inSkeletonFrame(index), bones);
    return {
      nodeIndex: index,
      nodeName: document.nodes[index].name ?? null,
      meshIndex: document.nodes[index].mesh,
      skeletonBone: nearest.distance <= matchTolerance ? nearest.name : null,
      residual: nearest.distance,
    };
  });
  const matchedBySubtree = new Map(meshMatches.filter(match => match.skeletonBone)
    .map(match => [match.nodeIndex, match.skeletonBone]));
  const branches = hierarchyControlIndices(document, rootIndex).map(branch => {
    const mappedBones = descendants(document, branch.hip)
      .filter(index => subtreeSet.has(index))
      .map(index => matchedBySubtree.get(index))
      .filter(Boolean);
    const side = mappedBones.includes('Cube.002')
      ? 'left'
      : mappedBones.includes('Cube.087')
        ? 'right'
        : null;
    if (!side) throw new Error(`Authored limb branch ${document.nodes[branch.hip].name ?? branch.hip} lacks a semantic femur anchor`);
    const sourceAnchor = side === 'left' ? 'Cube.002' : 'Cube.087';
    const rawHipNode = document.nodes[branch.hip].name ?? null;
    const rawHipSide = rawHipNode?.match(/^hindlimb-(left|right)-hip(?:\.|$)/u)?.[1] ?? null;
    return { ...branch, side, sourceAnchor, rawHipNode, rawHipSide };
  });
  if (new Set(branches.map(branch => branch.side)).size !== 2) {
    throw new Error('Authored limb branches do not resolve to distinct canonical sides');
  }
  validateAssignedBones(bones);

  const unmatchedMeshNodes = meshMatches.filter(match => !match.skeletonBone);
  const unmatchedNames = unmatchedMeshNodes.map(match => match.nodeName);
  if (unmatchedNames.some(name => !name)
      || new Set(unmatchedNames).size !== unmatchedNames.length) {
    throw new Error('Unmatched authored mesh nodes require unique non-empty names for admission');
  }
  const admissions = unmatchedAdmissions.map(admission => ({
    nodeName: String(admission?.nodeName ?? ''),
    rationale: String(admission?.rationale ?? ''),
  }));
  if (admissions.some(admission => !admission.nodeName || !admission.rationale.trim())
      || new Set(admissions.map(admission => admission.nodeName)).size !== admissions.length) {
    throw new Error('Unmatched authored mesh admission requires a unique node name and non-empty rationale');
  }
  const admittedNames = new Set(admissions.map(admission => admission.nodeName));
  const missingAdmissions = unmatchedNames.filter(name => !admittedNames.has(name));
  const extraAdmissions = admissions.filter(admission => !unmatchedNames.includes(admission.nodeName));
  if (missingAdmissions.length || extraAdmissions.length) {
    throw new Error(`Unmatched authored mesh admission mismatch: missing [${missingAdmissions.join(', ')}], extra [${extraAdmissions.map(admission => admission.nodeName).join(', ')}]`);
  }

  const controls = [{
    name: 'pelvis',
    parent: null,
    pivot: inSkeletonFrame(rootIndex),
    sourceBones: ['SRC_PELVIS'],
    rawSourceNode: document.nodes[rootIndex].name,
    pivotDerivation: `operator-authored ${rootName} empty registered by SRC_PELVIS translation anchor`,
  }];
  for (const branch of branches.sort((a, b) => a.side.localeCompare(b.side))) {
    for (const role of ['hip', 'stifle', 'hock']) {
      controls.push({
        name: `hindlimb-${branch.side}-${role}`,
        parent: role === 'hip' ? 'pelvis' : `hindlimb-${branch.side}-${role === 'stifle' ? 'hip' : 'stifle'}`,
        pivot: inSkeletonFrame(branch[role]),
        sourceBones: [...SOURCE_BONE_ASSIGNMENTS[branch.side][role]],
        rawSourceNode: document.nodes[branch[role]].name ?? null,
        pivotDerivation: `operator-authored ${document.nodes[branch[role]].name ?? role} empty registered into skeleton frame`,
      });
    }
  }

  const content = {
    schema: AUTHORED_RIG_HIERARCHY_SCHEMA,
    source: {
      hierarchy: hierarchyLabel,
      hierarchySha256: sha256(hierarchyBytes),
      skeleton: 'artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb',
      skeletonSha256: sha256(skeletonBytes),
    },
    effectiveRoot: {
      name: rootName,
      nodeIndex: rootIndex,
      nodeCount: subtree.length,
      meshNodeCount: meshMatches.length,
    },
    registration: {
      type: 'translation',
      translation,
      anchor: {
        hierarchyNode: document.nodes[pelvisMeshes[0]].name ?? null,
        skeletonBone: 'SRC_PELVIS',
        residual: Math.hypot(...inSkeletonFrame(pelvisMeshes[0]).map(
          (value, axis) => value - skeletonPelvis.worldOrigin[axis],
        )),
      },
    },
    sideResolution: {
      authority: 'frozen-skeleton-source-bone-anchor',
      anchors: { left: 'Cube.002', right: 'Cube.087' },
      rawNodeLabels: 'advisory',
      branches: branches.sort((a, b) => a.side.localeCompare(b.side)).map(branch => ({
        canonicalSide: branch.side,
        sourceAnchor: branch.sourceAnchor,
        rawHipNode: branch.rawHipNode,
        rawHipSide: branch.rawHipSide,
        agrees: branch.side === branch.rawHipSide,
      })),
    },
    replaces: ['hindlimb-left', 'hindlimb-right'],
    controls,
    meshMatches,
    unmatchedMeshNodes,
    unmatchedMeshPolicy: {
      mode: 'explicit-allowlist',
      admitted: admissions,
    },
    claimCeiling: 'operator-authored assay control hierarchy registered into the frozen skeleton frame; not an authored skin or production armature',
  };
  const receiptSha256 = `sha256:${createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex')}`;
  return { ...content, receiptSha256 };
}

export function validateAuthoredRigHierarchy(receipt, {
  skeletonSha256 = null,
  sourceMeshIdentity = null,
} = {}) {
  if (!receipt || receipt.schema !== AUTHORED_RIG_HIERARCHY_SCHEMA) {
    throw new Error('Authored rig hierarchy receipt is required');
  }
  const { receiptSha256, ...content } = receipt;
  const expected = `sha256:${createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex')}`;
  if (receiptSha256 !== expected) throw new Error(`Authored rig hierarchy receipt identity mismatch: ${String(receiptSha256)} != ${expected}`);
  if (skeletonSha256 && receipt.source?.skeletonSha256 !== skeletonSha256) {
    throw new Error(`Authored rig hierarchy skeleton identity mismatch: ${String(receipt.source?.skeletonSha256)} != ${skeletonSha256}`);
  }
  if (receipt.effectiveRoot?.name !== 'pelvis'
      || !Number.isInteger(receipt.effectiveRoot.nodeCount) || receipt.effectiveRoot.nodeCount < 7
      || !Number.isInteger(receipt.effectiveRoot.meshNodeCount) || receipt.effectiveRoot.meshNodeCount < 7) {
    throw new Error('Authored rig hierarchy effective pelvis subtree is malformed');
  }
  if (!Array.isArray(receipt.controls)) {
    throw new Error('Authored rig hierarchy controls are missing');
  }
  const byName = new Map(receipt.controls.map(control => [control.name, control]));
  if (byName.size !== receipt.controls.length) {
    throw new Error('Authored rig hierarchy controls contain duplicate names');
  }
  const expectedAnchors = { left: 'Cube.002', right: 'Cube.087' };
  if (receipt.sideResolution?.authority !== 'frozen-skeleton-source-bone-anchor'
      || receipt.sideResolution?.rawNodeLabels !== 'advisory'
      || canonicalProxyRigJson(receipt.sideResolution?.anchors) !== canonicalProxyRigJson(expectedAnchors)) {
    throw new Error('Authored rig hierarchy side authority is missing or malformed');
  }
  const sideBranches = receipt.sideResolution?.branches;
  if (!Array.isArray(sideBranches) || sideBranches.length !== 2
      || new Set(sideBranches.map(branch => branch.canonicalSide)).size !== 2) {
    throw new Error('Authored rig hierarchy raw side diagnostic is incomplete');
  }
  for (const branch of sideBranches) {
    const expectedAnchor = expectedAnchors[branch.canonicalSide];
    const hipControl = byName.get(`hindlimb-${branch.canonicalSide}-hip`);
    const parsedRawSide = String(branch.rawHipNode ?? '')
      .match(/^hindlimb-(left|right)-hip(?:\.|$)/u)?.[1] ?? null;
    if (!expectedAnchor || branch.sourceAnchor !== expectedAnchor
        || !hipControl || hipControl.rawSourceNode !== branch.rawHipNode
        || !Array.isArray(hipControl.sourceBones) || !hipControl.sourceBones.includes(expectedAnchor)
        || branch.rawHipSide !== parsedRawSide
        || branch.agrees !== (branch.canonicalSide === parsedRawSide)) {
      throw new Error(`Authored rig hierarchy raw side diagnostic is inconsistent for ${String(branch.canonicalSide)}`);
    }
  }
  const meshMatches = receipt.meshMatches;
  if (!Array.isArray(meshMatches)
      || meshMatches.length !== receipt.effectiveRoot.meshNodeCount) {
    throw new Error(`Authored rig hierarchy mesh match count ${String(meshMatches?.length)} does not equal declared subtree count ${receipt.effectiveRoot.meshNodeCount}`);
  }
  if (meshMatches.some(match => (
    !Number.isInteger(match?.nodeIndex)
      || !String(match?.nodeName ?? '')
      || !Number.isInteger(match?.meshIndex)
      || !(match?.skeletonBone === null || (typeof match?.skeletonBone === 'string' && match.skeletonBone))
      || !Number.isFinite(match?.residual) || match.residual < 0
  )) || new Set(meshMatches.map(match => match.nodeIndex)).size !== meshMatches.length) {
    throw new Error('Authored rig hierarchy mesh match table is malformed');
  }
  validateAuthoredRigSourceMeshIdentity(sourceMeshIdentity);
  if (sourceMeshIdentity.source?.hierarchy !== receipt.source?.hierarchy
      || sourceMeshIdentity.source?.hierarchySha256 !== receipt.source?.hierarchySha256
      || canonicalProxyRigJson(sourceMeshIdentity.effectiveRoot) !== canonicalProxyRigJson(receipt.effectiveRoot)
      || canonicalProxyRigJson(sourceMeshIdentity.meshNodes) !== canonicalProxyRigJson(meshIdentityRows(meshMatches))) {
    throw new Error('Authored rig hierarchy does not match the source mesh identity');
  }
  const unmatched = receipt.unmatchedMeshNodes;
  const admitted = receipt.unmatchedMeshPolicy?.admitted;
  const unmatchedFromMatches = meshMatches.filter(match => match.skeletonBone === null);
  if (!Array.isArray(unmatched) || !Array.isArray(admitted)
      || receipt.unmatchedMeshPolicy?.mode !== 'explicit-allowlist'
      || canonicalProxyRigJson(unmatched) !== canonicalProxyRigJson(unmatchedFromMatches)) {
    throw new Error('Authored rig hierarchy unmatched mesh admission is malformed');
  }
  const unmatchedNames = unmatched.map(match => match.nodeName);
  const admittedNames = admitted.map(admission => admission.nodeName);
  if (unmatchedNames.some(name => !name)
      || admitted.some(admission => !admission.nodeName || !String(admission.rationale ?? '').trim())
      || new Set(unmatchedNames).size !== unmatchedNames.length
      || new Set(admittedNames).size !== admittedNames.length
      || canonicalProxyRigJson([...unmatchedNames].sort()) !== canonicalProxyRigJson([...admittedNames].sort())) {
    throw new Error('Authored rig hierarchy unmatched mesh admission does not cover the exact unmatched set');
  }
  const expectedParents = {
    pelvis: null,
    'hindlimb-left-hip': 'pelvis',
    'hindlimb-left-stifle': 'hindlimb-left-hip',
    'hindlimb-left-hock': 'hindlimb-left-stifle',
    'hindlimb-right-hip': 'pelvis',
    'hindlimb-right-stifle': 'hindlimb-right-hip',
    'hindlimb-right-hock': 'hindlimb-right-stifle',
  };
  for (const [name, parent] of Object.entries(expectedParents)) {
    const control = byName.get(name);
    if (!control || (control.parent ?? null) !== parent) {
      throw new Error(`Authored rig hierarchy control ${name} has the wrong parent`);
    }
  }
  if (!byName.get('hindlimb-left-hip').sourceBones.includes('Cube.002')
      || !byName.get('hindlimb-left-hock').sourceBones.includes('Cube.003')) {
    throw new Error('Authored rig hierarchy does not assign M31 supports to left hip and hock');
  }
  if ([...byName].some(([name]) => /distal-support|muscle|m31|insertion/i.test(name))) {
    throw new Error('Authored rig hierarchy contains a relation-owned control');
  }
  return receipt;
}
