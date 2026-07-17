#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  bitonicSortRecordCount,
  buildBitonicSortStages,
  buildCompactSmokeProduct,
  validateAdaptiveVolumeGpuReport,
} from '../smoke-adaptive-volume-gpu-falsifier.mjs';

assert.equal(bitonicSortRecordCount(64_000), 65_536);
assert.equal(bitonicSortRecordCount(65_536), 65_536);
const sortStages = buildBitonicSortStages(65_536);
assert.equal(sortStages.length, 136, '65536-record bitonic sort requires sum(1..16) stages');
assert.deepEqual(sortStages[0], [1, 2, 65_536, 0]);
assert.deepEqual(sortStages.at(-1), [1, 65_536, 65_536, 0]);
assert.equal(sortStages.some(([j]) => !Number.isInteger(j) || j <= 0), false);

const grid = 4;
const blockSize = 2;
const source = new Float32Array(grid ** 3);
for (let z = 0; z < grid; z += 1) {
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) source[x + y * grid + z * grid * grid] = x + y * 10 + z * 100;
  }
}

const product = buildCompactSmokeProduct({ source, grid, blockSize, selectedBrickIndices: [0, 7] });
assert.equal(product.identity, 'compact-parent-mean-halo-atlas-v0');
assert.equal(product.coarseGrid, 2);
assert.equal(product.haloEdge, 4);
assert.equal(product.coarseValues.length, 8);
assert.equal(product.indirection.length, 8);
assert.equal(product.atlasValues.length, 2 * 4 ** 3);
assert.equal(product.indirection[0], 0);
assert.equal(product.indirection[7], 1);
assert.equal(product.indirection[1], -1);
assert.equal(product.coarseValues[0], (0 + 1 + 10 + 11 + 100 + 101 + 110 + 111) / 8);
assert.equal(product.atlasValues[0], source[0], 'low halo clamps to source boundary');
assert.equal(product.atlasValues[4 ** 3 - 1], source[2 + 2 * grid + 2 * grid * grid], 'high halo includes one neighboring cell');
assert.equal('sourceValues' in product, false, 'compact product must not retain the dense source');
assert.deepEqual(product.allocationBytes, {
  coarse: 8 * 4,
  indirection: 8 * 4,
  fineAtlas: 2 * 4 ** 3 * 4,
  total: 8 * 4 + 8 * 4 + 2 * 4 ** 3 * 4,
});

const validReport = {
  schema: 'kaminos.smoke-adaptive-volume-gpu-falsifier.v0',
  status: 'passed',
  requested: { selectedBrickCount: 2, hiddenBrickCapApplied: false },
  effective: {
    route: 'isolated-adaptive-volume-webgpu-v0',
    backend: 'WebGPU:apple',
    timestampFeature: 'timestamp-query',
    timestampStatus: 'available',
    sourceGrid: 4,
    coarseGrid: 2,
    blockSize: 2,
  },
  runtime: {
    gitCommit: '0123456789012345678901234567890123456789',
    gitBranch: 'cc/test',
    gitStatusShort: '',
    sourceFileSha256s: {
      module: 'sha256:a', browser: 'sha256:b', witness: 'sha256:c', html: 'sha256:d',
    },
  },
  source: {
    matchedReportSha256: 'sha256:a',
    fitReportSha256: 'sha256:b',
    sourceSidecarSha256: 'sha256:c',
    selectionArtifactSha256: 'sha256:d',
    referenceDepthSha256: 'sha256:e',
  },
  arms: {
    dense: { outputComplete: true, gpuMs: 2 },
    compactPrebuilt: { outputComplete: true, gpuMs: 1, denseBindingCount: 0 },
    buildCompactRender: { outputComplete: true, buildGpuMs: 1, renderGpuMs: 1, totalGpuMs: 2, denseBindingCountDuringRender: 0 },
  },
  compactProduct: {
    selectedBrickCount: 2,
    selectionMismatchCount: 0,
    sortOrderViolationCount: 0,
    allocationBytes: product.allocationBytes,
    allocationComplete: true,
    hiddenDenseAllocationBytes: 0,
  },
  denseDenial: {
    method: 'destroy-dense-source-before-compact-rerender-v0',
    preDenialOutputSha256: 'sha256:a',
    postDenialOutputSha256: 'sha256:a',
    maximumAbsoluteOutputDelta: 0,
    passed: true,
  },
  validation: {
    compactPrebuiltMaximumAbsoluteError: 0.01,
    buildCompactMaximumAbsoluteError: 0.01,
    complete: true,
  },
  falseClosureChecks: {
    fallbackRoute: false,
    missingTimestampSupport: false,
    hiddenDenseBinding: false,
    hiddenDenseAllocation: false,
    incompleteOutput: false,
    staleSelection: false,
    hiddenCap: false,
  },
};
assert.equal(validateAdaptiveVolumeGpuReport(validReport).optimizationClaimAllowed, true);

