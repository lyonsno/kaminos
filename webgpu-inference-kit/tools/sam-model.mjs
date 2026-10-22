#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, realpathSync } from 'node:fs';
import { mkdir, open, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';

export const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

async function readExactly(file, length, position) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await file.read(bytes, offset, length - offset, position + offset);
    if (!result.bytesRead) throw new Error('truncated safetensors file');
    offset += result.bytesRead;
  }
  return bytes;
}

// Safetensors: an unsigned LE header length, JSON tensor index, then contiguous data.
export async function readSafetensorsHeader(path) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const headerLength = Number((await readExactly(file, 8, 0)).readBigUInt64LE());
    if (!Number.isSafeInteger(headerLength) || headerLength < 2 || headerLength > size - 8) {
      throw new Error('invalid safetensors header length');
    }
    const tensors = JSON.parse((await readExactly(file, headerLength, 8)).toString('utf8'));
    return { tensors, dataStart: 8 + headerLength, size };
  } finally { await file.close(); }
}

export async function convertTensor(path, header, name) {
  const tensor = header.tensors[name];
  if (!tensor) throw new Error(`missing tensor ${name}`);
  const { dtype, shape, data_offsets: offsets } = tensor;
  const elementBytes = { BF16: 2, F32: 4 }[dtype];
  const count = shape?.reduce((a, b) => a * b, 1);
  if (!elementBytes || !Array.isArray(shape) || shape.some(n => !Number.isSafeInteger(n) || n < 0)
      || !Number.isSafeInteger(count) || !Array.isArray(offsets) || offsets.length !== 2
      || offsets.some(n => !Number.isSafeInteger(n) || n < 0)
      || offsets[1] - offsets[0] !== count * elementBytes || header.dataStart + offsets[1] > header.size) {
    throw new Error(`invalid tensor dtype/shape/length for ${name}`);
  }
  const file = await open(path, 'r');
  try {
    const bytes = await readExactly(file, count * elementBytes, header.dataStart + offsets[0]);
    if (dtype === 'F32') return bytes;
    const output = Buffer.alloc(count * 4);
    for (let i = 0; i < count; i += 1) output.writeUInt32LE(bytes.readUInt16LE(i * 2) * 65536, i * 4);
    return output;
  } finally { await file.close(); }
}

function outputPath(directory, name) {
  if (!name || basename(name) !== name || name === '.' || name === '..' || name.includes('\\')) {
    throw new Error(`unsafe model artifact path ${name}`);
  }
  return join(directory, name);
}
async function matches(path, expected) {
  try { return await hashFile(path) === expected; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function download(url, path, expected, fetchImpl) {
  if (await matches(path, expected)) return;
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`model download HTTP ${response.status}: ${url}`);
  const temporary = `${path}.partial-${process.pid}`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  if (!await matches(temporary, expected)) throw new Error(`download SHA mismatch: ${url}`);
  await rename(temporary, path);
}
async function writeJson(path, value) {
  const text = JSON.stringify(value, null, 2);
  await writeFile(path, text);
  return { file: basename(path), schema: value.schema, sha256: sha256(text) };
}

export async function prepareSamModel({ recipe, outDir, checkpoint, cacheDir,
  fetch: fetchImpl = globalThis.fetch, onProgress = () => {} }) {
  const output = resolve(outDir);
  await mkdir(output, { recursive: true });
  const report = { schema: 'kaminos.sam3-model-prepare-report.v1', status: 'running', phase: 'checkpoint',
    runId: randomUUID(), startedAt: new Date().toISOString(),
    modelPackageId: recipe.modelPackage?.packageId, checkpointSha256: recipe.checkpoint?.sha256, artifacts: [] };
  try {
    await writeJson(join(output, 'prepare-report.json'), report);
    if (recipe.schema !== 'kaminos.sam3-portable-model-recipe.v1') throw new Error('unsupported SAM model recipe');
    for (const row of [...recipe.modelPackage.weights, ...recipe.assets]) outputPath(output, row.file);
    let source = checkpoint;
    if (!source) {
      const cache = resolve(cacheDir || join(output, '.download-cache'));
      await mkdir(cache, { recursive: true });
      source = join(cache, `${recipe.checkpoint.sha256.slice(7)}.safetensors`);
      onProgress('Downloading pinned SAM checkpoint');
      await download(recipe.checkpoint.url, source, recipe.checkpoint.sha256, fetchImpl);
    }
    if (!await matches(source, recipe.checkpoint.sha256)) throw new Error('checkpoint SHA mismatch');
    const header = await readSafetensorsHeader(source);
    report.phase = 'convert-weights';
    await writeJson(join(output, 'prepare-report.json'), report);
    for (const weight of recipe.modelPackage.weights) {
      const path = outputPath(output, weight.file);
      if (!await matches(path, weight.sha256)) {
        const bytes = await convertTensor(source, header, recipe.tensors[weight.file]);
        if (bytes.length !== weight.byteLength || sha256(bytes) !== weight.sha256) {
          throw new Error(`converted weight SHA/length mismatch: ${weight.role}`);
        }
        await writeFile(path, bytes);
      }
      report.artifacts.push({ file: weight.file, sha256: weight.sha256, byteLength: weight.byteLength });
      onProgress(`Verified ${report.artifacts.length}/${recipe.modelPackage.weights.length} weights`);
    }
    report.phase = 'assets';
    await writeJson(join(output, 'prepare-report.json'), report);
    for (const asset of recipe.assets) {
      await download(asset.url, outputPath(output, asset.file), asset.sha256, fetchImpl);
      report.artifacts.push({ file: asset.file, sha256: asset.sha256 });
    }
    report.phase = 'manifest';
    await writeJson(join(output, 'prepare-report.json'), report);
    const modelPackage = await writeJson(join(output, 'sam3-model-package.json'), recipe.modelPackage);
    const invocation = await writeJson(join(output, 'sam3-invocation.json'), recipe.invocation);
    await writeJson(join(output, 'tensor-manifest.json'), { ...recipe.root, modelPackage, invocation });
    report.status = 'complete'; report.phase = 'complete';
    report.manifest = join(output, 'tensor-manifest.json');
    return report;
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error);
    throw error;
  } finally { await writeJson(join(output, 'prepare-report.json'), report); }
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, checkpoint: { type: 'string' },
    cache: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: kaminos-sam-model --out public/models/sam3 [--checkpoint model.safetensors] [--cache directory]');
    return;
  }
  if (!values.out) throw new Error('--out directory is required');
  const recipe = JSON.parse(await readFile(new URL('../models/sam3-native.json', import.meta.url), 'utf8'));
  const result = await prepareSamModel({ recipe, outDir: values.out, checkpoint: values.checkpoint,
    cacheDir: values.cache || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'kaminos', 'sam3'),
    onProgress: message => process.stderr.write(`${message}\n`) });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
