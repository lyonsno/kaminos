import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sampler = new URL('../lirm-silhouette-latent-sample.py', import.meta.url);
assert.ok(existsSync(sampler), 'silhouette checkpoint sampler must exist');

const root = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-latent-sample-contract-'));
const sourceRun = join(root, 'source-run');
const outDir = join(root, 'sample-run');
await mkdir(sourceRun, { recursive: true });
await writeFile(join(sourceRun, 'receipt.json'), `${JSON.stringify({
  schema: 'kaminos.lirm-silhouette-latent-model.v0',
  status: 'complete',
  phase: 'witness_written',
  routeIdentity: {
    requestedRoute: 'kaminos/lirm-speciation-armature/silhouette-latent-model-v0',
    effectiveRoute: 'mlx-convolutional-sdf-vae-v0',
  },
  requestedConfig: { seed: 713, validationFraction: 0.1, copyThreshold: 0.94 },
  effectiveConfig: {
    schema: 'kaminos.lirm-silhouette-latent-model-config.v0',
    architecture: 'mlx-convolutional-sdf-vae-v0',
    inputShape: [128, 128, 1],
    latentDim: 32,
    channels: [16, 32, 64],
    beta: 0.01,
    maskDecode: 'normalized_sdf > 0',
  },
  corpora: [],
}, null, 2)}\n`);

const run = spawnSync('python3', [
  sampler.pathname,
  '--model-run-dir', sourceRun,
  '--out-dir', outDir,
  '--samples', '257',
  '--seed', '991',
  '--temperature', '0.7',
], { encoding: 'utf8' });
assert.notEqual(run.status, 0, 'missing checkpoint must fail sampling');
const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-silhouette-latent-sample.v0');
assert.equal(receipt.status, 'failed');
assert.equal(receipt.failurePhase, 'source_validation');
assert.equal(receipt.routeIdentity.requestedRoute, 'kaminos/lirm-speciation-armature/silhouette-latent-sample-v0');
assert.equal(receipt.routeIdentity.effectiveRoute, 'mlx-sdf-vae-prior-sample-v0');
assert.equal(receipt.requestedConfig.samples, 257, 'sampler must preserve the uncapped requested count');
assert.equal(receipt.requestedConfig.seed, 991);
assert.equal(receipt.requestedConfig.temperature, 0.7);
assert.match(receipt.sourceModel.receiptHash, /^sha256:/);
assert.equal(receipt.falseClosureGuards.sourceCheckpointValidated, false);
assert.equal(receipt.falseClosureGuards.generatedFieldCount, 0);
assert.equal(receipt.falseClosureGuards.contactSheetRasterWritten, false);
assert.match(receipt.errorMessage, /model\.safetensors/);
