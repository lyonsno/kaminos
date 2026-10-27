import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const source = new URL('../generation-inputs.js', import.meta.url);
assert.ok(existsSync(source), 'Missing Pixal3D checkpoint and generation input manifest module.');
const {
  PIXAL3D_INPUT_SCHEMA,
  pixal3dGenerationInputShapes,
  validatePixal3dGenerationInputs,
  validatePixal3dGenerationCheckpoints,
  loadPixal3dGenerationCheckpoints,
  loadPixal3dGenerationInputs,
} = await import(source);

assert.equal(PIXAL3D_INPUT_SCHEMA, 'pixal3d.generation-inputs.v0');

const sha = n => String(n).padStart(64, 'a');
const baseManifest = {
  schema: 'pixal3d.generation-inputs.v0',
  status: 'succeeded',
  modelCalls: 0,
  pipelineType: '1024_cascade',
  conditioningMode: 'stage-specific-1024',
  meshResolution: 1024,
  samplingSteps: 12,
  seed: 42,
  camera: {
    cameraAngleX: 0.8575560450553894,
    meshScale: 1.0,
  },
  models: {
    naf: {
      config: {
        dim: 128,
        headsAttn: 4,
        headsRope: 4,
        imgLayers: 2,
        numGroups: 32,
        kernelSize: 9,
        imageHeight: 512,
        imageWidth: 512,
        featureHeight: 32,
        featureWidth: 32,
        featureChannels: 1024,
        prefixTokens: 5,
        outputHeight: 512,
        outputWidth: 512,
      },
      highResolutionConfig: {
        dim: 128,
        headsAttn: 4,
        headsRope: 4,
        imgLayers: 2,
        numGroups: 32,
        kernelSize: 9,
        imageHeight: 1024,
        imageWidth: 1024,
        featureHeight: 64,
        featureWidth: 64,
        featureChannels: 1024,
        prefixTokens: 5,
        outputHeight: 512,
        outputWidth: 512,
      },
      textureConfig: {
        dim: 128,
        headsAttn: 4,
        headsRope: 4,
        imgLayers: 2,
        numGroups: 32,
        kernelSize: 9,
        imageHeight: 1024,
        imageWidth: 1024,
        featureHeight: 64,
        featureWidth: 64,
        featureChannels: 1024,
        prefixTokens: 5,
        outputHeight: 512,
        outputWidth: 512,
      },
      identity: { sha256: sha(1) },
      tensors: {},
    },
    sparseFlow: {
      config: {
        channels: 1536,
        heads: 12,
        contextChannels: 1024,
        contextRows: 5,
        projInChannels: 1024,
        hidden: 8192,
        frequencyDim: 256,
        numBlocks: 2,
        steps: 12,
        guidanceStrength: 7.5,
        guidanceRescale: 0.7,
        guidanceInterval: [0.6, 1],
        rescaleT: 5,
        sigmaMin: 1e-5,
      },
      identity: { sha256: sha(2) },
      phases: 'sparse.phases',
      tensors: {},
    },
    occupancyDecoder: {
      config: {
        resolution: 16,
        latentChannels: 8,
        outChannels: 1,
        channels: [512, 128, 32],
        numResBlocks: 0,
        numResBlocksMiddle: 0,
      },
      identity: { sha256: sha(3) },
      tensors: {},
    },
    lowResolutionShape: {
      config: {
        channels: 1536,
        heads: 12,
        contextChannels: 1024,
        contextRows: 5,
        projInChannels: 2048,
        hidden: 8192,
        frequencyDim: 256,
        numBlocks: 2,
        steps: 12,
        guidanceStrength: 7.5,
        guidanceRescale: 0.5,
        guidanceInterval: [0.6, 1],
        rescaleT: 3,
        sigmaMin: 1e-5,
      },
      identity: { sha256: sha(4) },
      tensors: {},
    },
    highResolutionShape: {
      config: {
        channels: 1536,
        heads: 12,
        contextChannels: 1024,
        contextRows: 5,
        projInChannels: 2048,
        hidden: 8192,
        frequencyDim: 256,
        numBlocks: 2,
        steps: 12,
        guidanceStrength: 7.5,
        guidanceRescale: 0.5,
        guidanceInterval: [0.6, 1],
        rescaleT: 3,
        sigmaMin: 1e-5,
      },
      identity: { sha256: sha(5) },
      tensors: {},
    },
    shapeDecoder: {
      config: {
        latentChannels: 32,
        channels: [1024, 512, 256, 128, 64],
        numBlocks: [0, 0, 0, 0, 0],
      },
      identity: { sha256: sha(6) },
      siluTable: 'shared.silu',
      tensors: {},
    },
    textureFlow: {
      config: {
        channels: 1536,
        heads: 12,
        contextChannels: 1024,
        contextRows: 5,
        projInChannels: 2048,
        hidden: 8192,
        frequencyDim: 256,
        numBlocks: 2,
        steps: 12,
        guidanceStrength: 1.0,
        guidanceRescale: 0.0,
        guidanceInterval: [0.6, 0.9],
        rescaleT: 3,
        sigmaMin: 1e-5,
      },
      identity: { sha256: sha(7) },
      tensors: {},
    },
    textureDecoder: {
      config: {
        latentChannels: 32,
        channels: [1024, 512, 256, 128, 64],
        numBlocks: [0, 0, 0, 0, 0],
        mode: 'texture',
      },
      identity: { sha256: sha(8) },
      siluTable: 'shared.silu',
      tensors: {},
    },
  },
  image: {
    dinoPixelTensor: 'image.dino512',
    rawImageTensor: 'image.raw512',
    highResolutionDinoPixelTensor: 'image.dino1024',
    highResolutionRawImageTensor: 'image.raw1024',
  },
  dino: {
    identity: { files: { 'model.safetensors': { sha256: sha(9) } } },
    prefix: {},
    layers: [],
  },
  tensors: {},
};

