import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const witnessUrl = new URL('../boundary-splat-history-depth-motion-witness.mjs', import.meta.url);
const witness = await readFile(witnessUrl, 'utf8');

assert.match(witness, /kaminos\.volume\.boundary-splat-history-depth-motion-witness\.v0/, 'witness must publish a stable schema');
assert.match(witness, /REQUIRED_HISTORY_DEPTHS\s*=\s*\[16,\s*32,\s*64\]/, 'witness must require all operator-signed depths');
assert.match(witness, /measureHistoryUpperRung/, 'upper rung must be measured from runtime/device authority');
assert.match(witness, /activateFreshMeasuredUpperRung/, 'upper rung must be measured and activated synchronously');
assert.match(witness, /sampleBoundarySplatHistorySlotMetadata[\s\S]*setControls\(\{\s*boundarySplatHistoryDepth:/, 'fresh GPU upper authority must be applied before another simulation frame can invalidate it');
assert.match(witness, /transitionHistoryDepthInPlace/, 'bounded depth rows after the first must preserve the live simulator episode');
assert.match(witness, /history\.replaceState/, 'in-place depth transitions must keep effective URL identity inspectable');
assert.match(witness, /continuousSimulatorEpisode/, 'report must reject a reset simulator between depth rows');
assert.match(witness, /historyDepthRows/, 'report must preserve every serial depth row');
assert.match(witness, /measuredUpperRung/, 'report must distinguish the measured upper rung');
assert.match(witness, /requestedEffectiveDepthAgreement/, 'each row must fail on requested/effective depth substitution');
assert.match(witness, /requestedEffectiveRouteAgreement/, 'each row must preserve requested/effective route identity');
assert.match(witness, /matchedSubstrateIdentity/, 'rows must prove matched basin, renderer, model, camera, and layout');
assert.match(witness, /boundarySplatHistoryAllocatedSlots/, 'rows must preserve physical allocation depth');
assert.match(witness, /boundarySplatBufferIntegrity/, 'rows must preserve physical history memory authority');
assert.match(witness, /primeBoundarySplatLiveHistory/, 'every depth must be fully primed before capture');
assert.match(witness, /sampleBoundarySplatPbrCostLadder/, 'every depth must record measured raster work');
assert.match(witness, /perSourceReuse/, 'rows must report selected history-slot reuse');
assert.match(witness, /Page\.captureScreenshot/, 'motion frames must come from the effective browser canvas');
assert.match(witness, /ffmpeg/, 'witness must encode operator-visible motion');
assert.doesNotMatch(witness, /-stream_loop/, 'motion output must not loop a frame or clip');
assert.match(witness, /missing-or-blank-frame/, 'blank or partial frames must fail loud');
assert.match(witness, /cached-or-static-motion/, 'repeated output must not pretend to be motion evidence');
assert.match(witness, /lastTrustworthyEvidence/, 'pre-output failures must leave durable evidence');
assert.match(witness, /failurePhase/, 'durable failures must identify their phase');
assert.match(witness, /browserProcessId/, 'one persistent browser identity must span every depth');
assert.match(witness, /pageId/, 'one page target identity must span every depth');
assert.match(witness, /simStepCountBefore/, 'depth transition receipts must preserve the simulator continuity boundary');
assert.match(witness, /simStepCountAfter/, 'depth transition receipts must preserve the simulator continuity boundary');
assert.match(witness, /CDP debug port already in use before launch/, 'witness must refuse a stale browser endpoint before launch');
assert.doesNotMatch(witness, /slice\(0,\s*\d+\)/, 'caller-requested frame/depth flow must not be silently capped');

const measureUpperSource = witness.match(/function measureHistoryUpperRung\(initialState\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(measureUpperSource, 'upper-rung selector must remain directly contract-testable');
const measureHistoryUpperRung = Function(
  'REQUIRED_HISTORY_DEPTHS',
  `${measureUpperSource}; return measureHistoryUpperRung;`,
)([16, 32, 64]);
assert.deepEqual(
  measureHistoryUpperRung({
    measuredUpperHistoryDepth: 831,
    authority: 'gpu-archive-slot-metadata-post-queue-completion-readback-v0',
  }),
  {
    depth: 831,
    authority: 'gpu-archive-slot-metadata-post-queue-completion-readback-v0',
  },
  'measured upper rung must retain the GPU-completed post-prime slot authority',
);
assert.throws(
  () => measureHistoryUpperRung({ measuredUpperHistoryDepth: 831 }),
  /measured-history-upper-rung-authority-missing/,
  'numeric upper depth without its receipt authority must fail',
);
assert.throws(
  () => measureHistoryUpperRung({ measuredUpperHistoryDepth: 831, authority: 'host-estimate' }),
  /measured-history-upper-rung-authority-invalid/,
  'upper depth must not inherit an unrelated authority string',
);

const validateCostSource = witness.match(/function validateCost\(cost\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(validateCostSource, 'cost validator must remain directly contract-testable');
const validateCost = Function(
  'EFFECTIVE_ROUTE',
  'RENDERER',
  'MODEL',
  'SOURCE_AUTHORITY',
  'PBR_SCENE',
  'PHASE_SOURCE',
  'warmupSamples',
  'steadySamples',
  `${validateCostSource}; return validateCost;`,
)(
  'native-3d-compute-fluid-raymarch-v0',
  'live-boundary-sidecar-learned-attribute-splats-v0',
  'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
  'live-baked-sidecar-plus-fluid-material-v0',
  'boundary-splat-pbr-fire-field-v0',
  'age-sweep-history',
  3,
  12,
);
const currentCostEvidence = {
  identity: 'boundary-splat-pbr-cost-ladder-v0',
  ok: true,
  authority: 'serial-same-browser-gpu-timestamp-query-frozen-live-simulator-v0',
  counts: [100],
  warmupSamples: 3,
  steadySamples: 12,
  simulatorPreserved: true,
  addedSimulationPasses: 0,
  pbrSceneIdentity: 'boundary-splat-pbr-fire-field-v0',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  modelIdentity: 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
  phaseSourceIdentity: 'age-sweep-history',
  rows: [{
    requestedInstanceCount: 100,
    overflowCount: 0,
    candidateCopyBytes: 0,
    fallbackReason: null,
    timestampStatus: 'available',
    indirectCommandAgreement: true,
  }],
};
assert.doesNotThrow(
  () => validateCost(currentCostEvidence),
  'current frozen-live-simulator cost authority must not be rejected for omitting obsolete simulatorCount',
);
for (const [label, mutate] of [
  ['simulator replacement', evidence => { evidence.simulatorPreserved = false; }],
  ['added simulation pass', evidence => { evidence.addedSimulationPasses = 1; }],
  ['substituted sample count', evidence => { evidence.steadySamples = 8; }],
  ['candidate copy', evidence => { evidence.rows[0].candidateCopyBytes = 16; }],
  ['missing candidate copy proof', evidence => { delete evidence.rows[0].candidateCopyBytes; }],
  ['missing overflow proof', evidence => { delete evidence.rows[0].overflowCount; }],
  ['missing fallback proof', evidence => { delete evidence.rows[0].fallbackReason; }],
  ['missing timestamp', evidence => { evidence.rows[0].timestampStatus = 'unavailable'; }],
  ['indirect disagreement', evidence => { evidence.rows[0].indirectCommandAgreement = false; }],
]) {
  const evidence = structuredClone(currentCostEvidence);
  mutate(evidence);
  assert.throws(() => validateCost(evidence), /gpu-work-/, `${label} must not pass GPU work validation`);
}

const invalidRoot = mkdtempSync(join(tmpdir(), 'kaminos-history-depth-invalid-'));
const invalidReport = join(invalidRoot, 'nested', 'report.json');
const invalid = spawnSync(process.execPath, [
  witnessUrl.pathname,
  '--url', 'http://127.0.0.1:1/?kaminos_volume_smoke=1',
  '--out-dir', invalidRoot,
  '--report', invalidReport,
  '--history-depths', '16,16,64',
], { encoding: 'utf8' });
assert.notEqual(invalid.status, 0, 'duplicate/missing required depth invocation must fail');
const failure = JSON.parse(readFileSync(invalidReport, 'utf8'));
assert.equal(failure.status, 'failed', 'startup failure must leave a durable failed report');
assert.equal(failure.failurePhase, 'startup', 'startup failure must identify its phase');
assert.match(failure.error, /history depths must be unique/, 'failure must preserve the rejected duplicate depth');

const malformedRoot = mkdtempSync(join(tmpdir(), 'kaminos-history-depth-malformed-'));
const malformedReport = join(malformedRoot, 'nested', 'report.json');
const malformed = spawnSync(process.execPath, [
  witnessUrl.pathname,
  '--url', 'http://127.0.0.1:1/?kaminos_volume_smoke=1',
  '--out-dir', malformedRoot,
  '--report', malformedReport,
  '--frames', '0',
], { encoding: 'utf8' });
assert.notEqual(malformed.status, 0, 'malformed numeric input must fail');
const malformedFailure = JSON.parse(readFileSync(malformedReport, 'utf8'));
assert.equal(malformedFailure.status, 'failed', 'malformed input must still leave a durable failed report');
assert.equal(malformedFailure.failurePhase, 'startup', 'malformed input failure must identify startup');
assert.match(malformedFailure.error, /--frames must be a positive integer/, 'malformed report must retain the rejected input');

function runAdversarialFixture(name, expectedError) {
  const root = mkdtempSync(join(tmpdir(), `kaminos-history-depth-${name}-`));
  const report = join(root, 'report.json');
  const result = spawnSync(process.execPath, [
    witnessUrl.pathname,
    '--url', 'http://127.0.0.1:1/fire/?kaminos_volume_smoke=1',
    '--out-dir', root,
    '--report', report,
    '--contract-fixture', name,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name} fixture must be rejected`);
  const failureReport = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(failureReport.status, 'failed', `${name} fixture must leave a durable failed report`);
  assert.equal(failureReport.failurePhase, 'contract-fixture', `${name} fixture must identify its failure phase`);
  assert.match(failureReport.error, expectedError, `${name} fixture must preserve the false-closure reason`);
}

runAdversarialFixture('route-substitution', /requested-effective-route-disagreement/);
runAdversarialFixture('periodic-motion', /cached-or-periodic-motion/);
runAdversarialFixture('stalled-clocks', /stalled-live-clock/);
runAdversarialFixture('upper-authority-collapse', /measured-upper-authority-depth-collapse/);
runAdversarialFixture('reset-depth-transition', /history-depth-transition-reset-simulator/);
runAdversarialFixture('fallback-upper-activation', /history-depth-transition-fallback/);

console.log('boundary splat history depth motion witness contracts passed');
