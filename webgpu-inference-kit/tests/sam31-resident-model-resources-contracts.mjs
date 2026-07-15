import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(typeof kit.createSam31ResidentModelResources, 'function');

const {
  createSam31ResidentModelResources,
  createWebGpuInferenceSession,
  WEBGPU_BUFFER_USAGE,
} = kit;

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

const artifactABytes = new Uint8Array(new Float32Array([1, 2, 3, 4]).buffer);
const artifactBBytes = new Uint8Array(new Float32Array([5, 6]).buffer);
const artifactA = {
  file: 'static/a.bin',
  sha256: await sha256(artifactABytes),
  byteLength: artifactABytes.byteLength,
  aliases: [{ packetName: 'ingress', kind: 'weight', role: 'patch-embed-projection-weight' }],
};
const artifactB = {
  file: 'static/b.bin',
  sha256: await sha256(artifactBBytes),
  byteLength: artifactBBytes.byteLength,
  aliases: [{ packetName: 'temporal', kind: 'weight', role: 'pointer-position-projection-bias' }],
};
const bytesBySha = new Map([
  [artifactA.sha256, artifactABytes],
  [artifactB.sha256, artifactBBytes],
]);
const packageRuntime = {
  packageId: 'sam31-tracker-model-package:resident-fixture',
  modelPackage: {
    model: { id: 'facebook/sam3.1', revision: 'fixture-revision' },
    staticArtifacts: [artifactA, artifactB],
  },
  async loadUint8(entry) {
    const bytes = bytesBySha.get(entry.sha256);
    if (!bytes) throw new Error(`unknown fixture artifact ${entry.sha256}`);
    return bytes.slice();
  },
  async loadFloat32(entry) {
    const bytes = bytesBySha.get(entry.sha256);
    if (!bytes) throw new Error(`unknown fixture artifact ${entry.sha256}`);
    return new Float32Array(bytes.slice().buffer);
  },
};

const lost = deferred();
const buffers = [];
const writes = [];
const device = {
  queue: {
    writeBuffer(buffer, offset, data) {
      writes.push({ buffer, offset, bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() });
    },
  },
  features: new Set(),
  limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 29 },
  lost: lost.promise,
  createBuffer(descriptor) {
    const buffer = {
      descriptor,
      destroyCount: 0,
      destroy() { this.destroyCount += 1; },
    };
    buffers.push(buffer);
    return buffer;
  },
};
const session = await createWebGpuInferenceSession({
  sessionId: 'sam31-resident-contract',
  device,
  adapterName: 'resident-contract-adapter',
});
const ownerRoute = await session.registerRoute({
  routeId: 'sam31.resident-model-owner.webgpu-local.v0',
  runtimeOptions: {
    runtimeLabel: 'sam31-resident-model-owner',
    kernel: { profile: 'sam31-resident-model-owner-v0' },
    requiredStages: [],
  },
});

const resident = await createSam31ResidentModelResources({ packageRuntime, route: ownerRoute });
assert.equal(resident.schema, 'kaminos.sam31-resident-model-resources.v0');
assert.equal(resident.packageId, packageRuntime.packageId);
assert.equal(resident.manifest.allocations.length, 2);
assert.equal(buffers.length, 2, 'every unique authenticated static artifact must allocate exactly once');
assert.equal(writes.length, 2, 'every unique authenticated static artifact must upload exactly once');
assert.equal(resident.evidence().resources.length, 2, 'resident evidence must retain every static artifact without a cap');
assert.equal(resident.evidence().truncated, false);
assert.equal(
  resident.evidence().bundleVerification.byteCustody,
  'loader-owned-transfer-before-verification',
  'the assembled full model bundle must transfer custody instead of retaining a second full-size loader copy',
);

