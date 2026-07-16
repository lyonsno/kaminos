import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(
  new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url),
  'utf8',
);
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  witness,
  /--raymarch-hybrid-boundary/,
  'motion witness must expose the exact raymarched-smoke boundary assay',
);
assert.match(
  witness,
  /hybrid-raymarch-smoke-boundary-v0/,
  'boundary assay must publish a stable requested route identity',
);
assert.match(
  witness,
  /learned-splat-control-before/,
  'boundary assay must capture the splat-only control before smoke composition',
);
assert.match(
  witness,
  /learned-splat-control-repeat-before/,
  'boundary assay must measure same-state splat-only raster nondeterminism before smoke composition',
);
assert.match(
  witness,
  /hybrid-raymarch-smoke/,
  'boundary assay must capture the smoke-only raymarch under learned splats',
);
assert.match(
  witness,
  /learned-splat-control-restored/,
  'boundary assay must restore and recapture splat-only after smoke composition',
);
assert.match(
  witness,
  /native-3d-compute-fluid-raymarch-smoke-only-v0/,
  'boundary assay must pin the smoke-only raymarch renderer identity',
);
assert.match(
  witness,
  /splat-depth-conditioned-front-back-smoke-compositor-v1/,
  'boundary assay must pin the front-splat-back compositor identity',
);
assert.match(
  witness,
  /boundarySplatCompositionRequested/,
  'capture evidence must preserve requested composition identity',
);
assert.match(
  witness,
  /boundarySplatCompositionEffective/,
  'capture evidence must preserve effective composition identity',
);
assert.match(
  witness,
  /hybridSmokeLayer/,
  'capture evidence must preserve the actual smoke layer renderer contract',
);
assert.match(
  witness,
  /lowerFrontRegion/,
  'boundary assay must report lower-front pixels separately from broad upper smoke',
);
assert.match(
  witness,
  /restorationPixelStable/,
  'boundary assay must prove decoded-pixel-stable splat restoration rather than trusting PNG bytes or toggles',
);
assert.match(
  witness,
  /restorationTolerance:\s*RESTORATION_PIXEL_TOLERANCE/,
  'boundary assay must publish the measured decoded-pixel restoration tolerance',
);
assert.match(
  witness,
  /raymarchHybridBoundary/,
  'report must carry the boundary verdict and per-frame evidence',
);
assert.match(
  witness,
  /rejectRaymarchHybridBoundaryFalseClosure/,
  'boundary assay must centrally reject fallback, stale-state, blank, and restoration failures',
);
assert.match(
  witness,
  /hybrid-raymarch-smoke-boundary-evidence\.mjs/,
  'boundary assay must consume the executable evidence policy shared with its false-closure tests',
);
assert.match(
  witness,
  /smokeResidualMotionDiffs/,
  'boundary assay must report adjacent motion of the smoke-only residual rather than hybrid-frame motion',
);
assert.match(
  witness,
  /postRenderLiveState/,
  'boundary assay must preserve post-render live state before another capture override can hide failed restoration',
);
assert.match(
  witness,
  /supportDensity/,
  'lower-front evidence must quantify learned-splat support inside the selected region',
);
assert.match(
  witness,
  /smokeResidualChangedFraction/,
  'lower-front evidence must quantify a meaningful smoke residual near learned-splat support',
);

assert.match(
  core,
  /boundarySplatCompositionRequested:\s*state\.boundarySplatCompositionRequested/,
  'frozen canvas receipt must return requested composition identity',
);
assert.match(
  core,
  /boundarySplatCompositionEffective:\s*state\.boundarySplatCompositionEffective/,
  'frozen canvas receipt must return effective composition identity',
);
assert.match(
  core,
  /hybridSplatSmokeCompositorIdentity:\s*state\.hybridSplatSmokeCompositorIdentity/,
  'frozen canvas receipt must return the effective hybrid compositor identity',
);
assert.match(
  core,
  /hybridSmokeLayer:\s*\{\s*\.\.\.state\.hybridSmokeLayer\s*\}/,
  'frozen canvas receipt must return the smoke-only layer renderer identity',
);
assert.match(
  core,
  /frozen-render-control-restoration\.mjs/,
  'frozen canvas rendering must restore live debug state alongside controls',
);

const {
  assertLiveControlRestored,
  assertLowerFrontRegionEvidence,
  assertSmokeResidualMotion,
  selectFailureRendererIdentity,
} = await import('../hybrid-raymarch-smoke-boundary-evidence.mjs');
const {
  restoreFrozenRenderLiveState,
  snapshotFrozenRenderLiveState,
} = await import('../frozen-render-control-restoration.mjs');

