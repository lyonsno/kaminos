import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-patch-embed-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');
const encoderExporter = readFileSync(new URL('../tools/sam-detr-encoder-mlx-packet.py', import.meta.url), 'utf8');

assert.match(packageJson.scripts.test, /sam-image-patch-embed-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image patch-embed ingress contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image patch-embed route source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID/, 'image patch-embed route must export stable route identity');
assert.match(routeSource, /sam3\.image-patch-embed\.phase-program\.webgpu-local\.v0/, 'image patch-embed route must name the WebGPU-local route id');
assert.match(routeSource, /defineProgram/, 'image patch-embed route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image patch-embed route must execute through runProgram');
assert.match(routeSource, /patch-conv2d-stride/, 'image patch-embed route must expose stride patch-conv phase metadata');
assert.match(routeSource, /readback-patch-embeddings/, 'image patch-embed route must expose readback identity for ingress parity');
assert.match(routeSource, /out,kH,kW,in/, 'image patch-embed route must document SAM3 MLX Conv2d weight layout');

assert.match(encoderExporter, /patch_embeddings/, 'DETR encoder reference export must expose patch embeddings before ViT layer execution');
assert.match(stackExporter, /expected-patch-embeddings/, 'detector-stack packet must export expected SAM3 patch embeddings');
assert.match(stackExporter, /patch-embed-projection-weight/, 'detector-stack packet must export SAM3 patch projection weights');
assert.match(stackExporter, /imagePatchEmbed/, 'detector-stack packet must identify the image patch-embed ingress boundary');
assert.match(stackExporter, /mlx-detector-stack-patch-embed-export/, 'detector-stack packet must expose the patch-embed ingress mode');

assert.match(witness, /mlx-detector-stack-patch-embed-export/, 'witness must allow detector-stack packet mode with browser-local patch embed ingress');
assert.match(witness, /IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image patch-embed route identity');
assert.match(witness, /imagePatchEmbedReport/, 'witness must emit compact imagePatchEmbed report evidence');
assert.match(witness, /patchEmbeddingsMaxAbsDiff/, 'witness must assert patch-embedding parity');
assert.match(witness, /receiptChain\.length !== 7/, 'witness must reject receipt chains that skip image patch-embed ingress');

assert.match(smokeJs, /runSam3ImagePatchEmbedPhaseProgramRoute/, 'browser smoke must execute image patch-embed ingress route');
assert.match(smokeJs, /image-patch-embed-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local patch embed ingress');
assert.match(smokeJs, /imagePatchEmbedEvidence/, 'browser smoke state must preserve image patch-embed evidence');
assert.match(smokeJs, /patchEmbeddingsOutput/, 'browser smoke must preserve patch embeddings output identity as an ingress edge');
assert.match(smokeJs, /patchProjectionWeightSha256/, 'browser smoke must preserve patch projection weight identity');

const {
  WEBGPU_BUFFER_USAGE,
  SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  createRouteInvocationRequest,
  createSam3ImagePatchEmbedDispatchPlan,
  createSam3ImagePatchEmbedPhaseProgramCpuOracle,
  createSam3ImagePatchEmbedPhaseProgramRouteDefinition,
  runSam3ImagePatchEmbedPhaseProgramRoute,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImagePatchEmbedPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-patch-embed-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'pixel-values', 'sam3-image-patch-embed-weights']);
assert.deepEqual(route.requiredOutputRoles, ['patch-embeddings']);
assert.equal(validateRouteDefinition(route).ok, true);

const nativeDispatch = createSam3ImagePatchEmbedDispatchPlan({
  shape: { batch: 1, imageHeight: 1008, imageWidth: 1008, imageChannels: 3, patchSize: 14, patchHeight: 72, patchWidth: 72, hiddenSize: 1024 },
  maxWorkgroupsPerDimension: 65_535,
});
assert.equal(nativeDispatch.patchConv2dStride.logicalInvocations, 5_308_416, 'native patch embedding must preserve its complete logical output domain');
assert.deepEqual(nativeDispatch.patchConv2dStride.dispatch, [288, 288], 'native patch embedding must tile 82,944 workgroups across legal WebGPU dimensions');
assert.ok(nativeDispatch.patchConv2dStride.dispatch.every(count => count <= 65_535), 'every native patch-embedding dispatch dimension must respect the effective device limit');
assert.match(routeSource, /@builtin\(num_workgroups\)\s+dispatch_grid/, 'patch embedding WGSL must receive the multidimensional dispatch grid');
assert.match(routeSource, /gid\.x\s*\+\s*gid\.y\s*\*\s*dispatch_grid\.x\s*\*\s*64u/, 'patch embedding WGSL must reconstruct the uncapped linear invocation index');

const oracle = createSam3ImagePatchEmbedPhaseProgramCpuOracle({
  pixelValues: new Float32Array([
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
    10, 11, 12,
  ]),
  weights: {
    projection: new Float32Array([
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      -1, -1, -1,
      -1, -1, -1,
      -1, -1, -1,
      -1, -1, -1,
    ]),
  },
  shape: { batch: 1, imageHeight: 2, imageWidth: 2, imageChannels: 3, patchSize: 2, patchHeight: 1, patchWidth: 1, hiddenSize: 2 },
});
assert.deepEqual(Array.from(oracle.patchEmbeddings), [78, -78]);

function createResidentRouteDevice() {
  const calls = { buffers: [], writes: [], bindGroups: [] };
  const queue = {
    writeBuffer(buffer, offset, data) {
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      buffer.data.set(bytes, offset);
      calls.writes.push({ buffer, offset, byteLength: bytes.byteLength });
    },
    submit(commandBuffers) {
      for (const commandBuffer of commandBuffers) {
        for (const copy of commandBuffer.copies || []) {
          copy.destination.data.set(copy.source.data.subarray(copy.sourceOffset, copy.sourceOffset + copy.size), copy.destinationOffset);
        }
      }
    },
    async onSubmittedWorkDone() {},
  };
  const device = {
    queue,
    features: new Set(['shader-f16']),
    limits: { maxBufferSize: 1024 * 1024 * 1024 },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        data: new Uint8Array(descriptor.size),
        destroyCount: 0,
        destroy() { this.destroyCount += 1; },
        async mapAsync() {},
        getMappedRange(offset = 0, size = descriptor.size - offset) { return buffer.data.slice(offset, offset + size).buffer; },
        unmap() {},
      };
      calls.buffers.push(buffer);
      return buffer;
    },
    createShaderModule(descriptor) { return { descriptor }; },
    createBindGroupLayout(descriptor) { return { descriptor }; },
    createPipelineLayout(descriptor) { return { descriptor }; },
    createBindGroup(descriptor) { const group = { descriptor }; calls.bindGroups.push(group); return group; },
    createComputePipeline(descriptor) { return { descriptor }; },
    createCommandEncoder(descriptor) {
      const copies = [];
      return {
        copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) { copies.push({ source, sourceOffset, destination, destinationOffset, size }); },
        beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; },
        finish() { return { label: descriptor.label, copies }; },
      };
    },
  };
  return { device, calls };
}