for (const mutate of [
  report => { report.effective.backend = 'WebGPU:unknown'; },
  report => { report.effective.timestampStatus = 'unsupported'; },
  report => { report.arms.compactPrebuilt.denseBindingCount = 1; },
  report => { report.compactProduct.hiddenDenseAllocationBytes = 64; },
  report => { report.denseDenial.postDenialOutputSha256 = 'sha256:b'; },
  report => { report.validation.complete = false; },
  report => { report.requested.hiddenBrickCapApplied = true; },
  report => { delete report.source.referenceDepthSha256; },
  report => { delete report.runtime.sourceFileSha256s.browser; },
  report => { report.compactProduct.sortOrderViolationCount = 1; },
]) {
  const report = structuredClone(validReport);
  mutate(report);
  assert.equal(validateAdaptiveVolumeGpuReport(report).optimizationClaimAllowed, false);
}

const browser = readFileSync(new URL('../smoke-adaptive-volume-gpu-falsifier-browser.js', import.meta.url), 'utf8');
assert.match(browser, /timestamp-query/);
assert.match(browser, /timestampWrites/);
assert.doesNotMatch(browser, /encoder\.writeTimestamp/);
assert.doesNotMatch(browser, /const marker = encoder\.beginComputePass/, 'combined timing must not depend on an empty marker pass');
assert.match(browser, /encodeBuild\(encoder, queries, true\), 3\)/, 'combined build/render timing uses three populated query slots');
assert.match(browser, /total:\s*Number\(timestamps\[2\]\s*-\s*timestamps\[0\]\)\s*\/\s*1_000_000/);
assert.doesNotMatch(
  browser,
  /function setStatus\([^)]*\)\s*\{[^}]*state\.phase\s*=/s,
  'human-readable status updates must not overwrite terminal machine state',
);
assert.match(browser, /destroy\(\)[\s\S]*dense/i, 'browser falsifier must destroy dense state before compact rerender');
assert.match(browser, /denseBindingCountDuringRender:\s*0/);
assert.match(browser, /allocationComplete/);
assert.match(browser, /buildBitonicSortStages\(sortRecordCount\)/);
assert.match(browser, /const sortRecordCount = bitonicSortRecordCount\(brickCount\)/);
assert.match(browser, /Pair\(-1\.0, brickIndex\)/, 'padding records must be explicit low-score sentinels');
assert.match(browser, /brickIndex >= brickCount/, 'GPU hierarchy must separate padded records from physical bricks');
assert.match(browser, /arrayLength\(&selectedPairs\)\s*-\s*1u\s*-\s*slot/, 'ascending sort must select its highest-energy suffix');
assert.match(browser, /arrayLength\(&packPairs\)\s*-\s*1u\s*-\s*slot/);
assert.match(browser, /let previousScore = -Infinity/);
assert.match(browser, /index >= sortRecordCount - selected\.length/);
assert.match(browser, /sortOrderViolationCount/);
assert.match(browser, /allocationBytes\.total = allocationBytes\.totalBuildAndProduct/);
assert.match(browser, /const initializeBindGroup\s*=/, 'entry-point-specific auto layouts require an initialize bind group');
assert.match(browser, /const scatterBindGroup\s*=/, 'entry-point-specific auto layouts require a scatter bind group');
assert.match(browser, /setPipeline\(initializePipeline\);[^\n]*setBindGroup\(2, initializeBindGroup\)/);
assert.match(browser, /setPipeline\(scatterPipeline\);[^\n]*setBindGroup\(2, scatterBindGroup\)/);

const witness = readFileSync(new URL('../smoke-adaptive-volume-gpu-witness.mjs', import.meta.url), 'utf8');
assert.match(witness, /failed-before-primary-output/);
assert.match(witness, /failurePhase/);
assert.match(witness, /requestedRoute[\s\S]*effectiveRoute/);
assert.match(witness, /reuseBrowser/);
assert.match(witness, /optimizationClaimAllowed/);
assert.match(witness, /gitCommit[\s\S]*gitBranch[\s\S]*gitStatusShort/);
assert.match(witness, /sourceFileSha256s/);
assert.match(browser, /matchedReportSha256[\s\S]*fitReportSha256[\s\S]*sourceSidecarSha256[\s\S]*selectionArtifactSha256[\s\S]*referenceDepthSha256/);

console.log('smoke adaptive volume GPU falsifier contracts passed');
