import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../smoke-splat-motion-source.mjs', import.meta.url);
const pageUrl = new URL('../smoke-splat-motion.html', import.meta.url);
const witnessUrl = new URL('../smoke-splat-motion-witness.mjs', import.meta.url);
const manifestUrl = new URL('../artifacts/real-smoke-hierarchy-0713/motion-source.json', import.meta.url);

const source = await readFile(moduleUrl, 'utf8').catch(() => '');
const page = await readFile(pageUrl, 'utf8').catch(() => '');
const witness = await readFile(witnessUrl, 'utf8').catch(() => '');
const manifestText = await readFile(manifestUrl, 'utf8').catch(() => '');

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

assert.match(witness, /kaminos\.smoke-splat-motion-witness\.v0/, 'motion witness must publish a stable report schema');
assert.match(witness, /Page\.captureScreenshot/, 'motion witness must capture the rendered visual output');
assert.match(witness, /Runtime\.evaluate/, 'motion witness must read live route state rather than infer it from the URL');
assert.match(witness, /failurePhase/, 'motion witness must preserve the exact failure phase');
assert.match(witness, /lastTrustworthyEvidence/, 'motion witness must preserve partial evidence on failure');
assert.match(witness, /fallback/i, 'motion witness must reject fallback output');
assert.match(witness, /blank/i, 'motion witness must reject blank output');
assert.match(witness, /frameDigest/i, 'motion witness must reject cached or static frames');
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

const {
  buildSmokeSplatDrawPlan,
  parsePackedSmokeSplatProduct,
  selectSmokeSplatIndices,
  validateSmokeSplatMotionManifest,
} = await import(moduleUrl);

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
});
assert.equal(parsed.splats.length, 2);
assert.equal(parsed.splats[0].hierarchyRoleCode, 0);
assert.equal(parsed.splats[1].hierarchyRoleCode, 1);

assert.throws(
  () => validateSmokeSplatMotionManifest({ ...manifest, effectiveRoute: 'fallback-canvas-v0' }),
  /requested.*effective route|route mismatch/i,
  'a fallback route cannot present as accepted WebGPU evidence',
);

console.log('smoke splat motion runtime contracts passed');
