#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const witnessUrl = new URL('../volume-exact-state-cadence-witness.mjs', import.meta.url);
assert.ok(existsSync(fileURLToPath(witnessUrl)), 'exact-state cadence browser witness exists');
const source = readFileSync(witnessUrl, 'utf8');

assert.match(source, /launchOwnedServer/, 'witness launches the HTTP server it will use instead of inheriting a stale manual server');
assert.match(source, /launchOwnedBrowser/, 'witness launches exactly one harness-owned browser');
assert.match(source, /--headless=new/, 'owned browser cannot require operator window timing');
assert.match(source, /--enable-unsafe-webgpu/, 'owned browser explicitly enables the WebGPU route under test');
assert.match(source, /--user-data-dir=/, 'owned browser uses the requested isolated profile');
assert.match(source, /--disable-background-timer-throttling/, 'owned browser preserves dynamic witness cadence while headless');
assert.match(source, /server-port-already-in-use/, 'witness refuses a stale or foreign server on the requested port');
assert.match(source, /browser-debug-port-already-in-use/, 'witness refuses to inherit a stale CDP endpoint');
assert.match(source, /requested-server-origin-mismatch/, 'witness binds the exact requested route to its owned server origin');
assert.match(source, /owned-headless-browser/, 'report identifies the effective browser as harness-owned and headless');
assert.match(source, /terminateOwnedProcess/, 'witness tears down its owned browser and server');
assert.doesNotMatch(source, /existingPersistentBrowserSeat|connected-existing/, 'witness cannot silently reuse an operator or stale browser seat');
assert.doesNotMatch(source, /Page\.bringToFront/, 'witness cannot depend on operator-visible foreground focus');
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
assert.match(source, /presentationDisposition/, 'witness records whether a visible frame interpolated or truthfully held its last presentation');
assert.match(source, /presentationHoldReceipt/, 'witness preserves the held source and attempted underflow instead of hiding contention');
assert.match(source, /--require-held-presentation/, 'witness can make the repaired underflow path a required acceptance predicate');
assert.match(source, /--force-underflow-ms/, 'witness can autonomously create lifecycle pressure instead of depending on operator timing');
assert.match(source, /Page\.setWebLifecycleState[\s\S]*frozen[\s\S]*active/, 'forced underflow pressure freezes and resumes its owned page');
assert.match(source, /toSourceStep\s*-\s*fromSourceStep/, 'witness checks adjacent completed states');
assert.match(source, /distinctAlpha/, 'witness requires interpolation movement rather than held copies');
assert.match(source, /presentation-source-regressed/, 'witness rejects a visible presentation source clock that moves backward');
assert.match(source, /required-held-presentation-not-observed/, 'required underflow evidence fails loud when the hold branch never occurs');
assert.match(
  source,
  /held-lead-underflow[\s\S]*visibleSourcePosition[\s\S]*presentationReceipt\.sourcePosition/,
  'a held underflow row proves the rendered source stayed on the last valid cadence presentation',
);
assert.match(source, /frameDelta[\s\S]*simStepDelta/, 'witness measures producer cadence independently of RAF cadence');
assert.match(source, /boundarySplatCandidateCount/, 'blank-frame diagnosis preserves the live candidate count');
assert.match(source, /boundarySplatInstanceCount/, 'blank-frame diagnosis preserves the live instance count');
assert.match(source, /boundarySplatAttributeModelIdentity/, 'witness preserves the applied learned attribute model identity');
assert.match(source, /lastFrameEnergy/, 'blank-frame diagnosis preserves renderer energy telemetry');
assert.match(source, /volumeReconstructionStyle/, 'blank-frame diagnosis preserves effective reconstruction identity');
assert.match(source, /timing:\s*state\?\.timing/, 'witness preserves measured frame and queue timing rather than inferring cost from cadence settings');
assert.match(source, /canvasPixel/, 'witness samples rendered pixels instead of trusting telemetry alone');
assert.match(source, /sampleFrame\(\{\s*advanceSim:\s*false,\s*includeRgba:\s*true,\s*boundarySplatComposition:\s*'splat-only-v0'\s*\}\)/, 'pixels come from explicit learned-splat GPU texture readback without an added simulator step');
assert.match(source, /gpu-texture-readback-no-simulator-advance-v0/, 'pixel receipt labels direct GPU readback authority');
assert.doesNotMatch(source, /Page\.captureScreenshot/, 'witness cannot launder Chrome black WebGPU surface capture into evidence');
assert.doesNotMatch(source, /failurePhase = 'initial-canvas'/, 'invasive GPU readback cannot run before cadence measurement');
assert.match(source, /failurePhase = 'sequence-validation'[\s\S]*validateSequence\(rows\)[\s\S]*validateEffectiveState\(finalState,[^)]*\)[\s\S]*failurePhase = 'final-canvas'[\s\S]*captureCanvas\('final'\)/, 'cadence sequence and final route authority are sealed before invasive GPU readback');
assert.match(source, /sample\?\.simAdvanced !== false[\s\S]*sample\?\.sampleAuthority !== 'render-only-exact-state-cadence-presentation-readback'/, 'witness verifies renderer-owned no-sim and exact cadence presentation authority instead of trusting its request');
assert.match(source, /sample\?\.exactStateCadenceReadbackApplied !== true[\s\S]*exactStateCadenceReadbackReceipt/, 'witness rejects a readback that bypasses the cadence presentation buffers');
assert.match(source, /exactStateCadenceReadbackDisposition/, 'final GPU readback distinguishes freshly interpolated from held submitted-visible presentation data');
assert.match(source, /blank-or-partial-cadence-canvas/, 'blank output fails loud');
assert.match(
  source,
  /writeFileSync\(path, bytes\);[\s\S]*lastTrustworthyEvidence\[`\$\{label\}CanvasAttempt`\] = receipt;[\s\S]*if \(metrics\.litPixels/,
  'rejected canvas bytes and their receipt must be durable before the blank-output gate throws',
);
assert.match(source, /writeReport\([\s\S]*catch/, 'witness preserves a report across primary-output failure');
assert.match(source, /failurePhase/, 'failure report names the phase that failed');

const cleanupCaptureSource = source.match(/async function captureCleanupOutcome\([\s\S]*?\n\}/)?.[0] || '';
assert.ok(cleanupCaptureSource, 'witness owns a cleanup failure capture helper');
const captureCleanupOutcome = new Function(`${cleanupCaptureSource}; return captureCleanupOutcome;`)();
const cleanupFailure = await captureCleanupOutcome('browser', async () => {
  throw new Error('cleanup-boom');
});
assert.equal(cleanupFailure.ok, false, 'cleanup errors become report data instead of suppressing the terminal report');
assert.equal(cleanupFailure.label, 'browser');
assert.match(cleanupFailure.error, /cleanup-boom/);
assert.match(source, /finally \{[\s\S]*captureCleanupOutcome[\s\S]*processCleanup[\s\S]*writeReport\(finalReport\)/, 'terminal report is written after best-effort cleanup accounting');

const validateCadenceRowSource = source.slice(
  source.indexOf('function validateCadenceRow'),
  source.indexOf('function validateSequence'),
);
const validateCadenceRow = new Function(
  'ONE_SIMULATOR_AUTHORITY',
  'PHASE_SOURCE',
  `${validateCadenceRowSource}; return validateCadenceRow;`,
)(
  'single-authoritative-simulator-completed-state-history-v0',
  'completed-exact-state-continuation-history',
);
const currentSubmittedReceipt = {
  identity: 'kaminos.volume.exact-state-cadence-gpu.v0',
  status: 'submitted-visible',
  encodedStatus: 'encoded-not-submitted',
  controlGeneration: 2,
  fromSourceStep: 10,
  toSourceStep: 11,
  fromSlot: 1,
  toSlot: 2,
  sourcePosition: 10.5,
  submittedAtMs: 1234,
};
const validCadenceRow = {
  producerReceipt: { status: 'completed' },
  presentationReceipt: { ...currentSubmittedReceipt },
  submittedPresentationReceipt: { ...currentSubmittedReceipt },
  presentationDisposition: 'interpolated',
  controlGeneration: 2,
  exactStateCadenceEffective: 'active',
  exactStateCadenceFallbackReason: null,
  authority: 'single-authoritative-simulator-completed-state-history-v0',
  phaseSource: 'completed-exact-state-continuation-history',
  exactStateCadenceAddedSimulationPasses: 0,
  overflowCount: 0,
  candidateCopyBytes: 0,
  splatFallbackReason: null,
};
assert.doesNotThrow(() => validateCadenceRow(validCadenceRow, 0));
assert.throws(
  () => validateCadenceRow({
    ...validCadenceRow,
    submittedPresentationReceipt: {
      ...currentSubmittedReceipt,
      controlGeneration: 1,
      fromSourceStep: 8,
      toSourceStep: 9,
      fromSlot: 3,
      toSlot: 0,
    },
  }, 1),
  /submitted-presentation-authority-mismatch/,
  'matching source position cannot let a stale generation and bracket impersonate submitted presentation authority',
);

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
