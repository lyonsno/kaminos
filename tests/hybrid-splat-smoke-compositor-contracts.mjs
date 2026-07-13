import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../hybrid-splat-smoke-compositor.mjs', import.meta.url);
const moduleSource = await readFile(moduleUrl, 'utf8').catch(() => '');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

assert.match(
  moduleSource,
  /export function composeSingleDepthLayers/,
  'hybrid composition math must be an explicit reusable contract',
);

const {
  HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
  HYBRID_SPLAT_LAYER_IDENTITY,
  HYBRID_SMOKE_LAYER_IDENTITY,
  HYBRID_SMOKE_FRONT_OPACITY_CEILING,
  composeSingleDepthLayers,
} = await import(moduleUrl);

assert.equal(HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY, 'single-representative-depth-splat-smoke-compositor-v0');
assert.equal(HYBRID_SPLAT_LAYER_IDENTITY, 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0');
assert.equal(HYBRID_SMOKE_LAYER_IDENTITY, 'raymarched-smoke-radiance-transmittance-linear-depth-moments-v0');
assert.equal(HYBRID_SMOKE_FRONT_OPACITY_CEILING, 0.18);

const splatFront = composeSingleDepthLayers({
  splat: { premultipliedRadiance: [1, 0.5, 0.2], opacity: 0.75, representativeDepth: 2 },
  smoke: { premultipliedRadiance: [0.1, 0.2, 0.3], opacity: 0.5, representativeDepth: 4 },
});
assert.equal(splatFront.status, 'composed');
assert.equal(splatFront.frontLayer, 'splat');
assert.deepEqual(splatFront.premultipliedRadiance, [1.025, 0.55, 0.275]);
assert.equal(splatFront.opacity, 0.875);
assert.equal(splatFront.approximation, 'single-representative-depth-no-interpenetration-split');

const smokeFront = composeSingleDepthLayers({
  splat: { premultipliedRadiance: [1, 0.5, 0.2], opacity: 0.75, representativeDepth: 5 },
  smoke: { premultipliedRadiance: [0.1, 0.2, 0.3], opacity: 0.5, representativeDepth: 3 },
});
assert.equal(smokeFront.frontLayer, 'smoke');
assert.deepEqual(
  smokeFront.premultipliedRadiance.map(value => Number(value.toFixed(6))),
  [0.856, 0.482, 0.272],
);
assert.equal(smokeFront.opacity, 0.7949999999999999);

const denseSmokeFront = composeSingleDepthLayers({
  splat: { premultipliedRadiance: [1, 0.5, 0.2], opacity: 0.75, representativeDepth: 5 },
  smoke: { premultipliedRadiance: [0.19, 0.38, 0.57], opacity: 0.95, representativeDepth: 3 },
});
assert.equal(denseSmokeFront.frontLayer, 'smoke');
assert.equal(denseSmokeFront.frontOpacityInput, 0.95);
assert.equal(denseSmokeFront.frontOpacityApplied, HYBRID_SMOKE_FRONT_OPACITY_CEILING);
assert.deepEqual(
  denseSmokeFront.premultipliedRadiance.map(value => Number(value.toFixed(6))),
  [0.856, 0.482, 0.272],
  'the declared v0 approximation must preserve flame visibility when one smoke depth stands in for an interpenetrating volume',
);
assert.equal(denseSmokeFront.opacity, 0.7949999999999999);

const noSmoke = composeSingleDepthLayers({
  splat: { premultipliedRadiance: [0.4, 0.2, 0.1], opacity: 0.5, representativeDepth: 2 },
  smoke: { premultipliedRadiance: [0, 0, 0], opacity: 0, representativeDepth: null },
});
assert.equal(noSmoke.frontLayer, 'splat');
assert.deepEqual(noSmoke.premultipliedRadiance, [0.4, 0.2, 0.1]);

const invalidMoments = composeSingleDepthLayers({
  splat: { premultipliedRadiance: [0.4, 0.2, 0.1], opacity: 0.5, representativeDepth: null },
  smoke: { premultipliedRadiance: [0.1, 0.1, 0.1], opacity: 0.5, representativeDepth: 3 },
});
assert.deepEqual(invalidMoments, {
  identity: HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
  status: 'invalid',
  fallbackReason: 'splat-representative-depth-missing',
  approximation: 'single-representative-depth-no-interpenetration-split',
});

const invalidSmokeMoments = composeSingleDepthLayers({
  splat: { premultipliedRadiance: [0.4, 0.2, 0.1], opacity: 0.5, representativeDepth: 2 },
  smoke: { premultipliedRadiance: [0.1, 0.1, 0.1], opacity: 0.5, representativeDepth: null },
});
assert.deepEqual(invalidSmokeMoments, {
  identity: HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
  status: 'invalid',
  fallbackReason: 'smoke-representative-depth-missing',
  approximation: 'single-representative-depth-no-interpenetration-split',
});

assert.throws(
  () => composeSingleDepthLayers({
    splat: { premultipliedRadiance: [Number.NaN, 0, 0], opacity: 0.5, representativeDepth: 2 },
    smoke: { premultipliedRadiance: [0, 0, 0], opacity: 0.5, representativeDepth: 3 },
  }),
  /finite/i,
  'non-finite layer data cannot become authoritative presentation',
);

assert.match(page, /volume-boundary-splat-composition/, 'operator cockpit exposes splat-only versus hybrid-smoke composition');
assert.match(page, /volume_boundary_splat_composition/, 'composition mode is preserved in the URL route');
assert.match(core, /HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY/, 'runtime names the hybrid compositor identity');
assert.match(core, /HYBRID_SMOKE_RENDERER_IDENTITY\s*=\s*'native-3d-compute-fluid-raymarch-smoke-only-v0'/, 'runtime names independent smoke authority');
assert.match(core, /boundarySplatHybridFs/, 'splat raster emits a dedicated hybrid radiance and depth-moment layer');
assert.match(core, /fsHybridSmoke/, 'raymarch exposes a smoke-only radiance, transmittance, and depth-moment pass');
assert.match(core, /rgba16float/, 'hybrid layers retain HDR accumulation before presentation grading');
assert.match(core, /encodeBoundarySplatSmokeHybrid/, 'frame routing uses the explicit hybrid compositor path');
assert.match(
  core,
  /let hdr = composed\.rgb \+ background[\s\S]*return vec4<f32>\(hdr, 1\.0\);/,
  'hybrid resolve must preserve the splat-only presentation transfer instead of adding a second exposure or gamma manifold',
);
assert.match(core, /boundarySplatCompositionRequested/, 'debug state preserves requested hybrid composition');
assert.match(core, /boundarySplatCompositionEffective/, 'debug state preserves effective hybrid composition');
assert.match(core, /boundarySplatCompositionFallbackReason/, 'hybrid route failure is explicit rather than hidden substitution');
assert.match(core, /single-representative-depth-no-interpenetration-split/, 'runtime declares the first compositor approximation boundary');
assert.match(core, /HYBRID_SMOKE_FRONT_OPACITY_CEILING/, 'runtime uses the declared v0 smoke-front opacity ceiling');
assert.match(core, /hybridSmokeFrontOpacityCeiling/, 'runtime reports the visual-preservation ceiling instead of applying it silently');
assert.match(witness, /boundarySplatCompositionRequested/, 'witness preserves requested composition identity');
assert.match(witness, /boundarySplatCompositionEffective/, 'witness preserves effective composition identity');
assert.match(witness, /boundarySplatCompositionFallbackReason/, 'witness preserves explicit hybrid fallback evidence');
assert.match(witness, /hybridSplatLayer/, 'witness preserves splat attachment semantics');
assert.match(witness, /hybridSmokeLayer/, 'witness preserves smoke attachment semantics');
assert.match(witness, /hybridSmokeFrontOpacityCeiling/, 'witness preserves the v0 smoke-front visibility limitation');

console.log('hybrid splat smoke compositor contracts passed');
