#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const witnessUrl = new URL('../volume-exact-state-cadence-witness.mjs', import.meta.url);
assert.ok(existsSync(fileURLToPath(witnessUrl)), 'exact-state cadence browser witness exists');
const source = readFileSync(witnessUrl, 'utf8');

assert.match(source, /existingPersistentBrowserSeat/, 'witness consumes one existing persistent browser instead of launching another');
assert.doesNotMatch(source, /spawn\(|execFile\([^)]*(?:Google Chrome|Chromium)/, 'witness cannot hide a replacement browser launch');
assert.match(source, /requestedRouteAgrees/, 'requested and effective page routes are compared canonically');
assert.match(source, /volume_exact_state_cadence/, 'witness requires an explicit cadence request');
assert.match(source, /exactStateCadenceRequested/, 'witness records requested cadence telemetry');
assert.match(source, /exactStateCadenceEffective/, 'witness rejects requested/effective cadence disagreement');
assert.match(source, /EXACT_STATE_CADENCE_GPU_IDENTITY/, 'witness checks the effective cadence runtime identity');
assert.match(source, /single-authoritative-simulator-completed-state-history-v0/, 'witness proves one simulator authority');
assert.match(source, /completed-exact-state-continuation-history/, 'witness labels the phase source as continuation history');
assert.match(source, /exactStateCadenceAddedSimulationPasses/, 'witness rejects a hidden second simulator');
assert.match(source, /producerReceipt/, 'witness records completed producer receipts');
assert.match(source, /presentationReceipt/, 'witness records presentation brackets and alpha');
assert.match(source, /toSourceStep\s*-\s*fromSourceStep/, 'witness checks adjacent completed states');
assert.match(source, /distinctAlpha/, 'witness requires interpolation movement rather than held copies');
assert.match(source, /frameDelta[\s\S]*simStepDelta/, 'witness measures producer cadence independently of RAF cadence');
assert.match(source, /boundarySplatCandidateCount/, 'blank-frame diagnosis preserves the live candidate count');
assert.match(source, /boundarySplatInstanceCount/, 'blank-frame diagnosis preserves the live instance count');
assert.match(source, /boundarySplatAttributeModelIdentity/, 'witness preserves the applied learned attribute model identity');
assert.match(source, /lastFrameEnergy/, 'blank-frame diagnosis preserves renderer energy telemetry');
assert.match(source, /volumeReconstructionStyle/, 'blank-frame diagnosis preserves effective reconstruction identity');
assert.match(source, /timing:\s*state\?\.timing/, 'witness preserves measured frame and queue timing rather than inferring cost from cadence settings');
assert.match(source, /canvasPixel/, 'witness samples rendered pixels instead of trusting telemetry alone');
assert.match(source, /blank-or-partial-cadence-canvas/, 'blank output fails loud');
assert.match(
  source,
  /writeFileSync\(path, bytes\);[\s\S]*lastTrustworthyEvidence\[`\$\{label\}CanvasAttempt`\] = receipt;[\s\S]*if \(metrics\.litPixels/,
  'rejected canvas bytes and their receipt must be durable before the blank-output gate throws',
);
assert.match(source, /writeReport\([\s\S]*catch/, 'witness preserves a report across primary-output failure');
assert.match(source, /failurePhase/, 'failure report names the phase that failed');

const validateEffectiveStateSource = source.slice(
  source.indexOf('function validateEffectiveState'),
  source.indexOf('function compactState'),
);
const validateEffectiveState = new Function(
  'requestedConfigFromUrl',
  'EFFECTIVE_ROUTE',
  'EXACT_STATE_CADENCE_GPU_IDENTITY',
  'ONE_SIMULATOR_AUTHORITY',
  'PHASE_SOURCE',
  'BOUNDARY_SPLAT_LEARNED_RENDERER_IDENTITY',
  'BOUNDARY_SPLAT_LEARNED_ATTRIBUTE_MODEL_IDENTITY',
  `${validateEffectiveStateSource}; return validateEffectiveState;`,
)(
  () => ({
    requested: true,
    depth: 4,
    delaySteps: 2,
    producerIntervalMs: 1,
    presentationStepMs: 40,
    boundarySplatMode: 'learned',
    boundarySplatComposition: 'proof',
    boundarySplatPbrScene: null,
  }),
  'native-3d-compute-fluid-raymarch-v0',
  'kaminos.volume.exact-state-cadence-gpu.v0',
  'single-authoritative-simulator-completed-state-history-v0',
  'completed-exact-state-continuation-history',
  'live-boundary-sidecar-learned-attribute-splats-v0',
  'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
);

const validCadenceButFalseLearnedSplatState = {
  active: true,
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  exactStateCadenceRequested: true,
  exactStateCadenceEffective: 'active',
  exactStateCadenceFallbackReason: null,
  exactStateCadenceIdentity: 'kaminos.volume.exact-state-cadence-gpu.v0',
  exactStateCadenceAddedSimulationPasses: 0,
  exactStateCadenceProducerIntervalMs: 1,
  exactStateCadencePresentationStepMs: 40,
  exactStateCadence: {
    authority: 'single-authoritative-simulator-completed-state-history-v0',
    phaseSource: 'completed-exact-state-continuation-history',
    allocation: {
      requestedDepth: 4,
      allocatedDepth: 4,
      presentationDelaySteps: 2,
    },
  },
  boundarySplatMode: 'off',
  boundarySplatRendererIdentity: 'boundary-sidecar-splats-v0',
  boundarySplatAttributeModelIdentity: null,
  boundarySplatComposition: 'proof',
  boundarySplatSourceCandidateCount: 0,
  boundarySplatSelectedCandidateCount: 0,
  boundarySplatInstanceCount: 0,
  boundarySplatOverflowCount: 0,
  boundarySplatCopyBytesThisFrame: 0,
  boundarySplatFallbackReason: null,
};
assert.throws(
  () => validateEffectiveState(validCadenceButFalseLearnedSplatState, 'http://127.0.0.1:18961/'),
  /stale-default-or-fallback-cadence-config/,
  'valid cadence cannot launder an off or empty learned-splat route into passing evidence',
);

console.log('exact-state cadence witness contracts passed');
