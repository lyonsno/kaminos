#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as volumeCore from '../volume-core.js';

const coreSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const planHistory = volumeCore.boundarySplatHistoryDepthAllocationPlan;

assert.equal(
  typeof planHistory,
  'function',
  'runtime must expose a deterministic requested/allocated history-depth plan before allocating GPU buffers',
);

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

console.log('boundary splat history depth allocation contracts passed');
