import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  core,
  /from '\.\/smoke-splat-slot-cache\.mjs'/,
  'volume runtime imports the reusable smoke slot cache contract',
);
assert.match(
  core,
  /export function applySmokeSplatPhaseResolutionState/,
  'runtime phase-authority transitions are an executable reusable contract',
);
assert.match(
  core,
  /export function makeSmokeSplatFailureReport/,
  'all reportful and reportless runtime failures share one identity-enrichment contract',
);

const {
  applySmokeSplatPhaseResolutionState,
  makeSmokeSplatFailureReport,
} = await import(new URL('../volume-core.js', import.meta.url));
const phaseState = {
  hybridSmokePhaseAuthority: 'shared-current-single-simulator-no-instance-smoke-history',
  smokeSplatSlotResolveReport: null,
};
const resolvedReport = { identity: 'resolve:ok', status: 'resolved' };
applySmokeSplatPhaseResolutionState(phaseState, resolvedReport);
assert.equal(phaseState.smokeSplatSlotResolveReport, resolvedReport);
assert.equal(phaseState.hybridSmokePhaseAuthority, 'phase-matched-hierarchical-smoke-splat-slot-products-v0');
const failedReport = { identity: 'resolve:failed', status: 'failed', failurePhase: 'phase-payload-resolution' };
applySmokeSplatPhaseResolutionState(phaseState, failedReport);
assert.equal(phaseState.smokeSplatSlotResolveReport, failedReport);
assert.equal(
  phaseState.hybridSmokePhaseAuthority,
  'smoke-splat-slot-resolution-failed',
  'a later failure demotes previously successful phase authority',
);
const retainedRingError = new Error('retained ring epoch was overwritten');
retainedRingError.report = {
  identity: 'smoke-splat-slot-failure-report-v0',
  status: 'failed',
  failurePhase: 'phase-retention-validation',
  historySlot: 0,
  historyDepth: 4,
};
const enrichedFailure = makeSmokeSplatFailureReport(retainedRingError);
assert.equal(enrichedFailure.failurePhase, 'phase-retention-validation');
assert.equal(enrichedFailure.historySlot, 0);
assert.equal(enrichedFailure.historyDepth, 4);
assert.equal(enrichedFailure.requestedProducerAuthority, 'deterministic-reference-smoke-splat-producer-v0');
assert.equal(enrichedFailure.effectiveProducerAuthority, null);
assert.equal(enrichedFailure.message, retainedRingError.message);
assert.match(
  core,
  /const failureReport = makeSmokeSplatFailureReport\([\s\S]*applySmokeSplatPhaseResolutionState\(state, failureReport\)[\s\S]*smokeSplatSlotResolveReport: failureReport/,
  'the resolver enriches reportful failures before state demotion and status emission',
);
assert.match(
  core,
  /const smokeSplatSlotCache = createSmokeSplatSlotCache\(/,
  'each volume prototype owns an isolated smoke decode cache',
);
assert.match(
  core,
  /function resolveSmokeSplatPhaseSlots\(options = \{\}\)/,
  'volume runtime exposes one named phase-slot resolution boundary',
);
assert.match(
  core,
  /function resolveSmokeSplatPhaseSlots\(options = \{\}\) \{\s*try \{[\s\S]*makeSmokeSplatPhaseInstances/,
  'epoch-binding failures are captured by the same durable runtime report path as decoder failures',
);
assert.match(
  core,
  /modelIdentity: options\.modelIdentity/,
  'smoke model identity is invocation-owned and cannot silently inherit flame model identity',
);
assert.match(
  core,
  /simulatorGeneration: state\.fluidStateResetCount/,
  'cache invalidation follows the live simulator generation',
);
assert.match(
  core,
  /historyWriteTick: state\.boundarySplatHistoryWriteTick/,
  'phase descriptors bind against the effective live ring write tick',
);
assert.match(
  core,
  /applySmokeSplatPhaseResolutionState\(state, report\)/,
  'effective smoke slot resolution remains visible in runtime debug state',
);
assert.match(
  core,
  /resolveSmokeSplatPhaseSlots,/,
  'the live prototype public API exposes the phase-matched smoke resolver',
);
assert.match(
  core,
  /smokeSplatProducerAuthority: SMOKE_SPLAT_PRODUCER_AUTHORITY/,
  'debug state names the deterministic reference producer authority explicitly',
);

console.log('smoke splat volume integration contracts passed');
