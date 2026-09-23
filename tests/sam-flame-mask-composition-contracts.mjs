import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hostSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const toolsSource = readFileSync(new URL('../sam-image-tools.js', import.meta.url), 'utf8');
const witnessSource = readFileSync(new URL('../sam-image-witness.mjs', import.meta.url), 'utf8');
assert.match(witnessSource, /report\.checks\s*=\s*\{\s*actualWebgpuMaskToLiveFlameCompositionAtSampledPoints:\s*'passed'[\s\S]*?foregroundMaskContributionAtSampledPoint:\s*'passed'[\s\S]*?backgroundMaskExclusionAtSampledPoint:\s*'passed'/,
  'visible-pixel checks must disclose that their foreground and background evidence is point-sampled');
assert.doesNotMatch(witnessSource, /\b(?:actualWebgpuMaskToLiveFlameComposition|foregroundMaskContribution|backgroundMaskExclusion):\s*'passed'/,
  'sampled-pixel evidence must not be labeled as a whole-mask guarantee');
const overlayMethod = hostSource.match(/addMaskOverlay\(target, proposal[\s\S]*?removeMaskOverlaysForTarget\(target\)/)?.[0] || '';
const bridgeSource = hostSource.match(/function createVolumeMainRendererBridge\(\)[\s\S]*?async function initKaminosVolumeRoute\(\)/)?.[0] || '';
assert.match(toolsSource, /sourceImageElement:\s*image/, 'mask proposal must carry the exact decoded image whose bytes were hashed');
assert.match(hostSource, /showImagePlane\(proposal\.sourceImage\.source,\s*\{\s*decodedImage:\s*proposal\.sourceImageElement/, 'flame plane must render the already hashed image instead of re-fetching its URL');
assert.match(hostSource, /options\.decodedImage\s*\?\s*new THREE\.Texture\(options\.decodedImage\)/, 'image-plane texture creation must support the verified decode');
assert.match(hostSource, /#viewport\.sam-flame-composition-active #kaminos-volume-canvas\.active[^\n]*opacity:\s*0/, 'composition must keep volume compute active without covering the visible image plane');
assert.match(hostSource, /#viewport\.sam-flame-composition-active \.kaminos-main-renderer-canvas[^\n]*z-index:\s*4/, 'the actual image-plane render canvas must be above the native volume canvas');
assert.match(hostSource, /renderer\.domElement\.classList\.add\('kaminos-main-renderer-canvas'\)/, 'the presentation canvas needs an explicit composition-layer identity');
const pixelPointHook = hostSource.match(/window\.__kaminosSamFlamePixelPoints\s*=\s*function[\s\S]*?\n};/)?.[0] || '';
assert.ok(/const pageX\s*=/.test(pixelPointHook) && /const pageY\s*=/.test(pixelPointHook)
  && /pixel:\s*\{\s*pageX,\s*pageY/.test(pixelPointHook),
  'pixel evidence must use projected source-image points in viewport coordinates');
assert.match(hostSource, /window\.__kaminosSetSamFlameDiagnosticVisibility\s*=\s*async function[\s\S]*?overlay\.visible\s*=\s*visible[\s\S]*?renderPipeline\.render\(\)[\s\S]*?queue\.onSubmittedWorkDone\(\)/,
  'the witness must capture source and composed states from the same scene plane');
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
assert.match(witnessSource, /window\.__kaminosSetSamFlameDiagnosticVisibility[\s\S]*?sourceFrame\s*=\s*await captureVisibleFrame\([\s\S]*?window\.__kaminosSetSamFlameDiagnosticVisibility[\s\S]*?composedFrame\s*=\s*await captureVisibleFrame\(/,
  'pixel evidence must compare same-page source and composed viewport screenshots');
assert.match(witnessSource, /new Image\(\)[\s\S]*?await image\.decode\(\)[\s\S]*?getImageData\(x, y, 1, 1\)/,
  'visible screenshot pixels must be decoded by the browser before sampling');
assert.ok(witnessSource.includes("flame-composition-visible-source.png")
  && witnessSource.includes("flame-composition-visible-frame.png"),
  'the exact source and composed frames must be preserved before validation');
assert.match(witnessSource, /assert\.equal\(presentedPixels\.authority,\s*'playwright-visible-viewport-screenshot-pixels'[\s\S]*?sourceFrameCapture:\s*sourceFrame\.capture[\s\S]*?composedFrameCapture:\s*composedFrame\.capture/,
  'pixel evidence must identify compositor screenshot authority and its exact paired artifacts');
assert.match(witnessSource, /brightSamplesInMaskForeground/,
  'flame composition failure must report how many bright native pixels overlap selected foreground');
assert.match(witnessSource, /nativeFlameCanvasPng/,
  'flame composition failure must preserve raw native canvas pixels for visual diagnosis');
assert.match(witnessSource, /report\.flameComposition\s*=\s*\{[\s\S]*?texturePlacement:\s*flamePixelScan\.texturePlacement/,
  'successful composition evidence must retain the exact image-space flame placement');
assert.match(witnessSource, /mapSamFlameTexturePixelToSource[\s\S]*?if\s*\(!sourcePoint\)\s*continue/,
  'flame diagnostics must discard texture samples outside the source image instead of clamping them to edge pixels');

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
const { getSamFlameMaskBounds, fitSamFlameTextureToMask, mapSamFlameTexturePixelToSource } = await import('../sam-image-tools.js');
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
for (const [key, expected] of Object.entries({ left: 0.1, top: 0.25, width: 0.8, height: 0.5 })) {
  assert.ok(Math.abs(placement.imageRect[key] - expected) < 1e-12,
    `flame cover has wrong ${key}; it must cover the selected-mask bounds without distorting aspect ratio`);
}
for (const [key, expected] of Object.entries({ repeatX: 1.25, repeatY: 2, offsetX: -0.125, offsetY: -0.5 })) {
  assert.ok(Math.abs(placement.uvTransform[key] - expected) < 1e-12, `wrong ${key} for image-space mask placement`);
}
const portraitCover = fitSamFlameTextureToMask(8, 32, 1800, 1200,
  { left: 100, top: 200, right: 1700, bottom: 1000, width: 1600, height: 800 });
assert.ok(portraitCover.imageRect.width >= 1600 / 1800,
  'portrait flame cover must span the complete horizontal extent of a broad object mask');
assert.ok(portraitCover.imageRect.height > 800 / 1200,
  'portrait flame cover must preserve aspect ratio and crop outside the mask rather than stretch');
assert.equal(typeof mapSamFlameTexturePixelToSource, 'function',
  'flame diagnostics need a source-bounded texture-to-mask pixel mapper');
assert.deepEqual(mapSamFlameTexturePixelToSource(portraitCover.imageRect, 8, 32, 1800, 1200, 4, 0), null,
  'texture pixels mapped above the source image must not clamp into its top edge');
assert.deepEqual(mapSamFlameTexturePixelToSource(portraitCover.imageRect, 8, 32, 1800, 1200, 4, 14),
  { x: 1000, y: 300 }, 'in-frame texture pixels must retain their exact projected source coordinate');
const landscapeCover = fitSamFlameTextureToMask(32, 8, 1200, 1800,
  { left: 200, top: 100, right: 1000, bottom: 1700, width: 800, height: 1600 });
assert.deepEqual(mapSamFlameTexturePixelToSource(landscapeCover.imageRect, 32, 8, 1200, 1800, 0, 3), null,
  'texture pixels mapped left of the source image must not clamp into its left edge');
assert.deepEqual(mapSamFlameTexturePixelToSource(landscapeCover.imageRect, 32, 8, 1200, 1800, 20, 3), null,
  'texture pixels mapped right of the source image must not clamp into its right edge');
assert.deepEqual(mapSamFlameTexturePixelToSource(landscapeCover.imageRect, 32, 8, 1200, 1800, 13, 3),
  { x: 100, y: 800 }, 'horizontal cover preserves exact in-frame pixel projection');
assert.throws(() => fitSamFlameTextureToMask(2, 1, 5, 4, { left: -1, top: 0, right: 2, bottom: 2, width: 3, height: 2 }), /bounds/);
assert.throws(() => fitSamFlameTextureToMask(2, 1, 2.5, 4,
  { left: 0, top: 0, right: 2, bottom: 2, width: 2, height: 2 }), /dimensions/,
'mask dimensions are pixel counts and must be safe integers');
assert.throws(() => fitSamFlameTextureToMask(Number.MIN_VALUE, Number.MAX_VALUE, 5, 4,
  { left: 1, top: 1, right: 4, bottom: 3, width: 3, height: 2 }), /dimensions/,
'finite but sub-pixel/overflow-scale flame dimensions must not produce non-finite UV placement');
assert.match(bridgeSource, /record\.flameTexture\.repeat\.set\(fit\.uvTransform\.repeatX,\s*fit\.uvTransform\.repeatY\)/,
  'fire texture must be registered into the selected mask bounds');
assert.match(bridgeSource, /record\.flameTexture\.offset\.set\(fit\.uvTransform\.offsetX,\s*fit\.uvTransform\.offsetY\)/,
  'fire texture UV offset must follow the source image-space mask bounds');
assert.match(witnessSource, /kaminos_volume_smoke=1/,
  'flame composition witness must activate the established visible smoke profile before measuring overlap');

console.log('SAM live-flame mask texture contracts passed');
