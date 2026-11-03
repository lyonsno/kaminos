#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, stat, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { readSafetensorsHeader } from '../../webgpu-inference-kit/tools/sam-model.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function digest(path, options) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path, options)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
async function matches(path, row) {
  try {
    if ((await stat(path)).size !== row.bytes) return false;
    return (await digest(path)).sha256 === row.sha256;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function atomicJson(path, value) {
  const temporary = `${path}.partial-${randomUUID()}`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
function validateRecipe(recipe) {
  if (recipe.schema !== 'kaminos.qwen35-model-recipe.v1' || !/^[\w.-]+\/[\w.-]+$/.test(recipe.repo)
      || !/^[a-f0-9]{40}$/.test(recipe.revision) || !Array.isArray(recipe.files)) throw new Error('invalid model recipe');
  const names = new Set();
  for (const row of recipe.files) {
    if (!row.file || basename(row.file) !== row.file || row.file.includes('\\') || row.file === '.' || row.file === '..'
        || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || !/^[a-f0-9]{64}$/.test(row.sha256)
        || names.has(row.file) || ['weights.json', 'prepare-report.json'].includes(row.file)) throw new Error('invalid model artifact');
    names.add(row.file);
  }
  if (!names.has('config.json') || !names.has('tokenizer.json') || !recipe.files.some(row => row.file.endsWith('.safetensors'))) {
    throw new Error('recipe needs config, tokenizer and safetensors');
  }
}
async function acquire(output, row, recipe, fetchImpl, progress) {
  const path = join(output, row.file);
  progress({ phase: 'verify', file: row.file });
  if (await matches(path, row)) return 'reused';
  const url = `https://huggingface.co/${recipe.repo}/resolve/${recipe.revision}/${encodeURIComponent(row.file)}`;
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`download HTTP ${response.status}: ${row.file}`);
  const temporary = `${path}.partial-${randomUUID()}`;
  let loadedBytes = 0;
  const hash = createHash('sha256');
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
      loadedBytes += chunk.length; hash.update(chunk);
      try { progress({ phase: 'download', file: row.file, loadedBytes, totalBytes: row.bytes }); callback(null, chunk); }
      catch (error) { callback(error); }
    } }), createWriteStream(temporary));
    if (loadedBytes !== row.bytes || hash.digest('hex') !== row.sha256) throw new Error(`download SHA/length mismatch: ${row.file}`);
    await rename(temporary, path);
    return 'downloaded';
  } finally { await rm(temporary, { force: true }); }
}

export async function prepareModel({ outDir, recipe, fetchImpl = globalThis.fetch, onProgress = () => {} }) {
  if (!outDir) throw new Error('output directory is required');
  const output = resolve(outDir);
  await mkdir(output, { recursive: true });
  const report = { status: 'running', phase: 'recipe', output, repo: recipe?.repo, revision: recipe?.revision, files: [] };
  try {
    await atomicJson(join(output, 'prepare-report.json'), report);
    validateRecipe(recipe);
    report.phase = 'download';
    for (const row of recipe.files) {
      const status = await acquire(output, row, recipe, fetchImpl, onProgress);
      report.files.push({ ...row, status });
    }
    report.phase = 'index';
    const configBytes = await readFile(join(output, 'config.json'));
    const config = JSON.parse(configBytes);
    const q = config.quantization;
    if (config.model_type !== 'qwen3_5' || q?.bits !== 4 || q?.group_size !== 64 || q?.mode !== 'affine') {
      throw new Error('expected Qwen3.5 affine4/group64 quantization');
    }
    const tensors = {}, files = {};
    for (const { file } of recipe.files.filter(row => row.file.endsWith('.safetensors')).sort((a, b) => a.file.localeCompare(b.file))) {
      const path = join(output, file), header = await readSafetensorsHeader(path);
      files[file] = { bytes: header.size, headerSha256: (await digest(path, { start: 8, end: header.dataStart - 1 })).sha256 };
      for (const [name, row] of Object.entries(header.tensors)) {
        if (!name.startsWith('language_model.')) continue;
        const key = name.slice('language_model.'.length), offsets = row.data_offsets;
        if (Object.hasOwn(tensors, key)) throw new Error(`duplicate source ${name}`);
        const width = { U32: 4, BF16: 2 }[row.dtype];
        const elements = Array.isArray(row.shape) ? row.shape.reduce((a, b) => a * b, 1) : NaN;
        if (!width || !Number.isSafeInteger(elements) || row.shape.some(n => !Number.isSafeInteger(n) || n < 1)
            || !Array.isArray(offsets) || offsets.length !== 2 || offsets.some(n => !Number.isSafeInteger(n) || n < 0)
            || offsets[1] - offsets[0] !== elements * width || header.dataStart + offsets[1] > header.size) {
          throw new Error(`invalid source range/type ${name}`);
        }
        const offset = header.dataStart + offsets[0], bytes = offsets[1] - offsets[0];
        onProgress({ phase: 'index', file, tensor: name });
        const hashed = await digest(path, { start: offset, end: offset + bytes - 1 });
        if (hashed.bytes !== bytes) throw new Error(`partial source ${name}`);
        Object.defineProperty(tensors, key, { enumerable: true, value: { file, offset, bytes, shape: row.shape, dtype: row.dtype, sha256: hashed.sha256 } });
      }
    }
    if (!Object.keys(tensors).length) throw new Error('no language model tensors');
    const manifest = { schema: 'kaminos.qwen35-text-weights.v1', config,
      source: { localRoot: await realpath(output), configSha256: sha(configBytes), files }, tensors };
    await atomicJson(join(output, 'weights.json'), manifest);
    report.status = 'complete'; report.phase = 'complete'; report.manifest = join(output, 'weights.json');
    return report;
  } catch (error) { report.status = 'failed'; report.error = String(error.stack || error); throw error; }
  finally { await atomicJson(join(output, 'prepare-report.json'), report); }
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, recipe: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('Usage: node models/qwen3_5/prepare-model.mjs --out public/models/qwen [--recipe recipe.json]'); return; }
  const recipe = JSON.parse(await readFile(values.recipe || new URL('./model-recipe.json', import.meta.url), 'utf8'));
  let last = 0;
  const result = await prepareModel({ outDir: values.out, recipe, onProgress: event => {
    if (event.phase === 'download' && Date.now() - last < 250 && event.loadedBytes !== event.totalBytes) return;
    last = Date.now();
    process.stderr.write(`${event.phase}: ${event.file}${event.loadedBytes === undefined ? '' : ` ${event.loadedBytes}/${event.totalBytes} bytes`}\n`);
  } });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
