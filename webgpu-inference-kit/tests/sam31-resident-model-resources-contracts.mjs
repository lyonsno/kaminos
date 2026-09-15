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

const artifactABytes = new Uint8Array(new Float32Array([0, 1, 2, 3, 4]).buffer);
const artifactBBytes = new Uint8Array(new Float32Array([5, 6]).buffer);
const artifactA = {
  file: 'static/a.bin',
  sha256: await sha256(artifactABytes),
  byteLength: artifactABytes.byteLength,
  aliases: [
    { packetName: 'ingress', kind: 'weight', role: 'patch-embed-projection-weight' },
    { packetName: 'ingress', kind: 'weight', role: 'vit-position-embeddings' },
    { packetName: 'ingress', kind: 'weight', role: 'vit-block-stack-layer0-q-proj-weight', file: 'static/a-alias.bin' },
  ],
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
const acquisitionTrace = [];
const packageRuntime = {
  packageId: 'sam31-tracker-model-package:resident-fixture',
  modelPackage: {
    model: { id: 'facebook/sam3.1', revision: 'fixture-revision' },
    staticArtifacts: [artifactA, artifactB],
  },
  async loadUint8(entry) {
    acquisitionTrace.push(`load:${entry.file}`);
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
      acquisitionTrace.push('upload');
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

let packageLoads = 0;
const resident = await createSam31ResidentModelResources({ packageRuntime, route: {
  ...ownerRoute,
  loadModelResources() { throw new Error('whole-model bundle assembly is forbidden on the SAM serving path'); },
  loadModelResourcePackageFromSources(input) {
    packageLoads += 1;
    return ownerRoute.loadModelResourcePackageFromSources(input);
  },
} });
assert.equal(packageLoads, 1, 'SAM must load its artifacts through the shared sequential package consumer');
assert.deepEqual(acquisitionTrace, ['load:static/a.bin', 'upload', 'load:static/b.bin', 'upload'],
  'later artifact bytes must not be prefetched before the previous artifact reaches residency');
assert.equal(resident.schema, 'kaminos.sam31-resident-model-resources.v0');
assert.equal(resident.packageId, packageRuntime.packageId);
assert.equal(
  resident.resourcePackage.schema,
  'kaminos.webgpu-model-resource-package.v0',
  'the SAM resident owner must compose verified per-artifact manifests through the kit package loader',
);
assert.equal(resident.resourcePackage.resources.length, 2);
for (const resource of resident.resourcePackage.resources) {
  assert.equal(resource.manifest.schema, 'kaminos.webgpu-model-resource-manifest.v1');
  assert.equal(resource.manifest.resourceSharing.policy, 'semantic-identity');
  assert.equal(resource.manifest.allocations.length, 1);
  const allocation = resource.manifest.allocations[0];
  assert.match(allocation.physicalResourceId, /^kaminos:model-resource:sha256:/);
  assert.match(allocation.semanticResourceId, /^kaminos:model-resource:sha256:.*:semantic:/);
  assert.notEqual(allocation.physicalResourceId, allocation.semanticResourceId);
  assert.equal(
    allocation.resourceId,
    allocation.semanticResourceId,
    'default SAM residency must key allocation and single-flight identity by the complete semantic contract',
  );
}
for (const allocation of resident.modelLease.allocations) {
  assert.equal(allocation.resourceSharingPolicy, 'semantic-identity');
  assert.equal(allocation.resourceId, allocation.semanticResourceId);
  assert.match(allocation.semanticLeaseId, /^kaminos:model-resource:sha256:.*:semantic:.*:lease:/);
}
assert.equal(buffers.length, 2, 'every unique authenticated static artifact must allocate exactly once');
assert.equal(writes.length, 2, 'every unique authenticated static artifact must upload exactly once');
assert.equal(resident.evidence().resources.length, 2, 'resident evidence must retain every static artifact without a cap');
assert.equal(resident.evidence().truncated, false);
for (const resource of resident.evidence().resources) {
  assert.equal(resource.resourceSharingPolicy, 'semantic-identity');
  assert.equal(resource.resourceId, resource.semanticResourceId);
  assert.match(resource.physicalResourceId, /^kaminos:model-resource:sha256:/);
  assert.match(resource.semanticResourceId, /^kaminos:model-resource:sha256:.*:semantic:/);
  assert.match(resource.semanticLeaseId, /^kaminos:model-resource:sha256:.*:semantic:.*:lease:/);
}
const packageReport = resident.evidence().packageAcquisition;
assert.equal(Object.hasOwn(packageReport, 'progress'), false,
  'routine serving evidence must not duplicate the full package progress journal');
assert.equal(packageReport.status, 'loaded');
assert.equal(packageReport.sourceMemoryBound.totalPackageByteLength, 28);
assert.equal(packageReport.sourceMemoryBound.largestResourceByteLength, 20,
  'source acquisition must be bounded by the largest actual artifact, not the full model');
assert.equal(packageReport.resourceCount, 2);
assert.strictEqual(resident.acquisitionReport(), resident.modelLease.report, 'the complete uncapped journal remains available without copying');
assert.equal(resident.acquisitionReport().resources.length, 2, 'each artifact retains its own verification report');

const entryA = { ...artifactA, role: 'patch-embed-projection-weight', dtype: 'float32', shape: [1, 5, 1, 1] };
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
  () => resident.bind(entryA, new Float32Array([9, 9, 9, 9, 9])),
  /authenticated backing|source custody|source identity/i,
  'same-length wrong bytes must not acquire an authenticated resident static binding',
);
const firstSource = await resident.loadFloat32(entryA);
const secondSource = await resident.loadFloat32(entryA);
const aliasEntryA = { ...entryA, role: 'vit-block-stack-layer0-q-proj-weight', file: 'static/a-alias.bin' };
const aliasSource = await resident.loadFloat32(aliasEntryA);
const firstBinding = resident.bind(entryA, firstSource);
const secondBinding = resident.bind(entryA, secondSource);
const aliasBinding = resident.bind(aliasEntryA, aliasSource);
assert.equal(firstBinding.buffer, secondBinding.buffer, 'distinct invocation views must resolve to the exact same live GPU object');
assert.equal(firstBinding.buffer, aliasBinding.buffer, 'distinct declared files with the same authenticated bytes must share one resident allocation');
assert.equal(firstBinding.sourceData, firstSource);
assert.equal(secondBinding.sourceData, secondSource);
assert.equal(resident.residentTensorResolver({ sourceData: firstSource }), firstBinding);
assert.equal(resident.residentTensorResolver({ sourceData: secondSource }), secondBinding);
assert.equal(resident.residentTensorResolver({ sourceData: aliasSource }), aliasBinding);
assert.equal(resident.evidence().bindingCount, 3);

const logicalMatrixBinding = resident.residentTensorResolver({
  name: 'sam31.high-resolution.s0.weight',
  sourceData: firstSource,
  dtype: 'f32',
  shape: [1, 5],
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
});
assert.notEqual(logicalMatrixBinding, firstBinding, 'a logical reshape must receive a binding carrying the module-owned shape');
assert.equal(logicalMatrixBinding.buffer, firstBinding.buffer, 'a logical reshape must preserve the exact resident GPU object');
assert.equal(logicalMatrixBinding.sourceData, firstSource, 'a logical reshape must preserve authenticated source identity');
assert.deepEqual(logicalMatrixBinding.shape, [1, 5]);
assert.equal(logicalMatrixBinding.byteLength, firstBinding.byteLength);
assert.throws(
  () => resident.residentTensorResolver({
    name: 'sam31.high-resolution.s0.weight',
    sourceData: firstSource,
    dtype: 'u32',
    shape: [1, 5],
  }),
  /dtype|reinterpret/i,
  'a logical reshape must not reinterpret the authenticated resident dtype',
);
assert.throws(
  () => resident.residentTensorResolver({
    name: 'sam31.high-resolution.s0.weight',
    sourceData: firstSource,
    dtype: 'f32',
    shape: [1, 4],
  }),
  /logical shape|byte length|element count/i,
  'a logical resident view must not claim a shape whose element count disagrees with its authenticated bytes',
);

const wrongClsSubview = firstSource.subarray(0, 4);
assert.throws(
  () => resident.residentTensorResolver({
    name: 'sam3.image-vit-prefix.position-embeddings',
    sourceData: wrongClsSubview,
    dtype: 'f32',
    shape: [1, 4, 1],
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
  }),
  /semantic partial view|CLS|position subview/i,
  'an aligned or in-range window must not include CLS and omit the final spatial position',
);
const authenticatedSubview = firstSource.subarray(1);
const subviewBinding = resident.residentTensorResolver({
  name: 'sam3.image-vit-prefix.position-embeddings',
  sourceData: authenticatedSubview,
  dtype: 'f32',
  shape: [1, 4, 1],
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
});
assert.equal(subviewBinding.buffer, firstBinding.buffer, 'an authenticated package subview must retain the parent live GPU object');
assert.equal(subviewBinding.bufferOffset, 4, 'an authenticated package subview must bind the exact byte offset');
assert.equal(subviewBinding.byteLength, authenticatedSubview.byteLength);
assert.equal(subviewBinding.sourceData, authenticatedSubview);
assert.equal(resident.evidence().bindingCount, 5, 'logical reshapes and authenticated subviews must each remain visible in evidence');

assert.throws(
  () => resident.bind({ ...entryA, sha256: `sha256:${'0'.repeat(64)}` }, new Float32Array(4)),
  /not resident|unknown static artifact/i,
);
assert.throws(
  () => resident.bind(entryA, new Float32Array(4)),
  /byte length mismatch/i,
);

const release = resident.release();
const borrowedModel = await kit.createSam3BrowserResidentModelSession({
  packageRuntime,
  executionContext: { adapter: { info: { description: 'fixture-adapter' } }, device, inferenceSession: session },
});
const modelJob = borrowedModel.enqueue({ jobId: 'shared-session-sam', execute: async () => new Float32Array([7, 9]) });
const completion = await modelJob.completion;
assert.equal(completion.status, 'succeeded');
assert.deepEqual(completion.output, new Float32Array([7, 9]));
borrowedModel.forgetJob(modelJob.jobId);
await borrowedModel.close();
assert.equal(session.snapshot().status, 'active', 'public SAM factory must leave the application session usable');
assert.equal(buffers.some(buffer => buffer.destroyCount !== 0), false);

const corruptedPackage = {
  ...packageRuntime,
  modelPackage: { ...packageRuntime.modelPackage, model: { id: 'facebook/sam3.1', revision: 'corrupted-input-probe' } },
  async loadUint8(entry) {
    const bytes = await packageRuntime.loadUint8(entry);
    if (entry.file === 'static/b.bin') bytes[0] ^= 1;
    return bytes;
  },
};
await assert.rejects(() => createSam31ResidentModelResources({ packageRuntime: corruptedPackage, route: ownerRoute }), error => {
  assert.equal(error.packageReport.status, 'failed');
  assert.equal(error.packageReport.resources.length, 1, 'first child completed before second child failed verification');
  assert.equal(error.packageReport.cleanup.status, 'released');
  return /sha-?256|digest|hash/i.test(error.message);
}, 'corrupted package child must not become resident or strand prior child leases');
assert.equal(release.status, 'released');
assert.equal(resident.release().status, 'already-released');
assert.equal(session.snapshot().residency.activeLeaseCount, 0);
session.close();
assert.ok(buffers.every(buffer => buffer.destroyCount === 1), 'session close must destroy managed resident buffers exactly once');

console.log('sam3.1 resident model resource contracts passed');
