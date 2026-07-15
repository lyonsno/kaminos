import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(witness, /--projected-area-sweep/, 'motion witness must expose the same-state projected-area sweep explicitly');
assert.match(witness, /projectedAreaSweep/, 'report must preserve the projected-area sweep as a first-class evidence surface');
assert.match(witness, /same-state-camera-distance-sweep-v0/, 'sweep must state that only camera distance changes across one frozen simulation state');
assert.match(witness, /projectedSupport/, 'each capture must measure visible projected fire support rather than infer size from camera distance');
assert.match(witness, /gradientRetention/, 'sweep must compare learned and analytic gradient bandwidth against matched raymarch');
assert.match(witness, /laplacianRetention/, 'sweep must compare high-frequency Laplacian bandwidth against matched raymarch');
assert.match(witness, /sameStateCaptureId/, 'sweep must preserve exact frozen-state identity per size rung');
assert.match(witness, /projected-area state disagreement/, 'sweep must reject a rung whose captures do not share one frozen state');
assert.match(witness, /capture\.canvasCapture\.sameStateCaptureId\s*!==\s*sweep\.sameStateCaptureId/, 'sweep must reject a mutually consistent but stale frozen-state substitution');
assert.match(witness, /capture\.canvasCapture\.baseFrameCount\s*!==\s*sweep\.baseFrameCount/, 'sweep must bind every renderer capture to the declared frozen frame');
assert.match(witness, /capture\.canvasCapture\.baseSimStepCount\s*!==\s*sweep\.baseSimStepCount/, 'sweep must bind every renderer capture to the declared frozen simulation step');
assert.match(witness, /projected-area renderer set incomplete/, 'sweep must reject missing analytic, learned, or raymarch captures');
assert.match(witness, /matched raymarch but effective renderer was/, 'witness must reject every non-native renderer substitution for the structural reference');
assert.match(witness, /canvasCapture\.boundarySplatMode\s*!==\s*'off'/, 'matched raymarch reference must prove splat mode was disabled');
assert.match(core, /renderFrozenScaleToCanvas[\s\S]*boundarySplatMode:\s*normalizeBoundarySplatMode\(controlsSnapshot\.boundarySplatMode\)/, 'frozen canvas receipt must expose the effective boundary splat mode used for the captured frame');
assert.match(witness, /projected-area-support-bandwidth\.html/, 'witness must produce a full-resolution interactive visual comparison');
assert.match(witness, /image-rendering:\s*auto/, 'visual comparison must not crush source frames through nearest-neighbor scaling');
assert.match(witness, /object-fit:\s*contain/, 'visual comparison must preserve the complete source frame at inspectable scale');
assert.match(witness, /data-inspection-mode="native"/, 'visual comparison must expose a one-to-one native-pixel inspection mode');
assert.match(witness, /\.viewport\.native\s+img\s*\{[^}]*width:\s*auto[^}]*height:\s*auto[^}]*max-width:\s*none[^}]*max-height:\s*none/s, 'native inspection mode must not resample the source image to the viewport');

console.log('boundary splat projected bandwidth contracts passed');
