import { createHash } from 'node:crypto';

export const K4_ENVELOPE_FRAME_BINDING_SCHEMA = 'kaminos.k4-envelope-frame-binding-receipt.v0';

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTITY_ROTATION = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireSha256(value, label) {
  if (!SHA256.test(value ?? '')) throw new Error(`k4-envelope-frame-binding: ${label} must be SHA-256`);
}

function finiteMatrix4(value, label) {
  if (!Array.isArray(value) || value.length !== 16 || value.some(item => !Number.isFinite(item))) {
    throw new Error(`k4-envelope-frame-binding: ${label} must be a finite 4x4 matrix`);
  }
  return value;
}

function multiply4(left, right) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        out[row * 4 + column] += left[row * 4 + inner] * right[inner * 4 + column];
      }
    }
  }
  return out;
}

function invertAffine4(matrix, label) {
  const m = finiteMatrix4(matrix, label);
  if (Math.max(Math.abs(m[12]), Math.abs(m[13]), Math.abs(m[14]), Math.abs(m[15] - 1)) > 1e-9) {
    throw new Error(`k4-envelope-frame-binding: ${label} is not affine`);
  }
  const a = m[0]; const b = m[1]; const c = m[2];
  const d = m[4]; const e = m[5]; const f = m[6];
  const g = m[8]; const h = m[9]; const i = m[10];
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) {
    throw new Error(`k4-envelope-frame-binding: ${label} is singular`);
  }
  const inverse = [
    (e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant, 0,
    (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant, 0,
    (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant, 0,
    0, 0, 0, 1,
  ];
  const translation = [m[3], m[7], m[11]];
  for (let row = 0; row < 3; row += 1) {
    inverse[row * 4 + 3] = -(
      inverse[row * 4] * translation[0]
      + inverse[row * 4 + 1] * translation[1]
      + inverse[row * 4 + 2] * translation[2]
    );
  }
  return inverse;
}

function gltfNodeMatrix(node) {
  if (node.matrix !== undefined) {
    const columnMajor = finiteMatrix4(node.matrix, 'skeleton anchor matrix');
    return [
      columnMajor[0], columnMajor[4], columnMajor[8], columnMajor[12],
      columnMajor[1], columnMajor[5], columnMajor[9], columnMajor[13],
      columnMajor[2], columnMajor[6], columnMajor[10], columnMajor[14],
      columnMajor[3], columnMajor[7], columnMajor[11], columnMajor[15],
    ];
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const values = [tx, ty, tz, qx, qy, qz, qw, sx, sy, sz];
  if (values.some(value => !Number.isFinite(value))) {
    throw new Error('k4-envelope-frame-binding: skeleton anchor TRS must be finite');
  }
  const x2 = qx + qx; const y2 = qy + qy; const z2 = qz + qz;
  const xx = qx * x2; const xy = qx * y2; const xz = qx * z2;
  const yy = qy * y2; const yz = qy * z2; const zz = qz * z2;
  const wx = qw * x2; const wy = qw * y2; const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy - wz) * sy, (xz + wy) * sz, tx,
    (xy + wz) * sx, (1 - (xx + zz)) * sy, (yz - wx) * sz, ty,
    (xz - wy) * sx, (yz + wx) * sy, (1 - (xx + yy)) * sz, tz,
    0, 0, 0, 1,
  ];
}

function determinant3(matrix) {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

function decomposePositiveSimilarity(matrix, tolerance = 2e-6) {
  const linear = [
    matrix.slice(0, 3),
    matrix.slice(4, 7),
    matrix.slice(8, 11),
  ];
  const columnNorms = [0, 1, 2].map(column => Math.hypot(
    linear[0][column], linear[1][column], linear[2][column],
  ));
  const scale = columnNorms.reduce((sum, value) => sum + value, 0) / 3;
  if (!(scale > 0) || columnNorms.some(value => Math.abs(value - scale) > tolerance)) {
    throw new Error('k4-envelope-frame-binding: anchor relation is not a uniform positive similarity');
  }
  const rotation = linear.map(row => row.map(value => value / scale));
  let maximumOrthonormalResidual = 0;
  for (let left = 0; left < 3; left += 1) {
    for (let right = 0; right < 3; right += 1) {
      let dot = 0;
      for (let row = 0; row < 3; row += 1) dot += rotation[row][left] * rotation[row][right];
      maximumOrthonormalResidual = Math.max(maximumOrthonormalResidual, Math.abs(dot - (left === right ? 1 : 0)));
    }
  }
  if (maximumOrthonormalResidual > tolerance || determinant3(rotation) < 1 - tolerance) {
    throw new Error('k4-envelope-frame-binding: anchor relation is not a uniform positive similarity');
  }
  const reconstructed = [
    scale * rotation[0][0], scale * rotation[0][1], scale * rotation[0][2], matrix[3],
    scale * rotation[1][0], scale * rotation[1][1], scale * rotation[1][2], matrix[7],
    scale * rotation[2][0], scale * rotation[2][1], scale * rotation[2][2], matrix[11],
    0, 0, 0, 1,
  ];
  const maximumMatrixResidual = Math.max(...matrix.map((value, index) => Math.abs(value - reconstructed[index])));
  if (maximumMatrixResidual > tolerance) {
    throw new Error('k4-envelope-frame-binding: anchor relation is not a uniform positive similarity');
  }
  return {
    scale,
    rotation,
    translation: [matrix[3], matrix[7], matrix[11]],
    maximumMatrixResidual,
    maximumOrthonormalResidual,
  };
}

function composeSimilarity(second, first) {
  const rotation = Array.from({ length: 3 }, () => new Array(3).fill(0));
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        rotation[row][column] += second.rotation[row][inner] * first.rotation[inner][column];
      }
    }
  }
  const translation = [0, 1, 2].map(row => second.scale * (
    second.rotation[row][0] * first.translation[0]
    + second.rotation[row][1] * first.translation[1]
    + second.rotation[row][2] * first.translation[2]
  ) + second.translation[row]);
  return { scale: second.scale * first.scale, rotation, translation };
}

