#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as volumeCore from '../volume-core.js';

const coreSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const planHistory = volumeCore.boundarySplatHistoryDepthAllocationPlan;
const selectRuntimeDepth = volumeCore.boundarySplatHistoryDepthRuntimeSelection;
const selectLiveDepthTransition = volumeCore.boundarySplatHistoryDepthLiveControlTransition;

assert.equal(
  typeof planHistory,
  'function',
  'runtime must expose a deterministic requested/allocated history-depth plan before allocating GPU buffers',
);
assert.equal(
  typeof selectRuntimeDepth,
  'function',
  'runtime must resolve requested and physically allocated depth before any GPU indexing',
);
assert.equal(
  typeof selectLiveDepthTransition,
  'function',
  'live controls must expose whether a history-depth request requires a GPU history-buffer rebuild',
);

assert.deepEqual(selectRuntimeDepth(32, 32), {
  ok: true,
  requestedDepth: 32,
  allocatedDepth: 32,
  activeDepth: 32,
  refusalReasons: [],
});
assert.deepEqual(selectRuntimeDepth(16, 64), {
  ok: true,
  requestedDepth: 16,
  allocatedDepth: 64,
  activeDepth: 16,
  refusalReasons: [],
}, 'a lower runtime request may lawfully address a prefix of the physical ring');
assert.deepEqual(selectRuntimeDepth(65, 64), {
  ok: false,
  requestedDepth: 65,
  allocatedDepth: 64,
  activeDepth: 0,
  refusalReasons: ['requested-history-depth-exceeds-allocated-depth-runtime-reload-required'],
}, 'a larger runtime request must fail loud rather than index beyond the physical ring');
assert.deepEqual(selectRuntimeDepth(64, 64, ['observed-source-candidate-count-exceeds-history-capacity']), {
  ok: false,
  requestedDepth: 64,
  allocatedDepth: 64,
  activeDepth: 0,
  refusalReasons: ['observed-source-candidate-count-exceeds-history-capacity'],
}, 'a measured source-capacity refusal must gate live GPU addressing even when requested and allocated depth agree');
assert.deepEqual(selectLiveDepthTransition(80, 64), {
  identity: 'boundary-splat-history-depth-live-control-transition-v0',
  requestedDepth: 80,
  allocatedDepth: 64,
  reallocationRequired: true,
  reason: 'requested-depth-exceeds-live-allocation-rebuild-required',
  refusalReasons: [],
}, 'a live request above the allocated ring must trigger reallocation instead of collapsing active depth to zero');
assert.deepEqual(selectLiveDepthTransition(32, 64), {
  identity: 'boundary-splat-history-depth-live-control-transition-v0',
  requestedDepth: 32,
  allocatedDepth: 64,
  reallocationRequired: false,
  reason: null,
  refusalReasons: [],
}, 'a lower live request can reuse the existing physical ring');
assert.deepEqual(selectLiveDepthTransition(80, 0), {
  identity: 'boundary-splat-history-depth-live-control-transition-v0',
  requestedDepth: 80,
  allocatedDepth: 0,
  reallocationRequired: false,
  reason: null,
  refusalReasons: ['history-depth-allocation-unavailable'],
}, 'unallocated startup state must not masquerade as a live-growth reallocation');

const limits = {
  maxBufferSize: 268_435_456,
  maxStorageBufferBindingSize: 262_144_000,
  requestedCandidateCapacity: 131_072,
  observedSourceCandidateCount: 7_055,
  candidateStrideBytes: 48,
};

const depth16 = planHistory({ ...limits, requestedDepth: 16 });
assert.deepEqual(depth16, {
  identity: 'boundary-splat-device-history-depth-plan-v0',
  ok: true,
  authority: 'requested-depth-plus-webgpu-device-limits-v0',
  requestedDepth: 16,
  allocatedDepth: 16,
  activeDepth: 16,
  effectiveDepth: 0,
  requestedCandidateCapacity: 131_072,
  allocatedCandidateCapacity: 131_072,
  observedSourceCandidateCount: 7_055,
  measuredUpperDepthAtObservedSource: 774,
  candidateStrideBytes: 48,
  historyBufferBytes: 100_663_296,
  maxBufferSize: 268_435_456,
  maxStorageBufferBindingSize: 262_144_000,
  limitingBufferBytes: 262_144_000,
  limitingReason: null,
  refusalReasons: [],
});

const depth32 = planHistory({ ...limits, requestedDepth: 32 });
assert.equal(depth32.ok, true);
assert.equal(depth32.requestedDepth, 32);
assert.equal(depth32.allocatedDepth, 32);
assert.equal(depth32.activeDepth, 32);
assert.equal(depth32.allocatedCandidateCapacity, 131_072);
assert.equal(depth32.historyBufferBytes, 201_326_592);
assert.equal(depth32.limitingReason, null);

const depth64 = planHistory({ ...limits, requestedDepth: 64 });
assert.equal(depth64.ok, true, 'depth 64 must remain physically representable by reducing the explicit per-slot capacity');
assert.equal(depth64.requestedDepth, 64);
assert.equal(depth64.allocatedDepth, 64);
assert.equal(depth64.activeDepth, 64);
assert.equal(depth64.effectiveDepth, 0, 'newly allocated slots are not effective until GPU-completed metadata proves readiness');
assert.equal(depth64.allocatedCandidateCapacity, 85_333);
assert.equal(depth64.historyBufferBytes, 262_142_976);
assert.equal(depth64.measuredUpperDepthAtObservedSource, 774);
assert.equal(depth64.limitingReason, 'candidate-capacity-reduced-for-requested-history-depth');
assert.deepEqual(depth64.refusalReasons, []);

