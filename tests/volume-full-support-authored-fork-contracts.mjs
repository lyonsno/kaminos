#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../volume-full-support-authored-fork.mjs', import.meta.url));
assert.ok(existsSync(cli), 'authored-fork writer CLI must exist');

const root = mkdtempSync(join(tmpdir(), 'kaminos-full-support-fork-'));
const receiptPath = join(root, 'source-receipt.json');
const controlsPath = join(root, 'controls.json');
const outputPath = join(root, 'operator', 'thin-flame.json');
writeFileSync(receiptPath, `${JSON.stringify({
  schema: 'kaminos.pyro.full-support-stage-a-receipt.v0',
  status: 'effective',
  requestedSource: 'learned-flow',
  effectiveSource: 'learned-flow',
  requestedDeposition: 'flow-tangent-five-tap-bilinear-v0',
  effectiveDeposition: 'flow-tangent-five-tap-bilinear-v0',
  requestedTransport: 'per-splat-self-extinction-additive-rgb-v0',
  effectiveTransport: 'per-splat-self-extinction-additive-rgb-v0',
  rowCount: 1_899_742,
  overflowCount: 0,
  fallbackUsed: false,
  failures: [],
}, null, 2)}\n`);
writeFileSync(controlsPath, `${JSON.stringify({ exposure: 0.96, smoke: 0 }, null, 2)}\n`);

const result = spawnSync(process.execPath, [
  cli,
  '--name', 'thin-flame',
  '--output', outputPath,
  '--source-receipt', receiptPath,
  '--controls', controlsPath,
], { encoding: 'utf8', timeout: 30_000 });
assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
const receipt = JSON.parse(result.stdout.trim());
assert.equal(receipt.status, 'written');
assert.equal(receipt.outputPath, outputPath);
assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
const artifact = JSON.parse(readFileSync(outputPath, 'utf8'));
assert.equal(artifact.schema, 'kaminos.pyro.full-support-authored-fork.v0');
assert.equal(artifact.name, 'thin-flame');
assert.equal(artifact.sourceReceipt.status, 'effective');
assert.deepEqual(artifact.controls, { exposure: 0.96, smoke: 0 });
assert.equal(artifact.originalEvidenceImmutable, true);

const rejected = spawnSync(process.execPath, [
  cli,
  '--name', 'missing-path',
  '--source-receipt', receiptPath,
  '--controls', controlsPath,
], { encoding: 'utf8', timeout: 30_000 });
assert.notEqual(rejected.status, 0, 'caller-owned output path must be mandatory');
assert.match(rejected.stderr, /--output is required/);

console.log('volume full-support authored fork contracts passed');
