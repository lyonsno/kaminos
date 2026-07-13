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
assert.match(
  moduleSource,
  /export function composeDepthIntervalLayers/,
  'front/back smoke interval composition must be an explicit reusable contract',
);

const {
  HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
  HYBRID_SPLAT_LAYER_IDENTITY,
  HYBRID_SMOKE_LAYER_IDENTITY,
  HYBRID_SPLAT_SMOKE_APPROXIMATION,
  LEGACY_SINGLE_DEPTH_COMPOSITOR_IDENTITY,
  LEGACY_SINGLE_DEPTH_APPROXIMATION,
  HYBRID_SMOKE_FRONT_OPACITY_CEILING,
  composeDepthIntervalLayers,
  composeSingleDepthLayers,
} = await import(moduleUrl);

assert.equal(HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY, 'splat-depth-conditioned-front-back-smoke-compositor-v1');
assert.equal(HYBRID_SPLAT_LAYER_IDENTITY, 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0');
assert.equal(HYBRID_SMOKE_LAYER_IDENTITY, 'raymarched-smoke-front-back-radiance-transmittance-linear-depth-intervals-v1');
assert.equal(HYBRID_SPLAT_SMOKE_APPROXIMATION, 'splat-depth-conditioned-raymarched-front-back-smoke-intervals');
assert.equal(LEGACY_SINGLE_DEPTH_COMPOSITOR_IDENTITY, 'single-representative-depth-splat-smoke-compositor-v0');
assert.equal(LEGACY_SINGLE_DEPTH_APPROXIMATION, 'single-representative-depth-no-interpenetration-split');
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
  identity: LEGACY_SINGLE_DEPTH_COMPOSITOR_IDENTITY,
  status: 'invalid',
  fallbackReason: 'splat-representative-depth-missing',
  approximation: LEGACY_SINGLE_DEPTH_APPROXIMATION,
});

const invalidSmokeMoments = composeSingleDepthLayers({
  splat: { premultipliedRadiance: [0.4, 0.2, 0.1], opacity: 0.5, representativeDepth: 2 },
  smoke: { premultipliedRadiance: [0.1, 0.1, 0.1], opacity: 0.5, representativeDepth: null },
});
assert.deepEqual(invalidSmokeMoments, {
  identity: LEGACY_SINGLE_DEPTH_COMPOSITOR_IDENTITY,
  status: 'invalid',
  fallbackReason: 'smoke-representative-depth-missing',
  approximation: LEGACY_SINGLE_DEPTH_APPROXIMATION,
});

assert.throws(
  () => composeSingleDepthLayers({
    splat: { premultipliedRadiance: [Number.NaN, 0, 0], opacity: 0.5, representativeDepth: 2 },
    smoke: { premultipliedRadiance: [0, 0, 0], opacity: 0.5, representativeDepth: 3 },
  }),
  /finite/i,
  'non-finite layer data cannot become authoritative presentation',
);

const intervalComposite = composeDepthIntervalLayers({
  splat: { premultipliedRadiance: [1, 0.5, 0.2], opacity: 0.5, representativeDepth: 2 },
  smokeFront: {
    premultipliedRadiance: [0.1, 0.2, 0.3],
    opacity: 0.2,
    intervalNearDepth: 1,
    intervalFarDepth: 2,
  },
  smokeBack: {
    premultipliedRadiance: [0.3, 0.1, 0.2],
    opacity: 0.4,
    intervalNearDepth: 2,
    intervalFarDepth: 4,
  },
});
assert.equal(intervalComposite.status, 'composed');
assert.equal(intervalComposite.identity, HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY);
assert.equal(intervalComposite.approximation, HYBRID_SPLAT_SMOKE_APPROXIMATION);
assert.deepEqual(
  intervalComposite.premultipliedRadiance.map(value => Number(value.toFixed(6))),
  [1.02, 0.64, 0.54],
);
assert.equal(Number(intervalComposite.opacity.toFixed(6)), 0.76);
assert.equal(intervalComposite.layerOrder, 'smoke-front>splat>smoke-back');
assert.equal(intervalComposite.smokeFrontOpacityApplied, 0.2, 'front smoke opacity must not be silently capped');

