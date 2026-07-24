import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const COMPONENTS = new Map([
  [5120, { bytes: 1, read: 'getInt8' }],
  [5121, { bytes: 1, read: 'getUint8' }],
  [5122, { bytes: 2, read: 'getInt16' }],
  [5123, { bytes: 2, read: 'getUint16' }],
  [5125, { bytes: 4, read: 'getUint32' }],
  [5126, { bytes: 4, read: 'getFloat32' }],
]);
const TYPE_COUNTS = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT4', 16],
]);
const PATCH_SPECS = Object.freeze([
  Object.freeze({ id: 'front-left', axialRegion: 'front', side: 'left', axialCenterT: 0.75, sideSign: 1, phaseOffset: 0 }),
  Object.freeze({ id: 'front-right', axialRegion: 'front', side: 'right', axialCenterT: 0.75, sideSign: -1, phaseOffset: 0.5 }),
  Object.freeze({ id: 'rear-left', axialRegion: 'rear', side: 'left', axialCenterT: 0.25, sideSign: 1, phaseOffset: 0.5 }),
  Object.freeze({ id: 'rear-right', axialRegion: 'rear', side: 'right', axialCenterT: 0.25, sideSign: -1, phaseOffset: 0 }),
]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (left, right, amount) => left * (1 - amount) + right * amount;

function identity4() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply4(left, right) {
  const output = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let item = 0; item < 4; item += 1) {
        output[column * 4 + row] += left[item * 4 + row] * right[column * 4 + item];
      }
    }
  }
  return output;
}

function trsMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.map(Number);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
    (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
    (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error('support-atlas source is not a GLB v2 file');
  }
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('support-atlas GLB length mismatch');
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new Error('support-atlas GLB contains a truncated chunk');
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8').replace(/\0+\s*$/, ''));
    if (type === 0x004e4942) binary = data;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('support-atlas GLB requires JSON and BIN chunks');
  return { json, binary };
}

function readAccessor(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.sparse) throw new Error(`unsupported or missing GLB accessor ${accessorIndex}`);
  const view = gltf.bufferViews?.[accessor.bufferView];
  const component = COMPONENTS.get(accessor.componentType);
  const itemCount = TYPE_COUNTS.get(accessor.type);
  if (!view || !component || !itemCount) throw new Error(`unsupported GLB accessor layout ${accessorIndex}`);
  const stride = view.byteStride ?? component.bytes * itemCount;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dataView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const output = new Float64Array(accessor.count * itemCount);
  for (let row = 0; row < accessor.count; row += 1) {
    for (let item = 0; item < itemCount; item += 1) {
      output[row * itemCount + item] = dataView[component.read](
        start + row * stride + item * component.bytes,
        true,
      );
    }
  }
  return { values: output, count: accessor.count, itemCount };
}

function transformPackedPositions(positions, matrix) {
  const output = new Float64Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    output[offset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    output[offset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    output[offset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  return output;
}

function packedBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis]);
      max[axis] = Math.max(max[axis], positions[offset + axis]);
    }
  }
  return { min, max };
}

export async function loadGlbPositionMesh(path) {
  const bytes = await readFile(path);
  const { json, binary } = parseGlb(bytes);
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? [];
  const chunks = [];
  let triangleCount = 0;
  const visit = (nodeIndex, parentMatrix) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`missing GLB node ${nodeIndex}`);
    const world = multiply4(parentMatrix, trsMatrix(node));
    if (Number.isInteger(node.mesh)) {
      const mesh = json.meshes?.[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4 || !Number.isInteger(primitive.attributes?.POSITION)) continue;
        const accessor = readAccessor(json, binary, primitive.attributes.POSITION);
        if (accessor.itemCount !== 3) throw new Error('support-atlas GLB POSITION accessor must be VEC3');
        chunks.push(transformPackedPositions(accessor.values, world));
        if (Number.isInteger(primitive.indices)) {
          const indices = readAccessor(json, binary, primitive.indices);
          triangleCount += Math.floor(indices.count / 3);
        } else {
          triangleCount += Math.floor(accessor.count / 3);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, identity4());
  if (chunks.length === 0) throw new Error('support-atlas GLB produced no triangle geometry');
  const positionCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const positions = new Float64Array(positionCount);
  let cursor = 0;
  for (const chunk of chunks) {
    positions.set(chunk, cursor);
    cursor += chunk.length;
  }
  return {
    positions,
    vertexCount: positions.length / 3,
    triangleCount,
    bounds: packedBounds(positions),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    bytes: bytes.length,
    primitiveCount: chunks.length,
  };
}

