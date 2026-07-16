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

console.log('hybrid raymarch smoke boundary witness contracts passed');
