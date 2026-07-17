#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ADAPTIVE_VOLUME_GPU_ERROR_LIMITS,
  ADAPTIVE_VOLUME_SCALE_LAW_SCHEMA,
  bitonicSortRecordCount,
  buildBitonicSortStages,
  buildCompactSmokeProduct,
  validateAdaptiveVolumeGpuReport,
  validateAdaptiveVolumeScaleLawReport,
} from '../smoke-adaptive-volume-gpu-falsifier.mjs';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const SHA_D = `sha256:${'d'.repeat(64)}`;
const SHA_E = `sha256:${'e'.repeat(64)}`;

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
    backendIdentitySource: 'cdp-system-info',
    cdpGpuInfo: {
      source: 'cdp-system-info',
      appleDeviceObserved: true,
      devices: [{
        vendorString: 'Google Inc. (Apple)',
        deviceString: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)',
        driverVendor: 'Apple',
      }],
    },
    sourceGrid: 4,
    coarseGrid: 2,
    physicalBrickCount: 8,
    blockSize: 2,
  },
  runtime: {
    gitCommit: '0123456789012345678901234567890123456789',
    gitBranch: 'cc/test',
    gitStatusShort: '',
    sourceFileSha256s: {
      module: SHA_A, browser: SHA_B, witness: SHA_C, html: SHA_D, productionVolume: SHA_E,
    },
  },
  source: {
    matchedReportSha256: SHA_A,
    fitReportSha256: SHA_B,
    sourceSidecarSha256: SHA_C,
    selectionArtifactSha256: SHA_D,
    referenceDepthSha256: SHA_E,
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
    preDenialOutputSha256: SHA_A,
    postDenialOutputSha256: SHA_A,
    maximumAbsoluteOutputDelta: 0,
    passed: true,
  },
  validation: {
    thresholds: ADAPTIVE_VOLUME_GPU_ERROR_LIMITS,
    denseAgainstCommittedReference: { maximumAbsoluteError: 0.000001 },
    compactPrebuiltAgainstDense: { maximumAbsoluteError: 0.0009 },
    buildCompactAgainstDense: { maximumAbsoluteError: 0.0009 },
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

const validAdapterReport = structuredClone(validReport);
validAdapterReport.effective.backendIdentitySource = 'adapter-info';
validAdapterReport.effective.adapterInfo = { vendor: 'Apple', architecture: 'Apple M4 Max' };
delete validAdapterReport.effective.cdpGpuInfo;
assert.equal(validateAdaptiveVolumeGpuReport(validAdapterReport).optimizationClaimAllowed, true);

function scaleWorkload(width, height, denseMedian, compactMedian) {
  const pixelCount = width * height;
  const pairedSamples = Array.from({ length: 7 }, (_, index) => ({
    order: index % 2 === 0 ? 'dense-compact' : 'compact-dense',
    denseAggregateGpuMs: denseMedian,
    compactAggregateGpuMs: compactMedian,
    compactOverDenseRatio: compactMedian / denseMedian,
  }));
  return {
    width,
    height,
    pixelCount,
    intersectingRayCount: Math.floor(pixelCount * 0.8),
    denseStepCount: Math.floor(pixelCount * 0.8) * 160,
    dispatchRepeats: 8,
    timingProtocol: 'paired-alternating-submit-v0',
    submissionCountPerPair: 2,
    pairedSamples,
    pairedRatio: { median: compactMedian / denseMedian },
    pairedRatioByOrder: {
      denseCompact: { median: compactMedian / denseMedian },
      compactDense: { median: compactMedian / denseMedian },
    },
    compactOverDenseRatio: compactMedian / denseMedian,
    profiles: {
      dense: { aggregate: { median: denseMedian }, perDispatch: { median: denseMedian / 8 } },
      compact: { aggregate: { median: compactMedian }, perDispatch: { median: compactMedian / 8 } },
    },
    comparison: {
      sampleCount: pixelCount,
      meanSquaredError: 1e-9,
      meanAbsoluteError: 1e-5,
      maximumAbsoluteError: 0.0009,
      maximumAbsoluteErrorIndex: 17,
      maximumAbsoluteErrorPixel: { x: 17 % width, y: Math.floor(17 / width) },
      maximumPair: { left: 0.1, right: 0.1009 },
      absoluteErrorQuantiles: { p99: 0.0001, p999: 0.0002, p9999: 0.0004 },
      errorLimit: 0.001,
      aboveErrorLimitCount: 0,
      aboveErrorLimitFraction: 0,
    },
  };
}

const validScaleReport = structuredClone(validReport);
validScaleReport.scaleLaw = {
  schema: ADAPTIVE_VOLUME_SCALE_LAW_SCHEMA,
  status: 'passed',
  requested: {
    dispatchRepeats: 8,
    steadySamples: 7,
    minimumAggregateGpuMs: 2,
    hiddenWorkloadCapApplied: false,
  },
  effective: {
    workloads: [
      scaleWorkload(100, 80, 2.4, 2.8),
      scaleWorkload(200, 160, 4.8, 4.5),
      scaleWorkload(400, 320, 12, 9),
    ],
  },
  productionAttribution: {
    authority: 'static-production-shader-source-inspection-v0',
    sourceSha256: SHA_E,
    measuredProductionBottleneck: false,
    observedMechanisms: ['majorant-grid', 'occupancy-skip', 'adaptive-rays', 'early-transmittance', 'five-live-field-samples'],
  },
  falseClosureChecks: {
    workloadSurfaceIncomplete: false,
    aggregateBelowDeclaredFloor: false,
    outputError: false,
  },
};
assert.equal(validateAdaptiveVolumeScaleLawReport(validScaleReport).scaleLawEvidenceAllowed, true);

const validRetinaScaleReport = structuredClone(validScaleReport);
validRetinaScaleReport.scaleLaw.requested.displayResolution = {
  width: 3456,
  height: 2234,
  pixelCount: 7_720_704,
  authority: 'system-profiler-liquid-retina-xdr-device-pixels-v0',
  hiddenResolutionCapApplied: false,
};
validRetinaScaleReport.scaleLaw.effective.workloads.push(scaleWorkload(3456, 2234, 48, 39));
assert.equal(validateAdaptiveVolumeScaleLawReport(validRetinaScaleReport).scaleLawEvidenceAllowed, true);

for (const mutate of [
  report => { report.scaleLaw.effective.workloads.at(-1).width = 3455; },
  report => { report.scaleLaw.requested.displayResolution.authority = 'browser-css-pixels'; },
  report => { report.scaleLaw.requested.displayResolution.hiddenResolutionCapApplied = true; },
  report => { report.scaleLaw.effective.workloads.at(-1).intersectingRayCount = 0; },
]) {
  const report = structuredClone(validRetinaScaleReport);
  mutate(report);
  assert.equal(
    validateAdaptiveVolumeScaleLawReport(report).scaleLawEvidenceAllowed,
    false,
    'Retina evidence must bind exact device pixels and nonempty volume work',
  );
}

const truncatedSourceDigest = structuredClone(validScaleReport);
truncatedSourceDigest.source.matchedReportSha256 = 'sha256:a';
assert.equal(
  validateAdaptiveVolumeGpuReport(truncatedSourceDigest).optimizationClaimAllowed,
  false,
  'source identity must require a complete SHA-256 digest',
);

const mismatchedProductionSource = structuredClone(validScaleReport);
mismatchedProductionSource.scaleLaw.productionAttribution.sourceSha256 = SHA_D;
assert.equal(
  validateAdaptiveVolumeScaleLawReport(mismatchedProductionSource).scaleLawEvidenceAllowed,
  false,
  'production attribution must bind to the exact runtime production-volume source',
);

const invalidFullSelectionParity = structuredClone(validScaleReport);
invalidFullSelectionParity.compactProduct.selectedBrickCount = invalidFullSelectionParity.effective.physicalBrickCount;
for (const workload of invalidFullSelectionParity.scaleLaw.effective.workloads) {
  workload.comparison.maximumAbsoluteError = 0.0001;
  workload.comparison.maximumPair = { left: 0.1, right: 0.1001 };
  workload.comparison.absoluteErrorQuantiles = { p99: 0.00001, p999: 0.00005, p9999: 0.00009 };
}
assert.equal(
  validateAdaptiveVolumeScaleLawReport(invalidFullSelectionParity).scaleLawEvidenceAllowed,
  false,
  'a full brick atlas must reproduce globally aligned dense integration more tightly than an adaptive approximation',
);

for (const mutate of [
  report => { report.scaleLaw.effective.workloads.pop(); },
  report => { report.scaleLaw.requested.dispatchRepeats = 1; },
  report => { report.scaleLaw.effective.workloads[0].profiles.dense.aggregate.median = 0.5; },
  report => { report.scaleLaw.effective.workloads[0].timingProtocol = 'dense-then-compact'; },
  report => { report.scaleLaw.effective.workloads[0].submissionCountPerPair = 1; },
  report => { report.scaleLaw.effective.workloads[0].pairedSamples[1].order = 'dense-compact'; },
  report => { delete report.scaleLaw.effective.workloads[0].pairedRatioByOrder; },
  report => { report.scaleLaw.effective.workloads[0].profiles.dense.aggregate.median = 9; },
  report => { report.scaleLaw.effective.workloads[0].compactOverDenseRatio = 9; },
  report => { report.scaleLaw.effective.workloads[0].intersectingRayCount = 0; },
  report => { report.scaleLaw.effective.workloads[1].denseStepCount = 1; },
  report => { delete report.scaleLaw.effective.workloads[2].comparison.absoluteErrorQuantiles; },
  report => { report.scaleLaw.effective.workloads[2].comparison.maximumAbsoluteError = 1; },
  report => { report.scaleLaw.productionAttribution.measuredProductionBottleneck = true; },
  report => { report.scaleLaw.productionAttribution.observedMechanisms.pop(); },
  report => { report.scaleLaw.falseClosureChecks.outputError = true; },
]) {
  const report = structuredClone(validScaleReport);
  mutate(report);
  assert.equal(validateAdaptiveVolumeScaleLawReport(report).scaleLawEvidenceAllowed, false);
}

for (const mutate of [
  report => { report.effective.backend = 'WebGPU:unknown'; },
  report => { report.effective.timestampStatus = 'unsupported'; },
  report => { report.arms.compactPrebuilt.denseBindingCount = 1; },
  report => { report.compactProduct.hiddenDenseAllocationBytes = 64; },
  report => { report.denseDenial.postDenialOutputSha256 = SHA_B; },
  report => { report.validation.complete = false; },
  report => { report.requested.hiddenBrickCapApplied = true; },
  report => { delete report.source.referenceDepthSha256; },
  report => { delete report.runtime.sourceFileSha256s.browser; },
  report => { delete report.runtime.sourceFileSha256s.productionVolume; },
  report => { report.compactProduct.sortOrderViolationCount = 1; },
  report => { report.effective.backendIdentitySource = 'platform-fallback-untrusted'; },
  report => { delete report.effective.cdpGpuInfo; },
  report => { report.effective.cdpGpuInfo.appleDeviceObserved = false; },
  report => { report.effective.cdpGpuInfo.devices = []; },
  report => { report.effective.cdpGpuInfo.devices = [null]; },
  report => { report.effective.cdpGpuInfo.devices = [{ apple: false, metal: false }]; },
  report => { report.effective.cdpGpuInfo.devices = [{ deviceString: 'not Apple not Metal' }]; },
  report => {
    report.effective.backendIdentitySource = 'adapter-info';
    report.effective.adapterInfo = { vendor: 'Unknown', architecture: 'Unknown' };
    delete report.effective.cdpGpuInfo;
  },
  report => {
    report.effective.backendIdentitySource = 'adapter-info';
    report.effective.adapterInfo = { apple: false };
    delete report.effective.cdpGpuInfo;
  },
  report => {
    report.effective.backendIdentitySource = 'adapter-info';
    report.effective.adapterInfo = { vendor: 'Not Apple' };
    delete report.effective.cdpGpuInfo;
  },
  report => { report.validation.denseAgainstCommittedReference.maximumAbsoluteError = 1; },
  report => { report.validation.compactPrebuiltAgainstDense.maximumAbsoluteError = 1; },
  report => { report.validation.buildCompactAgainstDense.maximumAbsoluteError = 1; },
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
assert.match(browser, /dispatchWorkgroups\(Math\.ceil\(sortRecordCount \/ 256\)\)/, 'every bitonic stage must cover the padded domain');
assert.doesNotMatch(browser, /dynamicSortPipeline[^\n]+dispatchWorkgroups\(Math\.ceil\(brickCount \/ 256\)\)/);
assert.match(browser, /Pair\(-1\.0, brickIndex\)/, 'padding records must be explicit low-score sentinels');
assert.match(browser, /brickIndex >= brickCount/, 'GPU hierarchy must separate padded records from physical bricks');
assert.match(browser, /arrayLength\(&selectedPairs\)\s*-\s*1u\s*-\s*slot/, 'ascending sort must select its highest-energy suffix');
assert.match(browser, /arrayLength\(&packPairs\)\s*-\s*1u\s*-\s*slot/);
assert.match(browser, /let previousScore = -Infinity/);
assert.match(browser, /index >= sortRecordCount - selected\.length/);
assert.match(browser, /sortOrderViolationCount/);
assert.match(browser, /allocationBytes\.total = allocationBytes\.totalBuildAndProduct/);
assert.match(browser, /applyHostGpuIdentity/);
assert.match(browser, /backendIdentitySource/);
assert.match(
  browser,
  /applyHostGpuIdentity\(identity\)[\s\S]*state\.report\.status = 'passed'[\s\S]*falseClosureChecks\.fallbackRoute = false[\s\S]*applyReportDisposition/,
  'authoritative CDP upgrade must clear provisional fallback state before redisposition',
);
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
assert.match(witness, /SystemInfo\.getInfo/);
assert.match(witness, /applyHostGpuIdentity/);
assert.match(
  witness,
  /writeFileSync\(browserReportPath[\s\S]*Page\.captureScreenshot/,
  'validated browser metrics must be durable before screenshot capture can fail',
);
assert.match(witness, /captureBeyondViewport:\s*false/, 'R8b visual context must not rasterize the unbounded raw JSON report');
assert.match(browser, /matchedReportSha256[\s\S]*fitReportSha256[\s\S]*sourceSidecarSha256[\s\S]*selectionArtifactSha256[\s\S]*referenceDepthSha256/);

assert.match(
  browser,
  /profileScaleLawWorkloads/,
  'R8 must profile a named multi-workload scale surface rather than reuse the timer-floor R7 scalar',
);
assert.match(browser, /dispatchRepeats/, 'R8 must record effective timing amplification per workload');
assert.match(browser, /minimumAggregateGpuMs/, 'R8 must reject aggregate timings that remain at the timestamp floor');
assert.match(browser, /intersectingRayCount/, 'R8 must identify actual ray coverage for every workload');
assert.match(browser, /denseStepCount/, 'R8 must identify the dense scalar work represented by every workload');
assert.match(browser, /paired-alternating-submit-v0/, 'R8c must pair dense and compact samples as alternating separate submissions');
assert.match(browser, /pairedSamples/, 'R8b must preserve raw paired timing evidence');
assert.match(
  browser,
  /const measureArm[\s\S]*resolveTimestamps\(device,[\s\S]*?,\s*2\)/,
  'R8c must measure each arm in its own timestamped submission',
);
assert.match(browser, /pairedRatioByOrder/, 'R8c must expose residual execution-order bias instead of averaging it away');
assert.match(browser, /var globalStep = 0u/, 'sparse traversal must preserve the dense global fine-step lattice');
assert.doesNotMatch(browser, /var fineDistance = distance/, 'sparse traversal must not restart quadrature at brick boundaries');
assert.match(browser, /pointCell\(samplePoint, p\)/, 'fine/coarse support must be selected at the globally aligned segment midpoint');
assert.doesNotMatch(browser, /for \(var run = 0u;/, 'coarse bricks must not spend one shader iteration per skipped fine segment');
assert.match(browser, /ceil\(midpointExitDistance \/ fineStep\)/, 'coarse jumps must preserve the global midpoint lattice analytically');
assert.match(browser, /absoluteErrorQuantiles/, 'R8b must distinguish a broad reconstruction failure from an extreme-value tail');
assert.match(browser, /aboveErrorLimitCount/, 'R8b must report how many pixels violate the immutable max-error gate');
assert.match(browser, /renderScaleLawSummary/, 'R8b screenshot must expose role-labeled scale timing and error rows');
assert.match(browser, /3456[^\n]+2234/, 'R9 must include the built-in Liquid Retina XDR device-pixel workload');
assert.match(browser, /workload_dimensions/, 'R9 must accept explicit workload dimensions instead of assuming one aspect-ratio scale');
assert.match(browser, /maxStorageBufferBindingSize[^\n]+largestRayBufferBytes/, 'R9 must request enough storage binding capacity for the uncapped Retina ray buffer');
const html = readFileSync(new URL('../smoke-adaptive-volume-gpu-falsifier.html', import.meta.url), 'utf8');
assert.match(html, /id="scale-law-summary"/, 'R8b screenshot needs a bounded scale-law context surface');
const moduleSource = readFileSync(new URL('../smoke-adaptive-volume-gpu-falsifier.mjs', import.meta.url), 'utf8');
assert.match(moduleSource, /kaminos\.smoke-adaptive-volume-scale-law\.v0/, 'R8 scale evidence needs its own nested schema');
assert.match(browser, /productionAttribution/, 'R8 must bind its production comparison boundary to exact source evidence');
assert.match(browser, /measuredProductionBottleneck:\s*false/, 'static shader inspection must not impersonate measured production attribution');

const volumeCore = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
for (const productionMechanism of [
  /sampleWorldMajorant/,
  /occupancySkipStepScale/,
  /adaptiveRayStepScale/,
  /raymarchEarlyTermination/,
  /sampleWorldVelocity/,
  /sampleWorldMaterial/,
  /sampleWorldFireLayer/,
  /sampleWorldMicrodetail/,
  /sampleWorldFrontField/,
]) {
  assert.match(volumeCore, productionMechanism, `production shader attribution lost ${productionMechanism}`);
}

console.log('smoke adaptive volume GPU falsifier contracts passed');
