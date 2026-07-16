#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER,
  VIVISECTOR_CANDIDATE_HEAD_PACKAGE_SCHEMA,
  VIVISECTOR_CANDIDATE_HEAD_RECEIVER_IDENTITY,
  validateVivisectorCandidateHeadPackage,
} from '../native-low-candidate-head-package.mjs';

function validPackage(overrides = {}) {
  return {
    schema: VIVISECTOR_CANDIDATE_HEAD_PACKAGE_SCHEMA,
    identity: 'vivisector-trained-native-low-candidate-head-width32-v0',
    authority: 'vivisector-trained-weights-runtime-package-v0',
    syntheticBenchmarkWeights: false,
    trainedWeights: true,
    vivisectorTrainedWeights: true,
    learnedWeightsUsed: true,
    fidelityClaim: false,
    visualClaim: false,
    model: {
      identity: 'pyro-field-residual-vivisector-candidate-head-width32-v0',
      sha256: 'b'.repeat(64),
      sourceDiaulos: 'pyro-field-residual-vivisector',
    },
    grid: {
      sourceLowGrid: 128,
      receiverHighGrid: 160,
      candidateGrid: 160,
      sourceChannels: 17,
      sourceDeltaChannels: 17,
    },
    runtimeShape: {
      candidateHeadWidth: 32,
      workgroupSize: 64,
      inputCount: 48,
      candidateListSource: 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0',
      dispatchMode: 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0',
    },
    inputSchema: {
      featureOrder: VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER,
      currentSourceChannels: 17,
      sourceDeltaChannels: 17,
      normalizedPositionAndSubcell: true,
      coarseLatentChannels: 8,
      coarseLatentAuthority: 'vivisector-trained-coarse-latent-runtime-package-v0',
    },
    outputSchema: {
      identity: 'compact-renderer-facing-cue-record-v0',
      cueRecordStrideBytes: 32,
      outputChannels: 8,
      cueRecordVec4Count: 2,
    },
    checksums: {
      weightsSha256: 'a'.repeat(64),
      packageSha256: 'c'.repeat(64),
    },
    ...overrides,
  };
}

assert.equal(VIVISECTOR_CANDIDATE_HEAD_RECEIVER_IDENTITY, 'native-low-vivisector-candidate-head-package-receiver-v0');

const accepted = validateVivisectorCandidateHeadPackage(validPackage());
assert.equal(accepted.ok, true);
assert.equal(accepted.receiver.identity, VIVISECTOR_CANDIDATE_HEAD_RECEIVER_IDENTITY);
assert.equal(accepted.receiver.trainedRouteRequested, true);
assert.equal(accepted.receiver.syntheticBenchmarkWeightsRejected, true);
assert.equal(accepted.receiver.candidateListSource, 'real-uncapped-fixed-gate-sourceHistoryCandidates-v0');
assert.equal(accepted.receiver.dispatchMode, 'dispatchWorkgroupsIndirect-sourceHistoryDispatchArgs-v0');
assert.deepEqual(accepted.receiver.featureOrder, VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER);
assert.equal(accepted.receiver.outputSchema.identity, 'compact-renderer-facing-cue-record-v0');
assert.equal(accepted.receiver.failurePhase, null);

const synthetic = validateVivisectorCandidateHeadPackage(validPackage({
  authority: 'synthetic-deterministic-candidate-head-cost-substrate-not-learned-evidence-v0',
  syntheticBenchmarkWeights: true,
  learnedWeightsUsed: false,
  inputSchema: {
    featureOrder: VIVISECTOR_CANDIDATE_HEAD_FEATURE_ORDER,
    currentSourceChannels: 17,
    sourceDeltaChannels: 17,
    normalizedPositionAndSubcell: true,
    coarseLatentChannels: 8,
    coarseLatentAuthority: 'deterministic-synthetic-coarse-latent-v0',
  },
}));
assert.equal(synthetic.ok, false);
assert.equal(synthetic.failurePhase, 'vivisector-candidate-package-validation');
assert.match(synthetic.error, /synthetic benchmark weights/);
assert.equal(synthetic.report.status, 'failed');
assert.equal(synthetic.report.gpuWorkStarted, false);
assert.equal(synthetic.report.durableFailureReportRequired, true);

for (const [label, overrides, pattern] of [
  ['wrong width', { runtimeShape: { ...validPackage().runtimeShape, candidateHeadWidth: 24 } }, /candidateHeadWidth/],
  ['wrong grid', { grid: { ...validPackage().grid, receiverHighGrid: 128 } }, /receiverHighGrid/],
  ['wrong source channel count', { inputSchema: { ...validPackage().inputSchema, currentSourceChannels: 16 } }, /currentSourceChannels/],
  ['wrong delta channel count', { inputSchema: { ...validPackage().inputSchema, sourceDeltaChannels: 16 } }, /sourceDeltaChannels/],
  ['wrong feature order', { inputSchema: { ...validPackage().inputSchema, featureOrder: ['normalizedPositionAndSubcell', 'currentSource[0..16]', 'sourceDelta[0..16]', 'coarseLatent[0..7]'] } }, /featureOrder/],
  ['wrong dispatch mode', { runtimeShape: { ...validPackage().runtimeShape, dispatchMode: 'dispatchWorkgroups' } }, /dispatchMode/],
  ['wrong candidate list', { runtimeShape: { ...validPackage().runtimeShape, candidateListSource: 'js-visible-candidate-list' } }, /candidateListSource/],
  ['wrong cue schema', { outputSchema: { ...validPackage().outputSchema, cueRecordStrideBytes: 64 } }, /cueRecordStrideBytes/],
]) {
  const result = validateVivisectorCandidateHeadPackage(validPackage(overrides));
  assert.equal(result.ok, false, `${label} should be rejected`);
  assert.equal(result.failurePhase, 'vivisector-candidate-package-validation');
  assert.match(result.error, pattern, `${label} rejection names the wrong field`);
  assert.equal(result.report.gpuWorkStarted, false, `${label} rejection must happen before GPU work`);
}

console.log('native-low Vivisector candidate-head package contracts passed');
