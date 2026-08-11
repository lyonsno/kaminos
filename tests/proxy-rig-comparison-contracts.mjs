import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseGlbGeometry } from '../cast-registration-core.mjs';
import {
  createProxyRigComparisonCarryState,
  resolveProxyRigComparisonCandidate,
  transferProxyRigComparisonPose,
  validateProxyRigComparisonManifest,
  validateProxyRigComparisonLiveState,
} from '../proxy-rig-comparison.mjs';

const manifestUrl = new URL(
  '../artifacts/cast-correspondence-v0/cast-topology-comparison.json',
  import.meta.url,
);

test('cast topology comparison freezes Molten ranked contenders and registration control', async () => {
  const manifest = validateProxyRigComparisonManifest(JSON.parse(
    await readFile(manifestUrl, 'utf8'),
  ));

  assert.equal(manifest.schema, 'kaminos.proxy-rig-comparison.v0');
  assert.deepEqual(manifest.candidates.map(candidate => ({
    id: candidate.id,
    role: candidate.role,
    seriousVisibleChoice: candidate.seriousVisibleChoice,
    castSha256: candidate.castSha256,
  })), [
    {
      id: 'sf3d-skin-baseline',
      role: 'engineering-baseline',
      seriousVisibleChoice: true,
      castSha256: 'bcc51bb15fd7e4fae8e6c67990416a7f7f09d3b9b9b39a4ae793ca3c5b5770f2',
    },
    {
      id: 'trellis-skin-80413',
      role: 'preferred-generated-shape-comparator',
      seriousVisibleChoice: true,
      castSha256: 'd44193ff5301be1569cb5b3f2aaa5b07580e04442e04dcdb276e6817c54bae0a',
    },
    {
      id: 'trellis-skin-80302',
      role: 'closest-generated-visual-alternative',
      seriousVisibleChoice: true,
      castSha256: '062deed4fd9c9d9c4730309798af2ee8cb0184e4c7ae537d1da340e69712a232',
    },
    {
      id: 'trellis-mannequin-80413',
      role: 'registration-control',
      seriousVisibleChoice: false,
      castSha256: '262fe609ded81759ab7c13512caf37eadf75faa436bdecf5feed5794f73d0fe3',
    },
  ]);
  assert.equal(manifest.claimCeiling, 'visual deformation-carrier comparison only');
});

test('comparison candidate resolution fails loud instead of substituting the baseline', async () => {
  const manifest = validateProxyRigComparisonManifest(JSON.parse(
    await readFile(manifestUrl, 'utf8'),
  ));
  assert.equal(
    resolveProxyRigComparisonCandidate(manifest, 'trellis-skin-80413').id,
    'trellis-skin-80413',
  );
  assert.throws(
    () => resolveProxyRigComparisonCandidate(manifest, 'absent-candidate'),
    /unknown comparison candidate absent-candidate/i,
  );
});

test('comparison pose transfer requires the same exact control contract', () => {
  const pose = {
    pelvis: { quaternion: [0, 0, 0, 1] },
    'hindlimb-left-hock': { quaternion: [0.1, 0.2, 0.3, 0.9] },
  };
  assert.deepEqual(
    transferProxyRigComparisonPose(pose, ['pelvis', 'hindlimb-left-hock']),
    pose,
  );
  assert.throws(
    () => transferProxyRigComparisonPose(pose, ['pelvis']),
    /control contract mismatch.*hindlimb-left-hock/i,
  );
  assert.throws(
    () => transferProxyRigComparisonPose(pose, ['pelvis', 'hindlimb-left-hock', 'tail']),
    /control contract mismatch.*tail/i,
  );
});

test('comparison carry state preserves pose, selection, camera, and orbit target without aliases', () => {
  const pose = {
    pelvis: { quaternion: [0, 0, 0, 1] },
    'hindlimb-left-hock': { quaternion: [0.1, 0.2, 0.3, 0.9] },
  };
  const cameraPosition = [0.25, 0.7, 3.15];
  const orbitTarget = [0.1, -0.2, 0];
  const carry = createProxyRigComparisonCarryState({
    pose,
    selectedControl: 'hindlimb-left-hock',
    cameraPosition,
    orbitTarget,
  });

  assert.deepEqual(carry, {
    pose,
    selectedControl: 'hindlimb-left-hock',
    cameraPosition,
    orbitTarget,
  });
  pose.pelvis.quaternion[0] = 1;
  cameraPosition[0] = 9;
  orbitTarget[0] = 9;
  assert.deepEqual(carry.pose.pelvis.quaternion, [0, 0, 0, 1]);
  assert.deepEqual(carry.cameraPosition, [0.25, 0.7, 3.15]);
  assert.deepEqual(carry.orbitTarget, [0.1, -0.2, 0]);
  assert.throws(
    () => createProxyRigComparisonCarryState({
      pose: carry.pose,
      selectedControl: 'absent-control',
      cameraPosition: carry.cameraPosition,
      orbitTarget: carry.orbitTarget,
    }),
    /selected control absent-control is not present in the pose/i,
  );
});

