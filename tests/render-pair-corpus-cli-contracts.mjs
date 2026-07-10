import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const workDir = mkdtempSync(join(tmpdir(), 'kaminos-render-pair-corpus-contract-'));
const outRoot = join(workDir, 'alias-out-root');
const manifestPath = join(workDir, 'corpus-manifest.json');
const variantPath = join(workDir, 'variant.json');
const leasePath = join(workDir, 'browser-capture.lock.json');

writeFileSync(variantPath, JSON.stringify({
  variants: [{
    id: 'alias-contract',
    settleMs: 1,
    overrides: { volume_scene: 'tall_plume' },
  }],
}, null, 2));

const result = spawnSync(process.execPath, [
  'volume-render-pair-corpus.mjs',
  '--dry-run',
  '--out-root', outRoot,
  '--manifest', manifestPath,
  '--capture-lease-path', leasePath,
  '--variant-file', variantPath,
  '--sequence-mode', 'controlled-step',
  '--frames-per-sequence', '2',
  '--low-render-scales', '0.10',
  '--high-render-scale', '1',
], {
  cwd: root,
  encoding: 'utf8',
});

assert.equal(result.status, 0, `corpus dry-run failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(
  manifest.outRoot,
  outRoot,
  'volume-render-pair-corpus must honor --out-root as an alias for --out-dir so caller-owned artifact roots do not silently fall back',
);
assert.equal(manifest.variants[0].manifestPath.startsWith(outRoot), true);
assert.equal(
  manifest.witnessBrowserSession.captureLease.path,
  leasePath,
  'corpus capture must record caller-owned browser lease path so concurrent lanes can see the effective contention surface',
);
assert.equal(
  manifest.witnessBrowserSession.captureLease.status,
  'released',
  'corpus capture must release its browser lease in the final manifest even for dry-run paths',
);

const heldLeasePath = join(workDir, 'held-browser-capture.lock.json');
const heldManifestPath = join(workDir, 'held-corpus-manifest.json');
writeFileSync(heldLeasePath, JSON.stringify({
  schema: 'kaminos.volume.browser-capture-lease.v0',
  pid: process.pid,
  owner: 'render-pair-corpus-cli-contracts-held-lease',
  cwd: root,
  createdAt: new Date().toISOString(),
}, null, 2));

const heldResult = spawnSync(process.execPath, [
  'volume-render-pair-corpus.mjs',
  '--dry-run',
  '--out-root', join(workDir, 'held-out-root'),
  '--manifest', heldManifestPath,
  '--capture-lease-path', heldLeasePath,
  '--variant-file', variantPath,
  '--sequence-mode', 'controlled-step',
  '--frames-per-sequence', '2',
  '--low-render-scales', '0.10',
  '--high-render-scale', '1',
], {
  cwd: root,
  encoding: 'utf8',
});

assert.notEqual(
  heldResult.status,
  0,
  'corpus capture must refuse to run while a live browser-capture lease is held instead of opening another simulator tab',
);
const heldManifest = JSON.parse(readFileSync(heldManifestPath, 'utf8'));
assert.equal(heldManifest.status, 'failed');
assert.equal(heldManifest.failures[0].failurePhase, 'capture-lease-acquire');
assert.equal(heldManifest.witnessBrowserSession.captureLease.status, 'blocked-live-holder');