function registrationFrame(registration) {
  const bounds = registration?.bounds;
  if (!Array.isArray(bounds?.min) || bounds.min.length !== 3
    || !Array.isArray(bounds?.max) || bounds.max.length !== 3) {
    throw new Error('crawler registration requires finite three-axis bounds');
  }
  const min = bounds.min.map(Number);
  const max = bounds.max.map(Number);
  if (![...min, ...max].every(Number.isFinite)) throw new Error('crawler registration bounds must be finite');
  const headZ = Number(registration.headAnchor?.[2]);
  const tailZ = Number(registration.tailAnchor?.[2]);
  if (!Number.isFinite(headZ) || !Number.isFinite(tailZ) || Math.abs(tailZ - headZ) < 1e-5) {
    throw new Error('crawler registration requires distinct head and tail anchors');
  }
  return {
    bounds: { min, max },
    headZ,
    tailZ,
    axialSpan: Math.abs(tailZ - headZ),
  };
}

function quantile(values, fraction) {
  if (!values.length) throw new Error('contact atlas candidate set is empty');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * clamp(fraction, 0, 1))];
}

function weightedPosition(positions, indices, weights) {
  const result = [0, 0, 0];
  for (let index = 0; index < indices.length; index += 1) {
    const offset = indices[index] * 3;
    const weight = weights[index];
    result[0] += positions[offset] * weight;
    result[1] += positions[offset + 1] * weight;
    result[2] += positions[offset + 2] * weight;
  }
  return result;
}

