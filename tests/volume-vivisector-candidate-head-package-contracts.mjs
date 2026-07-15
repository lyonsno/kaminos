#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const producerPath = join(root, 'volume-vivisector-candidate-head-package.py');

assert.ok(existsSync(producerPath), 'Vivisector candidate-head package producer exists');
const source = readFileSync(producerPath, 'utf8');

for (const contract of [
  'kaminos.native-low.vivisector-candidate-head-width32-package.v0',
  'currentSource[0..16]',
  'sourceDelta[0..16]',
  'normalizedPosition[xyz]',
  'subcell[xyz]',
  'coarseLatent[0..7]',
  'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
  'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
  'compact-renderer-facing-cue-record-v0',
  'source-manifests-only-fixed-threshold-v0',
  'targetErrorRankingUsed',
  'hiddenCandidateCap',
  'coarseOutputs',
  'failurePhase',
]) {
  assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `producer carries ${contract}`);
}

const unit = spawnSync('python3', [producerPath, '--contract-self-test'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(unit.status, 0, unit.stderr || unit.stdout);
const receipt = JSON.parse(unit.stdout);
assert.equal(receipt.ok, true);
assert.equal(receipt.featureCount, 48);
assert.equal(receipt.hiddenWidth, 32);
assert.equal(receipt.outputCount, 8);
assert.deepEqual(receipt.featureOrder, [
  'currentSource[0..16]',
  'sourceDelta[0..16]',
  'normalizedPosition[xyz]',
  'subcell[xyz]',
  'coarseLatent[0..7]',
]);
assert.deepEqual(receipt.outputOrder, [
  'fineSupport',
  'frontTopologyResidual',
  'temporalFrontDetail',
  'ridgeResidual',
  'fuelResidual',
  'visibleFireCarrierResidual',
  'fireLickResidual',
  'detailResidual',
]);
assert.equal(receipt.sourceOnlyAdmission, true);
assert.equal(receipt.runtimeTopK, false);
assert.equal(receipt.hiddenCandidateCap, false);
assert.equal(receipt.targetErrorRankingUsed, false);

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-vivisector-package-failure-'));
try {
  const failed = spawnSync('python3', [
    producerPath,
    '--corpus-root', join(failureRoot, 'missing-corpus'),
    '--out-dir', join(failureRoot, 'out'),
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(failed.status, 1, 'missing corpus must fail before primary output');
  const failureManifest = JSON.parse(readFileSync(join(failureRoot, 'out', 'manifest.json'), 'utf8'));
  assert.equal(failureManifest.status, 'failed');
  assert.equal(failureManifest.failurePhase, 'input-validation');
  assert.equal(failureManifest.runtimeTruthUsedForAdmission, false);
  assert.equal(failureManifest.targetErrorRankingUsed, false);
  assert.equal(failureManifest.hiddenCandidateCap, false);
  assert.ok(failureManifest.lastTrustworthyEvidence, 'pre-output failure preserves last trustworthy evidence');
} finally {
  rmSync(failureRoot, { recursive: true, force: true });
}

console.log('volume Vivisector candidate-head package contracts passed');
