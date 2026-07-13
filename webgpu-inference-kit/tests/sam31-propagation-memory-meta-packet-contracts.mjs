import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID,
  createSam31MemoryEncoderPhaseProgramCpuOracle,
  createSam31PropagationNeckPhaseProgramCpuOracle,
} from '../src/index.js';

async function floatArray(path) {
  const buffer = await readFile(path);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(arrayBuffer);
}

function maxAbsDiff(actual, expected) {
  assert.equal(actual.length, expected.length, 'compared tensor lengths must agree');
  let maximum = 0;
  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(Number.isFinite(actual[index]), true, `actual tensor value ${index} must be finite`);
    assert.equal(Number.isFinite(expected[index]), true, `expected tensor value ${index} must be finite`);
    maximum = Math.max(maximum, Math.abs(Number(actual[index]) - Number(expected[index])));
  }
  return maximum;
}

const root = new URL('..', import.meta.url);
const exporter = new URL('../tools/sam31-propagation-memory-meta-packet.py', import.meta.url);
const outDir = await mkdtemp(join(tmpdir(), 'sam31-propagation-memory-meta-'));
const python = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const checkpoint = process.env.KAMINOS_SAM31_CHECKPOINT;
const convertedWeights = process.env.KAMINOS_SAM31_CONVERTED_WEIGHTS;
const sourceRoot = process.env.KAMINOS_SAM31_SOURCE_ROOT;
const args = [exporter.pathname, '--out-dir', outDir];
if (checkpoint) args.push('--checkpoint', checkpoint);
if (convertedWeights) args.push('--converted-weights', convertedWeights);
if (sourceRoot) args.push('--source-root', sourceRoot);
const run = spawnSync(python, args, { cwd: root.pathname, encoding: 'utf8', timeout: 120000 });
assert.equal(run.status, 0, run.stderr || run.stdout);