const residentRoute = createSam3ImagePatchEmbedPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-patch-embed-phase-program-v0', commit: 'resident-contract' },
});
const residentFixture = createResidentRouteDevice();
const residentProjection = new Float32Array([
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
]);
const residentBuffer = {
  descriptor: {
    label: 'resident-patch-projection',
    size: residentProjection.byteLength,
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
  },
  data: new Uint8Array(residentProjection.buffer.slice(0)),
  destroyCount: 0,
  destroy() { this.destroyCount += 1; },
};
let residentResolverCalls = 0;
const residentRequest = createRouteInvocationRequest(residentRoute, {
  requestId: 'sam3-patch-resident-contract',
  inputs: {
    'source-image': { artifactId: 'resident-source', sha256: `sha256:${'1'.repeat(64)}` },
    'pixel-values': { artifactId: 'resident-pixels', sha256: `sha256:${'2'.repeat(64)}` },
    'sam3-image-patch-embed-weights': { artifactId: 'resident-weights', sha256: `sha256:${'3'.repeat(64)}` },
  },
  outputs: { 'patch-embeddings': { artifactId: 'resident-output' } },
});
await runSam3ImagePatchEmbedPhaseProgramRoute({
  request: residentRequest,
  route: residentRoute,
  device: residentFixture.device,
  queue: residentFixture.device.queue,
  adapterName: 'resident-contract-adapter',
  browser: 'Node resident contract',
  model: { id: 'facebook/sam3.1', revision: 'resident-contract', weightsHash: `sha256:${'3'.repeat(64)}` },
  kernel: residentRoute.kernel,
  residentTensorResolver(tensorInput) {
    residentResolverCalls += 1;
    assert.equal(tensorInput.sourceData, residentProjection);
    return {
      buffer: residentBuffer,
      bufferOffset: 0,
      dtype: 'f32',
      shape: [2, 2, 2, 3],
      byteLength: residentProjection.byteLength,
      usage: residentBuffer.descriptor.usage,
      paddingReserved: true,
      sourceData: residentProjection,
      resourceId: 'resident-patch-projection-resource',
      allocationId: 'resident-patch-projection-allocation',
    };
  },
  tensors: {
    pixelValues: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    weights: { projection: residentProjection },
    shape: { batch: 1, imageHeight: 2, imageWidth: 2, imageChannels: 3, patchSize: 2, patchHeight: 1, patchWidth: 1, hiddenSize: 2 },
  },
});
assert.equal(residentResolverCalls, 1, 'the real patch route must resolve its immutable projection through residency exactly once');
assert.equal(residentFixture.calls.writes.some(write => write.buffer === residentBuffer), false, 'resident projection bytes must not upload per invocation');
assert.equal(residentBuffer.destroyCount, 0, 'route disposal must not destroy the session-owned resident projection');
assert.equal(
  residentFixture.calls.bindGroups.some(group => group.descriptor.entries.some(entry => entry.binding === 1 && entry.resource?.buffer === residentBuffer)),
  true,
  'the real patch kernel must bind the exact resident projection buffer',
);

console.log('sam image patch-embed phase-program contracts passed');
