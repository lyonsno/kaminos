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
assert.match(page, /product_index/, 'held comparison must accept an explicit source product cell');
assert.match(page, /requestedProductIndex/, 'held comparison must preserve the requested product cell');
assert.match(page, /effectiveProductIndex/, 'held comparison must expose the effective product cell');
assert.match(page, /HELD_SMOKE_ASSAY_ROUTE_IDENTITY/, 'the raster must admit the checksum-bound held comparison route explicitly');
assert.match(page, /source\.manifest\.temporalAuthority/, 'runtime temporal authority must come from the admitted source manifest');
assert.match(page, /source\.manifest\.camera\.matrixWorldInverse/, 'the held comparison must consume the checksum-bound camera matrix');
assert.match(page, /heldAssay\s*\?\s*0/, 'the held comparison must not animate current-state splats through velocity extrapolation');
assert.match(page, /atan2\(2\.0 \* covarianceXY/, 'projected footprint must diagonalize screen covariance instead of pinning elongation upright');
assert.match(page, /principalAxis/, 'projected footprint must consume the stored 3D principal axis');
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
assert.match(witness, /HELD_SMOKE_ASSAY_ROUTE_IDENTITY/, 'visual witness must validate the held assay route without motion-route fallback');
assert.match(witness, /heldCurrentState/, 'visual witness must distinguish intentional held-state stability from a cached motion failure');
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
  HELD_SMOKE_ASSAY_MANIFEST_SCHEMA,
  HELD_SMOKE_ASSAY_ROUTE_IDENTITY,
  HELD_SMOKE_ASSAY_TEMPORAL_AUTHORITY,
  SMOKE_SPLAT_MOTION_ROUTE_IDENTITY,
  SMOKE_SPLAT_FOOTPRINT_BILLBOARD_AUTHORITY,
  SMOKE_SPLAT_FOOTPRINT_PROJECTED_COVARIANCE_AUTHORITY,
  buildSmokeSplatDrawPlan,
  cameraFrame,
  parsePackedSmokeSplatProduct,
  projectAxisymmetricSmokeFootprint,
  selectSmokeSplatIndices,
  validateSmokeSplatMotionManifest,
} = await import(moduleUrl);

assert.equal(HELD_SMOKE_ASSAY_MANIFEST_SCHEMA, 'kaminos.held-smoke-assay-source.v0');
assert.equal(HELD_SMOKE_ASSAY_ROUTE_IDENTITY, 'webgpu-held-smoke-assay-v0');
assert.equal(HELD_SMOKE_ASSAY_TEMPORAL_AUTHORITY, 'held-current-state-only-v0');
const heldManifest = {
  ...manifest,
  schema: HELD_SMOKE_ASSAY_MANIFEST_SCHEMA,
  requestedRoute: HELD_SMOKE_ASSAY_ROUTE_IDENTITY,
  effectiveRoute: HELD_SMOKE_ASSAY_ROUTE_IDENTITY,
  temporalAuthority: HELD_SMOKE_ASSAY_TEMPORAL_AUTHORITY,
  source: {
    manifestIdentity: `sha256:${'a'.repeat(64)}`,
    fluidIdentity: `sha256:${'b'.repeat(64)}`,
    cameraIdentity: `sha256:${'c'.repeat(64)}`,
    simStepCount: 179290,
  },
  camera: {
    position: [-4.2, 2.1, 8.2],
    target: [0, 0.02, 0],
    projectionMatrix: [1, 0, 0, 0, 0, 2.7, 0, 0, 0, 0, -1, -1, 0, 0, -0.02, 0],
    matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -9, 1],
  },
};
assert.equal(validateSmokeSplatMotionManifest(heldManifest).schema, HELD_SMOKE_ASSAY_MANIFEST_SCHEMA);
const denseManifestProduct = {
  ...heldManifest.products[0],
  identity: 'dense-held-upper-bound',
  producerKind: 'dense-occupied-fine-bin-lift',
  hierarchyCounts: {
    coarse: 0,
    fine: heldManifest.products[0].hierarchyCounts.total,
    total: heldManifest.products[0].hierarchyCounts.total,
  },
};
assert.equal(
  validateSmokeSplatMotionManifest({ ...heldManifest, products: [denseManifestProduct] }).products[0].producerKind,
  'dense-occupied-fine-bin-lift',
  'a complete fine-only dense lift must enter the held renderer without fabricating a coarse tier',
);
assert.throws(
  () => validateSmokeSplatMotionManifest({ ...heldManifest, effectiveRoute: SMOKE_SPLAT_MOTION_ROUTE_IDENTITY }),
  /requested.*effective route|route mismatch/i,
  'held assay evidence cannot fall back to the historical motion route',
);

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

const denseOnlyProduct = {
  identity: 'dense:u',
  hierarchyCounts: { coarse: 0, fine: 2, total: 2 },
  splats: [
    { index: 0, hierarchyRoleCode: 1, extinctionMass: 0.55 },
    { index: 1, hierarchyRoleCode: 1, extinctionMass: 0.45 },
  ],
};
const denseOnlyPlan = buildSmokeSplatDrawPlan({ products: [denseOnlyProduct], instanceCount: 1, fineLodFraction: 1 });
assert.equal(denseOnlyPlan.uniqueProductCount, 1);
assert.equal(denseOnlyPlan.productUploads[0].coarseCount, 0);
assert.equal(denseOnlyPlan.productUploads[0].fineCount, 2);
assert.equal(denseOnlyPlan.productUploads[0].representedExtinctionMass, 1);
assert.equal(denseOnlyPlan.rejectedExtinctionMass, 0);
assert.equal(denseOnlyPlan.coarseSplatsAlwaysPresent, false, 'the dense competence route truthfully has no coarse transport tier');

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
