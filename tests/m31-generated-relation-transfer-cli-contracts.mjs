import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), 'm31-transfer-cli-'));
const sourcePath = join(directory, 'source.json');
const outputPath = join(directory, 'transfer.json');
const crossoverOutputPath = join(directory, 'crossover.json');

await writeFile(sourcePath, JSON.stringify({
  schema: 'kaminos.m31-generated-relation-source-fixture.v0',
  requestedRoute: 'm31-generated-relation-positive-volume-c-p0-transfer',
  effectiveRoute: 'wrong-route',
  fallbackUsed: false,
  source: {},
}));

const result = spawnSync(process.execPath, [
  join(root, 'm31-generated-relation-transfer.mjs'),
  '--source-fixture', sourcePath,
  '--output', outputPath,
], { encoding: 'utf8' });

assert.equal(result.status, 1);
const receipt = JSON.parse(await readFile(outputPath, 'utf8'));
assert.equal(receipt.status, 'M31_TRANSFER_FAILED');
assert.equal(receipt.failurePhase, 'route-validation');
assert.equal(receipt.requestedRoute,
  'm31-generated-relation-positive-volume-c-p0-transfer');
assert.equal(receipt.effectiveRoute, 'wrong-route');
assert.equal(receipt.fallbackUsed, false);
assert.equal(receipt.primaryOutput, null);

const missingOutput = spawnSync(process.execPath, [
  join(root, 'm31-generated-relation-transfer.mjs'),
  '--source-fixture', sourcePath,
], { encoding: 'utf8' });
assert.equal(missingOutput.status, 1);
assert.match(missingOutput.stderr, /--output requires a path/);

const realSourcePath = join(root,
  'artifacts/m31-generated-relation-positive-volume-transfer-v0/source-fixture.json');
const crossoverResult = spawnSync(process.execPath, [
  join(root, 'm31-generated-relation-transfer.mjs'),
  '--source-fixture', realSourcePath,
  '--output', crossoverOutputPath,
  '--crossover-angle', '35',
], { encoding: 'utf8' });
assert.equal(crossoverResult.status, 0, crossoverResult.stderr);
const crossoverReceipt = JSON.parse(await readFile(crossoverOutputPath, 'utf8'));
assert.equal(crossoverReceipt.schema, 'kaminos.m31-generated-relation-crossover.v0');
assert.deepEqual(crossoverReceipt.poses.map(pose => pose.angleDegrees), [0, 35]);
assert.equal(crossoverReceipt.classificationPredicate.effectiveAngleDegrees, 35);
assert.equal(crossoverReceipt.classificationPredicate.visibleRetentionPass, null);

const wrongCrossoverAngle = spawnSync(process.execPath, [
  join(root, 'm31-generated-relation-transfer.mjs'),
  '--source-fixture', realSourcePath,
  '--output', crossoverOutputPath,
  '--crossover-angle', '34',
], { encoding: 'utf8' });
assert.equal(wrongCrossoverAngle.status, 1);
assert.match(wrongCrossoverAngle.stderr, /only --crossover-angle 35 is admitted/);

console.log('m31 generated-relation transfer CLI contracts passed');