function centerlineCandidate(row) {
  const candidates = row?.fields?.centerline?.candidates ?? [];
  const matches = candidates.filter(candidate => candidate.kind === 'source-curve-centerline');
  if (matches.length !== 1) {
    throw new Error(`k4-envelope-frame-binding: expected one source centerline ${row?.constructionId ?? 'unknown'}`);
  }
  return matches[0]?.value?.resampledSamples ?? [];
}

function compareK4SourceWorld(parentAtlas, requestedConstructionIds, baselineCondition) {
  const rows = parentAtlas?.routeInventory ?? [];
  const muscles = baselineCondition?.source?.muscles ?? [];
  const effectiveConstructionIds = muscles.map(muscle => muscle.id);
  if (JSON.stringify(effectiveConstructionIds) !== JSON.stringify(requestedConstructionIds)) {
    throw new Error('k4-envelope-frame-binding: baseline construction order does not match request');
  }
  let maximumPositionDelta = 0;
  let maximumRadiusDelta = 0;
  let fullSampleIdentity = true;
  for (const constructionId of requestedConstructionIds) {
    const matchingRows = rows.filter(row => row.constructionId === constructionId);
    if (matchingRows.length !== 1) {
      throw new Error(`k4-envelope-frame-binding: expected one atlas row ${constructionId}`);
    }
    const expected = centerlineCandidate(matchingRows[0]);
    const actual = muscles.find(muscle => muscle.id === constructionId)?.centerline ?? [];
    if (expected.length !== actual.length || expected.length === 0) {
      throw new Error(`k4-envelope-frame-binding: baseline centerline mismatch ${constructionId}`);
    }
    for (let index = 0; index < expected.length; index += 1) {
      if (canonicalJson(expected[index]) !== canonicalJson(actual[index])) fullSampleIdentity = false;
      const left = expected[index].position;
      const right = actual[index].position;
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 3 || right.length !== 3) {
        throw new Error(`k4-envelope-frame-binding: baseline centerline mismatch ${constructionId}`);
      }
      for (let axis = 0; axis < 3; axis += 1) {
        maximumPositionDelta = Math.max(maximumPositionDelta, Math.abs(left[axis] - right[axis]));
      }
      const expectedRadius = expected[index].radius;
      const actualRadius = actual[index].radius;
      if (!Number.isFinite(expectedRadius) || !Number.isFinite(actualRadius)) {
        throw new Error(`k4-envelope-frame-binding: baseline radius mismatch ${constructionId}`);
      }
      maximumRadiusDelta = Math.max(maximumRadiusDelta, Math.abs(expectedRadius - actualRadius));
    }
  }
  if (maximumPositionDelta !== 0) {
    const mismatch = requestedConstructionIds.find(constructionId => {
      const row = rows.find(item => item.constructionId === constructionId);
      const muscle = muscles.find(item => item.id === constructionId);
      return JSON.stringify(centerlineCandidate(row).map(sample => sample.position))
        !== JSON.stringify(muscle.centerline.map(sample => sample.position));
    });
    throw new Error(`k4-envelope-frame-binding: baseline centerline mismatch ${mismatch}`);
  }
  return {
    effectiveConstructionIds,
    maximumPositionDelta,
    maximumRadiusDelta,
    fullSampleIdentity,
  };
}

