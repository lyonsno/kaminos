#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLayerCoefficientLiveUnionOverlay } from '../volume-layer-coefficient-live-union-overlay.mjs';

const scriptUrl = new URL('../volume-layer-coefficient-live-union-remap.py', import.meta.url);
const python = process.env.KAMINOS_PYTHON || 'python3';

assert.ok(existsSync(fileURLToPath(scriptUrl)), 'live-union coefficient remapper must exist');

const result = spawnSync(python, [fileURLToPath(scriptUrl), '--self-test'], {
  encoding: 'utf8',
  timeout: 30_000,
});

assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
const receipt = JSON.parse(result.stdout.trim());
assert.equal(receipt.identity, 'layer-coefficient-live-union-remap-self-test-v0');
assert.equal(receipt.status, 'passed');
assert.equal(receipt.authority, 'exact-native-cell-identity-overlay-remap-v0');
assert.equal(receipt.sourceRowCount, 4);
assert.equal(receipt.destinationRowCount, 4);
assert.equal(receipt.droppedRowCount, 0);
assert.equal(receipt.sampleCap, null);
assert.deepEqual(receipt.permutation, [2, 0, 3, 1]);
assert.equal(receipt.lookupEncoding, 'row-plus-one-zero-missing-v0');
assert.equal(receipt.gridCellCount, 64);
assert.equal(receipt.admittedRowCount, 4);
assert.deepEqual(receipt.lookupAtSourceIds, [1, 2, 3, 4]);
assert.deepEqual(receipt.rejectedMismatch, [
  'duplicate-source-native-cell-id',
  'duplicate-destination-native-cell-id',
  'missing-destination-native-cell-id',
  'extra-destination-native-cell-id',
  'nonfinite-coefficient',
  'negative-coefficient',
  'native-cell-id-out-of-range',
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const canonicalIdentity = (value) => {
  const payload = structuredClone(value);
  delete payload.identity;
  delete payload.elapsedSeconds;
  return `sha256:${sha256(JSON.stringify(canonicalize(payload)))}`;
};

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-live-union-remap-'));
const coefficientPath = join(fixtureRoot, 'coefficients.f32');
const indexPath = join(fixtureRoot, 'native-cell-indices.u32');
const coefficients = new Float32Array(32);
for (let index = 0; index < coefficients.length; index += 1) coefficients[index] = index / 32;
const nativeCellIndices = new Uint32Array([1, 7, 12, 26]);
writeFileSync(coefficientPath, Buffer.from(coefficients.buffer));
writeFileSync(indexPath, Buffer.from(nativeCellIndices.buffer));
const coefficientBytes = readFileSync(coefficientPath);
const indexBytes = readFileSync(indexPath);
const sourceHashes = {
  fluidSha256: 'a'.repeat(64),
  frontSha256: 'b'.repeat(64),
  boundarySidecarSha256: 'c'.repeat(64),
  majorantSha256: 'd'.repeat(64),
};

const baseOverlay = {
  schema: 'kaminos.volume.layer-coefficient-prediction-overlay.v0',
  status: 'complete',
  failurePhase: null,
  authority: 'learned-post-admission-coefficient-prediction-v0',
  state: {
    id: 'synthetic-state',
    rowCount: 4,
    admissionIndexSha256: sha256(indexBytes),
    sourceHashes,
  },
  model: { arm: 'baseline', sha256: 'e'.repeat(64) },
  coefficientArtifact: {
    path: coefficientPath,
    bytes: coefficientBytes.byteLength,
    sha256: sha256(coefficientBytes),
    dtype: 'float32-le',
    shape: [4, 8],
    semanticRole: 'learned-post-admission-layer-emission-extinction-prediction',
  },
  execution: { sampleCap: null, droppedRowCount: 0 },
  elapsedSeconds: 1.25,
};
baseOverlay.identity = canonicalIdentity(baseOverlay);

const runPackage = (name, mutate = () => {}) => {
  const overlay = structuredClone(baseOverlay);
  mutate(overlay);
  if (overlay.identity !== 'forged') overlay.identity = canonicalIdentity(overlay);
  const reportPath = join(fixtureRoot, `${name}.json`);
  const outputDir = join(fixtureRoot, `${name}-runtime`);
  writeFileSync(reportPath, `${JSON.stringify(overlay, null, 2)}\n`);
  const packageResult = spawnSync(python, [
    fileURLToPath(scriptUrl),
    '--overlay-report', reportPath,
    '--source-native-cell-indices', indexPath,
    '--output-dir', outputDir,
    '--grid', '3',
  ], { encoding: 'utf8', timeout: 30_000 });
  return { packageResult, outputDir };
};

const happy = runPackage('happy');
assert.equal(happy.packageResult.status, 0, `${happy.packageResult.stderr}\n${happy.packageResult.stdout}`);
const runtime = JSON.parse(readFileSync(join(happy.outputDir, 'runtime-overlay.json'), 'utf8'));
assert.equal(runtime.status, 'complete');
assert.equal(runtime.source.overlayIdentity, baseOverlay.identity);
assert.equal(runtime.execution.sampleCap, null);
assert.equal(runtime.execution.droppedRowCount, 0);
assert.equal(runtime.execution.unmappedAdmittedRowCount, 0);
assert.equal(runtime.artifacts.coefficients.dtype, 'float32-le');
assert.equal(runtime.artifacts.coefficients.bytes, 128);
assert.equal(runtime.artifacts.denseLookup.bytes, 108);
const localFetch = async (url) => {
  const bytes = readFileSync(fileURLToPath(url));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};
const loadedRuntime = await loadLayerCoefficientLiveUnionOverlay({
  manifestUrl: pathToFileURL(join(happy.outputDir, 'runtime-overlay.json')).href,
  fetchImpl: localFetch,
  expectedSource: {
    grid: 3,
    admissionIndexSha256: sha256(indexBytes),
    sourceHashes,
  },
});
assert.equal(loadedRuntime.receipt.status, 'complete');
assert.equal(loadedRuntime.receipt.lookupPopulation, 4);
assert.equal(loadedRuntime.receipt.lookupMissCount, 0);

const rejectionCases = [
  ['capped', (overlay) => { overlay.execution.sampleCap = 3; }, 'prediction overlay applied a hidden sampleCap'],
  ['dropped', (overlay) => { overlay.execution.droppedRowCount = 1; }, 'prediction overlay dropped admitted rows'],
  ['identity-drift', (overlay) => { overlay.identity = 'forged'; }, 'prediction overlay identity differs'],
  ['dtype-drift', (overlay) => { overlay.coefficientArtifact.dtype = 'float16-le'; }, 'prediction coefficient dtype differs'],
  ['role-drift', (overlay) => { overlay.coefficientArtifact.semanticRole = 'wrong-role'; }, 'prediction coefficient semantic role differs'],
  ['source-hash-shape-drift', (overlay) => { delete overlay.state.sourceHashes.majorantSha256; }, 'prediction overlay source hashes differ'],
];
for (const [name, mutate, expectedReason] of rejectionCases) {
  const rejected = runPackage(name, mutate);
  assert.notEqual(rejected.packageResult.status, 0, `${name} must fail closed`);
  const failure = JSON.parse(readFileSync(join(rejected.outputDir, 'runtime-overlay.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'package-runtime-overlay');
  assert.equal(failure.reason, expectedReason);
  assert.equal(failure.requested.overlayReportPath, realpathSync(join(fixtureRoot, `${name}.json`)));
  assert.equal(failure.requested.sourceNativeCellIndicesPath, realpathSync(indexPath));
  assert.equal(failure.requested.outputDir, realpathSync(rejected.outputDir));
  assert.equal(failure.requested.grid, 3);
  assert.equal(failure.lastTrustworthyEvidence.overlayReportExists, true);
  assert.equal(failure.lastTrustworthyEvidence.sourceNativeCellIndicesExists, true);
  assert.match(failure.lastTrustworthyEvidence.overlayReportSha256, /^[a-f0-9]{64}$/);
  assert.equal(failure.lastTrustworthyEvidence.sourceNativeCellIndicesSha256, sha256(indexBytes));
  assert.equal(typeof failure.lastTrustworthyEvidence.claimedOverlayIdentity, 'string');
}

console.log('volume layer coefficient live-union remap contracts passed');
