import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /function motionSourceGhostOverlayBase/, 'overlay source ghost computes an explicit body-overlay base');
assert.match(index, /overlayForwardOffset/, 'overlay source ghost keeps a visible forward offset from the orb body');
assert.match(index, /overlayLift/, 'overlay source ghost keeps a visible lift over the floor/body contact');
assert.match(index, /depthTest:\s*false/, 'source ghost materials render as x-ray overlays instead of disappearing inside the orb/floor');
assert.match(index, /overlayOcclusionMode:\s*mode === 'overlay' \? 'xray-over-body' : 'sidecar-scene-depth'/, 'source ghost debug records overlay occlusion mode');
assert.match(index, /overlayBase:\s*sourceGhost\.lastOverlayBase/, 'source ghost debug records the effective overlay base');
assert.match(index, /displayCenter/, 'source ghost debug records display center for witness sanity checks');