const shapes = pixal3dGenerationInputShapes(baseManifest);
assert.equal(Object.keys(shapes.models.naf).length, 37, 'all 37 NAF checkpoint tensors covered');
assert.deepEqual(shapes.models.sparseFlow['block0.cross.proj.weight'], [1536, 1024]);
assert.deepEqual(shapes.models.lowResolutionShape['block0.cross.proj.weight'], [1536, 2048]);
assert.deepEqual(shapes.models.highResolutionShape['block0.cross.proj.weight'], [1536, 2048]);
assert.deepEqual(shapes.models.textureFlow['block0.cross.proj.weight'], [1536, 2048]);

let nextHash = 100;
function registerTensor(key, shape, fixedHash) {
  baseManifest.tensors[key] = {
    file: `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.f32`,
    dtype: 'float32',
    shape,
    byteLength: shape.reduce((a, b) => a * b, 4),
    sha256: fixedHash ?? sha(nextHash++),
  };
  return key;
}

registerTensor('image.dino512', shapes.image512);
registerTensor('image.raw512', shapes.image512);
registerTensor('image.dino1024', shapes.image1024);
registerTensor('image.raw1024', shapes.image1024);
registerTensor('sparse.phases', shapes.phases);
const geluHash = sha(9991);
const siluHash = sha(9992);
registerTensor('shared.silu', shapes.silu, siluHash);

for (const [k, s] of Object.entries(shapes.dinoPrefix)) {
  baseManifest.dino.prefix[k] = registerTensor(`dino.prefix.${k}`, s);
}
for (let i = 0; i < 24; i++) {
  const layer = {};
  for (const [k, s] of Object.entries(shapes.dinoLayer)) {
    layer[k] = registerTensor(`dino.l${i}.${k}`, s);
  }
  baseManifest.dino.layers.push(layer);
}
for (const [role, roleShapes] of Object.entries(shapes.models)) {
  for (const [k, s] of Object.entries(roleShapes)) {
    const tKey = `${role}.${k}`;
    baseManifest.models[role].tensors[k] = registerTensor(
      tKey,
      s,
      k === 'gelu' ? geluHash : undefined,
    );
  }
}

const validated = validatePixal3dGenerationInputs(baseManifest);
assert.ok(validated.tensorCount > 400);
const ckptValidated = validatePixal3dGenerationCheckpoints(baseManifest);
assert.equal(ckptValidated.tensorCount, validated.tensorCount - 4);

const fetched = [];
const loaded = await loadPixal3dGenerationCheckpoints(baseManifest, async key => {
  fetched.push(key);
  return new Float32Array(4);
});
const nafModel = await loaded.loadModel('naf');
assert.equal(Object.keys(nafModel.weights).length, 37);
const streamedFlow = await loaded.loadModel('sparseFlow', { streamBlocks: true });
assert.equal(typeof streamedFlow.loadBlockWeights, 'function');
const block0 = await streamedFlow.loadBlockWeights(0);
assert.ok('cross.proj.weight' in block0);
assert.ok('cross.proj.bias' in block0);

console.log('generation-inputs-contracts.mjs: PASS');