const liveState = {
  volumeReconstructionStyle: 'splat-depth-conditioned-front-back-smoke-compositor-v1',
  boundarySplatMode: 'learned',
  boundarySplatCompositionRequested: 'hybrid-smoke',
  boundarySplatCompositionEffective: 'hybrid-smoke',
  boundarySplatCompositionFallbackReason: null,
  hybridSmokeRepresentationRequested: 'raymarch',
  hybridSmokeRepresentationEffective: 'raymarch',
};
const frozenRenderSnapshot = snapshotFrozenRenderLiveState(liveState);
Object.assign(liveState, {
  volumeReconstructionStyle: 'live-boundary-sidecar-learned-attribute-splats-v0',
  boundarySplatCompositionRequested: 'splat-only',
  boundarySplatCompositionEffective: 'splat-only',
  hybridSmokeRepresentationEffective: null,
});
restoreFrozenRenderLiveState(liveState, frozenRenderSnapshot);
assert.deepEqual(
  liveState,
  {
    volumeReconstructionStyle: 'splat-depth-conditioned-front-back-smoke-compositor-v1',
    boundarySplatMode: 'learned',
    boundarySplatCompositionRequested: 'hybrid-smoke',
    boundarySplatCompositionEffective: 'hybrid-smoke',
    boundarySplatCompositionFallbackReason: null,
    hybridSmokeRepresentationRequested: 'raymarch',
    hybridSmokeRepresentationEffective: 'raymarch',
  },
  'restoreControls must restore externally visible live renderer state, not only the hidden controls snapshot',
);

assert.throws(
  () => assertSmokeResidualMotion({
    residualMotionDiffs: [
      { meanAbsDiff: 0, changedFraction: 0 },
      { meanAbsDiff: 0, changedFraction: 0 },
    ],
  }),
  /smoke-only residual did not move/,
  'moving flame pixels must not certify a frozen smoke residual',
);
assert.doesNotThrow(
  () => assertSmokeResidualMotion({
    residualMotionDiffs: [
      { meanAbsDiff: 0.22, changedFraction: 0.004 },
      { meanAbsDiff: 0.31, changedFraction: 0.007 },
    ],
  }),
  'measured smoke-residual motion above both gates must pass',
);

const liveHybridState = {
  boundarySplatMode: 'learned',
  boundarySplatCompositionRequested: 'hybrid-smoke',
  boundarySplatCompositionEffective: 'hybrid-smoke',
};
assert.throws(
  () => assertLiveControlRestored({
    before: liveHybridState,
    after: { ...liveHybridState, boundarySplatCompositionRequested: 'splat-only' },
  }),
  /live control restoration failed/,
  'a subsequent splat-only capture override must not hide failed hybrid control restoration',
);
assert.doesNotThrow(
  () => assertLiveControlRestored({ before: liveHybridState, after: { ...liveHybridState } }),
  'identical requested and effective live controls must pass restoration',
);

assert.throws(
  () => assertLowerFrontRegionEvidence({
    samples: 10_000,
    supportPixels: 3,
    supportDensity: 0.0003,
    componentFractionOfLitSupport: 0.001,
    regionFrameAreaFraction: 0.02,
    smokeResidualChangedPixels: 0,
    smokeResidualChangedFraction: 0,
    smokeResidualMeanAbsDiff: 0,
  }),
  /lower-front support density/,
  'stray lit pixels must not authorize an irrelevant lower-front crop',
);
assert.throws(
  () => assertLowerFrontRegionEvidence({
    samples: 10_000,
    supportPixels: 2_000,
    supportDensity: 0.2,
    componentFractionOfLitSupport: 0.8,
    regionFrameAreaFraction: 0.02,
    smokeResidualChangedPixels: 0,
    smokeResidualChangedFraction: 0,
    smokeResidualMeanAbsDiff: 0,
  }),
  /lower-front smoke residual/,
  'a well-supported crop without smoke contribution must not close the boundary claim',
);
assert.doesNotThrow(
  () => assertLowerFrontRegionEvidence({
    samples: 10_000,
    supportPixels: 2_000,
    supportDensity: 0.2,
    componentFractionOfLitSupport: 0.8,
    regionFrameAreaFraction: 0.02,
    smokeResidualChangedPixels: 60,
    smokeResidualChangedFraction: 0.006,
    smokeResidualMeanAbsDiff: 0.18,
  }),
  'a supported lower-front crop with a measured smoke residual must pass',
);

assert.equal(
  selectFailureRendererIdentity({ hybridOnly: false, raymarchHybridBoundary: true }),
  'splat-depth-conditioned-front-back-smoke-compositor-v1',
  'raymarch-boundary failures must name the effective hybrid compositor',
);
assert.equal(
  selectFailureRendererIdentity({ hybridOnly: true, raymarchHybridBoundary: false }),
  'splat-depth-conditioned-front-back-smoke-compositor-v1+phase-matched-spatial-strata-front-back-raster-v0',
  'spatial-strata failures must retain their existing renderer identity',
);

console.log('hybrid raymarch smoke boundary witness contracts passed');