const manifest = JSON.parse(await readFile(join(outDir, 'tensor-manifest.json'), 'utf8'));
const receipt = JSON.parse(await readFile(join(outDir, 'reference-receipt.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.sam31-propagation-memory-meta-packet.v0');
assert.deepEqual(manifest.routeIds, [SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID, SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID]);
assert.equal(manifest.mode, 'official-meta-checkpoint-export');
assert.equal(manifest.boundary, 'sam31-official-tri-neck-to-multiplex-memory-encoder');
assert.equal(manifest.claims.fullSam31BrowserExecution, false);
assert.equal(manifest.claims.composition, 'official propagation feature 2 is the memory encoder pixel-feature input');
assert.equal(manifest.reference.model.id, 'facebook/sam3.1');
assert.match(manifest.reference.model.revision, /^[0-9a-f]{40}$/);
assert.match(manifest.reference.model.sha256, /^sha256:[0-9a-f]{64}$/);
assert.equal(manifest.reference.source.repository, 'facebookresearch/sam3');
assert.match(manifest.reference.source.commit, /^[0-9a-f]{40}$/);
assert.equal(manifest.reference.converted.model, 'mlx-community/sam3.1-bf16');
assert.match(manifest.reference.converted.sha256, /^sha256:[0-9a-f]{64}$/);
assert.equal(manifest.checkpointAudit.officialStateTensorCount, 1623);
assert.equal(manifest.checkpointAudit.mappedTensorCount, 56);
assert.equal(manifest.checkpointAudit.convertedValueMatches, 56);
assert.equal(manifest.checkpointAudit.convertedMaxAbsDiff, 0);
assert.equal(manifest.checkpointAudit.allMappedOfficialKeysPresent, true);
assert.equal(manifest.checkpointAudit.allMappedConvertedKeysPresent, true);
assert.equal(manifest.weights.length, 56);

for (const entry of [...manifest.tensors, ...manifest.weights]) {
  assert.match(entry.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await stat(join(outDir, entry.file))).isFile(), true);
}

const tensorEntries = new Map(manifest.tensors.map(entry => [entry.role, entry]));
const weightEntries = new Map(manifest.weights.map(entry => [entry.role, entry]));
const tensor = role => floatArray(join(outDir, tensorEntries.get(role).file));
const weight = role => floatArray(join(outDir, weightEntries.get(role).file));
const conv = async (prefix, { stride = 1, padding = 0, activation = null, groups = 1 } = {}) => {
  const entry = weightEntries.get(`${prefix}-weight`);
  const [outChannels, kernelSize, , maybeInChannels] = entry.shape;
  const inChannels = maybeInChannels ?? outChannels;
  return {
    weight: await weight(`${prefix}-weight`),
    bias: await weight(`${prefix}-bias`),
    kernelSize,
    stride,
    padding,
    inChannels,
    outChannels,
    activation,
    groups,
  };
};

const propagationWeights = { levels: [] };
propagationWeights.levels.push({
  level: 0,
  scaleLayers: [
    await conv('propagation-level-0-scale-0', { stride: 2, activation: 'gelu' }),
    await conv('propagation-level-0-scale-1', { stride: 2 }),
  ],
  proj1: await conv('propagation-level-0-proj1'),
  proj2: await conv('propagation-level-0-proj2', { padding: 1 }),
});
propagationWeights.levels.push({
  level: 1,
  scaleLayers: [await conv('propagation-level-1-scale-0', { stride: 2 })],
  proj1: await conv('propagation-level-1-proj1'),
  proj2: await conv('propagation-level-1-proj2', { padding: 1 }),
});
propagationWeights.levels.push({
  level: 2,
  scaleLayers: [],
  proj1: await conv('propagation-level-2-proj1'),
  proj2: await conv('propagation-level-2-proj2', { padding: 1 }),
});
const backbone = await tensor('vit-backbone-hidden-states');
const propagation = createSam31PropagationNeckPhaseProgramCpuOracle({
  backboneHiddenStates: backbone,
  shape: manifest.shape,
  weights: propagationWeights,
});
for (let level = 0; level < 3; level += 1) {
  const expected = await tensor(`expected-propagation-feature-${level}`);
  const diff = maxAbsDiff(propagation.features[level], expected);
  assert.equal(diff <= manifest.tolerances.propagationCpuOracleMaxAbsDiff, true, `propagation level ${level} CPU oracle diff ${diff}`);
}

const memoryShape = manifest.shape.memory;
const memoryWeights = { downsampleLayers: [], fuserLayers: [] };
for (let level = 0; level < 4; level += 1) {
  const convSpec = await conv(`memory-downsample-${level}-conv`, { stride: 2, padding: 1 });
  memoryWeights.downsampleLayers.push({
    conv: convSpec,
    layerNorm: {
      weight: await weight(`memory-downsample-${level}-norm-weight`),
      bias: await weight(`memory-downsample-${level}-norm-bias`),
      epsilon: 1e-6,
    },
  });
}
memoryWeights.maskFinal = await conv('memory-mask-final');
memoryWeights.featureProjection = await conv('memory-feature-projection');
for (let level = 0; level < 2; level += 1) {
  const depthwise = await conv(`memory-fuser-${level}-depthwise`, { padding: 3, groups: 256 });
  depthwise.inChannels = 256;
  memoryWeights.fuserLayers.push({
    depthwise,
    layerNorm: {
      weight: await weight(`memory-fuser-${level}-norm-weight`),
      bias: await weight(`memory-fuser-${level}-norm-bias`),
      epsilon: 1e-6,
    },
    pointwise1: {
      weight: await weight(`memory-fuser-${level}-pointwise-1-weight`),
      bias: await weight(`memory-fuser-${level}-pointwise-1-bias`),
      inChannels: 256,
      outChannels: 1024,
    },
    pointwise2: {
      weight: await weight(`memory-fuser-${level}-pointwise-2-weight`),
      bias: await weight(`memory-fuser-${level}-pointwise-2-bias`),
      inChannels: 1024,
      outChannels: 256,
    },
    scale: await weight(`memory-fuser-${level}-scale`),
  });
}
const memory = createSam31MemoryEncoderPhaseProgramCpuOracle({
  propagationFeature: propagation.features[2],
  maskLogits: await tensor('multiplex-mask-logits'),
  shape: {
    batch: manifest.shape.batch,
    featureHeight: memoryShape.featureHeight,
    featureWidth: memoryShape.featureWidth,
    featureChannels: memoryShape.featureChannels,
    maskHeight: memoryShape.maskHeight,
    maskWidth: memoryShape.maskWidth,
    multiplexCount: memoryShape.multiplexCount,
    conditionChannels: memoryShape.conditionChannels,
    conditioning: await tensor('multiplex-conditioning'),
    resampledMaskHeight: memoryShape.resampledMaskHeight,
    resampledMaskWidth: memoryShape.resampledMaskWidth,
  },
  config: manifest.config,
  weights: memoryWeights,
});
const expectedMemory = await tensor('expected-memory-features');
const expectedPosition = await tensor('expected-memory-position-encoding');
const memoryDiff = maxAbsDiff(memory.features, expectedMemory);
const positionDiff = maxAbsDiff(memory.positionEncoding, expectedPosition);
assert.equal(memoryDiff <= manifest.tolerances.memoryCpuOracleMaxAbsDiff, true, `memory CPU oracle diff ${memoryDiff}`);
assert.equal(positionDiff <= manifest.tolerances.positionCpuOracleMaxAbsDiff, true, `position CPU oracle diff ${positionDiff}`);

assert.equal(receipt.ok, true);
assert.deepEqual(receipt.routeIds, manifest.routeIds);
assert.deepEqual(receipt.reference, manifest.reference);
assert.deepEqual(receipt.checkpointAudit, manifest.checkpointAudit);
assert.deepEqual(receipt.shape, manifest.shape);
assert.equal(receipt.outputs.tensorManifest, join(outDir, 'tensor-manifest.json'));

console.log(JSON.stringify({
  ok: true,
  propagationMaxAbsDiff: Math.max(...await Promise.all(propagation.features.map(async (values, level) => maxAbsDiff(values, await tensor(`expected-propagation-feature-${level}`))))),
  memoryMaxAbsDiff: memoryDiff,
  positionMaxAbsDiff: positionDiff,
  mappedTensorCount: manifest.checkpointAudit.mappedTensorCount,
}));
