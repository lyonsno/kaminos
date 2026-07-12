#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  compileBoundarySplatAttributeModel,
  evaluateBoundarySplatAttributeModel,
} from './boundary-splat-attribute-model.mjs';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  const input = values.get('--input');
  const outDir = values.get('--out-dir');
  if (!input || !outDir) throw new Error('usage: compile-boundary-splat-attribute-model.mjs --input MODEL.json --out-dir DIR');
  return {
    input: resolve(input),
    outDir: resolve(outDir),
    paritySamples: values.has('--parity-samples') ? resolve(values.get('--parity-samples')) : null,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const { input, outDir, paritySamples } = parseArgs(process.argv.slice(2));
  const inputBytes = await readFile(input);
  const model = JSON.parse(inputBytes.toString('utf8'));
  const compiled = compileBoundarySplatAttributeModel(model);
  let parity = null;
  if (paritySamples) {
    const parityBytes = await readFile(paritySamples);
    const samples = JSON.parse(parityBytes.toString('utf8'));
    if (samples.schema !== 'kaminos-boundary-splat-attribute-parity-v0') {
      throw new Error('parity sample schema must be kaminos-boundary-splat-attribute-parity-v0');
    }
    if (!Array.isArray(samples.outputs) || samples.outputs.length !== samples.features?.length) {
      throw new Error('parity features and outputs must have equal sample counts');
    }
    const evaluated = evaluateBoundarySplatAttributeModel(model, samples.features);
    let absoluteErrorSum = 0;
    let valueCount = 0;
    let maxAbsoluteError = 0;
    evaluated.forEach((row, rowIndex) => {
      if (!Array.isArray(samples.outputs[rowIndex]) || samples.outputs[rowIndex].length !== row.length) {
        throw new Error(`parity output row ${rowIndex} has the wrong size`);
      }
      row.forEach((value, outputIndex) => {
        const expected = samples.outputs[rowIndex][outputIndex];
        if (typeof expected !== 'number' || !Number.isFinite(expected)) throw new Error('parity outputs must be finite');
        const error = Math.abs(value - expected);
        absoluteErrorSum += error;
        valueCount += 1;
        maxAbsoluteError = Math.max(maxAbsoluteError, error);
      });
    });
    if (maxAbsoluteError > 1e-5) {
      throw new Error(`compiled artifact parity failed: max absolute error ${maxAbsoluteError}`);
    }
    parity = {
      path: paritySamples,
      bytes: parityBytes.length,
      sha256: sha256(parityBytes),
      sampleCount: evaluated.length,
      meanAbsoluteError: absoluteErrorSum / Math.max(1, valueCount),
      maxAbsoluteError,
      threshold: 1e-5,
    };
  }
  await mkdir(outDir, { recursive: true });

  const wgslPath = resolve(outDir, 'boundary-splat-attribute-model.wgsl');
  const modulePath = resolve(outDir, 'boundary-splat-attribute-model.generated.js');
  const weightsPath = resolve(outDir, 'boundary-splat-attribute-weights.f32');
  const modelPath = resolve(outDir, 'model-artifact.json');
  const receiptPath = resolve(outDir, 'compiled-model.json');
  const wgslBytes = Buffer.from(`${compiled.wgsl}\n`, 'utf8');
  const moduleBytes = Buffer.from([
    `export const BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY = ${JSON.stringify(compiled.identity)};`,
    `export const BOUNDARY_SPLAT_ATTRIBUTE_MODEL_INPUT_SIZE = ${compiled.inputSize};`,
    `export const BOUNDARY_SPLAT_ATTRIBUTE_MODEL_HIDDEN_SIZE = ${compiled.hiddenSize};`,
    `export const BOUNDARY_SPLAT_ATTRIBUTE_MODEL_OUTPUT_SIZE = ${compiled.outputSize};`,
    `export const BOUNDARY_SPLAT_ATTRIBUTE_MODEL_WGSL = ${JSON.stringify(compiled.wgsl)};`,
    '',
  ].join('\n'), 'utf8');
  const modelBytes = Buffer.from(`${JSON.stringify(model, null, 2)}\n`, 'utf8');
  const weightBytes = Buffer.from(
    compiled.packedWeights.buffer,
    compiled.packedWeights.byteOffset,
    compiled.packedWeights.byteLength,
  );
  await writeFile(wgslPath, wgslBytes);
  await writeFile(modulePath, moduleBytes);
  await writeFile(weightsPath, weightBytes);
  await writeFile(modelPath, modelBytes);
  const receipt = {
    schema: 'kaminos-boundary-splat-attribute-compiled-v0',
    identity: compiled.identity,
    inputPath: input,
    inputSha256: sha256(inputBytes),
    inputSize: compiled.inputSize,
    hiddenSize: compiled.hiddenSize,
    outputSize: compiled.outputSize,
    parity,
    model: { path: 'model-artifact.json', bytes: modelBytes.length, sha256: sha256(modelBytes) },
    wgsl: { path: 'boundary-splat-attribute-model.wgsl', bytes: wgslBytes.length, sha256: sha256(wgslBytes) },
    module: { path: 'boundary-splat-attribute-model.generated.js', bytes: moduleBytes.length, sha256: sha256(moduleBytes) },
    weights: {
      path: 'boundary-splat-attribute-weights.f32',
      bytes: weightBytes.length,
      floatCount: compiled.packedWeights.length,
      dtype: 'float32-native-little-endian',
      sha256: sha256(weightBytes),
    },
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'compiled', receiptPath, identity: compiled.identity })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
