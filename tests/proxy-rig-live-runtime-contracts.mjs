import assert from 'node:assert/strict';
import test from 'node:test';

import * as runtime from '../proxy-rig-runtime.mjs';
import {
  proxyRigRenderIdentity,
  restoreProxyPoseRunFromStorage,
} from '../proxy-rig-live-host.mjs';
import * as liveHost from '../proxy-rig-live-host.mjs';

function toyPackage(overrides = {}) {
  return {
    schema: 'kaminos.proxy-rig-package.v0',
    runtimeSchema: runtime.PROXY_RIG_RUNTIME_SCHEMA,
    packageId: 'sha256:toy-proxy-rig',
    source: {
      cast: 'fixture://cast',
      envelope: 'fixture://envelope',
      skeleton: 'fixture://skeleton',
    },
    envelope: {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      triangles: [0, 1, 2],
    },
    cast: {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      triangles: [0, 1, 2],
    },
    skinBinding: {
      groups: [{ name: 'arm', pivot: [0, 0, 0] }],
      neighbors: 1,
      weightGroups: [0, 0, 0],
      weightValues: [1, 1, 1],
    },
    castBinding: {
      triangle: [0, 0, 0],
      local: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    },
    ...overrides,
  };
}

test('live evaluator accepts control quaternions and preserves exact identity', () => {
  assert.equal(typeof runtime.createProxyRigEvaluator, 'function');
  const evaluator = runtime.createProxyRigEvaluator(toyPackage(), {
    expectedPackageId: 'sha256:toy-proxy-rig',
    smooth: false,
  });
  const identity = evaluator.evaluate({});
  assert.deepEqual(Array.from(identity.positions), toyPackage().cast.positions);

  const halfAngle = Math.PI / 4;
  const posed = evaluator.evaluate({
    arm: { quaternion: [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)] },
  });
  assert.ok(Math.abs(posed.positions[3]) < 1e-12);
  assert.ok(Math.abs(posed.positions[4] - 1) < 1e-12);
});

test('live evaluator fails loud on stale runtime identity and requested-package mismatch', () => {
  assert.equal(typeof runtime.createProxyRigEvaluator, 'function');
  assert.throws(
    () => runtime.createProxyRigEvaluator(toyPackage({ runtimeSchema: 'kaminos.proxy-rig-runtime.stale' })),
    /runtime schema/i,
  );
  assert.throws(
    () => runtime.createProxyRigEvaluator(toyPackage(), { expectedPackageId: 'sha256:not-this-package' }),
    /package id/i,
  );
});

