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
import { validateAuthoredRigHierarchy } from '../authored-rig-hierarchy-core.mjs';

const W = new URL('../artifacts/cast-correspondence-v0/', import.meta.url);

function rehashAuthoredHierarchy(receipt) {
  const { receiptSha256: ignored, ...content } = receipt;
  return {
    ...content,
    receiptSha256: `sha256:${createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex')}`,
  };
}

test('authored hierarchy receipt declares side authority and exact unmatched-node admission', async () => {
  const receipt = JSON.parse(await readFile(
    new URL('frozen/cat-bauplan-authored-hierarchy.receipt.json', W), 'utf8',
  ));
  const sourceMeshIdentity = JSON.parse(await readFile(
    new URL('frozen/cat-bauplan-authored-hierarchy.source-mesh-identity.json', W), 'utf8',
  ));
  assert.deepEqual(receipt.sideResolution, {
    authority: 'frozen-skeleton-source-bone-anchor',
    anchors: { left: 'Cube.002', right: 'Cube.087' },
    rawNodeLabels: 'advisory',
    branches: [
      {
        canonicalSide: 'left',
        sourceAnchor: 'Cube.002',
        rawHipNode: 'hindlimb-right-hip',
        rawHipSide: 'right',
        agrees: false,
      },
      {
        canonicalSide: 'right',
        sourceAnchor: 'Cube.087',
        rawHipNode: 'hindlimb-left-hip.001',
        rawHipSide: 'left',
        agrees: false,
      },
    ],
  });
  assert.deepEqual(receipt.unmatchedMeshPolicy, {
    mode: 'explicit-allowlist',
    admitted: [{
      nodeName: 'Cube.021',
      rationale: 'operator-authored accessory retained in the hierarchy source but outside frozen skeleton ownership',
    }],
  });
  validateAuthoredRigHierarchy(receipt, { sourceMeshIdentity });

  const hiddenSideDisagreement = structuredClone(receipt);
  hiddenSideDisagreement.sideResolution.branches[0].agrees = true;
  assert.throws(
    () => validateAuthoredRigHierarchy(
      rehashAuthoredHierarchy(hiddenSideDisagreement), { sourceMeshIdentity },
    ),
    /raw.*side.*diagnostic/i,
  );

  const driftedControlSource = structuredClone(receipt);
  driftedControlSource.controls.find(control => control.name === 'hindlimb-left-hip').rawSourceNode = 'hindlimb-left-hip';
  assert.throws(
    () => validateAuthoredRigHierarchy(
      rehashAuthoredHierarchy(driftedControlSource), { sourceMeshIdentity },
    ),
    /raw.*side.*diagnostic/i,
  );

  const unadmittedAccessory = structuredClone(receipt);
  unadmittedAccessory.unmatchedMeshPolicy.admitted = [];
  assert.throws(
    () => validateAuthoredRigHierarchy(
      rehashAuthoredHierarchy(unadmittedAccessory), { sourceMeshIdentity },
    ),
    /unmatched.*admission/i,
  );

  const erasedAccessory = structuredClone(receipt);
  erasedAccessory.meshMatches = erasedAccessory.meshMatches.filter(match => match.nodeName !== 'Cube.021');
  erasedAccessory.unmatchedMeshNodes = [];
  erasedAccessory.unmatchedMeshPolicy.admitted = [];
  assert.throws(
    () => validateAuthoredRigHierarchy(rehashAuthoredHierarchy(erasedAccessory), { sourceMeshIdentity }),
    /mesh.*match.*count/i,
  );

  const paddedAccessoryErasure = structuredClone(receipt);
  paddedAccessoryErasure.meshMatches = paddedAccessoryErasure.meshMatches.filter(
    match => match.nodeName !== 'Cube.021',
  );
  paddedAccessoryErasure.meshMatches.push({
    nodeIndex: 999,
    nodeName: 'Cube.999',
    meshIndex: 999,
    skeletonBone: 'Cube.002',
    residual: 0,
  });
  paddedAccessoryErasure.unmatchedMeshNodes = [];
  paddedAccessoryErasure.unmatchedMeshPolicy.admitted = [];
  assert.throws(
    () => validateAuthoredRigHierarchy(
      rehashAuthoredHierarchy(paddedAccessoryErasure), { sourceMeshIdentity },
    ),
    /source.*mesh.*identity/i,
  );
});

