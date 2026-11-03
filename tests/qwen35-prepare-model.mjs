// kaminos-test: node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareModel } from '../models/qwen3_5/prepare-model.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'qwen-prepare-'));
const config = { model_type: 'qwen3_5', quantization: { bits: 4, group_size: 64, mode: 'affine' } };
function shard(tensors) {
  const header = Buffer.from(JSON.stringify(tensors));
  const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, header, Buffer.from([0x80, 0x3f, 0, 0, 1, 0, 0, 0])]);
}
const tensor = { dtype: 'U32', shape: [1], data_offsets: [4, 8] };
const files = {
  'config.json': Buffer.from(JSON.stringify(config)),
  'tokenizer.json': Buffer.from('{}'),
  'a.safetensors': shard({ 'vision.weight': { dtype: 'BF16', shape: [2], data_offsets: [0, 4] }, 'language_model.model.weight': tensor }),
};
const recipeFor = data => ({ schema: 'kaminos.qwen35-model-recipe.v1', repo: 'fixture/model', revision: '1'.repeat(40),
  files: Object.entries(data).map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: sha(bytes) })) });
const recipe = recipeFor(files);
let requests = 0;
const fetchImpl = async url => {
  requests++;
  assert.match(url, /fixture\/model\/resolve\/1{40}\//);
  return new Response(files[new URL(url).pathname.split('/').pop()]);
};
try {
  const progress = [];
  const out = join(root, 'package');
  const result = await prepareModel({ outDir: out, recipe, fetchImpl, onProgress: event => progress.push(event) });
  assert.equal(result.status, 'complete', 'preparation must produce a usable model package');
  const manifest = JSON.parse(await readFile(join(out, 'weights.json')));
  assert.equal(manifest.schema, 'kaminos.qwen35-text-weights.v1');
  assert.deepEqual(Object.keys(manifest.tensors), ['model.weight']);
  assert.equal(manifest.tensors['model.weight'].sha256, sha(Buffer.from([1, 0, 0, 0])));
  assert.equal(manifest.tensors['model.weight'].offset, files['a.safetensors'].length - 4);
  assert.ok(progress.some(event => event.phase === 'download' && event.loadedBytes > 0));
  assert.ok(progress.some(event => event.phase === 'index'));
  assert.equal(requests, 3);
  await prepareModel({ outDir: out, recipe, fetchImpl });
  assert.equal(requests, 3, 'verified files must be reused');
  await writeFile(join(out, 'tokenizer.json'), 'xx');
  await prepareModel({ outDir: out, recipe, fetchImpl });
  assert.equal(requests, 4, 'same-size corrupted files must be repaired');

  // The existing independent exporter defines the manifest consumed by the browser.
  const oracle = spawnSync(process.env.KAMINOS_PYTHON ?? 'python3', ['models/qwen3_5/export-model-reference.py',
    '--model-dir', out, '--out', join(root, 'oracle'), '--report', join(root, 'oracle-report.json'), '--manifest-only'], { encoding: 'utf8' });
  assert.equal(oracle.status, 0, oracle.stderr);
  assert.deepEqual(manifest, JSON.parse(await readFile(join(root, 'oracle', 'weights.json'))));

  const bad = join(root, 'bad');
  await assert.rejects(prepareModel({ outDir: bad, recipe, fetchImpl: async () => new Response('wrong') }), /SHA|length/);
  const failure = JSON.parse(await readFile(join(bad, 'prepare-report.json')));
  assert.equal(failure.status, 'failed'); assert.equal(failure.phase, 'download');
  assert.ok(!(await readdir(bad)).includes('weights.json'));
  assert.ok(!(await readdir(bad)).some(name => name.includes('.partial-')));

  for (const [name, data] of Object.entries({
    duplicate: { ...files, 'b.safetensors': files['a.safetensors'] },
    range: { ...files, 'a.safetensors': shard({ 'language_model.broken': { ...tensor, data_offsets: [4, 99] } }) },
    config: { ...files, 'config.json': Buffer.from(JSON.stringify({ ...config, quantization: { bits: 8 } })) },
  })) {
    await assert.rejects(prepareModel({ outDir: join(root, name), recipe: recipeFor(data),
      fetchImpl: async url => new Response(data[new URL(url).pathname.split('/').pop()]) }), /duplicate|range|quantization/);
  }
  await assert.rejects(prepareModel({ outDir: join(root, 'unsafe'), recipe: { ...recipe, files: [{ ...recipe.files[0], file: '../escape' }] }, fetchImpl }), /artifact/);
  const recipePath = join(root, 'recipe.json'); await writeFile(recipePath, JSON.stringify(recipe));
  const cli = spawnSync(process.execPath, ['models/qwen3_5/prepare-model.mjs', '--out', out, '--recipe', recipePath], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status, 'complete', 'the preparation CLI must not need Python or external commands');
  console.log('Qwen Node preparation: range parity, reuse, corruption, failures and Python-free CLI pass');
} finally { await rm(root, { recursive: true, force: true }); }
