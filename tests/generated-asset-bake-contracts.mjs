import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    asset: { version: '2.0', generator: 'kaminos-generated-asset-bake-test' },
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

const root = mkdtempSync(join(tmpdir(), 'kaminos-generated-asset-bake-contract-'));
const source = join(root, 'source.glb');
const target = join(root, 'target.glb');
const targetNoUv = join(root, 'target-no-uv.glb');
const outDir = join(root, 'bake');
const failDir = join(root, 'bake-fail');
mkdirSync(outDir, { recursive: true });
mkdirSync(failDir, { recursive: true });
writeFixtureGlb(source, { uv0: true });
writeFixtureGlb(target, { uv0: true });
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
assert.equal(manifest.projection.route, 'nearest-source-vertex', 'manifest records the effective projection route');
assert.equal(manifest.projection.status, 'pending', 'assay-only does not pretend projection ran');
assert.equal(manifest.products.baseColor.status, 'pending', 'assay-only does not pretend baseColor was emitted');
assert.equal(manifest.products.metallicRoughness.status, 'pending', 'assay-only does not pretend MR was emitted');
assert.equal(manifest.products.normal.status, 'not-implemented', 'normal bake is not claimed');
assert.equal(manifest.products.ambientOcclusion.status, 'not-implemented', 'AO bake is not claimed');
assert.equal(manifest.products.emissive.status, 'not-implemented', 'emissive bake is not claimed');
assert.equal(manifest.products.height.status, 'deferred', 'height/parallax stays deferred');
assert.equal(manifest.diagnostics.distance.status, 'pending', 'assay-only diagnostics are pending');
assert.equal(manifest.diagnostics.unresolvedMask.status, 'pending', 'assay-only unresolved mask is pending');
assert.equal(manifest.diagnostics.route.status, 'pending', 'assay-only route image is pending');

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