test('authored bilateral hierarchy replaces broad hindlimbs and owns M31 supports', async () => {
  const bones = parseGlbNodeGeometries(await readFile(new URL('frozen/skeleton-authored.glb', W)));
  const manifest = JSON.parse(await readFile(new URL('frozen/region-manifest-golden-provisional.json', W), 'utf8'));
  const envelope = parseGlbGeometry(await readFile(new URL('frozen/envelope-baseline.glb', W)));
  const origin = name => [...bones.find(bone => bone.name === name).worldOrigin];
  const authoredHierarchy = {
    replaces: ['hindlimb-left', 'hindlimb-right'],
    controls: [
      {
        name: 'hindlimb-left-hip',
        parent: null,
        pivot: origin('Cube.002'),
        sourceBones: ['Icosphere', 'Cube.002'],
      },
      {
        name: 'hindlimb-left-stifle',
        parent: 'hindlimb-left-hip',
        pivot: origin('Cube.001'),
        sourceBones: ['Cube.001', 'Cube.005'],
      },
      {
        name: 'hindlimb-left-hock',
        parent: 'hindlimb-left-stifle',
        pivot: origin('Cube.003'),
        sourceBones: ['Cube.003', 'Cube.004', 'Cube.012', 'Cube.045', 'Cube.066', 'Cube.067', 'Cube.072', 'Cube.073', 'Cube.074', 'Cube.075'],
      },
      {
        name: 'hindlimb-right-hip',
        parent: null,
        pivot: origin('Cube.087'),
        sourceBones: ['Cube.083', 'Cube.087'],
      },
      {
        name: 'hindlimb-right-stifle',
        parent: 'hindlimb-right-hip',
        pivot: origin('Cube.086'),
        sourceBones: ['Cube.086', 'Cube.089'],
      },
      {
        name: 'hindlimb-right-hock',
        parent: 'hindlimb-right-stifle',
        pivot: origin('Cube.088'),
        sourceBones: ['Cube.068', 'Cube.069', 'Cube.070', 'Cube.071', 'Cube.081', 'Cube.082', 'Cube.084', 'Cube.085', 'Cube.088'],
      },
    ],
  };

  const skinBinding = core.bindEnvelopeToSkeleton({
    envelope,
    bones,
    manifest,
    chainTransforms: [],
    authoredHierarchy,
    samplesPerBone: 2,
  });
  const groups = new Map(skinBinding.groups.map(group => [group.name, group]));
  assert.equal(groups.has('hindlimb-left'), false, 'broad left hindlimb must be replaced');
  assert.equal(groups.has('hindlimb-right'), false, 'broad right hindlimb must be replaced');
  assert.equal(groups.has('hindlimb-left-distal-support'), false, 'synthetic M31 support must not survive');
  assert.equal(groups.get('hindlimb-left-stifle').parent, 'hindlimb-left-hip');
  assert.equal(groups.get('hindlimb-left-hock').parent, 'hindlimb-left-stifle');
  assert.ok(groups.get('hindlimb-left-hip').sourceBones.includes('Cube.002'));
  assert.ok(groups.get('hindlimb-left-hock').sourceBones.includes('Cube.003'));

  const sourceFixture = JSON.parse(await readFile(
    new URL('frozen/m31-authenticated-source.compact.json', W), 'utf8',
  ));
  const sourceRegistration = JSON.parse(await readFile(
    new URL('receipts/m31-source-blend--skeleton-authored.json', W), 'utf8',
  ));
  const overlay = core.createM31LiveOverlay({
    sourceFixture,
    sourceRegistration,
    chainTransforms: [],
    supportMapping: {
      fixed: 'hindlimb-left-hip',
      moving: 'hindlimb-left-hock',
      fixedSource: 'Cube.002',
      movingSource: 'Cube.003',
    },
  });
  assert.deepEqual(overlay.muscle.supportMapping, {
    fixed: 'hindlimb-left-hip',
    moving: 'hindlimb-left-hock',
    fixedSource: 'Cube.002',
    movingSource: 'Cube.003',
  });
});

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
  const authoredHierarchySourceMeshIdentity = JSON.parse(await readFile(
    new URL('frozen/cat-bauplan-authored-hierarchy.source-mesh-identity.json', W), 'utf8',
  ));
  const authoredHierarchy = validateAuthoredRigHierarchy(JSON.parse(await readFile(
    new URL('frozen/cat-bauplan-authored-hierarchy.receipt.json', W), 'utf8',
  )), {
    skeletonSha256: createHash('sha256')
      .update(await readFile(new URL('frozen/skeleton-authored.glb', W))).digest('hex'),
    sourceMeshIdentity: authoredHierarchySourceMeshIdentity,
  });
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
    supportMapping: {
      fixed: 'hindlimb-left-hip',
      moving: 'hindlimb-left-hock',
      fixedSource: 'Cube.002',
      movingSource: 'Cube.003',
    },
  });
  const skinBinding = core.bindEnvelopeToSkeleton({
    envelope: envelopeInCastFrame,
    bones,
    manifest,
    chainTransforms,
    authoredHierarchy,
  });
  const castBinding = core.bindCastToEnvelope({ cast, envelopeInCastFrame });
  const input = {
    envelopeInCastFrame,
    cast,
    skinBinding,
    castBinding,
    muscles: [m31Overlay.muscle],
    interaction: {
      initialControl: 'hindlimb-left-hock',
    },
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
  assert.equal(packagedGroups.get('hindlimb-right-hip').parent, 'pelvis');
  assert.deepEqual(packagedGroups.get('hindlimb-right-stifle').sourceBones, ['Cube.086', 'Cube.089']);
  assert.match(packagedGroups.get('hindlimb-right-hock').pivotDerivation, /operator-authored/i);
  assert.equal(packagedGroups.get('hindlimb-left-hip').parent, 'pelvis');
  assert.equal(packagedGroups.get('hindlimb-left-hock').parent, 'hindlimb-left-stifle');
  assert.deepEqual(packagedGroups.get('hindlimb-left-hock').sourceBones.slice(0, 2), ['Cube.003', 'Cube.004']);
  assert.ok(
    [...packagedGroups.keys()].every(name => !/m31|muscle-31/i.test(name)),
    'skeletal control identity must not depend on the first relation that consumes it',
  );
  assert.equal(packagedGroups.has('hindlimb-left'), false);
  assert.equal(packagedGroups.has('hindlimb-right'), false);
  assert.equal(a.muscles.length, 1);
  assert.equal(a.muscles[0].relationId, 'muscle-31');
  assert.deepEqual(a.muscles[0].supportMapping, {
    fixed: 'hindlimb-left-hip',
    moving: 'hindlimb-left-hock',
    fixedSource: 'Cube.002',
    movingSource: 'Cube.003',
  });
  assert.equal(a.muscles[0].requestedRoute, 'authenticated-m31-two-support-live-overlay');
  assert.equal(a.muscles[0].effectiveRoute, 'authenticated-m31-two-support-live-overlay');
  assert.equal(a.muscles[0].fallbackUsed, false);
  assert.deepEqual(a.interaction, {
    initialControl: 'hindlimb-left-hock',
  });
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

test('default package consumes the frozen authored pelvis hierarchy without synthetic controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'proxy-rig-authored-default-'));
  try {
    const outputPath = join(root, 'package.json');
    const result = runBuilder(new URL('../artifacts/cast-correspondence-v0', import.meta.url).pathname, outputPath);
    assert.equal(result.status, 0, result.stderr);
    const packageData = JSON.parse(await readFile(outputPath, 'utf8'));
    const names = packageData.skinBinding.groups.map(group => group.name);
    assert.ok(!names.some(name => /distal-support|muscle|m31|insertion/i.test(name)), names.join(', '));
    assert.ok(names.includes('hindlimb-left-hip'));
    assert.ok(names.includes('hindlimb-left-stifle'));
    assert.ok(names.includes('hindlimb-left-hock'));
    assert.ok(names.includes('hindlimb-right-hip'));
    assert.ok(names.includes('hindlimb-right-stifle'));
    assert.ok(names.includes('hindlimb-right-hock'));
    assert.deepEqual(packageData.muscles[0].supportMapping, {
      fixed: 'hindlimb-left-hip',
      moving: 'hindlimb-left-hock',
      fixedSource: 'Cube.002',
      movingSource: 'Cube.003',
    });
    assert.match(packageData.source.authoredHierarchyReceiptSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(packageData.source.authoredHierarchyRoot, 'pelvis');
    assert.equal(packageData.interaction.initialControl, 'hindlimb-left-hock');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function stagedArtifactRoot() {
  const root = await mkdtemp(join(tmpdir(), 'proxy-rig-package-sources-'));
  const relativePaths = [
    'frozen/skeleton-authored.glb',
    'frozen/region-manifest-golden-provisional.json',
    'frozen/envelope-baseline.glb',
    'frozen/cast-sf3d-skin-baseline.glb',
    'frozen/m31-authenticated-source.compact.json',
    'frozen/cat-bauplan-authored-hierarchy.receipt.json',
    'frozen/cat-bauplan-authored-hierarchy.source-mesh-identity.json',
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
