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
