import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as routeModule from '../src/trellis-dinov3-prefix-block-phase-program.js';
const { runTrellisDinoV3PrefixBlockPhaseProgramRoute } = routeModule;

const digest = value => `sha256:${createHash('sha256').update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest('hex')}`;
const sourceImage = new Uint8Array([1, 2, 3]);
const pixelValues = new Float32Array(512 * 512 * 3);
const zeros = length => new Float32Array(length);
const weights = {
  patchProjection: zeros(1024 * 16 * 16 * 3), patchBias: zeros(1024),
  classToken: zeros(1024), registerTokens: zeros(4 * 1024),
  ropeCos: zeros(1024 * 64), ropeSin: zeros(1024 * 64),
  norm1Weight: zeros(1024), norm1Bias: zeros(1024),
  qWeight: zeros(1024 * 1024), qBias: zeros(1024),
  kWeight: zeros(1024 * 1024), vWeight: zeros(1024 * 1024), vBias: zeros(1024),
  oWeight: zeros(1024 * 1024), oBias: zeros(1024), layerScale1: zeros(1024),
  norm2Weight: zeros(1024), norm2Bias: zeros(1024),
  mlpUpWeight: zeros(4096 * 1024), mlpUpBias: zeros(4096),
  mlpDownWeight: zeros(1024 * 4096), mlpDownBias: zeros(1024), layerScale2: zeros(1024),
};
const shape = {
  batch: 1, imageHeight: 512, imageWidth: 512, imageChannels: 3, patchSize: 16,
  patchHeight: 32, patchWidth: 32, patchTokens: 1024, prefixTokens: 5,
  tokenCount: 1029, hiddenSize: 1024, heads: 16, headDim: 64,
  intermediateSize: 4096, ropeTheta: 100, layerNormEpsilon: 1e-5,
};
const pinnedModel = {
  id: 'facebook/dinov3-vitl16-pretrain-lvd1689m',
  revision: 'ea8dc2863c51be0a264bab82070e3e8836b02d51',
  dtype: 'fp32',
  weightsHash: 'sha256:dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179',
};
const bundleHash = 'sha256:e50bfcdd1060e6b4aea34f846dc3146bd18482d2dad48d4ea9be699ce1c406e9';
function inputWithHashes(sourceHash, pixelHash, checkpointHash = bundleHash) {
  return {
    model: pinnedModel,
    request: { inputs: {
      'source-image': { artifactId: 'source', sha256: sourceHash, shape: [512, 512, 3] },
      'trellis-dinov3-normalized-pixels': { artifactId: 'pixels', sha256: pixelHash, shape: [1, 512, 512, 3] },
      'trellis-dinov3-checkpoint-tensors': { artifactId: 'weights', sha256: checkpointHash },
    }, outputs: {} },
    tensors: { sourceImage, pixelValues, weights, shape },
  };
}

await assert.rejects(
  runTrellisDinoV3PrefixBlockPhaseProgramRoute(inputWithHashes(`sha256:${'0'.repeat(64)}`, digest(pixelValues))),
  /source-image digest mismatch/,
  'a direct route cannot issue a real receipt for different source bytes',
);
await assert.rejects(
  runTrellisDinoV3PrefixBlockPhaseProgramRoute(inputWithHashes(digest(sourceImage), `sha256:${'0'.repeat(64)}`)),
  /normalized-pixels digest mismatch/,
  'a direct route cannot issue a real receipt for different normalized pixels',
);
await assert.rejects(
  runTrellisDinoV3PrefixBlockPhaseProgramRoute(inputWithHashes(digest(sourceImage), digest(pixelValues))),
  /checkpoint tensor bundle digest mismatch/,
  'a direct route cannot issue a pinned checkpoint receipt for different weight arrays',
);

await assert.rejects(
  runTrellisDinoV3PrefixBlockPhaseProgramRoute({
    ...inputWithHashes(digest(sourceImage), digest(pixelValues)),
    residentTensorResolver: () => ({ buffer: {} }),
  }),
  /residentTensorResolver is not admitted for pinned input custody/,
  'the route must reject a resolver that can substitute unattested GPU bytes',
);

assert.equal(typeof routeModule.snapshotTrellisDinoV3PrefixBlockInputs, 'function', 'the pinned route must expose its tested byte snapshot contract');
const captured = routeModule.snapshotTrellisDinoV3PrefixBlockInputs({ sourceImage, pixelValues, weights });
assert.notStrictEqual(captured.sourceImage, sourceImage);
assert.notStrictEqual(captured.pixelValues, pixelValues);
for (const key of Object.keys(weights)) assert.notStrictEqual(captured.weights[key], weights[key], `weights.${key} must be snapshotted`);
const originalImageByte = captured.sourceImage[0];
const originalPixel = captured.pixelValues[0];
const originalWeight = captured.weights.qWeight[0];
sourceImage[0] = 71;
pixelValues[0] = 72;
weights.qWeight[0] = 73;
assert.equal(captured.sourceImage[0], originalImageByte, 'post-hash source mutation cannot change the captured receipt bytes');
assert.equal(captured.pixelValues[0], originalPixel, 'post-hash pixel mutation cannot change uploaded bytes');
assert.equal(captured.weights.qWeight[0], originalWeight, 'post-hash weight mutation cannot change uploaded bytes');

assert.equal(typeof routeModule.snapshotTrellisDinoV3PrefixBlockClaims, 'function', 'receipt claims need a private pre-await capture');
const request = inputWithHashes(digest(sourceImage), digest(pixelValues)).request;
const originalRequestHash = request.inputs['source-image'].sha256;
const claimModel = { ...pinnedModel };
const claimKernel = { profile: 'trellis2-dinov3-prefix-block0-phase-program-v0', commit: 'test-commit' };
const claimRoute = { routeId: 'trellis2.dinov3.prefix-block0.phase-program.webgpu-local.v0', model: { ...pinnedModel }, kernel: claimKernel };
const claims = routeModule.snapshotTrellisDinoV3PrefixBlockClaims({ request, model: claimModel, kernel: claimKernel, route: claimRoute });
request.inputs['source-image'].sha256 = `sha256:${'f'.repeat(64)}`;
request.outputs['trellis-dinov3-block0-hidden-states'] = { artifactId: 'forged-output' };
claimModel.weightsHash = `sha256:${'e'.repeat(64)}`;
claimKernel.commit = 'forged-commit';
claimRoute.model.revision = 'forged-revision';
assert.equal(claims.request.inputs['source-image'].sha256, originalRequestHash, 'callback cannot rewrite the validated input hash');
assert.equal(claims.request.outputs['trellis-dinov3-block0-hidden-states'], undefined, 'callback cannot rewrite output artifact identity');
assert.equal(claims.model.weightsHash, pinnedModel.weightsHash, 'callback cannot rewrite the pinned model claim');
assert.equal(claims.kernel.commit, 'test-commit', 'callback cannot rewrite kernel provenance');
assert.equal(claims.route.model.revision, pinnedModel.revision, 'callback cannot rewrite route model identity');

console.log('TRELLIS DINOv3 direct-route input custody contracts passed');
