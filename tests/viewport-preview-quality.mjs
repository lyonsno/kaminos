// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPreviewQualityCaps, PREVIEW_QUALITY_CAPS, previewScenePixelRatio} from '../preview-quality.mjs';

test('the preview tier caps fire ray steps and render scale and leaves the sim alone', () => {
 const authored = {raySteps: 160, renderScale: 1, pressureIterations: 60, pressureStrategy: 'spatial_tiers', adaptiveRays: 0.65, speed: 1.6};
 const {controls, changed} = applyPreviewQualityCaps(authored);
 assert.equal(controls.raySteps, PREVIEW_QUALITY_CAPS.raySteps);
 assert.equal(controls.renderScale, PREVIEW_QUALITY_CAPS.renderScale);
 assert.deepEqual(changed.sort(), ['raySteps', 'renderScale']);
 for (const key of ['pressureIterations', 'pressureStrategy', 'adaptiveRays', 'speed']) assert.equal(controls[key], authored[key], `preview does not touch ${key}`);
 assert.equal(authored.raySteps, 160, 'the authored controls object is not mutated');
});

test('settings already below the preview caps are kept', () => {
 const {controls, changed} = applyPreviewQualityCaps({raySteps: 8, renderScale: 0.4});
 assert.equal(controls.raySteps, 8);
 assert.equal(controls.renderScale, 0.4);
 assert.deepEqual(changed, []);
});

test('the scene renders at device pixel ratio 1 in preview and up to 2 otherwise', () => {
 assert.equal(previewScenePixelRatio('preview', 2), 1);
 assert.equal(previewScenePixelRatio('full', 2), 2);
 assert.equal(previewScenePixelRatio('full', 3), 2);
 assert.equal(previewScenePixelRatio('full', 1), 1);
});

import {checkedViewportDisplay, VIEWPORT_QUALITY_TOGGLE_HTML} from '../viewport-display-settings.mjs';
test('quality is a validated viewport preference with a toolbar toggle', () => {
 assert.equal(checkedViewportDisplay().quality, 'full');
 assert.equal(checkedViewportDisplay({quality: 'preview'}).quality, 'preview');
 assert.throws(() => checkedViewportDisplay({quality: 'ultra'}), /quality/);
 assert.match(VIEWPORT_QUALITY_TOGGLE_HTML, /data-quality="preview"/);
 assert.doesNotMatch(VIEWPORT_QUALITY_TOGGLE_HTML, /\bid=/, 'each toolbar gets its own instance');
});

import {applyRuntimeQualityControls} from '../volume-core.js';
test('Preview composes with the routed runtime tier and keeps its simulation settings', () => {
 const authored = {raySteps: 160, renderScale: 1, pressureIterations: 3, pressureStrategy: 'spatial_tiers', adaptiveRays: 0.65};
 const cases = [
  {requested: 'auto', gpuPressure: 0.8, tier: 'holdover'},
  {requested: 'auto', gpuPressure: 0.95, tier: 'impostor'},
  {requested: 'live_high', gpuPressure: 0, tier: 'live_high'},
 ];
 for (const {requested, gpuPressure, tier} of cases) {
  const full = applyRuntimeQualityControls({...authored, runtimeQualityRequested: requested, gpuPressure});
  const preview = applyRuntimeQualityControls({...authored, runtimeQualityRequested: requested, gpuPressure, viewportPreview: true});
  assert.equal(full.runtimeQualityEffective, tier);
  assert.equal(preview.runtimeQualityEffective, tier, `${tier}: Preview keeps the routed tier`);
  assert.equal(preview.pressureIterations, full.pressureIterations, `${tier}: Preview does not change pressure iterations`);
  assert.equal(preview.pressureStrategy, full.pressureStrategy, `${tier}: Preview does not change the pressure strategy`);
  assert.ok(preview.raySteps <= 12 && preview.renderScale <= 0.5, `${tier}: Preview caps the raymarch`);
 }
});
