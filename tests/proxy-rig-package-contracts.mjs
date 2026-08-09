import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import * as core from '../proxy-rig-core.mjs';
import { canonicalProxyRigJson } from '../proxy-rig-runtime.mjs';
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
  const m31SourceFixture = JSON.parse(await readFile(
    new URL('frozen/m31-authenticated-source.compact.json', W), 'utf8',
  ));
  const m31SourceRegistration = JSON.parse(await readFile(
    new URL('receipts/m31-source-blend--skeleton-authored.json', W), 'utf8',
  ));
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
  const m31Overlay = core.createM31LiveOverlay({
    sourceFixture: m31SourceFixture,
    sourceRegistration: m31SourceRegistration,
    chainTransforms,
  });
  const leftDistalSupport = core.createSkeletalSupportRefinement({
    parentGroup: m31Overlay.muscle.supportMapping.fixed,
    childName: m31Overlay.muscle.supportMapping.moving,
    supportBone: bones.find(bone => bone.name === m31Overlay.muscle.supportMapping.movingSource),
  });
  const skinBinding = core.bindEnvelopeToSkeleton({
    envelope: envelopeInCastFrame,
    bones,
    manifest,
    chainTransforms,
    supportRefinements: [leftDistalSupport],
  });
  const castBinding = core.bindCastToEnvelope({ cast, envelopeInCastFrame });
  const input = {
    envelopeInCastFrame,
    cast,
    skinBinding,
    castBinding,
    muscles: [m31Overlay.muscle],
    source: {
      cast: 'artifacts/cast-correspondence-v0/frozen/cast-sf3d-skin-baseline.glb',
      envelope: 'artifacts/cast-correspondence-v0/frozen/envelope-baseline.glb',
      skeleton: 'artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb',
      frameLinkReceipt: 'artifacts/cast-correspondence-v0/receipts/frame-link--skeleton--envelope-baseline.json',
      registrationReceipt: 'artifacts/cast-correspondence-v0/receipts/envelope-baseline--cast-sf3d-skin-baseline.json',
      m31AuthoredSupportProximity: {
        nearestDistance: 0.1,
        supportDiagonal: 1,
        maximumDistance: 0.25,
      },
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
  assert.equal(packagedGroups.get('hindlimb-left-distal-support').parent, 'hindlimb-left');
  assert.deepEqual(packagedGroups.get('hindlimb-left-distal-support').sourceBones, ['Cube.003']);
  assert.ok(
    [...packagedGroups.keys()].every(name => !/m31|muscle-31/i.test(name)),
    'skeletal control identity must not depend on the first relation that consumes it',
  );
  assert.ok(packagedGroups.get('hindlimb-left').sourceBones.includes('Cube.002'));
  assert.ok(!packagedGroups.get('hindlimb-left').sourceBones.includes('Cube.003'));
  assert.equal(a.muscles.length, 1);
  assert.equal(a.muscles[0].relationId, 'muscle-31');
  assert.deepEqual(a.muscles[0].supportMapping, {
    fixed: 'hindlimb-left',
    moving: 'hindlimb-left-distal-support',
    fixedSource: 'Cube.002',
    movingSource: 'Cube.003',
  });
  assert.equal(a.muscles[0].requestedRoute, 'authenticated-m31-two-support-live-overlay');
  assert.equal(a.muscles[0].effectiveRoute, 'authenticated-m31-two-support-live-overlay');
  assert.equal(a.muscles[0].fallbackUsed, false);
  assert.deepEqual(a.source.m31AuthoredSupportProximity, input.source.m31AuthoredSupportProximity);
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
    'frozen/m31-authenticated-source.compact.json',
    'receipts/m31-source-blend--skeleton-authored.json',
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

test('builder rejects a rehashed M31 transform displaced from its authored support', async () => {
  const root = await stagedArtifactRoot();
  try {
    const receiptPath = join(root, 'receipts/m31-source-blend--skeleton-authored.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    receipt.transform.translation[0] += 10;
    const { receiptSha256: ignored, ...content } = receipt;
    receipt.receiptSha256 = `sha256:${createHash('sha256')
      .update(canonicalProxyRigJson(content)).digest('hex')}`;
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);

    const result = runBuilder(root, join(root, 'output.json'));
    assert.notEqual(result.status, 0, 'self-consistent but spatially displaced registration must fail');
    assert.match(result.stderr, /M31.*authored.*support.*proximity/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builder rejects a rehashed compact M31 fixture that diverges from historical source bytes', async () => {
  const root = await stagedArtifactRoot();
  try {
    const fixturePath = join(root, 'frozen/m31-authenticated-source.compact.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    fixture.positions[0] += 1;
    const { fixtureId: ignored, ...content } = fixture;
    fixture.fixtureId = `sha256:${createHash('sha256')
      .update(canonicalProxyRigJson(content)).digest('hex')}`;
    await writeFile(fixturePath, `${JSON.stringify(fixture)}\n`);

    const result = runBuilder(root, join(root, 'output.json'));
    assert.notEqual(result.status, 0, 'self-consistent compact fixture drift must fail');
    assert.match(result.stderr, /historical.*compact.*mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builder rejects a rehashed compact M31 fixture with a forged historical locator', async () => {
  const root = await stagedArtifactRoot();
  try {
    const fixturePath = join(root, 'frozen/m31-authenticated-source.compact.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    fixture.historicalRef = 'wrong-commit:wrong/source-fixture.json';
    const { fixtureId: ignored, ...content } = fixture;
    fixture.fixtureId = `sha256:${createHash('sha256')
      .update(canonicalProxyRigJson(content)).digest('hex')}`;
    await writeFile(fixturePath, `${JSON.stringify(fixture)}\n`);

    const result = runBuilder(root, join(root, 'output.json'));
    assert.notEqual(result.status, 0, 'self-consistent forged historical locator must fail');
    assert.match(result.stderr, /historical.*compact.*mismatch/i);
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
    assert.ok(
      packageData.source.m31AuthoredSupportProximity.nearestDistance
        <= packageData.source.m31AuthoredSupportProximity.maximumDistance,
      'package records the admitted authored-support proximity witness',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
