import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witness = await readFile(new URL('../volume-boundary-splat-appearance-witness.mjs', import.meta.url), 'utf8').catch(() => '');

assert.match(witness, /--camera-manifest/, 'appearance witness requires an explicit camera manifest');
assert.match(witness, /--expected-grid/, 'appearance witness records the exact simulator grid contract');
assert.match(witness, /--expected-ray-steps/, 'appearance witness records the exact ray-step teacher contract');
assert.match(witness, /--expected-render-scale/, 'appearance witness records the exact render-scale teacher contract');
assert.match(witness, /--operation-timeout-ms/, 'appearance witness exposes caller-owned operation deadlines');
assert.match(witness, /setSelectiveHeadLiveCapturePaused\(true\)/, 'appearance witness freezes live capture before camera cohorts');
const basinPrototypeLookups = witness.match(/const prototype = basinWindow\.__kaminosVolumePrototype;/g) || [];
assert.equal(basinPrototypeLookups.length, 2, 'appearance witness admits and captures only through the basin-owned prototype');
const operatorLookups = witness.match(/const operator = window\.__kaminosSelectiveHeadLive;/g) || [];
assert.equal(operatorLookups.length, 2, 'appearance witness admits and switches assays through the operator wrapper');
assert.match(witness, /operator\.setAppearanceAssay\(mode\)/, 'appearance witness uses the wrapper-owned appearance control plane');
assert.match(witness, /hasAppearanceControlApi[\s\S]*hasAppearanceCaptureApi/, 'appearance admission reports control-plane and evidence-plane availability separately');
assert.match(witness, /kaminosSetCameraDebugPose/, 'appearance witness applies explicit camera poses');
assert.match(witness, /captureBoundarySplatSupervisionCandidates/, 'appearance witness captures native analytic candidates without importing a teacher target');
assert.doesNotMatch(witness, /captureBoundarySplatSupervisionFrame/, 'appearance witness does not call the obsolete combined candidate-teacher API');
assert.doesNotMatch(witness, /prototype\.setAppearanceDecompositionMode\(mode\)/, 'appearance witness must not require the nested renderer to own wrapper control');
assert.match(witness, /captureAppearance\(['"]structural-a['"]/, 'appearance witness captures exact structural A');
assert.match(witness, /captureAppearance\(['"]broad-carrier-b['"]/, 'appearance witness captures signed broad-carrier B coefficients');
assert.match(witness, /captureAppearance\(['"]b-applied-to-fixed-a['"]/, 'appearance witness captures B-on-fixed-A as a diagnostic');
assert.match(witness, /captureAppearance\(['"]a-plus-b-recomposition['"]/, 'appearance witness captures exact optical A+B recomposition');
assert.match(witness, /captureAppearance\(['"]smoke-off-beauty-control['"]/, 'appearance witness captures the exact smoke-off control');
assert.doesNotMatch(witness, /capture\.target/, 'exact Structural A is captured independently rather than compared to an obsolete embedded target');
assert.match(witness, /per-sample-pre-tone-map-emission-extinction-v0/, 'appearance witness validates the local coefficient boundary');
assert.match(witness, /signed-control-minus-structural-a-local-coefficients-v0/, 'appearance witness validates signed B authority');
assert.match(witness, /front-to-back-emission-with-exponential-transmittance-v0/, 'appearance witness validates the optical recurrence');
assert.match(witness, /nonlinear-optical-a-plus-b-recomposition-v0/, 'appearance witness validates exact recomposition identity');
assert.match(witness, /smoke-off-beauty-optical-control-v0/, 'appearance witness validates exact control identity');
assert.match(witness, /raymarch-only/, 'appearance witness rejects decomposition leakage outside the raymarch');
assert.doesNotMatch(witness, /beautySmokeOff/, 'full Beauty must not survive as nominal B training authority');
assert.match(witness, /viewCandidateSha256\s*!==\s*candidateSha256/, 'appearance witness compares candidate hashes across camera views');
assert.match(witness, /sameStateCaptureId[\s\S]*simStepCount/, 'appearance witness preserves frozen-state and simulator-step evidence');
assert.match(witness, /camera-manifest-restored/, 'appearance witness restores the original operator camera after capture');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence[\s\S]*writeFile/, 'appearance witness writes a durable failure report with the last trustworthy evidence');

const browserSpawns = witness.match(/spawn\(chrome/g) || [];
assert.equal(browserSpawns.length, 1, 'appearance witness must use one browser process for the entire camera cohort');

console.log('boundary splat appearance witness contracts passed');
