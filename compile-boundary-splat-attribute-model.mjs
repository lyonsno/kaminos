#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { compileBoundarySplatAttributeModel } from './boundary-splat-attribute-model.mjs';

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
  return { input: resolve(input), outDir: resolve(outDir) };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const { input, outDir } = parseArgs(process.argv.slice(2));
  const inputBytes = await readFile(input);
  const model = JSON.parse(inputBytes.toString('utf8'));
  const compiled = compileBoundarySplatAttributeModel(model);
  await mkdir(outDir, { recursive: true });

  const wgslPath = resolve(outDir, 'boundary-splat-attribute-model.wgsl');
  const weightsPath = resolve(outDir, 'boundary-splat-attribute-weights.f32');
  const receiptPath = resolve(outDir, 'compiled-model.json');
  const wgslBytes = Buffer.from(`${compiled.wgsl}\n`, 'utf8');
  const weightBytes = Buffer.from(
    compiled.packedWeights.buffer,
    compiled.packedWeights.byteOffset,
    compiled.packedWeights.byteLength,
  );
  await writeFile(wgslPath, wgslBytes);
  await writeFile(weightsPath, weightBytes);
  const receipt = {
    schema: 'kaminos-boundary-splat-attribute-compiled-v0',
    identity: compiled.identity,
    inputPath: input,
    inputSha256: sha256(inputBytes),
    inputSize: compiled.inputSize,
    hiddenSize: compiled.hiddenSize,
    outputSize: compiled.outputSize,
    wgsl: { path: wgslPath, bytes: wgslBytes.length, sha256: sha256(wgslBytes) },
    weights: {
      path: weightsPath,
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
