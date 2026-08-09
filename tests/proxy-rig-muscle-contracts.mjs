import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import * as core from '../proxy-rig-core.mjs';
import * as runtime from '../proxy-rig-runtime.mjs';

function registeredSourceFixture() {
  const content = {
    schema: 'kaminos.proxy-rig-muscle-source.v0',
    relationId: 'muscle-31',
    historicalRef: 'fixture-commit:path/to/source-fixture.json',
    sourceArtifactSha256: '1'.repeat(64),
    source: {
      assetSha256: '2'.repeat(64),
      routingFixtureSha256: '3'.repeat(64),
      surfaceGeometrySha256: '4'.repeat(64),
    },
    selection: { supportFamily: ['Cube.002', 'Cube.003'] },
    hinge: { pivotWorld: [1, 2, 3] },
    positions: [1, 2, 3, 2, 2, 3, 3, 2, 3],
    triangles: [0, 1, 2],
    sectionIndices: [0, 1, 2],
    sectionCount: 3,
  };
  const fixtureId = `sha256:${createHash('sha256')
    .update(runtime.canonicalProxyRigJson(content)).digest('hex')}`;
  return { ...content, fixtureId };
}

test('M31 source registration precedes the skeleton-to-cast chain and is mandatory', () => {
  const sourceFixture = registeredSourceFixture();
  const registrationContent = {
    schema: 'kaminos.m31-source-registration-receipt.v0',
    inputs: {
      sourceBlendSha256: sourceFixture.source.assetSha256,
      supports: ['Cube.002', 'Cube.003'],
    },
    residual: { rms: 0.1, max: 0.2 },
    transform: {
      scale: 2,
      rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      translation: [10, 0, 0],
    },
  };
  const sourceRegistration = {
    ...registrationContent,
    receiptSha256: `sha256:${createHash('sha256')
      .update(runtime.canonicalProxyRigJson(registrationContent)).digest('hex')}`,
  };
  const overlay = core.createM31LiveOverlay({
    sourceFixture,
    sourceRegistration,
    chainTransforms: [{
      scale: 0.5,
      rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      translation: [0, 5, 0],
    }],
  });
  assert.deepEqual(Array.from(overlay.muscle.positions.slice(0, 3)), [6, 7, 3]);
  assert.equal(
    overlay.supportRefinement,
    undefined,
    'a muscle relation must not manufacture or own a skeletal transform control',
  );
  assert.equal(overlay.muscle.source.registrationReceiptSha256, sourceRegistration.receiptSha256);
  assert.throws(
    () => core.createM31LiveOverlay({ sourceFixture, chainTransforms: [] }),
    /M31 source registration receipt is required/i,
  );
});

function musclePackage() {
  return {
    schema: runtime.PROXY_RIG_PACKAGE_SCHEMA,
    runtimeSchema: runtime.PROXY_RIG_RUNTIME_SCHEMA,
    packageId: 'sha256:muscle-fixture',
    source: { cast: 'fixture://cast', envelope: 'fixture://envelope', skeleton: 'fixture://skeleton' },
    envelope: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] },
    cast: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] },
    skinBinding: {
      groups: [
        { name: 'fixed', pivot: [0, 0, 0], parent: null, sourceBones: ['Cube.002'] },
        { name: 'moving', pivot: [1, 0, 0], parent: 'fixed', sourceBones: ['Cube.003'] },
      ],
      neighbors: 1,
      weightGroups: [0, 1, 1],
      weightValues: [1, 1, 1],
    },
    castBinding: { triangle: [0, 0, 0], local: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
    muscles: [{
      schema: 'kaminos.proxy-rig-muscle.v0',
      relationId: 'muscle-31',
      requestedRoute: 'authenticated-m31-two-support-live-overlay',
      effectiveRoute: 'authenticated-m31-two-support-live-overlay',
      fallbackUsed: false,
      source: {
        historicalRef: 'fixture-commit:path/to/source-fixture.json',
        sourceArtifactSha256: '1'.repeat(64),
        surfaceGeometrySha256: '2'.repeat(64),
        registrationReceiptSha256: `sha256:${'3'.repeat(64)}`,
      },
      supportMapping: {
        fixed: 'fixed', moving: 'moving', fixedSource: 'Cube.002', movingSource: 'Cube.003',
      },
      positions: [
        0, -0.1, 0, 0, 0.1, 0,
        0.7, -0.1, 0, 0.7, 0.1, 0,
        1.3, -0.1, 0, 1.3, 0.1, 0,
        2, -0.1, 0, 2, 0.1, 0,
      ],
      triangles: [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5, 5, 6, 7],
      sectionIndices: [0, 0, 1, 1, 2, 2, 3, 3],
      sectionCount: 4,
      originCapLastSection: 0,
      insertionCapFirstSection: 3,
    }],
  };
}

