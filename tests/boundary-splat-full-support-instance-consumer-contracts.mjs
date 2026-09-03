import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  auditBoundarySplatNestedResidency,
  boundarySplatAllocateInstanceTiers,
  boundarySplatInstanceLayout,
  boundarySplatProjectedInstanceTargetPixels,
  normalizeBoundarySplatInstanceCount,
} from '../volume-core.js';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  core,
  /BOUNDARY_SPLAT_INSTANCE_DESCRIPTOR_IDENTITY\s*=\s*'boundary-splat-instance-descriptor-v0'/,
  'full-support multiplicity must expose the proven transformed instance descriptor identity',
);
assert.match(
  core,
  /BOUNDARY_SPLAT_INSTANCE_ALLOCATION_IDENTITY\s*=\s*'boundary-splat-projected-area-nested-tiers-v0'/,
  'full-support multiplicity must expose the exact projected-area nested-tier allocation identity',
);
assert.match(
  core,
  /BOUNDARY_SPLAT_PROJECTED_WORK_SELECTOR_IDENTITY\s*=\s*'boundary-splat-live-union-projected-footprint-hash-thinning-v0'/,
  'full-support multiplicity must preserve the proven projected-work selector identity',
);
assert.match(
  core,
  /BOUNDARY_SPLAT_INSTANCE_TARGET_PIXELS\s*=\s*Object\.freeze\(\[6, 9, 24\]\)/,
  'the first consumer head must expose the exact Census 6/9/24 tier set',
);
assert.match(
  core,
  /BOUNDARY_SPLAT_COMPUTE_STORAGE_BUFFER_BINDING_COUNT\s*=\s*10/,
  'device admission must name the unconditional compute layout storage-buffer requirement',
);
assert.match(
  core,
  /adapter\.limits\?\.maxStorageBuffersPerShaderStage[\s\S]*BOUNDARY_SPLAT_COMPUTE_STORAGE_BUFFER_BINDING_COUNT[\s\S]*requiredLimits\.maxStorageBuffersPerShaderStage\s*=\s*BOUNDARY_SPLAT_COMPUTE_STORAGE_BUFFER_BINDING_COUNT/,
  'device admission must request the full unconditional compute layout requirement',
);
assert.match(
  core,
  /struct BoundarySplatInstanceDescriptor[\s\S]*transform:\s*vec4<f32>[\s\S]*phase:\s*vec4<f32>/,
  'the GPU path must consume explicit transformed phase/history descriptors',
);
assert.match(
  core,
  /struct BoundarySplatInstanceTierGroup[\s\S]*descriptorStart:\s*u32[\s\S]*descriptorCount:\s*u32[\s\S]*targetPixels:\s*u32[\s\S]*selectedCandidateCount:\s*u32/,
  'tier residency and indirect counts must be explicit GPU state',
);
assert.match(
  core,
  /boundarySplatInstanceSelectionIndices/,
  'rendering must dereference nested selected native-cell cohorts instead of replicating the full candidate buffer',
);
assert.match(
  core,
  /fn boundarySplatProjectedWorkSelectorKeeps\([\s\S]*nativeCellIndex:\s*u32[\s\S]*targetPixels:\s*f32/,
  'selection must be deterministic from stable native-cell identity and the exact target tier',
);
assert.match(
  core,
  /boundarySplatWriteNestedSelectionCohorts\([\s\S]*BOUNDARY_SPLAT_TARGET_6_INDEX[\s\S]*BOUNDARY_SPLAT_TARGET_9_INDEX[\s\S]*BOUNDARY_SPLAT_TARGET_24_INDEX/,
  'one source compaction must populate all three nested cohorts together',
);
assert.match(
  core,
  /historyDepth:\s*state\.boundarySplatHistoryDepth[\s\S]*phaseSourceIdentity:\s*state\.boundarySplatPhaseSourceIdentity/,
  'one-simulator multiplicity must report its truthful bounded history and phase source',
);
assert.doesNotMatch(core, /archiveBoundarySplatHistory/, 'depth-one shared-current history must not advertise an undispatched archive pass');
assert.match(
  core,
  /addedSimulationPasses:\s*0[\s\S]*addedCompactionPasses:\s*0[\s\S]*candidateCopyBytes:\s*0/,
  'multiplicity receipts must reject extra simulation, extra source compaction, and candidate copies',
);
assert.match(
  core,
  /boundarySplatRequestedTierGroups[\s\S]*boundarySplatEffectiveTierGroups[\s\S]*boundarySplatStableNativeCellResidency/,
  'operator receipts must distinguish requested tiers, effective tiers, and audited residency',
);
assert.match(
  core,
  /async function sampleBoundarySplatInstanceResidency[\s\S]*nestedSetValidated[\s\S]*populationStateId/,
  'the live consumer must read back and identify the exact nested stable-native-cell populations',
);
assert.match(
  core,
  /boundary-splat-instance-residency-requires-look-freeze/,
  'residency validation must reject a moving population',
);
assert.match(
  core,
  /expectedLookFreezeFrame[\s\S]*expectedSimStepCount[\s\S]*populationStateSha256/,
  'residency validation must bind caller correlation to the frozen population frame, sim step, and source hash',
);
assert.doesNotMatch(
  core,
  /options\.populationStateId/,
  'a caller label must never become authoritative population identity',
);

const selectiveBindStart = core.indexOf('function rebuildSelectiveHeadLiveBindGroups');
const selectiveBindEnd = core.indexOf('\n  function ', selectiveBindStart + 1);
assert.ok(selectiveBindStart >= 0 && selectiveBindEnd > selectiveBindStart, 'selective live bind-group builder must remain discoverable');
const selectiveBindGroups = core.slice(selectiveBindStart, selectiveBindEnd);
assert.match(
  selectiveBindGroups,
  /binding:\s*14,\s*resource:\s*\{\s*buffer:\s*boundarySplatInstanceSelectionBuffer\s*\}/,
  'selective-head live must bind the nested selection buffer required by the shared compute layout',
);
assert.match(
  selectiveBindGroups,
  /binding:\s*16,\s*resource:\s*\{\s*buffer:\s*boundarySplatInstanceTierGroupBuffer\s*\}/,
  'selective-head live must bind the tier groups required by the shared compute layout',
);

const instanceStateStart = core.indexOf('function writeBoundarySplatInstanceConsumerState');
const instanceStateEnd = core.indexOf('\n  function ', instanceStateStart + 1);
assert.ok(instanceStateStart >= 0 && instanceStateEnd > instanceStateStart, 'instance consumer admission must remain discoverable');
const instanceState = core.slice(instanceStateStart, instanceStateEnd);
assert.match(instanceState, /boundarySplatRequested\(\)/, 'instance consumer effectiveness must be gated by active splat-route admission');
assert.match(
  core,
  /boundarySplatInstanceConsumerFallbackReason/,
  'instance consumer receipts must expose a consumer-specific inactive or unavailable reason',
);

assert.match(
  core,
  /sampleBoundarySplatKernelDescriptorCapture\(boundarySplatSample\.sourceCandidateCount\)/,
  'descriptor capture must read one row per compacted source candidate, not per rendered instance',
);
assert.doesNotMatch(
  core,
  /sampleBoundarySplatKernelDescriptorCapture\((?:boundarySplatSample\.instanceCount|Number\(state\.boundarySplatInstanceCount\))\)/,
  'no descriptor capture path may size source-row readback from rendered multiplicity',
);
assert.match(
  core,
  /const byteLength\s*=\s*draw\.sourceCandidateCount\s*\*\s*BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES/,
  'footprint audit must size source-candidate readback from sourceCandidateCount',
);
assert.match(
  core,
  /canonicalizeBoundarySplatAuditRows\([\s\S]*draw\.sourceCandidateCount,/,
  'footprint audit canonicalization must consume source rows rather than rendered multiplicity',
);
assert.match(
  core,
  /fullSupportDepositionReceipt\s*=\s*\{[\s\S]*sourceCandidateCount:\s*state\.boundarySplatSourceCandidateCount/,
  'deposition receipts must distinguish source rows from rendered instances',
);

const encodeStart = core.indexOf('function encodeBoundarySplats(');
const encodeEnd = core.indexOf('\n  function resolveBoundarySplatBilinearPipeline', encodeStart);
assert.ok(encodeStart >= 0 && encodeEnd > encodeStart, 'boundary splat encoder must remain discoverable');
const encoder = core.slice(encodeStart, encodeEnd);
assert.equal(
  (encoder.match(/compactPass\.dispatchWorkgroups/g) || []).length,
  1,
  'one frame must dispatch the exact Full Flame union compaction once regardless of instance count',
);
assert.doesNotMatch(
  encoder,
  /for\s*\([^)]*descriptor[^)]*\)[\s\S]*compactPass\.dispatchWorkgroups/,
  'instance descriptors must never trigger per-instance source compaction',
);

assert.equal(normalizeBoundarySplatInstanceCount(100), 100);
assert.equal(normalizeBoundarySplatInstanceCount(999), 128);
assert.deepEqual(boundarySplatInstanceLayout(1), [[0, 0, 0, 1]]);
assert.equal(boundarySplatInstanceLayout(100).length, 100);
assert.equal(boundarySplatProjectedInstanceTargetPixels(40), 6);
assert.equal(boundarySplatProjectedInstanceTargetPixels(240), 9);
assert.equal(boundarySplatProjectedInstanceTargetPixels(480), 24);
const allocation = boundarySplatAllocateInstanceTiers([
  { index: 0, projectedDiameterPx: 40 },
  { index: 1, projectedDiameterPx: 240 },
  { index: 2, projectedDiameterPx: 480 },
]);
assert.deepEqual(allocation.groups.map(group => group.targetPixels), [6, 9, 24]);
assert.deepEqual(allocation.groups.map(group => group.descriptorCount), [1, 1, 1]);
assert.deepEqual(allocation.descriptors.map(descriptor => descriptor.renderDescriptorIndex), [0, 1, 2]);

const residency = auditBoundarySplatNestedResidency({
  candidateNativeCellIds: Uint32Array.from([101, 303, 202]),
  selectedCandidateIndicesByTarget: {
    6: Uint32Array.from([0]),
    9: Uint32Array.from([0, 2]),
    24: Uint32Array.from([0, 1, 2]),
  },
});
assert.equal(residency.nestedSetValidated, true);
assert.deepEqual(residency.nativeCellIdsByTarget[6], [101]);
assert.deepEqual(residency.nativeCellIdsByTarget[9], [101, 202]);
assert.deepEqual(residency.nativeCellIdsByTarget[24], [101, 202, 303]);
assert.throws(() => auditBoundarySplatNestedResidency({
  candidateNativeCellIds: Uint32Array.from([101, 303, 202]),
  selectedCandidateIndicesByTarget: {
    6: Uint32Array.from([0, 1]),
    9: Uint32Array.from([0, 2]),
    24: Uint32Array.from([0, 1, 2]),
  },
}), /target-6-not-nested-in-target-9/);
assert.throws(() => auditBoundarySplatNestedResidency({
  candidateNativeCellIds: Uint32Array.from([101, 101]),
  selectedCandidateIndicesByTarget: {
    6: Uint32Array.from([0]),
    9: Uint32Array.from([0]),
    24: Uint32Array.from([0]),
  },
}), /duplicate-candidate-native-cell-id:101/);

console.log('boundary splat full-support instance consumer contracts passed');
