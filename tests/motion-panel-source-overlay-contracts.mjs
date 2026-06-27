import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /function motionSourceGhostOverlayBase/, 'overlay source ghost computes an explicit body-overlay base');
assert.match(index, /id="motion-panel-source-overlay-size"/, 'motion panel exposes an overlay size control');
assert.match(index, /function motionPanelSourceGhostOverlaySizeFromInputs/, 'overlay source ghost reads an explicit overlay size multiplier');
assert.match(index, /overlayForwardOffset/, 'overlay source ghost keeps a visible forward offset from the orb body');
assert.match(index, /overlayLift/, 'overlay source ghost keeps a visible lift over the floor/body contact');
assert.match(index, /depthTest:\s*false/, 'source ghost materials render as x-ray overlays instead of disappearing inside the orb/floor');
assert.match(index, /overlayScale:\s*sidecarScale \* motionPanelSourceGhostOverlaySizeFromInputs\(\)/, 'overlay source ghost scale is driven by the overlay size control');
assert.match(index, /overlayOcclusionMode:\s*mode === 'overlay' \? 'xray-over-body' : 'sidecar-scene-depth'/, 'source ghost debug records overlay occlusion mode');
assert.match(index, /overlaySizeMultiplier:\s*Number\(sourceGhost\.overlaySizeMultiplier\.toFixed\(5\)\)/, 'source ghost debug records the effective overlay size multiplier');
assert.match(index, /overlayBase:\s*sourceGhost\.lastOverlayBase/, 'source ghost debug records the effective overlay base');
assert.match(index, /displayCenter/, 'source ghost debug records display center for witness sanity checks');
