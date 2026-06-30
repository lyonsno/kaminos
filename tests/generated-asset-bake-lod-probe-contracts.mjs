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

function writeFixtureGlb(path, { uv0 = true, min = [-1, -1, 0], max = [1, 1, 0] } = {}) {
  const attributes = { POSITION: 0, NORMAL: 1 };
  if (uv0) attributes.TEXCOORD_0 = 2;

  const doc = {
    asset: { version: '2.0', generator: 'kaminos-generated-asset-bake-lod-probe-test' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, name: 'Fixture module' }],
    meshes: [{
      name: 'fixture-mesh',
      primitives: [{
        attributes,
        indices: uv0 ? 3 : 2,
        material: 0,
        mode: 4,
      }],
    }],
    accessors: [
      { componentType: 5126, count: 4, type: 'VEC3', min, max },
      { componentType: 5126, count: 4, type: 'VEC3' },
      { componentType: 5126, count: 4, type: 'VEC2' },
      { componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    materials: [{
      name: 'fixture-pbr',
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 1 },
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

function f32(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function writeCoverageFixtureGlb(path, positions) {
  const flatPositions = positions.flat();
  const normals = positions.flatMap(() => [0, 0, 1]);
  const uvs = positions.flatMap(() => [0, 0]);
  const positionBytes = f32(flatPositions);
  const normalBytes = f32(normals);
  const uvBytes = f32(uvs);
  const normalOffset = positionBytes.length;
  const uvOffset = normalOffset + normalBytes.length;
  const bin = pad4(Buffer.concat([positionBytes, normalBytes, uvBytes]), 0);
  const mins = [0, 1, 2].map((axis) => Math.min(...positions.map((point) => point[axis])));
  const maxs = [0, 1, 2].map((axis) => Math.max(...positions.map((point) => point[axis])));
  const doc = {
    asset: { version: '2.0', generator: 'kaminos-generated-asset-bake-lod-probe-coverage-test' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes.length },
      { buffer: 0, byteOffset: uvOffset, byteLength: uvBytes.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3', min: mins, max: maxs },
      { bufferView: 1, componentType: 5126, count: positions.length, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: positions.length, type: 'VEC2' },
    ],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
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

const root = mkdtempSync(join(tmpdir(), 'kaminos-generated-asset-bake-lod-probe-contract-'));
const source = join(root, 'source.glb');
const target = join(root, 'target.glb');
const thinTarget = join(root, 'target-thin.glb');
const targetNoUv = join(root, 'target-no-uv.glb');
const outDir = join(root, 'probe');
mkdirSync(outDir, { recursive: true });
writeFixtureGlb(source, { uv0: true });
writeFixtureGlb(target, { uv0: true });
writeFixtureGlb(thinTarget, { uv0: true, min: [-0.15, -1, 0], max: [0.15, 1, 0] });
writeFixtureGlb(targetNoUv, { uv0: false });

const result = spawnSync('python3', [
  resolve('tools/generated-asset-bake-lod-probe.py'),
  '--source', source,
  '--target', `uv-target=${target}`,
  '--target', `thin-target=${thinTarget}`,
  '--target', `no-uv-target=${targetNoUv}`,
  '--out-dir', outDir,
  '--name', 'fixture-lod-probe',
  '--assay-only',
], {
  cwd: resolve('.'),
  encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const manifest = JSON.parse(readFileSync(join(outDir, 'generated-asset-bake-lod-probe-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.generated-asset-bake-lod-probe.v0', 'manifest names the LOD probe contract');
assert.equal(manifest.assetName, 'fixture-lod-probe', 'manifest preserves caller asset name');
assert.equal(manifest.source.path, realpathSync(source), 'manifest preserves source path');
assert.equal(manifest.uvPolicy, 'required-existing-uv0', 'probe keeps the existing UV0 policy');
assert.equal(manifest.bakeDefaults.projectionRoute, 'nearest-source-surface-normal-aware', 'probe records effective bake route');
assert.equal(manifest.bakeDefaults.paddingPixels, 12, 'probe records effective padding');
assert.equal(manifest.targets.length, 3, 'probe records all targets');
assert.equal(manifest.geometryValidityPolicy, 'source-relative-target-assay', 'manifest names the target validity contract');

const uvTarget = manifest.targets.find((targetRecord) => targetRecord.label === 'uv-target');
const thinTargetRecord = manifest.targets.find((targetRecord) => targetRecord.label === 'thin-target');
const noUvTarget = manifest.targets.find((targetRecord) => targetRecord.label === 'no-uv-target');
assert.equal(uvTarget.status, 'pending', 'assay-only UV target is pending, not falsely baked');
assert.equal(uvTarget.reason, 'assay-only', 'pending UV target records assay-only reason');
assert.equal(uvTarget.assay.geometry.hasUv0, true, 'UV target assay records UV0');
assert.equal(uvTarget.assay.geometry.hasVertexNormals, true, 'UV target assay records normals');
assert.equal(uvTarget.geometryValidity.status, 'reference-like', 'matching target bounds are classified as reference-like');
assert.deepEqual(uvTarget.geometryValidity.extentRatios, [1, 1, 1], 'matching target records extent ratios');
assert.equal(uvTarget.bake.outputDirectory.endsWith('/uv-target'), true, 'UV target receives stable per-target output dir');
assert.equal(uvTarget.kaminosUrl, null, 'assay-only target does not pretend a Kaminos baked URL exists');
assert.equal(thinTargetRecord.geometryValidity.status, 'partial-bounds', 'thin target is classified before bake');
assert.equal(thinTargetRecord.geometryValidity.extentRatios[0], 0.15, 'thin target records the collapsed extent ratio');
assert.equal(noUvTarget.status, 'skipped', 'no-UV target is skipped');
assert.equal(noUvTarget.reason, 'target-missing-uv0', 'no-UV target carries explicit skip reason');
assert.equal(noUvTarget.assay.geometry.hasUv0, false, 'no-UV target assay records missing UV0');

const coverageSource = join(root, 'coverage-source.glb');
const coverageSparse = join(root, 'coverage-sparse.glb');
const coverageOutDir = join(root, 'coverage-probe');
mkdirSync(coverageOutDir, { recursive: true });
const densePoints = [];
for (let x = 0; x < 5; x += 1) {
  for (let y = 0; y < 5; y += 1) {
    for (let z = 0; z < 5; z += 1) {
      densePoints.push([x / 4, y / 4, z / 4]);
    }
  }
}
const sparseCorners = [
  [0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1],
  [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1],
];
writeCoverageFixtureGlb(coverageSource, densePoints);
writeCoverageFixtureGlb(coverageSparse, sparseCorners);

const coverageResult = spawnSync('python3', [
  resolve('tools/generated-asset-bake-lod-probe.py'),
  '--source', coverageSource,
  '--target', `sparse-same-bounds=${coverageSparse}`,
  '--out-dir', coverageOutDir,
  '--name', 'fixture-coverage-probe',
  '--assay-only',
], {
  cwd: resolve('.'),
  encoding: 'utf8',
});

assert.equal(coverageResult.status, 0, coverageResult.stderr || coverageResult.stdout);
const coverageManifest = JSON.parse(readFileSync(join(coverageOutDir, 'generated-asset-bake-lod-probe-manifest.json'), 'utf8'));
const sparseTarget = coverageManifest.targets.find((targetRecord) => targetRecord.label === 'sparse-same-bounds');
assert.equal(sparseTarget.geometryValidity.status, 'partial-coverage', 'same-bounds sparse target is not allowed to pass as reference-like');
assert.ok(sparseTarget.geometryValidity.voxelCoverage.sourceCoverageDilated < 0.5, 'coverage metric exposes deleted source occupancy');

const coverageSkipOutDir = join(root, 'coverage-skip-probe');
mkdirSync(coverageSkipOutDir, { recursive: true });
const coverageSkipResult = spawnSync('python3', [
  resolve('tools/generated-asset-bake-lod-probe.py'),
  '--source', coverageSource,
  '--target', `sparse-same-bounds=${coverageSparse}`,
  '--out-dir', coverageSkipOutDir,
  '--name', 'fixture-coverage-skip-probe',
], {
  cwd: resolve('.'),
  encoding: 'utf8',
});

assert.equal(coverageSkipResult.status, 0, coverageSkipResult.stderr || coverageSkipResult.stdout);
const coverageSkipManifest = JSON.parse(readFileSync(join(coverageSkipOutDir, 'generated-asset-bake-lod-probe-manifest.json'), 'utf8'));
const skippedSparseTarget = coverageSkipManifest.targets.find((targetRecord) => targetRecord.label === 'sparse-same-bounds');
assert.equal(skippedSparseTarget.status, 'skipped', 'invalid target geometry is skipped before bake');
assert.equal(skippedSparseTarget.reason, 'target-geometry-partial-coverage', 'skip reason names the geometry validity failure');
assert.equal(skippedSparseTarget.bake.command, undefined, 'invalid geometry does not invoke generated-asset-bake');