export function deriveCrawlerContactAtlas(originalPositions, registrationInput, sourceIdentity = {}, options = {}) {
  if (!ArrayBuffer.isView(originalPositions) || originalPositions.length % 3 !== 0) {
    throw new Error('contact atlas derivation requires a packed position buffer');
  }
  const registration = registrationFrame(registrationInput);
  const vertexCount = originalPositions.length / 3;
  const halfWidth = Math.max(
    Math.abs(registration.bounds.min[0]),
    Math.abs(registration.bounds.max[0]),
  );
  const axialWindow = Math.max(0.08, Number(options.axialWindow) || registration.axialSpan * 0.16);
  const innerSide = Math.max(0.01, Number(options.innerSide) || halfWidth * 0.19);
  const lowQuantile = clamp(Number(options.lowQuantile) || 0.015, 0.002, 0.08);
  const influenceRadii = [
    Math.max(0.02, Number(options.influenceRadiusX) || halfWidth * 0.47),
    Math.max(0.03, Number(options.influenceRadiusY) || 0.11),
    Math.max(0.03, Number(options.influenceRadiusZ) || registration.axialSpan * 0.12),
  ];
  const axialCenters = {
    front: clamp(Number(options.frontAxialCenterT) || 0.75, 0.5, 0.9),
    rear: clamp(Number(options.rearAxialCenterT) || 0.25, 0.1, 0.5),
  };
  const patches = PATCH_SPECS.map(spec => {
    const axialCenterT = axialCenters[spec.axialRegion];
    const centerZ = mix(registration.tailZ, registration.headZ, axialCenterT);
    const candidates = [];
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const x = originalPositions[offset];
      const z = originalPositions[offset + 2];
      if (spec.sideSign * x < innerSide || Math.abs(z - centerZ) > axialWindow) continue;
      candidates.push(vertex);
    }
    const thresholdY = quantile(
      candidates.map(vertex => originalPositions[vertex * 3 + 1]),
      lowQuantile,
    );
    const vertexIndices = candidates.filter(vertex => originalPositions[vertex * 3 + 1] <= thresholdY);
    if (vertexIndices.length < 32) throw new Error(`${spec.id} contact patch has insufficient geometry`);
    const weights = new Array(vertexIndices.length).fill(1 / vertexIndices.length);
    const restCentroid = weightedPosition(originalPositions, vertexIndices, weights);
    const influenceVertexIndices = [];
    const influenceWeights = [];
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const dx = (originalPositions[offset] - restCentroid[0]) / influenceRadii[0];
      const dy = (originalPositions[offset + 1] - restCentroid[1]) / influenceRadii[1];
      const dz = (originalPositions[offset + 2] - restCentroid[2]) / influenceRadii[2];
      const radiusSquared = dx * dx + dy * dy + dz * dz;
      if (radiusSquared >= 1) continue;
      influenceVertexIndices.push(vertex);
      influenceWeights.push((1 - radiusSquared) ** 2);
    }
    if (influenceVertexIndices.length < vertexIndices.length) {
      throw new Error(`${spec.id} contact influence failed to contain its contact patch`);
    }
    return {
      id: spec.id,
      axialRegion: spec.axialRegion,
      side: spec.side,
      phaseOffset: spec.phaseOffset,
      restCentroid,
      vertexIndices,
      weights,
      influenceVertexIndices,
      influenceWeights,
      derivation: {
        axialCenterT,
        axialWindow,
        innerSide,
        lowQuantile,
        thresholdY,
        influenceRadii,
      },
    };
  });
  return {
    schema: 'kaminos.creature-contact-atlas.v0',
    version: 0,
    castId: String(sourceIdentity.castId || ''),
    castHash: String(sourceIdentity.castHash || ''),
    registrationHash: String(sourceIdentity.registrationHash || ''),
    motionClass: 'elongated-crawler',
    authority: 'exact-cast-consumer-derived-contact-v0',
    vertexCount,
    patches,
  };
}

function requireIdentity(atlas, expected) {
  if (atlas?.schema !== 'kaminos.creature-contact-atlas.v0') {
    throw new Error('contact atlas schema mismatch');
  }
  if (expected.castId && atlas.castId !== expected.castId) throw new Error('contact atlas cast id mismatch');
  if (expected.castHash && atlas.castHash !== expected.castHash) throw new Error('contact atlas cast hash mismatch');
  if (expected.registrationHash && atlas.registrationHash !== expected.registrationHash) {
    throw new Error('contact atlas registration hash mismatch');
  }
}

function addReason(reasons, severity, code, message, details = {}) {
  reasons.push({ severity, code, message, ...details });
}