const entryA = { ...artifactA, role: 'patch-embed-projection-weight', dtype: 'float32', shape: [1, 4, 1, 1] };
const fakeFileEntry = { ...entryA, file: 'invocation/fake-equal-bytes.bin' };
assert.throws(
  () => resident.loadFloat32(fakeFileEntry),
  /declared static artifact|semantic membership|alias/i,
  'same-SHA bytes from a fabricated file must not receive a resident-owned source view',
);
assert.throws(
  () => resident.bind(fakeFileEntry, new Float32Array(artifactABytes.buffer)),
  /declared static artifact|semantic membership|alias/i,
  'same-SHA bytes from a fabricated file must not bind as model-owned residency',
);
assert.throws(
  () => resident.loadFloat32({ ...entryA, role: 'invocation-owned-equal-bytes' }),
  /declared static artifact|semantic membership|alias/i,
  'a fabricated same-byte role must not impersonate a declared model alias',
);
assert.throws(
  () => resident.loadFloat32({ ...entryA, packetName: 'pointer' }),
  /declared static artifact|semantic membership|alias/i,
  'an explicit packet identity must agree with the authenticated alias declaration',
);
const persistentBackingReload = await packageRuntime.loadFloat32(entryA);
assert.throws(
  () => resident.bind(entryA, persistentBackingReload),
  /authenticated backing|source custody|source identity/i,
  'a fresh hash-verified persistent-backing copy must not impersonate the resident authenticated source',
);
assert.throws(
  () => resident.bind(entryA, new Float32Array([9, 9, 9, 9])),
  /authenticated backing|source custody|source identity/i,
  'same-length wrong bytes must not acquire an authenticated resident static binding',
);
const firstSource = await resident.loadFloat32(entryA);
const secondSource = await resident.loadFloat32(entryA);
const firstBinding = resident.bind(entryA, firstSource);
const secondBinding = resident.bind(entryA, secondSource);
assert.equal(firstBinding.buffer, secondBinding.buffer, 'distinct invocation views must resolve to the exact same live GPU object');
assert.equal(firstBinding.sourceData, firstSource);
assert.equal(secondBinding.sourceData, secondSource);
assert.equal(resident.residentTensorResolver({ sourceData: firstSource }), firstBinding);
assert.equal(resident.residentTensorResolver({ sourceData: secondSource }), secondBinding);
assert.equal(resident.evidence().bindingCount, 2);

const logicalMatrixBinding = resident.residentTensorResolver({
  name: 'sam31.high-resolution.s0.weight',
  sourceData: firstSource,
  dtype: 'f32',
  shape: [1, 4],
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
});
assert.notEqual(logicalMatrixBinding, firstBinding, 'a logical reshape must receive a binding carrying the module-owned shape');
assert.equal(logicalMatrixBinding.buffer, firstBinding.buffer, 'a logical reshape must preserve the exact resident GPU object');
assert.equal(logicalMatrixBinding.sourceData, firstSource, 'a logical reshape must preserve authenticated source identity');
assert.deepEqual(logicalMatrixBinding.shape, [1, 4]);
assert.equal(logicalMatrixBinding.byteLength, firstBinding.byteLength);
assert.throws(
  () => resident.residentTensorResolver({
    name: 'sam31.high-resolution.s0.weight',
    sourceData: firstSource,
    dtype: 'f32',
    shape: [1, 3],
  }),
  /logical shape|byte length|element count/i,
  'a logical resident view must not claim a shape whose element count disagrees with its authenticated bytes',
);

const authenticatedSubview = firstSource.subarray(1);
const subviewBinding = resident.residentTensorResolver({
  name: 'sam31.absolute-position.without-cls',
  sourceData: authenticatedSubview,
  dtype: 'f32',
  shape: [3],
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
});
assert.equal(subviewBinding.buffer, firstBinding.buffer, 'an authenticated package subview must retain the parent live GPU object');
assert.equal(subviewBinding.bufferOffset, 4, 'an authenticated package subview must bind the exact byte offset');
assert.equal(subviewBinding.byteLength, authenticatedSubview.byteLength);
assert.equal(subviewBinding.sourceData, authenticatedSubview);
assert.equal(resident.evidence().bindingCount, 4, 'logical reshapes and authenticated subviews must each remain visible in evidence');

assert.throws(
  () => resident.bind({ ...entryA, sha256: `sha256:${'0'.repeat(64)}` }, new Float32Array(4)),
  /not resident|unknown static artifact/i,
);
assert.throws(
  () => resident.bind(entryA, new Float32Array(3)),
  /byte length mismatch/i,
);

const release = resident.release();
assert.equal(release.status, 'released');
assert.equal(resident.release().status, 'already-released');
assert.equal(session.snapshot().residency.activeLeaseCount, 0);
session.close();
assert.deepEqual(buffers.map(buffer => buffer.destroyCount), [1, 1], 'session close must destroy managed resident buffers exactly once');

console.log('sam3.1 resident model resource contracts passed');
