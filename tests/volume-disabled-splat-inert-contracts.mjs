#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as volumeCore from '../volume-core.js';

const source = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.equal(
  typeof volumeCore.resolveBoundarySplatExecutionPlan,
  'function',
  'the renderer exposes one executable consumer plan for splat and boundary-sidecar work',
);

const resolvePlan = volumeCore.resolveBoundarySplatExecutionPlan;

const raymarchLive = resolvePlan({
  boundarySplatMode: 'kernel_moment_covariance',
  renderComposition: 'raymarch-only-v0',
  boundarySidecarSource: 'live',
  boundarySidecarView: 'off',
  flowKernelStrength: 1,
});
assert.equal(raymarchLive.splatDispatch, false, 'raymarch-only presentation cannot run hidden splat compaction');
assert.equal(raymarchLive.sidecarDispatch, false, 'live raymarch cannot run an unconsumed baked-sidecar pass');

const hybridLive = resolvePlan({
  boundarySplatMode: 'kernel_moment_covariance',
  renderComposition: 'smoke-raymarch-under-splats-v0',
  boundarySidecarSource: 'live',
  boundarySidecarView: 'off',
});
assert.equal(hybridLive.splatDispatch, true, 'a visible splat composition consumes splat compaction');
assert.equal(hybridLive.sidecarDispatch, true, 'visible splat compaction consumes the boundary sidecar');

const splatModeOff = resolvePlan({
  boundarySplatMode: 'off',
  renderComposition: 'smoke-raymarch-under-splats-v0',
  boundarySidecarSource: 'live',
  boundarySidecarView: 'off',
  flowKernelStrength: 1,
});
assert.equal(splatModeOff.splatDispatch, false, 'Boundary raster: raymarch is a hard splat-dispatch off switch');
assert.equal(splatModeOff.sidecarDispatch, false, 'splat-only controls cannot keep sidecar work alive after raster is off');

const raymarchBaked = resolvePlan({
  boundarySplatMode: 'off',
  renderComposition: 'raymarch-only-v0',
  boundarySidecarSource: 'baked',
  boundarySidecarView: 'off',
});
assert.equal(raymarchBaked.splatDispatch, false, 'baked raymarch structure does not imply a splat consumer');
assert.equal(raymarchBaked.sidecarDispatch, true, 'baked structure remains active when the raymarch explicitly consumes it');
assert.equal(raymarchBaked.sidecarConsumer, 'raymarch-structure', 'the remaining sidecar cost names its raymarch consumer');

const intrinsic = resolvePlan({
  boundarySplatMode: 'kernel_moment_covariance',
  renderComposition: 'smoke-raymarch-under-splats-v0',
  boundarySidecarSource: 'baked',
  boundarySidecarView: 'ridge',
  volumePresentationMode: 'intrinsic',
});
assert.equal(intrinsic.splatDispatch, false, 'intrinsic presentation cannot retain hidden splat work');
assert.equal(intrinsic.sidecarDispatch, false, 'intrinsic presentation cannot retain hidden sidecar work');

const diagnosticCapture = resolvePlan({
  boundarySplatMode: 'kernel_moment_covariance',
  renderComposition: 'raymarch-only-v0',
  boundarySidecarSource: 'live',
  boundarySidecarView: 'off',
  boundarySplatFeatureCapture: true,
});
assert.equal(diagnosticCapture.splatDispatch, true, 'an explicit feature capture is a named non-presentation consumer');
assert.equal(diagnosticCapture.splatConsumer, 'diagnostic-capture', 'diagnostic work is distinguishable from hidden presentation work');

const instanceConsumer = resolvePlan({
  boundarySplatMode: 'kernel_moment_covariance',
  renderComposition: 'raymarch-only-v0',
  boundarySplatInstanceConsumer: true,
});
assert.equal(instanceConsumer.splatDispatch, true, 'an explicit instance consumer keeps its required splat source active');
assert.equal(instanceConsumer.splatConsumer, 'instance-consumer', 'non-presentation instance work is named instead of appearing as hidden presentation work');

assert.match(
  source,
  /const executionPlan = boundarySplatExecutionPlan\(options\);[\s\S]*?const shouldBakeBoundarySidecar = executionPlan\.sidecarDispatch;/,
  'the live sidecar encoder consumes the shared execution plan instead of reconstructing a broader local condition',
);
assert.match(
  source,
  /function boundarySplatRequested\(options = \{\}\) \{\s*return boundarySplatExecutionPlan\(options\)\.splatDispatch;\s*\}/,
  'every live splat encoder and raster gate resolves through the shared consumer plan',
);
assert.doesNotMatch(
  source,
  /sourceName !== 'live' \|\| sidecarViewName !== 'off' \|\| boundarySplatRequested\(\)/,
  'the former always-bake sidecar condition cannot silently return',
);

console.log('disabled splat inert contracts passed');