export function assessCrawlerContactAtlas({
  atlas,
  positions,
  registration: registrationInput,
  expectedIdentity = {},
  rigidCoreWeight = 0.5,
}) {
  requireIdentity(atlas, expectedIdentity);
  if (!ArrayBuffer.isView(positions) || positions.length % 3 !== 0) {
    throw new Error('contact atlas assessment requires a packed position buffer');
  }
  const registration = registrationFrame(registrationInput);
  const vertexCount = positions.length / 3;
  if (atlas.vertexCount !== vertexCount) throw new Error('contact atlas vertex count mismatch');
  if (!Array.isArray(atlas.patches) || atlas.patches.length !== PATCH_SPECS.length) {
    throw new Error('contact atlas requires exactly four crawler patches');
  }

  const rejectionReasons = [];
  const coreOwners = new Map();
  const patchDiagnostics = atlas.patches.map((patch, patchIndex) => {
    const spec = PATCH_SPECS[patchIndex];
    if (patch.id !== spec.id || patch.axialRegion !== spec.axialRegion || patch.side !== spec.side) {
      addReason(rejectionReasons, 'reject', 'patch-identity-order', `patch ${patchIndex} identity/order mismatch`);
    }
    const contactIndices = Array.from(patch.vertexIndices ?? []);
    const contactWeights = Array.from(patch.weights ?? []);
    const influenceIndices = Array.from(patch.influenceVertexIndices ?? []);
    const influenceWeights = Array.from(patch.influenceWeights ?? []);
    if (contactIndices.length < 32) {
      addReason(rejectionReasons, 'reject', 'insufficient-contact-geometry', `${patch.id} has fewer than 32 contact vertices`);
    }
    const contactWeightSum = contactWeights.reduce(
      (sum, weight) => sum + (typeof weight === 'number' && Number.isFinite(weight) ? weight : 0),
      0,
    );
    const validContactWeights = contactWeights.length === contactIndices.length
      && contactWeights.every(weight => (
        typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1
      ))
      && Math.abs(contactWeightSum - 1) <= 1e-6;
    if (!validContactWeights) {
      addReason(rejectionReasons, 'reject', 'invalid-contact-weights', `${patch.id} contact weights are incomplete or invalid`);
    }
    if (influenceIndices.length !== influenceWeights.length || influenceIndices.length < contactIndices.length) {
      addReason(rejectionReasons, 'reject', 'invalid-influence-membership', `${patch.id} influence membership is incomplete`);
    }
    const validInfluenceWeights = influenceIndices.length === influenceWeights.length
      && influenceWeights.every(weight => (
        typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1
      ));
    if (!validInfluenceWeights) {
      addReason(rejectionReasons, 'reject', 'invalid-influence-weights', `${patch.id} influence weights are incomplete or invalid`);
    }
    const invalidIndex = [...contactIndices, ...influenceIndices]
      .find(index => !Number.isInteger(index) || index < 0 || index >= vertexCount);
    if (invalidIndex !== undefined) {
      addReason(rejectionReasons, 'reject', 'vertex-index-out-of-bounds', `${patch.id} contains vertex ${invalidIndex}`);
    }
    const safeContactIndices = contactIndices.filter(
      index => Number.isInteger(index) && index >= 0 && index < vertexCount,
    );
    const centroid = weightedPosition(
      positions,
      safeContactIndices,
      new Array(safeContactIndices.length).fill(safeContactIndices.length ? 1 / safeContactIndices.length : 0),
    );
    const expectedSide = spec.sideSign * centroid[0];
    if (!(expectedSide > 0)) {
      addReason(rejectionReasons, 'reject', 'side-separation-failed', `${patch.id} centroid crossed the body midline`);
    }
    const derivation = patch.derivation;
    const validDerivation = derivation
      && typeof derivation === 'object'
      && typeof derivation.axialCenterT === 'number'
      && Number.isFinite(derivation.axialCenterT)
      && derivation.axialCenterT >= 0
      && derivation.axialCenterT <= 1
      && typeof derivation.axialWindow === 'number'
      && Number.isFinite(derivation.axialWindow)
      && derivation.axialWindow > 0
      && typeof derivation.innerSide === 'number'
      && Number.isFinite(derivation.innerSide)
      && derivation.innerSide >= 0
      && typeof derivation.lowQuantile === 'number'
      && Number.isFinite(derivation.lowQuantile)
      && derivation.lowQuantile >= 0
      && derivation.lowQuantile <= 1
      && typeof derivation.thresholdY === 'number'
      && Number.isFinite(derivation.thresholdY)
      && Array.isArray(derivation.influenceRadii)
      && derivation.influenceRadii.length === 3
      && derivation.influenceRadii.every(radius => (
        typeof radius === 'number' && Number.isFinite(radius) && radius > 0
      ));
    if (!validDerivation) {
      addReason(rejectionReasons, 'reject', 'invalid-carrier-derivation', `${patch.id} carrier derivation is incomplete or invalid`);
    }
    const axialCenterT = validDerivation ? derivation.axialCenterT : spec.axialCenterT;
    const axialWindow = validDerivation ? derivation.axialWindow : registration.axialSpan * 0.16;
    const centerZ = mix(
      registration.tailZ,
      registration.headZ,
      axialCenterT,
    );
    if (Math.abs(centroid[2] - centerZ) > axialWindow * 1.1) {
      addReason(rejectionReasons, 'reject', 'axial-separation-failed', `${patch.id} centroid escaped its axial window`);
    }
    const axialCenterError = Math.abs(centroid[2] - centerZ) / registration.axialSpan;
    if (axialCenterError > 0.08) {
      addReason(
        rejectionReasons,
        'needs-edit',
        'contact-near-axial-window-edge',
        `${patch.id} support cluster sits near the edge of its authored axial window`,
        { normalizedAxialCenterError: axialCenterError },
      );
    }
    const bottomOffset = centroid[1] - registration.bounds.min[1];
    const height = registration.bounds.max[1] - registration.bounds.min[1];
    if (bottomOffset > height * 0.08) {
      addReason(
        rejectionReasons,
        'needs-edit',
        'contact-too-high',
        `${patch.id} centroid is too high above the cast floor`,
        { normalizedBottomOffset: bottomOffset / height },
      );
    }
    let coreVertexCount = 0;
    for (let index = 0; index < influenceIndices.length; index += 1) {
      const vertex = influenceIndices[index];
      const weight = influenceWeights[index];
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) continue;
      if (typeof weight !== 'number' || !Number.isFinite(weight)) continue;
      if (weight < rigidCoreWeight) continue;
      coreVertexCount += 1;
      const priorOwner = coreOwners.get(vertex);
      if (priorOwner && priorOwner !== patch.id) {
        addReason(
          rejectionReasons,
          'reject',
          'rigid-carrier-core-overlap',
          `rigid carrier core vertex ${vertex} belongs to both ${priorOwner} and ${patch.id}`,
        );
      } else {
        coreOwners.set(vertex, patch.id);
      }
    }
    if (coreVertexCount < 16) {
      addReason(rejectionReasons, 'reject', 'insufficient-rigid-core', `${patch.id} has fewer than 16 rigid-core vertices`);
    }
    return {
      id: patch.id,
      contactVertexCount: contactIndices.length,
      influenceVertexCount: influenceIndices.length,
      rigidCoreVertexCount: coreVertexCount,
      restCentroid: centroid,
      normalizedBottomOffset: bottomOffset / height,
      axialCenterError,
      sideOffset: Math.abs(centroid[0]),
    };
  });

  const uniqueReasons = [...new Map(
    rejectionReasons.map(reason => [`${reason.code}:${reason.message}`, reason]),
  ).values()];
  const classification = uniqueReasons.some(reason => reason.severity === 'reject')
    ? 'reject'
    : uniqueReasons.some(reason => reason.severity === 'needs-edit')
      ? 'needs-edit'
      : 'admit';
  return {
    schema: 'kaminos.support-atlas-admission-assessment.v0',
    classification,
    rejectionReasons: uniqueReasons,
    patchDiagnostics,
    rigidCoreWeight,
    authoredInformation: {
      bodyFrame: {
        localForwardAxis: registrationInput.localForwardAxis,
        localRightAxis: registrationInput.localRightAxis,
        localUpAxis: registrationInput.localUpAxis,
        headAnchor: registrationInput.headAnchor,
        tailAnchor: registrationInput.tailAnchor,
      },
      supportRoles: PATCH_SPECS.map(({ id, axialRegion, side }) => ({ id, axialRegion, side })),
    },
  };
}
