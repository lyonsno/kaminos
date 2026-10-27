import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import { buildPixal3dNafPlan, pixal3dNafWeightShapes } from '../naf.js';
import { buildPixal3dBlockPlan, pixal3dBlockWeightShapes } from '../pixal3d-block.js';
import {
  buildSparseDecoderPlan,
  sparseDecoderWeightShapes,
  buildSLatDecoderPlan,
  slatDecoderWeightShapes,
} from '../../trellis2/sparse-decoder.js';

const source = new URL('../pixal3d-generation.js', import.meta.url);
assert.ok(existsSync(source), 'Missing Pixal3D end-to-end WebGPU generation orchestrator.');
const {
  PIXAL3D_GENERATION_ROLES,
  pixal3dGenerationPipelineType,
  pixal3dGenerationRoles,
  preparePixal3dRgbInputs,
  createPixal3dGenerationFromConditioningAdapter,
  createPixal3dImageGenerationAdapter,
} = await import(source);

// 1. Roles and pipeline types
assert.deepEqual(PIXAL3D_GENERATION_ROLES, [
  'naf',
  'sparseFlow',
  'occupancyDecoder',
  'lowResolutionShape',
  'highResolutionShape',
  'shapeDecoder',
  'textureFlow',
  'textureDecoder',
]);
assert.equal(pixal3dGenerationPipelineType({ pipelineType: '512' }), '512');
assert.equal(pixal3dGenerationPipelineType({}), '1024_cascade');
assert.ok(!pixal3dGenerationRoles({ pipelineType: '512' }).includes('highResolutionShape'));
assert.ok(pixal3dGenerationRoles({ pipelineType: '1024_cascade' }).includes('highResolutionShape'));

// 2. RGB preparation for NAF ([0,1]) and DINOv3 (ImageNet normalized)
const dummyRgb = new Uint8Array(512 * 512 * 3).fill(128);
const { rawImageValues, dinoPixelValues } = preparePixal3dRgbInputs({
  pixels: dummyRgb,
  width: 512,
  height: 512,
});
assert.equal(rawImageValues.length, 512 * 512 * 3);
assert.equal(dinoPixelValues.length, 512 * 512 * 3);
assert.ok(Math.abs(rawImageValues[0] - Math.fround(128 / 255)) < 1e-7);
assert.ok(Math.abs(dinoPixelValues[0] - (Math.fround(128 / 255) - 0.485) / 0.229) < 1e-6);

// 3. Full 8-model cascade generation from resident DINO conditioning
const allocated = [], uploads = [], runs = [], reads = [], observed = [];
let phase, marked = false, failStage;
const runtime = {
  device: {
    limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 },
    queue: { async onSubmittedWorkDone() {} },
  },
  createTensor(spec) {
    const t = {
      ...spec,
      byteLength: spec.shape.reduce((a, b) => a * b, 4),
      usage: spec.usage ?? (U.storage | U.copyDst | U.copySrc),
      buffer: spec.buffer ?? { destroy() { t.destroyed = true; } },
    };
    allocated.push(t);
    return t;
  },
  uploadTensor(t, data) { uploads.push({ t, data }); },
  defineComputeKernel(k) { return k; },
  async runKernel(k, o) {
    for (const b of k.bindings) {
      assert.ok(!b.resource.destroyed && !b.resource.buffer?.destroyed, 'downstream GPU input must remain live: ' + b.resource.name);
    }
    runs.push({ k, o });
    if (o.stage === 'slat-regrid-mark') marked = true;
    if (o.stage === failStage) throw new Error('injected generation failure');
  },
  async readTensor(t) {
    reads.push(t);
    assert.equal(t.dtype, 'u32');
    assert.equal(t.byteLength, 4);
    return new Uint32Array([
      t.name.includes('hash-status')
        ? 0
        : t.name.includes('occupancy.count')
          ? 3
          : phase === 'learned-cascade-support' && marked
            ? 4
            : 5,
    ]);
  },
};
const route = { runtime, routeId: 'pixal3d-eight-model-composition' };

const nafConfig = {
  dim: 16,
  headsAttn: 2,
  headsRope: 2,
  imgLayers: 1,
  numGroups: 2,
  kernelSize: 3,
  imageHeight: 8,
  imageWidth: 8,
  featureHeight: 4,
  featureWidth: 4,
  featureChannels: 6,
  prefixTokens: 5,
  outputHeight: 8,
  outputWidth: 8,
};
const nafPlan = buildPixal3dNafPlan(nafConfig);
const arrays = shapes =>
  Object.fromEntries(
    Object.entries(shapes).map(([name, shape]) => [
      name,
      new Float32Array(shape.reduce((a, b) => a * b, 1)).fill(0.01),
    ]),
  );

const commonFlow = {
  channels: 24,
  heads: 3,
  contextRows: 5,
  contextChannels: 6,
  hidden: 20,
  frequencyDim: 6,
  numBlocks: 1,
  steps: 1,
  guidanceStrength: 1,
};