const observedOverflow = planHistory({
  ...limits,
  requestedDepth: 64,
  observedSourceCandidateCount: 90_000,
});
assert.equal(observedOverflow.ok, false, 'allocation must refuse if its reduced candidate capacity cannot contain the observed live source');
assert.equal(observedOverflow.allocatedDepth, 0);
assert.equal(observedOverflow.allocatedCandidateCapacity, 0);
assert.ok(observedOverflow.refusalReasons.includes('observed-source-candidate-count-exceeds-history-capacity'));

const impossible = planHistory({
  ...limits,
  requestedDepth: 6_000_000,
});
assert.equal(impossible.ok, false, 'an impossible physical request must refuse rather than silently execute a shallower ring');
assert.equal(impossible.requestedDepth, 6_000_000);
assert.equal(impossible.allocatedDepth, 0);
assert.equal(impossible.activeDepth, 0);
assert.equal(impossible.effectiveDepth, 0);
assert.equal(impossible.allocatedCandidateCapacity, 0);
assert.ok(impossible.refusalReasons.includes('requested-history-depth-exceeds-device-buffer-capacity'));

assert.doesNotMatch(
  coreSource,
  /function normalizeBoundarySplatHistoryDepth\(value\) \{[\s\S]{0,220}Math\.min\(BOUNDARY_SPLAT_HISTORY_SLOTS, requested\)/,
  'requested history depth must not remain hard-clamped to a compile-time 16-slot constant',
);
assert.doesNotMatch(
  coreSource,
  /size:\s*BOUNDARY_SPLAT_HISTORY_SLOTS \* boundarySplatCapacity \* BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES/,
  'initial GPU history allocation must consume the effective device-derived plan',
);
assert.doesNotMatch(
  coreSource,
  /size:\s*BOUNDARY_SPLAT_HISTORY_SLOTS \* nextCapacity \* BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES/,
  'capacity growth must preserve the current physical history-depth plan',
);
assert.match(coreSource, /boundarySplatHistoryRequestedDepth/, 'telemetry must expose requested history depth separately');
assert.match(coreSource, /boundarySplatHistoryAllocatedDepth/, 'telemetry must expose physically allocated depth separately');
assert.match(coreSource, /boundarySplatHistoryActiveDepth/, 'telemetry must expose active addressing depth separately');
assert.match(coreSource, /boundarySplatHistoryEffectiveDepth/, 'telemetry must expose GPU-ready effective depth separately');
assert.match(coreSource, /boundarySplatHistoryDepthRefusalReasons/, 'telemetry must fail loud with exact allocation refusal reasons');
assert.match(coreSource, /boundarySplatHistoryMeasuredUpperDepth/, 'telemetry must expose the uncapped upper rung derived from observed source count and device limits');
assert.match(
  coreSource.match(/function makeBoundarySplatInstanceDescriptors[\s\S]*?\n  function writeBoundarySplatInstanceDescriptors/)?.[0] || '',
  /currentBoundarySplatHistoryDepthSelection\(\)/,
  'instance descriptors must address the active physical history selection',
);
assert.match(
  coreSource.match(/function encodeBoundarySplats[\s\S]*?\n  function encodeBoundarySplatPbrScene/)?.[0] || '',
  /currentBoundarySplatHistoryDepthSelection\(\)/,
  'the live archive encoder must refuse mismatched requested and allocated depths before GPU indexing',
);
assert.match(
  coreSource.match(/function publishBoundarySplatHistoryAllocation[\s\S]*?\n  function ensureBoundarySplatBuffers/)?.[0] || '',
  /observedSourceCandidateCount:\s*state\.boundarySplatCandidateCount/,
  'measured history capacity must consume the uncapped atomic candidate total, not the capped archived source count',
);
assert.match(
  coreSource.match(/function ensureBoundarySplatBuffers[\s\S]*?\n  function rebuildBoundarySplatBindGroups/)?.[0] || '',
  /observedSourceCandidateCount:\s*state\.boundarySplatCandidateCount/,
  'buffer rebuild admission must consume the uncapped atomic candidate total instead of stale capped archive telemetry',
);
assert.match(
  coreSource.match(/setControls\(next\) \{[\s\S]*?state\.gridOverlay/)?.[0] || '',
  /boundarySplatHistoryDepthLiveControlTransition/,
  'live control changes must explicitly detect when requested history depth exceeds the current physical ring',
);
assert.match(
  coreSource.match(/setControls\(next\) \{[\s\S]*?state\.gridOverlay/)?.[0] || '',
  /releaseBoundarySplatBuffersForHistoryDepthReallocation/,
  'live history-depth growth must release splat buffers so the next frame reallocates instead of refusing into fallback',
);
assert.match(
  coreSource,
  /boundarySplatHistoryDepthReallocation/,
  'runtime telemetry must record live history-depth reallocation instead of presenting the fallback as authoritative',
);
assert.match(
  indexSource,
  /<input type="number" id="volume-boundary-splat-history-depth" min="4" step="1" value="4">/,
  'operator history-depth control must accept an explicit uncapped numeric request',
);
assert.doesNotMatch(
  indexSource,
  /id="volume-boundary-splat-history-depth"[^>]*max="16"/,
  'operator history-depth control must not silently restore the old 16-slot ceiling',
);

console.log('boundary splat history depth allocation contracts passed');