export function buildK4EnvelopeFrameBinding({
  sourceExtraction,
  sourceExtractionFileSha256,
  skeletonGltf,
  skeletonFileSha256,
  envelopeFileSha256,
  skeletonEnvelopeFrameLink,
  skeletonEnvelopeFrameLinkFileSha256,
  parentAtlas,
  parentAtlasFileSha256,
  requestedConstructionIds,
  baselineCondition,
  baselineFileSha256,
  anchorName = 'SRC_PELVIS',
}) {
  for (const [value, label] of [
    [sourceExtractionFileSha256, 'sourceExtractionFileSha256'],
    [skeletonFileSha256, 'skeletonFileSha256'],
    [envelopeFileSha256, 'envelopeFileSha256'],
    [skeletonEnvelopeFrameLinkFileSha256, 'skeletonEnvelopeFrameLinkFileSha256'],
    [parentAtlasFileSha256, 'parentAtlasFileSha256'],
    [baselineFileSha256, 'baselineFileSha256'],
  ]) requireSha256(value, label);
  if (!Array.isArray(requestedConstructionIds) || requestedConstructionIds.length === 0
    || new Set(requestedConstructionIds).size !== requestedConstructionIds.length) {
    throw new Error('k4-envelope-frame-binding: requestedConstructionIds must be unique and nonempty');
  }
  if (parentAtlas?.source?.assetSha256 !== sourceExtraction?.source?.sha256) {
    throw new Error('k4-envelope-frame-binding: source extraction and parent atlas asset identity differ');
  }
  const sourceAnchors = (sourceExtraction?.objects ?? []).filter(object => object.name === anchorName);
  const targetAnchors = (skeletonGltf?.nodes ?? []).filter(node => node.name === anchorName);
  if (sourceAnchors.length !== 1 || targetAnchors.length !== 1) {
    throw new Error(`k4-envelope-frame-binding: expected exactly one ${anchorName} anchor in each input`);
  }
  const sourceAnchorMatrix = finiteMatrix4(sourceAnchors[0].matrixWorld, 'source anchor matrix');
  const targetAnchorMatrix = gltfNodeMatrix(targetAnchors[0]);
  const sourceToSkeletonMatrix = multiply4(targetAnchorMatrix, invertAffine4(sourceAnchorMatrix, 'source anchor matrix'));
  const sourceToSkeleton = decomposePositiveSimilarity(sourceToSkeletonMatrix);

  const link = skeletonEnvelopeFrameLink?.link;
  if (skeletonEnvelopeFrameLink?.schema !== 'kaminos.frame-link-receipt.v0'
    || skeletonEnvelopeFrameLink.status !== 'completed'
    || link?.scaleLocked !== true) {
    throw new Error('k4-envelope-frame-binding: skeleton-envelope frame link is not completed and scale-locked');
  }
  if (skeletonEnvelopeFrameLink.inputs?.sourceSha256 !== skeletonFileSha256
    || skeletonEnvelopeFrameLink.inputs?.envelopeSha256 !== envelopeFileSha256) {
    throw new Error('k4-envelope-frame-binding: skeleton-envelope frame-link input identity differs');
  }
  const skeletonToEnvelope = {
    scale: 1,
    rotation: link.transform?.rotation,
    translation: link.transform?.translation,
  };
  if (!Array.isArray(skeletonToEnvelope.rotation) || !Array.isArray(skeletonToEnvelope.translation)) {
    throw new Error('k4-envelope-frame-binding: skeleton-envelope transform is missing');
  }
  const k4 = compareK4SourceWorld(parentAtlas, requestedConstructionIds, baselineCondition);
  const sourceToEnvelope = composeSimilarity(skeletonToEnvelope, sourceToSkeleton);
  const sourceNames = new Set((sourceExtraction.objects ?? []).map(object => object.name));
  const untrustedNameCollisions = [...new Set((skeletonGltf.nodes ?? [])
    .map(node => node.name)
    .filter(name => name && name !== anchorName && sourceNames.has(name)))].sort();

  const receipt = {
    schema: K4_ENVELOPE_FRAME_BINDING_SCHEMA,
    status: 'completed-provisional',
    requestedConstructionIds: [...requestedConstructionIds],
    effectiveConstructionIds: k4.effectiveConstructionIds,
    inputs: {
      sourceExtractionFileSha256,
      sourceAsset: {
        requestedPath: sourceExtraction.source.requestedPath,
        effectivePath: sourceExtraction.source.effectivePath,
        sha256: sourceExtraction.source.sha256,
      },
      parentAtlas: {
        id: parentAtlas.id,
        atlasSha256: parentAtlas.atlasSha256,
        fileSha256: parentAtlasFileSha256,
      },
      baseline: { id: baselineCondition.id, fileSha256: baselineFileSha256 },
      skeletonFileSha256,
      envelopeFileSha256,
      skeletonEnvelopeFrameLinkFileSha256,
    },
    k4SourceWorldBinding: {
      method: 'ordered-full-sample-audit-with-exact-source-position-gate',
      maximumPositionDelta: k4.maximumPositionDelta,
      maximumRadiusDelta: k4.maximumRadiusDelta,
      fullSampleIdentity: k4.fullSampleIdentity,
      comparedLoadBearingFields: ['position', 'radius'],
      sourcePositionAuthority: 'byte-identical-measured-candidate',
      radiusAuthority: k4.maximumRadiusDelta === 0
        ? 'byte-identical-measured-candidate'
        : 'baseline-derived-candidate',
      coordinateFrame: 'source-blend-world',
      authority: k4.fullSampleIdentity
        ? 'byte-identical-measured-candidate'
        : 'mixed-source-position-and-baseline-derived-sample-candidate',
    },
    sourceToSkeleton: {
      method: 'unique-semantic-object-frame-relation',
      anchor: {
        name: anchorName,
        sourceLocator: `sourceExtraction.objects[name=${anchorName}].matrixWorld`,
        targetLocator: `skeletonGltf.nodes[name=${anchorName}].TRS`,
      },
      transform: {
        scale: sourceToSkeleton.scale,
        rotation: sourceToSkeleton.rotation,
        translation: sourceToSkeleton.translation,
      },
      residual: {
        maximumMatrixResidual: sourceToSkeleton.maximumMatrixResidual,
        maximumOrthonormalResidual: sourceToSkeleton.maximumOrthonormalResidual,
      },
      authority: 'measured-candidate',
      untrustedNameCollisions: untrustedNameCollisions.map(name => ({
        name,
        disposition: 'excluded-from-frame-fit',
        reason: 'generic name coincidence is not source-object correspondence authority',
      })),
    },
    skeletonToEnvelope: {
      method: 'content-bound-consumed-frame-link',
      transform: skeletonToEnvelope,
      fit: {
        converged: link.converged,
        iterations: link.iterations,
        after: link.after,
      },
      authority: 'fit-derived-provisional',
    },
    sourceToEnvelope: {
      method: 'skeleton-to-envelope-after-source-to-skeleton',
      transform: sourceToEnvelope,
      authority: 'fit-derived-provisional',
    },
    claimCeiling: 'metric-mechanism-only',
    heldClaims: [
      'operator-authored-frame-binding',
      'anatomical-registration',
      'production-admission',
      'source-authorized-envelope-fit',
    ],
  };
  receipt.receiptSha256 = sha256(canonicalJson(receipt));
  return receipt;
}
