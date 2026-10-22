// kaminos-test: node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = new URL('../tools/sam-model.mjs', import.meta.url);
assert.ok(existsSync(entry), 'SAM model preparation must not require MLX or a shop checkout');
const { readSafetensorsHeader, convertTensor, prepareSamModel } = await import(entry);
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const directory = await mkdtemp(join(tmpdir(), 'sam-model-prepare-'));
try {
  const bin = join(directory, 'kaminos-sam-model');
  await symlink(fileURLToPath(entry), bin);
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: kaminos-sam-model/, 'npm bin symlink must actually invoke the CLI');
  const raw = Buffer.from([0x80, 0x3f, 0, 0xc0]); // BF16 1, -2
  const header = Buffer.from(JSON.stringify({ weight: { dtype: 'BF16', shape: [2], data_offsets: [0, 4] } }));
  const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(header.length));
  const checkpoint = Buffer.concat([length, header, raw]);
  const input = join(directory, 'model.safetensors');
  await writeFile(input, checkpoint);
  const parsed = await readSafetensorsHeader(input);
  const converted = await convertTensor(input, parsed, 'weight');
  assert.equal(converted.readFloatLE(0), 1); assert.equal(converted.readFloatLE(4), -2);
  await assert.rejects(convertTensor(input, parsed, 'absent'), /missing tensor/);
  await assert.rejects(convertTensor(input, { ...parsed, tensors: { weight: { dtype: 'BF16', shape: [3], data_offsets: [0, 4] } } }, 'weight'), /shape|length/);
  const recipe = { schema: 'kaminos.sam3-portable-model-recipe.v1', checkpoint: {
    url: 'https://invalid.test/checkpoint', sha256: digest(checkpoint) },
    modelPackage: { schema: 'fixture-model', packageId: 'fixture', weights: [{ role: 'weight', file: 'weight.f32.bin',
      sha256: digest(converted), byteLength: 8, shape: [2] }] },
    tensors: { 'weight.f32.bin': 'weight' }, assets: [], root: { schema: 'fixture-root' },
    invocation: { schema: 'fixture-invocation' } };
  const out = join(directory, 'out');
  await prepareSamModel({ recipe, checkpoint: input, outDir: out });
  assert.deepEqual(await readFile(join(out, 'weight.f32.bin')), converted);
  assert.equal(JSON.parse(await readFile(join(out, 'prepare-report.json'))).status, 'complete');
  await writeFile(join(out, 'weight.f32.bin'), 'corrupt');
  await prepareSamModel({ recipe, checkpoint: input, outDir: out });
  assert.deepEqual(await readFile(join(out, 'weight.f32.bin')), converted, 'rerun repairs a corrupt output');
  await assert.rejects(prepareSamModel({ recipe: { ...recipe, tensors: { 'weight.f32.bin': 'absent' } },
    checkpoint: input, outDir: join(directory, 'failed') }), /missing tensor/);
  const failed = JSON.parse(await readFile(join(directory, 'failed', 'prepare-report.json')));
  assert.equal(failed.status, 'failed'); assert.equal(failed.phase, 'convert-weights');
  await assert.rejects(prepareSamModel({ recipe: { ...recipe, checkpoint: { ...recipe.checkpoint, sha256: digest('wrong') } },
    checkpoint: input, outDir: join(directory, 'wrong') }), /checkpoint.*SHA/);
  await assert.rejects(prepareSamModel({ recipe: { ...recipe, modelPackage: { ...recipe.modelPackage,
    weights: [{ ...recipe.modelPackage.weights[0], file: '../escape' }] } }, checkpoint: input,
    outDir: join(directory, 'escape') }), /path/);
  const token = Buffer.from('tokenizer fixture');
  const withAsset = { ...recipe, assets: [{ file: 'vocab.json', sha256: digest(token), url: 'https://model.test/vocab' }] };
  let releaseAsset, assetStarted;
  const assetAdmission = new Promise(resolve => { assetStarted = resolve; });
  const rerun = prepareSamModel({ recipe: withAsset, checkpoint: input, outDir: out,
    fetch: async () => { assetStarted(); return new Promise(resolve => { releaseAsset = resolve; }); } });
  await assetAdmission;
  const duringRerun = JSON.parse(await readFile(join(out, 'prepare-report.json')));
  releaseAsset(new Response(token));
  await rerun;
  assert.equal(duringRerun.status, 'running', 'a new preparation must replace an old completion before doing work');
  assert.equal(duringRerun.phase, 'assets');
  const fetched = [];
  await prepareSamModel({ recipe: withAsset, outDir: join(directory, 'download'),
    fetch: async url => { fetched.push(url); return new Response(url.endsWith('/vocab') ? token : checkpoint); } });
  assert.equal(fetched.length, 2);
  assert.deepEqual(await readFile(join(directory, 'download', 'vocab.json')), token);
  await assert.rejects(prepareSamModel({ recipe: withAsset, checkpoint: input, outDir: join(directory, 'bad-asset'),
    fetch: async () => new Response('wrong bytes') }), /SHA mismatch/);
  assert.equal(JSON.parse(await readFile(join(directory, 'bad-asset', 'prepare-report.json'))).phase, 'assets');
  await assert.rejects(prepareSamModel({ recipe, outDir: join(directory, 'http-failure'),
    fetch: async () => new Response('denied', { status: 403 }) }), /HTTP 403/);
  console.log('SAM portable model preparation contracts passed (small binary fixture)');
} finally { await rm(directory, { recursive: true, force: true }); }
