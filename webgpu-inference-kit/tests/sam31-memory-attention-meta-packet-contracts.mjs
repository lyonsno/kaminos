import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSam31MemoryAttentionPhaseProgramCpuOracle } from '../src/index.js';

const root = new URL('../', import.meta.url);
const exporter = new URL('../tools/sam31-memory-attention-meta-packet.py', import.meta.url);
const python = process.env.SAM31_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const outDir = await mkdtemp(join(tmpdir(), 'sam31-memory-attention-meta-'));
const run = spawnSync(python, [exporter.pathname, '--out-dir', outDir], { cwd: root.pathname, encoding: 'utf8', timeout: 180000 });
assert.equal(run.status, 0, run.stderr);
const manifest = JSON.parse(await readFile(join(outDir, 'tensor-manifest.json'), 'utf8'));
const receipt = JSON.parse(await readFile(join(outDir, 'reference-receipt.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.sam31-memory-attention-meta-packet.v0');
assert.equal(manifest.routeId, 'sam3.1.memory-attention.phase-program.webgpu-local.v0');
assert.equal(manifest.reference.model.revision, 'daa63191845a41281374e725f4c9e51c7a824460');
assert.equal(manifest.reference.model.sha256, 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6');
assert.equal(manifest.reference.source.commit, '5dd401d1c5c1d5c3eedff06d41b77af824517619');
assert.equal(manifest.reference.source.workingTreeClean, true);
assert.equal(manifest.reference.execution.kind, 'pinned-official-module-class');
assert.equal(manifest.reference.execution.class, 'sam3.model.decoder.TransformerEncoderDecoupledCrossAttention');
assert.equal(manifest.shape.layerCount, 4);
assert.equal(manifest.shape.heads, 8);
assert.equal(manifest.shape.headDim, 32);
assert.equal(manifest.shape.numObjPtrTokens, 16);
assert.equal(manifest.shape.memoryTokens, 20);
assert.equal(manifest.fixture.officialVideoPath, false);
assert.equal(manifest.weights.length, 122);
for (let layer = 0; layer < 4; layer += 1) {
  assert.ok(manifest.tensors.some(entry => entry.role === `expected-layer-${layer}-memory`), `official packet must preserve layer ${layer} output`);
}

const effectiveSourceRoot = process.env.KAMINOS_SAM31_SOURCE_ROOT || '/Users/noahlyons/dev/sam3';
const dirtySourceRoot = join(outDir, 'dirty-source-checkout');
const cloneDirtySource = spawnSync('git', ['clone', '--shared', '--no-hardlinks', effectiveSourceRoot, dirtySourceRoot], { encoding: 'utf8', timeout: 120000 });
assert.equal(cloneDirtySource.status, 0, cloneDirtySource.stderr || cloneDirtySource.stdout);
await writeFile(join(dirtySourceRoot, 'sam3/model/decoder.py'), '\n# fail-first same-commit decoder drift\n', { flag: 'a' });
const dirtySourceOut = join(outDir, 'dirty-source-out');
const dirtySourceRun = spawnSync(python, [exporter.pathname, '--out-dir', dirtySourceOut, '--source-root', dirtySourceRoot], { cwd: root.pathname, encoding: 'utf8', timeout: 180000 });
assert.notEqual(dirtySourceRun.status, 0, 'attention exporter must reject same-commit dirty official decoder source');
assert.match(dirtySourceRun.stderr, /source working tree is dirty/);
const dirtyReceipt = JSON.parse(await readFile(join(dirtySourceOut, 'reference-receipt.json'), 'utf8'));
assert.equal(dirtyReceipt.failurePhase, 'identity-validation');

const wrongCheckpoint = join(outDir, 'wrong-checkpoint.pt');
const createWrongCheckpoint = spawnSync(python, ['-c', 'import sys, torch; torch.save({}, sys.argv[1])', wrongCheckpoint], { encoding: 'utf8', timeout: 30000 });
assert.equal(createWrongCheckpoint.status, 0, createWrongCheckpoint.stderr);
const staleOut = join(outDir, 'stale-failure-out');
await mkdir(staleOut, { recursive: true });
await writeFile(join(staleOut, 'tensor-manifest.json'), '{"stale":true}\n');
await writeFile(join(staleOut, 'stale-primary.bin'), 'stale');
const wrongCheckpointRun = spawnSync(python, [exporter.pathname, '--out-dir', staleOut, '--checkpoint', wrongCheckpoint], { cwd: root.pathname, encoding: 'utf8', timeout: 180000 });
assert.notEqual(wrongCheckpointRun.status, 0, 'attention exporter must reject wrong checkpoint identity');
await assert.rejects(stat(join(staleOut, 'tensor-manifest.json')), { code: 'ENOENT' });
await assert.rejects(stat(join(staleOut, 'stale-primary.bin')), { code: 'ENOENT' });
const staleFailureReceipt = JSON.parse(await readFile(join(staleOut, 'reference-receipt.json'), 'utf8'));
assert.equal(staleFailureReceipt.failurePhase, 'identity-validation');

const tensorEntries = Object.fromEntries(manifest.tensors.map(entry => [entry.role, entry]));
const weightEntries = Object.fromEntries(manifest.weights.map(entry => [entry.role, entry]));
const load = async entry => {
  const bytes = await readFile(join(outDir, entry.file));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const weight = role => load(weightEntries[role]);
const projection = async (prefix, inChannels, outChannels) => ({ weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), inChannels, outChannels });
const norm = async prefix => ({ weight: await weight(`${prefix}-weight`), bias: await weight(`${prefix}-bias`), epsilon: 1e-5 });
const layers = [];
for (let index = 0; index < 4; index += 1) {
  const prefix = `layer-${index}`;
  layers.push({
    norm1: await norm(`${prefix}-norm1`),
    selfQ: await projection(`${prefix}-self-q`, 256, 256), selfK: await projection(`${prefix}-self-k`, 256, 256), selfV: await projection(`${prefix}-self-v`, 256, 256), selfOut: await projection(`${prefix}-self-out`, 256, 256),
    norm2: await norm(`${prefix}-norm2`),
    crossQ: await projection(`${prefix}-cross-q`, 256, 256), crossK: await projection(`${prefix}-cross-k`, 256, 256), crossV: await projection(`${prefix}-cross-v`, 256, 256), crossOut: await projection(`${prefix}-cross-out`, 256, 256),
    imageCrossQ: await projection(`${prefix}-image-cross-q`, 256, 256), imageCrossK: await projection(`${prefix}-image-cross-k`, 256, 256),
    norm3: await norm(`${prefix}-norm3`),
    linear1: await projection(`${prefix}-linear1`, 256, 2048), linear2: await projection(`${prefix}-linear2`, 2048, 256),
  });
}
const oracle = createSam31MemoryAttentionPhaseProgramCpuOracle({
  shape: manifest.shape,
  current: { image: await load(tensorEntries['current-image']), src: await load(tensorEntries['current-src']), srcPos: await load(tensorEntries['current-src-pos']) },
  bank: { memoryImage: await load(tensorEntries['memory-image']), memory: await load(tensorEntries.memory), memoryImagePos: await load(tensorEntries['memory-image-pos']), memoryPos: await load(tensorEntries['memory-pos']) },
  layers,
  finalNorm: await norm('final-norm'),
});
const expected = await load(tensorEntries['expected-memory']);
assert.equal(oracle.layerOutputs.length, 4, 'CPU oracle must expose all four pre-final-norm layer boundaries');
let maximum = 0;
for (let index = 0; index < expected.length; index += 1) maximum = Math.max(maximum, Math.abs(expected[index] - oracle.memory[index]));
assert.ok(maximum <= manifest.tolerances.cpuOracleMaxAbsDiff, `CPU oracle max abs diff ${maximum}`);
for (let layer = 0; layer < 4; layer += 1) {
  const expectedLayer = await load(tensorEntries[`expected-layer-${layer}-memory`]);
  const layerDiff = Math.max(...expectedLayer.map((value, index) => Math.abs(value - oracle.layerOutputs[layer][index])));
  assert.ok(layerDiff <= manifest.tolerances.cpuOracleMaxAbsDiff, `CPU oracle layer ${layer} max abs diff ${layerDiff}`);
}
assert.equal(receipt.ok, true);
assert.equal(receipt.checkpointAudit.mappedTensorCount, 122);
console.log(JSON.stringify({ ok: true, cpuOracleMaxAbsDiff: maximum, mappedTensorCount: manifest.weights.length }));
await rm(outDir, { recursive: true, force: true });
