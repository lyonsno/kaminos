import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hostSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const toolsSource = readFileSync(new URL('../sam-image-tools.js', import.meta.url), 'utf8');
const overlayMethod = hostSource.match(/addMaskOverlay\(target, proposal[\s\S]*?removeMaskOverlaysForTarget\(target\)/)?.[0] || '';
assert.match(toolsSource, /sourceImageElement:\s*image/, 'mask proposal must carry the exact decoded image whose bytes were hashed');
assert.match(hostSource, /showImagePlane\(proposal\.sourceImage\.source,\s*\{\s*decodedImage:\s*proposal\.sourceImageElement/, 'flame plane must render the already hashed image instead of re-fetching its URL');
assert.match(hostSource, /options\.decodedImage\s*\?\s*new THREE\.Texture\(options\.decodedImage\)/, 'image-plane texture creation must support the verified decode');
assert.ok(overlayMethod && !overlayMethod.includes('clearMaskOverlays()'),
  'staging a replacement overlay must preserve the previous composition until commit');

const toolsModule = await import('../sam-image-tools.js');
assert.equal(typeof toolsModule.runSamFlameSceneTransaction, 'function', 'flame composition needs a rollback-tested scene transaction');
const priorPlane = { id: 'prior-plane' }, nextPlane = { id: 'next-plane' };
let scenePlanes = [priorPlane], overlays = [priorPlane];
const activationError = new Error('injected flame activation failure');
await assert.rejects(toolsModule.runSamFlameSceneTransaction({
  async createImagePlane() { scenePlanes.push(nextPlane); return nextPlane; },
  addMaskOverlay(plane) { overlays.push(plane); },
  async activateFlame() { throw activationError; },
  removeImagePlane(plane) {
    scenePlanes = scenePlanes.filter(item => item !== plane);
    overlays = overlays.filter(item => item !== plane);
  },
}), /injected flame activation failure/);
assert.deepEqual(scenePlanes, [priorPlane], 'failed activation must remove only the new image plane');
assert.deepEqual(overlays, [priorPlane], 'failed activation must remove its overlay and preserve the prior composition');

const { encodeSamFlameMaskPixels, fitSamFlameTexture } = await import('../sam-image-tools.js');
assert.equal(typeof encodeSamFlameMaskPixels, 'function', 'SAM-to-flame composition needs an explicit mask texture contract');
assert.equal(typeof fitSamFlameTexture, 'function', 'live fire must preserve its aspect ratio inside the selected image mask');

assert.deepEqual([...encodeSamFlameMaskPixels(Uint8Array.from([0, 1, 1, 0]), 2, 2)], [
  0, 0, 0, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 0, 0, 0, 255,
], 'alpha-map green channel must preserve the selected binary source mask');
assert.throws(() => encodeSamFlameMaskPixels(Uint8Array.from([1]), 2, 1), /Mask size/);
assert.throws(() => encodeSamFlameMaskPixels(Uint8Array.from([0, 2]), 2, 1), /binary/);
assert.throws(() => encodeSamFlameMaskPixels(Uint8Array.from([0]), 0, 1), /positive/);

assert.deepEqual(fitSamFlameTexture(200, 100, 100, 100), { scaleX: 1, scaleY: 0.5, offsetX: 0, offsetY: 0.25 });
assert.deepEqual(fitSamFlameTexture(100, 200, 200, 100), { scaleX: 0.25, scaleY: 1, offsetX: 0.375, offsetY: 0 });
assert.throws(() => fitSamFlameTexture(0, 100, 100, 100), /positive/);

console.log('SAM live-flame mask texture contracts passed');