function makeFlowWeights(config, inChannels, outChannels) {
  const p = buildPixal3dBlockPlan(config);
  const c = p.channels;
  return {
    prefix: arrays({
      'input.weight': [c, inChannels],
      'input.bias': [c],
      'time0.weight': [c, 6],
      'time0.bias': [c],
      'time2.weight': [c, c],
      'time2.bias': [c],
      'mod.weight': [6 * c, c],
      'mod.bias': [6 * c],
    }),
    blocks: [arrays({ ...pixal3dBlockWeightShapes(p), gelu: [65536] })],
    terminal: {
      weight: new Float32Array(outChannels * c),
      bias: new Float32Array(outChannels),
    },
  };
}

const shapeConfig = { channels: [32, 4], numBlocks: [0, 0] };
const occupancyConfig = { channels: [2], numResBlocks: 0, numResBlocksMiddle: 0 };
const ssFlowConfig = { ...commonFlow, projInChannels: 6 };
const slatFlowConfig = { ...commonFlow, projInChannels: 12 };

const models = {
  naf: {
    config: nafConfig,
    weights: arrays(pixal3dNafWeightShapes(nafPlan)),
  },
  sparseFlow: {
    config: ssFlowConfig,
    weights: makeFlowWeights(ssFlowConfig, 8, 8),
    phases: new Float32Array(4096 * 8),
  },
  occupancyDecoder: {
    config: occupancyConfig,
    weights: arrays(sparseDecoderWeightShapes(buildSparseDecoderPlan(occupancyConfig))),
  },
  lowResolutionShape: {
    config: slatFlowConfig,
    weights: makeFlowWeights({ ...slatFlowConfig, tokenRows: 3 }, 32, 32),
  },
  highResolutionShape: {
    config: slatFlowConfig,
    weights: makeFlowWeights({ ...slatFlowConfig, tokenRows: 4 }, 32, 32),
  },
  shapeDecoder: {
    config: shapeConfig,
    weights: arrays(slatDecoderWeightShapes(buildSLatDecoderPlan({ ...shapeConfig, tokenRows: 3 }))),
    siluTable: new Float32Array(65536),
  },
  textureFlow: {
    config: slatFlowConfig,
    weights: makeFlowWeights({ ...slatFlowConfig, tokenRows: 4 }, 64, 32),
  },
  textureDecoder: {
    config: shapeConfig,
    weights: arrays(slatDecoderWeightShapes(buildSLatDecoderPlan({ ...shapeConfig, tokenRows: 4, mode: 'texture' }))),
    siluTable: new Float32Array(65536),
  },
};

const conditioning = runtime.createTensor({
  name: 'dino-conditioning',
  shape: [1, 21, 6],
  dtype: 'f32',
});
const rawImageValuesSmall = new Float32Array(8 * 8 * 3).fill(0.5);

const adapter = createPixal3dGenerationFromConditioningAdapter({
  route,
  conditioningTensor: conditioning,
  rawImageValues: rawImageValuesSmall,
  models,
  meshResolution: 128,
  seed: 42,
  onPhase(e) {
    phase = e.phase;
    if (phase === 'learned-cascade-support') marked = false;
    if (['learned-geometry-decoding', 'shape-conditioned-texture-sampling', 'shape-guided-material-decoding'].includes(phase)) {
      assert.equal(
        allocated.filter(t => t.name.startsWith('pixal3d.naf.') && !t.destroyed).length,
        0,
        'NAF high-res feature tensor must be released once final SLat projected conditioning is computed before ' + phase,
      );
    }
    if (['low-resolution-shape-sampling', 'high-resolution-shape-sampling', 'learned-geometry-decoding', 'shape-guided-material-decoding'].includes(phase)) {
      assert.equal(
        allocated.filter(t => t.name.startsWith('pixal3d.block.') && !t.destroyed).length,
        0,
        'consumed Pixal3D flow weights/workspace must be released before ' + phase,
      );
    }
    observed.push(e);
  },
});

const invocation = { id: 'pixal3d-composed-generation' };
const result = await adapter.run(invocation);
assert.equal(adapter.state, 'completed');
assert.equal(adapter.phase, 'completed');
assert.strictEqual(adapter.outputs, result);
assert.deepEqual(result.geometry.features.shape, [5, 7]);
assert.deepEqual(result.material.features.shape, [5, 6]);
assert.equal(result.lowResolutionRows, 3);
assert.equal(result.highResolutionRows, 4);
assert.deepEqual(observed.map(e => e.phase), [
  'naf-feature-upsampling',
  'sparse-structure-sampling',
  'occupancy-decoding',
  'low-resolution-shape-sampling',
  'learned-cascade-support',
  'high-resolution-shape-sampling',
  'learned-geometry-decoding',
  'shape-conditioned-texture-sampling',
  'shape-guided-material-decoding',
]);
assert.ok(runs.some(r => r.o.stage === 'naf-neighborhood-cross-attention'));
assert.ok(runs.some(r => r.o.stage === 'pixal3d-proj-grid-sample'));
assert.ok(runs.some(r => r.o.stage === 'cross-proj-linear'));
assert.equal(result.featureBytesToCPUDuringServing, 0);
assert.equal(result.coordinateBytesToCPUDuringServing, 0);
adapter.dispose();
assert.ok(!conditioning.destroyed);

console.log('pixal3d-generation-contracts.mjs: PASS');