const frontOnly = composeDepthIntervalLayers({
  splat: { premultipliedRadiance: [0.8, 0.4, 0.2], opacity: 0.5, representativeDepth: 3 },
  smokeFront: { premultipliedRadiance: [0.1, 0.1, 0.1], opacity: 0.25, intervalNearDepth: 1, intervalFarDepth: 3 },
  smokeBack: { premultipliedRadiance: [0, 0, 0], opacity: 0, intervalNearDepth: null, intervalFarDepth: null },
});
assert.deepEqual(frontOnly.premultipliedRadiance, [0.7000000000000001, 0.4, 0.25]);
assert.equal(frontOnly.opacity, 0.625);

const backOnly = composeDepthIntervalLayers({
  splat: { premultipliedRadiance: [0.8, 0.4, 0.2], opacity: 0.5, representativeDepth: 3 },
  smokeFront: { premultipliedRadiance: [0, 0, 0], opacity: 0, intervalNearDepth: null, intervalFarDepth: null },
  smokeBack: { premultipliedRadiance: [0.2, 0.1, 0.05], opacity: 0.25, intervalNearDepth: 3, intervalFarDepth: 5 },
});
assert.deepEqual(backOnly.premultipliedRadiance, [0.9, 0.45, 0.225]);
assert.equal(backOnly.opacity, 0.625);

const missingFrontInterval = composeDepthIntervalLayers({
  splat: { premultipliedRadiance: [0.8, 0.4, 0.2], opacity: 0.5, representativeDepth: 3 },
  smokeFront: { premultipliedRadiance: [0.1, 0.1, 0.1], opacity: 0.25, intervalNearDepth: null, intervalFarDepth: null },
  smokeBack: { premultipliedRadiance: [0, 0, 0], opacity: 0, intervalNearDepth: null, intervalFarDepth: null },
});
assert.equal(missingFrontInterval.status, 'invalid');
assert.equal(missingFrontInterval.fallbackReason, 'smoke-front-depth-interval-missing');

const crossingFrontInterval = composeDepthIntervalLayers({
  splat: { premultipliedRadiance: [0.8, 0.4, 0.2], opacity: 0.5, representativeDepth: 3 },
  smokeFront: { premultipliedRadiance: [0.1, 0.1, 0.1], opacity: 0.25, intervalNearDepth: 1, intervalFarDepth: 4 },
  smokeBack: { premultipliedRadiance: [0, 0, 0], opacity: 0, intervalNearDepth: null, intervalFarDepth: null },
});
assert.equal(crossingFrontInterval.status, 'invalid');
assert.equal(crossingFrontInterval.fallbackReason, 'smoke-front-interval-crosses-splat-depth');

const crossingBackInterval = composeDepthIntervalLayers({
  splat: { premultipliedRadiance: [0.8, 0.4, 0.2], opacity: 0.5, representativeDepth: 3 },
  smokeFront: { premultipliedRadiance: [0, 0, 0], opacity: 0, intervalNearDepth: null, intervalFarDepth: null },
  smokeBack: { premultipliedRadiance: [0.1, 0.1, 0.1], opacity: 0.25, intervalNearDepth: 2, intervalFarDepth: 5 },
});
assert.equal(crossingBackInterval.status, 'invalid');
assert.equal(crossingBackInterval.fallbackReason, 'smoke-back-interval-crosses-splat-depth');

