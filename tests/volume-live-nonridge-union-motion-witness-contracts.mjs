import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const witnessUrl = new URL('../volume-live-nonridge-union-motion-witness.mjs', import.meta.url);
assert.ok(existsSync(witnessUrl), 'exact live-union motion witness must exist');

const witness = readFileSync(witnessUrl, 'utf8');

assert.match(witness, /kaminos\.volume\.live-nonridge-union-motion-witness\.v0/, 'witness publishes a stable schema');
assert.match(witness, /kernel_moment_full_flame_union/, 'witness pins exact Ridge union Non-Ridge mode');
assert.match(witness, /live-ridge-nonridge-union-kernel-moment-covariance-splats-v0/, 'witness pins the exact union renderer');
assert.match(witness, /explicit-source-field-operator-v0/, 'witness pins analytical selector authority');
assert.match(witness, /541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9/, 'witness pins selector recipe identity');
assert.match(witness, /single-cdp-browser/, 'witness uses one browser for the whole sequence');
assert.match(witness, /controlledStepFrame/, 'witness advances the simulator through the controlled-step API');
assert.match(witness, /const advanceSim\s*=\s*frameIndex > 0/, 'witness advances exactly after the first captured state');
assert.match(witness, /renderFrozenScaleToCanvas/, 'witness renders each stepped state without a second simulation advance');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures the actual rendered canvas after each frozen render');
assert.match(witness, /canvasCssRect/, 'witness clips screenshots to the authoritative render canvas');
assert.match(witness, /fixed-camera-live-simulation-sequence-v0/, 'witness names fixed-camera motion authority');
assert.match(witness, /supportControlSnapshot/, 'witness records effective support-carrier controls per frame');
assert.match(witness, /candidateCount/, 'witness records live candidate population');
assert.match(witness, /instanceCount/, 'witness records the effective draw population');
assert.match(witness, /overflowCount/, 'witness records and rejects overflow');
assert.match(witness, /boundarySplatFallbackReason/, 'witness records and rejects fallback');
assert.match(witness, /adjacentFramePixelDiffs/, 'witness measures adjacent-frame motion rather than inferring it');
assert.match(witness, /partialFrames/, 'failure reports preserve frames captured before failure');
assert.match(witness, /lastTrustworthyEvidence/, 'failure reports preserve the last trustworthy route evidence');
assert.match(witness, /effectiveRoute/, 'witness distinguishes effective route from the requested URL');
assert.match(witness, /browserEvents/, 'witness preserves browser errors and validation output');
assert.match(witness, /sequence-viewer\.html/, 'witness writes an operator-scrubbable sequence viewer');
assert.match(witness, /cached-or-static-output/, 'witness rejects a sequence that did not visibly move');

console.log('volume live Non-Ridge union motion witness contracts passed');
