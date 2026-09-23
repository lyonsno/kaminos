import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runTrellisDinoV3PrefixBlockPhaseProgramRoute } from '../src/trellis-dinov3-prefix-block-phase-program.js';

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

console.log('TRELLIS DINOv3 direct-route input custody contracts passed');
