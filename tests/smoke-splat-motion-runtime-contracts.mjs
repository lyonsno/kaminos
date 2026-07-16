import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../smoke-splat-motion-source.mjs', import.meta.url);
const pageUrl = new URL('../smoke-splat-motion.html', import.meta.url);
const witnessUrl = new URL('../smoke-splat-motion-witness.mjs', import.meta.url);
const manifestUrl = new URL('../artifacts/real-smoke-hierarchy-0713/motion-source.json', import.meta.url);
const projectedDefaultReportUrl = new URL('../artifacts/smoke-projected-footprint-diagnostic-0713/projected-default-report.json', import.meta.url);

const source = await readFile(moduleUrl, 'utf8').catch(() => '');
const page = await readFile(pageUrl, 'utf8').catch(() => '');
const witness = await readFile(witnessUrl, 'utf8').catch(() => '');
const manifestText = await readFile(manifestUrl, 'utf8').catch(() => '');
const projectedDefaultReportText = await readFile(projectedDefaultReportUrl, 'utf8').catch(() => '');

assert.match(source, /kaminos\.smoke-splat-motion-source\.v0/, 'motion source must publish a stable schema');
assert.match(source, /webgpu-real-field-hierarchical-smoke-motion-v0/, 'motion source must publish an exact renderer route identity');
assert.match(source, /velocity-carried-short-horizon-extrapolation-v0/, 'motion source must name its temporal extrapolation authority');
assert.match(source, /outputWasTruncated/, 'motion source must reject truncated hierarchy products');
assert.match(source, /coarseSplatsAlwaysPresent/, 'fine LOD must never remove coarse extinction transport');
assert.doesNotMatch(source, /MAX_(?:INSTANCE|SPLAT)|Math\.min\([^\n]*instanceCount/, 'runtime must not install a hidden count cap');

assert.match(page, /navigator\.gpu/, 'motion page must execute a WebGPU route');
assert.match(page, /rgba16float/, 'motion page must accumulate optical depth in a float target');
assert.match(page, /one-minus-src-alpha|exp\(-/, 'motion page must resolve accumulated optical depth into transmittance');
assert.match(page, /draw\(6,/, 'motion page must instance splat quads on GPU');
assert.match(page, /requestedRoute/, 'motion page must retain requested route identity');
assert.match(page, /effectiveRoute/, 'motion page must expose effective route identity');
assert.match(page, /fallbackReason/, 'motion page must expose fallback state');
assert.match(page, /SMOKE_SPLAT_FOOTPRINT_PROJECTED_COVARIANCE_AUTHORITY/, 'motion page must expose the canonical oriented projected footprint authority');
assert.match(page, /requestedFootprintAuthority/, 'motion page must retain requested footprint authority');
assert.match(page, /effectiveFootprintAuthority/, 'motion page must expose effective footprint authority');
assert.match(page, /coarse_coverage/, 'motion page must accept an explicit coarse coverage diagnostic');
assert.match(page, /requestedCoarseCoverageScale/, 'motion page must retain requested coarse coverage scale');
assert.match(page, /effectiveCoarseCoverageScale/, 'motion page must expose effective coarse coverage scale');
assert.match(page, /atan2\(2\.0 \* covarianceXY/, 'projected footprint must diagonalize screen covariance instead of pinning elongation upright');
assert.match(page, /principalAxis/, 'projected footprint must consume the stored 3D principal axis');
assert.match(page, /validateSmokeSplatGpuProduct/, 'motion page must validate every uploaded phase through the shared GPU product socket');
assert.match(
  page,
  /state\.temporalAuthority\s*=\s*source\.manifest\.temporalAuthority/,
  'motion page must expose the effective source temporal authority instead of retaining the legacy default',
);
assert.match(page, /gpuProducts/, 'motion page must expose the validated shared GPU products in runtime evidence');
assert.match(page, /slotResolve/, 'motion page must expose unique-slot decode accounting for phase-transfer requests');
assert.match(
  page,
  /var supportArea = 3\.14159265 \* radiusX \* radiusY \* footprintScale \* footprintScale/,
  'every footprint authority must conserve extinction when coarse coverage changes rendered area',
);

assert.match(witness, /kaminos\.smoke-splat-motion-witness\.v0/, 'motion witness must publish a stable report schema');
assert.match(witness, /Page\.captureScreenshot/, 'motion witness must capture the rendered visual output');
assert.match(witness, /Runtime\.evaluate/, 'motion witness must read live route state rather than infer it from the URL');
assert.match(witness, /failurePhase/, 'motion witness must preserve the exact failure phase');
assert.match(witness, /lastTrustworthyEvidence/, 'motion witness must preserve partial evidence on failure');
assert.match(witness, /fallback/i, 'motion witness must reject fallback output');
assert.match(witness, /blank/i, 'motion witness must reject blank output');
assert.match(witness, /frameDigest/i, 'motion witness must reject cached or static frames');
assert.match(witness, /requestedFootprintAuthority/, 'motion witness must preserve requested footprint authority');
assert.match(witness, /effectiveFootprintAuthority/, 'motion witness must reject a mismatched effective footprint authority');
assert.match(witness, /rejectsWrongFootprintAuthority/, 'motion witness must name footprint fallback as a false-closure path');
assert.match(witness, /requestedCoarseCoverageScale/, 'motion witness must preserve requested coarse coverage scale');
assert.match(witness, /effectiveCoarseCoverageScale/, 'motion witness must reject a mismatched effective coarse coverage scale');
assert.match(witness, /rejectsWrongCoarseCoverageScale/, 'motion witness must name coverage substitution as a false-closure path');
assert.match(witness, /SMOKE_GAUSSIAN_PHASE_TEMPORAL_AUTHORITY/, 'motion witness must recognize exact adjacent-teacher phase authority');
assert.match(witness, /gpuProducts/, 'motion witness must require shared GPU product socket evidence');
assert.match(witness, /uniqueSlotCount/, 'motion witness must preserve unique-slot decode accounting');
assert.match(witness, /decodeCount/, 'motion witness must prove decodes scale with unique phase slots');
assert.match(
  witness,
  /const requestedRoute = new URL\(requestedUrl\)\.searchParams\.get\('route'\)/,
  'motion witness must preserve the route literally requested by the caller',
);
assert.match(witness, /sampleCount:\s*state\.timing\.frameIntervalsMs\.length/, 'motion witness must retain timing sample count');
assert.doesNotMatch(
  witness,
  /timing:\s*state\.timing\s*,/,
  'durable frame evidence must not duplicate the full rolling timing sample window',
);

assert.notEqual(manifestText, '', 'real motion source manifest must exist');
const manifest = JSON.parse(manifestText);
assert.equal(manifest.schema, 'kaminos.smoke-splat-motion-source.v0');
assert.equal(manifest.status, 'passed');
assert.equal(manifest.requestedRoute, manifest.effectiveRoute);
assert.equal(manifest.products.length, 2, 'first witness uses only the two exact materialized phase products');
assert.equal(manifest.products.some(product => product.producerKind === 'learned-heldout-residual-selector'), true);
assert.equal(manifest.products.every(product => product.capacity.outputWasTruncated === false), true);
assert.equal(manifest.products.every(product => product.accounting.rejectedExtinctionMass === 0), true);

assert.notEqual(projectedDefaultReportText, '', 'projected default report must exist');
const projectedDefaultReport = JSON.parse(projectedDefaultReportText);
assert.equal(projectedDefaultReport.requestedCoarseCoverageScale, 1);
assert.equal(projectedDefaultReport.effectiveCoarseCoverageScale, 1);
assert.equal(projectedDefaultReport.falseClosureChecks.rejectsWrongCoarseCoverageScale, true);

const {
  SMOKE_SPLAT_FOOTPRINT_BILLBOARD_AUTHORITY,
  SMOKE_SPLAT_FOOTPRINT_PROJECTED_COVARIANCE_AUTHORITY,
  buildSmokeSplatDrawPlan,
  cameraFrame,
  loadSmokeSplatMotionSource,
  parsePackedSmokeSplatProduct,
  projectAxisymmetricSmokeFootprint,
  selectSmokeSplatIndices,
  sha256Hex,
  validateSmokeSplatMotionManifest,
} = await import(moduleUrl);

assert.equal(SMOKE_SPLAT_FOOTPRINT_BILLBOARD_AUTHORITY, 'camera-upright-billboard-v0');
assert.equal(SMOKE_SPLAT_FOOTPRINT_PROJECTED_COVARIANCE_AUTHORITY, 'axisymmetric-projected-covariance-v1');
const frame = cameraFrame([2, 2, 5], [0, 0, 0], [0, 1, 0]);
assert.ok(Math.abs(frame.right.reduce((sum, value, index) => sum + value * frame.up[index], 0)) < 1e-12);
assert.ok(Math.abs(Math.hypot(...frame.right) - 1) < 1e-12);
assert.ok(Math.abs(Math.hypot(...frame.up) - 1) < 1e-12);
const horizontalFootprint = projectAxisymmetricSmokeFootprint({
  principalAxis: [1, 0, 0],
  radialRadius: 1,
  longitudinalRadius: 3,
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
});
assert.ok(Math.abs(horizontalFootprint.majorRadius - 3) < 1e-12);
assert.ok(Math.abs(horizontalFootprint.minorRadius - 1) < 1e-12);
assert.ok(Math.abs(Math.abs(horizontalFootprint.majorAxis[0]) - 1) < 1e-12);
const verticalFootprint = projectAxisymmetricSmokeFootprint({
  principalAxis: [0, 1, 0],
  radialRadius: 1,
  longitudinalRadius: 3,
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
});
assert.ok(Math.abs(verticalFootprint.majorRadius - 3) < 1e-12);
assert.ok(Math.abs(Math.abs(verticalFootprint.majorAxis[1]) - 1) < 1e-12);
const oblique = Math.SQRT1_2;
const obliqueFootprint = projectAxisymmetricSmokeFootprint({
  principalAxis: [oblique, oblique, 0],
  radialRadius: 1,
  longitudinalRadius: 3,
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
});
assert.ok(Math.abs(obliqueFootprint.majorRadius - 3) < 1e-12);
assert.ok(Math.abs(obliqueFootprint.minorRadius - 1) < 1e-12);
assert.ok(Math.abs(Math.abs(obliqueFootprint.majorAxis[0]) - oblique) < 1e-12);
assert.ok(Math.abs(Math.abs(obliqueFootprint.majorAxis[1]) - oblique) < 1e-12);
const viewParallelFootprint = projectAxisymmetricSmokeFootprint({
  principalAxis: [0, 0, 1],
  radialRadius: 1,
  longitudinalRadius: 3,
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
});
assert.ok(Math.abs(viewParallelFootprint.majorRadius - 1) < 1e-12);
assert.ok(Math.abs(viewParallelFootprint.minorRadius - 1) < 1e-12);
assert.ok(Math.abs(viewParallelFootprint.supportArea - Math.PI) < 1e-12);

const fixtureProducts = [
  {
    identity: 'phase:a',
    hierarchyCounts: { coarse: 1, fine: 1, total: 2 },
    splats: [
      { hierarchyRoleCode: 0, extinctionMass: 0.6 },
      { hierarchyRoleCode: 1, extinctionMass: 0.4 },
    ],
  },
  {
    identity: 'phase:b',
    hierarchyCounts: { coarse: 1, fine: 1, total: 2 },
    splats: [
      { hierarchyRoleCode: 0, extinctionMass: 0.7 },
      { hierarchyRoleCode: 1, extinctionMass: 0.3 },
    ],
  },
];

assert.deepEqual(selectSmokeSplatIndices(fixtureProducts[0], { fineLodFraction: 0 }), [0]);
assert.deepEqual(selectSmokeSplatIndices(fixtureProducts[0], { fineLodFraction: 1 }), [0, 1]);

const uncappedPlan = buildSmokeSplatDrawPlan({ products: fixtureProducts, instanceCount: 257, fineLodFraction: 0 });
assert.equal(uncappedPlan.instanceCount, 257, 'caller instance count passes through without a hidden product cap');
assert.equal(uncappedPlan.uniqueProductCount, 2, 'uploads scale with exact phase products, not instances');
assert.equal(uncappedPlan.productUploads.length, 2);
assert.equal(uncappedPlan.instanceBindings.length, 257);
assert.equal(uncappedPlan.coarseSplatsAlwaysPresent, true);
assert.equal(uncappedPlan.rejectedExtinctionMass, 0);

const packed = new Float32Array([
  0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.1, 0.5, 0.25, 0.1, 0, 0.2, 0, 0,
  1, 1, 1, 0, 1, 0, 0.05, 0.1, 0.05, 0.2, 0.4, 0.2, 0.1, 0.3, 0, 1,
]);
const parsed = parsePackedSmokeSplatProduct(packed.buffer, {
  artifact: { byteLength: packed.byteLength, shape: [2, 16] },
  hierarchyCounts: { coarse: 1, fine: 1, total: 2 },
  accounting: { representedExtinctionMass: 0.7 },
});
assert.equal(parsed.splats.length, 2);
assert.equal(parsed.splats[0].hierarchyRoleCode, 0);
assert.equal(parsed.splats[1].hierarchyRoleCode, 1);

const gaussianChannelOrder = [
  'positionX', 'positionY', 'positionZ',
  'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
  'axis0X', 'axis0Y', 'axis0Z', 'axis1X', 'axis1Y', 'axis1Z', 'axis2X', 'axis2Y', 'axis2Z',
  'radius0', 'radius1', 'radius2',
  'extinctionMass', 'densityWitness', 'temperatureWitness',
  'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
];
const gaussianPacked = new Float32Array([
  1, 2, 3,
  0.04, 0, 0, 0.09, 0, 0.01,
  0, 1, 0, 1, 0, 0, 0, 0, 1,
  0.3, 0.2, 0.1,
  0.5, 0.25, 0.1,
  0.01, 0.02, 0.03, 64,
]);
const gaussianProductDescriptor = {
  schema: 'kaminos.smoke-gaussian-oracle-phase-product.v0',
  identity: 'gaussian-phase:45:1024',
  producerAuthority: 'oracle-fitted-gaussian-smoke-splat-producer-v0',
  producerKind: 'oracle-fitted-adjacent-teacher-phase',
  slotIdentity: {
    historySlot: 0,
    slotWriteTick: 45,
    simulatorGeneration: 1,
    modelIdentity: 'gaussian-phase-model:test',
  },
  roleMappingAuthority: 'all-gaussians-transport-role-no-hierarchy-v0',
  hierarchyCounts: { coarse: 1, fine: 0, total: 1 },
  accounting: {
    sourceExtinctionMass: 0.5,
    representedExtinctionMass: 0.5,
    rejectedExtinctionMass: 0,
  },
  capacity: { requested: 1, active: 1, overflowCount: 0, outputWasTruncated: false },
  artifact: {
    byteLength: gaussianPacked.byteLength,
    shape: [1, 28],
    channelOrder: gaussianChannelOrder,
    sourcePackingIdentity: 'float32x28-full-covariance-gaussian-v0',
  },
};
const convertedGaussian = parsePackedSmokeSplatProduct(gaussianPacked.buffer, gaussianProductDescriptor);
assert.equal(convertedGaussian.packed.length, 16);
assert.deepEqual(Array.from(convertedGaussian.packed.slice(0, 6)), [1, 2, 3, 0, 1, 0]);
assert.ok(Math.abs(convertedGaussian.packed[6] - 0.2) < 1e-6, 'radius1 becomes radial radius X');
assert.ok(Math.abs(convertedGaussian.packed[7] - 0.3) < 1e-6, 'major radius0 becomes longitudinal radius Y');
assert.ok(Math.abs(convertedGaussian.packed[8] - 0.1) < 1e-6, 'radius2 becomes radial radius Z');
assert.equal(convertedGaussian.packed[15], 0, 'full Gaussian products map explicitly to transport role');
assert.equal(convertedGaussian.conversionAuthority, 'full-covariance-to-axisymmetric-major-eigenvector-v0');
const convertedGaussianDrawPlan = buildSmokeSplatDrawPlan({
  products: [convertedGaussian],
  instanceCount: 1,
  fineLodFraction: 1,
});
assert.equal(
  convertedGaussianDrawPlan.productUploads[0].sourceRepresentation,
  'float32x28-full-covariance-gaussian-v0',
  'draw plan must preserve the oracle source representation',
);
assert.equal(
  convertedGaussianDrawPlan.productUploads[0].conversionAuthority,
  'full-covariance-to-axisymmetric-major-eigenvector-v0',
  'draw plan must preserve the lossy Gaussian conversion authority',
);
assert.equal(
  convertedGaussianDrawPlan.productUploads[0].effectiveRepresentation,
  'float32x16-axisymmetric-smoke-v0',
  'draw plan must name the effective renderer representation after conversion',
);

const gaussianManifest = structuredClone(manifest);
gaussianManifest.producerAuthority = gaussianProductDescriptor.producerAuthority;
gaussianManifest.temporalAuthority = 'independent-adjacent-teacher-phase-products-v0';
gaussianManifest.products = gaussianManifest.products.map((_product, index) => ({
  ...gaussianProductDescriptor,
  identity: `gaussian-phase:${45 + index}:1024`,
  slotIdentity: { ...gaussianProductDescriptor.slotIdentity, historySlot: index, slotWriteTick: 45 + index },
  artifact: {
    ...gaussianProductDescriptor.artifact,
    path: `budget-1024-step-${45 + index}.gaussians.f32`,
    sha256: String(index + 1).repeat(64),
    dtype: 'float32',
    byteOrder: 'little-endian',
  },
}));
assert.equal(
  validateSmokeSplatMotionManifest(gaussianManifest),
  gaussianManifest,
  'motion evidence must preserve Gaussian producer and adjacent-teacher temporal authority without legacy impersonation',
);

function dataUrl(mediaType, bytes) {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const gaussianArtifactBytes = Buffer.from(gaussianPacked.buffer);
const gaussianArtifactSha256 = await sha256Hex(exactArrayBuffer(gaussianArtifactBytes));
const phaseCamera = {
  position: [1.18, 0.28, 2.05],
  target: [0, 0.02, 0],
  projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.02, 0],
  matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2.4, 1],
};
const phaseCameraIdentity = `sha256:${await sha256Hex(exactArrayBuffer(Buffer.from(JSON.stringify(phaseCamera))))}`;
const phaseFitReportUrls = [];
const phaseFitReportHashes = [];
const phaseFitReports = [];
for (const step of [45, 46]) {
  const report = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    hiddenBudgetCapApplied: false,
    teacher: {
      sourceSchema: 'kaminos.volume.full-grid-field-export.v0',
      simStepCount: step,
      cameraIdentity: phaseCameraIdentity,
      camera: phaseCamera,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:test',
      totalSmokeExtinction: 0.5,
    },
    budgetCurve: [{
      requestedBudget: 1,
      activeGaussianCount: 1,
      totalAssignedExtinction: 0.5,
      artifact: {
        ...gaussianProductDescriptor.artifact,
        path: `budget-1-step-${step}.gaussians.f32`,
        sha256: `sha256:${gaussianArtifactSha256}`,
        dtype: 'float32',
        byteOrder: 'little-endian',
      },
    }],
  };
  const bytes = Buffer.from(`${JSON.stringify(report)}\n`);
  phaseFitReports.push(report);
  phaseFitReportUrls.push(dataUrl('application/json', bytes));
  phaseFitReportHashes.push(await sha256Hex(exactArrayBuffer(bytes)));
}
const phaseRequest = {
  schema: 'kaminos.smoke-gaussian-phase-transfer-request.v0',
  status: 'requested',
  requestedRoute: 'webgpu-real-field-hierarchical-smoke-motion-v0',
  budget: 1,
  simulatorGeneration: 1,
  modelIdentity: 'gaussian-phase-model:test',
  cameraIdentity: phaseCameraIdentity,
  phases: [45, 46].map((slotWriteTick, historySlot) => ({
    historySlot,
    slotWriteTick,
    fitReportUrl: phaseFitReportUrls[historySlot],
    fitReportSha256: phaseFitReportHashes[historySlot],
    artifactUrl: dataUrl('application/octet-stream', gaussianArtifactBytes),
    artifactSha256: gaussianArtifactSha256,
  })),
};
function requestUrl(candidate) {
  return new URL(dataUrl('application/json', Buffer.from(`${JSON.stringify(candidate)}\n`)));
}

async function phaseWithReport(candidate, phaseIndex, report) {
  const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
  candidate.phases[phaseIndex].fitReportUrl = dataUrl('application/json', reportBytes);
  candidate.phases[phaseIndex].fitReportSha256 = await sha256Hex(exactArrayBuffer(reportBytes));
  return candidate;
}

const loadedPhaseRequest = await loadSmokeSplatMotionSource(
  requestUrl(phaseRequest),
  { instanceCount: 4, fineLodFraction: 1 },
);
assert.equal(loadedPhaseRequest.slotResolve.instanceCount, 4);
assert.equal(loadedPhaseRequest.slotResolve.uniqueSlotCount, 2);
assert.equal(loadedPhaseRequest.slotResolve.decodeCount, 2);
assert.equal(loadedPhaseRequest.slotResolve.cacheHitCount, 0);
assert.equal(loadedPhaseRequest.products.length, 2);
assert.equal(new Set(loadedPhaseRequest.drawPlan.instanceBindings.map(binding => binding.productIdentity)).size, 2);
assert.equal(loadedPhaseRequest.manifest.producerAuthority, 'oracle-fitted-gaussian-smoke-splat-producer-v0');

await assert.rejects(
  loadSmokeSplatMotionSource(requestUrl({
    ...structuredClone(phaseRequest),
    cameraIdentity: `sha256:${'e'.repeat(64)}`,
  })),
  /camera identity mismatch/i,
  'a requested camera cannot impersonate the exact teacher camera',
);
const hiddenCapRequest = await phaseWithReport(
  structuredClone(phaseRequest),
  0,
  { ...structuredClone(phaseFitReports[0]), hiddenBudgetCapApplied: true },
);
await assert.rejects(
  loadSmokeSplatMotionSource(requestUrl(hiddenCapRequest)),
  /budget-cap accounting/i,
  'a fit report with a hidden cap cannot become phase evidence',
);
const fallbackTeacherRequest = await phaseWithReport(
  structuredClone(phaseRequest),
  0,
  {
    ...structuredClone(phaseFitReports[0]),
    teacher: { ...phaseFitReports[0].teacher, effectiveRoute: 'fallback-static-smoke-v0' },
  },
);
await assert.rejects(
  loadSmokeSplatMotionSource(requestUrl(fallbackTeacherRequest)),
  /teacher authority mismatch/i,
  'a fallback teacher route cannot become phase evidence',
);
await assert.rejects(
  loadSmokeSplatMotionSource(requestUrl({
    ...structuredClone(phaseRequest),
    phases: phaseRequest.phases.map((phase, index) => index === 1 ? { ...phase, slotWriteTick: 47 } : phase),
  })),
  /teacher step does not match slot write tick/i,
  'a stale or mislabeled phase product cannot enter another slot',
);
await assert.rejects(
  loadSmokeSplatMotionSource(requestUrl({
    ...structuredClone(phaseRequest),
    phases: phaseRequest.phases.map((phase, index) => index === 0
      ? { ...phase, artifactUrl: dataUrl('application/octet-stream', Buffer.alloc(0)) }
      : phase),
  })),
  /artifact sha256 mismatch/i,
  'blank artifact output cannot present as phase evidence',
);
assert.throws(
  () => parsePackedSmokeSplatProduct(packed.buffer, {
    artifact: { byteLength: packed.byteLength, shape: [2, 16] },
    hierarchyCounts: { coarse: 1, fine: 1, total: 2 },
    accounting: { representedExtinctionMass: 0.9 },
  }),
  /packed extinction mass mismatch/i,
  'packed optical mass cannot silently disagree with the evidence manifest',
);

assert.throws(
  () => validateSmokeSplatMotionManifest({ ...manifest, effectiveRoute: 'fallback-canvas-v0' }),
  /requested.*effective route|route mismatch/i,
  'a fallback route cannot present as accepted WebGPU evidence',
);

console.log('smoke splat motion runtime contracts passed');
