import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const datasetDir = mkdtempSync(join(tmpdir(), 'kaminos-render-pair-dataset-contract-'));
try {
  const manifestPath = join(datasetDir, 'manifest.json');
  const result = runNode([
    'volume-render-pair-dataset.mjs',
    '--dry-run',
    '--out-dir', datasetDir,
    '--manifest', manifestPath,
    '--low-render-scales', '0.25',
    '--high-render-scale', '1.0',
    '--debug-port', '9960',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const dataset = readJson(manifestPath).dataset;
  assert.equal(dataset.status, 'dry-run');
  assert.equal(dataset.pairs.length, 1);
  assert.ok(dataset.pairs[0].low?.path, 'dry-run dataset pair must expose low.path for MLX/corpus consumers');
  assert.ok(dataset.pairs[0].high?.path, 'dry-run dataset pair must expose high.path for MLX/corpus consumers');
  assert.equal(dataset.pairs[0].status, 'dry-run');
} finally {
  rmSync(datasetDir, { recursive: true, force: true });
}

const corpusDir = mkdtempSync(join(tmpdir(), 'kaminos-render-pair-corpus-contract-'));
try {
  const variantFile = join(corpusDir, 'variants.json');
  writeFileSync(variantFile, JSON.stringify({
    variants: [
      {
        id: 'overlap-contract',
        label: 'overlap contract',
        settleMs: 1,
        overrides: {},
      },
    ],
  }));
  const manifestPath = join(corpusDir, 'corpus-manifest.json');
  const result = runNode([
    'volume-render-pair-corpus.mjs',
    '--dry-run',
    '--out-dir', corpusDir,
    '--manifest', manifestPath,
    '--variant-file', variantFile,
    '--low-render-scales', '1.0',
    '--high-render-scale', '1.0',
    '--frames-per-sequence', '1',
    '--no-reuse-witness-browser', '1',
  ]);
  assert.notEqual(result.status, 0, 'corpus dry-run must reject low/high render-scale overlap');
  assert.match(
    `${result.stderr}\n${result.stdout}`,
    /overlap|same render scale|low.*high/i,
    'overlap rejection must name the low/high render-scale conflict'
  );
} finally {
  rmSync(corpusDir, { recursive: true, force: true });
}