test('pose runs preserve package identity and interpolate replay quaternions', () => {
  assert.equal(typeof runtime.createProxyPoseRun, 'function');
  assert.equal(typeof runtime.sampleProxyPoseRun, 'function');
  const run = runtime.createProxyPoseRun({
    packageId: 'sha256:toy-proxy-rig',
    frames: [
      { tMs: 0, pose: { arm: { quaternion: [0, 0, 0, 1] } } },
      { tMs: 1000, pose: { arm: { quaternion: [0, 0, 1, 0] } } },
    ],
  });
  const midpoint = runtime.sampleProxyPoseRun(run, 500, {
    expectedPackageId: 'sha256:toy-proxy-rig',
  });
  assert.ok(Math.abs(midpoint.arm.quaternion[2] - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(midpoint.arm.quaternion[3] - Math.SQRT1_2) < 1e-12);
  assert.throws(
    () => runtime.sampleProxyPoseRun(run, 0, { expectedPackageId: 'sha256:stale' }),
    /package id/i,
  );
});

test('malformed package arrays cannot masquerade as a live rig', () => {
  assert.equal(typeof runtime.createProxyRigEvaluator, 'function');
  const malformed = toyPackage({
    castBinding: { triangle: [0], local: [0, 0, 0] },
  });
  assert.throws(() => runtime.createProxyRigEvaluator(malformed), /cast binding/i);
});

test('skin weights must be nonnegative and normalized per envelope vertex', () => {
  const malformedWeights = [
    { label: 'zero', values: [0, 0, 0], pattern: /sum to one/i },
    { label: 'negative', values: [-0.25, 1, 1], pattern: /nonnegative/i },
    { label: 'unnormalized', values: [0.5, 1, 1], pattern: /sum to one/i },
  ];
  for (const { label, values, pattern } of malformedWeights) {
    const malformed = toyPackage();
    malformed.skinBinding.weightValues = values;
    assert.throws(
      () => runtime.createProxyRigEvaluator(malformed),
      pattern,
      `${label} skin weights must not activate a live rig`,
    );
  }
});

test('control hierarchy rejects missing parents and cycles before the rig goes live', () => {
  const missingParent = toyPackage();
  missingParent.skinBinding.groups[0].parent = 'missing';
  assert.throws(
    () => runtime.createProxyRigEvaluator(missingParent),
    /parent missing/i,
  );

  const cyclic = toyPackage();
  cyclic.skinBinding.groups = [
    { name: 'a', pivot: [0, 0, 0], parent: 'b' },
    { name: 'b', pivot: [1, 0, 0], parent: 'a' },
  ];
  assert.throws(
    () => runtime.createProxyRigEvaluator(cyclic),
    /cycle/i,
  );
});

test('package arrays reject coercible JSON values rather than silently changing geometry', () => {
  for (const value of [null, '1', '']) {
    const malformed = toyPackage({
      cast: {
        positions: [value, 0, 0, 1, 0, 0, 0, 1, 0],
        triangles: [0, 1, 2],
      },
    });
    assert.throws(
      () => runtime.createProxyRigEvaluator(malformed),
      /cast positions\[0\] must be finite/i,
    );
  }
});

test('browser-safe package identity verification rejects retained hashes after content mutation', async () => {
  assert.equal(typeof runtime.computeProxyRigPackageId, 'function');
  assert.equal(typeof runtime.verifyProxyRigPackageIdentity, 'function');
  const pkg = toyPackage();
  pkg.packageId = await runtime.computeProxyRigPackageId(pkg);
  assert.equal(await runtime.verifyProxyRigPackageIdentity(pkg), pkg.packageId);

  pkg.cast.positions[0] = 0.25;
  await assert.rejects(
    runtime.verifyProxyRigPackageIdentity(pkg),
    /package id .* does not match content/i,
  );
});

test('sampling rejects persisted pose runs whose frame times are not monotonic', () => {
  const malformed = {
    schema: runtime.PROXY_POSE_RUN_SCHEMA,
    packageId: 'sha256:toy-proxy-rig',
    frames: [
      { tMs: 0, pose: {} },
      { tMs: 100, pose: {} },
      { tMs: 50, pose: {} },
    ],
  };
  assert.throws(() => runtime.sampleProxyPoseRun(malformed, 75), /frame times must be monotonic/i);
});

test('denied local storage degrades to an in-memory assay without escaping purge errors', () => {
  const storage = {
    getItem() { throw new DOMException('storage read denied', 'SecurityError'); },
    removeItem() { throw new DOMException('storage purge denied', 'SecurityError'); },
  };
  const restored = restoreProxyPoseRunFromStorage({
    storage,
    key: 'pose-run',
    packageId: 'sha256:toy-proxy-rig',
  });
  assert.equal(restored.poseRun, null);
  assert.match(restored.storageError, /storage read denied/i);
});

test('render identity reports the effective Three revision and renderer backend', () => {
  class WebGPUBackend {}
  assert.deepEqual(
    proxyRigRenderIdentity({ REVISION: '185dev' }, { backend: new WebGPUBackend() }),
    {
      renderBackend: 'WebGPUBackend',
      renderKernel: 'three-r185dev-webgpu-render-pipeline',
    },
  );
});

test('control visibility reaches the TransformControls scene helper', () => {
  assert.equal(typeof liveHost.setProxyRigControlVisibility, 'function');
  const controls = [{ visible: true }, { visible: true }];
  const helper = { visible: true };
  const transformControls = {
    object: {},
    visible: true,
    getHelper: () => helper,
  };

  liveHost.setProxyRigControlVisibility(controls, transformControls, false);
  assert.deepEqual(controls.map(control => control.visible), [false, false]);
  assert.equal(transformControls.visible, false);
  assert.equal(helper.visible, false);

  liveHost.setProxyRigControlVisibility(controls, transformControls, true);
  assert.deepEqual(controls.map(control => control.visible), [true, true]);
  assert.equal(transformControls.visible, true);
  assert.equal(helper.visible, true);
});

test('attaching a selected control preserves hidden witness isolation', () => {
  assert.equal(typeof liveHost.attachProxyRigTransformControl, 'function');
  const controls = [{ visible: false }];
  const helper = { visible: false };
  const transformControls = {
    object: null,
    visible: false,
    detached: false,
    mode: null,
    getHelper: () => helper,
    detach() { this.object = null; this.detached = true; helper.visible = false; },
    attach(control) { this.object = control; helper.visible = true; },
    setMode(mode) { this.mode = mode; },
  };

  liveHost.attachProxyRigTransformControl(controls, transformControls, controls[0], false);
  assert.equal(transformControls.detached, true);
  assert.equal(transformControls.object, controls[0]);
  assert.equal(transformControls.mode, 'rotate');
  assert.equal(transformControls.visible, false);
  assert.equal(helper.visible, false);
  assert.equal(controls[0].visible, false);
});

test('friendly labels are visible and identity-preserving for every nonblank accepted control name', () => {
  const invisibleName = '\u200B';
  const pkg = toyPackage();
  pkg.skinBinding.groups = [{ name: invisibleName, pivot: [0, 0, 0] }];
  assert.doesNotThrow(() => runtime.createProxyRigEvaluator(pkg));

  assert.equal(typeof liveHost.proxyRigControlOptionDescriptor, 'function');
  assert.deepEqual(liveHost.proxyRigControlOptionDescriptor('arm--tip'), {
    value: 'arm--tip',
    title: 'arm--tip',
    label: 'Arm Tip',
  });
  assert.equal(liveHost.proxyRigControlOptionDescriptor('-arm-').label, 'Arm');
  assert.equal(liveHost.proxyRigControlOptionDescriptor('-').label, '-');
  assert.equal(liveHost.proxyRigControlOptionDescriptor('--').label, '--');
  assert.equal(liveHost.proxyRigControlOptionDescriptor(' - ').label, '-');

  const invisible = liveHost.proxyRigControlOptionDescriptor(invisibleName);
  assert.equal(invisible.value, invisibleName);
  assert.equal(invisible.title, invisibleName);
  assert.match(invisible.label, /[^\p{Z}\p{Cc}\p{Cf}]/u);
});
