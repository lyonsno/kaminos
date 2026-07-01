import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function pad4(buffer, padByte) {
  const pad = (4 - (buffer.length % 4)) % 4;
  if (!pad) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(pad, padByte)]);
}

function readGlbJson(path) {
  const data = readFileSync(path);
  assert.equal(data.readUInt32LE(0), 0x46546c67, 'fixture output is not a GLB');
  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = data.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(chunk.toString('utf8').trim());
    }
  }
  throw new Error(`no JSON chunk in ${path}`);
}

function f32(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function u16(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

const RED_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8AARQAHAAL+EcfTAAAAAElFTkSuQmCC',
  'base64',
);
const WHITE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function writeFixtureGlb(path, { uv0 = true } = {}) {
  const attributes = { POSITION: 0, NORMAL: 1 };
  if (uv0) attributes.TEXCOORD_0 = 2;
  const positionBytes = f32([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const normalBytes = f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvBytes = f32([0, 0, 1, 0, 1, 1, 0, 1]);
  const indexBytes = u16([0, 1, 2, 0, 2, 3]);
  const bufferViews = [];
  const chunks = [];
  let byteOffset = 0;

  function appendView(buffer) {
    const pad = (4 - (byteOffset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteOffset += pad;
    }
    const viewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: buffer.length });
    chunks.push(buffer);
    byteOffset += buffer.length;
    return viewIndex;
  }

  const positionView = appendView(positionBytes);
  const normalView = appendView(normalBytes);
  const uvView = uv0 ? appendView(uvBytes) : null;
  const indexView = appendView(indexBytes);
  const baseColorView = appendView(RED_PIXEL_PNG);
  const metallicRoughnessView = appendView(WHITE_PIXEL_PNG);
  const bin = pad4(Buffer.concat(chunks), 0);

  const doc = {
    asset: { version: '2.0', generator: 'kaminos-generated-asset-bake-test' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, name: 'Fixture module' }],
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    meshes: [{
      name: 'fixture-mesh',
      primitives: [{
        attributes,
        indices: uv0 ? 3 : 2,
        material: 0,
        mode: 4,
      }],
    }],
    accessors: uv0 ? [
      { bufferView: positionView, componentType: 5126, count: 4, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: normalView, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: uvView, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: indexView, componentType: 5123, count: 6, type: 'SCALAR' },
    ] : [
      { bufferView: positionView, componentType: 5126, count: 4, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: normalView, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: indexView, componentType: 5123, count: 6, type: 'SCALAR' },
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
      { name: 'base-color', bufferView: baseColorView, mimeType: 'image/png' },
      { name: 'metallic-roughness', bufferView: metallicRoughnessView, mimeType: 'image/png' },
    ],
  };

  const json = pad4(Buffer.from(JSON.stringify(doc)), 0x20);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jsonHeader, json, binHeader, bin]));
}

function writeMateriallessUvGlb(path) {
  const positionBytes = f32([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const uvBytes = f32([0, 0, 1, 0, 1, 1, 0, 1]);
  const indexBytes = u16([0, 1, 2, 0, 2, 3]);
  const uvOffset = positionBytes.length;
  const indexOffset = uvOffset + uvBytes.length;
  const bin = pad4(Buffer.concat([positionBytes, uvBytes, indexBytes]), 0);
  const doc = {
    asset: { version: '2.0', generator: 'kaminos-generated-asset-bake-materialless-target-test' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
      { buffer: 0, byteOffset: uvOffset, byteLength: uvBytes.length },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 },
        indices: 2,
        mode: 4,
      }],
    }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };

  const json = pad4(Buffer.from(JSON.stringify(doc)), 0x20);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jsonHeader, json, binHeader, bin]));
}

const root = mkdtempSync(join(tmpdir(), 'kaminos-generated-asset-bake-contract-'));
const source = join(root, 'source.glb');
const target = join(root, 'target.glb');
const targetMaterialless = join(root, 'target-materialless.glb');
const targetNoUv = join(root, 'target-no-uv.glb');
const outDir = join(root, 'bake');
const materiallessDir = join(root, 'bake-materialless');
const failDir = join(root, 'bake-fail');
mkdirSync(outDir, { recursive: true });
mkdirSync(materiallessDir, { recursive: true });
mkdirSync(failDir, { recursive: true });
writeFixtureGlb(source, { uv0: true });
writeFixtureGlb(target, { uv0: true });
writeMateriallessUvGlb(targetMaterialless);
writeFixtureGlb(targetNoUv, { uv0: false });

const ok = spawnSync('python3', [
  resolve('tools/generated-asset-bake.py'),
  '--source', source,
  '--target', target,
  '--out-dir', outDir,
  '--name', 'fixture-bake',
  '--assay-only',
], {
  cwd: resolve('.'),
  encoding: 'utf8',
});

