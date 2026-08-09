import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import * as core from '../proxy-rig-core.mjs';
import { parseGlbGeometry } from '../cast-registration-core.mjs';
import { parseGlbNodeGeometries, applyChain } from '../bone-containment-probe-core.mjs';

const W = new URL('../artifacts/cast-correspondence-v0/', import.meta.url);

test('real SF3D route packages the frozen geometry, bindings, and source identity deterministically', async () => {
  assert.equal(typeof core.createProxyRigPackage, 'function');
  const bones = parseGlbNodeGeometries(await readFile(new URL('frozen/skeleton-authored.glb', W)));
  const manifest = JSON.parse(await readFile(new URL('frozen/region-manifest-golden-provisional.json', W), 'utf8'));
  const frameLink = JSON.parse(await readFile(new URL('receipts/frame-link--skeleton--envelope-baseline.json', W), 'utf8'));
  const stageA = JSON.parse(await readFile(new URL('receipts/envelope-baseline--cast-sf3d-skin-baseline.json', W), 'utf8'));
  const envelope = parseGlbGeometry(await readFile(new URL('frozen/envelope-baseline.glb', W)));
  const cast = parseGlbGeometry(await readFile(new URL('frozen/cast-sf3d-skin-baseline.glb', W)));
  const stageATransform = stageA.registration.transform;
  const envelopeInCastFrame = {
    positions: new Float64Array(envelope.positions.length),
    triangles: envelope.triangles,
  };
  for (let i = 0; i < envelope.positions.length; i += 3) {
    const point = applyChain(
      [envelope.positions[i], envelope.positions[i + 1], envelope.positions[i + 2]],
      [stageATransform],
    );
    envelopeInCastFrame.positions.set(point, i);
  }
  const chainTransforms = [{ scale: 1, ...frameLink.link.transform }, stageATransform];
  const skinBinding = core.bindEnvelopeToSkeleton({
    envelope: envelopeInCastFrame,
    bones,
    manifest,
    chainTransforms,
  });
  const castBinding = core.bindCastToEnvelope({ cast, envelopeInCastFrame });
  const input = {
    envelopeInCastFrame,
    cast,
    skinBinding,
    castBinding,
    source: {
      cast: 'artifacts/cast-correspondence-v0/frozen/cast-sf3d-skin-baseline.glb',
      envelope: 'artifacts/cast-correspondence-v0/frozen/envelope-baseline.glb',
      skeleton: 'artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb',
      frameLinkReceipt: 'artifacts/cast-correspondence-v0/receipts/frame-link--skeleton--envelope-baseline.json',
      registrationReceipt: 'artifacts/cast-correspondence-v0/receipts/envelope-baseline--cast-sf3d-skin-baseline.json',
    },
  };
  const a = core.createProxyRigPackage(input);
  const b = core.createProxyRigPackage(input);
  assert.match(a.packageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(a.packageId, b.packageId);
  assert.equal(a.envelope.positions.length, envelope.positions.length);
  assert.equal(a.cast.positions.length, cast.positions.length);
  assert.equal(a.castBinding.triangle.length, cast.positions.length / 3);
  assert.deepEqual(a.source, input.source);
  const packagedGroups = new Map(a.skinBinding.groups.map(group => [group.name, group]));
  assert.equal(packagedGroups.get('hindlimb-right-stifle').parent, 'hindlimb-right-hip');
  assert.equal(packagedGroups.get('hindlimb-right-hock').parent, 'hindlimb-right-stifle');
  assert.equal(packagedGroups.get('hindlimb-right-paw').parent, 'hindlimb-right-hock');
  assert.deepEqual(packagedGroups.get('hindlimb-right-stifle').sourceBones, ['Cube.086', 'Cube.089']);
  assert.match(packagedGroups.get('hindlimb-right-hock').pivotDerivation, /nearest-surface boundary/i);
});

test('source artifact bytes must agree with the receipt hash before packaging', () => {
  assert.equal(typeof core.assertProxyRigArtifactHash, 'function');
  const bytes = Buffer.from('actual frozen artifact');
  assert.throws(
    () => core.assertProxyRigArtifactHash(bytes, '0'.repeat(64), 'cast'),
    /cast.*receipt hash/i,
  );
});

async function stagedArtifactRoot() {
  const root = await mkdtemp(join(tmpdir(), 'proxy-rig-package-sources-'));
  const relativePaths = [
    'frozen/skeleton-authored.glb',
    'frozen/region-manifest-golden-provisional.json',
    'frozen/envelope-baseline.glb',
    'frozen/cast-sf3d-skin-baseline.glb',
    'receipts/frame-link--skeleton--envelope-baseline.json',
    'receipts/envelope-baseline--cast-sf3d-skin-baseline.json',
  ];
  for (const relativePath of relativePaths) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL(relativePath, W), target);
  }
  return root;
}

function runBuilder(artifactRoot, outputPath) {
  return spawnSync(process.execPath, [
    'tools/build-proxy-rig-package.mjs',
    '--artifact-root', artifactRoot,
    '--output', outputPath,
  ], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
}

test('builder rejects a receipt whose transform no longer matches its self-identity', async () => {
  const root = await stagedArtifactRoot();
  try {
    const receiptPath = join(root, 'receipts/frame-link--skeleton--envelope-baseline.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.link.transform.translation[0] += 0.125;
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
    const result = runBuilder(root, join(root, 'output.json'));
    assert.notEqual(result.status, 0, 'tampered receipt must fail the package build');
    assert.match(result.stderr, /frame-link receipt.*identity/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builder binds the manifest to the skeleton and fingerprints its bytes', async () => {
  const root = await stagedArtifactRoot();
  try {
    const manifestPath = join(root, 'frozen/region-manifest-golden-provisional.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.source_glb_sha256 = '0'.repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const rejected = runBuilder(root, join(root, 'rejected.json'));
    assert.notEqual(rejected.status, 0, 'manifest for another skeleton must fail the package build');
    assert.match(rejected.stderr, /manifest.*skeleton/i);

    await copyFile(new URL('frozen/region-manifest-golden-provisional.json', W), manifestPath);
    const outputPath = join(root, 'accepted.json');
    const accepted = runBuilder(root, outputPath);
    assert.equal(accepted.status, 0, accepted.stderr);
    const packageData = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.match(packageData.source.manifestSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