test('comparison live-state validation rejects route, package, and embedded candidate substitution', async () => {
  const manifest = validateProxyRigComparisonManifest(JSON.parse(
    await readFile(manifestUrl, 'utf8'),
  ));
  const candidate = resolveProxyRigComparisonCandidate(manifest, 'trellis-skin-80413');
  const expectedPackageId = `sha256:${'a'.repeat(64)}`;
  const liveState = {
    status: 'live',
    requestedPackagePath: candidate.package,
    effectivePackagePath: `http://127.0.0.1:8101/${candidate.package}`,
    packageId: expectedPackageId,
    source: { comparisonCandidate: { id: candidate.id } },
  };
  assert.deepEqual(
    validateProxyRigComparisonLiveState({
      manifest,
      candidateId: candidate.id,
      expectedPackageId,
      liveState,
    }),
    candidate,
  );
  assert.throws(
    () => validateProxyRigComparisonLiveState({
      manifest,
      candidateId: candidate.id,
      expectedPackageId,
      liveState: { ...liveState, requestedPackagePath: manifest.candidates[0].package },
    }),
    /requested package path/i,
  );
  assert.throws(
    () => validateProxyRigComparisonLiveState({
      manifest,
      candidateId: candidate.id,
      expectedPackageId,
      liveState: {
        ...liveState,
        source: { comparisonCandidate: { id: 'sf3d-skin-baseline' } },
      },
    }),
    /embedded candidate/i,
  );
  assert.throws(
    () => validateProxyRigComparisonLiveState({
      manifest,
      candidateId: candidate.id,
      expectedPackageId,
      liveState: { ...liveState, packageId: `sha256:${'b'.repeat(64)}` },
    }),
    /package identity/i,
  );
});

test('comparison packages express every candidate cast in the frozen envelope frame', async () => {
  const manifest = validateProxyRigComparisonManifest(JSON.parse(
    await readFile(manifestUrl, 'utf8'),
  ));
  const candidate = resolveProxyRigComparisonCandidate(manifest, 'trellis-skin-80413');
  const [rawCast, rawEnvelope, receipt, packageData] = await Promise.all([
    readFile(new URL(`../${candidate.cast}`, import.meta.url)).then(parseGlbGeometry),
    readFile(new URL('../artifacts/cast-correspondence-v0/frozen/envelope-baseline.glb', import.meta.url)).then(parseGlbGeometry),
    readFile(new URL(`../${candidate.registrationReceipt}`, import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL(`../${candidate.package}`, import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const transform = receipt.registration.transform;
  const target = Array.from(rawCast.positions.slice(0, 3));
  const centered = target.map((value, index) => value - transform.translation[index]);
  const expectedCanonical = [0, 1, 2].map(column => (
    transform.rotation[0][column] * centered[0]
      + transform.rotation[1][column] * centered[1]
      + transform.rotation[2][column] * centered[2]
  ) / transform.scale);

  assert.deepEqual(packageData.source.comparisonFrame, {
    frame: 'frozen-envelope-baseline',
    operation: 'inverse-cast-registration',
    registrationReceipt: candidate.registrationReceipt,
  });
  expectedCanonical.forEach((value, index) => {
    assert.ok(Math.abs(packageData.cast.positions[index] - value) < 1e-8);
  });
  Array.from(rawEnvelope.positions.slice(0, 3)).forEach((value, index) => {
    assert.ok(Math.abs(packageData.envelope.positions[index] - value) < 1e-8);
  });
});

test('package builder rejects an unknown comparison candidate without baseline fallback', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'proxy-rig-comparison-'));
  try {
    const output = join(outputDir, 'absent.proxy-rig.json');
    const result = spawnSync(process.execPath, [
      'tools/build-proxy-rig-package.mjs',
      '--candidate-manifest',
      'artifacts/cast-correspondence-v0/cast-topology-comparison.json',
      '--candidate-id',
      'absent-candidate',
      '--output',
      output,
    ], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'unknown candidate must not build the SF3D baseline');
    assert.match(result.stderr, /unknown comparison candidate absent-candidate/i);
    await assert.rejects(readFile(output), /ENOENT/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