assert.equal(ok.status, 0, ok.stderr || ok.stdout);

const manifest = JSON.parse(readFileSync(join(outDir, 'generated-asset-bake-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.generated-asset-bake.v0', 'manifest names the bake contract');
assert.equal(manifest.assetName, 'fixture-bake', 'manifest preserves caller asset name');
assert.equal(manifest.uvPolicy, 'required-existing-uv0', 'V0 requires existing UV0 instead of inventing unwrap work');
assert.equal(manifest.projection.route, 'nearest-source-surface-normal-aware', 'manifest records the effective projection route');
assert.equal(manifest.projection.sourceTriangleCandidates, 12, 'manifest records nearest-surface candidate count');
assert.equal(manifest.projection.normalMinDot, 0.25, 'manifest records normal agreement threshold');
assert.equal(manifest.projection.status, 'pending', 'assay-only does not pretend projection ran');
assert.equal(manifest.padding.status, 'pending', 'assay-only does not pretend padding ran');
assert.equal(manifest.padding.pixels, 12, 'manifest records effective UV island padding');
assert.equal(manifest.padding.mode, 'nearest-covered-atlas-pixel', 'manifest records the padding mode');
assert.equal(manifest.products.baseColor.status, 'pending', 'assay-only does not pretend baseColor was emitted');
assert.equal(manifest.products.metallicRoughness.status, 'pending', 'assay-only does not pretend MR was emitted');
assert.equal(manifest.products.normal.status, 'not-implemented', 'normal bake is not claimed');
assert.equal(manifest.products.ambientOcclusion.status, 'not-implemented', 'AO bake is not claimed');
assert.equal(manifest.products.emissive.status, 'not-implemented', 'emissive bake is not claimed');
assert.equal(manifest.products.height.status, 'deferred', 'height/parallax stays deferred');
assert.equal(manifest.diagnostics.distance.status, 'pending', 'assay-only diagnostics are pending');
assert.equal(manifest.diagnostics.unresolvedMask.status, 'pending', 'assay-only unresolved mask is pending');
assert.equal(manifest.diagnostics.route.status, 'pending', 'assay-only route image is pending');

const materialless = spawnSync('uv', [
  'run',
  '--with', 'numpy',
  '--with', 'pillow',
  '--with', 'scipy',
  '--with', 'trimesh',
  'python',
  resolve('tools/generated-asset-bake.py'),
  '--source', source,
  '--target', targetMaterialless,
  '--out-dir', materiallessDir,
  '--name', 'fixture-materialless-target-bake',
  '--texture-size', '8',
  '--projection-route', 'nearest-source-surface',
  '--padding-pixels', '1',
], {
  cwd: resolve('.'),
  encoding: 'utf8',
});

assert.equal(materialless.status, 0, materialless.stderr || materialless.stdout);
const materiallessManifest = JSON.parse(readFileSync(join(materiallessDir, 'generated-asset-bake-manifest.json'), 'utf8'));
assert.equal(materiallessManifest.status, 'emitted', 'materialless UV target can receive baked material');
assert.equal(materiallessManifest.target.materials.materialCount, 0, 'input target is allowed to have no material');
assert.equal(materiallessManifest.postExportAssay.hasUv0, true, 'baked materialless target preserves UV0');
assert.equal(materiallessManifest.postExportAssay.hasVertexNormals, true, 'baked materialless target receives vertex normals for PBR rendering');
assert.equal(materiallessManifest.postExportAssay.triangleCount, 2, 'baked materialless target preserves geometry');
assert.ok(existsSync(join(materiallessDir, 'asset-baked.glb')), 'baked GLB is emitted for materialless target');
const materiallessBakedDoc = readGlbJson(join(materiallessDir, 'asset-baked.glb'));
assert.equal(
  materiallessBakedDoc.meshes[0].primitives[0].material,
  0,
  'baked materialless target primitive references the injected PBR material',
);

const fail = spawnSync('python3', [
  resolve('tools/generated-asset-bake.py'),
  '--source', source,
  '--target', targetNoUv,
  '--out-dir', failDir,
  '--assay-only',
], {
  cwd: resolve('.'),
  encoding: 'utf8',
});

assert.notEqual(fail.status, 0, 'missing target UV0 must fail loudly');
const failure = JSON.parse(readFileSync(join(failDir, 'generated-asset-bake-manifest.json'), 'utf8'));
assert.equal(failure.schema, 'kaminos.generated-asset-bake.v0', 'failure still writes the bake receipt');
assert.equal(failure.status, 'failed', 'failure receipt names failed status');
assert.equal(failure.failure.phase, 'preflight', 'missing UV0 fails during preflight');
assert.equal(failure.failure.code, 'target-missing-uv0', 'failure code preserves exact UV0 cause');
assert.equal(failure.uvPolicy, 'required-existing-uv0', 'failure receipt still names UV policy');
