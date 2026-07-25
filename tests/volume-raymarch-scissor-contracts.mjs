import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { projectVolumeRaymarchScissor } from '../volume-core.js';

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const halfScale = [
  0.5, 0, 0, 0,
  0, 0.5, 0, 0,
  0, 0, 0.5, 0,
  0, 0, 0, 1,
];

assert.deepEqual(
  projectVolumeRaymarchScissor({
    viewProjectionMatrix: identity,
    width: 200,
    height: 100,
    cameraPosition: [0, 0, 4],
    paddingPixels: 0,
  }),
  {
    schema: 'kaminos.volume-raymarch-scissor.v0',
    mode: 'full-viewport',
    reason: 'projected-volume-fills-viewport',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    viewportWidth: 200,
    viewportHeight: 100,
    pixelCoverageRatio: 1,
  },
  'a screen-filling cube must use exactly the render target, never a larger off-screen rectangle',
);

assert.deepEqual(
  projectVolumeRaymarchScissor({
    viewProjectionMatrix: halfScale,
    width: 200,
    height: 100,
    cameraPosition: [0, 0, 4],
    paddingPixels: 0,
  }),
  {
    schema: 'kaminos.volume-raymarch-scissor.v0',
    mode: 'projected-volume',
    reason: 'projected-volume-bounds',
    x: 50,
    y: 25,
    width: 100,
    height: 50,
    viewportWidth: 200,
    viewportHeight: 100,
    pixelCoverageRatio: 0.25,
  },
  'a smaller projected cube must raymarch only its conservative visible rectangle',
);

const translatedOffscreen = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  3, 0, 0, 1,
];
assert.equal(
  projectVolumeRaymarchScissor({
    viewProjectionMatrix: translatedOffscreen,
    width: 200,
    height: 100,
    cameraPosition: [0, 0, 4],
    paddingPixels: 0,
  }).mode,
  'culled',
  'a fully off-screen projected cube must clear but skip the raymarch draw',
);

assert.equal(
  projectVolumeRaymarchScissor({
    viewProjectionMatrix: halfScale,
    width: 200,
    height: 100,
    cameraPosition: [0, 0, 0],
  }).reason,
  'camera-inside-volume',
  'camera-inside projection ambiguity must conservatively retain the full viewport',
);

const nearPlaneCrossing = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 1,
  0, 0, 0, 0,
];
assert.equal(
  projectVolumeRaymarchScissor({
    viewProjectionMatrix: nearPlaneCrossing,
    width: 200,
    height: 100,
    cameraPosition: [0, 0, 4],
  }).reason,
  'near-plane-ambiguity',
  'near-plane crossings must not clip legitimate volume pixels',
);

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(
  core,
  /function applyVolumeRaymarchScissor\([\s\S]{0,600}pass\.setScissorRect\(/,
  'the projected contract must reach the WebGPU render-pass scissor',
);
assert.match(
  core,
  /function encodeDraw\([\s\S]{0,1000}applyVolumeRaymarchScissor\([\s\S]{0,500}pass\.draw\(3\)/,
  'ordinary and fallback raymarch draws must apply the projected-volume scissor',
);
assert.match(
  core,
  /function encodeBrowserResidualSourcePass\([\s\S]{0,1200}applyVolumeRaymarchScissor\(/,
  'the residual source raymarch must share the same screen-space bound',
);
assert.match(
  core,
  /const smokePass = encoder\.beginRenderPass\([\s\S]{0,1000}applyVolumeRaymarchScissor\(smokePass\)/,
  'the hybrid smoke raymarch must share the same screen-space bound',
);

console.log('Volume raymarch scissor contracts passed');
