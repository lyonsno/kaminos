import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.volume\.boundary-splat-motion-witness\.v0/, 'motion witness must publish a stable schema identity');
assert.match(witness, /live-boundary-sidecar-analytic-splats-v0/, 'motion witness must pin the analytic splat renderer identity');
assert.match(witness, /live-boundary-sidecar-learned-attribute-splats-v0/, 'motion witness must pin the learned splat renderer identity');
assert.match(witness, /22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472/, 'motion witness must pin the corrected live-support model identity');
assert.match(witness, /54a41ba9d04132b8340884adef37a092c367c8cc8443e67907bd5f4f8573b911/, 'motion witness must explicitly reject the superseded absolute-radius model');
assert.match(witness, /09aecca934991ba8321485b5ab7fa7c685c2c8544423286b843195a5e441c64d/, 'motion witness must explicitly reject the synthetic-support model');
assert.match(witness, /live-baked-sidecar-plus-fluid-material-v0/, 'motion witness must pin live sidecar plus material source authority');
assert.match(witness, /sameBrowserSessionId/, 'motion witness must preserve same-browser session identity');
assert.match(witness, /requestedRoute/, 'motion witness must record requested route');
assert.match(witness, /effectiveRoute/, 'motion witness must record effective route');
assert.match(witness, /navigateToRequestedRoute/, 'motion witness must actively navigate reused CDP pages to the requested route');
assert.match(witness, /Page\.navigate/, 'motion witness must not trust a stale browser page URL when a new route is requested');
assert.match(witness, /validateRequestedEffectiveConfig/, 'motion witness must validate effective controls against requested route parameters before capture');
assert.match(witness, /stale\/default config mismatch/, 'motion witness must fail loudly when stale/default config shadows requested inputs');
assert.match(witness, /requestedRenderer/, 'motion witness must distinguish requested renderer from effective renderer');
assert.match(witness, /effectiveRenderer/, 'motion witness must record effective renderer per captured view');
assert.match(witness, /fallbackReason/, 'motion witness must record and reject fallback reasons');
assert.match(witness, /candidateChurn/, 'motion witness must compute candidate churn rather than only dumping frame counts');
assert.match(witness, /birthDeathTelemetry/, 'motion witness must compute birth/death telemetry');
assert.match(witness, /frozenDeterminism/, 'motion witness must include a frozen-state determinism gate');
assert.match(witness, /staticCamera/, 'motion witness must include static-camera evidence');
assert.match(witness, /grazingCamera/, 'motion witness must include grazing-view evidence');
assert.match(witness, /analytic-splat/, 'motion witness must capture analytic-splat side of the A/B');
assert.match(witness, /learned-splat/, 'motion witness must capture learned-splat side of the A/B');
assert.match(witness, /appliedModelIdentity/, 'motion witness must preserve the effective learned model identity');
assert.match(witness, /boundarySplatCandidateCopy/, 'motion witness must preserve candidate-copy state and authority');
assert.match(witness, /analyticLearnedComparison/, 'motion witness must summarize exact-state analytic/learned evidence');
assert.match(witness, /matched-raymarch/, 'motion witness must capture matched-raymarch side of the A/B');
assert.match(witness, /rejectFalseClosure/, 'motion witness must centralize false-closure rejection');
assert.match(witness, /missing or blank capture/, 'motion witness must reject missing or blank captures loudly');
assert.match(witness, /substituted raymarch/, 'motion witness must reject raymarch substitution for splat claims');
assert.match(witness, /cached or static output/, 'motion witness must reject cached/static output pretending to be live');
assert.match(witness, /renderer disagreement/, 'motion witness must reject requested/effective renderer disagreement');

assert.match(
  core,
  /renderFrozenScaleToCanvas[\s\S]*encodeDraw\(encoder,\s*currentTexture\.createView\(\),\s*'kaminos frozen render-scale canvas pass'\);[\s\S]*state\.volumeReconstructionStyle\s*=\s*state\.renderScale\s*<\s*0\.999\s*\?\s*'linear-css-upscale'\s*:\s*'native-resolution'/,
  'frozen raymarch capture must refresh volumeReconstructionStyle instead of reporting stale analytic splat identity',
);

console.log('boundary splat motion witness contracts passed');
