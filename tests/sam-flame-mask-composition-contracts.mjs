import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hostSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const toolsSource = readFileSync(new URL('../sam-image-tools.js', import.meta.url), 'utf8');
const witnessSource = readFileSync(new URL('../sam-image-witness.mjs', import.meta.url), 'utf8');
const overlayMethod = hostSource.match(/addMaskOverlay\(target, proposal[\s\S]*?removeMaskOverlaysForTarget\(target\)/)?.[0] || '';
const bridgeSource = hostSource.match(/function createVolumeMainRendererBridge\(\)[\s\S]*?async function initKaminosVolumeRoute\(\)/)?.[0] || '';
assert.match(toolsSource, /sourceImageElement:\s*image/, 'mask proposal must carry the exact decoded image whose bytes were hashed');
assert.match(hostSource, /showImagePlane\(proposal\.sourceImage\.source,\s*\{\s*decodedImage:\s*proposal\.sourceImageElement/, 'flame plane must render the already hashed image instead of re-fetching its URL');
assert.match(hostSource, /options\.decodedImage\s*\?\s*new THREE\.Texture\(options\.decodedImage\)/, 'image-plane texture creation must support the verified decode');
assert.match(hostSource, /#viewport\.sam-flame-composition-active #kaminos-volume-canvas\.active[^\n]*opacity:\s*0/, 'composition must keep volume compute active without covering the visible image plane');
assert.match(hostSource, /#viewport\.sam-flame-composition-active \.kaminos-main-renderer-canvas[^\n]*z-index:\s*4/, 'the actual image-plane render canvas must be above the native volume canvas');
assert.match(hostSource, /renderer\.domElement\.classList\.add\('kaminos-main-renderer-canvas'\)/, 'the presentation canvas needs an explicit composition-layer identity');
assert.ok(/renderPipeline\.render\(\);[\s\S]*?await renderer\.backend\.device\.queue\.onSubmittedWorkDone\(\);[\s\S]*?context\.drawImage\(canvas,\s*0,\s*0\)/.test(hostSource),
  'pixel evidence must read the normal render pipeline after submitted work completes');
assert.match(bridgeSource, /if \(!active\) \{[\s\S]*?record\.mesh\.visible = false[\s\S]*?composition\.status = 'inactive'/, 'inactive or failed volume rendering must hide the stale matte and status');
assert.match(bridgeSource, /setCompositionPresentation\(active\)/, 'composition presentation layering must have an owned lifecycle control');
assert.match(hostSource, /entry\.object === samFlameImagePlane[\s\S]*?setCompositionPresentation\(false\)/, 'removing the composed source plane must restore normal canvas presentation');
assert.ok(overlayMethod && !overlayMethod.includes('clearMaskOverlays()'),
  'staging a replacement overlay must preserve the previous composition until commit');
const canvasDiagnosticPersistence = witnessSource.indexOf('persistSamFlameCanvasDiagnostic(');
const overlapFailure = witnessSource.indexOf("const error = new Error('No bright flame samples overlap both selected-mask foreground and background')");
assert.ok(canvasDiagnosticPersistence >= 0 && canvasDiagnosticPersistence < overlapFailure,
  'native flame pixels and mask-overlap metrics must be persisted before the overlap assertion can fail');
const presentedPixelEvidencePersistence = witnessSource.indexOf('report.compositionDiagnostic.presentationPixelEvidence = pixelEvidence');
const compositionValidation = witnessSource.indexOf('const composition = validateSamFlameComposition');
assert.ok(presentedPixelEvidencePersistence >= 0 && presentedPixelEvidencePersistence < compositionValidation,
  'presented source/composed pixel samples must survive a failed composition assertion');
const compositionAttemptCapture = witnessSource.indexOf("const compositionAttemptPath = join(out, 'flame-composition-attempt.png')");
assert.ok(compositionAttemptCapture >= 0 && compositionAttemptCapture < compositionValidation,
  'the live composition frame must be preserved before a failed assertion rolls back the scene');
assert.match(hostSource, /const composedCanvasPng\s*=\s*buffer\.toDataURL\('image\/png'\)[\s\S]*?composedCanvasPng\s*\}/,
  'pixel evidence must preserve the normal main-renderer canvas before the diagnostic ablation');
assert.match(hostSource, /overlay\.material\.depthTest\s*=\s*false[\s\S]*?const depthTestDisabled\s*=\s*await sample\(\)[\s\S]*?overlay\.material\.depthTest\s*=\s*wasDepthTest/,
  'the failing presentation probe must isolate depth occlusion and restore the live overlay material');
assert.match(witnessSource, /depthTestAblation[\s\S]*?depthTestDisabledForeground/,
  'a failed scene contribution must preserve the same-frame depth-test ablation result');
assert.ok(/const wasAlphaMap = overlay\.material\.alphaMap;[\s\S]*?overlay\.material\.alphaMap = null;[\s\S]*?const alphaMapDisabled = await sample\(\)[\s\S]*?overlay\.material\.alphaMap = wasAlphaMap/.test(hostSource),
  'the next controlled probe must isolate alpha-map suppression and restore its texture');
assert.ok(witnessSource.includes('alphaMapDisabledForeground'),
  'a failed composition must preserve the alpha-map bypass pixel result');
const alphaMapCapture = witnessSource.indexOf("const alphaMapCanvasPath = join(out, 'flame-composition-alpha-map-disabled.png')");
assert.ok(alphaMapCapture >= 0 && alphaMapCapture < compositionValidation,
  'the alpha-map ablation renderer frame must be preserved before scene rollback or validation failure');
assert.ok(/renderPipeline\.render\(\);\s*await renderer\.backend\.device\.queue\.onSubmittedWorkDone\(\);[\s\S]*?requestAnimationFrame/.test(hostSource),
  'main-renderer pixel evidence must wait for submitted WebGPU work and a presented frame');
assert.ok(/const alphaMapCanvasCapture\s*=\s*\{[\s\S]*?name: 'flame-composition-alpha-map-disabled'[\s\S]*?capture: alphaMapCanvasCapture/.test(witnessSource),
  'alpha-map evidence must point at its own artifact, not a later capture');
assert.ok(/sceneProbe = new THREE\.Mesh[\s\S]*?target\.add\(sceneProbe\)[\s\S]*?finally \{[\s\S]*?sceneProbe\.parent\?\.remove\(sceneProbe\)/.test(hostSource),
  'the flat-color render-path control must be temporary and removed even when sampling fails');
assert.ok(witnessSource.includes("flame-composition-scene-traversal-control.png")
  && witnessSource.includes('sceneTraversalControl: { foreground:'),
  'the flat-color control pixels and renderer image must survive a later failed assertion');
const rendererCanvasCapture = witnessSource.indexOf("const rendererCanvasCapturePath = join(out, 'flame-composition-renderer-canvas.png')");
assert.ok(rendererCanvasCapture >= 0 && rendererCanvasCapture < compositionValidation,
  'the sampled main-renderer canvas must be durably captured before the composition assertion');
assert.match(witnessSource, /const pixelEvidence\s*=\s*\{\s*authority:\s*presentedPixels\.authority,\s*canvasRect:\s*presentedPixels\.canvasRect,\s*backingSize:/,
  'rendered pixel samples must retain their CSS and backing-canvas coordinates');
assert.match(witnessSource, /brightSamplesInMaskForeground/,
  'flame composition failure must report how many bright native pixels overlap selected foreground');
assert.match(witnessSource, /nativeFlameCanvasPng/,
  'flame composition failure must preserve raw native canvas pixels for visual diagnosis');
assert.match(witnessSource, /report\.flameComposition\s*=\s*\{[\s\S]*?texturePlacement:\s*flamePixelScan\.texturePlacement/,
  'successful composition evidence must retain the exact image-space flame placement');

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
const { getSamFlameMaskBounds, fitSamFlameTextureToMask } = await import('../sam-image-tools.js');
assert.equal(typeof getSamFlameMaskBounds, 'function', 'flame placement must use the exact selected mask bounds');
assert.equal(typeof fitSamFlameTextureToMask, 'function', 'native fire texture must map into the selected 2D mask bounds');

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

const bounds = getSamFlameMaskBounds(Uint8Array.from([
  0, 0, 0, 0, 0,
  0, 1, 1, 1, 0,
  0, 1, 1, 1, 0,
  0, 0, 0, 0, 0,
]), 5, 4);
assert.deepEqual(bounds, { left: 1, top: 1, right: 4, bottom: 3, width: 3, height: 2 });
assert.throws(() => getSamFlameMaskBounds(Uint8Array.from([0, 0]), 2, 1), /foreground/);
assert.throws(() => getSamFlameMaskBounds(Uint8Array.from([0, 2]), 2, 1), /binary/);
const placement = fitSamFlameTextureToMask(2, 1, 5, 4, bounds);
assert.deepEqual(placement.imageRect, { left: 0.2, top: 0.3125, width: 0.6, height: 0.375 });
for (const [key, expected] of Object.entries({ repeatX: 5 / 3, repeatY: 8 / 3, offsetX: -1 / 3, offsetY: -5 / 6 })) {
  assert.ok(Math.abs(placement.uvTransform[key] - expected) < 1e-12, `wrong ${key} for image-space mask placement`);
}
assert.throws(() => fitSamFlameTextureToMask(2, 1, 5, 4, { left: -1, top: 0, right: 2, bottom: 2, width: 3, height: 2 }), /bounds/);
assert.match(bridgeSource, /record\.flameTexture\.repeat\.set\(fit\.uvTransform\.repeatX,\s*fit\.uvTransform\.repeatY\)/,
  'fire texture must be registered into the selected mask bounds');
assert.match(bridgeSource, /record\.flameTexture\.offset\.set\(fit\.uvTransform\.offsetX,\s*fit\.uvTransform\.offsetY\)/,
  'fire texture UV offset must follow the source image-space mask bounds');
assert.match(witnessSource, /kaminos_volume_smoke=1/,
  'flame composition witness must activate the established visible smoke profile before measuring overlap');

console.log('SAM live-flame mask texture contracts passed');
