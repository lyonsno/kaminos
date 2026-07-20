import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MOTION_READY_719024_DEFORMATION_MODE,
  createAxialGeometryBinding,
  createAxialSquirmState,
  deformAxialGeometryBinding,
  deformAxialPoint,
  validateAxialCrawlerRegistration,
} from '../motion-ready-719024-core.js';

function readGlbPositionAccessor(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'fixture must be a glTF binary');
  let offset = 12;
  let gltf;
  let binary;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) gltf = JSON.parse(payload.toString('utf8').trim());
    if (type === 0x004e4942) binary = payload;
    offset += 8 + length;
  }
  const accessor = gltf?.accessors?.[gltf?.meshes?.[0]?.primitives?.[0]?.attributes?.POSITION];
  const view = gltf?.bufferViews?.[accessor?.bufferView];
  assert.equal(accessor?.componentType, 5126, 'fixture positions must be float32');
  assert.equal(accessor?.type, 'VEC3', 'fixture positions must be packed vec3 values');
  assert.ok(binary && view, 'fixture must expose one readable binary position accessor');
  const stride = view.byteStride || 12;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    const source = start + vertex * stride;
    positions[vertex * 3] = binary.readFloatLE(source);
    positions[vertex * 3 + 1] = binary.readFloatLE(source + 4);
    positions[vertex * 3 + 2] = binary.readFloatLE(source + 8);
  }
  return positions;
}

const root = new URL('../', import.meta.url);
const registration = validateAxialCrawlerRegistration(JSON.parse(
  await readFile(new URL('artifacts/motion-ready-719024/registration.json', root), 'utf8'),
));
const zeroState = createAxialSquirmState();

assert.equal(
  MOTION_READY_719024_DEFORMATION_MODE,
  'axial-parallel-transport-wave-v1',
  'the exposed deformer identity must name the corrected v1 contract',
);

const zeroStatePoints = [
  [0.12, -0.08, registration.tailZ],
  [-0.07, 0.11, 0.08],
  [0.03, -0.02, registration.headZ],
  [0.04, 0.05, registration.tailZ + 0.025],
  [-0.06, -0.03, registration.headZ - 0.02],
];
for (const point of zeroStatePoints) {
  const output = deformAxialPoint(point, registration, zeroState);
  assert.ok(
    Math.hypot(output[0] - point[0], output[1] - point[1], output[2] - point[2]) < 1e-7,
    `zero-wave scalar deformation must preserve source point ${point.join(',')}`,
  );
}

const signedRightPoint = [0.1, 0, 0];
const signedRightOutput = deformAxialPoint(signedRightPoint, registration, zeroState);
assert.ok(signedRightOutput[0] > 0, 'tangentHeadward cross upReference must preserve positive source X');

const originalPositions = new Float32Array(zeroStatePoints.flat());
const originalNormals = new Float32Array([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
  0, 0, -1,
  -1, 0, 0,
]);
const outputPositions = new Float32Array(originalPositions.length);
const outputNormals = new Float32Array(originalNormals.length);
const binding = createAxialGeometryBinding(originalPositions, originalNormals, registration, { segments: 96 });
assert.ok(
  binding.axialResiduals instanceof Float32Array,
  'binding must preserve one shader-portable signed axial residual per vertex',
);
assert.ok(binding.axialResiduals[3] < 0, 'tail cap residual must preserve its negative sign');
assert.ok(binding.axialResiduals[4] > 0, 'head cap residual must preserve its positive sign');

deformAxialGeometryBinding(binding, zeroState, outputPositions, outputNormals);
for (let index = 0; index < originalPositions.length; index++) {
  assert.ok(
    Math.abs(outputPositions[index] - originalPositions[index]) < 2e-7,
    `zero-wave batch deformation must preserve packed source component ${index}`,
  );
  assert.ok(
    Math.abs(outputNormals[index] - originalNormals[index]) < 2e-7,
    `zero-wave batch deformation must preserve packed source normal component ${index}`,
  );
}

const activeState = createAxialSquirmState({ amplitude: 0.07, verticalAmplitude: 0.015, phase: 1.2 });
const tailCap = zeroStatePoints[3];
const headCap = zeroStatePoints[4];
for (const [label, capPoint, endpointZ] of [
  ['tail', tailCap, registration.tailZ],
  ['head', headCap, registration.headZ],
]) {
  const cap = deformAxialPoint(capPoint, registration, activeState);
  const endpoint = deformAxialPoint([capPoint[0], capPoint[1], endpointZ], registration, activeState);
  assert.ok(
    Math.hypot(cap[0] - endpoint[0], cap[1] - endpoint[1], cap[2] - endpoint[2]) > 0.015,
    `${label} cap must retain its nonzero signed axial distance from the endpoint plane`,
  );
}

const exactPositions = readGlbPositionAccessor(await readFile(
  new URL('artifacts/motion-ready-719024/creature.glb', root),
));
const exactNormals = new Float32Array(exactPositions.length);
const exactBinding = createAxialGeometryBinding(exactPositions, exactNormals, registration, { segments: 128 });
const capVertexCount = exactBinding.axialResiduals.reduce(
  (count, residual) => count + (Math.abs(residual) > 1e-7 ? 1 : 0),
  0,
);
assert.equal(capVertexCount, 1984, 'exact cast must retain all 1,984 vertices outside the station span');

const exactZeroOutput = new Float32Array(exactPositions.length);
const exactZeroNormals = new Float32Array(exactNormals.length);
deformAxialGeometryBinding(exactBinding, zeroState, exactZeroOutput, exactZeroNormals);
let maxZeroStateError = 0;
for (let index = 0; index < exactPositions.length; index++) {
  maxZeroStateError = Math.max(maxZeroStateError, Math.abs(exactZeroOutput[index] - exactPositions[index]));
}
assert.ok(
  maxZeroStateError < 2e-6,
  `exact cast zero-wave deformation must preserve all positions; max error ${maxZeroStateError}`,
);

console.log('motion-ready-719024 deformation v1 contracts passed');
