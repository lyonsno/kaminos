import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const assetDir = join(root, 'artifacts/sinter-forked-timber-trestle-v0-2026-07-18');
const descriptorPath = join(assetDir, 'structuralMeshAssetDescriptor.json');

assert.ok(existsSync(descriptorPath), 'Sinter trestle descriptor must exist');

const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readGlb(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF', `${path} must be binary glTF`);
  assert.equal(bytes.readUInt32LE(4), 2, `${path} must use glTF 2.0`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${path} GLB length header must match file length`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('utf8', 16, 20), 'JSON', `${path} first GLB chunk must be JSON`);
  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  const json = JSON.parse(bytes.toString('utf8', jsonStart, jsonEnd).trim());
  const binLength = bytes.readUInt32LE(jsonEnd);
  assert.equal(bytes.toString('utf8', jsonEnd + 4, jsonEnd + 8), 'BIN\0', `${path} second GLB chunk must be BIN`);
  const bin = bytes.subarray(jsonEnd + 8, jsonEnd + 8 + binLength);
  return { json, bin };
}

function accessorArray(glb, accessorIndex) {
  const accessor = glb.json.accessors[accessorIndex];
  const view = glb.json.bufferViews[accessor.bufferView];
  assert.equal(view.buffer, 0, 'every bufferView must point at the single embedded GLB buffer');
  const componentBytes = accessor.componentType === 5126 ? 4 : accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : null;
  assert.ok(componentBytes, `unsupported accessor component type ${accessor.componentType}`);
  const componentCount = accessor.type === 'SCALAR' ? 1 : accessor.type === 'VEC3' ? 3 : null;
  assert.ok(componentCount, `unsupported accessor type ${accessor.type}`);
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count * componentCount;
  if (accessor.componentType === 5126) {
    const values = new Float32Array(glb.bin.buffer, glb.bin.byteOffset + byteOffset, count);
    return Array.from(values);
  }
  if (accessor.componentType === 5125) {
    const values = new Uint32Array(glb.bin.buffer, glb.bin.byteOffset + byteOffset, count);
    return Array.from(values);
  }
  const values = new Uint16Array(glb.bin.buffer, glb.bin.byteOffset + byteOffset, count);
  return Array.from(values);
}

function assertMeshGeometry(glb, expectedNodeNames) {
  const nodeNames = new Set((glb.json.nodes || []).map(node => node.name));
  for (const name of expectedNodeNames) {
    assert.ok(nodeNames.has(name), `GLB must contain named node ${name}`);
  }
  assert.ok(nodeNames.has('support_loss_tenon_0'), 'GLB must expose the authored support-loss seam socket');

  let vertexCount = 0;
  let triangleCount = 0;
  for (const mesh of glb.json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      assert.equal(primitive.mode ?? 4, 4, 'trestle primitives must be triangle lists');
      assert.ok(Number.isInteger(primitive.indices), 'trestle primitives must be indexed');
      assert.ok(Number.isInteger(primitive.attributes.POSITION), 'trestle primitives must provide positions');
      assert.ok(Number.isInteger(primitive.attributes.NORMAL), 'trestle primitives must provide normals');
      const positions = accessorArray(glb, primitive.attributes.POSITION);
      const normals = accessorArray(glb, primitive.attributes.NORMAL);
      const indices = accessorArray(glb, primitive.indices);
      assert.equal(positions.length, normals.length, 'positions and normals must have matching cardinality');
      assert.equal(indices.length % 3, 0, 'indices must form triangles');
      assert.ok(positions.every(Number.isFinite), 'positions must be finite');
      assert.ok(normals.every(Number.isFinite), 'normals must be finite');
      vertexCount += positions.length / 3;
      triangleCount += indices.length / 3;
    }
  }
  assert.ok(vertexCount >= 80, `trestle mesh must be more specific than a box; got ${vertexCount} vertices`);
  assert.ok(triangleCount >= 120, `trestle mesh must have visible authored irregularity; got ${triangleCount} triangles`);
  return { vertexCount, triangleCount };
}

assert.equal(descriptor.schema, 'kaminos.structural-mesh-asset-descriptor.v0');
assert.equal(descriptor.assetId, 'forked-timber-reliquary-trestle-v0');
assert.equal(descriptor.coordinateFrame.handedness, 'right');
assert.equal(descriptor.coordinateFrame.upAxis, '+Y');
assert.equal(descriptor.coordinateFrame.forwardAxis, '+Z');
assert.equal(descriptor.coordinateFrame.unit, 'meter');
assert.equal(descriptor.seam.id, 'support_loss_tenon_0');
assert.deepEqual(descriptor.islands.map(island => island.id), ['reliquary_trestle_body', 'sacrificial_crossbrace']);
assert.equal(descriptor.downgradeState.collision, 'not-claimed');
assert.equal(descriptor.downgradeState.runtimeCutting, 'excluded');

for (const rel of [descriptor.visualRef.path, descriptor.bindingRef.path]) {
  assert.ok(rel.endsWith('.glb'), `${rel} must be a GLB`);
  assert.equal(sha256(join(assetDir, rel)), descriptor.files[rel].sha256, `${rel} hash must match descriptor`);
}

const visual = readGlb(join(assetDir, descriptor.visualRef.path));
const binding = readGlb(join(assetDir, descriptor.bindingRef.path));
const visualCounts = assertMeshGeometry(visual, ['reliquary_trestle_body', 'sacrificial_crossbrace']);
const bindingCounts = assertMeshGeometry(binding, ['reliquary_trestle_body', 'sacrificial_crossbrace']);

assert.equal(visualCounts.vertexCount, descriptor.visualRef.vertexCount);
assert.equal(visualCounts.triangleCount, descriptor.visualRef.triangleCount);
assert.equal(bindingCounts.vertexCount, descriptor.bindingRef.vertexCount);
assert.equal(bindingCounts.triangleCount, descriptor.bindingRef.triangleCount);

for (const axis of ['min', 'max']) {
  assert.equal(descriptor.bounds[axis].length, 3, `bounds.${axis} must be a vec3`);
  assert.ok(descriptor.bounds[axis].every(Number.isFinite), `bounds.${axis} must be finite`);
}
assert.ok(descriptor.bounds.min[0] < -0.2 && descriptor.bounds.max[0] > 0.2, 'trestle must span visible width');
assert.ok(descriptor.bounds.max[1] > 0.6, 'trestle must be a vertical support prop');
assert.ok(descriptor.bounds.max[2] - descriptor.bounds.min[2] > 0.2, 'trestle must have inspectable depth');

console.log('sinter trestle asset contracts: ok');