assert.match(page, /volume-boundary-splat-composition/, 'operator cockpit exposes splat-only versus hybrid-smoke composition');
assert.match(page, /volume_boundary_splat_composition/, 'composition mode is preserved in the URL route');
assert.match(core, /HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY/, 'runtime names the hybrid compositor identity');
assert.match(core, /HYBRID_SMOKE_RENDERER_IDENTITY\s*=\s*'native-3d-compute-fluid-raymarch-smoke-only-v0'/, 'runtime names independent smoke authority');
assert.match(core, /boundarySplatHybridFs/, 'splat raster emits a dedicated hybrid radiance and depth-moment layer');
assert.match(core, /fsHybridSmoke/, 'raymarch exposes a smoke-only radiance, transmittance, and depth-moment pass');
assert.match(
  core,
  /fn fsHybridSmoke\(in: VSOut\)[\s\S]*let hybridLayerUv = vec2<f32>\(in\.uv\.x, 1\.0 - in\.uv\.y\);[\s\S]*textureSampleLevel\(hybridSplatDepthMoments, hybridSplatDepthSampler, hybridLayerUv/,
  'smoke split must convert fullscreen UVs to render-attachment texture orientation before sampling splat depth',
);
assert.match(core, /rgba16float/, 'hybrid layers retain HDR accumulation before presentation grading');
assert.match(
  core,
  /let momentWeightScale = 1\.0 \/ 1024\.0;[\s\S]*vec4<f32>\(in\.linearDepth \* momentWeightScale, momentWeightScale, in\.linearDepth \* in\.linearDepth \* momentWeightScale, alpha\)/,
  'half-float splat moments must preserve their ratio without overflowing on dense candidate fields',
);
assert.match(core, /encodeBoundarySplatSmokeHybrid/, 'frame routing uses the explicit hybrid compositor path');
assert.match(
  core,
  /let hdr = composed\.rgb \+ background[\s\S]*return vec4<f32>\(hdr, 1\.0\);/,
  'hybrid resolve must preserve the splat-only presentation transfer instead of adding a second exposure or gamma manifold',
);
assert.match(core, /boundarySplatCompositionRequested/, 'debug state preserves requested hybrid composition');
assert.match(core, /boundarySplatCompositionEffective/, 'debug state preserves effective hybrid composition');
assert.match(core, /boundarySplatCompositionFallbackReason/, 'hybrid route failure is explicit rather than hidden substitution');
assert.match(core, /hybridSmokeFrontColor/, 'raymarch emits a dedicated front-smoke radiance/transmittance interval');
assert.match(core, /hybridSmokeBackColor/, 'raymarch emits a dedicated back-smoke radiance/transmittance interval');
assert.match(core, /splatDepthConditionedSmokeSplit/, 'runtime reports the splat-depth-conditioned interval mechanism');
assert.match(core, /@group\(1\) @binding\(1\) var hybridSplatDepthMoments/, 'hybrid smoke depth input must not alias the majorant destination at group 1 binding 0');
assert.match(core, /@group\(1\) @binding\(2\) var hybridSplatDepthSampler/, 'hybrid smoke depth sampler must occupy its own declared binding');
assert.match(
  core,
  /hybridCompositorSampler = device\.createSampler\([\s\S]*?magFilter: 'nearest',[\s\S]*?minFilter: 'nearest'/,
  'same-resolution depth and interval evidence must not interpolate across neighboring rays before validation',
);
assert.match(
  core,
  /let depthIntervalTolerance = max\(0\.02, splatDepth \* 0\.002\);/,
  'half-float interval validation must name its depth quantization tolerance',
);
assert.match(
  core,
  /if \(!smokeFrontIntervalValid\) \{ return vec4<f32>\(1\.0, 0\.0, 0\.0, 1\.0\); \}[\s\S]*if \(!smokeBackIntervalValid\) \{ return vec4<f32>\(0\.0, 0\.75, 1\.0, 1\.0\); \}/,
  'GPU fail colors must distinguish a front-interval violation from a back-interval violation',
);
assert.match(
  core,
  /const HYBRID_SPLAT_SMOKE_COMPOSITOR_WGSL[\s\S]*fn fs\(in: VertexOut\)[\s\S]*let hybridLayerUv = vec2<f32>\(in\.uv\.x, 1\.0 - in\.uv\.y\);[\s\S]*textureSampleLevel\(splatColorOpacity, layerSampler, hybridLayerUv/,
  'hybrid resolve must convert fullscreen UVs to render-attachment texture orientation before reading every layer',
);
assert.doesNotMatch(core, /HYBRID_SMOKE_FRONT_OPACITY_CEILING/, 'v1 runtime must not retain the v0 visibility cap');
assert.match(core, /shared-current-single-simulator-no-instance-smoke-history/, 'runtime must disclose the current multi-instance smoke phase limitation');
assert.match(witness, /boundarySplatCompositionRequested/, 'witness preserves requested composition identity');
assert.match(witness, /boundarySplatCompositionEffective/, 'witness preserves effective composition identity');
assert.match(witness, /boundarySplatCompositionFallbackReason/, 'witness preserves explicit hybrid fallback evidence');
assert.match(witness, /hybridSplatLayer/, 'witness preserves splat attachment semantics');
assert.match(witness, /hybridSmokeLayer/, 'witness preserves smoke attachment semantics');
assert.match(witness, /hybridSmokePhaseAuthority/, 'witness preserves the multi-instance smoke phase limitation');

console.log('hybrid splat smoke compositor contracts passed');
