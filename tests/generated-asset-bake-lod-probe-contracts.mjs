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

function writeFixtureGlb(path, { uv0 = true } = {}) {
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
      { componentType: 5126, count: 4, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
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

const root = mkdtempSync(join(tmpdir(), 'kaminos-generated-asset-bake-lod-probe-contract-'));
const source = join(root, 'source.glb');
const target = join(root, 'target.glb');
const targetNoUv = join(root, 'target-no-uv.glb');
const outDir = join(root, 'probe');
mkdirSync(outDir, { recursive: true });
writeFixtureGlb(source, { uv0: true });
writeFixtureGlb(target, { uv0: true });
writeFixtureGlb(targetNoUv, { uv0: false });

const result = spawnSync('python3', [
  resolve('tools/generated-asset-bake-lod-probe.py'),
  '--source', source,
  '--target', `uv-target=${target}`,
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
assert.equal(manifest.targets.length, 2, 'probe records both targets');

const uvTarget = manifest.targets.find((targetRecord) => targetRecord.label === 'uv-target');
const noUvTarget = manifest.targets.find((targetRecord) => targetRecord.label === 'no-uv-target');
assert.equal(uvTarget.status, 'pending', 'assay-only UV target is pending, not falsely baked');
assert.equal(uvTarget.reason, 'assay-only', 'pending UV target records assay-only reason');
assert.equal(uvTarget.assay.geometry.hasUv0, true, 'UV target assay records UV0');
assert.equal(uvTarget.assay.geometry.hasVertexNormals, true, 'UV target assay records normals');
assert.equal(uvTarget.bake.outputDirectory.endsWith('/uv-target'), true, 'UV target receives stable per-target output dir');
assert.equal(uvTarget.kaminosUrl, null, 'assay-only target does not pretend a Kaminos baked URL exists');
assert.equal(noUvTarget.status, 'skipped', 'no-UV target is skipped');
assert.equal(noUvTarget.reason, 'target-missing-uv0', 'no-UV target carries explicit skip reason');
assert.equal(noUvTarget.assay.geometry.hasUv0, false, 'no-UV target assay records missing UV0');
