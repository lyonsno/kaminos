import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function pad4(buffer, padByte) {
  const pad = (4 - (buffer.length % 4)) % 4;
  if (!pad) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(pad, padByte)]);
}

function writeFixtureGlb(path) {
  const doc = {
    asset: { version: '2.0', generator: 'kaminos-generated-asset-lod-test' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, name: 'Fixture module' }],
    meshes: [{
      name: 'fixture-mesh',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
        mode: 4,
      }],
    }],
    accessors: [
      { componentType: 5126, count: 8, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { componentType: 5126, count: 8, type: 'VEC3' },
      { componentType: 5126, count: 8, type: 'VEC2' },
      { componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    materials: [{
      name: 'fixture-pbr',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 1 },
        metallicFactor: 1,
        roughnessFactor: 1,
      },
    }],
    textures: [{ source: 0 }, { source: 1 }],
    images: [
      { name: 'base-color', uri: 'base-color.png' },
      { name: 'metallic-roughness', uri: 'metallic-roughness.png' },
    ],
  };

  const json = pad4(Buffer.from(JSON.stringify(doc)), 0x20);
  const total = 12 + 8 + json.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  writeFileSync(path, Buffer.concat([header, jsonHeader, json]));
}

const root = mkdtempSync(join(tmpdir(), 'kaminos-generated-asset-lod-contract-'));
const input = join(root, 'fixture.glb');
const outDir = join(root, 'lod');
mkdirSync(outDir, { recursive: true });
writeFixtureGlb(input);

const result = spawnSync('python3', [
  resolve('tools/generated-asset-lod.py'),
  '--input', input,
  '--out-dir', outDir,
  '--name', 'fixture-module',
  '--lod-faces', '18,6',
  '--assay-only',
], {
  cwd: resolve('.'),
  encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const manifest = JSON.parse(readFileSync(join(outDir, 'generated-asset-lod-manifest.json'), 'utf8'));
const assay = JSON.parse(readFileSync(join(outDir, 'generated-asset-assay.json'), 'utf8'));

assert.equal(manifest.schema, 'kaminos.generated-asset-lod.v1', 'manifest names the reduction contract');
assert.equal(manifest.source.path, realpathSync(input), 'manifest preserves resolved source GLB path');
assert.equal(manifest.assay.path, realpathSync(join(outDir, 'generated-asset-assay.json')), 'manifest points at assay truth');
assert.deepEqual(manifest.requestedLodFaces, [18, 6], 'manifest preserves caller LOD targets');
assert.equal(manifest.reduction.defaultBackend, 'gltf-transform', 'default backend preserves glTF material graph instead of raw mesh export');
assert.equal(manifest.reduction.materialPolicy, 'preserve-source-pbr-textures', 'manifest names source-texture preservation policy');
assert.equal(manifest.reduction.textureResize.status, 'disabled', 'assay-only does not pretend texture resize ran');
assert.equal(manifest.lods[0].level, 0, 'LOD0 is present');
assert.equal(manifest.lods[0].status, 'source', 'LOD0 is source truth, not regenerated');
assert.equal(manifest.lods[1].status, 'pending', 'assay-only LOD1 is pending, not falsely emitted');
assert.equal(manifest.lods[1].reason, 'assay-only', 'pending LOD carries reason');
assert.equal(manifest.bakeProducts.normal.status, 'pending', 'normal map bake is not silently claimed');
assert.equal(manifest.bakeProducts.ambientOcclusion.status, 'pending', 'AO bake is not silently claimed');
assert.equal(manifest.bakeProducts.height.status, 'deferred', 'height/parallax is explicitly deferred');
assert.equal(manifest.bakeProducts.emissiveMask.status, 'pending', 'emissive mask is explicitly pending');

assert.equal(assay.schema, 'kaminos.generated-asset-assay.v1', 'assay names its schema');
assert.equal(assay.mesh.primitiveCount, 1, 'assay sees one primitive');
assert.equal(assay.mesh.vertexCount, 8, 'assay reads vertex count from POSITION accessor');
assert.equal(assay.mesh.triangleCount, 12, 'assay reads triangle count from index accessor');
assert.equal(assay.geometry.hasVertexNormals, true, 'assay records vertex normals');
assert.equal(assay.geometry.hasTangents, false, 'assay does not invent tangents');
assert.equal(assay.geometry.hasUv0, true, 'assay records UV0');
assert.equal(assay.materials.hasBaseColorTexture, true, 'assay records base color texture');
assert.equal(assay.materials.hasMetallicRoughnessTexture, true, 'assay records MR texture');
assert.equal(assay.materials.hasNormalTexture, false, 'assay records missing normal map');
assert.equal(assay.materials.hasOcclusionTexture, false, 'assay records missing AO/occlusion map');
assert.equal(assay.materials.hasEmissiveTexture, false, 'assay records missing emissive map');
assert.equal(assay.truthWarnings.includes('no-tangent-space-normal-map'), true, 'assay warns on missing normal map');
assert.equal(assay.truthWarnings.includes('no-occlusion-map'), true, 'assay warns on missing occlusion map');