function rotateZ90(point, pivot = [1, 0, 0]) {
  const x = point[0] - pivot[0];
  const y = point[1] - pivot[1];
  return [pivot[0] - y, pivot[1] + x, point[2]];
}

function vertex(positions, index) {
  return Array.from(positions.slice(index * 3, index * 3 + 3));
}

test('live evaluator transports one authenticated muscle through its exact support hierarchy', () => {
  const evaluator = runtime.createProxyRigEvaluator(musclePackage(), { smooth: false });
  assert.equal(evaluator.muscles.length, 1);
  assert.equal(evaluator.muscles[0].relationId, 'muscle-31');
  assert.equal(evaluator.muscles[0].effectiveRoute, 'authenticated-m31-two-support-live-overlay');

  const halfAngle = Math.PI / 4;
  const result = evaluator.evaluate({
    moving: { quaternion: [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)] },
  });
  assert.equal(result.muscles.length, 1);
  assert.notDeepEqual(
    Array.from(result.positions),
    musclePackage().cast.positions,
    'the moving skeletal support must drive the cast as well as the muscle',
  );
  const posed = result.muscles[0];

  assert.deepEqual(vertex(posed.positions, 0), [0, -0.1, 0], 'origin cap follows fixed support exactly');
  const expectedInsertion = rotateZ90([2, -0.1, 0]);
  vertex(posed.positions, 6).forEach((value, axis) => {
    assert.ok(Math.abs(value - expectedInsertion[axis]) < 1e-12, 'insertion cap follows moving support exactly');
  });

  const interior = vertex(posed.positions, 2);
  const fixedInterior = [0.7, -0.1, 0];
  const movingInterior = rotateZ90(fixedInterior);
  assert.notDeepEqual(interior, fixedInterior, 'belly must not rigidly follow the fixed support');
  assert.notDeepEqual(interior, movingInterior, 'belly must not rigidly follow the moving support');
  assert.ok(interior.every(Number.isFinite));

  assert.throws(
    () => evaluator.evaluate({
      'muscle-31': { quaternion: [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)] },
    }),
    /unknown pose control muscle-31/i,
    'a relation id must never become an independently poseable transform target',
  );
});

test('muscle support identity and route degradation fail before live evaluation', () => {
  const missingSupport = musclePackage();
  missingSupport.muscles[0].supportMapping.moving = 'not-a-control';
  assert.throws(() => runtime.createProxyRigEvaluator(missingSupport), /muscle-31.*moving support.*missing/i);

  const fallback = musclePackage();
  fallback.muscles[0].fallbackUsed = true;
  assert.throws(() => runtime.createProxyRigEvaluator(fallback), /muscle-31.*fallback/i);

  const malformedSections = musclePackage();
  malformedSections.muscles[0].sectionIndices.pop();
  assert.throws(() => runtime.createProxyRigEvaluator(malformedSections), /muscle-31.*section indices/i);

  const relationControlCollision = musclePackage();
  relationControlCollision.skinBinding.groups[1].name = 'muscle-31';
  relationControlCollision.muscles[0].supportMapping.moving = 'muscle-31';
  assert.throws(
    () => runtime.createProxyRigEvaluator(relationControlCollision),
    /muscle-31.*cannot also be a skeletal control/i,
    'relation identity must remain disjoint from every selectable skeletal control',
  );
});

test('pose-run replay drives cast and muscle under the same package identity', () => {
  const pkg = musclePackage();
  const evaluator = runtime.createProxyRigEvaluator(pkg, { smooth: false });
  const run = runtime.createProxyPoseRun({
    packageId: pkg.packageId,
    frames: [
      { tMs: 0, pose: { moving: { quaternion: [0, 0, 0, 1] } } },
      { tMs: 100, pose: { moving: { quaternion: [0, 0, 1, 0] } } },
    ],
  });
  const sampled = runtime.sampleProxyPoseRun(run, 50, {
    expectedPackageId: pkg.packageId,
    knownControls: evaluator.groups.map(group => group.name),
  });
  const first = evaluator.evaluate(sampled);
  const second = evaluator.evaluate(sampled);
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(Array.from(first.muscles[0].positions), Array.from(second.muscles[0].positions));
  assert.equal(first.muscles[0].packageId, pkg.packageId);

  const relationOwnedRun = runtime.createProxyPoseRun({
    packageId: pkg.packageId,
    frames: [{ tMs: 0, pose: { 'muscle-31': { quaternion: [0, 0, 0, 1] } } }],
  });
  assert.throws(
    () => runtime.sampleProxyPoseRun(relationOwnedRun, 0, {
      expectedPackageId: pkg.packageId,
      knownControls: evaluator.groups.map(group => group.name),
    }),
    /unknown pose control muscle-31/i,
    'persisted pose runs must not silently drop a relation-owned key before evaluation',
  );
});
